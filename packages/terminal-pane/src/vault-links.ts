// Finds text in a terminal line that may point at a file in the vault. Pure module (no Obsidian
// imports); whether a candidate really exists is decided by the caller.

export interface LinkCandidate {
  /** Index in the line of the first character, and one past the last. */
  start: number;
  end: number;
  /** A wikilink's target, or a path as written (relative to the vault or absolute). */
  kind: "wikilink" | "path";
  target: string;
}

/** Files Obsidian opens itself. A path must end in one of these to be a candidate. */
const EXTENSIONS = "md|canvas|base|pdf|png|jpe?g|gif|svg|webp|bmp|avif|mp3|m4a|wav|ogg|mp4|webm|mov";

// [[Target]], [[Target#Heading]], [[Target|Shown text]]: only the target is kept.
const WIKILINK = /\[\[([^\]|#^\n]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
// A quoted path may contain spaces; an unquoted one runs up to a space or a bracket.
const QUOTED_PATH = new RegExp(`(["'\`])([^"'\`\\n]+?\\.(?:${EXTENSIONS}))\\1`, "gi");
const BARE_PATH = new RegExp(`[^\\s"'\`()<>\\[\\]{}|]+?\\.(?:${EXTENSIONS})(?![\\p{L}\\p{N}_])`, "giu");

export function findLinkCandidates(line: string): LinkCandidate[] {
  const found: LinkCandidate[] = [];
  const taken = (start: number, end: number) => found.some((c) => start < c.end && c.start < end);

  for (const m of line.matchAll(WIKILINK)) {
    found.push({ start: m.index, end: m.index + m[0].length, kind: "wikilink", target: m[1].trim() });
  }
  for (const m of line.matchAll(QUOTED_PATH)) {
    const start = m.index + 1;
    const end = start + m[2].length;
    if (!taken(start, end)) found.push({ start, end, kind: "path", target: m[2] });
  }
  // A bare path ends at its extension, so a full stop after it ("see notes/a.md.") is left out.
  for (const m of line.matchAll(BARE_PATH)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!taken(start, end)) found.push({ start, end, kind: "path", target: m[0] });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The vault path of a written path, or null when it is outside the vault. Accepts paths relative
 * to the vault ("notes/a.md", "./notes/a.md", "notes\\a.md") and absolute ones under it.
 */
export function toVaultPath(written: string, vaultRoot: string): string | null {
  let path = written.replace(/\\/g, "/");
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(path) || path.startsWith("/")) {
    // Windows paths are compared without case, as the file system does.
    if (!path.toLowerCase().startsWith(root.toLowerCase() + "/")) return null;
    path = path.slice(root.length + 1);
  }
  path = path.replace(/^(\.\/)+/, "");
  if (path === "" || path.split("/").includes("..")) return null;
  return path;
}
