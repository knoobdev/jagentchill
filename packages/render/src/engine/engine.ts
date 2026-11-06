import { applyPatch, DocumentRejected, effectDefinition, floorToFrame, frameDuration, lastFrameTime, mediaTimeToFrame, mediaTimeToSeconds, sceneDuration, type PatchEntry } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type EngineError, type EngineCommandParsed, type EngineEventPayload, type EngineEventType, type EngineReady, type ProjectDocument } from "@jagentchill/protocol";
import { collectMixClips, mixdownBlocks } from "../audio/mixdown.ts";
import { AudioSourceError, AudioSources } from "../audio/source.ts";
import { mediaWaived } from "./waiver.ts";
import { LiveAudio } from "../audio/live.ts";
import { SESSION_LIMITS, SessionPool } from "../decode/video-session.ts";
import { checkExportRequest, createExportWriter, exportFrameCount, exportFrameTime, finalizeOrCancel } from "../export/session.ts";
import { blendAiLabel, rasterAiLabel } from "../export/metadata.ts";
import { buildFrame, emojiText, type BuiltFrame, type TextureRequest } from "../frame/build.ts";
import { curvesPixels, parseCube } from "../frame/color.ts";
import { layerItem, type FrameItem, type LayerItem } from "../frame/descriptor.ts";
import { quadBounds, type Size } from "../resolve/layout.ts";
import type { SceneDiagnostic } from "../scene/build.ts";
import type { CommandHandlers } from "../surface/dispatcher.ts";
import { EngineFailure } from "../surface/errors.ts";
import { ByteLru } from "../textures/lru.ts";
import { rasterDrawing, rasterGraphic, rasterMask, rasterOfflineTile } from "../textures/raster.ts";
import { straightBitmap } from "../textures/straight.ts";
import { AnimatedImage } from "../textures/animated.ts";
import { parseGradient, rasterGradient } from "../scene/gradient.ts";
import { FontRegistry } from "../text/fonts.ts";
import { DEFAULT_TEXT_LIMIT, measureText, type MeasuredText, type TextLimit, type TextSpec } from "../text/layout.ts";
import { rasterText } from "../text/raster.ts";
import { filterCube } from "../frame/recipe.ts";
import { loadWasm, reloadWasm, type Wasm } from "./wasm.ts";
import { legacyPersonMatteKey, personMatteAssets, personMatteKey } from "../export/person-matte.ts";
import { cachedProbeResult, PROBE_DELAY_MS, probeVerdict, storeProbeResult, type ProbeResult } from "./deferred-probes.ts";
import { EngineSurfacePort } from "../surface/port.ts";
import { CompositorDriver, type ResolvedTexture } from "./compositor.ts";
import { missingCapabilities, POOL_BUDGETS, probeRuntime } from "./probe.ts";
import { previewRenderSize, QualityGovernor, type QualityLevel } from "./quality.ts";

export type EngineOptions = {
  /** Sends an event to the app side of the surface. */
  emit: <T extends EngineEventType>(type: T, payload: EngineEventPayload<T>, transfer?: ArrayBuffer[]) => void;
  /** The DOM element the compositor canvas is mounted in (same-thread and mobile surfaces). */
  host?: HTMLElement;
  /** Where the wasm binary is served from; by default next to the engine bundle. */
  wasmUrl?: string | URL;
  surface?: EngineReady["surface"];
  now?: () => number;
  /**
   * Creates the worker an export session runs in (`surface/export-worker.ts` bundled as a worker script). With it
   * an export has its own compositor, caches and decoders and the preview stays interactive; without it (mobile)
   * the export renders on the preview's compositor while the preview is suspended.
   */
  exportWorker?: () => Worker;
  /** URL of the bundled decode-probe clip; without it only the encode probe runs. */
  probeClipUrl?: string;
};

type MediaSource = { original?: string; proxy?: string; mezzanine?: string };
type RenderRequest = {
  time: number; exact: boolean; size: Size; quality: "preview" | "export"; sceneId: string;
  committedOnly?: boolean; includeCaptions?: boolean; original?: boolean; allowMissingMedia?: boolean; /** The assets "Export anyway" named: with `allowMissingMedia`, only these may be left out (`waiver.ts`). */ waivedAssetIds?: readonly string[];
  /** A still for someone who looks at the layout: missing media keeps its place as the preview's tile and is reported. */
  placeholders?: boolean;
  /** The immutable snapshot an export renders; the engine's live document when absent. */
  document?: ProjectDocument;
};
export type FrameSpans = { build: number; sync: number; render: number; drawn: number; textures: Record<string, number> };
type ExportState = { id: string; cancelled: boolean; paused: boolean; cancelledSignal: Promise<void>; signalCancel: () => void; resume?: () => void };
/** An export running in its worker: the commands of the app are passed on to it. */
type WorkerExport = { id: string; send: (type: "export.pause" | "export.resume" | "export.cancel") => Promise<unknown> };

const MAX_PREVIEW: Record<EngineReady["memoryClass"], Size> = {
  desktop: { width: 3840, height: 2160 }, web: { width: 3840, height: 2160 }, host: { width: 3840, height: 2160 }, mobile: { width: 1920, height: 1080 },
};
const IMAGE_RETRIES = 2, IMAGE_RETRY_MS = 500;
/** How long the preview holds a text back for its own face before it draws it in the fallback chain. */
const PREVIEW_FONT_WAIT_MS = 3000;
/** How long the playhead rests after a scrub seek before its frame is decoded exactly. */
const SCRUB_SETTLE_MS = 60;

/**
 * The render engine behind an `EngineSurface`: it holds its own copy of the project document, turns a scene and a
 * time into a frame through the wasm compositor, runs the transport clock and the export loop.
 */
export class Engine {
  readonly handlers: CommandHandlers;
  private readonly options: EngineOptions;
  private readonly now: () => number;
  private compositor: CompositorDriver | undefined;
  private ready: EngineReady | undefined;
  private memoryClass: EngineReady["memoryClass"] = "web";

  private document: ProjectDocument | undefined;
  private revision = 0;
  private activeSceneId = "";
  private overrides: Record<string, Record<string, unknown>> = {};
  private readonly sources = new Map<string, MediaSource>();
  private preferProxies = false;

  private images = new ByteLru<ImageBitmap>(POOL_BUDGETS.web.images, (bitmap) => bitmap.close());
  private sessions = new SessionPool(SESSION_LIMITS.web);
  private readonly failedAssets = new Map<string, "missing" | "unsupported">();
  private wasm: Wasm | undefined;
  private readonly fonts: FontRegistry;
  private readonly measured = new Map<string, MeasuredText | null>();
  private readonly derived = new Map<string, { kind: string; url: string; sha256: string }>();
  /** Parsed LUT tables by LUT id; `null` once a table is known to be unavailable. */
  private readonly luts = new Map<string, { size: number; pixels: Uint8Array } | null>();
  private readonly lutLoads = new Set<string>();
  private readonly filterTables = new Map<string, { size: number; pixels: Uint8Array } | null>();
  /** Person mattes by asset id: the stored size once known, `null` when none can be had; stills keep their bitmap. */
  private readonly matteSizes = new Map<string, { width: number; height: number } | null>();
  private readonly matteStills = new Map<string, ImageBitmap>();
  private readonly matteLoads = new Set<string>();
  private stickers = new ByteLru<ImageBitmap>(POOL_BUDGETS.web.images, (bitmap) => bitmap.close());
  private readonly reported = new Set<string>();

  private viewport: Size = { width: 0, height: 0 };
  private devicePixelRatio = 1;
  private zoom = 1;
  private quality: "auto" | QualityLevel = "auto";
  private readonly governor = new QualityGovernor();
  private visible = true;

  private position = 0;
  private playing = false;
  private rate = 1;
  private loop: { enabled: boolean; inTime?: number; outTime?: number } = { enabled: false };
  private startPosition = 0;
  private startClock = 0;
  private animationFrame = 0;
  private lastRendered = "";
  /** Bumped whenever something outside the document changes what a frame shows (a font or a sticker arrived, a still or an export used the compositor). */
  private contentVersion = 0;
  private lastExact = false;
  private presentChain: Promise<unknown> = Promise.resolve();
  private renderChain: Promise<unknown> = Promise.resolve();
  private renderInFlight = false;
  private droppedFrames = 0;
  private lastPlayedFrame = -1;
  private exporting: ExportState | undefined;
  private readonly audio = new LiveAudio();
  private audioSources: AudioSources | undefined;
  private audioClock = false;
  private audioOutput = false;
  private scrubAudio = true;
  private offlineTile = { fill: "#1f2126", hatch: "#3a3d45", offlineLabel: "Media offline", unsupportedLabel: "Unsupported format" };
  private readonly thumbnailJobs = new Map<string, { cancelled: boolean }>();
  private lastSnippet = 0;
  private seekToken = 0;
  /** Counts play and pause commands: a play that was still pre-rolling when a later one arrived does not start. */
  private playToken = 0;
  /** `engine.dispose` is running: nothing is drawn any more. */
  private disposing = false;
  /** Invalidates deferred capability probes across disposal and a later engine init. */
  private probeGeneration = 0;
  private perfEnabled = false;
  private perfSamples: number[] = [];

  constructor(options: EngineOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.fonts = new FontRegistry(() => loadWasm(options.wasmUrl));
    // A face that arrives re-renders the text that was waiting for it.
    this.fonts.onLoaded = () => { this.measured.clear(); this.contentVersion++; this.invalidate(); };
    // A stalled audio clock pauses the transport; it resumes only on an explicit play.
    this.audio.onInterrupted = () => { if (this.playing) this.pause("audio-interrupted"); };
    this.handlers = {
      "engine.init": (payload) => this.init(payload),
      "engine.dispose": () => this.dispose(),
      "scene.set": (payload) => this.setScene(payload),
      "scene.patch": (payload) => this.patchScene(payload),
      "scene.setActive": ({ sceneId }) => { this.scene(sceneId); this.activeSceneId = sceneId; this.invalidate(); },
      "media.setSources": (payload) => this.setSources(payload),
      "fonts.setSources": (payload) => this.setFonts(payload),
      "derived.setSources": ({ entries }) => {
        // A replace-all list; two entries with the same hash share one decoded resource.
        this.derived.clear();
        for (const entry of entries) this.derived.set(entry.key, entry);
        this.stickers.clear();
        for (const moving of this.animatedStickers.values()) moving?.close();
        this.animatedStickers.clear();
        this.matteSizes.clear();
        for (const bitmap of this.matteStills.values()) bitmap.close();
        this.matteStills.clear();
        this.luts.clear();
        this.contentVersion++;
        this.invalidate();
      },
      "transport.seek": (payload) => this.seek(payload),
      "transport.play": ({ fromTime }) => this.play(fromTime),
      "transport.pause": () => this.pause("user"),
      "transport.setRate": async ({ rate }) => { this.rebase(); this.rate = rate; if (this.playing) await this.restartClock(); this.emitState(); },
      "transport.setLoop": (payload) => { this.loop = payload; this.emitState(); },
      "transport.setVolume": ({ volume }) => this.audio.setVolume(volume),
      "transport.setMuted": ({ muted }) => this.audio.setMuted(muted),
      "transport.setScrubAudio": ({ enabled }) => { this.scrubAudio = enabled; },
      "view.resize": (payload) => { this.viewport = { width: payload.width, height: payload.height }; this.devicePixelRatio = payload.devicePixelRatio; this.zoom = payload.zoom ?? 1; this.invalidate(); },
      "view.setQuality": ({ quality }) => { this.quality = quality; this.governor.reset(); this.invalidate(); },
      "view.setVisible": ({ visible }) => { this.visible = visible; if (visible) this.invalidate(); },
      "preview.setOverride": ({ overrides }) => { this.overrides = overrides; this.invalidate(); },
      "preview.clearOverride": () => { this.overrides = {}; this.invalidate(); },
      "layout.query": (payload) => this.layoutQuery(payload),
      "layout.sampleSource": (payload) => this.sampleSource(payload),
      "still.render": (payload) => this.still(payload),
      "export.start": (payload) => this.startExport(payload),
      "export.pause": ({ exportId }) => { if (this.workerExport?.id === exportId) return this.workerExport.send("export.pause"); this.exportOf(exportId).paused = true; },
      "export.resume": ({ exportId }) => { if (this.workerExport?.id === exportId) return this.workerExport.send("export.resume"); const state = this.exportOf(exportId); state.paused = false; state.resume?.(); },
      "export.cancel": ({ exportId }) => { if (this.workerExport?.id === exportId) return this.workerExport.send("export.cancel"); const state = this.exportOf(exportId); state.cancelled = true; state.signalCancel(); state.resume?.(); },
      "thumbnails.request": (payload) => this.thumbnails(payload),
      "thumbnails.cancel": ({ requestId }) => { const job = this.thumbnailJobs.get(requestId); if (job) job.cancelled = true; this.thumbnailJobs.delete(requestId); },
      "perf.setEnabled": ({ enabled }) => { this.perfEnabled = enabled; this.perfSamples = []; },
      "memory.trim": () => this.trim(),
    };
  }

