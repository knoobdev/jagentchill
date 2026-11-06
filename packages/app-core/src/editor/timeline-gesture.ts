import { snapToFrame, timeline } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import type { EditorController } from "./controller.ts";
import { marqueeOf, rowAtY, trimTooltip, type ClipZone, type TimelineRow } from "./timeline-view.ts";

/** What a gesture reads from the screen while it runs. */
export type GestureEnv = { controller: EditorController; prefs(): timeline.TimelinePreferences; rows(): TimelineRow[]; zoomLevel(): number; platform: "desktop" | "web" | "mobile" };
/** A pointer sample in timeline terms: the time under it, its content y (from the top of the rows) and its client x for travel. */
export type GesturePoint = { time: number; y: number; clientX: number; clientY: number; shift?: boolean };
/** What the timeline draws for a running gesture. */
export type GestureFeedback = {
  kind: "idle" | "move" | "trim" | "scrub" | "marquee" | "marker";
  /** The snap line, at this time. */
  snapTime?: number;
  /** The duration tooltip of a trim, anchored at this time. */
  tooltip?: { text: string; time: number };
  /** Where a moved clip would land: on a track (the ghost) or on a new track at a row boundary (the line). */
  drop?: { kind: "track"; trackId: string } | { kind: "new-track"; y: number };
  /** The rubber band, in content px. */
  marquee?: { left: number; top: number; width: number; height: number };
  /** The engine refused the candidate: the pointer shows "not allowed" and nothing is previewed. */
  blocked?: boolean;
  draggingIds?: string[];
};
export type Gesture = { move(point: GesturePoint): void; end(point?: GesturePoint): void; cancel(): void; readonly feedback: GestureFeedback };
const IDLE: Gesture = { move() {}, end() {}, cancel() {}, feedback: { kind: "idle" } };
const travel = (a: GesturePoint, b: GesturePoint): number => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
const fpsOf = (env: GestureEnv): Rational => env.controller.stored.settings.fps as Rational;
const durationOf = (env: GestureEnv): number => timeline.sceneDurationOf(timeline.sceneById(env.controller.stored, env.controller.session.sceneId));

/**
 * A press on a clip. In Select mode: a click selects (the toggle modifier adds or removes), a drag of the body moves
 * the selection with snapping and a drop preview, a drag of an edge trims. In Split mode a press cuts. In the
 * select-left / select-right modes a press selects everything on that side.
 */
