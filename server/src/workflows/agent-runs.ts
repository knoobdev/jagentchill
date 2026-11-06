import type { WorkflowExecution, WorkflowRunRecord } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";
import type { WorkflowService } from "./service.ts";

/**
 * Runs as an agent starts and follows them (`jc_workflow_start`, `jc_workflow_status`, `jc_workflow_cancel`). An agent
 * starts a TEMPLATE the host has a starter for — the same function the template's own screen calls, so the run is the
 * same run — and it controls only the runs its own session started. What only a person may answer (an approval, a
 * consent) is reported to the agent in words; it cannot be answered from here.
 */
export type AgentActor = { sessionKey: string; deviceId: string; /** The model the agent's own session runs on. */ model?: { runtimeId: string; providerId: string; modelId: string } };
export type StartInput = { templateId: string; prompt?: string; params?: Record<string, unknown>; budgetUsd?: number; approvalOverride?: "auto" | "human" };
export type StartPreview = { name: string; detail: string; estimate?: { lowUsd: number; highUsd: number; unknown: boolean }; /** The identity of THIS preview (not its words): the permission request made from it is bound to it by this (`bind`). */ offerId?: string };
export type TemplateStarter = {
  name: string;
  /** What a start with these values would do, in words for the permission card. Throws what the start itself would throw for bad input. */
  preview(input: StartInput, actor: AgentActor): StartPreview | Promise<StartPreview>;
  start(input: StartInput, actor: AgentActor): Promise<WorkflowRunRecord>;
  /** The permission request `requestId` was made from the preview `offerId`, in the same call: what that preview said is what an allow of that request allows. */
  bind?(offerId: string, requestId: string, actor: AgentActor): void;
};
export type WorkflowRunPort = {
  templates(): { templateId: string; name: string }[];
  preview(input: StartInput, actor: AgentActor): Promise<StartPreview>;
  start(input: StartInput, actor: AgentActor): Promise<{ runId: string; number: number; status: string; workflowName: string; estimate?: StartPreview["estimate"] }>;
  /** Binds the permission request that was just made to the preview it was made from (see `TemplateStarter.bind`). */
  bind(templateId: string, offerId: string, requestId: string, actor: AgentActor): void;
  status(runId: string, options: { nodeId?: string; include?: readonly ("outputs" | "logs" | "cost")[] }, actor: AgentActor): Record<string, unknown>;
  /** One stored output of one execution of a step, WHOLE, a page at a time (`offset` in characters; `nextOffset` null on the last page): what a hand-off refers to when a deliverable was too large to travel. */
  output(runId: string, at: { nodeId: string; path?: string; port: string; offset?: number }, actor: AgentActor): Record<string, unknown>;
  cancel(runId: string, reason: string | undefined, actor: AgentActor): { runId: string; status: string };
};
/** The most characters of a stored output one page carries, and the bytes a page may take as JSON (a tool result is at most 32 KiB). */
const OUTPUT_PAGE = { chars: 8000, bytes: 24_000 } as const;

const short = (value: unknown, max = 600): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? null : text.length <= max ? value : `${text.slice(0, max)}… (${text.length} characters)`;
};

