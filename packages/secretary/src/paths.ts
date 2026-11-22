// Vault paths typed into the settings. Pure module (no Obsidian imports).

/** A note path as typed, with ".md" added when it has no extension ("Inbox" -> "Inbox.md"). */
export function asNotePath(path: string): string {
  const p = path.trim();
  if (p === "" || /\.md$/i.test(p)) return p;
  return `${p}.md`;
}

/**
 * Paths that contain every word of the query, ignoring case: those whose name starts with the
 * query first, then the rest, each in path order. An empty query lists the first ones.
 */
export function matchPaths(paths: readonly string[], query: string, limit: number): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const q = query.trim().toLowerCase();
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  return paths
    .filter((p) => words.every((w) => p.toLowerCase().includes(w)))
    .sort((a, b) => Number(!name(a).startsWith(q)) - Number(!name(b).startsWith(q)) || a.localeCompare(b))
    .slice(0, limit);
}

/**
 * Where the inbox or reminders note could go: the note's own name at the vault root and in each
 * folder. Existing notes are not offered, since the plugin appends to the note and counts its
 * task lines; picking an unrelated note would mix the two.
 */
export function noteLocations(folders: readonly string[], name: string): string[] {
  return [name, ...folders.map((f) => `${f}/${name}`)];
}

/** How the default queue folder is shown: as an environment variable, not the user's own path. */
export function queueDirLabel(env: Record<string, string | undefined>): string {
  return env.LOCALAPPDATA ? "%LOCALAPPDATA%\\Secretary\\queue" : "~/.secretary/queue";
}
