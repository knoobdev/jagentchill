import { copyKeys, extractAudio, neighbourKeyTime, pasteKeys, removeKeys, setElementFields, timeline, toggleFlip, type Commit, type CommitContext, type KeyframeClipboard, type KeyRef } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import type { EditorController } from "./controller.ts";
import { resetTransforms, rotateQuarterTurn } from "./preview-commit.ts";
import { FREEZE_DEFAULT_TICKS, freezeFrameAt, freezeTarget } from "./freeze.ts";

/** What an action needs from the screen besides the controller: the device preferences and the tracks viewport. */
export type ActionHost = {
  controller: EditorController;
  prefs(): timeline.TimelinePreferences; setPrefs(next: timeline.TimelinePreferences): void;
  /** Width of the tracks viewport in px, for zoom. */
  viewportWidth(): number;
  /** UI the timeline cannot do on its own: dialogs, sheets and panels owned by the screen. */
  open?(what: "scenes" | "replace-media" | "crop" | "rename-element" | "marker-edit" | "keyframe-graph", payload?: unknown): void;
  /** A toast: the English sentence and the values of its placeholders. */
  message?(text: string, values?: Record<string, string | number>): void;
  /** The "Default freeze-frame duration" preference, in ticks. */
  freezeDuration?(): number;
  /** Pauses the transport (Stop, and edits that must not run under playback). */
  pause?(): void;
};
type El = timeline.El;
const elementsOf = (doc: ProjectDocument, sceneId: string, ids: readonly string[]): { element: El; track: timeline.Tr }[] =>
  timeline.tracksOfScene(timeline.sceneById(doc, sceneId)).flatMap((track) => track.elements.filter((element) => ids.includes(element.id)).map((element) => ({ element, track })));
/** Several commits of another family as one step: each is applied to the result of the one before. */
function chain(doc: ProjectDocument, ctx: CommitContext, label: string, steps: ((doc: ProjectDocument, ctx: CommitContext) => Commit)[]): Commit | null {
  if (steps.length === 0) return null;
  let current = doc, last: Commit | null = null;
  const patch: Commit["patch"] = [];
  for (const step of steps) { last = step(current, ctx); current = last.document; patch.push(...last.patch); }
  return { ...last!, document: current, patch, label };
}
const SEEKS: Record<string, timeline.SeekAction> = {
  "playback.frame-previous": "step-back", "playback.frame-next": "step-forward", "playback.frames-back-10": "step-back-10", "playback.frames-forward-10": "step-forward-10",
  "playback.jump-back": "jump-back-5s", "playback.jump-forward": "jump-forward-5s", "playback.seek-back-1s": "seek-back-1s", "playback.seek-forward-1s": "seek-forward-1s",
  "playback.cut-previous": "previous-cut", "playback.cut-next": "next-cut", "playback.go-start": "go-to-start", "playback.go-end": "go-to-end", "playback.stop": "stop",
};
/** The seek actions: handled by the transport owner so they also work while playing. */
export const seekActionOf = (actionId: string): timeline.SeekAction | undefined => SEEKS[actionId];

/** The tracks-viewport zoom after a zoom action, anchored on the playhead. */
export function zoomAction(host: ActionHost, kind: "in" | "out" | "fit" | { slider: number } | { level: number; anchor?: timeline.ZoomAnchor }): void {
  const { controller } = host, session = controller.session, doc = session.document, width = host.viewportWidth();
  const duration = timeline.sceneDurationOf(timeline.sceneById(doc, session.sceneId)), min = timeline.zoomMin(duration, width), view = session.view;
  if (kind === "fit") { controller.setView(timeline.zoomToFit(duration, width)); return; }
  const next = kind === "in" ? timeline.zoomIn(view.zoomLevel, min) : kind === "out" ? timeline.zoomOut(view.zoomLevel, min)
    : "slider" in kind ? timeline.sliderToZoom(timeline.snapSliderPosition(kind.slider), min) : timeline.clampZoom(kind.level, min);
  const anchor = typeof kind === "object" && "level" in kind && kind.anchor ? kind.anchor : { kind: "playhead" as const, playheadTime: session.playhead };
  const scrolled = timeline.zoomScroll({ zoomLevel: view.zoomLevel, scrollLeft: view.scrollLeft }, next, anchor, min, { viewportWidth: width });
  controller.setView({ zoomLevel: scrolled.zoomLevel, scrollLeft: scrolled.scrollLeft });
}

