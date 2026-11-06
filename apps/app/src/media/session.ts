import { correctSoundAsset, libraryAssets, type Commit, type CommitContext } from "@jagentchill/editor-core";
import { ncsCredit, ncsRelease } from "../music/notes";
import {
  automaticProxyReason, bytesSource, blobSource, documentLibrary, downloadMedia, exportOriginals, FilmstripScheduler, formatBytes, importFiles, isEmptySlot, isOfflineFile, localAssetOf, memorySink, message, pastedImageName,
  planExportOriginals, provenance, proxyCacheKey, proxyTransition, recordProbeCommand, recoverableRecordings, RecordingSession, relinkAssetCommand, relinkDecision, removeAssetsCommand, selectProxyProducer, setLocalAsset,
  STORAGE_RESERVE_BYTES, UrlImportError, usageCounts, waveformKey, WaveformService, extensionOf, checkImportUrl, urlImportRoute, probeRecordFields,
  type BackgroundJob, type CacheStore as MediaCache, type ImportFile, type ImportNotice, type ImportResult, type MediaMessage, type ProbeResult, type ProxyForm, type RecordingKind, type RecordingManifest, type RecordingResult,
  type RecordingStore, type RelinkDecision, type RelinkFields, type WaveformState,
} from "@jagentchill/media";
import { engineImportSteps, type MediaEngine } from "@jagentchill/media/browser";
import type { AssetRecord, LocalAsset, ProjectDocument } from "@jagentchill/protocol";
import { completeMigratedAssets, evaluateStorageCapacity, purgeUnreferencedMedia, saveMediaAssetStream, trashBytes, type CacheKey, type StoragePort } from "@jagentchill/storage";
import { createSourceCache } from "./source-cache";
import { plainImportFailure, runNativeImportQueue } from "./native-import-queue";
import { blobUrl, createMediaEngine, mediaPlatform, releaseUrl, saveBlob, type Capture, type PickedFile } from "../platform/media";
import { imageUrl } from "../platform/store";
import type { NativeMediaReader, ImportedHostMedia } from "./remote-media";

/** The editing session as the media library needs it: the document, its undo history and its save manager. */
export type MediaSessionHost = {
  storage: StoragePort; projectId: string;
  document(): ProjectDocument;
  context(): CommitContext;
  /** Records an undoable change. */
  commit(commit: Commit): void;
  /** Takes back a commit whose media could not be stored, leaving no undo step. */
  rollback(commit: Commit): void;
  /** A device-local change: no undo step, no patch. */
  setDocument(document: ProjectDocument): void;
  /** Saves the record now; rejects when it cannot be saved. */
  flush(): Promise<void>;
  hostConnected(): boolean;
  remoteImport?(file: NativeMediaReader, signal: AbortSignal, onProgress: (progress: { phase: "hash" | "upload"; bytes: number; total: number }) => void): Promise<ImportedHostMedia>;
  remotePicture?(sha256: string, variant: "thumb" | "filmstrip", signal?: AbortSignal): Promise<string | null>;
};
export type MediaNotice = { level: "info" | "warning" | "error" | "success"; message: MediaMessage; actions?: MediaMessage[]; assetId?: string };
export type ImportState = { percent: number; completed: number; total: number } | null;
export type NativeImportRow = { id: string; name: string; percent: number; state: "queued" | "uploading" | "paused" | "failed" | "done" | "cancelled"; error?: string };
export type MediaState = {
  importing: ImportState;
  nativeImports: NativeImportRow[];
  /** Percentage of each proxy job that is running. */
  proxyProgress: Record<string, number>;
  /** Bumped whenever a thumbnail became available. */
  thumbnails: number;
  usage: { used: number; available: number | null } | null;
  recovered: { id: string; name: string; bytes: number; kind: RecordingKind }[];
};
export type RelinkCheck = { decision: RelinkDecision; apply(): Promise<void>; name: string };
export type LiveFacts = { sampleRate?: number; channels?: number; hasAlpha?: boolean };

const SESSION_INDEX = "recordings";
type RecordingIndexEntry = RecordingManifest & { id: string; chunks: number; bytes: number; finished: boolean };
const chunkKey = (id: string, index: number) => `recording-${id}-${index}`;
/** Incremental storage of a recording: every chunk is its own session record, so a crash keeps what was captured. */
export function recordingStore(storage: StoragePort): RecordingStore & { read(id: string): Promise<Uint8Array[]> } {
  const index = async () => (await storage.getSession<RecordingIndexEntry[]>(SESSION_INDEX)) ?? [];
  const update = async (id: string, change: (entry: RecordingIndexEntry) => RecordingIndexEntry | null) => {
    const next = (await index()).map((entry) => (entry.id === id ? change(entry) : entry)).filter((entry): entry is RecordingIndexEntry => entry !== null);
    await storage.putSession(SESSION_INDEX, next);
  };
  return {
    begin: async (id, manifest) => { await storage.putSession(SESSION_INDEX, [...(await index()).filter((entry) => entry.id !== id), { ...manifest, id, chunks: 0, bytes: 0, finished: false }]); },
    append: async (id, chunk) => {
      const entry = (await index()).find((item) => item.id === id);
      if (!entry) return;
      await storage.putSession(chunkKey(id, entry.chunks), chunk);
      await update(id, (current) => ({ ...current, chunks: current.chunks + 1, bytes: current.bytes + chunk.length }));
    },
    finish: (id) => update(id, (entry) => ({ ...entry, finished: true })),
    unfinished: async () => (await index()).filter((entry) => !entry.finished),
    discard: async (id) => {
      const entry = (await index()).find((item) => item.id === id);
      for (let chunk = 0; chunk < (entry?.chunks ?? 0); chunk++) await storage.deleteSession(chunkKey(id, chunk));
      await update(id, () => null);
    },
    read: async (id) => {
      const entry = (await index()).find((item) => item.id === id), chunks: Uint8Array[] = [];
      for (let chunk = 0; chunk < (entry?.chunks ?? 0); chunk++) { const bytes = await storage.getSession<Uint8Array>(chunkKey(id, chunk)); if (bytes) chunks.push(bytes); }
      return chunks;
    },
  };
}

