// Cross-device sync, media bytes: content-addressed blobs over the signed HTTP routes — chunked resumable upload,
// verified assembly, ranged download, linking, variants, quota and the storage sweep. Devices are simulated
// (test/device-sim.ts); the server app, its blob directory on disk and its request authenticator are real.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { BLOB_CHUNK_BYTES, blobRoutes } from "@jagentchill/protocol";
import { createHarness, type Harness } from "./harness.ts";
import { sampleDocument, sha256Hex, support, type Paired } from "./support/sync.ts";

let h: Harness, s: ReturnType<typeof support>;
let offset = 0, quota = 2 ** 40;
const now = () => Date.now() + offset;
let admin: Paired, editor: Paired, phone: Paired, viewer: Paired, guest: Paired;
const DAY = 86_400_000;
const init = (size: number, over: Record<string, unknown> = {}) => ({ size, mime: "video/mp4", name: "clip.mp4", chunkSize: BLOB_CHUNK_BYTES, ...over });
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : []);

before(async () => {
  h = await createHarness({ now, sync: { quotaBytes: () => quota, freeDiskBytes: () => 2 ** 50 } });
  s = support(h, now);
  admin = await h.pair("Studio Mac", "admin", "macos");
  editor = await h.pair("Laptop", "editor");
  phone = await h.pair("Phone", "editor");
  viewer = await h.pair("Client iPad", "viewer");
  guest = await h.pair("Guest", "editor");
  // The desktop app that started this server: the record the trust bootstrap flags.
  h.app.db.prepare("UPDATE devices SET local_supervisor = 1 WHERE device_id = ?").run(admin.device.deviceId);
});
after(() => h.close());

test("Scenario: Duplicate file — the second init answers exists: true, no chunk is uploaded and the bytes are stored once", async () => {
  const bytes = randomBytes(BLOB_CHUNK_BYTES + 1234), sha256 = sha256Hex(bytes);
  assert.equal(await s.upload(editor, bytes, { name: "sunset.mp4" }), sha256);
  const again = await s.send(phone, "POST", blobRoutes.init(sha256), init(bytes.length, { name: "sunset (copy).mp4" }));
  assert.deepEqual(again.body, { exists: true, receivedChunks: [], chunkSize: BLOB_CHUNK_BYTES });
  const stored = files(join(h.dataDir, "blobs")).filter((file) => file.endsWith(sha256));
  assert.equal(stored.length, 1, "one file under blobs/, named by its address");
  assert.equal(statSync(stored[0]).size, bytes.length);
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM blob_chunks").get()!.n, 0, "no database row holds the bytes and no chunk is left");
  const info = await phone.call("jagentchill.blob.get", { sha256 });
  assert.deepEqual([info.size, info.name, info.state, info.linked, info.variants], [bytes.length, "sunset.mp4", "complete", false, ["original"]]);
});

test("Scenario: Oversized file — a file above 64 GiB is refused with BLOB_TOO_LARGE", async () => {
  const refused = await s.send(editor, "POST", blobRoutes.init("a".repeat(64)), init(70 * 2 ** 30));
  assert.deepEqual([refused.status, refused.body.error.code], [413, "BLOB_TOO_LARGE"]);
  assert.equal((await s.send(editor, "GET", blobRoutes.status("a".repeat(64)))).body.state, "absent");
  assert.equal((await s.send(editor, "POST", blobRoutes.init("b".repeat(64)), init(64 * 2 ** 30))).status, 200, "exactly 64 GiB is allowed");
});

