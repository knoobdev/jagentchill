// The PROVIDER in these tests is a TEST DOUBLE: `scripts/stub-generation.ts`, a local server that speaks OpenRouter's wire
// format and returns files it makes itself. The server's real adapter, queue, budgets, cache, blob store and ffprobe run
// against it. The agent runtimes are the fakes of `harness.ts`. What the real provider answers is checked by the live pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ServerConfigFile } from "../src/store/server-config.ts";
import { afterEach, test } from "node:test";
import { GENERATION_METHOD_SCOPES, generationRpcParams } from "@jagentchill/protocol";
import { startStubGeneration, type StubGeneration } from "../scripts/stub-generation.ts";
import { createHarness, tick, type Harness } from "./harness.ts";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } } });
const KEY = "sk-or-stub-0123456789abcd", IMAGE = { capability: "image", params: { prompt: "a red kite over the sea" } };
type Device = Awaited<ReturnType<Harness["pair"]>>;

/** TEST DOUBLE figures: what the stub provider "documents" for its models, with their source, as an admin records them on a model's row. */
const DOCUMENTED_SOUND = { audioTokensPerSecond: 25, sources: { audioTokensPerSecond: "TEST DOUBLE: the stub provider's documentation" } };
/** A price without the record of where it was taken from (ruling R7: `pricing.source` — asserted by itself where a test is about it). */
const bare = (pricing: any) => { if (!pricing) return pricing; const { source: _source, ...rest } = pricing; return rest; };
const documentedAnswer = (maxOutputTokens: number) => ({ maxOutputTokens, sources: { maxOutputTokens: "TEST DOUBLE: the stub provider's model list" } });
async function setup(connect = true, retryDelaysMs: [number, number] = [30, 60]) {
  const stub: StubGeneration = await startStubGeneration();
  const h = await createHarness({ extra: { generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs, jitter: () => 0, circuitMs: 50 } } } });
  open.push(stub, h);
  const admin = await h.pair("Studio Mac", "admin");
  await admin.call("jagentchill.job.subscribe", {});
  if (connect) {
    await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
    await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 5 } });
    // The stub provider lists its listeners at a price per token. A per-token price of listening needs the provider's documented tokens for a second of sound, recorded with its source (ruling R4) — the admin records the stub's here; the test "Review 14 #10" is about a row WITHOUT it.
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", metadata: DOCUMENTED_SOUND } });
  }
  return { h, admin, stub };
}
async function done(h: Harness, jobId: string) { const job = await h.app.generation.settled(jobId); await tick(5); return job; }
const run = async (h: Harness, device: Device, params: object) => done(h, (await device.yes("jagentchill.generation.create", params as Record<string, unknown>)).job.jobId);
const generationCalls = (stub: StubGeneration) => stub.calls.filter((call) => call.path !== "/key" && call.path !== "/credits");

test("Fresh host; Filter by capability: the provider is listed not connected, video (served since W7) is not configured, and lip-sync has no provider", async () => {
  const { admin } = await setup(false);
  const all = await admin.call("jagentchill.provider.list", {});
  // (W24a: the local picture model is a provider too — not connected until it is downloaded.)
  assert.deepEqual(all.providers.map((p: any) => [p.id, p.connection, p.source]), [["openrouter", "not_connected", "server"], ["local-qwen-image", "not_connected", "local"]]);
  assert.equal(all.capabilities.find((c: any) => c.capability === "video").reason, "No provider is configured for video");
  assert.equal(all.capabilities.find((c: any) => c.capability === "lipsync").reason, "no provider available");
  assert.equal(all.capabilities.find((c: any) => c.capability === "stock-media").available, false);
  assert.equal(all.capabilities.find((c: any) => c.capability === "image").available, false);
  assert.deepEqual((await admin.call("jagentchill.provider.list", { capability: "video" })).providers.map((p: any) => p.id), ["openrouter"]);
  assert.deepEqual((await admin.call("jagentchill.provider.list", { capability: "lipsync" })).providers, []);
  assert.equal((await admin.fail("jagentchill.generation.create", IMAGE)).code, "NO_ROUTE");
});

test("Successful connection; Secret is not in the RPC; Reading a connected provider: only a hint of the key comes back", async () => {
  const { admin, h } = await setup(false);
  assert.ok(!("secret" in generationRpcParams["jagentchill.provider.connect"].shape) && "secretNames" in generationRpcParams["jagentchill.provider.connect"].shape);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  const connected = await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  assert.equal(connected.provider.connection, "connected");
  assert.equal(connected.provider.health, "ready");
  assert.deepEqual(connected.provider.secrets, [{ name: "PROVIDER_OPENROUTER_API_KEY", set: true, last4: "abcd" }]);
  assert.ok(!JSON.stringify(await admin.call("jagentchill.provider.list", {})).includes(KEY));
  assert.ok(!JSON.stringify(h.app.db.prepare("SELECT * FROM audit").all()).includes(KEY));
  // Recommended bundled models are enabled at connect.
  const models = (await admin.call("jagentchill.provider.model.list", { providerId: "openrouter" })).models;
  assert.deepEqual(models.filter((m: any) => m.enabled).map((m: any) => m.id).sort(), ["google/gemini-3.8-flash-lite-tts", "google/lyria-3-clip-preview", "openai/gpt-5-image-mini", "qwen/qwen3-asr-1.7b"]); // the last: the listener that checks a film's takes
  assert.equal((await admin.call("jagentchill.provider.test", { providerId: "openrouter" })).outcome, "ok");
});

test("Refresh adds a new model: the provider's own lists of picture, speech, music and transcription models become catalogue rows, off, with what each takes and costs", async () => {
  const { admin, h, stub } = await setup();
  const rows = async () => Object.fromEntries((await admin.call("jagentchill.provider.model.list", { providerId: "openrouter" })).models.map((m: any) => [m.id, m]));
  let listed = await rows();
  // A picture model: what a request may ask for is in the list, the price of a picture in its endpoint record.
  const image = listed["stub/new-image-model"];
  assert.deepEqual([image.source, image.enabled, image.capability, bare(image.pricing), image.customPrice, typeof image.pricesAsOf], ["fetched", false, "image", { kind: "per_image", baseUsd: 0.02, referenceUsd: 0.002 }, undefined, "string"]);
  assert.deepEqual([image.pricing.source.kind, image.pricing.source.date], ["provider-list", new Date().toISOString().slice(0, 10)], "ruling R7: a price read from the provider's list says so, with the day");
  assert.deepEqual([image.metadata.aspectRatios, image.metadata.maxImages, image.metadata.referenceImages, image.metadata.seed], [["1:1", "16:9"], 2, 3, true]);
  // A price that is not per picture cannot be stated as one: the row has none, and a strict budget treats it as unpriced.
  assert.deepEqual([listed["stub/token-priced-image"].capability, listed["stub/token-priced-image"].pricing, listed["stub/token-priced-image"].metadata.referenceImages], ["image", undefined, 0]);
  // A speech model with its voices, each with the language its name carries; a music model; a listener.
  const voice = listed["stub/locale-voice"];
  assert.deepEqual([voice.capability, voice.enabled, bare(voice.pricing)], ["tts", false, { kind: "per_character", perThousandUsd: 0.015 }]);
  assert.deepEqual(voice.metadata.voices.map((entry: any) => [entry.voiceId, entry.name, entry.languages]), [["en-US-Harper:Stub-Voice", "Harper (en-US)", ["en-US"]], ["vi-VN-Grant:Stub-Voice", "Grant (vi-VN)", ["vi-VN"]], ["vi-VN-Harper:Stub-Voice", "Harper (vi-VN)", ["vi-VN"]], ["de-DE-Klaus:Stub-Voice", "Klaus (de-DE)", ["de-DE"]], ["stub-ama-ja", "stub-ama", ["ja"]]]);
  assert.deepEqual([listed["stub/lyria-long"].capability, listed["stub/lyria-long"].enabled, listed["stub/lyria-long"].pricing], ["music", false, undefined]);
  assert.deepEqual([listed["stub/listener"].capability, listed["stub/listener"].enabled, bare(listed["stub/listener"].pricing)], ["transcription", false, { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 0 }]);
  // The bundled rows stay what the product measured (the list's two voices do not replace the thirty with their genders), and a text model is not a row.
  assert.deepEqual([listed["google/gemini-3.8-flash-lite-tts"].source, listed["google/gemini-3.8-flash-lite-tts"].metadata.voices.length, listed["qwen/qwen3-asr-1.7b"].source, listed["qwen/qwen3-asr-1.7b"].enabled, "stub/text-only" in listed], ["bundled", 30, "bundled", true, false]);
  // Listeners are rows of the catalogue, not something a job can be asked for.
  assert.equal((await admin.call("jagentchill.provider.list", {})).capabilities.find((c: any) => c.capability === "transcription").available, false);
  assert.equal((await admin.fail("jagentchill.generation.create", { capability: "transcription", params: { prompt: "x" } })).code, "NO_ROUTE");
  // A person turns a fetched model on and uses it within what the list said it takes; a second refresh adds nothing and keeps the switch.
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/new-image-model", "stub/locale-voice"], enabled: true });
  const first = (await run(h, admin, IMAGE)).results[0].blobId;
  assert.equal((await admin.fail("jagentchill.generation.create", { capability: "image", provider: "openrouter", model: "stub/new-image-model", params: { prompt: "x", aspectRatio: "3:2" } })).code, "INVALID_PARAMS");
  const job = await run(h, admin, { capability: "image", provider: "openrouter", model: "stub/new-image-model", params: { prompt: "a kite like this one", aspectRatio: "16:9", referenceBlobIds: [first] }, consent: "once" });
  assert.deepEqual([job.state, job.estimateUsd, stub.calls.at(-1)!.model, stub.calls.at(-1)!.references], ["succeeded", 0.022, "stub/new-image-model", 1]);
  assert.deepEqual((await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" })).added, 0);
  listed = await rows();
  assert.deepEqual([listed["stub/new-image-model"].enabled, listed["stub/new-image-model"].metadata.referenceImages], [true, 3]);
  // The voices of a language: Vietnamese text is read by the vi-VN voices and by the voices that read any language.
  const vietnamese = (await admin.call("jagentchill.provider.voice.list", { language: "vi" })).voices.map((entry: any) => entry.voiceId);
  assert.deepEqual([vietnamese.filter((id: string) => id.includes("Stub-Voice")), vietnamese.includes("Kore"), vietnamese.includes("stub-ama-ja")], [["vi-VN-Grant:Stub-Voice", "vi-VN-Harper:Stub-Voice"], true, false]);
});

test("Wrong key; Valid key without credit; Short key; Device without the scopes", async () => {
  const { admin, h } = await setup(false);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-bad-0123456789");
  const refused = await admin.fail("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  assert.deepEqual([refused.message, refused.details.outcome, refused.details.statusCode], ["The provider rejected this API key", "invalid_key", 401]);
  assert.equal(h.app.secrets.has("PROVIDER_OPENROUTER_API_KEY"), false);
  assert.equal((await admin.call("jagentchill.provider.list", {})).providers[0].connection, "not_connected");
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "nocredit-1");
  const poor = await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  assert.deepEqual([poor.provider.connection, poor.provider.health, poor.provider.healthReason], ["connected", "degraded", "The key is valid but the account has no credit"]);
  assert.deepEqual(poor.provider.secrets, [{ name: "PROVIDER_OPENROUTER_API_KEY", set: true }]);
  const editor = await h.pair("Tablet", "editor");
  assert.equal((await editor.fail("jagentchill.provider.connect", { providerId: "openrouter", secretNames: [] })).code, "SCOPE_DENIED");
  assert.equal((await editor.fail("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 9 } })).code, "SCOPE_DENIED");
});

test("Replace with a bad key: the old key remains in use; Disconnect deletes the key", async () => {
  const { admin, h } = await setup();
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY_NEW", "sk-or-bad-999999999");
  assert.equal((await admin.fail("jagentchill.provider.key.replace", { providerId: "openrouter", secretName: "PROVIDER_OPENROUTER_API_KEY_NEW" })).details.outcome, "invalid_key");
  assert.equal(h.app.secrets.read("PROVIDER_OPENROUTER_API_KEY"), KEY);
  assert.equal((await run(h, admin, IMAGE)).state, "succeeded");
  assert.equal((await admin.call("jagentchill.provider.disconnect", { providerId: "openrouter" })).provider.connection, "not_connected");
  assert.equal(h.app.secrets.has("PROVIDER_OPENROUTER_API_KEY"), false);
});

test("Batch estimate; Custom price; Unknown pricing; Tiered price", async () => {
  const { admin } = await setup();
  const model = { id: "openai/gpt-5-image-mini", capability: "image" };
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { ...model, pricing: { kind: "per_image", baseUsd: 0.04 } } });
  const batch = await admin.call("jagentchill.provider.estimate", { items: Array.from({ length: 12 }, () => IMAGE) });
  assert.deepEqual([batch.totalUsd, batch.items[0].confidence, batch.excludesUnknown], [0.48, "exact", false]);
  assert.equal((await admin.call("jagentchill.provider.model.list", { providerId: "openrouter" })).models.find((m: any) => m.id === model.id).customPrice, true);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { ...model, pricing: null } });
  const unknown = await admin.call("jagentchill.provider.estimate", { items: [IMAGE] });
  assert.deepEqual([unknown.items[0].amountUsd, unknown.items[0].confidence, unknown.excludesUnknown], [null, "unknown", true]);
  await admin.call("jagentchill.provider.model.reset", { providerId: "openrouter", modelId: model.id });
  assert.equal((await admin.call("jagentchill.provider.estimate", { items: [IMAGE] })).items[0].confidence, "approximate");
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/lyria-3-clip-preview", capability: "music", pricing: { kind: "per_second", usd: 0.05, tiers: [{ when: { instrumental: true }, usd: 0.1 }] } } });
  assert.equal((await admin.call("jagentchill.provider.estimate", { items: [{ capability: "music", params: { prompt: "calm piano", durationSeconds: 30, instrumental: true } }] })).totalUsd, 3);
});

test("Result is stored locally; Progress updates: an image job runs to a blob with provenance, a ledger row and job events", async () => {
  const { admin, h } = await setup();
  const job = await run(h, admin, { ...IMAGE, params: { ...IMAGE.params, aspectRatio: "3:2" }, projectId: "p1" });
  assert.deepEqual([job.state, job.progress, job.kind, job.results.length, job.actualUsd, job.cacheHit], ["succeeded", 1, "generation.image", 1, 0.011, false]);
  const asset = job.results[0];
  assert.deepEqual([asset.kind, asset.mime, asset.width, asset.height], ["image", "image/png", 48, 48]);
  assert.deepEqual([asset.provenance.source, asset.provenance.provider, asset.provenance.model, asset.provenance.role, asset.provenance.jobId, asset.provenance.prompt], ["ai", "openrouter", "openai/gpt-5-image-mini", "image", job.jobId, IMAGE.params.prompt]);
  assert.ok(existsSync(h.app.sync.blobs.locate(asset.blobId).path));
  const states = admin.events.filter((e) => e.event === "jagentchill.job.updated" && e.payload.job.jobId === job.jobId).map((e) => e.payload.job.state);
  assert.deepEqual([states[0], states.at(-1), states.includes("running")], ["queued", "succeeded", true]);
  const rows = h.app.generation.ledgerRows({ projectId: "p1" });
  assert.deepEqual(rows.map((r) => [r.outcome, r.actual_usd, r.price_source, r.cache_hit]), [["succeeded", 0.011, "provider", 0]]);
  assert.ok(!JSON.stringify(rows).includes("red kite"));
  assert.equal((await admin.call("jagentchill.job.get", { jobId: job.jobId })).job.state, "succeeded");
  assert.equal((await admin.call("jagentchill.job.list", { projectId: "p1", state: "succeeded" })).jobs.length, 1);
});

test("Speech and music jobs give audio assets with their duration", async () => {
  const { admin, h } = await setup();
  const speech = await run(h, admin, { capability: "tts", params: { text: "Hello from the editor, this is a line.", voice: "Kore" } });
  assert.deepEqual([speech.state, speech.results[0].kind, speech.results[0].mime, speech.results[0].durationSeconds! > 1], ["succeeded", "audio", "audio/wav", true]);
  const music = await run(h, admin, { capability: "music", params: { prompt: "calm piano", instrumental: true } });
  assert.deepEqual([music.state, music.results[0].kind, music.results[0].durationSeconds, music.actualUsd], ["succeeded", "audio", 3, 0.04]);
  assert.equal((await admin.fail("jagentchill.generation.create", { capability: "tts", params: { text: "hi", voice: "nobody" } })).code, "INVALID_PARAMS");
  assert.deepEqual((await admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "x", aspectRatio: "7:1" } })).details.allowed.includes("3:2"), true);
  assert.ok((await admin.call("jagentchill.provider.voice.list", {})).voices.some((v: any) => v.voiceId === "Kore" && v.model === "google/gemini-3.8-flash-lite-tts"));
});

