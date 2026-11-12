import { test } from "node:test";
import assert from "node:assert/strict";
import { companionBlocks, listBlocks } from "../src/reschedule.ts";

const NOTE = [
  "# Day planner",
  "- [ ] 09:00 - 12:00 Deep work",
  "- [ ] 10:00 - 11:00 Design review",
  "- [ ] 10:00 - 10:15 Write the daily report",
  "- [x] 10:00 - 10:30 Already done",
  "* 10:30 Standup",
  "- [ ] 13:00 - 14:00 Lunch",
].join("\r\n");

const at = (h: number, m = 0) => h * 60 + m;
const names = (blocks: { task: string }[]) => blocks.map((b) => b.task);

test("listBlocks reads open blocks with their times", () => {
  const blocks = listBlocks(NOTE);
  assert.deepEqual(names(blocks), ["Deep work", "Design review", "Write the daily report", "Standup", "Lunch"]);
  assert.deepEqual(blocks[1], { task: "Design review", start: at(10), end: at(11), time: "10:00–11:00" });
  assert.deepEqual(blocks[3], { task: "Standup", start: at(10, 30), end: null, time: "10:30" });
});

test("blocks starting with the announced one are returned, not the announced one itself", () => {
  const options = { now: at(10), catchUp: false, defaultDuration: 30 };
  const others = companionBlocks(listBlocks(NOTE), { task: "Design review", start: at(10) }, options);
  assert.deepEqual(names(others), ["Write the daily report"]);
});

test("the announced task may be a shortened form of the line", () => {
  const options = { now: at(10), catchUp: false, defaultDuration: 30 };
  const others = companionBlocks(listBlocks(NOTE), { task: "Design", start: at(10) }, options);
  assert.deepEqual(names(others), ["Write the daily report"]);
});

test("only one line is taken as the announced block when names contain each other", () => {
  const note = ["- [ ] 00:07 - 01:10 test", "- [ ] 00:07 - 01:10 test2", "- [ ] 00:07 - 01:10 test3dayo"].join("\n");
  const options = { now: at(0, 7), catchUp: false, defaultDuration: 30 };
  assert.deepEqual(names(companionBlocks(listBlocks(note), { task: "test", start: at(0, 7) }, options)), ["test2", "test3dayo"]);
  // With no exact match, the first line containing the name is the announced one.
  assert.deepEqual(names(companionBlocks(listBlocks(note), { task: "tes", start: at(0, 7) }, options)), ["test2", "test3dayo"]);
});

test("after start-up, every block in progress is returned", () => {
  const options = { now: at(10, 40), catchUp: true, defaultDuration: 30 };
  const others = companionBlocks(listBlocks(NOTE), { task: "Deep work", start: at(9) }, options);
  // The 10:00-10:15 report has ended; Standup has no end, so it runs for the default 30 minutes.
  assert.deepEqual(names(others), ["Design review", "Standup"]);
});

test("without catch-up, blocks in progress with another start time are left out", () => {
  const options = { now: at(10, 40), catchUp: false, defaultDuration: 30 };
  assert.deepEqual(companionBlocks(listBlocks(NOTE), { task: "Deep work", start: at(9) }, options), []);
});
