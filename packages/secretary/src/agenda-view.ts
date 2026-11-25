import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { agenda, AGENDA_DAYS, weekday, weekOf, type AgendaItem } from "./agenda.ts";
import { shortDate } from "./inbox.ts";
import { dueRow, reminderRow } from "./rows.ts";
import { addDays, daysBetween } from "./tasks.ts";
import { ymd } from "./time.ts";
import type Secretary from "./main";

export const AGENDA_VIEW = "secretary-agenda";

/**
 * The next weeks at a glance, in a tab: reminders and due tasks under the day they fall on, with
 * what is overdue first under its own heading. Only days with something are shown (today always
 * is), and each week opens with a heading of its name and dates. Rows act as in the side panel.
 * Redrawn when what it shows has changed.
 */
export class AgendaView extends ItemView {
  /** How many days are shown; "show more" adds four weeks, and reopening starts from four again. */
  private span = AGENDA_DAYS;

  constructor(leaf: WorkspaceLeaf, private plugin: Secretary) {
    super(leaf);
  }

  getViewType(): string {
    return AGENDA_VIEW;
  }

  getDisplayText(): string {
    return this.plugin.s.panel.agenda;
  }

  /** The tab's right-click menu and the "More options" menu also open the side panel. */
  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((i) => i.setTitle(this.plugin.s.commands.openPanel).setIcon("bell").setSection("open").onClick(() => void this.plugin.openPanel()));
    super.onPaneMenu(menu, source);
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const t = this.plugin.s.panel;
    const c = this.plugin.s.commands;
    const snap = this.plugin.snapshot;
    const root = this.contentEl;
    root.empty();
    root.addClass("secretary-agenda");
    const now = snap?.now ?? new Date();
    const today = ymd(now);
    const plan = agenda(snap?.reminders ?? [], snap?.dueTasks ?? [], now, this.span);

    const head = root.createDiv({ cls: "secretary-agenda-head" });
    head.createDiv({ cls: "secretary-agenda-title", text: t.agendaHeading(this.span / 7) });
    const add = head.createDiv({ cls: "clickable-icon", attr: { "aria-label": c.addReminder } });
    setIcon(add, "plus");
    setTooltip(add, c.addReminder);
    add.addEventListener("click", () => this.plugin.openReminderModal());

    // What is overdue opens the list, laid out like the weeks under it: a heading, then each date on
    // the left (in the warning color) with its items on the right.
    if (plan.overdue.length > 0) {
      const heading = root.createDiv({ cls: "secretary-agenda-week" });
      heading.createSpan({ cls: "secretary-agenda-week-name", text: t.agendaOverdue });
      heading.createSpan({ cls: "secretary-agenda-week-range", text: t.itemCount(plan.overdue.length) });
      const byDate = new Map<string, AgendaItem[]>();
      for (const item of plan.overdue) {
        const date = item.kind === "due" ? item.task.due : item.reminder.date;
        byDate.set(date, [...(byDate.get(date) ?? []), item]);
      }
      for (const [d, items] of byDate) {
        const day = root.createDiv({ cls: "secretary-agenda-day is-overdue" });
        const date = day.createDiv({ cls: "secretary-agenda-date" });
        date.createDiv({ cls: "secretary-agenda-daynum is-short", text: shortDate(d, today) });
        date.createDiv({ cls: "secretary-agenda-weekday", text: t.weekdays[weekday(d)] });
        const list = day.createDiv({ cls: "secretary-agenda-items" });
        for (const item of items) this.row(list, item, today, true);
      }
    }
    // Today always has its row, so it is clear where the list starts even on a free day.
    const days = plan.days[0]?.date === today ? plan.days : [{ date: today, items: [] }, ...plan.days];
    let week = "";
    for (const d of days) {
      // Each week opens with its name and dates: "This week 11/23 – 11/29".
      if (weekOf(d.date) !== week) {
        week = weekOf(d.date);
        const range = t.weekRange(shortDate(week, today), shortDate(addDays(week, 6), today));
        const name = week === weekOf(today) ? t.thisWeek : week === addDays(weekOf(today), 7) ? t.nextWeek : "";
        const heading = root.createDiv({ cls: "secretary-agenda-week" });
        if (name) heading.createSpan({ cls: "secretary-agenda-week-name", text: name });
        heading.createSpan({ cls: "secretary-agenda-week-range", text: range });
      }
      // The date on the left, large, and the day's items on the right.
      const wd = weekday(d.date);
      const day = root.createDiv({
        cls: ["secretary-agenda-day", ...(d.date === today ? ["is-today"] : []), ...(wd === 0 ? ["is-sunday"] : wd === 6 ? ["is-saturday"] : [])],
      });
      const date = day.createDiv({ cls: "secretary-agenda-date" });
      date.createDiv({ cls: "secretary-agenda-daynum", text: String(Number(d.date.slice(8))) });
      const near = d.date === today ? t.todayTag : d.date === addDays(today, 1) ? t.tomorrowTag : "";
      date.createDiv({ cls: "secretary-agenda-weekday", text: near ? `${t.weekdays[wd]} · ${near}` : t.weekdays[wd] });
      // Shown on hover: a reminder on this day, with the date already filled in.
      const addHere = date.createDiv({ cls: "secretary-agenda-add clickable-icon", attr: { "aria-label": t.addOn(shortDate(d.date, today)), role: "button", tabindex: "0" } });
      setIcon(addHere, "plus");
      setTooltip(addHere, t.addOn(shortDate(d.date, today)));
      addHere.addEventListener("click", () => this.plugin.openReminderModal(d.date));
      addHere.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        this.plugin.openReminderModal(d.date);
      });
      const items = day.createDiv({ cls: "secretary-agenda-items" });
      if (d.items.length === 0) items.createDiv({ cls: "secretary-empty", text: t.agendaFree });
      for (const item of d.items) this.row(items, item, today, false);
    }
    // Further ahead on request, four weeks at a time.
    if (plan.beyond > 0) {
      const more = root.createEl("button", { cls: "secretary-agenda-more", text: t.agendaMore(plan.beyond) });
      more.addEventListener("click", () => {
        this.span += AGENDA_DAYS;
        this.render();
      });
    }
  }

  /** One reminder or due task. Under a day only its time (or "due") is shown; overdue ones keep their date. */
  private row(body: HTMLElement, item: AgendaItem, today: string, overdue: boolean): void {
    const t = this.plugin.s.panel;
    if (item.kind === "due") {
      const tag = overdue ? t.overdueDays(daysBetween(item.task.due, today)) : t.dueTag;
      dueRow(this.plugin, body, item.task, tag, overdue, today);
    } else {
      const r = item.reminder;
      reminderRow(this.plugin, body, r, overdue && r.date !== today ? `${shortDate(r.date, today)} ${r.time}` : r.time, overdue);
    }
  }
}
