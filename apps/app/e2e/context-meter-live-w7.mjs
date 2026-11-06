// Captures no-turn Claude Code and Codex sessions with seeded usage rows and account reports fetched through the host's CLI sign-in path.
// Usage: JAGENTCHILL_PORT=18976 JAGENTCHILL_GATEWAY_PORT=18977 node apps/app/e2e/context-meter-live-w7.mjs --port 18976
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createHarness, model } from "../../../server/test/harness.ts";

const portArg = process.argv[process.argv.indexOf("--port") + 1];
const port = Number(process.env.JAGENTCHILL_PORT);
if (!portArg || Number(portArg) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || port !== 18976) throw new Error("Pass --port 18976 with JAGENTCHILL_GATEWAY_PORT=18977");
const dataDir = ".dev/run-w7n-meter6-1";
const hostOrigin = "http://localhost:8088";
const modelPrice = (ref) => ref.modelId === "gpt-6.1-sol" ? { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, cachedInputPerMillionUsd: 1, cacheWritePerMillionUsd: 2.5, source: "aggregator" }
  : ref.modelId === "sonnet" ? { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedInputPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75, source: "aggregator" }
    : undefined;
let harness, browser;
try {
  harness = await createHarness({
    dataDir, listenPort: port, allowedOrigins: [hostOrigin],
    models: [
      model("claude-cli", "sonnet", { contextWindow: 1_000_000 }),
      model("openai", "gpt-6.1-sol", { agentRuntime: { id: "codex" }, contextWindow: 1_000_000 }),
    ], connected: ["claude-cli", "openai"],
    // Keep the harness's fake CLI commands and Gateway catalogue, but let the production account reader
    // access the host's existing CLI sign-ins and make the two requested usage GETs.
    extra: { usageAccount: { fetch: globalThis.fetch }, modelPrice },
  });
  await harness.app.linkReady();
  const admin = await harness.pair("Context meter live account capture", "admin");
  const runtimes = await admin.call("jagentchill.runtime.config.get", {});
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: runtimes.config.revision, patch: { entries: { "claude-code": { enabled: true }, codex: { enabled: true } } } });
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code", "codex"] });
  const catalogue = await admin.call("jagentchill.runtime.models.list", {});
  for (const runtimeId of ["claude-code", "codex"]) {
    const group = catalogue.groups.find((entry) => entry.runtimeId === runtimeId);
    assert.ok(group?.providers.some((provider) => provider.models.length > 0), `fresh Gateway fixture lists a ${runtimeId} model`);
  }
  const claude = await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } });
  const codex = await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } });
  const seededUsage = harness.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`);
  seededUsage.run(claude.session.sessionKey, "fixture-claude-usage", "claude-code", "anthropic", "sonnet", 10_000, 2_000, 932_000, 1_000, 945_000, Date.now());
  seededUsage.run(codex.session.sessionKey, "fixture-codex-usage", "codex", "openai", "gpt-6.1-sol", 12_000, 1_000, 720_000, 4_000, 737_000, Date.now());
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
  await page.getByLabel("Name of this device", { exact: true }).fill("Context meter live capture browser");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Enter the code shown next to/).waitFor();
  for (let n = 0; n < 100; n++) {
    const requested = admin.events.find((event) => event.event === "jagentchill.pairing.requested" && event.payload.request.deviceName === "Context meter live capture browser");
    if (requested) { await page.getByLabel("Verification code", { exact: true }).fill(requested.payload.code); break; }
    await page.waitForTimeout(50);
  }
  await page.getByText("Connected", { exact: true }).waitFor();
  await page.setViewportSize({ width: 448, height: 636 });

  const capture = async (sessionKey, screenshotPath, label) => {
    await page.goto(`${hostOrigin}/h/${encodeURIComponent(offer.gatewayId)}/sessions/${encodeURIComponent(sessionKey)}`, { waitUntil: "networkidle" });
    const ring = page.getByTestId("context-meter");
    await ring.waitFor();
    await ring.hover();
    const panel = page.getByTestId("context-popover");
    await panel.waitFor();
    await page.getByText(label === "Claude Code" ? "94% used" : "74% used", { exact: true }).waitFor();
    // The account request is issued by the host when the meter opens. Wait for normalized quota rows from it.
    await page.waitForFunction(() => document.querySelector('[data-testid^="context-limit-"]') !== null, undefined, { timeout: 20_000 });
    await ring.click();
    assert.equal(await ring.getAttribute("data-pinned"), "true");
    await panel.locator('[data-testid^="context-limit-"]').first().waitFor();
    await page.getByRole("button", { name: label === "Claude Code" ? "Session cost $0.34335" : "Session cost $0.77" }).waitFor();
    await page.screenshot({ path: screenshotPath });
    assert.equal(harness.app.db.prepare("SELECT COUNT(*) AS n FROM session_usage WHERE session_key = ?").get(sessionKey).n, 1, `${label} capture has one seeded usage row, no model turn`);
    assert.equal(harness.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE session_key = ?").get(sessionKey).n, 0, `${label} capture has no seeded usage records`);
    console.log(`CAPTURED ${label}: account report is host-fetched; seeded prompt tokens and list-price fixture; no model turn; ${screenshotPath}`);
  };
  await capture(claude.session.sessionKey, ".refs/apply/briefs/context-meter-6-claude.png", "Claude Code");
  await capture(codex.session.sessionKey, ".refs/apply/briefs/context-meter-6-codex.png", "Codex");
  await browser.close(); browser = undefined;
  harness.stop(); harness = undefined;
} catch (error) {
  if (browser) await browser.close().catch(() => undefined);
  if (harness) harness.stop();
  throw error;
}
