// Headless user-path check for the phone Projects screen. The editor route is not
// inspected here; navigate back after app creation and verify the saved cards.
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
page.on("pageerror", (error) => errors.push(error.message));
const cards = () => page.locator('[data-testid^="project-"]').filter({ visible: true });

try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByText("No projects yet", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "New project", exact: true }).filter({ visible: true }).count(), 1);
  await page.screenshot({ path: `${shots}/projects-empty-393.png`, fullPage: true });

  await page.getByRole("button", { name: "New project", exact: true }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/editor\//, { timeout: 30_000 });
  await page.goBack();
  await page.waitForURL(/\/projects$/, { timeout: 30_000 });
  await page.getByTestId("project-New project").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Actions for New project" }).click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await cards().nth(1).waitFor({ timeout: 30_000 });

  assert.equal(await cards().count(), 2);
  const boxes = await cards().evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, text: node.innerText };
  }));
  assert.equal(boxes[0].y, boxes[1].y, "two projects share the phone row");
  assert.notEqual(boxes[0].x, boxes[1].x, "phone Projects uses two columns");
  assert.ok(boxes.every((box) => box.width > 150 && box.x >= 0 && box.x + box.width <= 393), JSON.stringify(boxes));
  assert.ok(boxes.every((box) => box.text.includes("00:00") && box.text.includes("Edited")), JSON.stringify(boxes));
  await page.screenshot({ path: `${shots}/projects-grid-393.png`, fullPage: true });

  await page.getByTestId("projects-sort-filter").click();
  await page.getByTestId("projects-sort-filter-sheet").waitFor();
  await page.getByRole("searchbox", { name: "Search projects" }).waitFor();
  await page.getByRole("combobox", { name: "Sort by" }).waitFor();
  await page.screenshot({ path: `${shots}/projects-sort-filter-393.png`, fullPage: true });
  await page.getByTestId("projects-pinned-filter").click();
  assert.equal(await cards().count(), 0, "pinned-only filter hides unpinned projects");
  console.log(JSON.stringify({ viewport: "393×852", projects: boxes, assertions: 7, pageErrors: errors }));
} catch (error) {
  await page.screenshot({ path: `${shots}/projects-e2e-failure.png`, fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
