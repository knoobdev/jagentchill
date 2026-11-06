import { z } from "zod";
import { DEVICE_ID_PATTERN } from "./identity.ts";
import { PROJECT_SCHEMA_VERSION } from "./project-document/values.ts";

// ── Limits and timings of cross-device sync ──────────────────────────────────────────────────────────────────────────

export const LEASE_DURATION_MS = 30_000;
export const LEASE_HEARTBEAT_MS = 10_000;
/** A holder that gives the lease up first flushes its pending operations, for at most this long. */
export const LEASE_FLUSH_WAIT_MS = 5_000;
/** A device's `acquire` waits this long for a running host batch to be committed. */
export const HOST_YIELD_MS = 5_000;
/** A host batch waiting behind another one fails with `LEASE_HELD` after this long. */
export const HOST_BATCH_WAIT_MS = 30_000;
export const APPLY_REMOTE_ANSWER_MS = 10_000;
export const APPLY_REMOTE_RETRY_MS = 2_000;
export const APPLY_REMOTE_RETRIES = 5;
export const TAKEOVER_COUNTDOWN_MS = 30_000;
export const TAKEOVER_COOLDOWN_MS = 60_000;
export const MOBILE_BACKGROUND_RELEASE_MS = 20_000;

export const PUSH_MAX_OPS = 100;
export const PUSH_MAX_BYTES = 393_216;
export const PUSH_DEBOUNCE_MS = 500;
export const SNAPSHOT_EVERY_OPS = 200;
export const AUTOMATIC_SNAPSHOTS_RETAINED = 20;
export const VERSION_NAME_MAX = 80;

export const BLOB_CHUNK_BYTES = 4_194_304;
export const BLOB_MAX_BYTES = 68_719_476_736;
export const BLOB_CHUNKS_IN_FLIGHT = 3;
export const BLOBS_IN_FLIGHT_PER_DEVICE = 2;
export const BLOB_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
/** A transfer larger than this asks for confirmation on a metered connection. */
export const METERED_CONFIRM_BYTES = 104_857_600;
export const INCOMPLETE_UPLOAD_RETENTION_MS = 7 * 86_400_000;
export const UNREFERENCED_BLOB_RETENTION_MS = 86_400_000;
export const STORAGE_SWEEP_INTERVAL_MS = 6 * 3_600_000;
export const DEFAULT_STORAGE_QUOTA_BYTES = 107_374_182_400;
export const MIN_FREE_DISK_BYTES = 1_073_741_824;
export const STORAGE_WARN_RATIO = 0.9;

export const TRASH_RETENTION_MS = 30 * 86_400_000;
export const CONFLICT_VERSION_RETENTION_MS = 30 * 86_400_000;
export const LIBRARY_TOMBSTONE_RETENTION_MS = 30 * 86_400_000;
export const PRESENCE_HEARTBEAT_MS = 10_000;
export const PRESENCE_STALE_MS = 30_000;
/** Playhead fields travel at most this often while another device follows. */
export const FOLLOW_INTERVAL_MS = 250;
export const CONTINUITY_WRITE_INTERVAL_MS = 5_000;
export const CONTINUITY_NEWER_BY_MS = 60_000;
export const CONTINUITY_CHIP_MS = 10_000;
export const COMMENT_BODY_MAX = 2000;
export const HOST_SPACE_PAGE = 50;
/** A sync failure that no automatic retry resolved within this time is shown as "Sync error". */
export const SYNC_ERROR_VISIBLE_AFTER_MS = 30_000;

/** The highest schema of each synced kind this build of the server understands. */
export const MAX_SCHEMA_VERSION = { project: PROJECT_SCHEMA_VERSION, script: 1, workflow: 1 } as const;
export type MaxSchemaVersion = { project: number; script: number; workflow: number };

