// The OS secret store here is a FAKE `safeStorage` (a reversible XOR): Electron's own cannot run in a test process.
// The relay's HTTP calls are real, against a `node:http` fixture on 127.0.0.1 chosen by the offer itself.
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test, type TestContext } from "node:test";
import { beginEnrolment, originOfAddress, type EnrolmentPost } from "@jagentchill/client";
import { SIGNATURE_HEADERS, decodeOffer, encodeOfferUrl, requestCanonicalString } from "@jagentchill/protocol";
import { createServerApp } from "@jagentchill/server/src/app.ts";
import { createIdentity, type SafeStorage } from "../src/identity.ts";

const fakeStore = (): SafeStorage => ({
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (text) => Buffer.from(Buffer.from(`v10${text}`, "utf8").map((b) => b ^ 0x5a)),
  decryptString: (data) => Buffer.from(data.map((b) => b ^ 0x5a)).toString("utf8").slice(3),
});
type Clock = { value: number };
// Every temporary directory a test makes is removed by that test's own teardown, by its exact path.
const fresh = (t: TestContext, clock?: Clock, enrolmentTimeout_ms?: number) => {
  const directory = mkdtempSync(join(tmpdir(), "jc-enrolment-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createIdentity({
    directory: join(directory, "identity"), safeStorage: fakeStore(), platform: "darwin",
    ...(clock ? { now: () => clock.value } : {}),
    ...(enrolmentTimeout_ms ? { enrolmentTimeout_ms } : {}),
  });
};
const GATEWAY = "a".repeat(32);
const b64 = (bytes: number, fill: number) => Buffer.alloc(bytes, fill).toString("base64url");
const offerFor = (port: number, url = `ws://127.0.0.1:${port}/jagentchill/v1/ws`) =>
  encodeOfferUrl({ v: 1, offerId: b64(16, 7), gatewayId: GATEWAY, gatewayPublicKey: b64(32, 8), addresses: [{ kind: "loopback", url }], expires_ms: Date.now() + 600_000 });

// The same Ed25519 check the real host runs (server/src/crypto.ts verifyText), built from the raw key and the canonical string.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const verifyRaw = (publicKeyBase64Url: string, text: string, signatureBase64Url: string): boolean => {
  const raw = Buffer.from(publicKeyBase64Url, "base64url"), signature = Buffer.from(signatureBase64Url, "base64url");
  if (raw.byteLength !== 32 || signature.byteLength !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verifySignature(null, Buffer.from(text, "utf8"), key, signature);
  } catch { return false; }
};

const servers: Server[] = [];
const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
};
after(() => { for (const server of servers) { server.closeAllConnections?.(); server.close(); } });

test("enrolmentPost is refused with no active enrolment, after endEnrolment, and after the ten-minute limit", async (t) => {
  const clock: Clock = { value: 1_000 };
  const identity = fresh(t, clock);
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_INACTIVE");
  const port = await listen((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  const offer = offerFor(port), origin = `http://127.0.0.1:${port}`;
  identity.beginEnrolment(offer, origin);
  identity.endEnrolment();
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_INACTIVE");
  identity.beginEnrolment(offer, origin);
  clock.value += 601_000;
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_INACTIVE");
});

test("beginEnrolment accepts only an address of the offer: a mismatch, a wildcard host and a user:pass address are refused", async (t) => {
  const identity = fresh(t);
  const port = await listen((_req, res) => res.end("{}"));
  assert.throws(() => identity.beginEnrolment(offerFor(port), "http://127.0.0.1:1"), (error: any) => error.code === "ENROLMENT_ORIGIN_REFUSED");
  for (const url of ["wss://*/x", "ws://user:pass@127.0.0.1:9/x"]) {
    assert.throws(() => identity.beginEnrolment(offerFor(port, url), "http://127.0.0.1:9"), (error: any) => error.code === "ENROLMENT_ORIGIN_REFUSED", url);
  }
  // A non-http(s) scheme never decodes as an offer at all.
  const ftp = Buffer.from(JSON.stringify({ v: 1, offerId: b64(16, 7), gatewayId: GATEWAY, gatewayPublicKey: b64(32, 8), addresses: [{ kind: "loopback", url: "ftp://127.0.0.1:9/x" }], expires_ms: Date.now() + 600_000 })).toString("base64url");
  assert.throws(() => identity.beginEnrolment(`jagentchill://pair#offer=${ftp}`, "http://127.0.0.1:9"));
});

test("enrolmentPost refuses a step outside challenge/prove/verify", async (t) => {
  const identity = fresh(t);
  const port = await listen((_req, res) => res.end("{}"));
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await assert.rejects(identity.enrolmentPost("evil", "{}"), (error: any) => error.code === "ENROLMENT_STEP_REFUSED");
});

test("enrolmentPost relays one JSON POST to the offer's address and returns its parsed JSON", async (t) => {
  const seen: { method: string; url: string; type: string; body: string }[] = [];
  const port = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", type: String(req.headers["content-type"] ?? ""), body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hello: "world" }));
    });
  });
  const identity = fresh(t);
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  assert.deepEqual(await identity.enrolmentPost("challenge", JSON.stringify({ deviceName: "Studio laptop" })), { status: 200, body: { hello: "world" } });
  assert.deepEqual(seen, [{ method: "POST", url: "/jagentchill/v1/pair/challenge", type: "application/json", body: '{"deviceName":"Studio laptop"}' }]);
});

