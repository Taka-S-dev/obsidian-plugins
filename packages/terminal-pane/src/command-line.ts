// Turns a profile's command line into the program and arguments node-pty starts on Windows.
// Pure module (no Obsidian imports); file system access is passed in so it can be tested.
import { win32 } from "node:path";

export interface CommandLine {
  file: string;
  /** Everything after the program, kept as typed (Windows programs parse their own arguments). */
  args: string;
}

/** Separates the program from its arguments. The program may be wrapped in double quotes. */
export function splitCommandLine(line: string): CommandLine | null {
  const text = line.trim();
  if (text === "") return null;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end === -1) return { file: text.slice(1), args: "" };
    const file = text.slice(1, end);
    return file === "" ? null : { file, args: text.slice(end + 1).trim() };
  }
  const space = text.search(/\s/);
  return space === -1 ? { file: text, args: "" } : { file: text.slice(0, space), args: text.slice(space).trim() };
}

export interface SearchOptions {
  path: string;
  pathext: string;
  /** Folder that relative paths such as `tools\run.cmd` resolve against. */
  cwd: string;
  isFile: (path: string) => boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Full path of the program, or null when it cannot be found.
 * A bare name is searched for on PATH only, never in the working folder (the vault), so a file
 * placed in the vault cannot stand in for a program such as pwsh.
 */
export function findExecutable(file: string, options: SearchOptions): string | null {
  const exts = (options.pathext || DEFAULT_PATHEXT).split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const withExts = (base: string) => (exts.includes(win32.extname(base).toLowerCase()) ? [base] : exts.map((e) => base + e));
  const hasDir = /[\\/]/.test(file) || win32.isAbsolute(file);
  const bases = hasDir
    ? [win32.resolve(options.cwd, file)]
    : options.path.split(";")
      .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
      // A relative entry such as "." or "bin" would resolve against the vault folder.
      .filter((dir) => win32.isAbsolute(dir))
      .map((dir) => win32.join(dir, file));
  for (const base of bases) {
    for (const candidate of withExts(base)) {
      if (options.isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Letters, marks, digits, punctuation, symbols and the plain space: no controls or other spacing. */
const PATH_CHARS = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u;
/**
 * Special even inside double quotes: $ and ` in PowerShell, % in cmd.exe, and the double quote
 * itself, which PowerShell also accepts in its typographic forms (U+201C to U+201E).
 */
const EXPANDED_IN_QUOTES = /[$`%"‘-‟]/;

/**
 * A path as text that PowerShell and cmd.exe both read as one literal argument, or null when no
 * such text exists. Only listed kinds of characters are accepted; anything that needs quoting
 * (spaces, ; & | ( ) and the like) goes in double quotes. Paths that would still be expanded
 * inside the quotes are refused rather than typed where pressing Enter would run them.
 */
export function quotePath(path: string): string | null {
  if (!PATH_CHARS.test(path) || EXPANDED_IN_QUOTES.test(path)) return null;
  return /^[\p{L}\p{M}\p{N}._\-/\\]+$/u.test(path) ? path : `"${path}"`;
}

/** Batch files cannot be started directly, so they run through cmd.exe. */
export function launchCommand(program: string, args: string, comspec: string): CommandLine {
  const ext = win32.extname(program).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    // With /s, cmd.exe removes only the outer pair of quotes and runs the rest as typed.
    return { file: comspec, args: `/d /s /c ""${program}"${args ? " " + args : ""}"` };
  }
  return { file: program, args };
}
