import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeList } from "../src/changes.ts";

test("the newest change comes first, one entry per file", () => {
  const changes = new ChangeList();
  changes.record("a.md", "modified");
  changes.record("b.md", "modified");
  changes.record("a.md", "modified");
  assert.deepEqual(changes.list().map((c) => c.path), ["a.md", "b.md"]);
});

test("a file created and then edited stays new; created and then deleted disappears", () => {
  const changes = new ChangeList();
  changes.record("new.md", "created");
  changes.record("new.md", "modified");
  assert.deepEqual(changes.list(), [{ path: "new.md", kind: "created", before: "" }]);
  changes.record("new.md", "deleted");
  assert.equal(changes.size, 0);
});

test("an edited file that is then deleted shows as deleted", () => {
  const changes = new ChangeList();
  changes.record("a.md", "modified");
  changes.record("a.md", "deleted");
  assert.deepEqual(changes.list(), [{ path: "a.md", kind: "deleted" }]);
});

test("a rename keeps the original path through further renames and edits", () => {
  const changes = new ChangeList();
  changes.rename("a.md", "b.md");
  changes.rename("b.md", "c.md");
  changes.record("c.md", "modified");
  assert.deepEqual(changes.list(), [{ path: "c.md", kind: "renamed", from: "a.md" }]);
});

test("renaming a new file keeps it new", () => {
  const changes = new ChangeList();
  changes.record("draft.md", "created");
  changes.rename("draft.md", "final.md");
  assert.deepEqual(changes.list(), [{ path: "final.md", kind: "created", before: "" }]);
});

test("the list keeps the latest 50 files", () => {
  const changes = new ChangeList();
  for (let i = 0; i < 60; i++) changes.record(`${i}.md`, "modified");
  assert.equal(changes.size, 50);
  assert.equal(changes.list()[0].path, "59.md");
});

test("an entry keeps the contents from before its first change", () => {
  const changes = new ChangeList();
  changes.record("a.md", "modified", "v1");
  changes.record("a.md", "modified", "v2");
  assert.deepEqual(changes.list(), [{ path: "a.md", kind: "modified", before: "v1" }]);
  changes.record("a.md", "deleted", "v3");
  assert.deepEqual(changes.list(), [{ path: "a.md", kind: "deleted", before: "v1" }]);
});

test("a rename keeps the contents from before it; unknown contents stay absent", () => {
  const changes = new ChangeList();
  changes.rename("a.md", "b.md", "text");
  changes.record("b.md", "modified", "text edited");
  assert.deepEqual(changes.list(), [{ path: "b.md", kind: "renamed", from: "a.md", before: "text" }]);
  changes.record("big.md", "modified");
  assert.deepEqual(changes.list()[0], { path: "big.md", kind: "modified" });
  changes.forget("b.md");
  assert.deepEqual(changes.list().map((c) => c.path), ["big.md"]);
});
