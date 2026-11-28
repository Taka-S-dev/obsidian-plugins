// Links to files outside the vault: standard Markdown links and autolinks with a file:// URL.
// Pure module (no Obsidian, no fs).

export interface FileLink {
  /** 0-based line in the note. */
  line: number;
  url: string;
  /** The Windows path the URL points to. */
  path: string;
}

// [label](<file:...>), [label](file:...) and <file:...>.
const LINK = /\]\(\s*<(file:[^>\n]+)>|\]\(\s*(file:[^)\s]+)|<(file:[^>\s]+)>/gi;

/** Every file:// link in a note, outside code blocks and inline code. */
export function fileLinks(text: string): FileLink[] {
  const out: FileLink[] = [];
  let fence: string | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    // Inline code is blanked out, keeping the columns.
    const line = raw.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
    for (const m of line.matchAll(LINK)) {
      const url = m[1] ?? m[2] ?? m[3];
      const path = windowsPath(url);
      if (path) out.push({ line: i, url, path });
    }
  });
  return out;
}

/**
 * file:///C:/a/b -> C:\a\b and file://server/share/a (or file:////server/share/a) ->
 * \\server\share\a. Percent-escapes are decoded; a query or fragment is not part of the path.
 * Null for anything else.
 */
export function windowsPath(url: string): string | null {
  const m = /^file:(\/*)([^?#]*)/i.exec(url.trim());
  if (!m || !m[2]) return null;
  let rest = m[2];
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // A stray "%" is kept as it is.
  }
  rest = rest.replace(/\//g, "\\");
  if (/^[A-Za-z]:/.test(rest)) return rest;
  if (m[1].length === 2 || m[1].length >= 4) return `\\\\${rest.replace(/^\\+/, "")}`;
  return null;
}
