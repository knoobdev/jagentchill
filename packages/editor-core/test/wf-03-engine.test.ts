// The executors of agent, sub-workflow and notify steps are the test's own: the real ones call the host's agent engine. The run engine is the real one.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowCondition } from "@jagentchill/protocol";
import { workflow as wf } from "../src/index.ts";
import { Draft, codeOf, errorOf, harness, settle } from "./support/workflows.ts";

type Call = { nodeId: string; path: string; attempt: number; inputs: Record<string, unknown>; signal: AbortSignal; resolve(result?: wf.ExecutorResult): void; reject(error: unknown): void };
/** An agent executor the test finishes by hand. */
function manual() {
  const calls: Call[] = [];
  const executor: wf.NodeExecutor = (context) => new Promise((resolve, reject) => calls.push({ nodeId: context.node.id, path: context.path, attempt: context.attempt, inputs: context.inputs, signal: context.signal, resolve: (result = { outputs: { text: `${context.node.id}:${context.path}` } }) => resolve(result), reject }));
  return { calls, executor, open: () => calls.filter((call) => !call.signal.aborted) };
}
const echo: wf.NodeExecutor = async (context) => ({ outputs: { text: context.render(String(context.node.config.promptTemplate)) } });
const listInput = (items: unknown[]) => ({ inputs: [{ id: "items", label: "items", type: "list<any>", default: items }] });
const when = (left: string, op: string, right?: unknown): WorkflowCondition => ({ all: [{ left, op, right } as never] });

test("Parameters: Missing required parameter and Enum value outside the list", () => {
  const draft = new Draft();
  draft.apply([{ op: "param.set", parameters: [
    { name: "prompt", label: "Prompt", type: "text", required: true, help: "", secret: false },
    { name: "aspectRatio", label: "Aspect ratio", type: "string", required: false, default: "16:9", enum: ["16:9", "9:16", "1:1"], help: "", secret: false },
    { name: "count", label: "Count", type: "integer", required: false, min: 1, max: 5, help: "", secret: false },
  ] }]);
  const missing = errorOf(() => wf.resolveParams(draft.doc, {}));
  assert.equal(missing.code, "WORKFLOW_INPUT_INVALID");
  assert.equal(missing.details.param, "prompt");
  const outside = errorOf(() => wf.resolveParams(draft.doc, { prompt: "x", aspectRatio: "5:4" }));
  assert.equal(outside.code, "WORKFLOW_INPUT_INVALID");
  assert.deepEqual(outside.details.allowed, ["16:9", "9:16", "1:1"]);
  assert.equal(codeOf(() => wf.resolveParams(draft.doc, { prompt: "x", count: 9 })), "WORKFLOW_INPUT_INVALID");
  assert.deepEqual(wf.resolveParams(draft.doc, { prompt: "x", count: 2 }), { prompt: "x", aspectRatio: "16:9", count: 2 });
});

test("Trigger node: succeeds at once and hands the parameters to the steps; the agent prompt is rendered from its inputs", async () => {
  const draft = new Draft();
  draft.apply([{ op: "param.set", parameters: [{ name: "topic", label: "Topic", type: "text", required: true, help: "", secret: false }] }]);
  const writer = draft.add("agent", "writer", { config: { promptTemplate: "Write about {{inputs.input}} for run {{run.number}} ({{params.topic | upper}})" } });
  draft.link("start.topic", `${writer}.input`);
  draft.apply([{ op: "output.set", outputs: [{ name: "answer", type: "text", from: { node: writer, port: "text" } }] }]);
  const run = harness(draft.doc, { executors: { agent: echo }, params: { topic: "cats" } });
  run.engine.start();
  await settle();
  assert.equal(run.state.status, "succeeded");
  assert.deepEqual(run.state.outputs, { answer: "Write about cats for run 1 (CATS)" });
  assert.equal(run.state.executions[wf.execKey("start", "")].outputs!.topic, "cats");
  // The edge was flowing while the step ran and delivered when it succeeded.
  assert.deepEqual(run.changes.filter((change) => change.kind === "edge.state").map((change) => (change as { state: string }).state), ["flowing", "delivered"]);
});

test("Branch node: First match", async () => {
  const draft = new Draft();
  draft.apply([{ op: "param.set", parameters: [{ name: "duration", label: "Duration", type: "number", required: true, help: "", secret: false }] }]);
  const branch = draft.add("branch", "route", { config: { cases: [{ id: "long", label: "> 60", condition: when("inputs.value", "gt", 60) }, { id: "medium", label: "> 30", condition: when("inputs.value", "gt", 30) }], mode: "first_match" } });
  const long = draft.add("wait", "long", { config: { mode: "duration", seconds: 1 } }), medium = draft.add("wait", "medium"), other = draft.add("wait", "other");
  draft.link("start.duration", `${branch}.value`);
  draft.link(`${branch}.long`, long);
  draft.link(`${branch}.medium`, medium);
  draft.link(`${branch}.else`, other);
  const run = harness(draft.doc, { params: { duration: 90 } });
  run.engine.start();
  assert.deepEqual(run.state.executions[wf.execKey(branch, "")].fired, ["done", "long"]);
  assert.equal(run.statusOf(long), "running");
  assert.equal(run.statusOf(medium), "skipped");
  assert.equal(run.state.executions[wf.execKey(medium, "")].reason, "branch_not_taken");
  assert.equal(run.statusOf(other), "skipped");
  // Every true case fires in all_matches.
  draft.apply([{ op: "node.update", id: branch, patch: { config: { ...draft.node(branch).config, mode: "all_matches" } } }]);
  const all = harness(draft.doc, { params: { duration: 90 } });
  all.engine.start();
  assert.deepEqual(all.state.executions[wf.execKey(branch, "")].fired, ["done", "long", "medium"]);
});

test("Branch node: Else", async () => {
  const draft = new Draft();
  const branch = draft.add("branch", "route", { config: { cases: [{ id: "never", label: "Never", condition: when("inputs.value", "eq", "x") }], mode: "first_match" }, inputs: [{ id: "value", label: "value", type: "any", default: "y" }] });
  const arm = draft.add("wait", "arm"), tail = draft.add("wait", "tail", { config: { mode: "duration", seconds: 1 } });
  draft.link("start", branch);
  draft.link(`${branch}.never`, arm);
  draft.link("start", tail);
  const run = harness(draft.doc);
  run.engine.start();
  assert.deepEqual(run.state.executions[wf.execKey(branch, "")].fired, ["done", "else"]);
  assert.equal(run.statusOf(arm), "skipped");
  assert.equal(run.statusOf(tail), "running");
  run.clock.now += 1000;
  run.engine.tick();
  assert.equal(run.state.status, "succeeded");
});

test("Branch node: Skip stops at a merge — Merge after a branch takes the arm that ran", async () => {
  const draft = new Draft();
  const branch = draft.add("branch", "route", { config: { cases: [{ id: "first", label: "First", condition: when("inputs.value", "eq", 1) }], mode: "first_match" }, inputs: [{ id: "value", label: "value", type: "any", default: 2 }] });
  const a = draft.add("agent", "a", { config: { promptTemplate: "A" } }), b = draft.add("agent", "b", { config: { promptTemplate: "B" } });
  const merge = draft.add("agent", "merge", { config: { promptTemplate: "got {{inputs.input}}" }, inputs: [{ id: "input", label: "input", type: "text", mode: "first" }] });
  draft.link("start", branch);
  draft.link(`${branch}.first`, a);
  draft.link(`${branch}.else`, b);
  draft.link(`${a}.text`, `${merge}.input`);
  draft.link(`${b}.text`, `${merge}.input`);
  const run = harness(draft.doc, { executors: { agent: echo } });
  run.engine.start();
  await settle();
  assert.equal(run.statusOf(a), "skipped");
  assert.equal(run.statusOf(merge), "succeeded");
  assert.equal(run.state.executions[wf.execKey(merge, "")].outputs!.text, "got B");
  assert.equal(run.state.status, "succeeded");
});

