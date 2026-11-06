// The agent runtimes in these tests are the FAKES of the runtime layer (`harness.ts`; no model runs: a turn ends when the test says so); devices are simulated. Sessions, tools, proposals, usage and the agent service are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS, billedPerCall, hostClock } from "./support/team.ts";
import { AGENT_TEAM_METHOD_SCOPES, type AgentRecord } from "@jagentchill/protocol";
import { tick } from "./harness.ts";
import { S, key, toolWorld, type ToolWorld } from "./support/tools.ts";

async function world(extra: object = {}) {
  const clock = hostClock(), w = await toolWorld({ harness: { now: clock.now, extra: { agentTimings: { notifyBatchMs: 20, retryMs: [10, 10, 10], writerQueueMs: 600 }, ...extra } } });
  clock.bind(w.h);
  return w;
}
async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let n = 0; n < 300; n++) { if (await done()) return; await tick(10); }
  throw new Error(`timed out waiting for ${what}`);
}
/** Helpers over one world: agents by id, and turns the fake runtimes start and end. */
function crew(w: ToolWorld) {
  const fake = w.h.fake;
  const get = async (agentId: string): Promise<AgentRecord> => (await w.admin.call("jagentchill.agent.get", { agentId })).agent;
  const tree = async (as = w.sessionKey): Promise<AgentRecord[]> => (await w.admin.call("jagentchill.agent.tree.get", { sessionKey: as })).agents;
  /** The turn the runtime is running now for a session. */
  const runOf = (sessionKey: string) => { const runId = fake.session(sessionKey).turnId; assert.notEqual(runId, "", "no turn is running for the session"); return runId; };
  /** Ends the running turn of an agent with its last words and what the turn cost (Claude Code reports the cost of a turn itself; here at 1000 USD per million tokens). */
  const end = async (sessionKey: string, text = "Done.", state: "final" | "error" | "aborted" = "final", usage?: { input: number; output: number }) => {
    fake.reply(sessionKey, text, { runId: runOf(sessionKey), state, ...(usage ? { usage: { inputTokens: usage.input, outputTokens: usage.output, costUsd: ((usage.input + usage.output) * 1000) / 1e6 } } : {}) });
    await until(() => !w.h.app.relay.isRunning(sessionKey), "the turn to end");
    await tick(30);
  };
  /** A person's prompt in the root session, which starts its turn. */
  const prompt = async (as = w.sessionKey) => { await w.admin.call("jagentchill.chat.send", { sessionKey: as, message: "Make the intro shorter." }); };
  const spawn = async (args: Record<string, unknown> = {}, as = w.sessionKey) => {
    const made = await w.ok("jc_agent_create", { title: "Helper", prompt: "Do the part you were given.", ...args }, as);
    return { ...(made.data as { agentId: string; state: string; waitArmed: boolean }), sessionKey: (await get(made.data.agentId)).sessionKey };
  };
  /** What the server gave a session's runtime as turns, newest last. */
  const delivered = (sessionKey: string) => fake.callsOf("startTurn").filter((call) => call.sessionKey === sessionKey).map((call) => String(call.message));
  return { get, tree, runOf, end, prompt, spawn, delivered };
}

