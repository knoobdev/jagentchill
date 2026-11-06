// The PROVIDER in these tests is a TEST DOUBLE: `scripts/stub-generation.ts` (it "speaks" tones and "hears" them back by
// their level). The server's real captions service, generation service, budgets, ledger and blob store run against it.
// The agent runtimes are the fakes of `harness.ts`: a translation TURN is answered by the test where one is run.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cuesOfSpeech, pcm16OfFloat, speechPieces, wavOfPcm16 } from "@jagentchill/editor-core";
import { startStubGeneration, type StubGeneration } from "../scripts/stub-generation.ts";
import { translationPrompt, translationsOf } from "../src/captions/service.ts";
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
import { createHarness, model, SAMPLE_MODELS, tick, type Harness } from "./harness.ts";
import { classifyTurnError, turnFailureClass } from "../src/runtimes/errors.ts";
import { sampleDocument, support } from "./support/sync.ts";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } } });
const KEY = "sk-or-stub-0123456789abcd";
const LINES = ["The harbour is quiet before the boats return.", "Nobody remembers who painted the blue door.", "Tomorrow the market opens an hour earlier."];

/** TEST DOUBLE figures: what the stub provider "documents" for its models, with their source, as an admin records them on a model's row. */
const DOCUMENTED_SOUND = { audioTokensPerSecond: 25, sources: { audioTokensPerSecond: "TEST DOUBLE: the stub provider's documentation" } };
const documentedAnswer = (maxOutputTokens: number) => ({ maxOutputTokens, sources: { maxOutputTokens: "TEST DOUBLE: the stub provider's model list" } });
/** The Claude Code catalogue of these tests: the harness's, and one more model (a fallback of the Translation role). */
const MODELS = { ...SAMPLE_MODELS, "claude-code": [...SAMPLE_MODELS["claude-code"]!, model("haiku")] };
/**
 * The Claude Code CLI of a host is signed in with an API KEY (its own status command says so): its turns are billed per
 * call, and with no price the host knows they are "price not known" (ruling R9) — as the turns of the removed built-in
 * models were. The host reads the sign-in when it starts: its clock (`skew`) is moved past the time a reading holds, the
 * new reading is waited for, and the clock is put back (a reading taken "in the future" stays fresh).
 */
async function billedByKey(h: Harness, skew: { ms: number }): Promise<void> {
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  skew.ms += LOGIN_STALE_MS + 1;
  const billing = () => h.app.generation.gate.billingOf({ ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } });
  for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
  skew.ms = 0;
  assert.equal(billing(), "per_call", "Claude Code is billed per call");
}
/**
 * A profile of the Translation role (a language-model role: every profile names a runtime and a model it lists). A
 * model the generation catalogue has — the provider double's, which Claude Code lists here too — is served as a
 * generation job; any other is a turn of a session on that runtime.
 */
const profileOf = (provider: string, model: string) => ({ runtime: "claude-code", provider, model });
async function setup(connect = true) {
  const stub: StubGeneration = await startStubGeneration();
  const skew = { ms: 0 };
  const h = await createHarness({ models: MODELS, now: () => Date.now() + skew.ms, extra: { generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50, nextRouteWaitMs: 20 } } } as never });
  open.push(stub, h);
  await billedByKey(h, skew);
  const admin = await h.pair("Studio Mac", "admin");
  // The runtime lists the provider double's text models under the names the generation catalogue has them too (a
  // configured model list of Claude Code): a profile of the Translation role — a language-model role, whose every
  // profile names a runtime and a model that runtime lists — may name them.
  const revision = (await admin.call("jagentchill.runtime.config.get", {})).config.revision;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: { "claude-code": { additionalModels: ["stub/text-only", "stub/text-a", "stub/text-b"].map((modelId) => ({ providerId: "openrouter", modelId })) } } } });
  await h.settled();
  if (connect) {
    await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
    await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    // TEST-WORLD FIGURES (ruling R4: a per-token price is computed only from documented figures recorded with their source — the double's list prices its listener and its reader per token):
    // the admin records the tokens the stub provider "documents" for a second of sound, and gives the reader their own price per character (how much sound a text becomes is in no figure).
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", metadata: DOCUMENTED_SOUND } });
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
  }
  return { h, admin, stub };
}
/** A recording of the lines as the double speaks them (24 kHz mono, a 0.7 s pause between lines), after `lead` seconds of silence. */
async function recording(stub: StubGeneration, lines: string[], lead = 0.8): Promise<{ samples: Int16Array; rate: number }> {
  const answer = await fetch(`${stub.url}/audio/speech`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: "stub", input: lines.join("\n\n"), voice: "Kore" }) });
  const bytes = new Uint8Array(await answer.arrayBuffer()), spoken = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), samples = new Int16Array(Math.round(lead * 24_000) + spoken.length + 12_000);
  samples.set(spoken, Math.round(lead * 24_000));
  return { samples, rate: 24_000 };
}
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

test("Host run: three spoken pieces of a recording come back as three captions with the times of what was said, each listening a ledger row", async () => {
  const { h, admin, stub } = await setup();
  const status = await admin.call("jagentchill.captions.status", {});
  assert.deepEqual([status.transcription.available, status.transcription.model, status.speech.available], [true, "qwen/qwen3-asr-1.7b", true]);
  const { samples, rate } = await recording(stub, LINES), pieces = speechPieces(samples, rate);
  assert.equal(pieces.length, 3);
  const cues = [];
  for (const piece of pieces) {
    const heard = await admin.yes("jagentchill.captions.transcribe", { audio: base64(wavOfPcm16(samples.subarray(piece.from, piece.to), rate)), language: "en", projectId: "p1", confirmed: true });
    cues.push(...cuesOfSpeech(heard.text, (piece.from / rate) * 1000, (piece.to / rate) * 1000));
  }
  assert.deepEqual(cues.map((cue) => cue.text), LINES);
  // The double speaks fifteen characters a second with 0.7 s between lines.
  let at = 0.8;
  for (const [index, cue] of cues.entries()) {
    const seconds = Math.max(1, LINES[index].length / 15);
    assert.ok(Math.abs(cue.start_ms / 1000 - at) <= 0.1 && Math.abs(cue.end_ms / 1000 - (at + seconds)) <= 0.15, `cue ${index}: ${cue.start_ms}–${cue.end_ms}, said ${at}–${at + seconds}`);
    at += seconds + 0.7;
  }
  const rows = h.app.generation.ledgerRows({ projectId: "p1" });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row: any) => row.capability === "transcription" && row.outcome === "succeeded" && String(row.session_id).startsWith("device:")), JSON.stringify(rows[0]));
});

test("A person's own clip is sent without a question, and money is asked once: with no stored consent the piece is written back as text; by default (always ask) the estimate is confirmed first and nothing is sent before it; above the host's amount nothing is asked at all", async () => {
  const { admin, stub } = await setup();
  const { samples, rate } = await recording(stub, LINES.slice(0, 1)), [piece] = speechPieces(samples, rate), audio = base64(wavOfPcm16(samples.subarray(piece.from, piece.to), rate));
  const sent = () => stub.calls.filter((call) => call.path === "/audio/transcriptions").length, before = sent();
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, []);
  // The product's default: "Ask before spending more than" is 0 — the one question is the money one, with the estimate.
  const asked = await admin.fail("jagentchill.captions.transcribe", { audio });
  assert.deepEqual([asked.code, asked.details.reason, asked.details.confirmAboveUsd, asked.details.remainingUsd, asked.details.estimate.model, asked.details.estimate.amountUsd > 0], ["PERMISSION_DENIED", "confirmation_required", 0, null, "qwen/qwen3-asr-1.7b", true]);
  assert.equal(sent(), before, "nothing left the host before the confirmation");
  assert.equal((await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds: 4 })).needsConfirmation, true);
  // Confirmed: sent and heard — nobody was asked whether the clip's sound may go to the provider.
  assert.equal((await admin.yes("jagentchill.captions.transcribe", { audio, confirmed: true })).text, LINES[0]);
  assert.equal(sent(), before + 1);
  assert.equal((await admin.yes("jagentchill.captions.transcribe", { audio, confirmed: true, consent: "once" })).text, LINES[0], "the old parameter is taken and decides nothing");
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, []);
  // A host amount above the estimate: no confirmation either.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 1 } });
  assert.equal((await admin.call("jagentchill.captions.transcribe", { audio })).text, LINES[0]);
  assert.equal((await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds: 4 })).needsConfirmation, false);
});

test("Not connected: without a provider the status says so and a transcription is refused with NO_ROUTE; a viewer may not start one", async () => {
  const { h, admin } = await setup(false);
  const status = await admin.call("jagentchill.captions.status", {});
  assert.deepEqual([status.transcription.available, status.speech.available, status.translation.available], [false, false, false]);
  const audio = base64(wavOfPcm16(pcm16OfFloat(new Float32Array(16_000).fill(0.2)), 16_000));
  assert.equal((await admin.fail("jagentchill.captions.transcribe", { audio })).code, "NO_ROUTE");
  assert.equal((await admin.fail("jagentchill.captions.speak", { text: "Hello" })).code, "NO_ROUTE");
  assert.equal((await admin.fail("jagentchill.captions.transcribe", { audio: "not base64!" })).code, "INVALID_PARAMS");
  const viewer = await h.pair("Lobby screen", "viewer");
  assert.equal((await viewer.fail("jagentchill.captions.transcribe", { audio })).code, "SCOPE_DENIED");
});

