// Runs sequences of file operations against a small in-memory vault, records them as the terminal
// view does, then undoes every entry the way the plugin does and checks the vault is back to where
// it started.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Change, ChangeList } from "../src/changes.ts";

type Vault = Map<string, string>;
type Op =
  | { op: "write"; path: string; text: string }
  | { op: "create"; path: string; text: string }
  | { op: "delete"; path: string }
  | { op: "rename"; from: string; to: string };

/** Applies an operation to the vault and records it, as the vault events reach the view. */
function apply(vault: Vault, changes: ChangeList, step: Op): void {
  switch (step.op) {
    case "write":
      changes.record(step.path, "modified", vault.get(step.path));
      vault.set(step.path, step.text);
      return;
    case "create":
      vault.set(step.path, step.text);
      changes.record(step.path, "created");
      return;
    case "delete":
      changes.record(step.path, "deleted", vault.get(step.path));
      vault.delete(step.path);
      return;
    case "rename":
      changes.rename(step.from, step.to, vault.get(step.from));
      vault.set(step.to, vault.get(step.from) ?? "");
      vault.delete(step.from);
  }
}

/** Undoes one entry as the plugin's Undo change does; false when the vault is in the way. */
function undo(vault: Vault, change: Change): boolean {
  const { path, before } = change;
  if (before === undefined) return false;
  switch (change.kind) {
    case "created":
      if (!vault.has(path)) return false;
      vault.delete(path);
      return true;
    case "modified":
      if (!vault.has(path)) return false;
      vault.set(path, before);
      return true;
    case "deleted":
      if (vault.has(path)) return false;
      vault.set(path, before);
      return true;
    case "renamed":
      if (!vault.has(path) || !change.from || vault.has(change.from)) return false;
      vault.delete(path);
      vault.set(change.from, before);
      return true;
  }
}

/** Undoes every entry, in whatever order the vault allows, and returns the vault. */
function undoAll(vault: Vault, changes: ChangeList): Vault {
  let progress = true;
  while (changes.size > 0 && progress) {
    progress = false;
    for (const change of [...changes.list()]) {
      if (undo(vault, change)) {
        changes.forget(change.path);
        progress = true;
      }
    }
  }
  assert.equal(changes.size, 0, `left undone: ${JSON.stringify(changes.list())}`);
  return vault;
}

function roundTrip(start: Record<string, string>, steps: Op[]): void {
  const vault: Vault = new Map(Object.entries(start));
  const changes = new ChangeList();
  for (const step of steps) apply(vault, changes, step);
  assert.deepEqual(Object.fromEntries(undoAll(vault, changes)), start);
}

test("a file deleted and created again under its name goes back to its first contents", () => {
  roundTrip({ "a.md": "original" }, [
    { op: "delete", path: "a.md" },
    { op: "create", path: "a.md", text: "new" },
  ]);
});

test("a file renamed and then deleted comes back under its first name", () => {
  roundTrip({ "a.md": "original" }, [
    { op: "rename", from: "a.md", to: "b.md" },
    { op: "delete", path: "b.md" },
  ]);
});

test("a file edited, deleted and created again goes back to its first contents", () => {
  roundTrip({ "a.md": "v1" }, [
    { op: "write", path: "a.md", text: "v2" },
    { op: "delete", path: "a.md" },
    { op: "create", path: "a.md", text: "v3" },
  ]);
});

test("a file moved onto the name of a deleted one restores both", () => {
  roundTrip({ "a.md": "A", "c.md": "C" }, [
    { op: "delete", path: "a.md" },
    { op: "rename", from: "c.md", to: "a.md" },
  ]);
});

test("a file renamed away and back is put back as it was", () => {
  roundTrip({ "a.md": "A" }, [
    { op: "rename", from: "a.md", to: "b.md" },
    { op: "write", path: "b.md", text: "A2" },
    { op: "rename", from: "b.md", to: "a.md" },
  ]);
});

test("two files swapping names are both put back", () => {
  roundTrip({ "a.md": "A", "b.md": "B" }, [
    { op: "rename", from: "a.md", to: "tmp.md" },
    { op: "rename", from: "b.md", to: "a.md" },
    { op: "rename", from: "tmp.md", to: "b.md" },
  ]);
});

test("random sequences of operations can all be undone", () => {
  // A small linear congruential generator keeps the runs repeatable.
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    // The low bits of this generator repeat with a short period; the high ones do not.
    return Math.floor((seed / 2147483648) * n);
  };
  const names = ["a.md", "b.md", "c.md", "d.md"];
  for (let run = 0; run < 300; run++) {
    const start: Record<string, string> = { "a.md": "A", "b.md": "B" };
    const vault: Vault = new Map(Object.entries(start));
    const changes = new ChangeList();
    for (let i = 0; i < 6; i++) {
      const present = names.filter((n) => vault.has(n));
      const absent = names.filter((n) => !vault.has(n));
      const choice = next(4);
      if (choice === 0 && present.length > 0) apply(vault, changes, { op: "write", path: present[next(present.length)], text: `w${run}.${i}` });
      else if (choice === 1 && absent.length > 0) apply(vault, changes, { op: "create", path: absent[next(absent.length)], text: `c${run}.${i}` });
      else if (choice === 2 && present.length > 0) apply(vault, changes, { op: "delete", path: present[next(present.length)] });
      else if (present.length > 0 && absent.length > 0) {
        apply(vault, changes, { op: "rename", from: present[next(present.length)], to: absent[next(absent.length)] });
      }
    }
    assert.deepEqual(Object.fromEntries([...undoAll(vault, changes)].sort()), start, `run ${run}`);
  }
});
