import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHarness, model, type Harness } from "./harness.ts";

/** Starts a turn on a session and names its run, as the runtime would. */
async function turn(h: Harness, admin: Awaited<ReturnType<Harness["pair"]>>, sessionKey: string, runId: string): Promise<void> {
  h.fake.on("startTurn", () => ({ turnId: runId }));
  try { await admin.call("jagentchill.chat.send", { sessionKey, message: "go" }); } finally { h.fake.reset("startTurn"); }
}

const open: Harness[] = [];
afterEach(() => { for (const h of open.splice(0)) { try { h.close(); } catch { /* already closed */ } } });

test("session context meter starts at zero with a known window and keeps counts without a window", async () => {
  const h = await createHarness({ models: { "claude-code": [model("known-window", { contextWindow: 1_000_000 }), model("unknown-window")] } });
  open.push(h);
  const admin = await h.pair("Meter fixture", "admin");
  const known = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "known-window" } })).session.sessionKey as string;
  const unknown = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "unknown-window" } })).session.sessionKey as string;

  const knownState = await admin.call("jagentchill.session.context.get", { sessionKey: known });
  assert.deepEqual(knownState.context, { usedTokens: 0, maxTokens: 1_000_000, pct: 0, updated_ms: knownState.context.updated_ms });
  const unknownState = await admin.call("jagentchill.session.context.get", { sessionKey: unknown });
  assert.deepEqual(unknownState.context, { usedTokens: 0, updated_ms: unknownState.context.updated_ms });
  h.close();
});

test("CLI context uses the latest reported prompt including cache tokens", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol", { contextWindow: 1_000_000 })] } });
  open.push(h);
  const admin = await h.pair("Meter CLI fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, 'codex', 'openai', 'gpt-6.1-sol', ?, ?, ?, ?, ?, NULL, 1, ?)`)
    .run(sessionKey, "older", 900_000, 500, 0, 0, 900_500, Date.now() - 60_000);
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, 'codex', 'openai', 'gpt-6.1-sol', ?, ?, ?, ?, ?, NULL, 1, ?)`)
    .run(sessionKey, "latest", 12_000, 500, 720_000, 2_000, 734_500, Date.now());

  const state = await admin.call("jagentchill.session.context.get", { sessionKey });
  assert.deepEqual(state.context, { usedTokens: 734_000, maxTokens: 1_000_000, pct: 73, updated_ms: state.context.updated_ms });
  h.close();
});

test("Codex's reported context window is used when the catalogue has none", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol")] } });
  open.push(h);
  const admin = await h.pair("Meter Codex context event", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  await turn(h, admin, sessionKey, "codex-window");
  // What the Codex adapter reports from the app-server's `thread/tokenUsage/updated`.
  h.fake.usage(sessionKey, { inputTokens: 806_000, contextWindow: 1_000_000 });
  h.fake.endTurn(sessionKey, "codex-window");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const state = await admin.call("jagentchill.session.context.get", { sessionKey });
  assert.deepEqual(state.context, { usedTokens: 806_000, maxTokens: 1_000_000, pct: 81, updated_ms: state.context.updated_ms });
  const stored = h.app.db.prepare("SELECT context_used, context_max FROM usage_records WHERE session_key = ? AND run_id = ?").get(sessionKey, "codex-window") as { context_used: number; context_max: number };
  assert.deepEqual({ ...stored }, { context_used: 806_000, context_max: 1_000_000 });
  h.close();
});

test("context window learned on a prior session is remembered for the same runtime and model", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol")] } });
  open.push(h);
  const admin = await h.pair("Remembered context window", "admin");
  const ref = { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" };
  const first = (await admin.call("jagentchill.session.create", { ref })).session.sessionKey as string;
  await turn(h, admin, first, "learn-window");
  h.fake.usage(first, { inputTokens: 30_329, contextWindow: 1_000_000 });
  h.fake.endTurn(first, "learn-window");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const next = (await admin.call("jagentchill.session.create", { ref })).session.sessionKey as string;
  const state = await admin.call("jagentchill.session.context.get", { sessionKey: next });
  assert.deepEqual(state.context, { usedTokens: 0, maxTokens: 1_000_000, pct: 0, updated_ms: state.context.updated_ms });
  h.close();
});

test("a session switched to a model with a remembered window shows that model's empty context", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol"), model("codex-next")] } });
  open.push(h);
  const admin = await h.pair("Switched model context", "admin");
  const first = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "codex-next" } })).session.sessionKey as string;
  await turn(h, admin, first, "learn-next-window");
  h.fake.usage(first, { inputTokens: 13_000, contextWindow: 1_000_000 });
  h.fake.endTurn(first, "learn-next-window");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "codex-next" } })).session.sessionKey as string;
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, 'previous-model-turn', 'codex', 'openai', 'gpt-6.1-sol', 30329, 0, 0, 0, 30329, NULL, 1, ?)`)
    .run(sessionKey, Date.now());
  const state = await admin.call("jagentchill.session.context.get", { sessionKey });
  assert.deepEqual(state.context, { usedTokens: 0, maxTokens: 1_000_000, pct: 0, updated_ms: state.context.updated_ms });
  h.close();
});

