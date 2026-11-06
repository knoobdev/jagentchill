import assert from "node:assert/strict";
import { test } from "node:test";
import { refusesUnattendedDefaultProfile } from "../src/profile-guard.ts";

test("unattended Electron entries reject the default user profile and allow isolated profiles", () => {
  const defaultUserData = "/tmp/jc-test-home/Library/Application Support/JAgentChill";
  assert.equal(refusesUnattendedDefaultProfile({ unattended: true, userData: defaultUserData, defaultUserData }), true);
  assert.equal(refusesUnattendedDefaultProfile({ unattended: true, userData: `${defaultUserData}/render-host`, defaultUserData }), false);
  assert.equal(refusesUnattendedDefaultProfile({ unattended: false, userData: defaultUserData, defaultUserData }), false);
  assert.equal(refusesUnattendedDefaultProfile({ unattended: true, userData: `${defaultUserData}/../JAgentChill`, defaultUserData }), true);
});
