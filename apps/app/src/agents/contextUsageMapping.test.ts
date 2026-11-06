import assert from "node:assert/strict";
import { test } from "node:test";
import { accountBalanceUsedPct, accountPlanLabel, contextLimitLabel, mapClaudeAccountUsage, mapCodexAccountUsage } from "./contextUsageMapping.ts";

const reset = "2026-10-10T12:00:00.000Z";

test("Claude account report maps Session, Weekly, scoped model, plan tier, and explicit extra-usage state", () => {
  const mapped = mapClaudeAccountUsage({
    subscriptionType: "max",
    rateLimitTier: "default_20x",
    report: {
      five_hour: { utilization: 5, resets_at: reset },
      seven_day: { utilization: "90", resets_at: reset },
      limits: [{ kind: "weekly_scoped", percent: 0, resets_at: reset, scope: { model: { display_name: "Fable" } } }],
      extra_usage: { is_enabled: false },
    },
  });
  assert.deepEqual(mapped, {
    planLabel: "Max 20x",
    windows: [
      { id: "five_hour", label: "Session", usedPct: 5, resetsAt_ms: Date.parse(reset) },
      { id: "weekly", label: "Weekly", usedPct: 90, resetsAt_ms: Date.parse(reset) },
      { id: "weekly_scoped_0", label: "Weekly · Fable", usedPct: 0, resetsAt_ms: Date.parse(reset) },
    ],
    extraUsageEnabled: false,
  });
});

test("Codex app-server account report maps its plan and primary/secondary rate-limit windows", () => {
  const mapped = mapCodexAccountUsage({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 5, reset_at: 1_792_000_000 },
      secondary_window: { used_percent: 90, reset_at: 1_792_086_400 },
    },
  });
  assert.deepEqual(mapped, {
    planLabel: "Plus",
    windows: [
      { id: "session", label: "Session", usedPct: 5, resetsAt_ms: 1_792_000_000_000 },
      { id: "weekly", label: "Weekly", usedPct: 90, resetsAt_ms: 1_792_086_400_000 },
    ],
  });
});

test("Missing account-report sections stay absent instead of producing invented zeros", () => {
  assert.deepEqual(mapClaudeAccountUsage({ report: {} }), { windows: [] });
  assert.deepEqual(mapCodexAccountUsage({}), { windows: [] });
});

test("Both runtimes use the same localized Session and Weekly window labels", () => {
  const codex = mapCodexAccountUsage({ rate_limit: {
    primary_window: { used_percent: 5 }, secondary_window: { used_percent: 90 },
  } }, "vi");
  const claude = mapClaudeAccountUsage({ report: {
    five_hour: { utilization: 5 }, seven_day: { utilization: 90 },
    limits: [{ kind: "weekly_scoped", percent: 0, scope: { model: { display_name: "Fable" } } }],
  }, locale: "ja" });
  assert.deepEqual(codex.windows.map((row) => row.label), ["Phiên", "Hàng tuần"]);
  assert.deepEqual(claude.windows.map((row) => row.label), ["セッション", "週間", "週間 · Fable"]);
  assert.equal(contextLimitLabel("5h", "en"), "Session");
  assert.equal(contextLimitLabel("Week", "en"), "Weekly");
  assert.equal(accountPlanLabel("plus"), "Plus");
});

test("API-key balance percentages use the same used scale as quota bars", () => {
  assert.equal(accountBalanceUsedPct({ used: 2, limit: 10 }), 20);
  assert.equal(accountBalanceUsedPct({ remaining: 8, limit: 10 }), 20);
  assert.equal(accountBalanceUsedPct({ remaining: 12, limit: 10 }), 0);
  assert.equal(accountBalanceUsedPct({ used: 1 }), undefined);
});
