import assert from "node:assert/strict";
import { test } from "node:test";
import { WORKFLOW_NODE_TYPES, type WorkflowOp } from "@jagentchill/protocol";
import { workflow as wf } from "../src/index.ts";
import { Draft, codeOf, errorOf } from "./support/workflows.ts";

test("Workflow document: Unknown node type rejected", () => {
  const draft = new Draft();
  const error = errorOf(() => wf.parseDocument({ ...draft.doc, nodes: [...draft.doc.nodes, { ...draft.doc.nodes[0], id: "q", type: "queue" }] }));
  assert.equal(error.code, "WORKFLOW_SCHEMA_INVALID");
  assert.equal(error.details.path, "nodes[1].type");
  assert.deepEqual(error.details.allowed, [...WORKFLOW_NODE_TYPES]);
  assert.equal((error.details.allowed as string[]).length, 17);
});

test("Workflow document: Geometry does not change the graph hash", () => {
  const draft = new Draft();
  const id = draft.add("wait", undefined, {}, { x: 200, y: 100 });
  const before = draft.doc.graphHash;
  draft.apply([{ op: "node.move", id, position: { x: 480, y: 320 } }]);
  assert.deepEqual(draft.node(id).position, { x: 480, y: 320 });
  assert.equal(draft.doc.graphHash, before);
  draft.apply([{ op: "node.update", id, patch: { name: "Pause" } }]);
  assert.notEqual(draft.doc.graphHash, before);
});

test("Workflow document: Duplicate node id", () => {
  const draft = new Draft();
  draft.add("wait", "script");
  const error = errorOf(() => draft.apply([{ op: "node.add", node: wf.makeNode({ nodes: [], parameters: [] }, "wait", { x: 0, y: 0 }, "script") }]));
  assert.equal(error.code, "WORKFLOW_ID_DUPLICATE");
  assert.equal(error.details.id, "script");
  assert.equal(codeOf(() => wf.parseDocument({ ...draft.doc, nodes: [...draft.doc.nodes, draft.node("script")] })), "WORKFLOW_ID_DUPLICATE");
});

test("Canvas geometry: Group membership is exclusive", () => {
  const draft = new Draft();
  const voice = draft.add("wait", "voice"), other = draft.add("wait", "other");
  const frame = { x: 0, y: 0, width: 100, height: 100 };
  draft.apply([{ op: "group.add", group: { id: "visuals", label: "Visuals", colorIndex: 1, nodeIds: [voice, other], frame, collapsed: false } }]);
  const result = draft.apply([{ op: "group.add", group: { id: "audio", label: "Audio", colorIndex: 2, nodeIds: [voice], frame, collapsed: false } }]);
  assert.deepEqual(draft.doc.groups.find((group) => group.id === "visuals")!.nodeIds, [other]);
  assert.deepEqual(draft.doc.groups.find((group) => group.id === "audio")!.nodeIds, [voice]);
  draft.apply(result.inverse);
  assert.deepEqual(draft.doc.groups.map((group) => [group.id, group.nodeIds]), [["visuals", [voice, other]]]);
});

test("Canvas geometry: Out-of-range position", () => {
  const draft = new Draft();
  const id = draft.add("wait");
  const before = draft.doc;
  assert.equal(codeOf(() => draft.apply([{ op: "node.move", id, position: { x: 2_000_000, y: 0 } }])), "WORKFLOW_GEOMETRY_INVALID");
  assert.equal(draft.doc, before);
});

test("Canvas geometry: Notes are ignored by the engine — notes and groups never change the graph hash", () => {
  const draft = new Draft();
  const id = draft.add("wait");
  const before = draft.doc.graphHash;
  for (let index = 0; index < 12; index++) draft.apply(wf.noteOps(draft.doc, { x: index * 40, y: 0 }).ops);
  draft.apply(wf.groupOps(draft.doc, [id]));
  assert.equal(draft.doc.notes.length, 12);
  assert.equal(draft.doc.graphHash, before);
});

