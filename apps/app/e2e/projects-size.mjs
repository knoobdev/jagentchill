// UTF-8 project size ordering through the Projects screen on a production web build.
// Two one-code-unit names have different UTF-8 byte lengths; the test creates them in reverse order so a text.length
// implementation (which ties and falls back to Modified) produces the wrong descending order.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w7-shell/projects-size";
const base = process.argv[3] ?? "http://localhost:8083";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const sortBy = async (name) => { await visible(page.getByRole("combobox", { name: "Sort by" })).click(); await visible(page.getByRole("option", { name, exact: true })).click(); };
const listed = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="project-"]')].filter((node) => node.getBoundingClientRect().width > 0 && !node.closest('[data-testid="sidebar"]')).map((node) => ({ name: node.getAttribute("data-testid").slice(8), x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })).sort((a, b) => a.y - b.y || a.x - b.x).map((node) => node.name).join(","));
const until = async (want) => { for (let i = 0; i < 100; i++) { const got = await listed(); if (got === want) return got; await page.waitForTimeout(100); } throw new Error(`size order ${await listed()}, expected ${want}`); };
let failure;
try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  for (const [index, name] of ["日", "A"].entries()) {
    await button(index === 0 ? "Create your first project" : "New project").click({ timeout: 60_000 });
    await page.waitForURL(/\/editor\//); await button("Rename: New project").click();
    await page.getByLabel("Project name").fill(name); await page.keyboard.press("Enter");
    await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
    await button("Editor menu").click(); await visible(page.getByRole("menuitem", { name: "Back to projects" })).click();
    await visible(page.getByRole("heading", { name: "Projects", exact: true })).waitFor();
  }
  const byteLengths = await page.evaluate(() => ({ japanese: new TextEncoder().encode("日").byteLength, ascii: new TextEncoder().encode("A").byteLength }));
  if (byteLengths.japanese !== 3 || byteLengths.ascii !== 1) throw new Error(`unexpected UTF-8 fixture lengths: ${JSON.stringify(byteLengths)}`);
  await sortBy("Size"); await sortBy("Descending");
  await until("日,A");
  await page.screenshot({ path: `${shots}/size-descending-utf8.png` });
  console.log(`ok  Size descending follows bytes: 日=${byteLengths.japanese} bytes before A=${byteLengths.ascii} byte; old UTF-16 length ties and fails`);
} catch (error) { failure = error; await page.screenshot({ path: `${shots}/failure.png` }).catch(() => undefined); }
finally { await browser.close(); }
if (failure || errors.length) { console.error(failure ? String(failure).split("\n")[0] : errors.join("\n")); process.exitCode = 1; }
else console.log("1/1 browser assertion passes; both projects were created and renamed through the UI; no fixture data was seeded.");
