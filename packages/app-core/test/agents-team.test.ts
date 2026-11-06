import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRecord } from "@jagentchill/protocol";
import { agentCost, assignmentOf, parseAgentNotification, agentPill, agentRoleLine, agentTokens, applyAgentEvent, agentElapsed, subAgentsOf, treeTotals, type AgentTree } from "../src/agents/team.ts";

const agent = (id: string, over: Partial<AgentRecord> = {}): AgentRecord => ({
  id, sessionKey: `s:${id}`, title: id, origin: "agent", rootId: "R", depth: 1, parentId: "R", labels: {}, modeId: "edit", state: "running", attention: "none", lastMessagePreview: "",
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true, turns: 0 }, budget: { reservedUsd: 0, spentUsd: 0, exhausted: false }, created_ms: 1, updated_ms: 1, ...over,
});
const tree = (agents: AgentRecord[], seq = 9): AgentTree => ({ rootId: "R", seq, teamId: null, agents });
const root = agent("R", { depth: 0, parentId: undefined, origin: "user" });

test("Child waits for its own children: the pill reads Paused with the secondary text; every state has its pill", () => {
  assert.deepEqual(agentPill(agent("a", { state: "waiting", waitingReason: "children" })), { label: "Paused", status: "paused", reason: "Waiting for sub-agents" });
  assert.deepEqual(agentPill(agent("a", { state: "waiting", waitingReason: "approval" })), { label: "Needs approval", status: "needs approval" });
  assert.deepEqual([agentPill(agent("a", { state: "creating" })).label, agentPill(agent("a")).label, agentPill(agent("a", { state: "failed" })).label, agentPill(agent("a", { state: "closed" })).label, agentPill(agent("a", { state: "idle" })).label], ["Queued", "Working", "Failed", "Stopped", "Idle"]);
  const done = { outcome: "completed" as const, summary: "", artefacts: [], lastMessage: "", usage: root.usage, ended_ms: 2 };
  assert.deepEqual([agentPill(agent("a", { state: "idle", result: done })).label, agentPill(agent("a", { state: "idle", result: { ...done, outcome: "cancelled" } })).label], ["Completed", "Cancelled"]);
});

test("Custom peer role appears everywhere: the role line names tier and role; tokens, cost and elapsed time are short", () => {
  assert.equal(agentRoleLine(agent("a", { tier: "peer", roleLabel: "Colourist" })), "Peer · Colourist");
  assert.equal(agentRoleLine(agent("a", { tier: "supervisor", roleLabel: "Director", depth: 0 })), "Director");
  assert.deepEqual([agentRoleLine(root), agentRoleLine(agent("a")), agentRoleLine(agent("a", { roleLabel: "Editor" }))], ["Session agent", "Sub-agent", "Editor"]);
  assert.deepEqual([agentTokens(root.usage), agentTokens({ ...root.usage, inputTokens: 1200, outputTokens: 34 }), agentTokens({ ...root.usage, inputTokens: 2_500_000 })], ["", "1.2k tokens", "2.5M tokens"]);
  assert.deepEqual([agentCost(root.usage), agentCost({ ...root.usage, turns: 1, costUsd: 0.4 }), agentCost({ ...root.usage, turns: 2, costKnown: false }), agentCost({ ...root.usage, turns: 1 })], ["", "$0.40", "tokens only", ""]);
  assert.deepEqual([agentElapsed(42_000), agentElapsed(185_000), agentElapsed(3_725_000)], ["42 s", "3m 05s", "1h 02m"]);
});

