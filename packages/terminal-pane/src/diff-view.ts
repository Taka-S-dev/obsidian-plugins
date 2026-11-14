// Shows an edit Claude Code proposes as a diff, while it waits for approval in the terminal.
import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { diff, type DiffLine } from "./diff.ts";
import type { Strings } from "./i18n.ts";
import { refreshHeader } from "./obsidian-internals.ts";

export const DIFF_VIEW_TYPE = "terminal-pane-diff";

export interface DiffState {
  /** The assistant's name for the diff. */
  tabName: string;
  /** The program that proposes the edit, such as Claude Code. */
  assistant: string;
  /** Absolute path of the file. */
  path: string;
  /** How the path is shown: relative to the vault when inside it. */
  label: string;
  /** The whole file after the edit. */
  contents: string;
}

function readState(state: unknown): DiffState | null {
  const s = state as Partial<DiffState> | null;
  return s && typeof s.tabName === "string" && typeof s.assistant === "string" && typeof s.path === "string" && typeof s.label === "string"
    && typeof s.contents === "string" ? (s as DiffState) : null;
}

export class DiffView extends ItemView {
  navigation = false;
  private state: DiffState | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly s: Strings) {
    super(leaf);
  }

  getViewType(): string { return DIFF_VIEW_TYPE; }
  getIcon(): string { return "file-diff"; }
  getDisplayText(): string {
    return this.state ? this.s.diff.tabTitle(this.state.assistant, basename(this.state.path)) : this.s.diff.empty;
  }

  get tabName(): string | null { return this.state?.tabName ?? null; }

  // Not saved with the layout: after a restart the assistant no longer waits on the edit.
  getState(): Record<string, unknown> { return {}; }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = readState(state);
    this.render();
    await super.setState(state, result);
    refreshHeader(this.leaf);
  }

  async onOpen(): Promise<void> { this.render(); }

  private render(): void {
    const { contentEl, s } = this;
    contentEl.empty();
    contentEl.addClass("terminal-pane-diff");
    const state = this.state;
    if (!state) {
      contentEl.createDiv({ cls: "terminal-pane-diff-note", text: s.diff.empty });
      return;
    }
    let before = "";
    try {
      before = readFileSync(state.path, "utf-8");
    } catch {
      // A file the edit creates.
    }
    const result = diff(before, state.contents);
    const header = contentEl.createDiv({ cls: "terminal-pane-diff-header" });
    header.createDiv({ cls: "terminal-pane-diff-path", text: state.label });
    const stats = header.createDiv({ cls: "terminal-pane-diff-stats" });
    stats.createSpan({ cls: "is-added", text: `+${result.added}` });
    stats.createSpan({ cls: "is-removed", text: `−${result.removed}` });
    if (before === "") stats.createSpan({ text: s.diff.newFile });
    contentEl.createDiv({ cls: "terminal-pane-diff-note", text: s.diff.approveInTerminal(state.assistant) });

    const body = contentEl.createDiv({ cls: "terminal-pane-diff-body" });
    if (result.hunks.length === 0) {
      body.createDiv({ cls: "terminal-pane-diff-skipped", text: s.diff.noChanges });
      return;
    }
    for (const hunk of result.hunks) {
      if (hunk.skippedBefore > 0) body.createDiv({ cls: "terminal-pane-diff-skipped", text: s.diff.skipped(hunk.skippedBefore) });
      for (const line of hunk.lines) this.renderLine(body, line);
    }
    if (result.skippedAfter > 0) body.createDiv({ cls: "terminal-pane-diff-skipped", text: s.diff.skipped(result.skippedAfter) });
  }

  private renderLine(parent: HTMLElement, line: DiffLine): void {
    const row = parent.createDiv({ cls: ["terminal-pane-diff-line", `is-${line.kind}`] });
    row.createSpan({ cls: "terminal-pane-diff-num", text: line.oldLine === undefined ? "" : String(line.oldLine) });
    row.createSpan({ cls: "terminal-pane-diff-num", text: line.newLine === undefined ? "" : String(line.newLine) });
    row.createSpan({ cls: "terminal-pane-diff-sign", text: line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " " });
    row.createSpan({ cls: "terminal-pane-diff-text", text: line.text });
  }
}
