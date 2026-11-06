// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
// One test per finding of the review `.dev/orc/w2-multi-agent.review.md`; each was seen failing on the code it corrects.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRecord, TeamRun } from "@jagentchill/protocol";
import { tick } from "./harness.ts";
import { S } from "./support/tools.ts";
import { SECTIONS, TIMINGS, crew, deliveries, proposalState, teamRun, until, world } from "./support/team.ts";

test("Review 1 — Host minimum raises a weaker policy: with a human minimum no member's proposal is accepted without a person, whether the team has no proposal policy, an auto policy, or the session is in auto mode", async () => {
  const w = await world({ mode: "auto" }), c = crew(w);
  try {
    await w.admin.call("jagentchill.orc.approval.set", { minimum: "human" });
    // A team WITHOUT a proposal policy, a session in auto mode: the fallback is the mode, and the host minimum still holds.
    const { peer } = await teamRun(w);
    const editor = await peer("editor", { grantsWrite: true });
    assert.equal((await c.get(editor.agentId)).modeId, "auto", "the member inherited auto mode");
    await w.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, editor.sessionKey);
    const proposalId = await w.submit("DA LAT card", editor.sessionKey);
    await tick(150);
    assert.equal(proposalState(w, proposalId), "pending", "an auto member accepted its own proposal under a human minimum");
    // The person decides it.
    await w.accept(proposalId);
    assert.equal(proposalState(w, proposalId), "accepted");
    // A session of its own in auto mode is held to the same minimum.
    const solo = await w.session();
    await w.write("jc_text_add", { content: "SOLO", start: 0, duration: 3 * S }, solo);
    const own = await w.submit("Solo card", solo);
    await tick(150);
    assert.equal(proposalState(w, own), "pending");
    // Without the minimum, auto mode accepts as before.
    await w.admin.call("jagentchill.proposal.resolve", { proposalId: own, action: "reject" });
    await w.admin.call("jagentchill.orc.approval.set", { minimum: "auto" });
    await w.write("jc_text_add", { content: "SOLO 2", start: 0, duration: 3 * S }, solo);
    const free = await w.submit("Solo card 2", solo);
    await until(() => proposalState(w, free) === "accepted", "auto mode to accept without a minimum");
  } finally { w.close(); }
});

