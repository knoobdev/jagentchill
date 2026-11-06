import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { findAsset, isObject } from "../model.ts";
import { formatTimecode } from "../time/index.ts";
import { compoundAvailability } from "./compound.ts";
import {
  activeSceneId, endOf, isFreeze, isHideable, isMaskable, isVisual, sceneById, TIMELINE_MESSAGES, trackSupports, tracksOfScene, zoneOfTrack, type El, type Sc, type Tr,
} from "./model.ts";
import { flattenAvailability, multicamAvailability } from "./multicam.ts";
import { hasProvenance } from "./replace.ts";
import { deleteLabel } from "./selection.ts";
import { isAudioCapable, linkAvailability } from "./track-commands.ts";

export type MenuItem = { id: string; label: string; action?: string; disabled?: boolean; reason?: string } | { separator: true };
const item = (id: string, label: string, action: string, extra: { disabled?: boolean; reason?: string } = {}): MenuItem => ({ id, label, action, ...extra });
const SEPARATOR: MenuItem = { separator: true };
const tidy = (items: (MenuItem | false | undefined)[]): MenuItem[] => {
  const kept = items.filter((entry): entry is MenuItem => Boolean(entry));
  // No leading, trailing or doubled separators.
  return kept.filter((entry, index) => !("separator" in entry) || (index > 0 && index < kept.length - 1 && !("separator" in kept[index - 1])));
};
const picked = (scene: Sc, ids: string[]): { track: Tr; element: El }[] => tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => ids.includes(element.id)).map((element) => ({ track, element })));
const hasEntries = (element: El): boolean => Array.isArray(element.effects) && element.effects.length > 0;
const hasFilter = (element: El): boolean => Array.isArray(element.effects) && (element.effects as { kind?: string }[]).some((entry) => entry.kind === "filter");
const hasKeyframes = (element: El): boolean => isObject(element.animations) && Object.keys(element.animations).length > 0;

/**
 * The element context menu for the current selection (the clicked element is part of it), in the order of the
 * requirement; each item appears only when it applies. Mobile presents the same items in its strips.
 */
