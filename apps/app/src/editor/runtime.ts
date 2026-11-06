import {
  actionForKey, clampAfterEdit, documentTexts, dropTargetAt, EDITOR_PREFS, engineFontSources, engineVolume, loopRegion, playStart, runEditorAction, seekActionOf, setVolume, shuttle, SHUTTLE_IDLE, toggleMute, zoomAction,
  type ActionHost, type EditorController, type TimelineRow, type PreviewQuality, type ShuttleState, type Volume,
} from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { createPacedStore } from "./paced-store";
import type { MediaSession } from "../media/session";
import { imageUrl, releaseImageUrl } from "../platform/store";
import { isMac, type KeyInfo } from "./dom";
import { BUNDLED_FACES } from "./fonts.gen";
import type { EngineState, PreviewEngine } from "./preview-engine";

export type TransportState = { time: number; playing: boolean; rate: number; menuRate: number; loop: boolean; volume: Volume; quality: PreviewQuality; effectiveQuality: string; engine: EngineState; engineDetail?: string; audioOutput: boolean; /** Advances for an intentional seek, so held inspectors can ignore clock ticks but follow seeks during playback. */ seekRevision?: number };
export type EditorDialog =
  | { kind: "scenes" } | { kind: "crop" } | { kind: "replace-media"; elementId: string } | { kind: "rename-element"; elementId: string } | { kind: "keyframe-graph" }
  | { kind: "delete-track"; trackId: string; text: string } | { kind: "marker"; markerId: string } | { kind: "export" } | { kind: "shortcuts" } | { kind: "cover" };
type Prefs = { get<T>(pref: { key: string; fallback: T }): T; set<T>(pref: { key: string; fallback: T }, value: T): void };

/**
 * What the regions of the editor share for one open project: the controller, the transport, the device preferences
 * and the action entry that toolbar buttons, menus and keys all go through.
 */
