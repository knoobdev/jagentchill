import assert from "node:assert/strict";
import { randomBytes as secureRandom, randomUUID as secureRandomUUID, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { verifyText } from "../../../server/src/crypto.ts";
import { createServerApp, type ServerApp } from "../../../server/src/app.ts";
import { beginEnrolment, connectHost, createWebCryptoSigner, generateDeviceKey } from "../src/index.ts";
import { setCryptoPortForTests } from "../src/crypto.ts";
import { nobleCryptoPort, type NativeDeviceKeyPair } from "../src/crypto-noble.ts";

const WebSocket = createRequire(new URL("../../../server/package.json", import.meta.url))("ws").WebSocket as typeof globalThis.WebSocket;
const nativePort = nobleCryptoPort((size) => new Uint8Array(secureRandom(size)), secureRandomUUID);
const repo = resolve(import.meta.dirname, "../../..");
const w17RunRoot = process.env.W17_TEST_RUN_DIR;
let app: ServerApp;
let dataDir: string;
const port = Number(process.env.JAGENTCHILL_PORT ?? 18960);
const gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT ?? 18961);

before(async () => {
  if (process.env.JAGENTCHILL_SUITE_W17 === "1") {
    if (!w17RunRoot || !/^\.dev\/run-w17a-suites-green-\d+$/.test(w17RunRoot)) throw new Error("W17_TEST_RUN_DIR must name a fresh W17 suite directory.");
    if (port < 19115 || port > 19118 || gatewayPort !== port + 1) throw new Error("W17 native crypto test host ports must be an assigned pair in 19115-19119.");
    dataDir = resolve(repo, w17RunRoot, "native-crypto-client");
    if (existsSync(dataDir)) throw new Error("W17 native crypto test data directory must be fresh.");
  } else {
    if (!process.env.W8_NATIVE_CRYPTO_DATA_DIR) throw new Error("W8_NATIVE_CRYPTO_DATA_DIR must name a fresh .dev/run-w8l-native-crypto-N directory.");
    if (port < 18960 || port > 18964 || gatewayPort !== port + 1) throw new Error("Native crypto test host ports must be an assigned pair in 18960-18964.");
    dataDir = process.env.W8_NATIVE_CRYPTO_DATA_DIR;
  }
  app = createServerApp({ dataDir });
  await new Promise<void>((resolve, reject) => { app.http.once("error", reject); app.http.listen(port, "127.0.0.1", resolve); });
  setCryptoPortForTests(nativePort);
});
after(async () => { setCryptoPortForTests(undefined); if (app) await app.close(); });

test("Noble Ed25519 keys and signatures cross-verify with WebCrypto and the server verifier", async () => {
  const native = await nativePort.generateDeviceKey() as unknown as NativeDeviceKeyPair;
  const transcript = "native-to-web-cross-check";
  const signature = await nativePort.signBytes(native as never, new TextEncoder().encode(transcript));
  const webPublic = await webcrypto.subtle.importKey("raw", native.publicKey, { name: "Ed25519" }, false, ["verify"]);
  assert.equal(await webcrypto.subtle.verify({ name: "Ed25519" }, webPublic, signature, new TextEncoder().encode(transcript)), true);
  assert.equal(verifyText(Buffer.from(native.publicKey).toString("base64url"), transcript, Buffer.from(signature).toString("base64url")), true);

  const web = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const webPrivate = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", web.privateKey));
  const webPublicRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", web.publicKey));
  const importedNative = await nativePort.importDeviceKey(webPrivate, webPublicRaw) as unknown as NativeDeviceKeyPair;
  const reverse = await nativePort.signBytes(importedNative as never, new TextEncoder().encode(transcript));
  assert.equal(await webcrypto.subtle.verify({ name: "Ed25519" }, web.publicKey, reverse, new TextEncoder().encode(transcript)), true);
});

test("full enrolment, code verification, and signed WebSocket hello work with WebCrypto subtle removed", async () => {
  const savedCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: <T extends ArrayBufferView>(value: T) => value, randomUUID: secureRandomUUID } });
  // `globalThis.crypto` intentionally has no `subtle`; every client crypto operation uses the installed Noble port.
  try {
    assert.equal(globalThis.crypto.subtle, undefined, "test scope has no WebCrypto subtle API");
    const pair = await generateDeviceKey();
    const signer = await createWebCryptoSigner(pair);
    const base = `http://127.0.0.1:${port}`;
    const offer = app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { rolePreset: "viewer" });
    const enrolment = await beginEnrolment(offer, base, signer, { deviceName: "Native test phone", platform: "ios", appVersion: "0.0.0", keyProtection: "secure-store" });
    const request = app.pairing.pending().find((entry) => entry.requestId === enrolment.requestId);
    assert.ok(request, "host received and proved the enrol request");
    const host = await enrolment.submitCode(request.code);
    assert.equal(host.role, "viewer");
    assert.ok(host.deviceToken.value.length > 0);
    const connection = await connectHost({
      host, signer, clientInstanceId: "native-crypto-test", WebSocketImpl: WebSocket,
      onTokenRotated: (token) => { host.deviceToken = token; },
    });
    assert.equal(connection.ready.role, "viewer");
    assert.equal(connection.ready.transport, "loopback");
    connection.close();
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: savedCrypto });
  }
});
