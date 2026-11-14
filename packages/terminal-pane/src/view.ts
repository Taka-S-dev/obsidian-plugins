// The terminal pane: a row of tabs, one TerminalSession per tab.
import { ItemView, Menu, Scope, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { tabHeaderEl } from "./obsidian-internals.ts";
import { type SessionContext, TerminalSession } from "./session.ts";
import { searchColorsFor } from "./theme.ts";

export const VIEW_TYPE = "terminal-pane";

/** The Obsidian window, through Electron's remote module; undefined where that is unavailable. */
function obsidianWindow(): { flashFrame(flag: boolean): void } | undefined {
  try {
    return (window.require?.("electron") as { remote?: { getCurrentWindow(): { flashFrame(flag: boolean): void } } })
      ?.remote?.getCurrentWindow();
  } catch {
    return undefined;
  }
}

/** What the view saves in the workspace layout, so its tabs come back after a restart. */
interface SavedState {
  sessions: string[];
  active: number;
}

function readState(state: unknown): SavedState | null {
  const raw = state as { sessions?: unknown; active?: unknown } | null;
  if (!Array.isArray(raw?.sessions)) return null;
  const sessions = raw.sessions.filter((id): id is string => typeof id === "string");
  return { sessions, active: typeof raw.active === "number" ? raw.active : 0 };
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
  /** Set once the first tabs exist, from the saved state or, failing that, the default profile. */
  private populated = false;

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
    };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = readState(state);
    if (saved && saved.sessions.length > 0 && this.body && !this.populated) {
      this.populated = true;
      for (const id of saved.sessions) this.add(id, false);
      this.activate(this.sessions[Math.min(Math.max(saved.active, 0), this.sessions.length - 1)]);
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("terminal-pane-view");
    const bar = this.contentEl.createDiv({ cls: "terminal-pane-bar" });
    this.tabsEl = bar.createDiv({ cls: "terminal-pane-tabs", attr: { role: "tablist" } });
    const actions = bar.createDiv({ cls: "terminal-pane-actions" });
    this.button(actions, "plus", this.ctx.s.tabs.newTerminal, () => this.add(this.ctx.settings.defaultProfile));
    this.button(actions, "chevron-down", this.ctx.s.tabs.chooseProfile, (event) => this.profileMenu(event));
    this.body = this.contentEl.createDiv({ cls: "terminal-pane-body" });
    this.buildFindBar(this.body);

    // Files dropped on the terminal are typed in as paths, as in VS Code.
    this.registerDomEvent(this.body, "dragover", (event) => {
      if (!this.current || this.current.status !== "running") return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    this.registerDomEvent(this.body, "drop", (event) => {
      const session = this.current;
      if (!session || session.status !== "running") return;
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
    this.registerDomEvent(window, "focus", () => obsidianWindow()?.flashFrame(false));
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
    const onFonts = () => { for (const session of this.sessions) session.fontsChanged(); };
    document.fonts.addEventListener("loadingdone", onFonts);
    this.register(() => document.fonts.removeEventListener("loadingdone", onFonts));
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
  applyAppearance(): void {
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
    if (inBackground) obsidianWindow()?.flashFrame(true);
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
    tabHeaderEl(this.leaf)?.toggleClass("terminal-pane-attention", this.sessions.some((s) => s.attention));
    const tabsEl = this.tabsEl;
    if (!tabsEl) return;
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
        ],
        attr: { role: "tab", "aria-selected": String(active), tabindex: active ? "0" : "-1" },
      });
      if (session.attention) tab.createSpan({ cls: "terminal-pane-tab-mark", attr: { "aria-label": s.attention } });
      tab.createSpan({ cls: "terminal-pane-tab-title", text: session.title });
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
      if (active) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /** Arrow keys move between tabs, Enter or Space shows one, Delete closes it. */
  private tabKey(event: KeyboardEvent, session: TerminalSession): void {
    const index = this.sessions.indexOf(session);
    const focusTab = (i: number) => (this.tabsEl?.children[i] as HTMLElement | undefined)?.focus();
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
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
    menu.addItem((item) => item.setTitle(s.tabs.close).setIcon("x").onClick(() => this.close(session)));
    menu.showAtMouseEvent(event);
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

  private button(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): void {
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
  }
}
