import type { WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowParameter, WorkflowPort } from "@jagentchill/protocol";
import { graphHash } from "../workflow/nodes.ts";

/**
 * The film pipeline as a workflow document the engine runs like any other: every stage is a `tool` node naming a step
 * tool of the host (`jc_film_*`), every hand-over between stages is an `approval` node. The stages work on the film
 * document itself (their input is its id), so a person editing a screen and a stage of the run change the same film,
 * and a stage that runs again makes only what is missing or outdated.
 */
export const FILM_TEMPLATE_ID = "tpl.film-pipeline";
export const PIPELINE_MODES = ["checkpoints", "auto"] as const;
export type PipelineMode = (typeof PIPELINE_MODES)[number];
export const PIPELINE_STAGES = [
  { id: "breakdown", label: "Script", check: "check_breakdown", studio: "story", next: "assets" },
  { id: "asset_images", label: "Assets", check: "check_assets", studio: "assets", next: "storyboard" },
  { id: "panel_images", label: "Storyboard", check: "check_storyboard", studio: "storyboard", next: "voice" },
  { id: "voice", label: "Voice", check: "check_voice", studio: "voice", next: "timeline" },
  { id: "music", label: "Music", check: null, studio: "voice", next: "timeline" },
  { id: "assemble", label: "Timeline", check: null, studio: "timeline", next: "timeline" },
] as const;
export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];
/** The checkpoints in the words a person reads, and the studio stage each one is reviewed on. */
export const CHECKPOINTS: readonly { id: string; title: string; instructions: string; studio: "story" | "assets" | "storyboard" | "voice" | "timeline" }[] = [
  { id: "check_breakdown", title: "Check the cast and the script", instructions: "Read the characters, places and panels the story was turned into. Edit them, then approve to make the reference pictures.", studio: "assets" },
  { id: "check_assets", title: "Check the reference pictures", instructions: "Every panel is drawn from these pictures. Regenerate or edit any of them, then approve to draw the storyboard.", studio: "assets" },
  // The ONE money question of a run, asked when the script exists and the cost of the pictures, the voice and the music
  // can be told. It waits in every mode, and only when the estimate is above the host's "Ask before spending more
  // than" (or unknown) and the person has not confirmed it at the start. What it asks is written by the step `cost`.
  { id: "confirm_cost", title: "Confirm the cost of this film", instructions: "The script is written: see what the pictures, the voice and the music are estimated to cost, then approve to make them.", studio: "assets" },
  // Not a review of finished work: the storyboard stage cannot go on by itself — some frames could not be had (refused
  // by the provider, or drawn wrong three times). It waits in every mode. What it asks is written by the stage (`ask`,
  // `askTitle` of its summary), so the request names the frames; the words here are what a screen shows when it has
  // no request at hand. Nothing else stops here: what is sent to a connected provider is never asked about.
  // One checkpoint per round: a frame refused again after a person changed it comes back to a person, STORYBOARD_ROUNDS times.
  ...([1, 2, 3] as const).map((round) => ({ id: round === 1 ? "fix_storyboard" : `fix_storyboard_${round}`, title: "The storyboard needs you", instructions: "The storyboard cannot go on by itself: open it to see what it asks, decide, then approve.", studio: "storyboard" as const })),
  { id: "check_storyboard", title: "Check the storyboard", instructions: "Reorder, retime or redraw panels, then approve to record the voice lines.", studio: "storyboard" },
  { id: "check_voice", title: "Check the voice lines", instructions: "Listen to the takes, then approve to assemble the timeline.", studio: "voice" },
];
/**
 * A started run asks no money question again until its spending would pass this share of what was confirmed for it
 * (ASSUMPTION: the spec states no rule for a run that outgrows its estimate; the same share as the video from a prompt).
 */
export const CONFIRMED_SHARE = 1.2;
/** How many times the storyboard stage comes back to a person before it stops as failed. */
export const STORYBOARD_ROUNDS = 3;

const PARAMETERS: WorkflowParameter[] = [
  { name: "filmId", label: "Film", type: "string", required: true, maxLength: 64, help: "The film this run works on", secret: false },
  { name: "mode", label: "Approvals", type: "string", required: false, default: "checkpoints", enum: [...PIPELINE_MODES], help: "", secret: false },
  { name: "model", label: "Writing model", type: "json", required: false, help: "The chat model that turns the story into the script", secret: false },
];
const port = (id: string, type: string, required = false): WorkflowPort => ({ id, label: id, type, ...(required ? { required: true } : {}) });

