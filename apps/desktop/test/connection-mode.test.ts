import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionModeAction, shouldStartBundledHost } from "../src/connection-mode.ts";

test("the bundled host stays stopped until Local or Tailscale is selected", () => {
  assert.equal(shouldStartBundledHost(null), false);
  assert.equal(shouldStartBundledHost(undefined), false);
  assert.equal(shouldStartBundledHost("local"), true);
  assert.equal(shouldStartBundledHost("tailscale"), true);
});

test("the first saved mode starts the host and later mode changes restart its listener policy", () => {
  assert.equal(connectionModeAction(null, "local"), "start");
  assert.equal(connectionModeAction(null, "tailscale"), "start");
  assert.equal(connectionModeAction("local", "tailscale"), "restart");
  assert.equal(connectionModeAction("tailscale", "local"), "restart");
  assert.equal(connectionModeAction("local", "local"), "none");
  assert.equal(connectionModeAction("tailscale", null), "stop");
  assert.equal(connectionModeAction("local", null), "stop");
  assert.equal(connectionModeAction(null, null), "none");
});
