import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MENU_ACTIONS, MENU_ROLES, NATIVE_ACCELERATOR_ACTIONS, NO_TRAY_TEXT, acceleratorOf, buildMenuModel, controlsLayout, desktopEntryExec, desktopPaths, gpuCrashTracker, gpuSwitches,
  invalidMenuItems, isEditorAction, lastWindowClosed, linuxControls, linuxDesktopEntry, linuxMimePackage, linuxRegistrationFiles, maxUiScale, menuDifferences, menuFor, minimumSize,
  quitChoices, restartBlockers, restoreBounds, stepUiScale, trayAvailable, updateMode, windowsRegistration, checkLibraryCall, LIBRARY_RANGE_METHODS, createRotatingLog,
  type MenuNode, type TopMenu,
} from "../src/index.ts";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const primary = { workArea: { x: 0, y: 25, width: 1728, height: 1050 }, primary: true };
const external = { workArea: { x: 1728, y: 0, width: 2560, height: 1440 } };
const labels = (items: MenuNode[]) => items.filter((node) => node.type !== "separator").map((node) => (node as { label: string }).label);
const menu = (model: TopMenu[], id: string) => model.find((entry) => entry.id === id)!;

test("Restore window state: a remembered position on a connected display is kept; a first window is 1440×900 centred", () => {
  assert.deepEqual(restoreBounds({ x: 2000, y: 100, width: 1500, height: 1000 }, [primary, external]), { x: 2000, y: 100, width: 1500, height: 1000, maximized: false, fullscreen: false });
  assert.deepEqual(restoreBounds(null, [primary]), { x: 144, y: 100, width: 1440, height: 900, maximized: false, fullscreen: false });
  assert.equal(restoreBounds({ x: 10, y: 40, width: 1200, height: 800, maximized: true }, [primary]).maximized, true);
});

test("Display removed: the window opens centred on the primary display at the remembered size clamped to it", () => {
  assert.deepEqual(restoreBounds({ x: 2000, y: 100, width: 2400, height: 1300 }, [primary]), { x: 0, y: 25, width: 1728, height: 1050, maximized: false, fullscreen: false });
  assert.deepEqual(restoreBounds({ x: 2000, y: 100, width: 1200, height: 800 }, [primary]), { x: 264, y: 150, width: 1200, height: 800, maximized: false, fullscreen: false });
});

test("Minimum size: 960×600 at 100%. Minimum size follows the UI scale: 1,440×900 at 150%, and the scale stops where the display ends", () => {
  assert.deepEqual(minimumSize(1), { width: 960, height: 600 });
  assert.deepEqual(minimumSize(1.5), { width: 1440, height: 900 });
  assert.equal(maxUiScale({ width: 1728, height: 1050 }), 1.5);
  assert.equal(maxUiScale({ width: 1366, height: 728 }), 1.2);
  assert.equal(maxUiScale({ width: 800, height: 500 }), 0.8);
  assert.deepEqual([stepUiScale(1, 1), stepUiScale(1.5, 1), stepUiScale(0.8, -1), stepUiScale(1.3, 0), stepUiScale(1.2, 1, 1.2)], [1.1, 1.5, 0.8, 1, 1.2]);
});

test("Button layout on Linux: Close alone at the inline start draws one button there and reserves nothing at the end", () => {
  assert.deepEqual(linuxControls("'close:'"), { start: ["close"], end: [] });
  const layout = controlsLayout("linux", { linuxButtonLayout: "close:" });
  assert.deepEqual([layout.start.buttons, layout.start.inset, layout.start.drawn, layout.end.inset], [["close"], 46, "app", 0]);
  assert.deepEqual(linuxControls("appmenu:minimize,maximize,close"), { start: [], end: ["minimize", "maximize", "close"] });
  // It cannot be read: minimise, maximise, close at the inline end.
  assert.deepEqual(linuxControls(null), { start: [], end: ["minimize", "maximize", "close"] });
  assert.deepEqual(linuxControls("garbage"), { start: [], end: ["minimize", "maximize", "close"] });
});

