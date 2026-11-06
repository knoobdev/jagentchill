import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createHarness, tick } from "./harness.ts";

const FAKE_TOKEN = "fake-account-token-must-never-escape-memory";
const now = Date.now();
const claudeCredentials = { claudeAiOauth: { accessToken: FAKE_TOKEN, subscriptionType: "max", rateLimitTier: "default_20x" } };
const codexCredentials = { tokens: { access_token: FAKE_TOKEN, account_id: "fake-account-id" } };
const liveHarnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
const runDirs: string[] = [];
afterEach(async () => {
  for (const h of liveHarnesses.splice(0)) { try { h.stop(); } catch { /* already stopped */ } }
  await tick(100);
  for (const dir of runDirs.splice(0)) rmSync(dir, { recursive: true });
});

async function harness(usageAccount: Record<string, unknown>) {
  const dataDir = mkdtempSync(join(tmpdir(), "jagentchill-usage-account-"));
  runDirs.push(dataDir);
  const h = await createHarness({ dataDir, now: () => now, extra: { usageAccount: usageAccount as never } });
  liveHarnesses.push(h);
  await h.settled();
  const admin = await h.pair("Studio Mac", "admin");
  return { h, admin };
}

test("Claude Code report reaches usage.plan.list with plan, Session, Weekly, model window, and extra usage", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const { h, admin } = await harness({
    readClaudeCredentials: async () => claudeCredentials,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({
        five_hour: { utilization: 5, resets_at: new Date(now + 2 * 60 * 60_000).toISOString() },
        seven_day: { utilization: 90, resets_at: new Date(now + 24 * 60 * 60_000).toISOString() },
        limits: [{ kind: "weekly_scoped", percent: 0, resets_at: new Date(now + 24 * 60 * 60_000).toISOString(), scope: { model: { display_name: "Fable" } } }],
        extra_usage: { is_enabled: false },
      });
    },
  });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["anthropic"], runtimeId: "claude-code" }) as any;
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(requests[0]!.headers.get("authorization"), `Bearer ${FAKE_TOKEN}`);
  assert.equal(requests[0]!.headers.get("anthropic-beta"), "oauth-2025-04-20");
  const [report] = result.providers;
  assert.deepEqual([report.status, report.providerId, report.planLabel, report.extraUsageEnabled], ["available", "anthropic", "Max 20x", false]);
  assert.deepEqual(report.windows.map((row: any) => [row.label, row.usedPct, row.resetsAt_ms]), [
    ["Session", 5, now + 2 * 60 * 60_000],
    ["Weekly", 90, now + 24 * 60 * 60_000],
    ["Weekly · Fable", 0, now + 24 * 60 * 60_000],
  ]);
  assert.deepEqual(report.details, [{ label: "Extra usage", value: "Disabled" }]);
});

test("Codex report maps subscription windows without refreshing or writing CLI credentials", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const { h, admin } = await harness({
    readCodexCredentials: async () => codexCredentials,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({ plan_type: "plus", credits: { balance: 12 }, rate_limit: {
        primary_window: { used_percent: 7, reset_at: now / 1000 + 300, window_minutes: 300 },
        secondary_window: { used_percent: 91, reset_at: now / 1000 + 86_400, window_minutes: 10_080 },
      } });
    },
  });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["openai"], runtimeId: "codex" }) as any;
  assert.deepEqual(requests.map((request) => request.url), ["https://chatgpt.com/backend-api/wham/usage"]);
  assert.equal(requests[0]!.headers.get("authorization"), `Bearer ${FAKE_TOKEN}`);
  assert.equal(requests[0]!.headers.get("chatgpt-account-id"), "fake-account-id");
  assert.deepEqual([result.providers[0].planLabel, ...result.providers[0].windows.map((row: any) => [row.label, row.usedPct])], ["Plus", ["Session", 7], ["Weekly", 91]]);
  assert.deepEqual(result.providers[0].balances, [{ id: "credits", label: "Credits", remaining: 12, unit: "usd", tone: "ok" }]);
});

