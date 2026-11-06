// W7: a shot's picture set in motion (a clip on the timeline), the accent of a voice, a character's voice sample.
// Pure functions of the film model; the media "files" are records made here (no provider, no model).
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm, promptVideo as pv, validateProjectDocument, validatorEffectRegistry, validatorTransitionRegistry, type Registries } from "../src/index.ts";

let counter = 0;
const context = (): fm.OpContext => ({ now_ms: 2000, newId: () => `id_${++counter}` });
const blob = (name: string): string => name.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
const file = (name: string, kind: "image" | "audio" | "video", seconds?: number): pv.MediaFile => ({ blobId: blob(name), name, kind, bytes: 1000, ...(kind === "audio" ? {} : { width: 1920, height: 1080 }), ...(kind === "image" ? {} : { duration_ticks: Math.round((seconds ?? 1) * pv.TICKS) }), provenance: { source: "ai", provider: "test", model: "test", role: kind, jobId: name, created_ms: 1, referenceAssetIds: [] } });
const version = (name: string): fm.Version => ({ id: `v_${name}`, media: file(name, "image"), costUsd: 0.01, prompt: name, created_ms: 1 });
const clip = (name: string, pictureId: string, seconds: number): fm.PanelClip => ({ id: `c_${name}`, media: file(name, "video", seconds), costUsd: 0.13, prompt: name, created_ms: 1, pictureId, duration_ticks: Math.round(seconds * pv.TICKS) });
const raw = (language: string, extra: Record<string, unknown> = {}, people: Record<string, unknown>[] = [{ name: "Linh", role: "lead", gender: "female", description: "A lantern maker", appearance: "Seventeen, long braid" }, { name: "Minh", role: "supporting", gender: "male", description: "A visitor", appearance: "Sixteen, short hair" }]) => ({
  logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern for Minh.", ...extra, characters: people,
  locations: [{ name: "Street", description: "Old town street", appearance: "Yellow shopfronts" }], props: [],
  clips: [{ title: "The stall", panels: [
    { action: "Linh glues silk onto a frame.", duration_s: 4, shotSize: "medium", cameraMotion: "push-in", characters: ["Linh"], location: "Street", props: [], videoPrompt: "Her hands move slowly", lines: [{ kind: "dialogue", speaker: "Linh", text: "It is quieter this way." }] },
    { action: "Minh holds a lantern out.", duration_s: 6, shotSize: "close-up", cameraMotion: "static", characters: ["Minh"], location: "Street", props: [], lines: [{ kind: "dialogue", speaker: "Minh", text: "Can you fix it?" }, { kind: "narration", speaker: "Narrator", text: "She looked at the mark." }] },
  ] }],
});
const made = (language = "vi", extra: Record<string, unknown> = {}, people?: Record<string, unknown>[]): fm.Film => {
  const base = fm.applyOps(fm.createFilm({ id: "film_w7", now_ms: 1000, title: "The Lantern Keeper", language }), [{ op: "film.set", fields: { sourceText: "A story." } }], context());
  return fm.applyOps(base, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw(language, extra, people), base) }], context());
};
const drawn = (film: fm.Film): fm.Film => fm.applyOps(film, film.panels.map((panel, index) => ({ op: "panel.picture" as const, id: panel.id, version: version(`p${index}`) })), context());
const registries = { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() };
const assembled = (film: fm.Film) => fm.assembleFilm({ film, projectId: "11111111-1111-4111-8111-111111111111", runId: film.id, hash: "h".repeat(32), withoutMissing: false }, { now_ms: 3000, newId: () => `el_${++counter}`, writer: { id: "test" }, registries });
const mainOf = (document: { scenes: { tracks: { main: { elements: unknown[] } } }[] }) => document.scenes[0].tracks.main.elements as { type: string; startTime: number; duration: number; mediaId?: string; sourceDuration?: number; trimEnd?: number; freeze?: { sourceTime: number }; isSourceAudioEnabled?: boolean; animations?: unknown }[];

