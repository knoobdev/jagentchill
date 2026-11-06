import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptDocument } from "@jagentchill/protocol";
import { script as s } from "../src/index.ts";
import { seeded } from "./support/script.ts";

const ids = seeded();
let clock = 1_000;
const env = () => ({ ids, now_ms: (clock += 5_000) });
const blank = (locale = "en"): ScriptDocument => s.createScript({ ids, now_ms: 1, locale });
const run = <I>(doc: ScriptDocument, command: s.ScriptCommand<I>) => s.executeScript(doc, command, env(), { confirmApprovedEdit: true });
/** A script with `scenes` scenes, each with one beat of `lines` action lines "S<n> L<m>". */
function build(scenes: number, lines: number): ScriptDocument {
  const doc = blank();
  doc.scenes = Array.from({ length: scenes }, (_, sceneIndex) => s.newScene(ids, { beats: [s.newBeat(ids, "", "", Array.from({ length: lines }, (_, lineIndex) => s.newLine(ids, "action", `S${sceneIndex + 1} L${lineIndex + 1}`)))] }));
  return doc;
}
const allIds = (doc: ScriptDocument) => doc.scenes.flatMap((scene) => [scene.id, ...scene.beats.flatMap((beat) => [beat.id, ...beat.lines.map((line) => line.id)]), ...scene.shots.map((shot) => shot.id)]).sort();
const throwsCode = (work: () => unknown, code: string, message?: string | RegExp) => assert.throws(work, (error: unknown) => {
  assert.ok(error instanceof s.ScriptError, String(error)); assert.equal(error.code, code);
  if (typeof message === "string") assert.equal(error.message, message); else if (message) assert.match(error.message, message);
  return true;
});

// Requirement: Script document
test("an id is 16 random bytes in base64url", () => {
  const id = s.scriptId();
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(id, s.scriptId());
});
test("Ids survive reordering", () => {
  let doc = build(3, 2);
  doc = run(doc, s.autoShots()).document;
  const before = allIds(doc), third = doc.scenes[2].id;
  doc = run(doc, s.moveScene(third, 0)).document;
  assert.equal(doc.scenes[0].id, third);
  assert.deepEqual(allIds(doc), before);
  assert.equal(s.sceneNumber(doc, third), 1);
});
test("Schema violation: an empty title is refused with SCRIPT_SCHEMA_INVALID naming the path title", () => {
  const doc = blank();
  throwsCode(() => run(doc, s.setTitle("")), "SCRIPT_SCHEMA_INVALID", /^title:/);
  const result = s.validateScript({ ...doc, title: "" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => [error.code, error.path]), [["SCRIPT_SCHEMA_INVALID", "title"]]);
});
test("Script without acts", () => {
  const doc = blank();
  assert.deepEqual(doc.acts, []);
  assert.ok(doc.scenes.every((scene) => scene.actId === undefined));
  assert.ok(s.validateScript(doc).ok);
});

// Requirement: Script metadata
test("Defaults: a blank script in locale vi", () => {
  const doc = blank("vi");
  assert.equal(doc.meta.language, "vi"); assert.equal(doc.meta.aspectRatio, "9:16"); assert.equal(doc.meta.pace, "normal"); assert.equal(doc.meta.targetDuration_s, undefined);
});
test("Target duration out of range", () => {
  const doc = blank();
  throwsCode(() => run(doc, s.setMeta({ targetDuration_s: 4 * 3600 })), "SCRIPT_SCHEMA_INVALID", "Target duration must be between 5 seconds and 3 hours");
  assert.equal(run(doc, s.setMeta({ targetDuration_s: 120 })).document.meta.targetDuration_s, 120);
  assert.equal(run(run(doc, s.setMeta({ targetDuration_s: 120 })).document, s.setMeta({ targetDuration_s: undefined })).document.meta.targetDuration_s, undefined);
});

