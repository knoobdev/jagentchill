// Projects: pin and sort, on the PRODUCTION web build with no host. Real storage of a fresh browser profile; the four
// projects are made through the screen; one of them gets a real H.264 clip (ffmpeg) so that it is the largest. Nothing is
// seeded or mocked.
// Usage: node apps/app/e2e/projects-pin.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w7-shell/projects";
const base = process.argv[3] ?? "http://localhost:8083";
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), "jagentchill-cursors-e2e");
mkdirSync(dir, { recursive: true });
const clip = join(dir, "red.mp4");
if (!existsSync(clip)) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [], results = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const menuItem = (name) => visible(page.getByRole("menuitem", { name, exact: true }));
const card = (name) => visible(page.getByTestId(`project-${name}`));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push("ok"); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); results.push("FAIL"); await page.screenshot({ path: `${shots}/failure-${results.length}.png` }); await page.keyboard.press("Escape").catch(() => {}); }
};
/** The projects on screen in display order, and which of them carry the pin mark. */
const listed = () => page.evaluate(() => [...document.querySelectorAll('main [data-testid^="project-"], [data-testid="projects-screen"] [data-testid^="project-"]')].concat([...document.querySelectorAll('[data-testid^="project-"]')]).filter((node, index, all) => all.indexOf(node) === index && node.getBoundingClientRect().width > 0 && !node.closest('[data-testid="sidebar"]'))
  .map((node) => ({ name: node.getAttribute("data-testid").slice(8), pinned: node.querySelector('[data-testid="pin-mark"]') !== null, y: node.getBoundingClientRect().y, x: node.getBoundingClientRect().x })).sort((a, b) => a.y - b.y || a.x - b.x));
const order = async () => (await listed()).map((entry) => entry.name).join(",");
const pinned = async () => (await listed()).filter((entry) => entry.pinned).map((entry) => entry.name).sort().join(",");
const until = async (read, want, what) => { let got; for (let tries = 0; tries < 60; tries++) { got = await read(); if (got === want) return; await page.waitForTimeout(100); } throw new Error(`${what}: “${got}”, expected “${want}”`); };
const cardMenu = async (name, item) => { await card(name).hover(); await button(`Actions for ${name}`).click(); await menuItem(item).click(); };
const sortBy = async (name) => { await visible(page.getByRole("combobox", { name: "Sort by" })).click(); await visible(page.getByRole("option", { name, exact: true })).click(); await page.waitForTimeout(250); };
const backToProjects = async () => { await button("Editor menu").click(); await visible(page.getByRole("menuitem", { name: "Back to projects" })).click(); await visible(page.getByText("Every project on this device.")).waitFor(); };