test("Record created for a new chat session; Three-level tree; Default creation from an agent; Title too long; Replayed idempotency key; Tool tries to forge a team label", async () => {
  const w = await world(), c = crew(w);
  try {
    const [root] = await c.tree();
    assert.deepEqual([root.depth, root.rootId, root.origin, root.parentId, root.id.length, root.id.slice(0, 4)], [0, root.id, "user", undefined, 30, "agt_"]);
    await c.prompt();
    const made = await w.ok("jc_agent_create", { title: "Hook options", prompt: "Write five hooks.", role: "screenwriter", idempotencyKey: "hook-options-00001" });
    assert.equal(made.data.waitArmed, true);
    assert.match(made.data.guidance, /background/);
    const a = await c.get(made.data.agentId);
    assert.deepEqual([a.state, a.depth, a.parentId, a.rootId, a.roleId, a.labels["jc.parent"], a.labels["jc.origin"]], ["running", 1, root.id, root.id, "screenwriter", root.id, "agent"]);
    // The child got its assignment, with who it works for; the session list of a device does not show it.
    assert.match(c.delivered(a.sessionKey)[0], /sub-agent created by[\s\S]*Assignment:\nWrite five hooks\./);
    assert.equal((await w.admin.call("jagentchill.session.list", {})).sessions.some((session: { sessionKey: string }) => session.sessionKey === a.sessionKey), false);
    const again = await w.ok("jc_agent_create", { title: "Hook options", prompt: "Write five hooks.", role: "screenwriter", idempotencyKey: "hook-options-00001" });
    assert.deepEqual([again.data.agentId, again.data.replayed, (await c.tree()).length], [a.id, true, 2]);
    const b = await c.spawn({ title: "Hook B" }, a.sessionKey);
    const order = (await c.tree()).map((agent) => [agent.id, agent.depth]);
    assert.deepEqual(order, [[root.id, 0], [a.id, 1], [b.agentId, 2]]);
    assert.equal((await c.get(b.agentId)).parentId, a.id);
    const long = await w.fails("jc_agent_create", { title: "x".repeat(61), prompt: "p" });
    assert.deepEqual([long.code, long.details?.field], ["INVALID_PARAMS", "title"]);
    const forged = await w.fails("jc_agent_create", { title: "Forger", prompt: "p", labels: { "jc.team.tier": "lead" } });
    assert.equal(forged.code, "INVALID_PARAMS");
    assert.equal((await c.tree()).length, 3);
  } finally { w.close(); }
});

test("Depth limit; Finished children free a concurrent slot; Total limit and human extension; Viewer calls an action", async () => {
  const w = await world(), c = crew(w);
  try {
    await w.admin.call("jagentchill.agent.limits.set", { limits: { maxDepth: 2, maxConcurrentChildren: 2, maxConcurrentAgentsPerTree: 8, maxAgentsPerTree: 4 } });
    await c.prompt();
    const a = await c.spawn({ title: "A" }), b = await c.spawn({ title: "B" });
    const full = await w.fails("jc_agent_create", { title: "C", prompt: "p" });
    assert.deepEqual([full.code, full.retryable, full.details], ["AGENT_LIMIT_CHILDREN", true, { limit: 2, current: 2 }]);
    await c.end(b.sessionKey);
    const c3 = await c.spawn({ title: "C" });
    const deep = await c.spawn({ title: "A1" }, a.sessionKey);
    const tooDeep = await w.fails("jc_agent_create", { title: "A2", prompt: "p" }, deep.sessionKey);
    assert.deepEqual([tooDeep.code, tooDeep.details], ["AGENT_LIMIT_DEPTH", { limit: 2, current: 2 }]);
    await c.end(c3.sessionKey);
    const total = await w.fails("jc_agent_create", { title: "E", prompt: "p" });
    assert.deepEqual([total.code, total.retryable, total.details], ["AGENT_LIMIT_TOTAL", false, { limit: 4, current: 4 }]);
    const [root] = await c.tree();
    const viewer = await w.h.pair("Lobby screen", "viewer");
    await assert.rejects(viewer.call("jagentchill.agent.stop", { agentId: a.agentId }), /SCOPE_DENIED/);
    await assert.rejects(viewer.call("jagentchill.agent.limits.raise", { rootId: root.id }), /SCOPE_DENIED/);
    assert.equal((await c.get(a.agentId)).state, "running");
    assert.equal((await w.admin.call("jagentchill.agent.limits.raise", { rootId: root.id })).maxAgentsPerTree, 8);
    await c.spawn({ title: "E" });
  } finally { w.close(); }
});