export function createWorkflowRunPort(deps: { workflows: () => Pick<WorkflowService, "runs">; starters: () => ReadonlyMap<string, TemplateStarter> }): WorkflowRunPort {
  const starter = (templateId: string): TemplateStarter => {
    const found = deps.starters().get(templateId);
    if (!found) throw new ProtocolError("INVALID_PARAMS", `No template has the id "${templateId}". Templates an agent can start: ${[...deps.starters().keys()].join(", ") || "none"}.`, { details: { field: "templateId" } });
    return found;
  };
  const found = (runId: string) => deps.workflows().runs.get(runId) as { run: WorkflowRunRecord; waiting: WorkflowExecution[]; document: { nodes: { id: string; name: string; type: string }[] } };
  return {
    templates: () => [...deps.starters()].map(([templateId, entry]) => ({ templateId, name: entry.name })),
    preview: async (input, actor) => starter(input.templateId).preview(input, actor),
    bind: (templateId, offerId, requestId, actor) => { deps.starters().get(templateId)?.bind?.(offerId, requestId, actor); },
    async start(input, actor) {
      const entry = starter(input.templateId), preview = await entry.preview(input, actor), run = await entry.start(input, actor);
      return { runId: run.id, number: run.number, status: run.status, workflowName: run.workflowName, ...(preview.estimate ? { estimate: preview.estimate } : {}) };
    },
    status(runId, options, _actor) {
      const { run, waiting, document } = found(runId), runs = deps.workflows().runs, include = new Set(options.include ?? []);
      const names = new Map(document.nodes.map((node) => [node.id, node.name]));
      const steps = runs.executions(runId, options.nodeId ? { nodeId: options.nodeId } : {}).filter((exec) => exec.path === "" && exec.status !== "skipped" && document.nodes.find((node) => node.id === exec.nodeId)?.type !== "trigger");
      if (options.nodeId && !steps.length) throw new ProtocolError("NOT_FOUND", `The run has no step "${options.nodeId}".`, { details: { nodeId: options.nodeId } });
      const cost = Math.round(steps.reduce((sum, exec) => Math.max(sum, 0) + (Number(exec.outputs?.costUsd) || 0), 0) * 10_000) / 10_000;
      return {
        run: { runId: run.id, number: run.number, workflowId: run.workflowId, workflowName: run.workflowName, status: run.status, origin: run.origin, mine: run.originRef?.sessionKey === _actor.sessionKey, ...(run.error ? { error: { code: run.error.code, message: run.error.message } } : {}), ...(run.failedNodeId ? { failedNodeId: run.failedNodeId } : {}) },
        steps: steps.map((exec) => ({ nodeId: exec.nodeId, name: names.get(exec.nodeId) ?? exec.nodeId, status: exec.status, ...(exec.error ? { error: { code: exec.error.code, message: exec.error.message.slice(0, 300) } } : {}), ...(include.has("outputs") && exec.outputs ? { outputs: Object.fromEntries(Object.entries(exec.outputs).map(([name, value]) => [name, short(value, options.nodeId ? 2000 : 300)])) } : {}) })),
        // What waits for a person: the agent says so, it does not answer.
        waitingForPerson: waiting.filter((exec) => exec.path === "").map((exec) => ({ nodeId: exec.nodeId, title: String((exec.request as { title?: unknown } | undefined)?.title ?? names.get(exec.nodeId) ?? ""), instructions: String((exec.request as { instructions?: unknown } | undefined)?.instructions ?? "").slice(0, 600) })),
        ...(include.has("outputs") && run.outputs ? { outputs: Object.fromEntries(Object.entries(run.outputs).map(([name, value]) => [name, short(value)])) } : {}),
        ...(include.has("cost") ? { costUsd: cost } : {}),
        ...(include.has("logs") ? { logs: runs.logs(runId, options.nodeId ? { nodeId: options.nodeId } : {}).slice(-20).map((entry) => ({ nodeId: entry.nodeId, level: entry.level, message: entry.message.slice(0, 300) })) } : {}),
      };
    },
    output(runId, at, _actor) {
      found(runId);
      const path = at.path ?? "", exec = deps.workflows().runs.executions(runId, { nodeId: at.nodeId, limit: 500 }).find((entry) => entry.path === path);
      if (!exec) throw new ProtocolError("NOT_FOUND", `The run has no execution of the step "${at.nodeId}"${path ? ` at "${path}"` : ""}.`, { details: { nodeId: at.nodeId, path } });
      if (!exec.outputs || !(at.port in exec.outputs)) throw new ProtocolError("NOT_FOUND", `The step "${at.nodeId}" has no output "${at.port}"${exec.outputs ? `. Its outputs: ${Object.keys(exec.outputs).join(", ") || "none"}.` : " yet."}`, { details: { nodeId: at.nodeId, port: at.port } });
      const value = exec.outputs[at.port], kind = typeof value === "string" ? "text" : "json", whole = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
      const offset = Math.min(Math.max(0, Math.floor(at.offset ?? 0)), whole.length);
      // A page is cut by characters and then until it fits a tool result as JSON; never in the middle of a surrogate pair.
      let end = Math.min(whole.length, offset + OUTPUT_PAGE.chars);
      while (end > offset + 1 && Buffer.byteLength(JSON.stringify(whole.slice(offset, end)), "utf8") > OUTPUT_PAGE.bytes) end = offset + Math.floor((end - offset) / 2);
      if (end < whole.length && end > offset + 1 && /[\uD800-\uDBFF]/.test(whole[end - 1]!)) end -= 1;
      return { output: { nodeId: at.nodeId, path, port: at.port, kind, totalChars: whole.length, offset, text: whole.slice(offset, end), nextOffset: end < whole.length ? end : null } };
    },
    cancel(runId, reason, actor) {
      const { run } = found(runId);
      // Another session's run, or a person's own: an agent reads it and leaves it alone.
      if (run.originRef?.sessionKey !== actor.sessionKey) throw new ProtocolError("NOT_FOUND", "This run was not started by this session: only its own runs can be cancelled.", { details: { runId } });
      const cancelled = deps.workflows().runs.cancel(runId, (reason ?? "").slice(0, 500) || "Cancelled by the agent");
      return { runId, status: cancelled.status };
    },
  };
}
