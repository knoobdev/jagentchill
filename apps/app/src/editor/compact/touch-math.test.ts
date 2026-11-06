import assert from "node:assert/strict";
import test from "node:test";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { advanceCompactInertia, compactPinchZoom, compactTouchScrollX, compactTouchTime } from "./touch-math.ts";

test("393 pt touch coordinates map to seek time around the fixed playhead", () => {
  const window = { width: 393, height: 852 };
  const fps = { numerator: 30, denominator: 1 };
  const scrollLeft = 100;
  assert.equal(compactTouchScrollX(196.5, window.width, scrollLeft), 100);
  assert.equal(compactTouchTime(196.5, window.width, scrollLeft, 0.5, 60 * TICKS_PER_SECOND, fps), 4 * TICKS_PER_SECOND);
  assert.equal(compactTouchTime(296.5, window.width, scrollLeft, 0.5, 60 * TICKS_PER_SECOND, fps), 8 * TICKS_PER_SECOND);
  assert.equal(compactTouchTime(0, window.width, 0, 0.5, 60 * TICKS_PER_SECOND, fps), 0);
});

test("pinch math clamps the playhead-anchored zoom to the phone's legal range", () => {
  assert.equal(compactPinchZoom(1, 1.4, 0.25, 3), 1.4);
  assert.equal(compactPinchZoom(1, 0.1, 0.25, 3), 0.25);
  assert.equal(compactPinchZoom(2, 2, 0.25, 3), 3);
});

test("timeline flick inertia converts point-per-second velocity to elapsed milliseconds", () => {
  assert.deepEqual(advanceCompactInertia(100, 53, 16, 0.998), { position: 100.848, velocity: 51.32920409597896 });
});