test("Speech from a text clip: the text is spoken by the Voice role's model and listened back to; the verdict comes with the file", async () => {
  const { h, admin, stub } = await setup();
  // (A read-back is of a recording that does not exist yet, so it has a price only where the price does not depend on its length: this host's person priced the listener per call. With the double's per-token price it is "price not known" — test "Review 14 #6/#10".)
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.00002 } } });
  const made = await admin.yes("jagentchill.captions.speak", { text: LINES[0], language: "en", confirmed: true });
  assert.equal(made.check.ok, true, JSON.stringify(made.check));
  assert.equal(made.check.heard, LINES[0]);
  assert.ok(Math.abs(made.seconds - LINES[0].length / 15) < 0.1);
  assert.equal(h.app.sync.blobs.status(made.file.blobId).state, "complete");
  assert.equal(made.file.provenance.source, "ai");
  // A line the double mishears once is recorded again, and the take that was heard right is the one kept (what the second take costs beyond the approval is asked about: see the next test).
  const again = await admin.yes("jagentchill.captions.speak", { text: "The second take is the good one [misread]" }, 2);
  assert.equal(again.check.ok, true, JSON.stringify(again.check));
  assert.equal(stub.calls.filter((call) => call.path === "/audio/speech" && call.text.includes("[misread]")).length, 2);
});

test("Review 10 #3 (speech) — a direct action retries inside the approved amount: speaking and listening are quoted at $2 and confirmed; the line is misheard, and the second recording — which would make it $4 — is NOT sent on the strength of the $2: the action stops with what was spent and what the rest needs, and only the answer to that sends it; nothing that was paid for is repeated", async () => {
  const { admin, stub, h } = await setup();
  // A recording costs $1.50 and a listening $0.50 on this host (the double reports no cost of its own for either).
  stub.listListeners(false); stub.reportListeningCost(false);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_call", usd: 1.5 } } });
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.5 } } });
  const line = { text: "The harbour master counts the boats [misread]" }, sent = (path: string) => stub.calls.filter((call) => call.path === path).length;
  const spent = () => Math.round(h.app.generation.ledgerRows().reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 1e6) / 1e6;
  const quote = await admin.fail("jagentchill.captions.speak", line);
  assert.deepEqual([quote.details.estimate.amountUsd, sent("/audio/speech")], [2, 0]);
  const stopped = await admin.fail("jagentchill.captions.speak", { ...line, ...quote.details.confirmWith, confirmed: true });
  assert.deepEqual([stopped.details.reason, stopped.details.gate, stopped.details.estimate.spentUsd, stopped.details.estimate.remainsUsd, stopped.details.estimate.amountUsd, stopped.details.confirmedUsd, sent("/audio/speech"), sent("/audio/transcriptions"), spent()],
    ["confirmation_required", "over_amount", 2, 2, 4, 2, 1, 1, 2], "the $2 that were confirmed were spent on one recording and one listening; the second recording waits for an answer");
  // Asked again without an answer: the same question, nothing sent.
  assert.deepEqual([(await admin.fail("jagentchill.captions.speak", line)).details.confirmWith, sent("/audio/speech"), spent()], [stopped.details.confirmWith, 1, 2]);
  const made = await admin.call("jagentchill.captions.speak", { ...line, ...stopped.details.confirmWith, confirmed: true });
  assert.deepEqual([made.check.ok, made.costUsd, sent("/audio/speech"), sent("/audio/transcriptions"), spent()], [true, 4, 2, 2, 4], "the answer made the second recording and listened to it — and repeated nothing of the first");
});

test("Speaking a text again is paid again: with the recording in the cache and nobody to listen, 'again' is estimated at the price of a new recording — not $0 — and at the product's default (always ask) no speech request is sent before the confirmation", async () => {
  const { admin, stub } = await setup();
  // Nobody listens on this host: the estimate is the speaking alone.
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["qwen/qwen3-asr-1.7b"], enabled: false });
  assert.equal((await admin.call("jagentchill.provider.threshold.get", {})).thresholds.confirmAboveUsd, 0);
  const spoken = () => stub.calls.filter((call) => call.path === "/audio/speech").length;
  const fresh = await admin.call("jagentchill.captions.estimate", { kind: "speech", text: LINES[1], language: "en" });
  assert.ok(fresh.amountUsd > 0 && fresh.needsConfirmation, JSON.stringify(fresh));
  await admin.yes("jagentchill.captions.speak", { text: LINES[1], language: "en", confirmed: true });
  assert.equal(spoken(), 1);
  // The same text again from the cache costs nothing and asks nothing…
  assert.deepEqual([(await admin.call("jagentchill.captions.estimate", { kind: "speech", text: LINES[1], language: "en" })).amountUsd, (await admin.call("jagentchill.captions.speak", { text: LINES[1], language: "en" })).costUsd, spoken()], [0, 0, 1]);
  // …a NEW recording of it is paid work: estimated as such, and refused until it is confirmed.
  const again = await admin.call("jagentchill.captions.estimate", { kind: "speech", text: LINES[1], language: "en", again: true });
  assert.deepEqual([again.amountUsd, again.needsConfirmation], [fresh.amountUsd, true]);
  const refused = await admin.fail("jagentchill.captions.speak", { text: LINES[1], language: "en", again: true });
  assert.deepEqual([refused.code, refused.details.reason, refused.details.estimate.amountUsd, spoken()], ["PERMISSION_DENIED", "confirmation_required", fresh.amountUsd, 1]);
  const made = await admin.yes("jagentchill.captions.speak", { text: LINES[1], language: "en", again: true, confirmed: true });
  assert.deepEqual([spoken(), made.costUsd > 0], [2, true]);
});

test("A routed translation runs on the path its route gives: a Translation role on a runtime's model is ONE turn of a session on that model through the runtime — asked about money once (the host knows no price for it), nothing sent before — and a role on a model the generation catalogue has is a job of the generation service with its ledger row", async () => {
  // The MODEL of the runtime path is the fake runtime of `harness.ts`, answered here; the generation path is the provider double.
  const { h, admin, stub } = await setup(true);
  await h.settled();
  const texts = ["The harbour is quiet.", "Nobody remembers the blue door."], ask = { texts, source: "en", target: "vi", targetName: "Vietnamese" };
  const route = async (provider: string, model: string) => admin.call("jagentchill.orc.config.update", { expectedRevision: (await admin.call("jagentchill.orc.config.get", {})).revision, patch: { roles: { translation: { enabled: true, profiles: [{ id: "default", ...profileOf(provider, model), params: {}, enabled: true }], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} } } } });
  // The fake runtime's model answers a translation prompt like a model would: a JSON array, one entry per line.
  let seen = 0;
  const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>;
  const timer = setInterval(() => {
    for (const all = sends(); seen < all.length; seen++) {
      const call = all[seen], line = call.message.split("\n").filter((part) => part.startsWith("[")).pop();
      if (!line || !call.message.startsWith("Translate these")) continue;
      try { h.fake.reply(call.sessionKey, JSON.stringify((JSON.parse(line) as string[]).map((entry) => `(vi, by the runtime) ${entry}`))); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  const textCalls = () => stub.calls.filter((call) => call.path === "/chat/completions").length;

  // 1. A model of a runtime (Claude Code's own vendor "anthropic"): no generation provider has it.
  await route("anthropic", "opus");
  assert.deepEqual((await admin.call("jagentchill.captions.status", {})).translation, { available: true, provider: "anthropic", label: "anthropic", model: "opus", via: "runtime" });
  const shown = await admin.call("jagentchill.captions.estimate", { kind: "translation", characters: 50 });
  assert.deepEqual([shown.amountUsd, shown.needsConfirmation, shown.model, shown.via], [null, true, "opus", "runtime"]);
  const asked = await admin.fail("jagentchill.captions.translate", ask);
  assert.deepEqual([asked.code, asked.details.reason, asked.details.estimate.amountUsd, asked.details.estimate.model, asked.details.estimate.via, sends().length, textCalls()], ["PERMISSION_DENIED", "confirmation_required", null, "opus", "runtime", 0, 0]);
  const turned = await admin.yes("jagentchill.captions.translate", { ...ask, confirmed: true });
  assert.deepEqual([turned.translations, turned.model, turned.via], [texts.map((entry) => `(vi, by the runtime) ${entry}`), "opus", "runtime"]);
  // One turn, in a session created on the routed model; no generation provider was asked, and no ledger row is this turn's.
  const created = h.fake.callsOf("createSession") as Array<{ model?: string }>;
  assert.deepEqual([sends().length, textCalls(), h.app.generation.ledgerRows().filter((row) => row.capability === "translation").length], [1, 0, 0]);
  assert.ok(created.length === 1 && created[0].model === "opus", JSON.stringify(created));

  // 2. A model the generation catalogue has: the job path.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-only", label: "Stub Text", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, metadata: documentedAnswer(4000) } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-only"], enabled: true });
  await route("openrouter", "stub/text-only");
  assert.equal((await admin.call("jagentchill.captions.status", {})).translation.via, "generation");
  const priced = await admin.fail("jagentchill.captions.translate", ask);
  assert.deepEqual([priced.details.reason, priced.details.estimate.via, priced.details.estimate.amountUsd > 0, textCalls()], ["confirmation_required", "generation", true, 0]);
  const job = await admin.yes("jagentchill.captions.translate", { ...ask, confirmed: true });
  assert.deepEqual([job.translations, job.model, job.via, job.costUsd > 0], [texts.map((entry) => `[Vietnamese] ${entry}`), "stub/text-only", "generation", true]);
  assert.deepEqual([sends().length, textCalls(), h.app.generation.ledgerRows().filter((row) => row.capability === "translation" && row.outcome === "succeeded").length], [1, 1, 1]);
});

/** The Translation role with these models (of the generation provider, or of Claude Code) as its candidates, in this order: the first is the primary, the rest its fallbacks. */
const routeTranslation = async (admin: Awaited<ReturnType<typeof setup>>["admin"], targets: [provider: string, model: string][], fallbackOn?: string[]) => admin.call("jagentchill.orc.config.update", { expectedRevision: (await admin.call("jagentchill.orc.config.get", {})).revision, patch: { roles: { translation: { enabled: true, profiles: targets.map(([provider, model], index) => ({ id: `p${index}`, ...profileOf(provider, model), params: {}, enabled: true })), defaultProfileId: "p0", routes: { default: { primary: { profileId: "p0" }, fallbacks: targets.slice(1).map((_target, index) => ({ profileId: `p${index + 1}` })), ...(fallbackOn ? { fallbackOn } : {}) } }, limits: {} } } } });
const ASK = { texts: ["The harbour is quiet.", "Nobody remembers the blue door."], source: "en", target: "vi", targetName: "Vietnamese" };

test("A failing primary of the Translation role is followed by its fallback, on the job path: the first generation model answers 401 (auth_error), the configured fallback is asked and serves — said as usedFallback — with a ledger row for each; a budget refusal is NOT followed by the fallback", async () => {
  const { h, admin, stub } = await setup(true);
  await h.settled();
  for (const [id, each] of [["stub/text-a", 1], ["stub/text-b", 3]] as const) {
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, label: id, capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: each, outputPerMillionUsd: each }, metadata: documentedAnswer(4000) } });
    await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [id], enabled: true });
  }
  await routeTranslation(admin, [["openrouter", "stub/text-a"], ["openrouter", "stub/text-b"]]);
  const asked = () => stub.calls.filter((call) => call.path === "/chat/completions").map((call) => [call.model, call.status]);
  // The figure a person confirms covers the dearer fallback: a fallback that serves never costs more than was confirmed.
  const quote = (await admin.fail("jagentchill.captions.translate", ASK)).details.estimate as { amountUsd: number; model: string };
  // (Ruling R6: the estimate a screen shows beforehand is given the captions themselves — it is the quote of the very request, not of stand-in words.)
  const one = (await admin.call("jagentchill.captions.estimate", { kind: "translation", characters: ASK.texts.join("").length, lines: ASK.texts.length, texts: ASK.texts, targetName: ASK.targetName, source: ASK.source })).amountUsd as number;
  assert.deepEqual([quote.model, quote.amountUsd > 0, one === quote.amountUsd], ["stub/text-a", true, true], `${one} beside ${quote.amountUsd}: the estimate IS the quote`);
  stub.failModel("stub/text-a", 401);
  const made = await admin.yes("jagentchill.captions.translate", { ...ASK, confirmed: true });
  assert.deepEqual([made.translations, made.model, made.via, made.usedFallback, made.primary, made.reason], [ASK.texts.map((entry) => `[Vietnamese] ${entry}`), "stub/text-b", "generation", true, { provider: "openrouter", model: "stub/text-a" }, "auth_error"]);
  assert.deepEqual(asked(), [["stub/text-a", 401], ["stub/text-b", 200]]);
  assert.ok(made.costUsd <= quote.amountUsd + 1e-9 || made.costUsd === 0.00003, `${made.costUsd} of ${quote.amountUsd}`);
  assert.deepEqual(h.app.generation.ledgerRows().filter((row) => row.capability === "translation").map((row) => [row.model, row.outcome, row.error_class, row.used_fallback]), [["stub/text-a", "failed", "auth_error", 0], ["stub/text-b", "succeeded", null, 1]], "the ledger says the fallback served, as the answer does");
  // Both fail: the last failure, with what each candidate said.
  stub.failModel("stub/text-b", 500);
  const both = await admin.yesFail("jagentchill.captions.translate", { ...ASK, confirmed: true });
  assert.deepEqual([both.code, (both.details.attempts as { model: string; class: string }[]).map((entry) => [entry.model, entry.class])], ["UNAVAILABLE", [["stub/text-a", "auth_error"], ["stub/text-b", "server_error"]]]);
  // A spending limit that refuses the primary is the answer: no fallback is tried for it.
  stub.failModel("stub/text-a", 0); stub.failModel("stub/text-b", 0);
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: `device:${admin.device.deviceId}`, limitUsd: 0.01, period: "total", hardStop: true, allowUnknownCost: false } });
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "stub/text-a", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 10_000, outputPerMillionUsd: 0 }, metadata: documentedAnswer(4000) } });
  const before = asked().length, refused = await admin.yesFail("jagentchill.captions.translate", { ...ASK, confirmed: true });
  assert.deepEqual([refused.code, asked().length - before], ["BUDGET_EXCEEDED", 0]);
});

