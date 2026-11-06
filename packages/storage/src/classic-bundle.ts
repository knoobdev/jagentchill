import { validateProjectDocument, type ClassicMediaRecord, type Registries } from "@jagentchill/editor-core";
import { withLocalSection } from "./autosave.ts";
import { isStorageError } from "./errors.ts";
import type { ByteSource } from "./hash.ts";
import { fromBase64 } from "./mobile.ts";
import { migrateRecord, MIGRATION_CHAIN, type MigrationStep } from "./migrate.ts";
import { checkFormatHeader, gather, PackageError, type CancelSignal } from "./package.ts";
import type { StoragePort } from "./port.ts";
import { importClassicPreferences, type Preferences } from "./preferences.ts";
import { capacityMessage, evaluateStorageCapacity } from "./quota.ts";
import { detectVersion, type SavedSound } from "./records.ts";
import { storageString, type StorageLocale } from "./strings.ts";
import { decodeUtf8, isSafeEntryName, readZipDirectory, readZipEntry, type ZipSource } from "./zip.ts";

export const CLASSIC_BUNDLE_FORMAT = { format: "opencut-classic-bundle", formatVersion: 1, manifestName: "classic-manifest.json" } as const;
/** The localStorage keys a classic bundle carries; anything else in `local-storage.json` is ignored. */
export const CLASSIC_LOCAL_STORAGE_KEYS = ["opencut-keybindings", "timeline-store", "preview-settings", "panel-sizes", "assets-panel", "projects-view-mode", "stickers-settings", "graph-editor-presets", "theme"] as const;

/**
 * OpenCut classic data, wherever it comes from: a classic data bundle, or the classic stores of this very origin
 * (the in-place path of the web build). It is only ever read.
 */
