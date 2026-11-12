import { test } from "node:test";
import assert from "node:assert/strict";
import { isOsc777Notify, readOsc9 } from "../src/attention.ts";

test("OSC 9 is a notification unless it is the 9;4 progress form", () => {
  assert.deepEqual(readOsc9("Claude is waiting for your input"), { kind: "notify" });
  assert.deepEqual(readOsc9("42 files done"), { kind: "notify" });
  assert.deepEqual(readOsc9(""), { kind: "notify" });
});

test("OSC 9;4 is busy for states 1 to 4 and idle for 0", () => {
  assert.deepEqual(readOsc9("4;3;0"), { kind: "progress", busy: true });
  assert.deepEqual(readOsc9("4;1;50"), { kind: "progress", busy: true });
  assert.deepEqual(readOsc9("4;0;0"), { kind: "progress", busy: false });
  assert.deepEqual(readOsc9("4"), { kind: "progress", busy: false });
});

test("OSC 777 counts only its notify form", () => {
  assert.equal(isOsc777Notify("notify;Build;done"), true);
  assert.equal(isOsc777Notify("notify"), true);
  assert.equal(isOsc777Notify("preexec"), false);
});
