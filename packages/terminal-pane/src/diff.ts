// A line diff of two texts, grouped into hunks with surrounding context, as in `diff -u`.
// Pure module (no Obsidian imports) so it is testable.

export type LineKind = "same" | "removed" | "added";

export interface DiffLine {
  kind: LineKind;
  text: string;
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

  const middle = myers(a.slice(start, endA), b.slice(start, endB));
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

function myers(a: string[], b: string[]): { kind: LineKind; text: string }[] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
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
  return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
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

/** The changes with `context` unchanged lines around each, nearby changes sharing a hunk. */
export function diff(oldText: string, newText: string, context = 3): Diff {
  const lines = diffLines(oldText, newText);
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
