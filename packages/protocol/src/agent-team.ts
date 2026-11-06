import { z } from "zod";
import type { Scope } from "./roles.ts";

/** Codes of `multi-agent-orchestration.Multi-agent error codes` this server returns (`WRITER_HELD` is a tool code already). */
export const MULTI_AGENT_ERROR_CODES = [
  "AGENT_NOT_FOUND", "AGENT_NOT_OWNED", "AGENT_POLICY_DENIED", "AGENT_ARCHIVED", "AGENT_CLOSED", "AGENT_BUSY",
  "AGENT_LIMIT_DEPTH", "AGENT_LIMIT_CHILDREN", "AGENT_LIMIT_CONCURRENT", "AGENT_LIMIT_TOTAL", "AGENT_LOOP_DETECTED",
  "TEAM_DISABLED", "TEAM_NOT_FOUND", "TEAM_ROLE_DENIED", "TEAM_LIMIT_CONCURRENT_PEERS", "TEAM_LIMIT_ASSIGNMENTS",
  "TEAM_SHAPE_VIOLATION", "TEAM_TOPOLOGY_VIOLATION", "TEAM_LEAD_UNHEALTHY", "TEAM_RUN_NOT_FOUND", "TEAM_START_FAILED", "HANDOFF_NOT_FOUND", "HANDOFF_NOT_PENDING", "HANDOFF_TARGET_INVALID",
  "TEAM_DISSENT_ROUND_USED",
] as const;
export type MultiAgentErrorCode = (typeof MULTI_AGENT_ERROR_CODES)[number];
/** The multi-agent codes a caller may retry on. */
export const RETRYABLE_AGENT_CODES: readonly string[] = ["AGENT_BUSY", "AGENT_LIMIT_CHILDREN", "AGENT_LIMIT_CONCURRENT", "TEAM_LIMIT_CONCURRENT_PEERS"];

export const AGENT_STATES = ["creating", "idle", "running", "waiting", "failed", "closed"] as const;
export type AgentState = (typeof AGENT_STATES)[number];
export type AgentWaitingReason = "approval" | "question" | "children" | "handoff" | "slot";
export type AgentOutcome = "completed" | "failed" | "cancelled" | "closed";
export type AgentTier = "supervisor" | "lead" | "peer";

export type AgentUsage = { inputTokens: number; outputTokens: number; costUsd: number; costKnown: boolean; turns: number };
export type AgentArtefact = { kind: "proposal" | "note"; id: string; title: string };
/** What a child gives back with `jc_agent_handback`: the hand-off package its caller reads. */
export type AgentHandback = {
  /** `status` is the agent's own outcome of the work (the tool's `outcome`); what became of the record is `state`. */
  handbackId: string; agentId: string; toAgentId: string; status: HandbackOutcome;
  whatChangedOrInspected: string;
  /** The three other required sections (`Hand-back record`); absent only on a record written before they were required. */
  evidence?: string; remainingUncertainty?: string; counterEvidence?: string;
  requestedResolution?: string; currentDirection?: string; claim?: string; risk?: string;
  /** The accepted hand-off this hand-back answers. */
  handoffId?: string;
  /** Who handed back, by name, when the record was written. */
  fromTitle?: string; toTitle?: string;
  openQuestions: string[]; risks: string[]; nextSteps: string[]; artefacts: AgentArtefact[]; created_ms: number;
  /** What its owner (or a person) decided on it; absent on a record written before decisions existed = delivered. */
  state?: HandbackState;
  /** How often this piece of work was returned so far (at most `HANDBACK_MAX_RETURNS`). */
  returns?: number;
  /** The returned hand-back this one answers. */
  supersedes?: string;
  note?: string; decidedBy?: { kind: "agent" | "device"; id: string }; decided_ms?: number;
};
export type HandbackState = "delivered" | "accepted" | "returned" | "superseded";
export const HANDBACK_OUTCOMES = ["done", "partial", "blocked", "disagree"] as const;
export type HandbackOutcome = (typeof HANDBACK_OUTCOMES)[number];
/** Each section of a hand-back is at most this long; the four required ones are at least one character ("None" is said explicitly). */
export const HANDBACK_FIELD_MAX = 12_000;
export const HANDBACK_REQUIRED_FIELDS = ["whatChangedOrInspected", "evidence", "remainingUncertainty", "counterEvidence"] as const;
export const HANDBACK_OPTIONAL_FIELDS = ["requestedResolution", "currentDirection", "claim", "risk"] as const;
/** A hand-back left undecided this long while its owner is idle is marked "Hand-back waiting". */
export const HANDBACK_WAITING_AFTER_MS = 1_800_000;
export const HANDBACK_MAX_RETURNS = 2;
export type AgentResult = { outcome: AgentOutcome; summary: string; handback?: AgentHandback; artefacts: AgentArtefact[]; lastMessage: string; usage: AgentUsage; ended_ms: number; error?: string };

