// Shifts a Day Planner time block in note text. Pure: no Obsidian imports, so it is unit-testable.

export type RescheduleResult =
  | { ok: true; content: string; from: string; to: string; before: string; after: string }
  | { ok: false; reason: "not-found" | "ambiguous" | "past-midnight" };

export type RestoreResult = { ok: true; content: string } | { ok: false; reason: "not-found" | "ambiguous" };

// "- [ ] 09:00 - 10:00 task", "* 9:00-10:00 task", "1. 09:00 task". Only open tasks or plain bullets:
// "[x]", "[-]" etc. never match, so finished or cancelled blocks are left alone.
const BLOCK_LINE =
  /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[ \]\s+)?)(\d{1,2}):(\d{2})(?:(\s*-\s*)(\d{1,2}):(\d{2}))?(\s+)(.*)$/;

const DAY = 24 * 60;

function toMinutes(h: string, m: string): number | null {
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(total: number, padHour: boolean): string {
  const h = String(Math.floor(total / 60));
  const m = String(total % 60).padStart(2, "0");
  return `${padHour ? h.padStart(2, "0") : h}:${m}`;
}

/** "15, 30,45 60" -> [15, 30, 45, 60]. Drops invalid, duplicate and out-of-range values. */
export function parsePostponeOptions(text: string): number[] {
  const values = text
    .split(/[\s,、]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12 * 60);
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Start time of Day Planner's notification body, e.g. "17:00 - 18:30" -> 1020. */
export function startMinutesOf(time: string): number | null {
  const m = time.match(/(\d{1,2}):(\d{2})/);
  return m ? toMinutes(m[1], m[2]) : null;
}

export function rescheduleBlock(
  content: string,
  task: string,
  startMinutes: number,
  shiftMinutes: number,
): RescheduleResult {
  const wanted = task.trim();
  const lines = content.split("\n");
  // "." in the pattern does not match "\r", so match on the line body and restore the ending on write.
  const bodies = lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const exact: number[] = [];
  const loose: number[] = [];

  bodies.forEach((line, i) => {
    const m = BLOCK_LINE.exec(line);
    if (!m || toMinutes(m[2], m[3]) !== startMinutes) return;
    const text = m[8].trim();
    if (text === wanted) exact.push(i);
    else if (text.includes(wanted)) loose.push(i);
  });

  // Day Planner may render the task text slightly differently from the source line
  // (e.g. without trailing tags), so fall back to "contains" only when nothing matches exactly.
  const hits = exact.length > 0 ? exact : loose;
  if (hits.length === 0) return { ok: false, reason: "not-found" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous" };

  const index = hits[0];
  const m = BLOCK_LINE.exec(bodies[index])!;
  const start = toMinutes(m[2], m[3])!;
  const end = m[5] !== undefined ? toMinutes(m[5], m[6]) : null;
  const newStart = start + shiftMinutes;
  const newEnd = end === null ? null : end + shiftMinutes;
  // Crossing into another day would belong in another note; leave that to the user.
  if (newStart < 0 || newStart >= DAY || (newEnd !== null && newEnd >= DAY)) {
    return { ok: false, reason: "past-midnight" };
  }

  const range =
    formatClock(newStart, m[2].length === 2) +
    (newEnd === null ? "" : m[4] + formatClock(newEnd, m[5].length === 2));
  const eol = lines[index].endsWith("\r") ? "\r" : "";
  const after = m[1] + range + m[7] + m[8];
  lines[index] = after + eol;

  return {
    ok: true,
    content: lines.join("\n"),
    from: formatClock(start, true),
    to: formatClock(newStart, true),
    before: bodies[index],
    after,
  };
}

/**
 * Undo: put the exact original line back where the shifted line is.
 * Recomputing with a negative shift would lose formatting such as "9:05" vs "09:05".
 */
export function restoreLine(content: string, after: string, before: string): RestoreResult {
  const lines = content.split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if ((line.endsWith("\r") ? line.slice(0, -1) : line) === after) hits.push(i);
  });
  if (hits.length === 0) return { ok: false, reason: "not-found" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous" };
  const i = hits[0];
  lines[i] = before + (lines[i].endsWith("\r") ? "\r" : "");
  return { ok: true, content: lines.join("\n") };
}