test("Review 2 — Sibling tries to cancel a sibling; Unknown or foreign id; Default preset: under `tree` an agent reads itself and what is below it, of the agents above it only name and state, and nothing of a sibling or of another session; refusals are audited as denied", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const [root] = await c.tree();
    const a = await c.spawn({ title: "A" }), b = await c.spawn({ title: "B" }), a1 = await c.spawn({ title: "A1", wait: "none" }, a.sessionKey);
    w.h.seedHistory(b.sessionKey, [{ role: "user", content: "SECRET-B assignment" }, { role: "assistant", content: "SECRET-B answer" }]);
    w.h.seedHistory(w.sessionKey, [{ role: "user", content: "SECRET-ROOT prompt" }, { role: "assistant", content: "SECRET-ROOT answer" }]);
    // A sibling: not readable at all, and the answer does not say that it exists.
    for (const tool of ["jc_agent_status", "jc_agent_activity"]) assert.equal((await w.fails(tool, { agentId: b.agentId }, a.sessionKey)).code, "AGENT_NOT_FOUND", `${tool} of a sibling`);
    assert.equal((await w.fails("jc_agent_wait", { agentIds: [b.agentId], mode: "notify" }, a.sessionKey)).code, "AGENT_NOT_FOUND");
    assert.equal((await w.fails("jc_agent_send", { agentId: b.agentId, prompt: "What are you doing?" }, a.sessionKey)).code, "AGENT_POLICY_DENIED");
    assert.equal((await w.fails("jc_agent_cancel", { agentId: b.agentId }, a.sessionKey)).code, "AGENT_NOT_OWNED");
    assert.equal((await c.get(b.agentId)).state, "running", "the sibling keeps running");
    // An agent above: who it is and whether it works; not what it did, spent or was told.
    const up = (await w.ok("jc_agent_status", { agentId: root.id }, a1.sessionKey)).data;
    assert.deepEqual(Object.keys(up).sort(), ["agentId", "state", "title"]);
    assert.deepEqual(Object.keys((await w.ok("jc_agent_status", { agentId: a.agentId }, a1.sessionKey)).data).sort(), ["agentId", "state", "title"]);
    const upActivity = await w.fails("jc_agent_activity", { agentId: root.id }, a1.sessionKey);
    assert.equal(upActivity.code, "AGENT_NOT_OWNED");
    assert.doesNotMatch(JSON.stringify(upActivity), /SECRET/);
    // Its owner can be waited for, without the owner's result; an agent further up cannot.
    await c.end(a.sessionKey, "SECRET-A result");
    const waited = (await w.ok("jc_agent_wait", { agentIds: [a.agentId], mode: "notify" }, a1.sessionKey)).data;
    assert.deepEqual([waited.settled.length, waited.settled[0].result, /SECRET/.test(JSON.stringify(waited))], [1, undefined, false]);
    assert.equal((await w.fails("jc_agent_wait", { agentIds: [root.id], mode: "notify" }, a1.sessionKey)).code, "AGENT_NOT_OWNED");
    // The list of the whole tree: what is below in full, what is above by identity, nothing else.
    const listed = (await w.ok("jc_agent_list", { scope: "tree" }, a.sessionKey)).data.agents as { agentId: string; lastMessagePreview?: string; above?: boolean }[];
    assert.deepEqual(listed.map((entry) => [entry.agentId, entry.above === true, "lastMessagePreview" in entry]).sort(), [[a1.agentId, false, true], [root.id, true, false]].sort());
    assert.deepEqual(((await w.ok("jc_agent_list", { scope: "tree" }, a1.sessionKey)).data.agents as { agentId: string }[]).map((entry) => entry.agentId).sort(), [a.agentId, root.id].sort());
    // Below: everything, also for the grandparent.
    assert.equal((await w.ok("jc_agent_status", { agentId: a1.agentId })).data.state, "running");
    assert.equal((await w.ok("jc_agent_activity", { agentId: b.agentId })).data.agentId, b.agentId);
    // Another session's agent: the same answer as for an id nobody has.
    const other = await w.session();
    for (const tool of ["jc_agent_status", "jc_agent_activity", "jc_agent_cancel", "jc_agent_archive"]) {
      const foreign = await w.fails(tool, { agentId: a.agentId }, other), missing = await w.fails(tool, { agentId: "agt_01HZZZZZZZZZZZZZZZZZZZZZZZ" }, other);
      assert.deepEqual([foreign.code, foreign.message.replace(a.agentId, "X")], ["AGENT_NOT_FOUND", missing.message.replace("agt_01HZZZZZZZZZZZZZZZZZZZZZZZ", "X")], `${tool} of a foreign agent`);
    }
    const denied = w.h.audit("agent.denied");
    assert.ok(denied.some((row: any) => row.outcome === "denied" && row.tool === "jc_agent_cancel" && row.code === "AGENT_NOT_OWNED" && row.targetId === b.agentId));
  } finally { w.close(); }
});

test("Review 3 — Lead prompts a Peer directly; Supervisor messages the Lead; no member changes another member's mode or model", async () => {
  const w = await world(), c = crew(w);
  try {
    const { leadId, leadKey, directorKey, peer } = await teamRun(w);
    const editor = await peer("editor", { grantsWrite: true });
    // The lead gives bounded assignments; it never prompts a peer.
    const direct = await w.fails("jc_agent_send", { agentId: editor.agentId, prompt: "Also change the font." }, leadKey);
    assert.equal(direct.code, "TEAM_SHAPE_VIOLATION");
    assert.match(direct.message, /jc_team_create_peer/);
    assert.equal((await w.fails("jc_agent_send", { agentId: editor.agentId, prompt: "Hurry." }, directorKey)).code, "TEAM_SHAPE_VIOLATION", "the Director does not prompt a peer either");
    assert.equal(c.delivered(editor.sessionKey).length, 1, "nothing but its assignment reached the peer");
    assert.equal((await w.ok("jc_agent_send", { agentId: leadId, prompt: "The user wants it by noon.", wait: "none" }, directorKey)).data.agentId, leadId);
    // Mode and model of a member are the role's and the host's: no member sets them for another.
    for (const [tool, args, as] of [["jc_agent_set_mode", { mode: "ask" }, leadKey], ["jc_agent_set_model", {}, leadKey], ["jc_agent_set_mode", { mode: "ask" }, directorKey]] as const) {
      assert.equal((await w.fails(tool, { agentId: editor.agentId, ...args }, as)).code, "TEAM_SHAPE_VIOLATION", `${tool} on a member`);
    }
    assert.equal((await c.get(editor.agentId)).modeId, "edit");
    // The lead still cancels its own peer.
    assert.equal((await w.ok("jc_agent_cancel", { agentId: editor.agentId }, leadKey)).data.agentId, editor.agentId);
    assert.equal((await w.ok("jc_team_create_peer", { role: "reviewer", assignment: "Check it.", ownershipBoundary: "Reads only.", expectedHandback: "A verdict." }, leadKey)).data.roleId, "reviewer");
  } finally { w.close(); }
});

