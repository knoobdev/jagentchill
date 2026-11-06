import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { test } from "node:test";
import { CONNECT_CONTEXT, PROTOCOL_VERSION, bytesToBase64Url, handshakeTranscript } from "@jagentchill/protocol";
import { connectHostWithFallback, type ConnectOptions } from "../src/connection.ts";
import type { HostRecord } from "../src/pairing.ts";

test("a stalled preferred route times out and a retryable route failure falls back to the next saved address", async () => {
  const gateway = generateKeyPairSync("ed25519");
  const rawGatewayKey = createRawPublic(gateway.publicKey);
  const gatewayId = "1".repeat(32);
  const signer = {
    deviceId: "test-device", devicePublicKey: Buffer.alloc(32, 7).toString("base64url"),
    signHandshake: async () => "device-signature", signRequest: async () => "device-signature",
  } as unknown as ConnectOptions["signer"];
  const host: HostRecord = {
    gatewayId, gatewayPublicKey: rawGatewayKey.toString("base64url"), gatewayName: "Fixture host", origin: "http://tailnet.invalid:1",
    connections: [
      { id: "tailnet", kind: "tailnet", origin: "http://tailnet.invalid:1", tailnetAddress: "tailnet.invalid:1" },
      { id: "local", kind: "local", origin: "http://127.0.0.1:2" },
    ], preferredConnectionId: "tailnet", role: "admin", deviceToken: { value: "token", expires_ms: Date.now() + 60_000 }, verifiedClockOffset_ms: 0,
  };
  let instances = 0, closedFirst = 0, earlyCloseNotifications = 0;
  class RouteSocket {
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    readyState = 0;
    private readonly attempt = ++instances;
    constructor() {
      if (this.attempt > 1) queueMicrotask(() => { this.readyState = 1; this.onopen?.(new Event("open")); });
    }
    send(text: string) {
      if (this.attempt === 1) return;
      const frame = JSON.parse(text);
      if (frame.t === "hello") {
        const gatewayNonce = bytesToBase64Url(Buffer.alloc(32, 8));
        const fields = { context: CONNECT_CONTEXT, gatewayNonce, deviceNonce: frame.deviceNonce, ts: Date.now(), gatewayId, protocolVersion: PROTOCOL_VERSION };
        const transcript = handshakeTranscript({ ...fields, role: "gateway", deviceId: signer.deviceId, devicePublicKey: signer.devicePublicKey });
        const gatewaySignature = sign(null, Buffer.from(transcript, "utf8"), gateway.privateKey).toString("base64url");
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ t: "challenge", ...fields, gatewaySignature }) } as MessageEvent));
      } else if (frame.t === "prove") {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ t: "ready", connId: "fixture-connection", role: "admin", scopes: [], features: {}, serverTime_ms: Date.now(), transport: "loopback", resumed: true }) } as MessageEvent));
      }
    }
    close() {
      this.readyState = 3;
      if (this.attempt === 1) closedFirst++;
      queueMicrotask(() => this.onclose?.({ code: 1006, reason: "" } as CloseEvent));
    }
  }
  const first: ConnectOptions = {
    host, signer, clientInstanceId: "fixture", WebSocketImpl: RouteSocket as unknown as typeof WebSocket, connectionTimeoutMs: 10,
    onTokenRotated() {}, onClose() { earlyCloseNotifications++; },
  };
  const second: ConnectOptions = { ...first, host: { ...host, origin: "http://127.0.0.1:2", preferredConnectionId: "local" }, connectionTimeoutMs: 1_000 };
  const connection = await connectHostWithFallback([first, second]);
  assert.equal(connection.ready.connId, "fixture-connection");
  assert.equal(instances, 2);
  assert.equal(closedFirst, 1);
  assert.equal(earlyCloseNotifications, 0);
  connection.close();
});

function createRawPublic(key: KeyObject): Buffer {
  const der = key.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}
