import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import type { ScriptDocument } from "@jagentchill/protocol";
import { script as s } from "../src/index.ts";
import { decodeText, encodeShiftJis, exportDocx, exportPdf, importDocx, pdfPages, readDocxParagraphs } from "../src/script/files/index.ts";
import { seeded } from "./support/script.ts";

const ids = seeded(7);
const env = () => ({ ids, now_ms: 10 });
const run = <I>(doc: ScriptDocument, command: s.ScriptCommand<I>) => s.executeScript(doc, command, env(), { confirmApprovedEdit: true });
const blank = (): ScriptDocument => s.createScript({ ids, now_ms: 1, locale: "en" });
const fromFountain = (text: string): ScriptDocument => ({ ...blank(), ...withoutWarnings(s.parseFountain(text, { ids })) });
const withoutWarnings = ({ warnings: _warnings, ...content }: s.ParsedScript) => content;
const kinds = (doc: Pick<ScriptDocument, "scenes">) => doc.scenes.map((scene) => s.sceneLines(scene).map((line) => line.kind));
const fonts = (name: string) => new Uint8Array(readFileSync(new URL(`../../render/assets/fonts/${name}`, import.meta.url)));
const PDF_FONTS = { mono: fonts("NotoSansMono-Regular.ttf"), monoBold: fonts("NotoSansMono-Bold.ttf"), jp: fonts("NotoSansJP-Regular.otf") };
const back0 = (bytes: Uint8Array) => importDocx(bytes, "The Lamp.docx", { ids, language: "en" });
const throwsCode = (work: () => unknown, code: string, message?: string) => assert.throws(work, (error: unknown) => { assert.ok(error instanceof s.ScriptError, String(error)); assert.equal(error.code, code); if (message) assert.equal(error.message, message); return true; });

const SAMPLE = `Title: The Lamp
Author: Mai Tran
Language: en

# Act One

INT. KITCHEN - NIGHT

= Mai finds the lamp.

## Hook

= Stop the scroll.

[[SHOT 1.1: wide, high, pan, 3s — The kitchen at night]]

Mai walks in *slowly*.

MAI
(whispering)
Meet the new lamp.

NARRATOR (V.O.)
It changed everything.

SUPER: Three weeks earlier

[[A close look at the switch]]

[[SOUND: A soft click]]

CUT TO:

EXT. GARDEN - DAY

BAO ^
Is that it?

> FADE OUT.
`;