test("A failing primary of the Translation role is followed by its fallback, on the runtime path: the turn on the first model of the runtime ends in an error, the turn on the configured fallback serves — said as usedFallback; a turn a person stopped is not followed", async () => {
  // The MODEL is the fake runtime of `harness.ts`: a session on "opus" fails its turn, one on "haiku" answers.
  const { h, admin } = await setup();
  await h.settled();
  await routeTranslation(admin, [["anthropic", "opus"], ["anthropic", "haiku"]]);
  let seen = 0;
  const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string; options: { model?: string } }>, on: string[] = [];
  const timer = setInterval(() => {
    for (const all = sends(); seen < all.length; seen++) {
      const call = all[seen], line = call.message.split("\n").filter((part) => part.startsWith("[")).pop();
      if (!line || !call.message.startsWith("Translate these")) continue;
      const large = call.options.model === "opus";
      on.push(large ? "opus" : "haiku");
      if (large) { try { h.fake.endTurn(call.sessionKey, undefined, "error", "401 The API key was refused"); } catch { /* closed meanwhile */ } continue; }
      try { h.fake.reply(call.sessionKey, JSON.stringify((JSON.parse(line) as string[]).map((entry) => `(vi, by the fallback) ${entry}`))); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  assert.deepEqual((await admin.call("jagentchill.captions.status", {})).translation.model, "opus");
  // The fallback is a model whose price the host does not know: it is asked about, by name, before it is called…
  const first = await admin.fail("jagentchill.captions.translate", ASK);
  assert.deepEqual([first.details.estimate.model, first.details.estimate.amountUsd, first.details.estimate.unpricedModels, on], ["opus", null, ["runtime:anthropic/opus"], []], "the first question names the primary, whose price is not known: approving it approves THAT model");
  const asked = await admin.fail("jagentchill.captions.translate", { ...ASK, ...first.details.confirmWith, confirmed: true });
  assert.deepEqual([asked.details.reason, asked.details.gate, asked.details.unpriced, asked.details.estimate.amountUsd, asked.details.estimate.model, asked.details.estimate.unpricedModels, on], ["confirmation_required", "unpriced_model", true, null, "haiku", ["runtime:anthropic/haiku"], ["opus"]]);
  // …and the answer continues from there: the primary that failed is not asked again.
  const made = await admin.call("jagentchill.captions.translate", { ...ASK, ...asked.details.confirmWith, confirmed: true });
  assert.deepEqual([made.translations, made.model, made.via, made.usedFallback, made.primary, on], [ASK.texts.map((entry) => `(vi, by the fallback) ${entry}`), "haiku", "runtime", true, { provider: "anthropic", model: "opus" }, ["opus", "haiku"]]);
});

test("A failed turn of a runtime's model keeps its class for the fallback rules: a content refusal is NOT followed by the fallback, and a route that falls back on sign-in failures only does so for a sign-in failure — not for a rate limit", async () => {
  // Every sentence a failed turn is normalized to has its class.
  assert.deepEqual(["429 Too Many Requests", "insufficient_quota: no balance", "401 invalid api key", "prompt is too long", "model gpt-x does not exist", "request timed out", "Your input was flagged by the content policy", "spawn claude failed", "something odd", "403 Forbidden: your input was flagged by our content policy"].map((raw) => turnFailureClass(classifyTurnError(raw, "Claude Code").message)),
    ["rate_limited", "quota_exhausted", "auth_error", "invalid_request", "model_unavailable", "timeout", "content_blocked", "model_unavailable", "unknown", "content_blocked"]);
  // The code of the failure is what decides when the caller is handed it; the sentence only stands in for it.
  assert.deepEqual([turnFailureClass("Sign in to Claude Code again", "CONTENT_BLOCKED"), turnFailureClass("anything", "runtime/auth-failed"), turnFailureClass("Sign in to Claude Code again", undefined)], ["content_blocked", "auth_error", "auth_error"]);
  // The MODEL is the fake runtime of `harness.ts`: a session on "opus" fails its turn with `fails`, one on "haiku" answers.
  const { h, admin } = await setup();
  await h.settled();
  let seen = 0, fails = "";
  const sends = () => h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string; options: { model?: string } }>, on: string[] = [];
  const timer = setInterval(() => {
    for (const all = sends(); seen < all.length; seen++) {
      const call = all[seen], line = call.message.split("\n").filter((part) => part.startsWith("[")).pop(), large = call.options.model === "opus";
      if (!line || !call.message.startsWith("Translate these")) continue;
      on.push(large ? "opus" : "haiku");
      if (large) { try { h.fake.endTurn(call.sessionKey, undefined, "error", fails); } catch { /* closed meanwhile */ } continue; }
      try { h.fake.reply(call.sessionKey, JSON.stringify((JSON.parse(line) as string[]).map((entry) => `(vi) ${entry}`))); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  const tried = async () => { const from = on.length; const outcome = await admin.yes("jagentchill.captions.translate", ASK, 2).then((made: { model: string }) => made.model, () => "failed"); return [outcome, on.slice(from)]; };
  // The default set: a refusal of the request under the provider's content rules is the answer — no other model is asked the same thing.
  await routeTranslation(admin, [["anthropic", "opus"], ["anthropic", "haiku"]]);
  fails = "Your input was flagged by the content policy";
  assert.deepEqual(await tried(), ["failed", ["opus"]]);
  // A route with its own triggers: sign-in failures only.
  await routeTranslation(admin, [["anthropic", "opus"], ["anthropic", "haiku"]], ["auth_error"]);
  fails = "429 Too Many Requests";
  assert.deepEqual(await tried(), ["failed", ["opus"]]);
  // A content refusal that comes as a 403 is a content refusal — not a sign-in failure: the sign-in-only route does not move on.
  fails = "403 Forbidden: your input was flagged by our content policy";
  assert.deepEqual(await tried(), ["failed", ["opus"]]);
  fails = "401 invalid api key";
  assert.deepEqual(await tried(), ["haiku", ["opus", "haiku"]]);
});

/** A host whose Translation role is two generation models of the provider double, each priced as given (undefined: no price is known). */
async function twoTranslators(prices: [number | undefined, number | undefined]) {
  const world = await setup(true);
  await world.h.settled();
  for (const [index, id] of ["stub/text-a", "stub/text-b"].entries()) {
    await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, label: id, capability: "translation", ...(prices[index] !== undefined ? { pricing: { kind: "per_call", usd: prices[index] } } : {}) } });
    await world.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [id], enabled: true });
  }
  await routeTranslation(world.admin, [["openrouter", "stub/text-a"], ["openrouter", "stub/text-b"]]);
  const calls = () => world.stub.calls.filter((call) => call.path === "/chat/completions").map((call) => call.model);
  const spent = () => Math.round(world.h.app.generation.ledgerRows().filter((row) => row.capability === "translation").reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 1e6) / 1e6;
  return { ...world, calls, spent };
}

const TRANSLATE = "jagentchill.captions.translate";
/** The answer a person gives to a money question: what it named to be sent back, with `confirmed: true` — as the cost dialog does. */
const answerTo = (question: { details?: any }) => ({ ...question.details.confirmWith, confirmed: true as const });

test("Confirming a higher figure never pays twice for the same work: the first call is paid, its answer is not accepted, the paid repair is held at the confirmed figure and asked about as 'spent so far + what remains' — confirmed, ONLY the repair is sent and charged: the total is first call + repair", async () => {
  // Both models cost exactly what the double bills a call: $0.00003.
  const { admin, calls, spent } = await twoTranslators([0.00003, 0.00003]);
  // A caption the double miscounts the first time it is asked, and translates when asked again.
  const ask = { ...ASK, texts: ["The harbour is quiet.", "Nobody remembers [miscount] the blue door."] };
  const first = await admin.fail(TRANSLATE, ask);
  assert.deepEqual([first.details.estimate.amountUsd, Object.keys(first.details.confirmWith).sort(), calls()], [0.00003, ["actionId", "quoteId"], []]);
  const repair = await admin.fail(TRANSLATE, { ...ask, ...answerTo(first) });
  assert.deepEqual([repair.code, repair.details.reason, repair.details.gate, repair.details.estimate.amountUsd, repair.details.estimate.spentUsd, repair.details.estimate.remainsUsd, repair.details.spentUsd, repair.details.confirmedUsd, calls(), spent()],
    ["PERMISSION_DENIED", "confirmation_required", "over_amount", 0.00006, 0.00003, 0.00003, 0.00003, 0.00003, ["stub/text-a"], 0.00003]);
  // Asked again without an answer: the same question, and nothing is sent.
  const again = await admin.fail(TRANSLATE, ask);
  assert.deepEqual([again.details.estimate.amountUsd, again.details.estimate.spentUsd, again.details.confirmWith, calls().length], [0.00006, 0.00003, repair.details.confirmWith, 1]);
  // The answer that was given to the FIRST question is not an answer to this one; neither is a figure a screen of before sends along.
  assert.deepEqual([(await admin.fail(TRANSLATE, { ...ask, ...answerTo(first) })).details.estimate.amountUsd, (await admin.fail(TRANSLATE, { ...ask, ...answerTo(first), confirmedUsd: 50 })).details.estimate.amountUsd, calls().length], [0.00006, 0.00006, 1]);
  const made = await admin.call(TRANSLATE, { ...ask, ...answerTo(repair) });
  assert.deepEqual([made.translations.length, made.model, made.costUsd, calls(), spent()], [2, "stub/text-a", 0.00006, ["stub/text-a", "stub/text-a"], 0.00006], "two calls in all — the first is not made, or paid, a second time");
});

test("Review 16 #4 — the answer to a stop about a request of unknown price lets THAT request out, also though the resumed translation is a new job: a translator with no price is approved by name; its first answer is not accepted and has a bill, so the repair stops to ask ('price not known'); the person answers ONCE — the repair is sent and the translation is made: two calls in all, and no further question", async () => {
  // No price is known for either model; the double bills $0.00003 a call.
  const { admin, calls, spent } = await twoTranslators([undefined, undefined]);
  const ask = { ...ASK, texts: ["The harbour is quiet.", "Nobody remembers [miscount] the blue door."] };
  const first = await admin.fail(TRANSLATE, ask);
  assert.deepEqual([first.details.estimate.amountUsd, first.details.estimate.unpricedModels?.length > 0, calls()], [null, true, []]);
  // (Final #2, rule (h)) This test used to assert a SECOND question before the repair ("the repair stops to ask"): the approval by name is for the action — the ONE answer sends the first call and its repair.
  const made = await admin.call(TRANSLATE, { ...ask, ...answerTo(first) });
  assert.deepEqual([made.translations.length, made.model, calls(), spent()], [2, "stub/text-a", ["stub/text-a", "stub/text-a"], 0.00006]);
});

test("A further paid call of a translation never passes what was confirmed: after the repair, the paid fallback is not sent past the confirmed figure either — each question says what was spent and what remains, and each answer continues from where the action stands", async () => {
  const { admin, calls, spent } = await twoTranslators([0.00003, 0.00003]);
  // A caption the double always answers with an empty translation: never accepted, by either model.
  const ask = { ...ASK, texts: ["The harbour is quiet.", "Nobody remembers [blank] the blue door."] };
  const repair = await admin.fail(TRANSLATE, { ...ask, ...answerTo(await admin.fail(TRANSLATE, ask)) });
  assert.deepEqual([repair.details.estimate.amountUsd, repair.details.estimate.model, calls()], [0.00006, "stub/text-a", ["stub/text-a"]]);
  const fallback = await admin.fail(TRANSLATE, { ...ask, ...answerTo(repair) });
  assert.deepEqual([fallback.details.reason, fallback.details.estimate.amountUsd, fallback.details.estimate.spentUsd, fallback.details.estimate.model, calls(), spent()], ["confirmation_required", 0.00009, 0.00006, "stub/text-b", ["stub/text-a", "stub/text-a"], 0.00006]);
  const last = await admin.fail(TRANSLATE, { ...ask, ...answerTo(fallback) });
  assert.deepEqual([last.details.estimate.amountUsd, calls()], [0.00012, ["stub/text-a", "stub/text-a", "stub/text-b"]]);
});

test("Review 10 #1 — spending is kept through a route change and a re-quote: $1 was charged, the action stopped to ask, the Translation route was changed before the answer — the answer goes through the new route, the $1 already charged still counts against what is approved, and the answer reports the $2 that were charged, not $1", async () => {
  const { admin, stub, calls, spent, h } = await twoTranslators([1, 1]);
  stub.bill({ chat: 1 });
  const ask = { ...ASK, texts: ["The harbour is quiet.", "Nobody remembers [miscount] the blue door."] };
  const stopped = await admin.fail(TRANSLATE, { ...ask, ...answerTo(await admin.fail(TRANSLATE, ask)) });
  assert.deepEqual([stopped.details.estimate.spentUsd, stopped.details.estimate.amountUsd, calls(), spent()], [1, 2, ["stub/text-a"], 1]);
  // The route is changed between the question and the answer: the other model is the primary now.
  await routeTranslation(admin, [["openrouter", "stub/text-b"], ["openrouter", "stub/text-a"]]);
  // Asked again (no answer): the action still stands, with what it has spent.
  const still = await admin.fail(TRANSLATE, ask);
  assert.deepEqual([still.details.reason, still.details.estimate.spentUsd, still.details.spentUsd, calls().length], ["confirmation_required", 1, 1, 1], "the $1 that was charged is not forgotten with the route");
  const made = await admin.yes(TRANSLATE, ask);
  assert.deepEqual([made.translations.length, made.model, made.costUsd, calls(), spent()], [2, "stub/text-b", 2, ["stub/text-a", "stub/text-b"], 2], "$2 were charged and $2 is what the answer says");
  assert.equal((h.app.db.prepare("SELECT COUNT(*) AS n FROM gen_standing").get() as { n: number }).n, 0, "the action ended: nothing of it is kept");
});

test("Review 10 #2 — two answers to one question spend once: the same confirmation sent twice at the same moment (a double click) sends the repair ONCE — two $1 calls against the $2 that were confirmed, never three — and both requests get the one answer", async () => {
  const { admin, stub, calls, spent } = await twoTranslators([1, 1]);
  stub.bill({ chat: 1 });
  const ask = { ...ASK, texts: ["The harbour is quiet.", "Nobody remembers [miscount] the blue door."] };
  const stopped = await admin.fail(TRANSLATE, { ...ask, ...answerTo(await admin.fail(TRANSLATE, ask)) });
  assert.deepEqual([stopped.details.estimate.amountUsd, calls().length], [2, 1]);
  const both = await Promise.allSettled([admin.yes(TRANSLATE, { ...ask, ...answerTo(stopped) }, 0), admin.yes(TRANSLATE, { ...ask, ...answerTo(stopped) }, 0)]);
  assert.deepEqual([calls(), spent()], [["stub/text-a", "stub/text-a"], 2], "the repair went out once");
  assert.deepEqual(both.map((outcome) => (outcome.status === "fulfilled" ? [outcome.value.translations.length, outcome.value.costUsd] : String(outcome.reason).slice(0, 120))), [[2, 2], [2, 2]]);
  // The click that comes after the work has ended starts a new action: it is asked about, and nothing is sent on the strength of the old answer.
  const after = await admin.fail(TRANSLATE, { ...ask, ...answerTo(stopped) });
  assert.deepEqual([after.details.reason, after.details.gate, calls().length], ["confirmation_required", "not_approved", 2]);
});

test("Review 10 #4 / Review 11 #13 — a token-priced translation is quoted for the WHOLE request by a real upper bound, and its answer is bounded to what was quoted: the instruction is in the figure as well as the captions; the provider counts FAR more input tokens than a quarter of the characters (one a character) and would write 5 000 tokens more than the answer needs — and still bills no more than the person confirmed", async () => {
  const { admin, stub, calls, spent } = await twoTranslators([undefined, undefined]);
  // $0.01 a token, read or written. The double counts every character of the whole prompt as a token (four times the usual rule of thumb).
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "stub/text-a", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 10_000, outputPerMillionUsd: 10_000 }, metadata: documentedAnswer(4000) } });
  await routeTranslation(admin, [["openrouter", "stub/text-a"]]);
  stub.bill({ chat: { inputPerToken: 0.01, outputPerToken: 0.01, extraOutputTokens: 5000, tokensPerCharacter: 1 } });
  const asked = await admin.fail(TRANSLATE, ASK), quoted: number = asked.details.estimate.amountUsd, prompt = translationPrompt(ASK.texts, ASK.targetName, ASK.source), captions = ASK.texts.join("").length;
  assert.ok(quoted >= prompt.length * 0.01, `the figure (${quoted}) covers reading the whole prompt (${prompt.length} characters) at a token a character — not the ${captions} characters of the captions at four a token`);
  const made = await admin.call(TRANSLATE, { ...ASK, ...answerTo(asked) });
  const sent = JSON.parse(stub.bodies.filter((body) => body.includes("Translate these")).at(-1)!) as { max_tokens?: number };
  assert.deepEqual([made.translations.length, calls(), sent.max_tokens, made.costUsd === spent()], [2, ["stub/text-a"], Buffer.byteLength(ASK.texts.join(""), "utf8") + Buffer.byteLength(JSON.stringify(ASK.texts.map(() => "")), "utf8"), true], "(ruling R6) the limit sent is the captions' bytes + the empty answer's — not the model's whole longest answer");
  assert.ok(made.costUsd <= quoted + 1e-9, `charged ${made.costUsd}, confirmed ${quoted}`);
});

