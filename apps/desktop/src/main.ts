import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BrowserWindow, Menu, Notification, Tray, app, dialog, ipcMain, nativeImage, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, screen, session, shell,
  type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents,
} from "electron";
import { connectHost, signedHeaders, type HostConnection } from "@jagentchill/client";
import {
  APP_HOST, APP_ORIGIN, APP_SCHEME, DEVTOOLS_ACTION, FILE_SCHEME, GATEWAY_MEDIA_SCHEME, HELD_FILES, HELD_LINKS, KEY_FILE_CONFIRMATION, KEY_STORAGE_CHOICES,
  NATIVE_ACCELERATOR_ACTIONS, SIGN_REFUSED, SignRefused, WEB_PREFERENCES, acceleratorOf, acceptDeepLink, buildMenuModel, contentSecurityPolicy, controlsLayout,
  createHeldQueue, createRotatingLog, desktopPaths, externalOpen, gpuCrashTracker, gpuSwitches, launchTargets, maxUiScale, menuFor, minimumSize,
  navigationAllowed, permissionGranted, resolveAppRequest, restartBlockers, restoreBounds, senderAllowed, stepUiScale, trayAvailable,
  feedBase, feedFileUrl, feedUrlOfAppUpdate, macCanSelfUpdate, updateMode, UPDATE_FIRST_CHECK_MS, UPDATE_INTERVAL_MS, UPDATE_REMIND_MS,
  EXPORT_QUIT, NO_TRAY_TEXT, backgroundNotice, buildTrayMenu, hiddenLaunch, keepInTrayDefault, lastWindowClosed, linuxDesktopEntry, linuxRegistrationFiles, quitChoices, trayShown, trayState,
  type TrayTask,
  type MenuNode, type MenuState, type WindowState,
  notificationActivation, notificationPlan, setAttentionBadge,
} from "@jagentchill/desktop-core";
import { DESKTOP_CHANNEL_ARGS, TAILNET_METHODS, desktopChannelName, type DesktopChannel, type DesktopEvent, type DesktopReply, type TailnetProxyCredentials, type TailnetStatus } from "@jagentchill/protocol";
import { createFileAccess, type FileHandle } from "./files.ts";
import { KeyStorageUnavailable, createIdentity } from "./identity.ts";
import { BridgeError, createLibraryService } from "./library.ts";
import { locateRuntime, type RuntimeCheck } from "./runtime.ts";
import { createSettings } from "./settings.ts";
import { createHostSupervisor, type HostStatus } from "./supervisor.ts";
import { createManualUpdater } from "./updates.ts";
import { connectionModeAction, shouldStartBundledHost } from "./connection-mode.ts";
import { refusesUnattendedDefaultProfile } from "./profile-guard.ts";

const DEV = !app.isPackaged;
const repoRoot = resolve(__dirname, "../../..");
const policy = {
  devToolsDisabled: process.argv.includes("--disableDevTools") || process.env.JAGENTCHILL_POLICY_DISABLE_DEVTOOLS === "1",
  // Windows and Linux have no native menu bar: the same model is shown by the application menu button inside the window.
  // The variable shows that button on macOS too, so that it can be exercised on a Mac.
  appMenuInWindow: process.platform !== "darwin" || process.env.JAGENTCHILL_FORCE_APP_MENU === "1",
};

// ───────────────────────────── identity of the app and its folders ─────────────────────────────
// A development run keeps its own name, so that it never shares a Keychain item or a user-data folder with an installed app.
// An unattended run keeps a name of its own per executable too: macOS ties a Keychain item to the binary that made
// it, and an unsigned test copy asking for another binary's item would raise a system prompt on the person's screen.
app.setName(process.env.JAGENTCHILL_UNATTENDED === "1" ? `JAgentChill Test ${createHash("sha256").update(process.execPath).digest("hex").slice(0, 8)}` : DEV ? "JAgentChill Dev" : "JAgentChill");
const defaults = desktopPaths(process.platform, process.env, homedir());
const userData = resolve(process.env.JAGENTCHILL_USER_DATA ?? (DEV ? `${defaults.userData} Dev` : defaults.userData));
if (refusesUnattendedDefaultProfile({ unattended: process.env.JAGENTCHILL_UNATTENDED === "1", userData, defaultUserData: defaults.userData })) {
  console.error("[desktop] unattended launch refused: JAGENTCHILL_USER_DATA resolves to the real default profile");
  app.exit(2);
  process.exit(2);
}
const logsDir = process.env.JAGENTCHILL_USER_DATA ? join(userData, "logs") : DEV ? `${defaults.logs} Dev` : defaults.logs;
const cacheDir = process.env.JAGENTCHILL_USER_DATA ? join(userData, "cache") : DEV ? `${defaults.cache} Dev` : defaults.cache;
const defaultLibrary = resolve(process.env.JAGENTCHILL_LIBRARY_DIR ?? (DEV ? `${defaults.library} Dev` : defaults.library));
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setPath("sessionData", join(userData, "session"));
app.setAppLogsPath(logsDir);

// The device key is protected by the real OS secret store or not stored at all: a mock key store (a switch test
// harnesses add) uses a fixed key and protects nothing, exactly like the `basic_text` backend on Linux.
if (app.commandLine.hasSwitch("use-mock-keychain")) app.commandLine.removeSwitch("use-mock-keychain");