/** One agent of a tree: the record of `multi-agent-orchestration.Agent record`, without the workspace fields (dropped from the product). */
export type AgentRecord = {
  id: string; sessionKey: string; title: string; origin: "user" | "agent" | "team" | "workflow" | "automation";
  parentId?: string; rootId: string; depth: number; ownerAgentId?: string;
  labels: Record<string, string>;
  /** The team of the tree and this agent's place in it. */
  teamId?: string; roleId?: string; roleLabel?: string; tier?: AgentTier; canWrite?: boolean; grantsWrite?: boolean;
  runtimeId?: string; providerId?: string; modelId?: string; modeId: string; projectId?: string;
  state: AgentState; waitingReason?: AgentWaitingReason; attention: "none" | "approval" | "question" | "handoff" | "error";
  lastMessagePreview: string;
  usage: AgentUsage;
  budget: { limitUsd?: number; reservedUsd: number; spentUsd: number; exhausted: boolean };
  result?: AgentResult;
  /** Root only: the tree reached its turn ceiling; nothing is delivered between its agents until a person resumes. */
  deliveryPaused?: { limit: number };
  /** When the agent's current or last turn started. */
  turnStarted_ms?: number;
  /** Set when a person took the agent out of its parent's tree. */
  detached_ms?: number;
  /** What a hand-off left on the agent: it gave a piece of work away, or took one over. */
  handoff?: "handed_off" | "received";
  /** The agent handed its work back and has not been given more since (the roster shows "↩ handed back"). */
  handedBack?: boolean;
  /** A hand-back to this agent has waited for its decision for half an hour while the agent was idle. */
  handbackWaiting?: boolean;
  /** Root only: the agent a person let lead this conversation — what they write in the session goes to it — and who led before. */
  answering?: ConversationLead;
  /** This agent reviews the result of a team run (`Agent reviewer and escalation`): it reads and scores, nothing else. */
  reviewer?: boolean;
  created_ms: number; updated_ms: number; finished_ms?: number; archived_ms?: number;
};

export const AGENT_LIMIT_RANGES = {
  maxDepth: { min: 1, max: 5, default: 3 }, maxConcurrentChildren: { min: 1, max: 20, default: 4 },
  maxConcurrentAgentsPerTree: { min: 1, max: 32, default: 8 }, maxAgentsPerTree: { min: 1, max: 200, default: 24 },
} as const;
export const agentLimitsSchema = z.object({
  maxDepth: z.number().int().min(1).max(5), maxConcurrentChildren: z.number().int().min(1).max(20),
  maxConcurrentAgentsPerTree: z.number().int().min(1).max(32), maxAgentsPerTree: z.number().int().min(1).max(200),
  /** Turns all agents of a tree may take since a person last wrote in it ("Loop prevention", guard 6). */
  maxTurnsPerTree: z.number().int().min(20).max(2000).default(200),
}).strict();
export type AgentLimits = z.infer<typeof agentLimitsSchema>;
export const DEFAULT_AGENT_LIMITS: AgentLimits = { maxDepth: 3, maxConcurrentChildren: 4, maxConcurrentAgentsPerTree: 8, maxAgentsPerTree: 24, maxTurnsPerTree: 200 };

/** Loop guards of `multi-agent-orchestration.Loop prevention` this server enforces. */
export const AGENT_LOOP_LIMITS = { roundTripsPerPair: 2, hops: 12, sendsPerAgentPerMinute: 30, sendsPerTreePerMinute: 200, duplicateWindow_ms: 120_000, blockingWaitsPerTree: 20 } as const;
export const AGENT_WAIT_DEFAULT_MS = 30_000;
export const AGENT_WRITER_QUEUE_MAX = 8;
export const AGENT_WRITER_QUEUE_WAIT_MS = 300_000;

