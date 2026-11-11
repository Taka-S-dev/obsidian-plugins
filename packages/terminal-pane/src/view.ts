// The terminal pane: a row of tabs, one TerminalSession per tab.
import { ItemView, Menu, Scope, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { type SessionContext, TerminalSession } from "./session.ts";

export const VIEW_TYPE = "terminal-pane";

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

    this.observer = new ResizeObserver(() => this.current?.scheduleFit());
    this.observer.observe(this.body);
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
    const onFonts = () => { for (const session of this.sessions) session.fontsChanged(); };
    document.fonts.addEventListener("loadingdone", onFonts);
    this.register(() => document.fonts.removeEventListener("loadingdone", onFonts));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.current?.focus();
    }));
    // setState usually follows onOpen with the saved tabs; open the default profile if it does not.
    window.setTimeout(() => {
      if (this.populated || !this.body) return;
      this.add(this.ctx.settings.defaultProfile);
    }, 0);
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
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
    session.setVisible(false);
    this.sessions.push(session);
    if (show) this.activate(session);
    else this.renderTabs();
    session.start();
    return session;
  }

  activate(session: TerminalSession): void {
    for (const other of this.sessions) other.setVisible(other === session);
    this.current = session;
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

  findSession(profileId: string): TerminalSession | undefined {
    return this.sessions.find((session) => session.profileId === profileId);
  }

  focusActive(): void { this.current?.focus(); }

  /** Re-reads colors, font and font size for every tab. */
  applyAppearance(): void {
    for (const session of this.sessions) session.applyAppearance();
    this.renderTabs();
  }

  // Tab row

  private renderTabs(): void {
    const tabsEl = this.tabsEl;
    if (!tabsEl) return;
    const { s } = this.ctx;
    tabsEl.empty();
    for (const session of this.sessions) {
      const active = session === this.current;
      const tab = tabsEl.createDiv({
        cls: ["terminal-pane-tab", ...(active ? ["is-active"] : []), ...(session.status === "exited" ? ["is-exited"] : [])],
        attr: { role: "tab", "aria-selected": String(active), tabindex: active ? "0" : "-1" },
      });
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
