import assert from "node:assert/strict";
import test from "node:test";
import { canvasRect, FIT_VIEW } from "@jagentchill/app-core";
import { COMPACT, compactLandscapeHeights, compactLandscapeSheetWidth, compactRegionHeights, compactTrackGeometry, stepCompactZoom, touchZone } from "./layout.ts";
import { inMainTrackControlGutter } from "./layout.ts";

test("compact editor regions fit the 393×852 phone between safe areas", () => {
  const regions = compactRegionHeights(852, { top: 59, bottom: 34 });
  assert.deepEqual(regions, { preview: 299, timeline: 260, sheet: 324, toolbar: 56, transport: 44, bottomInset: 34 });
  assert.ok(regions.preview + regions.timeline + regions.toolbar + regions.transport + regions.bottomInset <= 749);
  assert.equal(852 - 59 - 44, 749, "editor content starts below the safe-area top bar");
});

test("compact editor remains within the keyboard-resized viewport", () => {
  // 852 pt window minus the 336 pt keyboard; iOS reports no bottom safe area above the keyboard.
  const visibleHeight = 852 - 336;
  const regions = compactRegionHeights(visibleHeight, { top: 59, bottom: 0 });
  assert.deepEqual(regions, { preview: 181, timeline: 132, sheet: 140, toolbar: 56, transport: 44, bottomInset: 0 });
  assert.equal(regions.preview + regions.timeline + regions.toolbar + regions.transport, visibleHeight - 59 - 44);
  assert.equal(regions.preview + regions.transport + COMPACT.compactTimeline + regions.sheet, visibleHeight - 59 - 44, "the text sheet fits between the editor top bar and keyboard");
});

test("compact editor puts preview left and timeline right at 852×393 landscape with a bottom inset", () => {
  const regions = compactLandscapeHeights(852, 393, { top: 0, bottom: 21 });
  assert.deepEqual(regions, { preview: 284, timeline: 272, sheet: 280, toolbar: 56, transport: 44, bottomInset: 21, landscape: true });
  assert.equal(regions.preview + regions.transport, 328, "left preview pane ends above the bottom inset");
  assert.equal(regions.timeline + regions.toolbar, 328, "right timeline pane ends above the bottom inset");
  assert.equal(COMPACT.compactTimeline + regions.sheet, 328, "open tool sheet keeps a 48 pt timeline strip");
});

test("landscape side sheet leaves a visible timeline strip beside the preview pane", () => {
  const sheet = compactLandscapeSheetWidth(852);
  assert.equal(sheet, 306);
  assert.ok(sheet <= 0.36 * 852);
  assert.ok(852 * 0.455 - sheet >= 80, "at least 80 pt of the right timeline pane stays visible");
});

test("compact timeline zoom buttons use bounded 25 percent steps", () => {
  const range = { min: 0.25, max: 3 };
  assert.equal(stepCompactZoom(1, "in", range), 1.25);
  assert.equal(stepCompactZoom(1.25, "out", range), 1);
  assert.equal(stepCompactZoom(0.3, "out", range), 0.25);
  assert.equal(stepCompactZoom(2.9, "in", range), 3);
});

test("selected clip handles accept touches across a 44 pt hit area", () => {
  assert.equal(touchZone(0, 120, 44, 20), "trim-start");
  assert.equal(touchZone(20, 120, 44, 20), "trim-start");
  assert.equal(touchZone(100, 120, 44, 20), "trim-end");
  assert.equal(touchZone(-25, 120, 44, 20), null);
});

test("short selected clips retain 44 pt trim targets on both edges", () => {
  const width = 36, hit = 44;
  assert.equal(touchZone(-26, width, hit, 20), "trim-start");
  assert.equal(touchZone(17, width, hit, 20), "trim-start");
  assert.equal(touchZone(19, width, hit, 20), "trim-end");
  assert.equal(touchZone(62, width, hit, 20), "trim-end");
  assert.equal(touchZone(-27, width, hit, 20), null);
  assert.equal(touchZone(63, width, hit, 20), null);
});

test("phone preview contains and centres 16:9, 9:16, and square frames inside a 12 pt margin", () => {
  const preview = { width: 393, height: 354 }, margin = 12;
  const viewport = { width: preview.width - 2 * margin, height: preview.height - 2 * margin };
  for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
    const rect = canvasRect(FIT_VIEW, viewport, canvas);
    assert.ok(rect.left >= 0 && rect.top >= 0);
    assert.ok(rect.left + rect.width <= viewport.width && rect.top + rect.height <= viewport.height);
    assert.equal(rect.left + rect.width / 2, viewport.width / 2);
    assert.equal(rect.top + rect.height / 2, viewport.height / 2);
  }
  assert.equal(margin, 12);
});

test("main-track controls have a fixed 120 pt gutter, with the whole rail masked from clips", () => {
  assert.equal(COMPACT.trackGutter, 120);
  assert.equal(inMainTrackControlGutter(0), true);
  assert.equal(inMainTrackControlGutter(119.99), true);
  assert.equal(inMainTrackControlGutter(120), false);
  assert.ok(COMPACT.trackGutter >= 2 * COMPACT.sideButton + spaceGap(), "Cover and Mute fit inside the fixed rail");
});

test("scrolled phone clips are clipped to the right of Cover while the playhead stays centred", () => {
  const width = 393, centre = width / 2, geometry = compactTrackGeometry(width, centre, 251.5, true);
  assert.deepEqual(geometry, { viewportLeft: 120, viewportWidth: 273, contentLeft: -175 });
  assert.equal(geometry.viewportLeft + geometry.contentLeft, centre - 251.5, "scrolling keeps the clip aligned to the centred playhead");
  assert.equal(geometry.viewportLeft, COMPACT.trackGutter, "the clipped lane begins after the fixed controls");
  assert.equal(centre, 196.5, "the playhead remains centred in the 393 pt screen");
});

function spaceGap() { return 4; }