test("enrolmentPost refuses a redirect", async (t) => {
  const port = await listen((_req, res) => { res.writeHead(302, { location: "http://127.0.0.1:1/x" }); res.end(); });
  const identity = fresh(t);
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_REQUEST_FAILED");
});

test("enrolmentPost reports ENROLMENT_TIMEOUT, not the AbortError's numeric code, when the host never answers", async (t) => {
  // The connection is accepted and the headers are sent, then the answer is held: the relay's own AbortController fires
  // and the `AbortError` it raises carries `code === 20`, which must not be mistaken for a relay refusal.
  const port = await listen((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); /* never end */ });
  const identity = fresh(t, undefined, 120);
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_TIMEOUT");
});

test("enrolmentPost refuses a body above 65536 bytes", async (t) => {
  const port = await listen((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ big: "x".repeat(70_000) })); });
  const identity = fresh(t);
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_BODY_TOO_LARGE");
});

test("enrolmentPost stops reading a slow answer the moment it passes 65536 bytes, before the host finished sending", async (t) => {
  const total = 1024 * 1024, chunk = Buffer.alloc(8 * 1024, 0x78);
  let written = 0, closed = false;
  const port = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed || written >= total) { clearInterval(timer); if (!res.writableEnded && !res.destroyed) res.end(chunk); return; }
      written += chunk.byteLength;
      res.write(chunk);
    }, 5);
    res.on("close", () => { closed = true; clearInterval(timer); });
  });
  const identity = fresh(t);
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await assert.rejects(identity.enrolmentPost("challenge", "{}"), (error: any) => error.code === "ENROLMENT_BODY_TOO_LARGE");
  // The call rejects while the server is still writing: far fewer than `total` bytes left it (and the socket was closed).
  assert.ok(written < total, `the host wrote ${written} of ${total} bytes before the client stopped it (closed=${closed})`);
});

test("enrolmentPost signs the verify step with the enrolling key: the server verifies MAIN's signature headers", async (t) => {
  const identity = fresh(t);
  identity.ensureKey();
  const { deviceId, devicePublicKey } = identity.publicInfo();
  let verified = false;
  const port = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const ts = Number(req.headers[SIGNATURE_HEADERS.timestamp]);
      const nonce = String(req.headers[SIGNATURE_HEADERS.nonce] ?? "");
      const canonical = requestCanonicalString({
        gatewayId: GATEWAY, method: "POST", target: "/jagentchill/v1/pair/verify",
        bodySha256: createHash("sha256").update(body).digest("hex"), ts, nonce,
      });
      verified = req.headers[SIGNATURE_HEADERS.device] === deviceId
        && verifyRaw(devicePublicKey, canonical, String(req.headers[SIGNATURE_HEADERS.signature] ?? ""));
      res.writeHead(verified ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(verified ? { ok: true } : { error: { code: "SIGNATURE_INVALID", message: "missing or wrong" } }));
    });
  });
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  const reply = await identity.enrolmentPost("verify", JSON.stringify({ requestId: "r", action: "cancel" }));
  assert.equal(verified, true, "the signature MAIN added must verify with the device key");
  assert.deepEqual(reply, { status: 200, body: { ok: true } });
});

