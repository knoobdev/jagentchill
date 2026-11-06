/**
 * The export service of this device: the queue and the history of `export-share`, and the one runner of on-device jobs.
 * A job renders the snapshot taken when it was created — through the engine of the open editor of its project, or
 * through an engine of its own when no editor is open — and its bytes go to storage as they are produced.
 */
import { createEditorController, documentTexts, EDITOR_PREFS, engineFontSources, exporting } from "@jagentchill/app-core";
import { addToHistogram, buildPalette, captionCues, captionTracksOf, jpegWithXmp, newHistogram, pngWithXmp, timeline, uuidV4, xmpUuidBox } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { createZipWriter, type StoragePort } from "@jagentchill/storage";
import { createMediaSession } from "../../media/session";
import { notifications } from "../../notifications";
import { getPref } from "../../state";
import { createFinalisingWatchdog } from "@jagentchill/render";
import { BUNDLED_FACES } from "../fonts.gen";
import { createLutStore } from "../inspector/luts";
import { openPreviewEngine, type PreviewEngine } from "../preview-engine";
import { createEditorRuntime } from "../runtime";
import {
  appVersion, cleanPrivate, decodeRgba, deletePrivate, download, exportPlatform, guardExport, hiddenHost, onTabHidden, openOutput, privateFile, toBase64, toJpeg, writeIntoFolder,
  type FolderHandle, type Output, type SaveHandle,
} from "./platform";

type Job = exporting.ExportJob;
type Settings = exporting.ExportSettings;
export type ExportRequest = {
  document: ProjectDocument; sceneId: string; settings: Settings; fileName: string; playhead: number; waivers?: Partial<Record<exporting.Waiver, boolean>>; /** The media "Export anyway" named (`exporting.waivedMediaAssets`). */ waivedAssetIds?: string[];
  /** Where the user chose to save, when the browser let them choose. */
  file?: SaveHandle | null; folder?: FolderHandle | null; saveCover?: boolean;
  /** What the dialog said before the export started (a codec the preset resolved to). */
  notice?: string;
};
export type ServiceState = {
  queue: exporting.ExportQueue; hostJobs: Job[]; ready: boolean;
  /** What the polite live region says next. */
  announcement: { text: string; values?: Record<string, string | number>; id: number } | null;
  /** The tab is hidden while an export runs: the browser slows background tabs. */
  backgroundNotice: boolean;
};
type Editor = { projectId: string; engine(): PreviewEngine | null };
type Run = { jobId: string; exportId: string | null; editor: Editor | null; abandon(reason: "editor-closed"): void; hardStop?: () => void; port: PreviewEngine["port"] | null; cancelled: boolean; pausedAt: number | null; pausedTotal: number };
const QUEUE_KEY = "export.queue", snapshotKey = (jobId: string) => `export.snapshot.${jobId}`;
const RESTART = Symbol("restart");
const engineCodec: Record<exporting.VideoCodec, "avc" | "hevc" | "vp9" | "av1"> = { h264: "avc", hevc: "hevc", vp9: "vp9", av1: "av1" };
/**
 * A failure carrying the export's own code. Browser errors (DOMException) have a read-only `code`: writing it threw a
 * second error inside the handler, the export never settled and sat at 98 % for ever. A new Error is made instead.
 */
function failureWithCode(error: unknown, code: string): Error & { code: string; cause?: unknown } {
  const source = error as { name?: string; message?: string } | null;
  const failure = new Error(source?.message ? String(source.message) : String(error)) as Error & { code: string; cause?: unknown; sourceName?: string };
  failure.code = code; failure.cause = error; if (source?.name) failure.sourceName = String(source.name);
  return failure;
}
const STAGE: Record<string, exporting.ExportStage> = { preparing: "Preparing", rendering: "Rendering", audio: "Mixing audio", finalising: "Finalising", saving: "Saving" };
const text = (value: string) => new TextEncoder().encode(value);