// — Approval policy of a team (`Common approval policy`, the modes this server resolves) —
export const APPROVAL_MODES = ["human", "agent", "auto"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
/** `human` > `agent` > `auto`: a policy is never weaker than the host minimum. */
export const APPROVAL_STRENGTH: Record<ApprovalMode, number> = { auto: 0, agent: 1, human: 2 };
export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
/** The criteria of an agent review when a policy names none (`Common approval policy`). */
export const DEFAULT_REVIEW_CRITERIA = [
  { id: "meets_brief", label: "Meets the brief", weight: 40 }, { id: "correctness", label: "Correctness and continuity", weight: 30 },
  { id: "quality", label: "Quality of execution", weight: 20 }, { id: "rights_safety", label: "Rights and safety", weight: 10 },
] as const;
export const APPROVAL_DEFAULTS = { reviewerRole: "reviewer", threshold: 75, criterionFloor: 50, maxRounds: 2, blockOnSeverity: "high", remindAfter_ms: 1_800_000, notify: true } as const;
export const reviewCriterionSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), label: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), weight: z.number().int().min(1).max(100) }).strict();
export type ReviewCriterion = z.infer<typeof reviewCriterionSchema>;
/** Who a reviewer agent is to the people who read its reviews, and how it is told to judge (`reviewer.persona` of the policy): its name titles the agent, its instructions lead its review. */
export const reviewerPersonaSchema = z.object({ name: z.string().trim().min(1).max(60), instructions: z.string().max(4000).optional() }).strict();
export type ReviewerPersona = z.infer<typeof reviewerPersonaSchema>;
/** The one policy object of every sign-off (`Common approval policy`): `reviewer` names a routing role, optionally one of its profiles, and optionally the persona the reviewer agent runs as. */
export const approvalPolicySchema = z.object({
  mode: z.enum(APPROVAL_MODES),
  reviewer: z.object({ role: z.string().min(1).max(40).default(APPROVAL_DEFAULTS.reviewerRole), profileId: z.string().min(1).max(40).optional(), persona: reviewerPersonaSchema.optional() }).strict().optional(),
  criteria: z.array(reviewCriterionSchema).min(1).max(12).refine((list) => new Set(list.map((entry) => entry.id)).size === list.length, "Each criterion needs its own id.").optional(),
  threshold: z.number().min(50).max(95).optional(), criterionFloor: z.number().min(0).max(90).optional(), maxRounds: z.number().int().min(0).max(5).optional(),
  blockOnSeverity: z.enum(["critical", "high", "medium", "none"]).optional(), remindAfter_ms: z.number().int().min(60_000).max(86_400_000).optional(), notify: z.boolean().optional(),
}).strict();
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
/** A policy with every default filled in: what one sign-off was decided under. */
export type ResolvedApprovalPolicy = {
  mode: ApprovalMode; reviewer: { role: string; profileId?: string; persona?: ReviewerPersona }; criteria: ReviewCriterion[]; threshold: number; criterionFloor: number; maxRounds: number;
  blockOnSeverity: "critical" | "high" | "medium" | "none"; remindAfter_ms: number; notify: boolean;
};
export function resolveApprovalPolicy(policy: ApprovalPolicy | undefined, mode: ApprovalMode): ResolvedApprovalPolicy {
  return {
    mode, reviewer: { role: policy?.reviewer?.role ?? APPROVAL_DEFAULTS.reviewerRole, ...(policy?.reviewer?.profileId ? { profileId: policy.reviewer.profileId } : {}), ...(policy?.reviewer?.persona ? { persona: policy.reviewer.persona } : {}) },
    criteria: policy?.criteria?.length ? policy.criteria : DEFAULT_REVIEW_CRITERIA.map((entry) => ({ ...entry })),
    threshold: policy?.threshold ?? APPROVAL_DEFAULTS.threshold, criterionFloor: policy?.criterionFloor ?? APPROVAL_DEFAULTS.criterionFloor, maxRounds: policy?.maxRounds ?? APPROVAL_DEFAULTS.maxRounds,
    blockOnSeverity: policy?.blockOnSeverity ?? APPROVAL_DEFAULTS.blockOnSeverity, remindAfter_ms: policy?.remindAfter_ms ?? APPROVAL_DEFAULTS.remindAfter_ms, notify: policy?.notify ?? APPROVAL_DEFAULTS.notify,
  };
}
export type ReviewFinding = { severity: ReviewSeverity; category: string; message: string };
/** One review of a subject by the reviewer agent. `total` is the weighted score (0–100, two decimals). */
export type ReviewRound = {
  round: number; reviewerAgentId: string; model?: string; scores: Record<string, number>; total: number; verdict: "approve" | "request_changes"; summary: string; findings: ReviewFinding[];
  passed: boolean; /** Why a round with the verdict "approve" did not pass. */ note?: string; started_ms: number; ended_ms: number; costUsd: number;
};
/** The weighted total of a review: the weights are normalised to sum 100. */
export function reviewTotal(criteria: readonly { id: string; weight: number }[], scores: Record<string, number>): number {
  const sum = criteria.reduce((total, entry) => total + entry.weight, 0);
  return Math.round((criteria.reduce((total, entry) => total + (scores[entry.id] ?? 0) * entry.weight, 0) / (sum || 1)) * 100) / 100;
}
/** Who agents can call (`Who-can-call-whom policy presets`): inside their session's tree, or also the other members of their team run. */
export const AGENT_CALL_PRESETS = ["tree", "team"] as const;
export type AgentCallPreset = (typeof AGENT_CALL_PRESETS)[number];

