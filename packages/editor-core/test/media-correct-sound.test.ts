import assert from "node:assert/strict";
import { test } from "node:test";
import { correctSoundAsset, validateProjectDocument } from "../src/index.ts";
import { audio, context, element, put, rejected, SECOND as S, studio, video } from "./support/fixtures.ts";

test("A song recorded as a video (its cover art was taken for a video stream) is corrected in one step: the asset is audio, and the clip that used it as a video becomes an audio clip on an audio track with the same id, time, source span and volume", () => {
  // `a1` is the studio's video asset; `t-overlay`… the clip sits on an overlay track from 0 to 6 s, as the agent placed the song.
  let doc = studio();
  const overlay = doc.scenes[0].tracks.overlay.find((track) => track.type === "video") ?? doc.scenes[0].tracks.overlay[0];
  doc = put(doc, overlay.id, video("song", 0, 6, { name: "Heartbreaking.mp3", volume: -4, trimStart: 1 * S, sourceDuration: 8 * S, trimEnd: 1 * S }));
  // Another sound already lies on the only audio track under the first seconds.
  doc = put(doc, "t-audio", audio("voice", 0, 3));
  const done = correctSoundAsset(doc, context(), "a1");
  const after = done.document, asset = after.media.assets.find((entry) => entry.id === "a1")! as Record<string, unknown>;
  assert.deepEqual([asset.type, asset.hasAudio, asset.width, asset.height, asset.videoCodec, asset.fps], ["audio", true, undefined, undefined, undefined, undefined]);
  assert.deepEqual(done.elementIds, ["song"]);
  const now = element(after, "song") as Record<string, unknown>;
  assert.deepEqual([now.type, now.mediaId, now.name, now.startTime, now.duration, now.trimStart, now.trimEnd, now.sourceDuration, now.volume], ["audio", "a1", "Heartbreaking.mp3", 0, 6 * S, 1 * S, 1 * S, 8 * S, -4]);
  const scene = after.scenes[0];
  const home = scene.tracks.audio.find((track) => track.elements.some((entry) => entry.id === "song"))!;
  assert.equal(home.type, "audio");
  assert.notEqual(home.id, "t-audio", "the audio track that is taken there is left alone: the clip gets a track of its own");
  assert.equal(scene.tracks.overlay.some((track) => track.id === overlay.id), false, "the overlay track the clip left empty is gone");
  assert.equal([...scene.tracks.overlay, scene.tracks.main].some((track) => track.elements.some((entry) => (entry as { mediaId?: string }).mediaId === "a1")), false, "no visual clip uses the sound any more");
  assert.equal(validateProjectDocument(after).ok, true, JSON.stringify(validateProjectDocument(after)).slice(0, 400));
  // An asset that is not recorded as a video is not touched.
  assert.ok(rejected(() => correctSoundAsset(after, context(), "a1")));
});

test("Correcting a song recorded as a video: a clip on the main track goes to a free audio track, and a clip whose sound was already extracted is removed without a second copy of the sound", () => {
  let doc = put(studio(), "t-main", video("song", 2, 4, { linkId: "L", isSourceAudioEnabled: false }), video("other", 6, 2, { mediaId: "a1" }));
  doc = put(doc, "t-audio", audio("extracted", 2, 4, { mediaId: "a1", linkId: "L" }));
  const after = correctSoundAsset(doc, context(), "a1").document, scene = after.scenes[0];
  assert.deepEqual(scene.tracks.main.elements.map((entry) => entry.id), []);
  const sounds = scene.tracks.audio.flatMap((track) => track.elements.map((entry) => [entry.id, entry.type, entry.startTime / S]));
  assert.deepEqual(sounds.sort(), [["extracted", "audio", 2], ["other", "audio", 6]]);
  assert.equal(scene.tracks.audio.length, 1, "the clip found room on the audio track that exists");
});