test("Scenario: Resume after connection loss — status lists the chunks received and only the missing ones need sending; a chunk sent twice is stored once", async () => {
  const bytes = randomBytes(BLOB_CHUNK_BYTES * 3 + 500), sha256 = sha256Hex(bytes);
  const chunk = (index: number) => bytes.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES);
  assert.deepEqual((await s.send(editor, "POST", blobRoutes.init(sha256), init(bytes.length))).body, { exists: false, receivedChunks: [], chunkSize: BLOB_CHUNK_BYTES });
  for (const index of [0, 2]) assert.equal((await s.send(editor, "PUT", blobRoutes.chunk(sha256, index), chunk(index))).status, 200);
  // The connection is lost here. Afterwards — also from another connection or after a restart of the app — the device asks.
  const status = (await s.send(editor, "GET", blobRoutes.status(sha256))).body;
  assert.deepEqual(status, { state: "uploading", size: bytes.length, receivedChunks: [0, 2], variants: {} });
  assert.deepEqual((await s.send(editor, "POST", blobRoutes.init(sha256), init(bytes.length))).body.receivedChunks, [0, 2], "a repeated init resumes, it does not restart");
  const before = statSync(join(h.dataDir, "blobs", "tmp", sha256, "0")).mtimeMs;
  assert.deepEqual((await s.send(editor, "PUT", blobRoutes.chunk(sha256, 0), chunk(0))).body, { received: 2 });
  assert.equal(statSync(join(h.dataDir, "blobs", "tmp", sha256, "0")).mtimeMs, before, "not written a second time");

  // Scenario: Complete with a gap — complete while a chunk was never received names it.
  const gap = await s.send(editor, "POST", blobRoutes.complete(sha256), {});
  assert.deepEqual([gap.status, gap.body.error.code, gap.body.error.retryable, gap.body.error.details.missing], [409, "BLOB_INCOMPLETE", true, [1, 3]]);
  for (const index of [1, 3]) await s.send(editor, "PUT", blobRoutes.chunk(sha256, index), chunk(index));
  assert.deepEqual((await s.send(editor, "POST", blobRoutes.complete(sha256), {})).body, { complete: true, size: bytes.length });
  assert.deepEqual((await s.send(editor, "GET", blobRoutes.status(sha256))).body, { state: "complete", size: bytes.length, receivedChunks: [], variants: {} });
  assert.equal(existsSync(join(h.dataDir, "blobs", "tmp", sha256)), false);
  // A wrong chunk length is refused before anything is written.
  const other = sha256Hex("x");
  await s.send(editor, "POST", blobRoutes.init(other), init(BLOB_CHUNK_BYTES + 10));
  assert.equal((await s.send(editor, "PUT", blobRoutes.chunk(other, 0), new Uint8Array(100))).body.error.code, "INVALID_PARAMS");
});

test("Scenario: Hash mismatch — bytes that do not hash to the address give BLOB_HASH_MISMATCH, every chunk is deleted and no blob is published", async () => {
  const bytes = randomBytes(50_000), wrong = sha256Hex("not these bytes");
  await s.send(editor, "POST", blobRoutes.init(wrong), init(bytes.length));
  await s.send(editor, "PUT", blobRoutes.chunk(wrong, 0), bytes);
  const result = await s.send(editor, "POST", blobRoutes.complete(wrong), {});
  assert.deepEqual([result.status, result.body.error.code, result.body.error.retryable], [422, "BLOB_HASH_MISMATCH", true]);
  assert.equal((await s.send(editor, "GET", blobRoutes.status(wrong))).body.state, "absent");
  assert.equal((await s.send(editor, "GET", blobRoutes.bytes(wrong))).status, 404);
  assert.equal(files(join(h.dataDir, "blobs")).filter((file) => file.includes(wrong)).length, 0);
});

test("Scenario: Chunk out of range — chunk index 300 of a blob declared as 256 chunks answers CHUNK_OUT_OF_RANGE and nothing is stored", async () => {
  const sha256 = "c".repeat(64);
  assert.equal((await s.send(editor, "POST", blobRoutes.init(sha256), init(256 * BLOB_CHUNK_BYTES))).status, 200);
  const result = await s.send(editor, "PUT", blobRoutes.chunk(sha256, 300), randomBytes(1000));
  assert.deepEqual([result.status, result.body.error.code, result.body.error.details.chunks], [416, "CHUNK_OUT_OF_RANGE", 256]);
  assert.deepEqual((await s.send(editor, "GET", blobRoutes.status(sha256))).body.receivedChunks, []);
  assert.equal(existsSync(join(h.dataDir, "blobs", "tmp", sha256)), false);
});

