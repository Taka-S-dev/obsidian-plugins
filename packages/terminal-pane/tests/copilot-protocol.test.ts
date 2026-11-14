import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeDiffResult, copilotClosedDiff, copilotDiffRequest, copilotLock, copilotReply, DIFF_CLOSED_RESULT,
} from "../src/copilot-protocol.ts";

test("the lock file names the pipe, the nonce and the vault folder", () => {
  assert.deepEqual(copilotLock("\\\\.\\pipe\\mcp-x.sock", "n1", 7, "C:\\Vault", 1000), {
    socketPath: "\\\\.\\pipe\\mcp-x.sock",
    scheme: "pipe",
    headers: { Authorization: "Nonce n1" },
    pid: 7,
    timestamp: 1000,
    workspaceFolders: ["C:\\Vault"],
    ideName: "Obsidian",
    isTrusted: true,
  });
});

test("tools/list offers the tools Copilot CLI calls", () => {
  const r = copilotReply({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "1", null);
  const names = (r?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  assert.deepEqual(names, ["get_selection", "get_diagnostics", "open_diff", "close_diff", "update_session_name"]);
});

test("get_selection returns the latest selection as JSON text", () => {
  const selection = { filePath: "C:\\V\\a.md", text: "hi" };
  const r = copilotReply({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_selection", arguments: {} } }, "1", selection);
  assert.deepEqual(r?.result, { content: [{ type: "text", text: JSON.stringify(selection) }] });
});

test("notifications get no reply", () => {
  assert.equal(copilotReply({ jsonrpc: "2.0", method: "notifications/initialized" }, "1", null), null);
});

test("open_diff and close_diff are read for the diff view", () => {
  const open = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "open_diff", arguments: {
    original_file_path: "C:\\V\\a.md", new_file_contents: "new", tab_name: "[Copilot CLI] - a.md (abc123)" } } };
  assert.deepEqual(copilotDiffRequest(open), { path: "C:\\V\\a.md", contents: "new", tabName: "[Copilot CLI] - a.md (abc123)" });
  assert.equal(copilotClosedDiff({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "close_diff", arguments: { tab_name: "T" } } }), "T");
  assert.equal(copilotClosedDiff(open), null);
});

test("close_diff answers in the shape Copilot CLI checks", () => {
  const body = JSON.parse((closeDiffResult("T", true) as { content: { text: string }[] }).content[0].text);
  assert.deepEqual(body, { success: true, already_closed: false, tab_name: "T", message: "Closed" });
});

test("a diff closed from the terminal is never answered as saved or rejected", () => {
  const textOf = DIFF_CLOSED_RESULT.content[0].text;
  assert.throws(() => JSON.parse(textOf));
});
