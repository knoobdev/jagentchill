/**
 * Hand-offs (`Hand-off verb`, `Hand-off acceptance and rejection`, `Hand-off effects on ownership and lead`): one agent
 * passes the lead of a piece of work to another, with a context package. The receiver — or a person, from the card —
 * accepts or rejects; on acceptance the ownership moves in one transaction and the trail is written to the audit log.
 *
 * Scopes: `task`, `lead` and `conversation`. The receiver is an agent of the sender's tree, or is created by the
 * hand-off (`to: {title, role?}`) under every check of `jc_agent_create`.
 *
 * `conversation` passes on who answers the PERSON in the session: it is always the person's decision — no agent, the
 * receiver included, accepts it — and once accepted what the person writes in the session goes to the receiver's
 * session (`answeringSession`, asked by the relay before every message) until they take the conversation back.
 */
import { createHash } from "node:crypto";
import { HANDOFF_LIMITS, type AgentHandoff, type HandoffPackage, type HandoffScope } from "@jagentchill/protocol";
import { ProtocolError } from "../../errors.ts";
import { audit } from "../../store/database.ts";
import type { SessionRecord } from "../sessions.ts";
import { newAgentId, type Agent, type TeamKit } from "./service.ts";

type Json = Record<string, unknown>;
const MODES: readonly string[] = ["ask", "plan", "edit", "auto"];
type Row = { id: string; root_id: string; json: string };
type Actor = { kind: "agent" | "device" | "system"; id: string };
export type HandoffInput = { to: string | { title: string; role?: string }; scope: HandoffScope; package: HandoffPackage; writer?: boolean; reason?: string; expires_ms?: number };

/** The package as its receiver reads it. */
function packageText(record: AgentHandoff): string {
  const pack = record.package, list = (title: string, lines: string[]) => (lines.length ? [`${title}:`, ...lines.map((line) => `- ${line}`)] : []);
  return [
    `Hand-off from "${record.fromTitle}" (${record.scope === "lead" ? "the lead of its work and of its agents" : record.scope === "conversation" ? "the conversation with the user" : "one task"}). This message is from the server, not from the user.`,
    `handoffId: ${record.id}`, "", "Brief:", pack.brief, "", "What was tried and decided:", pack.historySummary,
    ...list("Open questions", pack.openQuestions), ...list("Acceptance criteria", pack.acceptanceCriteria),
    ...list("Artefacts", pack.artefacts.map((entry) => `${entry.kind} ${entry.id} — ${entry.title}${entry.note ? ` (${entry.note})` : ""}`)),
    ...(pack.dueHint ? [`Due: ${pack.dueHint}`] : []), ...(record.writer ? ["With it comes the write assignment on the project."] : []), "",
    record.scope === "conversation"
      ? `The user decides on this hand-off; there is nothing for you to answer. If they accept, their next messages in the session come to you and you answer them yourself. Until then "${record.fromTitle}" keeps the conversation. You may decline with jc_agent_handoff_respond {handoffId: "${record.id}", decision: "reject", note}.`
      : record.decision === "human"
        ? `The user decides on this hand-off, because you may do more in this project than "${record.fromTitle}" may; there is nothing for you to answer. You are told if they accept; until then the work stays with "${record.fromTitle}". You may decline with jc_agent_handoff_respond {handoffId: "${record.id}", decision: "reject", note}.`
        : `Answer with jc_agent_handoff_respond {handoffId: "${record.id}", decision: "accept"} or {decision: "reject", note}. Until you accept, the work stays with "${record.fromTitle}".`,
  ].join("\n");
}

