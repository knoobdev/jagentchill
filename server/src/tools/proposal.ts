import { z } from "zod";
import { WRITE, defineTool, fail, id } from "./kit.ts";

/** The proposal family: what an agent does with the list of changes it is staging. None of them is itself a staged change. */
export const PROPOSAL_TOOLS = [
  defineTool({
    name: "jc_proposal_begin", family: "proposal", readOnly: false, needsProject: true, kind: "direct",
    description: "Open the session's proposal explicitly, optionally with a working title and summary. The first write tool of a turn opens one by itself, so this is only needed to name it early. A session has one proposal at a time.",
    shape: { title: z.string().trim().min(1).max(80).optional(), summary: z.string().trim().min(1).max(500).optional() },
    handle: (ctx, args) => { const data = ctx.host.proposals.begin(ctx.session, ctx.projectId, args.title, args.summary); return { data, proposalId: String(data.proposalId) }; },
  }),
  defineTool({
    name: "jc_proposal_submit", family: "proposal", readOnly: false, needsProject: false, kind: "direct",
    description: "Present the staged changes to the user as one proposal with a title (1–80 characters) and a summary (1–500). Returns at once with state \"pending\": do not wait for the decision — it arrives later as a message. Nothing more can be staged until the user accepts or rejects.",
    shape: { title: z.string().trim().min(1).max(80), summary: z.string().trim().min(1).max(500) },
    handle: async (ctx, args) => { const data = await ctx.host.proposals.submit(ctx.session, args.title, args.summary); return { data, proposalId: String(data.proposalId) }; },
  }),
  defineTool({
    name: "jc_proposal_status", family: "proposal", readOnly: true, needsProject: false, readsAmbientState: true, kind: "read",
    description: "Read the session's open or pending proposal: its state, every staged change with its id, tool and summary, which changes depend on which, and whether the staged changes still apply to the project as it is now.",
    shape: {},
    handle: (ctx) => { const data = ctx.host.proposals.status(ctx.session); return { data, ...(data.proposalId ? { proposalId: String(data.proposalId) } : {}) }; },
  }),
  defineTool({
    name: "jc_proposal_discard", family: "proposal", readOnly: false, needsProject: false, kind: "direct",
    description: "Drop the session's open proposal with everything staged in it. A proposal that was already submitted cannot be discarded: the user decides it.",
    shape: {},
    handle: (ctx) => { const data = ctx.host.proposals.discard(ctx.session); return { data, proposalId: String(data.proposalId) }; },
  }),
  defineTool({
    name: "jc_proposal_revert", family: "proposal", readOnly: false, needsProject: false, kind: "direct",
    description: "Before submitting: remove staged changes from the open proposal by changeIds; changes that build on them go too. After acceptance: pass proposalId to undo an applied proposal as a new change (force: true reverts what can be reverted when newer edits touched the same items).",
    shape: { changeIds: z.array(id()).min(1).max(2000).optional(), proposalId: z.string().uuid().optional(), force: z.boolean().optional(), idempotencyKey: WRITE.idempotencyKey.optional() },
    refine(args) { if ((args.changeIds === undefined) === (args.proposalId === undefined)) fail("INVALID_PARAMS", "Give either changeIds (to remove staged changes) or proposalId (to undo an applied proposal).", { field: "changeIds" }); },
    handle: async (ctx, args) => { const data = await ctx.host.proposals.revert(ctx.session, args.changeIds, args.proposalId, args.force === true); return { data, proposalId: String(data.proposalId) }; },
  }),
];
