// Obsidian internals the plugin reads. They are not part of the public API, so they live here in
// one place and every use tolerates their absence.
import type { App, WorkspaceLeaf } from "obsidian";

/** The leaf's tab in Obsidian's tab bar (or sidebar tab strip), or undefined if not available. */
export function tabHeaderEl(leaf: WorkspaceLeaf): HTMLElement | undefined {
  const el = (leaf as unknown as { tabHeaderEl?: unknown }).tabHeaderEl;
  return el instanceof HTMLElement ? el : undefined;
}

/**
 * The Tasks plugin's own way to check a task off (its public API, version 1): it adds the done
 * date and, for a repeating task, the next one's line above or below, as its settings say.
 * Undefined when the plugin is not installed or enabled.
 */
export function tasksToggle(app: App): ((line: string, path: string) => string) | undefined {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  const api = (plugins?.["obsidian-tasks-plugin"] as { apiV1?: { executeToggleTaskDoneCommand?: unknown } } | undefined)?.apiV1;
  const toggle = api?.executeToggleTaskDoneCommand;
  return typeof toggle === "function" ? (line, path) => String(toggle.call(api, line, path)) : undefined;
}
