import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, TextInput, View } from "react-native";
import { useEventListener } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  anyGuideOn, boxFromBounds, canvasRect, clampGrid, clampPreviewZoom, clickSelection, commitTimeEntry, commitTransform, dragPan, dragTarget, EDITOR_PREFS, FIT_VIEW, GRID_LIMITS, gridLines, HANDLE, handleCursor, handlePositions, handlesFor, hitCandidates,
  hitHandle, hitTest, marqueeSelection, moveDelta, moveElements, nudgeDelta, PLAYBACK_RATES, presetZoom, PREVIEW_QUALITY_LABELS, rateLabel, rotateWithHandle, SAFE_AREA_PRESETS, safeAreaAvailable, safeAreaRect, scaleWithHandle, snapBox,
  snapTargets, snapThreshold, timecode, toCanvas, toScreen, transformOf, wheelPan, wheelZoomView, zoomInView, zoomLabel, zoomOptions, zoomOutView, zoomTo,
  bindingKeys, presetOf, type Box, type GuideSettings, type HandleId, type Point, type PreviewQuality, type PreviewView,
} from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { Button, Icon, IconButton, Menu, NumberField, Popover, Select, Slider, Switch, Tap, Text, radius, space, useTheme, type ColorToken, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { usePref } from "../state";
import { useEditor, useEditorContent, useEditorSelect, useEditorVersion, useSettledTransport, useTransportSelect } from "./context";
import { bindPointer, bindWheel, devicePixelRatio, followPanelMotion, isMac, nextFrame, observeDevicePixelRatio, observeSize, onFullscreen, saveBytes, setCursor, setInputText, toggleFullscreen, type PointerInfo } from "./dom";
import { CanvasTools } from "./canvas/CanvasTools";
import { bindPinch } from "./compact/touch";
import type { NativeGesture } from "./compact/touch";
import { DrawSurface } from "./canvas/DrawSurface";
import { useElementMenu } from "./menus";
import { openPreviewEngine, type PreviewEngine } from "./preview-engine";
import { remotePreviewError } from "./remote-preview-error";
import { useHost } from "../host";
import { loadSigner } from "../identity";

const STAGE_MARGIN = 16;
type Drag =
  | { kind: "move"; ids: string[]; start: Point; from: Map<string, Point>; box: Box | null; moved: boolean }
  | { kind: "scale"; id: string; handle: Exclude<HandleId, "rotate">; start: Point; box: Box; scale: Point; position: Point; flip: { horizontal: boolean; vertical: boolean } }
  | { kind: "rotate"; id: string; start: Point; box: Box; rotation: number }
  | { kind: "marquee"; start: Point; base: string[]; additive: boolean }
  | { kind: "pan"; last: Point };

/** The player region: the engine's canvas with selection, handles, guides and snapping over it, and the 36 px transport bar. */
export const Player = memo(function Player(props: { onOpenCanvasSettings(): void; commentPin?: { x: number; y: number } | null; /** Two fingers on the preview scale and turn the selected element, or zoom and pan the preview with nothing selected. */ pinch?: boolean; /** The phone editor draws its own transport: the bar under the canvas is replaced by what this returns (nothing outside fullscreen). */ bar?: (state: { fullscreen: boolean; shown: boolean; toggleFullscreen(): void }) => ReactNode; surface?: ColorToken; /** A preview that only plays (the Timeline preview of a session): no selection, no handles, no context menu. */ viewOnly?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const hostState = useHost();
  // The project and the selection, not the timeline's scroll or zoom.
  const version = useEditorContent();
  // Without the running clock: while it plays the handles and outlines are hidden and the pointer does nothing here, so
  // this region renders when playback starts and when it stops — the canvas itself is drawn by the engine.
  const transport = useSettledTransport();
  const { controller } = runtime, session = controller.session, document = controller.document;
  // The notes of the markers under the playhead do follow the clock: read on every tick, rendered when they change.
  const notes = useTransportSelect((clock) => timeline.activeMarkerNotes(document, session.sceneId, clock.time));
  const canvas = document.settings.canvasSize, fps = document.settings.fps as Rational;
  const [viewport, setViewport] = useState({ width: 640, height: 360 });
  const [pixelRatio, setPixelRatio] = useState(devicePixelRatio);
  const [pinchNativeGesture, setPinchNativeGesture] = useState<NativeGesture>(() => Gesture.Tap().enabled(false));
  const [view, setView] = useState<PreviewView>(FIT_VIEW);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const [snap, setSnap] = useState<{ x?: number; y?: number }>({});
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [angle, setAngle] = useState<string | null>(null);
  const [guides, setGuides] = usePref(EDITOR_PREFS.guides);
  const [fullscreen, setFullscreen] = useState(false);
  const [barShown, setBarShown] = useState(true);
  const [menu, setMenu] = useState<{ at: Point; items: MenuItem[] } | null>(null);
  const panel = useRef<View>(null), area = useRef<View>(null), host = useRef<View>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const [remoteFrame, setRemoteFrame] = useState<string | null>(null), [remoteVideo, setRemoteVideo] = useState<{ uri: string; startTime: number; endTime: number } | null>(null), [remoteProgress, setRemoteProgress] = useState(false), [remoteError, setRemoteError] = useState<string | null>(null);
  const remotePlayer = useVideoPlayer(remoteVideo ? { uri: remoteVideo.uri } : null);
  useEffect(() => {
    if (!remoteVideo) { remotePlayer.pause(); return; }
    remotePlayer.timeUpdateEventInterval = 0.1;
    if (runtime.transport.playing) { remotePlayer.currentTime = 0; remotePlayer.play(); } else remotePlayer.pause();
  }, [remoteVideo, remotePlayer, runtime.transport.playing]);
  useEventListener(remotePlayer, "timeUpdate", (event) => runtime.engineTime({ time: (remoteVideo?.startTime ?? 0) + event.currentTime * 120_000, playing: true }));
  useEventListener(remotePlayer, "playToEnd", () => runtime.engineEnded(remoteVideo?.endTime ?? runtime.duration()));
  const lastFrame = useRef({ revision: -1, time: -1 }), framePending = useRef<(() => void) | null>(null), layoutMissing = useRef(false);
  const elementMenu = useElementMenu();
  const live = useRef({ view, viewport, canvas, boxes, guides });
  live.current = { view, viewport, canvas, boxes, guides };
  const spaceHeld = useRef(false);

  // While a panel slides the viewport is not re-rendered frame by frame (the engine would re-size its surface each time):
  // the layers drawn in canvas space are carried along by one CSS transform, and the final size is taken once, at the end.
  const canvasLayer = useRef<View>(null), toolLayer = useRef<View>(null), slideFollow = useRef<{ settle(): void } | null>(null);
  useEffect(() => observeSize(area.current, setViewport), []);
  useEffect(() => observeDevicePixelRatio(setPixelRatio), []);
  useEffect(() => {
    const following = followPanelMotion(area.current, [canvasLayer.current, toolLayer.current], (size) => {
      const state = live.current;
      if (size.width === state.viewport.width && size.height === state.viewport.height) return null;
      const drawn = canvasRect(state.view, state.viewport, state.canvas), now = canvasRect(state.view, size, state.canvas), ratio = now.scale / drawn.scale;
      return `translate(${now.left - drawn.left * ratio}px, ${now.top - drawn.top * ratio}px) scale(${ratio})`;
    });
    slideFollow.current = following;
    return following.dispose;
  }, []);
  useLayoutEffect(() => { slideFollow.current?.settle(); }, [viewport]);
  // Zoom and pan return to fit whenever the canvas size changes.
  useEffect(() => { setView(FIT_VIEW); }, [canvas.width, canvas.height]);
  useEffect(() => onFullscreen(panel.current, setFullscreen), []);

  // — Engine: started once per mount; "Try again" and "Reload engine" start it anew —
  const [engineRun, setEngineRun] = useState(0);
  useEffect(() => {
    let cancelled = false, opened: PreviewEngine | null = null;
    const size = live.current.viewport;
    const start = async () => {
    const remote = hostState.connection && hostState.host ? { host: hostState.host, connection: hostState.connection, signer: await loadSigner(), projectId: runtime.controller.stored.metadata.id } : undefined;
    if (cancelled) return;
    void openPreviewEngine(host.current, {
      width: size.width, height: size.height, devicePixelRatio: pixelRatio, locale: theme.locale,
      offlineTile: { fill: theme.color("preview/offline-fill"), hatch: theme.color("preview/offline-hatch"), offlineLabel: t("Media offline"), unsupportedLabel: t("Unsupported media") },
      remote,
    }, {
      onState: (state, detail) => { if (!cancelled) runtime.engineState(state, detail); },
      onTime: (event) => runtime.engineTime(event), onTransport: (state) => runtime.engineTransport(state), onEnded: (time) => runtime.engineEnded(time),
      onDiagnostic: (diagnostic) => runtime.engineDiagnostic(diagnostic),
      onRemoteFrame: (frame) => { if (!cancelled) { setRemoteError(null); setRemoteVideo(null); setRemoteFrame(frame.uri); } },
      onRemoteVideo: (video) => { if (!cancelled) { setRemoteError(null); setRemoteVideo({ uri: video.uri, startTime: video.startTime, endTime: video.endTime }); setRemoteProgress(false); } },
      onRemoteProgress: (progress) => { if (!cancelled) setRemoteProgress(progress.total > 0 && progress.done < progress.total); },
      onRemoteError: (message) => { if (!cancelled) { setRemoteError(message ? remotePreviewError(message) : null); setRemoteProgress(false); } },
      // A frame of a new revision or a new time may have moved what is on the canvas; a repeated one has not.
      // It is told on the next animation frame: the engine may present from inside an effect of this screen.
      onFrame: (frame) => {
        // …unless the last layout could not place something that is on the canvas (a glyph or a picture still loading
        // when it was asked): the frame that draws it has the same revision and time, and is the one to lay out again.
        if (frame.revision === lastFrame.current.revision && frame.time === lastFrame.current.time && !layoutMissing.current) return;
        // While it plays, the layout already follows the transport's time (the effect below): a second render per frame
        // from here would only make React commit twice a frame. The frame the playback stops on is told as before.
        if (runtime.transport.playing && !layoutMissing.current) return;
        lastFrame.current = { revision: frame.revision, time: frame.time };
        framePending.current ??= nextFrame(() => { framePending.current = null; setFrames((value) => value + 1); });
      },
    }, () => cancelled).then((engine) => {
      if (cancelled) { engine?.dispose(); return; }
      opened = engine; engineRef.current = engine;
      runtime.attachEngine(engine);
    });
    };
    void start().catch((error) => { if (!cancelled) runtime.engineState("unsupported", error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; engineRef.current = null; runtime.attachEngine(null); opened?.dispose(); };
  }, [runtime, engineRun, hostState.connection, hostState.host, pixelRatio]); // eslint-disable-line react-hooks/exhaustive-deps
  const [frames, setFrames] = useState(0);
  useEffect(() => { void engineRef.current?.resize(viewport.width, viewport.height, pixelRatio, view.zoom); }, [viewport.width, viewport.height, view.zoom, pixelRatio, transport.engine]);

  // — Layout of the hit candidates at the shown time —
  const candidates = useMemo(() => hitCandidates(document, session.sceneId, transport.time), [document, session.sceneId, transport.time]);
  useEffect(() => {
    let stale = false;
    const engine = engineRef.current;
    // Nothing to lay out: the boxes are emptied only when there are any — a state is never set from this effect on every frame.
    if (!engine || transport.engine !== "ready" || candidates.length === 0) { layoutMissing.current = false; if (boxesRef.current.length > 0) setBoxes([]); return; }
    void engine.layout(candidates, transport.time).then((found) => {
      if (stale) return;
      layoutMissing.current = candidates.some((id) => !found[id]);
      const next = candidates.flatMap((id) => (found[id] ? [boxFromBounds(id, found[id], found[id].rotation, canvas, found[id].width / Math.max(1, found[id].height))] : []));
      setBoxes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    });
    return () => { stale = true; };
  }, [candidates, transport.time, transport.engine, frames, canvas, version]);

  const rect = canvasRect(view, viewport, canvas);
  const stageMargin = props.pinch ? 12 : STAGE_MARGIN;
  const measureCompactStage = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    if (!props.pinch) return;
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== live.current.viewport.width || height !== live.current.viewport.height)) setViewport({ width, height });
  };
  const screenOf = useCallback((point: Point): Point => toScreen(point, live.current.view, live.current.viewport, live.current.canvas), []);
  const selectedIds = session.selection.selectedElements;
  const handled = transport.playing || runtime.canvasTool?.hidesHandles ? null : handlesFor(selectedIds, candidates);
  const handleBox = handled ? boxes.find((box) => box.id === handled) ?? null : null;
  const stateRef = useRef({ handleBox, selectedIds });
  stateRef.current = { handleBox, selectedIds };

  // What was selected when the first finger of a gesture landed: that finger selects what it lands on, two fingers act on what was selected before.
  const heldBefore = useRef<string[]>([]);
  // — Pointer: select, move, scale, rotate, marquee, pan —
  useEffect(() => (props.viewOnly ? undefined : bindPointer(area.current, {
    down(info) {
      heldBefore.current = [...controller.session.selection.selectedElements];
      const state = live.current, playhead = controller.session.playhead, screen = { x: info.x, y: info.y };
      const point = toCanvas(screen, state.view, state.viewport, state.canvas);
      if (info.button === 1 || (info.button === 0 && spaceHeld.current)) { setCursor(area.current, "grabbing"); return follow({ kind: "pan", last: screen }); }
      if (info.button !== 0 || runtime.transport.playing) return null;
      // A tool of the inspector (mask handles, crop, eyedropper) takes the press before selection does.
      const taken = runtime.canvasTool?.down(info);
      if (taken !== undefined) return taken;
      const selected = controller.session.selection.selectedElements, box = stateRef.current.handleBox;
      if (box) {
        const handle = hitHandle(handlePositions(box, screenOf, canvasRect(state.view, state.viewport, state.canvas).scale), screen, info.touch);
        const element = timeline.locate(controller.stored, box.id)?.element;
        if (handle && element) {
          const current = transformOf(element);
          controller.session.beginGesture();
          return follow(handle === "rotate" ? { kind: "rotate", id: box.id, start: point, box, rotation: current.rotation } : { kind: "scale", id: box.id, handle, start: point, box, scale: current.scale, position: current.position, flip: current.flip });
        }
      }
      const hits = hitTest(state.boxes, point);
      if (info.shift || info.alt) { controller.select(timeline.selectElements(clickSelection(selected, hits, { shift: info.shift, alt: info.alt }))); return null; }
      const target = dragTarget(selected, hits);
      if (!target) return follow({ kind: "marquee", start: point, base: [...selected], additive: info.shift });
      if (target.selection.join() !== selected.join()) controller.select(timeline.selectElements(target.selection));
      const from = new Map(target.ids.flatMap((id) => { const element = timeline.locate(controller.stored, id)?.element; return element && timeline.isVisual(element) ? [[id, transformOf(element).position] as const] : []; }));
      void playhead;
      return follow({ kind: "move", ids: [...from.keys()], start: point, from, box: state.boxes.find((entry) => entry.id === hits.find((id) => target.ids.includes(id))) ?? null, moved: false });
    },
    double(info) { runtime.canvasTool?.double?.(info); },
    hover(info) {
      if (!info) return;
      const box = stateRef.current.handleBox, state = live.current;
      const handle = box ? hitHandle(handlePositions(box, screenOf, canvasRect(state.view, state.viewport, state.canvas).scale), { x: info.x, y: info.y }) : null;
      setCursor(area.current, spaceHeld.current && state.view.zoom > 1 ? "grab" : handle && box ? handleCursor(handle, box.rotation) : hitTest(state.boxes, toCanvas({ x: info.x, y: info.y }, state.view, state.viewport, state.canvas)).length > 0 ? "move" : "default");
    },
    context(info) {
      const state = live.current, hits = hitTest(state.boxes, toCanvas({ x: info.x, y: info.y }, state.view, state.viewport, state.canvas));
      if (hits.length > 0) {
        if (!controller.session.selection.selectedElements.includes(hits[0])) controller.select(timeline.selectElements([hits[0]]));
        setMenu({ at: { x: info.clientX, y: info.clientY }, items: [{ id: "reset-transform", label: t("Reset transform"), icon: "rotate", onSelect: () => void runtime.act("preview.reset-transform") }, { id: "flip-h", label: t("Flip horizontal"), onSelect: () => void runtime.act("preview.mirror") }, { id: "flip-v", label: t("Flip vertical"), onSelect: () => void runtime.act("preview.flip-vertical") }, { type: "separator" }, ...elementMenu()] });
      } else {
        setMenu({ at: { x: info.clientX, y: info.clientY }, items: [
          { id: "fit", label: t("Fit to screen"), keys: bindingKeys("player.zoom-fit", isMac()) ?? undefined, onSelect: () => setView(FIT_VIEW) }, { id: "100", label: t("Actual size (100%)"), onSelect: () => setView((current) => zoomTo(current, presetZoom(100, live.current.viewport, live.current.canvas), live.current.viewport, live.current.canvas)) },
          { type: "separator" }, { id: "paste", label: t("Paste"), disabled: controller.clipboard.isEmpty, onSelect: () => void runtime.act("timeline.paste") }, { id: "select-all", label: t("Select all"), onSelect: () => void runtime.act("selection.all") },
          { type: "separator" }, { id: "guides", label: t("Show guides"), checked: live.current.guides.visible, onSelect: () => setGuides({ ...live.current.guides, visible: !live.current.guides.visible }) },
          { id: "snapshot", label: t("Save snapshot"), onSelect: () => void snapshot() }, { id: "canvas", label: t("Canvas size…"), onSelect: props.onOpenCanvasSettings },
        ] });
      }
    },
  })), [controller, runtime, screenOf, elementMenu, t, props.viewOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // — Two fingers: pinch and twist. The whole gesture is one undo step. —
  useEffect(() => {
    if (!props.pinch) { if (Platform.OS !== "web") setPinchNativeGesture(Gesture.Tap().enabled(false)); return; }
    const binding = bindPinch(area.current, (centre) => {
    if (runtime.transport.playing || runtime.canvasTool?.hidesHandles) return null;
    const held = heldBefore.current;
    if (held.join() !== controller.session.selection.selectedElements.join()) controller.select(held.length > 0 ? timeline.selectElements(held) : timeline.deselectAll());
    const state = live.current, box = held.length > 0 ? stateRef.current.handleBox : null, element = box ? timeline.locate(controller.stored, box.id)?.element : undefined;
    if (box && element && timeline.isVisual(element)) {
      const from = transformOf(element), playhead = controller.session.playhead, limit = (value: number) => Math.min(100, Math.max(0.01, value));
      let last = { scale: 1, twist: 0 };
      const write = (final: boolean) => controller.external((before, ctx) => commitTransform(before, ctx, box.id, playhead, { scale: { x: limit(from.scale.x * last.scale), y: limit(from.scale.y * last.scale) }, rotation: Math.round((from.rotation + last.twist) * 10) / 10 }, "Transform"), !final);
      return { move(scale, twist) { last = { scale, twist }; write(false); }, end() { write(true); }, cancel() { controller.discardPreview(); } };
    }
    // Nothing selected: the fingers zoom the preview about their centre and carry it along.
    const from = state.view;
    return {
      move(scale, _twist, now) { setView(dragPan(zoomTo(from, clampPreviewZoom(from.zoom * scale), state.viewport, state.canvas, { x: centre.x, y: centre.y }), { x: now.x - centre.x, y: now.y - centre.y }, state.viewport, state.canvas)); },
      // Let go near the fitted size, the preview fits again: there is no zoom menu to return with on a phone.
      end() { setView((current) => (Math.abs(current.zoom - 1) < 0.12 ? FIT_VIEW : current)); },
    };
    });
    if (Platform.OS !== "web") setPinchNativeGesture(binding.gesture);
    return binding;
  }, [props.pinch, controller, runtime]);

  /** Follows one drag to its release; every candidate is drawn through the preview layer and committed once. */
  function follow(drag: Drag) {
    const playhead = controller.session.playhead;
    const apply = (info: PointerInfo, final: boolean): void => {
      const state = live.current, screen = { x: info.x, y: info.y }, point = toCanvas(screen, state.view, state.viewport, state.canvas), scale = canvasRect(state.view, state.viewport, state.canvas).scale;
      if (drag.kind === "pan") { const delta = { x: screen.x - drag.last.x, y: screen.y - drag.last.y }; drag.last = screen; setView((current) => dragPan(current, delta, state.viewport, state.canvas)); return; }
      if (drag.kind === "marquee") { setMarquee(final ? null : { a: drag.start, b: point }); if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * scale > 3) controller.select(timeline.selectElements(marqueeSelection(state.boxes, drag.start, point, drag.base, drag.additive))); else if (final) controller.select(timeline.deselectAll()); return; }
      if (drag.kind === "move") {
        const delta = moveDelta(drag.start, point, info.shift);
        if (!delta) { if (final && drag.moved) controller.discardPreview(); return; }
        drag.moved = true;
        let moved = delta, lines: { x?: number; y?: number } = {};
        if (drag.box) {
          const others = state.boxes.filter((box) => !drag.ids.includes(box.id));
          const snapped = snapBox({ ...drag.box, cx: drag.box.cx + delta.x, cy: drag.box.cy + delta.y }, snapTargets(state.canvas, state.guides, others), snapThreshold(scale), state.guides.snap && !info.mod);
          moved = { x: delta.x + snapped.dx, y: delta.y + snapped.dy }; lines = snapped.lines;
        }
        setSnap(final ? {} : lines);
        controller.external((before, ctx) => moveElements(before, ctx, drag.ids, playhead, moved, drag.from), !final);
        return;
      }
      if (drag.kind === "rotate") {
        const result = rotateWithHandle({ centre: { x: drag.box.cx, y: drag.box.cy }, start: drag.start, current: point, rotation: drag.rotation, shift: info.shift, mod: info.mod });
        setAngle(final ? null : result.label);
        controller.external((before, ctx) => commitTransform(before, ctx, drag.id, playhead, { rotation: result.rotation }, "Rotate"), !final);
        return;
      }
      const result = scaleWithHandle({ box: drag.box, scale: drag.scale, position: drag.position, handle: drag.handle, start: drag.start, current: point, shift: info.shift, alt: info.alt });
      // Through the centre the element mirrors: the scale stays positive and the flip flag of that axis toggles.
      const flip = { horizontal: drag.flip.horizontal !== result.flip.horizontal, vertical: drag.flip.vertical !== result.flip.vertical };
      controller.external((before, ctx) => commitTransform(before, ctx, drag.id, playhead, { scale: result.scale, position: result.position, flip }, "Scale"), !final);
    };
    return {
      move: (info: PointerInfo) => apply(info, false),
      up: (info: PointerInfo) => { apply(info, true); setSnap({}); setAngle(null); setMarquee(null); setCursor(area.current, "default"); },
      cancel: () => { controller.discardPreview(); setSnap({}); setAngle(null); setMarquee(null); },
    };
  }

  // — Wheel: Mod zooms about the cursor, plain wheel pans while zoomed in —
  useEffect(() => {
    let pending = 0, cursor: Point = { x: 0, y: 0 }, cancel: (() => void) | null = null;
    return bindWheel(area.current, (wheel) => {
      const state = live.current;
      if (!(wheel.ctrlKey || wheel.metaKey)) { setView((current) => wheelPan(current, wheel, state.viewport, state.canvas)); return; }
      // The deltas of one animation frame are applied together, capped.
      pending += wheel.deltaY; cursor = { x: wheel.x, y: wheel.y };
      cancel ??= nextFrame(() => { const delta = pending; pending = 0; cancel = null; setView((current) => wheelZoomView(current, delta, live.current.viewport, live.current.canvas, cursor)); });
    });
  }, []);

  const snapshot = useCallback(async () => {
    const bytes = await engineRef.current?.still(runtime.transport.time, "png");
    if (bytes) saveBytes(bytes, `${controller.stored.metadata.name} ${timecode(runtime.transport.time, fps).replace(/:/g, "-")}.png`, "image/png");
  }, [controller, runtime, fps]);
  // The player's own actions, reachable from keys through the screen.
  useEffect(() => runtime.registerPlayer({
    act(actionId) {
      const state = live.current, nudge = nudgeDelta(actionId), ids = controller.session.selection.selectedElements;
      if (nudge) { if (ids.length === 0) return false; controller.external((before, ctx) => { const made = moveElements(before, ctx, ids, controller.session.playhead, nudge); return made ? { ...made, label: "Nudge" } : null; }); return true; }
      switch (actionId) {
        case "player.zoom-in": setView((current) => zoomInView(current, state.viewport, state.canvas)); return true;
        case "player.zoom-out": setView((current) => zoomOutView(current, state.viewport, state.canvas)); return true;
        case "player.zoom-fit": setView(FIT_VIEW); return true;
        case "player.zoom-100": setView((current) => zoomTo(current, presetZoom(100, state.viewport, state.canvas), state.viewport, state.canvas)); return true;
        case "player.fullscreen": toggleFullscreen(panel.current); return true;
        case "player.snapshot": void snapshot(); return true;
        case "player.guides.toggle": setGuides({ ...state.guides, visible: !state.guides.visible }); return true;
        case "preview.select-previous": case "preview.select-next": {
          const list = hitCandidates(controller.stored, controller.session.sceneId, controller.session.playhead);
          if (list.length === 0) return true;
          const at = list.indexOf(ids[0]), next = list[(at + (actionId.endsWith("next") ? 1 : -1) + list.length) % list.length];
          controller.select(timeline.selectElements([next]));
          return true;
        }
        default: return false;
      }
    },
    space(held) { spaceHeld.current = held; },
  }), [controller, runtime, snapshot, setGuides]);

  // In fullscreen the bar hides after 3 s without pointer movement.
  useEffect(() => {
    if (!fullscreen) { setBarShown(true); return; }
    let timer = setTimeout(() => setBarShown(false), 3000);
    const wake = () => { setBarShown(true); clearTimeout(timer); timer = setTimeout(() => setBarShown(false), 3000); };
    // A finger has no hover: a touch wakes the bar too.
    const off = bindPointer(panel.current, { hover: (info) => { if (info) wake(); }, down: () => { wake(); return null; } });
    return () => { clearTimeout(timer); off(); };
  }, [fullscreen]);

  const positions = handleBox ? handlePositions(handleBox, (point) => toScreen(point, view, viewport, canvas), rect.scale) : null;
  const outline = theme.color("preview/handle-fill"), border = theme.color("preview/handle-border");
  const showGuides = guides.visible;
  const grid = showGuides && guides.grid.on ? gridLines(guides.grid.rows, guides.grid.columns, canvas) : null;
  const safe = showGuides && guides.safeArea.on ? safeAreaRect(guides.safeArea.preset, canvas) : null;
  const duration = runtime.duration();
  const blocked = transport.engine === "no-gpu" ? t("This device cannot render the preview.") : transport.engine === "unsupported" ? transport.engineDetail ?? t("Preview is unavailable because this build does not include a render engine.") : null;

  const enterFullscreen = useCallback(() => toggleFullscreen(panel.current), []);
  return (
    <View ref={panel} testID="player" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.color(props.surface ?? "bg/canvas") }}>
      <View testID="player-canvas" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* The stage is the preview viewport: the canvas fits inside it, a margin away from the region's edges. */}
      {(() => {
      const stage = (
      <View ref={area} testID="player-stage" onLayout={measureCompactStage} tabIndex={0} role="region" accessibilityLabel={t("Preview")} onFocus={() => runtime.setFocusScope("preview")} onBlur={() => runtime.setFocusScope("editor")} style={{ position: "absolute", left: stageMargin, right: stageMargin, top: stageMargin, bottom: stageMargin, outlineWidth: 0 } as object}>
        <View style={{ position: "absolute", left: -stageMargin, right: -stageMargin, top: -stageMargin, bottom: -stageMargin }} />
        <View ref={canvasLayer} pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        <View ref={host} testID="canvas" pointerEvents="none" style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, boxShadow: `0 0 0 1px ${theme.color("border/strong")}` } as object}>
          {remoteVideo ? <VideoView player={remotePlayer} nativeControls={false} contentFit="contain" style={{ width: "100%", height: "100%" }} /> : remoteFrame ? <Image source={{ uri: remoteFrame }} resizeMode="contain" style={{ width: "100%", height: "100%" }} /> : null}
        </View>
        {/* Only where the host really draws the preview: the phone. On desktop and web the engine in this window draws it. */}
        {Platform.OS !== "web" && hostState.connection ? <View pointerEvents="none" testID="host-preview-label" style={{ position: "absolute", top: 6, left: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.color("bg/elevated") }}><Text variant="caption" color="text/secondary">{t("Rendered by host")}</Text></View> : null}
        {remoteProgress ? <View pointerEvents="none" testID="host-preview-progress" style={{ position: "absolute", top: 6, right: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.color("bg/elevated") }}><Text variant="caption" color="text/secondary">{t("Rendering preview…")}</Text></View> : null}
        {remoteError ? <View testID="host-preview-error" accessibilityRole="alert" style={{ position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderRadius: 6, backgroundColor: theme.color("bg/elevated") }}><Text variant="meta" color="danger" numberOfLines={2} style={{ flex: 1 }}>{t(remoteError)}</Text><Button size="xs" label={t("Retry")} testID="host-preview-retry" onPress={() => { setRemoteError(null); void engineRef.current?.seek(transport.time, "exact"); }} /></View> : null}
        {/* Guides: scaled with the canvas, under the handles. */}
        <View pointerEvents="none" style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          {grid ? <>{grid.vertical.map((x) => <View key={`v${x}`} testID="guide-grid" style={{ position: "absolute", left: x * rect.scale, top: 0, bottom: 0, width: 1, backgroundColor: outline, opacity: 0.35, boxShadow: "1px 0 0 rgba(0,0,0,0.2)" } as object} />)}{grid.horizontal.map((y) => <View key={`h${y}`} testID="guide-grid" style={{ position: "absolute", top: y * rect.scale, left: 0, right: 0, height: 1, backgroundColor: outline, opacity: 0.35, boxShadow: "0 1px 0 rgba(0,0,0,0.2)" } as object} />)}</> : null}
          {safe ? <View testID="guide-safe" style={{ position: "absolute", left: safe.x * rect.scale, top: safe.y * rect.scale, width: safe.width * rect.scale, height: safe.height * rect.scale, borderWidth: 1, borderColor: outline, opacity: 0.7, boxShadow: `0 0 0 ${Math.max(rect.width, rect.height)}px rgba(0,0,0,0.35)` } as object} /> : null}
          {showGuides && guides.custom.on ? <>{guides.custom.vertical.map((x, index) => <View key={`cv${index}`} testID="guide-custom" style={{ position: "absolute", left: x * rect.scale, top: 0, bottom: 0, width: 1, backgroundColor: theme.color("preview/guide") }} />)}{guides.custom.horizontal.map((y, index) => <View key={`ch${index}`} testID="guide-custom" style={{ position: "absolute", top: y * rect.scale, left: 0, right: 0, height: 1, backgroundColor: theme.color("preview/guide") }} />)}</> : null}
        </View>
        {props.commentPin ? <View testID="comment-canvas-pin" pointerEvents="none" style={{ position: "absolute", left: rect.left + props.commentPin.x * rect.width - 9, top: rect.top + props.commentPin.y * rect.height - 18, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color("bg/app"), backgroundColor: theme.color("accent"), boxShadow: `0 1px 6px ${theme.color("text/primary")}` } as object} /> : null}
        {/* Selection outlines; handles only for a single selection. */}
        {!transport.playing ? boxes.filter((box) => selectedIds.includes(box.id)).map((box) => {
          const centre = toScreen({ x: box.cx, y: box.cy }, view, viewport, canvas), width = box.width * rect.scale, height = box.height * rect.scale;
          return <View key={box.id} pointerEvents="none" testID="selection-box" style={{ position: "absolute", left: centre.x - width / 2, top: centre.y - height / 2, width, height, borderWidth: 1, borderColor: outline, opacity: 0.75, transform: [{ rotate: `${box.rotation}deg` }] }} />;
        }) : null}
        {positions && handleBox ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
            <View style={{ position: "absolute", left: (positions.n.x + positions.rotate.x) / 2 - 0.5, top: (positions.n.y + positions.rotate.y) / 2 - HANDLE.rotateOffset / 2, width: 1, height: HANDLE.rotateOffset, backgroundColor: outline, opacity: 0.75, transform: [{ rotate: `${handleBox.rotation}deg` }] }} />
            {(["nw", "ne", "se", "sw"] as const).map((id) => <View key={id} testID={`handle-${id}`} style={{ position: "absolute", left: positions[id].x - HANDLE.corner / 2, top: positions[id].y - HANDLE.corner / 2, width: HANDLE.corner, height: HANDLE.corner, backgroundColor: outline, borderWidth: 1, borderColor: border, transform: [{ rotate: `${handleBox.rotation}deg` }] }} />)}
            {(["n", "s"] as const).map((id) => <View key={id} testID={`handle-${id}`} style={{ position: "absolute", left: positions[id].x - HANDLE.edge.long / 2, top: positions[id].y - HANDLE.edge.short / 2, width: HANDLE.edge.long, height: HANDLE.edge.short, borderRadius: 2, backgroundColor: outline, borderWidth: 1, borderColor: border, transform: [{ rotate: `${handleBox.rotation}deg` }] }} />)}
            {(["e", "w"] as const).map((id) => <View key={id} testID={`handle-${id}`} style={{ position: "absolute", left: positions[id].x - HANDLE.edge.short / 2, top: positions[id].y - HANDLE.edge.long / 2, width: HANDLE.edge.short, height: HANDLE.edge.long, borderRadius: 2, backgroundColor: outline, borderWidth: 1, borderColor: border, transform: [{ rotate: `${handleBox.rotation}deg` }] }} />)}
            <View testID="handle-rotate" style={{ position: "absolute", left: positions.rotate.x - HANDLE.rotateRadius, top: positions.rotate.y - HANDLE.rotateRadius, width: HANDLE.rotateRadius * 2, height: HANDLE.rotateRadius * 2, borderRadius: radius.full, backgroundColor: outline, borderWidth: 1, borderColor: border, alignItems: "center", justifyContent: "center" }}><Icon name="rotate" size={12} color="preview/handle-border" /></View>
            {angle ? <View testID="angle-badge" style={{ position: "absolute", left: positions.rotate.x + 16, top: positions.rotate.y - 10, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{angle}</Text></View> : null}
          </View>
        ) : null}
        {snap.x !== undefined ? <View pointerEvents="none" testID="snap-guide" style={{ position: "absolute", left: toScreen({ x: snap.x, y: 0 }, view, viewport, canvas).x, top: 0, bottom: 0, width: 1, backgroundColor: theme.color("preview/guide") }} /> : null}
        {snap.y !== undefined ? <View pointerEvents="none" testID="snap-guide" style={{ position: "absolute", top: toScreen({ x: 0, y: snap.y }, view, viewport, canvas).y, left: 0, right: 0, height: 1, backgroundColor: theme.color("preview/guide") }} /> : null}
        {marquee ? (() => { const a = toScreen(marquee.a, view, viewport, canvas), b = toScreen(marquee.b, view, viewport, canvas); return <View pointerEvents="none" testID="preview-marquee" style={{ position: "absolute", left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), borderWidth: 1, borderColor: outline, backgroundColor: theme.color("accent/subtle"), opacity: 0.5 }} />; })() : null}
        </View>
        {notes.length > 0 ? <View pointerEvents="none" style={{ position: "absolute", left: space[2], top: space[2], gap: space[1], maxWidth: 280 }}>{notes.map((note, index) => <View key={index} style={{ paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, borderStartWidth: 3, borderStartColor: theme.color("accent"), backgroundColor: theme.color("bg/elevated") }}><Text variant="meta">{note}</Text></View>)}</View> : null}
        {blocked ? (
          <View testID="engine-notice" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4], backgroundColor: theme.color("bg/canvas") }}>
            <Icon name="warn" size={24} color="text/secondary" /><Text align="center" live="polite">{blocked}</Text>
            {transport.engine === "no-gpu" ? <Button size="sm" label={t("Try again")} onPress={() => setEngineRun((value) => value + 1)} /> : null}
          </View>
        ) : transport.engine === "stopped" ? (
          <View testID="engine-stopped" style={{ position: "absolute", left: space[2], right: space[2], top: space[2], flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("bg/elevated") }}>
            <Icon name="warn" size={16} color="danger" /><Text style={{ flex: 1 }}>{t("The preview engine stopped")}</Text><Button size="xs" label={t("Reload engine")} onPress={() => setEngineRun((value) => value + 1)} />
          </View>
        ) : null}
        <View ref={toolLayer} pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        <CanvasTools view={view} viewport={viewport} canvas={canvas} boxes={boxes} />
        <DrawSurface view={view} viewport={viewport} canvas={canvas} />
        </View>
        <Menu open={menu !== null} anchor={menu ? { x: menu.at.x, y: menu.at.y, width: 1, height: 1 } : { x: 0, y: 0, width: 1, height: 1 }} items={menu?.items ?? []} label={t("Preview")} onClose={() => setMenu(null)} />
      </View>
      );
      return Platform.OS === "web" ? stage : <GestureDetector gesture={pinchNativeGesture}>{stage}</GestureDetector>;
      })()}
      </View>
      {props.bar ? props.bar({ fullscreen, shown: barShown, toggleFullscreen: () => toggleFullscreen(panel.current) }) : barShown ? <PlayerBar view={view} viewport={viewport} setView={setView} guides={guides} setGuides={setGuides} duration={duration} onFullscreen={enterFullscreen} fullscreen={fullscreen} onOpenCanvasSettings={props.onOpenCanvasSettings} /> : null}
    </View>
  );
});

