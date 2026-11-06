import assert from "node:assert/strict";
import { test } from "node:test";
import { loadHostConnections, migrateHostRecord, offerAtDirectOrigin, saveHostConnections, upsertHostConnectionInProfiles, websocketProtocols, type HostConnectionStore, type HostRecord } from "../src/index.ts";
import type { PairingOffer } from "@jagentchill/protocol";

const legacy: HostRecord = {
  gatewayId: "gateway-12345678901234567890123456789012", gatewayPublicKey: "public-key", gatewayName: "Existing host",
  origin: "https://host.example:19443", role: "editor", deviceToken: { value: "kept-token", expires_ms: 42 }, verifiedClockOffset_ms: -17,
};

test("web IndexedDB record from the one-origin schema migrates without losing the host credentials or endpoint", async () => {
  const rows = new Map([[legacy.gatewayId, structuredClone(legacy)]]);
  const before = rows.get(legacy.gatewayId)!;
  const after = migrateHostRecord(before);
  rows.set(after.gatewayId, after);
  assert.equal(after.connections?.length, 1);
  assert.equal(after.connections?.[0]?.origin, legacy.origin);
  assert.equal(after.preferredConnectionId, after.connections?.[0]?.id);
  assert.deepEqual({ gatewayId: after.gatewayId, gatewayPublicKey: after.gatewayPublicKey, gatewayName: after.gatewayName, origin: after.origin, role: after.role, deviceToken: after.deviceToken, verifiedClockOffset_ms: after.verifiedClockOffset_ms }, before);
  assert.deepEqual(rows.get(legacy.gatewayId), after, "the migrated record is written back to the web host store");
});

test("desktop protected-store legacy host migrates to a sidecar and remains readable in the old strict host shape", async () => {
  const values = new Map<string, string>([[`host/${legacy.gatewayId}`, JSON.stringify(legacy)]]);
  const store: HostConnectionStore = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
  const protectedRecordBefore = JSON.parse(values.get(`host/${legacy.gatewayId}`)!) as HostRecord;
  const migrated = await loadHostConnections(store, protectedRecordBefore);
  const protectedRecordAfter = JSON.parse(values.get(`host/${legacy.gatewayId}`)!) as HostRecord;
  assert.deepEqual(protectedRecordAfter, legacy, "the old protected host entry is preserved byte-for-byte as data");
  assert.equal(migrated.gatewayId, legacy.gatewayId);
  assert.equal(migrated.deviceToken.value, "kept-token");
  assert.equal(migrated.origin, legacy.origin);
  assert.equal(migrated.connections?.[0]?.origin, legacy.origin);
  assert.equal(migrated.preferredConnectionId, migrated.connections?.[0]?.id);
  assert.equal(values.has(`host-connections/${legacy.gatewayId}`), true);
  const reloaded = await loadHostConnections(store, protectedRecordAfter);
  assert.deepEqual(reloaded, migrated, "the host stays paired after reload from both protected entries");
  await saveHostConnections(store, { ...migrated, gatewayName: "Renamed" });
  assert.equal(JSON.parse(values.get(`host/${legacy.gatewayId}`)!).gatewayName, legacy.gatewayName, "connection metadata never rewrites the signed host identity");
});

test("a second route merges into the existing gateway profile and becomes its preferred route", () => {
  const first = migrateHostRecord(legacy);
  const second: HostRecord = { ...legacy, origin: "http://192.168.1.8:18945", deviceToken: { value: "rotated-token", expires_ms: 99 } };
  const profiles = upsertHostConnectionInProfiles([first], second);
  assert.equal(profiles.length, 1, "one gateway remains one host row");
  assert.equal(profiles[0]?.connections?.length, 2, "the original and new addresses both remain available");
  assert.equal(profiles[0]?.origin, second.origin, "the new successful route becomes preferred");
  assert.equal(profiles[0]?.deviceToken.value, "rotated-token", "the current paired token is retained");
  const duplicate = upsertHostConnectionInProfiles(profiles, second);
  assert.equal(duplicate[0]?.connections?.length, 2, "re-adding the same route does not duplicate it");
});

test("a direct-route password is encoded only as the websocket second-factor protocol", () => {
  const host = migrateHostRecord({ ...legacy, connections: [{ id: "direct", kind: "direct", origin: legacy.origin, password: "fixture-pass" }], preferredConnectionId: "direct" });
  assert.deepEqual(websocketProtocols(host), [`jagentchill.password.${Buffer.from("fixture-pass", "utf8").toString("base64url")}`]);
  assert.deepEqual(websocketProtocols(migrateHostRecord(legacy)), [], "non-password routes keep the existing handshake");
});

test("the direct probe keeps the active pairing offer identity and replaces only its reachable address", () => {
  const offer: PairingOffer = { v: 1, offerId: "A".repeat(22), gatewayId: legacy.gatewayId, gatewayPublicKey: "A".repeat(43), addresses: [{ kind: "tailnet", url: "wss://old.example.ts.net:443/jagentchill/v1/ws" }], expires_ms: 1234 };
  const direct = offerAtDirectOrigin(offer, "https://host.example:19443");
  assert.equal(direct.offerId, offer.offerId);
  assert.equal(direct.gatewayId, offer.gatewayId);
  assert.equal(direct.gatewayPublicKey, offer.gatewayPublicKey);
  assert.equal(direct.expires_ms, offer.expires_ms);
  assert.deepEqual(direct.addresses, [{ kind: "lan", url: "wss://host.example:19443/jagentchill/v1/ws" }]);
});