test("Review 10 #5 — an answer to an outdated quote approves nothing: the price went up, or the route changed, between the question and the answer — `confirmed: true` with what the OLD question named starts nothing, the quote of now is asked, and only the answer to that one runs", async () => {
  const { admin, calls } = await twoTranslators([0.00003, 0.00003]);
  await routeTranslation(admin, [["openrouter", "stub/text-a"]]);
  const first = await admin.fail(TRANSLATE, ASK);
  assert.equal(first.details.estimate.amountUsd, 0.00003);
  // The price triples before the person answers.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "stub/text-a", capability: "translation", pricing: { kind: "per_call", usd: 0.00009 } } });
  const dearer = await admin.fail(TRANSLATE, { ...ASK, ...answerTo(first) });
  assert.deepEqual([dearer.details.reason, dearer.details.gate, dearer.details.estimate.amountUsd, dearer.details.confirmWith.quoteId === first.details.confirmWith.quoteId, calls()], ["confirmation_required", "outdated_quote", 0.00009, false, []]);
  // A plain `confirmed: true` — no word of which question it answers — after ANOTHER change: nothing either.
  await routeTranslation(admin, [["openrouter", "stub/text-b"]]);
  const moved = await admin.fail(TRANSLATE, { ...ASK, confirmed: true });
  assert.deepEqual([moved.details.gate, moved.details.estimate.model, moved.details.estimate.amountUsd, calls()], ["outdated_quote", "stub/text-b", 0.00003, []]);
  // And `confirmed: true` to a question nobody was shown (a new request) approves nothing.
  assert.deepEqual([(await admin.fail(TRANSLATE, { ...ASK, texts: ["Another caption."], confirmed: true })).details.gate, calls()], ["not_approved", []]);
  const made = await admin.call(TRANSLATE, { ...ASK, ...answerTo(moved) });
  assert.deepEqual([made.model, calls()], ["stub/text-b", ["stub/text-b"]]);
});