/** What the inspector's tools and the canvas share: the open tool, the mask being edited, the compare view, the graph editor. */
export type ToolState = {
  /** The inspector tab and sub-tab in view; the canvas shows mask handles only while the Mask sub-tab is. */
  inspector: string | null; maskId: string | null; maskPoints: string[];
  graph: boolean; crop: string | null; textEdit: string | null;
  compare: "off" | "hold" | "split"; split: number; matte: boolean; eyedropper: boolean;
  /** A mask drawn for a hovered menu item, without touching the project. */
  hoverMask: { elementId: string; mask: Record<string, unknown> } | null;
};
/** A tool that takes the canvas pointer before selection and transform do. `undefined` from `down`: not mine. */
export type CanvasTool = { hidesHandles: boolean; down(info: { x: number; y: number; shift: boolean; alt: boolean; mod: boolean; detail: number }): { move?(info: never): void; up?(info: never): void; cancel?(): void } | null | undefined; double?(info: { x: number; y: number }): boolean; key?(key: KeyInfo): boolean };
export type LutSource = { key: string; kind: "lut"; url: string; sha256: string };
export type DerivedSource = { key: string; kind: string; url: string; sha256: string };
export function createEditorRuntime(options: { controller: EditorController; media: MediaSession; prefs: Prefs; luts?: import("./inspector/luts").LutStore; toast(message: string, kind?: "error" | "info"): void; t(text: string, values?: Record<string, string | number>): string }) {
  const { controller, prefs } = options;
  const listeners = new Set<() => void>(), transportListeners = new Set<() => void>();
  let engine: PreviewEngine | null = null, shuttleState: ShuttleState = SHUTTLE_IDLE, dialog: EditorDialog | null = null, viewportWidth = 1000, uiVersion = 0;
  let player: { act(actionId: string): boolean; space(held: boolean): void } | null = null;
  let sentSources = "", sourcesPending = false, sourcesSeen = options.media.sourcesVersion(), sourcing: Promise<void> | null = null;
  let sentFonts = "";
  let revealed: { assetId: string; nonce: number } | null = null;
  let tool: ToolState = { inspector: null, maskId: null, maskPoints: [], graph: false, crop: null, textEdit: null, compare: "off", split: 0.5, matte: false, eyedropper: false, hoverMask: null };
  let canvasTool: CanvasTool | null = null, sentLuts: unknown = null, sentOverride = "{}";
  // What a capability adds to the engine's own copy of the project (the library tiles render from a scene of theirs): never stored, never shown.
  let previewLoopFrom: number | null = null, previewOnce: (() => void) | null = null;
  // What the engine said it drew differently, by diagnostic id and element.
  const diagnostics = new Set<string>();
  // Actions of capabilities whose commands live outside the action table (transitions, effects): asked first.
  const actionHandlers = new Set<(actionId: string, payload: { trackId?: string; time?: number; elementId?: string }) => boolean>();
  let engineExtras: { decorate(document: ProjectDocument): ProjectDocument; sources: { assetId: string; original: string }[] } | null = null;
  // The engine takes its derived sources as one replace-all list: every family (LUT tables, stickers, mattes) keeps its own group here and the union is sent.
  const derivedGroups = new Map<string, DerivedSource[]>();
  function setDerivedGroup(group: string, entries: DerivedSource[]): void { derivedGroups.set(group, entries); void engine?.setDerived([...derivedGroups.values()].flat() as never); }
  /** The LUT tables of the project, handed to the engine whenever the list changes. */
  function syncLuts(): void {
    if (!engine || !options.luts) return;
    // The tables in use: the project's list and whatever an element names (a built-in one is in no list).
    const shown = controller.document, used: string[] = ((shown.media as { luts?: { id: string }[] }).luts ?? []).map((lut) => lut.id);
    for (const scene of shown.scenes) for (const track of [scene.tracks.main, ...scene.tracks.overlay]) for (const element of track.elements as unknown as { adjustments?: { lut?: { lutId?: string } } }[]) if (element.adjustments?.lut?.lutId) used.push(element.adjustments.lut.lutId);
    const luts = used.join("|");
    if (sentLuts === luts) return;
    sentLuts = luts;
    const target = engine;
    void options.luts.sources(controller.document).then((entries) => { if (engine === target) setDerivedGroup("luts", entries); });
  }
  /** View-only changes of the picture: Compare bypasses the look of the selection, the matte view shows the key's alpha, a hovered menu item shows its mask. */
  function syncOverride(): void {
    if (!engine) return;
    const overrides: Record<string, Record<string, unknown>> = {}, shown = controller.document;
    if (tool.compare === "hold") for (const id of controller.session.selection.selectedElements) { const element = timeline.locate(shown, id)?.element; if (element) overrides[id] = { adjustments: { basic: { enabled: false }, hsl: { enabled: false }, curves: { enabled: false }, wheels: { enabled: false }, lut: { enabled: false } } }; }
    // "Show matte" is a view of the selected clip's key: its alpha as greyscale.
    if (tool.matte) for (const id of controller.session.selection.selectedElements) { const chroma = timeline.locate(shown, id)?.element.chromaKey as { enabled?: boolean } | undefined; if (chroma?.enabled) overrides[id] = { ...overrides[id], chromaKey: { showMatte: true } }; }
    if (tool.hoverMask) { const element = timeline.locate(shown, tool.hoverMask.elementId)?.element; if (element) overrides[tool.hoverMask.elementId] = { ...overrides[tool.hoverMask.elementId], masks: [...((element.masks ?? []) as unknown[]), tool.hoverMask.mask] }; }
    const key = JSON.stringify(overrides);
    if (key === sentOverride) return;
    sentOverride = key;
    void engine.setOverride(overrides);
  }
  let sent: { scenes: unknown; settings: unknown; assets: unknown; sceneId: string } | null = null, sentAssets: unknown = null, focusScope: "editor" | "preview" = "editor";
  let transport: TransportState = {
    time: controller.session.playhead, playing: false, rate: 1, menuRate: 1, loop: prefs.get(EDITOR_PREFS.loop), volume: prefs.get(EDITOR_PREFS.volume), quality: prefs.get(EDITOR_PREFS.quality), seekRevision: 0,
    effectiveQuality: "full", engine: "starting", audioOutput: false,
  };
  // Three counts. `uiVersion` moves on every change. `contentVersion` does not move for a change of the timeline's own
  // view (its scroll, zoom and playhead are stored beside the project's content, so they come as a change of the
  // document) nor for a filmstrip frame arriving: the regions that show the project and the selection — the inspector,
  // the canvas overlays — read it, and a scroll or a seek does not render them again. `documentVersion` does not move
  // for a selection either: the screen around the regions (its bar, its dialogs) reads that one.
  let contentVersion = 0, documentVersion = 0;
  const emit = (only?: "view" | "selection") => { uiVersion++; if (only !== "view") contentVersion++; if (only === undefined) documentVersion++; for (const listener of [...listeners]) listener(); };
  const same = (a: unknown[], b: unknown[]): boolean => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const documentOf = (): unknown[] => {
    const shown = controller.document as unknown as Record<string, unknown>, stored = controller.stored as unknown as Record<string, unknown>, session = controller.session;
    const local = (shown.local ?? {}) as Record<string, unknown>, view = (local.timelineViewState ?? {}) as { expandedKeyframeElementIds?: unknown };
    return [
      ...Object.keys(shown).filter((key) => key !== "local").flatMap((key) => [shown[key], stored[key]]),
      JSON.stringify({ ...local, timelineViewState: view.expandedKeyframeElementIds }),
      session.canUndo, session.canRedo, session.undoLabel, session.redoLabel, controller.clipboard.isEmpty,
    ];
  };
  const selectionOf = (): unknown[] => [controller.session.selection, controller.session.cursorMode];
  let seenDocument: unknown[] = [], seenSelection: unknown[] = [];
  /** What a notification of the controller changed: the project, only the selection, or only the timeline's view. */
  const changeOf = (): "view" | "selection" | undefined => {
    const document = documentOf(), selection = selectionOf(), only = !same(document, seenDocument) ? undefined : !same(selection, seenSelection) ? "selection" as const : "view" as const;
    seenDocument = document; seenSelection = selection;
    return only;
  };
  // What React is shown of the transport moves in step with React while playing (`paced-store.ts`): the engine's clock
  // ticks on every frame, and a tree that renders slower than that was forced to render again from the effects of every
  // commit ("Maximum update depth exceeded" in a development build). Whoever listens outside React gets every tick.
  const shownTransport = createPacedStore<TransportState>(transport, { later: (run, ms) => setTimeout(run, ms), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });
  const setTransport = (change: Partial<TransportState>) => {
    // Only the running clock may wait: a change of anything else (play, pause, a seek, the engine's state) is shown at once.
    const clock = transport.playing && Object.keys(change).every((key) => key === "time");
    transport = { ...transport, ...change };
    shownTransport.set(transport, clock);
    for (const listener of [...transportListeners]) listener();
  };
  const doc = (): ProjectDocument => controller.stored;
  const fps = (): Rational => doc().settings.fps as Rational;
  const duration = (): number => timeline.sceneDurationOf(timeline.sceneById(doc(), controller.session.sceneId));
  const timelinePrefs = (): timeline.TimelinePreferences => prefs.get(EDITOR_PREFS.timeline);

  /**
   * Hands the engine what changed: the media sources when the assets did, then the scene data. The sources go
   * first, because the engine keeps the offline tile of a clip it drew before it knew where the clip's media is.
   */
  function syncEngine(): void {
    if (!engine) return;
    const shown = controller.document;
    if (sentAssets !== shown.media.assets) { sentAssets = shown.media.assets; sourcing = syncSources().then(() => { sourcing = null; sendScene(); if (options.media.sourcesVersion() !== sourcesSeen) resource(); }); return; }
    if (!sourcing) sendScene();
  }
  function sendScene(): void {
    if (!engine) return;
    const shown = controller.document, sceneId = controller.session.sceneId;
    if (sent && sent.scenes === shown.scenes && sent.settings === shown.settings && sent.assets === shown.media && sent.sceneId === sceneId) return;
    sent = { scenes: shown.scenes, settings: shown.settings, assets: shown.media, sceneId };
    // A fallback family is handed over the first time the project's text needs one of its glyphs.
    const fonts = engineFontSources(BUNDLED_FACES, documentTexts(shown)), fontsKey = fonts.map((font) => font.fontId).join(",");
    if (fontsKey !== sentFonts) { sentFonts = fontsKey; void engine.setFonts(fonts); }
    syncLuts();
    engine.setDocument(engineExtras ? engineExtras.decorate(shown) : shown, sceneId);
    if (!transport.playing) void engine.seek(controller.session.playhead, "exact");
  }
  /**
   * The engine reads each asset from the URL of its bytes on this device. A URL that is not there yet (the library is
   * still opening its files after a reload) is asked for again when the library reports a change.
   */
  async function syncSources(): Promise<void> {
    const target = engine, assets = controller.document.media.assets;
    if (!target) return;
    sourcesSeen = options.media.sourcesVersion();
    const sources = await Promise.all(assets.map(async (asset) => ({ assetId: asset.id, original: (await options.media.mediaUrl(asset.id).catch(() => null)) ?? undefined })));
    if (engine !== target) return;
    const ready = [...sources.filter((source) => source.original !== undefined), ...(engineExtras?.sources ?? [])], key = JSON.stringify(ready);
    sourcesPending = sources.some((source) => source.original === undefined);
    if (key === sentSources) return;
    sentSources = key;
    await target.setSources(ready);
  }
  // Media that arrived late is drawn by setting the scene again.
  // So is media whose file was replaced by a better one (the original of a clip that played from its proxy): the
  // library's `sourcesVersion` has moved, and every URL is asked for again.
  function resource(): void {
    if (sourcing || (!sourcesPending && options.media.sourcesVersion() === sourcesSeen)) return;
    sourcing = syncSources().then(() => { sourcing = null; sent = null; sendScene(); if (options.media.sourcesVersion() !== sourcesSeen) resource(); });
  }
  const unsubscribeMedia = options.media.subscribe(resource);
  const unsubscribe = controller.subscribe(() => {
    syncEngine();
    if (tool.matte) syncOverride();
    if (transport.playing) {
      // An edit that shortens the scene under the playhead clamps it and pauses.
      const clamped = clampAfterEdit(transport.time, duration(), true);
      if (clamped.pause) { void engine?.pause(); setTransport({ time: clamped.playhead, playing: false }); }
    } else if (transport.time !== controller.session.playhead) {
      setTransport({ time: controller.session.playhead });
      void engine?.seek(controller.session.playhead, controller.session.gestureActive ? "scrub" : "exact");
    }
    emit(changeOf());
  });

  function pause(): void {
    if (!transport.playing) return;
    void engine?.pause();
    setTransport({ playing: false });
    controller.seek(timeline.seekTime(transport.time, duration(), fps()));
  }
  function play(rate = transport.menuRate): void {
    const region = loopRegion(doc(), controller.session.sceneId);
    const start = playStart({ playhead: transport.playing ? transport.time : controller.session.playhead, duration: duration(), loop: transport.loop, region, rate });
    if (start === null || !engine) return;
    void engine.setLoop(transport.loop, region.start, region.end);
    void engine.setRate(rate);
    void engine.play(start);
    setTransport({ playing: true, rate, time: start });
  }
  /** A seek that also works under playback: it continues from the new time. */
  function seek(time: number): void {
    const target = timeline.seekTime(time, duration(), fps());
    if (transport.playing) { setTransport({ time: target, seekRevision: (transport.seekRevision ?? 0) + 1 }); void engine?.play(target); } else controller.seek(target);
  }

  const host: ActionHost = {
    controller, prefs: timelinePrefs, setPrefs: (next) => { prefs.set(EDITOR_PREFS.timeline, next); emit(); }, viewportWidth: () => viewportWidth,
    message: (text, values) => options.toast(options.t(text, values), "info"), pause,
    open(what, payload) {
      if (what === "scenes") dialog = { kind: "scenes" };
      else if (what === "crop") tool = { ...tool, crop: tool.crop ? null : controller.session.selection.selectedElements[0] ?? null };
      else if (what === "keyframe-graph") tool = { ...tool, graph: !tool.graph };
      else if (what === "replace-media" || what === "rename-element") dialog = { kind: what, elementId: String(payload) };
      emit();
    },
  };

  // Filmstrip frames by asset and source time, asked of the engine a batch at a time and kept for the session.
  const frames = new Map<string, string | null>(), wanted = new Map<string, Set<number>>(), thumbnailCancels = new Set<() => void>();
  let closed = false;
  // Counts what a clip on the timeline draws beyond its own element: a filmstrip frame that arrived, a diagnostic of the
  // engine (the warning on a speed badge). A clip is redrawn for these, not for every other change of the editor.
  let framesTimer: ReturnType<typeof setTimeout> | null = null, clipVersion = 0;
  function requestFrames(): void {
    framesTimer = null;
    if (closed || !engine) return;
    for (const [assetId, times] of wanted) {
      const list = [...times].sort((a, b) => a - b).slice(0, 2000);
      if (list.length === 0) continue;
      const pending = new Set(list);
      let cancel = () => {};
      cancel = engine.thumbnails(assetId, list, 160, (time, bytes) => {
        if (closed) { cancel(); thumbnailCancels.delete(cancel); return; }
        if (!pending.delete(time)) return;
        frames.set(`${assetId}@${time}`, imageUrl(bytes, "image/jpeg")); clipVersion++; emit("view");
        if (pending.size === 0) { cancel(); thumbnailCancels.delete(cancel); }
      });
      thumbnailCancels.add(cancel);
    }
    wanted.clear();
  }

  const runtime = {
    controller, media: options.media, host,
    get dialog(): EditorDialog | null { return dialog; },
    setDialog(next: EditorDialog | null): void { dialog = next; emit(); },
    get transport(): TransportState { return transport; },
    get prefs(): timeline.TimelinePreferences { return timelinePrefs(); },
    get uiVersion(): number { return uiVersion; },
    get contentVersion(): number { return contentVersion; },
    get documentVersion(): number { return documentVersion; },
    get clipVersion(): number { return clipVersion; },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    subscribeTransport(listener: () => void): () => void { transportListeners.add(listener); return () => void transportListeners.delete(listener); },
    /** The transport as React reads it (`useTransport`): see `shownTransport` above. */
    shownTransport: { get: (): TransportState => shownTransport.shown(), subscribe: (listener: () => void): (() => void) => shownTransport.subscribe(listener), committed: (value: TransportState): void => shownTransport.committed(value) },
    /** The filmstrip frame of an asset at a source time; `undefined` until the engine has decoded it (it is asked for now). */
    frame(assetId: string, time: number): string | undefined {
      if (closed) return undefined;
      const key = `${assetId}@${time}`, known = frames.get(key);
      if (known !== undefined) return known ?? undefined;
      if (!engine || transport.engine !== "ready") return undefined;
      frames.set(key, null);
      (wanted.get(assetId) ?? wanted.set(assetId, new Set()).get(assetId)!).add(time);
      framesTimer ??= setTimeout(requestFrames, 60);
      return undefined;
    },
    setViewportWidth(width: number): void { viewportWidth = width; },
    get viewportWidth(): number { return viewportWidth; },
    setFocusScope(scope: "editor" | "preview"): void { focusScope = scope; },
    duration, fps,

    // — Engine —
    attachEngine(next: PreviewEngine | null): void {
      engine = next; sent = null; sentAssets = null; sentSources = ""; sourcing = null; sentFonts = "";
      if (!engine) return;
      void engine.setVolume(engineVolume(transport.volume).volume, engineVolume(transport.volume).muted);
      void engine.setQuality(transport.quality);
      sentLuts = null; sentOverride = "{}"; if (derivedGroups.size > 0) void engine.setDerived([...derivedGroups.values()].flat() as never); syncLuts(); syncOverride();
      syncEngine();
    },
    get engine(): PreviewEngine | null { return engine; },
    engineState(state: EngineState, detail?: string): void { setTransport({ engine: state, engineDetail: detail }); },
    /** The transport position the engine reports is the one the player and the timeline show. */
    engineTime(event: { time: number; playing: boolean }): void { if (transport.playing) setTransport({ time: event.time }); },
    engineTransport(state: { playing: boolean; rate: number; effectiveQuality?: string; audioOutput?: boolean; reason?: string }): void {
      const stopped = transport.playing && !state.playing;
      setTransport({ effectiveQuality: state.effectiveQuality ?? transport.effectiveQuality, audioOutput: state.audioOutput ?? transport.audioOutput, ...(stopped ? { playing: false } : {}) });
      if (stopped) { shuttleState = SHUTTLE_IDLE; controller.seek(timeline.seekTime(transport.time, duration(), fps())); }
    },
    /** The engine drew an element differently from what its fields ask (optical flow as frame blending): the clip and the inspector say so. */
    engineDiagnostic(diagnostic: { id: string; elementId?: string }): void { const key = `${diagnostic.id}:${diagnostic.elementId ?? ""}`; if (!diagnostics.has(key)) { diagnostics.add(key); clipVersion++; emit(); } },
    diagnosed(id: string, elementId: string): boolean { return diagnostics.has(`${id}:${elementId}`); },
    engineEnded(time: number): void { setTransport({ playing: false, time }); shuttleState = SHUTTLE_IDLE; controller.seek(Math.min(time, duration())); },

    // — Transport —
    play, pause, seek,
    toggle(): void { if (transport.playing) pause(); else { shuttleState = SHUTTLE_IDLE; play(); } },
    setLoop(on: boolean): void { prefs.set(EDITOR_PREFS.loop, on); setTransport({ loop: on }); const region = loopRegion(doc(), controller.session.sceneId); void engine?.setLoop(on, region.start, region.end); },
    setRate(rate: number): void { setTransport({ menuRate: rate, ...(transport.playing ? { rate } : {}) }); if (transport.playing) void engine?.setRate(rate); },
    setVolume(percent: number): void { const volume = setVolume(transport.volume, percent); prefs.set(EDITOR_PREFS.volume, volume); setTransport({ volume }); void engine?.setVolume(engineVolume(volume).volume, engineVolume(volume).muted); },
    toggleMute(): void { const volume = toggleMute(transport.volume); prefs.set(EDITOR_PREFS.volume, volume); setTransport({ volume }); void engine?.setVolume(engineVolume(volume).volume, engineVolume(volume).muted); },
    setQuality(quality: PreviewQuality): void { prefs.set(EDITOR_PREFS.quality, quality); setTransport({ quality }); void engine?.setQuality(quality); },
    shuttle(input: "forward" | "reverse" | "stop" | "stop-release"): void {
      const next = shuttle(shuttleState, input);
      shuttleState = next.state;
      if (next.effect.kind === "pause") pause();
      else if (next.effect.kind === "step") seek(timeline.stepFrames(transport.playing ? transport.time : controller.session.playhead, next.effect.frames, duration(), fps()));
      else if (next.effect.kind === "play") { if (transport.playing) { setTransport({ rate: next.effect.rate }); void engine?.setRate(next.effect.rate); } else play(next.effect.rate); }
    },

    /**
     * Plays a range on a loop while a control is edited (the cut of a transition); `null` ends it: the transport stops,
     * the playhead returns to where it was and the loop setting of the player applies again.
     */
    previewLoop(range: { start: number; end: number } | null): void {
      if (!engine) return;
      if (range) {
        previewOnce?.(); previewOnce = null;
        if (previewLoopFrom === null) previewLoopFrom = controller.session.playhead;
        void engine.setLoop(true, range.start, range.end); void engine.setRate(1); void engine.play(range.start);
        setTransport({ playing: true, rate: 1, time: range.start });
        return;
      }
      previewOnce?.(); previewOnce = null;
      if (previewLoopFrom === null) return;
      const back = previewLoopFrom, region = loopRegion(doc(), controller.session.sceneId);
      previewLoopFrom = null;
      if (transport.playing) { void engine.pause(); setTransport({ playing: false }); }
      void engine.setLoop(transport.loop, region.start, region.end);
      controller.seek(timeline.seekTime(back, duration(), fps()));
      void engine.seek(controller.session.playhead, "exact");
      setTransport({ time: controller.session.playhead });
    },
    get previewLooping(): boolean { return previewLoopFrom !== null; },
    /**
     * Plays a range once (the part of a clip an animation that was just chosen runs in), then stops and returns the
     * playhead to where it was. A pause, a seek or another preview before the end ends it the same way.
     */
    previewRange(range: { start: number; end: number }): void {
      if (!engine || range.end <= range.start) return;
      runtime.previewLoop(null);
      runtime.previewLoop(range);
      let last = range.start;
      const frame = Math.round((120_000 * fps().denominator) / fps().numerator);
      const finish = () => { if (previewOnce === stop) runtime.previewLoop(null); };
      // The range has played when the transport reaches its last frame, wraps to its start, or stops on its own.
      const watch = runtime.subscribeTransport(() => { const now = transport.time; if (!transport.playing || now + frame >= range.end || now < last) finish(); else last = now; });
      const timer = setTimeout(finish, ((range.end - range.start) / 120) + 1500);
      const stop = () => { watch(); clearTimeout(timer); };
      previewOnce = stop;
    },
    /** Runs an action by id: the one entry of buttons, menus and keys. */
    act(actionId: string, payload: { trackId?: string; time?: number; elementId?: string } = {}): boolean {
      for (const handler of [...actionHandlers]) if (handler(actionId, payload)) { emit(); return true; }
      const seekKind = seekActionOf(actionId);
      if (seekKind) {
        if (seekKind === "stop") { pause(); controller.seek(0); return true; }
        seek(timeline.seekAction(doc(), seekKind, transport.playing ? transport.time : controller.session.playhead, controller.session.sceneId));
        return true;
      }
      switch (actionId) {
        case "playback.toggle": runtime.toggle(); return true;
        case "playback.shuttle-forward": runtime.shuttle("forward"); return true;
        case "playback.shuttle-reverse": runtime.shuttle("reverse"); return true;
        case "playback.shuttle-stop": runtime.shuttle("stop"); return true;
        case "playback.loop.toggle": runtime.setLoop(!transport.loop); return true;
        case "timeline.scenes.open": dialog = { kind: "scenes" }; emit(); return true;
        case "timeline.track.delete": {
          const track = payload.trackId ? timeline.tracksOfScene(timeline.sceneById(doc(), controller.session.sceneId)).find((entry) => entry.id === payload.trackId) : undefined;
          if (!track) return true;
          const text = timeline.deleteTrackConfirmation(track);
          if (text) { dialog = { kind: "delete-track", trackId: track.id, text }; emit(); } else controller.run(timeline.deleteTrack({ trackId: track.id }));
          return true;
        }
        default: {
          if ((actionId.startsWith("player.") || actionId.startsWith("preview.nudge") || actionId.startsWith("preview.select")) && player) return player.act(actionId);
          const done = runEditorAction(host, actionId, payload);
          // What the action changed has been told by the controller as it happened (and a preference, a tool or a dialog
          // by its own setter). This last notice is for what neither covers, and it says only what really changed: a
          // zoom or a scroll is a change of the VIEW — it must not render the project's regions (the screen bar, the
          // media panel, the inspector) as an unconditional "everything changed" did on every toolbar press.
          emit(changeOf());
          return done;
        }
      }
    },
    registerActions(handler: (actionId: string, payload: { trackId?: string; time?: number; elementId?: string }) => boolean): () => void { actionHandlers.add(handler); return () => void actionHandlers.delete(handler); },
    /** The player handles its own actions (zoom, fullscreen, snapshot, nudges) while it is mounted. */
    registerPlayer(next: { act(actionId: string): boolean; space(held: boolean): void }): () => void { player = next; return () => { if (player === next) player = null; }; },
    /** "Reveal media": the asset panel shows the Media tab with the asset in view. */
    reveal(assetId: string): void { revealed = { assetId, nonce: (revealed?.nonce ?? 0) + 1 }; emit(); },
    get revealed(): { assetId: string; nonce: number } | null { return revealed; },
    // — Tools of the inspector and the canvas —
    get tool(): ToolState { return tool; },
    setTool(change: Partial<ToolState>): void { tool = { ...tool, ...change }; syncOverride(); emit(); },
    get canvasTool(): CanvasTool | null { return canvasTool; },
    registerCanvasTool(next: CanvasTool): () => void { canvasTool = next; emit(); return () => { if (canvasTool === next) { canvasTool = null; emit(); } }; },
    /** A LUT file was stored: the engine is told where to read it. */
    refreshLuts(): void { sentLuts = null; syncLuts(); },
    get luts() { return options.luts ?? null; },
    /** The derived sources of one family; the engine receives every family's together. */
    setDerivedSources: setDerivedGroup,
    /** Adds to (or, with `null`, removes from) the engine's copy of the project; the engine receives the scene again. */
    setEngineExtras(next: { decorate(document: ProjectDocument): ProjectDocument; sources: { assetId: string; original: string }[] } | null): Promise<void> { engineExtras = next; sent = null; sentAssets = null; syncEngine(); return sourcing ?? Promise.resolve(); },
    /** Files dropped from the operating system onto the tracks: imported, then placed from the drop point as one step. */
    async dropFiles(files: File[], point: { time: number; y: number }, rows: TimelineRow[]): Promise<void> {
      const result = await options.media.importFiles(files.map((file) => ({ file })));
      const assetIds = [...result.imported, ...result.reused].map((entry) => entry.assetId);
      if (assetIds.length === 0) return;
      controller.run(timeline.dropFiles({ sceneId: controller.session.sceneId, assetIds, time: timeline.dragTargetTime(doc(), point.time, 0), target: dropTargetAt(rows, point.y) }));
    },
    /** Adds library assets at the playhead by the click-to-add placement; `overlay` puts them on a track above. */
    addAssets(assetIds: string[], overlay = false): void {
      if (assetIds.length === 0) return;
      const items = assetIds.map((assetId) => ({ kind: "media" as const, assetId })), sceneId = controller.session.sceneId, time = controller.session.playhead;
      controller.run(timeline.addToTimeline({ sceneId, items, time, ...(overlay ? { request: { strategy: "alwaysNew" as const } } : {}) }));
    },
    zoom: (kind: Parameters<typeof zoomAction>[1]) => zoomAction(host, kind),
    /** A key of the window. Returns the action it ran, so the caller can stop the browser's own handling. */
    key(key: KeyInfo, extra: (actionId: string) => boolean): string | undefined {
      if (key.code === "Space") player?.space(key.type === "down");
      if (key.type === "up") { if (key.code === "KeyK") runtime.shuttle("stop-release"); return undefined; }
      if (key.inField || key.inOverlay) return undefined;
      if (canvasTool?.key?.(key)) { key.preventDefault(); return "canvas.tool"; }
      const actionId = actionForKey(key, { mac: isMac(), context: key.inPreview || focusScope === "preview" ? "preview" : "editor" });
      if (!actionId) return undefined;
      // Space and Enter on a focused button press that button.
      if (key.onButton && (key.code === "Space" || key.code === "Enter")) return undefined;
      if (key.repeat && (actionId === "playback.toggle" || actionId.startsWith("playback.shuttle"))) return actionId;
      if (!extra(actionId) && !runtime.act(actionId)) return undefined;
      key.preventDefault();
      return actionId;
    },
    close(): void { if (closed) return; closed = true; shownTransport.close(); options.luts?.close(); unsubscribe(); unsubscribeMedia(); if (framesTimer) clearTimeout(framesTimer); for (const cancel of thumbnailCancels) cancel(); thumbnailCancels.clear(); for (const url of frames.values()) if (url) releaseImageUrl(url); frames.clear(); engine?.dispose(); engine = null; listeners.clear(); transportListeners.clear(); },
  };
  return runtime;
}
export type EditorRuntime = ReturnType<typeof createEditorRuntime>;
