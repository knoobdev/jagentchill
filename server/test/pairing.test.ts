import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServerApp, type ServerApp } from "../src/app.ts";
import { DeviceSim } from "./device-sim.ts";

let dataDir: string;
let app: ServerApp;
let base: string;
let clock = Date.now();
const useRealClock = () => (clock = 0);
const now = () => (clock === 0 ? Date.now() : clock);

before(async () => {
  useRealClock();
  dataDir = mkdtempSync(join(tmpdir(), "jagentchill-server-"));
  app = createServerApp({ dataDir, now });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});
after(() => {
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const newOffer = (o?: Parameters<ServerApp["pairing"]["createOffer"]>[1]) =>
  app.pairing.createOffer([{ kind: "loopback", url: base.replace("http", "ws") + "/jagentchill/v1/ws" }], o);
let adminDevice: DeviceSim;
const codeFor = (requestId: string) => app.pairing.pending().find((r) => r.requestId === requestId)!.code;

async function pairDevice(name: string, o?: Parameters<ServerApp["pairing"]["createOffer"]>[1]) {
  const offer = newOffer(o);
  const device = new DeviceSim(base, name);
  const requestId = await device.enrolUntilProved(offer);
  const result = await device.verify(offer, requestId, codeFor(requestId));
  assert.equal(result.status, 200);
  return { offer, device, role: result.body.role as string };
}

test("host identity is stable, owner-only, and health reports its gatewayId", async () => {
  const health = await (await fetch(base + "/jagentchill/v1/health")).json() as any;
  assert.equal(health.gatewayId, app.host.gatewayId);
  assert.match(app.host.gatewayId, /^[0-9a-f]{32}$/);
  assert.equal(statSync(join(dataDir, "secrets", "GATEWAY_IDENTITY_KEY")).mode & 0o777, 0o600);
});

test("first device pairs as admin through the host display, then completes the signed channel handshake", async () => {
  const { offer, device, role } = await pairDevice("Admin laptop", { firstDeviceIsAdmin: true });
  assert.equal(role, "admin");
  adminDevice = device;
  const { ws, outcome, call } = device.connect(offer);
  const { ready } = await outcome;
  assert.ok(ready, "expected a ready frame");
  assert.equal(ready.gatewayOk, true, "the host signature must verify before the device proves itself");
  assert.equal(ready.role, "admin");
  assert.equal(ready.transport, "loopback");
  assert.equal(ready.scopes.length, 13);
  assert.ok(ready.scopes.every((scope: string) => scope.startsWith("jagentchill.")));
  const list = await call("jagentchill.device.list");
  assert.equal(list.ok, true);
  assert.equal(list.result.devices.length, 1);
  assert.equal(list.result.devices[0].deviceId, device.deviceId);
  ws.close();
});

test("a second device is announced with its code only to devices that manage devices, and gets the preset role", async () => {
  const { offer: editorOffer, device: editor } = await pairDevice("Editor tablet");
  const offer = newOffer();
  const adminConn = adminDevice.connect(offer);
  const editorConn = editor.connect(editorOffer);
  assert.ok((await adminConn.outcome).ready && (await editorConn.outcome).ready);
  const editorFrames: any[] = [];
  editorConn.ws.on("message", (data) => editorFrames.push(JSON.parse(data.toString())));

  const phone = new DeviceSim(base, "Phone");
  const requestId = await phone.enrolUntilProved(offer);
  let announced = await adminConn.next();
  while (announced.event !== "jagentchill.pairing.requested") announced = await adminConn.next();
  assert.equal(announced.t, "evt");
  assert.equal(announced.event, "jagentchill.pairing.requested");
  assert.equal(announced.stream, "pairing");
  assert.equal(announced.seq, 1);
  assert.equal(announced.payload.request.requestId, requestId);
  const pending = app.pairing.pending();
  assert.equal(pending.length, 1);
  assert.equal(announced.payload.code, pending[0].code);
  assert.match(pending[0].code, /^\d{6}$/);
  assert.equal(pending[0].deviceName, "Phone");
  assert.equal(pending[0].sourceAddress.includes("127.0.0.1"), true);
  const result = await phone.verify(offer, requestId, pending[0].code);
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "editor");
  assert.deepEqual(Object.keys(result.body).sort(), ["deviceToken", "gatewayName", "role"]);

  const { ws, outcome, call } = phone.connect(offer);
  const { ready } = await outcome;
  assert.equal(ready.role, "editor");
  assert.ok(!ready.scopes.includes("jagentchill.host.exec"));
  const denied = await call("jagentchill.device.list");
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "SCOPE_DENIED");
  assert.equal(denied.error.details.requiredScope, "jagentchill.devices.manage");
  let completed = await adminConn.next();
  while (completed.event !== "jagentchill.pairing.completed") completed = await adminConn.next();
  assert.deepEqual(editorFrames, [], "a device without jagentchill.devices.manage must see neither the request nor the code");
  ws.close();
  adminConn.ws.close();
  editorConn.ws.close();
});

test("verify without a signature is refused and counts no attempt", async () => {
  const offer = newOffer();
  const device = new DeviceSim(base);
  const requestId = await device.enrolUntilProved(offer);
  const unsigned = await device.verify(offer, requestId, codeFor(requestId), false);
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body.error.code, "SIGNATURE_MISSING");
  assert.equal(app.pairing.pending().length, 1);
  const signed = await device.verify(offer, requestId, codeFor(requestId));
  assert.equal(signed.status, 200);
});

