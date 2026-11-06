import {
  animatablePath, BLEND_MODES, codePoints, GRAPHIC_PARAM_KEYS, MASK_PARAM_KEYS, MASK_TYPES, type GraphicDefinitionId, type MaskType,
  type ProjectDocument, type Rational,
} from "@jagentchill/protocol";
import { roundStored } from "../canonical.ts";
import { DocumentRejected, type DocumentError } from "../errors.ts";
import { asArray, clone, isObject, type Json } from "../model.ts";
import { compareIds } from "../patch.ts";
import type { Registries } from "../registries.ts";
import { fpsToRational, frameTicks, reduceRational, roundHalfAway, secondsToTicks, snapToFrame, ticksToNearestFrame } from "../time.ts";
import { validateProjectDocument } from "../validate.ts";

/** One line of the migration report: a classic value that was dropped, replaced or rescaled, and why. */
export type MigrationReportEntry = { path: string; classicKey: string; reason: string; detail?: unknown };
/** Reasons that mean "a value of the original project has no equivalent and was not migrated". */
const DROPPED = new Set(["unregistered", "no-animation-path", "removed-element", "unknown-mask-type", "key-outside-element", "not-carried"]);
/** How many items the notice "{n} items from the original project have no equivalent and were not migrated" counts. */
export const droppedCount = (report: MigrationReportEntry[]): number => report.filter((entry) => DROPPED.has(entry.reason)).length;

/** A classic media-metadata record (`MediaAssetData`), joined to its project. */
export type ClassicMediaRecord = { id: string; name: string; type: "image" | "video" | "audio"; size: number; lastModified?: number; width?: number; height?: number; duration?: number; fps?: number; hasAudio?: boolean; ephemeral?: boolean; thumbnailUrl?: string };
export type MigratedThumbnail = { owner: "project" | "asset"; id: string; dataUrl: string };
export type V32Migration = { document: ProjectDocument; report: MigrationReportEntry[]; thumbnails: MigratedThumbnail[] };
export type V32Options = { now_ms: number; newId: () => string; registries?: Registries };

/** Classic default track names: a track that still carries one was never renamed by the user. */
export const CLASSIC_TRACK_NAMES: Record<string, string> = { video: "Video track", text: "Text track", audio: "Audio track", graphic: "Graphic track", effect: "Effect track" };
const VISUAL = new Set(["video", "image", "text", "sticker", "graphic"]);
export const CLASSIC_VISUAL_PARAM_KEYS = ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate", "opacity", "blendMode"];
export const CLASSIC_TEXT_PARAM_KEYS = ["content", "fontFamily", "fontSize", "color", "textAlign", "fontWeight", "fontStyle", "textDecoration", "letterSpacing", "lineHeight"];
export const CLASSIC_TEXT_BACKGROUND_KEYS = ["enabled", "color", "cornerRadius", "paddingX", "paddingY", "offsetX", "offsetY"];
export const CLASSIC_PATH_RENAMES: Record<string, string> = {
  "transform.positionX": "transform.position.x", "transform.positionY": "transform.position.y", "transform.scaleX": "transform.scale.x",
  "transform.scaleY": "transform.scale.y", "transform.rotate": "transform.rotation",
};

const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ticks = (value: unknown, fallback = 0): number => (num(value) ? Math.max(0, roundHalfAway(value)) : fallback);
const cut = (value: unknown, max: number, fallback: string): string => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? fallback : codePoints(trimmed) > max ? [...trimmed].slice(0, max).join("") : trimmed;
};
const toMs = (value: unknown, now: number): number => {
  const parsed = typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : now;
};
const HEX = /^#[0-9a-fA-F]{6}$/, HEX_ANY = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const evenSide = (value: unknown, fallback: number): number => Math.min(7680, Math.max(16, num(value) ? Math.round(value / 2) * 2 : fallback));
const canvas = (value: unknown, fallback: { width: number; height: number } | null) => (isObject(value) ? { width: evenSide(value.width, 1920), height: evenSide(value.height, 1080) } : fallback);

