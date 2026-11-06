// The agent runtimes in these tests are the FAKES of `harness.ts` and devices are simulated; the server, the workflow documents,
// the tools and the request records are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tick } from "./harness.ts";
import { key, toolWorld } from "./support/tools.ts";

const until = async (done: () => boolean, what: string) => { for (let n = 0; n < 400; n++) { if (done()) return; await tick(10); } throw new Error(`timed out waiting for ${what}`); };
const eventsOf = (device: { events: { event: string; payload: any }[] }, event: string) => device.events.filter((entry) => entry.event === event).map((entry) => entry.payload);
const BUILD = [
  { op: "node.add", node: { id: "brief", type: "agent", name: "Write the brief", config: { promptTemplate: "Write a weekly recap.", instructions: "", runtime: { mode: "override", runtime: "builtin", provider: "acme", model: "acme-large" }, session: "fresh", maxTurns: 4 } } },
  { op: "node.add", node: { id: "pause", type: "wait", name: "Wait for the user", config: { mode: "duration", seconds: 60 } } },
  { op: "edge.add", edge: { id: "e1", from: { node: "start", port: "done" }, to: { node: "brief", port: "start" } } },
  { op: "edge.add", edge: { id: "e2", from: { node: "brief", port: "done" }, to: { node: "pause", port: "start" } } },
];

test("Workflow tools: an agent reads workflows; creating one asks first and the allowed call creates it, with no trigger turned on", async () => {
  const w = await toolWorld({ toolSurface: "workflow" });
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  assert.deepEqual((await w.ok("jc_workflow_list")).data.workflows, []);
  const args = { name: "Weekly recap", description: "Draft then wait", ops: BUILD, idempotencyKey: key() };
  // A dry run builds the graph in memory: nobody is asked, nothing is stored.
  const dry = await w.ok("jc_workflow_create", { ...args, dryRun: true });
  assert.deepEqual([dry.data.provisional, dry.data.steps, dry.data.validation.valid], [true, 2, true]);
  assert.equal((await w.admin.call("jagentchill.workflow.list")).workflows.length, 0);
  const pending = await w.fails("jc_workflow_create", args);
  assert.deepEqual([pending.code, pending.retryable], ["APPROVAL_PENDING", true]);
  await until(() => eventsOf(w.admin, "jagentchill.chat.permission.requested").length === 1, "the permission card");
  const request = eventsOf(w.admin, "jagentchill.chat.permission.requested")[0].request;
  assert.equal(request.toolLabel, "Create the workflow “Weekly recap”");
  assert.match(request.detail, /Add step “Write the brief” \(agent\)\nAdd step “Wait for the user” \(wait\)\nConnect “Start” to “Write the brief”/);
  assert.equal((await w.admin.call("jagentchill.workflow.list")).workflows.length, 0, "nothing exists before the person allows it");
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: request.requestId, decision: "allow-once" });
  const made = await w.ok("jc_workflow_create", args);
  assert.equal(made.data.steps, 2);
  const listed = (await w.admin.call("jagentchill.workflow.list")).workflows;
  assert.deepEqual(listed.map((entry: any) => [entry.name, entry.origin, entry.nodeCount]), [["Weekly recap", "agent", 3]]);
  const got = await w.ok("jc_workflow_get", { workflowId: made.data.workflowId });
  assert.deepEqual([got.data.workflow.nodes.map((node: any) => node.id), got.data.workflow.description, got.data.validation.valid], [["start", "brief", "pause"], "Draft then wait", true]);
  assert.equal(JSON.stringify(got.data).includes("position"), false, "an agent reads steps, not geometry");
  // The workflow has no automation: nothing fires by itself.
  assert.equal((await w.admin.call("jagentchill.automation.list")).automations.length, 0);
  // The same call again is the same answer, not a second workflow; a new call (new key) asks again.
  const again = await w.ok("jc_workflow_create", args);
  assert.deepEqual([again.replayed, again.data.workflowId], [true, made.data.workflowId]);
  assert.equal((await w.admin.call("jagentchill.workflow.list")).workflows.length, 1);
  assert.equal((await w.fails("jc_workflow_create", { ...args, idempotencyKey: key() })).code, "APPROVAL_PENDING");
  w.close();
});

test("Workflow tools: an edit asks first, applies once allowed, and an agent cannot touch the trigger or break the graph", async () => {
  const w = await toolWorld({ toolSurface: "workflow" });
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  const { document } = await w.admin.call("jagentchill.workflow.create", { name: "Mine" });
  const rename = [{ op: "node.update", id: "start", patch: { name: "Go" } }];
  assert.match((await w.fails("jc_workflow_edit", { workflowId: document.id, ops: rename, idempotencyKey: key() })).message, /Triggers are set by a person/);
  assert.match((await w.fails("jc_workflow_edit", { workflowId: document.id, ops: [{ op: "node.add", node: { id: "t2", type: "trigger" } }], idempotencyKey: key() })).message, /Triggers are set by a person/);
  assert.match((await w.fails("jc_workflow_edit", { workflowId: document.id, ops: [{ op: "node.remove", id: "start" }], idempotencyKey: key() })).message, /Triggers are set by a person/);
  // A refusal of the graph comes before anybody is asked.
  const broken = await w.fails("jc_workflow_edit", { workflowId: document.id, ops: [{ op: "edge.add", edge: { id: "x", from: { node: "start", port: "done" }, to: { node: "ghost", port: "start" } } }], idempotencyKey: key() });
  assert.notEqual(broken.code, "APPROVAL_PENDING");
  assert.equal(eventsOf(w.admin, "jagentchill.chat.permission.requested").length, 0);
  const args = { workflowId: document.id, baseRevision: document.revision, ops: [BUILD[1]!], label: "Add a wait", idempotencyKey: key() };
  assert.equal((await w.fails("jc_workflow_edit", args)).code, "APPROVAL_PENDING");
  await until(() => eventsOf(w.admin, "jagentchill.chat.permission.requested").length === 1, "the permission card");
  const request = eventsOf(w.admin, "jagentchill.chat.permission.requested")[0].request;
  assert.deepEqual([request.toolLabel, request.detail], ["Change the workflow “Mine”", "Add step “Wait for the user” (wait)"]);
  assert.equal((await w.admin.call("jagentchill.workflow.get", { workflowId: document.id })).document.nodes.length, 1);
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: request.requestId, decision: "allow-once" });
  const done = await w.ok("jc_workflow_edit", args);
  assert.equal(done.data.revision, document.revision + 1);
  const after = (await w.admin.call("jagentchill.workflow.get", { workflowId: document.id })).document;
  assert.deepEqual(after.nodes.map((node: any) => node.id), ["start", "pause"]);
  w.close();
});

test("Workflow tools: in Ask mode the writes fail with MODE_READ_ONLY and the reads still work", async () => {
  const w = await toolWorld({ mode: "ask", toolSurface: "workflow" });
  assert.equal((await w.fails("jc_workflow_create", { name: "X", idempotencyKey: key() })).code, "MODE_READ_ONLY");
  assert.equal((await w.fails("jc_workflow_edit", { workflowId: "wf_x", ops: BUILD.slice(0, 1), idempotencyKey: key() })).code, "MODE_READ_ONLY");
  assert.deepEqual((await w.ok("jc_workflow_list")).data.workflows, []);
  assert.equal((await w.fails("jc_workflow_get", { workflowId: "wf_missing" })).code, "INVALID_PARAMS");
  w.close();
});