export function elementContextMenu(doc: ProjectDocument, sceneId: string, selectedIds: string[], state: { clipboardHasEntry?: boolean; expandedKeyframeElementIds?: string[]; effectsCopied?: boolean } = {}): MenuItem[] {
  const scene = sceneById(doc, sceneId), hits = picked(scene, selectedIds), elements = hits.map((hit) => hit.element);
  if (elements.length === 0) return [];
  const single = elements.length === 1 ? elements[0] : undefined;
  const audible = elements.filter((element) => isAudioCapable(doc, element)), hideable = elements.filter(isHideable), visual = elements.filter(isVisual);
  const videos = elements.filter((element) => element.type === "video" && !isFreeze(element));
  const mainable = hits.filter((hit) => ["video", "image", "compound"].includes(hit.element.type));
  const grouped = elements.some((element) => element.groupId !== null), linked = elements.some((element) => element.linkId !== null);
  const compounds = elements.filter((element) => element.type === "compound" && !element.multicam), parts = elements.filter((element) => element.type === "compound" && element.multicam);
  const reversible = elements.some((element) => (element.type === "video" || element.type === "audio" || element.type === "compound") && !isFreeze(element));
  const replaceable = single && ["video", "image", "audio"].includes(single.type);
  const multicam = multicamAvailability(doc, sceneId, selectedIds), compound = compoundAvailability(doc, sceneId, selectedIds);
  return tidy([
    item("split", "Split", "timeline.split"), item("cut", "Cut", "timeline.cut"), item("copy", "Copy", "timeline.copy"),
    state.clipboardHasEntry !== false && item("paste", "Paste", "timeline.paste"), item("duplicate", "Duplicate", "timeline.duplicate"),
    SEPARATOR,
    audible.length > 0 && item("mute", audible.some((element) => element.muted !== true) ? "Mute" : "Unmute", "audio.mute.toggle"),
    videos.some((element) => element.isSourceAudioEnabled !== false && isAudioCapable(doc, element)) ? item("extract-audio", "Extract audio", "audio.extract")
      : videos.some((element) => element.isSourceAudioEnabled === false) && item("recover-audio", "Recover audio", "audio.recover"),
    linked ? item("unlink", "Unlink", "timeline.unlink") : linkAvailability(doc, sceneId, selectedIds) && item("link", "Link", "timeline.link"),
    hideable.length > 0 && item("hide", hideable.some((element) => element.hidden !== true) ? "Hide" : "Show", "timeline.toggle-hidden"),
    item("activate", elements.some((element) => element.hidden !== true && isHideable(element)) || audible.some((element) => element.muted !== true) ? "Deactivate" : "Activate", "timeline.activate.toggle"),
    SEPARATOR,
    grouped ? item("ungroup", "Ungroup", "timeline.ungroup") : elements.length >= 2 && item("group", "Group", "timeline.group"),
    compounds.length === 1 && single ? item("compound-dissolve", "Undo compound", "timeline.compound.dissolve") : item("compound-create", "Create compound clip", "timeline.compound.create", compound.enabled ? {} : { disabled: true, reason: compound.reason }),
    elements.length >= 2 && multicam.enabled && item("multicam-create", "Create multi-camera clip", "timeline.multicam.create"),
    parts.length > 0 && item("multicam-switch", "Switch angle ▸", "timeline.multicam.switch-angle"),
    parts.length > 0 && item("multicam-flatten", "Flatten multi-camera clip", "timeline.multicam.flatten", (() => { const state2 = flattenAvailability(doc, sceneId, selectedIds); return state2.enabled ? {} : { disabled: true, reason: state2.reason }; })()),
    mainable.length > 0 && (mainable.every((hit) => hit.track === scene.tracks.main) ? item("to-overlay", "To overlay", "timeline.to-overlay") : item("to-main", "To main track", "timeline.to-main")),
    videos.length > 0 && item("freeze", "Freeze frame", "timeline.freeze"),
    reversible && item("reverse", "Reverse", "timeline.reverse"),
    visual.length > 0 && item("crop", "Crop", "preview.crop"), visual.length > 0 && item("rotate", "Rotate 90°", "preview.rotate-90"), visual.length > 0 && item("mirror", "Mirror", "preview.mirror"),
    replaceable && item("replace", "Replace media", "timeline.replace-media"),
    single && single.type !== "effect" && hasEntries(single) && item("copy-effects", "Copy effects", "effects.copy"),
    state.effectsCopied === true && elements.some((element) => element.type !== "effect" && element.type !== "audio") && item("paste-effects", "Paste effects", "effects.paste"),
    elements.some((element) => element.type !== "effect" && hasFilter(element)) && item("remove-filter", "Remove filter", "effects.remove-filter"),
    SEPARATOR,
    elements.some(hasKeyframes) && (elements.filter(hasKeyframes).every((element) => state.expandedKeyframeElementIds?.includes(element.id)) ? item("collapse-keyframes", "Collapse keyframes", "timeline.keyframes.collapse") : item("expand-keyframes", "Expand keyframes", "timeline.keyframes.expand")),
    single && typeof single.mediaId === "string" && item("reveal", "Reveal media", "media.reveal"),
    elements.some(hasProvenance) && item("open-source", "Open source", "timeline.open-source"),
    elements.some(hasProvenance) && item("unlink-source", "Unlink source", "timeline.unlink-source"),
    single && single.type !== "text" && single.type !== "caption" && item("rename", "Rename", "timeline.element.rename"),
    SEPARATOR,
    item("delete", deleteLabel(doc, selectedIds), "timeline.delete"), item("ripple-delete", "Ripple delete", "timeline.ripple-delete"),
  ]);
}

