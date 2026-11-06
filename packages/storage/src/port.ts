import { sha256, toHex } from "@jagentchill/editor-core";
import { createCacheStore, type CacheStore } from "./cache.ts";
import { StorageError, toStorageError } from "./errors.ts";
import { createSha256, type ByteSource, type HasherFactory } from "./hash.ts";
import type { FileEntry, FileStore, RecordStore } from "./primitives.ts";

export type ProjectListEntry = {
  id: string; name: string; duration: number; updated_ms: number; folderId: string | null; trash: unknown | null; coverHash: string | null;
  schemaVersion: number | null; minReaderSchemaVersion: number | null;
  /** The record exists but its metadata cannot be read; it is listed, never dropped. */
  unreadable: boolean;
};
export type MediaEntry = { assetId: string; contentHash: string; size: number; extension: string };
export type SnapshotInfo = { id: string; kind: "automatic" | "manual"; created_ms: number; label: string; duration: number; schemaVersion: number | null; /** The name of the snapshot's thumbnail blob, when one was rendered. */ thumbnail?: string };
export type Snapshot = SnapshotInfo & { record: string };
export type BackupInfo = { name: string; sourceVersion: number; time_ms: number; bytes: number };
export type Backup = BackupInfo & { record: string; report?: unknown };
export type JournalEntry = { baseRevision: number; revision: number; commandType: string; label: string; patch: unknown[] };
export type BlobKind = "thumbnail" | "cover";
export type DocumentKind = "script" | "workflow" | "template";
/** A media file as it lies in the store, whether or not an index row or an asset record knows it. */
export type MediaFile = { projectId: string; assetId: string; size: number; modified_ms: number; indexed: boolean };
export type LibraryFile = "folders" | "saved-sounds" | "brand-kits" | "styles" | "luts";

/**
 * All client persistence goes through this interface. `editor-core` and UI code never call a storage technology
 * directly. The operations and the error types (`NotFound`, `QuotaExceeded`, `Corrupt`, `Unavailable`) are the same
 * on every platform.
 */
export interface StoragePort {
  readonly platform: "web" | "desktop" | "mobile";
  /** Every project, most recently modified first. */
  listProjects(): Promise<ProjectListEntry[]>;
  /** The stored record, byte for byte as it was written. */
  readProjectText(id: string): Promise<string>;
  readProject(id: string): Promise<Record<string, unknown>>;
  /** Atomic: the new record replaces the last good one only once it is completely written. */
  writeProjectText(id: string, text: string): Promise<void>;
  hasProject(id: string): Promise<boolean>;
  /** Permanent deletion: the record, media (shared bytes are released by count), thumbnails, cover, snapshots, backups, journal and the containers themselves. */
  deleteProject(id: string): Promise<void>;

  /** Stores an asset's bytes. Identical bytes are stored once per device and counted per reference. */
  writeMedia(projectId: string, assetId: string, bytes: Uint8Array, options?: { contentHash?: string; extension?: string }): Promise<MediaEntry & { shared: boolean }>;
  readMedia(projectId: string, assetId: string): Promise<Uint8Array>;
  hasMedia(projectId: string, assetId: string): Promise<boolean>;
  removeMedia(projectId: string, assetId: string): Promise<void>;
  listMedia(projectId: string): Promise<MediaEntry[]>;
  /** `writeMedia` from pieces: the bytes are hashed while they are written and are never held in memory. */
  writeMediaStream(projectId: string, assetId: string, source: ByteSource, options?: { contentHash?: string; extension?: string }): Promise<MediaEntry & { shared: boolean }>;
  /** The bytes `[start, end)` of an asset, in pieces. */
  readMediaStream(projectId: string, assetId: string, range?: { start?: number; end?: number }): AsyncIterable<Uint8Array>;
  mediaInfo(projectId: string, assetId: string): Promise<MediaEntry | undefined>;
  /** Every media file of every project, including files no index row names (an interrupted import). */
  listMediaFiles(): Promise<MediaFile[]>;
  /** Removes a media file that has no index row. */
  discardMediaFile(projectId: string, assetId: string): Promise<void>;
  /** The files of a project's own container (`media/…`, `thumbnails/…`, the cover), with paths relative to it. */
  listProjectFiles(projectId: string): Promise<FileEntry[]>;
  /** How many asset references share these bytes on this device. */
  mediaReferences(contentHash: string): Promise<number>;

