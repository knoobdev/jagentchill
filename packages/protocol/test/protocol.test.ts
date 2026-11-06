import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  EMPTY_BODY_SHA256,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeOffer,
  deviceIdFromKeyDigest,
  encodeOfferUrl,
  gatewayIdFromKeyDigest,
  handshakeTranscript,
  requestCanonicalString,
  utf8,
  utf8Decode,
  type PairingOffer,
} from "../src/index.ts";

const b64 = (n: number) => bytesToBase64Url(randomBytes(n));

function offer(): PairingOffer {
  const key = randomBytes(32);
  return {
    v: 1,
    offerId: b64(16),
    gatewayId: gatewayIdFromKeyDigest(createHash("sha256").update(key).digest()),
    gatewayPublicKey: bytesToBase64Url(key),
    addresses: [{ kind: "loopback", url: "ws://127.0.0.1:18910/jagentchill/v1/ws" }],
    expires_ms: 1_800_000_600_000,
  };
}

test("base64url round trip matches Node and rejects padding and non-canonical text", () => {
  const btoa = globalThis.btoa, atob = globalThis.atob;
  Object.defineProperty(globalThis, "btoa", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "atob", { configurable: true, value: undefined });
  try {
    for (const n of [0, 1, 2, 3, 16, 32, 64]) {
      const bytes = randomBytes(n);
      assert.equal(bytesToBase64Url(bytes), bytes.toString("base64url"));
      assert.deepEqual(Buffer.from(base64UrlToBytes(bytes.toString("base64url"))!), bytes);
    }
    assert.equal(base64UrlToBytes("AA=="), null);
    assert.equal(base64UrlToBytes("A+/A"), null);
    assert.equal(base64UrlToBytes("AB"), null, "non-zero trailing bits are not canonical");
  } finally {
    Object.defineProperty(globalThis, "btoa", { configurable: true, value: btoa });
    Object.defineProperty(globalThis, "atob", { configurable: true, value: atob });
  }
});

test("UTF-8 wire encoding and offer decoding do not require TextEncoder or TextDecoder globals", () => {
  const encoder = globalThis.TextEncoder, decoder = globalThis.TextDecoder;
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: undefined });
  try {
    const text = "JAgentChill · Hồ Chí Minh · 🎬";
    const bytes = utf8(text);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(text, "utf8"));
    assert.equal(utf8Decode(bytes), text);
    assert.throws(() => utf8Decode(new Uint8Array([0xc0, 0xaf])));
  } finally {
    Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: encoder });
    Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: decoder });
  }
});

test("identifier derivation: gatewayId is the first 32 hex of the digest, deviceId all 64", () => {
  const digest = createHash("sha256").update(randomBytes(32)).digest();
  assert.equal(deviceIdFromKeyDigest(digest).length, 64);
  assert.equal(gatewayIdFromKeyDigest(digest), deviceIdFromKeyDigest(digest).slice(0, 32));
});

test("handshake transcript is ten lines with context third and the nonces fourth and fifth", () => {
  const text = handshakeTranscript({
    role: "device", context: "connect", gatewayNonce: "GN", deviceNonce: "DN", ts: 1_800_000_000_000,
    gatewayId: "g".repeat(32), deviceId: "d".repeat(64), devicePublicKey: "PK", protocolVersion: 1,
  });
  const lines = text.split("\n");
  assert.equal(lines.length, 10);
  assert.deepEqual(lines.slice(0, 6), ["JAGENTCHILL-HANDSHAKE-V1", "device", "connect", "GN", "DN", "1800000000000"]);
  assert.equal(lines[9], "1");
  assert.ok(!text.endsWith("\n"));
  assert.throws(() => handshakeTranscript({
    role: "device", context: "connect\ngateway", gatewayNonce: "GN", deviceNonce: "DN", ts: 1,
    gatewayId: "g", deviceId: "d", devicePublicKey: "PK", protocolVersion: 1,
  }));
});

