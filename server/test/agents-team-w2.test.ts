// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS, billedPerCall, crew as teamCrew, hostClock, until } from "./support/team.ts";
import type { AgentHandoff, AgentRecord, TeamRun } from "@jagentchill/protocol";
import { parseBrief } from "../src/agents/team/runs.ts";
import { tick } from "./harness.ts";
import { S, toolWorld, type ToolWorld } from "./support/tools.ts";

async function world(extra: object = {}, options: object = {}) {
  const clock = hostClock(), w = await toolWorld({ ...options, harness: { now: clock.now, extra: { agentTimings: { notifyBatchMs: 20, retryMs: [10, 10, 10], writerQueueMs: 600 }, ...extra } } });
  clock.bind(w.h);
  return w;
}
function crew(w: ToolWorld) {
  const handoffs = async (as = w.sessionKey): Promise<AgentHandoff[]> => (await w.admin.call("jagentchill.agent.handoff.list", { sessionKey: as })).handoffs;
  return { ...teamCrew(w), handoffs };
}
const pack = { brief: "Check the intro against the brief.", historySummary: "The title card is in; the font is the default." };

test("Activity since a cursor; Reasoning is not leaked; Agent tries to archive its root; Cascade through jc_agent_archive; jc_agent_update renames and relabels; a mode above the caller's is refused with details.maxMode; a profile that is not of the role is refused with details.validProfiles", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A", role: "screenwriter", prompt: "Write five hooks." }), b = await c.spawn({ title: "B" }, a.sessionKey);
    // — activity: what the runtime reported of A's turn, as the server's transcript holds it —
    const fake = w.h.fake;
    fake.emit(a.sessionKey, { type: "reasoning_delta", turnId: c.runOf(a.sessionKey), text: "SECRET-REASONING about the hooks" });
    fake.text(a.sessionKey, "I read the timeline first.");
    fake.tool(a.sessionKey, { id: "c1", name: "jc_timeline_read", input: { scope: "all" }, output: "{...}" });
    fake.tool(a.sessionKey, { id: "c2", name: "exec", input: { command: "cat /etc/SECRET-FILE" }, output: "denied", failed: true });
    await tick();
    const first = (await w.ok("jc_agent_activity", { agentId: a.agentId })).data;
    assert.deepEqual([first.updateCount, first.cursor, first.currentMode], [4, "4", "edit"]);
    assert.match(first.content, /^Asked: Write five hooks\.\nAgent: I read the timeline first\.\nTool jc_timeline_read \{"scope":"all"\} — ok\nTool exec — failed: denied$/);
    assert.doesNotMatch(first.content, /SECRET/);
    fake.text(a.sessionKey, "Hook one.");
    fake.text(a.sessionKey, " Hook two.");
    await c.end(a.sessionKey, "");
    await w.ok("jc_agent_send", { agentId: a.agentId, prompt: "Shorter.", wait: "none" });
    fake.tool(a.sessionKey, { id: "c3", name: "jc_agent_handback", input: { ...SECTIONS, whatChangedOrInspected: "x" }, output: "{}" });
    await c.end(a.sessionKey, "Done.");
    const next = (await w.ok("jc_agent_activity", { agentId: a.agentId, sinceCursor: first.cursor })).data;
    assert.equal(next.updateCount, 4);
    // (The session's own agent is named after the session, whose title is the person's first message.)
    assert.match(next.content, /^Agent: Hook one\. Hook two\.\nAsked: From Make the intro shorter\.: Shorter\.\nTool jc_agent_handback .*\nAgent: Done\.$/);
    assert.equal((await w.fails("jc_agent_activity", { agentId: "agt_nope" })).code, "AGENT_NOT_FOUND");
    // — update —
    const [root] = await c.tree();
    const renamed = (await w.ok("jc_agent_update", { agentId: a.agentId, title: "Hook writer", labels: { topic: "hooks" } })).data;
    assert.deepEqual([renamed.title, renamed.labels.topic, renamed.labels["jc.parent"]], ["Hook writer", "hooks", root.id]);
    assert.equal((await w.fails("jc_agent_update", { agentId: a.agentId, labels: { "jc.team.tier": "lead" } })).code, "INVALID_PARAMS");
    assert.equal((await w.fails("jc_agent_update", { agentId: root.id, title: "Mine" }, a.sessionKey)).code, "AGENT_NOT_OWNED");
    // — mode —
    const above = await w.fails("jc_agent_set_mode", { agentId: a.agentId, mode: "auto" });
    assert.deepEqual([above.code, above.details?.maxMode], ["INVALID_PARAMS", "edit"]);
    const asked = (await w.ok("jc_agent_set_mode", { agentId: a.agentId, mode: "ask" })).data;
    assert.deepEqual([asked.applied, (await c.get(a.agentId)).modeId], ["now", "ask"]);
    assert.equal((await w.fails("jc_agent_set_mode", { agentId: a.agentId, mode: "ask" }, b.sessionKey)).code, "AGENT_NOT_OWNED");
    // — model: a profile of the agent's ORC role, never a free model id —
    const config = await w.admin.call("jagentchill.orc.config.get", {});
    const profile = (id: string, model: string) => ({ id, runtime: "claude-code", provider: "anthropic", model, params: {}, enabled: true });
    await w.admin.call("jagentchill.orc.config.update", { expectedRevision: config.revision, patch: { roles: { screenwriter: { enabled: true, profiles: [profile("large", "sonnet"), profile("small", "opus")], defaultProfileId: "large", routes: { default: { primary: { profileId: "large" }, fallbacks: [{ profileId: "small" }] } }, limits: {} } } } });
    const wrong = await w.fails("jc_agent_set_model", { agentId: a.agentId, profile: "gpt-9" });
    assert.deepEqual([wrong.code, wrong.details?.validProfiles], ["INVALID_PARAMS", ["large", "small"]]);
    await c.end(b.sessionKey); await c.rest(a.sessionKey);
    const moved = (await w.ok("jc_agent_set_model", { agentId: a.agentId, profile: "small" })).data;
    assert.deepEqual([moved.profile, moved.model, (await c.get(a.agentId)).modelId], ["small", "anthropic/opus", "opus"]);
    assert.equal((await w.fails("jc_agent_set_model", { agentId: b.agentId, profile: "small" }, a.sessionKey)).code, "INVALID_PARAMS", "an agent without a role has no profiles");
    // — archive —
    assert.equal((await w.fails("jc_agent_archive", { agentId: root.id }, a.sessionKey)).code, "AGENT_NOT_OWNED");
    const gone = (await w.ok("jc_agent_archive", { agentId: a.agentId, reason: "not needed" })).data;
    assert.deepEqual([gone.archived, gone.cancelledDescendants], [true, 1]);
    assert.deepEqual((await c.tree()).map((agent) => agent.id), [root.id]);
    assert.ok((await c.get(b.agentId)).archived_ms);
  } finally { w.close(); }
});