export interface ClassicSource {
  /** Records of the classic `video-editor-projects` store, as classic stored them. */
  projects(): Promise<Record<string, unknown>[]>;
  /** Tracks of a legacy `video-editor-timelines-<projectId>[-<sceneId>]` store, or `undefined` when there is none. */
  legacyTimeline(projectId: string, sceneId?: string): Promise<unknown[] | undefined>;
  /** Records of the classic `media-metadata` store of a project. */
  mediaRecords(projectId: string): Promise<ClassicMediaRecord[]>;
  /** The bytes of one media file, or `null` when the source does not hold it. */
  mediaFile(projectId: string, assetId: string): Promise<{ size: number; data: ByteSource } | null>;
  /** The classic `user-sounds` record. */
  savedSounds(): Promise<{ sounds?: unknown[]; lastModified?: unknown } | null>;
  localStorage(): Promise<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const classicIdOf = (record: Record<string, unknown>): string | null => (typeof record.id === "string" && record.id ? record.id : isRecord(record.metadata) && typeof record.metadata.id === "string" && record.metadata.id ? record.metadata.id : null);

/**
 * Opens a classic data bundle: a ZIP with `classic-manifest.json`, `projects.json`, `timelines/<store suffix>.json`,
 * `media/<projectId>/metadata.json`, `media/<projectId>/<assetId>`, `saved-sounds.json` and `local-storage.json`.
 */
export async function openClassicBundle(source: ZipSource, locale?: StorageLocale): Promise<ClassicSource & { mediaBytes: number }> {
  const refuse = (cause: string) => new PackageError("invalid", storageString("invalidProjectFile", {}, locale), { cause });
  let entries: Awaited<ReturnType<typeof readZipDirectory>>;
  try { entries = await readZipDirectory(source); } catch (error) { throw refuse(error instanceof Error ? error.message : String(error)); }
  for (const entry of entries) if (!isSafeEntryName(entry.name) || entry.isSymlink) throw refuse(`the archive has an unsafe entry "${entry.name}"`);
  const files = new Map(entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name, entry]));
  const json = async <T>(name: string): Promise<T | undefined> => {
    const entry = files.get(name);
    if (!entry) return undefined;
    try { return JSON.parse(decodeUtf8(await gather(readZipEntry(source, entry), 256 * 1024 * 1024))) as T; } catch (error) { throw refuse(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const manifest = await json<unknown>(CLASSIC_BUNDLE_FORMAT.manifestName);
  if (manifest === undefined) throw refuse("the archive has no classic-manifest.json");
  checkFormatHeader(manifest, CLASSIC_BUNDLE_FORMAT, locale);
  return {
    mediaBytes: [...files.values()].filter((entry) => /^media\/[^/]+\/[^/]+$/.test(entry.name) && !entry.name.endsWith("/metadata.json")).reduce((sum, entry) => sum + entry.size, 0),
    projects: async () => { const projects = await json<unknown>("projects.json"); return Array.isArray(projects) ? projects.filter(isRecord) : []; },
    legacyTimeline: async (projectId, sceneId) => { const record = await json<{ tracks?: unknown }>(`timelines/${sceneId ? `${projectId}-${sceneId}` : projectId}.json`); return Array.isArray(record?.tracks) ? record.tracks : undefined; },
    mediaRecords: async (projectId) => { const records = await json<unknown>(`media/${projectId}/metadata.json`); return Array.isArray(records) ? (records.filter((record) => isRecord(record) && typeof record.id === "string") as ClassicMediaRecord[]) : []; },
    mediaFile: async (projectId, assetId) => { const entry = files.get(`media/${projectId}/${assetId}`); return entry ? { size: entry.size, data: readZipEntry(source, entry) } : null; },
    savedSounds: async () => (await json<{ sounds?: unknown[]; lastModified?: unknown }>("saved-sounds.json")) ?? null,
    localStorage: async () => { const entries = await json<unknown>("local-storage.json"); return isRecord(entries) ? Object.fromEntries(Object.entries(entries).filter(([, value]) => typeof value === "string")) as Record<string, string> : {}; },
  };
}

/** The parts of the browser the in-place path reads. */
export type ClassicOrigin = {
  indexedDB: IDBFactory;
  storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
  localStorage?: { getItem(key: string): string | null };
};
const CLASSIC_PROJECTS_DB = "video-editor-projects";
/** Opens an existing database for reading. A database that does not exist is NOT created: the upgrade is aborted. */
function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = factory.open(name);
    let created = false;
    request.onupgradeneeded = () => { created = true; request.transaction?.abort(); };
    request.onsuccess = () => { if (created) { request.result.close(); resolve(null); } else resolve(request.result); };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
async function readAll(factory: IDBFactory, database: string, store: string): Promise<unknown[]> {
  const db = await openExisting(factory, database);
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains(store)) return [];
    return await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction(store, "readonly").objectStore(store).getAll(); request.onsuccess = () => resolve(request.result ?? []); request.onerror = () => reject(request.error); });
  } finally { db.close(); }
}
/** Whether this origin holds OpenCut classic data ("OpenCut projects found — Import"). Nothing is created by asking. */
export async function classicDataPresent(origin: Pick<ClassicOrigin, "indexedDB">): Promise<boolean> {
  const listed = await origin.indexedDB.databases?.().catch(() => undefined);
  if (listed) return listed.some((database) => database.name === CLASSIC_PROJECTS_DB);
  const db = await openExisting(origin.indexedDB, CLASSIC_PROJECTS_DB);
  db?.close();
  return db !== null;
}
/**
 * The classic stores of this origin as a classic source: `video-editor-projects`, the legacy
 * `video-editor-timelines-*` stores, `video-editor-media-<projectId>` with the `media-files-<projectId>` directory
 * of the private file system, and `video-editor-saved-sounds`. Every store is opened read-only and none is created.
 */
export function classicOriginSource(origin: ClassicOrigin): ClassicSource {
  return {
    projects: async () => (await readAll(origin.indexedDB, CLASSIC_PROJECTS_DB, "projects")).filter(isRecord),
    legacyTimeline: async (projectId, sceneId) => {
      const [record] = (await readAll(origin.indexedDB, `video-editor-timelines-${sceneId ? `${projectId}-${sceneId}` : projectId}`, "timeline")).filter(isRecord);
      return Array.isArray(record?.tracks) ? record.tracks : undefined;
    },
    mediaRecords: async (projectId) => (await readAll(origin.indexedDB, `video-editor-media-${projectId}`, "media-metadata")).filter((record) => isRecord(record) && typeof record.id === "string") as ClassicMediaRecord[],
    mediaFile: async (projectId, assetId) => {
      try {
        const root = await origin.storage?.getDirectory?.();
        if (!root) return null;
        const file = await (await (await root.getDirectoryHandle(`media-files-${projectId}`)).getFileHandle(assetId)).getFile();
        return { size: file.size, data: (async function* () { for (let offset = 0; offset < file.size; offset += 1024 * 1024) yield new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 1024 * 1024)).arrayBuffer()); })() };
      } catch { return null; }
    },
    savedSounds: async () => { const [record] = (await readAll(origin.indexedDB, "video-editor-saved-sounds", "saved-sounds")).filter(isRecord); return record ?? null; },
    localStorage: async () => Object.fromEntries(CLASSIC_LOCAL_STORAGE_KEYS.map((key) => [key, origin.localStorage?.getItem(key)]).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  };
}

