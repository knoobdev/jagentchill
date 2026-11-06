import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceConnectionPath } from "./connection-path.ts";

test("pairing path uses the authenticated ingress transport, never its loopback forwarding address", () => {
  assert.equal(deviceConnectionPath("tailnet"), "Tailscale");
  assert.equal(deviceConnectionPath("loopback"), "Local");
  assert.equal(deviceConnectionPath("lan"), "Local network");
  assert.equal(deviceConnectionPath(null), "Unknown");
});
