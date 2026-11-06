import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAsset, addBeats, clampFade, clearBeats, creditsText, deleteBeatAt, extractAudio, fadesAfterTrim, licenceCheck, percentVolume, recoverAudio, setEq, setElementFields, setFade, setTrackDucking, storedVolume, visibleBeats,
  volumeAtLineY, volumeGain, volumeLabel, volumeLineY, volumePercent, volumeSliderPosition,
} from "../src/index.ts";
import { audio, context, element, put, rejected, SECOND as S, studio, track, video } from "./support/fixtures.ts";

// Requirement: Clip volume in decibels
test("Clip volume in decibels — Scenario: Gain mapping", () => { assert.ok(Math.abs(volumeGain(-6) - 0.501) < 0.001); });
test("Clip volume in decibels — Scenario: Range clamp", () => { assert.equal(storedVolume(35), 20); assert.equal(storedVolume(-3.456), -3.46); });
test("Clip volume in decibels — Scenario: Minimum is silence", () => { assert.equal(volumeGain(-60), 0); assert.equal(volumeLabel(-60), "−∞ dB"); assert.equal(volumeLabel(-12), "−12.0 dB"); });
test("Clip volume in decibels — Scenario: Nudge", () => { let volume = 0; for (let press = 0; press < 3; press++) volume = storedVolume(volume + 0.1); assert.equal(volume, 0.3); });
test("Clip volume in decibels — Scenario: Touch slider mapping", () => { assert.ok(Math.abs(percentVolume(200) - 6.02) <= 0.01); assert.ok(Math.abs(volumePercent(6.02) - 200) < 0.2); });
test("Clip volume in decibels — Scenario: Touch slider extremes", () => { assert.deepEqual([percentVolume(0), percentVolume(1000), volumePercent(-60), volumeSliderPosition(0), volumeSliderPosition(1000)], [-60, 20, 0, 0, 1]); });

// Requirement: Volume line on clips
test("Volume line on clips — Scenario: Line position", () => { assert.ok(Math.abs(volumeLineY(0, 50) - 34) <= 1); assert.equal(volumeLineY(20, 50), 0); assert.equal(volumeLineY(-60, 50), 50); });
test("Volume line on clips — Scenario: Drag the line", () => { assert.equal(volumeAtLineY(volumeLineY(-12, 50), 50), -12); assert.equal(volumeAtLineY(50, 50), -60); assert.equal(volumeAtLineY(0, 50), 20); });

// Requirement: Audio fades
test("Audio fades — Scenario: Fades cannot overlap", () => {
  const doc = put(studio(), "t-audio", audio("a", 0, 3, { fadeIn: { duration: 2 * S, shape: "linear" } }));
  const after = element(setFade(doc, context(), ["a"], "fadeOut", { duration: 2 * S }).document, "a");
  assert.deepEqual([after.fadeIn.duration, after.fadeOut.duration, after.fadeOut.shape], [2 * S, 1 * S, "equal-power"]);
  assert.equal(clampFade(9 * S, 3 * S, 0), 3 * S);
  assert.equal(element(setFade(doc, context(), ["a"], "fadeIn", { shape: "s-curve" }).document, "a").fadeIn.shape, "s-curve");
});
test("Audio fades — Scenario: Trim shorter than the fades", () => { assert.deepEqual(fadesAfterTrim(1 * S, 1 * S, 1 * S), { fadeIn: 0.5 * S, fadeOut: 0.5 * S }); assert.deepEqual(fadesAfterTrim(1 * S, 1 * S, 4 * S), { fadeIn: 1 * S, fadeOut: 1 * S }); });

// Requirement: Extract audio from video
test("Extract audio from video — Scenario: Extract (the audio element takes the clip's volume, mute, pan, fades, processing settings and volume keyframes; the video's audio fields return to defaults)", () => {
  const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
  const doc = put(studio(), "t-main", video("v", 0, 6, {
    volume: -3, pan: 40, fadeIn: { duration: 1 * S, shape: "linear" }, isVoice: true, eq: { enabled: true, preset: "custom", bands: { low: 0, lowMid: 0, mid: 6, highMid: 0, high: 0 } },
    animations: { volume: { keys: [key("k1", 0, -3), key("k2", 2 * S, -9)] }, opacity: { keys: [key("k3", 0, 1)] } },
  }));
  const extracted = extractAudio(doc, context(), "v").document;
  const source = element(extracted, "v");
  const clip = track(extracted, "t-audio").elements.find((entry: any) => entry.linkId === source.linkId);
  assert.deepEqual([clip.startTime, clip.duration, clip.volume, clip.pan, clip.fadeIn, clip.isVoice, clip.eq.bands.mid, clip.animations.volume.keys.length], [0, 6 * S, -3, 40, { duration: 1 * S, shape: "linear" }, true, 6, 2]);
  assert.deepEqual([source.isSourceAudioEnabled, source.volume, source.pan, source.fadeIn.duration, source.isVoice, source.eq, source.animations.volume, source.animations.opacity.keys.length], [false, 0, 0, 0, false, undefined, undefined, 1]);
});

