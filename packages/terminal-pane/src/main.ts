import { FileSystemAdapter, getLanguage, normalizePath, Notice, Platform, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { findExecutable, quotePath } from "./command-line.ts";
import { matchesHotkey } from "./hotkeys.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { hotkeysFor } from "./obsidian-internals.ts";
import { confirmPaste } from "./paste-confirm.ts";
import type { PtyProcess } from "./pty-process.ts";
import type { SessionContext, VaultLink } from "./session.ts";
import { defaultSettings, normalizeSettings, type Settings } from "./settings.ts";
import { TerminalSettingTab } from "./settings-tab.ts";
import { TerminalView, VIEW_TYPE } from "./view.ts";
import { type LinkCandidate, toVaultPath } from "./vault-links.ts";

/** This plugin's commands, whose hotkeys always reach Obsidian while a terminal has the keyboard. */
const COMMANDS = ["toggle", "new-terminal", "next-terminal", "previous-terminal", "close-terminal", "insert-note-path"];

export default class TerminalPanePlugin extends Plugin implements SessionContext {
  settings!: Settings;
  s!: Strings;
  private readonly processes = new Set<PtyProcess>();
  private profileCommands: string[] = [];
  private lastView: TerminalView | null = null;

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    await this.loadSettings();

    const style = document.head.createEl("style", { text: xtermCss, attr: { id: "terminal-pane-xterm-css" } });
    this.register(() => style.remove());

    this.registerView(VIEW_TYPE, (leaf) => new TerminalView(leaf, this));
    const { commands } = this.s;
    this.addCommand({ id: "toggle", name: commands.toggle, callback: () => this.toggle() });
    this.addCommand({ id: "new-terminal", name: commands.newTerminal, callback: () => this.newTerminal(this.settings.defaultProfile) });
    this.addCommand({ id: "next-terminal", name: commands.next, callback: () => this.withView((view) => view.cycle(1)) });
    this.addCommand({ id: "previous-terminal", name: commands.previous, callback: () => this.withView((view) => view.cycle(-1)) });
    this.addCommand({ id: "close-terminal", name: commands.close, callback: () => this.closeTerminal() });
    this.addCommand({ id: "insert-note-path", name: commands.insertNotePath, callback: () => this.insertNotePath() });
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
    const view = await this.findView();
    const session = view?.activeSession();
    if (!view || !session) return void new Notice(this.s.noTerminal);
    await this.reveal(view);
    const text = quotePath(file.path);
    if (text === null) return void new Notice(this.s.unsafePath(file.path));
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

  /** Opens a file next to the terminal, never in the terminal's own tab. */
  private async openInWorkspace(file: TFile, newTab: boolean): Promise<void> {
    const { workspace } = this.app;
    let leaf = newTab ? null : workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf || leaf.view instanceof TerminalView || leaf.getViewState().pinned) leaf = workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }

  confirmPaste(lines: number): Promise<boolean> {
    return confirmPaste(this.app, this.s, lines);
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
