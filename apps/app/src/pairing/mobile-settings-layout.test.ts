import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_ROLE_OPTIONS, deviceRowsLayout, hostSpaceControlsLayout, pairedHostLayout, providerCatalogLayout, settingsViewportHeight, stacksSettingsRows } from "./mobile-settings-layout.ts";

test("393×852 settings stack device cards and leave the safe-area-adjusted viewport above the keyboard", () => {
  // Mirrors the requested iPhone 15 window and the safe-area/keyboard insets supplied by the simulator turn.
  const window = { width: 393, height: 852, topInset: 59, bottomInset: 34, keyboardHeight: 336 };
  assert.equal(pairedHostLayout(window.width), "stacked");
  assert.equal(deviceRowsLayout(window.width), "stacked");
  assert.equal(stacksSettingsRows(window.width), true);
  assert.equal(settingsViewportHeight(window), 423);
  assert.equal(pairedHostLayout(600), "inline");
  assert.equal(deviceRowsLayout(600), "table");
  assert.equal(stacksSettingsRows(600), false);
  assert.equal(providerCatalogLayout(window.width), "stacked");
  assert.equal(hostSpaceControlsLayout(window.width), "stacked");
  assert.equal(providerCatalogLayout(600), "inline");
  assert.equal(hostSpaceControlsLayout(600), "inline");
  assert.deepEqual(DEVICE_ROLE_OPTIONS.map((option) => option.label), ["Admin", "Editor", "Viewer"]);
});
