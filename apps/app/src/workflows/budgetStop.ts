/**
 * A run a hard-stop budget paused: which budget it is (the refusal names it by `scope` and `scopeId`), and the new
 * limit a person types to raise it. Pure: the run view draws from it and sends the host's own budget calls.
 */
export type BudgetRow = { scope: string; scopeId?: string; limitUsd: number; period: "month" | "total"; hardStop: boolean; allowUnknownCost: boolean; spentUsd?: number };
export type StoppedBudget = {
  scope: string; scopeId?: string;
  /** The budget as the host lists it; absent when this device may not read budgets or the limit is not one of them. */
  budget?: BudgetRow;
  /** The run's own budget (a session budget kept under `run:<runId>`): it can also be removed. */
  ownRun: boolean;
  /** The budget is not used up: it refuses a model that has no price (`reason: "unpriced_model"`). A higher limit changes nothing. */
  unpriced: boolean;
};
const SCOPES = new Set(["global", "provider", "project", "session"]);

/** The budget a refusal names, found in the host's list. `null`: the refusal is not about a budget of the host's list. */
export function stoppedBudget(details: unknown, runId: string, budgets: readonly BudgetRow[] | null): StoppedBudget | null {
  const bag = (details && typeof details === "object" ? details : {}) as { scope?: unknown; scopeId?: unknown; reason?: unknown };
  if (typeof bag.scope !== "string" || !SCOPES.has(bag.scope)) return null;
  const scopeId = typeof bag.scopeId === "string" && bag.scopeId ? bag.scopeId : undefined;
  // A global budget has no id; every other scope is one budget per id.
  if ((bag.scope === "global") !== (scopeId === undefined)) return null;
  const budget = budgets?.find((entry) => entry.scope === bag.scope && (entry.scopeId ?? undefined) === scopeId);
  return { scope: bag.scope, ...(scopeId ? { scopeId } : {}), ...(budget ? { budget } : {}), ownRun: bag.scope === "session" && scopeId === `run:${runId}`, unpriced: bag.reason === "unpriced_model" };
}

export type NewLimit = { ok: true; limitUsd: number } | { ok: false; reason: "empty" | "number" | "not_higher" | "range" };
/** What a person typed as the new limit: an amount in dollars, above the limit that stopped the run, within what a budget takes. */
export function parseNewLimit(typed: string, currentUsd: number): NewLimit {
  const text = typed.trim().replace(/^\$/, "").replace(",", ".");
  if (!text) return { ok: false, reason: "empty" };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, reason: "number" };
  const limitUsd = Number(text);
  if (limitUsd < 0.01 || limitUsd > 100_000) return { ok: false, reason: "range" };
  if (limitUsd <= currentUsd) return { ok: false, reason: "not_higher" };
  return { ok: true, limitUsd };
}

export type Raised =
  /** The host raised the limit to the typed amount. */
  | { kind: "raised"; budget: BudgetRow }
  /** The host holds a limit that is already as high or higher (someone raised it meanwhile): it changed nothing. */
  | { kind: "not_higher"; current: BudgetRow }
  /** The budget is no longer there (someone removed it): nothing was put back. */
  | { kind: "gone" };
/**
 * "Raise budget": ONE call, `jagentchill.provider.budget.raise`, which the host decides against the limit it holds at
 * that moment. Nothing is read first and no budget is written from here — a limit read by this device can be out of
 * date by the time its write arrives, and this action must never lower a limit another admin raised a moment ago.
 */
export async function raiseOnHost(call: (method: string, params: unknown) => Promise<unknown>, stopped: Pick<StoppedBudget, "scope" | "scopeId">, toUsd: number): Promise<Raised> {
  try {
    const answer = (await call("jagentchill.provider.budget.raise", { scope: stopped.scope, ...(stopped.scopeId ? { scopeId: stopped.scopeId } : {}), toUsd })) as { raised: boolean; budget: BudgetRow };
    return answer.raised ? { kind: "raised", budget: answer.budget } : { kind: "not_higher", current: answer.budget };
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "NOT_FOUND") return { kind: "gone" };
    throw error;
  }
}
/**
 * Whether the limit that stopped the run is no longer the one the refusal met — it was raised or removed somewhere
 * else (another admin, Settings): the run can go on. `refusedAtUsd` is the limit the refusal itself names.
 */
export function limitChanged(stopped: StoppedBudget | null, refusedAtUsd: number | undefined, listed: boolean): boolean {
  if (!stopped || !listed || stopped.unpriced) return false;
  return !stopped.budget || (refusedAtUsd !== undefined && stopped.budget.limitUsd > refusedAtUsd);
}
/** Which limit a refusal is about, as a key of the sentence the screens say (never the host's raw message). */
export function limitKind(stopped: StoppedBudget | null): "host" | "provider" | "project" | "run" | "session" | "unknown" {
  if (!stopped) return "unknown";
  return stopped.ownRun ? "run" : stopped.scope === "global" ? "host" : stopped.scope === "provider" ? "provider" : stopped.scope === "project" ? "project" : "session";
}
