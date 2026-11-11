// Matches a keydown against an Obsidian hotkey. Pure module (no Obsidian imports).

/** Obsidian's hotkey format: modifiers are "Mod", "Ctrl", "Meta", "Shift" and "Alt". */
export interface Hotkey {
  modifiers: string[];
  key: string;
}

export interface KeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const CODE_KEYS: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: " ",
};

const normalize = (key: string) => (key.toLowerCase() === "space" ? " " : key.toLowerCase());

/** The key without Shift or layout applied: KeyP -> "p", Digit1 -> "1", Backquote -> "`". */
function keyFromCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return CODE_KEYS[code] ?? code.toLowerCase();
}

export function matchesHotkey(hotkey: Hotkey, e: KeyInput, isMac = false): boolean {
  const mods = new Set(hotkey.modifiers);
  const ctrl = mods.has("Ctrl") || (!isMac && mods.has("Mod"));
  const meta = mods.has("Meta") || (isMac && mods.has("Mod"));
  if (ctrl !== e.ctrlKey || meta !== e.metaKey || mods.has("Shift") !== e.shiftKey || mods.has("Alt") !== e.altKey) {
    return false;
  }
  const key = normalize(hotkey.key);
  return key === normalize(e.key) || key === keyFromCode(e.code);
}
