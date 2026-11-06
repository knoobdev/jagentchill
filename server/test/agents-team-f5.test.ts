// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
// The features of run 5 (`w2-multi-agent-5.md` items 6–9) by the scenarios of `multi-agent-orchestration`: agent review of member proposals, reviewer persona / role timeout / the one reminder, the hand-off notification, dissent.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentNotice, ProposalReview, TeamRun } from "@jagentchill/protocol";
import { tick } from "./harness.ts";
import { S, toolWorld } from "./support/tools.ts";
import { SECTIONS, TIMINGS, crew, proposalState, teamRun, until, world } from "./support/team.ts";

type World = Awaited<ReturnType<typeof world>>;
const saveTeam = async (w: World, change: Record<string, unknown>) => {
  const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
  const { created_ms: _c, updated_ms: _u, ...rest } = team;
  return w.admin.call("jagentchill.orc.team.save", { team: { ...rest, ...change } });
};
const SCORES = (meets: number, correct: number, quality: number, rights: number) => ({ meets_brief: meets, correctness: correct, quality, rights_safety: rights });
const notices = (w: World, kind: AgentNotice["kind"]): AgentNotice[] => w.admin.events.filter((event: { event: string; payload: any }) => event.event === "jagentchill.agent.notice" && event.payload.kind === kind).map((event: { payload: AgentNotice }) => event.payload);
const reviewsOf = async (w: World): Promise<ProposalReview[]> => (await w.admin.call("jagentchill.orc.run.get", { sessionKey: w.sessionKey })).proposalReviews;
/** A member stages a title and submits it; the review the policy asks for is started. */
async function propose(w: World, sessionKey: string, title: string, content: string) {
  await w.write("jc_text_add", { content, start: 0, duration: 3 * S }, sessionKey);
  const proposalId = await w.submit(title, sessionKey);
  await w.h.app.team.settleProposalReviews();
  return proposalId;
}

