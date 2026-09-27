/** Invalid user input. The code selects the message shown in the user's language. */
export class InputError extends Error {
  readonly code: "empty" | "notAbsolute";

  constructor(code: "empty" | "notAbsolute") {
    super(code === "empty" ? "No path or URL was given." : "Not an absolute Windows path.");
    this.name = "InputError";
    this.code = code;
  }
}

/** The clipboard may wrap an Explorer "Copy as path" value in quotes. */
export function parsePaths(text: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new InputError("empty");
  return lines.map(line => {
    const path = line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line;
    const unc = /^\\\\[^\\/]+(?:[\\/].*)?$/.test(path);
    const drive = /^[a-z]:[\\/]/i.test(path);
    if ((!unc && !drive) || /^\\\\[?.][\\/]/.test(path) || /[\x00-\x1f]/.test(path)) {
      throw new InputError("notAbsolute");
    }
    return path;
  });
}

export function insertion(block: string, before: string, after: string): string {
  return `${before.length ? "\n\n" : ""}${block}\n${after.length ? "\n" : ""}`;
}

/**
 * file:// URI -> Windows path, following RFC 8089 and how Windows itself resolves them:
 *   file:///C:/a            -> C:\a
 *   file://server/share     -> \\server\share
 *   file:////server/share   -> \\server\share   (UNC form, RFC 8089 E.3.2)
 *   file:///%5C%5Cserver/x  -> \\server\x       (legacy workaround still found in notes)
 *   file://localhost/C:/a   -> C:\a             ("localhost" means this machine)
 *   file://localhost/Users  -> null             (no drive: not an absolute Windows path)
 */
export function filePath(href: string): string | null {
  if (!/^file:\/\//i.test(href)) return null;
  try {
    const value = decodeURIComponent(href.replace(/^file:\/\//i, ""));
    let path: string;
    const local = /^localhost(?=[\\/]|$)/i.exec(value);
    if (local) {
      const rest = value.slice(local[0].length);
      if (!/^[\\/][a-z]:[\\/]/i.test(rest)) return null;
      path = rest.slice(1);
    }
    else if (/^\/+[a-z]:[\\/]/i.test(value)) path = value.replace(/^\/+/, "");
    else if (/^\/+\\\\/.test(value)) path = value.replace(/^\/+/, "");
    else path = "\\\\" + value.replace(/^\/+/, "");
    return parsePaths(path.replace(/\//g, "\\"))[0] ?? null;
  } catch { return null; }
}

export function parseEntries(source: string): { path: string; label: string }[] {
  return source.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const match = line.trim().match(/^\[([^\]]+)\]\(<?(.*?)>?\)$/);
    if (match) {
      const path = filePath(match[2]) ?? parsePaths(match[2])[0];
      return { path, label: match[1] };
    }
    const path = parsePaths(line)[0];
    return { path, label: path };
  });
}