function reviseLoop(maxIterations: number) {
  const draft = new Draft();
  const loop = draft.add("loop", "review", { config: { maxIterations, continueWhile: when("next.outcome", "eq", "changes_requested") }, inputs: [{ id: "initial", label: "initial", type: "any", default: "draft 0" }, { id: "next", label: "next", type: "any" }] });
  const revise = draft.add("agent", "revise", { config: { promptTemplate: "{{inputs.input}}+{{loop.iteration}}" } });
  const approve = draft.add("approval", "approve"), spent = draft.add("notify", "spent");
  draft.link("start", loop);
  draft.link(`${loop}.body`, `${revise}.input`);
  draft.link(`${revise}.text`, `${approve}.subject`);
  draft.apply([{ op: "edge.add", edge: { id: "back", kind: "loop_back", from: { node: approve, port: "decision" }, to: { node: loop, port: "next" } } }]);
  // The loop feeds back the decision; `changes_requested` keeps the review going.
  draft.apply([{ op: "node.update", id: approve, patch: { outputs: [{ id: "subject", label: "subject", type: "any" }, { id: "decision", label: "decision", type: "Decision" }] } }]);
  draft.link(`${loop}.exhausted`, spent);
  assert.deepEqual(wf.validate(draft.doc).errors, []);
  return { doc: draft.doc, loop, revise, approve, spent };
}

