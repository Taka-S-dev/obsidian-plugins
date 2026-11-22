// Due dates written the way the Tasks plugin writes them, anywhere in the vault. Pure module (no Obsidian imports).
//
//   - [ ] Renew the passport 📅 2026-11-25
//   - [/] Review the contract ⏫ 📅 2026-11-21     <- in progress still counts
//   - [x] Book the room 📅 2026-11-20 ✅ 2026-11-19 <- done, ignored
//
// Only the due date (📅) is read. Recurrence, priorities and other fields are left to the Tasks plugin.

import { ymd } from "./time.ts";

export interface DueTask {
  path: string;
  /** Index of the line in the note (lines split on "\n"). */
  line: number;
  /** The task text without the Tasks fields. */
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
    const text = (cut < 0 ? m[2] : m[2].slice(0, cut)).trim() || m[2].trim();
    out.push({ path, line, text, due: `${y}-${mo}-${d}` });
  });
  return out;
}

export interface DueSummary {
  overdue: DueTask[];
  today: DueTask[];
  /** Due tomorrow, so it can be prepared for. */
  tomorrow: DueTask[];
}

/** Splits open tasks by how close their due date is to now (local dates). Later dates are left out. */
export function classifyDue(tasks: DueTask[], now: Date): DueSummary {
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const sorted = [...tasks].sort((a, b) => a.due.localeCompare(b.due) || a.text.localeCompare(b.text));
  return {
    overdue: sorted.filter((t) => t.due < today),
    today: sorted.filter((t) => t.due === today),
    tomorrow: sorted.filter((t) => t.due === tomorrow),
  };
}
