// TEST DOUBLE: the generation service is an object of this file (a price per request, a ledger it writes when a job
// settles) — the real one cannot hold two requests in the air at a chosen moment. The money module under test is real.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { GenerationService } from "../src/generation/service.ts";
import { createRunMoney } from "../src/workflows/templates/prompt-video-money.ts";

function world(options: { turnCost?: (sessionKey: string) => Promise<number | null>; /** The most the next turn can cost, as the host would compute it from the request and the model (null: not known). */ turnBound?: () => { model: string; usd: number | null } } = {}) {
  const ledger: { session_id: string; actual_usd: number }[] = [], sent: string[] = [], waiting = new Map<string, () => void>();
  let next = 0;
  const service = {
    ledgerRows: () => ledger,
    prepare: (input: { params: { usd: number | null } }) => ({ estimate: { amountUsd: input.params.usd }, model: { label: "picture-model" } }),
    create: (input: { sessionId: string; params: { usd: number | null; billed?: number } }) => { const jobId = `job-${++next}`; sent.push(jobId); waiting.set(jobId, () => ledger.push({ session_id: input.sessionId, actual_usd: input.params.billed ?? input.params.usd ?? 0 })); return { jobId }; },
    settled: async (jobId: string) => { await new Promise<void>((resolve) => setTimeout(resolve, 20)); waiting.get(jobId)!(); return { jobId, state: "succeeded" }; },
    listener: () => ({ estimateUsd: 0.002 }),
    transcribe: async (_input: unknown, _signal: unknown, scope: { sessionId: string }) => { sent.push("listen"); ledger.push({ session_id: scope.sessionId, actual_usd: 0.002 }); return { text: "heard", costUsd: 0.002 }; },
  } as unknown as GenerationService;
  const money = createRunMoney({ db: new DatabaseSync(":memory:"), now: Date.now, generation: () => service, ...(options.turnCost ? { turnCost: options.turnCost } : {}), ...(options.turnBound ? { turnBound: options.turnBound } : {}) });
  return { money, ledger, sent, generation: money.generation()! };
}
const job = (generation: GenerationService, usd: number, billed = usd) => generation.settled(generation.create({ capability: "image", sessionId: "run:r1", params: { usd, billed } } as never, { deviceId: "d", by: "agent", sessionId: "run:r1" }).jobId);
const code = (work: () => unknown): string | undefined => { try { work(); return undefined; } catch (error) { return `${(error as { code?: string }).code}:${(error as { details?: { reason?: string } }).details?.reason}`; } };

test("Parallel spend: requests that are in the air together are counted together — the one that would take the run past 120 % of the confirmed amount is not sent, and is sent once the others have cost less than they reserved", async () => {
  const { money, sent, generation } = world();
  // Nothing confirmed: nothing is sent.
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: 0.01 } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:confirmation_required");
  assert.equal(sent.length, 0);
  money.confirm("r1", 0.02); // stops at 0.024
  const first = job(generation, 0.01, 0.004), second = job(generation, 0.01, 0.004);
  // Two are under way (0.02 reserved): a third of 0.01 would make 0.03.
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: 0.01 } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:confirmation_required");
  assert.equal(sent.length, 2, "the third request was not sent");
  await Promise.all([first, second]);
  // They cost 0.008 together: now a third fits (0.018).
  await job(generation, 0.01);
  assert.equal(money.spentOf("r1"), 0.018);
  // A run of another id, and a request that is no run's, are not this run's business.
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "device:d", params: { usd: 9 } } as never, { deviceId: "d", by: "user" })), undefined);
});