test("request canonical string is seven lines with an upper-case method", () => {
  const text = requestCanonicalString({
    gatewayId: "g".repeat(32), method: "get", target: "/jagentchill/v1/blobs/abc?x=1", bodySha256: EMPTY_BODY_SHA256,
    ts: 5, nonce: "N",
  });
  assert.deepEqual(text.split("\n"), [
    "JAGENTCHILL-REQUEST-V1", "g".repeat(32), "GET", "/jagentchill/v1/blobs/abc?x=1", EMPTY_BODY_SHA256, "5", "N",
  ]);
  assert.equal(EMPTY_BODY_SHA256, createHash("sha256").update("").digest("hex"));
});

test("offer round trip yields exactly the six fields, from every accepted form", () => {
  const original = offer();
  const url = encodeOfferUrl(original);
  assert.ok(url.startsWith("jagentchill://pair#offer=") && url.length <= 1024);
  const payload = url.slice("jagentchill://pair#offer=".length);
  for (const form of [url, payload, `https://host.example/jagentchill/app/#/pair/link?offer=${payload}`]) {
    const decoded = decodeOffer(form);
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.offer, original);
    assert.deepEqual(Object.keys(decoded.offer).sort(), ["addresses", "expires_ms", "gatewayId", "gatewayPublicKey", "offerId", "v"]);
  }
});

test("malformed, incomplete, extended and future-version offers are refused", () => {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.deepEqual(decodeOffer("not base64 !"), { ok: false, code: "OFFER_INVALID" });
  assert.deepEqual(decodeOffer(Buffer.from("{").toString("base64url")), { ok: false, code: "OFFER_INVALID" });
  const { addresses: _dropped, ...incomplete } = offer();
  assert.deepEqual(decodeOffer(enc(incomplete)), { ok: false, code: "OFFER_INVALID" });
  assert.deepEqual(decodeOffer(enc({ ...offer(), token: "secret" })), { ok: false, code: "OFFER_INVALID" });
  assert.deepEqual(decodeOffer(enc({ ...offer(), v: 2 })), { ok: false, code: "OFFER_VERSION_UNSUPPORTED" });
  assert.deepEqual(decodeOffer(enc({ ...offer(), addresses: [{ kind: "relay", url: "wss://x" }] })), { ok: false, code: "OFFER_INVALID" });
});

test("agent runtime and ORC wire schemas: a model is named by runtime, provider and model, and nothing extra passes", async () => {
  const { RUNTIME_ERROR_CODES, RUNTIME_METHOD_SCOPES, ORC_METHOD_SCOPES, endpointDraftSchema, modelRefSchema, orcConfigSchema, runtimeConfigUpdateParams, sessionControlSetParams } = await import("../src/index.ts");
  assert.equal(modelRefSchema.safeParse({ modelId: "gpt-5" }).success, false);
  assert.equal(modelRefSchema.safeParse({ runtimeId: "codex", providerId: "openai", modelId: "gpt-5" }).success, true);
  assert.equal(sessionControlSetParams.safeParse({ sessionKey: "s", ref: null, modeId: "plan" }).success, true);
  assert.equal(runtimeConfigUpdateParams.safeParse({ expectedRevision: 0, patch: { entries: { "my-agent": { extends: "acp", command: ["a"], env: { BAD_NAME_: "x", "1BAD": "y" } } } } }).success, false);
  const endpoint = endpointDraftSchema.parse({ id: "relay", label: "Relay", baseUrl: "http://127.0.0.1:1/v1", dialect: "openai-completions", auth: { mode: "none" } });
  assert.deepEqual([endpoint.timeoutSeconds, endpoint.maxConcurrency, endpoint.capabilities, endpoint.modelSource], [120, 4, ["llm"], "discover-and-manual"]);
  assert.equal(endpointDraftSchema.safeParse({ ...endpoint, dialect: "bedrock-converse-stream" }).success, false);
  assert.equal(orcConfigSchema.safeParse({ version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: { director: { profiles: [{ id: "a", model: "bare" }] } } }).success, false);
  // Every method has a JAgentChill scope, and every runtime code is in the runtime namespace.
  for (const scope of [...Object.values(RUNTIME_METHOD_SCOPES), ...Object.values(ORC_METHOD_SCOPES)]) assert.match(scope, /^jagentchill\.[a-z]+\.[a-z]+$/);
  assert.ok(RUNTIME_ERROR_CODES.every((code) => code.startsWith("runtime/")));
});
