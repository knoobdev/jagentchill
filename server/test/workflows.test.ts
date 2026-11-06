// The agent runtime in these tests is the FAKE of `harness.ts`: an agent step's turn is answered and ended by the test
// (what the runtime streams becomes the session's transcript). Sessions, documents, runs, streams and the store are the server's real ones.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { workflow as wf } from "@jagentchill/editor-core";
import type { WorkflowDocument, WorkflowOp } from "@jagentchill/protocol";
import type { StepTool } from "../src/workflows/runs.ts";
import { createWorkflowService } from "../src/workflows/service.ts";
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
import { SAMPLE_MODELS, createHarness, model as runtimeModel, tick, type Harness } from "./harness.ts";

const open: Harness[] = [];
afterEach(() => { for (const h of open.splice(0)) { try { h.close(); } catch { /* already closed by the test */ } } });
type Device = Awaited<ReturnType<Harness["pair"]>>;
const ACME = { mode: "override", runtime: "claude-code", provider: "anthropic", model: "opus" };
const WORKFLOW_TURN_PREFIX = "This is an unattended workflow run. Do not ask the user or call a question tool; decide from the available information and state your assumption in this step's output.\n\n";
const assertWorkflowMessage = (actual: string, expected: string) => assert.equal(actual, `${WORKFLOW_TURN_PREFIX}${expected}`);

async function setup() {
  const clock = { now: Date.now() };
  // The chat models of this host have a known price — free: a run of them costs nothing, so nobody is asked about
  // money when it starts (the tests of the money question, at the end of this file, set real prices).
  const h = await createHarness({ now: () => clock.now, extra: { modelPrice: () => ({ inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "admin" as const }) } });
  open.push(h);
  const admin = await h.pair("Studio Mac", "admin");
  return { h, admin, clock };
}
type Part = { type: "text"; text: string } | { type: "thinking"; thinking: string };
/** The runtime answers the running turn of a session with these parts (its thinking and its text, as it streams them) and ends it. */
function answer(h: Harness, sessionKey: string, content: string | Part[]): void {
  const parts: Part[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  for (const part of parts) if (part.type === "thinking") h.fake.emit(sessionKey, { type: "reasoning_delta", turnId: h.fake.session(sessionKey).turnId, text: part.thinking });
  h.fake.reply(sessionKey, parts.map((part) => (part.type === "text" ? part.text : "")).join(""));
}
const answerTurn = answer;
async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let n = 0; n < 400; n++) { if (await done()) return; await tick(10); }
  throw new Error(`timed out waiting for ${what}`);
}
/** A workflow built through the channel, the way the canvas builds one. */
async function build(device: Device, name: string, steps: (doc: WorkflowDocument) => WorkflowOp[][]): Promise<WorkflowDocument> {
  let { document } = await device.call("jagentchill.workflow.create", { name });
  for (const ops of steps(document)) {
    await device.call("jagentchill.workflow.apply", { workflowId: document.id, baseRevision: document.revision, ops });
    document = (await device.call("jagentchill.workflow.get", { workflowId: document.id })).document;
  }
  return document;
}
const node = (doc: WorkflowDocument, type: Parameters<typeof wf.makeNode>[1], id: string, patch: Record<string, unknown> = {}): WorkflowOp => {
  const made = wf.makeNode(doc, type, { x: 400, y: 200 }, id);
  return { op: "node.add", node: { ...made, ...patch, config: { ...made.config, ...((patch.config as object) ?? {}) } } };
};
const edge = (id: string, from: string, to: string): WorkflowOp => {
  const [fromNode, fromPort = "done"] = from.split("."), [toNode, toPort = "start"] = to.split(".");
  return { op: "edge.add", edge: { id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } } };
};
const waitFlow = (seconds = 3600) => (doc: WorkflowDocument): WorkflowOp[][] => [[node(doc, "wait", "pause", { config: { mode: "duration", seconds } }), edge("e1", "start", "pause")]];
const statusOf = async (device: Device, runId: string) => (await device.call("jagentchill.workflow.run.get", { runId })).run.status as string;

test("Validation rules: Draft with errors — the save succeeds, the list shows the problems, and the run is refused", async () => {
  const { admin } = await setup();
  const doc = await build(admin, "Draft", (start) => [[node(start, "approval", "gate"), node(start, "wait", "lonely")], [edge("e1", "start", "gate")]]);
  const { workflows } = await admin.call("jagentchill.workflow.list");
  assert.equal(workflows.find((entry: { id: string }) => entry.id === doc.id).problemCount, 2);
  const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: doc.id });
  assert.equal(refused.code, "WORKFLOW_INVALID");
  assert.equal(refused.message, "Fix 2 problems to run");
  assert.equal(refused.details.errors.length, 2);
});

test("Workflow document: Unknown node type rejected at the channel, naming the path", async () => {
  const { admin } = await setup();
  const { document } = await admin.call("jagentchill.workflow.create", {});
  const refused = await admin.fail("jagentchill.workflow.validate", { document: { ...document, nodes: [...document.nodes, { ...document.nodes[0], id: "q", type: "queue" }] } });
  assert.equal(refused.code, "WORKFLOW_SCHEMA_INVALID");
  assert.equal(refused.details.path, "nodes[1].type");
  assert.equal(refused.details.allowed.length, 17);
  assert.equal(document.name, "Untitled workflow");
});

test("Graph operations: Concurrent move is merged; Concurrent edits of different nodes both apply; Concurrent edit of the same node conflicts", async () => {
  const { h, admin } = await setup();
  const other = await h.pair("Phone", "editor");
  const doc = await build(admin, "Shared", (start) => [[node(start, "agent", "brief", { config: { runtime: ACME } }), node(start, "wait", "pause"), edge("e1", "start", "brief"), edge("e2", "brief", "pause")]]);
  const base = doc.revision;
  const first = await admin.call("jagentchill.workflow.apply", { workflowId: doc.id, baseRevision: base, ops: [{ op: "node.update", id: "brief", patch: { name: "Brief" } }] });
  assert.equal(first.rebased, false);
  // B still sees the older revision: a move is merged, a change to another step is rebased, a change to the same step conflicts.
  const moved = await other.call("jagentchill.workflow.apply", { workflowId: doc.id, baseRevision: base, ops: [{ op: "node.move", id: "brief", position: { x: 800, y: 400 } }] });
  assert.deepEqual([moved.revision, moved.rebased], [base + 2, true]);
  const elsewhere = await other.call("jagentchill.workflow.apply", { workflowId: doc.id, baseRevision: base, ops: [{ op: "node.update", id: "pause", patch: { name: "Hold" } }] });
  assert.deepEqual([elsewhere.revision, elsewhere.rebased], [base + 3, true]);
  const conflict = await other.fail("jagentchill.workflow.apply", { workflowId: doc.id, baseRevision: base, ops: [{ op: "node.update", id: "brief", patch: { description: "mine" } }] });
  assert.equal(conflict.code, "WORKFLOW_REVISION_CONFLICT");
  assert.deepEqual(conflict.details.conflicts.map((entry: { opIndex: number; kind: string; id: string; changedInRevision: number }) => [entry.opIndex, entry.kind, entry.id, entry.changedInRevision]), [[0, "node", "brief", base + 1]]);
  assert.equal(conflict.details.conflicts[0].by.deviceId, admin.device.deviceId);
  const head = (await admin.call("jagentchill.workflow.get", { workflowId: doc.id })).document as WorkflowDocument;
  assert.equal(head.revision, base + 3);
  assert.equal(head.nodes.find((entry) => entry.id === "brief")!.name, "Brief");
  assert.deepEqual(head.nodes.find((entry) => entry.id === "brief")!.position, { x: 800, y: 400 });
  // Geometry of a step that is gone is dropped without a word.
  await admin.call("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "node.remove", id: "pause" }] });
  const dropped = await other.call("jagentchill.workflow.apply", { workflowId: doc.id, baseRevision: base, ops: [{ op: "node.move", id: "pause", position: { x: 0, y: 0 } }] });
  assert.deepEqual(dropped.droppedOps, [0]);
  // A viewer edits nothing.
  const viewer = await h.pair("Guest", "viewer");
  assert.equal((await viewer.fail("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "meta.update", patch: { name: "x" } }] })).code, "SCOPE_DENIED");
});

test("Graph operations: Atomic batch over the channel — nothing of a refused batch is stored", async () => {
  const { admin } = await setup();
  const doc = await build(admin, "Atomic", waitFlow());
  const refused = await admin.fail("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "node.update", id: "pause", patch: { name: "Hold" } }, { op: "node.remove", id: "start" }] });
  assert.equal(refused.code, "WORKFLOW_TRIGGER_REQUIRED");
  assert.equal(refused.details.opIndex, 1);
  const head = (await admin.call("jagentchill.workflow.get", { workflowId: doc.id })).document as WorkflowDocument;
  assert.equal(head.revision, doc.revision);
  assert.equal(head.nodes.find((entry) => entry.id === "pause")!.name, "Wait pause");
});

test("Document operation stream: Ordered delivery", async () => {
  const { h, admin } = await setup();
  const watcher = await h.pair("Phone", "viewer");
  const { document } = await admin.call("jagentchill.workflow.create", { name: "Stream" });
  await watcher.call("jagentchill.workflow.subscribe", { stream: "doc", id: document.id });
  const batches: WorkflowOp[][] = [
    [node(document, "wait", "a")],
    [node(document, "wait", "b"), node(document, "wait", "c"), edge("e1", "start", "a"), edge("e2", "a", "b")],
    [edge("e3", "b", "c"), { op: "meta.update", patch: { description: "Three batches" } }],
  ];
  for (const ops of batches) await admin.call("jagentchill.workflow.apply", { workflowId: document.id, ops });
  await until(() => watcher.events.filter((entry) => entry.event === "jagentchill.workflow.ops").length === 3, "three op events");
  const events = watcher.events.filter((entry) => entry.event === "jagentchill.workflow.ops").map((entry) => entry.payload);
  assert.deepEqual(events.map((event) => event.revision), [2, 3, 4]);
  assert.deepEqual(events.map((event) => event.baseRevision), [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.ops.map((op: { index: number }) => op.index)), [[0], [0, 1, 2, 3], [0, 1]]);
  assert.equal(events[0].actor.deviceId, admin.device.deviceId);
});

test("Versioning: Edit during a run, and Restore", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Versions", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "First prompt", runtime: ACME } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the agent turn");
  await admin.call("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "node.update", id: "writer", patch: { config: { ...doc.nodes[1].config, promptTemplate: "Second prompt" } } }] });
  const snapshot = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).document as WorkflowDocument;
  assert.equal(snapshot.nodes[1].config.promptTemplate, "First prompt");
  assertWorkflowMessage(h.fake.callsOf("startTurn")[0].message, "First prompt");
  // Restoring revision 2 at revision 3 creates revision 4 with its content; revisions 1–3 stay listed.
  const restored = await admin.call("jagentchill.workflow.restore", { workflowId: doc.id, revision: doc.revision });
  assert.equal(restored.document.revision, doc.revision + 2);
  assert.equal(restored.document.nodes[1].config.promptTemplate, "First prompt");
  const { revisions } = await admin.call("jagentchill.workflow.history", { workflowId: doc.id });
  assert.deepEqual(revisions.map((entry: { revision: number }) => entry.revision), [4, 3, 2, 1]);
  assert.equal(revisions[0].label, "Restore revision 2");
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
});

test("Agent node: a step is a real session of the device that started the run; its answer is the step's text and feeds the next step", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Agents", (start) => [
    [{ op: "param.set", parameters: [{ name: "topic", label: "Topic", type: "text", required: true, help: "", secret: false }] }],
    [node(start, "agent", "writer", { name: "Writer", config: { promptTemplate: "Write one line about {{inputs.input}}", instructions: "Be brief.", runtime: ACME } }), node(start, "agent", "editor", { config: { promptTemplate: "Polish: {{inputs.input}}", runtime: ACME } })],
    [edge("e1", "start.topic", "writer.input"), edge("e2", "writer.text", "editor.input"), { op: "output.set", outputs: [{ name: "line", type: "text", from: { node: "editor", port: "text" } }] }],
  ]);
  assert.equal((await admin.fail("jagentchill.workflow.run.create", { workflowId: doc.id })).details.param, "topic");
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id, params: { topic: "lanterns" } });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the first turn");
  const first = h.fake.callsOf("startTurn")[0];
  assertWorkflowMessage(first.message, "Be brief.\n\nWrite one line about lanterns");
  const session = h.app.relay.session(first.sessionKey)!;
  assert.equal(session.ownerDeviceId, admin.device.deviceId);
  assert.equal(session.title, "Agents · Writer");
  assert.deepEqual(session.ref, { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" });
  // Opened in Edit mode (Claude Code's acceptEdits): never unattended — the server still answers every permission of the step.
  assert.equal(h.fake.callsOf("createSession").at(-1).mode, "acceptEdits");
  answer(h, first.sessionKey, [{ type: "text", text: "Lanterns drift over the river." }]);
  await until(() => h.fake.callsOf("startTurn").length === 2, "the second turn");
  const second = h.fake.callsOf("startTurn")[1];
  assertWorkflowMessage(second.message, "Polish: Lanterns drift over the river.");
  assert.notEqual(second.sessionKey, first.sessionKey);
  answer(h, second.sessionKey, "Lanterns drift, slow, over the river.");
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the run to succeed");
  const view = await admin.call("jagentchill.workflow.run.get", { runId: run.id });
  assert.deepEqual(view.run.outputs, { line: "Lanterns drift, slow, over the river." });
  const { executions } = await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "writer" });
  assert.equal(executions[0].sessionKey, first.sessionKey);
  assert.equal(executions[0].outputs.text, "Lanterns drift over the river.");
  const { entries } = await admin.call("jagentchill.workflow.node.logs", { runId: run.id, nodeId: "writer" });
  assert.ok(entries.some((entry: { message: string; source: string }) => entry.source === "executor" && entry.message === "Answer: Lanterns drift over the river."));
});