// Requirement: Acts, scenes, beats and lines
test("Dialogue without a speaker is marked and does not block the save", () => {
  let doc = blank();
  const beat = doc.scenes[0].beats[0];
  const added = run(doc, s.addLine({ beatId: beat.id, kind: "dialogue", text: "Hello" }));
  doc = added.document;
  assert.ok(s.validateScript(doc).ok);
  assert.deepEqual(s.lineProblems(doc).map((issue) => [issue.code, issue.message, issue.id]), [["SCRIPT_LINE_INVALID", "Add a speaker", added.info.lineId]]);
  doc = run(doc, s.setSpeaker(added.info.lineId, "Mai")).document;
  assert.deepEqual(s.lineProblems(doc), []);
});
test("Omitted scene keeps numbering", () => {
  let doc = build(6, 1);
  const fifth = doc.scenes[4].id, sixth = doc.scenes[5].id;
  doc = run(doc, s.updateScenes([doc.scenes[3].id], { omitted: true })).document;
  assert.equal(doc.scenes[3].omitted, true);
  assert.equal(s.sceneNumber(doc, fifth), 5); assert.equal(s.sceneNumber(doc, sixth), 6);
  assert.equal(s.sceneTicks(doc, doc.scenes[3]), 0);
  assert.match(s.screenplayText(doc, { sceneNumbers: true }), /^4\. OMITTED$/m);
});
test("Minimum beat: deleting the only beat leaves an empty beat in the same undo step", () => {
  const doc = build(1, 2), history = s.createScriptHistory();
  const result = run(doc, s.deleteBeat(doc.scenes[0].beats[0].id));
  history.record(doc, result, 10);
  assert.equal(result.document.scenes[0].beats.length, 1);
  assert.deepEqual(result.document.scenes[0].beats[0].lines, []);
  assert.notEqual(result.document.scenes[0].beats[0].id, doc.scenes[0].beats[0].id);
  assert.equal(history.undo(result.document, 20)!.document.scenes[0].beats[0].lines.length, 2);
});
test("a line holds at most the characters of its kind", () => {
  const doc = build(1, 1), line = doc.scenes[0].beats[0].lines[0];
  throwsCode(() => run(run(doc, s.setLineKind([line.id], "on_screen_text")).document, s.updateLine(line.id, { text: "x".repeat(201) })), "SCRIPT_SCHEMA_INVALID");
  assert.ok(run(doc, s.updateLine(line.id, { text: "x".repeat(4000) })).changed);
});

// Requirement: Shots
test("Derived number: a shot inserted before the second shot of scene 3 is 3.2", () => {
  let doc = build(3, 1);
  const scene = doc.scenes[2].id;
  const a = run(doc, s.addShot(scene)); doc = a.document;
  const b = run(doc, s.addShot(scene)); doc = b.document;
  const inserted = run(doc, s.addShot(scene, { beforeShotId: b.info.shotId })); doc = inserted.document;
  assert.equal(s.shotNumber(doc, inserted.info.shotId), "3.2"); assert.equal(s.shotNumber(doc, b.info.shotId), "3.3"); assert.equal(s.shotNumber(doc, a.info.shotId), "3.1");
  const shot = s.findShot(doc, inserted.info.shotId)!.shot;
  assert.deepEqual([shot.size, shot.angle, shot.movement, shot.source, shot.transitionOut], ["medium", "eye-level", "static", "auto", "cut"]);
});
test("Duration override bounds", () => {
  let doc = build(1, 1);
  const { info, document } = run(doc, s.addShot(doc.scenes[0].id)); doc = document;
  throwsCode(() => run(doc, s.updateShots([info.shotId], { durationOverride_ticks: s.parseDuration("0.2")! })), "SCRIPT_SCHEMA_INVALID", "Shot duration must be between 0.5 and 120 seconds");
  doc = run(doc, s.updateShots([info.shotId], { durationOverride_ticks: s.parseDuration("1:05")! })).document;
  assert.equal(s.findShot(doc, info.shotId)!.shot.durationOverride_ticks, 65 * 120_000);
  assert.equal(s.parseDuration("abc"), null);
});
test("Uncovered lines: 6 lines with shots covering 4", () => {
  let doc = build(1, 6);
  const lines = doc.scenes[0].beats[0].lines.map((line) => line.id);
  doc = run(doc, s.shotFromSelection(lines.slice(0, 4))).document;
  assert.deepEqual(s.uncoveredLines(doc.scenes[0]).map((line) => line.id), lines.slice(4));
});
test("Auto shots: 3 beats give 3 shots covering each beat's lines, wide, medium, close-up", () => {
  let doc = build(1, 2);
  doc = run(doc, s.addBeat(doc.scenes[0].id)).document;
  doc = run(doc, s.addBeat(doc.scenes[0].id)).document;
  const result = run(doc, s.autoShots());
  assert.equal(result.info.created, 3);
  const scene = result.document.scenes[0];
  assert.deepEqual(scene.shots.map((shot) => shot.size), ["wide", "medium", "close-up"]);
  scene.shots.forEach((shot, index) => assert.deepEqual(shot.lineIds, scene.beats[index].lines.map((line) => line.id)));
  assert.equal(run(result.document, s.autoShots()).changed, false, "scenes that have shots are left alone");
});
test("Bulk edit: 5 shots change in one undo step", () => {
  let doc = build(1, 1);
  const shotIds: string[] = [];
  for (let index = 0; index < 5; index++) { const added = run(doc, s.addShot(doc.scenes[0].id)); doc = added.document; shotIds.push(added.info.shotId); }
  const history = s.createScriptHistory(), result = run(doc, s.updateShots(shotIds, { movement: "handheld" }));
  history.record(doc, result, 1);
  assert.ok(result.document.scenes[0].shots.every((shot) => shot.movement === "handheld"));
  assert.equal(history.length, 1);
  assert.ok(history.undo(result.document, 2)!.document.scenes[0].shots.every((shot) => shot.movement === "static"));
});
test("shots: duplicate, move and delete keep the other ids", () => {
  let doc = build(1, 1);
  const a = run(doc, s.addShot(doc.scenes[0].id, { fields: { description: "A" } })); doc = a.document;
  const copy = run(doc, s.duplicateShot(a.info.shotId)); doc = copy.document;
  assert.deepEqual(doc.scenes[0].shots.map((shot) => shot.description), ["A", "A"]);
  doc = run(doc, s.moveShot(copy.info.shotId, -1)).document;
  assert.equal(doc.scenes[0].shots[0].id, copy.info.shotId);
  doc = run(doc, s.deleteShots([copy.info.shotId])).document;
  assert.deepEqual(doc.scenes[0].shots.map((shot) => shot.id), [a.info.shotId]);
});

