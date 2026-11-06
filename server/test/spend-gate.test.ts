// The PROVIDER in these tests is a TEST DOUBLE: an adapter object that counts its calls and bills what the test says.
// The gate itself (`src/generation/spend-gate.ts`) and its store (an in-memory SQLite database) are the real ones.
// Two tests run the whole server (`harness.ts`): the agent runtime there is the harness's fake, the Usage service and the gate's wiring to it are the real ones.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { JcProviderAdapter } from "../src/generation/adapter.ts";
import { createSpendGate, isSpendStop, SpendStop, SpendToken, type SpendCall } from "../src/generation/spend-gate.ts";
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
import { createHarness, tick, type Harness } from "./harness.ts";

/**
 * The Claude Code CLI of a host is signed in with an API KEY (its own status command says so): its turns are billed per
 * call at the model's price (ruling R9). The host reads the sign-in when it starts: its clock (`skew`) is moved past the
 * time a reading holds, the new reading is waited for, and the clock is put back (a reading taken "in the future" stays fresh).
 */
async function billedByKey(h: Harness, skew: { ms: number }): Promise<void> {
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  skew.ms += LOGIN_STALE_MS + 1;
  const billing = () => h.app.generation.gate.billingOf({ ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } });
  for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
  skew.ms = 0;
  assert.equal(billing(), "per_call", "Claude Code is billed per call");
}

function world(thresholdUsd = 0) {
  const db = new DatabaseSync(":memory:"), sent: string[] = [];
  let bill: number | undefined = 1, threshold = thresholdUsd;
  const raw: JcProviderAdapter = {
    describe: () => ({ id: "acme", label: "Acme", description: "", source: "builtin", capabilities: ["image", "transcription", "translation"], hosts: ["acme.test"], authFields: [] }),
    validateConnection: async () => ({ outcome: "ok", message: "" }), listModels: async () => [],
    submit: async (request) => { sent.push(`submit:${request.model}`); return { result: { outputs: [], units: {}, ...(bill !== undefined ? { costUsd: bill } : {}) } }; },
    transcribe: async (input) => { sent.push(`transcribe:${input.model}`); return { text: "heard", ...(bill !== undefined ? { costUsd: bill } : {}) }; },
    translate: async (input) => { sent.push(`translate:${input.model}`); return { text: "written", ...(bill !== undefined ? { costUsd: bill } : {}) }; },
  };
  const gate = createSpendGate({ db, now: () => Date.now(), thresholdUsd: () => threshold }), adapter = gate.guard(raw);
  const call = (estimateUsd: number | null, model = "m1"): SpendCall => ({ provider: "acme", model, estimateUsd, kind: "translation" });
  const ctx = { secret: "s", signal: new AbortController().signal };
  const translate = (actionId: string, estimateUsd: number | null, model = "m1") => gate.spend(actionId, call(estimateUsd, model), (token) => adapter.translate!({ prompt: "p", model }, ctx, token));
  const stopped = async (work: () => unknown): Promise<SpendStop> => { try { await work(); } catch (error) { if (isSpendStop(error)) return error; throw error; } return assert.fail("the gate let it through"); };
  /** A person is asked, and answers the question they were shown. */
  const approved = async (kind: string, quote: ReturnType<typeof gate.quote>, share?: number) => { const asked = await stopped(() => gate.open({ kind, owner: "dev", quote, ...(share ? { share } : {}) })); return gate.open({ kind, owner: "dev", quote, answer: { confirmed: true, ...asked.confirmWith }, ...(share ? { share } : {}) }).id; };
  return { db, gate, adapter, raw, sent, call, ctx, translate, stopped, approved, bills: (usd: number | undefined) => { bill = usd; }, threshold: (usd: number) => { threshold = usd; } };
}

test("No paid adapter call without a token of the gate: a call with none, with a forged one, with a used one or with another model's is refused before the provider is reached — and nothing in the server's source calls a provider's paid method or a runtime's turn anywhere but through the gate", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 5, models: ["acme/m1"] }));
  const bypass = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return (error as { details?: { reason?: string } }).details?.reason; } return "sent"; };
  assert.equal(await bypass(() => (w.adapter.translate as any)({ prompt: "p", model: "m1" }, w.ctx)), "spend_gate_bypassed");
  assert.equal(await bypass(() => (w.adapter.submit as any)({ capability: "image", model: "m1", params: {}, metadata: {} }, w.ctx, { actionId, call: w.call(1) })), "spend_gate_bypassed", "an object that looks like a token is not one");
  assert.equal(await bypass(async () => w.adapter.transcribe!({ bytes: new Uint8Array(), format: "wav", model: "m1" }, w.ctx, new (SpendToken as any)(Symbol("spend-gate"), actionId, w.call(1), () => undefined))), "spend_gate_bypassed", "nothing but the gate makes a token");
  let kept: SpendToken | undefined;
  await w.gate.spend(actionId, w.call(1), async (token) => { kept = token; await w.adapter.translate!({ prompt: "p", model: "m1" }, w.ctx, token); assert.equal(await bypass(() => w.adapter.translate!({ prompt: "again", model: "m1" }, w.ctx, token)), "spend_gate_bypassed", "one token, one request"); });
  assert.equal(await bypass(() => w.adapter.translate!({ prompt: "later", model: "m1" }, w.ctx, kept!)), "spend_gate_bypassed", "a token does not outlive its spend");
  assert.equal(await bypass(() => w.gate.spend(actionId, w.call(1), (token) => w.adapter.translate!({ prompt: "p", model: "other" }, w.ctx, token))), "spend_gate_bypassed", "a token is for the model that was checked");
  assert.deepEqual([w.sent, w.gate.stats().sent, w.gate.spentOf(actionId)], [["translate:m1"], 1, 1]);

  // The source: outside the gate, the adapter contract and the adapters themselves, no file of the server names a raw
  // adapter's paid method; the generation service takes its adapters only through `guard`; and a turn of a runtime's
  // model (`runs.turn`) is written in film and captions only inside their one gated helper (`paidTurn`).
  const root = join(import.meta.dirname, "..", "src"), files = (readdirSync(root, { recursive: true }) as string[]).filter((name) => name.endsWith(".ts"));
  const read = (name: string) => readFileSync(join(root, name), "utf8");
  const service = read("generation/service.ts");
  assert.equal((service.match(/deps\.adapters/g) ?? []).length, 1, "the raw adapters are named once in the generation service…");
  assert.ok(/deps\.adapters\.map\(\(adapter\) => gate\.guard\(adapter\)\)/.test(service), "…where each is put behind the gate");
  for (const name of files.filter((file) => !["generation/spend-gate.ts", "generation/adapter.ts", "generation/openrouter.ts"].includes(file.replaceAll("\\", "/")))) {
    const text = read(name);
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      // (The call may run over a few lines: its last argument is what is looked for.)
      if (/\b(adapter|adapters\.get\([^)]*\)!?|adapterOf\([^)]*\))\.(submit|transcribe!?|translate!?)\(/.test(line)) assert.ok(/,\s*(token|given)\)/.test(lines.slice(index, index + 5).join("\n")), `${name}:${index + 1} calls a provider's paid method without the gate's token`);
    }
    if (/^(film|captions)\//.test(name.replaceAll("\\", "/"))) {
      const turns = text.split("\n").filter((line) => /runs\.turn\b/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) && !/payer\?: \{|turn\?: /.test(line));
      for (const line of turns) assert.ok(/paidTurn|guardTurn\(/.test(line), `${name} runs a turn of a runtime's model outside the gate: ${line.trim().slice(0, 120)}`);
    }
  }
});

test("(a) (e) Cumulative: every earlier charge of the action counts — a third $1 request on a $2 approval is not sent; the action stops with ONE question on record that says what was spent and what remains, and the answer to it lets exactly that go on", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 2, models: ["acme/m1"] }));
  await w.translate(actionId, 1);
  await w.translate(actionId, 1);
  const stop = await w.stopped(() => w.translate(actionId, 1));
  assert.deepEqual([stop.reason, stop.question.spentUsd, stop.question.remainsUsd, stop.question.amountUsd, stop.approvedUsd, w.sent.length], ["over_amount", 2, 1, 3, 2, 2]);
  // Asked again without an answer, by this request or another of the action: the same question, nothing sent.
  const again = await w.stopped(() => w.translate(actionId, 1));
  assert.deepEqual([again.question.id, w.sent.length], [stop.question.id, 2]);
  const quote = w.gate.quote({ amountUsd: 2, models: ["acme/m1"] });
  assert.equal((await w.stopped(() => w.gate.open({ actionId, kind: "t", owner: "dev", quote }))).question.id, stop.question.id);
  assert.equal((await w.stopped(() => w.gate.open({ actionId, kind: "t", owner: "dev", quote, answer: { confirmed: true, quoteId: "another-question" } }))).question.id, stop.question.id, "an answer to another question is not an answer to this one");
  assert.deepEqual([w.gate.open({ actionId, kind: "t", owner: "dev", quote, answer: { confirmed: true, ...stop.confirmWith } }).approved?.amountUsd, (await w.translate(actionId, 1)).text, w.sent.length, w.gate.spentOf(actionId)], [3, "written", 3, 3]);
  // Requests made together reserve their share: two $1 requests on what leaves room for one send one.
  const both = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"] })), before = w.sent.length;
  const outcomes = await Promise.allSettled([w.translate(both, 1), w.translate(both, 1)]);
  assert.deepEqual([outcomes.map((entry) => entry.status).sort(), w.sent.length - before], [["fulfilled", "rejected"], 1]);
  // A film run stops at the spec's share of what was confirmed (120 %), not at the amount itself.
  const run = await w.approved("run", w.gate.quote({ amountUsd: 10, models: ["acme/m1"] }), 1.2);
  w.bills(6);
  await w.translate(run, 5);
  await w.translate(run, 5);
  assert.deepEqual([w.gate.action(run)?.limitUsd, (await w.stopped(() => w.translate(run, 0.01))).reason], [12, "over_amount"]);
});

