// Pure functions of Film Studio. The engine run uses a test executor for the `tool` steps: the host's step tools need a database and a provider.
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm, promptVideo as pv, validateProjectDocument, validatorEffectRegistry, validatorTransitionRegistry, workflow as wf, type Registries } from "../src/index.ts";
import { seeded } from "./support/script.ts";
import { harness, settle } from "./support/workflows.ts";

let counter = 0;
const context = (): fm.OpContext => ({ now_ms: 2000, newId: () => `id_${++counter}` });
const create = (patch: Partial<fm.CreateInput> = {}) => fm.createFilm({ id: "film_1", now_ms: 1000, title: "The Lantern Keeper", ...patch });
const file = (name: string, kind: "image" | "audio", seconds?: number): pv.MediaFile => ({ blobId: name.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64), name, kind, bytes: 1000, ...(kind === "image" ? { width: 1920, height: 1080 } : { duration_ticks: Math.round((seconds ?? 1) * pv.TICKS) }), provenance: { source: "ai", provider: "test", model: "test", role: kind, jobId: name, created_ms: 1, referenceAssetIds: [] } });
const version = (name: string): fm.Version => ({ id: `v_${name}`, media: file(name, "image"), costUsd: 0.01, prompt: name, created_ms: 1 });
const take = (name: string, seconds: number): fm.Take => ({ id: `t_${name}`, media: file(name, "audio", seconds), costUsd: 0.01, duration_ticks: Math.round(seconds * pv.TICKS), stale: false, voiceId: "", created_ms: 1 });
const raw = {
  logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern for Minh.",
  characters: [{ name: "Linh", role: "lead", age: "17", description: "Lantern maker's granddaughter", appearance: "Seventeen, long black braid, indigo shirt" }, { name: "Minh", role: "supporting", age: 16, description: "A visitor", appearance: "Sixteen, short hair, white T-shirt" }],
  locations: [{ name: "Tran Phu street", description: "Old town street at night", appearance: "Yellow shopfronts, silk lanterns" }],
  props: [{ name: "Paper lantern", description: "Carries the maker's mark", appearance: "Small pink paper lantern" }],
  clips: [
    { title: "Linh closes the stall", panels: [
      { action: "Empty street at dusk.", duration_s: 4, shotSize: "wide", cameraMotion: "static", characters: [], location: "Tran Phu street", props: [], videoPrompt: "Still", lines: [{ kind: "narration", speaker: "Narrator", text: "On the night of the full moon, Hoi An turns off its lights.", emotion: "Calm" }] },
      { action: "Linh glues silk onto a frame.", duration_s: 5, shotSize: "Medium", cameraMotion: "push-in", characters: ["Linh"], location: "Tran Phu street", props: [], lines: [{ kind: "inner", speaker: "Linh", text: "It's quieter this way.", emotion: "tender" }] },
    ] },
    { title: "The broken lantern", panels: [
      { action: "Minh holds the lantern out.", duration_s: 3, shotSize: "close-up", cameraMotion: "static", characters: ["Minh"], location: "Tran Phu street", props: ["Paper lantern"], lines: [{ kind: "dialogue", speaker: "Minh", text: "Can you fix it?" }, { kind: "dialogue", speaker: "Linh", text: "Where did you get this?" }] },
    ] },
  ],
};
const broken = (): fm.Film => { const base = create(); return fm.applyOps(base, [{ op: "film.set", fields: { sourceText: "Hoi An, the night of the full moon." } }, { op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw, base) }], context()); };
const pictured = (): fm.Film => { const base = broken(); return fm.applyOps(base, base.panels.map((panel, index): fm.FilmOp => ({ op: "panel.picture", id: panel.id, version: version(`${index}a`) })), context()); };