/** The track context menu (a secondary click on a row's empty area or on a header). Items for flags the track type lacks are omitted. */
export function trackContextMenu(doc: ProjectDocument, trackId: string, state: { clipboardHasEntry?: boolean } = {}): MenuItem[] {
  const scene = (doc.scenes as unknown as Sc[]).find((candidate) => tracksOfScene(candidate).some((track) => track.id === trackId));
  const track = scene ? tracksOfScene(scene).find((entry) => entry.id === trackId) : undefined;
  if (!scene || !track) return [];
  const zone = zoneOfTrack(scene, track), index = zone === "main" ? 0 : scene.tracks[zone].indexOf(track), last = zone === "main" ? 0 : scene.tracks[zone].length - 1;
  return tidy([
    state.clipboardHasEntry !== false && item("paste", "Paste", "timeline.paste"),
    item("add-track", "Add track ▸", "timeline.track.add"), item("rename-track", "Rename track", "timeline.track.rename"),
    trackSupports(track, "muted") && item("mute-track", track.muted === true ? "Unmute track" : "Mute track", "timeline.track.mute.toggle"),
    trackSupports(track, "solo") && item("solo-track", track.solo === true ? "Unsolo track" : "Solo track", "timeline.track.solo.toggle"),
    trackSupports(track, "hidden") && item("hide-track", track.hidden === true ? "Show track" : "Hide track", "timeline.track.hide.toggle"),
    item("lock-track", track.locked ? "Unlock track" : "Lock track", "timeline.track-lock.toggle"),
    zone !== "main" && item("move-up", "Move track up", "timeline.track.move-up", index === 0 ? { disabled: true } : {}),
    zone !== "main" && item("move-down", "Move track down", "timeline.track.move-down", index === last ? { disabled: true } : {}),
    item("select-all-on-track", "Select all on track", "timeline.track.select-all"),
    zone !== "main" && item("delete-track", "Delete track", "timeline.track.delete"),
    tracksOfScene(scene).some((entry) => entry.transitions.some((record) => record.kind === "transition")) && item("remove-all-transitions", "Remove all transitions", "transition.remove-all"),
  ]);
}
/** The header controls of a track row, left to right (desktop and web). A control for a flag the track lacks is not rendered. */
export function trackHeaderControls(scene: Sc, track: Tr): string[] {
  const audible = trackSupports(track, "muted");
  return ["type-icon", "name", ...(audible ? ["mute", "solo"] : []), ...(trackSupports(track, "hidden") ? ["visibility"] : []), "lock", ...(audible ? ["volume-pan"] : []), ...(track === scene.tracks.main ? ["cover"] : [])];
}

// — Toolbar —
export const TOOLBAR_LEFT = ["cursor-mode", "undo", "redo", "split", "delete-left", "delete-right", "delete", "marker", "freeze", "reverse", "mirror", "rotate-90", "crop", "extract-audio", "duplicate", "graph-editor"] as const;
export const TOOLBAR_RIGHT = ["record-voiceover", "magnet", "snapping", "linkage", "preview-axis", "ripple", "zoom-out", "zoom-slider", "zoom-in", "zoom-fit"] as const;
/** The tools of the left group that never overflow: everything up to and including Delete. */
const FIXED_LEFT = 7;
/** Quick-access tools for the current single selection. */
export function toolbarContextGroup(doc: ProjectDocument, selectedIds: string[]): string[] {
  if (selectedIds.length !== 1) return [];
  const element = (doc.scenes as unknown as Sc[]).flatMap((scene) => tracksOfScene(scene)).flatMap((track) => track.elements).find((entry) => entry.id === selectedIds[0]);
  if (element?.type === "video") return ["transcript", "split-scenes", "remove-background", "auto-adjust", "enhance"];
  if (element?.type === "image") return ["transcript", "remove-background", "auto-adjust", "enhance"];
  return element?.type === "audio" ? ["mark-beats", "enhance-voice"] : [];
}
/**
 * The toolbar at a width: `leftSlots` is how many left tools fit. The context group collapses first; then the left
 * tools after Delete collapse from the right end into the "⋯" menu, in toolbar order. The tools up to Delete, the
 * centre scene button and the right group never overflow.
 */
