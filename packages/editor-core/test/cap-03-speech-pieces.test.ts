import assert from "node:assert/strict";
import { test } from "node:test";
import { captionsFromSpeech, cuesOfSpeech, findSilences, pcm16OfFloat, SpeechCancelled, sourceRangeOf, speechPieces, timelineRangeOfSource, translatedCues, wavOfPcm16 } from "../src/index.ts";
import { sourceTimeAt, retimeClipOf } from "../src/time/retime.ts";

const RATE = 16_000;
/** A recording: tones (speech) and silences, in seconds. */
function recording(parts: [kind: "tone" | "quiet", seconds: number][]): Int16Array {
  const out = new Int16Array(Math.round(parts.reduce((sum, part) => sum + part[1], 0) * RATE));
  let at = 0;
  for (const [kind, seconds] of parts) { const frames = Math.round(seconds * RATE); if (kind === "tone") for (let index = 0; index < frames; index++) out[at + index] = Math.round(Math.sin((2 * Math.PI * 200 * index) / RATE) * 8000); at += frames; }
  return out;
}
const seconds = (ranges: { from: number; to: number }[]) => ranges.map((range) => [Math.round((range.from / RATE) * 100) / 100, Math.round((range.to / RATE) * 100) / 100]);

test("speechPieces: three spoken pieces separated by pauses come back as three pieces at their own times", () => {
  const pieces = speechPieces(recording([["quiet", 0.8], ["tone", 3], ["quiet", 0.7], ["tone", 3], ["quiet", 0.7], ["tone", 3], ["quiet", 0.8]]), RATE);
  assert.equal(pieces.length, 3);
  for (const [index, [from, to]] of seconds(pieces).entries()) {
    assert.ok(Math.abs(from - (0.8 + index * 3.7)) <= 0.05, `piece ${index} starts at ${from}`);
    assert.ok(Math.abs(to - (3.8 + index * 3.7)) <= 0.1, `piece ${index} ends at ${to}`);
  }
});

test("speechPieces: a stretch nobody paused in is cut so that every piece fits one request, and nothing is lost or repeated", () => {
  const pieces = speechPieces(recording([["tone", 45]]), RATE, { maxSeconds: 20 });
  assert.ok(pieces.length >= 3);
  for (const piece of pieces) assert.ok((piece.to - piece.from) / RATE <= 20.2);
  for (let index = 1; index < pieces.length; index++) assert.ok(pieces[index].from >= pieces[index - 1].to, "pieces do not overlap");
  assert.deepEqual(speechPieces(new Int16Array(RATE * 3), RATE), [], "silence has no speech");
});

test("Remove silences: a pause of 1.5 s with defaults becomes a cut of 1.3 s (0.1 s kept on each side)", () => {
  const silences = findSilences(recording([["tone", 2], ["quiet", 1.5], ["tone", 2], ["quiet", 0.3], ["tone", 1]]), RATE);
  assert.equal(silences.length, 1, "the 0.3 s pause is shorter than the minimum silence");
  const [[from, to]] = seconds(silences);
  assert.ok(Math.abs(from - 2.1) <= 0.04 && Math.abs(to - 3.4) <= 0.04, `cut ${from}–${to}`);
});

test("Nothing found: no silence longer than the minimum gives no cut", () => {
  assert.deepEqual(findSilences(recording([["tone", 3], ["quiet", 0.3], ["tone", 3]]), RATE), []);
  assert.equal(findSilences(recording([["tone", 2], ["quiet", 1], ["tone", 2]]), RATE, { minSeconds: 2 }).length, 0);
});

test("cuesOfSpeech: a short piece is one caption with the piece's own times; a long one is divided and its time shared out", () => {
  assert.deepEqual(cuesOfSpeech("  Hello   there  ", 800, 3800), [{ start_ms: 800, end_ms: 3800, text: "Hello there" }]);
  assert.deepEqual(cuesOfSpeech("", 0, 1000), []);
  const long = cuesOfSpeech("This is the first sentence of a long stretch of speech that nobody paused in. And this is the second sentence, which goes on for a while too, well past two lines.", 1000, 11_000);
  assert.ok(long.length >= 2);
  assert.equal(long[0].start_ms, 1000);
  assert.equal(long.at(-1)!.end_ms, 11_000);
  for (const [index, cue] of long.entries()) { assert.ok(Array.from(cue.text).length <= 84); if (index) assert.equal(cue.start_ms, long[index - 1].end_ms); }
});

const S = 120_000;
test("Retimed clip: a word at source time 4.0 s of a clip playing at 2× starts 2.0 s after the clip's start", () => {
  const clip = { startTime: 5 * S, duration: 10 * S, trimStart: 0, retime: { rate: 2 } };
  assert.deepEqual(sourceRangeOf(clip), { start: 0, end: 20 * S });
  assert.deepEqual(timelineRangeOfSource(clip, 4 * S, 6 * S), { start: 7 * S, end: 8 * S });
});