const settings = createSettings(join(userData, "desktop.json"));
const mainLog = createRotatingLog(join(logsDir, "main.log"));
const hostLog = createRotatingLog(join(logsDir, "host.log"));
const diagnostics = createRotatingLog(join(logsDir, "diagnostics.log"));
const warn = (text: string) => mainLog.line(`[warn] ${text}`);
// A fault nobody handled is written to the app's log and the app keeps running; Electron's raw error dialog, which
// blocks the whole process until someone clicks it, is never shown.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error) => {
    const text = `[error] ${event}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    mainLog.line(text);
    diagnostics.line(text);
    console.error(text);
  });
}
// For automated runs on a developer's machine: windows are created but never shown, nothing takes the focus and no
// native message box is raised. The shipped behaviour is what runs without this variable.
const unattended = process.env.JAGENTCHILL_UNATTENDED === "1";
/**
 * A question only a person answers, asked with the system's own message box. In an unattended run no box is ever
 * raised: the answer comes from the hook the run installed in this process, or is the cancelling choice.
 */
type Question = { message: string; detail?: string; buttons: string[]; cancelId: number; type?: "question" | "warning" };
async function ask(question: Question, window?: BrowserWindow | null): Promise<number> {
  mainLog.line(`[dialog] ${question.message} [${question.buttons.join(" | ")}]`);
  if (unattended) {
    const hook = (globalThis as { __jagentchillDialog?: (question: Question) => number | Promise<number> }).__jagentchillDialog;
    return hook ? hook(question) : question.cancelId;
  }
  const options = { type: question.type ?? "question", message: question.message, detail: question.detail, buttons: question.buttons, defaultId: question.cancelId, cancelId: question.cancelId, noLink: true } as const;
  return (window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)).response;
}
const blockingError = (message: string) => { if (unattended) mainLog.line(`[error] ${message}`); else dialog.showErrorBox("JAgentChill", message); };

const launch = launchTargets(process.argv, { skip: DEV ? 2 : 1, isFile: (path) => { try { return statSync(path).isFile(); } catch { return false; } } });
if (settings.get<boolean>("gpuDisabled") === true || settings.get<boolean>("gpuInterface") === false) app.disableHardwareAcceleration();
for (const flag of gpuSwitches(process.platform, { vaapi: existsSync("/dev/dri/renderD128") })) {
  const [name, value] = flag.replace(/^--/, "").split("=");
  app.commandLine.appendSwitch(name, value);
}

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: GATEWAY_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ───────────────────────────── single instance, links and files ─────────────────────────────
const links = createHeldQueue<string>(HELD_LINKS);
const openedFiles = createHeldQueue<string>(HELD_FILES);
function acceptLink(url: string): void {
  const link = acceptDeepLink(url);
  // Rejected here, in the main process: nothing of such a URL reaches the renderer.
  if (!link.ok) return warn(`deep link dropped (${link.reason}, ${String(url).length} characters)`);
  focusRecentWindow();
  if (!links.push(link.url)) warn("deep link dropped: more than 10 are waiting");
}
function acceptFile(path: string): void {
  focusRecentWindow();
  if (!openedFiles.push(path)) warn("opened file skipped: more than 50 are waiting");
}

// A render host runs beside the app and beside other render hosts: it neither takes nor checks the lock.
if (!launch.renderHost && !app.requestSingleInstanceLock()) {
  // The first instance has received this launch's arguments; this process ends at once.
  app.exit(0);
}
app.on("second-instance", (_event, argv) => {
  const next = launchTargets(argv, { skip: 1, isFile: (path) => { try { return statSync(path).isFile(); } catch { return false; } } });
  for (const rejected of next.rejected) warn(`launch argument dropped: ${rejected}`);
  keepingHost = false;
  if (next.links.length + next.files.length === 0 || windows.size === 0) focusRecentWindow(true);
  next.links.forEach(acceptLink);
  next.files.forEach(acceptFile);
});
app.on("open-url", (event, url) => { event.preventDefault(); acceptLink(url); });
app.on("open-file", (event, path) => { event.preventDefault(); acceptFile(path); });
for (const rejected of launch.rejected) warn(`launch argument dropped: ${rejected}`);
launch.links.forEach((url) => { if (!links.push(url)) warn("deep link dropped"); });
launch.files.forEach((path) => { openedFiles.push(path); });

// ───────────────────────────── services ─────────────────────────────
const testIdentityStorageState = (): string | null => {
  const stateFile = unattended ? process.env.JAGENTCHILL_TEST_KEY_STORE_STATE_FILE : undefined;
  if (!stateFile) return null;
  try { return readFileSync(stateFile, "utf8").trim(); } catch { return "unavailable"; }
};
let delayedLegacyReadUsed = false;
const decryptLegacyStringAsync = async (data: Buffer) => {
  const state = testIdentityStorageState();
  if (state === "never") return await new Promise<never>(() => {});
  if (state === "late" && !delayedLegacyReadUsed) {
    delayedLegacyReadUsed = true;
    await new Promise<void>((done) => setTimeout(done, 21_000));
  }
  const latestState = testIdentityStorageState();
  if (latestState === "unavailable" || latestState === "decrypt-fails") throw new Error("test safeStorage decrypt denied");
  if (latestState !== null) return { result: Buffer.from(data.map((byte) => byte ^ 0xa5)).toString("utf8").replace(/^v10/, ""), shouldReEncrypt: false };
  return safeStorage.decryptStringAsync(data);
};
const identity = createIdentity({
  directory: join(userData, "identity"),
  safeStorage: {
    isEncryptionAvailable: () => {
      const state = testIdentityStorageState();
      if (state !== null) return state !== "unavailable" && state !== "decrypt-fails";
      return safeStorage.isEncryptionAvailable() && !app.commandLine.hasSwitch("use-mock-keychain");
    },
    getSelectedStorageBackend: () => (process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os"),
    encryptString: (text) => {
      if (testIdentityStorageState() !== null) return Buffer.from(Buffer.from(text, "utf8").map((byte) => byte ^ 0xa5));
      return safeStorage.encryptString(text);
    },
    decryptString: (data) => {
      const state = testIdentityStorageState();
      if (state === "decrypt-fails") throw new Error("test safeStorage decrypt denied");
      if (state !== null) return Buffer.from(data.map((byte) => byte ^ 0xa5)).toString("utf8");
      return safeStorage.decryptString(data);
    },
    decryptStringAsync: decryptLegacyStringAsync,
  },
  log: (text) => mainLog.line(`[identity] ${text}`),
  // Raised by the main process; no renderer script can answer it.
  confirmRotation: async () => {
    // Dismissed, or unanswered for 60 s: no key is made.
    const answer = await Promise.race([ask({ message: "Replace this device's key?", detail: "Every host this computer is paired with will be told the new key.", buttons: ["Replace key", "Cancel"], cancelId: 1 }), new Promise<number>((done) => setTimeout(() => done(1), 60_000))]);
    return answer === 0;
  },
});
const fileAccess = createFileAccess({ settings });
let runtimeCheck: RuntimeCheck | null = null;
const runtime = (): RuntimeCheck => (runtimeCheck ??= locateRuntime({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot, execPath: process.execPath, env: process.env }));

const windows = new Set<BrowserWindow>();
const windowMeta = new WeakMap<BrowserWindow, { id: string; route?: string; projects: Set<string> }>();
const windowHostDocument = new WeakMap<BrowserWindow, { port?: number; ready: boolean }>();
let recentWindow: BrowserWindow | null = null;
const broadcast = (event: DesktopEvent, payload?: unknown) => { for (const window of windows) if (!window.isDestroyed()) window.webContents.send(desktopChannelName(event), payload); };
const toRecent = (event: DesktopEvent, payload?: unknown) => { const window = recentWindow && !recentWindow.isDestroyed() ? recentWindow : [...windows][0]; window?.webContents.send(desktopChannelName(event), payload); };

let hostStatus: HostStatus | null = null;
type LegacyRecovery = "none" | "trying" | "needs-action" | "migrated";
let legacyRecovery: LegacyRecovery = "none";
let legacyRecoveryRunning = false;
function announceLegacyRecovery(state: LegacyRecovery): void {
  legacyRecovery = state;
  broadcast("identity.legacyRecovery", state);
}
async function attemptLegacyIdentityRecovery(): Promise<void> {
  if (!identity.hasQuarantinedLegacy() || legacyRecoveryRunning) return;
  legacyRecoveryRunning = true;
  announceLegacyRecovery("trying");
  try {
    const result = await Promise.race([
      identity.tryMigrateLegacy(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25_000)),
    ]);
    if (!result) return announceLegacyRecovery("needs-action");
    const oldTailnetKey = settings.get<string>("tailnetAuthKey");
    if (oldTailnetKey && !storedTailnetAuthKey()) {
      try {
        const decrypted = await decryptLegacyStringAsync(Buffer.from(oldTailnetKey, "base64"));
        storeTailnetAuthKey(decrypted.result);
        settings.set("tailnetAuthKey", undefined);
      } catch (error) { warn(`prior tailnet key could not be migrated: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!storedTailnetAuthKey()) {
      const migratedTailnetKey = identity.store.get("tailnet-auth-key");
      if (migratedTailnetKey) { storeTailnetAuthKey(migratedTailnetKey); identity.store.delete("tailnet-auth-key"); }
    }
    await supervisor.restoreAdmin().catch((error) => warn(`host device recovery after identity migration failed: ${error instanceof Error ? error.message : String(error)}`));
    announceLegacyRecovery("migrated");
  } catch (error) {
    warn(`prior device identity could not be recovered: ${error instanceof Error ? error.message : String(error)}`);
    announceLegacyRecovery("needs-action");
  } finally { legacyRecoveryRunning = false; }
}
const supervisor = createHostSupervisor({
  userData, identity, runtime, log: hostLog, diagnostics, mainLog, settings,
  ...((process.env.JAGENTCHILL_TSNET_BRIDGE_BIN || app.isPackaged) ? { tsnetBridgeBinary: process.env.JAGENTCHILL_TSNET_BRIDGE_BIN ?? join(process.resourcesPath, "bin", `jagentchill-tsnet-bridge${process.platform === "win32" ? ".exe" : ""}`) } : {}),
  onChange: (status) => {
    hostStatus = status;
    broadcast("gateway.status", status);
    refreshMenu();
    // The reload below must be answered with a policy that already names this host's port; the tailnet proxy port is
    // asked from the host and may take a moment, so the reload waits for it, but not for long.
    const cspSettled = Promise.race([refreshCsp(), new Promise<void>((done) => setTimeout(done, 4000))]);
    // Wait until bootstrap and the signed host channel are ready. The app:// response
    // then carries the exact-port CSP, and the renderer can discover the saved host
    // record during its initial load. Reloading keeps the current route.
    if (status.gatewayId && status.port !== undefined) {
      for (const window of windows) {
        if (window.isDestroyed()) continue;
        const document = windowHostDocument.get(window);
        if (document?.ready && document.port === status.port) continue;
        windowHostDocument.set(window, { port: status.port, ready: true });
        const reloadWhenIdle = () => setTimeout(() => {
          if (window.isDestroyed()) return;
          void window.webContents.executeJavaScript(`!!document.querySelector('[data-testid="host-switcher"][aria-expanded="true"]') || Array.from(document.querySelectorAll('[data-testid="pairing-request-popup-review"]')).some((element) => element.getClientRects().length > 0)`, true)
            .then((interactionOpen: boolean) => {
              if (interactionOpen) { reloadWhenIdle(); return; }
              mainLog.line(`[window] reload after built-in host bootstrap on port=${status.port}`);
              reloadForPolicy(window.webContents);
            })
            .catch(() => { if (!window.isDestroyed()) reloadForPolicy(window.webContents); });
        }, 150);
        void cspSettled.then(reloadWhenIdle);
      }
    }
  },
  notify: (kind) => {
    if (kind === "host.stopped" && Notification.isSupported()) new Notification({ title: "The built-in host stopped", body: "Open JAgentChill to restart it." }).show();
    if (kind === "host.repaired") broadcast("notifications.activated", { id: "host.repaired" });
  },
});
const library = createLibraryService({
  settings, defaultLibrary, cache: cacheDir,
  onStatus: (status) => broadcast("library.status", status), onMoveProgress: (progress) => broadcast("library.moveProgress", progress), onChanged: () => broadcast("library.changed"),
});

// ───────────────────────────── the app scheme, CSP and the two media schemes ─────────────────────────────
const webRoot = resolve(process.env.JAGENTCHILL_WEB_DIR ?? (app.isPackaged ? join(app.getAppPath(), "web") : join(repoRoot, ".dev", "build", "web-desktop")));
let csp = contentSecurityPolicy({});
// A reload the app makes so a document gets the current policy. A page with unsaved work answers `beforeunload`, and
// Electron then cancels the reload without a word: the window kept the policy that blocks its own host and never
// connected. Such a reload waits for the save (asks again every second) and goes through after 8 s at most.
const policyReloads = new WeakMap<Electron.WebContents, { since: number; ignoreCache: boolean }>();
/** When the person asked to close each window that is still open: a page with unsaved work answers `beforeunload`. */
const windowClosing = new WeakMap<Electron.WebContents, number>();
function reloadForPolicy(contents: Electron.WebContents, ignoreCache = false): void {
  if (contents.isDestroyed()) return;
  const pending = policyReloads.get(contents);
  policyReloads.set(contents, { since: pending?.since ?? Date.now(), ignoreCache: ignoreCache || !!pending?.ignoreCache });
  if (ignoreCache || pending?.ignoreCache) contents.reloadIgnoringCache(); else contents.reload();
}
function watchPolicyReloads(contents: Electron.WebContents): void {
  contents.on("will-prevent-unload", (event) => {
    const pending = policyReloads.get(contents);
    // The person closed the window (the X button) while the page still reports unsaved work. Electron would cancel the
    // close without a word — the X "did nothing". The save normally ends within a moment: the close is tried again for
    // 3 s, then the person decides.
    const closing = windowClosing.get(contents);
    if (!pending && closing !== undefined) {
      const window = BrowserWindow.fromWebContents(contents);
      if (Date.now() - closing < 3000) {
        setTimeout(() => { if (window && !window.isDestroyed()) window.close(); }, 400);
        return;
      }
      const question: Electron.MessageBoxSyncOptions = {
        type: "warning", buttons: ["Close anyway", "Keep open"], defaultId: 1, cancelId: 1,
        message: "JAgentChill is still saving your latest edits.", detail: "Closing now may lose the last change. Keep the window open for a moment to let the save finish.",
      };
      const answer = window ? dialog.showMessageBoxSync(window, question) : dialog.showMessageBoxSync(question);
      windowClosing.delete(contents);
      if (answer === 0) { mainLog.line("[window] closed with unsaved work after the person chose to"); event.preventDefault(); }
      return;
    }
    if (!pending) return;
    if (Date.now() - pending.since >= 8000) {
      mainLog.line("[window] reload for the connection policy goes through after 8 s of unsaved-work prompts");
      event.preventDefault();
      return;
    }
    setTimeout(() => { if (!contents.isDestroyed() && policyReloads.has(contents)) reloadForPolicy(contents); }, 1000);
  });
  contents.on("did-start-navigation", (details) => { if (details.isMainFrame && !details.isSameDocument) policyReloads.delete(contents); });
}
let cspGeneration = 0;
let cspTailnetProxyPort: number | null | undefined;
let cspProxyReloadPending = false;
function reloadForProxyCspWhenSafe(): void {
  if (!cspProxyReloadPending) return;
  const ready = BrowserWindow.getAllWindows().filter((window) => {
    if (window.isDestroyed() || !window.webContents.getURL().startsWith(`${APP_SCHEME}://`)) return false;
    try { return new URL(window.webContents.getURL()).pathname !== "/join-tailnet"; } catch { return false; }
  });
  if (!ready.length) return;
  cspProxyReloadPending = false;
  setImmediate(() => { for (const window of ready) if (!window.isDestroyed()) reloadForPolicy(window.webContents); });
}
/** `connect-src` follows the paired hosts: recomputed when a host is paired or forgotten and when the built-in host changes port. */
async function refreshCsp(proxyPortHint?: number | null): Promise<void> {
  const generation = ++cspGeneration;
  let paired: string[] = [];
  try { paired = identity.hosts().filter((host) => !host.builtIn).map((host) => host.origin); } catch { paired = []; }
  let proxyPort = proxyPortHint ?? null;
  // Before the host is asked anything: the policy names the host's own port at once. A document loaded while the
  // question below is still open would otherwise get a policy that blocks its own host, and nothing reloads it later.
  const policyFor = (port: number | null) => contentSecurityPolicy({ serverPort: hostStatus?.port, pairedOrigins: port ? [...paired, `http://127.0.0.1:${port}`] : paired, egressHosts: settings.get<string[]>("egressHosts") ?? [] });
  if (proxyPortHint === undefined) {
    csp = policyFor(cspTailnetProxyPort ?? null);
    try { proxyPort = (await tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.statusGet)).proxyPort ?? null; } catch { /* Keep the exact built-in host source while it starts. */ }
  }
  if (generation !== cspGeneration) return;
  const next = policyFor(proxyPort);
  const proxyChanged = (cspTailnetProxyPort ?? null) !== proxyPort;
  cspTailnetProxyPort = proxyPort;
  const policyChanged = next !== csp;
  csp = next;
  // CSP is attached to the document response. A newly started (or stopped) loopback proxy therefore needs a reload
  // before the renderer can dial it. Do this only on a proxy-port transition, not on routine host/identity refreshes.
  if (proxyChanged && policyChanged) { cspProxyReloadPending = true; reloadForProxyCspWhenSafe(); }
}
identity.onChange(refreshCsp);