test("(b) An approval is bound to the quote that was shown: `confirmed: true` to nothing approves nothing; an answer after the amount or the models changed approves nothing and the quote of now is asked; an action that ended takes no answer again", async () => {
  const w = world(), shown = w.gate.quote({ amountUsd: 2, models: ["acme/m1"] });
  // Nobody was shown anything: the question is put on record and asked.
  const first = await w.stopped(() => w.gate.open({ kind: "t", owner: "dev", quote: shown, answer: { confirmed: true } }));
  assert.deepEqual([first.reason, first.question.id, first.question.amountUsd], ["not_approved", shown.id, 2]);
  // The price went up between the question and the answer.
  const dearer = w.gate.quote({ amountUsd: 4, models: ["acme/m1"] });
  const second = await w.stopped(() => w.gate.open({ kind: "t", owner: "dev", quote: dearer, answer: { confirmed: true, ...first.confirmWith } }));
  assert.deepEqual([second.reason, second.question.amountUsd, second.actionId, w.gate.action(first.actionId)?.approved], ["outdated_quote", 4, first.actionId, undefined]);
  // The route changed: the same amount on another model is another quote.
  const moved = w.gate.quote({ amountUsd: 4, models: ["acme/m2"] });
  const third = await w.stopped(() => w.gate.open({ kind: "t", owner: "dev", quote: moved, answer: { confirmed: true, ...second.confirmWith } }));
  assert.deepEqual([third.reason, third.question.models], ["outdated_quote", ["acme/m2"]]);
  const view = w.gate.open({ kind: "t", owner: "dev", quote: moved, answer: { confirmed: true, ...third.confirmWith } });
  assert.deepEqual([view.approved?.amountUsd, view.approved?.by, view.limitUsd], [4, "person", 4]);
  // Another device's answer, or another kind of action, is not this action's.
  assert.equal((await w.stopped(() => w.gate.open({ kind: "t", owner: "someone-else", quote: moved, answer: { confirmed: true, ...third.confirmWith } }))).actionId === view.id, false);
  // The action ended: the same answer, sent again, starts a new action that must be asked.
  w.gate.close(view.id);
  assert.equal((await w.stopped(() => w.gate.open({ kind: "t", owner: "dev", quote: moved, answer: { confirmed: true, ...third.confirmWith } }))).reason, "not_approved");
  // Under the host's "ask before spending more than": approved by that amount, held to it.
  w.threshold(5);
  const small = w.gate.open({ kind: "t", owner: "dev", quote: shown });
  assert.deepEqual([small.approved?.by, small.limitUsd], ["threshold", 5]);
});

test("(c) Price not known is never zero: a request whose price is unknown is sent only to a model approved by name — a confirmed amount, however large, does not cover it, and neither does the host's amount", async () => {
  const w = world(100), actionId = w.gate.open({ kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 50, models: ["acme/m1"] }) }).id;
  const stop = await w.stopped(() => w.translate(actionId, null, "nobody-priced"));
  assert.deepEqual([stop.reason, stop.question.unpriced, stop.details().estimate, w.sent.length], ["unpriced_model", ["acme/nobody-priced"], { amountUsd: null, spentUsd: 0, remainsUsd: null, unpriced: true, unpricedModels: ["acme/nobody-priced"], models: ["acme/nobody-priced"] }, 0]);
  // A figure is not an approval of it.
  assert.equal(w.gate.raise(actionId, 1000).question?.id, stop.question.id);
  w.gate.open({ actionId, kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 50, models: ["acme/m1"] }), answer: { confirmed: true, ...stop.confirmWith } });
  w.bills(undefined);
  await w.translate(actionId, null, "nobody-priced");
  assert.equal((await w.stopped(() => w.translate(actionId, null, "another-unpriced"))).reason, "unpriced_model", "the approval names one model");
  // A quote that lists a model as unpriced is always asked, and approving it approves that model.
  const quoted = w.gate.quote({ amountUsd: 0, models: ["acme/m1"], unpriced: ["acme/free-or-not"] });
  assert.equal(w.gate.needsAsking(quoted), true);
  const named = await w.approved("t", quoted);
  await w.translate(named, null, "free-or-not");
  assert.deepEqual(w.sent, ["translate:nobody-priced", "translate:free-or-not"]);
});

test("(d) A charge is recorded the moment the provider answers: what the caller does with the answer afterwards — it throws while storing it — does not undo it; the charge is in the host's store, counts against the approval at the next request, and is there after a restart of the gate", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 2, models: ["acme/m1"] }));
  await assert.rejects(w.gate.spend(actionId, w.call(1), async (token) => { await w.adapter.submit({ capability: "image", model: "m1", params: {}, metadata: {} as never }, { ...w.ctx, idempotencyKey: "k", progress: () => undefined }, token); assert.equal(token.chargedUsd, 1); throw new Error("the file could not be stored"); }), /could not be stored/);
  assert.equal(w.gate.spentOf(actionId), 1);
  // A request that never reached the provider is not charged.
  await assert.rejects(w.gate.spend(actionId, w.call(1), async () => { throw new Error("network"); }), /network/);
  assert.equal(w.gate.spentOf(actionId), 1);
  await w.translate(actionId, 1);
  const restarted = createSpendGate({ db: w.db, now: () => Date.now(), thresholdUsd: () => 0 }), again = restarted.guard(w.raw);
  assert.deepEqual([restarted.spentOf(actionId), restarted.action(actionId)?.approved?.amountUsd], [2, 2]);
  await assert.rejects(restarted.spend(actionId, w.call(1), (token) => again.translate!({ prompt: "p", model: "m1" }, w.ctx, token)), (error) => isSpendStop(error) && error.question.spentUsd === 2);
  // A provider that says nothing of its cost is charged the estimate; a turn of a runtime's model, when it has answered.
  w.bills(undefined);
  const quiet = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["runtime:acme/chat"] }));
  await w.translate(quiet, 0.25);
  await w.gate.spend(quiet, { provider: "acme", model: "chat", via: "runtime", estimateUsd: null, kind: "turn" }, async () => "an answer");
  assert.deepEqual([w.gate.spentOf(quiet), (w.db.prepare("SELECT COUNT(*) AS n FROM gen_charges WHERE action_id = ?").get(quiet) as { n: number }).n], [0.25, 2]);
});

test("(f) Two answers to one question spend once: the answer clears the question, so the second one approves nothing more; and two identical requests made together are one piece of work", async () => {
  const w = world(), quote = w.gate.quote({ amountUsd: 1, models: ["acme/m1"] });
  const asked = await w.stopped(() => w.gate.open({ kind: "t", owner: "dev", quote })), answer = { confirmed: true, ...asked.confirmWith };
  let works = 0;
  const request = () => w.gate.once(`t:${asked.actionId}`, async () => { works++; const actionId = w.gate.open({ kind: "t", owner: "dev", quote, answer }).id; const written = await w.translate(actionId, 1); w.gate.close(actionId); return written.text; });
  assert.deepEqual([await Promise.all([request(), request()]), works, w.sent.length], [["written", "written"], 1, 1]);
  // The click that comes after the work ended is a new action: asked, not paid.
  assert.equal((await w.stopped(request)).reason, "not_approved");
  assert.equal(w.sent.length, 1);
  // There is no action "nobody is asked about": the gate has no way to make one (review 12 #1).
  assert.equal("host" in w.gate, false);
});

