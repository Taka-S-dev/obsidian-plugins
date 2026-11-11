import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, LineDecoder, parse, type FromHost } from "../src/protocol.ts";

test("a message survives encoding, including newlines and escapes in the data", () => {
  const message: FromHost = { t: "output", data: "line 1\r\nline 2\x1b[31m red あ\n" };
  const line = encode(message);
  assert.equal(line.indexOf("\n"), line.length - 1);
  assert.deepEqual(parse(line.trimEnd()), message);
});

test("lines split across chunks are joined; a partial line waits", () => {
  const decoder = new LineDecoder();
  assert.deepEqual(decoder.push('{"t":"rea'), []);
  assert.deepEqual(decoder.push('dy","pid":1}\n{"t":"exit",'), ['{"t":"ready","pid":1}']);
  assert.deepEqual(decoder.push('"code":0}\n\n'), ['{"t":"exit","code":0}']);
});

test("anything that is not a message is ignored", () => {
  assert.equal(parse("not json"), null);
  assert.equal(parse("42"), null);
  assert.equal(parse('{"type":"output"}'), null);
  assert.equal(parse("null"), null);
});