test("Agent node: a role without a model fails the step with NO_ROUTE; a failed turn fails it; Retry runs it again in a new session", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Routes", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "Hello" } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(async () => (await statusOf(admin, run.id)) === "failed", "the run to fail");
  const failed = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run;
  assert.equal(failed.error.code, "NO_ROUTE");
  assert.equal(failed.failedNodeId, "writer");
  await admin.call("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "node.update", id: "writer", patch: { config: { ...doc.nodes[1].config, runtime: ACME } } }] });
  const again = (await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id })).run;
  await until(() => h.fake.callsOf("startTurn").length === 1, "the turn");
  h.fake.endTurn(h.fake.callsOf("startTurn")[0].sessionKey, undefined, "error", "upstream reset");
  await until(async () => (await statusOf(admin, again.id)) === "failed", "the second run to fail");
  assert.equal((await admin.call("jagentchill.workflow.run.get", { runId: again.id })).run.error.code, "WORKFLOW_RUNTIME_UNAVAILABLE");
  const retried = await admin.call("jagentchill.workflow.node.retry", { runId: again.id, nodeId: "writer", path: "" });
  assert.equal(retried.run.status, "running");
  assert.equal(retried.run.reopenedCount, 1);
  await until(() => h.fake.callsOf("startTurn").length === 2, "the retried turn");
  const turn = h.fake.callsOf("startTurn")[1];
  answer(h, turn.sessionKey, "Hello.");
  await until(async () => (await statusOf(admin, again.id)) === "succeeded", "the retried run to succeed");
});

test("A turn's answer is the answer of THAT turn: the message the turn wrote, also when it streamed in pieces and when it says the same words as the answer before", async () => {
  // (The Gateway wrote its transcript a moment after a turn ended, so a read could still end with the previous answer.
  // The server writes the transcript itself from what the runtime streams, before the turn's end is told.)
  const { h, admin } = await setup();
  const runs = h.app.workflows.runs, deviceId = admin.device.deviceId;
  const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string }>;
  const ask = (message: string, sessionKey?: string) => runs.turn(deviceId, { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" }, title: "Stale", message, ...(sessionKey ? { sessionKey } : {}) });
  // Turn 1 of a session.
  const first = ask("one");
  await until(() => sends().length === 1, "the first turn");
  const key = sends()[0].sessionKey;
  answer(h, key, "OLD ANSWER");
  const one = await first;
  assert.equal(one.text, "OLD ANSWER");
  // Turn 2 on the same session: the answer is streamed in pieces.
  const second = ask("two", one.sessionKey);
  await until(() => sends().length === 2, "the second turn");
  h.fake.text(key, "NEW ");
  h.fake.text(key, "ANSWER");
  h.fake.endTurn(key);
  assert.equal((await second).text, "NEW ANSWER", "the previous turn's message is never this turn's answer");
  // Turn 3: the same words as an earlier answer are this turn's answer when this turn wrote them.
  const third = ask("three", one.sessionKey);
  await until(() => sends().length === 3, "the third turn");
  answer(h, key, "NEW ANSWER");
  assert.equal((await third).text, "NEW ANSWER");
  // A turn that ends without a word: its answer is empty, never the answer before it.
  const fourth = ask("four", one.sessionKey);
  await until(() => sends().length === 4, "the fourth turn");
  h.fake.endTurn(key);
  assert.equal((await fourth).text, "");
});

test("Pause, resume and cancel: cancelling a run aborts the agent's turn; Resume from here runs only what was cancelled", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Cancel", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "Hello", runtime: ACME } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the turn");
  const cancelled = await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
  assert.equal(cancelled.run.status, "cancelled");
  await until(() => admin.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.runId === run.id && entry.payload.status === "cancelled"), "the cancelled transition notice");
  assert.equal(cancelled.run.cancelReason, "user");
  await until(() => h.fake.callsOf("interrupt").length === 1, "the abort");
  assert.equal((await admin.fail("jagentchill.workflow.run.cancel", { runId: run.id })).code, "CONFLICT");
  const resumed = await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  assert.equal(resumed.run.status, "running");
  await until(() => admin.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.runId === run.id && entry.payload.status === "running"), "the resumed transition notice");
  await until(() => h.fake.callsOf("startTurn").length === 2, "the turn after resume");
  const { entries } = await admin.call("jagentchill.workflow.run.timeline", { runId: run.id });
  assert.deepEqual(entries.filter((entry: { change: { kind: string } }) => entry.change.kind === "user.action").map((entry: { change: { action: string } }) => entry.change.action), ["cancel", "resume"]);
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
  await admin.call("jagentchill.workflow.run.delete", { runId: run.id });
  assert.equal((await admin.fail("jagentchill.workflow.run.get", { runId: run.id })).code, "NOT_FOUND");
});

test("Approval node: Viewer cannot approve; Two devices resolve at once; the waiting step is announced to the devices that may answer", async () => {
  const { h, admin } = await setup();
  const editor = await h.pair("Laptop", "editor"), viewer = await h.pair("Guest", "viewer");
  const doc = await build(admin, "Gate", (start) => [[node(start, "approval", "gate", { config: { title: "Approve the cut" }, inputs: [{ id: "subject", label: "subject", type: "any", default: "Cut A" }] }), node(start, "notify", "done", { config: { title: "Approved", body: "{{inputs.value}}", target: "all_paired" } }), edge("e1", "start", "gate"), edge("e2", "gate.subject", "done.value")]]);
  await viewer.call("jagentchill.workflow.subscribe", { stream: "index" });
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  assert.equal(run.status, "waiting_approval");
  await viewer.call("jagentchill.workflow.subscribe", { stream: "run", id: run.id });
  const view = await viewer.call("jagentchill.workflow.run.get", { runId: run.id });
  assert.equal(view.waiting[0].request.subject, "Cut A");
  assert.equal(view.nodes.find((entry: { nodeId: string }) => entry.nodeId === "gate").status, "waiting_approval");
  await until(() => editor.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "attention"), "the attention notice");
  assert.equal(viewer.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "attention"), false);
  assert.equal((await admin.call("jagentchill.workflow.list")).attention, 1);
  const denied = await viewer.fail("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "gate", outcome: "approved" });
  assert.equal(denied.code, "SCOPE_DENIED");
  const approved = await editor.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "gate", outcome: "approved", subject: "Cut B" });
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the run to succeed");
  assert.equal((await admin.fail("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "gate", outcome: "rejected" })).code, "CONFLICT");
  // The notify step reaches every paired device; the viewer watches the run live.
  await until(() => viewer.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "notify"), "the notification");
  assert.deepEqual(viewer.events.find((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "notify")!.payload.body, "Cut B");
  // w7 shell item 4: the end of the run is told to every device that may read it — the editor watches neither the run nor the list of workflows.
  await until(() => editor.events.some((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "ended"), "the end of the run, told to a device that is elsewhere");
  const ended = editor.events.find((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "ended" && entry.payload.status === "succeeded")!.payload;
  assert.deepEqual({ runId: ended.runId, status: ended.status, title: ended.title, link: ended.link, level: ended.level }, { runId: run.id, status: "succeeded", title: "Gate", link: "run", level: "info" });
  assert.equal(editor.events.filter((entry) => entry.event === "jagentchill.workflow.notice" && entry.payload.kind === "ended" && entry.payload.status === "succeeded").length, 1, "the success is told once");
  const live = viewer.events.filter((entry) => entry.event === "jagentchill.workflow.updated").flatMap((entry) => entry.payload.changes);
  assert.ok(live.some((change: { kind: string; nodeId?: string; status?: string }) => change.kind === "node.status" && change.nodeId === "gate" && change.status === "succeeded"));
  assert.ok(live.some((change: { kind: string; state?: string }) => change.kind === "edge.state" && change.state === "delivered"));
  assert.ok(live.some((change: { kind: string; status?: string }) => change.kind === "run.status" && change.status === "succeeded"));
  assert.ok(viewer.events.some((entry) => entry.event === "jagentchill.workflow.run.changed" && entry.payload.run.status === "succeeded"));
  // An approval assigned to admins is not an editor's to answer.
  await admin.call("jagentchill.workflow.apply", { workflowId: doc.id, ops: [{ op: "node.update", id: "gate", patch: { config: { ...doc.nodes[1].config, assignee: "admins" } } }] });
  const second = (await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id })).run;
  assert.equal((await editor.fail("jagentchill.workflow.node.resolve", { runId: second.id, nodeId: "gate", outcome: "approved" })).message, "Only an admin device can answer this step.");
  await admin.call("jagentchill.workflow.node.resolve", { runId: second.id, nodeId: "gate", outcome: "approved" });
});

test("Human input node: the form is answered over the channel; a required field left empty is refused with a field message", async () => {
  const { admin } = await setup();
  const doc = await build(admin, "Form", (start) => [[node(start, "human_input", "form", { config: { title: "Details", fields: [{ id: "title", label: "Title", type: "text", required: true }] } }), edge("e1", "start", "form"), { op: "output.set", outputs: [{ name: "title", type: "text", from: { node: "form", port: "title" } }] }]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  const refused = await admin.fail("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "form", values: {} });
  assert.equal(refused.code, "INVALID_PARAMS");
  assert.deepEqual(refused.details.fields, { title: "Title is required" });
  const done = await admin.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "form", values: { title: "Teaser" } });
  assert.deepEqual(done.run.outputs, { title: "Teaser" });
  const { executions } = await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "form" });
  assert.equal(executions[0].outputs.response.by.deviceName, "Studio Mac");
});

