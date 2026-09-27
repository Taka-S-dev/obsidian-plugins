// Which link targets need confirmation before opening. Pure module, unit-testable.
//
// Some Markdown previews refuse file:// links outright, because one click on a link in an
// untrusted note could run a program. Path Links opens them, so it asks first for file types
// Windows runs rather than displays. Folders and documents open directly.

// Programs, scripts, installers, shortcuts and settings files that Windows executes or applies
// when opened.
const RISKY_EXTENSIONS = new Set([
  // programs and installers
  "exe", "com", "scr", "pif", "cpl", "msi", "msp", "mst", "msc", "appref-ms", "application", "gadget", "jar",
  // scripts
  "bat", "cmd", "ps1", "psm1", "psd1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2",
  "vb", "vbs", "vbe", "js", "jse", "ws", "wsf", "wsh", "wsc", "sct", "hta",
  "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml",
  // shortcuts and shell files that point elsewhere or run commands
  "lnk", "url", "scf", "settingcontent-ms", "library-ms", "search-ms", "xnk",
  // settings, certificates and help files that can change the system or run script
  "reg", "inf", "ins", "isp", "cer", "crt", "der", "chm", "hlp",
]);

/** File name part of a Windows path. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]+/);
  return parts[parts.length - 1] ?? "";
}

export function isRiskyFile(path: string): boolean {
  // Windows ignores trailing dots and spaces: "setup.exe. " runs as setup.exe.
  const name = baseName(path).replace(/[. ]+$/, "");
  // A colon after the drive letter means an alternate data stream (e.g. "a.txt:b.exe").
  if (name.includes(":")) return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return RISKY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
