import type { ProjectDocument } from "@jagentchill/protocol";
import { captionLineLength } from "../script/check.ts";
import { splitCues } from "../script/timeline.ts";
import { isSpoken, toFrame, type Brief, type CaptionSet, type Finding, type ReviewReport, type Script, type ShotList, type ShotMedia, type Take, type VoiceTrack } from "./contracts.ts";
import { TICKS, assumedShots, canvasOf, durationWindow, narrated, type VideoParams } from "./params.ts";

/** Deterministic steps of the template that need no model: shot timing from the takes, caption cues, the review's checks, the estimate. */
export const totalTicks = (shotList: ShotList): number => shotList.shots.reduce((sum, shot) => sum + shot.duration_ticks, 0);

/**
 * `timing`: a take belongs to the first shot that lists its segment and starts 0.2 s after that shot's start; the
 * takes of one shot follow each other 0.2 s apart. The shots that show a segment are extended — only the first of
 * them — when the takes with their lead-in and lead-out outlast them. Shots are never shortened.
 */
export function retime(shotList: ShotList, script: Script, takes: readonly Take[], params: Pick<VideoParams, "frameRate" | "targetDuration_s" | "voice">): { shotList: ShotList; voiceTrack: VoiceTrack } {
  // Everything on the timeline sits on the project's frame grid: the lead and the length a take is placed with.
  const frame = TICKS / params.frameRate, LEAD = toFrame(24_000, params.frameRate), placed = (take: Take): number => Math.max(frame, Math.floor((take.media.duration_ticks ?? 0) / frame) * frame);
  const takeOf = new Map(takes.map((take) => [take.segmentId, take])), owner = new Map<string, string>();
  for (const shot of shotList.shots) for (const id of shot.segmentIds) if (!owner.has(id)) owner.set(id, shot.id);
  const owned = (shotId: string) => script.segments.filter((segment) => owner.get(segment.id) === shotId && takeOf.has(segment.id));
  const shots = shotList.shots.map((shot) => {
    const mine = owned(shot.id);
    if (!mine.length) return shot;
    const needed = LEAD + mine.reduce((sum, segment) => sum + placed(takeOf.get(segment.id)!), 0) + LEAD * (mine.length - 1) + LEAD;
    // The later shots that show the same segments share the take's time.
    const ids = new Set(mine.map((segment) => segment.id));
    const available = shotList.shots.filter((other) => other.id === shot.id || (other.index > shot.index && other.segmentIds.some((id) => ids.has(id)) && !owned(other.id).length)).reduce((sum, other) => sum + other.duration_ticks, 0);
    return needed > available ? { ...shot, duration_ticks: shot.duration_ticks + toFrame(needed - available, params.frameRate) } : shot;
  });
  const track: VoiceTrack = { voices: takes.length ? { Narrator: params.voice } : {}, takes: [], total_ticks: 0, warnings: [] };
  let start = 0;
  for (const shot of shots) {
    let at = start + LEAD;
    for (const segment of owned(shot.id)) {
      const take = takeOf.get(segment.id)!, duration = placed(take);
      track.takes.push({ segmentId: segment.id, shotId: shot.id, media: take.media, start_ticks: at, duration_ticks: duration });
      at += duration + LEAD;
    }
    start += shot.duration_ticks;
  }
  track.total_ticks = start;
  const window = durationWindow(params.targetDuration_s), seconds = start / TICKS;
  if (takes.length && (seconds < window.min || seconds > window.max)) track.warnings.push(`VOICEOVER_DURATION_DRIFT: the narrated timeline lasts ${seconds.toFixed(1)} s, the target is ${params.targetDuration_s} s`);
  return { shotList: { shots }, voiceTrack: track };
}

/**
 * `captions`: cue text comes from the script, never from a transcription. With narration a segment's cues share its
 * take in proportion to their characters; without it they share the shots that list the segment.
 */
