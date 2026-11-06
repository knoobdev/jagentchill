/**
 * Sub-agents and teams (`multi-agent-orchestration`): one record per agent, the parent–child tree of a chat session,
 * the limits of a tree, free agent-to-agent calls (create, send, wait, cancel, hand back), teams with fixed roles,
 * who may write to a project, budgets by subtree, and what a caller gets back when a child settles.
 *
 * An agent IS a session of the relay (`../sessions.ts`); this service adds what a session does not know: who created
 * it, in which role, what it may do, and who waits for it. Nothing here talks to a model: a child works because the
 * relay delivers its first message, and its caller hears of the outcome through a message the relay delivers back.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AGENT_LOOP_LIMITS, AGENT_TEAM_METHOD_SCOPES, HANDBACK_FIELD_MAX, stripInjectedUserText, HANDBACK_MAX_RETURNS, HANDBACK_OPTIONAL_FIELDS, HANDBACK_REQUIRED_FIELDS, HANDBACK_WAITING_AFTER_MS, AGENT_WAIT_DEFAULT_MS, AGENT_WRITER_QUEUE_WAIT_MS, DEFAULT_AGENT_LIMITS, ORC_BUILTIN_ROLES, RETRYABLE_AGENT_CODES, agentLimitsSchema, agentTeamRpcParams, teamSchema,
  type AgentArtefact, type AgentHandback, type HandbackOutcome, type AgentLimits, type AgentOutcome, type AgentRecord, type AgentResult, type AgentState, type AgentTeamMethod, type AgentUsage, type AgentWaitingReason,
  type AgentNotice, type ErrorCode, type ModelRef, type ProductMode, type Scope, type Team, type TeamRole, type TeamSummary,
} from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../../channel/ws-channel.ts";
import { ProtocolError } from "../../errors.ts";
import { audit } from "../../store/database.ts";
import type { ServerConfigFile } from "../../store/server-config.ts";
import { withTurnContext, type SessionRecord } from "../sessions.ts";
import { activityOf } from "./activity.ts";
import { createHandoffs } from "./handoffs.ts";
import { childPrompt, notificationText, type Notification } from "./prompts.ts";
import { AGENT_RULES, decide, type Verb } from "./rules.ts";
import { createRuns } from "./runs.ts";
import { shippedTeams, teamProblems } from "./teams.ts";

/** What this service needs of the relay. */
export type TeamSessions = {
  session(key: string): SessionRecord | undefined;
  canRead(key: string, connection: Connection): boolean;
  canAct(key: string, connection: Connection): boolean;
  isRunning(key: string): boolean;
  abort(key: string): Promise<boolean | void>;
  setMode(key: string, modeId: ProductMode): Promise<"now" | "next_turn">;
  routeOf(key: string, role: string): { profileId: string; ref: ModelRef; thinking?: string }[];
  retarget(key: string, target: { ref: ModelRef; thinking?: string }): Promise<SessionRecord>;
  detachSession(key: string, deviceId: string): SessionRecord;
  retitle(key: string, title: string): SessionRecord;
  deliver(key: string, message: string): Promise<boolean>;
  notify(key: string, event: string, payload: unknown): void;
  /** The newest messages of a session's transcript, oldest first. */
  history(key: string, limit?: number): Array<{ role?: string; content?: unknown }>;
  spawn(parentKey: string, input: { title: string; ref?: ModelRef; role?: string; modeId?: ProductMode; projectId?: string | null; agentId?: string; unattendedCeiling?: boolean }): Promise<SessionRecord>;
};
export type AgentTeamDeps = {
  db: DatabaseSync; now: () => number; config: ServerConfigFile;
  sessions: () => TeamSessions;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter: (connection: Connection) => boolean) => void;
  /**
   * The taint of a session (`agent-editing-tools.Untrusted content handling`; the tools service keeps and enforces it):
   * content that passes from one agent to another takes the mark — and the untrusted text kept for it — along.
   */
  taint?: { is(sessionKey: string): boolean; mark(sessionKey: string, source: string, texts?: readonly string[]): void; retained(sessionKey: string): string[] };
  /** Proposals as the tools service holds them: what a reviewer agent is shown of one, and its acceptance or rejection once the review is in. */
  proposals?: { view(proposalId: string): { title?: string; summary?: string; state: string } | undefined; resolve(proposalId: string, action: "accept" | "reject", by: { deviceId: string; automatic?: boolean }, options?: { feedback?: string }): Promise<unknown> };
  /** The time limit of one call of a routing role, in seconds (`orc-model-routing.Role limits`), when the host set one. */
  roleTimeoutSeconds?: (roleId: string) => number | undefined;
  /** What a session's agent is told about its project before its first message. */
  turnContext?: (session: SessionRecord) => string | undefined;
  /** The host budgets of a session (`usage`): a tree spends against those of its root. */
  rootBudget?: (rootSessionKey: string) => void;
  /** Test only: how long settled children are gathered into one message, the delays between delivery attempts, how long a queued writer waits. */
  timings?: { notifyBatchMs?: number; retryMs?: number[]; writerQueueMs?: number; usageSettleMs?: number; /** How long a reviewer agent has for one review. */ reviewTimeoutMs?: number; /** After how long an undecided hand-back is marked as waiting. */ handbackWaitMs?: number; /** How long a turn may still run after its hand-back before the server stops it. */ handbackGraceMs?: number; /** After how long a sign-off that still waits is reminded of (test only; the policy's `remindAfter_ms` otherwise). */ remindAfterMs?: number };
};

export type Extra = {
  labels: Record<string, string>; teamId?: string; roleId?: string; roleLabel?: string; tier?: TeamRole["tier"]; canWrite?: boolean; grantsWrite?: boolean;
  limitUsd?: number;
  /** The agent whose budget pays for this one, when that is not the agent that created it: the sender of the hand-off that created it. */
  fundedBy?: string;
  preview?: string; result?: AgentResult; turnStarted_ms?: number; hop?: number;
  /** Agents a person allowed beyond `maxAgentsPerTree` (root only), and the team run they were allowed for (none: the agents outside runs). */
  extraTotal?: number; extraFor?: string;
  /** The limit the "Budget reached" notice was last raised for (root only), so it is raised once. */
  budgetTold?: number;
  /** The turn ceiling the tree stopped at (root only); cleared when a person writes or resumes. */
  paused?: { limit: number };
  /** The agent this one reports to once a hand-off moved it; without one, its parent. */
  ownerId?: string;
  detached_ms?: number;
  handoff?: "handed_off" | "received";
  /** A model change asked for while the agent worked: applied when its turn has ended, before the next one. */
  pendingModel?: { profileId: string; role: string; ref: ModelRef; thinking?: string; by: string };
  /** The team run this agent works in, and its assignment in it (a peer). */
  runId?: string; assignmentId?: string;
  /** The reviewer agent of a run's result or of a proposal (`reviewOf`: the proposal review it answers): it reads and answers with jc_review_submit. */
  reviewer?: boolean; reviewOf?: string;
  /** Root only: the agent a person let lead the conversation (a `conversation` hand-off), and who led before it. */
  answering?: { agentId: string; handoffId: string; since_ms: number; previousAgentId?: string };
  /** The agent handed its work back in the turn that is (or was last) running: that turn is over — it is idle, nothing more of the turn is taken, and the server stops what still runs. Cleared when its next turn starts. */
  handedBackTurn?: string;
  /** A hand-back to this agent waited half an hour for its decision while the agent was idle. */
  handbackWaiting?: boolean;
};
type Row = {
  id: string; session_key: string; parent_id: string | null; root_id: string; depth: number; origin: string; title: string; state: string;
  waiting_reason: string | null; attention: string; json: string; created_ms: number; updated_ms: number; finished_ms: number | null; archived_ms: number | null;
};
export type Agent = Omit<Row, "json"> & { extra: Extra };
type Json = Record<string, unknown>;

const ACTIVE: readonly string[] = ["creating", "running", "waiting"];
/** How long a turn may go on after its hand-back (the model is told to end it) before the server stops it. */
const HANDBACK_GRACE_MS = 5000;
/** What the record of an agent says when its turn did not survive a restart of the host. */
export const RESTART_NOTE = "Interrupted by a host restart";
const LABEL_KEY = /^[a-z][a-z0-9._-]{0,39}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** `agt_` + a 26-character ULID: 48 bits of time, 80 of randomness. */
export function newAgentId(now: number): string {
  let time = "", value = now;
  for (let index = 0; index < 10; index++) { time = CROCKFORD[value % 32] + time; value = Math.floor(value / 32); }
  const random = [...randomBytes(16)].map((byte) => CROCKFORD[byte % 32]).join("");
  return `agt_${time}${random}`;
}
const money = (value: number) => Math.round(value * 1e6) / 1e6;
const fail = (code: ErrorCode, message: string, details?: Json): never => { throw new ProtocolError(code, message, { retryable: RETRYABLE_AGENT_CODES.includes(code), ...(details ? { details } : {}) }); };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? (content as Json[]).filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => String(part.text)).join("\n") : "").trim();

export type CreateInput = {
  title: string; prompt: string; role?: string; runtime?: string; model?: string; mode?: ProductMode; projectId?: string; labels?: Record<string, string>;
  budgetUsd?: number; wait?: "notify" | "block" | "none"; timeout_ms?: number; grantsWrite?: boolean; idempotencyKey?: string;
  /** Set by the team tools only: the agent is staffed by a run, with the run and the assignment it belongs to. */
  /** Set by a hand-off that creates its receiver: the agent on whose behalf it is created (the sender). The new agent gets no more than THAT agent has — its mode, its unattended grant, its budget, its right to create agents at all. */
  ceilingOf?: string;
  via?: { /** Absent for the reviewer of a proposal made outside a run. */ runId?: string; assignmentId?: string; /** The run's Director: staffed by the run itself, in the team's supervisor role. */ supervisor?: boolean; /** The reviewer of the run's result: no role of the team — a routing role (`role`) and, optionally, one of its profiles. */ reviewer?: boolean; profileId?: string; /** The reviewer of a proposal: the review record it answers. */ reviewOf?: string };
};