test("A run that asks its own person puts what they confirmed on record with the gate (`cover`): its requests are then covered by an approval the gate knows — sent while inside it, held at the run's share of it, every charge counted — neither refused as unknown nor waved through; a model of unknown price is covered only BY NAME (Review 11 #7: no blanket leave)", async () => {
  const w = world();
  assert.equal(w.gate.covered("run:r1"), undefined, "a run that put nothing on record is not covered");
  w.gate.cover({ fixedId: "run:r1", kind: "workflow.run", owner: "run:r1", amountUsd: 2, share: 1.2 });
  assert.deepEqual([w.gate.covered("run:r1"), w.gate.action("run:r1")?.limitUsd], ["run:r1", 2.4]);
  await w.translate("run:r1", 1);
  await w.translate("run:r1", 1);
  const stop = await w.stopped(() => w.translate("run:r1", 1));
  assert.deepEqual([stop.reason, stop.question.spentUsd, w.sent.length], ["over_amount", 2, 2]);
  w.gate.cover({ fixedId: "run:r1", kind: "workflow.run", owner: "run:r1", amountUsd: 4, share: 1.2 });
  // The amount names nobody: a model whose price is not known is not sent on the strength of it…
  assert.deepEqual([(await w.stopped(() => w.translate("run:r1", null, "unpriced-by-the-run"))).reason, w.sent.length], ["unpriced_model", 2]);
  // …only when the run's confirmation NAMED it.
  w.gate.cover({ fixedId: "run:r1", kind: "workflow.run", owner: "run:r1", amountUsd: 4, share: 1.2, unpriced: ["acme/unpriced-by-the-run"] });
  w.bills(undefined);
  await w.translate("run:r1", null, "unpriced-by-the-run");
  assert.equal(w.sent.length, 3);
});

// ---- Review 11 (run 10): the gate true to its own invariant ----
test("Review 11 #1 — nothing but the exact answer approves: a question that is on record, unchanged, is not approved by `confirmed: true` alone, nor with only its quote or only its action — and an amount named for it needs the question's ids as well", async () => {
  const w = world(), quote = w.gate.quote({ amountUsd: 2, models: ["acme/m1"] });
  const asked = await w.stopped(() => w.gate.open({ fixedId: "t:one", kind: "t", owner: "dev", quote }));
  for (const answer of [{ confirmed: true }, { confirmed: true, quoteId: asked.confirmWith.quoteId }, { confirmed: true, actionId: asked.confirmWith.actionId }, { confirmed: true, actionId: asked.confirmWith.actionId, quoteId: "0000" }]) {
    assert.equal((await w.stopped(() => w.gate.open({ fixedId: "t:one", kind: "t", owner: "dev", quote, answer }))).question.id, asked.question.id, JSON.stringify(answer));
  }
  assert.equal(w.gate.action("t:one")?.approved, undefined);
  assert.equal(w.gate.raise("t:one", 50).question?.id, asked.question.id, "a figure with no word of which question it answers approves nothing");
  assert.equal(w.gate.open({ fixedId: "t:one", kind: "t", owner: "dev", quote, answer: { confirmed: true, ...asked.confirmWith } }).approved?.amountUsd, 2);
});

test("Review 11 #2 — the WHOLE approved quote is kept and enforced: after approving m1, a request to m2 — priced, and inside the amount — is not sent; the action stops and asks about that model, and a request of another plan under the same approval is asked about too", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 5, models: ["acme/m1"], plan: "translate" }));
  await w.translate(actionId, 1, "m1");
  const stop = await w.stopped(() => w.translate(actionId, 1, "m2"));
  assert.deepEqual([stop.reason, stop.question.models, stop.question.spentUsd, w.sent], ["outdated_quote", ["acme/m2"], 1, ["translate:m1"]]);
  assert.deepEqual([w.gate.action(actionId)?.approved?.models, w.gate.action(actionId)?.approved?.plan], [["acme/m1"], "translate"]);
  w.gate.open({ actionId, kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 5, models: ["acme/m1"], plan: "translate" }), answer: { confirmed: true, ...stop.confirmWith } });
  await w.translate(actionId, 1, "m2");
  // The same action asked to do something else than what was approved: asked, though the amount would cover it.
  const other = await w.stopped(() => w.gate.open({ actionId, kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 1, models: ["acme/m1"], plan: "something else" }) }));
  assert.deepEqual([other.reason, other.question.plan, w.sent.length], ["outdated_quote", "something else", 2]);
});

test("Review 11 #3 — an approved model of unknown price is still under the amount: its first request reports $10 against a $1 approval, and the second is NOT sent — the action stops with what was spent", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/dear"] }));
  w.bills(10);
  await w.translate(actionId, null, "dear");
  const stop = await w.stopped(() => w.translate(actionId, null, "dear"));
  assert.deepEqual([stop.reason, stop.question.spentUsd, stop.approvedUsd, w.sent.length, w.gate.spentOf(actionId)], ["over_amount", 10, 1, 1, 10]);
});

test("Review 11 #4 — reservations and claims are in the host's store, not in one process's memory: two gates on ONE database send $2 of $1 requests against a $2 approval between them, never $3; and one logical request is claimed once — a second claim of it, from the other gate too, is refused while the first is held", async () => {
  const w = world(), other = createSpendGate({ db: w.db, now: () => Date.now(), thresholdUsd: () => 0 }), otherAdapter = other.guard(w.raw);
  const actionId = await w.approved("t", w.gate.quote({ amountUsd: 2, models: ["acme/m1"] }));
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const slow = (gate: typeof w.gate, adapter: typeof w.adapter) => gate.spend(actionId, w.call(1), async (token) => { await hold; return adapter.translate!({ prompt: "p", model: "m1" }, w.ctx, token); });
  const going = [slow(w.gate, w.adapter), slow(other, otherAdapter)], third = slow(w.gate, w.adapter).then(() => "sent", (error) => (isSpendStop(error) ? error.reason : String(error)));
  setTimeout(release, 30);
  assert.equal(await third, "over_amount", "the third request saw the two that were in the air — one of them reserved by the other gate");
  await Promise.all(going);
  assert.deepEqual([w.sent.length, w.gate.spentOf(actionId)], [2, 2]);
  assert.deepEqual([w.gate.claim("request:1"), other.claim("request:1"), w.gate.claim("request:1")], [true, false, false]);
  other.unclaim("request:1");
  assert.equal(other.claim("request:1"), true);
});

test("Review 11 #8 — charges are never deleted: an action that ended keeps every charge on record (they do not count against a NEW action of the same request), and what one job was billed is read back from the store after a restart", async () => {
  const w = world(), quote = w.gate.quote({ amountUsd: 2, models: ["acme/m1"] });
  const first = w.gate.open({ fixedId: "t:same", kind: "t", owner: "dev", quote, answer: { confirmed: true, ...(await w.stopped(() => w.gate.open({ fixedId: "t:same", kind: "t", owner: "dev", quote }))).confirmWith } }).id;
  await w.gate.spend(first, { ...w.call(1), ref: "job-1" }, (token) => w.adapter.translate!({ prompt: "p", model: "m1" }, w.ctx, token));
  w.gate.close(first);
  assert.equal((w.db.prepare("SELECT COUNT(*) AS n, SUM(usd) AS usd FROM gen_charges").get() as { n: number; usd: number }).usd, 1, "the charge is still on record");
  const restarted = createSpendGate({ db: w.db, now: () => Date.now(), thresholdUsd: () => 0 });
  assert.equal(restarted.chargedFor("job-1"), 1);
  // The same request again is a new action: asked, and it starts at $0 spent.
  const again = await w.stopped(() => restarted.open({ fixedId: "t:same", kind: "t", owner: "dev", quote }));
  assert.deepEqual([again.reason, again.question.spentUsd, restarted.spentOf("t:same")], ["not_approved", 0, 0]);
});

test("Review 11 #6 — a turn of a runtime's model is charged what it cost, before its answer is validated: the cost the turn reports (or what Usage's own record of the turn says) is the action's charge even when the caller then rejects the answer; it counts against the approval; a turn nobody can price is on record as 'not known' — never as zero — and usage that comes late is written into the store", async () => {
  const w = world(), ref = { providerId: "acme", modelId: "chat" }, actionId = await w.approved("t", w.gate.quote({ amountUsd: 0.5, models: [], unpriced: ["runtime:acme/chat"] }));
  let cost: number | undefined = 0.4, session = 1;
  const raw = async (_deviceId: string, input: { message: string; sessionKey?: string; discard?: boolean }) => { session += 0.3; return { text: `answer to ${input.message}`, sessionKey: input.sessionKey ?? "s1", ...(cost !== undefined ? { costUsd: cost } : {}) }; };
  // The turn says what it cost; the caller's validation throws afterwards: the charge stands.
  await assert.rejects(w.gate.guardTurn(raw)(actionId, ref, "dev", { message: "one" }).then(() => { throw new Error("the answer is not a plan"); }), /not a plan/);
  assert.equal(w.gate.spentOf(actionId), 0.4);
  // The turn says nothing; Usage has the record of THIS turn: charged what that record says (never what the session grew by — review 14 #2).
  cost = undefined;
  const turns: { runId: string; costUsd?: number; started_ms: number }[] = [];
  w.gate.bindUsage(async () => session, async (sessionKey) => (sessionKey === "s1" && cost === undefined ? [...turns] : []));
  await w.gate.guardTurn(async (deviceId: string, input: { message: string; sessionKey?: string; discard?: boolean }) => { (input as { onTurn?(runId: string): void }).onTurn?.("r-two"); turns.push({ runId: "r-two", costUsd: 0.3, started_ms: Date.now() }); return raw(deviceId, input); })(actionId, ref, "dev", { message: "two", sessionKey: "s1" });
  assert.equal(w.gate.spentOf(actionId), 0.7);
  turns.length = 0;
  // What was reported has passed the approval ($0.50): the next turn of this model is not sent.
  assert.equal((await w.stopped(() => w.gate.guardTurn(raw)(actionId, ref, "dev", { message: "three" }))).reason, "over_amount");
  // Nobody can say what a turn cost: "not known" on record, and late usage is written there.
  const quiet = await w.approved("t", w.gate.quote({ amountUsd: 1, models: [], unpriced: ["runtime:acme/chat"] }));
  await w.gate.guardTurn(raw)(quiet, ref, "dev", { message: "four", discard: true });
  const rows = () => (w.db.prepare("SELECT usd FROM gen_charges WHERE action_id = ?").all(quiet) as { usd: number | null }[]).map((row) => row.usd);
  assert.deepEqual(rows(), [null]);
  assert.deepEqual([w.gate.reconcile(quiet, ref, 0.25), rows(), w.gate.spentOf(quiet)], [true, [0.25], 0.25]);
  // A turn to a model that was not approved by name is not sent at all.
  let sent = 0;
  assert.equal((await w.stopped(() => w.gate.guardTurn(async () => { sent++; return { text: "" }; })(quiet, { providerId: "acme", modelId: "another" }, "dev", {}))).reason, "unpriced_model");
  assert.equal(sent, 0);
});

