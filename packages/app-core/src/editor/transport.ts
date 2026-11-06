import { formatTimecode, parseTimecode, timeline } from "@jagentchill/editor-core";
import type { ProjectDocument, Rational } from "@jagentchill/protocol";

/** The rates of the playback-rate menu; 1× is the default and the menu returns to it when the editor is reopened. */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export const SHUTTLE_STEPS = [1, 2, 4, 8] as const;
export const rateLabel = (rate: number): string => `${rate}×`;

export type ShuttleState = { direction: 0 | 1 | -1; rate: number; stopHeld: boolean };
export const SHUTTLE_IDLE: ShuttleState = { direction: 0, rate: 1, stopHeld: false };
export type ShuttleEffect = { kind: "play"; rate: number } | { kind: "pause" } | { kind: "step"; frames: 1 | -1 } | { kind: "none" };
/**
 * The J/K/L shuttle. Forward plays at 1× and each further press steps 1×, 2×, 4×, 8×; reverse mirrors it; the
 * opposite direction starts at 1×; stop pauses and resets; while stop is held, forward and reverse step one frame.
 */
export function shuttle(state: ShuttleState, input: "forward" | "reverse" | "stop" | "stop-release"): { state: ShuttleState; effect: ShuttleEffect } {
  if (input === "stop") return { state: { direction: 0, rate: 1, stopHeld: true }, effect: { kind: "pause" } };
  if (input === "stop-release") return { state: { ...state, stopHeld: false }, effect: { kind: "none" } };
  const direction = input === "forward" ? 1 : -1;
  if (state.stopHeld) return { state, effect: { kind: "step", frames: direction } };
  const index = state.direction === direction ? Math.min(SHUTTLE_STEPS.length - 1, SHUTTLE_STEPS.indexOf(state.rate as 1) + 1) : 0;
  const rate = SHUTTLE_STEPS[index];
  return { state: { direction, rate, stopHeld: false }, effect: { kind: "play", rate: direction * rate } };
}
/** Sound is pitch-preserved for forward rates 0.5×–2× and silent for every other rate and in reverse. */
export const audibleAtRate = (rate: number): boolean => rate >= 0.5 && rate <= 2;

export type Volume = { volume: number; muted: boolean; restore: number };
export const VOLUME_DEFAULT: Volume = { volume: 100, muted: false, restore: 100 };
/** The slider: 0–100 in steps of 1; reaching 0 mutes. */
export function setVolume(state: Volume, percent: number): Volume {
  const volume = Math.round(Math.min(100, Math.max(0, percent)));
  return volume === 0 ? { volume: 0, muted: true, restore: state.muted ? state.restore : state.volume } : { volume, muted: false, restore: volume };
}
/** The speaker button: unmuting restores the volume in effect before muting, or 100 % when that was 0. */
export function toggleMute(state: Volume): Volume {
  if (!state.muted) return { volume: state.volume, muted: true, restore: state.volume };
  const volume = state.restore > 0 ? state.restore : 100;
  return { volume, muted: false, restore: volume };
}
/** What the engine is told: 0–1 and the mute flag. */
export const engineVolume = (state: Volume): { volume: number; muted: boolean } => ({ volume: state.volume / 100, muted: state.muted || state.volume === 0 });
export const isVolume = (value: unknown): value is Volume => value !== null && typeof value === "object"
  && [(value as Volume).volume, (value as Volume).restore].every((entry) => typeof entry === "number" && entry >= 0 && entry <= 100) && typeof (value as Volume).muted === "boolean";

/** The loop region: the in/out range of the scene when one is set, otherwise the whole scene. */
export function loopRegion(doc: ProjectDocument, sceneId: string): { start: number; end: number } {
  const scene = timeline.sceneById(doc, sceneId), duration = timeline.sceneDurationOf(scene);
  const start = scene.inPoint ?? 0, end = scene.outPoint ?? duration;
  return end > start ? { start, end: Math.min(end, duration) } : { start: 0, end: duration };
}
/**
 * Where playback starts. Nothing plays in an empty scene; a playhead at or past the end restarts from 0; with loop
 * on, a playhead outside the loop region starts from the region's start. Reverse starts where it is.
 */
export function playStart(input: { playhead: number; duration: number; loop: boolean; region: { start: number; end: number }; rate?: number }): number | null {
  if (input.duration <= 0) return null;
  if ((input.rate ?? 1) < 0) return input.playhead <= 0 ? null : input.playhead;
  if (input.loop && (input.playhead < input.region.start || input.playhead >= input.region.end)) return input.region.start;
  return input.playhead >= input.duration ? 0 : input.playhead;
}
/** An edit shortened the scene under the playhead: it is clamped to the new duration and playback pauses. */
export const clampAfterEdit = (playhead: number, duration: number, playing: boolean): { playhead: number; pause: boolean } =>
  (playhead > duration ? { playhead: duration, pause: playing } : { playhead, pause: false });

export const timecode = (ticks: number, fps: Rational): string => formatTimecode(Math.max(0, ticks), "HH:MM:SS:FF", fps) ?? "00:00:00:00";
/** The editable timecode accepts `HH:MM:SS:FF`, `MM:SS:FF`, `MM:SS` and `SS`; `null` while the text is not a time. */
export function parseTimeEntry(text: string, fps: Rational): number | null {
  const parts = text.trim().split(":");
  if (text.trim() === "" || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  // `MM:SS` has no frame part; every longer form ends with one.
  const padded: string[] = parts.length === 1 ? ["0", "0", parts[0], "0"] : parts.length === 2 ? ["0", parts[0], parts[1], "0"] : parts.length === 3 ? ["0", ...parts] : parts;
  return parseTimecode(padded.map((part) => part.padStart(2, "0")).join(":"), "HH:MM:SS:FF", fps);
}
/** Commits the field: the seek target clamped to the scene and frame-snapped, or `null` for text that is not a time. */
export function commitTimeEntry(text: string, duration: number, fps: Rational): number | null {
  const parsed = parseTimeEntry(text, fps);
  return parsed === null ? null : timeline.seekTime(parsed, duration, fps);
}
