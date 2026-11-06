// End-to-end in a real browser, with no host: the Library screen (`app-shell-navigation.Library screen`, frame #d-library)
// at 1440 × 900 and 390 × 844, light and dark, and the use of its items inside a project.
// Real storage (IndexedDB and OPFS of a fresh browser profile). The files are real ones made here: a PNG and a WAV with
// ffmpeg, two .cube tables written as text. Everything on screen is imported through the Import button; nothing is seeded or mocked.
// Usage: node apps/app/e2e/library.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/library";
const base = process.argv[3] ?? "http://localhost:8096";
mkdirSync(shots, { recursive: true });

const dir = join(tmpdir(), "jagentchill-library-e2e");
mkdirSync(dir, { recursive: true });
const file = (name) => join(dir, name);
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
if (!existsSync(file("badge.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=0xE0483A:s=256x256:d=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-128,Y-128),110),255,0)'", "-frames:v", "1", file("badge.png"));
if (!existsSync(file("ribbon.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x2F7DE1:s=320x120:d=1", "-frames:v", "1", file("ribbon.png"));
if (!existsSync(file("chime.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=660:duration=2", file("chime.wav"));
if (!existsSync(file("clip.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", file("clip.mp4"));
// A 2 × 2 × 2 table that swaps red and blue, and a larger one that inverts: their previews differ from every built-in one.
const cube = (title, size, map) => { const rows = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`]; for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) rows.push(map(r / (size - 1), g / (size - 1), b / (size - 1)).map((value) => value.toFixed(6)).join(" ")); return rows.join("\n") + "\n"; };
writeFileSync(file("swap.cube"), cube("Swap Red Blue", 2, (r, g, b) => [b, g, r]));
writeFileSync(file("invert.cube"), cube("Zebra Invert", 5, (r, g, b) => [1 - r, 1 - g, 1 - b]));
writeFileSync(file("broken.cube"), "LUT_3D_SIZE 2\n0 0 0\nthis is not a table\n");
writeFileSync(file("notes.txt"), "not a library file\n");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
let failed = 0;
const expect = (condition, message) => { if (!condition) throw new Error(message); };
/** Reads a value until it is the expected one: the sidebar counts follow a change of the library a moment after the screen does. */
const reads = async (read, expected, what) => { let value; for (let index = 0; index < 40; index++) { value = await read(); if (value === expected) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`${what}: ${value}, expected ${expected}`); };

/** One browser profile (its own storage) at a viewport, with the helpers that read its page. */
async function open(width, height, options = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", ...options });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_/.test(msg.text())) errors.push(msg.text().slice(0, 400)); });
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  const ui = {
    page, context, visible, tid,
    text: (value, o) => visible(page.getByText(value, o)),
    button: (name, exact = true) => visible(page.getByRole("button", { name, exact })),
    menuItem: (name) => visible(page.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').and(page.getByLabel(name, { exact: true }))),
    shot: (name) => page.screenshot({ path: `${shots}/${name}.png` }),
    go: async (path) => { await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 240_000 }); await tid("library-screen").waitFor({ timeout: 90_000 }); },
    /** The names of the items the category shows, in order. */
    names: () => page.locator('[data-testid="library-item"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-name"))),
    item: (name) => visible(page.locator(`[data-testid="library-item"][data-name="${name}"]`)),
    /** A category is a tab inside the Library screen (owner, 2026-10-07); the sidebar no longer lists them. */
    catTab: (id) => visible(page.getByRole("tablist", { name: "Category" }).getByRole("tab", { name: new RegExp(`^${CATEGORIES.find((entry) => entry[0] === id)[1]}(\\s|$)`) })),
    /** The count a category tab shows, worded as the old sidebar row was ("12 items", "16 families"). */
    sidebarMeta: async (id) => { const label = CATEGORIES.find((entry) => entry[0] === id)[1]; const tab = visible(page.getByRole("tablist", { name: "Category" }).getByRole("tab", { name: new RegExp(`^${label}(\\s|$)`) })); const count = /(\d+)\s*$/.exec((await tab.innerText()).replace(label, "").trim())?.[1] ?? "0"; return `${count} ${id === "fonts" ? (count === "1" ? "family" : "families") : (count === "1" ? "item" : "items")}`; },
    pick: async (trigger, files) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]); await chooser.setFiles(files); },
    itemMenu: async (name, entry) => { await ui.item(name).getByTestId("library-item-menu").click(); await ui.menuItem(entry).click(); },
    /** Fills the Library's name dialog (New folder / Rename) and presses the dialog's own submit button. The dialog is
     *  addressed by its accessible name, so the submit is never confused with another "Create" on the page; and because a
     *  dev-server Fast Refresh can remount the screen and drop the dialog between filling and submitting, the whole
     *  open → fill → submit run is retried once. */
    nameDialog: async (trigger, label, submit, name) => {
      const dialog = visible(page.getByRole("dialog", { name: label }));
      for (let attempt = 0; ; attempt++) {
        if (!(await dialog.isVisible().catch(() => false))) {
          await trigger.click();
          try { await dialog.waitFor({ timeout: 10_000 }); } catch (err) { if (attempt >= 1) throw err; continue; }
        }
        try { await tid("library-name-input").fill(name); return await dialog.getByRole("button", { name: submit, exact: true }).click({ timeout: 15_000 }); }
        catch (err) { if (attempt >= 1) throw err; await page.waitForTimeout(300); }
      }
    },
  };
  return ui;
}
const step = async (ui, name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) {
    failed++; console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join(" "));
    await ui.shot(`failure-${failed}`).catch(() => undefined);
    console.log("PAGE TEXT:", (await ui.page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 600));
    await ui.page.keyboard.press("Escape").catch(() => undefined);
  }
};
const CATEGORIES = [["templates", "Templates"], ["packs", "Preset packs"], ["fonts", "Fonts"], ["luts", "LUTs"], ["sounds", "Saved sounds"], ["stickers", "Stickers"], ["brand-kits", "Brand kits"]];

// ————— Wide: 1440 × 900 —————
const wide = await open(1440, 900);
{
  const { page, tid, text, button, menuItem, shot, go, names, item, sidebarMeta, catTab, pick, itemMenu, nameDialog, visible } = wide;
  const pills = () => page.getByRole("tablist", { name: "Category" }).filter({ visible: true }).count();

  await step(wide, "Categories — the screen shows exactly the seven categories as tabs, in order; the sidebar does not list them", async () => {
    await go("/library");
    await page.waitForURL(/\/library\/templates$/);
    const rows = await page.getByRole("tablist", { name: "Category" }).getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.innerText.replace(/\s*\d+\s*$/, "").trim()));
    expect(JSON.stringify(rows) === JSON.stringify(CATEGORIES.map((entry) => entry[1])), `category tabs ${JSON.stringify(rows)}`);
    expect((await pills()) === 1, "one row of category tabs inside the screen");
    expect((await page.locator('[data-testid^="library-row-"]').filter({ visible: true }).count()) === 0, "no category rows in the sidebar");
    expect((await page.getByText("Media", { exact: true }).filter({ visible: true }).count()) === 0, "Media is not a library category");
    await text("Library", { exact: true }).first().waitFor();
    expect((await page.title()).startsWith("Templates"), `title ${await page.title()}`);
  });

  await step(wide, "Templates, Preset packs and Brand kits — each tab shows its own screen: the starter templates, and the first-use state of packs and of the brand kit", async () => {
    // These three categories are not lists of files: each brings its own screen and toolbar (apps/app/e2e/templates.mjs exercises them).
    for (const [id, title, importer, count] of [["templates", "My templates", "templates-import", "12 items"], ["packs", "No preset packs yet", "packs-import", "0 items"], ["brand-kits", "No brand kits yet", "brand-logo-import", "0 items"]]) {
      await catTab(id).click(); await page.waitForURL(new RegExp(`/library/${id}$`));
      await text(title).waitFor();
      expect((await page.getByTestId("library-toolbar").filter({ visible: true }).count()) === 0, `${id}: the file toolbar is not shown`);
      expect((await page.getByTestId("library-new-folder").filter({ visible: true }).count()) === 0, `${id}: no New folder`);
      await reads(() => sidebarMeta(id), count, `${id}: tab count`);
      await tid(importer).waitFor();
    }
    await go("/library/templates");
    expect((await page.getByTestId("template-card").filter({ visible: true }).count()) === 12, "the twelve starter templates are listed");
    await shot("01-templates-1440-light");
  });

  await step(wide, "Built-in category with nothing imported — LUTs shows the grid with one quiet import hint under the toolbar, not the big first-use state", async () => {
    await catTab("luts").click(); await page.waitForURL(/\/library\/luts$/);
    await tid("library-import-hint").waitFor();
    await text("Import .cube or .3dl files to use them in the Adjust tab of every project.").waitFor();
    await tid("library-import-hint").getByRole("link", { name: "Import", exact: true }).waitFor();
    expect((await page.getByTestId("library-first-use").filter({ visible: true }).count()) === 0, "no big first-use state above the built-in grid");
    const listed = await names();
    expect(listed.length === 12 && listed.includes("Teal & Orange"), `the twelve built-in LUTs are listed: ${listed.length}`);
    expect((await sidebarMeta("luts")) === "12 items", `sidebar count ${await sidebarMeta("luts")}`);
    for (const id of ["library-toolbar", "library-new-folder", "library-import"]) await tid(id).waitFor();
    await page.getByRole("searchbox", { name: "Search LUTs" }).waitFor();
    await page.getByRole("combobox", { name: "Sort by" }).waitFor();
    await page.getByRole("radiogroup", { name: "View" }).waitFor();
    // The hint sits directly under the toolbar, above the folder cards (library-empty-r2 finding 2): check it with an empty folder present.
    const toolbarBox = await tid("library-toolbar").boundingBox();
    const hintBox = await tid("library-import-hint").boundingBox();
    expect(hintBox.y >= toolbarBox.y + toolbarBox.height - 1, `the hint sits under the toolbar: hint ${hintBox.y}, toolbar bottom ${toolbarBox.y + toolbarBox.height}`);
    await nameDialog(tid("library-new-folder"), "New folder", "Create", "Empty shelf");
    await tid("library-folder").waitFor();
    const hintWithFolder = await tid("library-import-hint").boundingBox();
    const folderBox = await tid("library-folder").boundingBox();
    expect(hintWithFolder.y < folderBox.y, `the hint is above the folder cards: hint ${hintWithFolder.y}, folder ${folderBox.y}`);
    // Remove the folder again so the later folder and count steps see only what they create.
    await tid("library-folder-menu").click(); await menuItem("Delete folder").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-folder"]').length === 0);
    await shot("02-luts-empty-1440-light");
  });

  await step(wide, "Import routes each file to its category — one pick of a LUT, two stickers, a sound, a broken table and a text file", async () => {
    await pick(tid("library-import-hint").getByRole("link", { name: "Import", exact: true }), [file("swap.cube"), file("badge.png"), file("ribbon.png"), file("chime.wav"), file("broken.cube"), file("notes.txt")]);
    await item("Swap Red Blue").waitFor({ timeout: 30_000 });
    await text("Added 4 items to the Library").waitFor();
    await text(/broken\.cube: /).waitFor();
    await text("notes.txt: This file type cannot be kept in the Library").waitFor();
    expect((await page.getByTestId("library-import-hint").filter({ visible: true }).count()) === 0, "the import hint leaves once something is imported");
    await reads(() => sidebarMeta("luts"), "13 items", "sidebar count of LUTs"); await reads(() => sidebarMeta("stickers"), "2 items", "sidebar count of Stickers"); await reads(() => sidebarMeta("sounds"), "1 item", "sidebar count of Saved sounds");
    expect((await names()).length === 13, "the category lists what the sidebar counts");
    // The same bytes again are listed once.
    await pick(tid("library-import"), [file("swap.cube")]);
    await text("swap.cube is already in the Library").waitFor();
    expect((await names()).length === 13, "a file that is already kept is not listed twice");
    await pick(tid("library-import"), [file("invert.cube")]);
    await item("Zebra Invert").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await shot("03-luts-imported-1440-light");
  });

  await step(wide, "Search, filter chips and Clear filters — by a part of the name; Source is Imported; a search with no match", async () => {
    const search = page.getByRole("searchbox", { name: "Search LUTs" });
    await search.fill("teal");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 1);
    expect(JSON.stringify(await names()) === JSON.stringify(["Teal & Orange"]), `search result ${await names()}`);
    await search.fill("no such table");
    await text(/No results for/).waitFor();
    await visible(page.getByRole("button", { name: "Clear search" })).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 14);
    await visible(page.getByRole("button", { name: "+ Add filter" })).click();
    await menuItem("Source is Imported").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 2);
    await text("Source is Imported").waitFor();
    await shot("04-luts-filtered-1440-light");
    await tid("library-clear-filters").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 14);
    await visible(page.getByRole("button", { name: "+ Add filter" })).click();
    await menuItem("Source is Built-in").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 12);
    await visible(page.getByRole("button", { name: /Remove.*Source is Built-in|Source is Built-in.*Remove|^Remove$/ })).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 14);
  });

  await step(wide, "Sort and the grid / list switch — the order follows the choice and both are kept for the next visit", async () => {
    const sort = page.getByRole("combobox", { name: "Sort by" });
    expect((await names())[0] === "Cool Film" && (await sort.innerText()).trim() === "Name ↑", `by name ascending first: ${(await names())[0]} / ${await sort.innerText()}`);
    await sort.click(); await tid("option-desc").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="library-item"]')?.getAttribute("data-name") === "Zebra Invert");
    expect((await sort.innerText()).trim() === "Name ↓", `the select reads the order: ${await sort.innerText()}`);
    await sort.click(); await tid("option-size").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="library-item"]')?.getAttribute("data-name") === "Zebra Invert");
    expect((await names())[1] === "Swap Red Blue", `by size, largest first: ${(await names()).slice(0, 3)}`);
    await visible(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "List" })).click();
    await tid("library-list").waitFor();
    expect((await page.getByTestId("library-grid").filter({ visible: true }).count()) === 0, "the list replaces the grid");
    await shot("05-luts-list-1440-light");
    await page.reload({ waitUntil: "networkidle" });
    await tid("library-list").waitFor({ timeout: 60_000 });
    expect((await names())[0] === "Zebra Invert", "the sort is kept across a reload");
    await visible(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Grid" })).click();
    await tid("library-grid").waitFor();
    await page.getByRole("combobox", { name: "Sort by" }).click(); await tid("option-name").click();
    await page.getByRole("combobox", { name: "Sort by" }).click(); await tid("option-asc").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="library-item"]')?.getAttribute("data-name") === "Cool Film");
  });

  await step(wide, "New folder, Move to folder, the folder chip — a folder card with its count; opening it shows its items", async () => {
    await nameDialog(tid("library-new-folder"), "New folder", "Create", "Client looks");
    await tid("library-folder").waitFor();
    expect(/Client looks\s*0/.test((await tid("library-folder").innerText()).replace(/\n/g, " ")), `an empty folder card: ${await tid("library-folder").innerText()}`);
    await item("Swap Red Blue").getByTestId("library-item-menu").click();
    await menuItem("Move to folder").hover(); await menuItem("Move to folder").click().catch(() => undefined);
    await menuItem("Client looks").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 13);
    expect(/Client looks\s*1/.test((await tid("library-folder").innerText()).replace(/\n/g, " ")), "the folder card counts its item");
    await reads(() => sidebarMeta("luts"), "14 items", "the sidebar counts the items inside folders too");
    await shot("06-luts-folder-1440-light");
    await tid("library-folder").getByRole("button", { name: /^Folder Client looks/ }).click();
    await text("Folder is Client looks").waitFor();
    expect(JSON.stringify(await names()) === JSON.stringify(["Swap Red Blue"]), `inside the folder: ${await names()}`);
    await tid("library-clear-filters").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 13);
    // Deleting the folder puts its items back in the category.
    await tid("library-folder-menu").click(); await menuItem("Delete folder").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 14);
    expect((await page.getByTestId("library-folder").filter({ visible: true }).count()) === 0, "the folder is gone");
  });

  await step(wide, "Rename and Delete — an imported item takes a new name; a built-in one offers neither; Delete asks first", async () => {
    await itemMenu("Zebra Invert", "Rename");
    // The dialog takes the focus as it opens: the name is typed once it has come to rest.
    await page.waitForTimeout(400);
    await tid("library-name-input").fill("Negative");
    await tid("library-name-input").press("Enter");
    await item("Negative").waitFor();
    expect((await item("Cool Film").getByTestId("library-item-menu").count()) === 0, "a built-in LUT has no actions");
    await itemMenu("Negative", "Delete");
    await text("Delete Negative?").waitFor();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 13);
    await reads(() => sidebarMeta("luts"), "13 items", "sidebar count after the delete");
    await page.reload({ waitUntil: "networkidle" });
    await item("Swap Red Blue").waitFor({ timeout: 60_000 });
    expect(!(await names()).includes("Negative") && (await names()).length === 13, "the delete and the import are stored");
  });

  await step(wide, "Stickers and Saved sounds — the imported sticker is drawn from its own file; a sound previews", async () => {
    await catTab("stickers").click(); await page.waitForURL(/\/library\/stickers$/);
    await item("badge").waitFor();
    expect(JSON.stringify(await names()) === JSON.stringify(["badge", "ribbon"]), `stickers ${await names()}`);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="library-item"] img')].filter((image) => image.naturalWidth > 0).length === 2, null, { timeout: 20_000 });
    await shot("07-stickers-1440-light");
    await catTab("sounds").click(); await page.waitForURL(/\/library\/sounds$/);
    await item("chime").waitFor();
    await item("chime").getByTestId("library-play").click();
    await visible(page.getByRole("button", { name: "Pause chime" })).waitFor();
    await visible(page.getByRole("button", { name: "Pause chime" })).click();
    await visible(page.getByRole("button", { name: "Play chime" })).waitFor();
    await shot("08-sounds-1440-light");
  });

  await step(wide, "Fonts — the bundled families, counted the same in the sidebar; nothing to import, rename or delete", async () => {
    await catTab("fonts").click(); await page.waitForURL(/\/library\/fonts$/);
    await item("Arimo").waitFor();
    const count = (await names()).length;
    expect((await sidebarMeta("fonts")) === `${count} families`, `sidebar ${await sidebarMeta("fonts")} for ${count} families on screen`);
    expect((await page.getByTestId("library-item-menu").filter({ visible: true }).count()) === 0, "bundled fonts have no actions");
    expect((await page.getByTestId("library-import").filter({ visible: true }).count()) === 0 && (await page.getByTestId("library-new-folder").filter({ visible: true }).count()) === 0, "no Import and no New folder where the product imports no fonts");
    // Fonts cannot be imported from this screen, so it shows no inline import hint either (library-empty-r2 finding 1).
    expect((await page.getByTestId("library-import-hint").filter({ visible: true }).count()) === 0, "Fonts shows no import hint");
    await shot("09-fonts-1440-light");
  });

  await step(wide, "Collapsed sidebar — the category tabs stay where they are with the sidebar collapsed or shown", async () => {
    await button("Collapse sidebar").click();
    await page.getByRole("tablist", { name: "Category" }).waitFor();
    const tabs = await page.getByRole("tablist", { name: "Category" }).getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.innerText.replace(/\s*\d+\s*$/, "").trim()));
    expect(JSON.stringify(tabs) === JSON.stringify(CATEGORIES.map((entry) => entry[1])), `tabs ${tabs}`);
    await catTab("luts").click(); await page.waitForURL(/\/library\/luts$/);
    await shot("10-luts-sidebar-collapsed-1440-light");
    await button("Show sidebar").click();
    expect((await pills()) === 1, "the tabs are still one row inside the screen");
  });

  await step(wide, "Last category and Unknown category — /library reopens the last one; an unknown one is the not-found screen", async () => {
    await go("/library"); await page.waitForURL(/\/library\/luts$/);
    await page.goto(`${base}/library/unknown`, { waitUntil: "networkidle" });
    await text("Page not found").waitFor({ timeout: 60_000 });
  });

  await step(wide, "In a project — a library sticker, sound and LUT are offered by the editor's own panels and land in the project", async () => {
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await visible(page.getByRole("button", { name: /^(Create your first project|New project)$/ })).click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    await tid("timeline").waitFor({ timeout: 60_000 });
    const clips = () => page.locator('[data-testid^="clip-"]').filter({ visible: true }).count();
    await pick(tid("media-dropzone"), [file("clip.mp4")]);
    await tid("thumb-clip.mp4").waitFor({ timeout: 60_000 });
    await tid("thumb-clip.mp4").dblclick();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
    // Stickers: My stickers lists the two library stickers; a press imports the file into the project and adds it.
    await tid("panel-tab-stickers").click(); await tid("stickers-tab").waitFor();
    await visible(page.getByRole("tab", { name: "My stickers" })).click();
    const tile = visible(page.locator('[data-testid^="sticker-library-"]'));
    await tile.waitFor();
    expect((await page.locator('[data-testid^="sticker-library-"]').filter({ visible: true }).count()) === 2, "both library stickers are offered");
    const before = await clips();
    await visible(page.getByRole("button", { name: "badge", exact: true })).click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid^="clip-"]').length > count, before, { timeout: 30_000 });
    await visible(page.locator('[data-testid^="sticker-user-"]')).waitFor();
    expect((await page.locator('[data-testid^="sticker-library-"]').filter({ visible: true }).count()) === 1, "a sticker that is in the project is listed once, as the project's");
    // Audio: the library sound has a row; + brings it into the project and onto an audio track.
    await tid("panel-tab-audio").click(); await tid("audio-tab").waitFor();
    const row = tid("audio-library-row");
    await row.waitFor();
    expect(/chime/.test(await row.innerText()) && /Library/.test(await row.innerText()), `the library row: ${await row.innerText()}`);
    const mid = await clips();
    await row.getByTestId("audio-add").click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid^="clip-"]').length > count, mid, { timeout: 30_000 });
    await tid("audio-row").waitFor();
    expect((await page.getByTestId("audio-library-row").filter({ visible: true }).count()) === 0, "the sound is now a sound of the project");
    // LUT: the Adjustment tab of the selected clip lists the library table; choosing it applies it.
    await page.locator('[data-testid="track-main-video"] [data-testid^="clip-"]').first().click();
    await visible(page.getByRole("tab", { name: "Adjustment" })).click(); await tid("adjustment-tab").waitFor();
    const lut = visible(page.locator('[data-testid^="lut-library-"]'));
    await lut.scrollIntoViewIfNeeded();
    expect(/Swap Red Blue/.test(await lut.innerText()) && /Library/.test(await lut.innerText()), `the library LUT row: ${await lut.innerText()}`);
    const canvas = await tid("canvas").boundingBox();
    const grab = () => page.screenshot({ clip: { x: canvas.x + 4, y: canvas.y + 4, width: canvas.width - 8, height: canvas.height - 8 } });
    await page.waitForTimeout(1200);
    const plain = await grab();
    await lut.click();
    await visible(page.locator('[data-testid^="lut-user:"]')).waitFor({ timeout: 30_000 });
    expect((await page.locator('[data-testid^="lut-library-"]').filter({ visible: true }).count()) === 0, "the table is now one of the project's imported LUTs");
    await page.waitForTimeout(1500);
    const graded = await grab();
    expect(!plain.equals(graded), "the preview changes when the library LUT is applied");
    await visible(page.getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
    await shot("11-editor-library-items-1440-light");
  });

  await step(wide, "Dark theme — the Library in the dark theme", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await go("/library/luts");
    await item("Swap Red Blue").waitFor();
    await page.waitForTimeout(500);
    await shot("12-luts-1440-dark");
    await catTab("stickers").click(); await item("badge").waitFor(); await page.waitForTimeout(500);
    await shot("13-stickers-1440-dark");
    await page.emulateMedia({ colorScheme: "light" });
  });
  await wide.context.close();
}

// ————— Compact: 390 × 844, touch —————
const phone = await open(390, 844, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
{
  const { page, tid, text, shot, go, names, item, pick, visible, menuItem } = phone;
  await step(phone, "Compact — the categories are a scrolling row of pill tabs in order, and a category opens from it", async () => {
    await go("/library");
    await page.waitForURL(/\/library\/templates$/);
    const tabs = await page.getByRole("tablist", { name: "Category" }).getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.innerText.replace(/\s*\d+\s*$/, "").trim()));
    expect(JSON.stringify(tabs) === JSON.stringify(CATEGORIES.map((entry) => entry[1])), `pill tabs ${tabs}`);
    await tid("templates-tab").waitFor();
    await shot("20-templates-390-light");
    await visible(page.getByRole("tab", { name: /^Stickers/ })).tap(); await page.waitForURL(/\/library\/stickers$/);
    await tid("library-first-use").waitFor(); await text("No imported stickers yet").waitFor();
    await shot("21-stickers-empty-390-light");
  });
  await step(phone, "Compact import, list view, rename and delete — the same actions under a finger", async () => {
    await pick(tid("library-first-use").getByRole("button", { name: "Import", exact: true }), [file("badge.png"), file("ribbon.png"), file("swap.cube")]);
    await item("badge").waitFor({ timeout: 30_000 });
    expect(JSON.stringify(await names()) === JSON.stringify(["badge", "ribbon"]), `stickers ${await names()}`);
    const box = await tid("library-screen").boundingBox();
    for (const name of ["badge", "ribbon"]) { const tile = await item(name).boundingBox(); expect(tile.x >= 0 && tile.x + tile.width <= box.width + 1, `${name} fits the screen`); }
    await shot("22-stickers-390-light");
    await visible(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "List" })).tap();
    await tid("library-list").waitFor();
    await shot("23-stickers-list-390-light");
    await item("ribbon").getByTestId("library-item-menu").tap(); await menuItem("Rename").tap();
    await tid("library-name-input").fill("Blue ribbon");
    await visible(page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true })).tap();
    await item("Blue ribbon").waitFor();
    await item("Blue ribbon").getByTestId("library-item-menu").tap(); await menuItem("Delete").tap();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-item"]').length === 1);
    await visible(page.getByRole("tab", { name: /^LUTs/ })).tap(); await page.waitForURL(/\/library\/luts$/);
    await item("Swap Red Blue").waitFor();
    expect((await names()).length === 13, `the LUT picked on the Stickers page went to LUTs: ${(await names()).length}`);
    await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(500);
    await shot("24-luts-390-dark");
  });
  await phone.context.close();
}

await browser.close();
if (errors.length) console.log("ERRORS:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
if (failed || errors.length) { console.log(`FAIL library: ${failed} failed steps, ${errors.length} page errors`); process.exit(1); }
console.log("PASS library: 0 failed steps, 0 page errors");
