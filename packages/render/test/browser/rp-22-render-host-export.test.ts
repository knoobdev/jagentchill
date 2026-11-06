import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, startHarness, type Harness } from "./harness.ts";
import { RenderHostManager, type RenderHostExportProgress } from "../../../../server/src/render-host/manager.ts";

const repo = resolve(import.meta.dirname, "../../../../");
const w17RunRoot = process.env.W17_TEST_RUN_DIR;
if (w17RunRoot && !/^\.dev\/run-w17[ab](?:-suites-green)?-\d+$/.test(w17RunRoot)) throw new Error("W17_TEST_RUN_DIR must name an owned fresh W17 suite directory.");
const runDir = w17RunRoot ? resolve(repo, w17RunRoot, "render-host-export") : join(repo, ".dev/run-w10h2c-renderhost-isolation-2");
const evidenceDir = process.env.W17_TEST_EVIDENCE_DIR ? resolve(repo, process.env.W17_TEST_EVIDENCE_DIR) : join(repo, ".dev/w10h2-evidence");
const browserPort = Number(process.env.W17_TEST_BROWSER_PORT ?? 18986);
const ffprobe = process.env.JAGENTCHILL_FFPROBE ?? "/usr/local/bin/ffprobe";
const desktop = join(repo, "apps/desktop");
const electron = process.platform === "darwin" ? join(desktop, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  : join(desktop, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
let harness: Harness;
let manager: RenderHostManager;
let doc: Record<string, any>;
let sources: Record<string, unknown>[];
const progressEvents: RenderHostExportProgress[] = [];
const oldHome = process.env.HOME;

before(async () => {
  assert.equal(existsSync(runDir), false, "render-host export run directory is fresh");
  assert.ok(existsSync(electron), "Electron executable exists at " + electron);
  assert.ok(existsSync(ffprobe), "JAGENTCHILL_FFPROBE exists at " + ffprobe);
  mkdirSync(runDir, { recursive: true });
  process.env.JAGENTCHILL_UNATTENDED = "1";
  process.env.HOME = join(runDir, "home");
  process.env.JAGENTCHILL_FFPROBE = ffprobe;
  harness = await startHarness(browserPort, join(runDir, "browser-harness"));
  const first = join(harness.media, "clip-a.mp4"), second = join(harness.media, "clip-b.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x2040c0:s=320x180:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-shortest", first]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x207040:s=320x180:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", second]);
  const fixture = await harness.page.evaluate(() => {
    const jc = (window as any).jc;
    const project = jc.project({ width: 320, height: 180 });
    project.media.assets.push(jc.asset("clip-a", "video", { width: 320, height: 180, duration: 120_000, hasAudio: true }));
    project.media.assets.push(jc.asset("clip-b", "video", { width: 320, height: 180, duration: 120_000, hasAudio: false }));
    project.scenes[0].tracks.main.elements.push(jc.element("video", { id: "clip-a-element", startTime: 0, duration: 120_000, sourceDuration: 120_000, mediaId: "clip-a" }));
    project.scenes[0].tracks.main.elements.push(jc.element("video", { id: "clip-b-element", startTime: 120_000, duration: 120_000, sourceDuration: 120_000, mediaId: "clip-b" }));
    project.scenes[0].tracks.overlay = [jc.track("text", "title-track", [jc.element("text", { id: "title", startTime: 0, duration: 240_000, content: "Host export fixture", fontFamily: "Arial", fontWeight: 700, fontSize: 24, color: "#ffffff", transform: { position: { x: 0, y: -62 }, scale: { x: 1, y: 1 }, rotation: 0 } })])];
    return project;
  });
  doc = fixture;
  sources = [
    { assetId: "clip-a", original: "jagentchill-media://blob/clip-a?path=" + encodeURIComponent(first) + "&mime=video%2Fmp4" },
    { assetId: "clip-b", original: "jagentchill-media://blob/clip-b?path=" + encodeURIComponent(second) + "&mime=video%2Fmp4" },
  ];
  manager = new RenderHostManager({ path: electron, idleMs: 60_000, userDataDir: join(runDir, "render-host", "profile") });
});

after(async () => {
  await manager?.dispose();
  await harness?.close();
  delete process.env.JAGENTCHILL_UNATTENDED;
  delete process.env.JAGENTCHILL_USER_DATA;
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
});

test("render host export.start writes a two-clip text MP4, reports progress, preserves audio and cancels", async () => {
  const output = join(harness.media, "render-host-export.mp4");
  const request = { width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc", bitrate: 1_000_000 }, audio: { codec: "aac", sampleRate: 48_000, channels: 2 }, allowFontFallback: true };
  const result = await manager.exportStart({ exportId: "fixture-export", document: doc, revision: 1, mediaSources: sources, request, outputPath: output, progress: (event) => progressEvents.push(event) });
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_frames", output], { encoding: "utf8" }));
  const video = probe.streams.find((stream: any) => stream.codec_type === "video"), audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
  assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_read_frames), video.r_frame_rate], ["h264", 320, 180, 60, "30/1"]);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.1, `duration ${probe.format.duration}`);
  assert.ok(audio, "the fixture project has audio and the output has an audio stream");
  assert.deepEqual([audio.codec_name, Number(audio.sample_rate), audio.channels], ["aac", 48_000, 2]);
  assert.equal(result.bytes, Number(probe.format.size));
  assert.equal(result.frameCount, 60);
  assert.ok(progressEvents.some((event) => event.stage === "rendering" && event.frameCount === 60));

  await harness.page.evaluate(async (url) => {
    const video = document.createElement("video"); video.src = url; video.muted = true; video.playsInline = true; video.width = 320; video.height = 180;
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("exported mp4 did not load")); });
    video.currentTime = 1.5;
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const title = document.createElement("div"); title.textContent = "Render host export · generated two-clip project · text layer";
    document.body.replaceChildren(video, title); document.body.style.cssText = "margin:0;background:#111;color:#fff;font:14px sans-serif"; title.style.padding = "8px";
  }, "/media/render-host-export.mp4");
  mkdirSync(evidenceDir, { recursive: true });
  await harness.page.screenshot({ path: join(evidenceDir, "render-host-export.png") });

  const cancelOutput = join(harness.media, "render-host-export-cancelled.mp4");
  let cancelSent = false;
  const cancelled = manager.exportStart({ exportId: "fixture-export-cancel", document: doc, revision: 1, mediaSources: sources, request, outputPath: cancelOutput, progress: (event) => {
    if (!cancelSent && event.stage === "rendering" && event.framesDone > 0) { cancelSent = true; void manager.exportCancel("fixture-export-cancel"); }
  } });
  await assert.rejects(cancelled, /export\/interrupted: the export was cancelled/);
  assert.ok(cancelSent, "cancel followed a real render progress event");
  console.log("render-host.export.result", JSON.stringify({ ...result, video: { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_read_frames), fps: video.r_frame_rate, duration: Number(probe.format.duration) }, audio: { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels }, progressEvents: progressEvents.length, cancelSent }));
});
