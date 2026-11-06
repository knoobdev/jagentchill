import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startHarness, type Harness } from "./harness.ts";
import { RenderHostManager } from "../../../../server/src/render-host/manager.ts";

const repo = resolve(import.meta.dirname, "../../../../");
const w17RunRoot = process.env.W17_TEST_RUN_DIR;
if (w17RunRoot && !/^\.dev\/run-w17[ab](?:-suites-green)?-\d+$/.test(w17RunRoot)) throw new Error("W17_TEST_RUN_DIR must name an owned fresh W17 suite directory.");
const runDir = w17RunRoot ? resolve(repo, w17RunRoot, "render-host-still") : join(repo, ".dev/run-w10h2c-renderhost-isolation-1");
const profileDir = join(runDir, "render-host", "profile");
const evidenceDir = process.env.W17_TEST_EVIDENCE_DIR ? resolve(repo, process.env.W17_TEST_EVIDENCE_DIR) : join(repo, ".dev/w10h2-evidence");
const browserPort = Number(process.env.W17_TEST_BROWSER_PORT ?? 18985);
const desktop = join(repo, "apps/desktop");
const electron = process.platform === "darwin" ? join(desktop, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  : join(desktop, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
let harness: Harness;
let manager: RenderHostManager;
const managerLogs: string[] = [];
const originalUnattended = process.env.JAGENTCHILL_UNATTENDED;
const originalUserData = process.env.JAGENTCHILL_USER_DATA;
const originalHome = process.env.HOME;

before(async () => {
  assert.equal(existsSync(runDir), false, "render-host run directory is fresh");
  assert.ok(existsSync(electron), "Electron executable exists at " + electron);
  mkdirSync(runDir, { recursive: true });
  process.env.JAGENTCHILL_UNATTENDED = "1";
  process.env.HOME = join(runDir, "render-host", "home");
  harness = await startHarness(browserPort, join(runDir, "browser-harness"));
  manager = new RenderHostManager({ path: electron, idleMs: 60_000, log: (line) => managerLogs.push(line), userDataDir: profileDir });
});
after(async () => {
  await manager?.stop();
  await harness?.close();
  if (originalUnattended === undefined) delete process.env.JAGENTCHILL_UNATTENDED; else process.env.JAGENTCHILL_UNATTENDED = originalUnattended;
  if (originalUserData === undefined) delete process.env.JAGENTCHILL_USER_DATA; else process.env.JAGENTCHILL_USER_DATA = originalUserData;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
});

test("Electron render host renders the fixture still at the requested tick and matches the browser engine", async () => {
  const generated = await harness.page.evaluate(async () => {
    const jc = (window as any).jc;
    const url = await jc.imageUrl(64, 64, (context: OffscreenCanvasRenderingContext2D) => {
      context.fillStyle = "#f02030"; context.fillRect(0, 0, 32, 32);
      context.fillStyle = "#20e040"; context.fillRect(32, 0, 32, 32);
      context.fillStyle = "#3040f0"; context.fillRect(0, 32, 32, 32);
      context.fillStyle = "#f0d020"; context.fillRect(32, 32, 32, 32);
    });
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const document = jc.project({ width: 320, height: 180 }, { kind: "color", color: "#204060" });
    document.media.assets.push(jc.asset("fixture-image", "image", { width: 64, height: 64 }));
    document.scenes[0].tracks.main.elements.push(jc.element("image", { id: "fixture-image-element", startTime: 0, duration: 120_000, mediaId: "fixture-image" }));
    return { document, png: Array.from(bytes) };
  });
  const fixtureFile = join(harness.media, "fixture.png");
  writeFileSync(fixtureFile, Uint8Array.from(generated.png));
  const document = generated.document;
  const browser = await harness.page.evaluate(async ({ doc, source }) => {
    const jc = (window as any).jc;
    const opened = await jc.open(doc, { width: 320, height: 180 }, [{ assetId: "fixture-image", original: source }]);
    const frame = await opened.frameAt(60_000);
    return { pixels: Array.from(frame.pixels as Uint8Array), width: frame.size.width, height: frame.size.height, backend: opened.ready().backend };
  }, { doc: document, source: harness.origin + "/media/fixture.png" });
  const media = [{
    assetId: "fixture-image",
    original: "jagentchill-media://blob/fixture-image?path=" + encodeURIComponent(fixtureFile) + "&mime=image%2Fpng",
  }];
  const bytes = await manager.renderStill({ document: document as unknown as Record<string, any>, revision: 1, time: 60_000, width: 320, height: 180, format: "png", mediaSources: media });
  const homeDefault = join(process.env.HOME!, "Library/Application Support/JAgentChill");
  assert.equal(existsSync(homeDefault), false, "rendering does not create Electron's default profile under HOME");
  assert.ok(existsSync(process.env.HOME!), "the isolated HOME exists after the first render-host launch");
  assert.ok(existsSync(join(profileDir, "session/Local Storage")) && existsSync(join(profileDir, "session/GPUCache")), "Chromium profile and GPU cache files are under the manager-passed render-host profile");
  const imageBase64 = Buffer.from(bytes).toString("base64");
  const compared = await harness.page.evaluate(async ({ imageBase64, imageType, pixels, width, height }) => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(imageBase64), (char) => char.charCodeAt(0))], { type: imageType }));
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, width, height);
    const actual = context.getImageData(0, 0, width, height).data;
    let max = 0, total = 0, over8 = 0;
    for (let i = 0; i < actual.length; i++) { const difference = Math.abs(actual[i] - pixels[i]); max = Math.max(max, difference); total += difference; if (difference > 8) over8++; }
    document.body.replaceChildren();
    document.body.style.cssText = "margin:0;background:#111;color:white;font:14px sans-serif";
    const img = document.createElement("img"); img.width = width; img.height = height; img.src = image.src;
    document.body.append(img);
    const label = document.createElement("div"); label.textContent = "Electron render-host still · fixture project · 60,000 ticks"; label.style.padding = "8px";
    document.body.append(label);
    return { width: image.width, height: image.height, maxDifference: max, meanDifference: total / actual.length, channelsOver8: over8, actualCenter: Array.from(actual.slice((90 * width + 160) * 4, (90 * width + 160) * 4 + 4)), expectedCenter: Array.from(pixels.slice((90 * width + 160) * 4, (90 * width + 160) * 4 + 4)) };
  }, { imageBase64, imageType: "image/png", pixels: browser.pixels, width: browser.width, height: browser.height });
  mkdirSync(evidenceDir, { recursive: true });
  await harness.page.screenshot({ path: join(evidenceDir, "still-render-host.png") });
  console.log("render-host.still.compare", JSON.stringify({ backend: manager.status().hello, browserBackend: browser.backend, mime: "image/png", stillBytes: bytes.byteLength, ...compared }));
  assert.ok(bytes.byteLength > 0, "render host returned binary image data");
  assert.deepEqual([compared.width, compared.height], [320, 180]);
  assert.ok(compared.maxDifference <= 8, "pixel maximum difference " + compared.maxDifference + " <= 8");
  assert.equal(compared.channelsOver8, 0, "no pixel channel exceeds 8 levels");
  await manager.stop();
  assert.equal(manager.status().state, "stopped", "render host stops after the manager requests engine.dispose");
});