test("Storage, RPC surface: Idempotent run creation", async () => {
  const { admin } = await setup();
  const doc = await build(admin, "Once", waitFlow());
  const first = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id, idempotencyKey: "key-0001" });
  const second = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id, idempotencyKey: "key-0001" });
  assert.equal(first.run.id, second.run.id);
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 1);
});

test("Concurrency limits: Fourth run queues and starts when a running run ends", async () => {
  const { admin, clock, h } = await setup();
  const doc = await build(admin, "Queue", waitFlow(60));
  const ids: string[] = [];
  for (let index = 0; index < 4; index++) ids.push((await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id })).run.id);
  assert.deepEqual(await Promise.all(ids.map((runId) => statusOf(admin, runId))), ["running", "running", "running", "queued"]);
  await admin.call("jagentchill.workflow.run.cancel", { runId: ids[0] });
  await until(async () => (await statusOf(admin, ids[3])) === "running", "the queued run to start");
  clock.now += 61_000;
  h.app.workflows.tick();
  await until(async () => (await statusOf(admin, ids[3])) === "succeeded", "the waits to end");
  assert.deepEqual((await admin.call("jagentchill.workflow.run.list", { status: "succeeded" })).runs.length, 3);
});

test("Subworkflow node: Pinned revision, the child's outputs are the step's, and Cancel cascades", async () => {
  const { h, admin } = await setup();
  const child = await build(admin, "Child", (start) => [
    [{ op: "node.update", id: "start", patch: { config: { sources: [{ kind: "manual", enabled: true }, { kind: "subworkflow", enabled: true }] } } }, { op: "param.set", parameters: [{ name: "word", label: "Word", type: "text", required: true, help: "", secret: false }] }],
    [node(start, "agent", "say", { config: { promptTemplate: "Say {{inputs.input}}", runtime: ACME } }), edge("e1", "start.word", "say.input"), { op: "output.set", outputs: [{ name: "said", type: "text", from: { node: "say", port: "text" } }] }],
  ]);
  const pinned = child.revision;
  await admin.call("jagentchill.workflow.apply", { workflowId: child.id, ops: [{ op: "node.update", id: "say", patch: { config: { ...child.nodes[1].config, promptTemplate: "Shout {{inputs.input}}" } } }] });
  const parent = await build(admin, "Parent", (start) => [[
    node(start, "subworkflow", "call", { config: { workflowId: child.id, revision: { pinned }, paramBindings: { word: "hello" } }, outputs: [{ id: "said", label: "said", type: "text" }, { id: "run", label: "run", type: "RunRef" }] }),
    edge("e1", "start", "call"), { op: "output.set", outputs: [{ name: "result", type: "text", from: { node: "call", port: "said" } }] },
  ]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: parent.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the child's turn");
  const turn = h.fake.callsOf("startTurn")[0];
  assertWorkflowMessage(turn.message, "Say hello");
  answer(h, turn.sessionKey, "hello");
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the parent to succeed");
  assert.deepEqual((await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run.outputs, { result: "hello" });
  // The child run is not listed among the runs a person started.
  assert.deepEqual((await admin.call("jagentchill.workflow.run.list", {})).runs.map((entry: { workflowName: string }) => entry.workflowName), ["Parent"]);
  const childRun = h.app.workflows.runs.list({ includeChildren: true }).find((entry) => entry.origin === "subworkflow")!;
  assert.equal(childRun.revision, pinned);
  assert.equal(childRun.originRef.parentRunId, run.id);
  // Cancelling the parent cancels the child that is running.
  const second = (await admin.call("jagentchill.workflow.run.create", { workflowId: parent.id })).run;
  await until(() => h.fake.callsOf("startTurn").length === 2, "the second child's turn");
  await admin.call("jagentchill.workflow.run.cancel", { runId: second.id });
  await until(() => h.app.workflows.runs.list({ includeChildren: true }).filter((entry) => entry.origin === "subworkflow" && entry.status === "cancelled").length === 1, "the child to be cancelled");
  assert.equal(h.app.workflows.runs.list({ includeChildren: true }).find((entry) => entry.status === "cancelled" && entry.origin === "subworkflow")!.cancelReason, "parent");
  // A workflow that does not allow it cannot be run as a sub-workflow.
  await admin.call("jagentchill.workflow.apply", { workflowId: child.id, ops: [{ op: "node.update", id: "start", patch: { config: { sources: [{ kind: "manual", enabled: true }] } } }] });
  assert.equal((await admin.fail("jagentchill.workflow.run.create", { workflowId: parent.id })).code, "WORKFLOW_INVALID");
});

test("Checkpoints and resume: after a restart of the host a waiting run goes on from its checkpoint, and an interrupted agent step is dispatched once more", async () => {
  const { h, admin, clock } = await setup();
  const doc = await build(admin, "Restart", (start) => [[node(start, "wait", "pause", { config: { mode: "duration", seconds: 7200 } }), node(start, "agent", "writer", { config: { promptTemplate: "Hello", runtime: ACME } }), node(start, "approval", "gate", { inputs: [{ id: "subject", label: "subject", type: "any", default: "x" }] }), edge("e1", "start", "pause"), edge("e2", "start", "writer"), edge("e3", "start", "gate")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the turn");
  const started = clock.now;
  // The host stops: its engines are gone, the store is all that is left. Ten minutes later a new service starts on it.
  h.app.workflows.close();
  clock.now += 40 * 60_000;
  const next = createWorkflowService({ db: h.app.db, now: () => clock.now, devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, sweepMs: 0 });
  await until(() => h.fake.callsOf("startTurn").length === 2, "the turn after the restart");
  const writer = next.runs.executions(run.id, { nodeId: "writer" })[0];
  assert.deepEqual(writer.attempts.map((attempt) => attempt.outcome), ["interrupted"]);
  assert.equal(writer.attempt, 2);
  assert.equal(next.runs.executions(run.id, { nodeId: "gate" })[0].status, "waiting_approval");
  assert.equal(next.runs.executions(run.id, { nodeId: "pause" })[0].waitingUntil_ms, started + 7_200_000);
  next.runs.resolve(run.id, { nodeId: "gate", path: "", outcome: "approved" }, { deviceId: admin.device.deviceId, role: () => "admin" });
  const turn = h.fake.callsOf("startTurn")[1];
  answer(h, turn.sessionKey, "Hello.");
  await until(() => next.runs.executions(run.id, { nodeId: "writer" })[0].status === "succeeded", "the writer to finish");
  clock.now = started + 7_200_000;
  next.tick();
  assert.equal(next.runs.record(run.id).status, "succeeded");
  next.close();
});

test("Storage, RPC surface: Starting device revoked — its run is cancelled with reason device_revoked and another device's run continues", async () => {
  const { h, admin } = await setup();
  const editor = await h.pair("Laptop", "editor");
  const doc = await build(admin, "Revoked", waitFlow());
  const mine = (await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id })).run, theirs = (await editor.call("jagentchill.workflow.run.create", { workflowId: doc.id })).run;
  await admin.call("jagentchill.device.revoke", { deviceId: editor.device.deviceId });
  h.app.workflows.tick();
  const cancelled = (await admin.call("jagentchill.workflow.run.get", { runId: theirs.id })).run;
  assert.deepEqual([cancelled.status, cancelled.cancelReason], ["cancelled", "device_revoked"]);
  assert.equal(await statusOf(admin, mine.id), "running");
});

test("Import and export file format: Round trip, Scheduled trigger in an imported file, and Oversized file", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Round trip", (start) => [[node(start, "wait", "pause", { position: { x: 640, y: 320 } }), edge("e1", "start", "pause")]]);
  await admin.call("jagentchill.workflow.trigger.set", { workflowId: doc.id, schedule: { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-05" }, enabled: true });
  const exported = await admin.call("jagentchill.workflow.export", { workflowId: doc.id });
  assert.equal(exported.fileName, "Round trip.jcworkflow");
  const file = JSON.parse(exported.text);
  assert.equal(file.format, "jagentchill.workflow.file");
  assert.equal(file.workflow.meta.createdByDeviceId, undefined);
  assert.deepEqual(file.workflow.nodes[0].config.sources, [{ kind: "manual", enabled: true }, { kind: "schedule", enabled: true }]);
  const imported = (await admin.call("jagentchill.workflow.import", { text: exported.text })).document as WorkflowDocument;
  assert.notEqual(imported.id, doc.id);
  assert.equal(imported.name, "Round trip (2)");
  assert.equal(imported.meta.origin, "import");
  assert.deepEqual(imported.nodes.map((entry) => entry.position), file.workflow.nodes.map((entry: { position: unknown }) => entry.position));
  // The schedule source is there and off, and no automation was created for the copy.
  assert.deepEqual(imported.nodes[0].config.sources, [{ kind: "manual", enabled: true }, { kind: "schedule", enabled: false }]);
  assert.equal((await admin.call("jagentchill.automation.list")).automations.length, 1);
  const manual = (sources: unknown) => JSON.stringify((sources as Array<{ kind: string }>).filter((source) => source.kind === "manual"));
  assert.equal(manual(imported.nodes[0].config.sources), manual(doc.nodes[0].config.sources));
  // A frame of the channel carries 1 MiB; the 4 MiB limit of a file is the document service's own.
  assert.throws(() => h.app.workflows.docs.importFile(`{"format":"jagentchill.workflow.file","pad":"${"x".repeat(4 * 1024 * 1024 + 10)}"}`, { kind: "device" }), (error: { code: string }) => error.code === "PAYLOAD_TOO_LARGE");
  assert.equal((await admin.fail("jagentchill.workflow.import", { text: "{\"format\":\"something\"}" })).code, "WORKFLOW_SCHEMA_INVALID");
  assert.equal((await admin.call("jagentchill.workflow.list")).workflows.length, 2);
  // A copy never fires by itself.
  const copy = (await admin.call("jagentchill.workflow.duplicate", { workflowId: doc.id })).document as WorkflowDocument;
  assert.equal(copy.name, "Round trip (copy)");
  assert.deepEqual(copy.nodes[0].config.sources, [{ kind: "manual", enabled: true }]);
});

test("Storage, RPC surface: Deleted workflow — its runs stay listed, its trigger record is gone", async () => {
  const { admin } = await setup();
  const doc = await build(admin, "Gone", waitFlow());
  await admin.call("jagentchill.workflow.trigger.set", { workflowId: doc.id, schedule: { rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-05" }, enabled: true });
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await admin.call("jagentchill.workflow.delete", { workflowId: doc.id });
  assert.deepEqual((await admin.call("jagentchill.workflow.list")).workflows, []);
  assert.equal((await admin.fail("jagentchill.workflow.get", { workflowId: doc.id })).code, "NOT_FOUND");
  assert.deepEqual((await admin.call("jagentchill.automation.list")).automations, []);
  const view = await admin.call("jagentchill.workflow.run.get", { runId: run.id });
  assert.equal(view.workflowExists, false);
  assert.equal(view.run.workflowName, "Gone");
});

test("Workflows: the agent panel's sessions are bound to their workflow", async () => {
  const { h, admin } = await setup();
  const other = await h.pair("Laptop", "editor");
  const doc = await build(admin, "Bound", waitFlow());
  const { session } = await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } });
  await admin.call("jagentchill.workflow.session.bind", { workflowId: doc.id, sessionKey: session.sessionKey });
  assert.deepEqual((await admin.call("jagentchill.workflow.session.list", { workflowId: doc.id })).sessionKeys, [session.sessionKey]);
  // A private session of another device is not disclosed.
  assert.deepEqual((await other.call("jagentchill.workflow.session.list", { workflowId: doc.id })).sessionKeys, []);
  assert.equal((await other.fail("jagentchill.workflow.session.bind", { workflowId: doc.id, sessionKey: session.sessionKey })).code, "NOT_FOUND");
});

test("Budgets during a run: Confirmed-estimate guard across a restart — a step that failed beside the held one while the run was paused still fails the run when a person confirms after the host restarted; the held step is not paid for", async () => {
  const { h, admin, clock } = await setup();
  const doc = await build(admin, "Guard", (start) => [[node(start, "tool", "paid", { config: { tool: "t_paid", args: {} } }), node(start, "tool", "other", { config: { tool: "t_other", args: {} } }), edge("e1", "start", "paid"), edge("e2", "start", "other")]]);
  const calls: string[] = [];
  let failOther: (error: unknown) => void = () => undefined;
  const tools = new Map<string, StepTool>([
    ["t_paid", async () => { calls.push("paid"); throw Object.assign(new Error("This video would pass the $1.00 you confirmed."), { code: "BUDGET_EXCEEDED", details: { reason: "confirmation_required", scope: "confirmed_estimate", confirmedUsd: 1, limitUsd: 1.2, spentUsd: 1.1, estimate: { amountUsd: 1.6 } } }); }],
    ["t_other", () => { calls.push("other"); return new Promise((_resolve, reject) => { failOther = reject; }); }],
  ]);
  const service = () => createWorkflowService({ db: h.app.db, now: () => clock.now, devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, sweepMs: 0, stepTools: () => tools });
  const first = service();
  const run = first.runs.start({ workflowId: doc.id, origin: "user", originRef: { deviceId: admin.device.deviceId }, startedByDeviceId: admin.device.deviceId, attended: true });
  await until(() => first.runs.record(run.id).status === "paused" && calls.includes("other"), "the run to pause at the guard");
  // The snapshot names the held step with the refusal and its new figure: what the run view asks the person to confirm.
  const snapshot = first.runs.get(run.id);
  assert.deepEqual(snapshot.held.map((exec) => [exec.nodeId, exec.blockedBy, exec.error?.code, (exec.error?.details as { estimate: { amountUsd: number } }).estimate.amountUsd]), [["paid", "budget_exceeded", "BUDGET_EXCEEDED", 1.6]]);
  failOther(Object.assign(new Error("The provider refused the request."), { code: "PROVIDER_ERROR" }));
  await until(() => first.runs.executions(run.id, { nodeId: "other" })[0].status === "failed", "the other step to fail");
  assert.deepEqual([first.runs.record(run.id).status, first.runs.record(run.id).pauseReason], ["paused", "budget_exceeded"]);
  // The host restarts: the store is all that is left.
  first.close();
  const next = service();
  assert.deepEqual([next.runs.record(run.id).status, next.runs.record(run.id).pauseReason], ["paused", "budget_exceeded"]);
  next.runs.resume(run.id, admin.device.deviceId);
  await tick(50);
  const ended = next.runs.record(run.id);
  assert.deepEqual([ended.status, ended.error?.code, ended.failedNodeId], ["failed", "PROVIDER_ERROR", "other"]);
  assert.deepEqual([...calls].sort(), ["other", "paid"], "the held step was not dispatched again");
  next.close();
});

test("Run view: the snapshot of a run names the session of an agent step while the step is at work, and the run's stream announces it then", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Sessions", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "Hello", runtime: ACME } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the turn");
  const turn = h.fake.callsOf("startTurn")[0];
  // The turn has not ended: a tool permission it asks for is shown in the run view through this session.
  assert.deepEqual((await admin.call("jagentchill.workflow.run.get", { runId: run.id })).sessions, [{ nodeId: "writer", path: "", sessionKey: turn.sessionKey, active: true }]);
  const timeline = (await admin.call("jagentchill.workflow.run.timeline", { runId: run.id })).entries as Array<{ change: { kind: string; nodeId?: string; status?: string } }>;
  assert.equal(timeline.filter((entry) => entry.change.kind === "node.status" && entry.change.nodeId === "writer" && entry.change.status === "running").length, 2, "running, then running with its session");
  answer(h, turn.sessionKey, "Hello.");
  await until(async () => (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run.status === "succeeded", "the run to end");
  // The step ended; what its session asked may still be open, so it stays named — as a step that is no longer at work.
  assert.deepEqual((await admin.call("jagentchill.workflow.run.get", { runId: run.id })).sessions, [{ nodeId: "writer", path: "", sessionKey: turn.sessionKey, active: false }]);
});

test("A terminal workflow run expires unanswered questions in each step session", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Question cleanup", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "Hello", runtime: ACME } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the workflow turn");
  const turn = h.fake.callsOf("startTurn")[0];
  const session = (await admin.call("jagentchill.session.get", { sessionKey: turn.sessionKey })).session;
  h.app.tools.requests.askForRuntime(session, "pending-runtime-question", [{ id: "format", text: "Which format?", kind: "single", options: [{ label: "Wide" }, { label: "Square" }] }], Date.now() + 60_000);
  assert.equal((await admin.call("jagentchill.chat.question.list", { sessionKey: turn.sessionKey })).questions[0].state, "pending");
  answer(h, turn.sessionKey, "I chose wide format.");
  await until(async () => (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run.status === "succeeded", "the workflow to finish");
  const questions = (await admin.call("jagentchill.chat.question.list", { sessionKey: turn.sessionKey })).questions;
  assert.deepEqual(questions.map((question: { state: string; answers: unknown[] }) => [question.state, question.answers]), [["expired", [{ id: "format", skipped: true }]]]);
});

test("A three-step workflow keeps its three sessions attached to the run and filters them from Sessions by default", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Three steps", (start) => [[
    node(start, "agent", "first", { config: { promptTemplate: "First", runtime: ACME } }),
    node(start, "agent", "second", { config: { promptTemplate: "Second", runtime: ACME } }),
    node(start, "agent", "third", { config: { promptTemplate: "Third", runtime: ACME } }),
    edge("e1", "start", "first"), edge("e2", "first", "second"), edge("e3", "second", "third"),
  ]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  const keys: string[] = [];
  for (let index = 0; index < 3; index++) {
    await until(() => h.fake.callsOf("startTurn").length === index + 1, `step ${index + 1}`);
    const turn = h.fake.callsOf("startTurn")[index];
    keys.push(turn.sessionKey);
    const session = h.app.relay.session(turn.sessionKey)!;
    assert.deepEqual([session.origin, session.toolSurface], ["workflow", "workflow-run"]);
    const questionAttempt = (await h.app.tools.call(turn.sessionKey, "jc_session_ask", { questions: [{ id: "choice", text: "Which format?", kind: "single", options: [{ label: "Wide" }, { label: "Square" }] }] })).envelope;
    assert.equal(questionAttempt.ok, false);
    assert.equal((await admin.call("jagentchill.chat.question.list", { sessionKey: turn.sessionKey })).questions.length, 0);
    answer(h, turn.sessionKey, `Done ${index + 1}`);
  }
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the three-step run");
  const defaults = (await admin.call("jagentchill.session.list", {})).sessions as Array<{ sessionKey: string }>;
  const all = (await admin.call("jagentchill.session.list", { includeWorkflowRuns: true })).sessions as Array<{ sessionKey: string; origin: string }>;
  assert.equal(keys.filter((key) => defaults.some((session) => session.sessionKey === key)).length, 0);
  assert.deepEqual(all.filter((session) => keys.includes(session.sessionKey)).map((session) => session.origin), ["workflow", "workflow", "workflow"]);
  const view = await admin.call("jagentchill.workflow.run.get", { runId: run.id });
  assert.deepEqual(view.sessions.map((entry: { sessionKey: string }) => entry.sessionKey), keys);
});

test("Run view: a step's session that still waits for a permission answer is named in the run's snapshot however many steps ended after it — the history limit of 20 ended sessions never hides an open question", async () => {
  const { h, admin, clock } = await setup();
  const COUNT = 22;
  const ids = Array.from({ length: COUNT }, (_value, index) => `a${String(index + 1).padStart(2, "0")}`);
  const doc = await build(admin, "Many steps", (start) => [[...ids.map((id) => node(start, "agent", id, { config: { promptTemplate: `Step ${id}`, runtime: ACME } })), ...ids.map((id, index) => edge(`e${index}`, index ? ids[index - 1] : "start", id))]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  let first = "";
  for (let index = 0; index < COUNT; index++) {
    await until(() => h.fake.callsOf("startTurn").length === index + 1, `turn ${index + 1}`);
    const turn = h.fake.callsOf("startTurn")[index];
    // The first step's agent asks to do something that needs the person's leave, and ends its turn as it is told to.
    if (index === 0) {
      first = turn.sessionKey;
      const asked = (await h.app.tools.call(first, "jc_workflow_create", { name: "Night cut", idempotencyKey: "w2l3-pending-0123456789abcdef" })).envelope as { ok: boolean; error?: { code: string } };
      assert.equal(asked.error?.code, "APPROVAL_PENDING");
    }
    clock.now += 1000;
    answer(h, turn.sessionKey, `Done ${index + 1}.`);
  }
  await until(async () => (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run.status === "succeeded", "the run to end");
  const named = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).sessions as Array<{ nodeId: string; sessionKey: string; active: boolean }>;
  // 21 steps ended after the first one: it is beyond the 20 latest, and it is still named because its question is open.
  assert.equal(named.length, 21);
  assert.deepEqual(named.filter((entry) => entry.sessionKey === first), [{ nodeId: "a01", path: "", sessionKey: first, active: false }]);
  assert.equal(named.some((entry) => entry.nodeId === "a02"), false, "a step beyond the limit with nothing open is not named");
  // Once answered it is history like the rest.
  const [request] = (await admin.call("jagentchill.chat.approval.list", { sessionKey: first })).requests as Array<{ requestId: string; state: string }>;
  assert.equal(request.state, "pending");
  await admin.call("jagentchill.chat.approval.resolve", { requestId: request.requestId, decision: "deny" });
  const after = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).sessions as Array<{ sessionKey: string }>;
  assert.deepEqual([after.length, after.some((entry) => entry.sessionKey === first)], [20, false]);
});

test("Agent node: a failed turn keeps the runtime's error code — the step's error carries it as details.turnCode beside the sentence, so a caller tells failures apart by the code", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Codes", (start) => [[node(start, "agent", "writer", { config: { promptTemplate: "Hello", runtime: ACME } }), edge("e1", "start", "writer")]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the turn");
  const sessionKey = h.fake.callsOf("startTurn")[0].sessionKey as string;
  // What the session service tells its subscribers about the failed turn: the code the step must carry.
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  h.fake.endTurn(sessionKey, undefined, "error", "429 rate limit exceeded, retry after 20s");
  await until(async () => (await statusOf(admin, run.id)) === "failed", "the run to fail");
  await until(() => admin.events.some((entry) => entry.event === "jagentchill.chat.error" && entry.payload.sessionKey === sessionKey), "the session's error event");
  const code = admin.events.find((entry) => entry.event === "jagentchill.chat.error" && entry.payload.sessionKey === sessionKey)!.payload.error.code as string;
  assert.equal(code, "runtime/rate-limited");
  const failed = (await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "writer" })).executions[0];
  assert.deepEqual([failed.error.code, failed.error.details?.turnCode], ["WORKFLOW_RUNTIME_UNAVAILABLE", code]);
});

