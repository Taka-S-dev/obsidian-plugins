import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkReminder,
  daysFrom,
  dueReminders,
  formatReminder,
  later,
  laterDays,
  markDone,
  parseReminderInput,
  parseReminders,
  reschedule,
  tomorrowAt,
  upcomingToday,
} from "../src/reminders.ts";

const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m);

const NOTE = [
  "# リマインダー",
  "",
  "- [ ] 2026-11-20 15:00 車の保険を更新",
  "- [x] 2026-11-20 09:00 済んだもの",
  "- [ ] 2026-11-20 9:30 一桁の時",
  "- [ ] 2026-11-19 17:00 昨日の分",
  "- [ ] 2026-11-21 10:00 明日",
  "- [ ] 2026-02-30 10:00 ありえない日付",
  "- [ ] 2026-11-20 24:00 ありえない時刻",
  "- [ ] 15:00 日付なし",
  "ただの文 2026-11-20 15:00",
].join("\r\n");

test("parses dated task lines and skips invalid ones", () => {
  const list = parseReminders(NOTE);
  assert.deepEqual(
    list.map((r) => [r.line, r.date, r.time, r.text, r.done]),
    [
      [2, "2026-11-20", "15:00", "車の保険を更新", false],
      [3, "2026-11-20", "09:00", "済んだもの", true],
      [4, "2026-11-20", "09:30", "一桁の時", false],
      [5, "2026-11-19", "17:00", "昨日の分", false],
      [6, "2026-11-21", "10:00", "明日", false],
    ],
  );
  assert.equal(list[0].raw, "- [ ] 2026-11-20 15:00 車の保険を更新");
});

test("due, upcoming and later split by now", () => {
  const list = parseReminders(NOTE);
  const now = at(20, 10, 0);
  assert.deepEqual(dueReminders(list, now).map((r) => r.text), ["昨日の分", "一桁の時"]);
  assert.deepEqual(upcomingToday(list, now).map((r) => r.text), ["車の保険を更新"]);
  assert.deepEqual(laterDays(list, now).map((r) => r.text), ["明日"]);
  assert.deepEqual(dueReminders(list, at(20, 15, 0)).map((r) => r.text), ["昨日の分", "一桁の時", "車の保険を更新"]);
});

test("markDone checks off only the line that was read, keeping line endings", () => {
  const [first] = parseReminders(NOTE);
  const next = markDone(NOTE, first);
  assert.ok(next);
  assert.equal(next.split("\r\n")[2], "- [x] 2026-11-20 15:00 車の保険を更新");
  assert.equal(next.split("\r\n").length, NOTE.split("\r\n").length);
  assert.equal(parseReminders(next)[0].done, true);
});

test("markDone refuses when the line changed or moved", () => {
  const [first] = parseReminders(NOTE);
  assert.equal(markDone(NOTE.replace("保険を更新", "保険を解約"), first), null);
  assert.equal(markDone(`new first line\r\n${NOTE}`, first), null);
  assert.equal(markDone("", first), null);
});

test("formatReminder keeps it to one line", () => {
  assert.equal(formatReminder("2026-11-20", "15:00", " 歯医者に\n電話 "), "- [ ] 2026-11-20 15:00 歯医者に 電話");
});

test("quick input: time today, or tomorrow once it has passed", () => {
  const now = at(20, 10, 0);
  assert.deepEqual(parseReminderInput("15:00 電話", now), { date: "2026-11-20", time: "15:00", text: "電話" });
  assert.deepEqual(parseReminderInput("9:30 朝の確認", now), { date: "2026-11-21", time: "09:30", text: "朝の確認" });
  assert.deepEqual(parseReminderInput("10:00 ちょうど今", now), { date: "2026-11-21", time: "10:00", text: "ちょうど今" });
});

test("quick input: an explicit date, including across months", () => {
  const now = at(30, 23, 0);
  assert.deepEqual(parseReminderInput("2026-12-1 9:05 来月", now), { date: "2026-12-01", time: "09:05", text: "来月" });
  assert.deepEqual(parseReminderInput("22:00 明日へ", now), { date: "2026-12-01", time: "22:00", text: "明日へ" });
});

test("quick input: rejects what is not a time and text", () => {
  const now = at(20, 10, 0);
  for (const bad of ["電話する", "15:00", "25:00 x", "12:60 x", "2026-02-30 10:00 x", ""]) {
    assert.equal(parseReminderInput(bad, now), null, bad);
  }
});

test("daysFrom counts calendar days from today", () => {
  const now = new Date(2026, 10, 30, 23, 59);
  assert.equal(daysFrom("2026-11-30", now), 0);
  assert.equal(daysFrom("2026-12-01", now), 1);
  assert.equal(daysFrom("2026-12-05", now), 5);
  assert.equal(daysFrom("2026-11-29", now), -1);
});

test("checkReminder takes the modal's fields and refuses what cannot go off", () => {
  const now = new Date(2026, 10, 20, 14, 0);
  assert.deepEqual(checkReminder(" 歯医者に\n電話 ", "2026-11-20", "15:00", now), { ok: true, date: "2026-11-20", time: "15:00", text: "歯医者に 電話" });
  assert.deepEqual(checkReminder("x", "2026-11-21", "09:30:00", now), { ok: true, date: "2026-11-21", time: "09:30", text: "x" });
  assert.deepEqual(checkReminder("  ", "2026-11-20", "15:00", now), { ok: false, reason: "text" });
  assert.deepEqual(checkReminder("x", "", "15:00", now), { ok: false, reason: "date" });
  assert.deepEqual(checkReminder("x", "2026-02-30", "15:00", now), { ok: false, reason: "date" });
  assert.deepEqual(checkReminder("x", "2026-11-20", "", now), { ok: false, reason: "time" });
  assert.deepEqual(checkReminder("x", "2026-11-20", "14:00", now), { ok: false, reason: "past" });
  assert.deepEqual(checkReminder("x", "2026-11-19", "15:00", now), { ok: false, reason: "past" });
});

test("reschedule moves a reminder later and leaves it unchecked", () => {
  const [first] = parseReminders(NOTE);
  const next = reschedule(NOTE, first, "2026-11-20", "15:05");
  assert.ok(next);
  assert.equal(next.split("\r\n")[2], "- [ ] 2026-11-20 15:05 車の保険を更新");
  assert.equal(reschedule(NOTE.replace("保険を更新", "保険を解約"), first, "2026-11-20", "15:05"), null);
});

test("later crosses midnight", () => {
  assert.deepEqual(later(new Date(2026, 10, 20, 23, 50), 30), { date: "2026-11-21", time: "00:20" });
});

test("reschedule can change the text too, keeping the line's own start", () => {
  const [first] = parseReminders(NOTE);
  const next = reschedule(NOTE, first, "2026-11-21", "09:00", "保険会社に電話");
  assert.ok(next);
  assert.equal(next.split("\r\n")[2], "- [ ] 2026-11-21 09:00 保険会社に電話");
  const [indented] = parseReminders("  * [ ] 2026-11-20 9:05 x");
  assert.equal(reschedule("  * [ ] 2026-11-20 9:05 x", indented, "2026-11-20", "10:05"), "  * [ ] 2026-11-20 10:05 x");
});

test("tomorrowAt is the same time on the next day", () => {
  assert.deepEqual(tomorrowAt(new Date(2026, 10, 30, 23, 0), "15:00"), { date: "2026-12-01", time: "15:00" });
});
