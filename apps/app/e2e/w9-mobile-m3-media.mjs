// Browser-only phone media-sheet e2e against an isolated local test host. The host creates the thumbnail from
// an ffmpeg-generated video; the second generated video exercises the visible import-progress row in the web build.
// Usage: JAGENTCHILL_PORT=18970 JAGENTCHILL_GATEWAY_PORT=18971 E2E_BASE=http://localhost:8087 node apps/app/e2e/w9-mobile-m3-media.mjs --port 18970 --data-dir .dev/run-w9e-editor-crash-2/data --shots .dev/shots/w9-m3
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { createProjectDocument, encodeOfferUrl } from "@jagentchill/protocol";
import { createHarness } from "../../../server/test/harness.ts";
import { support } from "../../../server/test/support/sync.ts";
import { blobRoutes } from "@jagentchill/protocol";

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const port = Number(arg("--port")), dataDirArg = arg("--data-dir"), shots = arg("--shots");
const base = process.env.E2E_BASE;
const runDir = dataDirArg ? dataDirArg.slice(0, dataDirArg.lastIndexOf("/")) : "";
if (port < 18970 || port > 18974 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1
  || !dataDirArg?.startsWith(".dev/run-w9e-editor-crash-") || !runDir || existsSync(runDir) || base !== "http://localhost:8087" || !shots) {
  throw new Error("Use fresh .dev/run-w9e-editor-crash-N data, matching JAGENTCHILL_PORT/JAGENTCHILL_GATEWAY_PORT, --port, and E2E_BASE=http://localhost:8087");
}
mkdirSync(shots, { recursive: true });
mkdirSync(runDir, { recursive: true });
const hostVideo = `${runDir}/host-thumbnail.mp4`, progressVideo = `${runDir}/progress-upload.mp4`;
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", hostVideo]);
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=20", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", progressVideo]);

const harness = await createHarness({ dataDir: resolve(dataDirArg), listenPort: port, allowedOrigins: [base] });
let browser;
try {
  const admin = await harness.pair("W9 media test host", "admin");
  const projectId = randomUUID();
  const fixture = { doc: createProjectDocument({ id: projectId, mainSceneId: randomUUID(), mainTrackId: randomUUID(), now_ms: Date.now(), name: "Phone media test", canvasSize: { width: 1920, height: 1080 }, fps: { numerator: 30, denominator: 1 } }) };
  const sync = support(harness);
  await sync.enable(admin, fixture.doc);
  const bytes = new Uint8Array(readFileSync(hostVideo));
  const sha256 = await sync.upload(admin, bytes, { mime: "video/mp4", name: "host-thumbnail.mp4", purpose: "media" });
  await admin.call("jagentchill.media.probe", { sha256 });
  const imported = await admin.call("jagentchill.media.import", { projectId: fixture.doc.metadata.id, sha256, name: "host-thumbnail.mp4" });
  await admin.call("jagentchill.blob.variant.request", { sha256, variant: "thumb" });
  await harness.app.sync.mediaJobs.idle();
  const status = await sync.send(admin, "GET", blobRoutes.status(sha256));
  assert.equal(status.status, 200);
  assert.ok(status.body.variants.thumb, "the test host produced a thumbnail variant for the uploaded video");
  const hostDoc = harness.app.sync.documents.head(harness.app.sync.documents.row({ kind: "project", id: fixture.doc.metadata.id }));
  assert.equal(hostDoc.media.assets.length, 1);
  assert.equal(hostDoc.media.assets[0].contentHash, sha256);

  const offer = encodeOfferUrl(harness.app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { rolePreset: "editor" }));
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ""}`));
  await page.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByLabel("Pairing link", { exact: true }).fill(offer);
  await page.getByLabel("Name of this device", { exact: true }).fill("W9 media browser");
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await page.getByText(/Enter the code shown next to/).waitFor({ timeout: 30_000 });
  const request = harness.app.pairing.pending().find((entry) => entry.deviceName === "W9 media browser");
  assert.ok(request, "browser paired through the UI to the isolated test host");
  await page.getByLabel("Verification code", { exact: true }).fill(request.code);
  await page.waitForURL((url) => !url.pathname.startsWith("/pair/"), { timeout: 30_000 });
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByTestId(`host-project-open-${fixture.doc.metadata.id}`).waitFor({ timeout: 30_000 });
  await page.getByTestId(`host-project-open-${fixture.doc.metadata.id}`).click();
  await page.waitForURL(new RegExp(`/editor/${fixture.doc.metadata.id}$`), { timeout: 60_000 });
  await page.getByTestId("tl-ctl-add-media").waitFor({ state: "visible", timeout: 60_000 });
  await page.getByTestId("tl-ctl-add-media").click();
  await page.getByTestId("media-sheet").waitFor({ state: "visible" });
  await page.getByTestId("media-import").waitFor({ state: "visible" });
  await page.getByTestId("media-items").waitFor({ state: "visible", timeout: 60_000 });
  await page.getByTestId("asset-host-thumbnail.mp4").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("duration-host-thumbnail.mp4").waitFor({ state: "visible" });
  await page.waitForTimeout(2500);
  const imageInfo = await page.getByTestId("thumb-host-thumbnail.mp4").evaluate((image) => ({ tag: image.tagName, backgroundImage: getComputedStyle(image).backgroundImage, style: image.getAttribute("style"), html: image.outerHTML.slice(0, 1500), parent: image.parentElement?.outerHTML.slice(0, 1800) })).catch(() => null);
  await page.screenshot({ path: `${shots}/media-host-assets-393x852.png` });
  assert.ok(/blob:/.test(imageInfo?.backgroundImage ?? "") || /blob:/.test(imageInfo?.html ?? "") || /blob:/.test(imageInfo?.parent ?? ""), `host thumbnail object URL did not render: ${JSON.stringify({ imageInfo, errors, requestFailures })}`);
  const importBox = await page.getByTestId("media-import").boundingBox(), assetsBox = await page.getByTestId("media-items").boundingBox();
  assert.ok(importBox.y < assetsBox.y, JSON.stringify({ importBox, assetsBox }));
  assert.ok((await page.getByTestId("duration-host-thumbnail.mp4").innerText()).trim().length > 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.getByTestId("media-import").click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Import files…", exact: true }).click(),
  ]);
  await chooser.setFiles([progressVideo]);
  await page.getByTestId("media-upload-progress").waitFor({ state: "visible", timeout: 30_000 });
  const progressText = await page.getByTestId("media-upload-progress").innerText();
  assert.match(progressText, /\d+\s*%/);
  await page.screenshot({ path: `${shots}/media-upload-progress-393x852.png` });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(JSON.stringify({ test: "w9-mobile-m3-media", viewport: "393×852", assertions: 11, host: { port, upload: "host-thumbnail.mp4", bytes: bytes.length, sha256, hostThumbnailBytes: status.body.variants.thumb.size, projectAsset: imported.assetId }, mediaGrid: { importAboveAssets: true, durationBadge: (await page.getByTestId("duration-host-thumbnail.mp4").innerText()).trim(), hostThumbnailRendered: true }, progressRow: progressText, pageErrors: errors, requestFailures, screenshots: ["media-host-assets-393x852.png", "media-upload-progress-393x852.png"] }));
} finally {
  if (browser) await browser.close();
  await harness.stop();
}
