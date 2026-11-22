import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/checks.ts";
import { STRINGS } from "../src/i18n.ts";
import { classifyDue, parseDueTasks } from "../src/tasks.ts";

const note = [
  "# ToDo",
  "- [ ] Renew the passport 📅 2026-11-19",
  "- [/] Review the contract ⏫ 📅 2026-11-20",
  "- [x] Book the room 📅 2026-11-18 ✅ 2026-11-18",
  "- [-] Cancelled call 📅 2026-11-18",
  "  * [ ] Nested item 🔁 every week 📅 2026-11-21",
  "1. [ ] Numbered item 📅️ 2026-11-22",
  "- [ ] No due date",
  "- [ ] Scheduled only ⏳ 2026-11-19",
  "- [ ] Impossible date 📅 2026-02-30",
  "Plain line 📅 2026-11-19",
  "- [ ] 📅 2026-11-19",
].join("\r\n");

test("open tasks with a due date are read; done, cancelled and invalid ones are not", () => {
  const tasks = parseDueTasks(note, "ToDo.md");
  assert.deepEqual(
    tasks.map((t) => [t.line, t.text, t.due]),
    [
      [1, "Renew the passport", "2026-11-19"],
      [2, "Review the contract", "2026-11-20"],
      [5, "Nested item", "2026-11-21"],
      [6, "Numbered item", "2026-11-22"],
      [11, "📅 2026-11-19", "2026-11-19"],
    ],
  );
  assert.ok(tasks.every((t) => t.path === "ToDo.md"));
});

test("a note without a due date is skipped", () => {
  assert.deepEqual(parseDueTasks("- [ ] a\n- [ ] b ⏳ 2026-11-19", "a.md"), []);
});

test("tasks are split into overdue, today and tomorrow by local date", () => {
  const tasks = parseDueTasks(note, "ToDo.md");
  const due = classifyDue(tasks, new Date(2026, 10, 20, 23, 59));
  assert.deepEqual(due.overdue.map((t) => t.text), ["📅 2026-11-19", "Renew the passport"]);
  assert.deepEqual(due.today.map((t) => t.text), ["Review the contract"]);
  assert.deepEqual(due.tomorrow.map((t) => t.text), ["Nested item"]);
});

test("tomorrow crosses the end of a month", () => {
  const due = classifyDue(parseDueTasks("- [ ] x 📅 2026-12-01", "a.md"), new Date(2026, 10, 30, 9, 0));
  assert.equal(due.tomorrow.length, 1);
});

const snap = (dueTasks: ReturnType<typeof parseDueTasks> | null, now = new Date(2026, 10, 20, 12, 0)) => ({
  now,
  inbox: [],
  reminders: null,
  bulletins: [],
  rejected: [],
  dueTasks,
});

test("due tasks show in the status bar and alert once per summary time", () => {
  const s = STRINGS.en;
  const r = evaluate(snap(parseDueTasks(note, "ToDo.md")), "09:00", s);
  assert.equal(r.status, "Overdue 2 · Due today 1");
  const alert = r.alerts.find((a) => a.key === "due@09:00");
  assert.ok(alert);
  assert.equal(alert.title, "Due: 2 overdue, 1 today, 1 tomorrow");
  assert.equal(alert.body.split("\n")[0], "2026-11-19 📅 2026-11-19");
  assert.ok(r.details.includes("Overdue (2)"));
});

test("only tomorrow: listed and announced, but not in the status bar", () => {
  const s = STRINGS.ja;
  const r = evaluate(snap(parseDueTasks("- [ ] 準備 📅 2026-11-21", "a.md")), "16:30", s);
  assert.equal(r.status, s.status.clear);
  assert.equal(r.alerts[0].title, "期限: 明日 1 件");
  assert.deepEqual(r.details, ["明日が期限 (1)", "・2026-11-21 準備"]);
});

test("before the first summary time and with the check off, nothing is announced", () => {
  const s = STRINGS.en;
  assert.deepEqual(evaluate(snap(parseDueTasks(note, "ToDo.md")), null, s).alerts, []);
  const off = evaluate(snap(null), "09:00", s);
  assert.equal(off.status, s.status.clear);
  assert.deepEqual(off.alerts, []);
});