test("owner Codex rows ignore the later /status context estimate and keep the last model context", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol", { contextWindow: 258_400 })] } });
  open.push(h);
  const admin = await h.pair("Owner Codex rows fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;

  // Exact token/context values from the owner's session, in both host tables.
  h.app.db.exec("DELETE FROM session_usage; DELETE FROM usage_records;");
  const records = h.app.db.prepare(`INSERT INTO usage_records
    (id, session_key, run_id, root_session_key, agent_id, runtime_id, provider_id, model_id, billing, outcome,
     input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, total_tokens, token_source, cost_source, price_source,
     started_ms, duration_ms, context_used, context_max, reconciled, open)
    VALUES (?, ?, ?, ?, 'agent-main', 'codex', 'openai', 'gpt-6.1-sol', 'plan', 'completed', ?, ?, ?, ?, ?, 'reported', 'included', 'none', ?, ?, ?, ?, 0, 0)`);
  const usage = h.app.db.prepare(`INSERT INTO session_usage
    (id, session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, ?, ?, 'codex', 'openai', 'gpt-6.1-sol', ?, ?, ?, ?, ?, NULL, 1, ?)`);
  const stamp = (value: string) => new Date(value).getTime();
  const t314 = stamp("2026-10-08T18:25:21+07:00"), t314Usage = stamp("2026-10-08T18:25:27+07:00");
  const t335 = stamp("2026-10-10T22:52:49+07:00"), t335Usage = stamp("2026-10-10T22:52:58+07:00");
  const t337 = stamp("2026-10-10T23:53:20+07:00"), t337Usage = stamp("2026-10-10T23:53:23+07:00");
  records.run(314, sessionKey, "3bfe0240", sessionKey, 434, 132_480, 0, 44, 132_958, t314, 6_000, 132_914, null);
  records.run(335, sessionKey, "390ceb4e", sessionKey, 30_329, 0, 0, 15, 30_344, t335, 9_000, 30_344, 258_400);
  records.run(337, sessionKey, "fd592e3e", sessionKey, 0, 131_072, 0, 0, 131_072, t337, 3_000, 131_072, null);
  usage.run(213, sessionKey, "3bfe0240", 434, 44, 132_480, 0, 132_958, t314Usage);
  usage.run(229, sessionKey, "390ceb4e", 30_329, 15, 0, 0, 30_344, t335Usage);
  usage.run(230, sessionKey, "fd592e3e", 0, 0, 0, 0, 0, t337Usage);

  const result = await admin.call("jagentchill.session.context.get", { sessionKey });
  assert.deepEqual(result.context, { usedTokens: 30_344, maxTokens: 258_400, pct: 12, updated_ms: t335 + 9_000 });
  const bad = h.app.db.prepare("SELECT input_tokens, cached_input_tokens, output_tokens, context_used FROM usage_records WHERE session_key = ? AND run_id = 'fd592e3e'").get(sessionKey) as { input_tokens: number; cached_input_tokens: number; output_tokens: number; context_used: number };
  assert.deepEqual([bad.input_tokens, bad.cached_input_tokens, bad.output_tokens, bad.context_used], [0, 131_072, 0, 131_072]);
  h.close();
});

test("a zero-token command row and a context estimate cannot replace the last real Codex context", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol", { contextWindow: 258_400 })] } });
  open.push(h);
  const admin = await h.pair("Zero-token command fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  const old = Date.now() - 20_000;
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, 'real-turn', 'codex', 'openai', 'gpt-6.1-sol', 30_329, 0, 0, 0, 30_329, NULL, 1, ?)`)
    .run(sessionKey, old);
  await turn(h, admin, sessionKey, "status-turn");
  h.app.db.prepare("UPDATE usage_records SET started_ms = ? WHERE run_id = 'status-turn'").run(old + 10_000);
  // This context-only report came with no prompt token counts; it is not a model request.
  h.fake.usage(sessionKey, { contextWindow: 258_400 });
  h.app.db.prepare(`INSERT INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
    VALUES (?, 'status-turn', 'codex', 'openai', 'gpt-6.1-sol', 0, 0, 0, 0, 0, NULL, 1, ?)`)
    .run(sessionKey, old + 5_000);

  const result = await admin.call("jagentchill.session.context.get", { sessionKey });
  assert.deepEqual(result.context, { usedTokens: 30_329, maxTokens: 258_400, pct: 12, updated_ms: old });
  assert.equal((h.app.db.prepare("SELECT context_used FROM usage_records WHERE session_key = ? AND run_id = 'status-turn'").get(sessionKey) as { context_used: number | null }).context_used, null);
  h.close();
});

test("turn recording skips an explicit all-zero usage object from a command turn", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol")] } });
  open.push(h);
  const admin = await h.pair("Zero-token row fixture", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  await turn(h, admin, sessionKey, "status-command");
  h.fake.reply(sessionKey, "", { usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  for (let i = 0; i < 100; i++) {
    const row = h.app.db.prepare("SELECT id FROM session_usage WHERE session_key = ?").get(sessionKey);
    if (row) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM session_usage WHERE session_key = ?").get(sessionKey)?.n, 0);
  h.close();
});

test("host-answering /status writes no usage_records or session_usage row", async () => {
  const h = await createHarness({ models: { codex: [model("gpt-6.1-sol")] } });
  open.push(h);
  const admin = await h.pair("Local status command", "admin");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-6.1-sol" } })).session.sessionKey as string;
  await admin.call("jagentchill.session.access.set", { sessionKey, access: "host" });
  const response = await admin.call("jagentchill.chat.send", { sessionKey, message: "/status" });
  assert(response.hostReply, "the host answers /status locally");
  assert.equal(h.fake.callsOf("startTurn").length, 0, "/status does not reach the model runtime");
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE session_key = ?").get(sessionKey)?.n, 0);
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM session_usage WHERE session_key = ?").get(sessionKey)?.n, 0);
  h.close();
});
