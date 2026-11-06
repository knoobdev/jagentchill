import { TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { lanePaths } from "../ops/keyframes.ts";
import { setLocal } from "../commit.ts";
import { isObject, type Json } from "../model.ts";
import { frameTicks, frameToTicks, snapToFrame, ticksToNearestFrame } from "../time.ts";
import { parseTimecode } from "../time/index.ts";
import { activeSceneId, endOf, sceneById, sceneDurationOf, tracksOfScene, type El, type Tr } from "./model.ts";

// — Scale and zoom (ported from OpenCut classic `timeline/scale.ts`, `zoom-utils.ts`) —
export const BASE_PIXELS_PER_SECOND = 50;
export const ZOOM_MAX = 100;
export const ZOOM_BUTTON_FACTOR = 1.7;
export const ZOOM_SLIDER_STEP = 0.005;
export const ZOOM_ANCHOR_SLIDER_POSITION = 0.15;
export const pixelsPerSecond = (zoomLevel: number): number => BASE_PIXELS_PER_SECOND * zoomLevel;
export const ticksToPixels = (ticks: number, zoomLevel: number): number => (ticks / TICKS_PER_SECOND) * pixelsPerSecond(zoomLevel);
export const pixelsToTicks = (pixels: number, zoomLevel: number): number => Math.round((pixels / pixelsPerSecond(zoomLevel)) * TICKS_PER_SECOND);
/** Positions are rounded to the device-pixel grid. */
export const toDevicePixel = (cssPixels: number, devicePixelRatio = 1): number => Math.round(cssPixels * devicePixelRatio) / devicePixelRatio;

/** The dynamic minimum zoom: the content takes a quarter of the container, never above the maximum. */
export function zoomMin(durationTicks: number, containerWidth: number | null | undefined): number {
  const seconds = Math.max(durationTicks / TICKS_PER_SECOND, 1);
  return Math.min(ZOOM_MAX, ((containerWidth ?? 1000) * 0.25) / (seconds * BASE_PIXELS_PER_SECOND));
}
export const clampZoom = (zoomLevel: number, min: number): number => Math.min(ZOOM_MAX, Math.max(min, zoomLevel));
export const zoomIn = (zoomLevel: number, min: number): number => clampZoom(zoomLevel * ZOOM_BUTTON_FACTOR, min);
export const zoomOut = (zoomLevel: number, min: number): number => clampZoom(zoomLevel / ZOOM_BUTTON_FACTOR, min);
/** Slider 0–1 mapped exponentially: `min × (max/min)^position`. */
export const sliderToZoom = (position: number, min: number, max = ZOOM_MAX): number => min * (max / min) ** Math.min(1, Math.max(0, position));
export const zoomToSlider = (zoomLevel: number, min: number, max = ZOOM_MAX): number => (max <= min ? 1 : Math.log(Math.min(max, Math.max(min, zoomLevel)) / min) / Math.log(max / min));
export const snapSliderPosition = (position: number): number => Math.min(1, Math.max(0, Math.round(position / ZOOM_SLIDER_STEP) * ZOOM_SLIDER_STEP));
/** Ctrl/Cmd + wheel: factor `exp(−delta/300)`, the per-frame delta capped at ±30. */
export const wheelZoom = (zoomLevel: number, deltaPerFrame: number, min: number): number => clampZoom(zoomLevel * Math.exp(-Math.min(30, Math.max(-30, deltaPerFrame)) / 300), min);
/** "Zoom to fit": the scene duration spans 95 % of the tracks viewport; horizontal scroll returns to 0. */
export function zoomToFit(durationTicks: number, viewportWidth: number): { zoomLevel: number; scrollLeft: 0 } {
  const seconds = Math.max(durationTicks / TICKS_PER_SECOND, 1 / TICKS_PER_SECOND);
  return { zoomLevel: Math.min(ZOOM_MAX, (viewportWidth * 0.95) / (seconds * BASE_PIXELS_PER_SECOND)), scrollLeft: 0 };
}
/** Right padding after the content: 75 % of the container at minimum zoom, easing to 15 % at zoom fraction 0.2. */
export function rightPaddingPx(containerWidth: number, zoomLevel: number, min: number): number {
  const fraction = ZOOM_MAX === min ? 1 : (zoomLevel - min) / (ZOOM_MAX - min);
  return containerWidth * (0.75 - (0.75 - 0.15) * Math.min(Math.max(fraction, 0) / 0.2, 1));
}
export const contentWidthPx = (durationTicks: number, zoomLevel: number, containerWidth: number, min: number): number => ticksToPixels(durationTicks, zoomLevel) + rightPaddingPx(containerWidth, zoomLevel, min);

export type ZoomAnchor = { kind: "playhead"; playheadTime: number } | { kind: "pointer"; viewportX: number } | { kind: "none" };
/**
 * The scroll position after a zoom change. At slider position ≥ 0.15 the anchor keeps its viewport offset (the
 * playhead for buttons and slider, the time under the pointer or pinch centre for wheel and pinch; mobile always
 * anchors on the fixed-centre playhead). Below 0.15 nothing is anchored; crossing up saves the scroll position and
 * crossing back down restores it.
 */
export function zoomScroll(state: { zoomLevel: number; scrollLeft: number; savedScrollLeft?: number }, nextZoom: number, anchor: ZoomAnchor, min: number, options: { mobile?: boolean; viewportWidth?: number } = {}): { zoomLevel: number; scrollLeft: number; savedScrollLeft?: number } {
  const was = zoomToSlider(state.zoomLevel, min), now = zoomToSlider(nextZoom, min);
  const anchored = options.mobile === true || now >= ZOOM_ANCHOR_SLIDER_POSITION;
  let saved = state.savedScrollLeft;
  if (!options.mobile && was < ZOOM_ANCHOR_SLIDER_POSITION && now >= ZOOM_ANCHOR_SLIDER_POSITION) saved = state.scrollLeft;
  if (!anchored) {
    const restored = was >= ZOOM_ANCHOR_SLIDER_POSITION && saved !== undefined ? saved : state.scrollLeft;
    return { zoomLevel: nextZoom, scrollLeft: Math.max(0, restored), savedScrollLeft: saved };
  }
  let scrollLeft = state.scrollLeft;
  if (options.mobile) {
    // The content scrolls under a fixed centre line: the time at the line stays where it is.
    const time = anchor.kind === "playhead" ? anchor.playheadTime : pixelsToTicks(state.scrollLeft, state.zoomLevel);
    scrollLeft = ticksToPixels(time, nextZoom);
  } else if (anchor.kind === "playhead") scrollLeft = ticksToPixels(anchor.playheadTime, nextZoom) - (ticksToPixels(anchor.playheadTime, state.zoomLevel) - state.scrollLeft);
  else if (anchor.kind === "pointer") scrollLeft = ((state.scrollLeft + anchor.viewportX) / state.zoomLevel) * nextZoom - anchor.viewportX;
  return { zoomLevel: nextZoom, scrollLeft: Math.max(0, scrollLeft), savedScrollLeft: saved };
}

// — Scrolling —
export const WHEEL_HORIZONTAL_CAP_PX = 40;
/** Plain wheel scrolls tracks vertically; Shift, Alt/Option or a dominant horizontal delta scrolls horizontally (≤ 40 px per event); Ctrl/Cmd zooms. */
export function wheelIntent(event: { deltaX: number; deltaY: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): { kind: "zoom"; delta: number } | { kind: "horizontal"; delta: number } | { kind: "vertical"; delta: number } {
  if (event.ctrlKey || event.metaKey) return { kind: "zoom", delta: event.deltaY };
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (event.shiftKey || event.altKey || horizontal) {
    const raw = horizontal ? event.deltaX : event.deltaY;
    return { kind: "horizontal", delta: Math.sign(raw) * Math.min(WHEEL_HORIZONTAL_CAP_PX, Math.abs(raw)) };
  }
  return { kind: "vertical", delta: event.deltaY };
}
/** On opening a project the tracks area is scrolled to the bottom, so the main track and the audio tracks are visible. */
export const initialVerticalScroll = (contentHeight: number, viewportHeight: number): number => Math.max(0, contentHeight - viewportHeight);

/**
 * Edge auto-scroll during drag, trim, marker drag, marquee and scrub: within 100 px of the left or right edge up to
 * 15 px per frame, within 40 px of the top or bottom edge up to 10 px per frame, scaled linearly by proximity.
 */
export function edgeAutoScroll(pointer: { x: number; y: number }, viewport: { width: number; height: number }): { dx: number; dy: number } {
  const axis = (position: number, size: number, zone: number, max: number) => {
    if (position < zone) return -max * Math.min(1, (zone - position) / zone);
    if (position > size - zone) return max * Math.min(1, (position - (size - zone)) / zone);
    return 0;
  };
  return { dx: axis(pointer.x, viewport.width, 100, 15), dy: axis(pointer.y, viewport.height, 40, 10) };
}

// — Geometry —
export const TIMELINE_GEOMETRY = {
  headerColumnWidth: 136, coverButtonWidth: 40, headerIconButton: 20, typeIcon: 16, rowGap: 6, rulerHeight: 22, markerRowHeight: 16, markerFlag: { width: 12, height: 15 },
  keyframeLaneHeight: 20, contentTopPadding: 2, scrollbar: 12, playheadLine: 2, playheadHandle: 12, trimHandleWidth: 8, keyframeHitSize: 14, waveformStripHeight: 16,
  minHeaderClipWidth: 24, minDiamondClipWidth: 40, minProvenanceChipWidth: 64, dragThresholdPx: 5,
} as const;
/** Row height of a track: desktop/web px, or mobile pt. */
export function rowHeight(track: { type: string }, zone: "overlay" | "main" | "audio", platform: "desktop" | "web" | "mobile" = "desktop"): number {
  if (platform === "mobile") return zone === "main" ? 56 : track.type === "video" ? 40 : track.type === "audio" ? 32 : 24;
  return track.type === "video" ? 65 : track.type === "audio" ? 50 : 25;
}
// One lane per presented property: the two stored channels of Scale share a lane.
const pathsOf = (element: El): number => (isObject(element.animations) ? lanePaths(element).length : 0);
/** Rows top to bottom with their heights; a row grows by the tallest expanded element's lanes (20 px per animated path). */
export function trackRows(doc: ProjectDocument, options: { sceneId?: string; platform?: "desktop" | "web" | "mobile"; expandedElementIds?: string[] } = {}): { trackId: string; zone: "overlay" | "main" | "audio"; top: number; baseHeight: number; height: number }[] {
  const scene = sceneById(doc, options.sceneId ?? activeSceneId(doc)), expanded = new Set(options.expandedElementIds ?? []);
  let top: number = TIMELINE_GEOMETRY.contentTopPadding;
  return tracksOfScene(scene).map((track: Tr) => {
    const zone = track === scene.tracks.main ? "main" : track.type === "audio" ? "audio" : "overlay";
    const baseHeight = rowHeight(track, zone, options.platform);
    const lanes = Math.max(0, ...track.elements.filter((element) => expanded.has(element.id)).map(pathsOf));
    const row = { trackId: track.id, zone, top, baseHeight, height: baseHeight + lanes * TIMELINE_GEOMETRY.keyframeLaneHeight } as const;
    top += row.height + TIMELINE_GEOMETRY.rowGap;
    return row;
  });
}
/** Inline keyframe diamonds of a selected element at least 40 px wide: one per distinct time. */
export function inlineKeyframeTimes(element: El, widthPx: number): number[] {
  if (widthPx < TIMELINE_GEOMETRY.minDiamondClipWidth || !isObject(element.animations)) return [];
  const times = new Set<number>();
  for (const channel of Object.values(element.animations) as Json[]) for (const key of (("r" in channel ? (channel.r as Json).keys : channel.keys) as { time: number }[] | undefined) ?? []) times.add(key.time);
  return [...times].sort((a, b) => a - b);
}

// — Ruler (ported from OpenCut classic `timeline/ruler-utils.ts`) —
const LABEL_FRAME_INTERVALS = [2, 3, 5, 10, 15], TICK_FRAME_INTERVALS = [1, 2, 3, 5, 10, 15];
const SECOND_MULTIPLIERS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_LABEL_SPACING_PX = 120, MIN_TICK_SPACING_PX = 18;
const fpsFloat = (fps: Rational) => fps.numerator / fps.denominator;
function optimalInterval(pxPerFrame: number, pxPerSecond: number, fps: number, minSpacing: number, frames: number[]): number {
  for (const interval of frames) if (pxPerFrame * interval >= minSpacing) return interval / fps;
  for (const seconds of SECOND_MULTIPLIERS) if (pxPerSecond * seconds >= minSpacing) return seconds;
  return 60;
}
/** Label and tick intervals in seconds at a zoom; the tick interval always divides the label interval. */
export function rulerConfig(zoomLevel: number, fps: Rational): { labelIntervalSeconds: number; tickIntervalSeconds: number } {
  const rate = fpsFloat(fps), pxPerSecond = pixelsPerSecond(zoomLevel), pxPerFrame = pxPerSecond / rate;
  const label = optimalInterval(pxPerFrame, pxPerSecond, rate, MIN_LABEL_SPACING_PX, LABEL_FRAME_INTERVALS);
  let tick = optimalInterval(pxPerFrame, pxPerSecond, rate, MIN_TICK_SPACING_PX, TICK_FRAME_INTERVALS);
  const labelFrames = Math.round(label * rate), tickFrames = Math.round(tick * rate);
  if (labelFrames % tickFrames !== 0) {
    const byFrames = TICK_FRAME_INTERVALS.find((frames) => labelFrames % frames === 0 && pxPerFrame * frames >= MIN_TICK_SPACING_PX);
    const bySeconds = SECOND_MULTIPLIERS.find((seconds) => Math.abs(label / seconds - Math.round(label / seconds)) < 0.0001 && pxPerSecond * seconds >= MIN_TICK_SPACING_PX);
    tick = byFrames !== undefined ? byFrames / rate : bySeconds ?? label;
  }
  return { labelIntervalSeconds: label, tickIntervalSeconds: tick };
}
/** `MM:SS` on second boundaries, `H:MM:SS` from one hour, `{n}f` between seconds. */
export function rulerLabel(timeInSeconds: number, fps: Rational): string {
  const fraction = timeInSeconds % 1;
  if (fraction >= 0.0001 && fraction <= 1 - 0.0001) return `${Math.round(fraction * fpsFloat(fps))}f`;
  const total = Math.round(timeInSeconds), hours = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0"), ss = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** The ticks to draw: only those inside the viewport plus a buffer of `max(200 px, 15 % of the viewport)`. */
export function rulerTicks(zoomLevel: number, fps: Rational, scrollLeft: number, viewportWidth: number): { timeSeconds: number; x: number; label?: string }[] {
  const { labelIntervalSeconds, tickIntervalSeconds } = rulerConfig(zoomLevel, fps), pxPerSecond = pixelsPerSecond(zoomLevel);
  const buffer = Math.max(200, viewportWidth * 0.15), every = Math.max(1, Math.round(labelIntervalSeconds / tickIntervalSeconds));
  const first = Math.max(0, Math.floor((scrollLeft - buffer) / pxPerSecond / tickIntervalSeconds)), last = Math.ceil((scrollLeft + viewportWidth + buffer) / pxPerSecond / tickIntervalSeconds);
  const ticks: { timeSeconds: number; x: number; label?: string }[] = [];
  for (let index = first; index <= last; index++) {
    const timeSeconds = index * tickIntervalSeconds;
    ticks.push({ timeSeconds, x: timeSeconds * pxPerSecond, ...(index % every === 0 ? { label: rulerLabel(timeSeconds, fps) } : {}) });
  }
  return ticks;
}

// — Playhead and seeking —
/** A seek target: frame-snapped and clamped to `[0, duration]`; the playhead rests exactly at the duration at the end. */
export const seekTime = (time: number, duration: number, fps: Rational): number => (time >= duration ? duration : Math.max(0, Math.min(duration, snapToFrame(time, fps))));
export const stepFrames = (playhead: number, frames: number, duration: number, fps: Rational): number => seekTime(frameToTicks(Math.max(0, ticksToNearestFrame(playhead, fps) + frames), fps), duration, fps);
export const seekBySeconds = (playhead: number, seconds: number, duration: number, fps: Rational): number => seekTime(playhead + seconds * TICKS_PER_SECOND, duration, fps);
export type SeekAction = "step-forward" | "step-back" | "step-forward-10" | "step-back-10" | "seek-forward-1s" | "seek-back-1s" | "jump-forward-5s" | "jump-back-5s" | "go-to-start" | "go-to-end" | "stop" | "previous-cut" | "next-cut";
/** Cut points: tick 0, every element start and end on unlocked visible tracks of the scene, and the scene end. */
export function cutPoints(doc: ProjectDocument, sceneId?: string): number[] {
  const scene = sceneById(doc, sceneId ?? activeSceneId(doc)), points = new Set<number>([0, sceneDurationOf(scene)]);
  for (const track of tracksOfScene(scene)) if (!track.locked && track.hidden !== true) for (const element of track.elements) { points.add(element.startTime); points.add(endOf(element)); }
  return [...points].sort((a, b) => a - b);
}
/** The playhead after a seek action; `stop` also pauses (the caller owns the transport). */
export function seekAction(doc: ProjectDocument, action: SeekAction, playhead: number, sceneId?: string): number {
  const scene = sceneById(doc, sceneId ?? activeSceneId(doc)), duration = sceneDurationOf(scene), fps = doc.settings.fps as Rational;
  switch (action) {
    case "step-forward": return stepFrames(playhead, 1, duration, fps);
    case "step-back": return stepFrames(playhead, -1, duration, fps);
    case "step-forward-10": return stepFrames(playhead, 10, duration, fps);
    case "step-back-10": return stepFrames(playhead, -10, duration, fps);
    case "seek-forward-1s": return seekBySeconds(playhead, 1, duration, fps);
    case "seek-back-1s": return seekBySeconds(playhead, -1, duration, fps);
    case "jump-forward-5s": return seekBySeconds(playhead, 5, duration, fps);
    case "jump-back-5s": return seekBySeconds(playhead, -5, duration, fps);
    case "go-to-start": case "stop": return 0;
    case "go-to-end": return duration;
    case "next-cut": return cutPoints(doc, scene.id).find((point) => point > playhead) ?? playhead;
    case "previous-cut": return [...cutPoints(doc, scene.id)].reverse().find((point) => point < playhead) ?? playhead;
  }
}
/** A time committed in the player's timecode field (`HH:MM:SS:FF`) seeks the timeline playhead; `null` for invalid input. */
export function seekFromTimecode(text: string, duration: number, fps: Rational): number | null {
  const parsed = parseTimecode(text, "HH:MM:SS:FF", fps);
  return parsed === null ? null : seekTime(parsed, duration, fps);
}
/** Mobile: the playhead is fixed at the centre and the content scrolls under it, so the scroll offset is the time. */
export const mobileScrollToTime = (scrollLeft: number, zoomLevel: number, duration: number, fps: Rational): number => seekTime(pixelsToTicks(Math.max(0, scrollLeft), zoomLevel), duration, fps);
export const mobileTimeToScroll = (time: number, zoomLevel: number): number => ticksToPixels(time, zoomLevel);

/**
 * Auto-follow during playback. `page`: when the playhead leaves the viewport the timeline scrolls so it sits at 10 %
 * of the viewport width; `smooth`: the playhead stays at the centre once it reaches it; `off`: nothing. Suspended
 * while scrubbing or scrolling manually, and for 1 s after the last manual scroll.
 */
export function autoFollowScroll(mode: "page" | "smooth" | "off", state: { playheadX: number; scrollLeft: number; viewportWidth: number; scrubbing?: boolean; now_ms?: number; lastManualScroll_ms?: number }): number {
  const suspended = state.scrubbing === true || (state.now_ms !== undefined && state.lastManualScroll_ms !== undefined && state.now_ms - state.lastManualScroll_ms < 1000);
  if (mode === "off" || suspended) return state.scrollLeft;
  const offset = state.playheadX - state.scrollLeft;
  if (mode === "page") return offset < 0 || offset > state.viewportWidth ? Math.max(0, state.playheadX - state.viewportWidth * 0.1) : state.scrollLeft;
  return offset >= state.viewportWidth / 2 ? state.playheadX - state.viewportWidth / 2 : state.scrollLeft;
}

/** The preview axis shows the hovered frame without moving the playhead — never on touch, during a gesture or playback, or without an engine. */
export function previewAxisState(input: { enabled: boolean; touch: boolean; gestureActive: boolean; playing: boolean; engine: "ready" | "no-gpu" | "stopped"; hoverTime?: number; playhead: number }): { available: boolean; tooltip?: string; hoverLineTime?: number; frameTime: number } {
  if (input.touch) return { available: false, frameTime: input.playhead };
  if (input.engine !== "ready") return { available: false, tooltip: "Preview is unavailable", frameTime: input.playhead };
  const hovering = input.enabled && !input.gestureActive && !input.playing && input.hoverTime !== undefined;
  return { available: true, ...(hovering ? { hoverLineTime: input.hoverTime } : {}), frameTime: hovering ? input.hoverTime! : input.playhead };
}

// — View state under `local` (per project, per device; no undo step, no revision, no patch) —
export type TimelineViewState = { zoomLevel: number; scrollLeft: number; playheadTime: number; scenePlayheads: Record<string, number>; expandedKeyframeElementIds: string[] };
export const SCROLL_SAVE_DEBOUNCE_MS = 300;
const VIEW_DEFAULTS: TimelineViewState = { zoomLevel: 1, scrollLeft: 0, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] };
/** The stored view state; ids of elements that no longer exist are dropped on load. */
export function readViewState(doc: ProjectDocument): TimelineViewState {
  const stored = ((doc as { local?: { timelineViewState?: Partial<TimelineViewState> } }).local?.timelineViewState ?? {}) as Partial<TimelineViewState>;
  const existing = new Set((doc.scenes as unknown as { tracks: { overlay: Tr[]; main: Tr; audio: Tr[] } }[]).flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]).flatMap((track) => track.elements.map((element) => element.id)));
  const state = { ...VIEW_DEFAULTS, ...stored };
  return { ...state, scenePlayheads: { ...state.scenePlayheads }, expandedKeyframeElementIds: state.expandedKeyframeElementIds.filter((id) => existing.has(id)) };
}
export const writeViewState = (doc: ProjectDocument, change: Partial<TimelineViewState>): ProjectDocument =>
  setLocal(doc, (local) => { local.timelineViewState = { ...readViewState(doc), ...change }; });