test("Review 11 #7 — no authority without an approval: work nobody approved by a quote (an agent's call, a run that put no confirmation on record) is held to the host's 'ask before spending more than' — everything it spends counted together — and is refused past it, or at a price that is not known", async () => {
  const w = world(2), actionId = w.gate.unattended("unattended", "run:x", w.call(1), "unattended:run:x");
  await w.translate(actionId, 1);
  await w.translate(w.gate.unattended("unattended", "run:x", w.call(1), "unattended:run:x"), 1);
  assert.equal((await w.stopped(() => w.translate(actionId, 1))).reason, "over_amount");
  assert.equal((await w.stopped(() => w.translate(w.gate.unattended("unattended", "run:y", w.call(null, "unpriced"), "unattended:run:y"), null, "unpriced"))).reason, "unpriced_model");
  assert.deepEqual([w.sent.length, w.gate.action(actionId)?.approved?.by, w.gate.action(actionId)?.limitUsd], [2, "threshold", 2]);
});

test("Review 12 #2 — an approval is capped at its OWN amount, whatever the host's 'ask before spending more than' is: a person approved $1, the host's amount is then $10 — the second $1 request is not sent (never $9 against $1); and a request of unknown price stops once the approved amount is used up exactly, not one request later", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"] }));
  w.threshold(10);
  await w.translate(actionId, 1);
  assert.equal(w.gate.action(actionId)?.limitUsd, 1, "the limit of an explicit approval is its amount");
  const stop = await w.stopped(() => w.translate(actionId, 1));
  assert.deepEqual([stop.reason, stop.question.spentUsd, w.sent.length, w.gate.spentOf(actionId)], ["over_amount", 1, 1, 1]);
  // The exact boundary: $1 approved with a model of unknown price named beside it. Its first request reports $1 — the
  // action has REACHED its limit with spending of unknown price: the next such request is not sent (not one request later, at $2).
  w.threshold(0);
  const mixed = await w.approved("u", w.gate.quote({ amountUsd: 1, models: ["acme/m1", "acme/nobody-priced"], unpriced: ["acme/nobody-priced"] }));
  await w.translate(mixed, null, "nobody-priced");
  const before = w.sent.length;
  assert.deepEqual([w.gate.spentOf(mixed), (await w.stopped(() => w.translate(mixed, null, "nobody-priced"))).reason, w.sent.length], [1, "over_amount", before], "spent equals the limit: nothing more of unknown price goes out");
  // The quote as it was approved is not an excess of it: the priced part cost exactly what was quoted, and the model of
  // unknown price has not been charged anything yet — its request goes out (speaking is paid, then the listener named at an unknown price listens).
  const planned = await w.approved("v", w.gate.quote({ amountUsd: 1, models: ["acme/m1", "acme/nobody-priced"], unpriced: ["acme/nobody-priced"] }));
  await w.translate(planned, 1);
  await w.translate(planned, null, "nobody-priced");
  assert.deepEqual([w.gate.spentOf(planned), (await w.stopped(() => w.translate(planned, null, "nobody-priced"))).reason], [2, "over_amount"]);
});

test("Review 12 #3 — an approval is not transferable: the answer to request A's question, sent with request B (the same kind, owner, amount, models and plan), approves nothing of B — B is asked its own question, A's stays open and is still answered by its own answer", async () => {
  const w = world(), quote = w.gate.quote({ amountUsd: 1, models: ["acme/m1"], plan: "image" });
  const a = await w.stopped(() => w.gate.open({ fixedId: "request:A", kind: "t", owner: "dev", quote }));
  const b = await w.stopped(() => w.gate.open({ fixedId: "request:B", kind: "t", owner: "dev", quote, answer: { confirmed: true, ...a.confirmWith } }));
  assert.deepEqual([b.actionId, b.confirmWith.actionId, w.gate.action("request:B")?.approved, w.gate.action("request:A")?.approved], ["request:B", "request:B", undefined, undefined]);
  assert.equal(w.gate.open({ fixedId: "request:A", kind: "t", owner: "dev", quote, answer: { confirmed: true, ...a.confirmWith } }).id, "request:A");
  assert.equal((await w.stopped(() => w.translate("request:B", 1))).actionId, "request:B");
});

test("Review 12 #7 — the charge of a turn of a runtime's model is settled from the usage the runtime reported for THAT turn, through the Usage service: a turn that reports no usage is charged 'not known' (never a settled $0); a turn that reports its tokens is charged them at the model's price; and a turn that fails still leaves its charge row, settled the same way", async () => {
  // (The Gateway read a turn's usage from its transcript AFTER the turn ended, so usage could settle late. An agent CLI
  // reports a turn's usage while the turn runs; what is late now is only a turn that reports none.)
  const skew = { ms: 0 };
  const h = await createHarness({ now: () => Date.now() + skew.ms, extra: { modelPrice: () => ({ inputPerMillionUsd: 3, outputPerMillionUsd: 15, source: "admin" as const }) } } as never);
  try {
    await billedByKey(h, skew);
    const admin = await h.pair("Studio Mac", "admin"), gate = h.app.generation.gate, ref = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" }, name = "runtime:anthropic/opus";
    const quote = gate.quote({ amountUsd: 1, models: [name], unpriced: [name], plan: "writing" });
    let asked: SpendStop | undefined;
    try { gate.open({ fixedId: "late:1", kind: "t", owner: "dev", quote }); } catch (error) { asked = error as SpendStop; }
    const actionId = gate.open({ fixedId: "late:1", kind: "t", owner: "dev", quote, answer: { confirmed: true, ...asked!.confirmWith } }).id;
    const charges = () => (h.app.db.prepare("SELECT usd FROM gen_charges WHERE action_id = ? ORDER BY id").all(actionId) as { usd: number | null }[]).map((row) => row.usd);
    const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string }>;
    const wait = async (done: () => boolean, what: string) => { for (let n = 0; n < 500 && !done(); n++) await tick(10); assert.ok(done(), what); };
    // The gate's turn as film and captions run it (no usage reader handed in: the host's own, as it is wired).
    const paid = gate.guardTurn(h.app.workflows.runs.turn);
    const turn = paid(actionId, ref, admin.device.deviceId, { ref, title: "Write", message: "One." });
    await wait(() => sends().length === 1, "the turn was sent");
    const { sessionKey } = sends()[0];
    h.fake.reply(sessionKey, "Answer.");
    const answer = await turn;
    assert.deepEqual([answer.text, charges()], ["Answer.", [null]], "answered with no usage known: the charge is 'not known', not a zero");
    // A turn that reports what it used (15,000 input tokens at $3 a million): its charge is that amount.
    const second = paid(actionId, ref, admin.device.deviceId, { ref, title: "Write", message: "Two.", sessionKey });
    await wait(() => sends().length === 2, "the second turn was sent");
    h.fake.reply(sessionKey, "Answer two.", { usage: { inputTokens: 15_000, outputTokens: 0 } });
    await second;
    await wait(() => charges()[1] === 0.045, `the charge was settled from the turn's usage: ${JSON.stringify(charges())}`);
    assert.equal(gate.spentOf(actionId), 0.045);
    // A turn that FAILS after it used 10,000 tokens: a charge row all the same, settled the same way.
    const failing = paid(actionId, ref, admin.device.deviceId, { ref, title: "Write", message: "Three.", sessionKey });
    await wait(() => sends().length === 3, "the third turn was sent");
    h.fake.reply(sessionKey, "", { usage: { inputTokens: 10_000, outputTokens: 0 }, state: "error", errorMessage: "The model stopped." });
    await assert.rejects(failing);
    await wait(() => charges()[2] === 0.03, `the failed turn's charge was settled: ${JSON.stringify(charges())}`);
    assert.deepEqual(charges(), [null, 0.045, 0.03], "the failed turn has its row");
    assert.equal(gate.spentOf(actionId), 0.075);
  } finally { await h.close(); }
});

