import type { ColorToken, IconName } from "@jagentchill/ui";
import { workflow as wf } from "@jagentchill/editor-core";
import type { AutomationRunStatus, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus } from "@jagentchill/protocol";

/**
 * The English text of everything the workflow model names — node types, statuses, operators — keyed by the model's
 * value. The screens translate them by that text, so every label here is a key of the locale resources.
 */
export const NODE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: "Trigger", agent: "Agent", team: "Team", tool: "Tool", generate: "Generate", script: "Script", editor: "Editor", approval: "Approval", branch: "Branch", loop: "Loop",
  parallel: "Parallel", join: "Join", subworkflow: "Subworkflow", export: "Export", wait: "Wait", human_input: "Human input", notify: "Notify",
};
export const NODE_NOTES: Partial<Record<WorkflowNodeType, string>> = {
  agent: "An agent session answers a prompt", approval: "A person approves or rejects before the run goes on", branch: "Takes one path by a condition", loop: "Repeats its body while a condition holds",
  parallel: "Runs its body once per item of a list", join: "Collects the results of a parallel body", subworkflow: "Runs another workflow as one step", wait: "Pauses for a time or until a moment",
  human_input: "Asks a person to fill a form", notify: "Sends a notification to devices",
};
export const NODE_ICONS: Record<WorkflowNodeType, IconName> = {
  trigger: "play", agent: "bot", team: "user", tool: "sliders", generate: "spark", script: "doc", editor: "scissors", approval: "check-c", branch: "split", loop: "loop",
  parallel: "layers", join: "layers", subworkflow: "flow", export: "export", wait: "clock", human_input: "pencil", notify: "bell",
};
/** The kind a step is drawn as: one colour and one legend entry each. A family, with the sub-workflow and the wait set apart. */
export const kindOf = (type: WorkflowNodeType): string => (type === "subworkflow" ? "sub" : type === "wait" ? "wait" : wf.NODE_TYPES[type]?.family ?? "unknown");
/** Every kind has its own colour token: `wf/type/<kind>`. */
export const typeToken = (type: WorkflowNodeType): ColorToken => `wf/type/${kindOf(type)}` as ColorToken;
export const KIND_LABELS: Record<string, string> = {
  trigger: "Trigger", agent: "Agent", gate: "Human gate", flow: "Logic", sub: "Subworkflow", wait: "Wait", output: "Notify", generate: "Generate", script: "Script", editor: "Editor", tool: "Tool", unknown: "Step",
};
/** The outputs a step fires by name, as an edge or a port says them. */
export const PORT_LABELS: Record<string, string> = {
  start: "Start", done: "Done", error: "On error", approved: "Approved", rejected: "Rejected", changes_requested: "Changes requested", exhausted: "Exhausted", timed_out: "Timed out", else: "Else",
};

