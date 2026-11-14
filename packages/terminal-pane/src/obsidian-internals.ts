// Obsidian's command and hotkey stores. They are not part of the public API, so they live here in
// one place and every use is guarded: if a future Obsidian changes them, the features that rely on
// them stop working quietly instead of breaking the plugin.
import type { App, WorkspaceLeaf } from "obsidian";
import type { Hotkey } from "./hotkeys.ts";

interface CommandInfo {
  id: string;
  name: string;
}

interface Internals {
  commands?: {
    listCommands?(): CommandInfo[];
    findCommand?(id: string): CommandInfo | undefined;
  };
  hotkeyManager?: {
    getHotkeys?(id: string): Hotkey[] | undefined;
    getDefaultHotkeys?(id: string): Hotkey[] | undefined;
    printHotkeyForCommand?(id: string): string;
  };
}

const internals = (app: App) => app as unknown as Internals;

/** Every command Obsidian knows, from the core and from plugins. */
export function listCommands(app: App): CommandInfo[] {
  return internals(app).commands?.listCommands?.() ?? [];
}

/** The command's name as shown in the command palette, or undefined if no such command is loaded. */
export function commandName(app: App, id: string): string | undefined {
  return internals(app).commands?.findCommand?.(id)?.name;
}

/** The hotkeys in effect for a command: the user's own if set, otherwise its defaults. */
export function hotkeysFor(app: App, id: string): Hotkey[] {
  const manager = internals(app).hotkeyManager;
  return manager?.getHotkeys?.(id) ?? manager?.getDefaultHotkeys?.(id) ?? [];
}

/** The command's hotkeys as Obsidian writes them ("Ctrl + O"), or "" if there are none. */
export function hotkeyText(app: App, id: string): string {
  return internals(app).hotkeyManager?.printHotkeyForCommand?.(id) ?? "";
}

/** The leaf's tab in Obsidian's tab bar (or sidebar tab strip), or undefined if not available. */
export function tabHeaderEl(leaf: WorkspaceLeaf): HTMLElement | undefined {
  const el = (leaf as unknown as { tabHeaderEl?: unknown }).tabHeaderEl;
  return el instanceof HTMLElement ? el : undefined;
}

/**
 * Vault paths of the files or folders being dragged from Obsidian (the file explorer, a tab, a
 * search result), or null when the drag did not start in Obsidian.
 */
export function draggedVaultPaths(app: App): string[] | null {
  const draggable = (app as unknown as { dragManager?: { draggable?: unknown } }).dragManager?.draggable as
    | { file?: { path?: unknown }; files?: { path?: unknown }[] }
    | null
    | undefined;
  if (!draggable) return null;
  const items = draggable.files ?? (draggable.file ? [draggable.file] : []);
  const paths = items.map((item) => item.path).filter((path): path is string => typeof path === "string");
  return paths.length > 0 ? paths : null;
}

/**
 * Redraws a leaf's tab title and its view's header after the display text changed. The header
 * keeps the text the view opened with otherwise.
 */
export function refreshHeader(leaf: WorkspaceLeaf): void {
  (leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  (leaf.view as unknown as { titleEl?: HTMLElement }).titleEl?.setText(leaf.view.getDisplayText());
}