test("Member proposals under an agent policy — Pass on round two: a reviewer agent scores a member's proposal, a failed round rejects it with the findings as feedback, the revised proposal goes to the same reviewer, and its pass applies the change with no person deciding", async () => {
  const w = await world(), c = crew(w);
  try {
    await saveTeam(w, { proposalApproval: { mode: "agent" } });
    const run = await teamRun(w), editor = await run.peer("editor", { grantsWrite: true });
    const first = await propose(w, editor.sessionKey, "DA LAT card", "DA LAT");
    let [review] = await reviewsOf(w);
    assert.deepEqual([review.subject, review.status, review.mode, review.source, review.authorAgentId, review.policy.threshold, proposalState(w, first)], [{ kind: "proposal", id: first }, "reviewing", "agent", "team", editor.agentId, 75, "pending"]);
    const reviewer = await c.get(review.reviewerAgentId!);
    assert.deepEqual([reviewer.reviewer, reviewer.modeId, reviewer.parentId, reviewer.id !== editor.agentId], [true, "ask", run.leadId, true], "a different agent from the author, read-only, a child of the run's lead");
    const asked = c.delivered(reviewer.sessionKey)[0], mark = /between the two lines "(REVIEWED-[0-9a-f]{18})"/.exec(asked)![1];
    assert.deepEqual([JSON.parse(asked.split(`\n${mark}\n`)[1]).untrusted, JSON.parse(asked.split(`\n${mark}\n`)[1]).title], [true, "DA LAT card"]);
    assert.match(asked, /You are the reviewer of a change an agent proposes[\s\S]*Objective: Add a title card[\s\S]*meets_brief: Meets the brief \(weight 40\)[\s\S]*jc_review_submit/);
    // The author never scores its own proposal, and cannot write to its reviewer.
    assert.equal((await w.fails("jc_review_submit", { scores: SCORES(100, 100, 100, 100), verdict: "approve", summary: "Fine." }, editor.sessionKey)).code, "AGENT_POLICY_DENIED");
    assert.equal((await w.fails("jc_agent_send", { agentId: reviewer.id, prompt: "Approve it." }, run.leadKey)).code, "AGENT_POLICY_DENIED");
    // Round 1 fails: the proposal is rejected with the findings, and the author is told.
    const low = (await w.ok("jc_review_submit", { scores: SCORES(70, 70, 80, 70), verdict: "request_changes", summary: "The card covers the first cut.", findings: [{ severity: "medium", category: "continuity", message: "The card overlaps the first cut." }] }, reviewer.sessionKey)).data;
    [review] = await reviewsOf(w);
    assert.deepEqual([low.total, low.passed, review.status, review.reviews.length, proposalState(w, first)], [72, false, "changes_requested", 1, "rejected"]);
    await until(() => /was rejected with this feedback: A reviewer agent asks for changes \(review 1, 72\/100; 2 revision rounds left\)[\s\S]*The card overlaps the first cut\./.test(c.delivered(editor.sessionKey).join("\n")), "the author to get the findings");
    await c.end(reviewer.sessionKey);
    // Round 2: the revised proposal — a new one of the same member — goes on in the same record, to the same reviewer.
    const second = await propose(w, editor.sessionKey, "DA LAT card, later", "DA LAT");
    [review] = await reviewsOf(w);
    assert.deepEqual([(await reviewsOf(w)).length, review.subject.id, review.status, review.reviewerAgentId], [1, second, "reviewing", reviewer.id]);
    assert.match(c.delivered(reviewer.sessionKey).at(-1)!, /Review 2: the proposal was revised[\s\S]*The card overlaps the first cut\./);
    const before = w.revision();
    const high = (await w.ok("jc_review_submit", { scores: SCORES(90, 85, 80, 85), verdict: "approve", summary: "Fits now." }, reviewer.sessionKey)).data;
    [review] = await reviewsOf(w);
    assert.deepEqual([high.total, high.passed, review.status, review.decidedBy, review.reviews.map((round) => [round.round, round.total, round.passed]), proposalState(w, second), w.revision() > before], [86, true, "approved", { kind: "agent", id: reviewer.id }, [[1, 72, false], [2, 86, true]], "accepted", true]);
    assert.deepEqual(w.h.audit("approval.record").map((row: any) => [row.subject.kind, row.outcome, row.decidedBy?.kind]), [["proposal", "approved", "agent"]]);
    assert.equal(w.h.audit("proposal.resolve").filter((row: any) => row.actor !== "server" && row.actor?.kind !== "server").length, 0, "a person decided");
  } finally { w.close(); }
});

test("Member proposals under an agent policy — Max rounds reached; the minimum raised meanwhile; a person decides first: the proposal stays the person's to decide with its card, they are notified once, and a pass under a host that now asks for a person applies nothing", async () => {
  const w = await world();
  try {
    await saveTeam(w, { proposalApproval: { mode: "agent", maxRounds: 0 } });
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey }).catch(() => undefined);
    const run = await teamRun(w), editor = await run.peer("editor", { grantsWrite: true });
    const first = await propose(w, editor.sessionKey, "DA LAT card", "DA LAT");
    let [review] = await reviewsOf(w);
    const reviewerKey = (await crew(w).get(review.reviewerAgentId!)).sessionKey;
    const failed = (await w.ok("jc_review_submit", { scores: SCORES(60, 60, 60, 60), verdict: "request_changes", summary: "Not yet." }, reviewerKey)).data;
    [review] = await reviewsOf(w);
    await tick(40);
    assert.deepEqual([failed.escalated, review.status, review.escalated?.reason, proposalState(w, first), notices(w, "agent.proposal_ready").map((notice) => [notice.subjectId, notice.title])], ["max_rounds", "escalated", "max_rounds", "pending", [[first, "DA LAT card"]]]);
    assert.equal(w.admin.events.filter((event: { event: string; payload: any }) => event.event === "jagentchill.chat.notice" && event.payload.code === "proposal-review-escalated").length, 1);
    await w.accept(first);
    assert.equal(proposalState(w, first), "accepted");
    // The host asks for a person while the reviewer works on the next one: its pass applies nothing.
    await saveTeam(w, { proposalApproval: { mode: "agent" } });
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the card." }, editor.sessionKey); await crew(w).end(editor.sessionKey);
    const other = await run.peer("editor", { grantsWrite: true, title: "Second editor" });
    const second = await propose(w, other.sessionKey, "End card", "END");
    const next = (await reviewsOf(w))[0], nextKey = (await crew(w).get(next.reviewerAgentId!)).sessionKey;
    await w.admin.call("jagentchill.orc.approval.set", { minimum: "human" });
    const pass = (await w.ok("jc_review_submit", { scores: SCORES(95, 95, 95, 95), verdict: "approve", summary: "Fine." }, nextKey)).data;
    assert.deepEqual([pass.escalated, (await reviewsOf(w))[0].status, proposalState(w, second)], ["minimum_raised", "escalated", "pending"]);
  } finally { w.close(); }
});

