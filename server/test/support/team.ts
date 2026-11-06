// Test support for the agent-team tests: a tool world with fast timings, the crew helpers and a team run of the shipped team. The agent runtimes are the FAKES of the runtime layer (`harness.ts`).
import assert from "node:assert/strict";
import type { AgentRecord, TeamRun } from "@jagentchill/protocol";
import { LOGIN_STALE_MS } from "../../src/runtimes/service.ts";
import { tick, type Harness } from "../harness.ts";
import { toolWorld, type ToolWorld } from "./tools.ts";

/** The three other required sections of a hand-back, for tests that are about something else. */
export const SECTIONS = { evidence: "Rendered the range and looked at it.", remainingUncertainty: "None", counterEvidence: "None" };
export const TIMINGS = { notifyBatchMs: 20, retryMs: [10, 10, 10], writerQueueMs: 600 };
export async function world(options: object = {}) {
  const clock = hostClock(), w = await toolWorld({ ...options, harness: { now: clock.now, extra: { agentTimings: TIMINGS } } });
  clock.bind(w.h);
  return w;
}
/** A clock of the host a test can move on: the host reads a CLI's sign-in again once its reading is old. `bind` it to the harness made with `now`. */
const skews = new WeakMap<Harness, { ms: number }>();
export function hostClock() {
  const skew = { ms: 0 };
  return { now: () => Date.now() + skew.ms, bind: (h: Harness) => void skews.set(h, skew) };
}
/**
 * The CLIs of the host are signed in with an API KEY (their own status commands say so): what their turns cost is paid
 * per call and counts against the agents' budgets (on the person's own subscription a turn costs nothing). The host read
 * the sign-ins when it started; its clock is moved past the time a reading holds and the new readings are waited for.
 * Call it before the turns the test measures.
 */
export async function billedPerCall(h: Harness, runtimeIds: Array<"claude-code" | "codex"> = ["claude-code"]): Promise<void> {
  const skew = skews.get(h);
  assert.ok(skew, "the harness was made without a host clock (`hostClock`)");
  if (runtimeIds.includes("claude-code")) h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  if (runtimeIds.includes("codex")) h.results.set("codex login status", h.ok("Logged in using an API key - sk-***\n"));
  skew.ms += LOGIN_STALE_MS + 1;
  for (const runtimeId of runtimeIds) {
    const billing = () => h.app.generation.gate.billingOf({ ref: { runtimeId, providerId: runtimeId === "codex" ? "openai" : "anthropic", modelId: "m" } });
    for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
    assert.equal(billing(), "per_call", `${runtimeId} is billed per call`);
  }
}
export async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let n = 0; n < 300; n++) { if (await done()) return; await tick(10); }
  throw new Error(`timed out waiting for ${what}`);
}
/**
 * What the server delivered to a session's agent, oldest first: the message of every turn the runtime was given, then
 * the messages the server holds for the end of the running turn (`relay.deliver` on a working session) and has not
 * started yet. The runtime gets a held message only when its turn ends; it was delivered all the same.
 */