test("Reversed clip: the words are put where they SOUND — the end of the source stretch first", () => {
  // Source 2–12 s played backwards over timeline 0–10 s: source 3–5 s is heard at 7–9 s.
  const clip = { startTime: 0, duration: 10 * S, trimStart: 2 * S, retime: { rate: 1, reverse: true } };
  assert.deepEqual(sourceRangeOf(clip), { start: 2 * S, end: 12 * S });
  assert.deepEqual(timelineRangeOfSource(clip, 3 * S, 5 * S), { start: 7 * S, end: 9 * S });
  // A constant-rate guess (start + offset / rate) would have said 1–3 s.
});

test("Speed curve: a stretch of the source is placed by the clip's own time map, not by its average rate", () => {
  const clip = { startTime: 3 * S, duration: 10 * S, trimStart: 0, retime: { rate: 1, curve: { points: [{ u: 0, rate: 0.5 }, { u: 0.5, rate: 0.5 }, { u: 0.55, rate: 4 }, { u: 1, rate: 4 }] } } };
  const map = retimeClipOf(clip), range = sourceRangeOf(clip);
  // Two moments of the clip, and the source ticks the engine shows there.
  const a = 2 * S, b = 4 * S, sourceA = sourceTimeAt(map, a), sourceB = sourceTimeAt(map, b);
  const placed = timelineRangeOfSource(clip, sourceA, sourceB);
  assert.ok(Math.abs(placed.start - (clip.startTime + a)) <= S / 100 && Math.abs(placed.end - (clip.startTime + b)) <= S / 100, JSON.stringify(placed));
  // The constant-rate formula is far off for the same stretch.
  const average = (range.end - range.start) / clip.duration, naive = clip.startTime + (sourceA - range.start) / average;
  assert.ok(Math.abs(naive - placed.start) > S / 2, `the curve matters here: naive ${naive}, mapped ${placed.start}`);
});

/** A 12 s recording of three tones, as the decoder would give it. */
const three = () => recording([["quiet", 0.8], ["tone", 3], ["quiet", 0.7], ["tone", 3], ["quiet", 0.7], ["tone", 3], ["quiet", 0.8]]);
test("Host run: each spoken piece is one cue at the time the clip's map gives it; the same stretch under two clips is heard once", async () => {
  let asked = 0;
  const element = { startTime: 0, duration: 12 * S, trimStart: 0 }, later = { ...element, startTime: 20 * S };
  const result = await captionsFromSpeech({ clips: [{ id: "a", assetId: "voice", element }, { id: "b", assetId: "voice", element: later }], rate: RATE, decode: async () => three(), hear: async () => ({ text: `piece ${++asked}`, costUsd: 0.01, model: "m" }), cancelled: () => false });
  assert.equal(asked, 3, "no source second is transcribed twice");
  assert.equal(result.cues.length, 6);
  assert.ok(Math.abs(result.cues[0].start_ms - 800) <= 60 && Math.abs(result.cues[3].start_ms - 20_800) <= 60, JSON.stringify(result.cues.map((cue) => cue.start_ms)));
  assert.ok(Math.abs(result.costUsd - 0.03) < 1e-9);
});

test("Cancel: a run cancelled while its last pieces are being heard returns no cue at all", async () => {
  let cancelled = false, asked = 0;
  const element = { startTime: 0, duration: 12 * S, trimStart: 0 };
  const run = captionsFromSpeech({ clips: [{ id: "a", assetId: "voice", element }], rate: RATE, decode: async () => three(), cancelled: () => cancelled,
    // The person cancels while the LAST piece is in flight; its answer still arrives.
    hear: async () => { const mine = ++asked; if (mine === 3) cancelled = true; await new Promise((resolve) => setTimeout(resolve, 10)); return { text: `piece ${mine}` }; } });
  await assert.rejects(run, SpeechCancelled);
  // Cancelled while the file is still being decoded: nothing is sent to be heard.
  cancelled = false; asked = 0;
  const early = captionsFromSpeech({ clips: [{ id: "a", assetId: "voice", element }], rate: RATE, decode: async () => { cancelled = true; return three(); }, cancelled: () => cancelled, hear: async () => { asked++; return { text: "x" }; } });
  await assert.rejects(early, SpeechCancelled);
  assert.equal(asked, 0);
});

test("Partial failure: a translated track keeps every cue of its source in place; a caption that was not translated is there without text", () => {
  const captions = [{ id: "a", startTime: 1 * S, duration: 2 * S }, { id: "b", startTime: 4 * S, duration: 1 * S }, { id: "c", startTime: 6 * S, duration: 1 * S }];
  assert.deepEqual(translatedCues(captions, new Map([["a", "Xin chào"], ["c", "Tạm biệt"]])), [{ start_ms: 1000, end_ms: 3000, text: "Xin chào" }, { start_ms: 4000, end_ms: 5000, text: "" }, { start_ms: 6000, end_ms: 7000, text: "Tạm biệt" }]);
});

test("wavOfPcm16 writes a 16-bit mono file of the samples", () => {
  const wav = wavOfPcm16(pcm16OfFloat(new Float32Array([0, 0.5, -1, 2])), RATE), view = new DataView(wav.buffer);
  assert.equal(wav.length, 52);
  assert.equal(view.getUint32(24, true), RATE);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)], [0, 16384, -32768, 32767]);
});
