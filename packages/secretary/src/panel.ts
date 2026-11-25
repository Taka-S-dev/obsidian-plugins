import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { unread } from "./bulletins.ts";
import { doneLabel, type DoneKind } from "./done-today.ts";
import { shortDate, splitStamp } from "./inbox.ts";
import { tabHeaderEl } from "./obsidian-internals.ts";
import { dueReminders, laterDays, upcomingToday, type Reminder } from "./reminders.ts";
import { classifyDue, type DueTask } from "./tasks.ts";
import { hm, ymd } from "./time.ts";
import type Secretary from "./main";

export const PANEL_VIEW = "secretary-panel";

interface SectionOptions {
  /** Lucide icon shown before the title, so each section is told apart at a glance. */
  icon: string;
  title: string;
  count: number;
  /** A button with an icon shows only the icon; its text is the tooltip, naming what it acts on. */
  buttons: { text: string; icon?: string; onClick: () => void }[];
}

/** The side panel: notices, what is left today, and what waits in the inbox. Redrawn after every check. */
export class SecretaryPanel extends ItemView {
  /**
   * Which of the one-line folds are open ("3 after tomorrow", "Done today (2)"); closed again when
   * the panel is reopened.
   */
  private openFolds = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: Secretary) {
    super(leaf);
  }

  getViewType(): string {
    return PANEL_VIEW;
  }

  getDisplayText(): string {
    return this.plugin.s.panel.title;
  }

  getIcon(): string {
    return "bell";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    tabHeaderEl(this.leaf)?.removeClass("secretary-unread");
  }

  render(): void {
    const t = this.plugin.s.panel;
    const snap = this.plugin.snapshot;
    const root = this.contentEl;
    root.empty();
    root.addClass("secretary-panel");
    const now = snap?.now ?? new Date();

    // Notices from other programs. Text is set as text, never parsed as HTML or Markdown.
    // Reading one only clears its mark; it stays listed until it is marked done.
    const notices = snap?.bulletins ?? [];
    const unreadCount = unread(notices).length;
    const readCount = notices.length - unreadCount;
    const rejected = snap?.rejected ?? [];
    // The panel's own tab carries a dot while a notice is unread, for when the panel is out of sight.
    tabHeaderEl(this.leaf)?.toggleClass("secretary-unread", unreadCount > 0);
    if (notices.length > 0 || rejected.length > 0) {
      const buttons: SectionOptions["buttons"] = [];
      if (unreadCount > 1) buttons.push({ text: t.markAllRead, onClick: () => void this.plugin.markRead() });
      if (readCount > 1) buttons.push({ text: t.clearRead, onClick: () => void this.plugin.dismiss() });
      const body = this.section(root, { icon: "bell", title: t.bulletins, count: notices.length, buttons });
      if (notices.length === 0) body.createDiv({ cls: "secretary-empty", text: t.noBulletins });
      for (const b of notices) {
        const row = body.createDiv({ cls: ["secretary-row", "secretary-bulletin", ...(b.read ? [] : ["is-unread"])] });
        const text = row.createDiv({ cls: "secretary-bulletin-text" });
        text.createDiv({ cls: "secretary-meta", text: b.source ? `${b.at.slice(11)} ${b.source}` : b.at.slice(11) });
        this.plugin.links.render(text.createDiv({ cls: "secretary-multiline" }), b.text);
        const actions = row.createDiv({ cls: "secretary-row-actions" });
        if (!b.read) actions.createEl("button", { text: t.markRead }).addEventListener("click", () => void this.plugin.markRead(b.id));
        actions.createEl("button", { text: t.done }).addEventListener("click", () => void this.plugin.dismiss(b.id));
      }
      if (rejected.length > 0) {
        const row = body.createDiv({ cls: "secretary-row secretary-bulletin" });
        const r = row.createDiv({ cls: "secretary-bulletin-text secretary-warning", text: t.rejected(rejected.length) });
        r.setAttr("title", rejected.map((x) => `${x.name}: ${this.plugin.s.queue.reasons[x.reason]}`).join("\n"));
        row.createEl("button", { text: t.dismiss }).addEventListener("click", () => void this.plugin.clearRejected());
      }
    }

    // Due dates from Tasks plugin lines. Clicking a row opens its note at that line; Done checks it off.
    if (snap?.dueTasks === null) {
      const dBody = this.section(root, { icon: "calendar-clock", title: t.due, count: 0, buttons: [] });
      dBody.createDiv({ cls: "secretary-empty", text: t.dueOff });
    } else {
      const due = classifyDue(snap?.dueTasks ?? [], now);
      const rows: [DueTask, string][] = [
        ...due.overdue.map((d): [DueTask, string] => [d, t.overdueTag]),
        ...due.today.map((d): [DueTask, string] => [d, t.todayTag]),
        ...due.tomorrow.map((d): [DueTask, string] => [d, t.tomorrowTag]),
      ];
      const dBody = this.section(root, { icon: "calendar-clock", title: t.due, count: due.overdue.length + due.today.length, buttons: [] });
      if (rows.length === 0 && due.later.length === 0) dBody.createDiv({ cls: "secretary-empty", text: t.noDue });
      for (const [task, tag] of rows) this.dueRow(dBody, task, tag, tag === t.overdueTag);
      // Later due dates are counted on one line, as later reminders are, and listed when it is opened.
      if (due.later.length > 0) {
        this.fold(dBody, "due-later", t.laterDue(due.later.length), (body) => {
          for (const task of due.later) this.dueRow(body, task, shortDate(task.due, ymd(now)), false);
        });
      }
      this.doneList(dBody, "due", ymd(now));
    }

    const reminders = snap?.reminders ?? [];
    // Passed but not checked off (waiting in the alert, or its alert was closed elsewhere) first.
    const passed = dueReminders(reminders, now);
    const upcoming = [...passed, ...upcomingToday(reminders, now)];
    const c = this.plugin.s.commands;
    const rBody = this.section(root, {
      icon: "alarm-clock",
      title: t.reminders,
      count: upcoming.length,
      buttons: [
        { text: c.addReminder, icon: "plus", onClick: () => this.plugin.openReminderModal() },
        { text: c.openReminders, icon: "file-text", onClick: () => this.plugin.openReminders() },
      ],
    });
    if (upcoming.length === 0) rBody.createDiv({ cls: "secretary-empty", text: t.noReminders });
    // Clicking a reminder edits its date, time and text; Ctrl+click, or its menu, opens its line in
    // the note (to delete it there). Done checks it off.
    for (const r of upcoming) this.reminderRow(rBody, r, ymd(now), passed.includes(r));
    // Reminders on later days are counted on one line and listed, soonest first, when it is opened.
    const later = laterDays(reminders, now).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (later.length > 0) {
      this.fold(rBody, "reminders-later", t.later(later.length), (body) => {
        for (const r of later) this.reminderRow(body, r, ymd(now), false);
      });
    }
    this.doneList(rBody, "reminder", ymd(now));

    const inbox = snap?.inbox ?? [];
    const iBody = this.section(root, {
      icon: "inbox",
      title: t.inbox,
      count: inbox.length,
      buttons: [
        { text: c.capture, icon: "plus", onClick: () => this.plugin.openCaptureModal() },
        { text: c.openInbox, icon: "file-text", onClick: () => this.plugin.openInbox() },
      ],
    });
    if (inbox.length === 0) iBody.createDiv({ cls: "secretary-empty", text: t.emptyInbox });
    // As with reminders: clicking an item edits its text, Ctrl+click or its menu opens its line.
    // Each can also become a reminder (it then leaves the inbox) or be checked off as dealt with.
    for (const item of inbox) {
      const row = iBody.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
      // When it was added is a muted, short label, so the text has the row.
      const text = row.createDiv({ cls: "secretary-reminder-text" });
      const parts = splitStamp(item, ymd(now));
      if (parts) text.createSpan({ cls: "secretary-stamp", text: parts.stamp });
      this.plugin.links.render(text.createSpan(), parts?.text ?? item);
      row.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey) void this.plugin.openInboxItem(item);
        else this.plugin.editInboxItem(item);
      });
      setTooltip(row, t.inboxTip);
      row.addEventListener("contextmenu", (event) => {
        const menu = new Menu();
        menu.addItem((i) => i.setTitle(t.edit).setIcon("pencil").onClick(() => this.plugin.editInboxItem(item)));
        menu.addItem((i) => i.setTitle(t.openLine).setIcon("file-text").onClick(() => void this.plugin.openInboxItem(item)));
        menu.addItem((i) => i.setTitle(t.toReminder).setIcon("alarm-clock").onClick(() => this.plugin.remindFromInbox(item)));
        menu.addItem((i) => i.setTitle(t.done).setIcon("check").onClick(() => void this.plugin.completeInboxItem(item)));
        menu.addSeparator();
        menu.addItem((i) => i.setTitle(t.delete).setIcon("trash-2").setWarning(true).onClick(() => void this.plugin.deleteInboxItem(item)));
        menu.showAtMouseEvent(event);
      });
      const button = (text: string, run: () => void) =>
        row.createEl("button", { text }).addEventListener("click", (event) => {
          event.stopPropagation();
          run();
        });
      button(t.toReminder, () => this.plugin.remindFromInbox(item));
      button(t.done, () => void this.plugin.completeInboxItem(item));
    }
    this.doneList(iBody, "inbox", ymd(now));

    if (snap) root.createDiv({ cls: "secretary-note secretary-footer", text: t.checkedAt(hm(snap.now)) });
  }

  /**
   * One line under the section, "Done today (2)", that opens the ones checked off today, struck
   * through, each with Undo: a Done pressed by mistake can be found again until the day is over.
   */
  private doneList(body: HTMLElement, kind: DoneKind, today: string): void {
    const t = this.plugin.s.panel;
    const entries = this.plugin.doneToday.filter((e) => e.kind === kind);
    if (entries.length === 0) return;
    this.fold(body, `done-${kind}`, t.doneToday(entries.length), (list) => {
      // The latest first.
      for (const entry of [...entries].reverse()) {
        const row = list.createDiv({ cls: "secretary-row secretary-reminder secretary-done" });
        row.createDiv({ cls: "secretary-reminder-text", text: doneLabel(entry, today) });
        row.createEl("button", { text: t.undo }).addEventListener("click", () => void this.plugin.undoDone(entry));
      }
    });
  }

  /**
   * One muted line with a chevron that opens a list under it, so what is not for now takes a single
   * line until it is wanted.
   */
  private fold(body: HTMLElement, key: string, label: string, fill: (body: HTMLElement) => void): void {
    const open = this.openFolds.has(key);
    const toggle = body.createDiv({ cls: "secretary-note secretary-clickable secretary-fold" });
    setIcon(toggle.createSpan({ cls: "secretary-fold-icon" }), open ? "chevron-down" : "chevron-right");
    toggle.createSpan({ text: label });
    toggle.setAttr("aria-expanded", String(open));
    toggle.addEventListener("click", () => {
      if (open) this.openFolds.delete(key);
      else this.openFolds.add(key);
      this.render();
    });
    // Indented under a guide line, so what belongs to the fold reads apart from the rows around it.
    if (open) fill(body.createDiv({ cls: "secretary-fold-body" }));
  }

  /**
   * A due task: its tag (overdue, today, tomorrow, or the date) and text. A click opens its line;
   * Done, or its menu, checks it off.
   */
  private dueRow(body: HTMLElement, task: DueTask, tag: string, warn: boolean): void {
    const t = this.plugin.s.panel;
    const row = body.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
    const text = row.createDiv({ cls: "secretary-reminder-text" });
    text.createSpan({ cls: warn ? "secretary-time secretary-warning" : "secretary-time", text: tag });
    text.createSpan({ text: task.text });
    row.setAttr("title", `${task.due}  ${task.path}`);
    row.addEventListener("click", () => void this.plugin.openTask(task));
    row.addEventListener("contextmenu", (event) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle(t.openLine).setIcon("file-text").onClick(() => void this.plugin.openTask(task)));
      menu.addItem((i) => i.setTitle(t.done).setIcon("check").onClick(() => void this.plugin.completeTask(task)));
      menu.showAtMouseEvent(event);
    });
    row.createEl("button", { text: t.done }).addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.completeTask(task);
    });
  }

  /**
   * A reminder. Clicking it edits its date, time and text; Ctrl+click, or its menu, opens its line in
   * the note. Done checks it off.
   */
  private reminderRow(body: HTMLElement, r: Reminder, today: string, passed: boolean): void {
    const t = this.plugin.s.panel;
    const row = body.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
    const text = row.createDiv({ cls: "secretary-reminder-text" });
    if (passed) text.createSpan({ cls: "secretary-time secretary-warning", text: t.overdueTag });
    text.createSpan({ cls: "secretary-time", text: r.date === today ? r.time : `${shortDate(r.date, today)} ${r.time}` });
    this.plugin.links.render(text.createSpan(), r.text);
    row.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) void this.plugin.openReminder(r);
      else this.plugin.editReminder(r);
    });
    setTooltip(row, t.reminderTip);
    row.addEventListener("contextmenu", (event) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle(t.edit).setIcon("pencil").onClick(() => this.plugin.editReminder(r)));
      menu.addItem((i) => i.setTitle(t.openLine).setIcon("file-text").onClick(() => void this.plugin.openReminder(r)));
      menu.addItem((i) => i.setTitle(t.done).setIcon("check").onClick(() => void this.plugin.completeReminder(r)));
      menu.addSeparator();
      menu.addItem((i) => i.setTitle(t.delete).setIcon("trash-2").setWarning(true).onClick(() => void this.plugin.deleteReminder(r)));
      menu.showAtMouseEvent(event);
    });
    row.createEl("button", { text: t.done }).addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.completeReminder(r);
    });
  }

  private section(root: HTMLElement, o: SectionOptions): HTMLElement {
    const section = root.createDiv({ cls: "secretary-section" });
    const head = section.createDiv({ cls: "secretary-head" });
    const title = head.createDiv({ cls: "secretary-title" });
    setIcon(title.createSpan({ cls: "secretary-title-icon" }), o.icon);
    title.createSpan({ text: o.count > 0 ? `${o.title} (${o.count})` : o.title });
    const actions = head.createDiv({ cls: "secretary-actions" });
    for (const b of o.buttons) {
      if (b.icon) {
        const el = actions.createDiv({ cls: "clickable-icon", attr: { "aria-label": b.text } });
        setIcon(el, b.icon);
        setTooltip(el, b.text);
        el.addEventListener("click", b.onClick);
      } else {
        actions.createEl("button", { text: b.text }).addEventListener("click", b.onClick);
      }
    }
    return section.createDiv({ cls: "secretary-body" });
  }
}
