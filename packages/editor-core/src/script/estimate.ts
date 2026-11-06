import { SCRIPT_PACES, type ScriptBeat, type ScriptDocument, type ScriptLine, type ScriptScene, type ScriptShot } from "@jagentchill/protocol";
import { sceneLines } from "./model.ts";

/** The reading-speed rule of `script-studio.Duration estimate`: deterministic, identical on every platform. */
export const TICKS_PER_SECOND = 120_000;
export const ESTIMATE_STEP_TICKS = 12_000;
const SPOKEN_PAUSE_S = 0.3;
const RATES = { words: 2.5, vi: 4.5, ja: 6.5, zh: 4.5, ko: 6.0, other: 14 } as const;
/** Languages written without spaces between words: counted by character, never by word. */
const UNSPACED = new Set(["th", "lo", "km", "my", "bo"]);
const base = (language: string): string => language.toLowerCase().split(/[-_]/)[0];
/** Emphasis marks carry no sound. */
export const plainText = (text: string): string => text.replace(/\*\*|\*|_/g, "");
const spokenTokens = (text: string): string[] => plainText(text).split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token));

/** Seconds needed to read `text` in `language` at pace 1: words, syllables, morae or characters by the language. */
export function readingSeconds(text: string, language: string): number {
  const code = base(language), plain = plainText(text);
  if (code === "vi") return spokenTokens(text).length / RATES.vi;
  if (code === "ja") {
    let morae = 0;
    for (const char of plain) { if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) && char !== "・") morae += 1; else if (/\p{Script=Han}/u.test(char)) morae += 2; else if (/[\p{L}\p{N}]/u.test(char)) morae += 1; }
    return morae / RATES.ja;
  }
  if (code === "zh") return Array.from(plain).filter((char) => /[\p{L}\p{N}]/u.test(char)).length / RATES.zh;
  if (code === "ko") return Array.from(plain).filter((char) => /[\p{L}\p{N}]/u.test(char)).length / RATES.ko;
  if (UNSPACED.has(code)) return Array.from(plain).filter((char) => /[\p{L}\p{N}\p{M}]/u.test(char)).length / RATES.other;
  return spokenTokens(text).length / RATES.words;
}

/** Integer ticks, rounded up to 0.1 s. The float is settled first so that 12.3 s is 1,476,000 ticks and not one step more. */
export const toEstimateTicks = (seconds: number): number => Math.ceil(Math.round(seconds * TICKS_PER_SECOND * 1000) / 1000 / ESTIMATE_STEP_TICKS) * ESTIMATE_STEP_TICKS;

type Timing = Pick<ScriptDocument, "meta">;
/** The time one line adds on its own; an on-screen text is settled per beat by `beatLineTicks`. */
function ownTicks(document: Timing, line: ScriptLine): number {
  const language = line.language ?? document.meta.language;
  if (line.kind === "dialogue" || line.kind === "narration") {
    const seconds = readingSeconds(line.text, language);
    return seconds === 0 ? 0 : toEstimateTicks(seconds / SCRIPT_PACES[document.meta.pace] + SPOKEN_PAUSE_S);
  }
  if (line.kind === "action") { const seconds = readingSeconds(line.text, language); return seconds === 0 ? 0 : toEstimateTicks(Math.max(1, seconds)); }
  return 0;
}
/**
 * The estimate of every line of a beat. An on-screen text runs concurrently with the lines of its beat: it adds time
 * only when the beat has no other timed line, and then the beat lasts as long as its longest text.
 */
