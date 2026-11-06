import type { AgentHandback, AgentHandoff, AgentNotice, AgentRecord, AgentUpdatedEvent, ProposalReview, TeamAssignment, TeamDissent, TeamRun } from "@jagentchill/protocol";

/** The tree of a session as a device holds it: the agents in depth-first order and the last event number it has seen. */
export type AgentTree = { rootId: string; seq: number; teamId: string | null; agents: AgentRecord[] };

/** The status pill of an agent, in the product's fixed vocabulary; `reason` is the secondary text beside it. */
export function agentPill(agent: Pick<AgentRecord, "state" | "waitingReason" | "result" | "archived_ms">): { label: string; status: string; reason?: string } {
  if (agent.archived_ms) return { label: "Archived", status: "archived" };
  if (agent.state === "creating") return { label: "Queued", status: "queued" };
  if (agent.state === "running") return { label: "Working", status: "working" };
  if (agent.state === "waiting") {
    if (agent.waitingReason === "approval") return { label: "Needs approval", status: "needs approval" };
    const reason = agent.waitingReason === "children" ? "Waiting for sub-agents" : agent.waitingReason === "question" ? "Waiting for your answer" : agent.waitingReason === "handoff" ? "Waiting for hand-off" : "Waiting for a free slot";
    return { label: "Paused", status: "paused", reason };
  }
  if (agent.state === "failed") return { label: "Failed", status: "failed" };
  if (agent.state === "closed") return { label: "Stopped", status: "stopped" };
  if (agent.result?.outcome === "cancelled") return { label: "Cancelled", status: "cancelled" };
  return agent.result ? { label: "Completed", status: "completed" } : { label: "Idle", status: "idle" };
}
export const agentIsActive = (agent: Pick<AgentRecord, "state" | "archived_ms">): boolean => !agent.archived_ms && (agent.state === "creating" || agent.state === "running" || agent.state === "waiting");

/** "Peer · Editor" for a team member, the role's name for a free agent, "Session agent" for the session's own. */
export function agentRoleLine(agent: Pick<AgentRecord, "tier" | "roleLabel" | "depth">): string {
  const tier = agent.tier === "supervisor" ? "Director" : agent.tier === "lead" ? "Lead" : agent.tier === "peer" ? "Peer" : "";
  if (tier && agent.roleLabel && agent.roleLabel !== tier) return `${tier} · ${agent.roleLabel}`;
  return tier || agent.roleLabel || (agent.depth === 0 ? "Session agent" : "Sub-agent");
}

/** The glyph of an agent's avatar, by what it does. */
export function agentGlyph(agent: Pick<AgentRecord, "tier" | "roleId" | "depth">): "sparkles" | "user" | "pencil" | "film" | "scissors" | "search" | "check" | "bot" {
  const role = agent.roleId ?? "";
  if (agent.depth === 0 || agent.tier === "supervisor") return "sparkles";
  if (agent.tier === "lead") return "user";
  if (/writer|script/.test(role)) return "pencil";
  if (/storyboard|casting/.test(role)) return "film";
  if (/editor/.test(role)) return "scissors";
  if (/research/.test(role)) return "search";
  if (/review/.test(role)) return "check";
  return "bot";
}

/** Tokens of an agent's own turns, short: "1.2k tokens"; nothing while it has not reported any. */
export function agentTokens(usage: AgentRecord["usage"]): string {
  const total = usage.inputTokens + usage.outputTokens;
  if (!total) return "";
  return `${total >= 1_000_000 ? `${+(total / 1_000_000).toFixed(2)}M` : total >= 1000 ? `${+(total / 1000).toFixed(1)}k` : total} tokens`;
}
/** What an agent's own turns cost: "$0.42"; "tokens only" when no price is known for its model; nothing before its first turn or while it cost nothing. */
export const agentCost = (usage: AgentRecord["usage"]): string => (!usage.turns ? "" : !usage.costKnown ? "tokens only" : usage.costUsd > 0 ? `$${usage.costUsd.toFixed(2)}` : "");