  private emit<T extends EngineEventType>(type: T, payload: EngineEventPayload<T>, transfer?: ArrayBuffer[]): void {
    this.options.emit(type, payload, transfer);
  }

  /** A diagnostic id for a given element or asset is emitted at most once per scene revision. */
  private readonly diagnose = (diagnostic: SceneDiagnostic): void => {
    const key = `${this.revision}:${diagnostic.id}:${diagnostic.elementId ?? ""}:${diagnostic.assetId ?? ""}:${JSON.stringify(diagnostic.details ?? "")}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.emit("diagnostic", diagnostic);
  };

  // ---- lifecycle -----------------------------------------------------------------------------------------------------

  private workerExport: WorkerExport | undefined;
  private initPayload: EngineCommandParsed<"engine.init"> | undefined;
  private fontSources: EngineCommandParsed<"fonts.setSources">["fonts"] = [];

  private async init(payload: EngineCommandParsed<"engine.init">): Promise<{ backend: string }> {
    this.initPayload = payload;
    const missing = missingCapabilities();
    if (missing.length > 0) {
      this.emit("engine.error", { code: "engine/unsupported-runtime", message: `the runtime lacks ${missing.join(", ")}`, fatal: true, missing });
      throw new EngineFailure("engine/unsupported-runtime", `the runtime lacks ${missing.join(", ")}`, { missing });
    }
    this.memoryClass = payload.memoryClass;
    // Scrub audio is on by default on desktop and web, off on mobile.
    this.scrubAudio = payload.scrubAudio ?? payload.memoryClass !== "mobile";
    if (payload.offlineTile) this.offlineTile = payload.offlineTile;
    const budgets = POOL_BUDGETS[this.memoryClass];
    this.images = new ByteLru<ImageBitmap>(budgets.images, (bitmap) => bitmap.close());
    this.sessions = new SessionPool(SESSION_LIMITS[this.memoryClass]);
    this.viewport = { width: payload.width, height: payload.height };
    this.devicePixelRatio = payload.devicePixelRatio;
    let backend: EngineReady["backend"] = "none", software = false, maxTextureSize = 0;
    // A software rasteriser is refused unless the user allowed it: the client asks WebGL2 with failIfMajorPerformanceCaveat.
    const hardware = await hasHardwareContext();
    if (hardware || payload.allowSoftware === true || this.options.surface === "render-host") {
      try {
        this.compositor = await CompositorDriver.create({
          wasmUrl: this.options.wasmUrl, width: Math.max(2, Math.round(payload.width)), height: Math.max(2, Math.round(payload.height)),
          forceBackend: payload.forceBackend, textureBudget: budgets.textures,
        });
        ({ backend, software, maxTextureSize } = this.compositor.info);
      } catch (error) {
        this.compositor = undefined;
        if (this.options.surface === "render-host") console.error("[render-host] graphics context creation failed: " + (error instanceof Error ? error.stack ?? error.message : String(error)));
      }
    }
    if (this.compositor && this.options.host) {
      const canvas = this.compositor.canvas;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      this.options.host.replaceChildren(canvas);
    }
    this.watchDevice();
    this.ready = await probeRuntime(globalThis, { backend, software, maxTextureSize, memoryClass: this.memoryClass, surface: this.options.surface ?? "same-thread" });
    // A cached measurement of this browser and OS version is the calibration; otherwise the defaults hold until the probes have run.
    const cached = this.options.surface === "render-host" ? null : cachedProbeResult();
    if (cached) this.ready = { ...this.ready, constraints: this.calibrated(this.ready.constraints, cached) };
    this.emit("engine.ready", this.ready);
    // The probes run in a worker only: a surface that was given no worker script keeps the defaults.
    if (!this.ready.constraints.calibrated && this.options.exportWorker && typeof Worker !== "undefined") this.scheduleProbes();
    return { backend };
  }

  private async dispose(): Promise<void> {
    // No frame starts from here on, and the ones in flight end before the compositor goes: a draw on a released GPU
    // context would fail outside any command.
    this.disposing = true;
    this.probeGeneration += 1;
    if (this.probeTimer !== undefined) { clearTimeout(this.probeTimer); this.probeTimer = undefined; }
    this.interruptProbes();
    this.stopLoop();
    this.playing = false;
    if (this.exporting) { this.exporting.cancelled = true; this.exporting.signalCancel(); }
    await this.renderChain.catch(() => undefined);
    await this.sessions.closeAll();
    await this.audio.dispose();
    await this.presentChain.catch(() => undefined);
    await this.renderChain.catch(() => undefined);
    this.audioSources?.dispose();
    this.audioSources = undefined;
    this.images.clear();
    this.compositor?.destroy();
    this.compositor = undefined;
    this.options.host?.replaceChildren();
    this.document = undefined;
    this.revision = 0;
    this.contentVersion++;
    this.disposing = false;
  }

  /** RGBA8 pixels (straight alpha, top-left origin) of the frame the compositor rendered last. */
  async readPixels(x: number, y: number, width: number, height: number): Promise<Uint8Array> {
    await this.renderChain.catch(() => undefined);
    if (!this.compositor) throw new EngineFailure("engine/no-gpu", "no GPU backend is available");
    return this.compositor.readPixels(x, y, width, height);
  }
  /** Size of the frame the preview renders at the current view and quality. */
  get renderSize(): { width: number; height: number } | undefined { return this.document ? this.previewSize(this.level) : undefined; }

  /** Decoded frames still open: 0 after `engine.dispose`. */
  get openVideoFrames(): number { return this.sessions.openFrames; }
  get counters(): Record<string, number> {
    return { ...(this.compositor?.counters ?? {}), droppedFrames: this.droppedFrames, decoderSessions: this.sessions.size, imageBytes: this.images.bytes, videoBytes: this.sessions.bytes, textureBytes: this.compositor?.textureBytes ?? 0 };
  }
  decodeCounters(assetId: string, variant = "original"): { seeks: number; decoded: number; openFrames: number } | undefined {
    return this.sessions.counters(`${assetId}:${variant}`);
  }

  // ---- scene ---------------------------------------------------------------------------------------------------------

  private scene(sceneId: string) {
    const scene = this.document?.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new EngineFailure("surface/invalid-payload", `scene ${sceneId} does not exist`);
    return scene;
  }

  private async setScene(payload: EngineCommandParsed<"scene.set">): Promise<{ revision: number }> {
    let document: unknown = "document" in payload ? payload.document : undefined;
    if ("snapshotUrl" in payload) {
      const response = await fetch(payload.snapshotUrl);
      if (!response.ok) throw new EngineFailure("surface/invalid-payload", `the snapshot could not be loaded (${response.status})`);
      document = await response.json();
    }
    const candidate = document as ProjectDocument;
    if (!Array.isArray(candidate?.scenes) || !candidate.scenes.some((scene) => scene.id === payload.activeSceneId) || !candidate.settings) {
      throw new EngineFailure("surface/invalid-payload", "the document has no such active scene");
    }
    this.document = candidate;
    this.revision = payload.revision;
    this.activeSceneId = payload.activeSceneId;
    this.overrides = {};
    this.reported.clear();
    this.position = Math.min(this.position, sceneDuration(this.scene(this.activeSceneId)));
    this.invalidate();
    return { revision: this.revision };
  }

  private patchScene(payload: EngineCommandParsed<"scene.patch">): { revision: number } {
    if (!this.document || payload.baseRevision !== this.revision) {
      throw new EngineFailure("scene/revision-mismatch", `the engine is at revision ${this.revision}, the patch is based on ${payload.baseRevision}`, { revision: this.revision });
    }
    let next: ProjectDocument;
    try {
      next = applyPatch(this.document, payload.patches as PatchEntry[]);
    } catch (error) {
      if (error instanceof DocumentRejected) throw new EngineFailure("scene/patch-invalid", error.message);
      throw error;
    }
    // The patch is applied to a copy: a rejected patch leaves the engine's document unchanged.
    this.document = next;
    this.revision = payload.revision;
    this.overrides = {};
    this.reported.clear();
    // Entries of an asset that the patch removed are evicted at once.
    const assets = new Set(next.media.assets.map((asset) => asset.id));
    this.images.deleteWhere((key) => !assets.has(key.split("\n")[0]));
    // An edit during playback reaches the ear too: the clips are mixed again from the playhead.
    if (this.playing && this.audioClock) void this.restartClock();
    this.invalidate();
    return { revision: this.revision };
  }

  /** Sources of the bundled and the user's fonts. Their bytes are fetched and parsed before text is rasterised with them. */
  private async setFonts(payload: EngineCommandParsed<"fonts.setSources">): Promise<void> {
    this.fontSources = payload.fonts;
    this.fonts.setSources(payload.fonts);
    this.wasm ??= await loadWasm(this.options.wasmUrl);
    this.measured.clear();
    this.contentVersion++;
    this.invalidate();
  }

  /** When the preview first asked for a face that had not loaded, by font id. */
  private readonly fontAsked = new Map<string, number>();
  /** While set, text does not wait for its face (an export has already waited its own 15 s). */
  private fontWaitOff = false;

  private readonly textServices = {
    chain: (fontFamily: string, weight?: number, style?: "normal" | "italic") => {
      const chain = this.fonts.chain(fontFamily, weight, style);
      // Faces that are known and not yet loaded are fetched; the frame is rendered again when they arrive.
      for (const source of chain.pending) void this.fonts.ensure(source);
      if (!chain.waiting || this.fontWaitOff) return chain.waiting ? { ...chain, fallback: true } : chain;
      // A text is not rasterised before its own face has loaded: the preview waits up to 3 s for it, then draws the
      // text in the fallback chain (with a `font/fallback` diagnostic) until the face arrives.
      const asked = this.fontAsked.get(chain.waiting.fontId) ?? this.now();
      if (!this.fontAsked.has(chain.waiting.fontId)) {
        this.fontAsked.set(chain.waiting.fontId, asked);
        const fontId = chain.waiting.fontId;
        // When the wait is over and the face has still not arrived, the text is drawn in the fallback chain.
        setTimeout(() => { if (!this.fonts.isLoaded(fontId) && this.document) { this.contentVersion++; this.invalidate(); } }, PREVIEW_FONT_WAIT_MS + 20);
      }
      return this.now() - asked < PREVIEW_FONT_WAIT_MS ? { ...chain, ids: [] } : { ...chain, fallback: true };
    },
    measure: (spec: TextSpec) => {
      if (!this.wasm) return null;
      const key = JSON.stringify(spec);
      let measured = this.measured.get(key);
      if (measured === undefined) {
        if (this.measured.size > 500) this.measured.clear();
        this.measured.set(key, measured = measureText(this.wasm, spec, this.textLimit));
      }
      if (!measured) return null;
      // Offset of the block centre from the texture centre.
      const { block } = measured;
      return {
        width: measured.width, height: measured.height, blockWidth: block.width, blockHeight: block.height,
        offsetX: measured.originX + block.x + block.width / 2 - measured.width / 2, offsetY: measured.originY + block.y + block.height / 2 - measured.height / 2,
      };
    },
  };

  /** A text texture never passes the device's texture size; its area is bounded so that one text cannot take the pool. */
  private get textLimit(): TextLimit {
    return { side: Math.min(this.compositor?.info.maxTextureSize ?? DEFAULT_TEXT_LIMIT.side, DEFAULT_TEXT_LIMIT.side), area: DEFAULT_TEXT_LIMIT.area };
  }

  /** Resolves when the fonts the current document uses have loaded or failed (or the time is up), with the families still missing. */
  async whenFontsSettled(timeoutMs = 15_000): Promise<string[]> {
    return this.document ? this.fontsSettled(this.document, timeoutMs) : [];
  }

  /** Waits until the fonts of the scene's texts have loaded or failed, up to `timeoutMs`. */
  private async fontsSettled(document: ProjectDocument, timeoutMs: number): Promise<string[]> {
    const wanted = new Map<string, ReturnType<FontRegistry["chain"]>>();
    for (const scene of document.scenes) {
      for (const track of [scene.tracks.main, ...scene.tracks.overlay]) {
        const trackStyle = (track as { caption?: { style?: Record<string, any> } }).caption?.style;
        for (const element of track.elements as Record<string, any>[]) {
          const style = element.type === "caption" ? { ...trackStyle, ...(element.style ?? {}) } : element.type === "text" ? element : undefined;
          if (style) wanted.set(`${style.fontFamily}:${style.fontWeight}:${style.fontStyle}`, this.fonts.chain(style.fontFamily ?? "Arial", style.fontWeight, style.fontStyle));
          // An emoji sticker is drawn from the colour font.
          if (element.type === "sticker" && emojiText(element.stickerId) !== null) wanted.set("Noto Color Emoji:undefined:undefined", this.fonts.chain("Noto Color Emoji"));
          // A text mask is drawn from the same glyph outlines.
          for (const mask of (element.masks ?? []) as { type: string; params?: Record<string, any> }[]) {
            if (mask.type !== "text") continue;
            const weight = mask.params?.fontWeight === "bold" ? 700 : 400, slant = mask.params?.fontStyle === "italic" ? "italic" : "normal";
            wanted.set(`${mask.params?.fontFamily}:${weight}:${slant}`, this.fonts.chain(mask.params?.fontFamily ?? "Arial", weight, slant));
          }
        }
      }
    }
    const pending = [...wanted.values()].flatMap((chain) => chain.pending.map((source) => this.fonts.ensure(source)));
    await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    this.measured.clear();
    // Families whose own face is still missing.
    return [...new Set([...wanted.keys()].map((key) => key.split(":")).map(([family, weight, style]) => this.fonts.chain(family, Number(weight) || undefined, style as "normal" | "italic")).filter((chain) => chain.fallback).map((chain) => chain.family))];
  }

  /** Size of a loaded LUT table. An unknown table starts loading and the frame is rendered again when it is parsed. */
  private readonly lutSize = (lutId: string): number | null => {
    const known = this.luts.get(lutId);
    if (known !== undefined) return known?.size ?? null;
    if (this.lutLoads.has(lutId)) return null;
    const source = this.derived.get(lutId);
    if (!source || source.kind !== "lut") {
      this.luts.set(lutId, null);
      this.diagnose({ id: "derived/unavailable", severity: "caution", message: `LUT ${lutId} is not available on this device`, details: { key: lutId, kind: "lut" } });
      return null;
    }
    this.lutLoads.add(lutId);
    void (async () => {
      let parsed: { size: number; pixels: Uint8Array } | null = null;
      try {
        const response = await fetch(source.url);
        if (response.ok) parsed = parseCube(await response.text());
      } catch { /* reported below */ }
      if (!parsed) this.diagnose({ id: "derived/unavailable", severity: "caution", message: `LUT ${lutId} could not be read`, details: { key: lutId, kind: "lut" } });
      this.luts.set(lutId, parsed);
      this.lutLoads.delete(lutId);
      this.contentVersion++;
      this.invalidate();
    })();
    return null;
  };

  /** The delivered person matte of an asset: the entry `<assetId>:person` of `derived.setSources`. */
  private matteSource(assetId: string): { key: string; kind: string; url: string; sha256: string } | undefined {
    for (const key of [personMatteKey(assetId), legacyPersonMatteKey(assetId)]) { const source = this.derived.get(key); if (source?.kind === "person-matte") return { ...source, key }; }
    return undefined;
  }

  /** Stored size of the person matte of an asset. An unknown matte starts loading and the frame is rendered again when it is known. */
  private readonly personMatte = (assetId: string): { width: number; height: number } | null => {
    const known = this.matteSizes.get(assetId);
    if (known !== undefined) return known;
    const source = this.matteSource(assetId);
    if (!source) {
      // The body effect's passes are skipped: the layer renders without that effect, and says so once.
      this.diagnose({ id: "matte/unavailable", severity: "caution", message: `the person matte of asset ${assetId} is not available`, assetId, details: { key: personMatteKey(assetId), kind: "person-matte" } });
      return null;
    }
    if (this.matteLoads.has(assetId)) return null;
    this.matteLoads.add(assetId);
    const still = this.document?.media.assets.find((asset) => asset.id === assetId)?.type === "image";
    void (async () => {
      let size: { width: number; height: number } | null = null;
      try {
        if (still) {
          const response = await fetch(source.url);
          if (response.ok) {
            const bitmap = await straightBitmap(await response.blob());
            this.matteStills.set(assetId, bitmap);
            size = { width: bitmap.width, height: bitmap.height };
          }
        } else {
          const frame = await (await this.sessions.acquire(`person-matte:${assetId}`, source.url)).frameAt(0, "exact");
          if (frame) size = { width: frame.width, height: frame.height };
        }
      } catch { /* reported below */ }
      if (!size) this.diagnose({ id: "derived/unavailable", severity: "caution", message: `person matte of asset ${assetId} could not be read`, details: { key: source.key, kind: "person-matte" } });
      this.matteSizes.set(assetId, size);
      this.matteLoads.delete(assetId);
      this.contentVersion++;
      this.invalidate();
    })();
    return null;
  };
  /** Resolves when every person matte that has started loading is known. */
  async whenMattesSettled(timeoutMs = 15_000): Promise<void> {
    const started = this.now();
    while (this.matteLoads.size > 0 && this.now() - started < timeoutMs) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /** Resolves when every LUT that has started loading is parsed or known to be missing. */
  async whenLutsSettled(timeoutMs = 15_000): Promise<void> {
    const started = this.now();
    while (this.lutLoads.size > 0 && this.now() - started < timeoutMs) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /** Animated stickers by content hash; `null` for a still one. Unknown until the file has been read once. */
  private readonly animatedStickers = new Map<string, AnimatedImage | null>();
  private readonly stickerAnimated = (stickerId: string): boolean | undefined => {
    const source = this.derived.get(stickerId);
    const known = source ? this.animatedStickers.get(source.sha256) : undefined;
    return known === undefined ? undefined : known !== null;
  };

  private async sticker(stickerId: string, size: number, animation?: { time: number; loop: boolean }): Promise<{ bitmap: ImageBitmap; key: string } | undefined> {
    const source = this.derived.get(stickerId);
    if (!source || source.kind !== "sticker") {
      this.diagnose({ id: "derived/unavailable", severity: "caution", message: `sticker ${stickerId} is not available on this device`, details: { key: stickerId, kind: "sticker" } });
      return undefined;
    }
    const key = `${source.sha256}:${size}`;
    try {
      const moving = this.animatedStickers.get(source.sha256);
      if (moving && animation) {
        // The frame of an animated sticker at its own time, decoded on demand and kept with the stills.
        const index = moving.frameAt(animation.time, animation.loop), frameKey = `${source.sha256}:frame:${index}`;
        let frame = this.stickers.get(frameKey);
        if (!frame) { frame = await moving.frame(index); this.stickers.set(frameKey, frame, frame.width * frame.height * 4); }
        return { bitmap: frame, key: frameKey };
      }
      const cached = this.stickers.get(key);
      if (cached) return { bitmap: cached, key };
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const blob = await response.blob();
      let bitmap: ImageBitmap;
      if (blob.type.includes("svg") || /^\s*<(\?xml|svg)/.test(await blob.slice(0, 200).text())) {
        // A vector sticker is rasterised at the requested size through an image element, which is what decodes SVG.
        const image = new Image();
        const url = URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: "image/svg+xml" }));
        try {
          image.src = url;
          await image.decode();
          const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
          const canvas = new OffscreenCanvas(aspect >= 1 ? size : Math.max(1, Math.round(size * aspect)), aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size);
          canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
          bitmap = await straightBitmap(canvas);
        } finally {
          URL.revokeObjectURL(url);
        }
        this.animatedStickers.set(source.sha256, null);
      } else {
        if (this.animatedStickers.get(source.sha256) === undefined) {
          // GIF, APNG and animated WebP play their own frames; whether a file is one is known after it is opened.
          const opened = await AnimatedImage.open(blob);
          this.animatedStickers.set(source.sha256, opened);
          if (opened) {
            // Frames are asked for by time from now on: the frame is built again with that knowledge.
            this.contentVersion++;
            if (animation) return this.sticker(stickerId, size, animation);
          }
        }
        bitmap = await straightBitmap(blob);
      }
      this.stickers.set(key, bitmap, bitmap.width * bitmap.height * 4);
      return { bitmap, key };
    } catch {
      this.diagnose({ id: "derived/unavailable", severity: "caution", message: `sticker ${stickerId} could not be loaded`, details: { key: stickerId, kind: "sticker" } });
      return undefined;
    }
  }

  private setSources(payload: EngineCommandParsed<"media.setSources">): void {
    const next = new Map(payload.sources.map((source) => [source.assetId, source]));
    for (const assetId of this.sources.keys()) {
      const before = this.sources.get(assetId)!, after = next.get(assetId);
      if (!after || after.original !== before.original || after.proxy !== before.proxy) {
        this.images.deleteWhere((key) => key.split("\n")[0] === assetId);
        this.failedAssets.delete(assetId);
        // The sound is read from the new file too, and may be reported again.
        this.audioSources?.forget(assetId);
        for (const key of [...this.reported]) if (key.startsWith(`status:${assetId}:`)) this.reported.delete(key);
        for (const variant of ["original", "proxy", "mezzanine"]) void this.sessions.close(`${assetId}:${variant}`);
      }
    }
    this.sources.clear();
    for (const [assetId, source] of next) this.sources.set(assetId, { original: source.original, proxy: source.proxy, mezzanine: source.mezzanine });
    this.failedAssets.clear();
    if (payload.preferProxies !== undefined) this.preferProxies = payload.preferProxies;
    this.invalidate();
  }

  // ---- textures ------------------------------------------------------------------------------------------------------

  /** Preview decodes the proxy when the preference is on, when the original is absent, or when the device requires it. */
  private variantFor(assetId: string, original: boolean): { variant: "original" | "proxy" | "mezzanine"; url: string } | undefined {
    const source = this.sources.get(assetId);
    if (!source) return undefined;
    if (original) {
      if (source.original) return { variant: "original", url: source.original };
      if (source.mezzanine) return { variant: "mezzanine", url: source.mezzanine };
      return undefined;
    }
    const proxyFirst = this.preferProxies || this.ready?.constraints.proxyEditing === "required" || !source.original;
    if (proxyFirst && source.proxy) return { variant: "proxy", url: source.proxy };
    if (source.original) return { variant: "original", url: source.original };
    return source.mezzanine ? { variant: "mezzanine", url: source.mezzanine } : undefined;
  }

  private status(assetId: string, status: "ready" | "missing" | "unsupported", using?: "original" | "proxy" | "mezzanine"): void {
    const key = `status:${assetId}:${status}:${using ?? ""}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.emit("media.status", { assets: [{ assetId, status, ...(using ? { using } : {}) }] });
  }

