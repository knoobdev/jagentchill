// What a sound is when it cannot be had — its file is not on this device yet, or the file is here and this device cannot
// decode its audio. The preview must not break: the sound is silent, a file that arrives later is HEARD, and a sound
// that cannot be decoded is reported once, not on every block. An export fails by the asset — a film is never written
// with a sound silently left out. Real files through the real reader (mediabunny's URL source, as in the app): a
// PCM WAV made here, and an MP3 stream, which Node cannot decode (it has no MP3 decoder) — the reviewer's reproduction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_SAMPLE_RATE } from "../src/audio/gain.ts";
import { AudioSourceError, AudioSources } from "../src/audio/source.ts";

/** One second of a 440 Hz tone, 16-bit mono PCM at 8 kHz, as a WAV file. */
function toneWav(): Blob {
  const rate = 8000, data = new Int16Array(rate);
  for (let index = 0; index < data.length; index++) data[index] = Math.round(Math.sin((index / rate) * 2 * Math.PI * 440) * 12000);
  const head = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) => { for (let index = 0; index < value.length; index++) head.setUint8(at + index, value.charCodeAt(index)); };
  text(0, "RIFF"); head.setUint32(4, 36 + data.byteLength, true); text(8, "WAVE"); text(12, "fmt "); head.setUint32(16, 16, true);
  head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true);
  text(36, "data"); head.setUint32(40, data.byteLength, true);
  return new Blob([head.buffer, data.buffer], { type: "audio/wav" });
}
/** Forty MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz): a stream every reader recognises as MP3; decoding it needs an MP3 decoder. */
function mp3Stream(): Blob {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return new Blob(Array.from({ length: 40 }, () => frame), { type: "audio/mpeg" });
}
const peak = (block: [Float32Array, Float32Array]) => Math.max(...block[0].map(Math.abs), ...block[1].map(Math.abs));
const BLOCK = INTERNAL_SAMPLE_RATE / 10;
/**
 * The file as a URL the reader fetches. A `data:` URL: it is read through the same `UrlSource` as the app's `blob:`
 * URLs, and Node lets go of it cleanly when the reader is disposed (aborting the fetch of a `blob:` URL throws inside
 * Node 24). Nothing is left behind: there is no server and no object URL to revoke.
 */
async function withUrls(run: (urlOf: (blob: Blob) => string | Promise<string>) => Promise<void>): Promise<void> {
  await run(async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`);
}
test("preview: a sound with no file yet is silence, asked for again on every block — and it is HEARD from the first block after its file arrived", () => withUrls(async (urlOf) => {
  let asked = 0, url: string | undefined;
  const sources = new AudioSources(() => { asked += 1; return url; }, { missing: "silence" });
  try {
    const first = await sources.read("song", 0, BLOCK);
    assert.deepEqual([first[0].length, first[1].length, peak(first)], [BLOCK, BLOCK, 0]);
    assert.equal(peak(await sources.read("song", BLOCK, BLOCK)), 0);
    assert.equal(asked, 2, "the source is looked for again on the next block: the miss is not remembered");
    // The file arrives.
    url = await urlOf(toneWav());
    const heard = await sources.read("song", 2 * BLOCK, BLOCK);
    assert.ok(peak(heard) > 0.3, `the tone is in the block (peak ${peak(heard).toFixed(3)})`);
    assert.ok(heard[0].filter((sample) => sample !== 0).length > BLOCK / 2, "most samples of the block carry sound");
    assert.deepEqual(heard[0], heard[1], "a mono file sounds on both sides");
    assert.ok(peak(await sources.read("song", 3 * BLOCK, BLOCK)) > 0.3);
  } finally { sources.dispose(); }
}));

test("export: a sound with no file fails by the asset, and the failure is not kept for a later attempt", async () => {
  let asked = 0;
  const sources = new AudioSources(() => { asked += 1; return undefined; });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(Promise.resolve(sources.read("song", 0, 480)), (error) => error instanceof AudioSourceError && error.assetId === "song" && error.reason === "missing" && /asset song has no source/.test(error.message));
    }
    assert.equal(asked, 2, "a failed open is not cached");
  } finally { sources.dispose(); }
});

test("export: a sound whose audio track cannot be decoded FAILS by the asset — it is never written as silence", () => withUrls(async (urlOf) => {
  const mp3 = await urlOf(mp3Stream()), unknown = await urlOf(new Blob([new Uint8Array(2000).fill(7)], { type: "audio/mpeg" })), wav = await urlOf(toneWav());
  const sources = new AudioSources((assetId) => ({ song: mp3, noise: unknown, tone: wav })[assetId]);
  try {
    await assert.rejects(Promise.resolve(sources.read("song", 0, BLOCK)), (error) => error instanceof AudioSourceError && error.assetId === "song" && error.reason === "undecodable");
    // A file that is no sound file at all is the same failure, by its asset.
    await assert.rejects(Promise.resolve(sources.read("noise", 0, BLOCK)), (error) => error instanceof AudioSourceError && error.assetId === "noise" && error.reason === "undecodable");
    // A sound that can be decoded is still exported.
    assert.ok(peak(await sources.read("tone", 0, BLOCK)) > 0.3);
  } finally { sources.dispose(); }
}));

test("preview: a sound that cannot be decoded keeps playing as silence and says so ONCE, not on every block; a new file for the asset is tried and reported anew", () => withUrls(async (urlOf) => {
  const told: string[] = [];
  let song = await urlOf(mp3Stream());
  const sources = new AudioSources((assetId) => (assetId === "song" ? song : undefined), { missing: "silence", onUnplayable: (assetId, reason) => told.push(`${assetId}:${reason}`) });
  try {
    for (let block = 0; block < 5; block++) assert.equal(peak(await sources.read("song", block * BLOCK, BLOCK)), 0);
    assert.deepEqual(told, ["song:undecodable"]);
    // The asset gets a file this device can decode (its original arrived, it was replaced): it is heard.
    song = await urlOf(toneWav());
    sources.forget("song");
    assert.ok(peak(await sources.read("song", 5 * BLOCK, BLOCK)) > 0.3);
    assert.deepEqual(told, ["song:undecodable"]);
    // And back to one that cannot: said once more, for the new file.
    song = await urlOf(mp3Stream());
    sources.forget("song");
    for (let block = 6; block < 9; block++) assert.equal(peak(await sources.read("song", block * BLOCK, BLOCK)), 0);
    assert.deepEqual(told, ["song:undecodable", "song:undecodable"]);
  } finally { sources.dispose(); }
}));