test("Blocking wait finishes in time; Two children finish together; Child ends without a hand-back; Child staged a proposal; Child waits for its own children", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const b = await c.spawn({ title: "Writer B" }), d = await c.spawn({ title: "Editor C" });
    // B ends with a long last message and no hand-back; C stages a change, hands back, and its turn's end submits the proposal.
    const waiting = w.ok("jc_agent_wait", { agentIds: [b.agentId], timeout_ms: 5000 });
    await tick(30);
    await c.end(b.sessionKey, "h".repeat(5000));
    const waited = (await waiting).data;
    assert.deepEqual([waited.timedOut, waited.pending, waited.settled[0].agentId, waited.settled[0].state, waited.settled[0].outcome], [false, [], b.agentId, "idle", "completed"]);
    assert.deepEqual([waited.settled[0].result.summary.length, waited.settled[0].result.lastMessage.length], [2000, 5000]);
    await w.write("jc_text_add", { content: "DA LAT", start: 0, duration: 3 * S }, d.sessionKey);
    const back = await w.ok("jc_agent_handback", { ...SECTIONS, whatChangedOrInspected: "Added the title card.", risks: ["The font is a substitute."] }, d.sessionKey);
    // The root ends its own turn while C still works: it waits for its sub-agents.
    await c.end(w.sessionKey, "I delegated the work.");
    const [root] = await c.tree();
    assert.deepEqual([root.state, root.waitingReason], ["waiting", "children"]);
    const before = c.delivered(w.sessionKey).length;
    await c.end(d.sessionKey, "Handed back.");
    await until(() => c.delivered(w.sessionKey).length > before, "the notification");
    await tick(60);
    // B was returned by the blocking wait, so only C is told — once, as data, with its proposal and hand-back.
    const notes = c.delivered(w.sessionKey).slice(before);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /A sub-agent settled\.[\s\S]*"kind": "agent_notification"[\s\S]*"outcome": "completed"[\s\S]*"summary": "Added the title card\."[\s\S]*Do not poll\./);
    assert.equal(notes[0].includes(b.agentId), false);
    const result = (await c.get(d.agentId)).result!;
    assert.deepEqual([result.handback?.handbackId, result.handback?.risks, result.artefacts.length, result.artefacts[0].kind], [back.data.handbackId, ["The font is a substitute."], 1, "proposal"]);
    // The project is unchanged until a person accepts the child's proposal.
    assert.equal((await w.admin.call("jagentchill.proposal.get", { proposalId: result.artefacts[0].id })).proposal.state, "pending");
    assert.equal((await c.tree())[0].state, "running");
    // Two children that settle together reach the caller as one message with a block each.
    const e = await c.spawn({ title: "E" }), f = await c.spawn({ title: "F" });
    const mark = c.delivered(w.sessionKey).length;
    w.h.fake.reply(e.sessionKey, "E done"); w.h.fake.reply(f.sessionKey, "F done");
    // The root is working: the server holds the message for the end of its turn, then starts a turn with it.
    await tick(120);
    await c.end(w.sessionKey);
    await until(() => c.delivered(w.sessionKey).length > mark, "the joint notification");
    await tick(60);
    const joint = c.delivered(w.sessionKey).slice(mark);
    assert.equal(joint.length, 1);
    assert.match(joint[0], /^2 sub-agents settled\./);
    assert.equal(joint[0].includes(e.agentId) && joint[0].includes(f.agentId), true);
  } finally { w.close(); }
});

test("Cancel keeps the agent; cancellation reaches the children; Cascade; a person stops one agent and stops all", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const a = await c.spawn({ title: "A" }), b = await c.spawn({ title: "B" }, (await c.spawn({ title: "skip" })).sessionKey);
    const a1 = await c.spawn({ title: "A1" }, a.sessionKey), a2 = await c.spawn({ title: "A2" }, a1.sessionKey);
    const own = await w.fails("jc_agent_cancel", { agentId: a.agentId }, a1.sessionKey);
    assert.equal(own.code, "AGENT_NOT_OWNED");
    const aborts = () => w.h.fake.callsOf("interrupt").map((call) => call.sessionKey);
    const cancelled = await w.ok("jc_agent_cancel", { agentId: a.agentId, reason: "No longer needed" });
    assert.deepEqual([cancelled.data.state, cancelled.data.cancelledDescendants], ["idle", 2]);
    assert.deepEqual(aborts().sort(), [a.sessionKey, a1.sessionKey, a2.sessionKey].sort());
    // Each runtime confirms the stop with the end of its turn.
    for (const agent of [a2, a1, a]) await until(() => !w.h.app.relay.isRunning(agent.sessionKey), "the stopped turn to end");
    await tick(30);
    assert.deepEqual((await Promise.all([a, a1, a2].map((agent) => c.get(agent.agentId)))).map((agent) => [agent.state, agent.result?.outcome]), [["idle", "cancelled"], ["idle", "cancelled"], ["idle", "cancelled"]]);
    // The canceller asked for it: nobody is sent a message about it.
    await tick(80);
    assert.equal(c.delivered(w.sessionKey).length, 1);
    assert.equal(w.h.audit("agent.cancel")[0].reason, "No longer needed");
    // A cancelled agent can be given new work.
    assert.equal((await w.ok("jc_agent_send", { agentId: a.agentId, prompt: "Try the other approach.", wait: "none" })).data.delivered, "started");
    // A person stops one agent (its children with it), then everything.
    const stopped = await w.admin.call("jagentchill.agent.stop", { agentId: b.agentId });
    assert.equal(aborts().includes(b.sessionKey), true);
    assert.equal(stopped.stoppedDescendants, 0);
    const all = await w.admin.call("jagentchill.agent.stopAll", { sessionKey: w.sessionKey });
    assert.equal(aborts().includes(w.sessionKey) && aborts().includes(a.sessionKey), true);
    assert.equal(typeof all.stopped, "number");
    // Archive: the agent and what is below it leave the tree; closed agents take no message.
    const archived = await w.admin.call("jagentchill.agent.archive", { agentId: a.agentId });
    assert.equal(archived.archived, 3);
    assert.equal((await c.tree()).some((agent) => [a.agentId, a1.agentId, a2.agentId].includes(agent.id)), false);
    assert.equal((await w.fails("jc_agent_send", { agentId: a.agentId, prompt: "Hello again" })).code, "AGENT_ARCHIVED");
    await w.admin.call("jagentchill.agent.close", { agentId: b.agentId });
    assert.equal((await c.get(b.agentId)).state, "closed");
    assert.equal((await w.fails("jc_agent_send", { agentId: b.agentId, prompt: "Hello" })).code, "AGENT_CLOSED");
  } finally { w.close(); }
});