test("Review 4 — a runtime that does not confirm a stop still stops the member: the cancel answers within the stop's bound, the turn is ended by the server, and the assignment is cancelled", async () => {
  const w = await world(), c = crew(w);
  try {
    const { leadKey, peer } = await teamRun(w);
    const editor = await peer("editor", { grantsWrite: true });
    // The runtime takes the stop request but never reports the end of the turn.
    w.h.fake.on("interrupt", () => ({ keepRunning: true }));
    const started = Date.now();
    assert.equal((await w.ok("jc_agent_cancel", { agentId: editor.agentId }, leadKey)).data.agentId, editor.agentId);
    assert.ok(Date.now() - started < 7000, "the cancel answered within the stop's bound");
    assert.deepEqual([w.h.fake.callsOf("interrupt").some((call) => call.sessionKey === editor.sessionKey), w.h.app.relay.isRunning(editor.sessionKey), w.h.fake.isOpen(editor.sessionKey)], [true, false, false], "asked to stop, then ended and closed by the server");
    await until(async () => (await c.run()).assignments[0].status === "cancelled", "the assignment to be cancelled");
    assert.deepEqual([(await c.get(editor.agentId)).state, (await c.run()).status], ["idle", "running"]);
    w.h.fake.reset("interrupt");
  } finally { w.close(); }
});

test("Review 5 — Cascade follows ownership: agents handed to another owner are neither stopped nor archived with their former parent and stay under their owner; Detach inside a team run covers everything that would move", async () => {
  const w = await world(), c = crew(w);
  const pack = { brief: "Take over the cut.", historySummary: "The intro is trimmed." };
  const handLead = async (fromKey: string, toId: string, as = w.sessionKey) => {
    const offered = (await w.ok("jc_agent_handoff", { to: toId, scope: "lead", package: pack }, fromKey)).data;
    await w.admin.call("jagentchill.agent.handoff.resolve", { handoffId: offered.handoffId, decision: "accept" });
    void as;
  };
  try {
    await c.prompt();
    const l1 = await c.spawn({ title: "L1" }), l2 = await c.spawn({ title: "L2" });
    const p1 = await c.spawn({ title: "P1" }, l1.sessionKey), p2 = await c.spawn({ title: "P2" }, l1.sessionKey);
    await handLead(l1.sessionKey, l2.agentId);
    assert.deepEqual([(await c.get(p1.agentId)).ownerAgentId, (await c.get(p1.agentId)).parentId], [l2.agentId, l1.agentId]);
    // Cancel of the former parent: its own turn stops, the agents it handed off keep working.
    const aborted = () => w.h.fake.callsOf("interrupt").map((call) => call.sessionKey);
    assert.equal((await w.ok("jc_agent_cancel", { agentId: l1.agentId })).data.cancelledDescendants, 0);
    assert.deepEqual([aborted().includes(l1.sessionKey), aborted().includes(p1.sessionKey), aborted().includes(p2.sessionKey)], [true, false, false]);
    // Archive of the former parent: they stay, alive, under the agent that owns them.
    assert.equal((await w.ok("jc_agent_archive", { agentId: l1.agentId })).data.cancelledDescendants, 0);
    const kept = await c.get(p1.agentId);
    assert.deepEqual([kept.archived_ms, kept.state, kept.parentId, kept.ownerAgentId, kept.depth], [undefined, "running", l2.agentId, l2.agentId, 2]);
    assert.deepEqual((await c.tree()).slice(1).map((agent) => [agent.title, agent.depth]), [["L2", 1], ["P1", 2], ["P2", 2]]);
    assert.ok((await c.get(l1.agentId)).archived_ms);
    // Whoever owns them takes them along.
    assert.equal((await w.ok("jc_agent_archive", { agentId: l2.agentId })).data.cancelledDescendants, 2);
    assert.ok((await c.get(p1.agentId)).archived_ms && aborted().includes(p1.sessionKey));
    // Detach: what was handed to an owner outside stays in the tree; only what reports to the agent leaves with it.
    const third = await w.session();
    await c.prompt(third);
    const b = await c.spawn({ title: "B" }, third), k = await c.spawn({ title: "K" }, third), b1 = await c.spawn({ title: "B1" }, b.sessionKey);
    await handLead(b.sessionKey, k.agentId);
    await w.admin.call("jagentchill.agent.detach", { agentId: b.agentId });
    assert.deepEqual((await c.tree(third)).slice(1).map((agent) => [agent.title, agent.depth, agent.parentId === k.agentId || agent.depth === 1]), [["K", 1, true], ["B1", 2, true]]);
    assert.deepEqual((await c.tree(b.sessionKey)).map((agent) => agent.title), ["B"]);
    assert.equal((await c.get(b1.agentId)).rootId, (await c.tree(third))[0].id);
    // Detach inside a team run: the lead cannot leave while a peer below it works, nor while it leads the run.
    const second = await w.session();
    const { leadId, peer } = await teamRun(w, "Add a title card", second);
    const editor = await peer("editor", { grantsWrite: true });
    const withPeer = await w.admin.fail("jagentchill.agent.detach", { agentId: leadId });
    assert.deepEqual([withPeer.code, withPeer.details?.heldAgentIds.sort()], ["TEAM_SHAPE_VIOLATION", [leadId, editor.agentId].sort()]);
    const still = await c.get(editor.agentId);
    assert.deepEqual([still.depth, still.tier, still.grantsWrite, (await c.get(leadId)).depth, (await c.run(second)).leadAgentId], [3, "peer", true, 2, leadId]);
    await assert.rejects(w.admin.call("jagentchill.agent.detach", { agentId: editor.agentId }), /Cancel or reassign this assignment before detaching the agent/);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added." }, editor.sessionKey); await c.end(editor.sessionKey);
    assert.match((await w.admin.fail("jagentchill.agent.detach", { agentId: leadId })).message, /leads a team run/);
    assert.equal((await c.run(second)).leadAgentId, leadId);
  } finally { w.close(); }
});

