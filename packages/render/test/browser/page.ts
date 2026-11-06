// The page side of the browser tests: the engine bundle plus small helpers, reachable as `window.jc`.
import * as editorCore from "@jagentchill/editor-core";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import * as render from "../../src/index.ts";

type Opened = Awaited<ReturnType<typeof open>>;

/** A blob URL of a canvas drawn by `draw`, encoded as PNG. */
async function imageUrl(width: number, height: number, draw: (context: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  draw(canvas.getContext("2d")!);
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
}

/** Creates a surface in a fresh host element, initialises the engine and sets the document. */
async function open(document: unknown, view: { width: number; height: number; forceBackend?: "webgl2"; /** Exports run in the worker session. */ exportWorker?: boolean; /** The deferred probes get their bundled clip. */ probeClip?: boolean }, sources: { assetId: string; original?: string; proxy?: string }[] = [], setup?: (port: ReturnType<typeof render.createEngineSurface>["port"]) => Promise<unknown>) {
  const host = window.document.createElement("div");
  host.style.cssText = `width:${view.width}px;height:${view.height}px`;
  window.document.body.appendChild(host);
  const surface = render.createEngineSurface(host, { wasmUrl: "/wasm/opencut_wasm_bg.wasm", validate: true, ...(view.exportWorker ? { exportWorker: () => new Worker("/export-worker.js", { type: "module" }) } : {}), ...(view.probeClip ? { probeClipUrl: "/assets/probe/decode-1080p30.mp4" } : {}) });
  const events: { type: string; payload: any }[] = [];
  surface.port.onAny((event) => { events.push({ type: event.type, payload: event.payload }); });
  let ready: any;
  surface.port.on("engine.ready", (payload) => { ready = payload; });
  // Headless Chromium rasterises in software, so the tests allow a software context.
  await surface.port.command("engine.init", { width: view.width, height: view.height, devicePixelRatio: 1, platform: "web", memoryClass: "web", locale: "en", allowSoftware: true, forceBackend: view.forceBackend });
  if (sources.length > 0) await surface.port.command("media.setSources", { sources });
  // Fonts and derived assets a test wants in place before the first frame.
  if (setup) await setup(surface.port);
  const doc = document as { scenes: { id: string; isMain: boolean }[] };
  await surface.port.command("scene.set", { revision: 1, activeSceneId: doc.scenes.find((scene) => scene.isMain)!.id, document: document as Record<string, unknown> });
  const waitFor = (type: string, after = 0, timeoutMs = 20_000) => new Promise<any>((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const found = events.slice(after).find((event) => event.type === type);
      if (found) resolve(found.payload);
      else if (performance.now() - started > timeoutMs) reject(new Error(`no ${type} event; saw ${events.slice(after).map((event) => event.type).join(", ")}`));
      else setTimeout(check, 5);
    };
    check();
  });
  // `scene.set` renders the frame at the playhead: wait for it, so that later frames are told apart from it.
  if (ready?.backend !== "none") await waitFor("frame.ready");
  /** Seeks exactly to a time and returns pixel readers over the rendered frame. */
  const frameAt = async (time: number) => {
    const mark = events.length;
    await surface.port.command("transport.seek", { time, mode: "exact" });
    const frame = await waitFor("frame.ready", mark);
    const size = surface.engine.renderSize!;
    const pixels = await surface.engine.readPixels(0, 0, size.width, size.height);
    return { frame, size, at: (x: number, y: number) => Array.from(pixels.slice((y * size.width + x) * 4, (y * size.width + x) * 4 + 4)), pixels };
  };
  return { host, surface, events, ready: () => ready, waitFor, frameAt, port: surface.port, engine: surface.engine };
}

/** A new 30 fps project with a main video track; `canvas` is the project canvas size. */
function project(canvas: { width: number; height: number }, background: unknown = { kind: "color", color: "#000000" }) {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "main", now_ms: 0, canvasSize: canvas, fps: { numerator: 30, denominator: 1 }, background: background as never });
  return JSON.parse(JSON.stringify(doc));
}
const asset = (id: string, type: "image" | "video" | "audio", fields: Record<string, unknown> = {}) => ({ id, name: id, type, kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "imported", attributionRequired: false, referenceAssetIds: [] }, motionTracks: [], faces: [], created_ms: 0, ...fields });
const element = (type: string, fields: Record<string, unknown>) => JSON.parse(JSON.stringify(createElement(type as never, { name: String(fields.id), ...fields } as never)));
const track = (type: string, id: string, elements: unknown[], fields: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(createTrack(type as never, { id, name: id, ...fields } as never))), elements });

const jc = { ...render, editorCore, open, project, asset, element, track, imageUrl };
(window as unknown as { jc: typeof jc }).jc = jc;
export type Jc = typeof jc;
export type { Opened };
