// Pure logic of the run view's "Spending limit reached" block; no host is involved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { limitChanged, limitKind, parseNewLimit, raiseOnHost, stoppedBudget, type BudgetRow } from "./budgetStop.ts";

const BUDGETS: BudgetRow[] = [
  { scope: "global", limitUsd: 50, period: "month", hardStop: true, allowUnknownCost: false, spentUsd: 3 },
  { scope: "provider", scopeId: "openrouter", limitUsd: 0.01, period: "month", hardStop: true, allowUnknownCost: true, spentUsd: 0.011 },
  { scope: "project", scopeId: "prj_1", limitUsd: 2, period: "total", hardStop: true, allowUnknownCost: false },
  { scope: "session", scopeId: "agent:main:abc", limitUsd: 5, period: "total", hardStop: true, allowUnknownCost: false },
  { scope: "session", scopeId: "run:run_1", limitUsd: 0.01, period: "total", hardStop: true, allowUnknownCost: false },
];

test("Budgets during a run: Raise budget raises the budget the refusal names — the one of that scope and id, not the global one; the run's own budget is told apart", () => {
  assert.deepEqual(stoppedBudget({ scope: "provider", scopeId: "openrouter", class: "budget_exceeded" }, "run_1", BUDGETS), { scope: "provider", scopeId: "openrouter", budget: BUDGETS[1], ownRun: false, unpriced: false });
  assert.deepEqual(stoppedBudget({ scope: "global", scopeId: null }, "run_1", BUDGETS), { scope: "global", budget: BUDGETS[0], ownRun: false, unpriced: false });
  assert.deepEqual(stoppedBudget({ scope: "project", scopeId: "prj_1" }, "run_1", BUDGETS)?.budget, BUDGETS[2]);
  assert.deepEqual(stoppedBudget({ scope: "session", scopeId: "agent:main:abc" }, "run_1", BUDGETS), { scope: "session", scopeId: "agent:main:abc", budget: BUDGETS[3], ownRun: false, unpriced: false });
  // The run's own budget: only of THIS run.
  assert.deepEqual(stoppedBudget({ scope: "session", scopeId: "run:run_1" }, "run_1", BUDGETS), { scope: "session", scopeId: "run:run_1", budget: BUDGETS[4], ownRun: true, unpriced: false });
  assert.equal(stoppedBudget({ scope: "session", scopeId: "run:run_1" }, "run_2", BUDGETS)?.ownRun, false);
  // A device that may not read budgets still learns which one it is; a refusal that is no budget of the list is none.
  assert.deepEqual(stoppedBudget({ scope: "provider", scopeId: "openrouter" }, "run_1", null), { scope: "provider", scopeId: "openrouter", ownRun: false, unpriced: false });
  assert.equal(stoppedBudget({ scope: "confirmed_estimate" }, "run_1", BUDGETS), null);
  assert.equal(stoppedBudget({ scope: "agent", agentId: "a1" }, "run_1", BUDGETS), null);
  assert.equal(stoppedBudget({ scope: "provider" }, "run_1", BUDGETS), null);
  assert.equal(stoppedBudget(undefined, "run_1", BUDGETS), null);
  // A budget that refuses a model without a price is not used up: raising it changes nothing, so no raise is offered.
  assert.equal(stoppedBudget({ scope: "global", scopeId: null, reason: "unpriced_model", modelId: "stub-chat" }, "run_1", BUDGETS)?.unpriced, true);
});

