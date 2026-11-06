// The PROVIDER in these tests is a TEST DOUBLE: `scripts/stub-generation.ts`, a local server that speaks OpenRouter's wire
// format (its video endpoints: `GET /videos/models`, `POST /videos`, `GET /videos/{id}`, `GET /videos/{id}/content`) and
// returns a clip it makes itself with ffmpeg (a moving test pattern). The server's real adapter, queue, spend gate,
// budgets, blob store and ffprobe run against it. Nothing here calls a real provider; nothing costs money.
import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { startStubGeneration, type StubGeneration } from "../scripts/stub-generation.ts";
import { videoPriceOf } from "../src/generation/openrouter.ts";
import { ServerConfigFile } from "../src/store/server-config.ts";
import { createHarness, tick, type Harness } from "./harness.ts";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } } });
const KEY = "sk-or-stub-0123456789abcd", MODEL = "stub/video-fast";
type Device = Awaited<ReturnType<Harness["pair"]>>;

async function setup(videoPollMs = 20) {
  const stub: StubGeneration = await startStubGeneration();
  const h = await createHarness({ extra: { generation: { openRouterBaseUrl: stub.url, videoPollMs, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } } } });
  open.push(stub, h);
  const admin = await h.pair("Studio Mac", "admin");
  await admin.call("jagentchill.job.subscribe", {});
  await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", KEY);
  await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 5 } });
  return { h, admin, stub };
}
/** The Video role of Model routing gets one profile: the double's video model. */
async function routeVideo(admin: Device, model = MODEL) {
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [model], enabled: true });
  const state = await admin.call("jagentchill.orc.config.get", {});
  await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { video: { enabled: true, profiles: [{ id: "main", provider: "openrouter", model, params: {}, enabled: true }], defaultProfileId: "main", routes: { default: { primary: { profileId: "main" } , fallbacks: [] } }, limits: {} } } } });
}
const done = async (h: Harness, jobId: string) => { const job = await h.app.generation.settled(jobId); await tick(5); return job; };
/** A still on the host (drawn by the double), to start a clip from. */
const still = async (h: Harness, admin: Device) => (await done(h, (await admin.yes("jagentchill.generation.create", { capability: "image", params: { prompt: "a red kite over the sea", aspectRatio: "3:2" } })).job.jobId)).results[0].blobId as string;
const clip = (blobId: string, prompt = "the kite climbs, slow push in") => ({ capability: "video", params: { prompt, durationSeconds: 4, resolution: "720p", aspectRatio: "16:9", referenceBlobIds: [blobId] } });
const posts = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/videos");

test("W7 video — the price of a second of video is read from the provider's own list, for the request this product sends (no sound, from a picture); a list that cannot be stated per second gives NO price", () => {
  // Rows as the real list wrote them on 2026-10-08.
  assert.deepEqual(videoPriceOf({ duration_seconds_with_audio: "0.08", duration_seconds_without_audio: "0.05", duration_seconds_with_audio_720p: "0.05", duration_seconds_without_audio_720p: "0.03" }, ["720p", "1080p"]), { kind: "per_second", usd: 0.05, tiers: [{ when: { resolution: "720p" }, usd: 0.03 }] }, "veo-3.1-lite: without sound; 720p at its own line, any other resolution at the plain one");
  assert.deepEqual(videoPriceOf({ cents_per_image_input: "1", cents_per_video_output_second_480p: "2", cents_per_video_output_second_720p: "3", cents_per_video_output_second_1080p: "14" }, ["480p", "720p", "1080p"]), { kind: "per_second", usd: 0.14, tiers: [{ when: { resolution: "480p" }, usd: 0.02 }, { when: { resolution: "720p" }, usd: 0.03 }, { when: { resolution: "1080p" }, usd: 0.14 }], referenceUsd: 0.01 }, "grok-imagine-video-1.5-lite: cents, a picture given costs its own line, and with no plain line the base is the DEAREST resolution");
  assert.deepEqual(videoPriceOf({ text_to_video_duration_seconds_480p: "0.04", text_to_video_duration_seconds_720p: "0.08", image_to_video_duration_seconds_720p: "0.10", text_to_video_duration_seconds_1080p: "0.12", image_to_video_duration_seconds_1080p: "0.15" }, ["720p", "1080p"]), { kind: "per_second", usd: 0.15, tiers: [{ when: { resolution: "720p" }, usd: 0.1 }, { when: { resolution: "1080p" }, usd: 0.15 }] }, "wan-2.6: the picture-to-video lines, never the text-to-video ones");
  assert.deepEqual(videoPriceOf({ duration_seconds_2k: "0.09", duration_seconds_480p: "0.02" }, ["480p", "2K"])?.tiers, [{ when: { resolution: "2K" }, usd: 0.09 }, { when: { resolution: "480p" }, usd: 0.02 }], "a resolution is written as the model's list writes it");
  assert.equal(videoPriceOf({ video_tokens: "0.0000035", video_tokens_without_audio: "0.0000035" }), undefined, "seedance: priced by the token — not statable for a clip");
  assert.equal(videoPriceOf({ cents_per_second_output: "28", minimum_cents_per_generation: "56" }), undefined, "a line this product does not understand might apply: no price rather than a wrong one");
  assert.equal(videoPriceOf({ duration_seconds: "0.13", reference_images: "0.04" }), undefined);
  assert.equal(videoPriceOf({}), undefined);
});

