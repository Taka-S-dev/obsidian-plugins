import { test } from "node:test";
import assert from "node:assert/strict";
import { isRiskyFile } from "../src/safety.ts";

test("programs, scripts, shortcuts and installers need confirmation", () => {
  for (const name of ["setup.exe", "run.BAT", "a.cmd", "x.ps1", "y.vbs", "z.js", "app.msi", "リンク.lnk", "site.url", "tweak.reg", "page.hta", "tool.jar", "cert.cer"]) {
    assert.equal(isRiskyFile(`C:\\tmp\\${name}`), true, name);
  }
  assert.equal(isRiskyFile("\\\\server\\share\\install\\setup.exe"), true);
});

test("documents, data and folders open without asking", () => {
  for (const name of ["メモ.md", "report.pdf", "data.xlsx", "photo.JPG", "archive.zip", "notes.txt", "release", ".gitignore", "a.exe.txt"]) {
    assert.equal(isRiskyFile(`C:\\tmp\\${name}`), false, name);
  }
  assert.equal(isRiskyFile("C:\\"), false);
  assert.equal(isRiskyFile("\\\\server\\share"), false);
});

test("tricks Windows would still run are caught", () => {
  assert.equal(isRiskyFile("C:\\tmp\\setup.exe."), true);
  assert.equal(isRiskyFile("C:\\tmp\\setup.exe . ."), true);
  assert.equal(isRiskyFile("C:\\tmp\\readme.txt:payload.exe"), true);
  assert.equal(isRiskyFile("C:\\tmp\\readme.txt:stream"), true);
});