test("Review 6 — a person's Stop or Close of a member cancels its assignment once the engine stopped it, so the run can be accepted", async () => {
  const w = await world(), c = crew(w);
  try {
    const { leadKey, peer } = await teamRun(w);
    const editor = await peer("editor", { grantsWrite: true }), reviewer = await peer("reviewer");
    // The runtime confirms each stop with the end of the turn.
    await w.admin.call("jagentchill.agent.stop", { agentId: editor.agentId });
    await until(() => !w.h.app.relay.isRunning(editor.sessionKey), "the stopped turn to end");
    await tick(60);
    assert.deepEqual((await c.run()).assignments.map((entry) => entry.status), ["cancelled", "active"]);
    await w.admin.call("jagentchill.agent.close", { agentId: reviewer.agentId });
    await until(() => !w.h.app.relay.isRunning(reviewer.sessionKey), "the closed agent's turn to end");
    await tick(60);
    const run = await c.run();
    assert.deepEqual([run.assignments.map((entry) => entry.status), run.stage, run.events.filter((event) => event.kind === "assignment.cancelled").length], [["cancelled", "cancelled"], "acceptance", 2]);
    const accepted = (await w.ok("jc_team_accept_result", { summary: "Nothing was changed.", evidence: "Both assignments were stopped by the user.", remainingUncertainty: "None" }, leadKey)).data;
    assert.equal(accepted.status, "waiting_for_signoff");
  } finally { w.close(); }
});