test("Scenario: Resume download — ranges of a blob are served on their own, signed; an unsigned request is refused", async () => {
  const bytes = randomBytes(BLOB_CHUNK_BYTES * 2 + 77), sha256 = await s.upload(editor, bytes);
  const head = await fetch(h.base + blobRoutes.bytes(sha256), { method: "HEAD" });
  assert.equal(head.status, 401);
  const unsigned = await fetch(h.base + blobRoutes.bytes(sha256));
  assert.deepEqual([unsigned.status, ((await unsigned.json()) as any).error.code], [401, "SIGNATURE_MISSING"]);
  const second = await s.send(viewer, "GET", blobRoutes.bytes(sha256), undefined, { range: `bytes=${BLOB_CHUNK_BYTES}-${2 * BLOB_CHUNK_BYTES - 1}` });
  assert.deepEqual([second.status, second.headers.get("content-range"), second.body.length], [206, `bytes ${BLOB_CHUNK_BYTES}-${2 * BLOB_CHUNK_BYTES - 1}/${bytes.length}`, BLOB_CHUNK_BYTES]);
  assert.equal(Buffer.compare(second.body, bytes.subarray(BLOB_CHUNK_BYTES, 2 * BLOB_CHUNK_BYTES)), 0);
  const last = await s.send(viewer, "GET", blobRoutes.bytes(sha256), undefined, { range: `bytes=${2 * BLOB_CHUNK_BYTES}-${3 * BLOB_CHUNK_BYTES - 1}` });
  assert.deepEqual([last.status, last.body.length], [206, 77], "the last range is the remainder");
  assert.equal((await s.send(viewer, "GET", blobRoutes.bytes(sha256), undefined, { range: `bytes=${bytes.length}-` })).status, 416);
  const whole = await s.send(viewer, "GET", blobRoutes.bytes(sha256));
  assert.deepEqual([whole.status, sha256Hex(whole.body), whole.headers.get("x-jagentchill-sha256")], [200, sha256, sha256]);
  const signedHead = await s.send(viewer, "HEAD", blobRoutes.bytes(sha256));
  assert.deepEqual([signedHead.status, signedHead.headers.get("content-length"), signedHead.headers.get("accept-ranges")], [200, String(bytes.length), "bytes"]);
});

test("Scenario: Corrupted variant, Scenario: Variant not ready — a variant has its own size and sha256 in status; one not produced answers HTTP 404 VARIANT_UNAVAILABLE", async () => {
  const original = randomBytes(300_000), proxy = randomBytes(40_000), sha256 = await s.upload(editor, original);
  const missing = await s.send(phone, "GET", blobRoutes.variant(sha256, "preview"));
  assert.deepEqual([missing.status, missing.body.error.code, missing.body.error.retryable], [404, "VARIANT_UNAVAILABLE", true]);
  // The importing device produced the proxy and uploads it as a variant of the original.
  const proxySha = await s.upload(editor, proxy, { variantOf: { sha256, variant: "preview" }, name: "clip.preview.mp4" });
  const status = (await s.send(phone, "GET", blobRoutes.status(sha256))).body;
  assert.deepEqual(status.variants, { preview: { size: proxy.length, sha256: proxySha } });
  const served = await s.send(phone, "GET", blobRoutes.variant(sha256, "preview"));
  assert.equal(sha256Hex(served.body), status.variants.preview.sha256, "a client verifies a variant against the sha256 of status");
  assert.deepEqual((await phone.call("jagentchill.blob.get", { sha256 })).variants, ["original", "preview"]);
  assert.deepEqual(await phone.call("jagentchill.blob.variant.request", { sha256, variant: "preview" }), { state: "ready", size: proxy.length, sha256: proxySha });
  assert.equal((await s.send(phone, "GET", blobRoutes.variant(sha256, "thumb"))).body.error.code, "VARIANT_UNAVAILABLE");
  // Variants are not media of their own in the host space.
  assert.equal((await phone.call("jagentchill.blob.list", {})).blobs.some((blob: any) => blob.sha256 === proxySha), false);
});