export function toolbarLayout(doc: ProjectDocument, selectedIds: string[], leftSlots: number = TOOLBAR_LEFT.length, contextFits = true): { left: string[]; overflow: string[]; context: string[]; centre: { sceneId: string; name: string }; right: string[] } {
  const visible = Math.max(FIXED_LEFT, Math.min(TOOLBAR_LEFT.length, leftSlots)), scene = sceneById(doc, activeSceneId(doc));
  return {
    left: TOOLBAR_LEFT.slice(0, visible), overflow: TOOLBAR_LEFT.slice(visible),
    context: contextFits && visible === TOOLBAR_LEFT.length ? toolbarContextGroup(doc, selectedIds) : [],
    centre: { sceneId: scene.id, name: scene.name }, right: [...TOOLBAR_RIGHT],
  };
}
export type ToolState = { enabled: boolean; reason?: string; pressed?: boolean };
/** Enabled state and disabled reason of the toolbar tools and clip actions that depend on the selection and the playhead. */
export function toolStates(doc: ProjectDocument, input: { sceneId?: string; selectedIds: string[]; selectedKeyframes?: number; playhead: number; canUndo?: boolean; canRedo?: boolean; undoLabel?: string; redoLabel?: string }): Record<string, ToolState & { tooltip?: string }> {
  const scene = sceneById(doc, input.sceneId ?? activeSceneId(doc)), hits = picked(scene, input.selectedIds), elements = hits.map((hit) => hit.element);
  const under = (element: El) => element.startTime < input.playhead && input.playhead < endOf(element);
  const splittable = elements.length > 0 ? elements.some(under) : tracksOfScene(scene).some((track) => !track.locked && track.elements.some(under));
  const none = (reason = "Select a clip first"): ToolState => ({ enabled: false, reason });
  const visual = elements.some(isVisual), videos = elements.filter((element) => element.type === "video" && !isFreeze(element));
  const reversible = elements.some((element) => ["video", "audio", "compound"].includes(element.type) && !isFreeze(element));
  const on = (enabled: boolean, reason?: string): ToolState => (enabled ? { enabled } : { enabled, reason });
  const split = on(splittable, TIMELINE_MESSAGES.splitDisabled);
  return {
    undo: { enabled: input.canUndo === true, tooltip: input.undoLabel ? `Undo ${input.undoLabel}` : "Undo" }, redo: { enabled: input.canRedo === true, tooltip: input.redoLabel ? `Redo ${input.redoLabel}` : "Redo" },
    split, "delete-left": split, "delete-right": split,
    delete: elements.length > 0 ? { enabled: true } : none(), duplicate: elements.length > 0 ? { enabled: true } : none(),
    marker: { enabled: true, pressed: (scene.markers as { time: number }[]).some((marker) => marker.time === input.playhead) },
    crop: on(visual, "Select a visual clip"), "rotate-90": on(visual, "Select a visual clip"), mirror: on(visual, "Select a visual clip"),
    freeze: on(videos.some(under), "Select a video clip and move the playhead onto it"), reverse: on(reversible, "Select a video or audio clip"),
    "extract-audio": on(videos.length > 0, "Select a video clip"),
    "range.set-to-selection": on(elements.length > 0, TIMELINE_MESSAGES.rangeNeedsSelection),
    mask: on(elements.some(isMaskable), "Select a clip that can be masked"),
    "graph-editor": on((input.selectedKeyframes ?? 0) > 0 || elements.some(hasKeyframes), "Select a keyframe to edit its curve."),
  };
}
/** The Extract/Recover audio toolbar tool: Recover when a selected video has its source audio switched off. */
export const extractAudioTool = (doc: ProjectDocument, selectedIds: string[]): "extract" | "recover" => {
  const elements = (doc.scenes as unknown as Sc[]).flatMap((scene) => tracksOfScene(scene)).flatMap((track) => track.elements).filter((element) => selectedIds.includes(element.id) && element.type === "video");
  return elements.length > 0 && elements.every((element) => element.isSourceAudioEnabled === false) ? "recover" : "extract";
};

