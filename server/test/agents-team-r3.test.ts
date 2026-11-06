// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
// One test per finding of the round-2 review `.dev/orc/w2-multi-agent-r2.review.md` (A2–A10); each was seen failing on the code it corrects.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentRecord, TeamRun } from "@jagentchill/protocol";
import { createHarness, tick } from "./harness.ts";
import { S } from "./support/tools.ts";
import { SECTIONS, TIMINGS, crew, deliveries, teamRun, until, world } from "./support/team.ts";

const autoTeam = async (w: Awaited<ReturnType<typeof world>>, limits: object = {}) => {
  const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
  const { created_ms: _c, updated_ms: _u, ...rest } = team;
  await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, limits: { ...rest.limits, ...limits }, resultApproval: { mode: "auto" } } });
};
/** Hands back, lets the lead accept (auto policy) and the Director report: the run is completed. Members' turns are left as they are. */
const finish = async (w: Awaited<ReturnType<typeof world>>, run: Awaited<ReturnType<typeof teamRun>>, peers: { sessionKey: string }[], endPeers = true) => {
  const c = crew(w);
  for (const peer of peers) { await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Done." }, peer.sessionKey); if (endPeers) await c.end(peer.sessionKey); }
  await w.ok("jc_team_accept_result", { summary: "Done.", evidence: "Hand-backs.", remainingUncertainty: "None" }, run.leadKey);
  await until(() => /Report this to the user without changing the decision\.$/.test(c.delivered(run.directorKey).at(-1) ?? ""), "the Director to be told");
  await c.end(run.directorKey, "Reported.");
};

test("A2 — an agent that waits for the agent it reports to (mode notify) is told that it settled, never what it did: the read grant holds when the notification fires", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A" }), a1 = await c.spawn({ title: "A1", wait: "none" }, a.sessionKey);
    const armed = (await w.ok("jc_agent_wait", { agentIds: [a.agentId], mode: "notify" }, a1.sessionKey)).data;
    assert.deepEqual([armed.pending, armed.notifyArmed], [[a.agentId], true]);
    await w.write("jc_text_add", { content: "SECRET-CARD", start: 0, duration: 3 * S }, a.sessionKey);
    await w.submit("SECRET-PROPOSAL", a.sessionKey);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "SECRET-HANDBACK of A" }, a.sessionKey);
    await c.end(a.sessionKey, "SECRET-A result");
    await until(() => c.delivered(a1.sessionKey).some((text) => text.includes(a.agentId) && /agent_notification/.test(text)), "the waiting child to hear that its owner settled");
    const told = c.delivered(a1.sessionKey).find((text) => text.includes(a.agentId) && /agent_notification/.test(text))!;
    assert.doesNotMatch(told, /SECRET|handbackId|hbk_/);
    assert.match(told, /"outcome": "completed"/);
    // The owner's own caller still gets everything.
    await until(() => c.delivered(w.sessionKey).some((text) => /SECRET-HANDBACK of A/.test(text)), "the root to get the full result of its child");
  } finally { w.close(); }
});

test("A5 — a member whose turn still runs when its run ends is stopped before it is disposed of: never a turn running behind a record that says closed", async () => {
  const w = await world(), c = crew(w);
  try {
    await autoTeam(w);
    const run = await teamRun(w), editor = await run.peer("editor");
    await finish(w, run, [editor], false);                        // the editor handed back but its turn is still running
    assert.equal((await c.run()).status, "completed");
    await w.h.app.team.settleDisposals();
    const record = await c.get(editor.agentId);
    assert.ok(w.h.fake.callsOf("interrupt").some((call) => call.sessionKey === editor.sessionKey), "the member's turn was stopped");
    assert.deepEqual([record.state, !!record.archived_ms, w.h.app.relay.isRunning(editor.sessionKey)], ["closed", true, false], "a turn kept running behind a record that says closed");
    assert.equal((await c.get((await c.run()).supervisorAgentId)).state, "closed", "a member that had stopped is disposed of");
  } finally { w.close(); }
});

