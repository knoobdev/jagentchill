// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
// The three features of run 4 — agent approval, conversation hand-off, the hand-back record — by the scenarios of `multi-agent-orchestration`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentHandback, AgentHandoff, AgentRecord, TeamRun } from "@jagentchill/protocol";
import { tick } from "./harness.ts";
import { S, toolWorld } from "./support/tools.ts";
import { SECTIONS, TIMINGS, crew, teamRun, until, world } from "./support/team.ts";

type World = Awaited<ReturnType<typeof world>>;
const pack = { brief: "Take over the talk with the user about the intro.", historySummary: "The user asked for a shorter intro; two cuts were tried." };
const policyTeam = async (w: World, resultApproval: object | undefined) => {
  const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
  const { created_ms: _c, updated_ms: _u, resultApproval: _r, ...rest } = team;
  return w.admin.call("jagentchill.orc.team.save", { team: { ...rest, ...(resultApproval ? { resultApproval } : {}) } });
};
const RESULT = { summary: "The card is in.", evidence: "Rendered 0–3 s.", remainingUncertainty: "None" };
const SCORES = (meets: number, correct: number, quality: number, rights: number) => ({ meets_brief: meets, correctness: correct, quality, rights_safety: rights });
/** A run whose Director offers the result itself (no lead): the reviewer it gets, and the helpers of a review. */
async function reviewedRun(w: World, request = "Add a title card") {
  const c = crew(w);
  await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
  await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request });
  const directorKey = await c.director();
  const offer = () => w.ok("jc_team_accept_result", RESULT, directorKey);
  const reviewerKey = async () => (await c.get((await c.run()).approval!.reviewerAgentId!)).sessionKey;
  const review = async (scores: Record<string, number>, verdict: "approve" | "request_changes", findings: object[] = []) => (await w.ok("jc_review_submit", { scores, verdict, summary: "Checked against the brief.", findings }, await reviewerKey())).data;
  return { c, directorKey, offer, reviewerKey, review };
}

test("Complete hand-back; Missing counter-evidence; Field over the cap: the four sections are required, \"None\" is said explicitly, a root reports to the user instead, and a hand-back nobody decided on is marked as waiting", async () => {
  const w = await toolWorld({ harness: { extra: { agentTimings: { ...TIMINGS, handbackWaitMs: 80 } } } }), c = crew(w);
  try {
    await c.prompt();
    const peer = await c.spawn({ title: "Editor" });
    const full = { whatChangedOrInspected: "Added the title card DA LAT at 0 s.", evidence: "Rendered 0–3 s and read the frame.", remainingUncertainty: "The font is a substitute.", counterEvidence: "None" };
    for (const field of ["whatChangedOrInspected", "evidence", "remainingUncertainty", "counterEvidence"] as const) {
      for (const value of [undefined, "", "   "]) {
        const refused = await w.fails("jc_agent_handback", { ...full, [field]: value }, peer.sessionKey);
        assert.deepEqual([refused.code, refused.details?.field], ["INVALID_PARAMS", field]);
        assert.match(refused.message, /state "None" explicitly/);
      }
    }
    const long = await w.fails("jc_agent_handback", { ...full, evidence: "e".repeat(12_001) }, peer.sessionKey);
    assert.deepEqual([long.code, long.details?.field], ["INVALID_PARAMS", "evidence"]);
    const list = async (): Promise<AgentHandback[]> => (await w.admin.call("jagentchill.agent.handback.list", { sessionKey: w.sessionKey })).handbacks;
    assert.equal((await list()).length, 0, "nothing is delivered by a refused hand-back");
    const fromRoot = await w.fails("jc_agent_handback", full);
    assert.deepEqual([fromRoot.code, /Report to the user in your reply instead/.test(fromRoot.message)], ["INVALID_PARAMS", true]);
    // The complete record, with the optional sections that were given.
    const made = (await w.ok("jc_agent_handback", { ...full, outcome: "disagree", requestedResolution: "Decide on the font.", claim: "The card meets the brief." }, peer.sessionKey)).data;
    const [root] = await c.tree(), [record] = await list();
    assert.deepEqual([record.handbackId, record.state, record.status, record.agentId, record.toAgentId, record.fromTitle], [made.handbackId, "delivered", "disagree", peer.agentId, root.id, "Editor"]);
    assert.deepEqual([record.whatChangedOrInspected, record.evidence, record.remainingUncertainty, record.counterEvidence, record.requestedResolution, record.claim, record.currentDirection], [full.whatChangedOrInspected, full.evidence, full.remainingUncertainty, "None", "Decide on the font.", "The card meets the brief.", undefined]);
    await c.end(peer.sessionKey);
    assert.equal((await c.get(peer.agentId)).state, "idle");
    await until(() => c.delivered(w.sessionKey).some((text) => text.includes(made.handbackId)), "the owner to receive the hand-back");
    // Nobody decides: once the owner rests (the hand-back, held for the end of its turn, ran as a turn of its own), the hand-back is marked as waiting on it; a decision clears the mark.
    await c.rest(w.sessionKey);
    await until(async () => (await c.get(root.id)).handbackWaiting === true, "the hand-back to be marked as waiting");
    assert.equal((await c.get(root.id)).attention, "handoff");
    await w.admin.call("jagentchill.agent.handback.resolve", { handbackId: made.handbackId, decision: "accept" });
    assert.deepEqual([(await c.get(root.id)).handbackWaiting, (await c.get(root.id)).attention, (await list())[0].state, (await list())[0].decidedBy?.kind], [undefined, "none", "accepted", "device"]);
  } finally { w.close(); }
});

