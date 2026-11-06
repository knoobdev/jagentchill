import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TextInput, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import {
  clipZone, dragLibraryItems, layoutRows, panLabel, setTrackSound, TRACK_PAN, TRACK_VOLUME, trackSound, pressClip, pressEmpty, pressMarker, pressRuler, rowAtY, rowsHeight, TIMELINE_FRAME, visibleElements,
  type ClipZone, type Gesture, type GestureEnv, type GestureFeedback, type GesturePoint, type TimelineRow,
} from "@jagentchill/app-core";
import { formatTimecode, timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import type { SyncComment } from "@jagentchill/protocol";
import { ConfirmDialog, IconButton, KeyframeDiamond, Marker, Menu, MARKER_COLORS, Popover, RangeBar, Slider, SnapLine, Tap, Text, TrackLane, radius, space, useTheme, type MenuItem, dragHandle } from "@jagentchill/ui";
import { useT } from "../locale";
import { sameShallow, useEditor, useEditorVersion, useSettledTransport } from "./context";
import { bindDropZone, bindPointer, bindWheel, nextFrame, now, observeSize, placePlayhead, setCursor, type PointerInfo } from "./dom";
import { useElementMenu } from "./menus";
import { MarkerPopover, RenameElementDialog, ReplaceMediaDialog, ScenesSheet } from "./TimelineDialogs";
import { FxTimelineLayer } from "./fx/TimelineLayer";
import { DropFeedback, sameRow, TimelineClip } from "./TimelineClip";
import { TimelineToolbar } from "./TimelineToolbar";
import { GraphEditor } from "./graph/GraphEditor";
import { ContentTimelineLayer } from "./timeline/ContentLayer";
import { KeyframeLanes, LaneHeaders } from "./timeline/KeyframeLanes";

const BODY: ClipZone = "body";
// One object for "no gesture": ending a gesture that showed nothing does not render the timeline again.
const IDLE: GestureFeedback = { kind: "idle" };
const HEADER = TIMELINE_FRAME.headerWidth, RULER = TIMELINE_FRAME.rulerHeight;
type MenuState = { at: { x: number; y: number }; items: MenuItem[]; label: string } | null;

/** The timeline region: toolbar, ruler with markers, the header column and the tracks, with every gesture of the pointer, the wheel and the keyboard. */
// Memoised: it takes no props, so it renders for what it reads itself, not whenever the editor screen does.
export const Timeline = memo(function Timeline(props: { comments?: SyncComment[]; focusedCommentId?: string | null; onCommentPress?(comment: SyncComment): void } = {}) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, session = controller.session;
  const document = controller.document, sceneId = session.sceneId, scene = timeline.sceneById(document, sceneId);
  const view = session.view, zoomLevel = view.zoomLevel, fps = document.settings.fps as Rational;
  const selectedIds = session.selection.selectedElements;
  const rows = useMemo(() => layoutRows(document, { sceneId, expandedElementIds: view.expandedKeyframeElementIds }), [document, sceneId, view.expandedKeyframeElementIds]);
  const contentHeight = rowsHeight(rows);
  const duration = timeline.sceneDurationOf(scene);
  const [size, setSize] = useState({ width: 800, height: 240 });
  const [scrollTop, setScrollTop] = useState(0);
  const [feedback, setFeedback] = useState<GestureFeedback>(IDLE);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<{ trackId: string; draft: string } | null>(null);
  const [drop, setDrop] = useState<{ ghost?: { left: number; top: number; width: number; height: number }; line?: { top: number; width: number } } | null>(null);
  const [marker, setMarker] = useState<{ id: string; x: number } | null>(null);
  const body = useRef<View>(null), tracksNode = useRef<View>(null), rulerNode = useRef<View>(null), headerNode = useRef<View>(null);
  const viewportWidth = Math.max(100, size.width - HEADER), viewportHeight = Math.max(40, size.height - RULER);
  const min = timeline.zoomMin(duration, viewportWidth);
  const contentWidth = Math.max(viewportWidth, timeline.contentWidthPx(duration, zoomLevel, viewportWidth, min));
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth), maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  const scrollLeft = Math.min(view.scrollLeft, maxScrollLeft), top = Math.min(scrollTop, maxScrollTop);
  // What the handlers bound once read at the time of the event.
  const live = useRef({ rows, zoomLevel, scrollLeft, top, viewportWidth, viewportHeight, maxScrollLeft, maxScrollTop, duration, min });
  live.current = { rows, zoomLevel, scrollLeft, top, viewportWidth, viewportHeight, maxScrollLeft, maxScrollTop, duration, min };
  const readOnly = useRef(false);

  useEffect(() => observeSize(body.current, setSize), []);
  useEffect(() => {
    const focused = props.comments?.find((comment) => comment.commentId === props.focusedCommentId);
    if (focused?.time_ticks === undefined || viewportWidth <= 100) return;
    const x = timeline.ticksToPixels(focused.time_ticks, zoomLevel);
    if (x < scrollLeft || x > scrollLeft + viewportWidth) controller.setView({ scrollLeft: Math.max(0, x - viewportWidth / 2) });
  }, [props.focusedCommentId, props.comments, controller, zoomLevel, scrollLeft, viewportWidth]);
  useEffect(() => { runtime.setViewportWidth(viewportWidth); }, [runtime, viewportWidth]);
  // A project opens scrolled to the bottom: the main track and the audio tracks are in view.
  const opened = useRef(false);
  useEffect(() => { if (!opened.current && size.height > 0 && contentHeight > 0) { opened.current = true; setScrollTop(timeline.initialVerticalScroll(contentHeight, viewportHeight)); } }, [contentHeight, viewportHeight, size.height]);

  const env = useMemo<GestureEnv>(() => ({ controller, prefs: () => runtime.prefs, rows: () => live.current.rows, zoomLevel: () => live.current.zoomLevel, platform: "web" }), [controller, runtime]);
  const pointOf = useCallback((info: PointerInfo, area: "tracks" | "ruler"): GesturePoint & { contentX: number } => {
    const state = live.current, contentX = Math.max(0, info.x + state.scrollLeft);
    return { time: timeline.pixelsToTicks(contentX, state.zoomLevel), y: area === "tracks" ? info.y + state.top : 0, clientX: info.x, clientY: info.y, shift: info.shift, contentX };
  }, []);
  /** The element under a point of the tracks viewport, from the model: clips of a track never overlap. */
  const elementAt = useCallback((info: PointerInfo): { element: timeline.El; row: TimelineRow; localX: number; width: number } | { row?: TimelineRow } => {
    const state = live.current, point = pointOf(info, "tracks"), hit = rowAtY(state.rows, point.y);
    if (!hit.row || point.y >= hit.row.top + hit.row.baseHeight || point.y < hit.row.top) return { row: hit.row };
    const track = timeline.trackById(timeline.sceneById(controller.document, controller.session.sceneId), hit.row.trackId);
    const element = track?.elements.find((entry) => entry.startTime <= point.time && point.time < timeline.endOf(entry));
    if (!element) return { row: hit.row };
    return { element, row: hit.row, localX: point.contentX - timeline.ticksToPixels(element.startTime, state.zoomLevel), width: timeline.ticksToPixels(element.duration, state.zoomLevel) };
  }, [controller, pointOf]);

  // One running gesture; while it runs the edges of the viewport scroll under the pointer.
  const run = useCallback((gesture: Gesture, area: "tracks" | "ruler") => {
    let last: PointerInfo | null = null, cancelFrame: (() => void) | null = null, done = false;
    const sync = () => setFeedback({ ...gesture.feedback });
    const tick = () => {
      cancelFrame = null;
      if (done || !last) return;
      const state = live.current, scroll = timeline.edgeAutoScroll({ x: last.x, y: area === "tracks" ? last.y : state.viewportHeight / 2 }, { width: state.viewportWidth, height: state.viewportHeight });
      if (scroll.dx !== 0 || scroll.dy !== 0) {
        const left = Math.min(state.maxScrollLeft + (scroll.dx > 0 ? 200 : 0), Math.max(0, state.scrollLeft + scroll.dx));
        if (left !== state.scrollLeft) { controller.setView({ scrollLeft: left }); live.current = { ...live.current, scrollLeft: left }; }
        if (scroll.dy !== 0) { const next = Math.min(state.maxScrollTop, Math.max(0, state.top + scroll.dy)); live.current = { ...live.current, top: next }; setScrollTop(next); }
        gesture.move(pointOf(last, area)); sync();
        cancelFrame = nextFrame(tick);
      }
    };
    return {
      move(info: PointerInfo) { last = info; gesture.move(pointOf(info, area)); sync(); cancelFrame ??= nextFrame(tick); },
      up(info: PointerInfo) { done = true; cancelFrame?.(); gesture.end({ ...pointOf(info, area), now_ms: info.time_ms } as GesturePoint); setFeedback(IDLE); },
      cancel() { done = true; cancelFrame?.(); gesture.cancel(); setFeedback(IDLE); },
    };
  }, [controller, pointOf]);

  const elementMenu = useElementMenu();
  // What a row of the header column calls: the same functions on every render, so a row renders for its own track only.
  const renameTrack = useCallback((trackId: string, draft: string | null) => setRenaming(draft === null ? null : { trackId, draft }), []);
  const trackMenuRef = useRef<(trackId: string, time: number) => MenuItem[]>(() => []);
  const trackLabel = useRef("");
  trackLabel.current = t("Track");
  const openTrackMenu = useCallback((trackId: string, at: { x: number; y: number }) => setMenu({ at: { x: at.x, y: at.y }, items: trackMenuRef.current(trackId, controller.session.playhead), label: trackLabel.current }), [controller]);
  const trackMenu = useCallback((trackId: string, time: number): MenuItem[] => timeline.trackContextMenu(controller.stored, trackId, { clipboardHasEntry: !controller.clipboard.isEmpty }).map((item, index): MenuItem => {
    if ("separator" in item) return { type: "separator" };
    if (item.id === "add-track") return { id: "add-track", label: t("Add track"), submenu: (["video", "audio", "text", "graphic", "effect"] as const).map((type) => ({ id: type, label: t(timeline.DEFAULT_TRACK_NAMES[type]), onSelect: () => void controller.run(timeline.addTrack({ sceneId: controller.session.sceneId, type })) })) };
    return {
      id: `${item.id}-${index}`, label: t(item.label), disabled: item.disabled, danger: item.id === "delete-track",
      onSelect: () => { if (item.id === "rename-track") { const track = timeline.trackById(timeline.sceneById(controller.stored, controller.session.sceneId), trackId); setRenaming({ trackId, draft: track?.name ?? "" }); } else if (item.action) runtime.act(item.action, { trackId, time }); },
    };
  }), [controller, runtime, t]);
  trackMenuRef.current = trackMenu;

  // — Tracks: press, drag, hover, wheel, context menu —
  useEffect(() => bindPointer(tracksNode.current, {
    down(info) {
      if (info.button !== 0 || readOnly.current) return null;
      const hit = elementAt(info), point = pointOf(info, "tracks");
      if ("element" in hit) return run(pressClip(env, { ...point, elementId: hit.element.id, zone: clipZone(hit.localX, hit.width), toggle: info.mod || info.shift, alt: info.alt }), "tracks");
      return run(pressEmpty(env, { ...point, additive: info.mod || info.shift, now_ms: info.time_ms }), "tracks");
    },
    hover(info) {
      if (!info) { setHoverTime(null); setCursor(tracksNode.current, "default"); return; }
      const hit = elementAt(info), mode = controller.session.cursorMode;
      const zone = "element" in hit ? clipZone(hit.localX, hit.width) : null, locked = hit.row?.locked === true;
      setCursor(tracksNode.current, mode === "blade" ? "col-resize" : zone && locked ? "not-allowed" : zone === "trim-start" || zone === "trim-end" ? "ew-resize" : zone ? "grab" : "default");
      // The hovered time is shown only by the preview axis (off unless the person turns it on): without it nothing is
      // kept, so moving the pointer over the tracks does not draw the timeline again at every move.
      setHoverTime(runtime.prefs.previewAxis ? pointOf(info, "tracks").time : null);
    },
    context(info) {
      const hit = elementAt(info), point = pointOf(info, "tracks");
      if ("element" in hit) { pressClip(env, { ...point, elementId: hit.element.id, zone: BODY, secondary: true }); setMenu({ at: { x: info.clientX, y: info.clientY }, items: elementMenu(), label: t("Clip") }); }
      else if (hit.row) setMenu({ at: { x: info.clientX, y: info.clientY }, items: trackMenu(hit.row.trackId, point.time), label: t("Track") });
    },
    double(info) {
      const hit = elementAt(info);
      if ("element" in hit && hit.element.type === "compound") controller.enterCompound(hit.element.id);
    },
  }), [controller, elementAt, elementMenu, env, pointOf, run, t, trackMenu]);
  useEffect(() => bindPointer(rulerNode.current, { down: (info) => (info.button === 0 ? run(pressRuler(env, pointOf(info, "ruler")), "ruler") : null) }), [env, pointOf, run]);
  useEffect(() => bindWheel(body.current, (wheel) => {
    const state = live.current, intent = timeline.wheelIntent(wheel);
    if (intent.kind === "zoom") runtime.zoom({ level: timeline.wheelZoom(state.zoomLevel, intent.delta, state.min), anchor: { kind: "pointer", viewportX: Math.max(0, wheel.x - HEADER) } });
    else if (intent.kind === "horizontal") controller.setView({ scrollLeft: Math.min(state.maxScrollLeft, Math.max(0, state.scrollLeft + intent.delta)) });
    else setScrollTop((current) => Math.min(live.current.maxScrollTop, Math.max(0, current + intent.delta)));
  }), [controller, runtime]);

  // — Drops: library items and files —
  useEffect(() => {
    let drag: ReturnType<typeof dragLibraryItems> | null = null, key = "";
    const itemsOf = (payload: string | null): timeline.LibraryItem[] => { try { const parsed = JSON.parse(payload ?? "{}") as { media?: { assetIds?: string[] }; items?: timeline.LibraryItem[] }; if (Array.isArray(parsed.items)) return parsed.items; const ids = parsed.media?.assetIds ?? []; return ids.map((assetId) => ({ kind: "media" as const, assetId })); } catch { return []; } };
    const at = (x: number, y: number) => ({ time: timeline.pixelsToTicks(Math.max(0, x + live.current.scrollLeft), live.current.zoomLevel), y: y + live.current.top });
    return bindDropZone(tracksNode.current, {
      over(info) {
        if (readOnly.current) return false;
        if (!info.payload) { setDrop({}); return true; }
        if (info.payload !== key) { const items = itemsOf(info.payload); key = info.payload; drag = items.length > 0 ? dragLibraryItems(env, items) : null; }
        if (!drag) return false;
        const state = live.current, shown = drag.over(at(info.x, info.y));
        if (!shown) { setDrop(null); return true; }
        const left = timeline.ticksToPixels(shown.decision.startTime, state.zoomLevel), widthPx = timeline.ticksToPixels(shown.duration, state.zoomLevel);
        if (shown.decision.kind === "track") { const row = state.rows.find((entry) => entry.trackId === (shown.decision as { trackId: string }).trackId); setDrop(row ? { ghost: { left, top: row.top, width: widthPx, height: row.baseHeight } } : null); }
        else { const zone = state.rows.filter((row) => row.zone === (shown.decision as { zone: string }).zone), index = (shown.decision as { index: number }).index, before = zone[index], after = zone[index - 1]; const anchor = state.rows.find((row) => row.zone === "main"); setDrop({ line: { top: before ? before.top - TIMELINE_FRAME.rowGap / 2 : after ? after.top + after.height + TIMELINE_FRAME.rowGap / 2 : shown.decision.zone === "overlay" ? (anchor?.top ?? 0) - TIMELINE_FRAME.rowGap / 2 : (anchor ? anchor.top + anchor.height : 0) + TIMELINE_FRAME.rowGap / 2, width: 100_000 } }); }
        return true;
      },
      leave() { setDrop(null); },
      drop(info) {
        setDrop(null);
        const point = at(info.x, info.y);
        if (info.payload && drag) { drag.drop(point); drag = null; key = ""; return; }
        if (info.files.length > 0) void runtime.dropFiles(info.files, point, live.current.rows);
      },
    });
  }, [env, runtime]);

  // Auto-follow under playback, by the preference.
  // The running clock is followed outside React (here and in `Playhead`): the tracks render when playback starts and
  // stops, and when the view really scrolls — not on every frame of it.
  const transport = useSettledTransport();
  const manualScroll = useRef(0);
  useEffect(() => runtime.subscribeTransport(() => {
    const clock = runtime.transport, state = live.current;
    if (!clock.playing) return;
    const next = timeline.autoFollowScroll(runtime.prefs.autoFollow, { playheadX: timeline.ticksToPixels(clock.time, state.zoomLevel), scrollLeft: state.scrollLeft, viewportWidth: state.viewportWidth, now_ms: now(), lastManualScroll_ms: manualScroll.current });
    if (Math.abs(next - state.scrollLeft) > 0.5) { live.current = { ...state, scrollLeft: next }; controller.setView({ scrollLeft: next }); }
  }), [controller, runtime]);

  const ticks = useMemo(() => timeline.rulerTicks(zoomLevel, fps, scrollLeft, viewportWidth), [zoomLevel, fps, scrollLeft, viewportWidth]);
  const viewport = { zoomLevel, scrollLeft, width: viewportWidth };
  const highlighted = new Set(timeline.highlightedTrackIds(document, session.selection, sceneId));
  const markers = scene.markers as { id: string; time: number; color: number | string; note?: string; duration?: number }[];
  const dragging = new Set(feedback.draggingIds ?? []);
  const axis = timeline.previewAxisState({ enabled: runtime.prefs.previewAxis, touch: theme.touch, gestureActive: session.gestureActive, playing: transport.playing, engine: transport.engine === "ready" ? "ready" : transport.engine === "no-gpu" ? "no-gpu" : "stopped", hoverTime: hoverTime ?? undefined, playhead: transport.time });
  useEffect(() => { if (axis.hoverLineTime !== undefined) void runtime.engine?.seek(axis.hoverLineTime, "scrub"); else if (!runtime.transport.playing) void runtime.engine?.seek(controller.session.playhead, "exact"); }, [axis.hoverLineTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedGroups = new Set(timeline.elementsOfScene(scene).filter((element) => selectedIds.includes(element.id) && element.groupId).map((element) => element.groupId));
  const media = runtime.media.getState();
  const colourOf = (value: number | string): number => (typeof value === "number" ? value : 0);
  const range = scene.inPoint !== undefined || scene.outPoint !== undefined ? { start: scene.inPoint ?? 0, end: scene.outPoint ?? duration } : null;
  const flag = TIMELINE_FRAME.playheadFlag;

  return (
    <View testID="timeline" style={{ flex: 1, minHeight: 0, backgroundColor: theme.color("bg/app") }}>
      <TimelineToolbar />
      {runtime.tool.graph ? <GraphEditor /> : null}
      <View ref={body} testID="timeline-body" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Ruler: fixed vertically, following the horizontal scroll. */}
        <View ref={rulerNode} testID="timeline-ruler" accessibilityLabel={t("Ruler")} style={{ position: "absolute", left: HEADER, right: 0, top: 0, height: RULER, overflow: "hidden", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
          {range ? <View pointerEvents="none" style={{ position: "absolute", left: timeline.ticksToPixels(range.start, zoomLevel) - scrollLeft, top: 0 }}><RangeBar width={Math.max(2, timeline.ticksToPixels(range.end - range.start, zoomLevel))} height={RULER} /></View> : null}
          <RulerTicks ticks={ticks} scrollLeft={scrollLeft} />
          {markers.map((entry) => {
            const x = timeline.ticksToPixels(entry.time, zoomLevel) - scrollLeft;
            if (x < -20 || x > viewportWidth + 20) return null;
            return <MarkerFlag key={entry.id} x={x} color={colourOf(entry.color)} note={entry.note} onPress={(info) => run(pressMarker(env, { time: entry.time, y: 0, clientX: info.x, clientY: info.y, markerId: entry.id, onClick: () => setMarker({ id: entry.id, x: x + HEADER }) }), "ruler")} toPoint={(info) => ({ ...info, x: info.x + x - 5 })} />;
          })}
          {(props.comments ?? []).filter((comment) => comment.time_ticks !== undefined).map((comment) => {
            const x = timeline.ticksToPixels(comment.time_ticks!, zoomLevel) - scrollLeft;
            if (x < -16 || x > viewportWidth + 16) return null;
            return <Tap key={comment.commentId} testID="timeline-comment-marker" role="button" label={comment.body.split(/\r?\n/)[0] ?? t("Comments")} tooltip={{ label: comment.body.split(/\r?\n/)[0] ?? "" }} onPress={() => props.onCommentPress?.(comment)} style={{ position: "absolute", left: x - 6, top: 6, zIndex: 8, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: theme.color(comment.resolved ? "text/tertiary" : "accent"), backgroundColor: theme.color(comment.resolved ? "bg/app" : "accent"), opacity: comment.resolved ? 0.45 : 1 }} />;
          })}
        </View>
        {/* Header column: fixed horizontally, following the vertical scroll. */}
        <View ref={headerNode} testID="track-headers" style={{ position: "absolute", left: 0, top: RULER, bottom: 0, width: HEADER, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: -top, height: contentHeight }}>
            {rows.map((row) => <TrackHeaderRow key={row.trackId} row={row} track={timeline.trackById(scene, row.trackId)!} expanded={view.expandedKeyframeElementIds} highlighted={highlighted.has(row.trackId)} renaming={renaming?.trackId === row.trackId ? renaming.draft : null}
              onRename={renameTrack} onMenu={openTrackMenu} />)}
          </View>
        </View>
        {/* Tracks viewport. */}
        <View ref={tracksNode} testID="timeline-tracks" style={{ position: "absolute", left: HEADER, right: 0, top: RULER, bottom: 0, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: -scrollLeft, top: -top, width: contentWidth, height: Math.max(contentHeight, viewportHeight) }}>
            {rows.map((row) => {
              const track = timeline.trackById(scene, row.trackId)!;
              const shown = visibleElements(track.elements, viewport, TIMELINE_FRAME.overscan, dragging);
              const empty = row.zone === "main" && track.elements.length === 0;
              return (
                <View key={row.trackId} testID={`track-${row.zone}-${row.type}`} nativeID={`track-${row.trackId}`} role={track.elements.length ? "list" : "group"} aria-label={t(track.name)} style={{ position: "absolute", left: 0, right: 0, top: row.top, height: row.height }}>
                  <TrackLane height={row.height} alt={row.alt} locked={row.locked} style={highlighted.has(row.trackId) ? { backgroundColor: theme.color("accent/subtle") } : undefined} />
                  {empty ? <View pointerEvents="none" testID="main-placeholder" style={{ position: "absolute", left: scrollLeft + space[2], width: Math.max(0, viewportWidth - space[4]), top: 4, height: row.baseHeight - 8, borderRadius: radius.sm, borderWidth: 1, borderStyle: "dashed", borderColor: theme.color("border/strong"), alignItems: "center", justifyContent: "center" }}><Text variant="meta" color="text/secondary">{t("Drag media here to start")}</Text></View> : null}
                  {shown.map((element) => {
                    const x = timeline.ticksToPixels(element.startTime, zoomLevel), width = timeline.ticksToPixels(element.duration, zoomLevel);
                    return <TimelineClip key={element.id} runtime={runtime} document={document} element={element} row={row} zoomLevel={zoomLevel} visibleFrom={Math.max(0, scrollLeft - x - 200)} visibleTo={Math.min(width, scrollLeft + viewportWidth - x + 200)}
                      selected={selectedIds.includes(element.id)} dragging={dragging.has(element.id)} locked={row.locked} trimAdjusted={session.isTrimAdjusted(element.id)} groupSelected={selectedGroups.has(element.groupId)} thumbnails={media.thumbnails} frames={transport.engine === "ready" ? runtime.clipVersion + 1 : 0} />;
                  })}
                  {row.lanes > 0 ? <KeyframeLanes row={row} elements={track.elements.filter((element) => view.expandedKeyframeElementIds.includes(element.id))} zoomLevel={zoomLevel} /> : null}
                </View>
              );
            })}
            {markers.map((entry) => <View key={entry.id} pointerEvents="none" style={{ position: "absolute", left: timeline.ticksToPixels(entry.time, zoomLevel), top: 0, bottom: 0, width: 1, opacity: 0.6, backgroundColor: theme.color(MARKER_COLORS[((colourOf(entry.color) % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length]![0]) }} />)}
            {range ? <View pointerEvents="none" style={{ position: "absolute", left: timeline.ticksToPixels(range.start, zoomLevel), top: 0 }}><RangeBar width={Math.max(2, timeline.ticksToPixels(range.end - range.start, zoomLevel))} height={Math.max(contentHeight, viewportHeight)} /></View> : null}
            {feedback.snapTime !== undefined ? <View pointerEvents="none" style={{ position: "absolute", left: timeline.ticksToPixels(feedback.snapTime, zoomLevel), top: 0, zIndex: 5 }}><SnapLine height={Math.max(contentHeight, viewportHeight)} /></View> : null}
            {feedback.marquee ? <View pointerEvents="none" testID="marquee" style={{ position: "absolute", left: feedback.marquee.left, top: feedback.marquee.top, width: feedback.marquee.width, height: feedback.marquee.height, borderWidth: 1, borderColor: theme.color("timeline/selection"), backgroundColor: theme.color("accent/subtle"), opacity: 0.6, zIndex: 5 }} /> : null}
            {feedback.kind === "move" && feedback.drop?.kind === "new-track" ? <DropFeedback line={{ top: feedback.drop.y, width: contentWidth }} /> : null}
            <ContentTimelineLayer rows={rows} zoomLevel={zoomLevel} scrollLeft={scrollLeft} viewportWidth={viewportWidth} />
            <FxTimelineLayer rows={rows} zoomLevel={zoomLevel} scrollLeft={scrollLeft} scrollTop={top} viewportWidth={viewportWidth} />
            <DropFeedback ghost={drop?.ghost} line={drop?.line ? { top: drop.line.top, width: contentWidth } : null} />
            {feedback.tooltip ? <View pointerEvents="none" testID="trim-tooltip" style={{ position: "absolute", left: timeline.ticksToPixels(feedback.tooltip.time, zoomLevel) + 8, top: top + 4, zIndex: 6, paddingHorizontal: space[1.5], paddingVertical: space[0.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{feedback.tooltip.text}</Text></View> : null}
          </View>
          {axis.hoverLineTime !== undefined ? <View pointerEvents="none" testID="hover-line" style={{ position: "absolute", left: timeline.ticksToPixels(axis.hoverLineTime, zoomLevel) - scrollLeft, top: 0, bottom: 0, width: 1, backgroundColor: theme.color("timeline/playhead"), opacity: 0.35 }} /> : null}
        </View>
        {/* Playhead: over the ruler and the tracks. */}
        <Playhead zoomLevel={zoomLevel} scrollLeft={scrollLeft} viewportWidth={viewportWidth} duration={duration} fps={fps} />
        <View style={{ position: "absolute", left: 0, top: 0, width: HEADER, height: RULER, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), borderRightWidth: 1, borderRightColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }} />
        {maxScrollLeft > 0 ? <Scrollbar length={viewportWidth} content={contentWidth} offset={scrollLeft} onScroll={(left) => { manualScroll.current = now(); controller.setView({ scrollLeft: Math.min(maxScrollLeft, Math.max(0, left)) }); }} /> : null}
        <Menu open={menu !== null} anchor={menu ? { x: menu.at.x, y: menu.at.y, width: 1, height: 1 } : { x: 0, y: 0, width: 1, height: 1 }} items={menu?.items ?? []} label={menu?.label} onClose={() => setMenu(null)} />
      </View>
      {marker ? <MarkerPopover markerId={marker.id} onClose={() => setMarker(null)} /> : null}
      {runtime.dialog?.kind === "scenes" ? <ScenesSheet onClose={() => runtime.setDialog(null)} /> : null}
      {runtime.dialog?.kind === "rename-element" ? <RenameElementDialog elementId={runtime.dialog.elementId} onClose={() => runtime.setDialog(null)} /> : null}
      {runtime.dialog?.kind === "replace-media" ? <ReplaceMediaDialog elementId={runtime.dialog.elementId} onClose={() => runtime.setDialog(null)} /> : null}
      {runtime.dialog?.kind === "delete-track" ? <ConfirmDialog open title={t("Delete track")} description={runtime.dialog.text} confirmLabel={t("Delete")} onClose={() => runtime.setDialog(null)} onConfirm={() => { const id = (runtime.dialog as { trackId: string }).trackId; runtime.setDialog(null); controller.run(timeline.deleteTrack({ trackId: id })); }} /> : null}
    </View>
  );
});

/**
 * The playhead line. Where it stands is written on its node from the transport itself, on every tick of the clock: the
 * line moves while it plays without React rendering anything (it rendered the whole timeline on every frame before).
 * React draws it for the view (zoom, scroll, size) and whenever the clock is not running.
 */
const Playhead = memo(function Playhead(props: { zoomLevel: number; scrollLeft: number; viewportWidth: number; duration: number; fps: Rational }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const time = useSettledTransport().time, node = useRef<View>(null), flag = TIMELINE_FRAME.playheadFlag;
  const view = useRef(props);
  view.current = props;
  const place = useCallback(() => {
    const state = view.current, at = runtime.transport.time, x = timeline.ticksToPixels(at, state.zoomLevel) - state.scrollLeft;
    placePlayhead(node.current, { left: HEADER + x, shown: x >= -flag.width && x <= state.viewportWidth + flag.width, now: at, max: Math.max(state.duration, at), text: `${formatTimecode(at, "HH:MM:SS:FF", state.fps)} / ${formatTimecode(state.duration, "HH:MM:SS:FF", state.fps)}` });
  }, [runtime, flag.width]);
  useEffect(() => runtime.subscribeTransport(place), [runtime, place]);
  // After every render too: React writes what it rendered, which is older than the clock while it plays.
  useLayoutEffect(place);
  const x = timeline.ticksToPixels(time, props.zoomLevel) - props.scrollLeft;
  return (
    <View ref={node} pointerEvents="none" testID="playhead" role="slider" accessibilityLabel={t("Playhead")} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.max(props.duration, time)} aria-valuenow={time}
      aria-valuetext={`${formatTimecode(time, "HH:MM:SS:FF", props.fps)} / ${formatTimecode(props.duration, "HH:MM:SS:FF", props.fps)}`} style={{ position: "absolute", left: HEADER + x, top: 0, bottom: 0, width: 1, backgroundColor: theme.color("timeline/playhead"), zIndex: 6, display: x >= -flag.width && x <= props.viewportWidth + flag.width ? "flex" : "none" }}>
      <View style={{ position: "absolute", left: -(flag.width - 1) / 2, top: 0 }}><Svg width={flag.width} height={flag.height}><Polygon points={`0,0 ${flag.width},0 ${flag.width},${flag.height * 0.6} ${flag.width / 2},${flag.height} 0,${flag.height * 0.6}`} fill={theme.color("timeline/playhead")} /></Svg></View>
    </View>
  );
});

/** The marks and labels of the ruler: drawn again when the zoom or the scroll changes them, not for a selection or a hover. */
const RulerTicks = memo(function RulerTicks(props: { ticks: ReturnType<typeof timeline.rulerTicks>; scrollLeft: number }) {
  const theme = useTheme();
  return (
    <>
      {props.ticks.map((tick) => (
        <View key={tick.timeSeconds} pointerEvents="none" style={{ position: "absolute", left: tick.x - props.scrollLeft, top: 0, bottom: 0, width: 72 }}>
          <View style={{ position: "absolute", bottom: 0, width: 1, height: tick.label ? 8 : 4, backgroundColor: theme.color("border/strong") }} />
          {tick.label ? <Text variant="caption" color="timeline/ruler-text" tabular numberOfLines={1} style={{ position: "absolute", top: 2, left: 4, fontWeight: "500" }}>{tick.label}</Text> : null}
        </View>
      ))}
    </>
  );
});

type FlagSession = { move?(info: PointerInfo): void; up?(info: PointerInfo): void; cancel?(): void } | null;
function MarkerFlag(props: { x: number; color: number; note?: string; onPress(info: PointerInfo): FlagSession; toPoint(info: PointerInfo): PointerInfo }) {
  const node = useRef<View>(null), handlers = useRef(props);
  handlers.current = props;
  // The flag's own pointer coordinates are translated into the ruler's, so its drag reads the same times as a scrub.
  useEffect(() => bindPointer(node.current, {
    down(info) {
      const session = handlers.current.onPress(handlers.current.toPoint(info));
      return session ? { move: (next) => session.move?.(handlers.current.toPoint(next)), up: (next) => session.up?.(handlers.current.toPoint(next)), cancel: () => session.cancel?.() } : null;
    },
  }), []);
  return <View ref={node} {...dragHandle("ew-resize")} testID="tl-ctl-marker" style={{ position: "absolute", left: props.x - 5, top: RULER - 10, zIndex: 2 }}><Marker color={props.color} flag={{ width: TIMELINE_FRAME.markerFlag, height: TIMELINE_FRAME.markerFlag }} lineHeight={0} name={props.note} /></View>;
}

/**
 * One row of the header column. It is given its own track and nothing wider, so it renders when that track changes — not
 * for a selection, a scroll or an edit elsewhere. And when it does render — its track gained a clip, or the selection
 * moved onto it — only the row's own box is drawn: its name and buttons (`TrackHeaderBody`) are drawn again when one
 * of THEM changes (a split drew every button of the track's header again; a click on a clip those of two tracks).
 */
const TrackHeaderRow = memo(function TrackHeaderRow(input: { row: TimelineRow; track: timeline.Tr; expanded: readonly string[]; highlighted: boolean; renaming: string | null; onRename(trackId: string, draft: string | null): void; onMenu(trackId: string, at: { x: number; y: number }): void }) {
  const t = useT();
  const theme = useTheme();
  const [sound, setSound] = useState(false);
  const soundRef = useRef<View>(null);
  const openSound = useCallback(() => setSound(true), []);
  const { row, track } = input;
  const expanded = row.lanes > 0 ? track.elements.filter((element) => input.expanded.includes(element.id)) : [];
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: row.top, height: row.height }}>
      <Tap role="none" onContextMenu={(at: { x: number; y: number }) => input.onMenu(row.trackId, at)} focusable={false}
        style={{ height: row.baseHeight, justifyContent: "center", paddingStart: space[2], paddingEnd: 2, borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), backgroundColor: input.highlighted ? theme.color("accent/subtle") : "transparent" }}>
        <TrackHeaderBody zone={row.zone} trackId={row.trackId} baseHeight={row.baseHeight} track={track} renaming={input.renaming} sound={sound} soundRef={soundRef} onSound={openSound} onRename={input.onRename} />
      </Tap>
      {expanded.length > 0 ? <LaneHeaders elements={expanded} /> : null}
      <Popover open={sound} anchor={soundRef} side="end" label={t("Track volume and pan")} width={280} onClose={() => setSound(false)}><TrackSoundPanel trackId={track.id} /></Popover>
    </View>
  );
}, (before, after) => sameRow(before.row, after.row) && before.track === after.track && sameShallow(before.expanded, after.expanded) && before.highlighted === after.highlighted && before.renaming === after.renaming && before.onRename === after.onRename && before.onMenu === after.onMenu);
/** What the header shows of its track: its name, its kind and its switches — not its clips. */
const sameHeaderTrack = (a: timeline.Tr, b: timeline.Tr): boolean => a === b || (a.id === b.id && a.name === b.name && a.type === b.type && a.muted === b.muted && a.solo === b.solo && a.hidden === b.hidden && a.locked === b.locked);
/** The name and the buttons of a track's header. */
const TrackHeaderBody = memo(function TrackHeaderBody(input: { zone: TimelineRow["zone"]; trackId: string; baseHeight: number; track: timeline.Tr; renaming: string | null; sound: boolean; soundRef: RefObject<View | null>; onSound(): void; onRename(trackId: string, draft: string | null): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { track } = input, row = { zone: input.zone, baseHeight: input.baseHeight };
  const props = { ...input, onRename: (draft: string | null) => input.onRename(input.trackId, draft) };
  const commit = () => { const name = props.renaming === null ? null : timeline.committedName(props.renaming); props.onRename(null); if (name && name !== track.name) runtime.controller.run(timeline.renameTrack({ trackId: track.id, name })); };
  const audible = timeline.trackSupports(track, "muted");
  const name = props.renaming !== null ? (
    <TextInput autoFocus selectTextOnFocus accessibilityLabel={t("Rename track")} aria-label={t("Rename track")} value={props.renaming} maxLength={64} onChangeText={(text) => props.onRename(text)} onBlur={commit}
      {...({ onKeyPress: (event: { nativeEvent: { key: string }; preventDefault(): void }) => { if (event.nativeEvent.key === "Enter") { event.preventDefault(); commit(); } if (event.nativeEvent.key === "Escape") { event.preventDefault(); props.onRename(null); } } } as object)}
      style={[theme.type("meta"), { flex: 1, minWidth: 0, padding: 0, color: theme.color("text/primary"), outlineWidth: 0 }]} />
  ) : (
    <Tap role="button" label={t("Track {name}", { name: t(track.name) })} tooltip={{ label: t(track.name) }} onPress={() => {}} onDoublePress={() => props.onRename(track.name)} onKeyDown={(key) => { if (key.key === "F2" || key.key === "Enter") props.onRename(track.name); }} style={{ flex: 1, minWidth: 0, borderRadius: radius.xs }}>
      <Text variant="meta" color="text/secondary" numberOfLines={1} testID={`track-name-${row.zone}`}>{t(track.name)}</Text>
    </Tap>
  );
  const buttons = (
    <>
      {audible ? <HeaderToggle icon={track.muted === true ? "mute" : "vol"} label={t(track.muted === true ? "Unmute" : "Mute")} on={track.muted === true} onPress={() => runtime.act("timeline.track.mute.toggle", { trackId: track.id })} /> : null}
      {timeline.trackSupports(track, "solo") ? <View style={{ width: 20, height: 24, alignItems: "center", justifyContent: "center" }}><Tap role="button" label={t(track.solo === true ? "Unsolo" : "Solo")} tooltip={{ label: t(track.solo === true ? "Unsolo" : "Solo") }} pressedState={track.solo === true} testID={`track-solo-${row.zone}`} onPress={() => runtime.act("timeline.track.solo.toggle", { trackId: track.id })}
        style={(state) => ({ width: 20, height: 20, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", backgroundColor: track.solo === true ? theme.color("accent/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}><Text variant="caption" color={track.solo === true ? "accent" : "text/secondary"} style={{ fontWeight: "600" }}>S</Text></Tap></View> : null}
      {timeline.trackSupports(track, "hidden") ? <HeaderToggle icon={track.hidden === true ? "eye-off" : "eye"} label={t(track.hidden === true ? "Show" : "Hide")} on={track.hidden === true} onPress={() => runtime.act("timeline.track.hide.toggle", { trackId: track.id })} /> : null}
      <HeaderToggle icon="lock" label={t(track.locked ? "Unlock" : "Lock")} on={track.locked} onPress={() => runtime.act("timeline.track-lock.toggle", { trackId: track.id })} />
      {timeline.trackSupports(track, "volume") ? <View style={{ width: 20, height: 24, alignItems: "center", justifyContent: "center" }}><IconButton ref={props.soundRef} icon="sliders" size="xs" label={t("Track volume and pan")} expanded={props.sound} testID={`track-sound-${row.zone}`} onPress={props.onSound} /></View> : null}
    </>
  );
  // Rows with sound are two lines: the name (and Cover on the main track) over the controls; bar rows keep one line.
  const stacked = audible && row.baseHeight >= 40;
  return stacked ? (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", height: 18, gap: space[1] }}>
        {name}
        {row.zone === "main" ? <Tap role="button" label={t("Cover")} tooltip={{ label: t("Edit cover") }} testID="track-cover" onPress={() => runtime.setDialog({ kind: "cover" })}
          style={(state) => ({ width: 40, height: 16, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color("border/control"), backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}><Text variant="caption" color="text/secondary">{t("Cover")}</Text></Tap> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", height: 20 }}>{buttons}</View>
    </>
  ) : <View style={{ flexDirection: "row", alignItems: "center" }}>{name}{buttons}</View>;
}, (before, after) => before.zone === after.zone && before.trackId === after.trackId && before.baseHeight === after.baseHeight && sameHeaderTrack(before.track, after.track) && before.renaming === after.renaming && before.sound === after.sound && before.soundRef === after.soundRef && before.onSound === after.onSound && before.onRename === after.onRename);
/** Volume and pan of one track. It reads the project itself, like everything drawn in a popover. */
export function TrackSoundPanel(props: { trackId: string }) {
  const t = useT();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, track = timeline.trackById(timeline.sceneById(controller.document, controller.session.sceneId), props.trackId);
  if (!track) return null;
  const sound = trackSound(track);
  // A drag is drawn through the preview layer and recorded once, on release.
  const set = (change: { volume?: number; pan?: number }, live: boolean) => { if (live) controller.preview(setTrackSound({ trackId: track.id, ...change })); else { controller.discardPreview(); controller.run(setTrackSound({ trackId: track.id, ...change })); } };
  return (
    <View testID="track-sound-panel" style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="meta" color="text/secondary" style={{ width: 52 }}>{t("Volume")}</Text>
        <View style={{ flex: 1 }}><Slider label={t("Track volume")} min={TRACK_VOLUME.min} max={TRACK_VOLUME.max} step={TRACK_VOLUME.step} value={sound.volume} defaultValue={0} onChange={(value) => set({ volume: value as number }, true)} onCommit={(value) => set({ volume: value as number }, false)} /></View>
        <Text variant="meta" tabular testID="track-volume-value" style={{ width: 56, textAlign: "right" }}>{`${sound.volume.toFixed(1)} dB`}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="meta" color="text/secondary" style={{ width: 52 }}>{t("Pan")}</Text>
        <View style={{ flex: 1 }}><Slider label={t("Track pan")} min={TRACK_PAN.min} max={TRACK_PAN.max} step={TRACK_PAN.step} value={sound.pan} defaultValue={0} centre onChange={(value) => set({ pan: value as number }, true)} onCommit={(value) => set({ pan: value as number }, false)} /></View>
        <Text variant="meta" tabular testID="track-pan-value" style={{ width: 56, textAlign: "right" }}>{panLabel(sound.pan)}</Text>
      </View>
    </View>
  );
}
function HeaderToggle(props: { icon: "vol" | "mute" | "eye" | "eye-off" | "lock"; label: string; on: boolean; onPress(): void }) {
  return <View style={{ width: 20, height: 24, alignItems: "center", justifyContent: "center" }}><IconButton icon={props.icon} size="xs" label={props.label} on={props.on} toggle onPress={props.onPress} /></View>;
}

/** The horizontal scrollbar of the tracks: 12 px, a thumb that drags. */
function Scrollbar(props: { length: number; content: number; offset: number; onScroll(offset: number): void }) {
  const theme = useTheme();
  const node = useRef<View>(null), state = useRef(props);
  state.current = props;
  const thumb = Math.max(24, (props.length * props.length) / props.content), travel = props.length - thumb, ratio = travel > 0 ? (props.content - props.length) / travel : 0;
  useEffect(() => bindPointer(node.current, {
    down(info) {
      const current = state.current, size = Math.max(24, (current.length * current.length) / current.content), scale = current.length - size > 0 ? (current.content - current.length) / (current.length - size) : 0;
      const at = scale > 0 ? current.offset / scale : 0, grab = info.x >= at && info.x <= at + size ? info.x - at : size / 2;
      if (grab === size / 2) current.onScroll((info.x - grab) * scale);
      return { move: (next) => state.current.onScroll((next.x - grab) * scale) };
    },
  }), []);
  return (
    <View ref={node} testID="timeline-scrollbar" style={{ position: "absolute", left: HEADER, right: 0, bottom: 0, height: 12, zIndex: 7 }}>
      <View style={{ position: "absolute", left: ratio > 0 ? props.offset / ratio : 0, top: 3, width: thumb, height: 6, borderRadius: 3, backgroundColor: theme.color("border/strong") }} />
    </View>
  );
}
export const TICKS = TICKS_PER_SECOND;
