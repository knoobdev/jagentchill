// Engine runs here use a test executor for the `tool` steps (the pure functions of the template, with fixed media facts in place of generated files): the host's step tools need a database and a provider and are tested in server/test/prompt-video.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { promptVideo as pv, validateProjectDocument, workflow as wf } from "../src/index.ts";
import { seeded } from "./support/script.ts";
import { harness, settle } from "./support/workflows.ts";

const params = (patch: Partial<pv.VideoParams> = {}): pv.VideoParams => ({ ...pv.DEFAULT_PARAMS, prompt: "A short film about tea", ...patch });
const rawBrief = {
  title: "Tea at dawn", intent: "story", audience: "Tea drinkers", tone: "Calm", keyMessages: [{ text: "Tea starts the day", evidence: "assumption" }],
  structure: [{ label: "Open", targetDuration_s: 5 }, { label: "Middle", targetDuration_s: 10 }, { label: "Close", targetDuration_s: 5 }],
  visualStyle: { text: "Soft morning light", palette: ["#112233", "#445566", "#778899"] }, narrationPolicy: "voiceover", musicDirection: "Quiet strings",
  openQuestions: [{ id: "q1", question: "Which tea?", suggestedAnswers: ["Green", "Black"] }],
};
/** `count` narration lines of about `seconds` each (English reads at 2.5 words a second). */
const rawScript = (count: number, seconds: number) => ({ title: "Tea", segments: Array.from({ length: count }, (_value, index) => ({ beatLabel: `Beat ${index + 1}`, kind: "narration", text: Array.from({ length: Math.round(seconds * 2.5) }, (_word, word) => `word${word}`).join(" ") })) });
const rawShots = (script: pv.Script, extra: Record<string, unknown> = {}) => ({ shots: script.segments.map((segment, index) => ({ segmentIds: [segment.id], duration_s: segment.estimatedDuration_s, description: `Picture ${index + 1}`, cameraMotion: index % 2 ? "static" : "push-in", ...extra })) });
const file = (name: string, kind: "image" | "audio", seconds?: number): pv.MediaFile => ({ blobId: name.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64), name, kind, bytes: 1000, ...(kind === "image" ? { width: 1080, height: 1920 } : { duration_ticks: Math.round(seconds! * pv.TICKS) }), provenance: { source: "ai", provider: "fake", model: "fake-model", role: kind === "image" ? "image" : "tts", prompt: name, jobId: "job-1", cost: { amount: 0.011, currency: "USD" }, created_ms: 5, referenceAssetIds: [] } });
const mediaFor = (shotList: pv.ShotList): pv.ShotMedia[] => shotList.shots.map((shot) => ({ shotId: shot.id, method: "image", prompt: shot.description, motion: pv.motionOf(shot), media: file(`${shot.index}a`, "image"), costUsd: 0.011 }));
const ids = seeded(7);
const build = (input: Omit<pv.AssembleInput, "runId" | "runNumber" | "projectId" | "artifactVersionId">) => pv.assembleProject({ runId: "run_1", runNumber: 4, projectId: "11111111-1111-4111-8111-111111111111", artifactVersionId: "v1", ...input }, { newId: ids, now_ms: 99 });
const tracks = (document: ReturnType<typeof build>["document"], name: string) => [...document.scenes[0].tracks.overlay, ...document.scenes[0].tracks.audio].find((track) => track.name === name) as unknown as { elements: Array<Record<string, any>>; ducking?: { enabled: boolean; amount: number } } | undefined;

/** A whole narrated run's artifacts: 20 s, 5 lines, 5 shots. */
function artifacts(patch: Partial<pv.VideoParams> = {}, takeSeconds = 3.2) {
  const p = params({ targetDuration_s: 20, ...patch }), brief = pv.applyBriefDefaults(pv.normaliseBrief(rawBrief, p));
  const script = pv.normaliseScript(rawScript(5, pv.speechTarget_s(p) / 5), p), drafted = pv.normaliseShotList(rawShots(script), script, p);
  const takes = pv.narrated(p) ? script.segments.map((segment, index) => ({ segmentId: segment.id, media: file(`${index}b`, "audio", takeSeconds) })) : [];
  const timed = pv.retime(drafted, script, takes, p), captions = pv.buildCaptions(script, timed.shotList, takes.length ? timed.voiceTrack : null, p);
  return { p, brief, script, drafted, takes, ...timed, captions, shotMedia: mediaFor(timed.shotList) };
}

test("Template validates: the document has no errors and every step is a type the engine runs", () => {
  const doc = pv.buildTemplate(1000), validation = wf.validate(wf.parseDocument(doc));
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(doc.nodes.map((node) => node.id), ["start", "brief", "check_brief", "script_draft", "script_approve", "shot_list", "check_shot_list", "assets", "pictures_gate", "fix_pictures", "assets_again", "pictures_gate_2", "fix_pictures_2", "assets_again_2", "pictures_gate_3", "fix_pictures_3", "assets_again_3", "pictures", "voiceover", "music", "timing", "captions", "assemble", "review_checks", "check_final"]);
  assert.equal(doc.id, "tpl.one-prompt-video");
  assert.ok(!wf.OFFERED_NODE_TYPES.some((info) => info.type === "tool"), "the tool step is not in the palette");
});

test("Minimal input: a prompt of 1 character is accepted with the defaults", () => {
  const resolved = wf.resolveParams(pv.buildTemplate(1), { prompt: "x" });
  assert.deepEqual(resolved, { prompt: "x", targetDuration_s: 30, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, language: "en", style: "auto", voice: "auto", musicMood: "auto", captions: true, mode: "checkpoints" });
  assert.deepEqual(pv.checkInput(resolved as pv.VideoParams), []);
});
test("Prompt too long: 4,001 characters is refused under the field", () => {
  assert.deepEqual(pv.checkInput(params({ prompt: "x".repeat(4001) })), [{ field: "prompt", message: "Prompt must be 4,000 characters or fewer" }]);
});
test("Neither prompt nor script: the form says what is missing", () => {
  assert.equal(pv.checkInput(params({ prompt: "  " }))[0].message, "Write a prompt or choose a script");
});
test("Preset fills the form: Product advertisement sets what it lists and nothing else", () => {
  const preset = pv.PARAM_PRESETS.find((entry) => entry.label === "Product advertisement")!, filled = { ...pv.DEFAULT_PARAMS, ...preset.set };
  assert.deepEqual([filled.targetDuration_s, filled.aspectRatio, filled.style, filled.musicMood], [30, "1:1", "clean-product", "corporate"]);
  assert.equal(filled.frameRate, 30);
  assert.equal(pv.PARAM_PRESETS.length, 4);
});
test("Style list is complete offline: the ten presets in table order", () => {
  assert.deepEqual(pv.STYLE_PRESETS.map((preset) => preset.id), ["cinematic", "clean-product", "documentary", "bold-social", "flat-illustration", "hand-drawn", "3d-render", "retro-film", "noir", "minimal-type"]);
});

