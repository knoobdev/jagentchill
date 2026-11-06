// End-to-end in a real browser against the Expo web dev server, with no host paired: every control of Home, the sidebar,
// the top bar and the drawer. Real storage of a fresh browser profile; nothing is seeded or mocked.
// Usage: node apps/app/e2e/shell.mjs <screenshot-dir>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/shell";
mkdirSync(shots, { recursive: true });
const base = process.env.E2E_BASE ?? "http://localhost:8081";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const menuItem = (name) => visible(page.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').and(page.getByLabel(name, { exact: true })));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const path = () => new URL(page.url()).pathname;
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => { try { await run(); console.log("ok  ", name); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 14).join("\n")); errors.push(`step failed: ${name}`); await shot("failure"); console.log("PAGE TEXT:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 600)); await browser.close(); console.log(`ERRORS:\n${errors.join("\n")}`); process.exit(1); } };
const home = async () => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  const localOnly = button("Use this device only");
  if (await localOnly.isVisible()) await localOnly.click();
  await text("What do you want to make?").waitFor({ timeout: 90_000 });
};
const sidebar = () => visible(page.getByTestId("sidebar"));
const nav = (id) => visible(page.getByTestId(`nav-${id}`));

await step("home without a host: heading, banner, tiles, checklist, no recent strip", async () => {
  await home();
  await text("Connect a host to use the agent").waitFor(); await text("Get started").waitFor(); await text("0 of 6").waitFor();
  expect((await page.getByText("Recent projects").filter({ visible: true }).count()) === 0, "no Recent projects strip with no project");
  expect(await visible(page.getByTestId("composer-send")).isDisabled(), "send is disabled without a host");
  expect((await page.title()) === "Home — JAgentChill", `title ${await page.title()}`);
  await shot("01-home-1440-light");
});
await step("sidebar regions: 240 px sidebar, 48 px top bar, navigation order", async () => {
  const box = await sidebar().boundingBox(); const bar = await visible(page.getByTestId("top-bar")).boundingBox();
  expect(Math.round(box.width) === 240 && Math.round(bar.height) === 48, `sidebar ${box.width}, top bar ${bar.height}`);
  const rows = await page.locator('[data-testid^="nav-"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid").slice(4)));
  expect(JSON.stringify(rows) === JSON.stringify(["home", "projects", "sessions", "workflows", "film", "automations", "library", "devices"]), `rows ${rows}`);
  expect((await nav("home").getAttribute("aria-current")) === "page", "New (the Home screen) is the current page");
  // The header and the footer of the design: search and collapse; connection chip, Settings, Notifications, Help.
  for (const name of ["Search", "Collapse sidebar", "Settings", "Notifications", "Help"]) await sidebar().getByRole("button", { name, exact: true }).waitFor();
});
await step("composer keeps the draft; the pill offers Agent, Plan, Ask, Video, Film and remembers the choice; attach, run options, dictate", async () => {
  await page.getByLabel("Message").filter({ visible: true }).first().fill("Cut a 20 s recap");
  await button("Agent").click(); await menuItem("Plan").waitFor();
  const modes = await page.getByRole("menuitemradio").filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(JSON.stringify(modes) === JSON.stringify(["Agent", "Plan", "Ask", "Video", "Film"]), `modes ${modes}`);
  await shot("02-mode-menu");
  await menuItem("Plan").click(); await button("Plan").waitFor();
  await page.reload({ waitUntil: "networkidle" }); await text("What do you want to make?").waitFor({ timeout: 60_000 });
  await button("Plan").waitFor();
  expect((await page.getByLabel("Message").filter({ visible: true }).first().inputValue()) === "Cut a 20 s recap", "the draft is kept");
});
await step("composer banner Connect opens the pairing flow", async () => {
  await button("Connect").click(); await text("Connect to JAgentChill").waitFor();
  await button("Paste pairing link").click(); await text("Pairing link").waitFor();
  await visible(page.getByTestId("pairing-link-input")).waitFor(); await shot("03-pair-start");
  await button("Cancel").click(); await home();
});
await step("context row: project picker with search and New project; host selector opens the switcher", async () => {
  await button("Run options").click(); await text("Ask before each change").waitFor(); await text("Accept valid changes automatically").waitFor(); await page.keyboard.press("Escape");
  await button("Attach").waitFor(); await button("Dictate").waitFor(); await button("Send options").waitFor();
  await button("Model: Set up models").click(); await text("Requires a host").first().waitFor(); await button("Not now").click();
  await button("Project: No project").click();
  await page.getByRole("searchbox", { name: "Search projects" }).waitFor(); await menuItem("No project").waitFor();
  await page.keyboard.press("Escape");
  await button("Host: This device").click(); await menuItem("This device only").waitFor(); await menuItem("Add a host…").waitFor(); await shot("04-host-switcher");
  await page.keyboard.press("Escape");
});
await step("quick-start tiles: New blank project opens the editor; Use a template opens the Library", async () => {
  await button("New blank project").click(); await page.waitForURL(/\/editor\//); await button("Rename: New project").waitFor();
  await button("Editor menu").click(); await menuItem("Back to projects").click(); await page.waitForURL(/\/projects$/);
  await home();
  await text("1 of 6").waitFor(); await text("Recent projects").waitFor();
  await button("View all").or(visible(page.getByRole("link", { name: "View all" }))).first().click(); await page.waitForURL(/\/projects$/);
  await home();
  await button("Use a template").click(); await page.waitForURL(/\/library\/templates$/); await text("My templates").waitFor();
});
await step("library: seven categories, a category opens, an unknown one is not found", async () => {
  // The categories are tabs inside the Library screen (owner, 2026-10-07); the sidebar does not list them.
  const rows = await page.getByRole("tablist", { name: "Category" }).getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.innerText.replace(/\s*\d+\s*$/, "").trim()));
  expect(JSON.stringify(rows) === JSON.stringify(["Templates", "Preset packs", "Fonts", "LUTs", "Saved sounds", "Stickers", "Brand kits"]), `categories ${rows}`);
  expect((await page.locator('[data-testid^="library-row-"]').filter({ visible: true }).count()) === 0, "no category rows in the sidebar");
  await visible(page.getByRole("tab", { name: /^LUTs/ })).click(); await page.waitForURL(/\/library\/luts$/); await visible(page.getByTestId("library-import-hint")).waitFor();
  await shot("05-library");
  await visible(page.getByRole("tab", { name: /^Fonts/ })).click(); await page.waitForURL(/\/library\/fonts$/);
  await page.goto(`${base}/library`, { waitUntil: "networkidle" }); await page.waitForURL(/\/library\/fonts$/);
  await page.goto(`${base}/library/unknown`, { waitUntil: "networkidle" }); await text("Page not found").waitFor({ timeout: 60_000 });
  await button("Go home").click(); await text("What do you want to make?").waitFor();
});
await step("checklist: starter tips fill the composer; dismiss and restore from Help", async () => {
  await button("Show starter tips").click(); await visible(page.getByTestId("shell.starter.5")).waitFor();
  expect((await page.locator('[data-testid^="shell.starter."]').filter({ visible: true }).count()) === 5, "exactly five starter prompts");
  await visible(page.getByTestId("shell.starter.4")).click();
  expect((await page.getByLabel("Message").filter({ visible: true }).first().inputValue()) === "Turn this short story into a three-scene film with one narrator", "composer holds the fourth prompt");
  await button("Dismiss Get started").click(); await page.waitForTimeout(300);
  expect((await page.getByText("Get started").filter({ visible: true }).count()) === 0, "the card is gone");
  await button("Help").click(); await menuItem("Starter tips").click();
  await text("Get started").waitFor(); await text("1 of 6").waitFor();
  await button("Connect a host").click(); await page.waitForURL(/\/pair\/start$/); await button("Cancel").click();
});
await step("navigation: Projects, Library, host destinations open the requires-host sheet", async () => {
  await nav("projects").click(); await page.waitForURL(/\/projects$/);
  expect((await nav("projects").getAttribute("aria-current")) === "page", "Projects row is selected");
  await nav("library").click(); await page.waitForURL(/\/library\//);
  for (const id of ["sessions", "workflows", "film"]) {
    await nav(id).click(); await text("Requires a host").first().waitFor(); await shot(`06-requires-host-${id}`);
    await button("Not now").click(); await page.waitForTimeout(400);
  }
  await nav("film").focus(); await page.keyboard.press("Enter"); await text("Requires a host").first().waitFor();
  await button("Connect a host").click(); await page.waitForURL(/\/pair\/start$/); await button("Cancel").click();
  await page.goto(`${base}/h/local/workflows`, { waitUntil: "networkidle" }); await text("Requires a host").first().waitFor({ timeout: 60_000 });
  await page.goto(`${base}/h/abc/sessions/123`, { waitUntil: "networkidle" }); await text("This host is not paired on this device").waitFor({ timeout: 60_000 });
  await button("Pair").waitFor(); await button("Go home").click(); await text("What do you want to make?").waitFor();
});
await step("sidebar: Devices is a primary row; search opens the command palette; Settings, Notifications", async () => {
  await nav("devices").click(); await page.waitForURL(/\/devices$/); await text("Hosts paired with this device").waitFor();
  expect((await nav("devices").getAttribute("aria-current")) === "page", "Devices is the current page");
  await nav("automations").click(); await text("Requires a host").first().waitFor(); await button("Not now").click();
  await button("Search").click(); await page.getByRole("searchbox", { name: "Search projects and commands" }).fill("stor");
  await menuItem("Manage storage").click(); await page.waitForURL(/\/settings\/storage$/); await text("Clear all caches").first().waitFor(); await shot("07-settings-storage");
  // Settings replaces the sidebar with its own navigation column.
  await visible(page.getByTestId("settings-nav")).waitFor(); await visible(page.getByTestId("settings-general")).click(); await page.waitForURL(/\/settings\/general$/); await text("Language").first().waitFor();
  await visible(page.getByRole("radio", { name: "Dark" })).click();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="settings-nav"]')).backgroundColor !== "rgb(247, 247, 247)"), "the dark theme applies");
  await visible(page.getByRole("radio", { name: "Light" })).click();
  await visible(page.getByTestId("settings-back")).click(); await visible(page.getByTestId("sidebar")).waitFor();
  await sidebar().getByRole("button", { name: "Notifications", exact: true }).click(); await visible(page.getByTestId("inbox")).waitFor(); await shot("07-inbox"); await page.keyboard.press("Escape");
});
await step("footer: connection chip opens Devices; keyboard moves through the navigation", async () => {
  await home();
  await visible(page.getByTestId("connection-chip")).click(); await page.waitForURL(/\/devices$/);
  await nav("home").focus(); await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "nav-projects", "ArrowDown moves to Projects");
  await page.keyboard.press("Enter"); await page.waitForURL(/\/projects$/);
});
await step("secondary list: search, create, options, pin and rename from the row menu", async () => {
  await sidebar().getByRole("button", { name: "Search Projects" }).click();
  await sidebar().getByRole("searchbox").fill("zzz"); await sidebar().getByText("No results").waitFor();
  await sidebar().getByRole("searchbox").fill("");
  await sidebar().getByRole("button", { name: /^New project, Edited/ }).hover();
  await sidebar().getByRole("button", { name: "More actions" }).first().click(); await menuItem("Pin").click();
  await sidebar().getByText("Pinned").waitFor();
  await sidebar().getByRole("button", { name: /^New project, Edited/ }).hover();
  await sidebar().getByRole("button", { name: "More actions" }).first().click(); await menuItem("Rename").click();
  await page.getByLabel("New name").fill("Sidebar renamed"); await page.keyboard.press("Enter");
  await sidebar().getByRole("button", { name: /^Sidebar renamed, Edited/ }).waitFor();
  await sidebar().getByRole("button", { name: "Projects list options" }).click(); await menuItem("Trash").click(); await page.waitForURL(/\/projects\/trash$/);
  await sidebar().getByRole("button", { name: "New project", exact: true }).click(); await page.waitForURL(/\/editor\//);
  await button("Editor menu").click(); await menuItem("Back to projects").click(); await page.waitForURL(/\/projects$/);
  await sidebar().getByRole("button", { name: /^Sidebar renamed, Edited/ }).click(); await page.waitForURL(/\/editor\//); await button("Rename: Sidebar renamed").waitFor();
  await shot("08-editor-full-window");
  const editorBar = await visible(page.getByTestId("editor-bar")).boundingBox();
  expect(editorBar.x === 0 && editorBar.width === 1440 && (await page.getByTestId("sidebar").count()) === 0, `the editor uses the full window: ${JSON.stringify(editorBar)}`);
  await button("Editor menu").click(); await menuItem("Back to projects").click(); await page.waitForURL(/\/projects$/);
});
await step("sidebar collapse, top-bar toggle, shortcut, resize limits and persistence", async () => {
  await button("Collapse sidebar").click(); await button("Show sidebar").waitFor();
  await page.reload({ waitUntil: "networkidle" }); await button("Show sidebar").waitFor({ timeout: 60_000 });
  await button("Show sidebar").click(); await button("Collapse sidebar").waitFor();
  await page.keyboard.press("Control+\\"); await button("Show sidebar").waitFor();
  await page.keyboard.press("Control+\\"); await button("Collapse sidebar").waitFor(); await page.waitForTimeout(400);
  const handle = await visible(page.getByRole("separator", { name: "Resize sidebar" })).boundingBox();
  await page.mouse.move(handle.x + 2, 400); await page.mouse.down(); await page.mouse.move(150, 400, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  expect(Math.round((await sidebar().boundingBox()).width) === 200, `width stops at 200, got ${(await sidebar().boundingBox()).width}`);
  const narrow = await visible(page.getByRole("separator", { name: "Resize sidebar" })).boundingBox();
  await page.mouse.move(narrow.x + 2, 400); await page.mouse.down(); await page.mouse.move(700, 400, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  expect(Math.round((await sidebar().boundingBox()).width) === 360, `width stops at 360, got ${(await sidebar().boundingBox()).width}`);
  await visible(page.getByRole("separator", { name: "Resize sidebar" })).dblclick(); await page.waitForTimeout(300);
  expect(Math.round((await sidebar().boundingBox()).width) === 240, "double-click resets to 240");
});
await step("keyboard: Alt+N creates a project; unknown route shows the not-found screen", async () => {
  await page.keyboard.press("Alt+n"); await page.waitForURL(/\/editor\//); await button("Rename: New project").waitFor();
  await page.goto(`${base}/does-not-exist`, { waitUntil: "networkidle" }); await text("Page not found").waitFor({ timeout: 60_000 }); await sidebar().waitFor();
  await shot("09-not-found");
});
await step("screenshots: home dark at 1440, home light and dark at 390", async () => {
  await page.emulateMedia({ colorScheme: "dark" }); await home(); await page.waitForTimeout(500); await shot("10-home-1440-dark");
  await page.emulateMedia({ colorScheme: "light" });
});
await page.close();
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true, isMobile: true });
const mobile = await phone.newPage();
mobile.on("pageerror", (err) => errors.push(String(err)));
mobile.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
const m = { visible: (locator) => locator.filter({ visible: true }).first() };
try {
  await mobile.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await m.visible(mobile.getByText("No projects yet")).waitFor({ timeout: 90_000 });
  const bar = await m.visible(mobile.getByTestId("top-bar")).boundingBox();
  if (Math.round(bar.height) !== 56) throw new Error(`compact top bar is 56 px, got ${bar.height}`);
  await mobile.screenshot({ path: `${shots}/11-home-390-light.png` });
  const quickRow = m.visible(mobile.getByTestId("home-quick-start-row")), quickFrame = await quickRow.boundingBox();
  const firstThreeTiles = await Promise.all(["new", "import", "prompt"].map((id) => mobile.getByTestId(`home-quick-start-${id}`).boundingBox()));
  if (!quickFrame || firstThreeTiles.some((box) => !box || box.x < quickFrame.x || box.x + box.width > quickFrame.x + quickFrame.width)) throw new Error(`the first three quick-start tiles are fully visible: ${JSON.stringify({ quickFrame, firstThreeTiles })}`);
  const scroll = m.visible(mobile.getByTestId("home-mobile-scroll")), dock = m.visible(mobile.getByTestId("home-composer-dock"));
  const [scrollBox, dockBox] = await Promise.all([scroll.boundingBox(), dock.boundingBox()]);
  if (!scrollBox || !dockBox || Math.abs(scrollBox.y + scrollBox.height - dockBox.y) > 1) throw new Error(`the Home scroll viewport ends at the composer dock: ${JSON.stringify({ scrollBox, dockBox })}`);
  const checklistRows = await mobile.locator('[data-testid^="home-checklist-"]').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  if (checklistRows.length !== 6 || checklistRows.some((height) => height < 44)) throw new Error(`six checklist rows have 44 px touch targets: ${JSON.stringify(checklistRows)}`);
  await scroll.evaluate((node) => { (node).scrollTop = (node).scrollHeight; }); await mobile.waitForTimeout(200);
  const promptRow = await m.visible(mobile.getByTestId("home-checklist-prompt")).boundingBox();
  if (!promptRow || promptRow.y < scrollBox.y || promptRow.y + promptRow.height > scrollBox.y + scrollBox.height) throw new Error(`the final Get started row is reachable above the dock: ${JSON.stringify({ promptRow, scrollBox })}`);
  await mobile.screenshot({ path: `${shots}/17-home-checklist-390.png` });
  await m.visible(mobile.getByTestId("mobile-global-search")).tap();
  const globalSearch = mobile.getByRole("searchbox", { name: "Search projects and commands" }); await globalSearch.waitFor(); await globalSearch.fill("New project");
  await m.visible(mobile.getByRole("menuitem", { name: "New project", exact: true })).waitFor(); await mobile.keyboard.press("Escape");
  await m.visible(mobile.getByRole("button", { name: "Host: This device" })).tap(); await mobile.getByRole("menuitem", { name: "Add a host…", exact: true }).waitFor(); await mobile.keyboard.press("Escape");
  await m.visible(mobile.getByRole("button", { name: "New project", exact: true })).tap(); await mobile.waitForURL(/\/editor\//);
  // The compact editor leaves through the Close button of its top bar (`mobile-editor.Top bar`), not through the editor menu.
  await m.visible(mobile.getByTestId("compact-close")).tap(); await mobile.waitForURL(/\/projects$/);
  await mobile.screenshot({ path: `${shots}/12-projects-390-light.png` });
  await m.visible(mobile.getByRole("button", { name: "Open navigation" })).tap();
  await m.visible(mobile.getByRole("radio", { name: "Menu" })).waitFor(); await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: `${shots}/13-drawer-list-390.png` });
  await m.visible(mobile.getByRole("radio", { name: "Menu" })).tap(); await m.visible(mobile.getByTestId("nav-devices")).waitFor(); await mobile.waitForTimeout(300);
  const rows = await mobile.locator('[data-testid^="nav-"]').filter({ visible: true }).count();
  if (rows !== 8) throw new Error(`the Menu segment lists the eight destinations of the design, got ${rows}`);
  await mobile.screenshot({ path: `${shots}/14-drawer-menu-390.png` });
  await m.visible(mobile.getByTestId("nav-library")).tap(); await mobile.waitForURL(/\/library\//);
  // The Library keeps the Home index in the drawer (its categories are tabs in the screen): Projects with no host.
  await m.visible(mobile.getByRole("radio", { name: "Projects" })).waitFor();
  await mobile.screenshot({ path: `${shots}/15-drawer-after-navigation-390.png` });
  await mobile.keyboard.press("Escape"); await mobile.waitForTimeout(400);
  await mobile.emulateMedia({ colorScheme: "dark" }); await mobile.goto(`${base}/home`, { waitUntil: "networkidle" }); await m.visible(mobile.getByText("Projects", { exact: true })).waitFor({ timeout: 60_000 }); await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: `${shots}/16-home-390-dark.png` });
  console.log("ok   compact: 56 px top bar, mobile home, drawer with Menu and section segments");
} catch (err) {
  console.log("FAIL compact —", String(err).split("\n")[0]); errors.push("step failed: compact"); await mobile.screenshot({ path: `${shots}/failure.png` });
  console.log("PAGE TEXT:", (await mobile.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 600));
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "E2E OK — no page errors");
process.exit(errors.length ? 1 : 0);
