// A line diff of two texts, grouped into hunks with surrounding context, as in `diff -u`.
// Pure module (no Obsidian imports) so it is testable.

export type LineKind = "same" | "removed" | "added";

/** Part of a changed line, marked when it differs from the line it replaces. */
export interface Span {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: LineKind;
  text: string;
  /**
   * For a removed or added line that replaces one on the other side, its parts, with what changed
   * marked. Absent when the lines share too little for marking to help.
   */
  spans?: Span[];
  /** 1-based line numbers in the old and new text; absent on the side the line is not in. */
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  lines: DiffLine[];
  /** Unchanged lines left out before this hunk. */
  skippedBefore: number;
}

export interface Diff {
  hunks: Hunk[];
  /** Unchanged lines left out after the last hunk. */
  skippedAfter: number;
  added: number;
  removed: number;
}

const splitLines = (text: string) => (text === "" ? [] : text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"));

/**
 * The shortest edit script between two line lists (Myers' O(ND) algorithm), as one entry per line.
 * Common lines at both ends are matched first, so a small edit in a long note stays cheap.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const oldMiddle = a.slice(start, endA);
  const newMiddle = b.slice(start, endB);
  const middle = myers(oldMiddle, newMiddle, MAX_EDITS) ?? replaced(oldMiddle, newMiddle);
  const out: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  const same = (text: string) => out.push({ kind: "same", text, oldLine: oldLine++, newLine: newLine++ });
  for (let i = 0; i < start; i++) same(a[i]);
  for (const step of middle) {
    if (step.kind === "same") same(step.text);
    else if (step.kind === "removed") out.push({ kind: "removed", text: step.text, oldLine: oldLine++ });
    else out.push({ kind: "added", text: step.text, newLine: newLine++ });
  }
  for (let i = endA; i < a.length; i++) same(a[i]);
  return out;
}

/** Past this many differing lines the texts are shown as replaced outright, to bound the work. */
const MAX_EDITS = 4000;

type Step = { kind: LineKind; text: string };

const replaced = (a: string[], b: string[]): Step[] =>
  [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];

/** The shortest edit script, or null when it takes more than `maxEdits` edits. */
function myers(a: string[], b: string[], maxEdits: number): Step[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // Before round d only diagonals -d..d are read, so each saved copy holds just that band.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], last: number): { kind: LineKind; text: string }[] {
  const steps: { kind: LineKind; text: string }[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d > 0; d--) {
    const band = trace[d];
    const at = (k: number) => band[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) steps.push({ kind: "same", text: a[--x] }), y--;
    if (x === prevX) steps.push({ kind: "added", text: b[--y] });
    else steps.push({ kind: "removed", text: a[--x] });
  }
  while (x > 0 && y > 0) steps.push({ kind: "same", text: a[--x] }), y--;
  return steps.reverse();
}

/** Words, runs of spaces, and single other characters, so Japanese is compared character by character. */
const tokens = (line: string) =>
  line.match(/(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}_])+|\s+|[\s\S]/gu) ?? [];

/** Lines longer than this are not compared within, to bound the work. */
const MAX_INLINE = 2000;

/** Characters compared within lines per diff; past this, changed lines are shown whole. */
const INLINE_BUDGET = 20_000;

/**
 * What changed between a removed line and the line added in its place, as parts of each. Null when
 * less than half of the shorter line is shared: the line was rewritten, and marking all of it says
 * nothing more than the line's colour.
 */
export function inlineChanges(oldLine: string, newLine: string): { old: Span[]; new: Span[] } | null {
  if (oldLine.length > MAX_INLINE || newLine.length > MAX_INLINE) return null;
  const old: Span[] = [];
  const now: Span[] = [];
  const add = (spans: Span[], text: string, changed: boolean) => {
    const last = spans[spans.length - 1];
    if (last && last.changed === changed) last.text += text;
    else spans.push({ text, changed });
  };
  const a = tokens(oldLine);
  const b = tokens(newLine);
  // Common ends are cheap to take off; what is left decides the cost.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  // A line is marked only when about half of its shorter side is shared. With the ends already
  // shared, the middle may then take at most this many edits; past that the search stops.
  const n = endA - start;
  const m = endB - start;
  const ends = a.length - n;
  const middle = myers(a.slice(start, endA), b.slice(start, endB), n + m - Math.max(0, Math.min(a.length, b.length) - 2 * ends));
  if (!middle) return null;
  const steps: Step[] = [
    ...a.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ kind: "same" as const, text })),
  ];
  let shared = 0;
  for (const step of steps) {
    if (step.kind === "same") {
      shared += step.text.length;
      add(old, step.text, false);
      add(now, step.text, false);
    } else {
      add(step.kind === "removed" ? old : now, step.text, true);
    }
  }
  const shorter = Math.min(oldLine.length, newLine.length);
  return shared * 2 >= shorter && shorter > 0 ? { old, new: now } : null;
}

/** Marks what changed within each removed line and the added line in its place, pairing them in order. */
function markInline(lines: DiffLine[]): void {
  let budget = INLINE_BUDGET;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "removed") { i++; continue; }
    const removedStart = i;
    while (i < lines.length && lines[i].kind === "removed") i++;
    const addedStart = i;
    while (i < lines.length && lines[i].kind === "added") i++;
    const pairs = Math.min(addedStart - removedStart, i - addedStart);
    for (let p = 0; p < pairs; p++) {
      const removed = lines[removedStart + p];
      const added = lines[addedStart + p];
      budget -= removed.text.length + added.text.length;
      if (budget < 0) return;
      const inline = inlineChanges(removed.text, added.text);
      if (inline) {
        removed.spans = inline.old;
        added.spans = inline.new;
      }
    }
  }
}

/** The changes with `context` unchanged lines around each, nearby changes sharing a hunk. */
export function diff(oldText: string, newText: string, context = 3): Diff {
  const lines = diffLines(oldText, newText);
  markInline(lines);
  const changed = lines.map((line, i) => (line.kind === "same" ? -1 : i)).filter((i) => i !== -1);
  const result: Diff = {
    hunks: [],
    skippedAfter: 0,
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
  if (changed.length === 0) return { ...result, skippedAfter: lines.length };
  let shownUpTo = 0;
  let i = 0;
  while (i < changed.length) {
    const from = Math.max(changed[i] - context, shownUpTo);
    let to = changed[i] + context;
    while (i + 1 < changed.length && changed[i + 1] - context <= to + 1) to = changed[++i] + context;
    to = Math.min(to, lines.length - 1);
    result.hunks.push({ skippedBefore: from - shownUpTo, lines: lines.slice(from, to + 1) });
    shownUpTo = to + 1;
    i++;
  }
  result.skippedAfter = lines.length - shownUpTo;
  return result;
}
