import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8n-show-path-10");
if (existsSync(runDir)) throw new Error(`Refusing to reuse test directory: ${runDir}`);
const userData = join(runDir, "user-data"), library = join(runDir, "library");
const evidence = join(repoRoot, ".dev/evidence");
const desktopWebDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8n-show-path-electron");
const clientWebDir = process.env.JAGENTCHILL_CLIENT_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_CLIENT_WEB_DIR) : join(repoRoot, ".dev/build/web-w8n-show-path-client");
const bridgeFixture = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
const bridgeWrapper = join(runDir, "fake-tsnet-bridge");
const stateFile = join(runDir, "tailnet-state.txt"), openedUrlFile = join(runDir, "opened-url.txt");
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(evidence, { recursive: true });
writeFileSync(bridgeWrapper, `#!/bin/sh\nexec "${process.execPath}" "${bridgeFixture}"\n`);
chmodSync(bridgeWrapper, 0o755);
writeFileSync(stateFile, "login\n");

const serverPort = process.env.JAGENTCHILL_E2E_PORT ?? "18955", gatewayPort = process.env.JAGENTCHILL_E2E_GATEWAY_PORT ?? "18956", forwardPort = process.env.JAGENTCHILL_E2E_FORWARD_PORT ?? "18959", webPort = process.env.JAGENTCHILL_E2E_WEB_PORT ?? "8085";
const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: desktopWebDir,
  JAGENTCHILL_PORT: serverPort,
  JAGENTCHILL_GATEWAY_PORT: gatewayPort,
  JAGENTCHILL_TSNET_BRIDGE_BIN: bridgeWrapper,
  JAGENTCHILL_DEV_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
  FAKE_TSNET_FORWARD_PORT: forwardPort,
  TSNET_TEST_STATE_FILE: stateFile,
  TSNET_TEST_PROXY_TARGET: `127.0.0.1:${serverPort}`,
  TSNET_TEST_TAILNET_ADDRESS: `fake-host.example.ts.net:${serverPort}`,
  TSNET_TEST_PROXY_TRACE: join(runDir, "tailnet-proxy.log"),
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: openedUrlFile,
};
delete env.ELECTRON_RUN_AS_NODE;
const web = spawn(process.execPath, [join(repoRoot, "scripts/serve-web.mjs"), clientWebDir, webPort], { cwd: repoRoot, stdio: "ignore" });
let app, browser, clientPage;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const shot = (name) => join(evidence, name);
const waitFor = async (predicate, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const waitWeb = async () => waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${webPort}`)).ok; } catch { return false; } }, "client web server", 10_000);
const tailnetOfferOnly = (offerUrl) => {
  const payload = offerUrl.slice(offerUrl.indexOf("offer=") + 6);
  const offer = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  offer.addresses = offer.addresses.filter((address) => address.kind === "tailnet");
  assert.equal(offer.addresses.length, 1, "fixture offers exactly one tailnet path to force ingress tagging");
  return `jagentchill://pair#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
};