// — Teams —
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
export const teamRoleSchema = z.object({
  roleId: slug, tier: z.enum(["supervisor", "lead", "peer"]), label: z.string().trim().min(1).max(40),
  /** The ORC role whose route gives the role's agents their model. */
  orcRole: z.string().min(1).max(40),
  contract: z.object({
    responsibility: z.string().trim().min(1).max(1000), ownershipBoundary: z.string().trim().min(1).max(1000),
    expectedHandback: z.string().trim().min(1).max(1000), canWrite: z.boolean(),
  }).strict(),
  instructions: z.string().max(4000).optional(), enabled: z.boolean(),
}).strict();
export type TeamRole = z.infer<typeof teamRoleSchema>;
export const teamSchema = z.object({
  id: slug, name: z.string().trim().min(1).max(60), description: z.string().max(280), templateId: z.string().optional(), enabled: z.boolean(),
  roles: z.array(teamRoleSchema).min(2).max(24),
  limits: z.object({
    maxConcurrentPeersPerLead: z.number().int().min(1).max(12), maxAssignmentsPerBrief: z.number().int().min(1).max(100),
    maxRunCostUsd: z.number().min(0.01).max(10_000).optional(),
    /** Turns the Director and its agents may take together since a person last wrote: the ceiling that also holds on plan-billed runtimes, where no cost is known. */
    maxRunTurns: z.number().int().min(3).max(2000).optional(),
  }).strict(),
  writerPolicy: z.enum(["lead_assigns", "queue"]),
  /** Who signs off the result of a run of this team; absent: the host default. */
  resultApproval: approvalPolicySchema.optional(),
  /** Who accepts a proposal of a member (the same policy object as for a result); absent: the mode of the session decides, as for any agent. */
  proposalApproval: approvalPolicySchema.optional(),
  created_ms: z.number().int(), updated_ms: z.number().int(), rev: z.number().int().nonnegative(),
}).strict();
export type Team = z.infer<typeof teamSchema>;
/** A team as the list shows it: `template` is true while a shipped team was never edited. */
export type TeamSummary = Pick<Team, "id" | "name" | "description" | "enabled" | "rev"> & { roleCount: number; template: boolean; templateId?: string };

