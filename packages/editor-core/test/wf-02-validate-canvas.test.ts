import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowOp } from "@jagentchill/protocol";
import { workflow as wf } from "../src/index.ts";
import { Draft, codeOf, errorOf } from "./support/workflows.ts";

const codes = (draft: Draft, context?: wf.ValidateContext) => wf.validate(draft.doc, context).errors.map((problem) => problem.code);

test("Validation rules: a new workflow has no end yet; one connected step makes it valid", () => {
  const draft = new Draft();
  assert.deepEqual(codes(draft), []);
  const wait = draft.add("wait");
  assert.deepEqual(codes(draft), ["WORKFLOW_NODE_UNREACHABLE"]);
  draft.link("start", wait);
  assert.deepEqual(wf.validate(draft.doc), { valid: true, errors: [], warnings: [] });
});

test("Validation rules: Cycle without a loop node", () => {
  const draft = new Draft();
  const script = draft.add("wait", "script"), shots = draft.add("wait", "shots"), review = draft.add("wait", "review");
  draft.chain("start", script, shots, review);
  // The canvas refuses the connection; a document that carries it anyway is reported by validation.
  assert.equal(codeOf(() => wf.connectOps(draft.doc, { node: review, port: "done" }, { node: script, port: "start" })), "WORKFLOW_CYCLE");
  draft.apply([{ op: "edge.add", edge: { id: "back", kind: "control", from: { node: review, port: "done" }, to: { node: script, port: "start" } } }]);
  const problem = wf.validate(draft.doc).errors.find((entry) => entry.code === "WORKFLOW_CYCLE")!;
  assert.deepEqual(problem.path!.split(",").sort(), ["review", "script", "shots"]);
});

test("Validation rules: Edge leaving a parallel body", () => {
  const draft = new Draft();
  const list = draft.add("human_input", "list", { config: { fields: [{ id: "items", label: "Items", type: "multi_select", options: ["a", "b"], required: true }] } });
  const fan = draft.add("parallel", "fan"), body = draft.add("wait", "body"), join = draft.add("join", "join"), after = draft.add("notify", "after");
  draft.link("start", list);
  draft.link(`${list}.items`, `${fan}.items`);
  draft.link(`${fan}.item`, `${body}.value`);
  draft.link(`${body}.value`, `${join}.result`);
  draft.link(`${join}.results`, `${after}.value`);
  assert.deepEqual(codes(draft), []);
  const bypass = draft.add("notify", "bypass");
  draft.link(join, bypass);
  const edge = draft.link(`${body}.value`, `${bypass}.value`);
  const problem = wf.validate(draft.doc).errors.find((entry) => entry.code === "WORKFLOW_BODY_NOT_CLOSED")!;
  assert.equal(problem.edgeId, edge);
});

test("Validation rules: a parallel without a join, a join without a parallel, a loop without its loop-back", () => {
  const draft = new Draft();
  const fan = draft.add("parallel", "fan", { inputs: [{ id: "items", label: "items", type: "list<any>", default: [] }] }), loop = draft.add("loop", "loop"), join = draft.add("join", "join");
  draft.link("start", fan);
  draft.link("start", loop);
  draft.link("start", join);
  const found = wf.validate(draft.doc).errors;
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_BODY_NOT_CLOSED" && entry.nodeId === fan));
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_BODY_NOT_CLOSED" && entry.nodeId === join));
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_LOOP_INVALID" && entry.nodeId === loop && entry.port === "next"));
});

test("Validation rules: a required input without a connection, a routed failure without an error edge, a sub-workflow that is gone", () => {
  const draft = new Draft();
  const approval = draft.add("approval", "gate"), agent = draft.add("agent", "writer", { onError: "route" }), child = draft.add("subworkflow", "child", { config: { workflowId: "missing" } });
  draft.chain("start", approval);
  draft.link("start", agent);
  draft.link("start", child);
  const found = wf.validate(draft.doc, { workflow: () => undefined }).errors;
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_INPUT_MISSING" && entry.nodeId === approval && entry.port === "subject"));
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_SCHEMA_INVALID" && entry.nodeId === agent && entry.port === "error"));
  assert.ok(found.some((entry) => entry.code === "WORKFLOW_REF_UNRESOLVED" && entry.nodeId === child));
});

