import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { DocumentRejected, applyPatch, canonicalJson, type StatePatch } from "@jagentchill/editor-core";
import {
  AUTOMATIC_SNAPSHOTS_RETAINED, CONFLICT_VERSION_RETENTION_MS, MAX_SCHEMA_VERSION, PUSH_MAX_BYTES, PUSH_MAX_OPS, SNAPSHOT_EVERY_OPS, TRASH_RETENTION_MS,
  docKey, type DocRef, type LogDocKind, type PushedOp, type SyncAuthor, type SyncOp, type SyncVersion, type TrashEntry,
} from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";
import { transaction } from "../store/database.ts";
import type { BlobStore } from "./blobs.ts";


type DocRow = {
  kind: LogDocKind; id: string; head: number; schema_version: number; min_reader: number; name: string; duration: number; cover_sha256: string | null;
  updated_ms: number; created_ms: number; last_author: string; state: "active" | "trash" | "purged"; trashed_ms: number | null; trashed_by: string | null; ops_since_snapshot: number;
};
type Json = Record<string, unknown>;
const COLUMNS = "kind, id, head, schema_version, min_reader, name, duration, cover_sha256, updated_ms, created_ms, last_author, state, trashed_ms, trashed_by, ops_since_snapshot";
const SHA = /^[0-9a-f]{64}$/;
const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Every blob address a document names, found without knowing its shape: any 64-hex string under a hash key. */
export function blobReferences(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const entry of value) blobReferences(entry, out); return out; }
  if (!isObject(value)) return out;
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === "string") { if ((name === "contentHash" || name === "sha256" || name === "blobSha256") && SHA.test(entry)) out.add(entry); } else blobReferences(entry, out);
  }
  return out;
}
/** What the host space lists of a document, read from the fields every synced kind carries. */
function describe(document: Json): { name: string; duration: number; cover: string | null; minReader: number | null } {
  const metadata = isObject(document.metadata) ? document.metadata : document, cover = isObject(document.cover) && isObject(document.cover.image) ? document.cover.image.sha256 : null;
  return {
    name: typeof metadata.name === "string" ? metadata.name : typeof document.title === "string" ? document.title : "", duration: Math.max(0, Math.round(number(metadata.duration, 0))),
    cover: typeof cover === "string" && SHA.test(cover) ? cover : null, minReader: typeof document.minReaderSchemaVersion === "number" ? document.minReaderSchemaVersion : null,
  };
}
const notSynced = (doc: DocRef) => new ProtocolError(doc.kind === "script" ? "SCRIPT_NOT_SYNCED" : "PROJECT_NOT_SYNCED", "This document has no copy on the host.", { httpStatus: 404 });
const schemaTooNew = (kind: LogDocKind, max: number) => new ProtocolError("SCHEMA_TOO_NEW", "The document schema is newer than this host supports.", { details: { kind, max } });

/**
 * The host's copy of synced projects and scripts: the operation log, the head document, revision snapshots and named
 * versions. Patches are applied with the generic applier — no command of the editor ever runs here.
 */
