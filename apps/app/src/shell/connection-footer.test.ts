import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionFooterParts } from "./connection-footer.ts";

test("desktop footer reports the authenticated session state separately from tailnet reachability", () => {
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", builtInHost: true, tailnetConnected: true, transport: "loopback", statusLabel: "Connected" }), { state: "Connected", path: "This computer (Tailscale on)" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", builtInHost: true, tailnetConnected: true, transport: "loopback", statusLabel: "Connecting…" }), { state: "Connecting…", path: "This computer (Tailscale on)" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", builtInHost: true, tailnetConnected: true, transport: "loopback", statusLabel: "Host unavailable" }), { state: "Host unavailable", path: "This computer (Tailscale on)" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", builtInHost: true, tailnetConnected: false, transport: "loopback", statusLabel: "Connected" }), { state: "Connected", path: "This computer (Tailscale needs sign-in)" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", tailnetConnected: true, transport: "tailnet", statusLabel: "Connecting…" }), { state: "Connecting…", path: "Tailscale" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", tailnetConnected: true, preferredKind: "tailnet", transport: "loopback", statusLabel: "Connected" }), { state: "Connected", path: "Tailscale" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "local", tailnetConnected: false, preferredKind: "tailnet", transport: "loopback", statusLabel: "Connected" }), { state: "Connected", path: "Local" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "tailscale", tailnetConnected: true, preferredKind: "tailnet", transport: "lan", statusLabel: "Connected" }), { state: "Connected", path: "Local network" });
  assert.deepEqual(connectionFooterParts({ desktopMode: "local", tailnetConnected: false, transport: "loopback", statusLabel: "Connected" }), { state: "Connected", path: "Local" });
});
