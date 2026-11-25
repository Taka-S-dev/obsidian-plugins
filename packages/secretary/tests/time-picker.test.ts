import { test } from "node:test";
import assert from "node:assert/strict";
import { minuteChoices } from "../src/time.ts";

test("the minute list steps by five and keeps a minute in between when the field has one", () => {
  assert.deepEqual(minuteChoices(null), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(minuteChoices(30), minuteChoices(null));
  assert.deepEqual(minuteChoices(12).slice(0, 5), [0, 5, 10, 12, 15]);
});
