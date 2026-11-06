// The cutting of one speaker's recording back into its lines, on REAL recordings kept from the provider (2026-10-07).
import assert from "node:assert/strict";
import { test } from "node:test";
import { PITCH_DRIFT_MAX, alignPieces, bytesOfPcm, medianPitch, pcmOfWav, pitchDrift, splitAtPauses } from "../src/film/voice-batch.ts";
import { wavFromPcm16 } from "../src/generation/adapter.ts";

const tone = (seconds: number, hz: number, rate = 24_000): Int16Array => Int16Array.from({ length: Math.round(seconds * rate) }, (_, index) => Math.round(Math.sin((2 * Math.PI * hz * index) / rate) * 9000));
const silence = (seconds: number, rate = 24_000): Int16Array => new Int16Array(Math.round(seconds * rate));
const join = (...parts: Int16Array[]): Int16Array => { const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };

test("A WAV file is read back to the samples it was written from", () => {
  const samples = tone(0.5, 200), read = pcmOfWav(wavFromPcm16(bytesOfPcm(samples), 24_000, 1))!;
  assert.deepEqual([read.rate, read.samples.length, read.samples[100]], [24_000, samples.length, samples[100]]);
  assert.equal(pcmOfWav(new Uint8Array(60)), undefined);
});
test("A recording is cut at its pauses, and a short breath inside a line is not a cut", () => {
  const pcm = { samples: join(silence(0.2), tone(1.2, 180), silence(0.15), tone(0.8, 180), silence(0.7), tone(1.5, 180), silence(0.6), tone(1, 180), silence(0.3)), rate: 24_000 };
  const pieces = splitAtPauses(pcm);
  assert.equal(pieces.length, 3, JSON.stringify(pieces));
  // The first piece holds both stretches around the 0.15 s breath.
  assert.ok(Math.abs((pieces[0].to - pieces[0].from) / 24_000 - 2.15) < 0.25);
  assert.ok(pieces.every((piece, index) => piece.to > piece.from && (index === 0 || piece.from >= pieces[index - 1].to)), "pieces do not overlap");
});
test("Pieces are laid over the lines: a line cut in two at a comma takes both pieces — the real case of the provider", () => {
  const lines = ["Nồi vẫn đầy... khách chẳng còn như xưa.", "Ăn đi con, cho ấm người rồi ta lau nó.", "Hồi nhỏ cô cũng nhặt một con y như vầy, cũng trú mưa ngay chỗ này."];
  // What the listener wrote for the four pieces of the real recording.
  const heard = ["nồi vẫn đầy, khách chẳng còn như xưa.", "ăn đi còn, cho ấm người rồi ta lau nó.", "hồi nhỏ cô cũng nhặt một con y như vậy.", "cũng trú mưa ngay chỗ này."];
  const laid = alignPieces(lines, heard)!;
  assert.deepEqual(laid.map((entry) => [entry.from, entry.to]), [[0, 1], [1, 2], [2, 4]]);
  assert.ok(laid.every((entry) => entry.score >= 0.8), JSON.stringify(laid));
});
test("A recording that does not hold the lines is refused, never guessed", () => {
  assert.equal(alignPieces(["Về thôi, cả ba mẹ con mình.", "Dạ! Cảm ơn cô Tư!"], ["về thôi cả ba mẹ con mình"]), undefined, "a line is missing");
  assert.equal(alignPieces(["Về thôi, cả ba mẹ con mình.", "Dạ! Cảm ơn cô Tư!"], ["xin chào các bạn", "hôm nay trời đẹp"]), undefined, "other words");
});
test("The pitch of a voice is measured, and a line a fifth away from its speaker is called out", () => {
  assert.ok(Math.abs(medianPitch({ samples: tone(1, 150), rate: 24_000 }) - 150) <= 3);
  assert.ok(Math.abs(medianPitch({ samples: tone(1, 205), rate: 24_000 }) - 205) <= 4);
  assert.equal(medianPitch({ samples: silence(1), rate: 24_000 }), 0);
  // The real numbers: one call per line gave 138 / 179 / 157 Hz for one character; one call for all gave 152 / 145 / 147.
  assert.ok(pitchDrift(179, 157) < PITCH_DRIFT_MAX && pitchDrift(207, 150) > PITCH_DRIFT_MAX);
});
