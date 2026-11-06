import { film as fm } from "@jagentchill/editor-core";
import type { WorkflowExecution, WorkflowNodeStatus, WorkflowRunRecord } from "@jagentchill/protocol";
import { confirmWithOf } from "../generation/cost.ts";

/**
 * What the film screens show of the run that makes a film, from the run's record and its top-level steps. Pure (no
 * React), so the "needs you" banner's words can be checked without a browser: `waiting` is exactly what `Progress.tsx`
 * prints — the text the RUN resolved for its checkpoint (it names the frames that could not be had), and the static
 * words of the checkpoint only when the run gave none. The one money question of a run (`confirm_cost`) carries its
 * estimate in `subject`.
 */
const ACTIVE = new Set(["queued", "running", "paused", "waiting_approval"]);
/** The step a node of the run belongs to (the storyboard has one node per round). */
export const stepOf = (nodeId: string): string => (nodeId.startsWith("panel_redraw") ? "panel_images" : nodeId);
export type PipelineStage = { id: fm.PipelineStageId; status: WorkflowNodeStatus; exec?: WorkflowExecution; check?: WorkflowExecution; /** The checkpoint of this step a person answered "no" to (or that failed): the step did not get past it. */ stopped?: WorkflowExecution; costUsd: number; studio: fm.StageId };
/** The checkpoint a run waits at (or stopped at). `subject` is what the run gave it: for `confirm_cost`, the estimate to confirm. */
export type Asked = { nodeId: string; title: string; instructions: string; studio: fm.StageId; stage: fm.PipelineStageId; subject: Record<string, unknown> };
/** The checkpoint that asks the run's one money question: it is answered in the cost dialog, not approved like a check. */
export const COST_CHECKPOINT = "confirm_cost";
/** A run that stopped because it was about to cost more than the person confirmed: what it spent, what was confirmed, the new total to confirm, and the step to run again. */
export type OverEstimate = {
  spentUsd: number; confirmedUsd: number; nextUsd: number; nodeId: string;
  /** What the host named to be sent back with the answer to THIS question (`details.confirmWith`): without it the host does not take the answer, and asks again. */
  confirmWith?: Record<string, unknown>;
  /** The question is not about an amount: the next step is done by these models, whose price the host does not know (no amount answers that). */
  unpriced: string[];
  /** Nothing was confirmed for this run yet (it was started without its question being answered). */
  first: boolean;
  /** How the run goes on once the new amount is confirmed: a run a person follows is PAUSED with its step held (resume); another one failed at the step (run it again). */
  how: "resume" | "rerun";
};
/**
 * A run held by a spending limit of the host (a budget with a hard stop: everything, one provider, a project, a session):
 * nothing more is paid until the limit is raised. Not the person's own confirmed amount — that is `OverEstimate`.
 */