export function buildCaptions(script: Script, shotList: ShotList, voiceTrack: VoiceTrack | null, params: Pick<VideoParams, "aspectRatio" | "language" | "frameRate">): CaptionSet {
  const length = captionLineLength(params.aspectRatio), frame = TICKS / params.frameRate, end = totalTicks(shotList);
  const set: CaptionSet = { language: params.language, cues: [], warnings: [] };
  const starts = new Map<string, number>();
  let cursor = 0;
  for (const shot of shotList.shots) { starts.set(shot.id, cursor); cursor += shot.duration_ticks; }
  let floor = 0;
  for (const segment of script.segments) {
    if (!isSpoken(segment)) continue;
    const take = voiceTrack?.takes.find((entry) => entry.segmentId === segment.id), listing = shotList.shots.filter((shot) => shot.segmentIds.includes(segment.id));
    if (!take && (voiceTrack?.takes.length || !listing.length)) continue;
    const from = Math.max(floor, take ? take.start_ticks : starts.get(listing[0].id)!), to = Math.min(end, take ? take.start_ticks + take.duration_ticks : starts.get(listing.at(-1)!.id)! + listing.at(-1)!.duration_ticks);
    if (to - from < frame) continue;
    const texts = splitCues(segment.text, length), characters = texts.reduce((sum, text) => sum + text.length, 0) || 1;
    let at = from;
    texts.forEach((text, index) => {
      const stop = index === texts.length - 1 ? to : Math.min(to, toFrame(at + ((to - from) * text.length) / characters, params.frameRate));
      // A cue lasts at most 7 s; the rest of a longer share stays empty.
      if (stop - at >= frame) set.cues.push({ segmentId: segment.id, text, start_ticks: at, duration_ticks: Math.min(7 * TICKS, stop - at), speaker: segment.speaker });
      at = stop;
    });
    floor = to;
  }
  if (voiceTrack?.takes.length && set.cues.length) set.warnings.push("CAPTIONS_APPROXIMATE_TIMING: cue times follow the length of the text, not the spoken words");
  return set;
}

/**
 * `review_checks`: what can be decided without a model, read from the assembled project itself.
 * `score` = max(0, 100 − 25 × blockers − 5 × warnings).
 */