test("Conversation hand-off needs the human; Hand-off waiting for the user; Conversation hand-off; Second decision: no agent accepts it, the person's acceptance sends what they write in the session to the receiver's session, and they take the conversation back", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const [root] = await c.tree();
    const editor = await c.spawn({ title: "Editor" }), other = await c.spawn({ title: "Researcher" });
    const handoffs = async (): Promise<AgentHandoff[]> => (await w.admin.call("jagentchill.agent.handoff.list", { sessionKey: w.sessionKey })).handoffs;
    const notices = () => w.admin.events.filter((event: { event: string; payload: any }) => event.event === "jagentchill.chat.notice" && event.payload.code === "agent-handoff-pending");
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey }).catch(() => undefined);
    // The session's own agent offers the conversation: allowed for a root (its work it cannot give away), decided by the person.
    const offered = (await w.ok("jc_agent_handoff", { to: editor.agentId, scope: "conversation", package: pack })).data;
    let [record] = await handoffs();
    assert.deepEqual([record.id, record.status, record.scope, record.decision, record.fromAgentId, record.toAgentId], [offered.handoffId, "pending", "conversation", "human", root.id, editor.agentId]);
    assert.equal((await c.get(root.id)).attention, "handoff");
    assert.match(c.delivered(editor.sessionKey).at(-1)!, /Hand-off from[\s\S]*the conversation with the user[\s\S]*The user decides on this hand-off/);
    // Whatever the receiver answers, it stays pending; another agent has no say at all.
    assert.equal((await w.ok("jc_agent_handoff_respond", { handoffId: record.id, decision: "accept" }, editor.sessionKey)).data.status, "pending");
    assert.equal((await w.fails("jc_agent_handoff_respond", { handoffId: record.id, decision: "accept" }, other.sessionKey)).code, "AGENT_NOT_OWNED");
    assert.deepEqual([(await handoffs())[0].status, (await c.get(root.id)).answering], ["pending", undefined]);
    await c.end(w.sessionKey);
    // A viewer sees it and cannot decide; a device that may act accepts.
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.agent.handoff.resolve", { handoffId: record.id, decision: "accept" }), /SCOPE_DENIED/);
    const accepted = (await w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: record.id, decision: "accept" })).handoff as AgentHandoff;
    assert.deepEqual([accepted.status, accepted.decidedBy?.kind], ["accepted", "device"]);
    await assert.rejects(w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: record.id, decision: "reject", note: "late" }), /HANDOFF_NOT_PENDING/);
    const home = await c.get(root.id);
    assert.deepEqual([home.answering?.agentId, home.answering?.title, home.answering?.sessionKey, home.attention, (await c.get(editor.agentId)).ownerAgentId], [editor.agentId, "Editor", editor.sessionKey, "none", root.id], "who leads, and nobody's ownership changed");
    await until(() => /you lead this conversation now/.test(c.delivered(editor.sessionKey).at(-1) ?? ""), "the receiver to be told");
    // The receiver answers the hand-off and the news that it leads (each held for the end of the turn before it).
    await c.rest(editor.sessionKey, "I take over: I will shorten the intro.");
    // The next message typed in that session's composer starts a turn on the Editor's session.
    const before = { home: c.delivered(w.sessionKey).length, editor: c.delivered(editor.sessionKey).length };
    const sent = await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "Cut two more seconds." });
    assert.deepEqual([sent.routedTo, c.delivered(w.sessionKey).length - before.home, c.delivered(editor.sessionKey).length - before.editor], [editor.sessionKey, 0, 1]);
    assert.match(c.delivered(editor.sessionKey).at(-1)!, /Cut two more seconds\./);
    assert.deepEqual([w.h.app.relay.isRunning(editor.sessionKey), w.h.app.relay.isRunning(w.sessionKey)], [true, false]);
    await c.end(editor.sessionKey, "Done.");
    // The receiver cannot be offered what it already has; the trail names who led before and after.
    assert.equal((await w.fails("jc_agent_handoff", { to: editor.agentId, scope: "conversation", package: pack }, other.sessionKey)).code, "HANDOFF_TARGET_INVALID");
    const trail = w.h.audit("agent.handoff").filter((row: any) => row.recordId === record.id).map((row: any) => [row.action, row.actor.kind, row.answeringAfter]);
    assert.deepEqual(trail, [["created", "agent", undefined], ["accepted", "device", editor.agentId]]);
    // "Hand back": the session's own agent answers again.
    assert.deepEqual(await w.admin.call("jagentchill.agent.conversation.return", { sessionKey: w.sessionKey }), { rootId: root.id, answering: null });
    assert.equal((await c.get(root.id)).answering, undefined);
    const again = await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "Thanks." });
    assert.deepEqual([again.routedTo, c.delivered(w.sessionKey).at(-1)?.includes("Thanks.")], [undefined, true]);
    await assert.rejects(w.admin.call("jagentchill.agent.conversation.return", { sessionKey: w.sessionKey }), /CONFLICT/);
    void notices;
  } finally { w.close(); }
});

