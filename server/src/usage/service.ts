import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  USAGE_CSV_COLUMNS, USAGE_METHOD_SCOPES, USAGE_RANGE_DAYS, budgetRaiseParams, budgetRemoveParams, budgetSchema, usageBudgetCheckParams, usageExportParams, usageHistoryGetParams, usagePlanListParams,
  usageQueryParams, usageResetParams, usageSessionGetParams, usageSubscribeParams, usageTreeGetParams,
  type Budget, type BudgetState, type CostSource, type DailyRollup, type ModelRef, type PlanUsage, type Scope, type SessionUsage, type TurnOutcome, type UsageAccuracy, type UsageAgentTotals,
  type UsageDimension, type UsageQueryResult, type UsageRecord, type UsageRow, type UsageTreeNode,
} from "@jagentchill/protocol";
import type { RuntimeEvent } from "../agents/runtime/types.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import { createCliAccountReportFetcher, type CliAccountReport, type CliAccountReportOptions } from "./cli-account-report.ts";

const DAY_MS = 86_400_000;
const PLAN_TTL_MS = 300_000, PLAN_REFRESH_MS = 30_000;
const LIVE_EVENT_MS = 2_000;
const EXPORT_LIMIT = 1_000_000;

export type ModelPrice = { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number; cacheWritePerMillionUsd?: number; source: "aggregator" | "admin" };
type SessionRow = {
  session_key: string; gateway_key: string | null; agent_id: string; owner_device_id: string; project_id: string | null; title: string | null; runtime_id: string | null; provider_id: string | null;
  model_id: string | null; parent_session_key: string | null; origin: string; title_source: string | null;
};
type Row = {
  id: number; session_key: string; run_id: string; root_session_key: string; parent_session_key: string | null; agent_id: string; project_id: string | null; device_id: string | null;
  runtime_id: string | null; provider_id: string | null; endpoint_id: string | null; model_id: string | null; billing: string; outcome: string; input_tokens: number | null;
  cached_input_tokens: number | null; cache_write_tokens: number | null; output_tokens: number | null; total_tokens: number | null; token_source: string; cost_usd: number | null;
  cost_source: string; price_source: string; equivalent_cost_usd: number | null; tool_calls: number; started_ms: number; duration_ms: number; context_used: number | null;
  context_max: number | null; reconciled: number; open: number; session_title: string | null;
};
type TurnUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; costUsd?: number; contextUsed?: number; contextWindow?: number };

export type UsageServiceDeps = {
  dataDir: string; db: DatabaseSync; config: ServerConfigFile; now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  /** Whether a runtime's turns are billed per call (its CLI signed in with an API key); undefined: not known. */
  billedByCall?: (runtimeId: string) => boolean | undefined;
  /** Whether a device may read a session; usage of sessions it may not read is shown without their identity. */
  canRead: (sessionKey: string, connection: Connection) => boolean;
  /** How the runtime of a model reaches its provider, and what it reports. */
  runtimeOf: (runtimeId: string) => { label: string; kind: "direct" | "cli"; usage: "tokens-and-cost" | "tokens" | "none" } | undefined;
  providerLabel: (providerId: string) => string | undefined;
  /** The endpoint record a provider id names, when it is one. */
  endpointOf: (providerId: string) => string | undefined;
  priceOf: (ref: ModelRef) => ModelPrice | undefined;
  /** Resolves a just-fetched catalogue price for session totals when the in-memory price cache is cold. */
  resolvePriceOf?: (ref: ModelRef) => Promise<ModelPrice | undefined>;
  /** Test-only observation point for the session-cost row decision; never writes diagnostics to logs or storage. */
  onSessionCostRow?: (entry: { rowId: number; modelId: string | null; disposition: "priced" | "partial" | "zero-request" | "malformed"; pricedUsd: number; unavailableTokenClasses: string[] }) => void;
  contextWindowOf: (ref: ModelRef) => number | undefined;
  deviceName: (deviceId: string) => string | undefined;
  hostName: () => string;
  timeZone?: string;
  accountReport?: (runtimeId: string) => Promise<CliAccountReport>;
  accountReportOptions?: CliAccountReportOptions;
};

type SessionCostRow = {
  id: number; runtime_id: string | null; provider_id: string | null; model_id: string | null;
  input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cache_write_tokens: number | null; total_tokens: number | null;
};
type SessionCostRowDiagnostic = { rowId: number; modelId: string | null; disposition: "priced" | "partial" | "zero-request" | "malformed"; pricedUsd: number; unavailableTokenClasses: string[] };

/** Prices reported token parts exactly; the optional test hook exposes the decision for each seeded row. */
export async function priceSessionUsageRows(
  rows: readonly SessionCostRow[],
  resolvePrice: (ref: ModelRef) => ModelPrice | undefined | Promise<ModelPrice | undefined>,
  onRow?: (entry: SessionCostRowDiagnostic) => void,
): Promise<{ costUsd: number; hasRequest: boolean; unavailableModels: string[] }> {
  let costUsd = 0, hasRequest = false;
  const unavailableModels = new Set<string>();
  for (const row of rows) {
    const modelId = row.model_id || null;
    const quantities = [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens];
    const valid = quantities.map((value) => value === null ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : null);
    const totalValid = row.total_tokens === null || (Number.isSafeInteger(row.total_tokens) && row.total_tokens >= 0);
    if (valid.some((value) => value === null) || !totalValid) {
      onRow?.({ rowId: row.id, modelId, disposition: "malformed", pricedUsd: 0, unavailableTokenClasses: [] });
      continue;
    }
    const tokenTotal = valid.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (tokenTotal === 0) {
      if ((row.total_tokens ?? 0) > 0) {
        hasRequest = true;
        unavailableModels.add(row.provider_id && modelId ? `${row.provider_id}/${modelId}` : modelId ?? "Unknown model");
        onRow?.({ rowId: row.id, modelId, disposition: "malformed", pricedUsd: 0, unavailableTokenClasses: ["token-parts"] });
        continue;
      }
      onRow?.({ rowId: row.id, modelId, disposition: "zero-request", pricedUsd: 0, unavailableTokenClasses: [] });
      continue;
    }
    hasRequest = true;
    if (!row.runtime_id || !row.provider_id || !row.model_id) {
      unavailableModels.add(row.provider_id && modelId ? `${row.provider_id}/${modelId}` : modelId ?? "Unknown model");
      onRow?.({ rowId: row.id, modelId, disposition: "malformed", pricedUsd: 0, unavailableTokenClasses: ["model"] });
      continue;
    }
    const price = await resolvePrice({ runtimeId: row.runtime_id, providerId: row.provider_id, modelId: row.model_id });
    if (!price) {
      unavailableModels.add(`${row.provider_id}/${row.model_id}`);
      onRow?.({ rowId: row.id, modelId, disposition: "partial", pricedUsd: 0, unavailableTokenClasses: ["model"] });
      continue;
    }
    const parts: Array<[number, number | undefined]> = [
      [valid[0]!, price.inputPerMillionUsd], [valid[1]!, price.outputPerMillionUsd],
      [valid[2]!, price.cachedInputPerMillionUsd], [valid[3]!, price.cacheWritePerMillionUsd],
    ];
    const missing: string[] = [];
    let rowCost = 0;
    for (const [tokens, rate] of parts) {
      if (tokens <= 0) continue;
      if (rate === undefined || !Number.isFinite(rate) || rate < 0) { missing.push("token-rate"); continue; }
      rowCost += tokens * rate / 1_000_000;
    }
    costUsd += rowCost;
    if (missing.length) unavailableModels.add(`${row.provider_id}/${row.model_id}`);
    onRow?.({ rowId: row.id, modelId, disposition: missing.length ? "partial" : "priced", pricedUsd: money(rowCost), unavailableTokenClasses: missing });
  }
  return { costUsd: money(costUsd), hasRequest, unavailableModels: [...unavailableModels].sort() };
}

const sumOf = <T,>(list: readonly T[], pick: (item: T) => number | null | undefined) => list.reduce((total, item) => total + (pick(item) ?? 0), 0);
const money = (value: number) => Math.round(value * 1e6) / 1e6;
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}

