// What is coming, day by day: reminders and due tasks for the next weeks, for the agenda view.
// Pure module (no Obsidian imports).

import { dueReminders, type Reminder } from "./reminders.ts";
import { addDays, type DueTask } from "./tasks.ts";
import { ymd } from "./time.ts";

export type AgendaItem = { kind: "reminder"; reminder: Reminder } | { kind: "due"; task: DueTask };

export interface AgendaDay {
  /** YYYY-MM-DD */
  date: string;
  /** Due tasks first (they have no time), then reminders by time. */
  items: AgendaItem[];
}

export interface Agenda {
  /** Reminders whose time has passed and tasks past their due date, oldest first. */
  overdue: AgendaItem[];
  /** Only days that have something, from today. */
  days: AgendaDay[];
  /** How many come after the last day shown. */
  beyond: number;
}

/** Four weeks from today, so the next few weeks can be planned at a glance. */
export const AGENDA_DAYS = 28;

export function agenda(reminders: Reminder[], tasks: DueTask[], now: Date, span = AGENDA_DAYS): Agenda {
  const today = ymd(now);
  const last = addDays(today, span - 1);
  const passed = new Set(dueReminders(reminders, now));
  const overdue: { key: string; item: AgendaItem }[] = [];
  const byDay = new Map<string, { tasks: DueTask[]; reminders: Reminder[] }>();
  let beyond = 0;
  const day = (date: string) => {
    let d = byDay.get(date);
    if (!d) byDay.set(date, (d = { tasks: [], reminders: [] }));
    return d;
  };
  for (const task of tasks) {
    if (task.due < today) overdue.push({ key: `${task.due} 00:00`, item: { kind: "due", task } });
    else if (task.due > last) beyond++;
    else day(task.due).tasks.push(task);
  }
  for (const r of reminders) {
    if (r.done) continue;
    if (passed.has(r)) overdue.push({ key: `${r.date} ${r.time}`, item: { kind: "reminder", reminder: r } });
    else if (r.date > last) beyond++;
    else if (r.date >= today) day(r.date).reminders.push(r);
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      items: [
        ...d.tasks.map((task): AgendaItem => ({ kind: "due", task })),
        ...d.reminders.sort((a, b) => a.time.localeCompare(b.time)).map((reminder): AgendaItem => ({ kind: "reminder", reminder })),
      ],
    }));
  overdue.sort((a, b) => a.key.localeCompare(b.key));
  return { overdue: overdue.map((o) => o.item), days, beyond };
}

/** The Monday of the week the date is in, so the agenda can mark where a week starts. */
export function weekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return addDays(date, -((day + 6) % 7));
}

/** 0 (Sunday) to 6 (Saturday). */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