test("W7 clip — a shot whose picture was set in motion is a VIDEO on the timeline, cut to the shot; a shot longer than its clip holds the clip's last frame; a shot without a clip is its still as before", () => {
  let film = drawn(made());
  const [first, second] = film.panels;
  // No clip anywhere: stills, and the key of the timeline is what it was before clips existed (no extra entry).
  const before = assembled(film), key = JSON.stringify(fm.assemblyKey(film, false));
  assert.deepEqual(mainOf(before.document as never).map((element) => element.type), ["image", "image"]);
  assert.ok((fm.assemblyKey(film, false) as { panels: unknown[][] }).panels.every((entry) => entry.length === 4), "a film without clips keeps its key — and so its project");
  // The first shot (4 s) gets a 6 s clip: 4 s of it is played. The second shot (6 s) gets a 4 s clip: 4 s played, then its last frame held 2 s.
  film = fm.applyOps(film, [{ op: "panel.clip", id: first.id, clip: clip("clip-a", first.picture.current!.id, 6) }, { op: "panel.clip", id: second.id, clip: clip("clip-b", second.picture.current!.id, 4) }], context());
  assert.notEqual(JSON.stringify(fm.assemblyKey(film, false)), key, "a clip changes what the timeline is built from");
  const built = assembled(film), main = mainOf(built.document as never), frame = pv.TICKS / film.frameRate;
  assert.ok(validateProjectDocument(built.document, { mode: "strict" }).ok, JSON.stringify(validateProjectDocument(built.document, { mode: "strict" })).slice(0, 600));
  const firstShot = main.filter((element) => element.startTime < main[1].startTime || element === main[0]);
  assert.deepEqual(main.map((element) => [element.type, !!element.freeze]), [["video", false], ["video", false], ["video", true]]);
  assert.ok(firstShot.length >= 1);
  const [a, b, held] = main, shotOne = fm.layout(film).panels[0].duration_ticks, shotTwo = fm.layout(film).panels[1].duration_ticks;
  assert.deepEqual([a.startTime, a.duration, a.sourceDuration, a.trimEnd, a.isSourceAudioEnabled], [0, shotOne, 6 * pv.TICKS, 6 * pv.TICKS - shotOne, false], "the clip is cut to the shot, its own sound off");
  assert.deepEqual([b.startTime, b.duration, b.trimEnd], [shotOne, 4 * pv.TICKS, 0]);
  assert.deepEqual([held.startTime, held.duration, held.freeze!.sourceTime, held.mediaId === b.mediaId], [shotOne + 4 * pv.TICKS, shotTwo - 4 * pv.TICKS, 4 * pv.TICKS - frame, true], "the rest of the shot is the clip's LAST frame, not a jump back to the still");
  assert.equal(built.project.clips, 2, "two shots");
  assert.equal(a.animations, undefined, "a real video moves by itself: no zoom is laid over it");
});

test("W7 clip — a clip counts only for the picture it was started from, and a person can keep a shot a still: a new picture, or outdated words, put the still back on the timeline; `panel.still` does too, and comes back", () => {
  let film = drawn(made());
  const panel = film.panels[0];
  film = fm.applyOps(film, [{ op: "panel.clip", id: panel.id, clip: clip("clip-a", panel.picture.current!.id, 6) }], context());
  assert.equal(fm.clipOf(film.panels[0])?.id, "c_clip-a");
  // A person keeps the shot a still.
  const still = fm.applyOps(film, [{ op: "panel.still", id: panel.id, still: true }], context());
  assert.deepEqual(mainOf(assembled(still).document as never).map((element) => element.type), ["image", "image"]);
  assert.deepEqual(mainOf(assembled(fm.applyOps(still, [{ op: "panel.still", id: panel.id, still: false }], context())).document as never).map((element) => element.type), ["video", "image"]);
  // The frame's words change: its picture is outdated, and so is the clip that was made from it.
  const reworded = fm.applyOps(film, [{ op: "panel.update", id: panel.id, fields: { action: "Linh lights the lantern." } }], context());
  assert.equal(fm.clipOf(reworded.panels[0]), null);
  // Another picture is chosen: the clip was not started from it.
  const redrawn = fm.applyOps(fm.applyOps(film, [{ op: "panel.picture", id: panel.id, version: version("p0-second") }], context()), [{ op: "panel.use", id: panel.id, versionId: "v_p0-second" }], context());
  assert.equal(fm.clipOf(redrawn.panels[0]), null);
  assert.deepEqual(mainOf(assembled(redrawn).document as never).map((element) => element.type), ["image", "image"]);
  // Written again from the story: the clip stays with its frame (and still counts only for its picture).
  const rewritten = fm.applyOps(film, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw("vi"), film) }], context());
  assert.equal(rewritten.panels[0].clip?.id, "c_clip-a");
});

