// One terminal: an xterm.js screen connected to one program through a pty host process.
// A TerminalView shows several of these as tabs.
import { Notice } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { lstatSync } from "node:fs";
import { release } from "node:os";
import { isOsc777Notify, readOsc9 } from "./attention.ts";
import { findExecutable, launchCommand, splitCommandLine, type CommandLine } from "./command-line.ts";
import type { Strings } from "./i18n.ts";
import { PtyProcess } from "./pty-process.ts";
import type { Profile, Settings } from "./settings.ts";
import { fontFor, themeFor } from "./theme.ts";

/** Output not yet drawn by the terminal; past HIGH the program is paused until it drops below LOW. */
const HIGH_WATER = 512 * 1024;
const LOW_WATER = 64 * 1024;
/** After Enter, output that then stops for this long counts as a finished reply. */
const QUIET_MS = 3000;

/** What a terminal needs from the plugin. */
export interface SessionContext {
  readonly settings: Settings;
  readonly s: Strings;
  vaultPath(): string;
  hostScript(): string;
  /** Whether a keydown is one of this plugin's hotkeys, which Obsidian should handle. */
  passToObsidian(event: KeyboardEvent): boolean;
  /** Registers a running process so it is stopped when the plugin unloads; returns the undo. */
  track(process: PtyProcess): () => void;
}

export type SessionStatus = "idle" | "running" | "exited";

/** True for files and for the app execution aliases in WindowsApps (such as pwsh.exe). */
function isFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.COLORTERM = "truecolor";
  // Programs start in the vault folder. Without this, cmd.exe, and with it every .cmd shim (npm's
  // call node by name), would run a node.exe or git.bat placed in the vault before the one on PATH.
  env.NoDefaultCurrentDirectoryInExePath = "1";
  return env;
}

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

export class TerminalSession {
  /** The element the terminal is drawn in; hidden while another tab is shown. */
  readonly el: HTMLElement;
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private frame = 0;
  private fitRetries = 0;
  private resizeTimer: number | undefined;
  private proc: PtyProcess | null = null;
  private untrack: (() => void) | null = null;
  private unacked = 0;
  private paused = false;
  private disposed = false;
  /** Enter was pressed and the program has not gone quiet since. */
  private awaitingReply = false;
  private quietTimer: number | undefined;
  private progressBusy = false;
  status: SessionStatus = "idle";
  /** Set when the program asked for attention; cleared by a key or click in the terminal. */
  attention = false;
  /** Called when the title, status or attention mark changes, so the tab can be redrawn. */
  onChange: () => void = () => {};
  /**
   * Called when the program may want the user: it rang the bell, sent a notification, cleared its
   * taskbar progress, or printed a reply to Enter and then went quiet.
   */
  onAttention: () => void = () => {};