// Requirement: Character, location and prop references
test("Cue completion: MA offers MAI and accepting it sets characterId", () => {
  let doc = build(1, 1);
  const mai = run(doc, s.addEntity("characters", "MAI")); doc = mai.document;
  assert.deepEqual(s.completeCue(doc, "MA").map((entity) => entity.name), ["MAI"]);
  const line = doc.scenes[0].beats[0].lines[0].id;
  doc = run(run(doc, s.setLineKind([line], "dialogue")).document, s.setSpeaker(line, "mai")).document;
  assert.equal(doc.scenes[0].beats[0].lines[0].characterId, mai.info.entityId);
  doc = run(doc, s.setSpeaker(line, "Bao")).document;
  assert.deepEqual(doc.entities.characters.map((entity) => entity.name), ["MAI", "Bao"], "a new name creates a local character");
});
test("Delete a referenced character: replace with another or keep the name as text, in one undo step", () => {
  let doc = build(1, 14);
  const mai = run(doc, s.addEntity("characters", "MAI")); doc = mai.document;
  const lan = run(doc, s.addEntity("characters", "LAN")); doc = lan.document;
  const lineIds = doc.scenes[0].beats[0].lines.map((line) => line.id);
  doc = run(doc, s.setLineKind(lineIds, "dialogue")).document;
  for (const id of lineIds) doc = run(doc, s.updateLine(id, { characterId: mai.info.entityId })).document;
  assert.deepEqual(s.entityUsage(doc, "characters", mai.info.entityId), { lines: 14, scenes: 1, shots: 0 });
  const replaced = run(doc, s.deleteEntity("characters", mai.info.entityId, { replaceWith: lan.info.entityId })).document;
  assert.ok(replaced.scenes[0].beats[0].lines.every((line) => line.characterId === lan.info.entityId));
  const history = s.createScriptHistory(), kept = run(doc, s.deleteEntity("characters", mai.info.entityId));
  history.record(doc, kept, 1);
  assert.ok(kept.document.scenes[0].beats[0].lines.every((line) => line.characterId === undefined && line.speakerText === "MAI"));
  assert.equal(history.undo(kept.document, 2)!.document.entities.characters.length, 2);
});
test("entity names are unique per kind ignoring case", () => {
  const doc = run(build(1, 1), s.addEntity("characters", "Mai")).document;
  throwsCode(() => run(doc, s.addEntity("characters", "MAI")), "SCRIPT_SCHEMA_INVALID");
  assert.ok(run(doc, s.addEntity("locations", "MAI")).changed);
});
test("Rename a character: cues follow and mentions keep their capitalisation pattern, in one undo step", () => {
  let doc = build(1, 2);
  const mai = run(doc, s.addEntity("characters", "MAI")); doc = mai.document;
  const [first, second] = doc.scenes[0].beats[0].lines.map((line) => line.id);
  doc = run(doc, s.updateLine(first, { text: "Mai walks in. MAI waves; mai smiles. Maize is not Mai's." })).document;
  doc = run(run(doc, s.setLineKind([second], "dialogue")).document, s.updateLine(second, { characterId: mai.info.entityId, text: "I am Mai." })).document;
  const history = s.createScriptHistory(), result = run(doc, s.renameCharacter(mai.info.entityId, "LAN", true));
  history.record(doc, result, 1);
  assert.equal(s.speakerOf(result.document, s.findLine(result.document, second)!.line), "LAN");
  assert.equal(s.findLine(result.document, first)!.line.text, "Lan walks in. LAN waves; lan smiles. Maize is not Lan's.");
  assert.equal(s.findLine(result.document, second)!.line.text, "I am Lan.");
  assert.equal(result.info.mentions, 5);
  assert.equal(s.findLine(history.undo(result.document, 2)!.document, first)!.line.text, "Mai walks in. MAI waves; mai smiles. Maize is not Mai's.");
});