test("Brief generated: the run's constraints are written in and beat durations sum to the target", () => {
  const brief = pv.normaliseBrief(rawBrief, params({ targetDuration_s: 30, style: "noir" }));
  assert.deepEqual(brief.constraints, { aspectRatio: "9:16", language: "en", duration: 30, mustInclude: [], mustAvoid: [] });
  assert.equal(Math.round(brief.structure.reduce((sum, beat) => sum + beat.targetDuration_s, 0) * 10) / 10, 30);
  assert.equal(brief.visualStyle.presetId, "noir");
  assert.ok(brief.assumptions.some((entry) => entry.text === "Tea starts the day"), "a message that is an assumption is listed");
  assert.equal(pv.normaliseBrief(rawBrief, params({ voice: "none" })).narrationPolicy, "none");
});
test("Invalid brief is corrected: the problems are sentences a model can act on", () => {
  assert.throws(() => pv.normaliseBrief({ title: "x" }, params()), (error: pv.ContractError) => error.code === "WORKFLOW_OUTPUT_INVALID" && error.problems.some((problem) => problem.includes("keyMessages")) && error.problems.some((problem) => problem.includes("palette")));
  assert.deepEqual(pv.extractJson("Here it is:\n```json\n{\"a\": 1}\n```"), { a: 1 });
  assert.deepEqual(pv.extractJson("Sure. {\"a\": 2} Done."), { a: 2 });
});
test("Open questions at the checkpoint: every question leaves the defaults step with an answer and an assumption", () => {
  const brief = pv.applyBriefDefaults(pv.normaliseBrief(rawBrief, params()));
  assert.equal(brief.openQuestions[0].answer, "Green");
  assert.ok(brief.assumptions.some((entry) => entry.text === "Which tea? — Green" && entry.source === "default-answer"));
});

test("Script within the speech target: a narrated 30 s run is written to 26.8 s", () => {
  const p = params({ targetDuration_s: 30 });
  assert.equal(Math.round(pv.speechTarget_s(p) * 10) / 10, 26.8);
  const script = pv.normaliseScript(rawScript(8, 26.8 / 8), p);
  assert.equal(script.segments.length, 8);
  assert.ok(Math.abs(pv.scriptSeconds(script) - 26.8) <= 2.68);
  assert.deepEqual(script.segments.map((segment) => segment.id).slice(0, 2), ["seg_1", "seg_2"]);
});
test("Silent run uses the full duration: without a voice the words are shown, not spoken", () => {
  const p = params({ targetDuration_s: 20, voice: "none" });
  assert.equal(pv.speechTarget_s(p), 20);
  const script = pv.normaliseScript({ segments: Array.from({ length: 5 }, (_value, index) => ({ kind: "narration", text: `Line ${index}`, estimatedDuration_s: 4 })) }, p);
  assert.ok(script.segments.every((segment) => segment.kind === "on-screen-text"));
  assert.equal(pv.scriptSeconds(script), 20);
});
test("Duration cannot be met: a script far from its target is a constraint violation that says by how much", () => {
  assert.throws(() => pv.normaliseScript(rawScript(2, 3), params({ targetDuration_s: 30 })), (error: pv.ContractError) => error.code === "SCRIPT_CONSTRAINT_VIOLATION" && /add to it by about/.test(error.problems[0]));
});

test("Coverage of the script: a segment no shot lists is refused by name", () => {
  const { p, script } = artifacts();
  const raw = rawShots(script);
  raw.shots.pop();
  assert.throws(() => pv.normaliseShotList(raw, script, p), (error: pv.ContractError) => error.problems.some((problem) => problem.includes("seg_5")));
});
test("Shot duration bounds: a shot longer than 15 s is split into parts that keep its description", () => {
  const p = params({ targetDuration_s: 40, voice: "none" }), script = pv.normaliseScript({ segments: [{ kind: "silent", text: "", estimatedDuration_s: 40 }] }, p);
  const list = pv.normaliseShotList({ shots: [{ segmentIds: ["seg_1"], duration_s: 40, description: "A long take" }] }, script, p);
  assert.equal(list.shots.length, 3);
  assert.ok(list.shots.every((shot) => shot.description === "A long take" && shot.duration_ticks <= 15 * pv.TICKS && shot.duration_ticks >= pv.TICKS));
});
test("Durations normalised: shots sum to the script's estimate plus 0.4 s per shot that opens a spoken line, on whole frames", () => {
  const { p, script, drafted } = artifacts();
  const frame = pv.TICKS / p.frameRate, wanted = Math.round(pv.scriptSeconds(script) * pv.TICKS) + 48_000 * 5;
  assert.ok(drafted.shots.every((shot) => shot.duration_ticks % frame === 0));
  assert.ok(Math.abs(pv.totalTicks(drafted) - wanted) <= frame * 5);
});
test("Shot count limit: more than 200 shots is a violation", () => {
  const p = params({ targetDuration_s: 600, voice: "none" }), script = pv.normaliseScript({ segments: [{ kind: "silent", text: "", estimatedDuration_s: 600 }] }, p);
  assert.throws(() => pv.normaliseShotList({ shots: Array.from({ length: 201 }, () => ({ segmentIds: ["seg_1"], duration_s: 3, description: "x" })) }, script, p), /at most 200 shots/);
});

test("Shots re-timed to speech: a take starts 0.2 s into its shot and a shot is extended, never shortened", () => {
  const { drafted, shotList, voiceTrack, p } = artifacts({}, 5);
  const frame = pv.TICKS / p.frameRate;
  assert.equal(voiceTrack.takes[0].start_ticks, 24_000);
  shotList.shots.forEach((shot, index) => {
    assert.ok(shot.duration_ticks >= drafted.shots[index].duration_ticks);
    assert.ok(shot.duration_ticks >= 5 * pv.TICKS + 48_000 && shot.duration_ticks % frame === 0);
  });
  assert.equal(voiceTrack.total_ticks, pv.totalTicks(shotList));
});
test("Duration drift: takes that outlast the target are reported, and takes inside the window are not", () => {
  assert.match(artifacts({}, 6).voiceTrack.warnings[0], /^VOICEOVER_DURATION_DRIFT/);
  assert.deepEqual(artifacts({}, 3.2).voiceTrack.warnings, []);
});
test("Timing without takes: shot durations are unchanged and the voice track is empty", () => {
  const { drafted, shotList, voiceTrack } = artifacts({ voice: "none" });
  assert.deepEqual(shotList, drafted);
  assert.deepEqual(voiceTrack.takes, []);
});

