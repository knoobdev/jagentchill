import type { WorkflowDocument, WorkflowNodeType, WorkflowOp, WorkflowRunChange } from "@jagentchill/protocol";
import { workflow as wf } from "../../src/index.ts";

/** A document under construction: every step goes through the same batches the canvas submits. */
export class Draft {
  doc: WorkflowDocument;
  constructor(name = "Test", id = "wf_test") { this.doc = wf.createDocument({ id, name, now: 1000 }); }
  apply(ops: WorkflowOp[], actor?: "device" | "agent") { const result = wf.applyBatch(this.doc, ops, actor ? { actor } : {}); this.doc = result.doc; return result; }
  add(type: WorkflowNodeType, id?: string, patch: Record<string, unknown> = {}, at = { x: 400, y: 200 }): string {
    const node = wf.makeNode(this.doc, type, at, id);
    this.apply([{ op: "node.add", node: { ...node, ...patch, config: { ...node.config, ...((patch.config as object) ?? {}) } } }]);
    return node.id;
  }
  /** Connects `a.port` to `b.port`; a bare node id means the control ports `done` → `start`. */
  link(from: string, to: string): string {
    const [fromNode, fromPort = "done"] = from.split("."), [toNode, toPort = "start"] = to.split(".");
    const { ops, edgeId } = wf.connectOps(this.doc, { node: fromNode, port: fromPort }, { node: toNode, port: toPort });
    this.apply(ops);
    return edgeId;
  }
  chain(...ids: string[]): void { for (let index = 1; index < ids.length; index++) this.link(ids[index - 1], ids[index]); }
  node(id: string) { return this.doc.nodes.find((node) => node.id === id)!; }
}

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
export async function settle(times = 6): Promise<void> { for (let index = 0; index < times; index++) await tick(); }

export type Harness = { engine: wf.RunEngine; state: wf.RunState; changes: WorkflowRunChange[]; logs: Array<{ nodeId: string; level: string; message: string }>; clock: { now: number }; statusOf(nodeId: string, path?: string): string | undefined; statuses(nodeId: string): string[] };
/** A run of a document on a clock the test moves. Executors are the test's: the engine itself is the real one. */
export function harness(doc: WorkflowDocument, options: { executors?: wf.EngineHooks["executors"]; params?: Record<string, unknown>; gatewayReady?: () => boolean; attended?: () => boolean; state?: wf.RunState } = {}): Harness {
  const clock = { now: 10_000 };
  const changes: WorkflowRunChange[] = [], logs: Harness["logs"] = [];
  const state = options.state ?? wf.newRunState({ runId: "run1", number: 1, origin: "user", doc, params: wf.resolveParams(doc, options.params ?? {}), now: clock.now });
  const engine = new wf.RunEngine(state, {
    now: () => clock.now, executors: options.executors ?? {}, commit: (_state, batch) => { changes.push(...batch); }, log: (entry) => logs.push(entry),
    ...(options.gatewayReady ? { gatewayReady: options.gatewayReady } : {}),
    ...(options.attended ? { attended: options.attended } : {}),
  });
  return {
    engine, state, changes, logs, clock,
    statusOf: (nodeId, path = "") => state.executions[wf.execKey(nodeId, path)]?.status,
    statuses: (nodeId) => changes.filter((change) => change.kind === "node.status" && change.nodeId === nodeId).map((change) => (change as { status: string }).status),
  };
}
export const codeOf = (run: () => unknown): string | undefined => { try { run(); } catch (error) { return (error as { code?: string }).code; } return undefined; };
export const errorOf = (run: () => unknown): wf.WorkflowError => { try { run(); } catch (error) { return error as wf.WorkflowError; } throw new Error("expected a failure"); };
