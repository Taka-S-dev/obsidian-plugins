// Settings shape, defaults and validation. Pure module (no Obsidian imports).

export interface Profile {
  /** Stable id; commands and open terminals refer to it, so renaming keeps hotkeys. */
  id: string;
  name: string;
  /** Windows command line, for example `pwsh.exe -NoLogo` or `copilot`. */
  command: string;
}

export type Location = "right" | "tab";

export interface Settings {
  profiles: Profile[];
  defaultProfile: string;
  location: Location;
  fontSize: number;
  /** CSS font-family list; empty uses Obsidian's monospace font. */
  fontFamily: string;
  /** Node.js that runs the pty host; a bare name is looked up on PATH. */
  nodePath: string;
  /**
   * Use the ConPTY bundled with node-pty rather than Windows' own. Off by default: measured on
   * Windows 11 build 26300, the bundled one passed output about 2.7 times slower.
   */
  bundledConpty: boolean;
  /**
   * Ids of Obsidian commands whose hotkeys reach Obsidian while a terminal has the keyboard (like
   * VS Code's commandsToSkipShell). Empty by default: common Obsidian keys such as Ctrl+P and
   * Ctrl+W are also keys that shells and editors use.
   */
  obsidianCommands: string[];
  /** Send Shift+Enter as Alt+Enter (ESC, Enter), which Claude Code reads as a line break. */
  shiftEnterNewline: boolean;
  /** Mark tabs whose program finished replying, and flash the taskbar button when Obsidian is in the background. */
  notifications: boolean;
  /** Tell Claude Code started in the terminal which note is open and what is selected in it. */
  shareWithClaude: boolean;
}

export const FONT_SIZE = { min: 8, max: 32 };

/** `cmdName` is the Command Prompt's name in the interface language. */
export function defaultSettings(shell: string, cmdName: string): Settings {
  return {
    profiles: [
      { id: "shell", name: "PowerShell", command: `${shell} -NoLogo` },
      { id: "cmd", name: cmdName, command: "cmd.exe" },
      { id: "copilot", name: "GitHub Copilot CLI", command: "copilot" },
    ],
    defaultProfile: "shell",
    location: "right",
    fontSize: 14,
    fontFamily: "",
    nodePath: "node",
    bundledConpty: false,
    obsidianCommands: [],
    shiftEnterNewline: true,
    notifications: true,
    shareWithClaude: true,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** Saved data merged over the defaults; anything malformed falls back to the default. */
export function normalizeSettings(raw: unknown, defaults: Settings): Settings {
  if (!isRecord(raw)) return defaults;
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const p of Array.isArray(raw.profiles) ? raw.profiles : []) {
    if (!isRecord(p) || typeof p.id !== "string" || p.id === "" || seen.has(p.id)) continue;
    seen.add(p.id);
    profiles.push({ id: p.id, name: text(p.name, ""), command: text(p.command, "") });
  }
  const list = profiles.length > 0 ? profiles : defaults.profiles;
  const defaultProfile = list.some((p) => p.id === raw.defaultProfile) ? (raw.defaultProfile as string) : list[0].id;
  const size = typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize) ? Math.round(raw.fontSize) : defaults.fontSize;
  return {
    profiles: list,
    defaultProfile,
    location: raw.location === "tab" ? "tab" : raw.location === "right" ? "right" : defaults.location,
    fontSize: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size)),
    fontFamily: text(raw.fontFamily, defaults.fontFamily).trim(),
    nodePath: text(raw.nodePath, defaults.nodePath).trim() || defaults.nodePath,
    bundledConpty: typeof raw.bundledConpty === "boolean" ? raw.bundledConpty : defaults.bundledConpty,
    obsidianCommands: Array.isArray(raw.obsidianCommands)
      ? [...new Set(raw.obsidianCommands.filter((id): id is string => typeof id === "string" && id !== ""))]
      : defaults.obsidianCommands,
    shiftEnterNewline: typeof raw.shiftEnterNewline === "boolean" ? raw.shiftEnterNewline : defaults.shiftEnterNewline,
    notifications: typeof raw.notifications === "boolean" ? raw.notifications : defaults.notifications,
    shareWithClaude: typeof raw.shareWithClaude === "boolean" ? raw.shareWithClaude : defaults.shareWithClaude,
  };
}

/** First of profile-1, profile-2, ... that is not taken. */
export function newProfileId(taken: string[]): string {
  for (let n = 1; ; n++) {
    const id = `profile-${n}`;
    if (!taken.includes(id)) return id;
  }
}