test("W7 accent — Vietnamese has Northern / Central / Southern; the script sets the film's ONE default and a person's own only where the story says so; a person's choice wins and survives a rewrite; what the voice model is told never goes into the text", () => {
  assert.deepEqual(fm.accentsOf("vi-VN").map((entry) => entry.id), ["northern", "central", "southern"]);
  assert.deepEqual(fm.accentsOf("en"), []);
  // The writer is asked for it, in the film's language.
  const prompt = fm.PROMPTS.breakdown({ language: "vi", sourceText: "x", artStyle: "custom", artStyleText: "ink", title: "t" } as never);
  assert.ok(/accent — the ONE accent this film is told in, one of: northern, central, southern/.test(prompt) && /accent \(one of northern, central, southern, or "" — ONLY when the story says this person speaks differently/.test(prompt));
  assert.ok(/ONLY when the story itself says or shows it/.test(fm.PROMPTS.breakdown({ language: "en", sourceText: "x", artStyle: "custom", artStyleText: "ink", title: "t" } as never)));
  // The story is set in Huế; Minh comes from Sài Gòn.
  let film = made("vi", { accent: "Central" }, [{ name: "Linh", role: "lead", gender: "female", description: "d", appearance: "a" }, { name: "Minh", role: "supporting", gender: "male", accent: "southern", description: "d", appearance: "a" }]);
  const linh = film.characters[0].id, minh = film.characters[1].id;
  assert.deepEqual([film.accent, film.accentAuto, film.characters[0].accent, film.characters[1].accent, film.characters[1].accentAuto], ["central", true, undefined, "southern", true]);
  assert.deepEqual([fm.accentOf(film, linh), fm.accentOf(film, minh), fm.accentOf(film, fm.NARRATOR)], ["central", "southern", "central"]);
  assert.equal(fm.accentWords("vi", "southern"), "Speak Vietnamese with a Southern (Sài Gòn) accent.");
  assert.equal(fm.accentWords("vi", ""), "");
  // A word that is not an accent of the language is no accent (never passed on as free words for a language with a list).
  assert.equal(made("vi", { accent: "like a pirate" }).accent, undefined);
  assert.equal(fm.accentValue("en", "  Scottish\nHighlands "), "Scottish Highlands");
  assert.equal(fm.accentWords("en", "Scottish"), "Speak with this accent: Scottish.");
  // A take exists for each speaker; a person gives Linh a Northern accent: only HER takes are outdated.
  const take = (name: string): fm.Take => ({ id: `t_${name}`, media: file(name, "audio", 2), costUsd: 0.01, duration_ticks: 2 * pv.TICKS, stale: false, voiceId: "", created_ms: 1 });
  film = fm.applyOps(film, film.lines.map((line, index) => ({ op: "line.take" as const, id: line.id, take: take(`l${index}`) })), context());
  film = fm.applyOps(film, [{ op: "asset.update", kind: "character", id: linh, fields: { accent: "northern" } }], context());
  assert.deepEqual([film.characters[0].accent, film.characters[0].accentAuto], ["northern", false]);
  assert.deepEqual(film.lines.map((line) => [line.speakerId === linh, line.takes[0].stale]), [[true, true], [false, false], [false, false]]);
  assert.throws(() => fm.applyOps(film, [{ op: "asset.update", kind: "character", id: linh, fields: { accent: "martian" } }], context()), (error: fm.FilmError) => error.code === "INVALID_PARAMS");
  // The film's default changes: everybody who speaks in the default (the narrator), not Minh who has his own.
  const moved = fm.applyOps(film, [{ op: "film.set", fields: { accent: "southern" } }], context());
  assert.deepEqual([moved.accent, moved.accentAuto, moved.lines.map((line) => line.takes[0].stale)], ["southern", false, [true, false, true]]);
  // Written again from the story (which now says Northern): the person's own choices stay.
  const again = fm.applyOps(moved, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw("vi", { accent: "northern" }, [{ name: "Linh", role: "lead", gender: "female", accent: "central", description: "d", appearance: "a" }, { name: "Minh", role: "supporting", gender: "male", description: "d", appearance: "a" }]), moved) }], context());
  assert.deepEqual([again.accent, again.characters[0].accent, again.characters[1].accent], ["southern", "northern", undefined]);
  // "" gives a speaker back to the film's default.
  assert.equal(fm.accentOf(fm.applyOps(again, [{ op: "asset.update", kind: "character", id: linh, fields: { accent: "" } }], context()), linh), "southern");
  // Rewriting a story can change an automatic accent while keeping the dialogue identical; those takes no longer match.
  let rewrittenAccent = made("vi", { accent: "central" });
  rewrittenAccent = fm.applyOps(rewrittenAccent, rewrittenAccent.lines.map((line, index) => ({ op: "line.take" as const, id: line.id, take: take(`rewrite${index}`) })), context());
  rewrittenAccent = fm.applyOps(rewrittenAccent, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw("vi", { accent: "northern" }), rewrittenAccent) }], context());
  assert.ok(rewrittenAccent.lines.every((line) => line.takes[0].stale), "unchanged lines spoken in a new effective accent have outdated takes");
});

