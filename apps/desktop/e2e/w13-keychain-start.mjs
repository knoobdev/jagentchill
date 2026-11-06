// Headless startup/recovery fixture for the prior Keychain identity. Each CASE is a fresh app profile and host.
// Run with JAGENTCHILL_E2E_RUN_DIR=.dev/run-w13c-cli-install-migrate-N and CASE=late|refused|never.
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { handshakeTranscript } from "../../../packages/protocol/src/handshake.ts";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR ?? "");
if (!/^\.dev\/run-w13c-cli-install-migrate-[1-9]\d*$/.test(process.env.JAGENTCHILL_E2E_RUN_DIR ?? "") || !runDir.startsWith(join(repoRoot, ".dev/run-w13c-cli-install-migrate-")) || existsSync(runDir)) throw new Error(`Unsafe or existing run directory: ${runDir}`);
const scenario = process.env.W13_KEYCHAIN_CASE;
if (!(scenario === "late" || scenario === "refused" || scenario === "never")) throw new Error("W13_KEYCHAIN_CASE must be late, refused, or never");
const port = Number(process.env.JAGENTCHILL_PORT);
if (port < 19110 || port > 19113 || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || process.argv.includes("open")) throw new Error("Use paired isolated host ports in 19110-19114; no visible browser or external app may be opened.");