function registerSchemes(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveAppRequest(request.url, { root: webRoot, separator: sep as "/" | "\\", isFile: (path) => { try { return statSync(path).isFile(); } catch { return false; } } });
    if (resolved.status === 404) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "content-security-policy": csp } });
    const file = await net.fetch(pathToFileURL(resolved.file).toString());
    return new Response(file.body, {
      status: 200,
      headers: {
        "content-type": resolved.mime, "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        // The cross-origin isolation the engine's shared memory needs, as on the web build.
        "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "credentialless",
        // A worker takes its policy from its own script's response: a script kept in the cache "for ever" would keep the
        // policy of the moment it was first fetched, host port and all. Documents and scripts are therefore never reused
        // from the cache without asking; they are local files, asking costs nothing.
        "cache-control": resolved.mime.startsWith("text/html") ? "no-store" : /javascript|ecmascript/.test(resolved.mime) ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  });
  // Media referenced in place: served by grant id, read-only, with byte ranges, until the grant is revoked.
  protocol.handle(FILE_SCHEME, async (request) => {
    const storage = library.storage();
    if (!storage) return new Response(null, { status: 404 });
    const answer = await storage.serveExternalFile({ url: request.url, range: request.headers.get("range") });
    const body = answer.body ? new ReadableStream<Uint8Array>({
      async start(controller) { try { for await (const chunk of answer.body!) controller.enqueue(chunk); controller.close(); } catch (error) { controller.error(error); } },
    }) : null;
    return new Response(body, { status: answer.status, headers: answer.headers });
  });
  // Bytes of a paired host: each request is signed here with the device key; no credential is ever part of a URL.
  const pinned = session.fromPartition("jagentchill-gw");
  pinned.setCertificateVerifyProc((request, callback) => {
    const host = identity.hosts().find((entry) => entry.tlsSha256 && new URL(entry.origin).hostname === request.hostname);
    if (!host) return callback(-3);
    const der = Buffer.from(request.certificate.data.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
    callback(createHash("sha256").update(der).digest("hex") === host.tlsSha256 ? 0 : -2);
  });
  protocol.handle(GATEWAY_MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const host = identity.hosts().find((entry) => entry.gatewayId === url.hostname);
    // Not paired: 404 and no connection is made anywhere.
    if (!host) return new Response(null, { status: 404 });
    const target = `${url.pathname}${url.search}`;
    if (!target.startsWith("/jagentchill/v1/") || (request.method !== "GET" && request.method !== "HEAD")) return new Response(null, { status: 404 });
    const headers: Record<string, string> = await signedHeaders(identity.signer(), host.gatewayId, request.method, target, undefined, host.verifiedClockOffset_ms);
    const range = request.headers.get("range");
    if (range) headers.range = range;
    try {
      return await (host.tlsSha256 ? pinned.fetch(host.origin + target, { method: request.method, headers }) : net.fetch(host.origin + target, { method: request.method, headers }));
    } catch { return new Response(null, { status: 502 }); }
  });
}

function hardenSession(): void {
  const defaultSession = session.defaultSession;
  // Writing an export to the file the person picked in the save dialog needs the File System Access permission. It was
  // refused by the short list, so every export to "This device" failed at its very last write and sat at 98 %. Granted
  // here for the app's own pages only; the person still chooses the file in a system dialog.
  const fileSystemAllowed = (permission: string, url: string) => permission === "fileSystem" && navigationAllowed(url);
  defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (fileSystemAllowed(permission, contents?.getURL() ?? "")) { callback(true); return; }
    const granted = permissionGranted(permission, contents?.getURL() ?? "", { userGesture: (details as { userGesture?: boolean }).userGesture ?? true });
    if (!granted) warn(`permission denied: ${permission}`);
    callback(granted);
  });
  defaultSession.setPermissionCheckHandler((_contents, permission, origin) => fileSystemAllowed(permission, origin || APP_ORIGIN) || permissionGranted(permission, origin || APP_ORIGIN, { userGesture: true }));
  if (process.platform === "linux" || process.platform === "win32") defaultSession.setSpellCheckerLanguages([app.getLocale()].filter((language) => defaultSession.availableSpellCheckerLanguages.includes(language)));
}

