// The vault files that terminal programs changed, newest first. Pure module (no Obsidian imports).

export type ChangeKind = "created" | "modified" | "renamed" | "deleted";

export interface Change {
  path: string;
  kind: ChangeKind;
  /** For a renamed file, the path it had before. */
  from?: string;
  /**
   * The file's contents before the first of its changes: empty for a created file, absent when
   * they were not known, as for a file too large to remember.
   */
  before?: string;
}

/** Older entries are dropped past this many. */
const LIMIT = 50;

export class ChangeList {
  private items: Change[] = [];

  get size(): number { return this.items.length; }

  list(): readonly Change[] { return this.items; }

  clear(): void { this.items = []; }

  /**
   * Records a change, folding it into an earlier one for the same file: a file created and then
   * edited is still new, and one created and then deleted was never there. `before` is the file's
   * contents just before this change; an earlier entry keeps its own.
   */
  record(path: string, kind: "created" | "modified" | "deleted", before?: string): void {
    const earlier = this.take(path);
    if (kind === "deleted" && earlier?.kind === "created") return;
    const folded = kind === "modified" && earlier && earlier.kind !== "deleted" ? earlier.kind : kind;
    const original = folded === "created" ? "" : earlier ? earlier.before : before;
    this.push({
      path,
      kind: folded,
      ...(folded === "renamed" && earlier?.from ? { from: earlier.from } : {}),
      ...(original !== undefined ? { before: original } : {}),
    });
  }

  rename(from: string, to: string, before?: string): void {
    const earlier = this.take(from);
    if (earlier?.kind === "created") return this.push({ path: to, kind: "created", before: "" });
    const original = earlier ? earlier.before : before;
    this.push({ path: to, kind: "renamed", from: earlier?.from ?? from, ...(original !== undefined ? { before: original } : {}) });
  }

  /** Drops the entry for a path, as after its change is undone. */
  forget(path: string): void {
    this.take(path);
  }

  /** Removes and returns the entry for a path, if any. */
  private take(path: string): Change | undefined {
    const index = this.items.findIndex((item) => item.path === path);
    return index === -1 ? undefined : this.items.splice(index, 1)[0];
  }

  private push(change: Change): void {
    this.items.unshift(change);
    if (this.items.length > LIMIT) this.items.length = LIMIT;
  }
}