test("Validation rules: an input read by a template needs a data connection, but unused inputs stay optional", () => {
  const draft = new Draft();
  const editor = draft.add("agent", "Editor", { name: "Editor" });
  draft.link("start", editor);

  const missing = wf.validate(draft.doc).errors.find((entry) => entry.code === "WORKFLOW_INPUT_MISSING" && entry.nodeId === editor && entry.port === "input");
  assert.deepEqual(missing && { code: missing.code, message: missing.message, nodeId: missing.nodeId, port: missing.port }, {
    code: "WORKFLOW_INPUT_MISSING", message: "Editor reads its input, but nothing is connected to it", nodeId: editor, port: "input",
  });

  draft.apply([{ op: "node.update", id: editor, patch: { config: { ...draft.node(editor).config, promptTemplate: "Run the fixed instruction." } } }]);
  assert.equal(wf.validate(draft.doc).valid, true);
});

test("Validation rules: a step type this build cannot run is an error on that step", () => {
  const draft = new Draft();
  draft.apply([{ op: "node.add", node: { id: "gen", type: "generate" } }]);
  draft.link("start", "gen");
  const problem = wf.validate(draft.doc).errors.find((entry) => entry.nodeId === "gen")!;
  assert.equal(problem.code, "WORKFLOW_REF_UNRESOLVED");
  assert.ok(!wf.OFFERED_NODE_TYPES.some((info) => info.type === "generate"));
});

test("Subworkflow node: Reference cycle", () => {
  const a = new Draft("A", "wf_a"), b = new Draft("B", "wf_b");
  for (const [draft, other] of [[a, "wf_b"], [b, "wf_a"]] as const) {
    draft.apply([{ op: "node.update", id: "start", patch: { config: { sources: [{ kind: "manual", enabled: true }, { kind: "subworkflow", enabled: true }] } } }]);
    const node = draft.add("subworkflow", "child", { config: { workflowId: other } });
    draft.link("start", node);
  }
  const lookup = { workflow: (id: string) => (id === "wf_a" ? a.doc : id === "wf_b" ? b.doc : undefined) };
  assert.ok(codes(a, lookup).includes("WORKFLOW_SUBWORKFLOW_CYCLE"));
  assert.ok(codes(b, lookup).includes("WORKFLOW_SUBWORKFLOW_CYCLE"));
});

test("Variables, templates and conditions: Reference without an edge", () => {
  const draft = new Draft();
  const agent = draft.add("agent", "writer", { config: { promptTemplate: "Rewrite {{nodes.brief.outputs.text}}" } });
  draft.link("start", agent);
  const problem = wf.validate(draft.doc).errors.find((entry) => entry.code === "WORKFLOW_TEMPLATE_INVALID")!;
  assert.match(problem.message, /Connect the output to an input and use \{\{inputs\.<port>\}\}/);
  assert.equal(problem.nodeId, agent);
});

test("Variables, templates and conditions: unknown input, parameter, variable and filter fail validation", () => {
  const draft = new Draft();
  const agent = draft.add("agent", "writer", { config: { promptTemplate: "{{inputs.nope}} {{params.nope}} {{vars.nope}} {{inputs.input | shout}}" } });
  draft.link("start", agent);
  assert.equal(codes(draft).filter((code) => code === "WORKFLOW_TEMPLATE_INVALID").length, 4);
});

test("Variables, templates and conditions: Replace variable written in a parallel body", () => {
  const draft = new Draft();
  draft.apply([{ op: "var.set", variables: [{ name: "last", type: "any", mode: "replace" }, { name: "warnings", type: "list<any>", mode: "append" }] }]);
  const fan = draft.add("parallel", "fan", { inputs: [{ id: "items", label: "items", type: "list<any>", default: [1, 2] }] });
  const body = draft.add("wait", "body", { assign: [{ var: "last", from: "value" }, { var: "warnings", from: "value" }] }), join = draft.add("join", "join");
  draft.link("start", fan);
  draft.link(`${fan}.item`, `${body}.value`);
  draft.link(`${body}.value`, `${join}.result`);
  const found = wf.validate(draft.doc).errors;
  assert.equal(found.length, 1);
  assert.equal(found[0].code, "WORKFLOW_VAR_WRITE_IN_PARALLEL");
  assert.equal(found[0].nodeId, body);
  assert.equal(found[0].path, "last");
});