// — Mobile —
/** Every timeline action with a mobile entry, and the entry of `mobile-editor` that invokes it. */
export const MOBILE_TIMELINE_ACTIONS: Record<string, string> = {
  "timeline.split": "Video clip tool strip", "timeline.delete": "Video clip tool strip", "timeline.duplicate": "Video clip tool strip", "timeline.freeze": "Video clip tool strip", "timeline.replace-media": "Video clip tool strip",
  "timeline.track.rename": "Layers sheet", "timeline.track-lock.toggle": "Layers sheet", "timeline.track.hide.toggle": "Layers sheet", "timeline.track.mute.toggle": "Layers sheet", "timeline.track.solo.toggle": "Layers sheet",
  "timeline.track.move-up": "Layers sheet", "timeline.track.move-down": "Layers sheet", "timeline.track.delete": "Layers sheet", "timeline.track.add": "Layers sheet",
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`timeline.multicam.switch-angle-${index + 1}`, "Compound clip tool strip"])),
  "timeline.multicam.create": "Multi-select tool strip", "timeline.multicam.flatten": "Compound clip tool strip",
  "marker.toggle": "Markers on mobile", "timeline.marker.edit": "Markers on mobile", "timeline.marker.delete": "Markers on mobile", "timeline.marker.delete-all": "Markers on mobile", "marker.next": "Markers on mobile", "marker.previous": "Markers on mobile",
  "timeline.scenes.open": "More sheet",
  "timeline.compound.create": "Multi-select tool strip", "timeline.compound.edit": "Compound clip tool strip", "timeline.compound.exit": "Compound clip tool strip", "timeline.compound.dissolve": "Compound clip tool strip",
  "timeline.paste": "Root toolbar",
  "timeline.copy": "Video clip tool strip", "timeline.cut": "Video clip tool strip", "timeline.group": "Multi-select tool strip", "timeline.ungroup": "Multi-select tool strip", "timeline.link": "Multi-select tool strip", "timeline.unlink": "Video clip tool strip",
  "timeline.toggle-hidden": "Video clip tool strip", "timeline.activate.toggle": "Video clip tool strip",
  "timeline.to-overlay": "Video clip tool strip", "timeline.to-main": "Video clip tool strip",
  "timeline.snapping.toggle": "More sheet", "timeline.linkage.toggle": "More sheet", "timeline.toggle-free-layer": "More sheet", "timeline.select-mode": "More sheet",
  "range.set-in": "More sheet", "range.set-out": "More sheet", "range.set-to-selection": "More sheet", "range.clear": "More sheet",
  "timeline.split-scenes": "Video clip tool strip", "timeline.background.edit": "Root toolbar",
};
/** Declared unavailable on mobile, with no entry. `timeline.multicam.create` / `.flatten` are listed by the requirement in both places. */
export const MOBILE_UNAVAILABLE_ACTIONS = [
  "timeline.magnet.toggle", "timeline.ripple.toggle", "timeline.preview-axis.toggle", "tools.select", "tools.blade", "timeline.cursor.select-left", "timeline.cursor.select-right",
  "timeline.split-all", "timeline.delete-left", "timeline.delete-right", "timeline.ripple-delete", "timeline.nudge-left", "timeline.nudge-right", "timeline.nudge-left-10", "timeline.nudge-right-10",
  "timeline.trim-start-to-playhead", "timeline.trim-end-to-playhead", "timeline.zoom-in", "timeline.zoom-out", "timeline.zoom-fit", "timeline.multicam.create", "timeline.multicam.flatten",
] as const;
/** The action ids this capability owns in the action registry. */
export const TIMELINE_ACTIONS: readonly string[] = [...new Set([
  ...Object.keys(MOBILE_TIMELINE_ACTIONS), ...MOBILE_UNAVAILABLE_ACTIONS, "selection.all", "selection.none", "editor.cancel",
])];
/** How an action is accounted for on mobile: by an entry, or declared unavailable; `undefined` is an unlisted id (the CI test fails on it). */
export const mobileAvailability = (actionId: string): { entry: string } | { unavailable: true } | undefined =>
  MOBILE_TIMELINE_ACTIONS[actionId] ? { entry: MOBILE_TIMELINE_ACTIONS[actionId] } : (MOBILE_UNAVAILABLE_ACTIONS as readonly string[]).includes(actionId) ? { unavailable: true } : undefined;
