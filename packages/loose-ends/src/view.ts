import { ButtonComponent, DropdownComponent, ItemView, Keymap, Menu, Modal, Notice, SearchComponent, setIcon, TFile, TFolder, type App, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { checkPaths, hostOf, neverContact, rootOf, type PathStatus } from "./check-path.ts";
import type { Strings } from "./i18n.ts";
import { countListed, withoutIgnored, type Ignored, type Kind } from "./ignored.ts";
import type LooseEnds from "./main.ts";
import { stillBlank, stillEmpty, stillUnused, type LinkAt, type Report } from "./scan.ts";
import { ageOf, extensionOf, filterLinks, foldersEmptiedBy, groupLinks, sortFiles, type FileOrder, type LinkGrouping } from "./vault-scan.ts";

export const VIEW_TYPE = "loose-ends";

/** How long a drive or share may take to answer before its links count as not checked. */
const CHECK_TIMEOUT_MS = 3_000;

/** A scan shows as running at least this long, so a click on Scan again is seen to do something. */
const SCAN_SHOWN_MS = 400;

/** How many groups of links are shown at first, and how many more each "show more" adds. */
const PAGE = 50;

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

/** The results of the last check of links outside the vault, and the links it covered. */
interface Checked {
  at: string;
  status: Map<string, PathStatus>;
  links: string;
}

type SectionKey = keyof Strings["sections"];

/** The lists, in order: what is most often tidied first, links to notes still to write last. */
const KINDS: Kind[] = ["unused", "brokenFiles", "empty", "blankNotes", "external", "missingNotes"];

/**
 * Everything left over, one kind per tab. The vault is read when the tab opens, when
 * "Scan again" is pressed and after something is moved to the trash from here; never in the
 * background.
 */
export class LooseEndsView extends ItemView {
  /** The last scan as read, including what was taken off the lists; see `listed`. */
  private report: Report | null = null;
  /** When the vault was last read, "9:05"; the list does not follow later changes on its own. */
  private scannedAt = "";
  /** A scan is running; the head says so and its button spins. */
  private scanning = false;
  /** What the last Scan again changed, said next to the time: "No change", "2 fewer". */
  private change = "";
  private checked: Checked | null = null;
  private checking = false;
  /** The tab chosen by hand; until then, the first kind with something in it. */
  private tab: SectionKey | null = null;
  /** What is ticked in each list, kept across redraws while it is still listed. */
  private selected = new Map<SectionKey, Set<string>>();
  /** How unused attachments are sorted, kept while the tab is open. */
  private order: FileOrder = "name";
  /** Lists of links: what is typed in the filter of each, how they are grouped, how many are shown. */
  private query = new Map<Kind, string>();
  private grouping: LinkGrouping = "target";
  private shown = new Map<Kind, number>();

  constructor(leaf: WorkspaceLeaf, private plugin: LooseEnds) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.s.title;
  }

  getIcon(): string {
    return "eraser";
  }

  async onOpen(): Promise<void> {
    // A file deleted or renamed elsewhere (say from the file menu here) leaves the list at once;
    // the vault is not read again for it.
    this.registerEvent(this.app.vault.on("delete", (f) => this.drop(f.path)));
    this.registerEvent(this.app.vault.on("rename", (_f, old) => this.drop(old)));
    await this.refresh();
  }

  private drop(path: string): void {
    const r = this.report;
    if (!r) return;
    const gone = (p: string) => p === path || p.startsWith(`${path}/`);
    if (!r.unused.some((u) => gone(u.path)) && !r.empty.some(gone) && !r.blankNotes.some((n) => gone(n.path))) return;
    this.report = {
      ...r,
      unused: r.unused.filter((u) => !gone(u.path)),
      empty: r.empty.filter((p) => !gone(p)),
      blankNotes: r.blankNotes.filter((n) => !gone(n.path)),
    };
    this.render();
  }

  /** Reads the vault again. `manual`: from Scan again, which also says what changed. */
  async refresh(manual = false): Promise<void> {
    if (this.scanning) return;
    const s = this.plugin.s;
    const before = this.listed();
    this.scanning = true;
    this.change = "";
    if (this.report) this.render();
    else this.contentEl.setText(s.scanning);
    try {
      const [report] = await Promise.all([this.plugin.scan(), manual ? sleep(SCAN_SHOWN_MS) : null]);
      this.report = report;
    } finally {
      this.scanning = false;
    }
    this.scannedAt = clock(new Date());
    const after = this.listed();
    if (manual && before && after) {
      const d = countListed(after) - countListed(before);
      this.change = d === 0 ? s.noChange : d < 0 ? s.fewer(-d) : s.more_(d);
    }
    this.render();
  }

  /** The last scan without what was taken off the lists by hand. */
  private listed(): Report | null {
    return this.report && withoutIgnored(this.report, this.plugin.settings.ignored);
  }

  private render(): void {
    const s = this.plugin.s;
    const r = this.listed();
    const root = this.contentEl;
    root.empty();
    root.addClass("loose-ends");
    if (!r) return;

    const missing = this.missingExternal(r);
    const head = root.createDiv({ cls: "loose-ends-head" });
    // The counts are on the tabs; the head says how current they are.
    const when = head.createDiv({ cls: "loose-ends-scanned" });
    when.setText(this.scanning ? s.scanning : s.scannedAt(this.scannedAt));
    if (this.change && !this.scanning) when.createSpan({ cls: "loose-ends-change", text: this.change });
    const again = new ButtonComponent(head).setIcon("refresh-cw").setTooltip(s.rescan).onClick(() => void this.refresh(true));
    again.setDisabled(this.scanning);
    again.buttonEl.toggleClass("loose-ends-spinning", this.scanning);

    // One kind at a time, under a row of tabs with their counts. Links outside the vault have no
    // count until checked, and say so.
    const unchecked = !this.checked && r.external.length > 0;
    const ignored = this.plugin.settings.ignored;
    const counts: Record<SectionKey, number> = {
      unused: r.unused.length,
      brokenFiles: r.brokenFiles.length,
      empty: r.empty.length,
      blankNotes: r.blankNotes.length,
      external: missing.length,
      missingNotes: r.missingNotes.length,
      hidden: ignored.length,
    };
    // "Taken off" comes last, and only while there is something in it (or it is open).
    const chosen = this.tab === "hidden" && ignored.length === 0 ? null : this.tab;
    const active = chosen ?? KINDS.find((k) => k !== "missingNotes" && counts[k] > 0) ?? "unused";
    const tabs: SectionKey[] = ignored.length > 0 ? [...KINDS, "hidden"] : KINDS;
    const bar = root.createDiv({ cls: "loose-ends-tabs", attr: { role: "tablist" } });
    for (const key of tabs) {
      const unknown = key === "external" && unchecked;
      const tab = bar.createEl("button", {
        cls: [
          "loose-ends-tab",
          ...(key === active ? ["is-active"] : []),
          ...(counts[key] === 0 && !unknown ? ["is-done"] : []),
          ...(key === "hidden" ? ["is-hidden"] : []),
        ],
        attr: { role: "tab", "aria-selected": String(key === active), tabindex: key === active ? "0" : "-1" },
      });
      tab.createSpan({ text: s.tabs[key] });
      tab.createSpan({
        cls: ["loose-ends-count", ...(counts[key] > 0 && key !== "hidden" ? ["is-some"] : unknown ? ["is-unknown"] : [])],
        text: unknown ? s.notChecked : String(counts[key]),
      });
      tab.addEventListener("click", () => this.showTab(key));
    }
    // Left and right move between tabs, as in any tab list.
    bar.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = (tabs.indexOf(active) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      this.showTab(tabs[next]);
      this.contentEl.querySelectorAll<HTMLElement>(".loose-ends-tab")[next]?.focus();
    });

    const panel = root.createDiv({ cls: "loose-ends-panel", attr: { role: "tabpanel" } });
    panel.createDiv({ cls: "loose-ends-panel-title", text: s.sections[active] });
    if (counts[active] === 0 && active !== "external") {
      panel.createDiv({ cls: "loose-ends-empty", text: s.none });
      return;
    }
    switch (active) {
      case "hidden":
        this.hiddenBody(panel, ignored);
        break;
      case "brokenFiles":
        panel.createDiv({ cls: "loose-ends-hint", text: s.hints.brokenFiles });
        this.links(panel, r.brokenFiles, "brokenFiles");
        break;
      case "external":
        this.externalBody(panel, r, missing);
        break;
      case "unused":
        this.unusedBody(panel, r);
        break;
      case "empty":
        this.selectable(panel, "empty", r.empty, new Set(), null, (row, path) => {
          this.entry(row, path, folderOf(path));
          this.ignoreButton(row, { kind: "empty", key: path });
          new ButtonComponent(row).setIcon("trash-2").setTooltip(s.trash).onClick(() => this.confirmTrash([path]));
        });
        break;
      case "blankNotes":
        this.blankBody(panel, r);
        break;
      case "missingNotes":
        panel.createDiv({ cls: "loose-ends-hint", text: s.hints.missingNotes });
        this.links(panel, r.missingNotes, "missingNotes");
        break;
    }
  }

  private showTab(key: SectionKey): void {
    this.tab = key;
    this.render();
  }

  /** Notes with nothing written in them, with how many links would be left pointing nowhere. */
  private blankBody(body: HTMLElement, r: Report): void {
    const s = this.plugin.s;
    body.createDiv({ cls: "loose-ends-hint", text: s.hints.blankNotes });
    const byPath = new Map(r.blankNotes.map((n) => [n.path, n]));
    // A note something links to is ticked only by hand: its links would be left pointing nowhere.
    const linked = new Set(r.blankNotes.filter((n) => n.linkedFrom > 0).map((n) => n.path));
    this.selectable(body, "blankNotes", [...byPath.keys()], linked, null, (row, path) => {
      const n = byPath.get(path)!;
      const age = ageOf(n.mtime, Date.now());
      const when = age.unit === "today" ? s.age.today : s.age[age.unit](age.n);
      this.entry(row, path, [folderOf(path), when].filter(Boolean).join(" · "));
      if (n.linkedFrom > 0) row.querySelector(".loose-ends-main")?.createDiv({ cls: "loose-ends-warning", text: s.linkedFrom(n.linkedFrom) });
      this.ignoreButton(row, { kind: "blankNotes", key: path });
      new ButtonComponent(row).setIcon("trash-2").setTooltip(s.trash).onClick(() => this.confirmTrash([path]));
    });
  }

  private unusedBody(body: HTMLElement, r: Report): void {
    const s = this.plugin.s;
    body.createDiv({ cls: "loose-ends-hint", text: s.hints.unused });
    const sorted = sortFiles(r.unused, this.order);
    const byPath = new Map(sorted.map((u) => [u.path, u]));
    // A file whose name is written somewhere may be in use: it is marked, and "Select all" leaves it.
    const named = new Set(sorted.filter((u) => u.mentionedIn).map((u) => u.path));
    const sort = (bar: HTMLElement) =>
      new DropdownComponent(bar)
        .addOptions({ name: s.order.name, size: s.order.size, age: s.order.age })
        .setValue(this.order)
        .onChange((v) => {
          this.order = v as FileOrder;
          this.render();
        });
    this.selectable(body, "unused", [...byPath.keys()], named, sort, (row, path) => {
      const u = byPath.get(path)!;
      const age = ageOf(u.mtime, Date.now());
      const when = age.unit === "today" ? s.age.today : s.age[age.unit](age.n);
      this.entry(row, path, [folderOf(path), formatSize(u.size), when].filter(Boolean).join(" · "));
      if (u.mentionedIn) this.mention(row, u.mentionedIn);
      this.ignoreButton(row, { kind: "unused", key: path });
      new ButtonComponent(row).setIcon("trash-2").setTooltip(s.trash).onClick(() => this.confirmTrash([path]));
    });
  }

  /**
   * A list to tick: "Select all" and "Move N selected to trash" above it, then a row with a box for
   * each item, filled by `draw`.
   */
  private selectable(
    body: HTMLElement,
    key: SectionKey,
    paths: string[],
    notInAll: Set<string>,
    extra: ((bar: HTMLElement) => void) | null,
    draw: (row: HTMLElement, path: string) => void,
  ): void {
    const s = this.plugin.s;
    const listed = new Set(paths);
    const sel = new Set([...(this.selected.get(key) ?? [])].filter((p) => listed.has(p)));
    this.selected.set(key, sel);

    const bar = body.createDiv({ cls: "loose-ends-select" });
    const label = bar.createEl("label", { cls: "loose-ends-select-all" });
    const all = label.createEl("input", { type: "checkbox" });
    label.appendText(s.selectAll);
    if (extra) extra(bar.createDiv({ cls: "loose-ends-select-extra" }));
    const trash = new ButtonComponent(bar).setWarning().onClick(() => this.confirmTrash([...sel]));
    const boxes = new Map<string, HTMLInputElement>();
    const update = () => {
      // Shown only once something is ticked, so an unused list does not carry a red button.
      trash.setButtonText(s.trashSelected(sel.size));
      trash.buttonEl.toggle(sel.size > 0);
      const everyone = paths.filter((p) => !notInAll.has(p));
      all.checked = everyone.length > 0 && everyone.every((p) => sel.has(p));
      all.indeterminate = sel.size > 0 && !all.checked;
    };
    all.addEventListener("change", () => {
      if (all.checked) paths.filter((p) => !notInAll.has(p)).forEach((p) => sel.add(p));
      else sel.clear();
      for (const [p, box] of boxes) box.checked = sel.has(p);
      update();
    });
    for (const path of paths) {
      const row = body.createDiv({ cls: "loose-ends-row" });
      const box = row.createEl("input", { type: "checkbox", cls: "loose-ends-box" });
      box.checked = sel.has(path);
      box.addEventListener("change", () => {
        if (box.checked) sel.add(path);
        else sel.delete(path);
        update();
      });
      boxes.set(path, box);
      draw(row, path);
    }
    update();
  }

  /**
   * A file or folder in a row: a thumbnail or icon, its name, and below it where it is and the rest.
   * A click shows it in the file explorer (and opens a file); a right click brings up Obsidian's
   * own menu for it, as in the file explorer.
   */
  private entry(row: HTMLElement, path: string, detail: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    const thumb = row.createDiv({ cls: "loose-ends-thumb" });
    if (file instanceof TFile && IMAGES.has(extensionOf(path))) {
      thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: "" } });
    } else {
      setIcon(thumb, file instanceof TFile ? "file" : "folder");
    }
    this.main(row, path.slice(path.lastIndexOf("/") + 1), detail, (e) => this.show(path, e));
    row.addEventListener("contextmenu", (e) => {
      const target = this.app.vault.getAbstractFileByPath(path);
      if (!target) return;
      e.preventDefault();
      const menu = new Menu();
      this.app.workspace.trigger("file-menu", menu, target, "loose-ends", this.leaf);
      menu.showAtMouseEvent(e);
    });
  }

  /** Shows a file or folder in the file explorer, and opens a file. */
  private show(path: string, e: MouseEvent | KeyboardEvent): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    revealInExplorer(this.app, file);
    if (file instanceof TFile) void this.otherLeaf(e).openFile(file);
  }

  /**
   * The text of a row, with its note below it or, `inline`, after it on the same line; with `open`,
   * a click or Enter on it opens what it is about.
   */
  private main(row: HTMLElement, text: string, note: string, open: ((e: MouseEvent | KeyboardEvent) => void) | null, inline = false): void {
    const main = row.createDiv({ cls: ["loose-ends-main", ...(inline ? ["is-inline"] : [])] });
    main.createDiv({ cls: "loose-ends-target", text });
    if (note) main.createDiv({ cls: "loose-ends-note", text: note });
    if (!open) return;
    row.addClass("is-clickable");
    main.setAttrs({ tabindex: "0", role: "button" });
    main.addEventListener("click", open);
    main.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open(e);
    });
  }

  /**
   * A list of links: a filter and a choice of grouping (by where they point, or by note) above it,
   * one line per group, and the first groups only, with more on request.
   */
  private links(body: HTMLElement, links: LinkAt[], kind: Kind): void {
    const s = this.plugin.s;
    const bar = body.createDiv({ cls: "loose-ends-select" });
    const search = new SearchComponent(bar).setPlaceholder(s.filter).setValue(this.query.get(kind) ?? "");
    const list = body.createDiv({ cls: "loose-ends-list" });
    // Only the list is drawn again, so the filter keeps its focus while typing.
    const draw = () => {
      list.empty();
      const groups = groupLinks(filterLinks(links, this.query.get(kind) ?? ""), this.grouping);
      if (groups.length === 0) {
        list.createDiv({ cls: "loose-ends-empty", text: s.noMatch });
        return;
      }
      const limit = this.shown.get(kind) ?? PAGE;
      for (const g of groups.slice(0, limit)) this.linkGroup(list, g, kind);
      const rest = groups.length - limit;
      if (rest > 0) {
        new ButtonComponent(list.createDiv({ cls: "loose-ends-more" })).setButtonText(s.more(Math.min(PAGE, rest), rest)).onClick(() => {
          this.shown.set(kind, limit + PAGE);
          draw();
        });
      }
    };
    search.onChange((v) => {
      this.query.set(kind, v);
      this.shown.delete(kind);
      draw();
    });
    new DropdownComponent(bar.createDiv({ cls: "loose-ends-select-extra" }))
      .addOptions({ target: s.grouping.target, source: s.grouping.source })
      .setValue(this.grouping)
      .onChange((v) => {
        this.grouping = v as LinkGrouping;
        this.shown.delete(kind);
        draw();
      });
    draw();
  }

  /**
   * One group on one line. By target: the target and where it is linked from, or how many places
   * for several, which open to the list of places. By note: the note and how many, opening to its
   * links. Each link can be taken off by its target.
   */
  private linkGroup(list: HTMLElement, g: { key: string; at: LinkAt[] }, kind: Kind): void {
    const s = this.plugin.s;
    const open = (l: LinkAt) => (e: MouseEvent | KeyboardEvent) => void this.openAt(l.source, l.line, e);
    if (this.grouping === "target" && g.at.length === 1) {
      const l = g.at[0];
      const row = list.createDiv({ cls: "loose-ends-row is-line" });
      this.main(row, g.key, s.at(l.source, l.line + 1), open(l), true);
      this.ignoreButton(row, { kind, key: g.key });
      return;
    }
    const fold = list.createEl("details", { cls: "loose-ends-group" });
    const summary = fold.createEl("summary", { cls: "loose-ends-row is-line" });
    const main = summary.createDiv({ cls: "loose-ends-main is-inline" });
    main.createDiv({ cls: "loose-ends-target", text: g.key });
    main.createDiv({ cls: "loose-ends-note", text: this.grouping === "target" ? s.places(g.at.length) : s.items(g.at.length) });
    if (this.grouping === "target") this.ignoreButton(summary, { kind, key: g.key });
    for (const l of g.at) {
      const place = fold.createDiv({ cls: "loose-ends-row loose-ends-place is-line" });
      if (this.grouping === "target") {
        this.main(place, s.at(l.source, l.line + 1), "", open(l), true);
      } else {
        this.main(place, l.target, s.line(l.line + 1), open(l), true);
        this.ignoreButton(place, { kind, key: l.target });
      }
    }
  }

  /** Where an unused file's name is written: a warning under it, with that place to open. */
  private mention(row: HTMLElement, source: string): void {
    const main = row.querySelector(".loose-ends-main");
    if (!main) return;
    const warn = main.createDiv({ cls: "loose-ends-warning" });
    warn.appendText(this.plugin.s.mentioned);
    if (source.startsWith(`${this.app.vault.configDir}/`)) {
      warn.appendText(source);
      return;
    }
    const link = warn.createEl("a", { text: source, href: "#" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.openAt(source, 0, e);
    });
  }

  /** Links outside the vault: a count and a Check button, then what is gone and what was not checked. */
  private externalBody(body: HTMLElement, r: Report, missing: LinkAt[]): void {
    const t = this.plugin.s.external;
    const bar = body.createDiv({ cls: "loose-ends-check" });
    const c = this.checked;
    bar.createDiv({ cls: "loose-ends-hint", text: c ? t.checkedAt(c.at, c.status.size) : t.count(r.external.length) });
    if (r.external.length > 0) {
      new ButtonComponent(bar)
        .setButtonText(this.checking ? t.checking : t.check)
        .setDisabled(this.checking)
        .onClick(() => this.check());
    }
    if (!c) return;
    if (c.links !== linksKey(r.external)) body.createDiv({ cls: "loose-ends-hint", text: t.changed });
    this.links(body, missing, "external");
    // Only links still in the notes count, so a link removed since the check is not reported.
    const unreachable = new Map<string, number>();
    const skipped = new Map<string, number>();
    for (const target of new Set(r.external.map((l) => l.target))) {
      const status = c.status.get(target);
      if (status === "unreachable") unreachable.set(rootOf(target), (unreachable.get(rootOf(target)) ?? 0) + 1);
      const host = hostOf(target);
      if (status === "skipped" && host) skipped.set(host, (skipped.get(host) ?? 0) + 1);
    }
    for (const [root, n] of unreachable) body.createDiv({ cls: "loose-ends-warning", text: t.unreachable(root, n) });
    for (const [host, n] of skipped) body.createDiv({ cls: "loose-ends-hint", text: t.skipped(host, n) });
  }

  /** The links outside the vault the last check found gone, among those in the notes now. */
  private missingExternal(r: Report): LinkAt[] {
    const status = this.checked?.status;
    return status ? r.external.filter((l) => status.get(l.target) === "missing") : [];
  }

  /**
   * Checking a network path makes Windows sign in to its server, so a link in a note from elsewhere
   * could send the sign-in to a server of its choosing. Servers not allowed before are named first,
   * and contacted only once allowed; drives are checked either way.
   */
  private check(): void {
    const r = this.listed();
    if (!r || this.checking) return;
    const hosts = new Set<string>();
    for (const l of r.external) {
      const host = hostOf(l.target);
      if (host !== null && !neverContact(host)) hosts.add(host);
    }
    const trusted = this.plugin.settings.hosts;
    const unknown = [...hosts].filter((h) => !trusted.includes(h)).sort();
    if (unknown.length === 0) {
      void this.runCheck();
      return;
    }
    new HostsModal(this.app, this.plugin.s, unknown, async (allow) => {
      if (allow) await this.plugin.trustHosts(unknown);
      await this.runCheck();
    }).open();
  }

  private async runCheck(): Promise<void> {
    const r = this.listed();
    if (!r || this.checking) return;
    const trusted = new Set(this.plugin.settings.hosts);
    this.checking = true;
    this.render();
    try {
      const status = await checkPaths(r.external.map((l) => l.target), CHECK_TIMEOUT_MS, (host) => trusted.has(host));
      this.checked = { at: clock(new Date()), status, links: linksKey(r.external) };
    } finally {
      this.checking = false;
      this.render();
    }
  }

  /** The button that takes something off its list. A button in a fold's heading does not open it. */
  private ignoreButton(row: HTMLElement, item: Ignored): void {
    new ButtonComponent(row)
      .setIcon("eye-off")
      .setTooltip(this.plugin.s.hide)
      .onClick((e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.ignore(item);
      });
  }

  /** Takes something off its list; the list changes at once, without reading the vault again. */
  private async ignore(item: Ignored): Promise<void> {
    await this.plugin.ignore(item);
    new Notice(this.plugin.s.hidden(item.key));
    this.render();
  }

  private async restore(items: Ignored[]): Promise<void> {
    await this.plugin.restore(items);
    this.render();
  }

  /** What was taken off, under the name of the list it came from, each with Put back. */
  private hiddenBody(body: HTMLElement, ignored: Ignored[]): void {
    const s = this.plugin.s;
    const bar = body.createDiv({ cls: "loose-ends-check" });
    bar.createDiv({ cls: "loose-ends-hint", text: s.hints.hidden });
    new ButtonComponent(bar).setButtonText(s.restoreAll).onClick(() => void this.restore(ignored));
    for (const kind of KINDS) {
      const items = ignored.filter((i) => i.kind === kind).sort((a, b) => a.key.localeCompare(b.key));
      if (items.length === 0) continue;
      body.createDiv({ cls: "loose-ends-kind", text: s.tabs[kind] });
      for (const item of items) {
        const row = body.createDiv({ cls: "loose-ends-row" });
        const there = kind === "unused" || kind === "empty" ? this.app.vault.getAbstractFileByPath(item.key) : null;
        this.main(row, item.key, "", there ? (e) => this.show(item.key, e) : null);
        new ButtonComponent(row).setButtonText(s.restore).onClick(() => void this.restore([item]));
      }
    }
  }

  /**
   * Asks before moving to the trash. Folders the files leave with nothing in them are offered too,
   * ticked, so a folder of attachments goes with its last file.
   */
  private confirmTrash(paths: string[]): void {
    if (paths.length === 0) return;
    const files = this.app.vault.getFiles().map((f) => f.path);
    const folders = this.app.vault.getAllLoadedFiles().flatMap((f) => (f instanceof TFolder && !f.isRoot() ? [f.path] : []));
    const removed = paths.filter((p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
    const emptied = removed.length > 0 ? foldersEmptiedBy(removed, files, folders, attachmentFolder(this.app)) : [];
    new ConfirmModal(this.app, this.plugin.s, paths, emptied, (withFolders) => void this.trash([...paths, ...withFolders])).open();
  }

  /** Moves to Obsidian's trash what is still unused or still empty; anything that changed is kept. */
  private async trash(paths: string[]): Promise<void> {
    const s = this.plugin.s;
    let moved = 0;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) continue;
      const keep =
        file instanceof TFile
          ? file.extension === "md"
            ? (await stillBlank(this.app, path)) ? null : s.notBlank(path)
            : stillUnused(this.app, path) ? null : s.stillUsed(path)
          : stillEmpty(this.app, path) ? null : s.notEmpty(path);
      if (keep) {
        new Notice(keep);
        continue;
      }
      try {
        await this.app.fileManager.trashFile(file);
        moved++;
      } catch (e) {
        console.error("[loose-ends] could not trash", path, e);
        new Notice(s.trashFailed(path));
      }
    }
    if (moved > 0) new Notice(s.trashed(moved));
    await this.refresh();
  }

  /**
   * Where to open a file without replacing this list: the tab in the main area used most recently
   * apart from this one (as search results do), or a new tab.
   */
  private otherLeaf(e: MouseEvent | KeyboardEvent): WorkspaceLeaf {
    // Ctrl (Cmd) with the click opens a new tab, as elsewhere in Obsidian.
    const pane = Keymap.isModEvent(e);
    if (pane) return this.app.workspace.getLeaf(pane);
    let best: WorkspaceLeaf | null = null;
    const time = (l: WorkspaceLeaf) => (l as unknown as { activeTime?: number }).activeTime ?? 0;
    this.app.workspace.iterateRootLeaves((l) => {
      if (l !== this.leaf && (!best || time(l) > time(best))) best = l;
    });
    return best ?? this.app.workspace.getLeaf("tab");
  }

  private async openAt(path: string, line: number, e: MouseEvent | KeyboardEvent): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.otherLeaf(e).openFile(file, { eState: { line } });
  }
}