export const NODE_STATUS_LABELS: Record<WorkflowNodeStatus, string> = {
  pending: "Pending", ready: "Queued", running: "Running", waiting_approval: "Waiting for you", succeeded: "Done", failed: "Failed", skipped: "Skipped", cancelled: "Cancelled", stale: "Out of date",
};
export const NODE_STATUS_ICONS: Record<WorkflowNodeStatus, IconName> = {
  pending: "circle", ready: "clock", running: "ring", waiting_approval: "hand", succeeded: "check-c", failed: "x-c", skipped: "slash-c", cancelled: "slash-c", stale: "refresh",
};
export const NODE_STATUS_TOKENS: Record<WorkflowNodeStatus, ColorToken> = {
  pending: "text/tertiary", ready: "text/secondary", running: "accent", waiting_approval: "warning", succeeded: "success", failed: "danger", skipped: "text/tertiary", cancelled: "text/tertiary", stale: "warning",
};
export const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  draft: "Draft", queued: "Queued", running: "Running", paused: "Paused", waiting_approval: "Needs you", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled",
};
export const AUTOMATION_RUN_LABELS: Record<AutomationRunStatus, string> = {
  queued: "Queued", running: "Running", waiting: "Needs approval", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", skipped: "Skipped", missed: "Missed",
};
/** The tone of a status pill: never by colour alone, the pill draws a shape per tone. */
export const STATUS_TONES: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "purple"> = {
  draft: "neutral", queued: "neutral", pending: "neutral", ready: "neutral", running: "info", paused: "warning", waiting_approval: "warning", waiting: "warning", succeeded: "success", failed: "danger",
  cancelled: "neutral", skipped: "neutral", missed: "neutral", stale: "warning",
};
export const ORIGIN_LABELS: Record<string, string> = { user: "You", agent: "Agent", template: "Template", import: "Imported", automation: "Automation", subworkflow: "Subworkflow" };
export const EDGE_KIND_LABELS = { data: "Data", control: "Order", error: "On error", loop_back: "Loop back" };
export const CONDITION_OP_LABELS = {
  eq: "Equals", ne: "Does not equal", gt: "Greater than", gte: "At least", lt: "Less than", lte: "At most", contains: "Contains", not_contains: "Does not contain", in: "Is one of",
  starts_with: "Starts with", ends_with: "Ends with", exists: "Exists", is_empty: "Is empty",
};
export const FIELD_TYPE_LABELS = { text: "Text", long_text: "Long text", number: "Number", boolean: "Yes or no", select: "Choice", multi_select: "Several choices", date: "Date" };
export const ON_ERROR_LABELS = { fail: "Fail the run", route: "Follow the error route", skip: "Skip this step", continue: "Continue" };
export const ASSIGNEE_LABELS = { run_starter: "The device that started the run", any_editor: "Any editor device", admins: "Admin devices" };
export const UNIT_LABELS = { minutes: "Minutes", hours: "Hours", days: "Days", weeks: "Weeks", months: "Months" };
export const CONCURRENCY_LABELS = { skip: "Skip the new run", queue: "Queue the new run", parallel: "Run in parallel" };
export const CATCH_UP_LABELS = { skip: "Record them as missed", run_once: "Run once at startup" };
export const NOTIFY_LABELS = { always: "Always", on_failure: "On failure", never: "Never" };
export const INSTRUCTION_LABELS: Record<string, string> = { run_workflow: "Run workflow", start_session: "Start session" };
export const CONNECTION_LABELS: Record<string, string> = {
  WORKFLOW_TYPE_MISMATCH: "These two ports carry different kinds of data", WORKFLOW_PORT_OCCUPIED: "This input already has a connection", WORKFLOW_CYCLE: "This connection would create a loop — use a Loop node",
  WORKFLOW_BODY_NOT_CLOSED: "This connection would leave a loop or parallel body", WORKFLOW_EDGE_SELF: "A step cannot be connected to itself", WORKFLOW_EDGE_DUPLICATE: "These two ports are already connected",
  WORKFLOW_LIMIT_EXCEEDED: "This workflow has as many connections as it can hold",
};
export const ALIGN_LABELS = { left: "Align left", center: "Align centres", right: "Align right", top: "Align top", middle: "Align middles", bottom: "Align bottom", "distribute-h": "Distribute horizontally", "distribute-v": "Distribute vertically" };
export const PARAM_PROBLEMS = { required: "Required", number: "Enter a number", json: "Enter valid JSON" };
/** Why a run did not start or ended early, as its history row says it. */
export const RUN_REASON_LABELS: Record<string, string> = {
  already_running: "A run was already in progress", queue_full: "The queue was full", active_limit: "Too many runs at once", daily_limit: "Daily limit reached", loop_guard: "Stopped: automations were starting each other",
  host_not_running: "The host was not running", timeout: "Time limit reached", user: "Cancelled by a person", disabled: "The automation was disabled", automation_deleted: "The automation was deleted", device_revoked: "Its device was revoked",
};
export const PAUSED_LABELS = { repeated_failures: "Paused after 5 failures", completed: "Completed", device_revoked: "Paused: its device was revoked" };
export const PARAM_TYPES = ["text", "string", "number", "integer", "boolean", "json", "list<text>", "list<any>"] as const;
export const PORT_TYPES = ["any", "text", "string", "number", "integer", "boolean", "json", "list<any>", "list<text>", "list<json>"] as const;

/** "0:42", "12:05" or "1:02:03". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000)), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
/** A value of a run as one line of text. */
export function preview(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