test("Reviewer persona, role timeout and the one reminder: the reviewer runs as the persona of the policy, a review that takes longer than its routing role's time limit is asked for again and then goes to a person, and a sign-off that still waits is notified once and reminded once — never expired", async () => {
  const w = await toolWorld({ harness: { extra: { agentTimings: { ...TIMINGS, remindAfterMs: 120 } } } }), c = crew(w);
  try {
    await saveTeam(w, { resultApproval: { mode: "agent", reviewer: { role: "reviewer", persona: { name: "Continuity checker", instructions: "Judge continuity before anything else." } } } });
    // The time limit of the reviewer's routing role is the host's own setting (`Role limits`), not a constant of this service.
    const config = await w.admin.call("jagentchill.orc.config.get", {});
    await w.admin.call("jagentchill.orc.config.update", { expectedRevision: config.revision, patch: { roles: { reviewer: { limits: { timeoutSeconds: 0.25 } } } } });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title card" });
    const directorKey = await c.director(), started = Date.now();
    await w.ok("jc_team_accept_result", { summary: "The card is in.", evidence: "Rendered 0–3 s.", remainingUncertainty: "None" }, directorKey);
    let run = await c.run();
    const reviewer = await c.get(run.approval!.reviewerAgentId!);
    assert.deepEqual([reviewer.title, run.approval?.reviewerTitle, run.approval?.policy?.reviewer.persona?.name], ["Continuity checker", "Continuity checker", "Continuity checker"]);
    assert.match(c.delivered(reviewer.sessionKey)[0], /You review as "Continuity checker"\.\nJudge continuity before anything else\.\n\nThe brief the result must meet:/);
    // Nobody answers: after the role's 0.25 s the reviewer is asked again, after another 0.25 s the result is a person's.
    await until(async () => (await c.run()).status === "waiting_human", "the review to time out twice");
    run = await c.run();
    assert.ok(Date.now() - started < 5000, "the fixed 300 s were used instead of the role's time limit");
    assert.deepEqual([run.approval?.escalated?.reason, run.approval?.reviewerFailures, c.delivered(reviewer.sessionKey).filter((text) => /Your review is still missing: it did not answer in time/.test(text)).length], ["reviewer_failed", 2, 1]);
    // One notification for the sign-off, and — while it still waits — exactly one reminder; the card stays.
    await until(() => notices(w as World, "agent.approval_required").length === 2, "the reminder");
    await tick(300);
    run = await c.run();
    assert.deepEqual([notices(w as World, "agent.approval_required").map((notice) => [notice.subjectId, notice.reminder === true]), run.status, run.waitingReason, typeof run.approval?.reminded_ms], [[[run.id, false], [run.id, true]], "waiting_human", "signoff", "number"]);
    assert.equal(((await w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "approve" })).run as TeamRun).approval?.status, "approved");
  } finally { w.close(); }
});

