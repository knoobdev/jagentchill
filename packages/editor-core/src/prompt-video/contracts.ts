import { readingSeconds } from "../script/estimate.ts";
import { STYLE_PRESETS, TICKS, narrated, speechTarget_s, type VideoParams } from "./params.ts";

/**
 * The artifacts the steps of the template hand to each other, and the checks a model's answer passes before it becomes
 * one. A check either returns the artifact with its invariants made true (durations normalised, defaults written) or
 * lists what is wrong in sentences a model can act on.
 */
export const INTENTS = ["story", "explainer", "advertisement", "tutorial", "social-short", "trailer", "news", "other"] as const;
export const SHOT_SIZES = ["extreme-wide", "wide", "medium", "close-up", "extreme-close-up", "insert"] as const;
export const CAMERA_MOTIONS = ["static", "pan", "tilt", "push-in", "pull-out", "track", "handheld", "orbit"] as const;
export const SEGMENT_KINDS = ["narration", "dialogue", "on-screen-text", "silent"] as const;
export const MOTION_PRESETS = ["slow-zoom-in", "slow-zoom-out", "pan-left", "pan-right", "none"] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export type Brief = {
  title: string; intent: (typeof INTENTS)[number]; audience: string; tone: string;
  keyMessages: { text: string; evidence: string }[]; structure: { label: string; targetDuration_s: number }[];
  visualStyle: { presetId?: string; text: string; palette: string[] }; narrationPolicy: "voiceover" | "dialogue" | "none"; musicDirection: string;
  constraints: { aspectRatio: string; language: string; duration: number; mustInclude: string[]; mustAvoid: string[] };
  assumptions: { text: string; source: "agent" | "default-answer" | "user" }[];
  openQuestions: { id: string; question: string; suggestedAnswers: string[]; answer?: string }[];
};
export type Segment = { id: string; beatLabel: string; kind: (typeof SEGMENT_KINDS)[number]; speaker: string; text: string; estimatedDuration_s: number };
export type Script = { title: string; language: string; segments: Segment[] };
export type Shot = {
  id: string; index: number; segmentIds: string[]; duration_ticks: number; description: string; shotSize: (typeof SHOT_SIZES)[number]; cameraMotion: (typeof CAMERA_MOTIONS)[number];
  subjects: string[]; setting: string; onScreenText: string; transitionOut: string; sound?: string;
};
export type ShotList = { shots: Shot[] };
/** The picture of one shot: a generated image in the host's blob store, or nothing when its generation failed. */
export type ShotMedia = {
  shotId: string; method: "image"; prompt: string; motion: MotionPreset; media: MediaFile | null; error?: string; costUsd: number;
  /** The picture set in motion by a video model: a clip that STARTS from `media`. On the timeline the shot is this clip for as long as it lasts, then its last frame held to the end of the shot. */ clip?: MediaFile;
  /** What a model that can see said about the picture (absent when nobody could look). */ check?: import("../film/picture-check.ts").PictureCheck; /** Which drawing of the shot this is (more than 1: earlier ones failed the check). */ drawing?: number;
  /** The picture could not be had — refused by the provider's content policy, or every drawing failed the check: the shot waits for a person. */ refused?: { message: string; reason: "policy" | "picture" };
  /** A person decided the video goes on without this shot. */ leftOut?: boolean;
  /** The picture is a person's own file, put in place of the generated one. */ replaced?: boolean;
};
export type MediaFile = { blobId: string; name: string; kind: "image" | "audio" | "video"; bytes: number; width?: number; height?: number; duration_ticks?: number; provenance: Record<string, unknown> };
export type Take = { segmentId: string; media: MediaFile; /** What a listener heard in the recording and whether it is the line. */ check?: import("../film/speech-check.ts").SpeechCheck; /** Nobody listened to it: it has no verdict. */ unchecked?: import("../film/speech-check.ts").Unchecked; voiceId?: string };
export type VoiceTrack = { voices: Record<string, string>; takes: { segmentId: string; shotId: string; media: MediaFile; start_ticks: number; duration_ticks: number }[]; total_ticks: number; warnings: string[] };
export type CaptionSet = { language: string; /** The language of the cues' `translation`, when the run asked for captions in a second language. */ translationLanguage?: string; cues: { segmentId: string; text: string; start_ticks: number; duration_ticks: number; speaker: string; translation?: string }[]; warnings: string[] };
export type MusicTrack = { media: MediaFile; mood: string } | null;
export type Finding = { code: string; severity: "blocker" | "warning" | "info"; message: string };
export type ReviewReport = { findings: Finding[]; score: number; duration_s: number; target_s: number; shots: number; passed: boolean };

