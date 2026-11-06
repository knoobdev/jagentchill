// The person matte of body effects, from the producer contract to the picture, in headless Chromium: a matte track written by `createPersonMatteWriter` and delivered as `<assetId>:person` is decoded in lock-step with its video; without it the preview skips the effect and an export is refused.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  ffmpeg(["-f", "lavfi", "-i", "color=c=0xff8000:s=640x360:r=30:d=2", "-c:v", "libx264", "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p", join(harness.media, "orange.mp4")]);
});
after(async () => { await harness?.close(); });

test("Body-effect matte inputs — a matte track from the producer contract, delivered as `<assetId>:person`, is decoded in lock-step with the source frame: Background Mono keeps the colour inside the person as the person moves; a still's matte is an image; Matte unavailable: the preview renders without the effect with `matte/unavailable`, an export fails at start with `export/derived-unavailable`", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const SECOND = 120000, W = 320, H = 180;
    // The "person": a disc of radius 40 that travels from x = 80 to x = 240 over the 60 frames of the source.
    const centre = (frame: number) => 80 + (160 * frame) / 59;
    const coverage = (frame: number) => { const out = new Uint8Array(W * H), cx = centre(frame); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - 90) <= 40) out[y * W + x] = 255; return out; };
    const writer = await jc.createPersonMatteWriter({ width: W, height: H, frameRate: { numerator: 30, denominator: 1 } });
    for (let frame = 0; frame < 60; frame++) await writer.add(coverage(frame), frame * 4000);
    const file = await writer.finish();
    const matteUrl = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.mimeType }));
    const entry = jc.personMatteEntry("v", matteUrl, "f".repeat(64));
    const scene = () => {
      const doc = jc.project({ width: 640, height: 360 });
      doc.media.assets.push(jc.asset("v", "video", { width: 640, height: 360, duration: 2 * SECOND, hasAudio: false, fps: { numerator: 30, denominator: 1 } }));
      doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e", startTime: 0, duration: 2 * SECOND, mediaId: "v", sourceDuration: 2 * SECOND, effects: [{ id: "fx", type: "background-mono", kind: "effect", enabled: true, params: {} }] }));
      return doc;
    };
    const sources = [{ assetId: "v", original: `${origin}/media/orange.mp4` }];
    const opened = await jc.open(scene(), { width: 640, height: 360 }, sources, (port) => port.command("derived.setSources", { entries: [entry] }));
    const engine = opened.engine as any;
    await opened.frameAt(0);
    await engine.whenMattesSettled();
    const at = async (frame: number) => { const shot = await opened.frameAt(frame * 4000); const cx = Math.round(centre(frame) * 2); return { inside: shot.at(cx, 180), left: shot.at(cx - 120, 180), right: shot.at(cx + 120, 180), far: shot.at(cx, 20) }; };
    const frames = { early: await at(5), middle: await at(30), late: await at(54), back: await at(12) };
    // Without the matte: the same scene on an engine that was given none.
    const bare = await jc.open(scene(), { width: 640, height: 360 }, sources);
    const plain = await bare.frameAt(30 * 4000);
    const diagnostics = bare.events.filter((event) => event.type === "diagnostic").map((event) => [event.payload.id, event.payload.assetId, event.payload.details?.key]);
    const refused = await bare.port.command("export.start", { exportId: "x", width: 640, height: 360, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc" } }).then(() => null, (error) => ({ code: error.code, details: error.details }));
    // A still: the matte is an image, under the same key form.
    const half = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) half[y * W + x] = 255;
    const stillMatte = URL.createObjectURL(await jc.personMatteStill(half, W, H));
    const orange = await jc.imageUrl(W, H, (c) => { c.fillStyle = "#ff8000"; c.fillRect(0, 0, W, H); });
    const stillDoc = jc.project({ width: 640, height: 360 });
    stillDoc.media.assets.push(jc.asset("i", "image", { width: W, height: H }));
    stillDoc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e", startTime: 0, duration: SECOND, mediaId: "i", effects: [{ id: "fx", type: "background-mono", kind: "effect", enabled: true, params: {} }] }));
    const still = await jc.open(stillDoc, { width: 640, height: 360 }, [{ assetId: "i", original: orange }], (port) => port.command("derived.setSources", { entries: [jc.personMatteEntry("i", stillMatte, "e".repeat(64))] }));
    await still.frameAt(0);
    await (still.engine as any).whenMattesSettled();
    const stillFrame = await still.frameAt(4000);
    return { key: entry.key, mimeType: file.mimeType, bytes: file.data.length, frames, plain: [plain.at(320, 180), plain.at(40, 180)], diagnostics, refused, still: [stillFrame.at(160, 180), stillFrame.at(480, 180)], ok: opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id) };
  }, harness.origin);
  const coloured = (pixel: number[]) => pixel[0] > 200 && pixel[2] < 60, grey = (pixel: number[]) => Math.abs(pixel[0] - pixel[1]) <= 6 && Math.abs(pixel[1] - pixel[2]) <= 6;
  assert.equal(result.key, "v:person");
  console.log(`matte track: ${result.bytes} bytes of ${result.mimeType} for 60 frames at 320×180`);
  // The person keeps its colour where the matte of THAT source frame says it is; the rest is greyscale.
  for (const [name, frame] of Object.entries(result.frames)) {
    assert.ok(coloured(frame.inside), `${name}: the person keeps its colour: ${frame.inside}`);
    assert.ok(grey(frame.left) && grey(frame.right) && grey(frame.far), `${name}: the background is greyscale: ${JSON.stringify(frame)}`);
  }
  assert.deepEqual(result.ok.filter((id: string) => id.startsWith("matte/") || id.startsWith("derived/")), [], "a delivered matte reports nothing");
  // No matte: the layer renders without the effect (all orange), reported once.
  assert.ok(coloured(result.plain[0]) && coloured(result.plain[1]), `the effect is skipped: ${JSON.stringify(result.plain)}`);
  assert.deepEqual(result.diagnostics.filter((entry: unknown[]) => entry[0] === "matte/unavailable"), [["matte/unavailable", "v", "v:person"]]);
  assert.deepEqual(result.refused, { code: "export/derived-unavailable", details: { keys: ["v:person"] } });
  assert.ok(coloured(result.still[0]) && grey(result.still[1]), `a still's matte: ${JSON.stringify(result.still)}`);
});
