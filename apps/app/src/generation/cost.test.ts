// The money question without its screen: what the host's refusal is read into, and the answer that goes back. Pure
// functions of `cost.ts` (the cost dialog and every caller use exactly these); no host is involved.
// Run with `node --test apps/app/src/generation/cost.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOf, answerTo, asAgain, costAnswer, costAskOf, ownLine } from "./cost.ts";

const t = (text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const CONFIRM = { actionId: "film.start:film_1", quoteId: "q-7f3a" };

test("The answer to a money question carries the question's own ids back unchanged", () => {
  const ask = costAskOf(t, { reason: "confirmation_required", estimate: { amountUsd: 0.04 }, confirmWith: CONFIRM, confirmAboveUsd: 0, remainingUsd: 3 }, "pictures")!;
  assert.deepEqual(ask.confirmWith, CONFIRM);
  assert.deepEqual(costAnswer(ask), { actionId: "film.start:film_1", quoteId: "q-7f3a", confirmed: true });
  // Nothing a screen adds beside it may replace a field the host named.
  assert.deepEqual(answerTo(CONFIRM, { confirmedUsd: 0.12, quoteId: "mine", actionId: "mine" }), { confirmedUsd: 0.12, actionId: "film.start:film_1", quoteId: "q-7f3a", confirmed: true });
  // A host that named nothing gets the plain confirmation.
  assert.deepEqual(answerTo(undefined), { confirmed: true });
});

test("Work whose price is not known is named part by part, and the amount is said to be the rest only", () => {
  const details = {
    reason: "confirmation_required", scripted: false, stopsAtUsd: 0.144, confirmWith: CONFIRM,
    estimate: { amountUsd: 0.12, unpriced: true, unpricedModels: ["runtime:stub/stub-chat"], breakdown: [{ id: "pictures", label: "Pictures", count: 8, usd: 0.08, model: "Stub Image" }, { id: "music", label: "Music", count: 1, usd: 0.04, model: "Stub Music" }], unpricedParts: [{ id: "writing", label: "Writing the script", model: "stub-chat" }, { id: "vision", label: "Checking the pictures", model: "stub-vision" }] },
  };
  const ask = costAskOf(t, details, "film", (id) => (id === "stub-chat" ? "Stub Chat" : id))!;
  assert.equal(ask.amountUsd, 0.12);
  assert.deepEqual(ask.unknown, [{ id: "writing", label: "Writing the script", model: "Stub Chat" }, { id: "vision", label: "Checking the pictures by looking at them", model: "stub-vision" }]);
  assert.deepEqual(ask.rows.map((row) => [row.id, row.count, row.usd]), [["pictures", 8, 0.08], ["music", 1, 0.04]]);
  assert.equal(ask.upper, true, "a story-only film is quoted by the most its story may need, and the dialog says so");
  assert.equal(ask.stopsAtUsd, 0.144);
  // Nothing to draw, record or compose is left: the cost is not known at all — never "about $0".
  const only = costAskOf(t, { reason: "confirmation_required", estimate: { amountUsd: 0, breakdown: [], unpricedParts: [{ id: "writing", label: "Writing the script", model: "stub-chat" }] } }, "film")!;
  assert.deepEqual([only.amountUsd, only.rows.length, only.unknown.length], [null, 0, 1]);
});

test("The stop of a run that passed its confirmed amount is not the first question", () => {
  assert.equal(costAskOf(t, { reason: "confirmation_required", scope: "confirmed_estimate", estimate: { amountUsd: 1 } }, "film"), null);
  assert.equal(costAskOf(t, { reason: "bad_answer" }, "translation"), null);
});

test("A question that comes after an answer is the second question, also when the host names no figures of what was spent", () => {
  const t = ((text: string) => text) as never;
  // The refusal for a fallback model of unknown price, after the first model failed without costing anything: no `spentUsd`.
  const refusal = { reason: "confirmation_required", estimate: { amountUsd: null, model: "stub-chat", via: "runtime" }, confirmWith: { actionId: "a", quoteId: "q2" } };
  const first = costAskOf(t, refusal, "translation")!;
  assert.equal(first.again, undefined);
  const second = asAgain(first);
  assert.deepEqual(second.again, { spentUsd: 0, confirmedUsd: null, remainsUsd: null });
  assert.deepEqual(second.confirmWith, { actionId: "a", quoteId: "q2" });
  // One that already says what was spent keeps its figures.
  const told = costAskOf(t, { ...refusal, spentUsd: 0.02, estimate: { amountUsd: 0.05, spentUsd: 0.02 } }, "translation")!;
  assert.equal(asAgain(told), told);
});

test("Writing and checking turns the host has a price for are rows of the question, with the model by its name", () => {
  const t = ((text: string) => text) as never;
  const ask = costAskOf(t, { reason: "confirmation_required", estimate: { amountUsd: 0.2, breakdown: [{ id: "pictures", count: 3, usd: 0.1, model: "Painter" }, { id: "writing", label: "Writing the script", count: 2, usd: 0.06, model: "runtime:acme/large" }, { id: "vision", label: "Checking the pictures", count: 3, usd: 0.04, model: "acme/eye" }], unpricedParts: [] }, confirmWith: { actionId: "a", quoteId: "q" } }, "film", (id) => ({ "runtime:acme/large": "Acme Large", "acme/eye": "Acme Eye" })[id] ?? id)!;
  assert.deepEqual(ask.rows.map((row) => [row.id, row.label, row.usd, row.model]), [["pictures", "{n} pictures", 0.1, "Painter"], ["writing", "Writing the script", 0.06, "Acme Large"], ["vision", "Checking the pictures by looking at them", 0.04, "Acme Eye"]]);
  assert.equal(ask.amountUsd, 0.2);
  assert.deepEqual(ask.unknown, []);
});

test("A film quoted before its script exists says the maximum video clip duration, and an exact plan keeps its counts", () => {
  const t = ((text: string) => text) as never;
  const details = { reason: "confirmation_required", scripted: false, upperPlan: { assets: 36, panels: 13, lines: 13 }, estimate: { amountUsd: 0.45, breakdown: [{ id: "pictures", count: 49, usd: 0.4, model: "Painter" }, { id: "video", count: 5, usd: 0.31, model: "Video", maxClipSeconds: 10 }, { id: "voice", count: 13, usd: 0.01, model: "Voice" }, { id: "listening", count: 13, usd: 0.02, model: "Ear" }, { id: "music", count: 1, usd: 0.02, model: "Band" }] }, confirmWith: { actionId: "a", quoteId: "q" } };
  const upper = costAskOf(t, details, "film")!;
  assert.equal(upper.upper, true);
  assert.deepEqual(upper.rows.map((row) => row.label), ["Up to {n} pictures", "Up to {n} clips of up to {seconds} s", "Up to {n} voice lines", "Checking up to {n} recordings by listening to them", "Music"]);
  const translate = ((text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ""))) as never;
  assert.equal(costAskOf(translate, details, "film")?.rows[1]?.label, "Up to 5 clips of up to 10 s");
  const exact = costAskOf(t, { ...details, scripted: true, upperPlan: undefined }, "film")!;
  assert.equal(exact.upper, undefined);
  assert.deepEqual(exact.rows.map((row) => row.label), ["{n} pictures", "{n} video clips", "{n} voice lines", "Checking {n} recordings by listening to them", "Music"]);
});


