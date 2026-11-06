// Every splitter of the app, driven with the real mouse on the PRODUCTION web build: it moves its panel, stops at its
// limits, and the size is still there after a reload. (Regression of the panel motion work: the PanelGroup grips did not drag.)
// Usage: node apps/app/e2e/splitters.mjs [base-url]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8095";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [], results = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push("ok"); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join("\n")); errors.push(`step failed: ${name}`); results.push("FAIL"); }
};
const box = async (id) => (await tid(id).boundingBox());
/** Presses at (x, y), moves by (dx, dy) in steps and releases. */
async function drag(x, y, dx, dy) {
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 }); await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up(); await page.waitForTimeout(350);
}
/** The grip of a PanelGroup: the n-th visible separator of the given orientation, pressed 2 px inside its panel's edge. */
async function grip(orientation, n = 0) {
  const handles = page.locator(`[role="separator"][aria-orientation="${orientation}"]`).filter({ visible: true });
  const found = await handles.nth(n).boundingBox();
  const at = orientation === "vertical" ? { x: found.x + 2, y: found.y + found.height / 2 } : { x: found.x + found.width / 2, y: found.y + 2 };
  // The grip shows the cursor of its axis, not the hand of the pressable inside it (every handle: `cursors.mjs`).
  await page.mouse.move(at.x, at.y);
  const cursor = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [at.x, at.y]);
  expect(cursor === (orientation === "vertical" ? "col-resize" : "row-resize"), `the ${orientation} grip ${n} shows the cursor “${cursor}”`);
  return at;
}
const widthOf = async (id) => Math.round((await box(id)).width), heightOf = async (id) => Math.round((await box(id)).height);