// — the money question of a run a person starts —
type Price = { inputPerMillionUsd: number; outputPerMillionUsd: number; source: "admin" };
const ACME_REF = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
/** What the test host has MEASURED and what is DOCUMENTED of opus (ruling R10): a first request to it carried 10,000 tokens, and its longest answer is 2,000 tokens. */
const MEASURED_PROMPT = 10_000, MAX_OUTPUT = 2_000;
/**
 * A turn on opus at $3 a million in, $15 out, by ruling R10 — written out so every amount below can be checked
 * by hand: (prompt tokens measured + the BYTES of the message) × $3 + 2,000 × $15, per million, never rounded down.
 * With the seed: (10,000 + bytes) × 3 + 30,000 millionths of a dollar.
 */
const boundUsd = (message: string, promptTokens = MEASURED_PROMPT): number => ((promptTokens + Buffer.byteLength(message, "utf8")) * 3 + MAX_OUTPUT * 15) / 1e6;
/**
 * A host whose chat models have the price the test sets (haiku: none). Ruling R10: the price of a turn is worked
 * out from the model's MEASURED prompt size on this host and its documented maximum output — both are seeded here for
 * opus (`h.measured`: the Usage row of a first turn of 10,000 tokens; `modelMaxOutput`: 2,000). The context
 * window (200,000, as a real model has) is in the catalogue and is NOT read for a price any more.
 */
