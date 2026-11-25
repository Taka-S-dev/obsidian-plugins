import { test } from "node:test";
import assert from "node:assert/strict";
import { filePath, MAX_LINKED, plainText, segments } from "../src/links.ts";
import { isOpenableScheme, opensDirectly, shareHost } from "../src/safety.ts";

const BS = "\\";

test("text without links is one plain part", () => {
  assert.deepEqual(segments("Buy rice [soon] (today)"), [{ kind: "text", text: "Buy rice [soon] (today)" }]);
  assert.deepEqual(segments(""), []);
});

test("web, file and note links are found with the words they show", () => {
  const text = "Send [the quote](<file://server/share/sales/quote 2.xlsx>) and check <https://example.com/a> or [[Plan#Budget|the budget]]";
  assert.deepEqual(segments(text), [
    { kind: "text", text: "Send " },
    { kind: "file", text: "the quote", path: `${BS}${BS}server${BS}share${BS}sales${BS}quote 2.xlsx` },
    { kind: "text", text: " and check " },
    { kind: "web", text: "https://example.com/a", url: "https://example.com/a" },
    { kind: "text", text: " or " },
    { kind: "note", text: "the budget", target: "Plan#Budget" },
  ]);
});

test("a link's label is unescaped, and a path without one shows the path", () => {
  const label = String.raw`[${BS}${BS}${BS}server${BS}share${BS}x](<file://server/share/x>)`;
  assert.deepEqual(segments(label), [{ kind: "file", text: String.raw`\\server\share\x`, path: String.raw`\\server\share\x` }]);
  assert.deepEqual(segments("[](<file:///C:/a/b>)"), [{ kind: "file", text: "C:\\a\\b", path: "C:\\a\\b" }]);
});

test("a bare web address stops before the sentence's punctuation", () => {
  assert.deepEqual(segments("See https://example.com/a_(b)."), [
    { kind: "text", text: "See " },
    { kind: "web", text: "https://example.com/a_(b)", url: "https://example.com/a_(b)" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(segments("（https://example.com/x）を見る").map((s) => s.kind), ["text", "web", "text"]);
  assert.equal((segments("(see https://example.com/x)")[1] as { url: string }).url, "https://example.com/x");
});

test("links that would run script, or file links that are not Windows paths, stay text", () => {
  assert.deepEqual(segments("[x](javascript:alert(1))"), [{ kind: "text", text: "x" }]);
  assert.deepEqual(segments("[y](<file://localhost/Users>)"), [{ kind: "text", text: "y" }]);
  assert.deepEqual(segments("[z](<file:///%5C%5C?%5Cx>)"), [{ kind: "text", text: "z" }]);
});

test("a relative destination is a note", () => {
  assert.deepEqual(segments("[plan](Projects/Plan%202.md)"), [{ kind: "note", text: "plan", target: "Projects/Plan 2.md" }]);
  assert.deepEqual(segments("[[Meeting notes]]"), [{ kind: "note", text: "Meeting notes", target: "Meeting notes" }]);
});

test("file addresses become Windows paths", () => {
  assert.equal(filePath("file:///C:/a%20b/c"), "C:\\a b\\c");
  assert.equal(filePath("file://server/share/x"), String.raw`\\server\share\x`);
  assert.equal(filePath("file:////server/share"), String.raw`\\server\share`);
  assert.equal(filePath("file://localhost/C:/a"), "C:\\a");
  assert.equal(filePath("https://example.com"), null);
});

test("plain text keeps only the words", () => {
  assert.equal(plainText("15:00 Send [the quote](<file://server/share/q.xlsx>) <https://example.com>"), "15:00 Send the quote https://example.com");
});

test("only known documents, pictures and media open without asking", () => {
  for (const p of ["C:\\a\\quote.xlsx", "\\\\server\\share\\plan.PDF", "C:\\a\\notes.md", "C:\\a\\photo.jpg"]) assert.ok(opensDirectly(p), p);
  const asks = [
    "C:\\a\\setup.exe",
    "\\\\s\\x\\run.BAT",
    "C:\\a\\setup.exe. ",
    "C:\\a\\a.txt:b.exe",
    "C:\\x\\link.lnk",
    "C:\\x\\budget.xlsm",
    // Older Office formats can hold macros; these others carry embedded content or attachments.
    ...["xls", "doc", "ppt", "vsd", "mpp", "rtf", "one", "xml", "msg", "eml"].map((ext) => `C:\\x\\old.${ext}`),
    "C:\\x\\disk.iso",
    "C:\\x\\page.html",
    "C:\\x\\unknown.abc",
    "C:\\x\\no-extension",
    "C:\\a\\.pdf",
  ];
  for (const p of asks) assert.ok(!opensDirectly(p), p);
});

test("a share path names its server; a local path has none", () => {
  assert.equal(shareHost("\\\\FileSrv01\\share\\x"), "filesrv01");
  assert.equal(shareHost("\\\\10.0.0.5\\c$"), "10.0.0.5");
  assert.equal(shareHost("C:\\Users\\me"), null);
});

test("only web and mail addresses open; other schemes stay text", () => {
  assert.deepEqual(segments("[mail](mailto:a@example.com)"), [{ kind: "web", text: "mail", url: "mailto:a@example.com" }]);
  for (const href of ["ms-msdt:/id x", "search-ms:query=x", "obsidian://open?vault=x", "ms-settings:privacy"]) {
    assert.deepEqual(segments(`[x](<${href}>)`), [{ kind: "text", text: "x" }], href);
    assert.ok(!isOpenableScheme(href), href);
  }
});

test("very long text is shown as it is, without looking for links", () => {
  const long = "[".repeat(MAX_LINKED) + "](https://example.com)";
  assert.deepEqual(segments(long), [{ kind: "text", text: long }]);
});