test("A6 — the host's agent limit counts the members of the current run: earlier runs do not use it up, and an extension a person gave holds for its run only", async () => {
  const w = await world(), c = crew(w);
  try {
    await autoTeam(w);
    await w.admin.call("jagentchill.agent.limits.set", { limits: { maxDepth: 3, maxConcurrentChildren: 4, maxConcurrentAgentsPerTree: 8, maxAgentsPerTree: 3, maxTurnsPerTree: 200 } });
    const first = await teamRun(w), editor = await first.peer("editor");       // lead + editor = 2 (the Director is not counted)
    const researcher = await first.peer("researcher");                         // 3
    const full = await w.fails("jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, first.leadKey);
    assert.deepEqual([full.code, full.details?.limit, full.details?.current], ["AGENT_LIMIT_TOTAL", 3, 3]);
    const [root] = await c.tree();
    assert.equal((await w.admin.call("jagentchill.agent.limits.raise", { rootId: root.id })).maxAgentsPerTree, 6);
    const reviewer = await first.peer("reviewer");
    await finish(w, first, [editor, researcher, reviewer]);
    assert.equal((await c.run()).status, "completed");
    // The next brief: the count starts at zero and the extension of the first run is not carried over.
    const second = await teamRun(w, "Now add an end card");
    await second.peer("editor");
    await second.peer("researcher");
    const again = await w.fails("jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" }, second.leadKey);
    assert.deepEqual([again.code, again.details?.limit, again.details?.current], ["AGENT_LIMIT_TOTAL", 3, 3]);
  } finally { w.close(); }
});

test("A7 — restart reconciliation does not bring back a member of a run that had ended: it is closed, archived and without the write assignment, whatever its record said when the host went down", async () => {
  const w = await world(), c = crew(w);
  let second: Awaited<ReturnType<typeof createHarness>> | undefined, stopped = false;
  try {
    await autoTeam(w);
    const run = await teamRun(w), editor = await run.peer("editor", { grantsWrite: true });
    await finish(w, run, [editor]);
    assert.equal((await c.run()).status, "completed");
    const dataDir = w.h.dataDir;
    w.h.stop(); stopped = true;
    // The host died before the member was cleaned up: its record still says it works and holds the write assignment (written directly, as a crash leaves it).
    const db = new DatabaseSync(join(dataDir, "jagentchill.sqlite"));
    db.prepare("UPDATE agents SET state = 'running', archived_ms = NULL, json = json_set(json, '$.grantsWrite', json('true')) WHERE id = ?").run(editor.agentId);
    db.close();
    second = await createHarness({ dataDir, extra: { agentTimings: TIMINGS } });
    const admin = await second.pair("Studio Mac again", "admin");
    const record = (await admin.call("jagentchill.agent.get", { agentId: editor.agentId })).agent as AgentRecord;
    assert.deepEqual([record.state, !!record.archived_ms, record.grantsWrite === true, record.result?.error], ["closed", true, false, undefined]);
  } finally { if (second) second.close(); else if (stopped) (await import("node:fs")).rmSync(w.h.dataDir, { recursive: true, force: true }); else w.close(); }
});

