import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addCaptionAt, applyCaptionStyle, CAPTION_STYLES, captionCues, captionFileName, captionTracksOf, decodeSubtitle, distributeWords, importCaptions, importSummary, mergeCaptionWithPrevious, parseAss, parseSrt, parseSubtitles, parseVtt,
  setCaptionText, setCaptionTiming, setCaptionTrack, splitCaption, SubtitleError, TEXT_REGISTRIES, validateProjectDocument, writeSrt, writeTxt, writeVtt,
} from "../src/index.ts";
import { context as baseContext, REGISTRIES } from "./support/fixtures.ts";
import { el, ON, open as openSession, project, S } from "./support/timeline.ts";

const registries = { ...REGISTRIES, ...TEXT_REGISTRIES };
const context = () => baseContext({ registries });
const open = () => openSession(project(), { registries });
const valid = (doc: Parameters<typeof validateProjectDocument>[0]) => validateProjectDocument(doc, { mode: "strict", registries });
const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHi\n\n2\n00:00:03.000 --> 00:00:04.000\nBye\n\n00:00:05,000 --> 00:00:06,200\nLine one\nLine two\n";
const imported = (text = SRT, name = "a.srt", offset_ms = 0) => {
  const session = open();
  const result = session.execute(importCaptions({ sceneId: "s1", parsed: parseSubtitles(name, text), language: "en", offset_ms }), ON);
  assert.ok(result.ok, result.ok ? "" : result.message);
  const [track] = captionTracksOf(session.document, "s1") as any[];
  return { session, track: () => (captionTracksOf(session.document, "s1") as any[])[0], ids: track.elements.map((entry: any) => entry.id) as string[] };
};
const adopt = (session: ReturnType<typeof open>, make: (doc: any, ctx: any) => any) => assert.ok(session.adoptCommit(make(session.document, context()), session.document).ok);

// Requirement: Captions panel
test("Captions panel — Scenario: Empty project", () => { assert.deepEqual(captionTracksOf(project(), "s1"), []); });