test("Review 7 — two jc_team_bootstrap_lead calls at once make one lead; two starts at once make one run", async () => {
  const w = await world(), c = crew(w);
  try {
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    const starts = await Promise.allSettled([w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add a title card" }), w.admin.call("jagentchill.orc.run.start", { sessionKey: w.sessionKey, request: "Add an end card" })]);
    assert.deepEqual([starts.filter((entry) => entry.status === "fulfilled").length, (await w.admin.call("jagentchill.orc.run.list", { sessionKey: w.sessionKey })).runs.length], [1, 1]);
    const session = w.h.app.relay.session(await c.director())!, tools = w.h.app.team.tools;
    const both = await Promise.all([tools.bootstrapLead(session, { relay: "First." }), tools.bootstrapLead(session, { relay: "Second." })]);
    assert.equal(both[0].leadAgentId, both[1].leadAgentId);
    assert.deepEqual(both.map((entry) => entry.reused).sort(), [false, true]);
    const everyone = (await w.admin.call("jagentchill.agent.tree.get", { sessionKey: w.sessionKey, includeArchived: true })).agents as AgentRecord[];
    assert.deepEqual([everyone.filter((agent) => agent.tier === "lead").length, everyone.length, (await c.run()).leadAgentId], [1, 3, both[0].leadAgentId]);
  } finally { w.close(); }
});

test("Review 8 — Total limit: the assignments of a brief are counted for the current run only; peers of earlier runs do not use up the next one", async () => {
  const w = await world(), c = crew(w);
  try {
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, limits: { ...rest.limits, maxAssignmentsPerBrief: 2 }, resultApproval: { mode: "auto" } } });
    const first = await teamRun(w);
    for (const role of ["editor", "reviewer"]) {
      const member = await first.peer(role);
      await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Done." }, member.sessionKey); await c.end(member.sessionKey);
    }
    const third = await w.fails("jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, first.leadKey);
    assert.deepEqual([third.code, third.details?.limit, third.details?.created], ["TEAM_LIMIT_ASSIGNMENTS", 2, 2]);
    await w.ok("jc_team_accept_result", { summary: "Done.", evidence: "Both handed back.", remainingUncertainty: "None" }, first.leadKey);
    await until(() => /Report this to the user without changing the decision\.$/.test(c.delivered(first.directorKey).at(-1) ?? ""), "the Director to be told");
    await c.end(first.directorKey, "Reported.");
    assert.equal((await c.run()).status, "completed");
    // A fresh run starts at zero.
    const second = await teamRun(w, "Now add an end card");
    const again = await second.peer("editor");
    assert.equal((await c.run()).assignments.length, 1);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Done." }, again.sessionKey); await c.end(again.sessionKey);
    await second.peer("reviewer");
    const over = await w.fails("jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, second.leadKey);
    assert.deepEqual([over.code, over.details?.created], ["TEAM_LIMIT_ASSIGNMENTS", 2]);
  } finally { w.close(); }
});

test("Review 10 — Restart during a child turn; Attended run after restart; Counters survive: after a real restart of the server on the same data directory the run is paused with its assignments, the interrupted members are failed with the reason, nothing starts until a person resumes, and the run is held to the team as it was when it started; members are disposed of when the run ends", async () => {
  const { createHarness } = await import("./harness.ts");
  const w = await world(), c = crew(w);
  let second: Awaited<ReturnType<typeof createHarness>> | undefined, stopped = false;
  try {
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...rest } = team;
    const { leadId, leadKey, peer } = await teamRun(w);
    const editor = await peer("editor", { grantsWrite: true }), reviewer = await peer("reviewer");
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "The card is right." }, reviewer.sessionKey); await c.end(reviewer.sessionKey);
    // The team is edited while its run is under way: the run keeps the team it started with.
    const edited = (await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, roles: rest.roles.map((role: { roleId: string; enabled: boolean }) => (role.roleId === "researcher" ? { ...role, enabled: false } : role)), limits: { ...rest.limits, maxAssignmentsPerBrief: 2 }, resultApproval: { mode: "auto" } } })).team;
    assert.equal(edited.limits.maxAssignmentsPerBrief, 2);
    const researcher = await peer("researcher");
    assert.deepEqual([(await c.run()).assignments.length, (await c.run()).teamSnapshot?.rev, (await c.run()).limits.maxAssignmentsPerBrief], [3, team.rev, team.limits.maxAssignmentsPerBrief]);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Found three clips." }, researcher.sessionKey); await c.end(researcher.sessionKey);
    // A free agent with a notification armed, in another session, also working when the host goes down.
    const other = await w.session();
    await c.prompt(other);
    const helper = await c.spawn({ title: "Helper" }, other);
    const runId = (await c.run()).id, dataDir = w.h.dataDir, home = w.sessionKey;
    // — the host goes down and comes back on the same data —
    w.h.stop(); stopped = true;
    second = await createHarness({ dataDir, extra: { agentTimings: TIMINGS } });
    const h = second, admin = await h.pair("Studio Mac again", "admin");
    const sent = deliveries(h);
    const agent = async (agentId: string): Promise<AgentRecord> => (await admin.call("jagentchill.agent.get", { agentId })).agent;
    const read = async (): Promise<TeamRun> => (await admin.call("jagentchill.orc.run.get", { sessionKey: home })).runs[0];
    let run = await read();
    assert.deepEqual([run.id, run.status, run.pauseReason, run.pausedFrom, run.leadAgentId, run.assignments.map((entry) => [entry.status, entry.interrupted === true])], [runId, "paused", "host_restart", "running", leadId, [["active", true], ["handed_back", false], ["handed_back", false]]]);
    assert.equal(run.events.at(-1)!.kind, "run.paused");
    const cut = await agent(editor.agentId);
    assert.deepEqual([cut.state, cut.attention, cut.result?.outcome, cut.result?.error, (await agent(reviewer.agentId)).state], ["failed", "error", "failed", "Interrupted by a host restart", "idle"]);
    // The free agent's caller hears of the interruption exactly once.
    await until(() => sent(other).some((text) => /Interrupted by a host restart/.test(text)), "the caller of the interrupted free agent to be told");
    await tick(120);
    assert.deepEqual([sent(other).filter((text) => text.includes(helper.agentId)).length, (await agent(helper.agentId)).state], [1, "failed"]);
    // Nothing of the paused run starts, and its tools take nothing.
    assert.deepEqual([sent(leadKey).length, sent(editor.sessionKey).length, sent(home).length], [0, 0, 0]);
    const held = (await h.app.tools.call(leadKey, "jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" })).envelope;
    assert.deepEqual([held.ok, held.error?.code, /paused/.test(held.error?.message ?? "")], [false, "TEAM_SHAPE_VIOLATION", true]);
    await assert.rejects(admin.call("jagentchill.orc.run.start", { sessionKey: home, request: "Another" }), /CONFLICT/);
    const viewer = await h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.orc.run.resume", { runId }), /SCOPE_DENIED/);
    // Resume: one recovery message to the lead with the state, one to the interrupted peer.
    run = (await admin.call("jagentchill.orc.run.resume", { runId })).run;
    assert.deepEqual([run.status, run.pauseReason, run.stage], ["running", undefined, "assignments"]);
    await until(() => sent(editor.sessionKey).length === 1, "the interrupted peer to be told");
    assert.match(sent(leadKey)[0], /The host restarted and the user resumed the run[\s\S]*Editor[\s\S]*active, interrupted by the restart[\s\S]*Reviewer[\s\S]*handed back/);
    assert.match(sent(editor.sessionKey)[0], /Your previous turn was interrupted by a host restart\.[\s\S]*Continue your assignment and hand back\./);
    assert.deepEqual([sent(leadKey).length, sent(reviewer.sessionKey).length], [1, 0]);
    await assert.rejects(admin.call("jagentchill.orc.run.resume", { runId }), /CONFLICT/);
    // The resumed peer hands back and its lead — still armed — is told; the run goes on under the team it started with:
    // the edited team accepts at once, this run still waits for a person.
    const call = async (sessionKey: string, name: string, args: Record<string, unknown>) => { const envelope = (await h.app.tools.call(sessionKey, name, args)).envelope; assert.equal(envelope.ok, true, `${name}: ${JSON.stringify(envelope.error)}`); return envelope.data as Record<string, any>; };
    await call(editor.sessionKey, "jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the card." });
    const endTurn = async (sessionKey: string) => { h.fake.reply(sessionKey, "Done."); await until(() => !h.app.relay.isRunning(sessionKey), "the turn to end"); await tick(40); };
    await endTurn(editor.sessionKey);
    await until(() => sent(leadKey).some((text) => text.includes(editor.agentId) && /agent_notification/.test(text)), "the lead to hear of the resumed peer's hand-back");
    run = await read();
    assert.deepEqual([run.assignments.map((entry) => [entry.status, entry.interrupted === true]), run.stage], [[["handed_back", false], ["handed_back", false], ["handed_back", false]], "acceptance"]);
    const accepted = await call(leadKey, "jc_team_accept_result", { summary: "The card is in.", evidence: "Three hand-backs.", remainingUncertainty: "None" });
    assert.deepEqual([accepted.status, (await read()).approval?.source], ["waiting_for_signoff", "host_default"]);
    // The run ends: at once no member holds the write assignment or is waited for; a minute later (here: at once, by
    // the service's own hook) the lead and the peers are closed and archived, restorable, and take no further prompt.
    assert.equal((await agent(editor.agentId)).grantsWrite, false, "the write assignment went back with the hand-back");
    await admin.call("jagentchill.orc.signoff.resolve", { runId, decision: "reject", note: "Not what I asked." });
    run = await read();
    const ids = [leadId, editor.agentId, reviewer.agentId, researcher.agentId];
    assert.deepEqual([run.status, (await Promise.all(ids.map(agent))).map((member) => [member.state === "closed", !!member.archived_ms])], ["failed", ids.map(() => [false, false])]);
    assert.equal((h.app.db.prepare("SELECT COUNT(*) AS n FROM agent_notifications WHERE state = 'armed' AND agent_id IN (?, ?, ?, ?)").get(...ids) as { n: number }).n, 0, "nobody waits for a member of a run that ended");
    await h.app.team.settleDisposals();
    assert.deepEqual((await Promise.all(ids.map(agent))).map((member) => [member.state, !!member.archived_ms, member.grantsWrite === true]), ids.map(() => ["closed", true, false]));
    assert.deepEqual(((await admin.call("jagentchill.agent.tree.get", { sessionKey: home })).agents as AgentRecord[]).length, 1, "only the Director is left in the lists");
    await assert.rejects(admin.call("jagentchill.agent.send", { agentId: editor.agentId, prompt: "One more thing." }), /AGENT_ARCHIVED/);
    assert.equal((await admin.call("jagentchill.agent.restore", { agentId: editor.agentId })).agent.state, "closed", "restored for reading, still closed");
  } finally { if (second) second.close(); else if (stopped) (await import("node:fs")).rmSync(w.h.dataDir, { recursive: true, force: true }); else w.close(); }
});

