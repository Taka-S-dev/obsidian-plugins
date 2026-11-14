import assert from "node:assert/strict";
import { test } from "node:test";
import { isTextFile, TextHistory } from "../src/text-history.ts";

test("notes, canvases, bases and plain text are remembered; other files are not", () => {
  assert.equal(isTextFile("md"), true);
  assert.equal(isTextFile("MD"), true);
  assert.equal(isTextFile("canvas"), true);
  assert.equal(isTextFile("png"), false);
  assert.equal(isTextFile("pdf"), false);
});

test("the latest text replaces the earlier one and follows renames", () => {
  const history = new TextHistory();
  history.set("a.md", "one");
  history.set("a.md", "two");
  assert.equal(history.get("a.md"), "two");
  history.rename("a.md", "b.md");
  assert.equal(history.get("a.md"), undefined);
  assert.equal(history.get("b.md"), "two");
  history.delete("b.md");
  assert.equal(history.get("b.md"), undefined);
});

test("a file over the size limit is forgotten rather than kept stale", () => {
  const history = new TextHistory(5, 100);
  history.set("a.md", "short");
  history.set("a.md", "too long now");
  assert.equal(history.get("a.md"), undefined);
});

test("past the total limit, new files are not remembered; freed space is reused", () => {
  const history = new TextHistory(10, 10);
  history.set("a.md", "123456");
  history.set("b.md", "12345");
  assert.equal(history.get("b.md"), undefined);
  history.delete("a.md");
  history.set("b.md", "12345");
  assert.equal(history.get("b.md"), "12345");
});
