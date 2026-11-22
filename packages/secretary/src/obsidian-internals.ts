// Obsidian internals the plugin reads. They are not part of the public API, so they live here in
// one place and every use tolerates their absence.
import type { WorkspaceLeaf } from "obsidian";

/** The leaf's tab in Obsidian's tab bar (or sidebar tab strip), or undefined if not available. */
export function tabHeaderEl(leaf: WorkspaceLeaf): HTMLElement | undefined {
  const el = (leaf as unknown as { tabHeaderEl?: unknown }).tabHeaderEl;
  return el instanceof HTMLElement ? el : undefined;
}
