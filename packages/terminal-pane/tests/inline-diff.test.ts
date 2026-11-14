import assert from "node:assert/strict";
import { test } from "node:test";
import { diff, inlineChanges } from "../src/diff.ts";

const marked = (spans: { text: string; changed: boolean }[]) => spans.filter((s) => s.changed).map((s) => s.text);

test("a changed word is marked, not the whole line", () => {
  const r = inlineChanges("The quick brown fox", "The slow brown fox");
  assert.ok(r);
  assert.deepEqual(marked(r.old), ["quick"]);
  assert.deepEqual(marked(r.new), ["slow"]);
  assert.equal(r.new.map((s) => s.text).join(""), "The slow brown fox");
});

test("Japanese is compared character by character", () => {
  const r = inlineChanges("明日は会議があります", "明後日は会議がありません");
  assert.ok(r);
  assert.deepEqual(marked(r.old), ["す"]);
  assert.deepEqual(marked(r.new), ["後", "せん"]);
});

test("a rewritten line is left unmarked", () => {
  assert.equal(inlineChanges("completely different", "nothing alike here at all"), null);
  assert.equal(inlineChanges("", "new"), null);
});

test("removed and added lines are paired in order within a change", () => {
  const result = diff("a\nkeep one\nkeep two\nz\n", "a\nkept one\nkept two\nextra line\nz\n");
  const lines = result.hunks[0].lines;
  const removed = lines.filter((l) => l.kind === "removed");
  const added = lines.filter((l) => l.kind === "added");
  assert.deepEqual(removed.map((l) => marked(l.spans ?? [])), [["keep"], ["keep"]]);
  assert.deepEqual(added.map((l) => (l.spans ? marked(l.spans) : null)), [["kept"], ["kept"], null]);
});
