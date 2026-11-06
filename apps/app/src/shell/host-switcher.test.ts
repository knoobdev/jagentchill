import assert from "node:assert/strict";
import test from "node:test";
import type { HostRecord } from "@jagentchill/client";
import { hostRowStatus, hostSwitcherConnection, hostSwitcherDetail, uniqueHostRecords } from "./host-switcher.ts";

const local: HostRecord = {
  gatewayId: "local-host", gatewayName: "This Mac", origin: "http://127.0.0.1:18960", role: "admin",
  connections: [{ id: "local", kind: "local", origin: "http://127.0.0.1:18960" }], preferredConnectionId: "local",
} as HostRecord;

test("hosts switcher de-duplicates by gateway and replaces a sparse record with the connection record", () => {
  const sparse = { ...local, connections: [] } as HostRecord;
  const rows = uniqueHostRecords([sparse, local, { ...local, gatewayId: "remote", gatewayName: "Studio" }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.connections?.length, 1);
});

test("host switcher formats local and Tailscale connection labels without loopback addresses", () => {
  assert.deepEqual(hostSwitcherConnection(local, "loopback"), { type: "This computer", address: "This computer" });
  const tailnet = { ...local, origin: "http://100.90.0.4:18960", connections: [{ id: "ts", kind: "tailnet", origin: "http://100.90.0.4:18960", tailnetAddress: "studio.tail123.ts.net:18960" }] } as HostRecord;
  assert.deepEqual(hostSwitcherConnection(tailnet, "tailnet"), { type: "Tailscale", address: "studio.tail123.ts.net:18960" });
  const lan = { ...local, origin: "http://192.168.1.40:18960", connections: [{ id: "lan", kind: "direct", origin: "http://192.168.1.40:18960" }] } as HostRecord;
  assert.deepEqual(hostSwitcherConnection(lan, "lan"), { type: "Local network", address: "192.168.1.40:18960" });
  assert.deepEqual(hostSwitcherConnection({ ...local, connections: [] } as HostRecord), { type: "This computer", address: "This computer" });
});

test("home host pill does not repeat the local connection label", () => {
  const identity = (label: string) => label;
  assert.equal(hostSwitcherDetail(hostSwitcherConnection(local, "loopback"), identity), "This computer");
  const tailnet = { ...local, origin: "http://100.90.0.4:18960", connections: [{ id: "ts", kind: "tailnet", origin: "http://100.90.0.4:18960", tailnetAddress: "studio.tail123.ts.net:18960" }] } as HostRecord;
  assert.equal(hostSwitcherDetail(hostSwitcherConnection(tailnet, "tailnet"), identity), "Tailscale · studio.tail123.ts.net:18960");
});

test("host rows show the connection state in words", () => {
  assert.equal(hostRowStatus(true, "connected"), "Connected");
  assert.equal(hostRowStatus(true, "connecting"), "Connecting…");
  assert.equal(hostRowStatus(true, "unavailable"), "Host unavailable");
  // A host that is not the active one was not tried: it is "not in use", never "unavailable".
  assert.equal(hostRowStatus(false, "connected"), "Not in use");
  assert.equal(hostRowStatus(true, "local"), "Not in use");
});
