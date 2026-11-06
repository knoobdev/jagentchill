// Headless browser-only check for M3 phone layouts. The caller supplies the built web app URL;
// this script starts no server and uses a fresh browser profile with projects created through the UI.
// Usage: E2E_BASE=http://localhost:8087 node apps/app/e2e/w9-mobile-m3.mjs .dev/shots/w9-m3
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.E2E_BASE ?? "http://localhost:8087";
const shots = process.argv[2] ?? ".dev/shots/w9-m3";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
let portraitMetrics = {}, landscapeMetrics = {};
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const card = () => page.locator('[data-testid="project-New project"]').filter({ visible: true });

try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("No projects yet", { exact: true })).waitFor();
  assert.equal(await page.getByRole("button", { name: "New project", exact: true }).filter({ visible: true }).count(), 1, "empty state has one New project button");
  await page.screenshot({ path: `${shots}/projects-empty-393.png`, fullPage: true });

  for (let index = 0; index < 2; index++) {
    await button("New project").click();
    await page.waitForURL(/\/editor\//, { timeout: 60_000 });
    await page.getByTestId("project-name").waitFor();
    if (index === 0) {
      for (const id of ["editor-bar", "project-name", "bar-undo", "bar-redo", "open-export", "compact-preview", "transport-row", "compact-time", "transport-fullscreen", "player-play", "compact-timeline-region", "compact-toolbar"]) {
        await page.getByTestId(id).waitFor();
      }
      portraitMetrics = await page.evaluate(() => Object.fromEntries(["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"].map((id) => {
        const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return [id, { x: box.x, y: box.y, width: box.width, height: box.height }];
      })));
      assert.ok(Math.abs(portraitMetrics["editor-bar"].height - 45) < 2, JSON.stringify(portraitMetrics));
      assert.ok(Math.abs(portraitMetrics["transport-row"].height - 44) < 2, JSON.stringify(portraitMetrics));
      assert.ok(Math.abs(portraitMetrics["compact-toolbar"].height - 56) < 2, JSON.stringify(portraitMetrics));
      for (const [index, id] of ["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"].entries()) {
        if (index === 0) continue;
        const previous = ["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"][index - 1];
        assert.ok(portraitMetrics[id].y >= portraitMetrics[previous].y + portraitMetrics[previous].height - 1, `${id} overlaps ${previous}: ${JSON.stringify(portraitMetrics)}`);
      }
      await page.screenshot({ path: `${shots}/editor-portrait-393.png`, fullPage: true });

      await button("Add media").click();
      await page.getByTestId("media-sheet").waitFor();
      await page.getByTestId("media-import").waitFor();
      if (await page.getByTestId("media-items").count()) await page.getByTestId("media-items").waitFor();
      else await page.getByTestId("media-dropzone").waitFor();
      await page.screenshot({ path: `${shots}/media-sheet-393.png`, fullPage: true });
      await page.keyboard.press("Escape");

      await page.setViewportSize({ width: 852, height: 393 });
      await page.getByTestId("compact-preview-pane").waitFor();
      await page.getByTestId("compact-timeline-pane").waitFor();
      landscapeMetrics = await page.evaluate(() => Object.fromEntries(["compact-preview-pane", "compact-timeline-pane"].map((id) => {
        const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return [id, { x: box.x, y: box.y, width: box.width, height: box.height }];
      })));
      assert.ok(landscapeMetrics["compact-preview-pane"].x + landscapeMetrics["compact-preview-pane"].width <= landscapeMetrics["compact-timeline-pane"].x + 1, JSON.stringify(landscapeMetrics));
      await page.screenshot({ path: `${shots}/editor-landscape-852.png`, fullPage: true });
    }
    await page.getByTestId("compact-close").click();
    await page.waitForURL(/\/projects$/, { timeout: 30_000 });
    await card().first().waitFor({ timeout: 60_000 });
    if (index === 0) await page.setViewportSize({ width: 393, height: 852 });
  }

  assert.equal(await card().count(), 2, "two projects were created through the app");
  const cards = await card().evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, text: node.innerText };
  }));
  assert.equal(cards[0].y, cards[1].y, "cards share a row");
  assert.notEqual(cards[0].x, cards[1].x, "phone Projects uses two columns");
  assert.ok(cards.every((entry) => entry.width > 150 && entry.x >= 0 && entry.x + entry.width <= 393), JSON.stringify(cards));
  assert.ok(cards.every((entry) => entry.text.includes("00:00") && entry.text.includes("Edited")), JSON.stringify(cards));
  await page.getByTestId("projects-sort-filter").click();
  await page.getByTestId("projects-sort-filter-sheet").waitFor();
  await page.getByRole("searchbox", { name: "Search projects" }).waitFor();
  await page.getByRole("combobox", { name: "Sort by" }).waitFor();
  await page.getByTestId("projects-pinned-filter").click();
  assert.equal(await card().count(), 0, "pinned-only filter hides unpinned projects");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${shots}/projects-grid-393.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ viewport: "393×852 / 852×393", portrait: portraitMetrics, landscape: landscapeMetrics, projects: cards, pageErrors: errors }));
} catch (error) {
  await page.screenshot({ path: `${shots}/w9-mobile-m3-failure.png`, fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