/** The media engine's string keys over the one cache store of the device. */
function cacheAdapter(storage: StoragePort, projectId: string): MediaCache {
  const keyOf = (key: string): CacheKey | null => {
    const [kind, rest = "", variant] = key.split("/");
    if (kind === "waveform") return { kind: "waveform", contentHash: rest };
    if (kind === "filmstrip") return { kind: "filmstrip", contentHash: rest, variant };
    if (kind === "proxy") { const dot = rest.lastIndexOf("."); return { kind: "proxy", contentHash: dot < 0 ? rest : rest.slice(0, dot), variant: dot < 0 ? undefined : rest.slice(dot + 1) }; }
    return null;
  };
  return {
    get: async (key) => { const cacheKey = keyOf(key); return cacheKey ? storage.cache.get(cacheKey) : undefined; },
    put: async (key, bytes) => { const cacheKey = keyOf(key); if (cacheKey) await storage.cache.put(cacheKey, bytes, { projectId }); },
    delete: async (key) => { const cacheKey = keyOf(key); if (cacheKey && (await storage.cache.has(cacheKey))) { /* The cache store frees entries by eviction; a removed asset's entries simply stop being used. */ } },
    list: async (prefix) => { const cacheKey = keyOf(prefix); return cacheKey && (await storage.cache.has(cacheKey)) ? [prefix] : []; },
  };
}
async function* blobChunks(blob: Blob, size = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += size) yield new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + size)).arrayBuffer());
}
const mimeOf = (asset: AssetRecord): string => {
  const container = asset.container ?? extensionOf(asset.name);
  const table: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: asset.type === "audio" ? "audio/webm" : "video/webm", mkv: "video/x-matroska", "3gp": "video/3gpp", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml" };
  return table[container] ?? `${asset.type}/*`;
};

/**
 * The media library of one open project on this device: the one import pipeline with its real hashing, probing and
 * thumbnails, the storage writes with rollback, the background jobs (waveform, filmstrip, proxy), relink, export of
 * originals, URL import and recording. Everything is real: files in the store, values from the files themselves.
 */
