import assert from "node:assert/strict";
import test from "node:test";
import { filmStageStrip } from "./mobileLayout.ts";

test("Film Studio stage tabs scroll and stay thumb-sized on a 393 pt phone", () => {
  assert.deepEqual(filmStageStrip(true), { horizontal: true, height: 48, tabMinHeight: 44 });
  assert.deepEqual(filmStageStrip(false), { horizontal: false, height: 36, tabMinHeight: 35 });
});
