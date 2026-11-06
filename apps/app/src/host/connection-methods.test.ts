import assert from "node:assert/strict";
import test from "node:test";
import { connectionMethods } from "./connection-methods.ts";

test("add-connection methods match the reference order and distinct descriptions", () => {
  const rows = connectionMethods(true);
  assert.deepEqual(rows.map(({ id }) => id), ["direct", "scan", "tailscale", "paste"]);
  assert.deepEqual(rows.map(({ description }) => description), [
    "Local network or VPN.",
    "Tailnet connection.",
    "Connect directly through your tailnet, then confirm with the 6-digit code.",
    "Tailnet connection.",
  ]);
  assert.equal(connectionMethods(false).length, 3);
});
