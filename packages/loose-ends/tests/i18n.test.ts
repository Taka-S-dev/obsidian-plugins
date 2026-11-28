import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, stringsFor } from "../src/i18n.ts";

function shape(value: unknown): unknown {
  if (typeof value === "function") return `fn/${value.length}`;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, shape(v)]));
  }
  return typeof value;
}

test("Japanese has exactly the same keys and parameters as English", () => {
  assert.deepEqual(shape(STRINGS.ja), shape(STRINGS.en));
});

test("language selection follows Obsidian and falls back to English", () => {
  assert.equal(stringsFor("ja"), STRINGS.ja);
  assert.equal(stringsFor("en"), STRINGS.en);
  assert.equal(stringsFor("zh-TW"), STRINGS.en);
});

test("the head says when the vault was read", () => {
  assert.equal(STRINGS.ja.scannedAt("9:05"), "9:05 に調べました");
  assert.equal(STRINGS.en.scannedAt("9:05"), "Scanned at 9:05");
});