// Requirement: Plain-text mode with screenplay conventions
test("Heading recognised: INT. KITCHEN - NIGHT is a scene with setting INT, location KITCHEN and time of day NIGHT", () => {
  const doc = fromFountain("INT. KITCHEN - NIGHT\n\nShe waits.\n");
  assert.deepEqual(doc.scenes.map((scene) => scene.heading), [{ setting: "INT", locationText: "KITCHEN", timeOfDay: "NIGHT" }]);
  assert.deepEqual(s.parseHeading("I/E. CAR - DUSK"), { setting: "INT_EXT", locationText: "CAR", timeOfDay: "DUSK", forced: false });
  assert.deepEqual(s.parseHeading(".THE VOID"), { setting: "NONE", locationText: "THE VOID", timeOfDay: "", forced: true });
});
test("Narration convention: a cue NARRATOR (V.O.) followed by text is one narration line", () => {
  const doc = fromFountain("NARRATOR (V.O.)\nOnce upon a time.\n");
  const lines = s.sceneLines(doc.scenes[0]);
  assert.deepEqual(lines.map((line) => [line.kind, line.text, line.characterId]), [["narration", "Once upon a time.", undefined]]);
  const named = fromFountain("MAI (V.O.)\nI remember.\n");
  assert.deepEqual([s.sceneLines(named.scenes[0])[0].kind, s.speakerOf(named, s.sceneLines(named.scenes[0])[0])], ["narration", "MAI"]);
});
test("Unparseable text: each paragraph of prose becomes an action line and nothing is lost", () => {
  const prose = "The first paragraph of a story.\n\nA second one, with more words in it.\n\nAnd a third.";
  const doc = fromFountain(prose);
  assert.deepEqual(s.sceneLines(doc.scenes[0]).map((line) => [line.kind, line.text]), prose.split("\n\n").map((text) => ["action", text]));
});
test("every Fountain convention maps to the model", () => {
  const doc = fromFountain(SAMPLE);
  assert.equal(doc.title, "The Lamp"); assert.equal(doc.meta.author, "Mai Tran");
  assert.deepEqual(doc.acts.map((act) => act.title), ["Act One"]);
  assert.deepEqual(kinds(doc), [["action", "dialogue", "narration", "on_screen_text", "visual_note", "sound_note", "transition"], ["dialogue", "transition"]]);
  const [first, second] = doc.scenes;
  assert.deepEqual([first.summary, first.beats[0].label, first.beats[0].intent, first.actId], ["Mai finds the lamp.", "Hook", "Stop the scroll.", doc.acts[0].id]);
  const lines = s.sceneLines(first);
  assert.deepEqual([lines[1].parenthetical, lines[1].text, s.speakerOf(doc, lines[1])], ["whispering", "Meet the new lamp.", "MAI"]);
  assert.deepEqual([lines[3].text, lines[4].text, lines[5].text, lines[6].text], ["Three weeks earlier", "A close look at the switch", "A soft click", "CUT TO:"]);
  assert.deepEqual(first.shots.map((shot) => [shot.size, shot.angle, shot.movement, shot.description, shot.lineIds]), [["wide", "high", "pan", "The kitchen at night", [lines[0].id]]]);
  assert.deepEqual([s.sceneLines(second)[0].dual, s.sceneLines(second)[1].text], [true, "FADE OUT."]);
  assert.deepEqual(doc.entities.characters.map((entity) => entity.name), ["MAI", "BAO"]);
  assert.ok(s.validateScript(doc).ok);
});
test("Fountain is re-importable without loss of text and structure", () => {
  const doc = fromFountain(SAMPLE), text = s.serializeFountain(doc);
  const again = fromFountain(text);
  const shape = (value: ScriptDocument) => ({
    title: value.title, acts: value.acts.map((act) => act.title),
    scenes: value.scenes.map((scene) => ({ heading: scene.heading, summary: scene.summary, beats: scene.beats.map((beat) => ({ label: beat.label, intent: beat.intent, lines: beat.lines.map((line) => [line.kind, line.text, line.parenthetical, line.dual, s.speakerOf(value, line)]) })), shots: scene.shots.map((shot) => [shot.size, shot.angle, shot.movement, shot.description, shot.lineIds.length]) })),
  });
  assert.deepEqual(shape(again), shape(doc));
  assert.equal(s.serializeFountain(again), text);
});
test("Round trip keeps links: a dialogue line edited in plain-text mode changes only that line; shots, ids and links are intact", () => {
  let doc = fromFountain(SAMPLE);
  const dialogue = s.sceneLines(doc.scenes[0])[1];
  // Fields with no text form: a colour, a title, a source reference, a shot's references and override.
  doc = run(doc, s.updateScenes([doc.scenes[0].id], { colorIndex: 3, title: "Opening" })).document;
  doc = run(doc, s.updateShots([doc.scenes[0].shots[0].id], { durationOverride_ticks: 600_000, references: [{ kind: "url", url: "https://example.com/a.png", note: "mood" }], notes: "handheld feel" })).document;
  doc = run(doc, s.updateLine(dialogue.id, { needsCheck: true })).document;
  const text = s.serializeFountain(doc, { titlePage: true });
  const edited = text.replace("Meet the new lamp.", "Meet the brand-new lamp.");
  const { warnings: _warnings, ...content } = s.parseFountain(edited, { ids, previous: doc });
  const next = run(doc, s.replaceContent(content, "Edit text")).document;
  const ids1 = (value: ScriptDocument) => value.scenes.map((scene) => [scene.id, scene.beats.map((beat) => [beat.id, beat.lines.map((line) => line.id)]), scene.shots.map((shot) => shot.id)]);
  assert.deepEqual(ids1(next), ids1(doc));
  const changes = s.diffScripts(s.contentOf(doc), s.contentOf(next)).changes;
  assert.deepEqual(changes.map((change) => [change.kind, change.target, change.id]), [["modified", "line", dialogue.id]]);
  assert.deepEqual(next.scenes[0].shots, doc.scenes[0].shots);
  assert.deepEqual([next.scenes[0].colorIndex, next.scenes[0].title, s.findLine(next, dialogue.id)!.line.needsCheck], [3, "Opening", true]);
  assert.deepEqual(next.entities, doc.entities);
  // Switching with no edit is lossless.
  const same = s.parseFountain(text, { ids, previous: doc });
  assert.equal(run(doc, s.replaceContent(withoutWarnings(same))).changed, false);
});
test("plain-text mode keeps beats without labels, scenes without headings, omitted scenes and speakers held as text", () => {
  let doc = blank();
  doc.scenes = [s.newScene(ids), s.newScene(ids), s.newScene(ids, { omitted: true, heading: { setting: "EXT", locationText: "ROOF", timeOfDay: "" } })];
  doc.scenes[0].beats = [s.newBeat(ids, "", "", [s.newLine(ids, "action", "One.")]), s.newBeat(ids, "", "", [s.newLine(ids, "dialogue", "Two.", { speakerText: "Stranger" })])];
  doc.scenes[1].beats[0].lines = [s.newLine(ids, "action", "INT. NOT A HEADING, an action line"), s.newLine(ids, "action", "SHOUTED ACTION\nwith a second row")];
  doc.scenes[2].beats[0].lines = [s.newLine(ids, "action", "Cut content.")];
  const text = s.serializeFountain(doc, { titlePage: false });
  const content = withoutWarnings(s.parseFountain(text, { ids, previous: doc }));
  assert.equal(run(doc, s.replaceContent(content)).changed, false, text);
  assert.match(s.serializeFountain(doc, { forExport: true }), /\.OMITTED\n/);
  assert.equal(fromFountain(s.serializeFountain(doc, { forExport: true })).scenes[2].omitted, true);
});

