// The injected enrolment transport is exercised against a real Server app. The global `fetch` is stubbed to throw, so
// this test proves the whole flow (challenge, prove and verify) goes through the injected `post`, never `fetch`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { decodeOffer, encodeOfferUrl } from "@jagentchill/protocol";
import { createServerApp, type ServerApp } from "@jagentchill/server/src/app.ts";
import { EnrolmentSuperseded, beginEnrolment, beginEnrolmentAtFirstAddress, createEnrolmentFlows, createWebCryptoSigner, generateDeviceKey, originOfAddress, signedHeaders, type EnrolmentPost } from "../src/index.ts";

let dataDir: string;
let app: ServerApp;
let wsUrl: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "jc-pairing-post-"));
  app = createServerApp({ dataDir });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  wsUrl = `ws://127.0.0.1:${(app.http.address() as AddressInfo).port}/jagentchill/v1/ws`;
});
after(() => {
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("an injected `post` carries the whole enrolment flow and the global fetch is never called", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl);
  const signer = await createWebCryptoSigner(await generateDeviceKey());
  // The injector signs the verify step itself; the client no longer does it when a relay is provided.
  const offset = 0;
  const injected: EnrolmentPost = async (path, body) => {
    calls.push(path);
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (path.endsWith("/verify")) Object.assign(headers, await signedHeaders(signer, decoded.offer.gatewayId, "POST", path, text, offset));
    const response = await realFetch(origin + path, { method: "POST", headers, body: text });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  globalThis.fetch = (() => { throw new Error("global fetch must not be used during a relayed enrolment"); }) as typeof fetch;
  try {
    const enrolment = await beginEnrolment(decoded.offer, origin, signer, { deviceName: "Relay laptop", platform: "macos", appVersion: "0.0.0", keyProtection: "webcrypto" }, injected);
    const pending = app.pairing.pending().find((request) => request.requestId === enrolment.requestId)!;
    const host = await enrolment.submitCode(pending.code);
    assert.equal(host.role, "editor");
    assert.deepEqual(calls, ["/jagentchill/v1/pair/challenge", "/jagentchill/v1/pair/prove", "/jagentchill/v1/pair/verify"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a relay failure on the first address falls through to the next address, exactly as the web path does", async () => {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl);
  const signer = await createWebCryptoSigner(await generateDeviceKey());
  // What the desktop relay rejects with when the address did not answer (ENROLMENT_REQUEST_FAILED/ENROLMENT_TIMEOUT):
  // on the web the same situation is a TypeError from `fetch`. Both must let the caller try the next address.
  const unreachable = Object.assign(new Error("ENROLMENT_REQUEST_FAILED: The host could not be reached."), { code: "ENROLMENT_REQUEST_FAILED" });
  const tried: string[] = [];
  const unreachablePost: EnrolmentPost = async () => { tried.push("first"); throw unreachable; };
  const realPost: EnrolmentPost = async (path, body) => {
    tried.push("second");
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (path.endsWith("/verify")) Object.assign(headers, await signedHeaders(signer, decoded.offer.gatewayId, "POST", path, text, 0));
    const response = await fetch(origin + path, { method: "POST", headers, body: text });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const enrolment = await beginEnrolmentAtFirstAddress(decoded.offer, ["http://127.0.0.1:1", origin], (candidate) =>
    beginEnrolment(decoded.offer, candidate, signer, { deviceName: "Relay laptop", platform: "macos", appVersion: "0.0.0", keyProtection: "webcrypto" },
      candidate === origin ? realPost : unreachablePost));
  const pending = app.pairing.pending().find((request) => request.requestId === enrolment.requestId)!;
  const host = await enrolment.submitCode(pending.code);
  assert.equal(host.role, "editor");
  // The unreachable first address was tried once, then the whole flow (challenge, prove, verify) ran on the second.
  assert.equal(tried[0], "first");
  assert.ok(tried.length > 1 && tried.slice(1).every((entry) => entry === "second"), tried.join(","));
});

test("when no address answers, the caller gets the typed GATEWAY_UNREACHABLE host error, not the transport's TypeError", async () => {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const signer = await createWebCryptoSigner(await generateDeviceKey());
  // The web path's `fetch` failure is a raw TypeError; the relay's is ENROLMENT_REQUEST_FAILED. Neither carries the
  // app's own code, so exhausting the list must produce a HostError the UI can name.
  const unreachablePost: EnrolmentPost = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(
    beginEnrolmentAtFirstAddress(decoded.offer, ["http://127.0.0.1:1", "http://127.0.0.1:2"], (candidate) =>
      beginEnrolment(decoded.offer, candidate, signer, { deviceName: "Relay laptop", platform: "macos", appVersion: "0.0.0", keyProtection: "webcrypto" }, unreachablePost)),
    (error: unknown) => (error as { code?: string }).code === "GATEWAY_UNREACHABLE" && (error as Error).message === "The host did not answer.",
  );
});

// ── One flow, one end path (`createEnrolmentFlows`), against the real host ─────────────────────────────────────────
// The transport below is what the desktop's main process is to the screen: it posts to the REAL server and signs the
// verify step itself. Each test holds one step back to put the close at an exact moment.
const INFO = { deviceName: "Flow laptop", platform: "macos" as const, appVersion: "0.0.0", keyProtection: "webcrypto" };
async function flowWorld(hold: { step?: "challenge" | "prove"; signing_ms?: number }) {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl), signer = await createWebCryptoSigner(await generateDeviceKey());
  const sent: string[] = [], ends: number[] = [];
  let open!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve)), arrived = new Promise<void>((resolve) => (reached = resolve));
  const relay: EnrolmentPost = async (path, body) => {
    const step = path.slice(path.lastIndexOf("/") + 1), text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (step === "verify") {
      // MAIN signs the request; a slow key store makes that take a while.
      if (hold.signing_ms) await new Promise((resolve) => setTimeout(resolve, hold.signing_ms));
      Object.assign(headers, await signedHeaders(signer, decoded.offer.gatewayId, "POST", path, text, 0));
    }
    sent.push((body as { action?: string }).action === "cancel" ? "cancel" : step);
    const response = await fetch(origin + path, { method: "POST", headers, body: text });
    const reply = { status: response.status, body: await response.json().catch(() => null) };
    // The host has answered; the answer is held back on its way to the screen.
    if (step === hold.step) { reached(); await gate; }
    return reply;
  };
  const flows = createEnrolmentFlows({ begin: async () => undefined, end: async () => { ends.push(sent.length); }, relay });
  const waiting = () => app.pairing.pending().length;
  return { flows, offer: decoded.offer, origin, signer, sent, ends, open, arrived, waiting };
}

test("closing while the enrolment starts — the host has accepted the proof, its answer has not arrived: the host's request is cancelled, once, before the release", { timeout: 15_000 }, async () => {
  const w = await flowWorld({ step: "prove" });
  const before = w.waiting();
  const starting = w.flows.start(w.offer, [w.origin], async () => w.signer, INFO);
  const outcome = starting.then(() => "started", (error) => error);
  await w.arrived;
  assert.equal(w.waiting(), before + 1, "the host waits for a code");
  // The person closes the dialog; leaving the screen asks again.
  const closed = w.flows.end(), unmounted = w.flows.end();
  await Promise.all([closed, unmounted]);
  assert.equal(w.waiting(), before, "the host no longer waits");
  assert.deepEqual(w.sent, ["challenge", "prove", "cancel"]);
  assert.deepEqual(w.ends, [3], "released once, after the cancel was answered");
  w.open();
  assert.ok((await outcome) instanceof EnrolmentSuperseded);
  assert.deepEqual(w.sent, ["challenge", "prove", "cancel"], "nothing is sent afterwards");
});

test("closing before the host's challenge answer has arrived: the request is cancelled as soon as it is known, and the proof is never sent", { timeout: 15_000 }, async () => {
  const w = await flowWorld({ step: "challenge" });
  const before = w.waiting();
  const outcome = w.flows.start(w.offer, [w.origin], async () => w.signer, INFO).then(() => "started", (error) => error);
  await w.arrived;
  const closed = w.flows.end();
  w.open();
  await closed;
  assert.ok((await outcome) instanceof EnrolmentSuperseded);
  assert.deepEqual(w.sent, ["challenge", "cancel"]);
  assert.deepEqual(w.ends, [2]);
  assert.equal(w.waiting(), before);
});

test("closing the code entry while signing is slow: exactly one cancel reaches the host, the enrolment ends once, and nothing is sent afterwards", { timeout: 15_000 }, async () => {
  const w = await flowWorld({ signing_ms: 300 });
  const before = w.waiting();
  const enrolment = await w.flows.start(w.offer, [w.origin], async () => w.signer, INFO);
  assert.equal(w.waiting(), before + 1);
  // Cancel in the dialog, the dialog's close and the unmount of the screen, all while the cancel is still being signed.
  const first = enrolment.cancel(), second = w.flows.end(), third = w.flows.end();
  assert.deepEqual(w.ends, [], "not released while the cancel is being signed");
  await Promise.all([first, second, third]);
  assert.deepEqual(w.sent, ["challenge", "prove", "cancel"]);
  assert.deepEqual(w.ends, [3]);
  assert.equal(w.waiting(), before);
  assert.equal(enrolment.live(), false);
  // The code typed a moment too late goes nowhere.
  await assert.rejects(enrolment.submitCode("123456"), EnrolmentSuperseded);
  assert.deepEqual(w.sent, ["challenge", "prove", "cancel"]);
  // The next start works, on a fresh enrolment: the host waits for a code again, and that one is cancelled in turn.
  const next = await w.flows.start(w.offer, [w.origin], async () => w.signer, INFO);
  assert.equal(next.live(), true);
  assert.notEqual(next.requestId, enrolment.requestId);
  assert.ok(app.pairing.pending().some((request) => request.requestId === next.requestId), "the host waits for the new request's code");
  await next.cancel();
  assert.ok(!app.pairing.pending().some((request) => request.requestId === next.requestId));
  assert.deepEqual(w.sent, ["challenge", "prove", "cancel", "challenge", "prove", "cancel"]);
  assert.equal(w.ends.length, 2);
});

test("the proof reached the host but its answer was lost: the host's request is cancelled before the release, and the caller is told the host did not answer", { timeout: 15_000 }, async () => {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl), signer = await createWebCryptoSigner(await generateDeviceKey());
  const sent: string[] = [], ends: number[] = [];
  const before = app.pairing.pending().length;
  let waitingAfterProof = -1;
  const relay: EnrolmentPost = async (path, body) => {
    const step = path.slice(path.lastIndexOf("/") + 1), text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (step === "verify") Object.assign(headers, await signedHeaders(signer, decoded.offer.gatewayId, "POST", path, text, 0));
    sent.push((body as { action?: string }).action === "cancel" ? "cancel" : step);
    const response = await fetch(origin + path, { method: "POST", headers, body: text });
    const reply = { status: response.status, body: await response.json().catch(() => null) };
    // The host accepted the proof; the connection drops before the answer is read.
    if (step === "prove") { waitingAfterProof = app.pairing.pending().length; throw new TypeError("fetch failed"); }
    return reply;
  };
  const flows = createEnrolmentFlows({ begin: async () => undefined, end: async () => { ends.push(sent.length); }, relay });
  await assert.rejects(flows.start(decoded.offer, [origin], async () => signer, INFO), { code: "GATEWAY_UNREACHABLE" });
  assert.equal(waitingAfterProof, before + 1, "the host was waiting for a code after the proof");
  assert.deepEqual(sent, ["challenge", "prove", "cancel"]);
  assert.equal(app.pairing.pending().length, before, "the host no longer waits");
  assert.deepEqual(ends, [3], "released once, after the cancel");
});

// ── The same rules on the DEFAULT transport (web and mobile: no relay, the client posts with `fetch`) ───────────────
async function fetchWorld(holdStep?: "challenge") {
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl), signer = await createWebCryptoSigner(await generateDeviceKey());
  const sent: string[] = [], ends: number[] = [];
  let open!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve)), arrived = new Promise<void>((resolve) => (reached = resolve));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input);
    if (!target.startsWith(`${origin}/jagentchill/v1/pair/`)) return realFetch(input, init);
    const step = target.slice(target.lastIndexOf("/") + 1);
    sent.push(/"action":"cancel"/.test(String(init?.body ?? "")) ? "cancel" : step);
    const response = await realFetch(input, init);
    if (step === holdStep) { reached(); await gate; }
    return response;
  }) as typeof fetch;
  const flows = createEnrolmentFlows({ begin: async () => undefined, end: async () => { ends.push(sent.length); } });
  return { flows, offer: decoded.offer, origin, signer, sent, ends, open, arrived, restore: () => { globalThis.fetch = realFetch; } };
}