export type ClassicIngestOptions = {
  now: () => number; newId: () => string;
  registries?: Registries; signal?: CancelSignal; locale?: StorageLocale;
  steps?: MigrationStep[];
  stickerProviderOf?: (id: string) => string | null;
  /** The preference store that receives the classic UI preferences. */
  preferences?: Preferences;
  /** The owners of the two keys this capability hands on unread. */
  keybindings?: (raw: string) => void;
  easingPresets?: (raw: string) => void;
  /** The total size of the source's media, when it is known up front (a bundle). */
  mediaBytes?: number;
  onProgress?: (progress: { index: number; total: number; name: string }) => void;
};
export type ClassicIngestSummary = {
  imported: { classicId: string; projectId: string; name: string; fromVersion: number; assets: number; offlineAssets: string[] }[];
  /** A project whose chain failed is skipped with the failing step recorded; the others are still ingested. */
  skipped: { classicId: string; name: string; fromVersion: number; step: string; error: string }[];
  savedSoundsAdded: number;
  preferenceKeys: string[];
  ignoredKeys: string[];
};
const UNOPENED = "imported-unopened";
/** A project ingested from classic is listed with the label "Imported" until it is first opened. */
export const isImportedUnopened = async (port: StoragePort, projectId: string): Promise<boolean> => ((await port.getSession<string[]>(UNOPENED)) ?? []).includes(projectId);
export async function markImportedOpened(port: StoragePort, projectId: string): Promise<void> {
  const all = (await port.getSession<string[]>(UNOPENED)) ?? [];
  if (all.includes(projectId)) await port.putSession(UNOPENED, all.filter((id) => id !== projectId));
}
const extensionOf = (name: unknown): string => { const text = typeof name === "string" ? name : "", dot = text.lastIndexOf("."); return dot > 0 && dot < text.length - 1 ? text.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : ""; };
const classicName = (record: Record<string, unknown>): string => (isRecord(record.metadata) && typeof record.metadata.name === "string" ? record.metadata.name : typeof record.name === "string" ? record.name : "");

/**
 * Ingests OpenCut classic data without ever writing to classic stores. Each project is fed to the migration chain
 * up to the current schema under a new project id (its classic id is kept in `metadata.importedFrom`); its media
 * files are written as managed assets; saved sounds are merged; the localStorage keys go to their owners.
 * Ingestion is transactional per project: a failure or a cancellation removes that project's partial record and media.
 */