  constructor(parent: HTMLElement, private readonly ctx: SessionContext, readonly profileId: string) {
    this.el = parent.createDiv({ cls: "terminal-pane-host" });
    const term = new Terminal({
      allowProposedApi: true, // needed for the Unicode 11 widths (CJK and emoji)
      cursorBlink: true,
      scrollback: 10000,
      fontSize: ctx.settings.fontSize,
      fontFamily: fontFor(parent, ctx.settings.fontFamily),
      theme: themeFor(parent),
      windowsPty: { backend: "conpty", buildNumber: Number(release().split(".")[2]) || undefined },
    });
    term.loadAddon(this.fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)));
    term.open(this.el);
    this.useWebgl(term);
    term.attachCustomKeyEventHandler((event) => this.handleKey(event));
    term.onData((data) => this.input(data));
    term.onResize(() => this.schedulePtyResize());
    term.onBell(() => this.onAttention());
    term.parser.registerOscHandler(9, (data) => {
      const osc = readOsc9(data);
      if (osc.kind === "notify") this.onAttention();
      else {
        if (this.progressBusy && !osc.busy) this.onAttention();
        this.progressBusy = osc.busy;
      }
      return true;
    });
    term.parser.registerOscHandler(777, (data) => {
      if (isOsc777Notify(data)) this.onAttention();
      return true;
    });
    // Not on focus: Obsidian gives the terminal its focus back whenever its window comes to the
    // front, which would clear the mark before it could be seen.
    this.el.addEventListener("mousedown", () => this.setAttention(false));
    this.el.addEventListener("contextmenu", (event) => this.rightClick(event));
    this.term = term;
  }

  /** The profile this terminal runs: the one it was opened with, or the default if that was removed. */
  profile(): Profile | undefined {
    const { profiles, defaultProfile } = this.ctx.settings;
    return profiles.find((p) => p.id === this.profileId) ?? profiles.find((p) => p.id === defaultProfile);
  }

  get title(): string {
    const profile = this.profile();
    return profile?.name || profile?.command || this.ctx.s.untitled;
  }

  start(): void {
    if (this.disposed || this.status === "running") return;
    const { s, settings } = this.ctx;
    this.status = "running";
    this.onChange();
    const launch = this.resolve(this.profile()?.command ?? "");
    if (typeof launch === "string") return this.fail(launch);
    const { cols, rows } = this.size();
    const proc = new PtyProcess(settings.nodePath, this.ctx.hostScript(), {
      t: "spawn", ...launch, cwd: this.ctx.vaultPath(), env: environment(), cols, rows,
      useConptyDll: settings.bundledConpty,
    }, {
      output: (data) => this.output(data),
      exit: (code) => {
        this.detach();
        this.term.write(`\r\n\x1b[2m${crlf(s.exited(code))} ${s.pressEnter}\x1b[0m\r\n`);
      },
      error: (error) => {
        this.detach();
        const message = error.kind === "node" ? s.nodeNotFound(settings.nodePath) : s.startFailed(error.message);
        if (error.kind === "node") new Notice(message);
        this.fail(message);
      },
    });
    this.proc = proc;
    this.untrack = this.ctx.track(proc);
  }

  /** Stops the program, if any, and starts it again on a clean screen. */
  restart(): void {
    this.proc?.kill();
    this.detach();
    this.term.reset();
    this.start();
  }

  setVisible(visible: boolean): void {
    this.el.toggleClass("is-hidden", !visible);
    if (visible) this.scheduleFit();
  }

  focus(): void { this.term.focus(); }

  /** Whether the terminal has the keyboard. */
  hasFocus(): boolean {
    return this.term.textarea !== undefined && document.activeElement === this.term.textarea;
  }

  setAttention(value: boolean): void {
    if (this.attention === value) return;
    this.attention = value;
    if (!this.disposed) this.onChange();
  }

  /** Types text into the program as a paste, so shells do not run it before Enter. */
  paste(text: string): void {
    if (this.status === "running") this.term.paste(text);
    this.term.focus();
  }

  /** Re-reads colors, font and font size. */
  applyAppearance(): void {
    const parent = this.el.parentElement ?? this.el;
    this.term.options.theme = themeFor(parent);
    this.term.options.fontFamily = fontFor(parent, this.ctx.settings.fontFamily);
    this.term.options.fontSize = this.ctx.settings.fontSize;
    this.scheduleFit();
  }

  /** After a web font loads: glyphs drawn with a fallback font would otherwise stay cached. */
  fontsChanged(): void {
    this.term.clearTextureAtlas();
    this.scheduleFit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.quietTimer);
    this.proc?.kill();
    this.detach();
    this.term.dispose();
    this.el.remove();
  }

  /**
   * Fits once per frame. The space it fits to is positioned against the pane (see styles.css), so a
   * new size cannot feed back into another fit. A hidden terminal keeps its size.
   */
  scheduleFit(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.isVisible()) return;
      // Until the font is measured there is no size to fit to; try again on the next frame.
      const dims = this.fit.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) {
        if (this.fitRetries++ < 120) this.scheduleFit();
        return;
      }
      this.fitRetries = 0;
      if (dims.cols !== this.term.cols || dims.rows !== this.term.rows) this.fit.fit();
    });
  }

  /**
   * Draws with WebGL, much faster than the default DOM renderer for programs that redraw the whole
   * screen. Without WebGL, or if the GPU context is lost (driver reset, too many contexts), the
   * terminal keeps working with the DOM renderer.
   */
  private useWebgl(term: Terminal): void {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (error) {
      console.warn("Terminal Pane: WebGL unavailable, using the DOM renderer", error);
    }
  }

  /** The program to start, or a message saying why there is none. */
  private resolve(command: string): CommandLine | string {
    const { s } = this.ctx;
    const parts = splitCommandLine(command);
    if (!parts) return s.emptyCommand;
    const program = findExecutable(parts.file, {
      path: process.env.PATH ?? "",
      pathext: process.env.PATHEXT ?? "",
      cwd: this.ctx.vaultPath(),
      isFile,
    });
    if (!program) return s.commandNotFound(parts.file);
    return launchCommand(program, parts.args, process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe");
  }

  private fail(message: string): void {
    this.status = "exited";
    this.onChange();
    this.term.write(`\r\n\x1b[31m${crlf(message)}\x1b[0m\r\n\x1b[2m${this.ctx.s.pressEnter}\x1b[0m\r\n`);
  }

  /** Forgets the process after it ended or was killed. */
  private detach(): void {
    this.untrack?.();
    this.untrack = null;
    this.proc = null;
    this.unacked = 0;
    this.paused = false;
    window.clearTimeout(this.quietTimer);
    this.awaitingReply = false;
    this.progressBusy = false;
    if (this.status !== "exited") {
      this.status = "exited";
      if (!this.disposed) this.onChange();
    }
  }

  private input(data: string): void {
    if (this.status === "running") {
      this.proc?.write(data);
      if (data.includes("\r")) this.awaitingReply = true;
    } else if (this.status === "exited" && data === "\r") {
      this.term.reset();
      this.start();
    }
  }

  private output(data: string): void {
    if (this.awaitingReply) this.waitForQuiet();
    this.unacked += data.length;
    if (!this.paused && this.unacked > HIGH_WATER) {
      this.paused = true;
      this.proc?.pause();
    }
    this.term.write(data, () => {
      this.unacked -= data.length;
      if (this.paused && this.unacked < LOW_WATER) {
        this.paused = false;
        this.proc?.resume();
      }
    });
  }

  /**
   * A reply to Enter is taken as finished once its output stops: assistants such as Copilot CLI
   * animate a spinner until they are done, and a shell command prints until it ends. Waiting for
   * Enter first keeps redraws (focus changes, resizes) from counting as replies.
   */
  private waitForQuiet(): void {
    window.clearTimeout(this.quietTimer);
    this.quietTimer = window.setTimeout(() => {
      this.awaitingReply = false;
      if (!this.disposed) this.onAttention();
    }, QUIET_MS);
  }

  /**
   * Copy and paste follow Windows Terminal: Ctrl+C copies when text is selected (otherwise it
   * reaches the program as an interrupt), Ctrl+Shift+C always copies, Ctrl+V and Ctrl+Shift+V paste.
   * Returning false keeps xterm from sending the key to the program.
   */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== "keydown") return true;
    this.setAttention(false);
    if (this.ctx.passToObsidian(event)) return false;
    // xterm.js sends Shift+Enter as a plain Enter, so programs cannot tell them apart. Alt+Enter
    // (ESC, then Enter) is a line break that Claude Code accepts.
    if (this.ctx.settings.shiftEnterNewline && event.key === "Enter" && event.shiftKey
      && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.input("\x1b\r");
      return false;
    }
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    if (ctrl && event.code === "KeyC" && (event.shiftKey || this.term.hasSelection())) {
      const text = this.term.getSelection();
      if (text) void navigator.clipboard.writeText(text);
      this.term.clearSelection();
      event.preventDefault();
      return false;
    }
    if (ctrl && event.code === "KeyV") {
      event.preventDefault();
      void navigator.clipboard.readText().then((text) => { if (text) this.paste(text); });
      return false;
    }
    return true;
  }

  /**
   * Right-click follows Windows Terminal: it copies the selection, or pastes when nothing is
   * selected, and never opens Obsidian's menu. Programs that track the mouse (Copilot CLI, editors)
   * already receive the click and copy or paste themselves, so they are left to it unless Shift is
   * held, which xterm.js uses to bypass mouse tracking.
   */
  private rightClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.term.modes.mouseTrackingMode !== "none" && !event.shiftKey) return;
    if (this.term.hasSelection()) {
      void navigator.clipboard.writeText(this.term.getSelection());
      this.term.clearSelection();
      return;
    }
    void navigator.clipboard.readText().then((text) => { if (text) this.paste(text); });
  }

  private size(): { cols: number; rows: number } {
    this.scheduleFit();
    const dims = this.isVisible() ? this.fit.proposeDimensions() : undefined;
    return dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows)
      ? { cols: dims.cols, rows: dims.rows }
      : { cols: this.term.cols, rows: this.term.rows };
  }

  private isVisible(): boolean {
    return this.el.clientWidth > 0 && this.el.clientHeight > 0;
  }

  /**
   * ConPTY redraws the screen on every resize, so dragging the sidebar edge would otherwise send it
   * dozens of sizes; it gets the last one once the size settles.
   */
  private schedulePtyResize(): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.proc?.resize(this.term.cols, this.term.rows), 100);
  }
}
