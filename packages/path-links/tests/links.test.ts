import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLinks, escapeLabel, findFileLinks, pathLabel, toFileUri } from "../src/links.ts";
import { filePath } from "../src/paths.ts";

const PATHS = [
  "C:\\Users\\me\\projects\\app\\target\\release",
  "\\\\server\\share$\\日本語 空白\\a#b%[c]_d.xlsx",
  "C:\\a b\\100%.txt",
  "C:\\",
  "\\\\localhost\\Users",
];

test("file URIs stay readable: only % and # are encoded", () => {
  assert.equal(toFileUri(PATHS[0]), "file:///C:/Users/me/projects/app/target/release");
  assert.equal(toFileUri(PATHS[1]), "file://server/share$/日本語 空白/a%23b%25[c]_d.xlsx");
  assert.equal(toFileUri("\\\\127.0.0.1\\Users"), "file://127.0.0.1/Users");
});

test("the \\\\localhost share uses the UNC form, since file://localhost/ means this machine", () => {
  assert.equal(toFileUri("\\\\localhost\\Users"), "file:////localhost/Users");
  assert.equal(toFileUri("\\\\LOCALHOST"), "file:////LOCALHOST");
  assert.equal(toFileUri("\\\\localhost2\\share"), "file://localhost2/share");
  assert.equal(filePath(toFileUri("\\\\localhost\\Users")), "\\\\localhost\\Users");
});

// Obsidian's renderer (like markdown-it) percent-encodes the href but keeps existing %XX escapes.
function rendererHref(uri: string): string {
  return uri
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part) => (/^%[0-9A-Fa-f]{2}$/.test(part) ? part : encodeURI(part)))
    .join("");
}

test("URIs round-trip to the exact path, raw in source or as the rendered href", () => {
  // Observed in Obsidian 1.13 for the second path below.
  assert.equal(
    rendererHref(toFileUri(PATHS[1])),
    "file://server/share$/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%E7%A9%BA%E7%99%BD/a%23b%25%5Bc%5D_d.xlsx",
  );
  for (const path of PATHS) {
    const uri = toFileUri(path);
    assert.equal(filePath(uri), path, `raw: ${uri}`);
    assert.equal(filePath(rendererHref(uri)), path, `rendered: ${rendererHref(uri)}`);
  }
});

test("labels use the last segment", () => {
  assert.equal(pathLabel(PATHS[0]), "release");
  assert.equal(pathLabel("C:\\a\\release\\"), "release");
  assert.equal(pathLabel("\\\\server\\share"), "share");
  assert.equal(pathLabel("\\\\server"), "server");
  assert.equal(pathLabel("C:\\"), "C:");
});

test("labels escape only what would break the link", () => {
  assert.equal(escapeLabel("a[1]`b`"), "a\\[1\\]\\`b\\`");
  assert.equal(escapeLabel("my_file_name.txt"), "my_file_name.txt");
  assert.equal(escapeLabel("_draft_"), "\\_draft\\_");
});

test("one path becomes an inline link named after the folder", () => {
  assert.deepEqual(buildLinks(`"${PATHS[0]}"`), {
    text: "[release](<file:///C:/Users/me/projects/app/target/release>)",
    multiline: false,
  });
});

test("the selection becomes the label", () => {
  assert.equal(buildLinks("\\\\server\\share\\x", " 共有資料 ").text, "[共有資料](<file://server/share/x>)");
  assert.equal(buildLinks("C:\\x", "a [draft]").text, "[a \\[draft\\]](<file:///C:/x>)");
});

test("web URLs become autolinks, or labeled links with a selection", () => {
  assert.equal(buildLinks("https://example.com/a b?x=1").text, "<https://example.com/a%20b?x=1>");
  assert.equal(buildLinks("https://example.com/a", "資料").text, "[資料](<https://example.com/a>)");
});

test("several lines become a list and ignore the selection", () => {
  assert.deepEqual(buildLinks('"C:\\a"\r\n\\\\server\\share\r\nhttps://example.com\r\n', "ignored"), {
    text: "- [a](<file:///C:/a>)\n- [share](<file://server/share>)\n- <https://example.com>",
    multiline: true,
  });
});

test("invalid input is rejected as a whole", () => {
  assert.throws(() => buildLinks(""));
  assert.throws(() => buildLinks("C:\\ok\nrelative\\path"));
  assert.throws(() => buildLinks("javascript:alert(1)"));
});

test("findFileLinks locates file links in a line, in both destination forms", () => {
  const line = "- [📁 release](<file:///C:/a b/release>) and [x](file:///C:/x) and [web](https://example.com)";
  const found = findFileLinks(line);
  assert.deepEqual(found.map((f) => f.path), ["C:\\a b\\release", "C:\\x"]);
  assert.equal(line.slice(found[0].from, found[0].to), "[📁 release](<file:///C:/a b/release>)");
  assert.equal(line.slice(found[1].from, found[1].to), "[x](file:///C:/x)");
});

test("findFileLinks handles labels with escaped brackets and the legacy encoded form", () => {
  assert.deepEqual(findFileLinks("[a \\[1\\]](<file:///C:/a>)").map((f) => f.path), ["C:\\a"]);
  assert.deepEqual(findFileLinks("[old](<file:///%5C%5Clocalhost/Users>)").map((f) => f.path), ["\\\\localhost\\Users"]);
});

test("every generated link is found again by findFileLinks", () => {
  for (const path of PATHS) {
    const { text } = buildLinks(path);
    assert.deepEqual(findFileLinks(text).map((f) => f.path), [path], text);
  }
});