export async function ingestClassic(port: StoragePort, source: ClassicSource, options: ClassicIngestOptions): Promise<ClassicIngestSummary> {
  const summary: ClassicIngestSummary = { imported: [], skipped: [], savedSoundsAdded: 0, preferenceKeys: [], ignoredKeys: [] };
  const records = (await source.projects()).filter((record) => classicIdOf(record) !== null);
  // The quota is evaluated for the total media size before anything is written.
  let mediaBytes = options.mediaBytes;
  if (mediaBytes === undefined) {
    mediaBytes = 0;
    for (const record of records) for (const media of await source.mediaRecords(classicIdOf(record)!)) mediaBytes += typeof media.size === "number" ? media.size : 0;
  }
  const space = await evaluateStorageCapacity(port, mediaBytes, { kind: "media", evictCache: (needed) => port.cache.evict(needed) });
  if (!space.allowed) throw new PackageError("no-space", capacityMessage("OpenCut", space).text, { required: space.required, available: space.available });

  for (const [index, record] of records.entries()) {
    const classicId = classicIdOf(record)!, name = classicName(record), fromVersion = detectVersion(record);
    options.onProgress?.({ index: index + 1, total: records.length, name });
    if (options.signal?.aborted) break;
    let step = "read", projectId: string | null = null;
    try {
      const mediaRecords = await source.mediaRecords(classicId);
      const legacyTracksBySceneId: Record<string, unknown[]> = {};
      for (const scene of Array.isArray(record.scenes) ? record.scenes.filter(isRecord) : []) {
        if (typeof scene.id !== "string") continue;
        const tracks = (await source.legacyTimeline(classicId, scene.id)) ?? (scene.isMain === true ? await source.legacyTimeline(classicId) : undefined);
        if (tracks) legacyTracksBySceneId[scene.id] = tracks;
      }
      const context = { now_ms: options.now(), newId: options.newId, registries: options.registries, mediaRecords, legacyTracksBySceneId, stickerProviderOf: options.stickerProviderOf };
      const migrated = migrateRecord(record, context, options.steps ?? MIGRATION_CHAIN, (current) => { step = current; });
      if (migrated.skipped) { summary.skipped.push({ classicId, name, fromVersion, step, error: "the step did not apply to this record" }); continue; }
      step = "write";
      projectId = options.newId();
      const document = migrated.record as { metadata: Record<string, unknown>; media: { assets: { id: string; contentHash?: string | null; size?: number }[] }; local?: { media?: Record<string, { present?: { original?: boolean } }> } };
      document.metadata = { ...document.metadata, id: projectId, importedFrom: { source: "opencut-classic", id: classicId } };
      const offlineAssets: string[] = [];
      let assets = 0;
      for (const media of mediaRecords) {
        if (options.signal?.aborted) throw new PackageError("cancelled", "the import was cancelled");
        const asset = document.media.assets.find((entry) => entry.id === media.id), local = document.local?.media?.[media.id];
        const file = await source.mediaFile(classicId, media.id);
        // A media entry missing from the source yields an offline asset.
        if (!file || !asset) { if (asset) offlineAssets.push(media.id); continue; }
        const stored = await port.writeMediaStream(projectId, media.id, file.data, { extension: extensionOf(media.name) });
        asset.contentHash = stored.contentHash;
        asset.size = stored.size;
        if (local) local.present = { ...local.present, original: true };
        assets++;
      }
      for (const thumbnail of migrated.thumbnails) {
        const [, mime, data] = /^data:([^;,]+);base64,(.*)$/.exec(thumbnail.dataUrl) ?? [];
        if (data) await port.putBlob("thumbnail", projectId, `${thumbnail.owner === "project" ? "project" : thumbnail.id}.${mime === "image/png" ? "png" : "jpg"}`, fromBase64(data));
      }
      step = "validate";
      const checked = validateProjectDocument(document, { mode: "strict", registries: options.registries });
      if (!checked.ok) throw new Error(checked.errors.slice(0, 3).map((error) => `${error.code} at ${error.path}`).join("; "));
      step = "write";
      const { local, ...canonical } = document as Record<string, unknown>;
      await port.writeProjectText(projectId, withLocalSection(JSON.stringify(canonical), local));
      await port.putSession(UNOPENED, [...new Set([...((await port.getSession<string[]>(UNOPENED)) ?? []), projectId])]);
      summary.imported.push({ classicId, projectId, name, fromVersion, assets, offlineAssets });
    } catch (error) {
      if (projectId) await port.deleteProject(projectId).catch(() => undefined);
      if (error instanceof PackageError && error.code === "cancelled") break;
      summary.skipped.push({ classicId, name, fromVersion, step, error: isStorageError(error) ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : String(error) });
    }
  }

  // Saved sounds are merged into the device's store; an id that is already there is skipped.
  const classicSounds = await source.savedSounds();
  if (Array.isArray(classicSounds?.sounds)) {
    const current = (await port.readLibrary<{ sounds: SavedSound[]; lastModified_ms: number }>("saved-sounds")) ?? { sounds: [], lastModified_ms: 0 };
    const known = new Set(current.sounds.map((sound) => String(sound.id))), added: SavedSound[] = [];
    for (const sound of classicSounds.sounds.filter(isRecord)) {
      const id = String(sound.id);
      if (sound.id === undefined || known.has(id)) continue;
      known.add(id);
      const { savedAt, ...rest } = sound;
      const savedAt_ms = typeof savedAt === "string" ? Date.parse(savedAt) : NaN;
      added.push({ ...rest, id, savedAt_ms: Number.isFinite(savedAt_ms) ? savedAt_ms : options.now() });
    }
    if (added.length > 0) await port.writeLibrary("saved-sounds", { sounds: [...current.sounds, ...added], lastModified_ms: options.now() });
    summary.savedSoundsAdded = added.length;
  }

  // The localStorage keys go to their owners; every other key is ignored.
  const entries = await source.localStorage();
  if (typeof entries["opencut-keybindings"] === "string" && options.keybindings) { options.keybindings(entries["opencut-keybindings"]); summary.preferenceKeys.push("opencut-keybindings"); }
  if (typeof entries["graph-editor-presets"] === "string" && options.easingPresets) { options.easingPresets(entries["graph-editor-presets"]); summary.preferenceKeys.push("graph-editor-presets"); }
  if (options.preferences) summary.preferenceKeys.push(...importClassicPreferences(options.preferences, entries));
  summary.ignoredKeys = Object.keys(entries).filter((key) => !(CLASSIC_LOCAL_STORAGE_KEYS as readonly string[]).includes(key));
  return summary;
}