test("Review 13 #2 — requests of unknown price are counted while they are in flight: at a fully spent $1 approval three of them made together send ONE (the model the quote named, once), the bill of that one is seen before the next is decided, and the other two are not sent — $2 in all, never $4; ones that bill nothing go out one at a time, never together; and a request made INSIDE a turn of unknown price that is still running is refused at exhaustion instead of waiting for it", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/m2"] }));
  await w.translate(actionId, 1);
  assert.equal(w.gate.spentOf(actionId), 1, "the priced part cost exactly what was approved");
  let flying = 0, most = 0;
  const slow = (id: string) => w.gate.spend(id, w.call(null, "m2"), async (token) => { flying++; most = Math.max(most, flying); try { await tick(15); return await w.adapter.translate!({ prompt: "p", model: "m2" }, w.ctx, token); } finally { flying--; } });
  const together = await Promise.allSettled([slow(actionId), slow(actionId), slow(actionId)]);
  assert.deepEqual([w.sent.filter((entry) => entry === "translate:m2").length, w.gate.spentOf(actionId), together.map((entry) => (entry.status === "fulfilled" ? "sent" : isSpendStop(entry.reason) ? entry.reason.reason : String(entry.reason))).sort()], [1, 2, ["over_amount", "over_amount", "sent"]]);
  // One cent under the approval is the same: the first one's bill is on record before the second is decided.
  const under = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/m2"], plan: "under" }));
  w.bills(0.99); await w.translate(under, 0.99); w.bills(1); w.sent.length = 0; most = 0;
  await Promise.allSettled([slow(under), slow(under), slow(under)]);
  assert.deepEqual([w.sent.length, w.gate.spentOf(under), most], [1, 1.99, 1]);
  // (Final #2, rule (h)) A quote that held NO amount — only the model's name: there is nothing to hold its requests to, so none waits for another's bill.
  const quiet = await w.approved("t", w.gate.quote({ amountUsd: 0, models: [], unpriced: ["acme/m2"], plan: "quiet" }));
  w.bills(undefined); w.sent.length = 0; most = 0;
  const calm = await Promise.allSettled([slow(quiet), slow(quiet), slow(quiet)]);
  assert.deepEqual([calm.map((entry) => entry.status), w.sent.length, most], [["fulfilled", "fulfilled", "fulfilled"], 3, 3]);
  // A turn of unknown price (an agent's step) is still running; a request of unknown price made inside it, with the action exhausted, is refused — it does not wait for the turn it is part of.
  const nested = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/m2", "runtime:acme/chat"], plan: "nested" }));
  w.bills(1); await w.translate(nested, 1);
  w.sent.length = 0;
  const inner = await w.gate.guardTurn(async () => ({ text: await Promise.race([w.translate(nested, null, "m2").then(() => "sent", (error) => (isSpendStop(error) ? error.reason : "error")), tick(1000).then(() => "waited")]) }))(nested, { providerId: "acme", modelId: "chat" }, "dev", {});
  assert.deepEqual([inner.text, w.sent], ["over_amount", []]);
});

test("Review 13 #3 — a failed turn keeps what it may have cost: a priced turn that fails stays charged its estimate until Usage says otherwise, so three failing $1 turns on a $2 approval are TWO turns (the third is not sent) — not $3 of late usage; and a turn whose session was made for it and then failed has that session on its charge (captured before the message was sent), so the usage of that turn settles it when it arrives", async () => {
  const w = world(), ref = { providerId: "acme", modelId: "chat" }, name = "runtime:acme/chat";
  const actionId = await w.approved("t", w.gate.quote({ amountUsd: 2, models: [name] }));
  let sent = 0;
  const failing = async (_deviceId: string, input: { sessionKey?: string; onSession?(sessionKey: string): void }) => { sent++; input.onSession?.(`made-${sent}`); (input as { onTurn?(runId: string): void }).onTurn?.(`r${sent}`); throw new Error("The model stopped."); };
  const records = new Map<string, { runId: string; costUsd?: number; started_ms: number }[]>();
  w.gate.bindUsage(async () => 0, async (sessionKey) => records.get(sessionKey) ?? []);
  for (let n = 0; n < 2; n++) await assert.rejects(w.gate.guardTurn(failing)(actionId, ref, "dev", {}, 1), /stopped/);
  const rows = () => w.db.prepare("SELECT usd, session_key, provisional FROM gen_charges WHERE action_id = ? ORDER BY id").all(actionId).map((row) => ({ ...row }));
  assert.deepEqual(rows(), [{ usd: 1, session_key: "made-1", provisional: 1 }, { usd: 1, session_key: "made-2", provisional: 1 }], "each failed turn is charged what it was estimated at, and names its session");
  assert.equal((await w.stopped(() => w.gate.guardTurn(failing)(actionId, ref, "dev", {}, 1))).reason, "over_amount");
  assert.equal(sent, 2, "the third turn was not sent");
  // The usage of the first failed turn arrives: its charge is that amount, the other one keeps its estimate.
  records.set("made-1", [{ runId: "r1", costUsd: 0.25, started_ms: Date.now() }]);
  await w.gate.usageUpdated("made-1");
  assert.deepEqual([rows().map((row) => [row.usd, row.provisional]), w.gate.spentOf(actionId)], [[[0.25, 0], [1, 1]], 1.25]);
});

test("Review 13 #4 — usage is settled PER TURN, not by what the session cost in all: two actions take turns in ONE session, each turn reports its own usage — each action is charged its own turn ($0.045 and $0.03), not $0 and $0.075", async () => {
  const skew = { ms: 0 };
  const h = await createHarness({ now: () => Date.now() + skew.ms, extra: { modelPrice: () => ({ inputPerMillionUsd: 3, outputPerMillionUsd: 15, source: "admin" as const }) } } as never);
  try {
    await billedByKey(h, skew);
    const admin = await h.pair("Studio Mac", "admin"), gate = h.app.generation.gate, ref = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" }, name = "runtime:anthropic/opus";
    const approved = (fixedId: string): string => { const quote = gate.quote({ amountUsd: 1, models: [name], unpriced: [name], plan: fixedId }); let asked: SpendStop | undefined; try { gate.open({ fixedId, kind: "t", owner: "dev", quote }); } catch (error) { asked = error as SpendStop; } return gate.open({ fixedId, kind: "t", owner: "dev", quote, answer: { confirmed: true, ...asked!.confirmWith } }).id; };
    const first = approved("shared:1"), second = approved("shared:2");
    const charges = () => (h.app.db.prepare("SELECT action_id, usd FROM gen_charges WHERE action_id IN (?, ?) ORDER BY id").all(first, second) as { action_id: string; usd: number | null }[]).map((row) => [row.action_id, row.usd]);
    const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string }>;
    const wait = async (done: () => boolean, what: string) => { for (let n = 0; n < 500 && !done(); n++) await tick(10); assert.ok(done(), what); };
    const paid = gate.guardTurn(h.app.workflows.runs.turn);
    const one = paid(first, ref, admin.device.deviceId, { ref, title: "Write", message: "One." });
    await wait(() => sends().length === 1, "the first turn was sent");
    const { sessionKey } = sends()[0];
    h.fake.reply(sessionKey, "Answer one.", { usage: { inputTokens: 15_000, outputTokens: 0 } });
    await one;
    const two = paid(second, ref, admin.device.deviceId, { ref, title: "Write", message: "Two.", sessionKey });
    await wait(() => sends().length === 2, "the second turn was sent");
    assert.equal(sends()[1].sessionKey, sessionKey, "the second action's turn is in the same session");
    h.fake.reply(sessionKey, "Answer two.", { usage: { inputTokens: 10_000, outputTokens: 0 } });
    await two;
    await wait(() => charges().every((row) => row[1] !== null), `both turns' usage settled their charges: ${JSON.stringify(charges())}`);
    assert.deepEqual([charges(), gate.spentOf(first), gate.spentOf(second)], [[[first, 0.045], [second, 0.03]], 0.045, 0.03]);
  } finally { await h.close(); }
});

test("Review 13 #11 — there is no blanket leave for models of unknown price: a run that put its confirmation on record with the models its person named is covered for THOSE; a request to a model of unknown price nobody named is not sent, and the word that used to mean 'any model' means nothing", async () => {
  const w = world();
  w.gate.cover({ fixedId: "run:named", kind: "workflow.run", owner: "run:named", amountUsd: 5, unpriced: ["m2"] });
  w.bills(0.1);
  await w.translate("run:named", null, "m2");
  assert.equal((await w.stopped(() => w.translate("run:named", null, "m3"))).reason, "unpriced_model");
  w.gate.cover({ fixedId: "run:old", kind: "workflow.run", owner: "run:old", amountUsd: 5, unpriced: "caller" as never });
  assert.equal((await w.stopped(() => w.translate("run:old", null, "m3"))).reason, "unpriced_model");
  assert.deepEqual(w.sent, ["translate:m2"]);
});