test("Second agent tries to edit; Release on submit; a queued sub-agent gets the token when it is free; Unassigned editor under lead_assigns; the Director of a team does not write", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    // Free agents: E1 holds the token while it stages; E2 waits in the queue and gets it when E1 submits.
    const e1 = await c.spawn({ title: "Editor One" }), e2 = await c.spawn({ title: "Editor Two" });
    await w.write("jc_text_add", { content: "ONE", start: 0, duration: S }, e1.sessionKey);
    const queued = w.call("jc_text_add", { idempotencyKey: key(), content: "TWO", start: S, duration: S }, e2.sessionKey);
    await tick(80);
    await w.submit("One", e1.sessionKey);
    assert.equal((await queued).ok, true);
    // Nobody releases this time: E1's turn is over, E2 holds the token and E1 gives up after its wait.
    await c.end(e1.sessionKey);
    await w.admin.call("jagentchill.proposal.resolve", { proposalId: w.h.app.tools.currentProposal(e1.sessionKey)!.proposalId, action: "reject" });
    const held = await w.writeFails("jc_text_add", { content: "ONE AGAIN", start: 2 * S, duration: S }, e1.sessionKey);
    assert.deepEqual([held.code, held.retryable, held.details?.holderTitle, held.details?.reason], ["WRITER_HELD", true, "Editor Two", "wait_timeout"]);
    assert.equal(w.h.app.tools.currentProposal(e1.sessionKey), undefined);
    await w.submit("Two", e2.sessionKey);
    for (const agent of [e1, e2]) if (w.h.app.relay.isRunning(agent.sessionKey)) await c.end(agent.sessionKey);
    // A team: the Director does not write, a reviewer does not write, and of two editors only the assigned one does.
    const second = await w.session();
    await w.admin.call("jagentchill.chat.send", { sessionKey: second, message: "Cut the intro with the team." });
    const attached = await w.admin.call("jagentchill.agent.team.set", { sessionKey: second, teamId: "video-production" });
    assert.deepEqual([attached.teamId, attached.agents[0].tier, attached.agents[0].roleLabel], ["video-production", "supervisor", "Director"]);
    const director = await w.writeFails("jc_text_add", { content: "X", start: 0, duration: S }, second);
    assert.equal(director.code, "TEAM_ROLE_DENIED");
    assert.match(director.message, /editor/);
    const noRole = await w.fails("jc_agent_create", { title: "Someone", prompt: "p" }, second);
    assert.equal(noRole.code, "TEAM_ROLE_DENIED");
    const writer = await c.spawn({ title: "Editor A", role: "editor", grantsWrite: true }, second), other = await c.spawn({ title: "Editor B", role: "editor" }, second);
    const twice = await w.fails("jc_agent_create", { title: "Editor C", prompt: "p", role: "editor", grantsWrite: true }, second);
    assert.deepEqual([twice.code, twice.details?.holderTitle], ["WRITER_HELD", "Editor A"]);
    assert.equal((await w.fails("jc_agent_create", { title: "R2", prompt: "p", role: "reviewer", grantsWrite: true }, second)).code, "TEAM_ROLE_DENIED");
    const reviewer = await c.spawn({ title: "Reviewer", role: "reviewer" }, second);
    const record = await c.get(writer.agentId);
    assert.deepEqual([record.labels["jc.team.role"], record.labels["jc.team.tier"], record.tier, record.canWrite, record.grantsWrite, record.origin], ["editor", "peer", "peer", true, true, "team"]);
    const unassigned = await w.writeFails("jc_text_add", { content: "B", start: 0, duration: S }, other.sessionKey);
    assert.deepEqual([unassigned.code, unassigned.details?.reason], ["WRITER_HELD", "not_assigned"]);
    assert.equal((await w.writeFails("jc_text_add", { content: "R", start: 0, duration: S }, reviewer.sessionKey)).code, "TEAM_ROLE_DENIED");
    await w.write("jc_text_add", { content: "A", start: 0, duration: S }, writer.sessionKey);
    // "Message names the alternative": a peer cannot create agents and is told to hand back.
    const peer = await w.fails("jc_agent_create", { title: "Sub", prompt: "p", role: "editor" }, writer.sessionKey);
    assert.equal(peer.code, "TEAM_ROLE_DENIED");
    assert.match(peer.message, /cannot create agents[\s\S]*jc_agent_handback/);
    // "Retryable flag": three peers are working with a limit of three.
    const limit = await w.fails("jc_agent_create", { title: "Fourth", prompt: "p", role: "researcher" }, second);
    assert.deepEqual([limit.code, limit.retryable, limit.details], ["TEAM_LIMIT_CONCURRENT_PEERS", true, { limit: 3, active: 3 }]);
    // After the writer handed back, the next editor can be given the write assignment.
    await c.end(writer.sessionKey, "Done.");
    const next = await c.spawn({ title: "Editor C", role: "editor", grantsWrite: true }, second);
    await w.write("jc_text_add", { content: "C", start: 2 * S, duration: S }, next.sessionKey);
  } finally { w.close(); }
});

