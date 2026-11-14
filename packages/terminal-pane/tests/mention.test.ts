import assert from "node:assert/strict";
import { test } from "node:test";
import { fileReference } from "../src/copilot-protocol.ts";
import { atMentioned } from "../src/ide-protocol.ts";

test("Claude Code is asked to mention a file, with 0-based lines when some are selected", () => {
  assert.deepEqual(atMentioned({ filePath: "C:/v/a.md" }), {
    jsonrpc: "2.0", method: "at_mentioned", params: { filePath: "C:/v/a.md" },
  });
  assert.deepEqual(atMentioned({ filePath: "C:/v/a.md", lines: { start: 2, end: 4 } }).params, {
    filePath: "C:/v/a.md", lineStart: 2, lineEnd: 4,
  });
});

test("Copilot CLI is asked to add a file reference, with a selection when lines are given", () => {
  assert.deepEqual(fileReference({ filePath: "C:/v/a b.md" }), {
    jsonrpc: "2.0",
    method: "add_file_reference",
    params: { filePath: "C:/v/a b.md", fileUrl: "file:///C:/v/a%20b.md", selection: null, selectedText: null },
  });
  const params = fileReference({ filePath: "C:/v/a.md", lines: { start: 1, end: 3 } }).params as { selection: unknown };
  assert.deepEqual(params.selection, { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } });
});
