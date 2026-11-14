import assert from "node:assert/strict";
import { test } from "node:test";
import { diff, diffLines } from "../src/diff.ts";

const kinds = (oldText: string, newText: string) => diffLines(oldText, newText).map((l) => `${l.kind[0]}${l.text}`);

test("an edited line shows as removed, then added", () => {
  assert.deepEqual(kinds("a\nb\nc", "a\nB\nc"), ["sa", "rb", "aB", "sc"]);
});

test("insertions and deletions in the middle keep the common lines", () => {
  assert.deepEqual(kinds("a\nb\nc\nd", "a\nc\nx\nd"), ["sa", "rb", "sc", "ax", "sd"]);
});

test("a new file is all added, an emptied file all removed", () => {
  assert.deepEqual(kinds("", "a\nb"), ["aa", "ab"]);
  assert.deepEqual(kinds("a\nb\n", ""), ["ra", "rb"]);
});

test("line numbers follow each side", () => {
  const lines = diffLines("a\nb\nc", "a\nx\ny\nc");
  assert.deepEqual(lines.map((l) => [l.oldLine, l.newLine]), [[1, 1], [2, undefined], [undefined, 2], [undefined, 3], [3, 4]]);
});

test("CRLF and a final line break do not count as changes", () => {
  assert.deepEqual(kinds("a\r\nb\r\n", "a\nb"), ["sa", "sb"]);
});

test("hunks keep three lines of context and skip the rest", () => {
  const old = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const edited = old.replace("line 10", "changed");
  const d = diff(old, edited);
  assert.equal(d.hunks.length, 1);
  assert.equal(d.hunks[0].skippedBefore, 6);
  assert.deepEqual(d.hunks[0].lines.map((l) => l.text), ["line 7", "line 8", "line 9", "line 10", "changed", "line 11", "line 12", "line 13"]);
  assert.equal(d.skippedAfter, 7);
  assert.deepEqual([d.added, d.removed], [1, 1]);
});

test("changes close together share a hunk; far apart they split", () => {
  const old = Array.from({ length: 30 }, (_, i) => `${i + 1}`).join("\n");
  assert.equal(diff(old, old.replace(/^5$/m, "x").replace(/^9$/m, "y")).hunks.length, 1);
  assert.equal(diff(old, old.replace(/^5$/m, "x").replace(/^25$/m, "y")).hunks.length, 2);
});

test("identical texts have no hunks", () => {
  const d = diff("a\nb", "a\nb");
  assert.deepEqual([d.hunks.length, d.skippedAfter], [0, 2]);
});

test("texts with no lines in common past the limit show as replaced", () => {
  const old = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join("\n");
  const edited = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join("\n");
  const d = diff(old, edited);
  assert.deepEqual([d.removed, d.added], [3000, 3000]);
});

test("many scattered edits in a long text still pair up correctly", () => {
  const old = Array.from({ length: 2000 }, (_, i) => `l${i}`);
  const edited = old.map((line, i) => (i % 50 === 0 ? `${line}!` : line));
  const d = diff(old.join("\n"), edited.join("\n"));
  assert.deepEqual([d.removed, d.added], [40, 40]);
});
