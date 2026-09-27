// Standard Markdown links for Windows paths and web URLs.
// Goal: notes stay readable in any Markdown editor, so no custom syntax and as little
// percent-encoding as possible. Pure module: no Obsidian imports, unit-testable.
import { filePath, InputError, parsePaths } from "./paths.ts";

/**
 * C:\a b\c -> file:///C:/a b/c, \\server\share\x -> file://server/share/x (RFC 8089 host form).
 * Only "%" and "#" are encoded: "#" would start a fragment and "%" a percent-escape.
 * Everything else, including spaces and Japanese, stays readable inside <...>.
 */
export function toFileUri(path: string): string {
  const escaped = path.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\\/g, "/");
  if (!path.startsWith("\\\\")) return `file:///${escaped}`;
  // file://localhost/... means this machine, not the \\localhost share, so use the UNC form.
  return /^\\\\localhost(?:\\|$)/i.test(path) ? `file://${escaped}` : `file:${escaped}`;
}

/** Last path segment: C:\a\release\ -> release, \\server\share -> share, C:\ -> C: */
export function pathLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Escape only what would break or restyle link text; file names cannot contain * < > |. */
export function escapeLabel(text: string): string {
  return text
    .replace(/([\\[\]`])/g, "\\$1")
    .replace(/^_/, "\\_")
    .replace(/_$/, "\\_");
}

export function isWebUrl(text: string): boolean {
  return /^https?:\/\/\S/i.test(text);
}

function webDestination(url: string): string {
  // Spaces and angle brackets are the only characters that break <...> or autolinks.
  return url.replace(/ /g, "%20").replace(/</g, "%3C").replace(/>/g, "%3E");
}

/** Keep the user's own Markdown, but stop a stray bracket from ending the link text. */
function selectionLabel(text: string): string {
  return text.replace(/(?<!\\)([[\]])/g, "\\$1");
}

export interface BuiltLinks {
  text: string;
  /** Several links become a list that must sit on its own lines. */
  multiline: boolean;
}

/**
 * Clipboard text -> Markdown. One item becomes an inline link (the selection, if any, is the
 * label); several items become a bullet list. Invalid input throws an InputError.
 */
export function buildLinks(clipboard: string, selection = ""): BuiltLinks {
  const items = clipboard
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  if (items.length === 0) throw new InputError("empty");

  const label = items.length === 1 ? selection.trim() : "";
  const links = items.map((item) => {
    if (isWebUrl(item)) {
      const dest = webDestination(item);
      return label ? `[${selectionLabel(label)}](<${dest}>)` : `<${dest}>`;
    }
    const [path] = parsePaths(item);
    const text = label ? selectionLabel(label) : escapeLabel(pathLabel(path));
    return `[${text}](<${toFileUri(path)}>)`;
  });

  return items.length === 1
    ? { text: links[0], multiline: false }
    : { text: links.map((link) => `- ${link}`).join("\n"), multiline: true };
}

export interface FileLinkRange {
  /** Offsets within the searched text: from "[" to the closing ")". */
  from: number;
  to: number;
  path: string;
}

const FILE_LINK = /\[(?:\\.|[^\]\\\n])*\]\((?:<(file:[^>\n]*)>|(file:[^\s)]+))\)/gi;

/** Markdown links to file:// targets in one line of source, for Live Preview. */
export function findFileLinks(text: string): FileLinkRange[] {
  const found: FileLinkRange[] = [];
  for (const m of text.matchAll(FILE_LINK)) {
    const path = filePath(m[1] ?? m[2]);
    if (path !== null) found.push({ from: m.index, to: m.index + m[0].length, path });
  }
  return found;
}
