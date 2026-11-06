// The golden-frame suite: every case is rendered at 640×360 in headless Chromium and compared with its reference
// image under the golden tolerance. References are authoritative on the CI runtime (Linux, software rasteriser);
// `JC_GOLDEN_UPDATE=1` writes them from the runtime the suite is run on. A failing case writes the reference, the
// actual frame and a difference image under `test/golden/out/`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startHarness, type Harness } from "../browser/harness.ts";
import { GOLDEN_CASES } from "./cases.ts";
import { compare, decodePng, difference, encodePng, type Rgba } from "./compare.ts";

const references = join(import.meta.dirname, "reference"), out = join(import.meta.dirname, "out");
const update = process.env.JC_GOLDEN_UPDATE === "1";
let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });

/**
 * Renders one case. The page keeps one engine for the whole suite: a case replaces its sources, derived assets and
 * scene, so the GPU device and the compiled pipelines are made once, not 363 times (on a hardware GPU a device and
 * its pipelines cost more than every frame of the suite together).
 */
async function render(page: Harness["page"], origin: string, entry: (typeof GOLDEN_CASES)[number], forceBackend?: "webgl2"): Promise<Rgba> {
  const base64 = await page.evaluate(async ({ build, args, time, origin, forceBackend }) => {
    const make = new (Object.getPrototypeOf(async () => 0).constructor)("args", build) as (args: unknown) => Promise<{ doc: any; sources: { assetId: string; original: string }[]; derived?: any[] }>;
    const { doc, sources, derived } = await make(args);
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }, { fontId: "noto", family: "Noto Sans", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf` }];
    const shared = window as unknown as { golden?: { opened: any; revision: number; urls: string[] } };
    if (!shared.golden) {
      const opened = await window.jc.open(doc, { width: 640, height: 360, forceBackend }, sources, async (port) => { await port.command("fonts.setSources", { fonts }); await port.command("derived.setSources", { entries: derived ?? [] }); });
      shared.golden = { opened, revision: 1, urls: [] };
    } else {
      const { opened } = shared.golden;
      // The pictures of the last case are gone with it: every case draws its own, under the same asset ids.
      for (const url of shared.golden.urls) URL.revokeObjectURL(url);
      await opened.port.command("media.setSources", { sources });
      await opened.port.command("derived.setSources", { entries: derived ?? [] });
      await opened.port.command("scene.set", { revision: ++shared.golden.revision, activeSceneId: doc.scenes.find((scene: any) => scene.isMain).id, document: doc });
    }
    const { opened } = shared.golden;
    shared.golden.urls = [...sources.map((source) => source.original), ...(derived ?? []).map((entry) => entry.url)].filter((url) => url.startsWith("blob:"));
    await opened.engine.whenFontsSettled();
    let frame = await opened.frameAt(time);
    // A person matte loads behind the first frame; the frame that counts is the one rendered with it.
    if (derived?.length) { await opened.engine.whenMattesSettled(); frame = await opened.frameAt(time === 0 ? 4000 : 0); frame = await opened.frameAt(time); }
    let binary = "";
    for (let index = 0; index < frame.pixels.length; index += 0x8000) binary += String.fromCharCode(...frame.pixels.subarray(index, index + 0x8000));
    return btoa(binary);
  }, { build: entry.build, args: entry.args, time: entry.time, origin, forceBackend });
  return { width: 640, height: 360, data: new Uint8Array(Buffer.from(base64, "base64")) };
}

test("Golden-frame determinism — every golden case matches its reference within the golden tolerance, and a repeat render is byte-identical", async () => {
  mkdirSync(references, { recursive: true });
  const failures: string[] = [];
  let written = 0;
  for (const [index, entry] of GOLDEN_CASES.entries()) {
    const actual = await render(harness.page, harness.origin, entry);
    const file = join(references, `${entry.id}.png`);
    if (update || !existsSync(file)) { writeFileSync(file, encodePng(actual)); written++; continue; }
    const reference = decodePng(readFileSync(file));
    const result = compare(reference, actual);
    if (!result.pass) {
      mkdirSync(out, { recursive: true });
      // Frames of a hardware GPU go to their own folder: they are not regressions of the software references.
      const folder = process.env.JC_GPU === "1" ? join(out, "gpu") : out;
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${entry.id}.reference.png`), encodePng(reference));
      writeFileSync(join(folder, `${entry.id}.actual.png`), encodePng(actual));
      writeFileSync(join(folder, `${entry.id}.difference.png`), encodePng(difference(reference, actual)));
      failures.push(`${entry.id}: ${result.reasons.join("; ")}`);
    }
    // Every tenth case is rendered a second time: the two RGBA buffers are byte-identical.
    if (index % 10 === 0) assert.equal(Buffer.compare(Buffer.from((await render(harness.page, harness.origin, entry)).data), Buffer.from(actual.data)), 0, `${entry.id} repeats byte for byte`);
  }
  console.log(`golden: ${GOLDEN_CASES.length} cases, ${written} references written, ${failures.length} failures`);
  // On a hardware GPU the references (made on the software rasteriser) are compared, and the differences are listed
  // rather than failed: `render-engine.Golden-frame determinism` makes them authoritative on the CI runtime only.
  if (process.env.JC_GPU === "1") { for (const failure of failures) console.log(`golden difference on the GPU: ${failure}`); return; }
  assert.deepEqual(failures, []);
  assert.equal(new Set(GOLDEN_CASES.map((entry) => entry.id)).size, GOLDEN_CASES.length, "case ids are unique");
});

test("Golden-frame determinism — Regression produces artefacts", () => {
  // A change that moves 3 % of the pixels by 10 per channel fails the tolerance; the three images are written.
  const reference: Rgba = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(128) };
  const actual: Rgba = { width: 64, height: 64, data: reference.data.slice() };
  for (let pixel = 0; pixel < 64 * 64 * 0.03; pixel++) for (let channel = 0; channel < 3; channel++) actual.data[pixel * 4 + channel] += 10;
  const result = compare(reference, actual);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((reason) => reason.includes("% of pixels")));
  const png = encodePng(difference(reference, actual));
  const back = decodePng(png);
  assert.deepEqual([back.width, back.height, back.data[0], back.data[64 * 64 * 4 - 4]], [64, 64, 80, 0]);
  assert.deepEqual(decodePng(encodePng(actual)).data, actual.data, "frames survive the image file unchanged");
  // Within tolerance: 0.4 % of pixels off by 3, the rest equal.
  const close: Rgba = { width: 64, height: 64, data: reference.data.slice() };
  for (let pixel = 0; pixel < 16; pixel++) close.data[pixel * 4] += 3;
  assert.equal(compare(reference, close).pass, true);
  const far: Rgba = { width: 64, height: 64, data: reference.data.slice() };
  far.data[0] += 17;
  assert.deepEqual(compare(reference, far).reasons, ["a pixel differs by 17"]);
});