test("Task hand-off to an existing sibling; Package too large; Root tries a lead hand-off; Accept; Reject with a note; Second decision; Lead hand-off moves the children; Accepted lead hand-off is traceable", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const [root] = await c.tree();
    const l1 = await c.spawn({ title: "L1" }), l2 = await c.spawn({ title: "L2" });
    const p1 = await c.spawn({ title: "P1" }, l1.sessionKey), p2 = await c.spawn({ title: "P2" }, l1.sessionKey);
    const big = await w.fails("jc_agent_handoff", { to: l2.agentId, scope: "task", package: { ...pack, historySummary: "h".repeat(12_289) } }, l1.sessionKey);
    assert.deepEqual([big.code, big.details?.field], ["INVALID_PARAMS", "package.historySummary"]);
    const fromRoot = await w.fails("jc_agent_handoff", { to: l1.agentId, scope: "lead", package: pack });
    assert.equal(fromRoot.code, "HANDOFF_TARGET_INVALID");
    assert.match(fromRoot.message, /jc_agent_create/);
    assert.equal((await c.handoffs()).length, 0);
    // A task hand-off stays pending until the receiver answers; the sender still owns the task.
    const offered = (await w.ok("jc_agent_handoff", { to: l2.agentId, scope: "task", package: { ...pack, openQuestions: ["Which font?"] } }, p1.sessionKey)).data;
    let [record] = await c.handoffs();
    assert.deepEqual([record.id, record.status, record.fromAgentId, record.toAgentId, record.scope, record.package.openQuestions], [offered.handoffId, "pending", p1.agentId, l2.agentId, "task", ["Which font?"]]);
    assert.match(c.delivered(l2.sessionKey).at(-1)!, /Hand-off from "P1"[\s\S]*Brief:\nCheck the intro against the brief\.[\s\S]*What was tried and decided:[\s\S]*Open questions:\n- Which font\?/);
    assert.equal((await c.get(l2.agentId)).ownerAgentId, root.id);
    // Only the receiver accepts or rejects; a rejection needs a note and reaches the sender.
    assert.equal((await w.fails("jc_agent_handoff_respond", { handoffId: offered.handoffId, decision: "accept" }, p2.sessionKey)).code, "AGENT_NOT_OWNED");
    assert.equal((await w.fails("jc_agent_handoff_respond", { handoffId: offered.handoffId, decision: "reject" }, l2.sessionKey)).code, "INVALID_PARAMS");
    await w.ok("jc_agent_handoff_respond", { handoffId: offered.handoffId, decision: "reject", note: "Missing the approved script version" }, l2.sessionKey);
    [record] = await c.handoffs();
    assert.deepEqual([record.status, record.note, record.decidedBy?.kind], ["rejected", "Missing the approved script version", "agent"]);
    await until(() => /rejected your hand-off[\s\S]*Missing the approved script version/.test(c.delivered(p1.sessionKey).at(-1) ?? ""), "the sender to hear of the rejection");
    assert.equal((await c.get(l2.agentId)).ownerAgentId, root.id);
    // Accepted task hand-off: the receiver reports to whoever the sender reported to.
    const task = (await w.ok("jc_agent_handoff", { to: p2.agentId, scope: "task", package: pack }, p1.sessionKey)).data;
    assert.equal((await w.ok("jc_agent_handoff_respond", { handoffId: task.handoffId, decision: "accept" }, p2.sessionKey)).data.status, "accepted");
    assert.deepEqual([(await c.get(p2.agentId)).ownerAgentId, (await c.get(p2.agentId)).handoff, (await c.get(p1.agentId)).handoff, (await c.get(p2.agentId)).parentId], [l1.agentId, "received", "handed_off", l1.agentId]);
    await assert.rejects(w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: task.handoffId, decision: "reject", note: "late" }), /HANDOFF_NOT_PENDING/);
    assert.equal((await c.handoffs())[0].status, "accepted");
    // Lead hand-off, accepted by a person from the card: the children move with it.
    const lead = (await w.ok("jc_agent_handoff", { to: l2.agentId, scope: "lead", package: pack }, l1.sessionKey)).data;
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.agent.handoff.resolve", { handoffId: lead.handoffId, decision: "accept" }), /SCOPE_DENIED/);
    const resolved = (await w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: lead.handoffId, decision: "accept" })).handoff as AgentHandoff;
    assert.deepEqual([resolved.status, resolved.decidedBy?.kind], ["accepted", "device"]);
    assert.deepEqual([(await c.get(p1.agentId)).ownerAgentId, (await c.get(p2.agentId)).ownerAgentId, (await c.get(p1.agentId)).parentId, (await c.get(l2.agentId)).ownerAgentId], [l2.agentId, l2.agentId, l1.agentId, root.id]);
    assert.equal((await w.fails("jc_agent_cancel", { agentId: p1.agentId }, l1.sessionKey)).code, "AGENT_NOT_OWNED");
    const before = c.delivered(l2.sessionKey).length;
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "P1 is done." }, p1.sessionKey);
    await c.end(p1.sessionKey, "Handed back.");
    await until(() => c.delivered(l2.sessionKey).length > before && /"title": "P1"/.test(c.delivered(l2.sessionKey).at(-1)!), "P1's hand-back to reach the new lead");
    assert.equal(c.delivered(l1.sessionKey).some((text) => /"title": "P1"/.test(text)), false);
    // The trail: created and accepted, the second by a device, with who owned what before and after.
    const trail = (w.h.app.db.prepare("SELECT details FROM audit WHERE action = 'agent.handoff' ORDER BY rowid").all() as { details: string }[]).map((row) => JSON.parse(row.details)).filter((row) => row.recordId === lead.handoffId);
    assert.deepEqual(trail.map((row) => [row.action, row.actor.kind]), [["created", "agent"], ["accepted", "device"]]);
    assert.deepEqual([trail[1].ownershipBefore[p1.agentId], trail[1].ownershipAfter[p1.agentId], trail[1].packageDigest.length], [l1.agentId, l2.agentId, 64]);
  } finally { w.close(); }
});