/**
 * The classic-canvas factor `k` that multiplies classic blur values (classic scaled blur per axis by `width / 1920`
 * and `height / 1080`; schema 32 scales both axes by `max(width, height) / 1920`).
 *
 * The catalogue (§13.1) gives a formula and three values that do not agree: the formula
 * `sqrt((w / 1920) × (h / 1080)) / (max(w, h) / 1920)` yields 1.333 on 1080 × 1080 and 1 on 1080 × 1920, while the
 * same row and the scenario "Blur intensity rescaled on a square canvas" state 0.5625 and 0.316 (40 → 23). The stated
 * values are what the requirement's scenario fixes, and they are exactly `(w / 1920) / (h / 1080)`, which is also 1 on
 * every 16:9 canvas; that is what this returns.
 */
export function classicCanvasFactor(size: { width: number; height: number }): number {
  return (size.width / 1920) / (size.height / 1080);
}

export function fontWeightOf(value: unknown): number {
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return parsed >= 100 && parsed <= 900 ? Math.min(900, Math.max(100, Math.round(parsed / 100) * 100)) : 400;
}

type Run = { report: MigrationReportEntry[]; options: V32Options; k: number; fps: Rational; thumbnails: MigratedThumbnail[]; libraryAssets: Map<string, Json> };
const note = (run: Run, path: string, classicKey: string, reason: string, detail?: unknown) => { run.report.push({ path, classicKey, reason, ...(detail !== undefined ? { detail } : {}) }); };
/**
 * Classic kept timeline times as integer ticks but not on the project frame grid (a clip's length is its file's length).
 * The target of the mapping is a strictly valid document, whose timeline times lie on the grid, so a timeline time is
 * moved to the nearest frame (ties away from zero) and the move is reported. Source-domain times are not touched.
 */
function onGrid(run: Run, value: number, path: string, key: string): number {
  const snapped = snapToFrame(value, run.fps);
  if (snapped !== value) note(run, path, key, "snapped-to-frame", { from: value, to: snapped });
  return snapped;
}
function clampTo(run: Run, value: number, min: number, max: number, path: string, key: string): number {
  if (value >= min && value <= max) return value;
  note(run, path, key, "clamped", { from: value, to: Math.min(max, Math.max(min, value)) });
  return Math.min(max, Math.max(min, value));
}

function background(run: Run, value: unknown): Json {
  if (isObject(value) && value.type === "blur") {
    const stored = num(value.blurIntensity) ? value.blurIntensity : 200;
    const scaled = Math.min(1000, Math.max(0, roundHalfAway(stored * run.k)));
    if (run.k !== 1) note(run, "/settings/background/blurIntensity", "blurIntensity", "rescaled", { from: stored, to: scaled, k: roundStored(run.k) });
    return { kind: "blur", blurIntensity: scaled };
  }
  const color = isObject(value) && typeof value.color === "string" ? value.color.trim() : "#000000";
  if (color.toLowerCase() === "transparent") return { kind: "transparent" };
  if (color.startsWith("#")) return { kind: "color", color: HEX_ANY.test(color) ? color.slice(0, 7).toLowerCase() : "#000000" };
  // A gradient string is copied unchanged.
  return { kind: "gradient", css: color };
}

function scalarChannel(source: Json, duration: number, run: Run, path: string, scale = 1): Json | null {
  const keys = asArray(source.keys).filter(isObject).map((key) => {
    const out: Json = { id: String(key.id), time: onGrid(run, ticks(key.time), path, `key:${String(key.id)}`), value: typeof key.value === "number" && scale !== 1 ? roundHalfAway(key.value * scale) : key.value };
    if (typeof key.value === "number") {
      out.segmentToNext = typeof key.segmentToNext === "string" ? key.segmentToNext : "linear";
      out.tangentMode = typeof key.tangentMode === "string" ? key.tangentMode : "auto";
      for (const handle of ["leftHandle", "rightHandle"]) if (isObject(key[handle])) out[handle] = { dt: roundHalfAway(Number((key[handle] as Json).dt) || 0), dv: Number((key[handle] as Json).dv) || 0 };
    }
    return out;
  }).filter((key) => {
    const inside = (key.time as number) <= duration;
    if (!inside) note(run, path, String(key.id), "key-outside-element");
    return inside;
  }).sort((a, b) => (a.time as number) - (b.time as number));
  if (keys.length === 0) return null;
  const numeric = typeof keys[0].value === "number";
  return numeric ? { keys, extrapolation: { before: "hold", after: "hold", ...(isObject(source.extrapolation) ? source.extrapolation : {}) } } : { keys };
}