// Requirement: Import SRT
test("Import SRT — Scenario: Valid file", () => {
  const parsed = parseSrt(SRT);
  assert.deepEqual(parsed.cues.map((cue) => [cue.start_ms, cue.end_ms, cue.text]), [[1000, 2500, "Hi"], [3000, 4000, "Bye"], [5000, 6200, "Line one\nLine two"]]);
  const { track, session } = imported();
  assert.deepEqual(track().elements.map((entry: any) => [entry.startTime, entry.duration, entry.text]), [[1 * S, 1.5 * S, "Hi"], [3 * S, 1 * S, "Bye"], [5 * S, 1.2 * S, "Line one\nLine two"]]);
  assert.deepEqual([track().caption.language, track().caption.styleId, track().caption.style.fontWeight, track().caption.style.stroke.enabled], ["en", "classic", 700, true]);
  assert.deepEqual(valid(session.document).errors, []);
});
test("Import SRT — Scenario: Skipped cues", () => {
  const cue = (index: number, bad: boolean) => `${index}\n00:00:${String(index * 2).padStart(2, "0")},000 --> 00:00:${String(index * 2 + (bad ? -1 : 1)).padStart(2, "0")},000\nCue ${index}\n`;
  const parsed = parseSrt(Array.from({ length: 10 }, (_, index) => cue(index + 1, index === 3 || index === 7)).join("\n"));
  assert.deepEqual([parsed.cues.length, parsed.skipped, importSummary(parsed)], [8, 2, "8 captions imported, 2 skipped"]);
});
test("Import SRT — Scenario: Markup", () => {
  assert.equal(parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <font color="red">world</font>\n').cues[0].text, "Hello world");
  const whole = parseSrt("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>All of it</i>\n").cues[0];
  assert.deepEqual([whole.text, whole.style], ["All of it", { fontStyle: "italic" }]);
  // A cue that overlaps the next one ends where the next one starts.
  const overlapping = parseSrt("1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:03,000 --> 00:00:06,000\nB\n");
  assert.deepEqual([overlapping.cues[0].end_ms, overlapping.trimmed], [3000, 1]);
});

// Requirement: Import WebVTT
test("Import WebVTT — Scenario: Word timestamps", () => {
  const parsed = parseVtt("WEBVTT\n\nNOTE a comment\n\nintro\n00:00:01.000 --> 00:00:03.000 line:10% align:start position:20%\n<v Mai>Hello <00:00:01.500>world\n\n01:05.000 --> 01:06.000\nLater\n");
  const [cue, later] = parsed.cues;
  assert.deepEqual(cue.words, [{ text: "Hello", start_ms: 0, end_ms: 500 }, { text: "world", start_ms: 500, end_ms: 2000 }]);
  assert.deepEqual([cue.text, cue.speaker, cue.anchor, cue.style, later.start_ms, parsed.warnings], ["Hello world", "Mai", "top", { textAlign: "left" }, 65_000, ['cue setting "position" ignored']]);
});
test("Import WebVTT — Scenario: Missing signature", () => {
  assert.throws(() => parseSubtitles("a.vtt", "00:00:01.000 --> 00:00:02.000\nHi\n"), (error: unknown) => error instanceof SubtitleError && error.message === "Not a valid WebVTT file");
});

// Requirement: Import ASS
const ASS = (events: string, style = "Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1") => `[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
test("Import ASS — Scenario: Style mapping", () => {
  const parsed = parseAss(ASS("Dialogue: 0,0:00:01.00,0:00:02.50,Default,Mai,0,0,0,,Hello, there"));
  assert.deepEqual([parsed.trackStyle!.fontSize, parsed.trackStyle!.fontWeight, parsed.trackStyle!.textAlign, parsed.layout!.anchor], [4.5, 700, "center", "top"]);
  assert.deepEqual([parsed.cues[0].start_ms, parsed.cues[0].end_ms, parsed.cues[0].text, parsed.cues[0].speaker], [1000, 2500, "Hello, there", "Mai"]);
  const { track } = imported(ASS("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello"), "a.ass");
  // 4.5 × 1080 / 90 = 54 px.
  assert.deepEqual([track().caption.style.fontSize, track().caption.style.fontWeight, track().caption.layout.anchor], [4.5, 700, "top"]);
});
test("Import ASS — Scenario: Override tags stripped", () => {
  const parsed = parseAss(ASS("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(100,200)\\b1}Hi\\Nthere"));
  assert.equal(parsed.cues[0].text, "Hi\nthere");
  assert.ok(parsed.warnings.includes("override tags ignored"));
});
test("Import ASS — Scenario: Missing style", () => {
  const parsed = parseAss(ASS("Dialogue: 0,0:00:01.00,0:00:02.00,Ghost,,0,0,0,,Hi"));
  assert.deepEqual([parsed.cues.length, parsed.cues[0].style, parsed.trackStyle], [1, undefined, undefined]);
  assert.ok(parsed.warnings.includes('style "Ghost" is missing'));
});

// Requirement: Subtitle import flow and errors
test("Subtitle import flow and errors — Scenario: Offset", () => {
  const { track } = imported(SRT, "a.srt", 2000);
  assert.deepEqual(track().elements.map((entry: any) => entry.startTime), [3 * S, 5 * S, 7 * S]);
});
test("Subtitle import flow and errors — Scenario: Oversized file", () => {
  assert.throws(() => decodeSubtitle(new Uint8Array(25 * 1024 * 1024)), (error: unknown) => error instanceof SubtitleError && error.message === "Subtitle files can be up to 10 MB");
  assert.deepEqual(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])), { text: "Hi", uncertain: false });
  assert.equal(decodeSubtitle(new Uint8Array([0x48, 0xe9])).uncertain, true);
});
test("Subtitle import flow and errors — Scenario: Unsupported extension", () => {
  assert.throws(() => parseSubtitles("notes.docx", "x"), (error: unknown) => error instanceof SubtitleError && /SRT, VTT, ASS or SSA/.test(error.message));
  assert.throws(() => parseSubtitles("empty.srt", "nothing here"), (error: unknown) => error instanceof SubtitleError && error.message === "No captions found in this file");
});

// Requirement: Edit caption text and timing
test("Edit caption text and timing — Scenario: Split at caret", () => {
  const { session, track, ids } = imported("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello <00:00:02.000>world\n", "a.vtt");
  adopt(session, (doc, ctx) => splitCaption(doc, ctx, ids[0], "hello ".length));
  // The boundary is the start of the word "world": 1 s into the caption.
  assert.deepEqual(track().elements.map((entry: any) => [entry.text, entry.startTime, entry.duration]), [["hello", 1 * S, 1 * S], ["world", 2 * S, 1 * S]]);
  assert.deepEqual(valid(session.document).errors, []);
  session.undo();
  assert.equal(track().elements.length, 1);
});
test("Edit caption text and timing — Scenario: Merge", () => {
  const { session, track, ids } = imported();
  adopt(session, (doc, ctx) => mergeCaptionWithPrevious(doc, ctx, ids[1]));
  assert.deepEqual(track().elements.map((entry: any) => [entry.text, entry.startTime, entry.duration]).slice(0, 1), [["Hi Bye", 1 * S, 3 * S]]);
  assert.equal(track().elements.length, 2);
});
test("Edit caption text and timing — Scenario: Timing clamp", () => {
  const { session, ids } = imported();
  adopt(session, (doc, ctx) => setCaptionTiming(doc, ctx, ids[0], { end: 3.7 * S }));
  assert.equal(el(session.document, ids[0]).startTime + el(session.document, ids[0]).duration, 3 * S);
  adopt(session, (doc, ctx) => setCaptionTiming(doc, ctx, ids[1], { start: 1 * S }));
  assert.equal(el(session.document, ids[1]).startTime, 3 * S);
  adopt(session, (doc, ctx) => setCaptionText(doc, ctx, ids[0], "Hello there"));
  assert.deepEqual([el(session.document, ids[0]).text, el(session.document, ids[0]).edited], ["Hello there", true]);
});
test("Edit caption text and timing — Scenario: Add caption with no track", () => {
  const session = open();
  assert.ok(session.execute(addCaptionAt({ sceneId: "s1", time: 3 * S }), ON).ok);
  const [track] = captionTracksOf(session.document, "s1") as any[];
  assert.deepEqual(track.elements.map((entry: any) => [entry.text, entry.startTime, entry.duration]), [["", 3 * S, 2 * S]]);
  // A second one a second later has only the gap up to... nothing after it, so 2 s again; inside the first it is refused.
  assert.equal(session.execute(addCaptionAt({ sceneId: "s1", time: 4 * S }), ON).ok, false);
  session.execute(addCaptionAt({ sceneId: "s1", time: 2 * S }), ON);
  assert.equal((captionTracksOf(session.document, "s1") as any[])[0].elements[0].duration, 1 * S);
  session.undo(); session.undo();
  assert.equal(captionTracksOf(session.document, "s1").length, 0);
});

// Requirement: Caption style templates
const catalogue = readFileSync(new URL("../../../openspec/changes/build-jagentchill/specs/captions-subtitles/catalog.md", import.meta.url), "utf8").replace(/−/g, "-");
test("Caption style templates — Scenario: Exactly 24 offline", () => {
  const rows = catalogue.split("\n").filter((line) => /^\| \d+ \|/.test(line)).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/`/g, "")));
  assert.equal(CAPTION_STYLES.length, 24);
  const cell = (value: object | undefined) => (value ? Object.values(value).join(" ") : "—");
  rows.forEach((row, index) => {
    const style = CAPTION_STYLES[index];
    const font = `${style.fontFamily} ${style.fontWeight}${style.fontStyle === "italic" ? " italic" : ""}${style.textCase === "upper" ? ", upper" : ""}`;
    assert.deepEqual([style.id, style.name, font, String(style.fontSize), style.color, cell(style.stroke), cell(style.shadow), cell(style.glow), cell(style.background), `${style.layout.anchor} / ${style.layout.marginY} / ${style.layout.maxWidth}`], row.slice(1, 11), row[1]);
    assert.ok(row[11].startsWith(style.highlight.style), `${style.id} highlight`);
    assert.equal(style.animation ? Object.values(style.animation).map((slot) => `${slot[0]} ${slot[1]}`).join(", ") : "—", row[12], `${style.id} animation`);
  });
});
test("Caption style templates — Scenario: Apply a style", () => {
  const { session, track, ids } = imported();
  adopt(session, (doc, ctx) => applyCaptionStyle(doc, ctx, track().id, "boxed"));
  const caption = track().caption;
  assert.deepEqual([caption.styleId, caption.style.fontFamily, caption.style.fontWeight, caption.style.stroke.enabled, caption.style.background.enabled, caption.style.background.color, caption.style.background.cornerRadius], ["boxed", "Arial", 400, false, true, "#000000b3", 20]);
  assert.deepEqual(track().elements.map((entry: any) => [entry.text, entry.startTime]), [["Hi", 1 * S], ["Bye", 3 * S], ["Line one\nLine two", 5 * S]]);
  assert.deepEqual(valid(session.document).errors, []);
  // With "Apply to all" off the style goes to the selected captions only.
  adopt(session, (doc, ctx) => applyCaptionStyle(doc, ctx, track().id, "classic-yellow", [ids[1]]));
  assert.deepEqual([el(session.document, ids[1]).style.color, el(session.document, ids[0]).style, track().caption.styleId], ["#ffd400", undefined, "boxed"]);
  for (const style of CAPTION_STYLES) { adopt(session, (doc, ctx) => applyCaptionStyle(doc, ctx, track().id, style.id)); assert.deepEqual(valid(session.document).errors, [], style.id); }
});

