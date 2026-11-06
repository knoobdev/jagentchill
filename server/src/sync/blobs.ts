import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import {
  BLOB_CHUNK_BYTES, BLOB_MAX_BYTES, INCOMPLETE_UPLOAD_RETENTION_MS, MIN_FREE_DISK_BYTES, UNREFERENCED_BLOB_RETENTION_MS, chunkCount,
  type BlobInit, type BlobStatus, type HostBlobInfo, type HostStorageInfo,
} from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";


type BlobRow = {
  sha256: string; size: number; mime: string; name: string; state: "uploading" | "complete" | "unavailable"; purpose: string;
  linked_path: string | null; linked_mtime_ms: number | null; link_verified: number; variant_of: string | null; variant: string | null; uploader: string; created_ms: number; touched_ms: number;
};
export type BlobStoreDeps = {
  db: DatabaseSync; dir: string; now: () => number; quotaBytes: () => number;
  /** Free bytes of the data volume; replaced in tests. */
  freeDiskBytes?: () => number;
  /** How many documents, versions, trash entries and library items reference a blob. */
  refCount: (sha256: string) => number;
};
const quota = (reason: "quota" | "disk", availableBytes: number) => new ProtocolError("QUOTA_EXCEEDED", reason === "quota" ? "The host storage is full." : "The host disk is almost full.", { httpStatus: 507, details: { reason, availableBytes: Math.max(0, availableBytes) } });

