import {
  type Editor, FileSystemAdapter, getLanguage, normalizePath, Notice, Platform, Plugin, type TAbstractFile, TFile, type WorkspaceLeaf,
} from "obsidian";
import { lstatSync } from "node:fs";
import { basename, join } from "node:path";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { findExecutable, quotePath } from "./command-line.ts";
import { matchesHotkey } from "./hotkeys.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { draggedVaultPaths, hotkeysFor } from "./obsidian-internals.ts";
import { confirmAction, confirmPaste } from "./paste-confirm.ts";
import type { PtyProcess } from "./pty-process.ts";
import type { SessionContext, VaultLink } from "./session.ts";
import { defaultSettings, FONT_SIZE, normalizeSettings, type Settings } from "./settings.ts";
import { TerminalSettingTab } from "./settings-tab.ts";
import { TerminalView, VIEW_TYPE } from "./view.ts";
import { type AssistantBridge, type DiffViewer, IdeBridge } from "./ide-bridge.ts";
import { CopilotBridge } from "./copilot-bridge.ts";
import type { DiffRequest } from "./ide-protocol.ts";
import type { Change } from "./changes.ts";
import { DIFF_VIEW_TYPE, DiffView, type ProposalState, type ReviewAllState, type ReviewState } from "./diff-view.ts";
import { isTextFile, TextHistory } from "./text-history.ts";
import { type LinkCandidate, toVaultPath } from "./vault-links.ts";

/** This plugin's commands, whose hotkeys always reach Obsidian while a terminal has the keyboard. */
const COMMANDS = [
  "toggle", "new-terminal", "next-terminal", "previous-terminal", "close-terminal", "insert-note-path", "find", "attach-note",
  "review-changes", "approve-edit", "reject-edit",
];

/** How long the selection must settle before Claude Code is told about it. */
const SELECTION_DELAY_MS = 150;

/** How long the font size settles after Ctrl+wheel before it is saved. */
const ZOOM_SAVE_DELAY_MS = 500;

/** How long vault events for a file being restored are not taken for a terminal program's change. */
const RESTORE_GRACE_MS = 3000;

export default class TerminalPanePlugin extends Plugin implements SessionContext {
  settings!: Settings;
  s!: Strings;
  private readonly processes = new Set<PtyProcess>();
  private profileCommands: string[] = [];
  private lastView: TerminalView | null = null;
  /** Connections for Claude Code and Copilot CLI, while the setting is on. */
  private bridges: AssistantBridge[] = [];
  /** How each diff on screen is approved or rejected, by its key. */
  private readonly diffDecisions = new Map<string, (approve: boolean) => void>();
  private selectionTimer: number | undefined;
  private zoomSaveTimer: number | undefined;
  /** The last known contents of the vault's text files. */
  private readonly texts = new TextHistory();
  /** The vault path of the note last shared with the assistants. */
  private sharedNote: string | null = null;
  /** Files being restored by undoing a change, until when. */
  private readonly restoring = new Map<string, number>();

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    await this.loadSettings();

    // Before any terminal starts, so programs get the connection's port in their environment.
    await this.applyAssistantConnections();
    this.trackSelection();
    this.rememberTexts();

    const style = document.head.createEl("style", { text: xtermCss, attr: { id: "terminal-pane-xterm-css" } });
    this.register(() => style.remove());

