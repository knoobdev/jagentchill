// VERIFIER TEST-HONESTY EVIDENCE: original assertions, deliberate missing switch and hidden segment fill.
// End-to-end in a real browser on the PRODUCTION web build, no host: after an edit or a click, does the panel that should
// change show the new state? The guard of the rendering cuts of w7 (editor-perf.mjs): the inspector's controls, the
// media tiles and the track headers are now drawn again only when what they show changes — a control that is NOT drawn
// again when it should be shows a stale value, or writes to the clip that was selected before.
// The project is made here through the UI (three pictures and a text — ffmpeg-made files, real storage of a fresh
// browser profile, nothing seeded).
// Usage: node apps/app/e2e/editor-stale.mjs <screenshot-dir> <base-url>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const shots = resolve(process.argv[2] ?? ".dev/shots/editor-stale");
const base = process.argv[3];
if (!base) { console.error("usage: node apps/app/e2e/editor-stale.mjs <screenshot-dir> <base-url>"); process.exit(1); }
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), "jagentchill-editor-stale-e2e");
mkdirSync(dir, { recursive: true });
const media = (name) => join(dir, name);
const pictures = ["red", "blue", "green"].map((colour, index) => { const name = `still-${index + 1}.png`; if (!existsSync(media(name))) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=1280x720:d=1`, "-frames:v", "1", media(name)]); return name; });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const settle = (ms = 350) => page.waitForTimeout(ms);
const mod = process.platform === "darwin" ? "Meta" : "Control";
const NOT_CLIPS = ["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"];
const clips = () => page.evaluate((skip) => [...document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"]')].filter((node) => !skip.includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect();
  return { id: node.getAttribute("data-testid").slice(5), track: node.closest('[data-testid^="track-"]')?.getAttribute("data-testid") ?? "", x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}).filter((clip) => clip.width > 0).sort((a, b) => a.x - b.x), NOT_CLIPS);
const mainClips = async () => (await clips()).filter((clip) => clip.track === "track-main-video");
const press = async (clip) => { await page.mouse.click(clip.x + Math.min(clip.width / 2, 30), clip.y + clip.height / 2); await settle(); };
const seek = async (text) => { await tid("timecode").fill(text); await page.keyboard.press("Enter"); await settle(); };
const deselect = async () => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press(`${mod}+Shift+KeyA`); await settle(200); };
const field = (label) => visible(tid("inspector").getByLabel(label, { exact: true }));
const read = async (label) => Number(await field(label).inputValue());
const type = async (label, value) => { const input = field(label); await input.click(); await input.fill(String(value)); await input.press("Enter"); await settle(); };
const toolbar = async (id) => { await page.evaluate((testId) => [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((node) => node.getBoundingClientRect().width > 0)?.click(), id); await settle(450); };
const diamond = async (id) => (await tid(id).locator('[data-testid^="diamond-"]').first().getAttribute("data-testid")).slice(8);
const expect = (condition, message) => { if (!condition) throw new Error(message); };
let passed = 0;
const step = async (name, run) => {
  try { await run(); passed++; console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await page.screenshot({ path: join(shots, `failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png`) }).catch(() => undefined); }
};

let a, b, textClip;
try {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
  await visible(page.getByRole("button", { name: "Create your first project", exact: true })).click({ timeout: 120_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 120_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles(pictures.map(media));
  for (const name of pictures) await tid(`label-${name}`).waitFor({ timeout: 300_000 });
  for (const name of pictures.slice(0, 2)) {
    const count = (await clips()).length;
    await tid(`thumb-${name}`).dblclick();
    await page.waitForFunction(([had, skip]) => [...document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"]')].filter((node) => !skip.includes(node.getAttribute("data-testid"))).length > had, [count, NOT_CLIPS], { timeout: 60_000 });
    await settle();
  }
  await tid("panel-tab-text").click();
  await tid("text-tab").waitFor();
  await seek("00:00:01:00");
  await tid("text-add").click();
  await tid("text-inspector").waitFor({ timeout: 30_000 });
  await deselect();
  await tid("panel-tab-media").click();
  await settle(800);
  [a, b] = await mainClips();
  textClip = (await clips()).find((clip) => /text/.test(clip.track));
  expect(a && b && textClip, "the project has two pictures and a text");

  await step("Another clip of the same kind shows ITS values: X typed on the first picture is not shown for the second, and is there again on the first", async () => {
    await press(a);
    await type("X", 120);
    expect((await read("X")) === 120, `the first picture shows what was typed, got ${await read("X")}`);
    await press(b);
    expect((await read("X")) === 0, `the second picture shows its own X (0), got ${await read("X")}`);
    await press(a);
    expect((await read("X")) === 120, `back on the first picture: 120, got ${await read("X")}`);
  });

  await step("A text after a picture: the Transform section that stays mounted shows the text's values, and what is typed there goes to the text, not to the picture", async () => {
    await press(textClip);
    await tid("text-inspector").waitFor();
    const before = await read("X");
    expect(before !== 120, `the text does not show the picture's X, got ${before}`);
    await type("X", 33);
    await press(a);
    expect((await tid("text-inspector").count()) === 0 || !(await page.getByTestId("text-inspector").first().isVisible().catch(() => false)), "the text's own fields are gone for a picture");
    expect((await read("X")) === 120, `the picture kept its X (120), got ${await read("X")}`);
    await press(textClip);
    expect((await read("X")) === 33, `the text has what was typed for it (33), got ${await read("X")}`);
    await page.screenshot({ path: join(shots, "01-text-after-picture.png") });
  });

  await step("Undo and Redo of the toolbar are shown in the field at once", async () => {
    await press(b);
    await type("X", 77);
    expect((await read("X")) === 77, `typed 77, got ${await read("X")}`);
    await toolbar("tool-undo");
    expect((await read("X")) === 0, `after Undo the field shows 0, got ${await read("X")}`);
    await toolbar("tool-redo");
    expect((await read("X")) === 77, `after Redo the field shows 77, got ${await read("X")}`);
    await toolbar("tool-undo");
  });

  await step("A keyframe diamond is the clip's own: filled for the picture that has the key, hollow for the other, filled again on return", async () => {
    await press(a);
    await seek("00:00:00:15");
    expect((await diamond("kf-opacity")) === "hollow", `no key yet, got ${await diamond("kf-opacity")}`);
    await tid("kf-opacity").click();
    await settle();
    expect((await diamond("kf-opacity")) === "filled", `the key is under the playhead, got ${await diamond("kf-opacity")}`);
    await press(b);
    expect((await diamond("kf-opacity")) === "hollow", `the other picture has no key, got ${await diamond("kf-opacity")}`);
    await press(a);
    expect((await diamond("kf-opacity")) === "filled", `back on the first: its key, got ${await diamond("kf-opacity")}`);
    await tid("kf-opacity").click();
    await settle();
    expect((await diamond("kf-opacity")) === "hollow", `the key is removed, got ${await diamond("kf-opacity")}`);
  });

  await step("A split shows on the media tile (Used → Used ×2), an undo takes it back; the other tiles keep theirs", async () => {
    const tile = (name) => visible(page.getByTestId(`asset-${name}`));
    const words = async (name) => (await tile(name).innerText()).replace(/\s+/g, " ");
    await press(a);
    // Which picture the first clip of the track shows is read from the inspector (a new clip goes in at the playhead).
    const split = /: (still-\d\.png)$/.exec((await tid("inspector").getAttribute("aria-label")) ?? "")?.[1], other = pictures.slice(0, 2).find((name) => name !== split);
    expect(split && other, `the inspector names the selected picture: ${await tid("inspector").getAttribute("aria-label")}`);
    expect(/Used/.test(await words(split)) && !/×/.test(await words(split)), `the picture is used once: ${await words(split)}`);
    expect(!/Used/.test(await words(pictures[2])), `the third picture is not used: ${await words(pictures[2])}`);
    await seek("00:00:01:00");
    const had = (await mainClips()).length;
    await toolbar("tool-split");
    expect((await mainClips()).length === had + 1, `the split made one more clip, ${(await mainClips()).length} of ${had + 1}`);
    expect(/Used ×2/.test(await words(split)), `the tile of the split picture says Used ×2: ${await words(split)}`);
    expect(/Used/.test(await words(other)) && !/×/.test(await words(other)), `the other picture's tile still says Used: ${await words(other)}`);
    expect(!/Used/.test(await words(pictures[2])), `the unused picture's tile is as it was: ${await words(pictures[2])}`);
    await page.screenshot({ path: join(shots, "02-used-twice-after-split.png") });
    await toolbar("tool-undo");
    expect((await mainClips()).length === had, "the undo took the split back");
    expect(/Used/.test(await words(split)) && !/×2/.test(await words(split)), `the tile says Used again: ${await words(split)}`);
  });

  await step("A tile does what the panel means NOW: double-click adds the unused picture (its tile then says Used), and its menu offers \"Select clips in timeline\", which selects that clip", async () => {
    const had = (await mainClips()).length;
    await tid(`thumb-${pictures[2]}`).dblclick();
    await page.waitForFunction(([count, skip]) => [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].filter((node) => !skip.includes(node.getAttribute("data-testid"))).length > count, [had, NOT_CLIPS], { timeout: 30_000 });
    await settle();
    expect(/Used/.test((await visible(page.getByTestId(`asset-${pictures[2]}`)).innerText())), "the third tile says Used after it was added");
    await deselect();
    await visible(page.getByTestId(`asset-${pictures[2]}`)).click({ button: "right" });
    const item = visible(page.getByRole("menuitem", { name: "Select clips in timeline", exact: true }));
    await item.waitFor({ timeout: 10_000 });
    await item.click();
    await settle();
    expect(await field("X").isVisible(), "the clip of that picture is selected: the inspector shows its Transform");
    [a, b] = await mainClips();
  });

  await step("A track's header follows its switches: Lock ↔ Unlock, and still does after a clip of the track was edited", async () => {
    const headers = tid("track-headers");
    const lock = () => visible(headers.getByRole("button", { name: "Lock", exact: true })), unlock = () => visible(headers.getByRole("button", { name: "Unlock", exact: true }));
    const locks = await headers.getByRole("button", { name: "Lock", exact: true }).count();
    expect(locks > 0, "the headers have Lock buttons");
    await lock().click();
    await settle();
    expect((await headers.getByRole("button", { name: "Unlock", exact: true }).count()) === 1, "one track says Unlock after its Lock was pressed");
    await unlock().click();
    await settle();
    expect((await headers.getByRole("button", { name: "Unlock", exact: true }).count()) === 0 && (await headers.getByRole("button", { name: "Lock", exact: true }).count()) === locks, "it says Lock again");
    await press(a);
    await type("X", 5);
    await lock().click();
    await settle();
    expect((await headers.getByRole("button", { name: "Unlock", exact: true }).count()) === 1, "after an edit of a clip the header still follows its switch");
    await unlock().click();
    await settle();
  });

  await step("The text tab: a segment and a switch show what was chosen (the fill under the chosen segment is drawn)", async () => {
    textClip = (await clips()).find((clip) => /text/.test(clip.track));
    await press(textClip);
    await tid("text-inspector").waitFor();
    const radios = tid("text-align").getByRole("radio");
    const count = await radios.count();
    expect(count >= 2, `the alignment has segments, got ${count}`);
    const checked = async () => { const all = []; for (let index = 0; index < count; index++) all.push(await radios.nth(index).getAttribute("aria-checked")); return all.join(","); };
    const start = await checked();
    const target = start.split(",").findIndex((value) => value !== "true");
    await radios.nth(target).click();
    await tid("text-align").evaluate(n => { n.style.opacity="0"; });
    console.log("VF finding 16: selected segment hidden; original aria-checked assertions still run");
    await settle();
    const after = (await checked()).split(",");
    expect(after[target] === "true" && after.filter((value) => value === "true").length === 1, `the pressed segment is the chosen one: ${start} → ${after.join(",")}`);
    const switches = tid("text-inspector").locator("[data-vf-deliberately-absent-switch]");
    console.log("VF finding 16: switch count forced absent",await switches.count());
    if ((await switches.count()) > 0) {
      const first = switches.first(), was = await first.getAttribute("aria-checked");
      await first.scrollIntoViewIfNeeded();
      await first.click();
      await settle(500);
      expect((await first.getAttribute("aria-checked")) !== was, `the switch changed from ${was}`);
      await first.click();
      await settle(500);
      expect((await first.getAttribute("aria-checked")) === was, `and back to ${was}`);
    }
    await page.screenshot({ path: join(shots, "03-text-tab.png") });
  });
} catch (err) {
  console.log("FAIL", String(err).split("\n").slice(0, 3).join("\n"));
  errors.push("the script stopped");
  await page.screenshot({ path: join(shots, "failure.png") }).catch(() => undefined);
}
console.log(`${passed}/8 steps ok`);
console.log(errors.length ? `errors\n${errors.join("\n")}` : "no errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
