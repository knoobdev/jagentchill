import assert from "node:assert/strict";
import test from "node:test";
import { isForeground, shouldAnimate } from "../../../../packages/ui/src/logic/foreground.ts";

test("foreground work runs only for the active app state", () => {
  assert.equal(isForeground("active"), true);
  assert.equal(isForeground("background"), false);
  assert.equal(isForeground("inactive"), false);
  assert.equal(isForeground(null), false);
});

test("native loops run only while visible and motion is enabled", () => {
  assert.equal(shouldAnimate(true, false, "active"), true);
  assert.equal(shouldAnimate(true, false, "background"), false);
  assert.equal(shouldAnimate(true, false, "inactive"), false);
  assert.equal(shouldAnimate(false, false, "active"), false);
  assert.equal(shouldAnimate(true, true, "active"), false);
});