test("Review 14 #2 — a turn is settled ONLY by its own identified record: two actions take turns in one session, the first turn's $2 becomes known while the second turn runs — the second is charged its own $0.50, not the $2 the session grew by ($2 / $0.50, never $2 / $2); and a record that settles at ZERO is a settled zero (the provisional estimate goes), while a record with no cost yet leaves the estimate in place", async () => {
  const w = world(), ref = { providerId: "acme", modelId: "chat" }, name = "runtime:acme/chat";
  const records: { runId: string; costUsd?: number; started_ms: number }[] = [];
  const total = (): number => records.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  w.gate.bindUsage(async () => total(), async () => records.map((entry) => ({ ...entry })));
  const first = await w.approved("t", w.gate.quote({ amountUsd: 5, models: [], unpriced: [name], plan: "one" })), second = await w.approved("t", w.gate.quote({ amountUsd: 5, models: [], unpriced: [name], plan: "two" }));
  const usd = (actionId: string) => (w.db.prepare("SELECT usd, provisional FROM gen_charges WHERE action_id = ? ORDER BY id").all(actionId) as { usd: number | null; provisional: number | null }[]).map((row) => [row.usd, row.provisional]);
  // The first action's turn answers; Usage has its record, without a cost yet.
  await w.gate.guardTurn(async (_device: string, input: { sessionKey?: string; onTurn?(runId: string): void }) => { input.onTurn?.("r1"); records.push({ runId: "r1", started_ms: Date.now() }); return { text: "one", sessionKey: "s" }; })(first, ref, "dev", { sessionKey: "s" });
  assert.deepEqual(usd(first), [[null, 1]], "not known yet");
  // While the second action's turn runs, the FIRST turn's usage arrives ($2). The second turn's own record has no cost yet.
  await w.gate.guardTurn(async (_device: string, input: { sessionKey?: string; onTurn?(runId: string): void }) => { input.onTurn?.("r2"); records[0].costUsd = 2; records.push({ runId: "r2", started_ms: Date.now() }); return { text: "two", sessionKey: "s" }; })(second, ref, "dev", { sessionKey: "s" });
  assert.deepEqual(usd(second), [[null, 1]], "the session's growth is the OTHER turn's: this one is not known yet");
  records[1].costUsd = 0.5;
  await w.gate.usageUpdated("s");
  assert.deepEqual([usd(first), usd(second), w.gate.spentOf(first), w.gate.spentOf(second)], [[[2, 0]], [[0.5, 0]], 2, 0.5]);
  // A priced turn: charged its estimate until its record says — a record with no cost says nothing; one that says 0 is a settled zero.
  const third = await w.approved("t", w.gate.quote({ amountUsd: 1, models: [name], plan: "three" }));
  await w.gate.guardTurn(async (_device: string, input: { sessionKey?: string; onTurn?(runId: string): void }) => { input.onTurn?.("r3"); records.push({ runId: "r3", started_ms: Date.now() }); return { text: "three", sessionKey: "z" }; })(third, ref, "dev", { sessionKey: "z" }, 1);
  await w.gate.usageUpdated("z");
  assert.deepEqual(usd(third), [[1, 1]], "no cost on the record: the estimate stays");
  records[2].costUsd = 0;
  await w.gate.usageUpdated("z");
  assert.deepEqual([usd(third), w.gate.spentOf(third)], [[[0, 0]], 0], "settled at zero");
});

test("Review 14 #4 — a reservation lives until its request settles, however long that takes: a $1 request still running after an hour keeps its $1 reserved, so a second $1 request on a $1 approval is NOT sent ($1, never $2) — and so does a claim; what is given back without settling is only the CLAIM of a host process that no longer exists (its reservation stays as an unresolved charge)", async () => {
  const db = new DatabaseSync(":memory:"), sent: string[] = [];
  let clock = Date.now();
  const gate = createSpendGate({ db, now: () => clock, thresholdUsd: () => 0 }), other = createSpendGate({ db, now: () => clock, thresholdUsd: () => 0 });
  const quote = gate.quote({ amountUsd: 1, models: ["acme/m1"] }), call: SpendCall = { provider: "acme", model: "m1", estimateUsd: 1, kind: "image" };
  let asked: SpendStop | undefined;
  try { gate.open({ kind: "t", owner: "dev", quote }); } catch (error) { asked = error as SpendStop; }
  const actionId = gate.open({ kind: "t", owner: "dev", quote, answer: { confirmed: true, ...asked!.confirmWith } }).id;
  let finish!: () => void;
  const first = gate.spend(actionId, call, async (token) => { sent.push("first"); await new Promise<void>((resolve) => { finish = resolve; }); token.charge(1); });
  await tick(5);
  assert.equal(gate.claim("job:1"), true);
  clock += 60 * 60_000;
  let second: unknown;
  try { await other.spend(actionId, call, async (token) => { sent.push("second"); token.charge(1); }); } catch (error) { second = error; }
  assert.deepEqual([sent, isSpendStop(second) && second.reason], [["first"], "over_amount"], "the first request is still running: its dollar is still reserved");
  assert.equal(other.claim("job:1"), false, "and what it claimed is still claimed");
  finish(); await first;
  assert.equal(gate.spentOf(actionId), 1);
  // A host process that died in the middle of a request: its reservation and its claim are given back — by that fact, not by a clock.
  const { spawnSync } = await import("node:child_process");
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const next = gate.quote({ amountUsd: 1, models: ["acme/m1"], plan: "two" });
  try { gate.open({ kind: "t", owner: "dev", quote: next }); } catch (error) { asked = error as SpendStop; }
  const later = gate.open({ kind: "t", owner: "dev", quote: next, answer: { confirmed: true, ...asked!.confirmWith } }).id;
  db.prepare("INSERT INTO gen_reservations (action_id, usd, ts_ms, unknown, leaf, holder) VALUES (?, 1, ?, 0, 1, ?)").run(later, clock, String(gone));
  db.prepare("INSERT INTO gen_claims (key, ts_ms, holder) VALUES ('job:2', ?, ?)").run(clock, String(gone));
  // (Review 15 #4: only the CLAIM is given back. The reservation is money that may still be billed: it stays against the approval — see that test.)
  let after: unknown;
  try { await gate.spend(later, call, async (token) => { sent.push("after the dead host"); token.charge(1); }); } catch (error) { after = error; }
  assert.deepEqual([sent.at(-1), isSpendStop(after) && after.reason, gate.claim("job:2")], ["first", "over_amount", true]);
});

test("Review 14 #3 — a turn of a one-prompt-video run (the relay path) keeps its coverage until its usage is known: the turn answers before Usage knows what it cost — the run's action stays charged the turn's bound ($1, provisional, with the turn's session), not $0; the turn is later reported at $2 and THAT is its charge; the next request of the run, under its $1 approval, is not sent", async () => {
  const { createRunMoney } = await import("../src/workflows/templates/prompt-video-money.ts");
  const w = world(), records: { runId: string; costUsd?: number; started_ms: number }[] = [];
  w.gate.bindUsage(async () => 0, async (sessionKey) => (sessionKey === "s1" ? records.map((entry) => ({ ...entry })) : []));
  const service = { gate: w.gate, ledgerRows: () => [] } as never;
  // Usage's total of the session says 0 for now (the turn's usage is not in yet): that is "not known yet", not a price.
  const money = createRunMoney({ db: new DatabaseSync(":memory:"), now: Date.now, generation: () => service, turnCost: async () => 0, turnBound: () => ({ model: "chat", provider: "acme", usd: 1 }) } as never);
  money.cap("r1", 1);
  const asked: string[] = [];
  const turn = money.turn((async (_deviceId: string, input: { message: string; onSession?(key: string): void }) => { asked.push(input.message); input.onSession?.("s1"); (input as { onTurn?(runId: string): void }).onTurn?.(`turn-${asked.length}`); records.push({ runId: `turn-${asked.length}`, started_ms: Date.now() }); return { sessionKey: "s1", text: "ok" }; }) as never);
  await money.inRun("r1", () => turn("d", { title: "t", message: "write the brief" } as never));
  const rows = () => (w.db.prepare("SELECT usd, provisional, session_key FROM gen_charges WHERE action_id = 'run:r1' ORDER BY id").all() as { usd: number | null; provisional: number | null; session_key: string | null }[]).map((row) => [row.usd, row.provisional, row.session_key]);
  assert.deepEqual(rows(), [[1, 1, "s1"]], "charged its bound until Usage says, and it names its session");
  records[0].costUsd = 2;
  await w.gate.usageUpdated("s1");
  assert.deepEqual([rows(), w.gate.spentOf("run:r1")], [[[2, 0, "s1"]], 2]);
  await assert.rejects(Promise.resolve().then(() => money.inRun("r1", () => turn("d", { title: "t", message: "write the script" } as never))));
  assert.deepEqual(asked, ["write the brief"], "the next turn was not sent");
  assert.equal((await w.stopped(() => w.translate("run:r1", 0.01))).reason, "over_amount");
});

