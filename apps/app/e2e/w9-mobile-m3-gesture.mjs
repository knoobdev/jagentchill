// Regression check for the phone editor opening in a headless browser. Browser-only: native gestures are covered by
// the real Gesture Handler binding in touch.ts and require a simulator, which this mobile turn must not run.
// Usage: node apps/app/e2e/w9-mobile-m3-gesture.mjs [screenshot-dir] [base-url]
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
try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.waitForURL(/\/editor\//, { timeout: 60_000 });
  for (const id of ["compact-editor", "editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar", "playhead", "player-stage"]) {
    await page.getByTestId(id).waitFor({ state: "visible", timeout: 30_000 });
  }
  const boxes = await page.evaluate(() => Object.fromEntries(["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"].map((id) => {
    const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    return [id, { x: box.x, y: box.y, width: box.width, height: box.height }];
  })));
  assert.ok(boxes["compact-toolbar"].x >= 0 && boxes["compact-toolbar"].x + boxes["compact-toolbar"].width <= 393, JSON.stringify(boxes));
  assert.ok(boxes["compact-toolbar"].y + boxes["compact-toolbar"].height <= 852, JSON.stringify(boxes));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${shots}/gesture-regression-editor-393x852.png`, fullPage: true });
  console.log(JSON.stringify({ test: "w9-mobile-m3-gesture", viewport: "393×852", assertions: 11, boxes, pageErrors: errors, screenshot: `${shots}/gesture-regression-editor-393x852.png` }));
} finally {
  await browser.close();
}
