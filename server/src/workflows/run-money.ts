import { workflow as wf } from "@jagentchill/editor-core";
import type { DatabaseSync } from "node:sqlite";
import type { WorkflowDocument } from "@jagentchill/protocol";
import type { WorkflowDocuments } from "./documents.ts";
import type { TurnAsk, TurnMoney } from "./runs.ts";

/**
 * The money question of a run a person starts (`agent-workflows`, "Cost and time estimate before a run": "An
 * interactive run starts only after the user confirms the estimate"): what the run can cost at most, step by step, and
 * whether the person has to be asked at all. A workflow with no step that can spend has no estimate and no question.
 *
 * Only steps that send a turn to a model are counted here (`agent`, also inside sub-workflows): they are the steps a
 * person can put into a workflow of their own that cost money. The built-in templates' `tool` steps keep their own
 * question (the video run's start).
 */
/** A started run asks no money question again until it would pass this share of what its starter confirmed ("Budgets during a run", Confirmed-estimate guard). */
export const CONFIRMED_SHARE = 1.2;
const FREE_STEPS = new Set(["trigger", "approval", "branch", "loop", "parallel", "join", "wait", "human_input", "notify"]);
/** Amounts as the paid-call gate keeps them (a millionth of a dollar): what is confirmed is exactly what the steps are reserved with. */
const money6 = (usd: number): number => Math.round(usd * 1e6) / 1e6;

export type RunEstimateStep = {
  nodeId: string; name: string;
  /** The model the step is sent to, by the name the price list has for it; a role nobody set a model for is named by the role. */
  model: string;
  /** How often the step can run in one run (a loop's most iterations, the items of a list that is known) — or, with `perItem`, for ONE item of the list. */
  calls: number;
  /** The step runs once for each item of a list nobody knows the length of before the run: `calls` and `highUsd` are for ONE item, and no number of items is assumed. Names the fan-out step that list belongs to. */
  perItem?: { nodeId: string; name: string };
  /** The most ONE of those can cost; null: the price of the model is not known. */
  unitUsd: number | null;
  /** The most all of them can cost; null: not known. */
  highUsd: number | null;
  /** Ruling R10: the amounts are worked out from the model's MEASURED prompt size on this host (and the limit of its answer): a screen says "about". */
  measured?: true;
};
export type RunEstimate = {
  /** Whether any step of the run can spend money at all. */
  canSpend: boolean;
  steps: RunEstimateStep[];
  /** The most the run can cost, of what has a known price — WITHOUT the steps counted per item (`perItemUsd`). */
  highUsd: number;
  /** What each item of a list of unknown length adds at most (0: no such list): the run is quoted and held "per item", never with a made-up number of items. */
  perItemUsd: number;
  /** The same amount by fan-out step: what the run is allowed more for each item its list turns out to have. */
  itemRates: Record<string, number>;
  /** Steps on a model that runs on the person's own signed-in account (Claude Code, Codex — ruling R9): not billed by this app, no part of the amounts above, nothing to approve. */
  ownAccount: { label: string; model: string; account?: string }[];
  /** The models whose price is not known, by name (their cost is NOT in `highUsd`). */
  unpricedModels: string[];
  assumptions: string[];
};
export type RunConfirmation = { needed: boolean; amountUsd: number; stopsAtUsd: number; /** What each item of a list of unknown length adds (0: none). */ perItemUsd: number; unpricedModels: string[] };

