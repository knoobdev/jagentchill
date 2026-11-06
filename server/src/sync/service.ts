import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  type AuthorDisplay,
  APPLY_REMOTE_ANSWER_MS, APPLY_REMOTE_RETRIES, APPLY_REMOTE_RETRY_MS, BLOB_CHUNK_BYTES, CONTINUITY_WRITE_INTERVAL_MS, DEFAULT_STORAGE_QUOTA_BYTES, LIBRARY_TOMBSTONE_RETENTION_MS,
  PRESENCE_STALE_MS, STORAGE_SWEEP_INTERVAL_MS, SYNC_METHODS, SYNC_PARAMS, blobInitSchema, blobLinkSchema, commentStream, docKey, presenceStream, syncStream,
  type DocRef, type Lease, type LeaseEvent, type LibraryItem, type PresenceEntry, type Scope, type SyncAuthor, type SyncComment, type SyncDocInfo, type SyncMethod, type SyncOp, type SyncPatchEntry, type TrashEntry,
} from "@jagentchill/protocol";
import type { RequestAuthenticator } from "../channel/request-auth.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";
import { createBlobStore } from "./blobs.ts";
import { createDocumentStore } from "./documents.ts";
import { createLeaseManager, type LeaseCaller } from "./leases.ts";
import { createMediaJobs, type MediaJob, type MediaJobsDeps } from "./media-jobs.ts";


const ROUTE = /^\/jagentchill\/v1\/blobs\/([0-9a-f]{64})(?:\/(init|complete|link|status|chunks\/(\d{1,9})|variants\/([a-z]+)))?$/;
const MAX_ROUTE_JSON = 65_536;
type RouteRequest = { req: IncomingMessage; res: ServerResponse; target: string; path: string; loopback: boolean };
export type HostBatch = { doc: DocRef; principal: string; label: string; patches: SyncPatchEntry[]; baseRevision: number; originDeviceId: string; commandType?: string };
export type HostBatchResult = { state: "applied"; revision: number } | { state: "waiting"; deviceName: string } | { state: "rejected"; head: number };
export type SyncDeps = {
  db: DatabaseSync; dataDir: string; now: () => number; devices: DeviceRegistry; auth: RequestAuthenticator;
  quotaBytes?: () => number; freeDiskBytes?: () => number; maxSchemaVersion?: { project: number; script: number; workflow: number };
  /** Where FFmpeg is, when it is not on PATH; and, in tests, the environment the lookup reads. */
  media?: Pick<MediaJobsDeps, "ffmpegPath" | "ffprobePath" | "env">;
  /** The name of the agent of a session, when it has one of its own (a team member's title, a role's label): what "last edited by" and "is editing" show for an agent's write. */
  agentName?: (sessionKey: string) => string | undefined;
  /** Test only: timings of `applyRemote` and of the host yielding to a device. */
  timings?: { applyRemoteAnswerMs?: number; applyRemoteRetryMs?: number; hostYieldMs?: number; hostBatchWaitMs?: number };
};

/**
 * Transfer limits are kept on the wire by the host: it reads an upload, and writes a download, no faster than the
 * device asked (header `x-jagentchill-rate`, bits per second). One budget per device and direction, shared by all its
 * requests, so that no 10-second window carries more than the limit allows.
 */
const RATE_HEADER = "x-jagentchill-rate";
const paid = new Map<string, number>();
export function rateOf(req: IncomingMessage): number | undefined {
  const value = Number(req.headers[RATE_HEADER]);
  return Number.isFinite(value) && value >= 100_000 && value <= 1_000_000_000 ? value : undefined;
}
/**
 * What a socket's kernel buffers let through at once when a request starts, in bits: the host cannot read slower than
 * the sender fills them. The upload budget is lowered by this much per 10 seconds (never below half the limit), so
 * that a 10-second window stays within 110 % of the limit. Below about 3.2 Mbit/s that is not enough: only a sender
 * that streams its request body can go lower.
 */
