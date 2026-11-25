import { test } from "node:test";
import assert from "node:assert/strict";
import { agenda, weekday, weekOf } from "../src/agenda.ts";
import { parseReminders } from "../src/reminders.ts";
import { parseDueTasks } from "../src/tasks.ts";

// Thursday 2026-11-26, 12:00.
const NOW = new Date(2026, 10, 26, 12, 0);

const reminders = parseReminders(
  [
    "- [ ] 2026-11-26 09:00 passed this morning",
    "- [ ] 2026-11-26 18:00 tonight",
    "- [x] 2026-11-27 08:00 already done",
    "- [ ] 2026-11-27 19:00 tomorrow evening",
    "- [ ] 2026-11-27 07:00 tomorrow morning",
    "- [ ] 2026-12-23 10:00 last day shown",
    "- [ ] 2026-12-24 10:00 one day too far",
  ].join("\n"),
);
const tasks = parseDueTasks(
  ["- [ ] old task 📅 2026-11-20", "- [ ] due tomorrow 📅 2026-11-27", "- [ ] far task 📅 2027-01-10"].join("\n"),
  "a.md",
);
const names = (items: ReturnType<typeof agenda>["overdue"]) => items.map((i) => (i.kind === "due" ? i.task.text : i.reminder.text));

test("the agenda puts what has passed on top and the rest under its day", () => {
  const plan = agenda(reminders, tasks, NOW);
  assert.deepEqual(names(plan.overdue), ["old task", "passed this morning"]);
  assert.deepEqual(plan.days.map((d) => d.date), ["2026-11-26", "2026-11-27", "2026-12-23"]);
  assert.deepEqual(names(plan.days[0].items), ["tonight"]);
  // A due task (no time) first, then reminders by time; checked ones are left out.
  assert.deepEqual(names(plan.days[1].items), ["due tomorrow", "tomorrow morning", "tomorrow evening"]);
  assert.equal(plan.beyond, 2);
});

test("weeks start on Monday", () => {
  assert.equal(weekOf("2026-11-26"), "2026-11-23");
  assert.equal(weekOf("2026-11-30"), "2026-11-30");
  assert.equal(weekOf("2026-11-29"), "2026-11-23");
  assert.equal(weekday("2026-11-26"), 4);
});