function createExportService() {
  let state: ServiceState = { queue: exporting.EMPTY_QUEUE, hostJobs: [], ready: false, announcement: null, backgroundNotice: false };
  let storage: StoragePort | null = null, running: Run | null = null, pumping = false, announcements = 0, saveTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>(), editors = new Map<string, Editor>(), snapshots = new Map<string, ProjectDocument>();
  const files = new Map<string, SaveHandle>(), folders = new Map<string, FolderHandle>(), covers = new Map<string, boolean>(), playheads = new Map<string, number>();
  /** Jobs whose dialog is open on their progress: their end raises no notification. */
  const watched = new Set<string>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const set = (patch: Partial<ServiceState>) => { state = { ...state, ...patch }; emit(); };
  const persist = () => {
    if (saveTimer || !storage) return;
    saveTimer = setTimeout(() => { saveTimer = null; void storage?.putSession(QUEUE_KEY, state.queue).catch(() => undefined); }, 400);
  };
  const setQueue = (queue: exporting.ExportQueue) => { set({ queue }); persist(); };
  const update = (id: string, patch: Partial<Job>) => setQueue(exporting.updateJob(state.queue, id, patch));
  const announce = (line: { text: string; values?: Record<string, string | number> }) => set({ announcement: { ...line, id: ++announcements } });
  const jobOf = (id: string): Job | undefined => state.queue.jobs.find((job) => job.id === id) ?? state.queue.history.find((job) => job.id === id);
  const active = () => state.queue.jobs.some((job) => job.target === "device" && (job.state === "running" || job.state === "paused"));
  guardExport(active);
  onTabHidden((hidden) => { if (state.backgroundNotice !== (hidden && active())) set({ backgroundNotice: hidden && active() }); });

  async function snapshotOf(job: Job): Promise<ProjectDocument | null> {
    return snapshots.get(job.id) ?? (await storage?.getSession<ProjectDocument>(snapshotKey(job.id)).catch(() => undefined)) ?? null;
  }
  function forget(jobId: string): void {
    snapshots.delete(jobId); files.delete(jobId); folders.delete(jobId); covers.delete(jobId); playheads.delete(jobId); watched.delete(jobId);
    void storage?.deleteSession(snapshotKey(jobId)).catch(() => undefined);
  }

  // ---- engines --------------------------------------------------------------------------------------------------------

  /** An engine of the job's own, for a project no editor has open: it mounts off-screen and goes when the job ends. */
  async function headless(job: Job, document: ProjectDocument): Promise<{ engine: PreviewEngine; close(): Promise<void> } | null> {
    if (!storage) return null;
    const host = hiddenHost(), store = storage;
    const controller = createEditorController({ document, newId: () => uuidV4(), platform: "web", prefs: () => getPref(EDITOR_PREFS.timeline), readOnly: "Read-only" });
    const media = createMediaSession({ storage: store, projectId: job.projectId, document: () => controller.stored, context: () => ({ now_ms: Date.now(), newId: () => uuidV4() }), commit: () => undefined, rollback: () => undefined, setDocument: () => undefined, flush: async () => undefined, hostConnected: () => false });
    const runtime = createEditorRuntime({ controller, media, luts: createLutStore(store, job.projectId), prefs: { get: getPref, set: () => undefined } as never, toast: () => undefined, t: (value) => value });
    const close = async () => { runtime.close(); controller.close(); await media.close().catch(() => undefined); host.remove(); };
    const { width, height } = document.settings.canvasSize;
    const engine = await openPreviewEngine(host.element, { width: Math.min(640, width), height: Math.min(360, height), devicePixelRatio: 1, locale: "en", offlineTile: { fill: "#202020", hatch: "#303030", offlineLabel: "Media offline", unsupportedLabel: "Unsupported media" } }, // content-colour
      { onState: () => undefined, onTime: () => undefined, onTransport: () => undefined, onEnded: () => undefined, onFrame: () => undefined }).catch(() => null);
    if (!engine) { await close(); return null; }
    runtime.attachEngine(engine);
    // The engine draws a clip only once it knows where the clip's media is: the sources and the faces go first.
    const sources = await Promise.all(document.media.assets.map(async (asset) => ({ assetId: asset.id, original: (await media.mediaUrl(asset.id).catch(() => null)) ?? undefined })));
    await engine.setSources(sources.filter((source) => source.original !== undefined) as { assetId: string; original: string }[]);
    await engine.setFonts(engineFontSources(BUNDLED_FACES, documentTexts(document)));
    return { engine, close: async () => { runtime.attachEngine(null); engine.dispose(); await close(); } };
  }

  // ---- the request of a job -------------------------------------------------------------------------------------------

  function metadataOf(job: Job, document: ProjectDocument, cover: string | null): Record<string, unknown> {
    const scene = timeline.sceneById(document, job.sceneId);
    const source = exporting.digitalSourceType(timeline.elementsOfScene(scene) as never, document.media.assets as never, job.range), version = appVersion(), s = job.settings;
    const xmp = exporting.xmpPacket(source, version);
    if (s.type === "gif" || s.type === "image-sequence") return { xmp };
    if (s.type === "audio") return { comment: exporting.provenanceComment(source, version), ...(cover ? { cover } : {}) };
    if (s.container === "webm") return { tags: exporting.provenanceTags(source, version) };
    return { ...(cover ? { cover } : {}) };
  }
  function hasAiMedia(job: Job, document: ProjectDocument): boolean {
    return exporting.digitalSourceType(timeline.elementsOfScene(timeline.sceneById(document, job.sceneId)) as never, document.media.assets as never, job.range) !== null;
  }
  async function coverOf(job: Job, document: ProjectDocument): Promise<string | null> {
    if (!job.settings.embedCover || !exporting.coverSupported(job.settings) || !document.cover || !storage) return null;
    const mime = document.cover.image.mime, bytes = await storage.getBlob("cover", job.projectId, mime === "image/png" ? "cover.png" : "cover.jpg").catch(() => undefined);
    const jpeg = bytes ? await toJpeg(bytes, mime, 1280, 0.9) : null;
    return jpeg ? toBase64(jpeg) : null;
  }
  /** The `export.start` payload of a video, GIF, image-sequence or audio job. */
  function startPayload(job: Job, document: ProjectDocument, exportId: string, cover: string | null, palette: string | null, acceleration: Settings["hardwareAcceleration"]): Record<string, unknown> {
    const s = job.settings, canvas = document.settings.canvasSize, fps = document.settings.fps, whole = timeline.sceneDurationOf(timeline.sceneById(document, job.sceneId));
    const ranged = job.range.start > 0 || job.range.end < whole;
    const label = s.aiLabel && hasAiMedia(job, document) ? { aiLabel: { text: exporting.AI_LABEL_TEXT, fontFamily: "Inter, sans-serif" } } : {};
    const common = { exportId, sceneId: job.sceneId, ...(ranged ? { range: job.range } : {}), allowMissingMedia: job.waivers?.allowMissingMedia === true, ...(job.waivers?.allowMissingMedia === true ? { waivedAssetIds: job.waivedAssetIds ?? [] } : {}), allowFontFallback: job.waivers?.allowFontFallback === true, metadata: metadataOf(job, document, cover) };
    if (s.type === "gif") {
      const size = exporting.gifSize(canvas, s.gif.shortSide);
      return { ...common, ...label, ...size, frameRate: { numerator: s.gif.frameRate, denominator: 1 }, container: "gif", video: { codec: "avc" }, gif: { loop: s.gif.loop, dither: s.gif.dither, ...(palette ? { palette } : {}) }, includeCaptions: s.burnCaptions };
    }
    const size = exporting.outputSize(s, canvas), frameRate = exporting.outputFrameRate(s, fps);
    if (s.type === "image-sequence") return { ...common, ...label, ...size, frameRate, container: "image-sequence", video: { codec: "avc", alpha: s.includeTransparency && s.imageSequence.format === "png" }, image: { format: s.imageSequence.format, quality: Math.round(s.imageSequence.quality) }, includeCaptions: s.burnCaptions };
    if (s.type === "audio") {
      const { format, bitrateKbps, bitDepth } = s.audioOnly;
      const audio = format === "wav" ? { codec: "pcm", bitDepth } : format === "flac" ? { codec: "flac" } : { codec: "aac", bitrate: bitrateKbps * 1000 };
      return { ...common, width: 16, height: 16, frameRate: fps, container: format === "wav" ? "wav" : format === "flac" ? "flac" : "mp4", audio: { ...audio, sampleRate: s.sampleRate, channels: s.channels } };
    }
    const mbps = exporting.videoBitrateMbps(s, size, exporting.rateValue(frameRate));
    return {
      ...common, ...label, ...size, frameRate, container: s.container, includeCaptions: s.burnCaptions,
      video: { codec: engineCodec[s.videoCodec as exporting.VideoCodec], bitrate: Math.round(mbps * 1_000_000), bitrateMode: s.rateControl === "cbr" ? "constant" : "variable", hardwareAcceleration: acceleration === "auto" ? "no-preference" : acceleration },
      ...(s.includeAudio ? { audio: { codec: s.audioCodec, sampleRate: s.sampleRate, channels: s.channels, ...(s.audioCodec === "pcm" ? {} : { bitrate: s.audioBitrateKbps * 1000 }) } } : {}),
    };
  }
  /** One palette for the whole GIF, from frames sampled across the range. */
  async function globalPalette(job: Job, engine: PreviewEngine, document: ProjectDocument): Promise<string | null> {
    const size = exporting.gifSize(document.settings.canvasSize, job.settings.gif.shortSide), histogram = newHistogram(), samples = Math.min(12, Math.max(1, job.frameCount));
    for (let index = 0; index < samples; index++) {
      const time = job.range.start + Math.floor(((job.range.end - job.range.start) * index) / samples);
      const bytes = await engine.still(time, "png", job.sceneId, size), pixels = bytes ? await decodeRgba(bytes, "image/png") : null;
      if (pixels) addToHistogram(histogram, pixels.rgba, 2);
    }
    return toBase64(buildPalette(histogram));
  }
  function captionFiles(job: Job, document: ProjectDocument, outputName: string): { name: string; text: string }[] {
    const tracks = captionTracksOf(document, job.sceneId).map((track) => ({ id: track.id, language: (track as { caption?: { language?: string } }).caption?.language, cues: captionCues(track) }));
    const toMs = (ticks: number) => Math.round((ticks * 1000) / exporting.TICKS_PER_SECOND);
    return exporting.sidecarFiles(tracks, job.settings, outputName, { start_ms: toMs(job.range.start), end_ms: toMs(job.range.end) });
  }
  /** A small file written beside the output: into the chosen folder, or as a download of its own. */
  async function beside(job: Job, name: string, bytes: Uint8Array, mime: string): Promise<void> {
    const folder = folders.get(job.id);
    if (folder) await writeIntoFolder(folder, name, bytes); else download(new Blob([bytes as unknown as BlobPart], { type: mime }), name);
  }
  async function extras(job: Job, document: ProjectDocument, outputName: string): Promise<void> {
    const s = job.settings;
    if (s.type === "video" && s.sidecar.enabled) for (const file of captionFiles(job, document, outputName)) await beside(job, file.name, text(file.text), "text/plain");
    if (s.creditsFile) {
      const scene = timeline.sceneById(document, job.sceneId), used = new Set(timeline.elementsOfScene(scene).filter((element) => element.startTime < job.range.end && element.startTime + element.duration > job.range.start).map((element) => (element as { mediaId?: string }).mediaId));
      const credits = exporting.creditsFile(document.media.assets.filter((asset) => used.has(asset.id)) as never);
      if (credits) await beside(job, exporting.creditsFileName(outputName), text(credits), "text/plain");
    }
    if (covers.get(job.id) && document.cover && storage) {
      const mime = document.cover.image.mime, bytes = await storage.getBlob("cover", job.projectId, mime === "image/png" ? "cover.png" : "cover.jpg").catch(() => undefined);
      const jpeg = bytes ? await toJpeg(bytes, mime, 1920, 0.9) : null;
      if (jpeg) await beside(job, exporting.coverFileName(outputName), jpeg, "image/jpeg");
    }
  }

  // ---- running a job --------------------------------------------------------------------------------------------------

  type Done = { output: exporting.JobOutput; summary: exporting.ExportSummary };
  const summaryOf = (job: Job, document: ProjectDocument, fallbackFonts: string[], software: boolean): exporting.ExportSummary => {
    const scene = timeline.sceneById(document, job.sceneId), slateIds = new Set(document.media.assets.filter((asset) => asset.kind === "slate").map((asset) => asset.id));
    const slates = timeline.elementsOfScene(scene).filter((element) => slateIds.has((element as { mediaId?: string }).mediaId ?? "")).length;
    return {
      ...(fallbackFonts.length ? { fontsReplaced: fallbackFonts } : {}), ...(job.waivers?.allowSlates && slates ? { slatesExported: slates } : {}), ...(software ? { softwareEncoding: true } : {}),
      ...(job.settings.aiLabel && hasAiMedia(job, document) ? { aiLabel: true } : {}), ...(job.notice === exporting.H264_AAC_NOTICE ? { codecFallback: "VP9 with Opus as WebM" } : {}),
    };
  };
  async function writeAll(job: Job, name: string, bytes: Uint8Array, mime: string): Promise<exporting.JobOutput> {
    const handle = files.get(job.id), folder = folders.get(job.id);
    if (folder) { await writeIntoFolder(folder, name, bytes); return { fileName: name, mime, size: bytes.length, location: "chosen-folder" }; }
    const privateName = `${job.id}.${name.split(".").pop()}`, output = await openOutput(handle ? { handle } : { privateName });
    try { await output.write(bytes, 0); await output.close(); } catch (error) { await output.abort(); throw error; }
    if (handle) return { fileName: handle.name, mime, size: bytes.length, location: "chosen-file" };
    const file = await privateFile(privateName);
    if (file) download(new File([file], name, { type: mime }), name);
    return { fileName: name, mime, size: bytes.length, location: "downloads", privateName };
  }
  async function runStill(job: Job, engine: PreviewEngine, document: ProjectDocument): Promise<Done> {
    const s = job.settings, size = exporting.outputSize(s, document.settings.canvasSize), requestId = `still-${job.id}`, { port } = engine;
    update(job.id, { stage: "Rendering", percent: 5 });
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const done = port.on("still.done", (payload, transfer) => { if (payload.requestId !== requestId) return; done(); failed(); if (transfer?.[0]) resolve(new Uint8Array(transfer[0])); else reject(Object.assign(new Error("no picture was rendered"), { code: "export/encoder-error" })); });
      const failed = port.on("still.failed", (payload) => { if (payload.requestId !== requestId) return; done(); failed(); reject(Object.assign(new Error(payload.message), { code: payload.code })); });
      port.command("still.render", { requestId, time: Math.max(0, Math.round(playheads.get(job.id) ?? 0)), format: s.still.format, quality: Math.round(s.still.quality), source: "original", sceneId: job.sceneId, width: size.width, height: size.height, includeCaptions: s.burnCaptions, allowMissingMedia: job.waivers?.allowMissingMedia === true })
        .catch((error) => { done(); failed(); reject(error); });
    });
    const scene = timeline.sceneById(document, job.sceneId), xmp = exporting.xmpPacket(exporting.digitalSourceType(timeline.elementsOfScene(scene) as never, document.media.assets as never, job.range), appVersion());
    const tagged = s.still.format === "png" ? pngWithXmp(bytes, xmp) : jpegWithXmp(bytes, xmp);
    update(job.id, { stage: "Finalising", percent: 98 });
    return { output: await writeAll(job, job.fileName, tagged, exporting.mimeOf(s)), summary: summaryOf(job, document, [], false) };
  }
  async function runCaptions(job: Job, document: ProjectDocument): Promise<Done> {
    const list = captionFiles(job, document, job.fileName);
    if (list.length === 0) throw Object.assign(new Error(exporting.NO_CAPTIONS_MESSAGE), { code: "export/empty" });
    let size = 0;
    for (const file of list) { const bytes = text(file.text); size += bytes.length; await beside(job, file.name, bytes, "text/plain"); }
    return { output: { fileName: list[0].name, mime: "text/plain", size, location: folders.get(job.id) ? "chosen-folder" : "downloads", files: list.length }, summary: {} };
  }
  /** A video, GIF, image-sequence or audio job: `export.start`, the chunks to storage as they arrive, the events to the job. */
  function runEngineExport(job: Job, engine: PreviewEngine, document: ProjectDocument, run: Run, payload: Record<string, unknown>, software: boolean): Promise<Done> {
    const { port } = engine, s = job.settings, exportId = payload.exportId as string, sequence = s.type === "image-sequence", folder = folders.get(job.id), handle = files.get(job.id);
    const outputName = sequence && !folder ? exporting.sequenceZipName(job.fileName.replace(/\.[a-z0-9]+$/i, "")) : job.fileName, base = job.fileName.replace(/\.[a-z0-9]+$/i, "");
    const privateName = `${job.id}.${outputName.split(".").pop()}`;
    let output: Output | null = null, opening: Promise<Output> | null = null, chain: Promise<unknown> = Promise.resolve(), writeError: unknown = null, bytesWritten = 0, frameIndex = 0, zipOffset = 0;
    const samples: exporting.EtaSample[] = [];
    let renderingSince: number | null = null;
    const open = () => (opening ??= openOutput(handle ? { handle } : { privateName }).then((opened) => (output = opened)));
    const zip = sequence && !folder ? createZipWriter({ write: async (chunk) => { const at = zipOffset; zipOffset += chunk.length; await (await open()).write(chunk.slice(), at); } }) : null;
    const stops: (() => void)[] = [];
    run.exportId = exportId; run.port = port;
    return new Promise<Done>((resolve, reject) => {
      const detach = () => { for (const stop of stops.splice(0)) stop(); };
      const discardNow = () => {
        if (output) void output.abort().catch(() => undefined);
        else if (opening) void opening.then((opened) => opened.abort()).catch(() => undefined);
      };
      const watchdog = createFinalisingWatchdog(() => {
        if (run.exportId === exportId) void port.command("export.cancel", { exportId }).catch(() => undefined);
        finish(() => {
          discardNow();
          reject(Object.assign(new Error("Export finalising did not make progress for 60 seconds. Retry the export."), { code: "export/finalising-timeout" }));
        });
      });
      const finish = (work: () => void) => { watchdog.clear(); detach(); run.exportId = null; work(); };
      run.abandon = () => finish(() => { discardNow(); reject(RESTART); });
      // Cancel must work at every stage, also while the file is being finalised or saved: the run ends at once and the
      // partial output is aborted without waiting for writes that may never complete.
      run.hardStop = () => finish(() => { discardNow(); reject(Object.assign(new Error("the export was cancelled"), { cancelled: true })); });
      stops.push(port.on("export.chunk", (chunk, transfer) => {
        if (chunk.exportId !== exportId || !transfer?.[0]) return;
        const data = new Uint8Array(transfer[0]);
        bytesWritten = Math.max(bytesWritten, (chunk.position ?? 0) + data.length);
        if (sequence) {
          const name = exporting.sequenceFrameName(base, frameIndex++, s.imageSequence.format);
          chain = chain.then(async () => { if (folder) await writeIntoFolder(folder, name, data); else await zip!.add(name, data); }).catch((error) => { writeError ??= error; });
        } else chain = chain.then(async () => (await open()).write(data, chunk.position ?? 0)).catch((error) => { writeError ??= error; });
        // A write that failed ends the export: nothing more is rendered into a file that cannot be written.
        if (writeError && !run.cancelled) { run.cancelled = true; void port.command("export.cancel", { exportId }).catch(() => undefined); }
      }));
      stops.push(port.on("export.progress", (progress) => {
        if (progress.exportId !== exportId) return;
        const current = jobOf(job.id);
        if (!current) return;
        if (progress.stage === "paused") { if (current.state !== "paused") update(job.id, { state: "paused" }); return; }
        const stage = STAGE[progress.stage] ?? "Rendering", now = Date.now();
        if (stage !== (current.stage as string)) console.info(`[export] ${exportId} stage ${stage} frames ${progress.framesDone}/${progress.frameCount} at ${now - (current.started_ms ?? now)} ms`);
        if (stage === "Finalising") watchdog.reset();
        if (stage === "Rendering") { renderingSince ??= now; samples.push({ at_ms: now, frames: progress.framesDone }); }
        const percent = exporting.advancePercent(current.percent, exporting.stagePercent(stage, progress.framesDone, progress.frameCount));
        const line = exporting.progressAnnouncement(current.percent, percent);
        update(job.id, {
          state: "running", stage, percent, framesDone: progress.framesDone, frameCount: progress.frameCount || current.frameCount, elapsed_ms: now - (current.started_ms ?? now) - run.pausedTotal,
          eta_ms: stage === "Rendering" && renderingSince !== null ? exporting.estimateRemaining(samples, progress.frameCount, renderingSince, now) : null,
        });
        if (line) announce(line);
      }));
      stops.push(port.on("export.done", (done) => {
        if (done.exportId !== exportId) return;
        console.info(`[export] ${exportId} done from engine: ${done.frameCount} frames, ${done.bytes} bytes; ${bytesWritten} bytes received`);
        detach();
        run.exportId = null;
        watchdog.reset();
        void (async () => {
          try {
            await chain;
            if (writeError) throw writeError;
            let location: exporting.JobOutput["location"] = "downloads", size = bytesWritten, fileName = outputName;
            if (sequence && folder) location = "chosen-folder";
            else {
              if (zip) { await zip.finish(); await chain; }
              console.info(`[export] ${exportId} writes settled (${bytesWritten} bytes); opening output`);
              const opened = await open();
              console.info(`[export] ${exportId} output open`);
              // XMP of MP4 and MOV: a top-level box after the finalised file.
              if (s.type === "video" && s.container !== "webm") { const box = xmpUuidBox(exporting.xmpPacket(exporting.digitalSourceType(timeline.elementsOfScene(timeline.sceneById(document, job.sceneId)) as never, document.media.assets as never, job.range), appVersion())); await opened.write(box, bytesWritten); }
              update(job.id, { stage: exportPlatform === "mobile" ? "Saving" : "Finalising", percent: exporting.advancePercent(jobOf(job.id)?.percent ?? 98, 99) });
              size = await opened.close();
              console.info(`[export] ${exportId} file closed: ${size} bytes`);
              if (handle) { location = "chosen-file"; fileName = handle.name; }
              else { const file = await privateFile(privateName); if (file) download(new File([file], outputName, { type: zip ? "application/zip" : exporting.mimeOf(s) }), outputName); }
            }
            await extras(job, document, job.fileName).catch(() => undefined);
            watchdog.clear();
            resolve({
              output: { fileName, mime: zip ? "application/zip" : exporting.mimeOf(s), size, location, ...(sequence ? { files: frameIndex } : {}), ...(!handle && !(sequence && folder) ? { privateName } : {}) },
              summary: summaryOf(job, document, done.fallbackFonts ?? [], software),
            });
          } catch (error) { console.error(`[export] ${exportId} writing the file failed: ${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? String(error)}`); watchdog.clear(); discardNow(); reject(failureWithCode(error, "export/write-failed")); }
        })();
      }));
      stops.push(port.on("export.failed", (failure) => {
        if (failure.exportId !== exportId) return;
        console.error(`[export] ${exportId} failed in engine: ${failure.code} ${failure.message}`);
        finish(() => { discardNow(); reject(Object.assign(new Error(failure.message), { code: writeError ? "export/write-failed" : failure.code, cancelled: !writeError && (run.cancelled || failure.details?.cancelled === true), details: failure.details })); });
      }));
      port.command("export.start", payload as never).catch((error) => finish(() => { discardNow(); reject(error); }));
    });
  }
  async function runWithEngine(job: Job, engine: PreviewEngine, document: ProjectDocument, run: Run): Promise<Done> {
    if (job.settings.type === "still") return engine.withDocument(document, job.sceneId, () => runStill(job, engine, document));
    const cover = await coverOf(job, document);
    const attempt = (acceleration: Settings["hardwareAcceleration"], software: boolean) => {
      const exportId = `export-${job.id.slice(0, 8)}-${Date.now().toString(36)}`;
      let started: Promise<Done> | null = null;
      // The engine copies the document when the export starts: the editor's own document is back as soon as it has.
      return engine.withDocument(document, job.sceneId, async () => {
        const palette = job.settings.type === "gif" && job.settings.gif.palette === "global" ? await globalPalette(job, engine, document) : null;
        started = runEngineExport(job, engine, document, run, startPayload(job, document, exportId, cover, palette, acceleration), software);
        started.catch(() => undefined);
        // `export.start` is taken synchronously by the same-thread surface; one turn lets its reply settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }).then(() => started!);
    };
    try { return await attempt(job.settings.hardwareAcceleration, false); }
    catch (error) {
      const failure = error as { code?: string; message?: string; cancelled?: boolean };
      const encoder = error !== RESTART && !failure.cancelled && job.settings.type === "video" && /encod|codec/i.test(failure.message ?? "") && failure.code !== "engine/encoder-unavailable";
      const retry = encoder ? exporting.encoderRetry({ hardwareAcceleration: job.settings.hardwareAcceleration, retried: false }) : null;
      if (!retry?.retry) throw encoder ? failureWithCode(error, "export/encoder-error") : error;
      // A hardware encoder that threw: once more from frame 0 with software encoding and the same codec.
      update(job.id, { notice: retry.notice, softwareRetry: true, framesDone: 0 });
      try { return await attempt("prefer-software", true); } catch (second) { throw second === RESTART ? second : Object.assign(second as Error, { code: (second as { cancelled?: boolean }).cancelled ? (second as { code?: string }).code : "export/encoder-error" }); }
    }
  }
  function failureOf(error: unknown, job: Job): exporting.ExportFailure {
    const raw = error as { code?: string; message?: string; details?: Record<string, unknown> };
    const memory = /out of memory|allocation failed/i.test(raw.message ?? "");
    const code = memory ? "export/out-of-memory" : exporting.exportCodeOf(raw.code && raw.code.includes("/") ? raw.code : "export/write-failed");
    return { code, message: raw.message ?? exporting.EXPORT_ERROR_MESSAGES[code], stage: job.stage, frameIndex: job.framesDone, details: raw.details };
  }
  async function execute(job: Job): Promise<void> {
    const run: Run = running = { jobId: job.id, exportId: null, editor: null, abandon: () => undefined, port: null, cancelled: false, pausedAt: null, pausedTotal: 0 };
    update(job.id, { state: "running", stage: "Preparing", percent: 0, framesDone: 0, started_ms: Date.now(), elapsed_ms: 0, eta_ms: null });
    const document = await snapshotOf(job);
    let own: Awaited<ReturnType<typeof headless>> = null;
    try {
      if (!document) throw Object.assign(new Error("The snapshot of this export is no longer on this device"), { code: "export/interrupted" });
      let done: Done;
      if (job.settings.type === "captions") done = await runCaptions(job, document);
      else {
        const editor = editors.get(job.projectId);
        // The editor of this project is open: its engine is the one the page has, also while it is still starting.
        for (let waited = 0; editor && editors.get(job.projectId) === editor && !editor.engine() && waited < 20_000; waited += 200) await new Promise((resolve) => setTimeout(resolve, 200));
        let engine = editors.get(job.projectId) === editor ? editor?.engine() ?? null : null;
        if (engine) run.editor = editor!;
        else { own = await headless(job, document); engine = own?.engine ?? null; }
        if (!engine) throw Object.assign(new Error("This device cannot render the export"), { code: "export/no-gpu" });
        done = await runWithEngine(job, engine, document, run);
      }
      const now = Date.now(), current = jobOf(job.id) ?? job;
      setQueue(exporting.finishJob(state.queue, job.id, { state: "succeeded", stage: "Finalising", finished_ms: now, elapsed_ms: now - (current.started_ms ?? now) - run.pausedTotal, output: done.output, summary: done.summary }));
      announce({ text: "Export finished" });
      if (!watched.has(job.id)) notifications.add({ kind: "success", category: "finished", message: `Export finished: ${done.output.fileName}`, route: `/exports/history?job=${job.id}` });
      forget(job.id);
    } catch (error) {
      if (error === RESTART) {
        // The editor that lent its engine closed: the job starts again from frame 0 on an engine of its own.
        update(job.id, { state: "queued", stage: "Preparing", framesDone: 0, eta_ms: null, detail: "Restarted after the editor closed" });
        // The closed editor's engine is disposed first: the page has one GPU context.
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else if ((error as { cancelled?: boolean }).cancelled || run.cancelled && !(error as { code?: string }).code?.includes("write")) {
        setQueue(exporting.cancelJob(state.queue, job.id, Date.now()));
        forget(job.id);
      } else {
        // The clip or file the engine names by id only is named from the exported document (`namedFailure`).
        const failure = exporting.namedFailure(failureOf(error, jobOf(job.id) ?? job), document as Parameters<typeof exporting.namedFailure>[1]);
        setQueue(exporting.finishJob(state.queue, job.id, { state: "failed", finished_ms: Date.now(), error: failure }));
        announce({ text: "Export failed" });
        if (!watched.has(job.id)) notifications.add({ kind: "error", category: "finished", message: `Export failed: ${job.fileName}`, route: `/exports/history?job=${job.id}` });
      }
    } finally {
      await own?.close().catch(() => undefined);
      if (running === run) running = null;
      if (state.backgroundNotice && !active()) set({ backgroundNotice: false });
    }
  }
  async function pump(): Promise<void> {
    if (pumping || !state.ready) return;
    pumping = true;
    try {
      for (let job = exporting.nextToRun(state.queue); job; job = exporting.nextToRun(state.queue)) {
        // An engine of the job's own cannot start while the editor of another project holds the page's GPU context.
        if (job.settings.type !== "captions" && !editors.has(job.projectId) && editors.size > 0) { update(job.id, { detail: "Starts when the open project is closed" }); break; }
        await execute(job);
      }
    } finally { pumping = false; }
  }

  return {
    getState: (): ServiceState => state,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    /** Reads the stored queue: queued jobs keep their place, a job that was running or paused is `failed` with `export/interrupted`. */
    async open(port: StoragePort): Promise<void> {
      if (storage === port) return;
      storage = port;
      const stored = await port.getSession<unknown>(QUEUE_KEY).catch(() => undefined);
      const restored = exporting.restoreQueue(exporting.isQueue(stored) ? stored : exporting.EMPTY_QUEUE, Date.now());
      // Private copies of earlier sessions were handed to the browser's download: none of them is kept.
      await cleanPrivate(new Set());
      const history = restored.history.map((job) => (job.output?.privateName ? { ...job, output: { ...job.output, privateName: undefined } } : job));
      set({ queue: { jobs: restored.jobs, history }, ready: true });
      persist();
      void pump();
    },
    /** The editor of a project lends its engine to the jobs of that project while it is open. */
    attachEditor(editor: Editor): () => void {
      editors.set(editor.projectId, editor);
      void pump();
      return () => {
        if (editors.get(editor.projectId) !== editor) return;
        editors.delete(editor.projectId);
        if (running?.editor === editor) running.abandon("editor-closed");
        // The engine of the closed editor is disposed before one of the job's own can start.
        setTimeout(() => void pump(), 600);
      };
    },
    /** Adds a job for an on-device export. Refused beyond 20 unfinished jobs. */
    start(request: ExportRequest): { ok: true; job: Job } | { ok: false; code: "export/queue-full"; message: string } {
      const { document, settings, sceneId } = request, scene = timeline.sceneById(document, sceneId), whole = timeline.sceneDurationOf(scene), canvas = document.settings.canvasSize, fps = document.settings.fps;
      const rate = settings.type === "gif" ? { numerator: settings.gif.frameRate, denominator: 1 } : exporting.outputFrameRate(settings, fps);
      const range = exporting.exportRange(settings, scene, whole, rate), id = uuidV4();
      const job: Job = {
        id, projectId: document.metadata.id, projectName: document.metadata.name, type: settings.type, settings, settingsSummary: exporting.settingsSummary(settings, canvas, fps), fileName: request.fileName, target: "device",
        state: "queued", stage: "Preparing", percent: 0, framesDone: 0, frameCount: settings.type === "audio" || settings.type === "captions" ? 0 : settings.type === "still" ? 1 : range.frames,
        duration: settings.type === "still" ? 0 : range.end - range.start, range: { start: range.start, end: range.end }, sceneId, created_ms: Date.now(), elapsed_ms: 0, waivers: request.waivers, ...(request.waivedAssetIds ? { waivedAssetIds: request.waivedAssetIds } : {}),
        ...(request.notice ? { notice: request.notice } : {}),
      };
      const added = exporting.enqueue(state.queue, job);
      if (!added.ok) return added;
      const snapshot = JSON.parse(JSON.stringify(document)) as ProjectDocument;
      snapshots.set(id, snapshot); playheads.set(id, request.playhead);
      if (request.file) files.set(id, request.file);
      if (request.folder) folders.set(id, request.folder);
      if (request.saveCover) covers.set(id, true);
      void storage?.putSession(snapshotKey(id), snapshot).catch(() => undefined);
      setQueue(added.queue);
      void pump();
      return { ok: true, job: { ...job, state: "queued" } };
    },
    /** Records a host job that could not be created (or its outcome) in the history of this device. */
    recordFailure(job: Job): void { setQueue(exporting.recordHistory(state.queue, job)); },
    /** Stops a running job within the frame in flight and deletes what it wrote; a queued job just leaves the queue. */
    cancel(id: string): void {
      const job = state.queue.jobs.find((entry) => entry.id === id);
      if (!job) return;
      if (job.state === "queued" || running?.jobId !== id) { setQueue(exporting.cancelJob(state.queue, id, Date.now())); forget(id); void pump(); return; }
      running.cancelled = true;
      // Frames done (finalising or saving), or the engine not answering: end the run here within two seconds at most.
      const stopping = running, exportId = stopping.exportId, port = stopping.port;
      const finalStage = job.stage === "Finalising" || job.stage === "Saving";
      if (finalStage || !exportId) {
        stopping.hardStop?.();
        if (exportId && port) void port.command("export.cancel", { exportId }).catch(() => undefined);
      } else {
        if (port) void port.command("export.cancel", { exportId }).catch(() => undefined);
        setTimeout(() => { if (running === stopping) stopping.hardStop?.(); }, 2000);
      }
    },
    /** Pause takes effect after the frame in flight and keeps the encoders and the partial file open; it has no time limit. */
    pause(id: string): void {
      if (running?.jobId !== id || !running.exportId || !running.port || running.pausedAt !== null) return;
      const pausing = state.queue.jobs.find((entry) => entry.id === id);
      if (pausing && (pausing.stage === "Finalising" || pausing.stage === "Saving")) return;
      running.pausedAt = Date.now();
      void running.port.command("export.pause", { exportId: running.exportId }).catch(() => undefined);
      update(id, { state: "paused", eta_ms: null });
    },
    resume(id: string): void {
      if (running?.jobId !== id || !running.exportId || !running.port || running.pausedAt === null) return;
      running.pausedTotal += Date.now() - running.pausedAt; running.pausedAt = null;
      void running.port.command("export.resume", { exportId: running.exportId }).catch(() => undefined);
      update(id, { state: "running" });
    },
    move(id: string, direction: -1 | 1): void { setQueue(exporting.moveJob(state.queue, id, direction)); },
    reorder(id: string, index: number): void { setQueue(exporting.reorderJob(state.queue, id, index)); },
    /** Removes an entry from the history, and with `deleteFile` the copy this app still holds. */
    remove(id: string, deleteFile: boolean): void {
      const job = state.queue.history.find((entry) => entry.id === id);
      if (deleteFile && job?.output?.privateName) void deletePrivate(job.output.privateName);
      setQueue(exporting.removeFromHistory(state.queue, id));
      forget(id);
    },
    /** "Retry with the same snapshot": a new job over what the failed one rendered. `null` when the snapshot is gone. */
    async retrySameSnapshot(id: string): Promise<Job | null> {
      const job = state.queue.history.find((entry) => entry.id === id), document = job ? await snapshotOf(job) : null;
      if (!job || !document) return null;
      const result = this.start({ document, sceneId: job.sceneId, settings: job.settings, fileName: job.fileName, playhead: playheads.get(id) ?? 0, waivers: job.waivers, waivedAssetIds: job.waivedAssetIds });
      return result.ok ? result.job : null;
    },
    /** The copy of a finished output this app still holds, for "Download" and "Share…". */
    async file(id: string): Promise<File | null> {
      const job = jobOf(id), name = job?.output?.privateName;
      const file = name ? await privateFile(name) : null;
      if (job && name && !file) setQueue({ ...state.queue, history: state.queue.history.map((entry) => (entry.id === id ? { ...entry, fileMissing: true } : entry)) });
      return file && job?.output ? new File([file], job.output.fileName, { type: job.output.mime }) : null;
    },
    watch(id: string, on: boolean): void { if (on) watched.add(id); else watched.delete(id); },
    job: jobOf,
    setHostJobs(jobs: Job[]): void { set({ hostJobs: jobs }); },
    badge: (): number => exporting.badgeCount(state.queue.jobs, state.hostJobs),
    isActive: active,
  };
}
export const exportService = createExportService();
export type ExportService = typeof exportService;
