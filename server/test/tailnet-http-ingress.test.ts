import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { PairingOffer } from "@jagentchill/protocol";
import { createServerApp } from "../src/app.ts";
import { createTailnetListener } from "../src/tailnet/listener.ts";
import { DeviceSim } from "./device-sim.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
// A directory of its own for each run (named by the runner, or a fresh one this run makes and removes).
const ownDataDir = !process.env.JAGENTCHILL_TEST_DATA_DIR;
const dataDir = process.env.JAGENTCHILL_TEST_DATA_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_DATA_DIR) : join(repoRoot, `.dev/run-w8m-show-connection-${process.pid}-${Date.now()}`);
const serverPort = Number(process.env.JAGENTCHILL_PORT ?? 18955);
const gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT ?? serverPort + 1);
const forwardPort = Number(process.env.JAGENTCHILL_TEST_FORWARD_PORT ?? serverPort + 2);
const fakeBridge = new URL("./fixtures/fake-tsnet-bridge.mjs", import.meta.url).pathname;

test("a new device pairs and uses signed HTTP through tailnet ingress, with loopback privileges refused", async () => {
  if (existsSync(dataDir)) throw new Error(`Refusing to reuse test data directory: ${dataDir}`);
  mkdirSync(dataDir, { recursive: true });
  const tailnet = createTailnetListener({
    port: serverPort,
    stateDir: join(dataDir, "tailscale"),
    bridgeBinary: process.execPath,
    bridgeArgs: [fakeBridge],
    fakeBridgeEnv: { FAKE_TSNET_MODE: "ready", FAKE_TSNET_FORWARD_PORT: String(forwardPort), FAKE_TSNET_DELAY_MS: "20" },
    handleHttp: (request, response) => app.handleTailnetHttp(request, response),
    attachSocket: (socket, transport) => app.channel.attachExternalSocket(socket, transport),
  });
  const app = createServerApp({
    dataDir,
    tailnet,
    localAdminToken: "test-local-admin-token",
    hostPlatform: { platform: process.platform, env: { PATH: "", HOME: dataDir } },
    runCommand: async () => ({ code: 1, stdout: "", stderr: "not installed", timedOut: false }),
    usageAccount: { readClaudeCredentials: async () => null, readCodexCredentials: async () => null, fetch: async () => { throw new Error("unexpected usage request"); } },
    http: async () => { throw new Error("unexpected outbound request"); },
  });
  try {
    assert.equal(gatewayPort, serverPort + 1, "the isolated test receives the required server/gateway port pair");
    await new Promise<void>((resolveListen, reject) => {
      app.http.once("error", reject);
      app.http.listen(serverPort, "127.0.0.1", () => { app.http.off("error", reject); resolveListen(); });
    });
    await tailnet.startInteractiveLogin();
    const deadline = Date.now() + 3_000;
    while (!tailnet.status().connected && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    assert.equal(tailnet.status().connected, true);

    const base = `http://127.0.0.1:${forwardPort}`;
    const health = await fetch(`${base}/jagentchill/v1/health`);
    assert.equal(health.status, 200, `private ingress health response was ${health.status}: ${await health.text()}`);
    const offer: PairingOffer = app.pairing.createOffer([
      { kind: "tailnet", url: "ws://127.0.0.1:18952/jagentchill/v1/ws" },
    ], { firstDeviceIsAdmin: true });
    const device = new DeviceSim(base, "Tailnet phone");
    let pairingCode = "";
    app.pairing.listen({ requested: (_entry, code) => { pairingCode = code; } });
    const requestId = await device.enrolUntilProved(offer);
    const request = app.pairing.pending().find((entry) => entry.requestId === requestId)!;
    assert.equal(request.transport, "tailnet");
    assert.match(request.sourceAddress, /127\.0\.0\.1/);
    assert.ok(request);
    const verified = await device.verify(offer, requestId, pairingCode);
    assert.equal(verified.status, 200);
    const { ws, outcome, call, next } = device.connect(offer);
    const connected = await outcome;
    assert.ok(connected.ready, `tailnet websocket closed before hello completed: ${JSON.stringify(connected.close)}`);
    assert.equal(connected.ready.transport, "tailnet");
    const readPresence = async (deviceId: string) => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const frame = await Promise.race([next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("presence update timed out")), Math.max(1, deadline - Date.now())))]);
        if (frame.event === "jagentchill.device.presence.changed" && frame.payload?.deviceId === deviceId) return frame.payload;
      }
      throw new Error("presence update timed out");
    };
    const adminOnline = await readPresence(device.deviceId);
    assert.equal(adminOnline.online, true, "the connected device receives its live online update");
    const deviceList = await call("jagentchill.device.list");
    assert.equal(deviceList.ok, true, `signed WebSocket RPC over tailnet failed: ${JSON.stringify(deviceList)}`);
    assert.equal(deviceList.result.devices.find((entry: { deviceId: string }) => entry.deviceId === device.deviceId)?.lastTransport, "tailnet", "device.list exposes the authenticated tailnet path after pairing");

    const secretPath = "/jagentchill/v1/secrets/TAILNET_REGRESSION";
    const secretBody = "fixture-secret-value";
    const secretHeaders = device.signedHeaders(app.host.gatewayId, "PUT", secretPath, secretBody);
    const secretPut = await fetch(base + secretPath, { method: "PUT", headers: { ...secretHeaders, "content-type": "text/plain" }, body: secretBody });
    assert.equal(secretPut.status, 200, `signed HTTP route must use the regular device authenticator over tailnet: ${await secretPut.text()}`);

    const localAdminPath = "/jagentchill/v1/local-admin/devices/add-admin";
    const localAdminBody = JSON.stringify({ publicKey: device.devicePublicKey, localSupervisor: true });
    const localAdmin = await fetch(base + localAdminPath, { method: "POST", headers: { authorization: "Bearer test-local-admin-token", "content-type": "application/json" }, body: localAdminBody });
    assert.equal(localAdmin.status, 404, "a tailnet peer must not inherit the loopback-only local-admin privilege");

    const secondOffer = app.pairing.createOffer([{ kind: "tailnet", url: "ws://127.0.0.1:18952/jagentchill/v1/ws" }]);
    const secondDevice = new DeviceSim(base, "Tailnet phone two");
    let secondCode = "";
    app.pairing.listen({ requested: (_entry, code) => { secondCode = code; } });
    const secondRequestId = await secondDevice.enrolUntilProved(secondOffer);
    assert.equal((await secondDevice.verify(secondOffer, secondRequestId, secondCode)).status, 200);
    const second = secondDevice.connect(secondOffer);
    assert.ok((await second.outcome).ready, "the second tailnet device completes the signed hello");
    assert.equal((await readPresence(secondDevice.deviceId)).online, true, "admin receives online without polling");
    second.ws.close();
    assert.equal((await readPresence(secondDevice.deviceId)).online, false, "admin receives offline without polling");
    const afterClose = await call("jagentchill.device.list");
    const offline = afterClose.result.devices.find((entry: { deviceId: string }) => entry.deviceId === secondDevice.deviceId);
    assert.equal(offline.online, false);
    assert.equal(offline.lastTransport, "tailnet", "offline device retains the last authenticated path");
    ws.close();
  } finally {
    await tailnet.stop();
    app.close();
    await new Promise<void>((resolveClose) => { if (!app.http.listening) return resolveClose(); app.http.close(() => resolveClose()); });
    if (ownDataDir) rmSync(dataDir, { recursive: true, force: true });
  }
});
