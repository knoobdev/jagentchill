/** Pre-flight of an export (`export-share.Pre-flight validation`): the single table of items, their codes, waivers and remedies. */
import type { ExportErrorCode } from "./errors.ts";

export type Waiver = "allowMissingMedia" | "allowFontFallback" | "allowSlates" | "allowMissingResources";
export type PreflightRow = { id: string; code: ExportErrorCode; waiver: Waiver | null; remedies: string[] };
/** Every pre-flight item: one code each, at most one waiver. */
export const PREFLIGHT_TABLE: readonly PreflightRow[] = [
  { id: "empty", code: "export/empty", waiver: null, remedies: [] },
  { id: "range-too-short", code: "export/range-too-short", waiver: null, remedies: [] },
  { id: "media-missing", code: "media/unavailable", waiver: "allowMissingMedia", remedies: ["Locate media"] },
  { id: "proxy-only", code: "media/original-unavailable", waiver: null, remedies: ["Download originals", "Export on host"] },
  { id: "font-unavailable", code: "export/font-unavailable", waiver: "allowFontFallback", remedies: ["Replace font"] },
  { id: "device-font", code: "export/device-font", waiver: "allowFontFallback", remedies: ["Replace font", "Export on this device"] },
  { id: "matte-processing", code: "export/matte-unavailable", waiver: null, remedies: ["Wait for processing"] },
  { id: "derived-unavailable", code: "export/derived-unavailable", waiver: null, remedies: ["Run again", "Export on host"] },
  { id: "slates", code: "export/slates-present", waiver: "allowSlates", remedies: [] },
  { id: "resource-missing", code: "export/resource-missing", waiver: "allowMissingResources", remedies: [] },
  { id: "template-incomplete", code: "export/template-incomplete", waiver: null, remedies: [] },
  { id: "insufficient-space", code: "export/insufficient-space", waiver: null, remedies: ["Choose another location", "Export on host"] },
  { id: "not-writable", code: "export/write-failed", waiver: null, remedies: ["Choose another location"] },
  { id: "no-gpu", code: "export/no-gpu", waiver: null, remedies: ["Export on host"] },
  { id: "codec-unavailable", code: "export/codec-unavailable", waiver: null, remedies: ["Choose another codec"] },
];
const rowOf = (id: string) => PREFLIGHT_TABLE.find((row) => row.id === id)!;

type El = { id: string; name?: string; type: string; startTime: number; duration: number; mediaId?: string; fontFamily?: string; hidden?: boolean; [key: string]: unknown };
type Track = { id: string; type: string; elements: El[]; hidden?: boolean; muted?: boolean };
type Scene = { id: string; tracks: { overlay: Track[]; main: Track; audio: Track[] } };
export type PreflightDocument = {
  scenes: Scene[];
  media: { assets: { id: string; name: string; kind?: string | null; type?: string }[] };
  template?: { slots?: { slotId: string; elementId: string; required?: boolean; filled?: boolean; label?: string }[] } | undefined;
};
export type PreflightInput = {
  document: PreflightDocument; sceneId: string; range: { start: number; end: number }; frameTicks: number; target: "device" | "host"; platform: "web" | "desktop" | "mobile";
  /** `ready`, `missing` (absent), `undrawable` (the file is here but this device cannot decode it — its picture, or its sound for a sound clip) or `proxy-only`, per asset. */
  mediaState?(assetId: string): "ready" | "missing" | "undrawable" | "proxy-only";
  /** The SOUND of a video on this device: `undecodable` when the file is here and its sound track cannot be decoded (its picture may be fine). */
  soundState?(assetId: string): "ok" | "undecodable";
  /** `ok`, `unavailable` (cannot be loaded) or `device` (a non-portable device font). */
  fontState?(family: string): "ok" | "unavailable" | "device";
  matteProcessing?(elementId: string): boolean; derivedFailed?(elementId: string): boolean; resourceMissing?(element: El): string | null;
  backend?: "webgpu" | "webgl2" | "none"; codecAvailable?: boolean; codecAlternatives?: string[];
  estimateBytes?: number | null; freeBytes?: number | null; writable?: boolean;
  waivers?: Partial<Record<Waiver, boolean>>;
};
export type PreflightItem = {
  id: string; code: ExportErrorCode; message: string; values?: Record<string, string | number>; elementIds: string[]; names: string[]; waiver: Waiver | null; waived: boolean; remedies: string[];
  details?: Record<string, unknown>;
};
export type PreflightResult = { items: PreflightItem[]; blocking: PreflightItem[]; waivable: PreflightItem[]; ok: boolean };

const tracksOf = (scene: Scene): Track[] => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio];
const inRange = (element: El, range: { start: number; end: number }) => element.startTime < range.end && element.startTime + element.duration > range.start;
const gigabytes = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;

/**
 * What the check is told of an asset on this device: `missing` when its file is not here; `undrawable` when the file is
 * here and the device found it cannot decode it (`canDecode === false` in the document's device-local section — set by
 * an import and, for media that arrived by sync, by the library when the file arrives) — a picture, a sound, or a video
 * that no finished proxy stands in for; `ready` otherwise (also while nothing is known yet).
 */
