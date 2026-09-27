import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostponeOptions, rescheduleBlock, restoreLine, startMinutesOf } from "../src/reschedule.ts";

const NOTE = [
  "# Day planner",
  "",
  "- [ ] 17:00 - 18:30 設計レビュー",
  "- [ ] 15:00 - 16:00 メール返信",
  "- [x] 14:20 - 15:00 資料作成",
  "- [ ] 16:00 - 16:50 議事録の整理",
].join("\n");

function shifted(content: string, task: string, start: string, minutes: number): string {
  const r = rescheduleBlock(content, task, startMinutesOf(start)!, minutes);
  assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  return r.content;
}

test("startMinutesOf reads Day Planner's notification body", () => {
  assert.equal(startMinutesOf("17:00 - 18:30"), 17 * 60);
  assert.equal(startMinutesOf("9:05 - 9:35"), 9 * 60 + 5);
  assert.equal(startMinutesOf(""), null);
  assert.equal(startMinutesOf("25:00 - 26:00"), null);
});

test("shifts start and end of the matching block only", () => {
  const out = shifted(NOTE, "設計レビュー", "17:00", 15);
  const lines = out.split("\n");
  assert.equal(lines[2], "- [ ] 17:15 - 18:45 設計レビュー");
  assert.deepEqual(lines.filter((_, i) => i !== 2), NOTE.split("\n").filter((_, i) => i !== 2));
});

test("carries minutes over the hour", () => {
  const out = shifted(NOTE, "議事録の整理", "16:00", 45);
  assert.match(out, /^- \[ \] 16:45 - 17:35 議事録の整理$/m);
});

test("reports from/to for the notice", () => {
  const r = rescheduleBlock(NOTE, "メール返信", 15 * 60, 60);
  assert.ok(r.ok);
  assert.equal(r.from, "15:00");
  assert.equal(r.to, "16:00");
});

test("preserves formatting: unpadded hours, no spaces, indent, no checkbox, CRLF", () => {
  assert.equal(shifted("  - [ ] 9:00-9:30 stretch", "stretch", "9:00", 30), "  - [ ] 9:30-10:00 stretch");
  assert.equal(shifted("- 09:00 - 10:00 meeting", "meeting", "09:00", 15), "- 09:15 - 10:15 meeting");
  assert.equal(shifted("* 13:00 lunch", "lunch", "13:00", 60), "* 14:00 lunch");
  assert.equal(shifted("- [ ] 10:00 - 11:00 a\r\n- [ ] 12:00 - 13:00 b\r\n", "a", "10:00", 15),
    "- [ ] 10:15 - 11:15 a\r\n- [ ] 12:00 - 13:00 b\r\n");
});

test("never touches completed or cancelled blocks", () => {
  assert.deepEqual(rescheduleBlock(NOTE, "資料作成", 14 * 60 + 20, 15), { ok: false, reason: "not-found" });
  assert.deepEqual(rescheduleBlock("- [-] 10:00 - 11:00 x", "x", 600, 15), { ok: false, reason: "not-found" });
});

test("requires the start time to match, not just the name", () => {
  assert.deepEqual(rescheduleBlock(NOTE, "設計レビュー", 16 * 60, 15), { ok: false, reason: "not-found" });
});

test("falls back to a partial name match when there is no exact one", () => {
  const out = shifted("- [ ] 10:00 - 11:00 review PR #work", "review PR", "10:00", 15);
  assert.equal(out, "- [ ] 10:15 - 11:15 review PR #work");
});

test("an exact match wins over partial matches", () => {
  const note = "- [ ] 10:00 - 10:30 review\n- [ ] 10:00 - 10:30 review docs";
  assert.equal(shifted(note, "review", "10:00", 15), "- [ ] 10:15 - 10:45 review\n- [ ] 10:00 - 10:30 review docs");
});

test("refuses to guess between identical blocks", () => {
  const note = "- [ ] 10:00 - 10:30 standup\n- [ ] 10:00 - 10:30 standup";
  assert.deepEqual(rescheduleBlock(note, "standup", 600, 15), { ok: false, reason: "ambiguous" });
});

test("refuses to move a block past midnight", () => {
  assert.deepEqual(rescheduleBlock("- [ ] 23:00 - 23:50 read", "read", 23 * 60, 15), { ok: false, reason: "past-midnight" });
  assert.deepEqual(rescheduleBlock("- [ ] 23:30 read", "read", 23 * 60 + 30, 30), { ok: false, reason: "past-midnight" });
  assert.equal(shifted("- [ ] 23:00 - 23:30 read", "read", "23:00", 15), "- [ ] 23:15 - 23:45 read");
});

test("parsePostponeOptions accepts loose input and cleans it up", () => {
  assert.deepEqual(parsePostponeOptions("15, 30, 45, 60"), [15, 30, 45, 60]);
  assert.deepEqual(parsePostponeOptions("60,15 30、15"), [15, 30, 60]);
  assert.deepEqual(parsePostponeOptions("0, -5, 1.5, abc, 721, 10"), [10]);
  assert.deepEqual(parsePostponeOptions(""), []);
});

function shiftThenRestore(original: string, task: string, start: string, minutes: number): string {
  const r = rescheduleBlock(original, task, startMinutesOf(start)!, minutes);
  assert.ok(r.ok);
  const back = restoreLine(r.content, r.after, r.before);
  assert.ok(back.ok);
  return back.content;
}

test("undo restores the original line exactly, including formatting", () => {
  const original = "- [ ] 9:05-9:35 stretch\r\n- [ ] 17:00 - 18:30 deploy #ops\r\n";
  // 9:05 -> 10:05 loses whether the hour was zero-padded; restoring the saved line keeps it.
  assert.equal(shiftThenRestore(original, "stretch", "9:05", 60), original);
  assert.equal(shiftThenRestore(original, "deploy", "17:00", 45), original);
});

test("undo refuses when the shifted line was edited or duplicated meanwhile", () => {
  const r = rescheduleBlock("- [ ] 10:00 - 10:30 a", "a", 600, 15);
  assert.ok(r.ok);
  assert.deepEqual(restoreLine("- [x] 10:15 - 10:45 a", r.after, r.before), { ok: false, reason: "not-found" });
  assert.deepEqual(restoreLine(`${r.after}\n${r.after}`, r.after, r.before), { ok: false, reason: "ambiguous" });
});

test("refuses to move a block before midnight", () => {
  assert.deepEqual(rescheduleBlock("- [ ] 00:10 - 00:40 early", "early", 10, -15), { ok: false, reason: "past-midnight" });
});
