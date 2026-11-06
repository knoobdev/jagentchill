import { AUDIO_KEYS, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { EQ_PRESET_BANDS } from "../registries.ts";
import { snapToFrame } from "../time.ts";
import { edit, editable, elementIn, reject, sceneElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

/** `audio-editing`: the document operations of the Audio tab and the Audio inspector, and the maths their controls share. */

export const VOLUME_MIN_DB = -60, VOLUME_MAX_DB = 20;
/** Clip volume as stored: −60…+20 dB, 0.01 dB precision. */
export const storedVolume = (db: number): number => Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, Math.round(db * 100) / 100));
/** `10^(dB/20)`; −60 dB is silence. */
export const volumeGain = (db: number): number => (db <= VOLUME_MIN_DB ? 0 : Math.pow(10, db / 20));
/** "x.x dB", with −60 dB shown as "−∞ dB". */
export const volumeLabel = (db: number): string => (db <= VOLUME_MIN_DB ? "−∞ dB" : `${db < 0 ? "−" : db > 0 ? "+" : ""}${Math.abs(db).toFixed(1)} dB`);
/** The touch slider: percent = 100 × 10^(dB/20), 0 % = −60 dB, 1000 % = +20 dB; its position is sqrt(percent / 1000). */
export const volumePercent = (db: number): number => (db <= VOLUME_MIN_DB ? 0 : 100 * Math.pow(10, db / 20));
export const percentVolume = (percent: number): number => (percent <= 0 ? VOLUME_MIN_DB : storedVolume(20 * Math.log10(percent / 100)));
export const volumeSliderPosition = (percent: number): number => Math.sqrt(Math.min(1000, Math.max(0, percent)) / 1000);
/** The volume line: `gain = (1 − y/h)² × 10`, clamped to −60…+20 dB. `y` from the top of a drawing area `h` high. */
export function volumeLineY(db: number, height: number): number { return height * (1 - Math.sqrt(Math.min(10, volumeGain(db)) / 10)); }
export function volumeAtLineY(y: number, height: number): number {
  const gain = Math.pow(1 - Math.min(1, Math.max(0, y / height)), 2) * 10;
  return gain <= 0.001 ? VOLUME_MIN_DB : storedVolume(Math.round(20 * Math.log10(gain) * 10) / 10);
}

export const FADE_SHAPE_LABELS: Record<string, string> = { linear: "Linear", "equal-power": "Equal-power", "s-curve": "S-curve", logarithmic: "Logarithmic", exponential: "Exponential" };
/**
 * A fade lasts 0 up to the element's duration, frame-aligned, and the two fades together never exceed it: the fade
 * being set is limited by what the other leaves. Returns the duration that is stored.
 */
export function clampFade(requested: number, elementDuration: number, otherFade: number, snap: (time: number) => number = (time) => time): number {
  return Math.max(0, Math.min(snap(Math.max(0, requested)), elementDuration - Math.min(otherFade, elementDuration)));
}
const fadeOf = (element: Json, key: "fadeIn" | "fadeOut"): Json => (isObject(element[key]) ? (element[key] as Json) : { duration: 0, shape: "equal-power" });
/** Sets one fade of audio-capable elements as one step. */
export function setFade(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], side: "fadeIn" | "fadeOut", change: { duration?: number; shape?: string }): Commit {
  return edit(doc, ctx, { commandType: "audio.fade", label: side === "fadeIn" ? "Fade in" : "Fade out" }, (draft) => {
    for (const id of elementIds) {
      const element = editable(elementIn(draft, id)), current = fadeOf(element, side), other = fadeOf(element, side === "fadeIn" ? "fadeOut" : "fadeIn");
      const duration = change.duration === undefined ? Number(current.duration ?? 0) : clampFade(change.duration, Number(element.duration), Number(other.duration ?? 0), (time) => snapToFrame(time, draft.settings.fps as never));
      element[side] = { ...current, ...(change.shape ? { shape: change.shape } : {}), duration };
    }
  });
}
/** Trimming keeps fades at their durations, clamped: when the element becomes shorter than both, each keeps its share (1 s + 1 s trimmed to 1 s → 0.5 s each). */
export function fadesAfterTrim(fadeIn: number, fadeOut: number, duration: number): { fadeIn: number; fadeOut: number } {
  if (fadeIn + fadeOut <= duration) return { fadeIn, fadeOut };
  const scale = duration / (fadeIn + fadeOut);
  const nextIn = Math.floor(fadeIn * scale);
  return { fadeIn: nextIn, fadeOut: Math.min(duration - nextIn, Math.floor(fadeOut * scale)) };
}

