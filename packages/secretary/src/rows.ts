// Rows for a reminder and a due task, shared by the side panel and the agenda, so both act alike.
import { Menu, setTooltip } from "obsidian";
import type { Reminder } from "./reminders.ts";
import { addDays, type DueTask } from "./tasks.ts";
import type Secretary from "./main";

/**
 * A due task: its tag (days overdue, today, tomorrow, or the date) and text, with its links. A
 * click opens its line; Done, or its menu, checks it off, and the menu also moves its due date.
 */
export function dueRow(plugin: Secretary, body: HTMLElement, task: DueTask, tag: string, warn: boolean, today: string): void {
  const t = plugin.s.panel;
  const row = body.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
  const text = row.createDiv({ cls: "secretary-reminder-text" });
  text.createSpan({ cls: warn ? "secretary-time secretary-warning" : "secretary-time", text: tag });
  plugin.links.render(text.createSpan(), task.body);
  row.setAttr("title", `${task.due}  ${task.path}`);
  row.addEventListener("click", () => void plugin.openTask(task));
  row.addEventListener("contextmenu", (event) => {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t.openLine).setIcon("file-text").onClick(() => void plugin.openTask(task)));
    menu.addItem((i) => i.setTitle(t.done).setIcon("check").onClick(() => void plugin.completeTask(task)));
    menu.addSeparator();
    // From today, so an overdue task moves forward, not to the day after its old date.
    const tomorrow = addDays(today, 1);
    if (task.due !== tomorrow) menu.addItem((i) => i.setTitle(t.toTomorrow).setIcon("calendar-plus").onClick(() => void plugin.moveTask(task, tomorrow)));
    menu.addItem((i) => i.setTitle(t.toNextWeek).setIcon("calendar-range").onClick(() => void plugin.moveTask(task, addDays(today, 7))));
    menu.addItem((i) => i.setTitle(t.pickDate).setIcon("calendar").onClick(() => plugin.pickTaskDate(task)));
    menu.showAtMouseEvent(event);
  });
  row.createEl("button", { text: t.done }).addEventListener("click", (event) => {
    event.stopPropagation();
    void plugin.completeTask(task);
  });
}

/**
 * A reminder, after its time (and "overdue" once passed). Clicking it edits its date, time and
 * text; Ctrl+click, or its menu, opens its line in the note. Done checks it off.
 */
export function reminderRow(plugin: Secretary, body: HTMLElement, r: Reminder, when: string, passed: boolean): void {
  const t = plugin.s.panel;
  const row = body.createDiv({ cls: "secretary-row secretary-clickable secretary-reminder" });
  const text = row.createDiv({ cls: "secretary-reminder-text" });
  if (passed) text.createSpan({ cls: "secretary-time secretary-warning", text: t.overdueTag });
  text.createSpan({ cls: "secretary-time", text: when });
  plugin.links.render(text.createSpan(), r.text);
  row.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey) void plugin.openReminder(r);
    else plugin.editReminder(r);
  });
  setTooltip(row, t.reminderTip);
  row.addEventListener("contextmenu", (event) => {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t.edit).setIcon("pencil").onClick(() => plugin.editReminder(r)));
    menu.addItem((i) => i.setTitle(t.openLine).setIcon("file-text").onClick(() => void plugin.openReminder(r)));
    menu.addItem((i) => i.setTitle(t.done).setIcon("check").onClick(() => void plugin.completeReminder(r)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t.delete).setIcon("trash-2").setWarning(true).onClick(() => void plugin.deleteReminder(r)));
    menu.showAtMouseEvent(event);
  });
  row.createEl("button", { text: t.done }).addEventListener("click", (event) => {
    event.stopPropagation();
    void plugin.completeReminder(r);
  });
}
