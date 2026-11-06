import { workflow as wf } from "@jagentchill/editor-core";
import type { AutomationSchedule, WorkflowDocument, WorkflowEdge, WorkflowEdgeState, WorkflowNode, WorkflowNodeStatus } from "@jagentchill/protocol";
import type { ColorToken, Theme } from "@jagentchill/ui";
import type { T } from "../locale";
import { CONDITION_OP_LABELS, KIND_LABELS, NODE_LABELS, NODE_NOTES, PORT_LABELS, clock, kindOf, typeToken } from "./strings";

/**
 * How the workflow diagram looks: the colours of a card and of an edge, and the words a card and an edge carry. The
 * canvas and the exported picture both draw from here, so they cannot drift apart. Every colour is derived from the
 * design tokens — a tint is a token mixed into the surface under it.
 */
const channels = (color: string): [number, number, number] | null => (/^#[0-9a-f]{6}$/i.test(color) ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)] : null);
/** `tint` laid over `base` at an opacity, as one opaque colour. */
export function mix(base: string, tint: string, amount: number): string {
  const a = channels(base), b = channels(tint);
  if (!a || !b) return base;
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}
export function alpha(color: string, amount: number): string {
  const rgb = channels(color);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${amount})` : color;
}

export type CardLook = { /** The colour of the kind: the icon and what tints its tile. */ tone: string; token: ColorToken; /** The fill of the icon tile. */ tile: string; surface: string; border: string };
/**
 * The colours of a card: a neutral raised surface with a hairline border. The colour of the kind appears in one place
 * only — the icon tile — so a graph reads as a row of cards and not as a set of coloured boxes.
 */
export function cardLook(theme: Theme, type: WorkflowNode["type"], status?: WorkflowNodeStatus): CardLook {
  const dark = theme.scheme === "dark", surface = theme.color("bg/elevated"), token = typeToken(type), tone = theme.color(token);
  const border = status === "failed" ? theme.color("danger") : status === "waiting_approval" ? theme.color("warning") : status === "running" ? theme.color("accent") : theme.color(dark ? "border/strong" : "border/hairline");
  return { tone, token, tile: mix(surface, tone, dark ? 0.24 : 0.14), surface, border };
}
/** The neutral line of an edge: between the strong border and the idle-edge colour, so it reads on the canvas without shouting. */
export const edgeNeutral = (theme: Theme): string => mix(theme.color("border/strong"), theme.color("wf/edge-idle"), theme.scheme === "dark" ? 0.75 : 0.55);

export type EdgeLook = { color: string; token: ColorToken; width: number; dash?: string; opacity: number; glow: number };
/** An output a step fires only in some outcome: its edges are drawn dashed. */
export const isConditional = (edge: Pick<WorkflowEdge, "kind" | "from">): boolean => edge.kind === "error" || edge.kind === "loop_back" || (edge.kind === "control" && edge.from.port !== "done");
/**
 * The line of an edge: neutral, two units wide, dashed for a path taken only in some outcome. Colour says state and
 * nothing else — the accent for what is selected or carrying data now, success for what delivered, danger for what failed.
 */
export function edgeLook(theme: Theme, edge: WorkflowEdge, _source: WorkflowNode | undefined, state: { selected?: boolean; hovered?: boolean; run?: WorkflowEdgeState; running?: boolean }): EdgeLook {
  const token: ColorToken | null = state.selected || state.run === "flowing" ? "accent" : state.run === "error" ? "danger" : state.run === "delivered" ? "success" : null;
  const color = token ? theme.color(token) : state.hovered ? theme.color("text/tertiary") : edgeNeutral(theme);
  return {
    color, token: token ?? "text/secondary", opacity: state.running && !token ? (state.run === "skipped" ? 0.4 : 0.7) : 1, width: state.selected ? 2.5 : 2,
    dash: isConditional(edge) ? "6 6" : undefined, glow: state.selected ? 0.18 : 0,
  };
}

/** A port the author gave no label is said by its id made readable: `changes_requested` reads "Changes requested". */
const readable = (id: string): string => { const words = id.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim(); return words ? words[0].toUpperCase() + words.slice(1) : id; };
/**
 * The words on an edge: the output it carries when its step has several, or "On error". An outcome a step fires by
 * name is not repeated on the edge — it is a labelled row of the card the edge leaves. Plain order and a step's first output say nothing.
 */
export function edgeLabel(doc: Pick<WorkflowDocument, "nodes">, edge: WorkflowEdge, t: T): string | undefined {
  const source = doc.nodes.find((node) => node.id === edge.from.node);
  if (!source) return undefined;
  if (edge.kind === "control" || edge.kind === "error") return edge.from.port === "error" ? t(PORT_LABELS.error) : undefined;
  const index = source.outputs.findIndex((port) => port.id === edge.from.port);
  if (index <= 0) return undefined;
  const port = source.outputs[index];
  return port.label && port.label !== port.id ? port.label : readable(port.id);
}
/** What a port is called: on its handle, on its row and in the helper card. */
export const portLabel = (port: wf.CanvasPort, t: T): string => (port.control && PORT_LABELS[port.id] ? t(PORT_LABELS[port.id]) : port.label === port.id ? readable(port.id) : port.label);

const short = (text: string, max = 64): string => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
type Leaf = { left?: unknown; op?: string; right?: unknown };
function conditionText(condition: unknown, t: T): string | undefined {
  const group = condition as { all?: Leaf[]; any?: Leaf[] } | undefined, leaves = group?.all ?? group?.any ?? [];
  const first = leaves[0];
  if (!first?.op) return undefined;
  const op = (CONDITION_OP_LABELS as Record<string, string>)[first.op];
  const text = [String(first.left ?? ""), (op ? t(op) : first.op).toLowerCase(), first.right === undefined || first.op === "exists" || first.op === "is_empty" ? "" : String(first.right)].filter(Boolean).join(" ");
  return leaves.length > 1 ? `${text} +${leaves.length - 1}` : text;
}

/**
 * What a card says under its header: a line in plain words, and the few settings worth seeing at a glance as chips —
 * the model, the schedule, the condition. Never a port name.
 */
export function cardFacts(node: WorkflowNode, t: T): { summary: string; chips: string[] } {
  const config = node.config as Record<string, unknown>, note = () => t(NODE_NOTES[node.type] ?? NODE_LABELS[node.type]);
  switch (node.type) {
    case "trigger": {
      const sources = ((config.sources as Array<{ kind?: string; enabled?: boolean; schedule?: AutomationSchedule }> | undefined) ?? []).filter((source) => source.enabled !== false);
      const schedule = sources.find((source) => source.kind === "schedule");
      if (!schedule) return { summary: t("Runs when you start it"), chips: [] };
      let when = "";
      if (schedule.schedule) { try { when = short(wf.scheduleText(schedule.schedule), 40); } catch { when = ""; } }
      return { summary: t("On a schedule"), chips: when ? [when] : [] };
    }
    case "agent": {
      const runtime = config.runtime as { mode?: string; role?: string; model?: string } | undefined;
      const who = runtime?.mode === "override" ? String(runtime.model ?? "") : String(runtime?.role ?? "");
      const prompt = String(config.promptTemplate ?? "").trim();
      return { summary: /^\{\{[^}]*\}\}$/.test(prompt) || !prompt ? t("Answers its input") : short(prompt, 90), chips: who ? [short(who, 32)] : [] };
    }
    case "approval": return { summary: short(String(config.title ?? ""), 90) || note(), chips: [] };
    case "branch": {
      const cases = (config.cases as Array<{ condition?: unknown }> | undefined) ?? [], first = conditionText(cases[0]?.condition, t);
      return { summary: note(), chips: [short(first ?? t("{n} paths", { n: cases.length + 1 }), 36)] };
    }
    case "loop": return { summary: note(), chips: [short(conditionText(config.continueWhile, t) ?? t("Repeats up to {n} times", { n: Number(config.maxIterations ?? 1) }), 36)] };
    case "parallel": return { summary: note(), chips: [t("Up to {n} at once", { n: Number(config.concurrency ?? 1) })] };
    case "join": return { summary: note(), chips: [] };
    case "wait": return { summary: note(), chips: [config.mode === "until" ? short(String(config.until ?? ""), 32) : clock(Number(config.seconds ?? 0) * 1000)].filter(Boolean) };
    case "human_input": return { summary: short(String(config.title ?? ""), 90) || note(), chips: [(Array.isArray(config.fields) && config.fields.length === 1 ? t("1 field") : t("{n} fields", { n: Array.isArray(config.fields) ? config.fields.length : 0 }))] };
    case "notify": return { summary: short(String(config.title ?? ""), 90) || note(), chips: [] };
    default: return { summary: note(), chips: [] };
  }
}
/** The quiet word under a step's name: its type, or its kind when the step is still named after its type. */
export function kindLabel(node: Pick<WorkflowNode, "type" | "name">, t: T): string {
  const type = t(NODE_LABELS[node.type]), kind = t(KIND_LABELS[kindOf(node.type)] ?? KIND_LABELS.unknown);
  return node.name.trim() !== type ? type : kind !== type ? kind : "";
}

/** One line saying what a step does, from its configuration, in plain words. */
export function nodeSummary(node: WorkflowNode, t: T): string {
  const config = node.config as Record<string, unknown>, fallback = () => t(NODE_NOTES[node.type] ?? NODE_LABELS[node.type]);
  switch (node.type) {
    case "trigger": {
      const sources = ((config.sources as Array<{ kind?: string; enabled?: boolean; schedule?: AutomationSchedule }> | undefined) ?? []).filter((source) => source.enabled !== false);
      const schedule = sources.find((source) => source.kind === "schedule");
      if (schedule?.schedule) { try { return short(wf.scheduleText(schedule.schedule)); } catch { return t("On a schedule"); } }
      return schedule ? t("On a schedule") : t("Runs when you start it");
    }
    case "agent": {
      const runtime = config.runtime as { mode?: string; role?: string; model?: string } | undefined;
      const who = runtime?.mode === "override" ? String(runtime.model ?? "") : String(runtime?.role ?? "");
      const prompt = String(config.promptTemplate ?? "").trim(), plain = /^\{\{[^}]*\}\}$/.test(prompt) || !prompt ? t("Answers its input") : short(prompt, 48);
      return who ? `${who} · ${plain}` : plain;
    }
    case "approval": return short(String(config.title ?? "")) || fallback();
    case "branch": {
      const cases = (config.cases as Array<{ condition?: unknown }> | undefined) ?? [];
      return short(conditionText(cases[0]?.condition, t) ?? t("{n} paths", { n: cases.length + 1 }));
    }
    case "loop": return short(conditionText(config.continueWhile, t) ?? t("Repeats up to {n} times", { n: Number(config.maxIterations ?? 1) }));
    case "parallel": return t("Up to {n} at once", { n: Number(config.concurrency ?? 1) });
    case "join": return t("Collects the results");
    case "wait": return config.mode === "until" ? t("Waits until {moment}", { moment: short(String(config.until ?? ""), 32) }) : t("Waits {time}", { time: clock(Number(config.seconds ?? 0) * 1000) });
    case "human_input": {
      const fields = Array.isArray(config.fields) ? config.fields.length : 0, title = short(String(config.title ?? ""), 40);
      return [title, t("{n} fields", { n: fields })].filter(Boolean).join(" · ");
    }
    case "notify": return short(String(config.title ?? "")) || fallback();
    default: return fallback();
  }
}

/** The kinds a workflow uses, in the order of their first step, with how many steps each has: the legend. */
export function kindsInUse(doc: Pick<WorkflowDocument, "nodes">): Array<{ kind: string; type: WorkflowNode["type"]; count: number }> {
  const seen = new Map<string, { kind: string; type: WorkflowNode["type"]; count: number }>();
  for (const node of doc.nodes) { const kind = kindOf(node.type), entry = seen.get(kind); if (entry) entry.count++; else seen.set(kind, { kind, type: node.type, count: 1 }); }
  return [...seen.values()];
}
