import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CONNECT_CONTEXT, TAILNET_METHODS, decodeOffer, handshakeTranscript, type TailnetStatus } from "@jagentchill/protocol";
import { createServerApp } from "../src/app.ts";
import type { TailnetListener } from "../src/tailnet/listener.ts";
import type { Connection } from "../src/channel/ws-channel.ts";
import { DeviceSim } from "./device-sim.ts";
import { EventEmitter } from "node:events";

const dataDirs: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-tailnet-methods-"));
  dataDirs.push(dir);
  return dir;
};
after(() => { for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true }); });

test("tailnet host methods expose status, subscribe to updates, and stay admin-only", async () => {
  const appDataDir = dataDir();
  let status: TailnetStatus = { connected: false, host: null, loginUrl: null, port: null, enabled: false, updatedAt: 100 };
  const subscribers = new Set<(value: TailnetStatus) => void>();
  let joinedKey: string | null = null;
  let directBindAddress = "127.0.0.1";
  const tailnet = {
    status: () => status,
    proxyCredentials: () => ({ port: 43111, secret: "0123456789abcdef0123456789abcdef" }),
    subscribe: (listener: (value: TailnetStatus) => void) => { subscribers.add(listener); return () => subscribers.delete(listener); },
    startInteractiveLogin: async () => { status = { ...status, enabled: true, loginUrl: "https://login.tailscale.com/a/test", updatedAt: 101 }; subscribers.forEach((notify) => notify(status)); return status; },
    joinWithAuthKey: async (authKey: string) => { joinedKey = authKey; status = { ...status, enabled: true, updatedAt: 102 }; return status; },
    setEnabled: async (enabled: boolean) => { status = { ...status, enabled, connected: false, host: null, port: null, updatedAt: 103 }; return status; },
    restart: async () => status,
    resume: async () => status,
    stop: async () => undefined,
  } satisfies TailnetListener;
  const app = createServerApp({
    dataDir: appDataDir,
    tailnet,
    directListenPort: 18950,
    rebindDirectListener: async (address) => { directBindAddress = address; },
    hostPlatform: { platform: process.platform, env: { PATH: "", HOME: tmpdir() } },
    runCommand: async () => ({ code: 1, stdout: "", stderr: "not installed", timedOut: false }),
    usageAccount: { readClaudeCredentials: async () => null, readCodexCredentials: async () => null, fetch: async () => { throw new Error("unexpected usage request"); } },
    http: async () => { throw new Error("unexpected outbound request"); },
  });
  const events: unknown[] = [];
  const admin = { deviceId: "tailnet-test-admin", role: () => "admin", transport: "loopback", send: (_event: string, _stream: string, payload: unknown) => events.push(payload) } as unknown as Connection;
  const viewer = { role: () => "viewer" } as unknown as Connection;
  const get = app.methods.get(TAILNET_METHODS.statusGet)!;
  try {
    assert.equal(get.scope, "jagentchill.devices.manage");
    assert.deepEqual(await get.handle({}, admin), status);
    await assert.rejects(async () => await get.handle({}, viewer), (error: any) => error.code === "PERMISSION_DENIED");
    assert.deepEqual(await app.methods.get(TAILNET_METHODS.proxyCredentials)!.handle({}, admin), { port: 43111, secret: "0123456789abcdef0123456789abcdef" });
    await assert.rejects(async () => await app.methods.get(TAILNET_METHODS.proxyCredentials)!.handle({}, { ...admin, transport: "tailnet" }), (error: any) => error.code === "PERMISSION_DENIED");

    const subscribed = await app.methods.get(TAILNET_METHODS.statusSubscribe)!.handle({}, admin) as { status: TailnetStatus };
    assert.deepEqual(subscribed.status, status);
    await app.methods.get(TAILNET_METHODS.loginStart)!.handle({}, admin);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], status);

    await app.methods.get(TAILNET_METHODS.authKeyJoin)!.handle({ authKey: "tskey-auth-test" }, admin);
    assert.equal(joinedKey, "tskey-auth-test");
    await app.methods.get(TAILNET_METHODS.disable)!.handle({}, admin);
    assert.equal(status.enabled, false);

    status = { connected: true, host: "host.example.ts.net", loginUrl: null, port: 18950, enabled: true, updatedAt: 104 };
    const host = await app.methods.get("jagentchill.settings.host.get")!.handle({}, admin) as any;
    assert.deepEqual(host.network.tailnet, { enabled: true, available: true });
    const offerResponse = await app.methods.get("jagentchill.pairing.offer.create")!.handle({ role: "editor" }, admin) as { url: string };
    const decoded = decodeOffer(offerResponse.url);
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      // On the tailnet, an offer names the tailnet address alone: a loopback address is of no use to a phone.
      assert.deepEqual(decoded.offer.addresses, [{ kind: "tailnet", url: "ws://host.example.ts.net:18950/jagentchill/v1/ws" }]);
    }

    const directSet = app.methods.get("jagentchill.directConnection.status.set")!;
    assert.equal(directSet.scope, "jagentchill.devices.manage");
    const direct = await directSet.handle({ enabled: true, address: "0.0.0.0", password: "second-factor-secret" }, admin) as any;
    assert.deepEqual(direct, { enabled: true, address: "0.0.0.0", port: 18950, passwordEnabled: true });
    assert.equal(directBindAddress, "0.0.0.0");
    const lanHost = await app.methods.get("jagentchill.settings.host.get")!.handle({}, admin) as any;
    assert.deepEqual(lanHost.network.lan, { enabled: true, available: true });
    const storedConfig = await (await import("node:fs/promises")).readFile(join(appDataDir, "config.json"), "utf8");
    assert.equal(storedConfig.includes("second-factor-secret"), false);
    assert.match(storedConfig, /scrypt\$/);
    const disabled = await directSet.handle({ enabled: false, password: null }, admin) as any;
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.passwordEnabled, false);
    assert.equal(directBindAddress, "127.0.0.1");
  } finally { app.close(); }
});