test("Detach a running child; Detached child survives; Detach inside a team run", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A" }), b = await c.spawn({ title: "B" }, a.sessionKey), b1 = await c.spawn({ title: "B1" }, b.sessionKey);
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.agent.detach", { agentId: b.agentId }), /SCOPE_DENIED/);
    assert.equal((await w.fails("jc_agent_update", { agentId: b.agentId, title: "x" }, b.sessionKey)).code, "AGENT_NOT_OWNED", "no agent tool detaches or acts on itself");
    const aborts = w.h.fake.callsOf("interrupt").length;
    const detached = (await w.admin.call("jagentchill.agent.detach", { agentId: b.agentId })).agent as AgentRecord;
    assert.deepEqual([detached.depth, detached.rootId, detached.parentId, detached.ownerAgentId, detached.state, typeof detached.detached_ms], [0, b.agentId, undefined, undefined, "running", "number"]);
    assert.equal(w.h.fake.callsOf("interrupt").length, aborts, "its turn goes on uninterrupted");
    // It left its parent's tree with everything below it, and is a session of its own in the list.
    assert.deepEqual((await c.tree()).map((agent) => agent.title), [(await c.tree())[0].title, "A"]);
    assert.deepEqual((await c.tree(b.sessionKey)).map((agent) => [agent.title, agent.depth, agent.rootId]), [["B", 0, b.agentId], ["B1", 1, b.agentId]]);
    assert.equal((await w.admin.call("jagentchill.session.list", {})).sessions.some((session: { sessionKey: string }) => session.sessionKey === b.sessionKey), true);
    // Archiving the former parent does not reach it.
    await w.ok("jc_agent_archive", { agentId: a.agentId });
    const after = await c.get(b.agentId);
    assert.deepEqual([after.archived_ms, after.state, (await c.get(b1.agentId)).archived_ms], [undefined, "running", undefined]);
    // A peer with an active assignment of a team run stays where it is.
    const second = await w.session();
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: second, teamId: "video-production" });
    await w.admin.call("jagentchill.orc.run.start", { sessionKey: second, request: "Add a title card" });
    const lead = (await w.ok("jc_team_bootstrap_lead", { relay: "A title card at the start." }, await c.director(second))).data;
    const leadKey = (await c.get(lead.leadAgentId)).sessionKey;
    const peer = (await w.ok("jc_team_create_peer", { role: "editor", assignment: "Add the card.", ownershipBoundary: "The text track.", expectedHandback: "One proposal.", grantsWrite: true }, leadKey)).data;
    await assert.rejects(w.admin.call("jagentchill.agent.detach", { agentId: peer.agentId }), /TEAM_SHAPE_VIOLATION.*Cancel or reassign this assignment before detaching the agent|Cancel or reassign this assignment before detaching the agent/);
    assert.equal((await c.get(peer.agentId)).depth, 3);
  } finally { w.close(); }
});