const holds = new WeakMap<object, Map<string, Array<{ message: string; turns: number }>>>();
export function deliveries(h: Harness): (sessionKey: string) => string[] {
  const relay = h.app.relay as { deliver: (key: string, message: string, ...rest: unknown[]) => Promise<boolean>; isRunning(key: string): boolean };
  const turnsOf = (sessionKey: string) => h.fake.callsOf("startTurn").filter((call) => call.sessionKey === sessionKey).map((call) => String(call.message));
  let held = holds.get(relay);
  if (!held) {
    const map = new Map<string, Array<{ message: string; turns: number }>>();
    holds.set(relay, (held = map));
    const deliver = relay.deliver.bind(relay);
    relay.deliver = async (key, message, ...rest) => {
      const turns = turnsOf(key).length, waits = relay.isRunning(key);
      const delivered = await deliver(key, message, ...rest);
      if (delivered && waits) (map.get(key) ?? map.set(key, []).get(key)!).push({ message, turns });
      return delivered;
    };
  }
  const map = held;
  return (sessionKey) => {
    const turns = turnsOf(sessionKey);
    const waiting = (map.get(sessionKey) ?? []).filter((entry) => !turns.slice(entry.turns).some((turn) => turn.includes(entry.message)));
    return [...turns, ...waiting.map((entry) => entry.message)];
  };
}
export function crew(w: Pick<ToolWorld, "h" | "admin" | "ok" | "sessionKey">) {
  const fake = w.h.fake;
  const get = async (agentId: string): Promise<AgentRecord> => (await w.admin.call("jagentchill.agent.get", { agentId })).agent;
  const tree = async (as = w.sessionKey): Promise<AgentRecord[]> => (await w.admin.call("jagentchill.agent.tree.get", { sessionKey: as })).agents;
  /** The turn the runtime is running now for a session. */
  const runOf = (sessionKey: string) => { const runId = fake.session(sessionKey).turnId; assert.notEqual(runId, "", "no turn is running for the session"); return runId; };
  /** The runtime answers the running turn of a session with its last words and ends it. */
  const end = async (sessionKey: string, text = "Done.", state: "final" | "error" | "aborted" = "final") => {
    fake.reply(sessionKey, text, { runId: runOf(sessionKey), state });
    await until(() => !w.h.app.relay.isRunning(sessionKey), "the turn to end");
    await tick(40);
  };
  /** Ends the running turn and every turn the server started after it with a message it held: the session rests. */
  const rest = async (sessionKey: string, text = "Done.") => { for (let n = 0; n < 10 && w.h.app.relay.isRunning(sessionKey); n++) await end(sessionKey, text); };
  const prompt = async (as = w.sessionKey) => { await w.admin.call("jagentchill.chat.send", { sessionKey: as, message: "Make the intro shorter." }); };
  const spawn = async (args: Record<string, unknown> = {}, as = w.sessionKey) => {
    const made = await w.ok("jc_agent_create", { title: "Helper", prompt: "Do the part you were given.", ...args }, as);
    return { ...(made.data as { agentId: string; state: string }), sessionKey: (await get(made.data.agentId)).sessionKey };
  };
  const delivered = deliveries(w.h);
  const run = async (as = w.sessionKey): Promise<TeamRun> => (await w.admin.call("jagentchill.orc.run.get", { sessionKey: as })).runs[0];
  /** The session of the Director of a session's newest run: an agent of its own, never the person's session. */
  const director = async (as = w.sessionKey) => (await get((await run(as)).supervisorAgentId)).sessionKey;
  return { get, tree, runOf, end, rest, prompt, spawn, delivered, run, director };
}
/** A run of the shipped team with its lead; `peer` gives one assignment. */
export async function teamRun(w: ToolWorld, request = "Add a title card", as = w.sessionKey) {
  const c = crew(w);
  await w.admin.call("jagentchill.agent.team.set", { sessionKey: as, teamId: "video-production" });
  await w.admin.call("jagentchill.orc.run.start", { sessionKey: as, request });
  const directorKey = await c.director(as);
  const lead = (await w.ok("jc_team_bootstrap_lead", { relay: "A title card at the start." }, directorKey)).data, leadKey = (await c.get(lead.leadAgentId)).sessionKey;
  const peer = async (role: string, extra: Record<string, unknown> = {}) => {
    const made = (await w.ok("jc_team_create_peer", { role, assignment: `Do the ${role} part.`, ownershipBoundary: "Your part only.", expectedHandback: "What you did.", ...extra }, leadKey)).data as { agentId: string; assignmentId: string };
    return { ...made, sessionKey: (await c.get(made.agentId)).sessionKey };
  };
  return { leadId: lead.leadAgentId as string, leadKey, directorKey, peer };
}
export const proposalState = (w: ToolWorld, proposalId: string) => (w.h.app.db.prepare("SELECT state FROM tool_proposals WHERE proposal_id = ?").get(proposalId) as { state: string }).state;