function channel(source: unknown, duration: number, run: Run, path: string, scale = 1): Json | null {
  if (!isObject(source)) return null;
  if (Array.isArray(source.keys)) return scalarChannel(source, duration, run, path, scale);
  // A composite channel: colour components `{r, g, b, a}`.
  if (["r", "g", "b", "a"].every((part) => isObject(source[part]))) {
    const parts = Object.fromEntries(["r", "g", "b", "a"].map((part) => [part, scalarChannel(source[part] as Json, duration, run, path)]));
    return Object.values(parts).every((part) => part !== null) ? parts : null;
  }
  return null;
}

function masksOf(run: Run, element: Json, path: string): Json[] {
  const source = Array.isArray(element.masks) ? element.masks : isObject(element.mask) ? [element.mask] : [];
  const out: Json[] = [];
  for (const mask of source.filter(isObject)) {
    const type = String(mask.type) as MaskType;
    if (!(MASK_TYPES as readonly string[]).includes(type)) { note(run, `${path}/masks/@${String(mask.id)}`, "mask.type", "unknown-mask-type", mask.type); continue; }
    const params: Json = {};
    for (const [key, value] of Object.entries(isObject(mask.params) ? mask.params : {})) {
      if ((MASK_PARAM_KEYS[type] as string[]).includes(key)) params[key] = value;
      else note(run, `${path}/masks/@${String(mask.id)}/params/${key}`, key, "unregistered");
    }
    params.opacity = 100;
    if (type === "rectangle") params.cornerRadius = 0;
    if (type === "star") Object.assign(params, { points: 5, innerRatio: 0.45 });
    out.push({ id: String(mask.id), type, enabled: true, combine: "add", params });
  }
  return out;
}

