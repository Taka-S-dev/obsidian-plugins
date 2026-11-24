// What was checked off today from the panel or the reminder alert, so a Done pressed by mistake can
// be undone until the day is over. Only the checked line is kept; the note stays the record.
// Pure module (no Obsidian imports).

export type DoneKind = "reminder" | "inbox";

export interface DoneEntry {
  kind: DoneKind;
  /** The line as it reads once checked, without a trailing "\r". */
  line: string;
  /** YYYY-MM-DD it was checked off. */
  date: string;
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
        (e.kind === "reminder" || e.kind === "inbox") &&
        typeof e.line === "string" &&
        CHECKED.test(e.line) &&
        e.date === today,
    )
    .map((e) => ({ kind: e.kind, line: e.line, date: e.date }))
    .slice(-DONE_LIMIT);
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

/** The entry as the panel shows it: no checkbox, and no date when it is today's. */
export function doneLabel(e: DoneEntry, today: string): string {
  const text = e.line.replace(CHECKED, "");
  return text.startsWith(`${today} `) ? text.slice(today.length + 1) : text;
}