test("Loop node: Revise until approved", async () => {
  const { doc, loop, revise, approve, spent } = reviseLoop(5);
  const run = harness(doc, { executors: { agent: echo, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  assert.equal(run.statusOf(approve, "L:review#1"), "waiting_approval");
  assert.equal(run.state.status, "waiting_approval");
  run.engine.resolve(approve, "L:review#1", { outcome: "changes_requested", notes: "Tighter", by: { deviceId: "d1" } });
  await settle();
  // A second iteration with fresh executions; the first one's are kept.
  assert.equal(run.statusOf(revise, "L:review#1"), "succeeded");
  assert.equal(run.statusOf(approve, "L:review#2"), "waiting_approval");
  run.engine.resolve(approve, "L:review#2", { outcome: "approved", by: { deviceId: "d1" } });
  await settle();
  const owner = run.state.executions[wf.execKey(loop, "")];
  assert.equal(owner.status, "succeeded");
  assert.equal(owner.iteration, 2);
  assert.equal((owner.outputs!.result as { decision?: unknown; outcome?: string }).outcome, "approved");
  assert.equal(run.statusOf(spent), "skipped");
  assert.equal(run.state.status, "succeeded");
});

test("Loop node: Bound reached and Iteration history", async () => {
  const { doc, loop, revise, approve, spent } = reviseLoop(3);
  const run = harness(doc, { executors: { agent: echo, notify: async () => ({}) } });
  run.engine.start();
  for (let iteration = 1; iteration <= 3; iteration++) {
    await settle();
    run.engine.resolve(approve, `L:review#${iteration}`, { outcome: "changes_requested", notes: "Again", by: { deviceId: "d1" } });
  }
  await settle();
  const owner = run.state.executions[wf.execKey(loop, "")];
  assert.deepEqual(owner.fired, ["done", "exhausted"]);
  assert.equal(run.statusOf(revise, "L:review#4"), undefined);
  assert.equal(run.statusOf(spent), "succeeded");
  assert.ok(run.logs.some((entry) => entry.nodeId === loop && /Stopped after 3 iterations/.test(entry.message)));
  // One execution per iteration, each with its own inputs and outputs.
  assert.equal(run.state.executions[wf.execKey(revise, "L:review#1")].outputs!.text, "draft 0+1");
  assert.match(String(run.state.executions[wf.execKey(revise, "L:review#3")].outputs!.text), /changes_requested.*\+3$/);
  assert.equal(Object.keys(run.state.executions).filter((key) => key.startsWith("revise@")).length, 3);
});

function fanOut(items: unknown[], config: Record<string, unknown> = {}, bodyPatch: Record<string, unknown> = {}) {
  const draft = new Draft();
  draft.apply([{ op: "var.set", variables: [{ name: "warnings", type: "list<any>", mode: "append" }] }]);
  const fan = draft.add("parallel", "fan", { config, ...listInput(items) });
  const body = draft.add("agent", "body", { config: { promptTemplate: "{{item}}@{{index}}" }, assign: [{ var: "warnings", from: "text" }], ...bodyPatch }), join = draft.add("join", "join"), after = draft.add("notify", "after");
  draft.link("start", fan);
  draft.link(`${fan}.item`, `${body}.input`);
  draft.link(`${body}.text`, `${join}.result`);
  draft.link(`${join}.results`, `${after}.value`);
  assert.deepEqual(wf.validate(draft.doc).errors, []);
  return { doc: draft.doc, fan, body, join, after };
}

test("Parallel and join nodes: Concurrency limit, and results in item order whatever the completion order (Stable ordering)", async () => {
  const { doc, fan, body, join } = fanOut(Array.from({ length: 12 }, (_, index) => `shot${index}`), { concurrency: 4 });
  const agent = manual();
  const run = harness({ ...doc, settings: { ...doc.settings, maxParallel: 16 } }, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  let finished = 0;
  while (finished < 12) {
    const open = agent.calls.slice(finished);
    assert.ok(open.length >= 1 && open.length <= 4, `${open.length} running`);
    assert.ok(Object.values(run.state.executions).filter((exec) => exec.nodeId === body && exec.status === "running").length <= 4);
    // The newest one finishes first.
    const call = open.at(-1)!;
    agent.calls.splice(agent.calls.indexOf(call), 1);
    agent.calls.splice(finished, 0, call);
    call.resolve({ outputs: { text: `out:${call.path}` } });
    finished += 1;
    await settle(3);
  }
  await settle();
  const results = run.state.executions[wf.execKey(join, "")].outputs!.results as string[];
  assert.deepEqual(results, Array.from({ length: 12 }, (_, index) => `out:P:fan#${index}`));
  assert.deepEqual(run.state.executions[wf.execKey(fan, "")].counts, { total: 12, succeeded: 12, failed: 0, running: 0, waiting: 0 });
  assert.equal(run.state.status, "succeeded");
  // Append variable inside a parallel body: one entry per item.
  assert.equal((run.state.vars.warnings as unknown[]).length, 12);
});

test("Parallel and join nodes: Partial failure with continue", async () => {
  const { doc, join } = fanOut(Array.from({ length: 12 }, (_, index) => index), { failurePolicy: "continue", concurrency: 16 });
  const failing: wf.NodeExecutor = async (context) => { if (context.scope.index === 3 || context.scope.index === 7) throw Object.assign(new Error("no"), { code: "INVALID_PARAMS" }); return { outputs: { text: `ok${context.scope.index}` } }; };
  const run = harness({ ...doc, settings: { ...doc.settings, maxParallel: 16 } }, { executors: { agent: failing, notify: async () => ({}) } });
  run.engine.start();
  await settle(12);
  const out = run.state.executions[wf.execKey(join, "")].outputs as { results: unknown[]; errors: Array<{ index: number; code: string }>; succeededCount: number; failedCount: number };
  assert.equal(out.succeededCount, 10);
  assert.equal(out.failedCount, 2);
  assert.equal(out.results[3], null);
  assert.equal(out.results[7], null);
  assert.equal(out.results[4], "ok4");
  assert.deepEqual(out.errors.map((entry) => [entry.index, entry.code]), [[3, "INVALID_PARAMS"], [7, "INVALID_PARAMS"]]);
  assert.equal(run.state.status, "succeeded");
});

test("Parallel and join nodes: Ratio not met", async () => {
  const { doc, join } = fanOut(Array.from({ length: 12 }, (_, index) => index), { failurePolicy: { minSuccessRatio: 0.9 }, concurrency: 16 });
  const failing: wf.NodeExecutor = async (context) => { if ((context.scope.index as number) < 3) throw Object.assign(new Error("no"), { code: "INVALID_PARAMS" }); return { outputs: { text: "ok" } }; };
  const run = harness({ ...doc, settings: { ...doc.settings, maxParallel: 16 } }, { executors: { agent: failing, notify: async () => ({}) } });
  run.engine.start();
  await settle(12);
  const exec = run.state.executions[wf.execKey(join, "")];
  assert.equal(exec.status, "failed");
  assert.equal(exec.error!.code, "WORKFLOW_FANOUT_FAILED");
  assert.deepEqual(exec.error!.details, { succeeded: 9, total: 12, required: 0.9 });
  assert.equal(run.state.status, "failed");
  assert.equal(run.state.failedNodeId, join);
});

test("Parallel and join nodes: fail_fast cancels the items that are running and the ones not started", async () => {
  const { doc, body, join } = fanOut([0, 1, 2, 3, 4, 5], { concurrency: 2 });
  const agent = manual();
  const run = harness(doc, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  assert.equal(agent.calls.length, 2);
  agent.calls[0].reject(Object.assign(new Error("bad"), { code: "INVALID_PARAMS" }));
  await settle();
  assert.equal(run.statusOf(body, "P:fan#1"), "cancelled");
  assert.ok(agent.calls[1].signal.aborted);
  assert.equal(run.statusOf(body, "P:fan#2"), undefined);
  assert.equal(run.state.executions[wf.execKey(join, "")].error!.code, "WORKFLOW_FANOUT_FAILED");
});

test("Parallel and join nodes: Empty list", async () => {
  const { doc, fan, body, join, after } = fanOut([]);
  const run = harness(doc, { executors: { agent: echo, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  assert.equal(run.state.executions[wf.execKey(fan, "")].reason, "empty_list");
  assert.equal(Object.keys(run.state.executions).some((key) => key.startsWith(`${body}@`)), false);
  assert.deepEqual(run.state.executions[wf.execKey(join, "")].outputs!.results, []);
  assert.equal(run.statusOf(after), "succeeded");
  assert.equal(run.state.status, "succeeded");
});

test("Size limits: Fan-out larger than the limit", async () => {
  const { doc, fan, body } = fanOut(Array.from({ length: 1001 }, (_, index) => index), { maxItems: 1000 });
  const run = harness(doc, { executors: { agent: echo } });
  run.engine.start();
  const exec = run.state.executions[wf.execKey(fan, "")];
  assert.equal(exec.error!.code, "WORKFLOW_LIMIT_EXCEEDED");
  assert.equal(exec.error!.details!.limit, "fanoutItems");
  assert.equal(Object.keys(run.state.executions).some((key) => key.startsWith(`${body}@`)), false);
  const capped = harness(fanOut([1, 2, 3], { maxItems: 2 }).doc, { executors: { agent: echo } });
  capped.engine.start();
  assert.equal(capped.state.executions[wf.execKey("fan", "")].error!.details!.limit, "maxItems");
});

test("Node state machine: Nested address", async () => {
  const draft = new Draft();
  const loop = draft.add("loop", "review", { config: { maxIterations: 2, continueWhile: when("loop.iteration", "lt", 2) }, inputs: [{ id: "initial", label: "initial", type: "any", default: [10, 20] }, { id: "next", label: "next", type: "any" }] });
  const fan = draft.add("parallel", "repair_items", { inputs: [{ id: "items", label: "items", type: "list<any>", required: true }] }), fix = draft.add("agent", "fix", { config: { promptTemplate: "{{path}}" } }), join = draft.add("join", "join");
  draft.link("start", loop);
  draft.link(`${loop}.body`, `${fan}.items`);
  draft.link(`${fan}.item`, `${fix}.input`);
  draft.link(`${fix}.text`, `${join}.result`);
  draft.apply([{ op: "edge.add", edge: { id: "back", kind: "loop_back", from: { node: join, port: "results" }, to: { node: loop, port: "next" } } }]);
  assert.deepEqual(wf.validate(draft.doc).errors, []);
  const run = harness(draft.doc, { executors: { agent: echo } });
  run.engine.start();
  await settle(12);
  assert.equal(run.state.status, "succeeded");
  const keys = Object.keys(run.state.executions).filter((key) => key.startsWith("fix@")).sort();
  assert.deepEqual(keys, ["fix@L:review#1/P:repair_items#0", "fix@L:review#1/P:repair_items#1", "fix@L:review#2/P:repair_items#0", "fix@L:review#2/P:repair_items#1"]);
  assert.equal(run.state.executions["fix@L:review#2/P:repair_items#1"].outputs!.text, "L:review#2/P:repair_items#1");
  assert.deepEqual(wf.parsePath("L:review#2/P:repair_items#5"), [{ loop: "review", iteration: 2 }, { parallel: "repair_items", item: 5 }]);
  assert.equal(wf.pathText(wf.parsePath("L:review#2/P:repair_items#5")), "L:review#2/P:repair_items#5");
});

test("Typed edges: Error edge taken — Handled failure ends the run succeeded", async () => {
  const draft = new Draft();
  const music = draft.add("agent", "music", { onError: "route" }), library = draft.add("notify", "library"), mix = draft.add("agent", "mix");
  draft.link("start", music);
  draft.link(`${music}.error`, library);
  draft.link(`${music}.text`, `${mix}.input`);
  const run = harness(draft.doc, { executors: { agent: async () => { throw Object.assign(new Error("provider said no"), { code: "PROVIDER_ERROR" }); }, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  const failed = run.state.executions[wf.execKey(music, "")];
  assert.equal(failed.status, "failed");
  assert.equal(failed.handled, true);
  assert.deepEqual((failed.outputs!.error as { code: string; class: string; nodeId: string; attempt: number }).code, "PROVIDER_ERROR");
  assert.equal(run.statusOf(library), "succeeded");
  assert.equal(run.statusOf(mix), "skipped");
  assert.equal(run.state.status, "succeeded");
});

test("Node timeouts and error routes: Default fail lets running steps finish and starts nothing new", async () => {
  const draft = new Draft();
  const bad = draft.add("agent", "bad"), slow = draft.add("agent", "slow"), next = draft.add("notify", "next");
  draft.link("start", bad);
  draft.link("start", slow);
  draft.link(slow, next);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  agent.calls.find((call) => call.nodeId === bad)!.reject(Object.assign(new Error("broken"), { code: "INVALID_PARAMS" }));
  await settle();
  assert.equal(run.state.status, "running");
  assert.equal(run.statusOf(slow), "running");
  agent.calls.find((call) => call.nodeId === slow)!.resolve();
  await settle();
  assert.equal(run.statusOf(slow), "succeeded");
  assert.notEqual(run.statusOf(next), "succeeded");
  assert.equal(run.state.status, "failed");
  assert.equal(run.state.failedNodeId, bad);
  assert.equal(run.state.error!.code, "INVALID_PARAMS");
});

test("Node state machine: Skip after an error", async () => {
  const draft = new Draft();
  const bad = draft.add("agent", "bad", { onError: "skip" }), dependant = draft.add("agent", "dependant"), other = draft.add("notify", "other");
  draft.link("start", bad);
  draft.link(`${bad}.text`, `${dependant}.input`);
  draft.link("start", other);
  const run = harness(draft.doc, { executors: { agent: async () => { throw Object.assign(new Error("x"), { code: "INVALID_PARAMS" }); }, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  assert.equal(run.statusOf(bad), "skipped");
  assert.equal(run.state.executions[wf.execKey(bad, "")].reason, "error_skipped");
  assert.equal(run.statusOf(dependant), "skipped");
  assert.equal(run.state.status, "succeeded");
});

test("Node timeouts and error routes: Automatic retry is not a failure — Retryable tool error", async () => {
  const draft = new Draft();
  const step = draft.add("agent", "step");
  draft.link("start", step);
  let calls = 0;
  const flaky: wf.NodeExecutor = async () => { calls += 1; if (calls <= 2) throw Object.assign(new Error("busy"), { code: "UNAVAILABLE", retryable: true }); return { outputs: { text: "done" } }; };
  const run = harness(draft.doc, { executors: { agent: flaky } });
  run.engine.start();
  await settle();
  const exec = run.state.executions[wf.execKey(step, "")];
  assert.equal(exec.status, "ready");
  assert.equal(exec.retryPending, true);
  assert.equal(exec.notBefore_ms, run.clock.now + 5000);
  run.clock.now += 4999;
  run.engine.tick();
  assert.equal(calls, 1);
  run.clock.now += 1;
  run.engine.tick();
  await settle();
  assert.equal(exec.notBefore_ms, run.clock.now + 30_000);
  run.clock.now += 30_000;
  run.engine.tick();
  await settle();
  assert.equal(exec.status, "succeeded");
  assert.equal(exec.attempt, 3);
  assert.deepEqual(exec.attempts.map((entry) => entry.outcome), ["failed", "failed", "succeeded"]);
  assert.deepEqual([...new Set(run.statuses(step))].includes("failed"), false);
  assert.deepEqual(run.statuses(step).filter((status, index, list) => status !== list[index - 1]), ["ready", "running", "ready", "running", "ready", "running", "succeeded"]);
  assert.equal(run.state.status, "succeeded");
});

test("Retry and fallback: Non-retryable failure is final at once; a manual Retry starts a new attempt and reopens the run", async () => {
  const draft = new Draft();
  const step = draft.add("agent", "step"), after = draft.add("notify", "after");
  draft.link("start", step);
  draft.link(`${step}.text`, `${after}.value`);
  let fail = true;
  const run = harness(draft.doc, { executors: { agent: async () => { if (fail) throw Object.assign(new Error("schema"), { code: "WORKFLOW_AGENT_OUTPUT_INVALID" }); return { outputs: { text: "ok" } }; }, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  assert.equal(run.statusOf(step), "failed");
  assert.equal(run.state.executions[wf.execKey(step, "")].attempts.length, 1);
  assert.equal(run.state.status, "failed");
  assert.equal(codeOf(() => run.engine.retry(after, "")), "WORKFLOW_NODE_NOT_ACTIVE");
  fail = false;
  run.engine.retry(step, "");
  await settle();
  assert.equal(run.statusOf(step), "succeeded");
  assert.equal(run.state.executions[wf.execKey(step, "")].attempt, 2);
  assert.equal(run.statusOf(after), "succeeded");
  assert.equal(run.state.status, "succeeded");
  assert.equal(run.state.reopenedCount, 1);
});

test("Node detail panel: Skip on a failed step skips it and its dependants and lets the run end", async () => {
  const draft = new Draft();
  const step = draft.add("agent", "step"), after = draft.add("agent", "after"), other = draft.add("notify", "other");
  draft.link("start", step);
  draft.link(`${step}.text`, `${after}.input`);
  draft.link("start", other);
  const run = harness(draft.doc, { executors: { agent: async () => { throw Object.assign(new Error("x"), { code: "INVALID_PARAMS" }); }, notify: async () => ({}) } });
  run.engine.start();
  await settle();
  assert.equal(run.state.status, "failed");
  run.engine.skip(step, "");
  await settle();
  assert.equal(run.state.executions[wf.execKey(step, "")].reason, "user_skipped");
  assert.equal(run.statusOf(after), "skipped");
  assert.equal(run.state.status, "succeeded");
});

test("Agent node: Timeout", async () => {
  const draft = new Draft();
  const step = draft.add("agent", "step", { timeout_s: 60 });
  draft.link("start", step);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor } });
  run.engine.start();
  run.clock.now += 59_000;
  run.engine.tick();
  assert.equal(run.statusOf(step), "running");
  run.clock.now += 1000;
  run.engine.tick();
  assert.ok(agent.calls[0].signal.aborted);
  assert.equal(run.state.executions[wf.execKey(step, "")].error!.code, "WORKFLOW_AGENT_TIMEOUT");
  assert.equal(run.state.status, "failed");
});

test("Node state machine: Illegal transition refused", async () => {
  const draft = new Draft();
  const step = draft.add("agent", "step");
  draft.link("start", step);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor } });
  run.engine.start();
  run.engine.cancel("user");
  agent.calls[0].resolve();
  await settle();
  assert.equal(run.statusOf(step), "cancelled");
  assert.equal(run.state.status, "cancelled");
  assert.equal(run.state.cancelReason, "user");
  assert.ok(run.logs.some((entry) => entry.message === "late_result_discarded"));
});

test("Run state machine: Run waits when nothing else can progress, and Other paths keep running", async () => {
  const draft = new Draft();
  const writer = draft.add("agent", "writer", { config: { promptTemplate: "draft" } }), gate = draft.add("approval", "gate"), after = draft.add("notify", "after"), slow = draft.add("agent", "slow");
  draft.link("start", writer);
  draft.link(`${writer}.text`, `${gate}.subject`);
  draft.link(`${gate}.approved`, after);
  draft.link("start", slow);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  agent.calls.find((call) => call.nodeId === writer)!.resolve({ outputs: { text: "Line one" } });
  await settle();
  assert.equal(run.statusOf(gate), "waiting_approval");
  assert.equal(run.state.status, "running");
  agent.calls.find((call) => call.nodeId === slow)!.resolve();
  await settle();
  assert.equal(run.state.status, "waiting_approval");
  assert.deepEqual(run.state.executions[wf.execKey(gate, "")].request, { kind: "approval", title: "Approve", instructions: "", subject: "Line one", allowEdit: true, canRequestChanges: false, assignee: "any_editor" });
  run.engine.resolve(gate, "", { outcome: "approved", by: { deviceId: "d1" } });
  await settle();
  assert.equal(run.state.status, "succeeded");
});

test("Approval node: Human approves with an edit, and Two devices resolve at once", async () => {
  const draft = new Draft();
  const gate = draft.add("approval", "gate", { inputs: [{ id: "subject", label: "subject", type: "any", default: "one\ntwo" }] }), after = draft.add("agent", "after", { config: { promptTemplate: "{{inputs.input}}" } });
  draft.link("start", gate);
  draft.link(`${gate}.subject`, `${after}.input`);
  const run = harness(draft.doc, { executors: { agent: echo } });
  run.engine.start();
  assert.equal(codeOf(() => run.engine.resolve(gate, "", { outcome: "changes_requested", notes: " ", by: { deviceId: "d1" } })), "INVALID_PARAMS");
  run.engine.resolve(gate, "", { outcome: "approved", subject: "one\nTWO", by: { deviceId: "d1" } });
  assert.equal(codeOf(() => run.engine.resolve(gate, "", { outcome: "rejected", by: { deviceId: "d2" } })), "CONFLICT");
  await settle();
  const exec = run.state.executions[wf.execKey(gate, "")];
  assert.equal((exec.outputs!.decision as { outcome: string; by: { deviceId: string } }).outcome, "approved");
  assert.equal((exec.outputs!.decision as { by: { deviceId: string } }).by.deviceId, "d1");
  assert.deepEqual(exec.fired, ["done", "approved"]);
  assert.equal(run.state.executions[wf.execKey(after, "")].outputs!.text, "one\nTWO");
});

test("Approval node: a rejection without a rejected route fails the run with WORKFLOW_REJECTED; with one it is routed; policy auto approves at once", async () => {
  const draft = new Draft();
  const gate = draft.add("approval", "gate", { inputs: [{ id: "subject", label: "subject", type: "any", default: "x" }] });
  draft.link("start", gate);
  const run = harness(draft.doc);
  run.engine.start();
  run.engine.resolve(gate, "", { outcome: "rejected", notes: "No", by: { deviceId: "d1" } });
  assert.equal(run.state.status, "failed");
  assert.equal(run.state.error!.code, "WORKFLOW_REJECTED");
  const fallback = draft.add("notify", "fallback");
  draft.link(`${gate}.rejected`, fallback);
  const routed = harness(draft.doc, { executors: { notify: async () => ({}) } });
  routed.engine.start();
  routed.engine.resolve(gate, "", { outcome: "rejected", by: { deviceId: "d1" } });
  await settle();
  assert.equal(routed.statusOf(fallback), "succeeded");
  assert.equal(routed.state.status, "succeeded");
  draft.apply([{ op: "node.update", id: gate, patch: { config: { ...draft.node(gate).config, policy: { mode: "auto" } } } }]);
  const auto = harness(draft.doc, { executors: { notify: async () => ({}) } });
  auto.engine.start();
  await settle();
  assert.equal((auto.state.executions[wf.execKey(gate, "")].outputs!.decision as { by: { kind: string } }).by.kind, "auto");
  assert.equal(auto.statusOf(fallback), "skipped");
});

test("Human input node: Submit a form, and Required field empty", async () => {
  const draft = new Draft();
  const form = draft.add("human_input", "form", { config: { fields: [{ id: "title", label: "Title", type: "text", required: true }, { id: "count", label: "Count", type: "number", required: false, min: 1, max: 3 }, { id: "tone", label: "Tone", type: "select", options: ["calm", "bold"], required: false }] } });
  const after = draft.add("agent", "after", { config: { promptTemplate: "{{inputs.input}}" } });
  draft.link("start", form);
  draft.link(`${form}.title`, `${after}.input`);
  const run = harness(draft.doc, { executors: { agent: echo } });
  run.engine.start();
  assert.equal(run.statusOf(form), "waiting_approval");
  assert.equal(run.state.executions[wf.execKey(form, "")].waitingReason, "input");
  const empty = errorOf(() => run.engine.resolve(form, "", { values: { count: 2 }, by: { deviceId: "d1" } }));
  assert.equal(empty.code, "INVALID_PARAMS");
  assert.deepEqual(empty.details.fields, { title: "Title is required" });
  assert.equal(run.statusOf(form), "waiting_approval");
  assert.deepEqual(errorOf(() => run.engine.resolve(form, "", { values: { title: "x", count: 9, tone: "loud" }, by: { deviceId: "d1" } })).details.fields, { count: "Count must be a number between 1 and 3", tone: "Tone must be one of the options" });
  run.engine.resolve(form, "", { values: { title: "Teaser", count: 2 }, by: { deviceId: "d1", deviceName: "Studio Mac" } });
  await settle();
  const exec = run.state.executions[wf.execKey(form, "")];
  assert.deepEqual((exec.outputs!.response as { by: unknown }).by, { deviceId: "d1", deviceName: "Studio Mac" });
  assert.equal(exec.outputs!.title, "Teaser");
  assert.equal(run.state.executions[wf.execKey(after, "")].outputs!.text, "Teaser");
});

test("Human input node: Optional timeout", async () => {
  const draft = new Draft();
  const form = draft.add("human_input", "form", { timeout_s: 3600, config: { fields: [{ id: "title", label: "Title", type: "text", required: true, default: "Untitled" }, { id: "note", label: "Note", type: "text", required: false }] } });
  const late = draft.add("notify", "late"), needsNote = draft.add("agent", "needsNote", { inputs: [{ id: "input", label: "input", type: "text", required: true }] });
  draft.link("start", form);
  draft.link(`${form}.timed_out`, late);
  draft.link(`${form}.note`, `${needsNote}.input`);
  const run = harness(draft.doc, { executors: { agent: echo, notify: async () => ({}) } });
  run.engine.start();
  run.clock.now += 3_600_000;
  run.engine.tick();
  await settle();
  const exec = run.state.executions[wf.execKey(form, "")];
  assert.deepEqual(exec.fired, ["timed_out"]);
  assert.deepEqual(exec.outputs, { title: "Untitled" });
  assert.equal(run.statusOf(late), "succeeded");
  assert.equal(run.statusOf(needsNote), "skipped");
});

test("Wait and notify nodes: Wait survives a restart", async () => {
  const draft = new Draft();
  const wait = draft.add("wait", "pause", { config: { mode: "duration", seconds: 7200 } });
  draft.link("start", wait);
  const run = harness(draft.doc);
  run.engine.start();
  const started = run.clock.now;
  assert.equal(run.state.executions[wf.execKey(wait, "")].waitingUntil_ms, started + 7_200_000);
  assert.equal(run.state.status, "running");
  // The host stops 30 minutes in and is back 10 minutes later: the checkpoint is all that is left.
  const restored = harness(draft.doc, { state: JSON.parse(JSON.stringify(run.state)) });
  restored.clock.now = started + 40 * 60_000;
  restored.engine.recover();
  restored.engine.tick();
  assert.equal(restored.statusOf(wait), "running");
  restored.clock.now = started + 7_200_000;
  restored.engine.tick();
  assert.equal(restored.statusOf(wait), "succeeded");
  assert.equal(restored.state.status, "succeeded");
});

test("Wait and notify nodes: until a time, and a time that is not a date fails the step", async () => {
  const draft = new Draft();
  draft.apply([{ op: "param.set", parameters: [{ name: "at", label: "At", type: "string", required: true, help: "", secret: false }] }]);
  const wait = draft.add("wait", "pause", { config: { mode: "until", until: "{{params.at}}" } });
  draft.link("start", wait);
  const run = harness(draft.doc, { params: { at: "2030-01-01T00:00:00Z" } });
  run.engine.start();
  assert.equal(run.state.executions[wf.execKey(wait, "")].waitingUntil_ms, Date.parse("2030-01-01T00:00:00Z"));
  const bad = harness(draft.doc, { params: { at: "soon" } });
  bad.engine.start();
  assert.equal(bad.state.executions[wf.execKey(wait, "")].error!.code, "WORKFLOW_CONDITION_ERROR");
});

test("Wait and notify nodes: Notification limit, and a delivery failure never fails the run", async () => {
  const draft = new Draft();
  const fan = draft.add("parallel", "fan", { config: { concurrency: 16, maxItems: 200 }, ...listInput(Array.from({ length: 30 }, (_, index) => index)) });
  const note = draft.add("notify", "note"), join = draft.add("join", "join");
  draft.link("start", fan);
  draft.link(`${fan}.item`, `${note}.value`);
  draft.link(note, join);
  let raised = 0;
  const run = harness({ ...draft.doc, settings: { ...draft.doc.settings, maxParallel: 16 } }, { executors: { notify: async () => { raised += 1; if (raised === 2) throw new Error("push failed"); return {}; } } });
  run.engine.start();
  await settle(40);
  assert.equal(raised, 20);
  assert.equal(run.logs.filter((entry) => entry.message === "notify_limit").length, 10);
  assert.ok(run.logs.some((entry) => /not delivered: push failed/.test(entry.message)));
  assert.equal(Object.values(run.state.executions).filter((exec) => exec.nodeId === note && exec.status === "succeeded").length, 30);
  assert.equal(run.state.status, "succeeded");
});

test("Pause, resume and cancel: Pause during fan-out", async () => {
  const { doc, body } = fanOut([0, 1, 2, 3, 4, 5, 6, 7], { concurrency: 8 });
  const agent = manual();
  const run = harness({ ...doc, settings: { ...doc.settings, maxParallel: 3 } }, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  const count = (status: string) => Object.values(run.state.executions).filter((exec) => exec.nodeId === body && exec.status === status).length;
  assert.equal(count("running"), 3);
  assert.equal(count("ready"), 5);
  assert.equal(run.state.executions[wf.execKey(body, "P:fan#3")].blockedBy, "slot");
  run.engine.pause();
  assert.equal(run.state.status, "paused");
  assert.equal(run.state.pauseReason, "user");
  for (const call of [...agent.calls]) call.resolve();
  await settle();
  assert.equal(count("succeeded"), 3);
  assert.equal(count("ready"), 5);
  assert.equal(agent.calls.length, 3);
  run.engine.resume();
  assert.equal(run.state.status, "running");
  assert.equal(agent.calls.length, 6);
});

test("Pause, resume and cancel: Cancel then resume from here", async () => {
  const draft = new Draft();
  const voice = draft.add("agent", "voice"), mix = draft.add("agent", "mix");
  draft.link("start", voice);
  draft.link(`${voice}.text`, `${mix}.input`);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor } });
  run.engine.start();
  agent.calls[0].resolve({ outputs: { text: "voice" } });
  await settle();
  run.engine.cancel("user");
  assert.equal(run.statusOf(mix), "cancelled");
  assert.ok(agent.calls[1].signal.aborted);
  assert.deepEqual(run.state.executions[wf.execKey(mix, "")].attempts.map((entry) => entry.outcome), ["cancelled"]);
  run.engine.resumeCancelled();
  await settle();
  assert.equal(agent.calls.filter((call) => call.nodeId === voice).length, 1);
  assert.equal(agent.calls.filter((call) => call.nodeId === mix).length, 2);
  agent.calls.at(-1)!.resolve();
  await settle();
  assert.equal(run.state.status, "succeeded");
  assert.equal(run.state.reopenedCount, 1);
});

test("Pause, resume and cancel: Cancel one node", async () => {
  const draft = new Draft();
  const one = draft.add("agent", "one", { onError: "skip" }), two = draft.add("agent", "two"), tail = draft.add("notify", "tail");
  draft.link("start", one);
  draft.link("start", two);
  draft.link(two, tail);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor, notify: async () => ({}) } });
  run.engine.start();
  run.engine.cancelNode(one, "");
  assert.equal(run.statusOf(one), "skipped");
  assert.equal(run.state.executions[wf.execKey(one, "")].reason, "error_skipped");
  assert.ok(agent.calls.find((call) => call.nodeId === one)!.signal.aborted);
  agent.calls.find((call) => call.nodeId === two)!.resolve();
  await settle();
  assert.equal(run.state.status, "succeeded");
  assert.equal(codeOf(() => run.engine.cancelNode(one, "")), "WORKFLOW_NODE_NOT_ACTIVE");
});

test("Checkpoints and resume: Restart during an agent node, and Restart while waiting for approval", async () => {
  const draft = new Draft();
  const writer = draft.add("agent", "writer"), gate = draft.add("approval", "gate", { inputs: [{ id: "subject", label: "subject", type: "any", default: "x" }] }), other = draft.add("agent", "other");
  draft.link("start", writer);
  draft.link("start", gate);
  draft.link("start", other);
  const first = manual();
  const run = harness(draft.doc, { executors: { agent: first.executor } });
  run.engine.start();
  first.calls.find((call) => call.nodeId === other)!.resolve();
  await settle();
  const second = manual();
  const restored = harness(draft.doc, { state: JSON.parse(JSON.stringify(run.state)), executors: { agent: second.executor } });
  restored.engine.recover();
  const exec = restored.state.executions[wf.execKey(writer, "")];
  assert.deepEqual(exec.attempts.map((entry) => entry.outcome), ["interrupted"]);
  assert.equal(exec.attempt, 2);
  assert.equal(exec.status, "running");
  assert.deepEqual(second.calls.map((call) => [call.nodeId, call.attempt]), [[writer, 2]]);
  assert.equal(restored.statuses(writer).includes("failed"), false);
  assert.equal(restored.statusOf(gate), "waiting_approval");
  restored.engine.resolve(gate, "", { outcome: "approved", by: { deviceId: "d1" } });
  // A second interruption of the same execution fails it.
  const third = harness(draft.doc, { state: JSON.parse(JSON.stringify(restored.state)), executors: { agent: manual().executor } });
  third.engine.recover();
  assert.equal(third.state.executions[wf.execKey(writer, "")].error!.code, "UNAVAILABLE");
  assert.equal(third.state.status, "failed");
});

test("Storage, RPC surface and Gateway dependency: Agent node while the Gateway restarts", async () => {
  const draft = new Draft();
  const writer = draft.add("agent", "writer"), pause = draft.add("wait", "pause", { config: { mode: "duration", seconds: 1 } });
  draft.link("start", writer);
  draft.link("start", pause);
  let ready = false;
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor }, gatewayReady: () => ready });
  run.engine.start();
  assert.equal(run.statusOf(writer), "ready");
  assert.equal(run.state.executions[wf.execKey(writer, "")].blockedBy, "waiting_gateway");
  run.clock.now += 1000;
  run.engine.tick();
  assert.equal(run.statusOf(pause), "succeeded");
  assert.equal(run.state.status, "running");
  ready = true;
  run.engine.tick();
  assert.equal(run.statusOf(writer), "running");
  assert.equal(agent.calls.length, 1);
});

test("Scheduler: Independent branches start together, bounded by the run's maxParallel", async () => {
  const draft = new Draft();
  const ids = ["a", "b", "c", "d", "e"].map((id) => draft.add("agent", id));
  for (const id of ids) draft.link("start", id);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor } });
  run.engine.start();
  assert.deepEqual(agent.calls.map((call) => call.nodeId), ["a", "b", "c", "d"]);
  assert.equal(run.state.executions[wf.execKey("e", "")].blockedBy, "slot");
  agent.calls[0].resolve();
  await settle();
  assert.equal(run.statusOf("e"), "running");
});