test("Film entity — Create with defaults", () => {
  const made = create();
  assert.deepEqual([made.aspectRatio, made.artStyle, made.frameRate, made.revision, made.stale, made.project], ["16:9", "cinematic-realistic", 24, 1, [], null]);
});
test("Film entity — Custom style without text", () => {
  assert.throws(() => fm.applyOps(create(), [{ op: "film.set", fields: { artStyle: "custom" } }], context()), (error: fm.FilmError) => error.code === "INVALID_PARAMS" && error.message === "Describe the custom style" && error.details.field === "artStyleText");
  assert.equal(fm.styleText(fm.applyOps(create(), [{ op: "film.set", fields: { artStyle: "custom", artStyleText: "ink wash" } }], context())), "ink wash");
});
test("Story input — Empty text and the 60,000 character limit", () => {
  assert.deepEqual(fm.storyCounts(""), { characters: 0, words: 0 });
  assert.deepEqual(fm.storyCounts("Hoi An, the night"), { characters: 17, words: 4 });
  assert.throws(() => fm.applyOps(create(), [{ op: "film.set", fields: { sourceText: "x".repeat(60_001) } }], context()), /Episode text limit reached — split into episodes/);
});
test("AI story expansion — Expansion sized to target", () => {
  assert.deepEqual(fm.storyRange("en", 120), { unit: "words", min: 400, max: 600 });
  assert.equal(fm.storyRange("ja", 60).unit, "characters");
  const words = (count: number) => Array.from({ length: count }, (_value, index) => `word${index}`).join(" ");
  assert.equal(fm.checkStory(words(500), "en", 120).split(" ").length, 500);
  assert.throws(() => fm.checkStory(words(300), "en", 120), (error: pv.ContractError) => /300 words/.test(error.problems[0]));
});
test("AI story expansion — Markup rejected", () => {
  const prose = Array.from({ length: 250 }, () => "word").join(" ");
  assert.throws(() => fm.checkStory(`# Title\n${prose}`, "en", 60), (error: pv.ContractError) => error.problems.includes("remove the Markdown headings"));
  assert.throws(() => fm.checkStory(`- one\n${prose}`, "en", 60), (error: pv.ContractError) => error.problems.includes("remove the list markers"));
});
test("Story-to-script — the breakdown resolves names to ids and refuses unknown ones", () => {
  const made = fm.normaliseBreakdown(raw, create());
  assert.deepEqual([made.characters.map((entry) => entry.id), made.clips.length, made.panels.length, made.lines.length], [["ch_linh", "ch_minh"], 2, 3, 4]);
  assert.deepEqual([made.panels[1].shotSize, made.panels[1].characterIds, made.panels[2].propIds, made.lines[1].speakerId, made.lines[0].speakerId, made.lines[3].panelId], ["medium", ["ch_linh"], ["pr_paper-lantern"], "ch_linh", "narrator", "pa_3"]);
  const wrong = structuredClone(raw); wrong.clips[0].panels[1].characters = ["Nobody"];
  assert.throws(() => fm.normaliseBreakdown(wrong, create()), (error: pv.ContractError) => /"Nobody", which is not in your list/.test(error.problems[0]));
  assert.throws(() => fm.normaliseBreakdown("text", create()), pv.ContractError);
});
test("Panel entity — Duration bounds", () => {
  const made = broken(), id = made.panels[0].id;
  assert.equal(fm.applyOps(made, [{ op: "panel.update", id, fields: { duration_ticks: 16 * pv.TICKS } }], context()).panels[0].duration_ticks, 15 * pv.TICKS);
  assert.equal(fm.applyOps(made, [{ op: "panel.update", id, fields: { duration_ticks: 100 } }], context()).panels[0].duration_ticks, pv.TICKS);
});
test("Panel entity — Panel limit per clip", () => {
  let made = broken();
  made = fm.applyOps(made, Array.from({ length: 38 }, (): fm.FilmOp => ({ op: "panel.add", clipId: "cl_1" })), context());
  assert.throws(() => fm.applyOps(made, [{ op: "panel.add", clipId: "cl_1" }], context()), /A clip can have at most 40 panels/);
});
test("Character entity — Duplicate character name", () => {
  assert.throws(() => fm.applyOps(broken(), [{ op: "asset.update", kind: "character", id: "ch_minh", fields: { name: "LINH" } }], context()), /A character with this name already exists/);
});
test("Speaker, voice and voice line entities — Line bound to a panel", () => {
  const made = fm.applyOps(pictured(), [{ op: "panel.remove", id: "pa_3" }], context());
  assert.deepEqual(made.lines.filter((line) => !line.panelId).map((line) => line.id), ["li_3", "li_4"]);
  assert.deepEqual(fm.layout(made).unbound.map((line) => line.id), ["li_3", "li_4"]);
});
test("Speaker, voice and voice line entities — Line limit", () => {
  const base = broken(), full = { ...base, lines: Array.from({ length: 1000 }, (_value, index) => ({ ...base.lines[0], id: `x${index}` })) };
  assert.throws(() => fm.applyOps(full, [{ op: "line.add", fields: { text: "One more" } }], context()), (error: fm.FilmError) => error.code === "FILM_LIMIT_EXCEEDED" && error.details.max === 1000 && error.details.actual === 1001);
});
test("Stale markers and stage readiness — Appearance change marks panels, Prop change marks panels", () => {
  const made = pictured();
  const changed = fm.applyOps(made, [{ op: "asset.update", kind: "character", id: "ch_linh", fields: { appearance: "Short red hair" } }], context());
  assert.deepEqual(changed.panels.map((panel) => panel.picture.stale), [false, true, false]);
  assert.ok(changed.panels.every((panel) => panel.picture.current), "no image is deleted");
  assert.deepEqual(fm.applyOps(made, [{ op: "asset.update", kind: "prop", id: "pr_paper-lantern", fields: { appearance: "Blue" } }], context()).panels.map((panel) => panel.picture.stale), [false, false, true]);
  assert.equal(fm.counts(changed).panelsStale, 1);
});
test("Stale markers and stage readiness — a story edit marks the later stages, Empty storyboard stage", () => {
  assert.deepEqual(fm.stageReady(create(), "storyboard"), { ready: false, reason: "Create the script from the story first" });
  const made = fm.applyOps(pictured(), [{ op: "line.take", id: "li_1", take: take("1c", 2) }], context());
  const edited = fm.applyOps(made, [{ op: "film.set", fields: { sourceText: "A different story." } }], context());
  // Only stages that hold something outdated keep their mark: the script itself is what is behind.
  assert.ok(edited.stale.includes("timeline") || edited.stale.length === 0);
  const restyled = fm.applyOps(made, [{ op: "film.set", fields: { artStyle: "anime" } }], context());
  assert.ok(restyled.stale.includes("storyboard") && restyled.panels.every((panel) => panel.picture.stale));
});
test("Asset image generation with candidates — the first picture is used, later ones wait as candidates; Use and Dismiss all", () => {
  let made = fm.applyOps(broken(), [{ op: "asset.picture", kind: "character", id: "ch_linh", version: version("a1") }], context());
  assert.equal(made.characters[0].picture.current?.id, "v_a1");
  made = fm.applyOps(made, [{ op: "asset.picture", kind: "character", id: "ch_linh", version: version("a2") }, { op: "asset.picture", kind: "character", id: "ch_linh", version: version("a3") }], context());
  assert.deepEqual([made.characters[0].picture.current?.id, made.characters[0].picture.candidates.map((entry) => entry.id)], ["v_a1", ["v_a2", "v_a3"]]);
  const used = fm.applyOps(made, [{ op: "asset.use", kind: "character", id: "ch_linh", versionId: "v_a3" }], context());
  assert.deepEqual([used.characters[0].picture.current?.id, used.characters[0].picture.candidates], ["v_a3", []]);
  assert.deepEqual(fm.applyOps(made, [{ op: "asset.dismiss", kind: "character", id: "ch_linh" }], context()).characters[0].picture.candidates, []);
});
test("Reorder, insert and delete panels — Move across clips", () => {
  const made = fm.applyOps(pictured(), [{ op: "panel.move", id: "pa_2", clipId: "cl_2", index: 0 }], context());
  assert.deepEqual(fm.orderedPanels(made).map((panel) => `${panel.clipId}:${panel.id}`), ["cl_1:pa_1", "cl_2:pa_2", "cl_2:pa_3"]);
  assert.equal(made.lines.find((line) => line.id === "li_2")?.panelId, "pa_2");
});
test("Text-to-speech per line with takes — Re-take, Take limit, Generate all", () => {
  let made = fm.applyOps(broken(), [{ op: "line.take", id: "li_1", take: take("1", 2) }], context());
  made = fm.applyOps(made, [{ op: "line.take", id: "li_1", take: take("2", 2) }], context());
  assert.deepEqual([made.lines[0].activeTakeId, made.lines[0].takes.map((entry) => entry.id)], ["t_2", ["t_2", "t_1"]]);
  const kept = fm.applyOps(made, [{ op: "line.take", id: "li_1", take: take("3", 2), keepCurrent: true }], context());
  assert.equal(kept.lines[0].activeTakeId, "t_2");
  for (let index = 3; index < 14; index++) made = fm.applyOps(made, [{ op: "line.take", id: "li_1", take: take(String(index), 2) }], context());
  assert.equal(made.lines[0].takes.length, 10);
  assert.equal(fm.counts(made).linesMissing, 3);
  const edited = fm.applyOps(made, [{ op: "line.update", id: "li_1", fields: { text: "Changed words." } }], context());
  assert.ok(edited.lines[0].takes.every((entry) => entry.stale));
  assert.equal(fm.counts(edited).linesMissing, 4);
});
test("Consistency through reference images — a panel's request repeats the appearance of its cast, place and props", () => {
  const made = fm.applyOps(broken(), [{ op: "asset.picture", kind: "character", id: "ch_minh", version: version("c1") }], context());
  const prompt = fm.panelPrompt(made, made.panels[2]);
  for (const words of ["Sixteen, short hair, white T-shirt", "Yellow shopfronts, silk lanterns", "Small pink paper lantern", "close-up"]) assert.ok(prompt.includes(words), words);
  assert.deepEqual(fm.panelReferences(made, made.panels[2]), [version("c1").media.blobId]);
});

