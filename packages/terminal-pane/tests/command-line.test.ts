import { test } from "node:test";
import assert from "node:assert/strict";
import { findExecutable, launchCommand, quotePath, splitCommandLine } from "../src/command-line.ts";

test("plain paths are inserted as they are", () => {
  assert.equal(quotePath("notes/daily-2026.md"), "notes/daily-2026.md");
  assert.equal(quotePath("03_開発/設計メモ.md"), "03_開発/設計メモ.md");
});

test("paths with spaces or shell punctuation are quoted, so Enter cannot split them into commands", () => {
  assert.equal(quotePath("my notes/a b.md"), '"my notes/a b.md"');
  assert.equal(quotePath("a;calc.md"), '"a;calc.md"');
  assert.equal(quotePath("a&calc.md"), '"a&calc.md"');
  assert.equal(quotePath("a|calc>x.md"), '"a|calc>x.md"');
  assert.equal(quotePath("Meeting (2026).md"), '"Meeting (2026).md"');
  assert.equal(quotePath("it's.md"), "\"it's.md\"");
});

test("paths that a shell expands even inside double quotes are refused", () => {
  assert.equal(quotePath("a$(calc).md"), null);
  assert.equal(quotePath("a`calc`.md"), null);
  assert.equal(quotePath("%COMSPEC%.md"), null);
  assert.equal(quotePath("line\nbreak.md"), null);
});

test("typographic quotes, which PowerShell treats as quotes, are refused", () => {
  assert.equal(quotePath("a”; calc; “.md"), null);
  assert.equal(quotePath("a„.md"), null);
  assert.equal(quotePath("a’s.md"), null);
});

test("only listed kinds of characters are accepted", () => {
  assert.equal(quotePath("a\tb.md"), null);
  assert.equal(quotePath("a　b.md"), null);
  assert.equal(quotePath("a‮gpj.md"), null);
  assert.equal(quotePath("a\u007f.md"), null);
  assert.equal(quotePath("設計（案）・メモ.md"), '"設計（案）・メモ.md"');
  assert.equal(quotePath("café/naïve.md"), "café/naïve.md");
});

test("splits the program from its arguments", () => {
  assert.deepEqual(splitCommandLine("pwsh.exe -NoLogo -NoExit"), { file: "pwsh.exe", args: "-NoLogo -NoExit" });
  assert.deepEqual(splitCommandLine("  copilot  "), { file: "copilot", args: "" });
  assert.deepEqual(
    splitCommandLine('"C:\\Program Files\\Tool\\tool.exe" --name "a b"'),
    { file: "C:\\Program Files\\Tool\\tool.exe", args: '--name "a b"' },
  );
  assert.deepEqual(splitCommandLine('"C:\\no end'), { file: "C:\\no end", args: "" });
});

test("an empty command line has no program", () => {
  assert.equal(splitCommandLine(""), null);
  assert.equal(splitCommandLine("   "), null);
  assert.equal(splitCommandLine('"" x'), null);
});

const files = (...paths: string[]) => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};
const search = (isFile: (p: string) => boolean) => ({
  path: "C:\\Windows\\System32;\"C:\\Program Files\\nodejs\";;C:\\Users\\me\\AppData\\Roaming\\npm",
  pathext: ".COM;.EXE;.BAT;.CMD",
  cwd: "C:\\Vault",
  isFile,
});

test("finds a bare name on PATH, trying each PATHEXT extension in order", () => {
  const isFile = files("C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd", "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(findExecutable("copilot", search(isFile)), "C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd");
  assert.equal(findExecutable("node", search(isFile)), "C:\\Program Files\\nodejs\\node.exe");
});

test("an extension that is already given is not extended again", () => {
  const isFile = files("C:\\Windows\\System32\\cmd.exe");
  assert.equal(findExecutable("cmd.exe", search(isFile)), "C:\\Windows\\System32\\cmd.exe");
  assert.equal(findExecutable("CMD.EXE", search(isFile)), "C:\\Windows\\System32\\CMD.EXE");
});

test("a bare name is never taken from the vault folder", () => {
  assert.equal(findExecutable("pwsh", search(files("C:\\Vault\\pwsh.exe"))), null);
});

test("relative PATH entries are skipped, so they cannot point into the vault folder", () => {
  const options = { ...search(files("bin\\node.exe", ".\\node.exe", "C:\\nodejs\\node.exe")), path: ".;bin;C:\\nodejs" };
  assert.equal(findExecutable("node", options), "C:\\nodejs\\node.exe");
  assert.equal(findExecutable("node", { ...options, path: ".;bin" }), null);
});

test("paths with a folder resolve against the vault folder or stand alone", () => {
  assert.equal(findExecutable("tools\\run", search(files("C:\\Vault\\tools\\run.cmd"))), "C:\\Vault\\tools\\run.cmd");
  assert.equal(findExecutable("D:/bin/tui.exe", search(files("D:\\bin\\tui.exe"))), "D:\\bin\\tui.exe");
});

test("returns null when nothing matches", () => {
  assert.equal(findExecutable("missing", search(files())), null);
});

test("PATHEXT falls back to the Windows default when unset", () => {
  const options = { ...search(files("C:\\Windows\\System32\\where.exe")), pathext: "" };
  assert.equal(findExecutable("where", options), "C:\\Windows\\System32\\where.exe");
});

test("programs start directly; batch files go through cmd.exe", () => {
  const comspec = "C:\\Windows\\System32\\cmd.exe";
  assert.deepEqual(launchCommand("C:\\bin\\nvim.exe", "-u NONE", comspec), { file: "C:\\bin\\nvim.exe", args: "-u NONE" });
  assert.deepEqual(
    launchCommand("C:\\npm\\copilot.cmd", "--model x", comspec),
    { file: comspec, args: '/d /s /c ""C:\\npm\\copilot.cmd" --model x"' },
  );
  assert.deepEqual(launchCommand("C:\\npm\\a.BAT", "", comspec), { file: comspec, args: '/d /s /c ""C:\\npm\\a.BAT""' });
});