export function createHandoffs(kit: TeamKit, hooks: { leadMoved(runId: string, fromId: string, toId: string): void }) {
  const { db, fail } = kit;
  db.exec("CREATE TABLE IF NOT EXISTS agent_handoffs (id TEXT PRIMARY KEY, root_id TEXT NOT NULL, json TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT; CREATE INDEX IF NOT EXISTS agent_handoffs_root ON agent_handoffs (root_id);");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const byId = (id: string): AgentHandoff | undefined => { const row = db.prepare("SELECT json FROM agent_handoffs WHERE id = ?").get(id) as Row | undefined; return row ? (JSON.parse(row.json) as AgentHandoff) : undefined; };
  const ofRoot = (rootId: string): AgentHandoff[] => (db.prepare("SELECT json FROM agent_handoffs WHERE root_id = ? ORDER BY created_ms DESC, id DESC").all(rootId) as Row[]).map((row) => JSON.parse(row.json) as AgentHandoff);
  const digest = (pack: HandoffPackage) => createHash("sha256").update(JSON.stringify(pack)).digest("hex");
  function store(record: AgentHandoff, action: string, actor: Actor, extra: Json = {}): void {
    db.prepare("INSERT INTO agent_handoffs (id, root_id, json, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json").run(record.id, record.rootId, JSON.stringify(record), record.created_ms);
    // The trail: one row per change of state, never edited; the package itself stays on the record.
    audit(db, kit.now(), `${actor.kind}:${actor.id}`, "agent.handoff", { category: "agent", kind: "handoff", recordId: record.id, action, fromAgentId: record.fromAgentId, toAgentId: record.toAgentId, scope: record.scope, actor, rootId: record.rootId, packageDigest: digest(record.package), ...extra });
    if (record.status !== "pending") kit.resolveNotice("agent.handoff_pending", record.id);
    kit.changed(record.rootId);
  }
  function expire(id: string): void {
    timers.delete(id);
    const record = byId(id);
    if (!record || record.status !== "pending") return;
    close(record, "expired", { kind: "system", id: "expiry" });
  }
  function watch(record: AgentHandoff): void {
    const timer = setTimeout(() => expire(record.id), Math.max(0, record.expires_ms - kit.now()));
    timer.unref?.();
    timers.set(record.id, timer);
  }
  // Hand-offs that were pending when the server stopped expire on time all the same.
  for (const row of db.prepare("SELECT json FROM agent_handoffs").all() as Row[]) { const record = JSON.parse(row.json) as AgentHandoff; if (record.status === "pending") watch(record); }

  /** Ends a pending hand-off without moving anything. */
  function close(record: AgentHandoff, status: "rejected" | "cancelled" | "expired", actor: Actor, note?: string): AgentHandoff {
    const timer = timers.get(record.id);
    if (timer) { clearTimeout(timer); timers.delete(record.id); }
    const next: AgentHandoff = { ...record, status, decidedBy: actor, decided_ms: kit.now(), ...(note ? { note } : {}) };
    store(next, status, actor);
    const sender = kit.byId(record.fromAgentId);
    if (sender && sender.extra.handoff === "handed_off") { delete sender.extra.handoff; kit.save(sender); }
    settleAttention(record.rootId);
    return next;
  }
  /** The session shows "needs you" for hand-offs exactly while one of them waits for a person. */
  function settleAttention(rootId: string): void {
    const root = kit.byId(rootId), waiting = ofRoot(rootId).some((entry) => entry.status === "pending" && entry.decision === "human");
    if (!root) return;
    if (waiting && root.attention === "none") { root.attention = "handoff"; kit.save(root); }
    else if (!waiting && root.attention === "handoff") { root.attention = "none"; kit.save(root); }
  }
  /** Who answers the person in a tree's session: the agent a conversation hand-off gave it to, else the session's own agent. */
  const leadOf = (root: Agent): Agent => { const lead = root.extra.answering ? kit.byId(root.extra.answering.agentId) : undefined; return lead && !lead.archived_ms && lead.state !== "closed" && lead.root_id === root.id ? lead : root; };

  async function handoff(session: SessionRecord, input: HandoffInput): Promise<Json> {
    const sender = kit.rootFor(session), conversation = input.scope === "conversation";
    for (const field of ["brief", "historySummary"] as const) {
      if (input.package[field].length > HANDOFF_LIMITS[field]) fail("INVALID_PARAMS", `package.${field} is at most ${HANDOFF_LIMITS[field].toLocaleString("en-US")} characters; got ${input.package[field].length.toLocaleString("en-US")}. Summarise it.`, { field: `package.${field}` });
    }
    const root = kit.byId(sender.root_id)!, owner = kit.ownerOf(sender);
    // An agent that reports to nobody answers to the person: its work has nobody else to report to. What it CAN pass on is the conversation itself, which the person decides.
    if (!conversation && (sender.depth === 0 || !owner)) fail("HANDOFF_TARGET_INVALID", "The session's own agent cannot give its work away: it answers to the user. Create a sub-agent with jc_agent_create instead — or offer the conversation itself with scope \"conversation\", which the user decides.", { scope: input.scope });
    if (ofRoot(sender.root_id).some((entry) => entry.status === "pending" && entry.fromAgentId === sender.id && entry.scope === input.scope)) fail("CONFLICT", "You already have a hand-off of this scope waiting for an answer. Wait for it, or cancel it with jc_agent_handoff_respond {decision: \"cancel\"}.");
    const now = kit.now(), id = `hof_${newAgentId(now).slice(4)}`;
    const pack: HandoffPackage = { brief: input.package.brief, historySummary: input.package.historySummary, artefacts: input.package.artefacts ?? [], openQuestions: input.package.openQuestions ?? [], acceptanceCriteria: input.package.acceptanceCriteria ?? [], ...(input.package.dueHint ? { dueHint: input.package.dueHint } : {}) };
    const draft = (toAgentId: string, toTitle: string, raises = false): AgentHandoff => ({
      id, rootId: sender.root_id, fromAgentId: sender.id, fromTitle: kit.nameOf(sender), toAgentId, toTitle, scope: input.scope, package: pack, writer: !conversation && input.writer === true, ...(input.reason ? { reason: input.reason } : {}),
      status: "pending", decision: conversation || raises ? "human" : "agent", ...(raises ? { raisesPermission: true } : {}), created_ms: now, expires_ms: now + (input.expires_ms ?? HANDOFF_LIMITS.defaultExpiry_ms),
    });
    // What the sender may do is the ceiling of what it can pass on by itself: work that goes to an agent that may do
    // more (a higher mode, or unattended use the sender was not granted) is a person's decision, never the receiver's.
    const rank = (key: string) => { const record = kit.sessions().session(key); return record ? MODES.indexOf(record.modeId) + (record.unattended ? MODES.length : 0) : -1; };
    let receiver: Agent, record: AgentHandoff;
    if (typeof input.to === "string") {
      // Any agent of the same session can be offered the work; it is the receiver, or a person, who decides.
      receiver = kit.reach(sender, input.to, "handoff");
      if (receiver.id === sender.id) fail("HANDOFF_TARGET_INVALID", "An agent cannot hand work off to itself.", { agentId: receiver.id });
      if (receiver.archived_ms) fail("AGENT_ARCHIVED", `"${receiver.title}" is archived.`, { agentId: receiver.id });
      if (receiver.state === "closed") fail("AGENT_CLOSED", `"${receiver.title}" is closed and cannot take work.`, { agentId: receiver.id });
      if (conversation) {
        if (receiver.id === leadOf(root).id) fail("HANDOFF_TARGET_INVALID", `"${kit.nameOf(receiver)}" already answers the user in this conversation.`, { agentId: receiver.id });
      } else {
        if (receiver.depth === 0 || receiver.id === owner) fail("HANDOFF_TARGET_INVALID", "Work goes back to the agent you report to with jc_agent_handback, not with a hand-off.", { agentId: receiver.id });
        if (input.scope === "lead" && kit.owns(sender, receiver)) fail("HANDOFF_TARGET_INVALID", "The lead cannot pass to an agent that you own: it would own itself. Hand the lead to an agent beside you.", { agentId: receiver.id });
        if (input.writer && sender.extra.canWrite !== undefined && receiver.extra.canWrite === false) fail("TEAM_ROLE_DENIED", `The ${receiver.extra.roleLabel ?? "receiver's"} role does not edit the project, so it cannot be given the write assignment.`, { agentId: receiver.id });
        if (input.writer && !sender.extra.grantsWrite && sender.extra.canWrite !== undefined) fail("WRITER_HELD", "You do not hold the write assignment, so you cannot pass it on.", { reason: "not_assigned" });
      }
      kit.assertCanTake(receiver);
      record = draft(receiver.id, kit.nameOf(receiver), !conversation && rank(receiver.session_key) > rank(sender.session_key));
      store(record, "created", { kind: "agent", id: sender.id });
      watch(record);
      // The package is the sender's text: what the sender had read from outside, the receiver reads with it.
      kit.carry(sender, receiver);
      if (!(await kit.tell(receiver, packageText(record)))) {
        close(record, "cancelled", { kind: "system", id: "undelivered" });
        fail("UNAVAILABLE", `The hand-off could not be delivered to "${receiver.title}" right now. Try again.`, { agentId: receiver.id });
      }
    } else {
      // The receiver does not exist yet: it is created beside the sender — as a child of the agent the sender reports to, or
      // of the sender itself when it reports to nobody — under every check of jc_agent_create, with the package as its
      // first message. A creation that fails leaves no hand-off behind.
      const parent = owner ? kit.byId(owner) : sender, parentSession = parent ? kit.sessions().session(parent.session_key) : undefined;
      if (!parent || !parentSession) return fail("HANDOFF_TARGET_INVALID", "The agent you report to no longer exists, so no receiver can be created beside you. Name an existing agent in to.", {});
      // It is created FOR the sender: beside it, and with no more than the sender has (`ceilingOf`) — the mode, the budget and the grants of the agent the sender reports to are not the sender's to give.
      const made = await kit.create(parentSession, { title: input.to.title, ...(input.to.role ? { role: input.to.role } : {}), prompt: packageText(draft("", input.to.title)), wait: "none", ...(parent.id !== sender.id ? { ceilingOf: sender.id } : {}) });
      receiver = kit.byId(String(made.agentId))!;
      if (made.state === "failed") fail("UNAVAILABLE", `"${input.to.title}" could not be started, so nothing was handed off. Try again.`, { agentId: receiver.id });
      record = { ...draft(receiver.id, receiver.title), createdReceiver: true };
      store(record, "created", { kind: "agent", id: sender.id });
      watch(record);
    }
    const fresh = kit.byId(sender.id)!;
    fresh.extra.handoff = "handed_off";
    kit.save(fresh);
    // The session asks for the person's attention; the hand-off card in its conversation says who asks what.
    if (record.decision === "human") {
      settleAttention(record.rootId);
      // One `agent.handoff_pending` notification when a hand-off that a person decides becomes pending (`Hand-off acceptance and rejection`); one the receiving agent decides raises none.
      kit.notifyDevices(root.session_key, { kind: "agent.handoff_pending", sessionKey: root.session_key, rootId: root.id, subjectId: record.id, from: record.fromTitle, to: record.toTitle, title: record.scope, ts_ms: kit.now() });
    }
    return {
      handoffId: record.id, status: "pending", to: receiver.id, expires_ms: record.expires_ms, ...(record.createdReceiver ? { created: true } : {}),
      ...(record.raisesPermission ? { decision: "human" } : {}),
      guidance: record.raisesPermission ? `"${record.toTitle}" may do more in this project than you may, so the user decides on this hand-off. The work stays yours until they accept; end your turn or go on with other work.` : conversation ? `The user decides whether "${record.toTitle}" takes this conversation over. Tell the user in one sentence why, then end your turn; you keep the conversation until they accept.` : `The work stays yours until "${record.toTitle}" accepts. You are told its answer; end your turn or go on with other work.`,
    };
  }

  /** Acceptance: who reports to whom changes in one transaction. */
  function accept(record: AgentHandoff, actor: Actor): AgentHandoff {
    const sender = kit.byId(record.fromAgentId), receiver = kit.byId(record.toAgentId);
    if (!sender || !receiver || receiver.archived_ms || receiver.state === "closed") { close(record, "cancelled", { kind: "system", id: "agent-gone" }); return fail("HANDOFF_NOT_PENDING", "One of the two agents is gone; the hand-off was cancelled."); }
    if (record.scope === "conversation") return acceptConversation(record, sender, receiver, actor);
    const owner = kit.ownerOf(sender)!, tree = kit.treeOf(record.rootId);
    const moved = record.scope === "lead" ? tree.filter((entry) => kit.ownerOf(entry) === sender.id && entry.id !== receiver.id).map((entry) => entry.id) : [];
    const before = { [receiver.id]: kit.ownerOf(receiver), ...Object.fromEntries(moved.map((id) => [id, sender.id])) };
    db.exec("BEGIN");
    try {
      // The receiver reports to whoever the sender reported to; the lineage of creation (parentId) never changes.
      receiver.extra.ownerId = owner;
      receiver.extra.handoff = "received";
      if (record.scope === "lead") {
        for (const id of moved) { const agent = kit.byId(id)!; agent.extra.ownerId = receiver.id; kit.save(agent, true); }
        kit.retarget(sender.id, receiver.id, moved);
        if (sender.extra.tier && sender.extra.tier !== receiver.extra.tier) {
          const tier = sender.extra.tier, role = { roleId: sender.extra.roleId, roleLabel: sender.extra.roleLabel };
          sender.extra.tier = receiver.extra.tier; sender.extra.roleId = receiver.extra.roleId; sender.extra.roleLabel = receiver.extra.roleLabel;
          receiver.extra.tier = tier; receiver.extra.roleId = role.roleId; receiver.extra.roleLabel = role.roleLabel;
        }
        if (sender.extra.runId) hooks.leadMoved(sender.extra.runId, sender.id, receiver.id);
      }
      if (record.writer) { sender.extra.grantsWrite = false; receiver.extra.grantsWrite = true; }
      sender.extra.handoff = "handed_off";
      kit.save(sender, true); kit.save(receiver, true);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const ownerAgent = kit.byId(owner);
    if (ownerAgent) kit.arm(ownerAgent, receiver);
    const timer = timers.get(record.id);
    if (timer) { clearTimeout(timer); timers.delete(record.id); }
    const next: AgentHandoff = { ...record, status: "accepted", decidedBy: actor, decided_ms: kit.now() };
    for (const id of [sender.id, receiver.id, ...moved]) { const agent = kit.byId(id); if (agent) kit.save(agent); }
    store(next, "accepted", actor, { ownershipBefore: before, ownershipAfter: { [receiver.id]: owner, ...Object.fromEntries(moved.map((id) => [id, receiver.id])) }, writerMoved: record.writer });
    if (record.decision === "human") settleAttention(record.rootId);
    return next;
  }

  /** A person let another agent lead the conversation: what they write in the session goes to it from here on. Nobody's ownership changes. */
  function acceptConversation(record: AgentHandoff, sender: Agent, receiver: Agent, actor: Actor): AgentHandoff {
    const root = kit.byId(record.rootId)!, before = leadOf(root);
    if (receiver.id === root.id) delete root.extra.answering;
    else root.extra.answering = { agentId: receiver.id, handoffId: record.id, since_ms: kit.now(), ...(before.id !== root.id ? { previousAgentId: before.id } : {}) };
    kit.save(root, true);
    // (Either of the two may be the session's own agent: its record is the one just written.)
    const from = sender.id === root.id ? root : sender, to = receiver.id === root.id ? root : receiver;
    from.extra.handoff = "handed_off"; to.extra.handoff = "received";
    kit.save(from, true); kit.save(to, true);
    // The receiver's turns are answers to the person from here on, not results somebody waits for: its creator is not woken when one ends.
    db.prepare("DELETE FROM agent_notifications WHERE agent_id = ? AND state = 'armed'").run(receiver.id);
    const timer = timers.get(record.id);
    if (timer) { clearTimeout(timer); timers.delete(record.id); }
    const next: AgentHandoff = { ...record, status: "accepted", decidedBy: actor, decided_ms: kit.now() };
    store(next, "accepted", actor, { answeringBefore: before.id, answeringAfter: receiver.id });
    settleAttention(record.rootId);
    for (const agent of [sender, receiver, root]) { const fresh = kit.byId(agent.id); if (fresh) kit.save(fresh); }
    return next;
  }
  /** The person takes the conversation back from the agent that leads it: whoever led before answers again. */
  function returnConversation(root: Agent, deviceId: string): Agent {
    const lead = leadOf(root), answering = root.extra.answering;
    if (!answering || lead.id === root.id) return fail("CONFLICT", "The session's own agent already answers in this conversation.", {});
    const previous = answering.previousAgentId ? kit.byId(answering.previousAgentId) : undefined, back = previous && !previous.archived_ms && previous.state !== "closed" && previous.root_id === root.id ? previous : root;
    if (back.id === root.id) delete root.extra.answering;
    else root.extra.answering = { agentId: back.id, handoffId: answering.handoffId, since_ms: kit.now() };
    kit.save(root);
    audit(db, kit.now(), `device:${deviceId}`, "agent.handoff", { category: "agent", kind: "handoff", recordId: answering.handoffId, action: "returned", fromAgentId: lead.id, toAgentId: back.id, scope: "conversation", actor: { kind: "device", id: deviceId }, rootId: root.id });
    kit.changed(root.id);
    // An agent in the middle of a turn hears it after its current step; one that rests is not woken for it.
    if (kit.sessions().isRunning(lead.session_key)) void kit.tell(lead, `The user took this conversation back: "${kit.nameOf(back)}" answers them again. This message is from the server, not from the user. Finish what you are doing and end your turn.`);
    return back;
  }

  function decide(record: AgentHandoff, decision: "accept" | "reject" | "cancel", actor: Actor, note?: string): AgentHandoff {
    if (record.status !== "pending") fail("HANDOFF_NOT_PENDING", `This hand-off was already ${record.status}.`, { status: record.status });
    if (record.expires_ms <= kit.now()) { close(record, "expired", { kind: "system", id: "expiry" }); fail("HANDOFF_NOT_PENDING", "This hand-off expired.", { status: "expired" }); }
    if (decision === "accept") return accept(record, actor);
    const next = close(record, decision === "reject" ? "rejected" : "cancelled", actor, note);
    const told = kit.byId(decision === "reject" ? record.fromAgentId : record.toAgentId);
    if (told && !told.archived_ms && told.state !== "closed") {
      // A rejection's note is the receiver's text: what the receiver had read from outside, the sender reads with it (a person's note carries nothing).
      if (decision === "reject" && actor.kind === "agent") kit.carry(kit.byId(actor.id), told);
      void kit.tell(told, decision === "reject"
        ? `"${record.toTitle}" rejected your hand-off ${record.id}. This message is from the server, not from the user.\nNote: ${note ?? ""}\nThe work is still yours.`
        : `"${record.fromTitle}" cancelled its hand-off ${record.id}. This message is from the server, not from the user. Nothing changed for you.`);
    }
    return next;
  }

  function respond(session: SessionRecord, input: { handoffId: string; decision: "accept" | "reject" | "cancel"; note?: string }): Json {
    const caller = kit.rootFor(session), record = byId(input.handoffId);
    if (!record || record.rootId !== caller.root_id) return fail("HANDOFF_NOT_FOUND", `There is no hand-off ${input.handoffId} in this session.`, { handoffId: input.handoffId });
    // The receiver accepts or rejects, the sender cancels: nobody else decides for them.
    const allowed = input.decision === "cancel" ? record.fromAgentId : record.toAgentId;
    if (caller.id !== allowed) fail("AGENT_NOT_OWNED", input.decision === "cancel" ? "Only the agent that made a hand-off cancels it." : "Only the agent a hand-off was made to accepts or rejects it.", { handoffId: record.id });
    if (input.decision === "reject" && !input.note?.trim()) fail("INVALID_PARAMS", "Say in note why you reject the hand-off, so the sender knows what is missing.", { field: "note" });
    // Who answers the person is the person's decision: the receiver's "accept" changes nothing, whatever it answers.
    if (record.decision === "human" && input.decision === "accept") {
      if (record.status !== "pending") fail("HANDOFF_NOT_PENDING", `This hand-off was already ${record.status}.`, { status: record.status });
      return { handoffId: record.id, status: "pending", guidance: record.scope === "conversation" ? "A hand-off of the conversation is decided by the user, not by you. There is nothing more to do; you are told if they accept." : "This hand-off is decided by the user, not by you: it would give the work to an agent that may do more than its sender. There is nothing more to do; you are told if they accept." };
    }
    const next = decide(record, input.decision, { kind: "agent", id: caller.id }, input.note?.trim());
    return { handoffId: next.id, status: next.status, ...(next.status === "accepted" ? { guidance: record.scope === "lead" ? "The work and the agents under it are yours now. You report to the agent the sender reported to: return the result with jc_agent_handback." : "The task is yours now. Return the result with jc_agent_handback." } : {}) };
  }

  kit.define("jagentchill.agent.handoff.list", (params, connection) => { const root = kit.rootByParams(params, connection); return { rootId: root.id, handoffs: ofRoot(root.id) }; });
  kit.define("jagentchill.agent.handoff.resolve", (params, connection) => {
    const record = byId(params.handoffId);
    if (!record) throw new ProtocolError("HANDOFF_NOT_FOUND", "No such hand-off.");
    kit.actable(record.rootId, connection);
    if (params.decision === "reject" && !params.note?.trim()) throw new ProtocolError("INVALID_PARAMS", "Say why the hand-off is rejected.", { details: { field: "note" } });
    const next = decide(record, params.decision, { kind: "device", id: connection.deviceId }, params.note?.trim());
    if (next.status === "accepted") {
      const receiver = kit.byId(next.toAgentId);
      if (receiver && next.scope === "conversation") {
        if (receiver.depth > 0) void kit.tell(receiver, `The user accepted the hand-off ${next.id}: you lead this conversation now. This message is from the server, not from the user.\nFrom here on what the user writes in the session comes to you, and you answer the user yourself — in plain words, as their contact. Start by telling them in one or two sentences what you take over and what you will do next.`);
        const sender = kit.byId(next.fromAgentId);
        if (sender && kit.sessions().isRunning(sender.session_key)) void kit.tell(sender, `The user accepted your hand-off ${next.id}: "${next.toTitle}" answers them from here on. This message is from the server, not from the user. End your turn.`);
      } else if (receiver) void kit.tell(receiver, `The user accepted the hand-off ${next.id} for you. This message is from the server.\nThe ${next.scope === "lead" ? "work and the agents under it are" : "task is"} yours now: go on with it and return the result with jc_agent_handback.`);
    }
    return { handoff: next };
  });
  kit.define("jagentchill.agent.conversation.return", (params, connection) => {
    const session = kit.sessions().session(params.sessionKey);
    if (!session || !kit.sessions().canAct(session.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    const root = kit.rootOf(kit.rootFor(session)), back = returnConversation(root, connection.deviceId);
    return { rootId: root.id, answering: back.id === root.id ? null : back.id };
  });

  return {
    handoff, respond, ofRoot,
    /** The session a person's message in `sessionKey` goes to: the session of the agent that leads the conversation, when a hand-off gave it to one. */
    answeringSession(sessionKey: string): string | undefined {
      const root = kit.bySession(sessionKey);
      if (!root || root.depth !== 0 || !root.extra.answering) return undefined;
      const lead = leadOf(root);
      return lead.id === root.id ? undefined : lead.session_key;
    },
    /** Agents that were archived, closed or detached: what they had pending is cancelled. */
    agentGone(agentIds: string[]): void {
      const gone = new Set(agentIds);
      // An agent that led a conversation and is gone leads it no longer: the session's own agent answers again, and the person is told.
      for (const id of agentIds) {
        const agent = kit.byId(id), root = agent ? kit.byId(agent.root_id) : undefined;
        if (!agent || !root || root.id === agent.id || root.extra.answering?.agentId !== id) continue;
        delete root.extra.answering;
        kit.save(root);
        kit.sessions().notify(root.session_key, "jagentchill.chat.notice", { sessionKey: root.session_key, code: "agent-conversation-returned", message: "The agent that led this conversation is gone. The main agent answers again.", ts_ms: kit.now() });
      }
      for (const row of db.prepare("SELECT json FROM agent_handoffs").all() as Row[]) {
        const record = JSON.parse(row.json) as AgentHandoff;
        if (record.status === "pending" && (gone.has(record.fromAgentId) || gone.has(record.toAgentId))) close(record, "cancelled", { kind: "system", id: "agent-gone" });
      }
    },
    close(): void { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}
