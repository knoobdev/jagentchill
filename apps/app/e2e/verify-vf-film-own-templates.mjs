// Verifier safety copy: unchanged assertions; headless and mute audio.
// End-to-end in a real browser, with no host and no model: templates, preset packs and the brand kit.
// Real storage (IndexedDB and OPFS of a fresh browser profile). The media are real files made here with ffmpeg (solid
// colour clips and a still). Everything on screen is made through the UI — a project is edited, saved as a template,
// used with other media; a pack is exported and imported back; a brand kit is filled in and applied. Nothing is seeded.
// Usage: node apps/app/e2e/templates.mjs [screenshot-dir] [base-url]      JC_ONLY=<part of a step name> runs matching steps (setup steps always run)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/templates";
const base = process.argv[3] ?? "http://localhost:8070";
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), `jagentchill-templates-e2e-${process.pid}`);
mkdirSync(dir, { recursive: true });
const file = (name) => join(dir, name);
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const clip = (name, colour, size, seconds) => { if (!existsSync(file(name))) ffmpeg("-f", "lavfi", "-i", `color=c=${colour}:s=${size}:r=30:d=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file(name)); };
clip("red.mp4", "0xD02020", "640x360", 3);
clip("blue.mp4", "0x2040D0", "640x360", 3);
// The media the template is used with: a portrait clip (cover fit crops it) and a still.
clip("green-portrait.mp4", "0x20B040", "360x640", 5);
ffmpeg("-f", "lavfi", "-i", "color=c=0xE0C020:s=640x360:d=1", "-frames:v", "1", file("yellow.png"));

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
let failed = 0;
const only = process.env.JC_ONLY ?? "";
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (read, check, what, tries = 60) => { let value; for (let index = 0; index < tries; index++) { value = await read(); if (check(value)) return value; await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error(`${what}: ${JSON.stringify(value)}`); };

async function open(width, height, options = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", acceptDownloads: true, ...options });
  // The save dialog of a headless browser: a real handle in the private file system, under `picked/`.
  await context.addInitScript(() => {
    window.showSaveFilePicker = async (options) => { const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked", { create: true }); return folder.getFileHandle(options.suggestedName, { create: true }); };
    delete window.showDirectoryPicker;
  });
  const page = await context.newPage();
  // Every request for a shipped cover or preview (`/templates/<id>/…`; the page `/library/templates` is not one).
  const mediaRequests = [];
  page.on("request", (request) => { const path = new URL(request.url()).pathname; if (path.startsWith("/templates/")) mediaRequests.push(path); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_/.test(msg.text())) errors.push(msg.text().slice(0, 400)); });
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  const ui = {
    page, context, visible, tid, mediaRequests,
    text: (value, o) => visible(page.getByText(value, o)),
    button: (name, exact = true) => visible(page.getByRole("button", { name, exact })),
    menuItem: (name) => visible(page.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').and(page.getByLabel(name, { exact: true }))),
    shot: (name) => page.screenshot({ path: `${shots}/${name}.png` }),
    go: async (path, wait) => { await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 240_000 }); await tid(wait).waitFor({ timeout: 90_000 }); },
    cards: () => page.locator('[data-testid="template-card"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id"))),
    card: (name) => visible(page.locator(`[data-testid="template-card"][data-name="${name}"]`)),
    cardMenu: async (name, entry) => { await ui.card(name).getByTestId("template-menu").click(); await ui.menuItem(entry).click(); },
    pick: async (trigger, files) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]); await chooser.setFiles(files); },
    saved: () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 }),
    /** The stored project of the open editor, read from the app's own database: what a reload would open. */
    stored: () => page.evaluate(async () => {
      const id = location.pathname.split("/").pop();
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open("jagentchill"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const find = (value, depth = 0) => {
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) { try { return find(JSON.parse(new TextDecoder().decode(value)), depth + 1); } catch { return null; } }
        if (typeof value === "string") { if (!value.includes('"scenes"')) return null; try { return find(JSON.parse(value), depth + 1); } catch { return null; } }
        if (value === null || typeof value !== "object" || depth > 4) return null;
        if (Array.isArray(value.scenes) && value.settings && value.metadata?.id === id) return value;
        for (const member of Object.values(value)) { const found = find(member, depth + 1); if (found) return found; }
        return null;
      };
      for (const store of database.objectStoreNames) {
        const rows = await new Promise((resolve) => { const all = database.transaction(store).objectStore(store).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => resolve([]); });
        for (const row of rows) { const found = find(row); if (found) return found; }
      }
      return null;
    }),
    /** The share of the preview canvas whose pixels are near a colour, read from a screenshot of it. */
    canvasShare: async (near) => {
      const box = await tid("canvas").boundingBox();
      const png = await page.screenshot({ clip: { x: Math.ceil(box.x) + 2, y: Math.ceil(box.y) + 2, width: Math.floor(box.width) - 4, height: Math.floor(box.height) - 4 } });
      return page.evaluate(async ({ data, near }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
        context2d.drawImage(bitmap, 0, 0);
        const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let close = 0;
        for (let index = 0; index < pixels.length; index += 4) if (Math.abs(pixels[index] - near[0]) < 56 && Math.abs(pixels[index + 1] - near[1]) < 56 && Math.abs(pixels[index + 2] - near[2]) < 56) close++;
        return close / (pixels.length / 4);
      }, { data: png.toString("base64"), near });
    },
  };
  return ui;
}
const step = async (ui, name, run, setup = false) => {
  if (only && !setup && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await run(); console.log("ok  ", name); }
  catch (err) {
    failed++; console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join(" "));
    await ui.shot(`failure-${failed}`).catch(() => undefined);
    console.log("PAGE TEXT:", (await ui.page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 500));
    await ui.page.keyboard.press("Escape").catch(() => undefined);
  }
};
// The twelve starters of `templates/catalog.md`: id, name, number of slots, canvas ratio, seconds.
const STARTERS = [
  ["vlog-day", "Day in my life", 6, 9 / 16, 15], ["vlog-travel", "Travel recap", 7, 16 / 9, 20], ["promo-product", "Product spotlight", 4, 1, 12], ["promo-sale", "Flash sale", 3, 9 / 16, 10],
  ["slideshow-memories", "Memories", 8, 16 / 9, 24], ["slideshow-story", "Photo story", 5, 4 / 5, 15], ["intro-channel", "Channel intro", 1, 16 / 9, 6], ["outro-end-screen", "End screen", 2, 16 / 9, 8],
  ["short-hook", "Hook and reveal", 3, 9 / 16, 9], ["short-top-three", "Top three", 3, 9 / 16, 12], ["quote-card", "Quote of the day", 1, 1, 8], ["event-countdown", "Event countdown", 2, 16 / 9, 10],
];
const elementsOf = (doc) => doc.scenes.flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].flatMap((track) => track.elements));
const GREEN = [32, 176, 64], YELLOW = [224, 192, 32], RED = [208, 32, 32];

// ————— Wide: 1440 × 900, light —————
const wide = await open(1440, 900);
{
  const { page, tid, text, button, menuItem, shot, go, cards, card, cardMenu, pick, saved, stored, canvasShare, visible } = wide;
  let download = null, sourceId = "", draftId = "";

  await step(wide, "Template gallery — Scenario: Offline — the Bundled tab lists the starter templates with no host", async () => {
    await go("/library/templates", "templates-tab");
    await until(cards, (ids) => ids.length === STARTERS.length, "bundled cards");
    expect(JSON.stringify(await cards()) === JSON.stringify(STARTERS.map(([id]) => id)), `bundled ${await cards()}`);
    expect((await card("Day in my life").getByTestId("template-meta").innerText()) === "00:15 · 9:16 · 6 clips", `meta ${await card("Day in my life").getByTestId("template-meta").innerText()}`);
    await shot("01-gallery-bundled-1440-light");
  });
  await step(wide, "Template gallery — every bundled card shows an <img> cover that loaded, and its preview video plays under the pointer", async () => {
    const covers = await until(() => page.locator('[data-testid="template-card"][data-source="bundled"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => { const image = node.querySelector('[data-testid="template-cover"] img'); return { id: node.getAttribute("data-id"), loaded: Boolean(image && image.complete && image.naturalWidth > 0), width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 }; })), (list) => list.length === STARTERS.length && list.every((entry) => entry.loaded), "every cover loaded", 100);
    for (const [id, , , ratio] of STARTERS) { const cover = covers.find((entry) => entry.id === id); expect(Math.abs(cover.width / cover.height - ratio) < 0.02, `${id}: the cover has the template's ratio (${cover.width}×${cover.height})`); }
    expect((await page.getByTestId("template-thumb").filter({ visible: true }).count()) === 0, "no card falls back to a drawn miniature");
    expect((await page.getByTestId("template-preview-video").count()) === 0, "no preview plays before the pointer is over a card");
    await card("Travel recap").getByTestId("template-cover").hover();
    const playing = await until(() => page.getByTestId("template-preview-video").evaluateAll((nodes) => nodes.map((node) => ({ time: node.currentTime, muted: node.muted, width: node.videoWidth, file: node.getAttribute("data-file") }))), (list) => list.length === 1 && list[0].time > 0.3, "the preview plays", 100);
    expect(playing[0].muted && playing[0].file === "/templates/vlog-travel/preview.mp4" && playing[0].width === 720, `the preview of the card, muted, 720 px wide: ${JSON.stringify(playing[0])}`);
    await shot("01b-gallery-hover-preview-1440-light");
    await page.mouse.move(5, 5);
    await until(() => page.getByTestId("template-preview-video").count(), (count) => count === 0, "the preview stops when the pointer leaves");
  });
  await step(wide, "Template gallery — Scenario: Offline — with the browser offline the bundled templates are listed with thumbnails and previews", async () => {
    const loaded = () => page.locator('[data-testid="template-card"][data-source="bundled"] [data-testid="template-cover"] img').evaluateAll((nodes) => nodes.filter((node) => node.complete && node.naturalWidth > 0).length);
    // Every cover and preview has been kept by the app (Cache Storage) before the network goes.
    await until(() => page.locator('[data-testid="template-cover"][data-stored="true"]').count(), (count) => count === STARTERS.length, "covers and previews kept", 200);
    // First load: each of the 24 files was asked for exactly once.
    expect(wide.mediaRequests.length === STARTERS.length * 2 && new Set(wide.mediaRequests).size === STARTERS.length * 2, `first load asks for each cover and preview once: ${wide.mediaRequests.length} requests, ${new Set(wide.mediaRequests).size} files`);
    wide.mediaRequests.length = 0;
    await wide.context.setOffline(true);
    try {
      const reachable = await page.evaluate(() => fetch("/favicon.ico?offline-probe", { cache: "no-store" }).then(() => true, () => false));
      expect(reachable === false, "the browser is offline: the server cannot be reached");
      // Leave the gallery and come back, inside the app: the cards are built again with no network.
      await visible(page.getByRole("tab", { name: /^Preset packs/ })).click();
      await tid("packs-tab").waitFor();
      await visible(page.getByRole("tab", { name: /^Templates/ })).click();
      await until(cards, (ids) => ids.length === STARTERS.length, "bundled cards, offline");
      await until(loaded, (count) => count === STARTERS.length, "every cover shows offline", 100);
      expect((await page.getByTestId("template-thumb").filter({ visible: true }).count()) === 0, "no card falls back to a drawn miniature offline");
      await card("Memories").getByTestId("template-cover").hover();
      const playing = await until(() => page.getByTestId("template-preview-video").evaluateAll((nodes) => nodes.map((node) => ({ time: node.currentTime, file: node.getAttribute("data-file"), width: node.videoWidth }))), (list) => list.length === 1 && list[0].time > 0.3, "the preview plays offline", 100);
      expect(playing[0].file === "/templates/slideshow-memories/preview.mp4" && playing[0].width === 720, `the preview of Memories: ${JSON.stringify(playing[0])}`);
      await shot("01c-gallery-offline-1440-light");
      await page.mouse.move(5, 5);
      // The preview dialog: the description of the starter and its preview playing, still offline.
      await card("Flash sale").getByTestId("template-open").click();
      await tid("template-preview").waitFor();
      expect((await tid("template-description").innerText()) === "A vertical sale announcement in three beats: headline, offer and call to action.", `description ${await tid("template-description").innerText()}`);
      await until(() => tid("template-preview").getByTestId("template-preview-video").evaluateAll((nodes) => nodes.map((node) => node.currentTime)), (list) => list.length === 1 && list[0] > 0.3, "the dialog plays the preview offline", 100);
      await shot("01d-preview-dialog-offline-1440-light");
      await page.keyboard.press("Escape");
      expect(wide.mediaRequests.length === 0, `offline, no request is made for a kept file: ${wide.mediaRequests.join(", ")}`);
    } finally { await wide.context.setOffline(false); }
  });
  await step(wide, "Template gallery — cache first: on a second visit online (the page loaded again) the covers and previews come from the kept copies with no request", async () => {
    wide.mediaRequests.length = 0;
    // A full load of the page: nothing is left in memory, only what Cache Storage keeps.
    await go("/library/templates", "templates-tab");
    await until(cards, (ids) => ids.length === STARTERS.length, "bundled cards");
    await until(() => page.locator('[data-testid="template-card"][data-source="bundled"] [data-testid="template-cover"] img').evaluateAll((nodes) => nodes.filter((node) => node.complete && node.naturalWidth > 0 && node.src.startsWith("blob:")).length), (count) => count === STARTERS.length, "every cover shows from its kept copy", 100);
    await until(() => page.locator('[data-testid="template-cover"][data-stored="true"]').count(), (count) => count === STARTERS.length, "covers and previews read from the cache", 200);
    await card("Event countdown").getByTestId("template-cover").hover();
    await until(() => page.getByTestId("template-preview-video").evaluateAll((nodes) => nodes.map((node) => node.currentTime)), (list) => list.length === 1 && list[0] > 0.3, "the preview plays from its kept copy", 100);
    await page.mouse.move(5, 5);
    const kept = await page.evaluate(async () => { const names = (await caches.keys()).filter((name) => name.startsWith("jagentchill-templates-")); return { names: names.length, files: (await (await caches.open(names[0])).keys()).length }; });
    expect(kept.names === 1 && kept.files === STARTERS.length * 2, `one cache holding the 24 files: ${JSON.stringify(kept)}`);
    expect(wide.mediaRequests.length === 0, `online, second visit: no request is made for a kept file: ${wide.mediaRequests.join(", ")}`);
  });
  await step(wide, "Template gallery — Scenario: Ratio filter on the bundled set; Filter and search; No results", async () => {
    await page.getByRole("combobox", { name: "Aspect ratio" }).filter({ visible: true }).first().click();
    await visible(page.getByRole("option", { name: "1:1", exact: true })).click();
    await until(cards, (ids) => JSON.stringify(ids) === JSON.stringify(["promo-product", "quote-card"]), "1:1 templates");
    await page.getByRole("combobox", { name: "Aspect ratio" }).filter({ visible: true }).first().click();
    await visible(page.getByRole("option", { name: "16:9", exact: true })).click();
    await visible(page.getByRole("searchbox", { name: "Search templates" })).fill("TRAVEL");
    await until(cards, (ids) => JSON.stringify(ids) === JSON.stringify(["vlog-travel"]), "16:9 + travel");
    await visible(page.getByRole("searchbox", { name: "Search templates" })).fill("no such template");
    await text("No templates match your search").waitFor();
    await shot("02-gallery-no-results-1440-light");
    await visible(tid("templates-no-results").getByRole("button", { name: "Clear filters" })).click();
    await until(cards, (ids) => ids.length === STARTERS.length, "filters cleared");
  });
  await step(wide, "Manage personal templates — Scenario: Bundled template menu", async () => {
    await card("Quote of the day").getByTestId("template-menu").click();
    await menuItem("Duplicate to My templates").waitFor();
    await menuItem("Use template").waitFor();
    for (const absent of ["Rename", "Delete", "Export package"]) expect((await page.locator('[role="menuitem"]').and(page.getByLabel(absent, { exact: true })).filter({ visible: true }).count()) === 0, `${absent} is not offered for a starter template`);
    await page.keyboard.press("Escape");
  });

  await step(wide, "setup: a project with two real clips on the main track and a text", async () => {
    await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
    await button("Create your first project").click({ timeout: 90_000 });
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    sourceId = page.url().split("/").pop();
    for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
    await pick(tid("media-dropzone"), [file("red.mp4"), file("blue.mp4")]);
    for (const name of ["red.mp4", "blue.mp4"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
    await tid("thumb-red.mp4").dblclick();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
    await page.keyboard.press("End");
    await tid("thumb-blue.mp4").dblclick();
    await until(async () => elementsOf(await stored()).filter((element) => element.type === "video").length, (count) => count === 2, "two clips stored");
    await page.keyboard.press("Home");
    await tid("panel-tab-text").click();
    await tid("text-add").click();
    await until(async () => elementsOf(await stored()).filter((element) => element.type === "text").length, (count) => count === 1, "a text stored");
    await saved();
  }, true);

  await step(wide, "Preset packs — a text preset saved in the editor is exported as a pack", async () => {
    await button("Save as preset").click();
    await visible(page.getByRole("dialog").getByRole("textbox")).fill("Launch title");
    await tid("preset-save").click();
    await go("/library/packs", "packs-tab");
    await text("1 preset of your own can be exported.").waitFor();
    await tid("packs-export").click();
    await tid("packs-export-name").fill("Launch kit");
    const [got] = await Promise.all([page.waitForEvent("download"), visible(page.getByRole("dialog").getByRole("button", { name: "Export", exact: true })).click()]);
    expect(got.suggestedFilename() === "Launch kit.jcpack", `pack file ${got.suggestedFilename()}`);
    await got.saveAs(file("Launch kit.jcpack"));
    await text("Exported Launch kit: 1 presets").waitFor();
  });
  await step(wide, "Preset packs — Scenario: Import a mixed pack — the pack is listed with its count and its preset is in the editor's Text tab; Remove pack takes it out", async () => {
    await pick(tid("packs-import"), [file("Launch kit.jcpack")]);
    await text("Imported Launch kit: 1 presets").waitFor();
    expect((await tid("pack-name").innerText()) === "Launch kit", "pack row");
    expect((await tid("pack-meta").innerText()).startsWith("1 preset"), `pack meta ${await tid("pack-meta").innerText()}`);
    const count = await visible(page.getByRole("tablist", { name: "Category" }).getByRole("tab", { name: /^Preset packs/ })).innerText();
    expect(/1\s*$/.test(count), `packs tab count ${count}`);
    await shot("03-packs-1440-light");
    // The editor lists the pack's preset beside the user's own: the name is taken, so it carries the pack's name.
    await go(`/editor/${sourceId}`, "asset-panel");
    await tid("panel-tab-text").click();
    await text("Launch title (Launch kit)").waitFor({ timeout: 30_000 });
    await go("/library/packs", "packs-tab");
    await tid("pack-remove").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Remove pack", exact: true })).click();
    await tid("packs-first-use").waitFor();
    await go(`/editor/${sourceId}`, "asset-panel");
    await tid("panel-tab-text").click();
    await text("Launch title", { exact: true }).waitFor({ timeout: 30_000 });
    expect((await page.getByText("Launch title (Launch kit)").filter({ visible: true }).count()) === 0, "the pack's preset is gone");
  });

  await step(wide, "Create a template from a project — Scenario: Save a template", async () => {
    await go(`/editor/${sourceId}`, "asset-panel");
    const before = JSON.stringify((await stored()).scenes);
    await button("Editor menu").click();
    await menuItem("Save as template…").click();
    await tid("save-template").waitFor();
    expect((await page.locator('[data-testid="save-template-clip"][data-slot="true"]').filter({ visible: true }).count()) === 2, "both main-track clips are slots");
    expect((await page.getByTestId("save-template-text").filter({ visible: true }).count()) === 1, "the text is listed");
    await text("No media is saved with the template.").waitFor();
    await page.waitForTimeout(600);
    await shot("04-save-dialog-1440-light");
    await tid("save-template-name").fill("Trip template");
    await tid("save-template-tags").fill("trip, holiday");
    await visible(page.getByRole("dialog").getByRole("button", { name: "Save template", exact: true })).click();
    await text("Saved Trip template to My templates").waitFor({ timeout: 30_000 });
    expect(JSON.stringify((await stored()).scenes) === before, "the project is unchanged");
    await go("/library/templates", "templates-tab");
    await visible(page.getByRole("tab", { name: /^My templates/ })).click();
    await card("Trip template").waitFor();
    expect((await card("Trip template").getByTestId("template-meta").innerText()) === "00:06 · 16:9 · 2 clips", `meta ${await card("Trip template").getByTestId("template-meta").innerText()}`);
    const count = await visible(page.getByRole("tablist", { name: "Category" }).getByRole("tab", { name: /^Templates/ })).innerText();
    expect(/13\s*$/.test(count), `templates tab count ${count}`);
    await page.waitForTimeout(600);
    await shot("05-my-templates-1440-light");
  }, true);

  await step(wide, "Use a template — Scenario: Missing required slot — a new locked draft opens in template mode with Export disabled", async () => {
    await card("Trip template").getByTestId("template-open").click();
    await tid("template-preview").waitFor();
    expect((await page.getByTestId("template-preview-slot").filter({ visible: true }).count()) === 2, "the preview lists both slots");
    await shot("06-template-preview-1440-light");
    await tid("template-use").click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    draftId = page.url().split("/").pop();
    expect(draftId !== sourceId, "a new project");
    await tid("template-editor").waitFor({ timeout: 60_000 });
    for (const id of ["asset-panel", "inspector", "timeline"]) expect((await page.getByTestId(id).filter({ visible: true }).count()) === 0, `${id} is not shown in template mode`);
    expect((await tid("template-missing").innerText()) === "2 required clips are missing", `hint ${await tid("template-missing").innerText()}`);
    expect(await tid("open-export").isDisabled(), "Export is disabled");
    const doc = await until(stored, (value) => value !== null, "the draft is stored");
    expect(doc.template.locked === true && doc.template.slots.every((slot) => !slot.filled), "locked, every slot empty");
    expect(doc.media.assets.length === 0, "the template's clips are not in the new project");
    await shot("07-template-mode-empty-1440-light");
  }, true);
  await step(wide, "Use a template — Scenario: Fill in order — the first picked file fills slot 1, the second slot 2; Slot semantics — Scenario: Cover fit", async () => {
    await pick(tid("template-fill"), [file("green-portrait.mp4"), file("yellow.png")]);
    await until(() => page.locator('[data-testid="template-slot"][data-filled="true"]').filter({ visible: true }).count(), (count) => count === 2, "both slots filled", 200);
    expect((await page.getByTestId("template-missing").filter({ visible: true }).count()) === 0, "no clip is missing");
    expect(!(await tid("open-export").isDisabled()), "Export is enabled");
    await saved();
    const doc = await stored();
    const names = doc.template.slots.map((slot) => doc.media.assets.find((asset) => asset.id === elementsOf(doc).find((element) => element.id === slot.elementId).mediaId)?.name);
    expect(JSON.stringify(names) === JSON.stringify(["green-portrait.mp4", "yellow.png"]), `slot media ${JSON.stringify(names)}`);
    expect(JSON.stringify(elementsOf(doc).filter((element) => doc.template.slots.some((slot) => slot.elementId === element.id)).map((element) => element.type)) === JSON.stringify(["video", "image"]), "slot 2 became an image element");
    expect(doc.template.locked === true, "still a locked draft");
    // The rendered frame: slot 1 at 1 s is the portrait clip covering the whole 16:9 canvas (no bars), slot 2 at 4 s is the still.
    await page.locator('[data-testid="template-slot"][data-slot="slot-1"]').filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
    const green = await canvasShare(GREEN);
    expect(green > 0.85, `slot 1 covers the canvas with the portrait clip: ${green.toFixed(2)}`);
    expect((await canvasShare(RED)) < 0.02, "nothing of the template's own clip is left");
    await shot("08-template-mode-slot1-1440-light");
    await page.locator('[data-testid="template-slot"][data-slot="slot-2"]').filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
    const yellow = await canvasShare(YELLOW);
    expect(yellow > 0.85, `slot 2 shows the still: ${yellow.toFixed(2)}`);
    await shot("09-template-mode-slot2-1440-light");
  });
  await step(wide, "Edit template text and audio — Scenario: Edit a title; Scenario: Length limit", async () => {
    await visible(page.getByRole("tab", { name: /^Text/ })).click();
    const input = tid("template-text-input");
    await input.fill("Summer 2026");
    await input.press("Enter");
    await until(async () => elementsOf(await stored()).find((element) => element.type === "text")?.content, (content) => content === "Summer 2026", "the title is stored");
    const limit = (await stored()).template.editableTexts[0].maxLength;
    await input.fill("x".repeat(limit + 30));
    expect((await input.inputValue()).length === limit, `input stops at ${limit}: ${(await input.inputValue()).length}`);
    await input.fill("Summer 2026");
    await input.press("Enter");
    await shot("10-template-mode-text-1440-light");
  });
  await step(wide, "Replace and adjust slot media — Remove empties a slot, Undo brings the media back", async () => {
    await visible(page.getByRole("tab", { name: /^Media/ })).click();
    await page.locator('[data-testid="template-slot"][data-slot="slot-2"]').filter({ visible: true }).first().click();
    await tid("template-slot-remove").click();
    await tid("template-missing").waitFor();
    expect((await tid("template-missing").innerText()) === "1 required clip is missing", `hint ${await tid("template-missing").innerText()}`);
    await tid("template-undo").click();
    await until(() => page.locator('[data-testid="template-slot"][data-filled="true"]').filter({ visible: true }).count(), (count) => count === 2, "undo refills the slot");
  });

  await step(wide, "Brand kit — Scenario: Empty kit, then colours and a heading font are kept", async () => {
    await saved();
    await go("/library/brand-kits", "brand-kit");
    await text("Add your logo, colours and fonts to reuse them everywhere").waitFor();
    await tid("brand-colour-hex").fill("#0055ff");
    await tid("brand-colour-name").fill("Brand blue");
    await tid("brand-colour-add").click();
    await page.locator('[data-testid="brand-colour"][data-value="#0055ff"]').filter({ visible: true }).first().waitFor();
    await tid("brand-font-select").getByRole("combobox").click();
    await visible(page.getByRole("option", { name: "Gelasio", exact: true })).click();
    await tid("brand-font-add").click();
    await visible(page.locator('[data-testid="brand-font"][data-family="Gelasio"]').getByRole("checkbox", { name: "Heading" })).click();
    await pick(tid("brand-logo-import"), [file("yellow.png")]);
    await tid("brand-logo").waitFor();
    expect((await page.getByTestId("brand-empty").filter({ visible: true }).count()) === 0, "the kit is not empty any more");
    const count = await visible(page.getByRole("tablist", { name: "Category" }).getByRole("tab", { name: /^Brand kits/ })).innerText();
    expect(/1\s*$/.test(count), `brand kits tab count ${count}`);
    await page.waitForTimeout(500);
    await shot("11-brand-kit-1440-light");
  });
  await step(wide, "Brand kit — Scenario: Apply brand to a template; Scenario: Bound fields follow the theme colour", async () => {
    await go(`/editor/${draftId}`, "template-editor");
    const before = await stored(), bound = before.template.colorBindings[0];
    expect(bound && bound.field === "color", `the text colour is bound: ${JSON.stringify(before.template.colorBindings)}`);
    await tid("template-apply-brand").click();
    await text("Brand applied").waitFor();
    const doc = await until(stored, (value) => value.template.themeColors[0] === "#0055ff", "theme colour 0 is the brand colour");
    const title = elementsOf(doc).find((element) => element.id === bound.elementId);
    expect(title.color === "#0055ff", `title colour ${title.color}`);
    expect(title.fontFamily === "Gelasio", `title font ${title.fontFamily}`);
    expect(title.content === "Summer 2026", "the text is kept");
    await page.locator('[data-testid="template-slot"][data-slot="slot-1"]').filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
    await shot("12-template-mode-brand-1440-light");
    await tid("template-undo").click();
    await until(stored, (value) => value.template.themeColors[0] !== "#0055ff", "one undo reverts the brand");
    await tid("template-redo").click();
    await until(stored, (value) => value.template.themeColors[0] === "#0055ff", "redo applies it again");
  });
  await step(wide, "Brand kit — Scenario: Brand colours in the picker; the editor's Brand kit tab shows the kit", async () => {
    await go(`/editor/${sourceId}`, "asset-panel");
    await tid("panel-tab-brand-kit").click();
    await tid("editor-brand-tab").waitFor();
    await page.locator('[data-testid="brand-colour"][data-value="#0055ff"]').filter({ visible: true }).first().waitFor();
    await tid("panel-tab-templates").click();
    await tid("editor-templates-tab").waitFor();
    await until(cards, (ids) => ids.length === STARTERS.length, "the editor's Templates tab lists the starters");
    await shot("13-editor-templates-tab-1440-light");
  });
  await step(wide, "Use a template — Scenario: Draft is stored locked — the project list shows the Template draft badge and reopens in template mode", async () => {
    await go("/projects", "projects-screen").catch(async () => { await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); });
    await text("Template draft").waitFor({ timeout: 30_000 });
    await go(`/editor/${draftId}`, "template-editor");
    expect((await stored()).template.locked === true, "locked after a reload");
  });

  await step(wide, "Export a package — Scenario: Export and re-import; Manage personal templates — rename, delete", async () => {
    await go("/library/templates", "templates-tab");
    await visible(page.getByRole("tab", { name: /^My templates/ })).click();
    await cardMenu("Trip template", "Rename");
    await tid("template-name-input").fill("Holiday template");
    await visible(page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true })).click();
    await card("Holiday template").waitFor();
    await cardMenu("Holiday template", "Export package");
    [download] = await Promise.all([page.waitForEvent("download"), visible(page.getByRole("dialog").getByRole("button", { name: "Export", exact: true })).click()]);
    expect(download.suggestedFilename() === "Holiday template.jctpl", `package name ${download.suggestedFilename()}`);
    await download.saveAs(file("Holiday template.jctpl"));
    await cardMenu("Holiday template", "Delete");
    await visible(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).click();
    await text("Moved Holiday template to the trash").waitFor();
    await tid("templates-first-use").waitFor();
    await pick(tid("templates-import"), [file("Holiday template.jctpl")]);
    // The trashed template still holds the id: the import asks what to do, and "Keep both" lists a second one.
    await tid("template-conflict-keep-both").click();
    await card("Holiday template 2").waitFor({ timeout: 30_000 });
    expect((await card("Holiday template 2").getByTestId("template-meta").innerText()) === "00:06 · 16:9 · 2 clips", "the imported template has its slots");
    await shot("14-imported-template-1440-light");
  });
  await step(wide, "Open a template project in the full editor — Scenario: Cancel the confirmation; Scenario: Unlock", async () => {
    await go(`/editor/${draftId}`, "template-editor");
    await tid("template-unlock").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true })).click();
    await tid("template-editor").waitFor();
    await tid("template-unlock").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Edit in full editor", exact: true })).click();
    for (const id of ["asset-panel", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 30_000 });
    expect((await page.getByTestId("template-editor").filter({ visible: true }).count()) === 0, "the slot chips are gone");
    await until(stored, (value) => value.template.locked === false, "the lock is released");
    await shot("15-unlocked-1440-light");
  });

  // ————— The starters in use —————
  const useStarter = async (name) => {
    await go("/library/templates", "templates-tab");
    await card(name).getByTestId("template-open").click();
    await tid("template-preview").waitFor();
    await tid("template-use").click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await tid("template-editor").waitFor({ timeout: 60_000 });
  };
  await step(wide, "Use a template — every bundled starter opens in template mode with its slots empty; Scenario: Demo media stays out of projects", async () => {
    for (const [id, name, slots] of STARTERS) {
      await useStarter(name);
      const shown = await until(() => page.locator('[data-testid="template-slot"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-filled"))), (list) => list.length === slots, `${id}: slot chips`);
      expect(shown.every((filled) => filled === "false"), `${id}: every slot is empty`);
      const doc = await until(stored, (value) => value !== null, `${id}: the draft is stored`);
      // (W7: a starter ships no file. Its music is a track of the remote catalogue, fetched when a host is connected: the new draft holds no media, or that one sound.)
      expect(doc.template.templateId === id && doc.template.locked === true && doc.media.assets.every((asset) => asset.type === "audio" && asset.provenance?.source === "stock") && doc.media.assets.length <= 1, `${id}: a locked draft whose only media is its bundled music`);
      expect((await page.getByTestId("canvas").filter({ visible: true }).count()) === 1, `${id}: the player is shown`);
      if (id === "outro-end-screen") await shot("30-starter-outro-empty-1440-light");
    }
  });
  // One starter per canvas shape: its slots take clips made here with ffmpeg, and the app's export is a playable file.
  for (const [id, files] of [["intro-channel", ["blue.mp4"]], ["promo-sale", ["green-portrait.mp4", "red.mp4"]], ["quote-card", ["red.mp4"]], ["slideshow-story", ["yellow.png", "yellow.png", "yellow.png"]]]) {
    const [, name, , ratio, seconds] = STARTERS.find((entry) => entry[0] === id);
    await step(wide, `Use a template — the starter ${id} is filled with ffmpeg-made media and exported to a playable MP4`, async () => {
      await useStarter(name);
      await pick(tid("template-fill"), [...new Set(files)].map(file));
      // A file picked once fills one slot; the remaining required slots take it through "Choose media".
      for (let index = 1; index < files.length && new Set(files).size === 1; index++) {
        await until(() => page.locator('[data-testid="template-slot"][data-filled="true"]').filter({ visible: true }).count(), (count) => count === index, `${id}: slot ${index} filled`, 200);
        await page.locator(`[data-testid="template-slot"][data-slot="slot-${index + 1}"]`).filter({ visible: true }).first().click();
        await pick(tid("template-slot-replace"), [file(files[index])]);
      }
      await until(() => page.locator('[data-testid="template-slot"][data-filled="true"]').filter({ visible: true }).count(), (count) => count === files.length, `${id}: ${files.length} slots filled`, 200);
      expect((await page.getByTestId("template-missing").filter({ visible: true }).count()) === 0, `${id}: no required clip is missing`);
      await saved();
      await tid("open-export").click();
      await tid("export-dialog").waitFor();
      await page.waitForTimeout(800);
      await tid("export-start").click();
      await Promise.race([tid("export-done").waitFor({ timeout: 300_000 }), tid("export-error").waitFor({ timeout: 300_000 })]);
      expect(await page.getByTestId("export-done").count(), `${id}: the export ended: ${(await tid("export-dialog").innerText()).replace(/\s+/g, " ").slice(-200)}`);
      const exported = (await tid("export-done-name").innerText()).trim();
      const bytes = await page.evaluate(async (fileName) => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked"), data = new Uint8Array(await (await (await folder.getFileHandle(fileName)).getFile()).arrayBuffer());
        let text = ""; for (let at = 0; at < data.length; at += 0x8000) text += String.fromCharCode(...data.subarray(at, at + 0x8000));
        return btoa(text);
      }, exported);
      writeFileSync(file(`${id}.mp4`), Buffer.from(bytes, "base64"));
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "format=duration:stream=codec_name,width,height,nb_read_frames", "-of", "json", file(`${id}.mp4`)]).toString());
      const [stream] = info.streams;
      console.log("      ffprobe", id, JSON.stringify({ ...stream, duration: info.format.duration }));
      expect(stream.codec_name === "h264" && Math.abs(stream.width / stream.height - ratio) < 0.01, `${id}: H.264 in the template's ratio: ${stream.codec_name} ${stream.width}×${stream.height}`);
      expect(Math.abs(Number(info.format.duration) - seconds) < 0.25 && Number(stream.nb_read_frames) >= seconds * 30 - 2, `${id}: every frame of ${seconds} s decodes: ${info.format.duration} s, ${stream.nb_read_frames} frames`);
      // A frame of the file, for the eye: the picked media under the starter's own texts.
      ffmpeg("-ss", "1.5", "-i", file(`${id}.mp4`), "-frames:v", "1", "-vf", "scale=-2:480", `${shots}/31-starter-export-${id}.jpg`);
    });
  }
}
await wide.context.close();