/**
 * Runs an editor action by id — the same entry for a toolbar button, a context-menu item and a key. Returns `false`
 * for an id this dispatcher does not own (the transport and the player handle theirs).
 */
export function runEditorAction(host: ActionHost, actionId: string, payload: { trackId?: string; time?: number; elementId?: string } = {}): boolean {
  const { controller } = host, session = controller.session, doc = session.document, sceneId = session.sceneId, playhead = session.playhead;
  const ids = session.selection.selectedElements, picked = elementsOf(doc, sceneId, ids);
  const need = (): boolean => { if (ids.length > 0) return true; host.message?.("Select a clip first"); return false; };
  const keyRefs = session.selection.selectedKeyframes as KeyRef[];
  /** The element-local playhead of every element that owns a selected key. */
  const localTimes = (before: ProjectDocument): Record<string, number> => Object.fromEntries([...new Set(keyRefs.map((key) => key.elementId))].flatMap((id) => { const element = timeline.locate(before, id)?.element; return element ? [[id, Math.min(element.duration, Math.max(0, playhead - element.startTime))]] : []; }));
  const toggle = (key: "snapping" | "linkage" | "previewAxis" | "ripple") => host.setPrefs({ ...host.prefs(), [key]: !host.prefs()[key] });
  const seek = seekActionOf(actionId);
  if (seek) { if (seek === "stop") host.pause?.(); controller.seek(timeline.seekAction(doc, seek, playhead, sceneId)); return true; }
  switch (actionId) {
    case "edit.undo": controller.undo(); return true;
    case "edit.redo": controller.redo(); return true;
    case "timeline.split": { const result = controller.run(timeline.split({ sceneId, time: playhead, elementIds: ids.length > 0 ? ids : undefined })); if (result.ok && result.info?.playhead !== undefined) controller.seek(result.info.playhead); return true; }
    case "timeline.split-all": controller.run(timeline.split({ sceneId, time: playhead, mode: "split-all" })); return true;
    case "timeline.delete-left": case "timeline.delete-right": {
      const result = controller.run(timeline.split({ sceneId, time: playhead, elementIds: ids.length > 0 ? ids : undefined, mode: actionId === "timeline.delete-left" ? "delete-left" : "delete-right" }));
      if (result.ok && result.info?.playhead !== undefined) controller.seek(result.info.playhead);
      return true;
    }
    case "timeline.delete": {
      const decision = timeline.deleteSelection(session.selection, sceneId);
      // A channel emptied by the delete hands its value at the playhead to the stored field.
      if (decision.kind === "keyframes") controller.external((before, ctx) => removeKeys(before, ctx, keyRefs, { localTimes: localTimes(before) }));
      else if (decision.kind === "elements") controller.run(decision.command);
      return true;
    }
    case "timeline.ripple-delete": if (need()) controller.run(timeline.deleteElements({ sceneId, elementIds: ids, ripple: true, label: "Ripple delete" })); return true;
    // Copy, Cut and Paste act on keyframes when keyframes are selected, on elements otherwise.
    case "timeline.copy": if (keyRefs.length > 0) { const copied = copyKeys(doc, keyRefs); if (copied) controller.clipboard.set({ kind: "keyframes", payload: copied }); } else if (ids.length > 0) controller.clipboard.set(timeline.copyElements(doc, sceneId, ids)); return true;
    case "timeline.cut":
      if (keyRefs.length > 0) { const copied = copyKeys(doc, keyRefs); if (copied) { controller.clipboard.set({ kind: "keyframes", payload: copied }); controller.external((before, ctx) => removeKeys(before, ctx, keyRefs, { localTimes: localTimes(before), label: "Cut keyframes" })); } }
      else if (ids.length > 0) controller.run(timeline.cutElements(doc, controller.clipboard, sceneId, ids));
      return true;
    case "timeline.paste":
      if (controller.clipboard.entry?.kind === "keyframes") {
        const copied = controller.clipboard.entry.payload as KeyframeClipboard, targets = ids.length > 0 ? ids : keyRefs.length > 0 ? [...new Set(keyRefs.map((key) => key.elementId))] : [];
        let made: ReturnType<typeof pasteKeys> | null = null;
        const done = controller.external((before, ctx) => { made = pasteKeys(before, ctx, copied, targets.filter((id) => timeline.locate(before, id)), playhead); return made.commit; });
        const result = made as ReturnType<typeof pasteKeys> | null;
        if (done && result) controller.select(timeline.selectKeyframes(controller.session.selection, result.pasted as never));
        if (result && result.skipped > 0) host.message?.(result.skipped === 1 ? "1 keyframe not pasted" : "{n} keyframes not pasted", { n: result.skipped });
        return true;
      }
      if (!controller.clipboard.isEmpty) controller.run(timeline.paste({ sceneId, entry: controller.clipboard.entry, time: payload.time ?? playhead, targetTrackId: payload.trackId })); return true;
    case "timeline.duplicate": if (need()) controller.run(timeline.duplicate({ sceneId, elementIds: ids })); return true;
    case "timeline.group": controller.run(timeline.group({ sceneId, elementIds: ids })); return true;
    case "timeline.ungroup": controller.run(timeline.ungroup({ sceneId, elementIds: ids })); return true;
    case "timeline.link": controller.run(timeline.link({ sceneId, elementIds: ids })); return true;
    case "timeline.unlink": controller.run(timeline.unlink({ sceneId, elementIds: ids })); return true;
    case "timeline.compound.create": controller.run(timeline.createCompound({ sceneId, elementIds: ids })); return true;
    case "timeline.compound.dissolve": if (ids.length === 1) controller.run(timeline.dissolveCompound({ sceneId, elementId: ids[0] })); return true;
    case "timeline.compound.edit": if (ids.length === 1 && picked[0]?.element.type === "compound") controller.enterCompound(ids[0]); return true;
    case "timeline.compound.exit": controller.exitCompound(); return true;
    case "timeline.toggle-hidden": controller.run(timeline.toggleElementFlag({ sceneId, elementIds: ids, flag: "hidden" })); return true;
    case "audio.mute.toggle": controller.run(timeline.toggleElementFlag({ sceneId, elementIds: ids, flag: "muted" })); return true;
    case "timeline.activate.toggle": controller.run(timeline.toggleElementFlag({ sceneId, elementIds: ids, flag: "active" })); return true;
    case "timeline.nudge-left": case "timeline.nudge-right": case "timeline.nudge-left-10": case "timeline.nudge-right-10":
      if (ids.length > 0) controller.run(timeline.nudge(doc, { sceneId, elementIds: ids, frames: (actionId.includes("left") ? -1 : 1) * (actionId.endsWith("-10") ? 10 : 1) }));
      return true;
    case "timeline.trim-start-to-playhead": case "timeline.trim-end-to-playhead": if (need()) controller.run(timeline.trimToPlayhead({ sceneId, elementIds: ids, side: actionId.includes("start") ? "start" : "end", playhead })); return true;
    case "timeline.move-track-up": case "timeline.move-track-down": if (ids.length > 0) controller.run(timeline.moveToAdjacentTrack(doc, { sceneId, elementIds: ids, direction: actionId.endsWith("up") ? "up" : "down" })); return true;
    case "timeline.to-overlay": controller.run(timeline.toOverlay({ sceneId, elementIds: ids })); return true;
    case "timeline.to-main": controller.run(timeline.toMain({ sceneId, elementIds: ids })); return true;
    case "timeline.freeze": {
      const target = freezeTarget(doc, sceneId, ids, playhead);
      if (!target) { host.message?.("Select a video clip and move the playhead onto it"); return true; }
      controller.run(freezeFrameAt({ sceneId, elementId: target, time: playhead, duration: host.freezeDuration?.() ?? FREEZE_DEFAULT_TICKS }));
      return true;
    }
    case "timeline.reverse": {
      const targets = picked.filter(({ element }) => ["video", "audio", "compound"].includes(element.type) && !timeline.isFreeze(element));
      if (targets.length === 0) { host.message?.("Select a video or audio clip"); return true; }
      // Each clip toggles its own direction; its keyframes and linked captions turn with it.
      const on = targets.filter(({ element }) => (element.retime as { reverse?: boolean } | undefined)?.reverse === true).map(({ element }) => element.id), off = targets.filter(({ element }) => !on.includes(element.id)).map(({ element }) => element.id);
      controller.run(timeline.batch("Reverse", [...(off.length > 0 ? [timeline.setSpeed({ sceneId, elementIds: off, change: { reverse: true } })] : []), ...(on.length > 0 ? [timeline.setSpeed({ sceneId, elementIds: on, change: { reverse: false } })] : [])], "timeline.speed"));
      return true;
    }
    case "preview.mirror": case "preview.flip-vertical": {
      const visual = picked.filter(({ element }) => timeline.isVisual(element));
      if (visual.length === 0) { host.message?.("Select a visual clip"); return true; }
      controller.run(timeline.flipElements({ sceneId, elementIds: visual.map(({ element }) => element.id), axis: actionId === "preview.mirror" ? "horizontal" : "vertical" }));
      return true;
    }
    case "preview.rotate-90": {
      const visual = picked.filter(({ element }) => timeline.isVisual(element));
      if (visual.length === 0) { host.message?.("Select a visual clip"); return true; }
      controller.external((before, ctx) => rotateQuarterTurn(before, ctx, visual.map(({ element }) => element.id), playhead));
      return true;
    }
    case "preview.reset-transform": if (picked.some(({ element }) => timeline.isVisual(element))) controller.external((before, ctx) => resetTransforms(before, ctx, ids)); return true;
    case "preview.crop": if (picked.some(({ element }) => timeline.isVisual(element))) host.open?.("crop"); else host.message?.("Select a visual clip"); return true;
    case "audio.extract": case "audio.recover": case "audio.extract.toggle": {
      const videos = picked.filter(({ element }) => element.type === "video" && !timeline.isFreeze(element));
      if (videos.length === 0) { host.message?.("Select a video clip"); return true; }
      const recover = actionId === "audio.recover" || (actionId === "audio.extract.toggle" && timeline.extractAudioTool(doc, ids) === "recover");
      controller.external((before, ctx) => chain(before, ctx, recover ? "Recover audio" : "Extract audio", videos
        .filter(({ element }) => (recover ? element.isSourceAudioEnabled === false : element.isSourceAudioEnabled !== false && timeline.isAudioCapable(before, element)))
        .map(({ element }) => (current: ProjectDocument, context: CommitContext) => (recover ? setElementFields(current, context, element.id, { isSourceAudioEnabled: true }, { commandType: "element.recover-audio", label: "Recover audio" }) : extractAudio(current, context, element.id)))));
      return true;
    }
    case "timeline.replace-media": if (ids.length === 1) host.open?.("replace-media", ids[0]); return true;
    case "timeline.element.rename": if (ids.length === 1) host.open?.("rename-element", ids[0]); return true;
    case "timeline.keyframes.expand": case "timeline.keyframes.collapse": {
      const expanded = new Set(session.view.expandedKeyframeElementIds);
      for (const id of ids) if (actionId.endsWith("expand")) expanded.add(id); else expanded.delete(id);
      controller.setView({ expandedKeyframeElementIds: [...expanded] });
      return true;
    }
    case "timeline.unlink-source": controller.run(timeline.unlinkSource({ sceneId, elementIds: ids })); return true;
    case "keyframe.graph": host.open?.("keyframe-graph"); return true;
    case "keyframe.next": case "keyframe.previous": {
      // The nearest key of the selected element in that direction, across all its animated properties.
      const element = picked[0]?.element;
      const time = element ? neighbourKeyTime(element, Math.min(element.duration, Math.max(0, playhead - element.startTime)), actionId === "keyframe.next" ? "next" : "previous") : null;
      if (element && time !== null) controller.seek(element.startTime + time);
      return true;
    }

    case "selection.all": controller.select(timeline.selectAll(doc, sceneId)); return true;
    case "selection.none": controller.select(timeline.deselectAll()); return true;
    case "selection.previous-clip": case "selection.next-clip": controller.select(timeline.selectNeighbour(doc, session.selection, actionId.includes("previous") ? "previous" : "next", playhead, sceneId)); return true;
    case "timeline.track.select-all": if (payload.trackId) controller.select(timeline.selectAllOnTrack(doc, payload.trackId, sceneId)); return true;
    case "editor.cancel": controller.cancel(); return true;
    case "tools.select": controller.setCursorMode("select"); return true;
    case "tools.blade": controller.setCursorMode("blade"); return true;
    case "timeline.cursor.select-left": controller.setCursorMode("select-left"); return true;
    case "timeline.cursor.select-right": controller.setCursorMode("select-right"); return true;

    case "timeline.magnet.toggle": if (!host.prefs().freeLayer) host.setPrefs(controller.setMagnet(!host.prefs().magnet)); return true;
    case "timeline.toggle-free-layer": host.setPrefs(controller.setFreeLayer(!host.prefs().freeLayer)); return true;
    case "timeline.snapping.toggle": toggle("snapping"); return true;
    case "timeline.linkage.toggle": toggle("linkage"); return true;
    case "timeline.preview-axis.toggle": toggle("previewAxis"); return true;
    case "timeline.ripple.toggle": toggle("ripple"); return true;

    case "marker.toggle": controller.run(timeline.toggleMarker({ sceneId, time: playhead })); return true;
    case "marker.add-next-color": controller.run(timeline.addMarkerNextColor({ sceneId, time: playhead })); return true;
    case "marker.next": case "marker.previous": controller.seek(timeline.markerSeek(doc, sceneId, playhead, actionId.endsWith("next") ? "next" : "previous")); return true;
    case "timeline.marker.delete-all": controller.run(timeline.deleteAllMarkers({ sceneId })); return true;
    case "range.set-in": case "range.set-out": controller.run(timeline.setRangePoint({ sceneId, point: actionId.endsWith("in") ? "in" : "out", time: playhead })); return true;
    case "range.set-to-selection": if (ids.length > 0) controller.run(timeline.setRangeToSelection({ sceneId, elementIds: ids })); else host.message?.(timeline.TIMELINE_MESSAGES.rangeNeedsSelection); return true;
    case "range.clear": controller.run(timeline.clearRange({ sceneId })); return true;

    case "timeline.zoom-in": zoomAction(host, "in"); return true;
    case "timeline.zoom-out": zoomAction(host, "out"); return true;
    case "timeline.zoom-fit": zoomAction(host, "fit"); return true;
    case "timeline.scenes.open": host.open?.("scenes"); return true;

    case "timeline.track-lock.toggle": {
      const trackIds = payload.trackId ? [payload.trackId] : [...new Set(picked.map(({ track }) => track.id))];
      if (trackIds.length > 0) controller.run(timeline.batch("Lock track", trackIds.map((trackId) => timeline.toggleTrackFlag({ trackId, flag: "locked" })), "timeline.track-lock.toggle"));
      return true;
    }
    case "timeline.track.hide.toggle": if (payload.trackId) controller.run(timeline.toggleTrackFlag({ trackId: payload.trackId, flag: "hidden" })); return true;
    case "timeline.track.mute.toggle": if (payload.trackId) controller.run(timeline.toggleTrackFlag({ trackId: payload.trackId, flag: "muted" })); return true;
    case "timeline.track.solo.toggle": if (payload.trackId) controller.update(timeline.toggleTrackSolo({ trackId: payload.trackId })); return true;
    case "timeline.track.move-up": case "timeline.track.move-down": if (payload.trackId) controller.run(timeline.moveTrack(doc, { trackId: payload.trackId, direction: actionId.endsWith("up") ? "up" : "down" })); return true;
    default: return false;
  }
}