test("Corrupt output: the job fails with invalid_output after one retry and no asset is created — and a billed answer that cannot be kept still counts: what the provider charged for each attempt is in the ledger, in the budgets and in the job, and a person's approval is not passed by the retry", async () => {
  const { admin, h, stub } = await setup();
  // The double bills $0.011 for every picture request it answers — also for an answer that is not a picture.
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [corrupt]" }, projectId: "p-corrupt" });
  assert.deepEqual([job.state, job.error!.class, job.results.length, job.attempts.length], ["failed", "invalid_output", 0, 2]);
  assert.equal(generationCalls(stub).length, 2);
  const rows = h.app.generation.ledgerRows({ projectId: "p-corrupt" }).map((row) => [row.outcome, row.actual_usd, row.price_source]);
  assert.deepEqual([rows, job.actualUsd], [[["failed", 0.011, "provider"], ["failed", 0.011, "provider"]], 0.022], "both answers were billed: the ledger and the job say so");
  // The budgets count it: the job's reservation was not given back, it became what was spent.
  assert.deepEqual(h.app.db.prepare("SELECT amount_usd FROM budget_commits").all().map((row: any) => row.amount_usd), [0.022]);
  // A person who approved the estimate approved one request at that price: the billed first answer counts against it, so the retry is not sent — the job stops with the money question instead of spending twice what was approved.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const asked = await admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "boat [corrupt]" }, projectId: "p-held" });
  const quoted: number = asked.details.estimate.amountUsd;
  stub.bill({ image: quoted });
  const held = await done(h, (await admin.call("jagentchill.generation.create", { capability: "image", params: { prompt: "boat [corrupt]" }, projectId: "p-held", ...asked.details.confirmWith, confirmed: true })).job.jobId);
  assert.deepEqual([held.state, held.error!.class, held.error!.details!.reason, held.error!.details!.spentUsd, held.actualUsd, generationCalls(stub).length], ["failed", "budget_exceeded", "confirmation_required", quoted, quoted, 3], "one request at the approved price was sent and billed; the retry would have doubled it and was not sent");
});

test("Review 11 #5 — billing is recorded before the adapter validates the answer: the provider answers `data: []` with `usage.cost` — no picture, and a bill — the request is refused as an unreadable answer, and what it was billed is in the ledger, the job, the budgets and the gate's charges all the same (two requests, two bills — not $0)", async () => {
  const { admin, h, stub } = await setup();
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [empty]" }, projectId: "p-empty" });
  assert.deepEqual([job.state, job.error!.class, generationCalls(stub).length], ["failed", "invalid_output", 2]);
  assert.deepEqual([h.app.generation.ledgerRows({ projectId: "p-empty" }).map((row) => row.actual_usd), job.actualUsd, h.app.generation.gate.chargedFor(job.jobId), h.app.db.prepare("SELECT amount_usd FROM budget_commits").all().map((row: any) => row.amount_usd)], [[0.011, 0.011], 0.022, 0.022, [0.022]]);
});

test("Review 12 #5 — a stream chunk that carries an error AND the bill: the provider fails a music request in the very chunk that says it cost $0.04 — the request fails, and the $0.04 is in the gate's charges, the ledger, the job and the budgets (not $0)", async () => {
  const { admin, h, stub } = await setup();
  const job = await run(h, admin, { capability: "music", params: { prompt: "calm piano [error+bill:400]" }, projectId: "p-billed-error" });
  assert.deepEqual([job.state, generationCalls(stub).length], ["failed", 1]);
  assert.deepEqual([h.app.generation.gate.chargedFor(job.jobId), job.actualUsd, h.app.generation.ledgerRows({ projectId: "p-billed-error" }).map((row) => row.actual_usd), h.app.db.prepare("SELECT amount_usd FROM budget_commits").all().map((row: any) => row.amount_usd)], [0.04, 0.04, [0.04], [0.04]]);
});

test("Review 13 #5 — an HTTP answer that is not a success AND carries the bill: the provider answers 502 with `usage.cost` in its body — every such request is on record with what it was billed (the gate's charges, the ledger, the job, the budgets), not $0", async () => {
  const { admin, h, stub } = await setup();
  stub.bill({ image: 1 });
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [http+bill:502]" }, projectId: "p-billed-http" });
  const sent = generationCalls(stub).length;
  assert.ok(job.state === "failed" && sent >= 1, `${job.state}, ${sent} requests`);
  assert.deepEqual([h.app.generation.gate.chargedFor(job.jobId), job.actualUsd, h.app.generation.ledgerRows({ projectId: "p-billed-http" }).reduce((sum, row) => sum + Number(row.actual_usd ?? 0), 0), (h.app.db.prepare("SELECT amount_usd FROM budget_commits").all() as { amount_usd: number }[]).reduce((sum, row) => sum + row.amount_usd, 0)], [sent, sent, sent, sent]);
});

test("A retry is asked about like the job was: retrying a failed job shows the estimate of NOW and starts nothing until a person answers that question — no confirmation is given on their behalf, and an answer to the question of the job that failed is not an answer to this one", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const request = { capability: "image", params: { prompt: "kite [fail-once:400]" } };
  const first = await admin.fail("jagentchill.generation.create", request), was: number = first.details.estimate.amountUsd;
  const failed = await done(h, (await admin.call("jagentchill.generation.create", { ...request, ...first.details.confirmWith, confirmed: true })).job.jobId);
  assert.deepEqual([failed.state, generationCalls(stub).length], ["failed", 1]);
  // The price went up since the job was confirmed.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: failed.model, capability: "image", pricing: { kind: "per_image", baseUsd: was * 3 } } });
  const asked = await admin.fail("jagentchill.job.retry", { jobId: failed.jobId });
  assert.deepEqual([asked.code, asked.details.reason, asked.details.estimate.amountUsd, generationCalls(stub).length], ["PERMISSION_DENIED", "confirmation_required", Math.round(was * 3 * 1e6) / 1e6, 1], "the retry shows what it costs now, and sends nothing");
  // The answer the person gave for the job that failed (its action, its quote) approves nothing here.
  assert.deepEqual([(await admin.fail("jagentchill.job.retry", { jobId: failed.jobId, ...first.details.confirmWith, confirmed: true })).details.reason, generationCalls(stub).length], ["confirmation_required", 1]);
  const retried = await done(h, (await admin.call("jagentchill.job.retry", { jobId: failed.jobId, ...asked.details.confirmWith, confirmed: true })).job.jobId);
  assert.deepEqual([retried.state, generationCalls(stub).length], ["succeeded", 2]);
});

test("Three attempts then fallback; No wait after the last candidate: a server error is tried three times and then fails with its attempts", async () => {
  const { admin, h, stub } = await setup();
  const recovered = await run(h, admin, { capability: "image", params: { prompt: "kite [fail-once:502]" } });
  assert.deepEqual([recovered.state, recovered.attempts.length], ["succeeded", 2]);
  stub.calls.length = 0;
  h.app.db.prepare("DELETE FROM gen_ledger").run();
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [fail:500]" } });
  assert.deepEqual([job.state, job.error!.class, job.error!.retryable, job.attempts.length, (job.error!.details!.attempts as unknown[]).length], ["failed", "server_error", true, 3, 3]);
  assert.equal(generationCalls(stub).length, 3);
  assert.ok(job.attempts[1].started_ms - job.attempts[0].started_ms >= 25 && job.attempts[2].started_ms - job.attempts[1].started_ms >= 55);
  assert.deepEqual(h.app.generation.ledgerRows().map((r) => r.outcome), ["failed", "failed", "failed"]);
});

test("Authentication error skips retries; Content block ends the job; Blocked prompt; Unknown error; Provider echoes the key in an error", async () => {
  const { admin, h } = await setup();
  const auth = await run(h, admin, { capability: "image", params: { prompt: "kite [fail:401]" } });
  assert.deepEqual([auth.error!.class, auth.attempts.length, auth.error!.action], ["auth_error", 1, "Open provider settings"]);
  assert.ok(!JSON.stringify(auth).includes(KEY) && String(auth.error!.details!.providerMessage).includes("[redacted]"));
  assert.equal((await admin.call("jagentchill.provider.list", {})).providers[0].health, "unauthorized");
  const blocked = await run(h, admin, { capability: "image", params: { prompt: "kite [blocked]" } });
  assert.deepEqual([blocked.error!.class, blocked.attempts.length, blocked.error!.details!.stage, blocked.error!.details!.categories], ["content_blocked", 1, "input", ["violence"]]);
  assert.equal(blocked.error!.message, "The provider blocked this request under its content policy (violence)");
  const odd = await run(h, admin, { capability: "image", params: { prompt: "kite [fail:418]" } });
  assert.deepEqual([odd.error!.class, odd.attempts.length, odd.error!.details!.statusCode], ["unknown", 2, 418]);
});

test("Retry time from the provider; Provider rate limit: the provider's retry time replaces the delay", async () => {
  const { admin, h } = await setup();
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [rate:1]" } });
  assert.deepEqual([job.state, job.attempts.length, job.attempts[0].errorClass], ["succeeded", 2, "rate_limited"]);
  assert.ok(job.attempts[1].started_ms - job.attempts[0].started_ms >= 1000);
  assert.ok(admin.events.some((e) => e.event === "jagentchill.job.updated" && e.payload.job.status === "Waiting for provider rate limit"));
});

test("Circuit opens; Recovery: three failures in a row set the provider down, a later success makes it ready", async () => {
  const { admin, h } = await setup();
  await run(h, admin, { capability: "image", params: { prompt: "kite [fail:500]" } });
  assert.equal((await admin.call("jagentchill.provider.list", {})).providers[0].health, "down");
  const held = await run(h, admin, IMAGE);
  assert.deepEqual([held.state, held.attempts[0].errorClass], ["succeeded", "model_unavailable"]);
  assert.equal((await admin.call("jagentchill.provider.list", {})).providers[0].health, "ready");
});