test("Hand-off waiting for the user raises one agent.handoff_pending notification; a hand-off the receiving agent decides raises none", async () => {
  const w = await world(), c = crew(w);
  const pack = { brief: "Take over the talk with the user about the intro.", historySummary: "Two cuts were tried." };
  try {
    await c.prompt();
    const lead = await c.spawn({ title: "Lead" }), a = await c.spawn({ title: "A" }, lead.sessionKey), b = await c.spawn({ title: "B" }, lead.sessionKey);
    await w.ok("jc_agent_handoff", { to: b.agentId, scope: "task", package: pack }, a.sessionKey);
    assert.equal(notices(w, "agent.handoff_pending").length, 0);
    const talk = (await w.ok("jc_agent_handoff", { to: lead.agentId, scope: "conversation", package: pack })).data;
    await tick(40);
    assert.deepEqual(notices(w, "agent.handoff_pending").map((notice) => [notice.subjectId, notice.to, notice.sessionKey]), [[talk.handoffId, "Lead", w.sessionKey]]);
  } finally { w.close(); }
});

test("Dissent resolution — Disagree opens a dissent; More evidence once; Escalated to the human; Resolved by lead; the lead's own challenge: no result is accepted while one is open, and the person's decision reaches the lead as binding", async () => {
  const w = await world(), c = crew(w);
  try {
    await saveTeam(w, { resultApproval: { mode: "human" } });
    const run = await teamRun(w), editor = await run.peer("editor", { grantsWrite: true }), checker = await run.peer("reviewer"), writer = await run.peer("screenwriter");
    const read = () => c.run();
    // — Disagree opens a dissent —
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Did not add the card.", outcome: "disagree", claim: "A title card hides the opening shot.", requestedResolution: "Use a lower third instead." }, editor.sessionKey);
    await c.end(editor.sessionKey);
    let now = await read(), [dissent] = now.dissents!;
    assert.deepEqual([now.dissents!.length, dissent.status, dissent.assignmentId, dissent.peerAgentId, dissent.claim, dissent.requestedResolution, dissent.verificationRound, now.assignments[0].status], [1, "open", editor.assignmentId, editor.agentId, "A title card hides the opening shot.", "Use a lower third instead.", 0, "dissent_open"]);
    await until(() => c.delivered(run.leadKey).some((text) => /handed back with a dissent[\s\S]*"untrusted": true[\s\S]*"requestedResolution": "Use a lower third instead\."[\s\S]*jc_team_resolve_dissent/.test(text)), "the lead to hear of the dissent");
    // Nothing is accepted while it is open; only the lead closes it.
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Checked the cut." }, checker.sessionKey); await c.end(checker.sessionKey);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Wrote the line.", requestedResolution: "Decide between two wordings." }, writer.sessionKey); await c.end(writer.sessionKey);
    const blocked = await w.fails("jc_team_accept_result", { summary: "Done.", evidence: "Hand-backs.", remainingUncertainty: "None" }, run.leadKey);
    assert.deepEqual([blocked.code, blocked.details?.openDissents?.length, /jc_team_resolve_dissent/.test(blocked.message)], ["CONFLICT", 2, true]);
    assert.equal((await w.fails("jc_team_resolve_dissent", { assignmentId: editor.assignmentId, outcome: "RESOLVED_BY_LEAD", rationale: "I win." }, editor.sessionKey)).code, "TEAM_SHAPE_VIOLATION");
    // — Resolved by lead (the screenwriter's request) —
    const closed = (await w.ok("jc_team_resolve_dissent", { assignmentId: writer.assignmentId, outcome: "RESOLVED_BY_LEAD", rationale: "Use the first wording." }, run.leadKey)).data;
    now = await read();
    assert.deepEqual([closed.status, now.dissents!.find((entry) => entry.assignmentId === writer.assignmentId)!.status, now.assignments[2].status], ["resolved", "resolved", "handed_back"]);
    await until(() => /Resolution: Use the first wording\.[\s\S]*The lead has closed this dissent\. Do not reopen it\.$/.test(c.delivered(writer.sessionKey).at(-1) ?? ""), "the peer to get the resolution");
    // — More evidence, once —
    assert.equal((await w.fails("jc_team_resolve_dissent", { assignmentId: editor.assignmentId, outcome: "NEEDS_MORE_EVIDENCE", rationale: "Show me." }, run.leadKey)).details?.field, "nextAction");
    await w.ok("jc_team_resolve_dissent", { assignmentId: editor.assignmentId, outcome: "NEEDS_MORE_EVIDENCE", rationale: "I am not convinced the shot is hidden.", nextAction: "Render second 0 to 3 with the card and name what is covered." }, run.leadKey);
    now = await read();
    assert.deepEqual([now.assignments[0].status, now.assignments[0].moreEvidenceUsed, now.dissents![0].status, now.dissents![0].outcome, now.dissents![0].verificationRound, (await c.get(editor.agentId)).grantsWrite], ["active", true, "resolved", "NEEDS_MORE_EVIDENCE", 1, true]);
    await until(() => /What to bring — this and nothing else: Render second 0 to 3[\s\S]*hand back again/.test(c.delivered(editor.sessionKey).at(-1) ?? ""), "the peer to get the bounded request");
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Rendered it: the card covers the face.", outcome: "disagree", claim: "The card covers the face." }, editor.sessionKey);
    await c.end(editor.sessionKey);
    const again = await w.fails("jc_team_resolve_dissent", { assignmentId: editor.assignmentId, outcome: "NEEDS_MORE_EVIDENCE", rationale: "More.", nextAction: "Again." }, run.leadKey);
    assert.equal(again.code, "TEAM_DISSENT_ROUND_USED");
    // — Escalated to the human —
    const up = (await w.ok("jc_team_resolve_dissent", { assignmentId: editor.assignmentId, outcome: "ESCALATED_TO_HUMAN", rationale: "The brief asks for a title card." }, run.leadKey)).data;
    now = await read(); dissent = now.dissents!.at(-1)!;
    assert.deepEqual([up.status, now.status, now.waitingReason, dissent.status, dissent.outcome, dissent.rationale, (await c.tree())[0].attention], ["open", "waiting_human", "dissent", "open", "ESCALATED_TO_HUMAN", "The brief asks for a title card.", "approval"]);
    await tick(40);
    assert.deepEqual(notices(w, "agent.dissent_escalated").map((notice) => notice.subjectId), [dissent.id]);
    assert.equal((await w.fails("jc_team_accept_result", { summary: "Done.", evidence: "Hand-backs.", remainingUncertainty: "None" }, run.leadKey)).code, "TEAM_SHAPE_VIOLATION");
    assert.equal((await w.admin.fail("jagentchill.orc.run.resolveEscalation", { runId: now.id, dissentId: dissent.id, decision: "other" })).code, "INVALID_PARAMS");
    const decided = (await w.admin.call("jagentchill.orc.run.resolveEscalation", { runId: now.id, dissentId: dissent.id, decision: "peer" })).run as TeamRun;
    assert.deepEqual([decided.status, decided.waitingReason, decided.dissents!.at(-1)!.status, decided.dissents!.at(-1)!.human?.decision, decided.assignments[0].status, (await c.tree())[0].attention], ["running", undefined, "resolved", "peer", "handed_back", "none"]);
    await until(() => /The user decided the dissent[\s\S]*it is binding[\s\S]*The user sides with the Editor/.test(c.delivered(run.leadKey).at(-1) ?? ""), "the lead to get the person's decision");
    assert.equal((await w.admin.fail("jagentchill.orc.run.resolveEscalation", { runId: now.id, dissentId: dissent.id, decision: "lead" })).code, "ALREADY_RESOLVED");
    // — The lead's own challenge of a hand-back nobody disputed opens the dissent it closes —
    await w.ok("jc_team_resolve_dissent", { assignmentId: checker.assignmentId, outcome: "RESOLVED_BY_LEAD", rationale: "The check missed the audio; I take it as partial." }, run.leadKey);
    now = await read();
    assert.deepEqual([now.dissents!.length, now.dissents!.at(-1)!.assignmentId, now.dissents!.at(-1)!.status, now.assignments[1].status], [4, checker.assignmentId, "resolved", "handed_back"]);
    // Every dissent closed: the result can be offered.
    assert.equal((await w.ok("jc_team_accept_result", { summary: "Done.", evidence: "Hand-backs.", remainingUncertainty: "None" }, run.leadKey)).data.status, "waiting_for_signoff");
  } finally { w.close(); }
});
