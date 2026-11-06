import type { ProjectDocument } from "@jagentchill/protocol";
import { activeSceneId, endOf, overlaps, sceneById, tracksOfScene, withPartners, type El, type Sc, type Tr } from "./model.ts";

/** One editor has one active selection scope; selecting in a scope clears the previous one. */
export type SelectionScope = "timeline" | "library" | "scenes";
export type KeyframeRef = { elementId: string; path: string; keyId: string };
export type MaskPointRef = { elementId: string; maskId: string; pointId: string };
export type SelectionState = {
  scope: SelectionScope;
  selectedElements: string[];
  selectedKeyframes: KeyframeRef[];
  keyframeAnchor?: KeyframeRef;
  selectedMaskPoints: MaskPointRef[];
  /** Library asset ids or scene ids while that scope is active. */
  selectedItems: string[];
};
export const EMPTY_SELECTION: SelectionState = { scope: "timeline", selectedElements: [], selectedKeyframes: [], selectedMaskPoints: [], selectedItems: [] };
export type SelectionKind = "maskPoints" | "keyframes" | "elements" | "none";
/** The active kind: mask points, then keyframes, then elements. Delete, Copy and Cut dispatch on it. */
export const activeSelectionKind = (state: SelectionState): SelectionKind =>
  state.selectedMaskPoints.length > 0 ? "maskPoints" : state.selectedKeyframes.length > 0 ? "keyframes" : state.selectedElements.length > 0 ? "elements" : "none";

const scene = (doc: ProjectDocument, sceneId?: string): Sc => sceneById(doc, sceneId ?? activeSceneId(doc));
const selectable = (sc: Sc): { track: Tr; element: El }[] => tracksOfScene(sc).filter((track) => !track.locked).flatMap((track) => track.elements.map((element) => ({ track, element })));
/** Selecting elements clears keyframe and mask-point selections and makes the timeline the active scope. */
export const selectElements = (ids: string[]): SelectionState => ({ ...EMPTY_SELECTION, selectedElements: [...new Set(ids)] });
/** Elements on locked tracks cannot be selected by any means; ids that no longer exist drop out. */
export function selectableIds(doc: ProjectDocument, ids: string[], sceneId?: string): string[] {
  const allowed = new Set(selectable(scene(doc, sceneId)).map((entry) => entry.element.id));
  return ids.filter((id) => allowed.has(id));
}

export type ClickModifiers = { toggle?: boolean; single?: boolean; secondary?: boolean };
/**
 * A click (tap) on an element. Plain: only that element — with its group and link partners, unless Alt/Option
 * (`single`) asks for the one member; on the sole selected element it only clears the keyframe selection. Cmd/Ctrl or
 * Shift (`toggle`): toggles it. Secondary: selects an unselected element first, keeps a multi-selection.
 */
export function clickElement(doc: ProjectDocument, state: SelectionState, elementId: string, modifiers: ClickModifiers = {}, sceneId?: string): SelectionState {
  const sc = scene(doc, sceneId);
  if (selectableIds(doc, [elementId], sc.id).length === 0) return state;
  const members = modifiers.single ? [elementId] : withPartners(sc, [elementId], { groups: true, links: true }).filter((id) => selectableIds(doc, [id], sc.id).length > 0);
  const current = state.scope === "timeline" ? state.selectedElements : [];
  const selected = members.every((id) => current.includes(id));
  if (modifiers.secondary) return selected ? { ...state, scope: "timeline", selectedItems: [] } : selectElements(members);
  if (modifiers.toggle) return selectElements(selected ? current.filter((id) => !members.includes(id)) : [...current, ...members]);
  if (selected && current.length === members.length) return { ...state, scope: "timeline", selectedItems: [], selectedKeyframes: [], keyframeAnchor: undefined };
  return selectElements(members);
}
/** A selection made in another scope (library items, the Scenes sheet) empties the timeline selection. */
export const selectInScope = (scope: Exclude<SelectionScope, "timeline">, ids: string[]): SelectionState => ({ ...EMPTY_SELECTION, scope, selectedItems: [...new Set(ids)] });
export const selectKeyframes = (state: SelectionState, keys: KeyframeRef[], anchor?: KeyframeRef): SelectionState => ({ ...state, scope: "timeline", selectedItems: [], selectedKeyframes: keys, keyframeAnchor: anchor ?? keys[0], selectedMaskPoints: [] });
export const selectMaskPoints = (state: SelectionState, points: MaskPointRef[]): SelectionState => ({ ...state, scope: "timeline", selectedItems: [], selectedMaskPoints: points });

/** Cancel with no gesture in flight: one selection level per invocation — mask points, keyframes, elements. */
export function cancelSelectionLevel(state: SelectionState): SelectionState {
  if (state.selectedMaskPoints.length > 0) return { ...state, selectedMaskPoints: [] };
  if (state.selectedKeyframes.length > 0) return { ...state, selectedKeyframes: [], keyframeAnchor: undefined };
  return { ...state, selectedElements: [], selectedItems: [] };
}

