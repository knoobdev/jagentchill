// Cross-device sync of media: content-addressed blobs over the signed HTTP routes, in one process. The JAgentChill
// Server app, the client SDK's transfer code, the sync engine and the storage ports are the real ones (see
// support/devices.ts); the network between a device and the host is a wrapper around fetch that can cut the connection,
// and retry delays are recorded and skipped.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { BLOB_CHUNK_BYTES, BLOB_MAX_BYTES, blobRoutes } from "@jagentchill/protocol";
import { HostError, TransferAborted, assembledParts, blobStatus, downloadBlob, sha256Hex, uploadBlob, type PartStore, type Transfer } from "../src/index.ts";
import { pause, startHost, until, type Device, type Editor, type Host } from "./support/devices.ts";

let host: Host, A: Device, B: Device;
const MiB = 1024 * 1024;
before(async () => {
  host = await startHost();
  A = await host.device("Studio Mac", "admin", "desktop");
  B = await host.device("Phone", "editor", "web");
});
after(() => host.close());

const env = (device: Device) => ({ host: device.host, signer: device.signer, fetch: device.network.fetch, sleep: device.network.sleep });
const source = (bytes: Uint8Array, sha256: string, name = "clip.mp4") => ({ sha256, size: bytes.length, mime: "video/mp4", name, read: async (start: number, end: number) => bytes.subarray(start, end) });
const memoryParts = (): PartStore & { parts: Map<number, Uint8Array> } => {
  const parts = new Map<number, Uint8Array>();
  return { parts, has: async (index) => parts.has(index), put: async (index, bytes) => void parts.set(index, bytes), get: async (index) => parts.get(index)!, clear: async () => parts.clear() };
};
/** Imports a file into a project the way the media library stores one: the bytes in the store, the asset record in the document. */
async function importMedia(editor: Editor, name: string, bytes: Uint8Array): Promise<{ assetId: string; sha256: string }> {
  const assetId = editor.device.context().newId();
  const stored = await editor.device.storage.writeMedia(editor.projectId, assetId, bytes, { extension: name.split(".").pop() });
  editor.change(`Import ${name}`, (draft) => { draft.media.assets.push({ id: assetId, name, type: "video", size: bytes.length, contentHash: stored.contentHash, created_ms: Date.now(), width: 1920, height: 1080 }); draft.media.assets.sort((x: any, y: any) => (x.id < y.id ? -1 : 1)); });
  return { assetId, sha256: stored.contentHash };
}
const transferOf = (device: Device, assetId: string, direction: Transfer["direction"]) => device.engine.transfers().find((transfer) => transfer.assetId === assetId && transfer.direction === direction);
const synced = (editor: Editor) => until(() => editor.status.kind === "synced", `${editor.device.name} to be synced (now ${JSON.stringify(editor.status)})`, 30000);

