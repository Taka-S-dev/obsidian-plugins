import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRequest, parseRpc, reply } from "../src/ide-protocol.ts";

test("a message object is read as it is", () => {
  assert.deepEqual(parseRpc('{"jsonrpc":"2.0","id":1,"method":"ping"}'), { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.deepEqual(parseRpc('{"jsonrpc":"2.0","method":"notifications/initialized"}'), { jsonrpc: "2.0", method: "notifications/initialized" });
});

test("text that is not a message object is refused rather than read", () => {
  for (const text of ["null", "42", '"text"', "[]", "[1]", "{", "", '{"method":5}', '{"id":{}}']) {
    assert.equal(parseRpc(text), null, text);
  }
});

test("odd params in a message object do not throw", () => {
  for (const params of ["null", "5", '"x"', '{"name":"openDiff","arguments":null}', '{"name":"openDiff","arguments":7}']) {
    const message = parseRpc(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":${params}}`);
    assert.ok(message);
    assert.doesNotThrow(() => diffRequest(message));
    assert.doesNotThrow(() => reply(message, "0"));
  }
});
