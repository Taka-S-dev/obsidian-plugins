import { test } from "node:test";
import assert from "node:assert/strict";
import { countListed, loadIgnored, withoutIgnored } from "../src/ignored.ts";
import type { Report } from "../src/scan.ts";

const at = (target: string) => ({ source: "n.md", line: 0, target });

test("the saved list keeps valid entries and carries over the earlier file setting", () => {
  const saved = [
    { kind: "empty", key: "a" },
    { kind: "nope", key: "b" },
    { kind: "unused", key: "" },
    null,
    { kind: "unused", key: "img/x.png" },
  ];
  assert.deepEqual(loadIgnored(saved, ["img/x.png", "img/y.png", 3]), [
    { kind: "empty", key: "a" },
    { kind: "unused", key: "img/x.png" },
    { kind: "unused", key: "img/y.png" },
  ]);
  assert.deepEqual(loadIgnored(undefined, undefined), []);
});

test("what was taken off a list is left out of that list only", () => {
  const report: Report = {
    unused: [
      { path: "a.png", size: 1, mtime: 0, mentionedIn: null },
      { path: "b.png", size: 1, mtime: 0, mentionedIn: null },
    ],
    empty: ["f", "g"],
    blankNotes: [{ path: "x.md", mtime: 0, linkedFrom: 0 }],
    brokenFiles: [at("x.png"), at("x.png"), at("y.png")],
    external: [at("C:\\a.xlsx")],
    missingNotes: [at("Later"), at("a.png")],
  };
  const r = withoutIgnored(report, [
    { kind: "unused", key: "a.png" },
    { kind: "empty", key: "g" },
    { kind: "blankNotes", key: "x.md" },
    { kind: "brokenFiles", key: "x.png" },
    { kind: "external", key: "C:\\a.xlsx" },
    { kind: "missingNotes", key: "Later" },
  ]);
  assert.deepEqual(r.unused.map((u) => u.path), ["b.png"]);
  assert.deepEqual(r.empty, ["f"]);
  assert.deepEqual(r.blankNotes, []);
  assert.deepEqual(r.brokenFiles.map((l) => l.target), ["y.png"]);
  assert.deepEqual(r.external, []);
  // "a.png" was taken off the unused list, not this one.
  assert.deepEqual(r.missingNotes.map((l) => l.target), ["a.png"]);
});

test("everything listed is counted, for what a scan changed", () => {
  const r: Report = {
    unused: [{ path: "a.png", size: 1, mtime: 0, mentionedIn: null }],
    empty: ["f"],
    blankNotes: [{ path: "x.md", mtime: 0, linkedFrom: 1 }],
    brokenFiles: [at("x.png")],
    external: [at("C:\\a.xlsx")],
    missingNotes: [at("Later"), at("Soon")],
  };
  assert.equal(countListed(r), 7);
});