export type SpendingStop = {
  nodeId: string; /** Which budget: "global", "provider", "project", "session". */ scope: string; /** What that budget still leaves; null when the host did not say. */ remainingUsd: number | null;
  /** The budget refuses work without a known price, and the next step has none. */ unpriced: boolean;
  /** A run a person follows is PAUSED with its step held (resume the run); another one failed at the step (try the step again). */ how: "resume" | "retry";
};
export type PipelineState = { record: WorkflowRunRecord | null; active: boolean; stages: PipelineStage[]; waiting: Asked | null; /** The checkpoint a person said "no" to, which is why the run stopped. */ rejected: Asked | null; /** The run stopped for money (see `OverEstimate`). */ over: OverEstimate | null; /** The run is held by a spending limit of the host (see `SpendingStop`). */ limit: SpendingStop | null; costUsd: number };
/** Reads the engine's stop at a hard-stop budget (`BUDGET_EXCEEDED` with the budget's scope); null for every other state of a run. */
export function spendingStop(record: WorkflowRunRecord | null, byNode: Record<string, WorkflowExecution> = {}): SpendingStop | null {
  const mine = (entry: WorkflowExecution["error"]): boolean => entry?.code === "BUDGET_EXCEEDED" && (entry.details as Record<string, unknown> | undefined)?.scope !== "confirmed_estimate";
  const held = record?.status === "paused" && record.pauseReason === "budget_exceeded" ? Object.values(byNode).find((entry) => entry.blockedBy === "budget_exceeded" && mine(entry.error)) : undefined;
  const failed = record?.status === "failed" && record.failedNodeId ? [byNode[record.failedNodeId]?.error, record.error].find(mine) : undefined;
  const error = held?.error ?? failed, nodeId = held?.nodeId ?? record?.failedNodeId;
  if (!record || !error || !nodeId) return null;
  const details = (error.details ?? {}) as Record<string, unknown>;
  return { nodeId, scope: typeof details.scope === "string" ? details.scope : "", remainingUsd: typeof details.remainingUsd === "number" ? details.remainingUsd : null, unpriced: details.reason === "unpriced_model", how: held ? "resume" : "retry" };
}
/** Reads the engine's budget stop of a run (`BUDGET_EXCEEDED`, scope `confirmed_estimate`); null for every other end of a run. */
export function overEstimate(record: WorkflowRunRecord | null, byNode: Record<string, WorkflowExecution> = {}): OverEstimate | null {
  // The run carries the error of the step that stopped it; the step itself is read when the run does not.
  const mine = (entry: WorkflowExecution["error"]): boolean => entry?.code === "BUDGET_EXCEEDED" && (entry.details as Record<string, unknown> | undefined)?.scope === "confirmed_estimate";
  // A run a person follows is paused, its step held (`blockedBy "budget_exceeded"`) with the refusal and the new figure.
  const held = record?.status === "paused" && record.pauseReason === "budget_exceeded" ? Object.values(byNode).find((entry) => entry.blockedBy === "budget_exceeded" && mine(entry.error)) : undefined;
  const stopped = record?.status === "failed" ? [record.error, record.failedNodeId ? byNode[record.failedNodeId]?.error : undefined] : [];
  const error = held?.error ?? stopped.find(mine), details = error?.details as Record<string, unknown> | undefined, nodeId = held?.nodeId ?? record?.failedNodeId;
  if (!record || !error || !details || !nodeId) return null;
  return overOf(details, nodeId, held ? "resume" : "rerun");
}
/** The over-estimate question from the details the host sends with it (the stop of a run, or what `…film.pipeline.confirm` says still stands). */
export function overOf(details: Record<string, unknown>, nodeId: string, how: OverEstimate["how"]): OverEstimate {
  const estimate = (details.estimate ?? {}) as { amountUsd?: unknown; unpricedModels?: unknown };
  const spentUsd = Number(details.spentUsd) || 0, confirmedUsd = Number(details.confirmedUsd) || 0, total = Number(estimate.amountUsd) || 0, confirmWith = confirmWithOf(details);
  const unpriced = Array.isArray(estimate.unpricedModels) ? estimate.unpricedModels.filter((entry): entry is string => typeof entry === "string") : [];
  // The new amount is never under what was confirmed before (the host refuses a lower one).
  return { spentUsd, confirmedUsd, nextUsd: Math.max(total, confirmedUsd, spentUsd), nodeId, how, unpriced, first: typeof details.confirmedUsd !== "number", ...(confirmWith ? { confirmWith } : {}) };
}
/**
 * What "Confirm and continue" sends to `…film.pipeline.confirm`: the question's own ids as they came, with the new
 * amount — or, when the question is about a model whose price is not known, `confirmed: true` (no amount answers it).
 */