test("Hard stop; Reservation released on failure; Concurrent requests cannot overspend; Unpriced model refused; Unpriced model allowed", async () => {
  const { admin, h, stub } = await setup();
  const price = (usd: number | null) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: usd === null ? null : { kind: "per_image", baseUsd: usd } } });
  const budget = (extra: object = {}) => admin.call("jagentchill.provider.budget.set", { budget: { scope: "project", scopeId: "p1", limitUsd: 10, period: "total", hardStop: true, ...extra } });
  await budget();
  h.app.db.prepare("INSERT INTO budget_commits (ref, project_id, amount_usd, ts_ms) VALUES ('earlier', 'p1', 9.6, ?)").run(Date.now());
  await price(0.9);
  const before = generationCalls(stub).length;
  const stopped = await admin.fail("jagentchill.generation.create", { ...IMAGE, projectId: "p1" });
  assert.deepEqual([stopped.code, stopped.details.scope, stopped.details.scopeId, stopped.details.remainingUsd], ["BUDGET_EXCEEDED", "project", "p1", 0.4]);
  assert.equal(generationCalls(stub).length, before);
  assert.equal((await admin.call("jagentchill.provider.estimate", { items: [{ ...IMAGE }] })).items[0].blocked, undefined);
  // Two requests of 0.30 with 0.40 left: exactly one is accepted.
  await price(0.3);
  const slow = { capability: "image", params: { prompt: "kite [slow:150]" }, projectId: "p1" };
  const both = await Promise.allSettled([admin.call("jagentchill.generation.create", slow), admin.call("jagentchill.generation.create", slow)]);
  assert.deepEqual(both.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
  assert.match(String((both.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult).reason), /BUDGET_EXCEEDED/);
  await done(h, (both.find((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<any>).value.job.jobId);
  // A failed request gives its reservation back.
  h.app.db.prepare("DELETE FROM budget_commits WHERE ref LIKE 'gen:%'").run();
  const failed = await run(h, admin, { capability: "image", params: { prompt: "kite [fail:400]" }, projectId: "p1" });
  assert.equal(failed.state, "failed");
  assert.equal((h.app.db.prepare("SELECT COUNT(*) AS n FROM budget_commits WHERE ref LIKE 'gen:%'").get() as { n: number }).n, 0);
  await price(null);
  const unpriced = await admin.fail("jagentchill.generation.create", { ...IMAGE, projectId: "p1", confirmed: true });
  assert.deepEqual([unpriced.code, unpriced.details.reason], ["BUDGET_EXCEEDED", "unpriced_model"]);
  await budget({ allowUnknownCost: true });
  assert.equal((await run(h, admin, { ...IMAGE, projectId: "p1", confirmed: true })).state, "succeeded");
});

test("Stochastic request without a seed; Cache hit; Re-run with unchanged inputs; Regenerate bypasses the cache", async () => {
  const { admin, h, stub } = await setup();
  await run(h, admin, IMAGE);
  await run(h, admin, IMAGE);
  assert.equal(generationCalls(stub).length, 2);
  const again = await run(h, admin, { ...IMAGE, reuse: true });
  assert.equal(again.cacheHit, false);
  const reused = await run(h, admin, { ...IMAGE, reuse: true });
  assert.deepEqual([reused.cacheHit, reused.actualUsd, reused.results[0].blobId, reused.results[0].provenance.jobId], [true, 0, again.results[0].blobId, reused.jobId]);
  const speech = { capability: "tts", params: { text: "The same line twice.", voice: "Leda" } };
  const first = await run(h, admin, speech), second = await run(h, admin, speech), calls = generationCalls(stub).length;
  assert.deepEqual([first.cacheHit, second.cacheHit, second.results[0].blobId], [false, true, first.results[0].blobId]);
  assert.deepEqual(h.app.generation.ledgerRows().filter((r) => r.job_id === second.jobId).map((r) => [r.cache_hit, r.actual_usd]), [[1, 0]]);
  const regenerated = await run(h, admin, { ...speech, cache: "bypass" });
  assert.deepEqual([regenerated.cacheHit, generationCalls(stub).length], [false, calls + 1]);
  const cache = await admin.call("jagentchill.provider.cache.get", {});
  assert.ok(cache.entries === 2 && cache.bytes > 0 && cache.limitBytes === 20 * 1024 ** 3);
  assert.equal((await admin.call("jagentchill.provider.cache.clear", {})).entries, 0);
  assert.equal((await run(h, admin, speech)).cacheHit, false);
});

test("Concurrency limit; Cancel a queued job; Non-cancellable builtin job: queued jobs wait, a cancelled one makes no provider call", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.update", { providerId: "openrouter", limits: { maxConcurrent: { image: 2 } } });
  assert.equal((await admin.fail("jagentchill.provider.update", { providerId: "openrouter", limits: { maxConcurrent: { image: 65 } } })).code, "INVALID_PARAMS");
  const jobs = [];
  for (let n = 0; n < 6; n++) jobs.push((await admin.call("jagentchill.generation.create", { capability: "image", params: { prompt: `kite ${n} [slow:120]` }, projectId: "p9" })).job);
  await tick(30);
  const now = (await admin.call("jagentchill.job.list", { projectId: "p9" })).jobs;
  assert.deepEqual([now.filter((j: any) => j.state === "running").length, now.filter((j: any) => j.state === "queued").length], [2, 4]);
  assert.deepEqual(now.filter((j: any) => j.state === "queued").map((j: any) => j.queuePosition).sort(), [1, 2, 3, 4]);
  const queued = (await admin.call("jagentchill.job.cancel", { jobId: jobs[5].jobId })).job;
  assert.deepEqual([queued.state, queued.error.class], ["cancelled", "cancelled"]);
  const running = (await admin.call("jagentchill.job.cancel", { jobId: jobs[0].jobId })).job;
  assert.deepEqual([running.state, running.warnings], ["cancelled", ["The provider can still bill this request"]]);
  for (const job of jobs.slice(1, 5)) assert.equal((await done(h, job.jobId)).state, "succeeded");
  assert.ok(!stub.calls.some((call) => call.text.includes("kite 5")));
  assert.equal((h.app.db.prepare("SELECT COUNT(*) AS n FROM budget_commits WHERE ref IN (?, ?)").get(`gen:${jobs[0].jobId}`, `gen:${jobs[5].jobId}`) as { n: number }).n, 0);
  const retried = (await admin.call("jagentchill.job.retry", { jobId: jobs[5].jobId })).job;
  assert.equal((await done(h, retried.jobId)).state, "succeeded");
});

test("Reference pictures: an image request carries the pictures it names to the provider, within what its model takes; nothing is asked — pictures generation made and a person's own picture alike go to the connected provider with the request that names them", async () => {
  const { admin, h, stub } = await setup();
  const first = (await run(h, admin, IMAGE)).results[0].blobId, second = (await run(h, admin, { capability: "image", params: { prompt: "a green kite" } })).results[0].blobId;
  const withReferences = { capability: "image", params: { prompt: "the two kites together", referenceBlobIds: [first, second] } };
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, [], "the host holds no stored consent at all");
  const job = await run(h, admin, withReferences);
  assert.equal(job.state, "succeeded", JSON.stringify(job.error));
  assert.deepEqual(stub.calls.filter((call) => call.path === "/images").map((call) => call.references), [0, 0, 2]);
  assert.deepEqual(job.results[0].provenance.referenceAssetIds, [first, second]);
  // A person's OWN picture (a file generation did not make) is sent the same way: starting the request is the instruction.
  const own = h.app.sync.blobs.put(photoWithGps(320, 240), { mime: "image/jpeg", name: "mine.jpg", purpose: "media" }).sha256, mixed = { capability: "image", params: { prompt: "my kite beside the others", referenceBlobIds: [first, own] } };
  const mine = await run(h, admin, mixed);
  assert.equal(mine.state, "succeeded", JSON.stringify(mine.error));
  assert.deepEqual(stub.calls.filter((call) => call.path === "/images").map((call) => call.references), [0, 0, 2, 2]);
  // The parameter screens used to send is still taken, and decides nothing.
  assert.equal((await run(h, admin, { ...mixed, consent: "once", cache: "bypass" })).state, "succeeded");
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, []);
  // Each reference adds to the estimate; a model that takes none refuses them before anything is sent; so does a file that is not on the host.
  const priced = await admin.call("jagentchill.provider.estimate", { items: [IMAGE, withReferences] });
  assert.deepEqual(priced.items.map((item: any) => item.amountUsd), [0.034, 0.042]);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", metadata: { referenceImages: 1 } } });
  const many = await admin.fail("jagentchill.generation.create", withReferences);
  assert.deepEqual([many.code, many.details.field, many.details.allowed], ["INVALID_PARAMS", "params.referenceBlobIds", { max: 1 }]);
  const gone = await admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "x", referenceBlobIds: ["0".repeat(64)] } });
  assert.deepEqual([gone.code, gone.details.field], ["INVALID_PARAMS", "params.referenceBlobIds"]);
  assert.equal(stub.calls.filter((call) => call.path === "/images").length, 5, "nothing was sent for the refused requests");
});