test("Cue text matches the script: cues hold the script's words inside their take and never overlap", () => {
  const { script, captions, voiceTrack } = artifacts();
  assert.ok(captions.cues.length >= 5);
  for (const segment of script.segments) assert.equal(captions.cues.filter((cue) => cue.segmentId === segment.id).map((cue) => cue.text.replace(/\n/g, " ")).join(" "), segment.text);
  captions.cues.forEach((cue, index) => { if (index) assert.ok(cue.start_ticks >= captions.cues[index - 1].start_ticks + captions.cues[index - 1].duration_ticks); });
  const take = voiceTrack.takes[0], first = captions.cues.filter((cue) => cue.segmentId === take.segmentId);
  assert.equal(first[0].start_ticks, take.start_ticks);
  assert.ok(first.at(-1)!.start_ticks + first.at(-1)!.duration_ticks <= take.start_ticks + take.duration_ticks);
  assert.match(captions.warnings[0], /^CAPTIONS_APPROXIMATE_TIMING/);
});
test("Line length for vertical video: at most 2 lines of 24 characters at 9:16 and of 42 at 16:9", () => {
  for (const [aspectRatio, length] of [["9:16", 24], ["16:9", 42]] as const) {
    const { captions } = artifacts({ aspectRatio });
    for (const cue of captions.cues) { const lines = cue.text.split("\n"); assert.ok(lines.length <= 2 && lines.every((line) => line.length <= length), cue.text); }
  }
});

test("Timeline structure: contiguous clips on the main track, Voiceover, captions and Music, every element linked to the run", () => {
  // Takes and music as a provider returns them: lengths that are on no frame grid.
  const made = artifacts({}, 3.2173), { document, report } = build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: made.voiceTrack, captions: made.captions, music: { media: file("cc", "audio", 3.0101), mood: "calm" } });
  assert.ok(validateProjectDocument(document, { mode: "strict" }).ok, JSON.stringify(validateProjectDocument(document, { mode: "strict" })).slice(0, 600));
  const main = document.scenes[0].tracks.main.elements as Array<Record<string, any>>;
  assert.equal(main.length, 5);
  let cursor = 0;
  for (const element of main) { assert.equal(element.startTime, cursor); cursor += element.duration; assert.equal(element.workflowLink.runId, "run_1"); assert.equal(element.type, "image"); }
  assert.equal(tracks(document, "Voiceover")!.elements.length, 5);
  assert.ok(tracks(document, "Voiceover")!.elements.every((element) => element.isVoice === true && element.workflowLink.runId === "run_1"));
  assert.equal(tracks(document, "Captions")!.elements.length, made.captions.cues.length);
  assert.equal(document.scenes[0].name, "Video 4");
  assert.deepEqual((document as any).workflowLink, { runId: "run_1" });
  assert.deepEqual(document.settings.canvasSize, { width: 1080, height: 1920 });
  assert.deepEqual([report.clips, report.voiceElements, report.captionCues, report.duration_ticks], [5, 5, made.captions.cues.length, cursor]);
  assert.equal(document.media.assets.length, 5 + 5 + 1);
});
test("Still with a motion preset: slow-zoom-in is two keys, 1.00 at the first frame and 1.08 at the last", () => {
  const keys = pv.motionKeys("slow-zoom-in", 4 * pv.TICKS, 4000, 1080, seeded(1)) as Record<string, { keys: Array<{ time: number; value: number }> }>;
  for (const path of ["transform.scale.x", "transform.scale.y"]) assert.deepEqual(keys[path].keys.map((key) => [key.time, key.value]), [[0, 1], [4 * pv.TICKS - 4000, 1.08]]);
  assert.equal(pv.motionKeys("none", 4 * pv.TICKS, 4000, 1080, seeded(1)), undefined);
  const made = artifacts(), { document } = build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: null, captions: null, music: null });
  const main = document.scenes[0].tracks.main.elements as Array<Record<string, any>>;
  assert.ok(main[0].animations["transform.scale.x"], "a push-in shot zooms");
  assert.equal(main[1].animations, undefined, "a static shot has no key");
});
test("Music shorter than the timeline: the clip repeats without its own fading tail and every seam is a real crossfade — the RENDERED level never drops there — it ends with a 1.5 s fade-out, sits at −18 dB and is ducked", async () => {
  const { fadeGain } = await import("../src/audio/processing.ts");
  const made = artifacts(), { document, report } = build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: made.voiceTrack, captions: null, music: { media: file("cc", "audio", 8), mood: "calm" } });
  const lanes = [tracks(document, "Music")!, tracks(document, "Music (crossfade)")!], total = pv.totalTicks(made.shotList);
  const music = { elements: lanes.flatMap((lane) => lane.elements).sort((a, b) => a.startTime - b.startTime), ducking: lanes[0].ducking }, last = music.elements.at(-1)!;
  // An 8-second clip gives up its last 1.6 s (a fifth, at most 3 s): a repeat starts every 6.4 s and plays 0.4 s into the next one.
  const step = 6.4 * pv.TICKS, seam = 0.4 * pv.TICKS;
  assert.equal(music.elements.length, Math.ceil(total / step));
  assert.deepEqual([music.elements[0].startTime, music.elements[1].startTime, music.elements[0].duration], [0, step, step + seam]);
  // Pieces that sound at once are on different tracks; no track has two elements over each other.
  for (const lane of lanes) assert.ok(lane.elements.every((element, index) => index === 0 || element.startTime >= lane.elements[index - 1].startTime + lane.elements[index - 1].duration), "no overlap inside a track");
  assert.ok(lanes[0].elements.length > 0 && lanes[1].elements.length > 0 && lanes.every((lane) => lane.ducking?.enabled === true));
  // The level as it is rendered: the power of every music element sounding at a moment, from the renderer's own fade
  // gain. Through every seam it holds (equal power: 1); the film ends in the long fade. Abutting pieces that each fade
  // to zero — what this replaced — measure 0 at every seam.
  const power = (tick: number) => music.elements.reduce((sum, element) => (tick >= element.startTime && tick < element.startTime + element.duration ? sum + fadeGain(tick - element.startTime, element.duration, element.fadeIn, element.fadeOut) ** 2 : sum), 0);
  let lowest = Number.POSITIVE_INFINITY;
  for (let tick = 0; tick < total - 1.5 * pv.TICKS; tick += pv.TICKS / 100) lowest = Math.min(lowest, power(tick));
  assert.ok(lowest > 0.98, `the lowest rendered power before the final fade is ${lowest}`);
  for (let index = 1; index < music.elements.length; index++) assert.ok(Math.abs(power(music.elements[index].startTime + seam / 2) - 1) < 0.02, `seam ${index}`);
  assert.ok(power(total - 1) < 0.01, "the film ends in silence");
  assert.equal(last.startTime + last.duration, total);
  assert.equal(last.fadeOut.duration, Math.min(1.5 * pv.TICKS, last.duration - (last.fadeIn?.duration ?? 0)));
  assert.ok((last.fadeIn?.duration ?? 0) + last.fadeOut.duration <= last.duration);
  assert.ok(music.elements.every((element) => element.volume === -18));
  assert.deepEqual([music.ducking!.enabled, music.ducking!.amount], [true, 12]);
  assert.equal(report.musicElements, music.elements.length);
});
test("Skipped inputs: without voice, captions and music the timeline holds the clips and the shown words only", () => {
  const made = artifacts({ voice: "none", musicMood: "none", captions: false });
  const { document } = build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: null, captions: null, music: null });
  assert.equal(document.scenes[0].tracks.audio.length, 0);
  assert.deepEqual(document.scenes[0].tracks.overlay.map((track) => track.name), ["Titles"]);
});
test("No model in assembly: the same inputs give byte-identical documents", () => {
  const made = artifacts(), input = { params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: made.voiceTrack, captions: made.captions, music: null };
  const once = (seed: number) => JSON.stringify(pv.assembleProject({ runId: "run_1", runNumber: 1, projectId: "11111111-1111-4111-8111-111111111111", artifactVersionId: "v1", ...input }, { newId: seeded(seed), now_ms: 5 }).document);
  assert.equal(once(3), once(3));
});
test("Missing asset: a shot without a picture is never replaced by dummy media", () => {
  const made = artifacts(), shotMedia = made.shotMedia.map((entry, index) => (index === 2 ? { ...entry, media: null } : entry));
  assert.throws(() => build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia, voiceTrack: null, captions: null, music: null }), (error: pv.AssembleError) => error.code === "INVALID_PARAMS" && /Shot 3 has no picture/.test(error.message));
});