try {
  await waitWeb();
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByTestId("tailscale-sign-in").click();
  await waitFor(async () => existsSync(openedUrlFile), "fake login URL without opening a browser", 30_000);
  writeFileSync(stateFile, "connected\n");
  await page.waitForURL(/\/home$/, { timeout: 40_000 });
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "ready", "bundled host ready", 120_000);
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus())).connected, "fake tailnet connected", 30_000);
  await page.getByTestId("connection-chip").getByText("Connected · Tailscale", { exact: true }).waitFor({ timeout: 15_000 });
  check(true, "desktop footer names its connected Tailscale host path");
  await page.screenshot({ path: shot("w8-m3-footer-tailscale.png"), fullPage: true });
  await page.getByTestId("connection-chip").hover();
  await page.getByRole("tooltip").getByText("This computer's host is reachable at fake-host.example.ts.net:18955", { exact: true }).waitFor({ timeout: 5_000 });
  check(true, "desktop footer hover names the address where this computer's host is reachable");
  await page.screenshot({ path: shot("w8-m3-footer-tailscale-address.png"), fullPage: true });

  // The first-launch gate leaves the desktop's own host paired but unselected. Select it before asking that host for an offer.
  await page.getByTestId("host-switcher").click();
  const builtInHost = page.locator('[data-testid^="host-row-"]').filter({ hasText: "This computer" }).first();
  await builtInHost.waitFor({ timeout: 30_000 });
  await builtInHost.click();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "ready", "selected built-in host ready", 120_000);

  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("devices.pair"));
  await page.waitForURL(/\/devices\?pair=1/);
  try { await page.getByLabel("Pairing link", { exact: true }).waitFor({ timeout: 30_000 }); }
  catch (error) {
    await page.screenshot({ path: shot("w8s-host-connect-pairing-link-failure.png"), fullPage: true });
    console.error("pairing link field failure route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2600));
    throw error;
  }
  check(await page.getByRole("heading", { name: "Pair a device", exact: true }).isVisible(), "the desktop pairing offer opens in its dialog");
  check(await page.getByLabel("Pairing QR code", { exact: true }).isVisible(), "the desktop pairing dialog displays its QR code");
  check(await page.getByRole("button", { name: "Copy link", exact: true }).isVisible(), "the desktop pairing dialog offers Copy link");
  await page.screenshot({ path: shot("w8s-host-connect-pair-device-modal.png"), fullPage: true });
  const offerUrl = tailnetOfferOnly(await page.getByLabel("Pairing link", { exact: true }).inputValue());
  check(offerUrl.startsWith("jagentchill://pair#offer="), "the visible desktop pairing link contains the generated offer");
  if (process.env.JAGENTCHILL_E2E_MODAL_ONLY === "1") {
    console.log(`PASS host-connect-m: ${assertions} assertions; desktop pairing offer shows its generated link, QR code, and Copy link action; isolated fake bridge only`);
  } else {
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("nav.go.home"));
  await page.waitForURL(/\/home$/);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ forwardPort, serverPort }) => {
    const replace = (value) => String(value).replace(`fake-host.example.ts.net:${serverPort}`, `127.0.0.1:${forwardPort}`);
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => nativeFetch(typeof input === "string" ? replace(input) : input, init);
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, { construct(target, args) { args[0] = replace(args[0]); return Reflect.construct(target, args); } });
  }, { forwardPort, serverPort });
  clientPage = await context.newPage();
  clientPage.on("pageerror", (error) => console.error(`headless client page error: ${error.message}`));
  const payload = offerUrl.slice(offerUrl.indexOf("offer=") + 6);
  await clientPage.goto(`http://127.0.0.1:${webPort}/pair/start?offer=${encodeURIComponent(payload)}`);
  const nameField = clientPage.getByLabel("Name of this device", { exact: true });
  await nameField.waitFor();
  await nameField.fill("iPhone 16 Pro");
  await clientPage.screenshot({ path: shot("w8-m4-native-pairing-name-fixture.png"), fullPage: true });
  check(await nameField.inputValue() === "iPhone 16 Pro", "editable pairing name field accepts the native platform-name fixture");
  await clientPage.getByRole("button", { name: "Continue", exact: true }).click();
  await clientPage.getByRole("heading", { name: /Enter the code shown next to/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { name: "A new device wants to pair" }).waitFor({ timeout: 30_000 });
  const popupDescription = await page.locator('[role="dialog"]').innerText();
  check(popupDescription.includes("Tailscale") && !popupDescription.includes("127.0.0.1"), "tailnet-tagged pairing popup shows Tailscale and hides the ingress loopback address");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("w8-m1-tailnet-pair-request.png"), fullPage: true });

  const code = (await page.getByTestId("pairing-request-popup-code").innerText()).replace(/\D/g, "");
  check(/^\d{6}$/.test(code), "popup displays a six-digit verification code");
  await clientPage.getByLabel("Verification code", { exact: true }).fill(code);
  await clientPage.waitForURL(/\/home$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Decline", exact: true }).waitFor({ state: "hidden", timeout: 30_000 });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("nav.go.devices"));
  await page.waitForURL(/\/devices$/);
  const phoneRow = page.getByRole("row").filter({ hasText: "iPhone 16 Pro" });
  await phoneRow.waitFor({ timeout: 30_000 });
  await page.getByRole("columnheader", { name: "Connected via", exact: true }).waitFor();
  await phoneRow.getByText(/Tailscale/).waitFor({ timeout: 15_000 });
  await phoneRow.getByText("Online", { exact: true }).waitFor({ timeout: 15_000 });
  check(await phoneRow.getByRole("cell").filter({ hasText: "Tailscale" }).count() === 1, "Devices has a separate Connected via cell for the enrolled device's live Tailscale path");
  check(true, "Devices row shows the enrolled device's live Tailscale path and Online state");
  await page.screenshot({ path: shot("w8-m2-devices-online-tailnet.png"), fullPage: true });
  await clientPage.close();
  await phoneRow.getByText("Offline", { exact: true }).waitFor({ timeout: 5_000 });
  await phoneRow.getByText(/Last: Tailscale/).waitFor({ timeout: 5_000 });
  check(true, "Devices row changes to Offline and Last: Tailscale after the phone socket closes");
  await page.screenshot({ path: shot("w8-m5-devices-offline-tailnet.png"), fullPage: true });

  await page.getByTestId("footer-settings").click();
  await page.getByTestId("settings-devices").click();
  await page.getByTestId("connection-mode-change").first().click();
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.getByTestId("connection-chip").getByText("Connected · Local", { exact: true }).waitFor({ timeout: 45_000 });
  check(true, "switching the desktop connection type to Local changes the footer path");
  await page.screenshot({ path: shot("w8-m3-footer-local.png"), fullPage: true });

  await page.evaluate(() => window.jagentchillDesktop.connectionMode.set("tailscale"));
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus())).connected, "fake tailnet reconnected", 45_000);
  await page.getByTestId("connection-chip").getByText("Connected · Tailscale", { exact: true }).waitFor({ timeout: 45_000 });
  await page.evaluate(() => window.jagentchillDesktop.tailnet.logout());
  await page.getByTestId("connection-chip").getByText("Tailscale needs sign-in", { exact: true }).waitFor({ timeout: 20_000 });
  check(true, "desktop footer reports when its Tailscale connection needs sign-in");
  await page.screenshot({ path: shot("w8-m3-footer-needs-sign-in.png"), fullPage: true });
  console.log(`PASS host-connect-m: ${assertions} assertions; fake Tailscale bridge and tailnet-tagged ingress only; fixture pairing client; no model/provider calls`);
  }
} finally {
  if (clientPage) await clientPage.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolveWait) => app.process().once("exit", resolveWait)), new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  web.kill("SIGTERM");
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  const { execFileSync } = await import("node:child_process");
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18955-18959", "-iTCP:8085", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), `no process from this test remains listening on 18955–18959 or ${webPort}`);
}