async function moneySetup(options: { /** false: opus has not run on this host yet (nothing measured). */ measured?: boolean; /** Seed haiku's price and measurement to isolate its missing output limit. */ smallPriced?: boolean; smallMeasured?: boolean } = {}) {
  const prices: { large: Price | undefined; small?: Price } = { large: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, source: "admin" }, ...(options.smallPriced ? { small: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, source: "admin" as const } } : {}) };
  // Claude Code's models (and one more, haiku), each with the context window a real model has.
  const models = { ...SAMPLE_MODELS, "claude-code": [...SAMPLE_MODELS["claude-code"]!, runtimeModel("haiku")].map((entry) => ({ ...entry, contextWindow: 200_000 })) };
  const skew = { ms: 0 };
  const h = await createHarness({ now: () => Date.now() + skew.ms, models, extra: { modelPrice: (ref: { modelId: string }) => (ref.modelId === "opus" ? prices.large : ref.modelId === "haiku" ? prices.small : undefined), modelMaxOutput: (ref: { modelId: string }) => (ref.modelId === "opus" ? MAX_OUTPUT : undefined) } });
  open.push(h);
  // Claude Code is signed in with an API KEY: its turns are billed per call at the model's price (ruling R9). The host
  // read the sign-in when it started: its clock is moved past the time a reading holds, the new reading is waited for,
  // and the clock is put back (a reading taken "in the future" stays fresh; devices sign with the true time).
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  skew.ms += LOGIN_STALE_MS + 1;
  const billing = () => h.app.generation.gate.billingOf({ ref: ACME_REF });
  for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
  skew.ms = 0;
  assert.equal(billing(), "per_call", "Claude Code is billed per call");
  const admin = await h.pair("Studio Mac", "admin");
  if (options.measured !== false) h.measured(ACME_REF, MEASURED_PROMPT);
  if (options.smallMeasured) h.measured({ runtimeId: "claude-code", providerId: "anthropic", modelId: "haiku" }, MEASURED_PROMPT);
  const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>;
  /** The runtime ends turn `index` with an answer and the usage it reports (input tokens at $3 per million, output tokens at $15). */
  const answer = async (index: number, inputTokens: number, text = `Answer ${index + 1}.`, outputTokens = 0) => {
    await until(() => sends().length >= index + 1, `turn ${index + 1}`);
    const { sessionKey } = sends()[index];
    h.fake.usage(sessionKey, { inputTokens, outputTokens });
    answerTurn(h, sessionKey, text);
  };
  const gate = h.app.generation.gate;
  const twoWriters = (model: Record<string, string> = ACME) => build(admin, "Two writers", (start) => [
    [{ op: "param.set", parameters: [{ name: "topic", label: "Topic", type: "text", required: true, help: "", secret: false }] }],
    [node(start, "agent", "writer", { name: "Writer", config: { promptTemplate: "Write one line about {{params.topic}}", runtime: model } }), node(start, "agent", "editor", { name: "Editor", config: { promptTemplate: "Polish: {{inputs.input}}", runtime: model } })],
    [edge("e1", "start", "writer"), edge("e2", "writer.text", "editor.input")],
  ]);
  return { h, admin, prices, sends, answer, gate, twoWriters };
}
type Estimate = { estimate: { canSpend: boolean; highUsd: number; unpricedModels: string[]; steps: Array<{ nodeId: string; model: string; calls: number; unitUsd: number | null; highUsd: number | null; measured?: true }> }; confirmation: { needed: boolean; amountUsd: number; stopsAtUsd: number; unpricedModels: string[] } };

test("Cost estimate: a workflow routed to no model says it cannot run, even though its known cost is zero", async () => {
  const { admin } = await moneySetup();
  const doc = await build(admin, "Unrouted director", (start) => [[
    node(start, "agent", "writer", { name: "Writer", config: { promptTemplate: "Write a line.", runtime: { mode: "orc", role: "director" } } }),
    edge("e1", "start", "writer"),
  ]]);
  const answer = await admin.call("jagentchill.workflow.run.estimate", { workflowId: doc.id });
  assert.deepEqual([answer.estimate.highUsd, answer.confirmation.needed, answer.estimate.assumptions], [0, false, ["Cannot run: no model for director"]]);
});

