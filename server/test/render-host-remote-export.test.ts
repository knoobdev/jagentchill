import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import { RenderHostManager } from "../src/render-host/manager.ts";
import { createRenderHostRemoteExportRenderer } from "../src/export/render-host-adapter.ts";
import { createHarness, type Harness } from "./harness.ts";
import { connect, sha256Hex, support, type Paired } from "./support/sync.ts";
import { ffmpeg, startHarness, type Harness as RenderHarness } from "../../packages/render/test/browser/harness.ts";

const repo = resolve(import.meta.dirname, "../../");
// A directory of its own for each run: named by the suite runner, or a fresh one this run makes and removes.
const ownRunDir = !process.env.W17_TEST_RUN_DIR;
const runDir = process.env.W17_TEST_RUN_DIR ? resolve(repo, process.env.W17_TEST_RUN_DIR) : join(repo, `.dev/run-w10h2c-renderhost-isolation-${process.pid}-${Date.now()}`);
const serverDataDir = join(runDir, "server-data");
const ffprobe = process.env.JAGENTCHILL_FFPROBE ?? "/usr/local/bin/ffprobe";
const evidenceDir = process.env.W17_TEST_EVIDENCE_DIR ? resolve(repo, process.env.W17_TEST_EVIDENCE_DIR) : join(repo, ".dev/w10h2-evidence");
const desktop = join(repo, "apps/desktop");
const electron = process.platform === "darwin" ? join(desktop, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  : join(desktop, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
let h: Harness;
let browser: RenderHarness;
let manager: RenderHostManager;
let admin: Paired;
const oldEnv = { unattended: process.env.JAGENTCHILL_UNATTENDED, userData: process.env.JAGENTCHILL_USER_DATA, port: process.env.JAGENTCHILL_PORT, gatewayPort: process.env.JAGENTCHILL_GATEWAY_PORT };
const oldHome = process.env.HOME;
const hostPort = Number(process.env.JAGENTCHILL_PORT ?? 18950);
const gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT ?? hostPort + 1);
const browserPort = Number(process.env.W17_TEST_BROWSER_PORT ?? hostPort + 2);

before(async () => {
  assert.equal(existsSync(runDir), false, "server and render-host data directory is fresh");
  assert.ok(existsSync(electron), "Electron executable exists at " + electron);
  assert.ok(existsSync(ffprobe), "JAGENTCHILL_FFPROBE exists at " + ffprobe);
  process.env.JAGENTCHILL_UNATTENDED = "1";
  process.env.HOME = join(runDir, "home");
  process.env.JAGENTCHILL_PORT = String(hostPort);
  process.env.JAGENTCHILL_GATEWAY_PORT = String(gatewayPort);
  manager = new RenderHostManager({ path: electron, idleMs: 60_000, userDataDir: join(runDir, "render-host", "profile") });
  const probed = await manager.probe();
  assert.equal(probed.state, "ready", JSON.stringify(probed));
  const renderer = createRenderHostRemoteExportRenderer({ renderHost: manager, blobs: () => h.app.sync.blobs });
  h = await createHarness({ dataDir: serverDataDir, listenPort: hostPort, extra: { remoteExportRenderer: renderer, renderHost: manager } });
  admin = await h.pair("Render host test phone", "admin");
  browser = await startHarness(browserPort, join(runDir, "browser-harness"));
});

after(async () => {
  await browser?.close();
  await h?.stop();
  await manager?.dispose();
  for (const [key, value] of [["JAGENTCHILL_UNATTENDED", oldEnv.unattended], ["JAGENTCHILL_USER_DATA", oldEnv.userData], ["JAGENTCHILL_PORT", oldEnv.port], ["JAGENTCHILL_GATEWAY_PORT", oldEnv.gatewayPort]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (ownRunDir) rmSync(runDir, { recursive: true, force: true });
});

test("device export RPCs render the synced project on Electron, publish progress, store an MP4 blob and serve a signed range", async () => {
  const connection = await connect(admin, "remote-export-device-test");
  assert.equal(connection.ready.features?.["remote-export"], true, "healthy real render host is advertised in ws ready");
  const capabilities = await connection.call("jagentchill.export.capabilities");
  assert.equal(capabilities.encoders.h264.state, "available");
  const projectId = crypto.randomUUID(), sceneId = crypto.randomUUID(), trackId = crypto.randomUUID(), textTrackId = crypto.randomUUID();
  const firstFile = join(browser.media, "rpc-clip-a.mp4"), secondFile = join(browser.media, "rpc-clip-b.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x2040c0:s=320x180:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-shortest", firstFile]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x207040:s=320x180:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", secondFile]);
  const sync = support(h);
  const firstHash = await sync.upload(admin, readFileSync(firstFile), { mime: "video/mp4", name: "generated-blue-with-audio.mp4" });
  const secondHash = await sync.upload(admin, readFileSync(secondFile), { mime: "video/mp4", name: "generated-green-silent.mp4" });
  const document = createProjectDocument({ id: projectId, mainSceneId: sceneId, mainTrackId: trackId, now_ms: Date.now(), name: "RPC render fixture", canvasSize: { width: 320, height: 180 }, fps: { numerator: 30, denominator: 1 }, background: { kind: "color", color: "#204060" } });
  const assets = (document.media as any).assets as any[];
  assets.push({ id: "clip-a", name: "generated-blue-with-audio.mp4", type: "video", size: readFileSync(firstFile).byteLength, contentHash: firstHash, duration: 120_000, width: 320, height: 180, hasAudio: true, created_ms: Date.now() });
  assets.push({ id: "clip-b", name: "generated-green-silent.mp4", type: "video", size: readFileSync(secondFile).byteLength, contentHash: secondHash, duration: 120_000, width: 320, height: 180, hasAudio: false, created_ms: Date.now() });
  document.scenes[0].tracks.main.elements.push(createElement("video", { id: crypto.randomUUID(), name: "Blue clip with audio", startTime: 0, duration: 120_000, sourceDuration: 120_000, mediaId: "clip-a" }));
  document.scenes[0].tracks.main.elements.push(createElement("video", { id: crypto.randomUUID(), name: "Green clip", startTime: 120_000, duration: 120_000, sourceDuration: 120_000, mediaId: "clip-b" }));
  const titleTrack = createTrack("text", { id: textTrackId, name: "Title" });
  titleTrack.elements.push(createElement("text", { id: crypto.randomUUID(), name: "RPC title", startTime: 0, duration: 240_000, content: "Remote export RPC", fontFamily: "Arial", fontWeight: 700, fontSize: 24, color: "#ffffff", transform: { position: { x: 0, y: -48 }, scale: { x: 1, y: 1 }, rotation: 0 } }));
  document.scenes[0].tracks.overlay.push(titleTrack);
  document.metadata.duration = 240_000;
  const docRef = await sync.enable(admin, document);
  const settings = { type: "video", resolution: { mode: "project", width: 320, height: 180 }, frameRate: "project", bitrateLevel: "recommended", customMbps: 10, videoCodec: "h264", container: "mp4", hardwareAcceleration: "auto", includeAudio: true, audioCodec: "aac", audioBitrateKbps: 192, sampleRate: 48_000, channels: 2, burnCaptions: false, aiLabel: false };
  const created = await connection.call("jagentchill.export.create", { projectId: docRef.id, revision: 1, sceneId, range: { start: 0, end: 240_000 }, settings, idempotencyKey: crypto.randomUUID() });
  await connection.call("jagentchill.export.subscribe", { jobId: created.jobId });
  const deadline = Date.now() + 30_000;
  let job: any;
  do {
    await new Promise((resolve) => setTimeout(resolve, 40));
    job = await connection.call("jagentchill.export.get", { jobId: created.jobId });
  } while (!["succeeded", "failed", "cancelled"].includes(job.state) && Date.now() < deadline);
  assert.equal(job.state, "succeeded", JSON.stringify(job));
  assert.ok(connection.events.some((event) => event.payload?.jobId === created.jobId && event.payload?.stage === "rendering"), "device received a rendering progress update");
  const stored = h.app.sync.blobs.read(job.output.sha256);
  assert.equal(sha256Hex(stored), job.output.sha256);
  assert.equal(stored.subarray(4, 8).toString(), "ftyp");
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_frames", h.app.sync.blobs.locate(job.output.sha256).path], { encoding: "utf8" }));
  const video = probe.streams.find((stream: any) => stream.codec_type === "video");
  const audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
  assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_read_frames), video.r_frame_rate], ["h264", 320, 180, 60, "30/1"]);
  assert.ok(audio, "the two-clip blob export retains the source audio stream");
  assert.deepEqual([audio.codec_name, Number(audio.sample_rate), audio.channels], ["aac", 48_000, 2]);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.1, `duration ${probe.format.duration}`);
  const ranged = await sync.send(admin, "GET", `/jagentchill/v1/exports/${created.jobId}/file`, undefined, { range: "bytes=0-63" });
  assert.equal(ranged.status, 206);
  assert.equal((ranged.body as Uint8Array).byteLength, 64);
  assert.ok(Buffer.from(ranged.body as Uint8Array).equals(stored.subarray(0, 64)), "signed range bytes match the stored blob prefix");
  const fixture = join(browser.media, "remote-export-rpc.mp4");
  writeFileSync(fixture, stored);
  await browser.page.evaluate(async () => {
    const pageDocument = (window as any).document;
    const video = pageDocument.createElement("video"); video.src = "/media/remote-export-rpc.mp4"; video.muted = true; video.width = 320; video.height = 180;
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("remote RPC export blob did not load")); });
    video.currentTime = 1.5; await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const label = pageDocument.createElement("div"); label.textContent = "Device export RPC · two generated clips + source audio · blob-store MP4";
    pageDocument.body.replaceChildren(video, label); pageDocument.body.style.cssText = "margin:0;background:#111;color:#fff;font:14px sans-serif"; label.style.padding = "8px";
  });
  mkdirSync(evidenceDir, { recursive: true });
  await browser.page.screenshot({ path: join(evidenceDir, "remote-export-rpc.png") });
  console.log("render-host.remote-export.rpc", JSON.stringify({ state: job.state, blobBytes: stored.byteLength, sha256: job.output.sha256, rangeStatus: ranged.status, rangeBytes: (ranged.body as Uint8Array).byteLength, video: { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_read_frames), duration: Number(probe.format.duration) } }));
  await connection.close();
});

