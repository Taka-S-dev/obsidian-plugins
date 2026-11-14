// Shows a change to a file as a diff, in one of two kinds:
// - an edit Claude Code or Copilot CLI proposes, with buttons to approve or reject it as an
//   alternative to the prompt in the terminal;
// - a change a terminal program already made, from the list of changed notes, with a button to undo it.
import { ItemView, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Change } from "./changes.ts";
import { diff, type DiffLine, type Diff as DiffResult } from "./diff.ts";
import type { Strings } from "./i18n.ts";
import { refreshHeader } from "./obsidian-internals.ts";

export const DIFF_VIEW_TYPE = "terminal-pane-diff";

export interface ProposalState {
  kind: "proposal";
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

export interface ReviewState {
  kind: "review";
  change: Change;
}

export type DiffState = ProposalState | ReviewState;

/** What the buttons in the diff do. */
export interface DiffActions {
  decide(tabName: string, approve: boolean): void;
  openFile(path: string): void;
  undo(change: Change): void;
}

function readState(state: unknown): DiffState | null {
  const s = state as { kind?: unknown; change?: Partial<Change>; [key: string]: unknown } | null;
  if (s?.kind === "review") return typeof s.change?.path === "string" ? (s as unknown as ReviewState) : null;
  return s?.kind === "proposal" && typeof s.tabName === "string" && typeof s.assistant === "string"
    && typeof s.path === "string" && typeof s.label === "string" && typeof s.contents === "string"
    ? (s as unknown as ProposalState) : null;
}

export class DiffView extends ItemView {
  navigation = false;
  private state: DiffState | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly s: Strings, private readonly actions: DiffActions) {
    super(leaf);
  }

  getViewType(): string { return DIFF_VIEW_TYPE; }
  getIcon(): string { return "file-diff"; }
  getDisplayText(): string {
    const state = this.state;
    if (!state) return this.s.diff.empty;
    if (state.kind === "review") return this.s.review.tabTitle(basename(state.change.path));
    return this.s.diff.tabTitle(state.assistant, basename(state.path));
  }

  get tabName(): string | null { return this.state?.kind === "proposal" ? this.state.tabName : null; }
  get isReview(): boolean { return this.state?.kind === "review"; }

  // Not saved with the layout: after a restart the assistant no longer waits on the edit, and the
  // list of changes is gone.
  getState(): Record<string, unknown> { return {}; }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = readState(state);
    await this.render();
    await super.setState(state, result);
    refreshHeader(this.leaf);
  }

  async onOpen(): Promise<void> {
    // A reviewed file that changes again is shown as it is now.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (this.state?.kind === "review" && file.path === this.state.change.path) void this.render();
    }));
    await this.render();
  }

  private async render(): Promise<void> {
    const state = this.state;
    if (state?.kind === "review") return this.renderReview(state);
    const { contentEl, s } = this;
    this.reset();
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
    const header = this.header(state.label, result, before === "" ? s.diff.newFile : null);
    const buttons = header.createDiv({ cls: "terminal-pane-diff-actions" });
    this.button(buttons, s.diff.reject, false, () => this.actions.decide(state.tabName, false));
    this.button(buttons, s.diff.approve, true, () => this.actions.decide(state.tabName, true));
    contentEl.createDiv({ cls: "terminal-pane-diff-note", text: s.diff.decideHere(state.assistant) });
    this.renderBody(result);
  }

  private async renderReview(state: ReviewState): Promise<void> {
    const { change } = state;
    const { s } = this;
    const file = this.app.vault.getFileByPath(change.path);
    const now = change.kind === "deleted" || !(file instanceof TFile) ? "" : await this.app.vault.read(file);
    if (this.state !== state) return;
    this.reset();
    const tag = change.kind === "created" ? s.changes.created : change.kind === "deleted" ? s.changes.deleted : null;
    const result = diff(change.before ?? now, now);
    const header = this.header(change.path, result, tag);
    const buttons = header.createDiv({ cls: "terminal-pane-diff-actions" });
    if (change.kind !== "deleted") this.button(buttons, s.review.open, false, () => this.actions.openFile(change.path));
    if (change.before !== undefined) this.button(buttons, s.review.undo, false, () => this.actions.undo(change));
    const notes = [s.review.note];
    if (change.kind === "renamed" && change.from) notes.push(s.review.renamedFrom(change.from));
    if (change.before === undefined) notes.push(s.review.unknownBefore);
    for (const text of notes) this.contentEl.createDiv({ cls: "terminal-pane-diff-note", text });
    if (change.before !== undefined) this.renderBody(result);
  }

  private reset(): void {
    this.contentEl.empty();
    this.contentEl.addClass("terminal-pane-diff");
  }

  /** The path with counts of added and removed lines; `tag` marks a new or deleted file. */
  private header(label: string, result: DiffResult, tag: string | null): HTMLElement {
    const header = this.contentEl.createDiv({ cls: "terminal-pane-diff-header" });
    header.createDiv({ cls: "terminal-pane-diff-path", text: label });
    const stats = header.createDiv({ cls: "terminal-pane-diff-stats" });
    stats.createSpan({ cls: "is-added", text: `+${result.added}` });
    stats.createSpan({ cls: "is-removed", text: `−${result.removed}` });
    if (tag) stats.createSpan({ text: tag });
    return header;
  }

  private button(parent: HTMLElement, text: string, primary: boolean, onClick: () => void): void {
    const button = parent.createEl("button", { text, cls: primary ? "mod-cta" : undefined });
    button.addEventListener("click", onClick);
  }

  private renderBody(result: DiffResult): void {
    const body = this.contentEl.createDiv({ cls: "terminal-pane-diff-body" });
    if (result.hunks.length === 0) {
      body.createDiv({ cls: "terminal-pane-diff-skipped", text: this.s.diff.noChanges });
      return;
    }
    for (const hunk of result.hunks) {
      if (hunk.skippedBefore > 0) body.createDiv({ cls: "terminal-pane-diff-skipped", text: this.s.diff.skipped(hunk.skippedBefore) });
      for (const line of hunk.lines) this.renderLine(body, line);
    }
    if (result.skippedAfter > 0) body.createDiv({ cls: "terminal-pane-diff-skipped", text: this.s.diff.skipped(result.skippedAfter) });
  }

  private renderLine(parent: HTMLElement, line: DiffLine): void {
    const row = parent.createDiv({ cls: ["terminal-pane-diff-line", `is-${line.kind}`] });
    row.createSpan({ cls: "terminal-pane-diff-num", text: line.oldLine === undefined ? "" : String(line.oldLine) });
    row.createSpan({ cls: "terminal-pane-diff-num", text: line.newLine === undefined ? "" : String(line.newLine) });
    row.createSpan({ cls: "terminal-pane-diff-sign", text: line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " " });
    row.createSpan({ cls: "terminal-pane-diff-text", text: line.text });
  }
}