function convertElement(run: Run, source: Json, trackPath: string): Json | null {
  const type = String(source.type), path = `${trackPath}/elements/@${String(source.id)}`;
  const P = isObject(source.params) ? source.params : {};
  const top = source;
  // Both edges are snapped, so two clips that met at one tick still meet after the move.
  const startTime = onGrid(run, ticks(source.startTime), path, "startTime");
  const stored = Math.max(1, ticks(source.duration, 1));
  const duration = Math.max(frameTicks(run.fps), snapToFrame(ticks(source.startTime) + stored, run.fps) - startTime);
  if (duration !== stored) note(run, path, "duration", "snapped-to-frame", { from: stored, to: duration });
  const out: Json = {
    id: String(source.id), type, name: cut(source.name, 200, type), startTime, duration,
    trimStart: ticks(source.trimStart), trimEnd: ticks(source.trimEnd), groupId: null, linkId: null,
  };
  const hasSource = type === "video" || type === "audio";
  if (hasSource && num(source.sourceDuration)) out.sourceDuration = ticks(source.sourceDuration);
  if (!hasSource) {
    if (source.sourceDuration !== undefined) note(run, path, "sourceDuration", "not-carried");
    out.trimStart = 0; out.trimEnd = 0;
  }
  if (type !== "audio") out.hidden = source.hidden === true;
  if (type === "video" || type === "image" || type === "audio") { out.transitionIn = null; out.transitionOut = null; }
  const used = new Set<string>();
  const read = (key: string, stale: unknown, fallback: unknown): unknown => { used.add(key); return P[key] !== undefined ? P[key] : stale !== undefined ? stale : fallback; };
  const number = (key: string, stale: unknown, fallback: number, min: number, max: number, field: string) => {
    const value = read(key, stale, fallback);
    return clampTo(run, num(value) ? value : fallback, min, max, `${path}/${field}`, key);
  };

  const animations: Json = {};
  const classicAnimations = isObject(source.animations) ? source.animations : {};
  const channelOn = (classicPath: string) => (isObject(classicAnimations[classicPath]) ? classicAnimations[classicPath] as Json : undefined);
  let effectId: string | undefined;

  if (VISUAL.has(type)) {
    const stale = isObject(top.transform) ? top.transform : {};
    const position = isObject(stale.position) ? stale.position : {};
    const flip = { horizontal: false, vertical: false };
    const scale = { x: 1, y: 1 };
    for (const [axis, key, flag] of [["x", "transform.scaleX", "horizontal"], ["y", "transform.scaleY", "vertical"]] as const) {
      const raw = read(key, stale[key.slice(10)], 1);
      let value = num(raw) && raw !== 0 ? raw : 1;
      const animated = channelOn(key);
      const keys = asArray(animated?.keys).filter(isObject);
      if (keys.length > 0) {
        // An all-negative channel is a mirrored clip: every key is negated and the flag set. Mixed signs stay as they are.
        if (keys.every((entry) => num(entry.value) && entry.value < 0)) {
          for (const entry of keys) entry.value = -(entry.value as number);
          flip[flag] = true;
        }
        value = Math.abs(value);
      } else if (value < 0) { value = -value; flip[flag] = true; }
      scale[axis] = clampTo(run, value, 0.01, 100, `${path}/transform/scale/${axis}`, key);
    }
    out.transform = {
      position: { x: number("transform.positionX", position.x, 0, -100_000, 100_000, "transform/position/x"), y: number("transform.positionY", position.y, 0, -100_000, 100_000, "transform/position/y") },
      scale, rotation: number("transform.rotate", stale.rotate, 0, -3600, 3600, "transform/rotation"),
    };
    out.opacity = number("opacity", top.opacity, 1, 0, 1, "opacity");
    const blend = read("blendMode", top.blendMode, "normal");
    out.blendMode = (BLEND_MODES as readonly unknown[]).includes(blend) ? blend : "normal";
    out.flip = flip;
    if (type === "video" || type === "image") out.crop = { left: 0, top: 0, right: 0, bottom: 0 };
    out.effects = asArray(source.effects).filter(isObject).map((entry) => {
      const params = { ...(isObject(entry.params) ? entry.params : {}) };
      if (entry.type === "blur" && run.k !== 1 && num(params.intensity)) {
        const scaled = Math.min(100, Math.max(0, roundHalfAway(params.intensity * run.k)));
        note(run, `${path}/effects/@${String(entry.id)}/params/intensity`, "intensity", "rescaled", { from: params.intensity, to: scaled, k: roundStored(run.k) });
        params.intensity = scaled;
      }
      return { id: String(entry.id), type: String(entry.type), kind: "effect", enabled: entry.enabled !== false, params };
    });
  }
  if (type === "video" || type === "audio") {
    const volume = read("volume", top.volume, 0);
    out.volume = Math.min(20, Math.max(-60, num(volume) ? volume : 0));
    out.muted = read("muted", top.muted, false) === true;
    const retime = source.retime as Json | undefined;
    if (isObject(retime) && num(retime.rate) && retime.rate !== 1) out.retime = { rate: retime.rate, maintainPitch: retime.maintainPitch === true, reverse: false, smooth: "none" };
  }
  if (type === "video") { out.mediaId = source.mediaId; out.isSourceAudioEnabled = source.isSourceAudioEnabled !== false; }
  if (type === "image") out.mediaId = source.mediaId;
  if (type === "audio") {
    if (source.sourceType === "library") {
      const url = String(source.sourceUrl ?? "");
      let asset = run.libraryAssets.get(url);
      if (!asset) {
        // The bytes are fetched on first load; until then the element is offline.
        asset = { id: run.options.newId(), name: cut(source.name, 255, "Sound"), type: "audio", kind: null, size: 0, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "url", url, attributionRequired: false, referenceAssetIds: [] }, motionTracks: [], faces: [], created_ms: run.options.now_ms };
        run.libraryAssets.set(url, asset);
      }
      Object.assign(out, { sourceType: "library", mediaId: asset.id, sourceUrl: url });
    } else Object.assign(out, { sourceType: "upload", mediaId: source.mediaId });
  }
  if (type === "text") {
    const stale = isObject(top.background) ? top.background : {};
    const textNumber = (key: string, fallback: number, min: number, max: number) => { const value = read(key, top[key], fallback); return Math.min(max, Math.max(min, num(value) ? value : fallback)); };
    const color = read("color", top.color, "#ffffff");
    const decoration = read("textDecoration", top.textDecoration, "none");
    const align = read("textAlign", top.textAlign, "center"), style = read("fontStyle", top.fontStyle, "normal"), family = read("fontFamily", top.fontFamily, "Arial");
    const backgroundColor = read("background.color", stale.color, "#000000");
    const transparent = typeof backgroundColor === "string" && backgroundColor.toLowerCase() === "transparent";
    const backgroundEnabled = read("background.enabled", stale.enabled, false) === true;
    const bg = (key: string, fallback: number, min: number, max: number) => { const value = read(`background.${key}`, stale[key], fallback); return Math.min(max, Math.max(min, num(value) ? value : fallback)); };
    Object.assign(out, {
      content: String(read("content", top.content, "Default text")),
      fontFamily: typeof family === "string" && family.length > 0 ? family : "Arial",
      fontSize: textNumber("fontSize", 15, 1, 500),
      fontWeight: fontWeightOf(read("fontWeight", top.fontWeight, "400")),
      fontStyle: style === "italic" ? "italic" : "normal",
      underline: decoration === "underline", strikethrough: decoration === "line-through", textCase: "none",
      color: typeof color === "string" && HEX_ANY.test(color) ? color.toLowerCase() : "#ffffff",
      fill: { type: "solid", gradientColor: "#ffd400", gradientAngle: 90 },
      textAlign: ["left", "center", "right", "justify"].includes(String(align)) ? align : "center",
      letterSpacing: textNumber("letterSpacing", 0, -100, 500), lineHeight: textNumber("lineHeight", 1.2, 0.1, 10),
      box: { mode: "auto", width: 80 }, curve: 0,
      background: {
        enabled: backgroundEnabled && !transparent,
        color: !transparent && typeof backgroundColor === "string" && HEX_ANY.test(backgroundColor) ? backgroundColor.toLowerCase() : "#000000",
        cornerRadius: bg("cornerRadius", 0, 0, 100), paddingX: bg("paddingX", 30, 0, 1000), paddingY: bg("paddingY", 42, 0, 1000),
        offsetX: bg("offsetX", 0, -100_000, 100_000), offsetY: bg("offsetY", 0, -100_000, 100_000),
      },
      stroke: { enabled: false, color: "#000000", width: 6, position: "outside" },
      shadow: { enabled: false, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 },
      glow: { enabled: false, color: "#ffffff", intensity: 50, radius: 20 },
    });
  }
  if (type === "sticker") Object.assign(out, { stickerId: source.stickerId, intrinsicWidth: num(source.intrinsicWidth) && source.intrinsicWidth > 0 ? source.intrinsicWidth : 200, intrinsicHeight: num(source.intrinsicHeight) && source.intrinsicHeight > 0 ? source.intrinsicHeight : 200, loop: true, playbackSpeed: 1 });
  if (type === "graphic") {
    out.definitionId = source.definitionId;
    const declared = GRAPHIC_PARAM_KEYS[source.definitionId as GraphicDefinitionId] as string[] | undefined;
    // An unknown definition makes the element invalid; load repair drops it and the report lists it.
    out.params = Object.fromEntries(Object.entries(P).filter(([key]) => declared?.includes(key)));
    for (const key of declared ?? Object.keys(P)) used.add(key);
  }
  if (type === "effect") {
    effectId = run.options.newId();
    const params = { ...P };
    if (source.effectType === "blur" && run.k !== 1 && num(params.intensity)) {
      const scaled = Math.min(100, Math.max(0, roundHalfAway(params.intensity * run.k)));
      note(run, `${path}/effects/@${effectId}/params/intensity`, "intensity", "rescaled", { from: params.intensity, to: scaled, k: roundStored(run.k) });
      params.intensity = scaled;
    }
    out.effects = [{ id: effectId, type: String(source.effectType), kind: "effect", enabled: true, params }];
    out.target = "beneath";
    for (const key of Object.keys(P)) used.add(key);
  }
  if (type === "video" || type === "image" || type === "sticker" || type === "graphic") out.masks = masksOf(run, source, path);
  for (const key of Object.keys(P)) if (!used.has(key)) note(run, path, key, "unregistered");

  for (const [classicPath, data] of Object.entries(classicAnimations)) {
    // `bindings` and `channels` are leftovers of the v29→v30 step, not animation paths.
    if (classicPath === "bindings" || classicPath === "channels") continue;
    const parts = classicPath.split(".");
    const renamed = CLASSIC_PATH_RENAMES[classicPath] ?? (type === "effect" && parts[0] === "params" ? `effects.${effectId}.params.${parts.slice(1).join(".")}` : classicPath);
    const effectType = parts[0] === "effects" ? asArray(source.effects).filter(isObject).find((entry) => entry.id === parts[1])?.type : type === "effect" ? source.effectType : undefined;
    const blur = effectType === "blur" && renamed.endsWith(".params.intensity") && run.k !== 1 ? run.k : 1;
    const converted = animatablePath(out as never, renamed) ? channel(data, duration, run, `${path}/animations/${renamed}`, blur) : null;
    if (converted) animations[renamed] = converted;
    else note(run, `${path}/animations/${classicPath}`, classicPath, "no-animation-path");
  }
  if (Object.keys(animations).length > 0) out.animations = animations;
  return out;
}

