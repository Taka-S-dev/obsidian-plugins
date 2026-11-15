import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, newProfileId, normalizeSettings } from "../src/settings.ts";

const defaults = defaultSettings("pwsh.exe", "Command Prompt");

test("defaults use the given shell and offer Command Prompt and Copilot CLI", () => {
  assert.equal(defaults.profiles[0].command, "pwsh.exe -NoLogo");
  assert.deepEqual(defaults.profiles[1], { id: "cmd", name: "Command Prompt", command: "cmd.exe" });
  assert.equal(defaults.defaultProfile, "shell");
  assert.ok(defaults.profiles.some((p) => p.command === "copilot"));
});

test("missing or malformed data gives the defaults", () => {
  assert.deepEqual(normalizeSettings(null, defaults), defaults);
  assert.deepEqual(normalizeSettings("x", defaults), defaults);
  assert.deepEqual(normalizeSettings({}, defaults), defaults);
});

test("saved profiles are kept; broken and duplicate ones are dropped", () => {
  const settings = normalizeSettings({
    profiles: [
      { id: "a", name: "A", command: "nvim" },
      { id: "a", name: "dup", command: "x" },
      { name: "no id" },
      "junk",
      { id: "b", command: 5 },
    ],
    defaultProfile: "b",
  }, defaults);
  assert.deepEqual(settings.profiles, [{ id: "a", name: "A", command: "nvim" }, { id: "b", name: "", command: "" }]);
  assert.equal(settings.defaultProfile, "b");
});

test("a default profile that no longer exists falls back to the first", () => {
  const settings = normalizeSettings({ profiles: [{ id: "a", name: "A", command: "x" }], defaultProfile: "gone" }, defaults);
  assert.equal(settings.defaultProfile, "a");
});

test("font size is rounded and kept in range; other fields are checked", () => {
  assert.equal(normalizeSettings({ fontSize: 3 }, defaults).fontSize, 8);
  assert.equal(normalizeSettings({ fontSize: 99 }, defaults).fontSize, 32);
  assert.equal(normalizeSettings({ fontSize: 14.6 }, defaults).fontSize, 15);
  assert.equal(normalizeSettings({ fontSize: "big" }, defaults).fontSize, 14);
  assert.equal(normalizeSettings({ fontFamily: " JetBrainsMono Nerd Font " }, defaults).fontFamily, "JetBrainsMono Nerd Font");
  assert.equal(normalizeSettings({}, defaults).bundledConpty, false);
  assert.equal(normalizeSettings({ bundledConpty: true }, defaults).bundledConpty, true);
  assert.equal(normalizeSettings({ bundledConpty: "yes" }, defaults).bundledConpty, false);
  assert.equal(normalizeSettings({ location: "tab" }, defaults).location, "tab");
  assert.equal(normalizeSettings({ location: "left" }, defaults).location, "right");
  assert.equal(normalizeSettings({ nodePath: "  " }, defaults).nodePath, "node");
  assert.equal(normalizeSettings({ nodePath: " C:\\node\\node.exe " }, defaults).nodePath, "C:\\node\\node.exe");
});

test("Obsidian commands for the terminal start empty and keep only distinct ids", () => {
  assert.deepEqual(defaults.obsidianCommands, []);
  assert.deepEqual(
    normalizeSettings({ obsidianCommands: ["switcher:open", "", 3, "switcher:open", "app:go-back"] }, defaults).obsidianCommands,
    ["switcher:open", "app:go-back"],
  );
  assert.deepEqual(normalizeSettings({ obsidianCommands: "switcher:open" }, defaults).obsidianCommands, []);
});

test("Shift+Enter sends a line break unless turned off", () => {
  assert.equal(defaults.shiftEnterNewline, true);
  assert.equal(normalizeSettings({ shiftEnterNewline: false }, defaults).shiftEnterNewline, false);
  assert.equal(normalizeSettings({ shiftEnterNewline: "off" }, defaults).shiftEnterNewline, true);
  assert.equal(defaults.notifications, true);
  assert.equal(normalizeSettings({ notifications: false }, defaults).notifications, false);
  assert.equal(normalizeSettings({ notifications: 0 }, defaults).notifications, true);
});

test("new profile ids fill the first free number", () => {
  assert.equal(newProfileId(["shell"]), "profile-1");
  assert.equal(newProfileId(["profile-1", "profile-3"]), "profile-2");
});

test("connecting Claude Code and Copilot CLI is on unless turned off", () => {
  assert.equal(defaults.connectAssistants, true);
  assert.equal(normalizeSettings({ connectAssistants: false }, defaults).connectAssistants, false);
  assert.equal(normalizeSettings({ connectAssistants: "no" }, defaults).connectAssistants, true);
});

test("the title bar shows unless turned off", () => {
  assert.equal(defaults.showTitleBar, true);
  assert.equal(normalizeSettings({ showTitleBar: false }, defaults).showTitleBar, false);
  assert.equal(normalizeSettings({ showTitleBar: 1 }, defaults).showTitleBar, true);
});

test("the tab row shows with one terminal unless turned off", () => {
  assert.equal(defaults.hideSingleTabRow, false);
  assert.equal(normalizeSettings({ hideSingleTabRow: true }, defaults).hideSingleTabRow, true);
  assert.equal(normalizeSettings({ hideSingleTabRow: "yes" }, defaults).hideSingleTabRow, false);
});