test("Sub-budget reservation; Unspent sub-budget returns; Tree budget exhausted", async () => {
  const w = await world(), c = crew(w);
  try {
    // Budgets bind money that is paid: the CLI is signed in with an API key.
    await billedPerCall(w.h);
    await c.prompt();
    const [root] = await c.tree();
    await w.admin.call("jagentchill.agent.budget.set", { agentId: root.id, limitUsd: 3 });
    const tooMuch = await w.fails("jc_agent_create", { title: "Greedy", prompt: "p", budgetUsd: 3.5 });
    assert.deepEqual([tooMuch.code, tooMuch.details], ["BUDGET_EXCEEDED", { remainingUsd: 3 }]);
    const child = await c.spawn({ title: "Child", budgetUsd: 1 });
    assert.deepEqual([(await c.get(child.agentId)).budget.limitUsd, (await c.tree())[0].budget.reservedUsd, (await w.ok("jc_agent_catalog")).data.remainingUsd], [1, 1, 2]);
    // The child spends 0.40 USD (400 tokens at 1000 USD per million) and is closed: 0.60 comes back.
    await c.end(child.sessionKey, "Done.", "final", { input: 300, output: 100 });
    await until(async () => (await c.get(child.agentId)).budget.spentUsd === 0.4, "the child's cost");
    await w.admin.call("jagentchill.agent.close", { agentId: child.agentId });
    assert.deepEqual([(await c.tree())[0].budget.reservedUsd, (await w.ok("jc_agent_catalog")).data.remainingUsd], [0, 2.6]);
    // A second child spends past its own limit: its next tool call stops; the tree goes on.
    const small = await c.spawn({ title: "Small", budgetUsd: 0.2 });
    await c.end(small.sessionKey, "Done.", "final", { input: 200, output: 100 });
    await until(async () => (await c.get(small.agentId)).budget.exhausted, "the limit to be reached");
    assert.throws(() => w.h.app.team.assertBudget(small.sessionKey), /Budget reached/);
    assert.equal((await w.fails("jc_agent_send", { agentId: small.agentId, prompt: "Go on." })).code, "BUDGET_EXCEEDED");
    w.h.app.team.assertBudget(w.sessionKey);
    // The whole tree: three agents together spend the root's limit; every member is refused and the session is told once.
    const big = await c.spawn({ title: "Big" });
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    await c.end(big.sessionKey, "Done.", "final", { input: 2000, output: 500 });
    await until(async () => (await c.tree())[0].budget.exhausted, "the tree's limit to be reached");
    for (const sessionKey of [w.sessionKey, big.sessionKey, small.sessionKey]) assert.throws(() => w.h.app.team.assertBudget(sessionKey), /Budget reached/);
    assert.equal(w.admin.events.filter((event) => event.event === "jagentchill.chat.notice" && event.payload.code === "tree-budget").length, 1);
    const stopped = await w.fails("jc_agent_create", { title: "One more", prompt: "p" });
    assert.deepEqual([stopped.code, stopped.details?.limitUsd], ["BUDGET_EXCEEDED", 3]);
    await assert.rejects(w.admin.call("jagentchill.chat.send", { sessionKey: big.sessionKey, message: "More" }), /BUDGET_EXCEEDED/);
    // An admin raises the budget and the tree works again.
    await w.admin.call("jagentchill.agent.budget.set", { agentId: root.id, limitUsd: 10 });
    w.h.app.team.assertBudget(big.sessionKey);
    // Usage is recorded by agent tree: the root's tree holds every member's own totals.
    const usage = await w.admin.call("jagentchill.usage.session.get", { sessionId: w.sessionKey, includeTree: true });
    assert.equal(usage.tree.children.length, 3);
    assert.equal(usage.tree.subtree.costUsd, 3.2);
  } finally { w.close(); }
});

