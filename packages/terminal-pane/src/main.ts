import { type Editor, FileSystemAdapter, getLanguage, normalizePath, Notice, Platform, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { findExecutable, quotePath } from "./command-line.ts";
import { matchesHotkey } from "./hotkeys.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { draggedVaultPaths, hotkeysFor } from "./obsidian-internals.ts";
import { confirmPaste } from "./paste-confirm.ts";
import type { PtyProcess } from "./pty-process.ts";
import type { SessionContext, VaultLink } from "./session.ts";
import { defaultSettings, normalizeSettings, type Settings } from "./settings.ts";
import { TerminalSettingTab } from "./settings-tab.ts";
import { TerminalView, VIEW_TYPE } from "./view.ts";
import { IdeBridge } from "./ide-bridge.ts";
import { type LinkCandidate, toVaultPath } from "./vault-links.ts";

/** This plugin's commands, whose hotkeys always reach Obsidian while a terminal has the keyboard. */
const COMMANDS = ["toggle", "new-terminal", "next-terminal", "previous-terminal", "close-terminal", "insert-note-path", "find"];

/** How long the selection must settle before Claude Code is told about it. */
const SELECTION_DELAY_MS = 150;

export default class TerminalPanePlugin extends Plugin implements SessionContext {
  settings!: Settings;
  s!: Strings;
  private readonly processes = new Set<PtyProcess>();
  private profileCommands: string[] = [];
  private lastView: TerminalView | null = null;
  private bridge: IdeBridge | null = null;
  private selectionTimer: number | undefined;

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    await this.loadSettings();

    // Before any terminal starts, so programs get the bridge's port in their environment.
    await this.applyClaudeSharing();
    this.trackSelection();

    const style = document.head.createEl("style", { text: xtermCss, attr: { id: "terminal-pane-xterm-css" } });
    this.register(() => style.remove());

    this.registerView(VIEW_TYPE, (leaf) => new TerminalView(leaf, this));
    const { commands } = this.s;
    this.addCommand({ id: "toggle", name: commands.toggle, callback: () => this.toggle() });
    this.addCommand({ id: "new-terminal", name: commands.newTerminal, callback: () => this.newTerminal(this.settings.defaultProfile) });
    this.addCommand({ id: "next-terminal", name: commands.next, callback: () => this.withView((view) => view.cycle(1)) });
    this.addCommand({ id: "previous-terminal", name: commands.previous, callback: () => this.withView((view) => view.cycle(-1)) });
    this.addCommand({ id: "close-terminal", name: commands.close, callback: () => this.closeTerminal() });
    this.addCommand({ id: "find", name: commands.find, callback: () => this.find() });
    this.addCommand({ id: "insert-note-path", name: commands.insertNotePath, callback: () => this.insertNotePath() });
    this.addCommand({ id: "send-selection", name: commands.sendSelection, editorCallback: (editor) => this.sendSelection(editor) });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.somethingSelected()) return;
      menu.addItem((item) => item.setTitle(commands.sendSelection).setIcon("square-terminal").onClick(() => this.sendSelection(editor)));
    }));
    this.registerProfileCommands();
    this.addSettingTab(new TerminalSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof TerminalView) this.lastView = leaf.view;
    }));
  }

  onunload(): void {
    // Views close themselves and stop their programs; this catches any left over.
    for (const proc of this.processes) proc.kill();
    this.processes.clear();
    window.clearTimeout(this.selectionTimer);
    this.bridge?.stop();
    this.bridge = null;
  }

  /** Starts or stops the connection Claude Code uses to see the open note, following the setting. */
  async applyClaudeSharing(): Promise<void> {
    if (!this.settings.shareWithClaude) {
      this.bridge?.stop();
      this.bridge = null;
      return;
    }
    if (this.bridge) return;
    const bridge = new IdeBridge(this.vaultPath(), this.manifest.version);
    try {
      await bridge.start();
    } catch (error) {
      bridge.stop();
      console.warn("Terminal Pane: could not start the Claude Code connection", error);
      return;
    }
    this.bridge = bridge;
    this.shareSelection();
  }

  /**
   * Follows the open note and its selection. Nothing is sent while the terminal or another view
   * without a file is in front, so Claude Code keeps the note last looked at.
   */
  private trackSelection(): void {
    const schedule = () => {
      window.clearTimeout(this.selectionTimer);
      this.selectionTimer = window.setTimeout(() => this.shareSelection(), SELECTION_DELAY_MS);
    };
    this.registerDomEvent(document, "selectionchange", schedule);
    this.registerEvent(this.app.workspace.on("active-leaf-change", schedule));
    this.registerEvent(this.app.workspace.on("file-open", schedule));
  }

  private shareSelection(): void {
    const bridge = this.bridge;
    if (!bridge) return;
    const { workspace } = this.app;
    const active = workspace.activeEditor;
    const file = active?.file ?? workspace.getActiveFile();
    if (!file) return;
    const filePath = join(this.vaultPath(), file.path);
    const editor = active?.editor;
    if (!editor) {
      bridge.setSelection({ filePath, text: "", start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
      return;
    }
    const { anchor, head } = editor.listSelections()[0] ?? { anchor: editor.getCursor(), head: editor.getCursor() };
    const [from, to] = anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch) ? [anchor, head] : [head, anchor];
    bridge.setSelection({
      filePath,
      text: editor.getSelection(),
      start: { line: from.line, character: from.ch },
      end: { line: to.line, character: to.ch },
    });
  }

  async loadSettings(): Promise<void> {
    const shell = this.onPath("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
    this.settings = normalizeSettings(await this.loadData(), defaultSettings(shell, this.s.commandPrompt));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const view of this.views()) view.applyAppearance();
  }

  /** One "Open terminal: <name>" command per profile; re-run after profiles change. */
  registerProfileCommands(): void {
    for (const id of this.profileCommands) this.removeCommand(id);
    this.profileCommands = this.settings.profiles.map((profile) => {
      const id = `open-${profile.id}`;
      this.addCommand({
        id,
        name: this.s.commands.openProfile(profile.name || profile.command || profile.id),
        callback: () => this.openProfile(profile.id),
      });
      return id;
    });
  }

  // SessionContext

  vaultPath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : process.cwd();
  }

  hostScript(): string {
    return join(this.vaultPath(), this.manifest.dir ?? join(this.app.vault.configDir, "plugins", this.manifest.id), "pty-host.js");
  }

  /** True for the hotkeys of this plugin's commands and of the Obsidian commands chosen in the settings. */
  passToObsidian(event: KeyboardEvent): boolean {
    return [...this.ownCommandIds(), ...this.settings.obsidianCommands].some((id) =>
      hotkeysFor(this.app, id).some((hotkey) => matchesHotkey(hotkey, event, Platform.isMacOS)));
  }

  /** The ids of this plugin's own commands, which always reach Obsidian. */
  ownCommandIds(): string[] {
    return [...COMMANDS, ...this.profileCommands].map((command) => `${this.manifest.id}:${command}`);
  }

  track(proc: PtyProcess): () => void {
    this.processes.add(proc);
    return () => this.processes.delete(proc);
  }

  // Commands

  /**
   * Like VS Code's Ctrl+`: from a focused terminal, go back to the note (collapsing the right
   * sidebar if the terminal is there); otherwise show the terminal pane, opening it if needed.
   */
  private async toggle(): Promise<void> {
    const { workspace } = this.app;
    const active = workspace.getActiveViewOfType(TerminalView);
    if (active && active.containerEl.contains(document.activeElement)) {
      if (active.leaf.getRoot() === workspace.rightSplit) workspace.rightSplit.collapse();
      const note = workspace.getMostRecentLeaf(workspace.rootSplit);
      if (note && note !== active.leaf) workspace.setActiveLeaf(note, { focus: true });
      return;
    }
    const view = await this.findView();
    if (view) await this.reveal(view);
    else await this.createView(this.settings.defaultProfile);
  }

  /** Adds a tab to the terminal pane, opening the pane if there is none. */
  private async newTerminal(profileId: string): Promise<void> {
    const view = await this.findView();
    if (!view) return this.createView(profileId);
    await this.reveal(view);
    view.add(profileId);
  }

  /** Shows the tab already running the profile, or opens one. */
  private async openProfile(profileId: string): Promise<void> {
    for (const view of await this.loadedViews()) {
      const session = view.findSession(profileId);
      if (session) {
        await this.reveal(view);
        view.activate(session);
        return;
      }
    }
    await this.newTerminal(profileId);
  }

  private async closeTerminal(): Promise<void> {
    const view = await this.findView();
    const session = view?.activeSession();
    if (view && session) view.close(session);
  }

  private async insertNotePath(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return void new Notice(this.s.noNote);
    const text = quotePath(file.path);
    if (text === null) return void new Notice(this.s.unsafePath(file.path));
    await this.sendToTerminal(text);
  }

  /** The selection, or the line the cursor is on, typed into the terminal without pressing Enter. */
  private async sendSelection(editor: Editor): Promise<void> {
    const selected = editor.somethingSelected() ? editor.getSelection() : editor.getLine(editor.getCursor().line);
    // A final line break would act as Enter.
    const text = selected.replace(/[\r\n]+$/, "");
    if (text.trim() === "") return;
    await this.sendToTerminal(text);
  }

  /** Types text into the terminal used last, as a paste, and moves the keyboard there. */
  private async sendToTerminal(text: string): Promise<void> {
    const view = await this.findView();
    const session = view?.activeSession();
    if (!view || !session) return void new Notice(this.s.noTerminal);
    await this.reveal(view);
    session.paste(text);
  }

  vaultLink(link: LinkCandidate): VaultLink | null {
    const file = this.linkedFile(link);
    if (!file) return null;
    return { path: file.path, open: (newTab) => void this.openInWorkspace(file, newTab) };
  }

  /**
   * A path names a file by its place in the vault. Failing that, a relative one is looked up the
   * way Obsidian resolves a link, so a bare file name such as 00_Index.md, or a path relative to a
   * folder the program works in, still finds its note when the vault has one by that name.
   */
  private linkedFile(link: LinkCandidate): TFile | null {
    const { metadataCache, vault } = this.app;
    if (link.kind === "wikilink") return metadataCache.getFirstLinkpathDest(link.target, "");
    const path = toVaultPath(link.target, this.vaultPath());
    if (path === null) return null;
    const exact = vault.getAbstractFileByPath(normalizePath(path));
    if (exact instanceof TFile) return exact;
    if (/^[a-z]:[\\/]|^[\\/]/i.test(link.target)) return null;
    return metadataCache.getFirstLinkpathDest(normalizePath(path), "");
  }

  programEnvironment(): Record<string, string> {
    return this.bridge?.environment() ?? {};
  }

  openFile(path: string, newTab: boolean): void {
    const file = this.app.vault.getFileByPath(path);
    if (file) void this.openInWorkspace(file, newTab);
  }

  /** Opens a file next to the terminal, never in the terminal's own tab. */
  private async openInWorkspace(file: TFile, newTab: boolean): Promise<void> {
    const { workspace } = this.app;
    let leaf = newTab ? null : workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf || leaf.view instanceof TerminalView || leaf.getViewState().pinned) leaf = workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }

  /**
   * Paths for files dropped on a terminal, ready to type: relative to the vault for files dragged
   * from Obsidian (programs start in the vault folder), absolute for files from Windows Explorer.
   * Null when the drop holds no files.
   */
  dropText(data: DataTransfer | null): string | null {
    const fromVault = draggedVaultPaths(this.app);
    const paths = fromVault ?? Array.from(data?.files ?? []).map((file) => this.pathOfFile(file)).filter((p) => p !== "");
    if (paths.length === 0) return null;
    const quoted: string[] = [];
    for (const path of paths) {
      const text = quotePath(path);
      if (text === null) new Notice(this.s.unsafePath(path));
      else quoted.push(text);
    }
    return quoted.join(" ");
  }

  confirmPaste(lines: number): Promise<boolean> {
    return confirmPaste(this.app, this.s, lines);
  }

  private pathOfFile(file: File): string {
    try {
      const electron = window.require?.("electron") as { webUtils?: { getPathForFile(file: File): string } } | undefined;
      return electron?.webUtils?.getPathForFile(file) ?? (file as File & { path?: string }).path ?? "";
    } catch {
      return (file as File & { path?: string }).path ?? "";
    }
  }

  /** Opens the search bar of the terminal used last. */
  private async find(): Promise<void> {
    const view = await this.findView();
    if (!view) return void new Notice(this.s.noTerminal);
    await this.reveal(view);
    view.openFind();
  }

  private async withView(action: (view: TerminalView) => void): Promise<void> {
    const view = await this.findView();
    if (view) action(view);
  }

  // Panes

  private async createView(profileId: string): Promise<void> {
    const { workspace } = this.app;
    const leaf: WorkspaceLeaf | null = this.settings.location === "tab" ? workspace.getLeaf("tab") : workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { sessions: [profileId], active: 0 } });
    if (leaf.view instanceof TerminalView) await this.reveal(leaf.view);
  }

  private async reveal(view: TerminalView): Promise<void> {
    await this.app.workspace.revealLeaf(view.leaf);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    view.focusActive();
  }

  /** The pane used last, or any open one. */
  private async findView(): Promise<TerminalView | null> {
    const views = await this.loadedViews();
    if (this.lastView && views.includes(this.lastView)) return this.lastView;
    return views[0] ?? null;
  }

  /** Every terminal pane, loading any that Obsidian has deferred since startup. */
  private async loadedViews(): Promise<TerminalView[]> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    await Promise.all(leaves.map((leaf) => leaf.loadIfDeferred()));
    return this.views();
  }

  private views(): TerminalView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is TerminalView => view instanceof TerminalView);
  }

  private onPath(file: string): boolean {
    return findExecutable(file, {
      path: process.env.PATH ?? "",
      pathext: process.env.PATHEXT ?? "",
      cwd: this.vaultPath(),
      isFile: (p) => { try { lstatSync(p); return true; } catch { return false; } },
    }) !== null;
  }
}