/** The rows of the "Tracks" tab of the mobile Layers sheet: one per track in stack order with the controls its type has. */
export function mobileTrackRows(doc: ProjectDocument, sceneId?: string): { trackId: string; name: string; controls: string[] }[] {
  const scene = sceneById(doc, sceneId ?? activeSceneId(doc));
  return tracksOfScene(scene).map((track) => ({
    trackId: track.id, name: track.name,
    controls: ["rename", ...(trackSupports(track, "hidden") ? ["hide"] : []), "lock", ...(trackSupports(track, "muted") ? ["mute", "solo", "volume", "pan"] : []), ...(track === scene.tracks.main ? [] : ["reorder"])],
  }));
}

export type TouchGesture =
  | { kind: "tap"; target: "clip" | "empty"; elementId?: string }
  | { kind: "double-tap"; elementId: string }
  | { kind: "drag"; axis: "horizontal" | "vertical" }
  | { kind: "pinch" }
  | { kind: "trim-handle"; elementId: string; side: "start" | "end" }
  | { kind: "long-press"; elementId: string };
/** What each touch gesture does to the timeline; every one commits through the same commands as desktop. */
export function mobileGestureIntent(doc: ProjectDocument, gesture: TouchGesture, sceneId?: string): { intent: "select" | "deselect" | "edit-text" | "scroll-seek" | "scroll-tracks" | "zoom-at-playhead" | "trim" | "reorder-main" | "move" | "none"; command?: "move" | "trim"; previewFrame?: "trimmed-edge" } {
  const scene = sceneById(doc, sceneId ?? activeSceneId(doc));
  const hit = "elementId" in gesture && gesture.elementId ? picked(scene, [gesture.elementId])[0] : undefined;
  switch (gesture.kind) {
    case "tap": return { intent: gesture.target === "clip" && hit && !hit.track.locked ? "select" : "deselect" };
    case "double-tap": return { intent: hit && (hit.element.type === "text" || hit.element.type === "caption") ? "edit-text" : "none" };
    case "drag": return { intent: gesture.axis === "horizontal" ? "scroll-seek" : "scroll-tracks" };
    case "pinch": return { intent: "zoom-at-playhead" };
    case "trim-handle": return hit && !hit.track.locked ? { intent: "trim", command: "trim", previewFrame: "trimmed-edge" } : { intent: "none" };
    case "long-press": return !hit || hit.track.locked ? { intent: "none" } : { intent: hit.track === scene.tracks.main ? "reorder-main" : "move", command: "move" };
  }
}