test("Scheduler: Merge node waits for every optional source, and a disabled step is skipped", async () => {
  const draft = new Draft();
  const skipped = draft.add("agent", "skipped", { disabled: true }), slow = draft.add("agent", "slow");
  const merge = draft.add("agent", "merge", { config: { promptTemplate: "{{inputs.a}}|{{inputs.b}}" }, inputs: [{ id: "a", label: "a", type: "text" }, { id: "b", label: "b", type: "text" }] });
  draft.link("start", slow);
  draft.link(`${skipped}.text`, `${merge}.a`);
  draft.link(`${slow}.text`, `${merge}.b`);
  const agent = manual();
  const run = harness(draft.doc, { executors: { agent: agent.executor } });
  run.engine.start();
  assert.equal(run.statusOf(skipped), "skipped");
  assert.equal(run.state.executions[wf.execKey(skipped, "")].reason, "disabled");
  assert.equal(run.statusOf(merge), "pending");
  agent.calls[0].resolve({ outputs: { text: "late" } });
  await settle();
  assert.equal(run.statusOf(merge), "running");
  assert.deepEqual(agent.calls[1].inputs, { b: "late" });
});

test("Budgets during a run: Confirmed-estimate guard — an attended run is paused with pauseReason budget_exceeded, the step stays ready with blockedBy budget_exceeded, running steps finish, and it goes on when resumed; an unattended run fails the node with BUDGET_EXCEEDED", async () => {
  const over = () => Object.assign(new Error("This video would pass the $1.00 you confirmed."), { code: "BUDGET_EXCEEDED", details: { reason: "confirmation_required", scope: "confirmed_estimate", confirmedUsd: 1, limitUsd: 1.2, spentUsd: 1.1, estimate: { amountUsd: 1.6 } } });
  const build = () => {
    const draft = new Draft();
    const paid = draft.add("agent", "paid"), other = draft.add("agent", "other"), after = draft.add("agent", "after");
    draft.link("start", paid); draft.link("start", other); draft.link(paid, after);
    return draft.doc;
  };
  // Attended: held, not failed.
  const agent = manual();
  const run = harness(build(), { executors: { agent: agent.executor }, attended: () => true });
  run.engine.start();
  assert.deepEqual(agent.calls.map((call) => call.nodeId), ["other", "paid"]);
  agent.calls[1].reject(over());
  await settle();
  assert.deepEqual([run.state.status, run.state.pauseReason, run.state.error, run.state.failedNodeId], ["paused", "budget_exceeded", undefined, undefined]);
  const held = run.state.executions[wf.execKey("paid", "")];
  assert.deepEqual([held.status, held.blockedBy, held.error?.code, (held.error?.details as { estimate: { amountUsd: number } }).estimate.amountUsd], ["ready", "budget_exceeded", "BUDGET_EXCEEDED", 1.6]);
  assert.deepEqual([run.statusOf("other"), run.statusOf("after")], ["running", "pending"]);
  assert.deepEqual(run.changes.filter((change) => change.kind === "run.status").at(-1), { kind: "run.status", status: "paused", pauseReason: "budget_exceeded" });
  // Running nodes are allowed to finish; nothing new starts while the run is paused.
  agent.calls[0].resolve();
  await settle();
  assert.deepEqual([run.statusOf("other"), run.state.status, agent.calls.length], ["succeeded", "paused", 2]);
  // The person accepted the new estimate: the held step is dispatched again and the run goes to its end.
  run.engine.resume();
  assert.deepEqual([run.state.status, run.statusOf("paid"), held.blockedBy, held.error, agent.calls.length], ["running", "running", undefined, undefined, 3]);
  agent.calls[2].resolve();
  await settle();
  agent.calls[3].resolve();
  await settle();
  assert.deepEqual([run.state.status, run.statusOf("after")], ["succeeded", "succeeded"]);
  // Held again when the amount is still too low; "Cancel run" ends it.
  const again = manual(), second = harness(build(), { executors: { agent: again.executor }, attended: () => true });
  second.engine.start();
  again.calls[1].reject(over());
  await settle();
  second.engine.resume();
  again.calls[2].reject(over());
  await settle();
  assert.deepEqual([second.state.status, second.state.pauseReason], ["paused", "budget_exceeded"]);
  second.engine.cancel("user");
  assert.deepEqual([second.state.status, second.statusOf("paid")], ["cancelled", "cancelled"]);
  // Unattended: nobody can answer, the node fails.
  const alone = manual(), unattended = harness(build(), { executors: { agent: alone.executor } });
  unattended.engine.start();
  alone.calls[1].reject(over());
  alone.calls[0].resolve();
  await settle();
  assert.deepEqual([unattended.state.status, unattended.state.error?.code, unattended.state.failedNodeId, unattended.statusOf("paid")], ["failed", "BUDGET_EXCEEDED", "paid", "failed"]);
});

