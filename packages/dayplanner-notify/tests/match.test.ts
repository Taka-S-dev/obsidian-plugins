import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTaskStartTitle, parseTaskStartTitle } from "../src/match.ts";

test("parses Day Planner title with time range", () => {
  assert.deepEqual(parseTaskStartTitle("Task started: write report\n09:00 - 10:00"), {
    task: "write report",
    time: "09:00 - 10:00",
  });
});

test("parses title without time range", () => {
  assert.deepEqual(parseTaskStartTitle("Task started: write report"), { task: "write report", time: "" });
});

test("keeps non-ASCII task names", () => {
  assert.deepEqual(parseTaskStartTitle("Task started: 設計レビュー\n17:00 - 18:30"), {
    task: "設計レビュー",
    time: "17:00 - 18:30",
  });
});

test("ignores other notifications", () => {
  assert.equal(parseTaskStartTitle("Some other plugin"), null);
  assert.equal(parseTaskStartTitle("task started: lowercase"), null);
  assert.equal(parseTaskStartTitle("Task started: "), null);
  assert.equal(parseTaskStartTitle(undefined), null);
  assert.equal(parseTaskStartTitle(42), null);
});

test("format and parse round-trip", () => {
  const start = { task: "review", time: "13:00 - 13:30" };
  assert.deepEqual(parseTaskStartTitle(formatTaskStartTitle(start)), start);
  const noTime = { task: "review", time: "" };
  assert.deepEqual(parseTaskStartTitle(formatTaskStartTitle(noTime)), noTime);
});
