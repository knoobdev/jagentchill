import { z } from "zod";
import type { Scope } from "./roles.ts";

export const USAGE_DIMENSIONS = [
  "provider", "endpoint", "runtime", "model", "billing", "tokenSource", "priceSource", "project", "session", "rootSession", "agent", "device", "source", "outcome", "day", "month",
] as const;
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number];
export const USAGE_RANGE_DAYS = 800;

export type CostSource = "reported" | "estimated" | "included" | "unknown";
export type UsageAccuracy = "reported" | "estimated" | "mixed" | "partial";
export type TurnOutcome = "completed" | "cancelled" | "failed";
/** One agent turn. It holds counts and identifiers only: no prompt, no answer, no tool payload. */
export type UsageRecord = {
  id: number; sessionKey: string; runId: string; rootSessionKey: string; parentSessionKey?: string; agentId: string; projectId?: string;
  /** `null` for every role but `admin`. */
  deviceId?: string | null;
  runtimeId: string | null; providerId: string | null; endpointId?: string; modelId: string | null;
  billing: "api" | "plan" | "local" | "unknown"; outcome: TurnOutcome;
  inputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; outputTokens?: number; totalTokens?: number;
  tokenSource: "reported" | "estimated" | "none"; costUsd?: number; costSource: CostSource; priceSource: "provider" | "aggregator" | "admin" | "none"; equivalentCostUsd?: number;
  toolCalls: number; started_ms: number; duration_ms: number; contextUsedTokens?: number; contextMaxTokens?: number; reconciled: boolean;
};
export type TurnCounts = { completed: number; cancelled: number; failed: number };
export type UsageAgentTotals = {
  turns: TurnCounts; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; costUsd: number; equivalentCostUsd: number;
  includedTurns: number; unknownCostTurns: number; unreportedTurns: number; duration_ms: number; toolCalls: number;
};
export type UsageRow = {
  keys: string[]; labels: string[]; agent: UsageAgentTotals; generation: { calls: number; units: number; costUsd: number; unknownCostCalls: number };
  totalCostUsd: number; estimatedTokenTurns: number; unpricedTurns: number; accuracy: UsageAccuracy;
};
export type UsageQueryResult = { rows: UsageRow[]; totals: UsageRow; timeZone: string; nextCursor?: string };
export type SessionUsage = {
  sessionKey: string; title: string; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; totalTokens: number;
  agentCostUsd: number; generationCostUsd: number; totalCostUsd: number; equivalentCostUsd: number; /** Sum of priced CLI token classes across reported model requests in this session. */ sessionCostUsd?: number | null; costUnavailableReason?: "no-list-price"; costUnavailableModels?: string[]; turns: TurnCounts; toolCalls: number; duration_ms: number;
  firstTurn_ms?: number; lastTurn_ms?: number; byRuntime: UsageRow[]; byModel: UsageRow[]; accuracy: UsageAccuracy; unknownCostTurns: number; includedTurns: number; unreportedTurns: number;
  records: UsageRecord[]; context: { usedTokens: number; maxTokens: number; pct: number; source: "reported"; model: string; updated_ms: number } | { source: "unknown" };
};
export type UsageTreeNode = {
  sessionKey: string; agentId: string; label: string; runtimeId: string | null; modelId: string | null; own: UsageAgentTotals; subtree: UsageAgentTotals; sharePct: number; children: UsageTreeNode[];
};
export type DailyRollup = {
  day: string; providerId: string; runtimeId: string; modelId: string; billing: string; source: "agent"; turns: number; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number;
  outputTokens: number; costUsd: number; duration_ms: number;
};
export type PlanUsage = {
  providerId: string; runtimeIds: string[]; displayName: string; status: "available" | "unavailable" | "error" | "off" | "sign-in-required"; planLabel?: string; sourceLabel?: string; fetched_ms?: number; nextRefresh_ms?: number;
  windows: Array<{ id: string; label: string; usedPct?: number; remainingPct?: number; resetsAt_ms?: number; tone: "default" | "ok" | "warning" | "danger" }>;
  extraUsageEnabled?: boolean;
  extraUsage?: { enabled: true; used?: number; limit?: number; unit: "usd" | "credits" | "requests" | "tokens" };
  balances: Array<{ id: string; label: string; used?: number; remaining?: number; limit?: number; unit: "usd" | "credits" | "requests" | "tokens"; tone: "default" | "ok" | "warning" | "danger" }>;
  details: Array<{ label: string; value: string }>; error?: string;
};