test("A hand-off that creates its receiver: the receiver is made beside the sender with the package as its first message, a creation that fails leaves no record; a leading agent that is archived leads no longer", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const [root] = await c.tree();
    const handoffs = async (): Promise<AgentHandoff[]> => (await w.admin.call("jagentchill.agent.handoff.list", { sessionKey: w.sessionKey })).handoffs;
    const lead = await c.spawn({ title: "Lead" }), worker = await c.spawn({ title: "Worker" }, lead.sessionKey);
    // A role that does not exist: nothing is created and no hand-off is recorded.
    const bad = await w.fails("jc_agent_handoff", { to: { title: "Colorist", role: "no-such-role" }, scope: "task", package: pack }, worker.sessionKey);
    assert.deepEqual([bad.code, (await handoffs()).length, (await c.tree()).length], ["INVALID_PARAMS", 0, 3]);
    const made = (await w.ok("jc_agent_handoff", { to: { title: "Colorist", role: "editor" }, scope: "task", package: pack }, worker.sessionKey)).data;
    const colorist = await c.get(made.to), [record] = await handoffs();
    assert.deepEqual([made.created, colorist.title, colorist.parentId, record.createdReceiver, record.toAgentId, record.status], [true, "Colorist", lead.agentId, true, colorist.id, "pending"], "created as a child of the agent the sender reports to");
    assert.match(c.delivered(colorist.sessionKey)[0], /Assignment:\nHand-off from "Worker"[\s\S]*Take over the talk with the user/);
    assert.equal((await w.ok("jc_agent_handoff_respond", { handoffId: record.id, decision: "accept" }, colorist.sessionKey)).data.status, "accepted");
    assert.equal((await c.get(colorist.id)).ownerAgentId, lead.agentId);
    // A root creates the receiver of a conversation hand-off as its own child; when that agent is archived the session's own agent answers again.
    await c.end(w.sessionKey);
    const talk = (await w.ok("jc_agent_handoff", { to: { title: "Host" }, scope: "conversation", package: pack })).data;
    assert.equal((await c.get(talk.to)).parentId, root.id);
    await w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: talk.handoffId, decision: "accept" });
    assert.equal((await c.get(root.id)).answering?.agentId, talk.to);
    await w.admin.call("jagentchill.agent.archive", { agentId: talk.to });
    assert.equal((await c.get(root.id)).answering, undefined);
    assert.equal((await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "Are you there?" })).routedTo, undefined);
  } finally { w.close(); }
});

