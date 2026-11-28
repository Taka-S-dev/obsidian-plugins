// What is left over in the vault, worked out from plain paths. Pure module (no Obsidian).

/** Notes, canvases and bases are where links come from; they are never listed as unused. */
const SOURCES = new Set(["md", "canvas", "base"]);

/** "a/b.PNG" -> "png"; "" without one. Only letters and digits make an extension ("How about ...?" has none). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]+$/.test(ext) ? ext : "";
}

/** The folders setting, one per line: blank lines dropped, surrounding slashes removed. */
export function parseFolders(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

/** In one of the folders, or one of them itself. */
export function isIgnored(path: string, folders: string[]): boolean {
  return folders.some((f) => path === f || path.startsWith(`${f}/`));
}

/**
 * A link that should reach a file rather than a note: any embed (an image, a PDF, an embedded note
 * that is gone) and a link with an extension other than .md. A plain link to a note that does not
 * exist yet is a note still to write, kept apart.
 */
export function isFileTarget(target: string, embed: boolean): boolean {
  if (embed) return true;
  const ext = extensionOf(target);
  return ext !== "" && ext !== "md";
}

/** Files nothing links to, apart from notes, canvases and bases, sorted. */
export function unusedFiles(files: string[], used: Set<string>, ignore: string[]): string[] {
  return files.filter((p) => !SOURCES.has(extensionOf(p)) && !used.has(p) && !isIgnored(p, ignore)).sort();
}

/** Folders with no file at any depth, sorted. Of empty folders inside each other, only the outermost. */
export function emptyFolders(folders: string[], files: string[], ignore: string[]): string[] {
  const holding = new Set<string>();
  for (const f of files) {
    for (let d = parentOf(f); d && !holding.has(d); d = parentOf(d)) holding.add(d);
  }
  const empty = new Set(folders.filter((d) => d && !holding.has(d) && !isIgnored(d, ignore)));
  return [...empty].filter((d) => !empty.has(parentOf(d))).sort();
}

/**
 * Folders that will hold no file once `removed` are gone, of those holding one of them now: the
 * outermost of nested ones, sorted. A folder in `keep` (Obsidian's attachment folder), or one
 * holding it, is never among them, as it is filled again.
 */
export function foldersEmptiedBy(removed: string[], files: string[], folders: string[], keep: string[]): string[] {
  const gone = new Set(removed);
  const holding = new Set<string>();
  for (const f of files) {
    if (gone.has(f)) continue;
    for (let d = parentOf(f); d && !holding.has(d); d = parentOf(d)) holding.add(d);
  }
  const touched = (d: string) => removed.some((p) => p.startsWith(`${d}/`));
  const kept = (d: string) => keep.some((k) => k === d || k.startsWith(`${d}/`));
  const emptied = new Set(folders.filter((d) => d && touched(d) && !holding.has(d) && !kept(d)));
  return [...emptied].filter((d) => !emptied.has(parentOf(d))).sort();
}

function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/** The files a canvas shows as file cards. Nothing for a canvas that cannot be read. */
export function canvasFiles(json: string): string[] {
  try {
    const nodes = (JSON.parse(json) as { nodes?: unknown })?.nodes;
    if (!Array.isArray(nodes)) return [];
    return nodes.flatMap((n) => (n?.type === "file" && typeof n.file === "string" ? [n.file as string] : []));
  } catch {
    return [];
  }
}

export type Age = { unit: "today" } | { unit: "days" | "months" | "years"; n: number };

/** How long ago a file was changed, in whole days, months (of 30 days) or years. */
export function ageOf(mtime: number, now: number): Age {
  const days = Math.floor((now - mtime) / 86_400_000);
  if (days < 1) return { unit: "today" };
  if (days < 31) return { unit: "days", n: days };
  if (days < 365) return { unit: "months", n: Math.floor(days / 30) };
  return { unit: "years", n: Math.floor(days / 365) };
}

/**
 * What a script or setting might write to refer to a file: its path and name, each with and without
 * the extension. A bare name shorter than five characters is left out, being too likely to turn up
 * by chance ("a.png" -> "a").
 */
export function mentionKeys(path: string): string[] {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = extensionOf(path);
  const strip = (p: string) => (ext ? p.slice(0, -(ext.length + 1)) : p);
  const keys = new Set([path, strip(path), name]);
  if (strip(name).length >= 5) keys.add(strip(name));
  return [...keys];
}

/**
 * The first text that writes a file's path or name, though not as a link: Dataview's dv.view("..."),
 * a script, a setting. Such a file may be in use even though nothing links to it.
 */
export function findMention(path: string, texts: Iterable<[source: string, text: string]>): string | null {
  const keys = mentionKeys(path);
  for (const [source, text] of texts) if (keys.some((k) => text.includes(k))) return source;
  return null;
}

export type LinkGrouping = "target" | "source";

/**
 * Links grouped by where they point, or by the note they are in: the largest group first, then by
 * name.
 */
export function groupLinks<T extends { target: string; source: string }>(links: T[], by: LinkGrouping): { key: string; at: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const l of links) groups.set(l[by], [...(groups.get(l[by]) ?? []), l]);
  return [...groups]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => b.at.length - a.at.length || a.key.localeCompare(b.key));
}

/** The links whose target or note contains the words typed, ignoring case; all of them for none. */
export function filterLinks<T extends { target: string; source: string }>(links: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return links;
  return links.filter((l) => {
    const text = `${l.target}\n${l.source}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export type FileOrder = "name" | "size" | "age";

/** By path, largest first, or oldest change first. */
export function sortFiles<T extends { path: string; size: number; mtime: number }>(files: T[], order: FileOrder): T[] {
  const by: Record<FileOrder, (a: T, b: T) => number> = {
    name: (a, b) => a.path.localeCompare(b.path),
    size: (a, b) => b.size - a.size || a.path.localeCompare(b.path),
    age: (a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path),
  };
  return [...files].sort(by[order]);
}

/** A note with nothing written in it: blank, or only properties (frontmatter) and blank lines. */
export function isBlankNote(text: string): boolean {
  const body = text.replace(/^\uFEFF?---\r?\n([\s\S]*?\r?\n)?---[ \t]*(\r?\n|$)/, "");
  return body.trim() === "";
}

/** How many links point to each file: a note's name, then the number of links to it. */
export function inboundCounts(resolved: Record<string, Record<string, number>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const targets of Object.values(resolved)) {
    for (const [target, n] of Object.entries(targets)) counts.set(target, (counts.get(target) ?? 0) + n);
  }
  return counts;
}
