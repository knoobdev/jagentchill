// Decodes frames of a real H.264 file (generated with ffmpeg) through the engine and checks which frame is shown.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  // 2 s at 30 fps, 320×180. Frame N is a flat grey of luma 16 + 3N (BT.709, limited range), so the grey level of
  // a decoded pixel names the source frame: RGB = 3N × 255 / 219. A 440 Hz tone is the audio track.
  ffmpeg(["-f", "lavfi", "-i", "color=black:s=320x180:r=30:d=2,format=yuv420p,geq=lum='16+3*N':cb=128:cr=128", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v", "libx264", "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-ac", "2", "-shortest", join(harness.media, "frames.mp4")]);
  // One second of limited-range white (Y = 235).
  ffmpeg(["-f", "lavfi", "-i", "color=black:s=64x64:r=30:d=1,format=yuv420p,geq=lum=235:cb=128:cr=128", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", join(harness.media, "white.mp4")]);
});
after(async () => { await harness?.close(); });

/** The source frame a grey pixel belongs to. The encoder stores these flat frames one luma code low (measured with ffmpeg). */
const frameOf = (pixel: number[]): number => Math.round((((pixel[0] + pixel[1] + pixel[2]) / 3) * 219 / 255 + 1) / 3);

test("Video decode — frames of a real H.264 file are decoded at the mapped source time (trim, constant 2× speed, reverse, freeze)", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const make = async (fields: Record<string, unknown>) => {
      const doc = jc.project({ width: 320, height: 180 });
      doc.media.assets.push(jc.asset("v", "video", { width: 320, height: 180, duration: 240000, fps: { numerator: 30, denominator: 1 }, hasAudio: true }));
      doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 120000, mediaId: "v", sourceDuration: 240000, ...fields }));
      return jc.open(doc, { width: 320, height: 180 }, [{ assetId: "v", original: `${origin}/media/frames.mp4` }]);
    };
    const grey = async (opened: Awaited<ReturnType<typeof make>>, time: number) => (await opened.frameAt(time)).at(160, 90);
    const plain = await make({ duration: 240000 });
    const out: Record<string, number[][]> = { plain: [], trimmed: [], fast: [], reversed: [], frozen: [] };
    for (const frame of [0, 1, 7, 30, 59]) out.plain.push(await grey(plain, frame * 4000));
    // Sequential playback performs one key-frame seek: frames 0…29 one after another.
    const sequential = await make({ duration: 240000 });
    for (let frame = 0; frame < 30; frame++) await grey(sequential, frame * 4000);
    const seeks = sequential.engine.decodeCounters("v")!.seeks;
    const openBefore = sequential.engine.openVideoFrames;
    await sequential.port.command("engine.dispose", {});
    const openAfter = sequential.engine.openVideoFrames;
    const trimmed = await make({ trimStart: 120000, trimEnd: 0 });
    for (const frame of [0, 10]) out.trimmed.push(await grey(trimmed, frame * 4000));
    // Rate 2 over the whole 2 s source: a 1 s element.
    const fast = await make({ retime: { rate: 2, maintainPitch: false, reverse: false, smooth: "none" } });
    for (const frame of [0, 5, 29]) out.fast.push(await grey(fast, frame * 4000));
    const reversed = await make({ duration: 240000, retime: { rate: 1, maintainPitch: false, reverse: true, smooth: "none" } });
    for (const frame of [0, 1, 59]) out.reversed.push(await grey(reversed, frame * 4000));
    const frozen = await make({ sourceDuration: undefined, mediaId: undefined, freeze: { mediaId: "v", sourceTime: 180000 } });
    for (const frame of [0, 20]) out.frozen.push(await grey(frozen, frame * 4000));
    return { out, seeks, openBefore, openAfter, statuses: plain.events.filter((event) => event.type === "media.status").map((event) => event.payload.assets[0]) };
  }, harness.origin);
  assert.deepEqual(result.out.plain.map(frameOf), [0, 1, 7, 30, 59], `grey levels ${JSON.stringify(result.out.plain)}`);
  assert.deepEqual(result.out.trimmed.map(frameOf), [30, 40], "trimStart 1 s");
  assert.deepEqual(result.out.fast.map(frameOf), [0, 10, 58], "constant 2× speed");
  assert.deepEqual(result.out.reversed.map(frameOf), [59, 58, 0], "reversed: the last source frame first, the frame at S0 last");
  assert.deepEqual(result.out.frozen.map(frameOf), [45, 45], "freeze at source time 1.5 s");
  assert.equal(result.seeks, 1, "Sequential playback does not seek: exactly one key-frame seek at the start");
  assert.ok(result.openBefore >= 1);
  assert.equal(result.openAfter, 0, "No leaked frames: the count of open frames owned by the engine is 0 after dispose");
  assert.deepEqual(result.statuses[0], { assetId: "v", status: "ready", using: "original" });
  assert.deepEqual(harness.errors, []);
});