// ───────────────────────────── windows ─────────────────────────────
function focusRecentWindow(create = false): void {
  const window = recentWindow && !recentWindow.isDestroyed() ? recentWindow : [...windows][0];
  if (!window) { if (create && app.isReady()) createWindow(); return; }
  if (unattended) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
const uiScale = () => Math.min(settings.get<number>("uiScale") ?? 1, maxUiScale(screen.getPrimaryDisplay().workAreaSize));
const chrome = () => settings.get<{ background: string; text: string; scheme: "light" | "dark" }>("chrome") ?? (nativeTheme.shouldUseDarkColors ? { background: "#111113", text: "#ededef", scheme: "dark" as const } : { background: "#ffffff", text: "#1c2024", scheme: "light" as const });
const windowState = (window: BrowserWindow) => ({ maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() });

function createWindow(route?: string, restored?: WindowState): BrowserWindow {
  const first = windows.size === 0;
  const saved = restored ?? (first ? settings.get<WindowState>("window") : undefined);
  const displays = screen.getAllDisplays().map((display) => ({ workArea: display.workArea, primary: display.id === screen.getPrimaryDisplay().id }));
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = restoreBounds(saved, displays, { uiScale: uiScale(), active: { workArea: active.workArea } });
  const min = minimumSize(uiScale());
  const look = chrome();
  const window = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, minWidth: min.width, minHeight: min.height,
    show: false, title: "JAgentChill",
    // The theme's background before the first paint: no white flash.
    backgroundColor: look.background,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }
      : process.platform === "win32" ? { titleBarStyle: "hidden" as const, titleBarOverlay: { color: look.background, symbolColor: look.text, height: 48 } }
        : { frame: false }),
    webPreferences: { ...WEB_PREFERENCES, preload: join(__dirname, "preload.cjs"), spellcheck: true, devTools: !policy.devToolsDisabled, zoomFactor: uiScale() },
  });
  // No window carries a native menu bar: macOS has the system one, the others the app-drawn menu button.
  if (process.platform !== "darwin") window.removeMenu();
  windows.add(window);
  windowMeta.set(window, { id: String(window.id), projects: new Set() });
  windowHostDocument.set(window, { port: hostStatus?.port, ready: hostStatus?.state === "ready" });
  recentWindow = window;
  if (bounds.maximized) window.maximize();
  if (bounds.fullscreen) window.setFullScreen(true);
  const start = route ?? saved?.route;
  void window.loadURL(`${APP_ORIGIN}${start && navigationAllowed(`${APP_ORIGIN}${start}`) ? start : "/"}`);
  window.once("ready-to-show", () => {
    if (unattended) return;
    // A launch at login is hidden: no window where a tray exists, a minimised one where none does.
    if (!launch.hidden || !startingUp) window.show(); else if (hiddenLaunch(hasTray()) === "minimised") window.minimize();
  });

  const contents = window.webContents;
  watchPolicyReloads(contents);
  contents.on("did-navigate-in-page", reloadForProxyCspWhenSafe);
  contents.on("did-navigate", reloadForProxyCspWhenSafe);
  mainLog.line(`[window] ${window.id} created at ${bounds.x},${bounds.y} ${bounds.width}×${bounds.height} route=${start ?? "/"}`);
  contents.on("did-fail-load", (_event, code, description, url) => warn(`window ${window.id} failed to load ${url}: ${code} ${description}`));
  // A page whose process died leaves an empty white window. It is loaded again, unless it keeps dying: three times
  // within a minute means reloading is not the cure, and looping would only burn the machine.
  const crashes: number[] = [];
  contents.on("render-process-gone", (_event, details) => {
    warn(`window ${window.id} renderer gone: ${details.reason} exitCode=${details.exitCode} at ${contents.getURL().slice(0, 160)}`);
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const now = Date.now();
    while (crashes.length && now - crashes[0]! > 60_000) crashes.shift();
    crashes.push(now);
    if (crashes.length > 3) { warn(`window ${window.id} not reloaded: renderer died ${crashes.length} times within a minute`); return; }
    setTimeout(() => { if (!window.isDestroyed()) contents.reload(); }, 300);
  });
  // A window that stops answering is written to the log with what its page was doing, so a hang seen by a person can be
  // found afterwards instead of guessed at.
  window.on("unresponsive", () => {
    warn(`window ${window.id} stopped responding at ${contents.getURL().slice(0, 160)}`);
    const frame = contents.mainFrame as unknown as { collectJavaScriptCallStack?: () => Promise<string | undefined> };
    void frame.collectJavaScriptCallStack?.().then((stack) => { if (stack) warn(`window ${window.id} page stack: ${String(stack).slice(0, 4000)}`); }).catch(() => undefined);
  });
  window.on("responsive", () => warn(`window ${window.id} responds again`));
  contents.on("will-navigate", (event, url) => {
    if (navigationAllowed(url)) return;
    event.preventDefault();
    openExternally(url);
  });
  contents.on("will-redirect", (event, url) => { if (!navigationAllowed(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: "deny" }; });
  // The text-editing shortcuts are taken here, before the page and before the menu: on macOS they otherwise depend on the state of a
  // menu item, and a field never received ⌘A/⌘C/⌘X/⌘V/⌘Z. In a text field (or with text selected, for Copy) they are the system's
  // editing commands; anywhere else they run the editor's action of the same shortcut.
  contents.on("before-input-event", (event, input) => {
    const command = process.platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
    if (input.type !== "keyDown" || !command || input.alt) return;
    // A test's negative control: an unattended run can switch this handler off to show what happens without it.
    if (unattended && process.env.JAGENTCHILL_E2E_NO_EDIT_KEYS === "1") return;
    const key = input.key.toLowerCase();
    const edit = key === "a" && !input.shift ? ["selectAll", "selection.all"] : key === "c" && !input.shift ? ["copy", "timeline.copy"] : key === "x" && !input.shift ? ["cut", "timeline.cut"]
      : key === "v" && !input.shift ? ["paste", "timeline.paste"] : key === "z" ? (input.shift ? ["redo", "edit.redo"] : ["undo", "edit.undo"]) : key === "y" && process.platform !== "darwin" ? ["redo", "edit.redo"] : null;
    if (!edit) return;
    event.preventDefault();
    const [role, action] = edit as [("selectAll" | "copy" | "cut" | "paste" | "undo" | "redo"), string];
    void contents.executeJavaScript(`(() => { const el = document.activeElement; const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); return field || (${JSON.stringify(role)} === "copy" && String(getSelection() ?? "").length > 0) || (${JSON.stringify(role)} === "selectAll" && !!el && !!el.closest && !!el.closest("[data-select-all]")); })()`, true)
      .then((text: boolean) => { if (text) contents[role](); else invokeMenu(action); })
      .catch(() => invokeMenu(action));
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // A window whose document was answered with a policy older than the host it now has cannot reach that host, and stays
  // that way: the policy belongs to the document. When the page reports that its own host was blocked, the policy is
  // worked out again and the window loaded again; three times a minute at most, so a wrong policy cannot loop.
  const staleReloads: number[] = [];
  let staleReloadPending = false;
  contents.on("console-message", (details) => {
    // Export steps and the page's own errors go to the log, so a stall seen by the owner can be located afterwards.
    const level = String((details as { level?: unknown }).level ?? "");
    if (details.message.startsWith("[export]") || level === "error" || level === "3") mainLog.line(`[page ${level}] ${details.message.slice(0, 600)}`);
    if (!/Content Security Policy/i.test(details.message)) return;
    const port = hostStatus?.port;
    const ownHost = port !== undefined && details.message.includes(`://127.0.0.1:${port}/`);
    warn(`CSP violation: ${details.message.slice(0, 300)}${ownHost ? ` [own host; current policy ${csp.includes(`ws://127.0.0.1:${port}`) ? "allows" : "LACKS"} it]` : ""}`);
    if (!ownHost || staleReloadPending) return;
    const now = Date.now();
    while (staleReloads.length && now - staleReloads[0]! > 60_000) staleReloads.shift();
    if (staleReloads.length >= 3) return;
    staleReloads.push(now); staleReloadPending = true;
    void Promise.race([refreshCsp(), new Promise<void>((done) => setTimeout(done, 4000))]).then(() => {
      staleReloadPending = false;
      if (window.isDestroyed()) return;
      mainLog.line(`[window] ${window.id} reload: its document blocked its own host on port=${port}; policy now ${csp.includes(`ws://127.0.0.1:${port}`) ? "allows" : "LACKS"} it`);
      reloadForPolicy(contents, true);
    });
  });
  // Keys belong to the renderer's dispatcher while the page has focus: menu items show hints and register nothing.
  contents.on("focus", () => contents.setIgnoreMenuShortcuts(process.platform === "darwin"));
  contents.on("blur", () => contents.setIgnoreMenuShortcuts(false));
  if (policy.devToolsDisabled) contents.on("devtools-opened", () => contents.closeDevTools());

  const pushState = () => { if (!window.isDestroyed()) contents.send(desktopChannelName("window.state"), windowState(window)); };
  let saveTimer: NodeJS.Timeout | null = null;
  const remember = () => {
    if (window.isDestroyed() || [...windows][0] !== window) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (window.isDestroyed()) return;
      const normal = window.getNormalBounds();
      settings.set("window", { ...normal, maximized: window.isMaximized(), fullscreen: window.isFullScreen(), route: windowMeta.get(window)?.route } satisfies WindowState);
    }, 300);
  };
  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur"] as const) window.on(event as "focus", () => { pushState(); remember(); });
  window.on("move", remember);
  window.on("resize", remember);
  window.on("focus", () => { recentWindow = window; refreshMenu(); });
  let closeConfirmed = false;
  window.on("close", (event) => {
    // An export on this device belongs to the app, not to a window — but closing the last window ends the app on Windows and Linux.
    if (!closeConfirmed && !quitting && work.exports.length > 0 && windows.size === 1 && process.platform !== "darwin") {
      event.preventDefault();
      void ask({ ...exportQuestion(), type: "warning" }, window).then((answer) => { if (answer === 0) { closeConfirmed = true; window.close(); } });
      return;
    }
    if (!window.webContents.isDestroyed() && !windowClosing.has(window.webContents)) windowClosing.set(window.webContents, Date.now());
    if (saveTimer) clearTimeout(saveTimer);
    rememberWindows();
    if ([...windows][0] === window) settings.set("window", { ...window.getNormalBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen(), route: windowMeta.get(window)?.route } satisfies WindowState);
  });
  window.on("closed", () => { windows.delete(window); if (recentWindow === window) recentWindow = [...windows][0] ?? null; });
  return window;
}
const stateOf = (window: BrowserWindow): WindowState => ({ ...window.getNormalBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen(), route: windowMeta.get(window)?.route });
/** Every open window, in the order it was opened: what the next launch restores. */
function rememberWindows(): void {
  const open = [...windows].filter((window) => !window.isDestroyed());
  if (open.length) settings.set("windows", open.map(stateOf));
}
function openExternally(url: string): void {
  const decision = externalOpen(url);
  // An unattended (test) run records the link instead of handing it to the owner's browser.
  const injectedOpenerFile = process.env.JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE;
  if (decision.open && unattended && injectedOpenerFile) appendFileSync(injectedOpenerFile, `${decision.url}\n`, { mode: 0o600 });
  else if (decision.open && unattended) warn(`unattended: would open ${decision.url} in the browser`);
  else if (decision.open) void shell.openExternal(decision.url);
  else warn(`refused to open a ${decision.scheme}: URL`);
}

// ───────────────────────────── the menu ─────────────────────────────
let menuState: MenuState = {};
const MAIN_ACTIONS: Record<string, (payload?: Record<string, string>) => void> = {
  "app.quit": () => app.quit(), "window.new": () => { createWindow(); }, "window.close": () => BrowserWindow.getFocusedWindow()?.close(),
  "app.fullscreen": () => { const window = BrowserWindow.getFocusedWindow(); window?.setFullScreen(!window.isFullScreen()); },
  [DEVTOOLS_ACTION]: () => { if (!policy.devToolsDisabled) BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(); },
  "supervisor.start": () => void supervisor.setEnabled(true), "supervisor.stop": () => void supervisor.setEnabled(false), "supervisor.restart": () => void supervisor.restart(),
  "supervisor.open-logs": () => void shell.openPath(logsDir),
  "app.ui-scale.reset": () => applyUiScale(1), "app.ui-scale.in": () => applyUiScale(stepUiScale(uiScale(), 1)), "app.ui-scale.out": () => applyUiScale(stepUiScale(uiScale(), -1)),
  // The answer is shown where updates are: Settings ▸ Updates.
  "app.check-updates": () => { void updates.check(true); focusRecentWindow(true); toRecent("notifications.activated", { id: "updates", route: "/settings/updates" }); },
  "app.open": () => focusRecentWindow(true),
  "nav.open": (payload) => { focusRecentWindow(true); if (payload?.route) toRecent("notifications.activated", { id: "tray", route: payload.route }); },
};
function applyUiScale(scale: number): number {
  const next = Math.min(scale, maxUiScale(screen.getPrimaryDisplay().workAreaSize));
  settings.set("uiScale", next);
  const min = minimumSize(next);
  for (const window of windows) { window.webContents.setZoomFactor(next); window.setMinimumSize(min.width, min.height); }
  return next;
}
function invokeMenu(id: string, given?: Record<string, string>): void {
  const [action, ...rest] = id.split(":");
  let payload: Record<string, string> | undefined = given;
  const find = (items: MenuNode[]): void => { for (const node of items) { if (node.type === "separator") continue; if (node.id === id) payload = node.payload; if (node.submenu) find(node.submenu); } };
  for (const menu of currentModel()) find(menu.items);
  if (rest.length && !payload) return;
  if (MAIN_ACTIONS[action]) return MAIN_ACTIONS[action](payload);
  // Every other item is an action of the renderer's registry, run exactly as its shortcut would run it.
  const event = { action, ...(payload ? { payload } : {}), trigger: "menu" as const };
  if (windows.size === 0) {
    // With no window open the action waits for the one it opens.
    const window = createWindow();
    window.webContents.once("did-finish-load", () => setTimeout(() => { if (!window.isDestroyed()) window.webContents.send(desktopChannelName("menu.invoke"), event); }, 1500));
    return;
  }
  toRecent("menu.invoke", event);
}
const currentModel = () => buildMenuModel({
  ...menuState, devToolsDisabled: policy.devToolsDisabled,
  host: { label: `Host: ${hostStatus?.label ?? "Stopped"}`, running: !!hostStatus && !["stopped", "failed"].includes(hostStatus.state), available: runtime().ok },
  editorForeground: windows.size === 0 ? false : menuState.editorForeground,
});
function refreshMenu(): void {
  const model = menuFor(currentModel(), process.platform);
  // The in-window menu is the Windows and Linux rendering of the model, whatever system shows it.
  broadcast("menu.model", policy.appMenuInWindow && process.platform === "darwin" ? menuFor(currentModel(), "linux") : model);
  refreshTray();
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  const ROLE_ACCELERATORS: Record<string, string> = { undo: "CmdOrCtrl+Z", redo: "Shift+CmdOrCtrl+Z", cut: "CmdOrCtrl+X", copy: "CmdOrCtrl+C", paste: "CmdOrCtrl+V", selectAll: "CmdOrCtrl+A" };
  const native = (node: MenuNode): MenuItemConstructorOptions => {
    if (node.type === "separator") return { type: "separator" };
    if (node.submenu) return { label: node.label, submenu: node.submenu.map(native), enabled: node.enabled !== false };
    const focusedField = () => BrowserWindow.getFocusedWindow()?.webContents;
    // A text-editing item is never disabled: a disabled item swallows its shortcut, and ⌘C/⌘V/⌘X/⌘A/⌘Z must reach the chat box and every other field
    // whatever the editor's selection is. With nothing to act on in the editor, the editor's own action is a no-op.
    const textEditing = !!node.role && node.role in ROLE_ACCELERATORS;
    const base: MenuItemConstructorOptions = { label: node.label, enabled: textEditing || node.enabled !== false, ...(node.checked !== undefined ? { type: "checkbox", checked: node.checked } : {}) };
    if (node.role && !node.action) return { ...base, role: node.role === "windowMenu" ? undefined : (node.role as MenuItemConstructorOptions["role"]), ...(node.role === "windowMenu" ? { role: "window" as never } : {}) };
    // The hint is display text. Only what the system must own with no window focused gets a real accelerator.
    const real = node.action !== undefined && NATIVE_ACCELERATOR_ACTIONS.includes(node.action);
    return {
      ...base,
      // The text-editing items (undo … select all) own their shortcut: on macOS ⌘C/⌘V/⌘X/⌘A/⌘Z reach a text field only through the menu.
      ...(node.role && ROLE_ACCELERATORS[node.role] ? { accelerator: ROLE_ACCELERATORS[node.role], registerAccelerator: false }
        : node.hint ? { accelerator: acceleratorOf(node.hint), registerAccelerator: real } : {}),
      click: (_item, window) => {
        const contents = (window as BrowserWindow | undefined)?.webContents ?? focusedField();
        if (!node.role || !contents) return invokeMenu(node.id);
        // In a text field (or with text selected, for Copy) the item is the system's own editing command; elsewhere it is the editor's action.
        void contents.executeJavaScript(`(() => { const el = document.activeElement; const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); return field || (${JSON.stringify(node.role)} === "copy" && String(getSelection() ?? "").length > 0); })()`, true)
          .then((text: boolean) => {
            if (!text) return invokeMenu(node.id);
            const role = node.role as "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
            if (typeof contents[role] === "function") contents[role]();
          })
          .catch(() => invokeMenu(node.id));
      },
    };
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(model.map((menu) => ({ label: menu.label.replace("&", ""), ...(menu.id === "window" ? { role: "windowMenu" as const } : {}), submenu: menu.items.map(native) }))));
}

// ───────────────────────────── background: running work, the tray, launch at login ─────────────────────────────
/** What is running on this computer, as the windows report it: on-device exports, host jobs, and what waits for the user. */
let work: { exports: TrayTask[]; jobs: TrayTask[]; attention: TrayTask[]; unsavedProjects: number } = { exports: [], jobs: [], attention: [], unsavedProjects: 0 };
let startingUp = true;
let tray: Tray | null = null;
let linuxTray: boolean | null = null;
let backgroundNotification: Notification | null = null;
const exportQuestion = (): Question => ({ message: EXPORT_QUIT.message, detail: EXPORT_QUIT.detail, buttons: [...EXPORT_QUIT.choices], cancelId: 1 });
/** A tray exists always on macOS and Windows; on Linux only when a status-notifier watcher has a registered host. */
function hasTray(): boolean {
  if (process.platform !== "linux") return true;
  if (linuxTray === null) {
    try {
      const answer = execFileSync("gdbus", ["call", "--session", "--dest", "org.kde.StatusNotifierWatcher", "--object-path", "/StatusNotifierWatcher", "--method", "org.freedesktop.DBus.Properties.Get", "org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered"], { encoding: "utf8", timeout: 2000 });
      linuxTray = trayAvailable("linux", { watcherRegistered: true, hostRegistered: /true/.test(answer) });
    } catch { linuxTray = false; }
    // A tray that appears or disappears while the app runs is noticed within five seconds.
    setTimeout(() => { const before = linuxTray; linuxTray = null; if (hasTray() !== before) { refreshTray(); broadcast("background.state", backgroundState()); } }, 5000).unref();
  }
  return linuxTray;
}
const hostEnabled = () => settings.get<boolean>("builtInHost") !== false;
const keepInTray = () => hasTray() && (settings.get<boolean>("keepInTray") ?? keepInTrayDefault(process.platform, { hostEnabled: hostEnabled(), trayAvailable: hasTray() }));
const backgroundState = () => ({
  trayAvailable: hasTray(), keepInTray: keepInTray(), launchAtLogin: settings.get<boolean>("launchAtLogin") === true, keepHostAfterQuit: settings.get<boolean>("keepHostAfterQuit") === true, noTrayText: hasTray() ? null : NO_TRAY_TEXT,
  trayShown: trayShown({ hostEnabled: hostEnabled(), keepInTray: keepInTray(), trayAvailable: hasTray() }), trayState: trayState({ tasks: work.exports.length + work.jobs.length, attention: work.attention.length, hostFailed: hostStatus?.state === "failed" }),
});
/** The tray menu as it is now; each item is the registry action of the same name in the application menu. */
const trayModel = () => buildTrayMenu({
  hostLabel: hostStatus?.label ?? "Stopped", hostRunning: !!hostStatus && !["stopped", "failed"].includes(hostStatus.state), hostAvailable: runtime().ok,
  tasks: [...work.exports, ...work.jobs], attention: work.attention, translate: menuState.translate,
});
function refreshTray(): void {
  const state = backgroundState();
  // An unattended run puts nothing in the menu bar of the person at this computer.
  // While the app quits the system may already have destroyed the tray: touching it again throws "Tray is destroyed".
  if (quitting) return;
  if (tray?.isDestroyed()) tray = null;
  if (!state.trayShown || unattended || !app.isReady()) { tray?.destroy(); tray = null; return; }
  const icon = nativeImage.createFromPath(join(__dirname, "..", "build", `tray-${state.trayState}${process.platform === "darwin" ? "Template" : ""}.png`));
  if (process.platform === "darwin") icon.setTemplateImage(true);
  if (!tray) { tray = new Tray(icon); tray.on("click", () => { if (process.platform !== "darwin") focusRecentWindow(true); }); }
  tray.setImage(icon);
  const status = trayModel()[0];
  tray.setToolTip(`JAgentChill — ${status.type === "separator" ? "" : status.label}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayModel().map((item) => (item.type === "separator" ? { type: "separator" as const } : { label: item.label, enabled: item.enabled !== false && item.action !== undefined, click: () => invokeMenu(item.action!, item.payload) }))));
}
/** "Launch at login" starts the app hidden, registered the way each system does it. */
function setLaunchAtLogin(on: boolean): void {
  settings.set("launchAtLogin", on);
  if (unattended) return void mainLog.line(`[background] launch at login ${on ? "on" : "off"}: not registered with the system in an unattended run`);
  if (process.platform === "linux") {
    const file = linuxRegistrationFiles(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), process.env.XDG_CONFIG_HOME || join(homedir(), ".config")).autostart;
    if (!on) return rmSync(file, { force: true });
    mkdirSync(dirname(file), { recursive: true });
    return writeFileSync(file, linuxDesktopEntry(process.env.APPIMAGE || process.execPath, { hidden: true, autostart: true }));
  }
  // macOS: the login-items API. Windows: the value under HKCU\…\CurrentVersion\Run.
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
}
/** While the app runs with no window and no tray, a persistent notification is its visible surface. */
function showBackgroundNotice(): void {
  if (unattended || !Notification.isSupported()) return void mainLog.line(`[background] ${backgroundNotice(work.jobs.length)}`);
  backgroundNotification?.close();
  backgroundNotification = new Notification({ title: backgroundNotice(work.jobs.length), timeoutType: "never", actions: [{ type: "button", text: "Open" }, { type: "button", text: "Quit" }] });
  backgroundNotification.on("click", () => focusRecentWindow(true));
  backgroundNotification.on("action", (_event, index) => (index === 0 ? focusRecentWindow(true) : app.quit()));
  backgroundNotification.show();
}
/**
 * Quit, asked by a person. An export on this device is confirmed first; host jobs offer to keep the host running.
 * Resolves `true` when the app is to end now.
 */
async function confirmQuit(): Promise<boolean> {
  if (work.exports.length > 0 && (await ask({ ...exportQuestion(), type: "warning" })) !== 0) return false;
  if (work.jobs.length === 0) return true;
  const question = quitChoices({ jobs: work.jobs.length, trayAvailable: hasTray() });
  const answer = await ask({ message: question.message, buttons: question.choices, cancelId: 2 });
  if (answer === 1) return true;
  if (answer === 0) {
    // The windows close; the process, the server and its Gateway stay. The next launch re-attaches through the single-instance lock.
    rememberWindows();
    keepingHost = true;
    for (const window of [...windows]) window.destroy();
    if (!hasTray()) showBackgroundNotice();
    mainLog.line("[background] the host keeps running without a window");
  }
  return false;
}
let keepingHost = false;

// ───────────────────────────── updates ─────────────────────────────
type UpdateState = {
  mode: "auto" | "manual" | "link" | "off"; status: "idle" | "checking" | "available" | "downloading" | "ready" | "downloaded" | "error" | "up-to-date";
  version?: string; progress?: number; error?: string; downloadUrl?: string; installOnQuit?: boolean; currentVersion: string;
  /** Link mode: a package manager owns this install (a Linux package that is not an AppImage). */
  managed?: boolean;
  /** Manual mode: the verified package, waiting in its folder for the person to open. */
  file?: string; lastChecked_ms?: number; autoCheck: boolean; autoDownload: boolean;
  /** Manual mode: what failed — reaching or reading the feed, the download, or the check of the downloaded file. */
  reason?: "unreachable" | "feed" | "verification" | "download";
};
const updates = (() => {
  const feed = process.env.JAGENTCHILL_UPDATE_FEED ?? (app.isPackaged ? (() => { try { return feedUrlOfAppUpdate(readFileSync(join(process.resourcesPath, "app-update.yml"), "utf8")) ?? ""; } catch { return ""; } })() : "");
  const writable = (() => { try { return app.isPackaged ? !process.execPath.startsWith("/usr/") && !process.execPath.startsWith("/opt/") : false; } catch { return false; } })();
  // macOS applies an update only to a signed app; what this build is, is read from the bundle itself.
  const macSigned = feed && app.isPackaged && process.platform === "darwin"
    ? (() => { const result = spawnSync("codesign", ["-dv", "--verbose=2", resolve(process.execPath, "../../..")], { encoding: "utf8", timeout: 10_000 }); return macCanSelfUpdate({ status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }); })()
    : undefined;
  const mode = feed ? updateMode({ platform: process.platform, packaged: app.isPackaged, appImage: !!process.env.APPIMAGE, writable, macSigned, feedGiven: true }) : "off";
  const options = () => ({ autoCheck: settings.get<boolean>("updateAutoCheck") !== false, autoDownload: settings.get<boolean>("updateAutoDownload") !== false });
  let state: UpdateState = {
    mode, status: "idle", currentVersion: app.getVersion(), ...options(), ...(mode === "link" && app.isPackaged && process.platform === "linux" && !process.env.APPIMAGE ? { managed: true } : {}), ...(settings.get<string>("downloadUrl") ? { downloadUrl: settings.get<string>("downloadUrl") } : {}),
    ...(settings.get<number>("updateLastCheck_ms") ? { lastChecked_ms: settings.get<number>("updateLastCheck_ms") } : {}),
  };
  let blockers: string[] = [];
  let updater: typeof import("electron-updater").autoUpdater | null = null;
  let remindTimer: NodeJS.Timeout | null = null;
  const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; broadcast("updates.state", state); };
  const checked = () => { const now = Date.now(); settings.set("updateLastCheck_ms", now); return { lastChecked_ms: now }; };
  // A build that cannot replace itself finds, downloads and verifies the new package and leaves it for the person to open.
  const manual = mode === "manual" ? createManualUpdater({
    feedUrl: feed, platform: process.platform, arch: process.arch, currentVersion: app.getVersion(), dir: join(userData, "updates"), log: (line) => mainLog.line(line),
    onState: (next) => set({ error: undefined, reason: undefined, progress: undefined, ...next, ...(next.status === "error" || next.status === "downloading" ? {} : checked()) }),
  }) : null;
  async function load() {
    if (updater || mode === "off" || mode === "manual") return updater;
    updater = (await import("electron-updater")).autoUpdater;
    if (process.env.JAGENTCHILL_UPDATE_FEED) updater.setFeedURL({ provider: "generic", url: feed });
    updater.autoDownload = mode === "auto" && options().autoDownload;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.on("checking-for-update", () => set({ status: "checking", error: undefined }));
    updater.on("update-not-available", () => set({ status: "up-to-date", ...checked() }));
    // An install the app cannot replace is given the address of the published package, to open in the browser.
    const published = (info: { path?: string; files?: { url: string }[] }) => { const base = feedBase(feed), file = info.files?.[0]?.url ?? info.path; const url = mode === "link" && base && file ? feedFileUrl(base, file) : null; return url ? { downloadUrl: url } : {}; };
    updater.on("update-available", (info) => set({ status: updater!.autoDownload ? "downloading" : "available", version: info.version, ...published(info), ...checked() }));
    updater.on("download-progress", (progress) => set({ status: "downloading", progress: Math.round(progress.percent) }));
    // electron-updater has verified the publisher signature and the feed's SHA-512 before this event.
    updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
    updater.on("error", (error) => { warn(`update error: ${error.message}`); set({ status: "error", error: error.message }); });
    return updater;
  }
  return {
    state: () => state,
    async check(byPerson = false) {
      // Without a feed there is nothing to ask, and the app does not claim to be up to date.
      if (mode === "off") return state;
      if (!byPerson && !options().autoCheck) return state;
      if (manual) {
        if (state.status === "checking" || state.status === "downloading") return state;
        set({ status: "checking", error: undefined });
        const result = await manual.check();
        if (result.status === "available" && options().autoDownload) void manual.download();
        return state;
      }
      await (await load())?.checkForUpdates().catch((error: Error) => set({ status: "error", error: error.message }));
      return state;
    },
    // Also "Try again" after a download that failed: the version the last check found is fetched from the start.
    async download() { if (manual) { if (state.status === "available" || (state.status === "error" && (state.reason === "download" || state.reason === "verification"))) void manual.download(); return; } await (await load())?.downloadUpdate(); },
    /** Manual mode: shows the downloaded package in its folder. An unattended run opens nothing and records the path. */
    reveal() {
      if (state.status !== "downloaded" || !state.file) return { shown: false };
      if (unattended) { mainLog.line(`[reveal] ${state.file}`); return { shown: false, file: state.file }; }
      shell.showItemInFolder(state.file);
      return { shown: true, file: state.file };
    },
    /** "Restart to update": never while work would be lost — then the update installs at the next quit. */
    async install() {
      if (state.status !== "ready") return { restarted: false, blockers: [] as string[] };
      if (blockers.length) { set({ installOnQuit: true }); return { restarted: false, blockers }; }
      await supervisor.dispose();
      (await load())?.quitAndInstall(false, true);
      return { restarted: true, blockers: [] as string[] };
    },
    remindLater() { if (remindTimer) clearTimeout(remindTimer); remindTimer = setTimeout(() => broadcast("updates.state", state), UPDATE_REMIND_MS); },
    setOptions(next: { autoCheck?: boolean; autoDownload?: boolean }) {
      if (next.autoCheck !== undefined) settings.set("updateAutoCheck", next.autoCheck);
      if (next.autoDownload !== undefined) { settings.set("updateAutoDownload", next.autoDownload); if (updater) updater.autoDownload = mode === "auto" && next.autoDownload; }
      set(options());
    },
    setBlockers(input: Parameters<typeof restartBlockers>[0]) { blockers = restartBlockers(input); },
    schedule() {
      if (mode === "off") return;
      setTimeout(() => void this.check(), UPDATE_FIRST_CHECK_MS);
      setInterval(() => void this.check(), UPDATE_INTERVAL_MS);
    },
  };
})();

// ───────────────────────────── IPC: an allowlist, a checked sender and checked arguments ─────────────────────────────
const failure = (error: unknown): DesktopReply => {
  if (error instanceof BridgeError) return { ok: false, error: { code: error.code, message: error.message, ...(error.kind ? { kind: error.kind } : {}), ...(error.details ? { details: error.details } : {}) } };
  if (error instanceof SignRefused) return { ok: false, error: { code: SIGN_REFUSED, message: error.message } };
  if (error instanceof KeyStorageUnavailable) return { ok: false, error: { code: error.code, message: error.message, details: { choices: [...KEY_STORAGE_CHOICES], confirmation: KEY_FILE_CONFIRMATION } } };
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "INTERNAL";
  if (code === "INTERNAL") warn(`ipc failure: ${error instanceof Error ? error.stack : String(error)}`);
  return { ok: false, error: { code, message: code === "INTERNAL" ? "The request failed" : (error as Error).message } };
};
function handle(channel: DesktopChannel, run: (args: any[], event: IpcMainInvokeEvent, window: BrowserWindow | null) => unknown): void {
  ipcMain.handle(desktopChannelName(channel), async (event, ...args): Promise<DesktopReply> => {
    // The caller must be a frame of the app itself.
    if (!senderAllowed(event.senderFrame?.url)) {
      warn(`ipc ${channel} refused: sender ${String(event.senderFrame?.url).slice(0, 80)}`);
      return { ok: false, error: { code: "IPC_FORBIDDEN", message: "This caller may not use the bridge" } };
    }
    const parsed = DESKTOP_CHANNEL_ARGS[channel].safeParse(args);
    if (!parsed.success) {
      warn(`ipc ${channel} refused: arguments do not match`);
      // The signer's one answer to anything it does not know.
      return { ok: false, error: channel === "device.sign" ? { code: SIGN_REFUSED, message: "The signer accepts structured input only" } : { code: "INVALID_PARAMS", message: `The arguments of ${channel} are not valid` } };
    }
    try { return { ok: true, value: await run(parsed.data as any[], event, BrowserWindow.fromWebContents(event.sender)) }; } catch (error) { return failure(error); }
  });
}
const windowOf = (contents: WebContents) => BrowserWindow.fromWebContents(contents);
const unavailable = (what: string) => new BridgeError("UNSUPPORTED_FEATURE", `${what}: Unavailable — reinstall JAgentChill`, { details: { reason: "helper_missing" } });
const sleepBlocks = new Map<string, number>();
const tailnetCall = async <T,>(method: string, payload: unknown = {}): Promise<T> => supervisor.callHost<T>(method, payload);
async function tailnetCallWhenHostReady<T>(method: string, payload: unknown = {}): Promise<T> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { return await tailnetCall<T>(method, payload); }
    catch (error) {
      if (!(error instanceof BridgeError) || error.code !== "UNAVAILABLE") throw error;
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError ?? new BridgeError("UNAVAILABLE", "The built-in host is not connected.");
}
function storedTailnetAuthKey(): string | null {
  try { return readFileSync(join(userData, "tailnet-auth-key"), "utf8"); } catch { return null; }
}
function storeTailnetAuthKey(authKey: string): void {
  const file = join(userData, "tailnet-auth-key"), temp = `${file}.tmp`;
  writeFileSync(temp, authKey, { mode: 0o600 });
  if (process.platform === "win32") {
    execFileSync("icacls", [temp, "/inheritance:r", "/grant:r", `${process.env.USERNAME ?? ""}:(F)`], { windowsHide: true, stdio: "ignore" });
  } else chmodSync(temp, 0o600);
  renameSync(temp, file);
}
async function ensureTailnetForMode(): Promise<TailnetStatus> {
  await supervisor.start();
  const authKey = storedTailnetAuthKey();
  if (authKey) return tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.authKeyJoin, { authKey });
  const status = await tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.statusGet);
  return status.enabled ? status : tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.loginStart);
}
let connectionModeTransition: Promise<void> = Promise.resolve();
function setConnectionMode(mode: "tailscale" | "local" | null): Promise<void> {
  const transition = connectionModeTransition.catch(() => undefined).then(async () => {
    const previous = settings.get<"tailscale" | "local">("connectionMode") ?? null;
    if (mode === null) {
      if (previous === "tailscale" && settings.get<boolean>("builtInHost") !== false) {
        await tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.disable).catch(() => undefined);
      }
      settings.set("tailnetAuthKey", undefined);
      rmSync(join(userData, "tailnet-auth-key"), { force: true });
      settings.set("connectionMode", null);
      await supervisor.stop();
      // Removing the connection signs this computer out for real: with the node's saved Tailscale identity left on
      // disk, "Sign in with Tailscale" would simply resume it and never ask anyone to sign in.
      rmSync(join(supervisor.dataDir, "tailscale"), { recursive: true, force: true });
      return;
    }
    settings.set("connectionMode", mode);
    const action = connectionModeAction(previous, mode);
    if (action !== "none" && settings.get<boolean>("builtInHost") !== false) {
      if (action === "start") await supervisor.start();
      else await supervisor.restart();
      if (mode === "tailscale") await ensureTailnetForMode();
    }
  });
  connectionModeTransition = transition;
  return transition;
}
async function waitForTailnetLoginUrl(): Promise<TailnetStatus> {
  const deadline = Date.now() + 30_000;
  let latest = await tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.statusGet);
  while (!latest.connected && !latest.loginUrl && !latest.unavailableReason && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    latest = await tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.statusGet);
  }
  if (latest.loginUrl) openExternally(latest.loginUrl);
  return latest;
}

function registerIpc(): void {
  ipcMain.on(desktopChannelName("app.info"), (event) => {
    event.returnValue = senderAllowed(event.senderFrame?.url) ? { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, devToolsDisabled: policy.devToolsDisabled, appMenuInWindow: policy.appMenuInWindow } : null;
  });
  handle("app.info", () => ({ library: library.status().state === "opening" ? defaultLibrary : (library.status() as { path: string }).path, logs: logsDir, userData, cache: cacheDir }));
  handle("app.relaunch", async () => { await supervisor.dispose(); app.relaunch(); app.exit(0); });
  handle("app.quit", () => app.quit());

  handle("window.minimize", (_a, _e, window) => window?.minimize());
  handle("window.maximize", (_a, _e, window) => (window?.isMaximized() ? window.unmaximize() : window?.maximize()));
  handle("window.close", (_a, _e, window) => window?.close());
  handle("window.setFullscreen", ([on], _e, window) => window?.setFullScreen(on));
  handle("window.new", ([route]) => { createWindow(route); });
  handle("window.state", (_a, _e, window) => (window ? windowState(window) : { maximized: false, fullscreen: false, focused: false }));
  handle("window.controls", () => {
    let layout: string | null = null;
    if (process.platform === "linux") { try { layout = execFileSync("gsettings", ["get", "org.gnome.desktop.wm.preferences", "button-layout"], { encoding: "utf8", timeout: 2000 }).trim(); } catch { layout = null; } }
    return { ...controlsLayout(process.platform, { linuxButtonLayout: layout }), platform: process.platform, uiScale: uiScale(), maxUiScale: maxUiScale(screen.getPrimaryDisplay().workAreaSize) };
  });
  handle("window.setUiScale", ([scale]) => applyUiScale(scale));
  handle("window.setChrome", ([look]) => {
    settings.set("chrome", look);
    nativeTheme.themeSource = look.scheme;
    for (const window of windows) { window.setBackgroundColor(look.background); if (process.platform === "win32") window.setTitleBarOverlay({ color: look.background, symbolColor: look.text }); }
  });
  handle("window.setRoute", ([route], _e, window) => { if (window) windowMeta.get(window)!.route = route; });
  // A project is open for editing in one window: a second window that asks is refused and the first comes to the front.
  handle("window.claimProject", ([projectId], _e, window) => {
    for (const other of windows) if (other !== window && windowMeta.get(other)?.projects.has(projectId)) { if (other.isMinimized()) other.restore(); other.focus(); return { claimed: false }; }
    if (window) windowMeta.get(window)!.projects.add(projectId);
    return { claimed: true };
  });
  handle("window.releaseProject", ([projectId], _e, window) => { if (window) windowMeta.get(window)!.projects.delete(projectId); });

  handle("gateway.status", () => supervisor.status());
  handle("gateway.getLegacyIdentityRecovery", () => legacyRecovery);
  handle("gateway.retryLegacyIdentity", () => attemptLegacyIdentityRecovery());
  handle("connectionMode.get", () => settings.get<"tailscale" | "local">("connectionMode") ?? null);
  handle("connectionMode.set", ([mode]) => setConnectionMode(mode));
  handle("gateway.start", () => supervisor.setEnabled(true));
  handle("gateway.stop", () => supervisor.setEnabled(false));
  handle("gateway.restart", () => supervisor.restart());
  handle("gateway.doctor", () => supervisor.repair());
  handle("gateway.openLogs", () => { void shell.openPath(logsDir); });
  handle("gateway.setEnabled", ([on]) => supervisor.setEnabled(on));
  handle("gateway.getNetworkAccess", () => ({
    level: "this-computer", levels: [
      { id: "this-computer", label: "This computer only", available: true },
      { id: "tailnet", label: "Tailnet", available: false, unavailable: "Unavailable — reinstall JAgentChill" },
      { id: "lan", label: "Local network (encrypted)", available: false, unavailable: "Unavailable — reinstall JAgentChill" },
    ],
  }));
  handle("gateway.setNetworkAccess", ([change]) => { if (change.level !== "this-computer") throw unavailable(change.level === "tailnet" ? "Tailnet" : "Local network (encrypted)"); return { level: "this-computer" }; });
  handle("gateway.restoreAdmin", async ([{ confirmation }]) => {
    if (confirmation !== "RESTORE") throw new BridgeError("INVALID_PARAMS", "Type RESTORE to confirm");
    await supervisor.restoreAdmin();
  });
  handle("gateway.resetConfiguration", async ([{ confirmation }]) => {
    if (confirmation !== "RESET") throw new BridgeError("INVALID_PARAMS", "Type RESET to confirm");
    return supervisor.resetConfiguration();
  });
  handle("gateway.setPort", async ([port]) => { settings.set("hostPort", port); settings.set("hostPorts", undefined); await supervisor.restart(); });
  // The three choices of the KEY_STORAGE_UNAVAILABLE dialog, and "Move the key to the system store".
  handle("gateway.resolveKeyStorage", async ([choice, options]) => {
    if (choice === "cancel") return { keyProtection: identity.keyProtection, localOnly: true };
    if (choice === "file") {
      if (options?.confirmed !== true) throw new BridgeError("INVALID_PARAMS", KEY_FILE_CONFIRMATION);
      identity.createInFile(true);
    } else if (choice === "move-to-store") identity.moveToStore();
    else identity.ensureKey();
    // The key exists now: the host starts without a relaunch.
    void supervisor.start();
    return { keyProtection: identity.keyProtection, localOnly: false };
  });

  handle("tailnet.getStatus", async () => { const status = await tailnetCall<TailnetStatus>(TAILNET_METHODS.statusGet); await refreshCsp(); return status; });
  handle("tailnet.getProxyCredentials", async () => {
    const credentials = await tailnetCall<TailnetProxyCredentials | null>(TAILNET_METHODS.proxyCredentials);
    await refreshCsp(credentials?.port ?? null);
    return credentials;
  });
  handle("tailnet.startLogin", async ([options]) => {
    await connectionModeTransition.catch(() => undefined);
    if (settings.get<"tailscale" | "local">("connectionMode") !== "tailscale") {
      const previous = settings.get<"tailscale" | "local">("connectionMode") ?? null;
      settings.set("connectionMode", "tailscale");
      if (connectionModeAction(previous, "tailscale") === "start") await supervisor.start();
      else await supervisor.restart();
    } else await supervisor.start();
    if (options.mode === "authKey") {
      const authKey = options.authKey?.trim();
      if (!authKey) throw new BridgeError("INVALID_PARAMS", "A Tailscale auth key is required.");
      if (!safeStorage.isEncryptionAvailable()) throw new BridgeError("UNAVAILABLE", "The system secure store is unavailable.");
      // Store only the OS-encrypted secret. The raw key is forwarded through the host method and is never logged.
      storeTailnetAuthKey(authKey);
      return tailnetCallWhenHostReady<TailnetStatus>(TAILNET_METHODS.authKeyJoin, { authKey });
    }
    await ensureTailnetForMode();
    return waitForTailnetLoginUrl();
  });
  handle("tailnet.logout", async () => {
    settings.set("tailnetAuthKey", undefined);
    return tailnetCall<TailnetStatus>(TAILNET_METHODS.disable);
  });
  handle("tailnet.openProxy", () => { throw unavailable("Tailnet"); });
  handle("tailnet.closeProxy", () => undefined);

  handle("library.call", ([method, args]) => library.call(method, args));
  handle("library.readRange", ([method, args, range]) => library.readRange(method, args, range));
  handle("library.uploadOpen", () => library.uploadOpen());
  handle("library.uploadWrite", ([id, bytes]) => library.uploadWrite(id, bytes));
  handle("library.uploadAbort", ([id]) => library.uploadAbort(id));
  handle("library.release", ([id]) => library.release(id));
  handle("library.status", () => library.status());
  handle("library.retry", async () => { await library.open(); return library.status(); });
  handle("library.createHere", async () => { await library.createHere(); return library.status(); });
  const chooseFolder = async (window: BrowserWindow | null, title: string): Promise<string | null> => {
    const result = await dialog.showOpenDialog(window!, { title, properties: ["openDirectory", "createDirectory"], defaultPath: fileAccess.lastDirectory("library") });
    if (result.canceled || !result.filePaths[0]) return null;
    fileAccess.remember("library", result.filePaths[0]);
    return result.filePaths[0];
  };
  handle("library.locate", async (_a, _e, window) => {
    const folder = await chooseFolder(window, "Locate library…");
    if (folder) await library.useFolder(folder);
    return library.status();
  });
  handle("library.chooseMoveTarget", async (_a, _e, window) => {
    const folder = await chooseFolder(window, "Move project library");
    return folder ? fileAccess.register(folder) : null;
  });
  handle("library.move", ([token]) => library.move(fileAccess.pathOf(token)));
  handle("library.cancelMove", () => library.cancelMove());
  handle("library.rebuildIndex", () => library.rebuildIndex());

  handle("files.openDialog", async ([options], _e, window) => {
    const result = await dialog.showOpenDialog(window!, {
      title: options.title, defaultPath: fileAccess.lastDirectory(options.purpose), filters: options.filters,
      properties: [options.directory ? "openDirectory" : "openFile", ...(options.multiple ? ["multiSelections" as const] : [])],
    });
    if (result.canceled) return [];
    if (result.filePaths[0]) fileAccess.remember(options.purpose, result.filePaths[0]);
    return result.filePaths.map((path) => fileAccess.register(path));
  });
  handle("files.saveDialog", async ([options], _e, window) => {
    const directory = fileAccess.lastDirectory(options.purpose) ?? app.getPath(options.purpose === "export" ? "videos" : "documents");
    // Overwriting an existing file is confirmed by the system dialog itself.
    const result = await dialog.showSaveDialog(window!, { title: options.title, defaultPath: join(directory, options.defaultName), filters: options.filters, properties: ["createDirectory", "showOverwriteConfirmation"] });
    if (result.canceled || !result.filePath) return null;
    fileAccess.remember(options.purpose, result.filePath);
    return fileAccess.register(result.filePath);
  });
  handle("files.reveal", ([target]) => {
    if (target === "logs") return void shell.openPath(logsDir);
    if (target === "configuration") return void shell.openPath(supervisor.dataDir);
    if (target === "library") return void shell.openPath((library.status() as { path?: string }).path ?? defaultLibrary);
    shell.showItemInFolder(fileAccess.pathOf(target));
  });
  handle("files.read", ([token, range]) => fileAccess.read(token, range));
  handle("files.stat", ([token]) => fileAccess.stat(token));
  handle("files.exportOpen", ([token, options]) => fileAccess.exportOpen(token, options?.estimatedBytes));
  handle("files.exportWrite", ([token, bytes]) => fileAccess.exportWrite(token, bytes));
  handle("files.exportFinish", ([token]) => fileAccess.exportFinish(token));
  handle("files.exportAbort", ([token]) => fileAccess.exportAbort(token));
  const needStorage = () => { const storage = library.storage(); if (!storage) throw new BridgeError("STORAGE", "The project library is not open", { kind: "Unavailable" }); return storage; };
  handle("files.grant", ([{ projectId, assetId, token }]) => needStorage().grantExternalFile(projectId, assetId, fileAccess.pathOf(token)));
  handle("files.revokeGrant", ([grantId]) => needStorage().revokeGrant(grantId));
  handle("files.relink", async ([{ projectId, assetId, name }], _e, window) => {
    const result = await dialog.showOpenDialog(window!, { title: `Relink "${name}"`, defaultPath: fileAccess.lastDirectory("relink"), properties: ["openFile"] });
    if (result.canceled || !result.filePaths[0]) return null;
    fileAccess.remember("relink", result.filePaths[0]);
    return { ...(await needStorage().grantExternalFile(projectId, assetId, result.filePaths[0])), file: fileAccess.register(result.filePaths[0]) };
  });
  handle("files.registerDropped", ([paths]) => (paths as string[]).filter((path) => existsSync(path)).map((path) => fileAccess.register(path)));
  handle("files.expandDrop", ([tokens]) => fileAccess.expand(tokens));
  handle("files.freeSpace", ([token]) => fileAccess.freeSpace(token ? fileAccess.pathOf(token) : (library.status() as { path?: string }).path ?? defaultLibrary));
  handle("files.startDrag", async ([target], event) => {
    // Dragging an export or a library asset to the file manager copies the file itself.
    let file: string;
    if (typeof target === "string") file = fileAccess.pathOf(target);
    else {
      const info = await needStorage().mediaInfo(target.projectId, target.assetId);
      if (!info) throw new BridgeError("NOT_FOUND", "No such asset");
      file = join(needStorage().library, target.projectId, "media", `${target.assetId}${info.extension ? `.${info.extension}` : ""}`);
    }
    event.sender.startDrag({ file, icon: join(__dirname, "..", "build", "drag.png") });
  });
  const handles = (paths: string[]): FileHandle[] => paths.map((path) => fileAccess.register(path));
  let filesOff: (() => void) | null = null;
  handle("files.ready", () => {
    filesOff?.();
    // Everything that arrived before the UI was ready goes out as one batch; later files one by one.
    let batch: string[] | null = [];
    filesOff = openedFiles.subscribe((path) => { if (batch) batch.push(path); else toRecent("files.open", { files: handles([path]), skipped: 0 }); });
    const first = batch;
    batch = null;
    const skipped = openedFiles.takeSkipped();
    if (first.length || skipped) toRecent("files.open", { files: handles(first), skipped });
  });

  handle("device.getPublicKey", () => identity.publicInfo());
  handle("device.sign", ([input]) => identity.sign(input));
  handle("device.beginEnrolment", async ([offer, origin, proxy]) => {
    if (proxy) {
      const active = await tailnetCall<TailnetProxyCredentials | null>(TAILNET_METHODS.proxyCredentials);
      if (!active || active.port !== proxy.port || active.secret !== proxy.secret) throw new BridgeError("PERMISSION_DENIED", "The tailnet proxy is no longer available.");
    }
    return identity.beginEnrolment(offer, origin, proxy);
  });
  handle("device.endEnrolment", () => identity.endEnrolment());
  handle("device.enrolmentPost", ([step, json]) => identity.enrolmentPost(step, json));
  handle("secureStore.get", ([key]) => identity.store.get(key));
  handle("secureStore.set", ([key, value]) => identity.store.set(key, value));
  handle("secureStore.delete", ([key]) => {
    // The record of this computer's own host belongs to the supervisor.
    if (identity.hosts().some((host) => host.builtIn && `host/${host.gatewayId}` === key)) throw new BridgeError("PERMISSION_DENIED", "The built-in host cannot be forgotten; turn it off instead");
    identity.store.delete(key);
  });
  handle("secureStore.keys", ([prefix]) => identity.store.keys(prefix));

  const shown = new Map<string, Notification>();
  handle("notifications.show", ([notification]) => {
    // An unattended run (the tests) shows nothing on the machine: the log says what would have been shown.
    const plan = notificationPlan(notification, { unattended, supported: Notification.isSupported() });
    if (!plan.show) return void mainLog.line(plan.log);
    shown.get(notification.id)?.close();
    const item = new Notification(plan.options);
    // A click focuses the app on what the notification is about.
    const activate = (index?: number) => { focusRecentWindow(true); toRecent("notifications.activated", notificationActivation(notification, index)); };
    item.on("click", () => activate());
    item.on("action", (_event, index) => activate(index));
    item.on("close", () => shown.delete(notification.id));
    shown.set(notification.id, item);
    item.show();
  });
  handle("notifications.setBadge", ([count]) => { if (!unattended) app.setBadgeCount(count); });
  handle("notifications.requestAttention", () => {
    if (BrowserWindow.getFocusedWindow()) return;
    if (process.platform === "darwin") app.dock?.bounce("informational"); else [...windows][0]?.flashFrame(true);
  });
  handle("notifications.permission", () => (Notification.isSupported() ? "granted" : "unsupported"));
  handle("notifications.openSystemSettings", () => {
    void shell.openExternal(process.platform === "darwin" ? "x-apple.systempreferences:com.apple.preference.notifications" : process.platform === "win32" ? "ms-settings:notifications" : "https://help.gnome.org/users/gnome-help/stable/shell-notifications.html");
  });

  handle("updates.state", () => updates.state());
  handle("updates.check", () => updates.check(true));
  handle("updates.download", () => updates.download());
  handle("updates.reveal", () => updates.reveal());
  handle("updates.install", () => updates.install());
  handle("updates.remindLater", () => updates.remindLater());
  handle("updates.setOptions", ([options]) => updates.setOptions(options));
  handle("updates.setBlockers", ([blockers]) => updates.setBlockers(blockers));

  handle("background.get", () => backgroundState());
  handle("background.set", ([change]) => {
    if (change.keepInTray !== undefined) settings.set("keepInTray", change.keepInTray);
    if (change.launchAtLogin !== undefined) setLaunchAtLogin(change.launchAtLogin);
    if (change.keepHostAfterQuit !== undefined) settings.set("keepHostAfterQuit", change.keepHostAfterQuit);
    refreshTray();
    broadcast("background.state", backgroundState());
    return backgroundState();
  });
  handle("background.setWork", ([next]) => {
    work = next;
    updates.setBlockers({ unsavedProjects: next.unsavedProjects, runningExports: next.exports.length, runningJobs: next.jobs.length, openTerminals: 0, recording: false });
    refreshTray();
    setAttentionBadge(next.attention.length, unattended, (count) => app.setBadgeCount(count));
  });
  // "Rotate device key": every stored host is told the new key in turn; the old key is deleted when none still uses it.
  handle("device.rotate", async () => {
    const hosts = identity.hosts();
    if (hosts.length === 0) throw new BridgeError("UNAVAILABLE", "This computer is paired with no host");
    const old = identity.publicInfo();
    const open: { host: (typeof hosts)[number]; connection: HostConnection }[] = [];
    try {
      // The two keys are never both in use: the key is replaced only when every host can be told now.
      for (const host of hosts) {
        const connection = await connectHost({ host, signer: identity.signer(), clientInstanceId: "desktop-rotate", onTokenRotated: (deviceToken) => identity.saveHost({ ...host, deviceToken }) }).catch(() => null);
        if (!connection) throw new BridgeError("UNAVAILABLE", `"${host.gatewayName}" cannot be reached. Connect it or forget it, then replace the key.`);
        open.push({ host, connection });
      }
      const accepted: { host: (typeof hosts)[number]; deviceToken: { value: string; expires_ms: number } }[] = [];
      for (const { host, connection } of open) {
        const proof = await identity.sign({ kind: "rotate", fields: { gatewayId: host.gatewayId } });
        const answer = await connection.call<{ deviceId: string; deviceToken: { value: string; expires_ms: number } }>("jagentchill.device.key.rotate", proof);
        accepted.push({ host, deviceToken: answer.deviceToken });
      }
      const next = identity.promotePending();
      for (const { host, deviceToken } of accepted) identity.saveHost({ ...host, deviceToken });
      diagnostics.line(`[identity] device key replaced: ${old.deviceId.slice(0, 16)} → ${next.deviceId.slice(0, 16)} on ${accepted.length} host(s)`);
      void supervisor.reconnect();
      return { oldDeviceId: old.deviceId, deviceId: next.deviceId, hosts: accepted.length };
    } catch (error) {
      if (error instanceof SignRefused) identity.discardPending();
      throw error;
    } finally { for (const { connection } of open) connection.close(); }
  });

  handle("menu.model", () => menuFor(currentModel(), policy.appMenuInWindow ? (process.platform === "darwin" ? "linux" : process.platform) : process.platform));
  handle("menu.setState", ([state]) => {
    const { labels, locale: _locale, ...rest } = state;
    menuState = { ...menuState, ...rest, ...(labels ? { translate: (text: string) => labels[text] ?? text } : {}) };
    // The menu follows the screen, the selection and the focus within 200 ms.
    refreshMenu();
  });
  handle("menu.invoke", ([id]) => invokeMenu(id));

  let linksOff: (() => void) | null = null;
  handle("deepLinks.ready", () => { linksOff?.(); linksOff = links.subscribe((url) => toRecent("deepLinks.link", url)); });

  let probe: Record<string, unknown> = {};
  handle("capabilities.get", async () => ({ gpuDisabled: settings.get<boolean>("gpuDisabled") === true, gpuInterface: settings.get<boolean>("gpuInterface") !== false, gpu: await app.getGPUInfo("basic").catch(() => null), features: app.getGPUFeatureStatus(), probe }));
  handle("capabilities.report", ([next]) => { probe = next; });
  handle("power.block", ([reason]) => { if (!sleepBlocks.has(reason)) sleepBlocks.set(reason, powerSaveBlocker.start("prevent-app-suspension")); });
  handle("power.unblock", ([reason]) => { const id = sleepBlocks.get(reason); if (id !== undefined) powerSaveBlocker.stop(id); sleepBlocks.delete(reason); });
}

// ───────────────────────────── lifecycle ─────────────────────────────
let quitting = false;
const gpuCrashes = gpuCrashTracker();
app.on("child-process-gone", (_event, details) => {
  if (details.type !== "GPU" || details.reason === "clean-exit" || details.reason === "killed") return;
  warn(`GPU process gone: ${details.reason}`);
  if (!gpuCrashes.crashed() || settings.get<boolean>("gpuDisabled") === true) return;
  // Three crashes inside a minute: one relaunch without GPU acceleration; the renderer shows the banner.
  settings.set("gpuDisabled", true);
  void supervisor.dispose().then(() => { app.relaunch(); app.exit(0); });
});
app.on("window-all-closed", () => {
  if (quitting || keepingHost) return;
  const decision = lastWindowClosed({ platform: process.platform, keepInTray: keepInTray(), trayAvailable: hasTray(), hostJobs: work.jobs.length });
  mainLog.line(`[background] last window closed: ${decision}`);
  if (decision === "stay") return;
  if (decision === "hide-to-tray") {
    // The first time, a notification says where the app went.
    if (settings.get<boolean>("trayExplained") !== true) {
      settings.set("trayExplained", true);
      if (!unattended && Notification.isSupported()) new Notification({ title: "JAgentChill keeps running in the tray", body: "Open it again from the tray icon, or quit from its menu." }).show();
    }
    return;
  }
  app.quit();
});
app.on("activate", () => { keepingHost = false; if (windows.size === 0 && app.isReady()) createWindow(); });
app.on("before-quit", (event) => {
  if (quitting) return;
  // The built-in host is stopped by its one sequence before the process may end: no server and no Gateway is left behind.
  event.preventDefault();
  if (deciding) return;
  deciding = true;
  void confirmQuit().then((go) => {
    deciding = false;
    if (!go) return;
    quitting = true;
    // Nothing of the window, the notification or the tray may stand between the quit and the stop of the server: each step is on its own.
    const attempt = (what: string, step: () => unknown) => { try { step(); } catch (error) { warn(`${what} failed: ${error}`); } };
    attempt("remembering the windows", rememberWindows);
    attempt("closing the notification", () => backgroundNotification?.close());
    attempt("removing the tray", () => { if (tray && !tray.isDestroyed()) tray.destroy(); });
    tray = null;
    const keepHostAfterQuit = settings.get<boolean>("keepHostAfterQuit") === true;
    return Promise.resolve().then(() => fileAccess.abortAll()).catch((error) => warn(`aborting file access failed: ${error}`))
      .then(() => keepHostAfterQuit ? mainLog.line("[background] keeping the built-in host running after quit") : supervisor.dispose()).catch((error) => warn(`stop failed: ${error}`))
      .finally(() => { attempt("closing the library", () => library.close()); app.exit(0); });
  });
});
let deciding = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());

void app.whenReady().then(async () => {
  // A test harness that attaches to a packaged app after it has started (it cannot hold the start itself) asks for the
  // first window to wait until it is attached. Only an unattended run honours this.
  if (unattended && process.env.JAGENTCHILL_HOLD_START === "1") await new Promise<void>((go) => process.once("SIGUSR2", () => go()));
  if (launch.renderHost) {
    // The render host is spawned by the server with its two pipes; it shows nothing and takes no part in the app's life.
    mainLog.line("[render-host] this build carries no render engine host");
    app.exit(3);
    return;
  }
  mainLog.line(`[main] start version=${app.getVersion()} packaged=${app.isPackaged} platform=${process.platform}/${process.arch} userData=${userData}`);
  if (unattended) app.dock?.hide();
  registerSchemes();
  // Scripts cached by an earlier build carry that moment's policy (see the scheme handler); they are dropped once per start.
  await session.defaultSession.clearCache().catch(() => undefined);
  hardenSession();
  registerIpc();
  // Registered at each launch: the scheme the installer registered is checked again, and a development run registers itself.
  if (app.isPackaged) app.setAsDefaultProtocolClient("jagentchill");
  else if (process.env.JAGENTCHILL_REGISTER_PROTOCOL === "1") app.setAsDefaultProtocolClient("jagentchill", process.execPath, [resolve(__dirname, "..")]);
  refreshMenu();
  // The windows come first: the UI is shown before the host is ready, and local projects are usable at once.
  const remembered = settings.get<WindowState[]>("windows");
  if (launch.hidden && hiddenLaunch(hasTray()) === "no-window" && !unattended) mainLog.line("[background] hidden launch: no window");
  else if (remembered?.length) for (const state of remembered) createWindow(undefined, state);
  else createWindow();
  startingUp = false;
  refreshTray();
  // What an unattended run reads instead of looking at the menu bar: the tray's menu and state as they would be shown.
  if (unattended) (globalThis as Record<string, unknown>).__jagentchill = { trayModel, backgroundState };
  const check = runtime();
  if (!check.ok && app.isPackaged) blockingError("The installation is incomplete — reinstall JAgentChill");
  void library.open();
  supervisor.watchHealth();
  if (shouldStartBundledHost(settings.get<"tailscale" | "local">("connectionMode"))) {
    void supervisor.start().then(async () => {
      if (identity.hasQuarantinedLegacy()) void attemptLegacyIdentityRecovery();
      if (settings.get<"tailscale" | "local">("connectionMode") === "tailscale") await ensureTailnetForMode();
    }).catch((error) => warn(`host start failed: ${error instanceof Error ? error.stack : error}`));
  }
  updates.schedule();
});