/** What a model's answer got wrong, in sentences that go back to it. */
export class ContractError extends Error {
  readonly code = "WORKFLOW_OUTPUT_INVALID";
  readonly problems: string[];
  constructor(what: string, problems: string[]) { super(`${what}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`); this.name = "ContractError"; this.problems = problems; }
}

/** The JSON value of an answer: the whole text, a fenced block, or the outermost braces. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [text, fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!candidate?.trim()) continue;
    try { return JSON.parse(candidate); } catch { /* the next form */ }
  }
  return undefined;
}

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The `Brief` of an answer, with the run's constraints written in and the beat durations scaled to the run's duration. */
export function normaliseBrief(raw: unknown, params: VideoParams): Brief {
  const source = record(raw), problems: string[] = [];
  const title = str(source.title, 80), audience = str(source.audience, 200), tone = str(source.tone, 200);
  if (!title) problems.push("`title` must be 1–80 characters");
  if (!audience) problems.push("`audience` must be 1–200 characters");
  if (!tone) problems.push("`tone` must be 1–200 characters");
  const keyMessages = list(source.keyMessages).map((entry) => ({ text: str(record(entry).text ?? entry, 200), evidence: str(record(entry).evidence, 400) || "assumption" })).filter((entry) => entry.text).slice(0, 7);
  if (!keyMessages.length) problems.push("`keyMessages` needs 1–7 items of {text, evidence}");
  let structure = list(source.structure).map((entry) => ({ label: str(record(entry).label, 80), targetDuration_s: Number(record(entry).targetDuration_s) })).filter((beat) => beat.label && Number.isFinite(beat.targetDuration_s) && beat.targetDuration_s > 0).slice(0, 12);
  if (structure.length < 2) problems.push("`structure` needs 2–12 beats of {label, targetDuration_s}");
  const style = record(source.visualStyle), presetId = STYLE_PRESETS.find((preset) => preset.id === (params.style !== "auto" ? params.style : style.presetId))?.id;
  const styleText = str(style.text, 500) || STYLE_PRESETS.find((preset) => preset.id === presetId)?.descriptor || "";
  if (!styleText) problems.push("`visualStyle.text` must describe the look in 1–500 characters");
  const palette = list(style.palette).filter((colour): colour is string => typeof colour === "string" && /^#[0-9a-fA-F]{6}$/.test(colour)).slice(0, 6);
  if (palette.length < 3) problems.push("`visualStyle.palette` needs 3–6 hex colours like #1A2B3C");
  if (problems.length) throw new ContractError("The brief is not valid", problems);
  // Beat durations sum to the run's duration.
  const sum = structure.reduce((total, beat) => total + beat.targetDuration_s, 0);
  if (Math.abs(sum - params.targetDuration_s) > 0.05) structure = structure.map((beat) => ({ ...beat, targetDuration_s: Math.max(0.1, round1((beat.targetDuration_s * params.targetDuration_s) / sum)) }));
  const assumptions = list(source.assumptions).map((entry) => ({ text: str(record(entry).text ?? entry, 300), source: oneOf(record(entry).source, ["agent", "default-answer", "user"] as const, "agent") })).filter((entry) => entry.text).slice(0, 10);
  // A message that rests on an assumption is listed among the assumptions.
  for (const message of keyMessages) if (message.evidence === "assumption" && assumptions.length < 10 && !assumptions.some((entry) => entry.text === message.text)) assumptions.push({ text: message.text, source: "agent" });
  const openQuestions = list(source.openQuestions).map((entry, index) => {
    const question = record(entry), answers = list(question.suggestedAnswers).map((answer) => str(answer, 200)).filter(Boolean).slice(0, 4), answer = str(question.answer, 400);
    return { id: str(question.id, 40) || `q${index + 1}`, question: str(question.question, 300), suggestedAnswers: answers, ...(answer ? { answer } : {}) };
  }).filter((question) => question.question && question.suggestedAnswers.length >= 2).slice(0, 5);
  const constraints = record(source.constraints);
  const texts = (value: unknown) => list(value).map((entry) => str(entry, 200)).filter(Boolean).slice(0, 20);
  return {
    title, intent: oneOf(source.intent, INTENTS, "other"), audience, tone, keyMessages, structure,
    visualStyle: { ...(presetId ? { presetId } : {}), text: styleText, palette },
    narrationPolicy: narrated(params) ? oneOf(source.narrationPolicy, ["voiceover", "dialogue"] as const, "voiceover") : "none",
    musicDirection: str(source.musicDirection, 300),
    constraints: { aspectRatio: params.aspectRatio, language: params.language, duration: params.targetDuration_s, mustInclude: texts(constraints.mustInclude), mustAvoid: texts(constraints.mustAvoid) },
    assumptions, openQuestions,
  };
}

/** Every open question without an answer takes its first suggested answer, recorded as an assumption: the brief is complete whoever decides the checkpoint. */
export function applyBriefDefaults(brief: Brief): Brief {
  const assumptions = [...brief.assumptions];
  const openQuestions = brief.openQuestions.map((question) => {
    if (question.answer) return question;
    const answer = question.suggestedAnswers[0];
    if (assumptions.length < 10) assumptions.push({ text: `${question.question} — ${answer}`, source: "default-answer" });
    return { ...question, answer };
  });
  return { ...brief, assumptions, openQuestions };
}

export const scriptSeconds = (script: Pick<Script, "segments">): number => script.segments.reduce((sum, segment) => sum + segment.estimatedDuration_s, 0);
export const isSpoken = (segment: Pick<Segment, "kind" | "text">): boolean => (segment.kind === "narration" || segment.kind === "dialogue") && segment.text.trim().length > 0;

/**
 * The script of an answer: ordered segments with ids, each with its reading time in the run's language. The total must
 * meet the speech target within 10 %; a silent run measures the durations the writer gave.
 */
export function normaliseScript(raw: unknown, params: VideoParams): Script {
  const source = record(raw), problems: string[] = [];
  const spokenRun = narrated(params);
  const segments: Segment[] = list(source.segments).map((entry, index) => {
    const item = record(entry), text = str(item.text, 400);
    let kind = oneOf(item.kind, SEGMENT_KINDS, text ? "narration" : "silent");
    // A run without a voice speaks nothing: its words are shown instead.
    if (!spokenRun && (kind === "narration" || kind === "dialogue")) kind = "on-screen-text";
    const given = Number(item.estimatedDuration_s), read = text ? readingSeconds(text, params.language) : 0;
    const seconds = kind === "narration" || kind === "dialogue" ? read : Number.isFinite(given) && given > 0 ? given : Math.max(2, read);
    return { id: `seg_${index + 1}`, beatLabel: str(item.beatLabel, 80), kind, speaker: kind === "dialogue" ? str(item.speaker, 80) || "Speaker" : kind === "narration" ? "Narrator" : "", text, estimatedDuration_s: Math.max(0.5, round1(seconds)) };
  }).filter((segment) => segment.kind === "silent" || segment.text);
  if (!segments.length) problems.push("`segments` needs at least one item of {beatLabel, kind, speaker, text, estimatedDuration_s}");
  if (segments.length > 500) problems.push("at most 500 spoken segments");
  const total = scriptSeconds({ segments }), target = speechTarget_s(params);
  if (segments.length && Math.abs(total - target) > target * 0.1) {
    problems.push(`the script reads in ${round1(total)} s but must read in ${round1(target)} s (±10 %): ${total > target ? "shorten it" : "add to it"} by about ${round1(Math.abs(total - target))} s of ${spokenRun ? "spoken text" : "screen time"}`);
  }
  if (problems.length) throw Object.assign(new ContractError("The script is not valid", problems), problems.some((problem) => problem.includes("must read in")) ? { code: "SCRIPT_CONSTRAINT_VIOLATION" } : {});
  return { title: str(source.title, 80) || "Script", language: params.language, segments };
}

const SHOT_MIN = TICKS, SHOT_MAX = 15 * TICKS, FIRST_SHOT_ROOM = 48_000;
const frameTicks = (frameRate: number): number => TICKS / frameRate;
export const toFrame = (ticks: number, frameRate: number): number => Math.ceil(ticks / frameTicks(frameRate) - 1e-9) * frameTicks(frameRate);

/**
 * The shot list of an answer: every segment of the script covered in order, shots of 1–15 s (a longer one is split),
 * and durations scaled so that they sum to the script's estimate plus 0.4 s for every shot that opens a spoken segment.
 */
export function normaliseShotList(raw: unknown, script: Script, params: Pick<VideoParams, "frameRate">): ShotList {
  const problems: string[] = [], known = new Set(script.segments.map((segment) => segment.id)), order = new Map(script.segments.map((segment, index) => [segment.id, index]));
  const drafts = list(record(raw).shots ?? raw).map((entry) => {
    const item = record(entry), seconds = Number(item.duration_s ?? (Number(item.duration_ticks) / TICKS));
    const sound = str(item.sound, 120);
    return {
      segmentIds: list(item.segmentIds).map(String).filter((id) => known.has(id)), seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 4, description: str(item.description, 800),
      shotSize: oneOf(item.shotSize, SHOT_SIZES, "medium"), cameraMotion: oneOf(item.cameraMotion, CAMERA_MOTIONS, "static"), subjects: list(item.subjects).map((name) => str(name, 80)).filter(Boolean).slice(0, 6),
      setting: str(item.setting, 200), onScreenText: str(item.onScreenText, 120), transitionOut: str(item.transitionOut, 60) || "cut", ...(sound ? { sound } : {}),
    };
  });
  if (!drafts.length) problems.push("`shots` needs at least one shot");
  drafts.forEach((shot, index) => { if (!shot.description) problems.push(`shot ${index + 1}: \`description\` must be 1–800 characters`); if (!shot.segmentIds.length) problems.push(`shot ${index + 1}: \`segmentIds\` must name at least one segment id of the script`); });
  const covered = new Set(drafts.flatMap((shot) => shot.segmentIds));
  const missing = script.segments.filter((segment) => !covered.has(segment.id)).map((segment) => segment.id);
  if (missing.length) problems.push(`every segment must appear in a shot; not covered: ${missing.slice(0, 10).join(", ")}`);
  let last = -1;
  for (const shot of drafts) { const first = Math.min(...shot.segmentIds.map((id) => order.get(id) ?? 0)); if (shot.segmentIds.length && first < last) { problems.push("shot order must follow segment order"); break; } if (shot.segmentIds.length) last = first; }
  if (problems.length) throw new ContractError("The shot list is not valid", problems);
  // A shot longer than 15 s becomes parts of at most 15 s that keep its description.
  const parts = drafts.flatMap((shot) => { const count = Math.ceil(shot.seconds / 15); return Array.from({ length: count }, () => ({ ...shot, seconds: shot.seconds / count })); });
  if (parts.length > 200) throw new ContractError("The shot list is not valid", ["at most 200 shots"]);
  const taken = new Set<string>();
  const openers = parts.map((shot) => { let opens = false; for (const id of shot.segmentIds) { if (!taken.has(id) && isSpoken(script.segments[order.get(id)!])) opens = true; taken.add(id); } return opens; });
  const wanted = Math.round(scriptSeconds(script) * TICKS) + FIRST_SHOT_ROOM * openers.filter(Boolean).length, given = parts.reduce((sum, shot) => sum + shot.seconds * TICKS, 0);
  const scale = wanted / given;
  let sounds = 0;
  const shots: Shot[] = parts.map((shot, index) => {
    const { seconds, sound, ...rest } = shot;
    const keepSound = sound && sounds < 40 ? (sounds += 1, sound) : undefined;
    return { id: `shot_${index + 1}`, index, ...rest, duration_ticks: Math.min(SHOT_MAX, Math.max(SHOT_MIN, toFrame(seconds * TICKS * scale, params.frameRate))), ...(keepSound ? { sound: keepSound } : {}) };
  });
  return { shots };
}

/** The motion a still gets from the camera move its shot names. */
export const motionOf = (shot: Pick<Shot, "cameraMotion" | "index">): MotionPreset =>
  shot.cameraMotion === "static" ? "none" : shot.cameraMotion === "pull-out" ? "slow-zoom-out" : shot.cameraMotion === "pan" || shot.cameraMotion === "track" ? (shot.index % 2 ? "pan-right" : "pan-left") : "slow-zoom-in";

/** The words an image model receives for a shot: what is seen, how it is framed, and the look of the brief. */
export const shotPrompt = (shot: Shot, brief: Pick<Brief, "visualStyle">): string =>
  [shot.description, shot.setting && `Setting: ${shot.setting}.`, shot.subjects.length ? `Subjects: ${shot.subjects.join(", ")}.` : "", `Framing: ${shot.shotSize} shot.`, `Style: ${brief.visualStyle.text}`, `Palette: ${brief.visualStyle.palette.join(", ")}.`, "No text, captions or watermarks in the picture."].filter(Boolean).join(" ");
