// The vault files that terminal programs changed, newest first. Pure module (no Obsidian imports).

export type ChangeKind = "created" | "modified" | "renamed" | "deleted";

export interface Change {
  path: string;
  kind: ChangeKind;
  /** For a renamed file, the path it had before. */
  from?: string;
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
   * edited is still new, and one created and then deleted was never there.
   */
  record(path: string, kind: "created" | "modified" | "deleted"): void {
    const earlier = this.take(path);
    if (kind === "deleted" && earlier?.kind === "created") return;
    const folded = kind === "modified" && earlier && earlier.kind !== "deleted" ? earlier.kind : kind;
    this.push({ path, kind: folded, ...(folded === "renamed" && earlier?.from ? { from: earlier.from } : {}) });
  }

  rename(from: string, to: string): void {
    const earlier = this.take(from);
    if (earlier?.kind === "created") return this.push({ path: to, kind: "created" });
    this.push({ path: to, kind: "renamed", from: earlier?.from ?? from });
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
