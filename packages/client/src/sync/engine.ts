import { applyPatch, canonicalize, type StatePatch } from "@jagentchill/editor-core";
import {
  BLOBS_IN_FLIGHT_PER_DEVICE, BLOB_MAX_BYTES, CONTINUITY_NEWER_BY_MS, LEASE_FLUSH_WAIT_MS, LEASE_HEARTBEAT_MS, MEDIA_POLICY, METERED_CONFIRM_BYTES, PRESENCE_HEARTBEAT_MS, PUSH_DEBOUNCE_MS,
  PUSH_MAX_BYTES, PUSH_MAX_OPS, SYNC_ERROR_VISIBLE_AFTER_MS, blobRoutes, docKey, syncStream, utf8,
  type ContinuityRecord, type DocRef, type Lease, type LeaseEvent, type PresenceBody, type PresenceEntry, type PushedOp, type SyncDocInfo, type SyncOp, type SyncPatchEntry, type TakeoverRequest,
} from "@jagentchill/protocol";
import type { HostConnection, HostEvent } from "../connection.ts";
import { HostError } from "../errors.ts";
import { randomBytes } from "@jagentchill/client/crypto";
import type { HostRecord } from "../pairing.ts";
import type { DeviceSigner } from "../signer.ts";
import { TransferAborted, assembledParts, downloadBlob, blobStatus, fetchVerified, gunzip, gzip, sha256Hex, signedRequest, uploadBlob, type BlobEnvironment, type PartStore } from "./blobs.ts";
import { DOWNLOAD_HASH_MISMATCH_MESSAGE, downloadExtension, extensionOf } from "./media-extension.ts";

type Json = Record<string, any>;
type JournalEntry = { baseRevision: number; revision: number; commandType: string; label: string; patch: unknown[] };
/** What sync needs of the device's store. `StoragePort` of `@jagentchill/storage` provides exactly these. */
export type SyncStorage = {
  readProjectText(id: string): Promise<string>;
  writeProjectText(id: string, text: string): Promise<void>;
  hasProject(id: string): Promise<boolean>;
  readJournal(projectId: string): Promise<JournalEntry[]>;
  truncateJournal(projectId: string, acknowledgedRevision: number): Promise<void>;
  clearJournal(projectId: string): Promise<void>;
  getSession<T>(key: string): Promise<T | undefined>;
  putSession(key: string, value: unknown): Promise<void>;
  deleteSession(key: string): Promise<void>;
  mediaInfo(projectId: string, assetId: string): Promise<{ assetId: string; contentHash: string; size: number; extension: string } | undefined>;
  listMedia(projectId: string): Promise<{ assetId: string; contentHash: string; size: number; extension: string }[]>;
  readMediaStream(projectId: string, assetId: string, range?: { start?: number; end?: number }): AsyncIterable<Uint8Array>;
  writeMediaStream(projectId: string, assetId: string, source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options?: { contentHash?: string; extension?: string }): Promise<unknown>;
  writeLibraryFile(name: string, bytes: Uint8Array): Promise<void>;
  readLibraryFile(name: string): Promise<Uint8Array | undefined>;
  deleteLibraryFile(name: string): Promise<void>;
  listLibraryFiles(prefix: string): Promise<{ path: string; size: number }[]>;
  putSnapshot(projectId: string, snapshot: { id: string; kind: "automatic" | "manual"; created_ms: number; label: string; duration: number; schemaVersion: number | null; record: string }): Promise<void>;
  available(): Promise<number | null>;
  /** The device's cache store: a downloaded proxy lives there, like a proxy the device made itself. */
  cache?: { put(key: { kind: "proxy"; contentHash: string; variant?: string }, data: Uint8Array, options?: { projectId?: string }): Promise<number>; has(key: { kind: "proxy"; contentHash: string; variant?: string }): Promise<boolean> };
  /** Thumbnails of a project's media (`<assetId>.jpg`). */
  putBlob?(kind: "thumbnail", projectId: string, name: string, bytes: Uint8Array): Promise<void>;
};

/** What the device remembers of a synced project between launches. */
export type SyncRecord = {
  hostId: string; enabled: boolean;
  /** The host revision the saved record is at once its pending journal is left out. */
  revision: number;
  /** Operation ids of journal entries that were sent: a re-sent batch is recognised by the host. */
  opIds: Record<string, string>;
  /** The host head moved while this device held unpushed operations. `deferred`: the user chose "Not now". */
  conflict?: { head: number; detected_ms: number; deferred: boolean; hostAuthorName: string; hostUpdated_ms: number; onlyCopy?: boolean };
  /** The local document differs from the host copy without a journal that explains it (attached to an existing host copy). */
  diverged?: boolean;
  blocked?: "update-host" | "update-required" | "patch-invalid";
  /** A deletion made offline, applied on reconnect only if the host copy did not change. */
  tombstone?: { baseRevision: number };
  /** Local versions "Local changes from <date>", kept 30 days. */
  localVersions?: { snapshotId: string; expires_ms: number }[];
  lastSynced_ms: number;
};
export type SyncStatus =
  | { kind: "local" } | { kind: "synced" } | { kind: "syncing"; count: number } | { kind: "offline"; count: number; waitingFor?: string } | { kind: "conflict" }
  | { kind: "viewing"; name: string; agent: boolean; sameDevice: boolean } | { kind: "paused" } | { kind: "update-host" } | { kind: "update-required" }
  | { kind: "storage-full" } | { kind: "error"; message: string } | { kind: "deleted"; by: string };
export type SessionState = {
  doc: DocRef; status: SyncStatus;
  /** `editing`: this device holds the lease. `viewing`: another writer does. `branch`: local edits that are not pushed. `free`: nobody edits. */
  mode: "editing" | "viewing" | "branch" | "free" | "local";
  lease: Lease | null; head: number; revision: number; pending: number;
  conflict: SyncRecord["conflict"] | null;
  /** Another device asks this one, the holder, to hand over; or the holder offers this device the lease. */
  request: (TakeoverRequest & { role: "holder" | "target" }) | null;
  /** The answer to this device's own "Request to edit". */
  requesting: "waiting" | "declined" | "cooldown" | null; requestRetry_ms: number;
  presence: PresenceEntry[]; continuity: ContinuityRecord | null; canWrite: boolean; following: boolean;
};
export type Transfer = {
  id: string; projectId: string; assetId: string; sha256: string; name: string; direction: "upload" | "download"; size: number; bytes: number;
  state: "queued" | "active" | "paused" | "failed" | "done" | "waiting-wifi" | "too-large" | "no-space" | "host-full" | "not-uploaded";
  speed: number; error?: string; started_ms?: number; variant?: string; mime?: string;
};
/** What the open editor gives a session: the document goes in and out through these, never around the command manager. */
export type SessionHooks = {
  /** Persists the record and its pending journal entries; resolves when storage acknowledged. */
  flush(): Promise<void>;
  /** The document the editor shows. */
  document(): Json;
  /** Replaces the editor's document with a state that came from the host (not a command: no patch, no undo step). */
  replace(document: Json, info: { label: string; revision: number }): void;
  /** The revision the next committed command builds on. */
  rebase(revision: number): void;
  setReadOnly(reason: string | null): void;
  /** A gesture or a preview is in flight. */
  busy?(): boolean;
  /** Applies a host batch through the command manager as one undo step; false when it does not apply. */
  applyStep?(patches: SyncPatchEntry[], label: string): boolean;
  /** The viewer follows the editor's playhead. */
  follow?(position: { sceneId?: string; playhead_ticks?: number; visibleRange?: { start: number; end: number } }): void;
};
export type SyncEngineOptions = {
  storage: SyncStorage;
  connection: () => HostConnection | undefined;
  host: () => HostRecord | undefined;
  signer: () => Promise<DeviceSigner>;
  deviceName: () => string;
  platform: "web" | "desktop" | "mobile";
  /** The highest schema this app writes, per kind. */
  supportedSchemaVersion: { project: number; script: number; workflow: number };
  /** The stored form of a project document (`serializeProjectRecord`). */
  serialize?: (document: Json) => string;
  newId: () => string;
  now?: () => number;
  blob?: Partial<Pick<BlobEnvironment, "fetch" | "sleep">>;
  /** Device preferences of the Sync card. */
  prefs?: { metered?: () => boolean; syncOverMobileData?: () => boolean; uploadLimit?: () => number | undefined; downloadLimit?: () => number | undefined; downloadOriginals?: () => boolean };
  onChange?: () => void;
};

