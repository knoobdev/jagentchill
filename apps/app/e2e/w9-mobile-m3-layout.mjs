// Browser-only phone layout check. Native safe-area values are asserted in compact/layout.test.ts.
// Usage: node apps/app/e2e/w9-mobile-m3-layout.mjs [screenshot-dir] [base-url]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w9-m3";
const base = process.argv[3] ?? "http://localhost:8087";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const box = async (id) => page.getByTestId(id).boundingBox();
const noOverlap = (a, b) => a.y + a.height <= b.y + 1;
try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.waitForURL(/\/editor\//, { timeout: 60_000 });
  for (const id of ["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar", "playhead"]) await page.getByTestId(id).waitFor({ state: "visible" });
  const portrait = Object.fromEntries(await Promise.all(["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"].map(async (id) => [id, await box(id)])));
  assert.equal(portrait["editor-bar"].height, 45);
  assert.equal(portrait["transport-row"].height, 44);
  assert.equal(portrait["compact-toolbar"].height, 56);
  assert.ok(noOverlap(portrait["editor-bar"], portrait["compact-preview"]));
  assert.ok(noOverlap(portrait["compact-preview"], portrait["transport-row"]));
  assert.ok(noOverlap(portrait["transport-row"], portrait["compact-timeline-region"]));
  assert.ok(noOverlap(portrait["compact-timeline-region"], portrait["compact-toolbar"]));
  const portraitPlayhead = await box("playhead");
  assert.ok(Math.abs(portraitPlayhead.x + portraitPlayhead.width / 2 - 196.5) <= 1, JSON.stringify(portraitPlayhead));
  await page.screenshot({ path: `${shots}/editor-layout-393x852.png` });

  await page.getByTestId("tool-root.more").click();
  await page.getByTestId("tool-sheet").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-testid="tool-sheet-slot"]')?.getAttribute("data-settled") === "true");
  const sheet = await box("tool-sheet"), transport = await box("transport-row"), smallTimeline = await box("compact-timeline-region");
  assert.ok(noOverlap(transport, smallTimeline), JSON.stringify({ transport, smallTimeline }));
  assert.ok(noOverlap(smallTimeline, sheet), JSON.stringify({ smallTimeline, sheet }));
  assert.equal(smallTimeline.height, 48);
  assert.ok(transport.y + transport.height <= sheet.y, JSON.stringify({ transport, sheet }));
  await page.screenshot({ path: `${shots}/editor-tool-sheet-393x852.png` });
  await page.getByTestId("tool-sheet-close").click();
  await page.getByTestId("compact-toolbar").waitFor({ state: "visible" });

  await page.setViewportSize({ width: 852, height: 393 });
  await page.getByTestId("compact-preview-pane").waitFor({ state: "visible" });
  await page.getByTestId("compact-timeline-pane").waitFor({ state: "visible" });
  const landscape = Object.fromEntries(await Promise.all(["compact-preview-pane", "transport-row", "compact-timeline-pane", "compact-timeline-region", "compact-toolbar"].map(async (id) => [id, await box(id)])));
  assert.equal(landscape["editor-bar"], undefined);
  assert.ok(landscape["compact-preview-pane"].x + landscape["compact-preview-pane"].width <= landscape["compact-timeline-pane"].x + 1, JSON.stringify(landscape));
  assert.equal(landscape["compact-toolbar"].height, 56);
  assert.ok(Math.abs(landscape["transport-row"].y + landscape["transport-row"].height - (landscape["compact-preview-pane"].y + landscape["compact-preview-pane"].height)) <= 1, JSON.stringify(landscape));
  assert.ok(Math.abs(landscape["compact-toolbar"].y + landscape["compact-toolbar"].height - 393) <= 1, JSON.stringify(landscape));
  const landscapePlayhead = await box("playhead");
  assert.ok(Math.abs(landscapePlayhead.x + landscapePlayhead.width / 2 - (landscape["compact-timeline-region"].x + landscape["compact-timeline-region"].width / 2)) <= 1, JSON.stringify({ landscape, landscapePlayhead }));
  await page.screenshot({ path: `${shots}/editor-layout-852x393.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ test: "w9-mobile-m3-layout", assertions: 19, portrait, sheet: { transport, timeline: smallTimeline, sheet }, landscape, pageErrors: errors, screenshots: ["editor-layout-393x852.png", "editor-tool-sheet-393x852.png", "editor-layout-852x393.png"] }));
} finally {
  await browser.close();
}