test("Event gap: an event that skips a number asks for the tree again; events in order keep the tree in depth-first order", () => {
  const a = agent("A"), b = agent("B");
  let held = tree([root, a, b]);
  assert.equal(applyAgentEvent(held, { rootId: "R", seq: 12, agent: a }), null);
  assert.equal(applyAgentEvent(held, { rootId: "R", seq: 9, agent: a }), held);
  assert.equal(applyAgentEvent(held, { rootId: "other", seq: 99, agent: a }), held);
  // A child of A is placed after A, before B; a change replaces its record; an archived agent leaves with its children.
  held = applyAgentEvent(held, { rootId: "R", seq: 10, agent: agent("A1", { parentId: "A", depth: 2 }) })!;
  assert.deepEqual(held.agents.map((entry) => entry.id), ["R", "A", "A1", "B"]);
  held = applyAgentEvent(held, { rootId: "R", seq: 11, agent: { ...b, state: "idle" } })!;
  assert.equal(held.agents[3].state, "idle");
  assert.equal(applyAgentEvent(held, { rootId: "R", seq: 12, agent: agent("X", { parentId: "missing" }) }), null);
  held = applyAgentEvent(held, { rootId: "R", seq: 12, agent: { ...a, archived_ms: 5 } })!;
  assert.deepEqual([held.agents.map((entry) => entry.id), held.seq], [["R", "B"], 12]);
  held = applyAgentEvent(held, { rootId: "R", seq: 13, agent: { ...root, teamId: "video-production" } })!;
  assert.equal(held.teamId, "video-production");
});

test("Run total: the track lists what is below the session's agent and the tree sums its members", () => {
  const members = [root, agent("A", { usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.1, costKnown: true, turns: 1 } }), agent("B", { state: "idle", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.2, costKnown: false, turns: 1 } }), agent("C", { archived_ms: 3 })];
  assert.deepEqual(subAgentsOf(tree(members)).map((entry) => entry.id), ["A", "B"]);
  assert.deepEqual(subAgentsOf(null), []);
  assert.deepEqual(treeTotals(members.slice(0, 3)), { tokens: 165, costUsd: 0.3, costKnown: false, running: 2 });
});

test("Two children finish together: the server's message to the caller is read as one note per settled agent, and a sub-agent's first message as its assignment", () => {
  const block = (agentId: string, title: string, extra: object = {}) => JSON.stringify({ kind: "agent_notification", agentId, title, outcome: "completed", summary: `${title} is done.\n\nTwo paragraphs.`, artefacts: [], usage: { costUsd: 0 }, ...extra }, null, 1);
  const message = `2 sub-agents settled. This message is from the server, not from the user.\n\n${block("agt_B", "Editor B", { handbackId: "hbk_1", artefacts: [{ kind: "proposal", id: "p1", title: "Title card" }] })}\n\n${block("agt_C", "Reviewer", { outcome: "failed", reason: "The model did not answer." })}\n\nUse jc_agent_status for details. Do not poll.`;
  const notes = parseAgentNotification(message)!;
  assert.deepEqual(notes.map((note) => [note.agentId, note.title, note.outcome, note.handbackId, note.reason, note.artefacts.length]), [["agt_B", "Editor B", "completed", "hbk_1", undefined, 1], ["agt_C", "Reviewer", "failed", undefined, "The model did not answer.", 0]]);
  assert.equal(notes[0].summary, "Editor B is done.\n\nTwo paragraphs.");
  assert.equal(parseAgentNotification("Make the intro shorter."), null);
  assert.equal(parseAgentNotification("A sub-agent settled. nothing else"), null);
  assert.equal(assignmentOf('You are "Editor A", a sub-agent created by "Director".\nResponsibility: edits.\n\nAssignment:\nAdd the title card.'), "Add the title card.");
  assert.equal(assignmentOf("Assignment:\nnot a sub-agent prompt"), "Assignment:\nnot a sub-agent prompt");
  // A team run: the instruction to the Director shows as the request the person made, never as the instruction or with its run id.
  assert.equal(assignmentOf('[Team run run_01M4C200AB] You are the Director of the team "Video production team" and the single contact for the user in this run.\n\nObjective: Add an opening title\nRoute: edit\n\nHow this run works:\n- call jc_team_bootstrap_lead'), "Add an opening title");
  assert.equal(assignmentOf("[Team run run_01M4C200AB] The result was accepted. This message is from the server, not from the user.\n\nSummary: Done."), "The result was accepted.\n\nSummary: Done.");
});