export function createRunMoney(deps: { docs: WorkflowDocuments; port: () => TurnMoney; db?: DatabaseSync }) {
  // What a started run was confirmed for beside its amount: the per-item amounts of its lists of unknown length (kept with the run, also across a restart).
  deps.db?.exec("CREATE TABLE IF NOT EXISTS workflow_run_item_rates (run_id TEXT PRIMARY KEY, record TEXT NOT NULL)");
  /** How many items a fan-out step gets when that can be read before the run: a list typed as the port's own value, or a run parameter wired to it. Undefined: only the run will know. */
  function itemsOf(doc: WorkflowDocument, nodeId: string, params: Record<string, unknown>): number | undefined {
    const node = doc.nodes.find((entry) => entry.id === nodeId), edges = doc.edges.filter((edge) => edge.to.node === nodeId && edge.to.port === "items");
    if (!node) return undefined;
    if (!edges.length) { const typed = node.inputs.find((input) => input.id === "items")?.default; return Array.isArray(typed) ? typed.length : undefined; }
    const from = edges.length === 1 ? doc.nodes.find((entry) => entry.id === edges[0]!.from.node) : undefined;
    if (from?.type !== "trigger" || !doc.parameters.some((param) => param.name === edges[0]!.from.port)) return undefined;
    const value = params[edges[0]!.from.port];
    return Array.isArray(value) ? value.length : undefined;
  }
  /** The text of a step's message as far as it is known before the run; `open`: it also reads something only the run will know (another step's output). */
  function messageOf(node: WorkflowDocument["nodes"][number], params: Record<string, unknown>): { message: string; open: boolean } {
    const config = node.config as { promptTemplate?: unknown; instructions?: unknown };
    let open = false;
    const fill = (text: string): string => text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, path: string) => {
      const [root, name] = path.split(".");
      const value = root === "params" && name ? params[name] : undefined;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
      if (value !== undefined && value !== null) { try { return JSON.stringify(value); } catch { /* counted as open below */ } }
      open = true;
      return whole;
    });
    const instructions = fill(String(config.instructions ?? "")).trim(), prompt = fill(String(config.promptTemplate ?? ""));
    return { message: instructions ? `${instructions}\n\n${prompt}` : prompt, open };
  }
  const askOf = (node: WorkflowDocument["nodes"][number], message: string, open: boolean): TurnAsk => {
    const runtime = (node.config as { runtime?: { mode?: string; role?: string; runtime?: string; provider?: string; model?: string } }).runtime;
    return { ...(runtime?.mode === "override" ? { ref: { runtimeId: String(runtime.runtime), providerId: String(runtime.provider), modelId: String(runtime.model) } } : { role: runtime?.role ?? "director" }), message, ...(open ? { more: true } : {}) };
  };

  function collect(doc: WorkflowDocument, params: Record<string, unknown>, times: number, depth: number, into: { steps: RunEstimateStep[]; assumptions: Set<string>; other: boolean; ownAccount: RunEstimate["ownAccount"] }, outer?: { nodeId: string; name: string }): void {
    const info = wf.analyse(doc);
    for (const node of doc.nodes) {
      if (node.disabled || FREE_STEPS.has(node.type)) continue;
      // A list whose length is known counts with that length. One that only the run will know is given NO number: the
      // steps inside are quoted for one item, and the run is allowed that much for each item the list turns out to have.
      let calls = times, perItem = outer;
      for (const owner of info.chain.get(node.id) ?? []) {
        const body = doc.nodes.find((entry) => entry.id === owner.id);
        if (owner.kind === "loop") { calls *= Math.max(1, Number(body?.config.maxIterations ?? 3) || 1); continue; }
        const items = itemsOf(doc, owner.id, params);
        if (items !== undefined) calls *= items;
        // (In a workflow run as a step of another the list is named by the outer run's own fan-out, when it stands in one.)
        else if (!perItem) { perItem = { nodeId: depth === 0 ? owner.id : `${doc.id}:${owner.id}`, name: body?.name ?? owner.id }; into.assumptions.add(`item count of ${body?.name ?? owner.id} not known before the run`); }
      }
      if (node.type === "agent") {
        // A step that is handed another step's package reads text nobody knows the length of yet, like one whose prompt names another step's output.
        const handed = doc.edges.some((edge) => edge.to.node === node.id && edge.to.port === "handoff");
        const { message, open } = messageOf(node, params), bound = deps.port().turnBound?.(askOf(node, message, open || handed));
        const runtime = (node.config as { runtime?: { mode?: string; role?: string; model?: string } }).runtime;
        // A role nobody set a model for cannot be sent anything: the step fails where it stands and costs nothing.
        const unrouted = bound?.routed === false, unitUsd = unrouted ? 0 : bound ? bound.usd : null;
        if (unrouted) into.assumptions.add(`Cannot run: no model for ${runtime?.role ?? "director"}`);
        // Ruling R9: a model on the person's own signed-in account is not billed by this app — no step of the quote, no price to know, nothing to approve.
        const own = bound as ({ ownAccount?: true; account?: string } & typeof bound) | undefined;
        if (own?.ownAccount) { into.ownAccount.push({ label: node.name, model: own.model, ...(own.account ? { account: own.account } : {}) }); continue; }
        into.steps.push({ nodeId: node.id, name: node.name, model: bound?.model ?? (runtime?.mode === "override" ? String(runtime.model) : runtime?.role ?? "director"), calls, unitUsd, highUsd: unitUsd === null ? null : money6(unitUsd * calls), ...(perItem ? { perItem } : {}), ...(bound?.measured && unitUsd ? { measured: true as const } : {}) });
      } else if (node.type === "subworkflow") {
        const config = node.config as { workflowId?: string; revision?: "latest" | { pinned: number } };
        let child: WorkflowDocument | undefined;
        try { child = config.revision && config.revision !== "latest" ? deps.docs.revision(String(config.workflowId ?? ""), config.revision.pinned) : deps.docs.find(String(config.workflowId ?? "")); } catch { child = undefined; }
        // The child's own parameters are bound by the step and are not known here: its prompts are counted as open.
        if (child && depth < 8) collect(child, {}, calls, depth + 1, into, perItem);
      } else into.other = true;
    }
  }

  function estimate(workflowId: string, params: Record<string, unknown>, revision?: number): RunEstimate {
    const head = deps.docs.get(workflowId), doc = revision && revision !== head.revision ? deps.docs.revision(workflowId, revision) ?? head : head;
    const into = { steps: [] as RunEstimateStep[], assumptions: new Set<string>(), other: false, ownAccount: [] as RunEstimate["ownAccount"] };
    // The parameters as the run would get them (defaults filled); what was typed so far when that is not yet a valid start.
    let given = params;
    try { given = wf.resolveParams(doc, params); } catch { /* the start itself refuses it */ }
    collect(doc, given, 1, 0, into);
    const unpricedModels = [...new Set(into.steps.filter((step) => step.unitUsd === null).map((step) => step.model))].sort();
    const itemRates: Record<string, number> = {};
    for (const step of into.steps) if (step.perItem && step.highUsd) itemRates[step.perItem.nodeId] = money6((itemRates[step.perItem.nodeId] ?? 0) + step.highUsd);
    return {
      canSpend: into.steps.length > 0, steps: into.steps, highUsd: money6(into.steps.reduce((sum, step) => sum + (step.perItem ? 0 : step.highUsd ?? 0), 0)),
      perItemUsd: money6(Object.values(itemRates).reduce((sum, usd) => sum + usd, 0)), itemRates, unpricedModels, assumptions: [...into.assumptions], ownAccount: into.ownAccount,
    };
  }

  /** Whether a person is asked before the run starts: never for a run that cannot spend; else by the host's "Ask before spending more than", and always for a model whose price is not known. */
  function confirmation(made: RunEstimate): RunConfirmation {
    const gate = deps.port().gate?.();
    // A list of unknown length has no total to hold against "Ask before spending more than": its per-item amount is always asked.
    const needed = made.canSpend && (made.unpricedModels.length > 0 || made.perItemUsd > 0 || (gate ? gate.needsAsking(gate.quote({ amountUsd: made.highUsd, models: [], plan: "workflow.run" })) : made.highUsd > 0));
    return { needed, amountUsd: made.highUsd, stopsAtUsd: money6(made.highUsd * CONFIRMED_SHARE), perItemUsd: made.perItemUsd, unpricedModels: made.unpricedModels };
  }

  /** Puts what the run is held to on record where every paid request is checked: the amount, and the models of unknown price the person allowed by name. */
  function cover(runId: string, owner: string, amountUsd: number, unpriced: readonly string[]): boolean {
    const gate = deps.port().gate?.();
    if (!gate) return false;
    gate.cover({ fixedId: `run:${runId}`, kind: "workflow.run", owner, amountUsd, share: CONFIRMED_SHARE, unpriced });
    return true;
  }
  /** What a run was confirmed for, and what it has spent of it; undefined: nothing is on record for it. */
  const coverage = (runId: string): { confirmedUsd: number; spentUsd: number; unpriced: string[] } | undefined => {
    const gate = deps.port().gate?.(), id = gate?.covered(`run:${runId}`), view = id ? gate!.action(id) : undefined;
    return view?.approved ? { confirmedUsd: view.approved.amountUsd, spentUsd: view.spentUsd ?? 0, unpriced: view.approved.unpriced ?? [] } : undefined;
  };
  /** Keeps, with a started run, what its person confirmed for each item of its lists of unknown length. */
  function keepItemRates(runId: string, owner: string, fixedUsd: number, rates: Record<string, number>): void {
    if (Object.keys(rates).length) deps.db?.prepare("INSERT OR REPLACE INTO workflow_run_item_rates (run_id, record) VALUES (?, ?)").run(runId, JSON.stringify({ owner, fixedUsd, rates }));
  }
  /**
   * The guard per item: a fan-out of the run now has its list (`counts`: items by fan-out step, of every list started
   * so far). What the run is held to grows to the confirmed amount plus the confirmed per-item amount of each of those
   * items — exactly what its person agreed to, so a long list does not ask again and no number was invented for it.
   * An item that would cost more than its confirmed amount still stops the run (the 120 % rule of the whole).
   */
  function fanned(runId: string, counts: Record<string, number>): void {
    const row = deps.db?.prepare("SELECT record FROM workflow_run_item_rates WHERE run_id = ?").get(runId) as { record: string } | undefined;
    if (!row) return;
    const kept = JSON.parse(row.record) as { owner: string; fixedUsd: number; rates: Record<string, number> }, now = coverage(runId);
    if (!now) return;
    const allowed = money6(kept.fixedUsd + Object.entries(kept.rates).reduce((sum, [nodeId, usd]) => sum + usd * (counts[nodeId] ?? 0), 0));
    if (allowed > now.confirmedUsd + 1e-9) cover(runId, kept.owner, allowed, now.unpriced);
  }
  return { estimate, confirmation, cover, coverage, keepItemRates, fanned };
}
export type RunMoney = ReturnType<typeof createRunMoney>;