const RECORD_KEY = (id: string) => `sync.project.${id}`, SETTINGS_KEY = "sync.settings", TRANSFERS_KEY = "sync.transfers";
const PARTS = (sha256: string, variant = "original") => `sync-parts/${sha256}.${variant}`;
const uuidV7 = (now: number): string => {
  const bytes = randomBytes(16);
  for (let index = 0, time = now; index < 6; index++) { bytes[5 - index] = time % 256; time = Math.floor(time / 256); }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes as Uint8Array, (byte: number) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const withoutLocal = (document: Json): Json => { const { local: _local, ...rest } = document; return rest; };
const codeOf = (error: unknown): string => (error instanceof HostError ? error.code : "INTERNAL");
/** `<name> (copy from <device name> <YYYY-MM-DD HH:mm>)`. */
export function copyName(name: string, deviceName: string, time_ms: number): string {
  const date = new Date(time_ms), two = (value: number) => String(value).padStart(2, "0");
  return `${name} (copy from ${deviceName} ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())})`;
}
/** Operations of one push: at most 100 and at most 393 216 bytes. `null` when the first one alone is too large. */
export function nextBatch<T>(ops: T[]): T[] | null {
  const batch: T[] = [];
  let bytes = 2;
  for (const op of ops.slice(0, PUSH_MAX_OPS)) {
    const size = utf8(JSON.stringify(op)).length + 1;
    if (bytes + size > PUSH_MAX_BYTES) break;
    batch.push(op); bytes += size;
  }
  return batch.length === 0 && ops.length > 0 ? null : batch;
}

/**
 * The device side of cross-device sync. Editing never waits for it: the editor commits and saves locally, and this
 * engine pushes what the store journalled, follows what other writers pushed, and keeps the offline branch when the
 * two cannot be joined. It never merges two operation sequences.
 */
export function createSyncEngine(options: SyncEngineOptions) {
  const { storage } = options, now = options.now ?? Date.now;
  const serialize = options.serialize ?? ((document: Json) => JSON.stringify(document));
  const sessions = new Map<string, ReturnType<typeof openSession>>();
  const listeners = new Set<() => void>();
  const records = new Map<string, SyncRecord | null>();
  let pausedAll = false, settingsLoaded: Promise<void> | undefined;
  let transfers: Transfer[] = [], running = 0, generation = 0, disposed = false;
  const mediaStateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let scheduleMediaStateReport: (projectId?: string) => void = () => undefined;
  const aborts = new Map<string, AbortController>();
  const changed = () => { generation += 1; options.onChange?.(); for (const listener of listeners) listener(); scheduleMediaStateReport(); };
  const connection = () => options.connection();
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const live = connection();
    if (!live) throw new HostError("CONNECTION_CLOSED", "No host is connected.", { retryable: true });
    return live.call<T>(method, params);
  };
  const blobEnv = async (): Promise<BlobEnvironment> => {
    const host = options.host();
    if (!host) throw new HostError("CONNECTION_CLOSED", "No host is connected.", { retryable: true });
    return { host, signer: await options.signer(), ...options.blob };
  };
  const loadSettings = () => (settingsLoaded ??= (async () => {
    pausedAll = (await storage.getSession<{ pausedAll: boolean }>(SETTINGS_KEY))?.pausedAll === true;
    // Transfers that were running when the app quit resume from the host's status, without rehashing what was confirmed.
    transfers = ((await storage.getSession<Transfer[]>(TRANSFERS_KEY)) ?? []).filter((transfer) => transfer.state !== "done").map((transfer) => ({ ...transfer, state: transfer.state === "active" ? "queued" : transfer.state, speed: 0 }));
  })());
  const saveTransfers = () => (disposed ? Promise.resolve() : storage.putSession(TRANSFERS_KEY, transfers.filter((transfer) => transfer.state !== "done")).catch(() => undefined));

  async function record(projectId: string): Promise<SyncRecord | null> {
    if (!records.has(projectId)) records.set(projectId, (await storage.getSession<SyncRecord>(RECORD_KEY(projectId))) ?? null);
    return records.get(projectId) ?? null;
  }
  async function saveRecord(projectId: string, value: SyncRecord | null): Promise<void> {
    records.set(projectId, value);
    if (value) await storage.putSession(RECORD_KEY(projectId), value); else await storage.deleteSession(RECORD_KEY(projectId));
    changed();
  }
  const readDocument = async (projectId: string): Promise<Json> => JSON.parse(await storage.readProjectText(projectId)) as Json;
  /** Keeps the device-local section of the stored record when the canonical part is replaced. */
  async function writeDocument(projectId: string, document: Json): Promise<void> {
    let local: unknown;
    try { local = (await readDocument(projectId)).local; } catch { local = undefined; }
    await storage.writeProjectText(projectId, serialize(local === undefined ? withoutLocal(document) : { ...withoutLocal(document), local }));
  }
  async function uploadSnapshot(document: Json): Promise<string> {
    const bytes = await gzip(canonicalize(document)), sha256 = await sha256Hex(bytes);
    await uploadBlob(await blobEnv(), { sha256, size: bytes.length, mime: "application/gzip", name: "snapshot.json.gz", purpose: "snapshot", read: async (start, end) => bytes.subarray(start, end) });
    return sha256;
  }
  /** The host's head: the newest snapshot (verified, one retry) and the operations after it. Nothing is written locally. */
  async function fetchHead(doc: DocRef, info: SyncDocInfo): Promise<{ document: Json; revision: number }> {
    const env = await blobEnv();
    const snapshot = async (sha256: string): Promise<Json> => {
      let bytes: Uint8Array;
      try { bytes = await fetchVerified(env, sha256); } catch (error) {
        if (codeOf(error) !== "BLOB_HASH_MISMATCH") throw error;
        bytes = await fetchVerified(env, sha256);
      }
      return JSON.parse(await gunzip(bytes)) as Json;
    };
    let document = await snapshot(info.snapshot.sha256), revision = info.snapshot.revision;
    while (revision < info.head) {
      const { ops } = await call<{ ops: SyncOp[]; head: number }>("jagentchill.sync.ops.pull", { doc, afterRevision: revision });
      if (ops.length === 0) break;
      for (const op of ops) { document = op.snapshot ? await snapshot(op.snapshot.sha256) : applyPatch(document, op.patches as StatePatch); revision = op.revision; }
    }
    return { document, revision };
  }
  const mediaAssets = (document: Json): { id: string; name: string; contentHash: string; size: number; type?: string }[] =>
    ((document.media?.assets ?? []) as Json[]).filter((asset) => typeof asset.contentHash === "string").map((asset) => ({ id: asset.id, name: asset.name ?? asset.id, contentHash: asset.contentHash, size: asset.size ?? 0, type: asset.type }));
  scheduleMediaStateReport = (projectId?: string) => {
    if (disposed || !connection()) return;
    const projects = projectId ? [projectId] : [...new Set([...sessions.keys(), ...transfers.map((transfer) => transfer.projectId)])];
    for (const id of projects) {
      const previous = mediaStateTimers.get(id);
      if (previous) clearTimeout(previous);
      mediaStateTimers.set(id, setTimeout(() => {
        mediaStateTimers.delete(id);
        void (async () => {
          const stored = await record(id);
          if (!stored?.enabled || !connection()) return;
          const assets = mediaAssets(await readDocument(id));
          const report = [] as { assetId: string; state: Transfer["state"]; reason?: string }[];
          for (const asset of assets) {
            const transfer = transfers.find((entry) => entry.projectId === id && entry.assetId === asset.id && entry.direction === "download" && entry.state !== "done");
            if (transfer) {
              report.push({ assetId: asset.id, state: transfer.state, ...(transfer.error ? { reason: transfer.error.slice(0, 500) } : {}) });
            } else if (!(await storage.mediaInfo(id, asset.id))) {
              report.push({ assetId: asset.id, state: "not-uploaded", reason: "Media is not available on this device." });
            }
          }
          await call("jagentchill.sync.media-state.report", { projectId: id, assets: report });
        })().catch(() => undefined);
      }, 500));
    }
  };
  const mimeOf = (asset: { name: string; type?: string }) => `${asset.type ?? "application"}/${extensionOf(asset.name) || "octet-stream"}`;

  // ── media transfers ────────────────────────────────────────────────────────────────────────────────────────────────
  const partStore = (sha256: string, variant?: string): PartStore => {
    const prefix = PARTS(sha256, variant);
    return {
      has: async (index) => (await storage.readLibraryFile(`${prefix}/${index}`)) !== undefined,
      put: (index, bytes) => storage.writeLibraryFile(`${prefix}/${index}`, bytes),
      get: async (index) => { const bytes = await storage.readLibraryFile(`${prefix}/${index}`); if (!bytes) throw new HostError("UNAVAILABLE", "A stored range is missing.", { retryable: true }); return bytes; },
      clear: async () => { for (const file of await storage.listLibraryFiles(prefix)) await storage.deleteLibraryFile(file.path); },
    };
  };
  function queueTransfer(entry: Omit<Transfer, "id" | "bytes" | "state" | "speed">, state: Transfer["state"] = "queued"): void {
    const id = `${entry.direction}:${entry.projectId}:${entry.assetId}${entry.variant ? `:${entry.variant}` : ""}`;
    const existing = transfers.find((transfer) => transfer.id === id);
    if (existing && existing.state !== "failed" && existing.state !== "done") return;
    transfers = [...transfers.filter((transfer) => transfer.id !== id), { ...entry, id, bytes: 0, state, speed: 0 }];
    void saveTransfers();
    changed();
    pump();
  }
  const patchTransfer = (id: string, patch: Partial<Transfer>) => { if (disposed) return; transfers = transfers.map((transfer) => (transfer.id === id ? { ...transfer, ...patch } : transfer)); changed(); };
  const metered = () => options.prefs?.metered?.() === true && options.prefs?.syncOverMobileData?.() !== true;
  /** Starts queued transfers, two blobs at a time. Media waits for an unmetered connection; operations never do. */
  function pump(): void {
    if (pausedAll || disposed || !connection()) return;
    for (const transfer of transfers) {
      if (running >= BLOBS_IN_FLIGHT_PER_DEVICE) return;
      if (transfer.state === "waiting-wifi" && !metered()) patchTransfer(transfer.id, { state: "queued" });
      if (transfer.state !== "queued" && transfer.state !== "waiting-wifi") continue;
      if (metered()) { if (transfer.state !== "waiting-wifi") patchTransfer(transfer.id, { state: "waiting-wifi" }); continue; }
      running += 1;
      void run(transfer.id).finally(() => { running -= 1; void saveTransfers(); pump(); });
    }
  }
  async function run(id: string): Promise<void> {
    const transfer = transfers.find((entry) => entry.id === id)!;
    const abort = new AbortController();
    aborts.set(id, abort);
    const started = now();
    patchTransfer(id, { state: "active", started_ms: started, error: undefined });
    const onProgress = ({ bytes }: { bytes: number }) => patchTransfer(id, { bytes, speed: Math.round((bytes * 1000) / Math.max(1, now() - started)) });
    try {
      const env = await blobEnv();
      if (transfer.direction === "upload") {
        const info = await storage.mediaInfo(transfer.projectId, transfer.assetId);
        if (!info) { patchTransfer(id, { state: "not-uploaded", error: "The file is not on this device." }); return; }
        const read = async (start: number, end: number) => {
          const parts: Uint8Array[] = [];
          let length = 0;
          for await (const part of storage.readMediaStream(transfer.projectId, transfer.assetId, { start, end })) { parts.push(part); length += part.length; }
          if (parts.length === 1) return parts[0];
          const out = new Uint8Array(length);
          let at = 0;
          for (const part of parts) { out.set(part, at); at += part.length; }
          return out;
        };
        await uploadBlob(env, { sha256: transfer.sha256, size: info.size, mime: transfer.mime ?? mimeOf({ name: transfer.name }), name: transfer.name, read }, { signal: abort.signal, onProgress, limit: options.prefs?.uploadLimit });
      } else {
        if (transfer.variant === "preview") { await downloadProxy(env, transfer, abort.signal, onProgress); return; }
        const target = { sha256: transfer.sha256, variant: transfer.variant, size: transfer.size, parts: partStore(transfer.sha256, transfer.variant) };
        const free = await storage.available();
        if (free !== null && free < transfer.size * 2) { patchTransfer(id, { state: "no-space" }); return; }
        for (let attempt = 0; ; attempt++) {
          await downloadBlob(env, target, { signal: abort.signal, onProgress, limit: options.prefs?.downloadLimit });
          const extension = transfer.size > 0 ? downloadExtension(transfer.name, await target.parts.get(0)) : extensionOf(transfer.name) || undefined;
          try {
            // The store hashes the bytes while it writes them and refuses a file that is not what its address says.
            await storage.writeMediaStream(transfer.projectId, transfer.assetId, assembledParts(target), { contentHash: transfer.sha256, extension });
            await target.parts.clear();
            break;
          } catch (error) {
            await target.parts.clear();
            // A corrupt copy is discarded and downloaded once more.
            // Only a real mismatch is downloaded again; a write the store refuses for any other reason fails with that reason.
            if (!(error instanceof Error && /hash|corrupt|mismatch/i.test(`${(error as { kind?: string }).kind ?? ""} ${error.message}`))) throw error;
            if (attempt >= 1) throw new HostError("BLOB_HASH_MISMATCH", DOWNLOAD_HASH_MISMATCH_MESSAGE, { retryable: true, details: { cause: String(error) } });
          }
        }
      }
      patchTransfer(id, { state: "done", bytes: transfer.size, speed: 0 });
      if (transfer.direction === "upload") uploaded.add(`${transfer.projectId}/${transfer.assetId}/${transfer.sha256}`); else mediaArrived(transfer.projectId, transfer.assetId, "original");
    } catch (error) {
      if (error instanceof TransferAborted) return;
      const code = codeOf(error);
      patchTransfer(id, { state: code === "QUOTA_EXCEEDED" ? "host-full" : code === "BLOB_TOO_LARGE" ? "too-large" : code === "BLOB_UNAVAILABLE" || code === "NOT_FOUND" ? "not-uploaded" : "failed", speed: 0, error: error instanceof Error ? error.message : String(error) });
    } finally { aborts.delete(id); }
  }
  /** Media this engine has seen complete on the host: not queued again by a later commit. */
  const uploaded = new Set<string>();
  const arrivals = new Set<(projectId: string, assetId: string, what: "original" | "proxy", proxy?: { size: number; sha256: string }) => void>();
  const mediaArrived = (projectId: string, assetId: string, what: "original" | "proxy", proxy?: { size: number; sha256: string }) => { for (const listener of arrivals) listener(projectId, assetId, what, proxy); };
  /**
   * The 720p proxy of an original: waits for the host's `media.proxy` job when one is producing it, downloads the
   * variant in ranges, verifies it against the SHA-256 the host reports for that variant (one more download on a
   * mismatch), and puts it in the device's cache where a proxy the device made itself would be.
   */
  async function downloadProxy(env: BlobEnvironment, transfer: Transfer, signal: AbortSignal, onProgress: (progress: { bytes: number }) => void): Promise<void> {
    const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let variant: { size: number; sha256: string } | undefined;
    for (let waited = 0; ; waited++) {
      if (signal.aborted) throw new TransferAborted();
      variant = (await blobStatus(env, transfer.sha256)).variants.preview;
      if (variant) break;
      // The job is queued or running on the host: the clip keeps its "Downloading" state until the proxy exists.
      if (waited > 1800) throw new HostError("VARIANT_UNAVAILABLE", "The host did not produce the proxy.", { retryable: true });
      await sleep(1000);
    }
    patchTransfer(transfer.id, { size: variant.size });
    const parts = partStore(transfer.sha256, "preview"), target = { sha256: transfer.sha256, variant: "preview", size: variant.size, parts };
    for (let attempt = 0; ; attempt++) {
      await downloadBlob(env, target, { signal, onProgress, limit: options.prefs?.downloadLimit });
      const pieces: Uint8Array[] = [];
      let length = 0;
      for await (const piece of assembledParts(target)) { pieces.push(piece); length += piece.length; }
      const bytes = new Uint8Array(length);
      let at = 0;
      for (const piece of pieces) { bytes.set(piece, at); at += piece.length; }
      await parts.clear();
      if ((await sha256Hex(bytes)) === variant.sha256) {
        await storage.cache?.put({ kind: "proxy", contentHash: transfer.sha256, variant: "mp4" }, bytes, { projectId: transfer.projectId });
        break;
      }
      if (attempt >= 1) throw new HostError("BLOB_HASH_MISMATCH", DOWNLOAD_HASH_MISMATCH_MESSAGE, { retryable: true });
    }
    patchTransfer(transfer.id, { state: "done", bytes: variant.size, speed: 0 });
    mediaArrived(transfer.projectId, transfer.assetId, "proxy", variant);
  }
  /** Queues the upload of every media file of a document that this device holds. */
  async function queueUploads(projectId: string, document: Json): Promise<number> {
    await loadSettings();
    let queued = 0;
    for (const asset of mediaAssets(document)) {
      const info = await storage.mediaInfo(projectId, asset.id);
      if (!info || uploaded.has(`${projectId}/${asset.id}/${asset.contentHash}`)) continue;
      queued += 1;
      queueTransfer({ projectId, assetId: asset.id, sha256: asset.contentHash, name: asset.name, direction: "upload", size: info.size, mime: mimeOf(asset) }, info.size > BLOB_MAX_BYTES ? "too-large" : "queued");
    }
    return queued;
  }
  /** The host's thumbnail of a media file (made by its FFmpeg job), so that the media panel shows a picture before the bytes arrive. */
  async function fetchThumbnail(projectId: string, assetId: string, sha256: string): Promise<void> {
    if (!storage.putBlob) return;
    try {
      const env = await blobEnv();
      let asked = await call<{ state: "ready" | "queued" | "not-needed" }>("jagentchill.blob.variant.request", { sha256, variant: "thumb" });
      // A job is producing it: asked again until it is there, for at most a minute.
      for (let waited = 0; asked.state === "queued" && waited < 60 && !disposed; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        asked = (await blobStatus(env, sha256)).variants.thumb ? { state: "ready" } : asked;
      }
      const thumb = asked.state === "ready" ? (await blobStatus(env, sha256)).variants.thumb : undefined;
      if (!thumb || disposed) return;
      const response = await signedRequest(env, "GET", blobRoutes.variant(sha256, "thumb"));
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if ((await sha256Hex(bytes)) !== thumb.sha256) return;
      await storage.putBlob("thumbnail", projectId, `${assetId}.jpg`, bytes);
      changed();
    } catch { /* a thumbnail is a convenience: the clip works without it; a host without FFmpeg has none */ }
  }
  /** Queues the download of the media this device lacks: proxies where the platform's policy says so and one exists. */
  async function queueDownloads(projectId: string, document: Json): Promise<number> {
    await loadSettings();
    let queued = 0;
    const policy = MEDIA_POLICY[options.platform], originals = options.prefs?.downloadOriginals?.() ?? policy.downloadOriginalsAutomatically;
    for (const asset of mediaAssets(document)) {
      if (await storage.mediaInfo(projectId, asset.id)) continue;
      let size = asset.size, state: Transfer["state"] = "queued";
      try {
        const status = await blobStatus(await blobEnv(), asset.contentHash);
        if (status.state !== "complete") state = "not-uploaded"; else size = status.size;
      } catch { /* decided when the transfer runs */ }
      queued += 1;
      // The host's thumbnail fills the media panel before any proxy or original has finished.
      void fetchThumbnail(projectId, asset.id, asset.contentHash);
      // Proxy-first where the platform's policy says so: the host's 720p preview, produced by its `media.proxy` job.
      // A source that needs no proxy (720 px or smaller), or a host without FFmpeg, leaves the original as the editing media.
      if (state === "queued" && !originals && policy.download === "preview" && storage.cache && asset.type === "video") {
        if (await storage.cache.has({ kind: "proxy", contentHash: asset.contentHash, variant: "mp4" }).catch(() => false)) continue;
        const asked = await call<{ state: "ready" | "queued" | "not-needed"; size?: number }>("jagentchill.blob.variant.request", { sha256: asset.contentHash, variant: "preview" }).catch(() => null);
        if (asked && asked.state !== "not-needed") { queueTransfer({ projectId, assetId: asset.id, sha256: asset.contentHash, name: asset.name, direction: "download", size: asked.size ?? 0, variant: "preview" }, state); continue; }
      }
      queueTransfer({ projectId, assetId: asset.id, sha256: asset.contentHash, name: asset.name, direction: "download", size }, state);
    }
    return queued;
  }

  /**
   * Media another device has not finished uploading shows "Not uploaded yet". The host is asked again every few
   * seconds; once the bytes are there the download starts by itself (as a proxy where the policy says so).
   */
  const recheck = setInterval(() => {
    if (disposed || pausedAll || !connection()) return;
    const waiting = transfers.filter((transfer) => transfer.direction === "download" && transfer.state === "not-uploaded");
    if (waiting.length === 0) return;
    void (async () => {
      const env = await blobEnv();
      for (const transfer of waiting) {
        const status = await blobStatus(env, transfer.sha256).catch(() => null);
        if (status?.state !== "complete") continue;
        transfers = transfers.filter((entry) => entry.id !== transfer.id);
        await queueDownloads(transfer.projectId, await readDocument(transfer.projectId)).catch(() => undefined);
      }
    })().catch(() => undefined);
  }, 4000);
  (recheck as { unref?(): void }).unref?.();

  // ── a document that is open in the editor ──────────────────────────────────────────────────────────────────────────
  function openSession(projectId: string, hooks: SessionHooks) {
    const doc: DocRef = { kind: "project", id: projectId };
    let closed = false, opened = false, busyPush: Promise<void> | null = null, pushTimer: ReturnType<typeof setTimeout> | null = null, heartbeat: ReturnType<typeof setInterval> | null = null;
    let presenceTimer: ReturnType<typeof setInterval> | null = null, takeoverTimer: ReturnType<typeof setTimeout> | null = null, errorSince: number | null = null, errorMessage = "";
    let position: { sceneId?: string; playhead_ticks?: number; visibleRange?: { start: number; end: number } } = {}, lastPositionSent = 0;
    let off: (() => void) | undefined, deletedBy: string | null = null;
    let state: SessionState = {
      doc, status: { kind: "local" }, mode: "local", lease: null, head: 0, revision: 0, pending: 0, conflict: null, request: null, requesting: null, requestRetry_ms: 0,
      presence: [], continuity: null, canWrite: false, following: false,
    };
    const subscribers = new Set<() => void>();
    const set = (patch: Partial<SessionState>) => { state = { ...state, ...patch }; state = { ...state, status: statusOf() }; for (const listener of subscribers) listener(); changed(); };
    const mine = (lease: Lease | null) => lease?.holder.kind === "device" && lease.holder.deviceId === deviceId && lease.holder.connId === connection()?.ready.connId;
    let deviceId = "";
    function statusOf(): SyncStatus {
      const stored = records.get(projectId);
      if (!stored?.enabled) return { kind: "local" };
      if (deletedBy !== null) return { kind: "deleted", by: deletedBy };
      if (pausedAll) return { kind: "paused" };
      if (stored.blocked === "update-host") return { kind: "update-host" };
      if (stored.blocked === "update-required") return { kind: "update-required" };
      if (stored.conflict || stored.diverged) return { kind: "conflict" };
      if (transfers.some((transfer) => transfer.projectId === projectId && transfer.state === "host-full")) return { kind: "storage-full" };
      if (stored.blocked === "patch-invalid") return { kind: "error", message: "A change could not be applied on the host." };
      if (errorSince !== null && now() - errorSince >= SYNC_ERROR_VISIBLE_AFTER_MS) return { kind: "error", message: errorMessage };
      if (!connection()) return state.pending > 0 ? { kind: "offline", count: state.pending } : { kind: "synced" };
      if (state.mode === "branch") return { kind: "offline", count: state.pending, ...(state.lease && !mine(state.lease) ? { waitingFor: state.lease.holderName } : {}) };
      if (state.mode === "viewing" && state.lease) return { kind: "viewing", name: state.lease.holderName, agent: state.lease.holder.kind === "host", sameDevice: state.lease.holder.kind === "device" && state.lease.holder.deviceId === deviceId };
      const moving = transfers.filter((transfer) => transfer.projectId === projectId && (transfer.state === "active" || transfer.state === "queued")).length;
      if (state.pending > 0 || moving > 0) return { kind: "syncing", count: state.pending + moving };
      return { kind: "synced" };
    }
    const stopHeartbeat = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = null; };
    const readOnly = () => hooks.setReadOnly(state.mode === "viewing" ? state.lease?.holderName ?? "" : null);
    async function patchRecord(patch: Partial<SyncRecord>): Promise<SyncRecord> {
      const next = { ...(await record(projectId))!, ...patch };
      for (const key of Object.keys(next) as (keyof SyncRecord)[]) if (next[key] === undefined) delete next[key];
      await saveRecord(projectId, next);
      return next;
    }
    const pendingCount = async () => (await storage.readJournal(projectId)).length;

    /** The lease is this device's: it writes, renews every ten seconds, and pushes what is pending. */
    function becomeEditor(lease: Lease): void {
      set({ lease, mode: "editing", requesting: null });
      readOnly();
      stopHeartbeat();
      heartbeat = setInterval(() => {
        void call<{ lease: Lease }>("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId }).then(({ lease: renewed }) => { if (state.lease?.leaseId === renewed.leaseId) state = { ...state, lease: renewed }; }, (error) => { if (codeOf(error) === "LEASE_NOT_HELD") void lostLease(); });
      }, LEASE_HEARTBEAT_MS);
      schedulePush(0);
    }
    /** The lease is gone: view-only at once when nothing is unpushed; with unpushed work the document stays this device's offline branch. */
    async function lostLease(lease: Lease | null = null): Promise<void> {
      stopHeartbeat();
      const pending = await pendingCount();
      set({ lease, pending, mode: pending > 0 ? "branch" : lease ? "viewing" : "free" });
      readOnly();
    }
    async function tryAcquire(): Promise<boolean> {
      const stored = await record(projectId);
      if (!stored?.enabled || !state.canWrite || stored.blocked === "update-required") return false;
      try {
        const { lease, head } = await call<{ lease: Lease; head: number }>("jagentchill.sync.lease.acquire", { doc, supportedSchemaVersion: options.supportedSchemaVersion.project });
        set({ head });
        if (head > stored.revision && (await pendingCount()) === 0) await catchUp();
        becomeEditor(lease);
        return true;
      } catch (error) {
        if (codeOf(error) === "LEASE_HELD") {
          const details = (error as HostError).details ?? {};
          const info = await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }).catch(() => null);
          const pending = await pendingCount();
          set({ lease: info?.lease ?? ({ leaseId: "", doc, holder: { kind: "device", deviceId: String(details.holderDeviceId ?? ""), connId: "", clientInstanceId: "" }, holderName: String(details.holderName ?? ""), acquired_ms: Number(details.acquired_ms ?? 0), expires_ms: Number(details.expires_ms ?? 0) } as Lease), pending, mode: pending > 0 ? "branch" : "viewing" });
          readOnly();
          return false;
        }
        if (codeOf(error) === "SCHEMA_TOO_NEW") { await patchRecord({ blocked: "update-required" }); set({ mode: "viewing" }); hooks.setReadOnly(""); return false; }
        await failed(error);
        return false;
      }
    }
    /** Brings a document without pending work to the host head and shows it. */
    async function catchUp(): Promise<void> {
      const stored = (await record(projectId))!;
      const info = await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc });
      if (info.head <= stored.revision) return;
      let document = withoutLocal(hooks.document()), revision = stored.revision;
      try {
        while (revision < info.head) {
          const { ops } = await call<{ ops: SyncOp[] }>("jagentchill.sync.ops.pull", { doc, afterRevision: revision });
          if (ops.length === 0) break;
          for (const op of ops) {
            if (op.snapshot) document = (await fetchHead(doc, { ...info, head: op.revision, snapshot: { revision: op.revision, ...op.snapshot } })).document;
            else document = applyPatch(document, op.patches as StatePatch);
            revision = op.revision;
          }
        }
      } catch (error) {
        if (codeOf(error) !== "SNAPSHOT_REQUIRED") throw error;
        ({ document, revision } = await fetchHead(doc, info));
      }
      await adopt(document, revision, "Synced from host");
    }
    /** Makes a state that came from the host the local one: shown, saved, and the base of what is committed next. */
    async function adopt(document: Json, revision: number, label: string): Promise<void> {
      hooks.replace(document, { label, revision });
      hooks.rebase(revision);
      // The save manager is the one writer of the record: it saves what it was just given.
      await hooks.flush().catch(() => writeDocument(projectId, document));
      await patchRecord({ revision, lastSynced_ms: now() });
      set({ revision, head: Math.max(state.head, revision) });
      void queueDownloads(projectId, document);
    }
    async function failed(error: unknown): Promise<void> {
      const code = codeOf(error);
      if (code === "PROJECT_PURGED" || code === "PROJECT_NOT_SYNCED") {
        // The host has no copy any more: the document, with whatever was unpushed, is this device's alone.
        stopHeartbeat();
        await storage.clearJournal(projectId).catch(() => undefined);
        await saveRecord(projectId, null);
        set({ mode: "local", lease: null, pending: 0, conflict: null });
        hooks.setReadOnly(null);
        return;
      }
      if (code === "PROJECT_IN_TRASH") { deletedBy = String((error as HostError).details?.deletedByName ?? ""); stopHeartbeat(); set({ lease: null, mode: "branch" }); hooks.setReadOnly(null); return; }
      if (code === "LEASE_NOT_HELD") { await lostLease((await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }).catch(() => null))?.lease ?? null); return; }
      if (code === "REVISION_CONFLICT") { await detectConflict(); return; }
      if (code === "SCHEMA_TOO_NEW") { await patchRecord({ blocked: "update-host" }); set({}); return; }
      if (code === "PATCH_INVALID") { await patchRecord({ blocked: "patch-invalid" }); set({}); return; }
      if (code === "CONNECTION_CLOSED" || code === "GATEWAY_UNREACHABLE") { set({ pending: await pendingCount() }); return; }
      errorSince ??= now(); errorMessage = error instanceof Error ? error.message : String(error);
      set({});
      // Retried by itself; shown as "Sync error" when it has not gone away within 30 seconds.
      if (!closed) setTimeout(() => { if (!closed) { set({}); schedulePush(0); } }, Math.min(SYNC_ERROR_VISIBLE_AFTER_MS, 5000));
    }
    /** The host head is not what the unpushed operations build on: nothing is pushed, the user chooses. */
    async function detectConflict(): Promise<void> {
      const stored = (await record(projectId))!, info = await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc });
      const pending = await pendingCount();
      set({ head: info.head, lease: info.lease, pending });
      if (info.head === stored.revision && !stored.diverged) return;
      if (pending === 0 && !stored.diverged) { await catchUp(); return; }
      const already = stored.conflict;
      const onlyCopy = info.schemaVersion > options.supportedSchemaVersion.project && info.minReaderSchemaVersion > options.supportedSchemaVersion.project;
      const conflict = { head: info.head, detected_ms: already?.detected_ms ?? now(), deferred: already?.deferred ?? false, hostAuthorName: info.lastAuthorName, hostUpdated_ms: info.updated_ms, ...(onlyCopy ? { onlyCopy } : {}) };
      await patchRecord({ conflict, ...(onlyCopy ? { blocked: "update-required" as const } : {}) });
      stopHeartbeat();
      set({ conflict, mode: "branch" });
      hooks.setReadOnly(null);
      if (!already) for (const listener of conflictListeners) listener(projectId);
    }

    function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
      if (closed) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; void push(); }, delay);
    }
    /** Pushes what the store journalled, in order, in batches. Entries leave the journal only when the host acknowledged them. */
    function push(): Promise<void> {
      if (busyPush) return busyPush.then(() => push());
      busyPush = (async () => {
        try {
          await hooks.flush().catch(() => undefined);
          for (;;) {
            const stored = await record(projectId), journal = await storage.readJournal(projectId);
            if (state.pending !== journal.length) set({ pending: journal.length });
            if (closed && !state.lease) return;
            if (!stored?.enabled || pausedAll || state.mode !== "editing" || !state.lease || stored.conflict || stored.blocked || journal.length === 0 || !connection()) return;
            const schemaVersion = Number(hooks.document().schemaVersion ?? options.supportedSchemaVersion.project);
            const opIds = { ...stored.opIds };
            const ops: PushedOp[] = journal.map((entry) => ({ opId: (opIds[entry.revision] ??= uuidV7(now())), created_ms: now(), commandType: entry.commandType, label: entry.label, patches: entry.patch as SyncPatchEntry[], schemaVersion }));
            await patchRecord({ opIds });
            const batch = nextBatch(ops);
            if (batch === null) {
              // One operation too large for a push: the state is committed whole, as exactly one revision.
              const document = withoutLocal(JSON.parse(await storage.readProjectText(projectId)) as Json), entry = journal[journal.length - 1];
              const sha256 = await uploadSnapshot(document);
              const { head } = await call<{ head: number }>("jagentchill.sync.snapshot.commit", { doc, leaseId: state.lease.leaseId, baseRevision: stored.revision, sha256, commandType: entry.commandType, label: entry.label, schemaVersion, idempotencyKey: opIds[journal[0].revision] });
              await storage.clearJournal(projectId);
              hooks.rebase(head);
              await patchRecord({ revision: head, opIds: {}, lastSynced_ms: now() });
              set({ revision: head, head, pending: 0 });
              continue;
            }
            const result = await call<{ revisions: number[]; head: number }>("jagentchill.sync.ops.push", { doc, leaseId: state.lease.leaseId, baseRevision: stored.revision, ops: batch });
            const acknowledged = journal[batch.length - 1].revision;
            await storage.truncateJournal(projectId, acknowledged);
            for (const entry of journal.slice(0, batch.length)) delete opIds[entry.revision];
            // The journal numbered its entries from the revision they were made on; the host's numbers are the truth.
            if (result.head !== acknowledged && batch.length === journal.length) hooks.rebase(result.head);
            await patchRecord({ revision: result.head, opIds, lastSynced_ms: now() });
            errorSince = null;
            set({ revision: result.head, head: result.head, pending: journal.length - batch.length });
            // Media imported since the last push: its bytes follow the operation that named it.
            if (batch.some((op) => op.patches.some((entry) => entry.path.startsWith("/media/assets")))) void queueUploads(projectId, withoutLocal(hooks.document()));
          }
        } catch (error) { await failed(error); } finally { busyPush = null; }
      })();
      return busyPush;
    }

    async function onEvent(event: HostEvent): Promise<void> {
      if (closed) return;
      if (event.event === "jagentchill.presence.changed" && event.payload.doc && docKey(event.payload.doc) === docKey(doc)) {
        const entries = event.payload.entries as PresenceEntry[];
        set({ presence: entries });
        // "Follow": the viewer's playhead tracks the editor's, carried by presence.
        const editor = entries.find((entry) => entry.mode === "editing" && entry.deviceId !== deviceId);
        if (state.following && editor) hooks.follow?.({ sceneId: editor.sceneId, playhead_ticks: editor.playhead_ticks, visibleRange: editor.visibleRange });
        return;
      }
      if (event.stream !== syncStream(doc)) return;
      if (event.event === "jagentchill.sync.ops") {
        const { ops, head } = event.payload as { ops: SyncOp[]; head: number };
        set({ head });
        if (state.mode === "editing") return;
        const stored = await record(projectId);
        if (!stored?.enabled) return;
        if ((await pendingCount()) > 0 || stored.diverged) { await detectConflict(); return; }
        // A gap in the stream is filled by its pull method.
        if (ops[0].baseRevision !== stored.revision || ops.some((op) => op.snapshot)) { await catchUp(); return; }
        let document = withoutLocal(hooks.document());
        for (const op of ops) document = applyPatch(document, op.patches as StatePatch);
        await adopt(document, ops[ops.length - 1].revision, ops[ops.length - 1].label);
        return;
      }
      if (event.event === "jagentchill.sync.lease") {
        const payload = event.payload as LeaseEvent;
        if (payload.reason === "requested" && mine(payload.lease) && payload.request) {
          set({ request: { ...payload.request, role: "holder" } });
          // With no answer the lease is handed over when the countdown ends.
          if (takeoverTimer) clearTimeout(takeoverTimer);
          takeoverTimer = setTimeout(() => void api.answerTakeover(true), Math.max(0, payload.request.deadline_ms - (connection()?.ready.serverTime_ms ?? now()) - (now() - readyAt)));
          return;
        }
        if (payload.reason === "offered" && payload.request) { set({ request: { ...payload.request, role: "target" } }); return; }
        if (payload.reason === "offer-ended") { set({ request: null }); return; }
        if (payload.reason === "declined") return;
        const wasMine = state.mode === "editing";
        if (mine(payload.lease)) { if (!wasMine) becomeEditor(payload.lease!); else state = { ...state, lease: payload.lease }; return; }
        if (takeoverTimer) { clearTimeout(takeoverTimer); takeoverTimer = null; }
        if (wasMine) { set({ request: null }); await lostLease(payload.lease); return; }
        const pending = await pendingCount();
        set({ lease: payload.lease, mode: pending > 0 ? "branch" : payload.lease ? "viewing" : "free" });
        readOnly();
        // A document in the host trash or removed from the host announces itself with a freed lease.
        if (!payload.lease && payload.reason === "released") await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }).catch((error) => failed(error));
        return;
      }
      if (event.event === "jagentchill.sync.applyRemote") {
        const { batchId, baseRevision, label, patches } = event.payload as { batchId: string; baseRevision: number; label: string; patches: SyncPatchEntry[] };
        const answer = (result: "applied" | "busy" | "rejected") => call("jagentchill.sync.applyRemote.result", { batchId, result }).catch(() => undefined);
        if (state.mode !== "editing" || hooks.busy?.()) { await answer("busy"); return; }
        await push();
        if (baseRevision !== state.revision || state.pending > 0) { await answer(state.pending > 0 ? "busy" : "rejected"); return; }
        if (!hooks.applyStep?.(patches, label)) { await answer("rejected"); return; }
        await push();
        await answer("applied");
        // A step of the host can bring media this device has never held (an agent's import, a generated picture):
        // it is fetched like the media of any revision that comes from the host, or it would stay "offline" here.
        await hooks.flush().catch(() => undefined);
        void readDocument(projectId).then((document) => queueDownloads(projectId, document)).catch(() => undefined);
      }
    }
    let readyAt = now();

    /** Runs when the session opens and again after every reconnect. */
    async function resume(): Promise<void> {
      await loadSettings();
      const stored = await record(projectId), live = connection();
      const pending = await pendingCount();
      state = { ...state, pending, revision: stored?.revision ?? 0, conflict: stored?.conflict ?? null };
      if (!stored?.enabled) { set({ mode: "local", lease: null }); hooks.setReadOnly(null); return; }
      if (!live) { stopHeartbeat(); set({ mode: pending > 0 || state.mode === "editing" ? "branch" : state.mode === "local" ? "branch" : state.mode, lease: null }); hooks.setReadOnly(null); return; }
      readyAt = now();
      deviceId = (await options.signer()).deviceId;
      off?.();
      off = live.on((event) => void onEvent(event).catch(() => undefined));
      set({ canWrite: live.ready.scopes.includes("jagentchill.projects.write") });
      try {
        const info = await call<SyncDocInfo>("jagentchill.sync.subscribe", { doc });
        await call("jagentchill.presence.subscribe", { doc }).then((result: any) => set({ presence: result?.entries ?? [] }), () => undefined);
        const theirs = info.continuity.filter((entry) => entry.deviceId !== deviceId).sort((a, b) => b.updated_ms - a.updated_ms)[0], own = info.continuity.find((entry) => entry.deviceId === deviceId);
        set({ head: info.head, lease: info.lease, continuity: !opened && theirs && theirs.updated_ms - (own?.updated_ms ?? 0) > CONTINUITY_NEWER_BY_MS ? theirs : state.continuity });
        opened = true;
        sendPresence(true);
        if (stored.tombstone) return;
        const tooNew = info.minReaderSchemaVersion > options.supportedSchemaVersion.project;
        if (tooNew && !stored.blocked) await patchRecord({ blocked: "update-required" });
        if (!tooNew && stored.blocked === "update-required" && !stored.conflict?.onlyCopy) await patchRecord({ blocked: undefined });
        if (pending > 0 || stored.diverged || stored.conflict) {
          // An offline branch: pushed without a prompt only when the host did not move and the lease can be had.
          if (info.head === stored.revision && !stored.diverged) {
            if (stored.conflict) await patchRecord({ conflict: undefined });
            set({ conflict: null, mode: "branch" });
            if (state.canWrite && !pausedAll && (await tryAcquire())) await push();
          } else await detectConflict();
          return;
        }
        if (info.head > stored.revision) await catchUp();
        // Media of the document this device does not hold yet is asked for whenever the project opens or the host comes
        // back — also at the head: a file can have been added by a step this device applied itself (the host's), or its
        // download can have been lost with an earlier session. Files already here are skipped.
        else void readDocument(projectId).then((document) => queueDownloads(projectId, document)).catch(() => undefined);
        // A lease of this device may be this very app instance's from before a reload or a reconnect: the host tells (it
        // re-binds the lease to the same instance and answers LEASE_HELD to another window).
        if (!info.lease || mine(info.lease) || (info.lease.holder.kind === "device" && info.lease.holder.deviceId === deviceId)) await tryAcquire();
        else { set({ mode: "viewing" }); readOnly(); }
      } catch (error) { await failed(error); }
    }
    function sendPresence(force = false): void {
      const live = connection();
      if (!live || closed || (!force && now() - lastPositionSent < 250)) return;
      lastPositionSent = now();
      const body: PresenceBody = {
        deviceType: options.platform === "mobile" ? "phone" : options.platform, appVisible: true, openDoc: doc, mode: state.mode === "editing" || state.mode === "branch" ? "editing" : "viewing",
        ...(position.sceneId !== undefined ? { sceneId: position.sceneId } : {}), ...(position.playhead_ticks !== undefined ? { playhead_ticks: Math.max(0, Math.round(position.playhead_ticks)) } : {}),
        ...(position.visibleRange ? { visibleRange: position.visibleRange } : {}), supportedSchemaVersion: options.supportedSchemaVersion, lastActivity_ms: now(),
      };
      void live.call("jagentchill.presence.heartbeat", body).catch(() => undefined);
    }
    presenceTimer = setInterval(() => sendPresence(true), PRESENCE_HEARTBEAT_MS);

    /** Replaces the local working copy by the host head; the journal goes with it. */
    async function resetToHost(): Promise<number> {
      const info = await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }), fetched = await fetchHead(doc, info);
      await storage.clearJournal(projectId);
      await patchRecord({ conflict: undefined, diverged: undefined, opIds: {}, blocked: undefined });
      await adopt(fetched.document, fetched.revision, "Keep the host version");
      set({ conflict: null, pending: 0, head: info.head, lease: info.lease, mode: info.lease && !mine(info.lease) ? "viewing" : "free" });
      readOnly();
      if (!info.lease) await tryAcquire();
      return fetched.revision;
    }

    const api = {
      /** The status is read when asked: transfers and the clock change it without an event of this session. */
      get state(): SessionState { const status = statusOf(); if (JSON.stringify(status) !== JSON.stringify(state.status)) state = { ...state, status }; return state; },
      subscribe(listener: () => void): () => void { subscribers.add(listener); return () => void subscribers.delete(listener); },
      resume,
      flushLocal: (): Promise<void> => hooks.flush().catch(() => undefined),
      /** The document the editor shows, without its device-local section. */
      document: (): Json => withoutLocal(hooks.document()),
      /** Sync was turned on (or the document re-based) while the editor has it open. */
      rebaseTo(revision: number): void { hooks.rebase(revision); },
      /** A command was committed in the editor. Never awaited by the editor: the edit is already applied and saved locally. */
      noteCommit(): void {
        const stored = records.get(projectId);
        if (!stored?.enabled) return;
        state = { ...state, pending: state.pending + 1 };
        if (state.mode !== "editing") { if (state.mode !== "branch" && state.mode !== "local") state = { ...state, mode: "branch" }; set({}); void hooks.flush().then(async () => set({ pending: await pendingCount() }), () => undefined); return; }
        set({});
        schedulePush(state.pending >= PUSH_MAX_OPS ? 0 : PUSH_DEBOUNCE_MS);
      },
      /** The playhead moved. Sent with presence, at most four times a second, and only while somebody follows. */
      notePosition(next: typeof position, byUser = true): void {
        position = { ...position, ...next };
        if (byUser && state.following) set({ following: false });
        if (state.presence.some((entry) => entry.deviceId !== deviceId)) sendPresence();
      },
      setFollowing(following: boolean): void { set({ following }); },
      dismissContinuity(): void { set({ continuity: null }); },
      /** "Start editing" when the lease became free. */
      startEditing: () => tryAcquire(),
      /** "Stop editing": pending operations are flushed (for at most five seconds), then the lease is released. */
      async stopEditing(): Promise<void> {
        if (state.mode !== "editing" || !state.lease) return;
        const leaseId = state.lease.leaseId;
        await Promise.race([push(), new Promise((resolve) => setTimeout(resolve, LEASE_FLUSH_WAIT_MS))]);
        stopHeartbeat();
        await call("jagentchill.sync.lease.release", { doc, leaseId }).catch(() => undefined);
        set({ lease: null, mode: (await pendingCount()) > 0 ? "branch" : "free" });
      },
      /** "Request to edit". Resolves when this device is the writer; otherwise the state says why not. */
      async requestEdit(): Promise<boolean> {
        set({ requesting: "waiting" });
        try {
          const { lease, head } = await call<{ lease: Lease; head: number }>("jagentchill.sync.lease.requestTakeover", { doc });
          set({ head });
          if ((await pendingCount()) === 0) await catchUp(); else if (head !== (await record(projectId))!.revision) { set({ lease, requesting: null }); await call("jagentchill.sync.lease.release", { doc, leaseId: lease.leaseId }).catch(() => undefined); await detectConflict(); return false; }
          becomeEditor(lease);
          return true;
        } catch (error) {
          const code = codeOf(error);
          if (code === "TAKEOVER_DECLINED") set({ requesting: "declined", requestRetry_ms: now() + 60_000 });
          else if (code === "TAKEOVER_COOLDOWN") set({ requesting: "cooldown", requestRetry_ms: now() + Number((error as HostError).details?.retryAfter_ms ?? 60_000) });
          else { set({ requesting: null }); await failed(error); }
          return false;
        }
      },
      /** "Take over now" of an admin device. */
      async forceTake(): Promise<void> {
        const { lease } = await call<{ lease: Lease }>("jagentchill.sync.lease.forceTake", { doc });
        if ((await pendingCount()) === 0) await catchUp();
        becomeEditor(lease);
      },
      /** The holder's "Hand over" / "Keep editing", or a transfer target's answer. */
      async answerTakeover(accept: boolean): Promise<void> {
        if (takeoverTimer) { clearTimeout(takeoverTimer); takeoverTimer = null; }
        const request = state.request;
        if (!request) return;
        set({ request: null });
        if (accept && request.role === "holder") await Promise.race([push(), new Promise((resolve) => setTimeout(resolve, LEASE_FLUSH_WAIT_MS))]);
        const { lease } = await call<{ lease: Lease | null }>("jagentchill.sync.lease.answerTakeover", { doc, accept }).catch(() => ({ lease: null as Lease | null }));
        if (request.role === "target" && accept && mine(lease)) { if ((await pendingCount()) === 0) await catchUp(); becomeEditor(lease!); }
      },
      /** "Transfer editing to…". Resolves true when the chosen device accepted. */
      async transfer(toDeviceId: string): Promise<{ accepted: boolean; deviceName?: string }> {
        await Promise.race([push(), new Promise((resolve) => setTimeout(resolve, LEASE_FLUSH_WAIT_MS))]);
        try { await call("jagentchill.sync.lease.transfer", { doc, toDeviceId }); return { accepted: true }; } catch (error) {
          if (codeOf(error) === "TAKEOVER_DECLINED") return { accepted: false, deviceName: String((error as HostError).details?.deviceName ?? "") };
          throw error;
        }
      },
      /** (a) "Keep this device's version": needs the lease; the superseded host head stays as a named version for 30 days. */
      async keepMine(): Promise<{ ok: true } | { ok: false; holderName: string }> {
        await hooks.flush().catch(() => undefined);
        const info = await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc });
        let lease: Lease;
        try { ({ lease } = await call<{ lease: Lease }>("jagentchill.sync.lease.acquire", { doc, supportedSchemaVersion: options.supportedSchemaVersion.project })); } catch (error) {
          if (codeOf(error) === "LEASE_HELD") return { ok: false, holderName: String((error as HostError).details?.holderName ?? "") };
          throw error;
        }
        const document = withoutLocal(JSON.parse(await storage.readProjectText(projectId)) as Json);
        const sha256 = await uploadSnapshot(document);
        const { head } = await call<{ head: number }>("jagentchill.sync.conflict.resolve", { doc, choice: "keep-device", leaseId: lease.leaseId, head: info.head, sha256, schemaVersion: Number(document.schemaVersion ?? options.supportedSchemaVersion.project), idempotencyKey: options.newId() });
        await storage.clearJournal(projectId);
        hooks.rebase(head);
        await patchRecord({ revision: head, conflict: undefined, diverged: undefined, blocked: undefined, opIds: {}, lastSynced_ms: now() });
        set({ revision: head, head, pending: 0, conflict: null });
        becomeEditor(lease);
        void queueUploads(projectId, document);
        return { ok: true };
      },
      /** (b) "Keep the host version": the working copy becomes the head; the local branch stays as a local version for 30 days. */
      async keepTheirs(): Promise<void> {
        await hooks.flush().catch(() => undefined);
        const text = await storage.readProjectText(projectId), document = JSON.parse(text) as Json, snapshotId = options.newId(), stored = (await record(projectId))!;
        await storage.putSnapshot(projectId, { id: snapshotId, kind: "manual", created_ms: now(), label: `Local changes from ${new Date(now()).toISOString().slice(0, 10)}`, duration: Number(document.metadata?.duration ?? 0), schemaVersion: Number(document.schemaVersion ?? null), record: text });
        await patchRecord({ localVersions: [...(stored.localVersions ?? []), { snapshotId, expires_ms: now() + 30 * 86_400_000 }] });
        await resetToHost();
      },
      /** (c) "Save mine as a copy": the local state becomes a new project with a new id; the original is reset to the head. */
      async saveCopy(): Promise<{ projectId: string; name: string }> {
        await hooks.flush().catch(() => undefined);
        const document = JSON.parse(await storage.readProjectText(projectId)) as Json, id = options.newId();
        const name = copyName(String(document.metadata?.name ?? ""), options.deviceName(), now());
        const copy = { ...document, metadata: { ...document.metadata, id, name, updated_ms: now() } };
        await storage.writeProjectText(id, serialize(copy));
        // The copy references the same media: known bytes are shared on this device and never uploaded a second time.
        for (const media of await storage.listMedia(projectId)) await storage.writeMediaStream(id, media.assetId, [], { contentHash: media.contentHash, extension: media.extension });
        const stored = (await record(projectId))!;
        if (!stored.conflict?.onlyCopy) await resetToHost();
        else { await storage.clearJournal(projectId); await patchRecord({ conflict: undefined }); set({ conflict: null, pending: 0 }); }
        return { projectId: id, name };
      },
      /** Restores a named host version: needs the lease; the result is a new revision whose state equals the version. */
      async restoreVersion(versionId: string): Promise<void> {
        if (state.mode !== "editing" || !state.lease) throw new HostError("LEASE_NOT_HELD", "Request to edit to restore a version");
        await push();
        const { head } = await call<{ head: number }>("jagentchill.sync.version.restore", { versionId, leaseId: state.lease.leaseId });
        set({ head });
        await catchUp();
      },
      /** The host's head document, for "Compare": fetched and verified, never written to this device. */
      async hostDocument(): Promise<Json> { return (await fetchHead(doc, await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }))).document; },
      /** (d) "Not now": the document stays editable locally; nothing is pushed until a choice is made. */
      async notNow(): Promise<void> {
        const stored = (await record(projectId))!;
        if (stored.conflict) { const conflict = { ...stored.conflict, deferred: true }; await patchRecord({ conflict }); set({ conflict }); }
      },
      /** "Retry" of a sync error. */
      async retry(): Promise<void> { errorSince = null; const stored = await record(projectId); if (stored?.blocked === "patch-invalid") await patchRecord({ blocked: undefined }); await resume(); schedulePush(0); },
      /** The session ends without a word to the host, as when the app is terminated: timers stop, nothing is released. */
      abandon(): void {
        closed = true;
        for (const timer of [pushTimer, takeoverTimer]) if (timer) clearTimeout(timer);
        if (presenceTimer) clearInterval(presenceTimer);
        stopHeartbeat();
        off?.();
        if (sessions.get(projectId) === api) sessions.delete(projectId);
      },
      /** Closing the document: flush what is pending, release the lease. */
      async close(): Promise<void> {
        if (closed) return;
        if (pushTimer) clearTimeout(pushTimer);
        if (presenceTimer) clearInterval(presenceTimer);
        if (takeoverTimer) clearTimeout(takeoverTimer);
        const lease = state.mode === "editing" ? state.lease : null;
        if (lease && connection()) await Promise.race([push(), new Promise((resolve) => setTimeout(resolve, LEASE_FLUSH_WAIT_MS))]);
        closed = true;
        stopHeartbeat();
        off?.();
        sessions.delete(projectId);
        const live = connection();
        if (live) {
          if (lease) await live.call("jagentchill.sync.lease.release", { doc, leaseId: lease.leaseId }).catch(() => undefined);
          void live.call("jagentchill.sync.unsubscribe", { doc }).catch(() => undefined);
          void live.call("jagentchill.presence.unsubscribe", { doc }).catch(() => undefined);
          // Closing the project writes the continuity record a last time.
          void live.call("jagentchill.presence.heartbeat", { deviceType: options.platform === "mobile" ? "phone" : options.platform, appVisible: true, supportedSchemaVersion: options.supportedSchemaVersion, lastActivity_ms: now() }).catch(() => undefined);
        }
      },
    };
    return api;
  }
  const conflictListeners = new Set<(projectId: string) => void>();

  return {
    /** Changes of any status, transfer or record. */
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    get generation(): number { return generation; },
    record, transfers: () => transfers,
    /** Whether a project is synced, from what was already read; the save manager asks this at every commit. */
    isSynced: (projectId: string): boolean => records.get(projectId)?.enabled === true,
    onConflict(listener: (projectId: string) => void): () => void { conflictListeners.add(listener); return () => void conflictListeners.delete(listener); },
    onMediaArrived(listener: (projectId: string, assetId: string, what: "original" | "proxy", proxy?: { size: number; sha256: string }) => void): () => void { arrivals.add(listener); return () => void arrivals.delete(listener); },
    /** "Download original" on a clip that plays from its proxy. */
    async downloadOriginal(projectId: string, assetId: string): Promise<void> {
      const document = await readDocument(projectId), asset = mediaAssets(document).find((entry) => entry.id === assetId);
      if (!asset || (await storage.mediaInfo(projectId, assetId))) return;
      const status = await blobStatus(await blobEnv(), asset.contentHash);
      queueTransfer({ projectId, assetId, sha256: asset.contentHash, name: asset.name, direction: "download", size: status.size || asset.size }, status.state === "complete" ? "queued" : "not-uploaded");
    },
    /** Opens the sync session of a project the editor has open. */
    open(projectId: string, hooks: SessionHooks) {
      const session = openSession(projectId, hooks);
      sessions.set(projectId, session);
      void session.resume().catch(() => undefined);
      scheduleMediaStateReport(projectId);
      return session;
    },
    session: (projectId: string) => sessions.get(projectId),
    /** The host connection came or went: sessions go offline or resume, transfers continue from the host's status. */
    connectionChanged(): void {
      for (const session of sessions.values()) void session.resume().catch(() => undefined);
      // Transfers the lost connection stopped — also those that ran out of retries while it was down — continue from what the host holds.
      void loadSettings().then(() => { if (connection()) for (const transfer of transfers) if ((transfer.state === "active" && !aborts.has(transfer.id)) || transfer.state === "failed") { transfer.state = "queued"; transfer.error = undefined; } pump(); changed(); scheduleMediaStateReport(); });
    },
    /** The revision the editor's save manager starts from: the synced base plus what is still pending. */
    async startRevision(projectId: string): Promise<{ synced: boolean; revision: number }> {
      const stored = await record(projectId);
      if (!stored?.enabled) return { synced: false, revision: 0 };
      const journal = await storage.readJournal(projectId);
      return { synced: true, revision: journal.length ? journal[journal.length - 1].revision : stored.revision };
    },
    /**
     * "Sync with <host name>": uploads a snapshot of the document as revision 1, or attaches to the copy the host
     * already has under this id, and queues the document's media.
     */
    async enable(projectId: string): Promise<{ attached: boolean; media: number }> {
      const host = options.host();
      if (!host) throw new HostError("CONNECTION_CLOSED", "No host is connected.", { retryable: true });
      // What is uploaded is the saved record: an open editor saves first.
      await sessions.get(projectId)?.flushLocal();
      const document = withoutLocal(await readDocument(projectId)), doc: DocRef = { kind: "project", id: projectId };
      const sha256 = await uploadSnapshot(document);
      const result = await call<{ attached: boolean; head: number; info: SyncDocInfo }>("jagentchill.sync.doc.enable", { doc, sha256, schemaVersion: Number(document.schemaVersion), idempotencyKey: options.newId() });
      let diverged = false;
      if (result.attached) diverged = canonicalize((await fetchHead(doc, await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }))).document) !== canonicalize(document);
      await storage.clearJournal(projectId);
      await saveRecord(projectId, { hostId: host.gatewayId, enabled: true, revision: result.head, opIds: {}, lastSynced_ms: now(), ...(diverged ? { diverged } : {}) });
      const media = await queueUploads(projectId, document);
      const session = sessions.get(projectId);
      session?.rebaseTo(result.head);
      if (session) await session.resume();
      return { attached: result.attached, media };
    },
    /** "On this device only": local edits stop being pushed and transfers stop; the host copy is kept unless asked otherwise. */
    async disable(projectId: string, removeHostCopy: boolean): Promise<void> {
      for (const transfer of transfers.filter((entry) => entry.projectId === projectId)) aborts.get(transfer.id)?.abort();
      transfers = transfers.filter((transfer) => transfer.projectId !== projectId);
      void saveTransfers();
      const session = sessions.get(projectId), doc: DocRef = { kind: "project", id: projectId };
      if (session?.state.mode === "editing") await session.stopEditing();
      if (removeHostCopy) await call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true });
      else if (connection()) await call("jagentchill.sync.doc.disable", { doc, removeHostCopy: false }).catch(() => undefined);
      await storage.clearJournal(projectId);
      await saveRecord(projectId, null);
      if (session) await session.resume();
    },
    /**
     * Deleting a synced project: the host copy goes to the host trash. Offline, the deletion is a pending tombstone
     * that is applied on reconnect only if the host copy did not change. Returns what happened.
     */
    async remove(projectId: string): Promise<"local" | "trashed" | "pending" | { refused: string }> {
      const stored = await record(projectId), doc: DocRef = { kind: "project", id: projectId };
      if (!stored?.enabled) return "local";
      if (!connection()) { await saveRecord(projectId, { ...stored, tombstone: { baseRevision: stored.revision } }); return "pending"; }
      try {
        await call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true });
        await saveRecord(projectId, null);
        return "trashed";
      } catch (error) {
        if (codeOf(error) === "CONFLICT") return { refused: String((error as HostError).details?.holderName ?? "") };
        if (codeOf(error) === "PROJECT_IN_TRASH" || codeOf(error) === "PROJECT_PURGED" || codeOf(error) === "PROJECT_NOT_SYNCED") { await saveRecord(projectId, null); return "trashed"; }
        throw error;
      }
    },
    /** On reconnect: pending tombstones are applied when the host copy is unchanged; otherwise the project is restored locally. */
    async applyTombstones(projectIds: string[]): Promise<{ deleted: string[]; restored: string[] }> {
      const deleted: string[] = [], restored: string[] = [];
      for (const projectId of projectIds) {
        const stored = await record(projectId);
        if (!stored?.tombstone || !connection()) continue;
        try {
          await call("jagentchill.sync.doc.disable", { doc: { kind: "project", id: projectId }, removeHostCopy: true, trash: true, baseRevision: stored.tombstone.baseRevision });
          await saveRecord(projectId, null);
          deleted.push(projectId);
        } catch (error) {
          if (codeOf(error) !== "REVISION_CONFLICT" && codeOf(error) !== "CONFLICT") continue;
          // "Changed on another device — not deleted": back at the host head.
          const { tombstone: _tombstone, ...rest } = stored;
          const doc: DocRef = { kind: "project", id: projectId }, fetched = await fetchHead(doc, await call<SyncDocInfo>("jagentchill.sync.doc.get", { doc }));
          await writeDocument(projectId, fetched.document);
          await saveRecord(projectId, { ...rest, revision: fetched.revision });
          restored.push(projectId);
        }
      }
      return { deleted, restored };
    },
    /**
     * Brings a project of the host space to this device: the newest snapshot (verified) and the operations after it.
     * Nothing is written when the download fails or the document needs a newer app.
     */
    async fetchProject(projectId: string): Promise<{ revision: number; name: string }> {
      const host = options.host(), doc: DocRef = { kind: "project", id: projectId };
      if (!host) throw new HostError("CONNECTION_CLOSED", "No host is connected.", { retryable: true });
      const info = await call<SyncDocInfo>("jagentchill.sync.project.get", { doc });
      if (info.schemaVersion > options.supportedSchemaVersion.project && info.minReaderSchemaVersion > options.supportedSchemaVersion.project) throw new HostError("SCHEMA_TOO_NEW", "Update JAgentChill on this device to open this project", { details: { kind: "project", schemaVersion: info.schemaVersion } });
      const fetched = await fetchHead(doc, info);
      await storage.writeProjectText(projectId, serialize(fetched.document));
      await storage.clearJournal(projectId);
      await saveRecord(projectId, { hostId: host.gatewayId, enabled: true, revision: fetched.revision, opIds: {}, lastSynced_ms: now() });
      void queueDownloads(projectId, fetched.document);
      return { revision: fetched.revision, name: info.name };
    },
    /** A project the host deleted or purged becomes this device's alone, with its offline changes. */
    async detach(projectId: string): Promise<void> { await storage.clearJournal(projectId).catch(() => undefined); await saveRecord(projectId, null); },
    queueUploads, queueDownloads,
    /** The state a clip shows while its media is not on this device. */
    mediaState(projectId: string, assetId: string): Transfer | undefined { return transfers.find((transfer) => transfer.projectId === projectId && transfer.assetId === assetId && transfer.direction === "download" && transfer.state !== "done"); },
    pauseTransfer(id: string): void { aborts.get(id)?.abort(); patchTransfer(id, { state: "paused", speed: 0 }); void saveTransfers(); },
    resumeTransfer(id: string): void { patchTransfer(id, { state: "queued", error: undefined }); void saveTransfers(); pump(); },
    /** Cancels one transfer. What the host already received of an upload stays resumable for seven days. */
    cancelTransfer(id: string): void { aborts.get(id)?.abort(); transfers = transfers.filter((transfer) => transfer.id !== id); void saveTransfers(); changed(); pump(); },
    /** "Download now" on a metered connection: this one item goes regardless of the setting. */
    downloadNow(id: string): void { const transfer = transfers.find((entry) => entry.id === id); if (!transfer) return; patchTransfer(id, { state: "queued" }); running += 1; void run(id).finally(() => { running -= 1; void saveTransfers(); pump(); }); },
    /** Whether a transfer on a metered connection asks first: anything above 100 MiB, even with the setting on. */
    needsMeteredConfirmation: (size: number): boolean => options.prefs?.metered?.() === true && size > METERED_CONFIRM_BYTES,
    get pausedAll(): boolean { return pausedAll; },
    /** "Pause all sync": no operation is pushed and no media moves until it is turned off. Persists across restarts. */
    async setPausedAll(paused: boolean): Promise<void> {
      await loadSettings();
      pausedAll = paused;
      await storage.putSession(SETTINGS_KEY, { pausedAll });
      if (paused) for (const abort of aborts.values()) abort.abort();
      transfers = transfers.map((transfer) => (paused && transfer.state === "active" ? { ...transfer, state: "queued" as const, speed: 0 } : transfer));
      changed();
      for (const session of sessions.values()) await session.resume().catch(() => undefined);
      if (!paused) pump();
    },
    /**
     * "Sync my library": the user's reusable items (saved sounds, brand kits, styles, LUT index) through the host, one
     * item per library record. The last writer wins by the time the HOST accepted the write; a write made without
     * having seen the stored value still wins, and the host keeps the value it replaced as "<name> (conflict <device>)".
     */
    async syncLibrary(names: readonly string[], io: { read(name: string): Promise<unknown | undefined>; write(name: string, value: unknown): Promise<void> }): Promise<{ pushed: string[]; pulled: string[]; conflicts: string[]; at_ms: number }> {
      type Known = Record<string, { serverUpdated_ms: number; hash: string }>;
      const known = (await storage.getSession<Known>("sync.library")) ?? {}, pushed: string[] = [], pulled: string[] = [], conflicts: string[] = [];
      const hashOf = async (value: unknown) => sha256Hex(utf8(JSON.stringify(value ?? null)));
      const KIND: Record<string, string> = { "saved-sounds": "preset", "brand-kits": "preset", styles: "text-template", luts: "lut" };
      const { items } = await call<{ items: { itemId: string; name: string; serverUpdated_ms: number; payload: unknown; deleted_ms?: number }[] }>("jagentchill.sync.library.list", {});
      for (const name of names) {
        const itemId = `library.${name}`, remote = items.find((item) => item.itemId === itemId && item.deleted_ms === undefined), before = known[name];
        const local = await io.read(name), localHash = local === undefined ? "" : await hashOf(local), localChanged = local !== undefined && localHash !== before?.hash;
        if (remote && remote.serverUpdated_ms > (before?.serverUpdated_ms ?? 0) && !localChanged) {
          await io.write(name, remote.payload);
          known[name] = { serverUpdated_ms: remote.serverUpdated_ms, hash: await hashOf(remote.payload) };
          pulled.push(name);
        } else if (localChanged) {
          const result = await call<{ item: { serverUpdated_ms: number }; conflict?: { name: string } }>("jagentchill.sync.library.put", { itemId, kind: KIND[name] ?? "preset", name, updated_ms: now(), ...(before ? { baseServerUpdated_ms: before.serverUpdated_ms } : remote ? { baseServerUpdated_ms: 0 } : {}), payload: local, idempotencyKey: options.newId() });
          known[name] = { serverUpdated_ms: result.item.serverUpdated_ms, hash: localHash };
          pushed.push(name);
          if (result.conflict) conflicts.push(result.conflict.name);
        }
      }
      await storage.putSession("sync.library", known);
      await storage.putSession("sync.library.at", now());
      return { pushed, pulled, conflicts, at_ms: now() };
    },
    librarySyncedAt: (): Promise<number | undefined> => storage.getSession<number>("sync.library.at"),
    /** The app is going away: transfers stop where they are and nothing more is written. What was queued resumes at the next launch. */
    dispose(): void {
      disposed = true;
      clearInterval(recheck);
      for (const timer of mediaStateTimers.values()) clearTimeout(timer);
      mediaStateTimers.clear();
      for (const abort of aborts.values()) abort.abort();
      for (const session of [...sessions.values()]) session.abandon();
    },
    /** The status of a project in the project list, without its editor being open. */
    async statusOf(projectId: string): Promise<SyncStatus> {
      await loadSettings();
      const open = sessions.get(projectId);
      if (open) return open.state.status;
      const stored = await record(projectId);
      if (!stored?.enabled) return { kind: "local" };
      if (pausedAll) return { kind: "paused" };
      if (stored.blocked === "update-host") return { kind: "update-host" };
      if (stored.blocked === "update-required") return { kind: "update-required" };
      if (stored.conflict || stored.diverged) return { kind: "conflict" };
      if (transfers.some((transfer) => transfer.projectId === projectId && transfer.state === "host-full")) return { kind: "storage-full" };
      const pending = (await storage.readJournal(projectId)).length, moving = transfers.filter((transfer) => transfer.projectId === projectId && (transfer.state === "active" || transfer.state === "queued")).length;
      if (pending > 0 && !connection()) return { kind: "offline", count: pending };
      if (pending > 0) return { kind: "offline", count: pending };
      return moving > 0 ? { kind: "syncing", count: moving } : { kind: "synced" };
    },
    /** Local versions made by "Keep the host version" that are older than 30 days. */
    async expiredLocalVersions(projectId: string): Promise<string[]> {
      const stored = await record(projectId), due = (stored?.localVersions ?? []).filter((version) => version.expires_ms < now());
      if (stored && due.length) await saveRecord(projectId, { ...stored, localVersions: (stored.localVersions ?? []).filter((version) => version.expires_ms >= now()) });
      return due.map((version) => version.snapshotId);
    },
  };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;
export type SyncSession = ReturnType<SyncEngine["open"]>;
