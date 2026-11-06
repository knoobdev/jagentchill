// Real Electron safeStorage proof for the legacy desktop host-record migration and first-launch gate.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { beginEnrolment, originOfAddress } from "@jagentchill/client";
import { decodeOffer } from "@jagentchill/protocol";

const desktopRoot = resolve(fileURLToPath(new URL("../../desktop", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8b3-reload-not-csp-4");
const userData = join(runDir, "user-data");
const library = join(runDir, "library");
const remoteData = join(runDir, "remote-host");
const screenshots = join(repoRoot, ".dev/evidence");
const fixture = join(new URL("./host-migration-desktop-fixture-server.mjs", import.meta.url).pathname);
const webDir = process.env.JAGENTCHILL_E2E_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_WEB_DIR) : join(repoRoot, ".dev/build/web-w8b3-reload-not-csp");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(remoteData, { recursive: true });
mkdirSync(screenshots, { recursive: true });
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Build the Electron web export first: ${webDir}`);

const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: webDir,
  JAGENTCHILL_PORT: "18955",
  JAGENTCHILL_GATEWAY_PORT: "18956",
};
delete env.ELECTRON_RUN_AS_NODE;
const checkResults = [];
const check = (condition, description) => { assert.ok(condition, description); checkResults.push(description); };
const fixtureEnv = { ...process.env, JAGENTCHILL_PORT: "18957", JAGENTCHILL_GATEWAY_PORT: "18958", JAGENTCHILL_E2E_RUN_DIR: runDir };
const fixtureProcess = spawn(process.execPath, [fixture, "--data-dir", remoteData, "--port", "18957"], { cwd: repoRoot, env: fixtureEnv, stdio: ["ignore", "pipe", "pipe"] });
let fixtureOutput = "";
fixtureProcess.stdout.on("data", (chunk) => { fixtureOutput += chunk.toString(); });
fixtureProcess.stderr.on("data", (chunk) => { fixtureOutput += chunk.toString(); });
const waitFor = async (fn, label, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const launch = async () => {
  const app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  return { app, page };
};
const stopApp = async (app) => {
  if (!app || app.process().exitCode !== null) return;
  const exited = new Promise((resolve) => app.process().once("exit", resolve));
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 45_000))]);
  if (app.process().exitCode === null) app.process().kill("SIGKILL");
};
const readStore = (page, key) => page.evaluate((name) => window.jagentchillDesktop.secureStore.get(name), key);
const storeKeys = (page, prefix) => page.evaluate((name) => window.jagentchillDesktop.secureStore.keys(name), prefix);
const oldWrite = (page, gatewayId, record) => page.evaluate(({ key, value }) => window.jagentchillDesktop.secureStore.set(key, JSON.stringify(value)), { key: `host/${gatewayId}`, value: record });
const removeSidecar = (page, gatewayId) => page.evaluate((key) => window.jagentchillDesktop.secureStore.delete(key), `host-connections/${gatewayId}`);
let app;
let recordTokens = [];
let recordKeys = [];
let gatewayIds = [];
let fixtureWasReady = false;
try {
  await waitFor(async () => { try { return (await fetch("http://127.0.0.1:18957/__fixture/offer")).ok; } catch { return false; } }, "fixture server");
  fixtureWasReady = true;

  // The first launch creates the real built-in host using the Electron main-process identity and protected store.
  let session = await launch();
  app = session.app;
  let page = session.page;
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  const builtInStatus = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
    return status.state === "ready" ? status : null;
  }, "initial built-in host readiness", 150_000);
  check(builtInStatus.port === 18955 && builtInStatus.gatewayPort === 18956, "seed app bound only ports 18955/18956");
  const builtInId = builtInStatus.gatewayId;
  assert.ok(builtInId, "seed host exposed its gateway id");
  const builtIn = JSON.parse(await readStore(page, `host/${builtInId}`));
  assert.equal(builtIn.builtIn, true, "seed is the built-in host record from the real supervisor");
  check(Boolean(builtIn.deviceToken?.value && builtIn.gatewayPublicKey), "built-in legacy store record includes its token and gateway key");

  // Pair a second, real fixture host using the Electron device signer and the actual protected-store enrolment relay.
  const fixtureOfferReply = await (await fetch("http://127.0.0.1:18957/__fixture/offer")).json();
  const parsed = decodeOffer(fixtureOfferReply.url);
  assert.ok(parsed.ok, "fixture supplied a valid pairing offer");
  const origin = originOfAddress(parsed.offer.addresses[0].url);
  const deviceInfo = await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey());
  assert.ok("value" in deviceInfo, "Electron main process supplied its device identity");
  await page.evaluate(({ offer, origin }) => window.jagentchillDesktop.device.beginEnrolment(offer, origin), { offer: fixtureOfferReply.url, origin });
  const signer = {
    deviceId: deviceInfo.value.deviceId,
    devicePublicKey: deviceInfo.value.devicePublicKey,
    signHandshake: async (fields) => {
      const result = await page.evaluate((fields) => window.jagentchillDesktop.device.sign({ kind: "handshake", fields }), fields);
      if ("error" in result) throw new Error(result.error.message);
      return result.value.signature;
    },
    signRequest: async (fields) => {
      const result = await page.evaluate((fields) => window.jagentchillDesktop.device.sign({ kind: "request", fields }), fields);
      if ("error" in result) throw new Error(result.error.message);
      return result.value.signature;
    },
  };
  const relay = async (path, body) => {
    const step = path.slice(path.lastIndexOf("/") + 1);
    const result = await page.evaluate(({ step, json }) => window.jagentchillDesktop.device.enrolmentPost(step, json), { step, json: JSON.stringify(body) });
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return { status: result.status, body: result.body };
  };
  const enrollment = await beginEnrolment(parsed.offer, origin, signer, { deviceName: "Migration fixture", platform: "macos", appVersion: "0.0.0", keyProtection: deviceInfo.value.keyProtection }, relay);
  const pairingCode = await waitFor(async () => {
    const pending = await (await fetch("http://127.0.0.1:18957/__fixture/pending")).json();
    return pending.requests.find((request) => request.requestId === enrollment.requestId)?.code;
  }, "fixture pairing code");
  check(/^\d{6}$/.test(pairingCode), "remote host was paired with a six-digit fixture code");
  const remote = await enrollment.submitCode(pairingCode);
  await page.evaluate(() => window.jagentchillDesktop.device.endEnrolment());
  assert.equal(remote.gatewayId, fixtureOfferReply.gatewayId);

  // Snapshot repo's previous renderer write path: secureStore.set(`host/${gatewayId}`, JSON.stringify(host)).
  // That bridge is the real Electron identity.store backed by safeStorage, not a test Map.
  const oldBuiltIn = { ...builtIn };
  delete oldBuiltIn.connections;
  delete oldBuiltIn.preferredConnectionId;
  const oldRemote = { ...remote };
  delete oldRemote.connections;
  delete oldRemote.preferredConnectionId;
  await removeSidecar(page, oldBuiltIn.gatewayId);
  await removeSidecar(page, oldRemote.gatewayId);
  await oldWrite(page, oldBuiltIn.gatewayId, oldBuiltIn);
  await oldWrite(page, oldRemote.gatewayId, oldRemote);
  gatewayIds = [oldBuiltIn.gatewayId, oldRemote.gatewayId];
  recordTokens = [oldBuiltIn.deviceToken.value, oldRemote.deviceToken.value];
  recordKeys = [oldBuiltIn.gatewayPublicKey, oldRemote.gatewayPublicKey];
  const oldKeys = await storeKeys(page, "host/");
  check(oldKeys.length === 2 && oldKeys.includes(`host/${oldBuiltIn.gatewayId}`) && oldKeys.includes(`host/${oldRemote.gatewayId}`), "two old-shape host records are encrypted in Electron's real protected store");
  for (const id of gatewayIds) {
    const raw = JSON.parse(await readStore(page, `host/${id}`));
    check(!("connections" in raw) && !("preferredConnectionId" in raw) && (id !== oldBuiltIn.gatewayId || raw.builtIn === true), `host/${id} uses the exact pre-migration single-origin shape${id === oldBuiltIn.gatewayId ? " with builtIn: true" : ""}`);
  }
  await stopApp(app);
  app = null;
  // Existing installs have unset mode once. Remove that product setting only in this disposable fixture profile.
  const settingsPath = join(userData, "desktop.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  delete settings.connectionMode;
  const restoredWindow = { x: 80, y: 80, width: 1280, height: 800, maximized: false, fullscreen: false, route: "/devices" };
  settings.window = restoredWindow;
  settings.windows = [restoredWindow];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // Current build startup reads the two old protected records and migrates them to protected sidecars.
  session = await launch();
  app = session.app;
  page = session.page;
  try { await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 }); }
  catch (error) {
    await page.screenshot({ path: join(screenshots, "w8-i1-mode-unset-devices-gate-failure.png"), fullPage: true }).catch(() => undefined);
    console.error("unset-mode diagnostic", JSON.stringify(await page.evaluate(() => ({ path: location.pathname, mode: window.jagentchillDesktop.connectionMode.get(), headings: [...document.querySelectorAll("h1,h2")].map((node) => node.textContent) })).catch(() => null)));
    throw error;
  }
  check((await page.evaluate(() => location.pathname)) === "/join-tailnet", "an existing install restoring /devices with hosts and unset mode opens Join your tailnet first");
  await page.screenshot({ path: join(screenshots, "w8-i1-mode-unset-devices-gate.png"), fullPage: true });
  const gatedHost = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
  check(gatedHost.state === "stopped", "the restored-route gate keeps the existing install's bundled host stopped");
  const gateLogOffset = readFileSync(join(userData, "logs", "main.log"), "utf8").length;
  await page.waitForTimeout(15_000);
  const gateLog = readFileSync(join(userData, "logs", "main.log"), "utf8").slice(gateLogOffset);
  check(!/CSP violation:/i.test(gateLog), "15 seconds on the unset-mode gate produce zero new CSP violation lines in main.log");
  const listedKeys = await storeKeys(page, "host/");
  check(listedKeys.length === 2, "first-launch gate still has both legacy host records listed in the protected store");
  const migratedRecords = await Promise.all(gatewayIds.map(async (id) => ({ id, raw: JSON.parse(await readStore(page, `host/${id}`)), sidecar: await readStore(page, `host-connections/${id}`) })));
  for (const item of migratedRecords) {
    const sidecar = JSON.parse(item.sidecar ?? "null");
    check(Boolean(sidecar?.connections?.length === 1 && sidecar.connections[0].origin === item.raw.origin && sidecar.preferredConnectionId === sidecar.connections[0].id), `migration retained the original endpoint in a protected one-route sidecar for ${item.id}`);
    check(!("connections" in item.raw) && !("preferredConnectionId" in item.raw), `migration preserved the original strict legacy record for ${item.id}`);
  }
  const originalById = new Map(gatewayIds.map((id, index) => [id, { token: recordTokens[index], key: recordKeys[index] }]));
  for (const { id, raw } of migratedRecords) {
    check(raw.deviceToken.value === originalById.get(id).token, `device token unchanged for ${id}`);
    check(raw.gatewayPublicKey === originalById.get(id).key, `gateway key unchanged for ${id}`);
  }

  const reloadsBeforeLocal = (readFileSync(join(userData, "logs", "main.log"), "utf8").match(/\[window\] reload after built-in host bootstrap/g) ?? []).length;
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/devices$/, { timeout: 30_000 });
  const ready = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
    if (!status) return null;
    return status.state === "ready" ? status : null;
  }, "built-in host connection after Continue with Local", 150_000);
  check(ready.port === 18955 && ready.gatewayPort === 18956, "Continue with Local starts the built-in host on the assigned port pair");
  const bootstrapDiagnostics = readFileSync(join(userData, "logs", "diagnostics.log"), "utf8");
  check(/\[supervisor\] server started .*port=18955 gatewayPort=18956/.test(bootstrapDiagnostics), "Continue with Local records the supervisor server-start line on the remembered port pair");
  const reloadsAfterLocal = (readFileSync(join(userData, "logs", "main.log"), "utf8").match(/\[window\] reload after built-in host bootstrap/g) ?? []).length;
  check(reloadsAfterLocal === reloadsBeforeLocal + 1, "the new host bootstrap reloads the app document exactly once");
  check((await page.evaluate(() => location.pathname)) === "/devices", "Continue with Local returns to the restored /devices route and connects after the main-process document reload");
  await page.screenshot({ path: join(screenshots, "w8-i2-local-restored-devices-connected.png"), fullPage: true });
  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/, { timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const builtInRow = page.getByTestId(`paired-host-${oldBuiltIn.gatewayId}`);
  const remoteRow = page.getByTestId(`paired-host-${oldRemote.gatewayId}`);
  await builtInRow.waitFor({ timeout: 15_000 });
  await remoteRow.waitFor({ timeout: 15_000 });
  check(await builtInRow.isVisible() && await remoteRow.isVisible(), "both migrated hosts appear on Connections and devices after Continue with Local");
  const remoteSidecarRaw = await readStore(page, `host-connections/${oldRemote.gatewayId}`);
  const remoteSidecar = JSON.parse(remoteSidecarRaw);
  const fixtureAddress = "fixture.tailnet.ts.net:18957";
  const fixtureConnection = { id: `tailnet:${fixtureAddress}`, kind: "tailnet", origin: `http://${fixtureAddress}`, tailnetAddress: fixtureAddress };
  remoteSidecar.connections = [...remoteSidecar.connections.filter((item) => item.kind !== "tailnet"), fixtureConnection];
  remoteSidecar.preferredConnectionId = fixtureConnection.id;
  await page.evaluate(({ key, value }) => window.jagentchillDesktop.secureStore.set(key, JSON.stringify(value)), { key: `host-connections/${oldRemote.gatewayId}`, value: remoteSidecar });
  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/, { timeout: 30_000 });
  const remoteDeviceRow = page.getByTestId(`paired-host-${oldRemote.gatewayId}`);
  await remoteDeviceRow.waitFor({ timeout: 15_000 });
  const remoteConnectionLine = remoteDeviceRow.getByTestId(`paired-host-connection-${oldRemote.gatewayId}`);
  check((await remoteConnectionLine.innerText()).includes("Tailscale") && (await remoteConnectionLine.innerText()).includes(fixtureAddress), "Connections and devices shows one typed Tailscale address for a paired remote host from a protected-store fixture");
  check(!(await page.locator("body").innerText()).includes("127.0.0.1"), "the remote-host Connections and devices screen does not expose a loopback address");
  check(await page.getByTestId("connection-overview").count() === 0, "the remote-host screen has no Connection card");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(screenshots, "w8q-connections-remote-tailnet-1440-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshots, "w8q-connections-remote-tailnet-1440-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.screenshot({ path: join(screenshots, "w8q-connections-remote-tailnet-700-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshots, "w8q-connections-remote-tailnet-700-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  check(ready.state === "ready" && ready.gatewayId === oldBuiltIn.gatewayId, "built-in host connects through the supervisor's stored bootstrap token without a pairing-code prompt");
  check((await page.getByRole("heading", { name: "Join your tailnet" }).count()) === 0 && (await page.getByTestId("continue-local").count()) === 0, "no pairing or first-launch code prompt is shown after Continue with Local");
  await page.screenshot({ path: join(screenshots, "d1-desktop-real-store-two-hosts-connected.png"), fullPage: true });
  for (const id of gatewayIds) {
    const raw = JSON.parse(await readStore(page, `host/${id}`));
    check(raw.deviceToken.value === originalById.get(id).token && raw.gatewayPublicKey === originalById.get(id).key, `post-connect host secrets remain unchanged for ${id}`);
  }

  // No stored token or gateway public key may appear in plaintext anywhere in this install's user-data files.
  const forbidden = [...recordTokens, ...recordKeys];
  const scan = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scan(path);
    if (!entry.isFile()) return [];
    const bytes = readFileSync(path);
    return forbidden.some((secret) => bytes.includes(Buffer.from(secret))) ? [path] : [];
  });
  const plaintextMatches = scan(userData);
  check(plaintextMatches.length === 0, `protected values are absent as plaintext from user-data files${plaintextMatches.length ? `: ${plaintextMatches.join(", ")}` : ""}`);

  const legacyBeforeNoop = await Promise.all(gatewayIds.map((id) => readStore(page, `host/${id}`)));
  const sidecarsBeforeNoop = await Promise.all(gatewayIds.map((id) => readStore(page, `host-connections/${id}`)));
  const encryptedStoreBeforeNoop = readFileSync(join(userData, "identity", "secure-store.json"));
  await stopApp(app);
  app = null;
  session = await launch();
  app = session.app;
  page = session.page;
  await page.waitForURL(/\/devices$/, { timeout: 30_000 });
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "ready", "second start host readiness", 150_000);
  const legacyAfterNoop = await Promise.all(gatewayIds.map((id) => readStore(page, `host/${id}`)));
  const sidecarsAfterNoop = await Promise.all(gatewayIds.map((id) => readStore(page, `host-connections/${id}`)));
  check(JSON.stringify(legacyAfterNoop) === JSON.stringify(legacyBeforeNoop) && JSON.stringify(sidecarsAfterNoop) === JSON.stringify(sidecarsBeforeNoop), "second current-build start leaves the migrated protected records and sidecars unchanged");
  check(readFileSync(join(userData, "identity", "secure-store.json")).equals(encryptedStoreBeforeNoop), "second start is a storage no-op at the encrypted store file level");
  check((await page.getByRole("heading", { name: "Join your tailnet" }).count()) === 0, "second start with saved Local mode goes straight to the remembered /devices route");
  await stopApp(app);
  app = null;
  const settingsForModelRouting = JSON.parse(readFileSync(settingsPath, "utf8"));
  const modelRoutingRoute = `/settings/host/${oldBuiltIn.gatewayId}/model-routing`;
  const rememberedForModelRouting = { x: 80, y: 80, width: 1280, height: 800, maximized: false, fullscreen: false, route: modelRoutingRoute };
  settingsForModelRouting.window = rememberedForModelRouting;
  settingsForModelRouting.windows = [rememberedForModelRouting];
  delete settingsForModelRouting.connectionMode;
  writeFileSync(settingsPath, JSON.stringify(settingsForModelRouting, null, 2));
  session = await launch();
  app = session.app;
  page = session.page;
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  check((await page.evaluate(() => location.pathname)) === "/join-tailnet", "an unset-mode launch from the saved model-routing path is intercepted by Join your tailnet");
  check((await page.evaluate(() => new URLSearchParams(location.search).get("returnTo"))) === modelRoutingRoute, "the settings route survives in the gate returnTo parameter");
  check((await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "stopped", "the bundled host stays stopped while the model-routing route is gated");
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/settings\/host\/[^/]+\/model-routing$/, { timeout: 30_000 });
  const modelRouteHost = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
    return status.state === "ready" ? status : null;
  }, "built-in host readiness on the restored model-routing route", 150_000);
  check((await page.evaluate(() => location.pathname)) === modelRoutingRoute, "a saved /settings/host/<id>/model-routing route restores while the bundled host starts");
  check(modelRouteHost.gatewayId === oldBuiltIn.gatewayId, "model-routing route starts the same remembered built-in host");
  check((await page.getByRole("heading", { name: "Join your tailnet" }).count()) === 0, "saved Local mode does not gate the model-routing settings route");
  await page.screenshot({ path: join(screenshots, "w8-i4-model-routing-restored.png"), fullPage: true });
  await page.evaluate(() => {
    const NativeWebSocket = window.WebSocket;
    window.__w8HostSocketAttempts = 0;
    window.WebSocket = new Proxy(NativeWebSocket, { construct(target, args) {
      if (String(args[0]).includes(":18955/")) window.__w8HostSocketAttempts++;
      return Reflect.construct(target, args);
    } });
  });
  await page.evaluate(() => window.jagentchillDesktop.gateway.stop());
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "stopped", "the saved built-in host to stop");
  await page.waitForTimeout(6500);
  const stoppedSocketAttempts = await page.evaluate(() => window.__w8HostSocketAttempts);
  check(stoppedSocketAttempts === 0, "a stopped built-in host receives zero renderer WebSocket reconnect attempts across three retry intervals");
  await page.screenshot({ path: join(screenshots, "w8-i2-local-restored-devices-host-stopped.png"), fullPage: true });
  console.log(`PASS host-migration-desktop-real-store: ${checkResults.length} assertions; Electron safeStorage; fixture remote host; no model/provider calls`);
} finally {
  await stopApp(app);
  if (fixtureProcess.exitCode === null) fixtureProcess.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => fixtureProcess.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (fixtureProcess.exitCode === null) fixtureProcess.kill("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 500));
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18955-18958", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), `no owned process listens on 18955-18958${listeners ? `: ${listeners}` : ""}`);
  console.log(`fixture output: ${fixtureOutput.trim()}`);
}
