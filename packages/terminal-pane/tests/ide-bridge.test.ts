// Two Claude Code sessions asking for diffs under the same name, against the real bridge.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { IdeBridge } from "../src/ide-bridge.ts";
import type { DiffRequest } from "../src/ide-protocol.ts";

test("diffs with the same name from two sessions are kept apart", async () => {
  const config = mkdtempSync(join(tmpdir(), "ide-bridge-test-"));
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  const shown: { key: string; decide: (approve: boolean) => void }[] = [];
  const bridge = new IdeBridge("C:/vault", "0", {
    show: (key: string, _request: DiffRequest, _assistant: string, decide: (approve: boolean) => void) => shown.push({ key, decide }),
    close: () => {},
  }, () => {});
  const sockets: WebSocket[] = [];
  try {
    await bridge.start();
    const lockName = readdirSync(join(config, "ide"))[0];
    const { authToken } = JSON.parse(readFileSync(join(config, "ide", lockName), "utf-8")) as { authToken: string };
    const port = lockName.replace(".lock", "");
    const answers: string[][] = [[], []];
    for (const i of [0, 1]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, "mcp", { headers: { "x-claude-code-ide-authorization": authToken } });
      await new Promise((resolve) => socket.once("open", resolve));
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as { id?: number; result?: { content: { text: string }[] } };
        if (message.id === 7) answers[i].push(message.result!.content[0].text);
      });
      sockets.push(socket);
    }
    const open = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "openDiff", arguments: {
      old_file_path: "C:/vault/a.md", new_file_path: "C:/vault/a.md", new_file_contents: "x", tab_name: "same name",
    } } };
    for (const socket of sockets) socket.send(JSON.stringify(open));
    while (shown.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));

    assert.notEqual(shown[0].key, shown[1].key);
    shown[0].decide(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(answers, [["FILE_SAVED"], []], "only the first session gets the approval");
    shown[0].decide(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(answers, [["FILE_SAVED"], []], "a decided diff cannot be decided again");
  } finally {
    for (const socket of sockets) socket.close();
    bridge.stop();
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rmSync(config, { recursive: true, force: true });
  }
});
