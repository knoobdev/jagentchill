import { useSyncExternalStore } from "react";
import { FX_PREFS, FX_SAMPLES, FX_SCENE_ID, fxStillSize, withCatalogueScene, type FxKind, type FxThumbRequest } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { imageUrl, releaseImageUrl } from "../../platform/store";
import { coverPreview, nextPaint, previewSize } from "./dom";
import { getPref, setPref } from "../../state";
import type { EditorRuntime } from "../runtime";

/**
 * What the Effects, Filters and Transitions tabs, the timeline's transition handles and their inspectors share for one
 * open project: which transition is selected, what a "Replace" is waiting for, what is being dragged from a tab, and
 * the pictures of the tiles.
 */
export type FxReplace = { kind: "transition"; transitionId: string } | { kind: "layer"; elementId: string; entryKind: "effect" | "filter" } | null;
export type FxDrag = { kind: FxKind; type: string; preset?: string } | null;
export type FxState = {
  transitionId: string | null; replace: FxReplace; drag: FxDrag;
  /** The cut or the clip a dragged tile would land on. */
  dropCut: string | null; dropClip: string | null;
  /** Raised by Enter on a selected transition: the inspector focuses its duration field. */
  focusDuration: number;
  /** The duration a resize drag shows next to the handle. */
  resizeTip: { transitionId: string; text: string } | null;
};
const EMPTY: FxState = { transitionId: null, replace: null, drag: null, dropCut: null, dropClip: null, focusDuration: 0, resizeTip: null };
const TILE_BATCH = 6, RETRIES = 4;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createFxStore(runtime: EditorRuntime) {
  let state = EMPTY, version = 0;
  const listeners = new Set<() => void>();
  const emit = () => { version++; for (const listener of [...listeners]) listener(); };
  const set = (change: Partial<FxState>) => { state = { ...state, ...change }; emit(); };
  // Selecting an element deselects the transition, and a transition that is gone (an undo, a deleted clip) is not selected.
  runtime.controller.subscribe(() => {
    if (state.transitionId === null && state.replace === null) return;
    const { controller } = runtime;
    const gone = state.transitionId !== null && (controller.session.selection.selectedElements.length > 0 || !timeline.findTransition(controller.document, state.transitionId));
    const stale = state.replace !== null && (state.replace.kind === "transition" ? !timeline.findTransition(controller.document, state.replace.transitionId) : !timeline.locate(controller.document, state.replace.elementId));
    if (gone || stale) set({ ...(gone ? { transitionId: null } : {}), ...(stale ? { replace: null } : {}) });
  });

  // — The pictures of the tiles: rendered by the engine from a scene of their own, a batch at a time, kept for the session —
  const pictures = new Map<string, string[]>(), pending = new Map<string, FxThumbRequest>();
  let running = false, closed = false;
  const sources = Object.values(FX_SAMPLES).map((sample) => ({ assetId: sample.id, original: typeof window !== "undefined" && window.location ? new URL(sample.url, window.location.href).href : sample.url }));
  const idle = (document: ProjectDocument) => document;
  async function still(time: number, size: { width: number; height: number }): Promise<string | null> {
    for (let attempt = 0; attempt < RETRIES && !closed; attempt++) {
      const bytes = await runtime.engine?.still(time, "jpeg", FX_SCENE_ID, size).catch(() => null);
      if (bytes) return imageUrl(bytes, "image/jpeg");
      // The scene may still be on its way to the engine.
      await wait(120 * (attempt + 1));
    }
    return null;
  }
  /** A picture of the frame the preview shows, laid over it for as long as the engine's canvas is busy with tiles. */
  async function cover(): Promise<() => void> {
    const size = previewSize(), engine = runtime.engine;
    if (!size || !engine) return () => {};
    const bytes = await engine.still(runtime.controller.session.playhead, "jpeg", runtime.controller.session.sceneId, size).catch(() => null);
    const url = bytes ? imageUrl(bytes, "image/jpeg") : null;
    if (!url) return () => {};
    const remove = coverPreview(url);
    return () => { remove(); releaseImageUrl(url); };
  }
  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending.size > 0 && !closed) {
        // Tiles wait for a running engine and never take frames from a playback.
        if (!runtime.engine || runtime.transport.engine !== "ready" || runtime.transport.playing) { if (runtime.transport.engine === "no-gpu" || runtime.transport.engine === "unsupported") return; await wait(250); continue; }
        const batch = [...pending.values()].slice(0, TILE_BATCH), stored = runtime.controller.stored, edits = runtime.controller.version;
        const built = withCatalogueScene(stored, batch), scene = built.document.scenes[built.document.scenes.length - 1], assets = built.document.media.assets.slice(stored.media.assets.length);
        const uncover = await cover();
        try {
          await runtime.setEngineExtras({ sources, decorate: (document) => ({ ...document, scenes: [...document.scenes, scene], media: { ...document.media, assets: [...document.media.assets, ...assets] } }) });
          for (const [index, request] of batch.entries()) {
            const size = fxStillSize(stored.settings.canvasSize, 96), frames: string[] = [];
            for (const time of built.slots[index].times) { const url = await still(time, size); if (!url) break; frames.push(url); }
            // A tile whose picture could not be rendered keeps its icon; it is not asked for again.
            pictures.set(request.key, frames.length === built.slots[index].times.length ? frames : []);
            pending.delete(request.key);
            emit();
            // An edit or a seek made meanwhile is shown before more tiles are rendered.
            if (closed || runtime.controller.version !== edits || runtime.transport.playing) break;
          }
        } finally {
          if (!closed) {
            await runtime.setEngineExtras({ sources, decorate: idle });
            await runtime.engine?.seek(runtime.controller.session.playhead, "exact").catch(() => undefined);
            await nextPaint();
          }
          uncover();
        }
        if (runtime.controller.version !== edits) await wait(400);
      }
    } finally {
      running = false;
      if (pending.size > 0 && !closed && runtime.transport.engine === "ready") void pump();
    }
  }

  const store = {
    get state(): FxState { return state; },
    get version(): number { return version; },
    set,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    /** Selects a transition (its inspector opens) and deselects elements; `null` deselects. */
    selectTransition(transitionId: string | null): void {
      if (transitionId !== null && runtime.controller.session.selection.selectedElements.length > 0) runtime.controller.select(timeline.selectElements([]));
      set({ transitionId, ...(transitionId === null ? { replace: null } : {}) });
    },
    /** The pictures of a tile: one still, or the frames of its animation. `undefined` while they render; empty when they cannot. */
    pictures(request: FxThumbRequest): string[] | undefined {
      const canvas = runtime.controller.stored.settings.canvasSize, key = `${request.key}|${request.animated ? "a" : "s"}|${canvas.width}x${canvas.height}|${JSON.stringify(request.params ?? {})}`;
      const known = pictures.get(key);
      if (known) return known;
      if (!pending.has(key)) { pending.set(key, { ...request, key }); void pump(); }
      return undefined;
    },
    close(): void { closed = true; for (const frames of pictures.values()) for (const url of frames) releaseImageUrl(url); pictures.clear(); pending.clear(); listeners.clear(); },
  };
  return store;
}
export type FxStore = ReturnType<typeof createFxStore>;

const stores = new WeakMap<EditorRuntime, FxStore>();
/** The store of an open project; made on first use and dropped with the project's runtime. */
export function fxOf(runtime: EditorRuntime): FxStore {
  let store = stores.get(runtime);
  if (!store) { store = createFxStore(runtime); stores.set(runtime, store); }
  return store;
}
/** Re-renders on every change of the store; returns it. */
export function useFx(runtime: EditorRuntime): FxStore {
  const store = fxOf(runtime);
  useSyncExternalStore(store.subscribe, () => store.version, () => 0);
  return store;
}

// — What the device keeps —
export const libraryState = (): timeline.LibraryState => getPref(FX_PREFS.library);
export function noteApplied(kind: FxKind, type: string): void { setPref(FX_PREFS.library, timeline.pushRecent(getPref(FX_PREFS.library), kind, type)); }
/** The star of a tile; the message when the list is full. */
export function toggleFavourite(kind: FxKind, type: string): string | undefined {
  const next = timeline.toggleFavourite(getPref(FX_PREFS.library), kind, type);
  if (!next.message) setPref(FX_PREFS.library, next.state);
  return next.message;
}