test("Team run panel: the stepper, the pills, the counters, the plan title and the activity log read the run record", async () => {
  const { RUN_STEPS, activityFeed, assignmentPill, handoffBadge, handoffPill, planTitle, runCounters, runPill, runStep } = await import("../src/agents/team.ts");
  assert.deepEqual(RUN_STEPS.map((step) => step.label), ["Director", "Lead", "Assignments", "Acceptance", "Relay"]);
  assert.deepEqual([runStep({ status: "running", stage: "assignments" }), runStep({ status: "waiting_human", stage: "acceptance" }), runStep({ status: "completed" }), runStep({ status: "cancelled" })],
    [{ current: 2, done: 2 }, { current: 3, done: 3 }, { current: -1, done: 5 }, { current: -1, done: 0 }]);
  assert.deepEqual([runPill({ status: "waiting_human", waitingReason: "signoff" }).label, runPill({ status: "running" }).label, runPill({ status: "cancelled" }).status], ["Needs approval", "Working", "cancelled"]);
  assert.deepEqual(["active", "handed_back", "accepted", "failed", "cancelled"].map((status) => assignmentPill(status as never).label), ["Working", "Handed back", "Accepted", "Failed", "Cancelled"]);
  const assignments = [{ status: "active" }, { status: "handed_back" }, { status: "active" }] as never;
  assert.deepEqual(runCounters({ assignments, limits: { maxConcurrentPeersPerLead: 3, maxAssignmentsPerBrief: 12 } }), { peers: "2/3", assignments: "3/12" });
  assert.deepEqual([planTitle(1), planTitle(2)], ["Lead plan · 1 bounded assignment", "Lead plan · 2 bounded assignments"]);
  assert.deepEqual([handoffPill({ status: "pending" }).label, handoffPill({ status: "accepted" }).status, handoffBadge({ handoff: "handed_off" }), handoffBadge({ handoff: "received" }), handoffBadge({})], ["Queued", "approved", "→ handing off", "← hand-off received", ""]);
  const run = { id: "run_1", events: [{ ts_ms: 10, kind: "run.started", text: "Brief prepared." }, { ts_ms: 10, kind: "stage.supervisor", text: "Director is working." }, { ts_ms: 30, kind: "stage.lead", text: "Producer was created." }] } as never;
  const handoff = { id: "hof_1", fromTitle: "Editor", toTitle: "Reviewer", scope: "task", status: "accepted", created_ms: 20, decided_ms: 40, decidedBy: { kind: "device", id: "d" } } as never;
  assert.deepEqual(activityFeed([run], [handoff]).map((entry) => [entry.ts_ms, entry.text]), [
    [40, "The hand-off from Editor to Reviewer was accepted by a person."], [30, "Producer was created."], [20, "Editor offered a task to Reviewer."], [10, "Director is working."], [10, "Brief prepared."]]);
});

// — run 4: the hand-back card, the conversation hand-off, the reviewer's rounds, and a refused step in words —
import type { AgentHandback, TeamRunApproval } from "@jagentchill/protocol";
import { agentApproval, escalationReason, handbackOutcomeLabel, handbackPill, handbackSections, handoffMessageId, handoffPill, handoffScopeLabel, isHandoffDecisionMessage } from "../src/agents/team.ts";
import { toolOutcomeOf } from "../src/agents/worklog.ts";

