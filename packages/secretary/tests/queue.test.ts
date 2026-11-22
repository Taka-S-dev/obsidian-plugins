import { test } from "node:test";
import assert from "node:assert/strict";
import { isMessageFile, MAX_TEXT, parseMessage } from "../src/queue.ts";

const parse = (data: unknown) => parseMessage("20261120-0020-copilot.json", typeof data === "string" ? data : JSON.stringify(data));

test("notify, remind and inbox messages are accepted", () => {
  assert.deepEqual(parse({ v: 1, type: "notify", text: "調べ終わりました\n結果はメモに", source: "copilot" }), {
    ok: true,
    message: { id: "20261120-0020-copilot.json", type: "notify", text: "調べ終わりました\n結果はメモに", at: undefined, source: "copilot", quiet: false },
  });
  assert.deepEqual(parse({ v: 1, type: "remind", text: "歯医者に電話", at: "2026-11-20T15:00" }), {
    ok: true,
    message: { id: "20261120-0020-copilot.json", type: "remind", text: "歯医者に電話", at: { date: "2026-11-20", time: "15:00" }, source: undefined, quiet: false },
  });
  const inbox = parse({ v: 1, type: "inbox", text: "  図書館の本  ", source: "  " });
  assert.ok(inbox.ok);
  assert.equal(inbox.message.text, "図書館の本");
  assert.equal(inbox.message.source, undefined);
});

test("BOM, CRLF, seconds and unknown fields are fine", () => {
  const r = parse(`﻿${JSON.stringify({ v: 1, type: "remind", text: "a\r\nb", at: "2026-11-20T15:00:30", future: true })}`);
  assert.ok(r.ok);
  assert.equal(r.message.text, "a\nb");
  assert.deepEqual(r.message.at, { date: "2026-11-20", time: "15:00" });
});

test("quiet applies to notify only", () => {
  const n = parse({ v: 1, type: "notify", text: "x", quiet: true });
  const i = parse({ v: 1, type: "inbox", text: "x", quiet: true });
  assert.ok(n.ok && i.ok);
  assert.equal(n.message.quiet, true);
  assert.equal(i.message.quiet, false);
  const truthy = parse({ v: 1, type: "notify", text: "x", quiet: "yes" });
  assert.ok(truthy.ok);
  assert.equal(truthy.message.quiet, false);
});

test("each kind of bad message is rejected with its reason", () => {
  const cases: [unknown, string][] = [
    ["{not json", "json"],
    ["[1,2]", "json"],
    ["null", "json"],
    [{ type: "notify", text: "x" }, "version"],
    [{ v: 2, type: "notify", text: "x" }, "version"],
    [{ v: "1", type: "notify", text: "x" }, "version"],
    [{ v: 1, type: "delete", text: "x" }, "type"],
    [{ v: 1, type: "notify" }, "text"],
    [{ v: 1, type: "notify", text: "   " }, "text"],
    [{ v: 1, type: "notify", text: "a".repeat(MAX_TEXT + 1) }, "text"],
    [{ v: 1, type: "notify", text: "bell\u0007" }, "text"],
    [{ v: 1, type: "notify", text: "x", source: 3 }, "source"],
    [{ v: 1, type: "notify", text: "x", source: "a\nb" }, "source"],
    [{ v: 1, type: "notify", text: "x", source: "s".repeat(41) }, "source"],
    [{ v: 1, type: "remind", text: "x" }, "at"],
    [{ v: 1, type: "remind", text: "x", at: "2026-11-20 15:00" }, "at"],
    [{ v: 1, type: "remind", text: "x", at: "2026-11-20T15:00Z" }, "at"],
    [{ v: 1, type: "remind", text: "x", at: "2026-11-20T15:00+09:00" }, "at"],
    [{ v: 1, type: "remind", text: "x", at: "2026-02-30T10:00" }, "at"],
    [{ v: 1, type: "remind", text: "x", at: "2026-11-20T24:00" }, "at"],
  ];
  for (const [data, reason] of cases) {
    assert.deepEqual(parse(data), { ok: false, reason }, JSON.stringify(data));
  }
});

test("oversized content is rejected before parsing", () => {
  assert.deepEqual(parse(`{"v":1,"type":"notify","text":"x","pad":"${"a".repeat(17 * 1024)}"}`), { ok: false, reason: "size" });
});

test("only finished, visible json files are messages", () => {
  assert.equal(isMessageFile("20261120-001-copilot.json"), true);
  assert.equal(isMessageFile("A.JSON"), true);
  assert.equal(isMessageFile("20261120-001-copilot.json.tmp"), false);
  assert.equal(isMessageFile("20261120-001-copilot.tmp"), false);
  assert.equal(isMessageFile(".hidden.json"), false);
});
