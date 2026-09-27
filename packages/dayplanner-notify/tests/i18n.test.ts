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

test("no translation is left empty", () => {
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") assert.notEqual(v.trim(), "", path);
    else if (v && typeof v === "object") for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`);
  };
  walk(STRINGS.en, "en");
  walk(STRINGS.ja, "ja");
});

test("language selection follows Obsidian and falls back to English", () => {
  assert.equal(stringsFor("ja"), STRINGS.ja);
  assert.equal(stringsFor("JA"), STRINGS.ja);
  assert.equal(stringsFor("en"), STRINGS.en);
  assert.equal(stringsFor("zh-TW"), STRINGS.en);
  assert.equal(stringsFor(""), STRINGS.en);
});

test("formatted messages include their values", () => {
  assert.equal(STRINGS.en.postponed("Review", "17:00", "17:15"), 'Postponed "Review": 17:00 → 17:15');
  assert.equal(STRINGS.ja.postponed("設計レビュー", "17:00", "17:15"), "「設計レビュー」を 17:00 → 17:15 に延期しました");
  assert.equal(STRINGS.en.postponeButton(15), "+15 min");
  assert.equal(STRINGS.ja.postponeButton(15), "+15分");
});