// Requirement: Diff between versions
test("Modified line: new is deleted and brand-new inserted", () => {
  const doc = fromFountain("INT. A - DAY\n\nMeet the new lamp.\n"), line = s.sceneLines(doc.scenes[0])[0];
  const next = run(doc, s.updateLine(line.id, { text: "Meet the brand-new lamp." })).document;
  const diff = s.diffScripts(s.contentOf(doc), s.contentOf(next));
  assert.equal(diff.changes.length, 1);
  assert.deepEqual([diff.changes[0].kind, diff.changes[0].target, diff.changes[0].id], ["modified", "line", line.id]);
  assert.deepEqual(diff.changes[0].textDiff, [{ op: "equal", text: "Meet the " }, { op: "delete", text: "new" }, { op: "insert", text: "brand-new" }, { op: "equal", text: " lamp." }]);
  assert.deepEqual([diff.totals.modified, diff.totals.wordsAdded, diff.totals.wordsRemoved], [1, 1, 1]);
});
test("Moved scene: moving scene 5 to position 2 without editing it is exactly one moved change", () => {
  const doc = blank();
  doc.scenes = Array.from({ length: 6 }, (_, index) => s.newScene(ids, { beats: [s.newBeat(ids, "", "", [s.newLine(ids, "action", `Scene ${index + 1}`)])] }));
  const next = run(doc, s.moveScene(doc.scenes[4].id, 1)).document;
  const diff = s.diffScripts(s.contentOf(doc), s.contentOf(next));
  assert.deepEqual(diff.changes.map((change) => [change.kind, change.target, change.id, change.before, change.after]), [["moved", "scene", doc.scenes[4].id, 5, 2]]);
});
test("Dependency: an added shot lists the added line it covers in dependsOn", () => {
  let doc = fromFountain("INT. A - DAY\n\nOne.\n");
  const base = doc;
  const line = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id, text: "Two." })); doc = line.document;
  doc = run(doc, s.shotFromSelection([line.info.lineId])).document;
  const diff = s.diffScripts(s.contentOf(base), s.contentOf(doc));
  const added = diff.changes.find((change) => change.target === "line")!, shot = diff.changes.find((change) => change.target === "shot")!;
  assert.deepEqual([added.kind, shot.kind, shot.dependsOn], ["added", "added", [added.changeId]]);
});
test("Compare with current: 3 changed lines and an added scene are 4 changes", () => {
  let doc = fromFountain("INT. A - DAY\n\nOne.\n\nTwo.\n\nThree.\n");
  const base = doc;
  for (const line of s.sceneLines(doc.scenes[0])) doc = run(doc, s.updateLine(line.id, { text: `${line.text} More.` })).document;
  doc = run(doc, s.addScene()).document;
  const diff = s.diffScripts(s.contentOf(base), s.contentOf(doc));
  assert.deepEqual(diff.changes.map((change) => `${change.kind} ${change.target}`), ["modified line", "modified line", "modified line", "added scene"]);
  assert.deepEqual(diff.changes.map(s.changeGroup), ["text", "text", "text", "structure"]);
});
test("content without matching ids is matched by text similarity of 0.6 and above within the same scene; Japanese text is compared by grapheme", () => {
  const before = fromFountain("INT. A - DAY\n\nThe quick brown fox jumps over the dog.\n\nSomething else entirely.\n");
  const after = { ...before, scenes: [{ ...before.scenes[0], beats: [{ ...before.scenes[0].beats[0], lines: [s.newLine(ids, "action", "The quick brown fox leaps over the dog."), s.newLine(ids, "action", "Nothing like it.")] }] }] };
  const diff = s.diffScripts(s.contentOf(before), s.contentOf(after));
  assert.deepEqual(diff.changes.map((change) => change.kind).sort(), ["added", "modified", "removed"]);
  assert.ok(s.similarity("The quick brown fox", "the quick  brown FOX") === 1);
  assert.deepEqual(s.textDiff("今日は晴れです", "今日は雨です"), [{ op: "equal", text: "今日は" }, { op: "delete", text: "晴れ" }, { op: "insert", text: "雨" }, { op: "equal", text: "です" }]);
});
test("a diff of two versions of a 500-scene script completes within 1 s", () => {
  const doc = blank();
  doc.scenes = Array.from({ length: 500 }, (_, index) => s.newScene(ids, { beats: [s.newBeat(ids, "", "", Array.from({ length: 6 }, (_, line) => s.newLine(ids, "action", `Scene ${index} line ${line} with some words to compare here.`)))] }));
  const next = s.clone(doc);
  for (let index = 0; index < 500; index += 5) next.scenes[index].beats[0].lines[2].text += " Changed a little.";
  const started = performance.now(), diff = s.diffScripts(s.contentOf(doc), s.contentOf(next));
  assert.equal(diff.changes.length, 100);
  assert.ok(performance.now() - started < 1000, `${performance.now() - started} ms`);
});