test("Brief from labelled lines; a run goes Director → lead → assignments → acceptance → relay → completed; generic creation is refused inside a run; a second hand-back is refused; a pending proposal blocks acceptance; Request changes; the person's approval relays the result", async () => {
  const brief = parseBrief("Make a 20 s teaser.\nConstraints:\n- Keep the music\n- No new footage\nAcceptance: The teaser is 20 s long\nRoute: script", 1);
  assert.deepEqual([brief.objective, brief.constraints, brief.acceptanceCriteria, brief.routeCategory, brief.validationPlan.length, brief.authoredBy], ["Make a 20 s teaser.", ["Keep the music", "No new footage"], ["The teaser is 20 s long"], "script", 1, "parser"]);
  assert.deepEqual([parseBrief("Review the intro", 1).routeCategory, parseBrief("Find b-roll and compare options", 1).routeCategory, parseBrief("Trim the first clip", 1).routeCategory, parseBrief("Xin chào", 1).routeCategory], ["audit", "research", "edit", "edit"]);
  assert.match(brief.normalizedPrompt, /^Objective: Make a 20 s teaser\.\nConstraints:\n- Keep the music/);
  const w = await world(), c = crew(w);
  try {
    await assert.rejects(w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "  " }), /Enter what you want the team to do\./);
    await assert.rejects(w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title" }), /TEAM_NOT_FOUND/);
    assert.equal((await w.fails("jc_team_bootstrap_lead", { relay: "x" })).code, "TEAM_SHAPE_VIOLATION");
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title" }), /SCOPE_DENIED/);
    const started = await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title card\nAcceptance: The card reads DA LAT" });
    assert.deepEqual([started.ok, started.status, started.brief.acceptanceCriteria, started.runId.slice(0, 4)], [true, "running", ["The card reads DA LAT"], "run_"]);
    // The Director is an agent of its own: the instruction is ITS first message, and nothing of it is sent into the person's session.
    const dKey = await c.director();
    assert.match(c.delivered(dKey)[0], /You are the Director of the team "Video production team"[\s\S]*Objective: Add a title card[\s\S]*jc_team_bootstrap_lead/);
    assert.deepEqual([c.delivered(w.sessionKey).length, (await c.get((await c.run()).supervisorAgentId)).tier, (await c.get((await c.run()).supervisorAgentId)).depth], [0, "supervisor", 1]);
    assert.deepEqual([(await c.run()).status, (await c.run()).stage], ["running", "supervisor"]);
    await assert.rejects(w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Another" }), /CONFLICT/);
    // The shape of the run is held by the tools, not by the prompt.
    const generic = await w.fails("jc_agent_create", { title: "Editor", prompt: "p", role: "editor" }, dKey);
    assert.deepEqual([generic.code, generic.details?.tool], ["TEAM_SHAPE_VIOLATION", "jc_team_bootstrap_lead"]);
    assert.equal((await w.fails("jc_agent_create", { title: "Editor", prompt: "p", role: "editor" })).code, "TEAM_SHAPE_VIOLATION", "the session's own agent staffs nothing beside the run");
    const lead = (await w.ok("jc_team_bootstrap_lead", { relay: "A title card reading DA LAT at the start." }, dKey)).data;
    assert.equal(lead.reused, false);
    const leadAgent = await c.get(lead.leadAgentId);
    assert.deepEqual([leadAgent.tier, leadAgent.roleLabel, (await c.run()).stage, (await c.run()).leadAgentId, (await c.run()).delegated], ["lead", "Producer", "lead", lead.leadAgentId, true]);
    assert.match(c.delivered(leadAgent.sessionKey)[0], /Human relay:\nA title card reading DA LAT at the start\.[\s\S]*- editor \(Editor\) — edits the project/);
    assert.deepEqual([(await w.ok("jc_team_bootstrap_lead", { relay: "again" }, dKey)).data.reused, (await c.tree()).length], [true, 3]);
    assert.equal((await w.fails("jc_team_create_peer", { role: "editor", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, dKey)).code, "TEAM_SHAPE_VIOLATION", "the Director gives no assignments");
    assert.equal((await w.fails("jc_agent_create", { title: "E", prompt: "p", role: "editor" }, leadAgent.sessionKey)).details?.tool, "jc_team_create_peer");
    assert.equal((await w.fails("jc_team_create_peer", { role: "producer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, leadAgent.sessionKey)).code, "TEAM_ROLE_DENIED");
    const editor = (await w.ok("jc_team_create_peer", { role: "editor", title: "Title editor", assignment: "Add the card DA LAT.", ownershipBoundary: "The text track only.", expectedHandback: "One proposal.", grantsWrite: true }, leadAgent.sessionKey)).data;
    const reviewer = (await w.ok("jc_team_create_peer", { role: "reviewer", assignment: "Check the card.", ownershipBoundary: "Reads only.", expectedHandback: "A verdict." }, leadAgent.sessionKey)).data;
    const editorKey = (await c.get(editor.agentId)).sessionKey, reviewerKey = (await c.get(reviewer.agentId)).sessionKey;
    assert.match(c.delivered(editorKey)[0], /working as Editor \(peer\)[\s\S]*Assignment:\nAdd the card DA LAT\.\n\nOwnership boundary: The text track only\.\nExpected hand-back: One proposal\./);
    let run = await c.run();
    assert.deepEqual([run.stage, run.assignments.map((entry) => [entry.id.slice(0, 4), entry.roleId, entry.status, entry.grantsWrite, entry.title])], ["assignments", [["asg_", "editor", "active", true, "Title editor"], ["asg_", "reviewer", "active", false, "Reviewer"]]]);
    assert.equal((await w.fails("jc_team_accept_result", { summary: "s", evidence: "e", remainingUncertainty: "None" }, leadAgent.sessionKey)).details?.activeAssignments.length, 2);
    assert.equal((await w.fails("jc_team_accept_result", { summary: "s", evidence: "e", remainingUncertainty: "None" }, editorKey)).code, "TEAM_SHAPE_VIOLATION");
    // The peers hand back; the second hand-back of one assignment is refused.
    await w.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, editorKey);
    const proposalId = await w.submit("DA LAT card", editorKey);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the card." }, editorKey);
    assert.equal((await w.fails("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Again." }, editorKey)).code, "CONFLICT");
    await c.end(editorKey, "Handed back.");
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "The card is right." }, reviewerKey);
    await c.end(reviewerKey, "Handed back.");
    run = await c.run();
    assert.deepEqual([run.stage, run.assignments.map((entry) => entry.status), (await c.get(editor.agentId)).grantsWrite], ["acceptance", ["handed_back", "handed_back"], false]);
    // The person has not decided on the editor's proposal: the result cannot be accepted yet.
    const early = await w.fails("jc_team_accept_result", { summary: "The card is in.", evidence: "Proposal DA LAT card.", remainingUncertainty: "None" }, leadAgent.sessionKey);
    assert.deepEqual([early.code, early.details?.pendingProposals], ["CONFLICT", [proposalId]]);
    assert.equal((await c.run()).awaitingProposals, true);
    await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
    // The outcome goes to the editor; once its turn ended the lead is told that nothing waits for the person any more.
    await until(() => /was accepted and applied/.test(c.delivered(editorKey).at(-1) ?? "") && w.h.app.relay.isRunning(editorKey), "the outcome to reach the editor");
    await c.end(editorKey, "Noted.");
    await until(() => /Every proposal of this run was decided\.[\s\S]*- DA LAT card: accepted/.test(c.delivered(leadAgent.sessionKey).at(-1) ?? ""), "the lead to hear that the proposals are decided");
    assert.equal((await c.run()).awaitingProposals, undefined);
    const asked = (await w.ok("jc_team_accept_result", { summary: "The card is in.", evidence: "Proposal DA LAT card was accepted.", remainingUncertainty: "None" }, leadAgent.sessionKey)).data;
    assert.deepEqual([asked.status, asked.approval], ["waiting_for_signoff", "human"]);
    run = await c.run();
    assert.deepEqual([run.status, run.waitingReason, run.approval?.mode, run.approval?.source, run.approval?.status, (await c.tree())[0].attention], ["waiting_human", "signoff", "human", "host_default", "pending", "approval"]);
    assert.equal((await w.fails("jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, leadAgent.sessionKey)).code, "TEAM_SHAPE_VIOLATION");
    // Request changes: the lead gets the note and the run goes on.
    await assert.rejects(viewer.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "approve" }), /SCOPE_DENIED/);
    await assert.rejects(w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "request_changes" }), /Say what should change\./);
    await w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "request_changes", note: "Say which font was used." });
    run = await c.run();
    assert.deepEqual([run.status, run.stage, run.approval?.status, run.approval?.rounds.map((round) => [round.verdict, round.decidedBy.kind])], ["running", "acceptance", "changes_requested", [["request_changes", "device"]]]);
    await until(() => /asked for changes[\s\S]*Say which font was used\./.test(c.delivered(leadAgent.sessionKey).at(-1) ?? ""), "the lead to get the note");
    await w.ok("jc_team_accept_result", { summary: "The card is in, in the default font.", evidence: "Proposal DA LAT card was accepted.", remainingUncertainty: "None" }, leadAgent.sessionKey);
    await w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "approve" });
    await assert.rejects(w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "approve" }), /ALREADY_RESOLVED/);
    run = await c.run();
    assert.deepEqual([run.status, run.stage, run.acceptedResult?.summary, run.acceptedResult?.artefacts.map((entry) => entry.title), run.assignments.map((entry) => entry.status), (await c.tree())[0].attention], ["running", "relay", "The card is in, in the default font.", ["DA LAT card"], ["accepted", "accepted"], "none"]);
    await until(() => /The result was accepted[\s\S]*Report this to the user without changing the decision\.$/.test(c.delivered(dKey).at(-1) ?? ""), "the Director to be told");
    await c.end(dKey, "The title card DA LAT is in.");
    // The Director's report is what the person's session hears of the run — once, as a settled-agent note, not as an instruction.
    await until(() => c.delivered(w.sessionKey).some((text) => /The title card DA LAT is in\./.test(text)), "the Director's report to reach the person's session");
    assert.equal(c.delivered(w.sessionKey).some((text) => /You are the Director|jc_team_bootstrap_lead|\[Team run/.test(text)), false);
    run = await c.run();
    assert.deepEqual([run.status, run.stage, run.endReason, run.events.map((event) => event.kind)], ["completed", undefined, "reported",
      ["run.started", "stage.supervisor", "stage.lead", "assignment.created", "assignment.created", "assignment.handed_back", "assignment.handed_back", "proposals.decided", "signoff.requested", "signoff.changes_requested", "signoff.requested", "stage.relay", "run.completed"]]);
    // The next request gets a fresh sub-tree: the members of the finished run leave the lists.
    await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Now add an end card" });
    assert.deepEqual([(await c.tree()).length, (await w.admin.call("jagentchill.orc.run.list", { sessionKey: w.sessionKey })).runs.length, (await c.get(lead.leadAgentId)).state], [2, 2, "closed"]);
    const cancelled = (await w.admin.call("jagentchill.orc.run.cancel", { runId: (await c.run()).id, reason: "changed my mind" })).run as TeamRun;
    assert.deepEqual([cancelled.status, cancelled.endReason], ["cancelled", "changed my mind"]);
  } finally { w.close(); }
});

