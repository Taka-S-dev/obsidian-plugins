import assert from "node:assert/strict";
import { test } from "node:test";
import { closedTab, diffRequest, fileUrl, lockFile, reply, selectionChanged } from "../src/ide-protocol.ts";

test("the lock file names the vault folder and the WebSocket transport", () => {
  assert.deepEqual(lockFile(42, "C:\\Vault", "secret", true), {
    pid: 42, workspaceFolders: ["C:\\Vault"], ideName: "Obsidian", transport: "ws", runningInWindows: true, authToken: "secret",
  });
});

test("initialize echoes the client's protocol version and names the server", () => {
  const r = reply({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, "0.2.0");
  assert.deepEqual(r?.result, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "Obsidian Terminal Pane", version: "0.2.0" },
  });
});

test("notifications get no reply; unknown requests get method-not-found", () => {
  assert.equal(reply({ jsonrpc: "2.0", method: "notifications/initialized" }, "1"), null);
  assert.equal(reply({ jsonrpc: "2.0", method: "ide_connected", params: { pid: 1 } }, "1"), null);
  assert.equal(reply({ jsonrpc: "2.0", id: 7, method: "resources/list" }, "1")?.error?.code, -32601);
});

test("the tools Claude Code calls on its own answer as an editor without diagnostics or diffs", () => {
  const call = (name: string) => reply({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } }, "1")?.result;
  assert.deepEqual(call("getDiagnostics"), { content: [{ type: "text", text: "[]" }] });
  assert.deepEqual(call("close_tab"), { content: [{ type: "text", text: "TAB_CLOSED" }] });
  assert.equal((call("openDiff") as { isError?: boolean }).isError, true);
  const tools = (reply({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "1")?.result as { tools: { name: string }[] }).tools;
  assert.deepEqual(tools.map((t) => t.name), ["openDiff", "getDiagnostics", "close_tab", "closeAllDiffTabs"]);
});

test("selection_changed carries the file, the text and whether anything is selected", () => {
  const m = selectionChanged({ filePath: "C:\\V\\英語\\a b.md", text: "", start: { line: 3, character: 1 }, end: { line: 3, character: 1 } });
  assert.equal(m.method, "selection_changed");
  assert.deepEqual(m.params, {
    text: "", filePath: "C:\\V\\英語\\a b.md", fileUrl: "file:///C:/V/%E8%8B%B1%E8%AA%9E/a%20b.md",
    selection: { start: { line: 3, character: 1 }, end: { line: 3, character: 1 }, isEmpty: true },
  });
});

test("fileUrl handles POSIX paths too", () => {
  assert.equal(fileUrl("/home/u/v/a.md"), "file:///home/u/v/a.md");
});

test("openDiff and close_tab calls are read for the diff view", () => {
  const open = { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "openDiff", arguments: {
    old_file_path: "C:/v/a.md", new_file_path: "C:/v/a.md", new_file_contents: "new", tab_name: "T1" } } };
  assert.deepEqual(diffRequest(open), { path: "C:/v/a.md", contents: "new", tabName: "T1" });
  assert.equal(diffRequest({ jsonrpc: "2.0", method: "tools/call", params: { name: "openDiff", arguments: {} } }), null);
  assert.equal(closedTab({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "close_tab", arguments: { tab_name: "T1" } } }), "T1");
  assert.equal(closedTab(open), null);
});