const agentId = z.string().min(1).max(64);
const sessionKey = z.string().min(1).max(200);
const treeOf = z.object({ rootId: agentId.optional(), agentId: agentId.optional(), sessionKey: sessionKey.optional(), includeArchived: z.boolean().optional() }).strict();
export const agentTeamRpcParams = {
  "jagentchill.agent.list": z.object({ scope: z.literal("host").optional(), sessionKey: sessionKey.optional(), rootId: agentId.optional(), includeArchived: z.boolean().optional() }).strict(),
  "jagentchill.agent.get": z.object({ agentId }).strict(),
  "jagentchill.agent.tree.get": treeOf,
  "jagentchill.agent.send": z.object({ agentId, prompt: z.string().trim().min(1).max(32_000) }).strict(),
  "jagentchill.agent.stop": z.object({ agentId }).strict(),
  "jagentchill.agent.stopAll": z.object({ rootId: agentId.optional(), sessionKey: sessionKey.optional() }).strict(),
  "jagentchill.agent.close": z.object({ agentId }).strict(),
  "jagentchill.agent.archive": z.object({ agentId }).strict(),
  "jagentchill.agent.restore": z.object({ agentId }).strict(),
  "jagentchill.agent.limits.get": z.object({}).strict(),
  "jagentchill.agent.limits.set": z.object({ limits: agentLimitsSchema }).strict(),
  "jagentchill.agent.limits.raise": z.object({ rootId: agentId }).strict(),
  "jagentchill.agent.delivery.resume": z.object({ rootId: agentId }).strict(),
  "jagentchill.agent.budget.set": z.object({ agentId, limitUsd: z.number().min(0.01).max(10_000).nullable() }).strict(),
  "jagentchill.agent.team.set": z.object({ sessionKey, teamId: slug.nullable() }).strict(),
  "jagentchill.orc.team.list": z.object({}).strict(),
  "jagentchill.orc.team.get": z.object({ teamId: slug }).strict(),
  "jagentchill.orc.team.save": z.object({ team: teamSchema.omit({ created_ms: true, updated_ms: true }) }).strict(),
  "jagentchill.orc.team.duplicate": z.object({ teamId: slug }).strict(),
  "jagentchill.orc.team.reset": z.object({ teamId: slug }).strict(),
  "jagentchill.orc.team.delete": z.object({ teamId: slug }).strict(),
  "jagentchill.agent.detach": z.object({ agentId }).strict(),
  "jagentchill.agent.handoff.list": z.object({ rootId: agentId.optional(), sessionKey: sessionKey.optional() }).strict(),
  "jagentchill.agent.conversation.return": z.object({ sessionKey }).strict(),
  "jagentchill.agent.handoff.resolve": z.object({ handoffId: z.string().min(1).max(64), decision: z.enum(["accept", "reject", "cancel"]), note: z.string().max(1000).optional() }).strict(),
  "jagentchill.agent.handback.list": z.object({ rootId: agentId.optional(), sessionKey: sessionKey.optional() }).strict(),
  "jagentchill.agent.handback.resolve": z.object({ handbackId: z.string().min(1).max(64), decision: z.enum(["accept", "return"]), note: z.string().max(2000).optional() }).strict(),
  "jagentchill.agent.policy.get": z.object({ sessionKey: sessionKey.optional() }).strict(),
  "jagentchill.agent.policy.set": z.object({ preset: z.enum(AGENT_CALL_PRESETS) }).strict(),
  "jagentchill.orc.approval.get": z.object({}).strict(),
  "jagentchill.orc.approval.set": z.object({ default: z.enum(APPROVAL_MODES).optional(), minimum: z.enum(APPROVAL_MODES).optional() }).strict(),
  "jagentchill.orc.run.start": z.object({ sessionKey, request: z.string().max(32_000) }).strict(),
  "jagentchill.orc.run.get": z.object({ runId: z.string().min(1).max(64).optional(), sessionKey: sessionKey.optional() }).strict(),
  "jagentchill.orc.run.list": z.object({ sessionKey }).strict(),
  "jagentchill.orc.run.cancel": z.object({ runId: z.string().min(1).max(64), reason: z.string().max(500).optional() }).strict(),
  "jagentchill.orc.run.resume": z.object({ runId: z.string().min(1).max(64) }).strict(),
  "jagentchill.agent.notice.list": z.object({}).strict(),
  "jagentchill.orc.signoff.resolve": z.object({ runId: z.string().min(1).max(64), decision: z.enum(["approve", "request_changes", "reject"]), note: z.string().max(4000).optional() }).strict(),
  /** A person decides an escalated dissent: with the lead, with the peer, or another direction in their own words. */
  "jagentchill.orc.run.resolveEscalation": z.object({ runId: z.string().min(1).max(64), dissentId: z.string().min(1).max(64), decision: z.enum(["lead", "peer", "other"]), direction: z.string().trim().min(1).max(4000).optional() }).strict(),
} as const;
export type AgentTeamMethod = keyof typeof agentTeamRpcParams;