export function reviewChecks(project: ProjectDocument, input: { params: VideoParams; brief: Brief; script: Script; shotList: ShotList; shotMedia: readonly ShotMedia[]; voiceTrack: VoiceTrack | null; captions: CaptionSet | null; stepWarnings: readonly string[]; /** The recordings with what their listener said, when the run made any. */ takes?: readonly Take[] }): ReviewReport {
  const findings: Finding[] = [], scene = project.scenes[0], main = (scene?.tracks.main.elements ?? []) as Array<{ startTime: number; duration: number }>;
  const duration = main.reduce((latest, element) => Math.max(latest, element.startTime + element.duration), 0), seconds = duration / TICKS, target = input.params.targetDuration_s, window = durationWindow(target);
  if (seconds < window.min || seconds > window.max) {
    const far = Math.abs(seconds - target) > target * 0.25;
    findings.push({ code: "REVIEW_DURATION_OUT_OF_RANGE", severity: far ? "blocker" : "warning", message: `The video lasts ${seconds.toFixed(1)} s; the brief asks for ${target} s.` });
  }
  const canvas = canvasOf(input.params.aspectRatio, input.params.resolution), size = project.settings.canvasSize;
  if (Math.abs(size.width / size.height - canvas.width / canvas.height) > 0.01) findings.push({ code: "REVIEW_ASPECT_MISMATCH", severity: "blocker", message: `The project is ${size.width}×${size.height}; the brief asks for ${input.params.aspectRatio}.` });
  let cursor = 0;
  for (const element of [...main].sort((a, b) => a.startTime - b.startTime)) {
    if (element.duration <= 0 || element.startTime !== cursor) { findings.push({ code: "REVIEW_MAIN_TRACK_GAP", severity: "blocker", message: `The main track has a gap or an empty clip at ${(cursor / TICKS).toFixed(1)} s.` }); break; }
    cursor += element.duration;
  }
  if (main.length !== input.shotList.shots.length) findings.push({ code: "REVIEW_SHOT_COUNT", severity: "blocker", message: `The timeline has ${main.length} clips for ${input.shotList.shots.length} shots.` });
  if (narrated(input.params)) {
    const voiced = new Set(input.voiceTrack?.takes.map((take) => take.segmentId));
    const silent = input.script.segments.filter((segment) => isSpoken(segment) && !voiced.has(segment.id));
    if (silent.length) findings.push({ code: "REVIEW_SEGMENT_WITHOUT_AUDIO", severity: "blocker", message: `${silent.length} spoken ${silent.length === 1 ? "line has" : "lines have"} no voice recording.` });
  }
  if (input.captions?.cues.some((cue) => cue.start_ticks + cue.duration_ticks > duration)) findings.push({ code: "REVIEW_CAPTION_OUTSIDE", severity: "blocker", message: "A caption ends after the video does." });
  for (const media of input.shotMedia) if (media.media?.height && media.media.width && Math.min(media.media.width, media.media.height) < Math.min(canvas.width, canvas.height) / 2) { findings.push({ code: "REVIEW_LOW_RESOLUTION", severity: "warning", message: "At least one picture is smaller than half of the video's resolution." }); break; }
  for (const warning of input.stepWarnings) { const [code, ...rest] = warning.split(": "); findings.push({ code, severity: "warning", message: rest.join(": ") || code }); }
  // What the film engine's own checks said: every picture was shown to the Vision model, every recording listened to — or was not, and then it is said.
  const drawn = input.shotMedia.filter((media) => media.media && !media.replaced), looked = drawn.filter((media) => media.check), wrong = looked.filter((media) => !media.check!.ok);
  if (wrong.length) findings.push({ code: "REVIEW_PICTURE_MISMATCH", severity: "warning", message: `${wrong.length} ${wrong.length === 1 ? "picture is" : "pictures are"} not the shot that was asked: ${wrong[0].check!.why}` });
  if (drawn.length && looked.length === drawn.length && !wrong.length) findings.push({ code: "REVIEW_FRAMES_CHECKED", severity: "info", message: `Every picture was checked against its shot (${drawn.length} of ${drawn.length}).` });
  else if (drawn.length > looked.length) findings.push({ code: "REVIEW_FRAMES_UNAVAILABLE", severity: "info", message: `${drawn.length - looked.length} of ${drawn.length} pictures were not checked against their shot: look at the preview before accepting.` });
  const takes = input.takes ?? [], unlike = takes.filter((take) => take.check?.ok === false), unheard = takes.filter((take) => !take.check);
  if (unlike.length) findings.push({ code: "REVIEW_VOICE_MISMATCH", severity: "warning", message: `${unlike.length} voice ${unlike.length === 1 ? "line does" : "lines do"} not match ${unlike.length === 1 ? "its" : "their"} words after three recordings (heard: "${unlike[0].check!.heard.slice(0, 80)}").` });
  if (takes.length && unheard.length) findings.push({ code: "REVIEW_VOICE_UNCHECKED", severity: "info", message: `${unheard.length} of ${takes.length} voice lines were not listened to: no transcription model could be asked.` });
  else if (takes.length && !unlike.length) findings.push({ code: "REVIEW_VOICE_CHECKED", severity: "info", message: `Every voice line was listened to and is its words (${takes.length} of ${takes.length}).` });
  const blockers = findings.filter((finding) => finding.severity === "blocker").length, warnings = findings.filter((finding) => finding.severity === "warning").length;
  return { findings, score: Math.max(0, 100 - 25 * blockers - 5 * warnings), duration_s: Math.round(seconds * 10) / 10, target_s: target, shots: main.length, passed: blockers === 0 };
}

export type StageEstimate = { stage: string; label: string; count: number; unitUsd: number | null; lowUsd: number | null; highUsd: number | null; source: string; note?: string; /** Ruling R10: the amount is worked out from a measured prompt size — shown with "about". */ measured?: true; /** The step runs on the person's own signed-in account (ruling R9): it is no money row — it has no price to show, and it is said in the one line about that account. */ ownAccount?: true };
/**
 * The rows of an estimate that are MONEY rows: a step that is used and that this app bills. Not among them: a step on
 * the person's own account (said in one line, never as a price), a step that is not used, and a step no model does
 * (assembly) — none of them is shown as "$0.00".
 */
