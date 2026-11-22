// Plugin state kept in data.json: announcements from other programs, recently processed queue
// files, and recently rejected ones. Pure module (no Obsidian imports).

import type { RejectReason } from "./queue.ts";

export interface Bulletin {
  id: string;
  /** "YYYY-MM-DD HH:MM", when it was received. */
  at: string;
  source?: string;
  text: string;
  read: boolean;
}

export interface Rejected {
  name: string;
  reason: RejectReason;
  at: string;
}

export const BULLETIN_LIMIT = 100;
export const PROCESSED_LIMIT = 200;
export const REJECTED_LIMIT = 20;

const isString = (v: unknown): v is string => typeof v === "string";

export function loadBulletins(saved: unknown): Bulletin[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((b): b is Bulletin => b && isString(b.id) && isString(b.at) && isString(b.text) && typeof b.read === "boolean")
    .map((b) => ({ id: b.id, at: b.at, text: b.text, read: b.read, ...(isString(b.source) ? { source: b.source } : {}) }))
    .slice(0, BULLETIN_LIMIT);
}

export function loadStrings(saved: unknown, limit: number): string[] {
  return Array.isArray(saved) ? saved.filter(isString).slice(-limit) : [];
}

export function loadRejected(saved: unknown): Rejected[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((r): r is Rejected => r && isString(r.name) && isString(r.reason) && isString(r.at)).slice(-REJECTED_LIMIT);
}

/**
 * Newest first. Beyond the limit, the oldest read ones go first, then the oldest unread, so an
 * unread bulletin is dropped only when there are more unread than the limit.
 */
export function addBulletin(list: Bulletin[], b: Bulletin, limit = BULLETIN_LIMIT): Bulletin[] {
  const next = [b, ...list.filter((x) => x.id !== b.id)];
  while (next.length > limit) {
    let i = next.length - 1;
    while (i >= 0 && !next[i].read) i--;
    next.splice(i >= 0 ? i : next.length - 1, 1);
  }
  return next;
}

/** Takes one bulletin off the list once it has been dealt with, or every read one when id is omitted. */
export function dismiss(list: Bulletin[], id?: string): Bulletin[] {
  return list.filter((b) => (id === undefined ? !b.read : b.id !== id));
}

/** Marks one bulletin as read, or all of them when id is omitted. */
export function markRead(list: Bulletin[], id?: string): Bulletin[] {
  return list.map((b) => (id === undefined || b.id === id ? { ...b, read: true } : b));
}

export function unread(list: Bulletin[]): Bulletin[] {
  return list.filter((b) => !b.read);
}

/** Appends to a bounded list, keeping the most recent. */
export function remember<T>(list: T[], item: T, limit: number): T[] {
  return [...list, item].slice(-limit);
}