// ————— Dark, wide; and 390 × 844 light and dark —————
for (const [name, width, height, scheme] of [["1440-dark", 1440, 900, "dark"], ["390-light", 390, 844, "light"], ["390-dark", 390, 844, "dark"]]) {
  const ui = await open(width, height, { colorScheme: scheme });
  const { page, tid, shot, go, cards, card, pick } = ui;
  await step(ui, `Template gallery and template mode at ${name}`, async () => {
    await go("/library/templates", "templates-tab");
    await until(cards, (ids) => ids.length === STARTERS.length, "bundled cards");
    await until(() => page.locator('[data-testid="template-cover"] img').evaluateAll((nodes) => nodes.filter((node) => node.complete && node.naturalWidth > 0).length), (count) => count === STARTERS.length, "every cover loaded", 100);
    await page.waitForTimeout(500);
    await shot(`20-gallery-${name}`);
    await card("Product spotlight").getByTestId("template-open").click();
    await tid("template-use").click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await tid("template-editor").waitFor({ timeout: 60_000 });
    expect((await tid("template-missing").innerText()) === "3 required clips are missing", `hint ${await tid("template-missing").innerText()}`);
    await pick(tid("template-fill"), [file("green-portrait.mp4")]);
    await until(() => page.locator('[data-testid="template-slot"][data-filled="true"]').filter({ visible: true }).count(), (count) => count === 1, "slot 1 filled", 200);
    await page.waitForTimeout(1500);
    await shot(`21-template-mode-${name}`);
    await go("/library/brand-kits", "brand-kit");
    await shot(`22-brand-kit-${name}`);
    await go("/library/packs", "packs-tab");
    await shot(`23-packs-${name}`);
  });
  await ui.context.close();
}

await browser.close();
rmSync(dir, { recursive: true });
const real = errors.filter((entry) => !/favicon|ResizeObserver/.test(entry));
if (real.length) console.log("CONSOLE ERRORS:\n" + [...new Set(real)].slice(0, 12).join("\n"));
console.log(failed === 0 && real.length === 0 ? "ALL PASSED" : `FAILED: ${failed} step(s), ${real.length} console error(s)`);
process.exit(failed === 0 && real.length === 0 ? 0 : 1);
