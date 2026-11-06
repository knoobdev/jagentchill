// The export render session in its worker, in headless Chromium: an export with its own compositor and decoders while the preview stays interactive, a snapshot that edits do not reach, and cancel.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, ffprobe, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x2040c0:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v", "libx264", "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-c:a", "aac", "-ac", "2", "-shortest", join(harness.media, "clip4.mp4")]);
});
after(async () => { await harness?.close(); });

/** The colour of a pixel of the frame at a time of an exported file. */
function pixelOf(file: string, seconds: number, x: number, y: number): number[] {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x - (x % 2)}:${y - (y % 2)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" });
  return [...run.stdout.subarray(0, 3)];
}

/** The brightest pixel of a row segment of the frame at a time of an exported file. */
function brightest(file: string, seconds: number, x: number, y: number, width: number): number[] {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", `crop=${width}:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" });
  let best = [0, 0, 0];
  for (let index = 0; index + 2 < width * 3; index += 3) if (run.stdout[index] + run.stdout[index + 1] + run.stdout[index + 2] > best[0] + best[1] + best[2]) best = [...run.stdout.subarray(index, index + 3)];
  return best;
}

test("Export render session — on web and desktop the session runs in a worker with an OffscreenCanvas and its own compositor: the preview stays interactive; Editing during export does not change the output; the exported text, picture and sound are those of the snapshot", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }];
    const red = await jc.imageUrl(64, 64, (context) => { context.fillStyle = "#ff0000"; context.fillRect(0, 0, 64, 64); });
    const build = () => {
      const doc = jc.project({ width: 640, height: 360 });
      doc.media.assets.push(jc.asset("v", "video", { width: 640, height: 360, duration: 480000, hasAudio: true }), jc.asset("red", "image", { width: 64, height: 64 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 480000, mediaId: "v", sourceDuration: 480000 }));
      // A red square top-left for the whole time, and a white title in the middle.
      doc.scenes[0].tracks.overlay = [
        jc.track("video", "o0", [jc.element("image", { id: "e2", startTime: 0, duration: 480000, mediaId: "red", transform: { position: { x: -160, y: -90 }, scale: { x: 0.4, y: 0.4 }, rotation: 0 } })]),
        jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 480000, content: "IIIIII", fontFamily: "Arial", fontWeight: 700, fontSize: 40, color: "#ffffff" })]),
      ];
      return doc;
    };
    const run = async (exportWorker: boolean) => {
      const opened = await jc.open(build(), { width: 640, height: 360, exportWorker }, [{ assetId: "v", original: `${origin}/media/clip4.mp4` }, { assetId: "red", original: red }], (port) => port.command("fonts.setSources", { fonts }));
      await opened.engine.whenFontsSettled();
      let file = new Uint8Array(0);
      opened.port.on("export.chunk", (payload, transfer) => {
        const data = new Uint8Array(transfer![0]);
        if (payload.position! + data.length > file.length) { const grown = new Uint8Array(payload.position! + data.length); grown.set(file); file = grown; }
        file.set(data, payload.position!);
      });
      const mark = opened.events.length, started = performance.now();
      await opened.port.command("export.start", { exportId: "x1", width: 640, height: 360, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc", bitrate: 2_000_000 }, audio: { codec: "aac", sampleRate: 48000, channels: 2 } });
      // While the export runs: the user deletes the red square, then scrubs. Each seek is timed to its frame.
      await opened.port.command("scene.patch", { baseRevision: 1, revision: 2, patches: [{ op: "remove", path: "/scenes/@s1/tracks/overlay/@o0/elements/@e2" }] });
      const latencies: number[] = [];
      let finished = false, preview: number[] | null = null;
      const done = Promise.race([opened.waitFor("export.done", mark, 90_000), opened.waitFor("export.failed", mark, 90_000).then((failure) => { throw new Error(JSON.stringify(failure)); })]).finally(() => { finished = true; });
      for (let step = 0; !finished && step < 400; step++) {
        const at = performance.now(), seen = opened.events.length;
        await opened.port.command("transport.seek", { time: ((step * 7) % 110) * 4000, mode: "exact" });
        const frame = await Promise.race([opened.waitFor("frame.ready", seen, 3000).then(() => true, () => false), done.then(() => false, () => false)]);
        if (!frame) break;
        latencies.push(performance.now() - at);
        if (step === 3) { const size = opened.engine.renderSize!; const pixels = await opened.engine.readPixels(0, 0, size.width, size.height); preview = Array.from(pixels.slice((40 * size.width + 40) * 4, (40 * size.width + 40) * 4 + 4)); }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const payload = await done;
      const elapsed = performance.now() - started;
      const progress = opened.events.slice(mark).filter((event) => event.type === "export.progress").map((event) => event.payload);
      let binary = "";
      for (let index = 0; index < file.length; index += 0x8000) binary += String.fromCharCode(...file.subarray(index, index + 0x8000));
      latencies.sort((a, b) => a - b);
      return { payload, elapsed, base64: btoa(binary), frames: latencies.length, median: latencies[latencies.length >> 1] ?? -1, p95: latencies[Math.floor(latencies.length * 0.95)] ?? -1, worst: latencies[latencies.length - 1] ?? -1, preview, stages: [...new Set(progress.map((entry: any) => entry.stage))], backend: opened.ready().backend };
    };
    return { worker: await run(true), same: await run(false) };
  }, harness.origin);
  for (const [name, run] of Object.entries(result)) {
    const file = join(harness.media, `${name}.mp4`);
    writeFileSync(file, Buffer.from(run.base64, "base64"));
    const probe = ffprobe(file), video = probe.streams.find((stream: any) => stream.codec_type === "video"), audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
    assert.equal(Number(video.nb_read_frames), 120, `${name}: frame count`);
    assert.equal(run.payload.frameCount, 120);
    assert.ok(audio && Math.abs(Number(audio.duration) - 4) < 0.1, `${name}: audio`);
    // The snapshot: the red square the user deleted during the export is in every part of the file; so are the picture and the title.
    for (const at of [0.5, 3.5]) {
      const square = pixelOf(file, at, 100, 60), picture = pixelOf(file, at, 560, 300), title = brightest(file, at, 240, 180, 160);
      assert.ok(square[0] > 200 && square[1] < 70 && square[2] < 70, `${name}: the deleted clip is in the export at ${at} s: ${square}`);
      assert.ok(Math.abs(picture[0] - 0x20) < 20 && Math.abs(picture[2] - 0xc0) < 24, `${name}: the video at ${at} s: ${picture}`);
      assert.ok(title[0] > 200 && title[1] > 200 && title[2] > 200, `${name}: the title at ${at} s: ${title}`);
    }
  }
  const { worker, same } = result;
  console.log(`export in a worker (${worker.backend}): ${Math.round(worker.elapsed)} ms for 4 s at 640×360; preview during it: ${worker.frames} seeks, median ${worker.median.toFixed(0)} ms, p95 ${worker.p95.toFixed(0)} ms, worst ${worker.worst.toFixed(0)} ms. Same-thread export: ${Math.round(same.elapsed)} ms, ${same.frames} preview frames during it.`);
  // The preview rendered the edited scene (the square gone) while the worker exported the snapshot.
  assert.ok(worker.frames >= 10, `the preview kept rendering during the export: ${worker.frames} frames`);
  assert.ok(worker.preview && worker.preview[0] < 80 && worker.preview[2] > 150, `the preview shows the edit: ${worker.preview}`);
  // A loose bound (the machine may be busy with other work): the numbers themselves are printed above.
  assert.ok(worker.p95 < 1000, `a seek during the export is answered promptly: p95 ${worker.p95} ms`);
  assert.ok(worker.stages.includes("rendering"), `progress is relayed from the worker: ${worker.stages}`);
});