/**
 * The executor of these tests pays from a ledger with a limit, the way a step pays through the host's budgets: a call
 * that would pass the limit is refused with BUDGET_EXCEEDED and nothing is paid. The LIMIT is a value the test changes —
 * "the budget was raised" means exactly that. (The real budgets, across Resume, Retry, cancel, a second device and a
 * restart of the host, are in server/test/prompt-video.test.ts "Budgets during a run: with the limit UNCHANGED…".)
 */
function ledger(scope: string, limitUsd: number, costUsd: number) {
  const book = { limitUsd, spentUsd: 0, paid: 0, refused: 0 };
  const executor: wf.NodeExecutor = async (context) => {
    if (book.spentUsd + costUsd > book.limitUsd + 1e-9) { book.refused += 1; throw Object.assign(new Error(`Budget reached — ${scope}`), { code: "BUDGET_EXCEEDED", details: { scope, limitUsd: book.limitUsd, remainingUsd: Math.max(0, book.limitUsd - book.spentUsd) } }); }
    book.spentUsd = Math.round((book.spentUsd + costUsd) * 100) / 100;
    book.paid += 1;
    return { outputs: { text: `${context.node.id}@${context.path}` } };
  };
  return { book, executor };
}

test("Budgets during a run: Budget stop — a hard-stop budget of any scope pauses an attended run with the step ready and blockedBy budget_exceeded; a Resume with the limit unchanged pays nothing and holds it again; after the limit is raised the same Resume pays and the run ends", async () => {
  for (const scope of ["session", "global", "provider", "project"]) {
    const draft = new Draft();
    const first = draft.add("agent", "first"), second = draft.add("agent", "second"), third = draft.add("agent", "third");
    draft.chain("start", first, second, third);
    // Actual cost 4.80 after two steps at 2.40; the next one would pass the 5.00 budget.
    const { book, executor } = ledger(scope, 5, 2.4);
    const run = harness(draft.doc, { executors: { agent: executor }, attended: () => true });
    run.engine.start();
    await settle(12);
    const held = run.state.executions[wf.execKey(third, "")];
    assert.deepEqual([run.state.status, run.state.pauseReason, held.status, held.blockedBy, held.error?.code, (held.error?.details as { scope: string }).scope], ["paused", "budget_exceeded", "ready", "budget_exceeded", "BUDGET_EXCEEDED", scope], scope);
    assert.deepEqual([book.paid, book.spentUsd, book.refused], [2, 4.8, 1], scope);
    // The limit is unchanged: Resume dispatches the step, it is refused again, nothing is paid — as often as it is tried.
    for (let attempt = 2; attempt <= 4; attempt++) {
      run.engine.resume();
      await settle(12);
      assert.deepEqual([run.state.status, run.state.pauseReason, held.status, held.blockedBy, book.paid, book.spentUsd, book.refused], ["paused", "budget_exceeded", "ready", "budget_exceeded", 2, 4.8, attempt], `${scope}, resume ${attempt - 1}`);
    }
    // A held step is not a failed step: there is nothing to retry.
    assert.equal(codeOf(() => run.engine.retry(third, "")), "WORKFLOW_NODE_NOT_ACTIVE");
    assert.equal(book.paid, 2);
    // The limit is raised: now the step is paid for and the run ends.
    book.limitUsd = 8;
    run.engine.resume();
    await settle(12);
    assert.deepEqual([run.state.status, run.statusOf(third), book.paid, book.spentUsd], ["succeeded", "succeeded", 3, 7.2], scope);
  }
});