// Requirement: Script limits
test("Scene limit: the 501st scene is refused with the message naming the limit", () => {
  const doc = build(500, 0);
  throwsCode(() => run(doc, s.addScene()), "SCRIPT_LIMIT_EXCEEDED", "A script can have at most 500 scenes");
});
test("every limit refuses the edit that passes it", () => {
  const doc = build(1, 1), scene = doc.scenes[0];
  const over = (mutate: (draft: ScriptDocument) => void, limit: string) => assert.throws(() => run(doc, { type: "t", label: "t", run: mutate }), (error: unknown) => error instanceof s.ScriptError && error.code === "SCRIPT_LIMIT_EXCEEDED" && error.details.limit === limit);
  over((draft) => { draft.acts = Array.from({ length: 21 }, () => ({ id: ids(), title: "", summary: "" })); }, "acts");
  over((draft) => { draft.scenes[0].beats = Array.from({ length: 101 }, () => s.newBeat(ids)); }, "beatsPerScene");
  over((draft) => { draft.scenes[0].beats[0].lines = Array.from({ length: 201 }, () => s.newLine(ids)); }, "linesPerBeat");
  over((draft) => { draft.scenes[0].shots = Array.from({ length: 61 }, () => s.newShot(ids)); }, "shotsPerScene");
  over((draft) => { draft.scenes = Array.from({ length: 151 }, () => s.newScene(ids, { beats: [s.newBeat(ids, "", "", [s.newLine(ids, "action", "x".repeat(4000))])] })); }, "characters");
  over((draft) => { draft.scenes = Array.from({ length: 34 }, () => s.newScene(ids, { shots: Array.from({ length: 60 }, () => s.newShot(ids)) })); }, "shots");
  assert.equal(scene.beats.length, 1, "the refused edits changed nothing");
});