// Requirement: Import
test("Fountain import: the preview shows the title and the scene count, and the script matches the file", () => {
  const scenes = Array.from({ length: 12 }, (_, index) => `INT. ROOM ${index + 1} - DAY\n\nMAI\nLine ${index + 1}.\n\nCUT TO:`).join("\n\n");
  const result = s.importText(`Title: Twelve Rooms\n\n${scenes}\n`, "twelve.fountain", { ids, language: "en" });
  assert.deepEqual([result.preview.title, result.preview.scenes, result.needsSplit, result.format], ["Twelve Rooms", 12, false, "fountain"]);
  assert.equal(result.preview.firstScenes.length, 3);
  assert.deepEqual(kinds(result.content), Array.from({ length: 12 }, () => ["dialogue", "transition"]));
  assert.ok(result.content.scenes.every((scene, index) => scene.heading.locationText === `ROOM ${index + 1}`));
});
test("Prose text: a .txt file without scene headings offers the three splitting choices and applies the chosen one", () => {
  const text = "# Part one\n\nFirst paragraph.\n\nSecond paragraph.\n\n\n\n# Part two\n\nThird paragraph.\n";
  const one = s.importText(text, "notes.txt", { ids, language: "en" });
  assert.deepEqual([one.needsSplit, one.preview.scenes, one.content.title], [true, 1, "Part one"]);
  const groups = s.importText(text, "notes.txt", { ids, language: "en", split: "blank-lines" });
  assert.deepEqual(groups.content.scenes.map((scene) => s.sceneLines(scene).length), [3, 2]);
  const headings = s.importText(text, "notes.md", { ids, language: "en", split: "headings" });
  assert.deepEqual(headings.content.scenes.map((scene) => [scene.title, s.sceneLines(scene).map((line) => line.text)]), [["Part one", ["First paragraph.", "Second paragraph."]], ["Part two", ["Third paragraph."]]]);
  assert.equal(s.importText("Just prose.", "my_story-draft.txt", { ids, language: "en" }).content.title, "my story draft");
});
test("Legacy Word file: a .doc file is rejected with the message to save it as .docx", () => {
  throwsCode(() => s.assertImportable("old.doc", 10), "SCRIPT_IMPORT_UNSUPPORTED", "Save the file as .docx and import again");
  throwsCode(() => importDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "renamed.docx", { ids, language: "en" }), "SCRIPT_IMPORT_UNSUPPORTED", "Save the file as .docx and import again");
  throwsCode(() => s.assertImportable("movie.mp4", 10), "SCRIPT_IMPORT_UNSUPPORTED");
  throwsCode(() => s.assertImportable("big.txt", 21 * 1024 * 1024), "SCRIPT_IMPORT_UNSUPPORTED");
  assert.equal(s.assertImportable("a.FOUNTAIN", 10), "fountain");
});
test("Import too large: 700,000 characters are rejected as a whole", () => {
  throwsCode(() => s.importText("x".repeat(700_000), "big.txt", { ids, language: "en" }), "SCRIPT_LIMIT_EXCEEDED", "This file has 700,000 characters; the limit is 600,000");
  const scenes = Array.from({ length: 501 }, (_, index) => `INT. ROOM ${index} - DAY\n\nx`).join("\n\n");
  throwsCode(() => s.importText(scenes, "many.fountain", { ids, language: "en" }), "SCRIPT_LIMIT_EXCEEDED", "A script can have at most 500 scenes");
});
test("Import into an open script: the content is replaced in one undo step", () => {
  const doc = fromFountain("INT. OLD - DAY\n\nOld line.\n"), history = s.createScriptHistory();
  const { warnings: _warnings, ...content } = s.importText("INT. NEW - NIGHT\n\nNew line.\n", "new.fountain", { ids, language: "en" }).content;
  const result = run({ ...doc, status: "approved" }, s.replaceContent(content, "Import"));
  history.record(doc, result, 1);
  assert.deepEqual([result.document.scenes[0].heading.locationText, result.document.status], ["NEW", "draft"]);
  assert.equal(history.undo(result.document, 2)!.document.scenes[0].heading.locationText, "OLD");
});
test("encodings: UTF-8, UTF-16 by byte-order mark and Shift_JIS are decoded; anything else is rejected", () => {
  const text = "INT. 台所 - 夜\n\nこんにちは、Mai。";
  assert.equal(decodeText(new TextEncoder().encode(text)), text);
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])), text);
  const utf16 = new Uint8Array(2 + text.length * 2); utf16[0] = 0xff; utf16[1] = 0xfe;
  for (let index = 0; index < text.length; index++) { utf16[2 + index * 2] = text.charCodeAt(index) & 255; utf16[3 + index * 2] = text.charCodeAt(index) >> 8; }
  assert.equal(decodeText(utf16), text);
  assert.equal(decodeText(encodeShiftJis(text)), text);
  throwsCode(() => decodeText(new Uint8Array([0xff, 0xff, 0xff, 0x80, 0x80, 0xfd, 0xfe, 0xa0, 0xff])), "SCRIPT_IMPORT_UNSUPPORTED");
});
test("the native file keeps every id and is refused when it is not a script", () => {
  let doc = fromFountain(SAMPLE);
  doc = run(doc, s.autoShots()).document;
  const saved = s.saveVersion(doc, s.emptyHistory(), { ids, now_ms: 5, author: { kind: "user" }, summary: "Created" });
  const text = s.exportNative(saved.document, saved.history, { versions: "all", activity: true });
  const result = s.importNative(text);
  assert.deepEqual(result.file!.script, saved.document);
  assert.deepEqual(result.file!.history!.versions, saved.history.versions);
  assert.equal(JSON.parse(s.exportNative(saved.document, saved.history)).history, undefined);
  throwsCode(() => s.importNative("{not json"), "SCRIPT_IMPORT_INVALID");
  throwsCode(() => s.importNative(JSON.stringify({ format: "jagentchill.script.file", version: 1, script: { ...doc, title: "" } })), "SCRIPT_IMPORT_INVALID");
});