const review = (made: ReturnType<typeof artifacts>, stepWarnings: string[] = []) => {
  const { document } = build({ params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: made.voiceTrack, captions: made.captions, music: null });
  return pv.reviewChecks(document, { params: made.p, brief: made.brief, script: made.script, shotList: made.shotList, shotMedia: made.shotMedia, voiceTrack: made.voiceTrack, captions: made.captions, stepWarnings });
};
test("Narrated run that obeyed every rule passes: no blocker, score 100", () => {
  const report = review(artifacts());
  assert.deepEqual(report.findings.filter((finding) => finding.severity !== "info"), []);
  assert.deepEqual([report.score, report.passed, report.shots], [100, true, 5]);
});
test("Score formula: 1 blocker and 3 warnings score 60", () => {
  const made = artifacts({}, 8);
  const report = review(made, ["A: one", "B: two", "C: three"].slice(0, 2));
  const blockers = report.findings.filter((finding) => finding.severity === "blocker").length, warnings = report.findings.filter((finding) => finding.severity === "warning").length;
  assert.equal(report.score, Math.max(0, 100 - 25 * blockers - 5 * warnings));
  assert.ok(blockers >= 1 && !report.passed);
});
test("Duration window: 33.0 s passes for a 30 s target, 34.0 s is a warning and 38.0 s a blocker", () => {
  assert.deepEqual(pv.durationWindow(30), { min: 27, max: 33 });
  assert.deepEqual(pv.durationWindow(10), { min: 8, max: 12 });
  const severityAt = (seconds: number) => {
    const p = params({ targetDuration_s: 30, voice: "none" }), script = pv.normaliseScript({ segments: [{ kind: "silent", text: "", estimatedDuration_s: 30 }] }, p);
    const shotList = { shots: pv.normaliseShotList({ shots: [{ segmentIds: ["seg_1"], duration_s: 10, description: "a" }, { segmentIds: ["seg_1"], duration_s: 10, description: "b" }, { segmentIds: ["seg_1"], duration_s: 10, description: "c" }] }, script, p).shots.map((shot) => ({ ...shot, duration_ticks: Math.round((seconds / 3) * pv.TICKS / 4000) * 4000 })) };
    const brief = pv.normaliseBrief(rawBrief, p), shotMedia = mediaFor(shotList);
    const { document } = build({ params: p, brief, script, shotList, shotMedia, voiceTrack: null, captions: null, music: null });
    return pv.reviewChecks(document, { params: p, brief, script, shotList, shotMedia, voiceTrack: null, captions: null, stepWarnings: [] }).findings.find((finding) => finding.code === "REVIEW_DURATION_OUT_OF_RANGE")?.severity;
  };
  assert.deepEqual([severityAt(33), severityAt(34.2), severityAt(38.1)], [undefined, "warning", "blocker"]);
});

test("Estimate displayed: a 30 s run assumes 8 shots, lists every step and gives a cost range", () => {
  const estimate = pv.estimateRun(params({ targetDuration_s: 30 }), { image: { usd: 0.011, label: "Image model" }, speech: { usd: 0.0004, label: "Speech model" }, music: { usd: 0.04, label: "Music model" } });
  assert.ok(estimate.assumptions.includes("8 shots"));
  assert.deepEqual(estimate.stages.map((stage) => stage.stage), ["brief", "script_draft", "shot_list", "assets", "voiceover", "music", "assemble"]);
  assert.equal(estimate.lowUsd, Math.round((8 * 0.011 + 8 * 0.0004 + 0.04) * 10_000) / 10_000);
  assert.equal(estimate.highUsd, Math.round(2 * (8 * 0.011 + 8 * 0.0004 + 0.04) * 10_000) / 10_000);
  assert.ok(estimate.low_s < estimate.high_s);
});
test("Estimate refined: the approved shot list's real count replaces the assumption", () => {
  const estimate = pv.estimateRun(params({ targetDuration_s: 30 }), { image: { usd: 0.011, label: "Image model" }, speech: null, music: null }, { shots: 14, spoken: 14 });
  assert.ok(estimate.assumptions.includes("14 shots"));
  assert.equal(estimate.stages.find((stage) => stage.stage === "assets")!.lowUsd, 0.154);
  assert.deepEqual(estimate.willRunWithout, ["Voice — no speech provider is connected", "Music — no music provider is connected"]);
});