// Requirement: Recover audio into video
test("Recover audio into video — Scenario: Recover with the linked element present", () => {
  const doc = put(studio(), "t-main", video("v", 0, 4, { volume: -3 }));
  const extracted = extractAudio(doc, context(), "v").document;
  const clip = track(extracted, "t-audio").elements.find((entry: any) => entry.linkId === element(extracted, "v").linkId);
  assert.equal(element(extracted, "v").isSourceAudioEnabled, false);
  const lowered = setElementFields(extracted, context(), clip.id, { volume: -9 }).document;
  const after = recoverAudio(lowered, context(), "v").document;
  assert.deepEqual([element(after, "v").volume, element(after, "v").isSourceAudioEnabled, element(after, "v").linkId, track(after, "t-audio")?.elements.length ?? 0], [-9, true, null, 0]);
});
test("Recover audio into video — Scenario: Linked element already deleted", () => {
  const doc = put(studio(), "t-main", video("v", 0, 4, { volume: -5, isSourceAudioEnabled: false }));
  const after = element(recoverAudio(doc, context(), "v").document, "v");
  assert.deepEqual([after.isSourceAudioEnabled, after.volume], [true, -5]);
});

// Requirement: Beat markers on audio
test("Beat markers on audio — Scenario: Add at the playhead", () => {
  const doc = put(studio(), "t-audio", audio("a", 5, 20, { sourceDuration: 40 * S, trimStart: 10 * S, trimEnd: 10 * S }));
  const after = addBeats(doc, context(), "a", [8 * S]).document;
  assert.deepEqual(element(after, "a").beats, [13 * S]);
});
test("Beat markers on audio — Scenario: Markers follow a trim", () => {
  const clip = { beats: [13 * S], trimStart: 11 * S, trimEnd: 10 * S, sourceDuration: 40 * S };
  assert.deepEqual(visibleBeats(clip), [13 * S]);
  assert.equal(13 * S - clip.trimStart, 2 * S);
});
test("Beat markers on audio — Scenario: Tap during playback", () => {
  const doc = put(studio(), "t-audio", audio("a", 0, 20));
  const taps = Array.from({ length: 8 }, (_, index) => (index + 1) * S);
  const made = addBeats(doc, context(), "a", taps);
  assert.equal(element(made.document, "a").beats.length, 8);
  // One commit for the whole pass: a single undo removes all eight.
  assert.equal(element(doc, "a").beats.length, 0);
  assert.deepEqual(element(deleteBeatAt(made.document, context(), "a", 3 * S + 100, 8000).document, "a").beats.length, 7);
  assert.equal(rejected(() => deleteBeatAt(made.document, context(), "a", 3.5 * S, 8000)).length, 1);
  assert.deepEqual(element(clearBeats(made.document, context(), "a").document, "a").beats, []);
});
test("Beat markers on audio — Scenario: Limit", () => {
  const doc = put(studio(), "t-audio", audio("a", 0, 60, { beats: Array.from({ length: 2000 }, (_, index) => index * 100) }));
  const [error] = rejected(() => addBeats(doc, context(), "a", [59 * S]));
  assert.equal(error.message, "Beat marker limit reached (2000)");
});

// Requirement: Equaliser, compressor and ducking
test("Equaliser, compressor and ducking — Scenario: Preset values", () => {
  const doc = put(studio(), "t-audio", audio("a", 0, 4));
  const radio = setEq(doc, context(), ["a"], { enabled: true, preset: "radio" }).document;
  assert.deepEqual(element(radio, "a").eq, { enabled: true, preset: "radio", bands: { low: -12, lowMid: -3, mid: 3, highMid: 5, high: -9 } });
  const moved = element(setEq(radio, context(), ["a"], { band: { key: "mid", value: 4.3 } }).document, "a").eq;
  assert.deepEqual([moved.preset, moved.bands.mid, moved.bands.low], ["custom", 4.5, -12]);
});
test("Equaliser, compressor and ducking — Scenario: No voice clips", () => {
  const doc = put(studio(), "t-audio", audio("a", 0, 4));
  const after = setTrackDucking(doc, context(), "t-audio", { enabled: true }).document;
  assert.deepEqual(track(after, "t-audio").ducking, { enabled: true, amount: 12, attack: 200, release: 500, mode: "full" });
  // Nothing is flagged Voice: the panel says so, and the track plays at full level.
  assert.equal(track(after, "t-audio").elements.some((entry: any) => entry.isVoice), false);
});

// Requirement: Audio licence check
const withSound = (licence: string, id: string) => (doc: ReturnType<typeof studio>) => {
  const added = addAsset(doc, context(), { id, name: `Sound ${id}`, type: "audio", size: 10, duration: 2 * S, provenance: { source: "url", url: `https://sounds.example/${id}.mp3`, author: "Lena", licence, sourceUrl: `https://sounds.example/${id}`, attributionRequired: licence !== "CC0" } }).document;
  const count = track(added, "t-audio").elements.length;
  return put(added, "t-audio", audio(`e-${id}`, count * 3, 2, { mediaId: id, sourceType: "library" }));
};
test("Audio licence check — Scenario: Non-commercial sound flagged", () => {
  const rows = licenceCheck(withSound("CC0", "snd2")(withSound("Attribution NonCommercial", "snd1")(studio())), "s1");
  assert.deepEqual(rows.map((row) => [row.licence, row.flag]), [["CC BY-NC", "Not for commercial use"], ["CC0", undefined]]);
});
test("Audio licence check — Scenario: Copy credits", () => {
  const rows = licenceCheck(withSound("CC-BY 4.0", "snd2")(withSound("Attribution", "snd1")(studio())), "s1");
  const lines = creditsText(rows).split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^Sound snd\d — Lena — CC BY — https:\/\/sounds\.example\/snd\d$/);
});
test("Audio licence check — Scenario: No audio", () => {
  assert.deepEqual(licenceCheck(studio(), "s1"), []);
  const own = licenceCheck(put(studio(), "t-audio", audio("a", 0, 2)), "s1");
  assert.deepEqual(own.map((row) => row.licence), ["Your file — licence not known to JAgentChill"]);
});