export function deviceMediaState(asset: { type: string }, local: { canDecode?: boolean | null; proxy?: { state?: string } } | undefined, onDevice: boolean): "ready" | "missing" | "undrawable" {
  if (!onDevice) return "missing";
  return local?.canDecode === false && !(asset.type === "video" && local.proxy?.state === "succeeded") ? "undrawable" : "ready";
}

/** The sound of a video as this device learnt it (`session.ts learnDecodable`, the import): a track that is there and cannot be decoded here. */
export function deviceSoundState(asset: { type?: string; hasAudio?: boolean }, local: { canDecodeSound?: boolean | null } | undefined): "ok" | "undecodable" {
  return asset.type === "video" && asset.hasAudio !== false && local?.canDecodeSound === false ? "undecodable" : "ok";
}
/**
 * The media "Export anyway" waives: the assets of the clips the pre-flight NAMED under the missing-media waiver — what
 * the person was shown. They go to the engine with the export; any other media that turns out to be missing or
 * undecodable still fails it by name.
 */
export function waivedMediaAssets(result: PreflightResult | null, document: PreflightDocument): string[] {
  if (!result) return [];
  const named = new Set(result.items.filter((item) => item.waiver === "allowMissingMedia").flatMap((item) => item.elementIds));
  const media = document.scenes.flatMap((scene) => tracksOf(scene)).flatMap((track) => track.elements).filter((element) => named.has(element.id) && typeof element.mediaId === "string").map((element) => element.mediaId!);
  return [...new Set(media)];
}

