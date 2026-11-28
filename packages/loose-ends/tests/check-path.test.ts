import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPaths, hostOf, neverContact, rootOf } from "../src/check-path.ts";

test("the root is the drive or the share", () => {
  assert.equal(rootOf("c:\\a\\b.xlsx"), "C:\\");
  assert.equal(rootOf("\\\\server\\share\\a\\b.xlsx"), "\\\\server\\share\\");
  assert.equal(hostOf("\\\\Server\\share\\a"), "server");
  assert.equal(hostOf("C:\\a"), null);
});

test("WebDAV and device paths are never contacted", () => {
  assert.ok(neverContact("host@ssl@443"));
  assert.ok(neverContact("?"));
  assert.ok(neverContact("."));
  assert.ok(!neverContact("fileserver"));
});

test("a server not allowed is skipped without being contacted", async () => {
  const asked: string[] = [];
  const paths = ["\\\\stranger.invalid\\share\\a.xlsx", "\\\\x@ssl@443\\dav\\b.xlsx"];
  const status = await checkPaths(paths, 50, (host) => {
    asked.push(host);
    return false;
  });
  assert.deepEqual([...status.values()], ["skipped", "skipped"]);
  // WebDAV is skipped before the allow list is even asked.
  assert.deepEqual(asked, ["stranger.invalid"]);
});

test("paths are found or missing, and a root that is not there makes them unreachable", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "loose-ends-"));
  try {
    const there = join(dir, "there.xlsx");
    writeFileSync(there, "");
    const gone = join(dir, "gone.xlsx");
    // A drive letter that is almost never in use.
    const noDrive = "B:\\nothing\\here.xlsx";
    const status = await checkPaths([there, gone, noDrive, there], 3_000, () => false);
    assert.equal(status.get(there), "found");
    assert.equal(status.get(gone), "missing");
    assert.equal(status.get(noDrive), "unreachable");
    assert.equal(status.size, 3);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
