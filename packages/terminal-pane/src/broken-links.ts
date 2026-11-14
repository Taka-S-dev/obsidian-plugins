// Which notes have links that pointed at a file now gone from its path. Pure module (no Obsidian
// imports): it reads Obsidian's table of unresolved links, by source note and link text.

export interface BrokenLinks {
  /** The note the links are in. */
  source: string;
  count: number;
}

const stripMd = (path: string) => path.replace(/\.md$/i, "");

/**
 * The notes with unresolved links whose text names `path`: in full, by name alone, or by the end
 * of its path, as Obsidian resolves links. Case is ignored, as Obsidian does. Most links first.
 */
export function brokenLinksTo(path: string, unresolved: Record<string, Record<string, number>>): BrokenLinks[] {
  const target = stripMd(path).toLowerCase();
  const name = target.slice(target.lastIndexOf("/") + 1);
  const result: BrokenLinks[] = [];
  for (const [source, links] of Object.entries(unresolved)) {
    let count = 0;
    for (const [text, times] of Object.entries(links)) {
      const link = stripMd(text.replace(/^\/+/, "")).toLowerCase();
      if (link === target || link === name || target.endsWith(`/${link}`)) count += times;
    }
    if (count > 0) result.push({ source, count });
  }
  return result.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** The number of broken links across all the lists. */
export function totalBroken(lists: BrokenLinks[][]): number {
  return lists.reduce((sum, list) => sum + list.reduce((n, item) => n + item.count, 0), 0);
}