export const moneyStages = (stages: readonly StageEstimate[]): StageEstimate[] => stages.filter((stage) => !stage.ownAccount && stage.count > 0 && !(stage.unitUsd === 0 && stage.source === "No model"));
export type RunEstimate = { stages: StageEstimate[]; lowUsd: number; highUsd: number; unknown: boolean; low_s: number; high_s: number; assumptions: string[]; willRunWithout: string[]; /** Work that runs on the person's own signed-in account (Claude Code, Codex): not billed by this app, in no amount and no question — said in one quiet line. */ ownAccount?: { label: string; model: string; account?: string }[] };
export type UnitPrice = { usd: number | null; label: string } | null;
/**
 * The estimate of a run before it starts: one picture per shot (the high figure allows every picture to be made twice),
 * one take per spoken segment, one music track; writing and assembly at no generation cost. `shots` is the real count
 * once the shot list exists. A capability without a provider is listed under "Will run without".
 */
export function estimateRun(params: VideoParams, prices: { image: UnitPrice; speech: UnitPrice; music: UnitPrice }, counts?: { shots: number; spoken: number }): RunEstimate {
  const shots = counts?.shots ?? assumedShots(params.targetDuration_s), spoken = narrated(params) && prices.speech ? counts?.spoken ?? shots : 0, music = params.musicMood !== "none" && prices.music ? 1 : 0;
  const times = (unit: UnitPrice, count: number, factor = 1): number | null => (count === 0 ? 0 : unit?.usd === null || unit?.usd === undefined ? null : Math.round(unit.usd * count * factor * 10_000) / 10_000);
  const free = (stage: string, label: string): StageEstimate => ({ stage, label, count: 1, unitUsd: 0, lowUsd: 0, highUsd: 0, source: "Chat model" });
  const stages: StageEstimate[] = [
    free("brief", "Brief"), free("script_draft", "Script"), free("shot_list", "Shot list"),
    { stage: "assets", label: "Pictures", count: shots, unitUsd: prices.image?.usd ?? null, lowUsd: times(prices.image, shots), highUsd: times(prices.image, shots, 2), source: prices.image?.label ?? "No provider" },
    { stage: "voiceover", label: "Voice", count: spoken, unitUsd: prices.speech?.usd ?? null, lowUsd: times(prices.speech, spoken), highUsd: times(prices.speech, spoken, 2), source: prices.speech?.label ?? "No provider" },
    { stage: "music", label: "Music", count: music, unitUsd: prices.music?.usd ?? null, lowUsd: times(prices.music, music), highUsd: times(prices.music, music, 2), source: prices.music?.label ?? "No provider" },
    { stage: "assemble", label: "Assemble", count: 1, unitUsd: 0, lowUsd: 0, highUsd: 0, source: "No model" },
  ];
  const willRunWithout = [narrated(params) && !prices.speech ? "Voice — no speech provider is connected" : "", params.musicMood !== "none" && !prices.music ? "Music — no music provider is connected" : ""].filter(Boolean);
  const sum = (key: "lowUsd" | "highUsd") => Math.round(stages.reduce((total, stage) => total + (stage[key] ?? 0), 0) * 10_000) / 10_000;
  const jobs = shots + spoken + music;
  return {
    stages, lowUsd: sum("lowUsd"), highUsd: sum("highUsd"), unknown: stages.some((stage) => stage.lowUsd === null), low_s: 30 + jobs * 4, high_s: 120 + jobs * 30,
    assumptions: [`${shots} ${shots === 1 ? "shot" : "shots"}`, `${spoken} spoken ${spoken === 1 ? "line" : "lines"}`, "1 picture per shot; the high figure allows each to be made twice"], willRunWithout,
  };
}