test("Variables, templates and conditions: Type-mismatched comparison", () => {
  const warnings: string[] = [];
  assert.equal(wf.evaluateCondition({ left: "inputs.value", op: "gt", right: 5 }, { inputs: { value: "abc" } }, (message) => warnings.push(message)), false);
  assert.equal(warnings.length, 1);
  assert.equal(wf.evaluateCondition({ all: [{ left: "inputs.n", op: "gte", right: 3 }, { not: { left: "inputs.name", op: "is_empty" } }, { any: [{ left: "inputs.tags", op: "contains", right: "x" }, { left: "inputs.name", op: "in", right: ["a", "b"] }] }] }, { inputs: { n: 3, name: "a", tags: [] } }), true);
  assert.deepEqual(wf.conditionProblems({ all: [{ all: [{ all: [{ all: [{ left: "inputs.a", op: "eq", right: 1 }] }] }] }] }), ["A condition is at most 4 levels deep"]);
  assert.equal(wf.conditionProblems({ all: Array.from({ length: 21 }, () => ({ left: "inputs.a", op: "eq", right: 1 })) }).length, 1);
  assert.equal(wf.conditionProblems({ left: "inputs.a", op: "matches", right: ".*" }).length, 1);
});

test("Variables, templates and conditions: templates read paths, apply filters, and a missing value is an empty string with a warning", () => {
  const scope = { params: { topic: "Cats", tags: ["a", "b"] }, inputs: { shots: [{ id: "s1" }], text: "Hello" }, run: { number: 7 }, loop: { iteration: 2 }, item: { name: "x" }, index: 3 };
  const warnings: string[] = [];
  assert.equal(wf.renderTemplate("{{params.topic | upper}} #{{run.number}} {{inputs.shots[0].id}} {{params.tags | join(\"+\")}} {{params.tags | length}} {{item.name}}{{index}}{{loop.iteration}}", scope), "CATS #7 s1 a+b 2 x32");
  assert.equal(wf.renderTemplate("[{{params.missing}}] {{params.missing | default(\"n/a\")}} {{inputs.text | truncate(2)}}", scope, (message) => warnings.push(message)), "[] n/a He");
  assert.equal(warnings.length, 1);
  assert.deepEqual(wf.resolveValue("{{inputs.shots}}", scope), [{ id: "s1" }]);
  assert.equal(wf.renderTemplate("{{params.topic}}", { params: { topic: "x".repeat(20_000) } }).length, 16_000);
});

test("Node configuration panel: Prompt too long", () => {
  const draft = new Draft();
  const agent = draft.add("agent", "writer", { config: { promptTemplate: "x".repeat(8001) } });
  draft.link("start", agent);
  const problem = wf.validate(draft.doc).errors[0];
  assert.equal(problem.code, "WORKFLOW_SCHEMA_INVALID");
  assert.match(problem.message, /Prompt must be 8,000 characters or fewer/);
  assert.ok(wf.CONFIG_SCHEMAS.agent!.safeParse({ ...draft.node(agent).config, promptTemplate: "x".repeat(8000) }).success);
});

test("Editing semantics: drag a node type onto empty canvas — a unique id from the type, on the grid", () => {
  const draft = new Draft();
  const first = wf.addNodeOps(draft.doc, "agent", { x: 407, y: 213 });
  draft.apply(first.ops);
  const second = wf.addNodeOps(draft.doc, "agent", { x: 600, y: 200 });
  draft.apply(second.ops);
  assert.deepEqual([first.nodeId, second.nodeId], ["agent", "agent_2"]);
  assert.deepEqual(draft.node("agent").position, { x: 400, y: 220 });
  assert.equal(draft.node("agent_2").name, "Agent 2");
});

test("Editing semantics: Insert on an edge", () => {
  const draft = new Draft();
  const script = draft.add("agent", "script"), shots = draft.add("agent", "shots");
  draft.link("start", script);
  const edge = draft.link(`${script}.text`, `${shots}.input`);
  const before = wf.canonical(draft.doc);
  const inserted = wf.insertOnEdgeOps(draft.doc, "approval", edge, { x: 500, y: 200 });
  const result = draft.apply(inserted.ops);
  assert.deepEqual(draft.doc.edges.filter((entry) => entry.kind === "data").map((entry) => `${entry.from.node}.${entry.from.port}>${entry.to.node}.${entry.to.port}`), ["script.text>approval.subject", "approval.subject>shots.input"]);
  draft.apply(result.inverse);
  assert.equal(wf.canonical(draft.doc), before);
  // A type with no compatible pair of ports is refused.
  assert.equal(codeOf(() => wf.insertOnEdgeOps(draft.doc, "human_input", edge, { x: 0, y: 0 })), "WORKFLOW_TYPE_MISMATCH");
});

