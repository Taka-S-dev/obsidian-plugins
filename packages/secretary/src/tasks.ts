// Due dates written the way the Tasks plugin writes them, anywhere in the vault. Pure module (no Obsidian imports).
//
//   - [ ] Renew the passport 📅 2026-11-25
//   - [/] Review the contract ⏫ 📅 2026-11-21     <- in progress still counts
//   - [x] Book the room 📅 2026-11-20 ✅ 2026-11-19 <- done, ignored
//
//   - [ ] [Call the bank](https://example.com) 📅 2026-11-22  <- listed as "Call the bank"
//
// Only the due date (📅) is read. Recurrence, priorities and other fields are left to the Tasks plugin.

import { ymd } from "./time.ts";

export interface DueTask {
  path: string;
  /** Index of the line in the note (lines split on "\n"). */
  line: number;
  /** The task text without the Tasks fields, with links shown as their words. */
  text: string;
  /** The same text as written, links included, for the panel to show them as links. */
  body: string;
  /** YYYY-MM-DD */
  due: string;
  /** The line as it was read, without a trailing "\r", so a write can check it is still there. */
  raw: string;
}

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;
const DUE = /📅️?\s*(\d{4})-(\d{2})-(\d{2})/u;
/** Done and cancelled, as the Tasks plugin marks them. Any other status is still open. */
const CLOSED = new Set(["x", "X", "-"]);
/** Where the Tasks fields start: dates, recurrence, priorities, id and dependencies. */
const FIELDS = /\s*(?:📅|⏳|🛫|➕|✅|❌|🔁|⏫|🔼|🔽|🔺|⏬|🆔|⛔|🏁)/u;

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Open tasks with a due date. A note without "📅" is skipped without splitting it into lines. */
export function parseDueTasks(content: string, path: string): DueTask[] {
  if (!content.includes("📅")) return [];
  const out: DueTask[] = [];
  content.split("\n").forEach((rawLine, line) => {
    const m = rawLine.replace(/\r$/, "").match(TASK);
    if (!m || CLOSED.has(m[1])) return;
    const due = m[2].match(DUE);
    if (!due) return;
    const [, y, mo, d] = due;
    if (!validDate(+y, +mo, +d)) return;
    const body = beforeFields(m[2]);
    out.push({ path, line, text: plainLinks(body) || body, body, due: `${y}-${mo}-${d}`, raw: rawLine.replace(/\r$/, "") });
  });
  return out;
}

/** A task's text up to the Tasks fields. */
function beforeFields(body: string): string {
  const cut = body.search(FIELDS);
  return (cut < 0 ? body : body.slice(0, cut)).trim() || body.trim();
}

/** A task's text without the Tasks fields, with links shown as their words. */
function words(body: string): string {
  const text = beforeFields(body);
  return plainLinks(text) || text;
}

/** The task line with its due date (📅) changed to date; everything else stays as written. */
export function setDue(raw: string, date: string): string {
  return raw.replace(DUE, (field) => field.replace(/\d{4}-\d{2}-\d{2}/, date));
}

/** YYYY-MM-DD, n days after the given one. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/** Whole days from one YYYY-MM-DD to another; positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** A task line as the panel shows it: no checkbox and no Tasks fields. */
export function taskText(raw: string): string {
  const m = raw.match(TASK);
  return words(m ? m[2] : raw);
}

/**
 * A task line checked off where the Tasks plugin is not there to do it: only the checkbox changes.
 * Null for a line that is not an open task.
 */
export function checkTask(raw: string): string | null {
  const m = raw.match(TASK);
  if (!m || CLOSED.has(m[1])) return null;
  return raw.replace(/\[.\]/, "[x]");
}

/**
 * `[text](url)` and `![alt](url)`. The text may hold escaped brackets or one level of balanced
 * ones, as CommonMark allows; the url may be in <...>.
 */
const MD_LINK = /!?\[((?:\\.|[^\\[\]]|\[(?:\\.|[^\\[\]])*\])*)\]\((?:<[^>]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"]*")?\)/g;
/** `[[note]]`, `[[note|alias]]`, `[[note#heading]]`, and embeds `![[...]]`. */
const WIKI_LINK = /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;

/**
 * Links turned into the words Obsidian shows for them, so a summary or a notification reads
 * "Renew the passport" instead of the link markup and its address.
 */
export function plainLinks(text: string): string {
  return text
    .replace(MD_LINK, (_, label: string) => label.replace(/\\(.)/g, "$1"))
    .replace(WIKI_LINK, (_, target: string, alias?: string) => (alias ?? target.replace(/^#\^?/, "").replace(/#\^?/, " > ")).trim())
    .replace(/\s+/g, " ")
    .trim();
}

export interface DueSummary {
  overdue: DueTask[];
  today: DueTask[];
  /** Due tomorrow, so it can be prepared for. */
  tomorrow: DueTask[];
  /** Due after tomorrow; the panel counts them and lists them when opened. */
  later: DueTask[];
}

/** Splits open tasks by how close their due date is to now (local dates), soonest first. */
export function classifyDue(tasks: DueTask[], now: Date): DueSummary {
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const sorted = [...tasks].sort((a, b) => a.due.localeCompare(b.due) || a.text.localeCompare(b.text));
  return {
    overdue: sorted.filter((t) => t.due < today),
    today: sorted.filter((t) => t.due === today),
    tomorrow: sorted.filter((t) => t.due === tomorrow),
    later: sorted.filter((t) => t.due > tomorrow),
  };
}
