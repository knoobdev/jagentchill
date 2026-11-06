import type { TimelineRow } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";

/** Sizes of the phone editor's regions and lanes, in pt (the same number of px on web). */
export const COMPACT = {
  topBar: 44, transport: 44, toolbar: 56, ruler: 20, previewMin: 0.35, compactTimeline: 48, mainRow: 56, mainRowSmall: 28, strip: 4, stripGap: 3, rowGap: 4, laneLabel: 44, sideButton: 56, addButton: 36,
  addAudioRow: 32, toolWidth: 60, junction: 24, sheetHeader: 44, trackGutter: 120, stripsPerType: 3,
} as const;

/** Region heights after the safe-area-aware top bar, for the visible window height (which RN shrinks for the keyboard). */
export function compactRegionHeights(windowHeight: number, insets: { top: number; bottom: number }) {
  const screen = Math.max(0, windowHeight - insets.top - insets.bottom);
  const preview = Math.ceil(windowHeight * COMPACT.previewMin);
  const below = Math.max(120, screen - COMPACT.topBar - preview - COMPACT.transport);
  const timeline = Math.max(72, Math.min(260, below - COMPACT.toolbar));
  const sheet = Math.max(windowHeight < 600 ? 120 : 160, Math.min(420, below - COMPACT.compactTimeline));
  return { preview, timeline, sheet, toolbar: COMPACT.toolbar, transport: COMPACT.transport, bottomInset: insets.bottom };
}

/** Landscape phone panes: preview and transport fill the left pane; timeline and its 56 pt tools fill the right. */
export function compactLandscapeHeights(windowWidth: number, windowHeight: number, insets: { top: number; bottom: number }) {
  const usable = Math.max(0, windowHeight - insets.top - insets.bottom - COMPACT.topBar);
  const preview = Math.max(0, usable - COMPACT.transport);
  const timeline = Math.max(0, usable - COMPACT.toolbar);
  return { preview, timeline, sheet: Math.max(120, usable - COMPACT.compactTimeline), toolbar: COMPACT.toolbar, transport: COMPACT.transport, bottomInset: insets.bottom, landscape: windowWidth > windowHeight };
}

/** Landscape tool sheets use the side of the timeline pane, leaving a narrow seek strip exposed. */
export function compactLandscapeSheetWidth(windowWidth: number): number {
  return Math.min(320, Math.max(260, Math.floor(windowWidth * 0.36)));
}

/** One accessible compact-editor zoom step, clamped to the legal phone range. */
export function stepCompactZoom(zoom: number, direction: "in" | "out", range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, zoom * (direction === "in" ? 1.25 : 0.8)));
}

/** The tool groups of the root toolbar that own lanes: inside one, the lanes of its track types are drawn in full. */
export type LaneGroup = "audio" | "text" | "stickers" | "overlay" | "effects" | "captions" | "adjust";
export const GROUP_TRACK_TYPES: Record<LaneGroup, readonly string[]> = { audio: ["audio"], text: ["text"], stickers: ["graphic"], overlay: ["video"], effects: ["effect"], captions: ["caption"], adjust: ["adjustment"] };
export const groupOfTrackType = (type: string): LaneGroup | null => (Object.keys(GROUP_TRACK_TYPES) as LaneGroup[]).find((group) => GROUP_TRACK_TYPES[group].includes(type)) ?? null;

/** A lane of the phone timeline: a row of the engine's track list at the phone's heights, drawn in full or as a 4 pt strip. */
export type CompactRow = TimelineRow & { collapsed: boolean };

/**
 * The lanes top to bottom: the main track first, then every other track in the engine's order. A track whose type is
 * neither in the open group nor selected is a strip; at most three strips are drawn per type, the rest share the last.
 */