/**
 * Runs every check of the table over the export range. An item the caller waived is kept in the list as `waived` (it
 * is recorded in the export summary) and does not block; `ok` is true when nothing blocks.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  const scene = input.document.scenes.find((candidate) => candidate.id === input.sceneId) ?? input.document.scenes[0];
  const elements = scene ? tracksOf(scene).flatMap((track) => track.elements).filter((element) => inRange(element, input.range)) : [];
  const items: PreflightItem[] = [];
  const add = (id: string, message: string, picked: El[], extra: { values?: Record<string, string | number>; remedies?: string[]; details?: Record<string, unknown>; /** The table row of an item that is a case of another one. */ row?: string; names?: string[] } = {}) => {
    const row = rowOf(extra.row ?? id), waived = row.waiver !== null && input.waivers?.[row.waiver] === true;
    items.push({ id, code: row.code, message, values: extra.values, elementIds: picked.map((element) => element.id), names: extra.names ?? picked.map((element) => element.name ?? element.id), waiver: row.waiver, waived, remedies: extra.remedies ?? row.remedies, details: extra.details });
  };
  if (elements.length === 0) add("empty", "Project is empty", []);
  else if (input.range.end - input.range.start < input.frameTicks) add("range-too-short", "The range is shorter than one frame", []);
  const withMedia = elements.filter((element) => typeof element.mediaId === "string");
  const state = input.mediaState ?? (() => "ready" as const);
  // A case of the table's "media-missing" row (same code, same waiver), said in its own words.
  // A clip that must show a picture but whose media has none (a sound placed as a video) or cannot be decoded here:
  // the render would stop at its first frame, so it is named before the export starts.
  const typeOf = new Map(input.document.media.assets.map((asset) => [asset.id, asset.type])), nameOf = new Map(input.document.media.assets.map((asset) => [asset.id, asset.name]));
  // A media clip is known to a person by its file's name — what the timeline writes on it — rather than by the name the
  // element was given when it was made ("Clip 2" of a template whose media was replaced).
  const byFile = (picked: El[]) => picked.map((element) => nameOf.get(element.mediaId!) || element.name || element.id);
  // A sound clip whose file this device cannot decode would be left out of the film: it is named in its own words.
  // So would the sound of a video whose picture is fine and whose sound track is not (an AC-3 track) — unless the clip is silent anyway.
  const soundOf = input.soundState ?? (() => "ok" as const);
  const soundless = withMedia.filter((element) => (element.type === "audio" && state(element.mediaId!) === "undrawable")
    || (element.type === "video" && element.muted !== true && element.isSourceAudioEnabled !== false && state(element.mediaId!) === "ready" && soundOf(element.mediaId!) === "undecodable"));
  if (soundless.length > 0) add("media-undecodable-sound", soundless.length === 1 ? "1 sound cannot be decoded on this device" : "{n} sounds cannot be decoded on this device", soundless, { values: { n: soundless.length }, row: "media-missing", remedies: ["Replace media"], names: byFile(soundless) });
  const undrawable = withMedia.filter((element) => !soundless.includes(element) && (state(element.mediaId!) === "undrawable" || ((element.type === "video" || element.type === "image") && typeOf.get(element.mediaId!) === "audio")));
  if (undrawable.length > 0) add("media-undrawable", undrawable.length === 1 ? "1 clip uses media that cannot be drawn" : "{n} clips use media that cannot be drawn", undrawable, { values: { n: undrawable.length }, row: "media-missing", remedies: ["Replace media"], names: byFile(undrawable) });
  const missing = withMedia.filter((element) => state(element.mediaId!) === "missing" && !undrawable.includes(element) && !soundless.includes(element));
  if (missing.length > 0) add("media-missing", missing.length === 1 ? "1 clip uses a missing media file" : "{n} clips use missing media files", missing, { values: { n: missing.length }, names: byFile(missing) });
  const proxies = withMedia.filter((element) => state(element.mediaId!) === "proxy-only");
  if (proxies.length > 0 && input.target === "device") add("proxy-only", proxies.length === 1 ? "1 clip has only a proxy on this device" : "{n} clips have only a proxy on this device", proxies, { values: { n: proxies.length } });
  const texts = elements.filter((element) => (element.type === "text" || element.type === "caption") && typeof element.fontFamily === "string");
  const fontState = input.fontState ?? (() => "ok" as const);
  const families = (picked: El[]) => [...new Set(picked.map((element) => element.fontFamily!))].join(", ");
  const unloadable = texts.filter((element) => fontState(element.fontFamily!) === "unavailable");
  if (unloadable.length > 0) add("font-unavailable", "{n} text elements use a font that cannot be loaded: {families}", unloadable, { values: { n: unloadable.length, families: families(unloadable) }, details: { families: [...new Set(unloadable.map((element) => element.fontFamily!))] } });
  const deviceFonts = texts.filter((element) => fontState(element.fontFamily!) === "device");
  if (deviceFonts.length > 0 && input.target === "host") add("device-font", "{n} text elements use a font of this device: {families}", deviceFonts, { values: { n: deviceFonts.length, families: families(deviceFonts) } });
  const mattes = elements.filter((element) => input.matteProcessing?.(element.id));
  if (mattes.length > 0) add("matte-processing", "{n} clips are still being processed", mattes, { values: { n: mattes.length } });
  const derived = elements.filter((element) => input.derivedFailed?.(element.id));
  if (derived.length > 0) add("derived-unavailable", "{n} clips need a result that is not available", derived, { values: { n: derived.length } });
  const slateIds = new Set(input.document.media.assets.filter((asset) => asset.kind === "slate").map((asset) => asset.id));
  const slates = withMedia.filter((element) => slateIds.has(element.mediaId!));
  if (slates.length > 0) add("slates", "{n} placeholder shots are still in the timeline", slates, { values: { n: slates.length } });
  const resources = elements.map((element) => ({ element, name: input.resourceMissing?.(element) ?? null })).filter((entry) => entry.name !== null);
  if (resources.length > 0) add("resource-missing", "{n} resources are missing: {names}", resources.map((entry) => entry.element), { values: { n: resources.length, names: [...new Set(resources.map((entry) => entry.name!))].join(", ") } });
  // Only a required slot blocks; an empty optional slot renders as the template defines.
  const emptySlots = (input.document.template?.slots ?? []).filter((slot) => slot.required !== false && slot.filled !== true);
  if (emptySlots.length > 0) add("template-incomplete", "{n} required template slots are empty: {names}", [], { values: { n: emptySlots.length, names: emptySlots.map((slot) => slot.label || slot.slotId).join(", ") }, details: { slotIds: emptySlots.map((slot) => slot.slotId) } });
  if (input.estimateBytes != null && input.freeBytes != null) {
    // On a phone the output exists twice during the copy-out.
    const needed = input.estimateBytes * (input.platform === "mobile" && input.target === "device" ? 2 : 1);
    if (input.freeBytes < needed) add("insufficient-space", "Not enough free space: {needed} is needed", [], { values: { needed: gigabytes(needed) }, details: { neededBytes: needed, freeBytes: input.freeBytes } });
  }
  if (input.writable === false) add("not-writable", "The destination is not writable", []);
  if (input.backend === "none" && input.target === "device") add("no-gpu", "This device has no GPU backend", []);
  if (input.codecAvailable === false) add("codec-unavailable", "The codec has no encoder on this target", [], { details: { available: input.codecAlternatives ?? [] } });
  const blocking = items.filter((item) => !item.waived);
  return { items, blocking, waivable: blocking.filter((item) => item.waiver !== null), ok: blocking.length === 0 };
}
/** The waivers that "Export anyway" grants: every waivable item of the result; `null` when an item with no waiver remains. */
export function exportAnyway(result: PreflightResult): Partial<Record<Waiver, boolean>> | null {
  if (result.blocking.some((item) => item.waiver === null)) return null;
  return Object.fromEntries(result.blocking.map((item) => [item.waiver!, true]));
}
/** The failure of a host-initiated job from its pre-flight: the first blocking item's code, every item in `details.items`. */
export function preflightFailure(result: PreflightResult): { code: ExportErrorCode; message: string; details: { items: { code: ExportErrorCode; elementIds: string[]; message: string }[] } } | null {
  if (result.ok) return null;
  return { code: result.blocking[0].code, message: result.blocking[0].message, details: { items: result.blocking.map((item) => ({ code: item.code, elementIds: item.elementIds, message: item.message })) } };
}