test("Hand-back card: the four required sections are always shown in order, optional ones only when given; the pill follows what was decided", () => {
  const record: AgentHandback = { handbackId: "hbk_1", agentId: "a", toAgentId: "R", status: "disagree", whatChangedOrInspected: "Added the card.", evidence: "Rendered 0–3 s.", remainingUncertainty: "None", counterEvidence: "None", claim: "It meets the brief.", openQuestions: [], risks: [], nextSteps: [], artefacts: [], created_ms: 1 };
  assert.deepEqual(handbackSections(record).map((section) => [section.label, section.text, section.missing]), [["What changed or was inspected", "Added the card.", false], ["Evidence", "Rendered 0–3 s.", false], ["Remaining uncertainty", "None", false], ["Counter-evidence", "None", false], ["Claim", "It meets the brief.", false]]);
  // A record of a host that did not ask for them yet: the section is there and says so.
  const old = { ...record, evidence: undefined, counterEvidence: undefined, claim: undefined };
  assert.deepEqual(handbackSections(old).map((section) => [section.key, section.missing]), [["whatChangedOrInspected", false], ["evidence", true], ["remainingUncertainty", false], ["counterEvidence", true]]);
  assert.deepEqual([handbackOutcomeLabel("disagree"), handbackOutcomeLabel("done"), handbackPill(record).label, handbackPill({ state: "returned" }).label, handbackPill({ state: "accepted" }).label], ["Disagrees", "Done", "Waiting for a decision", "Returned", "Accepted"]);
});

test("Pending hand-off needing a human: a hand-off a person decides shows Needs approval, one the receiver decides Queued; the package and the decision the server delivered are recognised", () => {
  assert.deepEqual([handoffPill({ status: "pending", decision: "human" }).label, handoffPill({ status: "pending", decision: "agent" }).label, handoffPill({ status: "accepted", decision: "human" }).label, handoffScopeLabel("conversation")], ["Needs approval", "Queued", "Accepted", "Conversation"]);
  const pack = 'Hand-off from "Director" (the conversation with the user). This message is from the server, not from the user.\nhandoffId: hof_01ABC\n\nBrief:\nTake over.';
  assert.equal(handoffMessageId(pack), "hof_01ABC");
  assert.equal(handoffMessageId(`You are "Host", a sub-agent created by "Director". You work for that agent.\nAssignment:\n${pack}`), "hof_01ABC", "also as the first message of a receiver the hand-off created");
  assert.equal(handoffMessageId("Hand-off the intro to me please"), null);
  assert.deepEqual([isHandoffDecisionMessage("The user accepted the hand-off hof_01ABC: you lead this conversation now. This message is from the server, not from the user."), isHandoffDecisionMessage("The user accepted the hand-off, I think")], [true, false]);
});

test("Agent review on the result line: the reviewer's pass names who, the total and the round; an escalation says why in words", () => {
  const base = { mode: "agent", source: "team", raisedByHostMinimum: false, status: "approved", reviewerTitle: "Reviewer" } as const;
  const review = (round: number, total: number, passed: boolean) => ({ round, reviewerAgentId: "rv", scores: {}, total, verdict: passed ? "approve" as const : "request_changes" as const, summary: "", findings: [], passed, started_ms: 1, ended_ms: 2, costUsd: 0 });
  const approved: TeamRunApproval = { ...base, reviews: [review(1, 72, false), review(2, 86, true)], rounds: [{ verdict: "approve", decidedBy: { kind: "agent", id: "rv" }, ts_ms: 3 }] };
  assert.deepEqual(agentApproval(approved), { reviewer: "Reviewer", total: 86, round: 2 });
  assert.equal(agentApproval({ ...approved, rounds: [{ verdict: "approve", decidedBy: { kind: "device", id: "d" }, ts_ms: 3 }] }), null, "a person's approval is not the reviewer's");
  assert.match(escalationReason({ escalated: { reason: "max_rounds", ts_ms: 1 } }), /after the last revision round/);
  assert.equal(escalationReason({}), "");
});