/** The template on the real engine, its `tool` steps answered by the pure functions. */
function run(patch: Partial<pv.VideoParams> = {}, override?: "auto", needs: number[] = []) {
  const doc = pv.buildTemplate(1000), calls: string[] = [], patchNeeds = [...needs];
  const state = wf.newRunState({ runId: "run1", number: 1, origin: "user", doc: override ? { ...doc, settings: { ...doc.settings, approvalOverride: { mode: override } } } : doc, params: wf.resolveParams(doc, { ...params({ targetDuration_s: 20 }), ...patch }), now: 10_000 });
  const h = harness(doc, {
    state,
    executors: {
      tool: async (context) => {
        const p = context.inputs.params as pv.VideoParams, inputs = context.inputs as Record<string, any>, notes = (context.scope.vars?.__notes as Record<string, unknown> | undefined)?.[context.node.id];
        calls.push(`${context.node.id}${notes ? `:${notes}` : ""}`);
        switch (context.node.id) {
          case "brief": return { outputs: { brief: pv.applyBriefDefaults(pv.normaliseBrief(rawBrief, p)) } };
          case "script_draft": return { outputs: { script: pv.normaliseScript(rawScript(notes === "fewer" ? 4 : 5, pv.speechTarget_s(p) / (notes === "fewer" ? 4 : 5)), p) } };
          case "shot_list": return { outputs: { shotList: pv.normaliseShotList(rawShots(inputs.script), inputs.script, p) } };
          case "assets": return { outputs: { summary: { needs: patchNeeds.shift() ?? 0, askTitle: "A shot could not be had", ask: "Shot 2 was refused." }, shotMedia: mediaFor(inputs.shotList), costUsd: 0 } };
          case "assets_again": case "assets_again_2": case "assets_again_3": return { outputs: { summary: { needs: patchNeeds.shift() ?? 0, askTitle: "A shot could not be had", ask: "Shot 2 was refused again." }, shotMedia: mediaFor(inputs.shotList), costUsd: 0 } };
          case "pictures": return { outputs: { shotMedia: mediaFor(inputs.shotList), shotList: inputs.shotList, costUsd: 0 } };
          case "voiceover": return { outputs: { takes: pv.narrated(p) ? (inputs.script as pv.Script).segments.map((segment, index) => ({ segmentId: segment.id, media: file(`${index}b`, "audio", 3.2) })) : [], costUsd: 0 } };
          case "music": return { outputs: { music: null, costUsd: 0 } };
          case "timing": return { outputs: pv.retime(inputs.shotList, inputs.script, inputs.takes, p) };
          case "captions": return { outputs: { captions: pv.buildCaptions(inputs.script, inputs.shotList, inputs.voiceTrack, p) } };
          case "assemble": return { outputs: { project: { projectId: "p1", revision: 1 }, report: { clips: (inputs.shotList as pv.ShotList).shots.length } } };
          default: return { outputs: { report: { findings: [], score: 100, passed: true } } };
        }
      },
    },
  });
  return { ...h, calls };
}
const approve = (h: ReturnType<typeof run>, nodeId: string, subject?: unknown) => h.engine.resolve(nodeId, "", { outcome: "approved", ...(subject !== undefined ? { subject } : {}), by: { deviceId: "d1" } });