function convertTrack(run: Run, source: Json, path: string, zone: string): Json {
  const type = String(source.type);
  const name = cut(source.name, 80, CLASSIC_TRACK_NAMES[type] ?? "Track");
  const elements = asArray(source.elements).filter(isObject).map((element) => convertElement(run, element, path)).filter((element): element is Json => element !== null);
  elements.sort((a, b) => (a.startTime as number) - (b.startTime as number) || compareIds(String(a.id), String(b.id)));
  const out: Json = { id: String(source.id), name, type, locked: false, pinned: zone !== "main" && name !== CLASSIC_TRACK_NAMES[type], transitions: [], elements };
  if (type !== "audio") out.hidden = source.hidden === true;
  if (type === "video" || type === "audio") Object.assign(out, { muted: source.muted === true, solo: false, volume: 0, pan: 0 });
  if (type === "audio") out.ducking = { enabled: false, amount: 12, attack: 200, release: 500 };
  return out;
}

function convertScene(run: Run, source: Json): Json {
  const path = `/scenes/@${String(source.id)}`;
  const tracks = isObject(source.tracks) ? source.tracks : {};
  const frames = new Set<number>();
  const markers = asArray(source.bookmarks).map((entry) => (typeof entry === "number" ? { time: entry } : entry)).filter(isObject)
    .map((entry) => ({ entry, time: onGrid(run, ticks(entry.time), `${path}/markers`, "time") })).sort((a, b) => a.time - b.time)
    .filter(({ time }) => { const frame = ticksToNearestFrame(time, run.fps); if (frames.has(frame)) return false; frames.add(frame); return true; })
    .map(({ entry, time }) => ({
      id: run.options.newId(), time,
      ...(typeof entry.note === "string" ? { note: cut(entry.note, 2000, "") } : {}),
      color: typeof entry.color === "string" && HEX.test(entry.color) ? entry.color.toLowerCase() : 1,
      ...(num(entry.duration) && entry.duration >= 1 ? { duration: Math.max(frameTicks(run.fps), snapToFrame(ticks(entry.duration), run.fps)) } : {}),
    }));
  return {
    id: String(source.id), name: cut(source.name, 80, "Scene"), isMain: source.isMain === true, kind: "timeline", compoundBackground: "none",
    tracks: {
      overlay: asArray(tracks.overlay).filter(isObject).map((track) => convertTrack(run, track, `${path}/tracks/overlay/@${String(track.id)}`, "overlay")),
      main: isObject(tracks.main) ? convertTrack(run, tracks.main, `${path}/tracks/main`, "main") : undefined,
      audio: asArray(tracks.audio).filter(isObject).map((track) => convertTrack(run, track, `${path}/tracks/audio/@${String(track.id)}`, "audio")),
    },
    markers, created_ms: toMs(source.createdAt, run.options.now_ms), updated_ms: toMs(source.updatedAt, run.options.now_ms),
  };
}