test("A refused step says why in words: a recording that was cut short still gives the refusal's sentence, never the brace it starts with", () => {
  const envelope = JSON.stringify({ ok: false, error: { code: "TEAM_SHAPE_VIOLATION", message: 'A team run is in progress: create its lead with jc_team_bootstrap_lead, and let "the lead" staff the other roles.', retryable: false, details: { runId: "run_1" } }, state: { big: "x".repeat(5000) } }, null, 2);
  // As the pane records it: the tool result as JSON, the envelope a string inside it, cut at 4,000 characters.
  const recorded = `${JSON.stringify({ content: [{ type: "text", text: envelope }], isError: true }, null, 2).slice(0, 4000)}…`;
  const outcome = toolOutcomeOf(recorded, true);
  assert.deepEqual([outcome.ok, outcome.error?.code, outcome.error?.message, outcome.text], [false, "TEAM_SHAPE_VIOLATION", 'A team run is in progress: create its lead with jc_team_bootstrap_lead, and let "the lead" staff the other roles.', undefined]);
  // The envelope itself cut short, and a structure with no words in it at all.
  assert.equal(toolOutcomeOf(`${envelope.slice(0, 300)}…`, true).error?.message.startsWith("A team run is in progress"), true);
  const bare = toolOutcomeOf('{\n  "items": [\n    {', true);
  assert.deepEqual([bare.text, bare.error], [undefined, undefined], "raw data is not the summary of a step");
  // The rule in words for a person, when the refusal carries one, is what is shown — whole or cut short.
  const withWhy = JSON.stringify({ ok: false, error: { code: "TEAM_SHAPE_VIOLATION", message: "Create its lead with jc_team_bootstrap_lead.", details: { why: "Refused: the Director hands the work to the lead." } }, state: "x".repeat(5000) }, null, 2);
  assert.equal(toolOutcomeOf(withWhy, true).error?.message, "Refused: the Director hands the work to the lead.");
  assert.equal(toolOutcomeOf(`${JSON.stringify({ content: [{ type: "text", text: withWhy }] }, null, 2).slice(0, 4000)}…`, true).error?.message, "Refused: the Director hands the work to the lead.");
  // A whole envelope is read as before.
  assert.equal(toolOutcomeOf(JSON.stringify({ ok: false, error: { code: "WRITER_HELD", message: "Held." } }), true).error?.message, "Held.");
});