/** Asks before moving to the trash; Cancel has the focus, so Enter does not delete. */
class ConfirmModal extends Modal {
  constructor(
    app: App,
    private s: Strings,
    private paths: string[],
    private emptied: string[],
    private ok: (withFolders: string[]) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const c = this.s.confirm;
    this.titleEl.setText(c.title);
    this.contentEl.createEl("p", { text: c.body(this.paths.length) });
    const list = this.contentEl.createEl("ul", { cls: "loose-ends-confirm-list" });
    for (const p of this.paths) list.createEl("li", { text: p });
    let withFolders = this.emptied.length > 0;
    if (this.emptied.length > 0) {
      const label = this.contentEl.createEl("label", { cls: "loose-ends-confirm-folders" });
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = true;
      box.addEventListener("change", () => (withFolders = box.checked));
      label.appendText(c.alsoFolders(this.emptied.length));
      const folders = this.contentEl.createEl("ul", { cls: "loose-ends-confirm-list" });
      for (const d of this.emptied) folders.createEl("li", { text: `${d}/` });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(c.ok).setWarning().onClick(() => {
      this.close();
      this.ok(withFolders ? this.emptied : []);
    });
    const cancel = new ButtonComponent(buttons).setButtonText(c.cancel).onClick(() => this.close());
    window.setTimeout(() => cancel.buttonEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Names the servers a check would contact; checking only the drives has the focus. Esc checks nothing. */
class HostsModal extends Modal {
  constructor(app: App, private s: Strings, private hosts: string[], private done: (allow: boolean) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const h = this.s.hosts;
    this.titleEl.setText(h.title);
    this.contentEl.createEl("p", { text: h.body });
    const list = this.contentEl.createEl("ul", { cls: "loose-ends-confirm-list" });
    for (const host of this.hosts) list.createEl("li", { text: `\\\\${host}` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(h.contact).setWarning().onClick(() => this.choose(true));
    const drives = new ButtonComponent(buttons).setButtonText(h.drivesOnly).onClick(() => this.choose(false));
    window.setTimeout(() => drives.buttonEl.focus(), 0);
  }

  private choose(allow: boolean): void {
    this.close();
    void this.done(allow);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** The core file explorer's reveal, when it is on; it has no public API. */
function revealInExplorer(app: App, file: TAbstractFile): void {
  const explorer = (app as unknown as { internalPlugins?: { getEnabledPluginById?(id: string): { revealInFolder?(f: TAbstractFile): void } | null } })
    .internalPlugins?.getEnabledPluginById?.("file-explorer");
  explorer?.revealInFolder?.(file);
}

/**
 * The folder Obsidian puts new attachments in, when it is one fixed folder; it is left in place
 * even when empty. Read from the app's config, which has no public API.
 */
function attachmentFolder(app: App): string[] {
  const path = (app.vault as unknown as { getConfig?(key: string): unknown }).getConfig?.("attachmentFolderPath");
  if (typeof path !== "string" || path === "" || path === "/" || path.startsWith(".")) return [];
  return [path.replace(/^\/+|\/+$/g, "")];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clock(d: Date): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

function linksKey(links: LinkAt[]): string {
  return [...new Set(links.map((l) => l.target))].sort().join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