test("five wrong codes lock the request; the right code is then refused", async () => {
  const offer = newOffer();
  const device = new DeviceSim(base);
  const requestId = await device.enrolUntilProved(offer);
  const right = codeFor(requestId);
  const wrong = right === "000000" ? "000001" : "000000";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = await device.verify(offer, requestId, wrong);
    assert.equal(result.body.error.code, "CODE_INVALID");
    assert.equal(result.body.error.details.attemptsRemaining, 5 - attempt);
  }
  assert.equal((await device.verify(offer, requestId, wrong)).body.error.code, "CODE_ATTEMPTS_EXCEEDED");
  assert.equal((await device.verify(offer, requestId, right)).body.error.code, "CODE_ATTEMPTS_EXCEEDED");
  assert.equal(app.devices.get(device.deviceId), undefined);
});

test("a superseded offer and a declined request end enrolment", async () => {
  const first = newOffer();
  const device = new DeviceSim(base);
  const requestId = await device.enrolUntilProved(first);
  newOffer();
  assert.equal((await device.verify(first, requestId, "123456")).body.error.code, "PAIRING_CANCELLED");
  await assert.rejects(() => device.enrolUntilProved(first), /challenge 410 OFFER_EXPIRED/);

  const second = newOffer();
  const other = new DeviceSim(base);
  const otherRequest = await other.enrolUntilProved(second);
  const code = codeFor(otherRequest);
  app.pairing.decline(otherRequest);
  assert.equal((await other.verify(second, otherRequest, code)).body.error.code, "PAIRING_CANCELLED");
});

test("a replayed signed request is refused, and so is one signed for another host", async () => {
  const offer = newOffer();
  const device = new DeviceSim(base);
  const requestId = await device.enrolUntilProved(offer);
  const target = `/jagentchill/v1/pair/status?requestId=${requestId}`;
  const headers = device.signedHeaders(offer.gatewayId, "GET", target, undefined);
  assert.equal((await fetch(base + target, { headers })).status, 200);
  const replay = await fetch(base + target, { headers });
  assert.equal(replay.status, 401);
  assert.equal(((await replay.json()) as any).error.code, "NONCE_REPLAYED");
  const foreign = await fetch(base + target, { headers: device.signedHeaders("0".repeat(32), "GET", target, undefined) });
  assert.equal(((await foreign.json()) as any).error.code, "SIGNATURE_INVALID");
  const stale = await fetch(base + target, { headers: device.signedHeaders(offer.gatewayId, "GET", target, undefined, { ts: Date.now() - 121_000 }) });
  assert.equal(((await stale.json()) as any).error.code, "CLOCK_SKEW");
});

test("channel handshake refuses a stolen token, a foreign token, a bare-nonce signature and a request before ready", async () => {
  const { offer, device } = await pairDevice("Victim");
  const thief = generateKeyPairSync("ed25519").privateKey;
  assert.deepEqual((await device.connect(offer, { signWith: thief }).outcome).close, { code: 4401, reason: "DEVICE_SIGNATURE_INVALID" });
  assert.deepEqual((await device.connect(offer, { signBareNonce: true }).outcome).close, { code: 4401, reason: "DEVICE_SIGNATURE_INVALID" });
  const { device: other } = await pairDevice("Other");
  assert.deepEqual((await device.connect(offer, { token: other.token }).outcome).close, { code: 4401, reason: "TOKEN_INVALID" });
  assert.deepEqual((await new DeviceSim(base).connect(offer).outcome).close, { code: 4401, reason: "DEVICE_UNKNOWN" });
  assert.equal((await device.connect(offer, { skipHandshake: true }).outcome).close?.code, 4401);
  const good = device.connect(offer);
  assert.ok((await good.outcome).ready);
  good.ws.close();
});

test("revocation closes the device's connections with 4403 and refuses it afterwards; the last admin cannot be revoked", async () => {
  const adminRecord = app.devices.list().find((d) => d.role === "admin")!;
  const { offer, device } = await pairDevice("To revoke");
  const session = device.connect(offer);
  assert.ok((await session.outcome).ready);
  app.methods.get("jagentchill.device.revoke")!.handle({ deviceId: device.deviceId }, { deviceId: adminRecord.deviceId } as any);
  assert.deepEqual(await session.closed, { code: 4403, reason: "DEVICE_REVOKED" });
  assert.deepEqual((await device.connect(offer).outcome).close, { code: 4403, reason: "DEVICE_REVOKED" });
  assert.throws(() => app.devices.revoke(adminRecord.deviceId, "test"), /last admin/i);
});

test("a token near expiry is rotated in ready and the old value dies 60 s after the new one is presented", async () => {
  const { offer, device } = await pairDevice("Rotating");
  const original = device.token!;
  clock = Date.now() + 24 * 86_400_000;
  try {
    const first = device.connect(offer);
    const { ready } = await first.outcome;
    assert.ok(ready.deviceToken, "expected a replacement token with fewer than 7 days left");
    assert.notEqual(device.token, original);
    first.ws.close();
    // The replacement was "lost": the old value still works and yields another replacement.
    const lost = device.connect(offer, { token: original });
    assert.ok((await lost.outcome).ready.deviceToken);
    lost.ws.close();
    const current = device.connect(offer);
    assert.ok((await current.outcome).ready);
    current.ws.close();
    clock += 61_000;
    assert.deepEqual((await device.connect(offer, { token: original }).outcome).close, { code: 4401, reason: "TOKEN_INVALID" });
  } finally {
    useRealClock();
  }
});