/** The 36 px bar under the canvas: timecode, transport, and the monitoring controls. */
const PlayerBar = memo(function PlayerBar(props: { view: PreviewView; viewport: { width: number; height: number }; setView(next: PreviewView): void; guides: GuideSettings; setGuides(next: GuideSettings): void; duration: number; onFullscreen(): void; fullscreen: boolean; onOpenCanvasSettings(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  // The bar shows the project's canvas and frame rate, and the transport without the running clock (the timecode follows
  // the clock by itself): it renders for those — not for a selection or an edit, and not on every frame of playback.
  const settings = useEditorSelect((editor) => editor.controller.document.settings, Object.is);
  const transport = useSettledTransport();
  const canvas = settings.canvasSize, fps = settings.fps as Rational;
  const seek = useCallback((time: number) => { void runtime.seek(time); }, [runtime]);
  const [open, setOpen] = useState<"rate" | "volume" | "guides" | "quality" | "zoom" | null>(null);
  const rateRef = useRef<View>(null), volumeRef = useRef<View>(null), guidesRef = useRef<View>(null), qualityRef = useRef<View>(null), zoomRef = useRef<View>(null);
  const mac = isMac(), keys = (action: string) => bindingKeys(action, mac) ?? undefined;
  const ratio = presetOf(canvas)?.ratio ?? `${canvas.width}×${canvas.height}`;
  const chip = (ref: React.RefObject<View | null>, id: NonNullable<typeof open>, label: string, name: string, icon?: "aspect") => (
    <Tap ref={ref} role="button" label={`${name}: ${label}`} tooltip={{ label: name }} expanded={open === id} testID={`player-${id}`} onPress={() => setOpen(id)}
      style={(state) => ({ height: 24, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, borderRadius: radius.sm, backgroundColor: state.hovered || open === id ? theme.color("bg/hover") : "transparent" })}>
      {icon ? <Icon name={icon} size={14} /> : null}<Text variant="meta" style={{ fontWeight: "500" }}>{label}</Text><Icon name="chev-d" size={14} />
    </Tap>
  );
  const volume = transport.volume, silent = volume.muted || volume.volume === 0;
  const reduced = transport.quality === "auto" && transport.effectiveQuality !== "full";
  return (
    <View testID="player-bar" role="toolbar" aria-label={t("Player")} style={{ height: 36, flexDirection: "row", alignItems: "center", paddingHorizontal: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
      <TimecodeField time={transport.time} duration={props.duration} fps={fps} onSeek={seek} />
      <Text variant="mono" color="text/secondary" numberOfLines={1} testID="player-duration" style={{ marginStart: space[1] }}>{`/ ${timecode(props.duration, fps)}`}</Text>
      <View style={{ flex: 1 }} />
      <IconButton testID="player-start" icon="skip-b" size="sm" label={t("Go to start")} keys={keys("playback.go-start")} onPress={() => runtime.act("playback.go-start")} />
      <IconButton testID="player-step-back" icon="step-b" size="sm" label={t("Step back")} keys={keys("playback.frame-previous")} onPress={() => runtime.act("playback.frame-previous")} />
      <IconButton testID="player-play" icon={transport.playing ? "pause" : "play"} size="md" color="text/primary" label={t(transport.playing ? "Pause" : "Play")} keys={keys("playback.toggle")} disabled={props.duration <= 0 || transport.engine !== "ready"} onPress={() => runtime.toggle()} />
      <IconButton testID="player-step-forward" icon="step-f" size="sm" label={t("Step forward")} keys={keys("playback.frame-next")} onPress={() => runtime.act("playback.frame-next")} />
      <IconButton testID="player-end" icon="skip-f" size="sm" label={t("Go to end")} keys={keys("playback.go-end")} onPress={() => runtime.act("playback.go-end")} />
      <IconButton testID="player-loop" icon="loop" size="sm" label={t("Loop")} keys={keys("playback.loop.toggle")} on={transport.loop} toggle onPress={() => runtime.setLoop(!transport.loop)} />
      <View style={{ flex: 1 }} />
      {reduced ? <View testID="quality-chip" style={{ paddingHorizontal: space[1.5], height: 20, justifyContent: "center", borderRadius: radius.full, backgroundColor: theme.color("warning/subtle"), marginEnd: space[1] }}><Text variant="caption" color="warning/text">{t("Reduced preview quality")}</Text></View> : null}
      {chip(rateRef, "rate", rateLabel(transport.playing ? Math.abs(transport.rate) : transport.menuRate), t("Playback rate"))}
      <Menu open={open === "rate"} anchor={rateRef} label={t("Playback rate")} onClose={() => setOpen(null)} items={PLAYBACK_RATES.map((rate) => ({ id: String(rate), label: rateLabel(rate), checked: transport.menuRate === rate, onSelect: () => runtime.setRate(rate) }))} />
      <IconButton ref={volumeRef} testID="player-volume" icon={silent ? "mute" : "vol"} size="sm" label={t("Volume")} expanded={open === "volume"} onPress={() => setOpen("volume")} />
      <Popover open={open === "volume"} anchor={volumeRef} side="top" label={t("Volume")} width={240} onClose={() => setOpen(null)}><VolumePanel /></Popover>
      <Tap role="button" label={t("Aspect ratio: {ratio}", { ratio })} tooltip={{ label: t("Aspect ratio") }} testID="player-aspect" onPress={props.onOpenCanvasSettings}
        style={(state) => ({ height: 24, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: 5, borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
        <Icon name="aspect" size={14} /><Text variant="meta" style={{ fontWeight: "500" }}>{ratio}</Text>
      </Tap>
      <IconButton ref={guidesRef} testID="player-guides" icon="grid" size="sm" label={t("Guides")} on={anyGuideOn(props.guides)} expanded={open === "guides"} onPress={() => setOpen("guides")} />
      <Popover open={open === "guides"} anchor={guidesRef} side="top" align="end" label={t("Guides")} width={320} onClose={() => setOpen(null)}><GuidesPanel /></Popover>
      {chip(qualityRef, "quality", t(PREVIEW_QUALITY_LABELS[transport.quality]), t("Preview quality"))}
      <Menu open={open === "quality"} anchor={qualityRef} label={t("Preview quality")} align="end" onClose={() => setOpen(null)} items={(Object.keys(PREVIEW_QUALITY_LABELS) as PreviewQuality[]).map((quality) => ({ id: quality, label: t(PREVIEW_QUALITY_LABELS[quality]), checked: transport.quality === quality, onSelect: () => runtime.setQuality(quality) }))} />
      {chip(zoomRef, "zoom", zoomLabel(props.view, props.viewport, canvas) === "Fit" ? t("Fit") : zoomLabel(props.view, props.viewport, canvas), t("Zoom"))}
      <Menu open={open === "zoom"} anchor={zoomRef} label={t("Zoom")} align="end" onClose={() => setOpen(null)} items={zoomOptions().map((option): MenuItem => ("separator" in option ? { type: "separator" } : {
        id: option.id, label: option.id === "fit" ? t("Fit") : option.label, checked: option.id === "fit" ? Math.abs(props.view.zoom - 1) <= 0.001 : false,
        onSelect: () => props.setView("percent" in option ? zoomTo(props.view, presetZoom(option.percent, props.viewport, canvas), props.viewport, canvas) : FIT_VIEW),
      }))} />
      <IconButton testID="player-fullscreen" icon="full" size="sm" label={t(props.fullscreen ? "Exit fullscreen" : "Fullscreen")} keys={keys("player.fullscreen")} on={props.fullscreen} onPress={props.onFullscreen} />
    </View>
  );
});

/** The one editable timecode of the editor: `HH:MM:SS:FF` and its short forms; Enter or blur seeks, Escape restores. */
function TimecodeField(props: { time: number; duration: number; fps: Rational; onSeek(time: number): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = timecode(props.time, props.fps);
  // While it plays the field is written from the clock itself (unless it is being typed in): React renders it for the
  // time playback started at, and again when it stops.
  const field = useRef<TextInput>(null), state = useRef({ editing: draft !== null, fps: props.fps });
  state.current = { editing: draft !== null, fps: props.fps };
  const write = useCallback(() => { if (!state.current.editing && runtime.transport.playing) setInputText(field.current, timecode(runtime.transport.time, state.current.fps)); }, [runtime]);
  useEffect(() => runtime.subscribeTransport(write), [runtime, write]);
  useLayoutEffect(write);
  const invalid = draft !== null && commitTimeEntry(draft, props.duration, props.fps) === null;
  const commit = (leave: boolean) => {
    if (draft === null) return;
    const target = commitTimeEntry(draft, props.duration, props.fps);
    // Enter on text that is not a time keeps the field in edit mode; leaving it restores the time.
    if (target === null) { if (leave) setDraft(null); return; }
    setDraft(null); props.onSeek(target);
  };
  return (
    <TextInput ref={field} testID="timecode" accessibilityLabel={t("Current time")} aria-label={t("Current time")} aria-invalid={invalid} value={draft ?? shown} selectTextOnFocus onFocus={() => setDraft(shown)} onChangeText={setDraft} onBlur={() => commit(true)}
      {...({ onKeyPress: (event: { nativeEvent: { key: string }; preventDefault(): void; target: { blur(): void } }) => { if (event.nativeEvent.key === "Enter") { event.preventDefault(); const ok = draft !== null && commitTimeEntry(draft, props.duration, props.fps) !== null; commit(false); if (ok) event.target.blur(); } if (event.nativeEvent.key === "Escape") { event.preventDefault(); setDraft(null); event.target.blur(); } } } as object)}
      style={[theme.type("mono"), { width: 96, height: 24, paddingHorizontal: space[1.5], borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color(invalid ? "danger" : "border/control"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app"), outlineWidth: 0 }]} />
  );
}

/**
 * The master volume: the speaker button mutes and restores, the slider sets 0–100 %. It reads the transport itself:
 * what a popover shows is drawn in the overlay layer, and content that waits for its opener to render again is a frame late.
 */
export function VolumePanel() {
  const t = useT();
  const runtime = useEditor();
  const volume = useTransportSelect((transport) => transport.volume, Object.is), silent = volume.muted || volume.volume === 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <IconButton testID="volume-mute" icon={silent ? "mute" : "vol"} size="sm" label={t(silent ? "Unmute" : "Mute")} on={silent} toggle onPress={() => runtime.toggleMute()} />
      <View style={{ flex: 1 }}><Slider label={t("Master volume")} min={0} max={100} step={1} value={silent ? 0 : volume.volume} onChange={(value) => runtime.setVolume(value as number)} onCommit={(value) => runtime.setVolume(value as number)} /></View>
      <Text variant="meta" tabular testID="volume-value" style={{ width: 40, textAlign: "right" }}>{`${silent ? 0 : volume.volume}%`}</Text>
    </View>
  );
}

/** Grid, Safe area and Custom lines, each with its own switch, and "Snap in preview". Like the volume, it reads its own settings. */
export function GuidesPanel() {
  const t = useT();
  const runtime = useEditor();
  useEditorVersion();
  const [guides, setGuides] = usePref(EDITOR_PREFS.guides);
  const canvas = runtime.controller.document.settings.canvasSize;
  const row = (label: string, on: boolean, toggle: (on: boolean) => void, testID: string) => <View style={{ flexDirection: "row", alignItems: "center", height: 28 }}><Text variant="body-medium" style={{ flex: 1 }}>{label}</Text><View testID={testID}><Switch label={label} value={on} onChange={toggle} /></View></View>;
  return (
    <View testID="guides-popover" style={{ gap: space[2] }}>
      {row(t("Grid"), guides.grid.on, (on) => setGuides({ ...guides, grid: { ...guides.grid, on } }), "guides-grid")}
      {guides.grid.on ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <NumberField label={t("Rows")} size="sm" width={96} min={GRID_LIMITS.min} max={GRID_LIMITS.max} step={1} value={guides.grid.rows} onCommit={(rows) => setGuides({ ...guides, grid: { ...guides.grid, rows: clampGrid(rows) } })} />
        <NumberField label={t("Columns")} size="sm" width={112} min={GRID_LIMITS.min} max={GRID_LIMITS.max} step={1} value={guides.grid.columns} onCommit={(columns) => setGuides({ ...guides, grid: { ...guides.grid, columns: clampGrid(columns) } })} />
        <IconButton icon="rotate" size="xs" label={t("Reset grid")} onPress={() => setGuides({ ...guides, grid: { ...guides.grid, rows: GRID_LIMITS.rows, columns: GRID_LIMITS.columns } })} />
      </View> : null}
      {row(t("Safe area"), guides.safeArea.on, (on) => setGuides({ ...guides, safeArea: { ...guides.safeArea, on } }), "guides-safe")}
      {guides.safeArea.on ? <Select label={t("Safe area")} value={guides.safeArea.preset} onChange={(preset) => setGuides({ ...guides, safeArea: { ...guides.safeArea, preset } })}
        options={SAFE_AREA_PRESETS.map((preset) => ({ value: preset.id, label: t(preset.label), disabled: !safeAreaAvailable(preset, canvas), description: safeAreaAvailable(preset, canvas) ? undefined : t("Available for 9:16 projects") }))} /> : null}
      {row(t("Custom lines"), guides.custom.on, (on) => setGuides({ ...guides, custom: { ...guides.custom, on } }), "guides-custom")}
      {guides.custom.on ? <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button size="xs" icon="plus" label={t("Vertical line")} onPress={() => setGuides({ ...guides, custom: { ...guides.custom, vertical: [...guides.custom.vertical, Math.round(canvas.width / 2)] } })} />
          <Button size="xs" icon="plus" label={t("Horizontal line")} onPress={() => setGuides({ ...guides, custom: { ...guides.custom, horizontal: [...guides.custom.horizontal, Math.round(canvas.height / 2)] } })} />
        </View>
        {(["vertical", "horizontal"] as const).flatMap((axis) => guides.custom[axis].map((value, index) => (
          <View key={`${axis}${index}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <NumberField label={axis === "vertical" ? "X" : "Y"} size="sm" width={120} unit="px" min={0} max={axis === "vertical" ? canvas.width : canvas.height} step={1} value={value} onCommit={(next) => setGuides({ ...guides, custom: { ...guides.custom, [axis]: guides.custom[axis].map((entry, at) => (at === index ? next : entry)) } })} />
            <IconButton icon="trash" size="xs" label={t("Remove line")} onPress={() => setGuides({ ...guides, custom: { ...guides.custom, [axis]: guides.custom[axis].filter((_, at) => at !== index) } })} />
          </View>
        )))}
      </View> : null}
      {row(t("Snap in preview"), guides.snap, (snap) => setGuides({ ...guides, snap }), "guides-snap")}
    </View>
  );
}