test("default transport: closing before the challenge answer has arrived cancels the request and the proof is never sent — also after the release", { timeout: 15_000 }, async () => {
  const w = await fetchWorld("challenge");
  try {
    const before = app.pairing.pending().length;
    const outcome = w.flows.start(w.offer, [w.origin], async () => w.signer, INFO).then(() => "started", (error) => error);
    await w.arrived;
    const closed = w.flows.end();
    w.open();
    await closed;
    assert.ok((await outcome) instanceof EnrolmentSuperseded);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(w.sent, ["challenge", "cancel"], "no proof was sent, before or after the release");
    assert.deepEqual(w.ends, [2]);
    assert.equal(app.pairing.pending().length, before);
  } finally { w.restore(); }
});

test("default transport: a code submitted after the cancel is not sent", { timeout: 15_000 }, async () => {
  const w = await fetchWorld();
  try {
    const enrolment = await w.flows.start(w.offer, [w.origin], async () => w.signer, INFO);
    await enrolment.cancel();
    assert.deepEqual(w.sent, ["challenge", "prove", "cancel"]);
    await assert.rejects(enrolment.submitCode("123456"), EnrolmentSuperseded);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(w.sent, ["challenge", "prove", "cancel"], "no verify left the device");
    assert.deepEqual(w.ends, [3]);
  } finally { w.restore(); }
});