test("A stopped translation survives a restart of the host and any wait: the paid first call and what it cost are in the host's store — confirming after a real restart on the same data directory, or more than thirty minutes later, sends ONLY the repair, and the answer reports the true total", async () => {
  const MISCOUNT = (tag: string) => ({ ...ASK, texts: [`The harbour is quiet (${tag}).`, `Nobody remembers [miscount] the blue door (${tag}).`] });
  const first = await twoTranslators([0.00003, 0.00003]), device = first.admin.device.deviceId;
  // 1. A restart between the question and the answer.
  const ask = MISCOUNT("restart"), stopped = await first.admin.fail(TRANSLATE, { ...ask, ...answerTo(await first.admin.fail(TRANSLATE, ask)) });
  assert.deepEqual([stopped.details.estimate.amountUsd, stopped.details.estimate.spentUsd, first.calls(), first.spent()], [0.00006, 0.00003, ["stub/text-a"], 0.00003]);
  first.h.stop();
  const h = await createHarness({ dataDir: first.h.dataDir, models: MODELS, extra: { generation: { openRouterBaseUrl: first.stub.url, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50, nextRouteWaitMs: 20 } } } as never });
  open.push(h);
  await h.settled();
  const connection = { deviceId: device, role: () => "admin" as const, scopes: () => h.app.devices.scopesOf(device) } as never;
  const call = (params: unknown): Promise<any> => Promise.resolve().then(() => h.app.methods.get(TRANSLATE)!.handle(params, connection));
  const refused = (params: unknown): Promise<{ details: any }> => call(params).then(() => assert.fail("it was not asked"), (error: { details: any }) => error);
  const spent = () => Math.round(h.app.generation.ledgerRows().filter((row) => row.capability === "translation").reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 1e6) / 1e6;
  // The restarted host still holds the question — the same one, with what was spent…
  const still = await refused(ask);
  assert.deepEqual([still.details.estimate.amountUsd, still.details.estimate.spentUsd, still.details.confirmWith, first.calls().length], [0.00006, 0.00003, stopped.details.confirmWith, 1]);
  // …and the answer the person gives to the question they were shown BEFORE the restart sends the repair alone: two calls in all, $0.00006 charged, $0.00006 reported.
  const made = await call({ ...ask, ...answerTo(stopped) });
  assert.deepEqual([made.translations.length, made.costUsd, first.calls(), spent()], [2, 0.00006, ["stub/text-a", "stub/text-a"], 0.00006]);
  // 2. An answer that comes more than thirty minutes after the question.
  const late = MISCOUNT("late"), waited = await refused({ ...late, ...answerTo(await refused(late)) });
  assert.deepEqual([waited.details.estimate.amountUsd, first.calls().length], [0.00006, 3]);
  const clock = Date.now;
  let after: any;
  try { Date.now = () => clock() + 31 * 60_000; after = await call({ ...late, ...answerTo(waited) }); } finally { Date.now = clock; }
  assert.deepEqual([after.translations.length, after.costUsd, first.calls().length, spent()], [2, 0.00006, 4, 0.00012], "the first call was not made, or paid, again");
  // An action that ended keeps nothing in the store.
  // An action that ended keeps nothing of its approval in the store — and every one of its charges (Review 11 #8: they are never deleted).
  assert.deepEqual([(h.app.db.prepare("SELECT COUNT(*) AS n FROM gen_standing").get() as { n: number }).n, { ...(h.app.db.prepare("SELECT COUNT(*) AS n, ROUND(SUM(usd), 6) AS usd FROM gen_charges").get() as { n: number; usd: number }) }], [0, { n: 4, usd: 0.00012 }]);
});

test("A fallback whose price is not known is not zero: the estimate names it beside the figure, and when the primary fails it is NOT called on the strength of the figure that was confirmed — the person is asked plainly about that model, and their answer continues with it", async () => {
  // The primary costs $0.00003 a call; the fallback has no price in the catalogue (the double bills it all the same).
  const { h, admin, stub, calls, spent } = await twoTranslators([0.00003, undefined]);
  const shown = await admin.fail(TRANSLATE, ASK);
  assert.deepEqual([shown.details.estimate.amountUsd, shown.details.estimate.unpricedFallbacks], [0.00003, [{ provider: "openrouter", model: "stub/text-b", via: "generation" }]]);
  assert.deepEqual((await admin.call("jagentchill.captions.estimate", { kind: "translation", characters: 50 })).unpricedFallbacks, [{ provider: "openrouter", model: "stub/text-b", via: "generation" }]);
  stub.failModel("stub/text-a", 401);
  const asked = await admin.fail(TRANSLATE, { ...ASK, ...answerTo(shown) });
  assert.deepEqual([asked.code, asked.details.reason, asked.details.gate, asked.details.unpriced, asked.details.estimate.amountUsd, asked.details.estimate.unpriced, asked.details.estimate.model, asked.details.estimate.unpricedModels, calls(), spent()],
    ["PERMISSION_DENIED", "confirmation_required", "unpriced_model", true, null, true, "stub/text-b", ["openrouter/stub/text-b"], ["stub/text-a"], 0]);
  // A higher FIGURE is not an approval of a price nobody knows; neither is the answer to the first question.
  assert.deepEqual([(await admin.fail(TRANSLATE, { ...ASK, ...answerTo(shown), confirmedUsd: 50 })).details.estimate.model, calls().length], ["stub/text-b", 1]);
  const made = await admin.call(TRANSLATE, { ...ASK, ...answerTo(asked) });
  assert.deepEqual([made.model, made.usedFallback, calls()], ["stub/text-b", true, ["stub/text-a", "stub/text-b"]]);
  assert.deepEqual(h.app.generation.ledgerRows().filter((row) => row.capability === "translation" && row.outcome === "succeeded").map((row) => [row.model, row.used_fallback]), [["stub/text-b", 1]]);
});

