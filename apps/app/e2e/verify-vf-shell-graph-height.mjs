// Evidence extension: 6 point drags plus graph height resize hover/off-handle.
// Evidence extension of cursor-point-surfaces.mjs: off-handle drag probes.
// Point-handle hover cursors on the user's editor path, production web build and real mouse.
// A short generated clip is imported through the UI. No host, model, or external data is used.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w7-shell/cursor-point-surfaces";
const base = process.argv[3] ?? "http://localhost:8083";
mkdirSync(shots, { recursive: true });
const clip = join(tmpdir(), "jagentchill-cursor-points.mp4");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const errors = [], measured = [];
await page.context().addInitScript(()=>{const set=Element.prototype.setPointerCapture; Element.prototype.setPointerCapture=function(id){window.__capture=this;return set.call(this,id)}; window.addEventListener("pointerup",()=>window.__capture=null,true);});
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (name) => visible(page.getByTestId(name));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const tab = (name) => visible(page.getByRole("tab", { name, exact: true }));
const expect = (ok, message) => { if (!ok) throw new Error(message); };
const cursor = (x, y) => page.evaluate(([px, py]) => { const element = document.elementFromPoint(px, py); return element ? getComputedStyle(element).cursor : "none"; }, [x, y]);
const probe = async (locator, label, shot) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); expect(box && box.width && box.height, `${label} is visible`);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(80);
  const got = await cursor(at.x, at.y), expected=label==="graph height edge"?"ns-resize":"grab";
  if (got !== expected) {
    const debug = await page.evaluate(([x, y]) => { const node = document.elementFromPoint(x, y), root = node?.closest('[data-testid="graph-easing-curve"]'); return { target: node?.tagName, rootCursor: root ? getComputedStyle(root).cursor : null, rootHandle: root?.getAttribute("data-draghandle"), rootRect: root?.getBoundingClientRect().toJSON() }; }, [at.x, at.y]);
    throw new Error(`${label}: expected grab on hover, got ${got} (${JSON.stringify(debug)})`);
  }
  await page.screenshot({ path: `${shots}/${shot}.png` });
  await page.mouse.down();
  await page.mouse.move(at.x+75,at.y+60,{steps:8}); await page.waitForTimeout(80);
  const drag=await page.evaluate(([x,y])=>{const node=window.__capture?.isConnected?window.__capture:document.elementFromPoint(x,y);return {cursor:node?getComputedStyle(node).cursor:"none",selection:node?getComputedStyle(node).userSelect:"none",holding:document.documentElement.getAttribute("data-dragging")}},[at.x+75,at.y+60]);
  await page.screenshot({path:`${shots}/${shot}-dragging.png`});
  await page.mouse.move(at.x,at.y,{steps:8}); await page.mouse.up();
  measured.push({handle:label,hover:got,drag:drag.cursor,selection:drag.selection,holding:drag.holding,ok:got===expected&&drag.cursor===(expected==="grab"?"grabbing":expected)&&drag.selection==="none"});
  console.log(`${measured.at(-1).ok?"ok":"BAD"} ${label}: hover=${got} drag-off=${drag.cursor} selection=${drag.selection}`);
};
const seek = async (seconds) => {
  const frame = Math.round(seconds * 30), value = `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`;
  await tid("timecode").click(); await tid("timecode").fill(value); await tid("timecode").press("Enter"); await page.waitForTimeout(200);
};
let failure;
try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 60_000 }); await page.waitForURL(/\/editor\//);
  await tid("editor-bar").waitFor({ timeout: 60_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles([clip]); await tid("label-jagentchill-cursor-points.mp4").waitFor({ timeout: 60_000 });
  await tid("thumb-jagentchill-cursor-points.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1, null, { timeout: 30_000 });
  await page.waitForTimeout(500);

  await tid("kf-opacity").waitFor(); await seek(0); await tid("kf-opacity").click(); await seek(1);
  const opacity = visible(page.getByRole("spinbutton", { name: "Opacity" }).or(page.getByLabel("Opacity", { exact: true }).locator("input")));
  await opacity.click(); await opacity.fill("0"); await opacity.press("Enter"); await page.waitForTimeout(250);
  const clipBox = await page.locator('[data-testid="track-main-video"] [data-testid^="clip-"]').first().boundingBox();
  await page.mouse.click(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2, { button: "right" });
  await visible(page.getByRole("menuitem", { name: "Expand keyframes", exact: true })).click(); await page.waitForTimeout(250);
  await probe(page.getByTestId("lane-key").first(), "keyframe diamond", "keyframe-diamond");

  await tid("tool-graph-editor").click(); await tid("graph-editor").waitFor();
  await probe(tid("graph-resize"),"graph height edge","graph-height");
  await probe(page.getByTestId("graph-key").first(), "graph-editor key point", "graph-point");
  const graphKey = await page.getByTestId("graph-key").first().boundingBox();
  await page.mouse.click(graphKey.x + 4, graphKey.y + 4); await page.waitForTimeout(150);
  await tid("graph-preset-ease-out").click(); await page.waitForTimeout(150);
  await probe(page.locator('[data-testid="graph-easing-curve"] circle').nth(1), "graph-editor easing handle", "graph-easing-handle");
  await tid("graph-close").click();

  await tab("Speed").click(); await visible(page.getByRole("tab", { name: "Curve", exact: true })).click();
  await tid("speed-preset-hero").click(); await tid("speed-curve").waitFor();
  await probe(page.locator('[data-testid="speed-curve"] circle').first(), "speed-curve point", "speed-curve-point");

  await tab("Adjustment").click(); await tid("adjust-curve").waitFor();
  await probe(page.locator('[data-testid="adjust-curve"] circle').first(), "tone-curve point", "tone-curve-point");
  await probe(tid("adjust-wheel-highlights-puck"), "colour-wheel puck", "colour-wheel-puck");
  console.log("6/6 point hover cursor assertions pass; screenshots show each UI surface; project and clip created via the UI, clip bytes generated locally with ffmpeg.");
} catch (error) { failure = error; await page.screenshot({ path: `${shots}/failure.png` }).catch(() => undefined); }
finally { const {writeFileSync}=await import("node:fs");writeFileSync(`${shots}/handles.json`,JSON.stringify(measured,null,2)); await browser.close(); }
if (failure || errors.length || measured.some(row=>!row.ok)) { console.error(failure ? String(failure).split("\n")[0] : errors.join("\n")); process.exitCode = 1; }
