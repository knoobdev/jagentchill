import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeDeviceDisplayName } from "./device-name.ts";

test("native pairing defaults to the platform device name and then model", () => {
  assert.equal(nativeDeviceDisplayName("ios", "Ngoc’s iPhone", "iPhone 16 Pro"), "Ngoc’s iPhone");
  assert.equal(nativeDeviceDisplayName("ios", " ", "iPhone 16 Pro"), "iPhone 16 Pro");
  assert.equal(nativeDeviceDisplayName("android", null, null), "Android device");
});