test("Editing semantics: Paste across workflows", () => {
  const source = new Draft("Source", "wf_a");
  const a = source.add("agent", "a"), b = source.add("agent", "b"), c = source.add("notify", "c"), d = source.add("wait", "d"), outside = source.add("notify", "outside");
  source.link("start", a);
  source.link(`${a}.text`, `${b}.input`);
  source.link(`${b}.text`, `${c}.value`);
  source.link(c, d);
  source.link(`${a}.text`, `${outside}.value`);
  const fragment = wf.parseFragment(JSON.stringify(wf.copyFragment(source.doc, { nodeIds: ["start", a, b, c, d] })))!;
  assert.deepEqual(fragment.nodes.map((node) => node.id), [a, b, c, d]);
  assert.equal(fragment.edges.length, 3);
  const target = new Draft("Target", "wf_b");
  target.add("agent", "a");
  const pasted = wf.pasteOps(target.doc, fragment, { x: 1000, y: 600 });
  const result = target.apply(pasted.ops);
  assert.deepEqual(pasted.nodeIds, ["a_2", "b", "c", "d"]);
  assert.equal(target.doc.edges.length, 3);
  assert.ok(target.doc.edges.every((edge) => pasted.nodeIds.includes(edge.from.node) && pasted.nodeIds.includes(edge.to.node)));
  // Centred on the pointer.
  const frame = wf.frameOf(target.doc, pasted.nodeIds)!;
  assert.ok(Math.abs(frame.x + frame.width / 2 - 1000) <= 20 && Math.abs(frame.y + frame.height / 2 - 600) <= 20);
  target.apply(result.inverse);
  assert.deepEqual(target.doc.nodes.map((node) => node.id), ["start", "a"]);
  assert.equal(wf.parseFragment("{\"format\":\"something else\"}"), undefined);
  assert.equal(wf.parseFragment("not json"), undefined);
});

test("Editing semantics: duplicate offsets by (40, 40); move, align and distribute are one batch of moves; delete keeps the trigger", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a", {}, { x: 400, y: 200 }), b = draft.add("wait", "b", {}, { x: 700, y: 260 }), c = draft.add("wait", "c", {}, { x: 1300, y: 400 });
  draft.link(a, b);
  const copy = wf.duplicateOps(draft.doc, { nodeIds: [a, b] });
  draft.apply(copy.ops);
  assert.deepEqual(draft.node(copy.nodeIds[0]).position, { x: 440, y: 240 });
  assert.equal(draft.doc.edges.filter((edge) => copy.nodeIds.includes(edge.from.node)).length, 1);
  draft.apply(wf.deleteOps(draft.doc, { nodeIds: copy.nodeIds }));
  const moved = draft.apply(wf.moveOps(draft.doc, [a, b], 33, -7));
  assert.deepEqual([draft.node(a).position, draft.node(b).position], [{ x: 440, y: 200 }, { x: 740, y: 260 }]);
  draft.apply(moved.inverse);
  assert.deepEqual(wf.moveOps(draft.doc, [a], 4, 4), []);
  draft.apply(wf.alignOps(draft.doc, [a, b, c], "top"));
  assert.deepEqual([a, b, c].map((id) => draft.node(id).position.y), [200, 200, 200]);
  draft.apply(wf.alignOps(draft.doc, [a, b, c], "distribute-h"));
  assert.deepEqual([a, b, c].map((id) => draft.node(id).position.x), [400, 860, 1300]);
  draft.apply(wf.alignOps(draft.doc, [a, b], "left"));
  assert.equal(draft.node(b).position.x, 400);
  const removed = draft.apply(wf.deleteOps(draft.doc, { nodeIds: ["start", a, b, c] }));
  assert.deepEqual(draft.doc.nodes.map((node) => node.id), ["start"]);
  draft.apply(removed.inverse);
  assert.equal(draft.doc.nodes.length, 4);
  assert.equal(draft.doc.edges.length, 1);
});

