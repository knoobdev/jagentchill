import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { ffprobe, startHarness, type Harness } from "./harness.ts";
import { RenderHostManager } from "../../../../server/src/render-host/manager.ts";
import { sceneHtmlForRender } from "../../../../server/src/render-host/motion-scene.ts";

const repo = resolve(import.meta.dirname, "../../../../");
const runRoot = resolve(repo, process.env.W22D_TEST_RUN_DIR ?? ".dev/run-w22d-1");
if (!runRoot.startsWith(join(repo, ".dev/run-w22d-"))) throw new Error("W22D_TEST_RUN_DIR must be inside this coder's .dev/run-w22d-N directory.");
const runDir = join(runRoot, "motion-scene-composite");
const evidenceDir = join(runDir, "evidence");
const profileDir = join(runDir, "render-host", "profile");
const browserPort = Number(process.env.W22D_TEST_BROWSER_PORT ?? 18940);
const desktop = join(repo, "apps/desktop");
const electron = join(desktop, "node_modules/electron/dist", process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron");
const ffmpeg = process.env.JAGENTCHILL_FFMPEG ?? execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
const oldHome = process.env.HOME, oldUnattended = process.env.JAGENTCHILL_UNATTENDED;
let harness: Harness;
let host: RenderHostManager;

const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:16px sans-serif;color:white}
#square{position:absolute;left:40px;top:48px;width:48px;height:48px;background:#ff4f87;border-radius:8px}
#label{position:absolute;left:20px;top:130px;background:#17213a;padding:6px 10px}
</style></head><body><div id="square"></div><div id="label">MOTION FIXTURE</div><script>
window.__jcSeek=async(seconds)=>{document.getElementById('square').style.left=(40+seconds*120)+'px';if(!window.checked){window.checked=true;try{await fetch('https://example.invalid/scene-probe')}catch{document.getElementById('label').textContent='MOTION FIXTURE · NETWORK BLOCKED'}}};
</script></body></html>`;

before(async () => {
  assert.equal(existsSync(runDir), false, "the motion scene browser run directory is fresh");
  assert.ok(existsSync(electron), "Electron executable is available");
  mkdirSync(runDir, { recursive: true });
  process.env.JAGENTCHILL_UNATTENDED = "1";
  process.env.HOME = join(runDir, "home");
  process.env.JAGENTCHILL_PORT = String(browserPort);
  process.env.JAGENTCHILL_GATEWAY_PORT = String(browserPort + 1);
  process.argv.push("--port", String(browserPort));
  harness = await startHarness(browserPort, join(runDir, "browser-harness"));
  host = new RenderHostManager({ path: electron, userDataDir: profileDir, idleMs: 600_000 });
});

after(async () => {
  await host?.dispose();
  await harness?.close();
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldUnattended === undefined) delete process.env.JAGENTCHILL_UNATTENDED; else process.env.JAGENTCHILL_UNATTENDED = oldUnattended;
});

test("HTML motion scene imports and composites as a transparent video clip over the project background", { timeout: 120_000 }, async () => {
  const scenePath = join(harness.media, "motion-scene.webm");
  const render = await host.renderMotionScene({ requestId: "w22d-composite", html: sceneHtmlForRender(fixtureHtml), width: 320, height: 180, durationSeconds: 1, fps: 6, outputPath: scenePath, ffmpegPath: ffmpeg });
  assert.equal(render.frameCount, 6);
  const fixture = await harness.page.evaluate(async () => {
    const jc = (window as any).jc;
    const document = jc.project({ width: 320, height: 180 }, { kind: "color", color: "#204060" });
    document.media.assets.push(jc.asset("motion-scene", "video", { width: 320, height: 180, duration: 120_000, hasAudio: false }));
    document.scenes[0].tracks.main.elements.push(jc.element("video", { id: "motion-scene-clip", startTime: 0, duration: 120_000, sourceDuration: 120_000, mediaId: "motion-scene" }));
    return document;
  });
  const opened = await harness.page.evaluate(async ({ doc, source }) => {
    const jc = (window as any).jc;
    const opened = await jc.open(doc, { width: 320, height: 180 }, [{ assetId: "motion-scene", original: source }]);
    const frame = await opened.frameAt(40_000);
    document.body.style.cssText = "margin:0;background:#111;color:white;font:13px sans-serif";
    const label = document.createElement("div"); label.textContent = "Timeline preview · generated fixture WebM · transparent scene over #204060"; label.style.padding = "8px"; document.body.append(label);
    return { pixels: Array.from(frame.pixels as Uint8Array), width: frame.size.width, height: frame.size.height, backend: opened.ready().backend };
  }, { doc: fixture, source: harness.origin + "/media/motion-scene.webm" });
  const at = (x: number, y: number) => opened.pixels.slice((y * opened.width + x) * 4, (y * opened.width + x) * 4 + 4);
  const background = at(5, 5), square = at(100, 70);
  assert.ok(Math.abs(background[0] - 32) <= 8 && Math.abs(background[1] - 64) <= 8 && Math.abs(background[2] - 96) <= 8, `transparent corner composites to the project background: ${background}`);
  assert.ok(square[0] > 230 && square[1] < 110 && square[2] > 90 && square[3] === 255, `opaque moving square draws over the background: ${square}`);
  mkdirSync(evidenceDir, { recursive: true });
  const screenshot = join(evidenceDir, "motion-scene-composite.png");
  await harness.page.screenshot({ path: screenshot });
  assert.ok(existsSync(screenshot));
  const exportPath = join(runDir, "motion-scene-export.mp4");
  const mediaSources = [{ assetId: "motion-scene", original: "jagentchill-media://blob/motion-scene?path=" + encodeURIComponent(scenePath) + "&mime=video%2Fwebm" }];
  const exported = await host.exportStart({ exportId: "w22d-motion-export", document: fixture as unknown as Record<string, any>, revision: 1, mediaSources, request: { width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc", bitrate: 1_000_000 }, audio: { codec: "aac", sampleRate: 48_000, channels: 2 }, allowFontFallback: true }, outputPath: exportPath });
  const probe = ffprobe(exportPath), video = probe.streams.find((stream: any) => stream.codec_type === "video");
  assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_read_frames)], ["h264", 320, 180, 30]);
  const exportedFrame = execFileSync(ffmpeg, ["-v", "error", "-i", exportPath, "-vf", "select=eq(n\\,15)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
  const exportedBackground = Array.from(exportedFrame.subarray((5 * 320 + 5) * 4, (5 * 320 + 5) * 4 + 4));
  const exportedSquare = Array.from(exportedFrame.subarray((70 * 320 + 100) * 4, (70 * 320 + 100) * 4 + 4));
  assert.ok(Math.abs(exportedBackground[0] - 32) <= 12 && Math.abs(exportedBackground[1] - 64) <= 12 && Math.abs(exportedBackground[2] - 96) <= 12, `export retains background under transparent pixels: ${exportedBackground}`);
  assert.ok(exportedSquare[0] > 220 && exportedSquare[1] < 130 && exportedSquare[3] === 255, `export retains the motion-scene overlay: ${exportedSquare}`);
  console.log("motion-scene.preview-export", JSON.stringify({ frames: render.frameCount, bytes: render.bytes, previewSize: [opened.width, opened.height], backend: opened.backend, backgroundPixel: background, squarePixel: square, export: { frames: Number(video.nb_read_frames), codec: video.codec_name, duration: probe.format.duration, backgroundPixel: exportedBackground, squarePixel: exportedSquare }, screenshot }));
});
