// Runs the decode-dependent engine in real browsers (Playwright): the bundled Chromium, and Google Chrome when it is
// installed. Media files are generated with ffmpeg; nothing is mocked on the page side.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { sha256Hex } from "../src/index.ts";
import { ensureFixtures, fixture } from "./support/fixtures.ts";
import { startHarnessServer, type HarnessServer } from "./browser/server.ts";

type Api = Record<string, (...args: any[]) => Promise<any>>;
let server: HarnessServer, bundled: Browser, chrome: Browser | null = null, page: Page, chromePage: Page | null = null;
const call = <T = any>(target: Page, method: string, ...args: unknown[]): Promise<T> =>
  target.evaluate(([name, parameters]) => ((window as unknown as { media: Api }).media[name as string](...(parameters as unknown[]))), [method, args] as const) as Promise<T>;
const open = async (browser: Browser): Promise<Page> => {
  const opened = await browser.newPage();
  await opened.goto(`${server.origin}/`);
  await opened.waitForFunction("window.mediaReady === true", undefined, { timeout: 30_000 });
  return opened;
};
before(async () => {
  ensureFixtures();
  server = await startHarnessServer();
  bundled = await chromium.launch();
  page = await open(bundled);
  chrome = await chromium.launch({ channel: "chrome" }).catch(() => null);
  chromePage = chrome ? await open(chrome) : null;
}, { timeout: 180_000 });
after(async () => { await bundled?.close(); await chrome?.close(); await server?.close(); });

test("real probe values in a browser worker: H.264/AAC MP4, VP9 WebM, PNG with alpha, JPEG with EXIF rotation, WAV and MP3", async () => {
  const probe = async (name: string, mime: string) => (await call(page, "probe", name, mime, "worker")).probe;
  assert.deepEqual(await probe("h264-aac.mp4", "video/mp4"), {
    type: "video", container: "mp4", duration: 240_000, width: 640, height: 360, rotation: 0, fps: { numerator: 30, denominator: 1 }, hasAudio: true,
    videoCodec: "h264", hasAlpha: false, canDecode: true, audioCodec: "aac", sampleRate: 48000, channels: 2, canDecodeSound: true,
  });
  const webm = await probe("vp9-opus.webm", "video/webm");
  assert.deepEqual([webm.container, webm.width, webm.height, webm.fps, webm.videoCodec, webm.audioCodec, webm.channels, webm.sampleRate, webm.canDecode], ["webm", 320, 240, { numerator: 25, denominator: 1 }, "vp9", "opus", 1, 48000, true]);
  assert.ok(Math.abs(webm.duration - 240_000) <= 240);
  assert.deepEqual(await probe("alpha.png", "image/png"), { type: "image", container: "png", width: 64, height: 48, rotation: 0, hasAlpha: true, canDecode: null });
  assert.deepEqual(await probe("exif-rotated.jpg", "image/jpeg"), { type: "image", container: "jpeg", width: 40, height: 80, rotation: 90, hasAlpha: false, canDecode: null });
  assert.deepEqual(await probe("sine-10s.wav", "audio/wav"), { type: "audio", container: "wav", duration: 1_200_000, rotation: 0, canDecode: true, audioCodec: "pcm", sampleRate: 44100, channels: 1 });
  const mp3 = await probe("tone.mp3", "audio/mpeg");
  assert.deepEqual([mp3.container, mp3.audioCodec, mp3.sampleRate, mp3.channels, mp3.canDecode], ["mp3", "mp3", 44100, 2, true]);
  assert.ok(Math.abs(mp3.duration / 120_000 - 3) < 0.06);
  // The header parser agrees with the browser's own decoder about the displayed size.
  for (const name of ["exif-rotated.jpg", "alpha.png", "picture.webp", "picture.bmp", "large.jpg"]) {
    const both = await call(page, "headerMatchesDecoder", name);
    assert.deepEqual([both.header.width, both.header.height], [both.decoded.width, both.decoded.height], name);
  }
  // Inline (no worker) gives the same answer, and hashing in the worker matches the bytes.
  assert.deepEqual((await call(page, "probe", "h264-aac.mp4", "video/mp4", "inline")).probe.fps, { numerator: 30, denominator: 1 });
  assert.equal(await call(page, "hash", "h264-aac.mp4", "worker"), sha256Hex(fixture("h264-aac.mp4")));
  const corrupt = await call(page, "probe", "truncated.mp4", "video/mp4", "worker");
  assert.deepEqual([corrupt.ok, corrupt.name, corrupt.message], [false, "ProbeError", "Unable to read truncated.mp4"]);
});