export function compactRows(doc: ProjectDocument, options: { sceneId: string; expandedTypes: ReadonlySet<string>; smallMain: boolean; addAudioRow: boolean }): { rows: CompactRow[]; height: number; addAudioTop: number | null } {
  const scene = timeline.sceneById(doc, options.sceneId), tracks = timeline.tracksOfScene(scene), main = scene.tracks.main;
  const rows: CompactRow[] = [];
  let top: number = COMPACT.rowGap;
  const place = (track: timeline.Tr, zone: CompactRow["zone"], height: number, collapsed: boolean, sharedTop?: number) => {
    const at = sharedTop ?? top;
    rows.push({ trackId: track.id, zone, type: track.type, name: track.name, top: at, height, baseHeight: height, lanes: 0, alt: false, locked: track.locked, collapsed });
    if (sharedTop === undefined) top += height + (collapsed ? COMPACT.stripGap : COMPACT.rowGap);
  };
  place(main, "main", options.smallMain ? COMPACT.mainRowSmall : COMPACT.mainRow, false);
  let addAudioTop: number | null = null;
  if (options.addAudioRow) { addAudioTop = top; top += COMPACT.addAudioRow + COMPACT.rowGap; }
  const strips = new Map<string, { count: number; lastTop: number }>();
  for (const track of tracks) {
    if (track === main) continue;
    const zone = track.type === "audio" ? "audio" : "overlay";
    if (options.expandedTypes.has(track.type)) { place(track, zone, timeline.rowHeight(track, zone, "mobile"), false); continue; }
    // An empty lane has nothing to draw as a strip.
    if (track.elements.length === 0) { place(track, zone, 0, true, top); continue; }
    const seen = strips.get(track.type) ?? { count: 0, lastTop: top };
    if (seen.count >= COMPACT.stripsPerType) place(track, zone, COMPACT.strip, true, seen.lastTop);
    else { strips.set(track.type, { count: seen.count + 1, lastTop: top }); place(track, zone, COMPACT.strip, true); }
  }
  return { rows: rows.sort((a, b) => a.top - b.top), height: top, addAudioTop };
}

/** The zoom range of the phone timeline: from the whole scene inside the viewport (never under 2 pt per second) to 24 pt per frame. */
export function zoomRange(duration: number, viewportWidth: number, fps: Rational): { min: number; max: number } {
  const seconds = duration / TICKS_PER_SECOND, max = (24 * fps.numerator) / fps.denominator / timeline.BASE_PIXELS_PER_SECOND;
  const fit = seconds > 0 ? viewportWidth / (seconds * timeline.BASE_PIXELS_PER_SECOND) : 1;
  return { min: Math.min(max, Math.max(2 / timeline.BASE_PIXELS_PER_SECOND, Math.min(fit, 1))), max };
}
export const clampCompactZoom = (zoom: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, zoom));

/** Fixed left rail reserved for the main track controls; clips are masked there while the playhead stays centred. */
export const inMainTrackControlGutter = (x: number): boolean => x >= 0 && x < COMPACT.trackGutter;

/** Scroll content uses a clipped viewport beside the fixed controls; the content offset preserves the screen-centred playhead. */
export function compactTrackGeometry(width: number, centre: number, scroll: number, controls: boolean) {
  const viewportLeft = controls ? Math.min(width, COMPACT.trackGutter) : 0;
  return {
    viewportLeft,
    viewportWidth: Math.max(0, width - viewportLeft),
    contentLeft: centre - scroll - viewportLeft,
  };
}

/** `MM:SS`, `H:MM:SS` from one hour: the time of the transport row. */
export function clock(ticks: number): string {
  const total = Math.floor(Math.max(0, ticks) / TICKS_PER_SECOND), hours = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0"), ss = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** "22.1s": the length a selected clip reads. */
export const secondsBadge = (ticks: number): string => `${(ticks / TICKS_PER_SECOND).toFixed(1)}s`;

/** Which part of a selected clip a finger is on: the trim handles take 44 pt across each edge; a short clip keeps a body in its middle third. */
export function touchZone(localX: number, width: number, hit: number, handle: number): "trim-start" | "trim-end" | "body" | null {
  const shortClip = width < hit;
  const inside = shortClip ? width / 2 : handle;
  const outside = shortClip ? hit - inside : hit - handle;
  if (localX < -outside || localX > width + outside) return null;
  if (localX <= inside) return "trim-start";
  if (localX >= width - inside) return "trim-end";
  return "body";
}
/** The speed of the edge auto-scroll, in pt per second: 200–1 200 by how deep the finger is in the 40 pt zone, signed. */
export function edgeScrollSpeed(x: number, width: number, zone: number, min: number, max: number): number {
  if (x < zone) return -(min + (max - min) * Math.min(1, (zone - x) / zone));
  if (x > width - zone) return min + (max - min) * Math.min(1, (x - (width - zone)) / zone);
  return 0;
}

/**
 * Whether a window shows the phone editor: a compact window, and a touch device whose short side is a phone's — a
 * phone turned on its side for the full-screen preview keeps its editor.
 */
export const isPhoneEditor = (theme: { compact: boolean; touch: boolean; width: number; height: number }): boolean => theme.compact || (theme.touch && Math.min(theme.width, theme.height) < 600);
