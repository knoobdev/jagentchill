// Test support for cross-device sync: devices are simulated (a key and the wire protocol, see device-sim.ts); the
// server app, its database, its blob directory and the lease manager are the real ones.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { canonicalJson } from "@jagentchill/editor-core";
import { BLOB_CHUNK_BYTES, SIGNATURE_HEADERS, blobRoutes, requestCanonicalString, type DocRef, type SyncPatchEntry } from "@jagentchill/protocol";
import type { DeviceSim } from "../device-sim.ts";
import type { Harness } from "../harness.ts";

export type Paired = Awaited<ReturnType<Harness["pair"]>>;
export const sha256Hex = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A document as the server sees one: canonical JSON with id-keyed arrays. It never interprets more than that. */
export function sampleDocument(id: string, name = "Hoi An lanterns", elements = 2): any {
  return {
    schemaVersion: 32, minReaderSchemaVersion: 32, metadata: { id, name, duration: 240000, updated_ms: 1 },
    scenes: [{ id: "s1", name: "Scene 1", isMain: true, tracks: { main: { id: "m1", elements: Array.from({ length: elements }, (_, index) => ({ id: `e${index + 1}`, startTime: index * 120000, duration: 120000, opacity: 1 })) }, overlay: [], audio: [] } }],
    media: { assets: [] },
  };
}

export function signer(h: Harness, now: () => number = Date.now) {
  /** One signed HTTP request of a device; the body is bytes or JSON. */
  return async function send(paired: { device: DeviceSim; offer: { gatewayId: string } }, method: string, target: string, body?: Uint8Array | object, headers: Record<string, string> = {}) {
    const bytes = body === undefined ? undefined : body instanceof Uint8Array ? body : Buffer.from(JSON.stringify(body));
    const ts = now(), nonce = randomBytes(16).toString("base64url");
    const signature = paired.device.sign(requestCanonicalString({ gatewayId: paired.offer.gatewayId, method, target, bodySha256: sha256Hex(bytes ?? new Uint8Array()), ts, nonce }));
    const res = await fetch(h.base + target, {
      method, body: bytes as never,
      headers: { [SIGNATURE_HEADERS.device]: paired.device.deviceId, [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature, ...headers },
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, body: type.includes("json") ? ((await res.json()) as any) : new Uint8Array(await res.arrayBuffer()) };
  };
}

export function support(h: Harness, now: () => number = Date.now) {
  const send = signer(h, now);
  /** init → every chunk → complete. Returns the address. */
  async function upload(paired: Paired, bytes: Uint8Array, init: Record<string, unknown> = {}): Promise<string> {
    const sha256 = sha256Hex(bytes);
    const started = await send(paired, "POST", blobRoutes.init(sha256), { size: bytes.length, mime: "application/octet-stream", name: "blob.bin", chunkSize: BLOB_CHUNK_BYTES, ...init });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    if (started.body.exists) return sha256;
    for (let index = 0; index * BLOB_CHUNK_BYTES < bytes.length; index++) {
      const put = await send(paired, "PUT", blobRoutes.chunk(sha256, index), bytes.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES));
      assert.equal(put.status, 200, JSON.stringify(put.body));
    }
    const done = await send(paired, "POST", blobRoutes.complete(sha256), {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    return sha256;
  }
  const snapshot = (paired: Paired, document: object) => upload(paired, gzipSync(Buffer.from(canonicalJson(document))), { purpose: "snapshot", mime: "application/gzip" });
  /** Turns sync on for a new document and returns its reference. */
  async function enable(paired: Paired, document: any, kind: "project" | "script" = "project"): Promise<DocRef> {
    const doc: DocRef = { kind, id: document.metadata?.id ?? document.id };
    await paired.call("jagentchill.sync.doc.enable", { doc, sha256: await snapshot(paired, document), schemaVersion: document.schemaVersion, idempotencyKey: randomUUID() });
    return doc;
  }
  const op = (patches: SyncPatchEntry[], over: Record<string, unknown> = {}) => ({ opId: randomUUID(), created_ms: now(), commandType: "element.update", label: "Change opacity", patches, schemaVersion: 32, ...over });
  /** `count` operations, each changing the opacity of e1 to a new value. */
  const ops = (count: number, from = 0) => Array.from({ length: count }, (_, index) => op([{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e1/opacity", value: ((from + index) % 100) / 100 }]));
  const head = (doc: DocRef) => h.app.sync.documents.row(doc)!.head;
  const headDocument = (doc: DocRef) => h.app.sync.documents.head(h.app.sync.documents.row(doc)! as never) as any;
  const eventsOf = (paired: Paired, event: string) => paired.events.filter((entry) => entry.event === event).map((entry) => entry.payload);
  return { send, upload, snapshot, enable, op, ops, head, headDocument, eventsOf };
}

/** Another connection of an already paired device (a second tab, or the same app instance reconnecting). */
export async function connect(paired: Paired, clientInstanceId: string) {
  const session = paired.device.connect(paired.offer as never, { clientInstanceId });
  const { ready } = await session.outcome;
  assert.ok(ready, "expected a ready frame");
  const pending = new Map<string, (frame: any) => void>(), events: Array<{ event: string; payload: any }> = [];
  let id = 0;
  session.ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.t === "res") pending.get(frame.id)?.(frame); else if (frame.t === "evt") events.push({ event: frame.event, payload: frame.payload });
  });
  const raw = (method: string, params?: unknown) => new Promise<any>((resolve) => { const requestId = `x${++id}`; pending.set(requestId, resolve); session.ws.send(JSON.stringify({ t: "req", id: requestId, method, params })); });
  return {
    ...paired, ws: session.ws, events, ready,
    async call(method: string, params?: unknown): Promise<any> { const frame = await raw(method, params); assert.equal(frame.ok, true, `${method} failed: ${JSON.stringify(frame.error)}`); return frame.result; },
    async fail(method: string, params?: unknown): Promise<{ code: string; message: string; details?: any; retryable: boolean }> { const frame = await raw(method, params); assert.equal(frame.ok, false, `${method} was expected to fail`); return frame.error; },
    close: () => new Promise<void>((resolve) => { session.ws.once("close", () => resolve()); session.ws.close(); }),
  };
}
