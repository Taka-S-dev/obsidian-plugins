import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSlot, evaluate, loadAnnounced, parseSlots, pickNew } from "../src/checks.ts";
import { STRINGS } from "../src/i18n.ts";
import { parseReminders, type Reminder } from "../src/reminders.ts";

const s = STRINGS.en;
const at = (h: number, m: number) => new Date(2026, 10, 19, h, m);
const snap = (inbox: string[] | null, reminders: Reminder[] | null = null, now = at(12, 0)) => ({
  now,
  inbox,
  reminders,
  bulletins: [],
  rejected: [],
  dueTasks: null,
});

test("parseSlots keeps valid times, pads, sorts and removes duplicates", () => {
  assert.deepEqual(parseSlots("16:30, 9:00、09:00 25:00 12:60 noon"), ["09:00", "16:30"]);
  assert.deepEqual(parseSlots(""), []);
});

test("currentSlot is the latest time that has passed", () => {
  const slots = ["09:00", "16:30"];
  assert.equal(currentSlot(slots, at(8, 59)), null);
  assert.equal(currentSlot(slots, at(9, 0)), "09:00");
  assert.equal(currentSlot(slots, at(16, 29)), "09:00");
  assert.equal(currentSlot(slots, at(23, 0)), "16:30");
  assert.equal(currentSlot([], at(12, 0)), null);
});

test("a missing or empty inbox reads as clear", () => {
  for (const inbox of [null, []]) {
    const r = evaluate(snap(inbox), "09:00", s);
    assert.equal(r.status, s.status.clear);
    assert.deepEqual(r.details, [s.summary.nothing]);
    assert.deepEqual(r.alerts, []);
  }
});

test("unsorted items show in the status bar and alert once per slot", () => {
  const r = evaluate(snap(["2026-11-19 10:32 call back", "2026-11-19 11:05 expense claim"]), "09:00", s);
  assert.equal(r.status, "Inbox 2");
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].key, "inbox@09:00");
  assert.equal(r.alerts[0].title, "Inbox: 2 not sorted yet");
  assert.equal(r.alerts[0].body, "2026-11-19 10:32 call back\n2026-11-19 11:05 expense claim");
});

test("before the first reminder time, nothing is announced but the status still shows", () => {
  const r = evaluate(snap(["x"]), null, s);
  assert.equal(r.status, "Inbox 1");
  assert.deepEqual(r.alerts, []);
});

test("long lists are cut with a count", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"];
  const r = evaluate(snap(items), "09:00", s);
  assert.deepEqual(r.details, ["Inbox (7)", "・a", "・b", "・c", "・d", "・e", "…and 2 more"]);
  assert.equal(r.alerts[0].body, "a\nb\nc\nd\ne");
});

test("checks are combined in order", () => {
  const r = evaluate(snap(["x"]), "09:00", s, [
    () => ({ status: "First", details: ["first"], alerts: [] }),
    () => ({ details: [], alerts: [] }),
    () => ({ status: "Third", details: ["third"], alerts: [{ key: "k", title: "t", body: "" }] }),
  ]);
  assert.equal(r.status, "First | Third");
  assert.deepEqual(r.details, ["first", "third"]);
  assert.deepEqual(r.alerts.map((a) => a.key), ["k"]);
});

test("the next reminder today shows in the status bar; past and done ones do not", () => {
  const reminders = parseReminders(
    [
      "- [ ] 2026-11-19 11:00 past",
      "- [x] 2026-11-19 13:00 done",
      "- [ ] 2026-11-19 15:30 renew the car insurance",
      "- [ ] 2026-11-19 17:00 file it",
      "- [ ] 2026-11-20 09:00 tomorrow",
    ].join("\n"),
  );
  const r = evaluate(snap(["x"], reminders), null, s);
  assert.equal(r.status, "Next 15:30 renew the car… | Inbox 1");
  assert.deepEqual(r.details.slice(0, 3), ["Reminders left today (2)", "・15:30 renew the car insurance", "・17:00 file it"]);
  assert.deepEqual(r.alerts.map((a) => a.key), []);
});

test("pickNew announces each key once a day", () => {
  const alerts = [{ key: "inbox@09:00", title: "t", body: "" }];
  const first = pickNew({ date: "2026-11-19", keys: [] }, "2026-11-19", alerts);
  assert.equal(first.fresh.length, 1);
  const again = pickNew(first.next, "2026-11-19", alerts);
  assert.equal(again.fresh.length, 0);
  const nextDay = pickNew(first.next, "2026-11-20", alerts);
  assert.equal(nextDay.fresh.length, 1);
  assert.deepEqual(nextDay.next, { date: "2026-11-20", keys: ["inbox@09:00"] });
});

test("loadAnnounced keeps only today's valid keys", () => {
  assert.deepEqual(loadAnnounced({ date: "2026-11-19", keys: ["a", 3] }, "2026-11-19"), { date: "2026-11-19", keys: ["a"] });
  assert.deepEqual(loadAnnounced({ date: "2026-11-18", keys: ["a"] }, "2026-11-19"), { date: "2026-11-19", keys: [] });
  assert.deepEqual(loadAnnounced(undefined, "2026-11-19"), { date: "2026-11-19", keys: [] });
});

test("unread notices lead the status bar; rejected files are mentioned in the details", () => {
  const r = evaluate(
    {
      ...snap(["x"]),
      bulletins: [
        { id: "a", at: "2026-11-19 12:00", text: "report ready", source: "copilot", read: false },
        { id: "b", at: "2026-11-19 11:00", text: "old", read: true },
      ],
      rejected: [{ name: "bad.json", reason: "json", at: "2026-11-19 11:30" }],
    },
    null,
    s,
  );
  assert.equal(r.status, "Notices 1 | Inbox 1");
  assert.deepEqual(r.details.slice(0, 3), ["Unread notices (1)", "・report ready (copilot)", s.summary.rejected(1)]);
});
