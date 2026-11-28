// What has been taken off the lists by hand, and how it is left out of a scan. Pure module (no
// Obsidian), so it runs under node --test.
import type { Report } from "./scan.ts";

/** The kinds of list something can be taken off. */
export type Kind = "unused" | "brokenFiles" | "empty" | "blankNotes" | "external" | "missingNotes";

/** One thing taken off a list: a file or folder by its path, a link by where it points. */
export interface Ignored {
  kind: Kind;
  key: string;
}

const KINDS = new Set<string>(["unused", "brokenFiles", "empty", "blankNotes", "external", "missingNotes"]);

/**
 * The saved list, dropping anything malformed. `legacyFiles` is the earlier setting that held
 * unused files only; its paths carry over as such.
 */
export function loadIgnored(saved: unknown, legacyFiles: unknown): Ignored[] {
  const list: Ignored[] = Array.isArray(saved)
    ? saved.filter((i): i is Ignored => !!i && KINDS.has(i.kind) && typeof i.key === "string" && i.key !== "")
    : [];
  if (Array.isArray(legacyFiles)) {
    for (const path of legacyFiles) if (typeof path === "string" && path) list.push({ kind: "unused", key: path });
  }
  return dedupe(list);
}

export function sameIgnored(a: Ignored, b: Ignored): boolean {
  return a.kind === b.kind && a.key === b.key;
}

export function dedupe(list: Ignored[]): Ignored[] {
  return list.filter((i, n) => list.findIndex((j) => sameIgnored(i, j)) === n);
}

/** The report without what has been taken off its lists. */
export function withoutIgnored(r: Report, ignored: Ignored[]): Report {
  const keys = (kind: Kind) => new Set(ignored.filter((i) => i.kind === kind).map((i) => i.key));
  const unused = keys("unused");
  const empty = keys("empty");
  const blank = keys("blankNotes");
  const broken = keys("brokenFiles");
  const external = keys("external");
  const notes = keys("missingNotes");
  return {
    ...r,
    unused: r.unused.filter((u) => !unused.has(u.path)),
    empty: r.empty.filter((p) => !empty.has(p)),
    blankNotes: r.blankNotes.filter((n) => !blank.has(n.path)),
    brokenFiles: r.brokenFiles.filter((l) => !broken.has(l.target)),
    external: r.external.filter((l) => !external.has(l.target)),
    missingNotes: r.missingNotes.filter((l) => !notes.has(l.target)),
  };
}

/** How many things a report lists, for saying what a new scan changed. */
export function countListed(r: Report): number {
  return r.unused.length + r.empty.length + r.blankNotes.length + r.brokenFiles.length + r.missingNotes.length + r.external.length;
}