const UPLOAD_BURST_BITS = 16_000_000;
export const uploadBudget = (limit: number): number => Math.min(limit, Math.max(limit * 0.5, limit * 1.1 - UPLOAD_BURST_BITS / 10));
async function pace(key: string, rate: number, bytes: number): Promise<void> {
  const now = Date.now(), free = Math.max(now, paid.get(key) ?? 0), wait = free - now;
  paid.set(key, free + (bytes * 8 * 1000) / rate);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
async function readBody(req: IncomingMessage, limit: number, paced?: { key: string; rate: number }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (paced) await pace(paced.key, paced.rate, (chunk as Buffer).length);
    size += (chunk as Buffer).length;
    if (size > limit) throw new ProtocolError("PAYLOAD_TOO_LARGE", "The request body is too large.", { httpStatus: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Cross-device sync: the server is the rendezvous. It stores and relays state patches, arbitrates the edit lease and
 * stores media blobs. The agent runtimes take no part: everything here works without them.
 */
export function createSyncService(deps: SyncDeps) {
  const { db, now, devices } = deps;
  const quotaBytes = deps.quotaBytes ?? (() => Number(process.env.JAGENTCHILL_STORAGE_QUOTA_BYTES) || DEFAULT_STORAGE_QUOTA_BYTES);
  // A device's name is its record's — a device that was removed keeps its record, so this is its last known name.
  const deviceName = (deviceId: string) => devices.get(deviceId)?.name ?? "Unknown device";
  /**
   * Who wrote or holds a document, as facts (a screen words them in its language) — and never as an id: a host
   * principal is `agent:<session key>`, `run:<id>`, `film:<id>`, `automation:<id>`, which no person should read.
   */
  const display = (value: { kind: "device"; deviceId: string } | { kind: "host"; principal: string }): AuthorDisplay => {
    if (value.kind === "device") { const name = devices.get(value.deviceId)?.name; return { kind: "device", ...(name ? { name } : {}) }; }
    const [, kind, rest] = /^(agent|run|film|automation):(.*)$/s.exec(value.principal) ?? [];
    if (kind !== "agent") return { kind: (kind as AuthorDisplay["kind"] | undefined) ?? "agent" };
    let name: string | undefined;
    try { name = deps.agentName?.(rest!)?.trim() || undefined; } catch { /* the agent service cannot say: no name */ }
    return { kind: "agent", ...(name ? { name } : {}) };
  };
  /** The same as one string, for what shows a name as it is. */
  const HOST_NAMES: Record<AuthorDisplay["kind"], string> = { device: "Unknown device", agent: "Agent", run: "Workflow run", film: "Film Studio", automation: "Automation" };
  const principalName = (principal: string): string => { const shown = display({ kind: "host", principal }); return shown.name ?? HOST_NAMES[shown.kind]; };
  const methods = new Map<string, RpcMethod>();
  const conns = new Map<string, Connection>(), streams = new Map<string, Set<string>>();
  const presence = new Map<string, PresenceEntry>();
  const mediaStates = new Map<string, Map<string, { deviceName: string; assets: Map<string, { state: string; reason?: string }> }>>();
  const transfers = new Map<string, Set<{ destroy(): void }>>();
  const remoteAnswers = new Map<string, (result: "applied" | "busy" | "rejected") => void>();

  // `documents` and `blobs` count each other's references, so each is given the other lazily.
  const blobs = createBlobStore({ db, dir: join(deps.dataDir, "blobs"), now, quotaBytes, freeDiskBytes: deps.freeDiskBytes, refCount: (sha256) => documents.refCount(sha256) + Number((db.prepare("SELECT COUNT(*) AS n FROM session_attachments WHERE blob_id = ?").get(sha256) as { n: number } | undefined)?.n ?? 0) + Number((db.prepare("SELECT COUNT(*) AS n FROM media_jobs WHERE kind IN ('export.remote', 'preview.render') AND output_sha256 = ?").get(sha256) as { n: number } | undefined)?.n ?? 0) });
  const documents = createDocumentStore({ db, now, blobs, maxSchemaVersion: deps.maxSchemaVersion });
  let publishMediaJob: (job: MediaJob) => void = () => undefined;
  const mediaJobs = createMediaJobs({ db, blobs, dir: join(deps.dataDir, "blobs", "jobs"), now, ...deps.media, onChanged: (job) => publishMediaJob(job) });

  const subscribe = (stream: string, connection: Connection) => { let set = streams.get(stream); if (!set) streams.set(stream, (set = new Set())); set.add(connection.connId); conns.set(connection.connId, connection); };
  const unsubscribe = (stream: string, connId: string) => { const set = streams.get(stream); set?.delete(connId); if (set?.size === 0) streams.delete(stream); };
  /** Sends an event to a stream's subscribers and to the connections named, each once, never to `except`. */
  function publish(stream: string, event: string, payload: unknown, also: string[] = [], except?: string): void {
    for (const connId of new Set([...(streams.get(stream) ?? []), ...also])) {
      if (connId === except) continue;
      const connection = conns.get(connId);
      if (connection?.role() === undefined) continue;
      try { connection.send(event, stream, payload); } catch { /* the socket is closing */ }
    }
  }
  publishMediaJob = (job) => publish(`media-job:${job.jobId}`, "jagentchill.media.job.updated", job);
  const jobStream = (jobId: string) => `job:${jobId}`;
  const leases = createLeaseManager({
    now, deviceName, principalName, display, hostYieldMs: deps.timings?.hostYieldMs, hostBatchWaitMs: deps.timings?.hostBatchWaitMs,
    emit: (event: LeaseEvent, connIds) => publish(syncStream(event.doc), "jagentchill.sync.lease", event, connIds),
    onReleased: (doc) => { const taken = documents.snapshotIfDirty(doc); if (taken) publish(syncStream(doc), "jagentchill.sync.snapshot", { doc, ...taken, automatic: true }); },
    audit: (actor, action, details) => audit(db, now(), actor, action, details),
  });
  const caller = (connection: Connection): LeaseCaller => { conns.set(connection.connId, connection); return { deviceId: connection.deviceId, connId: connection.connId, clientInstanceId: connection.clientInstanceId }; };
  const logDoc = (doc: DocRef): DocRef => { if (doc.kind === "workflow") throw new ProtocolError("INVALID_PARAMS", "Workflow documents have no operation log and no lease."); return doc; };
  const author = (connection: Connection): SyncAuthor => ({ kind: "device", deviceId: connection.deviceId });
  const authorName = (value: SyncAuthor) => (value.kind === "device" ? deviceName(value.deviceId) : principalName(value.principal));
  /** A document in the host trash names who deleted it, so that other devices can say "Deleted on <device>". */
  function required(doc: DocRef) {
    try { return documents.require(doc); } catch (error) {
      const found = error instanceof ProtocolError && error.code === "PROJECT_IN_TRASH" ? db.prepare("SELECT trashed_by, trashed_ms FROM sync_docs WHERE kind = ? AND id = ?").get(doc.kind, doc.id) as { trashed_by: string; trashed_ms: number } | undefined : undefined;
      if (found) throw new ProtocolError("PROJECT_IN_TRASH", "This document is in the host trash.", { httpStatus: 409, details: { deleted_ms: found.trashed_ms, deletedBy: found.trashed_by, deletedByName: deviceName(found.trashed_by) } });
      throw error;
    }
  }
  function info(doc: DocRef): SyncDocInfo {
    const found = required(doc), snapshot = documents.headSnapshot(doc), lastAuthor = JSON.parse(found.last_author) as SyncAuthor;
    return {
      doc, kind: found.kind, name: found.name, duration: found.duration, head: found.head, headSnapshotRevision: snapshot.revision, snapshot,
      schemaVersion: found.schema_version, minReaderSchemaVersion: found.min_reader, maxSchemaVersion: documents.maxSchemaVersion[found.kind], updated_ms: found.updated_ms,
      lastAuthor, lastAuthorName: authorName(lastAuthor), lastAuthorDisplay: display(lastAuthor), lease: leases.current(doc), coverSha256: found.cover_sha256,
      continuity: found.kind === "project" ? documents.continuity.list(doc.id).map((entry) => ({ deviceId: entry.device_id, deviceName: deviceName(entry.device_id), sceneId: entry.scene_id, playhead_ticks: entry.playhead_ticks, updated_ms: entry.updated_ms })) : [],
    };
  }
  const listed = (kind: "project" | "script", query: Parameters<typeof documents.list>[1]) => {
    const { rows, nextCursor, total } = documents.list(kind, query);
    return {
      items: rows.map((found) => {
        const doc = { kind: found.kind, id: found.id }, lastAuthor = JSON.parse(found.last_author) as SyncAuthor;
        return { doc, name: found.name, duration: found.duration, head: found.head, updated_ms: found.updated_ms, lastAuthor, lastAuthorName: authorName(lastAuthor), lastAuthorDisplay: display(lastAuthor), coverSha256: found.cover_sha256, schemaVersion: found.schema_version, minReaderSchemaVersion: found.min_reader, lease: leases.current(doc) };
      }),
      nextCursor, total,
    };
  };
  const announceOps = (doc: DocRef, ops: SyncOp[], head: number, except?: string) => { if (ops.length) publish(syncStream(doc), "jagentchill.sync.ops", { doc, ops, head }, [], except); };
  const announceSnapshot = (doc: DocRef, op: SyncOp, except?: string) => {
    publish(syncStream(doc), "jagentchill.sync.snapshot", { doc, revision: op.revision, sha256: op.snapshot!.sha256, size: op.snapshot!.size, label: op.label, author: op.author }, [], except);
    announceOps(doc, [op], op.revision, except);
  };

  function define<M extends SyncMethod>(name: M, handle: (params: z.infer<(typeof SYNC_PARAMS)[M]>, connection: Connection) => unknown | Promise<unknown>): void {
    methods.set(name, {
      scope: SYNC_METHODS[name] as Scope,
      handle: (raw, connection) => {
        const parsed = SYNC_PARAMS[name].safeParse(raw ?? {});
        if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join(".")) } });
        conns.set(connection.connId, connection);
        return handle(parsed.data as never, connection);
      },
    });
  }
  const needScope = (connection: Connection, scope: Scope) => { if (!connection.scopes().includes(scope)) throw new ProtocolError("SCOPE_DENIED", "The device lacks the required scope.", { details: { requiredScope: scope } }); };

  // ── sync: reads ────────────────────────────────────────────────────────────────────────────────────────────────────
  define("jagentchill.sync.project.list", (p) => listed("project", p));
  define("jagentchill.sync.doc.list", (p) => listed(p.kind, p));
  define("jagentchill.sync.project.get", (p) => { if (p.doc.kind !== "project") throw new ProtocolError("INVALID_PARAMS", "project.get names a project."); return info(p.doc); });
  define("jagentchill.sync.doc.get", (p) => info(logDoc(p.doc)));
  define("jagentchill.sync.ops.pull", (p) => { required(logDoc(p.doc)); return documents.pull(p.doc, p.afterRevision, p.limit); });
  define("jagentchill.sync.version.list", (p) => ({ versions: documents.versions.list(logDoc(p.doc), deviceName) }));
  define("jagentchill.sync.media-state.report", (p, connection) => {
    required({ kind: "project", id: p.projectId });
    const byDevice = mediaStates.get(p.projectId) ?? new Map();
    byDevice.set(connection.deviceId, { deviceName: deviceName(connection.deviceId), assets: new Map(p.assets.map((asset) => [asset.assetId, { state: asset.state, ...(asset.reason ? { reason: asset.reason } : {}) }])) });
    mediaStates.set(p.projectId, byDevice);
    return { reported: p.assets.length };
  });
  define("jagentchill.sync.subscribe", (p, connection) => { const found = info(logDoc(p.doc)); subscribe(syncStream(p.doc), connection); return found; });
  define("jagentchill.sync.unsubscribe", (p, connection) => unsubscribe(syncStream(p.doc), connection.connId));

  // ── sync: writes ───────────────────────────────────────────────────────────────────────────────────────────────────
  define("jagentchill.sync.doc.enable", (p, connection) => documents.once(connection.deviceId, "doc.enable", p.idempotencyKey, () => {
    const result = documents.enable(logDoc(p.doc), p.sha256, p.schemaVersion, author(connection));
    return { ...result, info: info(p.doc) };
  }));
  define("jagentchill.sync.doc.disable", (p, connection) => {
    if (!p.removeHostCopy) return { removed: false };
    const found = required(logDoc(p.doc)), lease = leases.current(p.doc);
    if (lease && !(lease.holder.kind === "device" && lease.holder.deviceId === connection.deviceId)) {
      throw new ProtocolError("CONFLICT", `${lease.holderName} is editing this project`, { httpStatus: 409, details: { holderName: lease.holderName, reason: "lease_held" } });
    }
    // A deletion recorded offline applies only to the revision the device saw.
    if (p.baseRevision !== undefined && p.baseRevision !== found.head) throw new ProtocolError("REVISION_CONFLICT", "The document changed on another device.", { httpStatus: 409, details: { head: found.head } });
    if (p.trash) documents.trash.move(p.doc, connection.deviceId); else documents.trash.purge(p.doc, false);
    audit(db, now(), `device:${connection.deviceId}`, p.trash ? "sync.doc.trash" : "sync.doc.remove", { doc: p.doc });
    const held = leases.current(p.doc) !== null;
    leases.dropDocument(p.doc);
    // Devices that follow the document are told also when nobody was editing it: their next read says it is gone.
    if (!held) publish(syncStream(p.doc), "jagentchill.sync.lease", { doc: p.doc, lease: null, reason: "released" });
    return { removed: true, trashed: p.trash === true };
  });
  define("jagentchill.sync.ops.push", (p, connection) => {
    required(logDoc(p.doc));
    leases.assertHolder(p.doc, p.leaseId, connection.connId);
    const result = documents.push(p.doc, p.baseRevision, p.ops, author(connection));
    announceOps(p.doc, result.ops, result.head, connection.connId);
    if (result.snapshot) publish(syncStream(p.doc), "jagentchill.sync.snapshot", { doc: p.doc, ...result.snapshot, automatic: true });
    return { revisions: result.revisions, head: result.head };
  });
  define("jagentchill.sync.snapshot.commit", (p, connection) => documents.once(connection.deviceId, "snapshot.commit", p.idempotencyKey, () => {
    required(logDoc(p.doc));
    leases.assertHolder(p.doc, p.leaseId, connection.connId);
    const op = documents.commitSnapshot(p.doc, p.baseRevision, p.sha256, p.schemaVersion, { commandType: p.commandType, label: p.label }, author(connection));
    announceSnapshot(p.doc, op, connection.connId);
    return { revision: op.revision, head: op.revision };
  }));
  define("jagentchill.sync.lease.acquire", async (p, connection) => {
    const found = required(logDoc(p.doc));
    const supported = p.supportedSchemaVersion ?? (db.prepare(`SELECT ${found.kind} AS version FROM sync_device_schema WHERE device_id = ?`).get(connection.deviceId) as { version: number } | undefined)?.version;
    // An app below the document's minimum reader version views it and never writes it.
    if (supported !== undefined && supported < found.min_reader) throw new ProtocolError("SCHEMA_TOO_NEW", "This app is too old to edit this document.", { details: { kind: found.kind, minReaderSchemaVersion: found.min_reader } });
    const lease = await leases.acquire(p.doc, caller(connection));
    subscribe(syncStream(p.doc), connection);
    return { lease, head: documents.row(p.doc)!.head };
  });
  define("jagentchill.sync.lease.heartbeat", (p, connection) => ({ lease: leases.heartbeat(logDoc(p.doc), p.leaseId, connection.connId) }));
  define("jagentchill.sync.lease.release", (p, connection) => leases.release(logDoc(p.doc), p.leaseId, connection.connId));
  define("jagentchill.sync.lease.requestTakeover", async (p, connection) => {
    required(logDoc(p.doc));
    subscribe(syncStream(p.doc), connection);
    const lease = await leases.requestTakeover(p.doc, caller(connection));
    return { lease, head: documents.row(p.doc)!.head };
  });
  define("jagentchill.sync.lease.answerTakeover", (p, connection) => leases.answer(logDoc(p.doc), caller(connection), p.accept));
  define("jagentchill.sync.lease.transfer", (p, connection) => {
    required(logDoc(p.doc));
    const targets = [...conns.values()].filter((other) => other.deviceId === p.toDeviceId && other.role() !== undefined && other.scopes().includes("jagentchill.projects.write")).map((other) => other.connId);
    return leases.transfer(p.doc, caller(connection), p.toDeviceId, targets);
  });
  define("jagentchill.sync.lease.forceTake", (p, connection) => {
    required(logDoc(p.doc));
    subscribe(syncStream(p.doc), connection);
    return { lease: leases.forceTake(p.doc, caller(connection)), head: documents.row(p.doc)!.head };
  });
  define("jagentchill.sync.applyRemote.result", (p) => { remoteAnswers.get(p.batchId)?.(p.result); });
  define("jagentchill.sync.conflict.resolve", (p, connection) => documents.once(connection.deviceId, "conflict.resolve", p.idempotencyKey, () => {
    required(logDoc(p.doc));
    leases.assertHolder(p.doc, p.leaseId, connection.connId);
    const { op, versionId } = documents.resolveKeepDevice(p.doc, p.head, p.sha256, p.schemaVersion, connection.deviceId, deviceName(connection.deviceId));
    audit(db, now(), `device:${connection.deviceId}`, "sync.conflict.keepDevice", { doc: p.doc, replaced: p.head, versionId });
    announceSnapshot(p.doc, op, connection.connId);
    return { revision: op.revision, head: op.revision, versionId };
  }));
  define("jagentchill.sync.version.create", (p, connection) => documents.once(connection.deviceId, "version.create", p.idempotencyKey, () => {
    const versionId = documents.versions.create(logDoc(p.doc), p.name, connection.deviceId);
    publish(syncStream(p.doc), "jagentchill.sync.snapshot", { doc: p.doc, ...documents.headSnapshot(p.doc), versionId, name: p.name });
    return { versionId, version: documents.versions.list(p.doc, deviceName).find((version) => version.versionId === versionId) };
  }));
  define("jagentchill.sync.version.rename", (p) => documents.versions.rename(p.versionId, p.name));
  define("jagentchill.sync.version.delete", (p) => documents.versions.delete(p.versionId));
  define("jagentchill.sync.version.restore", (p, connection) => {
    const { doc } = documents.versions.get(p.versionId);
    required(doc);
    leases.assertHolder(doc, p.leaseId, connection.connId);
    const op = documents.versions.restore(p.versionId, author(connection));
    announceSnapshot(doc, op, connection.connId);
    return { revision: op.revision, head: op.revision, sha256: op.snapshot!.sha256 };
  });

  // ── library items ──────────────────────────────────────────────────────────────────────────────────────────────────
  const libraryItem = (entry: any): LibraryItem => ({
    itemId: entry.item_id, kind: entry.kind, name: entry.name, updated_ms: entry.updated_ms, serverUpdated_ms: entry.server_updated_ms,
    ...(entry.blob_sha256 ? { blobSha256: entry.blob_sha256 } : {}), payload: JSON.parse(entry.payload), ...(entry.deleted_ms !== null ? { deleted_ms: entry.deleted_ms } : {}),
  });
  /** Server time of a write; strictly increasing, so that "last writer" is decided here and never by a device clock. */
  let lastLibraryWrite = 0;
  const libraryClock = () => (lastLibraryWrite = Math.max(now(), lastLibraryWrite + 1));
  define("jagentchill.sync.library.list", (p) => ({ items: (db.prepare("SELECT * FROM sync_library WHERE server_updated_ms > ? ORDER BY server_updated_ms").all(p.since_ms ?? 0) as any[]).map(libraryItem), serverTime_ms: now() }));
  define("jagentchill.sync.library.put", (p, connection) => documents.once(connection.deviceId, "library.put", p.idempotencyKey, () => {
    const stored = db.prepare("SELECT * FROM sync_library WHERE item_id = ?").get(p.itemId) as any;
    let conflict: LibraryItem | undefined;
    // The writer had not seen the stored value: it still wins, and the value it replaced is kept beside it.
    if (stored && stored.deleted_ms === null && p.baseServerUpdated_ms !== undefined && p.baseServerUpdated_ms < stored.server_updated_ms && (stored.name !== p.name || stored.payload !== JSON.stringify(p.payload ?? null))) {
      const at = libraryClock(), itemId = `${p.itemId}.conflict-${at}`;
      db.prepare("INSERT INTO sync_library (item_id, kind, name, updated_ms, server_updated_ms, blob_sha256, payload, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(itemId, stored.kind, `${stored.name} (conflict ${deviceName(stored.updated_by)})`, stored.updated_ms, at, stored.blob_sha256, stored.payload, stored.updated_by);
      conflict = libraryItem(db.prepare("SELECT * FROM sync_library WHERE item_id = ?").get(itemId));
    }
    db.prepare("INSERT OR REPLACE INTO sync_library (item_id, kind, name, updated_ms, server_updated_ms, blob_sha256, payload, updated_by, deleted_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)")
      .run(p.itemId, p.kind, p.name, p.updated_ms, libraryClock(), p.blobSha256 ?? null, JSON.stringify(p.payload ?? null), connection.deviceId);
    return { item: libraryItem(db.prepare("SELECT * FROM sync_library WHERE item_id = ?").get(p.itemId)), ...(conflict ? { conflict } : {}) };
  }));
  define("jagentchill.sync.library.delete", (p) => {
    // A deletion is a tombstone, kept 30 days so that every device learns of it.
    db.prepare("UPDATE sync_library SET deleted_ms = ?, server_updated_ms = ? WHERE item_id = ?").run(now(), libraryClock(), p.itemId);
  });

  // ── blob ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  define("jagentchill.blob.list", (p) => blobs.list(p));
  define("jagentchill.blob.get", (p) => blobs.get(p.sha256));
  define("jagentchill.blob.variant.request", (p) => {
    // A media job of the host's FFmpeg: `media.proxy` for the preview, `media.transcode` for the mezzanine.
    return mediaJobs.request(p.sha256, p.variant);
  });
  define("jagentchill.media.job.get", (p) => {
    const job = mediaJobs.get(p.jobId);
    if (!job) throw new ProtocolError("NOT_FOUND", "No media job has this id.", { httpStatus: 404 });
    return job;
  });
  define("jagentchill.media.job.subscribe", (p, connection) => {
    const job = mediaJobs.get(p.jobId);
    if (!job) throw new ProtocolError("NOT_FOUND", "No media job has this id.", { httpStatus: 404 });
    subscribe(`media-job:${p.jobId}`, connection);
    return { job };
  });
  define("jagentchill.media.job.unsubscribe", (p, connection) => {
    unsubscribe(`media-job:${p.jobId}`, connection.connId);
    return { unsubscribed: true };
  });
  define("jagentchill.blob.delete", (p) => blobs.remove(p.sha256));

  // ── trash ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const templateTrash = (): TrashEntry[] => (db.prepare("SELECT * FROM sync_library WHERE kind = 'project-template' AND deleted_ms IS NOT NULL").all() as any[])
    .map((entry) => ({ kind: "template", id: entry.item_id, name: entry.name, deleted_ms: entry.deleted_ms, deletedBy: entry.updated_by, deletedByName: deviceName(entry.updated_by), purge_ms: entry.deleted_ms + LIBRARY_TOMBSTONE_RETENTION_MS }));
  define("jagentchill.trash.list", (p) => ({ entries: [...documents.trash.list(p.kind, deviceName), ...(!p.kind || p.kind === "template" ? templateTrash() : [])].sort((a, b) => b.deleted_ms - a.deleted_ms) }));
  define("jagentchill.trash.restore", (p) => {
    if (p.kind === "template") {
      if (!db.prepare("UPDATE sync_library SET deleted_ms = NULL, server_updated_ms = ? WHERE item_id = ? AND kind = 'project-template' AND deleted_ms IS NOT NULL").run(libraryClock(), p.id).changes) throw new ProtocolError("NOT_FOUND", "No such entry in the host trash.", { httpStatus: 404 });
      return { restored: true };
    }
    // Workflow runs, films and film panel assets are sent to the trash by their owners inside the server; none exists yet.
    if (p.kind !== "project" && p.kind !== "script") throw new ProtocolError("NOT_FOUND", "No such entry in the host trash.", { httpStatus: 404 });
    return { restored: true, head: documents.trash.restore({ kind: p.kind, id: p.id }) };
  });
  define("jagentchill.trash.purge", (p, connection) => {
    if (p.kind === "template") { db.prepare("DELETE FROM sync_library WHERE item_id = ? AND deleted_ms IS NOT NULL").run(p.id); return; }
    if (p.kind !== "project" && p.kind !== "script") throw new ProtocolError("NOT_FOUND", "No such entry in the host trash.", { httpStatus: 404 });
    documents.trash.purge({ kind: p.kind, id: p.id });
    audit(db, now(), `device:${connection.deviceId}`, "sync.trash.purge", { kind: p.kind, id: p.id });
  });

  // ── comments ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const comment = (entry: any): SyncComment => ({
    commentId: entry.comment_id, targetType: entry.target_type, targetId: entry.target_id, ...(entry.revision !== null ? { revision: entry.revision } : {}),
    ...(entry.time_ticks !== null ? { time_ticks: entry.time_ticks } : {}), ...(entry.anchor !== null ? { anchor: JSON.parse(entry.anchor) } : {}), ...(entry.point !== null ? { point: JSON.parse(entry.point) } : {}),
    body: entry.body, authorDeviceId: entry.author_device, authorName: entry.author_name, created_ms: entry.created_ms, ...(entry.edited_ms !== null ? { edited_ms: entry.edited_ms } : {}),
    resolved: entry.resolved === 1, ...(entry.parent_id ? { parentId: entry.parent_id } : {}),
  });
  const commentRow = (commentId: string) => { const entry = db.prepare("SELECT * FROM sync_comments WHERE comment_id = ?").get(commentId) as any; if (!entry) throw new ProtocolError("NOT_FOUND", "No such comment.", { httpStatus: 404 }); return entry; };
  const commentChanged = (entry: any, deleted = false) => publish(commentStream(entry.target_type, entry.target_id), "jagentchill.comment.changed", { targetType: entry.target_type, targetId: entry.target_id, ...(deleted ? { deletedId: entry.comment_id } : { comment: comment(entry) }) });
  const commentTarget = (targetType: string, targetId: string) => { if (targetType === "project" || targetType === "script") required({ kind: targetType, id: targetId }); };
  define("jagentchill.comment.list", (p) => { commentTarget(p.targetType, p.targetId); return { comments: (db.prepare("SELECT * FROM sync_comments WHERE target_type = ? AND target_id = ? ORDER BY created_ms, comment_id").all(p.targetType, p.targetId) as any[]).map(comment) }; });
  define("jagentchill.comment.create", (p, connection) => documents.once(connection.deviceId, "comment.create", p.idempotencyKey, () => {
    commentTarget(p.targetType, p.targetId);
    if (p.parentId) { const parent = commentRow(p.parentId); if (parent.parent_id || parent.target_id !== p.targetId) throw new ProtocolError("INVALID_PARAMS", "Replies nest one level."); }
    // The same comment sent twice (written offline, sent on reconnect) is stored once.
    if (!db.prepare("SELECT 1 FROM sync_comments WHERE comment_id = ?").get(p.commentId)) {
      db.prepare("INSERT INTO sync_comments (comment_id, target_type, target_id, revision, time_ticks, anchor, point, body, author_device, author_name, created_ms, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(p.commentId, p.targetType, p.targetId, p.revision ?? null, p.time_ticks ?? null, p.anchor === undefined ? null : JSON.stringify(p.anchor), p.point ? JSON.stringify(p.point) : null, p.body, connection.deviceId, p.authorName ?? deviceName(connection.deviceId), now(), p.parentId ?? null);
      commentChanged(commentRow(p.commentId));
    }
    return { comment: comment(commentRow(p.commentId)) };
  }));
  define("jagentchill.comment.update", (p, connection) => {
    if (commentRow(p.commentId).author_device !== connection.deviceId) throw new ProtocolError("PERMISSION_DENIED", "Only the author edits a comment.", { httpStatus: 403 });
    db.prepare("UPDATE sync_comments SET body = ?, edited_ms = ? WHERE comment_id = ?").run(p.body, now(), p.commentId);
    commentChanged(commentRow(p.commentId));
    return { comment: comment(commentRow(p.commentId)) };
  });
  define("jagentchill.comment.delete", (p, connection) => {
    const entry = commentRow(p.commentId);
    if (entry.author_device !== connection.deviceId) needScope(connection, "jagentchill.projects.write");
    db.prepare("DELETE FROM sync_comments WHERE comment_id = ? OR parent_id = ?").run(p.commentId, p.commentId);
    commentChanged(entry, true);
  });
  define("jagentchill.comment.resolve", (p, connection) => {
    needScope(connection, "jagentchill.projects.write");
    commentRow(p.commentId);
    db.prepare("UPDATE sync_comments SET resolved = ? WHERE comment_id = ?").run(p.resolved ? 1 : 0, p.commentId);
    commentChanged(commentRow(p.commentId));
    return { comment: comment(commentRow(p.commentId)) };
  });
  define("jagentchill.comment.subscribe", (p, connection) => subscribe(commentStream(p.targetType, p.targetId), connection));
  define("jagentchill.comment.unsubscribe", (p, connection) => unsubscribe(commentStream(p.targetType, p.targetId), connection.connId));

  // ── presence ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const presenceOf = (doc?: DocRef) => [...presence.values()].filter((entry) => !doc || (entry.openDoc && docKey(entry.openDoc) === docKey(doc)));
  const presenceChanged = (doc: DocRef | undefined) => {
    publish(presenceStream(), "jagentchill.presence.changed", { entries: presenceOf() });
    if (doc) publish(presenceStream(doc), "jagentchill.presence.changed", { doc, entries: presenceOf(doc) });
  };
  define("jagentchill.presence.heartbeat", (p, connection) => {
    const before = presence.get(connection.connId);
    const entry: PresenceEntry = { ...p, deviceId: connection.deviceId, connId: connection.connId, deviceName: deviceName(connection.deviceId), role: connection.role() ?? "viewer", seen_ms: now() };
    presence.set(connection.connId, entry);
    const schema = p.supportedSchemaVersion;
    db.prepare("INSERT INTO sync_device_schema (device_id, project, script, workflow, updated_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (device_id) DO UPDATE SET project = excluded.project, script = excluded.script, workflow = excluded.workflow, updated_ms = excluded.updated_ms")
      .run(connection.deviceId, schema.project, schema.script, schema.workflow, now());
    // The continuity record of an open project: where this device is, written at most once every five seconds.
    if (p.openDoc?.kind === "project" && p.sceneId !== undefined && p.playhead_ticks !== undefined && now() - documents.continuity.last(p.openDoc.id, connection.deviceId) >= CONTINUITY_WRITE_INTERVAL_MS && documents.row(p.openDoc)?.state === "active") {
      documents.continuity.note(p.openDoc.id, connection.deviceId, p.sceneId, p.playhead_ticks);
    }
    if (before?.openDoc && (!p.openDoc || docKey(before.openDoc) !== docKey(p.openDoc))) {
      // Closing a project writes its continuity record a last time.
      if (before.openDoc.kind === "project" && before.sceneId !== undefined && before.playhead_ticks !== undefined && documents.row(before.openDoc)?.state === "active") documents.continuity.note(before.openDoc.id, connection.deviceId, before.sceneId, before.playhead_ticks);
      presenceChanged(before.openDoc);
    }
    presenceChanged(p.openDoc);
    return { serverTime_ms: now() };
  });
  define("jagentchill.presence.list", (p) => ({
    entries: presenceOf(p.doc),
    // What each paired device last reported it can read, for the confirmation before a schema-raising push.
    devices: (db.prepare("SELECT * FROM sync_device_schema").all() as any[]).filter((entry) => devices.get(entry.device_id)?.state === "active")
      .map((entry) => ({ deviceId: entry.device_id, deviceName: deviceName(entry.device_id), supportedSchemaVersion: { project: entry.project, script: entry.script, workflow: entry.workflow }, lastSeen_ms: devices.get(entry.device_id)!.lastSeen_ms })),
  }));
  define("jagentchill.presence.subscribe", (p, connection) => { subscribe(presenceStream(p.doc), connection); return { entries: presenceOf(p.doc) }; });
  define("jagentchill.presence.unsubscribe", (p, connection) => unsubscribe(presenceStream(p.doc), connection.connId));

  // The storage figures of the host space header. The breakdown names every category; the ones no capability writes yet are zero.
  methods.set("jagentchill.settings.storage.get", { scope: "jagentchill.config.read", handle: () => blobs.usage(documents.trash.bytes(), documents.documentBytes()) });

  // ── host principals ────────────────────────────────────────────────────────────────────────────────────────────────
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /**
   * A batch prepared on the host (an agent's accepted proposal, a workflow editor node, a Film Studio action, an
   * automation). With nobody editing, the principal takes the lease, appends one operation and releases it. While a
   * device holds the lease the batch is that device's to apply — the host never takes a device's lease.
   */
  async function applyHostBatch(batch: HostBatch): Promise<HostBatchResult> {
    const found = required(logDoc(batch.doc));
    for (let attempt = 0; ; attempt++) {
      const turn = await leases.host.begin(batch.doc, batch.principal);
      if (turn) {
        try {
          const head = documents.row(batch.doc)!.head;
          if (batch.baseRevision !== head) return { state: "rejected", head };
          const result = documents.push(batch.doc, head, [{ opId: randomUUID(), created_ms: now(), commandType: batch.commandType ?? "host.batch", label: batch.label, patches: batch.patches, schemaVersion: found.schema_version }], { kind: "host", principal: batch.principal });
          // A device that asked for the lease meanwhile gets it after this revision.
          announceOps(batch.doc, result.ops, result.head);
          audit(db, now(), batch.principal, "sync.host.batch", { doc: batch.doc, revision: result.head, originDeviceId: batch.originDeviceId });
          return { state: "applied", revision: result.head };
        } finally { turn.end(); }
      }
      const lease = leases.current(batch.doc) as Lease;
      if (lease.holder.kind !== "device") continue;
      const batchId = randomUUID(), holder = conns.get(lease.holder.connId);
      let silence: ReturnType<typeof setTimeout> | undefined;
      const answer = new Promise<"applied" | "busy" | "rejected">((resolve) => {
        remoteAnswers.set(batchId, resolve);
        // No answer within ten seconds counts as busy.
        silence = setTimeout(() => resolve("busy"), deps.timings?.applyRemoteAnswerMs ?? APPLY_REMOTE_ANSWER_MS);
      });
      try { holder?.send("jagentchill.sync.applyRemote", syncStream(batch.doc), { doc: batch.doc, batchId, baseRevision: batch.baseRevision, label: batch.label, patches: batch.patches }); } catch { /* answered as busy */ }
      const result = await answer;
      clearTimeout(silence);
      remoteAnswers.delete(batchId);
      if (result === "applied") { audit(db, now(), batch.principal, "sync.host.batch", { doc: batch.doc, appliedBy: lease.holder.deviceId, originDeviceId: batch.originDeviceId }); return { state: "applied", revision: documents.row(batch.doc)!.head }; }
      if (result === "rejected") return { state: "rejected", head: documents.row(batch.doc)!.head };
      if (attempt >= APPLY_REMOTE_RETRIES - 1) return { state: "waiting", deviceName: lease.holderName };
      await pause(deps.timings?.applyRemoteRetryMs ?? APPLY_REMOTE_RETRY_MS);
    }
  }

  // ── signed HTTP routes of media bytes ──────────────────────────────────────────────────────────────────────────────
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const parse = <T>(schema: z.ZodType<T, any, any>, body: Buffer): T => {
    let value: unknown;
    try { value = JSON.parse(body.toString("utf8")); } catch { throw new ProtocolError("INVALID_PARAMS", "The request body is not valid JSON."); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request body does not match the expected shape.");
    return parsed.data;
  };
  const track = (deviceId: string, socket: { destroy(): void }) => { let set = transfers.get(deviceId); if (!set) transfers.set(deviceId, (set = new Set())); set.add(socket); return () => void set.delete(socket); };
  /** Handles the blob routes; `false` when the path is not one of them. */
  async function route({ req, res, target, path, loopback }: RouteRequest): Promise<boolean> {
    const match = ROUTE.exec(path);
    if (!match) return false;
    const [, sha256, action, chunkIndex, variant] = match, method = req.method ?? "GET";
    const signed = (scope: Scope, body: Uint8Array = new Uint8Array()) => deps.auth.authenticate({ method, target, headers: req.headers, body }, scope);
    if (method === "POST" && action === "init") {
      const raw = await readBody(req, MAX_ROUTE_JSON), deviceId = signed("jagentchill.media.write", raw);
      return json(res, 200, blobs.init(sha256, parse(blobInitSchema, raw), deviceId)), true;
    }
    if (method === "PUT" && action?.startsWith("chunks/")) {
      // The signature covers the hash of the body, so the chunk is read whole (4 MiB) before it is trusted.
      const rate = rateOf(req);
      const raw = await readBody(req, BLOB_CHUNK_BYTES, rate ? { key: `up:${String(req.headers["x-jagentchill-device"])}`, rate: uploadBudget(rate) } : undefined), deviceId = signed("jagentchill.media.write", raw), done = track(deviceId, req.socket);
      try { return json(res, 200, blobs.putChunk(sha256, Number(chunkIndex), raw)), true; } finally { done(); }
    }
    if (method === "POST" && action === "complete") {
      signed("jagentchill.media.write", await readBody(req, MAX_ROUTE_JSON));
      const completed = await blobs.complete(sha256), about = blobs.describe(sha256);
      // An original that needs a proxy gets one from the host, so that other devices can start from the 720p preview.
      if (about && about.purpose === "media" && about.variantOf === null) void mediaJobs.originalArrived(sha256);
      return json(res, 200, { complete: true, ...completed }), true;
    }
    if (method === "POST" && action === "link") {
      const raw = await readBody(req, MAX_ROUTE_JSON), deviceId = signed("jagentchill.media.write", raw);
      // Linking reads a path of this machine: only the desktop app that started this server, over loopback, may ask.
      if (!loopback || req.headers["x-forwarded-for"] !== undefined || devices.get(deviceId)?.localSupervisor !== true) throw new ProtocolError("SCOPE_DENIED", "Only the desktop app of this computer can link files.", { httpStatus: 403 });
      const linked = blobs.link(sha256, parse(blobLinkSchema, raw), deviceId);
      void blobs.verifyLinks().catch(() => undefined);
      return json(res, 200, linked), true;
    }
    if (method === "GET" && action === "status") { signed("jagentchill.media.read"); return json(res, 200, blobs.status(sha256)), true; }
    if ((method === "GET" || method === "HEAD") && (action === undefined || action.startsWith("variants/"))) {
      const deviceId = signed("jagentchill.media.read");
      let found: ReturnType<typeof blobs.locate>;
      try { found = blobs.locate(sha256, variant); } catch (error) {
        const job = variant ? mediaJobs.active(sha256, variant) : undefined;
        // A variant that a queued job is producing: the client waits for that job instead of failing the clip.
        if (error instanceof ProtocolError && error.code === "VARIANT_UNAVAILABLE" && job) throw new ProtocolError("VARIANT_UNAVAILABLE", "This variant is being produced.", { httpStatus: 404, retryable: true, details: { jobId: job.jobId } });
        throw error;
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
      const start = range ? Number(range[1]) : 0, end = range && range[2] !== "" ? Math.min(Number(range[2]), found.size - 1) : found.size - 1;
      if (range && (start > end || start >= found.size) && found.size > 0) { res.writeHead(416, { "content-range": `bytes */${found.size}` }); res.end(); return true; }
      res.writeHead(range ? 206 : 200, {
        "content-type": found.mime, "content-length": String(Math.max(0, end - start + 1)), "accept-ranges": "bytes", "cache-control": "private, no-store", "x-jagentchill-sha256": found.sha256,
        "access-control-expose-headers": "content-range, content-length, x-jagentchill-sha256", ...(range ? { "content-range": `bytes ${start}-${end}/${found.size}` } : {}),
      });
      if (method === "HEAD" || found.size === 0) { res.end(); return true; }
      // The file is streamed from disk; a revocation of the device destroys the socket mid-transfer.
      const stream = createReadStream(found.path, { start, end }), done = track(deviceId, res);
      stream.on("error", () => res.destroy());
      res.on("close", () => { done(); stream.destroy(); });
      const rate = rateOf(req);
      if (!rate) { stream.pipe(res); return true; }
      // A download limit: the bytes leave no faster than the device asked.
      void (async () => {
        try { for await (const piece of stream) { await pace(`down:${deviceId}`, rate, (piece as Buffer).length); if (res.destroyed) return; if (!res.write(piece)) await new Promise((resolve) => res.once("drain", resolve)); } res.end(); } catch { res.destroy(); }
      })();
      return true;
    }
    throw new ProtocolError("NOT_FOUND", "No such route.", { httpStatus: 404 });
  }

  function sweep(): void {
    leases.sweep();
    let stale = false;
    for (const [connId, entry] of presence) if (now() - entry.seen_ms > PRESENCE_STALE_MS) { presence.delete(connId); stale = true; presenceChanged(entry.openDoc); }
    if (stale) publish(presenceStream(), "jagentchill.presence.changed", { entries: presenceOf() });
  }
  /** The background sweep of host storage: every six hours and at start. */
  function storageSweep(): { uploads: number; unreferenced: number; purged: number } {
    const purged = documents.trash.expire();
    db.prepare("DELETE FROM sync_library WHERE deleted_ms IS NOT NULL AND deleted_ms < ?").run(now() - LIBRARY_TOMBSTONE_RETENTION_MS);
    documents.expireVersions();
    db.prepare("DELETE FROM sync_idempotency WHERE ts_ms < ?").run(now() - 86_400_000);
    return { ...blobs.sweep(), purged };
  }
  const timers = [setInterval(sweep, 1000), setInterval(() => { try { storageSweep(); } catch { /* retried at the next interval */ } }, STORAGE_SWEEP_INTERVAL_MS)];
  for (const timer of timers) timer.unref();
  try { storageSweep(); } catch { /* retried at the next interval */ }

  return {
    methods, route, sweep, storageSweep, documents, blobs, leases, mediaJobs,
    subscribeJob(jobId: string, connection: Connection) { subscribe(jobStream(jobId), connection); },
    unsubscribeJob(jobId: string, connection: Connection) { unsubscribe(jobStream(jobId), connection.connId); },
    publishJob(jobId: string, event: string, payload: unknown) { publish(jobStream(jobId), event, payload); },
    /** What host-side writers (agent tools, runs, Film Studio, automations) call to write a synced document. */
    host: {
      applyBatch: applyHostBatch,
      mediaDeviceIssues(projectId: string, assetId: string) {
        return [...(mediaStates.get(projectId) ?? [])].flatMap(([deviceId, report]) => {
          const state = report.assets.get(assetId);
          return state ? [{ deviceId, deviceName: report.deviceName, ...state }] : [];
        });
      },
      /** A host-side writer moves a document to the trash: refused while a device is editing it, and followers are told as for a device's deletion. */
      trash(doc: DocRef, deviceId: string): void {
        required(logDoc(doc));
        const lease = leases.current(doc);
        if (lease?.holder.kind === "device") throw new ProtocolError("CONFLICT", `${lease.holderName} is editing this project`, { httpStatus: 409, details: { holderName: lease.holderName, reason: "lease_held" } });
        documents.trash.move(doc, deviceId);
        leases.dropDocument(doc);
        publish(syncStream(doc), "jagentchill.sync.lease", { doc, lease: null, reason: "released" });
      },
      restore: (doc: DocRef): number => documents.trash.restore(doc),
    },
    presence: () => presenceOf(),
    dropConnection(connection: Connection): void {
      conns.delete(connection.connId);
      for (const [stream, set] of streams) { set.delete(connection.connId); if (set.size === 0) streams.delete(stream); }
      leases.dropConnection(connection.connId);
      const entry = presence.get(connection.connId);
      if (entry) { presence.delete(connection.connId); presenceChanged(entry.openDoc); }
      if (![...conns.values()].some((candidate) => candidate.deviceId === connection.deviceId && candidate.role() !== undefined)) {
        for (const [projectId, byDevice] of mediaStates) { byDevice.delete(connection.deviceId); if (byDevice.size === 0) mediaStates.delete(projectId); }
      }
    },
    /** Revocation: transfers in flight are cut, leases are freed. */
    dropDevice(deviceId: string): void {
      for (const socket of transfers.get(deviceId) ?? []) socket.destroy();
      transfers.delete(deviceId);
      for (const [projectId, byDevice] of mediaStates) { byDevice.delete(deviceId); if (byDevice.size === 0) mediaStates.delete(projectId); }
      leases.dropDevice(deviceId);
    },
    async close(): Promise<void> { for (const timer of timers) clearInterval(timer); await mediaJobs.close(); },
  };
}
export type SyncService = ReturnType<typeof createSyncService>;