test("Probe a phone video in a browser: display size 1080 × 1920, 30000/1001 fps, HEVC with audio; HEVC on a browser without HEVC support reports canDecode false", async () => {
  const inChromium = (await call(page, "probe", "phone-hevc.mp4", "video/mp4", "worker")).probe;
  assert.deepEqual([inChromium.width, inChromium.height, inChromium.fps, inChromium.hasAudio, inChromium.videoCodec], [1080, 1920, { numerator: 30000, denominator: 1001 }, true, "hevc"]);
  // The bundled Chromium has no HEVC decoder: the asset is still probed, flagged undecodable, and has no thumbnail.
  assert.equal(inChromium.canDecode, false);
  assert.equal(await call(page, "thumbnail", "phone-hevc.mp4", "video/mp4", "worker"), null);
  if (chromePage) {
    const inChrome = (await call(chromePage, "probe", "phone-hevc.mp4", "video/mp4", "worker")).probe;
    assert.deepEqual([inChrome.width, inChrome.height, inChrome.videoCodec], [1080, 1920, "hevc"]);
    if (inChrome.canDecode) {
      // Rotation metadata is applied: the thumbnail is portrait.
      const thumbnail = await call(chromePage, "thumbnail", "phone-hevc.mp4", "video/mp4", "worker");
      assert.deepEqual([thumbnail.width, thumbnail.height], [405, 720]);
    }
  }
});