test("Ports and data types: Compatible widening and Incompatible types", () => {
  assert.ok(wf.typesCompatible("VideoRef", "MediaRef"));
  assert.ok(wf.typesCompatible("integer", "number") && wf.typesCompatible("string", "text") && wf.typesCompatible("text", "string"));
  assert.ok(wf.typesCompatible("Brief", "json") && wf.typesCompatible("list<integer>", "list<number>"));
  assert.ok(!wf.typesCompatible("number", "integer") && !wf.typesCompatible("MediaRef", "VideoRef") && !wf.typesCompatible("json", "Brief"));
  const draft = new Draft();
  const source = draft.add("wait", "source", { name: "Music", outputs: [{ id: "track", label: "track", type: "MusicTrack" }] });
  const target = draft.add("wait", "target", { name: "Captions", inputs: [{ id: "captions", label: "captions", type: "CaptionSet" }] });
  const error = errorOf(() => draft.apply([{ op: "edge.add", edge: { id: "e9", kind: "data", from: { node: source, port: "track" }, to: { node: target, port: "captions" } } }]));
  assert.equal(error.code, "WORKFLOW_TYPE_MISMATCH");
  assert.equal(error.message, "Captions needs CaptionSet; Music produces MusicTrack");
});

test("Typed edges: Duplicate edge, Self-edge, and a node's edges go with it", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a"), b = draft.add("wait", "b");
  draft.link("start", a);
  draft.link(`${a}.value`, `${b}.value`);
  assert.equal(codeOf(() => draft.apply([{ op: "edge.add", edge: { id: "dup", kind: "data", from: { node: a, port: "value" }, to: { node: b, port: "value" } } }])), "WORKFLOW_EDGE_DUPLICATE");
  assert.equal(codeOf(() => draft.apply([{ op: "edge.add", edge: { id: "self", from: { node: a, port: "done" }, to: { node: a, port: "start" } } }])), "WORKFLOW_EDGE_SELF");
  const result = draft.apply([{ op: "node.remove", id: a }]);
  assert.equal(draft.doc.edges.length, 0);
  draft.apply(result.inverse);
  assert.equal(draft.doc.edges.length, 2);
  assert.ok(draft.node(a));
});

test("Parameters: Secret-like parameter name", () => {
  const draft = new Draft();
  const error = errorOf(() => draft.apply([{ op: "param.set", parameters: [{ name: "apiKey", label: "Key", type: "string", required: false, help: "", secret: false }] }]));
  assert.equal(error.code, "WORKFLOW_PARAM_SECRET");
  assert.equal(error.message, "Secrets are configured in host settings, not in workflows");
});

test("Parameters: a parameter is an output of the trigger; removing it removes its edges and undo restores both", () => {
  const draft = new Draft();
  draft.apply([{ op: "param.set", parameters: [{ name: "topic", label: "Topic", type: "text", required: true, help: "", secret: false }] }]);
  assert.ok(draft.node("start").outputs.some((port) => port.id === "topic" && port.type === "text"));
  const agent = draft.add("agent");
  draft.link("start.topic", `${agent}.input`);
  const result = draft.apply([{ op: "param.set", parameters: [] }]);
  assert.equal(draft.doc.edges.length, 0);
  draft.apply(result.inverse);
  assert.equal(draft.doc.edges.length, 1);
  assert.equal(draft.doc.parameters.length, 1);
});

test("Size limits: Node limit", () => {
  const draft = new Draft();
  const ops: WorkflowOp[] = [];
  for (let index = 0; index < 199; index++) ops.push({ op: "node.add", node: { id: `n${index}`, type: "wait", position: { x: index * 20, y: 0 } } });
  draft.apply(ops);
  assert.equal(draft.doc.nodes.length, 200);
  const error = errorOf(() => draft.apply([{ op: "node.add", node: { id: "extra", type: "wait" } }]));
  assert.equal(error.code, "WORKFLOW_LIMIT_EXCEEDED");
  assert.equal(error.details.limit, "nodes");
  assert.equal(error.details.max, 200);
});

test("Size limits: Document too large", () => {
  const draft = new Draft();
  const ops: WorkflowOp[] = [];
  for (let index = 0; index < 100; index++) ops.push({ op: "note.add", note: { id: `note${index}`, text: "x".repeat(2000), x: 0, y: 0, width: 200, height: 100 } });
  draft.apply(ops);
  const node = draft.add("wait");
  const before = draft.doc;
  // Descriptions push the canonical document past 768 KiB.
  const many: WorkflowOp[] = [];
  for (let index = 0; index < 190; index++) many.push({ op: "node.add", node: { id: `big${index}`, type: "notify", config: { title: "t", body: "b".repeat(500), level: "info", target: "run_starter", link: "run" }, description: "d".repeat(500), inputs: Array.from({ length: 30 }, (_, port) => ({ id: `p${port}`, label: "l".repeat(60), type: "any" })) } });
  assert.equal(codeOf(() => draft.apply(many)), "PAYLOAD_TOO_LARGE");
  assert.equal(draft.doc, before);
  assert.ok(draft.node(node));
});

