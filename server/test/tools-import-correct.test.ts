// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync, the tools and FFmpeg's
// probe of the file are real. A project that ALREADY holds a song recorded as a video (the cover art of an MP3 was once
// read as a video stream, and the agent put the "video" on an overlay track — the export then stopped at frame 0):
// importing the same file again corrects the record and the clips, as one step of the project.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { S, follower, toolWorld } from "./support/tools.ts";

let work: string, song: Uint8Array;
before(() => {
  work = mkdtempSync(join(tmpdir(), "jc-tools-correct-"));
  const ff = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
  ff("-f", "lavfi", "-i", "color=c=red:s=400x400", "-frames:v", "1", join(work, "cover.jpg"));
  ff("-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", join(work, "plain.mp3"));
  ff("-i", join(work, "plain.mp3"), "-i", join(work, "cover.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-id3v2_version", "3", "-disposition:v", "attached_pic", join(work, "song.mp3"));
  song = new Uint8Array(readFileSync(join(work, "song.mp3")));
});
after(() => rmSync(work, { recursive: true, force: true }));

test("a song the library recorded as a video is corrected when the same file is imported again: the asset is audio, its clip becomes an audio clip on an audio track, in one operation every device receives", async () => {
  const w = await toolWorld();
  const blobId = await w.s.upload(w.admin, song, { mime: "audio/mpeg", name: "Heartbreaking.mp3" });
  // The state the old probe left: the asset `drone` (a video on the main track from 0 to 10 s) is this very file.
  const before = w.head(), index = before.media.assets.findIndex((asset) => asset.id === w.project.assets.drone), row = w.h.app.sync.documents.row(w.doc)!;
  const seeded = await w.h.app.sync.host.applyBatch({
    doc: w.doc, principal: "agent:old-probe", label: "Old import", baseRevision: row.head, commandType: "media.add", originDeviceId: w.admin.device.deviceId,
    patches: [{ op: "replace", path: `/media/assets/${index}/contentHash`, value: blobId }, { op: "replace", path: `/media/assets/${index}/name`, value: "Heartbreaking.mp3" }, { op: "replace", path: `/media/assets/${index}/width`, value: 400 }, { op: "replace", path: `/media/assets/${index}/height`, value: 400 }] as never,
  });
  assert.equal(seeded.state, "applied", JSON.stringify(seeded));
  const wrong = w.head().media.assets.find((asset) => asset.id === w.project.assets.drone)!;
  assert.deepEqual([wrong.type, wrong.width, wrong.contentHash], ["video", 400, blobId]);
  const phone = await follower(w.h, "Phone", w.doc, w.head(), w.revision());

  const again = await w.write("jc_media_import", { source: { kind: "upload", blobId } });
  assert.deepEqual([again.data.assetId, again.data.kind, again.data.alreadyInLibrary, again.data.corrected.from, again.data.corrected.to, again.data.corrected.elementIds], [w.project.assets.drone, "audio", true, "video", "audio", [w.project.clipA]]);
  const now = w.head(), asset = now.media.assets.find((entry) => entry.id === w.project.assets.drone)! as Record<string, unknown>;
  assert.deepEqual([asset.type, asset.hasAudio, asset.width, asset.height, asset.videoCodec], ["audio", true, undefined, undefined, undefined]);
  const scene = now.scenes[0], home = scene.tracks.audio.find((track) => track.elements.some((element) => element.id === w.project.clipA))!;
  const clip = home.elements.find((element) => element.id === w.project.clipA)! as Record<string, unknown>;
  assert.deepEqual([home.type, clip.type, clip.mediaId, clip.startTime, clip.duration], ["audio", "audio", w.project.assets.drone, 0, 10 * S]);
  assert.equal(scene.tracks.main.elements.some((element) => element.id === w.project.clipA), false, "the main track no longer holds a video of a sound");
  // One operation of the log, which another device applies.
  assert.deepEqual(await phone.pull(), ["Heartbreaking.mp3: a sound, not a video"]);
  assert.equal(phone.document.media.assets.find((entry) => entry.id === w.project.assets.drone)!.type, "audio");
  // Asked once more, the library simply has it.
  const third = await w.write("jc_media_import", { source: { kind: "upload", blobId } });
  assert.deepEqual([third.data.kind, third.data.alreadyInLibrary, third.data.corrected], ["audio", true, undefined]);
  w.close();
});