test("Editing semantics: group, ungroup and notes", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a", {}, { x: 400, y: 200 }), b = draft.add("wait", "b", {}, { x: 700, y: 400 });
  draft.apply(wf.groupOps(draft.doc, [a, b], "Audio"));
  assert.deepEqual(draft.doc.groups[0].frame, { x: 376, y: 152, width: 588, height: 412 });
  draft.apply(wf.deleteOps(draft.doc, { nodeIds: [], groupIds: ["group"] }));
  assert.equal(draft.doc.groups.length, 0);
  assert.equal(draft.doc.nodes.length, 3);
  const note = wf.noteOps(draft.doc, { x: 11, y: 29 });
  draft.apply(note.ops);
  draft.apply([{ op: "note.update", id: note.noteId, patch: { text: "Check the music", x: 100 } }]);
  assert.deepEqual(draft.doc.notes[0], { id: "note", text: "Check the music", x: 100, y: 20, width: 200, height: 100 });
});

test("Editing semantics: Undo after a foreign change — the stack holds 100 steps and a refused inverse is dropped", () => {
  const draft = new Draft();
  const stack = new wf.UndoStack();
  const run = (label: string, ops: WorkflowOp[]) => { const result = draft.apply(ops); stack.push({ label, forward: ops, inverse: result.inverse }); };
  run("Add step", wf.addNodeOps(draft.doc, "wait", { x: 400, y: 200 }).ops);
  run("Rename", [{ op: "node.update", id: "wait", patch: { name: "Pause" } }]);
  // Undo, then redo.
  let step = stack.takeUndo()!;
  let undone = draft.apply(step.inverse);
  stack.undoApplied(step, undone.inverse);
  assert.equal(draft.node("wait").name, "Wait");
  assert.ok(stack.canRedo);
  step = stack.takeRedo()!;
  undone = draft.apply(step.inverse);
  stack.redoApplied(step, undone.inverse);
  assert.equal(draft.node("wait").name, "Pause");
  // Another actor removes the step: the inverse no longer applies and leaves the stack.
  draft.apply([{ op: "node.remove", id: "wait" }]);
  step = stack.takeUndo()!;
  assert.equal(errorOf(() => draft.apply(step.inverse)).code, "NOT_FOUND");
  assert.ok(stack.canUndo);
  for (let index = 0; index < 120; index++) stack.push({ label: "x", forward: [], inverse: [] });
  let count = 0;
  while (stack.takeUndo()) count += 1;
  assert.equal(count, 100);
});

test("Connecting ports: the kind is inferred from the two ports", () => {
  const draft = new Draft();
  const a = draft.add("agent", "a", { onError: "route" }), b = draft.add("notify", "b"), loop = draft.add("loop", "loop"), body = draft.add("wait", "body");
  assert.equal(wf.inferEdgeKind(draft.doc, { node: a, port: "text" }, { node: b, port: "value" }), "data");
  assert.equal(wf.inferEdgeKind(draft.doc, { node: a, port: "done" }, { node: b, port: "start" }), "control");
  assert.equal(wf.inferEdgeKind(draft.doc, { node: a, port: "error" }, { node: b, port: "start" }), "error");
  assert.equal(wf.inferEdgeKind(draft.doc, { node: body, port: "value" }, { node: loop, port: "next" }), "loop_back");
  assert.equal(wf.inferEdgeKind(draft.doc, { node: a, port: "done" }, { node: "start", port: "start" }), undefined);
  assert.equal(wf.inferEdgeKind(draft.doc, { node: a, port: "text" }, { node: b, port: "start" }), undefined);
});

test("Connecting ports: Cycle refused while dragging", () => {
  const draft = new Draft();
  const script = draft.add("wait", "script"), review = draft.add("wait", "review");
  draft.chain("start", script, review);
  const graph = wf.analyse(draft.doc);
  assert.equal(wf.connectionProblem(draft.doc, graph, { node: review, port: "done" }, { node: script, port: "start" }), "WORKFLOW_CYCLE");
  const error = errorOf(() => wf.connectOps(draft.doc, { node: review, port: "done" }, { node: script, port: "start" }));
  assert.equal(error.message, "This connection would create a loop — use a Loop node");
  assert.equal(wf.connectionProblem(draft.doc, graph, { node: script, port: "done" }, { node: script, port: "start" }), "WORKFLOW_EDGE_SELF");
  assert.equal(wf.connectionProblem(draft.doc, graph, { node: script, port: "done" }, { node: review, port: "start" }), "WORKFLOW_EDGE_DUPLICATE");
  assert.equal(wf.connectionProblem(draft.doc, graph, { node: script, port: "value" }, { node: review, port: "start" }), "WORKFLOW_TYPE_MISMATCH");
});

