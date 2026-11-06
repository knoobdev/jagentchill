import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { RenderHostManager } from "../src/render-host/manager.ts";
import { key, toolWorld } from "./support/tools.ts";

const repo = resolve(import.meta.dirname, "../..");
// A fresh directory of its own for each run, removed at the end.
const runDir = join(repo, `.dev/run-w22d-${process.pid}-${Date.now()}/tool-e2e`);
// A fixed loopback port of the range tests may use.
const PORT = 18953;
const electron = join(repo, "apps/desktop/node_modules/electron/dist", process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron");
const ffmpeg = process.env.JAGENTCHILL_FFMPEG ?? execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
const ffprobe = process.env.JAGENTCHILL_FFPROBE ?? execFileSync("which", ["ffprobe"], { encoding: "utf8" }).trim();
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}div{position:absolute;left:40px;top:40px;width:64px;height:64px;background:#ff4f87}</style></head><body><div></div><script>window.__jcSeek=async(seconds)=>{document.querySelector('div').style.left=(40+seconds*80)+'px'}</script></body></html>`;

test("jc_motion_scene runs through the real tool service, imports the rendered media and stages the requested clip", { timeout: 120_000 }, async () => {
  assert.equal(existsSync(runDir), false, "the tool end-to-end run directory is fresh");
  assert.ok(existsSync(electron));
  mkdirSync(runDir, { recursive: true });
  const previous = { home: process.env.HOME, ffmpeg: process.env.JAGENTCHILL_FFMPEG, ffprobe: process.env.JAGENTCHILL_FFPROBE, port: process.env.JAGENTCHILL_PORT, gateway: process.env.JAGENTCHILL_GATEWAY_PORT };
  process.env.HOME = join(runDir, "home");
  process.env.JAGENTCHILL_FFMPEG = ffmpeg;
  process.env.JAGENTCHILL_FFPROBE = ffprobe;
  process.env.JAGENTCHILL_PORT = String(PORT);
  process.env.JAGENTCHILL_GATEWAY_PORT = String(PORT + 1);
  process.argv.push("--port", String(PORT));
  const manager = new RenderHostManager({ path: electron, userDataDir: join(runDir, "render-host", "profile"), idleMs: 600_000 });
  let world: Awaited<ReturnType<typeof toolWorld>> | undefined;
  try {
    world = await toolWorld({ empty: true, canvas: { width: 320, height: 180 }, harness: { dataDir: join(runDir, "data"), listenPort: PORT, extra: { renderHost: manager } } });
    const result = await world.ok("jc_motion_scene", { action: "render", name: "tool-fixture", html, durationSeconds: 1, placement: { startSeconds: 0.5 }, idempotencyKey: key() });
    assert.equal(result.data.kind, "video");
    assert.equal(result.data.frameCount, 30);
    assert.equal(result.data.width, 320);
    assert.equal(result.data.height, 180);
    assert.equal(result.data.placement.startSeconds, 0.5);
    assert.ok(result.proposalId);
    assert.equal(result.changeIds?.length, 1);
    const scene = world.scene(await world.proposed());
    const clip = [...scene.tracks.main.elements, ...scene.tracks.overlay.flatMap((track: any) => track.elements)].find((element: any) => element.id === result.data.placement.elementIds[0]);
    assert.ok(clip, "the optional clip placement is staged in the proposal");
    assert.equal(clip.startTime, 60_000);
    const asset = (await world.ok("jc_media_get", { assetId: result.data.assetId })).data.asset;
    assert.equal(asset.kind, "video");
    assert.equal(asset.duration, 120_000);
    assert.equal(asset.provenance.source, "derived");
    console.log("motion-scene.tool", JSON.stringify({ assetId: asset.id, frames: result.data.frameCount, bytes: result.data.bytes, duration: asset.duration, clipStart: clip.startTime, proposalId: result.proposalId }));
  } finally {
    await world?.close();
    await manager.dispose();
    rmSync(join(runDir, ".."), { recursive: true, force: true });
    if (previous.home === undefined) delete process.env.HOME; else process.env.HOME = previous.home;
    if (previous.ffmpeg === undefined) delete process.env.JAGENTCHILL_FFMPEG; else process.env.JAGENTCHILL_FFMPEG = previous.ffmpeg;
    if (previous.ffprobe === undefined) delete process.env.JAGENTCHILL_FFPROBE; else process.env.JAGENTCHILL_FFPROBE = previous.ffprobe;
    if (previous.port === undefined) delete process.env.JAGENTCHILL_PORT; else process.env.JAGENTCHILL_PORT = previous.port;
    if (previous.gateway === undefined) delete process.env.JAGENTCHILL_GATEWAY_PORT; else process.env.JAGENTCHILL_GATEWAY_PORT = previous.gateway;
  }
});
