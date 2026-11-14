import { test } from "node:test";
import assert from "node:assert/strict";
import { findLinkCandidates, toVaultPath } from "../src/vault-links.ts";

const targets = (line: string) => findLinkCandidates(line).map((c) => `${c.kind}:${c.target}`);
const spans = (line: string) => findLinkCandidates(line).map((c) => line.slice(c.start, c.end));

test("finds wikilinks and keeps only their target", () => {
  assert.deepEqual(targets("see [[Daily note]] and [[Projects/Plan#Goals|the plan]]"), [
    "wikilink:Daily note",
    "wikilink:Projects/Plan",
  ]);
  assert.deepEqual(spans("x [[A|b]] y"), ["[[A|b]]"]);
});

test("finds paths with a known extension, written with either slash", () => {
  assert.deepEqual(targets("Edited notes/2026-11-13.md and assets\\diagram.png."), [
    "path:notes/2026-11-13.md",
    "path:assets\\diagram.png",
  ]);
  assert.deepEqual(targets("● Read 英語/復習.md (12 lines)"), ["path:英語/復習.md"]);
});

test("a quoted path may contain spaces", () => {
  assert.deepEqual(targets('Updated "Meeting notes/Weekly sync.md"'), ["path:Meeting notes/Weekly sync.md"]);
  assert.deepEqual(spans("open `My note.md` now"), ["My note.md"]);
});

test("ignores other words and extensions", () => {
  assert.deepEqual(targets("npm run build && node main.js; see example.com"), []);
  assert.deepEqual(targets("readme.mdx"), []);
});

test("toVaultPath accepts vault-relative and absolute paths inside the vault only", () => {
  const vault = "C:\\Users\\me\\Vault";
  assert.equal(toVaultPath("notes/a.md", vault), "notes/a.md");
  assert.equal(toVaultPath(".\\notes\\a.md", vault), "notes/a.md");
  assert.equal(toVaultPath("c:\\users\\me\\vault\\notes\\a.md", vault), "notes/a.md");
  assert.equal(toVaultPath("C:/Users/me/Other/a.md", vault), null);
  assert.equal(toVaultPath("../outside.md", vault), null);
});
