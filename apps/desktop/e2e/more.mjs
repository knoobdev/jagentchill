// The second part of the desktop checks: the application menu and the editor, the in-window menu, files opened with
// the app, several windows, quitting while work runs, the tray, repair of the host and replacing the device key.
// Unattended throughout: no window is shown, no system dialog is raised (their answers come from a hook this run
// installs in the main process), and no tray icon or login item is created.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, desktopRoot, freshRun, launch, processesOf, quit, repoRoot, sleep, waitFor } from "./lib.mjs";

export default async function more({ packaged, results, check }) {
  const run = freshRun(packaged ? "packaged-more" : "dev-more");
  mkdirSync(run.shots, { recursive: true });
  console.log(`\nsecond run directory: ${run.dir}`);
  const ps = () => execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] }));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const status = (page) => page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
  const hostReady = (page, timeout = 150_000) => waitFor(async () => { const s = await status(page); return s.state === "ready" || (s.state === "degraded" && s.reasons.every((r) => r === "ffmpeg_missing")) ? s : null; }, { timeout, what: "the built-in host" });
  // No agent CLI is on this PATH, so the host has no runtime that could call a model: nothing in this run can spend anyone's quota.
  const env = { JAGENTCHILL_FORCE_APP_MENU: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", JAGENTCHILL_NODE_PATH: process.execPath };
  const childEnv = { ...process.env, JAGENTCHILL_USER_DATA: run.userData, JAGENTCHILL_LIBRARY_DIR: run.library, JAGENTCHILL_UNATTENDED: "1", ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const t0 = Date.now();
  let session = await launch(run, { packaged, env });
  let { app, page } = session;
  const electronExe = await app.evaluate(() => process.execPath);
  const again = (args) => new Promise((done) => { const child = packaged ? spawn(packaged, args, { env: childEnv, stdio: "ignore" }) : spawn(electronExe, [desktopRoot, ...args], { env: childEnv, stdio: "ignore" }); child.once("exit", (code) => done(code)); });
  const ready = await hostReady(page);
  const timeToReady_ms = Date.now() - t0;
  check(results, `Time to ready, measured: launch → window → server ready (${packaged ? "local build" : "electron ."}, first run of a fresh data directory)`, true, `${(timeToReady_ms / 1000).toFixed(1)} s, state ${ready.state} [${ready.reasons.join(",")}]`);

  // The system menu bar of macOS as the main process holds it.
  const menu = (path) => app.evaluate(({ Menu }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? [], found = null;
    for (const label of labels) { found = items.find((item) => item.label === label); if (!found) return { missing: label, have: items.map((item) => item.label).filter(Boolean) }; items = found.submenu?.items ?? []; }
    return { enabled: found.enabled, checked: found.checked, accelerator: found.accelerator ?? null };
  }, path);
  const click = async (path) => { const state = await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? [], found = null;
    for (const label of labels) { found = items.find((item) => item.label === label); if (!found) return { missing: label }; items = found.submenu?.items ?? []; }
    if (!found.enabled) return { disabled: true };
    found.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
    return { clicked: true };
  }, path); await sleep(350); return state; };
  const text = () => page.evaluate(() => document.body.innerText);
  const closeDialogs = async () => {
    for (let attempt = 0; attempt < 5 && (await page.evaluate(() => document.querySelectorAll('[role="dialog"], [data-testid="scrim"]').length)) > 0; attempt++) {
      await page.keyboard.press("Escape");
      await sleep(350);
      if (attempt >= 2) await page.locator('[role="dialog"] [aria-label="Close"]').first().click({ timeout: 1000 }).catch(() => undefined);
    }
    return page.evaluate(() => document.querySelectorAll('[role="dialog"], [data-testid="scrim"]').length);
  };
  const go = (route) => page.evaluate((r) => { history.pushState({}, "", r); window.dispatchEvent(new PopStateEvent("popstate")); }, route);

  // ───────────── the menu and the editor ─────────────
  await go("/home");
  await page.getByText("New blank project", { exact: true }).first().click();
  await page.waitForURL(/\/editor\//, { timeout: 30_000 });
  const projectId = decodeURIComponent(/\/editor\/([^/?#]+)/.exec(page.url())[1]);
  const projectFile = join(run.library, projectId, "project.json");
  await waitFor(() => existsSync(projectFile), { timeout: 20_000, what: "project.json" });
  const count = (value) => (Array.isArray(value) ? value.reduce((sum, entry) => sum + count(entry), 0) : value && typeof value === "object" ? Object.entries(value).reduce((sum, [key, entry]) => sum + (key === "elements" && Array.isArray(entry) ? entry.length : 0) + count(entry), 0) : 0);
  const elements = () => { try { return count(JSON.parse(readFileSync(projectFile, "utf8")).scenes); } catch { return -1; } };
  const elementsBecome = (n) => waitFor(() => elements() === n, { timeout: 12_000, every: 200, what: `${n} element(s) in project.json` }).then(() => true, () => false);
  await sleep(1500);
  const outside = await menu(["Edit", "Duplicate"]);
  // A text clip, added with the editor's own button.
  if (!(await page.locator('[data-testid="text-add"]').first().isVisible().catch(() => false))) await page.locator('[data-testid="panel-tab-text"]').first().click().catch(() => undefined);
  await page.locator('[data-testid="text-add"]').first().click();
  const added = await elementsBecome(1);
  check(results, "A text clip was added in the editor with its own button (the content for the menu checks)", added, `${elements()} element(s) in project.json`);
  await click(["Edit", "Select none"]).catch(() => undefined);
  await click(["Edit", "Deselect all"]);
  const unselected = await menu(["Edit", "Duplicate"]);
  await click(["Edit", "Select all"]);
  const selected = await menu(["Edit", "Duplicate"]), groupOne = await menu(["Clip", "Group"]);
  await click(["Edit", "Duplicate"]);
  const duplicated = await elementsBecome(2);
  await click(["Edit", "Select all"]);
  const groupTwo = await menu(["Clip", "Group"]);
  check(results, "Enabled state follows the selection: Edit ▸ Duplicate is disabled with nothing selected and enabled after Select all; Clip ▸ Group needs two clips", unselected.enabled === false && selected.enabled === true && groupOne.enabled === false && groupTwo.enabled === true, JSON.stringify({ unselected: unselected.enabled, selected: selected.enabled, groupWithOne: groupOne.enabled, groupWithTwo: groupTwo.enabled }));
  const undoState = await menu(["Edit", "Undo"]);
  await click(["Edit", "Undo"]);
  const undone = await elementsBecome(1);
  await click(["Edit", "Redo"]);
  const redone = await elementsBecome(2);
  check(results, "Menu invokes the action: Edit ▸ Duplicate, Edit ▸ Undo and Edit ▸ Redo change the project on disk (1 → 2 → 1 → 2 clips)", duplicated && undone && redone && undoState.enabled === true, `now ${elements()}`);
  await click(["Edit", "Select all"]);
  await click(["Edit", "Delete"]);
  const deleted = await elementsBecome(0);
  await click(["Edit", "Undo"]);
  check(results, "Edit ▸ Delete removes the selected clips and Undo brings them back", deleted && (await elementsBecome(2)));
  const loopBefore = await menu(["Playback", "Loop"]);
  await click(["Playback", "Loop"]);
  const loopAfter = await menu(["Playback", "Loop"]);
  await click(["Playback", "Loop"]);
  check(results, "Playback ▸ Loop toggles the editor's loop and the item's check mark follows", loopBefore.checked !== loopAfter.checked, `${loopBefore.checked} → ${loopAfter.checked}`);
  const playing = () => page.evaluate(() => navigator.mediaSession.playbackState);
  const before = await playing();
  await click(["Playback", "Play/pause"]);
  const during = await playing();
  await click(["Playback", "Play/pause"]);
  check(results, "Playback ▸ Play/pause starts and stops the transport (the media session the play/pause key talks to follows)", during === "playing" && (await playing()) === "paused", `${before} → ${during} → ${await playing()}`);
  const pressed = () => page.evaluate(() => document.querySelector('[data-testid="toggle-inspector"]')?.getAttribute("aria-pressed") ?? document.querySelector('[data-testid="toggle-inspector"]')?.getAttribute("aria-checked"));
  const inspectorBefore = await pressed();
  await click(["View", "Toggle inspector"]);
  const inspectorAfter = await pressed();
  await click(["View", "Toggle inspector"]);
  check(results, "View ▸ Toggle inspector hides and shows the inspector", inspectorBefore !== inspectorAfter && inspectorBefore !== null, `${inspectorBefore} → ${inspectorAfter}`);
  const dialogs = () => page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  const d0 = await dialogs();
  await click(["File", "Export…"]);
  await sleep(600);
  const d1 = await dialogs();
  await page.screenshot({ path: join(run.shots, "menu-export.png") });
  await closeDialogs();
  await click(["Help", "Keyboard shortcuts"]);
  await sleep(400);
  const d2 = await dialogs();
  const leftOpen = await closeDialogs();
  if (leftOpen) console.log(`note: ${leftOpen} dialog(s) could not be closed with Escape`);
  check(results, "File ▸ Export… opens the export dialog and Help ▸ Keyboard shortcuts opens the shortcut sheet", d1 > d0 && d2 > 0, `dialogs ${d0} → ${d1}, sheet ${d2}`);
  const notBuilt = await Promise.all([["Clip", "Create multi-camera clip"], ["Clip", "Speed…"], ["View", "Focus mode"]].map(menu));
  const hint = await menu(["Clip", "Split"]);
  check(results, "Items whose action the editor does not have yet are disabled, not dead; hints are shown as display text", notBuilt.every((item) => item.enabled === false) && /B$/.test(hint.accelerator ?? ""), `Split hint ${hint.accelerator}; ${notBuilt.map((item) => item.enabled).join(",")}`);

  // ───────────── the application menu inside the window (Windows and Linux; shown on this Mac by JAGENTCHILL_FORCE_APP_MENU) ─────────────
  const model = await page.evaluate(() => window.jagentchillDesktop.menu.getModel());
  const menuButton = page.locator('[data-testid="app-menu"]').locator('[role="button"], button').first();
  await menuButton.click();
  await sleep(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent.trim()));
  await page.screenshot({ path: join(run.shots, "app-menu.png") });
  const top = ["File", "Edit", "Clip", "Playback", "View", "Go", "Host", "Window", "Help"];
  check(results, "Same menu on Windows and Linux: the in-window application menu lists File, Edit, Clip, Playback, View, Go, Host, Window and Help from the same model", model.map((m) => m.label.replace("&", "")).join() === top.join() && top.every((label) => rows.some((row) => row.startsWith(label))), rows.slice(0, 9).join(" | "));
  await page.getByRole("menuitem", { name: "Go", exact: true }).first().hover().catch(() => undefined);
  await page.getByRole("menuitem", { name: "Go", exact: true }).first().click().catch(() => undefined);
  await sleep(400);
  await page.getByRole("menuitem", { name: "Projects", exact: true }).first().click().catch(() => undefined);
  const arrived = await page.waitForURL(/\/projects$/, { timeout: 8000 }).then(() => true, () => false);
  check(results, "The in-window menu invokes the same action: Go ▸ Projects navigates", arrived, await page.evaluate(() => location.pathname));
  await sleep(600);
  const disabledOutside = await Promise.all([["Clip", "Split"], ["Playback", "Play/pause"], ["Go", "Projects"]].map(menu));
  check(results, "Disabled outside the editor: Clip and Playback items are disabled on the Projects screen, Go stays enabled", disabledOutside[0].enabled === false && disabledOutside[1].enabled === false && disabledOutside[2].enabled === true, disabledOutside.map((item) => item.enabled).join(","));

  // ───────────── menu labels follow the language ─────────────
  const topLabels = () => app.evaluate(({ Menu }) => ({ top: Menu.getApplicationMenu().items.map((item) => item.label), file: Menu.getApplicationMenu().items[1].submenu.items.map((item) => item.label).filter(Boolean).slice(0, 3), app: Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label).filter(Boolean).pop() }));
  const language = async (value) => { await page.evaluate((v) => { if (v) localStorage.setItem("jagentchill.shell.language", JSON.stringify({ v: 1, value: v })); else localStorage.removeItem("jagentchill.shell.language"); }, value); await page.reload(); await page.waitForLoadState("domcontentloaded"); await sleep(2500); return topLabels(); };
  const vi = await language("vi"), ja = await language("ja"), en = await language("en");
  check(results, "Menu labels are localised: Vietnamese, Japanese and English from the app's own locale tables", vi.top.includes("Tệp") && vi.app === "Thoát JAgentChill" && ja.top.some((label) => label.startsWith("ファイル")) && en.top.includes("File") && en.app === "Quit JAgentChill", `vi: ${vi.top.slice(1, 5).join(", ")} / ${vi.file.join(", ")} · ja: ${ja.top.slice(1, 4).join(", ")}`);

  // ───────────── "Open with" a media file ─────────────
  const picture = join(run.dir, "picture.png");
  copyFileSync(join(desktopRoot, "build", "icon.png"), picture);
  const projectDirs = () => readdirSync(run.library).filter((name) => existsSync(join(run.library, name, "project.json")));
  const dirsBefore = projectDirs();
  const mediaExit = await again([picture]);
  const asked = await page.waitForSelector('[data-testid="open-media"]', { timeout: 15_000 }).then(() => true, () => false);
  const offered = await text();
  await page.screenshot({ path: join(run.shots, "open-media.png") });
  check(results, "Open a video with the app (here: an image passed as a launch argument): the app asks before importing, offering “Create a new project”", mediaExit === 0 && asked && /picture\.png/.test(offered) && /Create a new project/.test(offered) && projectDirs().length === dirsBefore.length, `second launch exit ${mediaExit}`);
  await page.locator('[data-testid="open-media-new"]').click();
  const made = await waitFor(() => { const fresh = projectDirs().filter((name) => !dirsBefore.includes(name)); return fresh.length === 1 && existsSync(join(run.library, fresh[0], "media")) && readdirSync(join(run.library, fresh[0], "media")).length > 0 ? fresh[0] : null; }, { timeout: 30_000, what: "the new project with its media" }).catch(() => null);
  check(results, "After the choice a new project holds the file in its media folder and opens in the editor", !!made && (await page.waitForURL(/\/editor\//, { timeout: 15_000 }).then(() => true, () => false)), made ? readdirSync(join(run.library, made, "media")).join(", ") : "not created");

  // ───────────── a session from the desktop window (no model is called: this host has no runtime) ─────────────
  await go("/home");
  await sleep(1500);
  const chip = (await text()).replace(/\s+/g, " ");
  const composer = page.locator("textarea").first();
  await composer.fill("Make a ten second teaser from my last project");
  await composer.press("Enter");
  await sleep(5000);
  const afterSend = { path: await page.evaluate(() => location.pathname), text: (await text()).replace(/\s+/g, " ") };
  const sdb = new DatabaseSync(join(run.userData, "host", "jagentchill.sqlite"), { readOnly: true });
  const sessionRows = sdb.prepare("SELECT session_key, owner_device_id, model_id FROM agent_sessions").all();
  const usageRows = sdb.prepare("SELECT count(*) AS n FROM session_usage").get().n;
  sdb.close();
  await page.screenshot({ path: join(run.shots, "session.png") });
  const sends = (readFileSync(join(run.userData, "logs", "host.log"), "utf8").match(/chat\.send/g) ?? []).length;
  const stateBefore = /(Choose a model|No AI runtime is ready)/.exec(chip)?.[0] ?? "", stateAfter = /(Choose a model|No AI runtime is ready|Connect a runtime|Set up a runtime)/i.exec(afterSend.text)?.[0] ?? "";
  check(results, "A session from the desktop window: with no runtime on the host the composer stops at the model state; no chat.send reaches an agent and no usage is recorded", stateBefore !== "" && stateAfter !== "" && sends === 0 && usageRows === 0 && sessionRows.every((row) => row.model_id === null), `before: “${stateBefore}”; after Enter: “${stateAfter}” on ${afterSend.path}; session records ${sessionRows.length}, chat.send ${sends}, usage rows ${usageRows}`);
  await composer.fill("").catch(() => undefined);

  // ───────────── several windows ─────────────
  await go(`/editor/${projectId}`);
  await page.waitForSelector('[data-testid="editor-regions"]', { timeout: 20_000 }).catch(() => undefined);
  await sleep(800);
  const opening = app.waitForEvent("window");
  await page.evaluate(() => window.jagentchillDesktop.window.newWindow("/projects"));
  const second = await opening;
  await second.waitForLoadState("domcontentloaded");
  await sleep(2500);
  await second.evaluate((id) => { history.pushState({}, "", `/editor/${id}`); window.dispatchEvent(new PopStateEvent("popstate")); }, projectId);
  await sleep(3500);
  const paths = { first: await page.evaluate(() => location.pathname), second: await second.evaluate(() => location.pathname) };
  check(results, "Same project twice: the window that already has the project keeps it, and the second window stays on its own screen", (await app.windows()).length === 2 && paths.first === `/editor/${projectId}` && paths.second === "/projects", JSON.stringify(paths));

  // ───────────── quitting while work runs; the tray ─────────────
  // The running work below is REPORTED BY THIS TEST through the bridge (the same call the app's export queue makes);
  // no real export or host job runs. The dialogs are the app's own; their answers come from the hook.
  await app.evaluate(() => { globalThis.__asked = []; globalThis.__answer = 1; globalThis.__jagentchillDialog = (question) => { globalThis.__asked.push(question); return globalThis.__answer; }; });
  const asks = () => app.evaluate(() => globalThis.__asked.splice(0));
  const item = (id, title, percent) => ({ id, title, percent, route: "/exports/queue" });
  await sleep(1500);
  const report = (work) => page.evaluate((w) => window.jagentchillDesktop.background.setWork(w), work);
  await report({ exports: [item("e1", "Trip — trip.mp4", 40)], jobs: [], attention: [], unsavedProjects: 0 });
  await app.evaluate(({ app: a }) => a.quit());
  await sleep(1200);
  const exportAsk = await asks();
  check(results, "An export in progress is confirmed before quitting; “Keep exporting” keeps the app and its host running", exportAsk.length === 1 && exportAsk[0].message === "An export is in progress" && exportAsk[0].buttons.join("|") === "Quit and cancel the export|Keep exporting" && alive(session.pid) && alive(ready.pid) && (await app.windows()).length === 2, exportAsk[0]?.buttons.join(" | "));
  await report({ exports: [], jobs: [item("j1", "Teaser — generation", 10), item("j2", "Trip — host export", 55)], attention: [item("a1", "Approve: run ffmpeg")], unsavedProjects: 0 });
  const tray = await app.evaluate(() => ({ model: globalThis.__jagentchill.trayModel(), state: globalThis.__jagentchill.backgroundState() }));
  const trayLabels = tray.model.filter((entry) => entry.type !== "separator").map((entry) => entry.label);
  check(results, "Attention state, and the tray menu as it would be shown (no tray icon is created in an unattended run)", tray.state.trayState === "attention" && tray.state.trayShown === true && /^Host running( with problems)? — 2 tasks$/.test(trayLabels[0]) && trayLabels.includes("Approve: run ffmpeg") && trayLabels.includes("Trip — host export — 55%") && trayLabels.at(-1) === "Quit", trayLabels.join(" | "));
  await app.evaluate(() => { globalThis.__answer = 2; });
  await app.evaluate(({ app: a }) => a.quit());
  await sleep(1200);
  const jobsAsk = await asks();
  check(results, "Quit with running jobs: the dialog names 2 tasks with “Keep running in the background”, “Quit anyway” and “Cancel”; Cancel changes nothing", jobsAsk.length === 1 && jobsAsk[0].message === "2 tasks are still running on this computer" && jobsAsk[0].buttons.join("|") === "Keep running in the background|Quit anyway|Cancel" && (await app.windows()).length === 2 && alive(ready.pid), jobsAsk[0]?.message);
  const login = await page.evaluate(() => window.jagentchillDesktop.background.set({ launchAtLogin: true }));
  check(results, "Launch at login: the setting is stored (the login item itself is not registered with macOS in an unattended run)", login.launchAtLogin === true && /launch at login on: not registered/.test(readFileSync(join(run.userData, "logs", "main.log"), "utf8")));
  await page.evaluate(() => window.jagentchillDesktop.background.set({ launchAtLogin: false }));
  await app.evaluate(() => { globalThis.__answer = 0; });
  await app.evaluate(({ app: a }) => a.quit());
  await sleep(2500);
  const kept = { windows: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), app: alive(session.pid), server: alive(ready.pid) };
  check(results, "“Keep running in the background”: the windows close while the app process and the server remain", kept.windows === 0 && kept.app && kept.server, JSON.stringify(kept));
  const reopen = app.waitForEvent("window", { timeout: 20_000 }).catch(() => null);
  const reExit = await again([]);
  page = (await reopen) ?? page;
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await sleep(2500);
  check(results, "Launching again re-attaches: the second process exits, the running instance opens a window, and no second server starts", reExit === 0 && (await app.windows()).length >= 1 && ps().filter((p) => / serve --data-dir /.test(p.command) && p.command.includes(run.dir)).length === 1 && (await status(page)).pid === ready.pid, `exit ${reExit}, windows ${(await app.windows()).length}`);

  // ───────────── “Run repair”: the running server is asked to restart its agents ─────────────
  await hostReady(page);
  const repairAt = Date.now();
  const repair = await page.evaluate(() => window.jagentchillDesktop.gateway.runDoctor().then(() => "accepted", (error) => `refused: ${error.message}`));
  await sleep(1500);
  const repaired = await hostReady(page, 120_000).catch(() => null);
  check(results, "Run repair works end to end: accepted, and the same server is ready again", repair === "accepted" && !!repaired && repaired.pid === ready.pid, repaired ? `in ${((Date.now() - repairAt) / 1000).toFixed(1)} s, state ${repaired.state}` : repair);

  // ───────────── replacing the device key ─────────────
  const keyFile = join(run.userData, "identity", "device.key");
  const oldKey = (await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey())).value;
  await app.evaluate(() => { globalThis.__answer = 1; globalThis.__asked = []; });
  const declined = await page.evaluate(() => window.jagentchillDesktop.device.rotate());
  const declinedAsk = await asks();
  check(results, "Rotation needs a person: with the dialog dismissed the answer is SIGN_REFUSED and no new key exists", declined.error?.code === "SIGN_REFUSED" && declinedAsk[0]?.message === "Replace this device's key?" && !("pending" in JSON.parse(readFileSync(keyFile, "utf8"))) && (await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey())).value.deviceId === oldKey.deviceId, declined.error?.code);
  await app.evaluate(() => { globalThis.__answer = 0; });
  const rotated = await page.evaluate(() => window.jagentchillDesktop.device.rotate());
  await sleep(1500);
  const newKey = (await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey())).value;
  const afterRotation = await hostReady(page, 60_000).catch(() => null);
  const rdb = new DatabaseSync(join(run.userData, "host", "jagentchill.sqlite"), { readOnly: true });
  const records = rdb.prepare("SELECT device_id, role, state, local_supervisor FROM devices ORDER BY paired_ms, state DESC").all();
  const tokens = rdb.prepare("SELECT device_id FROM device_tokens").all().map((row) => row.device_id);
  rdb.close();
  const oldRecord = records.find((row) => row.device_id === oldKey.deviceId), newRecord = records.find((row) => row.device_id === newKey.deviceId);
  check(results, "Rotation keeps the role: the pending key was promoted — this computer has a new device id, the same admin and supervisor role, and the supervisor is connected with it", "value" in rotated && newKey.deviceId !== oldKey.deviceId && rotated.value.deviceId === newKey.deviceId && newRecord?.role === "admin" && newRecord?.local_supervisor === 1 && newRecord?.state === "active" && !!afterRotation && !("pending" in JSON.parse(readFileSync(keyFile, "utf8"))), `${oldKey.deviceId.slice(0, 12)} → ${newKey.deviceId.slice(0, 12)}, host ${afterRotation?.state}`);
  // The old key no longer exists on this computer; the host's own record shows it can never be used again.
  const oldSigned = await page.evaluate(async ({ gatewayId, port, deviceId }) => {
    const d = window.jagentchillDesktop.device, nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), ts = Date.now(), target = "/jagentchill/v1/secrets";
    const first = await d.sign({ kind: "request", fields: { gatewayId, method: "GET", target, bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ts, nonce } });
    if (!("value" in first)) return { old: -1, fresh: -1, error: JSON.stringify(first), gatewayId };
    const sig = first.value.signature;
    const headers = (id) => ({ "x-jagentchill-device": id, "x-jagentchill-timestamp": String(ts), "x-jagentchill-nonce": nonce, "x-jagentchill-signature": sig });
    const asOld = await fetch(`http://127.0.0.1:${port}${target}`, { headers: headers(deviceId) });
    const nonce2 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sig2 = (await d.sign({ kind: "request", fields: { gatewayId, method: "GET", target, bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ts, nonce: nonce2 } })).value.signature;
    const asNew = await fetch(`http://127.0.0.1:${port}${target}`, { headers: { ...headers((await d.getPublicKey()).value.deviceId), "x-jagentchill-nonce": nonce2, "x-jagentchill-signature": sig2 } });
    return { old: asOld.status, fresh: asNew.status };
  }, { gatewayId: ready.gatewayId, port: ready.port, deviceId: oldKey.deviceId });
  check(results, "The old key is refused: its record is revoked with no token left, a request in its name is rejected, and the new key's request is accepted", oldRecord?.state === "revoked" && oldRecord?.local_supervisor === 0 && !tokens.includes(oldKey.deviceId) && tokens.includes(newKey.deviceId) && oldSigned.old >= 400 && oldSigned.fresh === 200, JSON.stringify({ old: oldRecord?.state, request: oldSigned }));

  // ───────────── quit, relaunch: every window comes back ─────────────
  await report({ exports: [], jobs: [], attention: [], unsavedProjects: 0 }).catch(() => undefined);
  const opened = app.waitForEvent("window");
  await page.evaluate(() => window.jagentchillDesktop.window.newWindow("/library"));
  await (await opened).waitForLoadState("domcontentloaded");
  await sleep(1500);
  const openBefore = (await app.windows()).length;
  const last = { server: ready.pid };
  await app.evaluate(() => { globalThis.__answer = 1; });
  await quit(session);
  await waitFor(() => !alive(last.server), { timeout: 20_000, what: "the processes to end" }).catch(() => undefined);
  const afterQuit = processesOf(run);
  console.log(`processes of the second run after quit:\n${describe(afterQuit)}`);
  check(results, "No orphan process after the second run's quit", afterQuit.length === 0);
  session = await launch(run, { packaged, env });
  await sleep(3000);
  const routes = await Promise.all((await session.app.windows()).map((window) => window.evaluate(() => location.pathname)));
  check(results, "Session restore: every window that was open comes back on its route, and the rotated key connects again with its stored token", routes.length === openBefore && routes.some((route) => route.startsWith("/library")) && !!(await hostReady(session.page).catch(() => null)), `${openBefore} open at quit → ${routes.join(", ")}`);
  await quit(session);
  await sleep(1500);
  const leftovers = processesOf(run);
  check(results, "No orphan process after the relaunch", leftovers.length === 0, describe(leftovers).trim());
  const faults = [readFileSync(join(run.userData, "logs", "main.log"), "utf8"), existsSync(join(run.dir, "electron-output.log")) ? readFileSync(join(run.dir, "electron-output.log"), "utf8") : ""].join("\n").split("\n").filter((line) => /uncaughtException|unhandledRejection|ReferenceError|TypeError/.test(line));
  check(results, "No uncaught exception in the main process during the second run", faults.length === 0, faults.slice(0, 2).join(" | ").slice(0, 300));
  return { run, timeToReady_ms };
}
