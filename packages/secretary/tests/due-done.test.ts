import { test } from "node:test";
import assert from "node:assert/strict";
import { doneLabel, dueStillDone, loadDone, replaceLine, restoreLine, type DoneEntry } from "../src/done-today.ts";
import { addDays, checkTask, daysBetween, parseDueTasks, setDue, taskText } from "../src/tasks.ts";

const TODAY = "2026-11-25";

test("a due task keeps the line it was read as", () => {
  const [task] = parseDueTasks("# Plan\r\n- [ ] Renew the passport 🔁 every year 📅 2026-11-25\r\n", "a.md");
  assert.equal(task.raw, "- [ ] Renew the passport 🔁 every year 📅 2026-11-25");
  assert.equal(task.line, 1);
});

test("without the Tasks plugin only the checkbox changes", () => {
  assert.equal(checkTask("  - [/] Review ⏫ 📅 2026-11-21"), "  - [x] Review ⏫ 📅 2026-11-21");
  assert.equal(checkTask("- [x] done 📅 2026-11-21"), null);
  assert.equal(checkTask("plain text"), null);
  assert.equal(taskText("- [x] [Call the bank](https://example.com) 📅 2026-11-22 ✅ 2026-11-25"), "Call the bank");
});

test("a repeating task's next line is added with the checked one, and Undo takes both back", () => {
  const before = "- [ ] Water the plants 🔁 every day 📅 2026-11-25";
  const after = ["- [ ] Water the plants 🔁 every day 📅 2026-11-26", "- [x] Water the plants 🔁 every day 📅 2026-11-25 ✅ 2026-11-25"].join("\n");
  const note = ["# Home", before, "- [ ] other"].join("\r\n");
  const done = replaceLine(note, 1, before, after)!;
  assert.equal(done, ["# Home", ...after.split("\n"), "- [ ] other"].join("\r\n"));
  assert.equal(restoreLine(done, after, before), note);
});

test("a task that moved is still found; one that changed is left alone", () => {
  const raw = "- [ ] Pay the rent 📅 2026-11-25";
  const note = ["new line on top", "# Money", raw].join("\n");
  assert.equal(replaceLine(note, 1, raw, "- [x] Pay the rent 📅 2026-11-25"), ["new line on top", "# Money", "- [x] Pay the rent 📅 2026-11-25"].join("\n"));
  assert.equal(replaceLine(note.replace("rent", "bills"), 1, raw, "x"), null);
  assert.equal(restoreLine("- [ ] unrelated", "- [x] Pay the rent", raw), null);
});

test("done due tasks are kept for today, named by their words, and dropped once unchecked by hand", () => {
  const entry: DoneEntry = { kind: "due", line: "- [x] Pay the rent 📅 2026-11-25 ✅ 2026-11-25", date: TODAY, path: "a.md", before: "- [ ] Pay the rent 📅 2026-11-25" };
  assert.deepEqual(loadDone([entry, { ...entry, path: undefined }, { ...entry, date: "2026-11-24" }], TODAY), [entry]);
  assert.equal(doneLabel(entry, TODAY), "Pay the rent");
  assert.deepEqual(dueStillDone([entry], "a.md", `# x\n${entry.line}\n`), [entry]);
  assert.deepEqual(dueStillDone([entry], "a.md", "# x\n- [ ] Pay the rent 📅 2026-11-25\n"), []);
  assert.deepEqual(dueStillDone([entry], "b.md", "nothing"), [entry]);
});

test("moving a due date changes only the date, and the panel keeps the links as written", () => {
  const raw = "- [ ] Send [the quote](https://example.com/q) ⏫ 🔁 every week 📅 2026-11-20 ➕ 2026-11-01";
  assert.equal(setDue(raw, "2026-11-27"), "- [ ] Send [the quote](https://example.com/q) ⏫ 🔁 every week 📅 2026-11-27 ➕ 2026-11-01");
  const [task] = parseDueTasks(raw, "a.md");
  assert.equal(task.body, "Send [the quote](https://example.com/q)");
  assert.equal(task.text, "Send the quote");
});

test("days are counted across months and years", () => {
  assert.equal(addDays("2026-12-30", 7), "2027-01-06");
  assert.equal(addDays("2026-11-26", 1), "2026-11-27");
  assert.equal(daysBetween("2026-11-20", "2026-11-26"), 6);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
});
