// Browser-only 390 px path for the M1b phone shell. Notification content is a localStorage UI fixture;
// no host, provider, model, simulator, native picker or OS notification API is used.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.E2E_BASE ?? "http://localhost:8098";
const shots = process.argv[2] ?? ".dev/shots/w9-m1b/browser-shell";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "light" });
await context.addInitScript(() => {
  localStorage.setItem("jagentchill.notifications", JSON.stringify([{
    id: "m1b-fixture-notice", at_ms: Date.now(), kind: "info", category: "other", read: false,
    message: "M1b browser fixture: project imported", route: "/projects",
  }]));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const tid = (id) => page.getByTestId(id).filter({ visible: true }).first();
const button = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 120_000 });
  const localOnly = page.getByRole("button", { name: "Use this device only", exact: true }).filter({ visible: true }).first();
  if (await localOnly.count()) await localOnly.click();
  await tid("top-bar").waitFor({ timeout: 60_000 });

  await tid("mobile-global-search").click();
  await tid("command-palette-empty").waitFor();
  assert.equal((await tid("modal").boundingBox()).width, 390, "search is full width at 390 px");
  await shot("01-search-empty-390-browser-only");
  const search = page.getByRole("searchbox", { name: "Search projects and commands" });
  await search.fill("Settings");
  await tid("menu-settings").waitFor();
  await page.getByText("Commands", { exact: true }).waitFor();
  const resultBox = await tid("menu-settings").boundingBox();
  assert.ok(resultBox.height >= 44, `search result target is ${resultBox.height} px`);
  await shot("02-search-results-390-browser-only");
  await search.fill("m1b-no-result-zz");
  await tid("command-palette-no-results").waitFor();
  await shot("03-search-no-results-390-browser-only");
  await page.keyboard.press("Escape");
  await tid("command-palette").waitFor({ state: "detached" });

  await button("Open navigation").click();
  await tid("footer-notifications").click();
  await page.waitForURL(/\/notifications$/);
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await tid("inbox").waitFor();
  await tid("inbox-entry").waitFor();
  await tid("inbox-read-all").click();
  assert.equal(await tid("inbox-entry").getAttribute("data-read"), "true", "mark-all-read changes the entry state");
  const rowBox = await tid("inbox-entry").boundingBox();
  assert.ok(rowBox.height >= 44, `notification row is ${rowBox.height} px`);
  await shot("04-notifications-fixture-390-browser-only");
  await tid("inbox-entry-link").click();
  await page.waitForURL(/\/projects$/);
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await button("Open navigation").click();
  await tid("footer-notifications").click();
  await page.waitForURL(/\/notifications$/);
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await tid("inbox-clear").click();
  await tid("inbox-empty").waitFor();
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await shot("05-notifications-empty-390-browser-only");

  await button("Open navigation").click();
  await tid("nav-projects").click();
  await page.waitForURL(/\/projects$/);
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await tid("projects-sort-filter").waitFor();
  await page.getByRole("heading", { name: "No projects yet", exact: true }).last().waitFor();
  await shot("06-projects-empty-390-browser-only");
  await tid("projects-sort-filter").click();
  await tid("projects-sort-filter-sheet").waitFor();
  await page.waitForTimeout(500);
  console.log("SORT SHEET", await tid("projects-sort-filter-sheet").innerText());
  await shot("07-projects-sort-sheet-390-browser-only");
  await page.getByText("Last modified", { exact: true }).waitFor();
  await page.getByRole("switch", { name: "Pinned", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await button("New project").click();
  await page.waitForURL(/\/editor\//);
  await tid("project-name").waitFor();
  await tid("compact-close").click();
  await page.waitForURL(/\/projects$/);
  await page.waitForURL(/\/projects$/);
  await page.getByTestId("drawer").waitFor({ state: "hidden" });
  await button("Actions for New project").click();
  for (const item of ["open", "pin", "rename", "duplicate", "delete"]) await tid(`menu-${item}`).waitFor();
  for (const item of ["pin", "rename", "duplicate", "delete"]) {
    const rowBox = await tid(`menu-${item}`).boundingBox();
    assert.ok(rowBox.height >= 44, `phone project ${item} row is ${rowBox.height} px`);
  }
  await shot("08-project-row-actions-390-browser-only");
  await tid("menu-delete").scrollIntoViewIfNeeded();
  await shot("08b-project-row-actions-lower-390-browser-only");
  await tid("menu-pin").click();
  await page.getByTestId("project-New project").filter({ visible: true }).first().getByTestId("pin-mark").waitFor();
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.getByText("Recent projects", { exact: true }).first().waitFor();
  const recentCard = page.locator('[data-testid^="home-recent-project-"]').filter({ visible: true }).first();
  await recentCard.waitFor();
  await shot("09-home-recent-frame-thumbnail-390-browser-only");
  const hasInitial = await recentCard.getByTestId("project-placeholder-initial").count();
  const hasThumbnail = await recentCard.locator("img").count();
  assert.ok(hasInitial > 0 || hasThumbnail > 0, "recent project has a distinct initial placeholder or real thumbnail");

  const hostChip = button("Host: This device");
  await hostChip.click();
  await page.getByText("Hosts", { exact: true }).waitFor();
  await page.getByText("Add a host…", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await shot("10-hosts-local-390-browser-only");
  await page.getByText("Add a host…", { exact: true }).click();
  await page.waitForURL(/\/host\/add-connection$/);
  await page.getByText("Direct connection", { exact: true }).waitFor();
  await page.getByText("Paste pairing link", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await shot("11-add-host-method-sheet-390-browser-only");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await tid("top-bar").waitFor();
  await shot("12-home-wide-browser-only");
  assert.deepEqual(errors, [], `browser page errors: ${errors.join("; ")}`);
  console.log("PASS: search surface 390×844, result target 44 px, notification row 44 px, Projects menu row 44 px; Home wide 1440×900.");
} finally {
  await browser.close();
}