test("Snap layouts on Windows: the caption buttons are the native ones in the overlay; macOS reserves 78 px for the traffic lights", () => {
  const windows = controlsLayout("win32", { overlayWidth: 138 });
  assert.deepEqual([windows.end.drawn, windows.end.inset, windows.start.inset], ["native", 138, 0]);
  const mac = controlsLayout("darwin");
  assert.deepEqual([mac.start.drawn, mac.start.inset, mac.end.inset], ["native", 78, 0]);
});

test("Close to tray, and Linux desktop without a tray: what closing the last window does on each system", () => {
  assert.equal(lastWindowClosed({ platform: "darwin", keepInTray: false, trayAvailable: true, hostJobs: 3 }), "stay");
  assert.equal(lastWindowClosed({ platform: "win32", keepInTray: true, trayAvailable: true, hostJobs: 0 }), "hide-to-tray");
  assert.equal(lastWindowClosed({ platform: "linux", keepInTray: true, trayAvailable: false, hostJobs: 0 }), "quit");
  assert.equal(lastWindowClosed({ platform: "linux", keepInTray: false, trayAvailable: false, hostJobs: 2 }), "ask");
  assert.equal(trayAvailable("darwin"), true);
  assert.equal(trayAvailable("win32"), true);
  assert.equal(trayAvailable("linux", { watcherRegistered: true, hostRegistered: false }), false);
  assert.equal(trayAvailable("linux", { watcherRegistered: true, hostRegistered: true }), true);
  assert.equal(NO_TRAY_TEXT, "Your desktop has no system tray");
});

test("Quit with running jobs, and with no tray: the dialog names the tasks and the keep-running choice follows the tray", () => {
  assert.deepEqual(quitChoices({ jobs: 2, trayAvailable: true }), { message: "2 tasks are still running on this computer", choices: ["Keep running in the background", "Quit anyway", "Cancel"] });
  assert.equal(quitChoices({ jobs: 2, trayAvailable: false }).choices[0], "Keep the host running — reopen JAgentChill from the launcher");
});

test("Item without an action fails the build: every menu item is a registered action or a declared role", () => {
  const model = buildMenuModel({ recent: [{ id: "p1", name: "Trip" }] });
  assert.deepEqual(invalidMenuItems(model), []);
  const broken: TopMenu[] = [...model, { id: "x", label: "E&xtra", items: [{ id: "extra.thing", label: "Mystery", action: "extra.thing" }, { id: "none", label: "Nothing" }] }];
  assert.deepEqual(invalidMenuItems(broken), ["Extra ▸ Mystery", "Extra ▸ Nothing"]);
  assert.equal(new Set(MENU_ACTIONS).size, MENU_ACTIONS.length);
  assert.ok(MENU_ROLES.includes("windowMenu"));
});

test("Same menu on Windows and Linux: the two renderings of the model differ only in the listed placements", () => {
  const model = buildMenuModel({ recent: [{ id: "p1", name: "Trip" }], hints: { "timeline.split": "Mod+B" }, enabled: { "timeline.group": false } });
  assert.deepEqual(menuDifferences(model), []);
  const mac = menuFor(model, "darwin"), other = menuFor(model, "linux");
  assert.deepEqual(mac.map((entry) => entry.id), ["app", "file", "edit", "clip", "playback", "view", "go", "host", "window", "help"]);
  assert.deepEqual(other.map((entry) => entry.label.replace("&", "")), ["File", "Edit", "Clip", "Playback", "View", "Go", "Host", "Window", "Help"]);
  assert.deepEqual(menuFor(model, "win32"), other);
  assert.deepEqual(labels(menu(mac, "app").items), ["About JAgentChill", "Check for updates…", "Settings…", "Services", "Hide JAgentChill", "Hide others", "Quit JAgentChill"]);
  // Settings and Quit sit in File, updates and About in Help, where there is no application menu.
  assert.deepEqual(labels(menu(other, "file").items).slice(-2), ["Settings…", "Quit"]);
  assert.deepEqual(labels(menu(mac, "file").items).slice(-2), ["Close project", "Close window"]);
  assert.deepEqual(labels(menu(other, "help").items), ["Keyboard shortcuts", "Starter tips", "What's new", "Send feedback…", "Diagnostics…", "Toggle developer tools", "Check for updates…", "About"]);
  assert.equal(labels(menu(mac, "window").items).includes("Bring all to front"), true);
  assert.equal(labels(menu(other, "window").items).includes("Bring all to front"), false);
  // A whole menu may be declared for one system; it is then absent from the other and is no difference.
  const mac2 = model.map((entry) => (entry.id === "clip" ? { ...entry, only: "mac" as const } : entry));
  assert.deepEqual(menuDifferences(mac2), []);
  assert.equal(menuFor(mac2, "linux").some((entry) => entry.id === "clip"), false);
});