/** A real photograph-like JPEG of the given size, carrying an EXIF block with a GPS position, as a camera writes one. */
function photoWithGps(width: number, height: number): Buffer {
  const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}`, "-frames:v", "1", "-q:v", "2", "-f", "mjpeg", "pipe:1"], { maxBuffer: 64 * 1_048_576 });
  assert.equal(made.status, 0, "ffmpeg is needed by this test");
  const exif = Buffer.concat([Buffer.from("Exif\0\0MM\0*\0\0\0\x08", "latin1"), Buffer.from("GPSLatitude 10.7626N GPSLongitude 106.6602E", "latin1")]), head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0); head.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([made.stdout.subarray(0, 2), head, exif, made.stdout.subarray(2)]);
}
/** Width and height of a JPEG, from its frame header. */
function jpegSize(file: Uint8Array): [number, number] {
  const bytes = Buffer.from(file);
  for (let at = 2; at + 9 < bytes.length;) { const marker = bytes[at + 1], length = bytes.readUInt16BE(at + 2); if (marker >= 0xc0 && marker <= 0xc2) return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)]; at += 2 + length; }
  return [0, 0];
}
test("Refresh keeps every price the provider lists and updates the rows the product ships: each quality at its own price and never the cheapest for all, no stated price when the variants cannot be matched, and a shipped row follows the list beneath a person's edits while what was measured stays", async () => {
  const { admin } = await setup();
  const rows = async () => Object.fromEntries((await admin.call("jagentchill.provider.model.list", { providerId: "openrouter" })).models.map((m: any) => [m.id, m]));
  let listed = await rows();
  // Two variants by quality: both are kept; a request that names no quality is priced at the dearer one.
  assert.deepEqual(bare(listed["stub/tiered-image"].pricing), { kind: "per_image", baseUsd: 0.034, tiers: [{ when: { quality: "low" }, usd: 0.003 }, { when: { quality: "high" }, usd: 0.034 }], approximate: true });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/tiered-image"], enabled: true });
  const item = (quality?: string) => ({ capability: "image", provider: "openrouter", model: "stub/tiered-image", params: { prompt: "a kite", ...(quality ? { quality } : {}) } });
  assert.deepEqual((await admin.call("jagentchill.provider.estimate", { items: [item("high"), item("low"), item()] })).items.map((entry: any) => entry.amountUsd), [0.034, 0.003, 0.034]);
  // Variants a request cannot name (a size): the cost is unknown, not the smallest number of the list.
  assert.equal(listed["stub/sized-image"].pricing, undefined);
  // A row the product ships: the list's price and limits are taken (the reference cap still holds) …
  const shipped = listed["google/gemini-3.1-flash-lite-image"];
  assert.deepEqual([shipped.source, bare(shipped.pricing), shipped.metadata.aspectRatios, shipped.metadata.maxImages, shipped.metadata.referenceImages, shipped.edited], ["bundled", { kind: "per_image", baseUsd: 0.025, referenceUsd: 0.001 }, ["1:1", "16:9", "9:16", "21:9"], 2, 5, undefined]);
  // … what was measured on the real provider is not replaced by the list (which says 16 references and has no per-picture price) …
  const measured = listed["openai/gpt-5-image-mini"];
  assert.deepEqual([measured.metadata.referenceImages, measured.metadata.aspectRatios, measured.pricing.baseUsd, measured.pricing.referenceUsd], [5, ["1:1", "3:2", "2:3"], 0.034, 0.004]);
  // … and a person's edit lies over the list, also after the next refresh.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.1-flash-lite-image", capability: "image", metadata: { maxImages: 1 } } });
  await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" });
  listed = await rows();
  const edited = listed["google/gemini-3.1-flash-lite-image"];
  assert.deepEqual([edited.metadata.maxImages, edited.metadata.aspectRatios.length, edited.pricing.baseUsd, edited.edited], [1, 4, 0.025, true]);
});

test("Reference pictures leave the host small and bare: a 1536 px photo with a GPS block is sent as a JPEG of at most 768 px with no EXIF, and one over the size limit is refused before it is read", async () => {
  const { admin, h, stub } = await setup();
  const photo = photoWithGps(1536, 1024);
  assert.ok(photo.includes("GPSLatitude 10.7626N"), "the file on the host carries the position");
  const stored = h.app.sync.blobs.put(photo, { mime: "image/jpeg", name: "sheet.jpg", purpose: "media" });
  const job = await run(h, admin, { capability: "image", params: { prompt: "the same person at the market", referenceBlobIds: [stored.sha256] }, consent: "once" });
  assert.equal(job.state, "succeeded", JSON.stringify(job.error));
  const call = stub.calls.filter((entry) => entry.path === "/images").at(-1)!, sent = call.referenceFiles![0];
  assert.deepEqual([sent.kind, sent.exif], ["jpeg", false]);
  assert.ok(!stub.bodies.at(-1)!.includes(Buffer.from("GPSLatitude 10.7626N").toString("base64").slice(0, 16)), "the position is not in the request");
  const small = await h.app.generation.smallPicture(stored.sha256);
  assert.deepEqual(jpegSize(small!), [768, 512]);
  // Measured: the request with the file as it is would be over a third larger than the photo; it is a fraction of it.
  const before = Math.ceil(photo.length / 3) * 4;
  console.log(`reference request size: ${before} bytes of base64 as stored (${photo.length} bytes, 1536x1024) -> ${call.bodyBytes} bytes sent (${sent.bytes} bytes, 768x512)`);
  assert.ok(sent.bytes < photo.length / 2 && call.bodyBytes! < before / 2, `${call.bodyBytes} of ${before}`);
  // A file above the limit is refused from the store's record: nothing is read, nothing is sent.
  const huge = Buffer.alloc(21 * 1_048_576, 7);
  photo.copy(huge, 0, 0, 64);
  const big = h.app.sync.blobs.put(huge, { mime: "image/jpeg", name: "huge.jpg", purpose: "media" });
  const requests = stub.calls.length;
  const refused = await admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "x", referenceBlobIds: [big.sha256] }, consent: "once" });
  assert.deepEqual([refused.code, refused.details.field, refused.details.max], ["INVALID_PARAMS", "params.referenceBlobIds", 20 * 1_048_576]);
  assert.equal(stub.calls.length, requests);
});

test("At most five reference pictures, whatever a model row says: a row edited to take 16 still takes five, and a direct request with six is refused before anything is sent", async () => {
  const { admin, h, stub } = await setup();
  const blobs: string[] = [];
  for (const colour of ["red", "green", "blue", "grey", "pink", "black"]) blobs.push((await run(h, admin, { capability: "image", params: { prompt: `a ${colour} kite` } })).results[0].blobId);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", metadata: { referenceImages: 16 } } });
  const rows = (await admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "image" })).models;
  assert.ok(rows.length > 0 && rows.every((row: any) => (row.metadata.referenceImages ?? 0) <= 5), JSON.stringify(rows.map((row: any) => [row.id, row.metadata.referenceImages])));
  const six = await admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "six kites", referenceBlobIds: blobs }, consent: "once" });
  assert.deepEqual([six.code, six.details.field, six.details.allowed], ["INVALID_PARAMS", "params.referenceBlobIds", { max: 5 }]);
  // The provider's own list says 16 for the model it lists: the refreshed row takes five too.
  await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" });
  const listed = (await admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "image" })).models;
  assert.ok(listed.some((row: any) => row.source === "fetched") && listed.every((row: any) => (row.metadata.referenceImages ?? 0) <= 5), JSON.stringify(listed.map((row: any) => [row.id, row.source, row.metadata.referenceImages])));
  const five = await run(h, admin, { capability: "image", params: { prompt: "five kites", referenceBlobIds: blobs.slice(0, 5) }, consent: "once" });
  assert.equal(five.state, "succeeded", JSON.stringify(five.error));
  assert.equal(Math.max(...stub.calls.filter((call) => call.path === "/images").map((call) => call.references ?? 0)), 5);
});

test("No question about what is sent: project content goes to a connected provider with the request a person started, and the provider's description says once what each kind of work sends", async () => {
  const { admin, h, stub } = await setup();
  const caption = { capability: "tts", params: { text: "A caption from the timeline." }, contentKinds: ["transcript"] };
  // No stored consent, no "once": the request is made.
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, []);
  assert.equal((await run(h, admin, caption)).state, "succeeded");
  assert.equal(stub.calls.filter((call) => call.path === "/audio/speech").length, 1);
  assert.equal((await run(h, admin, { ...caption, consent: "once", cache: "bypass" })).state, "succeeded", "the old parameter is taken and decides nothing");
  assert.deepEqual((await admin.call("jagentchill.provider.consent.check", { capability: "tts", contentKinds: ["transcript", "image", "audio"] })).missing, [], "nothing is ever missing");
  // What is sent where is told once, on the provider: one sentence, and a line per kind of work it serves on this host now.
  const provider = (await admin.call("jagentchill.provider.list", {})).providers[0];
  assert.equal(provider.sendingNote, "Connecting lets JAgentChill send this provider what the features you start need — nothing is asked again for each action");
  const kinds = (provider.sends as string[]).map((line) => line.split(":")[0]);
  for (const kind of ["Pictures", "Voice", "Music", "Listening"]) assert.ok(kinds.includes(kind), `${kind} in ${JSON.stringify(kinds)}`);
  assert.match((provider.sends as string[]).find((line) => line.startsWith("Pictures"))!, /reference pictures.*made small, without their file data/);
  assert.match((provider.sends as string[]).find((line) => line.startsWith("Listening"))!, /the speech of your clips/);
  // A kind of work with no model on is not listed.
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", capability: "music", enabled: false });
  assert.ok(!((await admin.call("jagentchill.provider.list", {})).providers[0].sends as string[]).some((line) => line.startsWith("Music")));
});

test("User-initiated confirmation; Threshold zero always asks: a person's action above the host amount shows its estimate first", async () => {
  const { admin, h } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const asked = await admin.fail("jagentchill.generation.create", IMAGE);
  assert.deepEqual([asked.code, asked.details.reason, asked.details.estimate.amountUsd], ["PERMISSION_DENIED", "confirmation_required", 0.034]);
  assert.equal((await run(h, admin, { ...IMAGE, confirmed: true })).state, "succeeded");
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 1 } });
  assert.equal((await run(h, admin, IMAGE)).state, "succeeded");
  assert.equal((await admin.fail("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 101 } })).code, "INVALID_PARAMS");
  assert.deepEqual((await admin.call("jagentchill.provider.threshold.get", {})).thresholds, { perCallApprovalUsd: 0.5, autoSessionBudgetUsd: 5, confirmAboveUsd: 1, maxSelfServiceUsd: 50 });
});

test("Ask before spending more than is 0 on a new host: a person's request is refused once with its estimate, the host's amount and what the budgets leave, nothing is sent before the confirmation, and the confirmed request runs", async () => {
  const { admin, h, stub } = await setup(false);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  assert.deepEqual((await admin.call("jagentchill.provider.threshold.get", {})).thresholds, { perCallApprovalUsd: 0.5, autoSessionBudgetUsd: 5, confirmAboveUsd: 0, maxSelfServiceUsd: 50 });
  const asked = await admin.fail("jagentchill.generation.create", IMAGE);
  assert.deepEqual([asked.code, asked.details.reason, asked.details.confirmAboveUsd, asked.details.remainingUsd, asked.details.estimate.amountUsd, asked.details.estimate.label], ["PERMISSION_DENIED", "confirmation_required", 0, null, 0.034, "GPT-5 Image Mini"]);
  assert.equal(generationCalls(stub).length, 0);
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "provider", scopeId: "openrouter", limitUsd: 2, period: "month", hardStop: true, allowUnknownCost: false } });
  assert.equal((await admin.fail("jagentchill.generation.create", IMAGE)).details.remainingUsd, 2);
  assert.equal((await run(h, admin, { ...IMAGE, confirmed: true })).state, "succeeded");
  assert.equal((await admin.call("jagentchill.provider.estimate", { items: [IMAGE] })).confirmAboveUsd, 0);
});

test("Partial block: three of four images are delivered with a warning", async () => {
  const { admin, h } = await setup();
  const job = await run(h, admin, { capability: "image", params: { prompt: "kite [partial]", count: 4 } });
  assert.deepEqual([job.state, job.results.length, job.warnings], ["succeeded", 3, ["1 of 4 images was blocked by the provider"]]);
});

test("Disable a provider; Re-enable: a disabled provider or model is not routable and needs no new key", async () => {
  const { admin, h } = await setup();
  assert.equal((await admin.call("jagentchill.provider.update", { providerId: "openrouter", enabled: false })).provider.health, "disabled");
  assert.equal((await admin.fail("jagentchill.generation.create", IMAGE)).code, "NO_ROUTE");
  await admin.call("jagentchill.provider.update", { providerId: "openrouter", enabled: true });
  assert.equal((await run(h, admin, IMAGE)).state, "succeeded");
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", capability: "image", enabled: false });
  assert.equal((await admin.fail("jagentchill.generation.create", IMAGE)).details.reason, "no_enabled_model");
  assert.equal((await admin.call("jagentchill.provider.list", {})).capabilities.find((c: any) => c.capability === "image").available, false);
  assert.equal(h.app.generation.available("tts"), true);
});

test("Every settings action has a method: each generation method has a parameter schema and a scope", () => {
  assert.deepEqual(Object.keys(generationRpcParams).sort(), Object.keys(GENERATION_METHOD_SCOPES).sort());
  assert.equal(GENERATION_METHOD_SCOPES["jagentchill.generation.create"], "jagentchill.generation.run");
});

// ---- agent tools ----
async function agentWorld(connect = true) {
  const { toolWorld } = await import("./support/tools.ts");
  const stub: StubGeneration = await startStubGeneration();
  const w = await toolWorld({ harness: { extra: { generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } } } } });
  open.push(stub, w.h);
  if (connect) {
    await w.admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
    await w.admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  }
  return { ...w, stub };
}
/** The agent starts an assistant message: a turn of the session (named `runId`) that the fake runtime runs until the test ends it. */
async function startMessage(w: { h: Harness; admin: Device; sessionKey: string }, runId: string): Promise<void> {
  w.h.fake.on("startTurn", () => ({ turnId: runId }));
  try { assert.equal((await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "go" })).status, "started"); } finally { w.h.fake.reset("startTurn"); }
}
/** The status messages of the editor the agent was told (each opens a turn of the session). */
const toldOf = (w: { h: Harness }, sessionKey?: string) => (w.h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>).filter((entry) => (!sessionKey || entry.sessionKey === sessionKey) && entry.message.includes("[JAgentChill]"));
/** The turn a status message of the editor opened is over (the fake runtime ends it); nothing when no turn runs. */
const endRunning = (w: { h: Harness }, sessionKey: string): void => { if (w.h.fake.isOpen(sessionKey) && w.h.fake.session(sessionKey).turnId) w.h.fake.endTurn(sessionKey); };
const toolNames = (w: { h: Harness }) => w.h.app.tools.definitions().map((tool) => tool.name).filter((name) => name.startsWith("jc_generate_"));

test("Server adapters are not visible to the agent CLIs' own media tools: the generate tools are served only while a provider is connected", async () => {
  const w = await agentWorld(false);
  assert.deepEqual(toolNames(w), []);
  assert.equal((await w.fails("jc_generate_image", { prompt: "a kite" })).code, "TOOL_NOT_AVAILABLE");
  await w.admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await w.admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  assert.deepEqual(toolNames(w), ["jc_generate_image", "jc_generate_speech", "jc_generate_music"]);
  assert.ok((await w.admin.call("jagentchill.tool.catalog", {})).tools.some((entry: any) => entry.name === "jc_generate_music" && entry.family === "generate"));
  await w.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", capability: "music", enabled: false });
  assert.deepEqual(toolNames(w), ["jc_generate_image", "jc_generate_speech"]);
});

test("Agent attribution; Generated outputs become media assets: a tool call runs the same job and imports the result with provenance", async () => {
  const w = await agentWorld();
  // A ceiling a person set on this host: the agent's small calls run unasked under it (at 0 each one is asked — "Review 12 #1 (agent)").
  await w.admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 1 } });
  const made = await w.ok("jc_generate_image", { prompt: "a red kite over the sea", aspectRatio: "3:2" });
  assert.deepEqual([made.data.assets.length, made.data.assets[0].type, made.data.assets[0].width, made.data.costUsd, made.data.model], [1, "image", 48, 0.011, "openai/gpt-5-image-mini"]);
  const asset = (w.head().media.assets as any[]).find((entry) => entry.id === made.data.assets[0].assetId);
  assert.deepEqual([asset.type, asset.provenance.source, asset.provenance.provider, asset.provenance.model, asset.provenance.jobId, asset.provenance.prompt], ["image", "ai", "openrouter", "openai/gpt-5-image-mini", made.data.jobId, "a red kite over the sea"]);
  const row = w.h.app.generation.ledgerRows().at(-1)!;
  assert.deepEqual([row.session_id, row.outcome, row.project_id], [w.sessionKey, "succeeded", w.head().metadata.id]);
  // (The double's list prices this reader per token, sound included — a price nobody can compute before the sound exists (ruling R4): the host's person gave it their own price per character.)
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.01 } } });
  const speech = await w.ok("jc_generate_speech", { text: "Welcome to the film.", voice: "Aoede" });
  assert.deepEqual([speech.data.assets[0].type, speech.data.assets[0].durationSeconds > 1], ["audio", true]);
  assert.equal((await w.fails("jc_generate_speech", { text: "hi", voice: "nobody" })).code, "INVALID_PARAMS");
  const failed = await w.fails("jc_generate_image", { prompt: "kite [blocked]" });
  assert.deepEqual([failed.code, failed.details.class], ["CONTENT_BLOCKED", "content_blocked"]);
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "kite [fail:401]" })).code], ["PROVIDER_ERROR"]);
});

test("Edit-mode threshold; Hard stop: a tool call above the approval amount asks first, and a budget stops it before the provider", async () => {
  const w = await agentWorld();
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.6 } } });
  const before = generationCalls(w.stub).length;
  // (Review 16 #2: this test used to make its call outside any assistant message and expect the chat's per-call permission card. A call is made INSIDE a message — a turn the runtime runs, here the harness's fake — and is decided with the message: collected, then ONE card when the turn has ended. The end of the turn reaches the service through the server's real wiring: runtime event → session service → Usage → `app.ts`.)
  await startMessage(w, "message-1");
  const asked = await w.fails("jc_generate_image", { prompt: "an expensive kite" });
  assert.deepEqual([asked.code, asked.details?.collecting], ["APPROVAL_PENDING", true]);
  assert.equal(generationCalls(w.stub).length, before);
  const listedCards = async () => (await w.admin.call("jagentchill.provider.messageCard.list", { sessionKey: w.sessionKey })).cards as Array<{ cardId: string; state: string; totalUsd: number; items: Array<{ modelLabel: string; provider: string; amountUsd: number }> }>;
  assert.deepEqual(await listedCards(), [], "no question while the message is being written");
  w.h.fake.endTurn(w.sessionKey, "message-1");
  for (let i = 0; i < 150 && !(await listedCards()).length; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  const [request] = await listedCards();
  assert.deepEqual([request.state, request.totalUsd, request.items.map((item) => [item.modelLabel, item.provider, item.amountUsd]), generationCalls(w.stub).length], ["pending", 0.6, [["GPT-5 Image Mini", "openrouter", 0.6]], before]);
  assert.deepEqual((await w.admin.call("jagentchill.chat.approval.list", { sessionKey: w.sessionKey })).requests, [], "ONE card: not also the chat's permission card");
  await w.admin.call("jagentchill.provider.messageCard.resolve", { cardId: request.cardId, decision: "allow" });
  assert.equal((await w.ok("jc_generate_image", { prompt: "an expensive kite" })).data.assets.length, 1);
  await w.admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 0.5, period: "month", hardStop: true } });
  await w.admin.call("jagentchill.provider.threshold.set", { patch: { perCallApprovalUsd: 5, autoSessionBudgetUsd: 50, confirmAboveUsd: 5 } });
  const stopped = await w.fails("jc_generate_image", { prompt: "one more kite" });
  assert.deepEqual([stopped.code, stopped.details.scope], ["BUDGET_EXCEEDED", "global"]);
});

test("ORC decides the model: with a profile on the Image role a request that names no model runs on it; when that model is off the role's fallback serves, and with no profile the recommended model does", async () => {
  const { admin, h } = await setup();
  const SECOND = "google/gemini-3.1-flash-lite-image", FIRST = "openai/gpt-5-image-mini";
  // No profile on the role: the recommended model of the capability.
  assert.equal((await run(h, admin, { capability: "image", params: { prompt: "kite one" } })).model, FIRST);
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [SECOND], enabled: true });
  const route = async (primary: string, fallback?: string) => {
    const state = await admin.call("jagentchill.orc.config.get", {});
    const profiles = [{ id: "main", provider: "openrouter", model: primary, params: {}, enabled: true }, ...(fallback ? [{ id: "spare", provider: "openrouter", model: fallback, params: {}, enabled: true }] : [])];
    await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { image: { enabled: true, profiles, defaultProfileId: "main", routes: { default: { primary: { profileId: "main" }, fallbacks: fallback ? [{ profileId: "spare" }] : [] } }, limits: {} } } } });
  };
  await route(SECOND);
  assert.equal((await run(h, admin, { capability: "image", params: { prompt: "kite two" } })).model, SECOND, "the role's profile decides, not the recommended flag");
  // The primary's model is turned off on the host: the fallback of the route serves.
  await route(SECOND, FIRST);
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [SECOND], enabled: false });
  assert.equal((await run(h, admin, { capability: "image", params: { prompt: "kite three" } })).model, FIRST, "the fallback serves when the primary cannot");
});

test("Listening asks nothing: speech generation made itself and a person's OWN recording are both written back as text by the connected listener, with or without the old consent parameter", async () => {
  const { admin, h, stub } = await setup();
  const spoken = await run(h, admin, { capability: "tts", params: { text: "A line the host spoke itself." } });
  const mine = h.app.sync.blobs.read(spoken.results[0].blobId);
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, []);
  assert.equal((await h.app.generation.transcribe({ bytes: mine, format: "wav", seconds: 2 }))!.text, "A line the host spoke itself.");
  // The same sound as a person's recording: other bytes (one sample changed), so not a file generation made.
  const theirs = Uint8Array.from(mine); theirs[theirs.length - 2] ^= 1;
  const sent = stub.calls.filter((call) => call.path === "/audio/transcriptions").length;
  assert.ok(await h.app.generation.transcribe({ bytes: theirs, format: "wav", seconds: 2 }));
  assert.equal(stub.calls.filter((call) => call.path === "/audio/transcriptions").length, sent + 1, "it was sent, unasked");
  assert.ok(await h.app.generation.transcribe({ bytes: theirs, format: "wav", seconds: 2 }, undefined, { consent: "once" }));
  assert.deepEqual(h.app.generation.listener(2)!.consentMissing, []);
});

test("Listening is paid work under a job's rules: a transcription is a ledger row of the caller's session at the provider's price, and a spending limit that is used up refuses it before anything is sent", async () => {
  const { admin, h, stub } = await setup();
  const spoken = await run(h, admin, { capability: "tts", params: { text: "A line to listen to." } });
  const bytes = h.app.sync.blobs.read(spoken.results[0].blobId), seconds = spoken.results[0].durationSeconds!;
  await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["audio"] });
  const listen = () => h.app.generation.transcribe({ bytes, format: "wav", seconds }, undefined, { sessionId: "run:listening" });
  const heard = await listen();
  assert.deepEqual([heard!.text, heard!.costUsd, heard!.model], ["A line to listen to.", 0.00002, "qwen/qwen3-asr-1.7b"]);
  const rows = () => h.app.generation.ledgerRows().filter((row) => row.capability === "transcription");
  assert.deepEqual(rows().map((row) => [row.session_id, row.provider, row.model, row.outcome, row.actual_usd, row.price_source, typeof row.estimate_usd]), [["run:listening", "openrouter", "qwen/qwen3-asr-1.7b", "succeeded", 0.00002, "provider", "number"]]);
  // The session's limit is used up by a picture (estimated $0.003, billed $0.011 by the double): listening is refused, and not sent.
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: "run:listening", limitUsd: 0.01, period: "total", hardStop: true } });
  assert.equal((await run(h, admin, { capability: "image", params: { prompt: "a kite", quality: "low" }, sessionId: "run:listening" })).state, "succeeded");
  const sent = stub.calls.filter((call) => call.path === "/audio/transcriptions").length;
  await assert.rejects(listen(), (error: { code?: string; details?: { scope?: string; remainingUsd?: number } }) => error.code === "BUDGET_EXCEEDED" && error.details?.scope === "session" && error.details?.remainingUsd === 0);
  assert.equal(stub.calls.filter((call) => call.path === "/audio/transcriptions").length, sent);
  assert.equal(rows().length, 1);
  // Another session is not held by that limit, and its row is its own.
  assert.equal((await h.app.generation.transcribe({ bytes, format: "wav", seconds }, undefined, { sessionId: "run:other" }))!.text, "A line to listen to.");
  assert.deepEqual(rows().map((row) => row.session_id), ["run:listening", "run:other"]);
});

test("A transcription interrupted by a stop of the host does not keep its budget: its stored job is failed at the next start and the reservation is given back; listening jobs are not among a person's jobs", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["audio"] });
  const spoken = await run(h, admin, { capability: "tts", params: { text: "A line to listen to." } });
  // The double answers the listening request late (its text is what the double "hears": a marker in the SPOKEN text would slow the speech call instead).
  stub.slowListening(400);
  const bytes = h.app.sync.blobs.read(spoken.results[0].blobId), reserved = () => (h.app.db.prepare("SELECT ref, amount_usd FROM budget_commits WHERE session_key = ?").all("run:stopped") as { ref: string; amount_usd: number }[]);
  // The double answers this recording after 400 ms; the host is "stopped" while it listens: the job row is there, running, with its reservation.
  const pending = h.app.generation.transcribe({ bytes, format: "wav", seconds: 40 }, undefined, { sessionId: "run:stopped" });
  pending.catch(() => undefined);
  await tick(60);
  const stored = h.app.db.prepare("SELECT job_id, state FROM gen_jobs WHERE kind = 'generation.transcription.internal'").all() as { job_id: string; state: string }[];
  assert.deepEqual([stored.length, stored[0].state, reserved().map((row) => row.ref), reserved()[0].amount_usd > 0], [1, "running", [`gen:${stored[0].job_id}`], true]);
  assert.ok(!(await admin.call("jagentchill.job.list", {})).jobs.some((job: any) => job.capability === "transcription"), "not listed among the jobs");
  // A new service over the same store — what a restart is.
  const { createGenerationService } = await import("../src/generation/service.ts"), { createOpenRouterAdapter } = await import("../src/generation/openrouter.ts");
  const again = createGenerationService({ db: h.app.db, config: new ServerConfigFile(join(h.dataDir, "config.json")), secrets: h.app.secrets, now: Date.now, dataDir: h.dataDir, blobs: h.app.sync.blobs, probe: (path: string) => h.app.sync.mediaJobs.probe(path), broadcast: () => undefined, adapters: [createOpenRouterAdapter({ baseUrl: stub.url })] });
  open.push(again);
  assert.deepEqual(reserved(), [], "the reservation was released");
  assert.equal((h.app.db.prepare("SELECT state FROM gen_jobs WHERE job_id = ?").get(stored[0].job_id) as { state: string }).state, "failed");
  await pending.catch(() => undefined);
});

test("The recommended picture model's price follows the provider: when its list states a new price per picture a refresh takes it (the measured shapes and the reference cap stay), a later change is taken again, and a person's own price stays over both", async () => {
  const { admin, stub } = await setup();
  const ID = "openai/gpt-5-image-mini", row = async () => (await admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "image" })).models.find((model: any) => model.id === ID);
  const estimate = async (quality?: string) => (await admin.call("jagentchill.provider.estimate", { items: [{ capability: "image", params: { prompt: "a kite", ...(quality ? { quality } : {}) } }] })).items[0].amountUsd;
  // The list gives no per-picture price for it (per token): the measured price stands.
  assert.deepEqual([(await row()).pricing.baseUsd, await estimate(), await estimate("low")], [0.034, 0.034, 0.003]);
  stub.setImagePrice(ID, [{ billable: "output_image", unit: "image", cost_usd: 0.005, variant: "low" }, { billable: "output_image", unit: "image", cost_usd: 0.05, variant: "high" }, { billable: "input_image", unit: "image", cost_usd: 0.002 }]);
  await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" });
  let now = await row();
  assert.deepEqual([bare(now.pricing), await estimate(), await estimate("low")], [{ kind: "per_image", baseUsd: 0.05, tiers: [{ when: { quality: "low" }, usd: 0.005 }, { when: { quality: "high" }, usd: 0.05 }], approximate: true, referenceUsd: 0.002 }, 0.05, 0.005]);
  assert.deepEqual([now.metadata.referenceImages, now.metadata.aspectRatios, now.source], [5, ["1:1", "3:2", "2:3"], "bundled"], "what was measured is not replaced by the list (16 references, an 'auto' shape)");
  stub.setImagePrice(ID, [{ billable: "output_image", unit: "image", cost_usd: 0.04 }]);
  await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" });
  assert.deepEqual([bare((await row()).pricing), await estimate("low")], [{ kind: "per_image", baseUsd: 0.04 }, 0.04]);
  // A person's price lies over the provider's, also after the next refresh.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: ID, capability: "image", pricing: { kind: "per_image", baseUsd: 0.01 } } });
  stub.setImagePrice(ID, [{ billable: "output_image", unit: "image", cost_usd: 0.09 }]);
  await admin.call("jagentchill.provider.model.refresh", { providerId: "openrouter" });
  now = await row();
  assert.deepEqual([now.pricing.baseUsd, now.customPrice, await estimate()], [0.01, true, 0.01]);
});

test("Every declared kind of price prices listening and translating, the same in the estimate and in the charge: the listener the product ships costs its $0.00002 a call — with or without a length — and that is what is estimated, reserved and written in the ledger; per second, free and per character alike", async () => {
  // The provider's list names no listener here, so the shipped row keeps its shipped price (the double's list would give it a token price).
  const { admin, h, stub } = await setup(false);
  stub.listListeners(false);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  const row = () => h.app.generation.models("openrouter").find((model) => model.id === "qwen/qwen3-asr-1.7b")!;
  assert.deepEqual(bare(row().pricing), { kind: "per_call", usd: 0.00002 });
  assert.deepEqual([h.app.generation.listener()!.estimateUsd, h.app.generation.listener(4)!.estimateUsd, h.app.generation.listener(40)!.estimateUsd], [0.00002, 0.00002, 0.00002]);
  // The charge: the double's answer carries NO cost from here on, so what is charged is the declared price — not "unknown", not nothing.
  stub.reportListeningCost(false);
  const spoken = await run(h, admin, { capability: "tts", params: { text: "A line to listen to." }, confirmed: true });
  const bytes = h.app.sync.blobs.read(spoken.results[0].blobId);
  // The run confirmed its cost with its own person, and put it on record: its listening is covered by that (a run that did not has no authority beyond the host's amount).
  h.app.generation.gate.cover({ fixedId: "run:priced", kind: "workflow.run", owner: "run:priced", amountUsd: 1 });
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: "run:priced", limitUsd: 1, period: "total", hardStop: true, allowUnknownCost: false } });
  const heard = await h.app.generation.transcribe({ bytes, format: "wav" }, undefined, { sessionId: "run:priced" });
  const ledger = () => h.app.generation.ledgerRows().filter((entry) => entry.capability === "transcription").map((entry) => [entry.estimate_usd, entry.actual_usd, entry.price_source, entry.outcome]);
  // Returned, written in the ledger and taken from the budget: the same $0.00002 — a strict budget did not refuse it as unpriced.
  assert.deepEqual([heard!.text, heard!.costUsd, ledger(), h.app.generation.remaining({ sessionId: "run:priced" })], ["A line to listen to.", 0.00002, [[0.00002, 0.00002, "catalogue", "succeeded"]], 0.99998]);
  const price = async (id: string, capability: string, pricing: object) => { await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, label: id, capability, pricing } }); await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [id], enabled: true }); };
  await price("qwen/qwen3-asr-1.7b", "transcription", { kind: "per_second", usd: 0.001 });
  assert.deepEqual([h.app.generation.listener(4)!.estimateUsd, h.app.generation.listener()!.estimateUsd], [0.004, null]);
  // A price per second with tiers, and a recording shorter than a second: the listener's figure IS the catalogue's
  // (`estimateOf`: the tier for this length, the length as it is — a quarter of a second is not a whole one), and it is what is charged.
  const { estimateOf } = await import("../src/generation/catalogue.ts");
  await price("qwen/qwen3-asr-1.7b", "transcription", { kind: "per_second", usd: 0.01, tiers: [{ when: { durationSeconds: 4 }, usd: 0.02 }] });
  const catalogue = (seconds: number) => estimateOf(row(), { durationSeconds: seconds }).amountUsd;
  assert.deepEqual([h.app.generation.listener(4)!.estimateUsd, catalogue(4), h.app.generation.listener(0.25)!.estimateUsd, catalogue(0.25)], [0.08, 0.08, 0.0025, 0.0025]);
  const short = await h.app.generation.transcribe({ bytes, format: "wav", seconds: 0.25 }, undefined, { sessionId: "run:priced" }), tiered = await h.app.generation.transcribe({ bytes, format: "wav", seconds: 4 }, undefined, { sessionId: "run:priced" });
  assert.deepEqual([short!.costUsd, tiered!.costUsd, ledger().slice(1).map((entry) => [entry[0], entry[1]]), h.app.generation.remaining({ sessionId: "run:priced" })], [0.0025, 0.08, [[0.0025, 0.0025], [0.08, 0.08]], 0.91748]);
  await price("qwen/qwen3-asr-1.7b", "transcription", { kind: "free" });
  assert.equal(h.app.generation.listener()!.estimateUsd, 0);
  for (const [pricing, expected] of [[{ kind: "per_call", usd: 0.002 }, 0.002], [{ kind: "per_character", perThousandUsd: 0.5 }, 1], [{ kind: "free" }, 0]] as const) {
    await price("stub/text-only", "translation", pricing);
    assert.equal(h.app.generation.translator(h.app.generation.translationWork("x".repeat(2000), 2000))!.estimateUsd, expected, JSON.stringify(pricing));
  }
});

test("Review 14 #10 (ruling R4) — a price per token is computed only from the request itself and from documented figures of the model, each recorded with its source; nothing is assumed (no tokens a second, no characters a token, no 'usual' answer): without them the price is NOT KNOWN — for a listener, a translator and a reader — and with them the quote is the text of the request in bytes, the sound at the documented rate, and the model's documented longest answer, which is the limit really sent", async () => {
  const { admin, h, stub } = await setup(false);
  stub.listListeners(false);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  const generation = h.app.generation;
  const row = (id: string, capability: string, pricing: unknown, metadata?: Record<string, unknown>) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, capability, pricing, ...(metadata ? { metadata } : {}) } });
  // A LISTENER priced per token. Nobody documented how many tokens a second of sound is: not known — whatever the length.
  await row("qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 0 });
  assert.deepEqual([generation.listener(4)!.estimateUsd, generation.listener()!.estimateUsd], [null, null], "no rate is assumed for sound");
  // A figure with no source prices nothing either.
  await row("qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 0 }, { audioTokensPerSecond: 25 });
  assert.equal(generation.listener(4)!.estimateUsd, null, "a figure without its source");
  await row("qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 0 }, DOCUMENTED_SOUND);
  // 4 s × 25 documented tokens = 100 tokens at $2 a million. A recording that does not exist yet has no length: not known.
  assert.deepEqual([generation.listener(4)!.estimateUsd, generation.listener()!.estimateUsd], [0.0002, null]);
  // Its answer has a price too: the longest answer must be documented as well.
  await row("qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 4 });
  assert.equal(generation.listener(4)!.estimateUsd, null);
  await row("qwen/qwen3-asr-1.7b", "transcription", { kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 4 }, { ...documentedAnswer(1000), sources: { ...DOCUMENTED_SOUND.sources, ...documentedAnswer(1000).sources } });
  assert.equal(generation.listener(4)!.estimateUsd, null, "(review 15 #6) a documented longest answer is not a limit of the request: a listener whose answer has a price stays not known");
  // A TRANSLATOR priced per token: the answer has a price and the model's longest answer is not documented → not known.
  const work = generation.translationWork("x".repeat(2000), 2000), prompt = JSON.stringify([{ role: "user", content: "x".repeat(2000) }]);
  await row("stub/text-only", "translation", { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 3 });
  assert.equal(generation.translator(work)!.estimateUsd, null, "how long the answer may be is not assumed");
  await row("stub/text-only", "translation", { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 3 }, documentedAnswer(4000));
  // The whole message as it is serialised into the request, a token a byte at most; the answer at most the documented 4,000 tokens.
  assert.equal(generation.translator(work)!.estimateUsd, Math.round((Buffer.byteLength(prompt) * 1 + 4000 * 3)) / 1e6);
  // What is SENT is that message and that limit, and what is billed stays inside the quote — the double bills a token a character and would write 5,000 tokens more than it is allowed.
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-only"], enabled: true });
  stub.bill({ chat: { inputPerToken: 1e-6, outputPerToken: 3e-6, extraOutputTokens: 5000, tokensPerCharacter: 1 } });
  generation.gate.cover({ fixedId: "run:r4", kind: "workflow.run", owner: "run:r4", amountUsd: 1 });
  const model = generation.models("openrouter").find((entry) => entry.id === "stub/text-only")!, quoted = generation.translator(work)!.estimateUsd!;
  const written = await generation.translateOn(model, { prompt: "x".repeat(2000), characters: 2000 }, new AbortController().signal, { sessionId: "run:r4" });
  const sent = JSON.parse(stub.bodies.at(-1)!) as { max_tokens?: number; messages?: unknown };
  assert.deepEqual([sent.max_tokens, JSON.stringify(sent.messages)], [4000, prompt]);
  assert.ok(written.costUsd > 0 && written.costUsd <= quoted, `billed ${written.costUsd}, quoted ${quoted}`);
  // A translator whose answer is free needs no limit: the input alone is counted, and no limit is sent.
  await row("stub/text-only", "translation", { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 0 }, { maxOutputTokens: 0 });
  assert.equal(generation.translator(work)!.estimateUsd, Math.round(Buffer.byteLength(prompt)) / 1e6);
  // A READER (speech) the provider's list prices per token, answer included: how much sound a text becomes is in no documented figure → not known (it was "text ÷ 4, and nothing for the sound").
  const speech = generation.prepare({ capability: "tts", params: { text: "A line to listen to." } });
  assert.deepEqual([speech.model.pricing?.kind, speech.estimate.amountUsd, speech.estimate.confidence], ["tokens", null, "unknown"]);
});


test("Review 12 #3 — a confirmation belongs to the request it was shown for: request B (another prompt, the same model and price) sent with `confirmed: true` and the ids of request A's question is NOT started — it is asked its own question; A's answer still starts A", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const a = await admin.fail("jagentchill.generation.create", IMAGE);
  const other = { capability: "image", params: { prompt: "a green door in a white wall" } };
  const b = await admin.fail("jagentchill.generation.create", { ...other, confirmed: true, ...a.details.confirmWith });
  assert.deepEqual([b.code, b.details.reason, generationCalls(stub).length], ["PERMISSION_DENIED", "confirmation_required", 0], "nothing was sent for B");
  assert.notEqual(b.details.confirmWith.actionId, a.details.confirmWith.actionId, "B's question is its own");
  assert.notEqual(b.details.confirmWith.quoteId, a.details.confirmWith.quoteId, "what will be made is part of the quote");
  const made = await done(h, (await admin.call("jagentchill.generation.create", { ...IMAGE, confirmed: true, ...a.details.confirmWith })).job.jobId);
  assert.deepEqual([made.state, made.params.prompt], ["succeeded", IMAGE.params.prompt]);
});

// (Run 12, ruling R1: this takes the place of "Review 12 #1 (agent)", which asked the card for EVERY agent call on a host whose "ask before spending more than" is 0. That amount is about actions a person starts directly; an agent's calls are held by the allowances a person set — rules 2 and 3 of "Approval thresholds and spending caps".)
test("Review 13 #1 (R1) — a person-set allowance is an approval, whatever 'ask before spending more than' says: Below the threshold — an edit session's $0.011 picture is queued without a card on a host that asks about everything a PERSON starts; Threshold applies to the message total — calls of one assistant message that are each below the per-call amount ask the card once their total passes it; Threshold zero always asks; Auto session over budget — an auto session's work is approved while what the session has spent stays within the Auto allowance and asks beyond it; and the gate holds an allowance to its amount on what was really billed", async () => {
  const w = await agentWorld();
  const price = (usd: number) => w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: usd } } });
  const sent = () => generationCalls(w.stub).length;
  assert.deepEqual([(await w.admin.call("jagentchill.provider.threshold.get", {})).thresholds.confirmAboveUsd, (await w.admin.call("jagentchill.session.get", { sessionKey: w.sessionKey })).session.modeId], [0, "edit"]);
  // Below the threshold (0.50): no card, although the host asks a PERSON about every amount.
  assert.equal((await w.ok("jc_generate_image", { prompt: "a small kite" })).data.costUsd, 0.011);
  assert.deepEqual((await w.admin.call("jagentchill.chat.approval.list", { sessionKey: w.sessionKey })).requests, []);
  // (Review 16 #2: this part used to expect the first two calls of a message to be DISPATCHED before the third took the total past the amount. The calls of a message are collected and decided together when it has ended.)
  // One assistant message (a turn the runtime runs — the harness's fake; Usage and the wiring to it are the real ones): three calls of $0.20 — $0.60 in all, past $0.50.
  await price(0.2); w.stub.bill({ image: 0.2 });
  const turn = (runId: string): Promise<void> => startMessage(w, runId);
  const cards = async () => (await w.admin.call("jagentchill.provider.messageCard.list", { sessionKey: w.sessionKey })).cards as Array<{ cardId: string; state: string; totalUsd: number; items: unknown[] }>;
  const pendingCards = async () => (await cards()).filter((card) => card.state === "pending");
  const told = () => toldOf(w);
  const wait = async (what: () => boolean | Promise<boolean>, label: string): Promise<void> => { for (let i = 0; i < 200; i++) { if (await what()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } assert.fail(`timed out waiting for ${label}`); };
  /** The turn a status message of the editor opened is over (the fake runtime ends it). */
  const endTold = (): void => endRunning(w, told().at(-1)!.sessionKey);
  const before = sent();
  await turn("message-1");
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "kite one" })).details?.collecting, (await w.fails("jc_generate_image", { prompt: "kite two" })).details?.collecting, (await w.fails("jc_generate_image", { prompt: "kite three" })).code, sent(), await cards()], [true, true, "APPROVAL_PENDING", before, []]);
  w.h.fake.endTurn(w.sessionKey, "message-1");
  await wait(async () => (await pendingCards()).length === 1, "the message's card");
  assert.deepEqual([(await pendingCards())[0].totalUsd, (await pendingCards())[0].items.length, sent()], [0.6, 3, before], "ONE card, three items, nothing sent");
  await w.admin.call("jagentchill.provider.messageCard.resolve", { cardId: (await pendingCards())[0].cardId, decision: "deny" });
  await wait(() => told().length === 1, "the decision to reach the agent"); endTold();
  // The next message starts at nothing: two calls, $0.40 in all — inside the amount. It ends, nobody is asked, the agent is told and makes them again.
  await turn("message-2");
  await w.fails("jc_generate_image", { prompt: "kite four" }); await w.fails("jc_generate_image", { prompt: "kite five" });
  w.h.fake.endTurn(w.sessionKey, "message-2");
  await wait(() => told().length === 2, "the agent to be told");
  assert.deepEqual([(await pendingCards()).length, sent()], [0, before]);
  assert.match(told()[1].message, /come to \$0\.40, inside the amount/);
  endTold();
  // The provider bills more than was estimated ($0.40 for a $0.20 picture): what the message was let out for is held on the BILLS — the second call would make $0.60 against the $0.40 that were let out, and asks (the permission card of that call), though the estimates say $0.40.
  w.stub.bill({ image: 0.4 });
  await turn("message-3");
  assert.equal((await w.ok("jc_generate_image", { prompt: "kite four" })).data.costUsd, 0.4);
  const billed = sent();
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "kite five" })).code, sent(), (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: w.sessionKey })).requests.length], ["APPROVAL_PENDING", billed, 1]);
  w.h.fake.endTurn(w.sessionKey, "message-3");
  // Threshold zero always asks.
  await price(0.011); w.stub.bill({ image: 0.011 });
  await w.admin.call("jagentchill.provider.threshold.set", { patch: { perCallApprovalUsd: 0 } });
  await turn("message-4");
  assert.equal((await w.fails("jc_generate_image", { prompt: "a kite at zero" })).code, "APPROVAL_PENDING");
  w.h.fake.endTurn(w.sessionKey, "message-4");
  await wait(async () => (await pendingCards()).length === 1, "the card at threshold zero");
  assert.equal((await pendingCards())[0].totalUsd, 0.011);
  // An auto session: approved automatically inside the Auto allowance ($1 here), whatever one call costs; beyond it, the card.
  await w.admin.call("jagentchill.provider.threshold.set", { patch: { autoSessionBudgetUsd: 1 } });
  await price(0.6); w.stub.bill({ image: 0.6 });
  const auto = await w.session(w.admin, w.project.doc.metadata.id, "auto");
  assert.equal((await w.ok("jc_generate_image", { prompt: "auto kite one" }, auto)).data.costUsd, 0.6);
  const sentBefore = sent();
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "auto kite two" }, auto)).code, sent()], ["APPROVAL_PENDING", sentBefore]);
  // The card allows THAT call; a person raising the allowance lets the next ones through again.
  const request = (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: auto })).requests[0];
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: request.requestId, decision: "allow-once" });
  await w.ok("jc_generate_image", { prompt: "auto kite two" }, auto);
  await w.admin.call("jagentchill.provider.threshold.set", { patch: { autoSessionBudgetUsd: 5 } });
  await w.ok("jc_generate_image", { prompt: "auto kite three" }, auto);
});

test("Review 12 #6 — every attempt's bill of the host's own listening and translating reaches the ledger, the job and the budgets: a translation the provider bills $1 and then fails keeps that $1 (ledger row, stored job, budget, the gate's charges by the job's id) instead of writing 0 and giving the reservation back; two billed failures and then an answer cost $3, and say so; the same for a listener", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "per_call", usd: 1 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  const generation = h.app.generation, model = generation.models("openrouter").find((entry) => entry.id === "stub/text-a")!;
  generation.gate.cover({ fixedId: "run:six", kind: "workflow.run", owner: "run:six", amountUsd: 20 });
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: "run:six", limitUsd: 20, period: "total", hardStop: true, allowUnknownCost: false } });
  const rows = (capability: string) => generation.ledgerRows().filter((row) => row.capability === capability).map((row) => [row.outcome, row.actual_usd]);
  const lastJob = (kind: string) => JSON.parse((h.app.db.prepare("SELECT json FROM gen_jobs WHERE kind LIKE ? ORDER BY created_ms DESC, rowid DESC LIMIT 1").get(`%${kind}%`) as { json: string }).json) as { jobId: string; state: string; actualUsd: number | null };
  const failed = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return error as { class?: string }; } return assert.fail("it was expected to fail"); };
  const prompt = 'Translate into Vietnamese.\n["The harbour is quiet."]';
  // Billed, then failed for good (a 400 is not tried again).
  stub.bill({ chat: 1 }); stub.failBilled(1, 1, 400);
  await failed(() => generation.translateOn(model, { prompt, characters: 21 }, new AbortController().signal, { sessionId: "run:six" }));
  let job = lastJob("translation");
  assert.deepEqual([rows("translation"), job.state, job.actualUsd, generation.gate.chargedFor(job.jobId), generation.remaining({ sessionId: "run:six" })], [[["failed", 1]], "failed", 1, 1, 19]);
  // Billed twice on a failure that is tried again, then answered: $3, and every attempt has its row.
  stub.failBilled(2, 1, 502);
  const written = await generation.translateOn(model, { prompt, characters: 21 }, new AbortController().signal, { sessionId: "run:six" });
  job = lastJob("translation");
  assert.deepEqual([written.costUsd, rows("translation").slice(1), job.actualUsd, generation.gate.chargedFor(job.jobId), generation.remaining({ sessionId: "run:six" })], [3, [["failed", 1], ["failed", 1], ["succeeded", 1]], 3, 3, 16]);
  // A listener that bills $0.5 and fails.
  stub.failBilled(1, 0.5, 400);
  await failed(() => generation.transcribe({ bytes: new Uint8Array(64), format: "wav", seconds: 1 }, undefined, { sessionId: "run:six" }));
  job = lastJob("transcription");
  assert.deepEqual([rows("transcription"), job.state, job.actualUsd, generation.gate.chargedFor(job.jobId), generation.remaining({ sessionId: "run:six" })], [[["failed", 0.5]], "failed", 0.5, 0.5, 15.5]);
});

test("Review 13 #6 — a retry is checked against the budgets like a first request: under a $1 hard-stop budget a translation the provider bills $1 and fails (a failure that is tried again) is NOT sent a second time — the $1 is committed and the next attempt is refused before it goes out (one request, $1; not three, $3); the same for a listener", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "per_call", usd: 1 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  const generation = h.app.generation, model = generation.models("openrouter").find((entry) => entry.id === "stub/text-a")!;
  // (The run's own confirmation is far above: it is the BUDGET that must stop the retry.)
  for (const run of ["run:tight", "run:tight-ear"]) generation.gate.cover({ fixedId: run, kind: "workflow.run", owner: run, amountUsd: 20 });
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: "run:tight", limitUsd: 1, period: "total", hardStop: true, allowUnknownCost: false } });
  const failed = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return error as { code?: string; class?: string }; } return assert.fail("it was expected to fail"); };
  const lastJob = (kind: string) => JSON.parse((h.app.db.prepare("SELECT json FROM gen_jobs WHERE kind LIKE ? ORDER BY created_ms DESC, rowid DESC LIMIT 1").get(`%${kind}%`) as { json: string }).json) as { jobId: string; state: string; actualUsd: number | null };
  stub.bill({ chat: 1 }); stub.failBilled(2, 1, 502);
  let before = stub.calls.length;
  const refused = await failed(() => generation.translateOn(model, { prompt: 'Translate into Vietnamese.\n["The harbour is quiet."]', characters: 21 }, new AbortController().signal, { sessionId: "run:tight" }));
  let job = lastJob("translation");
  assert.deepEqual([stub.calls.length - before, refused.code, job.state, job.actualUsd, generation.gate.spentOf("run:tight"), generation.remaining({ sessionId: "run:tight" })], [1, "BUDGET_EXCEEDED", "failed", 1, 1, 0]);
  // A listener that bills $0.5 and fails with a failure that is tried again, under a $0.5 budget.
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: "run:tight-ear", limitUsd: 0.5, period: "total", hardStop: true } });
  stub.failBilled(0, 0, 502); stub.failBilled(2, 0.5, 502); before = stub.calls.length;
  const unheard = await failed(() => generation.transcribe({ bytes: new Uint8Array(64), format: "wav", seconds: 1 }, undefined, { sessionId: "run:tight-ear" }));
  job = lastJob("transcription");
  assert.deepEqual([stub.calls.length - before, unheard.code, job.state, job.actualUsd, generation.gate.spentOf("run:tight-ear"), generation.remaining({ sessionId: "run:tight-ear" })], [1, "BUDGET_EXCEEDED", "failed", 0.5, 0.5, 0]);
});

test("Review 12 #4 — one confirmation, one job, also between two hosts on ONE database: a second service instance (its own connection to the same file) sends the same confirmation while the first is in the middle of creating the job — at EVERY point of that work in turn — and there is never a second job or a second provider request: the second either cannot get in between, or gets the job the first made", async () => {
  const { admin, h, stub } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const { createGenerationService } = await import("../src/generation/service.ts"), { createOpenRouterAdapter } = await import("../src/generation/openrouter.ts"), { openDatabase } = await import("../src/store/database.ts");
  const other = openDatabase(join(h.dataDir, "jagentchill.sqlite"));
  open.push({ close: () => other.close() });
  // The first instance's clock is the test's way in: whatever it does, the second instance can be made to act at that very moment.
  let between: (() => void) | undefined, ticks = 0, at = 0;
  const service = (db: typeof other, now: () => number) => createGenerationService({ db, config: new ServerConfigFile(join(h.dataDir, "config.json")), secrets: h.app.secrets, now, dataDir: h.dataDir, blobs: h.app.sync.blobs, probe: (path: string) => h.app.sync.mediaJobs.probe(path), broadcast: () => undefined, adapters: [createOpenRouterAdapter({ baseUrl: stub.url })], timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } } as never);
  const first = service(h.app.db, () => { if (between && ++ticks === at) { const run = between; between = undefined; run(); } return Date.now(); }), second = service(other, Date.now);
  open.push(first, second);
  const actor = { deviceId: admin.device.deviceId, by: "user" as const };
  for (at = 1; at < 200; at++) {
    const request = { capability: "image" as const, params: { prompt: `a kite, drawing ${at}` } };
    let asked: any;
    try { first.create(request, actor); } catch (error) { asked = error; }
    const answer = { ...request, confirmed: true as const, ...asked.details.confirmWith };
    const before = generationCalls(stub).length, jobs = () => (h.app.db.prepare("SELECT COUNT(*) AS n FROM gen_jobs WHERE kind = 'generation.image'").get() as { n: number }).n, had = jobs();
    let theirs: { jobId: string } | undefined, entered = false;
    ticks = 0;
    between = () => { entered = true; try { theirs = second.create(answer, actor); } catch { /* it could not get in between */ } };
    const mine = first.create(answer, actor);
    if (!entered) { between = undefined; break; }   // the first instance's work has no further point to get in at
    theirs ??= second.create(answer, actor);
    // (Whichever instance made a job runs it; the other only knows it from the store.)
    const ended = (jobId: string) => /"state":"(succeeded|failed|cancelled)"/.test((h.app.db.prepare("SELECT json FROM gen_jobs WHERE job_id = ?").get(jobId) as { json: string }).json);
    for (let n = 0; n < 600 && !(ended(mine.jobId) && ended(theirs.jobId)); n++) await tick(10);
    await tick(5);
    assert.deepEqual([theirs.jobId === mine.jobId, jobs() - had, generationCalls(stub).length - before], [true, 1, 1], `the second instance acted at point ${at} of the first one's work`);
  }
  assert.ok(at > 3, "the second instance was let in at several points");
});

