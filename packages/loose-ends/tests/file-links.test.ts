import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLinks, windowsPath } from "../src/file-links.ts";

test("file URLs become Windows paths", () => {
  assert.equal(windowsPath("file:///C:/Users/me/report.xlsx"), "C:\\Users\\me\\report.xlsx");
  assert.equal(windowsPath("file://server/share/Reports"), "\\\\server\\share\\Reports");
  assert.equal(windowsPath("file:////server/share/a.xlsx"), "\\\\server\\share\\a.xlsx");
  assert.equal(windowsPath("file:///C:/a%20b/100%25%23.xlsx"), "C:\\a b\\100%#.xlsx");
  assert.equal(windowsPath("file:///C:/a/b.xlsx#Sheet1"), "C:\\a\\b.xlsx");
  assert.equal(windowsPath("file:///C:/50%/x"), "C:\\50%\\x");
  assert.equal(windowsPath("file:///usr/x"), null);
  assert.equal(windowsPath("https://example.com"), null);
});

test("links are found in Markdown links and autolinks, with their lines", () => {
  const text = [
    "# Notes",
    "[C:\\a\\b.xlsx](<file:///C:/a/b.xlsx>) and [share](file://server/share/x)",
    "<file:///D:/plan.docx>",
  ].join("\r\n");
  assert.deepEqual(
    fileLinks(text).map((l) => [l.line, l.path]),
    [
      [1, "C:\\a\\b.xlsx"],
      [1, "\\\\server\\share\\x"],
      [2, "D:\\plan.docx"],
    ],
  );
});

test("code blocks and inline code are not links", () => {
  const text = [
    "```",
    "[x](<file:///C:/in-fence.txt>)",
    "```",
    "`<file:///C:/inline.txt>` [y](<file:///C:/real.txt>)",
    "~~~",
    "<file:///C:/tilde.txt>",
    "~~~",
  ].join("\n");
  assert.deepEqual(
    fileLinks(text).map((l) => l.path),
    ["C:\\real.txt"],
  );
});