test("Go menu matches the sidebar: seven-plus-one primary destinations in sidebar order, the More group, then Back and Forward", () => {
  const go = menu(buildMenuModel(), "go").items;
  assert.deepEqual(labels(go), ["New", "Projects", "Sessions", "Workflows", "Film Studio", "Automations", "Library", "Devices", "Scripts", "Agents", "Workspaces", "Skills", "Usage", "Back", "Forward"]);
  assert.deepEqual(go.map((node) => node.type === "separator"), [false, false, false, false, false, false, false, false, true, false, false, false, false, false, true, false, false]);
});

test("Disabled outside the editor: Clip and Playback items are disabled when no editor is in the foreground", () => {
  const model = buildMenuModel({ editorForeground: false });
  for (const id of ["clip", "playback"]) assert.ok(menu(model, id).items.every((node) => node.type === "separator" || node.enabled === false), id);
  assert.ok(menu(buildMenuModel({ editorForeground: true }), "clip").items.every((node) => node.type === "separator" || node.enabled === true));
  assert.equal(isEditorAction("timeline.split"), true);
  assert.equal(isEditorAction("nav.go.projects"), false);
});

test("Enabled state follows the selection: the renderer's isEnabled state reaches the items", () => {
  const group = (enabled: boolean) => (menu(buildMenuModel({ editorForeground: true, enabled: { "timeline.group": enabled } }), "clip").items.find((node) => node.type !== "separator" && node.action === "timeline.group") as { enabled: boolean }).enabled;
  assert.deepEqual([group(false), group(true)], [false, true]);
});

test("Open recent: the ten most recent projects, most recent first, each invoking project.open-recent with its id", () => {
  const recent = Array.from({ length: 12 }, (_unused, i) => ({ id: `p${i}`, name: `Project ${i}` }));
  const submenu = (menu(buildMenuModel({ recent }), "file").items.find((node) => node.type !== "separator" && node.id === "file.open-recent") as { submenu: MenuNode[] }).submenu;
  const items = submenu.filter((node) => node.type !== "separator") as { label: string; action: string; payload?: Record<string, string>; id: string }[];
  assert.deepEqual(items.map((node) => node.label), [...recent.slice(0, 10).map((project) => project.name), "Clear"]);
  assert.deepEqual([items[0].action, items[0].payload, items[0].id, items[10].action], ["project.open-recent", { projectId: "p0" }, "project.open-recent:p0", "project.clear-recent"]);
});

test("Single-key hint does not fire while typing: hints are display text; real accelerators exist only for what the system must own", () => {
  const model = buildMenuModel({ hints: { "timeline.delete-left": "Q", "app.quit": "Mod+Q" } });
  const node = menu(model, "clip").items.find((entry) => entry.type !== "separator" && entry.action === "timeline.delete-left") as { hint: string };
  assert.equal(node.hint, "Q");
  assert.equal(NATIVE_ACCELERATOR_ACTIONS.includes("timeline.delete-left"), false);
  assert.deepEqual([...NATIVE_ACCELERATOR_ACTIONS].sort(), ["app.fullscreen", "app.quit", "app.settings", "project.new", "project.open", "window.close", "window.new"]);
  assert.equal(acceleratorOf("Mod+Shift+B"), "CmdOrCtrl+Shift+B");
});