const READ: Scope = "jagentchill.projects.read", USE: Scope = "jagentchill.agent.use", CONFIG: Scope = "jagentchill.config.write";
export const AGENT_TEAM_METHOD_SCOPES: Record<AgentTeamMethod, Scope> = {
  "jagentchill.agent.list": READ, "jagentchill.agent.get": READ, "jagentchill.agent.tree.get": READ,
  "jagentchill.agent.send": USE, "jagentchill.agent.stop": USE, "jagentchill.agent.stopAll": USE, "jagentchill.agent.close": USE, "jagentchill.agent.archive": USE, "jagentchill.agent.restore": USE,
  "jagentchill.agent.limits.get": READ, "jagentchill.agent.limits.set": CONFIG, "jagentchill.agent.limits.raise": USE, "jagentchill.agent.delivery.resume": USE, "jagentchill.agent.budget.set": CONFIG, "jagentchill.agent.team.set": USE,
  "jagentchill.orc.team.list": READ, "jagentchill.orc.team.get": READ, "jagentchill.orc.team.save": CONFIG, "jagentchill.orc.team.duplicate": CONFIG, "jagentchill.orc.team.reset": CONFIG, "jagentchill.orc.team.delete": CONFIG,
  "jagentchill.agent.detach": USE, "jagentchill.agent.conversation.return": USE, "jagentchill.agent.handoff.list": READ, "jagentchill.agent.handoff.resolve": USE, "jagentchill.agent.handback.list": READ, "jagentchill.agent.handback.resolve": USE,
  "jagentchill.agent.policy.get": READ, "jagentchill.agent.policy.set": CONFIG, "jagentchill.orc.approval.get": READ, "jagentchill.orc.approval.set": CONFIG,
  "jagentchill.orc.run.start": USE, "jagentchill.orc.run.get": READ, "jagentchill.orc.run.list": READ, "jagentchill.orc.run.cancel": USE, "jagentchill.orc.run.resume": USE, "jagentchill.orc.run.resolveEscalation": USE, "jagentchill.orc.signoff.resolve": USE,
  "jagentchill.agent.notice.list": USE,
};

/**
 * `jagentchill.agent.notice`: a notification of the catalogue (`notifications.Notification event catalogue`) for the
 * devices that may act in the session — each shows it and keeps it in its inbox. One per subject; `reminder` marks the
 * one reminder of a sign-off that still waits.
 */
export type AgentNotice = {
  kind: "agent.handoff_pending" | "agent.approval_required" | "agent.proposal_ready" | "agent.dissent_escalated"; sessionKey: string; rootId: string; subjectId: string;
  /** The names the sentence is made of: who asks, who would take over, what the subject is called. */
  from?: string; to?: string; title?: string; reminder?: boolean; ts_ms: number;
  /** The subject no longer waits for a person — one device decided, or it ended: every device takes its notification out of "waiting". */
  resolved?: boolean;
};
/** `jagentchill.agent.updated` on stream `agent:<rootId>`: `seq` grows by one per tree; a gap means "read the tree again". */
export type AgentUpdatedEvent = { rootId: string; seq: number; agent: AgentRecord };

// — Hand-offs (`Hand-off verb`): the lead of a piece of work passes from one agent to another with a context package —
export const HANDOFF_SCOPES = ["task", "lead", "conversation"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];
/** Who answers the person in a session after a conversation hand-off was accepted. */
export type ConversationLead = { agentId: string; title: string; sessionKey: string; handoffId: string; since_ms: number; /** Who led before; absent: the session's own agent. */ previousAgentId?: string; previousTitle?: string };
export type HandoffStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired";
export type HandoffPackage = { brief: string; historySummary: string; artefacts: { kind: string; id: string; title: string; note?: string }[]; openQuestions: string[]; acceptanceCriteria: string[]; dueHint?: string };
export type AgentHandoff = {
  id: string; rootId: string; fromAgentId: string; fromTitle: string; toAgentId: string; toTitle: string; scope: HandoffScope; package: HandoffPackage; writer: boolean; reason?: string;
  status: HandoffStatus; note?: string;
  /** Whose decision it is: a person's (always for a conversation), or the receiving agent's. */
  decision: "human" | "agent";
  /** The receiver may do more than the sender (a higher mode, unattended use): that is why a person decides. */
  raisesPermission?: boolean;
  /** The receiver was created by this hand-off. */
  createdReceiver?: boolean;
  decidedBy?: { kind: "agent" | "device" | "system"; id: string }; created_ms: number; expires_ms: number; decided_ms?: number;
};
export const HANDOFF_LIMITS = { brief: 8000, historySummary: 12_288, artefacts: 50, questions: 20, questionLength: 500, defaultExpiry_ms: 1_800_000, minExpiry_ms: 60_000, maxExpiry_ms: 86_400_000 } as const;