test("Cost and time estimate before a run: An interactive run starts only after the user confirms the estimate — a run with steps that can spend is refused with its estimate until the person's answer covers it, nothing is sent before; the answer is on record where every turn is checked; a turn's cost is charged to it; a step that would pass what was confirmed is not sent until a person confirms a new amount", async () => {
  const { h, admin, sends, answer, gate, twoWriters } = await moneySetup();
  const doc = await twoWriters();
  const asked: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: doc.id, params: { topic: "lanterns" } });
  const [writer, editor] = asked.estimate.steps;
  assert.deepEqual([asked.estimate.canSpend, asked.estimate.steps.map((step) => [step.nodeId, step.model, step.calls]), asked.estimate.unpricedModels, asked.confirmation.needed], [true, [["writer", "opus", 1], ["editor", "opus", 1]], [], true]);
  // RE-DERIVED on ruling R10 (was: the model's whole window going in, the same for both steps). Each step is a first
  // turn of a session of its own on opus: measured prompt 10,000 tokens + the bytes of its message, and 2,000 out.
  //   Writer — "Write one line about lanterns" is 29 bytes: (10,000 + 29) × $3 + 2,000 × $15 = 30,087 + 30,000 = 60,087 millionths = $0.060087.
  //   Editor — "Polish: {{inputs.input}}" as far as it is written before the run (the other step's answer is not known
  //            yet) is 24 bytes: (10,000 + 24) × $3 + 30,000 = 30,072 + 30,000 = 60,072 millionths = $0.060072.
  // Both are marked as worked out from a measurement (a screen says "about"); the window of 200,000 is not in either.
  assert.deepEqual([writer.unitUsd, editor.unitUsd, writer.measured, editor.measured], [0.060087, 0.060072, true, true], JSON.stringify(asked.estimate.steps));
  assert.deepEqual([writer.unitUsd, editor.unitUsd], [boundUsd("Write one line about lanterns"), boundUsd("Polish: {{inputs.input}}")]);
  // The run: $0.060087 + $0.060072 = $0.120159; it stops at 120 %: $0.120159 × 1.2 = $0.1441908 → $0.144191.
  assert.equal(asked.estimate.highUsd, 0.120159);
  assert.equal(asked.estimate.highUsd, Math.round((writer.highUsd! + editor.highUsd!) * 1e6) / 1e6);
  assert.deepEqual([asked.confirmation.amountUsd, asked.confirmation.stopsAtUsd], [0.120159, 0.144191]);
  assert.deepEqual([asked.confirmation.amountUsd, asked.confirmation.stopsAtUsd], [asked.estimate.highUsd, Math.round(asked.estimate.highUsd * 1.2 * 1e6) / 1e6]);
  // Started without an answer, or with an amount below the estimate: refused with the question, nothing started, nothing sent.
  for (const answerGiven of [{}, { confirmedUsd: Math.round((asked.estimate.highUsd - 0.01) * 1e6) / 1e6 }, { confirmed: true }]) {
    const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: doc.id, params: { topic: "lanterns" }, ...answerGiven });
    assert.deepEqual([refused.code, refused.message, refused.details.reason, refused.details.estimate.highUsd, refused.details.confirmWith], ["PERMISSION_DENIED", "Confirm the cost of this run first.", "confirmation_required", asked.estimate.highUsd, { confirmedUsd: asked.estimate.highUsd }]);
  }
  await tick(50);
  assert.deepEqual([(await admin.call("jagentchill.workflow.run.list", {})).runs.length, sends().length], [0, 0]);
  // The person's one answer: the run starts, and what it is held to is on record at the paid-call gate.
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id, params: { topic: "lanterns" }, confirmedUsd: asked.estimate.highUsd });
  const held = gate.action(`run:${run.id}`)!;
  assert.deepEqual([held.authority, held.approved?.amountUsd, held.limitUsd, held.spentUsd], ["person", asked.estimate.highUsd, asked.confirmation.stopsAtUsd, 0]);
  // While the first turn is out: what it is worked out to cost is held against the run's amount — with the model's
  // documented longest answer, since no output limit can go with a message (an agent CLI takes none with a turn, and is sent none).
  // The estimate includes the unattended instruction prefix sent with the configured prompt.
  await until(() => sends().length === 1, "the first turn");
    assertWorkflowMessage(sends()[0].message, "Write one line about lanterns");
  assert.deepEqual(Object.keys(sends()[0]).filter((key) => /max|limit|token/i.test(key)), []);
  assert.deepEqual((h.app.db.prepare("SELECT usd FROM gen_reservations WHERE action_id = ?").all(`run:${run.id}`) as Array<{ usd: number }>).map((row) => row.usd), [0.060594]);
  assert.equal((await admin.fail("jagentchill.chat.send", { sessionKey: sends()[0].sessionKey, message: "more", maxOutputTokens: 100 })).code, "INVALID_PARAMS", "a limit the host cannot enforce is not accepted as if it could");
  // The first turn costs far more than anyone expected (300,000 tokens in: 300,000 × $3 a million = $0.90 — above the stop of $0.144191).
  await answer(0, 300_000, "Lanterns drift over the river.");
  await until(async () => (await statusOf(admin, run.id)) === "paused", "the run to stop before the second step");
  assert.equal(gate.action(`run:${run.id}`)!.spentUsd, 0.9, "the turn's cost reached the run's record");
  // (That turn is now also what a first request to opus was measured to carry on this host — 300,000 tokens: the
  // editor's turn, "Polish: Lanterns drift over the river." = 38 bytes, is worked out at (300,000 + 38) × $3 + 30,000 =
  // 930,114 millionths = $0.930114. With the $0.90 spent that is $1.830114 — the figure the run asks its person for.)
  assert.equal(boundUsd("Polish: Lanterns drift over the river.", 300_000), 0.930114);
  const stopped = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run;
  const { executions } = await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "editor" });
  assert.deepEqual([stopped.pauseReason, executions[0].error.code, executions[0].error.details.scope, executions[0].error.details.reason, sends().length], ["budget_exceeded", "BUDGET_EXCEEDED", "confirmed_estimate", "confirmation_required", 1]);
  assert.match(executions[0].error.message, /with it this run could cost \$1\.83, more than its spending limit of \$0\.14\. \$0\.90 is spent so far\./, executions[0].error.message);
  // Resume changes nothing; an amount below what was confirmed is no answer; a new amount that covers the rest is.
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id }).catch(() => undefined);
  await tick(100);
  assert.equal(sends().length, 1, "a Resume with nothing confirmed sends nothing");
  assert.equal((await admin.fail("jagentchill.workflow.run.confirm", { runId: run.id, confirmedUsd: 0.1 })).code, "INVALID_PARAMS");
  const editorDevice = await h.pair("Guest", "viewer");
  assert.equal((await editorDevice.fail("jagentchill.workflow.run.confirm", { runId: run.id, confirmedUsd: 5 })).code, "SCOPE_DENIED");
  // $5 confirmed (it stops at $6): $0.90 spent + $0.930114 for the editor's turn fits. That turn then costs 1,000 tokens in: $0.003 — $0.903 in all.
  await admin.call("jagentchill.workflow.run.confirm", { runId: run.id, confirmedUsd: 5 });
  await answer(1, 1_000, "Lanterns drift, slow.");
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the run to end");
  assert.deepEqual([sends().length, gate.action(`run:${run.id}`)!.approved?.amountUsd, gate.action(`run:${run.id}`)!.spentUsd], [2, 5, 0.903]);
  assert.deepEqual(h.audit("workflow.run.start").map((row: any) => [row.confirmedUsd, row.asked]), [[asked.estimate.highUsd, true]]);
});

test("Cost and time estimate before a run: a run with no step that can spend starts with NO question and has nothing on record to pay with; a loop multiplies its steps; a model without a price is named and allowed only by name; within the host's \"Ask before spending more than\" nobody is asked and the run is still held to its estimate; a run nobody confirmed sends nothing that costs", async () => {
  const { h, admin, prices, sends, answer, gate, twoWriters } = await moneySetup();
  // Nothing that spends: a wait and a notice.
  const free = await build(admin, "Reminder", (start) => [[node(start, "wait", "pause", { config: { mode: "duration", seconds: 3600 } }), node(start, "notify", "tell")], [edge("e1", "start", "pause"), edge("e2", "pause", "tell")]]);
  const none: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: free.id });
  assert.deepEqual([none.estimate.canSpend, none.estimate.steps, none.estimate.highUsd, none.confirmation.needed], [false, [], 0, false]);
  const { run: quiet } = await admin.call("jagentchill.workflow.run.create", { workflowId: free.id });
  assert.deepEqual([await statusOf(admin, quiet.id), gate.action(`run:${quiet.id}`)], ["running", undefined]);
  assert.deepEqual(h.audit("workflow.run.start").map((row: any) => [row.runId, row.asked]), [[quiet.id, undefined]]);
  // A step inside a loop of three counts three times.
  const looped = await build(admin, "Three drafts", (start) => [
    [node(start, "loop", "again", { config: { maxIterations: 3, continueWhile: { all: [{ left: "loop.iteration", op: "lt", right: 3 }] } }, inputs: [{ id: "initial", label: "initial", type: "any", default: "first" }, { id: "next", label: "next", type: "any" }] }), node(start, "agent", "draft", { config: { promptTemplate: "Draft a line.", runtime: ACME } })],
    [edge("e1", "start", "again"), edge("e2", "again.body", "draft.input"), { op: "edge.add", edge: { id: "e3", kind: "loop_back", from: { node: "draft", port: "text" }, to: { node: "again", port: "next" } } }],
  ]);
  const three: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: looped.id });
  // RE-DERIVED on R10: "Draft a line." is 13 bytes — (10,000 + 13) × $3 + 30,000 = 60,039 millionths = $0.060039 a turn; three of them $0.180117.
  assert.deepEqual([three.estimate.steps.map((step) => [step.nodeId, step.calls, step.unitUsd]), three.estimate.highUsd], [[["draft", 3, 0.060039]], 0.180117]);
  assert.deepEqual([three.estimate.steps.map((step) => [step.nodeId, step.calls]), three.estimate.highUsd], [[["draft", 3]], Math.round(three.estimate.steps[0].unitUsd! * 3 * 1e6) / 1e6]);
  // A model whose price is not known: named, never inside the amount, and the run starts only when the person allowed it by name.
  const SMALL = { mode: "override", runtime: "claude-code", provider: "anthropic", model: "haiku" };
  const unknown = await twoWriters(SMALL);
  const named: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: unknown.id, params: { topic: "kites" } });
  assert.deepEqual([named.estimate.unpricedModels, named.estimate.highUsd, named.confirmation.needed, named.estimate.steps.map((step) => step.unitUsd)], [["haiku"], 0, true, [null, null]]);
  const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: unknown.id, params: { topic: "kites" }, confirmedUsd: 100 });
  assert.deepEqual([refused.details.reason, refused.details.confirmWith], ["confirmation_required", { confirmedUsd: 0, allowUnpriced: ["haiku"] }]);
  assert.equal((await admin.fail("jagentchill.workflow.run.create", { workflowId: unknown.id, params: { topic: "kites" }, confirmedUsd: 0, allowUnpriced: ["another-model"] })).details.reason, "confirmation_required");
  const { run: allowed } = await admin.call("jagentchill.workflow.run.create", { workflowId: unknown.id, params: { topic: "kites" }, ...refused.details.confirmWith, confirmed: true });
  assert.deepEqual(gate.action(`run:${allowed.id}`)!.approved?.unpriced, ["haiku"]);
  await answer(0, 0, "Kites over the sea.");
  await answer(1, 0, "Kites, high over the sea.");
  await until(async () => (await statusOf(admin, allowed.id)) === "succeeded", "the run on the unpriced model to end");
  // The host's admin set "Ask before spending more than $5": a run estimated below it starts with no question — and is
  // still held to its estimate, so it cannot spend without end.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 5 } });
  const doc = await twoWriters();
  const within: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: doc.id, params: { topic: "lanterns" } });
  // RE-DERIVED on R10 (the two writers of the first test): $0.060087 + $0.060072 = $0.120159, under the $5 — nobody is asked; held to it, it stops at $0.144191.
  assert.deepEqual([within.confirmation.needed, within.estimate.highUsd, within.confirmation.stopsAtUsd], [false, 0.120159, 0.144191]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id, params: { topic: "lanterns" } });
  assert.deepEqual([gate.action(`run:${run.id}`)!.approved?.amountUsd, gate.action(`run:${run.id}`)!.limitUsd], [within.estimate.highUsd, within.confirmation.stopsAtUsd]);
  // Its first turn costs 400,000 tokens in: $1.20 — far past the stop.
  await answer(2, 400_000, "Lanterns.");
  await until(async () => (await statusOf(admin, run.id)) === "paused", "the run to stop at 120 % of its estimate");
  assert.equal(sends().length, 3, "the second step was not sent");
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
  // A run that reaches the engine with nothing confirmed (no screen starts one; the engine does not rely on that):
  // with the host asking about every amount again, its paid turn is not sent.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const bare = h.app.workflows.runs.start({ workflowId: doc.id, params: { topic: "lanterns" }, origin: "user", originRef: { deviceId: admin.device.deviceId }, startedByDeviceId: admin.device.deviceId, attended: true });
  await until(async () => (await statusOf(admin, bare.id)) === "paused", "the unconfirmed run to wait for a person");
  const { executions } = await admin.call("jagentchill.workflow.run.executions", { runId: bare.id, nodeId: "writer" });
  assert.deepEqual([executions[0].error.code, executions[0].error.details.reason, sends().length], ["BUDGET_EXCEEDED", "confirmation_required", 3]);
  // … and goes on once a person confirms an amount for it. RE-DERIVED on R10: what a first request to opus
  // carries on this host is now measured at 400,000 tokens (the turn above), so the same workflow is quoted from that:
  //   Writer (400,000 + 29) × $3 + 30,000 = 1,230,087 millionths = $1.230087; Editor (400,000 + 24) × $3 + 30,000 = $1.230072; the run $2.460159.
  // That is the amount the person confirms (the $0.120159 of before would not hold the first turn any more).
  const now: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: doc.id, params: { topic: "lanterns" } });
  assert.deepEqual([now.estimate.steps.map((step) => step.unitUsd), now.estimate.highUsd], [[1.230087, 1.230072], 2.460159]);
  await admin.call("jagentchill.workflow.run.confirm", { runId: bare.id, confirmedUsd: now.estimate.highUsd });
  await until(() => sends().length === 4, "the confirmed run's first turn");
  prices.large = undefined;
});