test("Text field has focus: Undo, Cut, Copy, Paste and Select all carry both their role and their action", () => {
  const edit = menu(buildMenuModel(), "edit").items.filter((node) => node.type !== "separator") as { label: string; role?: string; action?: string }[];
  assert.deepEqual(edit.filter((node) => node.role).map((node) => [node.label, node.role, node.action]), [["Undo", "undo", "edit.undo"], ["Redo", "redo", "edit.redo"], ["Cut", "cut", "timeline.cut"], ["Copy", "copy", "timeline.copy"], ["Paste", "paste", "timeline.paste"], ["Select all", "selectAll", "selection.all"]]);
});

test("Developer tools disabled by policy: the item is absent from the model", () => {
  const has = (model: TopMenu[]) => labels(menu(model, "help").items).includes("Toggle developer tools");
  assert.deepEqual([has(buildMenuModel()), has(buildMenuModel({ devToolsDisabled: true }))], [true, false]);
});

test("Default library location, and the data, log and cache folders of each system", () => {
  assert.deepEqual(desktopPaths("darwin", {}, "/Users/a"), { userData: "/Users/a/Library/Application Support/JAgentChill", logs: "/Users/a/Library/Logs/JAgentChill", cache: "/Users/a/Library/Caches/JAgentChill", library: "/Users/a/Movies/JAgentChill" });
  assert.deepEqual(desktopPaths("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local", USERPROFILE: "C:\\Users\\a" }, "C:\\Users\\a"),
    { userData: "C:\\Users\\a\\AppData\\Roaming\\JAgentChill", logs: "C:\\Users\\a\\AppData\\Roaming\\JAgentChill\\logs", cache: "C:\\Users\\a\\AppData\\Local\\JAgentChill\\Cache", library: "C:\\Users\\a\\Videos\\JAgentChill" });
  assert.deepEqual(desktopPaths("linux", { XDG_CONFIG_HOME: "/h/.cfg", XDG_VIDEOS_DIR: "/h/Vid" }, "/h"), { userData: "/h/.cfg/JAgentChill", logs: "/h/.local/state/JAgentChill/logs", cache: "/h/.cache/JAgentChill", library: "/h/Vid/JAgentChill" });
  assert.equal(desktopPaths("linux", {}, "/h").library, "/h/Videos/JAgentChill");
});

test("Switch set matches the toolchain file: no switch on macOS and Windows; Vulkan and unsafe WebGPU on Linux, VA-API only with a driver", () => {
  assert.deepEqual(gpuSwitches("darwin"), []);
  assert.deepEqual(gpuSwitches("win32"), []);
  assert.deepEqual(gpuSwitches("linux"), ["--enable-features=Vulkan", "--enable-unsafe-webgpu"]);
  assert.deepEqual(gpuSwitches("linux", { vaapi: true }), ["--enable-features=Vulkan,VaapiVideoDecodeLinuxGL,VaapiVideoEncoder", "--enable-unsafe-webgpu"]);
});

test("GPU crash loop: the third crash inside 60 s asks for the relaunch without GPU", () => {
  let now = 0;
  const tracker = gpuCrashTracker(() => now);
  assert.deepEqual([tracker.crashed(), (now += 70_000, tracker.crashed()), (now += 1000, tracker.crashed()), (now += 1000, tracker.crashed())], [false, false, false, true]);
});