/** How long the current turn has run, or the last one took: "42 s", "3m 05s", "1h 02m". */
export function agentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * One announced change of an agent applied to the tree a device holds. `null` means the device missed an event (or the
 * agent's parent is not in its tree) and must read the tree again.
 */
export function applyAgentEvent(tree: AgentTree, event: AgentUpdatedEvent): AgentTree | null {
  if (event.rootId !== tree.rootId) return tree;
  if (event.seq <= tree.seq) return tree;
  if (event.seq !== tree.seq + 1) return null;
  const { agent } = event, at = tree.agents.findIndex((entry) => entry.id === agent.id);
  if (agent.archived_ms && agent.depth > 0) {
    // An archived agent leaves the tree with everything below it.
    const gone = new Set([agent.id]);
    for (const entry of tree.agents) if (entry.parentId && gone.has(entry.parentId)) gone.add(entry.id);
    return { ...tree, seq: event.seq, agents: tree.agents.filter((entry) => !gone.has(entry.id)) };
  }
  if (at !== -1) return { ...tree, seq: event.seq, teamId: agent.depth === 0 ? agent.teamId ?? null : tree.teamId, agents: tree.agents.map((entry, index) => (index === at ? agent : entry)) };
  const parent = tree.agents.findIndex((entry) => entry.id === agent.parentId);
  if (parent === -1) return null;
  // A new agent goes after the last agent of its parent's subtree: the list stays in depth-first order.
  let end = parent + 1;
  while (end < tree.agents.length && tree.agents[end].depth > tree.agents[parent].depth) end += 1;
  return { ...tree, seq: event.seq, agents: [...tree.agents.slice(0, end), agent, ...tree.agents.slice(end)] };
}

/** The agents a session's chat lists above its composer: everything below the session's own agent that is not archived. */
export const subAgentsOf = (tree: AgentTree | null): AgentRecord[] => (tree ? tree.agents.filter((agent) => agent.depth > 0 && !agent.archived_ms) : []);
/** What a tree has spent and used, summed over its agents' own turns. */
export function treeTotals(agents: AgentRecord[]): { tokens: number; costUsd: number; costKnown: boolean; running: number } {
  return agents.reduce<{ tokens: number; costUsd: number; costKnown: boolean; running: number }>((total, agent) => ({
    tokens: total.tokens + agent.usage.inputTokens + agent.usage.outputTokens, costUsd: Math.round((total.costUsd + agent.usage.costUsd) * 1e6) / 1e6,
    costKnown: total.costKnown && agent.usage.costKnown, running: total.running + (agentIsActive(agent) ? 1 : 0),
  }), { tokens: 0, costUsd: 0, costKnown: true, running: 0 });
}

/** One settled sub-agent as the server told its caller (`agent_notification`). */
export type AgentNote = { agentId: string; title: string; outcome: "completed" | "failed" | "cancelled" | "closed"; summary: string; reason?: string; handbackId?: string; artefacts: { kind: string; id: string; title: string }[] };
/**
 * The settled sub-agents a server message to an agent names, or `null` when the text is not such a message. The message
 * is data for the agent; the chat shows it as a card, never as something the person wrote.
 */
export function parseAgentNotification(text: string): AgentNote[] | null {
  if (!/^(A sub-agent|\d+ sub-agents) settled\./.test(text)) return null;
  const notes: AgentNote[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.startsWith("{")) continue;
    try {
      const value = JSON.parse(block) as Partial<AgentNote> & { kind?: string };
      if (value.kind !== "agent_notification" || typeof value.agentId !== "string") continue;
      notes.push({ agentId: value.agentId, title: String(value.title ?? ""), outcome: value.outcome ?? "completed", summary: String(value.summary ?? ""), ...(value.reason ? { reason: String(value.reason) } : {}), ...(value.handbackId ? { handbackId: value.handbackId } : {}), artefacts: Array.isArray(value.artefacts) ? value.artefacts : [] });
    } catch { /* not a block of the message */ }
  }
  return notes.length ? notes : null;
}
/**
 * A message in an agent's conversation that no person wrote: the assignment its creator gave it (`from`: that agent),
 * or a message of the host (a run's instruction, a hand-off, a decision passed on). Null for what a person typed.
 */
export function hostAssignment(text: string): { from?: string; text: string } | null {
  const child = /(?:^|\n)You are ".+?", a sub-agent created by "(.+?)"/.exec(text);
  if (child && text.includes("\nAssignment:\n")) return { from: child[1], text: assignmentOf(text.slice(text.indexOf(child[0].trimStart()))).replace(/ ?This message is from the server(?:, not from the user)?\./, "").trim() };
  if (/^\s*\[(?:Team run|Proposal review) [^\]]+\]/.test(text) || /This message is from the server(?:, not from the user)?\./.test(text)) return { text: assignmentOf(text).replace(/^\s*\[Proposal review [^\]]+\]\s*/, "").replace(/ ?This message is from the server(?:, not from the user)?\./, "").trim() };
  return null;
}
/** The task a sub-agent was given, without the standing instructions the server put before it. */
export function assignmentOf(text: string): string {
  // What a team run tells its Director, its lead or a peer is the host speaking, not a person: the instruction to the
  // Director reads as the request it carries (its objective); any other message of a run loses the run tag and the host's own note.
  const run = /^\s*\[Team run [^\]]+\]\s*/.exec(text);
  if (run) {
    const rest = text.slice(run[0].length);
    if (/^You are the .+ of the team /.test(rest)) return /^Objective: (.+)$/m.exec(rest)?.[1]?.trim() ?? "";
    return rest.replace(/ ?This message is from the server(?:, not from the user)?\./, "").trim();
  }
  const at = text.indexOf("\nAssignment:\n");
  return at >= 0 && /^You are ".+", a sub-agent created by /.test(text) ? text.slice(at + 13).trim() : text;
}