test("Review 11 #12 — an action of several requests is quoted for ALL of them, once, and the estimate comes with the ids of its question: a recording of three pieces on a listener priced per call is $1.50, not $0.50 — the estimate says so and names `{actionId, quoteId}`; answered once, the three pieces are heard with no other question. Forty-five captions on a translator priced per call are two batches: $2, one answer, both batches", async () => {
  const { admin, stub, h } = await twoTranslators([1, 1]);
  await routeTranslation(admin, [["openrouter", "stub/text-a"]]);
  stub.bill({ chat: 1 }); stub.listListeners(false); stub.reportListeningCost(false);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.5 } } });
  const { samples, rate } = await recording(stub, LINES), pieces = speechPieces(samples, rate), wholeSeconds = pieces.reduce((sum, piece) => sum + (piece.to - piece.from) / rate, 0);
  const heard = () => stub.calls.filter((call) => call.path === "/audio/transcriptions").length, charged = (capability: string) => Math.round(h.app.generation.ledgerRows().filter((row) => row.capability === capability).reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 1e6) / 1e6;
  const shown = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds: wholeSeconds, pieces: pieces.length });
  assert.deepEqual([shown.amountUsd, shown.needsConfirmation, Object.keys(shown.confirmWith).sort(), heard()], [1.5, true, ["actionId", "quoteId"], 0]);
  const texts: string[] = [];
  for (const piece of pieces) texts.push((await admin.call("jagentchill.captions.transcribe", { audio: base64(wavOfPcm16(samples.subarray(piece.from, piece.to), rate)), language: "en", wholeSeconds, wholePieces: pieces.length, ...shown.confirmWith, confirmed: true })).text);
  assert.deepEqual([texts, heard(), charged("transcription")], [LINES, 3, 1.5], "one answer, three pieces, what was quoted");
  // Forty-five captions: two batches of the translator, quoted together.
  const captions = Array.from({ length: 45 }, (_value, index) => `Caption number ${index + 1}.`), whole = { characters: captions.join("").length, lines: captions.length };
  const quoted = await admin.call("jagentchill.captions.estimate", { kind: "translation", ...whole, texts: captions, targetName: "Vietnamese", source: "en" });
  assert.deepEqual([quoted.amountUsd, Object.keys(quoted.confirmWith).sort()], [2, ["actionId", "quoteId"]]);
  const out: string[] = [];
  for (const batch of [captions.slice(0, 40), captions.slice(40)]) out.push(...(await admin.call(TRANSLATE, { texts: batch, source: "en", target: "vi", targetName: "Vietnamese", whole, ...quoted.confirmWith, confirmed: true })).translations);
  assert.deepEqual([out.length, charged("translation")], [45, 2]);
});

test("Translate captions: an answer is accepted only as exactly one translation per caption", () => {
  assert.deepEqual(translationsOf('["こんにちは", "さようなら"]', 2), ["こんにちは", "さようなら"]);
  assert.deepEqual(translationsOf('Here you go:\n```json\n["Xin chào",  "Tạm   biệt"]\n```', 2), ["Xin chào", "Tạm biệt"]);
  assert.equal(translationsOf('["only one"]', 2), undefined, "a different count fails the batch");
  assert.equal(translationsOf('["a", 2]', 2), undefined);
  assert.equal(translationsOf("I cannot translate this.", 1), undefined);
  assert.equal(translationsOf('["", "   "]', 2), undefined, "blank translations are not translations");
  assert.equal(translationsOf('["Xin chào", " "]', 2), undefined, "one blank entry fails the batch");
  const prompt = translationPrompt(["Hi", "Bye"], "Japanese", "en");
  assert.ok(prompt.includes('["Hi","Bye"]') && prompt.includes("exactly 2 strings") && prompt.includes("into Japanese"));
});

test("Two providers, no question about what is sent and ONE about money: a text is spoken by one provider and listened back to by the OTHER after a single confirmation of both costs together; a person's own clip goes to that other provider unasked", async () => {
  const { h, admin, stub } = await setup();
  const { createGenerationService } = await import("../src/generation/service.ts"), { createOpenRouterAdapter } = await import("../src/generation/openrouter.ts"), { createCaptionsService } = await import("../src/captions/service.ts");
  const { ServerConfigFile } = await import("../src/store/server-config.ts"), { join } = await import("node:path");
  // A second provider that only listens (the same double behind another name): "ListenCo".
  const speaker = createOpenRouterAdapter({ baseUrl: stub.url }), second = createOpenRouterAdapter({ baseUrl: stub.url });
  const listenCo = { ...second, describe: () => ({ ...second.describe(), id: "listenco", label: "ListenCo", hosts: ["listen.example"], capabilities: ["transcription" as const] }), listModels: async () => [] };
  const generation = createGenerationService({ db: h.app.db, config: new ServerConfigFile(join(h.dataDir, "config.json")), secrets: h.app.secrets, now: Date.now, dataDir: h.dataDir, blobs: h.app.sync.blobs, probe: (path: string) => h.app.sync.mediaJobs.probe(path), broadcast: () => undefined, adapters: [speaker, listenCo], timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } });
  open.push(generation);
  const connection = { deviceId: admin.device.deviceId, role: () => "admin" as const, scopes: () => h.app.devices.scopesOf(admin.device.deviceId) } as never;
  const gen = (name: string, params: unknown) => generation.methods.get(name)!.handle(params, connection) as Promise<any>;
  await admin.putSecret("PROVIDER_LISTENCO_API_KEY", KEY);
  await gen("jagentchill.provider.connect", { providerId: "listenco", secretNames: ["PROVIDER_LISTENCO_API_KEY"] });
  await gen("jagentchill.provider.model.upsert", { providerId: "listenco", model: { id: "stub/listener", label: "Listener", capability: "transcription" } });
  await gen("jagentchill.provider.model.setEnabled", { providerId: "listenco", modelIds: ["stub/listener"], enabled: true });
  await gen("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["qwen/qwen3-asr-1.7b"], enabled: false });
  assert.equal(generation.listener()!.provider, "listenco");
  const captions = createCaptionsService({ generation: () => generation, sync: h.app.sync });
  const speak = (params: object): Promise<any> => captions.methods.get("jagentchill.captions.speak")!.handle(params, connection) as Promise<any>;
  const transcribe = async (params: object): Promise<any> => { try { return await captions.methods.get("jagentchill.captions.transcribe")!.handle(params, connection); } catch (error) { return { refused: error }; } };
  // Neither provider holds any stored consent. The one question of "speak" is its cost — speaking and listening together.
  assert.deepEqual((await gen("jagentchill.provider.consent.list", {})).consents, []);
  const spoke = () => stub.calls.filter((call) => call.path === "/audio/speech").length, before = spoke();
  let asked: any;
  try { await speak({ text: LINES[0], language: "en" }); } catch (error) { asked = error; }
  assert.deepEqual([asked?.code, asked?.details.reason, asked?.details.confirmAboveUsd, asked?.details.estimate.provider, asked?.details.estimate.listener, asked?.details.estimate.amountUsd], ["PERMISSION_DENIED", "confirmation_required", 0, "openrouter", "stub/listener", null], JSON.stringify(asked?.details));
  assert.equal(spoke(), before, "nothing was made before the confirmation");
  const made = await speak({ text: LINES[0], language: "en", ...asked.details.confirmWith, confirmed: true });
  assert.equal(made.check?.ok, true, JSON.stringify(made));
  assert.deepEqual(generation.ledgerRows().filter((row) => row.outcome === "succeeded").map((row) => [row.capability, row.provider]).slice(-2), [["tts", "openrouter"], ["transcription", "listenco"]]);
  // A screen written before the ruling still sends its leaves: they are taken and decide nothing.
  const old = { text: LINES[2], language: "en", consent: "once", listenConsent: "once" }, shown = await speak(old).then(() => assert.fail("not asked"), (error: any) => error);
  assert.equal((await speak({ ...old, ...shown.details.confirmWith, confirmed: true })).check?.ok, true);
  // The person's OWN recording (a clip of their project) to ListenCo: sent and heard, unasked.
  const own = await recording(stub, [LINES[1]], 0.2), piece = base64(wavOfPcm16(own.samples.subarray(0, 24_000 * 4), own.rate));
  const sent = stub.calls.filter((call) => call.path === "/audio/transcriptions").length;
  const heard = await transcribe({ audio: piece, language: "en", ...(await transcribe({ audio: piece, language: "en" })).refused.details.confirmWith, confirmed: true });
  assert.equal(typeof heard.text, "string", JSON.stringify(heard.refused?.details));
  assert.equal(stub.calls.filter((call) => call.path === "/audio/transcriptions").length, sent + 1);
  assert.deepEqual((await gen("jagentchill.provider.consent.list", {})).consents, []);
});

test("Review 12 #1 (translation) — no unrestricted authority: a translation for a run nobody confirmed, at 'ask before spending more than' 0, is refused with the money question BEFORE anything is sent (never a $1 call unasked); a run that put its person's confirmation on record is served inside it; and under a ceiling a person set, everything the run spends counts together against it", async () => {
  const { admin, stub, calls, spent, h } = await twoTranslators([1, 1]);
  stub.bill({ chat: 1 });
  const device = { deviceId: admin.device.deviceId } as never, refused = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return error as { code?: string; details?: any }; } return assert.fail("it was sent"); };
  const uncovered = await refused(() => h.app.captions.translate(ASK, device, { sessionId: "run:nobody" }));
  assert.deepEqual([uncovered.code, uncovered.details?.reason, calls(), spent()], ["PERMISSION_DENIED", "confirmation_required", [], 0]);
  h.app.generation.gate.cover({ fixedId: "run:paid", kind: "run", owner: "run:paid", amountUsd: 1, models: ["openrouter/stub/text-a", "openrouter/stub/text-b"] });
  assert.deepEqual([(await h.app.captions.translate(ASK, device, { sessionId: "run:paid" })).costUsd, calls(), spent()], [1, ["stub/text-a"], 1]);
  // A ceiling a person set on the host: $2. An unconfirmed run spends under it — both its translations counted together.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 2 } });
  await h.app.captions.translate(ASK, device, { sessionId: "run:quiet" });
  await h.app.captions.translate({ ...ASK, texts: ["One.", "Two."] }, device, { sessionId: "run:quiet" });
  const third = await refused(() => h.app.captions.translate({ ...ASK, texts: ["Three.", "Four."] }, device, { sessionId: "run:quiet" }));
  assert.deepEqual([third.details?.reason, calls().length, spent()], ["confirmation_required", 3, 3]);
});