test("AppImage registers itself, and AppImage moved: the per-user entry carries the scheme handler and MIME types and its Exec path is read back", () => {
  const entry = linuxDesktopEntry("/home/a/Apps/JAgent Chill.AppImage");
  assert.match(entry, /^Exec="\/home\/a\/Apps\/JAgent Chill\.AppImage" %U$/m);
  assert.match(entry, /^MimeType=x-scheme-handler\/jagentchill;application\/vnd\.jagentchill\.project\+zip;.*application\/vnd\.jagentchill\.workflow\+json;/m);
  assert.equal(desktopEntryExec(entry), "/home/a/Apps/JAgent Chill.AppImage");
  assert.equal(desktopEntryExec(linuxDesktopEntry("/opt/JAgentChill/jagentchill")), "/opt/JAgentChill/jagentchill");
  assert.notEqual(desktopEntryExec(entry), "/home/a/Desktop/JAgentChill.AppImage");
  const mime = linuxMimePackage();
  for (const ext of ["jagentchill", "jctpl", "jcpack", "jcworkflow", "jcscript", "jckeys", "fountain"]) assert.ok(mime.includes(`<glob pattern="*.${ext}"/>`), ext);
  assert.equal(mime.includes("*.json"), false);
  const files = linuxRegistrationFiles("/home/a/.local/share", "/home/a/.config");
  assert.deepEqual([files.desktop, files.mime, files.autostart], ["/home/a/.local/share/applications/jagentchill.desktop", "/home/a/.local/share/mime/packages/jagentchill.xml", "/home/a/.config/autostart/jagentchill.desktop"]);
  assert.deepEqual(files.databases.map((entry_) => entry_.command), ["update-desktop-database", "update-mime-database"]);
  // Launch at login starts hidden.
  assert.match(linuxDesktopEntry("/opt/j", { hidden: true, autostart: true }), /^Exec=\/opt\/j --hidden %U$/m);
});

test("Workflow file on each desktop system: Windows registers the protocol and per-user classes, the project package as default and the others as Open with", () => {
  const values = windowsRegistration("C:\\Users\\a\\AppData\\Local\\Programs\\JAgentChill\\JAgentChill.exe");
  const find = (key: string, name = "") => values.find((value) => value.key === key && value.name === name)?.value;
  assert.equal(find("HKCU\\Software\\Classes\\jagentchill", "URL Protocol"), "");
  assert.equal(find("HKCU\\Software\\Classes\\jagentchill\\shell\\open\\command"), '"C:\\Users\\a\\AppData\\Local\\Programs\\JAgentChill\\JAgentChill.exe" "%1"');
  assert.equal(find("HKCU\\Software\\Classes\\.jagentchill"), "JAgentChill.jagentchill");
  assert.equal(find("HKCU\\Software\\Classes\\.jcworkflow\\OpenWithProgids", "JAgentChill.jcworkflow"), "");
  assert.equal(find("HKCU\\Software\\Classes\\.jcworkflow"), undefined);
  assert.ok(values.every((value) => value.key.startsWith("HKCU\\") && !/\.json/.test(value.key)));
});

test("Export in progress: an update never restarts the app while work would be lost; deb, rpm and read-only installs get a download link", () => {
  assert.deepEqual(restartBlockers({ unsavedProjects: 0, runningExports: 0, runningJobs: 0, openTerminals: 0, recording: false }), []);
  assert.deepEqual(restartBlockers({ unsavedProjects: 1, runningExports: 2, runningJobs: 1, openTerminals: 1, recording: true }), ["unsaved", "export", "job", "terminal", "recording"]);
  assert.equal(updateMode({ platform: "darwin", packaged: true, appImage: false, writable: true }), "auto");
  assert.equal(updateMode({ platform: "linux", packaged: true, appImage: true, writable: true }), "auto");
  assert.equal(updateMode({ platform: "linux", packaged: true, appImage: false, writable: true }), "link");
  assert.equal(updateMode({ platform: "win32", packaged: true, appImage: false, writable: false }), "link");
  assert.equal(updateMode({ platform: "darwin", packaged: false, appImage: false, writable: true }), "off");
});

