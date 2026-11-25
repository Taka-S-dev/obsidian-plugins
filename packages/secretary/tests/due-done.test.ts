import { test } from "node:test";
import assert from "node:assert/strict";
import { doneLabel, dueStillDone, loadDone, replaceLine, restoreLine, type DoneEntry } from "../src/done-today.ts";
import { checkTask, parseDueTasks, taskText } from "../src/tasks.ts";

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