/** A marquee in time and row space; rows are base row rectangles (expanded keyframe lanes are ignored). */
export type Marquee = { startTime: number; endTime: number; top: number; bottom: number };
export type RowRect = { trackId: string; top: number; height: number };
/** Elements on unlocked tracks whose time-rectangles intersect the marquee; `additive` (Shift, Ctrl or Cmd at drag start) adds to the selection. */
export function boxSelect(doc: ProjectDocument, state: SelectionState, marquee: Marquee, rows: RowRect[], additive = false, sceneId?: string): SelectionState {
  const from = Math.min(marquee.startTime, marquee.endTime), to = Math.max(marquee.startTime, marquee.endTime);
  const top = Math.min(marquee.top, marquee.bottom), bottom = Math.max(marquee.top, marquee.bottom);
  const hitRows = new Set(rows.filter((row) => row.top < bottom && row.top + row.height > top).map((row) => row.trackId));
  const hits = selectable(scene(doc, sceneId)).filter(({ track, element }) => hitRows.has(track.id) && element.startTime < to && endOf(element) > from).map(({ element }) => element.id);
  return selectElements(additive && state.scope === "timeline" ? [...state.selectedElements, ...hits] : hits);
}

export const MARQUEE_THRESHOLD_PX = 5;
export const CLICK_MAX_MS = 500;
/** A press on empty area: more than 5 px of travel starts a marquee; within 5 px and 500 ms it is a click. */
export const emptyAreaGesture = (travelPx: number, elapsed_ms: number): "marquee" | "click" | "none" =>
  travelPx > MARQUEE_THRESHOLD_PX ? "marquee" : elapsed_ms <= CLICK_MAX_MS ? "click" : "none";
/** A click on empty track area, ruler, marker row or gutter clears the selection and seeks; on the header column it only clears. */
export function clickEmptyArea(state: SelectionState, area: "tracks" | "ruler" | "markers" | "gutter" | "header", time: number): { selection: SelectionState; seekTo?: number } {
  const selection = { ...EMPTY_SELECTION };
  void state;
  return area === "header" ? { selection } : { selection, seekTo: Math.max(0, time) };
}

export const selectAll = (doc: ProjectDocument, sceneId?: string): SelectionState => selectElements(selectable(scene(doc, sceneId)).map((entry) => entry.element.id));
export const deselectAll = (): SelectionState => ({ ...EMPTY_SELECTION });
const under = (element: El, time: number) => element.startTime < time && time < endOf(element);
/** Every element whose end ≤ playhead, plus the elements under the playhead. */
export const selectAllBefore = (doc: ProjectDocument, playhead: number, sceneId?: string): SelectionState =>
  selectElements(selectable(scene(doc, sceneId)).filter(({ element }) => endOf(element) <= playhead || under(element, playhead)).map(({ element }) => element.id));
/** Every element whose start ≥ playhead, plus the elements under the playhead. */
export const selectAllAfter = (doc: ProjectDocument, playhead: number, sceneId?: string): SelectionState =>
  selectElements(selectable(scene(doc, sceneId)).filter(({ element }) => element.startTime >= playhead || under(element, playhead)).map(({ element }) => element.id));
/** "Select leftward" / "Select rightward" cursor modes: a click at `time` selects everything ending at or before it, or starting at or after it. */
export const selectLeftward = (doc: ProjectDocument, time: number, sceneId?: string): SelectionState =>
  selectElements(selectable(scene(doc, sceneId)).filter(({ element }) => endOf(element) <= time).map(({ element }) => element.id));
export const selectRightward = (doc: ProjectDocument, time: number, sceneId?: string): SelectionState =>
  selectElements(selectable(scene(doc, sceneId)).filter(({ element }) => element.startTime >= time).map(({ element }) => element.id));
export const selectAllOnTrack = (doc: ProjectDocument, trackId: string, sceneId?: string): SelectionState =>
  selectElements(selectable(scene(doc, sceneId)).filter(({ track }) => track.id === trackId).map(({ element }) => element.id));

/** The nearest element on the same track as the single selection; with no selection, the main-track clip nearest the playhead. */
export function selectNeighbour(doc: ProjectDocument, state: SelectionState, direction: "previous" | "next", playhead: number, sceneId?: string): SelectionState {
  const sc = scene(doc, sceneId);
  if (state.selectedElements.length !== 1) {
    if (state.selectedElements.length > 1 || sc.tracks.main.locked) return state;
    const distance = (clip: El) => (overlaps(clip.startTime, endOf(clip), playhead, playhead + 1) ? 0 : Math.min(Math.abs(clip.startTime - playhead), Math.abs(endOf(clip) - playhead)));
    const nearest = [...sc.tracks.main.elements].sort((a, b) => distance(a) - distance(b) || a.startTime - b.startTime)[0];
    return nearest ? selectElements([nearest.id]) : state;
  }
  const track = tracksOfScene(sc).find((candidate) => candidate.elements.some((element) => element.id === state.selectedElements[0]));
  if (!track) return state;
  const index = track.elements.findIndex((element) => element.id === state.selectedElements[0]);
  const neighbour = track.elements[index + (direction === "next" ? 1 : -1)];
  return neighbour ? selectElements([neighbour.id]) : state;
}

/** Tracks that hold at least one selected element: their rows and headers are highlighted. */
export const highlightedTrackIds = (doc: ProjectDocument, state: SelectionState, sceneId?: string): string[] =>
  tracksOfScene(scene(doc, sceneId)).filter((track) => track.elements.some((element) => state.selectedElements.includes(element.id))).map((track) => track.id);
/** The label of the delete item: "Delete N elements", "Delete text", "Delete clip". */
export function deleteLabel(doc: ProjectDocument, ids: string[]): string {
  if (ids.length !== 1) return `Delete ${ids.length} elements`;
  const element = (doc.scenes as unknown as Sc[]).flatMap((sc) => tracksOfScene(sc)).flatMap((track) => track.elements).find((entry) => entry.id === ids[0]);
  return element?.type === "text" || element?.type === "caption" ? "Delete text" : "Delete clip";
}
