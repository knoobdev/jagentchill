// The film screens' money question as data: asked through one connection, answered through the one that is current
// when the person answers. `call` below stands for `useFilm`'s call of a connection; no host is involved.
// Run with `node --test apps/app/src/film/paid.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_WRITER, activityQuestion, answerPending, filmFailure, filmModelName, missingText, pendingAnswer, routeMissing, sendPaid, writingRouted, type FilmCall } from "./paid.ts";

const t = (text: string) => text;
const CONFIRM = { actionId: "film.start:film_1", quoteId: "q-1" };
const refusal = { ok: false as const, code: "PERMISSION_DENIED", message: "Confirm the cost.", details: { reason: "confirmation_required", estimate: { amountUsd: 0.12, breakdown: [{ id: "pictures", count: 8, usd: 0.12, model: "Stub Image" }] }, confirmWith: CONFIRM } };
const connection = (answers: Awaited<ReturnType<FilmCall>>[]) => { const sent: { method: string; params: Record<string, unknown> }[] = []; const call: FilmCall = async (method, params = {}) => { sent.push({ method, params }); return answers.shift() ?? { ok: true, value: {} }; }; return { call, sent }; };

test("A reconnect while the cost dialog is open: Start goes out through the new connection, with the question's ids", async () => {
  const old = connection([refusal]), params = { mode: "auto", model: null };
  const asked = await sendPaid(old.call, t, "film", "pipeline.start", params);
  assert.deepEqual(asked.outcome, { ok: true }, "the question is not shown as an error");
  assert.ok(asked.pending);
  assert.deepEqual(Object.keys(asked.pending!).sort(), ["ask", "kind", "method", "params"], "what waits is data: no function bound to the connection that asked");
  // The connection is replaced; the person presses Start.
  const next = connection([]);
  const started = await answerPending(next.call, t, asked.pending!);
  assert.deepEqual(started, { outcome: { ok: true }, pending: null });
  assert.equal(old.sent.length, 1, "nothing more is sent through the closed connection");
  assert.deepEqual(next.sent, [{ method: "pipeline.start", params: { mode: "auto", model: null, confirmedUsd: 0.12, actionId: "film.start:film_1", quoteId: "q-1", confirmed: true } }]);
});

test("The answer of a generation carries the ids and no amount; a question asked again waits again", async () => {
  const first = connection([{ ...refusal, details: { ...refusal.details, confirmWith: { actionId: "film.generate:abc", quoteId: "q-2" } } }]);
  const asked = await sendPaid(first.call, t, "pictures", "generate", { target: { kind: "panels", scope: "missing" } });
  assert.deepEqual(pendingAnswer(asked.pending!), { actionId: "film.generate:abc", quoteId: "q-2", confirmed: true });
  // The host asks again with a new quote (the film changed meanwhile): the new question waits, with ITS ids.
  const again = connection([{ ...refusal, details: { ...refusal.details, confirmWith: { actionId: "film.generate:abc", quoteId: "q-3" } } }]);
  const second = await answerPending(again.call, t, asked.pending!);
  assert.deepEqual(second.pending?.ask.confirmWith, { actionId: "film.generate:abc", quoteId: "q-3" });
  // Any other refusal is a failure, said as one.
  const failed = await sendPaid(connection([{ ok: false, code: "NO_ROUTE", message: "No provider." }]).call, t, "music", "generate", {});
  assert.deepEqual(failed, { outcome: { ok: false, code: "NO_ROUTE", message: "No provider." }, pending: null });
});

test("A model is called by the name a person knows, never by the host's `runtime:` form", () => {
  const writing = [{ model: { providerId: "stub", modelId: "stub-chat", label: "Stub Chat" } }, { model: null }];
  assert.equal(filmModelName("runtime:stub/stub-chat", writing), "Stub Chat");
  assert.equal(filmModelName("stub-chat", writing), "Stub Chat");
  assert.equal(filmModelName("openrouter/google/gemini-image", [], (id) => (id === "google/gemini-image" ? "Gemini Image" : id)), "Gemini Image");
  assert.equal(filmModelName("runtime:acme/unknown-model", []), "unknown-model");
});

