import { test } from "node:test";
import assert from "node:assert/strict";
import { appendEntry, checkItem, editItem, folderOf, formatEntry, inboxItems, openItems, removeItem, shortDate, splitStamp, withoutStamp } from "../src/inbox.ts";

test("only unchecked items count", () => {
  const note = ["# 受信箱", "", "- [ ] 2026-11-19 10:32 図書館の本", "- [x] done", "* [ ] star bullet", "  - [ ] indented", "- [-] cancelled", "- plain"].join("\r\n");
  assert.deepEqual(openItems(note), ["2026-11-19 10:32 図書館の本", "star bullet", "indented"]);
  assert.deepEqual(openItems(""), []);
});

test("an entry is one dated line", () => {
  const entry = formatEntry(new Date(2026, 10, 19, 9, 5), "  図書館の本を\n返す  ");
  assert.equal(entry, "- [ ] 2026-11-19 09:05 図書館の本を 返す");
});

test("appending adds a header to an empty note and keeps one trailing newline", () => {
  assert.equal(appendEntry("", "- [ ] a", "# 受信箱"), "# 受信箱\n\n- [ ] a\n");
  assert.equal(appendEntry("# 受信箱\n\n- [ ] a\n\n\n", "- [ ] b", "# 受信箱"), "# 受信箱\n\n- [ ] a\n- [ ] b\n");
  assert.equal(appendEntry("# 受信箱", "- [ ] a", "# 受信箱"), "# 受信箱\n- [ ] a\n");
});

test("folderOf splits vault paths", () => {
  assert.equal(folderOf("秘書/受信箱.md"), "秘書");
  assert.equal(folderOf("a/b/c.md"), "a/b");
  assert.equal(folderOf("受信箱.md"), "");
});

test("an item moved elsewhere leaves the note, unless its line changed", () => {
  const note = ["# 受信箱", "", "- [ ] 2026-11-19 10:32 図書館の本", "- [ ] 歯医者に電話"].join("\r\n");
  const [first, second] = inboxItems(note);
  assert.equal(second.text, "歯医者に電話");
  assert.equal(removeItem(note, first), ["# 受信箱", "", "- [ ] 歯医者に電話"].join("\r\n"));
  assert.equal(removeItem(note.replace("図書館の本", "図書館の本を返す"), first), null);
});

test("the date and time an item was added are left off when it moves", () => {
  assert.equal(withoutStamp("2026-11-19 10:32 図書館の本"), "図書館の本");
  assert.equal(withoutStamp("歯医者に電話"), "歯医者に電話");
});

test("an item dealt with is checked off and stays as a record", () => {
  const note = ["# 受信箱", "- [ ] a", "- [ ] b"].join("\r\n");
  const [, b] = inboxItems(note);
  const next = checkItem(note, b);
  assert.equal(next, ["# 受信箱", "- [ ] a", "- [x] b"].join("\r\n"));
  assert.deepEqual(openItems(next ?? ""), ["a"]);
  assert.equal(checkItem(note.replace("- [ ] b", "- [ ] b!"), b), null);
});

test("editing an item changes its text and keeps when it was added", () => {
  const note = ["# 受信箱", "- [ ] 2026-11-19 10:32 図書館の本", "  * [ ] 歯医者"].join("\r\n");
  const [first, second] = inboxItems(note);
  assert.equal(editItem(note, first, "図書館の本を\n返す"), ["# 受信箱", "- [ ] 2026-11-19 10:32 図書館の本を 返す", "  * [ ] 歯医者"].join("\r\n"));
  assert.equal(editItem(note, second, "歯医者に電話"), ["# 受信箱", "- [ ] 2026-11-19 10:32 図書館の本", "  * [ ] 歯医者に電話"].join("\r\n"));
  assert.equal(editItem(note.replace("図書館の本", "x"), first, "y"), null);
});

test("the panel shows when an item was added in short, apart from its text", () => {
  assert.deepEqual(splitStamp("2026-11-09 9:05 図書館の本", "2026-11-25"), { stamp: "11/9 9:05", text: "図書館の本" });
  assert.deepEqual(splitStamp("2025-12-31 23:59 old", "2026-11-25"), { stamp: "2025/12/31 23:59", text: "old" });
  assert.equal(splitStamp("no stamp here", "2026-11-25"), null);
  assert.equal(shortDate("2026-01-02", "2026-11-25"), "1/2");
  assert.equal(shortDate("2027-01-02", "2026-11-25"), "2027/1/2");
});
