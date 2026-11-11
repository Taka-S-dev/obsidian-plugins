import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesHotkey, type KeyInput } from "../src/hotkeys.ts";

const key = (k: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

test("Mod is Ctrl on Windows and Meta on macOS", () => {
  const hotkey = { modifiers: ["Mod"], key: "`" };
  assert.ok(matchesHotkey(hotkey, key("`", "Backquote", { ctrlKey: true })));
  assert.ok(!matchesHotkey(hotkey, key("`", "Backquote", { metaKey: true })));
  assert.ok(matchesHotkey(hotkey, key("`", "Backquote", { metaKey: true }), true));
});

test("every modifier must match exactly", () => {
  const hotkey = { modifiers: ["Ctrl", "Shift"], key: "T" };
  assert.ok(matchesHotkey(hotkey, key("T", "KeyT", { ctrlKey: true, shiftKey: true })));
  assert.ok(!matchesHotkey(hotkey, key("t", "KeyT", { ctrlKey: true })));
  assert.ok(!matchesHotkey(hotkey, key("T", "KeyT", { ctrlKey: true, shiftKey: true, altKey: true })));
});

test("the physical key also matches when Shift or the layout changes the character", () => {
  assert.ok(matchesHotkey({ modifiers: ["Ctrl", "Shift"], key: "`" }, key("~", "Backquote", { ctrlKey: true, shiftKey: true })));
  assert.ok(matchesHotkey({ modifiers: ["Alt"], key: "1" }, key("!", "Digit1", { altKey: true })));
  assert.ok(matchesHotkey({ modifiers: ["Ctrl"], key: "Space" }, key(" ", "Space", { ctrlKey: true })));
});

test("a different key does not match", () => {
  assert.ok(!matchesHotkey({ modifiers: ["Ctrl"], key: "P" }, key("o", "KeyO", { ctrlKey: true })));
});
