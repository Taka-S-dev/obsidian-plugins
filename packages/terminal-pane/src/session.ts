// One terminal: an xterm.js screen connected to one program through a pty host process.
// A TerminalView shows several of these as tabs.
import { Notice } from "obsidian";
import { type ILink, Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { type ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { lstatSync } from "node:fs";
import { release } from "node:os";
import { isOsc777Notify, readOsc9 } from "./attention.ts";
import { programTitle, tabTitle } from "./tab-title.ts";
import type { Change } from "./changes.ts";
import { findExecutable, launchCommand, splitCommandLine, type CommandLine } from "./command-line.ts";
import type { Strings } from "./i18n.ts";
import { cleanPaste, linesRun } from "./paste.ts";
import { PtyProcess } from "./pty-process.ts";
import { findLinkCandidates, type LinkCandidate } from "./vault-links.ts";
import type { Profile, Settings } from "./settings.ts";
import { fontFor, themeFor } from "./theme.ts";
import { glyphCanvases } from "./xterm-internals.ts";

/** Glyph canvases already watched for loss; terminals sharing an atlas share its canvases. */
const watchedCanvases = new WeakSet<HTMLCanvasElement>();

/** Output not yet drawn by the terminal; past HIGH the program is paused until it drops below LOW. */
const HIGH_WATER = 512 * 1024;
const LOW_WATER = 64 * 1024;
/** After Enter, output that then stops for this long counts as a finished reply. */
const QUIET_MS = 3000;
/** How long a program may stay quiet after Enter or its output and still count as working. */
const WORKING_QUIET_MS = 30_000;

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
  /** Variables added to the environment of programs started in a terminal. */
  programEnvironment(): Record<string, string>;
  /** Opens a vault file next to the terminal, or in a new tab. */
  openFile(path: string, newTab: boolean): void;
  /** Shows what a terminal program changed in a file, as a diff with a button to undo it. */
  reviewChange(change: Change): void;
  /** Shows every change in a terminal's list in one tab. */
  reviewAllChanges(): void;
  /** Asks, then undoes every change in a terminal's list. */
  undoAllChanges(): void;
  /** Called after a terminal's list of changes changed, so views showing it are redrawn. */
  changesUpdated(): void;
  /** A text file's last known contents, while a vault event for it is being handled. */
  textBefore(path: string): string | undefined;
  /** The assistants connected now, the note they are told is open, and edits awaiting approval. */
  assistants(): { names: string[]; note: string | null; waiting: number };
  /** Whether a file is being put back by undoing a change, so its events are not a program's. */
  isRestoring(path: string): boolean;
  /** The file a link points at, or null if no such file is in the vault. */
  vaultLink(link: LinkCandidate): VaultLink | null;
  /** The paths of files dropped on a terminal, ready to type, or null when nothing droppable is held. */
  dropText(data: DataTransfer | null): string | null;
  /** Makes the font of every terminal larger or smaller by `step` points, and saves it. */
  zoomFont(step: number): void;
  /** Rebuilds the WebGL renderer of every terminal, after their shared glyph canvas was lost. */
  rebuildRenderers(): void;
  /** Asks whether to paste text of this many lines into a program that would run each line. */
  confirmPaste(lines: number): Promise<boolean>;
}

export interface VaultLink {
  /** The file's path in the vault, shown when the link is hovered. */
  path: string;
  /** Opens the file next to the terminal, or in a new tab. */
  open(newTab: boolean): void;
}

export type SessionStatus = "idle" | "running" | "exited";

/** How long the pointer rests on a link before its hint shows, as in VS Code. */
const HINT_DELAY_MS = 500;

/** True for files and for the app execution aliases in WindowsApps (such as pwsh.exe). */
function isFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function environment(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.COLORTERM = "truecolor";
  // Programs start in the vault folder. Without this, cmd.exe, and with it every .cmd shim (npm's
  // call node by name), would run a node.exe or git.bat placed in the vault before the one on PATH.
  env.NoDefaultCurrentDirectoryInExePath = "1";
  return { ...env, ...extra };
}

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

export class TerminalSession {
  /** The element the terminal is drawn in; hidden while another tab is shown. */
  readonly el: HTMLElement;
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private webgl: WebglAddon | null = null;
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
  /** When the program last printed anything, and when Enter was last pressed. */
  private lastOutputAt = 0;
  private lastEnterAt = 0;
  private hintTimer: number | undefined;
  private hintEl: HTMLElement | null = null;
  private readonly search = new SearchAddon();
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
    term.loadAddon(this.search);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)));
    term.registerLinkProvider({ provideLinks: (y, callback) => callback(this.vaultLinks(y)) });
    term.open(this.el);
    this.useWebgl(term);
    term.attachCustomKeyEventHandler((event) => this.handleKey(event));
    term.onData((data) => this.input(data));
    term.onResize(() => this.schedulePtyResize());
    term.onBell(() => this.onAttention());
    term.onTitleChange((raw) => {
      const title = programTitle(raw);
      if (title === this.programTitle) return;
      this.programTitle = title;
      if (!this.disposed) this.onChange();
    });
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
    // Ctrl+wheel changes the font size, as in VS Code; captured before xterm scrolls with it.
    this.el.addEventListener("wheel", (event) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.ctx.zoomFont(event.deltaY < 0 ? 1 : -1);
    }, { capture: true, passive: false });
    this.term = term;
  }

  /** The profile this terminal runs: the one it was opened with, or the default if that was removed. */
  profile(): Profile | undefined {
    const { profiles, defaultProfile } = this.ctx.settings;
    return profiles.find((p) => p.id === this.profileId) ?? profiles.find((p) => p.id === defaultProfile);
  }

  /** A name the user gave this tab; it outlasts restarts of the program and of Obsidian. */
  customName: string | null = null;
  /** The title the running program set for itself, if it says more than the profile's name. */
  private programTitle: string | null = null;

  /** The profile's name, which the tab shows when nothing better is known. */
  get profileTitle(): string {
    const profile = this.profile();
    return profile?.name || profile?.command || this.ctx.s.untitled;
  }

  get title(): string {
    return tabTitle(this.customName, this.programTitle, this.profileTitle);
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
      t: "spawn", ...launch, cwd: this.ctx.vaultPath(), env: environment(this.ctx.programEnvironment()), cols, rows,
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

  /**
   * Whether the program may be changing files: while it shows taskbar progress, and from Enter or
   * its latest output until it has been quiet for WORKING_QUIET_MS. This is longer than the pause
   * that ends a reply and marks the tab, so a step that runs silently for a while, or output that
   * resumes after a pause, still has its changes noticed.
   */
  isWorking(): boolean {
    return this.status === "running"
      && (this.progressBusy || Date.now() - Math.max(this.lastEnterAt, this.lastOutputAt) < WORKING_QUIET_MS);
  }

  /** Whether the terminal has the keyboard. */
  hasFocus(): boolean {
    return this.term.textarea !== undefined && document.activeElement === this.term.textarea;
  }

  setAttention(value: boolean): void {
    if (this.attention === value) return;
    this.attention = value;
    if (!this.disposed) this.onChange();
  }

  /**
   * Types text into the program as a paste. Programs that turn on bracketed paste (Claude Code,
   * Copilot CLI) take it as a whole and wait for Enter; others, such as PowerShell and cmd.exe,
   * run each line as it arrives, so text with a line break, even a final one, is pasted only
   * after the user agrees, as in Windows Terminal.
   */
  paste(raw: string): void {
    if (this.status !== "running") return void this.term.focus();
    const text = cleanPaste(raw);
    const lines = linesRun(text);
    if (lines === 0 || this.term.modes.bracketedPasteMode) {
      this.term.paste(text);
      this.term.focus();
      return;
    }
    void this.ctx.confirmPaste(lines).then((ok) => {
      if (ok && this.status === "running") this.term.paste(text);
      this.term.focus();
    });
  }

  /**
   * Finds text in the output and scrollback, highlighting every match. Upward finds older output,
   * so the first search from the bottom lands on the latest match. Results arrive through
   * onFindResults.
   */
  find(text: string, upward: boolean, colors: ISearchOptions["decorations"]): void {
    if (text === "") return void this.search.clearDecorations();
    const options: ISearchOptions = { decorations: colors };
    if (upward) this.search.findPrevious(text, options);
    else this.search.findNext(text, options);
  }

  /** Called with the match count and the selected match (0-based, -1 for none) as a search changes. */
  onFindResults(listener: (index: number, count: number) => void): void {
    this.search.onDidChangeResults((event) => listener(event.resultIndex, event.resultCount));
  }

  /** Removes the highlights and the selected match. */
  endFind(): void {
    this.search.clearDecorations();
    this.term.clearSelection();
  }

  /** The selected text, to start a search with. */
  selection(): string { return this.term.getSelection(); }

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
    this.hideHint();
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
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (this.webgl === webgl) this.webgl = null;
      });
      // Fired before the renderer stores the new atlas, so it is read a moment later. The first
      // atlas comes before the addon forwards the event, so it is watched once loading is done.
      const watch = () => window.setTimeout(() => this.watchGlyphCanvas());
      webgl.onChangeTextureAtlas(watch);
      webgl.onAddTextureAtlasCanvas(watch);
      term.loadAddon(webgl);
      this.webgl = webgl;
      watch();
    } catch (error) {
      console.warn("Terminal Pane: WebGL unavailable, using the DOM renderer", error);
    }
  }

  /**
   * Chromium can drop the 2D canvases the renderer draws glyphs on (GPU reset, memory pressure),
   * and xterm.js does not recover them: every character not drawn before, such as a digit in a
   * color not used yet, then shows as blank. All terminals share them, so all are rebuilt.
   */
  private watchGlyphCanvas(): void {
    const lost = () => this.ctx.rebuildRenderers();
    for (const canvas of glyphCanvases(this.term)) {
      if (watchedCanvases.has(canvas)) continue;
      watchedCanvases.add(canvas);
      if (canvas.getContext("2d")?.isContextLost()) window.setTimeout(lost);
      else canvas.addEventListener("contextlost", lost, { once: true });
    }
  }

  /** Drops the WebGL renderer, releasing its share of the glyph atlas. */
  dropRenderer(): void {
    this.webgl?.dispose();
    this.webgl = null;
  }

  /** Starts a WebGL renderer again after dropRenderer, with a newly drawn glyph atlas. */
  restoreRenderer(): void {
    if (this.disposed || this.webgl) return;
    this.useWebgl(this.term);
    this.term.refresh(0, this.term.rows - 1);
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
      if (data.includes("\r")) {
        this.awaitingReply = true;
        this.lastEnterAt = Date.now();
      }
    } else if (this.status === "exited" && data === "\r") {
      this.term.reset();
      this.start();
    }
  }

  private output(data: string): void {
    this.lastOutputAt = Date.now();
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
    this.hideHint();
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
   * Paths and wikilinks in the output that name a file in the vault, such as the notes an assistant
   * reports having edited. Clicking one opens it in Obsidian; Ctrl+click opens it in a new tab.
   */
  private vaultLinks(y: number): ILink[] | undefined {
    const line = this.term.buffer.active.getLine(y - 1);
    if (!line) return undefined;
    // Wide characters (CJK) take two cells, so text positions are mapped back to columns.
    let text = "";
    const columns: number[] = [];
    const widths: number[] = [];
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      const width = cell?.getWidth() ?? 1;
      if (width === 0) continue;
      const chars = cell?.getChars() || " ";
      for (let i = 0; i < chars.length; i++) {
        columns.push(x);
        widths.push(width);
      }
      text += chars;
    }
    const links: ILink[] = [];
    for (const candidate of findLinkCandidates(text)) {
      const link = this.ctx.vaultLink(candidate);
      if (!link) continue;
      const last = candidate.end - 1;
      links.push({
        range: {
          start: { x: columns[candidate.start] + 1, y },
          end: { x: columns[last] + widths[last], y },
        },
        text: text.slice(candidate.start, candidate.end),
        decorations: { underline: true, pointerCursor: true },
        activate: (event) => {
          this.hideHint();
          link.open(event.ctrlKey || event.metaKey);
        },
        hover: (event) => this.showHint(event, link.path),
        leave: () => this.hideHint(),
      });
    }
    return links.length > 0 ? links : undefined;
  }

  /**
   * Says which note a link opens and how, after the pointer rests on it: the program chose the
   * text's color, so the link itself only gets an underline while hovered.
   */
  private showHint(event: MouseEvent, path: string): void {
    this.hideHint();
    const { x, y } = event;
    this.hintTimer = window.setTimeout(() => {
      const hint = document.body.createDiv({ cls: "terminal-pane-link-hint" });
      hint.createDiv({ cls: "terminal-pane-link-hint-path", text: path });
      hint.createDiv({ cls: "terminal-pane-link-hint-keys", text: this.ctx.s.linkHint });
      // Below the pointer, or above it near the bottom of the window.
      const below = y + 20 + hint.offsetHeight < window.innerHeight;
      hint.setCssProps({
        left: `${Math.max(4, Math.min(x, window.innerWidth - hint.offsetWidth - 4))}px`,
        top: `${below ? y + 20 : y - 8 - hint.offsetHeight}px`,
      });
      this.hintEl = hint;
    }, HINT_DELAY_MS);
  }

  private hideHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl?.remove();
    this.hintEl = null;
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
