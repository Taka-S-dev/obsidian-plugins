// The vault files that terminal programs changed, newest first. Pure module (no Obsidian imports).
//
// Each path touched is remembered with how it was before the first change (whether it existed, and
// its contents) and whether it exists now. Undoing a change puts a path back to its first state, so
// any sequence of edits, deletions, creations and renames can be undone, in any order. A rename is
// shown as one change when its old path is now gone and its new one did not exist before.

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

interface Tracked {
  path: string;
  /** Whether the path held a file before the first change. */
  existed: boolean;
  /** Its contents then, when it existed and they were known. */
  before?: string;
  exists: boolean;
  /** The path whose file was moved here, while that move is still what happened. */
  movedFrom?: string;
}

/** Older entries are dropped past this many. */
const LIMIT = 50;

export class ChangeList {
  /** Newest first. */
  private tracked: Tracked[] = [];

  get size(): number { return this.list().length; }

  /** The changes, newest first, with a move shown once at its new path. */
  list(): readonly Change[] {
    const consumed = new Set<string>();
    const changes: Change[] = [];
    for (const t of this.tracked) {
      if (consumed.has(t.path)) continue;
      const source = this.moveSource(t);
      if (source) {
        consumed.add(source.path);
        changes.push({ path: t.path, kind: "renamed", from: source.path, ...known(source.before) });
      } else if (!t.existed) {
        changes.push({ path: t.path, kind: "created", before: "" });
      } else {
        changes.push({ path: t.path, kind: t.exists ? "modified" : "deleted", ...known(t.before) });
      }
    }
    return changes;
  }

  clear(): void { this.tracked = []; }

  /** Records a change to a path; `before` is its contents just before this change, if known. */
  record(path: string, kind: "created" | "modified" | "deleted", before?: string): void {
    const t = this.touch(path, kind !== "created", before);
    t.exists = kind !== "deleted";
    if (kind === "created") delete t.movedFrom;
    this.settle(t);
  }

  rename(from: string, to: string, before?: string): void {
    const source = this.touch(from, true, before);
    source.exists = false;
    const target = this.touch(to, false);
    target.exists = true;
    target.movedFrom = source.movedFrom ?? from;
    delete source.movedFrom;
    this.settle(source);
    this.settle(target);
  }

  /**
   * Takes a deletion of `from` and a creation of `to` for one move: a program moving a file reaches
   * Obsidian as those two changes.
   */
  moved(from: string, to: string): void {
    const source = this.find(from);
    const target = this.find(to);
    if (!source || !target) return;
    target.movedFrom = source.movedFrom ?? from;
    delete source.movedFrom;
    this.settle(source);
  }

  /** The deleted file whose contents were `text`, as a candidate for where a new file came from. */
  deletedWith(text: string): Change | undefined {
    return this.list().find((change) => change.kind === "deleted" && change.before === text);
  }

  /** Drops a change, as after it is undone; for a rename, both of its paths. */
  forget(path: string): void {
    const t = this.find(path);
    if (!t) return;
    const source = this.moveSource(t);
    this.tracked = this.tracked.filter((item) => item !== t && item !== source);
  }

  /** The tracked path a file was moved from, while the move still describes what happened. */
  private moveSource(t: Tracked): Tracked | undefined {
    if (t.existed || !t.exists || !t.movedFrom) return undefined;
    const source = this.find(t.movedFrom);
    return source && source.existed && !source.exists ? source : undefined;
  }

  private find(path: string): Tracked | undefined {
    return this.tracked.find((t) => t.path === path);
  }

  /** The entry for a path, moved to the front; a new one starts from how the path was before. */
  private touch(path: string, existed: boolean, before?: string): Tracked {
    const index = this.tracked.findIndex((t) => t.path === path);
    const t = index === -1 ? { path, existed, exists: existed, ...(existed ? known(before) : {}) } : this.tracked.splice(index, 1)[0];
    this.tracked.unshift(t);
    if (this.tracked.length > LIMIT) this.tracked.length = LIMIT;
    return t;
  }

  /** A path that did not exist before and does not now has nothing to undo. */
  private settle(t: Tracked): void {
    if (!t.existed && !t.exists) this.tracked = this.tracked.filter((item) => item !== t);
  }
}

const known = (before: string | undefined) => (before !== undefined ? { before } : {});