// — Team runs and hand-offs, as the Agents tab shows them —
/** The steps of a run in the order the stepper draws them. */
export const RUN_STEPS = [{ id: "supervisor", label: "Director" }, { id: "lead", label: "Lead" }, { id: "assignments", label: "Assignments" }, { id: "acceptance", label: "Acceptance" }, { id: "relay", label: "Relay" }] as const;
/** How far a run has come: the index of its current step; every step is behind a run that completed, none is current in one that ended otherwise. */
export function runStep(run: Pick<TeamRun, "status" | "stage">): { current: number; done: number } {
  if (run.status === "completed") return { current: -1, done: RUN_STEPS.length };
  const at = RUN_STEPS.findIndex((step) => step.id === run.stage);
  return { current: run.status === "running" || run.status === "waiting_human" ? at : -1, done: Math.max(0, at) };
}
export function runPill(run: Pick<TeamRun, "status" | "waitingReason">): { label: string; status: string } {
  if (run.status === "waiting_human") return { label: "Needs approval", status: "needs approval" };
  if (run.status === "paused") return { label: "Paused", status: "paused" };
  if (run.status === "completed") return { label: "Completed", status: "completed" };
  if (run.status === "failed") return { label: "Failed", status: "failed" };
  if (run.status === "cancelled") return { label: "Cancelled", status: "cancelled" };
  return run.status === "briefing" ? { label: "Queued", status: "queued" } : { label: "Working", status: "working" };
}
export function assignmentPill(status: TeamAssignment["status"]): { label: string; status: string } {
  return status === "active" ? { label: "Working", status: "working" } : status === "handed_back" ? { label: "Handed back", status: "awaiting review" } : status === "dissent_open" ? { label: "Disagrees", status: "needs approval" } : status === "accepted" ? { label: "Accepted", status: "approved" }
    : status === "failed" ? { label: "Failed", status: "failed" } : { label: "Cancelled", status: "cancelled" };
}
/** "Peers 1/3" and "Assignments 2/12" of the run header. */
export const runCounters = (run: Pick<TeamRun, "assignments" | "limits">): { peers: string; assignments: string } => ({
  peers: `${run.assignments.filter((entry) => entry.status === "active").length}/${run.limits.maxConcurrentPeersPerLead}`, assignments: `${run.assignments.length}/${run.limits.maxAssignmentsPerBrief}`,
});
/** "Lead plan · 2 bounded assignments". */
export const planTitle = (count: number): string => `Lead plan · ${count === 1 ? "1 bounded assignment" : `${count} bounded assignments`}`;
/** A hand-off's pill: a pending one waits for a person ("Needs approval") or for its receiver, an accepted one is done. */
export function handoffPill(record: Pick<AgentHandoff, "status"> & { decision?: AgentHandoff["decision"] }): { label: string; status: string } {
  return record.status === "pending" ? (record.decision === "human" ? { label: "Needs approval", status: "needs approval" } : { label: "Queued", status: "queued" }) : record.status === "accepted" ? { label: "Accepted", status: "approved" } : record.status === "rejected" ? { label: "Rejected", status: "failed" }
    : record.status === "expired" ? { label: "Expired", status: "expired" } : { label: "Cancelled", status: "cancelled" };
}
export type ActivityEntry = { id: string; ts_ms: number; kind: string; text: string; runId?: string; handoffId?: string };
/** The activity log of a tree: what its runs recorded and what became of its hand-offs, newest first. */
export function activityFeed(runs: TeamRun[], handoffs: AgentHandoff[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const run of runs) run.events.forEach((event, index) => entries.push({ id: `${run.id}-${index}`, ts_ms: event.ts_ms, kind: event.kind, text: event.text, runId: run.id }));
  for (const record of handoffs) {
    const scope = record.scope === "lead" ? "the lead" : record.scope === "conversation" ? "this conversation" : "a task";
    entries.push({ id: `${record.id}-created`, ts_ms: record.created_ms, kind: "handoff.created", text: `${record.fromTitle} offered ${scope} to ${record.toTitle}.`, handoffId: record.id });
    if (record.decided_ms) entries.push({ id: `${record.id}-${record.status}`, ts_ms: record.decided_ms, kind: `handoff.${record.status}`, text: `The hand-off from ${record.fromTitle} to ${record.toTitle} was ${record.status}${record.decidedBy?.kind === "device" ? " by a person" : ""}.`, handoffId: record.id });
  }
  // Entries of the same instant keep the order they were recorded in, under the newest-first rule.
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.ts_ms - a.entry.ts_ms || b.index - a.index).map(({ entry }) => entry);
}
/** The label of a hand-off's scope in the card header ("Hand-off · Conversation"). */
export const handoffScopeLabel = (scope: AgentHandoff["scope"]): string => (scope === "lead" ? "Lead" : scope === "conversation" ? "Conversation" : "Task");
/** The sections of a hand-back in the order its card shows them: the four every hand-back has, then the ones an agent may add. */
export const HANDBACK_SECTIONS = [
  { key: "whatChangedOrInspected", label: "What changed or was inspected", required: true }, { key: "evidence", label: "Evidence", required: true },
  { key: "remainingUncertainty", label: "Remaining uncertainty", required: true }, { key: "counterEvidence", label: "Counter-evidence", required: true },
  { key: "requestedResolution", label: "Requested resolution", required: false }, { key: "currentDirection", label: "Current direction", required: false },
  { key: "claim", label: "Claim", required: false }, { key: "risk", label: "Risk", required: false },
] as const;
/** The sections of one hand-back that have something to show; a required one a record of an older host lacks is shown as "Not stated". */
export function handbackSections(record: AgentHandback): { key: string; label: string; text: string; missing: boolean }[] {
  return HANDBACK_SECTIONS.flatMap((section) => {
    const text = (record[section.key] ?? "").trim();
    return text || section.required ? [{ key: section.key, label: section.label, text, missing: !text }] : [];
  });
}
/** "Hand-back · Done": how the agent itself called the work it returns. */
export const handbackOutcomeLabel = (status: AgentHandback["status"]): string => (status === "partial" ? "Partly done" : status === "blocked" ? "Blocked" : status === "disagree" ? "Disagrees" : "Done");
/** What became of a hand-back. */
export function handbackPill(record: Pick<AgentHandback, "state">): { label: string; status: string } {
  const state = record.state ?? "delivered";
  return state === "accepted" ? { label: "Accepted", status: "approved" } : state === "returned" ? { label: "Returned", status: "changes requested" } : state === "superseded" ? { label: "Replaced", status: "cancelled" } : { label: "Waiting for a decision", status: "awaiting review" };
}
/** The hand-off package the server delivered to an agent, recognised in its conversation: the pane shows the hand-off card in its place. */
export function handoffMessageId(text: string): string | null {
  const body = assignmentOf(text);
  if (!/^Hand-off from "/.test(body)) return null;
  return /^handoffId: (hof_[0-9A-Z]+)$/m.exec(body)?.[1] ?? null;
}
/** What the server told an agent about a hand-off a person decided: the card carries it, the conversation does not repeat it. */
export const isHandoffDecisionMessage = (text: string): boolean => /^The user (accepted the hand-off hof_|took this conversation back)/.test(text) && /This message is from the server/.test(text);
/** Why an agent review went to a person, in words. */
export function escalationReason(approval: Pick<NonNullable<TeamRun["approval"]>, "escalated">): string {
  const reason = approval.escalated?.reason;
  return reason === "max_rounds" ? "The reviewer agent still did not pass the result after the last revision round."
    : reason === "rights_or_safety" ? "The reviewer agent found a rights or safety problem. That is yours to judge."
    : reason === "missing_criterion" ? "The reviewer agent left a criterion without a score."
    : reason === "reviewer_failed" ? "The reviewer agent gave no review twice in a row."
    : reason === "minimum_raised" ? "The reviewer agent passed the result, but this host now asks for a person's sign-off."
    : reason === "reviewer_unavailable" ? "No reviewer agent could be started." : "";
}
/** Why a proposal a reviewer agent had came to the person instead. */
export function proposalEscalationReason(review: Pick<ProposalReview, "escalated">): string {
  const reason = review.escalated?.reason;
  return reason === "apply_failed" ? "The proposal passed the review but could not be applied just then."
    : reason === "host_restart" ? "The host restarted while the reviewer agent was checking this proposal."
    : reason === "max_rounds" ? "The reviewer agent still did not pass the proposal after the last revision round."
    : reason === "minimum_raised" ? "The reviewer agent passed the proposal, but this host now asks for a person's decision."
    : reason ? escalationReason({ escalated: { reason, ts_ms: 0 } }) : "";
}
/** How a dissent ended, as one sentence with its fields (`text` is what was said: the rationale, the request, the direction). */
export function dissentOutcome(dissent: TeamDissent): { label: string; text?: string } {
  if (dissent.human) return dissent.human.decision === "lead" ? { label: "A person sided with the lead", ...(dissent.human.direction ? { text: dissent.human.direction } : {}) } : dissent.human.decision === "peer" ? { label: "A person sided with {role}", ...(dissent.human.direction ? { text: dissent.human.direction } : {}) } : { label: "A person gave another direction", text: dissent.human.direction ?? "" };
  if (dissent.status === "open") return dissent.outcome === "ESCALATED_TO_HUMAN" ? { label: "Waiting for your decision" } : { label: "Waiting for the lead to decide" };
  return dissent.outcome === "NEEDS_MORE_EVIDENCE" ? { label: "The lead asked for more evidence", text: dissent.nextAction ?? dissent.rationale ?? "" } : { label: "The lead decided", text: dissent.rationale ?? "" };
}
/** The reviewer's pass on the result line: who, the total and the round. */
export function agentApproval(approval: NonNullable<TeamRun["approval"]> | undefined): { reviewer: string; total: number; round: number } | null {
  const last = approval?.rounds.at(-1), review = approval?.reviews?.findLast((round) => round.passed);
  return last?.decidedBy.kind === "agent" && review ? { reviewer: approval!.reviewerTitle ?? "Reviewer", total: review.total, round: review.round } : null;
}
/** The roster's arrow badge of an agent in a hand-off. */
export const handoffBadge = (agent: Pick<AgentRecord, "handoff" | "handedBack">): string => (agent.handedBack ? "↩ handed back" : agent.handoff === "handed_off" ? "→ handing off" : agent.handoff === "received" ? "← hand-off received" : "");

// — Notifications that wait for a person: their subject, the way to its card, and what a device does when one is resolved —
const NOTICE_KINDS: readonly AgentNotice["kind"][] = ["agent.handoff_pending", "agent.approval_required", "agent.proposal_ready", "agent.dissent_escalated"];
/** What a notification is about, as one key a device keeps with its inbox entry: the host, the kind and the subject's id. */
export const noticeSubject = (hostId: string, notice: Pick<AgentNotice, "kind" | "subjectId">): string => `${hostId}|${notice.kind}:${notice.subjectId}`;
/** The way from a notification to the card it is about: the session, with the card to bring into view. */
export const noticeRoute = (hostId: string, notice: Pick<AgentNotice, "kind" | "subjectId" | "sessionKey">): string => `/h/${hostId}/sessions/${encodeURIComponent(notice.sessionKey)}?focus=${encodeURIComponent(`${notice.kind}:${notice.subjectId}`)}`;
export type NoticeFocus = { kind: AgentNotice["kind"]; id: string; /** Where its card is: the conversation, or the Team view of the Agents tab. */ place: "chat" | "team" };
/** The card a session route asks for (`?focus=<kind>:<id>`); null for anything that is not one. */
export function noticeFocus(param: string | undefined | null): NoticeFocus | null {
  const at = param?.indexOf(":") ?? -1, kind = at > 0 ? (param!.slice(0, at) as AgentNotice["kind"]) : undefined, id = at > 0 ? param!.slice(at + 1) : "";
  if (!kind || !NOTICE_KINDS.includes(kind) || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return null;
  return { kind, id, place: kind === "agent.handoff_pending" ? "chat" : "team" };
}
/**
 * What a device does with its inbox once it has read what still waits on a host: the entries of that host that are
 * no longer waiting are resolved, and what waits without an entry (raised while this device was away) gets one.
 */
export function reconcileNotices(hostId: string, held: readonly { subject?: string; resolved?: boolean }[], open: readonly AgentNotice[]): { resolve: string[]; add: AgentNotice[] } {
  const waiting = new Set(open.map((notice) => noticeSubject(hostId, notice))), mine = held.filter((entry) => entry.subject?.startsWith(`${hostId}|agent.`));
  return { resolve: [...new Set(mine.filter((entry) => !entry.resolved && !waiting.has(entry.subject!)).map((entry) => entry.subject!))], add: open.filter((notice) => !mine.some((entry) => !entry.resolved && entry.subject === noticeSubject(hostId, notice))) };
}