export function createAgentTeamService(deps: AgentTeamDeps) {
  const { db } = deps;
  const now = () => deps.now(), sessions = () => deps.sessions();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, session_key TEXT NOT NULL UNIQUE, parent_id TEXT, root_id TEXT NOT NULL, depth INTEGER NOT NULL, origin TEXT NOT NULL, title TEXT NOT NULL,
      state TEXT NOT NULL, waiting_reason TEXT, attention TEXT NOT NULL DEFAULT 'none', json TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, finished_ms INTEGER, archived_ms INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS agents_root ON agents (root_id);
    CREATE TABLE IF NOT EXISTS agent_teams (id TEXT PRIMARY KEY, json TEXT NOT NULL, pristine INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS agent_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, armer_id TEXT NOT NULL, agent_id TEXT NOT NULL, settle_key TEXT NOT NULL DEFAULT '', json TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, ts_ms INTEGER NOT NULL,
      UNIQUE (armer_id, agent_id, settle_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_handbacks (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, json TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS agent_idempotency (owner_id TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, agent_id TEXT NOT NULL, ts_ms INTEGER NOT NULL, PRIMARY KEY (owner_id, key)) STRICT;
  `);
  // The shipped teams exist from the first start; a team a person edited or removed is never written again.
  for (const team of shippedTeams(now())) db.prepare("INSERT OR IGNORE INTO agent_teams (id, json, pristine) VALUES (?, ?, 1)").run(team.id, JSON.stringify(team));

  // — Records —
  const read = (row: Row | undefined): Agent | undefined => {
    if (!row) return undefined;
    const { json, ...rest } = row;
    return { ...rest, extra: JSON.parse(json) as Extra };
  };
  const byId = (id: string) => read(db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined);
  const bySession = (key: string) => read(db.prepare("SELECT * FROM agents WHERE session_key = ?").get(key) as Row | undefined);
  const treeOf = (rootId: string): Agent[] => (db.prepare("SELECT * FROM agents WHERE root_id = ? ORDER BY created_ms, id").all(rootId) as Row[]).map((row) => read(row)!);
  const childrenOf = (agent: Agent, tree = treeOf(agent.root_id)) => tree.filter((entry) => entry.parent_id === agent.id);
  function descendants(agent: Agent, tree = treeOf(agent.root_id)): Agent[] {
    const out: Agent[] = [];
    const walk = (parent: Agent) => { for (const child of childrenOf(parent, tree)) { out.push(child); walk(child); } };
    walk(agent);
    return out;
  }
  /** Whom an agent reports to: its parent, until a hand-off gave it another owner. */
  const ownerOf = (agent: Agent): string | null => agent.extra.ownerId ?? agent.parent_id;
  /** Whether `agent` is below `caller` along the chain of owners. */
  function owns(caller: Agent, agent: Agent, tree = treeOf(agent.root_id)): boolean {
    const seen = new Set<string>();
    for (let current = ownerOf(agent); current && !seen.has(current); current = ((next) => (next ? ownerOf(next) : null))(tree.find((entry) => entry.id === current))) {
      if (current === caller.id) return true;
      seen.add(current);
    }
    return false;
  }
  /** Everything that reports to an agent, directly or through others: what a stop, a close, an archive or a detach of it reaches. Work handed to another owner is not below it any more. */
  const ownedBelow = (agent: Agent, tree = treeOf(agent.root_id)): Agent[] => tree.filter((entry) => entry.id !== agent.id && owns(agent, entry, tree));
  /** Puts an agent under the agent it reports to in the lineage of creation too; everything it created follows it. */
  function rehome(agent: Agent): void {
    const owner = byId(ownerOf(agent) ?? "");
    if (!owner || agent.parent_id === owner.id) return;
    const shift = owner.depth + 1 - agent.depth, from = agent.parent_id;
    for (const entry of descendants(agent)) db.prepare("UPDATE agents SET depth = ? WHERE id = ?").run(entry.depth + shift, entry.id);
    db.prepare("UPDATE agents SET parent_id = ?, depth = ? WHERE id = ?").run(owner.id, agent.depth + shift, agent.id);
    const moved = byId(agent.id)!;
    delete moved.extra.ownerId; moved.extra.labels["jc.parent"] = owner.id;
    save(moved);
    audit(db, now(), "server", "agent.rehome", { category: "agent", agentId: agent.id, fromParentId: from, toParentId: owner.id });
  }
  /**
   * Before an agent leaves its tree (archive, detach): an agent that was handed across the boundary of what leaves is
   * put under the agent that owns it, so nothing that was handed to another owner goes with its former parent and
   * nothing that was received stays behind.
   */
  function settleLineage(leaving: Agent): void {
    const tree = treeOf(leaving.root_id), going = new Set([leaving.id, ...ownedBelow(leaving, tree).map((entry) => entry.id)]);
    for (const entry of tree) {
      if (entry.id === leaving.id || !entry.parent_id || ownerOf(entry) === entry.parent_id) continue;
      if (going.has(entry.parent_id) !== going.has(entry.id)) rehome(byId(entry.id)!);
    }
  }
  const seq = new Map<string, number>();
  function save(agent: Agent, quiet = false): Agent {
    agent.updated_ms = now();
    db.prepare("UPDATE agents SET title = ?, state = ?, waiting_reason = ?, attention = ?, json = ?, updated_ms = ?, finished_ms = ?, archived_ms = ? WHERE id = ?")
      .run(agent.title, agent.state, agent.waiting_reason, agent.attention, JSON.stringify(agent.extra), agent.updated_ms, agent.finished_ms, agent.archived_ms, agent.id);
    if (!quiet) announce(agent);
    return agent;
  }
  function announce(agent: Agent): void {
    const root = agent.depth === 0 ? agent : byId(agent.root_id);
    if (!root) return;
    const next = (seq.get(root.id) ?? 0) + 1;
    seq.set(root.id, next);
    deps.broadcast("jagentchill.projects.read", "jagentchill.agent.updated", `agent:${root.id}`, { rootId: root.id, seq: next, agent: view(agent) }, (connection) => sessions().canRead(root.session_key, connection));
  }
  /** The record of a chat session's own agent: it exists as soon as anything asks for it. */
  function rootFor(session: SessionRecord): Agent {
    const found = bySession(session.sessionKey);
    if (found) return found;
    const id = newAgentId(now());
    const origin = session.origin === "device" ? "user" : session.origin;
    db.prepare("INSERT INTO agents (id, session_key, parent_id, root_id, depth, origin, title, state, json, created_ms, updated_ms) VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?)")
      .run(id, session.sessionKey, id, origin, (session.title ?? "Agent").slice(0, 60), sessions().isRunning(session.sessionKey) ? "running" : "idle", JSON.stringify({ labels: {} } satisfies Extra), session.created_ms, now());
    return byId(id)!;
  }
  /** What an agent is called towards other agents: its role in a team, else its title (a chat session's own agent has its session's). */
  const nameOf = (agent: Agent): string => (agent.depth === 0 ? agent.extra.roleLabel ?? sessions().session(agent.session_key)?.title ?? agent.title : agent.title);
  const agentOfSession = (key: string): Agent | undefined => { const session = sessions().session(key); return session ? rootFor(session) : bySession(key); };

  // — Usage and budgets —
  function usageOf(keys: string[]): AgentUsage {
    if (!keys.length) return { inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true, turns: 0 };
    const marks = keys.map(() => "?").join(",");
    const row = db.prepare(
      `SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(cached_input_tokens, 0) + COALESCE(cache_write_tokens, 0)), 0) AS input, COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output,
              COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS cost, COUNT(*) AS turns, COALESCE(SUM(CASE WHEN cost_usd IS NULL AND open = 0 THEN 1 ELSE 0 END), 0) AS unknown
         FROM usage_records WHERE session_key IN (${marks})`,
    ).get(...keys) as { input: number; output: number; cost: number; turns: number; unknown: number };
    return { inputTokens: row.input, outputTokens: row.output, costUsd: money(row.cost), costKnown: row.unknown === 0, turns: row.turns };
  }
  /**
   * Everybody whose spending is an agent's spending: itself, the agents below it, and the agents its budget pays for
   * (`fundedBy`: a receiver a hand-off of its created beside it) with whatever is below those.
   */
  function charged(agent: Agent, tree: Agent[]): Agent[] {
    const all = new Map<string, Agent>([[agent.id, agent]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const entry of tree) {
        if (all.has(entry.id) || !((entry.parent_id && all.has(entry.parent_id)) || (entry.extra.fundedBy && all.has(entry.extra.fundedBy)))) continue;
        all.set(entry.id, entry); grew = true;
      }
    }
    return [...all.values()];
  }
  const spentBy = (agent: Agent, tree = treeOf(agent.root_id)) => usageOf(charged(agent, tree).map((entry) => entry.session_key)).costUsd;
  /** Who pays for an agent besides itself: the sender of the hand-off that created it, else the agent that created it. */
  const payerOf = (agent: Agent, tree: Agent[]): Agent | undefined => (agent.extra.fundedBy ? tree.find((entry) => entry.id === agent.extra.fundedBy) : undefined) ?? (agent.parent_id ? tree.find((entry) => entry.id === agent.parent_id) : undefined);
  /** Every agent whose limit binds `agent`: itself, then upwards along who created it AND who pays for it. */
  function payers(agent: Agent, tree: Agent[]): Agent[] {
    const seen = new Map<string, Agent>();
    for (let queue: Agent[] = [agent], current = queue.shift(); current; current = queue.shift()) {
      if (seen.has(current.id)) continue;
      seen.set(current.id, current);
      for (const id of [current.extra.fundedBy, current.parent_id]) { const above = id ? tree.find((entry) => entry.id === id) : undefined; if (above) queue.push(above); }
    }
    return [...seen.values()];
  }
  /**
   * What sub-budgets still hold back from an agent: those of its living children that it pays for itself, and those of
   * the agents its budget pays for. (A child that another of its descendants pays for sits inside that one's sub-budget.)
   */
  const reservedBy = (agent: Agent, tree = treeOf(agent.root_id)) => money(tree
    .filter((entry) => (entry.extra.fundedBy ? entry.extra.fundedBy === agent.id || (entry.parent_id === agent.id && !charged(agent, tree).some((mine) => mine.id === entry.extra.fundedBy)) : entry.parent_id === agent.id))
    .filter((child) => child.id !== agent.id && child.extra.limitUsd !== undefined && child.state !== "closed" && !child.archived_ms)
    .reduce((total, child) => total + Math.max(0, child.extra.limitUsd! - spentBy(child, tree)), 0));
  /** The nearest agent, from `agent` upwards, that has a limit of its own, and what is left of it. */
  function remainingFor(agent: Agent, tree = treeOf(agent.root_id)): { holder: Agent; remainingUsd: number } | undefined {
    for (let current: Agent | undefined = agent; current; current = payerOf(current, tree)) {
      if (current.extra.limitUsd !== undefined) return { holder: current, remainingUsd: money(Math.max(0, current.extra.limitUsd - spentBy(current, tree) - (current.id === agent.id ? reservedBy(current, tree) : 0))) };
    }
    return undefined;
  }
  /** Refuses a turn or a tool call of an agent whose own limit, or that of any agent above it, is spent. */
  function assertBudget(sessionKey: string): void {
    const agent = bySession(sessionKey);
    if (!agent) return;
    const tree = treeOf(agent.root_id), root = tree.find((entry) => entry.id === agent.root_id);
    if (agent.depth > 0 && root) deps.rootBudget?.(root.session_key);
    for (const current of payers(agent, tree)) {
      const limit = current.extra.limitUsd;
      if (limit === undefined) continue;
      const spent = spentBy(current, tree);
      if (spent < limit) continue;
      if (root && root.extra.budgetTold !== limit) {
        root.extra.budgetTold = limit;
        save(root);
        sessions().notify(root.session_key, "jagentchill.chat.notice", { sessionKey: root.session_key, code: "tree-budget", message: `Budget reached — ${current.depth === 0 ? "this session and its sub-agents" : current.title} spent $${spent.toFixed(2)} of $${limit.toFixed(2)}`, ts_ms: now() });
      }
      throw new ProtocolError("BUDGET_EXCEEDED", `Budget reached — ${current.depth === 0 ? "the agent tree" : `agent "${current.title}"`} spent its limit of $${limit.toFixed(2)}. Stop and tell the user; an admin can raise the budget.`, { httpStatus: 402, details: { scope: "agent", agentId: current.id, limitUsd: limit, spentUsd: spent, remainingUsd: 0 } });
    }
  }

  function view(agent: Agent, tree?: Agent[]): AgentRecord {
    const session = sessions().session(agent.session_key), extra = agent.extra, all = tree ?? treeOf(agent.root_id);
    const spent = spentBy(agent, all);
    return {
      id: agent.id, sessionKey: agent.session_key, title: agent.depth === 0 ? (session?.title ?? agent.title).slice(0, 60) : agent.title, origin: agent.origin as AgentRecord["origin"], ...(agent.parent_id ? { parentId: agent.parent_id } : {}), ...(ownerOf(agent) ? { ownerAgentId: ownerOf(agent)! } : {}),
      rootId: agent.root_id, depth: agent.depth, labels: extra.labels,
      ...(extra.teamId ? { teamId: extra.teamId } : {}), ...(extra.roleId ? { roleId: extra.roleId } : {}), ...(extra.roleLabel ? { roleLabel: extra.roleLabel } : {}), ...(extra.tier ? { tier: extra.tier } : {}),
      ...(extra.canWrite !== undefined ? { canWrite: extra.canWrite } : {}), ...(extra.grantsWrite !== undefined ? { grantsWrite: extra.grantsWrite } : {}),
      ...(session?.ref ? { runtimeId: session.ref.runtimeId, providerId: session.ref.providerId, modelId: session.ref.modelId } : {}), modeId: session?.modeId ?? "edit", ...(session?.projectId ? { projectId: session.projectId } : {}),
      state: agent.state as AgentState, ...(agent.waiting_reason ? { waitingReason: agent.waiting_reason as AgentWaitingReason } : {}), attention: agent.attention as AgentRecord["attention"],
      lastMessagePreview: extra.preview ?? "", usage: usageOf([agent.session_key]),
      budget: { ...(extra.limitUsd !== undefined ? { limitUsd: extra.limitUsd } : {}), reservedUsd: reservedBy(agent, all), spentUsd: spent, exhausted: extra.limitUsd !== undefined && spent >= extra.limitUsd },
      ...(extra.result ? { result: extra.result } : {}), ...(extra.paused ? { deliveryPaused: extra.paused } : {}), ...(extra.turnStarted_ms ? { turnStarted_ms: extra.turnStarted_ms } : {}), ...(extra.detached_ms ? { detached_ms: extra.detached_ms } : {}), ...(extra.handoff ? { handoff: extra.handoff } : {}),
      ...(extra.handedBackTurn ? { handedBack: true } : {}), ...(extra.handbackWaiting ? { handbackWaiting: true } : {}), ...(extra.reviewer ? { reviewer: true } : {}), ...(agent.depth === 0 && extra.answering ? answeringOf(agent, all) : {}), created_ms: agent.created_ms, updated_ms: agent.updated_ms, ...(agent.finished_ms ? { finished_ms: agent.finished_ms } : {}), ...(agent.archived_ms ? { archived_ms: agent.archived_ms } : {}),
    };
  }
  /** Who leads a session's conversation, as devices read it; nothing when the agent it was given to is gone. */
  function answeringOf(root: Agent, tree: Agent[]): Pick<AgentRecord, "answering"> {
    const answering = root.extra.answering!, lead = tree.find((entry) => entry.id === answering.agentId), previous = answering.previousAgentId ? tree.find((entry) => entry.id === answering.previousAgentId) : undefined;
    if (!lead || lead.archived_ms || lead.state === "closed") return {};
    return { answering: { agentId: lead.id, title: nameOf(lead), sessionKey: lead.session_key, handoffId: answering.handoffId, since_ms: answering.since_ms, ...(previous ? { previousAgentId: previous.id, previousTitle: nameOf(previous) } : root.extra.roleLabel ? { previousTitle: root.extra.roleLabel } : {}) } };
  }
  /** A tree in depth-first order. */
  function ordered(rootId: string, includeArchived = false): Agent[] {
    const tree = treeOf(rootId), root = tree.find((entry) => entry.id === rootId), out: Agent[] = [];
    const walk = (agent: Agent) => { if (!includeArchived && agent.archived_ms && agent.depth > 0) return; out.push(agent); for (const child of childrenOf(agent, tree)) walk(child); };
    if (root) walk(root);
    return out;
  }

  // — Limits —
  const limits = (): AgentLimits => ({ ...DEFAULT_AGENT_LIMITS, ...(deps.config.get<Partial<AgentLimits>>("agents.limits") ?? {}) });

  // — Teams —
  const teamRow = (id: string) => db.prepare("SELECT json, pristine FROM agent_teams WHERE id = ?").get(id) as { json: string; pristine: number } | undefined;
  const team = (id: string | undefined): Team | undefined => { const row = id ? teamRow(id) : undefined; return row ? (JSON.parse(row.json) as Team) : undefined; };
  const teams = (): { team: Team; pristine: boolean }[] => (db.prepare("SELECT json, pristine FROM agent_teams ORDER BY id").all() as { json: string; pristine: number }[]).map((row) => ({ team: JSON.parse(row.json) as Team, pristine: row.pristine === 1 }));
  const summary = (entry: { team: Team; pristine: boolean }): TeamSummary => ({ id: entry.team.id, name: entry.team.name, description: entry.team.description, enabled: entry.team.enabled, rev: entry.team.rev, roleCount: entry.team.roles.length, template: entry.pristine && !!entry.team.templateId, ...(entry.team.templateId ? { templateId: entry.team.templateId } : {}) });
  const teamsEnabled = () => deps.config.get<boolean>("orc.teams.enabled") !== false;
  /** The team a tree works as. While a run is in progress it is the team as it was when the run started: an edit of the team never changes a run that is under way. */
  const teamOfTree = (root: Agent | undefined): Team | undefined => {
    const snapshot = root ? runs.snapshotOf(root.id) : undefined;
    if (snapshot) return snapshot;
    const found = team(root?.extra.teamId);
    return found?.enabled && teamsEnabled() ? found : undefined;
  };

  // — Loop guards (`Loop prevention`): counted since a person last wrote in the tree —
  type Guard = { sends: { at: number; from: string }[]; pairs: Map<string, number>; recent: Map<string, number>; turns: number };
  const guards = new Map<string, Guard>();
  const guardOf = (rootId: string): Guard => guards.get(rootId) ?? guards.set(rootId, { sends: [], pairs: new Map(), recent: new Map(), turns: 0 }).get(rootId)!;
  /**
   * The turn ceiling of a tree (guard 6): the host's, or the team's when that is lower. It also bounds trees on
   * plan-billed runtimes, where no cost is known and no budget can stop them. Refuses the turn the server is about to
   * start for an agent; a person's own message is never refused and starts the count again.
   */
  function assertActivity(agent: Agent): void {
    const root = agent.depth === 0 ? agent : byId(agent.root_id);
    if (!root) return;
    const cap = Math.min(limits().maxTurnsPerTree, teamOfTree(root)?.limits.maxRunTurns ?? Infinity);
    if (guardOf(root.id).turns < cap && !root.extra.paused) return;
    if (!root.extra.paused) {
      root.extra.paused = { limit: cap }; root.attention = "error";
      save(root);
      sessions().notify(root.session_key, "jagentchill.chat.notice", { sessionKey: root.session_key, code: "agent-activity-limit", message: `This session reached its activity limit (${cap} turns).`, ts_ms: now() });
      audit(db, now(), "server", "agent.delivery.paused", { rootId: root.id, limit: cap });
    }
    fail("AGENT_LOOP_DETECTED", `This session reached its activity limit (${root.extra.paused!.limit} turns of all its agents). Nothing more is started. Tell the user what is done and what is open; they can resume.`, { guard: "turns", limit: root.extra.paused!.limit });
  }
  /** A person wrote or resumed: the counters of the tree start again and what waited is delivered. */
  function resetGuards(root: Agent): void {
    guards.delete(root.id);
    if (!root.extra.paused) return;
    delete root.extra.paused;
    if (root.attention === "error" && root.state !== "failed") root.attention = "none";
    save(root);
    for (const row of db.prepare("SELECT DISTINCT n.armer_id FROM agent_notifications n JOIN agents a ON a.id = n.armer_id WHERE n.state = 'ready' AND a.root_id = ?").all(root.id) as { armer_id: string }[]) scheduleFlush(row.armer_id, 0);
  }
  /** Messages the server itself is delivering right now: the turn they start is no person's prompt. */
  const delivering = new Map<string, number>();
  const serverDeliveries = {
    has: (key: string) => (delivering.get(key) ?? 0) > 0,
    add(key: string): void { delivering.set(key, (delivering.get(key) ?? 0) + 1); },
    delete(key: string): void { const left = (delivering.get(key) ?? 1) - 1; if (left > 0) delivering.set(key, left); else delivering.delete(key); },
  };
  /** Runs a delivery the server itself makes to a session (a status message, a result, a hand-off): the turn it starts is nobody's prompt. */
  async function asServer<T>(sessionKey: string, run: () => Promise<T>): Promise<T> {
    serverDeliveries.add(sessionKey);
    try { return await run(); } finally { serverDeliveries.delete(sessionKey); }
  }
  function guardSend(sender: Agent, target: Agent, prompt: string): number {
    const refuse = (guard: string, message: string, details: Json = {}) => fail("AGENT_LOOP_DETECTED", message, { guard, ...details });
    if (sender.id === target.id) refuse("cycle", "An agent cannot send a message to itself. Do the work in this turn, or create another agent with jc_agent_create.");
    const guard = guardOf(sender.root_id), stamp = now();
    guard.sends = guard.sends.filter((entry) => stamp - entry.at < 60_000);
    const mine = guard.sends.filter((entry) => entry.from === sender.id);
    if (mine.length >= AGENT_LOOP_LIMITS.sendsPerAgentPerMinute || guard.sends.length >= AGENT_LOOP_LIMITS.sendsPerTreePerMinute) {
      refuse("rate", "Too many agent-to-agent messages in the last minute. Wait for the agents to answer instead of sending more.", { retryAfter_ms: Math.max(1, 60_000 - (stamp - (mine[0] ?? guard.sends[0]).at)) });
    }
    const digest = createHash("sha256").update(`${sender.id}\n${target.id}\n${prompt.replace(/\s+/g, " ").trim().toLowerCase()}`).digest("hex");
    for (const [key, at] of guard.recent) if (stamp - at >= AGENT_LOOP_LIMITS.duplicateWindow_ms) guard.recent.delete(key);
    if (guard.recent.has(digest)) refuse("duplicate", "The same message was sent to this agent less than two minutes ago. Wait for its answer; use jc_agent_status to see what it is doing.");
    const hop = (sender.extra.hop ?? 0) + 1;
    if (hop > AGENT_LOOP_LIMITS.hops) refuse("hops", `This chain of agent-to-agent messages is ${AGENT_LOOP_LIMITS.hops} deliveries long. Stop and report to the user what is still open.`, { limit: AGENT_LOOP_LIMITS.hops });
    // A round trip of a pair is one message each way; the third one since a person last wrote is refused.
    const pair = [sender.id, target.id].sort().join("|"), direction = `${pair}>${target.id}`;
    const there = guard.pairs.get(`${pair}>${sender.id}`) ?? 0, back = guard.pairs.get(direction) ?? 0;
    if (Math.min(there, back) >= AGENT_LOOP_LIMITS.roundTripsPerPair) refuse("ping_pong", `"${sender.title}" and "${target.title}" have answered each other ${AGENT_LOOP_LIMITS.roundTripsPerPair} times without the user. Stop and report to the user what is still open.`, { limit: AGENT_LOOP_LIMITS.roundTripsPerPair });
    guard.pairs.set(direction, back + 1);
    guard.sends.push({ at: stamp, from: sender.id });
    guard.recent.set(digest, stamp);
    return hop;
  }

  // — Waiting and notifications —
  const waiters = new Map<string, Set<() => void>>();
  const blocking = new Map<string, number>();
  const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const usageTimers = new Set<ReturnType<typeof setTimeout>>();
  // (An agent that handed back is idle at once, but its result is put together when its turn has really ended: until then whoever waits for it still waits.)
  const settledState = (agent: Agent) => (agent.state === "idle" && !(agent.extra.handedBackTurn && sessions().isRunning(agent.session_key))) || agent.state === "failed" || agent.state === "closed" || !!agent.archived_ms;
  /** Arms the message an agent gets when another settles. `identity`: the armer may read only who the agent is (an agent above it) — the message then says that it settled, not what it did. */
  const arm = (armer: Agent, agent: Agent, grant: "full" | "identity" = "full") => db.prepare("INSERT OR IGNORE INTO agent_notifications (armer_id, agent_id, settle_key, json, state, ts_ms) VALUES (?, ?, '', ?, 'armed', ?)").run(armer.id, agent.id, grant === "identity" ? JSON.stringify({ grant }) : null, now());
  const armedFor = (armerId: string) => (db.prepare("SELECT agent_id FROM agent_notifications WHERE armer_id = ? AND state = 'armed'").all(armerId) as { agent_id: string }[]).map((row) => row.agent_id);
  function scheduleFlush(armerId: string, delay = deps.timings?.notifyBatchMs ?? 2000): void {
    if (flushTimers.has(armerId)) return;
    const timer = setTimeout(() => { flushTimers.delete(armerId); void flush(armerId); }, delay);
    timer.unref?.();
    flushTimers.set(armerId, timer);
  }
  /** Children that settled close together reach their caller as one message, one block each; a failed delivery is tried again. */
  async function flush(armerId: string): Promise<void> {
    const rows = db.prepare("SELECT id, json, attempts FROM agent_notifications WHERE armer_id = ? AND state = 'ready' ORDER BY id").all(armerId) as { id: number; json: string; attempts: number }[];
    const armer = byId(armerId);
    if (!rows.length) return;
    // A run that is paused since the host restarted keeps what waits for its agents until a person resumes it.
    if (armer && runs.pausedIn(armer.root_id)) return;
    const ids = rows.map((row) => row.id), marks = ids.map(() => "?").join(",");
    if (!armer || armer.archived_ms || armer.state === "closed") { db.prepare(`DELETE FROM agent_notifications WHERE id IN (${marks})`).run(...ids); return; }
    const notes = rows.map((row) => JSON.parse(row.json) as Notification);
    serverDeliveries.add(armer.session_key);
    armer.extra.hop = Math.max(armer.extra.hop ?? 0, ...notes.map((note) => note.hop ?? 0));
    save(armer, true);
    let delivered = false;
    // A tree at its turn ceiling keeps what waits for its agents; it is delivered when a person resumes.
    try { assertActivity(armer); } catch { return; }
    // What a tainted agent reports is content from outside for whoever reads it: the mark goes with the message.
    for (const note of notes) if (note.untrusted) carry(byId(note.agentId), armer);
    try { assertBudget(armer.session_key); delivered = await deliver(armer.session_key, notificationText(notes)); } catch { delivered = false; }
    serverDeliveries.delete(armer.session_key);
    if (delivered) { db.prepare(`UPDATE agent_notifications SET state = 'delivered', ts_ms = ? WHERE id IN (${marks})`).run(now(), ...ids); return; }
    const attempts = Math.max(...rows.map((row) => row.attempts)) + 1, retry = deps.timings?.retryMs ?? [2000, 8000, 30_000];
    if (attempts > retry.length) {
      db.prepare(`UPDATE agent_notifications SET state = 'failed', attempts = ? WHERE id IN (${marks})`).run(attempts, ...ids);
      const root = byId(armer.root_id);
      if (root) sessions().notify(root.session_key, "jagentchill.chat.notice", { sessionKey: root.session_key, code: "agent-result-undelivered", message: `A sub-agent result was not delivered to ${armer.title}`, ts_ms: now() });
      return;
    }
    db.prepare(`UPDATE agent_notifications SET attempts = ? WHERE id IN (${marks})`).run(attempts, ...ids);
    scheduleFlush(armerId, retry[attempts - 1]);
  }
  const wake = (agentId: string) => { for (const resolve of waiters.get(agentId) ?? []) resolve(); waiters.delete(agentId); };
  /** An agent settled: whoever waits in a tool call returns, whoever armed a notification gets its message. */
  function settled(agent: Agent, outcome: AgentOutcome, settleKey: string, later = false): void {
    wake(agent.id);
    const armed = db.prepare("SELECT id, armer_id, json FROM agent_notifications WHERE agent_id = ? AND state = 'armed'").all(agent.id) as { id: number; armer_id: string; json: string | null }[];
    for (const row of armed) {
      // The read grant the notification was armed with still holds when it fires: an agent above its armer gives no summary, artefacts, hand-back or cost.
      const result = row.json && (JSON.parse(row.json) as { grant?: string }).grant === "identity" ? undefined : agent.extra.result;
      const note: Notification = {
        kind: "agent_notification", agentId: agent.id, title: agent.title, outcome, summary: (result?.summary ?? "").slice(0, 2000), ...(result?.error ? { reason: result.error.slice(0, 300) } : {}),
        ...(result?.handback ? { handbackId: result.handback.handbackId } : {}), artefacts: result?.artefacts ?? [], usage: { costUsd: result?.usage.costUsd ?? 0 }, hop: (agent.extra.hop ?? 0) + 1, ...(result && tainted(agent) ? { untrusted: true as const } : {}),
      };
      // One message per settle event: the same turn reported twice changes nothing.
      const done = db.prepare("UPDATE OR IGNORE agent_notifications SET state = 'ready', settle_key = ?, json = ?, ts_ms = ? WHERE id = ?").run(settleKey, JSON.stringify(note), now(), row.id);
      if (!done.changes) db.prepare("DELETE FROM agent_notifications WHERE id = ?").run(row.id);
      else if (!later) scheduleFlush(row.armer_id);
    }
  }
  /** An agent that waited for children none of which will report any more is idle again. */
  function recheckWaiting(agentId: string | null): void {
    const agent = agentId ? byId(agentId) : undefined;
    if (!agent || agent.state !== "waiting" || agent.waiting_reason !== "children") return;
    if (armedFor(agent.id).some((id) => { const child = byId(id); return !!child && !settledState(child); })) return;
    agent.state = "idle"; agent.waiting_reason = null;
    save(agent);
    if (agent.extra.result) settled(agent, agent.extra.result.outcome, `${agent.extra.turnStarted_ms ?? agent.updated_ms}`);
  }
  const disarm = (agentIds: string[]) => { for (const id of agentIds) db.prepare("DELETE FROM agent_notifications WHERE (agent_id = ? OR armer_id = ?) AND state IN ('armed', 'ready')").run(id, id); };
  async function waitFor(agents: Agent[], until: "all" | "any", timeout: number): Promise<boolean> {
    const pending = () => agents.map((agent) => byId(agent.id)!).filter((agent) => !settledState(agent));
    const done = () => (until === "any" ? pending().length < agents.length : pending().length === 0);
    const deadline = Date.now() + timeout;
    while (!done()) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        for (const agent of pending()) (waiters.get(agent.id) ?? waiters.set(agent.id, new Set()).get(agent.id)!).add(() => { clearTimeout(timer); resolve(); });
      });
    }
    return true;
  }

  // — Taint travels with content (`agent-editing-tools.Untrusted content handling`) —
  /** The untrusted text kept for a session, as the tools service — which keeps it — gives it. */
  const retained = (sessionKey: string): string[] => { try { return deps.taint?.retained(sessionKey) ?? []; } catch { return []; } };
  // (While the host starts, the tools service — which holds the mark — is not there yet: an agent a restart failed reports nothing it read.)
  const tainted = (agent: Agent | undefined): boolean => { try { return !!agent && !!deps.taint?.is(agent.session_key); } catch { return false; } };
  /**
   * Content of `from` reaches `to` (a first message, a message, a result, a hand-off package): when `from` had read
   * content from outside, `to` has now read it too — it is tainted from here on, with the same text kept for the
   * copied-prompt rule. Returns whether the mark travelled. Nothing inside the project asks more for it.
   */
  function carry(from: Agent | undefined, to: Agent | undefined): boolean {
    if (!from || !to || from.id === to.id || !tainted(from)) return false;
    deps.taint!.mark(to.session_key, `agent:${from.id}`, retained(from.session_key));
    return true;
  }

  // — Turns —
  /** Agents whose running turn the server itself is taking back: its end is not an outcome of their work. */
  const unreported = new Set<string>();
  async function takeBack(agent: Agent, silentAnyway = false): Promise<boolean> {
    if (!sessions().isRunning(agent.session_key)) return true;
    unreported.add(agent.id);
    const stopped = (await Promise.resolve(sessions().abort(agent.session_key)).catch(() => false)) !== false;
    // `silentAnyway`: the turn is still the server's to take back (it is tried again), so its end — whenever it comes — is nobody's outcome either.
    if (!stopped && !silentAnyway) unreported.delete(agent.id);
    return stopped;
  }
  function turnStarted(sessionKey: string): void {
    const agent = agentOfSession(sessionKey);
    if (!agent || agent.state === "closed") return;
    // A new turn: whatever was taken back before it is over and done with.
    unreported.delete(agent.id);
    delete agent.extra.handedBackTurn;
    if (!serverDeliveries.has(sessionKey)) {
      // A person wrote: every loop counter of the tree starts again.
      const root = agent.depth === 0 ? agent : byId(agent.root_id);
      if (root) resetGuards(root);
      agent.extra.hop = 0;
      if (agent.depth === 0) delete agent.extra.paused;
    }
    guardOf(agent.root_id).turns += 1;
    agent.state = "running"; agent.waiting_reason = null; agent.attention = "none"; agent.finished_ms = null;
    agent.extra.turnStarted_ms = now();
    save(agent);
  }
  async function lastMessage(sessionKey: string): Promise<string> {
    try {
      return textOf([...sessions().history(sessionKey, 6)].reverse().find((message) => message.role === "assistant")?.content);
    } catch { return ""; }
  }
  const proposalsSince = (sessionKey: string, since: number): AgentArtefact[] =>
    (db.prepare("SELECT proposal_id, title FROM tool_proposals WHERE session_key = ? AND submitted_ms IS NOT NULL AND submitted_ms >= ? ORDER BY submitted_ms").all(sessionKey, since) as { proposal_id: string; title: string }[])
      .map((row) => ({ kind: "proposal" as const, id: row.proposal_id, title: row.title || "Proposal" }));
  const handbackOf = (agentId: string, since: number): AgentHandback | undefined => {
    const row = db.prepare("SELECT json FROM agent_handbacks WHERE agent_id = ? AND created_ms >= ? ORDER BY created_ms DESC LIMIT 1").get(agentId, since) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as AgentHandback) : undefined;
  };
  function turnEnded(sessionKey: string, state: "final" | "error" | "aborted", errorMessage?: string): Promise<void> {
    const agent = bySession(sessionKey);
    if (!agent) return Promise.resolve();
    // A turn the server stopped because the agent had handed back is a turn that completed: the hand-back is its result.
    const outcome: AgentOutcome = agent.state === "closed" ? "closed" : state === "final" || (state === "aborted" && !!agent.extra.handedBackTurn) ? "completed" : state === "error" ? "failed" : "cancelled";
    const since = agent.extra.turnStarted_ms ?? agent.updated_ms, runKey = `${since}`;
    // A Director whose report ends its run waits for nobody any more: the run is closed before its own state is decided.
    runs.supervisorTurnEnded(agent, outcome);
    const waitsForChildren = outcome === "completed" && armedFor(agent.id).some((id) => { const child = byId(id); return !!child && !settledState(child); });
    if (agent.state !== "closed") {
      agent.state = outcome === "failed" ? "failed" : waitsForChildren ? "waiting" : "idle";
      agent.waiting_reason = waitsForChildren ? "children" : null;
      agent.attention = outcome === "failed" ? "error" : "none";
    }
    agent.finished_ms = now();
    save(agent);
    if (agent.extra.pendingModel) startModelChange(agent.id);
    // A turn the server took back (a Resume that did not go through): nobody is told that it ended, and whoever waits for the agent keeps waiting.
    if (unreported.delete(agent.id)) return Promise.resolve();
    // Only an agent somebody waits for has a result to put together; an ordinary chat turn ends here.
    const awaited = !!agent.parent_id || waiters.has(agent.id) || !!db.prepare("SELECT 1 FROM agent_notifications WHERE agent_id = ? AND state = 'armed'").get(agent.id);
    if (!awaited) return Promise.resolve();
    // The text and the artefacts of the turn are read after the fact; the state above never waits for them.
    return (async () => {
      const text = await lastMessage(sessionKey);
      const current = byId(agent.id);
      if (!current) return;
      const handback = handbackOf(current.id, since), proposals = proposalsSince(sessionKey, since);
      const artefacts = [...proposals, ...(handback?.artefacts ?? []).filter((entry) => !proposals.some((proposal) => proposal.id === entry.id))];
      current.extra.result = {
        outcome, summary: (handback?.whatChangedOrInspected ?? text).slice(0, 2000), ...(handback ? { handback: { ...handback, artefacts } } : {}), artefacts, lastMessage: text.slice(0, 12_000),
        usage: usageOf([sessionKey]), ended_ms: now(), ...(errorMessage ? { error: errorMessage.slice(0, 500) } : {}),
      };
      if (text) current.extra.preview = text.replace(/\s+/g, " ").slice(0, 280);
      save(current);
      // An agent that still waits for its own children has not finished its work: its caller hears of it when it has.
      if (current.state !== "waiting") settled(current, outcome, runKey);
      runs.memberSettled(current, outcome);
      // The turn's usage is written after its end: the record is announced once more with the numbers in it.
      const later = setTimeout(() => {
        usageTimers.delete(later);
        const fresh = byId(agent.id);
        if (!fresh) return;
        if (fresh.extra.result && fresh.extra.result.ended_ms === current.extra.result?.ended_ms) fresh.extra.result.usage = usageOf([sessionKey]);
        save(fresh);
      }, deps.timings?.usageSettleMs ?? 2500);
      later.unref?.();
      usageTimers.add(later);
    })().catch((err) => console.error(`[agents] settle failed: ${err instanceof Error ? err.message : err}`));
  }

  // — Creating and calling agents —
  const MODE_ORDER: readonly ProductMode[] = ["ask", "plan", "edit", "auto"];
  function checkLabels(labels: Record<string, string> | undefined): Record<string, string> {
    const entries = Object.entries(labels ?? {});
    if (entries.length > 16) fail("INVALID_PARAMS", "An agent carries at most 16 labels.", { field: "labels" });
    for (const [key, value] of entries) {
      if (key.startsWith("jc.")) fail("INVALID_PARAMS", `Labels starting with "jc." are written by the server only; remove "${key}".`, { field: `labels.${key}` });
      if (!LABEL_KEY.test(key) || value.length > 120) fail("INVALID_PARAMS", `The label "${key}" is not valid: a key is lower-case letters, digits, ".", "_" or "-" (1–40), a value at most 120 characters.`, { field: `labels.${key}` });
    }
    return labels ?? {};
  }
  async function create(session: SessionRecord, input: CreateInput): Promise<Json> {
    const caller = rootFor(session);
    if (input.idempotencyKey) {
      const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const stored = db.prepare("SELECT hash, agent_id, ts_ms FROM agent_idempotency WHERE owner_id = ? AND key = ?").get(caller.id, input.idempotencyKey) as { hash: string; agent_id: string; ts_ms: number } | undefined;
      if (stored && now() - stored.ts_ms < 86_400_000) {
        if (stored.hash !== hash) fail("IDEMPOTENCY_CONFLICT", "This idempotencyKey was already used with other parameters. Use a new key for a different agent.", { field: "idempotencyKey" });
        const existing = byId(stored.agent_id);
        if (existing) return { agentId: existing.id, title: existing.title, state: existing.state, waitArmed: armedFor(caller.id).includes(existing.id), replayed: true };
      }
    }
    if (caller.archived_ms) fail("AGENT_ARCHIVED", "This agent is archived and cannot create agents.");
    if (!input.ceilingOf) turnOver(caller);
    // Inside a team run members are staffed through the run, so its shape and its record stay true.
    if (!input.via) runs.refuseOutsideRun(caller);
    const labels = checkLabels(input.labels);
    const tree = treeOf(caller.root_id), root = tree.find((entry) => entry.id === caller.root_id)!, cap = limits();
    const crew = teamOfTree(root);
    // The mode ceiling: no agent gives another more than it has itself — and where it creates for somebody else (a hand-off that creates its receiver), no more than that agent has.
    const bound = input.ceilingOf ? byId(input.ceilingOf) : undefined, boundSession = bound ? sessions().session(bound.session_key) : undefined;
    if (input.ceilingOf && (!bound || !boundSession)) fail("AGENT_NOT_FOUND", "The agent this one is created for no longer exists.", {});
    const tops = [session.modeId as ProductMode, ...(boundSession ? [boundSession.modeId as ProductMode] : [])], topMode = tops.reduce((low, mode) => (MODE_ORDER.indexOf(mode) < MODE_ORDER.indexOf(low) ? mode : low));
    if (input.mode && MODE_ORDER.indexOf(input.mode) > MODE_ORDER.indexOf(topMode)) fail("INVALID_PARAMS", `An agent cannot be given more than you have: you are in ${topMode} mode, so the most a new agent can get is ${topMode}.`, { field: "mode", maxMode: topMode });
    if (bound?.extra.tier === "peer") fail("TEAM_ROLE_DENIED", `The ${bound.extra.roleLabel ?? "peer"} role cannot create agents, and a hand-off does not change that. Hand off to an agent that exists, or return your work with jc_agent_handback.`, { tier: "peer" });
    if (caller.extra.tier === "peer") fail("TEAM_ROLE_DENIED", `The ${caller.extra.roleLabel ?? "peer"} role cannot create agents. Return your work, or what you need from another role, with jc_agent_handback.`, { tier: "peer" });
    // The role: a role of the tree's team, or — without a team — an ORC role that only chooses the model.
    let role: TeamRole | undefined, orcRole: string | undefined;
    if (input.via?.reviewer) {
      // The reviewer of a result holds no role of the team: its model comes from the routing role the approval policy names.
      if (!ORC_BUILTIN_ROLES.some((entry) => entry.id === input.role && entry.capability === "llm")) fail("INVALID_PARAMS", `"${input.role}" is not a role of this host that a reviewer can run on.`, { field: "reviewer.role" });
      orcRole = input.role;
    } else if (crew) {
      const open = crew.roles.filter((entry) => entry.enabled && entry.tier !== "supervisor" && (caller.extra.tier === "lead" ? entry.tier === "peer" : true));
      role = input.via?.supervisor ? crew.roles.find((entry) => entry.enabled && entry.tier === "supervisor") : open.find((entry) => entry.roleId === input.role);
      if (!role) fail("TEAM_ROLE_DENIED", `${input.role ? `"${input.role}" is not a role you can staff` : "Name the role of the new agent"} in the team "${crew.name}". Roles: ${open.map((entry) => `${entry.roleId} (${entry.label})`).join(", ")}.`, { roles: open.map((entry) => entry.roleId) });
      orcRole = role!.orcRole;
    } else if (input.role) {
      if (!ORC_BUILTIN_ROLES.some((entry) => entry.id === input.role && entry.capability === "llm")) fail("INVALID_PARAMS", `"${input.role}" is not a role of this host. Roles: ${ORC_BUILTIN_ROLES.filter((entry) => entry.capability === "llm").map((entry) => entry.id).join(", ")}.`, { field: "role" });
      orcRole = input.role;
    }
    // Limits of the tree, before anything is created.
    const live = (entry: Agent) => ACTIVE.includes(entry.state) && !entry.archived_ms;
    if (caller.depth + 1 > cap.maxDepth) fail("AGENT_LIMIT_DEPTH", `Agents can be nested ${cap.maxDepth} levels deep and you are at level ${caller.depth}. Do this part yourself or hand it back.`, { limit: cap.maxDepth, current: caller.depth });
    const kids = childrenOf(caller, tree).filter(live).length;
    if (kids >= cap.maxConcurrentChildren) fail("AGENT_LIMIT_CHILDREN", `${kids} of your agents are still working (limit ${cap.maxConcurrentChildren}). Wait for one with jc_agent_wait, or cancel one.`, { limit: cap.maxConcurrentChildren, current: kids });
    const busy = tree.filter(live).length;
    if (busy >= cap.maxConcurrentAgentsPerTree) fail("AGENT_LIMIT_CONCURRENT", `${busy} agents of this session are working (limit ${cap.maxConcurrentAgentsPerTree}). Wait for one to finish.`, { limit: cap.maxConcurrentAgentsPerTree, current: busy });
    // A run starts its count at zero: the members of earlier runs, long disposed of, are not this brief's agents. Outside a run the agents that belong to no run are counted.
    const scope = input.via?.runId;
    // The run's Director is not one of the agents the limit counts (`Tree limits`: "the Supervisor excluded").
    const total = tree.filter((entry) => entry.depth > 0 && entry.extra.runId === scope && !(scope && entry.extra.tier === "supervisor")).length, allowed = cap.maxAgentsPerTree + (root.extra.extraFor === scope ? root.extra.extraTotal ?? 0 : 0);
    if (total >= allowed) {
      sessions().notify(root.session_key, "jagentchill.chat.notice", { sessionKey: root.session_key, code: "agent-limit-total", message: `This session reached its limit of ${allowed} agents`, ts_ms: now() });
      fail("AGENT_LIMIT_TOTAL", `This session already created ${total} agents (limit ${allowed}). Finish with the agents you have; the user can allow more.`, { limit: allowed, current: total });
    }
    // A run counts the assignments of its own brief (`runs.createPeer`); a team without a run counts the peers that belong to no run.
    if (crew && role && role.tier === "peer" && !input.via) {
      const peers = childrenOf(caller, tree).filter((entry) => entry.extra.tier === "peer" && !entry.extra.runId);
      const active = peers.filter(live).length;
      if (active >= crew.limits.maxConcurrentPeersPerLead) fail("TEAM_LIMIT_CONCURRENT_PEERS", `${active} peers are already working. Wait for a hand-back or cancel one.`, { limit: crew.limits.maxConcurrentPeersPerLead, active });
      const ever = tree.filter((entry) => entry.extra.tier === "peer" && !entry.extra.runId).length;
      if (ever >= crew.limits.maxAssignmentsPerBrief) fail("TEAM_LIMIT_ASSIGNMENTS", `This task already used its ${crew.limits.maxAssignmentsPerBrief} assignments. Integrate what you have and report to the user.`, { limit: crew.limits.maxAssignmentsPerBrief, current: ever });
    }
    const projectId = input.projectId ?? session.projectId;
    if (input.grantsWrite) {
      if (input.via?.reviewer) fail("TEAM_ROLE_DENIED", "A reviewer never holds the write assignment.", {});
      if (crew && !role!.contract.canWrite) fail("TEAM_ROLE_DENIED", `The ${role!.label} role does not edit the project, so it cannot be given the write assignment. Roles that write: ${crew.roles.filter((entry) => entry.enabled && entry.contract.canWrite).map((entry) => entry.roleId).join(", ") || "none"}.`, { roleId: role!.roleId });
      const holder = tree.find((entry) => entry.extra.grantsWrite && live(entry) && sessions().session(entry.session_key)?.projectId === projectId);
      if (crew?.writerPolicy === "lead_assigns" && holder) fail("WRITER_HELD", `"${holder.title}" holds the write assignment on this project. Wait for its hand-back (jc_agent_wait), then create the next writer.`, { holderAgentId: holder.id, holderTitle: holder.title, since_ms: holder.created_ms });
    }
    assertBudget(session.sessionKey);
    assertActivity(caller);
    // Created for an agent with a budget of its own: the new agent cannot spend more than that agent has left.
    const funded = !!bound && bound.extra.limitUsd !== undefined && charged(caller, tree).some((entry) => entry.id === bound.id);
    if (bound?.extra.limitUsd !== undefined) {
      const mine = remainingFor(bound, tree)!.remainingUsd;
      if (mine <= 0) fail("BUDGET_EXCEEDED", "Your budget is spent, so no agent can be created for your work.", { remainingUsd: 0 });
      // The money is the sender's own sub-budget — already held back from the agent it reports to — so that agent's allowance is asked only when the sender is not paid by it.
      input = { ...input, budgetUsd: Math.min(input.budgetUsd ?? mine, mine, ...(funded ? [] : [remainingFor(caller, tree)?.remainingUsd ?? mine])) };
    }
    if (input.budgetUsd !== undefined && !funded) {
      const left = remainingFor(caller, tree);
      if (left && input.budgetUsd > left.remainingUsd) fail("BUDGET_EXCEEDED", `A sub-budget of $${input.budgetUsd.toFixed(2)} is more than the $${left.remainingUsd.toFixed(2)} you have left. Give a smaller budgetUsd or none.`, { remainingUsd: left.remainingUsd });
    }
    let ref: ModelRef | undefined;
    if (input.model) {
      const slash = input.model.indexOf("/");
      if (slash < 1 || !session.ref) fail("INVALID_PARAMS", 'model is "<provider>/<model>", as jc_agent_catalog lists it.', { field: "model" });
      ref = { runtimeId: input.runtime ?? session.ref!.runtimeId, providerId: input.model.slice(0, slash), modelId: input.model.slice(slash + 1) };
    }
    if (input.via?.profileId && orcRole) {
      const profile = sessions().routeOf(session.sessionKey, orcRole).find((entry) => entry.profileId === input.via!.profileId);
      if (!profile) fail("INVALID_PARAMS", `"${input.via.profileId}" is not a usable profile of the role ${orcRole}. An admin sets the reviewer under Settings → Agents → Teams.`, { field: "reviewer.profileId" });
      ref = profile!.ref;
    }
    const child = await sessions().spawn(session.sessionKey, { title: input.title, ...(ref ? { ref } : orcRole ? { role: orcRole } : {}), ...(input.mode ? { modeId: input.mode } : bound ? { modeId: topMode } : {}), ...(input.projectId ? { projectId: input.projectId } : {}), ...(boundSession && !boundSession.unattended ? { unattendedCeiling: false } : {}) });
    const id = newAgentId(now());
    const extra: Extra = {
      labels: {
        ...labels, "jc.origin": crew ? "team" : "agent", "jc.parent": caller.id, "jc.root": root.id, ...(child.projectId ? { "jc.project": child.projectId } : {}),
        ...(crew && role ? { "jc.team.id": crew.id, "jc.team.role": role.roleId, "jc.team.tier": role.tier } : {}),
      },
      ...(input.via?.reviewer ? { ...(crew ? { teamId: crew.id } : {}), roleId: orcRole, roleLabel: "Reviewer", canWrite: false, reviewer: true, ...(input.via.reviewOf ? { reviewOf: input.via.reviewOf } : {}) } : crew ? { teamId: crew.id, roleId: role!.roleId, roleLabel: role!.label, tier: role!.tier, canWrite: role!.contract.canWrite } : orcRole ? { roleId: orcRole, roleLabel: ORC_BUILTIN_ROLES.find((entry) => entry.id === orcRole)?.label } : {}),
      ...(input.grantsWrite !== undefined ? { grantsWrite: input.grantsWrite } : {}), ...(input.budgetUsd !== undefined ? { limitUsd: input.budgetUsd } : {}), ...(bound ? { fundedBy: bound.id } : {}), hop: (caller.extra.hop ?? 0) + 1,
      ...(input.via ? { ...(input.via.runId ? { runId: input.via.runId } : {}), ...(input.via.assignmentId ? { assignmentId: input.via.assignmentId } : {}) } : {}),
    };
    db.prepare("INSERT INTO agents (id, session_key, parent_id, root_id, depth, origin, title, state, json, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)")
      .run(id, child.sessionKey, caller.id, root.id, caller.depth + 1, crew ? "team" : "agent", input.title, JSON.stringify(extra), now(), now());
    if (input.idempotencyKey) db.prepare("INSERT OR REPLACE INTO agent_idempotency (owner_id, key, hash, agent_id, ts_ms) VALUES (?, ?, ?, ?, ?)").run(caller.id, input.idempotencyKey, createHash("sha256").update(JSON.stringify(input)).digest("hex"), id, now());
    audit(db, now(), `agent:${session.sessionKey}`, "agent.create", { agentId: id, parentId: caller.id, rootId: root.id, title: input.title, ...(role ? { teamId: crew!.id, roleId: role.roleId } : {}), ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}) });
    const agent = byId(id)!;
    // Its first message is written by its creator (for a hand-off: by the sender): what that agent had read from outside, this one reads now.
    carry(bound ?? caller, agent);
    announce(agent);
    const mode = input.wait ?? "notify";
    if (mode !== "none") arm(caller, agent);
    const writes = input.via?.reviewer ? false : crew ? role!.contract.canWrite && (crew.writerPolicy === "queue" || input.grantsWrite === true) : true;
    const text = input.via?.supervisor || input.via?.reviewer ? withTurnContext(deps.turnContext?.(child), input.prompt) : withTurnContext(deps.turnContext?.(child), childPrompt({ title: input.title, parentTitle: nameOf(caller), prompt: input.prompt, ...(crew && role ? { team: crew.name, role } : {}), writes }));
    serverDeliveries.add(child.sessionKey);
    const started = await deliver(child.sessionKey, text).catch(() => false);
    serverDeliveries.delete(child.sessionKey);
    if (!started) {
      const failed = byId(id)!;
      failed.state = "failed"; failed.attention = "error"; failed.finished_ms = now();
      failed.extra.result = { outcome: "failed", summary: "", artefacts: [], lastMessage: "", usage: usageOf([]), ended_ms: now(), error: "The agent engine did not accept the first message." };
      save(failed);
      settled(failed, "failed", "start");
    }
    let timedOut = false;
    if (mode === "block" && started) timedOut = !(await blockingWait(root.id, [agent], "all", input.timeout_ms ?? AGENT_WAIT_DEFAULT_MS));
    const after = byId(id)!, model = child.ref ? `${child.ref.providerId}/${child.ref.modelId}` : undefined;
    const finished = mode === "block" && !timedOut && settledState(after);
    // What the call itself returned is not told a second time.
    if (finished) db.prepare("DELETE FROM agent_notifications WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(caller.id, id);
    return {
      agentId: id, title: after.title, state: after.state, ...(role ? { role: role.roleId } : orcRole ? { role: orcRole } : {}), ...(model ? { model } : {}), waitArmed: mode !== "none" && !finished,
      ...(mode === "block" ? { timedOut, ...(finished && after.extra.result ? { result: resultFor(caller, after) } : {}) } : {}),
      guidance: finished ? "The agent finished; its result is above." : mode === "none" ? "The agent works in the background. Read it with jc_agent_status when you need it." : "The agent works in the background. You get a message when it settles: go on with other work or end your turn. Do not poll.",
    };
  }
  async function blockingWait(rootId: string, agents: Agent[], until: "all" | "any", timeout: number): Promise<boolean> {
    const open = blocking.get(rootId) ?? 0;
    if (open >= AGENT_LOOP_LIMITS.blockingWaitsPerTree) fail("RATE_LIMITED", "Too many agents of this session are waiting in a tool call. End your turn; you are notified when the agents settle.", { limit: AGENT_LOOP_LIMITS.blockingWaitsPerTree });
    blocking.set(rootId, open + 1);
    try { return await waitFor(agents, until, timeout); } finally { blocking.set(rootId, (blocking.get(rootId) ?? 1) - 1); }
  }
  /** What the rule table (`rules.ts`) needs to know about a caller and a target. */
  function factsOf(caller: Agent, agent: Agent | undefined) {
    const sameTree = !!agent && agent.root_id === caller.root_id;
    if (!agent || !sameTree) return { preset: callPreset(), sameTree: false, self: false, owned: false, below: false, above: false, directOwner: false };
    const tree = treeOf(caller.root_id), self = agent.id === caller.id;
    const owned = !self && owns(caller, agent, tree), created = (top: Agent, low: Agent) => descendants(top, tree).some((entry) => entry.id === low.id);
    const run = self ? undefined : runs.activeRunOf(caller), mate = !!run && run === runs.activeRunOf(agent);
    return {
      ...(agent.extra.reviewer ? { reviewer: true } : {}),
      preset: callPreset(), sameTree, self, owned, below: owned || (!self && created(caller, agent)), above: !self && (owns(agent, caller, tree) || created(agent, caller)), directOwner: ownerOf(caller) === agent.id,
      ...(mate ? { run: { ...(caller.extra.tier ? { caller: caller.extra.tier } : {}), ...(agent.extra.tier ? { target: agent.extra.tier } : {}) } } : {}),
    };
  }
  /**
   * An agent the caller may reach for `verb`, with how much of it the caller may read — or the refusal the rule table
   * gives. Every refusal is written to the audit log; an id outside what the caller can read is answered like an id
   * that does not exist.
   */
  function access(caller: Agent, agentId: string, verb: Verb): { agent: Agent; grant: "full" | "identity" } {
    const target = byId(agentId), verdict = decide(verb, factsOf(caller, target), agentId);
    if ("code" in verdict) {
      audit(db, now(), `agent:${caller.session_key}`, "agent.denied", { category: "agent", outcome: "denied", tool: AGENT_RULES[verb].tool, code: verdict.code, by: caller.id, targetId: agentId });
      return fail(verdict.code, verdict.message, { agentId });
    }
    return { agent: target!, grant: verdict.grant };
  }
  const reach = (caller: Agent, agentId: string, verb: Verb): Agent => access(caller, agentId, verb).agent;
  async function send(session: SessionRecord, input: { agentId: string; prompt: string; wait?: "notify" | "block" | "none"; timeout_ms?: number }): Promise<Json> {
    const caller = rootFor(session), { agent: target, grant: sendGrant } = access(caller, input.agentId, "send");
    turnOver(caller);
    if (target.id === caller.id) guardSend(caller, target, input.prompt);
    if (target.archived_ms) fail("AGENT_ARCHIVED", `"${target.title}" is archived. Create a new agent for this work.`, { agentId: target.id });
    if (target.state === "closed") fail("AGENT_CLOSED", `"${target.title}" is closed and takes no more messages. Create a new agent for this work.`, { agentId: target.id });
    assertBudget(target.session_key);
    assertActivity(target);
    const hop = guardSend(caller, target, input.prompt), running = sessions().isRunning(target.session_key);
    target.extra.hop = Math.max(target.extra.hop ?? 0, hop);
    save(target, true);
    const mode = input.wait ?? "notify";
    if (mode !== "none") arm(caller, target, sendGrant);
    carry(caller, target);
    serverDeliveries.add(target.session_key);
    const delivered = await deliver(target.session_key, `From ${nameOf(caller)}:\n${input.prompt}`).catch(() => false);
    serverDeliveries.delete(target.session_key);
    if (!delivered) fail("UNAVAILABLE", `The message could not be delivered to "${target.title}" right now. Try again.`, { agentId: target.id });
    audit(db, now(), `agent:${session.sessionKey}`, "agent.send", { from: caller.id, to: target.id, hop });
    let timedOut = false;
    if (mode === "block") timedOut = !(await blockingWait(caller.root_id, [target], "all", input.timeout_ms ?? AGENT_WAIT_DEFAULT_MS));
    const after = byId(target.id)!, finished = mode === "block" && !timedOut && settledState(after);
    if (finished) db.prepare("DELETE FROM agent_notifications WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(caller.id, target.id);
    return {
      agentId: target.id, delivered: running ? "followup" : "started", state: after.state, waitArmed: mode !== "none" && !finished, ...(mode === "block" ? { timedOut } : {}),
      // What comes back is what the caller may read: of the agent it reports to, that it settled — never what it did.
      ...(finished && after.extra.result && sendGrant === "full" ? { result: resultFor(caller, after) } : {}),
    };
  }
  /** An agent's result as `reader` gets it: the result of an agent that had read content from outside is marked as such, and the reader is tainted with it. */
  const resultFor = (reader: Agent, agent: Agent): AgentResult | (AgentResult & { untrusted: true }) | undefined => (agent.extra.result && carry(agent, reader) ? { ...agent.extra.result, untrusted: true as const } : agent.extra.result);
  async function wait(session: SessionRecord, input: { agentIds: string[]; mode?: "block" | "notify"; until?: "all" | "any"; timeout_ms?: number }): Promise<Json> {
    const caller = rootFor(session), reached = input.agentIds.map((id) => access(caller, id, "wait")), agents = reached.map((entry) => entry.agent);
    // Of the agent it reports to a caller learns that it settled, not what it did.
    const full = new Set(reached.filter((entry) => entry.grant === "full").map((entry) => entry.agent.id));
    let timedOut = false;
    if ((input.mode ?? "block") === "block") timedOut = !(await blockingWait(caller.root_id, agents, input.until ?? "all", input.timeout_ms ?? AGENT_WAIT_DEFAULT_MS));
    const fresh = agents.map((agent) => byId(agent.id)!), done = fresh.filter(settledState), pending = fresh.filter((agent) => !settledState(agent));
    for (const agent of pending) arm(caller, agent, full.has(agent.id) ? "full" : "identity");
    // What the call returns is not told a second time.
    for (const agent of done) db.prepare("DELETE FROM agent_notifications WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(caller.id, agent.id);
    return {
      settled: done.map((agent) => ({ agentId: agent.id, title: agent.title, state: agent.state, outcome: agent.extra.result?.outcome ?? (agent.state === "failed" ? "failed" : "completed"), ...(agent.extra.result && full.has(agent.id) ? { result: resultFor(caller, agent) } : {}) })),
      pending: pending.map((agent) => agent.id), timedOut, notifyArmed: pending.length > 0,
    };
  }
  function status(session: SessionRecord, agentId: string): Json {
    const caller = rootFor(session), { agent, grant } = access(caller, agentId, "status");
    // An agent above the caller: who it is and whether it works, nothing of what it did or spent.
    if (grant === "identity") return { agentId: agent.id, title: nameOf(agent), state: agent.state };
    const tree = treeOf(agent.root_id), kids = childrenOf(agent, tree), record = view(agent, tree);
    const count = (state: string) => kids.filter((entry) => entry.state === state && !entry.archived_ms).length;
    return {
      agentId: agent.id, title: agent.title, ...(record.roleId ? { role: record.roleId } : {}), ...(record.tier ? { tier: record.tier } : {}), state: agent.state, ...(agent.waiting_reason ? { waitingReason: agent.waiting_reason } : {}), attention: agent.attention,
      runtime: record.runtimeId, provider: record.providerId, model: record.modelId, mode: record.modeId, children: { running: count("running") + count("creating"), waiting: count("waiting"), idle: count("idle"), failed: count("failed") },
      usage: record.usage, budget: record.budget, lastMessagePreview: record.lastMessagePreview,
      ...(agent.extra.result ? { lastTurn: { outcome: agent.extra.result.outcome, ended_ms: agent.extra.result.ended_ms, ...(agent.extra.result.error ? { error: agent.extra.result.error } : {}) }, result: resultFor(caller, agent) } : {}),
      ...(carry(agent, caller) ? { untrusted: true } : {}),
    };
  }
  function list(session: SessionRecord, input: { scope?: "children" | "descendants" | "tree"; states?: string[]; includeArchived?: boolean }): Json[] {
    const caller = rootFor(session), tree = treeOf(caller.root_id);
    // What a caller can list is what it can read: the agents below it (and, under the preset "team", the members of its run); of the agents above it only who they are.
    const facts = new Map(tree.map((entry) => [entry.id, decide("list", factsOf(caller, entry), entry.id)]));
    const granted = (entry: Agent, grant: "full" | "identity") => { const verdict = facts.get(entry.id)!; return "grant" in verdict && verdict.grant === grant; };
    const below = tree.filter((entry) => entry.id !== caller.id && granted(entry, "full"));
    const pool = input.scope === "tree" ? below : input.scope === "descendants" ? below.filter((entry) => owns(caller, entry, tree) || descendants(caller, tree).some((low) => low.id === entry.id)) : below.filter((entry) => ownerOf(entry) === caller.id);
    const above = input.scope === "tree" ? tree.filter((entry) => granted(entry, "identity")).map((entry) => ({ agentId: entry.id, title: nameOf(entry), state: entry.state, depth: entry.depth, above: true })) : [];
    return [...pool.filter((agent) => (input.includeArchived || !agent.archived_ms) && (!input.states || input.states.includes(agent.state))).sort((a, b) => b.updated_ms - a.updated_ms).map((agent) => {
      const record = view(agent, tree);
      return { agentId: agent.id, title: agent.title, ...(record.roleId ? { role: record.roleId } : {}), ...(record.tier ? { tier: record.tier } : {}), ...(agent.parent_id ? { parentId: agent.parent_id } : {}), depth: agent.depth, state: agent.state, ...(agent.waiting_reason ? { waitingReason: agent.waiting_reason } : {}), attention: agent.attention, runtime: record.runtimeId, model: record.modelId, mode: record.modeId, updated_ms: agent.updated_ms, lastMessagePreview: record.lastMessagePreview, ...(agent.extra.assignmentId ? { assignmentId: agent.extra.assignmentId } : {}), ...(record.lastMessagePreview && carry(agent, caller) ? { untrusted: true } : {}) };
    }), ...above];
  }
  /** Stops the running turns of an agent and of everything below it; with `close` the agents take no more messages. */
  async function stopTree(target: Agent, options: { close?: boolean; includeSelf?: boolean } = {}): Promise<number> {
    const below = ownedBelow(target), all = options.includeSelf === false ? below : [target, ...below];
    let stopped = 0;
    const refused: Agent[] = [], done: Agent[] = [];
    for (const agent of all.reverse()) {
      const running = sessions().isRunning(agent.session_key);
      // An abort the engine does not take leaves the agent working: nothing about it is changed, and whoever asked is told.
      if (running && (await sessions().abort(agent.session_key)) === false) { refused.push(agent); continue; }
      if (running && agent.id !== target.id) stopped += 1;
      done.push(agent);
      // Whoever is stopped tells nobody below it and is told by nobody below it.
      if (agent.id !== target.id) disarm([agent.id]);
      const fresh = byId(agent.id)!;
      if (options.close && fresh.depth > 0) { fresh.state = "closed"; fresh.waiting_reason = null; fresh.finished_ms = now(); save(fresh); wake(fresh.id); }
      // The runtime reports the aborted turn itself; an agent that only waited for its children is idle from here on.
      else if (!running && fresh.state === "waiting") { fresh.state = "idle"; fresh.waiting_reason = null; save(fresh); wake(fresh.id); }
    }
    // A member that was stopped holds its assignment no longer: its run does not wait for a hand-back that cannot come.
    runs.agentCancelled(done);
    if (refused.length) fail("AGENT_BUSY", `"${refused[0].title}" did not stop: the agent engine did not take the request, so it is still working. Try again in a moment.`, { agentId: refused[0].id, stillRunning: refused.map((agent) => agent.id) });
    return stopped;
  }
  async function cancel(session: SessionRecord, input: { agentId: string; close?: boolean; reason?: string }): Promise<Json> {
    const caller = rootFor(session), target = reach(caller, input.agentId, "cancel");
    const cancelledDescendants = await stopTree(target, { close: input.close === true });
    // The caller asked for this itself: it is not told again by a message (a stop the engine refused changed nothing above).
    db.prepare("DELETE FROM agent_notifications WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(caller.id, target.id);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.cancel", { agentId: target.id, by: caller.id, close: input.close === true, reason: input.reason ?? "" });
    const after = byId(target.id)!;
    return { agentId: target.id, state: input.close ? "closed" : after.state === "running" ? "idle" : after.state, cancelledDescendants };
  }
  type HandbackInput = {
    status?: HandbackOutcome; outcome?: HandbackOutcome; whatChangedOrInspected?: string; evidence?: string; remainingUncertainty?: string; counterEvidence?: string;
    requestedResolution?: string; currentDirection?: string; claim?: string; risk?: string; artefacts?: { kind: string; id: string; title: string; note?: string }[]; handoffId?: string;
    openQuestions?: string[]; risks?: string[]; nextSteps?: string[];
  };
  /**
   * `Hand-back record`: the work goes back to the agent the sender reports to in four required sections — what changed
   * or was inspected, the evidence, what is still uncertain, and what speaks against the result. A section with nothing
   * to say says "None"; one that is left out is refused, so nothing is handed back as fact without its doubts.
   */
  function handback(session: SessionRecord, input: HandbackInput): Json {
    const agent = rootFor(session);
    const owner = ownerOf(agent);
    if (!owner) fail("INVALID_PARAMS", "Only an agent that another agent created hands back. Report to the user in your reply instead.", { reason: "no_owner" });
    if (agent.extra.reviewer) fail("AGENT_POLICY_DENIED", "A reviewer answers its review with jc_review_submit, not with a hand-back.");
    for (const field of HANDBACK_REQUIRED_FIELDS) {
      if (!input[field]?.trim()) fail("INVALID_PARAMS", `${field} is required. When there is nothing to say for it, state "None" explicitly.`, { field });
    }
    for (const field of [...HANDBACK_REQUIRED_FIELDS, ...HANDBACK_OPTIONAL_FIELDS]) {
      const length = input[field]?.length ?? 0;
      if (length > HANDBACK_FIELD_MAX) fail("INVALID_PARAMS", `${field} is at most ${HANDBACK_FIELD_MAX.toLocaleString("en-US")} characters; got ${length.toLocaleString("en-US")}. Summarise it.`, { field });
    }
    turnOver(agent);
    runs.beforeHandback(agent);
    // A hand-back that answers a returned one takes its place: the returned record is superseded, the count of returns goes on.
    const returned = handbacksOf(agent.id).find((entry) => entry.state === "returned");
    if (returned) writeHandback({ ...returned, state: "superseded" }, "superseded", { kind: "agent", id: agent.id }, agent.root_id);
    const ownerAgent = byId(owner!), text = (field: (typeof HANDBACK_OPTIONAL_FIELDS)[number]) => (input[field]?.trim() ? { [field]: input[field]!.trim() } : {});
    const proposals = proposalsSince(session.sessionKey, agent.extra.turnStarted_ms ?? 0);
    const named = (input.artefacts ?? []).filter((entry) => !proposals.some((proposal) => proposal.id === entry.id)).map((entry) => ({ kind: (entry.kind === "proposal" ? "proposal" : "note") as AgentArtefact["kind"], id: entry.id, title: entry.title }));
    const record: AgentHandback = {
      handbackId: `hbk_${newAgentId(now()).slice(4)}`, agentId: agent.id, toAgentId: owner!, fromTitle: agent.title, ...(ownerAgent ? { toTitle: nameOf(ownerAgent) } : {}), status: input.outcome ?? input.status ?? "done",
      whatChangedOrInspected: input.whatChangedOrInspected!.trim(), evidence: input.evidence!.trim(), remainingUncertainty: input.remainingUncertainty!.trim(), counterEvidence: input.counterEvidence!.trim(),
      ...text("requestedResolution"), ...text("currentDirection"), ...text("claim"), ...text("risk"), ...(input.handoffId ? { handoffId: input.handoffId } : {}),
      openQuestions: input.openQuestions ?? [], risks: input.risks ?? [], nextSteps: input.nextSteps ?? [], artefacts: [...proposals, ...named], created_ms: now(),
      state: "delivered", returns: returned?.returns ?? 0, ...(returned ? { supersedes: returned.handbackId } : {}),
    };
    db.prepare("INSERT INTO agent_handbacks (id, agent_id, json, created_ms) VALUES (?, ?, ?, ?)").run(record.handbackId, agent.id, JSON.stringify(record), record.created_ms);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.handback", { category: "agent", kind: "handback", recordId: record.handbackId, action: "created", handbackId: record.handbackId, agentId: agent.id, fromAgentId: agent.id, toAgentId: record.toAgentId, status: record.status, actor: { kind: "agent", id: agent.id }, rootId: agent.root_id });
    runs.handedBack(agent, record);
    // The hand-back ends the sender's turn (`Hand-back record`): it is idle from this moment, nothing more of this turn
    // is taken (`turnOver`), and a turn that has not ended by itself after a moment is stopped by the server.
    const fresh = byId(agent.id)!;
    fresh.extra.handedBackTurn = record.handbackId;
    if (fresh.state !== "closed") { fresh.state = "idle"; fresh.waiting_reason = null; }
    save(fresh, true);
    const stop = (attempt: number) => {
      const timer = setTimeout(() => {
        usageTimers.delete(timer);
        const current = byId(agent.id);
        if (!current || current.extra.handedBackTurn !== record.handbackId || !sessions().isRunning(current.session_key)) return;
        void Promise.resolve(sessions().abort(current.session_key)).catch(() => false).then((stopped) => { if (stopped === false && attempt < 5) stop(attempt + 1); });
      }, attempt === 0 ? deps.timings?.handbackGraceMs ?? HANDBACK_GRACE_MS : 2000);
      timer.unref?.();
      usageTimers.add(timer);
    };
    stop(0);
    changed(agent.root_id);
    return { handbackId: record.handbackId, deliveredTo: record.toAgentId, guidance: "Your work is handed back and this turn is over: nothing more is taken from it. End the turn now." };
  }
  /** A tool of the agent family behind the ended-turn gate: the caller's turn must not be one it ended by handing back. */
  const inTurn = <I, O>(tool: (session: SessionRecord, input: I) => O) => (session: SessionRecord, input: I): O => { const agent = bySession(session.sessionKey); if (agent) turnOver(agent); return tool(session, input); };
  /** Refuses whatever an agent still tries in the turn in which it handed back. */
  function turnOver(agent: Agent): void {
    if (agent.extra.handedBackTurn && sessions().isRunning(agent.session_key)) fail("CONFLICT", "You handed your work back, and with that this turn is over. End your turn; you get a message if more is asked of you.", { handbackId: agent.extra.handedBackTurn });
  }
  /**
   * "Hand-back waiting": a hand-back nobody decided on for half an hour, while the agent it was made to rests, is marked
   * on that agent so the roster shows it and the session asks for attention.
   */
  function markWaitingHandbacks(): void {
    const after = deps.timings?.handbackWaitMs ?? HANDBACK_WAITING_AFTER_MS, due = now() - after;
    for (const row of db.prepare("SELECT json FROM agent_handbacks WHERE created_ms <= ?").all(due) as { json: string }[]) {
      const record = JSON.parse(row.json) as AgentHandback, owner = (record.state ?? "delivered") === "delivered" ? byId(record.toAgentId) : undefined;
      if (!owner || owner.extra.handbackWaiting || owner.archived_ms || owner.state !== "idle") continue;
      owner.extra.handbackWaiting = true;
      if (owner.attention === "none") owner.attention = "handoff";
      save(owner);
    }
  }
  const handbackSweep = setInterval(markWaitingHandbacks, Math.max(20, Math.min(60_000, (deps.timings?.handbackWaitMs ?? HANDBACK_WAITING_AFTER_MS) / 4)));
  handbackSweep.unref?.();
  /** A hand-back was decided: its owner waits for it no longer, unless another one still waits. */
  function clearWaitingHandback(ownerId: string): void {
    const owner = byId(ownerId);
    if (!owner?.extra.handbackWaiting) return;
    const still = (db.prepare("SELECT json FROM agent_handbacks").all() as { json: string }[]).some((row) => { const record = JSON.parse(row.json) as AgentHandback; return record.toAgentId === ownerId && (record.state ?? "delivered") === "delivered"; });
    if (still) return;
    delete owner.extra.handbackWaiting;
    if (owner.attention === "handoff") owner.attention = "none";
    save(owner);
  }
  // — Hand-back decisions (`Hand-back acceptance and return`) —
  const handbackById = (id: string): AgentHandback | undefined => { const row = db.prepare("SELECT json FROM agent_handbacks WHERE id = ?").get(id) as { json: string } | undefined; return row ? (JSON.parse(row.json) as AgentHandback) : undefined; };
  /** The hand-backs of one agent, newest first. */
  const handbacksOf = (agentId: string): AgentHandback[] => (db.prepare("SELECT json FROM agent_handbacks WHERE agent_id = ? ORDER BY created_ms DESC, id DESC").all(agentId) as { json: string }[]).map((row) => JSON.parse(row.json) as AgentHandback);
  function writeHandback(record: AgentHandback, action: "accepted" | "returned" | "superseded", actor: { kind: "agent" | "device"; id: string }, rootId: string): void {
    db.prepare("UPDATE agent_handbacks SET json = ? WHERE id = ?").run(JSON.stringify(record), record.handbackId);
    audit(db, now(), `${actor.kind}:${actor.id}`, "agent.handback", { category: "agent", kind: "handback", recordId: record.handbackId, action, fromAgentId: record.agentId, toAgentId: record.toAgentId, actor, rootId });
    clearWaitingHandback(record.toAgentId);
    changed(rootId);
  }
  /**
   * The owner's (or a person's) answer to a hand-back. `accept` closes it. `return` sends the note back to the agent
   * as a new prompt and lets it hand back once more; the same piece of work is returned at most twice.
   */
  function decideHandback(record: AgentHandback, decision: "accept" | "return", actor: { kind: "agent" | "device"; id: string }, note: string | undefined, byName: string): AgentHandback {
    const sender = byId(record.agentId);
    if (!sender) return fail("NOT_FOUND", "The agent of this hand-back no longer exists.", { handbackId: record.handbackId });
    if ((record.state ?? "delivered") !== "delivered") fail("ALREADY_RESOLVED", `This hand-back was already ${record.state}.`, { handbackId: record.handbackId, state: record.state });
    if (decision === "accept") {
      const next: AgentHandback = { ...record, state: "accepted", decidedBy: actor, decided_ms: now(), ...(note ? { note } : {}) };
      writeHandback(next, "accepted", actor, sender.root_id);
      return next;
    }
    if (!note) fail("INVALID_PARAMS", "Say in note what is missing, so the agent knows what to do before it hands back again.", { field: "note" });
    if ((record.returns ?? 0) >= HANDBACK_MAX_RETURNS) fail("INVALID_PARAMS", `This work was already returned ${HANDBACK_MAX_RETURNS} times. Accept it, cancel the agent, or ask the user what to do.`, { reason: "max_returns", limit: HANDBACK_MAX_RETURNS });
    if (sender.archived_ms) fail("AGENT_ARCHIVED", `"${sender.title}" is archived and cannot take the work back.`, { agentId: sender.id });
    if (sender.state === "closed") fail("AGENT_CLOSED", `"${sender.title}" is closed and cannot take the work back.`, { agentId: sender.id });
    assertBudget(sender.session_key);
    assertActivity(sender);
    // In a team run the assignment — with its write assignment, when it had one — goes back to the peer: refused here, before anything changes, when another agent holds it now.
    runs.beforeHandbackReturn(sender, record.handbackId);
    const next: AgentHandback = { ...record, state: "returned", returns: (record.returns ?? 0) + 1, decidedBy: actor, decided_ms: now(), note: note! };
    writeHandback(next, "returned", actor, sender.root_id);
    // In a team run the assignment is the peer's again until it hands back.
    runs.handbackReturned(sender, record.handbackId);
    const owner = byId(ownerOf(sender) ?? "");
    if (owner) arm(owner, sender);
    // The note is the text of the agent that returned the work: what that agent had read from outside, the sender reads with it (a person's note carries nothing).
    if (actor.kind === "agent") carry(byId(actor.id), sender);
    // While its run is paused the agent is not started: the note waits with the run and goes out when a person resumes it.
    void runs.tellOrHold(sender, `${byName} returned your hand-back ${record.handbackId}. This message is from the server, not from the user.\nWhat is missing: ${note}\nDo it, then hand back again with jc_agent_handback.`);
    return next;
  }
  function handbackRespond(session: SessionRecord, input: { handbackId: string; decision: "accept" | "return"; note?: string }): Json {
    const caller = rootFor(session), record = handbackById(input.handbackId), sender = record ? byId(record.agentId) : undefined;
    if (!record || !sender || sender.root_id !== caller.root_id) return fail("NOT_FOUND", `There is no hand-back ${input.handbackId} for you. Hand-backs reach you in the message that tells you an agent settled.`, { handbackId: input.handbackId });
    // The agent the work is returned to decides: whoever the sender reports to now.
    if (ownerOf(sender) !== caller.id) fail("AGENT_NOT_OWNED", "Only the agent a hand-back was made to accepts or returns it.", { handbackId: record.handbackId });
    if (runs.activeRunOf(sender)) fail("TEAM_SHAPE_VIOLATION", "In a team run a hand-back is answered by accepting the result (jc_team_accept_result) or by a new bounded assignment (jc_team_create_peer).", { handbackId: record.handbackId });
    const next = decideHandback(record, input.decision, { kind: "agent", id: caller.id }, input.note?.trim() || undefined, `"${nameOf(caller)}"`);
    return { handbackId: next.handbackId, state: next.state, returns: next.returns ?? 0, ...(next.state === "returned" ? { guidance: `"${sender.title}" was told what is missing and hands back again; you are told when it has.` } : {}) };
  }
  function catalog(session: SessionRecord): Json {
    const caller = rootFor(session), tree = treeOf(caller.root_id), root = tree.find((entry) => entry.id === caller.root_id), crew = teamOfTree(root), cap = limits(), left = remainingFor(caller, tree);
    const roles = crew
      ? crew.roles.filter((entry) => entry.enabled && entry.tier !== "supervisor").map((entry) => ({ role: entry.roleId, label: entry.label, tier: entry.tier, responsibility: entry.contract.responsibility, writesToProject: entry.contract.canWrite }))
      : ORC_BUILTIN_ROLES.filter((entry) => entry.capability === "llm" && entry.group === "creative").map((entry) => ({ role: entry.id, label: entry.label, responsibility: entry.description, writesToProject: true }));
    return {
      ...(crew ? { team: { id: crew.id, name: crew.name, writerPolicy: crew.writerPolicy, limits: crew.limits }, yourRole: caller.extra.roleLabel ?? crew.roles.find((entry) => entry.tier === "supervisor")?.label } : {}),
      roles, limits: cap, depth: caller.depth, agentsCreated: tree.length - 1, ...(left ? { remainingUsd: left.remainingUsd } : {}),
      ...(session.ref ? { yourModel: `${session.ref.providerId}/${session.ref.modelId}` } : {}),
    };
  }

  /** Archives an agent with everything below it: running turns are stopped first, nobody waits for them any more. A detached agent is a tree of its own and is not below anything. */
  async function archiveTree(agent: Agent): Promise<number> {
    // What was handed to an owner outside this agent's reach stays with that owner, alive.
    settleLineage(agent);
    await stopTree(agent);
    const all = [byId(agent.id)!, ...ownedBelow(agent)];
    disarm(all.map((entry) => entry.id));
    for (const entry of all) { const fresh = byId(entry.id)!; fresh.archived_ms = now(); save(fresh); wake(fresh.id); }
    handoffs.agentGone(all.map((entry) => entry.id));
    recheckWaiting(ownerOf(agent));
    return all.length;
  }
  async function archive(session: SessionRecord, input: { agentId: string; reason?: string }): Promise<Json> {
    const caller = rootFor(session), target = reach(caller, input.agentId, "archive");
    const count = await archiveTree(target);
    db.prepare("DELETE FROM agent_notifications WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(caller.id, target.id);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.archive", { agentId: target.id, by: caller.id, count, reason: input.reason ?? "" });
    return { agentId: target.id, state: byId(target.id)!.state, archived: true, cancelledDescendants: count - 1 };
  }
  function update(session: SessionRecord, input: { agentId: string; title?: string; labels?: Record<string, string> }): Json {
    const caller = rootFor(session), target = reach(caller, input.agentId, "update");
    if (input.title === undefined && input.labels === undefined) fail("INVALID_PARAMS", "Give a title, labels, or both.", { field: "title" });
    if (input.labels !== undefined) {
      // The labels an agent may write are the user labels; the server's own (jc.*) stay as they are.
      const kept = Object.fromEntries(Object.entries(target.extra.labels).filter(([key]) => key.startsWith("jc.")));
      target.extra.labels = { ...checkLabels(input.labels), ...kept };
    }
    if (input.title !== undefined) { target.title = input.title; sessions().retitle(target.session_key, input.title); }
    save(target);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.update", { agentId: target.id, by: caller.id, ...(input.title !== undefined ? { title: input.title } : {}), ...(input.labels !== undefined ? { labels: Object.keys(input.labels) } : {}) });
    return { agentId: target.id, state: target.state, title: target.title, labels: target.extra.labels };
  }
  /** The mode of an agent the caller owns: never above the caller's own. */
  async function setMode(session: SessionRecord, input: { agentId: string; mode: ProductMode }): Promise<Json> {
    const caller = rootFor(session), target = reach(caller, input.agentId, "set_mode");
    if (target.archived_ms) fail("AGENT_ARCHIVED", `"${target.title}" is archived.`, { agentId: target.id });
    if (target.state === "closed") fail("AGENT_CLOSED", `"${target.title}" is closed.`, { agentId: target.id });
    const ceiling = session.modeId as ProductMode;
    if (MODE_ORDER.indexOf(input.mode) > MODE_ORDER.indexOf(ceiling)) fail("INVALID_PARAMS", `An agent cannot be given more than you have: you are in ${ceiling} mode, so the most you can set is ${ceiling}.`, { field: "mode", maxMode: ceiling });
    const applied = await sessions().setMode(target.session_key, input.mode);
    save(byId(target.id)!);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.set_mode", { agentId: target.id, by: caller.id, mode: input.mode, applied });
    return { agentId: target.id, mode: input.mode, applied, ...(applied === "next_turn" ? { notice: "applies_next_turn" } : {}) };
  }
  /**
   * The model of an agent the caller owns. Models are chosen in ORC, so what can be set is a profile of the agent's own
   * role (`profile`), or the role's first usable profile again (no `profile`) — never a free model id.
   */
  async function setModel(session: SessionRecord, input: { agentId: string; profile?: string }): Promise<Json> {
    const caller = rootFor(session), target = reach(caller, input.agentId, "set_model");
    if (target.archived_ms) fail("AGENT_ARCHIVED", `"${target.title}" is archived.`, { agentId: target.id });
    if (target.state === "closed") fail("AGENT_CLOSED", `"${target.title}" is closed.`, { agentId: target.id });
    const crew = teamOfTree(byId(target.root_id)), orcRole = crew?.roles.find((entry) => entry.roleId === target.extra.roleId)?.orcRole ?? target.extra.roleId;
    if (!orcRole) fail("INVALID_PARAMS", `"${target.title}" was created without a role, so it has no profiles to choose from. Create an agent with a role (jc_agent_catalog lists them).`, { field: "agentId" });
    const route = sessions().routeOf(target.session_key, orcRole!), current = sessions().session(target.session_key)?.ref;
    const usable = route.filter((entry) => !current || entry.ref.runtimeId === current.runtimeId);
    const chosen = input.profile ? usable.find((entry) => entry.profileId === input.profile) : usable[0];
    if (!chosen) fail("INVALID_PARAMS", input.profile ? `"${input.profile}" is not a usable profile of the role ${orcRole}. Profiles: ${usable.map((entry) => entry.profileId).join(", ") || "none"}.` : `The role ${orcRole} has no usable profile on this agent's runtime. An admin sets them under Settings → Routing.`, { field: "profile", validProfiles: usable.slice(0, 50).map((entry) => entry.profileId) });
    // A model cannot change under a running turn: the change is queued and applied before the agent's next turn.
    if (sessions().isRunning(target.session_key)) {
      const queued = byId(target.id)!;
      queued.extra.pendingModel = { profileId: chosen!.profileId, role: orcRole!, ref: chosen!.ref, ...(chosen!.thinking ? { thinking: chosen!.thinking } : {}), by: caller.id };
      save(queued, true);
      audit(db, now(), `agent:${session.sessionKey}`, "agent.set_model", { agentId: target.id, by: caller.id, role: orcRole, profileId: chosen!.profileId, applied: "next_turn" });
      return { agentId: target.id, role: orcRole, profile: chosen!.profileId, model: `${chosen!.ref.providerId}/${chosen!.ref.modelId}`, applied: "next_turn", notice: "applies_next_turn" };
    }
    const waiting = byId(target.id)!;
    if (waiting.extra.pendingModel) { delete waiting.extra.pendingModel; save(waiting, true); }
    const after = await sessions().retarget(target.session_key, chosen!);
    save(byId(target.id)!);
    audit(db, now(), `agent:${session.sessionKey}`, "agent.set_model", { agentId: target.id, by: caller.id, role: orcRole, profileId: chosen!.profileId });
    return { agentId: target.id, role: orcRole, profile: chosen!.profileId, model: after.ref ? `${after.ref.providerId}/${after.ref.modelId}` : undefined, applied: "now" };
  }
  /**
   * A queued model change gates the agent's next turn: it starts being applied in the same tick its turn ends, and
   * every message this service delivers to the agent waits for it (`deliver`); a turn anybody else tries to start in
   * that moment is refused as busy (`assertBudget`, which the relay asks before every turn).
   */
  const applying = new Map<string, Promise<void>>();
  function startModelChange(agentId: string): void {
    if (applying.has(agentId)) return;
    const work = applyPendingModel(agentId).finally(() => { if (applying.get(agentId) === work) applying.delete(agentId); });
    applying.set(agentId, work);
  }
  async function deliver(sessionKey: string, text: string): Promise<boolean> {
    const agent = bySession(sessionKey);
    if (agent?.extra.pendingModel && !sessions().isRunning(sessionKey)) startModelChange(agent.id);
    if (agent) await applying.get(agent.id);
    return sessions().deliver(sessionKey, text);
  }
  async function applyPendingModel(agentId: string): Promise<void> {
    const agent = byId(agentId), pending = agent?.extra.pendingModel;
    if (!agent || !pending || agent.archived_ms || agent.state === "closed" || sessions().isRunning(agent.session_key)) return;
    let failure = "";
    try { await sessions().retarget(agent.session_key, pending); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    const fresh = byId(agentId);
    if (!fresh) return;
    // Applied, or refused by the engine for good: either way it is not tried again behind the agent's back.
    if (fresh.extra.pendingModel?.profileId === pending.profileId) delete fresh.extra.pendingModel;
    save(fresh);
    audit(db, now(), "server", "agent.set_model.applied", { agentId, by: pending.by, role: pending.role, profileId: pending.profileId, ...(failure ? { error: failure.slice(0, 300) } : {}) });
  }
  async function activity(session: SessionRecord, input: { agentId: string; sinceCursor?: string; maxItems?: number }): Promise<Json> {
    const caller = rootFor(session), target = reach(caller, input.agentId, "activity");
    const history = sessions().history(target.session_key, 400) as unknown[];
    // What was asked is read without the editor context the server puts in front of every turn's message (the transcript
    // holds the message as the runtime got it). The first message of a sub-agent is the server's standing instructions
    // followed by its assignment: the summary starts at the assignment.
    const messages = history.map((message) => {
      const entry = message as { role?: string; content?: unknown };
      if (entry.role !== "user") return message;
      const text = stripInjectedUserText(textOf(entry.content)), at = text.indexOf("\nAssignment:\n");
      return { role: "user", content: at >= 0 && text.startsWith("You are \"") ? text.slice(at + 13) : text };
    });
    return { agentId: target.id, title: target.title, ...activityOf(messages, input.sinceCursor, input.maxItems ?? 20, sessions().session(target.session_key)?.modeId ?? "edit"), ...(carry(target, caller) ? { untrusted: true } : {}) };
  }
  /** Who agents can call (`Who-can-call-whom policy presets`). */
  const callPreset = (): "tree" | "team" => (deps.config.get<string>("agents.callPreset") === "team" ? "team" : "tree");

  // — Who may write —
  /** Refuses an agent that may not edit the project in its role, before the writer token is looked at. */
  function writerGate(session: SessionRecord): void {
    const agent = bySession(session.sessionKey);
    if (!agent) return;
    turnOver(agent);
    const root = agent.depth === 0 ? agent : byId(agent.root_id), crew = teamOfTree(root);
    if (!crew) return;
    const writers = crew.roles.filter((entry) => entry.enabled && entry.contract.canWrite).map((entry) => entry.roleId).join(", ") || "none";
    if (agent.depth === 0) {
      const mine = crew.roles.find((entry) => entry.tier === "supervisor" && entry.enabled);
      if (mine && !mine.contract.canWrite) fail("TEAM_ROLE_DENIED", `With the team "${crew.name}" the ${mine.label} does not edit the project. Give the edit to a role that writes (${writers}) with jc_agent_create {role, grantsWrite: true}.`, { tier: "supervisor" });
      return;
    }
    // Nothing of a paused run works: a turn the agent engine would not stop edits nothing until a person resumed the run.
    if (runs.pausedMember(agent)) fail("TEAM_SHAPE_VIOLATION", "The run is paused since the host restarted and takes nothing until the user resumes it. End your turn.", { status: "paused" });
    if (!agent.extra.canWrite) fail("TEAM_ROLE_DENIED", `The ${agent.extra.roleLabel ?? "your"} role does not edit the project. Describe the change in your hand-back (jc_agent_handback) for a role that writes (${writers}).`, { roleId: agent.extra.roleId });
    if (crew.writerPolicy === "lead_assigns" && !agent.extra.grantsWrite) fail("WRITER_HELD", "You were not given the write assignment for this project. Hand back a description of the change, or a dry-run result, for the agent that writes.", { reason: "not_assigned" });
  }
  /** How long a sub-agent waits in the queue of a project's writer token; a chat session of its own never waits. */
  const writerWaitMs = (session: SessionRecord): number => ((bySession(session.sessionKey)?.depth ?? 0) > 0 ? deps.timings?.writerQueueMs ?? AGENT_WRITER_QUEUE_WAIT_MS : 0);

  // — Channel methods —
  const methods = new Map<string, RpcMethod>();
  function define<M extends AgentTeamMethod>(name: M, handle: (params: z.infer<(typeof agentTeamRpcParams)[M]>, connection: Connection) => unknown | Promise<unknown>): void {
    methods.set(name, {
      scope: AGENT_TEAM_METHOD_SCOPES[name],
      handle(raw, connection) {
        const parsed = agentTeamRpcParams[name].safeParse(raw ?? {});
        if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", parsed.error.issues[0]?.message ?? "Invalid parameters.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "", field: String(parsed.error.issues[0]?.path.at(-1) ?? "") } });
        return handle(parsed.data as never, connection);
      },
    });
  }
  const rootOf = (agent: Agent) => (agent.depth === 0 ? agent : byId(agent.root_id)!);
  function readable(agentId: string, connection: Connection): Agent {
    const agent = byId(agentId);
    if (!agent || !sessions().canRead(rootOf(agent).session_key, connection)) throw new ProtocolError("AGENT_NOT_FOUND", "No such agent.");
    return agent;
  }
  function actable(agentId: string, connection: Connection): Agent {
    const agent = readable(agentId, connection);
    if (!sessions().canAct(rootOf(agent).session_key, connection)) throw new ProtocolError("SCOPE_DENIED", "This device cannot act in that session.", { details: { reason: "no_act_access" } });
    return agent;
  }
  function rootByParams(params: { rootId?: string; agentId?: string; sessionKey?: string }, connection: Connection): Agent {
    if (params.sessionKey) {
      const session = sessions().session(params.sessionKey);
      if (!session || !sessions().canRead(session.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
      return rootOf(rootFor(session));
    }
    const id = params.rootId ?? params.agentId;
    if (!id) throw new ProtocolError("INVALID_PARAMS", "Give sessionKey, rootId or agentId.", { details: { path: "rootId" } });
    return rootOf(readable(id, connection));
  }
  const treeView = (root: Agent, includeArchived?: boolean) => { const tree = treeOf(root.id); return { rootId: root.id, seq: seq.get(root.id) ?? 0, teamId: root.extra.teamId ?? null, agents: ordered(root.id, includeArchived).map((agent) => view(agent, tree)) }; };

  define("jagentchill.agent.list", (params, connection) => {
    if (params.scope !== "host") return treeView(rootByParams(params, connection), params.includeArchived);
    // Host-wide: every tree this device can read that has, or had, more than its own agent.
    const roots = (db.prepare("SELECT * FROM agents WHERE depth = 0 ORDER BY updated_ms DESC").all() as Row[]).map((row) => read(row)!).filter((root) => sessions().canRead(root.session_key, connection));
    return { trees: roots.map((root) => treeView(root, params.includeArchived)).filter((tree) => tree.agents.length > 1 || tree.teamId) };
  });
  define("jagentchill.agent.get", (params, connection) => ({ agent: view(readable(params.agentId, connection)) }));
  define("jagentchill.agent.tree.get", (params, connection) => treeView(rootByParams(params, connection), params.includeArchived));
  define("jagentchill.agent.send", async (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (agent.archived_ms) throw new ProtocolError("AGENT_ARCHIVED", "This agent is archived.");
    if (agent.state === "closed") throw new ProtocolError("AGENT_CLOSED", "This agent is closed.");
    assertBudget(agent.session_key);
    // A person's message: the turn it starts resets the loop counters like any prompt typed in the chat.
    if (!(await deliver(agent.session_key, params.prompt))) throw new ProtocolError("UNAVAILABLE", "The agent engine is not reachable.", { retryable: true });
    audit(db, now(), `device:${connection.deviceId}`, "agent.send", { agentId: agent.id });
    return { agent: view(byId(agent.id)!) };
  });
  define("jagentchill.agent.stop", async (params, connection) => {
    const agent = actable(params.agentId, connection);
    const stoppedDescendants = await stopTree(agent);
    audit(db, now(), `device:${connection.deviceId}`, "agent.stop", { agentId: agent.id, stoppedDescendants });
    return { agent: view(byId(agent.id)!), stoppedDescendants };
  });
  define("jagentchill.agent.stopAll", async (params, connection) => {
    const root = rootByParams(params, connection);
    actable(root.id, connection);
    const stopped = await stopTree(root);
    audit(db, now(), `device:${connection.deviceId}`, "agent.stopAll", { rootId: root.id, stopped });
    return { rootId: root.id, stopped };
  });
  define("jagentchill.agent.close", async (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (agent.depth === 0) throw new ProtocolError("AGENT_NOT_OWNED", "The session's own agent is closed by archiving the session.");
    await stopTree(agent, { close: true });
    db.prepare("DELETE FROM agent_notifications WHERE agent_id = ? AND state = 'armed'").run(agent.id);
    recheckWaiting(ownerOf(agent));
    audit(db, now(), `device:${connection.deviceId}`, "agent.close", { agentId: agent.id });
    return { agent: view(byId(agent.id)!) };
  });
  define("jagentchill.agent.archive", async (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (agent.depth === 0) throw new ProtocolError("AGENT_NOT_OWNED", "The session's own agent is archived with its session.");
    const archived = await archiveTree(agent);
    audit(db, now(), `device:${connection.deviceId}`, "agent.archive", { agentId: agent.id, count: archived });
    return { agent: view(byId(agent.id)!), archived };
  });
  define("jagentchill.agent.detach", (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (agent.depth === 0) throw new ProtocolError("AGENT_NOT_OWNED", "This agent is a session of its own already.");
    // Everything that reports to it leaves with it: none of that may be work a team run still counts on.
    const held = [agent, ...ownedBelow(agent)].map((entry) => ({ entry, why: runs.holds(entry) })).filter((item) => item.why);
    if (held.length) {
      throw new ProtocolError("TEAM_SHAPE_VIOLATION", held[0].why === "lead" ? "This agent leads a team run that is still going. Cancel the run before detaching it" : "Cancel or reassign this assignment before detaching the agent", { details: { agentId: agent.id, heldAgentIds: held.map((item) => item.entry.id) } });
    }
    const formerRoot = byId(agent.root_id)!, parentId = ownerOf(agent);
    // What was handed to an owner outside stays with that owner; what it received from outside comes along.
    settleLineage(agent);
    const below = descendants(byId(agent.id)!);
    // Nobody above waits for it any more; what it armed for its own agents stays.
    const inside = new Set([agent.id, ...below.map((entry) => entry.id)]);
    for (const row of db.prepare("SELECT id, armer_id, agent_id FROM agent_notifications WHERE state IN ('armed', 'ready')").all() as { id: number; armer_id: string; agent_id: string }[]) {
      if (inside.has(row.agent_id) !== inside.has(row.armer_id)) db.prepare("DELETE FROM agent_notifications WHERE id = ?").run(row.id);
    }
    handoffs.agentGone([...inside]);
    const shift = byId(agent.id)!.depth;
    db.prepare("UPDATE agents SET parent_id = NULL, root_id = ?, depth = 0, origin = 'user' WHERE id = ?").run(agent.id, agent.id);
    for (const entry of below) db.prepare("UPDATE agents SET root_id = ?, depth = ? WHERE id = ?").run(agent.id, entry.depth - shift, entry.id);
    // The tree it starts has no team: no agent in it keeps a place, a run or a write assignment of the team it left.
    for (const entry of below) {
      const fresh = byId(entry.id)!;
      delete fresh.extra.tier; delete fresh.extra.teamId; delete fresh.extra.runId; delete fresh.extra.assignmentId; delete fresh.extra.grantsWrite; delete fresh.extra.canWrite;
      save(fresh, true);
    }
    const moved = byId(agent.id)!;
    delete moved.extra.ownerId; delete moved.extra.tier; delete moved.extra.teamId; delete moved.extra.runId; delete moved.extra.assignmentId; delete moved.extra.grantsWrite; delete moved.extra.canWrite;
    moved.extra.detached_ms = now();
    sessions().detachSession(agent.session_key, connection.deviceId);
    save(moved);
    // The tree it left reads itself again: the agent and everything below it are gone from it.
    const next = (seq.get(formerRoot.id) ?? 0) + 2;
    seq.set(formerRoot.id, next);
    deps.broadcast("jagentchill.projects.read", "jagentchill.agent.updated", `agent:${formerRoot.id}`, { rootId: formerRoot.id, seq: next, agent: view(formerRoot) }, (peer) => sessions().canRead(formerRoot.session_key, peer));
    recheckWaiting(parentId);
    audit(db, now(), `device:${connection.deviceId}`, "agent.detach", { agentId: agent.id, formerRootId: formerRoot.id, formerParentId: parentId, descendants: below.length });
    return { agent: view(moved), sessionKey: agent.session_key };
  });
  define("jagentchill.agent.handback.list", (params, connection) => {
    const root = rootByParams(params, connection), ids = treeOf(root.id).map((entry) => entry.id);
    const rows = ids.length ? (db.prepare(`SELECT json FROM agent_handbacks WHERE agent_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_ms DESC, id DESC`).all(...ids) as { json: string }[]) : [];
    return { rootId: root.id, handbacks: rows.map((row) => JSON.parse(row.json) as AgentHandback) };
  });
  define("jagentchill.agent.handback.resolve", (params, connection) => {
    const record = handbackById(params.handbackId), sender = record ? byId(record.agentId) : undefined;
    if (!record || !sender) throw new ProtocolError("NOT_FOUND", "No such hand-back.");
    actable(sender.id, connection);
    return { handback: decideHandback(record, params.decision, { kind: "device", id: connection.deviceId }, params.note?.trim() || undefined, "The user") };
  });
  define("jagentchill.agent.policy.get", async (params, connection) => {
    if (!params.sessionKey) return { preset: callPreset() };
    const session = sessions().session(params.sessionKey);
    if (!session || !sessions().canRead(session.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    return { preset: callPreset() };
  });
  define("jagentchill.agent.policy.set", (params, connection) => {
    const before = callPreset();
    deps.config.set("agents.callPreset", params.preset);
    audit(db, now(), `device:${connection.deviceId}`, "agent.policy.set", { category: "security", before, after: params.preset });
    return { preset: callPreset() };
  });
  define("jagentchill.agent.restore", (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (!agent.archived_ms) return { agent: view(agent) };
    if (now() - agent.archived_ms > 30 * 86_400_000) throw new ProtocolError("AGENT_ARCHIVED", "This agent was archived more than 30 days ago and cannot be restored.");
    agent.archived_ms = null;
    save(agent);
    return { agent: view(agent) };
  });
  define("jagentchill.agent.limits.get", () => ({ limits: limits() }));
  define("jagentchill.agent.limits.set", (params, connection) => {
    deps.config.set("agents.limits", agentLimitsSchema.parse(params.limits));
    audit(db, now(), `device:${connection.deviceId}`, "agent.limits.set", params.limits);
    return { limits: limits() };
  });
  define("jagentchill.agent.limits.raise", (params, connection) => {
    const root = rootOf(actable(params.rootId, connection));
    // The extension is for the run in progress (or, without one, for the agents outside runs): the next brief starts with the host's limit again.
    const forRun = runs.activeRunOf(root);
    root.extra.extraTotal = (root.extra.extraFor === forRun ? root.extra.extraTotal ?? 0 : 0) + limits().maxAgentsPerTree;
    if (forRun) root.extra.extraFor = forRun; else delete root.extra.extraFor;
    save(root);
    audit(db, now(), `device:${connection.deviceId}`, "agent.limits.raise", { rootId: root.id, allowed: limits().maxAgentsPerTree + root.extra.extraTotal });
    return { rootId: root.id, maxAgentsPerTree: limits().maxAgentsPerTree + root.extra.extraTotal };
  });
  define("jagentchill.agent.delivery.resume", (params, connection) => {
    const root = rootOf(actable(params.rootId, connection));
    resetGuards(root);
    audit(db, now(), `device:${connection.deviceId}`, "agent.delivery.resume", { rootId: root.id });
    return treeView(byId(root.id)!);
  });
  define("jagentchill.agent.notice.list", (_params, connection) => {
    const notices: AgentNotice[] = [];
    for (const row of db.prepare("SELECT session_key, json FROM agent_notices WHERE resolved_ms IS NULL ORDER BY rowid").all() as { session_key: string; json: string }[]) {
      const notice = JSON.parse(row.json) as AgentNotice;
      if (!noticeWaits(notice)) { resolveNotice(notice.kind, notice.subjectId); continue; }
      if (sessions().canAct(row.session_key, connection)) notices.push(notice);
    }
    return { notices };
  });
  define("jagentchill.agent.budget.set", (params, connection) => {
    const agent = actable(params.agentId, connection);
    if (params.limitUsd === null) delete agent.extra.limitUsd; else agent.extra.limitUsd = params.limitUsd;
    save(agent);
    audit(db, now(), `device:${connection.deviceId}`, "agent.budget.set", { agentId: agent.id, limitUsd: params.limitUsd });
    return { agent: view(agent) };
  });
  define("jagentchill.agent.team.set", (params, connection) => {
    const session = sessions().session(params.sessionKey);
    if (!session || !sessions().canAct(session.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    const root = rootFor(session);
    if (root.depth !== 0) throw new ProtocolError("AGENT_NOT_OWNED", "A team is chosen for a session, not for a sub-agent.");
    if (params.teamId) {
      const chosen = team(params.teamId);
      if (!chosen) throw new ProtocolError("TEAM_NOT_FOUND", "There is no such team.");
      if (!chosen.enabled || !teamsEnabled()) throw new ProtocolError("TEAM_DISABLED", "Teams or this team are turned off in Settings → Agents → Teams.");
      const director = chosen.roles.find((entry) => entry.tier === "supervisor" && entry.enabled);
      root.extra.teamId = chosen.id; root.extra.tier = "supervisor"; root.extra.roleId = director?.roleId; root.extra.roleLabel = director?.label; root.extra.canWrite = director?.contract.canWrite ?? false;
      // The team's cost ceiling is the tree's budget unless the tree already has one.
      if (chosen.limits.maxRunCostUsd !== undefined && root.extra.limitUsd === undefined) root.extra.limitUsd = chosen.limits.maxRunCostUsd;
    } else {
      delete root.extra.teamId; delete root.extra.tier; delete root.extra.roleId; delete root.extra.roleLabel; delete root.extra.canWrite;
    }
    save(root);
    audit(db, now(), `device:${connection.deviceId}`, "agent.team.set", { rootId: root.id, teamId: params.teamId });
    return treeView(root);
  });
  define("jagentchill.orc.team.list", () => ({ enabled: teamsEnabled(), teams: teams().map(summary) }));
  define("jagentchill.orc.team.get", (params) => {
    const row = teamRow(params.teamId);
    if (!row) throw new ProtocolError("TEAM_NOT_FOUND", "This team no longer exists.");
    return { team: JSON.parse(row.json) as Team, template: row.pristine === 1 };
  });
  define("jagentchill.orc.team.save", (params, connection) => {
    const existing = team(params.team.id), problem = teamProblems(params.team);
    if (problem) throw new ProtocolError("INVALID_PARAMS", problem, { details: { path: "team.roles" } });
    if (existing ? existing.rev !== params.team.rev : params.team.rev !== 0) throw new ProtocolError("CONFLICT", "This team was changed on another device. Reload it and apply your change again.", { details: { rev: existing?.rev ?? 0 } });
    const stored = teamSchema.parse({ ...params.team, rev: params.team.rev + 1, created_ms: existing?.created_ms ?? now(), updated_ms: now() });
    db.prepare("INSERT INTO agent_teams (id, json, pristine) VALUES (?, ?, 0) ON CONFLICT (id) DO UPDATE SET json = excluded.json, pristine = 0").run(stored.id, JSON.stringify(stored));
    audit(db, now(), `device:${connection.deviceId}`, "team.save", { teamId: stored.id, rev: stored.rev });
    return { team: stored, template: false };
  });
  define("jagentchill.orc.team.duplicate", (params, connection) => {
    const source = team(params.teamId);
    if (!source) throw new ProtocolError("TEAM_NOT_FOUND", "This team no longer exists.");
    const taken = new Set(teams().map((entry) => entry.team.id));
    let id = `${source.id.slice(0, 34)}-copy`;
    for (let index = 2; taken.has(id); index++) id = `${source.id.slice(0, 32)}-copy${index}`;
    const { templateId: _template, ...rest } = source;
    const copy: Team = { ...rest, id, name: `${source.name.slice(0, 53)} (copy)`, rev: 1, created_ms: now(), updated_ms: now() };
    db.prepare("INSERT INTO agent_teams (id, json, pristine) VALUES (?, ?, 0)").run(copy.id, JSON.stringify(copy));
    audit(db, now(), `device:${connection.deviceId}`, "team.duplicate", { teamId: copy.id, from: source.id });
    return { team: copy, template: false };
  });
  define("jagentchill.orc.team.reset", (params, connection) => {
    const existing = team(params.teamId), shipped = shippedTeams(now()).find((entry) => entry.id === (existing?.templateId ?? params.teamId));
    if (!shipped) throw new ProtocolError("TEAM_NOT_FOUND", "This team has no template to go back to.");
    const stored: Team = { ...shipped, id: params.teamId, rev: (existing?.rev ?? 0) + 1, created_ms: existing?.created_ms ?? now() };
    db.prepare("INSERT INTO agent_teams (id, json, pristine) VALUES (?, ?, 1) ON CONFLICT (id) DO UPDATE SET json = excluded.json, pristine = 1").run(stored.id, JSON.stringify(stored));
    audit(db, now(), `device:${connection.deviceId}`, "team.reset", { teamId: stored.id });
    return { team: stored, template: true };
  });
  define("jagentchill.orc.team.delete", (params, connection) => {
    if (!db.prepare("DELETE FROM agent_teams WHERE id = ?").run(params.teamId).changes) throw new ProtocolError("TEAM_NOT_FOUND", "This team no longer exists.");
    audit(db, now(), `device:${connection.deviceId}`, "team.delete", { teamId: params.teamId });
    return { teamId: params.teamId };
  });

  /** A run or a hand-off of a tree changed: the devices that show it read it again. */
  function changed(rootId: string): void {
    const root = byId(rootId);
    if (root) deps.broadcast("jagentchill.projects.read", "jagentchill.agent.team.changed", `agent:${rootId}`, { rootId }, (connection) => sessions().canRead(root.session_key, connection));
  }
  // — Notifications that wait for a person (`notifications.Notification event catalogue`) —
  db.exec("CREATE TABLE IF NOT EXISTS agent_notices (id TEXT PRIMARY KEY, root_id TEXT NOT NULL, session_key TEXT NOT NULL, json TEXT NOT NULL, resolved_ms INTEGER) STRICT;");
  const announceNotice = (sessionKey: string, notice: AgentNotice): void => { deps.broadcast("jagentchill.agent.use", "jagentchill.agent.notice", `agent:${notice.rootId}`, notice, (connection) => sessions().canAct(sessionKey, connection));; };
  /** The subject of a notification no longer waits for a person: it is closed and every device that got it is told, so none goes on showing it as waiting. */
  function resolveNotice(kind: AgentNotice["kind"], subjectId: string): void {
    const row = db.prepare("SELECT session_key, json FROM agent_notices WHERE id = ? AND resolved_ms IS NULL").get(`${kind}:${subjectId}`) as { session_key: string; json: string } | undefined;
    if (!row) return;
    db.prepare("UPDATE agent_notices SET resolved_ms = ? WHERE id = ?").run(now(), `${kind}:${subjectId}`);
    const { reminder: _reminder, ...notice } = JSON.parse(row.json) as AgentNotice, resolved: AgentNotice = { ...notice, resolved: true, ts_ms: now() };
    audit(db, now(), "server", "agent.notice.resolved", { category: "agent", kind, subjectId, sessionKey: row.session_key, rootId: notice.rootId });
    announceNotice(row.session_key, resolved);
  }
  /** Whether the subject of a notification still waits for a person (asked when a device reads the list: a subject that ended without a decision is closed then). */
  function noticeWaits(notice: AgentNotice): boolean {
    if (notice.kind === "agent.handoff_pending") return handoffs.ofRoot(notice.rootId).some((entry) => entry.id === notice.subjectId && entry.status === "pending");
    return runs.waitsForPerson(notice);
  }
  const kit: TeamKit = {
    db, now, config: deps.config, sessions, timings: deps.timings ?? {}, proposals: deps.proposals, roleTimeoutSeconds: (roleId) => deps.roleTimeoutSeconds?.(roleId),
    // A notification of the catalogue: every device that may act in the session gets it, whatever it has open.
    notifyDevices(sessionKey, notice) {
      // Kept until its subject no longer waits: a device that connects later reads what is open, and every device hears when it is resolved.
      db.prepare("INSERT INTO agent_notices (id, root_id, session_key, json, resolved_ms) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (id) DO UPDATE SET json = excluded.json, resolved_ms = NULL").run(`${notice.kind}:${notice.subjectId}`, notice.rootId, sessionKey, JSON.stringify(notice));
      audit(db, now(), "server", "agent.notice", { category: "agent", ...notice });
      announceNotice(sessionKey, notice);
    },
    resolveNotice,
    byId, bySession, rootFor, rootOf, treeOf, descendants, ownedBelow, ownerOf, owns, save, nameOf, reach, fail, team, teamOfTree, create, stopTree, arm, changed, view,
    tell: (agent, text) => asServer(agent.session_key, () => deliver(agent.session_key, text)).catch(() => false),
    gone(agentIds) { disarm(agentIds); handoffs.agentGone(agentIds); },
    personActed: (root) => resetGuards(root),
    released(rootId) { for (const row of db.prepare("SELECT DISTINCT n.armer_id FROM agent_notifications n JOIN agents a ON a.id = n.armer_id WHERE n.state = 'ready' AND a.root_id = ?").all(rootId) as { armer_id: string }[]) scheduleFlush(row.armer_id, 0); },
    takeBack, carry,
    assertCanTake: (agent) => { assertBudget(agent.session_key); assertActivity(agent); },
    retarget(fromId, toId, agentIds) { for (const id of agentIds) db.prepare("UPDATE OR IGNORE agent_notifications SET armer_id = ? WHERE armer_id = ? AND agent_id = ? AND state IN ('armed', 'ready')").run(toId, fromId, id); },
    readable, actable, rootByParams, define,
  };
  const handoffs = createHandoffs(kit, { leadMoved: (runId, fromId, toId) => runs.leadMoved(runId, fromId, toId) });
  const runs = createRuns(kit);

  // — After a restart of the host (`Agent store durability and restart recovery`) —
  // No turn survives a restart: an agent that was working, starting or waiting is failed with the reason, and whoever
  // armed a notification for it hears of it. Runs that were under way are paused;
  // their members stay armed — they report when the resumed work is handed back.
  {
    const cut = (db.prepare("SELECT * FROM agents WHERE state IN ('creating', 'running', 'waiting') AND archived_ms IS NULL").all() as Row[]).map((row) => read(row)!);
    const held = runs.recover(cut);
    for (const stale of cut) {
      // Read again: recovering the runs disposed of the members of runs that had ended, and what was read before must not undo that.
      const agent = byId(stale.id);
      if (!agent || agent.archived_ms || !ACTIVE.includes(agent.state)) continue;
      agent.state = "failed"; agent.waiting_reason = null; agent.attention = "error"; agent.finished_ms = now();
      agent.extra.result = { outcome: "failed", summary: "", artefacts: [], lastMessage: "", usage: usageOf([agent.session_key]), ended_ms: now(), error: RESTART_NOTE };
      save(agent, true);
      if (!held.has(agent.id)) settled(agent, "failed", `restart:${now()}`, true);
    }
    if (cut.length) audit(db, now(), "server", "agent.restart.reconcile", { category: "agent", interrupted: cut.length, held: held.size });
  }

  /** What the relay asks before EVERY turn it starts: the budgets, and that no model change of the agent is still being applied (this service's own deliveries have waited for it; anybody else's turn is refused for that moment). */
  function beforeTurn(sessionKey: string): void {
    const agent = bySession(sessionKey);
    if (agent && applying.has(agent.id)) throw new ProtocolError("AGENT_BUSY", `"${agent.title}" is being moved to another model. Send again in a moment.`, { retryable: true, details: { agentId: agent.id, reason: "model-change" } });
    assertBudget(sessionKey);
  }
  return {
    methods, assertBudget: beforeTurn, turnStarted, turnEnded, writerGate, writerWaitMs,
    /** The agent of a session by the name of its own, when it has one: a member's title ("Editor A"), a root agent's role label. A plain session's agent has none (its session's title names the conversation, not the agent). */
    agentName: (sessionKey: string): string | undefined => { const agent = bySession(sessionKey); return !agent ? undefined : agent.depth > 0 ? agent.title || undefined : agent.extra.roleLabel || undefined; },
    /**
     * A delivery of the server itself into a session. The tools service makes exactly one through here for every
     * proposal it resolved — after the proposal is closed and audited — which is how this service learns of a person's
     * decision at the moment it is taken: an agent review still open on that proposal is reconciled before the message goes.
     */
    asServer<T>(sessionKey: string, run: () => Promise<T>): Promise<T> { try { runs.proposalResolved(sessionKey); } catch (error) { console.error(`[agents] proposal review not reconciled: ${error instanceof Error ? error.message : error}`); } return asServer(sessionKey, run); },
    /** Who accepts a proposal a member of a team submitted: the team's policy, raised to the host minimum; undefined when the session's mode decides. */
    proposalApproval: (session: SessionRecord): "human" | "auto" | undefined => runs.proposalApproval(session),
    /** Test and shutdown: the agent reviews of proposals that were just submitted are started now. */
    settleProposalReviews: (): Promise<void> => runs.settleProposalReviews(),
    /** What the `jc_agent_*` and `jc_team_*` tools call, with the calling session. */
    tools: {
      status, list, catalog, activity,
      // Everything else changes something — an agent, a hand-off, a run, a review — or keeps the turn going: none of it is taken from a turn its agent ended by handing back.
      create: inTurn(create), send: inTurn(send), wait: inTurn(wait), cancel: inTurn(cancel), handback: inTurn(handback), handbackRespond: inTurn(handbackRespond), archive: inTurn(archive), update: inTurn(update), setMode: inTurn(setMode), setModel: inTurn(setModel),
      handoff: inTurn(handoffs.handoff), handoffRespond: inTurn(handoffs.respond), bootstrapLead: inTurn(runs.bootstrapLead), createPeer: inTurn(runs.createPeer), acceptResult: inTurn(runs.acceptResult), reviewSubmit: inTurn(runs.submitReview), resolveDissent: inTurn(runs.resolveDissent),
    },
    /** The session a person's message in a session is delivered to: another agent's, once a conversation hand-off gave it the lead. */
    answeringSession: (sessionKey: string): string | undefined => handoffs.answeringSession(sessionKey),
    /** The record of a session's agent, as devices read it. */
    recordOf: (sessionKey: string): AgentRecord | undefined => { const agent = bySession(sessionKey); return agent && view(agent); },
    /** A fork holds its source's conversation: a source that had read content from outside makes a fork that has, with the same text kept. */
    sessionForked(sourceKey: string, forkKey: string): void { if (deps.taint?.is(sourceKey)) deps.taint.mark(forkKey, `fork:${sourceKey}`, retained(sourceKey)); },
    /** A session is gone: its agent and everything below it leave the lists. */
    sessionDeleted(sessionKey: string): void {
      const agent = bySession(sessionKey);
      if (!agent) return;
      const all = [agent, ...descendants(agent)];
      disarm(all.map((entry) => entry.id));
      for (const entry of all) { entry.archived_ms = now(); if (entry.state !== "closed") entry.state = "closed"; save(entry, entry.depth === 0); wake(entry.id); }
    },
    /** Results that were ready when the server stopped are delivered once it runs again. */
    start(): void {
      for (const row of db.prepare("SELECT DISTINCT armer_id FROM agent_notifications WHERE state = 'ready'").all() as { armer_id: string }[]) scheduleFlush(row.armer_id, 0);
      runs.start();
    },
    /** Test and shutdown: the members of runs that ended are disposed of without waiting out their minute. */
    settleDisposals: (): Promise<void> => runs.settleDisposals(),
    close(): void { clearInterval(handbackSweep); handoffs.close(); runs.close(); for (const timer of [...flushTimers.values(), ...usageTimers]) clearTimeout(timer); flushTimers.clear(); usageTimers.clear(); for (const set of waiters.values()) for (const resolve of set) resolve(); waiters.clear(); },
  };
}
/** What the parts of the service that live in their own files (hand-offs, team runs) use of it. */
export type TeamKit = {
  db: DatabaseSync; now: () => number; config: ServerConfigFile; sessions: () => TeamSessions; timings: NonNullable<AgentTeamDeps["timings"]>;
  proposals: AgentTeamDeps["proposals"]; roleTimeoutSeconds(roleId: string): number | undefined; notifyDevices(sessionKey: string, notice: AgentNotice): void; resolveNotice(kind: AgentNotice["kind"], subjectId: string): void;
  byId(id: string): Agent | undefined; bySession(key: string): Agent | undefined; rootFor(session: SessionRecord): Agent; rootOf(agent: Agent): Agent;
  treeOf(rootId: string): Agent[]; descendants(agent: Agent, tree?: Agent[]): Agent[]; ownerOf(agent: Agent): string | null; owns(caller: Agent, agent: Agent, tree?: Agent[]): boolean;
  save(agent: Agent, quiet?: boolean): Agent; nameOf(agent: Agent): string; view(agent: Agent, tree?: Agent[]): AgentRecord;
  reach(caller: Agent, agentId: string, verb: Verb): Agent;
  ownedBelow(agent: Agent, tree?: Agent[]): Agent[];
  fail(code: ErrorCode, message: string, details?: Record<string, unknown>): never;
  team(id: string | undefined): Team | undefined; teamOfTree(root: Agent | undefined): Team | undefined;
  create(session: SessionRecord, input: CreateInput): Promise<Record<string, unknown>>;
  stopTree(target: Agent, options?: { close?: boolean; includeSelf?: boolean }): Promise<number>;
  arm(armer: Agent, agent: Agent, grant?: "full" | "identity"): unknown;
  /** Agents that take no more work: nobody waits for them and what they had offered is withdrawn. */
  gone(agentIds: string[]): void;
  /** A person acted in a tree (started a run): its loop counters start again, as for a prompt of theirs. */
  personActed(root: Agent): void;
  /** A tree's deliveries are no longer held: what waited for its agents goes out. */
  released(rootId: string): void;
  /** A message of the server to an agent: it opens a turn (or follows the running one) that is nobody's prompt. */
  tell(agent: Agent, text: string): Promise<boolean>;
  /** Stops a turn the server itself started and takes back: its end is reported to nobody. False when the agent engine did not take the stop. */
  takeBack(agent: Agent, silentAnyway?: boolean): Promise<boolean>;
  /** Content of `from` reaches `to`: the taint of `from`'s session, and the untrusted text kept for it, go along. Whether the mark travelled. */
  carry(from: Agent | undefined, to: Agent | undefined): boolean;
  /** Refuses when the agent's budget or the tree's turn ceiling is spent. */
  assertCanTake(agent: Agent): void;
  /** Whoever waited for `agentIds` as `fromId` is `toId` from here on. */
  retarget(fromId: string, toId: string, agentIds: string[]): void;
  changed(rootId: string): void;
  readable(agentId: string, connection: Connection): Agent; actable(agentId: string, connection: Connection): Agent;
  rootByParams(params: { rootId?: string; agentId?: string; sessionKey?: string }, connection: Connection): Agent;
  define<M extends AgentTeamMethod>(name: M, handle: (params: z.infer<(typeof agentTeamRpcParams)[M]>, connection: Connection) => unknown | Promise<unknown>): void;
};
export type AgentTeamService = ReturnType<typeof createAgentTeamService>;
export type AgentTools = AgentTeamService["tools"];
