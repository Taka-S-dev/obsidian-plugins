// The reminders note: one task line per reminder, written by hand, by a script or by an assistant.
// Pure module (no Obsidian imports).
//
//   # Reminders
//
//   - [ ] 2026-11-20 15:00 Renew the car insurance
//   - [x] 2026-11-19 09:30 Check the deadline        <- checked off by the plugin once announced

import { hm, ymd } from "./time.ts";

export interface Reminder {
  /** Index of the line in the note (lines split on "\n"). */
  line: number;
  /** The line as read, without a trailing "\r". Used to make sure it has not changed before writing. */
  raw: string;
  date: string;
  time: string;
  text: string;
  done: boolean;
}

const LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/;

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseReminders(content: string): Reminder[] {
  const out: Reminder[] = [];
  content.split("\n").forEach((rawLine, line) => {
    const raw = rawLine.replace(/\r$/, "");
    const m = raw.match(LINE);
    if (!m) return;
    const [, mark, y, mo, d, h, mi, text] = m;
    if (!validDate(+y, +mo, +d) || +h > 23 || +mi > 59) return;
    out.push({ line, raw, date: `${y}-${mo}-${d}`, time: `${h.padStart(2, "0")}:${mi}`, text: text.trim(), done: mark !== " " });
  });
  return out;
}

const key = (r: Pick<Reminder, "date" | "time">) => `${r.date} ${r.time}`;
const nowKey = (now: Date) => `${ymd(now)} ${hm(now)}`;

/** Not yet checked off and due at or before now, oldest first. */
export function dueReminders(list: Reminder[], now: Date): Reminder[] {
  const k = nowKey(now);
  return list.filter((r) => !r.done && key(r) <= k).sort((a, b) => key(a).localeCompare(key(b)));
}

/** Still to come today, soonest first. */
export function upcomingToday(list: Reminder[], now: Date): Reminder[] {
  const today = ymd(now), k = nowKey(now);
  return list.filter((r) => !r.done && r.date === today && key(r) > k).sort((a, b) => key(a).localeCompare(key(b)));
}

/** Not checked off and on a later day. */
export function laterDays(list: Reminder[], now: Date): Reminder[] {
  const today = ymd(now);
  return list.filter((r) => !r.done && r.date > today);
}

/**
 * Checks the reminder off. Returns null, leaving the note alone, when that line is no longer the
 * line that was read (edited or moved meanwhile).
 */
export function markDone(content: string, r: Reminder): string | null {
  const lines = content.split("\n");
  const current = lines[r.line];
  if (current === undefined || current.replace(/\r$/, "") !== r.raw) return null;
  lines[r.line] = current.replace(/\[ \]/, "[x]");
  return lines.join("\n");
}

/** Deletes the reminder's line. Null, leaving the note alone, when that line changed meanwhile. */
export function removeReminder(content: string, r: Reminder): string | null {
  const lines = content.split("\n");
  const current = lines[r.line];
  if (current === undefined || current.replace(/\r$/, "") !== r.raw) return null;
  lines.splice(r.line, 1);
  return lines.join("\n");
}

export type ReminderCheck =
  | { ok: true; date: string; time: string; text: string }
  | { ok: false; reason: "text" | "date" | "time" | "past" };

/**
 * A reminder from the modal's fields: the text, a date picker's "YYYY-MM-DD" and a time picker's
 * "HH:MM". A time that has already passed is refused, so nothing goes off the moment it is added.
 */
export function checkReminder(text: string, date: string, time: string, now: Date): ReminderCheck {
  const t = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (t === "") return { ok: false, reason: "text" };
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d || !validDate(+d[1], +d[2], +d[3])) return { ok: false, reason: "date" };
  const h = time.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!h || +h[1] > 23 || +h[2] > 59) return { ok: false, reason: "time" };
  const at = `${h[1]}:${h[2]}`;
  if (`${date} ${at}` <= nowKey(now)) return { ok: false, reason: "past" };
  return { ok: true, date, time: at, text: t };
}

/** Days from today to `date` ("YYYY-MM-DD"): 0 today, 1 tomorrow, negative in the past. */
export function daysFrom(date: string, now: Date): number {
  const [y, m, d] = date.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

/**
 * Moves the reminder to a new date and time, leaving it unchecked so it goes off again. Returns
 * null, leaving the note alone, when that line is no longer the line that was read.
 */
export function reschedule(content: string, r: Reminder, date: string, time: string, text = r.text): string | null {
  const lines = content.split("\n");
  const current = lines[r.line];
  if (current === undefined || current.replace(/\r$/, "") !== r.raw) return null;
  const at = current.match(/\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+/);
  if (!at || at.index === undefined) return null;
  const cr = current.endsWith("\r") ? "\r" : "";
  lines[r.line] = `${current.slice(0, at.index)}${date} ${time} ${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}${cr}`;
  return lines.join("\n");
}

/** The same time on the day after today. */
export function tomorrowAt(now: Date, time: string): { date: string; time: string } {
  return { date: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)), time };
}

/** The date and time `minutes` from now, as a reminder line writes them. */
export function later(now: Date, minutes: number): { date: string; time: string } {
  const at = new Date(now.getTime() + minutes * 60_000);
  return { date: ymd(at), time: hm(at) };
}

export function formatReminder(date: string, time: string, text: string): string {
  return `- [ ] ${date} ${time} ${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}`;
}

/**
 * Quick input: "15:00 text" (today, or tomorrow when 15:00 has passed) or "2026-11-21 09:30 text".
 * Returns null when it does not start with a valid time.
 */
export function parseReminderInput(input: string, now: Date): { date: string; time: string; text: string } | null {
  const m = input.trim().match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})\s+)?(\d{1,2}):(\d{2})\s+(.+)$/s);
  if (!m) return null;
  const [, y, mo, d, h, mi, text] = m;
  if (+h > 23 || +mi > 59) return null;
  const time = `${h.padStart(2, "0")}:${mi}`;
  if (y) {
    if (!validDate(+y, +mo, +d)) return null;
    return { date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, time, text: text.trim() };
  }
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (time <= hm(now)) day.setDate(day.getDate() + 1);
  return { date: ymd(day), time, text: text.trim() };
}
