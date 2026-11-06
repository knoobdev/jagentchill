/** The preview engine of web and desktop: the same-thread `EngineSurface` mounted in the player; an export runs in a worker of its own. The native one is `preview-engine.ts`. */
import type { ProjectDocument } from "@jagentchill/protocol";
import { engineFontSources, type FontSource } from "@jagentchill/app-core";
import { createEngineSurface, type EngineSurface } from "@jagentchill/render";
import { BUNDLED_FACES } from "./fonts.gen";
import { ofThisBuild } from "../platform/buildTag";

export type EngineState = "starting" | "ready" | "no-gpu" | "unsupported" | "stopped";
export type TransportEvent = { time: number; playing: boolean; rate: number; audioClock: boolean };
export type EngineEvents = {
  onState(state: EngineState, detail?: string): void;
  onTime(event: TransportEvent): void;
  onTransport(state: { playing: boolean; rate: number; loop: boolean; reason?: string; effectiveQuality?: string; audioOutput?: boolean }): void;
  onEnded(time: number): void;
  onFrame(frame: { time: number; revision: number }): void;
  onMedia?(assets: { assetId: string; status: string }[]): void;
  /** Something the engine drew differently from what was asked (optical flow rendered as frame blending). */
  onDiagnostic?(diagnostic: { id: string; elementId?: string }): void;
};
export type EngineInit = { width: number; height: number; devicePixelRatio: number; locale: string; offlineTile: { fill: string; hatch: string; offlineLabel: string; unsupportedLabel: string } };
export type LayoutBox = { x: number; y: number; width: number; height: number; rotation: number };
export type PreviewEngine = ReturnType<typeof build>;
const WASM_URL = "/wasm/opencut_wasm_bg.wasm";
// The export session's worker script and the clip of the decode probe, written to the public folder by
// `scripts/sync-engine-assets.mjs`: served as they are by the dev server and by the production bundle.
const EXPORT_WORKER_URL = "/engine/export-worker.js", PROBE_CLIP_URL = "/engine/decode-1080p30.mp4";
// The worker, and every file of the build the engine or its worker loads, is asked for with this page's build on its
// address (`platform/buildTag.ts`): another tab may already run a newer build, and a worker must never get its files.
const exportWorker = (): Worker => new Worker(new URL(ofThisBuild(EXPORT_WORKER_URL), window.location.href), { type: "module", name: "jagentchill-export" });
const absolute = (fonts: FontSource[]) => fonts.map((font) => ({ ...font, url: new URL(ofThisBuild(font.url), window.location.href).href }));