export function buildFilmTemplate(now: number): WorkflowDocument {
  const nodes: WorkflowNode[] = [], edges: WorkflowEdge[] = [];
  let column = 0;
  /** `after`: the steps this one follows — by their `done` port, or by the named port of a branch (`[node, port]`). */
  const add = (node: Pick<WorkflowNode, "id" | "type" | "name" | "config" | "inputs" | "outputs"> & { row?: number; timeout_s?: number }, after: (string | [node: string, port: string])[], data: [from: string, fromPort: string, toPort: string][]): void => {
    const { row = 0, ...rest } = node;
    if (row === 0) column += 1;
    nodes.push({ ...rest, description: "", position: { x: 120 + column * 260, y: 200 + row * 140 }, onError: "fail", cache: "off", assign: [], protected: true, disabled: false });
    for (const entry of after) { const [from, fromPort] = typeof entry === "string" ? [entry, "done"] : entry; edges.push({ id: `c_${from}_${node.id}`, kind: "control", from: { node: from, port: fromPort }, to: { node: node.id, port: "start" }, label: "", route: { style: "bezier", waypoints: [], labelT: 0.5 } }); }
    for (const [from, fromPort, toPort] of data) edges.push({ id: `d_${from}_${fromPort}_${node.id}_${toPort}`, kind: "data", from: { node: from, port: fromPort }, to: { node: node.id, port: toPort }, label: "", route: { style: "bezier", waypoints: [], labelT: 0.5 } });
  };
  const params: [string, string, string] = ["start", "params", "params"];
  const stage = (id: string, name: string, tool: string, after: (string | [string, string])[], row = 0, args: Record<string, unknown> = {}) =>
    add({ id, type: "tool", name, config: { tool, args }, inputs: [port("params", "json", true)], outputs: [port("summary", "json"), port("costUsd", "number")], row, timeout_s: 3600 }, after, [params]);
  /** `overridable: false` — a checkpoint that waits for a person in every mode, also when the run was started without checkpoints. */
  const check = (id: string, from: string, after: (string | [string, string])[] = [from], overridable = true, row = 0) => {
    const found = CHECKPOINTS.find((entry) => entry.id === id)!;
    add({ id, type: "approval", name: found.title, config: { policy: { mode: "human" }, title: found.title, instructions: found.instructions, allowEdit: false, overridable, assignee: "any_editor" }, inputs: [port("subject", "any", true)], outputs: [port("subject", "any"), port("decision", "Decision")], row }, after, [[from, "summary", "subject"]]);
  };
  nodes.push({
    id: "start", type: "trigger", name: "Start", description: "", config: { sources: [{ kind: "manual", enabled: true }] }, inputs: [],
    outputs: [port("params", "json"), port("trigger", "json"), ...PARAMETERS.map((param) => ({ id: param.name, label: param.label, type: param.type }))],
    position: { x: 120, y: 200 }, onError: "fail", cache: "off", assign: [], protected: true, disabled: false,
  });
  stage("breakdown", "Script", "jc_film_breakdown", ["start"]);
  check("check_breakdown", "breakdown");
  // Money is asked once, here: the first step that knows what the run will make. Everything after it is paid work.
  stage("cost", "Cost", "jc_film_cost", ["check_breakdown"]);
  add({ id: "cost_gate", type: "branch", name: "Needs a confirmation?", config: { cases: [{ id: "needs", label: "Needs a confirmation", condition: { left: "inputs.value.needs", op: "gt", right: 0 } }], mode: "first_match" }, inputs: [port("value", "any")], outputs: [port("value", "any")] }, ["cost"], [["cost", "summary", "value"]]);
  add({ id: "confirm_cost", type: "approval", name: "Confirm the cost of this film", config: { policy: { mode: "human" }, title: "{{inputs.subject.askTitle}}", instructions: "{{inputs.subject.ask}}", allowEdit: false, overridable: false, assignee: "any_editor" }, inputs: [port("subject", "any", true)], outputs: [port("subject", "any"), port("decision", "Decision")], row: 1 }, [["cost_gate", "needs"]], [["cost", "summary", "subject"]]);
  // Asking is not an answer: the amount becomes the run's confirmed amount only here, from the person's decision.
  add({ id: "cost_confirmed", type: "tool", name: "Cost confirmed", config: { tool: "jc_film_cost", args: { round: "confirmed" } }, inputs: [port("params", "json", true), port("decision", "Decision", true)], outputs: [port("summary", "json"), port("costUsd", "number")], row: 1, timeout_s: 3600 }, ["confirm_cost"], [params, ["confirm_cost", "decision", "decision"]]);
  stage("asset_images", "Assets", "jc_film_assets", [["cost_gate", "else"], "cost_confirmed"]);
  check("check_assets", "asset_images");
  stage("panel_images", "Storyboard", "jc_film_panels", ["check_assets"]);
  // The storyboard never goes on by itself past frames that could not be had. Each round is: a checkpoint that waits in
  // every mode, then the stage again; a frame that fails again comes back to a person (the engine's Loop step would
  // put these steps on a path of their own, and the film screens read the run's top-level steps).
  const ends: (string | [string, string])[] = [];
  let before = "panel_images";
  for (let round = 1; round <= STORYBOARD_ROUNDS; round++) {
    const suffix = round === 1 ? "" : `_${round}`, gate = `storyboard_gate${suffix}`, fix = `fix_storyboard${suffix}`, redraw = `panel_redraw${suffix}`;
    add({ id: gate, type: "branch", name: "Needs a person?", config: { cases: [{ id: "needs", label: "Needs a person", condition: { left: "inputs.value.needs", op: "gt", right: 0 } }], mode: "first_match" }, inputs: [port("value", "any")], outputs: [port("value", "any")], ...(round > 1 ? { row: 1 } : {}) }, [before], [[before, "summary", "value"]]);
    const found = CHECKPOINTS.find((entry) => entry.id === fix)!;
    add({ id: fix, type: "approval", name: found.title, config: { policy: { mode: "human" }, title: "{{inputs.subject.askTitle}}", instructions: "{{inputs.subject.ask}}", allowEdit: false, overridable: false, assignee: "any_editor" }, inputs: [port("subject", "any", true)], outputs: [port("subject", "any"), port("decision", "Decision")], row: 1 }, [[gate, "needs"]], [[before, "summary", "subject"]]);
    add({ id: redraw, type: "tool", name: "Storyboard, again", config: { tool: "jc_film_panels", args: { round: "again", last: round === STORYBOARD_ROUNDS } }, inputs: [port("params", "json", true), port("before", "json"), port("decision", "Decision")], outputs: [port("summary", "json"), port("costUsd", "number")], row: 1, timeout_s: 3600 }, [fix], [params, [before, "summary", "before"], [fix, "decision", "decision"]]);
    ends.push([gate, "else"]);
    before = redraw;
  }
  check("check_storyboard", "panel_images", [...ends, before]);
  // The voice and the music do not depend on each other.
  stage("voice", "Voice", "jc_film_voice", ["check_storyboard"]);
  stage("music", "Music", "jc_film_music", ["check_storyboard"], 1);
  check("check_voice", "voice");
  stage("assemble", "Timeline", "jc_film_assemble", ["check_voice", "music"]);

  const doc: WorkflowDocument = {
    format: "jagentchill.workflow", schemaVersion: 1, id: FILM_TEMPLATE_ID, name: "Film pipeline", description: "From a story to an assembled film: script, reference pictures, storyboard, voice, music and timeline.",
    revision: 1, graphHash: "", parameters: PARAMETERS, variables: [], outputs: [{ name: "summary", type: "json", from: { node: "assemble", port: "summary" } }],
    nodes, edges, groups: [], notes: [], viewport: { x: 0, y: 0, zoom: 1 },
    settings: { maxParallel: 2, runTimeout_s: 86_400, stepMode: false, reportBack: "final" },
    meta: { origin: "template", protected: true, templateId: FILM_TEMPLATE_ID, pendingPlan: false, created_ms: now, updated_ms: now },
  };
  return { ...doc, graphHash: graphHash(doc) };
}