export function createDocumentStore(deps: { db: DatabaseSync; now: () => number; blobs: BlobStore; maxSchemaVersion?: { project: number; script: number; workflow: number } }) {
  const { db, now, blobs } = deps, max = deps.maxSchemaVersion ?? MAX_SCHEMA_VERSION;
  // The parsed head of the documents in use; the database holds the canonical text.
  const heads = new Map<string, { revision: number; document: Json }>();
  const row = (doc: DocRef) => db.prepare(`SELECT ${COLUMNS} FROM sync_docs WHERE kind = ? AND id = ?`).get(doc.kind, doc.id) as DocRow | undefined;
  function require(doc: DocRef): DocRow {
    const found = row(doc);
    if (!found) throw notSynced(doc);
    if (found.state === "trash") throw new ProtocolError("PROJECT_IN_TRASH", "This document is in the host trash.", { httpStatus: 409, details: { deleted_ms: found.trashed_ms } });
    if (found.state === "purged") throw new ProtocolError("PROJECT_PURGED", "This document was removed from the host.", { httpStatus: 410 });
    return found;
  }
  function head(found: DocRow): Json {
    const key = docKey(found), cached = heads.get(key);
    if (cached?.revision === found.head) return cached.document;
    const { head_json: text } = db.prepare("SELECT head_json FROM sync_docs WHERE kind = ? AND id = ?").get(found.kind, found.id) as { head_json: string };
    const document = JSON.parse(text) as Json;
    heads.set(key, { revision: found.head, document });
    if (heads.size > 32) heads.delete(heads.keys().next().value!);
    return document;
  }
  const snapshotAt = (doc: DocRef, atOrBelow: number) => db.prepare("SELECT revision, sha256, size FROM sync_snapshots WHERE kind = ? AND id = ? AND revision <= ? ORDER BY revision DESC LIMIT 1").get(doc.kind, doc.id, atOrBelow) as { revision: number; sha256: string; size: number } | undefined;
  const oldestOp = (doc: DocRef) => (db.prepare("SELECT MIN(revision) AS revision FROM sync_ops WHERE kind = ? AND id = ?").get(doc.kind, doc.id) as { revision: number | null }).revision;

  function setReferences(doc: DocRef, document: Json): void {
    db.prepare("DELETE FROM sync_doc_blobs WHERE kind = ? AND id = ?").run(doc.kind, doc.id);
    for (const sha256 of blobReferences(document)) db.prepare("INSERT OR IGNORE INTO sync_doc_blobs (kind, id, sha256) VALUES (?, ?, ?)").run(doc.kind, doc.id, sha256);
  }
  /** Writes the head: the canonical text, what the host space lists, and the revision. */
  function store(doc: DocRef, document: Json, revision: number, schemaVersion: number, author: SyncAuthor, opsSinceSnapshot: number, references: boolean): void {
    const about = describe(document);
    db.prepare("UPDATE sync_docs SET head = ?, schema_version = ?, min_reader = ?, name = ?, duration = ?, cover_sha256 = ?, updated_ms = ?, last_author = ?, head_json = ?, ops_since_snapshot = ? WHERE kind = ? AND id = ?")
      .run(revision, schemaVersion, about.minReader ?? schemaVersion, about.name, about.duration, about.cover, now(), JSON.stringify(author), canonicalJson(document), opsSinceSnapshot, doc.kind, doc.id);
    heads.set(docKey(doc), { revision, document });
    if (references) setReferences(doc, document);
  }
  /** A full snapshot of the head, gzip of its canonical JSON, addressed by SHA-256. Old automatic ones and the operations before them go. */
  function snapshot(doc: DocRef): { revision: number; sha256: string; size: number } {
    const found = row(doc)!, existing = snapshotAt(doc, found.head);
    if (existing?.revision === found.head) return existing;
    const stored = blobs.put(gzipSync(Buffer.from(canonicalJson(head(found)), "utf8")), { mime: "application/gzip", name: `${doc.kind}-${doc.id}-r${found.head}.json.gz`, purpose: "snapshot" });
    db.prepare("INSERT INTO sync_snapshots (kind, id, revision, sha256, size, created_ms) VALUES (?, ?, ?, ?, ?, ?)").run(doc.kind, doc.id, found.head, stored.sha256, stored.size, now());
    db.prepare("UPDATE sync_docs SET ops_since_snapshot = 0 WHERE kind = ? AND id = ?").run(doc.kind, doc.id);
    const all = db.prepare("SELECT revision, sha256 FROM sync_snapshots WHERE kind = ? AND id = ? ORDER BY revision DESC").all(doc.kind, doc.id) as { revision: number; sha256: string }[];
    for (const old of all.slice(AUTOMATIC_SNAPSHOTS_RETAINED)) {
      db.prepare("DELETE FROM sync_snapshots WHERE kind = ? AND id = ? AND revision = ?").run(doc.kind, doc.id, old.revision);
      blobs.discard(old.sha256);
    }
    const oldest = all[Math.min(all.length, AUTOMATIC_SNAPSHOTS_RETAINED) - 1];
    // Operations up to the oldest retained snapshot are no longer needed to reach any retained state.
    if (oldest) db.prepare("DELETE FROM sync_ops WHERE kind = ? AND id = ? AND revision <= ?").run(doc.kind, doc.id, oldest.revision);
    return { revision: found.head, ...stored };
  }
  /** The document a gzip snapshot blob holds. */
  function readSnapshot(sha256: string): Json {
    if (!blobs.exists(sha256)) throw new ProtocolError("BLOB_INCOMPLETE", "The snapshot was not uploaded.", { retryable: true, details: { missing: [] } });
    let document: unknown;
    try { document = JSON.parse(gunzipSync(blobs.read(sha256)).toString("utf8")); } catch { throw new ProtocolError("INVALID_PARAMS", "The snapshot is not a gzip-compressed JSON document."); }
    if (!isObject(document) || "local" in document) throw new ProtocolError("PATCH_INVALID", "A snapshot is the canonical document without its device-local section.", { details: { documentCode: "document/patch-invalid" } });
    return document;
  }
  const versionOf = (entry: any, names: (deviceId: string) => string): SyncVersion => ({
    versionId: entry.version_id, doc: { kind: entry.kind, id: entry.id }, name: entry.name, revision: entry.revision, created_ms: entry.created_ms, authorDeviceId: entry.author_device,
    authorName: names(entry.author_device), source: entry.source, expires_ms: entry.expires_ms, sha256: entry.sha256, size: entry.size,
  });
  /** Versions made by conflict resolution go after 30 days unless they were renamed. */
  function expireVersions(): void {
    for (const { version_id: versionId, sha256 } of db.prepare("SELECT version_id, sha256 FROM sync_versions WHERE expires_ms IS NOT NULL AND expires_ms < ?").all(now()) as { version_id: string; sha256: string }[]) {
      db.prepare("DELETE FROM sync_versions WHERE version_id = ?").run(versionId);
      db.prepare("DELETE FROM sync_version_blobs WHERE version_id = ?").run(versionId);
      blobs.discard(sha256);
    }
  }
  function addVersion(doc: DocRef, name: string, deviceId: string, source: "user" | "conflict"): string {
    const at = snapshot(doc), versionId = randomUUID();
    db.prepare("INSERT INTO sync_versions (version_id, kind, id, revision, name, created_ms, author_device, source, expires_ms, sha256, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(versionId, doc.kind, doc.id, at.revision, name, now(), deviceId, source, source === "conflict" ? now() + CONFLICT_VERSION_RETENTION_MS : null, at.sha256, at.size);
    // A version keeps the media of its state alive after the head stopped naming it.
    for (const sha256 of blobReferences(head(row(doc)!))) db.prepare("INSERT OR IGNORE INTO sync_version_blobs (version_id, sha256) VALUES (?, ?)").run(versionId, sha256);
    return versionId;
  }
  function commitSnapshot(doc: DocRef, document: Json, schemaVersion: number, meta: { commandType: string; label: string; opId?: string }, author: SyncAuthor, sha256?: string): SyncOp {
    const found = require(doc);
    if (schemaVersion > max[found.kind]) throw schemaTooNew(found.kind, max[found.kind]);
    const revision = found.head + 1;
    return transaction(db, () => {
      store(doc, document, revision, schemaVersion, author, 0, true);
      const at = snapshot(doc);
      const op: SyncOp = { opId: meta.opId ?? randomUUID(), doc, revision, baseRevision: found.head, author, created_ms: now(), commandType: meta.commandType, label: meta.label, patches: [], schemaVersion, snapshot: { sha256: sha256 ?? at.sha256, size: at.size } };
      // The log entry of a snapshot revision keeps the address appliers fetch; it carries no patches.
      db.prepare("INSERT OR REPLACE INTO sync_ops (kind, id, revision, op_id, json) VALUES (?, ?, ?, ?, ?)").run(doc.kind, doc.id, revision, op.opId, JSON.stringify({ ...op, snapshot: { sha256: at.sha256, size: at.size } }));
      return { ...op, snapshot: { sha256: at.sha256, size: at.size } };
    });
  }

  return {
    row, require, head, snapshot, expireVersions, maxSchemaVersion: max,
    /** The newest snapshot at or below the head: what a device downloads before the operations after it. */
    headSnapshot: (doc: DocRef) => snapshotAt(doc, Number.MAX_SAFE_INTEGER)!,
    list(kind: LogDocKind, query: { search?: string; sort?: "name" | "date" | "size"; cursor?: number; limit?: number }): { rows: DocRow[]; nextCursor: number | null; total: number } {
      const order = query.sort === "name" ? "name COLLATE NOCASE, id" : query.sort === "size" ? "LENGTH(head_json) DESC" : "updated_ms DESC, id";
      const like = `%${(query.search ?? "").replace(/[%_\\]/g, "\\$&")}%`, limit = query.limit ?? 50, offset = query.cursor ?? 0;
      const rows = db.prepare(`SELECT ${COLUMNS} FROM sync_docs WHERE kind = ? AND state = 'active' AND name LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT ? OFFSET ?`).all(kind, like, limit, offset) as DocRow[];
      const { total } = db.prepare("SELECT COUNT(*) AS total FROM sync_docs WHERE kind = ? AND state = 'active' AND name LIKE ? ESCAPE '\\'").get(kind, like) as { total: number };
      return { rows, nextCursor: offset + rows.length < total ? offset + rows.length : null, total };
    },
    /** Turning sync on: revision 1 from the uploaded snapshot, or attachment to the copy the host already has. */
    enable(doc: DocRef, sha256: string, schemaVersion: number, author: SyncAuthor): { attached: boolean; head: number } {
      const existing = row(doc);
      if (existing?.state === "active") return { attached: true, head: existing.head };
      if (existing?.state === "trash") throw new ProtocolError("PROJECT_IN_TRASH", "This document is in the host trash.", { httpStatus: 409 });
      const kind = doc.kind as LogDocKind;
      if (schemaVersion > max[kind]) throw schemaTooNew(kind, max[kind]);
      const document = readSnapshot(sha256);
      transaction(db, () => {
        // A purged id may be synced again: it starts over at revision 1.
        for (const table of ["sync_docs", "sync_ops", "sync_snapshots", "sync_doc_blobs"]) db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`).run(doc.kind, doc.id);
        db.prepare("INSERT INTO sync_docs (kind, id, head, schema_version, min_reader, name, duration, updated_ms, created_ms, last_author, state, head_json) VALUES (?, ?, 0, ?, ?, '', 0, ?, ?, ?, 'active', '{}')")
          .run(doc.kind, doc.id, schemaVersion, schemaVersion, now(), now(), JSON.stringify(author));
        store(doc, document, 1, schemaVersion, author, 0, true);
        snapshot(doc);
      });
      return { attached: false, head: 1 };
    },
    /**
     * Accepts a batch from the writer: consecutive revisions, idempotent by `opId`, every patch applied to the head with
     * the generic applier. Nothing is stored unless the whole batch applies.
     */
    push(doc: DocRef, baseRevision: number, ops: PushedOp[], author: SyncAuthor): { revisions: number[]; head: number; ops: SyncOp[]; snapshot?: { revision: number; sha256: string; size: number } } {
      const found = require(doc);
      if (ops.length > PUSH_MAX_OPS || Buffer.byteLength(JSON.stringify(ops)) > PUSH_MAX_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "A batch holds at most 100 operations and 393 216 bytes; commit a snapshot instead.", { httpStatus: 413 });
      // A batch that was stored before its answer got lost: the same revisions again.
      const known = ops.map((op) => (db.prepare("SELECT revision FROM sync_ops WHERE kind = ? AND id = ? AND op_id = ?").get(doc.kind, doc.id, op.opId) as { revision: number } | undefined)?.revision);
      if (known.every((revision) => revision !== undefined)) return { revisions: known as number[], head: found.head, ops: [] };
      for (const op of ops) if (op.schemaVersion > max[found.kind]) throw schemaTooNew(found.kind, max[found.kind]);
      if (baseRevision !== found.head) throw new ProtocolError("REVISION_CONFLICT", "The operations are not based on the head revision.", { httpStatus: 409, details: { head: found.head } });
      let document = head(found), middle: Json | undefined;
      // The snapshot of every 200th operation is taken at exactly that revision, also when a batch crosses it.
      const splitAt = SNAPSHOT_EVERY_OPS - found.ops_since_snapshot;
      const accepted: SyncOp[] = [];
      ops.forEach((op, at) => {
        const refuse = (index: number) => new ProtocolError("PATCH_INVALID", "A patch of the batch does not apply.", { details: { opId: op.opId, index, documentCode: "document/patch-invalid" } });
        const local = op.patches.findIndex((entry) => entry.path === "/local" || entry.path.startsWith("/local/"));
        if (local >= 0) throw refuse(local);
        try { document = applyPatch(document, op.patches as StatePatch); } catch (error) {
          if (!(error instanceof DocumentRejected)) throw error;
          // The applier reports the path it stopped at: the index of the first entry with it.
          const path = error.errors[0]?.path;
          throw refuse(Math.max(0, op.patches.findIndex((entry) => entry.path === path)));
        }
        accepted.push({ ...op, doc, revision: found.head + at + 1, baseRevision: found.head + at, author });
        if (at + 1 === splitAt && at + 1 < ops.length) middle = document;
      });
      const newHead = found.head + ops.length, since = found.ops_since_snapshot + ops.length;
      let taken: { revision: number; sha256: string; size: number } | undefined;
      transaction(db, () => {
        for (const op of accepted) db.prepare("INSERT INTO sync_ops (kind, id, revision, op_id, json) VALUES (?, ?, ?, ?, ?)").run(doc.kind, doc.id, op.revision, op.opId, JSON.stringify(op));
        const schemaVersion = Math.max(found.schema_version, ...ops.map((op) => op.schemaVersion));
        if (middle) { store(doc, middle, found.head + splitAt, schemaVersion, author, SNAPSHOT_EVERY_OPS, false); taken = snapshot(doc); }
        store(doc, document, newHead, schemaVersion, author, middle ? ops.length - splitAt : since, true);
        if (!middle && since >= SNAPSHOT_EVERY_OPS) taken = snapshot(doc);
      });
      return { revisions: accepted.map((op) => op.revision), head: newHead, ops: accepted, ...(taken ? { snapshot: taken } : {}) };
    },
    /** Operations after a revision, or `SNAPSHOT_REQUIRED` when they were discarded with an old snapshot. */
    pull(doc: DocRef, afterRevision: number, limit = 100): { ops: SyncOp[]; head: number } {
      const found = require(doc), first = oldestOp(doc);
      if (afterRevision < found.head && (first === null || afterRevision < first - 1)) {
        const nearest = snapshotAt(doc, found.head)!;
        throw new ProtocolError("SNAPSHOT_REQUIRED", "The operations after that revision are no longer kept; fetch the snapshot.", { httpStatus: 409, details: { revision: nearest.revision, sha256: nearest.sha256, size: nearest.size } });
      }
      const out: SyncOp[] = [];
      let bytes = 0;
      for (const entry of db.prepare("SELECT json FROM sync_ops WHERE kind = ? AND id = ? AND revision > ? ORDER BY revision LIMIT ?").all(doc.kind, doc.id, afterRevision, limit) as { json: string }[]) {
        bytes += entry.json.length;
        if (out.length > 0 && bytes > 4 * PUSH_MAX_BYTES) break;
        out.push(JSON.parse(entry.json) as SyncOp);
      }
      return { ops: out, head: found.head };
    },
    /** A revision whose state arrives whole: a batch too large for a push, a version restore, a conflict resolution. */
    commitSnapshot(doc: DocRef, baseRevision: number, sha256: string, schemaVersion: number | undefined, meta: { commandType: string; label: string }, author: SyncAuthor): SyncOp {
      const found = require(doc);
      if (baseRevision !== found.head) throw new ProtocolError("REVISION_CONFLICT", "The snapshot is not based on the head revision.", { httpStatus: 409, details: { head: found.head } });
      return commitSnapshot(doc, readSnapshot(sha256), schemaVersion ?? found.schema_version, meta, author, sha256);
    },
    /** A lease was released: the operations since the last snapshot are folded into a new one. */
    snapshotIfDirty(doc: DocRef): { revision: number; sha256: string; size: number } | undefined {
      const found = row(doc);
      return found?.state === "active" && found.ops_since_snapshot > 0 ? snapshot(doc) : undefined;
    },
    /** "Keep this device's version": the superseded head stays as a named version for 30 days, the device's state becomes head + 1. */
    resolveKeepDevice(doc: DocRef, seenHead: number, sha256: string, schemaVersion: number | undefined, deviceId: string, deviceName: string): { op: SyncOp; versionId: string } {
      const found = require(doc);
      if (seenHead !== found.head) throw new ProtocolError("REVISION_CONFLICT", "The host copy changed again.", { httpStatus: 409, details: { head: found.head } });
      const document = readSnapshot(sha256);
      const versionId = addVersion(doc, `Replaced on ${new Date(now()).toISOString().slice(0, 10)} by ${deviceName}`, deviceId, "conflict");
      const op = commitSnapshot(doc, document, schemaVersion ?? found.schema_version, { commandType: "sync.conflict.keepDevice", label: "Keep this device's version" }, { kind: "device", deviceId }, sha256);
      return { op, versionId };
    },
    versions: {
      list(doc: DocRef, names: (deviceId: string) => string): SyncVersion[] {
        require(doc);
        expireVersions();
        return (db.prepare("SELECT * FROM sync_versions WHERE kind = ? AND id = ? ORDER BY created_ms DESC, version_id").all(doc.kind, doc.id) as any[]).map((entry) => versionOf(entry, names));
      },
      create(doc: DocRef, name: string, deviceId: string): string { require(doc); return addVersion(doc, name, deviceId, "user"); },
      get(versionId: string): { doc: DocRef; sha256: string; revision: number; name: string } {
        const entry = db.prepare("SELECT * FROM sync_versions WHERE version_id = ?").get(versionId) as any;
        if (!entry || (entry.expires_ms !== null && entry.expires_ms < now())) throw new ProtocolError("NOT_FOUND", "No such version.", { httpStatus: 404 });
        return { doc: { kind: entry.kind, id: entry.id }, sha256: entry.sha256, revision: entry.revision, name: entry.name };
      },
      /** Renaming a version made by conflict resolution makes it permanent. */
      rename(versionId: string, name: string): void { this.get(versionId); db.prepare("UPDATE sync_versions SET name = ?, expires_ms = NULL WHERE version_id = ?").run(name, versionId); },
      delete(versionId: string): void {
        const version = this.get(versionId);
        db.prepare("DELETE FROM sync_versions WHERE version_id = ?").run(versionId);
        db.prepare("DELETE FROM sync_version_blobs WHERE version_id = ?").run(versionId);
        blobs.discard(version.sha256);
      },
      /** A restore is a new revision whose state equals the version; history is never truncated. */
      restore(versionId: string, author: SyncAuthor): SyncOp {
        const version = this.get(versionId), found = require(version.doc);
        return commitSnapshot(version.doc, readSnapshot(version.sha256), found.schema_version, { commandType: "version.restore", label: `Restore ${version.name}` }, author);
      },
    },
    trash: {
      move(doc: DocRef, deviceId: string): void { require(doc); db.prepare("UPDATE sync_docs SET state = 'trash', trashed_ms = ?, trashed_by = ? WHERE kind = ? AND id = ?").run(now(), deviceId, doc.kind, doc.id); },
      list(kind: string | undefined, names: (deviceId: string) => string): TrashEntry[] {
        return (db.prepare("SELECT kind, id, name, trashed_ms, trashed_by FROM sync_docs WHERE state = 'trash' ORDER BY trashed_ms DESC").all() as any[])
          .filter((entry) => !kind || entry.kind === kind)
          .map((entry) => ({ kind: entry.kind, id: entry.id, name: entry.name, deleted_ms: entry.trashed_ms, deletedBy: entry.trashed_by, deletedByName: names(entry.trashed_by), purge_ms: entry.trashed_ms + TRASH_RETENTION_MS }));
      },
      restore(doc: DocRef): number {
        const found = row(doc);
        if (!found || found.state !== "trash") throw new ProtocolError("NOT_FOUND", "No such entry in the host trash.", { httpStatus: 404 });
        db.prepare("UPDATE sync_docs SET state = 'active', trashed_ms = NULL, trashed_by = NULL WHERE kind = ? AND id = ?").run(doc.kind, doc.id);
        return found.head;
      },
      /** Purges one entry: its operations, snapshots and versions go; the tombstone answers `PROJECT_PURGED` from then on. */
      purge(doc: DocRef, requireTrash = true): void {
        const found = row(doc);
        if (!found || (requireTrash && found.state !== "trash")) throw new ProtocolError("NOT_FOUND", "No such entry in the host trash.", { httpStatus: 404 });
        const stored = [
          ...(db.prepare("SELECT sha256 FROM sync_snapshots WHERE kind = ? AND id = ?").all(doc.kind, doc.id) as { sha256: string }[]),
          ...(db.prepare("SELECT sha256 FROM sync_versions WHERE kind = ? AND id = ?").all(doc.kind, doc.id) as { sha256: string }[]),
        ];
        transaction(db, () => {
          db.prepare("DELETE FROM sync_version_blobs WHERE version_id IN (SELECT version_id FROM sync_versions WHERE kind = ? AND id = ?)").run(doc.kind, doc.id);
          for (const table of ["sync_ops", "sync_snapshots", "sync_versions", "sync_doc_blobs"]) db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`).run(doc.kind, doc.id);
          db.prepare("DELETE FROM sync_continuity WHERE project_id = ?").run(doc.id);
          db.prepare("UPDATE sync_docs SET state = 'purged', head_json = '{}', trashed_ms = COALESCE(trashed_ms, ?) WHERE kind = ? AND id = ?").run(now(), doc.kind, doc.id);
        });
        heads.delete(docKey(doc));
        for (const { sha256 } of stored) blobs.discard(sha256);
      },
      /** Entries older than 30 days are purged by the sweep. */
      expire(): number {
        const due = db.prepare("SELECT kind, id FROM sync_docs WHERE state = 'trash' AND trashed_ms < ?").all(now() - TRASH_RETENTION_MS) as DocRef[];
        for (const doc of due) this.purge(doc);
        return due.length;
      },
      bytes: () => (db.prepare("SELECT COALESCE(SUM(LENGTH(head_json)), 0) AS total FROM sync_docs WHERE state = 'trash'").get() as { total: number }).total,
    },
    documentBytes: () => (db.prepare("SELECT COALESCE(SUM(LENGTH(head_json)), 0) AS total FROM sync_docs WHERE state = 'active'").get() as { total: number }).total
      + (db.prepare("SELECT COALESCE(SUM(LENGTH(json)), 0) AS total FROM sync_ops").get() as { total: number }).total,
    /** How many documents (active or in the trash), versions, snapshots and library items name a blob. */
    refCount(sha256: string): number {
      const count = (sql: string) => (db.prepare(sql).get(sha256) as { total: number }).total;
      return count("SELECT COUNT(*) AS total FROM sync_doc_blobs WHERE sha256 = ?") + count("SELECT COUNT(*) AS total FROM sync_version_blobs WHERE sha256 = ?") + count("SELECT COUNT(*) AS total FROM sync_snapshots WHERE sha256 = ?")
        + count("SELECT COUNT(*) AS total FROM sync_versions WHERE sha256 = ?") + count("SELECT COUNT(*) AS total FROM sync_library WHERE blob_sha256 = ? AND deleted_ms IS NULL");
    },
    continuity: {
      note(projectId: string, deviceId: string, sceneId: string, playhead_ticks: number): void {
        db.prepare("INSERT INTO sync_continuity (project_id, device_id, scene_id, playhead_ticks, updated_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id, device_id) DO UPDATE SET scene_id = excluded.scene_id, playhead_ticks = excluded.playhead_ticks, updated_ms = excluded.updated_ms")
          .run(projectId, deviceId, sceneId, playhead_ticks, now());
      },
      last: (projectId: string, deviceId: string) => (db.prepare("SELECT updated_ms FROM sync_continuity WHERE project_id = ? AND device_id = ?").get(projectId, deviceId) as { updated_ms: number } | undefined)?.updated_ms ?? 0,
      list: (projectId: string) => db.prepare("SELECT device_id, scene_id, playhead_ticks, updated_ms FROM sync_continuity WHERE project_id = ? ORDER BY updated_ms DESC").all(projectId) as { device_id: string; scene_id: string; playhead_ticks: number; updated_ms: number }[],
    },
    /** A creating call repeated with its key answers what the first one answered. */
    once<T>(deviceId: string, method: string, key: string, run: () => T): T {
      const stored = db.prepare("SELECT result FROM sync_idempotency WHERE device_id = ? AND method = ? AND key = ?").get(deviceId, method, key) as { result: string } | undefined;
      if (stored) return JSON.parse(stored.result) as T;
      const result = run();
      db.prepare("INSERT OR REPLACE INTO sync_idempotency (device_id, method, key, result, ts_ms) VALUES (?, ?, ?, ?, ?)").run(deviceId, method, key, JSON.stringify(result ?? null), now());
      return result;
    },
  };
}
export type DocumentStore = ReturnType<typeof createDocumentStore>;