function build(surface: EngineSurface, events: EngineEvents) {
  const { port } = surface;
  let revision = 0, sending = false, queued: { document: ProjectDocument; sceneId: string } | null = null, disposed = false, stills = 0;
  // An export renders the snapshot of its job: while it is handed over, the editor's document waits and returns afterwards.
  let held = false, latest: { document: ProjectDocument; sceneId: string } | null = null;
  const quiet = (work: Promise<unknown>) => work.catch(() => undefined);
  const flush = async () => {
    if (sending || !queued || disposed || held) return;
    sending = true;
    while (queued && !disposed) {
      const { document, sceneId } = queued;
      queued = null;
      // The engine never receives device-local data.
      const { local: _local, ...canonical } = document as ProjectDocument & { local?: unknown };
      await quiet(port.command("scene.set", { revision: ++revision, activeSceneId: sceneId, document: JSON.parse(JSON.stringify(canonical)) as Record<string, unknown> }));
    }
    sending = false;
  };
  const off = [
    port.on("transport.time", (payload) => events.onTime(payload)),
    port.on("transport.state", (payload) => events.onTransport(payload)),
    port.on("transport.ended", (payload) => events.onEnded(payload.time)),
    port.on("frame.ready", (payload) => events.onFrame(payload)),
    port.on("media.status", (payload) => events.onMedia?.(payload.assets)),
    port.on("diagnostic", (payload) => events.onDiagnostic?.({ id: payload.id, ...(payload.elementId ? { elementId: payload.elementId } : {}) })),
    port.on("engine.error", (payload) => { if (payload.fatal) events.onState(payload.code === "engine/unsupported-runtime" ? "unsupported" : "stopped", payload.message); }),
  ];
  return {
    /** The document the preview shows: the latest one wins when several arrive within one render. */
    setDocument(document: ProjectDocument, sceneId: string): void { queued = latest = { document, sceneId }; void flush(); },
    /** The port of the engine and what it reported when it became ready, for the export jobs of `export-share`. */
    port, ready: null as Record<string, unknown> | null,
    /** Runs `work` while the engine holds `document` in place of the editor's; the editor's document is sent again afterwards. */
    async withDocument<T>(document: ProjectDocument, sceneId: string, work: () => Promise<T>): Promise<T> {
      held = true;
      while (sending) await new Promise((resolve) => setTimeout(resolve, 4));
      const { local: _local, ...canonical } = document as ProjectDocument & { local?: unknown };
      try {
        await port.command("scene.set", { revision: ++revision, activeSceneId: sceneId, document: JSON.parse(JSON.stringify(canonical)) as Record<string, unknown> });
        return await work();
      } finally { held = false; if (latest) queued = latest; void flush(); }
    },
    setSources: (sources: { assetId: string; original?: string; proxy?: string }[]) => quiet(port.command("media.setSources", { sources })),
    /** The faces the engine may draw text with: the bundled ones it loads at once and the fallback families the project's text needs. */
    setFonts: (fonts: FontSource[]) => quiet(port.command("fonts.setSources", { fonts: absolute(fonts) })),
    seek: (time: number, mode: "scrub" | "exact" = "exact", frameStep = false) => quiet(port.command("transport.seek", { time: Math.max(0, Math.round(time)), mode, ...(frameStep ? { frameStep } : {}) })),
    play: (fromTime?: number) => quiet(port.command("transport.play", fromTime === undefined ? {} : { fromTime: Math.round(fromTime) })),
    pause: () => quiet(port.command("transport.pause", {})),
    setRate: (rate: number) => quiet(port.command("transport.setRate", { rate })),
    setLoop: (enabled: boolean, inTime?: number, outTime?: number) => quiet(port.command("transport.setLoop", { enabled, ...(inTime !== undefined ? { inTime } : {}), ...(outTime !== undefined ? { outTime } : {}) })),
    setVolume: (volume: number, muted: boolean) => quiet(Promise.all([port.command("transport.setVolume", { volume }), port.command("transport.setMuted", { muted })])),
    setQuality: (quality: "auto" | "full" | "half" | "quarter") => quiet(port.command("view.setQuality", { quality })),
    resize: (width: number, height: number, devicePixelRatio: number, zoom: number) => quiet(port.command("view.resize", { width: Math.max(1, width), height: Math.max(1, height), devicePixelRatio, zoom: Math.min(64, Math.max(0.01, zoom)) })),
    /** The canvas bounds of elements at a time, for hit-testing and handles. */
    async layout(elementIds: string[], time: number): Promise<Record<string, LayoutBox>> {
      if (elementIds.length === 0) return {};
      const reply = await port.command("layout.query", { elementIds, time: Math.max(0, Math.round(time)) }).catch(() => null) as { boxes: Record<string, LayoutBox> } | null;
      return reply?.boxes ?? {};
    },
    /** The colour of an element's own picture under a point of the project canvas (pixels), before its chroma key: the mean of a 5 × 5 block. */
    async sampleSource(elementId: string, x: number, y: number): Promise<string | null> {
      const reply = await port.command("layout.sampleSource", { elementId, x, y, size: 5 }).catch(() => null) as { color: string; rgba: number[] } | null;
      return reply && reply.rgba[3] > 0 ? reply.color : null;
    },
    /** A frame at full project resolution, without overlays. */
    still(time: number, format: "png" | "jpeg" = "png", sceneId?: string, size?: { width: number; height: number }): Promise<Uint8Array | null> {
      const requestId = `still-${++stills}`;
      return new Promise((resolve) => {
        const done = port.on("still.done", (payload, transfer) => { if (payload.requestId !== requestId) return; done(); failed(); resolve(transfer?.[0] ? new Uint8Array(transfer[0]) : null); });
        const failed = port.on("still.failed", (payload) => { if (payload.requestId !== requestId) return; done(); failed(); resolve(null); });
        port.command("still.render", { requestId, time: Math.max(0, Math.round(time)), format, source: "original", ...(sceneId ? { sceneId } : {}), ...(size ? { width: size.width, height: size.height, allowMissingMedia: false } : {}) }).catch(() => { done(); failed(); resolve(null); });
      });
    },
    /**
     * A frame for someone who LOOKS at the project (the agent's `jc_frame_render`, a proposal's before/after pair): it is
     * always drawn. Media that is not on this device keeps its place as the tile the preview shows, and is named in
     * `missingAssets`, so that nobody judges a layout by a placeholder without knowing it. `failure` says why no frame came.
     */
    frame(time: number, sceneId: string, size: { width: number; height: number }): Promise<{ bytes: Uint8Array; missingAssets: string[] } | { bytes: null; failure: string }> {
      const requestId = `still-${++stills}`;
      return new Promise((resolve) => {
        const done = port.on("still.done", (payload, transfer) => { if (payload.requestId !== requestId) return; done(); failed(); resolve(transfer?.[0] ? { bytes: new Uint8Array(transfer[0]), missingAssets: (payload as { missingAssets?: string[] }).missingAssets ?? [] } : { bytes: null, failure: "no picture" }); });
        const failed = port.on("still.failed", (payload) => { if (payload.requestId !== requestId) return; done(); failed(); resolve({ bytes: null, failure: `${(payload as { code?: string }).code ?? "engine"}: ${(payload as { message?: string }).message ?? ""}`.slice(0, 300) }); });
        port.command("still.render", { requestId, time: Math.max(0, Math.round(time)), format: "jpeg", source: "original", sceneId, width: size.width, height: size.height, placeholders: true }).catch((error) => { done(); failed(); resolve({ bytes: null, failure: String((error as Error)?.message ?? error).slice(0, 300) }); });
      });
    },
    /** Frames of an asset at source times, as JPEG bytes in the order they are decoded; the returned function cancels what is left. */
    thumbnails(assetId: string, times: number[], longSide: number, onFrame: (time: number, bytes: Uint8Array) => void): () => void {
      const requestId = `thumbs-${++stills}`;
      const stop = port.on("thumbnails.ready", (payload, transfer) => { if (payload.requestId === requestId && transfer?.[0]) onFrame(payload.time, new Uint8Array(transfer[0])); });
      void quiet(port.command("thumbnails.request", { requestId, assetId, times: times.slice(0, 2000), longSide }));
      return () => { stop(); void quiet(port.command("thumbnails.cancel", { requestId })); };
    },
    /**
     * Renders the active scene to an MP4 (H.264, AAC when the scene has sound). The file arrives in positioned
     * chunks and is assembled here; `cancel` stops the export and rejects.
     */
    exportVideo(request: { width: number; height: number; frameRate: { numerator: number; denominator: number }; bitrate?: number; audio: boolean }, onProgress: (progress: { stage: string; framesDone: number; frameCount: number }) => void): { done: Promise<Uint8Array>; cancel(): void } {
      const exportId = `export-${++stills}`;
      let file = new Uint8Array(0), length = 0, cancelled = false;
      const stops: (() => void)[] = [];
      const done = new Promise<Uint8Array>((resolve, reject) => {
        const finish = (work: () => void) => { for (const stop of stops) stop(); work(); };
        stops.push(port.on("export.chunk", (payload, transfer) => {
          if (payload.exportId !== undefined && payload.exportId !== exportId) return;
          const data = transfer?.[0] ? new Uint8Array(transfer[0]) : null;
          if (!data) return;
          const at = payload.position ?? length;
          if (at + data.length > file.length) { const grown = new Uint8Array(Math.max(at + data.length, file.length * 2)); grown.set(file.subarray(0, length)); file = grown; }
          file.set(data, at); length = Math.max(length, at + data.length);
        }));
        stops.push(port.on("export.progress", (payload) => { if (payload.exportId === exportId) onProgress(payload); }));
        stops.push(port.on("export.done", (payload) => { if (payload.exportId === exportId) finish(() => resolve(file.slice(0, length))); }));
        stops.push(port.on("export.failed", (payload) => { if (payload.exportId === exportId) finish(() => reject(new Error(cancelled ? "cancelled" : payload.message))); }));
        port.command("export.start", {
          exportId, width: request.width, height: request.height, frameRate: request.frameRate, container: "mp4", video: { codec: "avc", ...(request.bitrate ? { bitrate: request.bitrate } : {}) },
          ...(request.audio ? { audio: { codec: "aac", sampleRate: 48_000, channels: 2 } } : {}), allowMissingMedia: true, allowFontFallback: true,
        }).catch((error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))));
      });
      return { done, cancel: () => { cancelled = true; void quiet(port.command("export.cancel", { exportId })); } };
    },
    /** Pixels of the rendered frame, for checks that read the picture. */
    /** Where the engine reads derived data (LUT tables) from: the whole list, each time it changes. */
    setDerived: (entries: { key: string; kind: "lut"; url: string; sha256: string }[]) => quiet(port.command("derived.setSources", { entries })),
    /** Render-only overrides of element fields (Compare, the matte view, a hovered mask): the project is not touched. */
    setOverride: (overrides: Record<string, Record<string, unknown>>) => quiet(Object.keys(overrides).length > 0 ? port.command("preview.setOverride", { overrides }) : port.command("preview.clearOverride", {})),
    /** A block of the rendered frame around a point of it (fractions 0–1), as RGBA bytes. */
    readBlock: async (x: number, y: number, side = 5): Promise<number[] | null> => { try { const size = surface.engine.renderSize; if (!size) return null; const left = Math.min(size.width - side, Math.max(0, Math.floor(x * size.width) - (side >> 1))), top = Math.min(size.height - side, Math.max(0, Math.floor(y * size.height) - (side >> 1))); return Array.from(await surface.engine.readPixels(left, top, side, side)); } catch { return null; } },
    readPixel: async (x: number, y: number): Promise<number[] | null> => { try { const size = surface.engine.renderSize; if (!size) return null; return Array.from(await surface.engine.readPixels(Math.floor(x * size.width), Math.floor(y * size.height), 1, 1)); } catch { return null; } },
    /** Stops the engine. The compositor's GPU context is one per page, so the next engine starts only after this one is gone. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const stop of off) stop();
      queue = queue.then(() => quiet(port.command("engine.dispose", {}))).then(() => port.close());
    },
  };
}
/** Engines of a page start and stop one after another: they share the compositor's GPU context. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Starts the engine in `host`. The state it lands in is reported through `onState`; a missing GPU is a state, not an
 * error. `cancelled` is asked before and after the start, so an editor that closed meanwhile leaves no engine behind.
 */
