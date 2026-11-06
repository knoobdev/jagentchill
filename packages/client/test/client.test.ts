// Runs the client SDK against a real JAgentChill Server app (no Gateway child; agent calls are not exercised here).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { decodeOffer, encodeOfferUrl } from "@jagentchill/protocol";
import { createServerApp, type ServerApp } from "@jagentchill/server/src/app.ts";
import {
  HostError, beginEnrolment, connectHost, createWebCryptoSigner, deleteHostSecret, generateDeviceKey, listHostSecrets, originOfAddress, putHostSecret,
  type HostRecord,
} from "../src/index.ts";

let dataDir: string;
let app: ServerApp;
let wsUrl: string;
const info = { deviceName: "SDK laptop", platform: "macos", appVersion: "0.0.0", keyProtection: "webcrypto" } as const;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "jagentchill-client-"));
  app = createServerApp({ dataDir });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  wsUrl = `ws://127.0.0.1:${(app.http.address() as AddressInfo).port}/jagentchill/v1/ws`;
});
after(() => {
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function pair(role: "admin" | "editor") {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: role }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const signer = await createWebCryptoSigner(await generateDeviceKey());
  const enrolment = await beginEnrolment(decoded.offer, originOfAddress(decoded.offer.addresses[0].url), signer, info);
  const pending = app.pairing.pending().find((request) => request.requestId === enrolment.requestId)!;
  return { signer, enrolment, code: pending.code, offer: decoded.offer };
}

test("pairs from an offer URL, connects, calls an RPC and receives a targeted event", async () => {
  const { signer, enrolment, code } = await pair("admin");
  assert.equal(enrolment.fingerprint, signer.deviceId.slice(0, 8));
  assert.equal(enrolment.attemptsRemaining, 5);
  const host = await enrolment.submitCode(code);
  assert.equal(host.role, "admin");
  assert.ok(Math.abs(host.verifiedClockOffset_ms) < 2000);

  const events: string[] = [];
  const connection = await connectHost({ host, signer, clientInstanceId: "test", onTokenRotated: () => assert.fail("no rotation expected"), onEvent: (e) => events.push(e.event) });
  assert.equal(connection.ready.role, "admin");
  assert.equal(connection.ready.transport, "loopback");
  const { devices } = await connection.call<{ devices: Array<{ name: string }> }>("jagentchill.device.list");
  assert.deepEqual(devices.map((d) => d.name), ["SDK laptop"]);

  // A second device asks to pair: this admin connection is told, with the code.
  const second = await pair("editor");
  await connection.call("jagentchill.pairing.request.list");
  // The host also announces this device coming online; only the pairing event is under test here.
  assert.deepEqual(events.filter((event) => event !== "jagentchill.device.presence.changed"), ["jagentchill.pairing.requested"]);
  await second.enrolment.cancel();
  connection.close();
});

test("a wrong code reports the attempts left; errors carry the host's code", async () => {
  const { enrolment, code } = await pair("editor");
  const wrong = code === "000000" ? "000001" : "000000";
  await assert.rejects(() => enrolment.submitCode(wrong), (err: unknown) => {
    assert.ok(err instanceof HostError);
    assert.equal(err.code, "CODE_INVALID");
    assert.equal(err.details?.attemptsRemaining, 4);
    return true;
  });
  const host = await enrolment.submitCode(code);
  assert.equal(host.role, "editor");
});

test("refuses an impostor host before sending the token, and a revoked device is told so", async () => {
  const { signer, enrolment, code } = await pair("editor");
  const host = await enrolment.submitCode(code);

  // Same address, but the device believes it paired with another host key: the signature cannot verify.
  const { signer: other } = await pair("editor");
  const impostor: HostRecord = { ...host, gatewayPublicKey: other.devicePublicKey };
  await assert.rejects(() => connectHost({ host: impostor, signer, clientInstanceId: "t", onTokenRotated() {} }), (err: unknown) => {
    assert.ok(err instanceof HostError);
    assert.equal(err.code, "GATEWAY_SIGNATURE_INVALID");
    return true;
  });
  await assert.rejects(() => connectHost({ host: { ...host, gatewayId: "0".repeat(32) }, signer, clientInstanceId: "t", onTokenRotated() {} }), /different host/);

  const closes: number[] = [];
  const connection = await connectHost({ host, signer, clientInstanceId: "t", onTokenRotated() {}, onClose: (c) => closes.push(c) });
  app.devices.revoke(signer.deviceId, "test");
  app.channel.closeDevice(signer.deviceId, 4403, "DEVICE_REVOKED");
  await assert.rejects(() => connection.call("jagentchill.session.list"), (err: unknown) => err instanceof HostError && err.code === "CONNECTION_CLOSED");
  assert.deepEqual(closes, [4403]);
  await assert.rejects(() => connectHost({ host, signer, clientInstanceId: "t", onTokenRotated() {} }), (err: unknown) => err instanceof HostError && err.code === "DEVICE_REVOKED");
});

test("an admin device sends a secret over the signed route and gets back only its name and hint; an editor is refused", async () => {
  const admin = await pair("admin");
  const host = await admin.enrolment.submitCode(admin.code);
  const stored = await putHostSecret(host, admin.signer, "RELAY_KEY", "sk-test-0123456789-ABCD");
  assert.deepEqual(stored, { name: "RELAY_KEY", hint: "••••ABCD" });
  const listed = await listHostSecrets(host, admin.signer);
  assert.deepEqual(listed.map((secret) => [secret.name, secret.hint, "value" in secret]), [["RELAY_KEY", "••••ABCD", false]]);
  assert.deepEqual(await deleteHostSecret(host, admin.signer, "RELAY_KEY"), { name: "RELAY_KEY" });
  assert.deepEqual(await listHostSecrets(host, admin.signer), []);
  await assert.rejects(putHostSecret(host, admin.signer, "lower", "x"), (error: HostError) => error.code === "INVALID_PARAMS");
  const editor = await pair("editor");
  const editorHost = await editor.enrolment.submitCode(editor.code);
  await assert.rejects(putHostSecret(editorHost, editor.signer, "EDITOR_KEY", "sk-editor-000000000000"), (error: HostError) => error.code === "SCOPE_DENIED");
  await assert.rejects(listHostSecrets(editorHost, editor.signer), (error: HostError) => error.code === "SCOPE_DENIED");
});