test("Graph operations: Atomic batch", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a", { outputs: [{ id: "track", label: "track", type: "MusicTrack" }] });
  const b = draft.add("wait", "b", { inputs: [{ id: "captions", label: "captions", type: "CaptionSet" }] });
  const before = draft.doc;
  const error = errorOf(() => draft.apply([
    { op: "node.move", id: a, position: { x: 0, y: 0 } }, { op: "node.update", id: a, patch: { name: "A" } }, { op: "node.add", node: { id: "c", type: "wait" } },
    { op: "edge.add", edge: { id: "bad", kind: "data", from: { node: a, port: "track" }, to: { node: b, port: "captions" } } }, { op: "node.move", id: b, position: { x: 40, y: 40 } },
  ]));
  assert.equal(error.code, "WORKFLOW_TYPE_MISMATCH");
  assert.equal(error.details.opIndex, 3);
  assert.equal(draft.doc, before);
});

test("Graph operations: Removing the trigger", () => {
  const draft = new Draft();
  assert.equal(codeOf(() => draft.apply([{ op: "node.remove", id: "start" }])), "WORKFLOW_TRIGGER_REQUIRED");
  assert.deepEqual(wf.deleteOps(draft.doc, { nodeIds: ["start"] }), []);
});

test("Graph operations: Concurrent edit of the same node conflicts; a different node or a move does not", () => {
  const changed = (ref: wf.ObjectRef) => (ref.kind === "node" && ref.id === "brief" ? 9 : undefined);
  assert.deepEqual(wf.conflictsOf([{ op: "node.update", id: "brief", patch: { name: "x" } }], changed), [{ opIndex: 0, kind: "node", id: "brief", changedInRevision: 9 }]);
  assert.deepEqual(wf.conflictsOf([{ op: "node.update", id: "other", patch: { name: "x" } }], changed), []);
  assert.deepEqual(wf.conflictsOf([{ op: "node.move", id: "brief", position: { x: 0, y: 0 } }], changed), []);
  assert.deepEqual(wf.conflictsOf([{ op: "param.set", parameters: [] }], (ref) => (ref.kind === "section" && ref.id === "parameters" ? 4 : undefined)), [{ opIndex: 0, kind: "section", id: "parameters", changedInRevision: 4 }]);
});

test("Graph operations: every operation has an inverse that restores the document exactly", () => {
  const draft = new Draft();
  const a = draft.add("agent", "a"), b = draft.add("notify", "b"), c = draft.add("branch", "c");
  draft.link("start", a);
  const edge = draft.link(`${a}.text`, `${b}.value`);
  draft.apply(wf.groupOps(draft.doc, [a, b]));
  draft.apply(wf.noteOps(draft.doc, { x: 0, y: 0 }).ops);
  const batches: WorkflowOp[][] = [
    [{ op: "node.add", node: { id: "w", type: "wait" } }],
    [{ op: "node.update", id: a, patch: { name: "Writer", config: { ...draft.node(a).config, maxTurns: 2 }, onError: "continue" } }],
    [{ op: "node.update", id: a, patch: { outputs: [{ id: "session", label: "session", type: "json" }] } }],
    [{ op: "node.update", id: c, patch: { config: { cases: [{ id: "big", label: "Big", condition: { all: [] } }], mode: "first_match" } } }],
    [{ op: "node.move", id: a, position: { x: 33, y: 47 } }], [{ op: "node.resize", id: a, size: { width: 300, height: 120 } }], [{ op: "node.remove", id: a }],
    [{ op: "edge.update", id: edge, patch: { label: "draft", route: { style: "orthogonal", waypoints: [{ x: 20, y: 20 }], labelT: 0.3 } } }], [{ op: "edge.remove", id: edge }],
    [{ op: "group.update", id: "group", patch: { label: "Renamed", nodeIds: [a] } }], [{ op: "group.remove", id: "group" }],
    [{ op: "note.update", id: "note", patch: { text: "Remember" } }], [{ op: "note.remove", id: "note" }],
    [{ op: "param.set", parameters: [{ name: "topic", label: "Topic", type: "text", required: false, help: "", secret: false }] }],
    [{ op: "var.set", variables: [{ name: "notes", type: "list<text>", mode: "append" }] }], [{ op: "output.set", outputs: [{ name: "answer", type: "text", from: { node: a, port: "text" } }] }],
    [{ op: "settings.update", patch: { maxParallel: 2 } }], [{ op: "meta.update", patch: { name: "Renamed", description: "About" } }], [{ op: "viewport.set", viewport: { x: 10, y: 20, zoom: 2 } }],
    [{ op: "layout.apply", positions: wf.layout(draft.doc).positions, routes: wf.layout(draft.doc).routes }],
  ];
  for (const ops of batches) {
    const before = wf.canonical(draft.doc);
    const result = draft.apply(ops);
    assert.notEqual(wf.canonical(draft.doc), before, `${ops[0].op} changes the document`);
    draft.apply(result.inverse);
    assert.equal(wf.canonical(draft.doc), before, `${ops[0].op} is undone exactly`);
  }
  // A moved node lands on the 20-unit grid.
  draft.apply([{ op: "node.move", id: a, position: { x: 33, y: 47 } }]);
  assert.deepEqual(draft.node(a).position, { x: 40, y: 40 });
});

