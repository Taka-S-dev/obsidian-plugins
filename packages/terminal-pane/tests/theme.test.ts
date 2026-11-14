import assert from "node:assert/strict";
import { test } from "node:test";
import { blendOver, parseRgb } from "../src/theme.ts";

test("parseRgb reads the forms getComputedStyle returns", () => {
  assert.deepEqual(parseRgb("rgb(1, 2, 3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseRgb("rgba(255, 208, 0, 0.4)"), [255, 208, 0, 0.4]);
  assert.deepEqual(parseRgb("rgb(10 20 30 / 50%)"), [10, 20, 30, 0.5]);
  assert.equal(parseRgb("oklch(0.7 0.1 200)"), null);
});

test("blendOver paints a translucent color over the background as opaque hex", () => {
  assert.equal(blendOver("rgb(255, 0, 0)", "rgb(0, 0, 0)"), "#ff0000");
  assert.equal(blendOver("rgba(255, 255, 255, 0.5)", "rgb(0, 0, 0)"), "#808080");
  assert.equal(blendOver("rgb(255, 255, 255)", "rgb(0, 0, 0)", 0.25), "#404040");
  assert.equal(blendOver("transparent", "rgb(0, 0, 0)"), null);
});