// Requirement: Structured editor
test("Change a line's kind: action to dialogue keeps the text", () => {
  const doc = build(1, 1), line = doc.scenes[0].beats[0].lines[0];
  const next = run(doc, s.setLineKind([line.id], "dialogue")).document.scenes[0].beats[0].lines[0];
  assert.deepEqual([next.kind, next.text, next.id], ["dialogue", "S1 L1", line.id]);
});
test("Drag a line to another scene: it keeps its id, the old scene's shots drop it, one undo restores both", () => {
  let doc = build(3, 3);
  const moved = doc.scenes[1].beats[0].lines[1].id;
  doc = run(doc, s.shotFromSelection(doc.scenes[1].beats[0].lines.map((line) => line.id))).document;
  const history = s.createScriptHistory(), target = doc.scenes[2].beats[0];
  const result = run(doc, s.moveLines([moved], { beatId: target.id, beforeLineId: target.lines[0].id }));
  history.record(doc, result, 1);
  assert.equal(result.document.scenes[2].beats[0].lines[0].id, moved);
  assert.equal(result.document.scenes[1].shots[0].lineIds.includes(moved), false);
  const undone = history.undo(result.document, 2)!.document;
  assert.equal(undone.scenes[1].beats[0].lines[1].id, moved);
  assert.equal(undone.scenes[1].shots[0].lineIds.includes(moved), true);
});
test("Split a scene: a new scene from that line onward with a copied heading; shots follow the lines they cover", () => {
  let doc = build(1, 5);
  const lines = doc.scenes[0].beats[0].lines.map((line) => line.id);
  doc = run(doc, s.updateScenes([doc.scenes[0].id], { heading: { setting: "INT", locationText: "KITCHEN", timeOfDay: "NIGHT" } })).document;
  const early = run(doc, s.shotFromSelection(lines.slice(0, 2))); doc = early.document;
  const late = run(doc, s.shotFromSelection(lines.slice(3))); doc = late.document;
  const result = run(doc, s.splitScene(lines[3]));
  const [first, second] = result.document.scenes;
  assert.deepEqual(first.beats[0].lines.map((line) => line.id), lines.slice(0, 3));
  assert.deepEqual(second.beats[0].lines.map((line) => line.id), lines.slice(3));
  assert.deepEqual(second.heading, first.heading);
  assert.deepEqual(first.shots.map((shot) => shot.id), [early.info.shotId]);
  assert.deepEqual(second.shots.map((shot) => shot.id), [late.info.shotId]);
  const merged = run(result.document, s.mergeSceneWithPrevious(second.id)).document;
  assert.equal(merged.scenes.length, 1);
  assert.deepEqual(merged.scenes[0].beats.flatMap((beat) => beat.lines.map((line) => line.id)), lines);
});
test("scenes: add, duplicate with new ids, delete, acts keep their scenes together", () => {
  let doc = build(2, 1);
  const act = run(doc, s.addAct("One")); doc = act.document;
  const second = run(doc, s.addAct("Two")); doc = second.document;
  doc = run(doc, s.updateScenes([doc.scenes[0].id], { actId: act.info.actId })).document;
  doc = run(doc, s.updateScenes([doc.scenes[1].id], { actId: second.info.actId })).document;
  const added = run(doc, s.addScene({ afterSceneId: doc.scenes[0].id })); doc = added.document;
  assert.equal(doc.scenes[1].id, added.info.sceneId); assert.equal(doc.scenes[1].actId, act.info.actId, "a new scene joins the act of the scene before it");
  const copy = run(doc, s.duplicateScenes([doc.scenes[0].id])); doc = copy.document;
  assert.equal(new Set(allIds(doc)).size, allIds(doc).length);
  assert.equal(doc.scenes[1].beats[0].lines[0].text, "S1 L1");
  doc = run(doc, s.moveAct(second.info.actId, -1)).document;
  assert.deepEqual(doc.acts.map((entry) => entry.title), ["Two", "One"]);
  assert.equal(doc.scenes[0].actId, second.info.actId);
  doc = run(doc, s.updateAct(act.info.actId, { title: "First" })).document;
  doc = run(doc, s.deleteAct(act.info.actId)).document;
  assert.equal(doc.scenes.filter((scene) => scene.actId).length, 1);
  doc = run(doc, s.deleteScenes(copy.info.sceneIds)).document;
  assert.equal(doc.scenes.length, 3);
});
test("beats: add, update, duplicate, move, split and merge", () => {
  let doc = build(1, 4);
  const lines = doc.scenes[0].beats[0].lines.map((line) => line.id), first = doc.scenes[0].beats[0].id;
  const split = run(doc, s.splitBeat(lines[2])); doc = split.document;
  assert.deepEqual(doc.scenes[0].beats.map((beat) => beat.lines.length), [2, 2]);
  doc = run(doc, s.updateBeat(split.info.beatId, { label: "Payoff", intent: "Deliver" })).document;
  doc = run(doc, s.moveBeat(split.info.beatId, -1)).document;
  assert.deepEqual(doc.scenes[0].beats.map((beat) => beat.label), ["Payoff", ""]);
  const copy = run(doc, s.duplicateBeat(first)); doc = copy.document;
  assert.equal(doc.scenes[0].beats.length, 3);
  doc = run(doc, s.deleteBeat(copy.info.beatId)).document;
  doc = run(doc, s.mergeBeatWithPrevious(first)).document;
  assert.deepEqual(doc.scenes[0].beats.map((beat) => beat.lines.map((line) => line.id)), [[...lines.slice(2), ...lines.slice(0, 2)]]);
});
test("lines: add, duplicate, split, merge, move up and down across beats, delete", () => {
  let doc = build(2, 2);
  const [a, b] = doc.scenes[0].beats[0].lines.map((line) => line.id);
  doc = run(doc, s.updateLine(a, { text: "Hello there world" })).document;
  const split = run(doc, s.splitLine(a, 5)); doc = split.document;
  assert.deepEqual(doc.scenes[0].beats[0].lines.slice(0, 2).map((line) => line.text), ["Hello", "there world"]);
  doc = run(doc, s.shotFromSelection([split.info.lineId])).document;
  const merged = run(doc, s.mergeLineWithPrevious(split.info.lineId)); doc = merged.document;
  assert.equal(s.findLine(doc, a)!.line.text, "Hello there world");
  assert.deepEqual([merged.info.lineId, merged.info.offset], [a, 5]);
  assert.deepEqual(doc.scenes[0].shots[0].lineIds, [a], "the shot that covered the joined line covers the result");
  doc = run(doc, s.moveLineBy(a, 1)).document;
  assert.deepEqual(doc.scenes[0].beats[0].lines.map((line) => line.id), [b, a]);
  doc = run(doc, s.moveLineBy(a, 1)).document;
  assert.equal(doc.scenes[1].beats[0].lines[0].id, a, "past the end of a beat a line enters the next beat");
  doc = run(doc, s.moveLineBy(a, -1)).document;
  assert.equal(doc.scenes[0].beats[0].lines[1].id, a);
  const copy = run(doc, s.duplicateLine(a)); doc = copy.document;
  doc = run(doc, s.deleteLines([copy.info.lineId, b])).document;
  assert.deepEqual(doc.scenes[0].beats[0].lines.map((line) => line.id), [a]);
});
test("details and constraints are commands", () => {
  let doc = blank();
  doc = run(doc, s.setTitle("Lamp ad")).document;
  doc = run(doc, s.setMeta({ logline: "A lamp.", genre: ["commercial"], tags: ["lamp"], pace: "fast", aspectRatio: "16:9" })).document;
  doc = run(doc, s.setConstraints({ mustAvoid: ["guaranteed"], lineMaxChars: 200 })).document;
  assert.deepEqual([doc.title, doc.meta.logline, doc.meta.pace, doc.constraints?.lineMaxChars], ["Lamp ad", "A lamp.", "fast", 200]);
  assert.equal(run(doc, s.setConstraints(undefined)).document.constraints, undefined);
  throwsCode(() => run(doc, s.setMeta({ genre: ["drama", "comedy", "action", "horror"] })), "SCRIPT_SCHEMA_INVALID");
});