test("how the key is protected is read after the signer is loaded: a device whose key went to a file on this first pairing says so", { timeout: 15_000 }, async () => {
  // What `identity.electron.ts` does: `keyProtection()` answers "os-store" until `loadSigner()` has asked the main process.
  let protection = "os-store";
  const url = encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: wsUrl }], { rolePreset: "editor" }));
  const decoded = decodeOffer(url);
  assert.ok(decoded.ok);
  const origin = originOfAddress(wsUrl), signer = await createWebCryptoSigner(await generateDeviceKey());
  const flows = createEnrolmentFlows({ begin: async () => undefined, end: async () => undefined });
  const loadSigner = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); protection = "file"; return signer; };
  const enrolment = await flows.start(decoded.offer, [origin], loadSigner, () => ({ ...INFO, keyProtection: protection }));
  const request = app.pairing.pending().find((entry) => entry.requestId === enrolment.requestId)!;
  assert.equal((request as unknown as { keyProtection?: string }).keyProtection ?? JSON.stringify(request), "file");
  await enrolment.cancel();
});

test("default transport: cancelling while the code request is being SIGNED sends no verify — the check is repeated right before the request leaves", { timeout: 15_000 }, async () => {
  const w = await fetchWorld();
  try {
    // The first signature asked for (the verify request's) waits until the test lets it go.
    let entered!: () => void, release!: () => void, held = false;
    const signing = new Promise<void>((resolve) => (entered = resolve)), gate = new Promise<void>((resolve) => (release = resolve));
    const slow = { ...w.signer, signRequest: async (fields: Parameters<typeof w.signer.signRequest>[0]) => { if (!held) { held = true; entered(); await gate; } return w.signer.signRequest(fields); } };
    const enrolment = await w.flows.start(w.offer, [w.origin], async () => slow, INFO);
    const submitted = enrolment.submitCode("123456").then(() => "sent", (error: unknown) => error);
    await signing;
    const cancelled = enrolment.cancel();
    release();
    await cancelled;
    assert.ok((await submitted) instanceof EnrolmentSuperseded, "the submit is refused, not sent");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(!w.sent.includes("verify"), `no verify left the device: ${w.sent.join(", ")}`);
  } finally { w.restore(); }
});