export const SYNC_ERROR_CODES = [
  "LEASE_HELD", "LEASE_NOT_HELD", "REVISION_CONFLICT", "SNAPSHOT_REQUIRED", "PATCH_INVALID", "PROJECT_NOT_SYNCED", "SCRIPT_NOT_SYNCED",
  "PROJECT_IN_TRASH", "PROJECT_PURGED", "SCHEMA_TOO_NEW", "BLOB_HASH_MISMATCH", "BLOB_INCOMPLETE", "BLOB_TOO_LARGE", "BLOB_UNAVAILABLE",
  "CHUNK_OUT_OF_RANGE", "VARIANT_UNAVAILABLE", "TAKEOVER_DECLINED", "TAKEOVER_COOLDOWN",
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

/** The channel methods of the five sync domains with the scope each needs. No other method exists in these domains. */
export const SYNC_METHODS = {
  "jagentchill.sync.project.list": "jagentchill.projects.read",
  "jagentchill.sync.doc.list": "jagentchill.projects.read",
  "jagentchill.sync.project.get": "jagentchill.projects.read",
  "jagentchill.sync.doc.get": "jagentchill.projects.read",
  "jagentchill.sync.ops.pull": "jagentchill.projects.read",
  "jagentchill.sync.version.list": "jagentchill.projects.read",
  "jagentchill.sync.subscribe": "jagentchill.projects.read",
  "jagentchill.sync.unsubscribe": "jagentchill.projects.read",
  "jagentchill.sync.doc.enable": "jagentchill.projects.write",
  "jagentchill.sync.doc.disable": "jagentchill.projects.write",
  "jagentchill.sync.ops.push": "jagentchill.projects.write",
  "jagentchill.sync.snapshot.commit": "jagentchill.projects.write",
  "jagentchill.sync.lease.acquire": "jagentchill.projects.write",
  "jagentchill.sync.lease.heartbeat": "jagentchill.projects.write",
  "jagentchill.sync.lease.release": "jagentchill.projects.write",
  "jagentchill.sync.lease.requestTakeover": "jagentchill.projects.write",
  "jagentchill.sync.lease.answerTakeover": "jagentchill.projects.write",
  "jagentchill.sync.lease.transfer": "jagentchill.projects.write",
  "jagentchill.sync.applyRemote.result": "jagentchill.projects.write",
  "jagentchill.sync.conflict.resolve": "jagentchill.projects.write",
  "jagentchill.sync.version.create": "jagentchill.projects.write",
  "jagentchill.sync.version.rename": "jagentchill.projects.write",
  "jagentchill.sync.version.restore": "jagentchill.projects.write",
  "jagentchill.sync.version.delete": "jagentchill.projects.write",
  "jagentchill.sync.media-state.report": "jagentchill.projects.read",
  "jagentchill.sync.library.list": "jagentchill.media.write",
  "jagentchill.sync.library.put": "jagentchill.media.write",
  "jagentchill.sync.library.delete": "jagentchill.media.write",
  "jagentchill.sync.lease.forceTake": "jagentchill.devices.manage",
  "jagentchill.blob.list": "jagentchill.media.read",
  "jagentchill.blob.get": "jagentchill.media.read",
  "jagentchill.blob.variant.request": "jagentchill.media.read",
  "jagentchill.media.probe": "jagentchill.media.read",
  "jagentchill.media.import": "jagentchill.media.write",
  "jagentchill.media.job.get": "jagentchill.media.read",
  "jagentchill.media.job.subscribe": "jagentchill.media.read",
  "jagentchill.media.job.unsubscribe": "jagentchill.media.read",
  "jagentchill.blob.delete": "jagentchill.media.write",
  "jagentchill.trash.list": "jagentchill.projects.read",
  "jagentchill.trash.restore": "jagentchill.projects.write",
  "jagentchill.trash.purge": "jagentchill.devices.manage",
  "jagentchill.comment.list": "jagentchill.projects.read",
  "jagentchill.comment.create": "jagentchill.comments.write",
  "jagentchill.comment.update": "jagentchill.comments.write",
  "jagentchill.comment.delete": "jagentchill.comments.write",
  "jagentchill.comment.resolve": "jagentchill.comments.write",
  "jagentchill.comment.subscribe": "jagentchill.projects.read",
  "jagentchill.comment.unsubscribe": "jagentchill.projects.read",
  "jagentchill.presence.heartbeat": "jagentchill.projects.read",
  "jagentchill.presence.list": "jagentchill.projects.read",
  "jagentchill.presence.subscribe": "jagentchill.projects.read",
  "jagentchill.presence.unsubscribe": "jagentchill.projects.read",
} as const;
export type SyncMethod = keyof typeof SYNC_METHODS;
export const SYNC_EVENTS = ["jagentchill.sync.ops", "jagentchill.sync.lease", "jagentchill.sync.snapshot", "jagentchill.sync.applyRemote", "jagentchill.comment.changed", "jagentchill.presence.changed", "jagentchill.media.job.updated"] as const;
/** Methods that create a resource and so require an `idempotencyKey`. */
export const SYNC_IDEMPOTENT_METHODS = ["jagentchill.sync.doc.enable", "jagentchill.sync.snapshot.commit", "jagentchill.sync.version.create", "jagentchill.comment.create", "jagentchill.sync.library.put"] as const;

// ── Documents, operations, leases ────────────────────────────────────────────────────────────────────────────────────

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const deviceId = z.string().regex(DEVICE_ID_PATTERN);
const key = z.string().min(1).max(128);

/** Documents with an operation log and a lease. */
export const LOG_DOC_KINDS = ["project", "script"] as const;
export type LogDocKind = (typeof LOG_DOC_KINDS)[number];
export const docRefSchema = z.object({ kind: z.enum(["project", "script", "workflow"]), id }).strict();
export type DocRef = { kind: "project" | "script" | "workflow"; id: string };
export const docKey = (doc: DocRef): string => `${doc.kind}:${doc.id}`;
export const syncStream = (doc: DocRef): string => `sync:${doc.kind}:${doc.id}`;
export const presenceStream = (doc?: DocRef): string => (doc ? `presence:${doc.kind}:${doc.id}` : "presence:host");
export const commentStream = (targetType: string, targetId: string): string => `comment:${targetType}:${targetId}`;

export const HOST_PRINCIPAL_PATTERN = /^(agent|run|film|automation):[A-Za-z0-9._:-]{1,160}$/;
export const patchEntrySchema = z.object({
  op: z.enum(["add", "remove", "replace"]), path: z.string().max(4096), value: z.unknown().optional(), before: z.string().max(200).optional(),
}).strict();
export type SyncPatchEntry = z.infer<typeof patchEntrySchema>;
export type SyncAuthor = { kind: "device"; deviceId: string } | { kind: "host"; principal: string };
/** An operation as its writer sends it; the server adds `doc`, `revision`, `baseRevision` and `author`. */
export const pushedOpSchema = z.object({
  opId: z.string().uuid(), created_ms: z.number().int().nonnegative(), commandType: z.string().max(200), label: z.string().max(400),
  patches: z.array(patchEntrySchema).max(100_000), schemaVersion: z.number().int().positive(),
}).strict();
export type PushedOp = z.infer<typeof pushedOpSchema>;
export type SyncOp = PushedOp & {
  doc: DocRef; revision: number; baseRevision: number; author: SyncAuthor;
  /** A revision made by a snapshot commit carries no patches: appliers fetch this snapshot instead. */
  snapshot?: { sha256: string; size: number };
};

/**
 * Who an author or a lease holder is, as FACTS a screen words in its own language — never an id. `name` is absent when
 * the host knows none: an agent that has no name of its own, a device whose record the host no longer has.
 */
export type AuthorDisplay = { kind: "device" | "agent" | "run" | "film" | "automation"; name?: string };
export type LeaseHolder = { kind: "device"; deviceId: string; connId: string; clientInstanceId: string } | { kind: "host"; principal: string };
export type Lease = { leaseId: string; doc: DocRef; holder: LeaseHolder; /** A name to show as it is: a device's name (its last known one), an agent's — never a principal or a session key. */ holderName: string; holderDisplay?: AuthorDisplay; acquired_ms: number; expires_ms: number };
export type TakeoverRequest = { deviceId: string; deviceName: string; requested_ms: number; deadline_ms: number; kind: "takeover" | "transfer" };
export type LeaseEvent = {
  doc: DocRef; lease: Lease | null;
  reason: "acquired" | "renewed" | "released" | "expired" | "handed-over" | "forced" | "transferred" | "requested" | "declined" | "offered" | "offer-ended";
  /** Present while a hand-over is being asked of the holder (`requested`) or of a transfer target (`offered`). */
  request?: TakeoverRequest;
  /** The device a forced takeover or a hand-over took the lease from. */
  previousHolderDeviceId?: string;
};
export type ContinuityRecord = { deviceId: string; deviceName: string; sceneId: string; playhead_ticks: number; updated_ms: number };
export type SyncDocInfo = {
  doc: DocRef; kind: DocRef["kind"]; name: string; duration: number; head: number; headSnapshotRevision: number;
  snapshot: { revision: number; sha256: string; size: number };
  schemaVersion: number; minReaderSchemaVersion: number; maxSchemaVersion: number; updated_ms: number;
  lastAuthor: SyncAuthor; /** See `Lease.holderName`. */ lastAuthorName: string; lastAuthorDisplay?: AuthorDisplay; lease: Lease | null; coverSha256: string | null; continuity: ContinuityRecord[];
};
export type SyncVersion = { versionId: string; doc: DocRef; name: string; revision: number; created_ms: number; authorDeviceId: string; authorName: string; source: "user" | "conflict"; expires_ms: number | null; sha256: string; size: number };
export type TrashEntry = { kind: "project" | "script" | "template" | "workflow-run" | "film" | "film-panel-asset"; id: string; name: string; deleted_ms: number; deletedBy: string; deletedByName: string; purge_ms: number };

const doc = docRefSchema;
const idem = { idempotencyKey: key };
const page = { search: z.string().max(200).optional(), sort: z.enum(["name", "date", "size"]).optional(), cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(HOST_SPACE_PAGE).optional() };
export const presenceBodySchema = z.object({
  deviceType: z.enum(["desktop", "web", "phone", "tablet"]), appVisible: z.boolean(), focusedSessionId: z.string().max(200).optional(),
  openDoc: docRefSchema.optional(), mode: z.enum(["editing", "viewing"]).optional(), sceneId: z.string().max(128).optional(),
  playhead_ticks: z.number().int().nonnegative().optional(), visibleRange: z.object({ start: z.number().int(), end: z.number().int() }).strict().optional(),
  supportedSchemaVersion: z.object({ project: z.number().int(), script: z.number().int(), workflow: z.number().int() }).strict(),
  lastActivity_ms: z.number().int().nonnegative(),
}).strict();
export type PresenceBody = z.infer<typeof presenceBodySchema>;
export type PresenceEntry = PresenceBody & { deviceId: string; connId: string; deviceName: string; role: string; seen_ms: number };
export const commentTargetSchema = z.object({ targetType: z.enum(["project", "script", "export"]), targetId: id }).strict();
export type SyncComment = {
  commentId: string; targetType: "project" | "script" | "export"; targetId: string; revision?: number; time_ticks?: number; anchor?: unknown;
  point?: { x: number; y: number }; body: string; authorDeviceId: string; authorName: string; created_ms: number; edited_ms?: number; resolved: boolean; parentId?: string;
};
export const LIBRARY_ITEM_KINDS = ["preset", "text-template", "project-template", "script-format", "lut", "font", "sticker-pack"] as const;
export type LibraryItem = { itemId: string; kind: (typeof LIBRARY_ITEM_KINDS)[number]; name: string; updated_ms: number; serverUpdated_ms: number; blobSha256?: string; payload: unknown; deleted_ms?: number };
export type HostBlobInfo = { sha256: string; size: number; mime: string; name: string; state: "uploading" | "complete" | "unavailable"; variants: string[]; linked: boolean; refCount: number; created_ms: number };
export type HostStorageInfo = { quotaBytes: number; usedBytes: number; freeDiskBytes: number; linkedBytes: number; breakdown: Record<"projects" | "media" | "proxies" | "exports" | "generated" | "workspaces" | "trash" | "backups", number> };

/** Parameter shapes of the sync methods; the server parses with these and the client types its calls from them. */
export const SYNC_PARAMS = {
  "jagentchill.sync.project.list": z.object(page).strict(),
  "jagentchill.sync.doc.list": z.object({ kind: z.enum(LOG_DOC_KINDS), ...page }).strict(),
  "jagentchill.sync.project.get": z.object({ doc }).strict(),
  "jagentchill.sync.doc.get": z.object({ doc }).strict(),
  "jagentchill.sync.ops.pull": z.object({ doc, afterRevision: z.number().int().nonnegative(), limit: z.number().int().min(1).max(500).optional() }).strict(),
  "jagentchill.sync.version.list": z.object({ doc }).strict(),
  "jagentchill.sync.subscribe": z.object({ doc }).strict(),
  "jagentchill.sync.unsubscribe": z.object({ doc }).strict(),
  "jagentchill.sync.doc.enable": z.object({ doc, sha256: sha256Hex, schemaVersion: z.number().int().positive(), ...idem }).strict(),
  // `trash: true` with `removeHostCopy: true` is a deletion (the host copy goes to the host trash); without it the
  // host copy is removed for good ("Remove from host") and every device's copy becomes "On this device only".
  "jagentchill.sync.doc.disable": z.object({ doc, removeHostCopy: z.boolean(), trash: z.boolean().optional(), baseRevision: z.number().int().nonnegative().optional() }).strict(),
  "jagentchill.sync.ops.push": z.object({ doc, leaseId: z.string().uuid(), baseRevision: z.number().int().nonnegative(), ops: z.array(pushedOpSchema).min(1) }).strict(),
  "jagentchill.sync.snapshot.commit": z.object({ doc, leaseId: z.string().uuid(), baseRevision: z.number().int().nonnegative(), sha256: sha256Hex, commandType: z.string().max(200), label: z.string().max(400), schemaVersion: z.number().int().positive().optional(), ...idem }).strict(),
  "jagentchill.sync.lease.acquire": z.object({ doc, supportedSchemaVersion: z.number().int().positive().optional() }).strict(),
  "jagentchill.sync.lease.heartbeat": z.object({ doc, leaseId: z.string().uuid() }).strict(),
  "jagentchill.sync.lease.release": z.object({ doc, leaseId: z.string().uuid() }).strict(),
  "jagentchill.sync.lease.requestTakeover": z.object({ doc }).strict(),
  "jagentchill.sync.lease.answerTakeover": z.object({ doc, accept: z.boolean() }).strict(),
  "jagentchill.sync.lease.transfer": z.object({ doc, toDeviceId: deviceId }).strict(),
  "jagentchill.sync.lease.forceTake": z.object({ doc }).strict(),
  "jagentchill.sync.applyRemote.result": z.object({ batchId: z.string().uuid(), result: z.enum(["applied", "busy", "rejected"]) }).strict(),
  "jagentchill.sync.conflict.resolve": z.object({ doc, choice: z.literal("keep-device"), leaseId: z.string().uuid(), head: z.number().int().positive(), sha256: sha256Hex, schemaVersion: z.number().int().positive().optional(), ...idem }).strict(),
  "jagentchill.sync.version.create": z.object({ doc, name: z.string().trim().min(1).max(VERSION_NAME_MAX), ...idem }).strict(),
  "jagentchill.sync.version.rename": z.object({ versionId: z.string().uuid(), name: z.string().trim().min(1).max(VERSION_NAME_MAX) }).strict(),
  "jagentchill.sync.version.restore": z.object({ versionId: z.string().uuid(), leaseId: z.string().uuid() }).strict(),
  "jagentchill.sync.version.delete": z.object({ versionId: z.string().uuid() }).strict(),
  "jagentchill.sync.media-state.report": z.object({
    projectId: id,
    assets: z.array(z.object({ assetId: id, state: z.enum(["queued", "active", "paused", "failed", "waiting-wifi", "too-large", "no-space", "host-full", "not-uploaded"]), reason: z.string().max(500).optional() }).strict()).max(5000),
  }).strict(),
  "jagentchill.sync.library.list": z.object({ since_ms: z.number().int().nonnegative().optional() }).strict(),
  "jagentchill.sync.library.put": z.object({ itemId: id, kind: z.enum(LIBRARY_ITEM_KINDS), name: z.string().min(1).max(200), updated_ms: z.number().int().nonnegative(), baseServerUpdated_ms: z.number().int().nonnegative().optional(), blobSha256: sha256Hex.optional(), payload: z.unknown(), ...idem }).strict(),
  "jagentchill.sync.library.delete": z.object({ itemId: id }).strict(),
  "jagentchill.blob.list": z.object(page).strict(),
  "jagentchill.blob.get": z.object({ sha256: sha256Hex }).strict(),
  "jagentchill.blob.variant.request": z.object({ sha256: sha256Hex, variant: z.enum(["preview", "thumb", "waveform", "mezzanine", "filmstrip", "filmstripdata"]) }).strict(),
  "jagentchill.media.probe": z.object({ sha256: sha256Hex }).strict(),
  "jagentchill.media.import": z.object({ projectId: id, sha256: sha256Hex, name: z.string().trim().min(1).max(255).optional() }).strict(),
  "jagentchill.media.job.get": z.object({ jobId: z.string().uuid() }).strict(),
  "jagentchill.media.job.subscribe": z.object({ jobId: z.string().uuid() }).strict(),
  "jagentchill.media.job.unsubscribe": z.object({ jobId: z.string().uuid() }).strict(),
  "jagentchill.blob.delete": z.object({ sha256: sha256Hex }).strict(),
  "jagentchill.trash.list": z.object({ kind: z.enum(["project", "script", "template", "workflow-run", "film", "film-panel-asset"]).optional() }).strict(),
  "jagentchill.trash.restore": z.object({ kind: z.enum(["project", "script", "template", "workflow-run", "film", "film-panel-asset"]), id }).strict(),
  "jagentchill.trash.purge": z.object({ kind: z.enum(["project", "script", "template", "workflow-run", "film", "film-panel-asset"]), id }).strict(),
  "jagentchill.comment.list": commentTargetSchema,
  "jagentchill.comment.create": z.object({
    commentId: z.string().uuid(), targetType: z.enum(["project", "script", "export"]), targetId: id, revision: z.number().int().positive().optional(), time_ticks: z.number().int().nonnegative().optional(),
    anchor: z.unknown().optional(), point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(),
    body: z.string().min(1).max(COMMENT_BODY_MAX), authorName: z.string().min(1).max(80).optional(), parentId: z.string().uuid().optional(), ...idem,
  }).strict(),
  "jagentchill.comment.update": z.object({ commentId: z.string().uuid(), body: z.string().min(1).max(COMMENT_BODY_MAX) }).strict(),
  "jagentchill.comment.delete": z.object({ commentId: z.string().uuid() }).strict(),
  "jagentchill.comment.resolve": z.object({ commentId: z.string().uuid(), resolved: z.boolean() }).strict(),
  "jagentchill.comment.subscribe": commentTargetSchema,
  "jagentchill.comment.unsubscribe": commentTargetSchema,
  "jagentchill.presence.heartbeat": presenceBodySchema,
  "jagentchill.presence.list": z.object({ doc: docRefSchema.optional() }).strict(),
  "jagentchill.presence.subscribe": z.object({ doc: docRefSchema.optional() }).strict(),
  "jagentchill.presence.unsubscribe": z.object({ doc: docRefSchema.optional() }).strict(),
} satisfies Record<SyncMethod, z.ZodTypeAny>;

// ── Blob routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const BLOB_VARIANTS = ["original", "preview", "thumb", "waveform", "mezzanine", "filmstrip", "filmstripdata"] as const;
export type BlobVariant = (typeof BLOB_VARIANTS)[number];
export const blobInitSchema = z.object({
  size: z.number().int().nonnegative(), mime: z.string().min(1).max(200), name: z.string().max(400), chunkSize: z.literal(BLOB_CHUNK_BYTES),
  /** Snapshots are stored as blobs and are not listed under "Media". */
  purpose: z.enum(["media", "snapshot"]).optional(),
  /** This blob is a variant of another one, produced by the importing device. */
  variantOf: z.object({ sha256: sha256Hex, variant: z.enum(["preview", "thumb", "waveform", "mezzanine", "filmstrip", "filmstripdata"]) }).strict().optional(),
}).strict();
export type BlobInit = z.infer<typeof blobInitSchema>;
export const blobLinkSchema = z.object({ path: z.string().min(1).max(4096), size: z.number().int().nonnegative(), mtime_ms: z.number().nonnegative(), mime: z.string().max(200).optional(), name: z.string().max(400).optional() }).strict();
export type BlobStatus = { state: "absent" | "uploading" | "complete" | "unavailable"; size: number; receivedChunks: number[]; variants: Record<string, { size: number; sha256: string }> };
export const blobRoutes = {
  init: (sha256: string) => `/jagentchill/v1/blobs/${sha256}/init`,
  chunk: (sha256: string, index: number) => `/jagentchill/v1/blobs/${sha256}/chunks/${index}`,
  complete: (sha256: string) => `/jagentchill/v1/blobs/${sha256}/complete`,
  link: (sha256: string) => `/jagentchill/v1/blobs/${sha256}/link`,
  status: (sha256: string) => `/jagentchill/v1/blobs/${sha256}/status`,
  bytes: (sha256: string) => `/jagentchill/v1/blobs/${sha256}`,
  variant: (sha256: string, variant: string) => `/jagentchill/v1/blobs/${sha256}/variants/${variant}`,
};
export const chunkCount = (size: number): number => Math.max(1, Math.ceil(size / BLOB_CHUNK_BYTES));

/** What a media policy downloads by default on a platform (proxy-first everywhere but desktop). */
export const MEDIA_POLICY = {
  desktop: { upload: "original", download: "original", downloadOriginalsAutomatically: true },
  web: { upload: "original", download: "preview", downloadOriginalsAutomatically: false },
  mobile: { upload: "original", download: "preview", downloadOriginalsAutomatically: false },
} as const;