export function pressClip(env: GestureEnv, press: GesturePoint & { elementId: string; zone: ClipZone; toggle?: boolean; alt?: boolean; secondary?: boolean }): Gesture {
  const { controller } = env, session = controller.session, doc = controller.stored, sceneId = session.sceneId;
  const mode = session.cursorMode;
  if (mode === "blade" && !press.secondary) {
    const hit = timeline.bladeClick(doc, { time: press.time, elementId: press.elementId, shift: press.shift, sceneId });
    if (hit.kind === "split") controller.run(hit.command); else controller.seek(hit.time);
    return IDLE;
  }
  if ((mode === "select-left" || mode === "select-right") && !press.secondary) {
    controller.select(mode === "select-left" ? timeline.selectLeftward(doc, press.time, sceneId) : timeline.selectRightward(doc, press.time, sceneId));
    return IDLE;
  }
  if (!timeline.pressOnClip(doc, press.elementId, sceneId).allowed) return IDLE;
  const wasSelected = session.selection.selectedElements.includes(press.elementId);
  // A press on an unselected clip selects it at once, so a drag that follows moves what the user sees selected.
  if (!wasSelected || press.secondary) controller.select(timeline.clickElement(doc, session.selection, press.elementId, { toggle: press.toggle && !press.secondary, single: press.alt, secondary: press.secondary }, sceneId));
  if (press.secondary) return IDLE;
  const located = timeline.locate(doc, press.elementId);
  if (!located) return IDLE;
  const anchor = located.element, grab = press.time - anchor.startTime;
  let started = false, feedback: GestureFeedback = { kind: "idle" }, lastY = press.y;

  const trimSide: timeline.TrimSide | null = press.zone === "trim-start" ? "start" : press.zone === "trim-end" ? "end" : null;
  function trimTo(point: GesturePoint): void {
    const edge = trimSide === "start" ? anchor.startTime : timeline.endOf(anchor), wanted = edge + (point.time - press.time);
    const snap = timeline.snapGesture(doc, "element-trim", [wanted], { zoomLevel: env.zoomLevel(), platform: env.platform, enabled: env.prefs().snapping, shift: point.shift, sceneId, playhead: session.playhead, excludeElementIds: [anchor.id] });
    const target = snap.snapped ? snap.time : snapToFrame(Math.max(0, wanted), fpsOf(env));
    const result = controller.preview(timeline.trim({ sceneId, elementId: anchor.id, side: trimSide!, delta: target - edge, selectedIds: session.selection.selectedElements }));
    const shown = timeline.locate(controller.document, anchor.id)?.element ?? anchor;
    const applied = result.ok ? result.info?.delta ?? 0 : 0, landed = edge + applied;
    feedback = {
      kind: "trim", blocked: !result.ok, draggingIds: [anchor.id],
      ...(snap.snapped && landed === snap.time ? { snapTime: snap.time } : {}),
      tooltip: { text: trimTooltip(shown.duration, shown.duration - anchor.duration), time: landed },
    };
  }
  function moveTo(point: GesturePoint): void {
    const moving = session.selection.selectedElements, rows = env.rows();
    const wanted = timeline.dragTargetTime(doc, point.time, grab);
    const snap = timeline.snapGesture(doc, "element-move", [wanted, wanted + anchor.duration], { zoomLevel: env.zoomLevel(), platform: env.platform, enabled: env.prefs().snapping, shift: point.shift, sceneId, playhead: session.playhead, excludeElementIds: moving });
    const time = Math.max(0, wanted + (snap.snapped ? snap.delta : 0));
    const hit = rowAtY(rows, point.y), direction = point.y < lastY ? "up" : "down";
    lastY = point.y;
    const zone = timeline.TRACK_FOR_ELEMENT[anchor.type] === "audio" ? "audio" : "overlay";
    const zoneRows = rows.filter((row) => row.zone === zone);
    let target: timeline.MoveTarget, drop: GestureFeedback["drop"];
    if (hit.row && hit.row.trackId === located!.track.id) { target = { kind: "same" }; drop = { kind: "track", trackId: hit.row.trackId }; }
    else if (hit.row && timeline.canHold({ type: hit.row.type }, anchor.type) && !hit.row.locked) { target = { kind: "track", trackId: hit.row.trackId }; drop = { kind: "track", trackId: hit.row.trackId }; }
    else {
      // Over a row that cannot take the clip, or outside the rows: a new track at the nearest boundary of the clip's zone.
      const above = hit.outside === "above" || (hit.row !== undefined && (hit.half === "upper" || direction === "up") && hit.outside !== "below");
      const reference = hit.row ?? (hit.outside === "above" ? rows[0] : rows[rows.length - 1]);
      const within = zoneRows.findIndex((row) => row.trackId === reference?.trackId);
      const index = within >= 0 ? within + (above ? 0 : 1) : zone === "overlay" ? (reference && reference.zone === "audio" ? zoneRows.length : above ? 0 : zoneRows.length) : above ? 0 : zoneRows.length;
      target = { kind: "new-tracks", index };
      drop = { kind: "new-track", y: reference ? (above ? reference.top : reference.top + reference.height) : 0 };
    }
    let result = controller.preview(timeline.move({ sceneId, elementIds: moving, anchorId: anchor.id, time, target, pointerTime: point.time }));
    // A vertical target the engine refuses still lets the clip follow the pointer along its own track.
    if (!result.ok && target.kind !== "same") { result = controller.preview(timeline.move({ sceneId, elementIds: moving, anchorId: anchor.id, time, target: { kind: "same" }, pointerTime: point.time })); drop = { kind: "track", trackId: located!.track.id }; }
    const shown = timeline.locate(controller.document, anchor.id)?.element ?? anchor;
    feedback = { kind: "move", blocked: !result.ok, drop, draggingIds: moving, ...(snap.snapped && (shown.startTime === snap.time || timeline.endOf(shown) === snap.time) ? { snapTime: snap.time } : {}) };
  }
  return {
    get feedback() { return feedback; },
    move(point) {
      if (!started) {
        if (!timeline.dragStarted(travel(press, point))) return;
        started = true;
        // A drag that begins on a selected clip of a multi-selection moves the whole set; on any other it moves that clip.
        if (trimSide && session.selection.selectedElements.length === 0) controller.select(timeline.selectElements([anchor.id]));
        session.beginGesture();
      }
      if (trimSide) trimTo(point); else moveTo(point);
    },
    end() {
      if (started) { controller.commitPreview(); feedback = { kind: "idle" }; return; }
      // A click on a clip that was already selected: the toggle modifier removes it, a plain click leaves it the only one.
      if (wasSelected) controller.select(timeline.clickElement(doc, session.selection, press.elementId, { toggle: press.toggle, single: press.alt }, sceneId));
    },
    cancel() { if (started) controller.discardPreview(); feedback = { kind: "idle" }; },
  };
}