test("Ping-pong; a message to oneself, the same message twice and a message into another session's tree are refused", async () => {
  const w = await world(), c = crew(w);
  try {
    await c.prompt();
    const [root] = await c.tree();
    const b = await c.spawn({ title: "B" });
    const self = await w.fails("jc_agent_send", { agentId: root.id, prompt: "Note to self" });
    assert.deepEqual([self.code, self.details?.guard], ["AGENT_LOOP_DETECTED", "cycle"]);
    const send = (from: string, to: string, text: string) => w.call("jc_agent_send", { agentId: to, prompt: text, wait: "none" }, from);
    assert.equal((await send(w.sessionKey, b.agentId, "Question 1")).ok, true);
    const same = await w.fails("jc_agent_send", { agentId: b.agentId, prompt: "question   1" });
    assert.deepEqual([same.code, same.details?.guard], ["AGENT_LOOP_DETECTED", "duplicate"]);
    assert.equal((await send(b.sessionKey, root.id, "Answer 1")).ok, true);
    assert.equal((await send(w.sessionKey, b.agentId, "Question 2")).ok, true);
    assert.equal((await send(b.sessionKey, root.id, "Answer 2")).ok, true);
    const third = await w.fails("jc_agent_send", { agentId: b.agentId, prompt: "Question 3" });
    assert.deepEqual([third.code, third.details?.guard, third.retryable], ["AGENT_LOOP_DETECTED", "ping_pong", false]);
    // A person writes again: the counters start over.
    await c.end(w.sessionKey);
    await c.prompt();
    assert.equal((await send(w.sessionKey, b.agentId, "Question 3")).ok, true);
    const other = await w.session();
    const foreign = await w.fails("jc_agent_send", { agentId: b.agentId, prompt: "Hello" }, other);
    // Unknown or foreign id: an agent of another session is answered like an id that does not exist.
    assert.equal(foreign.code, "AGENT_NOT_FOUND");
    assert.equal((await w.fails("jc_agent_status", { agentId: "agt_missing" })).code, "AGENT_NOT_FOUND");
  } finally { w.close(); }
});