test("Ruling R9 — work on the person's own signed-in account is no row and no “price not known”: it is one quiet line that names the account", () => {
  const t = ((text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""))) as never;
  const details = { reason: "confirmation_required", stopsAtUsd: 0.63, estimate: { amountUsd: 0.52, amountKind: "total", breakdown: [{ id: "pictures", count: 49, usd: 0.4, model: "Painter" }, { id: "music", count: 1, usd: 0.12, model: "Band" }], ownAccount: [{ label: "Writing the script", model: "claude-sonnet-4-5" }] }, confirmWith: { actionId: "a", quoteId: "q" } };
  const ask = costAskOf(t, details, "film")!;
  assert.deepEqual([ask.own, ask.unknown, ask.subtotal, ask.rows.map((row) => row.id), ask.amountUsd], [[{ what: "writing", model: "claude-sonnet-4-5" }], [], undefined, ["pictures", "music"], 0.52]);
  const groups = [{ kind: "cli", label: "Claude Code", providers: [{ models: [{ ref: { modelId: "claude-sonnet-4-5" } }] }] }, { kind: "cli", label: "Codex", providers: [{ models: [{ ref: { modelId: "gpt-5" } }] }] }];
  assert.equal(accountOf(groups, ask.own!), "Claude Code");
  assert.equal(ownLine(t, ask.own!, accountOf(groups, ask.own!)), "Writing runs on your Claude Code account — not billed by this app.");
  // An account the screen cannot name is never guessed: the line says "your own account".
  assert.equal(ownLine(t, ask.own!, accountOf(null, ask.own!)), "Writing runs on your own account — not billed by this app.");
  const both = costAskOf(t, { ...details, estimate: { ...details.estimate, ownAccount: [{ label: "Writing the story", model: "gpt-5" }, { label: "Checking the pictures", model: "gpt-5" }] } }, "film")!;
  assert.equal(ownLine(t, both.own!, accountOf(groups, both.own!)), "Writing and checking the pictures run on your Codex account — not billed by this app.");
  assert.equal(ownLine(t, costAskOf(t, { reason: "confirmation_required", estimate: { amountUsd: 0, ownAccount: [{ label: "Translation", model: "gpt-5" }] } }, "translation")!.own!, ""), "Translation runs on your own account — not billed by this app.");
});

