// D.1 integration proof for the desktop renderer adapter: old host/<id> protected-store shape, sidecar migration, live reconnect.
import assert from "node:assert/strict";
import { decodeOffer } from "@jagentchill/protocol";
import { beginEnrolment, connectHost, createWebCryptoSigner, generateDeviceKey, originOfAddress } from "@jagentchill/client";

export async function runDesktopMigration() {
  const fixtureBase = "http://127.0.0.1:18945";
  const offered = await (await fetch(`${fixtureBase}/__fixture/offer`)).json();
  const decoded = decodeOffer(offered.url);
  assert.ok(decoded.ok);
  const signer = await createWebCryptoSigner(await generateDeviceKey());
  const origin = originOfAddress(decoded.offer.addresses[0].url);
  const enrolment = await beginEnrolment(decoded.offer, origin, signer, { deviceName: "Desktop store fixture", platform: "linux", appVersion: "0.0.0", keyProtection: "os-store" });
  let code;
  for (let attempt = 0; attempt < 30 && !code; attempt++) {
    const pending = await (await fetch(`${fixtureBase}/__fixture/pending`)).json();
    code = pending.requests.find((request) => request.requestId === enrolment.requestId)?.code;
    if (!code) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.match(code ?? "", /^\d{6}$/);
  const paired = await enrolment.submitCode(code);
  const legacy = { ...paired };
  delete legacy.connections;
  delete legacy.preferredConnectionId;
  const values = new Map([[`host/${legacy.gatewayId}`, JSON.stringify(legacy)]]);
  globalThis.jagentchillDesktop = {
    secureStore: {
      async get(key) { return values.get(key) ?? null; },
      async set(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); },
      async keys(prefix) { return [...values.keys()].filter((key) => key.startsWith(prefix)).sort(); },
    },
  };
  const identity = await import("../src/identity.electron.ts");
  const storedLegacy = values.get(`host/${legacy.gatewayId}`);
  const hosts = await identity.listHosts();
  const migrated = hosts.find((host) => host.gatewayId === legacy.gatewayId);
  assert.ok(migrated);
  assert.equal(values.get(`host/${legacy.gatewayId}`), storedLegacy, "the strict protected host entry is left unchanged");
  assert.ok(values.has(`host-connections/${legacy.gatewayId}`), "the connection list is stored in its protected-store sidecar");
  assert.equal(migrated.origin, origin);
  const connection = await connectHost({ host: migrated, signer, clientInstanceId: "desktop-migration-fixture", onTokenRotated() {} });
  assert.equal(connection.ready.role, paired.role);
  connection.close();
  return { gatewayId: migrated.gatewayId, connected: true, oldProtectedRecordPreserved: values.get(`host/${legacy.gatewayId}`) === storedLegacy, sidecarWritten: values.has(`host-connections/${legacy.gatewayId}`) };
}
