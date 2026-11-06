import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createHarness as createHarnessBase, model, type Harness } from "./harness.ts";
import { priceSessionUsageRows } from "../src/usage/service.ts";
import { anthropicCatalogueModelId } from "../src/providers/aggregator.ts";

const open: Harness[] = [];
async function createHarness(options: Parameters<typeof createHarnessBase>[0] = {}) {
  return createHarnessBase({ ...options, dataDir: mkdtempSync(join(tmpdir(), "jagentchill-usage-cost-")) });
}
afterEach(() => { for (const h of open.splice(0)) { try { h.close(); } catch { /* already closed */ } } });

test("session cost prices every reported CLI turn across model switches when cost is null", async () => {
  const h = await createHarness({
    models: { codex: [model("gpt-6.1-sol")] },
    extra: { modelPrice: (ref) => ref.modelId === "gpt-6.1-sol" ? {
      inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, cachedInputPerMillionUsd: 1, cacheWritePerMillionUsd: 2.5, source: "aggregator",
    } : ref.modelId === "claude-opus-5-5" ? {
      inputPerMillionUsd: 15, outputPerMillionUsd: 75, cachedInputPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75, source: "aggregator",
    } : undefined },
  });
  open.push(h);
  const admin = await h.pair("Session cost fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  const insert = h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`);
  insert.run(sessionKey, "codex-turn", "codex", "openai", "gpt-6.1-sol", 12_000, 1_000, 720_000, 4_000, 737_000, Date.now() - 1000);
  insert.run(sessionKey, "claude-turn", "claude-code", "anthropic", "claude-opus-5-5", 10_000, 2_000, 5_000, 1_000, 18_000, Date.now());

  const result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  assert.equal(result.session.sessionCostUsd, 1.09625);
  h.close();
});

test("session with 195 unpriced Codex turns keeps the priced part and names the omitted model", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol")] } });
  open.push(h);
  const admin = await h.pair("Unpriced session fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  const insert = h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, 'codex', 'openai', 'gpt-6.1-sol', 30_329, 0, 0, 0, 30_329, NULL, 1, ?)`);
  for (let index = 0; index < 195; index++) insert.run(sessionKey, `codex-${index + 1}`, Date.now() - 195 + index);

  const result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  assert.equal(result.session.sessionCostUsd, 0);
  assert.equal(result.session.costUnavailableReason, "no-list-price");
  assert.deepEqual(result.session.costUnavailableModels, ["openai/gpt-6.1-sol"]);
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM session_usage WHERE session_key = ? AND runtime_id = 'codex' AND model_id = 'gpt-6.1-sol'").get(sessionKey)?.n, 195);
  h.close();
});

test("session pricing tolerates malformed and unpriced rows, exact IDs, model switches, null parts and stale totals", async () => {
  const h = await createHarness({
    models: { codex: [model("gpt-6.1-sol")], "claude-code": [model("claude-opus-5-5")] },
    extra: { modelPrice: (ref) => ref.runtimeId === "codex" && ref.providerId === "openai" && ref.modelId === "gpt-6.1-sol" ? {
      inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, cachedInputPerMillionUsd: 1, cacheWritePerMillionUsd: 2.5, source: "aggregator",
    } : ref.runtimeId === "claude-code" && ref.providerId === "anthropic" && ref.modelId === "claude-opus-5-5" ? {
      inputPerMillionUsd: 15, outputPerMillionUsd: 75, cachedInputPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75, source: "aggregator",
    } : undefined },
  });
  open.push(h);
  const admin = await h.pair("Mixed row session fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  const insert = h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
  // Same model as the current session, and a total_tokens value that exceeds the priced parts.
  insert.run(sessionKey, "priced-codex", "codex", "openai", "gpt-6.1-sol", 10_000, 1_000, 20_000, 3_000, 99_999, 1, 1);
  // NULL token columns are absent parts, not a failure of all the other rows.
  insert.run(sessionKey, "null-parts", "codex", "openai", "gpt-6.1-sol", null, null, null, null, null, 1, 2);
  // Exact provider/model identity matters: case changes and suffixes do not get fuzzy-matched.
  insert.run(sessionKey, "provider-case", "codex", "OPENAI", "gpt-6.1-sol", 100_000, 0, 0, 0, 100_000, 1, 3);
  insert.run(sessionKey, "model-case", "codex", "openai", "GPT-6.1-sol", 100_000, 0, 0, 0, 100_000, 1, 4);
  insert.run(sessionKey, "model-suffix", "codex", "openai", "gpt-6.1-sol-high", 100_000, 0, 0, 0, 100_000, 1, 5);
  // This earlier Claude row is part of the session cost despite the current model being Codex.
  insert.run(sessionKey, "before-switch", "claude-code", "anthropic", "claude-opus-5-5", 2_000, 0, 0, 0, 2_000, 1, 6);
  // Command-only usage row is all zero; the adjacent usage_records cached estimate is not a model request.
  insert.run(sessionKey, "status-command", "codex", "openai", "gpt-6.1-sol", 0, 0, 0, 0, 0, 1, 7);
  // A command-only row with no model identity is likewise not an unavailable model.
  insert.run(sessionKey, "status-command-no-model", "codex", "openai", null, 0, 0, 0, 0, 0, 1, 75);
  h.app.db.prepare(`INSERT INTO usage_records (session_key, run_id, root_session_key, agent_id, runtime_id, provider_id, model_id, billing, outcome, token_source, cost_source, price_source, started_ms, input_tokens, cached_input_tokens, output_tokens, total_tokens, context_used, open)
    VALUES (?, 'status-command', ?, 'agent', 'codex', 'openai', 'gpt-6.1-sol', 'plan', 'completed', 'reported', 'included', 'aggregator', 7, 0, 131072, 0, 131072, 131072, 0)`)
    .run(sessionKey, sessionKey);
  // Reported=0 rows are excluded; they cannot introduce a false unpriced model.
  insert.run(sessionKey, "not-reported", "codex", "missing-provider", "unknown-model", 500_000, 0, 0, 0, 500_000, 0, 8);
  // total_tokens is metadata; only the explicit token parts are priced.
  insert.run(sessionKey, "parts-only", "codex", "openai", "gpt-6.1-sol", 100, null, null, null, 999_999, 1, 9);

  const result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  assert.equal(result.session.sessionCostUsd, 0.09275);
  assert.equal(result.session.costUnavailableReason, "no-list-price");
  assert.deepEqual(result.session.costUnavailableModels, ["OPENAI/gpt-6.1-sol", "openai/GPT-6.1-sol", "openai/gpt-6.1-sol-high"]);
  h.close();
});

test("test-only cost hook identifies every row disposition without logging credentials", async () => {
  const diagnostics: Array<{ rowId: number; modelId: string | null; disposition: string; pricedUsd: number; unavailableTokenClasses: string[] }> = [];
  const result = await priceSessionUsageRows([
    { id: 1, runtime_id: "codex", provider_id: "openai", model_id: "gpt-6.1-sol", input_tokens: 10_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 10_000 },
    { id: 2, runtime_id: "codex", provider_id: "openai", model_id: "gpt-6.1-sol", input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: null },
    { id: 3, runtime_id: "codex", provider_id: "openai", model_id: "gpt-6.1-sol", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0 },
    { id: 4, runtime_id: "codex", provider_id: "openai", model_id: "GPT-6.1-sol", input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1 },
    { id: 5, runtime_id: "codex", provider_id: null, model_id: "unknown-model", input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1 },
    { id: 6, runtime_id: "codex", provider_id: "openai", model_id: "gpt-6.1-sol", input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 20 },
  ], (ref) => ref.modelId === "gpt-6.1-sol" ? { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, source: "aggregator" } : undefined,
  (entry) => diagnostics.push(entry));
  assert.equal(result.costUsd, 0.025);
  assert.equal(result.hasRequest, true);
  assert.deepEqual(result.unavailableModels, ["openai/GPT-6.1-sol", "openai/gpt-6.1-sol", "unknown-model"]);
  assert.deepEqual(diagnostics.map(({ rowId, disposition }) => [rowId, disposition]), [
    [1, "priced"], [2, "zero-request"], [3, "zero-request"], [4, "partial"], [5, "malformed"], [6, "malformed"],
  ]);
});

test("Codex session cost matches its exact OpenRouter catalogue model and uses published cache rates", async () => {
  const requested: string[] = [];
  const h = await createHarness({
    models: { codex: [model("gpt-6.1-sol")] },
    http: async (url) => {
      requested.push(url);
      return new Response(JSON.stringify({ data: [{
        id: "openai/gpt-6.1-sol",
        name: "OpenAI: GPT-6.1 Sol",
        pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001", input_cache_write: "0.0000025" },
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  open.push(h);
  const admin = await h.pair("Codex catalogue fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", {
    ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" },
  })).session.sessionKey as string;
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, 'codex-priced', 'codex', 'openai', 'gpt-6.1-sol', 10000, 1000, 20000, 3000, 34000, NULL, 1, ?)`)
    .run(sessionKey, Date.now());

  let result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  for (let n = 0; result.session.sessionCostUsd === undefined && n < 20; n++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  }
  assert.equal(result.session.sessionCostUsd, 0.0395);
  assert.deepEqual(requested, ["https://openrouter.ai/api/v1/models"]);
  h.close();
});

test("Anthropic CLI IDs normalize only the documented Claude version spelling", () => {
  assert.equal(anthropicCatalogueModelId("claude-opus-5-5"), "claude-opus-5.5");
  assert.equal(anthropicCatalogueModelId("claude-opus-5-5-20260801"), "claude-opus-5.5");
  assert.equal(anthropicCatalogueModelId("claude-opus-5-5-latest"), "claude-opus-5.5");
  assert.equal(anthropicCatalogueModelId("claude-opus-5"), "claude-opus-5");
  assert.equal(anthropicCatalogueModelId("claude-sonnet-5-5"), "claude-sonnet-5.5");
  assert.equal(anthropicCatalogueModelId("claude-opus-5-55"), "claude-opus-5.55");
  assert.equal(anthropicCatalogueModelId("claude-opus-5-5:batch"), "claude-opus-5-5:batch");
});

test("Claude session pricing matches normalized catalogue IDs and lists only unavailable exact models", async () => {
  const requested: string[] = [];
  const h = await createHarness({
    models: { "claude-code": [model("sonnet")] },
    http: async (url) => {
      requested.push(url);
      return new Response(JSON.stringify({ data: [
        { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", pricing: { prompt: "0.000004", completion: "0.00002", input_cache_read: "0.0000002", input_cache_write: "0.000005" } },
        { id: "anthropic/claude-opus-5", name: "Claude Opus 5", pricing: { prompt: "0.000003", completion: "0.000015" } },
        // Deliberately no anthropic/claude-sonnet-5.5: normalized IDs still require an exact catalogue entry.
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  open.push(h);
  const admin = await h.pair("Claude catalogue spelling fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", {
    ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" },
  })).session.sessionKey as string;
  const insert = h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, 'claude-code', 'anthropic', ?, ?, 0, 0, 0, ?, NULL, 1, ?)`);
  insert.run(sessionKey, "opus-alias", "claude-opus-5-5", 1_000_000, 1_000_000, Date.now() - 5);
  insert.run(sessionKey, "opus-dated-alias", "claude-opus-5-5-20260801", 1_000_000, 1_000_000, Date.now() - 4);
  insert.run(sessionKey, "opus-major-only", "claude-opus-5", 1_000_000, 1_000_000, Date.now() - 3);
  insert.run(sessionKey, "sonnet-absent", "claude-sonnet-5-5", 1_000_000, 1_000_000, Date.now() - 2);
  insert.run(sessionKey, "opus-55", "claude-opus-5-55", 1_000_000, 1_000_000, Date.now() - 1);
  insert.run(sessionKey, "opus-batch", "claude-opus-5-5:batch", 1_000_000, 1_000_000, Date.now());

  const result = await admin.call("jagentchill.usage.session.get", { sessionId: sessionKey });
  assert.equal(result.session.sessionCostUsd, 11);
  assert.equal(result.session.costUnavailableReason, "no-list-price");
  assert.deepEqual(result.session.costUnavailableModels, [
    "anthropic/claude-opus-5-55", "anthropic/claude-opus-5-5:batch", "anthropic/claude-sonnet-5-5",
  ]);
  assert.deepEqual(requested, ["https://openrouter.ai/api/v1/models"]);
  h.close();
});

test("Claude Code's reported usage of a turn reaches the host's session usage, without the cost it estimates on a subscription", async () => {
  const h = await createHarness({
    models: { "claude-code": [model("sonnet")] },
  });
  open.push(h);
  const admin = await h.pair("Claude event fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", {
    ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" },
  })).session.sessionKey as string;
  await admin.call("jagentchill.chat.send", { sessionKey, message: "fixture prompt" });
  // What the Claude adapter reports from the SDK's result message.
  const usage = { inputTokens: 12_000, outputTokens: 800, cacheReadTokens: 3_000, cacheWriteTokens: 500, costUsd: 0.12 };
  console.log("CLAUDE_CODE_FAKE_RUNTIME_USAGE", JSON.stringify(usage));
  h.fake.reply(sessionKey, "fixture response", { usage });

  for (let n = 0; n < 100; n++) {
    const row = h.app.db.prepare("SELECT reported, input_tokens, output_tokens, cost FROM session_usage WHERE session_key = ?").get(sessionKey) as
      { reported: number; input_tokens: number; output_tokens: number; cost: number | null } | undefined;
    if (row) {
      assert.deepEqual({ ...row }, { reported: 1, input_tokens: 12_000, output_tokens: 800, cost: null });
      h.close();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Claude Code usage was not recorded by the host");
});
