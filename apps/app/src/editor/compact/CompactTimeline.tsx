import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { pressClip, pressEmpty, pressMarker, visibleElements, type Gesture as TimelineGesture, type GestureEnv, type GestureFeedback, type GesturePoint } from "@jagentchill/app-core";
import { formatTimecode, timeline } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { Icon, Marker, MARKER_COLORS, RangeBar, SnapLine, Tap, Text, TrackLane, radius, space, useTheme, useToast, type ColorToken, type IconName } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useProjectActions } from "../../projects/actions";
import { useProjectImage } from "../../state";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { nextFrame, observeSize } from "../dom";
import { fxOf } from "../fx/store";
import { FxTimelineLayer } from "../fx/TimelineLayer";
import { ContentTimelineLayer } from "../timeline/ContentLayer";
import { TimelineClip } from "../TimelineClip";
import { clampCompactZoom, COMPACT, compactRows, compactTrackGeometry, edgeScrollSpeed, groupOfTrackType, GROUP_TRACK_TYPES, inMainTrackControlGutter, secondsBadge, touchZone, zoomRange, type CompactRow, type LaneGroup } from "./layout";
import { bindTouch, haptic, TOUCH, type DragSession, type NativeGesture, type TouchPoint } from "./touch";
import { advanceCompactInertia, compactPinchZoom, compactTouchTime } from "./touch-math";

const RULER = COMPACT.ruler;
const TRACK_ICON: Record<string, IconName> = { video: "video", audio: "music", text: "type", graphic: "smile", effect: "sparkles", adjustment: "adjust", caption: "cc" };
const STRIP_TOKEN: Record<string, ColorToken> = { video: "clip/overlay", audio: "clip/audio", text: "clip/text", graphic: "clip/sticker", effect: "clip/effect", adjustment: "clip/adjustment", caption: "clip/caption" };
export type CompactTimelineProps = {
  /** The open tool group: its lanes are drawn in full. */
  group: LaneGroup | null;
  /** The 48 pt timeline that stays above an open tool sheet: the main track only, scrolled to seek. */
  small?: boolean;
  /** "Select" of the More sheet: a tap adds an element to the selection or takes it out. */
  multi?: boolean;
  /** The marker whose strip is shown: its flag is drawn selected. */
  selectedMarker?: string | null;
  onAddMedia(): void; onOpenGroup(group: LaneGroup): void; onOpenTracks(trackId: string): void; onMarker(markerId: string): void; onCover(): void;
};

/**
 * The timeline of the phone editor: a fixed playhead at the centre with the lanes scrolling under it, so scrolling is
 * seeking. It draws the same project with the same clips and runs the same gestures of the timeline engine as the wide
 * timeline — only the layout and the touch bindings are its own.
 */