test("Connecting ports: Replace a connection", () => {
  const draft = new Draft();
  const a = draft.add("agent", "a"), b = draft.add("agent", "b"), c = draft.add("agent", "c");
  const old = draft.link(`${a}.text`, `${c}.input`);
  assert.equal(wf.connectionProblem(draft.doc, wf.analyse(draft.doc), { node: b, port: "text" }, { node: c, port: "input" }), "WORKFLOW_PORT_OCCUPIED");
  assert.equal(codeOf(() => wf.connectOps(draft.doc, { node: b, port: "text" }, { node: c, port: "input" })), "WORKFLOW_PORT_OCCUPIED");
  const replace = wf.connectOps(draft.doc, { node: b, port: "text" }, { node: c, port: "input" }, { replace: true });
  assert.deepEqual(replace.ops.map((op) => op.op), ["edge.remove", "edge.add"]);
  const result = draft.apply(replace.ops);
  assert.deepEqual(draft.doc.edges.map((edge) => edge.from.node), [b]);
  draft.apply(result.inverse);
  assert.deepEqual(draft.doc.edges.map((edge) => edge.id), [old]);
});

test("Connecting ports: Connect by creating a node, and dropping on a node body takes its first compatible free input", () => {
  const draft = new Draft();
  const script = draft.add("agent", "script");
  const added = wf.addNodeOps(draft.doc, "approval", { x: 800, y: 200 });
  // One batch: the node and the edge into its first compatible input.
  const withNode = wf.applyBatch(draft.doc, added.ops).doc;
  const port = wf.firstCompatibleInput(withNode, { node: script, port: "text" }, added.nodeId);
  assert.equal(port, "subject");
  const result = draft.apply([...added.ops, { op: "edge.add", edge: { id: wf.nextEdgeId(draft.doc), from: { node: script, port: "text" }, to: { node: added.nodeId, port: port! } } }]);
  assert.equal(draft.doc.edges[0].kind, "data");
  draft.apply(result.inverse);
  assert.equal(draft.doc.nodes.length, 2);
  // A control output dropped on a node body connects to its start.
  const wait = draft.add("wait");
  assert.equal(wf.firstCompatibleInput(draft.doc, { node: script, port: "done" }, wait), "start");
});

test("Trigger node: one output per parameter; the control ports follow the node's type and configuration", () => {
  const draft = new Draft();
  const branch = draft.add("branch", "route", { config: { cases: [{ id: "long", label: "Long", condition: { all: [] } }, { id: "short", label: "Short", condition: { all: [] } }], mode: "first_match" } });
  assert.deepEqual(wf.controlPorts(draft.node(branch)).outputs, ["done", "error", "long", "short", "else"]);
  assert.deepEqual(wf.controlPorts(draft.node("start")), { inputs: [], outputs: ["done"] });
  assert.deepEqual(wf.controlPorts(draft.node(draft.add("approval"))).outputs, ["done", "error", "approved", "rejected", "changes_requested"]);
  const form = draft.add("human_input", "form", { config: { fields: [{ id: "title", label: "Title", type: "text", required: true }, { id: "count", label: "Count", type: "number", required: false }] } });
  assert.deepEqual(draft.node(form).outputs.map((port) => `${port.id}:${port.type}`), ["response:FormResponse", "title:text", "count:number"]);
  // Removing a branch case removes the edges of its output, and undo restores them.
  const target = draft.add("notify", "target");
  draft.link(`${branch}.short`, target);
  const result = draft.apply([{ op: "node.update", id: branch, patch: { config: { cases: [{ id: "long", label: "Long", condition: { all: [] } }], mode: "first_match" } } }]);
  assert.equal(draft.doc.edges.length, 0);
  draft.apply(result.inverse);
  assert.equal(draft.doc.edges.length, 1);
});