// — Beat markers: source time, so they stay on the same sound —
export const BEAT_LIMIT = 2000;
type Timed = { startTime: number; duration: number; trimStart?: number; retime?: { rate?: number } };
/** The source time under a timeline time of an element at constant rate. */
export const beatSourceTime = (element: Timed, timelineTime: number): number => Math.round((element.trimStart ?? 0) + (timelineTime - element.startTime) * (element.retime?.rate ?? 1));
export const beatTimelineTime = (element: Timed, sourceTime: number): number => Math.round(element.startTime + (sourceTime - (element.trimStart ?? 0)) / (element.retime?.rate ?? 1));
export function addBeats(doc: ProjectDocument, ctx: CommitContext, elementId: string, timelineTimes: number[]): Commit {
  return edit(doc, ctx, { commandType: "audio.beat.add", label: "Add beat" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), beats = new Set((element.beats as number[] | undefined) ?? []);
    for (const time of timelineTimes) {
      if (beats.size >= BEAT_LIMIT) reject("document/limit-exceeded", "", "Beat marker limit reached (2000)", { limit: "beatsPerElement", value: BEAT_LIMIT });
      beats.add(beatSourceTime(element as unknown as Timed, time));
    }
    element.beats = [...beats].sort((a, b) => a - b);
  });
}
/** Deletes the marker under a timeline time, within `tolerance` ticks (2 frames). */
export function deleteBeatAt(doc: ProjectDocument, ctx: CommitContext, elementId: string, timelineTime: number, tolerance: number): Commit {
  return edit(doc, ctx, { commandType: "audio.beat.delete", label: "Delete beat" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), beats = (element.beats as number[] | undefined) ?? [];
    const nearest = [...beats].sort((a, b) => Math.abs(beatTimelineTime(element as unknown as Timed, a) - timelineTime) - Math.abs(beatTimelineTime(element as unknown as Timed, b) - timelineTime))[0];
    if (nearest === undefined || Math.abs(beatTimelineTime(element as unknown as Timed, nearest) - timelineTime) > tolerance) reject("document/unknown-reference", "", "No beat marker under the playhead");
    element.beats = beats.filter((beat) => beat !== nearest);
  });
}
export const clearBeats = (doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit =>
  edit(doc, ctx, { commandType: "audio.beat.clear", label: "Clear beats" }, (draft) => { editable(elementIn(draft, elementId)).beats = []; });

// — Equaliser and ducking (static settings) —
export const EQ_BAND_KEYS = ["low", "lowMid", "mid", "highMid", "high"] as const;
/** Choosing a preset writes its band values; moving a band sets `preset: "custom"`. Bands are −12…+12 dB in 0.5 dB steps. */
export function setEq(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], change: { enabled?: boolean; preset?: string; band?: { key: (typeof EQ_BAND_KEYS)[number]; value: number } }): Commit {
  if (change.preset !== undefined && change.preset !== "custom" && !EQ_PRESET_BANDS[change.preset]) reject("document/unknown-reference", "", `"${change.preset}" is not an equaliser preset`);
  return edit(doc, ctx, { commandType: "audio.eq", label: "Equaliser" }, (draft) => {
    for (const id of elementIds) {
      const element = editable(elementIn(draft, id));
      const current = (isObject(element.eq) ? element.eq : { enabled: false, preset: "flat", bands: { ...EQ_PRESET_BANDS.flat } }) as Json;
      const next: Json = { ...current, bands: { ...(current.bands as Json) } };
      if (change.enabled !== undefined) next.enabled = change.enabled;
      if (change.preset !== undefined && change.preset !== "custom") { next.preset = change.preset; next.bands = { ...EQ_PRESET_BANDS[change.preset] }; }
      if (change.band) { (next.bands as Json)[change.band.key] = Math.min(12, Math.max(-12, Math.round(change.band.value * 2) / 2)); next.preset = "custom"; }
      element.eq = next;
    }
  });
}
export function setTrackDucking(doc: ProjectDocument, ctx: CommitContext, trackId: string, change: { enabled?: boolean; amount?: number; attack?: number; release?: number; mode?: "full" | "voice-band" }): Commit {
  return edit(doc, ctx, { commandType: "audio.duck", label: "Ducking" }, (draft) => {
    const track = trackIn(draft, trackId).track as unknown as Json;
    if (track.type !== "audio") reject("document/wrong-type", "", "ducking is a setting of an audio track");
    track.ducking = { ...(isObject(track.ducking) ? track.ducking : {}), ...change };
  });
}

/**
 * "Recover audio": the video's source audio is enabled again. While the extracted element with the same `linkId`
 * exists its audio settings and keyframes go back to the video, the element is deleted and the link is cleared, in
 * one step; without it only the flag is restored.
 */