test("A8, A9 — Resume goes back to running only when the recovery messages were taken (a refused one leaves the run paused, and the next Resume tells everybody anew); a run whose lead is gone ends as members_lost; a hand-back returned while the run is paused starts nobody until Resume, and gives the peer its write assignment back", async () => {
  const w = await world(), c = crew(w);
  let second: Awaited<ReturnType<typeof createHarness>> | undefined, stopped = false;
  try {
    const run = await teamRun(w), editor = await run.peer("editor", { grantsWrite: true }), reviewer = await run.peer("reviewer");
    const handed = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the card." }, editor.sessionKey)).data.handbackId as string;
    await c.end(editor.sessionKey);
    assert.equal((await c.get(editor.agentId)).grantsWrite, false);
    const lost = await w.session(), lostRun = await teamRun(w, "Check the pacing", lost);
    const runId = (await c.run()).id, lostId = (await c.run(lost)).id, dataDir = w.h.dataDir, home = w.sessionKey;
    w.h.stop(); stopped = true;
    second = await createHarness({ dataDir, extra: { agentTimings: TIMINGS } });
    const h = second, admin = await h.pair("Studio Mac again", "admin");
    const sent = deliveries(h), tried = (sessionKey: string) => h.fake.callsOf("startTurn").filter((call) => call.sessionKey === sessionKey).length;
    const read = async (as = home): Promise<TeamRun> => (await admin.call("jagentchill.orc.run.get", { sessionKey: as })).runs[0];
    assert.deepEqual([(await read()).status, (await read(lost)).status], ["paused", "paused"]);
    // — A9: a person returns the editor's hand-back while the run is paused —
    await admin.call("jagentchill.agent.handback.resolve", { handbackId: handed, decision: "return", note: "Use the brand font." });
    await tick(80);
    let paused = await read();
    assert.deepEqual([sent(editor.sessionKey).length, paused.held?.length, paused.assignments[0].status, ((await admin.call("jagentchill.agent.get", { agentId: editor.agentId })).agent as AgentRecord).grantsWrite], [0, 1, "active", true], "the peer was started while its run is paused, or reopened without its write assignment");
    // — A8: the runtime takes the lead's turn and fails to start every other one; a turn it is asked to stop ends —
    h.fake.on("startTurn", (params: { sessionKey: string }) => { if (params.sessionKey !== run.leadKey) throw new Error("runtime down"); });
    const failed = await admin.fail("jagentchill.orc.run.resume", { runId });
    paused = await read();
    assert.deepEqual([failed.code, failed.retryable, paused.status, paused.pauseReason, paused.recovery, tried(run.leadKey)], ["UNAVAILABLE", true, "paused", "host_restart", undefined, 1]);
    assert.equal((await h.app.tools.call(run.leadKey, "jc_team_create_peer", { role: "reviewer", assignment: "a", ownershipBoundary: "b", expectedHandback: "c" })).envelope.error?.code, "TEAM_SHAPE_VIOLATION", "the run takes nothing while it is still paused");
    h.fake.reset("startTurn");
    assert.deepEqual([tried(editor.sessionKey), tried(reviewer.sessionKey)], [1, 1], "each was tried once and refused");
    const resumed = (await admin.call("jagentchill.orc.run.resume", { runId })).run as TeamRun;
    assert.deepEqual([resumed.status, resumed.recovery, resumed.held], ["running", undefined, undefined]);
    await until(() => tried(editor.sessionKey) === 2 && tried(reviewer.sessionKey) === 2, "the held note and the interrupted peer's message to go out");
    assert.match(sent(editor.sessionKey)[1], /The user returned your hand-back[\s\S]*Use the brand font\./);
    assert.match(sent(reviewer.sessionKey)[1], /interrupted by a host restart/);
    // The turn the failed Resume had started for the lead was taken back (round-3 review, B3): the lead is told again.
    assert.equal(sent(run.leadKey).filter((text) => /the user resumed the run/.test(text)).length, 2);
    // The reopened editor edits again: the write assignment is its own.
    const edit = (await h.app.tools.call(editor.sessionKey, "jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S, idempotencyKey: "a9-reopened-editor-0001" })).envelope;
    assert.equal(edit.ok, true, JSON.stringify(edit.error));
    // — members_lost: the other run's lead no longer has a session —
    h.app.db.prepare("DELETE FROM agent_sessions WHERE session_key = ?").run(lostRun.leadKey);
    const ended = (await admin.call("jagentchill.orc.run.resume", { runId: lostId })).run as TeamRun;
    assert.deepEqual([ended.status, /^members_lost/.test(ended.endReason ?? "")], ["failed", true]);
  } finally { if (second) second.close(); else if (stopped) (await import("node:fs")).rmSync(w.h.dataDir, { recursive: true, force: true }); else w.close(); }
});

test("A10 — a queued model change gates the agent's next turn: a message sent the moment its turn ends starts on the new model, never before the change is in force", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const config = await w.admin.call("jagentchill.orc.config.get", {});
    const profile = (id: string, model: string) => ({ id, runtime: "claude-code", provider: "anthropic", model, params: {}, enabled: true });
    await w.admin.call("jagentchill.orc.config.update", { expectedRevision: config.revision, patch: { roles: { screenwriter: { enabled: true, profiles: [profile("large", "sonnet"), profile("small", "opus")], defaultProfileId: "large", routes: { default: { primary: { profileId: "large" }, fallbacks: [{ profileId: "small" }] } }, limits: {} } } } });
    const a = await c.spawn({ title: "A", role: "screenwriter" });
    assert.equal((await w.ok("jc_agent_set_model", { agentId: a.agentId, profile: "small" })).data.applied, "next_turn");
    // The model change takes its time; the order of what is DONE is recorded, with the model each turn's runtime session was opened on.
    const order: string[] = [];
    const relay = w.h.app.relay as unknown as { retarget: (key: string, target: { ref: { modelId: string } }) => Promise<unknown> };
    const retarget = relay.retarget.bind(relay);
    relay.retarget = async (key, target) => { await tick(120); const done = await retarget(key, target); if (key === a.sessionKey) order.push(`model:${target.ref.modelId}`); return done; };
    w.h.fake.on("startTurn", (params: { sessionKey: string; options: { model?: string } }) => { if (params.sessionKey === a.sessionKey) order.push(`turn:${params.options.model}`); });
    // The turn ends and the next message is sent AT ONCE — nothing waits for the change here.
    w.h.fake.endTurn(a.sessionKey);
    const sent = (await w.ok("jc_agent_send", { agentId: a.agentId, prompt: "Go on.", wait: "none" })).data;
    assert.deepEqual([sent.delivered, order], ["started", ["model:opus", "turn:opus"]], "the next turn started before the queued model was in force");
    assert.equal((await c.get(a.agentId)).modelId, "opus");
  } finally { w.close(); }
});
