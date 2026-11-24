import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { unread } from "./bulletins.ts";
import { doneLabel, type DoneKind } from "./done-today.ts";
import { tabHeaderEl } from "./obsidian-internals.ts";
import { dueReminders, laterDays, upcomingToday } from "./reminders.ts";
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
  /** Sections whose "done today" list is open; closed again when the panel is reopened. */
  private openDone = new Set<DoneKind>();

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
        text.createDiv({ cls: "secretary-multiline", text: b.text });
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

    // Due dates from Tasks plugin lines. Clicking a row opens its note at that line.
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
      if (rows.length === 0) dBody.createDiv({ cls: "secretary-empty", text: t.noDue });
      for (const [task, tag] of rows) {
        const row = dBody.createDiv({ cls: "secretary-row secretary-clickable" });
        row.createSpan({ cls: tag === t.overdueTag ? "secretary-time secretary-warning" : "secretary-time", text: tag });
        row.createSpan({ text: task.text });
        row.setAttr("title", `${task.due}  ${task.path}`);
        row.addEventListener("click", () => void this.plugin.openTask(task));
      }
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
    for (const r of upcoming) {
      const row = rBody.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
      const text = row.createDiv({ cls: "secretary-reminder-text" });
      if (passed.includes(r)) text.createSpan({ cls: "secretary-time secretary-warning", text: t.overdueTag });
      text.createSpan({ cls: "secretary-time", text: r.date === ymd(now) ? r.time : `${r.date} ${r.time}` });
      text.createSpan({ text: r.text });
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
        menu.showAtMouseEvent(event);
      });
      row.createEl("button", { text: t.done }).addEventListener("click", (event) => {
        event.stopPropagation();
        void this.plugin.completeReminder(r);
      });
    }
    const later = laterDays(reminders, now).length;
    if (later > 0) rBody.createDiv({ cls: "secretary-note", text: t.later(later) });
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
      row.createDiv({ cls: "secretary-reminder-text", text: item });
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
    const open = this.openDone.has(kind);
    const toggle = body.createDiv({ cls: "secretary-note secretary-clickable secretary-done-toggle" });
    setIcon(toggle.createSpan({ cls: "secretary-done-icon" }), open ? "chevron-down" : "chevron-right");
    toggle.createSpan({ text: t.doneToday(entries.length) });
    toggle.addEventListener("click", () => {
      if (open) this.openDone.delete(kind);
      else this.openDone.add(kind);
      this.render();
    });
    if (!open) return;
    // The latest first.
    for (const entry of [...entries].reverse()) {
      const row = body.createDiv({ cls: "secretary-row secretary-reminder secretary-done" });
      row.createDiv({ cls: "secretary-reminder-text", text: doneLabel(entry, today) });
      row.createEl("button", { text: t.undo }).addEventListener("click", () => void this.plugin.undoDone(entry));
    }
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