// Requirement: Script status lifecycle (the write guard of commands)
test("Locked script: an edit fails with SCRIPT_LOCKED; in review with SCRIPT_READ_ONLY", () => {
  const doc = build(1, 1), line = doc.scenes[0].beats[0].lines[0].id;
  throwsCode(() => s.executeScript({ ...doc, status: "locked" }, s.updateLine(line, { text: "x" }), env()), "SCRIPT_LOCKED", "Locked — unlock to edit");
  throwsCode(() => s.executeScript({ ...doc, status: "in_review" }, s.updateLine(line, { text: "x" }), env()), "SCRIPT_READ_ONLY");
  assert.ok(s.executeScript({ ...doc, status: "in_review" }, s.updateLine(line, { text: "x" }), env(), { reviewerEdit: true }).changed);
});
test("Edit an approved script: it needs the confirmation, becomes a draft and keeps approvedVersionId", () => {
  const doc = { ...build(1, 1), status: "approved" as const, approvedVersionId: "v7" }, line = doc.scenes[0].beats[0].lines[0].id;
  assert.throws(() => s.executeScript(doc, s.updateLine(line, { text: "x" }), env()), (error: unknown) => error instanceof s.ScriptError && error.details.needsConfirmation === true);
  const next = s.executeScript(doc, s.updateLine(line, { text: "x" }), env(), { confirmApprovedEdit: true }).document;
  assert.deepEqual([next.status, next.approvedVersionId], ["draft", "v7"]);
  assert.equal(s.executeScript({ ...doc, status: "changes_requested" }, s.updateLine(line, { text: "y" }), env()).document.status, "draft");
});

// Requirement: Undo, redo and autosave
test("Typing coalesces: a sentence typed without pausing is one undo step", () => {
  let doc = build(1, 1);
  const line = doc.scenes[0].beats[0].lines[0].id, history = s.createScriptHistory(), start = doc;
  let at = 0;
  for (const text of ["M", "Me", "Mee", "Meet", "Meet the lamp."]) { const result = s.executeScript(doc, s.updateLine(line, { text }), { ids, now_ms: at }); history.record(doc, result, at); doc = result.document; at += 200; }
  assert.equal(history.length, 1);
  const undone = history.undo(doc, at)!;
  assert.equal(s.findLine(undone.document, line)!.line.text, s.findLine(start, line)!.line.text);
  assert.equal(s.findLine(history.redo(undone.document, at)!.document, line)!.line.text, "Meet the lamp.");
});
test("a pause of more than 1 s, a caret move or another command starts a new step", () => {
  let doc = build(1, 1);
  const line = doc.scenes[0].beats[0].lines[0].id, history = s.createScriptHistory();
  const type = (text: string, at: number) => { const result = s.executeScript(doc, s.updateLine(line, { text }), { ids, now_ms: at }); history.record(doc, result, at); doc = result.document; };
  type("a", 0); type("ab", 1500);
  assert.equal(history.length, 2, "a pause");
  history.seal(); type("abc", 1600);
  assert.equal(history.length, 3, "a caret move");
  const other = s.executeScript(doc, s.setTitle("T"), { ids, now_ms: 1700 }); history.record(doc, other, 1700); doc = other.document; type("abcd", 1800);
  assert.equal(history.length, 5, "a different command");
});
test("the history holds 200 steps and undo never reverses the status", () => {
  let doc = build(1, 1);
  const history = s.createScriptHistory();
  for (let index = 0; index < 205; index++) { const result = s.executeScript(doc, s.setTitle(`T${index}`), { ids, now_ms: index * 5000 }); history.record(doc, result, index * 5000); doc = result.document; }
  assert.equal(history.length, 200);
  const undone = history.undo({ ...doc, status: "changes_requested", headVersionId: "head2", approvedVersionId: "v1" }, 1)!.document;
  assert.deepEqual([undone.title, undone.status, undone.headVersionId, undone.approvedVersionId], ["T203", "changes_requested", "head2", "v1"]);
  history.clear();
  assert.equal(history.canUndo, false);
});