// — Team runs (`Team run state machine`): a brief worked through Director → lead → assignments → acceptance → relay —
export const RUN_STATUSES = ["briefing", "running", "waiting_human", "paused", "completed", "failed", "cancelled"] as const;
export type TeamRunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STAGES = ["supervisor", "lead", "assignments", "acceptance", "relay"] as const;
export type TeamRunStage = (typeof RUN_STAGES)[number];
export const ROUTE_CATEGORIES = ["planning", "script", "edit", "search", "research", "audit", "ui"] as const;
export type RouteCategory = (typeof ROUTE_CATEGORIES)[number];
/** The task brief the deterministic parser prepares from a request (`Task brief`, `Brief authoring and clarification` with a model off). */
export type TeamBrief = {
  id: string; rawRequest: string; objective: string; context?: string; constraints: string[]; acceptedDecisions: string[]; requestedOutcome: string;
  acceptanceCriteria: string[]; validationPlan: string[]; deliverables: string[]; routeCategory: RouteCategory; normalizedPrompt: string; authoredBy: "parser"; created_ms: number;
};
export type TeamAssignment = {
  id: string; agentId: string; parentAgentId: string; roleId: string; roleLabel: string; title: string; assignment: string; ownershipBoundary: string; expectedHandback: string; grantsWrite: boolean;
  status: "active" | "handed_back" | "dissent_open" | "accepted" | "failed" | "cancelled"; handbackId?: string; created_ms: number; ended_ms?: number;
  /** The one round of "needs more evidence" of this assignment was used (`Dissent resolution`). */
  moreEvidenceUsed?: boolean;
  /** The agent's turn was cut off by a restart of the host; the assignment is still its own. */
  interrupted?: boolean;
};
export type TeamRunResult = { summary: string; evidence: string; remainingUncertainty: string; artefacts: AgentArtefact[]; acceptedBy: string; accepted_ms?: number };
/**
 * The approval record of a run's result (`Common approval policy`): the policy it was decided under, the reviews of the
 * reviewer agent (`reviews`), and the decisions (`rounds`: a person's, the policy's, or the reviewer's pass).
 */
export type TeamRunApproval = {
  id?: string; subject?: { kind: "team_result"; id: string };
  mode: ApprovalMode; policy?: ResolvedApprovalPolicy; source: "team" | "host_default"; raisedByHostMinimum: boolean;
  /** `reviewing`: the reviewer agent has the result. `interrupted`: a restart cut the review off; the result is offered again. */
  status: "pending" | "reviewing" | "interrupted" | "approved" | "changes_requested" | "rejected";
  rounds: { verdict: "approve" | "request_changes" | "reject"; note?: string; decidedBy: { kind: "device" | "policy" | "agent"; id: string }; ts_ms: number }[];
  reviews?: ReviewRound[];
  reviewerAgentId?: string; reviewerTitle?: string;
  /** When the one reminder of a sign-off that still waits was raised (`Human approval`: after `remindAfter_ms`). */
  reminded_ms?: number; notified_ms?: number;
  /** The review in progress, and how often in a row the reviewer ended without an answer. */
  reviewStarted_ms?: number; reviewerFailures?: number;
  /** Why the agent review went to a person. */
  escalated?: { reason: "max_rounds" | "reviewer_failed" | "rights_or_safety" | "missing_criterion" | "reviewer_unavailable" | "minimum_raised"; detail?: string; ts_ms: number };
  warning?: string;
  outcome?: "approved" | "changes_requested" | "rejected" | "escalated" | "auto_approved" | "cancelled";
  decidedBy?: { kind: "device" | "agent" | "policy"; id: string }; decided_ms?: number;
};
export const DISSENT_OUTCOMES = ["RESOLVED_BY_LEAD", "NEEDS_MORE_EVIDENCE", "ESCALATED_TO_HUMAN"] as const;
export type DissentOutcome = (typeof DISSENT_OUTCOMES)[number];
/** A peer disagrees with its assignment or asks for a decision (`Dissent resolution`): the lead closes it, or a person does once the lead escalated it. */
export type TeamDissent = {
  id: string; assignmentId: string; peerAgentId: string; peerTitle: string; peerRoleLabel: string; handbackId?: string; claim?: string; requestedResolution?: string;
  status: "open" | "resolved"; outcome?: DissentOutcome; rationale?: string; nextAction?: string; verificationRound: 0 | 1; created_ms: number; resolved_ms?: number;
  /** Escalated: the person's decision, once given. */
  human?: { decision: "lead" | "peer" | "other"; direction?: string; deviceId: string; ts_ms: number };
};
/**
 * The agent review of ONE proposal thread of a session (`Common approval policy` for member proposals): the proposal
 * under review now, every round, and how it ended. A revised proposal of the same session goes on in the same record.
 */