test("Graph operations: an agent cannot set a node's protected flag", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a");
  draft.apply([{ op: "node.update", id: a, patch: { protected: true, name: "Kept" } }], "agent");
  assert.equal(draft.node(a).protected, false);
  assert.equal(draft.node(a).name, "Kept");
  draft.apply([{ op: "node.update", id: a, patch: { protected: true } }], "device");
  assert.equal(draft.node(a).protected, true);
});

test("Deterministic auto-layout: Idempotent", () => {
  const draft = new Draft();
  const a = draft.add("agent", "a"), b = draft.add("notify", "b"), c = draft.add("notify", "c"), fallback = draft.add("notify", "fallback");
  draft.chain("start", a, b);
  draft.link(a, c);
  draft.apply([{ op: "node.update", id: a, patch: { onError: "route" } }]);
  draft.link(`${a}.error`, fallback);
  const first = wf.layoutBatch(draft.doc);
  assert.equal(first.length, 1);
  draft.apply(first);
  assert.deepEqual(wf.layoutBatch(draft.doc), []);
  // Layers 320 apart (a card and 80 of room), rows 160 apart (a card and 56 of room), on the grid; the error target is below the other rows of its layer.
  assert.equal(draft.node(a).position.x - draft.node("start").position.x, 320);
  assert.equal(draft.node(c).position.y - draft.node(b).position.y, 160);
  assert.ok(draft.node(fallback).position.y > draft.node(c).position.y);
  for (const node of draft.doc.nodes) assert.ok(node.position.x % 20 === 0 && node.position.y % 20 === 0);
});

test("Deterministic auto-layout: Agent omits a position", () => {
  const draft = new Draft();
  draft.add("agent", "script", {}, { x: 320, y: 200 });
  draft.apply([{ op: "node.add", node: { id: "voice", type: "notify", position: wf.placeAlone(draft.doc, "script") } }]);
  assert.deepEqual(draft.node("voice").position, { x: 640, y: 200 });
  draft.apply([{ op: "node.add", node: { id: "music", type: "notify", position: wf.placeAlone(draft.doc, "script") } }]);
  assert.deepEqual(draft.node("music").position, { x: 640, y: 360 });
});

test("Deterministic auto-layout: Partial layout", () => {
  const draft = new Draft();
  const a = draft.add("wait", "a", {}, { x: 1000, y: 1000 }), b = draft.add("wait", "b", {}, { x: 1000, y: 1200 }), c = draft.add("wait", "c", {}, { x: 60, y: 60 });
  draft.chain("start", a, b, c);
  const kept = draft.node(c).position, trigger = draft.node("start").position;
  draft.apply(wf.layoutBatch(draft.doc, [a, b]));
  assert.deepEqual(draft.node(c).position, kept);
  assert.deepEqual(draft.node("start").position, trigger);
  assert.notDeepEqual(draft.node(a).position, { x: 1000, y: 1000 });
});