test("Review 14 (found on the way, with #6) — a person's yes to a stop about a step of unknown price lets THAT step out: an action whose model of unknown price has used up the approved amount stops and asks ('the price of the next step is not known'); the exact answer to that question sends the step — once — instead of asking the same question for ever; the step after it is asked about again", async () => {
  const w = world(), actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/m1"] }));
  // The model reports $1 for a request nobody could price: the approval is used up.
  await w.translate(actionId, null);
  assert.equal(w.gate.spentOf(actionId), 1);
  const asked = await w.stopped(() => w.translate(actionId, null));
  assert.deepEqual([asked.reason, w.sent.length], ["over_amount", 1]);
  // The person answers THAT question.
  w.gate.open({ fixedId: actionId, kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/m1"] }), answer: { confirmed: true, ...asked.confirmWith } });
  await w.translate(actionId, null);
  assert.deepEqual([w.sent.length, w.gate.spentOf(actionId)], [2, 2], "the step the person said yes to was sent");
  // (Final #2, rule (h)) That yes is for the MODEL in this action — the step after it is not asked about again.
  await w.translate(actionId, null);
  assert.deepEqual([w.sent.length, w.gate.pending(actionId)], [3, undefined], "one yes, the rest of the action on that model");
});

test("Review 15 #3 — a turn is owned by the id its dispatch was given, never by which records became visible: the FIRST turn's record appears in Usage only while the SECOND turn runs — the first is charged its $2 and the second its $0.50 (never $0 / $2.50); a turn whose dispatch gave no id is settled by no record at all (it keeps its bound), and a turn that failed after it was dispatched still carries its id", async () => {
  const w = world(), ref = { providerId: "acme", modelId: "chat" }, name = "runtime:acme/chat";
  const records: { runId: string; costUsd?: number; started_ms: number }[] = [];
  w.gate.bindUsage(async () => records.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0), async () => records.map((entry) => ({ ...entry })));
  const first = await w.approved("t", w.gate.quote({ amountUsd: 5, models: [], unpriced: [name], plan: "one" })), second = await w.approved("t", w.gate.quote({ amountUsd: 5, models: [], unpriced: [name], plan: "two" }));
  const rows = (actionId: string) => (w.db.prepare("SELECT usd, provisional FROM gen_charges WHERE action_id = ? ORDER BY id").all(actionId) as { usd: number | null; provisional: number | null }[]).map((row) => [row.usd, row.provisional]);
  type Sent = { sessionKey?: string; onTurn?(runId: string): void };
  // The first turn is dispatched as r1 and answers; Usage does not have its record yet.
  await w.gate.guardTurn(async (_device: string, input: Sent) => { input.onTurn?.("r1"); return { text: "one", sessionKey: "s" }; })(first, ref, "dev", { sessionKey: "s" });
  // While the second turn (r2) runs, the first turn's record arrives, with its cost; the second's own arrives too.
  await w.gate.guardTurn(async (_device: string, input: Sent) => { input.onTurn?.("r2"); records.push({ runId: "r1", costUsd: 2, started_ms: Date.now() }, { runId: "r2", costUsd: 0.5, started_ms: Date.now() }); return { text: "two", sessionKey: "s" }; })(second, ref, "dev", { sessionKey: "s" });
  await w.gate.usageUpdated("s");
  assert.deepEqual([rows(first), rows(second), w.gate.spentOf(first), w.gate.spentOf(second)], [[[2, 0]], [[0.5, 0]], 2, 0.5]);
  // A dispatch that gave no id: a record that merely appears afterwards is nobody's — the priced turn keeps its $1 bound.
  const third = await w.approved("t", w.gate.quote({ amountUsd: 1, models: [name], plan: "three" }));
  await w.gate.guardTurn(async () => { records.push({ runId: "r3", costUsd: 0, started_ms: Date.now() + 1 }); return { text: "three", sessionKey: "s" }; })(third, ref, "dev", { sessionKey: "s" }, 1);
  await w.gate.usageUpdated("s");
  assert.deepEqual(rows(third), [[1, 1]], "no id, no settlement");
  // A turn that fails after its dispatch: the charge names its turn, and is settled by that record alone.
  const fourth = await w.approved("t", w.gate.quote({ amountUsd: 1, models: [name], plan: "four" }));
  await assert.rejects(w.gate.guardTurn(async (_device: string, input: Sent): Promise<{ text: string }> => { input.onTurn?.("r4"); throw new Error("the stream broke"); })(fourth, ref, "dev", { sessionKey: "s" }, 1));
  assert.deepEqual(rows(fourth), [[1, 1]]);
  records.push({ runId: "r4", costUsd: 0.25, started_ms: Date.now() });
  await w.gate.usageUpdated("s");
  assert.deepEqual([rows(fourth), rows(third)], [[[0.25, 0]], [[1, 1]]]);
});

test("Review 15 #4 — what a dead host left in flight is NOT given back: its request may have reached the provider and be billed after the host died, so its $1 stays against the $1 approval (as an unresolved charge) and the next $1 request is not sent — the action stops and says $1 is spent; it is resolved by the provider's usage of THAT request (a turn: its own record) or by the person's answer, never by the host's death", async () => {
  const w = world(), call: SpendCall = { provider: "acme", model: "m1", estimateUsd: 1, kind: "image" };
  const { spawnSync } = await import("node:child_process");
  const gone = String(spawnSync(process.execPath, ["-e", ""]).pid);
  const actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"] }));
  w.db.prepare("INSERT INTO gen_reservations (action_id, usd, ts_ms, unknown, leaf, holder) VALUES (?, 1, ?, 0, 1, ?)").run(actionId, Date.now(), gone);
  const asked = await w.stopped(() => w.gate.spend(actionId, call, async (token) => { w.sent.push("after the dead host"); token.charge(1); }));
  assert.deepEqual([w.sent, asked.reason, asked.question.spentUsd, w.gate.spentOf(actionId)], [[], "over_amount", 1, 1]);
  assert.deepEqual(w.db.prepare("SELECT usd, provisional, abandoned FROM gen_charges WHERE action_id = ?").all(actionId).map((row) => ({ ...row })), [{ usd: 1, provisional: 1, abandoned: 1 }], "kept, as a charge that is not resolved");
  // The person decides: the answer to the question covers the next request beside the unresolved one.
  w.gate.open({ fixedId: actionId, kind: "t", owner: "dev", quote: w.gate.quote({ amountUsd: 1, models: ["acme/m1"] }), answer: { confirmed: true, ...asked.confirmWith } });
  await w.gate.spend(actionId, call, async (token) => { w.sent.push("answered"); token.charge(1); });
  assert.deepEqual([w.sent, w.gate.spentOf(actionId)], [["answered"], 2]);
  // A TURN the dead host had dispatched: the provider's usage of that very turn resolves it.
  const ref = { providerId: "acme", modelId: "chat" }, name = "runtime:acme/chat", records: { runId: string; costUsd?: number; started_ms: number }[] = [];
  w.gate.bindUsage(async () => 0, async () => records.map((entry) => ({ ...entry })));
  const turns = await w.approved("t", w.gate.quote({ amountUsd: 1, models: [name], plan: "turns" }));
  w.db.prepare("INSERT INTO gen_reservations (action_id, usd, ts_ms, unknown, leaf, holder, provider, model, kind, session_key, turn_ids) VALUES (?, 1, ?, 0, 1, ?, 'acme', 'chat', 'turn', 's', '[\"r9\"]')").run(turns, Date.now(), gone);
  const turn = w.gate.guardTurn(async () => ({ text: "next", sessionKey: "s" }));
  assert.equal((await w.stopped(() => turn(turns, ref, "dev", { sessionKey: "s" }, 1))).reason, "over_amount");
  records.push({ runId: "r9", costUsd: 0, started_ms: Date.now() });
  await w.gate.usageUpdated("s");
  assert.equal(w.gate.spentOf(turns), 0, "the provider says that turn cost nothing");
});

test("Review 15 #5 — the leave a person gives for a step of unknown price is for THAT request: after the answer about `p-a`, a request to `p-b` is not sent on it ($1 approved never becomes $101) — it stops with its own question, which says its amount is not known; `p-a` goes out once on its answer; and a stop about a PRICED request gives no such leave, whatever models the action names", async () => {
  const w = world(), quote = w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/p-a", "acme/p-b"] }), actionId = await w.approved("t", quote);
  await w.translate(actionId, null, "p-a");
  assert.equal(w.gate.spentOf(actionId), 1);
  const asked = await w.stopped(() => w.translate(actionId, null, "p-a"));
  const estimate = asked.details().estimate as { amountUsd: number | null; unpricedModels?: string[] };
  assert.deepEqual([asked.reason, estimate.amountUsd, estimate.unpricedModels], ["over_amount", null, ["acme/p-a"]], "the question says: this step, at a price that is not known");
  w.gate.open({ fixedId: actionId, kind: "t", owner: "dev", quote, answer: { confirmed: true, ...asked.confirmWith } });
  w.bills(100);
  const other = await w.stopped(() => w.translate(actionId, null, "p-b"));
  assert.deepEqual([w.sent, (other.details().estimate as { unpricedModels?: string[] }).unpricedModels, w.gate.spentOf(actionId)], [["translate:p-a"], ["acme/p-b"], 1], "the other model was not sent on p-a's answer");
  // The question that is on record now is p-b's; p-a's leave is still p-a's when that one is answered.
  w.bills(1);
  w.gate.open({ fixedId: actionId, kind: "t", owner: "dev", quote, answer: { confirmed: true, ...other.confirmWith } });
  await w.translate(actionId, null, "p-a");
  assert.deepEqual([w.sent, w.gate.spentOf(actionId)], [["translate:p-a", "translate:p-a"], 2]);
  // A stop about a PRICED request: its answer raises the amount, and is no leave for a step of unknown price.
  const v = world(), q = v.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/p-a"] }), id = await v.approved("t", q);
  await v.translate(id, null, "p-a");
  const priced = await v.stopped(() => v.translate(id, 1, "m1"));
  v.gate.open({ fixedId: id, kind: "t", owner: "dev", quote: q, answer: { confirmed: true, ...priced.confirmWith } });
  await v.translate(id, 1, "m1");
  assert.equal(v.gate.spentOf(id), 2);
  v.bills(100);
  assert.equal((await v.stopped(() => v.translate(id, null, "p-a"))).reason, "over_amount");
  assert.deepEqual([v.sent, v.gate.spentOf(id)], [["translate:p-a", "translate:m1"], 2], "$2 approved stays $2");
});

test("Ruling R9 — a turn on a runtime the person signed in to themselves is not paid work of the action: it is sent without any approval of its model (it is in no quote), nothing is charged for it whatever Usage says such a turn 'cost', and it does not stand against the action's amount; the SAME model on a runtime billed per call through a key of this host is still held — 'price not known', by name", async () => {
  const w = world(), ref = { runtimeId: "codex", providerId: "openai", modelId: "gpt-5" }, keyed = { runtimeId: "acp-opencode", providerId: "openai", modelId: "gpt-5" };
  w.gate.bindBilling((who) => (who.ref?.runtimeId === "codex" || who.role === "on-codex" ? "own_account" : "per_call"));
  const records: { runId: string; costUsd?: number; started_ms: number }[] = [];
  w.gate.bindUsage(async () => 0, async () => records.map((entry) => ({ ...entry })));
  // An action approved for $1 of pictures: its quote names no chat model at all.
  const actionId = await w.approved("t", w.gate.quote({ amountUsd: 1, models: ["acme/m1"] }));
  let sent = 0;
  type Sent = { ref?: typeof ref; role?: string; sessionKey?: string; onTurn?(runId: string): void };
  const turn = async (_device: string, input: Sent) => { sent++; input.onTurn?.(`r${sent}`); records.push({ runId: `r${sent}`, costUsd: 3, started_ms: Date.now() }); return { text: "written", sessionKey: "s" }; };
  assert.equal((await w.gate.guardTurn(turn)(actionId, ref, "dev", { ref, sessionKey: "s" })).text, "written");
  assert.equal((await w.gate.guardTurn(turn)(actionId, { providerId: "role", modelId: "writer" }, "dev", { role: "on-codex", sessionKey: "s" })).text, "written", "a role that resolves to such a runtime, the same");
  await w.gate.usageUpdated("s");
  assert.deepEqual([sent, w.gate.spentOf(actionId), Number((w.db.prepare("SELECT COUNT(*) AS n FROM gen_charges WHERE action_id = ?").get(actionId) as { n: number }).n)], [2, 0, 0], "the '$3' a subscription turn reports is not this app's bill");
  await w.translate(actionId, 1);
  assert.equal(w.gate.spentOf(actionId), 1, "the whole approved dollar is still there for the pictures");
  // Billed per call: the rule as it was.
  assert.equal((await w.stopped(() => w.gate.guardTurn(turn)(actionId, keyed, "dev", { ref: keyed, sessionKey: "s" }))).reason, "unpriced_model");
  assert.equal(sent, 2);
});

test("Review 16 #6 — a reservation becomes its charge in ONE step, under the request's own identity: the host dies right after the provider's $1 bill was recorded — what it leaves in the store is that ONE charge and no reservation of the same request, so the host that takes over counts $1 (not $2) and sends the next $2 request under the $3 approval; and a store that holds BOTH for one request (left by a host of before this rule) still counts it once", async () => {
  const w = world(), call: SpendCall = { provider: "acme", model: "m1", estimateUsd: 1, kind: "image" };
  const { spawnSync } = await import("node:child_process");
  const gone = String(spawnSync(process.execPath, ["-e", ""]).pid);
  const quote = w.gate.quote({ amountUsd: 3, models: ["acme/m1"] }), actionId = await w.approved("t", quote);
  // THE STORE AS A HOST THAT DIES NOW LEAVES IT: every row, copied the moment the bill is on record; what was the dying host's is held by a process that no longer exists.
  const left = new DatabaseSync(":memory:"), after = createSpendGate({ db: left, now: () => Date.now(), thresholdUsd: () => 0 });
  const dies = (): void => {
    for (const table of ["gen_standing", "gen_charges", "gen_reservations", "gen_claims"]) for (const row of w.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
      const values = { ...row, ...("holder" in row ? { holder: gone } : {}) }, names = Object.keys(values);
      left.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...(Object.values(values) as never[]));
    }
  };
  await w.gate.spend(actionId, call, async (token) => { w.sent.push("billed $1"); token.charge(1); dies(); });
  // The host that takes over: the next request ($2) of the same action.
  let stop: unknown;
  try { await after.spend(actionId, { ...call, estimateUsd: 2 }, async (token) => { w.sent.push("next $2"); token.charge(2); }); } catch (error) { stop = error; }
  assert.deepEqual([isSpendStop(stop) ? `asked: spent ${stop.question.spentUsd}, new amount ${stop.question.amountUsd}` : "sent", w.sent, after.spentOf(actionId)], ["sent", ["billed $1", "next $2"], 3], "one $1 bill is $1 spent");
  assert.deepEqual((left.prepare("SELECT usd, abandoned FROM gen_charges WHERE action_id = ? ORDER BY id").all(actionId) as { usd: number; abandoned: number | null }[]).map((row) => [row.usd, row.abandoned ?? 0]), [[1, 0], [2, 0]]);
  // A store of BEFORE this rule: the charge of a request and, still, its reservation (the same request identity), the holder dead. Recovery does not make a second charge of it.
  const old = world(), oldAction = await old.approved("t", quote);
  await old.gate.spend(oldAction, call, async (token) => {
    token.charge(1);
    const request = (old.db.prepare("SELECT request FROM gen_charges WHERE action_id = ?").get(oldAction) as { request: string | null }).request;
    assert.equal(typeof request, "string", "a charge names the request it is the bill of");
    old.db.prepare("INSERT INTO gen_reservations (action_id, usd, ts_ms, unknown, leaf, holder, provider, model, kind, request) VALUES (?, 1, ?, 0, 1, ?, 'acme', 'm1', 'image', ?)").run(oldAction, Date.now(), gone, request);
  });
  await old.gate.spend(oldAction, { ...call, estimateUsd: 2 }, async (token) => { token.charge(2); });
  assert.deepEqual([old.gate.spentOf(oldAction), (old.db.prepare("SELECT COUNT(*) AS n FROM gen_reservations WHERE action_id = ?").get(oldAction) as { n: number }).n], [3, 0]);
});