export function openPreviewEngine(host: unknown, init: EngineInit, events: EngineEvents, cancelled: () => boolean = () => false): Promise<PreviewEngine | null> {
  const run = queue.then(async () => {
    if (cancelled()) return null;
    const engine = await start(host, init, events);
    if (engine && cancelled()) { engine.dispose(); return null; }
    return engine;
  });
  queue = run.catch(() => null);
  return run;
}
async function start(host: unknown, init: EngineInit, events: EngineEvents): Promise<PreviewEngine | null> {
  const element = host as HTMLElement | null;
  if (!element) return null;
  events.onState("starting");
  const surface = createEngineSurface(element, { wasmUrl: ofThisBuild(WASM_URL), validate: false, ...(typeof Worker === "undefined" ? {} : { exportWorker, probeClipUrl: ofThisBuild(PROBE_CLIP_URL) }) });
  let backend = "none", report: Record<string, unknown> | null = null;
  const ready = surface.port.on("engine.ready", (payload) => { backend = payload.backend; report = payload as unknown as Record<string, unknown>; });
  try {
    await surface.port.command("engine.init", { width: Math.max(16, Math.round(init.width)), height: Math.max(16, Math.round(init.height)), devicePixelRatio: init.devicePixelRatio, platform: "web", memoryClass: "web", locale: init.locale, allowSoftware: true, offlineTile: init.offlineTile });
  } catch (error) {
    ready();
    const code = (error as { code?: string } | null)?.code;
    events.onState(code === "engine/unsupported-runtime" ? "unsupported" : "stopped", error instanceof Error ? error.message : String(error));
    return null;
  }
  ready();
  // The faces loaded with the engine; the fallback families of other scripts follow when a project's text needs them.
  await surface.port.command("fonts.setSources", { fonts: absolute(engineFontSources(BUNDLED_FACES, [])) }).catch(() => undefined);
  const engine = build(surface, events);
  engine.ready = report;
  events.onState(backend === "none" ? "no-gpu" : "ready");
  return engine;
}