test("Codex labels its only multi-day primary window Weekly", async () => {
  const { admin } = await harness({
    readCodexCredentials: async () => codexCredentials,
    fetch: async () => Response.json({ plan_type: "prolite", rate_limit: {
      primary_window: { used_percent: 27, reset_at: now / 1000 + 5 * 86_400, window_minutes: 10_080 },
      secondary_window: null,
    } }),
  });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["openai"], runtimeId: "codex" }) as any;
  assert.deepEqual(result.providers[0].windows.map((row: any) => [row.label, row.usedPct]), [["Weekly", 27]]);
});

test("Expired CLI account token returns a sign-in-again state and never refreshes", async () => {
  let calls = 0;
  const { h, admin } = await harness({
    readClaudeCredentials: async () => claudeCredentials,
    fetch: async () => { calls += 1; return new Response(null, { status: 401 }); },
  });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["anthropic"], runtimeId: "claude-code" }) as any;
  assert.equal(calls, 1);
  assert.deepEqual(result.providers.map((row: any) => [row.status, row.error]), [["sign-in-required", undefined]]);
  assert.deepEqual(h.app.db.prepare("SELECT * FROM usage_plan_snapshots WHERE runtime_id = 'claude-code'").all(), []);
});

test("Expired Codex token returns sign-in-required without attempting the OAuth refresh endpoint", async () => {
  const urls: string[] = [];
  const { h, admin } = await harness({
    readCodexCredentials: async () => codexCredentials,
    fetch: async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response(null, { status: 401 }); },
  });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["openai"], runtimeId: "codex" }) as any;
  assert.deepEqual(urls, ["https://chatgpt.com/backend-api/wham/usage"]);
  assert.equal(result.providers[0].status, "sign-in-required");
});

test("No stored CLI sign-in is absent, not an error, and does not call a vendor", async () => {
  let calls = 0;
  const { h, admin } = await harness({ readClaudeCredentials: async () => null, fetch: async () => { calls += 1; return Response.json({}); } });
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["anthropic"], runtimeId: "claude-code" }) as any;
  assert.deepEqual(result.providers, []);
  assert.equal(result.error, undefined);
  assert.equal(calls, 0);
});

test("A Claude Code turn end refreshes quota on demand and the meter read uses the same cached report", async () => {
  let calls = 0;
  const { h, admin } = await harness({
    readClaudeCredentials: async () => claudeCredentials,
    fetch: async () => { calls += 1; return Response.json({ five_hour: { utilization: 18, resets_at: new Date(now + 60 * 60_000).toISOString() } }); },
  });
  const created = await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } }) as any;
  const sent = await admin.call("jagentchill.chat.send", { sessionKey: created.session.sessionKey, message: "fixture prompt" }) as any;
  h.fake.endTurn(created.session.sessionKey, sent.runId);
  for (let i = 0; i < 80 && calls === 0; i++) await tick(10);
  assert.equal(calls, 1);
  const result = await admin.call("jagentchill.usage.plan.list", { providerIds: ["anthropic"], runtimeId: "claude-code" }) as any;
  assert.deepEqual([result.providers[0].windows[0].label, result.providers[0].windows[0].usedPct], ["Session", 18]);
  assert.equal(calls, 1);
});

test("Fake CLI token is absent from service logs and the stored mapped snapshot", async () => {
  const logs: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const { h, admin } = await harness({
      readClaudeCredentials: async () => claudeCredentials,
      fetch: async () => Response.json({ five_hour: { utilization: 12, resets_at: new Date(now + 60 * 60_000).toISOString() } }),
    });
    await admin.call("jagentchill.usage.plan.list", { providerIds: ["anthropic"], runtimeId: "claude-code" });
    const snapshot = JSON.stringify(h.app.db.prepare("SELECT payload FROM usage_plan_snapshots").all());
    assert.doesNotMatch(logs.join("\n"), new RegExp(FAKE_TOKEN));
    assert.equal(logs.length, 0);
    assert.doesNotMatch(snapshot, new RegExp(FAKE_TOKEN));
    assert.match(snapshot, /Max 20x|Session/);
  } finally {
    console.log = original.log; console.warn = original.warn; console.error = original.error;
  }
});
