import type { ScriptConstraints, ScriptDocument } from "@jagentchill/protocol";
import { formatClock, plainText, TARGET_TOLERANCE, TICKS_PER_SECOND, totalTicks } from "./estimate.ts";
import { allLines, sceneLines, shotNumber } from "./model.ts";

/** `script-studio.Constraint checking`: the deterministic checker. It needs no host and no model. */
export type ConstraintFinding = { constraint: string; severity: "blocker" | "warning"; targetId: string | null; message: string; excerpt: string };
export type ConstraintReport = { passed: boolean; findings: ConstraintFinding[] };

const union = (a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined);
const stricter = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
/**
 * Host defaults ∪ script constraints: list fields are united, and for scalar limits the stricter value wins. A script
 * cannot remove a host-level `mustAvoid` or `bannedTopics` entry. `locked` names the entries "Set by this host".
 */
export function mergeConstraints(host: ScriptConstraints | undefined, script: ScriptConstraints | undefined): { constraints: ScriptConstraints; locked: { mustAvoid: string[]; bannedTopics: string[] } } {
  const merged: ScriptConstraints = { ...(host ?? {}), ...(script ?? {}) };
  for (const key of ["mustInclude", "mustAvoid", "bannedTopics", "styleSampleIds"] as const) { const value = union(host?.[key], script?.[key]); if (value) merged[key] = value; }
  for (const key of ["maxScenes", "maxShots", "maxCharacters", "lineMaxChars", "tolerance"] as const) { const value = stricter(host?.[key], script?.[key]); if (value !== undefined) merged[key] = value; }
  if (host?.claimsPolicy === "sources-only" || script?.claimsPolicy === "sources-only") merged.claimsPolicy = "sources-only";
  if (host?.captionSafe || script?.captionSafe) merged.captionSafe = true;
  return { constraints: merged, locked: { mustAvoid: [...(host?.mustAvoid ?? [])], bannedTopics: [...(host?.bannedTopics ?? [])] } };
}
const fold = (text: string): string => plainText(text).normalize("NFKC").toLowerCase();
const SPACED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{P}\p{Zs}\p{M}]+$/u;
/** Case-insensitive after NFKC; whole-word for space-delimited text and substring otherwise. Returns the matched excerpt. */
export function findPhrase(text: string, phrase: string): string | null {
  const hay = fold(text), needle = fold(phrase).trim();
  if (!needle) return null;
  if (!SPACED.test(needle)) { const at = hay.indexOf(needle); return at < 0 ? null : excerpt(text, at, needle.length); }
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u").exec(hay);
  return match ? excerpt(text, match.index, match[0].length) : null;
}
const excerpt = (text: string, at: number, length: number): string => { const plain = plainText(text).normalize("NFKC"); return plain.slice(Math.max(0, at - 20), at + length + 20).trim(); };
/** Caption limits by aspect ratio: 2 lines of 42 characters for 16:9 and 21:9, of 24 for every other ratio. */
export const captionLineLength = (aspectRatio: string): number => (aspectRatio === "16:9" || aspectRatio === "21:9" ? 42 : 24);

export function checkScript(document: ScriptDocument, hostConstraints?: ScriptConstraints): ConstraintReport {
  const { constraints } = mergeConstraints(hostConstraints, document.constraints);
  const findings: ConstraintFinding[] = [];
  const add = (constraint: string, severity: ConstraintFinding["severity"], targetId: string | null, message: string, text = "") => findings.push({ constraint, severity, targetId, message, excerpt: text.slice(0, 200) });
  const target = constraints.targetDuration_s ?? document.meta.targetDuration_s, tolerance = constraints.tolerance ?? TARGET_TOLERANCE;
  if (target !== undefined) {
    const total = totalTicks(document) / TICKS_PER_SECOND;
    if (Math.abs(total / target - 1) > tolerance + 1e-9) add("targetDuration_s", "blocker", null, `${formatClock(total * TICKS_PER_SECOND)} against a ${formatClock(target * TICKS_PER_SECOND)} target`);
  }
  const scenes = document.scenes.filter((scene) => !scene.omitted), shots = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
  if (constraints.maxScenes !== undefined && scenes.length > constraints.maxScenes) add("maxScenes", "blocker", null, `${scenes.length} scenes; the limit is ${constraints.maxScenes}`);
  if (constraints.maxShots !== undefined && shots > constraints.maxShots) add("maxShots", "blocker", null, `${shots} shots; the limit is ${constraints.maxShots}`);
  const speakers = new Set<string>();
  for (const { line } of allLines({ scenes })) if (line.kind === "dialogue" || line.kind === "narration") { const speaker = line.characterId ?? line.speakerText?.trim().toLowerCase(); if (speaker) speakers.add(speaker); }
  if (constraints.maxCharacters !== undefined && speakers.size > constraints.maxCharacters) add("maxCharacters", "blocker", null, `${speakers.size} speaking roles; the limit is ${constraints.maxCharacters}`);
  const lineMax = constraints.lineMaxChars ?? 400, cue = captionLineLength(document.meta.aspectRatio);
  for (const { line } of allLines({ scenes })) {
    const spoken = line.kind === "dialogue" || line.kind === "narration";
    if (spoken && line.text.length > lineMax) add("lineMaxChars", "blocker", line.id, `This line has ${line.text.length} characters; the limit is ${lineMax}`, line.text);
    for (const phrase of constraints.mustAvoid ?? []) { const found = findPhrase(line.text, phrase); if (found) add("mustAvoid", "blocker", line.id, `Contains "${phrase}"`, found); }
    if (spoken && constraints.captionSafe && plainText(line.text).split(/\s+/).some((word) => Array.from(word).length > cue)) add("captionSafe", "warning", line.id, `A word is longer than a caption line of ${cue} characters`, line.text);
    if (line.needsCheck && constraints.claimsPolicy === "sources-only") add("claimsPolicy", "blocker", line.id, "Check this fact", line.text);
    if (line.kind === "dialogue" && !line.characterId && !line.speakerText?.trim()) add("speaker", "warning", line.id, "Add a speaker", line.text);
  }
  const whole = scenes.flatMap((scene) => sceneLines(scene).map((line) => line.text)).join("\n");
  for (const phrase of constraints.mustInclude ?? []) {
    if (findPhrase(whole, phrase)) continue;
    // Every word present, in any place: an approximate match.
    const loose = fold(phrase).split(/\s+/).filter(Boolean).every((word) => fold(whole).includes(word));
    add("mustInclude", loose ? "warning" : "blocker", null, loose ? `"${phrase}" is only matched approximately` : `"${phrase}" is missing`);
  }
  for (const scene of scenes) for (const shot of scene.shots) if (!shot.description.trim()) add("shotDescription", "warning", shot.id, `Shot ${shotNumber(document, shot.id)} has no description`);
  return { passed: !findings.some((finding) => finding.severity === "blocker"), findings };
}