test("Review 14 #9 — every retry is checked against the budgets at the moment it is sent: a request fails with NOTHING billed (a failure that is tried again); while it waits to try again a hard-stop budget below its price is set — the retry is not sent (one request, BUDGET_EXCEEDED), for a translation and for a listener", async () => {
  const { admin, h, stub } = await setup(true, [600, 600]);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-a", label: "Text A", capability: "translation", pricing: { kind: "per_call", usd: 1 } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-a"], enabled: true });
  const generation = h.app.generation, model = generation.models("openrouter").find((entry) => entry.id === "stub/text-a")!;
  for (const run of ["run:late", "run:late-ear"]) generation.gate.cover({ fixedId: run, kind: "workflow.run", owner: run, amountUsd: 20 });
  const failed = async (work: Promise<unknown>) => { try { await work; } catch (error) { return error as { code?: string }; } return assert.fail("it was expected to fail: the retry went out under a budget that does not hold it"); };
  /** The budget is set while the request waits to try again: after its first attempt has been answered. */
  const lowerDuringTheWait = async (sessionId: string, limitUsd: number, before: number) => { for (let n = 0; n < 2000 && stub.calls.length === before; n++) await new Promise((resolve) => setTimeout(resolve, 2)); await new Promise((resolve) => setTimeout(resolve, 60)); await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: sessionId, limitUsd, period: "total", hardStop: true } }); };
  stub.failBilled(1, 0, 502);
  let before = stub.calls.length;
  const translating = failed(generation.translateOn(model, { prompt: 'Translate into Vietnamese.\n["The harbour is quiet."]', characters: 21 }, new AbortController().signal, { sessionId: "run:late" }));
  await lowerDuringTheWait("run:late", 0.5, before);
  assert.deepEqual([(await translating).code, stub.calls.length - before, generation.gate.spentOf("run:late")], ["BUDGET_EXCEEDED", 1, 0]);
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 1 } } });
  stub.failBilled(0, 0, 502); stub.failBilled(1, 0, 502); before = stub.calls.length;
  const hearing = failed(generation.transcribe({ bytes: new Uint8Array(64), format: "wav", seconds: 1 }, undefined, { sessionId: "run:late-ear" }));
  await lowerDuringTheWait("run:late-ear", 0.5, before);
  assert.deepEqual([(await hearing).code, stub.calls.length - before], ["BUDGET_EXCEEDED", 1]);
});

