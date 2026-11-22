import { test } from "node:test";
import assert from "node:assert/strict";
import { addBulletin, dismiss, loadBulletins, loadRejected, loadStrings, markRead, remember, unread, type Bulletin } from "../src/bulletins.ts";

const b = (id: string, read = false): Bulletin => ({ id, at: "2026-11-20 00:20", text: id, read });

test("new bulletins go first and a repeated id replaces the old one", () => {
  let list = addBulletin([], b("a"));
  list = addBulletin(list, b("b"));
  list = addBulletin(list, { ...b("a"), text: "again" });
  assert.deepEqual(list.map((x) => [x.id, x.text]), [["a", "again"], ["b", "b"]]);
});

test("over the limit, read ones are dropped before unread ones", () => {
  let list = [b("old-unread"), b("old-read", true), b("new-read", true)].reverse(); // newest first
  list = addBulletin(list, b("newest"), 3);
  assert.deepEqual(list.map((x) => x.id), ["newest", "new-read", "old-unread"]);
  list = addBulletin(list, b("newer"), 3);
  assert.deepEqual(list.map((x) => x.id), ["newer", "newest", "old-unread"]);
  list = addBulletin(list, b("latest"), 3);
  assert.deepEqual(list.map((x) => x.id), ["latest", "newer", "newest"]);
});

test("markRead marks one or all", () => {
  const list = [b("a"), b("b")];
  assert.deepEqual(unread(markRead(list, "a")).map((x) => x.id), ["b"]);
  assert.deepEqual(unread(markRead(list)), []);
  assert.deepEqual(unread(list).length, 2, "the original list is not changed");
});

test("saved state is checked and bounded", () => {
  assert.deepEqual(loadBulletins([b("a"), { id: 1 }, null, { ...b("c"), source: 5 }]), [b("a"), b("c")]);
  assert.deepEqual(loadBulletins("nope"), []);
  assert.deepEqual(loadStrings(["a", 1, "b", "c"], 2), ["b", "c"]);
  assert.deepEqual(loadRejected([{ name: "x.json", reason: "json", at: "t" }, { name: "y" }]), [{ name: "x.json", reason: "json", at: "t" }]);
});

test("remember keeps the most recent", () => {
  assert.deepEqual(remember(["a", "b"], "c", 2), ["b", "c"]);
});

test("dismiss takes one notice off, read or not, or every read one", () => {
  const list = [b("a"), b("b", true), b("c", true)];
  assert.deepEqual(dismiss(list, "a").map((x) => x.id), ["b", "c"]);
  assert.deepEqual(dismiss(list, "b").map((x) => x.id), ["a", "c"]);
  assert.deepEqual(dismiss(list).map((x) => x.id), ["a"]);
});