let editorUrl = "";
await step("Editor: the asset panel's splitter widens and narrows it within 15–40 % (280 px at least) of the group", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByRole("button", { name: "Create your first project", exact: true })).click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  editorUrl = page.url();
  await page.waitForTimeout(800);
  const group = (await box("editor-regions")).width, start = await widthOf("panel-assets");
  let at = await grip("vertical", 0);
  await drag(at.x, at.y, 60, 0);
  const wider = await widthOf("panel-assets");
  expect(wider > start + 40, `assets ${start} → ${wider}`);
  at = await grip("vertical", 0); await drag(at.x, at.y, 900, 0);
  const max = await widthOf("panel-assets");
  expect(max <= group * 0.4 + 2 && max > wider, `assets stop at 40 %: ${max} of ${group}`);
  at = await grip("vertical", 0); await drag(at.x, at.y, -900, 0);
  const min = await widthOf("panel-assets");
  expect(min >= 270 && min <= group * 0.2, `assets stop at the minimum: ${min}`);
  at = await grip("vertical", 0); await drag(at.x, at.y, 100, 0);
});
await step("Editor: the inspector's splitter widens and narrows it within its limits", async () => {
  const group = (await box("editor-regions")).width, start = await widthOf("panel-inspector");
  let at = await grip("vertical", 1);
  await drag(at.x, at.y, -60, 0);
  const wider = await widthOf("panel-inspector");
  expect(wider > start + 40, `inspector ${start} → ${wider}`);
  at = await grip("vertical", 1); await drag(at.x, at.y, -900, 0);
  expect((await widthOf("panel-inspector")) <= group * 0.4 + 2, "inspector stops at 40 %");
  at = await grip("vertical", 1); await drag(at.x, at.y, 900, 0);
  expect((await widthOf("panel-inspector")) >= 270, "inspector stops at its minimum");
  at = await grip("vertical", 1); await drag(at.x, at.y, -80, 0);
});
await step("Editor: the timeline's splitter moves its top edge between 15 % and 70 %", async () => {
  const start = await heightOf("panel-timeline");
  let at = await grip("horizontal", 0);
  await drag(at.x, at.y, 0, -80);
  const taller = await heightOf("panel-timeline");
  expect(taller > start + 50, `timeline ${start} → ${taller}`);
  at = await grip("horizontal", 0); await drag(at.x, at.y, 0, -900);
  const column = (await box("editor-regions")).height;
  expect((await heightOf("panel-timeline")) <= column * 0.7 + 2, "timeline stops at 70 %");
  at = await grip("horizontal", 0); await drag(at.x, at.y, 0, 900);
  expect((await heightOf("panel-timeline")) >= column * 0.15 - 2, "timeline stops at 15 %");
  at = await grip("horizontal", 0); await drag(at.x, at.y, 0, -120);
});
await step("Editor: double press on a grip restores the default size", async () => {
  const at = await grip("vertical", 0);
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up(); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(350);
  const group = (await box("editor-regions")).width, width = await widthOf("panel-assets");
  expect(Math.abs(width - group * 0.25) < group * 0.03, `assets default ${width} of ${group}`);
});
await step("Editor: the sizes are still there after a reload", async () => {
  const before = [await widthOf("panel-assets"), await widthOf("panel-inspector"), await heightOf("panel-timeline")];
  let at = await grip("vertical", 1); await drag(at.x, at.y, -50, 0);
  const moved = [await widthOf("panel-assets"), await widthOf("panel-inspector"), await heightOf("panel-timeline")];
  expect(moved[1] > before[1] + 30, `inspector moved ${before[1]} → ${moved[1]}`);
  await page.reload({ waitUntil: "networkidle" });
  for (const id of ["asset-panel", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const after = [await widthOf("panel-assets"), await widthOf("panel-inspector"), await heightOf("panel-timeline")];
  expect(moved.every((value, index) => Math.abs(value - after[index]) <= 3), `kept ${JSON.stringify(moved)} → ${JSON.stringify(after)}`);
});
await step("Editor: the agent panel's splitter widens it and stops at 320 px and at 40 % of the editor", async () => {
  if (!(await page.getByTestId("agent-panel-slot").count())) await tid("toggle-agent").click();
  await tid("agent-panel-splitter").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const editor = (await box("editor-regions")).width, start = (await box("agent-panel-slot")).width;
  let handle = await box("agent-panel-splitter");
  await drag(handle.x + handle.width / 2, handle.y + 300, -80, 0);
  const wider = (await box("agent-panel-slot")).width;
  expect(wider > start + 50, `agent ${start} → ${wider}`);
  handle = await box("agent-panel-splitter"); await drag(handle.x + handle.width / 2, handle.y + 300, -1200, 0);
  expect((await box("agent-panel-slot")).width <= editor * 0.4 + 2, "agent stops at 40 %");
  handle = await box("agent-panel-splitter"); await drag(handle.x + handle.width / 2, handle.y + 300, 1200, 0);
  const min = (await box("agent-panel-slot")).width;
  expect(min >= 318 && min <= 322, `agent stops at 320: ${min}`);
});
await step("Shell: the sidebar's splitter resizes it within its limits", async () => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await tid("sidebar").waitFor({ timeout: 60_000 });
  const start = (await box("sidebar-slot")).width;
  const handle = page.getByRole("separator", { name: "Resize sidebar" }).filter({ visible: true }).first();
  let at = await handle.boundingBox();
  await drag(at.x + at.width / 2, at.y + 300, 60, 0);
  const wider = (await box("sidebar-slot")).width;
  expect(wider > start + 40, `sidebar ${start} → ${wider}`);
  at = await handle.boundingBox(); await drag(at.x + at.width / 2, at.y + 300, 900, 0);
  const max = (await box("sidebar-slot")).width;
  at = await handle.boundingBox(); await drag(at.x + at.width / 2, at.y + 300, -900, 0);
  const min = (await box("sidebar-slot")).width;
  expect(max < 500 && min > 180 && min < start, `sidebar limits ${min}…${max}`);
});
await step("Script editor: the navigator and inspector splitters resize their panels", async () => {
  await page.goto(`${base}/scripts`, { waitUntil: "networkidle" });
  await visible(page.getByRole("button", { name: "New script from a format", exact: true })).click({ timeout: 60_000 });
  await visible(page.getByRole("menuitem")).click();
  await page.waitForURL(/\/scripts\/[\w-]+$/, { timeout: 30_000 });
  await tid("script-navigator").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const before = (await box("script-navigator")).width;
  let at = await box("navigator-splitter"); await drag(at.x + at.width / 2, at.y + 200, 70, 0);
  const after = (await box("script-navigator")).width;
  expect(after > before + 40, `navigator ${before} → ${after}`);
  if (await page.getByTestId("agent-panel-slot").count()) { await tid("toggle-agent").click(); await page.waitForTimeout(500); }
  if (!(await page.getByTestId("script-inspector").filter({ visible: true }).count())) await tid("toggle-script-inspector").click();
  await tid("inspector-splitter").waitFor({ timeout: 30_000 }); await page.waitForTimeout(500);
  const inspector = (await box("script-inspector")).width;
  at = await box("inspector-splitter"); await drag(at.x + at.width / 2, at.y + 200, -70, 0);
  const wider = (await box("script-inspector")).width;
  expect(wider > inspector + 40, `script inspector ${inspector} → ${wider}`);
});
await browser.close();
console.log(`\n${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