test("Final #2 — an approval BY NAME of a model of unknown price is for the ACTION, not for one request: an action whose whole quote is 'price not known' (no amount to hold it to) sends every request to the named model on the ONE answer — four pieces, four bills, no second question — while a model nobody named is still not sent; and where the quote did hold an amount, reported spend that passes it still stops the action ONCE — the answer to that stop frees the named model for the rest of the action (no question per request)", async () => {
  const w = world(), all = await w.approved("captions", w.gate.quote({ amountUsd: 0, models: ["acme/m1"], unpriced: ["acme/m1"] }));
  w.bills(0.5);
  for (let piece = 0; piece < 4; piece++) await w.translate(all, null, "m1");
  assert.deepEqual([w.sent.length, w.gate.spentOf(all), w.gate.pending(all)], [4, 2, undefined], "one yes, four requests");
  // Together too: none waits for a question.
  await Promise.all([w.translate(all, null, "m1"), w.translate(all, null, "m1")]);
  assert.equal(w.sent.length, 6);
  assert.equal((await w.stopped(() => w.translate(all, null, "other"))).reason, "unpriced_model", "a model nobody named is not covered");
  // A quote WITH an amount: what the named model reports counts against it, and passing it stops the action — once.
  const mixed = await w.approved("film", w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/dear"] }));
  w.bills(10);
  await w.translate(mixed, null, "dear");
  const stop = await w.stopped(() => w.translate(mixed, null, "dear"));
  assert.deepEqual([stop.reason, stop.question.spentUsd, stop.question.unpriced], ["over_amount", 10, ["acme/dear"]]);
  w.gate.open({ kind: "film", owner: "dev", quote: w.gate.quote({ amountUsd: 1, models: ["acme/m1"], unpriced: ["acme/dear"] }), answer: { confirmed: true, ...stop.confirmWith } });
  const before = w.sent.length;
  for (let piece = 0; piece < 3; piece++) await w.translate(mixed, null, "dear");
  assert.deepEqual([w.sent.length - before, w.gate.pending(mixed)], [3, undefined], "the answer is for the model in this action, not for one request");
});
