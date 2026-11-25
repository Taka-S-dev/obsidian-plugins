// Undoing Done and Delete. What was checked off today from the panel or the reminder alert is kept,
// so a Done pressed by mistake can be undone until the day is over; only the checked line (and, for a
// due task, the line it was) is kept, and the note stays the record. A deleted line can be put back.
// Pure module (no Obsidian imports).

import { plainText } from "./links.ts";
import { taskText } from "./tasks.ts";

export type DoneKind = "reminder" | "inbox" | "due";

export interface DoneEntry {
  kind: DoneKind;
  /**
   * The line as it reads once checked, without a trailing "\r". For a due task, what replaced it:
   * with a repeating task, the next one's line and the checked line, joined by "\n".
   */
  line: string;
  /** YYYY-MM-DD it was checked off. */
  date: string;
  /** Due tasks only: the note, and the line as it was before, which Undo puts back. */
  path?: string;
  before?: string;
}

export const DONE_LIMIT = 100;

const CHECKED = /^\s*[-*+]\s+\[[xX]\]\s*/;

/** Today's entries from saved data; anything malformed or from an earlier day is dropped. */
export function loadDone(raw: unknown, today: string): DoneEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is DoneEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.line === "string" &&
        e.date === today &&
        (((e.kind === "reminder" || e.kind === "inbox") && CHECKED.test(e.line)) ||
          (e.kind === "due" && typeof e.path === "string" && typeof e.before === "string")),
    )
    .map((e) => (e.kind === "due" ? { kind: e.kind, line: e.line, date: e.date, path: e.path, before: e.before } : { kind: e.kind, line: e.line, date: e.date }))
    .slice(-DONE_LIMIT);
}

/**
 * Puts `after` (one or more lines) in place of a task line that still reads `raw`: the one at
 * index, or else the first that reads the same. Null when the line is no longer there.
 */
export function replaceLine(content: string, index: number, raw: string, after: string): string | null {
  const lines = content.split("\n");
  const same = (l: string | undefined) => l !== undefined && l.replace(/\r$/, "") === raw;
  const at = same(lines[index]) ? index : lines.findIndex(same);
  if (at < 0) return null;
  const cr = lines[at].endsWith("\r") ? "\r" : "";
  lines.splice(at, 1, ...after.split("\n").map((l) => `${l}${cr}`));
  return lines.join("\n");
}

/** Where the lines of `block` stand together in the note, or -1. */
function findBlock(lines: string[], block: string[]): number {
  for (let i = 0; i + block.length <= lines.length; i++) {
    if (block.every((b, j) => lines[i + j].replace(/\r$/, "") === b)) return i;
  }
  return -1;
}

/** Undoes replaceLine: the lines that replaced a task go, and the task as it was comes back. */
export function restoreLine(content: string, after: string, before: string): string | null {
  const lines = content.split("\n");
  const block = after.split("\n");
  const at = findBlock(lines, block);
  if (at < 0) return null;
  const cr = lines[at].endsWith("\r") ? "\r" : "";
  lines.splice(at, block.length, `${before}${cr}`);
  return lines.join("\n");
}

/** Drops the due entries of one note whose lines are no longer in it as written. */
export function dueStillDone(entries: DoneEntry[], path: string, content: string | null): DoneEntry[] {
  if (content === null) return entries;
  const lines = content.split("\n");
  return entries.filter((e) => e.kind !== "due" || e.path !== path || findBlock(lines, e.line.split("\n")) >= 0);
}

/** The line a "- [ ]" line becomes once checked off, as the panel and the alert write it. */
export function checkedLine(raw: string): string {
  return raw.replace(/\[ \]/, "[x]");
}

/** Unchecks the first line that still reads as it was checked off; null when there is none. */
export function uncheck(content: string, line: string): string | null {
  const lines = content.split("\n");
  const i = lines.findIndex((l) => l.replace(/\r$/, "") === line);
  if (i < 0) return null;
  lines[i] = lines[i].replace(/\[[xX]\]/, "[ ]");
  return lines.join("\n");
}

/**
 * Drops the entries of one kind whose line is no longer in its note, checked (unchecked or deleted
 * by hand meanwhile). A note that could not be read keeps its entries.
 */
export function stillChecked(entries: DoneEntry[], kind: DoneKind, content: string | null): DoneEntry[] {
  if (content === null) return entries;
  const lines = new Set(content.split("\n").map((l) => l.replace(/\r$/, "")));
  return entries.filter((e) => e.kind !== kind || lines.has(e.line));
}

/** A task line as the panel and its notices show it: no checkbox, and no date when it is today's. */
export function lineLabel(line: string, today: string): string {
  const text = plainText(line.replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, ""));
  return text.startsWith(`${today} `) ? text.slice(today.length + 1) : text;
}

/** What the panel and the notice show for an entry; a due task without its Tasks fields. */
export function doneLabel(entry: DoneEntry, today: string): string {
  return entry.kind === "due" && entry.before !== undefined ? taskText(entry.before) : lineLabel(entry.line, today);
}

/**
 * Puts a deleted line back where it was: before the line now at that index, or at the end. The
 * note's line ending is kept.
 */
export function insertLine(content: string, index: number, line: string): string {
  const lines = content.split("\n");
  const cr = lines[0].endsWith("\r") ? "\r" : "";
  // A note ending in a line break splits into a last empty piece; the line goes before it.
  const end = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const at = Math.max(0, Math.min(index, end));
  if (at === lines.length) {
    // After a last line that has no line break: that line gets one, the restored line none.
    if (at > 0) lines[at - 1] += cr;
    lines.push(line);
  } else {
    lines.splice(at, 0, `${line}${cr}`);
  }
  return lines.join("\n");
}
