import { CLASSIC_PATH_RENAMES, CLASSIC_TEXT_BACKGROUND_KEYS, type ClassicMediaRecord } from "../../src/index.ts";

/**
 * Classic v31 records, built here to the shape OpenCut classic stores at version 31 (`SerializedProject` and
 * `MediaAssetData` of `.refs/opencut-classic/apps/web/src/services/storage/types.ts`): ISO date strings, the flat
 * `element.params` map, animations keyed by classic property paths, `bookmarks`, `background.type`. They are
 * constructed from the classic type definitions, not exported from a running classic app.
 */
type Json = Record<string, unknown>;
const ISO = "2025-03-04T05:06:07.000Z";
export const ISO_MS = Date.parse(ISO);
const visual = (over: Json = {}) => ({ "transform.positionX": 0, "transform.positionY": 0, "transform.scaleX": 1, "transform.scaleY": 1, "transform.rotate": 0, opacity: 1, blendMode: "normal", ...over });
const base = (id: string, type: string, start: number, seconds: number, extra: Json = {}): Json => ({ id, type, name: id, startTime: start * 120_000, duration: seconds * 120_000, trimStart: 0, trimEnd: 0, ...extra });
export const key = (id: string, time: number, value: unknown): Json => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
export const scalar = (...keys: Json[]): Json => ({ keys });

export const classic = {
  video: (id: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "video", start, seconds, { mediaId: "m-video", sourceDuration: seconds * 120_000, isSourceAudioEnabled: true, params: { ...visual(), volume: 0, muted: false, ...params }, ...extra }),
  image: (id: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "image", start, seconds, { mediaId: "m-image", params: { ...visual(), ...params }, ...extra }),
  audio: (id: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "audio", start, seconds, { sourceType: "upload", mediaId: "m-audio", sourceDuration: seconds * 120_000, params: { volume: 0, muted: false, ...params }, ...extra }),
  text: (id: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "text", start, seconds, {
    params: {
      ...visual(), content: "Default text", fontSize: 15, fontFamily: "Arial", color: "#ffffff", textAlign: "center", fontWeight: "normal", fontStyle: "normal", textDecoration: "none",
      letterSpacing: 0, lineHeight: 1.2, "background.enabled": false, "background.color": "#000000", "background.cornerRadius": 0, "background.paddingX": 30, "background.paddingY": 42,
      "background.offsetX": 0, "background.offsetY": 0, ...params,
    }, ...extra,
  }),
  sticker: (id: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "sticker", start, seconds, { stickerId: "emoji:1f600", intrinsicWidth: 128, intrinsicHeight: 128, params: { ...visual(), ...params }, ...extra }),
  graphic: (id: string, definitionId: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "graphic", start, seconds, { definitionId, params: { ...visual(), fill: "#ffffff", stroke: "#000000", strokeWidth: 0, strokeAlign: "center", ...params }, ...extra }),
  effect: (id: string, effectType: string, start = 0, seconds = 2, params: Json = {}, extra: Json = {}) => base(id, "effect", start, seconds, { effectType, params, ...extra }),
  track: (id: string, type: string, elements: Json[] = [], extra: Json = {}): Json => ({
    id, name: { video: "Video track", text: "Text track", audio: "Audio track", graphic: "Graphic track", effect: "Effect track" }[type], type, elements,
    ...(type !== "audio" ? { hidden: false } : {}), ...(type === "video" || type === "audio" ? { muted: false } : {}), ...extra,
  }),
  media: (): ClassicMediaRecord[] => [
    { id: "m-video", name: "clip.mp4", type: "video", size: 4_000_000, lastModified: 1_700_000_000_000, width: 1920, height: 1080, duration: 10, fps: 29.97, hasAudio: true },
    { id: "m-image", name: "photo.png", type: "image", size: 50_000, lastModified: 1_700_000_000_500, width: 800, height: 600, thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=" },
    { id: "m-audio", name: "song.mp3", type: "audio", size: 900_000, lastModified: 1_700_000_001_000, duration: 30.5 },
  ],
  /** A v31 project record. `tracks` gives the main track's elements, overlay tracks and audio tracks. */
  project(options: { main?: Json[]; overlay?: Json[]; audio?: Json[]; canvas?: { width: number; height: number }; background?: Json; bookmarks?: unknown[]; extra?: Json } = {}): Json {
    return {
      version: 31,
      metadata: { id: "classic-1", name: "Holiday cut", duration: 1_200_000, createdAt: ISO, updatedAt: ISO },
      settings: {
        fps: { numerator: 30, denominator: 1 }, canvasSize: options.canvas ?? { width: 1920, height: 1080 }, canvasSizeMode: "preset", lastCustomCanvasSize: null, originalCanvasSize: null,
        background: options.background ?? { type: "color", color: "#000000" },
      },
      currentSceneId: "scene-main",
      timelineViewState: { zoomLevel: 2, scrollLeft: 120, playheadTime: 240_000 },
      scenes: [{
        id: "scene-main", name: "Main scene", isMain: true, bookmarks: options.bookmarks ?? [], createdAt: ISO, updatedAt: ISO,
        tracks: { overlay: options.overlay ?? [], main: classic.track("track-main", "video", options.main ?? [], { name: "Main Track" }), audio: options.audio ?? [] },
      }],
      ...options.extra,
    };
  },
};

const INVERSE = Object.fromEntries(Object.entries(CLASSIC_PATH_RENAMES).map(([from, to]) => [to, from]));
/**
 * Test-only inverse projection: rebuilds the classic `params` map and the classic animation paths of an element from
 * its typed schema-32 fields, so that a migrated fixture can be compared with its source for every key §13 maps
 * without a value change.
 */
export function toClassicView(element: any): { params: Json; animationPaths: string[]; animations: Json } {
  const params: Json = {};
  if (element.transform) Object.assign(params, {
    "transform.positionX": element.transform.position.x, "transform.positionY": element.transform.position.y,
    "transform.scaleX": element.transform.scale.x * (element.flip?.horizontal ? -1 : 1), "transform.scaleY": element.transform.scale.y * (element.flip?.vertical ? -1 : 1),
    "transform.rotate": element.transform.rotation, opacity: element.opacity, blendMode: element.blendMode,
  });
  if (element.type === "video" || element.type === "audio") Object.assign(params, { volume: element.volume, muted: element.muted });
  if (element.type === "text") {
    Object.assign(params, { content: element.content, fontSize: element.fontSize, fontFamily: element.fontFamily, color: element.color, textAlign: element.textAlign, fontStyle: element.fontStyle, letterSpacing: element.letterSpacing, lineHeight: element.lineHeight });
    for (const name of CLASSIC_TEXT_BACKGROUND_KEYS) params[`background.${name}`] = element.background[name];
  }
  if (element.type === "graphic") Object.assign(params, element.params);
  if (element.type === "effect") Object.assign(params, element.effects[0].params);
  const animations: Json = {};
  for (const [path, channel] of Object.entries(element.animations ?? {})) {
    const classicPath = INVERSE[path] ?? (element.type === "effect" ? path.replace(/^effects\.[^.]+\./, "") : path);
    animations[classicPath] = channel;
  }
  return { params, animationPaths: Object.keys(animations).sort(), animations };
}
