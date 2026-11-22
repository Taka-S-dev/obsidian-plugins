// What to show and what to announce at the reminder times, from what was read. Pure module.
// To add a check: read its data into Snapshot in main.ts, then add a function to CHECKS here.
// Reminders themselves are announced by main.ts at their own time (see reminders.ts).

import { unread, type Bulletin, type Rejected } from "./bulletins.ts";
import type { Strings } from "./i18n.ts";
import { upcomingToday, type Reminder } from "./reminders.ts";
import { classifyDue, type DueTask } from "./tasks.ts";

export interface Snapshot {
  now: Date;
  /** Unsorted inbox items; null when the inbox note does not exist. */
  inbox: string[] | null;
  /** null when the reminders note does not exist. */
  reminders: Reminder[] | null;
  /** Announcements received through the queue, newest first. */
  bulletins: Bulletin[];
  /** Queue files that could not be used, most recent last. */
  rejected: Rejected[];
  /** Open tasks with a due date (Tasks plugin format); null when the due-date check is off. */
  dueTasks: DueTask[] | null;
}

export interface Alert {
  /** Announced at most once a day per key. */
  key: string;
  title: string;
  body: string;
}

export interface CheckResult {
  /** Short text for the status bar; omitted when there is nothing to show. */
  status?: string;
  /** Lines for the summary shown on click. */
  details: string[];
  alerts: Alert[];
}

/** slot is the reminder time ("09:00") that has most recently passed today, or null before the first. */
export type Check = (snap: Snapshot, slot: string | null, s: Strings) => CheckResult;

const LIST_LIMIT = 5;
const STATUS_TEXT_LIMIT = 14;

function listed(heading: string, items: string[], s: Strings): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, LIST_LIMIT).map((i) => `・${i}`);
  if (items.length > LIST_LIMIT) shown.push(s.summary.more(items.length - LIST_LIMIT));
  return [`${heading} (${items.length})`, ...shown];
}

function shorten(text: string): string {
  return text.length > STATUS_TEXT_LIMIT ? `${text.slice(0, STATUS_TEXT_LIMIT).trimEnd()}…` : text;
}

export const inboxCheck: Check = (snap, slot, s) => {
  const items = snap.inbox ?? [];
  if (items.length === 0) return { details: [], alerts: [] };
  const alerts: Alert[] =
    slot === null
      ? []
      : [{ key: `inbox@${slot}`, title: s.alerts.inbox(items.length), body: items.slice(0, LIST_LIMIT).join("\n") }];
  return { status: s.status.inbox(items.length), details: listed(s.summary.inbox, items, s), alerts };
};

export const reminderCheck: Check = (snap, _slot, s) => {
  const next = upcomingToday(snap.reminders ?? [], snap.now);
  if (next.length === 0) return { details: [], alerts: [] };
  return {
    status: s.status.next(next[0].time, shorten(next[0].text)),
    details: listed(s.summary.reminders, next.map((r) => `${r.time} ${r.text}`), s),
    alerts: [],
  };
};

export const bulletinCheck: Check = (snap, _slot, s) => {
  const items = unread(snap.bulletins);
  const details = listed(s.summary.bulletins, items.map((b) => (b.source ? `${b.text} (${b.source})` : b.text)), s);
  if (snap.rejected.length > 0) details.push(s.summary.rejected(snap.rejected.length));
  return { status: items.length ? s.status.bulletins(items.length) : undefined, details, alerts: [] };
};

export const dueCheck: Check = (snap, slot, s) => {
  const { overdue, today, tomorrow } = classifyDue(snap.dueTasks ?? [], snap.now);
  if (overdue.length + today.length + tomorrow.length === 0) return { details: [], alerts: [] };
  const line = (t: DueTask) => `${t.due} ${t.text}`;
  const details = [
    ...listed(s.summary.overdue, overdue.map(line), s),
    ...listed(s.summary.dueToday, today.map(line), s),
    ...listed(s.summary.dueTomorrow, tomorrow.map(line), s),
  ];
  const all = [...overdue, ...today, ...tomorrow];
  const alerts: Alert[] =
    slot === null
      ? []
      : [{
          key: `due@${slot}`,
          title: s.alerts.due(overdue.length, today.length, tomorrow.length),
          body: all.slice(0, LIST_LIMIT).map(line).join("\n"),
        }];
  const status = overdue.length + today.length > 0 ? s.status.due(overdue.length, today.length) : undefined;
  return { status, details, alerts };
};

export const CHECKS: Check[] = [bulletinCheck, dueCheck, reminderCheck, inboxCheck];

export interface Report {
  status: string;
  details: string[];
  alerts: Alert[];
}

export function evaluate(snap: Snapshot, slot: string | null, s: Strings, checks: Check[] = CHECKS): Report {
  const results = checks.map((c) => c(snap, slot, s));
  const parts = results.map((r) => r.status).filter((x): x is string => Boolean(x));
  const details = results.flatMap((r) => r.details);
  return {
    status: parts.length ? parts.join(" | ") : s.status.clear,
    details: details.length ? details : [s.summary.nothing],
    alerts: results.flatMap((r) => r.alerts),
  };
}

// ---- reminder times ----

/** "09:00, 16:30" -> ["09:00", "16:30"]: valid times only, zero-padded, sorted, without duplicates. */
export function parseSlots(text: string): string[] {
  const slots = new Set<string>();
  for (const part of text.split(/[,、\s]+/)) {
    const m = part.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    slots.add(`${String(h).padStart(2, "0")}:${m[2]}`);
  }
  return [...slots].sort();
}

/** The latest slot at or before now ("HH:MM"), or null. slots must come from parseSlots. */
export function currentSlot(slots: string[], now: Date): string | null {
  const nowText = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  let hit: string | null = null;
  for (const slot of slots) if (slot <= nowText) hit = slot;
  return hit;
}

// ---- what has been announced ----

export interface Announced {
  /** YYYY-MM-DD the keys belong to. */
  date: string;
  keys: string[];
}

/** Keeps saved keys only for today; anything malformed starts empty. */
export function loadAnnounced(saved: unknown, today: string): Announced {
  const data = saved as Partial<Announced> | null | undefined;
  if (data && data.date === today && Array.isArray(data.keys)) {
    return { date: today, keys: data.keys.filter((k): k is string => typeof k === "string") };
  }
  return { date: today, keys: [] };
}

/** Alerts not yet announced today, and the state after announcing them. */
export function pickNew(state: Announced, today: string, alerts: Alert[]): { next: Announced; fresh: Alert[] } {
  const keys = state.date === today ? new Set(state.keys) : new Set<string>();
  const fresh = alerts.filter((a) => !keys.has(a.key));
  for (const a of fresh) keys.add(a.key);
  return { next: { date: today, keys: [...keys] }, fresh };
}