// — Accessibility —
const ROLE: Record<string, string> = { video: "Video clip", image: "Image clip", audio: "Audio clip", text: "Text", caption: "Caption", sticker: "Sticker", graphic: "Shape", effect: "Effect", adjustment: "Adjustment layer", compound: "Compound clip" };
/** The accessible description of an element: role, name, start and duration as text, and its states. */
export function describeElement(doc: ProjectDocument, element: El, track: { locked: boolean }, selected = false): string {
  const fps = doc.settings.fps as Rational, asset = typeof element.mediaId === "string" ? findAsset(doc, element.mediaId) : undefined;
  const name = element.type === "text" ? String(element.content ?? element.name) : element.type === "caption" ? String(element.text ?? element.name) : asset?.name ?? element.name;
  const states = [selected && "selected", element.hidden === true && "hidden", element.muted === true && "muted", track.locked && "locked"].filter(Boolean);
  return [`${ROLE[element.type] ?? "Clip"}, ${name}, starts ${formatTimecode(element.startTime, "HH:MM:SS:FF", fps)}, duration ${formatTimecode(element.duration, "HH:MM:SS:FF", fps)}`, ...states].join(", ");
}
/** A track row is exposed as a list named by the track; its elements in time order. */
export const describeTrack = (track: Tr): { role: "list"; name: string; itemIds: string[] } => ({ role: "list", name: track.name, itemIds: track.elements.map((element) => element.id) });
/** Keyboard focus inside the tracks: left and right between elements of a row, up and down between rows (the element nearest in time). */
export function focusNeighbour(doc: ProjectDocument, sceneId: string, elementId: string, direction: "left" | "right" | "up" | "down"): string | undefined {
  const order = tracksOfScene(sceneById(doc, sceneId)), row = order.findIndex((track) => track.elements.some((element) => element.id === elementId));
  if (row < 0) return undefined;
  const index = order[row].elements.findIndex((element) => element.id === elementId), current = order[row].elements[index];
  if (direction === "left" || direction === "right") return order[row].elements[index + (direction === "right" ? 1 : -1)]?.id;
  for (let next = row + (direction === "down" ? 1 : -1); next >= 0 && next < order.length; next += direction === "down" ? 1 : -1) {
    const nearest = [...order[next].elements].sort((a, b) => Math.abs(a.startTime - current.startTime) - Math.abs(b.startTime - current.startTime))[0];
    if (nearest) return nearest.id;
  }
  return undefined;
}
/** Selected elements of a multi-selection an action applies to; with none the control is disabled. */
export const applicableIds = (doc: ProjectDocument, sceneId: string, selectedIds: string[], applies: (element: El) => boolean): string[] =>
  picked(sceneById(doc, sceneId), selectedIds).filter((hit) => applies(hit.element)).map((hit) => hit.element.id);

// — What a clip shows —
export type ClipBadge = "provenance" | "speed" | "reverse" | "effects" | "muted" | "keyframes" | "linked" | "group" | "trim-adjusted" | "slate" | "media-offline";
/**
 * The behaviour-dependent parts of a clip's presentation: whether it has a header, its badges in header order, where
 * its filmstrip starts in the source, and whether it carries the 16 px waveform strip. Drawing is the UI's.
 */
export function clipPresentation(doc: ProjectDocument, element: El, widthPx: number, state: { trimAdjusted?: boolean; offlineAssetIds?: readonly string[]; selected?: boolean } = {}): { showHeader: boolean; badges: ClipBadge[]; filmstripSourceStart: number; waveformStrip: boolean; hidden: boolean; inlineDiamonds: boolean } {
  const asset = typeof element.mediaId === "string" ? findAsset(doc, element.mediaId) : undefined, retime = element.retime as { rate?: number; reverse?: boolean; curve?: unknown } | undefined;
  const offline = typeof element.mediaId === "string" && (asset === undefined || state.offlineAssetIds?.includes(element.mediaId) === true);
  const badges = ([
    hasProvenance(element) && widthPx >= 64 && "provenance", retime !== undefined && (retime.curve !== undefined || (retime.rate ?? 1) !== 1) && "speed", retime?.reverse === true && "reverse",
    Array.isArray(element.effects) && element.effects.length > 0 && element.type !== "effect" && "effects", element.muted === true && "muted", hasKeyframes(element) && "keyframes",
    element.linkId !== null && "linked", element.groupId !== null && "group", state.trimAdjusted === true && "trim-adjusted", asset?.kind === "slate" && "slate", offline && "media-offline",
  ] as (ClipBadge | false)[]).filter((badge): badge is ClipBadge => badge !== false);
  const showHeader = widthPx >= 24;
  return {
    showHeader, badges: showHeader ? badges : [], filmstripSourceStart: element.trimStart,
    waveformStrip: (element.type === "video" || element.type === "compound") && element.isSourceAudioEnabled !== false && isAudioCapable(doc, element),
    hidden: element.hidden === true, inlineDiamonds: state.selected === true && widthPx >= 40 && hasKeyframes(element),
  };
}