export function createMediaSession(host: MediaSessionHost) {
  const trace = (globalThis as typeof globalThis & { __w11jMediaSessionTrace?: { created: number; closeCalls: number; closed: number } }).__w11jMediaSessionTrace;
  if (trace) trace.created += 1;
  const { storage, projectId } = host;
  const engine: MediaEngine = createMediaEngine();
  const cache = cacheAdapter(storage, projectId), waveforms = new WaveformService({ cache });
  const recordings = recordingStore(storage);
  let state: MediaState = { importing: null, nativeImports: [], proxyProgress: {}, thumbnails: 0, usage: null, recovered: [] };
  const listeners = new Set<() => void>(), notices = new Set<(notice: MediaNotice) => void>();
  const set = (patch: Partial<MediaState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const notify = (notice: MediaNotice) => { for (const listener of notices) listener(notice); };
  // Files handed over in this session are read from where they came; after a reload the bytes come from the store.
  // Without the original on this device a clip plays from its 720p proxy (the one sync downloaded from the host, or one
  // made here) — until the original arrives: `sources.arrived()` in `mediaArrived` then lets the proxy go.
  const sources = createSourceCache({
    // Native editing is a remote client: the host reads and decodes its media. Do not wrap React Native byte arrays in
    // Blob objects or send phone media through the browser engine.
    hasOriginal: (assetId) => mediaPlatform === "mobile" ? Promise.resolve(false) : storage.hasMedia(projectId, assetId),
    original: async (assetId) => new Blob([(await storage.readMedia(projectId, assetId)) as unknown as BlobPart], { type: mimeOf(assetOf(assetId)!) }),
    proxy: async (assetId) => {
      if (mediaPlatform === "mobile") return null;
      const asset = assetOf(assetId), proxy = asset?.contentHash ? await cache.get(proxyCacheKey(asset.contentHash, "mp4")).catch(() => undefined) : undefined;
      return proxy ? new Blob([proxy as unknown as BlobPart], { type: "video/mp4" }) : null;
    },
  }, blobUrl, releaseUrl);
  const thumbs = new Map<string, string | null>(), thumbLoads = new Set<string>();
  let arriving: Promise<void> = Promise.resolve();
  const removed = new Set<string>();
  let folderOfPanel: string | null = null, importAbort: AbortController | null = null, closed = false;
  let remotePending: NativeMediaReader[] = [];
  let remoteRun: Promise<{ imported: ImportedHostMedia[]; failures: { name: string; error: string }[] }> | null = null;
  let remotePaused = false;
  let currentRemoteId: string | null = null;
  const proxyAborts = new Map<string, { cancelled: boolean }>();

  const doc = () => host.document();
  const assetOf = (assetId: string) => doc().media.assets.find((asset) => asset.id === assetId);
  const setLocalOf = (assetId: string, change: Partial<LocalAsset>) => { if (assetOf(assetId)) host.setDocument(setLocalAsset(doc(), assetId, change)); };

  const blobOf = async (assetId: string): Promise<Blob | null> => (assetOf(assetId) ? sources.blob(assetId) : null);
  async function refreshUsage(): Promise<void> {
    const media = await storage.listMedia(projectId).catch(() => []), free = await storage.available().catch(() => null);
    if (!closed) set({ usage: { used: media.reduce((sum, entry) => sum + entry.size, 0), available: free === null ? null : Math.max(0, free - STORAGE_RESERVE_BYTES) } });
  }
  async function putThumbnail(assetId: string, thumbnail: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
    if (!thumbnail) return;
    const png = thumbnail.mimeType === "image/png";
    await storage.putBlob("thumbnail", projectId, `${assetId}.${png ? "png" : "jpg"}`, thumbnail.bytes);
    await storage.deleteBlob("thumbnail", projectId, `${assetId}.${png ? "jpg" : "png"}`).catch(() => undefined);
    const previous = thumbs.get(assetId);
    if (previous) releaseUrl(previous);
    thumbs.set(assetId, imageUrl(thumbnail.bytes, thumbnail.mimeType));
    set({ thumbnails: state.thumbnails + 1 });
  }

  // ── Background jobs ───────────────────────────────────────────────────────────────────────────────────────────────
  const filmstrips = new FilmstripScheduler({
    cache,
    decode: async ({ contentHash, time }) => {
      const asset = doc().media.assets.find((entry) => entry.contentHash === contentHash), blob = asset ? await blobOf(asset.id) : null;
      if (!blob) throw new Error("the media is not on this device");
      const [frame] = await engine.filmstrip(blob, [time]);
      if (!frame?.bytes) throw new Error("no frame");
      return frame.bytes;
    },
  });
  function startWaveform(assetId: string, contentHash: string, onState?: (state: WaveformState) => void): Promise<unknown> {
    return waveforms.get(waveformKey({ contentHash }), async (_key, onProgress) => {
      const blob = await blobOf(assetId);
      if (!blob) throw new Error("the media is not on this device");
      return engine.waveform(blob, onProgress);
    }, onState).catch(() => undefined);
  }
  async function runProxy(assetId: string): Promise<void> {
    const asset = assetOf(assetId);
    if (!asset || asset.type !== "video" || !asset.contentHash || !asset.width || !asset.height || !asset.fps) return;
    if (mediaPlatform === "mobile") { setLocalOf(assetId, { proxy: proxyTransition(localAssetOf(doc(), assetId).proxy, { type: "unavailable" }) }); return; }
    const local = localAssetOf(doc(), assetId), flag = { cancelled: false };
    proxyAborts.set(assetId, flag);
    const encoders = await engine.encoderSupport().catch(() => null);
    const producer = selectProxyProducer({ encoders, sourceDecodes: local.canDecode !== false, hostConnected: host.hostConnected() });
    // A host job needs the host's FFmpeg worker; this device can only make the proxy itself.
    if (producer.producer !== "device") { setLocalOf(assetId, { proxy: proxyTransition(local.proxy, { type: "unavailable" }) }); proxyAborts.delete(assetId); return; }
    const blob = await blobOf(assetId);
    if (!blob) { setLocalOf(assetId, { proxy: proxyTransition(local.proxy, { type: "fail" }) }); proxyAborts.delete(assetId); return; }
    setLocalOf(assetId, { proxy: proxyTransition(local.proxy, { type: "start" }) });
    set({ proxyProgress: { ...state.proxyProgress, [assetId]: 0 } });
    try {
      const form: ProxyForm = producer.form;
      const made = await engine.proxy(blob, { width: asset.width, height: asset.height, fps: asset.fps, hasAudio: asset.hasAudio }, form, (fraction) => { if (!flag.cancelled && !closed) set({ proxyProgress: { ...state.proxyProgress, [assetId]: Math.round(fraction * 100) } }); });
      if (flag.cancelled) return;
      await cache.put(proxyCacheKey(asset.contentHash, form), made.bytes);
      const current = localAssetOf(doc(), assetId);
      setLocalOf(assetId, { proxy: proxyTransition(current.proxy, { type: "succeed", form, size: made.size, sha256: made.sha256 }), present: { ...current.present, proxy: true } });
      // A video that had no picture gets its thumbnail from the proxy.
      if (!thumbs.get(assetId) && current.canDecode === false) await putThumbnail(assetId, await engine.thumbnail(new Blob([made.bytes as unknown as BlobPart], { type: form === "mp4" ? "video/mp4" : "video/webm" }), { type: "video", width: made.width, height: made.height, duration: asset.duration, fps: made.fps, rotation: 0, canDecode: true }).catch(() => null));
    } catch {
      if (!flag.cancelled) setLocalOf(assetId, { proxy: proxyTransition(localAssetOf(doc(), assetId).proxy, { type: "fail" }) });
    } finally {
      proxyAborts.delete(assetId);
      const { [assetId]: _done, ...rest } = state.proxyProgress;
      if (!closed) set({ proxyProgress: rest });
    }
  }
  let proxyQueue: Promise<void> = Promise.resolve();
  function queueProxy(assetId: string): void {
    setLocalOf(assetId, { proxy: proxyTransition(localAssetOf(doc(), assetId).proxy, { type: "queue" }) });
    proxyQueue = proxyQueue.then(() => (closed || localAssetOf(doc(), assetId).proxy.state !== "queued" ? undefined : runProxy(assetId)));
  }
  function schedule(job: BackgroundJob): void {
    if (job.kind === "waveform") void startWaveform(job.assetId, job.contentHash);
    else if (job.kind === "filmstrip") void Promise.all(filmstrips.schedule({ contentHash: job.contentHash, duration: job.duration }));
    else queueProxy(job.assetId);
  }

  // ── The import pipeline ───────────────────────────────────────────────────────────────────────────────────────────
  const library = documentLibrary({
    get document() { return doc(); }, context: host.context, commit: host.commit, rollback: host.rollback, setDocument: host.setDocument,
  });
  const steps = engineImportSteps(engine);
  async function runImport(given: ImportFile[]): Promise<ImportResult> {
    // A sound whose file name says it is an NCS release carries the credit NCS asks for from the start (the person can paste the release's full credit in "More music").
    const files = given.map((file) => { const release = (!file.provenance || file.provenance.source === "imported" || file.provenance.source === "url") && !file.provenance?.credit && /^audio\//.test(file.mimeType ?? "") ? ncsRelease(file.name) : null; return release ? { ...file, provenance: { ...(file.provenance ?? { source: "imported" as const }), credit: ncsCredit(release), attributionRequired: true } } : file; });
    importAbort = new AbortController();
    set({ importing: { percent: 0, completed: 0, total: files.length } });
    try {
      const result = await importFiles({
        library, ...steps,
        storage: {
          evaluate: async (bytes) => { const decision = await evaluateStorageCapacity(storage, bytes, { kind: "media", evictCache: (needed) => storage.cache.evict(needed) }); return decision; },
          hasBytes: async (contentHash) => (await storage.mediaReferences(contentHash)) > 0,
          trashBytes: () => trashBytes(storage),
          availableAfterReserve: async () => { const free = await storage.available(); return free === null ? null : Math.max(0, free - STORAGE_RESERVE_BYTES); },
          persist: async (assetId, file, extras) => {
            if (file.blob) sources.hold(assetId, file.blob);
            // The file first, the record second; when either fails the file is removed again.
            await saveMediaAssetStream(storage, projectId, assetId, file.blob ? blobChunks(file.blob) : [await file.source.read(0, file.size)], () => host.flush(), { contentHash: extras.contentHash, extension: extras.extension });
            await putThumbnail(assetId, extras.thumbnail).catch(() => undefined);
          },
          discard: async (assetId) => { sources.forget(assetId); await storage.removeMedia(projectId, assetId).catch(() => undefined); for (const extension of ["jpg", "png"]) await storage.deleteBlob("thumbnail", projectId, `${assetId}.${extension}`).catch(() => undefined); },
        },
        schedule,
        notify: (notice: ImportNotice) => notify({ level: notice.level, message: notice, actions: notice.actions, assetId: notice.assetId }),
        progress: (progress) => set({ importing: { percent: progress.percent, completed: progress.completed, total: progress.total } }),
        // A frame is painted between files, the first one before any processing.
        yield: () => new Promise<void>((resolve) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(resolve, 0)); else setTimeout(resolve, 0); }),
        currentFolderId: () => folderOfPanel,
      }, files, { signal: importAbort.signal });
      // The assets, their device-local entries and the folders they created are saved before the import reports done.
      await host.flush().catch(() => undefined);
      void refreshUsage();
      return result;
    } finally {
      importAbort = null;
      set({ importing: null });
    }
  }
  async function runRemoteImport(files: NativeMediaReader[], retry = false): Promise<{ imported: ImportedHostMedia[]; failures: { name: string; error: string }[] }> {
    if (remoteRun) return remoteRun;
    if (!retry) for (const file of files) {
      const id = `${file.uri}\u0000${file.name}`;
      if (!remotePending.some((entry) => entry.uri === file.uri && entry.name === file.name)) remotePending.push(file);
      if (!state.nativeImports.some((row) => row.id === id)) set({ nativeImports: [...state.nativeImports, { id, name: file.name, percent: 0, state: "queued" }] });
    }
    const candidates = files.filter((file) => {
      const id = `${file.uri}\u0000${file.name}`, row = state.nativeImports.find((entry) => entry.id === id);
      return row && (row.state === "queued" || row.state === "paused" || (retry && row.state === "failed"));
    });
    if (!candidates.length) return { imported: [], failures: [] };
    if (!host.remoteImport) {
      const error = plainImportFailure(new Error("no host connected"));
      set({ nativeImports: state.nativeImports.map((row) => candidates.some((file) => `${file.uri}\u0000${file.name}` === row.id) ? { ...row, state: "failed", error } : row) });
      return { imported: [], failures: candidates.map((file) => ({ name: file.name, error })) };
    }
    remotePaused = false;
    const abort = new AbortController(); importAbort = abort;
    const imported: ImportedHostMedia[] = [], failures: { name: string; error: string }[] = [];
    const run = (async () => {
      try {
        const outcomes = await runNativeImportQueue<NativeMediaReader & { id: string }, ImportedHostMedia>({
          files: candidates.map((file) => ({ ...file, id: `${file.uri}\u0000${file.name}` })),
          transport: async (file, signal, progress) => host.remoteImport!(file, signal, (item) => progress(item.phase, item.bytes, item.total)),
          signal: abort.signal, shouldPause: () => remotePaused,
          onState: (id, next, error) => {
            currentRemoteId = next === "uploading" ? id : currentRemoteId === id ? null : currentRemoteId;
            const file = candidates.find((entry) => `${entry.uri}\u0000${entry.name}` === id);
            set({ nativeImports: state.nativeImports.map((row) => row.id === id ? { ...row, state: next, error: error ? plainImportFailure(error) : undefined } : row) });
            if (next === "done" || (next === "cancelled" && !remotePaused)) remotePending = remotePending.filter((entry) => entry !== file);
            if (next === "failed" && file) failures.push({ name: file.name, error: plainImportFailure(error) });
          },
          onProgress: (id, percent) => {
            const index = candidates.findIndex((file) => `${file.uri}\u0000${file.name}` === id);
            set({ nativeImports: state.nativeImports.map((row) => row.id === id ? { ...row, percent } : row), importing: { percent: Math.round((index + percent / 100) / candidates.length * 100), completed: index, total: candidates.length } });
          },
        });
        for (const outcome of outcomes) if ("result" in outcome) {
          const file = candidates.find((entry) => `${entry.uri}\u0000${entry.name}` === outcome.id);
          if (file) { imported.push(outcome.result); remotePending = remotePending.filter((entry) => entry !== file); }
        }
        return { imported, failures };
      } finally { currentRemoteId = null; if (importAbort === abort) importAbort = null; set({ importing: null }); }
    })();
    remoteRun = run;
    try { return await run; } finally { remoteRun = null; }
  }
  const toImportFile = (picked: PickedFile, extra: Partial<ImportFile> = {}): ImportFile => ({
    name: picked.file.name, mimeType: picked.file.type, size: picked.file.size, lastModified_ms: picked.file.lastModified, source: blobSource(picked.file), blob: picked.file,
    ...(picked.relativePath && picked.relativePath.includes("/") ? { relativePath: picked.relativePath } : {}), ...extra,
  });

  // ── Start-up: presence, pending probes, interrupted recordings ────────────────────────────────────────────────────
  async function reconcile(): Promise<void> {
    // Presence is what the store can actually read: an index row whose file is gone is an offline asset.
    const stored = new Set<string>();
    for (const entry of await storage.listMedia(projectId).catch(() => [])) {
      try { for await (const _chunk of storage.readMediaStream(projectId, entry.assetId, { start: 0, end: 1 })) break; stored.add(entry.assetId); } catch { /* not readable: offline */ }
    }
    let document = doc(), changed = false;
    for (const asset of document.media.assets) {
      const local = localAssetOf(document, asset.id);
      if (local.storage !== "managed") continue;
      const present = stored.has(asset.id);
      const proxyPresent = local.proxy.state === "succeeded" && local.proxy.container && asset.contentHash ? await storage.cache.has({ kind: "proxy", contentHash: asset.contentHash, variant: local.proxy.container }).catch(() => false) : false;
      // A job that was running when the app closed is not running any more.
      const proxy = local.proxy.state === "running" || local.proxy.state === "queued" ? { state: "none" as const } : local.proxy.state === "succeeded" && !proxyPresent ? { state: "none" as const } : local.proxy;
      if (local.present.original !== present || local.present.proxy !== proxyPresent || proxy !== local.proxy) { document = setLocalAsset(document, asset.id, { present: { ...local.present, original: present, proxy: proxyPresent }, proxy }); changed = true; }
    }
    if (changed && !closed) host.setDocument(document);
    // A project that arrived as a package brings its media without the library thumbnails: they are made again from the files.
    for (const asset of doc().media.assets) {
      if (closed || asset.type === "audio" || !stored.has(asset.id)) continue;
      const has = (await storage.getBlob("thumbnail", projectId, `${asset.id}.jpg`).catch(() => undefined)) ?? (await storage.getBlob("thumbnail", projectId, `${asset.id}.png`).catch(() => undefined));
      if (has) continue;
      const blob = await blobOf(asset.id), probed = blob ? await engine.probe(blob, asset.name, blob.type).catch(() => null) : null;
      if (blob && probed) await putThumbnail(asset.id, await engine.thumbnail(blob, probed.probe).catch(() => null)).catch(() => undefined);
    }
    // Assets that came from OpenCut classic are probed once, on their first load.
    const completed = await completeMigratedAssets(doc(), {
      port: storage, context: host.context,
      probe: async (assetId) => {
        const blob = await blobOf(assetId), asset = assetOf(assetId);
        const probed = blob && asset ? await engine.probe(blob, asset.name, blob.type) : null;
        if (!probed) throw new Error("the file cannot be probed");
        if (blob) await putThumbnail(assetId, await engine.thumbnail(blob, probed.probe).catch(() => null));
        return { canDecode: probed.probe.canDecode, fields: probeRecordFields(probed.probe) };
      },
    }).catch(() => null);
    if (completed && completed.probed.length > 0 && !closed) { for (const commit of completed.commits) host.commit({ ...commit, document: commit.document }); host.setDocument(completed.document); }
    if (!closed) set({ recovered: (await recoverableRecordings(recordings, projectId).catch(() => [])).map((entry) => ({ id: entry.id, name: entry.name, bytes: entry.bytes, kind: entry.kind })) });
    await refreshUsage();
    await correctSounds();
    await learnDecodable();
  }
  /**
   * Media that came to this device by sync was never looked at here: an import records whether the device can decode a
   * file (`canDecode`), an arrival did not — so the export check took every arrived file for usable. Each such file is
   * looked at once: a video or a sound by its probe (a file the probe cannot read at all is not decodable), a picture
   * by really decoding it (its thumbnail), and the answer is kept in the document's device-local section.
   */
  const looked = new Set<string>();
  async function learnDecodable(): Promise<void> {
    for (const asset of doc().media.assets) {
      if (closed) return;
      const local = localAssetOf(doc(), asset.id), known = local.canDecode;
      // A video with a sound track is looked at for its sound too (a picture this device decodes may carry a sound it cannot).
      const soundKnown = asset.type !== "video" || asset.hasAudio === false || local.canDecodeSound === true || local.canDecodeSound === false;
      if (looked.has(asset.id) || ((known === true || known === false) && soundKnown) || isEmptySlot(asset)) continue;
      if (!(await storage.hasMedia(projectId, asset.id).catch(() => false))) continue;
      looked.add(asset.id);
      const blob = await blobOf(asset.id);
      if (!blob) continue;
      const probed = await engine.probe(blob, asset.name, blob.type).catch(() => null);
      let can: boolean | null = probed ? probed.probe.canDecode : false;
      if (probed && asset.type === "image") can = (await engine.thumbnail(blob, probed.probe).catch(() => null)) !== null;
      const sound = probed && asset.type === "video" ? probed.probe.canDecodeSound : undefined;
      if (!closed && (can !== null || typeof sound === "boolean")) setLocalOf(asset.id, { ...(can !== null ? { canDecode: can } : {}), ...(typeof sound === "boolean" ? { canDecodeSound: sound } : {}) });
    }
  }
  /**
   * A file the library records as a VIDEO but that has no moving picture — a song whose cover art a probe took for a
   * video stream (hosts before the fix of that probe recorded downloaded MP3s so) — cannot be drawn: the preview shows
   * nothing for its clip and an export stops at its first frame. This device reads the file itself; when it is a sound,
   * the record and the clips are corrected as one step (undoable). Only records that look like it are read: a still-
   * picture codec for a "video", or the name of an audio file.
   */
  async function correctSounds(): Promise<void> {
    for (const asset of doc().media.assets) {
      if (closed) return;
      if (asset.type !== "video" || !(/^(mjpeg|png|bmp|gif|jpeg)$/i.test(String((asset as { videoCodec?: string }).videoCodec ?? "")) || /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma)$/i.test(asset.name))) continue;
      if (!(await storage.hasMedia(projectId, asset.id).catch(() => false))) continue;
      const blob = await blobOf(asset.id), probed = blob ? await engine.probe(blob, asset.name, blob.type).catch(() => null) : null;
      if (closed || probed?.probe.type !== "audio") continue;
      try { host.commit(correctSoundAsset(doc(), host.context(), asset.id)); } catch { /* a project that cannot be edited here (view only) is corrected by a device that can */ }
    }
  }
  void reconcile();

  const session = {
    engine, platform: mediaPlatform,
    getState: (): MediaState => state,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    onNotice(listener: (notice: MediaNotice) => void): () => void { notices.add(listener); return () => void notices.delete(listener); },
    /** The folder the panel shows: where plain imports land. */
    setCurrentFolder(folderId: string | null): void { folderOfPanel = folderId; },

    /** The picker, the drop zone and the empty state hand their files here. */
    importFiles: (picked: PickedFile[], extra: Partial<ImportFile> = {}): Promise<ImportResult> => runImport(picked.map((entry) => toImportFile(entry, extra))),
    importNativeFiles: (files: NativeMediaReader[]) => runRemoteImport(files),
    /** Re-enter a paused native upload after the app becomes active; the host skips every chunk it already has. */
    async resumeNativeImport(): Promise<void> { if (remotePaused && remoteRun) await remoteRun; if (remotePending.length) await runRemoteImport([...remotePending]).then(() => undefined); },
    pauseNativeImport(): void {
      if (!importAbort) return;
      remotePaused = true;
      if (currentRemoteId) set({ nativeImports: state.nativeImports.map((row) => row.id === currentRemoteId && row.state === "uploading" ? { ...row, state: "paused" } : row) });
      importAbort.abort();
    },
    retryNativeImport(id: string): Promise<{ imported: ImportedHostMedia[]; failures: { name: string; error: string }[] }> {
      const file = remotePending.find((entry) => `${entry.uri}\u0000${entry.name}` === id);
      return file ? runRemoteImport([file], true) : Promise.resolve({ imported: [], failures: [] });
    },
    cancelImport(id?: string): void {
      if (!id) { remotePaused = false; remotePending = []; importAbort?.abort(); set({ nativeImports: state.nativeImports.map((row) => row.state === "uploading" || row.state === "queued" || row.state === "paused" ? { ...row, state: "cancelled" } : row) }); return; }
      remotePending = remotePending.filter((entry) => `${entry.uri}\u0000${entry.name}` !== id);
      set({ nativeImports: state.nativeImports.map((row) => row.id === id ? { ...row, state: "cancelled", error: undefined } : row) });
      if (currentRemoteId === id) { remotePaused = false; importAbort?.abort(); }
    },
    /** Clipboard files and bitmaps; a bitmap without a file name becomes "Pasted image {n}.png". */
    importPasted(items: { file: Blob; name: string | null }[]): Promise<ImportResult> {
      const names = doc().media.assets.map((asset) => asset.name);
      return runImport(items.map((item) => {
        const name = item.name ?? pastedImageName(names);
        names.push(name);
        return { name, mimeType: item.file.type, size: item.file.size, source: blobSource(item.file), blob: item.file };
      }));
    },
    /** "Import from URL": fetched directly; the provenance records the link. */
    async importUrl(raw: string, options: { onProgress?(fraction: number | null): void; signal?: AbortSignal; /** The credit line its source asks for (an NCS release the person named). */ credit?: string } = {}): Promise<{ ok: true; result: ImportResult } | { ok: false; message: MediaMessage }> {
      const sink = memorySink();
      try {
        const downloaded = await downloadMedia({
          url: raw, sink, signal: options.signal, onProgress: (progress) => options.onProgress?.(progress.fraction),
          evaluateQuota: (bytes) => evaluateStorageCapacity(storage, bytes, { kind: "media", evictCache: (needed) => storage.cache.evict(needed) }),
        });
        const bytes = sink.bytes(), blob = new Blob([bytes as unknown as BlobPart], { type: downloaded.mimeType });
        return { ok: true, result: await runImport([{ name: downloaded.name, mimeType: downloaded.mimeType, size: bytes.length, source: bytesSource(bytes), blob, provenance: { ...provenance.url(downloaded.provenance.url), ...(options.credit?.trim() ? { credit: options.credit.trim().slice(0, 1000), attributionRequired: true } : {}) } }]) };
      } catch (error) {
        if (error instanceof UrlImportError) return { ok: false, message: error.notice };
        // A browser reports a cross-origin refusal as a failed fetch: without a host the link cannot be reached.
        const check = checkImportUrl(raw), route = urlImportRoute({ platform: mediaPlatform, corsAllowed: false, gatewayConnected: host.hostConnected() });
        if (check.ok && route.route === "blocked") return { ok: false, message: route.message };
        return { ok: false, message: message("media.url.failed", { host: check.ok ? check.url.host : raw, reason: error instanceof Error ? error.message : String(error) }) };
      }
    },

    /** The stored thumbnail of an asset as a URL; `undefined` while it is being read, `null` when there is none. */
    thumbnail(assetId: string): string | null | undefined {
      if (thumbs.has(assetId)) return thumbs.get(assetId);
      if (!thumbLoads.has(assetId)) {
        thumbLoads.add(assetId);
        void (async () => {
          let url: string | null = null;
          const asset = assetOf(assetId);
          if (asset?.contentHash && host.remotePicture) url = await host.remotePicture(asset.contentHash, "thumb").catch(() => null);
          for (const [extension, mime] of [["jpg", "image/jpeg"], ["png", "image/png"]] as const) {
            if (url) break;
            const bytes = await storage.getBlob("thumbnail", projectId, `${assetId}.${extension}`).catch(() => undefined);
            if (bytes) { url = imageUrl(bytes, mime); break; }
          }
          if (closed) { if (url) releaseUrl(url); return; }
          if (!thumbs.get(assetId)) thumbs.set(assetId, url);
          set({ thumbnails: state.thumbnails + 1 });
        })();
      }
      return undefined;
    },
    filmstrip(assetId: string): string | null | undefined {
      const key = `${assetId}:filmstrip`;
      if (thumbs.has(key)) return thumbs.get(key);
      const asset = assetOf(assetId);
      if (!asset?.contentHash || !host.remotePicture || thumbLoads.has(key)) return undefined;
      thumbLoads.add(key);
      void host.remotePicture(asset.contentHash, "filmstrip").then((url) => {
        if (closed) return;
        thumbs.set(key, url); set({ thumbnails: state.thumbnails + 1 });
      }).catch(() => { if (!closed) { thumbs.set(key, null); set({ thumbnails: state.thumbnails + 1 }); } });
      return undefined;
    },
    /**
     * Media that sync brought to this device while the project is open (another device's upload, a file the host
     * imported for an agent): its picture in the panel, the space it takes, and — through the listeners — its source
     * for the preview, which asks again for every asset it still lacks. Without this the files are on the device and
     * nothing shows or plays them until the project is opened again.
     */
    mediaArrived(): Promise<void> {
      arriving = arriving.then(async () => {
        // A clip that was read from its proxy is read from the original that is here now — by the preview (told through
        // the listeners below) and by an export that starts after this.
        await sources.arrived();
        for (const asset of doc().media.assets) {
          if (closed) return;
          if (asset.type === "audio" || thumbs.get(asset.id) || !(await storage.hasMedia(projectId, asset.id).catch(() => false))) continue;
          const has = (await storage.getBlob("thumbnail", projectId, `${asset.id}.jpg`).catch(() => undefined)) ?? (await storage.getBlob("thumbnail", projectId, `${asset.id}.png`).catch(() => undefined));
          if (!has) {
            const blob = await blobOf(asset.id), probed = blob ? await engine.probe(blob, asset.name, blob.type).catch(() => null) : null;
            if (blob && probed) await putThumbnail(asset.id, await engine.thumbnail(blob, probed.probe).catch(() => null)).catch(() => undefined);
          }
          // A picture that was looked for before the file was here is looked for again.
          thumbs.delete(asset.id); thumbLoads.delete(asset.id);
        }
        await refreshUsage();
        if (!closed) set({ thumbnails: state.thumbnails + 1 });
        await correctSounds();
        await learnDecodable();
      }).catch(() => undefined);
      return arriving;
    },
    /** A URL of the asset's own bytes, for the playable preview. */
    mediaUrl: (assetId: string): Promise<string | null> => (assetOf(assetId) ? sources.url(assetId) : Promise.resolve(null)),
    /**
     * Moves on when the URLs of `mediaUrl` that were handed out are no longer the ones to use (an original arrived for a
     * clip that played from its proxy): the preview asks for all of them again and gives them to its engine.
     */
    sourcesVersion: (): number => sources.version(),
    /** What the catalogue has no field for — sample rate, channel count, alpha — read from the file itself. */
    async liveFacts(assetId: string): Promise<LiveFacts> {
      const blob = await blobOf(assetId), asset = assetOf(assetId);
      if (!blob || !asset) return {};
      const probed = await engine.probe(blob, asset.name, blob.type).catch(() => null);
      return probed ? { sampleRate: probed.probe.sampleRate, channels: probed.probe.channels, hasAlpha: probed.probe.hasAlpha } : {};
    },
    /** Peaks of an asset's waveform summary for a glyph of `bars` bars; computed once and shared. */
    waveform: (assetId: string, onState: (state: WaveformState) => void): void => { const asset = assetOf(assetId); if (asset?.contentHash) void startWaveform(assetId, asset.contentHash, onState); },

    /** Removes assets with every clip that uses them, as one undo step. The bytes stay while undo can bring them back. */
    remove(assetIds: string[]): void {
      host.commit(removeAssetsCommand(doc(), host.context(), assetIds));
      for (const id of assetIds) removed.add(id);
    },
    /** "Create proxy", and "Retry" of a failed one. */
    createProxy(assetId: string): void { queueProxy(assetId); },
    cancelProxy(assetId: string): void { const flag = proxyAborts.get(assetId); if (flag) flag.cancelled = true; setLocalOf(assetId, { proxy: proxyTransition(localAssetOf(doc(), assetId).proxy, { type: "cancel" }) }); },
    /** "Delete proxy": preview reads the original again. */
    deleteProxy(assetId: string): void { const local = localAssetOf(doc(), assetId); setLocalOf(assetId, { proxy: proxyTransition(local.proxy, { type: "delete" }), present: { ...local.present, proxy: false } }); },
    /** Whether an automatic proxy applies to this asset (shown as the reason in the Info panel). */
    proxyReason: (asset: AssetRecord) => automaticProxyReason({ width: asset.width, height: asset.height, fps: asset.fps, canDecode: localAssetOf(doc(), asset.id).canDecode }),

    /**
     * "Relink…": the picked file is hashed and probed. Equal content relinks silently; a different file comes back
     * with the comparison, and `apply` relinks after the confirmation.
     */
    async relink(assetId: string, picked: PickedFile): Promise<RelinkCheck | { failed: MediaMessage }> {
      const asset = assetOf(assetId);
      if (!asset) return { failed: message("media.not-found") };
      const probed = await engine.probe(picked.file, picked.file.name, picked.file.type).catch(() => null);
      if (!probed || probed.probe.type !== asset.type) return { failed: probed ? message("media.unsupported-type", { name: picked.file.name }) : message("media.unreadable", { name: picked.file.name }) };
      const contentHash = await engine.hash(picked.file), probe: ProbeResult = probed.probe;
      const decision = relinkDecision(asset, { contentHash, duration: probe.duration, width: probe.width, height: probe.height, fps: probe.fps });
      const apply = async () => {
        const quota = (await storage.mediaReferences(contentHash)) > 0 ? { allowed: true as const } : await evaluateStorageCapacity(storage, picked.file.size, { kind: "media", evictCache: (needed) => storage.cache.evict(needed) });
        if (!quota.allowed) { notify({ level: "error", message: message("media.quota", { name: picked.file.name, size: formatBytes(quota.required), available: formatBytes(quota.available) }) }); return; }
        await storage.writeMediaStream(projectId, assetId, blobChunks(picked.file), { contentHash, extension: extensionOf(picked.file.name) || probed.detected.format || "" });
        sources.hold(assetId, picked.file);
        if (decision.kind === "different") {
          const fields: RelinkFields = { contentHash, size: picked.file.size, ...(picked.file.lastModified ? { lastModified_ms: picked.file.lastModified } : {}), ...(probeRecordFields(probe) as Partial<RelinkFields>) };
          host.commit(relinkAssetCommand(doc(), host.context(), assetId, fields));
          await putThumbnail(assetId, await engine.thumbnail(picked.file, probe).catch(() => null)).catch(() => undefined);
        }
        const local = localAssetOf(doc(), assetId);
        setLocalOf(assetId, { canDecode: probe.canDecode, canDecodeSound: probe.canDecodeSound ?? null, present: { ...local.present, original: true, ...(decision.kind === "different" ? { proxy: false } : {}) }, ...(decision.kind === "different" ? { proxy: { state: "none" as const } } : {}) });
        await host.flush().catch(() => undefined);
        void refreshUsage();
      };
      if (decision.kind === "exact") await apply();
      return { decision, apply, name: picked.file.name };
    },

    /** "Export original files": each file is saved through the browser; offline assets are skipped and named. */
    async exportOriginals(assetIds: string[]): Promise<{ written: string[]; notice: MediaMessage | null }> {
      const document = doc(), locals = Object.fromEntries(document.media.assets.map((asset) => [asset.id, localAssetOf(document, asset.id)]));
      const plan = planExportOriginals(document.media.assets.filter((asset) => assetIds.includes(asset.id)), locals);
      const result = await exportOriginals(plan, {
        read: (assetId) => storage.readMedia(projectId, assetId),
        write: async (fileName, bytes) => { const asset = assetOf(plan.files.find((file) => file.fileName === fileName)?.assetId ?? ""); saveBlob(fileName, new Blob([bytes as unknown as BlobPart], { type: asset ? mimeOf(asset) : "application/octet-stream" })); },
      });
      return { written: result.written, notice: plan.notice };
    },

    // ── Recording ─────────────────────────────────────────────────────────────────────────────────────────────────
    /** Starts a recording on an open capture. The bytes reach storage every 2 s; low storage stops it by itself. */
    async startRecording(kind: RecordingKind, capture: Capture, onStoppedForStorage: (result: RecordingResult) => void): Promise<RecordingSession> {
      const recording = new RecordingSession({ id: host.context().newId(), projectId, kind, driver: capture.driver, store: recordings, freeBytes: () => storage.available(), onStoppedForStorage });
      await recording.start();
      return recording;
    },
    /** A stopped (or recovered) recording becomes a managed asset through the pipeline. */
    async importRecording(id: string, name: string, mimeType: string): Promise<ImportResult> {
      const chunks = await recordings.read(id), blob = new Blob(chunks as unknown as BlobPart[], { type: mimeType });
      const extension = mimeType.includes("mp4") ? (mimeType.startsWith("audio") ? "m4a" : "mp4") : "webm";
      const result = await runImport([{ name: `${name}.${extension}`, mimeType, size: blob.size, source: blobSource(blob), blob, provenance: provenance.recorded() }]);
      if (result.imported.length > 0 || result.reused.length > 0) await recordings.discard(id);
      set({ recovered: state.recovered.filter((entry) => entry.id !== id) });
      return result;
    },
    async recoverRecording(id: string): Promise<ImportResult | null> {
      const entry = (await recordings.unfinished()).find((item) => item.id === id);
      return entry ? session.importRecording(id, entry.name, entry.mimeType) : null;
    },
    async discardRecording(id: string): Promise<void> { await recordings.discard(id); set({ recovered: state.recovered.filter((entry) => entry.id !== id) }); },

    refreshUsage,
    /** Assets whose bytes are not on this device. */
    offlineAssets: (): AssetRecord[] => { const document = doc(); return libraryAssets(document).filter((asset) => isOfflineFile(asset, localAssetOf(document, asset.id))); },
    usageCounts: () => usageCounts(doc()),
    recordProbe: (assetId: string, fields: Record<string, unknown>) => host.commit(recordProbeCommand(doc(), host.context(), assetId, fields)),

    /**
     * The project is closed: the bytes, thumbnails and summaries of assets that were removed and are not back in the
     * document are purged (a retained snapshot keeps its media), object URLs are revoked, the worker stops.
     */
    async close(): Promise<void> {
      if (trace) trace.closeCalls += 1;
      closed = true;
      importAbort?.abort();
      for (const flag of proxyAborts.values()) flag.cancelled = true;
      const document = doc(), gone = [...removed].filter((id) => !document.media.assets.some((asset) => asset.id === id));
      const ephemeral = document.media.assets.filter((asset) => asset.ephemeral && !usageCounts(document).has(asset.id)).map((asset) => asset.id);
      if (ephemeral.length > 0) { try { host.commit(removeAssetsCommand(document, host.context(), ephemeral)); gone.push(...ephemeral); } catch { /* the assets stay until the next close */ } }
      if (gone.length > 0) {
        await host.flush().catch(() => undefined);
        const purged = await purgeUnreferencedMedia(storage, projectId, { now: Date.now(), only: gone }).catch(() => [] as string[]);
        for (const id of purged) for (const extension of ["jpg", "png"]) await storage.deleteBlob("thumbnail", projectId, `${id}.${extension}`).catch(() => undefined);
      }
      for (const url of thumbs.values()) if (url) releaseUrl(url);
      sources.clear(); thumbs.clear(); waveforms.clear();
      engine.dispose();
      if (trace) trace.closed += 1;
    },
  };
  return session;
}
export type MediaSession = ReturnType<typeof createMediaSession>;
