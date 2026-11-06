// The "needs you" banner of the film screens, without a browser: `pipelineState` is the pure function `Pipeline.tsx`
// calls, and `waiting.title` / `waiting.instructions` are what `Progress.tsx` prints. The executions below have the
// shape `jagentchill.workflow.run.executions` returns (the server test "The storyboard checkpoint's request is the
// RESOLVED text…" asserts the same request text on the real engine). Run with `node --test apps/app/src/film/pipelineState.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm } from "@jagentchill/editor-core";
import type { WorkflowExecution, WorkflowRunRecord } from "@jagentchill/protocol";
import { overAnswer, overOf, pipelineState } from "./pipelineState.ts";

const record = { id: "run_1", status: "waiting_approval" } as unknown as WorkflowRunRecord;
const exec = (nodeId: string, status: string, extra: Record<string, unknown> = {}) => ({ nodeId, path: "", status, attempt: 1, attempts: [], ...extra }) as unknown as WorkflowExecution;
const byNode = (...list: WorkflowExecution[]) => Object.fromEntries(list.map((entry) => [entry.nodeId, entry]));
const RESOLVED = "The image provider refused to draw these frames under its content policy, also when asked in plainer words: Panel 2, Panel 3. Change the words of a frame on the storyboard to have it drawn again, or choose one of its drawings yourself. Then approve: the frames you changed are drawn, and the ones you left as they are stay out of the film.";