test("Review 12 #8 — a one-piece recording is ONE action with ONE question: the estimate names `{actionId, quoteId}`, the screen sends the single piece with exactly those and `confirmed: true` — it is heard (never refused as an 'outdated quote' and asked a second time); the same holds when the screen states the whole (`wholeSeconds`, one piece), and with no estimate at all the piece's own question is answered once", async () => {
  const { admin, stub, h } = await setup();
  stub.listListeners(false); stub.reportListeningCost(false);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.5 } } });
  const { samples, rate } = await recording(stub, [LINES[0]]), [piece] = speechPieces(samples, rate), seconds = (piece.to - piece.from) / rate, audio = base64(wavOfPcm16(samples.subarray(piece.from, piece.to), rate));
  const heard = () => stub.calls.filter((call) => call.path === "/audio/transcriptions").length, charged = () => Math.round(h.app.generation.ledgerRows().filter((row) => row.capability === "transcription").reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 1e6) / 1e6;
  // 1. The estimate, then the piece with the estimate's ids — as the cost dialog sends it.
  const shown = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds });
  assert.deepEqual([shown.amountUsd, Object.keys(shown.confirmWith).sort(), heard()], [0.5, ["actionId", "quoteId"], 0]);
  const first = await admin.call("jagentchill.captions.transcribe", { audio, language: "en", ...shown.confirmWith, confirmed: true });
  assert.deepEqual([first.text, heard(), charged()], [LINES[0], 1, 0.5]);
  // The approval was for that recording: the same ids do not start it a second time.
  assert.equal((await admin.fail("jagentchill.captions.transcribe", { audio, language: "en", ...shown.confirmWith, confirmed: true })).details.reason, "confirmation_required");
  assert.equal(heard(), 1);
  // 2. The screen names the whole itself: one piece of that length.
  const again = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds, pieces: 1 });
  assert.equal((await admin.call("jagentchill.captions.transcribe", { audio, language: "en", wholeSeconds: seconds, wholePieces: 1, ...again.confirmWith, confirmed: true })).text, LINES[0]);
  // 3. The unconfirmed piece is refused with the SAME question the estimate named (one question on record, not two).
  const third = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds });
  const asked = await admin.fail("jagentchill.captions.transcribe", { audio, language: "en" });
  assert.deepEqual([asked.details.reason, asked.details.confirmWith], ["confirmation_required", third.confirmWith]);
  assert.equal((await admin.call("jagentchill.captions.transcribe", { audio, language: "en", ...asked.details.confirmWith, confirmed: true })).text, LINES[0]);
  assert.deepEqual([heard(), charged()], [3, 1.5]);
});

test("Review 14 #6 / #10 (captions) — the read-back of a recording that does not exist yet is quoted and reserved on the SAME terms: a listener priced by the length of the sound has no price before the sound exists (no reading pace is assumed), so the quote names it as 'price not known' beside the price of the speech — and after that ONE answer the line is spoken and listened to, however long the take came out", async () => {
  const { admin, stub } = await setup();
  const text = "A slow line that takes its time.", sent = () => stub.calls.filter((call) => call.path === "/audio/transcriptions").length, before = sent();
  const estimate = await admin.call("jagentchill.captions.estimate", { kind: "speech", text });
  assert.equal(estimate.amountUsd, null, "no figure is given for a read-back whose length nobody knows");
  const asked = await admin.fail("jagentchill.captions.speak", { text });
  assert.deepEqual([asked.details.reason, asked.details.estimate.unpricedModels, asked.details.estimate.amountUsd], ["confirmation_required", ["openrouter/qwen/qwen3-asr-1.7b"], null]);
  assert.equal(sent(), before);
  const made = await admin.call("jagentchill.captions.speak", { text, confirmed: true, ...asked.details.confirmWith });
  assert.deepEqual([made.check.ok, sent() - before], [true, 1], "one answer: spoken, listened to, kept");
});

test("Ruling R4 — what a person is quoted (printed for the coordinator; the amounts asserted are the ones that follow from the rows): transcribing 60 s, speaking 9 lines, translating 45 captions — at the prices of the rows the product ships, and with the same models priced per token as a provider's list prices them", async (t) => {
  const line = "The harbour is quiet before the boats return.", shown: Record<string, unknown> = {};
  for (const [world, rows] of [
    ["shipped rows (reader $0.01 / 1,000 characters, listener $0.00002 a call)", [["google/gemini-3.8-flash-lite-tts", "tts", { kind: "per_character", perThousandUsd: 0.01 }], ["qwen/qwen3-asr-1.7b", "transcription", { kind: "per_call", usd: 0.00002 }]]],
    ["the same models priced per token, as the provider's list prices them (no documented figure for sound)", [["google/gemini-3.8-flash-lite-tts", "tts", { kind: "tokens", inputPerMillionUsd: 0.5, outputPerMillionUsd: 6 }], ["qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 7.5, outputPerMillionUsd: 0 }]]],
  ] as const) {
    const { admin } = await setup();
    for (const [id, capability, pricing] of rows) await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, capability, pricing, metadata: { audioTokensPerSecond: 0, sources: {} } } });
    const hearing = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds: 60 });
    const speaking = await admin.call("jagentchill.captions.estimate", { kind: "speech", text: line });
    // A translator the admin added, priced per token ($1 in / $2 out a million — TEST DOUBLE prices), first without and then with its documented longest answer (4,000 tokens).
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } });
    await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
    const captions = Array.from({ length: 45 }, () => line);
    const bare = await admin.call("jagentchill.captions.estimate", { kind: "translation", characters: 45 * line.length, lines: 45 });
    // (Ruling R6 replaced R4's bound here: the limit of each request is derived from its own captions and SENT — a documented longest answer only caps it.)
    const bounded = await admin.call("jagentchill.captions.estimate", { kind: "translation", characters: 45 * line.length, lines: 45, texts: captions, targetName: "Vietnamese", source: "en" });
    shown[world] = { "transcribing 60 s": hearing.amountUsd ?? `price not known — ${hearing.model}`, "speaking ONE 45-character line (×9 for nine)": speaking.amountUsd ?? "price not known", "nine such lines": speaking.amountUsd === null ? "price not known" : Math.round(speaking.amountUsd * 9 * 1e6) / 1e6, "translating 45 captions when the screen gives only their count": bare.amountUsd ?? `price not known — ${bare.model}`, "translating THE 45 captions (2 requests; R6: each sends max_tokens = its captions' bytes + the empty answer's)": bounded.amountUsd };
    if (world.startsWith("shipped")) assert.deepEqual([hearing.amountUsd, speaking.amountUsd, bare.amountUsd], [0.00002, Math.round((line.length * 0.00001 + 0.00002) * 1e6) / 1e6, null]);
    else assert.deepEqual([hearing.amountUsd, speaking.amountUsd], [null, null]);
    assert.ok(bounded.amountUsd > 0 && bounded.amountUsd < 2 * 4000 * 2 / 1e6, "two requests, each bounded by its own captions — far under two whole longest answers");
  }
  t.diagnostic(`R4 QUOTES: ${JSON.stringify(shown)}`);
});