test("Approval policy: a team's auto policy accepts the result at once; Host minimum raises a weaker policy; a team's proposal policy accepts a member's proposal in edit mode; the preset \"team\" lets the members of a run talk to each other", async () => {
  const w = await world(), c = crew(w);
  try {
    assert.deepEqual(await w.admin.call("jagentchill.orc.approval.get", {}), { default: "human", minimum: "auto" });
    assert.deepEqual(await w.admin.call("jagentchill.agent.policy.get", {}), { preset: "tree" });
    const editorDevice = await w.h.pair("Edit bay", "editor");
    await assert.rejects(editorDevice.call("jagentchill.orc.approval.set", { minimum: "human" }), /SCOPE_DENIED/);
    await assert.rejects(editorDevice.call("jagentchill.agent.policy.set", { preset: "team" }), /SCOPE_DENIED/);
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, resultApproval: { mode: "auto" }, proposalApproval: { mode: "auto" } } });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title card" });
    const dKey = await c.director();
    const lead = (await w.ok("jc_team_bootstrap_lead", { relay: "A title card." }, dKey)).data, leadKey = (await c.get(lead.leadAgentId)).sessionKey;
    const editor = (await w.ok("jc_team_create_peer", { role: "editor", assignment: "Add the card.", ownershipBoundary: "Text track.", expectedHandback: "One proposal.", grantsWrite: true }, leadKey)).data;
    const reviewer = (await w.ok("jc_team_create_peer", { role: "reviewer", assignment: "Check it.", ownershipBoundary: "Reads only.", expectedHandback: "A verdict." }, leadKey)).data;
    const editorKey = (await c.get(editor.agentId)).sessionKey, reviewerKey = (await c.get(reviewer.agentId)).sessionKey;
    // Who can call whom: a peer reaches the agent it reports to; its teammates only under the preset "team".
    assert.equal((await w.fails("jc_agent_send", { agentId: reviewer.agentId, prompt: "Which font do you expect?" }, editorKey)).code, "AGENT_POLICY_DENIED");
    assert.deepEqual(await w.admin.call("jagentchill.agent.policy.set", { preset: "team" }), { preset: "team" });
    assert.equal((await w.ok("jc_agent_send", { agentId: reviewer.agentId, prompt: "Which font do you expect?", wait: "none" }, editorKey)).data.delivered, "followup");
    // The member's proposal is accepted by the team's policy although the session is in edit mode.
    await w.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, editorKey);
    const proposalId = await w.submit("DA LAT card", editorKey);
    await until(() => (w.h.app.db.prepare("SELECT state FROM tool_proposals WHERE proposal_id = ?").get(proposalId) as { state: string }).state === "accepted", "the proposal to be accepted by policy");
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added." }, editorKey); await c.end(editorKey);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Fine." }, reviewerKey); await c.end(reviewerKey);
    const accepted = (await w.ok("jc_team_accept_result", { summary: "Done.", evidence: "The proposal.", remainingUncertainty: "None" }, leadKey)).data;
    assert.deepEqual([accepted.status, accepted.approval], ["accepted", "auto"]);
    let run = await c.run();
    assert.deepEqual([run.stage, run.approval?.status, run.approval?.source, run.approval?.raisedByHostMinimum, run.approval?.rounds[0].note, run.approval?.rounds[0].decidedBy.kind], ["relay", "approved", "team", false, "Auto-approved by policy", "policy"]);
    await until(() => /Report this to the user without changing the decision\.$/.test(c.delivered(dKey).at(-1) ?? ""), "the Director to be told");
    await c.end(dKey, "Reported.");
    assert.equal((await c.run()).status, "completed");
    // The host minimum raises the team's weaker policy: the next result waits for a person.
    assert.deepEqual(await w.admin.call("jagentchill.orc.approval.set", { minimum: "human" }), { default: "human", minimum: "human" });
    await w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Check the pacing" });
    const own = (await w.ok("jc_team_accept_result", { summary: "The pacing is fine.", evidence: "Read the timeline.", remainingUncertainty: "None" }, await c.director())).data;
    assert.equal(own.status, "waiting_for_signoff");
    run = await c.run();
    assert.deepEqual([run.delegated, run.status, run.approval?.mode, run.approval?.source, run.approval?.raisedByHostMinimum], [false, "waiting_human", "human", "team", true]);
    await w.admin.call("jagentchill.orc.signoff.resolve", { runId: run.id, decision: "reject", note: "Not what I asked." });
    run = await c.run();
    assert.deepEqual([run.status, run.approval?.status, /rejected by a person: Not what I asked\./.test(run.endReason ?? "")], ["failed", "rejected", true]);
  } finally { w.close(); }
});

