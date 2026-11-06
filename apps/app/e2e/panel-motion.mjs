// End-to-end in a real browser on the PRODUCTION web build, with no host: every panel that opens from an edge slides
// (`design-system.Motion tokens`). Each panel's box is sampled once per animation frame while it opens and closes: a
// slide shows as a run of sizes or positions between closed and open; under reduced motion there is none. Also: an
// overlay does not outlive the screen that owns it (a menu item that navigates leaves no scrim on the next screen).
// Usage: node apps/app/e2e/panel-motion.mjs [screenshot-dir] [base-url]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/ui-polish";
const base = process.argv[3] ?? "http://localhost:8097";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [], results = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push("ok"); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 4).join("\n")); errors.push(`step failed: ${name}`); results.push("FAIL"); await page.screenshot({ path: `${shots}/m-failure-${results.length}.png` }).catch(() => undefined); }
};
/** One value of the element's box per animation frame, from just before `act` until `ms` later; null while it is not in the tree. */
const sample = async (testId, prop, act, ms = 600) => {
  await page.evaluate(([id, key, span]) => {
    window.__samples = [];
    const from = performance.now();
    const tick = () => {
      const node = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((entry) => entry.getClientRects().length > 0) ?? null;
      window.__samples.push(node ? Math.round(node.getBoundingClientRect()[key]) : null);
      if (performance.now() - from < span) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [testId, prop, ms]);
  await act();
  await page.waitForTimeout(ms + 150);
  return page.evaluate(() => window.__samples);
};
const distinct = (values) => [...new Set(values.filter((value) => value !== null))];
const settled = async () => expect((await page.locator('[data-settled="false"]').count()) === 0, "nothing is still moving 750 ms after the change");
/** Opens or closes a panel with `act` and says how it moved. */
async function slides(name, testId, prop, act) {
  const values = await sample(testId, prop, act);
  const seen = distinct(values);
  console.log(`     ${name}: ${seen.length} positions over ${values.length} frames (${Math.min(...seen)} … ${Math.max(...seen)})`);
  expect(seen.length >= 5, `${name} slides: ${JSON.stringify(seen.slice(0, 12))}`);
  await settled();
}
async function jumps(name, testId, prop, act) {
  const seen = distinct(await sample(testId, prop, act));
  console.log(`     ${name} (reduced motion): ${JSON.stringify(seen)}`);
  expect(seen.length <= 2, `${name} does not slide under reduced motion: ${JSON.stringify(seen.slice(0, 12))}`);
}
/** Three pictures taken while `act` is still moving its panel. */
async function frames(name, act) { await act(); for (const n of [1, 2, 3]) await page.screenshot({ path: `${shots}/m-${name}-f${n}.png` }); await page.waitForTimeout(500); }
const collapse = () => tid("sidebar").getByRole("button", { name: "Collapse sidebar", exact: true }).click();

await step("Shell sidebar: collapses to the inline-start edge and comes back, sliding; at once under reduced motion", async () => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await tid("sidebar").waitFor({ timeout: 120_000 });
  await slides("sidebar collapse", "sidebar-slot", "width", collapse);
  expect((await page.getByTestId("sidebar-slot").count()) === 0, "a collapsed sidebar is out of the tree");
  // The shortcut that brings it back is Mod+\\: Meta on macOS, Control elsewhere.
  await page.keyboard.press("Meta+\\"); await page.waitForTimeout(500);
  const key = (await page.getByTestId("sidebar-slot").count()) ? "Meta+\\" : "Control+\\";
  if (key === "Control+\\") { await page.keyboard.press(key); await page.waitForTimeout(500); }
  await tid("sidebar").waitFor();
  await collapse(); await page.waitForTimeout(500);
  await slides("sidebar expand", "sidebar-slot", "width", () => page.keyboard.press(key));
  await frames("sidebar", collapse);
  await page.keyboard.press(key); await tid("sidebar").waitFor(); await page.waitForTimeout(500);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(200);
  await jumps("sidebar collapse", "sidebar-slot", "width", collapse);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press(key); await tid("sidebar").waitFor();
});

let editorUrl = "";
await step("Editor (wide): asset panel, inspector, timeline and agent panel slide to and from their edges", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  editorUrl = page.url();
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  for (const [name, toggle, panel, prop] of [["asset panel", "toggle-assets", "panel-assets", "width"], ["inspector", "toggle-inspector", "panel-inspector", "width"], ["timeline", "toggle-timeline", "panel-timeline", "height"]]) {
    await slides(`${name} close`, panel, prop, () => tid(toggle).click());
    expect(!(await page.getByTestId(panel).isVisible()), `${name} is hidden once closed`);
    await slides(`${name} open`, panel, prop, () => tid(toggle).click());
  }
  await frames("assets", () => tid("toggle-assets").click());
  await tid("toggle-assets").click(); await page.waitForTimeout(500);
  if (await page.getByTestId("agent-panel-slot").count()) { await tid("toggle-agent").click(); await page.waitForTimeout(500); }
  await slides("agent panel open", "agent-panel-slot", "width", () => tid("toggle-agent").click());
  await tid("agent-panel").waitFor();
  await slides("agent panel close", "agent-panel-slot", "width", () => tid("toggle-agent").click());
  expect((await page.getByTestId("agent-panel").count()) === 0, "a closed agent panel is out of the tree");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(200);
  await jumps("asset panel close", "panel-assets", "width", () => tid("toggle-assets").click());
  await jumps("agent panel open", "agent-panel-slot", "width", () => tid("toggle-agent").click());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tid("toggle-assets").click(); await tid("toggle-agent").click(); await page.waitForTimeout(400);
});