test("Team without a lead; a stale save is refused; shipped teams are restored by reset; every agent method has its scope", async () => {
  const w = await world();
  try {
    const listed = await w.admin.call("jagentchill.orc.team.list", {});
    assert.deepEqual(listed.teams.map((team: any) => [team.id, team.template, team.roleCount]), [["film-studio", true, 10], ["video-production", true, 7]]);
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...draft } = team;
    const noLead = { ...draft, roles: draft.roles.map((role: any) => (role.tier === "lead" ? { ...role, enabled: false } : role)) };
    await assert.rejects(w.admin.call("jagentchill.orc.team.save", { team: noLead }), /INVALID_PARAMS/);
    const saved = await w.admin.call("jagentchill.orc.team.save", { team: { ...draft, name: "Our video team", writerPolicy: "queue" } });
    assert.deepEqual([saved.team.rev, saved.team.name, saved.template], [1, "Our video team", false]);
    await assert.rejects(w.admin.call("jagentchill.orc.team.save", { team: { ...draft, name: "Stale" } }), /CONFLICT/);
    const editor = await w.h.pair("Edit bay", "editor");
    await assert.rejects(editor.call("jagentchill.orc.team.save", { team: { ...draft, rev: 1 } }), /SCOPE_DENIED/);
    const copy = await w.admin.call("jagentchill.orc.team.duplicate", { teamId: "video-production" });
    assert.deepEqual([copy.team.id, copy.team.name], ["video-production-copy", "Our video team (copy)"]);
    const reset = await w.admin.call("jagentchill.orc.team.reset", { teamId: "video-production" });
    assert.deepEqual([reset.team.name, reset.team.writerPolicy, reset.template], ["Video production team", "lead_assigns", true]);
    await w.admin.call("jagentchill.orc.team.delete", { teamId: copy.team.id });
    await assert.rejects(w.admin.call("jagentchill.orc.team.get", { teamId: copy.team.id }), /TEAM_NOT_FOUND/);
    await assert.rejects(w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "no-such-team" }), /TEAM_NOT_FOUND/);
    const served = [...w.h.app.methods.keys()].filter((name) => /^jagentchill\.(agent|orc\.(team|run|approval|signoff))\./.test(name)).sort();
    assert.deepEqual(served, Object.keys(AGENT_TEAM_METHOD_SCOPES).sort());
    for (const name of served) assert.equal(w.h.app.methods.get(name)!.scope, AGENT_TEAM_METHOD_SCOPES[name as keyof typeof AGENT_TEAM_METHOD_SCOPES], name);
  } finally { w.close(); }
});

test("Activity limit: a tree that reached its turn ceiling starts nothing more, keeps what waits for its agents, and goes on when a person resumes", async () => {
  const w = await world(), c = crew(w);
  try {
    const { team } = await w.admin.call("jagentchill.orc.team.get", { teamId: "video-production" });
    const { created_ms: _c, updated_ms: _u, ...draft } = team;
    await w.admin.call("jagentchill.orc.team.save", { team: { ...draft, limits: { ...draft.limits, maxRunTurns: 3 } } });
    await w.admin.call("jagentchill.agent.team.set", { sessionKey: w.sessionKey, teamId: "video-production" });
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    await c.prompt();
    const a = await c.spawn({ title: "Researcher", role: "researcher" }), b = await c.spawn({ title: "Writer", role: "screenwriter" });
    const refused = await w.fails("jc_agent_create", { title: "Reviewer", prompt: "p", role: "reviewer" });
    assert.deepEqual([refused.code, refused.details, refused.retryable], ["AGENT_LOOP_DETECTED", { guard: "turns", limit: 3 }, false]);
    await w.fails("jc_agent_create", { title: "Reviewer", prompt: "p", role: "reviewer" });
    await tick(60);
    assert.equal(w.admin.events.filter((event) => event.event === "jagentchill.chat.notice" && event.payload.code === "agent-activity-limit").length, 1);
    let [root] = await c.tree();
    assert.deepEqual([root.deliveryPaused, root.attention], [{ limit: 3 }, "error"]);
    // The children finish: their results wait, the Director is not started again.
    const before = c.delivered(w.sessionKey).length;
    await c.end(w.sessionKey);
    await c.end(a.sessionKey, "Found three references."); await c.end(b.sessionKey, "Wrote the hook.");
    await tick(120);
    assert.equal(c.delivered(w.sessionKey).length, before);
    // A person resumes: both results arrive as one message and the tree works again.
    const resumed = await w.admin.call("jagentchill.agent.delivery.resume", { rootId: root.id });
    assert.equal(resumed.agents[0].deliveryPaused, undefined);
    await until(() => c.delivered(w.sessionKey).length > before, "the kept results");
    assert.match(c.delivered(w.sessionKey).at(-1)!, /^2 sub-agents settled\./);
    [root] = await c.tree();
    assert.equal(root.attention, "none");
    await c.spawn({ title: "Reviewer", role: "reviewer" });
  } finally { w.close(); }
});
