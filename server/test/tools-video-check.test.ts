import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { S, toolWorld } from "./support/tools.ts";

test("jc_video_check is read-only, samples the scene, and reports measured text geometry, declared-color contrast and main-track gaps", async () => {
  const w = await toolWorld({ empty: true, toolSurface: "editor", canvas: { width: 1080, height: 1920 } });
  const before = w.revision();
  const clean = await w.ok("jc_video_check");
  assert.equal(clean.data.sceneId, w.project.sceneId);
  assert.deepEqual(clean.data.sampledTimes, [0]);
  assert.equal(clean.data.findings.length, 0);
  assert.equal(w.revision(), before, "self-check leaves the project unchanged");

  await w.write("jc_text_add", { content: "A deliberately long title that extends past the right side", start: 0, duration: 2 * S, position: { x: 700, y: 800 }, style: { fontSize: 72, color: "#000000" } });
  const checked = await w.ok("jc_video_check", { range: { start: 0, end: 2 * S } });
  const findings = checked.data.findings as Array<{ kind: string; box?: { x: number; y: number; width: number; height: number }; times: number[]; message: string }>;
  const offCanvas = findings.find((finding) => finding.kind === "off_canvas");
  const contrast = findings.find((finding) => finding.kind === "low_contrast");
  assert.ok(offCanvas, "off-canvas title is found");
  assert.deepEqual([offCanvas.box?.x, offCanvas.box?.width], [808, 864]);
  assert.deepEqual(offCanvas.times.slice(0, 2), [0, 1]);
  assert.match(contrast?.message ?? "", /1\.00:1.*3:1/);
  assert.equal(checked.data.sampleCount, 3);
  assert.equal(w.revision(), before, "checking the staged fixture does not commit it or change the synced revision");
  w.close();
});

test("jc_video_check samples rendered frames, measures contrast from rendered pixels, and returns a cropped PNG", async () => {
  const fixture = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=768x1365", "-vf", "drawtext=text='Measured title':fontcolor=white:fontsize=51:x=(w-text_w)/2:y=(h-text_h)/2", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
  const w = await toolWorld({ empty: true, toolSurface: "editor", canvas: { width: 1080, height: 1920 }, harness: { extra: { renderHost: { available: () => true, renderStill: async () => fixture } as never } } });
  await w.write("jc_text_add", { content: "Measured title", start: 0, duration: 2 * S, position: { x: 0, y: 0 }, style: { fontSize: 72, color: "#ffffff" } });
  const proposal = await w.submit("Rendered fixture");
  await w.accept(proposal);
  const result = await w.h.app.tools.call(w.sessionKey, "jc_video_check", { range: { start: 0, end: 2 * S } });
  assert.equal(result.envelope.ok, true);
  const findings = (result.envelope as any).data.findings as Array<{ kind: string; message: string; imageIndex?: number }>;
  const contrast = findings.find((finding) => finding.kind === "low_contrast");
  assert.match(contrast?.message ?? "", /Rendered-pixel text contrast is 1\.06:1/);
  assert.ok(Number.isInteger(contrast?.imageIndex), "the contrast finding links its rendered crop");
  const image = result.images[contrast!.imageIndex!];
  assert.equal(image?.mime, "image/png");
  const dir = join(process.cwd(), "../.dev/orc/screenshots");
  mkdirSync(dir, { recursive: true });
  const screenshot = join(dir, "w22a-rendered-contrast-crop.png");
  writeFileSync(screenshot, Buffer.from(image!.dataBase64, "base64"));
  assert.ok(Buffer.from(image!.dataBase64, "base64").subarray(1, 4).toString() === "PNG", "crop is a decoded PNG artifact");
  console.log(`jc_video_check screenshot: ${screenshot}`);
  w.close();
});
