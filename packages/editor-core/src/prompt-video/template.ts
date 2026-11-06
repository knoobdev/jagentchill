import type { WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowParameter, WorkflowPort } from "@jagentchill/protocol";
import { graphHash } from "../workflow/nodes.ts";
import { PICTURE_ROUNDS } from "./film-bridge.ts";
import { ASPECT_RATIOS, DEFAULT_PARAMS, FRAME_RATES, MUSIC_MOODS, PROMPT_MAX, RESOLUTIONS, RUN_MODES, SCRIPT_MAX, TEMPLATE_ID } from "./params.ts";

/**
 * The workflow document of "One prompt → video": a graph the workflow engine executes like any other. Writing steps and
 * generation steps are `tool` nodes that name a step tool of the host (`jc_video_*`); every checkpoint is an `approval`
 * node, so the run mode decides who answers it. After the shot list the pictures, the voice and the music have no
 * dependency on each other and run side by side.
 */
export const STAGES = [
  { id: "brief", label: "Brief", check: "check_brief", output: "brief" },
  { id: "script_draft", label: "Script", check: "script_approve", output: "script" },
  { id: "shot_list", label: "Shot list", check: "check_shot_list", output: "shotList" },
  { id: "assets", label: "Pictures", check: null, output: "shotMedia", result: "pictures" },
  { id: "voiceover", label: "Voice", check: null, output: "takes" },
  { id: "music", label: "Music", check: null, output: "music" },
  { id: "timing", label: "Timing", check: null, output: "shotList" },
  { id: "captions", label: "Captions", check: null, output: "captions" },
  { id: "assemble", label: "Assemble", check: null, output: "project" },
  { id: "review_checks", label: "Review", check: "check_final", output: "report" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
/**
 * The steps of the Pictures stage, in order: the first drawing, then up to `PICTURE_ROUNDS` rounds of "a person is
 * asked, the pictures are drawn again" (they run only when something needs a person: a leave to send the run's
 * pictures or recordings to a provider, or a shot that could not be had), then `pictures`, which hands on what was made.
 */
export const PICTURE_ASKS: readonly string[] = Array.from({ length: PICTURE_ROUNDS }, (_value, index) => `fix_pictures${index ? `_${index + 1}` : ""}`);
export const PICTURE_STEPS: readonly string[] = ["assets", ...Array.from({ length: PICTURE_ROUNDS }, (_value, index) => `assets_again${index ? `_${index + 1}` : ""}`), "pictures"];
/** The stages a person can open, edit and run again; the rest follow from them. */
export const EDITABLE_STAGES: readonly StageId[] = ["brief", "script_draft", "shot_list"];
export const RERUN_STAGES: readonly StageId[] = ["brief", "script_draft", "shot_list", "assets", "voiceover", "music"];

const PARAMETERS: WorkflowParameter[] = [
  { name: "prompt", label: "Prompt", type: "text", required: false, maxLength: PROMPT_MAX, multiline: true, help: "What the video is about", secret: false },
  { name: "targetDuration_s", label: "Duration", type: "integer", required: false, default: DEFAULT_PARAMS.targetDuration_s, min: 5, max: 600, help: "Seconds", secret: false },
  { name: "aspectRatio", label: "Aspect ratio", type: "string", required: false, default: DEFAULT_PARAMS.aspectRatio, enum: [...ASPECT_RATIOS], help: "", secret: false },
  { name: "resolution", label: "Resolution", type: "string", required: false, default: DEFAULT_PARAMS.resolution, enum: [...RESOLUTIONS], help: "", secret: false },
  { name: "frameRate", label: "Frame rate", type: "integer", required: false, default: DEFAULT_PARAMS.frameRate, enum: [...FRAME_RATES], help: "", secret: false },
  { name: "language", label: "Language", type: "string", required: false, default: DEFAULT_PARAMS.language, maxLength: 16, help: "", secret: false },
  { name: "style", label: "Style", type: "text", required: false, default: DEFAULT_PARAMS.style, maxLength: 500, help: "", secret: false },
  { name: "voice", label: "Voice", type: "string", required: false, default: DEFAULT_PARAMS.voice, maxLength: 80, help: "", secret: false },
  { name: "musicMood", label: "Music", type: "string", required: false, default: DEFAULT_PARAMS.musicMood, enum: [...MUSIC_MOODS], help: "", secret: false },
  { name: "captions", label: "Captions", type: "boolean", required: false, default: DEFAULT_PARAMS.captions, help: "", secret: false },
  { name: "mode", label: "Approvals", type: "string", required: false, default: DEFAULT_PARAMS.mode, enum: [...RUN_MODES], help: "", secret: false },
  { name: "model", label: "Writing model", type: "json", required: false, help: "The chat model that writes the brief, the script and the shot list", secret: false },
  { name: "script", label: "Script", type: "text", required: false, maxLength: SCRIPT_MAX, multiline: true, help: "Your own script: it is spoken as written", secret: false },
  { name: "secondCaptionLanguage", label: "Second caption language", type: "string", required: false, maxLength: 16, help: "", secret: false },
  { name: "budgetUsd", label: "Budget", type: "number", required: false, min: 0.01, max: 100_000, help: "The run stops before it would spend more", secret: false },
];

const port = (id: string, type: string, required = false): WorkflowPort => ({ id, label: id, type, ...(required ? { required: true } : {}) });
type Link = [from: string, fromPort: string, toPort: string];

export function buildTemplate(now: number): WorkflowDocument {
  const nodes: WorkflowNode[] = [], edges: WorkflowEdge[] = [];
  let column = 0;
  /** `after`: the steps this one follows — by their `done` port, or by the named port of a branch (`[node, port]`). */
  const add = (node: Pick<WorkflowNode, "id" | "type" | "name" | "config" | "inputs" | "outputs"> & { row?: number; timeout_s?: number }, after: (string | [node: string, port: string])[], data: Link[]): void => {
    const { row = 0, ...rest } = node;
    if (row === 0) column += 1;
    nodes.push({ ...rest, description: "", position: { x: 120 + column * 260, y: 200 + row * 140 }, onError: "fail", cache: "auto", assign: [], protected: true, disabled: false });
    for (const entry of after) { const [from, fromPort] = typeof entry === "string" ? [entry, "done"] : entry; edges.push({ id: `c_${from}_${node.id}`, kind: "control", from: { node: from, port: fromPort }, to: { node: node.id, port: "start" }, label: "", route: { style: "bezier", waypoints: [], labelT: 0.5 } }); }
    for (const [from, fromPort, toPort] of data) edges.push({ id: `d_${from}_${fromPort}_${node.id}_${toPort}`, kind: "data", from: { node: from, port: fromPort }, to: { node: node.id, port: toPort }, label: "", route: { style: "bezier", waypoints: [], labelT: 0.5 } });
  };
  const tool = (id: string, name: string, toolName: string, args: Record<string, unknown>, inputs: WorkflowPort[], outputs: WorkflowPort[], extra: { row?: number; timeout_s?: number } = {}) =>
    ({ id, type: "tool" as const, name, config: { tool: toolName, args }, inputs, outputs, ...extra });
  const approval = (id: string, name: string, instructions: string) => ({
    id, type: "approval" as const, name, config: { policy: { mode: "human" }, title: name, instructions, allowEdit: true, overridable: true, assignee: "any_editor" },
    inputs: [port("subject", "any", true)], outputs: [port("subject", "any"), port("decision", "Decision")],
  });
  const params: Link = ["start", "params", "params"];

  nodes.push({
    id: "start", type: "trigger", name: "Start", description: "", config: { sources: [{ kind: "manual", enabled: true }] }, inputs: [],
    outputs: [port("params", "json"), port("trigger", "json"), ...PARAMETERS.map((param) => ({ id: param.name, label: param.label, type: param.type }))],
    position: { x: 120, y: 200 }, onError: "fail", cache: "auto", assign: [], protected: true, disabled: false,
  });
  add(tool("brief", "Brief", "jc_video_write", { kind: "brief" }, [port("params", "json", true)], [port("brief", "Brief"), port("session", "json")]), ["start"], [params]);
  add(approval("check_brief", "Check the brief", "Read the brief and answer its questions."), ["brief"], [["brief", "brief", "subject"]]);
  add(tool("script_draft", "Script", "jc_video_write", { kind: "script" }, [port("params", "json", true), port("brief", "Brief", true)], [port("script", "json"), port("session", "json")]), ["check_brief"], [params, ["check_brief", "subject", "brief"]]);
  add(approval("script_approve", "Approve the script", "Read the script. Edit a line, or ask for changes."), ["script_draft"], [["script_draft", "script", "subject"]]);
  add(tool("shot_list", "Shot list", "jc_video_write", { kind: "shots" }, [port("params", "json", true), port("brief", "Brief", true), port("script", "json", true)], [port("shotList", "ShotList"), port("session", "json")]),
    ["script_approve"], [params, ["check_brief", "subject", "brief"], ["script_approve", "subject", "script"]]);
  add(approval("check_shot_list", "Check the shot list", "One picture is made for every shot."), ["shot_list"], [["shot_list", "shotList", "subject"]]);
  // The pictures and the recordings are made by the film engine on the run's working film (see `film-bridge.ts`).
  const made: Link[] = [params, ["check_brief", "subject", "brief"], ["script_approve", "subject", "script"], ["check_shot_list", "subject", "shotList"]];
  const madeIn = [port("params", "json", true), port("brief", "Brief", true), port("script", "json", true), port("shotList", "ShotList", true)];
  const drawn = [port("summary", "json"), port("shotMedia", "list<json>"), port("costUsd", "number")];
  add(tool("assets", "Pictures", "jc_video_assets", {}, madeIn, drawn, { timeout_s: 3600 }), ["check_shot_list"], made);
  // The pictures never go on by themselves past something only a person can decide: the leave to send the run's
  // pictures or recordings to a provider, and shots that could not be had. Each round is a checkpoint that waits in
  // every run mode, then the drawing again; a shot that fails again comes back to a person.
  const ends: (string | [string, string])[] = [];
  let before = "assets";
  for (let round = 1; round <= PICTURE_ROUNDS; round++) {
    const suffix = round === 1 ? "" : `_${round}`, gate = `pictures_gate${suffix}`, fix = `fix_pictures${suffix}`, again = `assets_again${suffix}`;
    add({ id: gate, type: "branch", name: "Needs a person?", config: { cases: [{ id: "needs", label: "Needs a person", condition: { left: "inputs.value.needs", op: "gt", right: 0 } }], mode: "first_match" }, inputs: [port("value", "any")], outputs: [port("value", "any")], row: 3 }, [before], [[before, "summary", "value"]]);
    add({ id: fix, type: "approval", name: "Pictures need you", config: { policy: { mode: "human" }, title: "{{inputs.subject.askTitle}}", instructions: "{{inputs.subject.ask}}", allowEdit: false, overridable: false, assignee: "any_editor" }, inputs: [port("subject", "any", true)], outputs: [port("subject", "any"), port("decision", "Decision")], row: 3 }, [[gate, "needs"]], [[before, "summary", "subject"]]);
    add(tool(again, "Pictures, again", "jc_video_assets", { round: "again", last: round === PICTURE_ROUNDS }, [...madeIn, port("before", "json"), port("decision", "Decision")], drawn, { row: 3, timeout_s: 3600 }), [fix], [...made, [before, "summary", "before"], [fix, "decision", "decision"]]);
    ends.push([gate, "else"]);
    before = again;
  }
  add(tool("pictures", "Pictures, kept", "jc_video_pictures", {}, madeIn, [port("shotMedia", "list<json>"), port("shotList", "ShotList"), port("costUsd", "number")]), [...ends, before], made);
  // The voice follows the pictures (the one stop above also asks for the leave its recordings need); the music does not wait for either.
  add(tool("voiceover", "Voice", "jc_video_voice", {}, madeIn, [port("takes", "list<json>"), port("summary", "json"), port("costUsd", "number")], { timeout_s: 3600 }), ["pictures"], made);
  add(tool("music", "Music", "jc_video_music", {}, [port("params", "json", true), port("brief", "Brief", true)], [port("music", "json"), port("costUsd", "number")], { row: 2, timeout_s: 3600 }),
    ["check_shot_list"], [params, ["check_brief", "subject", "brief"]]);
  add(tool("timing", "Timing", "jc_video_timing", {}, [port("params", "json", true), port("shotList", "ShotList", true), port("script", "json", true), port("takes", "list<json>", true)], [port("shotList", "ShotList"), port("voiceTrack", "VoiceTrack")]),
    ["voiceover"], [params, ["pictures", "shotList", "shotList"], ["script_approve", "subject", "script"], ["voiceover", "takes", "takes"]]);
  add(tool("captions", "Captions", "jc_video_captions", {}, [port("params", "json", true), port("script", "json", true), port("shotList", "ShotList", true), port("voiceTrack", "VoiceTrack", true)], [port("captions", "CaptionSet")]),
    ["timing"], [params, ["script_approve", "subject", "script"], ["timing", "shotList", "shotList"], ["timing", "voiceTrack", "voiceTrack"]]);
  add(tool("assemble", "Assemble", "jc_video_assemble", {},
    [port("params", "json", true), port("brief", "Brief", true), port("script", "json", true), port("shotList", "ShotList", true), port("shotMedia", "list<json>", true), port("voiceTrack", "VoiceTrack", true), port("captions", "CaptionSet", true), port("music", "json", true)],
    [port("project", "ProjectRef"), port("report", "json")]),
  ["pictures", "captions", "music"], [params, ["check_brief", "subject", "brief"], ["script_approve", "subject", "script"], ["timing", "shotList", "shotList"], ["pictures", "shotMedia", "shotMedia"], ["timing", "voiceTrack", "voiceTrack"], ["captions", "captions", "captions"], ["music", "music", "music"]]);
  add(tool("review_checks", "Review", "jc_video_checks", {},
    [port("params", "json", true), port("project", "ProjectRef", true), port("brief", "Brief", true), port("script", "json", true), port("shotList", "ShotList", true), port("shotMedia", "list<json>", true), port("voiceTrack", "VoiceTrack", true), port("captions", "CaptionSet", true), port("takes", "list<json>")],
    [port("report", "ReviewReport")]),
  ["assemble"], [params, ["assemble", "project", "project"], ["check_brief", "subject", "brief"], ["script_approve", "subject", "script"], ["timing", "shotList", "shotList"], ["pictures", "shotMedia", "shotMedia"], ["timing", "voiceTrack", "voiceTrack"], ["captions", "captions", "captions"], ["voiceover", "takes", "takes"]]);
  add(approval("check_final", "Review the video", "Watch the preview. Accept it, or ask for changes."), ["review_checks"], [["review_checks", "report", "subject"]]);

  const doc: WorkflowDocument = {
    format: "jagentchill.workflow", schemaVersion: 1, id: TEMPLATE_ID, name: "One prompt → video", description: "From one prompt to an edited video: brief, script, shot list, pictures, voice, music, assembly and review.",
    revision: 1, graphHash: "", parameters: PARAMETERS, variables: [],
    outputs: [{ name: "project", type: "ProjectRef", from: { node: "assemble", port: "project" } }, { name: "report", type: "ReviewReport", from: { node: "review_checks", port: "report" } }],
    nodes, edges, groups: [], notes: [], viewport: { x: 0, y: 0, zoom: 1 },
    settings: { maxParallel: 4, runTimeout_s: 86_400, stepMode: false, reportBack: "final" },
    meta: { origin: "template", protected: true, templateId: TEMPLATE_ID, pendingPlan: false, created_ms: now, updated_ms: now },
  };
  return { ...doc, graphHash: graphHash(doc) };
}