test("Renderer has no path access: a library call that names a location outside the library, or an unknown operation, is rejected", () => {
  for (const [method, args] of [
    ["readProjectText", ["../../etc/passwd"]], ["readProjectText", ["/etc/hosts"]], ["readProjectText", ["a/b"]], ["readProjectText", [".."]], ["readProjectText", ["a\\b"]], ["readProjectText", [""]],
    ["readMedia", ["p1", "../../../etc/hosts"]], ["getBlob", ["cover", "p1", "../project.json"]], ["readLibraryFile", ["luts/../../../etc/hosts"]], ["readLibraryFile", ["/etc/hosts"]],
    ["writeMedia", ["p1", "a1", new Uint8Array(1), { extension: "../../x" }]], ["putSnapshot", ["p1", { id: "../../evil", record: "{}" }]], ["getSession", ["../x"]],
    ["cache.get", [{ kind: "proxy", contentHash: "../../x" }]], ["cache.get", [{ kind: "proxy", contentHash: "abc", path: "/etc" }]], ["writeProjectText", ["p1", 5]], ["readProjectText", ["p1", "extra"]],
  ] as [string, unknown[]][]) assert.equal(checkLibraryCall(method, args).ok, false, `${method} ${JSON.stringify(args)}`);
  for (const method of ["readFile", "constructor", "__proto__", "toString", "library", "close", "moveTo", "grantExternalFile", "serveExternalFile", "dropAndRebuildIndex"]) assert.deepEqual(checkLibraryCall(method, ["/etc/hosts"]).ok, false, method);
  assert.equal((checkLibraryCall("readFile", ["/etc/hosts"]) as { code: string }).code, "LIBRARY_METHOD_UNKNOWN");
  for (const [method, args] of [
    ["listProjects", []], ["readProjectText", ["0f3c2a1e-aaaa-4bbb-8ccc-000000000001"]], ["writeProjectText", ["p_1", "{}"]], ["writeMedia", ["p1", "a1", new Uint8Array(2), { extension: "mp4", contentHash: "ab12" }]],
    ["putBlob", ["thumbnail", "p1", "frame0.jpg", new Uint8Array(1)]], ["readLibraryFile", ["luts/warm.cube"]], ["listLibraryFiles", ["templates/"]], ["listLibraryFiles", [""]], ["getSession", ["export.queue"]],
    ["appendJournal", ["script.s1", { baseRevision: 1, revision: 2, commandType: "x", label: "y", patch: [] }]], ["cache.has", [{ kind: "thumbnail", contentHash: "ab12", variant: "w320" }]],
    ["writeMediaStream", ["p1", "a1", { upload: "0".repeat(32) }, undefined]],
  ] as [string, unknown[]][]) assert.deepEqual(checkLibraryCall(method, args), { ok: true }, `${method}`);
  assert.equal(checkLibraryCall("readMediaStream", ["p1", "../x"], LIBRARY_RANGE_METHODS).ok, false);
  assert.equal(checkLibraryCall("readMediaStream", ["p1", "a1"], LIBRARY_RANGE_METHODS).ok, true);
});

test("the host log rotates at its size limit and keeps five files and the last hundred lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "jc-log-"));
  const log = createRotatingLog(join(dir, "host.log"), { maxBytes: 1000, files: 5 });
  for (let i = 0; i < 400; i++) log.write(`line ${String(i).padStart(4, "0")} ${"x".repeat(20)}\n`);
  assert.deepEqual(log.paths().map((path) => existsSync(path)), [true, true, true, true, true]);
  assert.equal(existsSync(join(dir, "host.5.log")), false);
  assert.ok(log.paths().every((path) => statSync(path).size <= 1000));
  assert.equal(log.lastLines().length, 100);
  assert.match(log.lastLines()[99], /^line 0399/);
  assert.match(readFileSync(join(dir, "host.log"), "utf8"), /line 0399/);
});

import { EXPORT_QUIT, backgroundNotice, buildTrayMenu, hiddenLaunch, keepInTrayDefault, menuLabels, trayShown, trayState, trayStatusLine } from "../src/index.ts";