// ── Against the REAL host (`createServerApp`): what the renderer and MAIN do together, in this process ──────────────
// The client's own `beginEnrolment` plays the renderer; its transport is MAIN's relay, exactly as `ConnectHost.tsx`
// wires it. Nothing of the host is doubled: offers, challenges, the proof, the code and the request signature check
// are the server's.
async function realHost(t: TestContext, now: () => number = Date.now) {
  const dataDir = mkdtempSync(join(tmpdir(), "jc-enrolment-host-"));
  const app = createServerApp({ dataDir, now });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  t.after(() => { app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const wsUrl = `ws://127.0.0.1:${(app.http.address() as AddressInfo).port}/jagentchill/v1/ws`;
  const link = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(link);
  assert.ok(decoded.ok);
  return { app, link, offer: decoded.offer, origin: originOfAddress(wsUrl) };
}
const relayOf = (identity: ReturnType<typeof fresh>): EnrolmentPost => (path, body) => identity.enrolmentPost(path.slice(path.lastIndexOf("/") + 1), JSON.stringify(body));
const INFO = { deviceName: "Desk", platform: "macos" as const, appVersion: "0.0.0", keyProtection: "os-store" };

test("MAIN's relay carries challenge → prove → verify against the real host, whose clock is five minutes ahead: the device is paired", async (t) => {
  // The host signs its challenge; MAIN takes the host's clock from that signed answer and the verify signature is timely by it.
  const host = await realHost(t, () => Date.now() + 300_000);
  const identity = fresh(t);
  identity.ensureKey();
  identity.beginEnrolment(host.link, host.origin);
  const enrolment = await beginEnrolment(host.offer, host.origin, identity.signer(), INFO, relayOf(identity));
  const pending = host.app.pairing.pending().find((request) => request.requestId === enrolment.requestId)!;
  const record = await enrolment.submitCode(pending.code);
  assert.equal(record.role, "editor");
  assert.equal(record.gatewayId, host.offer.gatewayId);
  identity.endEnrolment();
});

test("Against the real host: cancelling goes through the relay and ends the request on the host; after the end nothing is relayed", async (t) => {
  const host = await realHost(t);
  const identity = fresh(t);
  identity.ensureKey();
  identity.beginEnrolment(host.link, host.origin);
  const enrolment = await beginEnrolment(host.offer, host.origin, identity.signer(), INFO, relayOf(identity));
  assert.ok(host.app.pairing.pending().some((request) => request.requestId === enrolment.requestId));
  await enrolment.cancel();
  assert.ok(!host.app.pairing.pending().some((request) => request.requestId === enrolment.requestId), "the host no longer waits for a code");
  identity.endEnrolment();
  await assert.rejects(enrolment.submitCode("123456"), { code: "ENROLMENT_INACTIVE" });
});

test("A challenge answer the host did not sign does not move MAIN's clock: a forged `ts` five minutes ahead leaves the verify signature on this device's time", async (t) => {
  const identity = fresh(t);
  identity.ensureKey();
  const stamps: number[] = [];
  const port = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url!.endsWith("/challenge")) { res.end(JSON.stringify({ requestId: "r", gatewayNonce: b64(32, 3), ts: Date.now() + 300_000, gatewayId: GATEWAY, gatewaySignature: b64(64, 4) })); return; }
      stamps.push(Number(req.headers[SIGNATURE_HEADERS.timestamp]));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
  await identity.enrolmentPost("challenge", JSON.stringify({ deviceNonce: b64(32, 5) }));
  await identity.enrolmentPost("verify", JSON.stringify({ requestId: "r", action: "cancel" }));
  assert.equal(stamps.length, 1);
  assert.ok(Math.abs(stamps[0] - Date.now()) < 5_000, `the verify signature carries this device's time (off by ${stamps[0] - Date.now()} ms), not the forged +300 000 ms`);
});

test("A relayed call belongs to its enrolment: a verify that was still signing when the enrolment switched to another host is not sent, to either host", async (t) => {
  const identity = fresh(t);
  identity.ensureKey();
  const seen: string[] = [];
  const hostOf = (name: string) => listen((req, res) => { seen.push(`${name} ${req.url}`); req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  const portA = await hostOf("A"), portB = await hostOf("B");
  identity.beginEnrolment(offerFor(portA), `http://127.0.0.1:${portA}`);
  const old = identity.enrolmentPost("verify", JSON.stringify({ requestId: "old", code: "123456" }));
  // The renderer moves on to another host while MAIN is signing the old request.
  identity.beginEnrolment(offerFor(portB), `http://127.0.0.1:${portB}`);
  await assert.rejects(old, { code: "ENROLMENT_INACTIVE" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(seen, [], "nothing reached host A or host B");
  // The new enrolment works.
  assert.equal((await identity.enrolmentPost("prove", "{}")).status, 200);
  assert.deepEqual(seen, ["B /jagentchill/v1/pair/prove"]);
});

test("Ending an enrolment, or replacing it, drops its calls in flight: the caller is told ENROLMENT_INACTIVE at once", async (t) => {
  const identity = fresh(t);
  identity.ensureKey();
  let arrived = 0;
  const port = await listen((req) => { arrived += 1; req.resume(); /* never answers */ });
  for (const end of [() => identity.endEnrolment(), () => { identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`); }]) {
    identity.beginEnrolment(offerFor(port), `http://127.0.0.1:${port}`);
    const seenBefore = arrived;
    const held = identity.enrolmentPost("prove", "{}");
    for (let wait = 0; wait < 100 && arrived === seenBefore; wait++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(arrived, seenBefore + 1);
    const before = Date.now();
    end();
    await assert.rejects(held, { code: "ENROLMENT_INACTIVE" });
    assert.ok(Date.now() - before < 2_000, "the held call ended with the enrolment, not with its 15 s timeout");
  }
  identity.endEnrolment();
});
