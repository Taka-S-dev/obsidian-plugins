import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOf, canvasFiles, emptyFolders, extensionOf, filterLinks, findMention, foldersEmptiedBy, groupLinks, inboundCounts, isBlankNote, isFileTarget, isIgnored, mentionKeys, parseFolders, sortFiles, unusedFiles } from "../src/vault-scan.ts";

test("extensions are lower case, and a leading dot is not one", () => {
  assert.equal(extensionOf("a/b.PNG"), "png");
  assert.equal(extensionOf("a.b/c"), "");
  assert.equal(extensionOf(".hidden"), "");
  assert.equal(extensionOf("How about ...?"), "");
  assert.ok(!isFileTarget("How about ...?", false));
});

test("the folders setting is one per line", () => {
  assert.deepEqual(parseFolders(" Templates \n\n/Files/kept/\r\n"), ["Templates", "Files/kept"]);
  assert.ok(isIgnored("Templates/a.md", ["Templates"]));
  assert.ok(isIgnored("Templates", ["Templates"]));
  assert.ok(!isIgnored("Templates2/a.md", ["Templates"]));
});

test("embeds and links with a file extension should reach a file", () => {
  assert.ok(isFileTarget("image.png", true));
  assert.ok(isFileTarget("Some note", true));
  assert.ok(isFileTarget("report.pdf", false));
  assert.ok(!isFileTarget("Some note", false));
  assert.ok(!isFileTarget("Some note.md", false));
});

test("unused files leave out notes, canvases, bases, linked files and ignored folders", () => {
  const files = ["a.md", "b.canvas", "c.base", "img/used.png", "img/left.png", "Templates/t.png", "doc.pdf"];
  assert.deepEqual(unusedFiles(files, new Set(["img/used.png"]), ["Templates"]), ["doc.pdf", "img/left.png"]);
});

test("empty folders: only the outermost, and not ones holding a file deep down", () => {
  const folders = ["a", "a/b", "a/b/c", "d", "d/e", "f", "keep"];
  const files = ["d/e/x.md", "top.md"];
  assert.deepEqual(emptyFolders(folders, files, ["keep"]), ["a", "f"]);
});

test("a canvas lists the files on its cards", () => {
  const json = JSON.stringify({ nodes: [{ type: "file", file: "img/a.png" }, { type: "text", text: "x" }, { type: "file" }] });
  assert.deepEqual(canvasFiles(json), ["img/a.png"]);
  assert.deepEqual(canvasFiles("not json"), []);
  assert.deepEqual(canvasFiles("{}"), []);
});

test("ages are in days, then months, then years", () => {
  const day = 86_400_000;
  const now = 1_000 * day;
  assert.deepEqual(ageOf(now - 3_600_000, now), { unit: "today" });
  assert.deepEqual(ageOf(now - 3 * day, now), { unit: "days", n: 3 });
  assert.deepEqual(ageOf(now - 95 * day, now), { unit: "months", n: 3 });
  assert.deepEqual(ageOf(now - 800 * day, now), { unit: "years", n: 2 });
});

test("a file is found where a script names it rather than links to it", () => {
  assert.deepEqual(mentionKeys("views/pantry-chart.js"), ["views/pantry-chart.js", "views/pantry-chart", "pantry-chart.js", "pantry-chart"]);
  assert.deepEqual(mentionKeys("img/a.png"), ["img/a.png", "img/a", "a.png"]);
  const texts: [string, string][] = [
    ["plain.md", "nothing here"],
    ["kitchen.md", 'await dv.view("kitchen/views/pantry-chart");'],
  ];
  assert.equal(findMention("kitchen/views/pantry-chart.js", texts), "kitchen.md");
  assert.equal(findMention("img/unused.png", texts), null);
});

test("links are grouped by target or by note, largest group first", () => {
  const links = [
    { target: "b", source: "1.md" },
    { target: "a", source: "2.md" },
    { target: "b", source: "3.md" },
    { target: "c", source: "2.md" },
  ];
  assert.deepEqual(
    groupLinks(links, "target").map((g) => [g.key, g.at.length]),
    [["b", 2], ["a", 1], ["c", 1]],
  );
  assert.deepEqual(
    groupLinks(links, "source").map((g) => [g.key, g.at.length]),
    [["2.md", 2], ["1.md", 1], ["3.md", 1]],
  );
});

test("links are filtered by every word typed, in the target or the note", () => {
  const links = [
    { target: "simmer gently", source: "Cooking/Techniques/simmer.md" },
    { target: "OLD_menu", source: "Journal/2025-03-14.md" },
  ];
  assert.deepEqual(filterLinks(links, "").length, 2);
  assert.deepEqual(filterLinks(links, "  TECH  simmer ").map((l) => l.target), ["simmer gently"]);
  assert.deepEqual(filterLinks(links, "menu journal").map((l) => l.target), ["OLD_menu"]);
  assert.deepEqual(filterLinks(links, "nothing"), []);
});

test("files sort by name, size or age", () => {
  const files = [
    { path: "b", size: 10, mtime: 3 },
    { path: "a", size: 30, mtime: 2 },
    { path: "c", size: 20, mtime: 1 },
  ];
  assert.deepEqual(sortFiles(files, "name").map((f) => f.path), ["a", "b", "c"]);
  assert.deepEqual(sortFiles(files, "size").map((f) => f.path), ["a", "c", "b"]);
  assert.deepEqual(sortFiles(files, "age").map((f) => f.path), ["c", "a", "b"]);
});

test("folders left empty by moving files away, outermost only, keeping the attachment folder", () => {
  const folders = ["recipes", "recipes/soup", "recipes/soup/photos", "recipes/bread", "attach", "attach/2026"];
  const files = ["recipes/soup/photos/a.png", "recipes/soup/photos/b.pdf", "recipes/bread/c.png", "attach/2026/d.png", "top.md"];
  // Both files in photos go, and soup then holds nothing: soup is offered, not photos as well.
  assert.deepEqual(foldersEmptiedBy(["recipes/soup/photos/a.png", "recipes/soup/photos/b.pdf"], files, folders, []), ["recipes/soup"]);
  // One file of two goes: nothing is left empty.
  assert.deepEqual(foldersEmptiedBy(["recipes/soup/photos/a.png"], files, folders, []), []);
  // The attachment folder and what holds it stay; a folder inside it can go.
  assert.deepEqual(foldersEmptiedBy(["attach/2026/d.png"], files, folders, ["attach"]), ["attach/2026"]);
  assert.deepEqual(foldersEmptiedBy(["attach/2026/d.png"], files, folders, ["attach/2026"]), []);
});

test("a note is blank with nothing but properties and blank lines", () => {
  assert.ok(isBlankNote(""));
  assert.ok(isBlankNote("  \n\n"));
  assert.ok(isBlankNote("---\ntags: [soup]\n---\n"));
  assert.ok(isBlankNote("---\n---\n"));
  assert.ok(isBlankNote("---\r\ntitle: x\r\n---\r\n\r\n"));
  assert.ok(!isBlankNote("A line."));
  assert.ok(!isBlankNote("---\ntags: [soup]\n---\nStock first."));
  // A rule line on its own is writing, not properties.
  assert.ok(!isBlankNote("text\n---\n"));
});

test("links into each file are added up", () => {
  const counts = inboundCounts({ "a.md": { "soup.md": 2, "img.png": 1 }, "b.md": { "soup.md": 1 } });
  assert.equal(counts.get("soup.md"), 3);
  assert.equal(counts.get("img.png"), 1);
  assert.equal(counts.get("none.md"), undefined);
});