test("Review 14 #1 (R1) — the Auto allowance counts ALL the spending of the session's agent tree, the turns of the runtime's model too: a session whose turns have cost $4.90 asks the card for a $0.40 picture under the $5 allowance (nothing is sent) — it does not go through because the generation ledger alone says $0; and the allowance is the session's own where a person set one: raised for that session, the same picture runs unasked; a session can lower its amounts, never raise the per-call one", async () => {
  const w = await agentWorld();
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.4 } } });
  w.stub.bill({ image: 0.4 });
  const auto = await w.session(w.admin, w.project.doc.metadata.id, "auto"), sent = () => generationCalls(w.stub).length;
  // TEST DOUBLE for one figure: what Usage says the session's own turns have cost (the gate's reader of Usage; the tree it reads stays the host's).
  w.h.app.generation.gate.bindUsage(async () => 4.9, async (sessionKey) => (sessionKey === auto ? [{ runId: "turn-1", costUsd: 4.9, started_ms: Date.now() - 1000 }] : []));
  assert.equal((await w.admin.call("jagentchill.provider.threshold.get", { sessionKey: auto })).session.autoSessionBudgetUsd, 5);
  const before = sent(), asked = await w.fails("jc_generate_image", { prompt: "a kite past the allowance" }, auto);
  assert.deepEqual([asked.code, sent()], ["APPROVAL_PENDING", before], "$4.90 of turns + $0.40 is past $5: the card, and nothing sent");
  const card = (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: auto })).requests[0];
  assert.match(JSON.stringify(card), /spent \$4\.90 of the \$5\.00/);
  // A person raises THIS session's allowance (rule 3: up to the host's self-service maximum) — the host's stays $5.
  assert.equal((await w.admin.fail("jagentchill.provider.threshold.set", { sessionKey: auto, patch: { autoSessionBudgetUsd: 51 } })).code, "INVALID_PARAMS");
  const raised = await w.admin.call("jagentchill.provider.threshold.set", { sessionKey: auto, patch: { autoSessionBudgetUsd: 6 } });
  assert.deepEqual([raised.session.autoSessionBudgetUsd, raised.thresholds.autoSessionBudgetUsd], [6, 5]);
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: card.requestId, decision: "deny" });
  assert.equal((await w.ok("jc_generate_image", { prompt: "a kite inside the raised allowance" }, auto)).data.costUsd, 0.4);
  // The per-call amount of a session can only go down.
  assert.equal((await w.admin.fail("jagentchill.provider.threshold.set", { sessionKey: w.sessionKey, patch: { perCallApprovalUsd: 0.9 } })).code, "INVALID_PARAMS");
  assert.equal((await w.admin.call("jagentchill.provider.threshold.set", { sessionKey: w.sessionKey, patch: { perCallApprovalUsd: 0.1 } })).session.perCallApprovalUsd, 0.1);
  assert.equal((await w.fails("jc_generate_image", { prompt: "a kite above this session's own amount" })).code, "APPROVAL_PENDING", "$0.40 is above the $0.10 this session set for itself");
});