export type ProposalReview = {
  id: string; subject: { kind: "proposal"; id: string }; title: string; sessionKey: string; rootId: string; authorAgentId: string; authorTitle: string; runId?: string;
  mode: ApprovalMode; policy: ResolvedApprovalPolicy; source: "team" | "host_default"; raisedByHostMinimum: boolean;
  /** `interrupted`: a host restart cut the review off while its run is paused; it starts again when a person resumes the run. */
  status: "reviewing" | "interrupted" | "approved" | "rejected" | "changes_requested" | "escalated" | "superseded";
  /** A person decided the proposal from its card: during the review (`superseded`) or after it was escalated to them (`approved` / `rejected`). */
  human?: { decision: "accept" | "accept_partial" | "reject"; deviceId: string; ts_ms: number };
  reviews: ReviewRound[]; reviewerAgentId?: string; reviewerTitle?: string; reviewStarted_ms?: number; reviewerFailures?: number;
  escalated?: { reason: NonNullable<TeamRunApproval["escalated"]>["reason"] | "apply_failed" | "host_restart"; detail?: string; ts_ms: number };
  warning?: string; decidedBy?: { kind: "agent" | "device"; id: string }; created_ms: number; updated_ms: number;
};
export type TeamRunEvent = { ts_ms: number; kind: string; text: string; agentId?: string };
export type TeamRun = {
  id: string; teamId: string; teamName: string; rootId: string; sessionKey: string; projectId?: string; brief: TeamBrief; startedBy: string;
  /** The team as it was when the run started: what the run is held to, whatever is edited afterwards. */
  teamSnapshot?: Team;
  supervisorAgentId: string; leadAgentId?: string; status: TeamRunStatus; stage?: TeamRunStage; waitingReason?: "signoff" | "dissent"; delegated: boolean;
  /** Disagreements of peers with their assignment (`Dissent resolution`), oldest first. No result is accepted while one is open. */
  dissents?: TeamDissent[];
  /** Why a paused run waits, and the status it goes back to when a person resumes it. */
  pauseReason?: "host_restart"; pausedFrom?: "briefing" | "running" | "waiting_human";
  /** A Resume that failed half-way: the agents whose turn it had started and the agent engine would not stop (`unstopped`) — the run cannot be resumed while one still runs. `held`: messages that wait for the resume. */
  recovery?: { told: string[]; unstopped?: string[] }; held?: { agentId: string; text: string }[];
  assignments: TeamAssignment[]; candidate?: TeamRunResult; acceptedResult?: TeamRunResult; approval?: TeamRunApproval;
  /** The lead asked to accept while the person had not decided on a member's proposal: it is told when they have. */
  awaitingProposals?: boolean;
  limits: { maxConcurrentPeersPerLead: number; maxAssignmentsPerBrief: number }; events: TeamRunEvent[];
  created_ms: number; updated_ms: number; ended_ms?: number; endReason?: string;
};
/** What a device reads for the Team view of a session: its runs, newest first. */
export type TeamRunView = { rootId: string; runs: TeamRun[]; /** The agent reviews of proposals of this tree, newest first. */ proposalReviews?: ProposalReview[] };
/** `jagentchill.agent.team.changed` on stream `agent:<rootId>`: a run or a hand-off of the tree changed; read `jagentchill.orc.run.get` again. */
export type AgentTeamChangedEvent = { rootId: string };
