import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPaste, linesRun } from "../src/paste.ts";

test("cleanPaste keeps text, tabs and line breaks but drops control characters", () => {
  assert.equal(cleanPaste("a\tb\r\nc\nd"), "a\tb\r\nc\nd");
  assert.equal(cleanPaste("x\x1b[201~rm -rf y"), "x[201~rm -rf y");
  assert.equal(cleanPaste("a\x9bb\x07c\x00"), "abc");
  assert.equal(cleanPaste("日本語"), "日本語");
});

test("linesRun counts every line break, including a final one", () => {
  assert.equal(linesRun("echo hi"), 0);
  assert.equal(linesRun("echo hi\n"), 1);
  assert.equal(linesRun("a\r\nb"), 1);
  assert.equal(linesRun("a\nb\nc\n"), 3);
});