test("Review 15 #6 — listening is priced only by what its request really bounds: a transcription request carries no limit of its answer (nothing in the request on the wire says how long the text may be), so a listener whose ANSWER has a price per token is 'price not known' whatever its row documents as its longest answer; a listener billed for the sound alone keeps its price", async () => {
  const { admin, h, stub } = await setup(false);
  stub.listListeners(false);
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  const generation = h.app.generation, documented = { ...documentedAnswer(1000), ...DOCUMENTED_SOUND, sources: { ...DOCUMENTED_SOUND.sources, ...documentedAnswer(1000).sources } };
  const row = (pricing: unknown) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing, metadata: documented } });
  await row({ kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 4 });
  // What goes out: the request on the wire names the model, the language and the sound — no limit of the answer.
  generation.gate.cover({ fixedId: "run:listen", kind: "workflow.run", owner: "run:listen", amountUsd: 1, unpriced: ["qwen/qwen3-asr-1.7b"] });
  await generation.transcribe({ bytes: new Uint8Array(3200), format: "wav", seconds: 4 }, undefined, { sessionId: "run:listen" });
  const sent = JSON.parse(stub.bodies.at(-1)!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), ["input_audio", "model"], "the request as it is sent");
  assert.equal(generation.listener(4)!.estimateUsd, null, "an answer nothing limits has no bound: its price is not known");
  await row({ kind: "tokens", inputPerMillionUsd: 2, outputPerMillionUsd: 0 });
  assert.equal(generation.listener(4)!.estimateUsd, 0.0002, "the sound alone: 4 s at the documented 25 tokens a second, $2 a million");
});

