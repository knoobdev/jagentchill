import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8b3-reload-not-csp-3");
const userData = join(runDir, "user-data");
const library = join(runDir, "library");
const desktopWebDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8b3-reload-not-csp");
const clientWebDir = process.env.JAGENTCHILL_CLIENT_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_CLIENT_WEB_DIR) : join(repoRoot, ".dev/build/web-w8b3-reload-not-csp-client");
const evidence = join(repoRoot, ".dev/evidence");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(evidence, { recursive: true });

const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: desktopWebDir,
  JAGENTCHILL_PORT: process.env.JAGENTCHILL_E2E_PORT ?? "18957",
  JAGENTCHILL_GATEWAY_PORT: process.env.JAGENTCHILL_E2E_GATEWAY_PORT ?? "18958",
  JAGENTCHILL_DEV_ALLOWED_ORIGINS: "http://127.0.0.1:8085",
};
delete env.ELECTRON_RUN_AS_NODE;
const webPort = process.env.JAGENTCHILL_E2E_WEB_PORT ?? "8085";
const web = spawn(process.execPath, [join(repoRoot, "scripts/serve-web.mjs"), clientWebDir, webPort], { cwd: repoRoot, stdio: "ignore" });
let app;
let browser;
let page;
let clientPage;
let assertions = 0;
const check = (condition, description) => { assert.ok(condition, description); assertions++; };
const waitWeb = async () => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${webPort}`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser test server did not start on ${webPort}`);
};
try {
  await waitWeb();
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  page = await app.firstWindow({ timeout: 150_000 });
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  await page.waitForFunction(async () => (await window.jagentchillDesktop.gateway.getStatus()).state === "ready", { timeout: 120_000 });

  // The local first-launch choice is deliberately hostless. Select the built-in host before requesting its offer.
  await page.getByTestId("host-switcher").click();
  const builtInHost = page.locator('[data-testid^="host-row-"]').filter({ hasText: "This computer" }).first();
  try { await builtInHost.waitFor({ timeout: 30_000 }); }
  catch (error) {
    await page.screenshot({ path: join(evidence, "w8-b-pairing-host-picker-failure.png"), fullPage: true });
    console.error("host picker route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2200));
    throw error;
  }
  const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
  await builtInHost.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction((previous) => performance.timeOrigin !== previous, documentStartedAt, { timeout: 30_000 });
  await page.waitForFunction(async () => (await window.jagentchillDesktop.gateway.getStatus()).state === "ready", { timeout: 120_000 });
  await page.getByTestId("host-switcher").getByText("This computer", { exact: true }).waitFor({ timeout: 30_000 });
  try { await page.getByTestId("connection-chip").getByText("Connected · Local", { exact: true }).waitFor({ timeout: 30_000 }); }
  catch (error) {
    await page.screenshot({ path: join(evidence, "w8s-pairing-connected-failure.png"), fullPage: true });
    console.error("selected host status failure route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2200));
    throw error;
  }
  check((await page.evaluate(() => location.pathname)) === "/home", "the one-time exact-port bootstrap reload returns to Home after closing the host switcher");
  check(await page.getByTestId("host-switcher").getByText("This computer", { exact: true }).isVisible(), "the built-in host remains selected in the host switcher after the exact-port reload");

  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("devices.pair"));
  await page.waitForURL(/\/devices\?pair=1/);
  const link = page.getByLabel("Pairing link");
  await link.waitFor({ timeout: 30_000 });
  const offerUrl = await link.inputValue();
  const offer = new URLSearchParams(offerUrl.split("#")[1] ?? "").get("offer");
  check(Boolean(offer), "the host creates a real pairing offer");
  // Keep the Devices offer modal mounted behind Home. The global pairing request must take priority above it.
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("nav.go.home"));
  await page.waitForURL(/\/home$/);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  clientPage = await context.newPage();
  clientPage.on("pageerror", (error) => console.error(`browser client page error: ${error.message}`));
  await clientPage.goto(`http://127.0.0.1:${webPort}/pair/start`);
  await clientPage.getByLabel("Pairing link", { exact: true }).fill(offerUrl);
  await clientPage.getByLabel("Name of this device", { exact: true }).fill("B4 second device");
  await clientPage.getByRole("button", { name: "Continue", exact: true }).click();
  try {
    await clientPage.getByRole("heading", { name: /Enter the code shown next to/ }).waitFor({ timeout: 20_000 });
  } catch (error) {
    await clientPage.screenshot({ path: join(runDir, "second-device-failure.png"), fullPage: true });
    console.error("second device route:", clientPage.url(), "visible text:", (await clientPage.locator("body").innerText()).slice(0, 1600));
    throw error;
  }
  check(true, "a separate browser identity completes the signed challenge and creates a pending request");

  await page.waitForURL(/\/home$/);
  try {
    await page.getByRole("heading", { name: "A new device wants to pair" }).waitFor({ timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: join(runDir, "desktop-popup-failure.png"), fullPage: true });
    console.error("desktop route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2200));
    await page.evaluate(() => window.jagentchillDesktop.menu.invoke("nav.go.devices"));
    await page.waitForURL(/\/devices$/);
    await page.waitForTimeout(1000);
    console.error("devices route after popup timeout:", (await page.locator("body").innerText()).slice(0, 2200));
    await page.screenshot({ path: join(runDir, "devices-after-popup-failure.png"), fullPage: true });
    throw error;
  }
  check(await page.getByTestId("pairing-request-popup-review").isVisible(), "the pending request opens the global popup outside Devices");
  const code = (await page.getByTestId("pairing-request-popup-code").innerText()).replace(/\D/g, "");
  check(/^\d{6}$/.test(code), "the global popup displays the request's six-digit code");
  check(await page.getByRole("button", { name: "Decline", exact: true }).isVisible(), "Decline is visible on the global popup");
  await page.mouse.move(790, 590);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "w8-b4-pairing-popup-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "w8-b4-pairing-popup-dark.png"), fullPage: true });

  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.getByRole("heading", { name: "A new device wants to pair" }).waitFor({ state: "hidden", timeout: 30_000 });
  check(true, "Decline removes the pending request from the global popup");
  console.log(`PASS pairing-popup-b: ${assertions} assertions; isolated local pairing handshake, no providers or Tailscale network`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolve) => app.process().once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  web.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const { execFileSync } = await import("node:child_process");
  const serverPort = env.JAGENTCHILL_PORT;
  const gatewayPort = env.JAGENTCHILL_GATEWAY_PORT;
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", `-iTCP:${serverPort}`, `-iTCP:${gatewayPort}`, `-iTCP:${webPort}`, "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), `no process from this test remains listening on ${serverPort}, ${gatewayPort}, or ${webPort}`);
}
