import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInConnectionRows, canRemoveBuiltInConnection } from "./host-connection-rows.ts";

test("bundled host connections reflect live Tailscale and replace stale saved addresses", () => {
  const rows = builtInConnectionRows({ gatewayId: "gw_test", localOrigin: "http://127.0.0.1:19100", port: 19100, mode: "tailscale", tailnet: { connected: true, host: "new-name.ts.net", port: 19100 } });
  assert.deepEqual(rows.map((row) => row.kind), ["local", "tailnet"]);
  assert.equal(rows[1]?.tailnetAddress, "new-name.ts.net:19100");
  assert.equal(rows.some((row) => row.tailnetAddress?.includes("old-name")), false);
});

test("built-in Local is removable only when it is the last connection", () => {
  assert.equal(canRemoveBuiltInConnection("local", 2), false);
  assert.equal(canRemoveBuiltInConnection("local", 1), true);
  assert.equal(canRemoveBuiltInConnection("tailnet", 2), true);
});