/** A press on the ruler, the marker row or the playhead handle: it seeks there at once, without snapping; moving scrubs with snapping. */
export function pressRuler(env: GestureEnv, press: GesturePoint): Gesture {
  const { controller } = env, fps = fpsOf(env);
  controller.seek(timeline.seekTime(press.time, durationOf(env), fps));
  let feedback: GestureFeedback = { kind: "scrub" };
  return {
    get feedback() { return feedback; },
    move(point) {
      const doc = controller.stored;
      const snap = timeline.snapGesture(doc, "playhead-scrub", [point.time], { zoomLevel: env.zoomLevel(), platform: env.platform, enabled: env.prefs().snapping, shift: point.shift, sceneId: controller.session.sceneId });
      controller.seek(timeline.seekTime(snap.snapped ? snap.time : point.time, durationOf(env), fps));
      feedback = { kind: "scrub", ...(snap.snapped ? { snapTime: snap.time } : {}) };
    },
    end() { feedback = { kind: "idle" }; },
    cancel() { feedback = { kind: "idle" }; },
  };
}

/**
 * A press on empty track area: a short press without travel is a click (it deselects and seeks), travel past the
 * threshold draws the rubber band and selects what it touches — added to the selection with the toggle modifier.
 */
export function pressEmpty(env: GestureEnv, press: GesturePoint & { contentX: number; additive?: boolean; now_ms: number; area?: "tracks" | "gutter" }): Gesture {
  const { controller } = env, session = controller.session, base = session.selection, doc = controller.stored, sceneId = session.sceneId;
  if (session.cursorMode === "blade") { const hit = timeline.bladeClick(doc, { time: press.time, sceneId }); if (hit.kind === "seek") controller.seek(hit.time); return IDLE; }
  let feedback: GestureFeedback = { kind: "idle" }, dragging = false;
  return {
    get feedback() { return feedback; },
    move(point) {
      if (!dragging && timeline.emptyAreaGesture(travel(press, point), 0) !== "marquee") return;
      dragging = true;
      const zoom = env.zoomLevel(), a = { x: press.contentX, y: press.y }, b = { x: timeline.ticksToPixels(point.time, zoom), y: point.y };
      controller.select(timeline.boxSelect(doc, base, marqueeOf(a, b, zoom), env.rows().map((row) => ({ trackId: row.trackId, top: row.top, height: row.height })), press.additive === true, sceneId));
      feedback = { kind: "marquee", marquee: { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } };
    },
    end(point) {
      feedback = { kind: "idle" };
      if (dragging) return;
      const elapsed = (point as (GesturePoint & { now_ms?: number }) | undefined)?.now_ms;
      if (timeline.emptyAreaGesture(point ? travel(press, point) : 0, elapsed === undefined ? 0 : elapsed - press.now_ms) !== "click") return;
      const outcome = timeline.clickEmptyArea(session.selection, press.area ?? "tracks", press.time);
      controller.select(outcome.selection);
      if (outcome.seekTo !== undefined) controller.seek(timeline.seekTime(outcome.seekTo, durationOf(env), fpsOf(env)));
    },
    cancel() { if (dragging) controller.select(base); feedback = { kind: "idle" }; },
  };
}