  private async image(assetId: string, maxLongSide: number): Promise<ImageBitmap | undefined> {
    const limit = Math.min(maxLongSide || Number.MAX_SAFE_INTEGER, this.compositor?.info.maxTextureSize ?? 8192);
    const key = `${assetId}\n${limit}`;
    const cached = this.images.get(key);
    if (cached) return cached;
    const url = this.sources.get(assetId)?.original;
    if (!url || this.failedAssets.has(assetId)) return undefined;
    for (let attempt = 0; attempt <= IMAGE_RETRIES; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`status ${response.status}`);
        const blob = await response.blob();
        let bitmap = await straightBitmap(blob);
        const long = Math.max(bitmap.width, bitmap.height);
        if (long > limit) {
          // Larger sources are downscaled before upload with the aspect preserved.
          const resized = await straightBitmap(blob, { resizeWidth: Math.max(1, Math.floor((bitmap.width * limit) / long)), resizeHeight: Math.max(1, Math.floor((bitmap.height * limit) / long)), resizeQuality: "high" });
          bitmap.close();
          bitmap = resized;
        }
        this.images.set(key, bitmap, bitmap.width * bitmap.height * 4);
        this.status(assetId, "ready", "original");
        return bitmap;
      } catch {
        if (attempt < IMAGE_RETRIES) await new Promise((resolve) => setTimeout(resolve, IMAGE_RETRY_MS));
      }
    }
    this.failedAssets.set(assetId, "missing");
    this.status(assetId, "missing");
    this.diagnose({ id: "media/unavailable", severity: "error", message: `media of asset ${assetId} is offline`, assetId });
    return undefined;
  }

  private async resolveTexture(request: TextureRequest, render: RenderRequest): Promise<ResolvedTexture | undefined> {
    if (request.kind === "color") {
      return { key: request.id, width: 1, height: 1, pixels: new Uint8Array(request.rgba.map((value) => Math.round(value * 255))) };
    }
    if (request.kind === "image") {
      const bitmap = await this.image(request.assetId, request.maxLongSide);
      return bitmap && { key: request.id, width: bitmap.width, height: bitmap.height, source: bitmap };
    }
    if (request.kind === "curves") return { key: request.id, width: 256, height: 1, pixels: curvesPixels(request.curves) };
    if (request.kind === "lut") {
      const table = this.luts.get(request.lutId);
      return table ? { key: request.id, width: table.size * table.size, height: table.size, pixels: table.pixels } : undefined;
    }
    if (request.kind === "gradient") {
      return { key: request.id, width: request.width, height: request.height, pixels: new Uint8Array(rasterGradient(parseGradient(request.css), request.width, request.height).buffer) };
    }
    if (request.kind === "text") {
      const measured = this.wasm ? this.measured.get(JSON.stringify(request.spec)) ?? measureText(this.wasm, request.spec, this.textLimit) : null;
      if (!this.wasm || !measured) return undefined;
      const canvas = rasterText(this.wasm, request.spec, measured);
      return { key: request.id, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) };
    }
    if (request.kind === "sticker") {
      const sticker = await this.sticker(request.stickerId, request.size, request.animation);
      return sticker && { key: sticker.key, width: sticker.bitmap.width, height: sticker.bitmap.height, source: sticker.bitmap };
    }
    if (request.kind === "emoji") {
      if (!this.wasm) return undefined;
      // One line of the colour font, fitted into the square: the glyph box (advance × line height) is centred in it.
      const probe: TextSpec = { content: request.text, fonts: request.fonts, size: 100, letterSpacing: 0, lineHeight: 1, align: "left", color: "#000000", underline: false, strikethrough: false };
      const natural = measureText(this.wasm, probe, this.textLimit);
      const line = natural?.layout.lines[0];
      if (!natural || !line || !(line.width > 0)) return undefined;
      const size = (100 * request.size) / Math.max(line.width, line.ascent + line.descent);
      const measured = measureText(this.wasm, { ...probe, size }, this.textLimit);
      if (!measured) return undefined;
      const glyphs = rasterText(this.wasm, { ...probe, size }, measured);
      const canvas = new OffscreenCanvas(request.size, request.size);
      canvas.getContext("2d")!.drawImage(glyphs, (request.size - measured.layout.width) / 2 - measured.originX, (request.size - measured.layout.height) / 2 - measured.originY);
      return { key: request.id, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) };
    }
    if (request.kind === "drawing") {
      const canvas = rasterDrawing(request.strokes, request.intrinsic, request.width, request.height, request.colorOverride);
      return canvas ? { key: request.id, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) } : undefined;
    }
    if (request.kind === "graphic") {
      // One shape unit is 1/200 of the unstretched shape: the shorter side of a stretched texture.
      const canvas = rasterGraphic(request.definitionId, request.params, request.width, request.height);
      return canvas ? { key: request.id, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) } : undefined;
    }
    if (request.kind === "filter") {
      // The table of a bundled filter is baked from its recipe, byte for byte the committed `.cube` file.
      let table = this.filterTables.get(request.filterId);
      if (table === undefined) {
        const cube = filterCube(request.filterId);
        table = cube ? parseCube(cube) : null;
        this.filterTables.set(request.filterId, table);
      }
      return table ? { key: request.id, width: table.size * table.size, height: table.size, pixels: table.pixels } : undefined;
    }
    if (request.kind === "person-matte") {
      const source = this.matteSource(request.assetId);
      if (!source) return undefined;
      if (request.sourceTime === null) {
        const bitmap = this.matteStills.get(request.assetId);
        return bitmap && { key: `${request.id}:still`, width: bitmap.width, height: bitmap.height, source: bitmap };
      }
      // A video's matte is a matte track decoded in lock-step with the source frame, at the same source time.
      try {
        const frame = await (await this.sessions.acquire(`person-matte:${request.assetId}`, source.url)).frameAt(request.sourceTime, "exact");
        return frame && { key: `person-matte:${request.assetId}:${frame.timestamp}`, width: frame.width, height: frame.height, source: frame.bitmap };
      } catch {
        return undefined;
      }
    }
    if (request.kind === "mask") {
      let glyphs: OffscreenCanvas | undefined;
      if (request.text) {
        const measured = this.wasm ? measureText(this.wasm, request.text, this.textLimit) : null;
        if (!this.wasm || !measured) return undefined;
        glyphs = rasterText(this.wasm, request.text, measured);
        if (measured.scale < 1) {
          // The mask places the glyph raster by its size: an oversized one is brought back to layout px, inside the limit.
          const full = new OffscreenCanvas(Math.min(measured.width, this.textLimit.side), Math.min(measured.height, this.textLimit.side));
          full.getContext("2d")!.drawImage(glyphs, 0, 0, full.width, full.height);
          glyphs = full;
        }
      }
      const canvas = rasterMask(request.shape, request.params, request.quad, request.width, request.height, glyphs);
      return canvas ? { key: request.id, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) } : undefined;
    }
    // A still asked with placeholders shows what the device can show: the original, else the proxy the preview plays.
    const chosen = this.variantFor(request.assetId, render.original === true) ?? (render.placeholders ? this.variantFor(request.assetId, false) : undefined);
    if (!chosen) {
      if (render.original && !render.placeholders) throw new EngineFailure("media/original-unavailable", `neither the original nor a mezzanine of asset ${request.assetId} is present`, { assetId: request.assetId, clips: this.clipsOf(render.document ?? this.document, [request]) });
      this.status(request.assetId, "missing");
      this.diagnose({ id: "media/unavailable", severity: "error", message: `media of asset ${request.assetId} is offline`, assetId: request.assetId, elementId: request.elementId });
      return undefined;
    }
    if (this.failedAssets.has(request.assetId)) return undefined;
    try {
      const session = await this.sessions.acquire(`${request.assetId}:${chosen.variant}`, chosen.url);
      let frame;
      try {
        // The second frame of a frame blend is the one after the frame just presented for this element.
        frame = request.next ? await session.frameAfter(request.sourceTime) : await session.frameAt(request.sourceTime, render.exact ? "exact" : "scrub");
      } catch (error) {
        if ((error as Error).message === "unsupported") throw error;
        // A decode error on one frame is retried once after a key-frame seek.
        await this.sessions.close(`${request.assetId}:${chosen.variant}`);
        frame = await (await this.sessions.acquire(`${request.assetId}:${chosen.variant}`, chosen.url)).frameAt(request.sourceTime, "exact");
      }
      if (!frame) return undefined;
      this.status(request.assetId, "ready", chosen.variant);
      // The asset is part of the key: an element whose media was replaced shows the new picture even at the same source time.
      return { key: `${request.assetId}:${chosen.variant}:${frame.timestamp}`, width: frame.width, height: frame.height, source: frame.bitmap };
    } catch (error) {
      const unsupported = (error as Error).message === "unsupported";
      this.failedAssets.set(request.assetId, unsupported ? "unsupported" : "missing");
      this.status(request.assetId, unsupported ? "unsupported" : "missing");
      this.diagnose({ id: "media/unavailable", severity: "error", message: `media of asset ${request.assetId} cannot be decoded`, assetId: request.assetId, elementId: request.elementId });
      return undefined;
    }
  }

  // ---- rendering -----------------------------------------------------------------------------------------------------

  private previewSize(level: QualityLevel): Size {
    const { canvasSize } = this.document!.settings;
    // Every canvas-size target is at most the device's texture size on its long side, the aspect kept.
    const platform = MAX_PREVIEW[this.memoryClass], device = this.compositor?.info.maxTextureSize ?? platform.width;
    return previewRenderSize(canvasSize, this.viewport, this.devicePixelRatio, this.zoom, level, { width: Math.min(platform.width, device), height: Math.min(platform.height, device) });
  }
  private get level(): QualityLevel {
    // A paused frame is always rendered at full quality.
    return this.quality === "auto" ? (this.playing ? this.governor.level : "full") : this.quality;
  }

  /** The clips behind textures that could not be had, by id and by the names a person knows them by: what a failure names. */
  private clipsOf(document: ProjectDocument | undefined, textures: readonly TextureRequest[]): { elementId: string; assetId?: string; elementName?: string; assetName?: string }[] {
    const out = new Map<string, { elementId: string; assetId?: string; elementName?: string; assetName?: string }>();
    const elements = new Map<string, string>();
    for (const scene of document?.scenes ?? []) for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) for (const element of track.elements) elements.set(element.id, String((element as { name?: string }).name ?? ""));
    for (const texture of textures) {
      const { elementId, assetId } = texture as { elementId?: string; assetId?: string };
      if (!elementId || out.has(elementId)) continue;
      const assetName = assetId ? document?.media.assets.find((asset) => asset.id === assetId)?.name : undefined, elementName = elements.get(elementId);
      out.set(elementId, { elementId, ...(assetId ? { assetId } : {}), ...(elementName ? { elementName } : {}), ...(assetName ? { assetName } : {}) });
    }
    return [...out.values()].slice(0, 20);
  }

  /** Renders one frame through build → texture sync → compositor. Renders are serialised: the compositor is one. */
  private renderFrame(request: RenderRequest): Promise<{ built: BuiltFrame; renderMs: number; missingAssets: string[] }> {
    const attempt = async (): Promise<{ built: BuiltFrame; renderMs: number; missingAssets: string[] }> => {
      const compositor = this.compositor;
      const document = request.document ?? this.document;
      if (!compositor || !document) throw new EngineFailure("engine/no-gpu", "no GPU backend is available");
      const started = this.now();
      const spans: FrameSpans = { build: 0, sync: 0, render: 0, drawn: 0, textures: {} };
      const built = buildFrame({
        document, sceneId: request.sceneId, time: request.time, render: request.size, quality: request.quality,
        overrides: request.committedOnly ? undefined : this.overrides, includeCaptions: request.includeCaptions, diagnose: this.diagnose, text: this.textServices, lutSize: this.lutSize, personMatte: this.personMatte, stickerAnimated: this.stickerAnimated,
      });
      spans.build = this.now() - started;
      const missing = await compositor.sync(built.textures, async (texture) => { const at = this.now(); try { return await this.resolveTexture(texture, request); } finally { spans.textures[texture.id] = this.now() - at; } });
      spans.sync = this.now() - started - spans.build;
      const missingAssets = [...new Set(built.textures.filter((texture) => missing.has(texture.id) && (texture.kind === "video" || texture.kind === "image")).map((texture) => (texture as { assetId: string }).assetId))];
      if (missing.size > 0) {
        // Only the media a person waived by name may be left out of a render; anything else that is missing stops it, by the clip.
        const unwaived = request.original && !request.placeholders ? built.textures.filter((texture) => missing.has(texture.id) && !mediaWaived(request, (texture as { assetId?: string }).assetId)) : [];
        if (unwaived.length > 0) throw new EngineFailure("media/unavailable", "media of the frame is unavailable", { textures: unwaived.map((texture) => texture.id), time: request.time, clips: this.clipsOf(document, unwaived) });
        // In the preview a clip whose media is offline keeps its place as a neutral tile, and so it does in a still
        // asked with placeholders; in a render that allows missing media it contributes nothing.
        const tiles = request.quality === "preview" || request.placeholders ? await this.offlineTiles(built, missing) : new Map<string, string>();
        for (const id of tiles.keys()) missing.delete(id);
        built.descriptor.items = withoutTextures(retextured(built.descriptor.items, tiles), missing);
      }
      const submitted = this.now();
      const report = compositor.render(built.descriptor);
      spans.render = this.now() - submitted;
      // `render` returns when the frame is submitted. The time reported, and the quality rule that reads it, cover
      // the real cost of the frame: they wait until the GPU has drawn it.
      if (request.quality === "preview") await compositor.drawn();
      spans.drawn = this.now() - submitted - spans.render;
      this.lastFrameSpans = spans;
      for (const entry of report.diagnostics) {
        this.diagnose({ id: entry.id as SceneDiagnostic["id"], severity: "caution", message: `${entry.id}: ${entry.subject}`, details: { subject: entry.subject } });
      }
      return { built, renderMs: this.now() - started, missingAssets };
    };
    const run = this.renderChain.then(async () => {
      try {
        return await attempt();
      } catch (error) {
        if (!isTrap(error)) throw error;
        // A panic inside the module: the instance is replaced and the frame is rendered again in the new one.
        await this.recover("panic", panicMessage(error));
        // An export does not survive it: the session fails and the preview is what was recovered.
        if (request.quality === "export") throw new EngineFailure("export/engine-panic", panicMessage(error));
        if (!this.compositor) throw new EngineFailure("engine/wasm-panic", panicMessage(error));
        return attempt();
      }
    });
    this.renderChain = run.catch(() => undefined);
    return run;
  }

  /** Where the time of the last rendered frame went (ms): scene build, texture sync (and each resolved texture), submission, GPU completion. */
  lastFrameSpans: FrameSpans | undefined;

  // ---- deferred probes -----------------------------------------------------------------------------------------------

  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private probeAbort: (() => void) | undefined;
  /** Results of probes that ran in this session (a test reads it). */
  probeResult: ProbeResult | null = null;

  private calibrated(constraints: EngineReady["constraints"], result: ProbeResult): EngineReady["constraints"] {
    const verdict = probeVerdict(result);
    return { ...constraints, calibrated: true, proxyEditing: verdict.proxyEditing, onDeviceVideoExport: constraints.onDeviceVideoExport && verdict.onDeviceVideoExport !== false };
  }
  private get busy(): boolean { return this.playing || this.exporting !== undefined || this.workerExport !== undefined; }

  /** Starts the probes 500 ms from now, if the transport is still paused and nothing exports by then. */
  private scheduleProbes(): void {
    if (this.disposing || this.probeTimer !== undefined || this.probeAbort || !this.ready || this.ready.constraints.calibrated) return;
    const generation = this.probeGeneration;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = undefined;
      if (this.disposing || generation !== this.probeGeneration || !this.ready || this.ready.constraints.calibrated) return;
      if (this.busy) { this.scheduleProbes(); return; }
      void this.runProbes(generation);
    }, PROBE_DELAY_MS);
  }
  /** Playback, an export or memory pressure starts: a running probe is abandoned and tried again later. */
  private interruptProbes(): void {
    if (!this.probeAbort) return;
    this.probeAbort();
    this.probeAbort = undefined;
  }
  private async runProbes(generation: number): Promise<void> {
    const clipUrl = this.options.probeClipUrl === undefined ? undefined : String(new URL(this.options.probeClipUrl, globalThis.location?.href));
    let result: ProbeResult | null = null;
    let abort: (() => void) | undefined;
    try {
      // In a worker, so that the app's thread does none of the work.
      const worker = this.options.exportWorker!();
      abort = () => { worker.postMessage({ abortProbe: true }); };
      result = await new Promise<ProbeResult | null>((resolve) => {
        this.probeAbort = abort;
        worker.onmessage = (event: MessageEvent) => { if (event.data && "probe" in event.data) resolve(event.data.probe); };
        worker.onerror = () => resolve(null);
        worker.postMessage({ probe: { clipUrl } });
      }).finally(() => worker.terminate());
    } finally {
      if (this.probeAbort === abort) this.probeAbort = undefined;
    }
    if (this.disposing || generation !== this.probeGeneration || !this.ready) return;
    if (!result) { this.scheduleProbes(); return; }
    this.applyProbeResult(result);
  }
  /** An export that ran before the encode probe is the measurement: its own speed over real time. */
  private exportMeasured(request: EngineCommandParsed<"export.start">, frames: number, elapsedMs: number): void {
    if (!this.ready || this.ready.constraints.calibrated || !request.video || frames < 30 || !(elapsedMs > 0)) return;
    const seconds = (frames * request.frameRate.denominator) / request.frameRate.numerator;
    this.applyProbeResult({ encode: { realtime: seconds / (elapsedMs / 1000) }, elapsed: 0 });
  }
  private applyProbeResult(result: ProbeResult): void {
    if (!this.ready) return;
    this.probeResult = result;
    storeProbeResult(result);
    this.ready = { ...this.ready, constraints: this.calibrated(this.ready.constraints, result) };
    this.emit("engine.constraintsChanged", { constraints: this.ready.constraints });
  }

  // ---- recovery ------------------------------------------------------------------------------------------------------

  private recovering: Promise<void> | undefined;
  private panicTimes: number[] = [];
  /** Counts device losses and panics, so that work in flight can tell that the compositor under it was replaced. */
  private generation = 0;
  private unwatch: (() => void) | undefined;

  /** Watches the compositor's device: a lost WebGPU device calls back from the module, a lost WebGL context is an event of its canvas. */
  private watchDevice(): void {
    this.unwatch?.();
    const compositor = this.compositor;
    if (!compositor) return;
    const lost = (message: string) => { if (this.compositor !== compositor) return; const run = this.renderChain.then(() => this.recover("device-lost", message)); this.renderChain = run.catch(() => undefined); };
    const canvas = compositor.canvas as HTMLCanvasElement | OffscreenCanvas;
    const onContextLost = (event: Event) => { event.preventDefault(); lost("the WebGL context was lost"); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    this.unwatch = () => canvas.removeEventListener("webglcontextlost", onContextLost);
    if (compositor.info.backend === "webgpu") { try { compositor.onDeviceLost((message) => lost(message || "the GPU device was lost")); } catch { /* an older module */ } }
  }

  /**
   * `render-engine.Wasm panic capture and recovery` and `GPU device-lost recovery`: the last frame stays on the
   * surface, every texture cache key and render target goes, a new compositor is made on the same backend (WebGL2
   * after three failures on WebGPU, then none), and the current frame is rendered again. The scene, the playhead
   * and the transport are untouched. Three panics inside 60 s stop the retries.
   */
  private recover(kind: "panic" | "device-lost", message: string): Promise<void> {
    return this.recovering ??= (async () => {
      try {
        this.generation++;
        this.emit("engine.error", { code: kind === "panic" ? "engine/wasm-panic" : "engine/device-lost", message, fatal: false });
        const old = this.compositor, before = this.ready?.backend ?? "none", init = this.initPayload;
        this.unwatch?.();
        this.unwatch = undefined;
        if (!old || !init || before === "none") return;
        const size = { width: old.canvas.width, height: old.canvas.height };
        this.compositor = undefined;
        if (kind === "panic") {
          const now = this.now();
          this.panicTimes = [...this.panicTimes.filter((time) => now - time < 60_000), now];
          if (this.panicTimes.length >= 3 && this.memoryClass !== "mobile") {
            this.emit("engine.error", { code: "engine/wasm-panic-loop", message: "the engine panicked three times within 60 s and was stopped", fatal: true });
            return;
          }
          // The trapped instance is discarded with everything in it; the faces are loaded into the new one.
          this.wasm = await reloadWasm(this.options.wasmUrl);
          await this.fonts.reload();
          this.measured.clear();
        } else {
          try { old.destroy(); } catch { /* the device is gone already */ }
        }
        const create = (forceBackend: "webgl2" | undefined) => CompositorDriver.create({ wasmUrl: this.options.wasmUrl, width: size.width, height: size.height, forceBackend, textureBudget: POOL_BUDGETS[this.memoryClass].textures });
        let made: CompositorDriver | undefined;
        for (let attempt = 0; attempt < 3 && !made; attempt++) made = await create(before === "webgl2" ? "webgl2" : init.forceBackend).catch(() => undefined);
        // WebGPU that does not come back three times gives way to WebGL2; the module may also have fallen back by itself.
        if (!made && before === "webgpu") made = await create("webgl2").catch(() => undefined);
        if (!made || made.info.backend !== before) {
          const backend = made?.info.backend ?? "none";
          if (this.ready) this.ready = { ...this.ready, backend, software: made?.info.software ?? false };
          this.emit("engine.backendChanged", { backend, software: made?.info.software ?? false });
        }
        if (!made) return;
        this.compositor = made;
        this.watchDevice();
        if (this.options.host) {
          const canvas = made.canvas;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          // The canvas that held the last presented frame is replaced only now, by the one the next frame goes to.
          this.options.host.replaceChildren(canvas);
        }
        this.contentVersion++;
        this.invalidate();
      } finally {
        this.recovering = undefined;
      }
    })();
  }

  /** Uploads an offline tile for every missing picture of a frame and returns `missing texture id → tile texture id`. */
  private async offlineTiles(built: BuiltFrame, missing: ReadonlySet<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const requests: TextureRequest[] = [];
    for (const texture of built.textures) {
      if (!missing.has(texture.id) || (texture.kind !== "video" && texture.kind !== "image") || !texture.elementId) continue;
      const quad = built.layouts.get(texture.elementId);
      if (!quad) continue;
      const unsupported = this.failedAssets.get(texture.assetId) === "unsupported";
      const id = `offline:${unsupported}:${Math.round(quad.width)}x${Math.round(quad.height)}`;
      out.set(texture.id, id);
      requests.push({ id, kind: "color", rgba: [0, 0, 0, 0] });
      this.tileSpecs.set(id, { width: quad.width, height: quad.height, label: unsupported ? this.offlineTile.unsupportedLabel : this.offlineTile.offlineLabel });
    }
    if (requests.length > 0) {
      await this.compositor!.sync(requests, async (tile) => {
        const spec = this.tileSpecs.get(tile.id)!;
        const canvas = rasterOfflineTile(spec.width, spec.height, this.offlineTile.fill, this.offlineTile.hatch);
        // The label is laid out and drawn by the engine's own text path, centred on the tile, when a face is loaded.
        const chain = this.fonts.chain("sans-serif");
        if (this.wasm && chain.ids.length > 0) {
          const text: TextSpec = { content: spec.label, fonts: chain.ids, size: Math.max(10, Math.min(spec.height / 8, spec.width / 12)), letterSpacing: 0, lineHeight: 1.2, align: "center", color: "#ffffff", underline: false, strikethrough: false };
          const measured = measureText(this.wasm, text);
          if (measured) {
            const label = rasterText(this.wasm, text, measured);
            canvas.getContext("2d")!.drawImage(label, (canvas.width - measured.layout.width) / 2 - measured.originX, (canvas.height - measured.layout.height) / 2 - measured.originY);
          }
        }
        return { key: `${tile.id}:${chain.ids.join(",")}`, width: canvas.width, height: canvas.height, source: await straightBitmap(canvas) };
      }, true);
    }
    return out;
  }
  private readonly tileSpecs = new Map<string, { width: number; height: number; label: string }>();

  /**
   * Decodes source frames of an asset for filmstrips, one at a time and below the preview: a thumbnail waits
   * whenever a preview frame is being rendered, and `thumbnails.cancel` stops the request before its next frame.
   */
  private thumbnails(payload: EngineCommandParsed<"thumbnails.request">): { requestId: string } {
    const chosen = this.variantFor(payload.assetId, false);
    if (!chosen) throw new EngineFailure("media/unavailable", `asset ${payload.assetId} has no source on this device`, { assetId: payload.assetId });
    const job = { cancelled: false };
    this.thumbnailJobs.set(payload.requestId, job);
    void (async () => {
      // A session of its own: the preview keeps its decoder position.
      const session = await this.sessions.acquire(`${payload.assetId}:thumbnails`, chosen.url);
      for (const time of payload.times) {
        while (!job.cancelled && (this.renderInFlight || this.playing)) await new Promise((resolve) => setTimeout(resolve, 15));
        if (job.cancelled) break;
        try {
          const frame = await session.frameAt(time, "exact");
          if (!frame || job.cancelled) continue;
          const scale = payload.longSide / Math.max(frame.width, frame.height);
          const canvas = new OffscreenCanvas(Math.max(1, Math.round(frame.width * scale)), Math.max(1, Math.round(frame.height * scale)));
          canvas.getContext("2d")!.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height);
          const buffer = await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 })).arrayBuffer();
          if (job.cancelled) break;
          this.emit("thumbnails.ready", { requestId: payload.requestId, assetId: payload.assetId, time, width: canvas.width, height: canvas.height }, [buffer]);
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.thumbnailJobs.delete(payload.requestId);
    })();
    return { requestId: payload.requestId };
  }

  private frameTime(position: number): number {
    const scene = this.scene(this.activeSceneId);
    const fps = this.document!.settings.fps;
    return Math.min(floorToFrame(Math.max(0, Math.round(position)), fps), lastFrameTime(sceneDuration(scene), fps));
  }

  /**
   * Renders the frame at the transport position when anything that decides it changed since the last render.
   * Calls are served one after another, each against the state it finds: a seek that arrives while a frame is
   * rendering gets its own frame, and an unchanged scene costs no draw.
   */
  private present(exact: boolean): Promise<void> {
    const run = this.presentChain.then(() => this.presentNow(exact));
    this.presentChain = run.catch(() => undefined);
    return run;
  }

  private async presentNow(exact: boolean): Promise<void> {
    if (!this.compositor || !this.document || !this.visible || this.exporting || this.disposing) return;
    const level = this.level;
    const size = this.previewSize(level);
    // The compositor canvas is the preview's backing store. Its initial size predates the stage's first
    // ResizeObserver measurement, so keep it aligned with the real device-pixel render size on every preview.
    if (this.compositor.canvas.width !== size.width || this.compositor.canvas.height !== size.height) this.compositor.resize(size.width, size.height);
    const time = this.frameTime(this.position);
    const signature = `${this.contentVersion}:${this.activeSceneId}:${time}:${this.revision}:${JSON.stringify(this.overrides)}:${size.width}x${size.height}:${level}`;
    // A frame decoded in scrub mode may be a nearby one: an exact request renders again.
    if (signature === this.lastRendered && (this.lastExact || !exact)) return;
    this.renderInFlight = true;
    const revision = this.revision;
    try {
      const { renderMs } = await this.renderFrame({ time, exact, size, quality: "preview", sceneId: this.activeSceneId });
      this.lastRendered = signature;
      this.lastExact = exact;
      this.emit("frame.ready", { time, revision, exact, renderMs });
      if (this.playing) {
        const frameMs = (frameDuration(this.document.settings.fps) * 1000) / TICKS_PER_SECOND;
        if (this.quality === "auto" && this.governor.record(renderMs, frameMs)) this.emitState();
        this.sample(renderMs);
      }
    } finally {
      this.renderInFlight = false;
    }
  }

  private sample(renderMs: number): void {
    if (!this.perfEnabled) return;
    this.perfSamples.push(renderMs);
    if (this.perfSamples.length < 60) return;
    const sorted = [...this.perfSamples].sort((a, b) => a - b);
    const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    this.emit("perf.sample", {
      frames: sorted.length, path: "preview",
      spans: { renderFrame: { mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] } },
      counters: this.counters, pools: { video: this.sessions.bytes, textures: this.compositor?.textureBytes ?? 0, images: this.images.bytes, text: 0 },
      effectiveQuality: this.level,
    });
    this.perfSamples = [];
  }

  /** Something that decides the frame changed: render again unless the loop is already running. */
  private invalidate(): void {
    if (!this.document || this.playing) return;
    void this.present(true).catch((error) => this.fail(error));
  }

  private fail(error: unknown): void {
    if (error instanceof EngineFailure) this.emit("diagnostic", { id: error.code, severity: "error", message: error.message, details: error.details });
    else throw error;
  }

  // ---- transport -----------------------------------------------------------------------------------------------------

  /** The one playback clock: the audio clock while audio runs, a monotonic clock otherwise. */
  private clockPosition(): number {
    if (this.audioClock) return this.audio.position();
    return this.startPosition + ((this.now() - this.startClock) * this.rate * TICKS_PER_SECOND) / 1000;
  }

  private audioReader(): AudioSources {
    // A sound this device cannot decode stays silent in the preview and is reported once, as the asset's status.
    return this.audioSources ??= new AudioSources((assetId) => this.variantFor(assetId, false)?.url, { missing: "silence", onUnplayable: (assetId) => this.status(assetId, "unsupported") });
  }

  /** (Re)starts the clock at the current position. Audio plays at rate 1; at other rates and in reverse it is muted. */
  private async restartClock(): Promise<void> {
    const duration = sceneDuration(this.scene(this.activeSceneId));
    const end = this.loop.enabled ? Math.min(this.loop.outTime ?? duration, duration) : duration;
    this.audioClock = false;
    this.audio.stop();
    if (this.rate === 1) {
      const clips = collectMixClips(this.document!, this.activeSceneId, { honourSolo: true });
      this.audioOutput = await this.audio.start(clips, this.audioReader().read, Math.round(this.position), end);
      this.audioClock = this.audioOutput;
    }
    this.startPosition = this.position;
    this.startClock = this.now();
  }
  private rebase(): void {
    if (!this.playing) return;
    this.startPosition = this.clockPosition();
    this.startClock = this.now();
  }
  private emitState(reason?: "user" | "ended" | "audio-interrupted"): void {
    this.emit("transport.state", { playing: this.playing, rate: this.rate, loop: this.loop.enabled, ...(reason ? { reason } : {}), effectiveQuality: this.level, audioOutput: this.audioOutput });
  }

  private async seek(payload: EngineCommandParsed<"transport.seek">): Promise<void> {
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    this.position = Math.min(payload.time, sceneDuration(this.scene(this.activeSceneId)));
    if (this.playing) { await this.restartClock(); return; }
    this.scrubSound(payload);
    if (this.compositor) {
      const before = this.lastRendered;
      const token = ++this.seekToken;
      await this.present(payload.mode === "exact");
      // A scrub frame may show nearby pictures; once the playhead rests, the exact frame follows.
      if (payload.mode === "scrub") setTimeout(() => { if (token === this.seekToken && !this.playing) void this.present(true).catch((error) => this.fail(error)); }, SCRUB_SETTLE_MS);
      // A seek always answers with a frame: when nothing changed, the frame on the surface is reported again.
      if (this.lastRendered === before && before !== "") this.emit("frame.ready", { time: this.frameTime(this.position), revision: this.revision, exact: this.lastExact, renderMs: 0 });
    }
    this.emit("transport.time", { time: this.frameTime(this.position), rate: this.rate, playing: false, audioClock: false });
  }

  /** Scrub audio: one snippet of the mix at the new position, at most every 50 ms; a frame step plays one frame. */
  private scrubSound(payload: EngineCommandParsed<"transport.seek">): void {
    if (!this.scrubAudio || !this.document || (payload.mode === "exact" && !payload.frameStep)) return;
    const now = this.now();
    if (!payload.frameStep && now - this.lastSnippet < 50) return;
    this.lastSnippet = now;
    const seconds = payload.frameStep ? mediaTimeToSeconds(frameDuration(this.document.settings.fps)) : 0.08;
    const clips = collectMixClips(this.document, this.activeSceneId, { honourSolo: true });
    void this.audio.snippet(clips, this.audioReader().read, this.position, seconds).then((played) => { if (played) this.snippets++; });
  }
  /** Scrub snippets played since the engine started. */
  snippets = 0;
  /** The master-bus tap of the live output, for meters and tests. */
  get audioAnalyser(): AnalyserNode | undefined { return this.audio.analyser; }
  get audioScheduledAhead(): number { return this.audio.scheduledAhead; }

  private async play(fromTime?: number): Promise<void> {
    this.interruptProbes();
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    const duration = sceneDuration(this.scene(this.activeSceneId));
    if (fromTime !== undefined) this.position = fromTime;
    // Play from a position at or past the end restarts at 0, or at the loop in-point.
    if (this.position >= duration && this.rate > 0) this.position = this.loop.enabled ? this.loop.inTime ?? 0 : 0;
    this.seekToken++;
    const token = ++this.playToken;
    // Pre-roll: the frame at the start position is on screen and every decoder is positioned before the clock
    // starts, so the first frames of playback are not lost to key-frame seeks.
    if (this.compositor && this.visible) await this.present(true).catch((error) => this.fail(error));
    if (token !== this.playToken) return;
    this.playing = true;
    await this.restartClock();
    if (!this.playing) return;
    this.lastPlayedFrame = -1;
    this.governor.reset();
    this.emitState();
    this.stopLoop();
    const tick = () => {
      if (!this.playing) return;
      this.animationFrame = requestAnimationFrame(tick);
      void this.playTick().catch((error) => this.fail(error));
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private async playTick(): Promise<void> {
    if (!this.playing || !this.document) return;
    const scene = this.scene(this.activeSceneId);
    const duration = sceneDuration(scene);
    const fps = this.document.settings.fps;
    let position = this.clockPosition();
    const loopOut = this.loop.enabled ? Math.min(this.loop.outTime ?? duration, duration) : duration;
    if (this.rate > 0 && position >= loopOut) {
      if (this.loop.enabled) {
        position = this.loop.inTime ?? 0;
        this.position = position;
        // Audio is rescheduled across the wrap.
        await this.restartClock();
      } else {
        // The transport pauses at exactly the scene duration; the frame on screen is the last one.
        this.playing = false;
        this.stopLoop();
        this.audio.stop();
        const audioClock = this.audioClock;
        this.audioClock = false;
        this.position = duration;
        await this.present(true);
        this.emit("transport.time", { time: duration, rate: this.rate, playing: false, audioClock });
        this.emitState("ended");
        this.emit("transport.ended", { time: duration });
        return;
      }
    } else if (this.rate < 0 && position <= 0) {
      this.position = 0;
      this.pause("ended");
      return;
    }
    this.position = position;
    const time = this.frameTime(position);
    const frame = mediaTimeToFrame(time, fps);
    if (frame === this.lastPlayedFrame || this.renderInFlight) return;
    // A render that finished after the playhead moved on by more than one frame skipped the frames in between.
    if (this.lastPlayedFrame >= 0 && Math.abs(frame - this.lastPlayedFrame) > 1) this.droppedFrames += Math.abs(frame - this.lastPlayedFrame) - 1;
    this.lastPlayedFrame = frame;
    if (this.compositor && this.visible) await this.present(false);
    this.emit("transport.time", { time, rate: this.rate, playing: true, audioClock: this.audioClock });
  }

  private stopLoop(): void {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  private pause(reason: "user" | "ended" | "audio-interrupted"): void {
    this.playToken++;
    if (this.playing) this.position = Math.max(0, this.clockPosition());
    this.playing = false;
    this.audioClock = false;
    this.audio.stop();
    this.stopLoop();
    this.emitState(reason);
    // Paused frames are re-rendered at full quality.
    this.invalidate();
  }

  // ---- queries, stills -----------------------------------------------------------------------------------------------

  private layoutQuery(payload: EngineCommandParsed<"layout.query">): { boxes: Record<string, { x: number; y: number; width: number; height: number; rotation: number }> } {
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    const { canvasSize } = this.document.settings;
    const built = buildFrame({ document: this.document, sceneId: this.activeSceneId, time: payload.time, render: canvasSize, overrides: this.overrides, text: this.textServices });
    const boxes: Record<string, { x: number; y: number; width: number; height: number; rotation: number }> = {};
    for (const id of payload.elementIds) {
      const quad = built.layouts.get(id);
      if (quad) boxes[id] = { ...quadBounds(quad), rotation: quad.rotationDegrees };
    }
    return { boxes };
  }

  /**
   * The mean sRGB colour of the `size × size` neighbourhood of an element's source picture under a canvas point at
   * the current time: the element alone, cropped, flipped and placed, before its chroma key and everything after it.
   */
  private sampleSource(payload: EngineCommandParsed<"layout.sampleSource">): Promise<{ color: string; rgba: [number, number, number, number] }> {
    if (!this.compositor) throw new EngineFailure("engine/no-gpu", "no GPU backend is available");
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    const compositor = this.compositor, document = this.document;
    const run = this.renderChain.then(async () => {
      const { canvasSize } = document.settings;
      const size = this.previewSize("full"), time = this.frameTime(this.position);
      const request: RenderRequest = { time, exact: true, size, quality: "preview", sceneId: this.activeSceneId };
      const built = buildFrame({ document, sceneId: this.activeSceneId, time, render: size, quality: "preview", overrides: this.overrides, text: this.textServices, lutSize: this.lutSize, personMatte: this.personMatte, stickerAnimated: this.stickerAnimated });
      const texture = built.textures.find((candidate) => "elementId" in candidate && candidate.elementId === payload.elementId && (candidate.kind === "video" || candidate.kind === "image") && !("next" in candidate && candidate.next));
      const find = (items: FrameItem[]): LayerItem | undefined => {
        for (const item of items) {
          const found = item.type === "layer" ? (item.textureId === texture?.id ? item : undefined) : item.type === "group" ? find(item.items) : item.type === "transition" ? [item.from, item.to].find((side) => side.textureId === texture?.id) : undefined;
          if (found) return found;
        }
        return undefined;
      };
      const layer = texture && find(built.descriptor.items);
      if (!texture || !layer) throw new EngineFailure("surface/invalid-payload", `element ${payload.elementId} has no source picture at the current time`, { elementId: payload.elementId });
      const missing = await compositor.sync([texture], (wanted) => this.resolveTexture(wanted, request), true);
      if (missing.size > 0) throw new EngineFailure("media/unavailable", "the source frame of the element is unavailable", { elementId: payload.elementId });
      compositor.render({ version: 3, width: size.width, height: size.height, clear: { color: [0, 0, 0, 0] }, items: [layerItem(layer.textureId, layer.transform, layer.boxInverse, { crop: layer.crop })] });
      const side = payload.size, half = (side - 1) / 2;
      const x = Math.min(Math.max(Math.round((payload.x * size.width) / canvasSize.width - 0.5) - half, 0), Math.max(size.width - side, 0)), y = Math.min(Math.max(Math.round((payload.y * size.height) / canvasSize.height - 0.5) - half, 0), Math.max(size.height - side, 0));
      const width = Math.min(side, size.width), height = Math.min(side, size.height);
      const pixels = await compositor.readPixels(x, y, width, height);
      // The mean is taken over the pixels the picture covers, weighted by their alpha.
      const sum = [0, 0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) { const alpha = pixels[index + 3] / 255; sum[0] += pixels[index] * alpha; sum[1] += pixels[index + 1] * alpha; sum[2] += pixels[index + 2] * alpha; sum[3] += alpha; }
      const rgba: [number, number, number, number] = sum[3] > 0 ? [Math.round(sum[0] / sum[3]), Math.round(sum[1] / sum[3]), Math.round(sum[2] / sum[3]), Math.round((sum[3] / (width * height)) * 255)] : [0, 0, 0, 0];
      return { color: `#${rgba.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`, rgba };
    });
    this.renderChain = run.catch(() => undefined);
    // The preview frame is drawn again over the sample.
    void run.catch(() => undefined).then(() => { this.contentVersion++; this.invalidate(); });
    return run;
  }

  private still(payload: EngineCommandParsed<"still.render">): { requestId: string } {
    if (!this.compositor) throw new EngineFailure("engine/no-gpu", "no GPU backend is available");
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    const sceneId = payload.sceneId ?? this.document.scenes.find((scene) => scene.isMain)!.id;
    const scene = this.scene(sceneId);
    const { canvasSize, fps } = this.document.settings;
    const size = { width: payload.width ?? canvasSize.width, height: payload.height ?? canvasSize.height };
    if (Math.max(size.width, size.height) > Math.min(4096, this.compositor.info.maxTextureSize)) throw new EngineFailure("surface/invalid-payload", "a still is at most 4 096 px on a side");
    const time = Math.min(floorToFrame(payload.time, fps), lastFrameTime(sceneDuration(scene), fps));
    const format = payload.format ?? "png";
    void (async () => {
      try {
        const { missingAssets } = await this.renderFrame({
          time, exact: true, size, quality: payload.source === "original" ? "export" : "preview", sceneId, committedOnly: payload.committedOnly,
          includeCaptions: payload.includeCaptions, original: payload.source === "original", allowMissingMedia: payload.allowMissingMedia, placeholders: payload.placeholders,
        });
        const pixels = await this.compositor!.readPixels(0, 0, size.width, size.height);
        const canvas = new OffscreenCanvas(size.width, size.height);
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength), size.width, size.height), 0, 0);
        const blob = await canvas.convertToBlob(format === "png" ? { type: "image/png" } : { type: "image/jpeg", quality: (payload.quality ?? 90) / 100 });
        const buffer = await blob.arrayBuffer();
        this.emit("still.done", { requestId: payload.requestId, width: size.width, height: size.height, format, bytes: buffer.byteLength, ...(payload.placeholders ? { missingAssets } : {}) }, [buffer]);
      } catch (error) {
        const failure = error instanceof EngineFailure ? error : new EngineFailure("media/unavailable", String((error as Error).message ?? error));
        this.emit("still.failed", { requestId: payload.requestId, code: failure.code, message: failure.message, details: failure.details });
      } finally {
        this.contentVersion++;
        this.invalidate();
      }
    })();
    return { requestId: payload.requestId };
  }

  // ---- export --------------------------------------------------------------------------------------------------------

  private exportOf(exportId: string): ExportState {
    if (!this.exporting || this.exporting.id !== exportId) throw new EngineFailure("surface/invalid-payload", `no export ${exportId} is running`);
    return this.exporting;
  }

  private startExport(payload: EngineCommandParsed<"export.start">): { exportId: string } {
    if (!this.ready || !this.compositor) throw new EngineFailure("engine/no-gpu", "no GPU backend is available for an on-device export");
    if (!this.document) throw new EngineFailure("surface/invalid-payload", "no scene is set");
    if (this.exporting || this.workerExport) throw new EngineFailure("surface/invalid-payload", "an export is already running");
    checkExportRequest(payload, this.ready);
    // A derived input a stage needs and that was not delivered fails the export before anything is rendered.
    const mattes = personMatteAssets(this.document as never, (type) => effectDefinition(type)?.requires === "person-matte").filter((assetId) => !this.matteSource(assetId)).map(personMatteKey);
    if (mattes.length > 0) throw new EngineFailure("export/derived-unavailable", `derived inputs are unavailable: ${mattes.join(", ")}`, { keys: mattes });
    this.interruptProbes();
    // The session renders an immutable snapshot: edits made while it runs do not reach it.
    const document = structuredClone(this.document);
    const sceneId = payload.sceneId ?? document.scenes.find((scene) => scene.isMain)!.id;
    const scene = document.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new EngineFailure("surface/invalid-payload", `scene ${sceneId} does not exist`);
    const range = payload.range ?? { start: 0, end: sceneDuration(scene) };
    // On web and desktop the session runs in a worker with a compositor of its own; the preview goes on.
    if (this.options.exportWorker && this.memoryClass !== "mobile" && typeof Worker !== "undefined") {
      void this.runExportInWorker(payload, document, sceneId);
      return { exportId: payload.exportId };
    }
    let signalCancel!: () => void;
    const cancelledSignal = new Promise<void>((resolve) => { signalCancel = resolve; });
    const state: ExportState = this.exporting = { id: payload.exportId, cancelled: false, paused: false, cancelledSignal, signalCancel };
    if (this.playing) this.pause("user");
    void this.runExport(payload, document, sceneId, range, state);
    return { exportId: payload.exportId };
  }

  /**
   * An export in its own worker (`render-engine.Export render session`): the worker's engine is given the sources,
   * the fonts and the snapshot, runs the same `export.start`, and its export events leave through this engine. No
   * texture, render target or decoder is shared with the preview.
   */
  private async runExportInWorker(request: EngineCommandParsed<"export.start">, document: ProjectDocument, sceneId: string): Promise<void> {
    const worker = this.options.exportWorker!();
    const port = new EngineSurfacePort({ validate: false, send: (message, transfer) => worker.postMessage({ message }, transfer ?? []) });
    let settled = false;
    const made: string[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      this.workerExport = undefined;
      for (const url of made) URL.revokeObjectURL(url);
      // The worker's GPU resources go with it.
      void port.command("engine.dispose", {}).catch(() => undefined).finally(() => { worker.terminate(); port.close("the export session ended"); });
    };
    const fail = (code: EngineError["code"], message: string) => { if (!settled) this.emit("export.failed", { exportId: request.exportId, code, message }); finish(); };
    this.workerExport = { id: request.exportId, send: (type) => port.command(type, { exportId: request.exportId }) };
    worker.onmessage = (event: MessageEvent) => { if (event.data?.message) port.receive(event.data.message, event.data.buffers); };
    // A worker that dies (a wasm trap, memory) fails the export; the preview engine is untouched.
    worker.onerror = (event: ErrorEvent) => { event.preventDefault?.(); fail("export/engine-panic", `the export worker stopped: ${event.message ?? "error"}`); };
    port.on("export.progress", (payload) => this.emit("export.progress", payload));
    port.on("export.chunk", (payload, transfer) => this.emit("export.chunk", payload, transfer));
    port.on("export.done", (payload) => { this.emit("export.done", payload); this.exportMeasured(request, payload.frameCount, payload.elapsedMs); finish(); });
    port.on("export.failed", (payload) => { this.emit("export.failed", payload); finish(); });
    port.on("diagnostic", (payload) => this.emit("diagnostic", payload));
    try {
      const init = this.initPayload!;
      worker.postMessage({ boot: { wasmUrl: this.options.wasmUrl === undefined ? undefined : String(new URL(String(this.options.wasmUrl), globalThis.location?.href)) } });
      // The same backend as the preview, so that the export is the picture the user saw.
      await port.command("engine.init", { ...init, width: request.width, height: request.height, devicePixelRatio: 1, allowSoftware: this.ready?.software ? true : init.allowSoftware, forceBackend: this.ready?.backend === "webgl2" ? "webgl2" : init.forceBackend });
      await port.command("media.setSources", { sources: [...this.sources].map(([assetId, source]) => ({ ...source, assetId })) as never });
      // A worker has no image element: an SVG sticker is drawn here once and handed over as a bitmap file.
      const entries = await Promise.all([...this.derived.values()].map(async (entry) => {
        if (entry.kind !== "sticker" || typeof Image === "undefined") return entry;
        try {
          const blob = await (await fetch(entry.url)).blob();
          if (blob.type !== "image/svg+xml" && !new TextDecoder().decode(await blob.slice(0, 256).arrayBuffer()).includes("<svg")) return entry;
          const image = new Image(), source = URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: "image/svg+xml" }));
          try {
            image.src = source;
            await image.decode();
            const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1, long = 2048;
            const canvas = new OffscreenCanvas(aspect >= 1 ? long : Math.max(1, Math.round(long * aspect)), aspect >= 1 ? Math.max(1, Math.round(long / aspect)) : long);
            canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
            const url = URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
            made.push(url);
            return { ...entry, url };
          } finally {
            URL.revokeObjectURL(source);
          }
        } catch {
          return entry;
        }
      }));
      await port.command("derived.setSources", { entries: entries as never });
      await port.command("fonts.setSources", { fonts: this.fontSources });
      await port.command("scene.set", { revision: 1, activeSceneId: sceneId, document: document as never });
      await port.command("export.start", { ...request, sceneId } as never);
    } catch (error) {
      const failure = error as { code?: EngineError["code"]; message?: string };
      fail(failure.code ?? "export/engine-panic", failure.message ?? String(error));
    }
  }

  private async runExport(request: EngineCommandParsed<"export.start">, document: ProjectDocument, sceneId: string, range: { start: number; end: number }, state: ExportState): Promise<void> {
    const started = this.now();
    const frameCount = request.video ? exportFrameCount(range.end - range.start, request.frameRate) : 0;
    const size = { width: request.width, height: request.height };
    const streamId = `export-${request.exportId}`;
    let seq = 0, bytes = 0, lastProgress = 0, framesDone = 0;
    const progress = (stage: "rendering" | "audio" | "finalising" | "paused", force = false) => {
      if (!force && this.now() - lastProgress < 250) return;
      lastProgress = this.now();
      this.emit("export.progress", { exportId: request.exportId, stage, framesDone, frameCount, ...(stage === "paused" ? { reason: "user" as const } : {}) });
    };
    let writer: Awaited<ReturnType<typeof createExportWriter>> | undefined;
    let fallbackFonts: string[] = [];
    try {
      writer = await createExportWriter(request, (data, position) => {
        bytes = Math.max(bytes, position + data.byteLength);
        const copy = data.slice();
        this.emit("export.chunk", { exportId: request.exportId, streamId, seq: seq++, bytes: copy.byteLength, position }, [copy.buffer]);
      });
      // Text is not rasterised before its font has loaded: an export waits up to 15 s for the faces it uses.
      fallbackFonts = await this.fontsSettled(document, 15_000);
      this.fontWaitOff = true;
      if (fallbackFonts.length > 0 && !request.allowFontFallback) throw new EngineFailure("export/font-unavailable", `fonts are unavailable: ${fallbackFonts.join(", ")}`, { families: fallbackFonts });
      const aiLabel = request.aiLabel && request.video ? rasterAiLabel(size, request.aiLabel.text, request.aiLabel.fontFamily) : undefined;
      // The export renders its own snapshot through the compositor while the preview is suspended.
      for (let index = 0; index < frameCount; index++) {
        if (state.paused) {
          progress("paused", true);
          await new Promise<void>((resolve) => { state.resume = resolve; });
        }
        if (state.cancelled) break;
        // A device lost under a frame: the frame is rendered once more after the recovery, and the export fails if that is lost too.
        let pixels: Uint8Array | undefined;
        for (let tries = 0; !pixels; tries++) {
          const generation = this.generation;
          try {
            await this.renderFrame({ time: exportFrameTime(range.start, index, request.frameRate), exact: true, size, quality: "export", sceneId, committedOnly: true, includeCaptions: request.includeCaptions, original: true, allowMissingMedia: request.allowMissingMedia, waivedAssetIds: request.waivedAssetIds, document });
            const read = await this.compositor!.readPixels(0, 0, size.width, size.height);
            await this.renderChain;
            if (generation === this.generation) pixels = read;
          } catch (error) {
            await this.renderChain;
            if (generation === this.generation || error instanceof EngineFailure && error.code === "export/engine-panic") throw error;
          }
          if (!pixels && (tries >= 1 || !this.compositor)) throw new EngineFailure("export/device-lost", "the GPU device was lost during the export");
        }
        if (aiLabel) blendAiLabel(pixels, size.width, size.height, aiLabel);
        await writer.addVideoFrame(pixels, index);
        framesDone = index + 1;
        progress("rendering");
        // Yield so that pause and cancel commands are handled between frames.
        if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (request.audio && !state.cancelled) {
        // A sound that is not here or cannot be decoded fails the export by the clip's name — unless leaving out THAT
        // media was waived for this export by name, like for the pictures. Waiving one picture silences no sound.
        const sources = new AudioSources((assetId) => this.sources.get(assetId)?.original ?? this.sources.get(assetId)?.mezzanine, { missing: "fail", waived: (assetId) => mediaWaived(request, assetId) });
        const mixClips = collectMixClips(document, sceneId);
        try {
          let written = 0;
          for await (const block of mixdownBlocks({
            clips: mixClips, read: sources.read, start: range.start, end: range.end, sampleRate: request.audio.sampleRate, channels: request.audio.channels,
            isCancelled: () => state.cancelled, onProgress: () => progress("audio"),
          })) {
            await writer.addAudio(block, written);
            written += block[0].length;
          }
        } catch (error) {
          if (!(error instanceof AudioSourceError)) throw error;
          const clips = this.clipsOf(document, mixClips.filter((clip) => clip.assetId === error.assetId).map((clip) => ({ elementId: clip.elementId, assetId: clip.assetId }) as unknown as TextureRequest));
          throw new EngineFailure("media/unavailable", error.reason === "undecodable" ? "the sound of a clip cannot be decoded" : "the sound of a clip is unavailable", { sound: error.reason, assetId: error.assetId, clips });
        } finally {
          sources.dispose();
        }
      }
      if (state.cancelled) {
        void writer.cancel().catch(() => undefined);
        this.emit("export.failed", { exportId: request.exportId, code: "export/interrupted", message: "the export was cancelled", details: { cancelled: true } });
        return;
      }
      progress("finalising", true);
      // Finalising waits on the encoders and muxer, but Cancel and the one-minute deadline can interrupt that wait.
      const finalise = await finalizeOrCancel(writer, state.cancelledSignal);
      if (finalise === "cancelled") {
        this.emit("export.failed", { exportId: request.exportId, code: "export/interrupted", message: "the export was cancelled", details: { cancelled: true } });
        return;
      }
      if (finalise === "timed-out") {
        this.emit("export.failed", { exportId: request.exportId, code: "export/finalising-timeout", message: "Export finalising did not make progress for 60 seconds. Retry the export." });
        return;
      }
      this.emit("export.done", { exportId: request.exportId, frameCount: framesDone, duration: range.end - range.start, bytes, elapsedMs: this.now() - started, fallbackFonts, diagnostics: [] });
      this.exportMeasured(request, framesDone, this.now() - started);
    } catch (error) {
      await writer?.cancel().catch(() => undefined);
      const failure = error instanceof EngineFailure ? error : isTrap(error) ? new EngineFailure("export/engine-panic", panicMessage(error)) : new EngineFailure("export/write-failed", String((error as Error)?.message ?? error));
      this.emit("export.failed", { exportId: request.exportId, code: failure.code, message: failure.message, details: failure.details });
    } finally {
      this.fontWaitOff = false;
      this.exporting = undefined;
      this.contentVersion++;
      this.invalidate();
    }
  }

  // ---- memory --------------------------------------------------------------------------------------------------------

  private async trim(): Promise<void> {
    await this.renderChain.catch(() => undefined);
    this.images.clear();
    this.compositor?.trim();
  }
}

