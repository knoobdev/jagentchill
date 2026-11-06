// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
// One test per finding of the round-3 review `.dev/orc/w2-multi-agent-r3.review.md` (B2–B7); each was seen failing on the code it corrects.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRecord, TeamRun } from "@jagentchill/protocol";
import { createHarness, tick } from "./harness.ts";
import { SECTIONS, TIMINGS, crew, teamRun, until, world } from "./support/team.ts";

type World = Awaited<ReturnType<typeof world>>;
const autoTeam = async (w: World) => {
  const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
  const { created_ms: _c, updated_ms: _u, ...rest } = team;
  await w.admin.call("jagentchill.orc.team.save", { team: { ...rest, resultApproval: { mode: "auto" } } });
};
const PEER = { assignment: "a", ownershipBoundary: "b", expectedHandback: "c" };

test("B2 — starting another run disposes of the earlier run's members, and a member whose turn still runs is stopped first: never a closed, archived agent with a turn running behind it", async () => {
  const w = await world(), c = crew(w);
  try {
    await autoTeam(w);
    const first = await teamRun(w), editor = await first.peer("editor");
    // The editor hands back, the result is accepted and reported — and the editor's turn is still running.
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Done." }, editor.sessionKey);
    await w.ok("jc_team_accept_result", { summary: "Done.", evidence: "Hand-backs.", remainingUncertainty: "None" }, first.leadKey);
    await until(() => /Report this to the user without changing the decision\.$/.test(c.delivered(first.directorKey).at(-1) ?? ""), "the Director to be told");
    await c.end(first.directorKey, "Reported.");
    assert.equal((await c.run()).status, "completed");
    const firstDirector = (await c.run()).supervisorAgentId;
    // The next request, within the minute the members of the first run are kept.
    await teamRun(w, "Now add an end card");
    assert.equal((await c.run()).status, "running");
    await w.h.app.team.settleDisposals();
    const record = await c.get(editor.agentId);
    assert.ok(w.h.fake.callsOf("interrupt").some((call) => call.sessionKey === editor.sessionKey), "the member's turn was stopped");
    assert.deepEqual([record.state, !!record.archived_ms, w.h.app.relay.isRunning(editor.sessionKey)], ["closed", true, false], "closed and archived while its turn still runs");
    assert.deepEqual([(await c.get(firstDirector)).state, !!(await c.get(firstDirector)).archived_ms], ["closed", true], "a member that had stopped is disposed of when the next run starts");
  } finally { w.close(); }
});

test("B3 — a Resume that fails half-way leaves nobody working: the turns it had started are stopped, nobody is told they ended, and the next Resume tells every agent anew, after which their team tools work", async () => {
  const w = await world();
  let second: Awaited<ReturnType<typeof createHarness>> | undefined, stopped = false;
  try {
    const run = await teamRun(w), editor = await run.peer("editor"), reviewer = await run.peer("reviewer");
    const runId = (await crew(w).run()).id, dataDir = w.h.dataDir, home = w.sessionKey;
    w.h.stop(); stopped = true;
    second = await createHarness({ dataDir, extra: { agentTimings: TIMINGS } });
    const h = second, admin = await h.pair("Studio Mac again", "admin");
    // Every turn the server tried to start for a session (one the runtime could not start included), by its message.
    const sent = (sessionKey: string) => h.fake.callsOf("startTurn").filter((call) => call.sessionKey === sessionKey).map((call) => String(call.message));
    const read = async (): Promise<TeamRun> => (await admin.call("jagentchill.orc.run.get", { sessionKey: home })).runs[0];
    // The runtime cannot start the reviewer's turn; a turn it is asked to stop ends (the fake confirms every stop).
    let down: string | undefined = reviewer.sessionKey;
    h.fake.on("startTurn", (params: { sessionKey: string }) => { if (params.sessionKey === down) throw new Error("runtime down"); });
    const failed = await admin.fail("jagentchill.orc.run.resume", { runId });
    await until(() => !h.app.relay.isRunning(run.leadKey) && !h.app.relay.isRunning(editor.sessionKey), "the turns the failed Resume started to be stopped");
    await tick(80);
    const paused = await read();
    assert.deepEqual([failed.code, paused.status, sent(run.leadKey).length, sent(editor.sessionKey).length], ["UNAVAILABLE", "paused", 1, 1]);
    assert.deepEqual([h.app.relay.isRunning(run.leadKey), h.app.relay.isRunning(editor.sessionKey), h.app.relay.isRunning(reviewer.sessionKey)], [false, false, false], "an agent works while its run is paused");
    assert.equal(sent(run.directorKey).length, 0, "the Director was told that the lead ended a turn the server itself took back");
    // The engine is back: every agent is told again and works.
    down = undefined;
    const resumed = (await admin.call("jagentchill.orc.run.resume", { runId })).run as TeamRun;
    assert.equal(resumed.status, "running");
    assert.deepEqual([sent(run.leadKey).filter((text) => /the user resumed the run/.test(text)).length, sent(editor.sessionKey).length, sent(reviewer.sessionKey).length], [2, 2, 2]);
    assert.deepEqual([h.app.relay.isRunning(run.leadKey), h.app.relay.isRunning(editor.sessionKey), h.app.relay.isRunning(reviewer.sessionKey)], [true, true, true]);
    const tool = (await h.app.tools.call(run.leadKey, "jc_team_create_peer", { role: "researcher", ...PEER })).envelope;
    assert.equal(tool.ok, true, `the lead's team tool was refused after the resume: ${JSON.stringify(tool.error)}`);
    await tick(80);
    assert.equal(sent(run.directorKey).filter((text) => /agent_notification/.test(text)).length, 0);
  } finally { if (second) second.close(); else if (stopped) (await import("node:fs")).rmSync(w.h.dataDir, { recursive: true, force: true }); else w.close(); }
});