function convertAsset(run: Run, record: ClassicMediaRecord): { asset: Json; local: Json } {
  if (typeof record.thumbnailUrl === "string" && record.thumbnailUrl.startsWith("data:")) run.thumbnails.push({ owner: "asset", id: record.id, dataUrl: record.thumbnailUrl });
  const asset: Json = { id: record.id, name: cut(record.name, 255, record.id), type: record.type, kind: null, size: num(record.size) ? Math.max(0, Math.round(record.size)) : 0 };
  if (num(record.lastModified)) asset.lastModified_ms = Math.max(0, Math.round(record.lastModified));
  asset.contentHash = null;
  for (const side of ["width", "height"] as const) if (num(record[side]) && record[side]! > 0) asset[side] = Math.round(record[side]!);
  if (num(record.duration) && record.type !== "image") asset.duration = secondsToTicks(record.duration);
  if (num(record.fps) && record.fps > 0 && record.type === "video") asset.fps = fpsToRational(record.fps);
  if (typeof record.hasAudio === "boolean") asset.hasAudio = record.hasAudio;
  Object.assign(asset, { rotation: 0, folderId: null, tags: [], ephemeral: record.ephemeral === true, provenance: { source: "imported", attributionRequired: false, referenceAssetIds: [] }, motionTracks: [], faces: [], created_ms: run.options.now_ms });
  // Codecs, container and rotation are never known for a classic record, so the first load probes it once.
  return { asset, local: { storage: "managed", canDecode: null, needsProbe: true, proxy: { state: "none" }, present: { original: false, proxy: false, mezzanine: false } } };
}