test("preview frame and render RPCs return a revision JPEG and cache a low-resolution MP4 blob", async () => {
  assert.equal((await manager.probe()).state, "ready", "the real Electron render host answers a fresh probe");
  const connection = await connect(admin, "preview-rpc-device-test");
  const projectId = crypto.randomUUID(), sceneId = crypto.randomUUID(), trackId = crypto.randomUUID();
  const document = createProjectDocument({ id: projectId, mainSceneId: sceneId, mainTrackId: trackId, now_ms: Date.now(), name: "Preview RPC fixture", canvasSize: { width: 320, height: 180 }, fps: { numerator: 30, denominator: 1 }, background: { kind: "color", color: "#703020" } });
  document.metadata.duration = 240_000;
  const sync = support(h), docRef = await sync.enable(admin, document);
  const frame = await connection.call("jagentchill.preview.frame", { projectId: docRef.id, sceneId, time: 1, width: 160 });
  assert.deepEqual([frame.revision, frame.width, frame.mime], [1, 160, "image/jpeg"]);
  const jpeg = Buffer.from(frame.jpeg, "base64");
  assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const preview = await connection.call("jagentchill.preview.render", { projectId: docRef.id, sceneId, range: { start: 0, end: 1 }, height: 90 });
  assert.deepEqual([preview.revision, preview.width, preview.height, preview.mime, preview.cached], [1, 160, 90, "video/mp4", false]);
  const file = h.app.sync.blobs.locate(preview.sha256);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_frames", file.path], { encoding: "utf8" }));
  const video = probe.streams.find((stream: any) => stream.codec_type === "video");
  assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_read_frames), video.r_frame_rate], ["h264", 160, 90, 15, "15/1"]);
  const cached = await connection.call("jagentchill.preview.render", { projectId: docRef.id, sceneId, range: { start: 0, end: 1 }, height: 90 });
  assert.equal(cached.cached, true);
  assert.equal(cached.sha256, preview.sha256);
  assert.equal((await connection.call("jagentchill.blob.get", { sha256: preview.sha256 })).refCount, 1, "preview output remains referenced by its cache job");
  await connection.call("jagentchill.preview.render", { projectId: docRef.id, sceneId, range: { start: 0, end: 1 }, height: 90 });
  await assert.rejects(connection.call("jagentchill.preview.render", { projectId: docRef.id, sceneId, range: { start: 0, end: 1 }, height: 90 }), /RATE_LIMITED/);
  const ranged = await sync.send(admin, "GET", `/jagentchill/v1/blobs/${preview.sha256}`, undefined, { range: "bytes=0-63" });
  assert.equal(ranged.status, 206);
  assert.equal((ranged.body as Uint8Array).byteLength, 64);
  assert.ok(Buffer.from(ranged.body as Uint8Array).equals(h.app.sync.blobs.read(preview.sha256).subarray(0, 64)));

  writeFileSync(join(browser.media, "preview-render-rpc.mp4"), h.app.sync.blobs.read(preview.sha256));
  await browser.page.evaluate(async ({ jpegUrl }) => {
    const pageDocument = globalThis.document as Document;
    const image = pageDocument.createElement("img"); image.src = jpegUrl;
    const video = pageDocument.createElement("video"); video.src = "/media/preview-render-rpc.mp4"; video.muted = true;
    await Promise.all([
      new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("preview JPEG did not load")); }),
      new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("preview MP4 did not load")); }),
    ]);
    video.currentTime = 0.5; await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const label = pageDocument.createElement("div"); label.textContent = "Preview frame + revision 1 low-resolution render · generated project fixture";
    pageDocument.body.replaceChildren(label, image, video); pageDocument.body.style.cssText = "margin:0;background:#111;color:#fff;font:14px sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:12px"; label.style.cssText = "padding:8px;grid-column:1/-1"; image.style.cssText = video.style.cssText = "width:100%;max-height:80vh;object-fit:contain";
  }, { jpegUrl: `data:image/jpeg;base64,${frame.jpeg}` });
  mkdirSync(evidenceDir, { recursive: true });
  await browser.page.screenshot({ path: join(evidenceDir, "preview-rpc.png") });
  console.log("render-host.preview.rpc", JSON.stringify({ revision: preview.revision, jpegBytes: jpeg.byteLength, mp4Bytes: preview.size, sha256: preview.sha256, cached: cached.cached, rangeStatus: ranged.status, rangeBytes: (ranged.body as Uint8Array).byteLength, video: { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_read_frames), fps: video.r_frame_rate, duration: Number(probe.format.duration) } }));
  await connection.close();
});