    this.registerView(VIEW_TYPE, (leaf) => new TerminalView(leaf, this));
    this.registerView(DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf, this.s, {
      decide: (key, approve) => this.decideDiff(key, approve),
      openFile: (path) => this.openFile(path, false),
      undo: (change) => void this.undoChange(change),
      fixLinks: (change) => void this.fixLinks(change),
      changes: () => this.changesView()?.changeList() ?? [],
      undoAll: () => this.undoAllChanges(),
    }));
    // A diff left from before a restart: Claude Code no longer waits on it.
    this.app.workspace.onLayoutReady(() => this.app.workspace.detachLeavesOfType(DIFF_VIEW_TYPE));
    const { commands } = this.s;
    this.addCommand({ id: "toggle", name: commands.toggle, callback: () => this.toggle() });
    this.addCommand({ id: "new-terminal", name: commands.newTerminal, callback: () => this.newTerminal(this.settings.defaultProfile) });
    this.addCommand({ id: "next-terminal", name: commands.next, callback: () => this.withView((view) => view.cycle(1)) });
    this.addCommand({ id: "previous-terminal", name: commands.previous, callback: () => this.withView((view) => view.cycle(-1)) });
    this.addCommand({ id: "close-terminal", name: commands.close, callback: () => this.closeTerminal() });
    this.addCommand({ id: "find", name: commands.find, callback: () => this.find() });
    this.addCommand({ id: "insert-note-path", name: commands.insertNotePath, callback: () => this.insertNotePath() });
    this.addCommand({ id: "send-selection", name: commands.sendSelection, editorCallback: (editor) => this.sendSelection(editor) });
    this.addCommand({ id: "attach-note", name: commands.attachNote, callback: () => this.attachNote() });
    this.addCommand({ id: "review-changes", name: commands.reviewChanges, callback: () => this.reviewAllChanges() });
    this.addCommand({ id: "approve-edit", name: commands.approveEdit, callback: () => this.decideLatest(true) });
    this.addCommand({ id: "reject-edit", name: commands.rejectEdit, callback: () => this.decideLatest(false) });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      if (this.connectedBridges().length > 0 && info.file) {
        menu.addItem((item) => item.setTitle(commands.attachToAssistant).setIcon("at-sign").onClick(() => this.attach(info.file!, editor)));
      }
      if (!editor.somethingSelected()) return;
      menu.addItem((item) => item.setTitle(commands.sendSelection).setIcon("square-terminal").onClick(() => this.sendSelection(editor)));
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || this.connectedBridges().length === 0) return;
      menu.addItem((item) => item.setTitle(commands.attachToAssistant).setIcon("at-sign").onClick(() => this.attach(file)));
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
    if (this.zoomSaveTimer !== undefined) {
      // A size set with Ctrl+wheel just before unloading is not lost.
      window.clearTimeout(this.zoomSaveTimer);
      void this.saveData(this.settings);
    }
    this.stopBridges();
  }

  /**
   * Starts or stops the connections Claude Code and Copilot CLI use to see the open note and show
   * their edits, following the setting. One that fails to start is left out; the other still runs.
   */
  async applyAssistantConnections(): Promise<void> {
    if (!this.settings.connectAssistants) return this.stopBridges();
    if (this.bridges.length > 0) return;
    const viewer: DiffViewer = {
      show: (key, request, assistant, decide) => {
        this.diffDecisions.set(key, decide);
        this.renderAssistants();
        void this.showDiff(key, request, assistant);
      },
      close: (key) => {
        this.diffDecisions.delete(key);
        this.renderAssistants();
        this.diffLeaf(key)?.detach();
      },
    };
    const changed = () => this.renderAssistants();
    const candidates: AssistantBridge[] = [
      new IdeBridge(this.vaultPath(), this.manifest.version, viewer, changed),
      new CopilotBridge(this.vaultPath(), this.manifest.version, viewer, changed),
    ];
    for (const bridge of candidates) {
      try {
        await bridge.start();
        this.bridges.push(bridge);
      } catch (error) {
        bridge.stop();
        console.warn(`Terminal Pane: could not start the ${bridge.name} connection`, error);
      }
    }
    this.shareSelection();
  }

  /** Approves or rejects the newest edit still waiting, as its diff tab's buttons would. */
  private decideLatest(approve: boolean): void {
    const key = [...this.diffDecisions.keys()].pop();
    if (key === undefined) {
      new Notice(this.s.diff.nothingWaiting);
      return;
    }
    this.decideDiff(key, approve);
  }

  /** Approves or rejects an edit from its diff tab, then gives the keyboard back to the terminal. */
  private decideDiff(key: string, approve: boolean): void {
    const decide = this.diffDecisions.get(key);
    this.diffDecisions.delete(key);
    this.renderAssistants();
    if (!decide) return;
    decide(approve);
    const terminal = this.lastView?.leaf;
    if (terminal) {
      this.app.workspace.setActiveLeaf(terminal, { focus: true });
      this.lastView?.focusActive();
    }
  }

  private stopBridges(): void {
    const bridges = this.bridges;
    this.bridges = [];
    for (const bridge of bridges) bridge.stop();
    this.renderAssistants();
  }

  private connectedBridges(): AssistantBridge[] {
    return this.bridges.filter((bridge) => bridge.connected());
  }

  /** Adds the open note, or the selected lines of it, to the prompt being typed in the terminal. */
  private attachNote(): void {
    const active = this.app.workspace.activeEditor;
    const file = active?.file ?? this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(this.s.assistants.noNote);
      return;
    }
    this.attach(file, active?.editor);
  }

  /**
   * Adds a file to the prompt of each connected assistant, as @path, with the selected lines when
   * an editor has a selection. The keyboard goes back to the terminal to go on typing.
   */
  private attach(file: TFile, editor?: Editor): void {
    const bridges = this.connectedBridges();
    if (bridges.length === 0) {
      new Notice(this.s.assistants.none);
      return;
    }
    const filePath = join(this.vaultPath(), file.path);
    const lines = editor?.somethingSelected()
      ? { start: editor.getCursor("from").line, end: editor.getCursor("to").line }
      : undefined;
    for (const bridge of bridges) bridge.mention({ filePath, lines });
    const terminal = this.lastView?.leaf;
    if (terminal) {
      this.app.workspace.setActiveLeaf(terminal, { focus: true });
      this.lastView?.focusActive();
    }
  }

  /**
   * The assistants with a session connected now, the note they are told is open, and how many
   * edits they are waiting to have approved.
   */
  assistants(): { names: string[]; note: string | null; waiting: number } {
    return {
      names: this.bridges.filter((bridge) => bridge.connected()).map((bridge) => bridge.name),
      note: this.sharedNote,
      waiting: this.diffDecisions.size,
    };
  }

  private renderAssistants(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TerminalView) leaf.view.renderAssistants();
    }
  }

  /**
   * Shows an edit Claude Code or Copilot CLI proposes next to the terminal, and gives the keyboard
   * back to the terminal, where the edit can be approved or rejected as well as in the diff.
   */
  private async showDiff(key: string, request: DiffRequest, assistant: string): Promise<void> {
    const { workspace } = this.app;
    const terminal = this.lastView?.leaf ?? null;
    const leaf = this.diffLeaf(key) ?? this.leafBesideTerminal();
    const root = this.vaultPath().replace(/[\\/]+$/, "");
    const inVault = request.path.toLowerCase().startsWith(root.toLowerCase()) && /^[\\/]/.test(request.path.slice(root.length));
    const label = inVault ? request.path.slice(root.length + 1).replace(/\\/g, "/") : request.path;
    const state: ProposalState = { kind: "proposal", key, assistant, path: request.path, label, contents: request.contents };
    await leaf.setViewState({ type: DIFF_VIEW_TYPE, active: false, state: { ...state } });
    await workspace.revealLeaf(leaf);
    if (terminal) {
      workspace.setActiveLeaf(terminal, { focus: true });
      this.lastView?.focusActive();
    }
  }

  /** A new tab beside the terminal when it is in the main area, or else a new tab there. */
  private leafBesideTerminal(): WorkspaceLeaf {
    const { workspace } = this.app;
    const terminal = this.lastView?.leaf ?? null;
    return terminal && terminal.getRoot() === workspace.rootSplit
      ? workspace.createLeafBySplit(terminal, "vertical")
      : workspace.getLeaf("tab");
  }

  private reviewLeaves(): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType(DIFF_VIEW_TYPE).filter((leaf) => leaf.view instanceof DiffView && leaf.view.isReview);
  }

  /** Shows what a terminal program changed in a file, in the one tab kept for this. */
  reviewChange(change: Change): void {
    void (async () => {
      const leaf = this.reviewLeaves()[0] ?? this.leafBesideTerminal();
      const state: ReviewState = { kind: "review", change };
      await leaf.setViewState({ type: DIFF_VIEW_TYPE, active: true, state: { ...state } });
      await this.app.workspace.revealLeaf(leaf);
    })();
  }

  reviewAllChanges(): void {
    void (async () => {
      const leaf = this.reviewLeaves()[0] ?? this.leafBesideTerminal();
      const state: ReviewAllState = { kind: "review-all" };
      await leaf.setViewState({ type: DIFF_VIEW_TYPE, active: true, state: { ...state } });
      await this.app.workspace.revealLeaf(leaf);
    })();
  }

  changesUpdated(): void {
    for (const leaf of this.reviewLeaves()) if (leaf.view instanceof DiffView) leaf.view.refresh();
  }

  undoAllChanges(): void {
    void this.undoAll();
  }

  /**
   * Asks, then undoes every change in the terminal's list. A change can wait on another, as when
   * two files swapped names, so passes repeat while any change still goes back.
   */
  private async undoAll(): Promise<void> {
    const view = this.changesView();
    const pending = (view?.changeList() ?? []).filter((change) => change.before !== undefined);
    if (!view || pending.length === 0) return;
    const r = this.s.review;
    const ok = await confirmAction(this.app, {
      title: r.confirmAllTitle(pending.length), desc: r.confirmAll, confirm: r.confirm, cancel: r.cancel, warning: true,
    });
    if (!ok) return;
    let done = 0;
    let progress = true;
    while (pending.length > 0 && progress) {
      progress = false;
      for (const change of [...pending]) {
        if (!(await this.restore(change))) continue;
        pending.splice(pending.indexOf(change), 1);
        view.forgetChange(change.path);
        done++;
        progress = true;
      }
    }
    new Notice(pending.length === 0 ? r.undoneAll(done) : r.undoneSome(done, pending.length), pending.length === 0 ? 4000 : 8000);
  }

  textBefore(path: string): string | undefined {
    return this.texts.get(path);
  }

  isRestoring(path: string): boolean {
    return (this.restoring.get(path) ?? 0) > Date.now();
  }

  /**
   * Keeps the last known contents of the vault's text files, so that a change a terminal program
   * makes can be compared with what was there before. Terminal views read them while handling the
   * same vault event, so they are updated only after that: on a later tick.
   */
  private rememberTexts(): void {
    const { vault, workspace } = this.app;
    const remember = async (file: TAbstractFile) => {
      if (!(file instanceof TFile) || !isTextFile(file.extension)) return;
      try {
        this.texts.set(file.path, await vault.read(file));
      } catch {
        this.texts.delete(file.path);
      }
    };
    workspace.onLayoutReady(async () => {
      for (const file of vault.getFiles()) await remember(file);
    });
    // Obsidian reports every file as created while it loads the vault; those are read above.
    this.registerEvent(vault.on("create", (file) => {
      if (workspace.layoutReady) void remember(file);
    }));
    this.registerEvent(vault.on("modify", (file) => void remember(file)));
    this.registerEvent(vault.on("delete", (file) => window.setTimeout(() => this.texts.delete(file.path))));
    this.registerEvent(vault.on("rename", (file, oldPath) => window.setTimeout(() => this.texts.rename(oldPath, file.path))));
  }

  /** Asks, then puts a file back as it was before a terminal program changed it. */
  private async undoChange(change: Change): Promise<void> {
    const r = this.s.review;
    const name = basename(change.path);
    const desc = change.kind === "created" ? r.confirmCreated
      : change.kind === "deleted" ? r.confirmDeleted
      : change.kind === "renamed" && change.from ? r.confirmRenamed(change.from)
      : r.confirmModified;
    const ok = await confirmAction(this.app, { title: r.confirmTitle(name), desc, confirm: r.confirm, cancel: r.cancel, warning: true });
    if (!ok) return;
    const restored = await this.restore(change);
    new Notice(restored ? r.undone(name) : r.undoFailed(name));
    if (!restored) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TerminalView) leaf.view.forgetChange(change.path);
    }
    // A tab showing only this change has nothing left to show; one showing all of them redraws.
    for (const leaf of this.reviewLeaves()) if (leaf.view instanceof DiffView && !leaf.view.isReviewAll) leaf.detach();
  }

  /**
   * Points links to a file a program moved, which still name its old path, at the new one: the
   * file goes back to the old path unseen and is moved again the way Obsidian moves files.
   */
  private async fixLinks(change: Change): Promise<void> {
    const { vault, fileManager } = this.app;
    const r = this.s.review;
    const name = basename(change.path);
    const file = vault.getFileByPath(change.path);
    if (!file || !change.from || vault.getAbstractFileByPath(change.from)) {
      new Notice(r.linksFixFailed(name));
      return;
    }
    for (const path of [change.path, change.from]) this.restoring.set(path, Date.now() + RESTORE_GRACE_MS);
    try {
      await vault.rename(file, change.from);
      await fileManager.renameFile(file, change.path);
      new Notice(r.linksFixed(name));
    } catch (error) {
      console.warn("Terminal Pane: could not update links", error);
      // Put the file back where the program left it. Links already updated name that path, so
      // they keep working; the rest stay as broken as before.
      if (file.path !== change.path) {
        try {
          await vault.rename(file, change.path);
        } catch (rollback) {
          console.warn("Terminal Pane: could not move the file back", rollback);
        }
      }
      new Notice(file.path === change.path ? r.linksFixUndone(name) : r.linksFixStranded(name, file.path));
    }
  }

  private async restore(change: Change): Promise<boolean> {
    const { vault, fileManager } = this.app;
    const before = change.before;
    if (before === undefined) return false;
    for (const path of [change.path, change.from]) {
      if (path) this.restoring.set(path, Date.now() + RESTORE_GRACE_MS);
    }
    const file = vault.getFileByPath(change.path);
    try {
      switch (change.kind) {
        case "created":
          if (file) await fileManager.trashFile(file);
          return true;
        case "modified":
          if (!file) return false;
          await vault.modify(file, before);
          return true;
        case "deleted": {
          if (vault.getAbstractFileByPath(change.path)) return false;
          const folder = change.path.split("/").slice(0, -1).join("/");
          if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
          await vault.create(change.path, before);
          return true;
        }
        case "renamed":
          if (!file || !change.from || vault.getAbstractFileByPath(change.from)) return false;
          // Through the file manager, so links to the file follow it back.
          await fileManager.renameFile(file, change.from);
          if ((await vault.read(file)) !== before) await vault.modify(file, before);
          return true;
      }
    } catch (error) {
      console.warn("Terminal Pane: could not undo a change", error);
      return false;
    }
  }

  private diffLeaf(key: string): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType(DIFF_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof DiffView && leaf.view.diffKey === key) ?? null;
  }

  /**
   * Follows the open note and its selection. Nothing is sent while the terminal or another view
   * without a file is in front, so the assistants keep the note last looked at.
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
    if (this.bridges.length === 0) return;
    const { workspace } = this.app;
    const active = workspace.activeEditor;
    const file = active?.file ?? workspace.getActiveFile();
    if (!file) return;
    if (this.sharedNote !== file.path) {
      this.sharedNote = file.path;
      this.renderAssistants();
    }
    const filePath = join(this.vaultPath(), file.path);
    const editor = active?.editor;
    if (!editor) {
      for (const bridge of this.bridges) {
        bridge.setSelection({ filePath, text: "", start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
      }
      return;
    }
    const { anchor, head } = editor.listSelections()[0] ?? { anchor: editor.getCursor(), head: editor.getCursor() };
    const [from, to] = anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch) ? [anchor, head] : [head, anchor];
    const selection = {
      filePath,
      text: editor.getSelection(),
      start: { line: from.line, character: from.ch },
      end: { line: to.line, character: to.ch },
    };
    for (const bridge of this.bridges) bridge.setSelection(selection);
  }

  async loadSettings(): Promise<void> {
    const shell = this.onPath("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
    this.settings = normalizeSettings(await this.loadData(), defaultSettings(shell, this.s.commandPrompt));
  }

  zoomFont(step: number): void {
    const size = Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, this.settings.fontSize + step));
    if (size === this.settings.fontSize) return;
    this.settings.fontSize = size;
    for (const view of this.views()) view.applyAppearance();
    // Saved once the wheel stops, not on every notch.
    window.clearTimeout(this.zoomSaveTimer);
    this.zoomSaveTimer = window.setTimeout(() => void this.saveData(this.settings), ZOOM_SAVE_DELAY_MS);
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
    return Object.assign({}, ...this.bridges.map((bridge) => bridge.environment()));
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

  /**
   * The pane whose list of changes is meant: the one used last, or else any open one, as after a
   * reload before a terminal has had the keyboard.
   */
  private changesView(): TerminalView | null {
    const views = this.views();
    if (this.lastView && views.includes(this.lastView)) return this.lastView;
    return views[0] ?? null;
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
