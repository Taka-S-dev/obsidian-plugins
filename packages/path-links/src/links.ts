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

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
// A "_" next to one of these (or the text's edge) can open or close emphasis.
const FLANKING = /[\s\p{P}\p{S}]/u;
const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/**
 * Escape only what would break or restyle a path used as link text, so the source keeps single
 * backslashes: C:\Users\me stays as is, since "\" before a letter is not an escape.
 * File names cannot contain * < > |, so those never appear.
 */
export function escapeLabel(text: string): string {
  const chars = Array.from(text);
  return chars.map((c, i) => {
    const prev = chars[i - 1];
    const next = chars[i + 1];
    switch (c) {
      case "\\": // \\server, C:\_tmp, and a trailing C:\ that would escape the closing "]".
        return next === undefined || ASCII_PUNCTUATION.test(next) ? "\\\\" : c;
      case "[": case "]": case "`": case "$": // "$" starts math in Obsidian.
        return `\\${c}`;
      case "_":
        return prev === undefined || next === undefined || FLANKING.test(prev) || FLANKING.test(next) ? "\\_" : c;
      case "~": case "=": case "%": // ~~strike~~, ==highlight==, %%comment%%
        return prev === c || next === c ? `\\${c}` : c;
      case "&":
        return ENTITY.test(chars.slice(i).join("")) ? "\\&" : c;
      default:
        return c;
    }
  }).join("");
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
    const text = label ? selectionLabel(label) : escapeLabel(path);
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
