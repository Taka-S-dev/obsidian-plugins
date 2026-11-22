import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultQueueDir, ensureQueueDir, listMessages, messageKey, readMessage, rejectMessage, removeMessage, REJECTED_DIR } from "../src/spool.ts";

function queue(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "secretary-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("default folder is under LOCALAPPDATA, or the home folder elsewhere", () => {
  assert.equal(defaultQueueDir({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "C:\\Users\\me"), join("C:\\Users\\me\\AppData\\Local", "Secretary", "queue"));
  assert.equal(defaultQueueDir({}, "/home/me"), join("/home/me", ".secretary", "queue"));
});

test("lists finished message files oldest first, skipping temporary files and folders", async (t) => {
  const dir = queue(t);
  await ensureQueueDir(dir);
  for (const name of ["20261120-0002-b.json", "20261120-0001-a.json", "20261120-0003-c.json.tmp", ".x.json", "note.txt"]) {
    writeFileSync(join(dir, name), "{}");
  }
  assert.deepEqual(await listMessages(dir, 10), ["20261120-0001-a.json", "20261120-0002-b.json"]);
  assert.deepEqual(await listMessages(dir, 1), ["20261120-0001-a.json"]);
});

test("reads and checks a message; oversized files are refused by size", async (t) => {
  const dir = queue(t);
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ v: 1, type: "notify", text: "こんにちは" }));
  writeFileSync(join(dir, "big.json"), `{"pad":"${"a".repeat(20 * 1024)}"}`);
  const ok = await readMessage(dir, "ok.json");
  assert.ok(ok.ok);
  assert.equal(ok.message.text, "こんにちは");
  assert.deepEqual(await readMessage(dir, "big.json"), { ok: false, reason: "size" });
});

test("rejected files move aside without overwriting earlier ones; removal tolerates missing files", async (t) => {
  const dir = queue(t);
  await ensureQueueDir(dir);
  writeFileSync(join(dir, "bad.json"), "x");
  assert.equal(await rejectMessage(dir, "bad.json"), "bad.json");
  writeFileSync(join(dir, "bad.json"), "y");
  assert.equal(await rejectMessage(dir, "bad.json"), "bad-1.json");
  assert.deepEqual(readdirSync(join(dir, REJECTED_DIR)).sort(), ["bad-1.json", "bad.json"]);
  assert.equal(existsSync(join(dir, "bad.json")), false);

  writeFileSync(join(dir, "done.json"), "{}");
  await removeMessage(dir, "done.json");
  await removeMessage(dir, "done.json");
  assert.equal(existsSync(join(dir, "done.json")), false);
});

test("a name reused for a new message gets a new key", async (t) => {
  const dir = queue(t);
  const name = "msg.json";
  writeFileSync(join(dir, name), '{"v":1,"type":"inbox","text":"a"}');
  const first = await messageKey(dir, name);
  assert.equal(await messageKey(dir, name), first);
  writeFileSync(join(dir, name), '{"v":1,"type":"inbox","text":"a longer one"}');
  assert.notEqual(await messageKey(dir, name), first);
});