export function recoverAudio(doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit {
  return edit(doc, ctx, { commandType: "element.recover-audio", label: "Recover audio" }, (draft) => {
    const ref = elementIn(draft, elementId), video = editable(ref);
    video.isSourceAudioEnabled = true;
    const linked = video.linkId ? sceneElements(ref).find((entry) => entry.type === "audio" && entry.linkId === video.linkId && entry.id !== video.id) : undefined;
    if (!linked) return;
    for (const key of AUDIO_KEYS) { if (linked[key] === undefined) delete video[key]; else video[key] = linked[key]; }
    const moved = isObject(linked.animations) ? (linked.animations as Json) : {};
    if (moved.volume || moved.pan) video.animations = { ...(isObject(video.animations) ? video.animations : {}), ...(moved.volume ? { volume: moved.volume } : {}), ...(moved.pan ? { pan: moved.pan } : {}) };
    for (const scene of draft.scenes) for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) {
      const index = (track.elements as unknown as Json[]).indexOf(linked);
      if (index >= 0) (track.elements as unknown[]).splice(index, 1);
    }
    video.linkId = null;
  });
}

// — Licence check: local, from project data —
export type LicenceRow = { assetId: string; name: string; origin: "bundled" | "library" | "generated" | "own"; licence: string; author?: string; sourceUrl?: string; /** The credit line the source asks for, when the sound's record holds one. */ credit?: string; flag?: "Not for commercial use" | "Attribution required" };
const normalLicence = (licence: unknown): string => { const text = String(licence ?? "").toLowerCase().replace(/[\s_]+/g, "-"); return /nc|non-?commercial/.test(text) ? "cc-by-nc" : /cc0|creative-commons-0|public-domain/.test(text) ? "cc0" : /by|attribution/.test(text) ? "cc-by" : ""; };
export const LICENCE_NAMES: Record<string, string> = { cc0: "CC0", "cc-by": "CC BY", "cc-by-nc": "CC BY-NC" };
/** Every audio source the scene uses, once each, with its origin and licence. */
export function licenceCheck(doc: ProjectDocument, sceneId: string): LicenceRow[] {
  const scene = doc.scenes.find((entry) => entry.id === sceneId);
  if (!scene) return [];
  const rows = new Map<string, LicenceRow>();
  for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) for (const element of track.elements as unknown as Json[]) {
    if (element.type !== "audio" && element.type !== "video") continue;
    const asset = doc.media.assets.find((entry) => entry.id === element.mediaId) as (Json & { id: string; name: string }) | undefined;
    if (!asset || rows.has(asset.id) || (asset.type === "video" && (asset.hasAudio === false || element.isSourceAudioEnabled === false))) continue;
    const provenance = (isObject(asset.provenance) ? asset.provenance : {}) as Json, licence = normalLicence(provenance.licence);
    const credit = typeof provenance.credit === "string" ? provenance.credit.trim() : "";
    // A sound of the remote catalogue is a library sound wherever it was placed from (its record says "stock").
    const origin: LicenceRow["origin"] = element.sourceType === "bundled" ? "bundled" : element.sourceType === "library" || provenance.source === "stock" ? "library" : provenance.source === "generated" ? "generated" : "own";
    rows.set(asset.id, {
      assetId: asset.id, name: asset.name, origin,
      licence: origin === "bundled" ? "CC0" : origin === "library" ? (provenance.source === "stock" && licence && provenance.licence ? String(provenance.licence) : LICENCE_NAMES[licence] ?? String(provenance.licence ?? "")) : origin === "generated" ? "Generated" : credit ? "Your file — credit required by its source" : "Your file — licence not known to JAgentChill",
      ...(provenance.author ? { author: String(provenance.author) } : {}), ...(provenance.sourceUrl ? { sourceUrl: String(provenance.sourceUrl) } : {}), ...(credit ? { credit } : {}),
      ...(origin === "library" && licence === "cc-by-nc" ? { flag: "Not for commercial use" as const } : (origin === "library" && licence === "cc-by") || (origin === "own" && credit) ? { flag: "Attribution required" as const } : {}),
    });
  }
  return [...rows.values()];
}
/** One entry per attributed sound: the credit line its record holds, as it is; otherwise name, author, licence and URL. */
export const creditsText = (rows: LicenceRow[]): string => rows.filter((row) => row.credit || row.flag === "Attribution required" || (row.origin === "library" && row.author)).map((row) => row.credit ?? `${row.name} — ${row.author ?? ""} — ${row.licence} — ${row.sourceUrl ?? ""}`).join("\n");
