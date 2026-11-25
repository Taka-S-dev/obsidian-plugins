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
  /** YYYY-MM-DD */
  due: string;
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
    const cut = m[2].search(FIELDS);
    const raw = (cut < 0 ? m[2] : m[2].slice(0, cut)).trim() || m[2].trim();
    out.push({ path, line, text: plainLinks(raw) || raw, due: `${y}-${mo}-${d}` });
  });
  return out;
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
