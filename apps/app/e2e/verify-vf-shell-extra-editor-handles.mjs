// Evidence extension: original 22 handles plus every visible audio handle and numeric scrub.
// Every drag handle of the app, with the real mouse on the PRODUCTION web build: the cursor says what the drag does —
// on hover AND during the drag after the pointer has left the handle — and no text gets selected while dragging.
// No host is needed; real storage of a fresh browser profile; one real H.264 clip made with ffmpeg. Nothing is mocked.
// The cursor read is the one the browser shows: the element holding the pointer capture if there is one, else the
// element under the pointer.
// Usage: node apps/app/e2e/cursors.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w7-shell/cursors";
const base = process.argv[3] ?? "http://localhost:8083";
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), "jagentchill-cursors-e2e");
mkdirSync(dir, { recursive: true });
const clip = join(dir, "red.mp4");
if (!existsSync(clip)) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  // Which element holds the pointer: the browser shows THAT element's cursor during a captured drag.
  const set = Element.prototype.setPointerCapture, release = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (id) { window.__captured = this; return set.call(this, id); };
  Element.prototype.releasePointerCapture = function (id) { if (window.__captured === this) window.__captured = null; return release.call(this, id); };
  window.addEventListener("pointerup", () => { window.__captured = null; }, true);
  window.__cursorAt = (x, y) => {
    const node = window.__captured?.isConnected ? window.__captured : document.elementFromPoint(x, y);
    return node ? getComputedStyle(node).cursor : "none";
  };
  window.__selectable = (x, y) => { const node = document.elementFromPoint(x, y); return node ? getComputedStyle(node).userSelect : "?"; };
});
const page = await context.newPage();
const errors = [], results = [], rows = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push("ok"); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join("\n")); errors.push(`step failed: ${name}`); results.push("FAIL"); }
};
const cursorAt = (x, y) => page.evaluate(([px, py]) => window.__cursorAt(px, py), [x, y]);
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
async function markedHandles(screen) {
  const result = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-draghandle]")].filter((node) => node.getClientRects().length);
    return { count: nodes.length, wrong: nodes.filter((node) => { const want = node.getAttribute("data-draghandle"); return want && getComputedStyle(node).cursor !== want; }).map((node) => `${node.getAttribute("data-testid") ?? node.getAttribute("aria-label") ?? node.tagName}: ${getComputedStyle(node).cursor} ≠ ${node.getAttribute("data-draghandle")}`) };
  });
  expect(result.wrong.length === 0, `${screen}: ${result.wrong.join("; ")}`);
  console.log(`     ${screen}: ${result.count}/${result.count} visible marked handles match their cursor`);
}

/**
 * One handle: the cursor over it, then pressed and moved `away` (far outside the handle) the cursor and whether text can
 * be selected there, then released. `hover`/`drag` are the cursors it must show; `drag` defaults to `hover`.
 */
