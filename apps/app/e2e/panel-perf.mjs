// End-to-end in a real browser on the PRODUCTION web build, with no host: the smoothness of every editor panel's slide
// with a REAL heavy project open (a 3-minute 1080p file made with ffmpeg, imported and cut through the UI; nothing seeded).
// Measured in the page per transition (see lib/panel-perf.mjs): frame times, React commits while it moves, edge gap.
// `--legacy` is the negative control: the page runs the old per-frame JS animation without the freeze, and the run
// passes only if the limits REJECT it. `--video` records a second pass (left, right, bottom) into <dir>/video.
// Usage: node apps/app/e2e/panel-perf.mjs <out-dir> <base-url> [--legacy] [--video]
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { COMMIT_COUNTER, EDITOR_PANELS, buildHeavyProject, faults, heavyMedia, line, measureAll } from "./lib/panel-perf.mjs";

const out = resolve(process.argv[2] ?? ".dev/shots/panel-perf");
const base = process.argv[3] ?? "http://localhost:8098";
const legacy = process.argv.includes("--legacy"), video = process.argv.includes("--video");
mkdirSync(out, { recursive: true });
const files = heavyMedia(join(out, "media"));
const profile = join(out, `profile-${process.pid}`);
const open = (options = {}) => chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 900 }, ...options });
let failed = false;
try {
  let context = await open();
  await context.addInitScript(COMMIT_COUNTER);
  if (legacy) await context.addInitScript(() => { window.__jcPanelMotionLegacy = true; });
  let page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByRole("button", { name: "Create your first project", exact: true }).filter({ visible: true }).first().click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  const url = page.url();
  const project = await buildHeavyProject(page, files);
  console.log(`project: ${JSON.stringify(project)}`);
  await page.screenshot({ path: join(out, legacy ? "heavy-legacy.png" : "heavy.png") });
  // One warm-up round (first mounts, caches), then the round that counts.
  await measureAll(page);
  const results = await measureAll(page);
  for (const result of results) console.log(line(result));
  const problems = results.flatMap((result) => faults(result));
  writeFileSync(join(out, legacy ? "numbers-legacy.json" : "numbers.json"), JSON.stringify({ base, legacy, project, results }, null, 1));
  if (legacy) {
    console.log(problems.length ? `negative control ok: the old motion is rejected (${problems.length} faults), e.g. ${problems.slice(0, 3).join("; ")}` : "NEGATIVE CONTROL FAILED: the old motion passes the limits");
    failed = problems.length === 0;
  } else {
    if (problems.length) { console.log("FAIL\n" + problems.join("\n")); failed = true; } else console.log(`ok   ${results.length} transitions within the limits`);
  }
  if (errors.length) { console.log("page errors:\n" + [...new Set(errors)].slice(0, 6).join("\n")); failed = true; }
  await context.close();
  if (video) {
    context = await open({ recordVideo: { dir: join(out, "video"), size: { width: 1440, height: 900 } } });
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
    for (const id of ["asset-panel", "player", "inspector", "timeline"]) await page.getByTestId(id).filter({ visible: true }).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    for (const spec of EDITOR_PANELS) { await page.getByTestId(spec.toggle).filter({ visible: true }).first().click(); await page.waitForTimeout(900); }
    await context.close();
    console.log(`video in ${join(out, "video")}`);
  }
} finally {
  // The browser profile holds the imported media (hundreds of MB): it goes with the run.
  if (existsSync(profile)) rmSync(profile, { recursive: true });
}
process.exit(failed ? 1 : 0);