/** Moves the playhead of the active scene and remembers it for that scene. */
export function setPlayhead(doc: ProjectDocument, time: number): ProjectDocument {
  const state = readViewState(doc);
  return writeViewState(doc, { playheadTime: time, scenePlayheads: { ...state.scenePlayheads, [activeSceneId(doc)]: time } });
}
export const playheadOf = (doc: ProjectDocument): number => readViewState(doc).playheadTime;
export function setKeyframesExpanded(doc: ProjectDocument, elementId: string, expanded: boolean): ProjectDocument {
  const ids = readViewState(doc).expandedKeyframeElementIds.filter((id) => id !== elementId);
  return writeViewState(doc, { expandedKeyframeElementIds: expanded ? [...ids, elementId] : ids });
}
/** A debouncer for scroll saves: the last value within 300 ms is the one written. Time is passed in, so it runs anywhere. */
export function createScrollSaver(save: (scrollLeft: number) => void) {
  let pending: { value: number; due_ms: number } | undefined;
  return {
    scrolled(scrollLeft: number, now_ms: number): void { pending = { value: scrollLeft, due_ms: now_ms + SCROLL_SAVE_DEBOUNCE_MS }; },
    tick(now_ms: number): void { if (pending && now_ms >= pending.due_ms) { save(pending.value); pending = undefined; } },
    /** A scrub that ends, or the project closing, saves at once. */
    flush(): void { if (pending) { save(pending.value); pending = undefined; } },
  };
}
export const minFrame = (fps: Rational): number => frameTicks(fps);