export const overAnswer = (over: OverEstimate): Record<string, unknown> => ({ ...(over.unpriced.length ? { confirmed: true } : { confirmedUsd: over.nextUsd }), ...(over.confirmWith ?? {}) });
/** The step a checkpoint belongs to: the one it follows (`fix_storyboard*` asks in the middle of the storyboard). */
const ownerOf = (nodeId: string): fm.PipelineStageId => (nodeId.startsWith("fix_storyboard") ? "panel_images" : nodeId === COST_CHECKPOINT ? "asset_images" : fm.PIPELINE_STAGES.find((stage) => stage.check === nodeId)?.id ?? "breakdown");

export function pipelineState(record: WorkflowRunRecord | null, byNode: Record<string, WorkflowExecution>): PipelineState {
  const stages = fm.PIPELINE_STAGES.map((stage): PipelineStage => {
    const first = byNode[stage.id], check = stage.check ? byNode[stage.check] : undefined;
    // The storyboard is drawn in rounds: the stage, then — after each time it had to ask a person (`fix_storyboard*`) —
    // the stage again (`panel_redraw*`). To a person that is ONE step: it is working while any round works, it needs
    // them while any round asks, and it cost what all the rounds cost.
    const rounds = stage.id === "panel_images" ? Object.values(byNode).filter((entry) => entry.nodeId.startsWith("panel_redraw")).sort((a, b) => a.nodeId.localeCompare(b.nodeId)) : [];
    // The money question is asked before the first paid step: that step is the one that "needs you" meanwhile.
    const asked = (stage.id === "panel_images" && Object.values(byNode).some((entry) => entry.nodeId.startsWith("fix_storyboard") && entry.status === "waiting_approval")) || (stage.id === "asset_images" && byNode[COST_CHECKPOINT]?.status === "waiting_approval");
    const all = [...(first ? [first] : []), ...rounds], live = all.filter((entry) => entry.status !== "skipped" && entry.status !== "pending");
    const exec = all.find((entry) => entry.status === "running") ?? all.find((entry) => entry.status === "failed") ?? live[live.length - 1] ?? first;
    const waits = asked || (check?.status === "waiting_approval" && exec?.status === "succeeded");
    // A checkpoint answered "no" (or failed) stops the step it belongs to: the work may be made, but the step is not done.
    const stopped = Object.values(byNode).find((entry) => entry.status === "failed" && fm.CHECKPOINTS.some((point) => point.id === entry.nodeId) && ownerOf(entry.nodeId) === stage.id);
    return { id: stage.id, studio: stage.studio, exec, ...(check ? { check } : {}), ...(stopped && !waits ? { stopped } : {}), costUsd: all.reduce((sum, entry) => sum + Number(entry.outputs?.costUsd ?? 0), 0), status: record ? (waits ? "waiting_approval" : stopped && exec?.status !== "running" ? "failed" : exec?.status ?? "pending") : "pending" };
  });
  const asked = (point: (typeof fm.CHECKPOINTS)[number]): Asked => {
    const request = byNode[point.id]?.request, subject = (request?.subject ?? byNode[point.id]?.inputs?.subject) as Record<string, unknown> | undefined;
    return { nodeId: point.id, title: String(request?.title || point.title), instructions: String(request?.instructions || point.instructions), studio: point.studio, stage: ownerOf(point.id), subject: subject && typeof subject === "object" ? subject : {} };
  };
  const no = fm.CHECKPOINTS.find((entry) => byNode[entry.id]?.status === "failed");
  // What the checkpoint asks is in the run (`request`: the stage names the frames or the provider there); the static words are the fallback.
  const at = fm.CHECKPOINTS.find((entry) => byNode[entry.id]?.status === "waiting_approval");
  const over = overEstimate(record, byNode), limit = over ? null : spendingStop(record, byNode);
  return { record, active: !!record && ACTIVE.has(record.status), stages, waiting: record && at ? asked(at) : null, rejected: record && !at && no && record.status === "failed" ? asked(no) : null, over, limit, costUsd: stages.reduce((sum, stage) => sum + stage.costUsd, 0) };
}
