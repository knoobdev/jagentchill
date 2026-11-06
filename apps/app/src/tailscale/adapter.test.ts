import assert from "node:assert/strict";
import test from "node:test";
import { NativeTailscaleAdapter, type JAgentChillTailscaleNativeModule } from "./adapter.ts";
import { hostThroughNativeTailnetProxy } from "./host-route.ts";

test("native adapter reports missing bridge unavailable and fails closed", async () => {
  const adapter = new NativeTailscaleAdapter("ios", null);
  assert.equal(adapter.isSupported, false);
  assert.equal(await adapter.getStatus(), "unavailable");
  assert.equal((await adapter.loginWithAuthKey("key")).ok, false);
  assert.equal(adapter.getProxyAddress("host:55750"), null);
});

test("auth key is passed trimmed to native without adapter persistence and proxy/signing are exposed", async () => {
  let passedKey = "";
  const fake: JAgentChillTailscaleNativeModule = {
    getStatus: async () => "connected",
    beginInteractiveLogin: () => ({ ok: true }),
    startInteractiveLogin: async () => ({ ok: true }),
    loginWithAuthKey: async (key) => { passedKey = key; return { ok: true }; },
    getDevicePublicKeyB64: () => "public-key",
    signNonce: (nonce) => `sig:${nonce}`,
    getProxyAddress: (target) => `127.0.0.1:43210:${target}`,
  };
  const adapter = new NativeTailscaleAdapter("android", fake);
  assert.equal(await adapter.getStatus(), "connected");
  assert.deepEqual(await adapter.loginWithAuthKey("  ephemeral  "), { ok: true });
  assert.equal(passedKey, "ephemeral");
  assert.equal(adapter.getProxyAddress("host:55750"), "127.0.0.1:43210:host:55750");
  assert.equal(await adapter.getDeviceSigningMaterial()?.signNonce("n"), "sig:n");
});

test("auth key is not submitted when empty", async () => {
  let calls = 0;
  const fake = { getStatus: async () => "needs-login", startInteractiveLogin: async () => ({ ok: true }), loginWithAuthKey: async () => { calls++; return { ok: true }; } } as JAgentChillTailscaleNativeModule;
  const adapter = new NativeTailscaleAdapter("ios", fake);
  assert.deepEqual(await adapter.loginWithAuthKey(" \n "), { ok: false, error: "An auth key is required." });
  assert.equal(calls, 0);
});

test("saved tailnet host reconnect uses the loopback proxy and retains its stored endpoint", () => {
  let target = "";
  const adapter = new NativeTailscaleAdapter("ios", {
    getStatus: async () => "connected",
    startInteractiveLogin: async () => ({ ok: true }),
    loginWithAuthKey: async () => ({ ok: true }),
    getProxyAddress: (address) => { target = address; return "127.0.0.1:43127"; },
  });
  const host = {
    gatewayId: "gateway", gatewayPublicKey: "public", gatewayName: "Fixture", origin: "http://host.tailnet.ts.net:55750",
    connections: [{ id: "tailnet:host.tailnet.ts.net:55750", kind: "tailnet" as const, origin: "http://host.tailnet.ts.net:55750", tailnetAddress: "host.tailnet.ts.net:55750" }],
    preferredConnectionId: "tailnet:host.tailnet.ts.net:55750", role: "viewer" as const,
    deviceToken: { value: "fixture", expires_ms: 1 }, verifiedClockOffset_ms: 0,
  };
  const routed = hostThroughNativeTailnetProxy(host, adapter);
  assert.equal(target, "host.tailnet.ts.net:55750");
  assert.equal(routed.origin, "http://127.0.0.1:43127");
  assert.equal(host.connections[0].origin, "http://host.tailnet.ts.net:55750");
});