test("A script larger than the confirmed film is said in a sentence with a way forward — never as its code or the host's inner words", () => {
  const t = ((text: string) => text) as never;
  const said = filmFailure(t, { code: "PLAN_EXCEEDED", message: "The script the model wrote is larger than this film's plan (at most 13 panels…)" }, "The film stopped.");
  assert.match(said, /Try again — or shorten the story, or split it into parts\.$/);
  assert.doesNotMatch(said, /PLAN_EXCEEDED|plan \(|panels/);
  assert.equal(filmFailure(t, { code: "UNAVAILABLE", message: "The provider failed." }, "x"), "The provider failed.");
  assert.equal(filmFailure(t, undefined, "The film stopped."), "The film stopped.");
});


test("Who writes a film is decided only in Model routing: the Storyboard role's model, else the Director's — and with neither the screen says so instead of sending a model of its own", async () => {
  const model = { runtimeId: "builtin", providerId: "stub", modelId: "stub-chat", label: "stub-chat" };
  assert.equal(writingRouted([{ role: "screenwriter", model: null }, { role: "storyboard", model }], { enabled: true, state: "not_configured" }), true);
  assert.equal(writingRouted([{ role: "storyboard", model: null }], { enabled: true, state: "ready" }), true, "the Director writes when the Storyboard role has no model");
  assert.equal(writingRouted([{ role: "storyboard", model: null }], { enabled: true, state: "not_configured" }), false);
  assert.equal(writingRouted([{ role: "storyboard", model: null }], { enabled: false, state: "ready" }), false, "routing is switched off: no role gives a model");
  assert.equal(writingRouted([{ role: "storyboard", model: null, problem: "the role is turned off" }], { enabled: true, state: "ready" }), false, "a role that is set but cannot serve is not passed over");
  assert.equal(writingRouted(undefined, null), null);
  assert.equal(writingRouted([{ role: "storyboard", model: null }], null), null, "not known yet: nothing is held back on a guess");
  // "Make the film" names no model: the request is the mode alone.
  const host = connection([{ ok: true, value: {} }]);
  await sendPaid(host.call, t, "film", "pipeline.start", { mode: "auto" });
  assert.deepEqual(host.sent, [{ method: "pipeline.start", params: { mode: "auto" } }]);
  // The host's "Choose a model" never reaches a person: no film screen has a model to choose.
  assert.equal(filmFailure(t, { code: "NO_ROUTE", message: "Choose a model", details: { role: "director", reason: "no-model-chosen" } }, "x"), NO_WRITER(t));
  assert.equal(NO_WRITER(t), "No model is set to write this film's script. Choose one in Settings ▸ Model routing.");
});

test("“Make the film” with nothing connected that makes pictures or voices is one sentence naming what is missing — not a money question, not a code", async () => {
  const refused = { ok: false as const, code: "NO_ROUTE", message: "This film cannot be made yet: nothing on this host makes pictures or speech. Connect a provider under Settings, Providers, Generation, and give the Image, Voice roles a model under Settings, Model routing. Nothing was asked and nothing was spent.", details: { reason: "route_missing", missing: [{ capability: "image", role: "Image", what: "pictures" }, { capability: "tts", role: "Voice", what: "speech" }], filmId: "film_1" } };
  const host = connection([refused]), sent = await sendPaid(host.call, (text, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? "")), "film", "pipeline.start", { mode: "auto" });
  assert.equal(sent.pending, null);
  assert.deepEqual(sent.outcome.ok ? null : [sent.outcome.code, routeMissing(sent.outcome)], ["NO_ROUTE", ["image", "tts"]]);
  assert.equal(sent.outcome.ok ? "" : sent.outcome.message, "This film cannot be made yet — nothing connected here makes: pictures, voice. Connect it in Settings ▸ Providers ▸ Generation. Nothing was spent.");
  assert.equal(routeMissing({ code: "NO_ROUTE", details: { reason: "no-model-chosen" } }), null);
  assert.equal(missingText(t, ["music"]).includes("{what}"), true);
});

test("A step that stopped at a money question after its request was accepted is asked about once, and Start sends the same request with what the host named", async () => {
  const details = { reason: "confirmation_required", spentUsd: 0.0005, confirmedUsd: 0.0005, estimate: { amountUsd: 0.001 }, confirmWith: { actionId: "film.generate:film_1:line", quoteId: "q-9" } };
  const activity = { "line:l1": { state: "failed", code: "PERMISSION_DENIED", message: "Confirm the new amount to go on.", details }, "panel:p1": { state: "running" } };
  const request = { kind: "voice" as const, params: { target: { kind: "line", id: "l1" } } }, seen = new Set<string>();
  const found = activityQuestion(t, activity, request, seen)!;
  assert.deepEqual([found.method, found.params, found.ask.confirmWith, found.ask.again?.spentUsd, found.ask.amountUsd], ["generate", request.params, details.confirmWith, 0.0005, 0.001]);
  assert.equal(activityQuestion(t, activity, request, seen), null, "the same question is not put twice");
  const host = connection([{ ok: true, value: {} }]);
  await answerPending(host.call, t, found);
  assert.deepEqual(host.sent, [{ method: "generate", params: { target: { kind: "line", id: "l1" }, actionId: "film.generate:film_1:line", quoteId: "q-9", confirmed: true } }]);
  // A failure that is not a question, and a question that was already there before this device asked for anything, open nothing.
  assert.equal(activityQuestion(t, { "line:l2": { state: "failed", code: "UNAVAILABLE", message: "no" } }, request, new Set()), null);
  const before = new Set<string>();
  assert.equal(activityQuestion(t, activity, null, before), null);
  assert.equal(activityQuestion(t, activity, request, before), null);
});