test("W7 clip — changing Camera or Video prompt outdates motion without invalidating the still", () => {
  const base = drawn(made("vi")), panel = base.panels[0];
  const withClip = fm.applyOps(base, [{ op: "panel.clip", id: panel.id, clip: clip("motion", panel.picture.current!.id, 4) }], context());
  for (const fields of [{ cameraMotion: "pan-left" as const }, { videoPrompt: "Follow the lantern" }]) {
    const film = fm.applyOps(withClip, [{ op: "panel.update", id: panel.id, fields }], context()), edited = film.panels[0];
    assert.equal(edited.picture.stale, false);
    assert.equal(edited.clip?.id, "c_motion");
    assert.equal(edited.clip?.stale, true);
    assert.equal(fm.clipOf(edited), null);
    assert.deepEqual(mainOf(assembled(film).document as never).map((element) => element.type), ["image", "image"]);
  }
});

test("W7 voice sample — a character's own recording is kept with them (name, size, kind, what it says), outdates their takes when it is set or taken away, survives a rewrite of the script, and is refused when it is too large or not a file of the host", () => {
  let film = made("vi");
  const linh = film.characters[0].id;
  const take = (name: string): fm.Take => ({ id: `t_${name}`, media: file(name, "audio", 2), costUsd: 0.01, duration_ticks: 2 * pv.TICKS, stale: false, voiceId: "", created_ms: 1 });
  film = fm.applyOps(film, film.lines.map((line, index) => ({ op: "line.take" as const, id: line.id, take: take(`l${index}`) })), context());
  const sample = { blobId: blob("sample"), name: "my-voice.wav", bytes: 480_044, mime: "audio/wav", duration_ticks: 5 * pv.TICKS, text: "Xin chào, tôi là Linh." };
  film = fm.applyOps(film, [{ op: "voice.sample", id: linh, sample }], context());
  assert.deepEqual(film.characters[0].voiceSample, { ...sample, added_ms: 2000 });
  assert.deepEqual(film.lines.map((line) => line.takes[0].stale), [true, false, false], "only the takes of that speaker");
  assert.equal(fm.applyOps(film, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw("vi"), film) }], context()).characters[0].voiceSample?.blobId, sample.blobId);
  assert.throws(() => fm.applyOps(film, [{ op: "voice.sample", id: linh, sample: { ...sample, bytes: fm.VOICE_SAMPLE_LIMITS.maxBytes + 1 } }], context()), (error: fm.FilmError) => /at most 15 MB/.test(error.message));
  assert.throws(() => fm.applyOps(film, [{ op: "voice.sample", id: linh, sample: { ...sample, blobId: "not-a-blob" } }], context()), (error: fm.FilmError) => error.code === "INVALID_PARAMS");
  assert.throws(() => fm.applyOps(film, [{ op: "voice.sample", id: "nobody", sample }], context()), (error: fm.FilmError) => error.code === "NOT_FOUND");
  const gone = fm.applyOps(film, [{ op: "voice.sample", id: linh, sample: null }], context());
  assert.equal(gone.characters[0].voiceSample, undefined);
});