test("The read-back and the session turns are paid requests of the run: a recording is not listened to and a turn is not sent by a run that is past its stop, and what a turn cost counts against the confirmed amount", async () => {
  const costs = new Map<string, number>();
  // Every turn of this test can cost 0.008 at most (its request and the model's longest answer), and costs exactly that.
  const { money, sent, generation } = world({ turnCost: async (sessionKey) => costs.get(sessionKey) ?? null, turnBound: () => ({ model: "opus", usd: 0.008 }) });
  money.confirm("r1", 0.01); // stops at 0.012
  const asked: string[] = [];
  const turn = money.turn(async (_deviceId, input) => { asked.push(String(input.message)); costs.set("s1", (costs.get("s1") ?? 0) + 0.008); return { sessionKey: "s1", text: "ok" }; });
  // Outside a step of the run a turn is nobody's: it is passed on untouched.
  await turn("d", { title: "t", message: "elsewhere" });
  assert.equal(money.spentOf("r1"), 0);
  costs.clear();
  await money.inRun("r1", () => turn("d", { title: "t", message: "write the brief" }));
  assert.equal(money.spentOf("r1"), 0.008, "the turn's cost is the run's");
  // 0.008 spent of 0.012: listening (0.002) still fits, a picture of 0.005 does not.
  await generation.transcribe({ bytes: new Uint8Array(1), format: "wav", seconds: 2 }, undefined, { sessionId: "run:r1" });
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: 0.005 } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:confirmation_required");
  // A second turn would take the run past its stop: a turn is reserved at the most it can cost (0.008;
  // 0.010 + 0.008 > 0.012), so it is refused BEFORE it is sent — the model is not asked.
  await assert.rejects(money.inRun("r1", () => turn("d", { title: "t", message: "write the script" })), { code: "BUDGET_EXCEEDED" });
  assert.deepEqual([asked, money.spentOf("r1")], [["elsewhere", "write the brief"], 0.01], "nothing was dispatched, nothing was spent");
  // A translation is asked the same way before each of its calls, with that call's estimate: one that does not fit is not sent.
  const payer = { reserve: (estimateUsd: number | null) => money.reserve("r1", estimateUsd ?? 0, true) };
  assert.equal(code(() => payer.reserve(0.003)), "BUDGET_EXCEEDED:confirmation_required");
  payer.reserve(0.001)();
  // Confirmed for more: the turn is sent, and while it is in the air its share is held — a request beside it does not get the same room.
  money.confirm("r1", 0.02); // stops at 0.024
  let during: string | undefined;
  const slow = money.turn(async (_deviceId, input) => { asked.push(String(input.message)); during = code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: 0.007 } } as never, { deviceId: "d", by: "agent" })); costs.set("s2", 0.008); return { sessionKey: "s2", text: "ok" }; });
  await money.inRun("r1", () => slow("d", { title: "t", message: "write the script" }));
  assert.deepEqual([during, money.spentOf("r1")], ["BUDGET_EXCEEDED:confirmation_required", 0.018]);
  await assert.rejects(money.inRun("r1", () => turn("d", { title: "t", message: "write the shots" })), { code: "BUDGET_EXCEEDED" });
  money.confirm("r1", 0.0151); // stops at 0.01812: the run is at 0.018 — a read-back of 0.002 does not fit
  await assert.rejects(generation.transcribe({ bytes: new Uint8Array(1), format: "wav", seconds: 2 }, undefined, { sessionId: "run:r1" }), { code: "BUDGET_EXCEEDED" });
  assert.deepEqual([asked, sent], [["elsewhere", "write the brief", "write the script"], ["listen"]]);
  // An automation's limit is the limit itself (no 120 %), and the refusal says whose it is.
  money.cap("r2", 0.01);
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r2", params: { usd: 0.011 } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:cost_limit");
});

// — w2 run 4, item 1: the FIRST turn is reserved like every other — at the most its own request can cost —
test("Before dispatching a costed node the engine reserves its estimate: the run's FIRST turn is reserved at the most its request can cost — its tokens and the model's longest answer, at the model's price — and one that would pass the stop is not sent; turns in the air together are counted together", async () => {
  const costs = new Map<string, number>(), asked: string[] = [];
  let bound: number | null = 0.05, key = 0;
  const { money } = world({ turnCost: async (sessionKey) => costs.get(sessionKey) ?? null, turnBound: () => ({ model: "opus", usd: bound }) });
  // A model that bills what it may: every turn costs its whole bound.
  const turn = money.turn(async (_deviceId, input) => { const sessionKey = `s${++key}`, costUsd = bound!; asked.push(String(input.message)); await new Promise<void>((resolve) => setTimeout(resolve, 15)); costs.set(sessionKey, costUsd); return { sessionKey, text: "ok" }; });
  money.confirm("r1", 0.01); // stops at 0.012
  // The first turn of the run could cost $0.05: nothing of it is sent, nothing is spent.
  const refused = await money.inRun("r1", () => turn("d", { title: "t", message: "write the brief" })).then(() => null, (error: { code?: string; details?: Record<string, unknown> }) => error);
  assert.deepEqual([refused?.code, refused?.details?.reason, refused?.details?.confirmedUsd, asked, money.spentOf("r1")], ["BUDGET_EXCEEDED", "confirmation_required", 0.01, [], 0]);
  assert.ok(Number((refused!.details!.estimate as { amountUsd: number }).amountUsd) >= 0.05, "the figure asked covers the turn that was not sent");
  // Two turns of 0.005 at the same moment: 0.010 would fit one by one, together they would pass 0.012 — only one is sent.
  bound = 0.007;
  const together = await Promise.allSettled([money.inRun("r1", () => turn("d", { title: "t", message: "one" })), money.inRun("r1", () => turn("d", { title: "t", message: "two" }))]);
  assert.deepEqual([together.map((entry) => entry.status), asked, money.spentOf("r1")], [["fulfilled", "rejected"], ["one"], 0.007]);
  assert.ok(money.spentOf("r1") <= 0.012, "what was spent never passed the stop");
});

