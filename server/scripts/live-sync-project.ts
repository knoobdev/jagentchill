// Shared by scripts that need a project on the host without driving the editor: builds a small project document
// (the builder of the server's tests) and syncs it the way a device does — snapshot blob, then `sync.doc.enable`.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { canonicalJson } from "@jagentchill/editor-core";
import { BLOB_CHUNK_BYTES, SIGNATURE_HEADERS, blobRoutes, requestCanonicalString, type DocRef, type ProjectDocument } from "@jagentchill/protocol";
import { buildProject } from "../test/support/tools.ts";
import { BASE, type Rpc } from "./live-lib.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function signed(device: Rpc, method: string, target: string, body: Uint8Array | object) {
  const bytes = body instanceof Uint8Array ? body : Buffer.from(JSON.stringify(body)), ts = Date.now(), nonce = randomBytes(16).toString("base64url");
  const signature = device.device.sign(requestCanonicalString({ gatewayId: device.offer.gatewayId, method, target, bodySha256: sha(bytes), ts, nonce }));
  const res = await fetch(BASE + target, { method, body: bytes as never, headers: { [SIGNATURE_HEADERS.device]: device.device.deviceId, [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature } });
  assert.equal(res.status, 200, `${method} ${target} → ${res.status}`);
  return res.json() as Promise<any>;
}
/** A project with a few slides, synced to the host; a session can be bound to its id. */
export async function syncedProject(device: Rpc, name = "Long chat"): Promise<{ projectId: string; sceneId: string; doc: DocRef }> {
  const project = buildProject({ slides: 4, name });
  const document = project.doc as ProjectDocument;
  const bytes = gzipSync(Buffer.from(canonicalJson(document))), address = sha(bytes), doc: DocRef = { kind: "project", id: document.metadata.id };
  const started = await signed(device, "POST", blobRoutes.init(address), { size: bytes.length, mime: "application/gzip", name: "snapshot.json.gz", chunkSize: BLOB_CHUNK_BYTES, purpose: "snapshot" });
  if (!started.exists) { await signed(device, "PUT", blobRoutes.chunk(address, 0), bytes); await signed(device, "POST", blobRoutes.complete(address), {}); }
  await device.call("jagentchill.sync.doc.enable", { doc, sha256: address, schemaVersion: document.schemaVersion, idempotencyKey: randomUUID() });
  return { projectId: document.metadata.id, sceneId: project.sceneId, doc };
}
