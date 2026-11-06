import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { RenderHostManager } from "../src/render-host/manager.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const runDir = join(repoRoot, ".dev/run-w22d-1");
const electron = join(repoRoot, "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const ffmpeg = process.env.JAGENTCHILL_FFMPEG ?? execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
const ffprobe = process.env.JAGENTCHILL_FFPROBE ?? execFileSync("which", ["ffprobe"], { encoding: "utf8" }).trim();
const sceneHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:16px sans-serif;color:white}
#square{position:absolute;left:40px;top:48px;width:48px;height:48px;background:#ff4f87;border-radius:8px}
#label{position:absolute;left:20px;top:130px;background:#17213a;padding:6px 10px}
</style></head><body><div id="square"></div><div id="label">MOTION FIXTURE</div><script>
window.__jcSeek=async(seconds)=>{
  document.getElementById('square').style.left=(40+seconds*120)+'px';
  if(!window.checked){window.checked=true;try{await fetch('https://example.invalid/scene-probe')}catch{document.getElementById('label').textContent='MOTION FIXTURE · NETWORK BLOCKED'}}
  document.documentElement.dataset.seek=String(seconds);
};
</script></body></html>`;

function decodedFrame(path: string, frame: number): Buffer {
  return execFileSync(ffmpeg, ["-v", "error", "-c:v", "libvpx-vp9", "-i", path, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 });
}

test("render host encodes deterministic transparent motion scenes, blocks fetch and reports exact frame metadata", { timeout: 150_000 }, async () => {
  assert.ok(existsSync(electron), `Electron executable exists: ${electron}`);
  mkdirSync(join(runDir, "data"), { recursive: true });
  const outputA = join(runDir, "motion-a.webm"), outputB = join(runDir, "motion-b.webm");
  const host = new RenderHostManager({ path: electron, userDataDir: join(runDir, "render-host", "profile"), idleMs: 600_000 });
  try {
    const first = await host.renderMotionScene({ requestId: "motion-fixture-a", html: sceneHtml, width: 320, height: 180, durationSeconds: 1, fps: 6, outputPath: outputA, ffmpegPath: ffmpeg });
    const second = await host.renderMotionScene({ requestId: "motion-fixture-b", html: sceneHtml, width: 320, height: 180, durationSeconds: 1, fps: 6, outputPath: outputB, ffmpegPath: ffmpeg });
    assert.equal(first.frameCount, 6);
    assert.equal(first.width, 320);
    assert.equal(first.height, 180);
    assert.equal(second.frameCount, first.frameCount);
    const details = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,pix_fmt:stream_tags=alpha_mode", "-of", "json", outputA], { encoding: "utf8" })) as { streams: Array<{ width: number; height: number; nb_read_frames: string; pix_fmt: string; tags?: { alpha_mode?: string; ALPHA_MODE?: string } }> };
    assert.equal(details.streams[0].width, 320);
    assert.equal(details.streams[0].height, 180);
    assert.equal(Number(details.streams[0].nb_read_frames), 6);
    assert.equal(details.streams[0].tags?.alpha_mode ?? details.streams[0].tags?.ALPHA_MODE, "1");
    const frameA = decodedFrame(outputA, 2), frameB = decodedFrame(outputB, 2);
    assert.deepEqual(frameA, frameB);
    assert.equal(frameA[3], 0, "the uncovered canvas pixel keeps transparency");
    assert.ok(frameA[(80 * 320 + 120) * 4 + 3] > 200, "the moving square is opaque over the transparent canvas");
    const screenshot = join(runDir, "motion-scene-frame.png");
    execFileSync(ffmpeg, ["-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", outputA, "-vf", "select=eq(n\\,2)", "-frames:v", "1", screenshot]);
    assert.ok(existsSync(screenshot));
  } finally { await host.dispose(); }
});

test("motion scene cancel stops a live frame job", { timeout: 60_000 }, async () => {
  mkdirSync(join(runDir, "data"), { recursive: true });
  const host = new RenderHostManager({ path: electron, userDataDir: join(runDir, "render-host-cancel", "profile"), idleMs: 600_000 });
  const requestId = "motion-fixture-cancel";
  let requested = false;
  try {
    await assert.rejects(host.renderMotionScene({ requestId, html: sceneHtml, width: 320, height: 180, durationSeconds: 30, fps: 40, outputPath: join(runDir, "cancel.webm"), ffmpegPath: ffmpeg, progress: (progress) => {
      if (!requested && progress.framesDone >= 2) { requested = true; void host.cancelMotionScene(requestId); }
    } }), /cancel/i);
    assert.ok(requested, "the render had started and emitted frame progress before cancellation");
  } finally { await host.dispose(); }
});