test("A turn the server starts itself (the outcome of a proposal) does not reset the tree's loop counters", async () => {
  const w = await world(), c = crew(w);
  try {
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, limits: { ...rest.limits, maxRunTurns: 3 } } });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    await c.prompt();                                                                                           // turn 1: the person's prompt
    const editor = await c.spawn({ title: "Editor", role: "editor", grantsWrite: true, wait: "none" });        // turn 2: the editor's first message
    await w.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, editor.sessionKey);
    const proposalId = await w.submit("DA LAT card", editor.sessionKey);
    await c.end(editor.sessionKey);
    const sends = c.delivered(editor.sessionKey).length;
    await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
    await until(() => c.delivered(editor.sessionKey).length > sends, "the outcome to reach the editor");       // turn 3: started by the server
    assert.match(c.delivered(editor.sessionKey).at(-1)!, /was accepted and applied/);
    await until(() => w.h.app.relay.isRunning(editor.sessionKey), "the editor's turn");
    // The counters were not started again: the tree is at its ceiling of 3 and starts nothing more.
    const refused = await w.fails("jc_agent_create", { title: "Reviewer", prompt: "Check it.", role: "reviewer" });
    assert.deepEqual([refused.code, refused.details?.guard, refused.details?.limit], ["AGENT_LOOP_DETECTED", "turns", 3]);
    assert.deepEqual((await c.tree())[0].deliveryPaused, { limit: 3 });
    assert.equal((await w.ok("jc_agent_cancel", { agentId: editor.agentId })).data.agentId, editor.agentId);
  } finally { w.close(); }
});