test("Review 11a — a model change asked for while the agent works is queued: applied \"next_turn\" with notice applies_next_turn, and in force before its next turn", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const config = await w.admin.call("jagentchill.orc.config.get", {});
    const profile = (id: string, model: string) => ({ id, runtime: "claude-code", provider: "anthropic", model, params: {}, enabled: true });
    await w.admin.call("jagentchill.orc.config.update", { expectedRevision: config.revision, patch: { roles: { screenwriter: { enabled: true, profiles: [profile("large", "sonnet"), profile("small", "opus")], defaultProfileId: "large", routes: { default: { primary: { profileId: "large" }, fallbacks: [{ profileId: "small" }] } }, limits: {} } } } });
    const a = await c.spawn({ title: "A", role: "screenwriter" });
    // The model a runtime session works on is the one it was opened with; a changed model opens it again for the next turn.
    const opened = () => [...w.h.fake.callsOf("createSession"), ...w.h.fake.callsOf("resumeSession")].filter((call) => call.sessionKey === a.sessionKey).map((call) => call.model as string);
    assert.deepEqual(opened(), ["sonnet"]);
    const queued = (await w.ok("jc_agent_set_model", { agentId: a.agentId, profile: "small" })).data;
    assert.deepEqual([queued.applied, queued.notice, queued.profile, queued.model], ["next_turn", "applies_next_turn", "small", "anthropic/opus"]);
    assert.deepEqual([(await c.get(a.agentId)).modelId, opened(), w.h.fake.isOpen(a.sessionKey)], ["sonnet", ["sonnet"], true], "nothing changed under the running turn");
    await c.end(a.sessionKey);
    await until(async () => (await c.get(a.agentId)).modelId === "opus", "the queued model to be applied when the turn ended");
    // The next turn runs on it, and nothing is applied a second time.
    await w.ok("jc_agent_send", { agentId: a.agentId, prompt: "Go on.", wait: "none" });
    assert.deepEqual(opened(), ["sonnet", "opus"], "the next turn opened the runtime session on the new model");
    await c.end(a.sessionKey);
    await tick(60);
    assert.deepEqual([opened(), (await c.get(a.agentId)).modelId], [["sonnet", "opus"], "opus"]);
    assert.equal((await w.ok("jc_agent_set_model", { agentId: a.agentId, profile: "large" })).data.applied, "now");
  } finally { w.close(); }
});