test("Checkpoint after script: the run waits at each checkpoint and continues when a person approves", async () => {
  const h = run();
  h.engine.start(); await settle();
  assert.equal(h.statusOf("check_brief"), "waiting_approval");
  assert.equal(h.statusOf("script_draft"), "pending");
  approve(h, "check_brief"); await settle();
  assert.equal(h.statusOf("script_approve"), "waiting_approval");
  assert.equal(h.state.status, "waiting_approval");
  approve(h, "script_approve"); await settle();
  approve(h, "check_shot_list"); await settle(30);
  assert.equal(h.statusOf("check_final"), "waiting_approval");
  approve(h, "check_final"); await settle();
  assert.equal(h.state.status, "succeeded");
  assert.deepEqual(h.state.outputs!.project, { projectId: "p1", revision: 1 });
});
test("Automatic mode is hands-free: with the override every checkpoint approves itself and the run succeeds", async () => {
  const h = run({}, "auto");
  h.engine.start(); await settle(40);
  assert.equal(h.state.status, "succeeded");
  // The rounds that ask a person about the pictures do not run when nothing needs one.
  assert.ok(Object.values(h.state.executions).every((exec) => exec.status === (/^(fix_pictures|assets_again|pictures_gate_)/.test(exec.nodeId) ? "skipped" : "succeeded")), JSON.stringify(Object.values(h.state.executions).map((exec) => [exec.nodeId, exec.status])));
});
test("Pictures that need a person stop the run in every mode: a refused shot or a missing leave waits at a checkpoint also in automatic mode, and the pictures are drawn again after the answer", async () => {
  const h = run({}, "auto", [1, 1, 0]);
  h.engine.start(); await settle(40);
  assert.equal(h.state.status, "waiting_approval");
  assert.equal(h.statusOf("fix_pictures"), "waiting_approval");
  assert.deepEqual([h.state.executions[wf.execKey("fix_pictures", "")].request!.title, h.state.executions[wf.execKey("fix_pictures", "")].request!.instructions], ["A shot could not be had", "Shot 2 was refused."]);
  assert.equal(h.statusOf("voiceover"), "pending", "the voice waits for the pictures");
  approve(h, "fix_pictures"); await settle(40);
  // Still not had: the next round asks again instead of failing or going on.
  assert.equal(h.statusOf("fix_pictures_2"), "waiting_approval");
  assert.equal(h.state.executions[wf.execKey("fix_pictures_2", "")].request!.instructions, "Shot 2 was refused again.");
  approve(h, "fix_pictures_2"); await settle(40);
  assert.equal(h.state.status, "succeeded");
  assert.deepEqual(h.calls.filter((call) => /^assets|^pictures/.test(call)), ["assets", "assets_again", "assets_again_2", "pictures"]);
  assert.equal(h.statusOf("fix_pictures_3"), "skipped");
});
test("Concurrent branches: after the shot list is approved pictures and music start together, the voice follows the pictures, and assembly waits for all of them", async () => {
  const h = run();
  h.engine.start(); await settle(); approve(h, "check_brief"); await settle(); approve(h, "script_approve"); await settle();
  h.calls.length = 0;
  h.engine.resolve("check_shot_list", "", { outcome: "approved", by: { deviceId: "d1" } });
  assert.deepEqual([h.statusOf("assets"), h.statusOf("voiceover"), h.statusOf("music")], ["running", "pending", "running"]);
  assert.equal(h.statusOf("assemble"), "pending");
  await settle(30);
  assert.ok(h.calls.indexOf("voiceover") > h.calls.indexOf("pictures") && h.calls.indexOf("pictures") > h.calls.indexOf("assets"));
  assert.ok(h.calls.indexOf("assemble") > Math.max(h.calls.indexOf("pictures"), h.calls.indexOf("captions"), h.calls.indexOf("music")));
});
test("Edit the shot list at the checkpoint: the edited list is what the later steps receive", async () => {
  const h = run();
  h.engine.start(); await settle(); approve(h, "check_brief"); await settle(); approve(h, "script_approve"); await settle();
  const listed = h.state.executions[wf.execKey("check_shot_list", "")].request!.subject as pv.ShotList;
  const edited = { shots: listed.shots.map((shot, index) => (index === 0 ? { ...shot, description: "A kettle on a stove" } : shot)) };
  approve(h, "check_shot_list", edited); await settle(30);
  assert.equal(((h.state.executions[wf.execKey("assets", "")].outputs!.shotMedia as pv.ShotMedia[])[0]).prompt, "A kettle on a stove");
});
test("Regenerate the shot list: a finished step runs again with the person's notes and everything after it is done again", async () => {
  const h = run({}, "auto");
  h.engine.start(); await settle(40);
  assert.equal(h.state.status, "succeeded");
  h.calls.length = 0;
  h.engine.rerun("script_draft", { notes: "fewer" }); await settle(40);
  assert.equal(h.state.status, "succeeded");
  assert.equal(h.state.reopenedCount, 1);
  assert.deepEqual(h.calls.slice(0, 2), ["script_draft:fewer", "shot_list"]);
  assert.ok(!h.calls.includes("brief"), "steps before it are kept");
  assert.equal((h.state.executions[wf.execKey("assemble", "")].outputs!.report as { clips: number }).clips, 4);
});
test("Words change through the script: an edited script replaces the step's result without a model and the later steps follow", async () => {
  const h = run({}, "auto");
  h.engine.start(); await settle(40);
  const script = h.state.executions[wf.execKey("script_approve", "")].outputs!.subject as pv.Script;
  const edited = { ...script, segments: script.segments.slice(0, 3) };
  h.calls.length = 0;
  h.engine.rerun("script_approve", { outputs: { subject: edited } }); await settle(40);
  assert.ok(!h.calls.includes("script_draft") && h.calls[0] === "shot_list");
  assert.equal((h.state.executions[wf.execKey("assemble", "")].outputs!.report as { clips: number }).clips, 3);
  assert.throws(() => h.engine.rerun("start"), /Only a step that has ended/);
});
test("Regenerate blocked by a running consumer: a step that has not ended cannot run again", async () => {
  const h = run();
  h.engine.start(); await settle();
  assert.throws(() => h.engine.rerun("script_draft"), (error: wf.WorkflowError) => error.code === "WORKFLOW_NODE_NOT_ACTIVE");
});
test("A still that does not have the film's shape covers the frame: a 3:2 picture in a 16:9 film is scaled up, so no bar shows at the sides", () => {
  assert.equal(pv.coverScale({ width: 1920, height: 1080 }, { width: 1536, height: 1024 }), 1.1852);
  assert.equal(pv.coverScale({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }), 1);
  assert.equal(pv.coverScale({ width: 1080, height: 1920 }, { width: 1024, height: 1536 }), 1.1852);
  assert.equal(pv.coverScale({ width: 1920, height: 1080 }, undefined), 1);
  let n = 0;
  const still = pv.motionKeys("none", 3 * pv.TICKS, pv.TICKS / 24, 1920, () => `k${n++}`, 1.1852) as Record<string, { keys: { value: number }[] }>;
  assert.deepEqual(still["transform.scale.x"].keys.map((key) => key.value), [1.1852, 1.1852]);
  const zoom = pv.motionKeys("slow-zoom-in", 3 * pv.TICKS, pv.TICKS / 24, 1920, () => `k${n++}`, 1.1852) as Record<string, { keys: { value: number }[] }>;
  assert.ok(zoom["transform.scale.y"].keys.every((key) => key.value >= 1.1852), "the frame stays covered through the move");
  assert.equal(pv.motionKeys("none", 3 * pv.TICKS, pv.TICKS / 24, 1920, () => "k"), undefined);
});

// — w2: the working film of a run (the film engine draws and speaks a video) —
import { film as fm } from "../src/index.ts";
const filmOfRun = (a: ReturnType<typeof artifacts>, shotList = a.drafted) => {
  const made = pv.workingFilm(a.p, a.brief, a.script, shotList);
  let n = 0;
  const film = fm.applyOps(fm.createFilm({ id: "film_1", now_ms: 1, title: "Video 1" }), [{ op: "film.set", fields: made.fields }, { op: "breakdown.set", breakdown: made.breakdown }], { now_ms: 2, newId: () => `id${++n}` });
  return { made, film };
};
const version = (name: string, check?: fm.PictureCheck): fm.Version => ({ id: `v_${name}`, media: file(name, "image"), costUsd: 0.011, prompt: "", created_ms: 3, ...(check ? { check, drawing: 2 } : {}) });

