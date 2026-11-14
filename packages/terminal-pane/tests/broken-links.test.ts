import assert from "node:assert/strict";
import { test } from "node:test";
import { brokenLinksTo, totalBroken } from "../src/broken-links.ts";

test("links by name, by full path and by the end of the path count as broken", () => {
  const unresolved = {
    "a.md": { "Plan": 2 },
    "b.md": { "projects/Plan": 1, "Other": 4 },
    "c.md": { "work/projects/plan.md": 1 },
    "d.md": { "Planning": 1, "jects/Plan": 1 },
  };
  assert.deepEqual(brokenLinksTo("work/projects/Plan.md", unresolved), [
    { source: "a.md", count: 2 },
    { source: "b.md", count: 1 },
    { source: "c.md", count: 1 },
  ]);
});

test("a file that is not a note is linked with its extension", () => {
  const unresolved = { "a.md": { "img/chart.png": 1, "chart": 1 } };
  assert.deepEqual(brokenLinksTo("img/chart.png", unresolved), [{ source: "a.md", count: 1 }]);
});

test("nothing is broken when no unresolved link names the file", () => {
  assert.deepEqual(brokenLinksTo("x.md", { "a.md": { "y": 1 } }), []);
  assert.equal(totalBroken([[{ source: "a.md", count: 2 }], [], [{ source: "b.md", count: 1 }]]), 3);
});