test("Scenario: Link from a remote device, Scenario: Desktop sync without duplication, Scenario: Linking after a key rotation, Scenario: Linked file deleted", async () => {
  const path = join(h.dataDir, "..", `jc-linked-${randomUUID()}.mov`), bytes = randomBytes(3_000_000), sha256 = sha256Hex(bytes);
  writeFileSync(path, bytes);
  try {
    const body = { path, size: bytes.length, mtime_ms: statSync(path).mtimeMs, mime: "video/quicktime", name: "beach.mov" };
    // A device that is not the local supervisor — a phone, or any other device even over loopback — is refused.
    const refused = await s.send(phone, "POST", blobRoutes.link(sha256), body);
    assert.deepEqual([refused.status, refused.body.error.code], [403, "SCOPE_DENIED"]);
    const forwarded = await s.send(admin, "POST", blobRoutes.link(sha256), body, { "x-forwarded-for": "100.64.0.9" });
    assert.deepEqual([forwarded.status, forwarded.body.error.code], [403, "SCOPE_DENIED"], "a request attributed to another address is not local");

    const usedBefore = (await admin.call("jagentchill.settings.storage.get")).usedBytes, diskBefore = files(join(h.dataDir, "blobs")).length;
    assert.deepEqual((await s.send(admin, "POST", blobRoutes.link(sha256), body)).body, { linked: true });
    await h.app.sync.blobs.verifyLinks();
    const storage = await admin.call("jagentchill.settings.storage.get");
    assert.deepEqual([storage.linkedBytes, storage.usedBytes - usedBefore, files(join(h.dataDir, "blobs")).length - diskBefore], [bytes.length, 0, 0], "linked bytes are outside the quota and are not copied");
    assert.equal((await admin.call("jagentchill.blob.get", { sha256 })).linked, true);
    const read = await s.send(phone, "GET", blobRoutes.bytes(sha256), undefined, { range: "bytes=1000-1999" });
    assert.equal(Buffer.compare(read.body, bytes.subarray(1000, 2000)), 0, "served in place");

    // The flag is the record's: a record that carries it (after a key rotation, or "Restore this computer as admin") links; one that lost it does not.
    h.app.db.prepare("UPDATE devices SET local_supervisor = 0 WHERE device_id = ?").run(admin.device.deviceId);
    assert.equal((await s.send(admin, "POST", blobRoutes.link(sha256), body)).status, 403);
    h.app.db.prepare("UPDATE devices SET local_supervisor = 1 WHERE device_id = ?").run(admin.device.deviceId);
    assert.equal((await s.send(admin, "POST", blobRoutes.link(sha256), body)).status, 200);

    // The file changes: size and modified time are checked on every read.
    utimesSync(path, new Date(), new Date(Date.now() + 60_000));
    assert.equal((await s.send(phone, "GET", blobRoutes.bytes(sha256))).body.error.code, "BLOB_UNAVAILABLE");
    assert.equal((await s.send(admin, "POST", blobRoutes.link(sha256), { ...body, mtime_ms: statSync(path).mtimeMs })).status, 200, "the desktop relinks");
    rmSync(path);
    const gone = await s.send(phone, "GET", blobRoutes.bytes(sha256));
    assert.deepEqual([gone.status, gone.body.error.code], [404, "BLOB_UNAVAILABLE"]);
    assert.equal((await s.send(phone, "GET", blobRoutes.status(sha256))).body.state, "unavailable");
    // The sweep never deletes a linked file's record as if it were stored bytes, and an upload replaces a dead link.
    assert.equal(await s.upload(admin, bytes), sha256);
    assert.equal((await admin.call("jagentchill.blob.get", { sha256 })).linked, false);
  } finally { rmSync(path, { force: true }); }
});

test("Scenario: Host storage full, Scenario: Storage nearly full — an init the quota or the free disk space cannot hold answers QUOTA_EXCEEDED with the reason", async () => {
  const used = (await admin.call("jagentchill.settings.storage.get")).usedBytes;
  quota = used + 1000;
  try {
    const refused = await s.send(editor, "POST", blobRoutes.init("d".repeat(64)), init(1001));
    assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details], [507, "QUOTA_EXCEEDED", { reason: "quota", availableBytes: 1000 }]);
    const storage = await viewer.call("jagentchill.settings.storage.get");
    assert.deepEqual([storage.quotaBytes, storage.usedBytes], [used + 1000, used]);
    assert.ok(storage.usedBytes / storage.quotaBytes >= 0.9, "the host space shows the warning from 90 %");
    assert.deepEqual(Object.keys(storage.breakdown).sort(), ["backups", "exports", "generated", "media", "projects", "proxies", "trash", "workspaces"]);
    // Snapshots are documents: the quota never refuses them, so turning sync on works on a full host.
    assert.equal((await s.enable(editor, sampleDocument(randomUUID(), "On a full host"))).kind, "project");
    assert.equal((await s.send(editor, "POST", blobRoutes.init("d".repeat(64)), init(1000))).status, 200, "exactly what is left fits");
  } finally { quota = 2 ** 40; }
  const tight = await createHarness({ sync: { freeDiskBytes: () => 2 ** 30 + 500 } });
  try {
    const device = await tight.pair("Laptop", "editor");
    const refused = await signerOf(tight)(device, "POST", blobRoutes.init("e".repeat(64)), init(501));
    assert.deepEqual([refused.status, refused.body.error.details], [507, { reason: "disk", availableBytes: 500 }]);
  } finally { tight.close(); }
});
const signerOf = (harness: Harness) => support(harness).send;