/**
 * Agent usage of the host: one record per turn, captured on the host from what the runtimes report, never from a
 * device; daily rollups and a lifetime total that outlive the records; budgets and the checks that enforce them.
 */
export function createUsageService(deps: UsageServiceDeps) {
  const { db } = deps;
  const timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayOf = (ms: number) => dayFormat.format(new Date(ms));
  const exportsDir = join(deps.dataDir, "usage-exports");
  const subscribers = new Map<Connection, { sessionKeys: Set<string>; aggregate: boolean }>();
  const lastLive = new Map<string, number>();
  const toolCalls = new Map<string, Set<string>>();
  const plans = new Map<string, { at_ms: number; result: PlanUsage[]; fetch?: Promise<PlanUsage[]> }>();
  const fetchCliAccountReport = deps.accountReport ?? createCliAccountReportFetcher(deps.accountReportOptions);
  let lastRefresh = 0;
  let captureError: { at_ms: number; message: string } | undefined;

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, run_id TEXT NOT NULL, root_session_key TEXT NOT NULL, parent_session_key TEXT, agent_id TEXT NOT NULL,
      project_id TEXT, device_id TEXT, runtime_id TEXT, provider_id TEXT, endpoint_id TEXT, model_id TEXT, billing TEXT NOT NULL, outcome TEXT NOT NULL,
      input_tokens INTEGER, cached_input_tokens INTEGER, cache_write_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, token_source TEXT NOT NULL,
      cost_usd REAL, cost_source TEXT NOT NULL, price_source TEXT NOT NULL, equivalent_cost_usd REAL, tool_calls INTEGER NOT NULL DEFAULT 0, started_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0, context_used INTEGER, context_max INTEGER, reconciled INTEGER NOT NULL DEFAULT 0, open INTEGER NOT NULL DEFAULT 1, session_title TEXT,
      UNIQUE (session_key, run_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS usage_records_started ON usage_records (started_ms);
    CREATE TABLE IF NOT EXISTS usage_rollups (
      day TEXT NOT NULL, provider_id TEXT NOT NULL, runtime_id TEXT NOT NULL, model_id TEXT NOT NULL, billing TEXT NOT NULL, source TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0, cached_input_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, provider_id, runtime_id, model_id, billing, source)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS usage_lifetime (source TEXT PRIMARY KEY, turns INTEGER NOT NULL, tokens INTEGER NOT NULL, cost_usd REAL NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS budget_commits (ref TEXT PRIMARY KEY, provider_id TEXT, project_id TEXT, session_key TEXT, amount_usd REAL NOT NULL, unpriced INTEGER NOT NULL DEFAULT 0, ts_ms INTEGER NOT NULL) STRICT;
  `);

  // ---- sessions ----

  const sessionRow = (key: string) => db.prepare("SELECT * FROM agent_sessions WHERE session_key = ?").get(key) as SessionRow | undefined;
  /** The root of the tree a session belongs to. A fork is a session of its own, not a child of its source. */
  function rootOf(session: SessionRow): string {
    let current = session;
    for (let depth = 0; depth < 32 && current.parent_session_key && current.origin === "agent"; depth++) {
      const parent = sessionRow(current.parent_session_key);
      if (!parent) break;
      current = parent;
    }
    return current.session_key;
  }
  const refOf = (row: { runtime_id: string | null; provider_id: string | null; model_id: string | null }): ModelRef | undefined =>
    row.runtime_id && row.provider_id && row.model_id ? { runtimeId: row.runtime_id, providerId: row.provider_id, modelId: row.model_id } : undefined;
  const billingOf = (ref: ModelRef | undefined): UsageRecord["billing"] => {
    const runtime = ref && deps.runtimeOf(ref.runtimeId);
    if (!runtime || !ref) return "unknown";
    // A CLI answers on its own sign-in: a personal subscription is a plan; a CLI on an API key (or one whose kind of
    // sign-in cannot be told) is billed per call (`generation/billing.ts`).
    return deps.billedByCall?.(ref.runtimeId) === true ? "api" : "plan";
  };

  // ---- records ----

  const toRecord = (row: Row, admin: boolean): UsageRecord => ({
    id: row.id, sessionKey: row.session_key, runId: row.run_id, rootSessionKey: row.root_session_key, ...(row.parent_session_key ? { parentSessionKey: row.parent_session_key } : {}),
    agentId: row.agent_id, ...(row.project_id ? { projectId: row.project_id } : {}), deviceId: admin ? row.device_id ?? undefined : null,
    runtimeId: row.runtime_id, providerId: row.provider_id, ...(row.endpoint_id ? { endpointId: row.endpoint_id } : {}), modelId: row.model_id,
    billing: row.billing as UsageRecord["billing"], outcome: row.outcome as TurnOutcome,
    ...(row.token_source !== "none" ? { inputTokens: row.input_tokens ?? 0, cachedInputTokens: row.cached_input_tokens ?? 0, cacheWriteTokens: row.cache_write_tokens ?? 0, outputTokens: row.output_tokens ?? 0, totalTokens: row.total_tokens ?? 0 } : {}),
    tokenSource: row.token_source as UsageRecord["tokenSource"], ...(row.cost_usd !== null ? { costUsd: row.cost_usd } : {}), costSource: row.cost_source as CostSource,
    priceSource: row.price_source as UsageRecord["priceSource"], ...(row.equivalent_cost_usd !== null ? { equivalentCostUsd: row.equivalent_cost_usd } : {}),
    toolCalls: row.tool_calls, started_ms: row.started_ms, duration_ms: row.duration_ms,
    ...(row.context_used !== null ? { contextUsedTokens: row.context_used } : {}), ...(row.context_max !== null ? { contextMaxTokens: row.context_max } : {}), reconciled: row.reconciled === 1,
  });

  /** The record of a turn, created at its start. The same turn started twice is one record. */
  function open(session: SessionRow, runId: string, deviceId: string | undefined, started_ms: number): void {
    const ref = refOf(session);
    db.prepare(
      `INSERT INTO usage_records (session_key, run_id, root_session_key, parent_session_key, agent_id, project_id, device_id, runtime_id, provider_id, endpoint_id, model_id, billing, outcome,
         token_source, cost_source, price_source, started_ms, session_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'none', 'unknown', 'none', ?, ?)
       ON CONFLICT (session_key, run_id) DO UPDATE SET device_id = COALESCE(usage_records.device_id, excluded.device_id)`,
    ).run(session.session_key, runId, rootOf(session), session.origin === "agent" ? session.parent_session_key : null, session.agent_id, session.project_id, deviceId ?? null,
      // Only a title a person typed is kept with the record: an automatic title is the start of a prompt.
      session.runtime_id, session.provider_id, session.provider_id ? deps.endpointOf(session.provider_id) ?? null : null, session.model_id, billingOf(ref), started_ms, session.title_source === "user" ? session.title : null);
  }

  /** Token counts and cost of a turn as they stand, with where each number comes from. */
  function measured(row: Row, usage: TurnUsage) {
    const ref = refOf(row);
    const runtime = ref ? deps.runtimeOf(ref.runtimeId) : undefined;
    const reported = runtime?.usage !== "none" && (usage.input !== undefined || usage.output !== undefined || usage.total !== undefined);
    const input = usage.input ?? 0, output = usage.output ?? 0, cached = usage.cacheRead ?? 0, cacheWrite = usage.cacheWrite ?? 0;
    const price = ref ? deps.priceOf(ref) : undefined;
    const hasCacheRates = (!cached || price?.cachedInputPerMillionUsd !== undefined) && (!cacheWrite || price?.cacheWritePerMillionUsd !== undefined);
    const listPrice = price && reported && hasCacheRates ? money((input * price.inputPerMillionUsd + cacheWrite * (price.cacheWritePerMillionUsd ?? 0) + cached * (price.cachedInputPerMillionUsd ?? 0) + output * price.outputPerMillionUsd) / 1e6) : undefined;
    let costUsd: number | null = null, costSource: CostSource = "unknown", priceSource: UsageRecord["priceSource"] = price?.source ?? "none", equivalent: number | null = null;
    const billing = row.billing as UsageRecord["billing"];
    if (reported && usage.costUsd !== undefined && usage.costUsd > 0) { costUsd = money(usage.costUsd); costSource = "reported"; priceSource = "provider"; }
    // A provider that reports 0 for a plan-billed turn is included in the plan, not free.
    else if (billing === "plan" || billing === "local") { costUsd = 0; costSource = "included"; equivalent = listPrice ?? null; }
    else if (listPrice !== undefined) { costUsd = listPrice; costSource = "estimated"; equivalent = listPrice; }
    const contextMax = usage.contextWindow ?? (ref ? deps.contextWindowOf(ref) : undefined);
    return {
      tokenSource: reported ? "reported" : "none", input: reported ? input : null, output: reported ? output : null, cached: reported ? cached : null, cacheWrite: reported ? cacheWrite : null,
      total: reported ? usage.total ?? input + output + cached + cacheWrite : null, costUsd, costSource, priceSource, equivalent,
      contextUsed: usage.contextUsed ?? (reported ? input + cached + cacheWrite : null), contextMax: contextMax ? contextMax : null,
    };
  }
  function write(row: Row, usage: TurnUsage, extra: { outcome?: TurnOutcome; duration_ms?: number; open?: 0 | 1; reconciled?: 0 | 1 } = {}): void {
    const value = measured(row, usage);
    db.prepare(
      `UPDATE usage_records SET input_tokens = ?, cached_input_tokens = ?, cache_write_tokens = ?, output_tokens = ?, total_tokens = ?, token_source = ?, cost_usd = ?, cost_source = ?, price_source = ?,
         equivalent_cost_usd = ?, context_used = ?, context_max = ?, tool_calls = ?, outcome = COALESCE(?, outcome), duration_ms = COALESCE(?, duration_ms), open = COALESCE(?, open), reconciled = COALESCE(?, reconciled) WHERE id = ?`,
    ).run(value.input, value.cached, value.cacheWrite, value.output, value.total, value.tokenSource, value.costUsd, value.costSource, value.priceSource, value.equivalent, value.contextUsed, value.contextMax,
      toolCalls.get(`${row.session_key}\n${row.run_id}`)?.size ?? row.tool_calls, extra.outcome ?? null, extra.duration_ms ?? null, extra.open ?? null, extra.reconciled ?? null, row.id);
  }
  const usageIn = (row: Row): TurnUsage => ({
    ...(row.token_source === "none" ? {} : { input: row.input_tokens ?? 0, output: row.output_tokens ?? 0, cacheRead: row.cached_input_tokens ?? 0, cacheWrite: row.cache_write_tokens ?? 0, total: row.total_tokens ?? 0 }),
    ...(row.cost_source === "reported" && row.cost_usd !== null ? { costUsd: row.cost_usd } : {}),
    ...(row.context_used !== null ? { contextUsed: row.context_used } : {}), ...(row.context_max !== null ? { contextWindow: row.context_max } : {}),
  });
  const rowOf = (sessionKey: string, runId: string) => db.prepare("SELECT * FROM usage_records WHERE session_key = ? AND run_id = ?").get(sessionKey, runId) as Row | undefined;

  /** Ends a turn's record: its outcome, its duration, the rollup of its day, the lifetime total and the budgets. */
  function close(row: Row, outcome: TurnOutcome, usage: TurnUsage, ended_ms: number = deps.now()): void {
    write(row, Object.keys(usage).length ? usage : usageIn(row), { outcome, duration_ms: Math.max(0, ended_ms - row.started_ms), open: 0 });
    toolCalls.delete(`${row.session_key}\n${row.run_id}`);
    const final = db.prepare("SELECT * FROM usage_records WHERE id = ?").get(row.id) as Row;
    const tokens = [final.input_tokens ?? 0, final.cached_input_tokens ?? 0, final.cache_write_tokens ?? 0, final.output_tokens ?? 0];
    db.prepare(
      `INSERT INTO usage_rollups (day, provider_id, runtime_id, model_id, billing, source, turns, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, cost_usd, duration_ms)
       VALUES (?, ?, ?, ?, ?, 'agent', 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (day, provider_id, runtime_id, model_id, billing, source) DO UPDATE SET turns = turns + 1, input_tokens = input_tokens + excluded.input_tokens,
         cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens, cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd, duration_ms = duration_ms + excluded.duration_ms`,
    ).run(dayOf(final.started_ms), final.provider_id ?? "", final.runtime_id ?? "", final.model_id ?? "", final.billing, ...tokens, final.cost_usd ?? 0, final.duration_ms);
    db.prepare("INSERT INTO usage_lifetime (source, turns, tokens, cost_usd) VALUES ('agent', 1, ?, ?) ON CONFLICT (source) DO UPDATE SET turns = turns + 1, tokens = tokens + excluded.tokens, cost_usd = cost_usd + excluded.cost_usd")
      .run(tokens.reduce((a, b) => a + b, 0), final.cost_usd ?? 0);
    commit(final);
    if (final.runtime_id === "claude-code" || final.runtime_id === "codex") void planUsage(false, final.runtime_id).catch(() => undefined);
  }

  // ---- budgets ----

  const budgets = (): Budget[] => deps.config.get<Budget[]>("budgets") ?? [];
  const setting = (key: string): boolean => deps.config.get<Record<string, unknown>>("usage")?.[key] === true;
  /** What a finished turn adds to the budgets: its reported or estimated cost; a plan-billed turn adds its list price only when the host says so. */
  function commit(row: Row): void {
    const amount = row.cost_source === "reported" || row.cost_source === "estimated" ? row.cost_usd ?? 0 : row.cost_source === "included" && setting("budgetPlanTurnsAtListPrice") ? row.equivalent_cost_usd ?? 0 : 0;
    db.prepare("INSERT INTO budget_commits (ref, provider_id, project_id, session_key, amount_usd, unpriced, ts_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ref) DO UPDATE SET amount_usd = excluded.amount_usd")
      .run(`agent-turn:${row.id}`, row.provider_id, row.project_id, row.session_key, amount, row.cost_source === "unknown" ? 1 : row.cost_source === "included" && !amount ? 2 : 0, row.started_ms);
  }
  function monthStart(now: number): number {
    // The first instant of the host's calendar month, found by walking back day by day in the host's time zone.
    const month = dayOf(now).slice(0, 7);
    let cursor = now;
    while (dayOf(cursor - DAY_MS).slice(0, 7) === month) cursor -= DAY_MS;
    const day = dayOf(cursor);
    let low = cursor - DAY_MS, high = cursor;
    while (high - low > 1000) { const middle = Math.floor((low + high) / 2); if (dayOf(middle) === day) high = middle; else low = middle; }
    return high;
  }
  function stateOf(budget: Budget): BudgetState {
    const column = budget.scope === "provider" ? "provider_id" : budget.scope === "project" ? "project_id" : budget.scope === "session" ? "session_key" : null;
    const since = budget.period === "month" ? monthStart(deps.now()) : 0;
    const row = db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS spent, COALESCE(SUM(unpriced = 1), 0) AS unpriced, COALESCE(SUM(unpriced = 2), 0) AS uncounted FROM budget_commits WHERE ts_ms >= ?${column ? ` AND ${column} = ?` : ""}`)
      .get(...(column ? [since, budget.scopeId!] : [since])) as { spent: number; unpriced: number; uncounted: number };
    const spentUsd = money(row.spent);
    const label = budget.scope === "global" ? "all usage" : budget.scope === "provider" ? deps.providerLabel(budget.scopeId!) ?? budget.scopeId! : budget.scope === "session" ? sessionRow(budget.scopeId!)?.title ?? "session" : budget.scopeId!;
    return { ...budget, spentUsd, remainingUsd: money(Math.max(0, budget.limitUsd - spentUsd)), exhausted: spentUsd >= budget.limitUsd, warning: spentUsd >= budget.limitUsd * 0.8, label, includesUnpriced: row.unpriced > 0, uncountedTurns: row.uncounted };
  }
  const applies = (budget: Budget, session: SessionRow) => budget.scope === "global" || (budget.scope === "provider" && budget.scopeId === session.provider_id)
    || (budget.scope === "project" && budget.scopeId === session.project_id) || (budget.scope === "session" && budget.scopeId === session.session_key);
  /** Refuses a turn or a tool call of a session whose hard-stop budget is spent, or whose model has no price under one. */
  function assertBudget(sessionKey: string): void {
    const session = sessionRow(sessionKey);
    if (!session) return;
    const hard = budgets().filter((budget) => budget.hardStop && applies(budget, session)).map(stateOf);
    const spent = hard.find((budget) => budget.exhausted);
    if (spent) throw new ProtocolError("BUDGET_EXCEEDED", `Budget reached — ${spent.scope}`, { httpStatus: 402, details: { scope: spent.scope, ...(spent.scopeId ? { scopeId: spent.scopeId } : {}), limitUsd: spent.limitUsd, overUsd: money(spent.spentUsd - spent.limitUsd), remainingUsd: 0 } });
    const ref = refOf(session);
    // Under a spending limit a model must have a price, unless every such limit allows unknown-cost models.
    const unpriced = !!ref && billingOf(ref) === "api" && !deps.priceOf(ref);
    const strict = hard.find((budget) => !budget.allowUnknownCost);
    if (unpriced && strict) throw new ProtocolError("BUDGET_EXCEEDED", `${ref.modelId} has no price and a spending limit is active`, { httpStatus: 402, details: { reason: "unpriced_model", scope: strict.scope, ...(strict.scopeId ? { scopeId: strict.scopeId } : {}), modelId: ref.modelId } });
  }

  // ---- capture ----

  function notify(sessionKey: string, terminal: boolean): void {
    const row = db.prepare("SELECT root_session_key, project_id FROM usage_records WHERE session_key = ? ORDER BY id DESC LIMIT 1").get(sessionKey) as { root_session_key: string; project_id: string | null } | undefined;
    if (!row) return;
    const now = deps.now();
    // While a turn runs a session is announced at most every two seconds; its end is always announced.
    if (!terminal && now - (lastLive.get(sessionKey) ?? 0) < LIVE_EVENT_MS) return;
    lastLive.set(sessionKey, now);
    const payload = { sessionId: sessionKey, rootSessionId: row.root_session_key, ...(row.project_id ? { projectId: row.project_id } : {}) };
    for (const [connection, selection] of subscribers) {
      const session = selection.sessionKeys.has(sessionKey) || selection.sessionKeys.has(row.root_session_key);
      if ((session || selection.aggregate) && (deps.canRead(sessionKey, connection) || (!session && selection.aggregate))) connection.send("jagentchill.usage.updated", "usage", deps.canRead(sessionKey, connection) ? payload : {});
    }
  }
  const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
  /** Every event of a turn as the runtime reported it: its usage, its tool calls and its end. */
  function runtimeEvent(sessionKey: string, runId: string, event: RuntimeEvent): void {
    if (!runId) return;
    const session = sessionRow(sessionKey);
    if (!session) return;
    try {
      if (event.type === "turn_started") { open(session, runId, undefined, deps.now()); return; }
      const row = rowOf(session.session_key, runId);
      if (!row || !row.open) return;
      // Each tool call counts once, however many events report it.
      if (event.type === "tool_call_started" || event.type === "tool_call_finished") {
        const key = `${session.session_key}\n${runId}`;
        toolCalls.set(key, (toolCalls.get(key) ?? new Set()).add(event.id));
        return;
      }
      if (event.type === "usage") {
        // A report without token counts (a context estimate of a command) is not a model request: only the window is kept.
        if ([event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens].every((value) => value === undefined)) {
          if (event.contextWindow) db.prepare("UPDATE usage_records SET context_max = ? WHERE id = ?").run(event.contextWindow, row.id);
          notify(session.session_key, false);
          return;
        }
        // A runtime may report several requests of one turn: the tokens add up, the context is what the last request held.
        const before = usageIn(row);
        const add = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
        const input = add(before.input, event.inputTokens), output = add(before.output, event.outputTokens), cacheRead = add(before.cacheRead, event.cacheReadTokens), cacheWrite = add(before.cacheWrite, event.cacheWriteTokens);
        const prompt = (event.inputTokens ?? 0) + (event.cacheReadTokens ?? 0) + (event.cacheWriteTokens ?? 0);
        // A cost the runtime states is what was paid only for a runtime billed per call; on a plan it is an estimate.
        const costUsd = deps.billedByCall?.(session.runtime_id ?? "") === true ? add(before.costUsd, event.costUsd) : undefined;
        write(row, {
          ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}), ...(cacheRead !== undefined ? { cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}),
          total: (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0), ...(costUsd !== undefined ? { costUsd } : {}),
          ...(prompt > 0 ? { contextUsed: prompt } : before.contextUsed !== undefined ? { contextUsed: before.contextUsed } : {}),
          ...(event.contextWindow ?? before.contextWindow ? { contextWindow: event.contextWindow ?? before.contextWindow } : {}),
        });
        notify(session.session_key, false);
        return;
      }
      if (event.type !== "turn_completed" && event.type !== "turn_failed" && event.type !== "turn_cancelled") return;
      const outcome: TurnOutcome = event.type === "turn_completed" ? "completed" : event.type === "turn_cancelled" ? "cancelled" : "failed";
      finish(session, runId, outcome);
    } catch (err) {
      // A usage event that cannot be read never stops a turn: the turn is counted without tokens.
      captureError = { at_ms: deps.now(), message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The end of a turn: its usage is what the runtime reported during it. */
  function finish(session: SessionRow, runId: string, outcome: TurnOutcome): void {
    let row = rowOf(session.session_key, runId);
    if (!row) { open(session, runId, undefined, deps.now()); row = rowOf(session.session_key, runId)!; }
    // The end of a turn can be reported twice (the runtime, and Stop that did not wait for it); the record is closed once.
    if (!row.open) return;
    close(row, outcome, usageIn(row), deps.now());
    notify(session.session_key, true);
  }

  // ---- reading ----

  const emptyTotals = (): UsageAgentTotals => ({ turns: { completed: 0, cancelled: 0, failed: 0 }, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0, equivalentCostUsd: 0, includedTurns: 0, unknownCostTurns: 0, unreportedTurns: 0, duration_ms: 0, toolCalls: 0 });
  function totalsOf(rows: readonly Row[]): UsageAgentTotals {
    const totals = emptyTotals();
    for (const row of rows) {
      totals.turns[row.outcome as TurnOutcome] += 1;
      totals.inputTokens += row.input_tokens ?? 0; totals.cachedInputTokens += row.cached_input_tokens ?? 0; totals.cacheWriteTokens += row.cache_write_tokens ?? 0; totals.outputTokens += row.output_tokens ?? 0;
      // A turn of unknown cost adds nothing to a sum; it is counted beside the sum instead.
      totals.costUsd += row.cost_usd ?? 0; totals.equivalentCostUsd += row.equivalent_cost_usd ?? 0; totals.duration_ms += row.duration_ms; totals.toolCalls += row.tool_calls;
      if (row.cost_source === "included") totals.includedTurns += 1;
      if (row.cost_source === "unknown") totals.unknownCostTurns += 1;
      if (row.token_source === "none") totals.unreportedTurns += 1;
    }
    totals.costUsd = money(totals.costUsd); totals.equivalentCostUsd = money(totals.equivalentCostUsd);
    return totals;
  }
  function accuracyOf(rows: readonly Row[]): UsageAccuracy {
    if (rows.some((row) => row.cost_source === "unknown" || row.token_source === "none")) return "partial";
    if (rows.some((row) => row.cost_source === "estimated" || row.token_source === "estimated")) return "estimated";
    return rows.some((row) => row.cost_source === "included") && rows.some((row) => row.cost_source === "reported") ? "mixed" : "reported";
  }
  const rowFor = (keys: string[], labels: string[], rows: readonly Row[]): UsageRow => {
    const agent = totalsOf(rows);
    return { keys, labels, agent, generation: { calls: 0, units: 0, costUsd: 0, unknownCostCalls: 0 }, totalCostUsd: agent.costUsd, estimatedTokenTurns: rows.filter((row) => row.token_source === "estimated").length, unpricedTurns: rows.filter((row) => row.price_source === "none" && row.cost_source === "unknown" && row.token_source !== "none").length, accuracy: accuracyOf(rows) };
  };

  const OTHER = "\u0000other";
  /** The value of one dimension for a record, and how it is shown. A session the caller may not read has no identity. */
  function dimension(name: UsageDimension, row: Row, readable: boolean, admin: boolean): [string, string] {
    switch (name) {
      case "provider": return [row.provider_id ?? "", row.provider_id ? deps.providerLabel(row.provider_id) ?? row.provider_id : "Unknown"];
      case "endpoint": return [row.endpoint_id ?? "", row.endpoint_id ? deps.providerLabel(row.endpoint_id) ?? row.endpoint_id : "Direct"];
      case "runtime": return [row.runtime_id ?? "", row.runtime_id ? deps.runtimeOf(row.runtime_id)?.label ?? `${row.runtime_id} (deleted)` : "Unknown"];
      case "model": return [row.model_id ?? "", row.model_id ?? "Unknown"];
      case "billing": return [row.billing, row.billing];
      case "tokenSource": return [row.token_source, row.token_source];
      case "priceSource": return [row.price_source, row.price_source];
      case "project": return [row.project_id ?? "", row.project_id ?? "No project"];
      case "session": return readable ? [row.session_key, sessionRow(row.session_key)?.title ?? (row.session_title ? `${row.session_title} (deleted)` : "Session (deleted)")] : [OTHER, "Other sessions"];
      case "rootSession": return readable ? [row.root_session_key, sessionRow(row.root_session_key)?.title ?? "Session"] : [OTHER, "Other sessions"];
      case "agent": return readable ? [row.agent_id, row.agent_id] : [OTHER, "Other sessions"];
      case "device": return readable && admin && row.device_id ? [row.device_id, deps.deviceName(row.device_id) ?? "Device (removed)"] : readable && admin ? ["", "No device"] : [OTHER, "Other devices"];
      case "source": return ["agent", "Agent"];
      case "outcome": return [row.outcome, row.outcome];
      case "day": return [dayOf(row.started_ms), dayOf(row.started_ms)];
      case "month": return [dayOf(row.started_ms).slice(0, 7), dayOf(row.started_ms).slice(0, 7)];
    }
  }
  function select(params: z.infer<typeof usageQueryParams>, connection: Connection): { rows: Row[]; readable: (row: Row) => boolean; admin: boolean } {
    if (params.from_ms > params.to_ms) throw new ProtocolError("INVALID_PARAMS", "The range ends before it starts.", { details: { path: "from_ms" } });
    if (params.to_ms - params.from_ms > USAGE_RANGE_DAYS * DAY_MS) throw new ProtocolError("INVALID_PARAMS", "A range covers at most 800 days.", { details: { path: "to_ms" } });
    const admin = connection.role() === "admin";
    const known = new Map<string, boolean>();
    const readable = (row: Row) => { if (!known.has(row.session_key)) known.set(row.session_key, admin || deps.canRead(row.session_key, connection)); return known.get(row.session_key)!; };
    const all = db.prepare("SELECT * FROM usage_records WHERE started_ms >= ? AND started_ms <= ? ORDER BY started_ms").all(params.from_ms, params.to_ms) as Row[];
    const filters = Object.entries(params.filters ?? {}) as Array<[UsageDimension, string | string[]]>;
    return { admin, readable, rows: all.filter((row) => filters.every(([name, wanted]) => { const [key] = dimension(name, row, readable(row), admin); return Array.isArray(wanted) ? wanted.includes(key) : wanted === key; })) };
  }
  function query(params: z.infer<typeof usageQueryParams>, connection: Connection): UsageQueryResult {
    const { rows, readable, admin } = select(params, connection);
    const groups = new Map<string, { keys: string[]; labels: string[]; rows: Row[] }>();
    for (const row of rows) {
      const parts = params.groupBy.map((name) => dimension(name, row, readable(row), admin));
      const id = parts.map(([key]) => key).join("\u0001");
      const group = groups.get(id) ?? { keys: parts.map(([key]) => (key === OTHER ? "" : key)), labels: parts.map(([, label]) => label), rows: [] };
      group.rows.push(row);
      groups.set(id, group);
    }
    const out = [...groups.values()].map((group) => rowFor(group.keys, group.labels, group.rows));
    const tokens = (row: UsageRow) => row.agent.inputTokens + row.agent.cachedInputTokens + row.agent.cacheWriteTokens + row.agent.outputTokens;
    const turns = (row: UsageRow) => row.agent.turns.completed + row.agent.turns.cancelled + row.agent.turns.failed;
    const byTime = params.groupBy[0] === "day" || params.groupBy[0] === "month";
    out.sort((a, b) => (params.sort === "key" || (!params.sort && byTime) ? a.keys.join("\u0001").localeCompare(b.keys.join("\u0001")) : params.sort === "tokens" ? tokens(b) - tokens(a) : params.sort === "turns" ? turns(b) - turns(a) : b.totalCostUsd - a.totalCostUsd || tokens(b) - tokens(a)));
    const start = Number(params.cursor ?? 0) || 0;
    return { rows: out.slice(start, start + params.limit), totals: rowFor([], [], rows), timeZone, ...(start + params.limit < out.length ? { nextCursor: String(start + params.limit) } : {}) };
  }

  async function sessionUsage(sessionKey: string, connection: Connection): Promise<SessionUsage> {
    const admin = connection.role() === "admin";
    if (!admin && !deps.canRead(sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    const rows = db.prepare("SELECT * FROM usage_records WHERE session_key = ? ORDER BY id").all(sessionKey) as Row[];
    const cliRows = db.prepare("SELECT id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens FROM session_usage WHERE session_key = ? AND reported = 1").all(sessionKey) as Array<{
      id: number; runtime_id: string | null; provider_id: string | null; model_id: string | null; input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cache_write_tokens: number | null; total_tokens: number | null;
    }>;
    const session = sessionRow(sessionKey);
    // Locally answered commands and empty reports do not represent model requests, even if usage_records contains a
    // cached-input estimate. The session_usage token columns are the pricing source for these rows.
    const priced = await priceSessionUsageRows(cliRows, (ref) => deps.resolvePriceOf ? deps.resolvePriceOf(ref) : deps.priceOf(ref), deps.onSessionCostRow);
    const cliSession = session?.runtime_id === "codex" || session?.runtime_id === "claude-code";
    const sessionCostUsd = priced.hasRequest ? priced.costUsd : cliSession ? 0 : undefined;
    if (!rows.length && !session) throw new ProtocolError("NOT_FOUND", "No such session.");
    const totals = totalsOf(rows);
    const group = (key: (row: Row) => [string, string]) => {
      const groups = new Map<string, { label: string; rows: Row[] }>();
      for (const row of rows) { const [id, label] = key(row); (groups.get(id) ?? groups.set(id, { label, rows: [] }).get(id)!).rows.push(row); }
      return [...groups].map(([id, entry]) => rowFor([id], [entry.label], entry.rows));
    };
    const last = rows.at(-1);
    // After the session moved to another model the figure of the old one says nothing: it is cleared until the next turn reports.
    const sameModel = !!last && !!session && last.model_id === session.model_id && last.runtime_id === session.runtime_id;
    return {
      sessionKey, title: session?.title ?? rows.at(-1)?.session_title ?? "Session", inputTokens: totals.inputTokens, cachedInputTokens: totals.cachedInputTokens, cacheWriteTokens: totals.cacheWriteTokens, outputTokens: totals.outputTokens,
      totalTokens: totals.inputTokens + totals.cachedInputTokens + totals.cacheWriteTokens + totals.outputTokens, agentCostUsd: totals.costUsd, generationCostUsd: 0, totalCostUsd: totals.costUsd, equivalentCostUsd: totals.equivalentCostUsd, ...(sessionCostUsd === undefined ? {} : { sessionCostUsd, ...(priced.unavailableModels.length ? { costUnavailableReason: "no-list-price" as const, costUnavailableModels: priced.unavailableModels } : {}) }),
      turns: totals.turns, toolCalls: totals.toolCalls, duration_ms: totals.duration_ms, ...(rows.length ? { firstTurn_ms: rows[0].started_ms, lastTurn_ms: last!.started_ms } : {}),
      byRuntime: group((row) => dimension("runtime", row, true, admin)), byModel: group((row) => [`${row.runtime_id}/${row.model_id}`, `${deps.runtimeOf(row.runtime_id ?? "")?.label ?? row.runtime_id ?? "Unknown"} · ${row.model_id ?? "Unknown"}`]),
      accuracy: accuracyOf(rows), unknownCostTurns: totals.unknownCostTurns, includedTurns: totals.includedTurns, unreportedTurns: totals.unreportedTurns, records: rows.map((row) => toRecord(row, admin)),
      context: last && sameModel && last.context_used !== null && last.context_max ? { usedTokens: last.context_used, maxTokens: last.context_max, pct: Math.min(100, Math.round((last.context_used / last.context_max) * 100)), source: "reported", model: last.model_id ?? "", updated_ms: last.started_ms + last.duration_ms } : { source: "unknown" },
    };
  }

  function tree(rootKey: string, connection: Connection): UsageTreeNode {
    if (connection.role() !== "admin" && !deps.canRead(rootKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    // A session that left a tree keeps what it spent there; its own tree holds only what it spent since.
    const rows = db.prepare("SELECT * FROM usage_records WHERE root_session_key = ?").all(rootKey) as Row[];
    const bySession = new Map<string, Row[]>();
    for (const row of rows) (bySession.get(row.session_key) ?? bySession.set(row.session_key, []).get(row.session_key)!).push(row);
    const childrenOf = new Map<string, string[]>();
    for (const [key, list] of bySession) { const parent = list[0].parent_session_key; if (parent && key !== rootKey) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(key); }
    const add = (a: UsageAgentTotals, b: UsageAgentTotals): UsageAgentTotals => ({
      turns: { completed: a.turns.completed + b.turns.completed, cancelled: a.turns.cancelled + b.turns.cancelled, failed: a.turns.failed + b.turns.failed }, inputTokens: a.inputTokens + b.inputTokens, cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
      cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens, outputTokens: a.outputTokens + b.outputTokens, costUsd: money(a.costUsd + b.costUsd), equivalentCostUsd: money(a.equivalentCostUsd + b.equivalentCostUsd), includedTurns: a.includedTurns + b.includedTurns,
      unknownCostTurns: a.unknownCostTurns + b.unknownCostTurns, unreportedTurns: a.unreportedTurns + b.unreportedTurns, duration_ms: a.duration_ms + b.duration_ms, toolCalls: a.toolCalls + b.toolCalls,
    });
    const tokens = (totals: UsageAgentTotals) => totals.inputTokens + totals.cachedInputTokens + totals.cacheWriteTokens + totals.outputTokens;
    const build = (key: string): UsageTreeNode => {
      const own = totalsOf(bySession.get(key) ?? []);
      const children = (childrenOf.get(key) ?? []).map(build);
      // A child's usage is part of its parent's subtree and never of the parent's own totals.
      const subtree = children.reduce((total, child) => add(total, child.subtree), own);
      const session = sessionRow(key), last = bySession.get(key)?.at(-1);
      return { sessionKey: key, agentId: session?.agent_id ?? last?.agent_id ?? "main", label: session?.title ?? last?.session_title ?? "Session", runtimeId: session?.runtime_id ?? last?.runtime_id ?? null, modelId: session?.model_id ?? last?.model_id ?? null, own, subtree, sharePct: 0, children };
    };
    const root = build(rootKey);
    const share = (node: UsageTreeNode) => {
      const whole = root.subtree.costUsd > 0 ? root.subtree.costUsd : tokens(root.subtree), part = root.subtree.costUsd > 0 ? node.subtree.costUsd : tokens(node.subtree);
      node.sharePct = whole > 0 ? Math.round((part / whole) * 100) : 0;
      node.children.sort((a, b) => b.subtree.costUsd - a.subtree.costUsd || tokens(b.subtree) - tokens(a.subtree)).forEach(share);
    };
    share(root);
    return root;
  }

  // ---- plan usage ----

  const tone = (pct: number | undefined) => (pct === undefined ? "default" as const : pct >= 90 ? "danger" as const : pct >= 70 ? "warning" as const : "ok" as const);
  /** Plan limits of the CLI runtimes, fetched only when their meter asks. */
  async function planUsage(refresh: boolean, runtimeId?: string): Promise<PlanUsage[]> {
    if (!setting("planUsageAll") && runtimeId !== "claude-code" && runtimeId !== "codex") return [];
    const now = deps.now();
    const key = runtimeId ?? "";
    let plan = plans.get(key);
    if (!plan) {
      const stored = db.prepare("SELECT payload, fetched_ms FROM usage_plan_snapshots WHERE runtime_id = ? ORDER BY provider_id").all(key) as Array<{ payload: string; fetched_ms: number }>;
      if (stored.length) {
        const result = stored.map((row) => ({ ...(JSON.parse(row.payload) as PlanUsage), fetched_ms: row.fetched_ms }));
        plan = { at_ms: Math.max(...stored.map((row) => row.fetched_ms)), result };
        plans.set(key, plan);
      }
    }
    if (plan?.fetch) return plan.fetch;
    if (plan && now - plan.at_ms < PLAN_TTL_MS && !(refresh && now - lastRefresh >= PLAN_REFRESH_MS)) return plan.result;
    if (refresh) lastRefresh = now;

    // The CLI runtimes own their sign-ins and account endpoints. Keep the access token
    // inside this request and cache/persist only this normalized, token-free report.
    if (runtimeId === "claude-code" || runtimeId === "codex") {
      const fetching = (async () => {
        const report = await fetchCliAccountReport(runtimeId);
        const fetched_ms = deps.now();
        if (report.state === "absent") {
          const providerId = runtimeId === "claude-code" ? "anthropic" : "openai";
          db.prepare("DELETE FROM usage_plan_snapshots WHERE provider_id = ? AND runtime_id = ?").run(providerId, key);
          return [];
        }
        if (report.state === "sign-in-again") {
          const providerId = runtimeId === "claude-code" ? "anthropic" : "openai";
          db.prepare("DELETE FROM usage_plan_snapshots WHERE provider_id = ? AND runtime_id = ?").run(providerId, key);
          return [{
            providerId, runtimeIds: [runtimeId], displayName: runtimeId === "claude-code" ? "Claude Code" : "Codex",
            status: "sign-in-required" as const, sourceLabel: `From the ${runtimeId === "claude-code" ? "Claude Code" : "Codex"} CLI sign-in on this host`,
            fetched_ms, nextRefresh_ms: fetched_ms + PLAN_TTL_MS, windows: [], balances: [], details: [],
          }];
        }
        const entry: PlanUsage = {
          providerId: report.providerId, runtimeIds: [runtimeId], displayName: report.displayName, status: "available",
          ...(report.planLabel ? { planLabel: report.planLabel } : {}), sourceLabel: `From the ${report.displayName} CLI sign-in on this host`,
          fetched_ms, nextRefresh_ms: fetched_ms + PLAN_TTL_MS,
          windows: report.windows.map((window) => ({ id: window.id, label: window.label, ...(window.usedPct === undefined ? {} : { usedPct: window.usedPct, remainingPct: Math.max(0, 100 - window.usedPct) }), ...(window.resetsAt_ms === undefined ? {} : { resetsAt_ms: window.resetsAt_ms }), tone: tone(window.usedPct) })),
          balances: (report.balances ?? []).map((balance) => ({ ...balance, tone: balance.remaining > 0 ? "ok" as const : "danger" as const })),
          ...(report.extraUsageEnabled === undefined ? {} : { extraUsageEnabled: report.extraUsageEnabled }),
          details: report.extraUsageEnabled === undefined ? [] : [{ label: "Extra usage", value: report.extraUsageEnabled ? "Enabled" : "Disabled" }],
        };
        db.prepare("INSERT INTO usage_plan_snapshots (provider_id, runtime_id, payload, fetched_ms) VALUES (?, ?, ?, ?) ON CONFLICT (provider_id, runtime_id) DO UPDATE SET payload = excluded.payload, fetched_ms = excluded.fetched_ms")
          .run(entry.providerId, key, JSON.stringify(entry), fetched_ms);
        return [entry];
      })();
      plans.set(key, { at_ms: plan?.at_ms ?? 0, result: plan?.result ?? [], fetch: fetching });
      try {
        const result = await fetching;
        plans.set(key, { at_ms: deps.now(), result });
        return result;
      } catch {
        if (plan?.result.length) plans.set(key, { at_ms: plan.at_ms, result: plan.result });
        else plans.delete(key);
        throw new ProtocolError("UNAVAILABLE", "Unable to load usage", { httpStatus: 502, retryable: true });
      }
    }

    // Plan limits are read from the CLIs' own sign-ins only (Claude Code, Codex); no other runtime reports them.
    return [];
  }

  // ---- export ----

  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    // A cell a spreadsheet would read as a formula is made plain text.
    if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  function csv(params: z.infer<typeof usageExportParams>, connection: Connection): { text: string; rowCount: number; truncated: boolean } {
    const lines: string[] = [];
    let truncated = false;
    if (params.detail === "grouped") {
      const result = query({ ...params.query, limit: 1000 }, connection);
      lines.push([...params.query.groupBy, "turns", "input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "cost_usd", "equivalent_cost_usd", "unknown_cost_turns", "accuracy"].join(","));
      for (const row of result.rows) lines.push([...row.labels.map(cell), row.agent.turns.completed + row.agent.turns.cancelled + row.agent.turns.failed, row.agent.inputTokens, row.agent.cachedInputTokens, row.agent.cacheWriteTokens, row.agent.outputTokens, cell(row.agent.unknownCostTurns && !row.totalCostUsd ? null : row.totalCostUsd), row.agent.equivalentCostUsd, row.agent.unknownCostTurns, row.accuracy].join(","));
    } else {
      const { rows, readable, admin } = select(params.query, connection);
      lines.push(USAGE_CSV_COLUMNS.join(","));
      for (const row of rows) {
        if (lines.length > EXPORT_LIMIT) { truncated = true; break; }
        const visible = readable(row);
        const runtime = row.runtime_id ? deps.runtimeOf(row.runtime_id) : undefined;
        lines.push([
          "agent", new Date(row.started_ms).toISOString(), dayOf(row.started_ms), visible ? row.session_key : "", visible ? sessionRow(row.session_key)?.title ?? row.session_title ?? "" : "", visible ? row.root_session_key : "", visible ? row.parent_session_key : "",
          visible ? row.agent_id : "", "", row.project_id, row.project_id, "", "", "", visible && admin && row.device_id ? deps.deviceName(row.device_id) ?? "" : "", runtime?.label ?? row.runtime_id, row.runtime_id,
          row.provider_id ? deps.providerLabel(row.provider_id) ?? row.provider_id : "", row.model_id, "llm-agent", row.billing, row.outcome,
          row.token_source === "none" ? null : row.input_tokens, row.token_source === "none" ? null : row.cached_input_tokens, row.token_source === "none" ? null : row.cache_write_tokens, row.token_source === "none" ? null : row.output_tokens, "",
          // An unknown cost is an empty cell, never a zero.
          row.cost_source === "unknown" ? null : row.cost_usd, row.cost_source, row.equivalent_cost_usd, row.duration_ms, row.tool_calls,
        ].map(cell).join(","));
      }
    }
    return { text: `﻿${lines.join("\r\n")}\r\n`, rowCount: lines.length - 1, truncated };
  }

  // ---- methods ----

  const methods = new Map<string, RpcMethod>();
  const method = (name: keyof typeof USAGE_METHOD_SCOPES, handle: RpcMethod["handle"]) => methods.set(name, { scope: USAGE_METHOD_SCOPES[name], handle });

  method("jagentchill.usage.session.get", async (raw, connection) => {
    const params = parse(usageSessionGetParams, raw);
    const session = await sessionUsage(params.sessionId, connection);
    return { session, ...(params.includeTree ? { tree: tree(db.prepare("SELECT root_session_key FROM usage_records WHERE session_key = ? LIMIT 1").get(params.sessionId)?.root_session_key as string ?? params.sessionId, connection) } : {}), capture: captureError ?? null };
  });
  method("jagentchill.usage.query", (raw, connection) => query(parse(usageQueryParams, raw), connection));
  method("jagentchill.usage.tree.get", (raw, connection) => ({ node: tree(parse(usageTreeGetParams, raw).rootSessionId, connection) }));
  method("jagentchill.usage.history.get", (raw) => {
    const params = parse(usageHistoryGetParams, raw);
    if (params.from_day > params.to_day) throw new ProtocolError("INVALID_PARAMS", "The range ends before it starts.", { details: { path: "from_day" } });
    if ((Date.parse(params.to_day) - Date.parse(params.from_day)) / DAY_MS > USAGE_RANGE_DAYS) throw new ProtocolError("INVALID_PARAMS", "A range covers at most 800 days.", { details: { path: "to_day" } });
    const rollups = (db.prepare("SELECT * FROM usage_rollups WHERE day >= ? AND day <= ? ORDER BY day").all(params.from_day, params.to_day) as Array<Record<string, string | number>>).map((row): DailyRollup => ({
      day: row.day as string, providerId: row.provider_id as string, runtimeId: row.runtime_id as string, modelId: row.model_id as string, billing: row.billing as string, source: "agent", turns: row.turns as number,
      inputTokens: row.input_tokens as number, cachedInputTokens: row.cached_input_tokens as number, cacheWriteTokens: row.cache_write_tokens as number, outputTokens: row.output_tokens as number, costUsd: money(row.cost_usd as number), duration_ms: row.duration_ms as number,
    }));
    const lifetime = db.prepare("SELECT turns, tokens, cost_usd FROM usage_lifetime WHERE source = 'agent'").get() as { turns: number; tokens: number; cost_usd: number } | undefined;
    return { rollups, lifetime: { turns: lifetime?.turns ?? 0, tokens: lifetime?.tokens ?? 0, costUsd: money(lifetime?.cost_usd ?? 0) }, timeZone };
  });
  method("jagentchill.usage.plan.list", async (raw) => {
    const params = parse(usagePlanListParams, raw);
    const enabled = setting("planUsageAll");
    if (!enabled && params.runtimeId !== "claude-code" && params.runtimeId !== "codex") return { enabled, providers: [] };
    try {
      const providers = await planUsage(params.refresh === true, params.runtimeId);
      const filtered = params.providerIds ? providers.filter((provider) => params.providerIds!.includes(provider.providerId)) : providers;
      return { enabled, providers: filtered, fetched_ms: filtered.reduce((latest, provider) => Math.max(latest, provider.fetched_ms ?? 0), 0) || deps.now() };
    } catch (err) {
      // Keep the last report across host restarts, with fetched_ms left intact so the caller can show its age.
      const plan = plans.get(params.runtimeId ?? "");
      const stale = plan?.result ?? [];
      const providers = params.providerIds ? stale.filter((provider) => params.providerIds!.includes(provider.providerId)) : stale;
      return { enabled, providers, stale: providers.length > 0, error: err instanceof ProtocolError ? err.message : "Unable to load usage" };
    }
  });
  method("jagentchill.usage.budget.check", (raw, connection) => {
    const { sessionKey } = parse(usageBudgetCheckParams, raw);
    if (!deps.canRead(sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    try { assertBudget(sessionKey); return { blocked: false }; } catch (err) {
      if (err instanceof ProtocolError && err.code === "BUDGET_EXCEEDED") return { blocked: true, error: err.envelope() };
      throw err;
    }
  });
  method("jagentchill.usage.subscribe", (raw, connection) => {
    const params = parse(usageSubscribeParams, raw);
    const selection = subscribers.get(connection) ?? { sessionKeys: new Set<string>(), aggregate: false };
    for (const key of params.sessionKeys ?? []) selection.sessionKeys.add(key);
    selection.aggregate ||= params.aggregate === true;
    subscribers.set(connection, selection);
    return { stream: "usage" };
  });
  method("jagentchill.usage.unsubscribe", (raw, connection) => {
    const params = parse(usageSubscribeParams, raw);
    const selection = subscribers.get(connection);
    if (!selection) return;
    for (const key of params.sessionKeys ?? []) selection.sessionKeys.delete(key);
    if (params.aggregate) selection.aggregate = false;
    if (!selection.sessionKeys.size && !selection.aggregate) subscribers.delete(connection);
  });
  method("jagentchill.usage.export", (raw, connection) => {
    const params = parse(usageExportParams, raw);
    const { text, rowCount, truncated } = csv(params, connection);
    const blobSha256 = createHash("sha256").update(text).digest("hex");
    mkdirSync(exportsDir, { recursive: true });
    for (const file of readdirSync(exportsDir)) if (deps.now() - statSync(join(exportsDir, file)).mtimeMs > DAY_MS) rmSync(join(exportsDir, file), { force: true });
    writeFileSync(join(exportsDir, `${blobSha256}.csv`), text, { mode: 0o600 });
    return { blobSha256, fileName: `jagentchill-usage-${dayOf(params.query.from_ms)}-${dayOf(params.query.to_ms)}.csv`, rowCount, truncated };
  });
  method("jagentchill.usage.history.reset", (raw, connection) => {
    const params = parse(usageResetParams, raw);
    // Budget amounts already committed for the running periods stay as they are.
    db.exec("DELETE FROM usage_records; DELETE FROM usage_rollups; DELETE FROM usage_lifetime;");
    audit(db, deps.now(), `device:${connection.deviceId}`, "usage.history.reset", { scope: params.scope });
    for (const [subscriber] of subscribers) subscriber.send("jagentchill.usage.updated", "usage", {});
    return { scope: params.scope };
  });

  method("jagentchill.provider.budget.list", () => ({ budgets: budgets().map(stateOf), planTurnsAtListPrice: setting("budgetPlanTurnsAtListPrice") }));
  method("jagentchill.provider.budget.set", (raw, connection) => {
    const budget = parse(z.object({ budget: budgetSchema }).strict(), raw).budget;
    const same = (entry: Budget) => entry.scope === budget.scope && entry.scopeId === budget.scopeId;
    deps.config.set("budgets", [...budgets().filter((entry) => !same(entry)), budget]);
    audit(db, deps.now(), `device:${connection.deviceId}`, "budget.set", { scope: budget.scope, scopeId: budget.scopeId ?? null, limitUsd: budget.limitUsd, period: budget.period, hardStop: budget.hardStop });
    return { budget: stateOf(budget) };
  });
  // Raise-only, decided here against the limit the host holds at this moment — a device that read the limit earlier and
  // writes a new one would undo a higher limit another admin set in between. The read and the write are one step of
  // the host (nothing runs between them), so of two admins acting at once the higher limit always stands.
  method("jagentchill.provider.budget.raise", (raw, connection) => {
    const params = parse(budgetRaiseParams, raw);
    const same = (entry: Budget) => entry.scope === params.scope && (entry.scopeId ?? undefined) === params.scopeId;
    const current = budgets().find(same);
    if (!current) throw new ProtocolError("NOT_FOUND", "There is no such budget.");
    if (params.toUsd <= current.limitUsd) return { raised: false, budget: stateOf(current) };
    const budget: Budget = { ...current, limitUsd: params.toUsd };
    deps.config.set("budgets", budgets().map((entry) => (same(entry) ? budget : entry)));
    audit(db, deps.now(), `device:${connection.deviceId}`, "budget.raise", { scope: budget.scope, scopeId: budget.scopeId ?? null, fromUsd: current.limitUsd, limitUsd: budget.limitUsd });
    return { raised: true, budget: stateOf(budget) };
  });
  method("jagentchill.provider.budget.remove", (raw, connection) => {
    const params = parse(budgetRemoveParams, raw);
    const kept = budgets().filter((entry) => !(entry.scope === params.scope && entry.scopeId === params.scopeId));
    if (kept.length === budgets().length) throw new ProtocolError("NOT_FOUND", "There is no such budget.");
    deps.config.set("budgets", kept);
    audit(db, deps.now(), `device:${connection.deviceId}`, "budget.remove", { scope: params.scope, scopeId: params.scopeId ?? null });
    return {};
  });
  // The two host settings of usage. The general settings method belongs to another capability; only these keys are served here.
  methods.set("jagentchill.settings.host.patch", {
    scope: "jagentchill.config.write",
    handle(raw, connection) {
      const { patch } = parse(z.object({ patch: z.object({ "usage.planUsageAll": z.boolean().optional(), "usage.budgetPlanTurnsAtListPrice": z.boolean().optional() }).strict() }).strict(), raw);
      const current = deps.config.get<Record<string, unknown>>("usage") ?? {};
      const next = { ...current, ...(patch["usage.planUsageAll"] !== undefined ? { planUsageAll: patch["usage.planUsageAll"] } : {}), ...(patch["usage.budgetPlanTurnsAtListPrice"] !== undefined ? { budgetPlanTurnsAtListPrice: patch["usage.budgetPlanTurnsAtListPrice"] } : {}) };
      deps.config.set("usage", next);
      if (patch["usage.planUsageAll"] !== undefined) { plans.clear(); audit(db, deps.now(), `device:${connection.deviceId}`, patch["usage.planUsageAll"] ? "usage.planUsage.enable" : "usage.planUsage.disable", {}); }
      else audit(db, deps.now(), `device:${connection.deviceId}`, "usage.settings.changed", { keys: Object.keys(patch) });
      return { usage: next };
    },
  });

  // A turn that was open when the server stopped never reached its end: it is closed as failed with what it had.
  // (Here, not at the top: closing a record uses helpers declared above this line — at the top the host could not start again after it was stopped during a turn.)
  for (const row of db.prepare("SELECT * FROM usage_records WHERE open = 1").all() as Row[]) close(row, "failed", {});

  return {
    methods, assertBudget,
    /** The relay sent a turn: its record is opened with the device that sent it. */
    turnStarted(sessionKey: string, runId: string, deviceId: string | undefined): void {
      const session = sessionRow(sessionKey);
      if (session) open(session, runId, deviceId, deps.now());
    },
    exportBlob(sha256: string): Buffer | undefined {
      const file = join(exportsDir, `${sha256}.csv`);
      return /^[0-9a-f]{64}$/.test(sha256) && existsSync(file) ? readFileSync(file) : undefined;
    },
    dropConnection: (connection: Connection) => void subscribers.delete(connection),
    runtimeEvent,
    /** The server is stopping under running turns: they are closed as failed with what they had. */
    closeOpenTurns(): void {
      for (const row of db.prepare("SELECT * FROM usage_records WHERE open = 1").all() as Row[]) { close(row, "failed", {}); notify(row.session_key, true); }
    },
    /** Deletes records older than the retention period; rollups and the lifetime total keep what they counted. */
    purge(): number {
      const months = Number(deps.config.get<Record<string, unknown>>("usage")?.retentionMonths ?? 24);
      const before = deps.now() - Math.min(60, Math.max(3, months)) * 30.4375 * DAY_MS;
      return Number(db.prepare("DELETE FROM usage_records WHERE id IN (SELECT id FROM usage_records WHERE started_ms < ? AND open = 0 LIMIT 10000)").run(before).changes);
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