async function probe(name, at, want, away = { dx: 70, dy: 55 }) {
  const wantDrag = want.drag ?? want.hover;
  await page.mouse.move(at.x - 1, at.y - 1); await page.mouse.move(at.x, at.y); await page.waitForTimeout(60);
  const hover = await cursorAt(at.x, at.y);
  await page.mouse.down();
  const to = { x: at.x + away.dx, y: at.y + away.dy };
  await page.mouse.move(at.x + away.dx / 2, at.y + away.dy / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.waitForTimeout(60);
  const drag = await cursorAt(to.x, to.y), select = await page.evaluate(([px, py]) => window.__selectable(px, py), [to.x, to.y]);
  if (want.shot) await page.screenshot({ path: `${shots}/${want.shot}.png` });
  // Back to where it was pressed, so the probe changes nothing for the next one.
  await page.mouse.move(at.x, at.y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-dragging"));
  const ok = hover === want.hover && drag === wantDrag && select === "none" && after === null;
  rows.push({ handle: name, hover, wantHover: want.hover, drag, wantDrag, textSelectWhileDragging: select, ok });
  console.log(`     ${ok ? "ok  " : "BAD "} ${name}: hover ${hover} (want ${want.hover}) · dragging, pointer off the handle ${drag} (want ${wantDrag}) · text select ${select}`);
  return ok;
}
/** Every visible separator with an orientation is a splitter: it must show the cursor of its axis. */
async function separators(where) {
  const found = await page.evaluate(() => [...document.querySelectorAll('[role="separator"][aria-orientation]')].map((node, index) => {
    const rect = node.getBoundingClientRect();
    return { index, orientation: node.getAttribute("aria-orientation"), label: node.getAttribute("aria-label") ?? node.getAttribute("data-testid") ?? "", testid: node.getAttribute("data-testid") ?? "", x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }).filter((entry) => entry.width > 0 && entry.height > 0));
  let bad = 0;
  for (const entry of found) {
    const vertical = entry.orientation === "vertical";
    // Pressed 1/3 along the handle: its middle may be covered by a panel's own control.
    const at = vertical ? { x: entry.x + entry.width / 2, y: entry.y + entry.height / 3 } : { x: entry.x + entry.width / 3, y: entry.y + entry.height / 2 };
    const on = await page.evaluate(([px, py, index]) => { const node = document.querySelectorAll('[role="separator"][aria-orientation]')[index], hit = document.elementFromPoint(px, py); return Boolean(hit && (node.contains(hit) || hit.contains(node) || hit.closest("[data-draghandle]")?.contains(node))); }, [at.x, at.y, entry.index]);
    if (!on) { console.log(`     skip ${where}: “${entry.label}” is covered at its probe point`); continue; }
    if (!(await probe(`${where} — splitter “${entry.label || entry.testid}” (${entry.orientation})`, at, { hover: vertical ? "col-resize" : "row-resize" }, vertical ? { dx: 40, dy: 120 } : { dx: 120, dy: 40 }))) bad++;
  }
  return { count: found.length, bad };
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };

await step("Shell: the sidebar's edge", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByRole("button", { name: "Create your first project", exact: true })).waitFor({ timeout: 90_000 });
  const result = await separators("Projects");
  await markedHandles("Projects shell");
  expect(result.count >= 1 && result.bad === 0, `${result.bad} of ${result.count} wrong`);
});
await step("Editor: asset panel, inspector, timeline and agent panel splitters", async () => {
  await visible(page.getByRole("button", { name: "Create your first project", exact: true })).click();
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (!(await page.getByTestId("agent-panel-splitter").filter({ visible: true }).count())) { await tid("toggle-agent").click().catch(() => {}); await page.waitForTimeout(600); }
  const result = await separators("Editor");
  await markedHandles("Editor");
  await page.screenshot({ path: `${shots}/editor.png` });
  expect(result.count >= 4 && result.bad === 0, `${result.bad} of ${result.count} wrong`);
});
await step("Timeline: a clip's two edges trim (ew-resize), its body moves (grab → grabbing)", async () => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles([clip]);
  await tid("label-red.mp4").waitFor({ timeout: 60_000 });
  await tid("thumb-red.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1, null, { timeout: 30_000 });
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => { const node = [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].find((entry) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(entry.getAttribute("data-testid"))); const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
  const y = box.y + box.height / 2;
  let bad = 0;
  if (!(await probe("Timeline — clip end edge (trim)", { x: box.x + box.width - 3, y }, { hover: "ew-resize", shot: "clip-trim-dragging" }, { dx: -40, dy: -160 }))) bad++;
  if (!(await probe("Timeline — clip start edge (trim)", { x: box.x + 3, y }, { hover: "ew-resize" }, { dx: 40, dy: -160 }))) bad++;
  if (!(await probe("Timeline — clip body (move)", { x: box.x + box.width / 2, y }, { hover: "grab", drag: "grabbing" }, { dx: 30, dy: -160 }))) bad++;
  expect(bad === 0, `${bad} wrong`);
});
await step("Player: the eight scale handles, the rotate handle and the picture itself", async () => {
  const box = await page.evaluate(() => { const node = [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].find((entry) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(entry.getAttribute("data-testid"))); const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await tid("handle-rotate").waitFor({ timeout: 10_000 });
  const handles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="handle-"]')].map((node) => { const rect = node.getBoundingClientRect(); return { id: node.getAttribute("data-testid"), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }));
  // The box is not rotated: corners resize along their diagonal, edges along their axis.
  const want = { "handle-nw": "nwse-resize", "handle-se": "nwse-resize", "handle-ne": "nesw-resize", "handle-sw": "nesw-resize", "handle-n": "ns-resize", "handle-s": "ns-resize", "handle-e": "ew-resize", "handle-w": "ew-resize" };
  let bad = 0, seen = 0;
  for (const handle of handles) {
    const cursor = want[handle.id]; if (!cursor && handle.id !== "handle-rotate") continue;
    seen++;
    const now = await page.evaluate((id) => { const rect = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }, handle.id);
    if (!(await probe(`Player — ${handle.id}`, now, handle.id === "handle-rotate" ? { hover: "grab", drag: "grabbing" } : { hover: cursor }, { dx: 14, dy: 10 }))) bad++;
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z"); await page.waitForTimeout(150);
  }
  const canvas = centre(await tid("canvas").boundingBox());
  if (!(await probe("Player — the selected picture (move)", canvas, { hover: "move", shot: "player-move-dragging" }, { dx: 30, dy: 20 }))) bad++;
  await page.screenshot({ path: `${shots}/player.png` });
  expect(seen === 9 && bad === 0, `${seen} handles, ${bad} wrong`);
});
await step("Inspector: a number's label scrubs (ew-resize)", async () => {
  const handle = await tid("scrub-handle").boundingBox();
  expect(handle, "a number field with a scrub label is on screen");
  const at = centre(handle);
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(60);
  const hover = await cursorAt(at.x, at.y);
  rows.push({ handle: "Inspector — number label (scrub; the pointer is locked and hidden while it drags)", hover, wantHover: "ew-resize", drag: "(pointer lock)", wantDrag: "(pointer lock)", textSelectWhileDragging: "n/a", ok: hover === "ew-resize" });
  console.log(`     ${hover === "ew-resize" ? "ok  " : "BAD "} Inspector — number label: hover ${hover} (want ew-resize)`);
  expect(hover === "ew-resize", `hover ${hover}`);
});
await step("Every visible audio fade/volume handle and number scrub label on this editor", async()=>{
 const sound=await page.locator('[data-testid="volume-line"], [data-testid="fade-handle-in"], [data-testid="fade-handle-out"], [data-testid="volume-point"], [data-testid="beat-dot"]').filter({visible:true}).all();console.log(`visible sound handles: ${sound.length}`);
 let bad=0;
 for(const [i,node] of sound.entries()){const b=await node.boundingBox(),id=await node.getAttribute("data-testid");if(!b)continue;const want=["volume-line","volume-point"].includes(id)?"ns-resize":"ew-resize";if(!await probe(`${id} ${i}`,centre(b),{hover:want}, {dx:70,dy:-100}))bad++;await page.keyboard.press(process.platform==="darwin"?"Meta+z":"Control+z");}
 const scrubs=await page.getByTestId("scrub-handle").filter({visible:true}).all();console.log(`visible number scrub labels: ${scrubs.length}`);
 for(const [i,node] of scrubs.entries()){await node.scrollIntoViewIfNeeded();const b=await node.boundingBox();if(!b)continue;if(!await probe(`number scrub ${i}`,centre(b),{hover:"ew-resize"},{dx:70,dy:50}))bad++;await page.keyboard.press("Escape");await page.keyboard.press(process.platform==="darwin"?"Meta+z":"Control+z");}
 await page.screenshot({path:`${shots}/audio-scrubs.png`});expect(bad===0,`${bad} audio/scrub handles wrong`);
});

await step("Script editor: navigator and inspector splitters", async () => {
  await page.goto(`${base}/scripts`, { waitUntil: "networkidle" });
  await visible(page.getByRole("button", { name: "New script from a format", exact: true })).click({ timeout: 60_000 });
  await visible(page.getByRole("menuitem")).click();
  await page.waitForURL(/\/scripts\/[\w-]+$/, { timeout: 30_000 });
  await tid("script-navigator").waitFor({ timeout: 60_000 });
  await tid("navigator-splitter").waitFor({ timeout: 30_000 });
  if (!(await page.getByTestId("script-inspector").filter({ visible: true }).count())) await tid("toggle-script-inspector").click().catch(() => {});
  await page.waitForTimeout(700);
  const result = await separators("Script editor");
  await markedHandles("Script editor");
  await page.screenshot({ path: `${shots}/script-editor.png` });
  expect(result.count >= 2 && result.bad === 0, `${result.bad} of ${result.count} wrong`);
});
await step("Every element marked as a drag handle shows the cursor it is marked with (a new handle without the primitive fails the steps above; a marked one cannot disagree)", async () => {
  await markedHandles("current screen");
});

writeFileSync(`${shots}/handles.json`, JSON.stringify(rows, null, 2));
await browser.close();
console.log(`\nhandles: ${rows.filter((row) => row.ok).length}/${rows.length} right`);
console.log(`${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