test("Hand-off package between agents: Synthesised package and Structured hand-off on a real run — an agent step's result is stored as a package flagged synthesised, and the step connected to its hand-off receives it in its prompt as one delimited block naming the source step: the summary and the deliverable, none of the producer's own messages", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Script to board", (start) => [
    [node(start, "agent", "screenwriter", { name: "Screenwriter", config: { promptTemplate: "Write a script about lanterns.", instructions: "SECRET-INSTRUCTION: be brief.", runtime: ACME } }), node(start, "agent", "storyboard", { name: "Storyboard", config: { promptTemplate: "Draw the board.", runtime: ACME } })],
    [edge("e1", "start", "screenwriter"), edge("e2", "screenwriter.handoff", "storyboard.handoff")],
  ]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the first turn");
  const first = h.fake.callsOf("startTurn")[0];
  answer(h, first.sessionKey, [{ type: "thinking", thinking: "PRIVATE-REASONING" }, { type: "text", text: "Scene 1: lanterns drift over the river." }]);
  await until(() => h.fake.callsOf("startTurn").length === 2, "the second turn");
  const second = h.fake.callsOf("startTurn")[1];
  // (run 6, item 2) The other step's text enters the prompt only inside the product's untrusted-data block, after the line that says what the marks mean.
  assertWorkflowMessage(second.message, `Draw the board.\n\n${wf.HANDOFF_NOTICE}\n\nHand-off from the step "Screenwriter" (put together by the workflow from that step's result):\n<<<untrusted-data {"untrusted":true,"source":"hand-off from the step \\"Screenwriter\\"","value":{"summary":"Scene 1: lanterns drift over the river.","deliverables":[{"name":"text","type":"text","value":"Scene 1: lanterns drift over the river."}]}} untrusted-data>>>`);
  assert.deepEqual([second.message.includes("SECRET-INSTRUCTION"), second.message.includes("PRIVATE-REASONING"), second.message.includes("Write a script")], [false, false, false]);
  answer(h, second.sessionKey, "Board: three frames.");
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the run to succeed");
  // Persisted with the step (its panel shows it under "Hand-off"), and what the next step consumed.
  const made = (await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "screenwriter" })).executions[0].outputs.handoff;
  assert.deepEqual([made.synthesised, made.summary, made.deliverables, made.from.nodeId, made.from.agentId, made.from.provider, made.from.model, made.decisions, made.uncertainties, made.openQuestions], [true, "Scene 1: lanterns drift over the river.", [{ name: "text", type: "text", value: "Scene 1: lanterns drift over the river." }], "screenwriter", first.sessionKey, "anthropic", "opus", [], [], []]);
  const board = (await admin.call("jagentchill.workflow.run.executions", { runId: run.id, nodeId: "storyboard" })).executions[0];
  assert.deepEqual([board.inputs.handoff.length, board.inputs.handoff[0].summary, board.outputs.handoff.from.nodeId], [1, made.summary, "storyboard"]);
});

// (Added by the film-engine piece, run 14 — coordinator's ruling R9.)
test("Hand-off package between agents: Oversized package on a real run — a deliverable too large to travel reaches the next agent as a reference its own session can read IN FULL: jc_workflow_status with `output` (step, execution path, port) answers the stored value alone, page by page, and the pages put together are exactly the 90 KiB the step wrote", async () => {
  const { h, admin } = await setup();
  const doc = await build(admin, "Long script to board", (start) => [
    [node(start, "agent", "screenwriter", { name: "Screenwriter", config: { promptTemplate: "Write a long script.", runtime: ACME } }), node(start, "agent", "storyboard", { name: "Storyboard", config: { promptTemplate: "Draw the board.", runtime: ACME } })],
    [edge("e1", "start", "screenwriter"), edge("e2", "screenwriter.handoff", "storyboard.handoff")],
  ]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: doc.id });
  await until(() => h.fake.callsOf("startTurn").length === 1, "the first turn");
  const first = h.fake.callsOf("startTurn")[0];
  // 90 KiB that no cut could fake: numbered lines, with a quote, a line break and a two-unit character in each.
  let big = "";
  for (let line = 0; big.length < 90 * 1024; line++) big += `Line ${line}: "lanterns" 🏮 drift over the river.\n`;
  answer(h, first.sessionKey, big);
  await until(() => h.fake.callsOf("startTurn").length === 2, "the second turn");
  const second = h.fake.callsOf("startTurn")[1];
  assert.equal(second.message.includes("Line 900:"), false, "the 90 KiB did not travel in the prompt");
  const told = /Too large to travel with it, kept with the run: text \(text\) — read all of it, a page at a time, with jc_workflow_status (\{.*?\}\}) \(then again/.exec(second.message);
  assert.ok(told, second.message.slice(-600));
  const args = JSON.parse(told[1]) as { runId: string; output: { nodeId: string; path: string; port: string } };
  assert.deepEqual(args, { runId: run.id, output: { nodeId: "screenwriter", path: "", port: "text" } });
  // The receiving agent's own session reads it, exactly as its prompt says.
  let read = "", pages = 0;
  for (let offset: number | null = 0; offset !== null && pages < 200; pages++) {
    const { envelope } = await h.app.tools.call(second.sessionKey, "jc_workflow_status", { ...args, output: { ...args.output, offset } });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const page = (envelope.data as { output: { text: string; totalChars: number; offset: number; nextOffset: number | null; kind: string } }).output;
    assert.deepEqual([page.offset, page.totalChars, page.kind], [offset, big.length, "text"]);
    read += page.text;
    offset = page.nextOffset;
  }
  assert.ok(pages > 5 && read === big, `the whole value in ${pages} pages: ${read.length} of ${big.length} characters`);
  // The ordinary reading of the step is still the short one — that is why the reference does not point at it.
  const brief = (await h.app.tools.call(second.sessionKey, "jc_workflow_status", { runId: run.id, nodeId: "screenwriter", include: ["outputs"] })).envelope.data as { steps: Array<{ outputs: { text: string } }> };
  assert.ok(brief.steps[0].outputs.text.length < 2200);
  // What does not exist is said, not guessed.
  const none = (await h.app.tools.call(second.sessionKey, "jc_workflow_status", { runId: run.id, output: { nodeId: "screenwriter", path: "", port: "nothing" } })).envelope;
  assert.deepEqual([none.ok, none.error?.code], [false, "NOT_FOUND"]);
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
});

test("Ruling R9 — a turn on the person's own signed-in CLI runtime is not a money question: a workflow whose one agent step runs on a Codex model is estimated with nothing to confirm (no amount, no 'price not known') and starts unasked; the same step on a built-in endpoint model with no price still asks 'price not known' by the model's name", async () => {
  const { admin } = await moneySetup();
  const one = (name: string, runtime: Record<string, string>) => build(admin, name, (start) => [[node(start, "agent", "draft", { config: { promptTemplate: "Draft a line about kites.", runtime } })], [edge("e1", "start", "draft")]]);
  const own = await one("On Codex", { mode: "override", runtime: "codex", provider: "openai", model: "gpt-5-codex" });
  const shown = await admin.call("jagentchill.workflow.run.estimate", { workflowId: own.id });
  // (run 6, item 5) The step is NO row of the quote — not a step "at $0" — and the run cannot spend; it is named once, with whose account it runs on.
  assert.deepEqual([shown.estimate.unpricedModels, shown.estimate.highUsd, shown.confirmation.needed, shown.estimate.steps, shown.estimate.canSpend, shown.estimate.ownAccount], [[], 0, false, [], false, [{ label: own.nodes.find((entry) => entry.id === "draft")!.name, model: "gpt-5-codex", account: "Codex" }]]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: own.id });
  assert.equal(typeof run.id, "string", "started with no money question");
  const keyed = await one("On a key", { mode: "override", runtime: "claude-code", provider: "anthropic", model: "haiku" });
  const named = await admin.call("jagentchill.workflow.run.estimate", { workflowId: keyed.id });
  assert.deepEqual([named.estimate.unpricedModels, named.confirmation.needed], [["haiku"], true]);
  assert.equal((await admin.fail("jagentchill.workflow.run.create", { workflowId: keyed.id })).details.reason, "confirmation_required");
  assert.deepEqual(named.estimate.ownAccount, []);
  // Beside a priced step: ONE question, with the priced step only; the Codex step is neither a row nor an unknown price.
  const mixed = await build(admin, "Codex then a key", (start) => [[node(start, "agent", "draft", { config: { promptTemplate: "Draft a line about kites.", runtime: { mode: "override", runtime: "codex", provider: "openai", model: "gpt-5-codex" } } }), node(start, "agent", "polish", { config: { promptTemplate: "Polish the line about kites.", runtime: ACME } })], [edge("e1", "start", "draft"), edge("e2", "draft", "polish")]]);
  const both = await admin.call("jagentchill.workflow.run.estimate", { workflowId: mixed.id });
  // RE-DERIVED on R10: "Polish the line about kites." is 28 bytes — (10,000 + 28) × $3 + 30,000 = 60,084 millionths = $0.060084, the whole question.
  assert.deepEqual([both.estimate.steps.map((step: { nodeId: string }) => step.nodeId), both.estimate.unpricedModels, both.confirmation.needed, both.confirmation.amountUsd, both.estimate.ownAccount.map((entry: { model: string }) => entry.model)], [["polish"], [], true, 0.060084, ["gpt-5-codex"]]);
});

