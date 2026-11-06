// Evidence the owner can look at: a screen recording (webm) and a 6-frame strip (png) of a panel sliding in and out, on the
// PRODUCTION web build with no host — the shell sidebar, the editor inspector, the docked agent panel and the compact Agent sheet.
// Files: <dir>/motion-<name>.webm and <dir>/motion-<name>.png (frames 1/12 s apart, taken around the first toggle; needs ffmpeg).
// REAL: the app and its storage (fresh browser profile per panel). Nothing seeded, no model, no host.
// Usage: node apps/app/e2e/motion-evidence.mjs [dir] [base-url]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { chromium } from "playwright";

const dir = process.argv[2] ?? ".dev/shots/ui-polish";
const base = process.argv[3] ?? "http://localhost:8097";
const scratch = `${dir}/_video`;
mkdirSync(scratch, { recursive: true });
const browser = await chromium.launch();
const failures = [];
const WIDE = { width: 1280, height: 800 }, COMPACT = { width: 390, height: 844 };

async function record(name, viewport, run) {
  if (process.env.ME_ONLY && process.env.ME_ONLY !== name) return;
  const folder = `${scratch}/${name}-${Date.now()}`;
  const context = await browser.newContext({ viewport, colorScheme: "light", recordVideo: { dir: folder, size: viewport } });
  const started = Date.now();
  const page = await context.newPage();
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  const marks = [];
  const mark = () => marks.push((Date.now() - started) / 1000);
  try { await run({ page, tid, mark, visible }); } catch (err) { failures.push(`${name}: ${String(err).split("\n")[0]}`); }
  await context.close();
  if (!marks.length) return;
  const file = readdirSync(folder).find((entry) => entry.endsWith(".webm"));
  if (!file) { failures.push(`${name}: no video`); return; }
  renameSync(`${folder}/${file}`, `${dir}/motion-${name}.webm`);
  // Six frames, 1/12 s apart, starting a little before the first toggle (the video starts a moment after the page).
  const from = Math.max(0, marks[0] - 0.12).toFixed(2);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", from, "-i", `${dir}/motion-${name}.webm`, "-vf", `fps=12,scale=${Math.round(viewport.width / (viewport.width > 600 ? 2.5 : 1))}:-1,tile=6x1`, "-frames:v", "1", `${dir}/motion-${name}.png`]);
  console.log(`ok   ${name}: motion-${name}.webm, motion-${name}.png (first toggle at ${marks[0].toFixed(2)} s)`);
}
async function project({ page, tid }) {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByRole("button", { name: "Create your first project", exact: true }).filter({ visible: true }).first().click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  const compact = page.viewportSize().width < 600;
  for (const id of compact ? ["compact-preview", "compact-timeline", "compact-toolbar"] : ["editor-bar", "player", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

await record("sidebar", WIDE, async ({ page, tid, mark }) => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await tid("sidebar").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  mark(); await tid("sidebar").getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await page.waitForTimeout(900);
  mark(); await page.keyboard.press("Meta+\\"); await page.waitForTimeout(500);
  if (!(await page.getByTestId("sidebar-slot").count())) { await page.keyboard.press("Control+\\"); await page.waitForTimeout(500); }
  await page.waitForTimeout(700);
});
await record("inspector", WIDE, async (context) => {
  const { page, tid, mark } = context;
  await project(context);
  mark(); await tid("toggle-inspector").click();
  await page.waitForTimeout(900);
  mark(); await tid("toggle-inspector").click();
  await page.waitForTimeout(900);
});
await record("agent-panel", WIDE, async (context) => {
  const { page, tid, mark } = context;
  await project(context);
  if (await page.getByTestId("agent-panel-slot").count()) { await tid("toggle-agent").click(); await page.waitForTimeout(700); }
  mark(); await tid("toggle-agent").click();
  await page.waitForTimeout(900);
  mark(); await tid("toggle-agent").click();
  await page.waitForTimeout(900);
});
await record("agent-sheet", COMPACT, async (context) => {
  const { page, tid, mark } = context;
  await project(context);
  await tid("compact-agent").waitFor({ timeout: 60_000 });
  mark(); await tid("compact-agent").click();
  await page.waitForTimeout(900);
  mark(); await tid("agent-panel-close").click();
  await page.waitForTimeout(900);
});

await browser.close();
console.log(failures.length ? `FAIL\n${failures.join("\n")}` : "all four recorded");
process.exit(failures.length ? 1 : 0);