test("Large image in a browser: a real 6000 × 4000 JPEG gets a stored thumbnail of 1080 × 720, JPEG; a PNG with alpha gets a PNG that keeps its transparency", async () => {
  const large = await call(page, "thumbnail", "large.jpg", "image/jpeg", "worker");
  assert.deepEqual([large.mimeType, large.width, large.height, large.decoded.width, large.decoded.height], ["image/jpeg", 1080, 720, 1080, 720]);
  assert.deepEqual(large.signature.slice(0, 3), [0xff, 0xd8, 0xff]);
  const alpha = await call(page, "thumbnail", "alpha.png", "image/png", "worker", [[0.1, 0.5], [0.9, 0.5]]);
  assert.deepEqual([alpha.mimeType, alpha.width, alpha.height], ["image/png", 64, 48]);
  assert.deepEqual(alpha.signature, [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(alpha.decoded.pixels[0][3], 0, "left half stays transparent");
  assert.deepEqual(alpha.decoded.pixels[1], [255, 0, 0, 255]);
  // EXIF orientation is applied to the picture.
  const rotated = await call(page, "thumbnail", "exif-rotated.jpg", "image/jpeg", "worker");
  assert.deepEqual([rotated.width, rotated.height], [40, 80]);
  assert.equal(await call(page, "thumbnail", "tone.mp3", "audio/mpeg", "worker"), null);
});

test("Short video in a browser: the thumbnail of a real 0.6 s video is the frame at 0.3 s", async () => {
  // The fixture is red for 0–0.2 s, green for 0.2–0.4 s and blue for 0.4–0.6 s: the frame at 0.3 s is green.
  const probed = (await call(page, "probe", "tricolour.webm", "video/webm", "worker")).probe;
  assert.ok(Math.abs(probed.duration - 72_000) <= 240, `duration ${probed.duration}`);
  const thumbnail = await call(page, "thumbnail", "tricolour.webm", "video/webm", "worker", [[0.5, 0.5]]);
  assert.deepEqual([thumbnail.mimeType, thumbnail.width, thumbnail.height], ["image/jpeg", 160, 120]);
  const [red, green, blue] = thumbnail.decoded.pixels[0];
  assert.ok(green > 180 && red < 90 && blue < 90, `pixel ${thumbnail.decoded.pixels[0]}`);
  // A longer video uses the frame at 1 s; an animated GIF is a video and gets a thumbnail too.
  const two = await call(page, "thumbnail", "h264-aac.mp4", "video/mp4", "worker");
  assert.deepEqual([two.width, two.height], [640, 360]);
  const gif = await call(page, "thumbnail", "anim.gif", "image/gif", "worker");
  assert.deepEqual([gif.width, gif.height], [32, 32]);
});

test("SVG with a script: the script does not run, no network request is made and the asset shows the rasterised picture; SVG without MIME is an image", async () => {
  const before = server.requests.length;
  const result = await call(page, "svg", "scripted.svg");
  assert.deepEqual(result.detected, { type: "image", format: "svg", mimeType: "image/svg+xml", needsMezzanine: false });
  assert.deepEqual([result.probe.type, result.probe.width, result.probe.height], ["image", 120, 60]);
  assert.equal(result.scriptRan, false);
  const made = server.requests.slice(before);
  assert.deepEqual(made.filter((path) => path.includes("svg-script-fetch") || path.includes("svg-external")), []);
  assert.deepEqual([result.thumbnail.mimeType, result.thumbnail.width, result.thumbnail.height], ["image/png", 120, 60]);
  assert.deepEqual(result.thumbnail.decoded.pixels[0], [0, 255, 0, 255]);
});

test("filmstrip frames decoded in a browser are 90 px high with the aspect preserved", async () => {
  const frames = await call(page, "filmstrip", "h264-aac.mp4", [0, 120_000], "worker");
  assert.deepEqual(frames.map((frame: any) => [frame.time, frame.width, frame.height, frame.decoded.width, frame.decoded.height]), [[0, 160, 90, 160, 90], [120_000, 160, 90, 160, 90]]);
  const webm = await call(page, "filmstrip", "vp9-opus.webm", [60_000], "inline");
  assert.deepEqual([webm[0].width, webm[0].height], [120, 90]);
});

test("Summary format in a browser: the real 10 s full-scale sine WAV gives 1 000 pairs at the base level and 250 at factor 4", async () => {
  const wav = await call(page, "waveform", "sine-10s.wav", "worker");
  assert.deepEqual(wav.levels, [{ factor: 1, pairs: 1000 }, { factor: 4, pairs: 250 }, { factor: 16, pairs: 63 }, { factor: 64, pairs: 16 }]);
  assert.deepEqual([wav.sampleRate, wav.totalSamples], [44100, 441_000]);
  assert.ok(wav.min <= -126 && wav.max >= 126, `peaks ${wav.min} ${wav.max}`);
  assert.equal(wav.progress.at(-1), 1);
  // Compressed audio decodes through WebCodecs: MP3 and the AAC track of a video.
  const mp3 = await call(page, "waveform", "tone.mp3", "worker");
  assert.ok(Math.abs(mp3.levels[0].pairs - 300) <= 6, `pairs ${mp3.levels[0].pairs}`);
  const video = await call(page, "waveform", "h264-aac.mp4", "inline");
  assert.ok(Math.abs(video.levels[0].pairs - 200) <= 6, `pairs ${video.levels[0].pairs}`);
});

test("Long file: summarising a 3-hour audio file causes no main-thread task longer than 50 ms and reports progress at least once per second until ready", { timeout: 240_000 }, async () => {
  fixture("long-3h.wav");
  const started = Date.now();
  const long = await call(page, "waveform", "long-3h.wav", "worker");
  const elapsedSeconds = (Date.now() - started) / 1000;
  assert.equal(long.levels[0].pairs, 3 * 3600 * 100);
  assert.equal(long.levels[1].pairs, 270_000);
  assert.ok(long.longestMainThreadTask <= 50, `longest main-thread task ${long.longestMainThreadTask} ms`);
  assert.equal(long.progress.at(-1), 1);
  assert.ok(long.progress.length >= Math.floor(elapsedSeconds), `${long.progress.length} progress values in ${elapsedSeconds.toFixed(1)} s`);
  assert.ok(long.progress.every((value: number, index: number) => index === 0 || value >= long.progress[index - 1]));
});

test("the import decode test and the proxy are produced for real: a 3840 × 2160 source becomes a 1280 × 720 proxy in the form the device's encoders select", { timeout: 240_000 }, async () => {
  const target = chromePage ?? page;
  const fps = await call(target, "decodeTest", "h264-aac.mp4");
  assert.ok(typeof fps === "number" && fps > 0, `decode test ${fps}`);
  const encoders = await call(target, "encoderSupport");
  const proxy = await call(target, "proxy", "uhd.webm", "worker");
  if (proxy.producer.producer !== "device") { assert.deepEqual(proxy.producer, { producer: "none" }); return; }
  assert.equal(proxy.form, encoders.h264 && encoders.aac ? "mp4" : "webm");
  assert.deepEqual([proxy.width, proxy.height, proxy.reprobed.width, proxy.reprobed.height], [1280, 720, 1280, 720]);
  assert.equal(proxy.reprobed.videoCodec, proxy.form === "mp4" ? "h264" : "vp9");
  assert.deepEqual(proxy.reprobed.fps, { numerator: 30, denominator: 1 });
  assert.match(proxy.sha256, /^[0-9a-f]{64}$/);
  assert.ok(proxy.size > 0 && proxy.progress > 0);
});