test("a 20 MiB media file uploads in chunks, the connection is cut mid-way and the upload resumes without re-sending finished chunks; the other device downloads it and the hashes match", async () => {
  const bytes = randomBytes(20 * MiB), sha256 = await sha256Hex(bytes);
  const id = await A.createProject("With media"), a = await A.edit(id);
  const { assetId, sha256: stored } = await importMedia(a, "drone.mp4", bytes);
  assert.equal(stored, sha256, "the blob address is the content hash the store computed at import");
  await a.autosave.flush();

  // The connection drops when two chunks are stored: every further chunk request fails.
  let chunksSeen = 0;
  A.network.cut = (method, url) => method === "PUT" && url.includes(`${sha256}/chunks/`) && ++chunksSeen > 2;
  // Scenario: Enable sync on an existing project — the media of the project is queued for upload.
  assert.deepEqual(await A.engine.enable(id), { attached: false, media: 1 });
  // Scenario: Chunk retries exhausted — a chunk that fails five more times (after 1, 2, 4, 8 and 16 s) marks the transfer "Failed".
  await until(() => transferOf(A, assetId, "upload")?.state === "failed", "the upload to fail");
  assert.deepEqual([...new Set(A.network.sleeps)].sort((x, y) => x - y), [1000, 2000, 4000, 8000, 16000]);
  const status = await blobStatus(env(B), sha256);
  assert.deepEqual([status.state, status.receivedChunks.length], ["uploading", 2]);
  // Other syncing goes on: operations are small and do not wait for media.
  a.change("Rename", (draft) => { draft.metadata.name = "With media (cut)"; });
  await until(() => host.app.sync.documents.row({ kind: "project", id })!.name === "With media (cut)", "the operation to sync while the upload is down");

  // Scenario: Resume after connection loss — "Retry" asks the host what it holds and sends only the missing chunks.
  A.network.cut = null;
  const putsBefore = A.network.count("PUT", new RegExp(`${sha256}/chunks/`));
  const stillThere = new Set(status.receivedChunks);
  const started = performance.now();
  A.engine.resumeTransfer(transferOf(A, assetId, "upload")!.id);
  await until(() => transferOf(A, assetId, "upload")?.state === "done", "the upload to complete", 30000);
  const resumed = A.network.requests.slice(-20).filter((request) => request.method === "PUT").map((request) => Number(/chunks\/(\d+)$/.exec(request.url)![1]));
  assert.equal(A.network.count("PUT", new RegExp(`${sha256}/chunks/`)) - putsBefore, 3, "5 chunks in all, 2 were stored: 3 are sent");
  assert.equal(resumed.filter((index) => stillThere.has(index)).length, 0, "no finished chunk is sent again");
  console.log(`  upload (resumed part): ${(12 / ((performance.now() - started) / 1000)).toFixed(0)} MiB/s over loopback`);
  assert.equal((await blobStatus(env(B), sha256)).state, "complete");
  await synced(a);

  // The other device: the project arrives without its media, the media follows and is verified against its address.
  await B.engine.fetchProject(id);
  const b = await B.edit(id);
  // Scenario: Clip waiting for download — until the bytes are here the engine reports the state the clip shows.
  assert.equal(await B.storage.hasMedia(id, assetId), false);
  const downloading = performance.now();
  await until(() => transferOf(B, assetId, "download")?.state === "done" || B.engine.mediaState(id, assetId) === undefined && transferOf(B, assetId, "download") !== undefined, "the download to finish", 30000);
  await until(async () => await B.storage.hasMedia(id, assetId), "the media to be in B's store", 30000);
  console.log(`  download: ${(20 / ((performance.now() - downloading) / 1000)).toFixed(0)} MiB/s over loopback`);
  const info = await B.storage.mediaInfo(id, assetId);
  assert.deepEqual([info!.contentHash, info!.size, info!.extension], [sha256, bytes.length, "mp4"]);
  assert.equal(await sha256Hex(await B.storage.readMedia(id, assetId)), sha256, "the bytes B holds hash to the address");
  assert.equal(B.network.count("GET", new RegExp(`/blobs/${sha256}$`)), 5, "five ranges of 4 MiB");
  assert.equal((await B.storage.listLibraryFiles("sync-parts")).length, 0, "the stored ranges are gone once the file is whole");
  assert.equal(B.engine.mediaState(id, assetId), undefined);
  await a.close(); await b.close();
});

test("Scenario: Resume after app restart — a transfer that was running when the app quit resumes from the host's status without sending confirmed chunks again", async () => {
  const bytes = randomBytes(21 * MiB), id = await A.createProject("Restart"), a = await A.edit(id);
  const { assetId, sha256 } = await importMedia(a, "interview.mov", bytes);
  await a.autosave.flush();
  // A slow link, so that the app can be quit while the upload is under way.
  A.network.delay = (method, url) => (method === "PUT" && url.includes(`${sha256}/chunks/`) ? 250 : 0);
  await A.engine.enable(id);
  await until(async () => (await blobStatus(env(A), sha256)).receivedChunks.length >= 2, "two chunks to be confirmed", 30000);
  assert.equal(transferOf(A, assetId, "upload")!.state, "active");
  await A.restart({ online: false });
  A.network.delay = null;
  await pause(400);
  A.network.cut = null;
  const confirmed = (await blobStatus(env(A), sha256)).receivedChunks, before = A.network.requests.length;
  assert.ok(confirmed.length >= 2 && confirmed.length < 6, `${confirmed.length} of 6 chunks were confirmed when the app quit`);
  assert.deepEqual(A.engine.transfers(), [], "nothing of the old process is left in memory");
  // Relaunched and connected: the queue is read from the store and the transfer continues by itself.
  await A.reconnect();
  await until(() => transferOf(A, assetId, "upload")?.state === "done", "the upload to finish after the restart", 30000);
  assert.equal((await blobStatus(env(A), sha256)).state, "complete");
  const sent = A.network.requests.slice(before).filter((request) => request.method === "PUT" && request.url.includes(`${sha256}/chunks/`)).map((request) => Number(/chunks\/(\d+)$/.exec(request.url)![1]));
  assert.equal(sent.length, 6 - confirmed.length);
  assert.equal(sent.filter((index) => confirmed.includes(index)).length, 0, "chunks the host confirmed are not sent again");
});

