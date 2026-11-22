import { test } from "node:test";
import assert from "node:assert/strict";
import { asNotePath, matchPaths, noteLocations, queueDirLabel } from "../src/paths.ts";

test("a note path without an extension gets .md", () => {
  assert.equal(asNotePath("Inbox"), "Inbox.md");
  assert.equal(asNotePath(" notes/Reminders.md "), "notes/Reminders.md");
  assert.equal(asNotePath("a/Old.MD"), "a/Old.MD");
  assert.equal(asNotePath(""), "");
});

test("paths match every word, names starting with the query first", () => {
  const paths = ["notes/Old inbox.md", "Inbox.md", "work/inbox/today.md", "Reminders.md"];
  assert.deepEqual(matchPaths(paths, "inbox", 10), ["Inbox.md", "notes/Old inbox.md", "work/inbox/today.md"]);
  assert.deepEqual(matchPaths(paths, "old box", 10), ["notes/Old inbox.md"]);
  assert.equal(matchPaths(paths, "", 2).length, 2);
});

test("the default queue folder is shown without the user's own folder", () => {
  assert.equal(queueDirLabel({ LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local` }), String.raw`%LOCALAPPDATA%\Secretary\queue`);
  assert.equal(queueDirLabel({}), "~/.secretary/queue");
});

test("note locations are the default name at the root and in each folder, never other notes", () => {
  assert.deepEqual(noteLocations(["a", "a/b"], "受信箱.md"), ["受信箱.md", "a/受信箱.md", "a/b/受信箱.md"]);
});
