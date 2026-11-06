import assert from "node:assert/strict";
import test from "node:test";
import { compactListCardWidth, compactScale, compactViewport } from "../../../../packages/ui/src/compact.ts";

test("workflow screens fit the 393 pt phone viewport and reserve keyboard space", () => {
  const viewport = compactViewport({ width: 393, height: 852, insetTop: 59, insetBottom: 34, keyboardHeight: 336 });
  assert.deepEqual(viewport, { width: 393, top: 59, bottom: 516, height: 457, keyboardTop: 516 });
  assert.equal(compactListCardWidth(viewport.width), 361);
  assert.equal(compactScale.control.height, 44);
});
