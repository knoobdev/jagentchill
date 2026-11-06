import { z } from "zod";
import { AGENT_STATES, HANDBACK_OUTCOMES, HANDOFF_LIMITS, HANDOFF_SCOPES, REVIEW_SEVERITIES } from "@jagentchill/protocol";
import { defineTool, fail, id, type ToolContext } from "./kit.ts";

const agents = (ctx: ToolContext) => ctx.host.agents!;
const wait = z.enum(["notify", "block", "none"]);
const timeout = z.number().int().min(1000).max(300_000);
const lines = () => z.array(z.string().trim().min(1).max(500)).max(12);
/** Every agent tool is a read as far as a project goes: it changes no document, so no mode refuses it and nothing is staged. */
const base = { family: "agent" as const, readOnly: true, needsProject: false, readsAmbientState: true, kind: "read" as const, available: (host: ToolContext["host"]) => !!host.agents };

/**
 * The agent family (`multi-agent-orchestration`): an agent creates other agents, talks to them, waits for them, stops
 * them and hands its own work back. The caller is the session of the call; no tool takes a caller identity.
 */
export const AGENT_TOOLS = [
  defineTool({
    ...base, name: "jc_agent_create",
    description: "Create a sub-agent and give it its first message. It works in the background in its own conversation; you get a message when it settles (wait \"notify\", default), or the call waits up to timeout_ms (wait \"block\"). role is a role of jc_agent_catalog (it decides the model; in a team it is required). Set grantsWrite true for the one agent that edits the project. budgetUsd caps what it may spend.",
    shape: {
      title: z.string().trim().min(1), prompt: z.string().trim().min(1).max(32_000), role: z.string().min(1).max(40).optional(), runtime: id().optional(), model: z.string().min(3).max(200).optional(),
      mode: z.enum(["ask", "plan", "edit", "auto"]).optional(), projectId: id().optional(), labels: z.record(z.string(), z.string()).optional(), budgetUsd: z.number().min(0.01).max(1000).optional(),
      wait: wait.optional(), timeout_ms: timeout.optional(), grantsWrite: z.boolean().optional(), idempotencyKey: z.string().min(16).max(64).optional(),
    },
    refine(args) { if (args.title.length > 60) fail("INVALID_PARAMS", `title is the agent's name: at most 60 characters; got ${args.title.length}. Put the task in prompt.`, { field: "title" }); },
    handle: async (ctx, args) => ({ data: await agents(ctx).create(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_list",
    description: "List agents of this session: your own sub-agents (scope \"children\", default), everything below you (\"descendants\") or the whole tree (\"tree\"). Returns agentId, title, role, state, model and the start of each agent's last message, newest first.",
    shape: { scope: z.enum(["children", "descendants", "tree"]).optional(), states: z.array(z.enum(AGENT_STATES)).max(6).optional(), includeArchived: z.boolean().optional() },
    handle: (ctx, args) => ({ data: { agents: agents(ctx).list(ctx.session, args) } }),
  }),
  defineTool({
    ...base, name: "jc_agent_send",
    description: "Send a message to an agent of this session: a sub-agent of yours, or the agent that created you. A working agent reads it after its current step; an idle one starts a turn. wait works as in jc_agent_create. The same message twice within two minutes, or a long back-and-forth without the user, is refused.",
    shape: { agentId: id(), prompt: z.string().trim().min(1).max(32_000), wait: wait.optional(), timeout_ms: timeout.optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).send(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_status",
    description: "The latest snapshot of one agent of this session: state, model, its own sub-agents by state, tokens and cost, budget, and the result of its last turn (summary, hand-back, proposals).",
    shape: { agentId: id() },
    handle: (ctx, args) => ({ data: agents(ctx).status(ctx.session, args.agentId) }),
  }),
  defineTool({
    ...base, name: "jc_agent_wait",
    description: "Wait for agents to settle. mode \"block\" (default) returns when all (until \"all\") or one (until \"any\") of them settled or after timeout_ms (default 30000) — a timeout is not an error: you are notified later. mode \"notify\" returns at once and arms that message. Returns settled[] with each result, and pending[].",
    shape: { agentIds: z.array(id()).min(1).max(20), mode: z.enum(["block", "notify"]).optional(), until: z.enum(["all", "any"]).optional(), timeout_ms: timeout.optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).wait(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_cancel",
    description: "Stop the running turn of a sub-agent you created (directly or through another), and of every agent below it. The agent stays and can be sent a new message; with close true it takes no more messages.",
    shape: { agentId: id(), close: z.boolean().optional(), reason: z.string().max(500).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).cancel(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_handback",
    description: "Return your work to the agent that created you, then end your turn. Four sections are REQUIRED: whatChangedOrInspected (what you did and found), evidence (how you know: what you rendered, read or measured), remainingUncertainty (what you did not verify) and counterEvidence (what speaks against your result). Where a section has nothing to say, write \"None\" — leaving it out is refused. Optional: requestedResolution, currentDirection, claim, risk, outcome (done, partial, blocked, disagree). Proposals you submitted in this turn are attached by the server.",
    shape: {
      outcome: z.enum(HANDBACK_OUTCOMES).optional(), status: z.enum(HANDBACK_OUTCOMES).optional(),
      // The sections are measured by the service, which answers with the field that is missing or too long.
      whatChangedOrInspected: z.string().optional(), evidence: z.string().optional(), remainingUncertainty: z.string().optional(), counterEvidence: z.string().optional(),
      requestedResolution: z.string().optional(), currentDirection: z.string().optional(), claim: z.string().optional(), risk: z.string().optional(),
      artefacts: z.array(z.object({ kind: z.string().min(1).max(40), id: z.string().min(1).max(200), title: z.string().min(1).max(200), note: z.string().max(500).optional() })).max(50).optional(),
      handoffId: z.string().min(1).max(64).optional(), openQuestions: lines().optional(), risks: lines().optional(), nextSteps: lines().optional(),
    },
    handle: (ctx, args) => ({ data: agents(ctx).handback(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_handback_respond",
    description: "Answer a hand-back an agent you created made to you: accept closes it; return sends it back with a note saying what is missing (required), and the agent hands back once more. The same work can be returned at most twice. Not inside a team run (there: jc_team_accept_result or a new assignment).",
    shape: { handbackId: z.string().min(1).max(64), decision: z.enum(["accept", "return"]), note: z.string().max(2000).optional() },
    handle: (ctx, args) => ({ data: agents(ctx).handbackRespond(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_activity",
    description: "What an agent of this session has been doing: its recent messages, the tools it called and how they ended, as plain text (no reasoning). Pass the cursor of your last call as sinceCursor to read only what is new. maxItems 1–100, default 20.",
    shape: { agentId: id(), sinceCursor: z.string().max(20).optional(), maxItems: z.number().int().min(1).max(100).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).activity(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_archive",
    description: "Archive a sub-agent you created (directly or through another) with every agent below it: running turns are stopped, the agents leave the lists, their conversations are kept and the user can restore them. Not for yourself, your caller or the session's own agent.",
    shape: { agentId: id(), reason: z.string().max(500).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).archive(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_update",
    description: "Rename a sub-agent you created, or replace its labels (keys: lower-case letters, digits, . _ -; at most 16). Labels starting with jc. are the server's and cannot be written.",
    shape: { agentId: id(), title: z.string().trim().min(1).max(60).optional(), labels: z.record(z.string(), z.string()).optional() },
    handle: (ctx, args) => ({ data: agents(ctx).update(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_set_mode",
    description: "Change the mode of a sub-agent you created: ask (reads only), plan, edit, or auto — never above your own mode. On a runtime that cannot change during a turn the result says applied \"next_turn\".",
    shape: { agentId: id(), mode: z.enum(["ask", "plan", "edit", "auto"]) },
    handle: async (ctx, args) => ({ data: await agents(ctx).setMode(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_set_model",
    description: "Move a sub-agent you created to another model of its role. Models are chosen by the host's routing: profile is the id of a profile of the agent's role (the refusal lists the valid ones); without profile the role's first usable profile is used. While the agent is working the change is queued and applied before its next turn (applied \"next_turn\").",
    shape: { agentId: id(), profile: z.string().min(1).max(40).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).setModel(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_handoff",
    description: "Pass the lead of your work to another agent of this session, with what it needs to go on. to is the agentId of an existing agent, or {title, role?} to create the receiver beside you. scope \"task\": it takes the task over and reports to the agent you report to. scope \"lead\": it also takes over the agents you created. scope \"conversation\": it becomes the agent that answers the user in this session — always the user's decision, shown to them as a card. The work stays yours until the receiver (or the user) accepts. writer true passes the write assignment on the project too.",
    shape: {
      to: z.union([id(), z.object({ title: z.string().trim().min(1).max(60), role: z.string().min(1).max(40).optional() })]), scope: z.enum(HANDOFF_SCOPES),
      package: z.object({
        // The two texts are measured by the service, which answers with the code the hand-off rules name.
        brief: z.string().trim().min(1), historySummary: z.string().trim().min(1),
        artefacts: z.array(z.object({ kind: z.string().min(1).max(40), id: z.string().min(1).max(200), title: z.string().min(1).max(200), note: z.string().max(500).optional() })).max(HANDOFF_LIMITS.artefacts).optional(),
        openQuestions: z.array(z.string().trim().min(1).max(HANDOFF_LIMITS.questionLength)).max(HANDOFF_LIMITS.questions).optional(),
        acceptanceCriteria: z.array(z.string().trim().min(1).max(HANDOFF_LIMITS.questionLength)).max(HANDOFF_LIMITS.questions).optional(), dueHint: z.string().max(200).optional(),
      }),
      writer: z.boolean().optional(), reason: z.string().max(500).optional(), expires_ms: z.number().int().min(HANDOFF_LIMITS.minExpiry_ms).max(HANDOFF_LIMITS.maxExpiry_ms).optional(),
    },
    handle: async (ctx, args) => ({ data: await agents(ctx).handoff(ctx.session, { ...args, package: { artefacts: [], openQuestions: [], acceptanceCriteria: [], ...args.package } }) }),
  }),
  defineTool({
    ...base, name: "jc_agent_handoff_respond",
    description: "Answer a hand-off: the agent it was made to accepts or rejects it (reject needs a note saying what is missing); the agent that made it can cancel it while it is pending.",
    shape: { handoffId: z.string().min(1).max(64), decision: z.enum(["accept", "reject", "cancel"]), note: z.string().max(1000).optional() },
    handle: (ctx, args) => ({ data: agents(ctx).handoffRespond(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_team_bootstrap_lead",
    description: "In a team run, as its Director: create the lead of the run, once. relay is what the user wants, in your words. The lead staffs the other roles and accepts their work; you are told when the result is accepted.",
    shape: { relay: z.string().trim().min(1).max(12_000), title: z.string().trim().min(1).max(60).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).bootstrapLead(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_team_create_peer",
    description: "In a team run, as its lead: give ONE bounded assignment to a new agent in a peer role of the team (jc_agent_catalog lists the roles). ownershipBoundary says what it owns and must not touch; expectedHandback what it returns. grantsWrite true for the one agent that edits the project now.",
    shape: {
      role: z.string().min(1).max(40), assignment: z.string().trim().min(1).max(12_000), ownershipBoundary: z.string().trim().min(1).max(2000), expectedHandback: z.string().trim().min(1).max(2000),
      title: z.string().trim().min(1).max(60).optional(), grantsWrite: z.boolean().optional(), budgetUsd: z.number().min(0.01).max(1000).optional(),
    },
    handle: async (ctx, args) => ({ data: await agents(ctx).createPeer(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_team_accept_result",
    description: "In a team run, as its lead (or as the Director of a run without a lead): accept the result of the brief. Needs every assignment handed back and every proposal of the run decided by the user. Depending on the team's policy the result is accepted at once or waits for the user's sign-off.",
    shape: { summary: z.string().trim().min(1).max(12_000), evidence: z.string().trim().min(1).max(12_000), remainingUncertainty: z.string().trim().min(1).max(12_000) },
    handle: async (ctx, args) => ({ data: await agents(ctx).acceptResult(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_team_resolve_dissent",
    description: "In a team run, as its lead: close a peer's dissent on an assignment (a hand-back that disagrees or asks for a resolution) — or challenge a hand-back yourself. outcome RESOLVED_BY_LEAD: you decide, the hand-back stands and the peer is told your rationale. NEEDS_MORE_EVIDENCE (once per assignment): the peer gets nextAction as a bounded request and hands back again. ESCALATED_TO_HUMAN: the user sees both positions and decides; you are told their decision, which is binding. No result is accepted while a dissent is open.",
    shape: { assignmentId: z.string().min(1).max(64), outcome: z.enum(["RESOLVED_BY_LEAD", "NEEDS_MORE_EVIDENCE", "ESCALATED_TO_HUMAN"]), rationale: z.string().trim().min(1).max(4000), nextAction: z.string().max(2000).optional() },
    handle: async (ctx, args) => ({ data: await agents(ctx).resolveDissent(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_review_submit",
    description: "As the reviewer agent of a team's result or of a proposal: your review. scores gives every criterion you were asked to score a number from 0 to 100; verdict is approve or request_changes; summary says why in plain words; findings lists what is wrong (severity critical, high, medium or low; category — use \"rights\" or \"safety\" for those). Only the reviewer the host started for that result or proposal can call this.",
    shape: {
      scores: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.number()), verdict: z.enum(["approve", "request_changes"]), summary: z.string().trim().min(1).max(2000),
      findings: z.array(z.object({ severity: z.enum(REVIEW_SEVERITIES), category: z.string().trim().min(1).max(40), message: z.string().trim().min(1).max(1000) })).max(50).optional(),
    },
    handle: async (ctx, args) => ({ data: await agents(ctx).reviewSubmit(ctx.session, args) }),
  }),
  defineTool({
    ...base, name: "jc_agent_catalog",
    description: "What you can staff: the roles of this session's team (or the host's creative roles), which of them edit the project, the limits on agents, and the budget you have left. Read it before the first jc_agent_create.",
    shape: {},
    handle: (ctx) => ({ data: agents(ctx).catalog(ctx.session) }),
  }),
];