test("Team budget in USD: the run stops at the team's cost ceiling when the runtime reports what its turns cost; a runtime that reports tokens only, on a model without a price, counts tokens and is not stopped", async () => {
  const w = await world(), c = crew(w), fake = w.h.fake;
  // Both CLIs are signed in with an API key: their turns are paid per call. Claude Code reports the cost of a turn; Codex reports tokens only, and its model has no price on this host.
  await billedPerCall(w.h, ["claude-code", "codex"]);
  const endWith = async (sessionKey: string, usage: { input: number; output: number; costUsd?: number }) => {
    fake.reply(sessionKey, "Done.", { runId: c.runOf(sessionKey), usage: { inputTokens: usage.input, outputTokens: usage.output, ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}) } });
    await until(() => !w.h.app.relay.isRunning(sessionKey), "the turn to end");
    await tick(40);
  };
  try {
    const open = async (ref: { runtimeId: string; providerId: string; modelId: string }) => {
      const key = (await w.admin.call("jagentchill.session.create", { ref, projectId: w.project.doc.metadata.id })).session.sessionKey as string;
      await w.admin.call("jagentchill.session.access.set", { sessionKey: key, access: "host" });
      return key;
    };
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, limits: { ...rest.limits, maxRunCostUsd: 0.5 } } });
    const session = await open({ runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: session, teamId: "video-production" });
    assert.equal((await c.tree(session))[0].budget.limitUsd, 0.5);
    await c.prompt(session);
    const editor = await c.spawn({ title: "Editor", role: "editor", wait: "none" }, session);
    assert.equal((await c.get(editor.agentId)).modelId, "sonnet");
    // The runtime reports $0.30 for a turn; the second turn takes the tree over $0.50.
    await endWith(editor.sessionKey, { input: 200, output: 100, costUsd: 0.3 });
    await until(async () => (await c.get(editor.agentId)).usage.costUsd === 0.3, "the editor's cost");
    assert.deepEqual([(await c.get(editor.agentId)).usage.costKnown, (await c.tree(session))[0].budget.spentUsd, (await c.tree(session))[0].budget.exhausted], [true, 0.3, false]);
    const reviewer = await c.spawn({ title: "Reviewer", role: "reviewer", wait: "none" }, session);
    await endWith(reviewer.sessionKey, { input: 200, output: 100, costUsd: 0.3 });
    await until(async () => (await c.tree(session))[0].budget.spentUsd === 0.6, "the tree's cost");
    const stopped = await w.fails("jc_agent_create", { title: "One more", prompt: "p", role: "reviewer" }, session);
    assert.deepEqual([stopped.code, stopped.details?.scope, stopped.details?.limitUsd, stopped.details?.spentUsd], ["BUDGET_EXCEEDED", "agent", 0.5, 0.6]);
    assert.equal((await c.tree(session))[0].budget.exhausted, true);
    await assert.rejects(w.admin.call("jagentchill.agent.send", { agentId: editor.agentId, prompt: "More." }), /BUDGET_EXCEEDED/);
    // The same team on a runtime that reports tokens only, for a model with no price: tokens are counted, no cost is known, nothing is stopped.
    const other = await open({ runtimeId: "codex", providerId: "openai", modelId: "gpt-x" });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: other, teamId: "video-production" });
    await c.prompt(other);
    const cheap = await c.spawn({ title: "Editor", role: "editor", wait: "none" }, other);
    assert.equal((await c.get(cheap.agentId)).modelId, "gpt-x");
    await endWith(cheap.sessionKey, { input: 900_000, output: 900_000 });
    await until(async () => (await c.get(cheap.agentId)).usage.inputTokens === 900_000, "the tokens of the unpriced turn");
    const after = await c.get(cheap.agentId);
    assert.deepEqual([after.usage.costKnown, after.usage.costUsd, (await c.tree(other))[0].budget.exhausted], [false, 0, false]);
    assert.equal((await w.ok("jc_agent_create", { title: "Reviewer", prompt: "p", role: "reviewer", wait: "none" }, other)).data.role, "reviewer");
  } finally { w.close(); }
});
