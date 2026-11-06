// What kind of media a file is, as the host decides it for an import (`jc_media_import`, generated results). A song with
// its cover picture embedded (most downloaded MP3s) has a "video" stream that is one attached picture: it is AUDIO.
// Recorded as a video it lands on the timeline as a 400×400 clip no engine can draw a frame of — the export then stops
// at its first frame with "media of the frame is unavailable".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHarness, type Harness } from "./harness.ts";

let h: Harness, work: string;
before(async () => { work = mkdtempSync(join(tmpdir(), "jc-media-probe-")); h = await createHarness(); });
after(() => { h.close(); rmSync(work, { recursive: true, force: true }); });
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

test("a song with an embedded cover picture is audio, not a video; a real video and a picture stay what they are", async () => {
  const cover = join(work, "cover.jpg"), song = join(work, "song.mp3"), plain = join(work, "plain.mp3"), clip = join(work, "clip.mp4"), picture = join(work, "picture.jpg");
  ff("-f", "lavfi", "-i", "color=c=red:s=400x400", "-frames:v", "1", cover);
  ff("-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", plain);
  // The cover goes in as an attached picture, the way a tagged MP3 carries it.
  ff("-i", plain, "-i", cover, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-id3v2_version", "3", "-disposition:v", "attached_pic", song);
  ff("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip);
  ff("-f", "lavfi", "-i", "color=c=blue:s=640x360", "-frames:v", "1", picture);
  const jobs = h.app.sync.mediaJobs;
  const kind = async (file: string) => { const facts = await jobs.probe(file); return { video: facts.video, audio: facts.audio, image: facts.image, width: facts.width, height: facts.height }; };
  assert.deepEqual(await kind(song), { video: false, audio: true, image: false, width: 0, height: 0 }, "the cover of a song is not a video stream");
  assert.deepEqual(await kind(plain), { video: false, audio: true, image: false, width: 0, height: 0 });
  assert.deepEqual(await kind(clip), { video: true, audio: true, image: false, width: 320, height: 240 });
  assert.deepEqual(await kind(picture), { video: false, audio: false, image: true, width: 640, height: 360 });
});