test("Attention state: the tray icon is idle, busy while jobs run, and attention when a task needs the user or the host failed", () => {
  assert.equal(trayState({ tasks: 0, attention: 0, hostFailed: false }), "idle");
  assert.equal(trayState({ tasks: 2, attention: 0, hostFailed: false }), "busy");
  assert.equal(trayState({ tasks: 2, attention: 1, hostFailed: false }), "attention");
  assert.equal(trayState({ tasks: 0, attention: 0, hostFailed: true }), "attention");
  assert.equal(trayStatusLine("Running", 2), "Host running — 2 tasks");
  assert.equal(trayStatusLine("Running", 1), "Host running — 1 task");
  assert.equal(trayStatusLine("Stopped", 0), "Host stopped");
});

test("the tray menu: status line, Open, New project, up to five running tasks with progress, a pending request, Pair a device…, the host switch, Settings… and Quit — each a registry action", () => {
  const tasks = Array.from({ length: 7 }, (_unused, index) => ({ id: `j${index}`, title: `Export ${index}`, percent: index * 10 + 0.4, route: "/exports/queue" }));
  const menu = buildTrayMenu({ hostLabel: "Running", hostRunning: true, hostAvailable: true, tasks, attention: [{ id: "a1", title: "Approve: run ffmpeg", route: "/h/x/sessions/s1" }] });
  const rows = menu.filter((item) => item.type !== "separator") as { id: string; label: string; action?: string; payload?: Record<string, string>; enabled?: boolean }[];
  assert.deepEqual(rows.map((row) => row.label), ["Host running — 7 tasks", "Open JAgentChill", "New project", "Approve: run ffmpeg", "Export 0 — 0%", "Export 1 — 10%", "Export 2 — 20%", "Export 3 — 30%", "Export 4 — 40%", "Pair a device…", "Stop built-in host", "Settings…", "Quit"]);
  assert.deepEqual(rows.filter((row) => row.action).map((row) => row.action), ["app.open", "project.new", "nav.open", "nav.open", "nav.open", "nav.open", "nav.open", "nav.open", "devices.pair", "supervisor.stop", "app.settings", "app.quit"]);
  assert.deepEqual([rows[0].enabled, rows[3].payload], [false, { route: "/h/x/sessions/s1" }]);
  assert.equal((buildTrayMenu({ hostLabel: "Stopped", hostRunning: false, hostAvailable: true, tasks: [] }).find((item) => item.type !== "separator" && item.id === "supervisor.start") as { label: string }).label, "Start built-in host");
});

test("Launch at login, Close to tray and Background without a tray: the defaults and what a hidden launch does on each system", () => {
  assert.equal(keepInTrayDefault("darwin", { hostEnabled: true, trayAvailable: true }), false);
  assert.equal(keepInTrayDefault("win32", { hostEnabled: true, trayAvailable: true }), true);
  assert.equal(keepInTrayDefault("linux", { hostEnabled: true, trayAvailable: false }), false);
  assert.equal(keepInTrayDefault("linux", { hostEnabled: false, trayAvailable: true }), false);
  assert.equal(trayShown({ hostEnabled: true, keepInTray: false, trayAvailable: true }), true);
  assert.equal(trayShown({ hostEnabled: false, keepInTray: false, trayAvailable: true }), false);
  assert.equal(trayShown({ hostEnabled: true, keepInTray: true, trayAvailable: false }), false);
  assert.deepEqual([hiddenLaunch(true), hiddenLaunch(false)], ["no-window", "minimised"]);
  assert.equal(backgroundNotice(2), "JAgentChill is running in the background — 2 tasks");
  assert.deepEqual([...EXPORT_QUIT.choices], ["Quit and cancel the export", "Keep exporting"]);
});

test("every label of the menu model is listed for translation, the host status lines included", () => {
  const labels = menuLabels();
  for (const label of ["&File", "Split", "Open recent", "Host: Running with problems", "Stop built-in host", "Toggle developer tools", "Bring all to front"]) assert.ok(labels.includes(label), label);
  assert.equal(new Set(labels).size, labels.length);
});