test("Budgets during a run: the new limit is the amount the person types — nothing is proposed, and it must be above the limit that stopped the run", () => {
  assert.deepEqual(parseNewLimit("", 5), { ok: false, reason: "empty" });
  assert.deepEqual(parseNewLimit("  ", 5), { ok: false, reason: "empty" });
  assert.deepEqual(parseNewLimit("ten", 5), { ok: false, reason: "number" });
  assert.deepEqual(parseNewLimit("5.001", 5), { ok: false, reason: "number" });
  assert.deepEqual(parseNewLimit("5", 5), { ok: false, reason: "not_higher" });
  assert.deepEqual(parseNewLimit("4.99", 5), { ok: false, reason: "not_higher" });
  assert.deepEqual(parseNewLimit("0", 0.01), { ok: false, reason: "range" });
  assert.deepEqual(parseNewLimit("100001", 5), { ok: false, reason: "range" });
  assert.deepEqual(parseNewLimit("5.5", 5), { ok: true, limitUsd: 5.5 });
  assert.deepEqual(parseNewLimit("$12", 5), { ok: true, limitUsd: 12 });
  assert.deepEqual(parseNewLimit("0,02", 0.01), { ok: true, limitUsd: 0.02 });
});

test("Budgets during a run: Raise budget never lowers a limit — the host decides at the moment of applying: a limit another admin raised meanwhile above the typed amount is left as it is, a budget removed meanwhile is not put back, and a typed amount above the current limit is sent with everything else of the CURRENT budget", async () => {
  const stopped = stoppedBudget({ scope: "provider", scopeId: "openrouter", limitUsd: 0.01 }, "run_1", BUDGETS)!;
  // ONE call goes to the host, the raise-only one: nothing is read first and no budget is written from the device
  // (the host's side of it, with another admin's change arriving in between, is server/test/usage.test.ts).
  const sent: Array<[string, unknown]> = [];
  const host = (answer: unknown) => async (method: string, params: unknown) => { sent.push([method, params]); if (answer instanceof Error) throw answer; return answer; };
  const raised = { ...BUDGETS[1], limitUsd: 50 };
  assert.deepEqual(await raiseOnHost(host({ raised: true, budget: { ...BUDGETS[1], limitUsd: 5 } }), stopped, 5), { kind: "raised", budget: { ...BUDGETS[1], limitUsd: 5 } });
  assert.deepEqual(sent, [["jagentchill.provider.budget.raise", { scope: "provider", scopeId: "openrouter", toUsd: 5 }]]);
  // Another admin raised it to 50 meanwhile: the host changed nothing, and the caller is given the current budget to show.
  assert.deepEqual(await raiseOnHost(host({ raised: false, budget: raised }), stopped, 5), { kind: "not_higher", current: raised });
  // Removed meanwhile: nothing is put back. Any other refusal is the caller's to show.
  assert.deepEqual(await raiseOnHost(host(Object.assign(new Error("gone"), { code: "NOT_FOUND" })), stopped, 5), { kind: "gone" });
  await assert.rejects(raiseOnHost(host(Object.assign(new Error("no"), { code: "SCOPE_DENIED" })), stopped, 5), /no/);
  assert.deepEqual(await raiseOnHost(host({ raised: true, budget: BUDGETS[0] }), { scope: "global" }, 80).then(() => sent.at(-1)), ["jagentchill.provider.budget.raise", { scope: "global", toUsd: 80 }]);
  // The screen offers to continue only when the limit is no longer the one that refused the step.
  assert.equal(limitChanged(stopped, 0.01, true), false);
  assert.equal(limitChanged(stoppedBudget({ scope: "provider", scopeId: "openrouter" }, "run_1", [raised]), 0.01, true), true);
  assert.equal(limitChanged(stoppedBudget({ scope: "provider", scopeId: "openrouter" }, "run_1", []), 0.01, true), true, "removed");
  assert.equal(limitChanged(stoppedBudget({ scope: "provider", scopeId: "openrouter" }, "run_1", null), 0.01, false), false, "not listed yet: nothing is known");
  assert.deepEqual([stoppedBudget({ scope: "global", scopeId: null }, "r", BUDGETS), stoppedBudget({ scope: "provider", scopeId: "openrouter" }, "r", BUDGETS), stoppedBudget({ scope: "project", scopeId: "prj_1" }, "r", BUDGETS), stoppedBudget({ scope: "session", scopeId: "run:r" }, "r", BUDGETS), stoppedBudget({ scope: "session", scopeId: "agent:main:abc" }, "r", BUDGETS), null].map(limitKind), ["host", "provider", "project", "run", "session", "unknown"]);
});