const userData = join(runDir, "user-data"), library = join(runDir, "library"), home = join(runDir, "home");
const webDir = resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR ?? "apps/desktop/.dev/build/web-w13c-desktop");
const stateFile = join(runDir, "safe-storage-state.txt");
const shotDir = join(repoRoot, ".dev/shots/w13c-cli-install-migrate");
mkdirSync(join(userData, "identity"), { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(shotDir, { recursive: true });
writeFileSync(stateFile, scenario === "late" ? "late\n" : scenario === "never" ? "never\n" : "unavailable\n");

const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicRaw = createPublicKey(pair.privateKey).export({ type: "spki", format: "der" }).subarray(-32);
const priorDeviceId = createHash("sha256").update(publicRaw).digest("hex");
const protect = (text) => Buffer.from(Buffer.from(`v10${text}`, "utf8").map((byte) => byte ^ 0xa5)).toString("base64");
const gatewayId = "a".repeat(32), gatewayPublicKey = Buffer.alloc(32, 7).toString("base64url");
const oldHost = { gatewayId, gatewayPublicKey, gatewayName: "Paired Studio", origin: "http://127.0.0.1:19114", role: "admin", deviceToken: { value: "t".repeat(43), expires_ms: Date.now() + 86_400_000 }, verifiedClockOffset_ms: 0 };
writeFileSync(join(userData, "identity", "device.key"), JSON.stringify({ v: 1, protection: "os-store", data: protect(privatePem) }), { mode: 0o600 });
writeFileSync(join(userData, "identity", "secure-store.json"), JSON.stringify({ v: 1, protection: "os-store", values: { [`host/${gatewayId}`]: protect(JSON.stringify(oldHost)), "tailnet-auth-key": protect("tskey-fake-migrated") } }), { mode: 0o600 });
writeFileSync(join(userData, "desktop.json"), JSON.stringify({ connectionMode: "local", tailnetAuthKey: protect("tskey-fake-migrated") }));

const env = { ...process.env, HOME: home, JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library, JAGENTCHILL_WEB_DIR: webDir, JAGENTCHILL_PORT: String(port),
  JAGENTCHILL_GATEWAY_PORT: String(port + 1), JAGENTCHILL_TEST_KEY_STORE_STATE_FILE: stateFile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const launchedAt = Date.now();
try {
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  await page.waitForLoadState("domcontentloaded");
  let host;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    host = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch((error) => {
      if (/Execution context was destroyed/.test(String(error))) return null;
      throw error;
    });
    if (host?.state === "ready" && host.port === port && host.gatewayPort === port + 1) break;
    await new Promise((done) => setTimeout(done, 250));
  }
  check(host.port === port && host.gatewayPort === port + 1 && host.state === "ready", `isolated host reached ready: ${JSON.stringify(host)}`);
  check(/New blank project|Projects|Home/.test(await page.locator("body").innerText()), "window reached Home while recovery ran in the background");

  if (scenario === "late") {
    while (Date.now() - launchedAt < 120_000 && await page.evaluate(() => window.jagentchillDesktop.gateway.getLegacyIdentityRecovery()) !== "migrated") await page.waitForTimeout(250);
    check(Date.now() - launchedAt >= 20_000, "the fake Keychain read settled after 20 seconds");
    check(await page.evaluate(() => window.jagentchillDesktop.gateway.getLegacyIdentityRecovery()) === "migrated", "late Keychain read migrated successfully");
    const identity = await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey());
    check(identity.value.deviceId === priorDeviceId, "the old device identity is active after migration");
    check(identity.value.devicePublicKey === publicRaw.toString("base64url"), "the paired host still has the old device public key");
    const fields = await page.evaluate(({ gatewayId, gatewayNonce, deviceNonce }) => {
      const fields = { context: "connect", gatewayNonce, deviceNonce, ts: Date.now(), gatewayId, protocolVersion: 1 };
      return window.jagentchillDesktop.device.sign({ kind: "handshake", fields }).then((signed) => ({ fields, signed }));
    }, { gatewayId, gatewayNonce: Buffer.alloc(32, 1).toString("base64url"), deviceNonce: Buffer.alloc(32, 2).toString("base64url") });
    check("value" in fields.signed, `the migrated identity signs for its paired host (${"error" in fields.signed ? fields.signed.error.code : "missing signature"})`);
    const transcript = handshakeTranscript({ ...fields.fields, role: "device", deviceId: priorDeviceId, devicePublicKey: publicRaw.toString("base64url") });
    check(verifySignature(null, Buffer.from(transcript, "utf8"), pair.publicKey, Buffer.from(fields.signed.value.signature, "base64url")), "the old host's paired-device key validates the migrated identity signature");
    check(readFileSync(join(userData, "tailnet-auth-key"), "utf8") === "tskey-fake-migrated", "the old Tailscale key is present in the owner-only file");
    const reconnectDeadline = Date.now() + 30_000;
    while (Date.now() < reconnectDeadline) {
      host = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
      if (host?.state === "ready" && host.port === port && host.gatewayPort === port + 1) break;
      await page.waitForTimeout(250);
    }
    check(host?.state === "ready" && host.port === port && host.gatewayPort === port + 1, `the recovered identity is connected to its built-in host: ${JSON.stringify(host)}`);
    await page.screenshot({ path: join(shotDir, "01-home-identity-migrated.fake-keychain.png"), fullPage: true });
  } else if (scenario === "refused") {
    await page.getByTestId("legacy-identity-recovery").waitFor();
    check(await page.getByText("This computer could not restore its previous identity. Connect it again to use paired hosts.").count() === 1, "a calm recovery notice appears after the Keychain read is refused");
    await page.screenshot({ path: join(shotDir, "02-home-keychain-refused.fake-keychain.png"), fullPage: true });
    writeFileSync(stateFile, "success\n");
    await page.getByText("Try again", { exact: true }).click();
    const retryDeadline = Date.now() + 120_000;
    while (Date.now() < retryDeadline && await page.evaluate(() => window.jagentchillDesktop.gateway.getLegacyIdentityRecovery()) !== "migrated") await page.waitForTimeout(100);
    check(await page.evaluate(() => window.jagentchillDesktop.gateway.getLegacyIdentityRecovery()) === "migrated", "Try again repeats the read and migrates after fixture approval");
    check((await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey())).value.deviceId === priorDeviceId, "retry restored the old device identity");
    check(readFileSync(join(userData, "tailnet-auth-key"), "utf8") === "tskey-fake-migrated", "retry restored the Tailscale key");
  } else {
    const started = Date.now();
    await page.waitForTimeout(26_000);
    check(Date.now() - started >= 25_000, "the unanswered fake Keychain read did not block the event loop");
    check(await page.evaluate(() => window.jagentchillDesktop.gateway.getLegacyIdentityRecovery()) === "needs-action", "an unanswered read settles to the recovery notice");
    check(/New blank project|Projects|Home/.test(await page.locator("body").innerText()), "the app remains on Home when Keychain never answers");
    await page.getByTestId("legacy-identity-recovery").waitFor();
    await page.screenshot({ path: join(shotDir, "03-home-keychain-no-answer.fake-keychain.png"), fullPage: true });
  }
  console.log(`PASS w13-keychain-start ${scenario}: ${assertions} assertions; fake Keychain fixture; isolated host=${port}/${port + 1}; screenshot under ${shotDir}`);
} finally {
  if (app) {
    const ended = new Promise((done) => app.process().once("exit", done));
    await app.evaluate(({ app: desktopApp }) => desktopApp.quit()).catch(() => undefined);
    await Promise.race([ended, new Promise((done) => setTimeout(done, 30_000))]);
  }
}