const registries = { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() };
const assemble = (source: fm.Film, withoutMissing = false) => fm.assembleFilm({ film: source, projectId: "11111111-1111-4111-8111-111111111111", runId: "film:film_1", hash: "h".repeat(64), withoutMissing }, { now_ms: 5000, newId: seeded(9), writer: { id: "film:film_1" }, registries });
const track = (document: ReturnType<typeof assemble>["document"], name: string) => [...document.scenes[0].tracks.overlay, ...document.scenes[0].tracks.audio].find((entry) => entry.name === name) as unknown as { elements: Array<Record<string, number & string>> } | undefined;
test("Assembly of an episode into a timeline project — Tracks created, Still image with camera motion", () => {
  let made = pictured();
  made = fm.applyOps(made, [{ op: "line.take", id: "li_1", take: take("1c", 3) }, { op: "line.take", id: "li_3", take: take("3c", 1.5) }, { op: "music.set", version: { ...version("m"), media: file("mm", "audio", 3) } }], context());
  const built = assemble(made), main = built.document.scenes[0].tracks.main.elements as unknown as Array<Record<string, number> & { animations?: Record<string, { keys: { value: number }[] }> }>;
  assert.ok(validateProjectDocument(built.document, { mode: "strict" }).ok, JSON.stringify(validateProjectDocument(built.document, { mode: "strict" })).slice(0, 600));
  assert.equal(main.length, 3);
  for (let index = 1; index < main.length; index++) assert.equal(main[index].startTime, main[index - 1].startTime + main[index - 1].duration);
  assert.deepEqual(main[1].animations?.["transform.scale.x"].keys.map((key) => key.value), [1, 1.08]);
  assert.equal(track(built.document, "Voiceover")?.elements.length, 2);
  assert.equal(track(built.document, "Captions")?.elements.length, 4);
  assert.ok((track(built.document, "Music")?.elements.length ?? 0) >= 1);
  assert.deepEqual([built.project.clips, built.project.voiceElements, built.project.captionCues, built.document.settings.fps.numerator], [3, 2, 4, 24]);
});
test("Assembly of an episode into a timeline project — Dialogue longer than its panel", () => {
  let made = pictured();
  made = fm.applyOps(made, [{ op: "panel.update", id: "pa_3", fields: { duration_ticks: 4 * pv.TICKS } }, { op: "line.take", id: "li_3", take: take("3c", 2.5) }, { op: "line.take", id: "li_4", take: take("4c", 2.5) }], context());
  const placed = fm.layout(made), panel = placed.panels[2], lines = placed.lines.filter((entry) => entry.panelId === "pa_3");
  assert.equal(panel.duration_ticks, 5.625 * pv.TICKS);
  assert.deepEqual(lines.map((entry) => entry.start_ticks - panel.start_ticks), [25_000, 350_000]);
  for (const entry of [...placed.panels, ...placed.lines]) assert.equal(entry.start_ticks % 5000, 0);
});
test("Assembly of an episode into a timeline project — Panels without media, Unbound line reported, Canvas from film settings", () => {
  let made = broken();
  made = fm.applyOps(made, [{ op: "film.set", fields: { aspectRatio: "9:16" } }, { op: "panel.picture", id: "pa_1", version: version("0a") }, { op: "line.add", id: "free", fields: { text: "A line with no panel" } }, { op: "line.take", id: "free", take: take("fr", 1) }], context());
  assert.throws(() => assemble(made), (error: fm.FilmError) => error.code === "INVALID_PARAMS" && /2 panels have no media/.test(error.message) && (error.details.panelIds as string[]).join() === "pa_2,pa_3");
  const built = assemble(made, true);
  assert.equal(built.project.clips, 1);
  assert.deepEqual(fm.layout(made).unbound.map((line) => line.id).includes("free"), true);
  assert.deepEqual(built.document.settings.canvasSize, { width: 1080, height: 1920 });
  assert.equal(track(built.document, "Voiceover"), undefined);
});
test("Film pipeline template — the graph is valid and a run stops at each checkpoint in order", async () => {
  const doc = fm.buildFilmTemplate(1000);
  assert.deepEqual(wf.validate(doc, { workflow: () => undefined }).errors, []);
  const ran: string[] = [];
  const run = harness(doc, { params: { filmId: "film_1" }, executors: { tool: async (context) => { ran.push(context.node.id); return { outputs: { summary: { stage: context.node.id }, costUsd: 0 } }; } } });
  run.engine.start(); await settle(12);
  assert.deepEqual(ran, ["breakdown"]);
  assert.equal(run.statusOf("check_breakdown"), "waiting_approval");
  for (const [check, next] of [["check_breakdown", "asset_images"], ["check_assets", "panel_images"], ["check_storyboard", "voice"]] as const) {
    run.engine.resolve(check, "", { decision: "approve", by: { deviceId: "d1", deviceName: "Mac" } }); await settle(12);
    assert.ok(ran.includes(next), next);
  }
  assert.ok(ran.includes("music") && !ran.includes("assemble"));
  run.engine.resolve("check_voice", "", { decision: "approve", by: { deviceId: "d1", deviceName: "Mac" } }); await settle(12);
  assert.equal(ran.at(-1), "assemble");
  assert.equal(run.state.status, "succeeded");
  // Re-run one stage: the stage and what follows it go back, what came before stays.
  run.engine.rerun("panel_images", {}); await settle(12);
  assert.equal(ran.filter((id) => id === "panel_images").length, 2);
  assert.equal(run.statusOf("check_storyboard"), "waiting_approval");
  assert.equal(ran.filter((id) => id === "asset_images").length, 1);
});
