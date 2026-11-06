import assert from "node:assert/strict";
import test from "node:test";
import { screenScaffoldMetrics, statusBarStyle } from "./safeArea.ts";

test("compact screen scaffold reserves the iPhone 15 safe areas", () => {
  assert.deepEqual(screenScaffoldMetrics({ top: 59, bottom: 34 }, true, 56), {
    headerHeight: 116, headerPaddingTop: 60, barHeight: 56, contentPaddingBottom: 34,
  });
});

test("wide and web screen geometry remains zero inset", () => {
  assert.deepEqual(screenScaffoldMetrics({ top: 59, bottom: 34 }, false, 48), {
    headerHeight: 48, headerPaddingTop: 0, barHeight: 48, contentPaddingBottom: 0,
  });
  assert.deepEqual(screenScaffoldMetrics({ top: 0, bottom: 0 }, true, 56), {
    headerHeight: 56, headerPaddingTop: 0, barHeight: 56, contentPaddingBottom: 0,
  });
});

test("status bar foreground follows the active surface theme", () => {
  assert.equal(statusBarStyle("light"), "dark");
  assert.equal(statusBarStyle("dark"), "light");
});
