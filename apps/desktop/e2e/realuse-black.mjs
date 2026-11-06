// The owner's report of 2026-10-07: after the agent's colour change the picture was BLACK when played, in the desktop app.
// This runs the desktop app (Electron, unattended: no window is shown) on a fresh library, imports ONE long real video,
// applies the very changes the agent's proposal held (read from a copy of that proposal: an adjustment layer over the
// whole clip, two cuts, a blur dissolve, a dip to black, a fade-in) to the project file, and reads the player's pixels
// paused AND while playing. Nothing here uses a model.
// Usage: node e2e/realuse-black.mjs <video file> <proposal.json> [--web <web build dir>] [--packaged <executable>] [--shots <dir>] [--only-colour]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { check, freshRun, launch, quit, sleep } from "./lib.mjs";

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const video = resolve(args[0]), proposalFile = resolve(args[1]);
const web = option("--web"), packaged = option("--packaged");
const run = freshRun("realuse");
const shots = resolve(option("--shots") ?? run.shots);
mkdirSync(shots, { recursive: true });
const env = web ? { JAGENTCHILL_WEB_DIR: resolve(web) } : {};
const results = [];
console.log(`run directory: ${run.dir}\nweb: ${web ?? "(the app's own)"}  packaged: ${packaged ?? "no (electron .)"}`);

const visible = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const go = (page, route) => page.evaluate((r) => { history.pushState({}, "", r); window.dispatchEvent(new PopStateEvent("popstate")); }, route);
/** Mean brightness (0–255) of the middle of the player's picture, and how much of it is nearly black. */
async function read(page, name) {
  const png = (await visible(page, "player").screenshot(name ? { path: join(shots, `${name}.png`) } : {})).toString("base64");
  return page.evaluate(async (data) => {
    const image = await new Promise((done) => { const node = new Image(); node.onload = () => done(node); node.src = `data:image/png;base64,${data}`; });
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(Math.round(image.width * 0.3), Math.round(image.height * 0.25), Math.round(image.width * 0.4), Math.round(image.height * 0.4)).data;
    let sum = 0, dark = 0;
    for (let at = 0; at < pixels.length; at += 4) { const value = (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3; sum += value; if (value < 8) dark++; }
    return { mean: Math.round(sum / (pixels.length / 4)), dark: Math.round((dark / (pixels.length / 4)) * 100) };
  }, png);
}
const seek = async (page, timecode) => { await visible(page, "timecode").fill(timecode); await page.keyboard.press("Enter"); await sleep(2500); };
const timecodeNow = (page) => visible(page, "timecode").inputValue();
/** Seeks, reads the paused picture, plays and reads the picture three times WHILE it plays, then pauses. */
async function sample(page, label, timecode) {
  await seek(page, timecode);
  const paused = await read(page, `${label}-paused`);
  await visible(page, "player").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press("Space");
  const playing = [];
  for (let n = 0; n < 3; n++) { await sleep(700); playing.push(await read(page, n === 1 ? `${label}-playing` : undefined)); }
  const moved = await timecodeNow(page);
  await page.keyboard.press("Space");
  await sleep(500);
  return { at: timecode, paused, playing, stoppedAt: moved };
}
const POINTS = [["a-start", "00:00:01:15"], ["b-first-part", "00:00:03:00"], ["c-after-cut-1", "00:00:10:00"], ["d-middle", "00:01:30:00"], ["e-late", "00:02:30:00"]];
const waitHost = (page) => page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });

// ───────────── 1. a project with the long video on the timeline, made through the app ─────────────
let session = await launch(run, { packaged, env });
let { app, page } = session;
// Whatever fails, the app of this run is ended before the script is: nothing is left running.
const guard = setTimeout(() => { console.log("the run took too long"); void end(1); }, 540_000);
async function end(code) { clearTimeout(guard); await Promise.race([quit(session).catch(() => undefined), sleep(45_000)]); try { process.kill(session.pid, "SIGKILL"); } catch { /* gone */ } process.exit(code); }
try {
await page.setViewportSize({ width: 1600, height: 900 }).catch(() => undefined);
await waitHost(page);
const gpu = await page.evaluate(async () => { const adapter = await navigator.gpu?.requestAdapter().catch(() => null); return adapter ? `webgpu adapter: ${adapter.info?.vendor ?? "?"} ${adapter.info?.architecture ?? ""}` : "no webgpu adapter"; });
console.log(`renderer: ${gpu}`);
await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video);
await go(page, "/home");
await page.getByText("New blank project", { exact: true }).first().click({ timeout: 90_000 });
await page.waitForURL(/\/editor\//, { timeout: 60_000 });
const projectId = decodeURIComponent(/\/editor\/([^/?#]+)/.exec(page.url())[1]);
for (const id of ["player", "timeline", "asset-panel"]) await visible(page, id).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Import", exact: true }).filter({ visible: true }).first().click();
await page.getByRole("menuitem", { name: "Import files…", exact: true }).filter({ visible: true }).first().click();
const name = basename(video);
await visible(page, `label-${name}`).waitFor({ timeout: 180_000 });
await visible(page, `thumb-${name}`).dblclick();
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="clip-"]')].some((node) => /^clip-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid"))), null, { timeout: 60_000 });
await visible(page, "save-state").getByText("Saved", { exact: true }).waitFor({ timeout: 60_000 });
const backend = await page.evaluate(() => [...document.querySelectorAll("canvas")].map((canvas) => `${canvas.width}×${canvas.height}`).join(", "));
console.log(`canvases: ${backend}`);
const before = [];
for (const [label, at] of POINTS) before.push(await sample(page, `0-original-${label}`, at));
console.log("ORIGINAL (no change):"); for (const row of before) console.log("  ", JSON.stringify(row));
check(results, "The untouched video is drawn, paused and playing, at every sampled place", before.every((row) => row.paused.mean > 12 && row.playing.every((p) => p.mean > 12)));
await quit(session);

// ───────────── 2. the agent's changes, written into the project file ─────────────
const projectFile = join(run.library, projectId, "project.json");
const project = JSON.parse(readFileSync(projectFile, "utf8"));
const scene = project.scenes.find((s) => s.isMain) ?? project.scenes[0];
const mine = scene.tracks.main.elements[0];
const proposal = JSON.parse(readFileSync(proposalFile, "utf8"));
const calls = args.includes("--only-colour") ? proposal.calls.filter((call) => call.tool === "jc_color_adjust") : proposal.calls;
// The proposal names the owner's scene, clip and media: the same places of this project.
const theirs = { scene: /\/scenes\/@([0-9a-f-]{36})/.exec(JSON.stringify(proposal.calls))[1], clip: proposal.calls.find((call) => call.tool === "jc_clip_split").args.elementIds[0], media: /"mediaId":"([0-9a-f-]{36})"/.exec(JSON.stringify(proposal.calls).replace(/": "/g, '":"'))?.[1] };
const text = JSON.stringify(calls.flatMap((call) => call.patch)).replaceAll(theirs.scene, scene.id).replaceAll(theirs.clip, mine.id).replaceAll(theirs.media ?? "\u0000", mine.mediaId);
const step = (holder, segment) => (segment.startsWith("@") ? holder.find((item) => item.id === segment.slice(1)) : holder[segment]);
for (const patch of JSON.parse(text)) {
  const segments = patch.path.split("/").slice(1), last = segments.pop();
  const holder = segments.reduce((at, segment) => { const next = step(at, segment); if (next === undefined) throw new Error(`no ${segment} in ${patch.path}`); return next; }, project);
  if (patch.op === "add" && last.startsWith("@")) holder.push(patch.value);
  else if (patch.op === "add" || patch.op === "replace") { if (last.startsWith("@")) holder[holder.findIndex((item) => item.id === last.slice(1))] = patch.value; else holder[last] = patch.value; }
  else if (patch.op === "remove") { if (last.startsWith("@")) holder.splice(holder.findIndex((item) => item.id === last.slice(1)), 1); else delete holder[last]; }
  else throw new Error(`patch op ${patch.op}`);
}
writeFileSync(projectFile, JSON.stringify(project));
console.log(`applied ${calls.length} call(s): ${calls.map((call) => call.tool).join(", ")}; main track now has ${scene.tracks.main.elements.length} clip(s), ${scene.tracks.overlay.length} overlay track(s)`);

// ───────────── 3. the same project again: paused and playing ─────────────
session = await launch(run, { packaged, env });
({ app, page } = session);
await page.setViewportSize({ width: 1600, height: 900 }).catch(() => undefined);
await waitHost(page);
await go(page, `/editor/${projectId}`);
for (const id of ["player", "timeline"]) await visible(page, id).waitFor({ timeout: 60_000 });
await page.waitForFunction((wanted) => [...document.querySelectorAll('[data-testid^="clip-"]')].filter((node) => /^clip-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid"))).length >= wanted, 1, { timeout: 60_000 }).catch(async (error) => { await page.screenshot({ path: join(shots, "failure-reopen.png") }); throw error; });
await sleep(2000);
const after = [];
for (const [label, at] of POINTS) after.push(await sample(page, `1-changed-${label}`, at));
console.log("AFTER THE AGENT'S CHANGES:"); for (const row of after) console.log("  ", JSON.stringify(row));
const dark = after.filter((row, index) => row.paused.mean < before[index].paused.mean * 0.4 || row.playing.some((p, n) => p.mean < Math.max(8, before[index].playing[n].mean * 0.4)));
check(results, "After the agent's changes the picture is drawn, paused and WHILE PLAYING, at every sampled place", dark.length === 0, dark.length ? `dark at ${dark.map((row) => row.at).join(", ")}` : "");
check(results, "The playhead moves while playing", after.every((row) => row.stoppedAt !== row.at), after.map((row) => `${row.at}→${row.stoppedAt}`).join(" "));
const errors = session.logs.filter((line) => /^\[(error|pageerror)\]/.test(line) && !/Failed to load resource|ERR_/.test(line));
console.log(`page errors: ${errors.length}`); for (const line of errors.slice(0, 12)) console.log("  ", line.slice(0, 400));
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks ok`);
await end(failed.length ? 1 : 0);
} catch (error) {
  console.log(`Error: ${String(error).split("\n").slice(0, 4).join(" | ")}`);
  await page.screenshot({ path: join(shots, "failure.png") }).catch(() => undefined);
  await end(1);
}