test("Cost and time estimate before a run: a fan-out is counted with the length of its list when that is known (typed on the step, or a run parameter) — never with a made-up number; a list only the run will know is quoted PER ITEM, the person confirms that amount, and the run is then allowed it for each item the list turns out to have, so a long list does not ask again", async () => {
  const { h, admin, sends, answer, gate } = await moneySetup();
  const fan = (start: WorkflowDocument, id: string, items?: unknown[]): WorkflowOp => node(start, "parallel", id, { name: id === "fan" ? "Each topic" : "Each draft", inputs: [{ id: "items", label: "items", type: "list<any>", required: true, ...(items ? { default: items } : {}) }] });
  const writer = (start: WorkflowDocument, id: string): WorkflowOp => node(start, "agent", id, { config: { promptTemplate: "Write about {{inputs.input}}", runtime: ACME } });
  // 1. Twelve items typed on the step: twelve executions, no assumption.
  const twelve = await build(admin, "Twelve", (start) => [[fan(start, "fan", Array.from({ length: 12 }, (_, index) => `topic ${index}`)), writer(start, "body"), node(start, "join", "join")], [edge("e1", "start", "fan"), edge("e2", "fan.item", "body.input"), edge("e3", "body.text", "join.result")]]);
  const known = await admin.call("jagentchill.workflow.run.estimate", { workflowId: twelve.id });
  const unit = known.estimate.steps[0].unitUsd as number;
  // RE-DERIVED on R10: "Write about {{inputs.input}}" as far as it is written before the run is 28 bytes —
  // (10,000 + 28) × $3 + 30,000 = 60,084 millionths = $0.060084 an item. Twelve: $0.721008. Five: $0.30042. Three: $0.180252.
  assert.deepEqual([unit, Math.round(unit * 12 * 1e6) / 1e6, Math.round(unit * 5 * 1e6) / 1e6, Math.round(unit * 3 * 1e6) / 1e6], [0.060084, 0.721008, 0.30042, 0.180252]);
  assert.deepEqual([known.estimate.steps.map((step: { nodeId: string; calls: number; perItem?: unknown }) => [step.nodeId, step.calls, step.perItem]), known.estimate.highUsd, known.estimate.perItemUsd, known.estimate.assumptions], [[["body", 12, undefined]], Math.round(unit * 12 * 1e6) / 1e6, 0, []]);
  // 2. The list is a run parameter: counted from what the person gives.
  const byParam = await build(admin, "By parameter", (start) => [[{ op: "param.set", parameters: [{ name: "topics", label: "Topics", type: "list<text>", required: true, help: "", secret: false }] }], [fan(start, "fan"), writer(start, "body"), node(start, "join", "join")], [edge("e1", "start.topics", "fan.items"), edge("e2", "fan.item", "body.input"), edge("e3", "body.text", "join.result")]]);
  const five = await admin.call("jagentchill.workflow.run.estimate", { workflowId: byParam.id, params: { topics: ["a", "b", "c", "d", "e"] } });
  assert.deepEqual([five.estimate.steps[0].calls, five.estimate.highUsd, five.estimate.perItemUsd], [5, Math.round(unit * 5 * 1e6) / 1e6, 0]);
  // 3. A list only the run will know (what three writers return): no number of items is assumed anywhere.
  const chained = await build(admin, "Then each", (start) => [[fan(start, "fan", ["a", "b", "c"]), writer(start, "body"), node(start, "join", "join"), fan(start, "again"), writer(start, "second"), node(start, "join", "join2")], [edge("e1", "start", "fan"), edge("e2", "fan.item", "body.input"), edge("e3", "body.text", "join.result"), edge("e4", "join.results", "again.items"), edge("e5", "again.item", "second.input"), edge("e6", "second.text", "join2.result")]]);
  const open = await admin.call("jagentchill.workflow.run.estimate", { workflowId: chained.id });
  assert.deepEqual([open.estimate.steps.map((step: { nodeId: string; calls: number; highUsd: number; perItem?: unknown }) => [step.nodeId, step.calls, step.highUsd, step.perItem]), open.estimate.highUsd, open.estimate.perItemUsd, open.confirmation.perItemUsd, open.confirmation.needed, open.estimate.assumptions],
    [[["body", 3, Math.round(unit * 3 * 1e6) / 1e6, undefined], ["second", 1, unit, { nodeId: "again", name: "Each draft" }]], Math.round(unit * 3 * 1e6) / 1e6, unit, unit, true, ["item count of Each draft not known before the run"]]);
  // The per-item amount is part of the one answer: without it the run does not start.
  const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: chained.id, confirmedUsd: open.estimate.highUsd });
  assert.deepEqual([refused.details.reason, refused.details.confirmWith], ["confirmation_required", { confirmedUsd: open.estimate.highUsd, confirmedPerItemUsd: unit }]);
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: chained.id, ...refused.details.confirmWith });
  assert.equal(gate.action(`run:${run.id}`)!.approved?.amountUsd, open.estimate.highUsd);
  // RE-DERIVED on R10. The three writers go out with their real messages — "Write about a" is 13 bytes:
  // (10,000 + 13) × $3 + 30,000 = $0.060039 each, $0.180117 reserved of the $0.180252 confirmed (it stops at $0.216302).
  // Each then costs nine tenths of that: the 10,000 tokens it was measured to carry ($0.03) and an answer of 1,602
  // tokens (1,602 × $15 a million = $0.02403) — $0.05403, and $0.16209 for the three. What is left of the first amount,
  // $0.216302 − $0.16209 = $0.054212, would not hold one more turn (the next, "Write about Draft 1." = 20 bytes, is
  // (10,000 + 20) × $3 + 30,000 = $0.06006).
  await until(() => sends().length === 3, "the three writers");
  assert.deepEqual(sends().map((call) => call.message.replace(WORKFLOW_TURN_PREFIX, "")).sort(), ["Write about a", "Write about b", "Write about c"]);
  assert.deepEqual((h.app.db.prepare("SELECT usd FROM gen_reservations WHERE action_id = ?").all(`run:${run.id}`) as Array<{ usd: number }>).map((row) => row.usd), [0.060546, 0.060546, 0.060546]);
  for (let index = 0; index < 3; index++) await answer(index, MEASURED_PROMPT, `Draft ${index + 1}.`, 1_602);
  // The list is there (three drafts): the run is allowed the confirmed amount for each of them — $0.180252 + 3 × $0.060084 = $0.360504 — and goes on unasked
  // (it stops at $0.432605; $0.16209 spent + 3 × $0.06006 for the three turns = $0.34227 fits).
  await until(() => sends().length === 6, "the three turns of the second list");
  assert.equal(gate.action(`run:${run.id}`)!.approved?.amountUsd, 0.360504);
  assert.equal(gate.action(`run:${run.id}`)!.approved?.amountUsd, Math.round((open.estimate.highUsd + unit * 3) * 1e6) / 1e6);
  assert.ok(gate.action(`run:${run.id}`)!.spentUsd! < 0.180252 * 1.2 && 0.180252 * 1.2 - 0.16209 < boundUsd("Write about Draft 1."), "without the per-item amount the first amount would not have held one more turn");
  for (let index = 3; index < 6; index++) await answer(index, MEASURED_PROMPT, `Final ${index - 2}.`, 1_602);
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the run to end without another question");
});

// (Added by the price-bound piece, w7 — coordinator's ruling R10.) The measurement here comes from a REAL turn (the
// runtime's usage event → Usage's record), not from the seeded row the tests above use.
test("Ruling R10 — missing maximum output alone leaves a priced and measured chat model at 'price not known'", async () => {
  const { h, admin, answer } = await moneySetup({ measured: false, smallPriced: true, smallMeasured: true });
  const one = await build(admin, "One line", (start) => [[node(start, "agent", "draft", { config: { promptTemplate: "Draft a line about kites.", runtime: ACME } })], [edge("e1", "start", "draft")]]);
  // opus has a price ($3 / $15 a million) and a documented maximum output (2,000 tokens) but has not run here: nothing is measured, so there is NO figure — and none is made up.
  const before: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: one.id });
  assert.deepEqual([before.estimate.steps.map((step) => [step.unitUsd, step.highUsd, step.measured]), before.estimate.unpricedModels, before.estimate.highUsd, before.confirmation.needed], [[[null, null, undefined]], ["opus"], 0, true]);
  const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: one.id, confirmedUsd: 100 });
  assert.deepEqual([refused.details.reason, refused.details.confirmWith], ["confirmation_required", { confirmedUsd: 0, allowUnpriced: ["opus"] }]);
  // The person allows the model by its name; its first turn runs and the provider reports what it carried: 12,345 tokens in, 200 out.
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: one.id, ...refused.details.confirmWith });
  await answer(0, 12_345, "Kites over the sea.", 200);
  await until(async () => (await statusOf(admin, run.id)) === "succeeded", "the first run on the model");
  // Now the host has a measurement. "Draft a line about kites." is 25 bytes:
  //   in  (12,345 measured + 25 bytes) × $3 a million = 37,110 millionths
  //   out  2,000 × $15 a million                      = 30,000 millionths
  //   → 67,110 millionths = $0.06711, marked as worked out from a measurement ("about").
  // (The rule before R10 priced the whole window in and out: 200,000 × $3 + 200,000 × $15 = $3.60.)
  const after: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: one.id });
  assert.deepEqual([after.estimate.steps.map((step) => [step.unitUsd, step.highUsd, step.measured]), after.estimate.unpricedModels, after.estimate.highUsd, after.confirmation.needed, after.confirmation.stopsAtUsd], [[[0.06711, 0.06711, true]], [], 0.06711, true, 0.080532]);
  assert.equal(after.estimate.highUsd, boundUsd("Draft a line about kites.", 12_345));
  // Isolate the missing-output-limit case: haiku has a $3/$15 price and a 10,000-token Usage measurement here;
  // modelMaxOutput deliberately returns undefined for it, so no context-window number can stand in for the limit.
  const small = await build(admin, "On the small one", (start) => [[node(start, "agent", "draft", { config: { promptTemplate: "Draft a line about kites.", runtime: { mode: "override", runtime: "claude-code", provider: "anthropic", model: "haiku" } } })], [edge("e1", "start", "draft")]]);
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE model_id = ?").get("haiku")!.n, 1, "the small model has a recorded measurement");
  const named: Estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: small.id });
  assert.deepEqual([named.estimate.steps.map((step) => step.unitUsd), named.estimate.unpricedModels], [[null], ["haiku"]]);
});