test("The needs-you banner shows the text the run resolved for its checkpoint — it names the refused panels — and not the static words of the checkpoint", () => {
  const state = pipelineState(record, byNode(
    exec("breakdown", "succeeded"), exec("asset_images", "succeeded"), exec("panel_images", "succeeded", { outputs: { costUsd: 0.02 } }),
    exec("fix_storyboard", "waiting_approval", { request: { kind: "approval", title: "Some frames could not be had", instructions: RESOLVED, subject: { refusedNames: "Panel 2, Panel 3" } } }),
  ));
  assert.deepEqual([state.waiting?.nodeId, state.waiting?.title, state.waiting?.studio], ["fix_storyboard", "Some frames could not be had", "storyboard"]);
  assert.equal(state.waiting?.instructions, RESOLVED);
  assert.match(state.waiting!.instructions, /Panel 2, Panel 3\./);
  const fixed = fm.CHECKPOINTS.find((entry) => entry.id === "fix_storyboard")!;
  assert.notEqual(state.waiting!.instructions, fixed.instructions);
  assert.ok(!/\{\{/.test(state.waiting!.title + state.waiting!.instructions), "no template marks reach the screen");
  // The storyboard step is the one that needs the person.
  assert.equal(state.stages.find((stage) => stage.id === "panel_images")!.status, "waiting_approval");
});

test("The banner follows the round that asks: the second asking shows ITS text; with no request text the static words stand in", () => {
  const second = pipelineState(record, byNode(
    exec("panel_images", "succeeded"), exec("fix_storyboard", "succeeded", { request: { title: "Some frames could not be had", instructions: RESOLVED } }), exec("panel_redraw", "succeeded"),
    exec("fix_storyboard_2", "waiting_approval", { request: { title: "A frame could not be had", instructions: "The image provider refused to draw this frame under its content policy, also when asked in plainer words: Panel 3." } }),
  ));
  assert.deepEqual([second.waiting?.nodeId, second.waiting?.title], ["fix_storyboard_2", "A frame could not be had"]);
  assert.match(second.waiting!.instructions, /Panel 3\.$/);
  const bare = pipelineState(record, byNode(exec("panel_images", "succeeded"), exec("fix_storyboard", "waiting_approval")));
  const fixed = fm.CHECKPOINTS.find((entry) => entry.id === "fix_storyboard")!;
  assert.deepEqual([bare.waiting?.title, bare.waiting?.instructions], [fixed.title, fixed.instructions]);
  assert.equal(pipelineState(null, {}).waiting, null);
});

test("A checkpoint answered “no” stops the step that owns it: the Script step is failed, not done, and the state names the rejected checkpoint", () => {
  const failed = { id: "run_1", status: "failed", failedNodeId: "check_breakdown" } as unknown as WorkflowRunRecord;
  const state = pipelineState(failed, byNode(exec("breakdown", "succeeded"), exec("check_breakdown", "failed", { error: { code: "WORKFLOW_REJECTED", message: "Check the cast and the script was rejected." } })));
  const script = state.stages.find((stage) => stage.id === "breakdown")!;
  assert.equal(script.status, "failed");
  assert.equal(script.stopped?.nodeId, "check_breakdown");
  assert.deepEqual([state.rejected?.nodeId, state.rejected?.stage, Object.keys(state.rejected?.subject ?? { x: 1 }).length], ["check_breakdown", "breakdown", 0]);
  assert.equal(state.waiting, null);
  // Asked again, the same checkpoint waits: the step needs the person and nothing is "rejected" any more.
  const again = pipelineState(record, byNode(exec("breakdown", "succeeded"), exec("check_breakdown", "waiting_approval")));
  assert.deepEqual([again.stages[0].status, again.stages[0].stopped, again.rejected], ["waiting_approval", undefined, null]);
});

test("The one money question of a run: the checkpoint confirm_cost waits with its estimate, and the first paid step is the one that needs the person", () => {
  const subject = { needs: 1, estimate: { amountUsd: 0.12, breakdown: [{ id: "pictures", label: "Pictures", count: 6, usd: 0.1, model: "Painter" }, { id: "voice", label: "Voice", count: 4, usd: 0.02, model: "Speaker" }], models: ["Painter", "Speaker"] }, confirmAboveUsd: 0, remainingUsd: null, stopsAtUsd: 0.144 };
  const state = pipelineState(record, byNode(exec("breakdown", "succeeded"), exec("cost", "succeeded"), exec("confirm_cost", "waiting_approval", { inputs: { subject }, request: { title: "Confirm the cost of this film: about $0.12", instructions: "…" } })));
  assert.deepEqual([state.waiting?.nodeId, state.waiting?.stage], ["confirm_cost", "asset_images"]);
  assert.deepEqual(state.waiting?.subject, subject);
  assert.deepEqual(state.stages.map((stage) => stage.status).slice(0, 3), ["succeeded", "waiting_approval", "pending"]);
});

test("A run that is about to cost more than was confirmed: paused with its step held (resume), or failed at the step (run it again) — both give the figures of the question", () => {
  const error = { code: "BUDGET_EXCEEDED", message: "…", details: { reason: "confirmation_required", scope: "confirmed_estimate", confirmedUsd: 0.096, limitUsd: 0.1152, spentUsd: 0.077, estimate: { amountUsd: 0.117 } } };
  const paused = pipelineState({ id: "run_1", status: "paused", pauseReason: "budget_exceeded" } as unknown as WorkflowRunRecord, byNode(exec("panel_images", "succeeded"), exec("music", "ready", { blockedBy: "budget_exceeded", error })));
  assert.deepEqual(paused.over, { spentUsd: 0.077, confirmedUsd: 0.096, nextUsd: 0.117, nodeId: "music", how: "resume", unpriced: [], first: false });
  const failed = pipelineState({ id: "run_1", status: "failed", failedNodeId: "panel_redraw", error } as unknown as WorkflowRunRecord, byNode(exec("panel_redraw", "failed", { error })));
  assert.deepEqual([failed.over?.how, failed.over?.nodeId, failed.over?.nextUsd], ["rerun", "panel_redraw", 0.117]);
  assert.equal(pipelineState({ id: "run_1", status: "paused", pauseReason: "user" } as unknown as WorkflowRunRecord, byNode(exec("music", "ready"))).over, null);
});

test("A run held by a spending limit of the host: paused with its step held — the budget's scope and what it leaves, to be resumed; a confirmed-estimate stop is not one", () => {
  const error = { code: "BUDGET_EXCEEDED", message: "Budget reached — global", details: { scope: "global", scopeId: null, remainingUsd: 0.002, class: "budget_exceeded" } };
  const paused = pipelineState({ id: "run_1", status: "paused", pauseReason: "budget_exceeded" } as unknown as WorkflowRunRecord, byNode(exec("breakdown", "succeeded"), exec("asset_images", "ready", { blockedBy: "budget_exceeded", error })));
  assert.deepEqual(paused.limit, { nodeId: "asset_images", scope: "global", remainingUsd: 0.002, unpriced: false, how: "resume" });
  assert.equal(paused.over, null);
  const failed = pipelineState({ id: "run_1", status: "failed", failedNodeId: "voice", error } as unknown as WorkflowRunRecord, byNode(exec("voice", "failed", { error })));
  assert.deepEqual([failed.limit?.how, failed.limit?.nodeId], ["retry", "voice"]);
  const guard = { code: "BUDGET_EXCEEDED", message: "…", details: { reason: "confirmation_required", scope: "confirmed_estimate", confirmedUsd: 0.1, spentUsd: 0.05, estimate: { amountUsd: 0.2 } } };
  const over = pipelineState({ id: "run_1", status: "paused", pauseReason: "budget_exceeded" } as unknown as WorkflowRunRecord, byNode(exec("music", "ready", { blockedBy: "budget_exceeded", error: guard })));
  assert.deepEqual([over.limit, over.over?.how], [null, "resume"]);
});


test("Confirming a higher amount answers the question the run stopped with: its ids go back unchanged with the amount", () => {
  const stop = { code: "BUDGET_EXCEEDED", message: "over", details: { reason: "confirmation_required", scope: "confirmed_estimate", spentUsd: 0.044, confirmedUsd: 0.099, estimate: { amountUsd: 0.89, spentUsd: 0.044, remainsUsd: 0.846 }, confirmWith: { actionId: "film.run:run_1", quoteId: "q-over-1" } } };
  const paused = { id: "run_1", status: "paused", pauseReason: "budget_exceeded" } as unknown as WorkflowRunRecord;
  const state = pipelineState(paused, byNode(exec("breakdown", "succeeded"), exec("music", "ready", { blockedBy: "budget_exceeded", error: stop })));
  assert.deepEqual(state.over?.confirmWith, { actionId: "film.run:run_1", quoteId: "q-over-1" });
  assert.deepEqual(overAnswer(state.over!), { confirmedUsd: 0.89, actionId: "film.run:run_1", quoteId: "q-over-1" });
  assert.deepEqual([state.over!.unpriced, state.over!.first, state.over!.how], [[], false, "resume"]);
});

test("A stop for a model whose price is not known is answered by confirming the question, not by an amount", () => {
  const over = overOf({ reason: "confirmation_required", scope: "confirmed_estimate", spentUsd: 0.05, confirmedUsd: 0.12, estimate: { amountUsd: null, unpriced: true, unpricedModels: ["runtime:stub/stub-vision"] }, confirmWith: { actionId: "film.run:run_1", quoteId: "q-over-2" } }, "panel_images", "resume");
  assert.deepEqual(over.unpriced, ["runtime:stub/stub-vision"]);
  assert.deepEqual(overAnswer(over), { confirmed: true, actionId: "film.run:run_1", quoteId: "q-over-2" });
});