/** Content-addressed files under `<dataDir>/blobs`: chunked resumable upload, verified assembly, ranged reads, linking in place. */
export function createBlobStore(deps: BlobStoreDeps) {
  const { db, dir, now } = deps;
  mkdirSync(join(dir, "tmp"), { recursive: true, mode: 0o700 });
  const finalPath = (sha256: string) => join(dir, sha256.slice(0, 2), sha256);
  const chunkDir = (sha256: string) => join(dir, "tmp", sha256);
  const row = (sha256: string) => db.prepare("SELECT * FROM blobs WHERE sha256 = ?").get(sha256) as BlobRow | undefined;
  const received = (sha256: string) => (db.prepare("SELECT idx FROM blob_chunks WHERE sha256 = ? ORDER BY idx").all(sha256) as { idx: number }[]).map((entry) => entry.idx);
  const freeDisk = () => { if (deps.freeDiskBytes) return deps.freeDiskBytes(); try { const info = statfsSync(dir); return Number(info.bavail) * Number(info.bsize); } catch { return Number.MAX_SAFE_INTEGER; } };
  /** Bytes counted against the quota: stored media and uploads in progress; linked files and snapshots are outside it. */
  const usedBytes = () => (db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM blobs WHERE linked_path IS NULL AND purpose <> 'snapshot'").get() as { total: number }).total;
  const forget = (sha256: string) => {
    rmSync(chunkDir(sha256), { recursive: true, force: true });
    db.prepare("DELETE FROM blob_chunks WHERE sha256 = ?").run(sha256);
    db.prepare("DELETE FROM blobs WHERE sha256 = ?").run(sha256);
  };
  /** A linked file is trusted only while its size and modified time are the ones it was linked with. */
  function assertReadable(blob: BlobRow): string {
    if (blob.state === "uploading") throw new ProtocolError("NOT_FOUND", "The blob is not complete.", { httpStatus: 404 });
    if (!blob.linked_path) return finalPath(blob.sha256);
    let ok = false;
    try { const info = statSync(blob.linked_path); ok = info.isFile() && info.size === blob.size && Math.abs(info.mtimeMs - (blob.linked_mtime_ms ?? 0)) < 2; } catch { ok = false; }
    if (ok !== (blob.state === "complete")) db.prepare("UPDATE blobs SET state = ? WHERE sha256 = ?").run(ok ? "complete" : "unavailable", blob.sha256);
    if (!ok) throw new ProtocolError("BLOB_UNAVAILABLE", "The linked file is missing or has changed.", { httpStatus: 404 });
    return blob.linked_path;
  }
  const variantsOf = (sha256: string) => Object.fromEntries((db.prepare("SELECT variant, variant_sha256, size FROM blob_variants WHERE sha256 = ?").all(sha256) as { variant: string; variant_sha256: string; size: number }[]).map((entry) => [entry.variant, { size: entry.size, sha256: entry.variant_sha256 }]));
  const info = (blob: BlobRow): HostBlobInfo => ({
    sha256: blob.sha256, size: blob.size, mime: blob.mime, name: blob.name, state: blob.state, variants: ["original", ...Object.keys(variantsOf(blob.sha256))],
    linked: blob.linked_path !== null, refCount: deps.refCount(blob.sha256), created_ms: blob.created_ms,
  });

  return {
    usedBytes, finalPath,
    exists: (sha256: string) => row(sha256)?.state === "complete",
    init(sha256: string, body: BlobInit, deviceId: string): { exists: boolean; receivedChunks: number[]; chunkSize: number } {
      if (body.size > BLOB_MAX_BYTES) throw new ProtocolError("BLOB_TOO_LARGE", "The file is larger than 64 GiB.", { httpStatus: 413 });
      let existing = row(sha256);
      // A link is only as good as its file: it is checked before the device is told that nothing needs uploading.
      if (existing?.linked_path) { try { assertReadable(existing); } catch { /* handled as unavailable below */ } existing = row(sha256); }
      if (existing?.state === "complete" || (existing?.state === "unavailable" && existing.linked_path)) {
        if (existing.state === "complete") { db.prepare("UPDATE blobs SET touched_ms = ? WHERE sha256 = ?").run(now(), sha256); return { exists: true, receivedChunks: [], chunkSize: BLOB_CHUNK_BYTES }; }
        // An unavailable link is replaced by the upload that brings the bytes.
        forget(sha256);
      } else if (existing && existing.size !== body.size) forget(sha256);
      else if (existing) { db.prepare("UPDATE blobs SET touched_ms = ? WHERE sha256 = ?").run(now(), sha256); return { exists: false, receivedChunks: received(sha256), chunkSize: BLOB_CHUNK_BYTES }; }
      if (body.variantOf && !row(body.variantOf.sha256)) throw new ProtocolError("NOT_FOUND", "The original of this variant is not on the host.", { httpStatus: 404 });
      // Snapshots are documents, not media: the quota never refuses them.
      if (body.purpose !== "snapshot") {
        const available = deps.quotaBytes() - usedBytes();
        if (body.size > available) throw quota("quota", available);
        const free = freeDisk();
        if (free - body.size < MIN_FREE_DISK_BYTES) throw quota("disk", free - MIN_FREE_DISK_BYTES);
      }
      db.prepare("INSERT INTO blobs (sha256, size, mime, name, state, purpose, variant_of, variant, uploader, created_ms, touched_ms) VALUES (?, ?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?)")
        .run(sha256, body.size, body.mime, body.name, body.purpose ?? "media", body.variantOf?.sha256 ?? null, body.variantOf?.variant ?? null, deviceId, now(), now());
      return { exists: false, receivedChunks: [], chunkSize: BLOB_CHUNK_BYTES };
    },
    putChunk(sha256: string, index: number, bytes: Uint8Array): { received: number } {
      const blob = row(sha256);
      if (!blob) throw new ProtocolError("NOT_FOUND", "No upload was started for this blob.", { httpStatus: 404 });
      const count = chunkCount(blob.size);
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new ProtocolError("CHUNK_OUT_OF_RANGE", "The chunk index is beyond the declared size.", { httpStatus: 416, details: { chunks: count } });
      if (blob.state !== "uploading") return { received: count };
      const expected = index === count - 1 ? blob.size - index * BLOB_CHUNK_BYTES : BLOB_CHUNK_BYTES;
      if (bytes.length !== expected) throw new ProtocolError("INVALID_PARAMS", "The chunk has the wrong length.", { details: { expected } });
      // A chunk that is already stored is acknowledged and not written a second time.
      if (!db.prepare("SELECT 1 FROM blob_chunks WHERE sha256 = ? AND idx = ?").get(sha256, index)) {
        mkdirSync(chunkDir(sha256), { recursive: true });
        const target = join(chunkDir(sha256), String(index));
        writeFileSync(`${target}.part`, bytes);
        renameSync(`${target}.part`, target);
        db.prepare("INSERT INTO blob_chunks (sha256, idx, size) VALUES (?, ?, ?)").run(sha256, index, bytes.length);
      }
      db.prepare("UPDATE blobs SET touched_ms = ? WHERE sha256 = ?").run(now(), sha256);
      return { received: received(sha256).length };
    },
    /** Assembles the chunks into one file while hashing them; the blob exists only when the hash is its address. */
    async complete(sha256: string): Promise<{ size: number }> {
      const blob = row(sha256);
      if (!blob) throw new ProtocolError("NOT_FOUND", "No upload was started for this blob.", { httpStatus: 404 });
      if (blob.state !== "uploading") return { size: blob.size };
      const have = new Set(received(sha256)), count = chunkCount(blob.size);
      const missing = Array.from({ length: count }, (_, index) => index).filter((index) => !have.has(index) && blob.size > 0);
      if (missing.length) throw new ProtocolError("BLOB_INCOMPLETE", "Some chunks were never received.", { httpStatus: 409, retryable: true, details: { missing } });
      const target = finalPath(sha256), assembling = `${target}.assembling`;
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash("sha256"), out = createWriteStream(assembling, { mode: 0o600 });
      for (let index = 0; index < count && blob.size > 0; index++) {
        for await (const piece of createReadStream(join(chunkDir(sha256), String(index)))) { hash.update(piece as Buffer); if (!out.write(piece)) await new Promise<void>((resolve) => out.once("drain", () => resolve())); }
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
      if (hash.digest("hex") !== sha256) {
        rmSync(assembling, { force: true });
        forget(sha256);
        throw new ProtocolError("BLOB_HASH_MISMATCH", "The uploaded bytes do not hash to the blob address.", { httpStatus: 422, retryable: true });
      }
      renameSync(assembling, target);
      rmSync(chunkDir(sha256), { recursive: true, force: true });
      db.prepare("DELETE FROM blob_chunks WHERE sha256 = ?").run(sha256);
      db.prepare("UPDATE blobs SET state = 'complete', touched_ms = ? WHERE sha256 = ?").run(now(), sha256);
      if (blob.variant_of && blob.variant) db.prepare("INSERT OR REPLACE INTO blob_variants (sha256, variant, variant_sha256, size) VALUES (?, ?, ?, ?)").run(blob.variant_of, blob.variant, sha256, blob.size);
      return { size: blob.size };
    },
    status(sha256: string): BlobStatus {
      const blob = row(sha256);
      if (!blob) return { state: "absent", size: 0, receivedChunks: [], variants: {} };
      if (blob.linked_path) { try { assertReadable(blob); } catch { /* reported as unavailable below */ } }
      const current = row(sha256)!;
      return { state: current.state, size: current.size, receivedChunks: current.state === "uploading" ? received(sha256) : [], variants: variantsOf(sha256) };
    },
    /** Where the bytes of a blob (or of one of its variants) are, for a ranged read. */
    locate(sha256: string, variant?: string): { path: string; size: number; mime: string; sha256: string } {
      let blob = row(sha256);
      if (!blob) throw new ProtocolError("NOT_FOUND", "No such blob.", { httpStatus: 404 });
      if (variant && variant !== "original") {
        const entry = db.prepare("SELECT variant_sha256 FROM blob_variants WHERE sha256 = ? AND variant = ?").get(sha256, variant) as { variant_sha256: string } | undefined;
        blob = entry && row(entry.variant_sha256);
        if (!blob || blob.state !== "complete") throw new ProtocolError("VARIANT_UNAVAILABLE", "This variant has not been produced yet.", { httpStatus: 404, retryable: true });
      }
      return { path: assertReadable(blob), size: blob.size, mime: blob.mime, sha256: blob.sha256 };
    },
    read(sha256: string): Buffer { return readFileSync(this.locate(sha256).path); },
    /** A blob the server writes itself (a snapshot it built). Stored once per content. */
    put(bytes: Uint8Array, meta: { mime: string; name: string; purpose: "snapshot" | "media" | "exports" }): { sha256: string; size: number } {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = row(sha256);
      if (existing?.state === "complete") return { sha256, size: existing.size };
      if (existing) forget(sha256);
      const target = finalPath(sha256);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(`${target}.part`, bytes, { mode: 0o600 });
      renameSync(`${target}.part`, target);
      db.prepare("INSERT INTO blobs (sha256, size, mime, name, state, purpose, uploader, created_ms, touched_ms) VALUES (?, ?, ?, ?, 'complete', ?, 'host', ?, ?)").run(sha256, bytes.length, meta.mime, meta.name, meta.purpose, now(), now());
      return { sha256, size: bytes.length };
    },
    /** Stores a host-produced file without holding the export in memory. */
    async putFile(source: string, meta: { mime: string; name: string; purpose: "snapshot" | "media" | "exports" }): Promise<{ sha256: string; size: number }> {
      const size = statSync(source).size, available = deps.quotaBytes() - usedBytes();
      if (meta.purpose !== "snapshot" && size > available) throw quota("quota", available);
      const free = freeDisk();
      if (meta.purpose !== "snapshot" && free - size < MIN_FREE_DISK_BYTES) throw quota("disk", free - MIN_FREE_DISK_BYTES);
      const hash = createHash("sha256"), targetPart = join(dir, "tmp", `host-${randomUUID()}.part`);
      const digest = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
      try { await pipeline(createReadStream(source), digest, createWriteStream(targetPart, { mode: 0o600 })); }
      catch (error) { rmSync(targetPart, { force: true }); throw error; }
      const sha256 = hash.digest("hex"), existing = row(sha256);
      if (existing?.state === "complete") { rmSync(targetPart, { force: true }); return { sha256, size: existing.size }; }
      if (existing) forget(sha256);
      const target = finalPath(sha256); mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); renameSync(targetPart, target);
      db.prepare("INSERT INTO blobs (sha256, size, mime, name, state, purpose, uploader, created_ms, touched_ms) VALUES (?, ?, ?, ?, 'complete', ?, 'host', ?, ?)")
        .run(sha256, size, meta.mime, meta.name, meta.purpose, now(), now());
      return { sha256, size };
    },
    /** A variant the host produced itself (a proxy, a thumbnail, a mezzanine): the file is moved in under its own address. */
    addVariant(sha256: string, variant: string, file: string, mime: string, name: string): { sha256: string; size: number } {
      const bytes = readFileSync(file), address = createHash("sha256").update(bytes).digest("hex"), existing = row(address);
      if (!existing || existing.state !== "complete") {
        if (existing) forget(address);
        const target = finalPath(address);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(`${target}.part`, bytes, { mode: 0o600 });
        renameSync(`${target}.part`, target);
        db.prepare("INSERT INTO blobs (sha256, size, mime, name, state, purpose, variant_of, variant, uploader, created_ms, touched_ms) VALUES (?, ?, ?, ?, 'complete', 'media', ?, ?, 'host', ?, ?)").run(address, bytes.length, mime, name, sha256, variant, now(), now());
      }
      db.prepare("INSERT OR REPLACE INTO blob_variants (sha256, variant, variant_sha256, size) VALUES (?, ?, ?, ?)").run(sha256, variant, address, bytes.length);
      return { sha256: address, size: bytes.length };
    },
    /** What a blob is, for the host's own use. */
    describe(sha256: string): { mime: string; purpose: string; variantOf: string | null; linked: boolean } | undefined { const blob = row(sha256); return blob && { mime: blob.mime, purpose: blob.purpose, variantOf: blob.variant_of, linked: blob.linked_path !== null }; },
    /** Records a file of the same machine as a blob without copying it. The hash is verified in the background. */
    link(sha256: string, body: { path: string; size: number; mtime_ms: number; mime?: string; name?: string }, deviceId: string): { linked: true } {
      let stat;
      try { stat = statSync(body.path); } catch { throw new ProtocolError("BLOB_UNAVAILABLE", "The file to link does not exist.", { httpStatus: 404 }); }
      if (!stat.isFile() || stat.size !== body.size || Math.abs(stat.mtimeMs - body.mtime_ms) >= 2) throw new ProtocolError("BLOB_UNAVAILABLE", "The file to link has changed.", { httpStatus: 404 });
      const existing = row(sha256);
      if (existing?.state === "complete" && !existing.linked_path) return { linked: true };
      if (existing) forget(sha256);
      db.prepare("INSERT INTO blobs (sha256, size, mime, name, state, purpose, linked_path, linked_mtime_ms, uploader, created_ms, touched_ms) VALUES (?, ?, ?, ?, 'complete', 'media', ?, ?, ?, ?, ?)")
        .run(sha256, body.size, body.mime ?? "application/octet-stream", body.name ?? body.path.split(/[\\/]/).pop() ?? "", body.path, stat.mtimeMs, deviceId, now(), now());
      return { linked: true };
    },
    /** Hashes linked files that were not verified yet; a file that is not what it was linked as becomes unavailable. */
    async verifyLinks(): Promise<void> {
      for (const blob of db.prepare("SELECT * FROM blobs WHERE linked_path IS NOT NULL AND link_verified = 0 AND state = 'complete'").all() as BlobRow[]) {
        const hash = createHash("sha256");
        // The record may have been relinked or replaced by an upload while the file was read: only this link is judged.
        try { await pipeline(createReadStream(blob.linked_path!), hash); } catch { db.prepare("UPDATE blobs SET state = 'unavailable' WHERE sha256 = ? AND linked_path = ?").run(blob.sha256, blob.linked_path); continue; }
        if (hash.digest("hex") === blob.sha256) db.prepare("UPDATE blobs SET link_verified = 1 WHERE sha256 = ? AND linked_path = ?").run(blob.sha256, blob.linked_path);
        else db.prepare("UPDATE blobs SET link_verified = 1, state = 'unavailable' WHERE sha256 = ? AND linked_path = ?").run(blob.sha256, blob.linked_path);
      }
    },
    get(sha256: string): HostBlobInfo {
      const blob = row(sha256);
      if (!blob) throw new ProtocolError("NOT_FOUND", "No such blob.", { httpStatus: 404 });
      return info(blob);
    },
    list(query: { search?: string; sort?: "name" | "date" | "size"; cursor?: number; limit?: number }): { blobs: HostBlobInfo[]; nextCursor: number | null; total: number } {
      const order = query.sort === "size" ? "size DESC" : query.sort === "date" ? "created_ms DESC" : "name COLLATE NOCASE, sha256";
      const like = `%${(query.search ?? "").replace(/[%_\\]/g, "\\$&")}%`, limit = query.limit ?? 50, offset = query.cursor ?? 0;
      const where = "purpose = 'media' AND variant_of IS NULL AND name LIKE ? ESCAPE '\\'";
      const rows = db.prepare(`SELECT * FROM blobs WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(like, limit, offset) as BlobRow[];
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM blobs WHERE ${where}`).get(like) as { total: number };
      return { blobs: rows.map(info), nextCursor: offset + rows.length < total ? offset + rows.length : null, total };
    },
    /** Removes a blob nothing references. Linked files are never deleted: only the record goes. */
    remove(sha256: string): void {
      const blob = row(sha256);
      if (!blob) throw new ProtocolError("NOT_FOUND", "No such blob.", { httpStatus: 404 });
      const refCount = deps.refCount(sha256);
      if (refCount > 0) throw new ProtocolError("CONFLICT", "The blob is still referenced.", { httpStatus: 409, details: { refCount } });
      for (const entry of db.prepare("SELECT variant_sha256 FROM blob_variants WHERE sha256 = ?").all(sha256) as { variant_sha256: string }[]) { rmSync(finalPath(entry.variant_sha256), { force: true }); forget(entry.variant_sha256); }
      db.prepare("DELETE FROM blob_variants WHERE sha256 = ?").run(sha256);
      if (!blob.linked_path) rmSync(finalPath(sha256), { force: true });
      forget(sha256);
    },
    /** The server dropped its last use of a snapshot blob. */
    discard(sha256: string): void {
      const blob = row(sha256);
      if (!blob || blob.purpose !== "snapshot" || deps.refCount(sha256) > 0) return;
      rmSync(finalPath(sha256), { force: true });
      forget(sha256);
    },
    usage(trashBytes: number, documentBytes: number): HostStorageInfo {
      const sum = (where: string) => (db.prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM blobs WHERE ${where}`).get() as { total: number }).total;
      return {
        quotaBytes: deps.quotaBytes(), usedBytes: usedBytes(), freeDiskBytes: freeDisk(), linkedBytes: sum("linked_path IS NOT NULL"),
        breakdown: {
          projects: documentBytes + sum("purpose = 'snapshot'"), media: sum("purpose = 'media' AND variant_of IS NULL AND linked_path IS NULL"), proxies: sum("variant_of IS NOT NULL"),
          exports: sum("purpose = 'exports'"), generated: 0, workspaces: 0, trash: trashBytes, backups: 0,
        },
      };
    },
    /** The background sweep: uploads idle for 7 days and stored blobs nothing has referenced for 24 hours go. */
    sweep(): { uploads: number; unreferenced: number } {
      let uploads = 0, unreferenced = 0;
      for (const blob of db.prepare("SELECT * FROM blobs WHERE state = 'uploading' AND touched_ms < ?").all(now() - INCOMPLETE_UPLOAD_RETENTION_MS) as BlobRow[]) { forget(blob.sha256); uploads += 1; }
      for (const blob of db.prepare("SELECT * FROM blobs WHERE state = 'complete' AND linked_path IS NULL AND variant_of IS NULL AND touched_ms < ?").all(now() - UNREFERENCED_BLOB_RETENTION_MS) as BlobRow[]) {
        if (deps.refCount(blob.sha256) > 0) continue;
        try { this.remove(blob.sha256); unreferenced += 1; } catch { /* referenced meanwhile */ }
      }
      // Chunk directories without a record are leftovers of a crash.
      for (const name of existsSync(join(dir, "tmp")) ? readdirSync(join(dir, "tmp")) : []) if (!row(name)) rmSync(join(dir, "tmp", name), { recursive: true, force: true });
      return { uploads, unreferenced };
    },
  };
}
export type BlobStore = ReturnType<typeof createBlobStore>;