test("Pass on round two; Approve below threshold; Criterion under the floor: a reviewer agent scores the result, a failed round goes back to the author, the same reviewer gets the revised result, and its pass approves the run — no human card", async () => {
  const w = await world();
  try {
    await policyTeam(w, { mode: "agent" });
    const { c, directorKey, offer, reviewerKey, review } = await reviewedRun(w);
    const offered = (await offer()).data;
    let run = await c.run();
    assert.deepEqual([offered.status, run.status, run.approval?.status, run.approval?.mode, run.approval?.policy?.threshold, run.approval?.policy?.criteria.map((entry) => entry.label)], ["in_review", "running", "reviewing", "agent", 75, ["Meets the brief", "Correctness and continuity", "Quality of execution", "Rights and safety"]]);
    const reviewer = await c.get(run.approval!.reviewerAgentId!);
    assert.deepEqual([reviewer.reviewer, reviewer.modeId, reviewer.parentId, reviewer.id !== run.supervisorAgentId, reviewer.grantsWrite], [true, "ask", run.supervisorAgentId, true, undefined], "a different agent from the author, in a mode that only reads");
    assert.match(c.delivered(reviewer.sessionKey)[0], /You are the reviewer[\s\S]*Objective: Add a title card[\s\S]*"summary": "The card is in\."[\s\S]*meets_brief: Meets the brief \(weight 40\)[\s\S]*jc_review_submit/);
    // The reviewer edits nothing, and the author cannot score its own result or offer it twice.
    assert.equal((await w.writeFails("jc_text_add", { content: "X", start: 0, duration: S }, reviewer.sessionKey)).code, "MODE_READ_ONLY");
    assert.equal((await w.fails("jc_review_submit", { scores: SCORES(100, 100, 100, 100), verdict: "approve", summary: "Fine." }, directorKey)).code, "AGENT_POLICY_DENIED");
    assert.equal((await w.fails("jc_team_accept_result", RESULT, directorKey)).code, "CONFLICT");
    await c.end(directorKey);
    // Round 1: 72 with request_changes → back to the author as a revision request.
    const first = await review(SCORES(70, 70, 80, 70), "request_changes", [{ severity: "medium", category: "continuity", message: "The card overlaps the first cut." }]);
    assert.deepEqual([first.total, first.passed, first.escalated], [72, false, undefined]);
    run = await c.run();
    assert.deepEqual([run.status, run.approval?.status, run.candidate, run.approval?.reviews?.length], ["running", "changes_requested", undefined, 1]);
    await until(() => /The reviewer asks for changes[\s\S]*The card overlaps the first cut\.[\s\S]*jc_team_accept_result again/.test(c.delivered(directorKey).at(-1) ?? ""), "the author to get the findings");
    await c.end(await reviewerKey());
    // Round 2: the SAME reviewer gets the revised result; 86 with approve passes.
    await offer();
    assert.equal((await c.run()).approval?.reviewerAgentId, reviewer.id);
    assert.match(c.delivered(reviewer.sessionKey).at(-1)!, /Review 2: the result was revised[\s\S]*The card overlaps the first cut\./);
    const second = await review(SCORES(90, 85, 80, 85), "approve");
    assert.deepEqual([second.total, second.passed], [86, true]);
    run = await c.run();
    assert.deepEqual([run.stage, run.approval?.status, run.approval?.outcome, run.approval?.decidedBy, run.approval?.reviews?.map((round) => [round.round, round.total, round.passed]), run.approval?.rounds.at(-1)?.note],
      ["relay", "approved", "approved", { kind: "agent", id: reviewer.id }, [[1, 72, false], [2, 86, true]], "Approved by Reviewer (agent) · 86/100 · round 2"]);
    assert.equal(w.h.audit("team.signoff.resolve").length, 0, "no person decided");
    assert.deepEqual(w.h.audit("approval.record").map((row: any) => [row.outcome, row.decidedBy?.kind, row.subject.kind]), [["approved", "agent", "team_result"]]);
    // — Approve below threshold; Criterion under the floor: the note says why an "approve" did not pass —
    const second2 = await world();
    try {
      await policyTeam(second2, { mode: "agent" });
      const b = await reviewedRun(second2);
      await b.offer();
      const low = await b.review(SCORES(60, 70, 60, 70), "approve");
      assert.deepEqual([low.total, low.passed, (await b.c.run()).approval?.reviews?.[0].note], [64, false, "Below threshold"]);
      await b.c.end(b.directorKey); await b.c.end(await b.reviewerKey());
      await b.offer();
      const floor = await b.review(SCORES(95, 90, 90, 40), "approve");
      assert.deepEqual([floor.total, floor.passed, (await b.c.run()).approval?.reviews?.[1].note], [87, false, "Criterion below floor: Rights and safety"]);
    } finally { second2.close(); }
  } finally { w.close(); }
});

