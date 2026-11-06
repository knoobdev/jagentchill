// Verifies the requested sign-in-required state through the composer. Account credentials and HTTP are injected fixtures.
// Usage: JAGENTCHILL_PORT=18978 JAGENTCHILL_GATEWAY_PORT=18979 node apps/app/e2e/context-meter-signin-w7.mjs --port 18978
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createHarness, model } from "../../../server/test/harness.ts";

const portArg = process.argv[process.argv.indexOf("--port") + 1];
const port = Number(process.env.JAGENTCHILL_PORT);
if (!portArg || Number(portArg) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || port !== 18978) throw new Error("Pass --port 18978 with JAGENTCHILL_GATEWAY_PORT=18979");
const dataDir = ".dev/run-w7n-meter6-2";
const shots = ".dev/shots/w7n-context-meter-meter6";
mkdirSync(shots, { recursive: true });
const hostOrigin = "http://localhost:8088";
const modelPrice = (ref) => ref.modelId === "gpt-6.1-sol" ? { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, cachedInputPerMillionUsd: 1, cacheWritePerMillionUsd: 2.5, source: "aggregator" }
  : ref.modelId === "sonnet" ? { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedInputPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75, source: "aggregator" }
    : undefined;
let harness, browser;
try {
  harness = await createHarness({
    dataDir, listenPort: port, allowedOrigins: [hostOrigin], models: [
      model("claude-cli", "sonnet", { contextWindow: 1_000_000 }),
      model("openai", "gpt-6.1-sol", { agentRuntime: { id: "codex" } }),
    ], connected: ["claude-cli", "openai"], installed: ["claude"],
    extra: { modelPrice, usageAccount: {
      readClaudeCredentials: async () => ({ claudeAiOauth: { accessToken: "stub-invalid-claude-token", subscriptionType: "max" } }),
      readCodexCredentials: async () => null,
      fetch: async () => new Response("", { status: 401 }),
    } },
  });
  await harness.app.linkReady();
  const admin = await harness.pair("Context meter sign-in fixture", "admin");
  const runtimes = await admin.call("jagentchill.runtime.config.get", {});
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: runtimes.config.revision, patch: { entries: { "claude-code": { enabled: true } } } });
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const catalogue = await admin.call("jagentchill.runtime.models.list", {});
  const session = await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } });
  const seededUsage = harness.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`);
  seededUsage.run(session.session.sessionKey, "previous-codex-turn", "codex", "openai", "gpt-6.1-sol", 12_000, 1_000, 720_000, 4_000, 737_000, Date.now() - 1000);
  seededUsage.run(session.session.sessionKey, "current-claude-turn", "claude-code", "anthropic", "sonnet", 10_000, 2_000, 932_000, 1_000, 945_000, Date.now());
  const offer = await admin.call("jagentchill.pairing.offer.create", { role: "admin" });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: "light" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => { throw error; });
  await page.goto(`${hostOrigin}/home`, { waitUntil: "networkidle" });
  await page.getByText("What do you want to make?").waitFor();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Pairing link", { exact: true }).fill(offer.url);
  await page.getByLabel("Name of this device", { exact: true }).fill("Context meter sign-in browser");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Enter the code shown next to/).waitFor();
  for (let n = 0; n < 100; n++) {
    const requested = admin.events.find((event) => event.event === "jagentchill.pairing.requested" && event.payload.request.deviceName === "Context meter sign-in browser");
    if (requested) { await page.getByLabel("Verification code", { exact: true }).fill(requested.payload.code); break; }
    await page.waitForTimeout(50);
  }
  await page.getByText("Connected", { exact: true }).waitFor();
  await page.goto(`${hostOrigin}/h/${encodeURIComponent(offer.gatewayId)}/sessions/${encodeURIComponent(session.session.sessionKey)}`, { waitUntil: "networkidle" });
  const ring = page.getByTestId("context-meter");
  await ring.waitFor();
  await ring.hover();
  await page.getByTestId("context-sign-in-required").getByText("Sign in again in Claude Code", { exact: true }).waitFor();
  await ring.click();
  assert.equal(await ring.getAttribute("data-pinned"), "true", "pin the report before capturing it");
  await page.getByTestId("context-sign-in-required").waitFor();
  await page.getByText("94% used", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Session cost $1.11335" }).waitFor();
  await page.screenshot({ path: `${shots}/sign-in-required-fixture.png` });
  await page.screenshot({ path: `${shots}/model-switch-session-cost-fixture.png` });
  assert.equal(await page.getByTestId("context-sign-in-required").count(), 1);
  assert.equal(await page.getByText("943k / 1M tokens", { exact: true }).count(), 1, "context follows the current Claude model after the prior Codex turn");
  assert.equal(harness.app.db.prepare("SELECT COUNT(*) AS n FROM session_usage WHERE session_key = ?").get(session.session.sessionKey).n, 2);
  console.log("PASS sign-in-required UI and model-switch session cost: current Claude context is 943000/1000000; $1.11335 spans Codex $0.77 plus Claude $0.34335; fake HTTP 401; no live credential or request used");
  await browser.close(); browser = undefined;
  harness.stop(); harness = undefined;
} catch (error) {
  if (browser) await browser.close().catch(() => undefined);
  if (harness) harness.stop();
  throw error;
}