const isTrap = (error: unknown): boolean => typeof WebAssembly !== "undefined" && error instanceof WebAssembly.RuntimeError;
/** The panic hook leaves the message and location of a panic on the global object; the trap itself only says "unreachable". */
const panicMessage = (error: unknown): string => String((globalThis as { __wasmPanic?: string }).__wasmPanic ?? (error as Error)?.message ?? error);

/** Replaces texture ids of layers (also inside transitions and groups) by the map. */
function retextured(items: FrameItem[], map: ReadonlyMap<string, string>): FrameItem[] {
  if (map.size === 0) return items;
  const layer = <T extends { textureId: string }>(item: T): T => (map.has(item.textureId) ? { ...item, textureId: map.get(item.textureId)!, crop: { left: 0, top: 0, right: 0, bottom: 0 }, key: null } : item);
  return items.map((item) => {
    if (item.type === "layer") return layer(item);
    if (item.type === "transition") return { ...item, from: layer(item.from), to: layer(item.to) };
    if (item.type === "group") return { ...item, items: retextured(item.items, map) };
    return item;
  });
}

/** Drops the items whose texture could not be produced; a transition without one of its sides is dropped whole. */
function withoutTextures(items: FrameItem[], missing: ReadonlySet<string>): FrameItem[] {
  const out: FrameItem[] = [];
  for (const item of items) {
    if (item.type === "layer") {
      if (missing.has(item.textureId)) continue;
      // Without its matte frame a body effect is a pass-through; without its table a filter is.
      const matte = item.personMatte && !missing.has(item.personMatte.textureId) ? item.personMatte : null;
      const groups = matte ? item.effectPassGroups : item.effectPassGroups.filter((group) => !group.some((pass) => pass.textures?.aux === "@matte"));
      out.push({ ...item, blendSource: item.blendSource && !missing.has(item.blendSource.textureId) ? item.blendSource : null, personMatte: matte, effectPassGroups: groups, filter: item.filter && !missing.has(item.filter.textureId) ? item.filter : null, masks: item.masks.filter((mask) => !missing.has(mask.textureId)) });
    } else if (item.type === "transition") {
      if (missing.has(item.from.textureId) || missing.has(item.to.textureId)) continue;
      out.push(item);
    } else if (item.type === "group") out.push({ ...item, items: withoutTextures(item.items, missing) });
    else out.push({ ...item, filter: item.filter && !missing.has(item.filter.textureId) ? item.filter : null, masks: item.masks.filter((mask) => !missing.has(mask.textureId)) });
  }
  return out;
}

/** Whether a hardware-accelerated context exists: WebGPU with a non-fallback adapter, or WebGL2 without a major performance caveat. */
async function hasHardwareContext(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(options: object): Promise<{ info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance", forceFallbackAdapter: false });
    if (adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter)) return true;
  } catch { /* WebGPU is absent or refused; WebGL2 decides. */ }
  try {
    return new OffscreenCanvas(1, 1).getContext("webgl2", { failIfMajorPerformanceCaveat: true }) !== null;
  } catch {
    return false;
  }
}