  putSnapshot(projectId: string, snapshot: Snapshot): Promise<void>;
  listSnapshots(projectId: string): Promise<SnapshotInfo[]>;
  readSnapshot(projectId: string, snapshotId: string): Promise<Snapshot>;
  deleteSnapshot(projectId: string, snapshotId: string): Promise<void>;

  putBackup(projectId: string, backup: Omit<Backup, "name" | "bytes">): Promise<BackupInfo>;
  listBackups(projectId: string): Promise<BackupInfo[]>;
  readBackup(projectId: string, name: string): Promise<Backup>;
  deleteBackup(projectId: string, name: string): Promise<void>;

  appendJournal(projectId: string, entry: JournalEntry): Promise<void>;
  readJournal(projectId: string): Promise<JournalEntry[]>;
  /** Drops the entries the server acknowledged (`revision` at or below the given one). */
  truncateJournal(projectId: string, acknowledgedRevision: number): Promise<void>;
  clearJournal(projectId: string): Promise<void>;

  putBlob(kind: BlobKind, projectId: string, name: string, bytes: Uint8Array): Promise<void>;
  getBlob(kind: BlobKind, projectId: string, name: string): Promise<Uint8Array | undefined>;
  deleteBlob(kind: BlobKind, projectId: string, name: string): Promise<void>;

  /** Library-wide records that belong to no single project. */
  readLibrary<T>(name: LibraryFile): Promise<T | undefined>;
  writeLibrary(name: LibraryFile, value: unknown): Promise<void>;
  /** Library-wide files (`luts/<lutId>.cube`, template assets `templates/<templateId>/…`). */
  writeLibraryFile(name: string, bytes: Uint8Array): Promise<void>;
  readLibraryFile(name: string): Promise<Uint8Array | undefined>;
  deleteLibraryFile(name: string): Promise<void>;
  listLibraryFiles(prefix: string): Promise<FileEntry[]>;
  putDocument(kind: DocumentKind, id: string, value: unknown): Promise<void>;
  getDocument<T>(kind: DocumentKind, id: string): Promise<T | undefined>;
  /** Like `getDocument`, without counting as an opening of a cached workflow. */
  peekDocument<T>(kind: DocumentKind, id: string): Promise<T | undefined>;
  listDocuments(kind: DocumentKind): Promise<string[]>;
  deleteDocument(kind: DocumentKind, id: string): Promise<void>;

  getSession<T>(key: string): Promise<T | undefined>;
  putSession(key: string, value: unknown): Promise<void>;
  deleteSession(key: string): Promise<void>;

  /** The one cache store of the device: derived data, separate from project data, with one budget. */
  readonly cache: CacheStore;

  /** Free bytes for new data, or `null` when the platform gives no estimate. */
  available(): Promise<number | null>;
  /** Rebuilds every derived index from the durable records and files. */
  rebuildIndexes(): Promise<void>;
}

/** Workflow documents are a read-only cache of the 50 most recently opened, per device. */
export const WORKFLOW_CACHE_LIMIT = 50;
const mediaPath = (projectId: string, assetId: string, extension: string) => `projects/${projectId}/media/${assetId}${extension ? `.${extension}` : ""}`;
const blobPath = (kind: BlobKind, projectId: string, name: string) => (kind === "cover" ? `projects/${projectId}/${name}` : `projects/${projectId}/thumbnails/${name}`);
const DOCUMENT_STORE: Record<DocumentKind, string> = { script: "scripts", workflow: "workflow-cache", template: "templates" };
const PROJECT_INDEXES = ["index:projects", "index:media", "index:hashes"] as const;
const libraryPath = (name: string) => { if (name.split("/").some((part) => part === "" || part === "." || part === "..")) throw new StorageError("Unavailable", `"${name}" is not a library file name`); return `library/${name}`; };
type HashEntry = { holder: string; refs: string[] };
type MediaIndex = { contentHash: string; size: number; extension: string };
const parse = (text: string, id: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new StorageError("Corrupt", `project record "${id}" cannot be read: ${(error as Error).message}`);
  }
};

