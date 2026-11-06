// What the host tells the devices about a wait of the chat (brief w7-chat items 2 and 4): a turn the host starts itself
// (the person's answer or decision), and a compaction from the moment it starts. The runtime is the FAKE of
// `harness.ts` — here it is made SLOW on purpose (it takes its turns and its compaction late) because the defects are
// about what the devices are shown during those waits; the server, its request records and its context-window service
// are the real ones.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tick } from "./harness.ts";
import { toolWorld } from "./support/tools.ts";

const until = async (done: () => boolean, what: string) => { for (let n = 0; n < 400; n++) { if (done()) return; await tick(10); } throw new Error(`timed out waiting for ${what}`); };
type World = Awaited<ReturnType<typeof toolWorld>>;
const eventsOf = (w: World, event: string) => w.admin.events.filter((entry) => entry.event === event).map((entry) => entry.payload);
const order = (w: World, names: string[]) => w.admin.events.filter((entry) => names.includes(entry.event)).map((entry) => entry.event.replace("jagentchill.", ""));

test("Question answers start a user turn; typed chat while pending is the answer; decisions and host notes start a waiting line", async () => {
  const w = await toolWorld();
  try {
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    // The runtime takes 2 s to accept a message (a CLI that prepares its turn).
    let accepted = 0, sent = 0;
    w.h.fake.on("startTurn", async () => { sent++; await tick(2000); accepted = Date.now(); return { turnId: `run-slow-${sent}` }; });
    const immediate = await w.ok("jc_session_ask", { questions: [{ id: "abc", text: "Do you confirm abc?", kind: "single", options: [{ label: "Yes" }, { label: "No" }] }] });
    await until(() => eventsOf(w, "jagentchill.chat.question.requested").length === 1, "the pending question card");
    const question = eventsOf(w, "jagentchill.chat.question.requested")[0].question;
    assert.deepEqual([immediate.data.status, immediate.data.questionId], ["pending", question.questionId], "MCP returns while the question stays pending");
    assert.equal(eventsOf(w, "jagentchill.chat.turn.pending").length, 0, "no turn starts before an answer");
    await w.admin.call("jagentchill.chat.question.answer", { questionId: question.questionId, answers: [{ id: "abc", value: "Yes" }] });
    await until(() => eventsOf(w, "jagentchill.chat.turn.pending").length === 1, "the card answer turn");
    await until(() => accepted > 0, "the runtime to accept the answer turn");
    assert.ok(w.h.fake.callsOf("startTurn").some((call: any) => call.message.includes("Do you confirm abc?") && call.message.includes("I chose: Yes")));
    w.h.fake.endTurn(w.sessionKey, "run-slow-1", "final");
    await tick(50);
    accepted = 0;
    const typedCard = await w.ok("jc_session_ask", { questions: [{ id: "typed", text: "Which title?", kind: "text" }] });
    await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "Lanterns at dawn" });
    assert.equal(typedCard.data.status, "pending");
    assert.ok(w.h.fake.callsOf("startTurn").some((call: any) => call.message.includes("Which title?") && call.message.includes("I chose: Lanterns at dawn")), "ordinary chat text resolves the pending card");
    await until(() => accepted > 0, "the typed-answer turn");
    w.h.fake.endTurn(w.sessionKey, "run-slow-2", "final");
    await tick(50);
    // A permission decision starts a host-originated follow-up turn.
    accepted = 0;
    const answered = Date.now();
    const pending = await w.fails("jc_project_trash", { idempotencyKey: "k-trash-000000000001" });
    await w.admin.call("jagentchill.chat.approval.resolve", { requestId: pending.details.requestId, decision: "deny" });
    await until(() => eventsOf(w, "jagentchill.chat.turn.pending").length === 3, "the pending decision turn");
    const told = Date.now();
    assert.deepEqual([eventsOf(w, "jagentchill.chat.turn.pending")[2].reason, eventsOf(w, "jagentchill.chat.turn.pending")[2].sessionKey], ["decision", w.sessionKey]);
    assert.equal(accepted, 0, "the devices know before the runtime accepted the message");
    await until(() => accepted > 0, "the runtime's answer");
    console.log(`WAITING | decision → devices told a turn is coming: ${told - answered} ms | decision → the slow runtime accepted the message: ${accepted - answered} ms`);
    assert.ok(told - answered < 400, `told within 400 ms (${told - answered} ms)`);
    assert.ok(accepted - answered >= 1900, "the runtime of this test is slow");
    // End the decision turn before testing delivery of another host note.
    w.h.fake.endTurn(w.sessionKey, "run-slow-3", "final");
    await tick(50);
    // The runtime refuses the message: the line is taken back.
    w.h.fake.on("startTurn", async () => { throw new Error("the runtime is restarting"); });
    assert.equal(await w.h.app.relay.deliver(w.sessionKey, "[JAgentChill] note", { hostNote: true }), false);
    await until(() => eventsOf(w, "jagentchill.chat.turn.pending").length === 5, "pending and its cancel");
    assert.deepEqual(eventsOf(w, "jagentchill.chat.turn.pending").slice(3).map((entry) => [entry.reason ?? null, entry.cancelled ?? false]), [["host", false], [null, true]]);
  } finally { w.close(); }
});