test("run 5 — an assignment and a host message are told apart from what a person wrote; a peer that handed back, an open dissent and how a dissent ended have their words", async () => {
  const { hostAssignment, handoffBadge, assignmentPill, dissentOutcome, proposalEscalationReason } = await import("../src/agents/team.ts");
  const first = 'You are "Host", a sub-agent created by "Director". You work for that agent, not for the user: do not ask the user questions.\nYou may edit the project.\n\nAssignment:\nHOST-TASK: stand by.';
  assert.deepEqual(hostAssignment(first), { from: "Director", text: "HOST-TASK: stand by." });
  assert.deepEqual(hostAssignment("The user accepted the hand-off hof_1: you lead this conversation now. This message is from the server, not from the user.\nStart by telling them what you take over."), { text: "The user accepted the hand-off hof_1: you lead this conversation now.\nStart by telling them what you take over." });
  assert.equal(hostAssignment("[Team run run_1] The result was accepted. This message is from the server, not from the user.\n\nSummary: ok")?.text, "The result was accepted.\n\nSummary: ok");
  // What a person typed is theirs, whatever it talks about.
  for (const typed of ["Make the intro shorter.", "You are the best. Assignment: none", "From Director:\nplease look"]) assert.equal(hostAssignment(typed), null);
  assert.deepEqual([handoffBadge({ handedBack: true, handoff: "received" }), handoffBadge({ handoff: "handed_off" }), handoffBadge({})], ["↩ handed back", "→ handing off", ""]);
  assert.deepEqual(assignmentPill("dissent_open"), { label: "Disagrees", status: "needs approval" });
  const base = { id: "dis_1", assignmentId: "asg_1", peerAgentId: "agt_1", peerTitle: "Editor", peerRoleLabel: "Editor", verificationRound: 0 as const, created_ms: 1 };
  assert.deepEqual([
    dissentOutcome({ ...base, status: "open" }).label, dissentOutcome({ ...base, status: "open", outcome: "ESCALATED_TO_HUMAN" }).label,
    dissentOutcome({ ...base, status: "resolved", outcome: "RESOLVED_BY_LEAD", rationale: "Use the first." }), dissentOutcome({ ...base, status: "resolved", outcome: "NEEDS_MORE_EVIDENCE", nextAction: "Render it." }),
    dissentOutcome({ ...base, status: "resolved", outcome: "ESCALATED_TO_HUMAN", human: { decision: "peer", deviceId: "d", ts_ms: 2 } }).label, dissentOutcome({ ...base, status: "resolved", outcome: "ESCALATED_TO_HUMAN", human: { decision: "other", direction: "Do both.", deviceId: "d", ts_ms: 2 } }),
  ], ["Waiting for the lead to decide", "Waiting for your decision", { label: "The lead decided", text: "Use the first." }, { label: "The lead asked for more evidence", text: "Render it." }, "A person sided with {role}", { label: "A person gave another direction", text: "Do both." }]);
  assert.deepEqual([proposalEscalationReason({ escalated: { reason: "apply_failed", ts_ms: 1 } }), proposalEscalationReason({ escalated: { reason: "reviewer_failed", ts_ms: 1 } }), proposalEscalationReason({})], ["The proposal passed the review but could not be applied just then.", "The reviewer agent gave no review twice in a row.", ""]);
});

test("run 6 — a notification leads to its card and is resolved on every device: the route carries the subject, the session reads it back as the card to show, and a device's inbox is reconciled with what still waits on the host", async () => {
  const { noticeFocus, noticeRoute, noticeSubject, reconcileNotices } = await import("../src/agents/team.ts");
  const handoff = { kind: "agent.handoff_pending" as const, subjectId: "hof_01ABC", sessionKey: "agent:main:s 1", rootId: "agt_1", ts_ms: 1 };
  const dissent = { kind: "agent.dissent_escalated" as const, subjectId: "dis_01XYZ", sessionKey: "agent:main:s2", rootId: "agt_2", ts_ms: 2 };
  const route = noticeRoute("host-a", handoff);
  assert.equal(route, "/h/host-a/sessions/agent%3Amain%3As%201?focus=agent.handoff_pending%3Ahof_01ABC");
  // The session screen gets the decoded parameter.
  assert.deepEqual(noticeFocus(decodeURIComponent(route.split("focus=")[1])), { kind: "agent.handoff_pending", id: "hof_01ABC", place: "chat" });
  assert.deepEqual(noticeFocus("agent.dissent_escalated:dis_01XYZ"), { kind: "agent.dissent_escalated", id: "dis_01XYZ", place: "team" });
  assert.deepEqual([noticeFocus(undefined), noticeFocus("1"), noticeFocus("agent.unknown:x"), noticeFocus("agent.proposal_ready:<script>")], [null, null, null, null]);
  // This device holds the hand-off as waiting and an entry of another host; the host says only the dissent still waits.
  const held = [{ subject: noticeSubject("host-a", handoff) }, { subject: noticeSubject("host-b", handoff) }, { subject: undefined }, { subject: noticeSubject("host-a", { kind: "agent.proposal_ready", subjectId: "p1" }), resolved: true }];
  assert.deepEqual(reconcileNotices("host-a", held, [dissent]), { resolve: [noticeSubject("host-a", handoff)], add: [dissent] });
  assert.deepEqual(reconcileNotices("host-a", [{ subject: noticeSubject("host-a", dissent) }], [dissent]), { resolve: [], add: [] });
});