test("Scenario: Deleting a referenced blob — CONFLICT with details.refCount 1, and the blob is kept; the Media section lists blobs with their reference counts", async () => {
  const bytes = randomBytes(9000), sha256 = await s.upload(editor, bytes, { name: "b-roll.mp4" });
  const document = sampleDocument(randomUUID(), "With media");
  document.media.assets.push({ id: "a1", name: "b-roll.mp4", contentHash: sha256, size: bytes.length });
  const doc = await s.enable(editor, document);
  const refused = await editor.fail("jagentchill.blob.delete", { sha256 });
  assert.deepEqual([refused.code, refused.details.refCount], ["CONFLICT", 1]);
  const listed = await viewer.call("jagentchill.blob.list", { search: "b-roll", sort: "size" });
  assert.deepEqual(listed.blobs.map((blob: any) => [blob.name, blob.refCount, blob.linked, blob.variants]), [["b-roll.mp4", 1, false, ["original"]]]);
  assert.equal((await viewer.fail("jagentchill.blob.delete", { sha256 })).code, "SCOPE_DENIED");
  // Removing the asset from the document is an ordinary operation; the blob can go once nothing references it.
  const { lease } = await editor.call("jagentchill.sync.lease.acquire", { doc });
  const { versionId } = await editor.call("jagentchill.sync.version.create", { doc, name: "With b-roll", idempotencyKey: randomUUID() });
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: [s.op([{ op: "remove", path: "/media/assets/@a1" }])] });
  assert.equal((await editor.call("jagentchill.blob.get", { sha256 })).refCount, 1, "the named version still names it");
  assert.equal((await editor.fail("jagentchill.blob.delete", { sha256 })).code, "CONFLICT");
  await editor.call("jagentchill.sync.version.delete", { versionId });
  assert.equal((await editor.call("jagentchill.blob.get", { sha256 })).refCount, 0);
  await editor.call("jagentchill.blob.delete", { sha256 });
  assert.equal((await s.send(editor, "GET", blobRoutes.status(sha256))).body.state, "absent");
  assert.equal(files(join(h.dataDir, "blobs")).filter((file) => file.endsWith(sha256)).length, 0);
});

test("a revoked device is cut off mid-transfer: its next chunk and its next range are refused", async () => {
  const bytes = randomBytes(BLOB_CHUNK_BYTES + 10), sha256 = sha256Hex(bytes), existing = await s.upload(editor, randomBytes(5000));
  await s.send(guest, "POST", blobRoutes.init(sha256), init(bytes.length));
  assert.equal((await s.send(guest, "PUT", blobRoutes.chunk(sha256, 0), bytes.subarray(0, BLOB_CHUNK_BYTES))).status, 200);
  assert.equal((await s.send(guest, "GET", blobRoutes.bytes(existing), undefined, { range: "bytes=0-99" })).status, 206);
  await admin.call("jagentchill.device.revoke", { deviceId: guest.device.deviceId });
  const chunk = await s.send(guest, "PUT", blobRoutes.chunk(sha256, 1), bytes.subarray(BLOB_CHUNK_BYTES));
  assert.deepEqual([chunk.status, chunk.body.error.code], [403, "DEVICE_REVOKED"]);
  const range = await s.send(guest, "GET", blobRoutes.bytes(existing), undefined, { range: "bytes=100-199" });
  assert.deepEqual([range.status, range.body.error.code], [403, "DEVICE_REVOKED"]);
  assert.equal((await s.send(guest, "POST", blobRoutes.complete(sha256), {})).status, 403);
  assert.deepEqual((await s.send(editor, "GET", blobRoutes.status(sha256))).body.receivedChunks, [0], "what it sent stays resumable for a device that is still paired");
});

test("Scenario: Cancel one upload — chunks of an upload stay resumable for 7 days; the sweep then removes it, and stored blobs nothing references for 24 hours", async () => {
  const partial = randomBytes(BLOB_CHUNK_BYTES + 5), partialSha = sha256Hex(partial);
  await s.send(editor, "POST", blobRoutes.init(partialSha), init(partial.length));
  await s.send(editor, "PUT", blobRoutes.chunk(partialSha, 0), partial.subarray(0, BLOB_CHUNK_BYTES));
  const orphan = await s.upload(editor, randomBytes(4000));
  const used = randomBytes(4000), usedSha = await s.upload(editor, used);
  const document = sampleDocument(randomUUID(), "Keeps its media");
  document.media.assets.push({ id: "a1", contentHash: usedSha });
  await s.enable(editor, document);

  offset += 6 * DAY;
  assert.deepEqual(h.app.sync.storageSweep().uploads, 0);
  assert.deepEqual((await s.send(editor, "GET", blobRoutes.status(partialSha))).body.receivedChunks, [0], "still resumable after 6 days");
  assert.equal((await s.send(editor, "GET", blobRoutes.status(orphan))).body.state, "absent", "unreferenced for more than 24 hours");
  assert.equal((await s.send(editor, "GET", blobRoutes.status(usedSha))).body.state, "complete", "a referenced blob is never swept");
  offset += 2 * DAY;
  assert.equal(h.app.sync.storageSweep().uploads >= 1, true);
  assert.equal((await s.send(editor, "GET", blobRoutes.status(partialSha))).body.state, "absent");
  assert.equal(existsSync(join(h.dataDir, "blobs", "tmp", partialSha)), false);
});