function listEntry(id: string, text: string): ProjectListEntry {
  const blank: ProjectListEntry = { id, name: "", duration: 0, updated_ms: 0, folderId: null, trash: null, coverHash: null, schemaVersion: null, minReaderSchemaVersion: null, unreadable: true };
  let record: Record<string, unknown>;
  try { record = parse(text, id); } catch { return blank; }
  const metadata = record.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== "object") return blank;
  const local = (record.local ?? {}) as Record<string, unknown>, cover = record.cover as { image?: { sha256?: string } } | null | undefined;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const updated = number(metadata.updated_ms) ?? (typeof metadata.updatedAt === "string" ? Date.parse(metadata.updatedAt) : 0);
  return {
    id, name: typeof metadata.name === "string" ? metadata.name : "", duration: number(metadata.duration) ?? 0, updated_ms: Number.isFinite(updated) ? updated : 0,
    folderId: typeof local.folderId === "string" ? local.folderId : null, trash: local.trash ?? null, coverHash: cover?.image?.sha256 ?? null,
    schemaVersion: number(record.schemaVersion) ?? number(record.version), minReaderSchemaVersion: number(record.minReaderSchemaVersion), unreadable: false,
  };
}

/**
 * The storage port, implemented once over a platform's record store and file store. Every index it keeps is derived:
 * `rebuildIndexes` recreates it from the project records and the media files.
 */