// — w2 run 4, item 2: "price not known" is not zero —
test("A model whose price is not known is refused with BUDGET_EXCEEDED, reason unpriced_model, before anything is sent — a turn, a picture — unless the PERSON allowed that model by name on the run's money question, or the automation that started the run says so explicitly", async () => {
  const asked: string[] = [];
  const { money, sent, generation } = world({ turnCost: async () => null, turnBound: () => ({ model: "local-llm", usd: null }) });
  const turn = money.turn(async (_deviceId, input) => { asked.push(String(input.message)); return { sessionKey: "s1", text: "ok" }; });
  const refusal = (work: () => Promise<unknown>) => work().then(() => undefined, (error: { code?: string; details?: { reason?: string; modelId?: string; scope?: string } }) => `${error.code}:${error.details?.reason}:${error.details?.modelId}:${error.details?.scope}`);
  money.confirm("r1", 5);
  // Ample money confirmed — and still nothing goes to a model nobody said yes to.
  assert.equal(await refusal(() => money.inRun("r1", () => turn("d", { title: "t", message: "write the brief" }))), "BUDGET_EXCEEDED:unpriced_model:local-llm:confirmed_estimate");
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: null } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:unpriced_model");
  assert.deepEqual([asked, sent], [[], []]);
  // The person was told its name and said yes: that model, and no other.
  money.confirm("r1", 5, ["local-llm"]);
  await money.inRun("r1", () => turn("d", { title: "t", message: "write the brief" }));
  assert.equal(code(() => generation.create({ capability: "image", sessionId: "run:r1", params: { usd: null } } as never, { deviceId: "d", by: "agent" })), "BUDGET_EXCEEDED:unpriced_model");
  assert.deepEqual([asked, sent, money.unpricedOf("r1")], [["write the brief"], [], ["local-llm"]]);
  // A run nobody follows: its automation's limit alone does not allow it; the automation's explicit setting does.
  money.cap("r2", 5);
  assert.equal(await refusal(() => money.inRun("r2", () => turn("d", { title: "t", message: "unattended" }))), "BUDGET_EXCEEDED:unpriced_model:local-llm:run_cost_limit");
  money.cap("r3", 5, true);
  await money.inRun("r3", () => turn("d", { title: "t", message: "allowed by its automation" }));
  await generation.settled(generation.create({ capability: "image", sessionId: "run:r3", params: { usd: null } } as never, { deviceId: "d", by: "agent" }).jobId);
  assert.deepEqual([asked, sent.length], [["write the brief", "allowed by its automation"], 1]);
});

test("Delayed Usage (run 5 #3): a turn that was sent keeps its reservation until Usage says what it cost — two turns of $0.05 against a stop at $0.06: the second is NOT sent while the first one's bill has not arrived, and still not once it has (it is on the run's account then)", async () => {
  const costs = new Map<string, number>();
  const { money } = world({ turnCost: async (sessionKey) => costs.get(sessionKey) ?? 0, turnBound: () => ({ model: "opus", usd: 0.05 }) });
  money.confirm("r1", 0.05); // stops at 0.06
  const asked: string[] = [];
  // Usage learns what the turn cost only 120 ms after it ended.
  const turn = money.turn(async (_deviceId, input) => { asked.push(String(input.message)); setTimeout(() => costs.set("s1", (costs.get("s1") ?? 0) + 0.05), 120); return { sessionKey: "s1", text: "ok" }; });
  await money.inRun("r1", () => turn("d", { title: "t", message: "first" }));
  assert.equal(money.spentOf("r1"), 0, "Usage has said nothing yet");
  let refused: string | undefined;
  try { await money.inRun("r1", () => turn("d", { title: "t", message: "second" })); } catch (error) { refused = `${(error as { code?: string }).code}:${(error as { details?: { reason?: string } }).details?.reason}`; }
  assert.deepEqual([refused, asked], ["BUDGET_EXCEEDED:confirmation_required", ["first"]], "the second turn was not sent while the first is unsettled");
  // The bill arrives: it is the run's spend now, and the reservation is given back — never both, never neither.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(money.spentOf("r1"), 0.05);
  refused = undefined;
  try { await money.inRun("r1", () => turn("d", { title: "t", message: "third" })); } catch (error) { refused = (error as { code?: string }).code; }
  assert.deepEqual([refused, asked], ["BUDGET_EXCEEDED", ["first"]]);
  // With room confirmed, a turn goes out again: the settled turn holds nothing any more (0.05 spent + 0.05 ≤ 0.12).
  money.confirm("r1", 0.1);
  await money.inRun("r1", () => turn("d", { title: "t", message: "fourth" }));
  assert.deepEqual(asked, ["first", "fourth"]);
});
