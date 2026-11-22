// The terminal pane: a row of tabs, one TerminalSession per tab.
import { ItemView, Menu, Scope, setIcon, setTooltip, TFile, type TAbstractFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { type BrokenLinks, brokenLinksTo, totalBroken } from "./broken-links.ts";
import { type Change, ChangeList } from "./changes.ts";
import { tabHeaderEl } from "./obsidian-internals.ts";
import { askText } from "./paste-confirm.ts";
import { type SessionContext, TerminalSession } from "./session.ts";
import { dropsBefore, moveBefore } from "./tab-order.ts";
import { searchColorsFor } from "./theme.ts";

export const VIEW_TYPE = "terminal-pane";

/** The drag data type of a tab being moved within the row. */
const TAB_DRAG_TYPE = "application/x-terminal-pane-tab";

/** A note saved this soon after typing in it is taken to be the editor's own save. */
const TYPING_GRACE_MS = 5000;

const CHANGE_ICONS: Record<Change["kind"], string> = {
  created: "file-plus",
  modified: "file-pen-line",
  renamed: "file-symlink",
  deleted: "file-x",
};

/** The Obsidian window, through Electron's remote module; undefined where that is unavailable. */
function obsidianWindow(): { flashFrame(flag: boolean): void } | undefined {
  try {
    return (window.require?.("electron") as { remote?: { getCurrentWindow(): { flashFrame(flag: boolean): void } } })
      ?.remote?.getCurrentWindow();
  } catch {
    return undefined;
  }
}

/**
 * Panes that set the taskbar button flashing and still carry a mark. The button is shared by every
 * pane in the window, so it stops only once none is left.
 */
const flashingPanes = new Set<object>();

function stopFlashing(pane: object): void {
  if (!flashingPanes.delete(pane) || flashingPanes.size > 0) return;
  obsidianWindow()?.flashFrame(false);
}

/** What the view saves in the workspace layout, so its tabs come back after a restart. */
interface SavedState {
  sessions: string[];
  active: number;
  /** Names the user gave the tabs, in the same order; null where none was given. */
  names?: (string | null)[];
}

function readState(state: unknown): SavedState | null {
  const raw = state as { sessions?: unknown; active?: unknown; names?: unknown } | null;
  if (!Array.isArray(raw?.sessions)) return null;
  const sessions = raw.sessions.filter((id): id is string => typeof id === "string");
  const names = Array.isArray(raw.names) ? raw.names.map((n) => (typeof n === "string" && n !== "" ? n : null)) : [];
  return { sessions, active: typeof raw.active === "number" ? raw.active : 0, names };
}

export class TerminalView extends ItemView {
  navigation = false;
  private sessions: TerminalSession[] = [];
  private current: TerminalSession | null = null;
  private tabsEl: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private findEl: HTMLElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private findCount: HTMLElement | null = null;
  private readonly changes = new ChangeList();
  private changesButton: HTMLElement | null = null;
  private assistantsEl: HTMLElement | null = null;
  /** When each note was last typed in, so the editor's own saves are not taken for a program's. */
  private readonly typedAt = new Map<string, number>();
  /** Set once the first tabs exist, from the saved state or, failing that, the default profile. */
  private populated = false;
  /** The tab being dragged to a new place in the row, while it is. */
  private dragged: TerminalSession | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly ctx: SessionContext) {
    super(leaf);
    // Obsidian reads keys before the page does and hands them to the active view's scope. A value
    // other than undefined or false ends the lookup there without preventDefault, so the key
    // reaches the terminal instead of a hotkey (Ctrl+P, Ctrl+W, Esc, ...). Undefined falls through
    // to Obsidian's own scope, which runs this plugin's hotkeys.
    this.scope = new Scope(this.app.scope);
    this.scope.register(null, null, (event) => (this.ctx.passToObsidian(event) ? undefined : true));
  }

  getViewType(): string { return VIEW_TYPE; }
  getIcon(): string { return "square-terminal"; }
  getDisplayText(): string { return this.ctx.s.untitled; }

  getState(): Record<string, unknown> {
    const state: SavedState = {
      sessions: this.sessions.map((session) => session.profileId),
      active: this.current ? this.sessions.indexOf(this.current) : 0,
      names: this.sessions.map((session) => session.customName),
    };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = readState(state);
    if (saved && saved.sessions.length > 0 && this.body && !this.populated) {
      this.populated = true;
      saved.sessions.forEach((id, i) => {
        const session = this.add(id, false);
        if (session) session.customName = saved.names?.[i] ?? null;
      });
      this.activate(this.sessions[Math.min(Math.max(saved.active, 0), this.sessions.length - 1)]);
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("terminal-pane-view");
    this.applyTitleBar();
    const bar = this.contentEl.createDiv({ cls: "terminal-pane-bar" });
    this.tabsEl = bar.createDiv({ cls: "terminal-pane-tabs", attr: { role: "tablist" } });
    this.handleTabDrops(this.tabsEl);
    const actions = bar.createDiv({ cls: "terminal-pane-actions" });
    this.assistantsEl = actions.createDiv({ cls: "terminal-pane-assistants" });
    setIcon(this.assistantsEl.createSpan({ cls: "terminal-pane-assistants-icon" }), "plug-zap");
    this.assistantsEl.createSpan({ cls: "terminal-pane-assistants-names" });
    this.renderAssistants();
    this.changesButton = this.button(actions, "file-diff", "", (event) => this.changesMenu(event));
    this.changesButton.addClass("terminal-pane-changes");
    this.changesButton.createSpan({ cls: "terminal-pane-changes-count" });
    this.renderChanges();
    this.button(actions, "plus", this.ctx.s.tabs.newTerminal, () => this.add(this.ctx.settings.defaultProfile));
    this.button(actions, "chevron-down", this.ctx.s.tabs.chooseProfile, (event) => this.profileMenu(event));
    this.body = this.contentEl.createDiv({ cls: "terminal-pane-body" });
    this.buildFindBar(this.body);

    // Files dropped on the terminal are typed in as paths, as in VS Code.
    this.registerDomEvent(this.body, "dragover", (event) => {
      if (this.dragged || !this.current || this.current.status !== "running") return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    this.registerDomEvent(this.body, "drop", (event) => {
      const session = this.current;
      if (this.dragged || !session || session.status !== "running") return;
      event.preventDefault();
      event.stopPropagation();
      const text = this.ctx.dropText(event.dataTransfer);
      if (text) session.paste(text);
    });

    this.observer = new ResizeObserver(() => {
      this.reserveStatusBar();
      this.current?.scheduleFit();
    });
    this.observer.observe(this.body);
    const statusBar = document.body.querySelector<HTMLElement>(".status-bar");
    if (statusBar) this.observer.observe(statusBar);
    this.registerEvent(this.app.workspace.on("layout-change", () => this.reserveStatusBar()));
    this.registerDomEvent(window, "focus", () => {
      flashingPanes.clear();
      obsidianWindow()?.flashFrame(false);
    });
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
    const onFonts = () => { for (const session of this.sessions) session.fontsChanged(); };
    document.fonts.addEventListener("loadingdone", onFonts);
    this.register(() => document.fonts.removeEventListener("loadingdone", onFonts));
    this.watchVault();
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf !== this.leaf) return;
      this.current?.setAttention(false);
      this.current?.focus();
    }));
    // setState usually follows onOpen with the saved tabs; open the default profile if it does not.
    window.setTimeout(() => {
      if (this.populated || !this.body) return;
      this.add(this.ctx.settings.defaultProfile);
    }, 0);
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    tabHeaderEl(this.leaf)?.removeClass("terminal-pane-attention");
    stopFlashing(this);
    for (const session of this.sessions) session.dispose();
    this.sessions = [];
    this.current = null;
  }

  // Used by the plugin's commands

  /** Opens a new tab running the profile, and shows it unless `show` is false. */
  add(profileId: string, show = true): TerminalSession | null {
    if (!this.body) return null;
    this.populated = true;
    const session = new TerminalSession(this.body, this.ctx, profileId);
    session.onChange = () => this.renderTabs();
    session.onAttention = () => this.attention(session);
    session.onFindResults((index, count) => {
      if (session === this.current) this.showFindCount(index, count);
    });
    session.setVisible(false);
    this.sessions.push(session);
    if (show) this.activate(session);
    else this.renderTabs();
    session.start();
    return session;
  }

  activate(session: TerminalSession): void {
    if (session !== this.current) this.closeFind(false);
    for (const other of this.sessions) other.setVisible(other === session);
    this.current = session;
    session.setAttention(false);
    this.renderTabs();
    session.focus();
    this.app.workspace.requestSaveLayout();
  }

  /** Moves to the next (1) or previous (-1) tab, wrapping around. */
  cycle(step: number): void {
    if (!this.current || this.sessions.length < 2) return;
    const index = this.sessions.indexOf(this.current);
    this.activate(this.sessions[(index + step + this.sessions.length) % this.sessions.length]);
  }

  /** Closes a tab and stops its program; closing the last tab closes the pane. */
  close(session: TerminalSession): void {
    const index = this.sessions.indexOf(session);
    if (index === -1) return;
    session.dispose();
    this.sessions.splice(index, 1);
    if (this.sessions.length === 0) {
      this.current = null;
      this.leaf.detach();
      return;
    }
    if (this.current === session) this.activate(this.sessions[Math.min(index, this.sessions.length - 1)]);
    else this.renderTabs();
    this.app.workspace.requestSaveLayout();
  }

  activeSession(): TerminalSession | null { return this.current; }

  /** Shows the search bar over the current terminal, starting from the selected text if any. */
  openFind(): void {
    const session = this.current;
    const input = this.findInput;
    if (!session || !input || !this.findEl) return;
    this.findEl.removeClass("is-hidden");
    const selected = session.selection();
    if (selected && !selected.includes("\n")) input.value = selected;
    input.focus();
    input.select();
    if (input.value) this.runFind(true, true);
  }

  findSession(profileId: string): TerminalSession | undefined {
    return this.sessions.find((session) => session.profileId === profileId);
  }

  focusActive(): void { this.current?.focus(); }

  /** Re-reads colors, font and font size for every tab. */
  /** The tab's own row already names the terminals; without the title bar they get its height. */
  private applyTitleBar(): void {
    this.containerEl.toggleClass("terminal-pane-no-title-bar", !this.ctx.settings.showTitleBar);
  }

  /** The open terminals, in tab order. */
  terminals(): readonly TerminalSession[] {
    return this.sessions;
  }

  applyAppearance(): void {
    this.applyTitleBar();
    for (const session of this.sessions) session.applyAppearance();
    this.renderTabs();
  }

  /**
   * A program may want the user. Nothing happens while its terminal has the keyboard; otherwise
   * its tab gets a blinking dot, and the taskbar button flashes when Obsidian is in the background.
   * Silent on purpose: no sound and no pop-up.
   */
  private attention(session: TerminalSession): void {
    if (!this.ctx.settings.notifications) return;
    const inBackground = !document.hasFocus();
    if (!inBackground && session.hasFocus()) return;
    session.setAttention(true);
    if (inBackground) {
      obsidianWindow()?.flashFrame(true);
      flashingPanes.add(this);
    }
  }

  // Notes changed by the terminal's programs

  /**
   * Files in the vault that change while a program in this pane is working on what was typed, such
   * as notes an assistant edits. Changes that follow typing in Obsidian's editor are left out: they
   * are the editor saving.
   */
  private watchVault(): void {
    const { vault, workspace } = this.app;
    const working = () => this.sessions.some((session) => session.isWorking());
    const fromProgram = (file: TAbstractFile) =>
      file instanceof TFile && working() && Date.now() - (this.typedAt.get(file.path) ?? 0) > TYPING_GRACE_MS
      && !this.ctx.isRestoring(file.path);
    this.registerEvent(workspace.on("editor-change", (_editor, info) => {
      if (info.file) this.typedAt.set(info.file.path, Date.now());
    }));
    this.registerEvent(vault.on("create", (file) => {
      // Obsidian reports every file as created while it loads the vault.
      if (!workspace.layoutReady || !fromProgram(file)) return;
      this.changed(() => this.changes.record(file.path, "created"));
      void this.pairWithDeleted(file as TFile);
    }));
    this.registerEvent(vault.on("modify", (file) => {
      if (fromProgram(file)) this.changed(() => this.changes.record(file.path, "modified", this.ctx.textBefore(file.path)));
    }));
    this.registerEvent(vault.on("delete", (file) => {
      if (!fromProgram(file)) return;
      const before = this.ctx.textBefore(file.path);
      this.changed(() => this.changes.record(file.path, "deleted", before));
      // The file may already be back under another name, if the program moved it.
      const moved = before ? this.changes.list().find((c) => c.kind === "created" && this.ctx.textBefore(c.path) === before) : undefined;
      if (moved) this.changed(() => this.changes.moved(file.path, moved.path));
    }));
    // Links to a deleted or moved file are found unresolved once Obsidian has indexed the change.
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.renderChanges()));
    this.registerEvent(vault.on("rename", (file, oldPath) => {
      if (fromProgram(file)) this.changed(() => this.changes.rename(oldPath, file.path, this.ctx.textBefore(oldPath)));
    }));
  }

  /**
   * Takes a new file for a moved one when a file with the same contents was just deleted: a program
   * moving a file reaches Obsidian as a deletion and a creation.
   */
  private async pairWithDeleted(file: TFile): Promise<void> {
    let text: string;
    try {
      text = await this.app.vault.read(file);
    } catch {
      return;
    }
    const gone = text ? this.changes.deletedWith(text) : undefined;
    const created = this.changes.list().some((c) => c.path === file.path && c.kind === "created");
    if (gone && created) this.changed(() => this.changes.moved(gone.path, file.path));
  }

  /** Notes whose links pointed at a file this change deleted or moved away. */
  private brokenLinks(change: Change): BrokenLinks[] {
    const old = change.kind === "deleted" ? change.path : change.kind === "renamed" ? change.from : undefined;
    return old ? brokenLinksTo(old, this.app.metadataCache.unresolvedLinks) : [];
  }

  /** Shows which assistants are connected and which note they are told is open; hidden when none is. */
  renderAssistants(): void {
    const el = this.assistantsEl;
    if (!el) return;
    const { names, note, waiting } = this.ctx.assistants();
    // Obsidian's own tab for the pane shows it too, as when the pane's row is hidden or out of sight.
    tabHeaderEl(this.leaf)?.toggleClass("terminal-pane-waiting", waiting > 0);
    el.toggleClass("is-hidden", names.length === 0);
    el.toggleClass("is-waiting", waiting > 0);
    if (names.length === 0) return;
    const s = this.ctx.s.assistants;
    const short = names.map((name) => name.split(" ")[0]).join(" · ");
    el.querySelector(".terminal-pane-assistants-names")?.setText(waiting > 0 ? s.waitingShort(waiting) : short);
    const lines = [s.connected(names.join(", "))];
    if (waiting > 0) lines.push(s.waiting(waiting));
    if (note) lines.push(s.sharing(note));
    const label = lines.join("\n");
    el.setAttr("aria-label", label);
    setTooltip(el, label);
  }

  /** Drops a file from the list of changes, as after its change is undone. */
  forgetChange(path: string): void {
    this.changed(() => this.changes.forget(path));
  }

  /** The changes in this terminal's list, newest first. */
  changeList(): readonly Change[] {
    return this.changes.list();
  }

  private changed(update: () => void): void {
    update();
    this.renderChanges();
    this.ctx.changesUpdated();
  }

  private renderChanges(): void {
    const button = this.changesButton;
    if (!button) return;
    const count = this.changes.size;
    button.toggleClass("is-hidden", count === 0);
    button.querySelector(".terminal-pane-changes-count")?.setText(String(count));
    const broken = totalBroken(this.changes.list().map((change) => this.brokenLinks(change)));
    button.toggleClass("has-broken-links", broken > 0);
    const s = this.ctx.s.changes;
    const label = broken > 0 ? `${s.title(count)} · ${s.brokenLinks(broken)}` : s.title(count);
    button.setAttr("aria-label", label);
    setTooltip(button, `${label}\n${s.hint}`);
  }

  /** The changed files, newest first: click shows what changed, Ctrl+click opens the file. */
  private changesMenu(event: MouseEvent): void {
    const { changes: s } = this.ctx.s;
    const menu = new Menu();
    for (const change of this.changes.list()) {
      menu.addItem((item) => {
        const broken = totalBroken([this.brokenLinks(change)]);
        const title = this.changeTitle(change);
        item.setTitle(broken > 0 ? `${title} · ${s.brokenLinks(broken)}` : title).setIcon(broken > 0 ? "unlink" : CHANGE_ICONS[change.kind]);
        item.onClick((e) => {
          if ((e.ctrlKey || e.metaKey) && change.kind !== "deleted") this.ctx.openFile(change.path, true);
          else this.ctx.reviewChange(change);
        });
      });
    }
    menu.addSeparator();
    const r = this.ctx.s.review;
    menu.addItem((item) => item.setTitle(r.reviewAll).setIcon("files").onClick(() => this.ctx.reviewAllChanges()));
    if (this.changes.list().some((change) => change.before !== undefined)) {
      menu.addItem((item) => item.setTitle(r.undoAll).setIcon("undo-2").onClick(() => this.ctx.undoAllChanges()));
    }
    menu.addItem((item) => item.setTitle(s.clear).setIcon("list-x").onClick(() => this.changed(() => this.changes.clear())));
    menu.showAtMouseEvent(event);
  }

  private changeTitle(change: Change): string {
    const { changes: s } = this.ctx.s;
    if (change.kind === "deleted") return `${change.path} ${s.deleted}`;
    if (change.kind === "renamed" && change.from) return `${change.path} ← ${change.from}`;
    if (change.kind === "created") return `${change.path} ${s.created}`;
    return change.path;
  }

  // Search bar

  /**
   * A bar over the top right of the terminal, as in VS Code. Enter finds the next match upward,
   * into older output, Shift+Enter downward, Esc closes it.
   */
  private buildFindBar(body: HTMLElement): void {
    const { find } = this.ctx.s;
    const bar = body.createDiv({ cls: "terminal-pane-find is-hidden" });
    const input = bar.createEl("input", {
      type: "text",
      cls: "terminal-pane-find-input",
      attr: { placeholder: find.placeholder, "aria-label": find.placeholder, spellcheck: "false" },
    });
    this.findCount = bar.createSpan({ cls: "terminal-pane-find-count", attr: { "aria-live": "polite" } });
    this.button(bar, "arrow-up", find.older, () => this.runFind(true));
    this.button(bar, "arrow-down", find.newer, () => this.runFind(false));
    this.button(bar, "x", find.close, () => this.closeFind(true));
    this.registerDomEvent(input, "input", () => this.runFind(true, true));
    this.registerDomEvent(input, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.runFind(!event.shiftKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closeFind(true);
      }
    });
    this.findEl = bar;
    this.findInput = input;
  }

  /** `fromBottom` starts again at the latest output, as when the search text changes. */
  private runFind(upward: boolean, fromBottom = false): void {
    const session = this.current;
    const text = this.findInput?.value ?? "";
    if (!session) return;
    if (fromBottom || text === "") session.endFind();
    if (text === "") return void this.findCount?.setText("");
    session.find(text, upward, searchColorsFor(this.contentEl));
  }

  private showFindCount(index: number, count: number): void {
    const { find } = this.ctx.s;
    const input = this.findInput?.value ?? "";
    this.findCount?.setText(input === "" ? "" : count === 0 ? find.none : find.count(index, count));
    this.findEl?.toggleClass("has-no-results", input !== "" && count === 0);
  }

  private closeFind(focusTerminal: boolean): void {
    if (!this.findEl || this.findEl.hasClass("is-hidden")) return;
    this.findEl.addClass("is-hidden");
    this.current?.endFind();
    if (focusTerminal) this.current?.focus();
  }

  private isShown(): boolean {
    return this.contentEl.clientWidth > 0 && this.contentEl.clientHeight > 0;
  }

  /**
   * Obsidian's status bar floats over the bottom right of the window, on top of whatever pane is
   * there. Keeps the terminal's last rows out from under it.
   */
  private reserveStatusBar(): void {
    const body = this.body;
    if (!body) return;
    const bar = document.body.querySelector<HTMLElement>(".status-bar");
    let overlap = 0;
    // Not isShown(): a fixed element has no offsetParent, so that reports it as hidden.
    const rect = bar?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      const pane = body.getBoundingClientRect();
      if (rect.left < pane.right && rect.right > pane.left && rect.top < pane.bottom && rect.bottom > pane.top) {
        overlap = Math.min(Math.ceil(pane.bottom - rect.top), pane.height);
      }
    }
    body.setCssProps({ "--terminal-pane-reserve": `${overlap}px` });
  }

  // Tab row

  private renderTabs(): void {
    // Obsidian's own tab for this pane carries the mark too: the pane's tab row is out of sight
    // while another note's tab is open or the sidebar shows another view.
    const marked = this.sessions.some((s) => s.attention);
    tabHeaderEl(this.leaf)?.toggleClass("terminal-pane-attention", marked);
    // A mark withdrawn by its program also stops the taskbar flash, unless another pane still has one.
    if (!marked) stopFlashing(this);
    const tabsEl = this.tabsEl;
    if (!tabsEl) return;
    // With one terminal the row only repeats its name; its buttons are also commands.
    tabsEl.parentElement?.toggleClass("is-hidden", this.ctx.settings.hideSingleTabRow && this.sessions.length <= 1);
    const { s } = this.ctx;
    tabsEl.empty();
    for (const session of this.sessions) {
      const active = session === this.current;
      const tab = tabsEl.createDiv({
        cls: [
          "terminal-pane-tab",
          ...(active ? ["is-active"] : []),
          ...(session.status === "exited" ? ["is-exited"] : []),
          ...(session.attention ? ["has-attention"] : []),
          ...(session === this.dragged ? ["is-dragging"] : []),
        ],
        attr: { role: "tab", "aria-selected": String(active), tabindex: active ? "0" : "-1", draggable: "true" },
      });
      if (session.attention) tab.createSpan({ cls: "terminal-pane-tab-mark", attr: { "aria-label": s.attention } });
      tab.createSpan({ cls: "terminal-pane-tab-title", text: session.title });
      // The full title, and the profile behind a name or a program's title.
      tab.setAttr("title", session.title === session.profileTitle ? session.title : `${session.title} (${session.profileTitle})`);
      tab.addEventListener("dblclick", () => void this.rename(session));
      const close = tab.createDiv({ cls: "clickable-icon terminal-pane-tab-close", attr: { "aria-label": s.tabs.close } });
      setIcon(close, "x");
      tab.addEventListener("click", () => this.activate(session));
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        this.close(session);
      });
      // Middle click closes, as in browsers and VS Code.
      tab.addEventListener("auxclick", (event) => {
        if (event.button === 1) this.close(session);
      });
      tab.addEventListener("contextmenu", (event) => this.tabMenu(event, session));
      tab.addEventListener("keydown", (event) => this.tabKey(event, session));
      tab.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        this.dragged = session;
        // A type of its own, so nothing else (a note, the terminal) takes the tab for dropped text.
        event.dataTransfer.setData(TAB_DRAG_TYPE, session.profileId);
        event.dataTransfer.effectAllowed = "move";
        tab.addClass("is-dragging");
      });
      if (active) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /**
   * Drops on the tab row move the dragged tab. The row listens rather than each tab, since a
   * program's new title redraws the tabs, and with them their listeners, in the middle of a drag.
   */
  private handleTabDrops(tabsEl: HTMLElement): void {
    const clear = () => {
      for (const el of Array.from(tabsEl.children)) el.removeClass("drop-before", "drop-after");
    };
    /** Where the dragged tab would go: in front of the tab at this index, or at the end. */
    const target = (event: DragEvent): { before: number; el: Element | null; front: boolean } => {
      const el = (event.target as Element | null)?.closest?.(".terminal-pane-tab") ?? null;
      const index = el ? Array.prototype.indexOf.call(tabsEl.children, el) : -1;
      if (!el || index < 0) return { before: this.sessions.length, el: tabsEl.lastElementChild, front: false };
      const rect = el.getBoundingClientRect();
      const front = dropsBefore(event.clientX, rect.left, rect.right);
      return { before: front ? index : index + 1, el, front };
    };
    this.registerDomEvent(tabsEl, "dragover", (event) => {
      if (!this.dragged) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const { el, front } = target(event);
      clear();
      el?.addClass(front ? "drop-before" : "drop-after");
    });
    this.registerDomEvent(tabsEl, "dragleave", (event) => {
      if (!tabsEl.contains(event.relatedTarget as Node | null)) clear();
    });
    this.registerDomEvent(tabsEl, "drop", (event) => {
      const session = this.dragged;
      if (!session) return;
      event.preventDefault();
      this.moveTab(session, target(event).before);
    });
    // On the document: the dragged tab may have been redrawn, and a new element never sees dragend.
    this.registerDomEvent(document, "dragend", () => {
      if (!this.dragged) return;
      this.dragged = null;
      this.renderTabs();
    });
  }

  /** Puts the tab in front of the tab at `before` (or last), and keeps the order in the layout. */
  private moveTab(session: TerminalSession, before: number): void {
    const sessions = moveBefore(this.sessions, this.sessions.indexOf(session), before);
    this.dragged = null;
    if (sessions !== this.sessions) {
      this.sessions = [...sessions];
      this.app.workspace.requestSaveLayout();
    }
    this.renderTabs();
  }

  /**
   * Arrow keys move between tabs, and with Shift move the tab itself; Enter or Space shows one,
   * Delete closes it.
   */
  private tabKey(event: KeyboardEvent, session: TerminalSession): void {
    const index = this.sessions.indexOf(session);
    const focusTab = (i: number) => (this.tabsEl?.children[i] as HTMLElement | undefined)?.focus();
    if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const to = index + (event.key === "ArrowRight" ? 1 : -1);
      if (to < 0 || to >= this.sessions.length) return;
      this.moveTab(session, event.key === "ArrowRight" ? to + 1 : to);
      focusTab(to);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab((index + (event.key === "ArrowRight" ? 1 : -1) + this.sessions.length) % this.sessions.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.activate(session);
    } else if (event.key === "Delete") {
      event.preventDefault();
      this.close(session);
    }
  }

  private tabMenu(event: MouseEvent, session: TerminalSession): void {
    const { s } = this.ctx;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(s.tabs.restart).setIcon("rotate-ccw").onClick(() => {
      this.activate(session);
      session.restart();
    }));
    menu.addItem((item) => item.setTitle(s.tabs.rename).setIcon("pencil").onClick(() => void this.rename(session)));
    menu.addItem((item) => item.setTitle(s.tabs.close).setIcon("x").onClick(() => this.close(session)));
    menu.showAtMouseEvent(event);
  }

  /** Asks for a name for the tab; an empty one goes back to the program's title or the profile. */
  private async rename(session: TerminalSession): Promise<void> {
    const t = this.ctx.s.tabs;
    const name = await askText(this.app, { title: t.renameTitle, value: session.customName ?? session.title, placeholder: session.profileTitle, confirm: t.renameConfirm, cancel: t.renameCancel });
    if (name === null) return;
    session.customName = name.trim() || null;
    this.renderTabs();
    this.app.workspace.requestSaveLayout();
    session.focus();
  }

  /**
   * Obsidian's menu for the pane (its tab's right-click menu and the title bar's ⋮) gets what the
   * pane's own row offers, so nothing is lost when that row is hidden.
   */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const { s, settings } = this.ctx;
    menu.addItem((item) => item.setSection("terminal-pane").setTitle(s.tabs.newTerminal).setIcon("plus")
      .onClick(() => this.add(settings.defaultProfile)));
    if (settings.profiles.length > 1) {
      for (const profile of settings.profiles) {
        const name = profile.name || profile.command || profile.id;
        menu.addItem((item) => item.setSection("terminal-pane").setTitle(s.tabs.newWithProfile(name)).setIcon("square-terminal")
          .onClick(() => this.add(profile.id)));
      }
    }
    if (this.changes.size > 0) {
      menu.addItem((item) => item.setSection("terminal-pane").setTitle(s.review.reviewAll).setIcon("files")
        .onClick(() => this.ctx.reviewAllChanges()));
    }
  }

  private profileMenu(event: MouseEvent): void {
    const { profiles, defaultProfile } = this.ctx.settings;
    const menu = new Menu();
    for (const profile of profiles) {
      menu.addItem((item) => item
        .setTitle(profile.name || profile.command || profile.id)
        .setIcon("square-terminal")
        .setChecked(profile.id === defaultProfile)
        .onClick(() => this.add(profile.id)));
    }
    menu.showAtMouseEvent(event);
  }

  private button(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLElement {
    const el = parent.createDiv({
      cls: "clickable-icon terminal-pane-action",
      attr: { role: "button", tabindex: "0", "aria-label": label },
    });
    setIcon(el, icon);
    setTooltip(el, label);
    this.registerDomEvent(el, "click", onClick);
    this.registerDomEvent(el, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.click();
      }
    });
    return el;
  }
}