export class MigrationFailed extends Error {
  readonly step: string;
  readonly errors: DocumentError[];
  constructor(step: string, message: string, errors: DocumentError[] = []) { super(message); this.name = "MigrationFailed"; this.step = step; this.errors = errors; }
}

/**
 * The v31→v32 step: converts an OpenCut classic v31 project record and its media-metadata records into a schema-32
 * document, exactly as tables §13.1–§13.7 of the catalogue prescribe. Pure: the same inputs and id source give the
 * same canonical bytes. Throws `MigrationFailed` when the result cannot be made strictly valid; the caller then
 * leaves the stored record unchanged.
 */
export function migrateV31toV32(record: unknown, mediaRecords: ClassicMediaRecord[], options: V32Options): V32Migration {
  if (!isObject(record) || !Array.isArray(record.scenes)) throw new MigrationFailed("v31→v32", "the classic record has no scenes array");
  const source = clone(record);
  const metadata = isObject(source.metadata) ? source.metadata : {}, settings = isObject(source.settings) ? source.settings : {};
  const canvasSize = canvas(settings.canvasSize, { width: 1920, height: 1080 })!;
  const fpsSource = isObject(settings.fps) ? settings.fps : {};
  const fps = Number.isInteger(fpsSource.numerator) && Number.isInteger(fpsSource.denominator) && (fpsSource.numerator as number) > 0 && (fpsSource.denominator as number) > 0
    ? reduceRational(fpsSource as Rational) : num(settings.fps) && settings.fps > 0 ? fpsToRational(settings.fps) : { numerator: 30, denominator: 1 };
  const run: Run = { report: [], options, k: classicCanvasFactor(canvasSize), fps, thumbnails: [], libraryAssets: new Map() };
  if (typeof metadata.thumbnail === "string" && metadata.thumbnail.startsWith("data:")) run.thumbnails.push({ owner: "project", id: String(metadata.id), dataUrl: metadata.thumbnail });

  const scenes = (source.scenes as unknown[]).filter(isObject).map((scene) => convertScene(run, scene));
  const hasPicture = scenes.some((scene) => [scene.tracks as Json].some((tracks) => [...asArray(tracks.overlay), tracks.main, ...asArray(tracks.audio)].some((track) => asArray((track as Json | undefined)?.elements).some((element) => ["video", "image"].includes(String((element as Json).type))))));
  const converted = mediaRecords.map((entry) => convertAsset(run, entry));
  const assets = [...converted.map((entry) => entry.asset), ...run.libraryAssets.values()].sort((a, b) => compareIds(String(a.id), String(b.id)));
  const localMedia = Object.fromEntries([...converted.map((entry) => [entry.asset.id, entry.local]), ...[...run.libraryAssets.values()].map((asset) => [asset.id, { storage: "managed", canDecode: null, needsProbe: true, proxy: { state: "none" }, present: { original: false, proxy: false, mezzanine: false } }])]);
  const view = isObject(source.timelineViewState) ? source.timelineViewState : {};
  const mainScene = scenes.find((scene) => scene.isMain) ?? scenes[0];
  const document: Json = {
    format: "jagentchill.project", schemaVersion: 32, minReaderSchemaVersion: 32,
    ...(Number.isInteger(source.version) && (source.version as number) <= 31 ? { version: source.version } : {}),
    metadata: {
      id: String(metadata.id), name: cut(metadata.name, 120, "Untitled project"), duration: snapToFrame(ticks(metadata.duration), run.fps),
      created_ms: toMs(metadata.createdAt, options.now_ms), updated_ms: toMs(metadata.updatedAt, options.now_ms), thumbnail: null,
    },
    settings: {
      fps, canvasSize, canvasSizeMode: settings.canvasSizeMode === "custom" ? "custom" : "preset",
      lastCustomCanvasSize: canvas(settings.lastCustomCanvasSize, null), originalCanvasSize: canvas(settings.originalCanvasSize, null),
      adoptCanvasFromFirstMedia: !hasPicture, adoptFrameRateFromFirstMedia: !hasPicture,
      background: background(run, settings.background), useProxies: true, colorPipeline: "sdr-rec709-8bit",
    },
    cover: null, scriptLinks: [], scenes, media: { assets, folders: [], luts: [] }, glossaries: {},
    local: {
      ...(typeof source.currentSceneId === "string" && scenes.some((scene) => scene.id === source.currentSceneId) ? { currentSceneId: source.currentSceneId } : mainScene ? { currentSceneId: mainScene.id } : {}),
      timelineViewState: {
        zoomLevel: num(view.zoomLevel) && view.zoomLevel > 0 ? view.zoomLevel : 1, scrollLeft: num(view.scrollLeft) && view.scrollLeft >= 0 ? view.scrollLeft : 0,
        playheadTime: ticks(view.playheadTime), scenePlayheads: {}, expandedKeyframeElementIds: [],
      },
      folderId: null, trash: null, media: localMedia, uniformScaleLock: {},
    },
  };

  // Stage 11: load-mode validation repairs what is repairable; every repair goes into the report.
  const loaded = validateProjectDocument(document, { mode: "load", registries: options.registries });
  if (!loaded.document) throw new MigrationFailed("v31→v32", "the converted document cannot be repaired", loaded.errors);
  for (const repair of loaded.repairs ?? []) note(run, repair.path, repair.code ?? "", repair.kind === "removed-element" ? "removed-element" : `repair:${repair.kind}`, repair.message);
  // Stage 12: the repaired result must be strictly valid, or the step fails and nothing is written.
  const strict = validateProjectDocument(loaded.document, { mode: "strict", registries: options.registries });
  if (!strict.ok) throw new MigrationFailed("v31→v32", new DocumentRejected(strict.errors).message, strict.errors);
  return { document: loaded.document, report: run.report, thumbnails: run.thumbnails };
}