// Requirement: Export
function shotScript(count: number): ScriptDocument {
  const doc = blank();
  doc.meta.language = "vi";
  doc.scenes = Array.from({ length: 3 }, (_, sceneIndex) => {
    const lines = Array.from({ length: count / 3 }, (_, index) => s.newLine(ids, "narration", index % 2 ? `Xin chào, đây là cảnh ${sceneIndex + 1}, "dòng" ${index + 1}` : `こんにちは、シーン${sceneIndex + 1}`));
    return s.newScene(ids, { beats: [s.newBeat(ids, "", "", lines)], shots: lines.map((line, index) => s.newShot(ids, { lineIds: [line.id], description: line.text, notes: index === 0 ? "a,b\n\"c\"" : "" })) });
  });
  return doc;
}
test("CSV shot list: a header row and 24 rows of 16 columns, Vietnamese and Japanese intact, re-imported by shot_id", () => {
  const doc = shotScript(24), csv = s.exportShotCsv(doc);
  assert.equal(csv.charCodeAt(0), 0xfeff, "UTF-8 with a byte-order mark");
  const rows = s.parseCsv(csv);
  assert.equal(rows.length, 25);
  assert.deepEqual(rows[0], [...s.SHOT_CSV_COLUMNS]);
  assert.ok(rows.every((row) => row.length === 16));
  assert.equal(rows[1][3], "こんにちは、シーン1"); assert.equal(rows[2][3], 'Xin chào, đây là cảnh 1, "dòng" 2'); assert.equal(rows[1][15], 'a,b\n"c"');
  assert.match(csv, /\r\n/);
  // Edited in a spreadsheet, then imported: every row matches its shot.
  const edited = [rows[0], ...rows.slice(1).map((row) => [...row.slice(0, 4), "close-up", ...row.slice(5)])];
  const result = run(doc, s.importShotCsv(s.toCsv(edited)));
  assert.deepEqual(result.info, { updated: 24, added: 0, skipped: 0 });
  assert.ok(result.document.scenes.every((scene) => scene.shots.every((shot) => shot.size === "close-up")));
  assert.deepEqual(result.document.scenes.map((scene) => scene.shots.map((shot) => [shot.id, shot.lineIds, shot.durationOverride_ticks])), doc.scenes.map((scene) => scene.shots.map((shot) => [shot.id, shot.lineIds, undefined])));
  const added = run(doc, s.importShotCsv("shot_id,scene,description,duration_s,characters\n,2,A new shot,4,Mai; Bao\n,9,Nowhere,1,\n"));
  assert.deepEqual(added.info, { updated: 0, added: 1, skipped: 1 });
  const shot = added.document.scenes[1].shots.at(-1)!;
  assert.deepEqual([shot.description, shot.durationOverride_ticks, shot.characterIds.length], ["A new shot", 480_000, 2]);
  throwsCode(() => s.importShotCsv("a,b\n1,2\n"), "SCRIPT_IMPORT_INVALID");
});
test("plain text is a screenplay layout with spaces", () => {
  const text = s.screenplayText(fromFountain(SAMPLE), { paper: "letter", shots: true, notes: true, sceneNumbers: true });
  assert.match(text, /^ACT ONE\n\n\n1\. INT\. KITCHEN - NIGHT\n\nSHOT 1\.1 — wide, high, pan, 1\.6 s — The kitchen at night\n\nMai walks in \*slowly\*\.\n\n {22}MAI\n {16}\(whispering\)\n {10}Meet the new lamp\.\n\n {22}NARRATOR \(V\.O\.\)\n {10}It changed everything\.\n\nSUPER: Three weeks earlier\n\n\[A close look at the switch\]\n\n\[SOUND: A soft click\]\n\n {53}CUT TO:\n/);
  assert.ok(text.split("\n").every((line) => line.length <= 60));
  assert.equal(s.exportFileName('The: "Lamp"/ad?', 3, "pdf"), "The Lamp ad-v3.pdf");
});
test("PDF layout: a dialogue block that crosses a page ends with (MORE) and the next page repeats the cue with (CONT'D)", () => {
  const doc = blank();
  const speech = Array.from({ length: 220 }, (_, index) => `word${index}`).join(" ");
  doc.scenes[0].heading = { setting: "INT", locationText: "HALL", timeOfDay: "DAY" };
  doc.scenes[0].beats[0].lines = [...Array.from({ length: 20 }, (_, index) => s.newLine(ids, "action", `Action ${index}.`)), s.newLine(ids, "dialogue", speech, { speakerText: "Mai" })];
  const pages = pdfPages(doc, { paper: "letter" });
  assert.ok(pages.length >= 2);
  const first = pages[0].filter((row) => row.kind !== "blank"), second = pages[1];
  assert.deepEqual([first.at(-1)!.text, first.at(-1)!.indent], ["(MORE)", 22]);
  assert.deepEqual([second[0].text, second[0].indent], ["MAI (CONT'D)", 22]);
  assert.ok(pages.every((page) => page.length <= s.pageMetrics("letter").lines));
  assert.equal(pages.flat().filter((row) => row.kind === "dialogue").map((row) => row.text).join(" "), speech, "no word is lost at the break");
  assert.deepEqual([s.pageMetrics("letter"), s.pageMetrics("a4")], [{ columns: 60, lines: 54 }, { columns: 57, lines: 58 }]);
  assert.deepEqual([s.defaultPaper("en-US"), s.defaultPaper("fr-CA"), s.defaultPaper("vi-VN"), s.defaultPaper("ja")], ["letter", "letter", "a4", "a4"]);
});
test("scene headings are never orphaned at a page end", () => {
  const doc = blank();
  doc.scenes = [s.newScene(ids, { heading: { setting: "INT", locationText: "A", timeOfDay: "" } }), s.newScene(ids, { heading: { setting: "INT", locationText: "B", timeOfDay: "" } })];
  // Scene A fills the page so that scene B's heading would be its last row.
  doc.scenes[0].beats[0].lines = Array.from({ length: 25 }, (_, index) => s.newLine(ids, "action", `Row ${index}`));
  doc.scenes[1].beats[0].lines = [s.newLine(ids, "action", "After the heading.")];
  const pages = pdfPages(doc, { paper: "letter" });
  assert.equal(pages.length, 2);
  assert.equal(pages[1][0].text, "INT. B");
  assert.ok(!pages[0].some((row) => row.text === "INT. B"));
});
test("Same PDF on every platform: a Vietnamese–Japanese script embeds only Noto Sans Mono and Noto Sans JP and reads back intact", async () => {
  const doc = shotScript(24);
  doc.title = "Đèn mới";
  const result = await exportPdf(doc, { paper: "a4", fonts: PDF_FONTS, titlePage: true, shots: false });
  const again = await exportPdf(doc, { paper: "a4", fonts: PDF_FONTS, titlePage: true, shots: false });
  assert.deepEqual([again.pages, again.breaks], [result.pages, result.breaks], "the same input gives the same pages and breaks");
  const dir = mkdtempSync(join(tmpdir(), "jc-script-")), file = join(dir, "script.pdf");
  writeFileSync(file, result.bytes);
  const faces = execFileSync("pdffonts", [file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").slice(2).filter(Boolean);
  assert.ok(faces.length >= 2 && faces.every((face) => /NotoSansMono|NotoSansJP/.test(face) && /Identity-H +yes /.test(face)), faces.join("\n"));
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.match(text, /ĐÈN MỚI/);
  assert.match(text, /Xin chào, đây là cảnh 1, "dòng" 2/);
  assert.match(text.replace(/ /g, ""), /こんにちは、シーン1/);
  assert.match(text, /NARRATOR \(V\.O\.\)/);
  assert.equal(execFileSync("pdfinfo", [file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/Pages:\s+(\d+)/)![1], String(result.pages));
});
test("Script with characters outside the PDF fonts: no PDF is written for Korean text, and the .docx holds it unchanged", async () => {
  const doc = fromFountain("INT. 방 - 밤\n\n안녕하세요, 새 램프입니다.\n");
  await assert.rejects(() => exportPdf(doc, { fonts: PDF_FONTS }), (error: unknown) => {
    assert.ok(error instanceof s.ScriptError);
    assert.deepEqual([error.code, error.details.scripts, error.message], ["SCRIPT_EXPORT_UNSUPPORTED", ["Hangul"], "PDF export does not support Hangul — export Word (.docx), Fountain or plain text instead"]);
    return true;
  });
  const docx = await exportDocx(doc);
  assert.match(strFromU8(unzipSync(docx)["word/document.xml"]), /안녕하세요, 새 램프입니다\./);
  await assert.rejects(() => exportPdf(fromFountain("สวัสดี שלום\n"), { fonts: PDF_FONTS }), (error: unknown) => error instanceof s.ScriptError && JSON.stringify(error.details.scripts) === '["Hebrew","Thai"]');
});
test("a PDF of 120 pages is produced within 10 s", async () => {
  const doc = blank();
  doc.scenes = Array.from({ length: 120 }, (_, index) => s.newScene(ids, { heading: { setting: "INT", locationText: `ROOM ${index}`, timeOfDay: "DAY" }, beats: [s.newBeat(ids, "", "", Array.from({ length: 16 }, (_, line) => s.newLine(ids, line % 2 ? "dialogue" : "action", `This is line ${line} of scene ${index}, long enough to wrap onto a second row of the page.`, line % 2 ? { speakerText: "Mai" } : {})))] }));
  const started = performance.now(), result = await exportPdf(doc, { paper: "a4", fonts: PDF_FONTS });
  assert.ok(result.pages >= 120, String(result.pages));
  assert.ok(performance.now() - started < 10_000, `${performance.now() - started} ms`);
});
test("Word: the paragraph styles are written and a .docx is imported back to the same script", async () => {
  const doc = fromFountain(SAMPLE);
  const bytes = await exportDocx(doc, { shots: true, notes: true });
  const files = unzipSync(bytes), xml = strFromU8(files["word/document.xml"]), styles = strFromU8(files["word/styles.xml"]);
  for (const name of ["Scene Heading", "Action", "Character", "Parenthetical", "Dialogue", "Transition", "Shot", "Note"]) assert.match(styles, new RegExp(`w:name w:val="${name}"`));
  for (const id of ["SceneHeading", "Action", "Character", "Parenthetical", "Dialogue", "Transition", "Shot", "Note"]) assert.match(xml, new RegExp(`w:pStyle w:val="${id}"`));
  assert.deepEqual(readDocxParagraphs(bytes).slice(0, 4).map((entry) => [entry.style, entry.text]), [["title", "**The Lamp**"], ["heading1", "ACT ONE"], ["sceneheading", "INT. KITCHEN - NIGHT"], ["shot", "SHOT 1.1 — wide, high, pan, 1.6 s — The kitchen at night"]]);
  assert.deepEqual(back0(bytes).content.acts.map((act) => act.title), ["ACT ONE"]);
  const back = importDocx(bytes, "The Lamp.docx", { ids, language: "en" });
  assert.equal(back.content.title, "The Lamp");
  assert.deepEqual(kinds(back.content), [["action", "dialogue", "narration", "on_screen_text", "visual_note", "sound_note", "transition"], ["dialogue", "transition"]]);
  const lines = s.sceneLines(back.content.scenes[0]);
  assert.deepEqual([lines[0].text, lines[1].text, lines[1].parenthetical, s.speakerOf(back.content, lines[1]), lines[2].text], ["Mai walks in *slowly*.", "Meet the new lamp.", "whispering", "MAI", "It changed everything."]);
  assert.deepEqual(back.content.scenes[0].shots.map((shot) => [shot.size, shot.angle, shot.movement, shot.description]), [["wide", "high", "pan", "The kitchen at night"]]);
  throwsCode(() => importDocx(new Uint8Array([1, 2, 3]), "broken.docx", { ids, language: "en" }), "SCRIPT_IMPORT_INVALID");
});
test("Two-column layout: each scene of a .docx is a table with shots and visual notes left and narration, dialogue and sound notes right", async () => {
  const doc = fromFountain(SAMPLE);
  const xml = strFromU8(unzipSync(await exportDocx(doc, { twoColumn: true, shots: true, notes: true }))["word/document.xml"]);
  const tables = xml.split("<w:tbl>").slice(1).map((part) => part.split("</w:tbl>")[0]);
  assert.equal(tables.length, 2);
  const [left, right] = tables[0].split("<w:tc>").slice(1);
  assert.match(left, /SHOT 1\.1/); assert.match(left, /A close look at the switch/); assert.doesNotMatch(left, /Meet the new lamp/);
  assert.match(right, /Meet the new lamp/); assert.match(right, /It changed everything/); assert.match(right, /SOUND: A soft click/); assert.doesNotMatch(right, /SHOT 1\.1/);
});
test("a right-to-left paragraph of a .docx is marked bidirectional", async () => {
  const xml = strFromU8(unzipSync(await exportDocx(fromFountain("שלום עולם\n\nHello world\n")))["word/document.xml"]);
  assert.equal(xml.split("<w:bidi/>").length - 1, 1);
});
test("Export the approved version: the file holds the approved version's content and its header states the version and the approval date", () => {
  let doc = fromFountain("INT. A - DAY\n\nApproved text.\n");
  let history = s.emptyHistory();
  const context = { ids, now_ms: Date.UTC(2026, 9, 6), actor: { kind: "device" as const, id: "d1", name: "Laptop" } };
  ({ document: doc, history } = s.review({ document: doc, history }, { type: "submit" }, context));
  ({ document: doc, history } = s.review({ document: doc, history }, { type: "approve" }, context));
  doc = run(doc, s.updateLine(s.sceneLines(doc.scenes[0])[0].id, { text: "Draft text." })).document;
  assert.equal(doc.status, "draft");
  const source = s.exportSource(doc, history, "approved");
  assert.equal(source.number, 1);
  const text = s.exportTextFormat("txt", source.document, history, { header: `Version ${source.number} — approved 2026-10-06` });
  assert.match(text, /^Version 1 — approved 2026-10-06\n/);
  assert.match(text, /Approved text\./); assert.doesNotMatch(text, /Draft text/);
  assert.match(s.exportTextFormat("txt", s.exportSource(doc, history, "head").document, history), /Draft text\./);
  throwsCode(() => s.exportSource(fromFountain("x"), s.emptyHistory(), "approved"), "SCRIPT_NOT_APPROVED");
});
