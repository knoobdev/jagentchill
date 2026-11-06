import assert from "node:assert/strict";
import test from "node:test";
import { globalSearchViewport, mobileHomeMustConnect, notificationRowLayout, projectCardLayout, projectPlaceholderInitial } from "./mobile-layout.ts";
import { compactSettingRowStacks, homeScrollBottomPadding } from "../../../../packages/ui/src/compact.ts";

const iphone15 = { width: 393, height: 852, insetTop: 59, insetBottom: 34, keyboard: 336 } as const;

test("global search keeps a full-width compact surface and keyboard-safe viewport", () => {
  assert.deepEqual(globalSearchViewport(iphone15), { surfaceWidth: 393, usableHeight: 423, touchTarget: 44 });
});

test("notification rows keep 44 pt action targets at a compact width", () => {
  assert.deepEqual(notificationRowLayout(iphone15), { contentWidth: 361, minRowHeight: 44, actionTarget: 44, usableHeight: 423 });
});

test("phone project cards fit two columns and use distinct initials when there is no cover", () => {
  assert.deepEqual(projectCardLayout(iphone15), { cardWidth: 174.5, rowWidth: 361, actionTarget: 44 });
  assert.equal(projectPlaceholderInitial("  B-roll  "), "B");
  assert.equal(projectPlaceholderInitial(""), "?");
});

test("phone Home reserves the dock plus safe area and redirects after the last host is removed", () => {
  assert.equal(homeScrollBottomPadding(69, iphone15.insetBottom), 103);
  assert.equal(mobileHomeMustConnect(true, true, 0), true);
  assert.equal(mobileHomeMustConnect(true, false, 0), false);
  assert.equal(mobileHomeMustConnect(true, true, 1), false);
  assert.equal(mobileHomeMustConnect(false, true, 0), false);
});

test("personal settings controls stack below labels at 393 pt and wide settings stay inline", () => {
  assert.equal(compactSettingRowStacks(393, true, true), true);
  assert.equal(compactSettingRowStacks(393, true, false), false);
  assert.equal(compactSettingRowStacks(600, true, true), false);
  assert.equal(compactSettingRowStacks(393, false, true), false);
});