test("Colour management — Limited-range decode", { skip }, async () => {
  const pixel = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const doc = jc.project({ width: 64, height: 64 });
    doc.media.assets.push(jc.asset("w", "video", { width: 64, height: 64, duration: 120000 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 120000, mediaId: "w", sourceDuration: 120000 }));
    const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "w", original: `${origin}/media/white.mp4` }]);
    return (await opened.frameAt(40000)).at(32, 32);
  }, harness.origin);
  // The encoder may move a flat frame by one code value, hence ±3 instead of the ±1 of an exact Y = 235.
  assert.ok(pixel.slice(0, 3).every((channel) => Math.abs(channel - 255) <= 3), `Y = 235 decodes to white: ${pixel}`);
});

test("Missing or undecodable media — Offline tile in preview; Export with missing media allowed", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const doc = jc.project({ width: 64, height: 64 }, { kind: "color", color: "#102030" });
    doc.media.assets.push(jc.asset("gone", "video", { width: 64, height: 64, duration: 120000 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 120000, mediaId: "gone", sourceDuration: 120000 }));
    const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "gone", original: `${origin}/media/absent.mp4` }]);
    const frame = await opened.frameAt(0);
    const colours = new Set<string>();
    for (let y = 2; y < 64; y += 3) for (let x = 2; x < 64; x += 3) colours.add(frame.at(x, y).slice(0, 3).join(","));
    // A still that allows missing media: the clip contributes no pixels.
    const stills: Uint8Array[] = [];
    opened.port.on("still.done", (_payload, transfer) => { stills.push(new Uint8Array(transfer![0])); });
    await opened.port.command("still.render", { requestId: "s1", time: 0, source: "original", allowMissingMedia: true });
    await opened.waitFor("still.done");
    const bitmap = await createImageBitmap(new Blob([stills[0] as BlobPart], { type: "image/png" }));
    const canvas = new OffscreenCanvas(64, 64);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const still = Array.from(canvas.getContext("2d")!.getImageData(32, 32, 1, 1).data);
    const failMark = opened.events.length;
    await opened.port.command("still.render", { requestId: "s2", time: 0, source: "original" });
    const failed = await opened.waitFor("still.failed", failMark);
    return { colours: [...colours], still, failed, status: opened.events.filter((event) => event.type === "media.status").map((event) => event.payload.assets[0]), diagnostics: opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload) };
  }, harness.origin);
  assert.deepEqual(result.status, [{ assetId: "gone", status: "missing" }]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].id, "media/unavailable");
  assert.equal(result.diagnostics[0].assetId, "gone");
  assert.ok(!/\/media\/|https?:/.test(result.diagnostics[0].message), "the message names the asset by id and holds no path");
  // The tile fills the clip's rectangle with the offline fill and its diagonal hatch (the default token colours here).
  assert.ok(result.colours.includes("31,33,38"), `fill colour among ${result.colours}`);
  assert.ok(result.colours.some((colour) => colour !== "31,33,38"), "hatch lines cross the tile");
  assert.ok(!result.colours.includes("16,32,48"), "the tile covers the clip rectangle");
  assert.deepEqual(result.still, [0x10, 0x20, 0x30, 255], "with allowMissingMedia the clip is fully transparent");
  assert.ok(["media/unavailable", "media/original-unavailable"].includes(result.failed.code), "a render from originals fails without allowMissingMedia");
});

test("Still frame and thumbnail rendering — thumbnails arrive progressively as JPEG; Cancelled thumbnails", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const doc = jc.project({ width: 320, height: 180 });
    doc.media.assets.push(jc.asset("v", "video", { width: 320, height: 180, duration: 240000 }));
    const opened = await jc.open(doc, { width: 320, height: 180 }, [{ assetId: "v", original: `${origin}/media/frames.mp4` }]);
    const got: { requestId: string; time: number; width: number; height: number; magic: number[] }[] = [];
    opened.port.on("thumbnails.ready", (payload, transfer) => { got.push({ requestId: payload.requestId, time: payload.time, width: payload.width, height: payload.height, magic: Array.from(new Uint8Array(transfer![0]).slice(0, 2)) }); });
    await opened.port.command("thumbnails.request", { requestId: "r1", assetId: "v", times: [0, 40000, 80000, 120000, 160000, 200000], longSide: 64 });
    for (let wait = 0; wait < 400 && got.length < 6; wait++) await new Promise((resolve) => setTimeout(resolve, 10));
    const first = got.slice();
    // 150 thumbnails, cancelled at once.
    await opened.port.command("thumbnails.request", { requestId: "r2", assetId: "v", times: Array.from({ length: 150 }, (_, index) => index * 1600), longSide: 64 });
    await opened.port.command("thumbnails.cancel", { requestId: "r2" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const atCancel = got.filter((entry) => entry.requestId === "r2").length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { first, atCancel, later: got.filter((entry) => entry.requestId === "r2").length };
  }, harness.origin);
  assert.deepEqual(result.first.map((entry) => entry.time), [0, 40000, 80000, 120000, 160000, 200000]);
  assert.ok(result.first.every((entry) => entry.width === 64 && entry.height === 36 && entry.magic[0] === 0xff && entry.magic[1] === 0xd8));
  assert.equal(result.later, result.atCancel, "no thumbnails.ready for the cancelled request after 100 ms");
  assert.ok(result.atCancel < 150);
});