test("Review 15 #7 / #13 (ruling R6) — a translation is quoted from its ACTUAL batches and every request SENDS the limit it was quoted with: 45 captions (Vietnamese, Japanese, emoji, quotes) are two requests, each with `max_tokens` = the UTF-8 bytes of its captions + the bytes of the answer's fixed structure; the quote is exactly what those two requests can be billed (their real messages in bytes + their limits), and what is charged stays inside it with ONE question", async (t) => {
  const { admin, stub, h } = await setup();
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  // The double bills a token a character read and writes as many tokens as it is allowed (the worst a provider may do inside the limit).
  stub.bill({ chat: { inputPerToken: 1e-6, outputPerToken: 2e-6, tokensPerCharacter: 1, extraOutputTokens: 100_000 } });
  const kinds = ["Bến cảng yên tĩnh trước khi thuyền về.", "港は船が戻るまで静かだ。", "She said \"wait\" — then 🎉🎉 left\\right.", "The harbour is quiet before the boats return."];
  const texts = Array.from({ length: 45 }, (_, index) => `${kinds[index % kinds.length]} ${index + 1}`), characters = texts.reduce((sum, text) => sum + text.length, 0);
  const quoted = await admin.call("jagentchill.captions.estimate", { kind: "translation", characters, lines: 45, texts, targetName: "Vietnamese", source: "ja" });
  assert.equal(typeof quoted.amountUsd, "number", "priced: the limit comes from the request, no documented figure is needed");
  const whole = { characters, lines: 45 }, said: number[] = [];
  for (const batch of [texts.slice(0, 40), texts.slice(40)]) said.push((await admin.call("jagentchill.captions.translate", { texts: batch, source: "ja", target: "vi", targetName: "Vietnamese", whole, confirmed: true, ...quoted.confirmWith })).translations.length);
  const sent = stub.bodies.map((body) => JSON.parse(body) as { model?: string; max_tokens?: number; messages?: unknown }).filter((body) => body.model === "stub/text-a");
  const bytes = (value: string) => Buffer.byteLength(value, "utf8"), limitOf = (batch: string[]) => batch.reduce((sum, text) => sum + bytes(text), 0) + bytes(JSON.stringify(batch.map(() => "")));
  assert.deepEqual([said, sent.map((body) => body.max_tokens)], [[40, 5], [limitOf(texts.slice(0, 40)), limitOf(texts.slice(40))]], "the limit on the wire: the captions' bytes + the empty answer's bytes");
  // The quote is what THESE requests can be billed: each message as it went out, a token a byte at most, and its own limit.
  const wire = Math.round(sent.reduce((sum, body) => sum + bytes(JSON.stringify(body.messages)) * 1 + body.max_tokens! * 2, 0)) / 1e6;
  const charged = (h.app.db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM gen_charges WHERE model = 'stub/text-a'").get() as { usd: number }).usd;
  assert.equal(quoted.amountUsd, wire);
  assert.ok(charged > 0 && charged <= quoted.amountUsd + 1e-9, `charged ${charged} of ${quoted.amountUsd}`);
  // Without the captions themselves nothing of a per-token translation can be counted: no stand-in text is priced.
  assert.equal((await admin.call("jagentchill.captions.estimate", { kind: "translation", characters, lines: 45 })).amountUsd, null);
  t.diagnostic(`R6 QUOTE, 45 captions (${characters} characters, ${texts.reduce((sum, text) => sum + bytes(text), 0)} bytes) on a translator at $1 in / $2 out a million (TEST DOUBLE prices): $${quoted.amountUsd}; max_tokens sent ${sent.map((body) => body.max_tokens).join(" + ")}; charged $${charged}`);
});

test("Review 15 #13 (ruling R6) — `finish_reason: \"length\"` is read: an answer the limit cut off is never taken for a translation and never 'repaired' — the batch is split in two and each half sent under the same approval (past its amount the person is asked, with what was spent); the halves that fit are not paid twice, and a single caption whose translation does not fit its limit fails as 'cut off'", async () => {
  const { admin, stub, h } = await setup();
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  // The double counts a token for every two bytes it writes and stops at the limit, saying so; a caption marked [wordy] comes back eight times as long.
  stub.bill({ chat: { inputPerToken: 1e-6, outputPerToken: 2e-6, tokensPerCharacter: 1, outputTokensPerByte: 0.5 } });
  const texts = ["The harbour is quiet before the boats return.", "Nobody remembers who painted the blue door.", "Tomorrow the market opens an hour earlier.", "[wordy] The lighthouse keeper counts the ships."];
  const request = { texts, source: "en", target: "vi", targetName: "Vietnamese" };
  let answer: Record<string, unknown> = { confirmed: true }, failure: { code?: string; details?: Record<string, any> } | undefined, questions = 0;
  for (let n = 0; n < 8 && !failure; n++) {
    const failed = await admin.fail("jagentchill.captions.translate", { ...request, ...answer });
    if (failed.details?.reason === "confirmation_required") { questions++; answer = { confirmed: true, ...failed.details.confirmWith }; const action = h.app.generation.gate.action(failed.details.confirmWith.actionId)!; assert.ok(action.spentUsd <= (action.limitUsd ?? 0) + 1e-9, "nothing went out past what was approved"); } else failure = failed;
  }
  const sent = stub.bodies.map((body) => JSON.parse(body) as { model?: string; messages?: { content: string }[] }).filter((body) => body.model === "stub/text-a").map((body) => body.messages![0].content);
  const linesOf = (prompt: string) => (JSON.parse(prompt.split("\n").filter((part) => part.startsWith("[")).pop()!) as string[]).map((text) => texts.indexOf(text));
  assert.equal(failure?.details?.reason, "answer_cut_off", JSON.stringify(failure));
  assert.ok(!sent.some((prompt) => /previous answer was not accepted/.test(prompt)), "a cut-off answer is not 'repaired'");
  assert.deepEqual(sent.map(linesOf), [[0, 1, 2, 3], [0, 1], [2, 3], [2], [3]], "the whole, its halves, the halves of the half that was cut again — each part asked ONCE, also across the money questions");
  assert.ok(questions >= 1, "the split requests are past the amount of the one request that was quoted: the person was asked");
});

test("Review 16 #3 — a translation is ONE question whatever the screen sends: (the reviewer's reproduction) a screen that names only how many characters and captions there are gets NO question that no request could ever answer, and its first batch is asked ONCE about the WHOLE — the host reads the project's own caption track for it — after which both batches go out; an estimate that names the project is the same quote, under the same action, as one that carries the captions; and a project the host has no copy of is asked nothing it cannot hold a request to", async () => {
  const { admin, stub, h } = await setup();
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  stub.bill({ chat: { inputPerToken: 1e-6, outputPerToken: 2e-6, tokensPerCharacter: 1 } });
  const kinds = ["Bến cảng yên tĩnh trước khi thuyền về.", "港は船が戻るまで静かだ。", "The harbour is quiet before the boats return."];
  const texts = Array.from({ length: 45 }, (_, index) => `${kinds[index % kinds.length]} ${index + 1}`), whole = { characters: texts.reduce((sum, text) => sum + text.length, 0), lines: 45 };
  // The project as a device synced it: one caption track (its texts as a person typed them — the screen sends them with their spaces collapsed), and a caption with no words, which no screen sends.
  const document = sampleDocument("p-captions");
  document.scenes[0].tracks.overlay = [{ id: "t-cap", type: "caption", elements: [...texts.map((text, index) => ({ id: `c${index + 1}`, startTime: index * 120_000, duration: 120_000, text: ` ${text.replace(" ", "  ")}\n` })), { id: "c-empty", startTime: 9_000_000, duration: 120_000, text: "   " }] }];
  await support(h).enable(admin, document);
  const sentOf = () => stub.bodies.map((body) => JSON.parse(body) as { model?: string }).filter((body) => body.model === "stub/text-a").length;
  const batches = [texts.slice(0, 40), texts.slice(40)];
  const params = (batch: string[], answer: Record<string, unknown>) => ({ texts: batch, source: "ja", target: "vi", targetName: "Vietnamese", projectId: "p-captions", whole, ...answer });
  // (1) THE REPRODUCTION: the estimate names only counts; then the batches as the screen sends them, with whatever the estimate said to send back.
  const shown = await admin.call("jagentchill.captions.estimate", { kind: "translation", ...whole });
  let questions = shown.confirmWith ? 1 : 0, answer: Record<string, unknown> = shown.confirmWith ? { confirmed: true, ...shown.confirmWith } : {};
  const asked: { amountUsd: number | null; sent: number }[] = [];
  let translated = 0;
  for (const batch of batches) {
    let frame = await admin.raw(TRANSLATE, params(batch, answer));
    // Every refusal with the money question is a question a person sees; it is answered exactly as the screen does (what it named, sent back unchanged).
    for (let round = 0; round < 3 && !frame.ok && frame.error?.details?.reason === "confirmation_required"; round++) {
      questions++; asked.push({ amountUsd: frame.error.details.estimate.amountUsd, sent: sentOf() });
      answer = { confirmed: true, ...frame.error.details.confirmWith };
      frame = await admin.raw(TRANSLATE, params(batch, answer));
    }
    if (!frame.ok) break;
    const made = frame.result;
    translated += (made as { translations: string[] }).translations.length;
  }
  assert.equal(questions, 1, `ONE question for the translation, not ${questions} (${JSON.stringify({ estimate: shown, asked })})`);
  assert.deepEqual([shown.amountUsd, shown.confirmWith, asked.length, asked[0]?.sent, translated, sentOf()], [null, undefined, 1, 0, 45, 2], "counts alone are 'price not known' and no question; the one question came before anything was sent; both batches went out after it");
  // (2) ONE identity: the estimate that names the project (the host reads the track itself) and the one that carries the captions are the same quote of the same action — and it is the amount the first batch was asked about.
  const byProject = await admin.call("jagentchill.captions.estimate", { kind: "translation", ...whole, projectId: "p-captions", trackId: "t-cap", targetName: "Vietnamese", source: "ja" });
  const byTexts = await admin.call("jagentchill.captions.estimate", { kind: "translation", ...whole, texts, targetName: "Vietnamese", source: "ja" });
  assert.equal(typeof byTexts.amountUsd, "number");
  assert.deepEqual([byProject.amountUsd, byProject.confirmWith], [byTexts.amountUsd, byTexts.confirmWith]);
  assert.equal(asked[0].amountUsd, byTexts.amountUsd, "the question of the first batch was the whole's quote");
  // …and answered ONCE it carries both batches of a second run (a new action: the first one ended with its last batch).
  const before = sentOf();
  for (const batch of batches) await admin.call(TRANSLATE, params(batch, { confirmed: true, ...byProject.confirmWith }));
  assert.equal(sentOf() - before, 2);
  // (3) A project the host has no copy of, and no captions given: nothing can be counted — "price not known", and NO question is minted that the batches could not be held to.
  const blind = await admin.call("jagentchill.captions.estimate", { kind: "translation", ...whole, projectId: "p-nowhere", targetName: "Vietnamese", source: "ja" });
  assert.deepEqual([blind.amountUsd, blind.confirmWith], [null, undefined]);
});

test("Final #2 — Auto captions with a listener that has NO price asks ONCE: a recording of three pieces on a transcription model whose price this host cannot state (per token, answer included) is asked about once — 'price not known', the model by name — and that one yes hears all three pieces: every piece after the first is billed and sent with no further question", async () => {
  const { admin, stub } = await twoTranslators([1, 1]);
  stub.listListeners(false);
  // The listener is billed per token on both sides (the state after a refresh of the provider's list): no request of it can be priced beforehand. The double bills each call.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "tokens", inputPerMillionUsd: 7.5, outputPerMillionUsd: 7.5 } } });
  const { samples, rate } = await recording(stub, LINES), pieces = speechPieces(samples, rate), wholeSeconds = pieces.reduce((sum, piece) => sum + (piece.to - piece.from) / rate, 0);
  const heard = () => stub.calls.filter((call) => call.path === "/audio/transcriptions").length;
  const shown = await admin.call("jagentchill.captions.estimate", { kind: "transcription", seconds: wholeSeconds, pieces: pieces.length });
  assert.deepEqual([shown.amountUsd, shown.needsConfirmation, heard()], [null, true, 0], "price not known: asked, by name");
  let questions = 1, answer: Record<string, unknown> = { ...shown.confirmWith, confirmed: true };
  const texts: string[] = [];
  for (const piece of pieces) {
    // As the screen does: a refusal with a question is answered yes and the piece is sent again.
    for (let round = 0; ; round++) {
      try { texts.push((await admin.call("jagentchill.captions.transcribe", { audio: base64(wavOfPcm16(samples.subarray(piece.from, piece.to), rate)), language: "en", wholeSeconds, wholePieces: pieces.length, ...answer })).text); break; } catch (error) {
        const refused = error as { details?: { reason?: string; confirmWith?: Record<string, unknown> } };
        if (refused.details?.reason !== "confirmation_required" || round > 2) throw error;
        questions++; answer = { ...refused.details.confirmWith, confirmed: true };
      }
    }
  }
  assert.deepEqual([questions, texts, heard()], [1, LINES, 3], "ONE question for the whole action");
});