test("Compaction is shown while it runs: the session's context says `compacting` from the moment the host starts one (the runtime of this test takes 1.5 s over it) until it ends; a runtime's own compaction inside a turn is taken from its compaction events", async () => {
  const w = await toolWorld();
  try {
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    const states = () => eventsOf(w, "jagentchill.session.context").filter((entry) => entry.sessionKey === w.sessionKey);
    let asked = 0, answered = 0, outcome: "final" | "error" = "final";
    // The host's compaction is the runtime's own `/compact`, run as a turn of its own: this runtime takes 1.5 s over it.
    w.h.fake.on("startTurn", async (params: any) => {
      if (params.message !== "/compact") return undefined;
      asked = Date.now();
      setTimeout(() => { answered = Date.now(); if (outcome === "final") w.h.fake.emit(params.sessionKey, { type: "compaction", phase: "end" }); w.h.fake.endTurn(params.sessionKey, undefined, outcome, "nothing to compact"); }, 1500);
      return undefined;
    });
    const before = states().length;
    const started = Date.now();
    const compacting = w.admin.call("jagentchill.session.compact", { sessionKey: w.sessionKey });
    await until(() => states().slice(before).some((entry) => entry.compacting), "the compacting state");
    const shown = Date.now();
    const first = states().slice(before).find((entry) => entry.compacting);
    assert.deepEqual([first.compacting.reason, typeof first.compacting.since_ms, first.compactions.length], ["manual", "number", 0]);
    assert.equal(answered, 0, "said while the runtime is still at it");
    assert.equal((await w.admin.call("jagentchill.session.context.get", { sessionKey: w.sessionKey })).compacting.reason, "manual", "a device that opens the chat now is told too");
    const result = await compacting;
    assert.equal(result.compacted, true);
    await until(() => eventsOf(w, "jagentchill.chat.compacted").length >= 1, "the compacted event");
    const last = states().at(-1);
    assert.deepEqual([last.compacting ?? null, last.compactions.length, last.compactions[0].reason], [null, 1, "manual"]);
    console.log(`COMPACTING | start → devices told: ${shown - started} ms | the runtime took ${answered - asked} ms | events ${order(w, ["jagentchill.session.context", "jagentchill.chat.compacted"]).slice(-4).join(" → ")}`);
    assert.ok(shown - started < 400, `told within 400 ms of the start (${shown - started} ms)`);
    assert.equal((await w.admin.call("jagentchill.chat.history", { sessionKey: w.sessionKey })).messages.some((message: any) => message.role === "user" && JSON.stringify(message.content).includes("/compact")), false, "the compaction is not a message of the conversation");
    // Nothing to compact (the runtime's compaction fails): the state goes back without a record.
    outcome = "error";
    assert.equal((await w.admin.call("jagentchill.session.compact", { sessionKey: w.sessionKey })).compacted, false);
    assert.equal(states().at(-1).compacting ?? null, null);
    w.h.fake.reset("startTurn");
    const compactedBefore = eventsOf(w, "jagentchill.chat.compacted").length;
    // A runtime that compacts by itself inside a turn.
    await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "keep going" });
    const at = states().length;
    w.h.fake.emit(w.sessionKey, { type: "compaction", phase: "start" });
    await until(() => states().length > at, "the runtime's compaction start");
    assert.equal(states().at(-1).compacting.reason, "runtime");
    w.h.fake.emit(w.sessionKey, { type: "compaction", phase: "end" });
    await until(() => eventsOf(w, "jagentchill.chat.compacted").length === compactedBefore + 1, "the runtime's compaction record");
    assert.deepEqual([states().at(-1).compacting ?? null, states().at(-1).compactions.at(-1).reason], [null, "runtime"]);
    // One that never reports its end is over when its turn is.
    w.h.fake.emit(w.sessionKey, { type: "compaction", phase: "start" });
    await until(() => !!states().at(-1).compacting, "a second start");
    w.h.fake.endTurn(w.sessionKey, undefined, "aborted");
    await until(() => !states().at(-1).compacting, "the end with the turn");
  } finally { w.close(); }
});