export function CompactTimeline(props: CompactTimelineProps) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const actions = useProjectActions();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const { controller } = runtime, session = controller.session, document = controller.document, sceneId = session.sceneId, scene = timeline.sceneById(document, sceneId);
  const fps = document.settings.fps as Rational, duration = timeline.sceneDurationOf(scene), selectedIds = session.selection.selectedElements;
  const [size, setSize] = useState({ width: 390, height: 240 });
  const [manual, setManual] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [feedback, setFeedback] = useState<GestureFeedback>({ kind: "idle" });
  // Reorder mode of the main track: its clips as tiles, the held one under the finger, the others making room where it would drop.
  const [reorder, setReorder] = useState<{ id: string; order: string[]; from: number; to: number; base: number; x: number } | null>(null);
  const body = useRef<View>(null);
  const [touchNativeGesture, setTouchNativeGesture] = useState<NativeGesture>(() => Gesture.Tap().enabled(false));
  const small = props.small === true;

  // The lanes of the open group and of what is selected are drawn in full; the rest are strips.
  const expandedTypes = useMemo(() => {
    const types = new Set<string>(props.group && !small ? GROUP_TRACK_TYPES[props.group] : []);
    if (!small) for (const track of timeline.tracksOfScene(scene)) if (track !== scene.tracks.main && track.elements.some((element) => selectedIds.includes(element.id))) types.add(track.type);
    return types;
  }, [props.group, small, scene, selectedIds]);
  const hasAudio = useMemo(() => timeline.elementsOfScene(scene).some((element) => element.type === "audio"), [scene]);
  const laid = useMemo(() => compactRows(document, { sceneId, expandedTypes, smallMain: small || props.group === "overlay", addAudioRow: !small && !hasAudio && scene.tracks.main.elements.length > 0 }), [document, sceneId, expandedTypes, small, props.group, hasAudio, scene]);
  const rows = small ? laid.rows.filter((row) => row.zone === "main") : laid.rows, full = rows.filter((row) => !row.collapsed);
  const width = size.width, centre = width / 2, viewportHeight = Math.max(8, size.height - RULER);
  const range = zoomRange(duration, width, fps), zoom = clampCompactZoom(session.view.zoomLevel, range);
  const time = transport.playing ? transport.time : session.playhead;
  const maxScroll = timeline.ticksToPixels(duration, zoom), scroll = (manual ?? timeline.mobileTimeToScroll(time, zoom)) + offset;
  const maxScrollTop = Math.max(0, laid.height - viewportHeight), top = small ? 0 : Math.min(scrollTop, maxScrollTop);
  const live = useRef({ rows, full, zoom, scroll, width, centre, top, maxScroll, maxScrollTop, duration, fps, range, small, multi: props.multi === true, props, offset });
  live.current = { rows, full, zoom, scroll, width, centre, top, maxScroll, maxScrollTop, duration, fps, range, small, multi: props.multi === true, props, offset };

  useEffect(() => observeSize(body.current, setSize), []);
  useEffect(() => { runtime.setViewportWidth(width); }, [runtime, width]);
  // A stored zoom outside the phone's range is brought into it once the width is known.
  useEffect(() => { if (Math.abs(session.view.zoomLevel - zoom) > 1e-6) controller.setView({ zoomLevel: zoom }); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const env = useMemo<GestureEnv>(() => ({ controller, prefs: () => runtime.prefs, rows: () => live.current.full, zoomLevel: () => live.current.zoom, platform: "mobile" }), [controller, runtime]);

  useEffect(() => {
    let stopInertia: (() => void) | null = null, lastSnap: number | undefined;
    const contentX = (point: TouchPoint) => point.x - live.current.centre + live.current.scroll;
    const timeAt = (point: TouchPoint) => compactTouchTime(point.x, live.current.width, live.current.scroll, live.current.zoom, live.current.duration, live.current.fps);
    const contentY = (point: TouchPoint) => point.y - RULER + live.current.top;
    const sceneNow = () => timeline.sceneById(controller.document, controller.session.sceneId);
    /** What a finger is on: an element of a lane (a strip takes fingers 12 pt around it), or the lane, or nothing. */
    const hitAt = (point: TouchPoint): { element?: timeline.El; row?: CompactRow } => {
      const y = contentY(point), at = timeAt(point), x = contentX(point);
      if (y >= mainRow.top - top && y < mainRow.top - top + mainRow.height && inMainTrackControlGutter(point.x)) return {};
      if (point.y < RULER || x < 0) return {};
      const candidates = live.current.rows.filter((row) => (row.collapsed ? row.height > 0 && y >= row.top - 12 && y <= row.top + row.height + 12 : y >= row.top && y < row.top + row.height));
      const ordered = [...candidates].sort((a, b) => Math.abs(y - (a.top + a.height / 2)) - Math.abs(y - (b.top + b.height / 2)));
      for (const row of ordered) {
        const element = timeline.trackById(sceneNow(), row.trackId)?.elements.find((entry) => entry.startTime <= at && at < timeline.endOf(entry));
        if (element) return { element, row };
      }
      return { row: ordered.find((row) => !row.collapsed) };
    };
    /** The selected element whose trim handle a finger is on. */
    const handleAt = (point: TouchPoint): { element: timeline.El; zone: "trim-start" | "trim-end" } | null => {
      const y = contentY(point), x = contentX(point), state = live.current;
      if (y >= mainRow.top - state.top && y < mainRow.top - state.top + mainRow.height && inMainTrackControlGutter(point.x)) return null;
      for (const id of controller.session.selection.selectedElements) {
        const located = timeline.locate(controller.document, id), row = located ? state.full.find((entry) => entry.trackId === located.track.id) : undefined;
        if (!located || !row || row.locked || y < row.top - 6 || y > row.top + row.height + 6) continue;
        const left = timeline.ticksToPixels(located.element.startTime, state.zoom), zone = touchZone(x - left, timeline.ticksToPixels(located.element.duration, state.zoom), TOUCH.trimHit, TOUCH.trimHandle);
        if (zone === "trim-start" || zone === "trim-end") return { element: located.element, zone };
      }
      return null;
    };
    /** The marker whose flag on the ruler a finger is on: 44 pt across the flag. */
    const markerAt = (point: TouchPoint): { id: string; time: number } | null => {
      if (point.y > RULER + 6 || live.current.small) return null;
      const x = contentX(point), near = (sceneNow().markers as { id: string; time: number }[]).map((marker) => ({ marker, distance: Math.abs(timeline.ticksToPixels(marker.time, live.current.zoom) - x) })).filter((entry) => entry.distance <= 22).sort((a, b) => a.distance - b.distance)[0];
      return near ? { id: near.marker.id, time: near.marker.time } : null;
    };
    const seekTo = (px: number) => {
      const state = live.current, target = timeline.mobileScrollToTime(px, state.zoom, state.duration, state.fps);
      if (target !== controller.session.playhead) runtime.seek(target);
    };
    /** Follows a gesture of the timeline engine with the finger; near the screen edges the lanes scroll under it. */
    const follow = (gesture: TimelineGesture, lane: (point: TouchPoint) => number): DragSession => {
      let last: TouchPoint | null = null, cancelFrame: (() => void) | null = null, done = false, before = performance.now(), shift = 0;
      const pointOf = (point: TouchPoint): GesturePoint => ({ time: timeAt(point), y: lane(point), clientX: point.clientX, clientY: point.clientY });
      const sync = () => {
        const shown = { ...gesture.feedback };
        setFeedback(shown);
        if (shown.snapTime !== undefined && shown.snapTime !== lastSnap) haptic("light");
        lastSnap = shown.snapTime;
        // While an edge is trimmed the preview shows the frame at that edge.
        if (shown.kind === "trim" && shown.tooltip) void runtime.engine?.seek(shown.tooltip.time, "scrub");
      };
      const tick = () => {
        cancelFrame = null;
        if (done || !last) return;
        const now = performance.now(), speed = edgeScrollSpeed(last.x, live.current.width, TOUCH.edgeZone, TOUCH.edgeMin, TOUCH.edgeMax), state = live.current;
        const next = Math.min(state.maxScroll - (state.scroll - state.offset) + state.width / 2, Math.max(-(state.scroll - state.offset), shift + (speed * (now - before)) / 1000));
        before = now;
        if (speed !== 0 && next !== shift) { shift = next; live.current = { ...state, scroll: state.scroll - state.offset + shift, offset: shift }; setOffset(shift); gesture.move(pointOf(last)); sync(); }
        if (speed !== 0) cancelFrame = nextFrame(tick);
      };
      const finish = () => { done = true; cancelFrame?.(); setOffset(0); setFeedback({ kind: "idle" }); lastSnap = undefined; void runtime.engine?.seek(controller.session.playhead, "exact"); };
      return {
        move(point) { last = point; before = performance.now(); gesture.move(pointOf(point)); sync(); cancelFrame ??= nextFrame(tick); },
        end(point) { gesture.end({ ...pointOf(point), now_ms: point.time_ms } as GesturePoint); finish(); },
        cancel() { gesture.cancel(); finish(); },
      };
    };
    const binding = bindTouch(body.current, {
      down() { stopInertia?.(); stopInertia = null; runtime.pause(); },
      tap(point) {
        const state = live.current;
        if (state.small) return;
        // A flag of the ruler: the playhead goes to the marker and its editor opens.
        const flag = markerAt(point);
        if (flag) { runtime.seek(flag.time); state.props.onMarker(flag.id); return; }
        const hit = hitAt(point), fx = fxOf(runtime);
        if (fx.state.transitionId !== null) fx.selectTransition(null);
        if (!hit.element || !hit.row) { if (!state.multi) controller.select(timeline.deselectAll()); return; }
        if (hit.row.locked) { const trackId = hit.row.trackId; toast.show({ kind: "info", message: t("Track is locked"), action: { label: t("Unlock"), onPress: () => void runtime.act("timeline.track-lock.toggle", { trackId }) } }); haptic("warning"); return; }
        const group = hit.row.collapsed ? groupOfTrackType(hit.row.type) : null;
        if (group) state.props.onOpenGroup(group);
        controller.select(state.multi ? timeline.clickElement(controller.stored, controller.session.selection, hit.element.id, { toggle: true }, controller.session.sceneId) : timeline.selectElements([hit.element.id]));
      },
      drag(start, now) {
        const state = live.current, handle = state.small ? null : handleAt(start);
        if (handle) {
          const row = state.full.find((entry) => entry.trackId === timeline.locate(controller.document, handle.element.id)?.track.id), y = row ? row.top + row.height / 2 : 0;
          const session = follow(pressClip(env, { time: timeAt(start), y, clientX: start.clientX, clientY: start.clientY, elementId: handle.element.id, zone: handle.zone }), () => y);
          session.move?.(now);
          return session;
        }
        // Anything else scrolls: sideways to seek, up and down through the lanes when they do not fit.
        const vertical = !state.small && state.maxScrollTop > 0 && Math.abs(now.clientY - start.clientY) > Math.abs(now.clientX - start.clientX);
        const base = vertical ? state.top : state.scroll, origin = vertical ? start.clientY : start.clientX;
        const apply = (point: TouchPoint) => {
          if (vertical) { setScrollTop(Math.min(live.current.maxScrollTop, Math.max(0, base - (point.clientY - origin)))); return; }
          const px = Math.min(live.current.maxScroll, Math.max(0, base - (point.clientX - origin)));
          setManual(px); seekTo(px);
        };
        apply(now);
        return {
          move: apply,
          end(_point, velocity) {
            if (vertical) return;
            // Inertia: the release speed decays by 0.998 per ms, seeking all the way.
            let speed = -velocity.x, px = Math.min(live.current.maxScroll, Math.max(0, base - (_point.clientX - origin))), before = performance.now(), cancelFrame: (() => void) | null = null;
            if (Math.abs(speed) < 0.05) { setManual(null); return; }
            const step = () => {
              const at = performance.now(), dt = at - before;
              before = at;
              const advanced = advanceCompactInertia(px, speed, dt, TOUCH.deceleration);
              px = advanced.position; speed = advanced.velocity;
              const clamped = Math.min(live.current.maxScroll, Math.max(0, px));
              setManual(clamped); seekTo(clamped);
              if (Math.abs(speed) < 0.02 || clamped !== px) { stopInertia = null; setManual(null); return; }
              cancelFrame = nextFrame(step);
            };
            stopInertia = () => { cancelFrame?.(); setManual(null); };
            cancelFrame = nextFrame(step);
          },
          cancel() { setManual(null); },
        };
      },
      longPress(point) {
        const state = live.current;
        if (state.small) return null;
        // A held flag is picked up and moves with the finger, snapping like every other drag of the timeline.
        const flag = markerAt(point);
        if (flag) { haptic("medium"); return follow(pressMarker(env, { time: flag.time, y: 0, clientX: point.clientX, clientY: point.clientY, markerId: flag.id, onClick: () => undefined }), () => 0); }
        const hit = hitAt(point);
        if (hit.element && hit.row && hit.row.zone === "main" && !hit.row.locked && controller.edit().magnet && !controller.edit().freeLayer) {
          // A held clip of the magnetic main track: every clip becomes a tile and the held one is carried to its new place.
          haptic("medium");
          const held = hit.element, order = sceneNow().tracks.main.elements.map((entry) => entry.id), from = order.indexOf(held.id), pitch = COMPACT.mainRow + COMPACT.rowGap;
          let base = point.x - from * pitch - COMPACT.mainRow / 2, to = from, last = point, cancelFrame: (() => void) | null = null, done = false;
          const show = () => { to = Math.max(0, Math.min(order.length - 1, Math.round((last.x - COMPACT.mainRow / 2 - base) / pitch))); setReorder({ id: held.id, order, from, to, base, x: last.x }); };
          // Near the screen edges the row of tiles slides under the finger.
          const tick = () => { cancelFrame = null; if (done) return; const speed = edgeScrollSpeed(last.x, live.current.width, TOUCH.edgeZone, TOUCH.edgeMin, TOUCH.edgeMax); if (speed === 0) return; base = Math.min(live.current.width / 2, Math.max(live.current.width / 2 - order.length * pitch, base - speed / 60)); show(); cancelFrame = nextFrame(tick); };
          show();
          const finish = () => { done = true; cancelFrame?.(); setReorder(null); };
          return {
            move(at) { last = at; show(); cancelFrame ??= nextFrame(tick); },
            end() {
              finish();
              if (to === from) return;
              // The cut the clip enters at, in the track as it is: before the clip now at that place, or after it when moving later.
              const main = sceneNow().tracks.main.elements, there = main[to], cut = to < from ? there.startTime : timeline.endOf(there);
              const result = controller.run(timeline.move({ sceneId: controller.session.sceneId, elementIds: [held.id], anchorId: held.id, time: held.startTime, target: { kind: "same" }, pointerTime: cut }));
              haptic(result.ok ? "medium" : "warning");
            },
            cancel: finish,
          };
        }
        if (hit.element && hit.row && !hit.row.collapsed && !hit.row.locked) {
          haptic("medium");
          const own = hit.row, element = hit.element;
          // The picked-up bar stays on its lane until the finger is over another lane that can hold it.
          const lane = (at: TouchPoint) => { const y = contentY(at), over = live.current.full.find((row) => y >= row.top && y < row.top + row.height && !row.locked && timeline.canHold({ type: row.type }, element.type)); const row = over ?? live.current.full.find((entry) => entry.trackId === own.trackId) ?? own; return row.top + row.height / 2; };
          return follow(pressClip(env, { time: timeAt(point), y: own.top + own.height / 2, clientX: point.clientX, clientY: point.clientY, elementId: element.id, zone: "body" }), lane);
        }
        if (hit.element) return null;
        // Empty lane space: a rectangle selects what it crosses.
        haptic("medium");
        return follow(pressEmpty(env, { time: timeAt(point), y: contentY(point), clientX: point.clientX, clientY: point.clientY, contentX: Math.max(0, contentX(point)), now_ms: point.time_ms }), contentY);
      },
      pinch() {
        const base = live.current.zoom;
        let limit = false;
        return {
          move(scale) {
            const requested = compactPinchZoom(base, scale, live.current.range.min, live.current.range.max), next = clampCompactZoom(requested, live.current.range), atLimit = next !== requested;
            if (atLimit && !limit) haptic("rigid");
            limit = atLimit;
            // The scroll offset is the playhead time, so the time under the centre line stays where it is.
            if (Math.abs(next - controller.session.view.zoomLevel) > 1e-6) controller.setView({ zoomLevel: next });
          },
        };
      },
      wheel(wheel) {
        const state = live.current;
        if (wheel.zoom) { controller.setView({ zoomLevel: clampCompactZoom(timeline.wheelZoom(state.zoom, wheel.deltaY, state.range.min), state.range) }); return; }
        const delta = Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY) || wheel.shift || state.maxScrollTop === 0 ? (Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY) ? wheel.deltaX : wheel.deltaY) : null;
        if (delta === null) { setScrollTop((current) => Math.min(live.current.maxScrollTop, Math.max(0, current + wheel.deltaY))); return; }
        runtime.pause();
        seekTo(Math.min(state.maxScroll, Math.max(0, state.scroll + delta)));
      },
    });
    if (Platform.OS !== "web") setTouchNativeGesture(binding.gesture);
    return binding;
  }, [controller, env, runtime, t, toast]);

  const x = (ticks: number) => timeline.ticksToPixels(ticks, zoom);
  const viewLeft = scroll - centre, viewport = { zoomLevel: zoom, scrollLeft: Math.max(0, viewLeft), width };
  const ticks = useMemo(() => timeline.rulerTicks(zoom, fps, Math.max(0, viewLeft), width), [zoom, fps, viewLeft, width]);
  const markers = scene.markers as { id: string; time: number; color: number | string; note?: string }[];
  const colourOf = (value: number | string): number => (typeof value === "number" ? value : 0);
  const media = runtime.media.getState();
  const dragging = new Set(feedback.draggingIds ?? []);
  const selectedGroups = new Set(timeline.elementsOfScene(scene).filter((element) => selectedIds.includes(element.id) && element.groupId).map((element) => element.groupId));
  const main = scene.tracks.main, mainRow = rows.find((row) => row.zone === "main")!, mainEnd = main.elements.reduce((latest, element) => Math.max(latest, timeline.endOf(element)), 0);
  const empty = main.elements.length === 0;
  const sounding = main.elements.filter((element) => element.type === "video" && timeline.isAudioCapable(document, element) && !timeline.isFreeze(element));
  const allMuted = sounding.length > 0 && sounding.every((element) => element.muted === true);
  const cover = useProjectImage(document.metadata.id, document.cover ? { mime: document.cover.image.mime } : null, actions.imageVersion);
  const rangeBar = scene.inPoint !== undefined || scene.outPoint !== undefined ? { start: scene.inPoint ?? 0, end: scene.outPoint ?? duration } : null;
  const addX = Math.min(centre + x(mainEnd) - scroll + space[2], width - COMPACT.addButton - space[2]);
  const side = !small && !empty && props.group !== "overlay" && !reorder;
  const trackGeometry = compactTrackGeometry(width, centre, scroll, side);
  const contentHeight = Math.max(laid.height, viewportHeight);
  const muteAll = () => {
    const flip = allMuted ? sounding : sounding.filter((element) => element.muted !== true);
    if (flip.length > 0) controller.run({ ...timeline.toggleElementFlag({ sceneId, elementIds: flip.map((element) => element.id), flag: "muted" }), label: allMuted ? "Unmute clip audio" : "Mute clip audio" });
  };

  const surface = (
    <View ref={body} testID="compact-timeline" accessibilityLabel={t("Timeline")} {...({ dataSet: { zoom: String(zoom), scroll: String(Math.round(scroll)), small: small ? "true" : "false" } } as object)} style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: theme.color("bg/editor") }}>
      {/* Ruler: second labels, and the flags of the markers. */}
      <View testID="timeline-ruler" style={{ position: "absolute", left: 0, right: 0, top: 0, height: RULER, overflow: "hidden" }}>
        {ticks.map((tick) => {
          const left = centre + tick.x - scroll;
          return left < -80 || left > width + 80 ? null : (
            <View key={tick.timeSeconds} pointerEvents="none" style={{ position: "absolute", left, top: 0, bottom: 0, width: 72 }}>
              <View style={{ position: "absolute", bottom: 0, width: 1, height: tick.label ? 6 : 3, backgroundColor: theme.color("border/strong") }} />
              {tick.label ? <Text variant="caption" color="timeline/ruler-text" tabular numberOfLines={1} style={{ position: "absolute", top: 1, left: 4 }}>{tick.label}</Text> : null}
            </View>
          );
        })}
        {small ? null : markers.map((entry) => {
          const left = centre + x(entry.time) - scroll;
          return left < -20 || left > width + 20 ? null : (
            <View key={entry.id} pointerEvents="none" testID="marker-flag" aria-selected={props.selectedMarker === entry.id} {...({ dataSet: { selected: props.selectedMarker === entry.id ? "true" : "false" } } as object)} accessibilityLabel={entry.note ? t("Marker: {note}", { note: entry.note }) : t("Marker")} style={[{ position: "absolute", left: left - 5, top: RULER - 12, zIndex: 2 }, props.selectedMarker === entry.id ? { transform: [{ scale: 1.5 }], top: RULER - 14 } : null]}>
              <Marker color={colourOf(entry.color)} flag={{ width: 10, height: 10 }} lineHeight={0} name={entry.note} />
            </View>
          );
        })}
      </View>
      <View testID="timeline-tracks" style={{ position: "absolute", left: 0, right: 0, top: RULER, bottom: 0, overflow: "hidden" }}>
        <View testID="timeline-track-content-viewport" style={{ position: "absolute", left: trackGeometry.viewportLeft, right: 0, top: 0, bottom: 0, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: trackGeometry.contentLeft, top: -top, width: Math.max(1, maxScroll + width), height: contentHeight }}>
          {rows.map((row) => {
            const track = timeline.trackById(scene, row.trackId)!;
            if (row.collapsed) {
              if (row.height === 0) return null;
              const fill = theme.color(STRIP_TOKEN[row.type] ?? "clip/video");
              return (
                <View key={row.trackId} testID={`strip-${row.type}`} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: row.top, height: row.height }}>
                  {visibleElements(track.elements, viewport, 200).map((element) => <View key={element.id} testID={`strip-el-${element.id}`} style={{ position: "absolute", left: x(element.startTime), width: Math.max(2, x(element.duration) - 1), top: 0, height: row.height, borderRadius: 2, backgroundColor: fill, opacity: track.locked ? 0.5 : 1 }} />)}
                </View>
              );
            }
            const shown = visibleElements(track.elements, viewport, 400, dragging);
            return (
              <View key={row.trackId} testID={`track-${row.zone}-${row.type}`} nativeID={`track-${row.trackId}`} role={track.elements.length ? "list" : "group"} aria-label={t(track.name)} style={{ position: "absolute", left: 0, right: 0, top: row.top, height: row.height, opacity: row.locked ? 0.5 : 1 }}>
                {row.zone === "main" ? null : <TrackLane height={row.height} locked={row.locked} />}
                {(row.zone === "main" && reorder ? [] : shown).map((element) => {
                  const left = x(element.startTime), clipWidth = x(element.duration), selected = selectedIds.includes(element.id);
                  return <TimelineClip key={element.id} runtime={runtime} document={document} element={element} row={row} zoomLevel={zoom} visibleFrom={Math.max(0, viewLeft - left - 200)} visibleTo={Math.min(clipWidth, viewLeft + width - left + 200)}
                    selected={selected} dragging={dragging.has(element.id)} locked={row.locked} trimAdjusted={session.isTrimAdjusted(element.id)} groupSelected={selectedGroups.has(element.groupId)} thumbnails={media.thumbnails} frames={runtime.uiVersion}
                    trimHandle={small ? undefined : TOUCH.trimHandle} durationBadge={selected && !small ? secondsBadge(element.duration) : undefined} />;
                })}
              </View>
            );
          })}
          {small ? null : markers.map((entry) => <View key={entry.id} pointerEvents="none" style={{ position: "absolute", left: x(entry.time), top: 0, bottom: 0, width: 1, opacity: 0.6, backgroundColor: theme.color(MARKER_COLORS[((colourOf(entry.color) % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length]![0]) }} />)}
          {rangeBar ? <View pointerEvents="none" style={{ position: "absolute", left: x(rangeBar.start), top: 0 }}><RangeBar width={Math.max(2, x(rangeBar.end - rangeBar.start))} height={contentHeight} /></View> : null}
          {feedback.snapTime !== undefined ? <View pointerEvents="none" testID="snap-line" style={{ position: "absolute", left: x(feedback.snapTime), top: 0, zIndex: 5 }}><SnapLine height={contentHeight} /></View> : null}
          {feedback.marquee ? <View pointerEvents="none" testID="marquee" style={{ position: "absolute", left: feedback.marquee.left, top: feedback.marquee.top, width: feedback.marquee.width, height: feedback.marquee.height, borderWidth: 1, borderColor: theme.color("timeline/selection"), backgroundColor: theme.color("accent/subtle"), opacity: 0.6, zIndex: 5 }} /> : null}
          <ContentTimelineLayer rows={full} zoomLevel={zoom} scrollLeft={Math.max(0, viewLeft)} viewportWidth={width} />
          <FxTimelineLayer rows={full} zoomLevel={zoom} scrollLeft={Math.max(0, viewLeft)} scrollTop={top} viewportWidth={width} showCuts={!small} />
          {feedback.tooltip ? <View pointerEvents="none" testID="trim-tooltip" style={{ position: "absolute", left: x(feedback.tooltip.time) + 8, top: top + 2, zIndex: 6, paddingHorizontal: space[1.5], paddingVertical: space[0.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{feedback.tooltip.text}</Text></View> : null}
        </View>
        </View>
        {/* Fixed over the lanes: the buttons of the main track, the lane labels and the rows that add content. */}
        {empty && !small ? (
          <Tap role="button" label={t("Add media")} testID="tl-ctl-add-media" onPress={props.onAddMedia}
            style={{ position: "absolute", left: space[3], right: space[3], top: mainRow.top - top, height: mainRow.height, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.color("border/strong"), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2] }}>
            <Icon name="plus" size={20} color="text/primary" /><Text variant="body-medium">{t("Add media")}</Text>
          </Tap>
        ) : null}
        {side ? (
          <View testID="main-track-control-gutter" style={{ position: "absolute", left: 0, top: mainRow.top - top, width: COMPACT.trackGutter, height: mainRow.height, flexDirection: "row", gap: space[1], alignItems: "center", paddingLeft: space[1], backgroundColor: theme.color("bg/editor"), zIndex: 6 }}>
            {sounding.length > 0 ? <SideButton testID="tl-ctl-mute-all" icon={allMuted ? "mute" : "vol"} label={t(allMuted ? "Unmute clip audio" : "Mute clip audio")} on={allMuted} onPress={muteAll} /> : null}
            <SideButton testID="tl-ctl-cover" icon="image" label={t("Cover")} image={cover} onPress={props.onCover} />
          </View>
        ) : null}
        {!small && !empty && !reorder ? (
          <Tap role="button" label={t("Add media")} testID="tl-ctl-add-clip" onPress={props.onAddMedia}
            style={{ position: "absolute", left: addX, top: mainRow.top - top + (mainRow.height - COMPACT.addButton) / 2, width: COMPACT.addButton, height: COMPACT.addButton, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/elevated"), borderWidth: 1, borderColor: theme.color("border/control"), zIndex: 6 }}>
            <Icon name="plus" size={20} color="text/primary" />
          </Tap>
        ) : null}
        {laid.addAudioTop !== null ? (
          <Tap role="button" label={t("Add audio")} testID="tl-ctl-add-audio" onPress={() => props.onOpenGroup("audio")}
            style={{ position: "absolute", left: Math.max(space[2], centre - scroll), right: space[2], top: laid.addAudioTop - top, height: COMPACT.addAudioRow, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], backgroundColor: theme.color("timeline/track-bg") }}>
            <Icon name="music" size={14} color="text/secondary" /><Text variant="meta" color="text/secondary">{t("Add audio")}</Text>
          </Tap>
        ) : null}
        {small ? null : full.filter((row) => row.zone !== "main").map((row) => {
          const track = timeline.trackById(scene, row.trackId)!;
          const badges: IconName[] = [...(track.locked ? ["lock" as const] : []), ...(track.hidden === true ? ["eye-off" as const] : []), ...(track.muted === true ? ["mute" as const] : []), ...(track.solo === true ? ["star" as const] : [])];
          return (
            <Tap key={row.trackId} role="button" label={t("Track {name}", { name: track.name })} testID={`tl-ctl-lane-${row.type}`} target onPress={() => props.onOpenTracks(row.trackId)}
              style={{ position: "absolute", left: 0, top: row.top - top, width: badges.length > 0 ? COMPACT.laneLabel : 28, height: row.height, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm, backgroundColor: theme.color("bg/elevated"), zIndex: 6 }}>
              <Icon name={TRACK_ICON[row.type] ?? "layers"} size={14} color="text/secondary" />
              {badges.map((badge) => <Icon key={badge} name={badge} size={12} color="text/secondary" />)}
            </Tap>
          );
        })}
      </View>
      {reorder ? (
        <View pointerEvents="none" testID="reorder-tiles" style={{ position: "absolute", left: 0, right: 0, top: RULER + mainRow.top - top, height: COMPACT.mainRow, zIndex: 8 }}>
          {reorder.order.map((id, index) => {
            const element = main.elements.find((entry) => entry.id === id), held = id === reorder.id, pitch = COMPACT.mainRow + COMPACT.rowGap;
            if (!element) return null;
            // The others keep their order and leave the place the held tile would take.
            const among = reorder.order.filter((entry) => entry !== reorder.id).indexOf(id), slot = held ? reorder.to : among < reorder.to ? among : among + 1;
            const picture = typeof element.mediaId === "string" ? (element.type === "video" ? runtime.media.filmstrip(element.mediaId) : null) ?? runtime.media.thumbnail(element.mediaId) : null;
            return (
              <View key={id} testID={held ? "reorder-tile-held" : "reorder-tile"} {...({ dataSet: { index: String(index), slot: String(slot) } } as object)}
                style={[{ position: "absolute", top: held ? -4 : 0, left: held ? reorder.x - COMPACT.mainRow / 2 : reorder.base + slot * pitch, width: COMPACT.mainRow, height: COMPACT.mainRow, borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("clip/video"), borderWidth: held ? 2 : 0, borderColor: theme.color("timeline/selection"), zIndex: held ? 2 : 1, opacity: held ? 0.92 : 1 },
                  picture ? ({ backgroundImage: `url("${picture}")`, experimental_backgroundImage: `url("${picture}")`, backgroundSize: "cover", backgroundPosition: "center" } as object) : null, held ? theme.elevation(2) : null]} />
            );
          })}
        </View>
      ) : null}
      {/* The playhead: fixed at the centre, over the ruler and the lanes. */}
      <View pointerEvents="none" testID="playhead" role="slider" accessibilityLabel={t("Playhead")} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.max(duration, time)} aria-valuenow={time}
        aria-valuetext={`${formatTimecode(time, "HH:MM:SS:FF", fps)} / ${formatTimecode(duration, "HH:MM:SS:FF", fps)}`} style={{ position: "absolute", left: centre - 1, top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: theme.color("timeline/playhead"), zIndex: 7 }} />
    </View>
  );
  // Gesture Handler's web adapter does not own the editor's pointer stream. `touch.web.ts` keeps
  // binding the existing pointer handlers; only native renders a GestureDetector with its recognizer.
  return Platform.OS === "web" ? surface : <GestureDetector gesture={touchNativeGesture}>{surface}</GestureDetector>;
}

/** One of the 56 pt buttons fixed at the start of the main track. */
function SideButton(props: { icon: IconName; label: string; on?: boolean; image?: string | null; onPress(): void; testID: string }) {
  const theme = useTheme();
  return (
    <Tap role="button" label={props.label} pressedState={props.on} testID={props.testID} onPress={props.onPress}
      style={[{ width: COMPACT.sideButton, height: COMPACT.sideButton, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 2, backgroundColor: theme.color("bg/elevated"), borderWidth: 1, borderColor: theme.color("border/hairline"), overflow: "hidden" }, props.image ? ({ backgroundImage: `url("${props.image}")`, backgroundSize: "cover", backgroundPosition: "center" } as object) : null]}>
      {props.image ? null : <Icon name={props.icon} size={20} color={props.on ? "accent" : "text/primary"} />}
      <View style={props.image ? { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.color("clip/label-scrim") } : null}><Text variant="caption" color={props.image ? "clip/label" : "text/secondary"} numberOfLines={2} align="center" style={{ fontSize: 10, lineHeight: 12 }}>{props.label}</Text></View>
    </Tap>
  );
}