test("Max rounds reached; Safety finding escalates at once; a reviewer that gives no review twice: the result becomes a person's sign-off that carries every round, and the person's decision closes the record", async () => {
  const w = await world();
  try {
    await policyTeam(w, { mode: "agent", maxRounds: 2 });
    const { c, directorKey, offer, reviewerKey, review } = await reviewedRun(w);
    for (const round of [1, 2, 3]) {
      await offer();
      const answer = await review(SCORES(60, 60, 60, 60), "request_changes", [{ severity: "low", category: "pacing", message: `Still too long (${round}).` }]);
      assert.deepEqual([answer.passed, answer.escalated], [false, round === 3 ? "max_rounds" : undefined]);
      await c.end(directorKey); await c.end(await reviewerKey());
    }
    let run = await c.run();
    assert.deepEqual([run.status, run.waitingReason, run.approval?.status, run.approval?.outcome, run.approval?.escalated?.reason, run.approval?.reviews?.map((round) => round.total), !!run.candidate], ["waiting_human", "signoff", "pending", "escalated", "max_rounds", [60, 60, 60], true]);
    assert.equal((await c.get(run.rootId)).attention, "approval");
    const resolved = (await w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "approve" })).run as TeamRun;
    assert.deepEqual([resolved.approval?.status, resolved.approval?.outcome, resolved.approval?.decidedBy?.kind, resolved.approval?.escalated?.reason, resolved.stage], ["approved", "approved", "device", "max_rounds", "relay"]);
    // — A safety finding at high severity goes to a person without a second round, whatever the total —
    const s = await world();
    try {
      await policyTeam(s, { mode: "agent", blockOnSeverity: "none" });
      const b = await reviewedRun(s);
      await b.offer();
      const grave = await b.review(SCORES(95, 90, 90, 85), "approve", [{ severity: "high", category: "safety", message: "The clip shows a licence plate." }]);
      run = await b.c.run();
      assert.deepEqual([grave.total, grave.escalated, run.status, run.approval?.reviews?.length, run.approval?.escalated?.reason], [91.5, "rights_or_safety", "waiting_human", 1, "rights_or_safety"]);
    } finally { s.close(); }
    // — The reviewer ends twice without an answer (once by itself, once by running out of time) —
    const t = await toolWorld({ harness: { extra: { agentTimings: { ...TIMINGS, reviewTimeoutMs: 150 } } } });
    try {
      await policyTeam(t, { mode: "agent" });
      const b = await reviewedRun(t);
      await b.offer();
      const key = await b.reviewerKey();
      await b.c.end(key, "Looks fine to me.");
      await until(() => /Your review is still missing/.test(b.c.delivered(key).at(-1) ?? ""), "the reviewer to be asked again");
      assert.deepEqual([(await b.c.run()).approval?.status, (await b.c.run()).approval?.reviewerFailures], ["reviewing", 1]);
      await until(async () => (await b.c.run()).status === "waiting_human", "the second failure (no answer in time) to go to a person");
      run = await b.c.run();
      assert.deepEqual([run.approval?.escalated?.reason, run.approval?.reviewerFailures, run.approval?.reviews?.length], ["reviewer_failed", 2, 0]);
    } finally { t.close(); }
  } finally { w.close(); }
});

