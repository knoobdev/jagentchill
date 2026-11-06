import assert from "node:assert/strict";
import { test } from "node:test";
import { base64UrlToBytes } from "@jagentchill/protocol";
import { randomBytes as secureRandom, randomUUID } from "node:crypto";
import { nobleCryptoPort } from "../../../packages/client/src/crypto-noble.ts";
import { setCryptoPortForTests } from "../../../packages/client/src/crypto.ts";
import { createNativeIdentityStore } from "./identityNative.ts";

setCryptoPortForTests(nobleCryptoPort((size) => new Uint8Array(secureRandom(size)), randomUUID));

class MemorySecureStore {
  values = new Map<string, string>();
  async getItemAsync(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async setItemAsync(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async deleteItemAsync(key: string): Promise<void> { this.values.delete(key); }
}

test("native signer is generated once, protected-store persisted, and reloads with the same device identity", async () => {
  const store = new MemorySecureStore();
  const first = await createNativeIdentityStore(store).loadSigner();
  const storedKey = store.values.get("jagentchill.identity.device-key.v1");
  assert.ok(storedKey);
  assert.equal(JSON.parse(storedKey).privateKey.length > 0, true);
  const reloaded = await createNativeIdentityStore(store).loadSigner();
  assert.equal(reloaded.deviceId, first.deviceId);
  assert.equal(reloaded.devicePublicKey, first.devicePublicKey);
  const rawPublic = base64UrlToBytes(first.devicePublicKey)!;
  const verifyKey = await crypto.subtle.importKey("raw", rawPublic, { name: "Ed25519" }, false, ["verify"]);
  const fields = { gatewayId: "ab".repeat(16), method: "GET", target: "/jagentchill/v1/host/status", bodySha256: "0".repeat(64), ts: 1_800_000_000_000, nonce: "fixed-test-nonce" };
  const signature = base64UrlToBytes(await reloaded.signRequest(fields))!;
  const canonical = (await import("@jagentchill/protocol")).requestCanonicalString(fields);
  assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, verifyKey, signature, new TextEncoder().encode(canonical)), true);
});

test("host records and rotated device tokens survive reads from the protected store", async () => {
  const store = new MemorySecureStore(), identity = createNativeIdentityStore(store);
  const host = { gatewayId: "cd".repeat(16), gatewayPublicKey: "key", gatewayName: "Fixture host", origin: "http://127.0.0.1:18963", role: "viewer" as const, deviceToken: { value: "token-1", expires_ms: 1 }, verifiedClockOffset_ms: 0 };
  await identity.saveHost(host);
  await identity.saveHost({ ...host, deviceToken: { value: "token-2", expires_ms: 2 } });
  assert.equal((await identity.listHosts()).length, 1);
  assert.equal((await identity.getHost(host.gatewayId))?.deviceToken.value, "token-2");
  await identity.removeHost(host.gatewayId);
  assert.deepEqual(await identity.listHosts(), []);
});

test("pending pairing offer is persisted and cleared through the protected store", async () => {
  const store = new MemorySecureStore(), identity = createNativeIdentityStore(store);
  await identity.savePendingOffer("jagentchill://pair#offer=fixture");
  assert.equal(await createNativeIdentityStore(store).loadPendingOffer(), "jagentchill://pair#offer=fixture");
  await identity.clearPendingOffer();
  assert.equal(await identity.loadPendingOffer(), null);
});