// Requirement: Formatting shortcuts and typing behaviour
const apply = (doc: ScriptDocument, outcome: s.TypingOutcome): { doc: ScriptDocument; info: any } => { let info: any; for (const command of outcome.commands) { const result = run(doc, command); doc = result.document; info = result.info; } return { doc, info }; };
test("Enter flow: a cue, Enter, dialogue, Enter gives a cue, a dialogue line and a new empty action line with focus", () => {
  let doc = build(1, 0);
  const beat = doc.scenes[0].beats[0].id;
  const added = run(doc, s.addLine({ beatId: beat, kind: "dialogue" })); doc = added.document;
  const line = added.info.lineId;
  doc = run(doc, s.setSpeaker(line, "MAI")).document;
  const first = s.typingRule(doc, { key: "Enter", lineId: line, field: "cue" })!;
  assert.deepEqual([first.commands.length, first.focus], [0, { lineId: line, field: "text" }]);
  doc = run(doc, s.updateLine(line, { text: "Hello." })).document;
  const second = s.typingRule(doc, { key: "Enter", lineId: line, field: "text", caret: 6 })!;
  const after = apply(doc, second);
  assert.deepEqual(second.focus, { created: true, field: "text" });
  assert.deepEqual(after.doc.scenes[0].beats[0].lines.map((entry) => [entry.kind, entry.text]), [["dialogue", "Hello."], ["action", ""]]);
  assert.equal(after.info.lineId, after.doc.scenes[0].beats[0].lines[1].id);
  // A second Enter on the empty action line starts a character cue.
  const third = s.typingRule(after.doc, { key: "Enter", lineId: after.info.lineId, field: "text", caret: 0 })!;
  assert.equal(apply(after.doc, third).doc.scenes[0].beats[0].lines[1].kind, "dialogue");
  assert.equal(third.focus.field, "cue");
});
test("Enter on an empty line in a beat's last position exits to a new beat", () => {
  let doc = build(1, 1);
  const beat = doc.scenes[0].beats[0].id;
  const added = run(doc, s.addLine({ beatId: beat, kind: "dialogue" })); doc = added.document;
  const after = apply(doc, s.typingRule(doc, { key: "Enter", lineId: added.info.lineId, field: "text", caret: 0 })!);
  assert.deepEqual(after.doc.scenes[0].beats.map((entry) => entry.lines.length), [1, 1]);
  assert.equal(after.info.beatId, after.doc.scenes[0].beats[1].id);
});
test("Tab cycle: empty action, Tab twice gives a cue then a transition; Shift+Tab twice returns to action", () => {
  let doc = build(1, 0);
  const added = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id })); doc = added.document;
  const line = added.info.lineId, kind = () => s.findLine(doc, line)!.line.kind;
  let outcome = s.typingRule(doc, { key: "Tab", lineId: line, field: "text" })!; doc = apply(doc, outcome).doc;
  assert.deepEqual([kind(), outcome.focus.field], ["dialogue", "cue"]);
  outcome = s.typingRule(doc, { key: "Tab", lineId: line, field: "cue" })!; doc = apply(doc, outcome).doc;
  assert.equal(kind(), "transition");
  outcome = s.typingRule(doc, { key: "ShiftTab", lineId: line, field: "text" })!; doc = apply(doc, outcome).doc;
  assert.deepEqual([kind(), outcome.focus.field], ["dialogue", "cue"]);
  outcome = s.typingRule(doc, { key: "ShiftTab", lineId: line, field: "cue" })!; doc = apply(doc, outcome).doc;
  assert.equal(kind(), "action");
  const dialogue = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id, kind: "dialogue", text: "Hi" }));
  assert.deepEqual(s.typingRule(dialogue.document, { key: "Tab", lineId: dialogue.info.lineId, field: "text" })!.focus, { lineId: dialogue.info.lineId, field: "parenthetical" });
});
test("IME composition: no rule fires while a composition is active", () => {
  const doc = build(1, 1), line = doc.scenes[0].beats[0].lines[0].id;
  assert.equal(s.typingRule(doc, { key: "Enter", lineId: line, field: "text", composing: true }), null);
  assert.equal(s.textRule(doc, line, "INT. ", true), null);
  assert.notEqual(s.typingRule(doc, { key: "Enter", lineId: line, field: "text" }), null);
});
test("Backspace at the start of an empty typed line converts it to action before deleting it", () => {
  let doc = build(1, 1);
  const added = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id, kind: "transition" })); doc = added.document;
  doc = apply(doc, s.typingRule(doc, { key: "Backspace", lineId: added.info.lineId, field: "text", caret: 0 })!).doc;
  assert.equal(s.findLine(doc, added.info.lineId)!.line.kind, "action");
  const second = s.typingRule(doc, { key: "Backspace", lineId: added.info.lineId, field: "text", caret: 0 })!;
  doc = apply(doc, second).doc;
  assert.equal(s.findLine(doc, added.info.lineId), undefined);
  assert.equal(second.focus.lineId, doc.scenes[0].beats[0].lines[0].id);
});
test("typing ( at the start of dialogue starts a parenthetical; INT. at the start of an action line makes a scene heading", () => {
  let doc = build(1, 2);
  const [first, second] = doc.scenes[0].beats[0].lines.map((line) => line.id);
  const dialogue = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id, kind: "dialogue" }));
  assert.equal(s.textRule(dialogue.document, dialogue.info.lineId, "(")!.focus.field, "parenthetical");
  const heading = s.textRule(doc, second, "INT. ")!;
  doc = apply(doc, heading).doc;
  assert.equal(doc.scenes.length, 2);
  assert.deepEqual([doc.scenes[1].heading.setting, doc.scenes[1].beats[0].lines[0].id, doc.scenes[1].beats[0].lines[0].text], ["INT", second, ""]);
  doc = apply(doc, s.textRule(doc, first, "EXT. ")!).doc;
  assert.deepEqual([doc.scenes.length, doc.scenes[0].heading.setting], [2, "EXT"], "the first line of a scene with no heading sets that scene's heading");
});

