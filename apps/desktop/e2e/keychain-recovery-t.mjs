import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8t-host-start-visible-1");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
const userData = join(runDir, "user-data");
const home = join(runDir, "home");
const library = join(runDir, "library");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8t-host-start-visible-1");
const storeState = join(runDir, "safe-storage-state.txt");
const evidence = join(repoRoot, ".dev/evidence");
mkdirSync(userData, { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(evidence, { recursive: true });
writeFileSync(storeState, "available\n");
writeFileSync(join(userData, "desktop.json"), JSON.stringify({ connectionMode: "local", hostPort: 18955, hostPorts: { serverPort: 18955, gatewayPort: 18956 } }, null, 2));
const env = {
  ...process.env,
  HOME: home,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: webDir,
  JAGENTCHILL_PORT: "18955",
  JAGENTCHILL_GATEWAY_PORT: "18956",
  JAGENTCHILL_TEST_KEY_STORE_STATE_FILE: storeState,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const waitFor = async (predicate, what, timeout = 90_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
};
const launch = async () => {
  const electron = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  return { app: electron, page: await electron.firstWindow({ timeout: 150_000 }) };
};
const quit = async (electron) => {
  if (!electron) return;
  const ended = new Promise((done) => electron.process().once("exit", done));
  await electron.evaluate(({ app: desktopApp }) => desktopApp.quit()).catch(() => undefined);
  await Promise.race([ended, new Promise((done) => setTimeout(done, 30_000))]);
};
try {
  ({ app, page } = await launch());
  const firstStatus = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
    return status.gatewayId && ["ready", "degraded"].includes(status.state) ? status : null;
  }, "the initial host and its OS-store identity");
  check(firstStatus.port === 18955 && firstStatus.gatewayPort === 18956, "initial host uses server/Gateway ports 18955/18956");
  check(existsSync(join(userData, "identity", "device.key")), "first launch created the OS-store identity used by the failure reproduction");
  await quit(app);
  app = null;

  writeFileSync(storeState, "unavailable\n");
  ({ app, page } = await launch());
  await page.getByTestId("host-keychain-access-message").waitFor({ timeout: 30_000 });
  const message = await page.getByTestId("host-keychain-access-message").innerText();
  check(message === "JAgentChill needs access to its key in your keychain. macOS asks once per installed version — choose Always Allow, then press Try again.", "the blocking keychain panel gives the requested recovery instruction");
  check(await page.getByTestId("host-keychain-retry").getAttribute("aria-disabled") !== "true", "Try again is available");
  await page.screenshot({ path: join(evidence, "w8t-keychain-retry-blocking.png"), fullPage: true });
  const mainLogPath = join(userData, "logs", "main.log");
  const diagnosticsPath = join(userData, "logs", "diagnostics.log");
  await waitFor(() => existsSync(mainLogPath) && readFileSync(mainLogPath, "utf8").includes("launch failed reason=key_storage_unavailable"), "the main log failure reason");
  check(readFileSync(diagnosticsPath, "utf8").includes("launch failed reason=key_storage_unavailable step=identity"), "diagnostics.log records the key-store failure reason and step");
  check(readFileSync(mainLogPath, "utf8").includes("launch failed reason=key_storage_unavailable step=identity"), "main.log records the key-store failure reason and step");

  writeFileSync(storeState, "available\n");
  await page.getByTestId("host-keychain-retry").click();
  const recovered = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
    return status.gatewayId && ["ready", "degraded"].includes(status.state) ? status : null;
  }, "Try again to start the existing host");
  check(recovered.port === 18955 && recovered.gatewayPort === 18956, "Try again starts the host on its remembered ports");
  check(await page.getByTestId("host-keychain-access-message").count() === 0, "the blocking keychain panel closes after recovery");
  const footer = await waitFor(async () => {
    const text = await page.getByTestId("connection-chip").innerText().catch(() => "");
    return text === "Connected · Local" ? text : null;
  }, "the app to reconnect to the recovered host", 45_000);
  check(footer === "Connected · Local", "the user path returns to a connected host after Retry");
  await page.screenshot({ path: join(evidence, "w8t-keychain-retry-recovered.png"), fullPage: true });
  console.log(`PASS keychain-recovery-t: ${assertions} assertions`);
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, "w8t-keychain-retry-failure.png"), fullPage: true }).catch(() => undefined);
  console.error("keychain recovery failure", error, page ? await page.locator("body").innerText().catch(() => "") : "");
  throw error;
} finally {
  await quit(app);
}