/**
 * One frame at a time, from just before `act` until 700 ms later: where the panel's moving edge is and where the edge of
 * its neighbour is. They must agree within 1 px in every frame (the neighbour moves WITH the panel, it does not jump
 * before or after it), and the panel must not jump in a single frame over more than half of its travel.
 */
async function coupled(name, panel, panelSide, other, otherSide, act) {
  await page.evaluate(([panelId, side, otherSpec, otherEdge, span]) => {
    window.__pairs = [];
    const from = performance.now();
    const find = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].find((entry) => entry.getClientRects().length > 0) ?? null;
    const edge = (node, which) => (node ? node.getBoundingClientRect()[which] : null);
    const tick = () => {
      const node = find(panelId);
      const neighbour = otherSpec === "prev" ? node?.previousElementSibling : otherSpec === "next" ? node?.nextElementSibling : find(otherSpec);
      window.__pairs.push({ t: performance.now() - from, a: edge(node, side), b: edge(neighbour, otherEdge) });
      if (performance.now() - from < span) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [panel, panelSide, other, otherSide, 700]);
  await act();
  await page.waitForTimeout(850);
  const pairs = (await page.evaluate(() => window.__pairs)).filter((pair) => pair.a !== null && pair.b !== null);
  const worst = Math.max(...pairs.map((pair) => Math.abs(pair.a - pair.b)));
  const track = pairs.map((pair) => pair.a), travel = Math.max(...track) - Math.min(...track);
  const step = Math.max(0, ...track.slice(1).map((value, index) => Math.abs(value - track[index])));
  const gaps = pairs.slice(1).map((pair, index) => pair.t - pairs[index].t);
  console.log(`     ${name}: ${pairs.length} frames, edges differ by at most ${worst.toFixed(1)} px, travel ${Math.round(travel)} px, largest step ${Math.round(step)} px, longest frame ${Math.round(Math.max(0, ...gaps))} ms`);
  expect(worst <= 1.01, `${name}: the panel's edge and its neighbour's edge disagree by ${worst.toFixed(1)} px in one frame`);
  expect(travel < 20 || step <= travel * 0.5, `${name}: the panel jumped ${Math.round(step)} px of ${Math.round(travel)} in one frame`);
  await settled();
}
await step("Neighbours move with their panel in every frame: sidebar, asset panel, inspector, timeline, agent panel", async () => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await tid("sidebar").waitFor({ timeout: 60_000 });
  await coupled("sidebar collapse", "sidebar-slot", "right", "next", "left", collapse);
  await page.keyboard.press("Meta+\\"); await page.waitForTimeout(500);
  if (!(await page.getByTestId("sidebar-slot").count())) { await page.keyboard.press("Control+\\"); await page.waitForTimeout(500); }
  await tid("sidebar").waitFor();
  await coupled("sidebar collapse again", "sidebar-slot", "right", "next", "left", collapse);
  await page.keyboard.press("Meta+\\"); await page.waitForTimeout(500);
  if (!(await page.getByTestId("sidebar-slot").count())) { await page.keyboard.press("Control+\\"); await page.waitForTimeout(500); }
  await tid("sidebar").waitFor();
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  for (const id of ["asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (await page.getByTestId("agent-panel-slot").count()) { await tid("toggle-agent").click(); await page.waitForTimeout(600); }
  await coupled("asset panel close", "panel-assets", "right", "panel-player", "left", () => tid("toggle-assets").click());
  await coupled("asset panel open", "panel-assets", "right", "panel-player", "left", () => tid("toggle-assets").click());
  await coupled("inspector close", "panel-inspector", "left", "panel-player", "right", () => tid("toggle-inspector").click());
  await coupled("inspector open", "panel-inspector", "left", "panel-player", "right", () => tid("toggle-inspector").click());
  await coupled("timeline close", "panel-timeline", "top", "panel-top", "bottom", () => tid("toggle-timeline").click());
  await coupled("timeline open", "panel-timeline", "top", "panel-top", "bottom", () => tid("toggle-timeline").click());
  await coupled("agent panel open", "agent-panel-slot", "left", "prev", "right", () => tid("toggle-agent").click());
  await coupled("player follows the agent panel", "panel-player", "right", "panel-inspector", "left", () => tid("toggle-agent").click());
  await coupled("agent panel open again", "agent-panel-slot", "left", "prev", "right", () => tid("toggle-agent").click());
  await coupled("agent panel close", "agent-panel-slot", "left", "prev", "right", () => tid("toggle-agent").click());
});

await step("An overlay leaves with its screen: a menu item that navigates leaves no scrim on the next screen, and none when coming back", async () => {
  await page.goto(`${base}/scripts`, { waitUntil: "networkidle" });
  await button("New script from a format").click({ timeout: 60_000 });
  await visible(page.getByRole("menuitem")).click();
  await page.waitForURL(/\/scripts\/[\w-]+$/, { timeout: 30_000 });
  // The screen behind is hidden a moment after the address changes: the overlay goes with it, within a few frames.
  const started = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="scrim"], [role="menu"]')].every((node) => node.getClientRects().length === 0), null, { timeout: 250, polling: "raf" });
  console.log(`     scrim and menu gone ${Date.now() - started} ms after the navigation`);
  await page.waitForTimeout(600);
  expect((await page.locator('[data-testid="scrim"]').filter({ visible: true }).count()) === 0, "none later either");
  await page.goBack();
  await button("New script from a format").waitFor({ timeout: 30_000 });
  const back = await sample("scrim", "width", async () => {}, 400);
  expect(back.every((value) => value === null), "back on the list no scrim plays an exit");
  await button("New script from a format").click();
  await visible(page.getByRole("menuitem")).waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("popover").waitFor({ state: "hidden" });
});

await step("Compact (390×844): the navigation drawer, the Agent sheet and a tool sheet slide from their edges", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await button("Open navigation").waitFor({ timeout: 60_000 });
  await slides("drawer open", "drawer", "x", () => button("Open navigation").click());
  await slides("drawer close", "drawer", "x", () => page.keyboard.press("Escape"));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  for (const id of ["compact-preview", "compact-timeline", "compact-toolbar"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await slides("agent sheet open", "agent-sheet", "y", () => tid("compact-agent").click());
  await frames("agent-sheet", async () => { await tid("agent-panel-close").click(); await page.waitForTimeout(400); await tid("compact-agent").click(); });
  await slides("agent sheet close", "agent-sheet", "y", () => tid("agent-panel-close").click());
  // The first tool of the toolbar that opens a sheet.
  const tools = await page.evaluate(() => [...document.querySelectorAll('[data-testid="compact-toolbar"] [data-testid^="tool-"]')].map((node) => node.getAttribute("data-testid")).filter((id) => id !== "tool-back"));
  let opener = null;
  for (const id of tools) {
    await tid(id).click(); await page.waitForTimeout(500);
    if (await page.getByTestId("tool-sheet").count()) { opener = id; break; }
    if (await page.getByTestId("tool-back").count()) { await tid("tool-back").click(); await page.waitForTimeout(300); }
  }
  expect(opener !== null, `a tool of ${JSON.stringify(tools)} opens a sheet`);
  await slides("tool sheet close", "tool-sheet-slot", "height", () => tid("tool-sheet-close").click());
  await tid("compact-toolbar").waitFor();
  await slides(`tool sheet open (${opener})`, "tool-sheet-slot", "height", () => tid(opener).click());
  await tid("tool-sheet-close").click(); await page.waitForTimeout(400);
  await frames("tool-sheet", () => tid(opener).click());
});

await browser.close();
console.log(`\n${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
