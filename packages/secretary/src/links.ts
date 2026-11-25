// Links in the text of a reminder, an inbox item or a notice, so the panel and the alert can show
// them by their words and open them. The text keeps standard Markdown, readable in any editor:
//
//   Send the quote [Quote](<file://server/share/sales/quote.xlsx>)
//   Check <https://example.com/status> and [[Meeting notes|the notes]]
//
// Pure module (no Obsidian imports).

import { isOpenableScheme } from "./safety.ts";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "web"; text: string; url: string }
  | { kind: "file"; text: string; path: string }
  | { kind: "note"; text: string; target: string };

const PATTERNS = [
  // 1 target, 2 alias: [[note]], [[note|alias]], [[note#heading]], and embeds ![[...]]
  String.raw`!?\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]`,
  // 3 label, 4 <destination>, 5 destination: [label](dest), with an optional "title"
  String.raw`!?\[((?:\\.|[^\\[\]\n]|\[(?:\\.|[^\\[\]\n])*\])*)\]\((?:<([^>\n]*)>|([^()\s]*(?:\([^()\s]*\)[^()\s]*)*))(?:\s+"[^"\n]*")?\)`,
  // 6: <https://...> or <file://...>
  String.raw`<((?:https?|file):[^>\s]+)>`,
  // 7: a bare web address, in the characters an address may hold (so "（…）を見る" stops at "）")
  String.raw`(https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+)`,
];
const LINK = new RegExp(PATTERNS.join("|"), "gi");

/**
 * Longer text is shown as it is. A line made of thousands of brackets would take seconds to read
 * for links, and the panel reads every row again on each check.
 */
export const MAX_LINKED = 2_000;

/** The text split into plain parts and links. Text without links comes back as one part. */
export function segments(text: string): Segment[] {
  if (text.length > MAX_LINKED) return [{ kind: "text", text }];
  const out: Segment[] = [];
  let at = 0;
  const plain = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += s;
    else out.push({ kind: "text", text: s });
  };
  for (const m of text.matchAll(LINK)) {
    let whole = m[0];
    let link: Segment;
    if (m[7] !== undefined) {
      // A sentence's closing punctuation, or a ")" with no "(" in the address, is not part of it.
      let url = m[7].replace(/[.,;:!?'、。）」』]+$/u, "");
      while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
      whole = url;
      link = { kind: "web", text: url, url };
    } else if (m[6] !== undefined) {
      link = destination(m[6], "");
    } else if (m[3] !== undefined) {
      // As in Markdown, only a backslash before punctuation escapes it: "\\\server\x" reads "\\server\x".
      link = destination(m[4] ?? m[5] ?? "", m[3].replace(/\\([!-/:-@[-`{-~])/g, "$1").trim());
    } else {
      const target = (m[1] ?? "").trim();
      const shown = m[2]?.trim() || target.replace(/^#\^?/, "").replace(/#\^?/, " > ");
      link = target ? { kind: "note", text: shown, target } : { kind: "text", text: m[0] };
    }
    plain(text.slice(at, m.index));
    if (link.kind === "text") plain(link.text);
    else out.push(link);
    at = m.index + whole.length;
  }
  plain(text.slice(at));
  return out;
}

/** A link's destination as a web page, a Windows path or a note; plain text when it is none of those. */
function destination(dest: string, label: string): Segment {
  const d = dest.trim();
  if (/^https?:\/\//i.test(d)) return { kind: "web", text: label || d, url: d };
  if (/^file:/i.test(d)) {
    const path = filePath(d);
    return path ? { kind: "file", text: label || path, path } : { kind: "text", text: label || d };
  }
  if (d === "") return { kind: "text", text: label };
  // Of other schemes only mail opens; a protocol handler (ms-msdt:, search-ms:) can run programs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(d)) return isOpenableScheme(d) ? { kind: "web", text: label || d, url: d } : { kind: "text", text: label || d };
  let target = d;
  try {
    target = decodeURIComponent(d);
  } catch {
    // Keep it as written.
  }
  return { kind: "note", text: label || target.replace(/\.md$/i, ""), target };
}

/** An absolute Windows path: a drive path or a share (UNC). Device paths (\\?\, \\.\) are refused. */
export function isWindowsPath(path: string): boolean {
  const unc = /^\\\\[^\\/]+(?:[\\/].*)?$/.test(path);
  const drive = /^[a-z]:[\\/]/i.test(path);
  return (unc || drive) && !/^\\\\[?.][\\/]/.test(path) && !/[\x00-\x1f]/.test(path);
}

/**
 * file:// address -> Windows path, as Windows itself reads them (RFC 8089):
 *   file:///C:/a            -> C:\a
 *   file://server/share     -> \\server\share
 *   file:////server/share   -> \\server\share
 *   file://localhost/C:/a   -> C:\a
 * Null when it is not an absolute Windows path.
 */
export function filePath(href: string): string | null {
  if (!/^file:\/\//i.test(href)) return null;
  let value: string;
  try {
    value = decodeURIComponent(href.replace(/^file:\/\//i, ""));
  } catch {
    return null;
  }
  let path: string;
  const local = /^localhost(?=[\\/]|$)/i.exec(value);
  if (local) {
    const rest = value.slice(local[0].length);
    if (!/^[\\/][a-z]:[\\/]/i.test(rest)) return null;
    path = rest.slice(1);
  } else if (/^\/+[a-z]:[\\/]/i.test(value)) path = value.replace(/^\/+/, "");
  else if (/^\/+\\\\/.test(value)) path = value.replace(/^\/+/, "");
  else path = "\\\\" + value.replace(/^\/+/, "");
  path = path.replace(/\//g, "\\");
  return isWindowsPath(path) ? path : null;
}

/** The text as words only, for places that cannot hold a link: the status bar and notices. */
export function plainText(text: string): string {
  return segments(text).map((s) => s.text).join("");
}