test("The total's label follows what the host says the amount is (`amountKind`), and a model it still lists without a price is a row by its name", () => {
  const t = ((text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""))) as never;
  const base = { amountUsd: 0.5, breakdown: [{ id: "pictures", count: 3, usd: 0.5, model: "Painter" }] };
  assert.equal(costAskOf(t, { reason: "confirmation_required", estimate: { ...base, amountKind: "total" } }, "film")!.subtotal, undefined);
  const part = costAskOf(t, { reason: "confirmation_required", estimate: { ...base, amountKind: "subtotal_of_priced", unpricedParts: [{ id: "writing", label: "Writing the script", model: "acme-small" }], unpricedModels: ["runtime:acme/acme-small", "runtime:acme/acme-eye"] } }, "film", (id) => id.replace(/^runtime:acme\//, "Acme "))!;
  assert.equal(part.subtotal, true);
  // The writing model is named once (its part says what it does); the other one the host lists gets its own row.
  assert.deepEqual(part.unknown, [{ id: "writing", label: "Writing the script", model: "acme-small" }, { id: "model-1", label: "Work done by Acme acme-eye", model: "" }]);
});

test("A model is said to have no price ONCE, and a role's id is never shown as a model's name", async () => {
  const { filmModelName } = await import("../film/paid.ts");
  const names = (id: string) => filmModelName(id, [], (model) => ({ "google/tts": "Gemini TTS", "qwen/asr": "Qwen ASR" })[model] ?? model);
  // What a host sends for a story-only film whose voice and read-back models are priced by length, written by the Director (no writing role has a model).
  const ask = costAskOf(t as never, { reason: "confirmation_required", upperPlan: { panels: 9 }, stopsAtUsd: 0.42, estimate: {
    amountUsd: 0.35, amountKind: "subtotal_of_priced",
    breakdown: [{ id: "pictures", count: 42, usd: 0.31, model: "Painter" }, { id: "voice", count: 9, usd: null, model: "Gemini TTS" }, { id: "listening", count: 9, usd: null, model: "Qwen ASR" }, { id: "music", count: 1, usd: 0.04, model: "Lyria" }],
    unpricedParts: [{ id: "writing", label: "Writing the script", model: "director" }],
    unpricedModels: ["openrouter/google/tts", "openrouter/qwen/asr", "runtime:role/director"],
  } }, "film", names)!;
  // The voice and the listening rows already say "Price not known": no "Work done by Gemini TTS" row repeats them.
  assert.deepEqual(ask.unknown, [{ id: "writing", label: "Writing the script", model: "" }]);
  assert.equal(JSON.stringify(ask).includes("director"), false);
  // When the screen knows which model Model routing gives the Director, that model is named.
  assert.equal(filmModelName("director", [], (model) => (model === "acme-small" ? "Acme Small" : model), "acme-small"), "Acme Small");
});