test("W7 video — Refresh: the provider's video list becomes catalogue rows of the video capability, off, with what each takes and what a second costs (with where the price is from); a model priced by the token has no price; an upscaler is not a model that makes a clip", async () => {
  const { admin } = await setup();
  const rows = Object.fromEntries((await admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "video" })).models.map((m: any) => [m.id, m]));
  assert.deepEqual(Object.keys(rows).sort(), ["stub/video-fast", "stub/video-tokens"]);
  const fast = rows[MODEL];
  assert.deepEqual([fast.enabled, fast.source, fast.metadata.durations, fast.metadata.resolutions, fast.metadata.aspectRatios, fast.metadata.frameImages, fast.metadata.resumable, fast.metadata.cancellable], [false, "fetched", [4, 6, 8, 10], ["480p", "720p"], ["16:9", "9:16", "1:1"], ["first_frame"], true, false]);
  assert.deepEqual([fast.pricing.kind, fast.pricing.usd, fast.pricing.tiers, fast.pricing.referenceUsd, fast.pricing.source.kind], ["per_second", 0.03, [{ when: { resolution: "480p" }, usd: 0.02 }, { when: { resolution: "720p" }, usd: 0.03 }], 0.01, "provider-list"]);
  assert.equal(rows["stub/video-tokens"].pricing, undefined, "priced by the token: price not known");
  // The provider is now one that serves video — but nothing is routable until a model is on.
  const state = (await admin.call("jagentchill.provider.list", {})).capabilities.find((c: any) => c.capability === "video");
  assert.deepEqual([state.available, state.reason], [false, "No provider is configured for video"]);
});

test("W7 video — a clip from a still: with the Video role routed, a request that names no model is ACCEPTED by the provider as a task, asked about until it is made, and its file stored as a video with its length; the still rides as the first frame, small and re-encoded; it is asked for without sound; the estimate and the bill are the list's", async () => {
  const { admin, h, stub } = await setup();
  const blobId = await still(h, admin);
  assert.equal((await admin.fail("jagentchill.generation.create", clip(blobId))).code, "NO_ROUTE", "no model is on for video yet");
  await routeVideo(admin);
  const estimate = await admin.call("jagentchill.provider.estimate", { items: [clip(blobId)] });
  assert.deepEqual([estimate.items[0].model, estimate.items[0].amountUsd, estimate.items[0].basis], [MODEL, 0.13, "Per second"], "4 s at $0.03 and one picture at $0.01");
  const job = await done(h, (await admin.yes("jagentchill.generation.create", clip(blobId))).job.jobId);
  assert.deepEqual([job.state, job.capability, job.model, job.resumable, job.cancellable], ["succeeded", "video", MODEL, true, false]);
  const asset = job.results[0];
  assert.deepEqual([asset.kind, asset.mime, asset.width, asset.height, Math.round(asset.durationSeconds ?? 0), asset.provenance.model, asset.provenance.referenceAssetIds], ["video", "video/mp4", 320, 180, 4, MODEL, [blobId]]);
  assert.equal(job.actualUsd, 0.13, "what the provider said the task cost");
  const sent = posts(stub);
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].video!.duration, sent[0].video!.resolution, sent[0].video!.aspect, sent[0].video!.audio, sent[0].video!.frames.map((frame) => [frame.type, frame.kind])], [4, "720p", "16:9", false, [["first_frame", "jpeg"]]]);
  assert.ok(stub.calls.filter((call) => call.path === "/videos/:id").length >= 2, "asked about more than once");
  assert.equal(stub.calls.filter((call) => call.path === "/videos/:id/content").length, 1);
  // A length, a resolution or a shape the model's list does not have is refused here, before anything is sent.
  const wrong = await admin.fail("jagentchill.generation.create", { ...clip(blobId), params: { ...clip(blobId).params, durationSeconds: 5 } });
  assert.deepEqual([wrong.code, wrong.details.field, wrong.details.allowed], ["INVALID_PARAMS", "params.durationSeconds", [4, 6, 8, 10]]);
  assert.equal(posts(stub).length, 1);
});

