// End-to-end in a real browser against the Expo web dev server, with no host: the Projects screens and the editor route.
// Real storage (IndexedDB and OPFS of a fresh browser profile); nothing is seeded or mocked.
// Usage: node apps/app/e2e/projects.mjs <screenshot-dir>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/projects";
mkdirSync(shots, { recursive: true });
const base = "http://localhost:8091";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const card = (name) => visible(page.getByTestId(`project-${name}`));
const step = async (name, run) => { try { await run(); console.log("ok  ", name); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot("failure"); console.log("PAGE TEXT:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 500)); await browser.close(); console.log(`ERRORS:\n${errors.join("\n")}`); process.exit(1); } };
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const backToProjects = async () => { await button("Editor menu").click(); await visible(page.getByRole("menuitem", { name: "Back to projects" })).click(); await text("Every project on this device.").waitFor(); };
const menuItem = (name) => visible(page.getByRole("menuitem", { name, exact: true }));
const cardMenu = async (name, item) => { await card(name).hover(); await button(`Actions for ${name}`).click(); await menuItem(item).click(); };
// The canvas size and frame rate of the open project, as the inspector's Details show them.
const canvasIs = (size, rate) => page.waitForFunction(([wanted, fps]) => { const details = document.querySelector('[data-testid="inspector-details"]')?.innerText ?? ""; return details.includes(wanted) && details.includes(fps); }, [size, rate], { timeout: 30_000 });
const names = async () => page.locator('[data-testid^="project-"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid").slice(8)));

await step("empty state and skeleton-free ready state", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await text("No projects yet", { exact: true }).nth(0).waitFor({ timeout: 90_000 });
  await button("Create your first project").waitFor();
  await shot("01-empty");
});
await step("create project opens the editor with factory defaults", async () => {
  await button("Create your first project").click();
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await visible(page.getByTestId("project-name")).waitFor();
  expect((await visible(page.getByTestId("project-name")).innerText()) === "New project", "name is New project");
  await canvasIs("1920 × 1080", "30 fps");
  expect((await page.title()) === "New project — JAgentChill", `document title ${await page.title()}`);
  await shot("02-editor");
});
await step("inline rename trims and saves", async () => {
  await button("Rename: New project").click();
  await page.getByLabel("Project name").fill("  Trip  ");
  await page.keyboard.press("Enter");
  await button("Rename: Trip").waitFor();
  await text("Saved", { exact: true }).waitFor();
});
await step("project settings: canvas presets, custom size, resolution, frame rate", async () => {
  await button("Editor menu").click(); await menuItem("Project settings…").click();
  await visible(page.getByTestId("ratio-21:9")).click();
  await canvasIs("2520 × 1080", "30 fps");
  await visible(page.getByTestId("ratio-9:16")).click();
  await canvasIs("1080 × 1920", "30 fps");
  await page.getByLabel("Width", { exact: true }).fill("9000"); await page.getByLabel("Height", { exact: true }).click();
  await text("Width must be between 16 and 7680").waitFor();
  await canvasIs("1080 × 1920", "30 fps");
  await page.getByLabel("Width", { exact: true }).fill("1000"); await page.getByLabel("Height", { exact: true }).fill("1081"); await page.getByLabel("Width", { exact: true }).click();
  await canvasIs("1000 × 1082", "30 fps");
  await visible(page.getByTestId("ratio-1:1")).click();
  await canvasIs("1080 × 1080", "30 fps");
  await visible(page.getByTestId("ratio-custom")).click();
  await canvasIs("1000 × 1082", "30 fps");
  await visible(page.getByTestId("ratio-16:9")).click();
  await visible(page.getByRole("combobox", { name: "Frame rate" })).click();
  await visible(page.getByRole("option", { name: "29.97 fps" })).click();
  await canvasIs("1920 × 1080", "29.97 fps");
  await shot("03-settings-info");
});
await step("project settings: background swatches, gradient, transparent; undo restores", async () => {
  await visible(page.getByRole("tab", { name: "Background" })).click();
  await visible(page.getByTestId("bg-sw-blue")).waitFor();
  expect((await page.locator('[data-testid^="bg-sw-"]').filter({ visible: true }).count()) === 24, "24 solid swatches");
  expect((await page.locator('[data-testid^="bg-gr-"]').filter({ visible: true }).count()) === 16, "16 gradients");
  expect((await page.locator('[data-testid^="bg-pt-"]').filter({ visible: true }).count()) === 16, "16 patterns");
  await visible(page.getByTestId("bg-sw-blue")).click();
  // The canvas is drawn by the render engine; which background the project holds is read from the settings themselves.
  const chosen = (id) => page.waitForFunction((testId) => [...document.querySelectorAll(`[data-testid="${testId}"]`)].some((node) => node.getAttribute("aria-checked") === "true" || getComputedStyle(node).borderTopWidth === "2px"), id, { timeout: 5000 }).then(() => true, () => false);
  expect(await chosen("bg-sw-blue"), "the blue swatch is the project background");
  await visible(page.getByTestId("bg-gr-dusk")).click();
  expect(await chosen("bg-gr-dusk"), "gradient background");
  await shot("04-settings-background");
  await visible(page.getByTestId("bg-sw-blue")).click();
  await button("Close").click();
  await button(/^Undo/).click(); await button(/^Undo/).click();
  await button("Editor menu").click(); await menuItem("Project settings…").click(); await visible(page.getByRole("tab", { name: "Background" })).click();
  expect(await chosen("bg-sw-blue"), "undo twice returns to blue");
  await button("Close").click();
  await text("Saved", { exact: true }).waitFor();
});
await step("exit flushes the save and the card shows a thumbnail", async () => {
  await backToProjects();
  await card("Trip").waitFor();
  await card("Trip").locator("img").first().waitFor({ timeout: 10_000 });
  await text("Created ", { exact: false }).waitFor();
});
await step("reopened project kept its edits", async () => {
  await card("Trip").getByRole("button", { name: "Trip", exact: true }).click();
  await canvasIs("1920 × 1080", "29.97 fps");
  await backToProjects();
});
await step("rename dialog: empty disables, 120-character bound, Enter confirms", async () => {
  await cardMenu("Trip", "Rename");
  const field = page.getByLabel("New name");
  await field.fill("   ");
  expect(await button("Rename").isDisabled(), "Rename disabled for an empty name");
  await field.fill("x".repeat(150));
  expect((await field.inputValue()).length === 120, "field holds 120 characters");
  await field.fill("Holiday Reel"); await page.keyboard.press("Enter");
  await card("Holiday Reel").waitFor();
});
await step("duplicate names by the rule", async () => {
  await cardMenu("Holiday Reel", "Duplicate"); await card("(1) Holiday Reel").waitFor();
  await cardMenu("Holiday Reel", "Duplicate"); await card("(2) Holiday Reel").waitFor();
  await cardMenu("(2) Holiday Reel", "Duplicate"); await card("(3) Holiday Reel").waitFor();
});
await step("new project from the toolbar, then rename to build a list", async () => {
  for (const name of ["Promo", "Clip 10", "Clip 2", "beta", "Alpha"]) {
    await button("New project").click();
    await page.waitForURL(/\/editor\//); await button("Rename: New project").click();
    await page.getByLabel("Project name").fill(name); await page.keyboard.press("Enter");
    await text("Saved", { exact: true }).waitFor(); await backToProjects();
  }
  expect((await names()).length === 9, `9 projects, got ${(await names()).length}`);
});
await step("search is live, case- and diacritic-insensitive; clear restores", async () => {
  await page.getByRole("searchbox", { name: "Search projects" }).fill("réel");
  for (let tries = 0; (await names()).length !== 4 && tries < 50; tries++) await page.waitForTimeout(100);
  expect((await names()).length === 4 && (await names()).every((name) => name.includes("Holiday Reel")), `search results: ${await names()}`);
  await page.getByRole("searchbox", { name: "Search projects" }).fill("zzz");
  await text("No results found").waitFor(); await shot("05-no-results");
  await button("Clear search").click();
  await card("Promo").waitFor();
  expect((await page.getByRole("searchbox", { name: "Search projects" }).inputValue()) === "", "search field is empty");
});
await step("sort by name with numeric collation; order toggle", async () => {
  await visible(page.getByRole("combobox", { name: "Sort by" })).click();
  await visible(page.getByRole("option", { name: "Name" })).click();
  const direction = async (name) => { await visible(page.getByRole("combobox", { name: "Sort by" })).click(); await visible(page.getByRole("option", { name, exact: true })).click(); };
  await direction("Ascending");
  const sorted = await names();
  expect(JSON.stringify(sorted.slice(0, 2)) === JSON.stringify(["(1) Holiday Reel", "(2) Holiday Reel"]) && sorted.indexOf("Alpha") < sorted.indexOf("beta") && sorted.indexOf("beta") < sorted.indexOf("Clip 2") && sorted.indexOf("Clip 2") < sorted.indexOf("Clip 10"), `name order: ${sorted.join(", ")}`);
  await direction("Descending");
  expect((await names())[0] === "Promo", "descending starts with Promo");
  await direction("Ascending");
});
await step("list view and persistence across a reload", async () => {
  await visible(page.getByRole("radio", { name: "List" })).click();
  await text("Modified", { exact: true }).waitFor();
  await shot("06-list");
  await page.reload({ waitUntil: "networkidle" });
  await text("Modified", { exact: true }).waitFor({ timeout: 60_000 });
  expect((await names()).indexOf("Clip 2") < (await names()).indexOf("Clip 10"), "sort by name ascending restored");
  await visible(page.getByRole("radio", { name: "Grid" })).click();
});
await step("multi-select: range, indeterminate, select all, cancel", async () => {
  const order = await names();
  await card(order[1]).hover(); await visible(page.getByRole("checkbox", { name: `Select ${order[1]}`, exact: true })).click();
  await card(order[4]).hover(); await visible(page.getByRole("checkbox", { name: `Select ${order[4]}`, exact: true })).click({ modifiers: ["Shift"] });
  await text("4 selected").waitFor();
  await shot("07-bulk-bar");
  for (const action of ["Duplicate", "Move to folder", "Export packages", "Delete", "Clear"]) await button(action).waitFor();
  // The bulk bar of the design has no checkbox of its own: "Select all" is the header checkbox of the list view.
  await button("Clear").click();
  await visible(page.getByRole("radio", { name: "List" })).click();
  await card(order[1]).hover(); await visible(page.getByRole("checkbox", { name: `Select ${order[1]}`, exact: true })).click();
  const all = visible(page.getByRole("checkbox", { name: "Select all" }));
  expect((await all.getAttribute("aria-checked")) === "mixed", "select all is indeterminate");
  await all.click(); await text("9 selected").waitFor();
  await button("Clear").click();
  await visible(page.getByRole("radio", { name: "Grid" })).click();
  await page.getByRole("searchbox", { name: "Search projects" }).waitFor();
});
await step("bulk duplicate and bulk delete with the confirmation", async () => {
  for (const name of ["Alpha", "beta"]) { await card(name).hover(); await visible(page.getByRole("checkbox", { name: `Select ${name}`, exact: true })).click(); }
  await button("Duplicate").click();
  await card("(1) Alpha").waitFor(); await card("(1) beta").waitFor();
  await page.getByRole("searchbox", { name: "Search projects" }).waitFor();
  for (const name of ["(1) Alpha", "(1) beta"]) { await card(name).hover(); await visible(page.getByRole("checkbox", { name: `Select ${name}`, exact: true })).click(); }
  await button("Delete").click();
  await text("Move 2 projects to trash?").waitFor(); await shot("08-trash-confirm");
  await button("Move to trash").click();
  await card("(1) Alpha").waitFor({ state: "detached" });
});
await step("folders: create, duplicate name refused, move by dialog and by drag, open, breadcrumb", async () => {
  const newFolder = async () => { await button("Projects list options").click(); await menuItem("New folder").click(); };
  await newFolder(); await page.getByLabel("Folder name").fill("Clients"); await button("Create").click();
  await visible(page.getByTestId("folder-Clients")).waitFor();
  await newFolder(); await page.getByLabel("Folder name").fill("clients"); await button("Create").click();
  await text("A folder with this name already exists").waitFor(); await page.keyboard.press("Escape");
  await visible(page.getByRole("button", { name: "Discard" })).click().catch(() => undefined);
  await cardMenu("Promo", "Move to folder"); await menuItem("Choose folder…").click();
  await visible(page.getByRole("dialog").getByText("Clients", { exact: true })).click(); await button("Move").click();
  await card("Promo").waitFor({ state: "detached" });
  await card("Clip 2").dragTo(visible(page.getByTestId("folder-Clients")));
  await card("Clip 2").waitFor({ state: "detached" });
  await visible(page.getByRole("button", { name: /Folder Clients, 2 projects/ })).click();
  await page.waitForURL(/\/projects\/folder\//);
  await card("Promo").waitFor(); await card("Clip 2").waitFor();
  await shot("09-folder");
  await card("Clip 2").dragTo(visible(page.getByRole("link", { name: "All projects" })));
  await card("Clip 2").waitFor({ state: "detached" });
  await visible(page.getByRole("link", { name: "All projects" })).click();
  await card("Clip 2").waitFor();
});
await step("info dialog", async () => {
  await cardMenu("Clip 2", "Info");
  await text("Project info").waitFor(); await text("1920 × 1080").waitFor(); await text("App storage").waitFor(); await text("0 media assets").waitFor(); await text("On this device only").waitFor();
  await shot("10-info"); await button("Close").click();
});
await step("context menu acts on the clicked project; keyboard open, rename and delete", async () => {
  await card("Clip 10").click({ button: "right" });
  await menuItem("Rename").click();
  expect((await page.getByLabel("New name").inputValue()) === "Clip 10", "rename dialog is for the clicked project");
  await button("Cancel").click();
  await card("Clip 10").getByRole("button", { name: "Clip 10", exact: true }).focus();
  await page.keyboard.press("F2"); await text("Rename project").waitFor(); await button("Cancel").click();
  await card("Clip 10").getByRole("button", { name: "Clip 10", exact: true }).focus();
  await page.keyboard.press("Delete");
  await text("Move 'Clip 10' to trash?").waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === "Cancel", null, { timeout: 3000 }).catch(() => undefined);
  expect(await page.evaluate(() => document.activeElement?.textContent === "Cancel"), `focus is on Cancel, got ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`);
  await button("Cancel").click();
  await card("Clip 10").getByRole("button", { name: "Clip 10", exact: true }).focus();
  await page.keyboard.press("Enter"); await page.waitForURL(/\/editor\//); await backToProjects();
});
await step("delete folder moves its projects to trash", async () => {
  await visible(page.getByTestId("folder-Clients")).hover(); await button("Actions for Clients").click(); await menuItem("Delete folder").click();
  await text("Delete folder 'Clients' and move 1 projects to trash?").waitFor();
  await button("Delete folder").click();
  await visible(page.getByTestId("folder-Clients")).waitFor({ state: "detached" });
});
await step("trash: list, restore to root, enforced permanent delete, empty trash", async () => {
  await button("Projects list options").click(); await menuItem("Trash").click(); await page.waitForURL(/\/projects\/trash$/);
  await visible(page.getByTestId("trash-Promo")).waitFor(); await text("30 days left").first().waitFor();
  await shot("11-trash");
  await visible(page.getByTestId("trash-Promo")).getByRole("button", { name: "Restore" }).click();
  await visible(page.getByTestId("trash-Promo")).waitFor({ state: "detached" });
  await visible(page.getByTestId("trash-(1) Alpha")).getByRole("button", { name: "Delete permanently" }).click();
  await text("Delete '(1) Alpha' permanently?").waitFor();
  const destroy = visible(page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }));
  await page.getByLabel("Type DELETE to confirm").fill("delete");
  expect(await destroy.isDisabled(), "disabled for lowercase delete");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  expect(await destroy.isEnabled(), "enabled for exact DELETE");
  await shot("12-delete-confirm");
  await destroy.click();
  await visible(page.getByTestId("trash-(1) Alpha")).waitFor({ state: "detached" });
  await button("Empty trash").click(); await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await visible(page.getByRole("dialog").getByRole("button", { name: "Delete permanently" })).click();
  await text("Trash is empty").waitFor();
  expect(await button("Empty trash").isDisabled(), "Empty trash is disabled");
  await visible(page.getByRole("link", { name: "All projects" })).click();
  await card("Promo").waitFor();
});
await step("unknown project id shows Project not found and creates nothing silently", async () => {
  const before = (await names()).length;
  await page.goto(`${base}/editor/00000000-0000-4000-8000-00000000dead`, { waitUntil: "networkidle" });
  await text("This project does not exist on this device").waitFor({ timeout: 60_000 });
  expect((await page.title()) === "Project not found — JAgentChill", `title ${await page.title()}`);
  await shot("13-not-found");
  await button("Back to projects").click(); await card("Promo").waitFor();
  expect((await names()).length === before, "number of projects unchanged");
  await page.goto(`${base}/editor/00000000-0000-4000-8000-00000000dead`, { waitUntil: "networkidle" });
  await button("Create new project").click();
  await button("Rename: Untitled Project").waitFor();
  await backToProjects(); await card("Untitled Project").waitFor();
});
await step("screenshots: grid light and dark, 1440 and 390", async () => {
  await shot("20-grid-1440-light");
  for (const [name, options] of [["21-grid-1440-dark", { viewport: { width: 1440, height: 900 }, colorScheme: "dark" }], ["22-grid-390-light", { viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true }], ["23-grid-390-dark", { viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true }]]) {
    await page.setViewportSize(options.viewport); await page.emulateMedia({ colorScheme: options.colorScheme });
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); await card("Promo").waitFor({ timeout: 60_000 }); await page.waitForTimeout(600);
    await shot(name);
  }
  // Phone: two columns, the floating "New project" button, search and sort behind the header toggle.
  const boxes = await page.locator('[data-testid^="project-"]').filter({ visible: true }).evaluateAll((nodes) => nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().left)));
  expect(boxes[0] !== boxes[1] && boxes[0] === boxes[2], `two columns on a phone: ${boxes}`);
  await button("New project").waitFor();
  await button("Search and sort").click(); await page.getByRole("searchbox", { name: "Search projects" }).waitFor();
  await shot("24-phone-header-open");
});
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "E2E OK — no page errors");
process.exit(errors.length ? 1 : 0);