test("Review 15 #10 — a session's Auto allowance has the spec's own maximum beside the host's self-service one: with self-service set to $5,000 a session cannot be given $1,000.01 — $1,000 it can", async () => {
  const { admin } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { maxSelfServiceUsd: 5000 } });
  const refused = await admin.fail("jagentchill.provider.threshold.set", { sessionKey: "agent:main:any", patch: { autoSessionBudgetUsd: 1000.01 } });
  assert.deepEqual([refused.code, refused.details?.max], ["INVALID_PARAMS", 1000]);
  assert.equal((await admin.call("jagentchill.provider.threshold.set", { sessionKey: "agent:main:any", patch: { autoSessionBudgetUsd: 1000 } })).session.autoSessionBudgetUsd, 1000);
});

test("Review 16 #2 (ruling R8) — the costed calls of ONE assistant message are COLLECTED before any is dispatched: Above the threshold — in an edit session with $0.50 a message, three $0.30 pictures of one message are each held (nothing is sent, no card yet); when the message has ended the person gets ONE card listing all three and the total ($0.90) and still nothing is sent; 'Allow' covers exactly the listed calls — made again with the same parameters they run; a message whose total is INSIDE the amount is let out with no card when it has ended (the agent is told to make its call again, and it runs); 'Deny' makes nothing; a stopped turn's collection is dropped", async () => {
  const w = await agentWorld();
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.3 } } });
  w.stub.bill({ image: 0.3 });
  // TEST DOUBLE for one fact: the turns of the session as Usage has them (the newest is the assistant message that is being written). That a message has ENDED reaches the service as the host's own signal does (`messageCards.settle(…, { ended: true })`, which `app.ts` calls on Usage's update) — or by the next message's first call.
  const turns: { runId: string; started_ms: number; outcome?: string }[] = [{ runId: "turn-1", started_ms: Date.now() - 1000 }];
  const next = (runId: string): void => { turns.push({ runId, started_ms: Date.now() }); };
  const generation = w.h.app.generation, ended = () => generation.messageCards.settle(w.sessionKey, { ended: true });
  generation.gate.bindUsage(async () => 0, async (sessionKey) => (sessionKey === w.sessionKey ? turns.map((entry) => ({ ...entry })) : []));
  type Listed = { cardId: string; state: string; totalUsd: number; allowanceUsd: number; items: Array<{ words: string; amountUsd: number | null; state: string; model: string }> };
  const sent = () => generationCalls(w.stub).length, cards = async () => (await w.admin.call("jagentchill.provider.messageCard.list", { sessionKey: w.sessionKey })).cards as Listed[];
  const told = () => toldOf(w, w.sessionKey).map((entry) => entry.message);
  // — one message, three pictures: $0.30 is inside the amount, and it is NOT dispatched: the message's total is not known yet.
  const first = await w.fails("jc_generate_image", { prompt: "a kite, the first" }), second = await w.fails("jc_generate_image", { prompt: "a kite, the second" }), third = await w.fails("jc_generate_image", { prompt: "a kite, the third" });
  assert.deepEqual([first.code, second.code, third.code, first.details?.collecting, sent(), await cards()], ["APPROVAL_PENDING", "APPROVAL_PENDING", "APPROVAL_PENDING", true, 0, []], "collected: nothing sent, and no card while the message is being written");
  assert.ok(first.details?.requestId === second.details?.requestId && second.details?.requestId === third.details?.requestId, "one collection a message");
  // The message has ended: ONE card, all three items, the total; nothing was sent.
  await ended();
  const listed = await cards();
  assert.deepEqual([listed.length, sent()], [1, 0]);
  assert.deepEqual([listed[0].cardId, listed[0].state, listed[0].totalUsd, listed[0].allowanceUsd, listed[0].items.map((item) => [item.words, item.amountUsd, item.state])], [first.details?.requestId, "pending", 0.9, 0.5, [["a kite, the first", 0.3, "waiting"], ["a kite, the second", 0.3, "waiting"], ["a kite, the third", 0.3, "waiting"]]]);
  // Asked again before the answer (a new message): still pending, still one card, still nothing sent.
  next("turn-2");
  const early = await w.fails("jc_generate_image", { prompt: "a kite, the second" });
  assert.deepEqual([early.code, early.details?.requestId, early.details?.collecting, (await cards()).length, sent()], ["APPROVAL_PENDING", listed[0].cardId, undefined, 1, 0]);
  const allowed = await w.admin.call("jagentchill.provider.messageCard.resolve", { cardId: listed[0].cardId, decision: "allow" });
  assert.equal(allowed.card.state, "allowed");
  for (let i = 0; i < 100 && told().length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(told().length, 1, "the answer opens the agent's next turn");
  /** The turn a status message of the editor opened is ended, the way the runtime reports it (the harness's fake). */
  const endTold = (): void => endRunning(w, w.sessionKey);
  endTold();
  // The agent's next message makes the listed calls again: they run, on that answer — all three, $0.90, with no further question.
  next("turn-3");
  for (const words of ["a kite, the third", "a kite, the first", "a kite, the second"]) assert.equal((await w.ok("jc_generate_image", { prompt: words })).data.costUsd, 0.3);
  assert.equal(sent(), 3);
  // One answer, the listed calls, once: the same call again is a new call of this message — collected.
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "a kite, the second", reuse: false })).details?.collecting, sent()], [true, 3]);
  // …and that message ends with $0.30 in all, INSIDE the amount: no card, nobody is asked; the agent is told, makes the call again, and it runs.
  await ended();
  for (let i = 0; i < 100 && told().length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([(await cards()).filter((card) => card.state === "pending").length, (await cards()).length, told().length, sent()], [0, 1, 2, 3]);
  assert.match(told()[1], /inside the amount the user lets one message spend without asking/);
  endTold();
  next("turn-4");
  assert.equal((await w.ok("jc_generate_image", { prompt: "a kite, the second", reuse: false })).data.costUsd, 0.3);
  assert.equal(sent(), 4);
  // "Deny": nothing of the card is made. (Here the message's end is seen by the next message's first call.)
  next("turn-5");
  await w.fails("jc_generate_image", { prompt: "a kite, the fifth" }); await w.fails("jc_generate_image", { prompt: "a kite, the sixth" });
  next("turn-6");
  assert.equal((await w.fails("jc_generate_image", { prompt: "a kite, the fifth" })).details?.collecting, undefined, "the earlier message was decided first: its card is the question");
  const open_ = (await cards()).filter((card) => card.state === "pending");
  assert.deepEqual([open_.length, open_[0].totalUsd, sent()], [1, 0.6, 4]);
  await w.admin.call("jagentchill.provider.messageCard.resolve", { cardId: open_[0].cardId, decision: "deny" });
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "a kite, the fifth" })).code, (await w.fails("jc_generate_image", { prompt: "a kite, the sixth" })).code, sent()], ["PERMISSION_DENIED", "PERMISSION_DENIED", 4]);
  // A turn the person stopped: what it had collected is dropped — no card, and the agent is not woken.
  next("turn-7");
  await w.fails("jc_generate_image", { prompt: "a kite, the seventh" });
  turns.at(-1)!.outcome = "cancelled";
  for (let i = 0; i < 100 && told().length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  endTold();
  const before = told().length, collections = () => generation.messageCards.of(w.sessionKey).filter((card) => card.collecting).map((card) => card.messageId);
  assert.deepEqual(collections(), ["turn-7"]);
  await ended();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual([collections(), (await cards()).filter((card) => card.state === "pending").length, told().length, sent()], [[], 0, before, 4]);
});

test("Review 15 #2 — the Auto allowance counts what is still PROVISIONAL: a turn of the session whose usage Usage does not know yet stands at its reserved bound ($4.90) — with it a $0.40 picture is past the $5 allowance and the card is asked (nothing is sent); when that turn settles at $1 the same picture runs unasked", async () => {
  const w = await agentWorld();
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.4 } } });
  w.stub.bill({ image: 0.4 });
  const auto = await w.session(w.admin, w.project.doc.metadata.id, "auto"), sent = () => generationCalls(w.stub).length, gate = w.h.app.generation.gate;
  // Usage has the record of the turn, WITHOUT its cost (TEST DOUBLE for Usage's reader; the tree it reads stays the host's).
  const records: { runId: string; costUsd?: number; started_ms: number }[] = [{ runId: "turn-1", started_ms: Date.now() - 1000 }];
  gate.bindUsage(async () => 0, async (sessionKey) => (sessionKey === auto ? records.map((entry) => ({ ...entry })) : []));
  // The turn went through the gate with a bound of $4.90 (a run's step in this session): its charge is provisional.
  gate.cover({ fixedId: "run:provisional", kind: "workflow.run", owner: "run:provisional", amountUsd: 10, models: ["runtime:acme/chat"] });
  await gate.guardTurn(async (_device: string, input: { sessionKey?: string; onTurn?(runId: string): void }) => { input.onTurn?.("turn-1"); return { text: "done", sessionKey: auto }; })("run:provisional", { providerId: "acme", modelId: "chat" }, "dev", { sessionKey: auto }, 4.9);
  const before = sent(), asked = await w.fails("jc_generate_image", { prompt: "a kite beside a turn nobody has billed yet" }, auto);
  assert.deepEqual([asked.code, sent()], ["APPROVAL_PENDING", before], "$4.90 still provisional + $0.40 is past $5");
  const card = (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: auto })).requests[0];
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: card.requestId, decision: "deny" });
  records[0].costUsd = 1;
  await gate.usageUpdated(auto);
  assert.equal((await w.ok("jc_generate_image", { prompt: "a kite after the turn settled at one dollar" }, auto)).data.costUsd, 0.4);
});

test("Review 16 #5 — outstanding spending that cannot be BOUNDED is not zero: with a turn of the session held by the gate at 'price not known' (no bound, Usage has no cost for it yet) a $0.40 picture under a $5 Auto allowance is asked on the card and nothing is sent — and so it is with an ended turn on a model billed per call of which Usage has a record with no cost; when the turn settles at $1 the same picture runs unasked; a turn with no cost on the person's own signed-in account stands in nobody's way", async () => {
  const w = await agentWorld();
  await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.4 } } });
  w.stub.bill({ image: 0.4 });
  const auto = await w.session(w.admin, w.project.doc.metadata.id, "auto"), sent = () => generationCalls(w.stub).length, gate = w.h.app.generation.gate;
  // Usage has the record of the turn, WITHOUT its cost (TEST DOUBLE for Usage's reader; the tree it reads stays the host's). The last record is the message that is being written.
  const records: { runId: string; costUsd?: number; started_ms: number; billedByCall?: boolean }[] = [{ runId: "turn-1", started_ms: Date.now() - 1000, billedByCall: true }, { runId: "now", started_ms: Date.now(), billedByCall: true }];
  gate.bindUsage(async () => 0, async (sessionKey) => (sessionKey === auto ? records.map((entry) => ({ ...entry })) : []));
  // The turn went through the gate with NO bound (a model approved by name at a price that is not known): its charge is provisional and has no amount.
  gate.cover({ fixedId: "run:unbounded", kind: "workflow.run", owner: "run:unbounded", amountUsd: 10, models: [], unpriced: ["runtime:acme/chat"] });
  await gate.guardTurn(async (_device: string, input: { sessionKey?: string; onTurn?(runId: string): void }) => { input.onTurn?.("turn-1"); return { text: "done", sessionKey: auto }; })("run:unbounded", { providerId: "acme", modelId: "chat" }, "dev", { sessionKey: auto }, null);
  assert.deepEqual(gate.unsettledOf(new Set([auto])), { usd: 0, unknown: 1 });
  const deny = async (): Promise<void> => { const requests = (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: auto })).requests as { requestId: string; state?: string }[], card = requests.find((entry) => entry.state === "pending") ?? requests.at(-1)!; await w.admin.call("jagentchill.chat.approval.resolve", { requestId: card.requestId, decision: "deny" }); };
  const before = sent(), asked = await w.fails("jc_generate_image", { prompt: "a kite beside a turn nobody can bound" }, auto);
  assert.deepEqual([asked.code, sent()], ["APPROVAL_PENDING", before], "an unbounded turn outstanding: the $5 allowance cannot be said to cover $0.40 more");
  await deny();
  // The gate's charge is settled at $1; an EARLIER ended turn on a per-call model still has no cost in Usage: the same.
  records[0].costUsd = 1;
  await gate.usageUpdated(auto);
  assert.deepEqual(gate.unsettledOf(new Set([auto])), { usd: 0, unknown: 0 });
  records.unshift({ runId: "turn-0", started_ms: Date.now() - 5000, billedByCall: true });
  assert.deepEqual([(await w.fails("jc_generate_image", { prompt: "a kite beside a turn Usage has no cost for" }, auto)).code, sent()], ["APPROVAL_PENDING", before]);
  await deny();
  // That turn ran on the person's own signed-in account: its missing cost is no money of this app — the picture runs unasked.
  records[0].billedByCall = false;
  assert.equal((await w.ok("jc_generate_image", { prompt: "a kite after the turn settled at one dollar" }, auto)).data.costUsd, 0.4);
});
