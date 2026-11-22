import { test } from "node:test";
import assert from "node:assert/strict";
import { dropsBefore, moveBefore } from "../src/tab-order.ts";

const tabs = ["a", "b", "c", "d"];

test("a tab moves in front of the one it is dropped before", () => {
  assert.deepEqual(moveBefore(tabs, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveBefore(tabs, 0, 2), ["b", "a", "c", "d"]);
  assert.deepEqual(moveBefore(tabs, 1, 3), ["a", "c", "b", "d"]);
});

test("a tab dropped past the last one goes last", () => {
  assert.deepEqual(moveBefore(tabs, 0, 4), ["b", "c", "d", "a"]);
});

test("dropping a tab next to itself, or out of range, changes nothing", () => {
  assert.equal(moveBefore(tabs, 1, 1), tabs);
  assert.equal(moveBefore(tabs, 1, 2), tabs);
  assert.equal(moveBefore(tabs, 4, 0), tabs);
  assert.equal(moveBefore(tabs, 0, 5), tabs);
});

test("the left half of a tab drops in front of it, the right half after it", () => {
  assert.equal(dropsBefore(10, 0, 40), true);
  assert.equal(dropsBefore(30, 0, 40), false);
});
