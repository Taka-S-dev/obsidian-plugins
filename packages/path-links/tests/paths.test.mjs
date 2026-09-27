import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePaths, insertion, filePath, parseEntries } from "../src/paths.ts";

test("the actual sample note parses both raw and labeled paths", () => {
  const note = readFileSync(new URL("./fixtures/sample-note.md", import.meta.url), "utf8");
  const body = note.split("```path-links")[1].split("```")[0];
  assert.deepEqual(parseEntries(body), [
    { path: String.raw`\\localhost\Users`, label: String.raw`\\localhost\Users` },
    { path: String.raw`C:\Users`, label: "ローカルのユーザーフォルダ" }
  ]);
});

test("file URIs decode once and preserve UNC, spaces and percent signs", () => {
  for (const uri of ["file:////localhost/Users", "file://///localhost/Users", "file:///%5C%5Clocalhost/Users"]) {
    assert.equal(filePath(uri), String.raw`\\localhost\Users`);
  }
  assert.equal(filePath("file://server/share/x"), String.raw`\\server\share\x`);
  assert.equal(filePath("file://127.0.0.1/Users"), String.raw`\\127.0.0.1\Users`);
  assert.equal(filePath("file:///C:/a%20b/100%25.txt"), String.raw`C:\a b\100%.txt`);
  assert.equal(filePath("https://example.com"), null);
  assert.equal(filePath("file:///%ZZ"), null);
  assert.equal(filePath("file:///%5C%5C.%5Cdevice"), null);
});
test("custom labels preserve the raw copy target", () => {
  assert.deepEqual(parseEntries(String.raw`[共有フォルダ](<\\localhost\Users>)`), [{ label: "共有フォルダ", path: String.raw`\\localhost\Users` }]);
  assert.deepEqual(parseEntries("[ユーザー](file://127.0.0.1/Users)"), [{ label: "ユーザー", path: String.raw`\\127.0.0.1\Users` }]);
});
test("file://localhost means this machine (RFC 8089, and how Windows resolves it)", () => {
  assert.equal(filePath("file://localhost/C:/Users/Public"), String.raw`C:\Users\Public`);
  assert.equal(filePath("file://LOCALHOST/c:/a%20b"), String.raw`c:\a b`);
  // No drive letter: Windows turns this into the drive-relative "\Users", not a share.
  assert.equal(filePath("file://localhost/Users"), null);
  assert.equal(filePath("file://localhost"), null);
  // Only the exact host name is special.
  assert.equal(filePath("file://localhost2/share"), String.raw`\\localhost2\share`);
});

test("UNC leading slashes, dollar share, Japanese, spaces and symbols survive exactly", () => {
  const path = String.raw`\\server\share$\日本語 空白\a#b%[c]_d.xlsx`;
  assert.deepEqual(parsePaths(path), [path]);
});
test("Explorer quotes and multiple CRLF paths", () => {
  assert.deepEqual(parsePaths('"C:\\a b\\c.pdf"\r\n"\\\\localhost\\Users"\r\n'), ["C:\\a b\\c.pdf", "\\\\localhost\\Users"]);
});
test("root paths supported, invalid input rejected as a whole", () => {
  assert.deepEqual(parsePaths("C:\\\n\\\\server"), ["C:\\", "\\\\server"]);
  for (const value of ["", "relative/path", "https://example.com", "javascript:bad", "C:relative", "\\\\.\\device", "C:\\ok\nnot a path"]) {
    assert.throws(() => parsePaths(value));
  }
});
test("insertion separates a block from surrounding paragraph text", () => {
  assert.equal(insertion("BLOCK", "before", "after"), "\n\nBLOCK\n\n");
  assert.equal(insertion("BLOCK", "", ""), "BLOCK\n");
});