test("The working film of a run: every shot is a panel, shots of one place are one scene, every spoken segment is a line of its speaker tied to the first shot that shows it", () => {
  const a = artifacts(), listed = { shots: a.drafted.shots.map((shot, index) => ({ ...shot, setting: index < 3 ? "A kitchen" : "A garden", subjects: index ? [] : ["a kettle"] })) };
  const script = { ...a.script, segments: a.script.segments.map((segment, index) => (index === 1 ? { ...segment, kind: "dialogue" as const, speaker: "Mai" } : segment)) };
  const made = pv.workingFilm(a.p, a.brief, script, listed);
  assert.deepEqual(made.breakdown.clips.map((clip) => clip.title), ["A kitchen", "A garden"]);
  assert.deepEqual(made.breakdown.panels.map((panel) => [panel.id, panel.clipId]), [["shot_1", "scene_1"], ["shot_2", "scene_1"], ["shot_3", "scene_1"], ["shot_4", "scene_2"], ["shot_5", "scene_2"]]);
  assert.equal(made.breakdown.panels[0].action, "Picture 1 Setting: A kitchen. In the picture: a kettle.");
  assert.deepEqual(made.breakdown.lines.map((line) => [line.id, line.kind, line.speakerId === fm.NARRATOR, line.panelId]), [["seg_1", "narration", true, "shot_1"], ["seg_2", "dialogue", false, "shot_2"], ["seg_3", "narration", true, "shot_3"], ["seg_4", "narration", true, "shot_4"], ["seg_5", "narration", true, "shot_5"]]);
  assert.deepEqual(made.breakdown.characters.map((entry) => entry.name), ["Mai"]);
  assert.deepEqual([made.fields.artStyle, made.fields.artStyleText, made.fields.aspectRatio], ["custom", "Soft morning light", "9:16"]);
  // A voice a person chose is the Narrator's; a silent run has no line at all.
  assert.equal(pv.workingFilm(params({ voice: "Kore" }), a.brief, script, listed).fields.narratorVoiceId, "Kore");
  assert.deepEqual(pv.workingFilm(params({ voice: "none" }), a.brief, script, listed).breakdown.lines, []);
});
test("What the film engine made is read back with its verdicts: a picture carries its check, a refused shot says why, a take carries what the listener heard", () => {
  const a = artifacts(), { film } = filmOfRun(a), context = { now_ms: 5, newId: () => "x" };
  const check = { ok: true, shows: true, text: false, why: "A cup of tea." };
  const speech: fm.SpeechCheck = { ok: true, score: 0.96, heard: "word0 word1", seconds: 3.2 };
  const made = fm.applyOps(film, [
    { op: "panel.picture", id: "shot_1", version: version("1a", check) }, { op: "panel.refused", id: "shot_2", message: "The provider refused this request.", reason: "policy" }, { op: "panel.leave", id: "shot_3", leftOut: true },
    { op: "line.take", id: "seg_1", take: { id: "t1", media: file("1b", "audio", 3.2), costUsd: 0, duration_ticks: 384_000, stale: false, voiceId: "Kore", created_ms: 4, check: speech } },
    { op: "line.take", id: "seg_2", take: { id: "t2", media: file("2b", "audio", 3.2), costUsd: 0, duration_ticks: 384_000, stale: false, voiceId: "Kore", created_ms: 4, unchecked: { seconds: 3.2, why: "no_listener" } } },
  ], context);
  const media = pv.shotMediaOfFilm(made, a.drafted);
  assert.deepEqual([media[0].check, media[0].drawing, !!media[0].media], [check, 2, true]);
  assert.deepEqual([media[1].media, media[1].refused], [null, { message: "The provider refused this request.", reason: "policy" }]);
  assert.equal(media[2].leftOut, true);
  const takes = pv.takesOfFilm(made, a.script);
  assert.deepEqual(takes.map((take) => [take.segmentId, take.check?.score, take.unchecked?.why, take.voiceId]), [["seg_1", 0.96, undefined, "Kore"], ["seg_2", undefined, "no_listener", "Kore"]]);
});
test("Only what changed is made again: an edited shot is outdated alone, an edited line's recording alone, and a removed shot takes nothing with it", () => {
  const a = artifacts(), { film } = filmOfRun(a), context = { now_ms: 6, newId: () => "x" };
  const drawn = fm.applyOps(film, [...a.drafted.shots.map((shot) => ({ op: "panel.picture" as const, id: shot.id, version: version(`${shot.index}a`) })), ...a.script.segments.map((segment) => ({ op: "line.take" as const, id: segment.id, take: { id: `t_${segment.id}`, media: file("b", "audio", 3), costUsd: 0, duration_ticks: 360_000, stale: false, voiceId: "", created_ms: 4 } }))], context);
  assert.deepEqual(pv.filmSyncOps(drawn, pv.workingFilm(a.p, a.brief, a.script, a.drafted)), [], "nothing changed: nothing to do");
  const editedShots = { shots: a.drafted.shots.map((shot, index) => (index === 1 ? { ...shot, description: "A kettle on a stove" } : shot)) };
  const editedScript = { ...a.script, segments: a.script.segments.map((segment, index) => (index === 3 ? { ...segment, text: "New words here" } : segment)) };
  const ops = pv.filmSyncOps(drawn, pv.workingFilm(a.p, a.brief, editedScript, editedShots));
  assert.deepEqual(ops.map((op) => [op.op, (op as { id: string }).id]), [["panel.update", "shot_2"], ["line.update", "seg_4"]]);
  const after = fm.applyOps(drawn, ops, context);
  assert.deepEqual(after.panels.map((panel) => panel.picture.stale), [false, true, false, false, false]);
  assert.deepEqual(after.lines.map((line) => fm.activeTake(line)?.stale), [false, false, false, true, false]);
  // A shot fewer: the panel is removed, the others keep their pictures.
  const fewer = { shots: a.drafted.shots.slice(0, 4) }, removed = fm.applyOps(drawn, pv.filmSyncOps(drawn, pv.workingFilm(a.p, a.brief, a.script, fewer)), context);
  assert.deepEqual(removed.panels.map((panel) => [panel.id, panel.picture.stale]), [["shot_1", false], ["shot_2", false], ["shot_3", false], ["shot_4", false]]);
  // "Make this shot again" with the same words, and a line recorded again.
  const again = fm.applyOps(drawn, [...pv.redrawOps(drawn.panels[2]), ...pv.rerecordOps(drawn.lines[0])], context);
  assert.deepEqual([again.panels[2].picture.stale, again.panels[2].shotSize, again.panels[2].action, fm.activeTake(again.lines[0])?.stale, again.lines[0].rate], [true, drawn.panels[2].shotSize, drawn.panels[2].action, true, 1]);
});
test("A shot a person left out: its segments go to the shot before it, so every spoken line still has a picture under it", () => {
  const a = artifacts();
  assert.deepEqual(pv.withoutLeftOut(a.drafted, ["shot_3"]).shots.map((shot) => [shot.id, shot.index, shot.segmentIds]), [["shot_1", 0, ["seg_1"]], ["shot_2", 1, ["seg_2", "seg_3"]], ["shot_4", 2, ["seg_4"]], ["shot_5", 3, ["seg_5"]]]);
  assert.deepEqual(pv.withoutLeftOut(a.drafted, ["shot_1"]).shots[0].segmentIds, ["seg_1", "seg_2"]);
  assert.equal(pv.withoutLeftOut(a.drafted, []), a.drafted);
});
test("Narration carries the script: a narrated run whose script or shot list leaves most of it unspoken is sent back to the writer, a silent run is not", () => {
  const a = artifacts(), mute = { ...a.script, segments: a.script.segments.map((segment, index) => (index < 3 ? { ...segment, kind: "silent" as const, text: "" } : segment)) };
  assert.match(pv.narrationProblems(a.p, mute)[0], /3 of 5 segments are not spoken/);
  assert.throws(() => pv.assertNarration("script", a.p, mute), (error: pv.ContractError) => error.code === "WORKFLOW_OUTPUT_INVALID" && /not spoken/.test(error.problems[0]));
  assert.deepEqual(pv.narrationProblems(a.p, a.script, a.drafted), []);
  assert.deepEqual(pv.narrationProblems(params({ voice: "none" }), mute), []);
  const quiet = { shots: a.drafted.shots.map((shot, index) => (index < 3 ? { ...shot, segmentIds: [] } : shot)) };
  assert.match(pv.narrationProblems(a.p, a.script, quiet)[0], /3 of 5 shots have nothing said under them \(shots 1, 2, 3\)/);
});
test("Own script: a person's words become the segments in order, unchanged; a named line is dialogue; the video lasts as long as the script reads", () => {
  const text = "The kettle sings before the sun is up. Steam climbs the window.\nMai: Is it ready yet?\nShe pours two cups and waits.";
  const script = pv.scriptFromText(text, params());
  assert.deepEqual(script.segments.map((segment) => [segment.id, segment.kind, segment.speaker, segment.text]), [
    ["seg_1", "narration", "Narrator", "The kettle sings before the sun is up. Steam climbs the window."], ["seg_2", "dialogue", "Mai", "Is it ready yet?"], ["seg_3", "narration", "Narrator", "She pours two cups and waits."]]);
  assert.ok(script.segments.every((segment) => segment.estimatedDuration_s >= 0.5));
  const lasts = pv.scriptDuration_s(script);
  assert.ok(lasts >= 5 && lasts === Math.max(5, Math.ceil(script.segments.reduce((sum, segment) => sum + segment.estimatedDuration_s + 0.4, 0))));
  // Without a voice the same words are shown, not spoken.
  assert.ok(pv.scriptFromText(text, params({ voice: "none" })).segments.every((segment) => segment.kind === "on-screen-text"));
  assert.throws(() => pv.scriptFromText("  \n ", params()), /holds no words/);
  assert.deepEqual(pv.checkInput(params({ prompt: "", script: text })), []);
  assert.deepEqual(pv.checkInput(params({ secondCaptionLanguage: "en" })).map((problem) => problem.field), ["secondCaptionLanguage"]);
  assert.deepEqual(pv.checkInput(params({ budgetUsd: 0 })).map((problem) => problem.field), ["budgetUsd"]);
});
test("The review says what the checks said: checked pictures and takes are reported as checked, a picture that is not its shot and a line that is not its words are warnings", () => {
  const a = artifacts(), built = build({ params: a.p, brief: a.brief, script: a.script, shotList: a.shotList, shotMedia: a.shotMedia, voiceTrack: a.voiceTrack, captions: a.captions, music: null });
  const ok = { ok: true, shows: true, text: false, why: "It shows the shot." }, heard: fm.SpeechCheck = { ok: true, score: 1, heard: "x", seconds: 3 };
  const base = { params: a.p, brief: a.brief, script: a.script, shotList: a.shotList, voiceTrack: a.voiceTrack, captions: a.captions, stepWarnings: [] };
  const good = pv.reviewChecks(built.document, { ...base, shotMedia: a.shotMedia.map((entry) => ({ ...entry, check: ok })), takes: a.takes.map((take) => ({ ...take, check: heard })) });
  assert.deepEqual(good.findings.filter((finding) => /FRAMES|VOICE_|PICTURE/.test(finding.code)).map((finding) => finding.code), ["REVIEW_FRAMES_CHECKED", "REVIEW_VOICE_CHECKED"]);
  const bad = pv.reviewChecks(built.document, { ...base, shotMedia: a.shotMedia.map((entry, index) => ({ ...entry, check: index ? ok : { ok: false, shows: false, text: true, why: "A poster." } })), takes: a.takes.map((take, index) => (index ? { ...take, unchecked: { seconds: 3, why: "no_listener" as const } } : { ...take, check: { ...heard, ok: false, score: 0.4, heard: "something else" } })) });
  assert.deepEqual(bad.findings.filter((finding) => /FRAMES|VOICE_|PICTURE/.test(finding.code)).map((finding) => [finding.code, finding.severity]), [["REVIEW_PICTURE_MISMATCH", "warning"], ["REVIEW_VOICE_MISMATCH", "warning"], ["REVIEW_VOICE_UNCHECKED", "info"]]);
  assert.equal(bad.score, good.score - 10);
});
test("Second caption language: the cues' translations and their language are on the caption track of the project", () => {
  const a = artifacts(), captions = { ...a.captions, translationLanguage: "vi", cues: a.captions.cues.map((cue) => ({ ...cue, translation: `vi: ${cue.text}`.slice(0, 500) })) };
  const built = build({ params: a.p, brief: a.brief, script: a.script, shotList: a.shotList, shotMedia: a.shotMedia, voiceTrack: a.voiceTrack, captions, music: null });
  assert.ok(validateProjectDocument(built.document, { mode: "strict" }).ok);
  const track = built.document.scenes[0].tracks.overlay.find((entry) => entry.type === "caption") as unknown as { caption: { translationLanguage?: string }; elements: Array<{ text: string; translation?: string }> };
  assert.equal(track.caption.translationLanguage, "vi");
  assert.ok(track.elements.length > 0 && track.elements.every((element) => element.translation?.startsWith("vi: ")));
});
test("Send to workflow: a script of the script studio becomes the text a run speaks — narration as written, dialogue with its speaker, nothing that is not spoken", () => {
  const line = (kind: string, text: string, extra: Record<string, unknown> = {}) => ({ kind, text, ...extra });
  const document = {
    entities: { characters: [{ id: "c1", name: "MAI" }] },
    scenes: [
      { beats: [{ lines: [line("action", "A kitchen at dawn."), line("narration", "The kettle sings  before the sun is up."), line("dialogue", "Is it ready yet?", { characterId: "c1" })] }] },
      { beats: [{ lines: [line("transition", "CUT TO:"), line("dialogue", "Almost.", { speakerText: "GRANDMOTHER (O.S.)" }), line("sound_note", "A spoon rings."), line("narration", "  ")] }] },
    ],
  };
  const spoken = pv.spokenTextOfScript(document);
  assert.equal(spoken, "The kettle sings before the sun is up.\nMAI: Is it ready yet?\nGRANDMOTHER: Almost.");
  // What it hands over is read by the run as the person's own script: the same words, the same speakers.
  const script = pv.scriptFromText(spoken, params());
  assert.deepEqual(script.segments.map((segment) => [segment.kind, segment.speaker, segment.text]), [["narration", "Narrator", "The kettle sings before the sun is up."], ["dialogue", "MAI", "Is it ready yet?"], ["dialogue", "GRANDMOTHER", "Almost."]]);
  assert.equal(pv.spokenTextOfScript({ entities: { characters: [] }, scenes: [{ beats: [{ lines: [line("action", "Rain.")] }] }] }), "");
});
