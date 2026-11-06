import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = join(repoRoot, ".dev/run-w8v-host-start-ports-4");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8v-host-start-ports-1");
const evidence = join(repoRoot, ".dev/evidence");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Missing Electron web export: ${webDir}`);
const userData = join(runDir, "user-data"), home = join(runDir, "home"), library = join(runDir, "library");
for (const directory of [userData, home, library, join(userData, "identity")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(evidence, { recursive: true });
const fixtureKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
writeFileSync(join(userData, "identity", "device.key"), JSON.stringify({ v: 1, protection: "file", data: Buffer.from(fixtureKey).toString("base64") }), { mode: 0o600 });
writeFileSync(join(userData, "desktop.json"), JSON.stringify({ connectionMode: "local", hostPort: 18952, hostPorts: { serverPort: 18952, gatewayPort: 18953 } }));

const env = { ...process.env, HOME: home, JAGENTCHILL_USER_DATA: userData, JAGENTCHILL_LIBRARY_DIR: library, JAGENTCHILL_WEB_DIR: webDir, JAGENTCHILL_UNATTENDED: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.JAGENTCHILL_PORT;
delete env.JAGENTCHILL_GATEWAY_PORT;
let app;
let blocker;
let assertions = 0;
const check = (condition, description) => { assert.ok(condition, description); assertions++; };
const waitFor = async (predicate, label, timeout = 90_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
try {
  blocker = createServer();
  await new Promise((resolveListen, reject) => { blocker.once("error", reject); blocker.listen(18952, "127.0.0.1", resolveListen); });
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  const first = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
    return status && ["ready", "degraded"].includes(status.state) && status.gatewayId ? status : null;
  }, "the host on the next available pair");
  check(first.port === 18953 && first.gatewayPort === 18954, "the busy remembered 18952/18953 pair advances to 18953/18954 inside the assigned range");
  const diagnostics = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
  check(diagnostics.portChange?.previous === "18952/18953" && diagnostics.portChange?.current === "18953/18954", "host status reports the previous and replacement port pairs");
  const mainLog = await import("node:fs").then(({ readFileSync }) => readFileSync(join(userData, "logs/main.log"), "utf8"));
  check(mainLog.includes("remembered host port pair 18952/18953 was occupied; using 18953/18954"), "main and diagnostics log the reason for the single port change");

  await waitFor(async () => (await import("node:fs").then(({ readFileSync }) => readFileSync(join(userData, "logs/main.log"), "utf8"))).includes("reload after built-in host bootstrap on port=18953"), "the bootstrap reload to finish");
  await page.waitForTimeout(1000);

  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("help.diagnostics"));
  const panel = page.getByTestId("host-panel");
  await panel.waitFor({ timeout: 15_000 });
  const portNotice = page.getByTestId("host-port-changed");
  try { await portNotice.waitFor({ timeout: 10_000 }); }
  catch (error) { await page.screenshot({ path: join(evidence, "w8v2-port-change-callout-failure.png"), fullPage: true }); console.error("host panel state:", await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()), "visible:", (await page.locator("body").innerText()).slice(-1200)); throw error; }
  check((await portNotice.innerText()).includes("18952/18953") && (await portNotice.innerText()).includes("18953/18954"), "the host panel announces the old and replacement pairs");
  check((await page.getByTestId("host-port").innerText()).includes("18953"), "the host panel's Port row shows 18953");
  await page.screenshot({ path: join(evidence, "w8v2-remembered-port-moved.png"), fullPage: true });

  await page.getByTestId("host-restart").click();
  const restarted = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
    return status && ["ready", "degraded"].includes(status.state) && status.port === 18953 ? status : null;
  }, "restart on remembered 18953/18954");
  check(restarted.port === 18953 && restarted.gatewayPort === 18954, "host restart reuses the remembered replacement pair");
  const afterRestartLog = await import("node:fs").then(({ readFileSync }) => readFileSync(join(userData, "logs/main.log"), "utf8"));
  check((afterRestartLog.match(/server started .*port=18953 gatewayPort=18954/g) ?? []).length >= 2, "both starts use 18953/18954 without ending the just-started child");
  await page.screenshot({ path: join(evidence, "w8v2-remembered-port-restart.png"), fullPage: true });
  console.log(`PASS host-port-drift-v: ${assertions} assertions; one foreign port blocker; local host fixture only; no provider/model calls`);
} finally {
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolveExit) => app.process().once("exit", resolveExit)), new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  if (blocker?.listening) await new Promise((resolveClose) => blocker.close(resolveClose));
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18950-18954", "-sTCP:LISTEN"], { encoding: "utf8" }); }
  catch (error) { listeners = String(error.stdout ?? ""); }
  assert.ok(!/LISTEN/.test(listeners), "no test process remains listening on 18950–18954");
}