test("B4 — returning a hand-back is refused while another assignment holds the write assignment, whatever its agent is doing: a holder whose turn a restart cut off still holds it, and there are never two", async () => {
  const w = await world();
  let second: Awaited<ReturnType<typeof createHarness>> | undefined, stopped = false;
  try {
    const run = await teamRun(w), c = crew(w), a = await run.peer("editor", { grantsWrite: true });
    const handed = (await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the card." }, a.sessionKey)).data.handbackId as string;
    await c.end(a.sessionKey);
    const b = await run.peer("editor", { grantsWrite: true, title: "Editor B" });   // works when the host goes down
    const dataDir = w.h.dataDir, home = w.sessionKey;
    w.h.stop(); stopped = true;
    second = await createHarness({ dataDir, extra: { agentTimings: TIMINGS } });
    const h = second, admin = await h.pair("Studio Mac again", "admin");
    const get = async (agentId: string) => (await admin.call("jagentchill.agent.get", { agentId })).agent as AgentRecord;
    assert.deepEqual([(await get(b.agentId)).state, (await get(b.agentId)).grantsWrite], ["failed", true], "the interrupted holder");
    const refused = await admin.fail("jagentchill.agent.handback.resolve", { handbackId: handed, decision: "return", note: "Use the brand font." });
    assert.deepEqual([refused.code, refused.details?.holderAgentId], ["WRITER_HELD", b.agentId]);
    const state = ((await admin.call("jagentchill.orc.run.get", { sessionKey: home })).runs[0] as TeamRun).assignments.map((entry) => [entry.status, entry.grantsWrite]);
    assert.deepEqual(state, [["handed_back", true], ["active", true]], "two open assignments hold the write assignment");
    assert.equal((await get(a.agentId)).grantsWrite, false);
  } finally { if (second) second.close(); else if (stopped) (await import("node:fs")).rmSync(w.h.dataDir, { recursive: true, force: true }); else w.close(); }
});

test("B5 — the Director of a run is not one of the agents the host's limit counts: with a limit of 2 a run has its lead and one peer, and the next agent is refused with current 2", async () => {
  const w = await world();
  try {
    await w.admin.call("jagentchill.agent.limits.set", { limits: { maxDepth: 3, maxConcurrentChildren: 4, maxConcurrentAgentsPerTree: 8, maxAgentsPerTree: 2, maxTurnsPerTree: 200 } });
    const run = await teamRun(w);                    // Director (not counted) + lead = 1
    await run.peer("editor");                        // 2 — refused by the old count, which had the Director in it
    const full = await w.fails("jc_team_create_peer", { role: "reviewer", ...PEER }, run.leadKey);
    assert.deepEqual([full.code, full.details?.limit, full.details?.current], ["AGENT_LIMIT_TOTAL", 2, 2]);
  } finally { w.close(); }
});

test("B6 — a blocking message to the agent one reports to returns that it settled, never its result: the summary, the hand-back and the artefacts of an agent above stay unread on this path too", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A" }), a1 = await c.spawn({ title: "A1", wait: "none" }, a.sessionKey);
    await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "SECRET-HANDBACK of A" }, a.sessionKey);
    const call = w.ok("jc_agent_send", { agentId: a.agentId, prompt: "I am done with my part.", wait: "block", timeout_ms: 5000 }, a1.sessionKey);
    await until(() => c.delivered(a.sessionKey).some((text) => /I am done with my part/.test(text)), "the message to reach the owner");
    // The message was held for the end of A's running turn and ran as a turn of its own.
    await c.rest(a.sessionKey, "SECRET-A result");
    const answer = (await call).data;
    assert.deepEqual([answer.agentId, answer.timedOut, answer.state], [a.agentId, false, "idle"]);
    assert.equal(answer.result, undefined, "the owner's result came back to the agent below it");
    assert.doesNotMatch(JSON.stringify(answer), /SECRET|hbk_/);
    // Downwards nothing changed: the owner reads the full result of its own agent the same way (A1 first finishes what it works on:
    // a message to a working agent is held for the end of its turn, and the blocking call returns when that turn ends).
    await c.rest(a1.sessionKey, "Noted.");
    const down = w.ok("jc_agent_send", { agentId: a1.agentId, prompt: "One more thing.", wait: "block", timeout_ms: 5000 }, a.sessionKey);
    await until(() => c.delivered(a1.sessionKey).some((text) => /One more thing/.test(text)), "the message to reach the child");
    await c.end(a1.sessionKey, "CHILD-RESULT");
    assert.match(JSON.stringify((await down).data.result ?? {}), /CHILD-RESULT/);
  } finally { w.close(); }
});