test("a socket attached by tailnet ingress uses the regular signed device handshake", () => {
  class FakeWebSocket extends EventEmitter {
    readonly sent: any[] = [];
    readonly closed: Array<{ code?: number; reason?: string }> = [];
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close(code?: number, reason?: string) { this.closed.push({ code, reason }); this.emit("close"); }
    terminate() { this.emit("close"); }
  }
  const tailnetDataDir = dataDir();
  const app = createServerApp({
    dataDir: join(tailnetDataDir, "server-data"),
    hostPlatform: { platform: process.platform, env: { PATH: "", HOME: tailnetDataDir } },
    runCommand: async () => ({ code: 1, stdout: "", stderr: "not installed", timedOut: false }),
    usageAccount: { readClaudeCredentials: async () => null, readCodexCredentials: async () => null, fetch: async () => { throw new Error("unexpected usage request"); } },
    http: async () => { throw new Error("unexpected outbound request"); },
  });
  try {
    const sim = new DeviceSim("http://127.0.0.1", "Tailnet test device");
    const { token } = app.devices.pair({ deviceId: sim.deviceId, devicePublicKey: sim.devicePublicKey, name: sim.name, platform: "ios", role: "admin", keyProtection: "keychain", localSupervisor: false, pairedBy: "test" });
    const socket = new FakeWebSocket();
    app.channel.attachExternalSocket(socket as any, "tailnet");
    const deviceNonce = Buffer.alloc(32, 9).toString("base64url");
    socket.emit("message", Buffer.from(JSON.stringify({ t: "hello", deviceId: sim.deviceId, deviceNonce, protocolVersion: 1, minProtocolVersion: 1, capabilities: [], clientInstanceId: "tailnet-test" })), false);
    const challenge = socket.sent.at(-1);
    assert.equal(challenge.t, "challenge");
    const text = handshakeTranscript({ role: "device", context: CONNECT_CONTEXT, gatewayNonce: challenge.gatewayNonce, deviceNonce, ts: challenge.ts, gatewayId: app.host.gatewayId, deviceId: sim.deviceId, devicePublicKey: sim.devicePublicKey, protocolVersion: 1 });
    socket.emit("message", Buffer.from(JSON.stringify({ t: "prove", signature: sim.sign(text), deviceToken: token.value })), false);
    const ready = socket.sent.findLast((frame) => frame.t === "ready");
    assert.ok(ready, "the signed device handshake reaches the ready frame");
    assert.equal(ready.transport, "tailnet");

    const rejectedSocket = new FakeWebSocket();
    app.channel.attachExternalSocket(rejectedSocket as any, "tailnet");
    rejectedSocket.emit("message", Buffer.from(JSON.stringify({ t: "hello", deviceId: sim.deviceId, deviceNonce, protocolVersion: 1, minProtocolVersion: 1, capabilities: [], clientInstanceId: "tailnet-bad-signature" })), false);
    const badChallenge = rejectedSocket.sent.at(-1);
    rejectedSocket.emit("message", Buffer.from(JSON.stringify({ t: "prove", signature: "bad-signature", deviceToken: token.value })), false);
    assert.equal(rejectedSocket.closed.length, 1);
    assert.equal(rejectedSocket.closed[0].reason, "DEVICE_SIGNATURE_INVALID");
    assert.equal(app.channel.connectionCount(), 1);

    const pendingLanSocket = new FakeWebSocket();
    app.channel.attachExternalSocket(pendingLanSocket as any, "lan");
    app.channel.closeTransport("lan", 4401, "DIRECT_LISTENER_CHANGED");
    assert.equal(pendingLanSocket.closed[0].reason, "DIRECT_LISTENER_CHANGED");
  } finally { app.close(); }
});
