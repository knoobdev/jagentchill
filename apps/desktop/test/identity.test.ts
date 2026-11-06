// The OS secret store here is a FAKE `safeStorage` (a reversible XOR): Electron's own cannot run in a test process. The key, the files, their modes and the signatures are real.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SignRefused, rotationStatement } from "@jagentchill/desktop-core";
import { handshakeTranscript } from "@jagentchill/protocol";
import { KeyStorageUnavailable, createIdentity, type SafeStorage } from "../src/identity.ts";

const fakeStore = (state: { available: boolean; backend?: string }): SafeStorage => ({
  isEncryptionAvailable: () => state.available, getSelectedStorageBackend: () => state.backend ?? "gnome_libsecret",
  encryptString: (text) => Buffer.from(Buffer.from(`v10${text}`, "utf8").map((byte) => byte ^ 0x5a)),
  decryptString: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString("utf8").slice(3),
});
const fresh = (state = { available: true } as { available: boolean; backend?: string }, platform: NodeJS.Platform = "darwin", confirmRotation?: () => Promise<boolean>) => {
  const directory = join(mkdtempSync(join(tmpdir(), "jc-identity-")), "identity");
  return { directory, state, identity: createIdentity({ directory, safeStorage: fakeStore(state), platform, confirmRotation }) };
};
const b64 = (bytes: number) => Buffer.alloc(bytes, 9).toString("base64url");
const GATEWAY = "a".repeat(32);
const host = { gatewayId: GATEWAY, gatewayPublicKey: b64(32), gatewayName: "Studio", origin: "http://127.0.0.1:18910", role: "admin" as const, deviceToken: { value: "t".repeat(43), expires_ms: 1 }, verifiedClockOffset_ms: 0 };
const verifies = (publicKey: string, text: string, signature: string) => verify(null, Buffer.from(text), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64url")]), format: "der", type: "spki" }), Buffer.from(signature, "base64url"));

test("Desktop renderer cannot read the key: the key file is owner-only and identity returns the public key and signatures only", async () => {
  const { identity, directory } = fresh();
  const info = identity.publicInfo();
  assert.match(info.deviceId, /^[0-9a-f]{64}$/);
  assert.equal(info.keyProtection, "file");
  if (process.platform !== "win32") {
    assert.equal(statSync(identity.keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
  }
  const stored = readFileSync(identity.keyPath, "utf8");
  assert.equal(stored.includes("PRIVATE KEY"), false);
  assert.equal(JSON.parse(stored).protection, "file");
  // Nothing the identity hands out carries private key material.
  identity.saveHost(host);
  const fields = { context: "connect", gatewayNonce: b64(32), deviceNonce: b64(32), ts: 5, gatewayId: GATEWAY, protocolVersion: 1 };
  const signed = (await identity.sign({ kind: "handshake", fields })) as { signature: string };
  assert.deepEqual(Object.keys(signed), ["signature"]);
  assert.equal(verifies(info.devicePublicKey, handshakeTranscript({ ...fields, role: "device", deviceId: info.deviceId, devicePublicKey: info.devicePublicKey }), signed.signature), true);
  for (const value of [JSON.stringify(info), JSON.stringify(signed), JSON.stringify(identity.hosts())]) assert.equal(/PRIVATE|pkcs8/i.test(value), false);
  // A second instance over the same folder loads the same key.
  assert.equal(createIdentity({ directory, safeStorage: fakeStore({ available: true }), platform: "darwin" }).publicInfo().deviceId, info.deviceId);
});

test("Free-form signing is refused: a string, bytes or an unknown host get SIGN_REFUSED and nothing is signed", async () => {
  const { identity } = fresh();
  identity.saveHost(host);
  for (const input of ["hello", Buffer.from("hello"), { kind: "request", fields: { gatewayId: "b".repeat(32), method: "GET", target: "/x", bodySha256: "0".repeat(64), ts: 1, nonce: b64(16) } }, { kind: "sign", fields: { text: "hello" } }]) {
    await assert.rejects(identity.sign(input), (error: unknown) => error instanceof SignRefused && error.code === "SIGN_REFUSED");
  }
});

test("enrolment transcripts are signed only for the offer being paired, and only until pairing ends", async () => {
  const { identity } = fresh();
  const offerId = b64(16), offered = "c".repeat(32);
  const offer = Buffer.from(JSON.stringify({ v: 1, offerId, gatewayId: offered, gatewayPublicKey: b64(32), addresses: [{ kind: "loopback", url: "ws://127.0.0.1:18910/jagentchill/v1/ws" }], expires_ms: Date.now() + 60_000 })).toString("base64url");
  const fields = { context: `enrol:${offerId}`, gatewayNonce: b64(32), deviceNonce: b64(32), ts: 5, gatewayId: offered, protocolVersion: 1 };
  await assert.rejects(identity.sign({ kind: "handshake", fields }), SignRefused);
  assert.deepEqual(identity.beginEnrolment(`jagentchill://pair#offer=${offer}`, "http://127.0.0.1:18910"), { gatewayId: offered });
  assert.ok(((await identity.sign({ kind: "handshake", fields })) as { signature: string }).signature);
  identity.endEnrolment();
  await assert.rejects(identity.sign({ kind: "handshake", fields }), SignRefused);
  assert.throws(() => identity.beginEnrolment("jagentchill://pair#offer=AAAA", "http://127.0.0.1:18910"));
});

test("No keyring on Linux: new identity uses the owner-only file without consulting the unavailable store", () => {
  for (const state of [{ available: false }, { available: true, backend: "basic_text" }, { available: true, backend: "unknown" }]) {
    const { identity } = fresh(state, "linux");
    assert.equal(identity.publicInfo().keyProtection, "file");
    assert.equal(existsSync(identity.keyPath), true);
    assert.equal(identity.keyProtection, "file");
  }
});

test("an existing OS-store identity is quarantined without calling safeStorage and replaced by an owner-only fallback", () => {
  const { identity, directory } = fresh();
  identity.publicInfo();
  const legacy = JSON.parse(readFileSync(identity.keyPath, "utf8"));
  const pem = Buffer.from(legacy.data, "base64").toString("utf8");
  const encoded = fakeStore({ available: true }).encryptString(pem).toString("base64");
  writeFileSync(identity.keyPath, JSON.stringify({ ...legacy, protection: "os-store", data: encoded }));
  writeFileSync(join(directory, "secure-store.json"), JSON.stringify({ v: 1, protection: "os-store", values: {} }));
  const oldDeviceId = identity.publicInfo().deviceId;
  const refused: SafeStorage = {
    isEncryptionAvailable: () => { throw new Error("safeStorage availability must not be queried at startup"); },
    encryptString: () => { throw new Error("safeStorage encrypt must not be queried at startup"); },
    decryptString: () => { throw new Error("safeStorage decrypt must not be queried at startup"); },
  };
  const fallback = createIdentity({ directory, safeStorage: refused, platform: "darwin" });
  const replacement = fallback.publicInfo();
  assert.equal(replacement.keyProtection, "file");
  assert.notEqual(replacement.deviceId, oldDeviceId);
  assert.equal(existsSync(`${identity.keyPath}.keychain-locked`), true);
  assert.equal(existsSync(`${join(directory, "secure-store.json")}.keychain-locked`), true);
  assert.deepEqual(fallback.hosts(), []);
  if (process.platform !== "win32") assert.equal(statSync(identity.keyPath).mode & 0o777, 0o600);
});

test("a background migration can restore the quarantined OS-store identity and secrets into owner-only files", async () => {
  const { identity, directory, state } = fresh();
  identity.createInFile(true);
  identity.saveHost(host);
  identity.store.set("tailnet-auth-key", "tskey-fake-secret");
  identity.moveToStore();
  const priorDeviceId = identity.publicInfo().deviceId;
  const fallback = createIdentity({ directory, safeStorage: fakeStore(state), platform: "darwin" });
  assert.notEqual(fallback.publicInfo().deviceId, priorDeviceId);
  assert.equal(fallback.hasQuarantinedLegacy(), true);
  const currentHost = { ...host, gatewayId: "b".repeat(32) };
  fallback.saveHost(currentHost);
  assert.equal(await fallback.tryMigrateLegacy(), true);
  assert.equal(fallback.publicInfo().deviceId, priorDeviceId);
  assert.deepEqual(fallback.hosts(), [host, currentHost]);
  const signed = await fallback.sign({ kind: "handshake", fields: { context: "connect", gatewayNonce: b64(32), deviceNonce: b64(32), ts: Date.now(), gatewayId: GATEWAY, protocolVersion: 1 } });
  assert.ok("signature" in signed, "the restored identity can sign for its prior paired host");
  assert.equal(fallback.store.get("tailnet-auth-key"), "tskey-fake-secret");
  assert.equal(JSON.parse(readFileSync(fallback.keyPath, "utf8")).protection, "file");
  assert.equal(JSON.parse(readFileSync(join(directory, "secure-store.json"), "utf8")).protection, "file");
  assert.equal(existsSync(`${fallback.keyPath}.keychain-locked`), true, "the prior encrypted key remains as recovery evidence");
  if (process.platform !== "win32") assert.equal(statSync(fallback.keyPath).mode & 0o777, 0o600);
});

test("Confirmed file storage: after the confirmation the key is written owner-only, marked file. Moving the key to the system store keeps the device id and the pairings", async () => {
  const { identity, state, directory } = fresh({ available: false }, "linux");
  identity.createInFile(true);
  const before = identity.publicInfo();
  assert.equal(before.keyProtection, "file");
  if (process.platform !== "win32") assert.equal(statSync(identity.keyPath).mode & 0o777, 0o600);
  identity.saveHost(host);
  assert.throws(() => identity.moveToStore(), KeyStorageUnavailable);
  state.available = true;
  identity.moveToStore();
  const after = identity.publicInfo();
  assert.deepEqual([after.deviceId, after.keyProtection], [before.deviceId, "os-store"]);
  assert.equal(Buffer.from(JSON.parse(readFileSync(identity.keyPath, "utf8")).data, "base64").toString("utf8").includes("PRIVATE KEY"), false);
  assert.deepEqual(identity.hosts(), [host]);
  assert.equal(readFileSync(join(directory, "secure-store.json"), "utf8").includes(host.deviceToken.value), false);
});

test("the protected store keeps device tokens encrypted, checks host records and lists keys by prefix", () => {
  const { identity, directory } = fresh();
  identity.saveHost(host);
  identity.store.set("note", "value");
  assert.equal(readFileSync(join(directory, "secure-store.json"), "utf8").includes(host.deviceToken.value), false);
  assert.deepEqual(identity.store.keys("host/"), [`host/${GATEWAY}`]);
  assert.equal(identity.store.get("note"), "value");
  assert.equal(identity.store.get("absent"), null);
  assert.throws(() => identity.store.set(`host/${"b".repeat(32)}`, JSON.stringify(host)));
  assert.throws(() => identity.store.set(`host/${GATEWAY}`, JSON.stringify({ ...host, extra: 1 })));
  identity.store.delete(`host/${GATEWAY}`);
  assert.deepEqual(identity.hosts(), []);
});

test("Rotation needs a person: without the main process's confirmation no key pair is generated; with it both keys sign the statement and the same pending key is reused", async () => {
  let answer = false;
  const { identity } = fresh({ available: true }, "darwin", async () => answer);
  identity.saveHost(host);
  const old = identity.publicInfo();
  await assert.rejects(identity.sign({ kind: "rotate", fields: { gatewayId: GATEWAY } }), SignRefused);
  assert.equal("pending" in JSON.parse(readFileSync(identity.keyPath, "utf8")), false);
  answer = true;
  const first = (await identity.sign({ kind: "rotate", fields: { gatewayId: GATEWAY } })) as { newDevicePublicKey: string; ts: number; signatureByOldKey: string; signatureByNewKey: string };
  assert.deepEqual(Object.keys(first), ["newDevicePublicKey", "ts", "signatureByOldKey", "signatureByNewKey"]);
  const statement = rotationStatement({ gatewayId: GATEWAY, oldDeviceId: old.deviceId, newDevicePublicKey: first.newDevicePublicKey, ts: first.ts });
  assert.equal(verifies(old.devicePublicKey, statement, first.signatureByOldKey), true);
  assert.equal(verifies(first.newDevicePublicKey, statement, first.signatureByNewKey), true);
  assert.notEqual(first.newDevicePublicKey, old.devicePublicKey);
  const second = (await identity.sign({ kind: "rotate", fields: { gatewayId: GATEWAY } })) as { newDevicePublicKey: string };
  assert.equal(second.newDevicePublicKey, first.newDevicePublicKey);
  await assert.rejects(identity.sign({ kind: "rotate", fields: { gatewayId: GATEWAY, newDevicePublicKey: b64(32) } }), SignRefused);
});