await step("four projects made through the screen: Alpha, Bravo, Charlie, Delta (Delta holds a 6 s clip)", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  for (const [index, name] of ["Alpha", "Bravo", "Charlie", "Delta"].entries()) {
    await button(index === 0 ? "Create your first project" : "New project").click({ timeout: 90_000 });
    await page.waitForURL(/\/editor\//); await button("Rename: New project").click({ timeout: 60_000 });
    await page.getByLabel("Project name").fill(name); await page.keyboard.press("Enter");
    if (name === "Delta") {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
      await chooser.setFiles([clip]); await tid("label-red.mp4").waitFor({ timeout: 60_000 });
    }
    await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 }); await backToProjects();
  }
  await sortBy("Name"); await sortBy("Ascending");
  await until(order, "Alpha,Bravo,Charlie,Delta", "by name, nothing pinned");
  expect((await pinned()) === "", "nothing is pinned yet");
});
await step("card menu: Pin puts Charlie first with the pin mark; the menu then offers Unpin", async () => {
  await cardMenu("Charlie", "Pin");
  await until(order, "Charlie,Alpha,Bravo,Delta", "after pinning Charlie");
  await until(pinned, "Charlie", "the pin mark");
  await card("Charlie").hover(); await button("Actions for Charlie").click();
  await menuItem("Unpin").waitFor(); await page.keyboard.press("Escape");
});
await step("context menu pins Alpha; the key P pins the focused Delta", async () => {
  await card("Alpha").click({ button: "right" }); await menuItem("Pin").click();
  await until(pinned, "Alpha,Charlie", "after the context menu");
  await card("Delta").getByRole("button", { name: "Delta", exact: true }).focus(); await page.keyboard.press("p");
  await until(pinned, "Alpha,Charlie,Delta", "after the key P");
  await until(order, "Alpha,Charlie,Delta,Bravo", "pinned first, by name inside each group");
  await page.screenshot({ path: `${shots}/wide-light-grid.png` });
});
await step("pinned stay first whatever the sort and its direction", async () => {
  await sortBy("Descending"); await until(order, "Delta,Charlie,Alpha,Bravo", "name descending");
  await sortBy("Created"); await until(order, "Delta,Charlie,Alpha,Bravo", "created descending (Delta is the newest)");
  await sortBy("Ascending"); await until(order, "Alpha,Charlie,Delta,Bravo", "created ascending");
  await sortBy("Name");
});
await step("list view: the same order and marks; the sidebar lists the pinned ones first under “Pinned” with the pin", async () => {
  await visible(page.getByRole("radio", { name: "List" })).click(); await page.waitForTimeout(300);
  await until(order, "Alpha,Charlie,Delta,Bravo", "list view");
  await until(pinned, "Alpha,Charlie,Delta", "marks in the list view");
  const sidebar = await page.evaluate(() => { const text = document.querySelector('[data-testid="sidebar"]')?.innerText ?? ""; return { text, pinnedAt: text.indexOf("Pinned"), names: ["Alpha", "Bravo", "Charlie", "Delta"].map((name) => ({ name, at: text.lastIndexOf(name) })) }; });
  const at = Object.fromEntries(sidebar.names.map((entry) => [entry.name, entry.at]));
  expect(sidebar.pinnedAt >= 0 && [at.Alpha, at.Charlie, at.Delta].every((position) => position > sidebar.pinnedAt && position < at.Bravo), `the sidebar: ${sidebar.text.replace(/\s+/g, " ").slice(0, 260)}`);
  await page.screenshot({ path: `${shots}/wide-light-list.png` });
  await visible(page.getByRole("radio", { name: "Grid" })).click(); await page.waitForTimeout(300);
});
await step("search keeps the pinned ones first: “r” finds Charlie (pinned) before Bravo", async () => {
  await page.getByRole("searchbox", { name: "Search projects" }).fill("r");
  await until(order, "Charlie,Bravo", "search results");
  await button("Clear search").click(); await card("Alpha").waitFor();
});
await step("multi-select: the bulk bar pins a mixed selection, and unpins a selection that is all pinned", async () => {
  await page.getByRole("checkbox", { name: "Select Bravo", exact: true }).check(); await page.getByRole("checkbox", { name: "Select Alpha", exact: true }).check();
  await tid("bulk-bar").getByRole("button", { name: "Pin", exact: true }).click();
  await until(pinned, "Alpha,Bravo,Charlie,Delta", "all four pinned");
  for (const name of ["Alpha", "Bravo", "Delta"]) await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).check();
  await tid("bulk-bar").getByRole("button", { name: "Unpin", exact: true }).click();
  await until(pinned, "Charlie", "three unpinned at once");
});
await step("sort by size: the project with the clip is the largest; the choice and the pin are still there after a reload", async () => {
  await cardMenu("Charlie", "Unpin"); await until(pinned, "", "nothing pinned");
  await sortBy("Size"); await sortBy("Descending");
  for (let tries = 0; tries < 60 && !(await order()).startsWith("Delta"); tries++) await page.waitForTimeout(100);
  expect((await order()).startsWith("Delta,"), `largest first: ${await order()}`);
  await sortBy("Ascending");
  for (let tries = 0; tries < 60 && !(await order()).endsWith("Delta"); tries++) await page.waitForTimeout(100);
  expect((await order()).endsWith(",Delta"), `smallest first: ${await order()}`);
  await cardMenu("Bravo", "Pin"); await until(pinned, "Bravo", "Bravo pinned");
  await page.reload({ waitUntil: "networkidle" }); await card("Alpha").waitFor({ timeout: 60_000 });
  for (let tries = 0; tries < 60 && !((await order()).startsWith("Bravo,") && (await order()).endsWith(",Delta")); tries++) await page.waitForTimeout(100);
  expect((await order()).startsWith("Bravo,") && (await order()).endsWith(",Delta"), `after the reload: ${await order()}`);
  expect((await visible(page.getByRole("combobox", { name: "Sort by" })).innerText()).includes("Size"), "the sort control still says Size");
  expect((await pinned()) === "Bravo", "the pin is still there");
});
await step("screenshots: wide and 390, light and dark", async () => {
  await cardMenu("Delta", "Pin"); await sortBy("Last modified"); await sortBy("Descending"); await until(pinned, "Bravo,Delta", "two pinned");
  await page.mouse.move(700, 880);
  await page.screenshot({ path: `${shots}/wide-light.png` });
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/wide-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/390-dark.png` });
  await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/390-light.png` });
  expect((await pinned()) === "Bravo,Delta", `on the phone layout the marks are there: ${await pinned()}`);
  expect((await order()).split(",").slice(0, 2).sort().join(",") === "Bravo,Delta", `on the phone layout the pinned ones are first: ${await order()}`);
});
await browser.close();
console.log(`\n${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