export function createStoragePort(platform: StoragePort["platform"], records: RecordStore, files: FileStore, options: { now?: () => number; hasher?: HasherFactory; onRebuild?: () => Promise<void> } = {}): StoragePort {
  const now = options.now ?? Date.now, newHasher = options.hasher ?? createSha256;
  const cache = createCacheStore(platform, records, files, now);
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  const mediaKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`;
  const mediaIndex = async (projectId: string, assetId: string) => (await records.get("index:media", mediaKey(projectId, assetId))) as MediaIndex | undefined;
  const hashEntry = async (hash: string) => (await records.get("index:hashes", hash)) as HashEntry | undefined;
  const holderPath = async (entry: HashEntry) => {
    const [projectId, assetId] = entry.holder.split("/");
    const index = await mediaIndex(projectId, assetId);
    return mediaPath(projectId, assetId, index?.extension ?? "");
  };

  async function releaseMedia(projectId: string, assetId: string): Promise<void> {
    const key = mediaKey(projectId, assetId);
    const index = await mediaIndex(projectId, assetId);
    if (!index) return;
    const entry = await hashEntry(index.contentHash);
    await records.delete("index:media", key);
    if (!entry) return;
    const refs = entry.refs.filter((ref) => ref !== key);
    if (refs.length === 0) {
      // The last reference: the bytes go.
      await files.remove(mediaPath(projectId, assetId, index.extension)).catch(() => undefined);
      await records.delete("index:hashes", index.contentHash);
    } else if (entry.holder === key) {
      // Another project still uses the bytes: they move to it, so that its directory stays self-sufficient.
      const [nextProject, nextAsset] = refs[0].split("/");
      const next = await mediaIndex(nextProject, nextAsset);
      await files.move(mediaPath(projectId, assetId, index.extension), mediaPath(nextProject, nextAsset, next?.extension ?? index.extension));
      await records.put("index:hashes", index.contentHash, { holder: refs[0], refs });
    } else await records.put("index:hashes", index.contentHash, { holder: entry.holder, refs });
  }

  const port: StoragePort = {
    platform, cache,
    listProjects: () => guard(async () => {
      const ids = await records.keys("projects");
      const entries = await Promise.all(ids.map(async (id) => {
        const cached = (await records.get("index:projects", id)) as ProjectListEntry | undefined;
        if (cached) return cached;
        const entry = listEntry(id, String((await records.get("projects", id)) ?? ""));
        await records.put("index:projects", id, entry);
        return entry;
      }));
      return entries.sort((a, b) => b.updated_ms - a.updated_ms || (a.id < b.id ? -1 : 1));
    }),
    readProjectText: (id) => guard(async () => {
      const text = await records.get("projects", id);
      if (typeof text !== "string") throw new StorageError("NotFound", `project "${id}" does not exist`);
      return text;
    }),
    readProject: async (id) => parse(await port.readProjectText(id), id),
    writeProjectText: (id, text) => guard(async () => {
      await records.put("projects", id, text);
      await records.put("index:projects", id, listEntry(id, text));
    }),
    hasProject: (id) => guard(async () => (await records.get("projects", id)) !== undefined),
    deleteProject: (id) => guard(async () => {
      for (const key of await records.keys("index:media", `${id}/`)) await releaseMedia(id, key.slice(id.length + 1));
      for (const store of ["snapshots", "backups"]) for (const key of await records.keys(store, `${id}/`)) await records.delete(store, key);
      await records.delete("journal", id);
      for (const key of await records.keys("index:grants", `${id}/`)) await records.delete("index:grants", key);
      await records.delete("session", `lock-${id}`);
      await cache.releaseProject(id);
      await records.delete("projects", id);
      await records.delete("index:projects", id);
      // The container itself goes, not only what was in it.
      await files.removeTree(`projects/${id}`);
    }),

    writeMedia: (projectId, assetId, bytes, mediaOptions = {}) => guard(async () => {
      const contentHash = mediaOptions.contentHash ?? toHex(sha256(bytes));
      const extension = (mediaOptions.extension ?? "").replace(/^\./, "").toLowerCase();
      const key = mediaKey(projectId, assetId);
      await releaseMedia(projectId, assetId);
      const existing = await hashEntry(contentHash);
      if (existing) {
        await records.put("index:hashes", contentHash, { holder: existing.holder, refs: [...existing.refs.filter((ref) => ref !== key), key] });
      } else {
        await files.write(mediaPath(projectId, assetId, extension), bytes);
        await records.put("index:hashes", contentHash, { holder: key, refs: [key] });
      }
      const entry = { contentHash, size: bytes.length, extension };
      await records.put("index:media", key, entry);
      return { assetId, ...entry, shared: existing !== undefined };
    }),
    writeMediaStream: (projectId, assetId, source, mediaOptions = {}) => guard(async () => {
      const extension = (mediaOptions.extension ?? "").replace(/^\./, "").toLowerCase(), key = mediaKey(projectId, assetId);
      await releaseMedia(projectId, assetId);
      const share = async (contentHash: string, existing: HashEntry) => {
        const [holderProject, holderAsset] = existing.holder.split("/");
        const holder = (await mediaIndex(holderProject, holderAsset))!;
        await records.put("index:hashes", contentHash, { holder: existing.holder, refs: [...existing.refs.filter((ref) => ref !== key), key] });
        const entry = { contentHash, size: holder.size, extension: extension || holder.extension };
        await records.put("index:media", key, entry);
        return { assetId, ...entry, shared: true };
      };
      // Bytes this device already holds are not written a second time.
      const known = mediaOptions.contentHash ? await hashEntry(mediaOptions.contentHash) : undefined;
      if (known) return share(mediaOptions.contentHash!, known);
      const hasher = newHasher(), path = mediaPath(projectId, assetId, extension);
      const size = await files.writeStream(path, (async function* () { for await (const chunk of source) { hasher.update(chunk); yield chunk; } })());
      const contentHash = hasher.digestHex();
      if (mediaOptions.contentHash && mediaOptions.contentHash !== contentHash) { await files.remove(path); throw new StorageError("Corrupt", `the bytes of "${assetId}" do not match their content hash`); }
      const existing = await hashEntry(contentHash);
      if (existing) { await files.remove(path); return share(contentHash, existing); }
      await records.put("index:hashes", contentHash, { holder: key, refs: [key] });
      const entry = { contentHash, size, extension };
      await records.put("index:media", key, entry);
      return { assetId, ...entry, shared: false };
    }),
    readMediaStream: async function* (projectId, assetId, range) {
      const index = await mediaIndex(projectId, assetId), entry = index && await hashEntry(index.contentHash);
      if (!index || !entry) throw new StorageError("NotFound", `media "${projectId}/${assetId}" does not exist`);
      yield* files.readStream(await holderPath(entry), range);
    },
    mediaInfo: (projectId, assetId) => guard(async () => { const index = await mediaIndex(projectId, assetId); return index ? { assetId, ...index } : undefined; }),
    listMediaFiles: () => guard(async () => {
      const out: MediaFile[] = [], seen = new Set<string>();
      for (const projectId of new Set([...(await records.keys("projects")), ...(await records.keys("index:media")).map((key) => key.slice(0, key.indexOf("/")))])) {
        for (const file of await files.list(`projects/${projectId}/media`)) {
          const name = file.path.slice(file.path.lastIndexOf("/") + 1), dot = name.lastIndexOf("."), assetId = dot > 0 ? name.slice(0, dot) : name;
          seen.add(mediaKey(projectId, assetId));
          out.push({ projectId, assetId, size: file.size, modified_ms: file.modified_ms, indexed: (await mediaIndex(projectId, assetId)) !== undefined });
        }
      }
      // A reference to bytes held by another project has an index row and no file of its own.
      for (const key of await records.keys("index:media")) {
        if (seen.has(key)) continue;
        const [projectId, assetId] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)], index = (await mediaIndex(projectId, assetId))!;
        const holder = await hashEntry(index.contentHash), stat = holder ? await files.stat(await holderPath(holder)) : undefined;
        out.push({ projectId, assetId, size: index.size, modified_ms: stat?.modified_ms ?? 0, indexed: true });
      }
      return out;
    }),
    discardMediaFile: (projectId, assetId) => guard(async () => {
      if (await mediaIndex(projectId, assetId)) { await releaseMedia(projectId, assetId); return; }
      for (const file of await files.list(`projects/${projectId}/media`)) {
        const name = file.path.slice(file.path.lastIndexOf("/") + 1), dot = name.lastIndexOf(".");
        if ((dot > 0 ? name.slice(0, dot) : name) === assetId) await files.remove(file.path);
      }
    }),
    listProjectFiles: (projectId) => guard(async () => (await files.list(`projects/${projectId}`)).map((entry) => ({ ...entry, path: entry.path.slice(`projects/${projectId}/`.length) })).filter((entry) => !/^(project|journal)\.json$|^(snapshots|backups)\//.test(entry.path))),
    readMedia: (projectId, assetId) => guard(async () => {
      const index = await mediaIndex(projectId, assetId);
      const entry = index && await hashEntry(index.contentHash);
      if (!index || !entry) throw new StorageError("NotFound", `media "${projectId}/${assetId}" does not exist`);
      return files.read(await holderPath(entry));
    }),
    hasMedia: (projectId, assetId) => guard(async () => (await mediaIndex(projectId, assetId)) !== undefined),
    removeMedia: (projectId, assetId) => guard(() => releaseMedia(projectId, assetId)),
    listMedia: (projectId) => guard(async () => {
      const keys = await records.keys("index:media", `${projectId}/`);
      return Promise.all(keys.sort().map(async (key) => ({ assetId: key.slice(projectId.length + 1), ...((await records.get("index:media", key)) as MediaIndex) })));
    }),
    mediaReferences: (contentHash) => guard(async () => (await hashEntry(contentHash))?.refs.length ?? 0),

    putSnapshot: (projectId, snapshot) => guard(() => records.put("snapshots", `${projectId}/${snapshot.id}`, snapshot)),
    listSnapshots: (projectId) => guard(async () => {
      const keys = await records.keys("snapshots", `${projectId}/`);
      const all = await Promise.all(keys.map(async (key) => { const { record: _record, ...info } = (await records.get("snapshots", key)) as Snapshot; return info; }));
      return all.sort((a, b) => b.created_ms - a.created_ms || (a.id < b.id ? 1 : -1));
    }),
    readSnapshot: (projectId, snapshotId) => guard(async () => {
      const snapshot = (await records.get("snapshots", `${projectId}/${snapshotId}`)) as Snapshot | undefined;
      if (!snapshot) throw new StorageError("NotFound", `snapshot "${snapshotId}" does not exist`);
      return snapshot;
    }),
    deleteSnapshot: (projectId, snapshotId) => guard(() => records.delete("snapshots", `${projectId}/${snapshotId}`)),

    putBackup: (projectId, backup) => guard(async () => {
      const name = `${backup.sourceVersion}-${backup.time_ms}`;
      const stored: Backup = { ...backup, name, bytes: backup.record.length };
      await records.put("backups", `${projectId}/${name}`, stored);
      return { name, sourceVersion: backup.sourceVersion, time_ms: backup.time_ms, bytes: stored.bytes };
    }),
    listBackups: (projectId) => guard(async () => {
      const keys = await records.keys("backups", `${projectId}/`);
      const all = await Promise.all(keys.map(async (key) => { const { name, sourceVersion, time_ms, bytes } = (await records.get("backups", key)) as Backup; return { name, sourceVersion, time_ms, bytes }; }));
      return all.sort((a, b) => b.time_ms - a.time_ms);
    }),
    readBackup: (projectId, name) => guard(async () => {
      const backup = (await records.get("backups", `${projectId}/${name}`)) as Backup | undefined;
      if (!backup) throw new StorageError("NotFound", `backup "${name}" does not exist`);
      return backup;
    }),
    deleteBackup: (projectId, name) => guard(() => records.delete("backups", `${projectId}/${name}`)),

    appendJournal: (projectId, entry) => guard(async () => records.put("journal", projectId, [...(((await records.get("journal", projectId)) as JournalEntry[] | undefined) ?? []), entry])),
    readJournal: (projectId) => guard(async () => ((await records.get("journal", projectId)) as JournalEntry[] | undefined) ?? []),
    truncateJournal: (projectId, acknowledgedRevision) => guard(async () => {
      const left = (((await records.get("journal", projectId)) as JournalEntry[] | undefined) ?? []).filter((entry) => entry.revision > acknowledgedRevision);
      if (left.length) await records.put("journal", projectId, left); else await records.delete("journal", projectId);
    }),
    clearJournal: (projectId) => guard(() => records.delete("journal", projectId)),

    putBlob: (kind, projectId, name, bytes) => guard(() => files.write(blobPath(kind, projectId, name), bytes)),
    getBlob: (kind, projectId, name) => guard(async () => { try { return await files.read(blobPath(kind, projectId, name)); } catch (error) { if (toStorageError(error).kind === "NotFound") return undefined; throw error; } }),
    deleteBlob: (kind, projectId, name) => guard(() => files.remove(blobPath(kind, projectId, name))),

    readLibrary: <T>(name: LibraryFile) => guard(async () => (await records.get("library", name)) as T | undefined),
    writeLibrary: (name, value) => guard(() => records.put("library", name, value)),
    writeLibraryFile: (name, bytes) => guard(() => files.write(libraryPath(name), bytes)),
    readLibraryFile: (name) => guard(async () => { try { return await files.read(libraryPath(name)); } catch (error) { if (toStorageError(error).kind === "NotFound") return undefined; throw error; } }),
    deleteLibraryFile: (name) => guard(() => files.remove(libraryPath(name))),
    listLibraryFiles: (prefix) => guard(async () => (await files.list(libraryPath(prefix).replace(/\/$/, ""))).map((entry) => ({ ...entry, path: entry.path.slice("library/".length) }))),
    putDocument: (kind, id, value) => guard(async () => {
      if (kind !== "workflow") { await records.put(DOCUMENT_STORE[kind], id, value); return; }
      await records.put("workflow-cache", id, { opened_ms: now(), value });
      // Least recently opened first out.
      const keys = await records.keys("workflow-cache");
      if (keys.length <= WORKFLOW_CACHE_LIMIT) return;
      const opened = await Promise.all(keys.map(async (key) => ({ key, opened_ms: ((await records.get("workflow-cache", key)) as { opened_ms: number }).opened_ms })));
      opened.sort((a, b) => a.opened_ms - b.opened_ms || (a.key < b.key ? -1 : 1));
      for (const { key } of opened.slice(0, keys.length - WORKFLOW_CACHE_LIMIT)) await records.delete("workflow-cache", key);
    }),
    getDocument: <T>(kind: DocumentKind, id: string) => guard(async () => {
      const stored = await records.get(DOCUMENT_STORE[kind], id);
      if (kind !== "workflow" || stored === undefined) return stored as T | undefined;
      // Opening a cached workflow makes it the most recently opened.
      await records.put("workflow-cache", id, { opened_ms: now(), value: (stored as { value: unknown }).value });
      return (stored as { value: T }).value;
    }),
    peekDocument: <T>(kind: DocumentKind, id: string) => guard(async () => { const stored = await records.get(DOCUMENT_STORE[kind], id); return (kind === "workflow" && stored !== undefined ? (stored as { value: T }).value : stored) as T | undefined; }),
    listDocuments: (kind) => guard(async () => (await records.keys(DOCUMENT_STORE[kind])).sort()),
    deleteDocument: (kind, id) => guard(async () => {
      await records.delete(DOCUMENT_STORE[kind], id);
      if (kind === "script") await records.delete("journal", `script.${id}`);
      if (kind === "template") await files.removeTree(`library/templates/${id}`);
    }),

    getSession: <T>(key: string) => guard(async () => (await records.get("session", key)) as T | undefined),
    putSession: (key, value) => guard(() => records.put("session", key, value)),
    deleteSession: (key) => guard(() => records.delete("session", key)),

    available: () => guard(() => files.available()),
    rebuildIndexes: () => guard(async () => {
      for (const store of PROJECT_INDEXES) for (const key of await records.keys(store)) await records.delete(store, key);
      const hashes = new Map<string, HashEntry>();
      const wanted: { key: string; hash: string }[] = [];
      for (const id of await records.keys("projects")) {
        const text = String((await records.get("projects", id)) ?? "");
        await records.put("index:projects", id, listEntry(id, text));
        let assets: { id?: unknown; contentHash?: unknown }[] = [];
        try { assets = ((parse(text, id).media as { assets?: unknown[] } | undefined)?.assets ?? []) as typeof assets; } catch { /* an unreadable record still keeps its files */ }
        const known = new Map(assets.filter((asset) => typeof asset.id === "string").map((asset) => [asset.id as string, typeof asset.contentHash === "string" ? asset.contentHash : undefined]));
        const present = new Set<string>();
        for (const file of await files.list(`projects/${id}/media`)) {
          const name = file.path.slice(file.path.lastIndexOf("/") + 1), dot = name.lastIndexOf(".");
          const assetId = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot + 1) : "";
          // The record's hash is used when it has one; otherwise the bytes are hashed once.
          const contentHash = known.get(assetId) ?? toHex(sha256(await files.read(file.path)));
          const key = mediaKey(id, assetId);
          present.add(assetId);
          await records.put("index:media", key, { contentHash, size: file.size, extension });
          const entry = hashes.get(contentHash);
          if (entry) entry.refs.push(key); else hashes.set(contentHash, { holder: key, refs: [key] });
        }
        // An asset whose bytes live in another project's directory is a reference to them.
        for (const [assetId, hash] of known) if (hash && !present.has(assetId)) wanted.push({ key: mediaKey(id, assetId), hash });
      }
      for (const { key, hash } of wanted) {
        const entry = hashes.get(hash);
        if (!entry) continue;
        const [holderProject, holderAsset] = entry.holder.split("/");
        const holder = (await records.get("index:media", mediaKey(holderProject, holderAsset))) as MediaIndex;
        entry.refs.push(key);
        await records.put("index:media", key, { contentHash: hash, size: holder.size, extension: holder.extension });
      }
      for (const [hash, entry] of hashes) await records.put("index:hashes", hash, entry);
      await cache.rebuild();
      await options.onRebuild?.();
    }),
  };
  return port;
}