test("Review 11b — Return once; Third return refused: the owner accepts or returns a hand-back, a returned one is superseded by the next, a person decides from the same record, and nobody else does", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A" }), b = await c.spawn({ title: "B" });
    const list = async () => (await w.admin.call("jagentchill.agent.handback.list", { sessionKey: w.sessionKey })).handbacks as { handbackId: string; agentId: string; state: string; returns: number; supersedes?: string; note?: string; decidedBy?: { kind: string } }[];
    const first = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Five hooks." }, a.sessionKey)).data.handbackId as string;
    await c.end(a.sessionKey, "Handed back.");
    assert.deepEqual((await list()).map((entry) => [entry.handbackId, entry.state, entry.returns]), [[first, "delivered", 0]]);
    // Only the agent it was made to answers it; a return needs its note.
    assert.equal((await w.fails("jc_agent_handback_respond", { handbackId: first, decision: "accept" }, b.sessionKey)).code, "AGENT_NOT_OWNED");
    assert.equal((await w.fails("jc_agent_handback_respond", { handbackId: first, decision: "accept" }, a.sessionKey)).code, "AGENT_NOT_OWNED");
    assert.equal((await w.fails("jc_agent_handback_respond", { handbackId: "hbk_nope", decision: "accept" })).code, "NOT_FOUND");
    assert.deepEqual([(await w.fails("jc_agent_handback_respond", { handbackId: first, decision: "return" })).code, (await w.fails("jc_agent_handback_respond", { handbackId: first, decision: "return" })).details?.field], ["INVALID_PARAMS", "note"]);
    // Return once: the note reaches the agent as a new prompt; its next hand-back supersedes the first.
    const returned = (await w.ok("jc_agent_handback_respond", { handbackId: first, decision: "return", note: "Make them shorter." })).data;
    assert.deepEqual([returned.state, returned.returns], ["returned", 1]);
    await until(() => /returned your hand-back[\s\S]*Make them shorter\./.test(c.delivered(a.sessionKey).at(-1) ?? "") && w.h.app.relay.isRunning(a.sessionKey), "the note to reach the agent");
    assert.equal((await w.fails("jc_agent_handback_respond", { handbackId: first, decision: "accept" })).code, "ALREADY_RESOLVED");
    const second = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Five shorter hooks." }, a.sessionKey)).data.handbackId as string;
    await c.end(a.sessionKey, "Handed back.");
    assert.deepEqual((await list()).map((entry) => [entry.handbackId, entry.state, entry.returns, entry.supersedes]), [[second, "delivered", 1, first], [first, "superseded", 1, undefined]]);
    // The owner hears of the second hand-back like of the first.
    await until(() => c.delivered(w.sessionKey).some((text) => text.includes(second)), "the owner to be told of the new hand-back");
    // A person returns it from the same record; the third return of the same work is refused.
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.agent.handback.resolve", { handbackId: second, decision: "accept" }), /SCOPE_DENIED/);
    const byPerson = (await w.admin.call("jagentchill.agent.handback.resolve", { handbackId: second, decision: "return", note: "One more pass." })).handback;
    assert.deepEqual([byPerson.state, byPerson.returns, byPerson.decidedBy.kind], ["returned", 2, "device"]);
    await until(() => /The user returned your hand-back[\s\S]*One more pass\./.test(c.delivered(a.sessionKey).at(-1) ?? "") && w.h.app.relay.isRunning(a.sessionKey), "the person's note to reach the agent");
    const third = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Final hooks." }, a.sessionKey)).data.handbackId as string;
    await c.end(a.sessionKey, "Handed back.");
    const over = await w.fails("jc_agent_handback_respond", { handbackId: third, decision: "return", note: "Again." });
    assert.deepEqual([over.code, over.details?.reason], ["INVALID_PARAMS", "max_returns"]);
    assert.equal((await w.ok("jc_agent_handback_respond", { handbackId: third, decision: "accept" })).data.state, "accepted");
    assert.deepEqual((await list()).map((entry) => entry.state), ["accepted", "superseded", "superseded"]);
    const trail = w.h.audit("agent.handback").filter((row: any) => row.kind === "handback" && row.action).map((row: any) => [row.action, row.actor.kind]);
    assert.deepEqual(trail, [["created", "agent"], ["returned", "agent"], ["superseded", "agent"], ["created", "agent"], ["returned", "device"], ["superseded", "agent"], ["created", "agent"], ["accepted", "agent"]]);
    // Inside a team run the lead answers with the team tools; a person may still return a member's hand-back, which reopens its assignment.
    const second_ = await w.session();
    const { leadKey, peer } = await teamRun(w, "Add a title card", second_);
    const editor = await peer("editor");
    const handed = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added." }, editor.sessionKey)).data.handbackId as string;
    await c.end(editor.sessionKey, "Handed back.");
    assert.equal((await w.fails("jc_agent_handback_respond", { handbackId: handed, decision: "return", note: "More." }, leadKey)).code, "TEAM_SHAPE_VIOLATION");
    await w.admin.call("jagentchill.agent.handback.resolve", { handbackId: handed, decision: "return", note: "Use the brand font." });
    assert.deepEqual([(await c.run(second_)).assignments[0].status, (await c.run(second_)).stage], ["active", "assignments"]);
    assert.equal((await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Brand font used." }, editor.sessionKey)).data.deliveredTo, (await c.run(second_)).leadAgentId);
  } finally { w.close(); }
});