export const BUDGET_SCOPES = ["global", "provider", "project", "session"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export const budgetSchema = z.object({
  scope: z.enum(BUDGET_SCOPES), scopeId: z.string().min(1).max(200).optional(), limitUsd: z.number().min(0.01).max(100_000), period: z.enum(["month", "total"]),
  hardStop: z.boolean().default(true), allowUnknownCost: z.boolean().default(false),
}).strict().refine((budget) => (budget.scope === "global") === (budget.scopeId === undefined), { message: "scopeId" })
  .refine((budget) => budget.period === "month" || budget.scope === "project" || budget.scope === "session", { message: "period" });
export type Budget = z.infer<typeof budgetSchema>;
export type BudgetState = Budget & { spentUsd: number; remainingUsd: number; exhausted: boolean; warning: boolean; label: string; includesUnpriced: boolean; uncountedTurns: number };

const dimension = z.enum(USAGE_DIMENSIONS);
const filterValue = z.union([z.string().max(300), z.array(z.string().max(300)).max(50)]);
export const usageQueryParams = z.object({
  groupBy: z.array(dimension).min(1).max(3), filters: z.record(dimension, filterValue).optional(), from_ms: z.number().int().nonnegative(), to_ms: z.number().int().nonnegative(),
  sort: z.enum(["cost", "tokens", "turns", "key"]).optional(), cursor: z.string().max(40).optional(), limit: z.number().int().min(1).max(1000).default(100),
}).strict();
export type UsageQuery = z.input<typeof usageQueryParams>;
export const usageSessionGetParams = z.object({ sessionId: z.string().min(1).max(200), includeTree: z.boolean().optional() }).strict();
export const usageTreeGetParams = z.object({ rootSessionId: z.string().min(1).max(200) }).strict();
export const usageHistoryGetParams = z.object({ from_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
export const usagePlanListParams = z.object({ providerIds: z.array(z.string().min(1).max(120)).max(50).optional(), runtimeId: z.string().min(1).max(120).optional(), refresh: z.boolean().optional() }).strict();
export const usageBudgetCheckParams = z.object({ sessionKey: z.string().min(1).max(200) }).strict();
export const usageSubscribeParams = z.object({ sessionKeys: z.array(z.string().min(1).max(200)).max(200).optional(), aggregate: z.boolean().optional() }).strict();
export const usageExportParams = z.object({ query: usageQueryParams, detail: z.enum(["grouped", "records"]), idempotencyKey: z.string().min(1).max(128) }).strict();
export const usageResetParams = z.object({ confirm: z.literal(true), scope: z.enum(["agent", "all"]) }).strict();
export const budgetRemoveParams = z.object({ scope: z.enum(BUDGET_SCOPES), scopeId: z.string().min(1).max(200).optional() }).strict();
/** Raises the limit of an existing budget to `toUsd`; the host leaves a limit that is already as high or higher as it is (`raised: false`). */
export const budgetRaiseParams = z.object({ scope: z.enum(BUDGET_SCOPES), scopeId: z.string().min(1).max(200).optional(), toUsd: z.number().min(0.01).max(100_000) }).strict();

const read: Scope = "jagentchill.config.read", write: Scope = "jagentchill.config.write";
/** The ten methods of the usage domain, and the three budget methods the Limits tab needs. */
export const USAGE_METHOD_SCOPES = {
  "jagentchill.usage.session.get": read, "jagentchill.usage.query": read, "jagentchill.usage.tree.get": read, "jagentchill.usage.history.get": read,
  "jagentchill.usage.plan.list": read, "jagentchill.usage.budget.check": "jagentchill.agent.use", "jagentchill.usage.subscribe": read, "jagentchill.usage.unsubscribe": read,
  "jagentchill.usage.export": read, "jagentchill.usage.history.reset": write,
  "jagentchill.provider.budget.list": read, "jagentchill.provider.budget.set": write, "jagentchill.provider.budget.remove": write,
  "jagentchill.provider.budget.raise": write,
} as const satisfies Record<string, Scope>;
export const USAGE_CSV_COLUMNS = [
  "source", "timestamp_utc", "day_host_tz", "session_id", "session_title", "root_session_id", "parent_session_id", "agent", "role", "project_id", "project_name", "team_run_id",
  "workflow_run_id", "automation_id", "device_name", "runtime", "base_runtime", "provider", "model", "capability", "billing", "outcome", "input_tokens", "cached_input_tokens",
  "cache_write_tokens", "output_tokens", "units", "cost_usd", "cost_source", "equivalent_cost_usd", "duration_ms", "tool_calls",
] as const;