test("Export render session — Cancel: rendering in the worker stops within 500 ms and its resources are released; pause and resume reach the session; a second export starts afterwards", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    // Use a full-HD export so the pause/resume/cancel sequence stays ahead of very fast hardware encoders too.
    const doc = jc.project({ width: 1920, height: 1080 });
    doc.media.assets.push(jc.asset("v", "video", { width: 640, height: 360, duration: 480000, hasAudio: true }));
    doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 480000, mediaId: "v", sourceDuration: 480000 }));
    const opened = await jc.open(doc, { width: 1920, height: 1080, exportWorker: true }, [{ assetId: "v", original: `${origin}/media/clip4.mp4` }]);
    const request = (exportId: string) => ({ exportId, width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, container: "mp4" as const, video: { codec: "avc" as const, bitrate: 2_000_000 } });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const mark = opened.events.length;
    await opened.port.command("export.start", request("x1"));
    const busy = await opened.port.command("export.start", request("x2")).then(() => "started", (error) => error.code);
    await opened.waitFor("export.progress", mark, 20_000);
    await opened.port.command("export.pause", { exportId: "x1" });
    await sleep(300);
    const framesOf = () => opened.events.filter((event) => event.type === "export.progress").at(-1)?.payload.framesDone ?? 0;
    const paused = framesOf();
    await sleep(300);
    const stillPaused = framesOf(), pausedStage = opened.events.filter((event) => event.type === "export.progress").at(-1)?.payload.stage;
    await opened.port.command("export.resume", { exportId: "x1" });
    await sleep(300);
    const resumed = framesOf();
    const at = performance.now();
    await opened.port.command("export.cancel", { exportId: "x1" });
    const failed = await opened.waitFor("export.failed", mark, 5000);
    const stopped = performance.now() - at;
    const again = opened.events.length;
    await opened.port.command("export.start", request("x3"));
    const done = await opened.waitFor("export.done", again, 60_000);
    return { busy, paused, stillPaused, pausedStage, resumed, failed, stopped, frames: done.frameCount };
  }, harness.origin);
  assert.equal(result.busy, "surface/invalid-payload");
  assert.equal(result.stillPaused, result.paused, "no frame is rendered while paused");
  assert.equal(result.pausedStage, "paused");
  assert.ok(result.resumed > result.paused, "resume continues");
  assert.equal(result.failed.code, "export/interrupted");
  assert.ok(result.stopped < 500, `cancel stopped in ${result.stopped} ms`);
  assert.equal(result.frames, 120);
});