// Requirement: Duration estimate
test("English narration: 30 words at pace normal is 12.3 s (1,476,000 ticks)", () => {
  const doc = build(1, 0);
  doc.scenes[0].beats[0].lines = [s.newLine(ids, "narration", Array.from({ length: 30 }, () => "word").join(" "))];
  assert.equal(s.sceneTicks(doc, doc.scenes[0]), 1_476_000);
});
test("Vietnamese dialogue at fast pace: 45 syllables is 9.0 s", () => {
  const doc = blank("vi"); doc.meta.pace = "fast";
  doc.scenes[0].beats[0].lines = [s.newLine(ids, "dialogue", Array.from({ length: 45 }, () => "tiếng").join(" "))];
  assert.equal(s.sceneTicks(doc, doc.scenes[0]), 9 * 120_000);
});
test("On-screen text alone: a beat with only a 2-word on-screen text lasts 1.5 s", () => {
  const doc = blank();
  doc.scenes[0].beats[0].lines = [s.newLine(ids, "on_screen_text", "New lamp")];
  assert.equal(s.beatTicks(doc, doc.scenes[0].beats[0]), 180_000);
  doc.scenes[0].beats[0].lines.push(s.newLine(ids, "narration", "one two three four five"));
  assert.equal(s.beatTicks(doc, doc.scenes[0].beats[0]), s.toEstimateTicks(5 / 2.5 + 0.3), "with a timed line the text runs concurrently");
});
test("Shot override: the shot shows 6.0 s and the scene total still equals the sum of its lines", () => {
  let doc = build(1, 0);
  const line = s.newLine(ids, "narration", Array.from({ length: 10 }, () => "w").join(" "));
  doc.scenes[0].beats[0].lines = [line];
  const shot = run(doc, s.shotFromSelection([line.id])); doc = shot.document;
  const sum = s.sceneTicks(doc, doc.scenes[0]);
  assert.equal(s.shotTicks(doc, doc.scenes[0], doc.scenes[0].shots[0]), sum);
  doc = run(doc, s.updateShots([shot.info.shotId], { durationOverride_ticks: 720_000 })).document;
  assert.equal(s.formatSeconds(s.shotTicks(doc, doc.scenes[0], doc.scenes[0].shots[0])), "6.0 s");
  assert.equal(s.sceneTicks(doc, doc.scenes[0]), sum);
});
test("the rates of Japanese, Chinese, Korean and other scripts; notes and transitions take no time; a line split among shots", () => {
  assert.equal(s.readingSeconds("こんにちは", "ja"), 5 / 6.5);
  assert.equal(s.readingSeconds("日本", "ja"), 4 / 6.5);
  assert.equal(s.readingSeconds("你好世界。", "zh-CN"), 4 / 4.5);
  assert.equal(s.readingSeconds("안녕하세요", "ko"), 5 / 6);
  assert.equal(s.readingSeconds("สวัสดี", "th"), 6 / 14);
  assert.equal(s.readingSeconds("**Bold** _words_ — here", "en"), 3 / 2.5);
  let doc = build(1, 0);
  const spoken = s.newLine(ids, "narration", Array.from({ length: 20 }, () => "w").join(" "));
  doc.scenes[0].beats[0].lines = [spoken, s.newLine(ids, "visual_note", "wide"), s.newLine(ids, "transition", "CUT TO:"), s.newLine(ids, "action", "Go.")];
  assert.equal(s.sceneTicks(doc, doc.scenes[0]), s.toEstimateTicks(8.3) + 120_000, "a short action line lasts at least 1 s");
  doc = run(run(doc, s.shotFromSelection([spoken.id])).document, s.shotFromSelection([spoken.id])).document;
  assert.equal(s.shotTicks(doc, doc.scenes[0], doc.scenes[0].shots[0]), s.toEstimateTicks(8.3 / 2));
  assert.equal(s.shotTicks(doc, doc.scenes[0], s.newShot(ids)), 120_000, "a shot lasts at least 1 s");
  doc = run(doc, s.updateScenes([doc.scenes[0].id], { durationOverride_ticks: 600_000 })).document;
  assert.equal(s.totalTicks(doc), 600_000);
});
test("Duration against the target: 134 s of a 120 s target is 12 % over, in the warning state", () => {
  const doc = build(1, 0);
  doc.meta.targetDuration_s = 120;
  doc.scenes[0].durationOverride_ticks = 134 * 120_000;
  const state = s.targetState(doc);
  assert.deepEqual([state.label, state.onTarget, state.tooltip], ["2:14 of 2:00 target", false, "12 % over target"]);
  doc.scenes[0].durationOverride_ticks = 130 * 120_000;
  assert.equal(s.targetState(doc).onTarget, true);
});
