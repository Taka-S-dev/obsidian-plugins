import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedLine, insertLine, lineLabel, loadDone, stillChecked, uncheck } from "../src/done-today.ts";
import { markDone, parseReminders, removeReminder } from "../src/reminders.ts";

const today = "2026-11-24";

test("the line kept is the one the note holds once checked off", () => {
  const note = "# Reminders\r\n- [ ] 2026-11-24 09:00 Call the dentist\r\n";
  const [r] = parseReminders(note);
  const after = markDone(note, r)!;
  assert.ok(after.split("\n").map((l) => l.replace(/\r$/, "")).includes(checkedLine(r.raw)));
});

test("undoing unchecks that line and keeps the line ending", () => {
  const note = ["# Inbox", "- [x] 2026-11-23 10:00 Water the plants", "- [x] 2026-11-24 08:00 Buy rice"].join("\r\n");
  assert.equal(
    uncheck(note, "- [x] 2026-11-24 08:00 Buy rice"),
    ["# Inbox", "- [x] 2026-11-23 10:00 Water the plants", "- [ ] 2026-11-24 08:00 Buy rice"].join("\r\n"),
  );
  // Gone, or changed by hand: nothing is touched.
  assert.equal(uncheck(note, "- [x] 2026-11-24 08:00 Buy bread"), null);
  assert.equal(uncheck(note.replace("[x] 2026-11-24", "[ ] 2026-11-24"), "- [x] 2026-11-24 08:00 Buy rice"), null);
});

test("only today's well-formed entries are loaded", () => {
  const saved = [
    { kind: "inbox", line: "- [x] 2026-11-24 08:00 Buy rice", date: today },
    { kind: "reminder", line: "- [x] 2026-11-23 09:00 Old", date: "2026-11-23" },
    { kind: "other", line: "- [x] x", date: today },
    { kind: "inbox", line: "not a task", date: today },
    "junk",
  ];
  assert.deepEqual(loadDone(saved, today), [{ kind: "inbox", line: "- [x] 2026-11-24 08:00 Buy rice", date: today }]);
  assert.deepEqual(loadDone(null, today), []);
});

test("entries whose line was unchecked or deleted by hand are dropped", () => {
  const entries = [
    { kind: "inbox" as const, line: "- [x] 2026-11-24 08:00 Buy rice", date: today },
    { kind: "reminder" as const, line: "- [x] 2026-11-24 09:00 Call the dentist", date: today },
  ];
  const inbox = "# Inbox\r\n- [ ] 2026-11-24 08:00 Buy rice\r\n";
  assert.deepEqual(stillChecked(entries, "inbox", inbox), [entries[1]]);
  assert.deepEqual(stillChecked(entries, "inbox", null), entries);
});

test("the panel shows an entry without its checkbox, and without the date when it is today", () => {
  assert.equal(lineLabel("- [x] 2026-11-24 09:00 Call the dentist", today), "09:00 Call the dentist");
  assert.equal(lineLabel("- [x] 2026-11-20 08:00 Buy rice", today), "2026-11-20 08:00 Buy rice");
});

test("a deleted line goes back where it was, with the note's line ending", () => {
  const note = ["# Reminders", "- [ ] 2026-11-24 09:00 Call the dentist", "- [ ] 2026-11-24 12:00 Lunch", ""].join("\r\n");
  const [first] = parseReminders(note);
  const after = removeReminder(note, first)!;
  assert.equal(after, ["# Reminders", "- [ ] 2026-11-24 12:00 Lunch", ""].join("\r\n"));
  assert.equal(insertLine(after, first.line, first.raw), note);
  // The note changed meanwhile: the line still goes back, at the end at the latest.
  assert.equal(insertLine("# Reminders\r\n", 5, first.raw), "# Reminders\r\n- [ ] 2026-11-24 09:00 Call the dentist\r\n");
  assert.equal(insertLine("# Inbox\n- [ ] a", 9, "- [ ] b"), "# Inbox\n- [ ] a\n- [ ] b");
  assert.equal(insertLine("", 0, "- [ ] b"), "- [ ] b\n");
  // A line that changed is not deleted.
  assert.equal(removeReminder(note.replace("dentist", "doctor"), first), null);
});
