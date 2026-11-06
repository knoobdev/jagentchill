import type { WorkflowDocument, WorkflowEdge } from "@jagentchill/protocol";

/** One enclosing body of a node: a loop iteration or a fan-out item. */
export type BodyOwner = { kind: "loop" | "parallel"; id: string };
export type GraphInfo = {
  /** Outgoing and incoming edges per node, without `loop_back` edges. */
  out: Map<string, WorkflowEdge[]>; in: Map<string, WorkflowEdge[]>;
  /** The bodies each node is inside, outermost first. A loop or parallel node is not inside its own body. */
  chain: Map<string, BodyOwner[]>;
  /** The nodes of each body, by owner id. */
  body: Map<string, Set<string>>;
  /** Longest-path depth from the nodes without predecessors. */
  depth: Map<string, number>;
  /** Node ids of one cycle of the graph without loop-back edges, when there is one. */
  cycle?: string[];
  /** The join paired with each parallel node. */
  joinOf: Map<string, string>;
};

function reach(start: string[], next: (id: string) => string[], stop?: (id: string) => boolean): Set<string> {
  const seen = new Set<string>(), queue = [...start];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id) || stop?.(id)) continue;
    seen.add(id);
    queue.push(...next(id));
  }
  return seen;
}

export function analyse(doc: Pick<WorkflowDocument, "nodes" | "edges">): GraphInfo {
  const active = new Set(doc.nodes.filter((node) => !node.disabled).map((node) => node.id));
  const out = new Map<string, WorkflowEdge[]>(), incoming = new Map<string, WorkflowEdge[]>();
  for (const node of doc.nodes) { out.set(node.id, []); incoming.set(node.id, []); }
  for (const edge of doc.edges) {
    if (edge.kind === "loop_back" || !out.has(edge.from.node) || !incoming.has(edge.to.node)) continue;
    out.get(edge.from.node)!.push(edge);
    incoming.get(edge.to.node)!.push(edge);
  }
  const successors = (id: string) => (out.get(id) ?? []).map((edge) => edge.to.node);
  const predecessors = (id: string) => (incoming.get(id) ?? []).map((edge) => edge.from.node);

  // Cycle detection and depth by depth-first search over the acyclic part.
  let cycle: string[] | undefined;
  const state = new Map<string, 1 | 2>(), stack: string[] = [], depth = new Map<string, number>();
  const visit = (id: string): number => {
    if (state.get(id) === 2) return depth.get(id)!;
    if (state.get(id) === 1) { cycle ??= stack.slice(stack.indexOf(id)); return 0; }
    state.set(id, 1); stack.push(id);
    let value = 0;
    for (const from of predecessors(id)) value = Math.max(value, visit(from) + 1);
    stack.pop(); state.set(id, 2); depth.set(id, value);
    return value;
  };
  for (const node of doc.nodes) visit(node.id);

  const body = new Map<string, Set<string>>(), joinOf = new Map<string, string>();
  for (const node of doc.nodes) {
    if (node.type === "parallel") {
      const forward = reach(successors(node.id), successors);
      const joins = doc.nodes.filter((entry) => entry.type === "join" && forward.has(entry.id));
      const named = joins.find((entry) => entry.id === node.config.joinId || entry.config.parallelId === node.id);
      // Without an explicit pairing the nearest join downstream is the pair.
      const join = named ?? joins.sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0];
      if (join) joinOf.set(node.id, join.id);
      // The body is what the fan-out reaches before its join; a step the join also reaches comes after the body.
      const after = join ? reach(successors(join.id), successors) : new Set<string>();
      body.set(node.id, new Set([...reach(successors(node.id), successors, (id) => id === join?.id)].filter((id) => !after.has(id))));
    } else if (node.type === "loop") {
      const sources = doc.edges.filter((edge) => edge.kind === "loop_back" && edge.to.node === node.id).map((edge) => edge.from.node);
      const fromBody = (out.get(node.id) ?? []).filter((edge) => edge.from.port === "body").map((edge) => edge.to.node);
      const forward = reach(fromBody, successors);
      const backward = reach(sources, predecessors, (id) => id === node.id);
      body.set(node.id, new Set([...forward].filter((id) => backward.has(id))));
    }
  }
  const chain = new Map<string, BodyOwner[]>();
  for (const node of doc.nodes) {
    const owners = [...body.entries()].filter(([owner, members]) => owner !== node.id && members.has(node.id) && active.has(owner));
    // An outer body contains the owner of an inner one.
    owners.sort(([a, membersA], [b, membersB]) => (membersA.has(b) ? -1 : membersB.has(a) ? 1 : membersB.size - membersA.size));
    chain.set(node.id, owners.map(([id]) => ({ kind: doc.nodes.find((entry) => entry.id === id)!.type as "loop" | "parallel", id })));
  }
  return { out, in: incoming, chain, body, depth, joinOf, ...(cycle ? { cycle } : {}) };
}

/** The canonical string of an execution address: `L:<loop>#<iteration>` and `P:<parallel>#<item>` joined by `/`. */
export type Frame = { loop: string; iteration: number } | { parallel: string; item: number };
export const frameText = (frame: Frame): string => ("loop" in frame ? `L:${frame.loop}#${frame.iteration}` : `P:${frame.parallel}#${frame.item}`);
export const pathText = (frames: Frame[]): string => frames.map(frameText).join("/");
export function parsePath(path: string): Frame[] {
  if (!path) return [];
  return path.split("/").map((piece) => {
    const match = /^([LP]):([^#/:]+)#(\d+)$/.exec(piece);
    if (!match) throw new Error(`Not an execution address: ${path}`);
    return match[1] === "L" ? { loop: match[2], iteration: Number(match[3]) } : { parallel: match[2], item: Number(match[3]) };
  });
}
