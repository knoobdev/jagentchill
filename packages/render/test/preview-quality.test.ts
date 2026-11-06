import assert from "node:assert/strict";
import test from "node:test";
import { previewRenderSize } from "../src/engine/quality.ts";

test("portrait preview backs the displayed canvas with device pixels after a stage resize", () => {
  const size = previewRenderSize({ width: 1080, height: 1920 }, { width: 200.8, height: 357 }, 2, 1, "full", { width: 3840, height: 2160 });
  assert.deepEqual(size, { width: 402, height: 714 });
  assert.ok(size.width >= 200.8 * 2 * 0.99);
  assert.ok(size.height >= 357 * 2 * 0.99);
});

test("wide preview follows viewport changes and caps zoom at the project resolution", () => {
  const resized = previewRenderSize({ width: 1920, height: 1080 }, { width: 687, height: 357 }, 2, 1, "full", { width: 3840, height: 2160 });
  assert.deepEqual(resized, { width: 1270, height: 714 });
  const zoomed = previewRenderSize({ width: 1080, height: 1920 }, { width: 200.8, height: 357 }, 2, 4, "full", { width: 3840, height: 2160 });
  assert.deepEqual(zoomed, { width: 1080, height: 1920 });
});

test("preview resolution honors device density, quality and the maximum framebuffer", () => {
  const dpr1 = previewRenderSize({ width: 1920, height: 1080 }, { width: 687, height: 357 }, 1, 1, "full", { width: 3840, height: 2160 });
  const half = previewRenderSize({ width: 1080, height: 1920 }, { width: 200.8, height: 357 }, 2, 1, "half", { width: 3840, height: 2160 });
  const capped = previewRenderSize({ width: 7680, height: 4320 }, { width: 2560, height: 1440 }, 2, 1, "full", { width: 3840, height: 2160 });
  assert.deepEqual(dpr1, { width: 634, height: 358 });
  assert.deepEqual(half, { width: 200, height: 356 });
  assert.deepEqual(capped, { width: 3840, height: 2160 });
});
