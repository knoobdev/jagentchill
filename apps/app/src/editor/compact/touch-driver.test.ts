import test from "node:test";
import assert from "node:assert/strict";
import { createTouchDriver } from "./touch-driver.ts";
import type { TouchPoint } from "./touch-types.ts";

const pt = (x: number, y = 0): TouchPoint => ({ x, y, clientX: x, clientY: y, time_ms: x });

test("touch driver maps a real drag sequence into one editor drag session", () => {
  const calls: unknown[] = [], driver = createTouchDriver({ down: (p) => calls.push(["down", p.x]), drag: (start) => ({
    move: (p) => calls.push(["move", p.x]), end: (p, velocity) => calls.push(["end", p.x, velocity.x]), cancel: () => calls.push(["cancel"]),
  }) });
  driver.down(pt(10)); driver.panStart(pt(20)); driver.panMove(pt(30)); driver.panEnd(pt(40), { x: 5, y: 0 });
  assert.deepEqual(calls, [["down", 10], ["move", 20], ["move", 30], ["end", 40, 5]]);
});

test("touch driver routes tap, long-press cancellation, and pinch scale and twist", () => {
  const calls: string[] = [], driver = createTouchDriver({ tap: () => calls.push("tap"), longPress: () => ({ move: () => calls.push("long-move"), cancel: () => calls.push("long-cancel") }), pinch: () => ({ move: (scale, rotation) => calls.push(`${scale}:${rotation}`), end: () => calls.push("pinch-end") }) });
  driver.tap(pt(1)); driver.longStart(pt(2)); driver.longMove(pt(3)); driver.longEnd(pt(3), false); driver.pinchStart(pt(4)); driver.pinchMove(1.4, 12, pt(5)); driver.pinchEnd(true);
  assert.deepEqual(calls, ["tap", "long-move", "long-cancel", "1.4:12", "pinch-end"]);
});