test("Invalid policy; Host minimum raises a weaker policy; Editor opens the host values: a threshold out of range is refused by field, the minimum \"agent\" puts a reviewer on an auto policy, the minimum \"human\" keeps every agent from approving, and proposals are never an agent's to accept", async () => {
  const w = await world();
  try {
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    const invalid = await w.admin.fail("jagentchill.orc.team.save", { team: { ...rest, resultApproval: { mode: "agent", threshold: 96 } } });
    assert.deepEqual([invalid.code, invalid.details?.field], ["INVALID_PARAMS", "threshold"]);
    const editorDevice = await w.h.pair("Edit bay", "editor");
    await assert.rejects(editorDevice.call("jagentchill.orc.approval.set", { minimum: "auto" }), /SCOPE_DENIED/);
    assert.deepEqual(await w.admin.call("jagentchill.orc.approval.get", {}), { default: "human", minimum: "auto" });
    // auto, raised to agent by the host: a reviewer decides, and the record says the host raised it.
    await policyTeam(w, { mode: "auto" });
    assert.deepEqual(await w.admin.call("jagentchill.orc.approval.set", { minimum: "agent" }), { default: "human", minimum: "agent" });
    const a = await reviewedRun(w);
    assert.equal((await a.offer()).data.status, "in_review");
    let run = await a.c.run();
    assert.deepEqual([run.approval?.mode, run.approval?.raisedByHostMinimum, run.approval?.source, run.approval?.status], ["agent", true, "team", "reviewing"]);
    // The host now asks for a person: the reviewer's pass is not enough any more — the next offer waits for a person.
    await a.review(SCORES(60, 60, 60, 60), "request_changes");
    await a.c.end(a.directorKey); await a.c.end(await a.reviewerKey());
    await w.admin.call("jagentchill.orc.approval.set", { minimum: "human" });
    assert.equal((await a.offer()).data.status, "waiting_for_signoff");
    run = await a.c.run();
    assert.deepEqual([run.approval?.mode, run.status, run.approval?.reviews?.length], ["human", "waiting_human", 1]);
    assert.equal((await w.fails("jc_review_submit", { scores: SCORES(100, 100, 100, 100), verdict: "approve", summary: "Fine." }, await a.reviewerKey())).code, "CONFLICT", "an agent approved below the host's minimum");
    assert.equal((await a.c.run()).status, "waiting_human");
    // A member's proposal under the minimum "agent": a person decides — never the team's auto policy, never a reviewer.
    await w.admin.call("jagentchill.orc.approval.set", { minimum: "agent" });
    const other = await world();
    try {
      await other.admin.call("jagentchill.orc.approval.set", { minimum: "agent" });
      const got = await other.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
      const { created_ms: _c2, updated_ms: _u2, ...rest2 } = got.team;
      await other.admin.call("jagentchill.orc.team.save", { team: { ...rest2, proposalApproval: { mode: "auto" } } });
      // (run 5: a reviewer agent can be asked for proposals too — `agents-team-f5.test.ts`; here the minimum "agent" raises the saved "auto".)
      const r = await teamRun(other), editor = await r.peer("editor", { grantsWrite: true });
      await other.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, editor.sessionKey);
      const proposalId = await other.submit("DA LAT card", editor.sessionKey);
      await tick(60);
      assert.equal((other.h.app.db.prepare("SELECT state FROM tool_proposals WHERE proposal_id = ?").get(proposalId) as { state: string }).state, "pending");
    } finally { other.close(); }
    void SECTIONS;
  } finally { w.close(); }
});