test("Budgets during a run: Session budget applies before a loop ceiling — a loop that allows 50 iterations at 0.30 each under a 5.00 session budget is paused with budget_exceeded at the iteration that would pass it, long before the 50th; with the limit unchanged no further iteration is paid for", async () => {
  const draft = new Draft();
  const loop = draft.add("loop", "rounds", { config: { maxIterations: 50, continueWhile: when("loop.iteration", "lt", 50) }, inputs: [{ id: "initial", label: "initial", type: "any", default: "draft" }, { id: "next", label: "next", type: "any" }] });
  const work = draft.add("agent", "work", { config: { promptTemplate: "{{loop.iteration}}" } });
  draft.link("start", loop);
  draft.link(`${loop}.body`, `${work}.input`);
  draft.apply([{ op: "edge.add", edge: { id: "back", kind: "loop_back", from: { node: work, port: "text" }, to: { node: loop, port: "next" } } }]);
  assert.deepEqual(wf.validate(draft.doc).errors, []);
  const { book, executor } = ledger("session", 5, 0.3);
  const run = harness(draft.doc, { executors: { agent: executor }, attended: () => true });
  run.engine.start();
  await settle(200);
  // 16 iterations cost 4.80; the 17th would take session spend to 5.10.
  assert.deepEqual([run.state.status, run.state.pauseReason, book.paid, book.spentUsd], ["paused", "budget_exceeded", 16, 4.8]);
  const held = Object.values(run.state.executions).filter((exec) => exec.blockedBy === "budget_exceeded");
  assert.deepEqual(held.map((exec) => [exec.nodeId, exec.path, exec.status]), [[work, "L:rounds#17", "ready"]]);
  assert.equal(run.state.executions[wf.execKey(loop, "")].iteration, 17);
  assert.equal(run.statusOf(loop), "running", "the loop is not failed: it waits at its 17th iteration");
  // Unchanged limit: no further iteration is paid for.
  run.engine.resume();
  await settle(50);
  assert.deepEqual([run.state.status, run.state.pauseReason, book.paid, run.state.executions[wf.execKey(loop, "")].iteration], ["paused", "budget_exceeded", 16, 17]);
  // The session budget is raised to 6.00: four more iterations fit (6.00 exactly), the 21st is held.
  book.limitUsd = 6;
  run.engine.resume();
  await settle(60);
  assert.deepEqual([run.state.status, run.state.pauseReason, book.paid, book.spentUsd, run.state.executions[wf.execKey(loop, "")].iteration], ["paused", "budget_exceeded", 20, 6, 21]);
});

