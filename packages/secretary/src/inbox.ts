// The inbox note: one unchecked task line per item not yet sorted. Pure module (no Obsidian imports).
// An item is removed once it has been sorted, so every unchecked line counts as waiting.
//
//   # Inbox
//
//   - [ ] 2026-11-19 10:32 Return the library books by Friday

import { hm, ymd } from "./time.ts";

const OPEN = /^\s*[-*+]\s+\[ \]\s*(.*)$/;

export interface InboxItem {
  /** Index of the line in the note (lines split on "\n"). */
  line: number;
  /** The line as read, without a trailing "\r". Used to make sure it has not changed before removing it. */
  raw: string;
  text: string;
}

/** Each unchecked item, in order. */
export function inboxItems(content: string): InboxItem[] {
  const items: InboxItem[] = [];
  content.split("\n").forEach((rawLine, line) => {
    const raw = rawLine.replace(/\r$/, "");
    const m = raw.match(OPEN);
    if (m) items.push({ line, raw, text: m[1].trim() });
  });
  return items;
}

/** Text of each unchecked item, in order. */
export function openItems(content: string): string[] {
  return inboxItems(content).map((item) => item.text);
}

/** Removes the item's line once it has gone elsewhere; null when that line changed meanwhile. */
export function removeItem(content: string, item: InboxItem): string | null {
  const lines = content.split("\n");
  const current = lines[item.line];
  if (current === undefined || current.replace(/\r$/, "") !== item.raw) return null;
  lines.splice(item.line, 1);
  return lines.join("\n");
}

/** Checks the item off: it is dealt with, and stays in the note as a record. Null when its line changed. */
export function checkItem(content: string, item: InboxItem): string | null {
  const lines = content.split("\n");
  const current = lines[item.line];
  if (current === undefined || current.replace(/\r$/, "") !== item.raw) return null;
  lines[item.line] = current.replace(/\[ \]/, "[x]");
  return lines.join("\n");
}

/** Replaces the item's text, keeping its checkbox and the date and time it was added. Null when its line changed. */
export function editItem(content: string, item: InboxItem, text: string): string | null {
  const lines = content.split("\n");
  const current = lines[item.line];
  if (current === undefined || current.replace(/\r$/, "") !== item.raw) return null;
  const head = item.raw.match(/^\s*[-*+]\s+\[ \]\s*(?:\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+)?/);
  if (!head) return null;
  const cr = current.endsWith("\r") ? "\r" : "";
  lines[item.line] = `${head[0]}${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}${cr}`;
  return lines.join("\n");
}

/** An item's text without the date and time it was added ("2026-11-19 10:32 text" -> "text"). */
export function withoutStamp(text: string): string {
  return text.replace(/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+/, "");
}

/**
 * An item split into when it was added, shortened for the panel, and its text:
 * "2026-11-19 10:32 text" -> { stamp: "11/19 10:32", text: "text" } in 2026. Null without a stamp.
 */
export function splitStamp(item: string, today: string): { stamp: string; text: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+/.exec(item);
  if (!m) return null;
  return { stamp: `${shortDate(m[1], today)} ${m[2]}`, text: item.slice(m[0].length) };
}

/** A YYYY-MM-DD date as M/D in the current year, and as it is in any other. */
export function shortDate(date: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || m[1] !== today.slice(0, 4)) return date;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** One inbox line. Line breaks in the text become spaces so the item stays one line. */
export function formatEntry(now: Date, text: string): string {
  return `- [ ] ${ymd(now)} ${hm(now)} ${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}`;
}

/** Appends the entry at the end. An empty note gets the header first. */
export function appendEntry(content: string, entry: string, header: string): string {
  const body = content.trim() === "" ? `${header}\n` : content.replace(/\s+$/, "");
  return `${body}\n${entry}\n`;
}

/** Folder part of a vault path ("a/b/c.md" -> "a/b", "c.md" -> ""). */
export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
