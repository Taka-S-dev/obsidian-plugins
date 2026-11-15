import assert from "node:assert/strict";
import { test } from "node:test";
import { programTitle, tabTitle } from "../src/tab-title.ts";

test("a program's own title is used; a shell's executable path is not", () => {
  assert.equal(programTitle("✳ Claude Code"), "✳ Claude Code");
  assert.equal(programTitle("  Fix the build  "), "Fix the build");
  assert.equal(programTitle("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), null);
  assert.equal(programTitle("C:/Windows/System32/cmd.exe"), null);
  assert.equal(programTitle("pwsh.exe"), null);
  assert.equal(programTitle("/usr/bin/bash"), null);
  assert.equal(programTitle("   "), null);
});

test("a name the user gave wins over the program's title, which wins over the profile", () => {
  assert.equal(tabTitle("notes", "✳ Claude Code", "PowerShell"), "notes");
  assert.equal(tabTitle(null, "✳ Claude Code", "PowerShell"), "✳ Claude Code");
  assert.equal(tabTitle(null, null, "PowerShell"), "PowerShell");
  assert.equal(tabTitle("", null, "PowerShell"), "PowerShell");
});