test("Budgets during a run: Unattended overrun — the node fails with BUDGET_EXCEEDED, nothing is paid, and the run fails unless the node's onError handles it", async () => {
  const build = (onError?: "skip") => {
    const draft = new Draft();
    const paid = draft.add("agent", "paid", onError ? { onError } : {}), after = draft.add("agent", "after");
    draft.chain("start", paid, after);
    return draft.doc;
  };
  // Nobody follows the run (an automation's): the budget is the automation's monthly one and it is already used up.
  const alone = ledger("automation", 0.2, 0.3), unattended = harness(build(), { executors: { agent: alone.executor } });
  unattended.engine.start();
  await settle(12);
  assert.deepEqual([unattended.state.status, unattended.state.error?.code, unattended.state.failedNodeId, unattended.statusOf("paid"), unattended.statusOf("after"), alone.book.paid], ["failed", "BUDGET_EXCEEDED", "paid", "failed", "skipped", 0]);
  // …unless the node's onError handles it: the step is skipped, and so is what needed its result.
  const handled = ledger("automation", 0.2, 0.3), skipping = harness(build("skip"), { executors: { agent: handled.executor } });
  skipping.engine.start();
  await settle(12);
  assert.deepEqual([skipping.state.status, skipping.statusOf("paid"), skipping.state.executions[wf.execKey("paid", "")].error?.code, handled.book.paid], ["succeeded", "skipped", "BUDGET_EXCEEDED", 0]);
});

