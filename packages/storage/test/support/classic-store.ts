/**
 * OpenCut classic's own writers, reproduced from `.refs/opencut-classic/apps/web/src/services/storage/` at commit
 * cf5e79e9, so that fixtures have the shape classic actually stores — the IndexedDB record layout of its
 * `IndexedDBAdapter` (`keyPath: "id"`, `put({ id: key, ...value })`), the date encoding of `StorageService.saveProject`
 * (`Date.toISOString()`), the `version` field, the per-project media database and private-file-system directory.
 * They write into the IndexedDB and OPFS of the given environment, exactly where classic writes.
 */
type Environment = { indexedDB: IDBFactory; storage?: { getDirectory?: () => Promise<any> } };
const request = <T>(run: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { run.onsuccess = () => resolve(run.result); run.onerror = () => reject(run.error); });

/** `IndexedDBAdapter.set({ key, value })`: one database per store name, `keyPath: "id"`, the key spread into the record. */
export async function classicAdapterSet(factory: IDBFactory, dbName: string, storeName: string, key: string, value: Record<string, unknown>): Promise<void> {
  const opening = factory.open(dbName, 1);
  opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains(storeName)) opening.result.createObjectStore(storeName, { keyPath: "id" }); };
  const db = await request(opening);
  await request(db.transaction([storeName], "readwrite").objectStore(storeName).put({ id: key, ...value }));
  db.close();
}
export async function classicAdapterGetAll(factory: IDBFactory, dbName: string, storeName: string): Promise<any[]> {
  const opening = factory.open(dbName, 1);
  opening.onupgradeneeded = () => { opening.result.createObjectStore(storeName, { keyPath: "id" }); };
  const db = await request(opening);
  const all = await request(db.transaction([storeName], "readonly").objectStore(storeName).getAll());
  db.close();
  return all;
}

/** A classic runtime project (`TProject`): dates are `Date` objects, scenes carry `{overlay, main, audio}` tracks. */
export type ClassicRuntimeProject = {
  metadata: { id: string; name: string; thumbnail?: string; duration?: number; createdAt: Date; updatedAt: Date };
  scenes: { id: string; name: string; isMain: boolean; tracks: { overlay: any[]; main: any; audio: any[] }; bookmarks: unknown[]; createdAt: Date; updatedAt: Date }[];
  currentSceneId: string; settings: Record<string, unknown>; version: number; timelineViewState?: Record<string, unknown>;
};
/** `StorageService.saveProject`: the serialisation classic performs at v31 (audio buffers stripped, dates as ISO strings). */
export function classicSerializeProject(project: ClassicRuntimeProject): Record<string, unknown> {
  const duration = project.metadata.duration ?? Math.max(0, ...project.scenes.flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]).flatMap((track) => track.elements.map((element: any) => element.startTime + element.duration)));
  return {
    metadata: { id: project.metadata.id, name: project.metadata.name, thumbnail: project.metadata.thumbnail, duration, createdAt: project.metadata.createdAt.toISOString(), updatedAt: project.metadata.updatedAt.toISOString() },
    scenes: project.scenes.map((scene) => ({
      id: scene.id, name: scene.name, isMain: scene.isMain,
      tracks: { ...scene.tracks, audio: scene.tracks.audio.map((track) => ({ ...track, elements: track.elements.map(({ buffer: _buffer, ...rest }: any) => rest) })) },
      bookmarks: scene.bookmarks, createdAt: scene.createdAt.toISOString(), updatedAt: scene.updatedAt.toISOString(),
    })),
    currentSceneId: project.currentSceneId, settings: project.settings, version: project.version, timelineViewState: project.timelineViewState,
  };
}
export async function classicSaveProject(environment: Environment, project: ClassicRuntimeProject): Promise<Record<string, unknown>> {
  // IndexedDB stores a structured clone: `undefined` members (a project without thumbnail) are kept as absent keys.
  const serialized = JSON.parse(JSON.stringify(classicSerializeProject(project))) as Record<string, unknown>;
  await classicAdapterSet(environment.indexedDB, "video-editor-projects", "projects", project.metadata.id, serialized);
  return { id: project.metadata.id, ...serialized };
}
/** A record of an earlier era, written through the same adapter (the layout of the `projects` store never changed). */
export const classicSaveRawProject = (environment: Environment, id: string, record: Record<string, unknown>): Promise<void> => classicAdapterSet(environment.indexedDB, "video-editor-projects", "projects", id, record);

/** `StorageService.saveMediaAsset`: the file into `media-files-<projectId>/<assetId>`, then the metadata record. */
export async function classicSaveMediaAsset(environment: Environment, projectId: string, asset: { id: string; name: string; type: "image" | "video" | "audio"; bytes: Uint8Array; lastModified: number; width?: number; height?: number; duration?: number; thumbnailUrl?: string; ephemeral?: boolean }): Promise<void> {
  const root = await environment.storage!.getDirectory!();
  const directory = await root.getDirectoryHandle(`media-files-${projectId}`, { create: true });
  const writable = await (await directory.getFileHandle(asset.id, { create: true })).createWritable();
  await writable.write(asset.bytes); await writable.close();
  const metadata = JSON.parse(JSON.stringify({ id: asset.id, name: asset.name, type: asset.type, size: asset.bytes.length, lastModified: asset.lastModified, width: asset.width, height: asset.height, duration: asset.duration, thumbnailUrl: asset.thumbnailUrl, ephemeral: asset.ephemeral }));
  await classicAdapterSet(environment.indexedDB, `video-editor-media-${projectId}`, "media-metadata", asset.id, metadata);
}
/** The v1-era timeline store: `video-editor-timelines-<projectId>[-<sceneId>]`, store `timeline`, key `timeline`. */
export const classicSaveLegacyTimeline = (environment: Environment, projectId: string, sceneId: string | null, tracks: unknown[]): Promise<void> =>
  classicAdapterSet(environment.indexedDB, `video-editor-timelines-${projectId}${sceneId ? `-${sceneId}` : ""}`, "timeline", "timeline", { tracks, lastModified: "2024-01-15T12:00:00.000Z" });
/** `StorageService.saveSavedSounds`: the one record `user-sounds`. */
export const classicSaveSounds = (environment: Environment, sounds: Record<string, unknown>[]): Promise<void> =>
  classicAdapterSet(environment.indexedDB, "video-editor-saved-sounds", "saved-sounds", "user-sounds", { sounds, lastModified: "2025-01-02T03:04:05.000Z" });