export function beatLineTicks(document: Timing, beat: ScriptBeat): Map<string, number> {
  const out = new Map<string, number>();
  let timed = false;
  for (const line of beat.lines) { const ticks = ownTicks(document, line); out.set(line.id, ticks); if (ticks > 0) timed = true; }
  if (!timed) {
    let longest: { id: string; ticks: number } | null = null;
    for (const line of beat.lines) {
      if (line.kind !== "on_screen_text" || !line.text.trim()) continue;
      const ticks = toEstimateTicks(Math.max(1.5, 0.4 * spokenTokens(line.text).length));
      if (!longest || ticks > longest.ticks) longest = { id: line.id, ticks };
    }
    if (longest) out.set(longest.id, longest.ticks);
  }
  return out;
}
export function sceneLineTicks(document: Timing, scene: ScriptScene): Map<string, number> {
  const out = new Map<string, number>();
  for (const beat of scene.beats) for (const [id, ticks] of beatLineTicks(document, beat)) out.set(id, ticks);
  return out;
}
export const lineTicks = (document: Timing, scene: ScriptScene, lineId: string): number => sceneLineTicks(document, scene).get(lineId) ?? 0;
export const beatTicks = (document: Timing, beat: ScriptBeat): number => [...beatLineTicks(document, beat).values()].reduce((sum, ticks) => sum + ticks, 0);
/** A scene lasts its override when set, otherwise the sum of its lines; an omitted scene lasts nothing. */
export function sceneTicks(document: Timing, scene: ScriptScene): number {
  if (scene.omitted) return 0;
  if (scene.durationOverride_ticks !== undefined) return scene.durationOverride_ticks;
  return scene.beats.reduce((sum, beat) => sum + beatTicks(document, beat), 0);
}
/** A shot lasts its override, or the sum of its lines' estimates — each split equally among the shots covering it — and at least 1 s. */
export function shotTicks(document: Timing, scene: ScriptScene, shot: ScriptShot): number {
  if (shot.durationOverride_ticks !== undefined) return shot.durationOverride_ticks;
  const lines = sceneLineTicks(document, scene);
  let seconds = 0;
  for (const lineId of shot.lineIds) seconds += (lines.get(lineId) ?? 0) / TICKS_PER_SECOND / Math.max(1, scene.shots.filter((other) => other.lineIds.includes(lineId)).length);
  return toEstimateTicks(Math.max(1, seconds));
}
export const totalTicks = (document: Pick<ScriptDocument, "meta" | "scenes">): number => document.scenes.reduce((sum, scene) => sum + sceneTicks(document, scene), 0);

export const TARGET_TOLERANCE = 0.1;
export type TargetState = { estimate_ticks: number; target_s: number | null; onTarget: boolean; percent: number; label: string; tooltip: string };
/** "2:14 of 2:00 target", on target within ±10 %; the tooltip reads "12 % over target". */
export function targetState(document: Pick<ScriptDocument, "meta" | "scenes">, tolerance: number = TARGET_TOLERANCE): TargetState {
  const estimate = totalTicks(document), target = document.meta.targetDuration_s ?? null;
  if (target === null) return { estimate_ticks: estimate, target_s: null, onTarget: true, percent: 0, label: formatClock(estimate), tooltip: "" };
  const ratio = estimate / TICKS_PER_SECOND / target - 1, percent = Math.round(Math.abs(ratio) * 100);
  const onTarget = Math.abs(ratio) <= tolerance + 1e-9;
  return {
    estimate_ticks: estimate, target_s: target, onTarget, percent,
    label: `${formatClock(estimate)} of ${formatClock(target * TICKS_PER_SECOND)} target`,
    tooltip: onTarget ? "On target" : `${percent} % ${ratio > 0 ? "over" : "under"} target`,
  };
}
/** `m:ss` (or `h:mm:ss`), seconds rounded to the nearest. */
export function formatClock(ticks: number): string {
  const total = Math.round(ticks / TICKS_PER_SECOND), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
/** "4.2 s": estimates of single lines and shots. */
export const formatSeconds = (ticks: number): string => `${(ticks / TICKS_PER_SECOND).toFixed(1)} s`;
/** A duration field accepts seconds ("3.5") or `m:ss` ("1:05"); anything else is `null`. */
export function parseDuration(text: string): number | null {
  const value = text.trim().replace(/\s*s$/i, "");
  const clock = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (clock) return Math.round((Number(clock[1]) * 60 + Number(clock[2])) * TICKS_PER_SECOND);
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
  return Math.round(Number(value.replace(",", ".")) * TICKS_PER_SECOND);
}
export const estimateStats = (document: Pick<ScriptDocument, "meta" | "scenes">) => ({
  scenes: document.scenes.length, lines: document.scenes.reduce((sum, scene) => sum + sceneLines(scene).length, 0), shots: document.scenes.reduce((sum, scene) => sum + scene.shots.length, 0),
  words: document.scenes.reduce((sum, scene) => sum + sceneLines(scene).reduce((count, line) => count + spokenTokens(line.text).length, 0), 0), estimatedDuration_ticks: totalTicks(document),
});