test("Run view: the session of a running agent step is announced as soon as the step has it, not when the step ends", async () => {
  const draft = new Draft();
  const writer = draft.add("agent", "writer");
  draft.link("start", writer);
  let open: ((sessionKey: string) => void) | undefined, finish: (() => void) | undefined;
  const run = harness(draft.doc, { executors: { agent: (context) => new Promise((resolve) => { open = context.setSession; finish = () => resolve({ outputs: { text: "done" } }); }) } });
  run.engine.start();
  const before = run.changes.length;
  open!("agent:main:abc");
  assert.equal(run.state.executions[wf.execKey(writer, "")].sessionKey, "agent:main:abc");
  assert.deepEqual(run.changes.slice(before).map((change) => [change.kind, (change as { nodeId?: string }).nodeId, (change as { status?: string }).status]), [["node.status", writer, "running"]]);
  // Told once: the same key again changes nothing.
  open!("agent:main:abc");
  assert.equal(run.changes.length, before + 1);
  finish!();
  await settle();
  assert.equal(run.state.status, "succeeded");
});

test("Budgets during a run: Confirmed-estimate guard — a step that fails beside the held one while the run is paused still fails the run after a restart of the host (pause, failure in a sibling, restart, resume = failed, as without a restart)", async () => {
  const over = () => Object.assign(new Error("This video would pass the $1.00 you confirmed."), { code: "BUDGET_EXCEEDED", details: { reason: "confirmation_required", scope: "confirmed_estimate", confirmedUsd: 1, limitUsd: 1.2, spentUsd: 1.1, estimate: { amountUsd: 1.6 } } });
  const broken = () => Object.assign(new Error("The provider refused the request."), { code: "PROVIDER_ERROR" });
  const paused = async () => {
    const draft = new Draft();
    const paid = draft.add("agent", "paid"), other = draft.add("agent", "other"), after = draft.add("agent", "after");
    draft.link("start", paid); draft.link("start", other); draft.link(paid, after);
    const agent = manual(), run = harness(draft.doc, { executors: { agent: agent.executor }, attended: () => true });
    run.engine.start();
    agent.calls[1].reject(over());
    await settle();
    assert.deepEqual([run.state.status, run.state.pauseReason, run.statusOf("other")], ["paused", "budget_exceeded", "running"]);
    // The step beside it was running when the run paused; it fails for good while nobody has answered yet.
    agent.calls[0].reject(broken());
    await settle();
    assert.deepEqual([run.state.status, run.statusOf("other"), run.statusOf("paid")], ["paused", "failed", "ready"]);
    return { doc: draft.doc, agent, run };
  };
  const ended = (run: { state: wf.RunState; statusOf(nodeId: string): string | undefined }) => [run.state.status, run.state.error?.code, run.state.failedNodeId, run.statusOf("paid"), run.statusOf("after")];
  // Without a restart: the person confirms, and the run ends failed with the failure that was waiting.
  const same = await paused();
  same.run.engine.resume();
  await settle();
  assert.deepEqual(ended(same.run), ["failed", "PROVIDER_ERROR", "other", "ready", "pending"]);
  assert.equal(same.agent.calls.length, 2, "nothing is dispatched once a step failed the run");
  // With a restart in between: the checkpoint is all that is left, and the outcome is the same.
  const before = await paused();
  const again = manual(), restored = harness(before.doc, { executors: { agent: again.executor }, attended: () => true, state: JSON.parse(JSON.stringify(before.run.state)) });
  restored.engine.recover();
  assert.deepEqual([restored.state.status, restored.state.pauseReason], ["paused", "budget_exceeded"]);
  restored.engine.resume();
  await settle();
  assert.deepEqual(ended(restored), ended(same.run));
  assert.equal(again.calls.length, 0, "the held step is not paid for after the run failed");
  assert.equal(restored.state.pendingFailure, undefined);
});