test("W7 video — an ask that does not get through is not the end of the task, and an accepted task is never sent twice: two asks answered 503 → the same task is asked again and delivers; a task the provider reports failed ends the job with ONE request sent (the retry policy does not submit it again)", async () => {
  const { admin, h, stub } = await setup();
  const blobId = await still(h, admin);
  await routeVideo(admin);
  stub.failVideoAsks(2);
  const job = await done(h, (await admin.yes("jagentchill.generation.create", clip(blobId, "the kite dips and recovers"))).job.jobId);
  assert.deepEqual([job.state, posts(stub).length, stub.calls.filter((call) => call.path === "/videos/:id" && call.status === 503).length], ["succeeded", 1, 2]);
  const failed = await done(h, (await admin.yes("jagentchill.generation.create", clip(blobId, "the kite falls [video-fail]"))).job.jobId);
  assert.deepEqual([failed.state, failed.error?.class, failed.error?.details?.providerMessage, failed.attempts.length, posts(stub).length], ["failed", "server_error", "The model could not make this video", 1, 2]);
  const refused = await done(h, (await admin.yes("jagentchill.generation.create", clip(blobId, "the kite burns [video-blocked]"))).job.jobId);
  assert.deepEqual([refused.state, refused.error?.class, posts(stub).length], ["failed", "content_blocked", 3]);
  assert.deepEqual(h.app.db.prepare("SELECT ref FROM budget_commits WHERE ref IN (?, ?)").all(`gen:${failed.jobId}`, `gen:${refused.jobId}`), [], "a task that ended without a bill keeps no reservation");
});

test("W7 video — resume after a restart: the host stops while the provider is still making the clip; the next start finds the task's handle in the store, asks about THAT task and stores its file — nothing is sent a second time", async () => {
  const { admin, h, stub } = await setup(60);
  const blobId = await still(h, admin);
  await routeVideo(admin);
  const { job } = await admin.yes("jagentchill.generation.create", clip(blobId, "the kite crosses the bay [video-asks:8]"));
  // Accepted: the provider's handle is in the store with the job, which is running.
  let stored: any;
  for (let i = 0; i < 100 && !stored?.task; i++) { await tick(20); stored = JSON.parse((h.app.db.prepare("SELECT json FROM gen_jobs WHERE job_id = ?").get(job.jobId) as { json: string }).json); }
  assert.deepEqual([stored.state, stored.task], ["running", stub.videoTasks()[0]]);
  // The host stops…
  h.app.generation.close();
  await tick(30);
  assert.equal((h.app.db.prepare("SELECT state FROM gen_jobs WHERE job_id = ?").get(job.jobId) as { state: string }).state, "running", "the stop itself ends nothing");
  // …and a new service over the same store is what a restart is.
  const { createGenerationService } = await import("../src/generation/service.ts"), { createOpenRouterAdapter } = await import("../src/generation/openrouter.ts");
  const again = createGenerationService({ db: h.app.db, config: new ServerConfigFile(join(h.dataDir, "config.json")), secrets: h.app.secrets, now: Date.now, dataDir: h.dataDir, blobs: h.app.sync.blobs, probe: (path: string) => h.app.sync.mediaJobs.probe(path), broadcast: () => undefined, adapters: [createOpenRouterAdapter({ baseUrl: stub.url, videoPollMs: 20 })] });
  open.push(again);
  const ended = await again.settled(job.jobId);
  assert.deepEqual([ended.state, ended.results[0]?.kind, Math.round(ended.results[0]?.durationSeconds ?? 0)], ["succeeded", "video", 4]);
  assert.equal(posts(stub).length, 1, "the request was sent once");
  assert.equal(new Set(stub.calls.filter((call) => call.path === "/videos/:id").map((call) => call.task)).size, 1, "one task was asked about");
  assert.equal(ended.actualUsd, 0.13);
});

test("W7 video — cancel: the waiting stops at once and the job says the provider can still bill it (the provider documents no way to cancel a task)", async () => {
  const { admin, h, stub } = await setup(40);
  const blobId = await still(h, admin);
  await routeVideo(admin);
  const { job } = await admin.yes("jagentchill.generation.create", clip(blobId, "the kite hangs still [video-asks:500]"));
  for (let i = 0; i < 100 && !stub.videoTasks().length; i++) await tick(20);
  await tick(60);
  const cancelled = (await admin.call("jagentchill.job.cancel", { jobId: job.jobId })).job;
  assert.deepEqual([cancelled.state, cancelled.warnings.includes("The provider can still bill this request")], ["cancelled", true]);
  await tick(100);
  const asks = stub.calls.filter((call) => call.path === "/videos/:id").length;
  await tick(200);
  assert.equal(stub.calls.filter((call) => call.path === "/videos/:id").length, asks, "nothing is asked after the cancel");
  assert.equal(posts(stub).length, 1);
});