// Requirement: Word-level highlight
test("Word-level highlight — timings are synthesised by character count when a caption has no words", () => {
  assert.deepEqual(distributeWords("hi there", 6000), [{ text: "hi", start: 0, end: 1714 }, { text: "there", start: 1714, end: 6000 }]);
  const { session, track } = imported();
  adopt(session, (doc, ctx) => setCaptionTrack(doc, ctx, track().id, { highlight: { style: "karaoke", color: "#009dff" } }, "Word highlight"));
  assert.deepEqual(track().caption.highlight, { style: "karaoke", color: "#009dff", textColor: "#000000", scale: 1.2 });
});

// Requirement: Export captions
const CUES = [{ start_ms: 1000, end_ms: 2500, text: "Hi", translation: "Chào" }, { start_ms: 3000, end_ms: 4000, text: "Bye", translation: "Tạm biệt" }];
test("Export captions — Scenario: SRT content", () => { assert.equal(writeSrt(CUES), "1\r\n00:00:01,000 --> 00:00:02,500\r\nHi\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n"); });
test("Export captions — Scenario: TXT without timestamps", () => { assert.equal(writeTxt(CUES), "Hi\nBye\n"); assert.equal(writeTxt(CUES, { timestamps: true }).split("\n")[0], "[00:00:01.000] Hi"); });
test("Export captions — Scenario: Bilingual export", () => {
  assert.equal(writeVtt(CUES, { content: "both" }), "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHi\nChào\n\n2\n00:00:03.000 --> 00:00:04.000\nBye\nTạm biệt\n");
  assert.equal(writeSrt([...CUES, { start_ms: 5000, end_ms: 6000, text: "  " }]).split("\r\n\r\n").length, 2);
});
test("Export captions — Scenario: Unknown language in the file name", () => { assert.equal(captionFileName("Trip", "und", "srt"), "Trip.und.srt"); assert.equal(captionFileName("A/B: c?", undefined, "vtt"), "A_B_ c_.und.vtt"); });
test("Export captions — Scenario: Round trip", () => {
  const { track } = imported();
  const again = parseSrt(writeSrt(captionCues(track())));
  assert.deepEqual(again.cues.map((cue) => [cue.start_ms, cue.end_ms, cue.text]), [[1000, 2500, "Hi"], [3000, 4000, "Bye"], [5000, 6200, "Line one\nLine two"]]);
});