/** A press on a marker flag: a drag moves the marker with snapping as one step; a press without travel reports a click (the popover opens). */
export function pressMarker(env: GestureEnv, press: GesturePoint & { markerId: string; onClick(): void }): Gesture {
  const { controller } = env, sceneId = controller.session.sceneId;
  let started = false, feedback: GestureFeedback = { kind: "idle" };
  return {
    get feedback() { return feedback; },
    move(point) {
      if (!started && !timeline.dragStarted(travel(press, point))) return;
      started = true;
      const snap = timeline.snapGesture(controller.stored, "marker-drag", [point.time], { zoomLevel: env.zoomLevel(), platform: env.platform, enabled: env.prefs().snapping, shift: point.shift, sceneId, playhead: controller.session.playhead, excludeMarkerId: press.markerId });
      const result = controller.preview(timeline.moveMarker({ sceneId, markerId: press.markerId, time: snap.snapped ? snap.time : point.time }));
      feedback = { kind: "marker", blocked: !result.ok, ...(snap.snapped ? { snapTime: snap.time } : {}) };
    },
    end() { if (started) controller.commitPreview(); else press.onClick(); feedback = { kind: "idle" }; },
    cancel() { if (started) controller.discardPreview(); feedback = { kind: "idle" }; },
  };
}

/**
 * A library item dragged over the tracks: the ghost follows the engine's own placement decision, and the release
 * inserts through the same placement as one step.
 */
export function dragLibraryItems(env: GestureEnv, items: timeline.LibraryItem[]) {
  const { controller } = env;
  let lastY = 0;
  const targetAt = (point: { y: number }): timeline.DropTarget => {
    const hit = rowAtY(env.rows(), point.y), direction = point.y < lastY ? "up" : "down";
    lastY = point.y;
    return hit.row ? { hoveredTrackId: hit.row.trackId, half: hit.half, dragDirection: direction } : { outside: hit.outside };
  };
  // The length the first item takes on the timeline, asked of the engine once per drag.
  let probed: { type: string; duration: number } | null | undefined;
  const probe = () => {
    if (probed !== undefined) return probed;
    const doc = controller.stored, sceneId = controller.session.sceneId;
    try {
      const type = timeline.elementTypeOfItem(doc, items[0]);
      const built = timeline.executeCommand(doc, controller.context(), controller.edit(), timeline.addToTimeline({ sceneId, items: [items[0]], time: 0, request: { strategy: "alwaysNew" } }));
      const made = built.info ? timeline.locate(built.commit.document, built.info.elementIds[0])?.element : undefined;
      probed = { type, duration: made?.duration ?? timeline.FACTORY_INSERT_DEFAULTS.imageDuration };
    } catch { probed = null; }
    return probed;
  };
  return {
    /** The ghost of the first item at the pointer. */
    over(point: { time: number; y: number }): { start: number; duration: number; type: string; decision: ReturnType<typeof timeline.previewDrop> } | null {
      const item = probe(), doc = controller.stored;
      if (!item) return null;
      const start = timeline.dragTargetTime(doc, point.time, 0);
      try { return { start, duration: item.duration, type: item.type, decision: timeline.previewDrop(doc, controller.session.sceneId, item.type, start, item.duration, targetAt(point), controller.edit()) }; } catch { return null; }
    },
    drop(point: { time: number; y: number }): boolean {
      const doc = controller.stored;
      return controller.run(timeline.dropLibraryItem({ sceneId: controller.session.sceneId, items, time: timeline.dragTargetTime(doc, point.time, 0), target: targetAt(point) })).ok;
    },
  };
}