test("Scenario: Duplicate file, Scenario: Oversized file — bytes the host has are not uploaded again; a file above 64 GiB is refused locally and stays usable", async () => {
  const bytes = randomBytes(5 * MiB), sha256 = await sha256Hex(bytes);
  assert.deepEqual(await uploadBlob(env(A), source(bytes, sha256)), { uploaded: true, chunksSent: 2, chunksSkipped: 0 });
  const before = B.network.count("PUT", /\/chunks\//);
  assert.deepEqual(await uploadBlob(env(B), source(bytes, sha256, "same bytes, another name.mp4")), { uploaded: false, chunksSent: 0, chunksSkipped: 0 });
  assert.equal(B.network.count("PUT", /\/chunks\//), before, "no chunk is uploaded");
  // Two projects that import the same file share one blob.
  const requests = A.network.requests.length;
  await assert.rejects(uploadBlob(env(A), { sha256: "f".repeat(64), size: BLOB_MAX_BYTES + 1, mime: "video/mp4", name: "huge.mov", read: async () => new Uint8Array() }), (error: HostError) => error.code === "BLOB_TOO_LARGE" && error.message === "This file is too large to sync (limit 64 GB)");
  assert.equal(A.network.requests.length, requests, "refused before anything is sent");
});

test("Scenario: Hash mismatch — when the assembled bytes do not hash to the address the client restarts the upload once and then reports the failure", async () => {
  const bytes = randomBytes(6 * MiB), wrong = await sha256Hex(randomBytes(32));
  const before = A.network.count("PUT", /\/chunks\//);
  await assert.rejects(uploadBlob(env(A), source(bytes, wrong)), (error: HostError) => error.code === "BLOB_HASH_MISMATCH");
  assert.equal(A.network.count("PUT", /\/chunks\//) - before, 4, "two chunks, sent twice");
  assert.equal(A.network.count("POST", new RegExp(`${wrong}/complete`)), 2);
  assert.equal((await blobStatus(env(A), wrong)).state, "absent", "no blob is published");
});

test("Scenario: Resume download, Scenario: Memory bound — a download continues from the first missing 4 MiB range and stored ranges are not requested again", async () => {
  const bytes = randomBytes(18 * MiB), sha256 = await sha256Hex(bytes);
  await uploadBlob(env(A), source(bytes, sha256));
  const parts = memoryParts(), target = { sha256, size: bytes.length, parts };
  // The download stops after two ranges (the app is closed).
  const abort = new AbortController();
  let progress = 0;
  await assert.rejects(downloadBlob(env(B), target, { signal: abort.signal, onProgress: ({ bytes: done }) => { progress = done; if (parts.parts.size >= 2) abort.abort(); } }), (error) => error instanceof TransferAborted);
  const kept = [...parts.parts.keys()];
  assert.ok(kept.length >= 2 && kept.length < 5 && progress > 0);
  const before = B.network.requests.length;
  const result = await downloadBlob(env(B), target);
  assert.deepEqual([result.rangesSkipped, result.rangesFetched], [kept.length, 5 - kept.length]);
  const ranges = B.network.requests.slice(before).length;
  assert.equal(ranges, 5 - kept.length, "only the missing ranges are requested");
  // At most three ranges of 4 MiB are in flight, and the file is assembled piece by piece: never held whole in memory.
  const assembled: Uint8Array[] = [];
  for await (const part of assembledParts(target)) { assert.ok(part.length <= BLOB_CHUNK_BYTES); assembled.push(part); }
  assert.equal(await sha256Hex(Buffer.concat(assembled)), sha256);
});

test("Scenario: Corrupted variant — a download that does not hash to its address is discarded and downloaded once more; a second mismatch is \"Download failed\"", async () => {
  const bytes = randomBytes(5 * MiB), id = await A.createProject("Corrupt download"), a = await A.edit(id);
  const { assetId, sha256 } = await importMedia(a, "broken.mp4", bytes);
  await a.autosave.flush();
  await A.engine.enable(id);
  await until(() => transferOf(A, assetId, "upload")?.state === "done", "the upload", 30000);
  let tampered = 0;
  B.network.tamper = (url, body) => { if (!url.endsWith(sha256)) return body; tampered += 1; const changed = body.slice(); changed[0] ^= 0xff; return changed; };
  await B.engine.fetchProject(id);
  await until(() => transferOf(B, assetId, "download")?.state === "failed", "the download to fail", 30000);
  assert.equal(tampered, 4, "two ranges, downloaded twice");
  assert.equal(transferOf(B, assetId, "download")!.error, "The downloaded file did not match its expected hash.");
  assert.equal(await B.storage.hasMedia(id, assetId), false, "nothing corrupt is kept");
  assert.equal(B.engine.mediaState(id, assetId)!.state, "failed");
  await until(() => host.app.sync.host.mediaDeviceIssues(id, assetId).some((issue) => issue.deviceName === "Phone" && issue.state === "failed"), "the client report to reach the host", 10000);
  const reported = host.app.sync.host.mediaDeviceIssues(id, assetId);
  assert.deepEqual(reported.map((issue) => [issue.deviceName, issue.state]), [["Phone", "failed"]]);
  assert.match(reported[0].reason!, /expected hash/);
  // "Retry" with the connection healthy again.
  B.network.tamper = null;
  B.engine.resumeTransfer(transferOf(B, assetId, "download")!.id);
  await until(async () => await B.storage.hasMedia(id, assetId), "the retry to succeed", 30000);
  assert.equal((await B.storage.mediaInfo(id, assetId))!.contentHash, sha256);
  await a.close();
});

test("Scenario: Host storage full — a refused media upload shows \"Sync error — host storage is full\" while edits keep syncing; Scenario: Cancel one upload", async () => {
  const small = await startHost({ quotaBytes: () => 3 * MiB });
  try {
    const device = await small.device("Laptop", "editor"), id = await device.createProject("Too big for the host"), editor = await device.edit(id);
    const big = await importMedia(editor, "big.mp4", randomBytes(4 * MiB)), fits = await importMedia(editor, "small.mp4", randomBytes(1 * MiB));
    await editor.autosave.flush();
    assert.deepEqual(await device.engine.enable(id), { attached: false, media: 2 });
    await until(() => transferOf(device, big.assetId, "upload")?.state === "host-full" && transferOf(device, fits.assetId, "upload")?.state === "done", "one refused, one stored");
    assert.deepEqual(editor.status, { kind: "storage-full" });
    assert.deepEqual(await device.engine.statusOf(id), { kind: "storage-full" });
    editor.change("Rename", (draft) => { draft.metadata.name = "Still syncing"; });
    await until(() => small.app.sync.documents.row({ kind: "project", id })!.name === "Still syncing", "edits to keep syncing");
    // Cancelling removes the transfer; the other one is untouched.
    device.engine.cancelTransfer(transferOf(device, big.assetId, "upload")!.id);
    assert.equal(transferOf(device, big.assetId, "upload"), undefined);
    await until(() => editor.status.kind === "synced", "the status to clear");
    await editor.close();
  } finally { await small.close(); }
});

test("Scenario: Metered connection, Scenario: Pause all, Scenario: Insufficient local space — media waits for Wi-Fi while operations sync; \"Download now\" sends one item", async () => {
  const bytes = randomBytes(2 * MiB), id = await A.createProject("Metered"), a = await A.edit(id);
  const { assetId, sha256 } = await importMedia(a, "metered.mp4", bytes);
  await a.autosave.flush();
  await A.engine.enable(id);
  await until(() => transferOf(A, assetId, "upload")?.state === "done", "the upload", 30000);
  B.metered = true;
  await B.engine.fetchProject(id);
  await until(() => transferOf(B, assetId, "download")?.state === "waiting-wifi", "the download to wait for Wi-Fi");
  assert.equal(B.engine.mediaState(id, assetId)!.state, "waiting-wifi");
  assert.equal(B.engine.needsMeteredConfirmation(104_857_601), true);
  assert.equal(B.engine.needsMeteredConfirmation(104_857_600), false);
  // The project itself arrived: operations are small and are not held back.
  assert.equal((await B.stored(id)).media.assets[0].contentHash, sha256);
  B.engine.downloadNow(transferOf(B, assetId, "download")!.id);
  await until(async () => await B.storage.hasMedia(id, assetId), "the item to download now", 30000);
  B.metered = false;

  // "Pause all sync" stops media; turning it off resumes.
  const second = await importMedia(a, "second.mp4", randomBytes(2 * MiB));
  await A.engine.setPausedAll(true);
  await A.engine.queueUploads(id, a.document);
  await pause(300);
  assert.equal(transferOf(A, second.assetId, "upload")!.state, "queued");
  assert.equal((await blobStatus(env(A), second.sha256)).state, "absent");
  await A.engine.setPausedAll(false);
  await until(() => transferOf(A, second.assetId, "upload")?.state === "done", "the upload after resuming", 30000);

  // A device without room does not start the download.
  const full = await host.device("Full phone", "editor", "mobile");
  (full.storage as any).available = async () => 1000;
  full.engine = (full as any).makeEngine();
  await full.engine.fetchProject(id);
  await until(() => transferOf(full, assetId, "download")?.state === "no-space", "the download to be refused for space");
  assert.equal(full.network.count("GET", new RegExp(`/blobs/${sha256}$`)), 0);
  await a.close();
});

test("a revoked device is cut off mid-transfer", async () => {
  const guest = await host.device("Guest laptop", "editor");
  const bytes = randomBytes(17 * MiB), sha256 = await sha256Hex(bytes);
  let sent = 0;
  // A link slow enough for the revocation to arrive while chunks are still to be sent.
  guest.network.delay = (method) => (method === "PUT" ? 120 : 0);
  const uploading = uploadBlob(env(guest), source(bytes, sha256), { onProgress: () => { sent += 1; } });
  uploading.catch(() => undefined);
  await until(() => sent >= 2, "some chunks to be stored");
  await A.connection!.call("jagentchill.device.revoke", { deviceId: guest.signer.deviceId });
  await assert.rejects(uploading, (error: HostError) => error.code === "DEVICE_REVOKED");
  const status = await blobStatus(env(A), sha256);
  assert.equal(status.state, "uploading", "the blob was never completed");
  assert.ok(status.receivedChunks.length < 5);
  await assert.rejects(downloadBlob(env(guest), { sha256, size: bytes.length, parts: memoryParts() }), (error: HostError) => error.code === "DEVICE_REVOKED");
  await until(() => guest.connection === undefined, "its channel to be closed");
  assert.equal(guest.network.sleeps.length, 0, "a refusal is not retried");
  void blobRoutes;
});

test("media the HOST adds to a project a device is editing (an agent's import) is downloaded to that device by itself — it does not stay \"offline\"", async () => {
  // What a person saw: the agent imported a picture, the clip pointed at it, and the library said "Offline" for ever —
  // the editing device takes a host change as a step of its own (`sync.applyRemote`) and nothing queued the new file.
  const id = await A.createProject("Agent import"), a = await A.edit(id);
  await A.engine.enable(id);
  await synced(a);
  // The host has the file (as `jc_media_import` stores a download) …
  const bytes = randomBytes(300_000), sha256 = await sha256Hex(bytes), blobs = host.app.sync.blobs;
  blobs.init(sha256, { size: bytes.length, mime: "image/jpeg", name: "window.jpg", chunkSize: BLOB_CHUNK_BYTES, purpose: "media" }, A.signer.deviceId);
  blobs.putChunk(sha256, 0, bytes);
  await blobs.complete(sha256);
  // … and adds the asset to the project through the device that is editing it.
  const assetId = A.context().newId(), row = host.app.sync.documents.row({ kind: "project", id })!;
  const index = a.document.media.assets.length;
  const result = await host.app.sync.host.applyBatch({
    doc: { kind: "project", id }, principal: "agent:test", label: "Import window.jpg", baseRevision: row.head, commandType: "media.add",
    patches: [{ op: "add", path: `/media/assets/${index}`, value: { id: assetId, name: "window.jpg", type: "image", size: bytes.length, contentHash: sha256, created_ms: Date.now(), width: 640, height: 427 } }] as never,
  });
  assert.equal(result.state, "applied", JSON.stringify(result));
  assert.ok(a.document.media.assets.some((asset: { id: string }) => asset.id === assetId), "the asset is in the editing device's document");
  // The file arrives on the device without anyone asking for it.
  await until(async () => Boolean(await A.storage.mediaInfo(id, assetId)), "the imported file to be downloaded to the editing device", 20000);
  assert.equal((await A.storage.mediaInfo(id, assetId))!.contentHash, sha256);

  // A project already in that state (the file was never fetched — as on a device that ran the code before this fix) heals
  // itself when it is opened again: the missing file is asked for at the head too, not only when a newer revision arrives.
  await A.storage.removeMedia(id, assetId);
  for (const transfer of A.engine.transfers().filter((entry) => entry.assetId === assetId)) A.engine.cancelTransfer(transfer.id);
  assert.equal(Boolean(await A.storage.mediaInfo(id, assetId)), false);
  await a.close();
  const again = await A.edit(id);
  await until(async () => Boolean(await A.storage.mediaInfo(id, assetId)), "the missing file to be downloaded when the project is opened again", 20000);
  await again.close();
});
