import assert from "node:assert/strict";
import { test } from "node:test";
import { listWindowPrependShift } from "@jagentchill/app-core";
import { scrollAnchorCorrection, scrollAnchorLayoutShift, scrollAnchorShouldClearForExplicitTop, scrollAnchorShouldLoadOlderAtTop, scrollAnchorShouldResetAtTop, scrollAnchorWindowTop } from "./scrollAnchor.ts";

test("scroll-anchor restore preserves wheel movement that happened after capture", () => {
  // The reader moved down 40 px: the held row also moved up 40 px in the viewport.
  assert.equal(scrollAnchorLayoutShift(100, 140, 50, 10), 0);
});

test("scroll-anchor restore corrects layout movement while retaining simultaneous reader movement", () => {
  // The reader moved down 40 px while a row above the anchor added 20 px of height.
  assert.equal(scrollAnchorLayoutShift(100, 140, 50, 30), 20);
});

test("scroll-anchor restore still corrects layout movement while the reader is idle", () => {
  assert.equal(scrollAnchorLayoutShift(100, 100, 50, 70), 20);
});

test("a measured visible anchor wins over an estimated prepended-page height", () => {
  assert.equal(scrollAnchorCorrection({ top: 100, offset: 50 }, 124, 36, 5000), 10);
  assert.equal(scrollAnchorCorrection(null, 124, null, 5000), 5000);
});

test("virtual window offset follows content translation away from the physical top", () => {
  assert.equal(scrollAnchorWindowTop(1200, -13_514, true), 14_714);
  assert.equal(scrollAnchorWindowTop(0, -13_514, false), 0);
  assert.equal(scrollAnchorWindowTop(1, -13_514, false), 0);
  assert.equal(scrollAnchorWindowTop(0, -13_514, true), 0);
  assert.equal(scrollAnchorWindowTop(0, 0, false), 0);
});

test("a loaded-page top releases the translated window so the older page can be read", () => {
  // Real-copy shape: a 252-row window, more engine pages available, and retained negative compensation.
  assert.equal(scrollAnchorWindowTop(0, -13_514, true), 0);
  assert.equal(scrollAnchorShouldResetAtTop(0, -6561, true), true);
  assert.equal(listWindowPrependShift(0, true, 120 * 96), 0);
  assert.equal(scrollAnchorShouldResetAtTop(0, -6561, false), true);
  assert.equal(scrollAnchorShouldResetAtTop(2, -6561, false), false);
  assert.equal(scrollAnchorShouldResetAtTop(0, 1, false), true);
});

test("an explicit Home jump clears compensation while older pages remain", () => {
  assert.equal(scrollAnchorShouldClearForExplicitTop(false), true);
  assert.equal(scrollAnchorShouldClearForExplicitTop(true), true);
});

test("a deliberate top scroll continues requesting pages while the 55-request transcript remains older", () => {
  assert.equal(scrollAnchorShouldLoadOlderAtTop(0, true, true, false), true);
  assert.equal(scrollAnchorShouldLoadOlderAtTop(0, true, true, true), false);
  assert.equal(scrollAnchorShouldLoadOlderAtTop(12, true, true, false), false);
  assert.equal(scrollAnchorShouldLoadOlderAtTop(0, false, true, false), false);
  assert.equal(scrollAnchorShouldLoadOlderAtTop(0, true, false, false), false);
});
