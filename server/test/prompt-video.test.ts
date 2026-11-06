// TEST DOUBLES: the MODEL is the fake agent runtime of `harness.ts` (each writing turn is answered by this file) and the
// generation PROVIDER is `scripts/stub-generation.ts` (one-colour PNGs, sine tones). The workflow engine, the step tools,
// sessions, the generation service with its budgets and cache, ffprobe, the blob store and the document store are real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import { promptVideo as pv, validateProjectDocument } from "@jagentchill/editor-core";
import type { ProjectDocument, WorkflowExecution } from "@jagentchill/protocol";
import { startStubGeneration, type StubGeneration } from "../scripts/stub-generation.ts";
import { createWorkflowService } from "../src/workflows/service.ts";
import { createPromptVideo } from "../src/workflows/templates/prompt-video.ts";
import { createAggregatorCatalogue } from "../src/providers/aggregator.ts";
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
import { createHarness, model as runtimeModel, SAMPLE_MODELS, tick, type Harness } from "./harness.ts";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } } });
type Device = Awaited<ReturnType<Harness["pair"]>>;
type Answers = Partial<Record<"brief" | "script" | "shots" | "look", (attempt: number, message: string) => string>>;

const BRIEF = {
  title: "Tea at dawn", intent: "story", audience: "Tea drinkers", tone: "calm", keyMessages: [{ text: "Tea starts the day", evidence: "assumption" }],
  structure: [{ label: "Open", targetDuration_s: 4 }, { label: "Close", targetDuration_s: 6 }], visualStyle: { text: "Soft morning light", palette: ["#112233", "#445566", "#778899"] },
  narrationPolicy: "voiceover", musicDirection: "Quiet strings", openQuestions: [{ id: "q1", question: "Which tea?", suggestedAnswers: ["Green", "Black"] }],
};
const words = (seconds: number) => Array.from({ length: Math.max(1, Math.round(seconds * 2.5)) }, (_value, index) => `word${index}`).join(" ");
/** What a model that follows the prompt answers: a script that reads in the time the prompt names, one shot per segment. */
const DEFAULTS: Required<Answers> = {
  brief: () => JSON.stringify(BRIEF),
  script: (_attempt, message) => {
    const spoken = /must take ([\d.]+) s/.exec(message), silent = /must last (\d+) s/.exec(message), count = 3;
    return JSON.stringify({ title: "Tea", segments: Array.from({ length: count }, (_value, index) => (spoken ? { beatLabel: `Beat ${index + 1}`, kind: "narration", text: words(Number(spoken[1]) / count) } : { beatLabel: `Beat ${index + 1}`, kind: "on-screen-text", text: `Line ${index + 1}`, estimatedDuration_s: Number(silent![1]) / count })) });
  },
  shots: (_attempt, message) => JSON.stringify({ shots: [...message.slice(message.indexOf("Script segments:")).matchAll(/"id": "(seg_\d+)"/g)].map((match, index) => ({ segmentIds: [match[1]], duration_s: 3, description: `Picture ${index + 1} of the tea`, cameraMotion: index ? "static" : "push-in" })) }),
  // The Vision model, shown a picture of the working film (the film engine's own question).
  look: () => JSON.stringify({ shows: true, text: false, why: "A cup of tea on a table." }),
};
/** The shot list of a model that sets every shot in one place: the film engine then draws each with the shot before it as a reference. */
const oneKitchen: Answers["shots"] = (attempt, message) => JSON.stringify({ shots: (JSON.parse(DEFAULTS.shots(attempt, message)) as { shots: Record<string, unknown>[] }).shots.map((shot) => ({ ...shot, setting: "A kitchen at dawn" })) });

type Price = { inputPerMillionUsd: number; outputPerMillionUsd: number; source: "admin" };
/** What a host that is `measured` knows of opus (ruling R10): the prompt of a first request to it, as measured, and its documented longest answer — in tokens. */
const MEASURED_PROMPT = 10_000, MAX_OUTPUT = 12_000;
const FREE: Price = { inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "admin" };
/** The Claude Code catalogue of these tests: the harness's, and one more model a person may name. */
const MODELS = { ...SAMPLE_MODELS, "claude-code": [...SAMPLE_MODELS["claude-code"]!, runtimeModel("haiku", { input: ["text", "image"] })] };
/**
 * The Claude Code CLI of a host is signed in with an API KEY (its own status command says so): its turns are billed per
 * call at the model's price — as the turns of the removed built-in models were (ruling R9). The host reads the sign-in
 * when it starts: its clock (`skew`) is moved past the time a reading holds, the new reading is waited for, and the clock
 * is put back (a reading taken "in the future" stays fresh; devices sign their requests with the true time).
 */
async function billedByKey(h: Harness, skew: { ms: number }): Promise<void> {
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  skew.ms += LOGIN_STALE_MS + 1;
  const billing = () => h.app.generation.gate.billingOf({ ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } });
  for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
  skew.ms = 0;
  assert.equal(billing(), "per_call", "Claude Code is billed per call");
}
async function setup(options: { connect?: boolean; /** false: the host has no stored consent to send pictures or recordings to the provider (a run must ask). */ consent?: boolean; /** Ruling R10: opus has RUN on this host and has a documented maximum output — a first request to it was measured at `MEASURED_PROMPT` tokens (a Usage row, `h.measured`) and its longest answer is `MAX_OUTPUT` tokens. Without it a turn on a priced opus is "price not known". */ measured?: boolean; /** false: the reader and the listener keep the double's own list prices — which nobody can compute before the sound exists: both are "price not known". */ sound?: boolean } = {}) {
  const stub: StubGeneration = await startStubGeneration();
  // The chat models of the test host have a KNOWN price — free, unless a test sets one (`prices.set`): a model whose
  // price is not known is refused until a person allows it by name, which is what one test below is about.
  const prices = { now: FREE as Price | undefined, set(next: Price | undefined) { prices.now = next; } };
  // (The context window — 200,000, as a real model's — is in the catalogue and prices nothing since R10.)
  const skew = { ms: 0 };
  const h = await createHarness({ now: () => Date.now() + skew.ms, models: options.measured ? { ...MODELS, "claude-code": MODELS["claude-code"]!.map((entry) => (entry.id === "opus" ? { ...entry, contextWindow: 200_000 } : entry)) } : MODELS, extra: { modelPrice: () => prices.now, ...(options.measured ? { modelMaxOutput: () => MAX_OUTPUT } : {}), generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [20, 40], jitter: () => 0, circuitMs: 50 } } } });
  open.push(stub, h);
  await billedByKey(h, skew);
  const admin = await h.pair("Studio Mac", "admin");
  if (options.measured) h.measured({ runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" }, MEASURED_PROMPT);
  if (options.connect !== false) {
    await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    // (w2-film-engine-13, ruling R4) TEST-WORLD PRICES: the double's list prices its reader and its listener per token, sound included — a price nobody can compute before the sound exists, so both would be "price not known". This host's person gave the reader a price per character and the listener its shipped price per call.
    if (options.sound !== false) {
      await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
      await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.00002 } } });
    }
    // Most tests are about something else than consent: the host has allowed pictures and recordings to go to the provider.
    if (options.consent !== false) await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["image", "audio"] });
  }
  // The model: every writing turn is answered from the marker in its first line.
  const counts: Record<string, number> = {}, messages: string[] = [];
  let seen = 0, answers: Answers = {}, paused = false;
  const timer = setInterval(() => {
    if (paused) return;
    const sends = h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>;
    for (; seen < sends.length; seen++) {
      const call = sends[seen], kind = /\[\[jc-(?:video|film):(\w+)\]\]/.exec(call.message)?.[1] as keyof Answers | undefined;
      if (!kind) continue;
      messages.push(call.message);
      const attempt = (counts[kind] = (counts[kind] ?? 0) + 1);
      try { h.fake.reply(call.sessionKey, (answers[kind] ?? DEFAULTS[kind])(attempt, call.message)); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  return { h, admin, stub, counts, messages, prices, model: { set(next: Answers) { answers = next; }, pause(value: boolean) { paused = value; }, /** Turns sent so far are never answered: their host is gone. */ drop() { seen = h.fake.callsOf("startTurn").length; } } };
}
/** A start as the form sends it once a person confirmed the estimate. Most tests are about something else than money, and the test provider bills more than its list price: the confirmed amount is ample. */
const form = (patch: Partial<pv.VideoParams> = {}, confirmedUsd: number | null = 5) => ({ ...(confirmedUsd === null ? {} : { confirmedUsd }), params: { ...pv.DEFAULT_PARAMS, prompt: "A short film about tea", targetDuration_s: 10, mode: "auto", model: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" }, ...patch } });
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let value = await read();
  for (let n = 0; n < 1500 && !done(value); n++) { await tick(10); value = await read(); }
  if (!done(value)) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value).slice(0, 600)}`);
  return value;
}
const runOf = async (device: Device, runId: string) => (await device.call("jagentchill.workflow.run.get", { runId })).run as { status: string; error?: { code: string; message: string }; failedNodeId?: string; pauseReason?: string; outputs?: Record<string, any> };
const ended = (device: Device, runId: string, status = "succeeded") => until(() => runOf(device, runId), (run) => ["succeeded", "failed", "cancelled"].includes(run.status) || run.status === status, `run ${status}`);
const execs = async (device: Device, runId: string): Promise<Record<string, WorkflowExecution>> => Object.fromEntries(((await device.call("jagentchill.workflow.run.executions", { runId })).executions as WorkflowExecution[]).map((exec) => [exec.nodeId, exec]));
function project(h: Harness, projectId: string): ProjectDocument {
  const row = h.app.sync.documents.row({ kind: "project", id: projectId });
  assert.ok(row && row.state === "active", "the project is in the host's document store");
  return h.app.sync.documents.head(row) as unknown as ProjectDocument;
}
const track = (document: ProjectDocument, name: string) => [...document.scenes[0].tracks.overlay, ...document.scenes[0].tracks.audio].find((entry) => entry.name === name) as unknown as { elements: Array<Record<string, any>> } | undefined;

test("Fresh host with a language model and an image model: one prompt becomes a real project with pictures, voice, captions and music", async () => {
  const { h, admin, stub } = await setup();
  // The template is a workflow document of the host, kept out of the list of the person's own workflows.
  const template = await admin.call("jagentchill.workflow.get", { workflowId: "tpl.one-prompt-video" });
  assert.deepEqual([template.document.meta.origin, template.document.meta.protected, template.validation.errors.length], ["template", true, 0]);
  assert.deepEqual((await admin.call("jagentchill.workflow.list")).workflows, []);
  const { run } = await admin.call("jagentchill.workflow.video.start", form());
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const document = project(h, done.outputs!.project.projectId);
  assert.ok(validateProjectDocument(document, { mode: "strict" }).ok);
  const main = document.scenes[0].tracks.main.elements as Array<Record<string, any>>;
  assert.equal(main.length, 3);
  assert.ok(main.every((element) => element.type === "image" && element.workflowLink.runId === run.id));
  assert.ok(main[0].animations["transform.scale.x"], "the push-in shot has its motion");
  assert.equal(track(document, "Voiceover")!.elements.length, 3);
  assert.ok(track(document, "Captions")!.elements.length >= 3);
  assert.ok(track(document, "Music")!.elements.length >= 2, "the 3 s music repeats under a longer timeline");
  assert.equal(document.metadata.name, "Tea at dawn");
  assert.deepEqual(document.settings.canvasSize, { width: 1080, height: 1920 });
  // Every file of the timeline is a real file in the host's blob store, with the provider's provenance.
  for (const asset of document.media.assets as Array<Record<string, any>>) { assert.equal(h.app.sync.blobs.status(asset.contentHash).state, "complete"); assert.equal(asset.provenance.source, "ai"); }
  assert.equal(stub.calls.filter((call) => call.path === "/images").length, 3);
  const report = done.outputs!.report as pv.ReviewReport;
  assert.equal(report.shots, 3);
  assert.ok(report.duration_s >= 8 && report.duration_s <= 12, `duration ${report.duration_s}`);
  assert.equal(report.passed, true);
  const steps = await execs(admin, run.id);
  assert.ok((steps.assets.outputs!.costUsd as number) > 0, "the pictures' cost is recorded on the step");
  assert.ok(steps.brief.sessionKey, "the writing step links to its session");
});

test("Estimate displayed: the form gets the cost range, a per-step table and the assumed shot count before anything runs", async () => {
  const { admin, stub } = await setup();
  const answer = await admin.call("jagentchill.workflow.video.estimate", form({ targetDuration_s: 30 }));
  assert.ok(answer.estimate.assumptions.includes("8 shots"));
  assert.deepEqual(answer.estimate.stages.map((stage: { stage: string }) => stage.stage), ["brief", "script_draft", "shot_list", "assets", "voiceover", "voice_check", "music", "assemble"]);
  assert.ok(answer.estimate.lowUsd > 0 && answer.estimate.highUsd >= answer.estimate.lowUsd);
  assert.deepEqual(answer.capabilities, { image: true, speech: true, music: true });
  assert.ok(answer.voices.length > 0);
  assert.equal(stub.calls.filter((call) => call.path !== "/key" && call.path !== "/models" && call.path !== "/credits").length, 0, "an estimate makes no generation request");
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 0);
});
test("Neither prompt nor script: a start without a prompt is refused with WORKFLOW_INPUT_INVALID naming prompt", async () => {
  const { admin } = await setup();
  const empty = await admin.fail("jagentchill.workflow.video.start", form({ prompt: " " }));
  assert.deepEqual([empty.code, empty.details.parameter, empty.message], ["WORKFLOW_INPUT_INVALID", "prompt", "Write a prompt or choose a script"]);
  assert.equal((await admin.fail("jagentchill.workflow.video.start", form({ prompt: "x".repeat(4001) }))).message, "Prompt must be 4,000 characters or fewer");
});
test("No way to obtain pictures: a host without an image provider refuses the start and says what to connect", async () => {
  const { admin } = await setup({ connect: false });
  const answer = await admin.call("jagentchill.workflow.video.estimate", form());
  assert.deepEqual(answer.capabilities, { image: false, speech: false, music: false });
  const refused = await admin.fail("jagentchill.workflow.video.start", form());
  assert.equal(refused.code, "NO_ROUTE");
  assert.match(refused.message, /connect an image provider/);
});

test("Invalid brief is corrected: the problems go back to the model and its second answer is used", async () => {
  const { admin, model, counts, messages } = await setup();
  model.set({ brief: (attempt) => (attempt === 1 ? JSON.stringify({ title: "Only a title" }) : JSON.stringify(BRIEF)) });
  const { run } = await admin.call("jagentchill.workflow.video.start", form());
  assert.equal((await ended(admin, run.id)).status, "succeeded");
  assert.equal(counts.brief, 2);
  assert.match(messages.filter((message) => message.includes("[[jc-video:brief]]"))[1], /not accepted:\n- `audience` must be 1–200 characters/);
});
test("Still invalid after corrections: the step fails with the contract's code after two corrections and can be retried", async () => {
  const { admin, model, counts } = await setup();
  model.set({ brief: () => "I cannot do that." });
  const { run } = await admin.call("jagentchill.workflow.video.start", form());
  const failed = await ended(admin, run.id, "failed");
  assert.deepEqual([failed.status, failed.error!.code, failed.failedNodeId, counts.brief], ["failed", "WORKFLOW_OUTPUT_INVALID", "brief", 3]);
  model.set({});
  await admin.call("jagentchill.workflow.node.retry", { runId: run.id, nodeId: "brief", path: "" });
  assert.equal((await ended(admin, run.id)).status, "succeeded");
});

test("Budget stop: a spending limit of the host stops the run at the step that would pass it, and the run continues after the limit is raised", async () => {
  const { admin, stub, model } = await setup();
  // The pictures are asked at quality "low": $0.003 each by the catalogue. The smallest limit a budget takes, $0.01, lets
  // three through and stops the fourth of the five this script needs; at the default quality ($0.034) not one would fit.
  model.set({ script: (_attempt, message) => JSON.stringify({ title: "Tea", segments: Array.from({ length: 5 }, (_value, index) => ({ beatLabel: `Beat ${index + 1}`, kind: "on-screen-text", text: `Line ${index + 1}`, estimatedDuration_s: Number(/must last (\d+) s/.exec(message)![1]) / 5 })) }) });
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "provider", scopeId: "openrouter", limitUsd: 0.01, period: "month", hardStop: true } });
  const blocked = await admin.call("jagentchill.workflow.video.estimate", form());
  assert.equal(blocked.blocked, undefined, "one picture still fits");
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }));
  // A person follows this run: the hard stop pauses it at the step, which is held with the refusal — nothing is failed.
  const stopped = await ended(admin, run.id, "paused");
  const held = (await execs(admin, run.id)).assets;
  assert.deepEqual([stopped.status, stopped.pauseReason, stopped.error, held.status, held.blockedBy, held.error?.code, (held.error?.details as { scope?: string }).scope], ["paused", "budget_exceeded", undefined, "ready", "budget_exceeded", "BUDGET_EXCEEDED", "provider"]);
  const paid = stub.calls.filter((call) => call.path === "/images").length;
  assert.equal(paid, 3, `${paid} of 5 pictures were paid for before the stop`);
  assert.deepEqual(stub.calls.filter((call) => call.path === "/images").map((call) => call.quality), Array(paid).fill("low"), "every picture is asked at the low quality tier");
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "provider", scopeId: "openrouter", limitUsd: 5, period: "month", hardStop: true } });
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  assert.equal((await ended(admin, run.id)).status, "succeeded");
  assert.equal(stub.calls.filter((call) => call.path === "/images").length, 5, "the pictures made before the stop were not made again");
});

test("Music model fails: the run goes on without music and says so", async () => {
  const { h, admin, model } = await setup();
  model.set({ brief: () => JSON.stringify({ ...BRIEF, musicDirection: "Strings [fail:503]" }) });
  const { run } = await admin.call("jagentchill.workflow.video.start", form());
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal(track(project(h, done.outputs!.project.projectId), "Music"), undefined);
  assert.equal((await execs(admin, run.id)).music.outputs!.music, null);
});
test("Skipped inputs: without voice, music and captions the project holds the pictures and the shown words only", async () => {
  const { h, admin } = await setup();
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none", captions: false }));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const document = project(h, done.outputs!.project.projectId);
  assert.equal(document.scenes[0].tracks.audio.length, 0);
  assert.deepEqual(document.scenes[0].tracks.overlay.map((entry) => entry.name), ["Titles"]);
  assert.equal(Math.round((done.outputs!.report as pv.ReviewReport).duration_s), 10);
});

test("Checkpoint after script: with checkpoints the run waits for a person at the brief, the script, the shot list and the review", async () => {
  const { admin } = await setup();
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ mode: "checkpoints", voice: "none", musicMood: "none" }));
  for (const nodeId of ["check_brief", "script_approve", "check_shot_list", "check_final"]) {
    const waiting = await until(() => execs(admin, run.id), (steps) => steps[nodeId]?.status === "waiting_approval", `${nodeId} to wait`);
    assert.equal((await runOf(admin, run.id)).status, "waiting_approval");
    if (nodeId === "check_brief") assert.equal((waiting[nodeId].request!.subject as pv.Brief).openQuestions[0].answer, "Green", "the brief's question arrives with its default answer");
    await admin.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId, path: "", outcome: "approved" });
  }
  assert.equal((await ended(admin, run.id)).status, "succeeded");
});

test("Regenerate the shot list: a stage runs again with the person's notes, an edited script replaces the old one, and one shot is made again alone", async () => {
  const { h, admin, stub, messages } = await setup();
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }));
  const first = await ended(admin, run.id);
  const images = () => stub.calls.filter((call) => call.path === "/images").length;
  assert.equal(images(), 3);
  // Notes for the writer: the script is written again and everything after it follows.
  await admin.call("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "script_draft", notes: "Make it warmer" });
  await until(() => runOf(admin, run.id), (state) => state.status === "running" || messages.some((message) => message.includes("Make it warmer")), "the run to reopen");
  await ended(admin, run.id);
  assert.ok(messages.some((message) => message.includes("[[jc-video:script]]") && message.includes('asked for these changes to the previous script: """Make it warmer"""')));
  assert.equal(images(), 3, "unchanged pictures come from the cache");
  // An edited script: no model writes, the shot list and the project follow the two lines that are left.
  const script = (await execs(admin, run.id)).script_approve.outputs!.subject as pv.Script;
  const edited = { ...script, segments: script.segments.slice(0, 2).map((segment) => ({ ...segment, estimatedDuration_s: 5 })) };
  const scripts = messages.filter((message) => message.includes("[[jc-video:script]]")).length;
  await admin.call("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "script_approve", outputs: { subject: edited } });
  await until(() => execs(admin, run.id), (steps) => steps.assemble?.status !== "succeeded", "the later steps to start again");
  const second = await ended(admin, run.id);
  assert.equal(second.status, "succeeded", JSON.stringify(second.error));
  assert.equal(messages.filter((message) => message.includes("[[jc-video:script]]")).length, scripts);
  assert.notEqual(second.outputs!.project.projectId, first.outputs!.project.projectId);
  assert.equal(project(h, second.outputs!.project.projectId).scenes[0].tracks.main.elements.length, 2);
  project(h, first.outputs!.project.projectId);
  // One shot again: one new request to the provider, the other picture stays.
  const before = images(), media = (await execs(admin, run.id)).assets.outputs!.shotMedia as pv.ShotMedia[];
  await admin.call("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "assets", notes: { shotId: media[1].shotId } });
  await until(() => execs(admin, run.id), (steps) => steps.assemble?.status !== "succeeded", "assembly to start again");
  assert.equal((await ended(admin, run.id)).status, "succeeded");
  assert.equal(images(), before + 1);
  // The stage's cost is what the run paid for pictures in all: the first three and the one made again, not the cache hits.
  assert.equal((await execs(admin, run.id)).assets.outputs!.costUsd, 0.044);
  assert.equal((await admin.fail("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "start" })).code, "WORKFLOW_NODE_NOT_ACTIVE");
});

test("App closed during a run: after a restart of the host a run waiting at a checkpoint goes on, and a step that was writing is started once more", async () => {
  const { h, admin, model, counts } = await setup();
  model.pause(true);
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ mode: "checkpoints", voice: "none", musicMood: "none" }));
  await until(() => h.fake.callsOf("startTurn").length, (sent) => sent === 1, "the brief's turn");
  // The host stops while the brief is being written: only the store is left.
  h.app.workflows.close();
  let next!: ReturnType<typeof createWorkflowService>;
  // The store of the working films holds what was confirmed for the run: the host that starts again reads it there.
  const filmDb = new DatabaseSync(join(h.dataDir, "prompt-video-films.sqlite"));
  open.push(filmDb);
  const video = createPromptVideo({ now: Date.now, workflows: () => next, generation: () => h.app.generation, sync: h.app.sync, filmDb, turnModel: () => ({ billedByCall: true, price: FREE }) });
  next = createWorkflowService({ db: h.app.db, now: Date.now, devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, stepTools: () => video.tools });
  open.push(next);
  model.drop();
  model.pause(false);
  await until(() => next.runs.executions(run.id, { nodeId: "check_brief" })[0], (exec) => exec?.status === "waiting_approval", "the brief checkpoint after the restart");
  const brief = next.runs.executions(run.id, { nodeId: "brief" })[0];
  assert.deepEqual(brief.attempts.map((attempt) => attempt.outcome), ["interrupted", "succeeded"]);
  assert.equal(h.fake.callsOf("startTurn").length, 2, "the interrupted turn and the one after the restart");
  assert.equal(counts.brief, 1);
  // A second restart while the run waits for a person: it is still waiting, and continues when answered.
  next.close();
  const again = createWorkflowService({ db: h.app.db, now: Date.now, devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, stepTools: () => video.tools });
  open.push(again);
  next = again;
  assert.equal(again.runs.record(run.id).status, "waiting_approval");
  const answer = { deviceId: admin.device.deviceId, role: () => "admin" as const };
  for (const nodeId of ["check_brief", "script_approve", "check_shot_list", "check_final"]) {
    await until(() => again.runs.executions(run.id, { nodeId })[0], (exec) => exec?.status === "waiting_approval", `${nodeId} to wait`);
    again.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, answer);
  }
  const done = await until(() => again.runs.record(run.id), (record) => record.status === "succeeded" || record.status === "failed", "the run to end");
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal(project(h, (done.outputs!.project as { projectId: string }).projectId).scenes[0].tracks.main.elements.length, 3);
});

// — w2: the pictures and the voice of a video are made by the film engine —
const VISION = { id: "main", runtime: "claude-code", provider: "anthropic", model: "opus", params: {}, enabled: true };
/** Model routing gives the Vision role a model: the film engine then shows it every picture. */
async function routeVision(admin: Device) {
  const state = await admin.call("jagentchill.orc.config.get", {});
  await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { vision: { enabled: true, profiles: [VISION], defaultProfileId: "main", routes: { default: { primary: { profileId: "main" }, fallbacks: [] } }, limits: {} } } } });
}
const waitingAt = (device: Device, runId: string, nodeId: string) => until(() => execs(device, runId), (steps) => steps[nodeId]?.status === "waiting_approval" || ["failed"].includes(steps.assets?.status ?? ""), `the run to wait at ${nodeId}`);
const speechCalls = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/audio/speech" && call.status === 200);

test("A video's voice goes through the film's one-recording-per-speaker path with the read-back check: the narrator is recorded ONCE for all lines, every take carries what the listener heard, and the review says so", async () => {
  const { h, admin, stub } = await setup();
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ musicMood: "none" }));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const steps = await execs(admin, run.id), takes = steps.voiceover.outputs!.takes as pv.Take[];
  assert.equal(takes.length, 3);
  // One request to the speech provider for the three lines of the one speaker, cut back into three files.
  assert.equal(speechCalls(stub).length, 1, JSON.stringify(speechCalls(stub).map((call) => call.text.slice(0, 40))));
  assert.equal(new Set(takes.map((take) => take.media.blobId)).size, 3);
  for (const take of takes) {
    assert.equal(take.check?.ok, true, JSON.stringify(take.check));
    assert.ok(take.check!.score >= 0.8 && take.check!.heard.length > 0 && take.check!.seconds > 0, "the take says what was heard, how well it matches and how long it is");
  }
  assert.ok(stub.calls.filter((call) => call.path === "/audio/transcriptions").length >= 3, "every line was listened to");
  const report = done.outputs!.report as pv.ReviewReport;
  assert.ok(report.findings.some((finding) => finding.code === "REVIEW_VOICE_CHECKED"), JSON.stringify(report.findings));
  // No Vision model is routed on this host: the pictures are kept WITHOUT a verdict and the review says they were not checked.
  assert.ok((steps.pictures.outputs!.shotMedia as pv.ShotMedia[]).every((entry) => entry.media && !entry.check));
  assert.ok(report.findings.some((finding) => finding.code === "REVIEW_FRAMES_UNAVAILABLE" && /3 of 3 pictures were not checked/.test(finding.message)));
  // The narration carries the script: the three lines are on the timeline, in the script's words.
  const document = project(h, done.outputs!.project.projectId);
  assert.equal(track(document, "Voiceover")!.elements.length, 3);
  // The working film is not a film of the Film Studio.
  assert.deepEqual((await admin.call("jagentchill.film.list", {})).films, []);
});

test("A video's pictures go through the film's reference and check path: a shot is drawn with the shot before it in its place, every picture is shown to the Vision model, and one it says is not the shot is drawn again", async () => {
  const { admin, stub, model, counts } = await setup();
  await routeVision(admin);
  // The second picture is refused once by the eye ("a poster"), then accepted.
  let looks = 0;
  model.set({ shots: oneKitchen, look: () => (++looks === 2 ? JSON.stringify({ shows: false, text: true, why: "A poster with the word TEA." }) : JSON.stringify({ shows: true, text: false, why: "A cup of tea in a kitchen." })) });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const media = (await execs(admin, run.id)).pictures.outputs!.shotMedia as pv.ShotMedia[];
  assert.deepEqual(media.map((entry) => [entry.check?.ok, entry.drawing]), [[true, 1], [true, 2], [true, 1]]);
  assert.equal(media[1].check!.why, "A cup of tea in a kitchen.");
  assert.equal(counts.look, 4, "three pictures, one of them looked at twice");
  // References: the first shot of the place is drawn from words, each later one WITH the picture before it — never more than five.
  const images = stub.calls.filter((call) => call.path === "/images" && call.status === 200);
  assert.deepEqual(images.map((call) => call.references ?? 0), [0, 1, 1, 1]);
  assert.ok(images.every((call) => (call.references ?? 0) <= 5));
  assert.ok((done.outputs!.report as pv.ReviewReport).findings.some((finding) => finding.code === "REVIEW_FRAMES_CHECKED"));
});

test("No consent question: a host whose provider is connected and enabled is sent what the video needs — references, pictures to check, recordings to listen to — and the run reaches its end in automatic mode without one stop", async () => {
  const { admin, stub, model } = await setup({ consent: false });
  await routeVision(admin);
  model.set({ shots: oneKitchen });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ musicMood: "none" }));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const after = await execs(admin, run.id);
  for (const ask of pv.PICTURE_ASKS) assert.ok(!after[ask] || ["pending", "skipped"].includes(after[ask].status), `${ask} never waited: ${after[ask]?.status}`);
  assert.ok((after.pictures.outputs!.shotMedia as pv.ShotMedia[]).every((entry) => entry.media && entry.check?.ok === true), "every picture was made and shown to the Vision model");
  assert.ok((after.voiceover.outputs!.takes as pv.Take[]).every((take) => take.check?.ok === true), "the recordings were listened to");
  assert.ok(stub.calls.filter((call) => call.path === "/images" && call.status === 200).some((call) => (call.references ?? 0) > 0), "a shot was drawn with the shot before it as a reference");
  assert.deepEqual((await admin.call("jagentchill.provider.consent.list", {})).consents, [], "nobody was asked, and nothing was stored as a consent");
});

test("A refused frame stops the run in 'needs you', also in automatic mode: the shot is named, a person deletes it, and the video goes on without it with its words told over the shot before", async () => {
  const { h, admin, stub, model } = await setup();
  model.set({ shots: (attempt, message) => JSON.stringify({ shots: (JSON.parse(DEFAULTS.shots(attempt, message)) as { shots: Record<string, unknown>[] }).shots.map((shot, index) => (index === 1 ? { ...shot, description: "A scene the provider will not draw [blocked]" } : shot)) }) });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ musicMood: "none" }));
  const steps = await waitingAt(admin, run.id, "fix_pictures");
  assert.equal(steps.fix_pictures?.status, "waiting_approval", JSON.stringify(steps.assets?.error));
  const asked = steps.fix_pictures.request as { title: string; instructions: string; subject: { refusedIds: string[] } };
  assert.equal(asked.title, "A shot could not be had");
  assert.match(asked.instructions, /refused to draw this shot under its content policy, also when asked in plainer words: Shot 2\./);
  assert.deepEqual(asked.subject.refusedIds, ["shot_2"]);
  // Asked twice (its words, then plainer words), never a third time by itself; the other two shots were drawn.
  assert.equal(stub.calls.filter((call) => call.path === "/images" && call.status !== 200).length, 2);
  const waiting = (steps.assets.outputs!.shotMedia as pv.ShotMedia[]).map((entry) => [!!entry.media, entry.refused?.reason]);
  assert.deepEqual(waiting, [[true, undefined], [false, "policy"], [true, undefined]]);
  assert.equal(steps.voiceover?.status ?? "pending", "pending", "the voice waits");
  // The person deletes the shot, then approves.
  const decided = await admin.call("jagentchill.workflow.video.shot", { runId: run.id, shotId: "shot_2", action: "delete" });
  assert.deepEqual((decided.shotMedia as pv.ShotMedia[]).map((entry) => entry.leftOut === true), [false, true, false]);
  await admin.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "fix_pictures", path: "", outcome: "approved" });
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const after = await execs(admin, run.id), kept = after.pictures.outputs!.shotList as pv.ShotList;
  assert.deepEqual(kept.shots.map((shot) => [shot.id, shot.segmentIds]), [["shot_1", ["seg_1", "seg_2"]], ["shot_3", ["seg_3"]]]);
  const document = project(h, done.outputs!.project.projectId);
  assert.equal(document.scenes[0].tracks.main.elements.length, 2);
  assert.equal(track(document, "Voiceover")!.elements.length, 3, "the narration still carries the whole script");
});

test("Replace with my media and bring a shot back: a person's own picture takes the place of a shot, a deleted shot leaves the timeline and comes back, and the timeline follows each decision", async () => {
  const { h, admin, stub } = await setup();
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }));
  const first = await ended(admin, run.id);
  assert.equal(first.status, "succeeded", JSON.stringify(first.error));
  const { png } = await import("../scripts/stub-generation.ts");
  const own = h.app.sync.blobs.put(png(640, 1138, [10, 200, 30]), { mime: "image/png", name: "mine.png", purpose: "media" });
  await admin.call("jagentchill.workflow.video.shot", { runId: run.id, shotId: "shot_2", action: "replace", blobId: own.sha256, name: "mine.png", width: 640, height: 1138 });
  await until(() => execs(admin, run.id), (steps) => steps.assemble?.status !== "succeeded", "assembly to start again");
  const second = await ended(admin, run.id);
  assert.equal(second.status, "succeeded", JSON.stringify(second.error));
  const media = (await execs(admin, run.id)).pictures.outputs!.shotMedia as pv.ShotMedia[];
  assert.deepEqual([media[1].media!.blobId, media[1].replaced, media[1].media!.provenance.source], [own.sha256, true, "imported"]);
  const document = project(h, second.outputs!.project.projectId);
  assert.ok((document.media.assets as Array<Record<string, any>>).some((asset) => asset.contentHash === own.sha256), "the person's picture is in the project");
  assert.notEqual(second.outputs!.project.projectId, first.outputs!.project.projectId);
  // Delete, then bring back: the shot is gone from the timeline, then drawn again and back.
  const images = () => stub.calls.filter((call) => call.path === "/images" && call.status === 200).length, before = images();
  await admin.call("jagentchill.workflow.video.shot", { runId: run.id, shotId: "shot_3", action: "delete" });
  await until(() => execs(admin, run.id), (steps) => steps.assemble?.status !== "succeeded", "assembly to start again");
  const third = await ended(admin, run.id);
  assert.equal(project(h, third.outputs!.project.projectId).scenes[0].tracks.main.elements.length, 2);
  assert.equal(images(), before, "deleting draws nothing");
  assert.equal((await admin.fail("jagentchill.workflow.video.shot", { runId: run.id, shotId: "shot_9", action: "delete" })).code, "NOT_FOUND");
  await admin.call("jagentchill.workflow.video.shot", { runId: run.id, shotId: "shot_3", action: "restore" });
  await until(() => execs(admin, run.id), (steps) => steps.assemble?.status !== "succeeded", "assembly to start again");
  const fourth = await ended(admin, run.id);
  assert.equal(fourth.status, "succeeded", JSON.stringify(fourth.error));
  assert.equal(project(h, fourth.outputs!.project.projectId).scenes[0].tracks.main.elements.length, 3);
});

test("Own script: a person's script is spoken as written — no model writes it, the video lasts as long as it reads, and a second caption language is the Translation role's work", async () => {
  const { h, admin, messages } = await setup();
  const own = "The kettle sings before the sun is up. Steam climbs the window.\nMai: Is it ready yet?\nShe pours two cups and waits.";
  const refused = await admin.fail("jagentchill.workflow.video.start", form({ prompt: "", script: "" }));
  assert.deepEqual([refused.code, refused.details.parameter], ["WORKFLOW_INPUT_INVALID", "prompt"]);
  // The amount the form shows for an own script is the amount the start asks for (both read the script's length): confirming exactly it starts the run.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const quoted = await admin.call("jagentchill.workflow.video.estimate", form({ prompt: "", script: own, targetDuration_s: 30, musicMood: "none", secondCaptionLanguage: "vi" }, null));
  const exact = await admin.call("jagentchill.workflow.video.start", form({ prompt: "", script: own, targetDuration_s: 30, musicMood: "none", secondCaptionLanguage: "vi" }, quoted.estimate.highUsd));
  await admin.call("jagentchill.workflow.run.cancel", { runId: exact.run.id });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ prompt: "", script: own, musicMood: "none", secondCaptionLanguage: "vi" }));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.ok(!messages.some((message) => message.includes("[[jc-video:script]]")), "no model wrote the script");
  const steps = await execs(admin, run.id), script = steps.script_draft.outputs!.script as pv.Script;
  assert.equal(script.segments.map((segment) => segment.text).join(" "), own.replace("Mai: ", "").replace(/\n/g, " "));
  assert.deepEqual(script.segments.map((segment) => [segment.kind, segment.speaker]), [["narration", "Narrator"], ["dialogue", "Mai"], ["narration", "Narrator"]]);
  // Two speakers, two recordings: the narrator's two lines in one, Mai's line in another.
  const takes = steps.voiceover.outputs!.takes as pv.Take[];
  assert.equal(takes.length, 3);
  assert.notEqual(takes[0].voiceId, takes[1].voiceId, "Mai does not speak with the narrator's voice");
  assert.equal(takes[0].voiceId, takes[2].voiceId);
  // The duration follows the script, and the review measures against it.
  const params = (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run.params as pv.VideoParams;
  assert.equal(params.targetDuration_s, pv.scriptDuration_s(script));
  assert.equal((done.outputs!.report as pv.ReviewReport).target_s, params.targetDuration_s);
  // No Translation model is routed on this host: the video keeps its own captions and says the second language is missing.
  const captions = steps.captions.outputs!.captions as pv.CaptionSet;
  assert.ok(captions.cues.length >= 3 && !captions.translationLanguage);
  assert.ok(captions.warnings.some((warning) => warning.startsWith("SECOND_CAPTIONS_UNAVAILABLE")), JSON.stringify(captions.warnings));
  project(h, done.outputs!.project.projectId);
});

test("Budget of a run: a video stops at the step that would pass its own budget, says what is left, and goes on after a person raises it", async () => {
  const { admin, stub, model } = await setup();
  // Five pictures at $0.003 each by the catalogue: a budget of $0.01 lets three be asked and refuses the fourth.
  model.set({ script: (_attempt, message) => JSON.stringify({ title: "Tea", segments: Array.from({ length: 5 }, (_value, index) => ({ beatLabel: `Beat ${index + 1}`, kind: "on-screen-text", text: `Line ${index + 1}`, estimatedDuration_s: Number(/must last (\d+) s/.exec(message)![1]) / 5 })) }) });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none", budgetUsd: 0.01 }));
  const stopped = await ended(admin, run.id, "paused");
  const steps = await execs(admin, run.id);
  assert.deepEqual([stopped.status, stopped.pauseReason, steps.assets.status, steps.assets.blockedBy, steps.assets.error?.code], ["paused", "budget_exceeded", "ready", "budget_exceeded", "BUDGET_EXCEEDED"]);
  assert.equal(stub.calls.filter((call) => call.path === "/images").length, 3, "three of the five pictures were paid for before the stop");
  const spend = await admin.call("jagentchill.workflow.video.spend", { runId: run.id });
  assert.deepEqual([spend.budgetUsd, spend.remainingUsd], [0.01, 0]);
  assert.ok(spend.spentUsd > 0, JSON.stringify(spend));
  // The budget is the run's own: another run of the host is not held by it.
  assert.deepEqual((await admin.call("jagentchill.provider.budget.list", {})).budgets.map((budget: { scope: string; scopeId: string }) => [budget.scope, budget.scopeId]), [["session", `run:${run.id}`]]);
  assert.equal((await admin.fail("jagentchill.workflow.video.budget", { runId: run.id, budgetUsd: 0 })).code, "INVALID_PARAMS");
  await admin.call("jagentchill.workflow.video.budget", { runId: run.id, budgetUsd: 1 });
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal(stub.calls.filter((call) => call.path === "/images").length, 5, "the retry made only the two that were missing");
  const after = await admin.call("jagentchill.workflow.video.spend", { runId: run.id });
  assert.equal(after.budgetUsd, 1);
  assert.ok(after.remainingUsd > 0.9 && after.spentUsd === Math.round((1 - after.remainingUsd) * 10_000) / 10_000, JSON.stringify(after));
});

// — w2: the chat agent starts and follows a run —
test("The chat agent starts a video with jc_workflow_start: the person is asked first with what it will cost, the allowed call starts the same run the form starts, jc_workflow_status follows it and says what waits for the person, and only its own run can be cancelled", async () => {
  const { h, admin, model } = await setup({ consent: false });
  model.set({ shots: (attempt, message) => JSON.stringify({ shots: (JSON.parse(DEFAULTS.shots(attempt, message)) as { shots: Record<string, unknown>[] }).shots.map((shot, index, all) => (index === all.length - 1 ? { ...shot, description: "A scene the provider will not draw [blocked]" } : shot)) }) });
  // TEST-WORLD PRICE (film-engine run 14, item 12): the double bills $0.011 a picture; the row says so here, so that the amount the card confirms (the estimate itself — not the form's $5) is what the pictures are then billed. With the shipped row ($0.003 at "low") two pictures ($0.022) pass 120 % of the $0.0181 confirmed and the run rightly stops at `assets`.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.011 } } });
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } })).session.sessionKey as string;
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  const tool = async (name: string, args: Record<string, unknown>) => (await h.app.tools.call(sessionKey, name, args)).envelope as { ok: boolean; data?: any; error?: { code: string; message: string; details?: any; retryable?: boolean } };
  const requests = () => admin.events.filter((entry) => entry.event === "jagentchill.chat.permission.requested").map((entry) => (entry.payload as { request: { requestId: string; toolLabel: string; detail: string } }).request);
  // Bad input is refused by the same rules as the form, before anyone is asked.
  const empty = await tool("jc_workflow_start", { templateId: "tpl.one-prompt-video", idempotencyKey: randomUUID() });
  assert.deepEqual([empty.ok, empty.error?.code, empty.error?.details?.parameter], [false, "WORKFLOW_INPUT_INVALID", "prompt"]);
  assert.equal((await tool("jc_workflow_start", { templateId: "tpl.unknown", prompt: "x", idempotencyKey: randomUUID() })).error?.code, "INVALID_PARAMS");
  const args = { templateId: "tpl.one-prompt-video", prompt: "A short film about tea", params: { targetDuration_s: 10, musicMood: "none" }, approvalOverride: "auto", idempotencyKey: randomUUID() };
  const dry = await tool("jc_workflow_start", { ...args, dryRun: true });
  assert.deepEqual([dry.ok, dry.data.provisional, dry.data.template, dry.data.estimate.lowUsd > 0], [true, true, "One prompt → video", true]);
  const pending = await tool("jc_workflow_start", args);
  assert.deepEqual([pending.ok, pending.error?.code], [false, "APPROVAL_PENDING"]);
  await until(() => requests(), (list) => list.length === 1, "the permission card");
  const card = requests()[0];
  assert.equal(card.toolLabel, "Start “One prompt → video”");
  assert.match(card.detail, /A video about: “A short film about tea”\n10 s, 9:16, English, with a voice, music: none, captions on\.\nEstimated cost \$/);
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 0, "nothing runs before the person allows it");
  await admin.call("jagentchill.chat.approval.resolve", { requestId: card.requestId, decision: "allow-once" });
  const started = await tool("jc_workflow_start", args);
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const runId = started.data.runId as string;
  const record = (await admin.call("jagentchill.workflow.run.get", { runId })).run;
  assert.deepEqual([record.workflowId, record.origin, record.originRef.sessionKey, record.params.mode], ["tpl.one-prompt-video", "agent", sessionKey, "auto"]);
  // The run reaches the stop only a person can answer (a shot the provider refused): the agent reads it, in words.
  await waitingAt(admin, runId, "fix_pictures");
  const status = await tool("jc_workflow_status", { runId, include: ["cost", "logs"] });
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.deepEqual([status.data.run.status, status.data.run.mine], ["waiting_approval", true]);
  assert.deepEqual(status.data.waitingForPerson.map((entry: { nodeId: string; title: string }) => [entry.nodeId, entry.title]), [["fix_pictures", "A shot could not be had"]]);
  assert.deepEqual(status.data.steps.filter((step: { status: string }) => step.status === "succeeded").map((step: { nodeId: string }) => step.nodeId).slice(0, 4), ["brief", "check_brief", "script_draft", "script_approve"]);
  assert.ok(Array.isArray(status.data.logs) && typeof status.data.costUsd === "number");
  const one = await tool("jc_workflow_status", { runId, nodeId: "script_draft", include: ["outputs"] });
  assert.match(JSON.stringify(one.data.steps[0].outputs.script), /seg_1/);
  // A person's own run is not the agent's to cancel; its own is.
  const mine = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none", mode: "checkpoints" }));
  assert.equal((await tool("jc_workflow_cancel", { runId: mine.run.id, idempotencyKey: randomUUID() })).error?.code, "NOT_FOUND");
  const cancelled = await tool("jc_workflow_cancel", { runId, reason: "The person changed their mind", idempotencyKey: randomUUID() });
  assert.deepEqual([cancelled.ok, cancelled.data?.status], [true, "cancelled"]);
  assert.equal((await runOf(admin, runId)).status, "cancelled");
});

test("Second caption language: with a translation model on and caption text allowed to go to its provider, every cue carries its translation and the project's caption track is bilingual", async () => {
  const { h, admin } = await setup();
  // An admin's settings: a translation model of the provider, and the host's consent for caption text there.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-only", label: "Stub Text", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, metadata: { maxOutputTokens: 4000, sources: { maxOutputTokens: "TEST DOUBLE: the stub provider's model list" } } } });
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-only"], enabled: true });
  await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["transcript"] });
  // (Film-engine run 14, rulings R6/R7: before the script exists nobody can count the captions, so the translation's row has no amount — "price not known", approved by its model's name. The requests themselves are priced from their real text.)
  const { run } = await admin.call("jagentchill.workflow.video.start", { ...form({ musicMood: "none", secondCaptionLanguage: "vi" }), allowUnpriced: ["stub/text-only"] });
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const captions = (await execs(admin, run.id)).captions.outputs!.captions as pv.CaptionSet;
  assert.equal(captions.translationLanguage, "vi", JSON.stringify(captions.warnings));
  // The translation is the run's paid work: in its estimate, and charged to the run — not to the device that started it.
  const paid = h.app.generation.ledgerRows().filter((row) => row.capability === "translation");
  assert.ok(paid.length >= 1 && paid.every((row) => row.session_id === `run:${run.id}`), JSON.stringify(paid.map((row) => row.session_id)));
  const shown = await admin.call("jagentchill.workflow.video.estimate", form({ musicMood: "none", secondCaptionLanguage: "vi" }, null));
  assert.deepEqual(shown.estimate.stages.filter((stage: { stage: string }) => ["voice_check", "captions"].includes(stage.stage)).map((stage: { stage: string; count: number; source: string }) => [stage.stage, stage.count > 0, stage.source.length > 0]), [["voice_check", true, true], ["captions", true, true]]);
  assert.ok(captions.cues.length >= 3 && captions.cues.every((cue) => cue.translation === `[Vietnamese] ${cue.text.replace(/\n/g, " ")}`), JSON.stringify(captions.cues.map((cue) => [cue.text, cue.translation])));
  const track = project(h, done.outputs!.project.projectId).scenes[0].tracks.overlay.find((entry) => entry.type === "caption") as unknown as { caption: { translationLanguage?: string }; elements: Array<{ translation?: string }> };
  assert.equal(track.caption.translationLanguage, "vi");
  assert.ok(track.elements.every((element) => element.translation?.startsWith("[Vietnamese] ")));
});

// — w2, owner ruling of 2026-10-08: money is asked once, for the whole run —
test("One money confirmation per run: a start nobody confirmed is answered confirmation_required with the whole estimate and starts nothing; the confirmed start runs to its end without another money question; a run that would pass 120 % of the confirmed amount stops with the new figure and goes on once a person confirms it", async () => {
  const { admin, stub, model } = await setup({ consent: false });
  const images = () => stub.calls.filter((call) => call.path === "/images").length;
  // "Ask before spending more than" at the spec's 0 (set here: the host's default is the generation service's to state): every costed start asks.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const shown = await admin.call("jagentchill.workflow.video.estimate", form({}, null));
  assert.deepEqual([shown.confirmation.needed, shown.confirmation.aboveUsd, shown.confirmation.amountUsd], [true, 0, shown.estimate.highUsd]);
  assert.equal(shown.confirmation.stopsAtUsd, Math.round(shown.estimate.highUsd * 1.2 * 10_000) / 10_000);
  const refused = await admin.fail("jagentchill.workflow.video.start", form({}, null));
  assert.deepEqual([refused.code, refused.details.reason, refused.details.estimate.highUsd, refused.details.confirmAboveUsd], ["PERMISSION_DENIED", "confirmation_required", shown.estimate.highUsd, 0]);
  assert.deepEqual(refused.details.estimate.stages.map((stage: { stage: string }) => stage.stage), ["assets", "voiceover", "voice_check", "music"], "the breakdown: pictures, voice, the listening to it, music");
  assert.ok(refused.details.estimate.stages.every((stage: { model: string }) => stage.model.length > 0), "each with its model");
  // An amount under the estimate is not a confirmation of it.
  assert.equal((await admin.fail("jagentchill.workflow.video.start", form({}, shown.estimate.highUsd / 2))).details.reason, "confirmation_required");
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 0, "nothing was started");
  assert.equal(images(), 0, "and nothing was made");
  // Confirmed with room for what this provider really bills: one question, then the end.
  const { run } = await admin.call("jagentchill.workflow.video.start", form({}, 1));
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal((await admin.call("jagentchill.workflow.video.spend", { runId: run.id })).confirmedUsd, 1);
  // Below the host's threshold nobody is asked at all.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 50 } });
  assert.equal((await admin.call("jagentchill.workflow.video.estimate", form({}, null))).confirmation.needed, false);
  // Other pictures than the first run's (those are in the cache and would cost nothing).
  model.set({ shots: (attempt, message) => DEFAULTS.shots(attempt, message).replaceAll("of the tea", "of the rain") });
  const plain = await admin.call("jagentchill.workflow.video.estimate", form({ musicMood: "none" }, null));
  const quiet = await admin.call("jagentchill.workflow.video.start", form({ prompt: "A short film about rain", musicMood: "none" }, null));
  // This provider bills each picture several times its list price, so the real spend passes 120 % of the estimate: the run stops before the step that would pass it.
  // Confirmed-estimate guard, prompt-video: the run a person follows is PAUSED there (pauseReason budget_exceeded), its step held ready — not failed with the later steps skipped.
  const paused = await ended(admin, quiet.run.id, "paused");
  assert.deepEqual([paused.status, paused.pauseReason, paused.error], ["paused", "budget_exceeded", undefined], JSON.stringify(paused));
  const heldSteps = Object.values(await execs(admin, quiet.run.id)).filter((exec) => exec.blockedBy === "budget_exceeded");
  assert.deepEqual([heldSteps.map((exec) => exec.status), heldSteps.every((exec) => ["voiceover", "music", "assets"].includes(exec.nodeId))], [["ready"], true], JSON.stringify(heldSteps));
  assert.equal(Object.values(await execs(admin, quiet.run.id)).filter((exec) => exec.status === "failed").length, 0, "no step failed");
  const stopped = { failedNodeId: heldSteps[0].nodeId };
  const failed = (await execs(admin, quiet.run.id))[stopped.failedNodeId!].error as unknown as { message: string; details: { reason: string; confirmedUsd: number; spentUsd: number; limitUsd: number; estimate: { amountUsd: number } } };
  assert.deepEqual([failed.details.reason, failed.details.confirmedUsd, failed.details.limitUsd], ["confirmation_required", plain.estimate.highUsd, plain.confirmation.stopsAtUsd]);
  assert.ok(failed.details.estimate.amountUsd > failed.details.limitUsd && failed.details.estimate.amountUsd >= failed.details.spentUsd, JSON.stringify(failed.details));
  assert.match(failed.message, /would pass the \$[\d.]+ you confirmed/);
  // A lower amount is not accepted; the new figure is, and the stopped step goes on.
  assert.equal((await admin.fail("jagentchill.workflow.video.confirm", { runId: quiet.run.id, confirmedUsd: failed.details.confirmedUsd / 2 })).code, "INVALID_PARAMS");
  // Confirming the new amount is what resumes the run: no retry of a step.
  await admin.call("jagentchill.workflow.video.confirm", { runId: quiet.run.id, confirmedUsd: 1 });
  const resumed = await ended(admin, quiet.run.id);
  assert.equal(resumed.status, "succeeded", JSON.stringify(resumed.error));
  // Raising the budget of a run under way is the same decision: the person is not asked again below it.
  await admin.call("jagentchill.workflow.video.budget", { runId: quiet.run.id, budgetUsd: 3 });
  assert.equal((await admin.call("jagentchill.workflow.video.spend", { runId: quiet.run.id })).confirmedUsd, 3);
});

// — w2 run 2: no path spends without the one confirmation, and the guard is asked before every paid request —
const TEMPLATE = "tpl.one-prompt-video";
test("No start without the money question: the generic start of a run answers this template unconfirmed with the same confirmation_required and its estimate, starts with a confirmed amount, and a run created past every door pays for nothing until a person confirms", async () => {
  const { h, admin, stub } = await setup();
  const images = () => stub.calls.filter((call) => call.path === "/images").length, turns = () => h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const params = form({ voice: "none", musicMood: "none" }, null).params;
  const shown = await admin.call("jagentchill.workflow.video.estimate", { params });
  // The generic start (`workflow.run.create`) is the video's own start: same refusal, same shape.
  const refused = await admin.fail("jagentchill.workflow.run.create", { workflowId: TEMPLATE, params });
  assert.deepEqual([refused.code, refused.details.reason, refused.details.estimate.highUsd, refused.details.confirmAboveUsd, refused.details.stopsAtUsd], ["PERMISSION_DENIED", "confirmation_required", shown.estimate.highUsd, 0, shown.confirmation.stopsAtUsd]);
  assert.deepEqual([(await admin.call("jagentchill.workflow.run.list", {})).runs.length, turns(), images()], [0, 0, 0], "nothing was started, written or drawn");
  // A run created past every door (no start method asked anybody): its first step stops before the first paid request.
  const direct = h.app.workflows.runs.start({ workflowId: TEMPLATE, params, origin: "user", originRef: { deviceId: admin.device.deviceId }, startedByDeviceId: admin.device.deviceId, attended: true, approvalOverride: "auto" });
  const paused = await ended(admin, direct.id, "paused");
  assert.deepEqual([paused.status, paused.pauseReason], ["paused", "budget_exceeded"], JSON.stringify(paused));
  await tick(100);
  assert.deepEqual([turns(), images()], [0, 0], "no writing turn and no picture before the confirmation");
  const held = (await execs(admin, direct.id)).brief;
  const asked = held.error as unknown as { details: { reason: string; scope: string; confirmedUsd: number | null; estimate: { amountUsd: number; stages: { stage: string }[] } } };
  assert.deepEqual([held.status, held.blockedBy, asked.details.reason, asked.details.scope, asked.details.confirmedUsd, asked.details.estimate.amountUsd], ["ready", "budget_exceeded", "confirmation_required", "confirmed_estimate", null, shown.estimate.highUsd]);
  assert.deepEqual(asked.details.estimate.stages.map((stage) => stage.stage), ["assets"]);
  // Resuming is not confirming.
  await admin.call("jagentchill.workflow.run.resume", { runId: direct.id });
  await tick(150);
  assert.deepEqual([(await runOf(admin, direct.id)).status, turns(), images()], ["paused", 0, 0]);
  await admin.call("jagentchill.workflow.video.confirm", { runId: direct.id, confirmedUsd: 1 });
  assert.equal((await ended(admin, direct.id)).status, "succeeded");
  // The generic start with the amount the person confirmed is the confirmed start.
  const { run } = await admin.call("jagentchill.workflow.run.create", { workflowId: TEMPLATE, params: { ...params, prompt: "A short film about rain" }, confirmedUsd: 1 });
  assert.equal((await admin.call("jagentchill.workflow.video.spend", { runId: run.id })).confirmedUsd, 1);
  assert.equal((await ended(admin, run.id)).status, "succeeded");
});

test("The guard is asked before every paid request: a run stops at the picture that would pass 120 % of the confirmed amount — not at the end of the stage —, a retry that nobody confirmed draws nothing, and a shot made again is paid work that is stopped the same way", async () => {
  const { admin, stub, model } = await setup();
  const images = () => stub.calls.filter((call) => call.path === "/images").length;
  // Under the host's amount nobody is asked: the run is held to its estimate. The shots share a place, so they are drawn one after the other.
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 50 } });
  model.set({ shots: oneKitchen });
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }, null));
  const spend = async () => (await admin.call("jagentchill.workflow.video.spend", { runId: run.id })) as { spentUsd: number; confirmedUsd: number };
  const paused = await ended(admin, run.id, "paused");
  assert.deepEqual([paused.status, paused.pauseReason], ["paused", "budget_exceeded"], JSON.stringify(paused));
  const first = await spend(), limit = Math.round(first.confirmedUsd * 1.2 * 10_000) / 10_000, drawn = images();
  // The provider bills a picture several times its list price: the stop comes in the MIDDLE of the stage, at the first request that would pass it.
  assert.ok(drawn >= 1 && drawn < 3, `${drawn} of 3 pictures were paid for before the stop`);
  const held = (await execs(admin, run.id)).assets, details = (held.error as unknown as { details: { reason: string; limitUsd: number; spentUsd: number } }).details;
  assert.deepEqual([held.blockedBy, details.reason, details.limitUsd, details.spentUsd], ["budget_exceeded", "confirmation_required", limit, first.spentUsd]);
  // Retry: resuming without a new amount sends nothing.
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  await tick(200);
  assert.deepEqual([(await runOf(admin, run.id)).status, images()], ["paused", drawn], "the retry drew nothing");
  // ONE question per stop: the figure asked for is the real projection — what was charged so far plus what is left at the
  // rate this provider really charges (several times its list price) — so confirming exactly that amount carries the run to its end.
  const askedUsd = (held.error as unknown as { details: { estimate: { amountUsd: number } } }).details.estimate.amountUsd, perPicture = first.spentUsd / drawn;
  assert.ok(askedUsd >= perPicture * 3 - 0.0006 && askedUsd <= perPicture * 3 * 1.25, `asked ${askedUsd} for three pictures at ${perPicture} each (list price about a quarter of that)`);
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, confirmedUsd: askedUsd });
  const finished = await ended(admin, run.id);
  assert.deepEqual([finished.status, finished.pauseReason], ["succeeded", undefined], "no second money question");
  assert.equal(images(), 3);
  // "Run again": every shot keeps its picture while it is drawn again — three paid requests all the same, and the run has no room for them.
  await admin.call("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "assets", notes: { all: true } });
  const again = await ended(admin, run.id, "paused");
  assert.deepEqual([again.status, again.pauseReason, images()], ["paused", "budget_exceeded", 3], "the redraw was stopped before anything was sent");
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, confirmedUsd: 1 });
  assert.equal((await ended(admin, run.id)).status, "succeeded");
  assert.equal(images(), 6, "confirmed, the shots are drawn again");
});

test("The amount on the permission card is what an agent's start confirms: when the price has risen since the person allowed it, the run is created without a confirmed amount, pays for nothing and asks the person again with the new figure", async () => {
  const { h, admin, stub } = await setup();
  const images = () => stub.calls.filter((call) => call.path === "/images").length;
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } })).session.sessionKey as string;
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  const tool = async (name: string, args: Record<string, unknown>) => (await h.app.tools.call(sessionKey, name, args)).envelope as { ok: boolean; data?: any; error?: { code: string; message: string } };
  const requests = () => admin.events.filter((entry) => entry.event === "jagentchill.chat.permission.requested").map((entry) => (entry.payload as { request: { requestId: string; detail: string } }).request);
  const args = { templateId: TEMPLATE, prompt: "A short film about tea", params: { targetDuration_s: 10, musicMood: "none", voice: "none" }, approvalOverride: "auto", idempotencyKey: randomUUID() };
  assert.equal((await tool("jc_workflow_start", args)).error?.code, "APPROVAL_PENDING");
  await until(() => requests(), (list) => list.length === 1, "the permission card");
  const shown = Number(/Estimated cost \$[\d.]+ – \$([\d.]+)/.exec(requests()[0].detail)?.[1]);
  assert.ok(shown > 0, requests()[0].detail);
  // The price of a picture rises a hundredfold before the person answers.
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 3 } } });
  await admin.call("jagentchill.chat.approval.resolve", { requestId: requests()[0].requestId, decision: "allow-once" });
  // (Answering the card sends the agent's own session a note: turns are counted from here.)
  await tick(100);
  const turnsBefore = h.fake.callsOf("startTurn").length;
  const started = await tool("jc_workflow_start", args);
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const runId = started.data.runId as string;
  const paused = await ended(admin, runId, "paused");
  assert.deepEqual([paused.status, paused.pauseReason], ["paused", "budget_exceeded"], JSON.stringify(paused));
  await tick(100);
  const asked = ((await execs(admin, runId)).brief.error as unknown as { details: { reason: string; confirmedUsd: number | null; estimate: { amountUsd: number } } }).details;
  assert.deepEqual([asked.reason, asked.confirmedUsd, asked.estimate.amountUsd > shown * 10, images(), h.fake.callsOf("startTurn").length - turnsBefore], ["confirmation_required", null, true, 0, 0], "the new figure is asked, and nothing was paid");
  assert.equal((await admin.call("jagentchill.workflow.video.spend", { runId })).confirmedUsd, null, "the amount of the card did not become a confirmation of the higher cost");
  await admin.call("jagentchill.workflow.run.cancel", { runId });
});

// — w2 run 3 —
test("A translation is paid work that is reserved before it is sent: when its price would take the run past what was confirmed the captions step stops BEFORE the translator is asked, and goes on once the person confirms; a translation by a runtime's model is a turn of the run — on its account like the writing", async () => {
  const { h, admin, stub, model } = await setup();
  const textCalls = () => stub.calls.filter((call) => call.path === "/chat/completions").length, translationRows = () => h.app.generation.ledgerRows().filter((row) => row.capability === "translation").length;
  const translator = (inputPerMillionUsd: number) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/text-only", label: "Stub Text", capability: "translation", pricing: { kind: "tokens", inputPerMillionUsd, outputPerMillionUsd: 2 }, metadata: { maxOutputTokens: 4000, sources: { maxOutputTokens: "TEST DOUBLE: the stub provider's model list" } } } });
  await translator(1);
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/text-only"], enabled: true });
  await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["transcript"] });
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const settings = { musicMood: "none" as const, secondCaptionLanguage: "vi" };
  const shown = await admin.call("jagentchill.workflow.video.estimate", form(settings, null));
  // The person confirms room for what this provider bills its pictures at, and no more; then the translator's price rises ten-thousandfold.
  model.pause(true);
  const { run } = await admin.call("jagentchill.workflow.video.start", { ...form(settings, Math.max(shown.estimate.highUsd, 0.05)), allowUnpriced: ["stub/text-only"] });
  await translator(10_000);
  model.pause(false);
  const paused = await ended(admin, run.id, "paused");
  assert.deepEqual([paused.status, paused.pauseReason], ["paused", "budget_exceeded"], JSON.stringify(paused));
  const held = (await execs(admin, run.id)).captions;
  assert.deepEqual([held.status, held.blockedBy, (held.error as unknown as { details: { reason: string } }).details.reason], ["ready", "budget_exceeded", "confirmation_required"]);
  assert.deepEqual([translationRows(), textCalls()], [0, 0], "the translator was not asked");
  const spent = (await admin.call("jagentchill.workflow.video.spend", { runId: run.id })) as { spentUsd: number; confirmedUsd: number; turnCount: number };
  assert.ok(spent.spentUsd <= spent.confirmedUsd * 1.2 + 1e-9, `nothing was spent past the stop (${spent.spentUsd} of ${spent.confirmedUsd})`);
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, confirmedUsd: 1000 });
  assert.equal((await ended(admin, run.id)).status, "succeeded");
  assert.ok(translationRows() >= 1 && textCalls() >= 1, "confirmed, the captions are translated");
  assert.equal(spent.turnCount, 3, "the three writing turns are on the run's account");
});

test("A caption translation by a runtime's model is a turn of the RUN: it goes through the run's own turn (guarded like the writing) and is on the run's account — not an ordinary turn beside it", async () => {
  const { h, admin } = await setup();
  // The Translation role on a model of the runtime (the fake runtime answers it here, like a model: one line per caption).
  await admin.call("jagentchill.orc.config.update", { expectedRevision: (await admin.call("jagentchill.orc.config.get", {})).revision, patch: { roles: { translation: { enabled: true, profiles: [{ id: "default", runtime: "claude-code", provider: "anthropic", model: "opus", params: {}, enabled: true }], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} } } } });
  let seen = 0;
  const timer = setInterval(() => {
    for (const all = h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>; seen < all.length; seen++) {
      const call = all[seen], line = call.message.split("\n").filter((part) => part.startsWith("[")).pop();
      if (!line || !call.message.startsWith("Translate these")) continue;
      try { h.fake.reply(call.sessionKey, JSON.stringify((JSON.parse(line) as string[]).map((entry) => `(vi) ${entry}`))); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  // The captions service has no price for a translation by a runtime's model: the estimate names the model, and the
  // start is refused until the person who was told its name starts all the same.
  const unnamed = await admin.fail("jagentchill.workflow.video.start", form({ musicMood: "none", secondCaptionLanguage: "vi" }));
  assert.deepEqual([unnamed.code, unnamed.details?.reason, (unnamed.details?.estimate as { unpricedModels: string[] }).unpricedModels], ["PERMISSION_DENIED", "confirmation_required", ["opus"]]);
  const { run } = await admin.call("jagentchill.workflow.video.start", { ...form({ musicMood: "none", secondCaptionLanguage: "vi" }), allowUnpriced: ["opus"] });
  const done = await ended(admin, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const captions = (await execs(admin, run.id)).captions.outputs!.captions as pv.CaptionSet;
  assert.ok(captions.translationLanguage === "vi" && captions.cues.every((cue) => cue.translation?.startsWith("(vi) ")), JSON.stringify(captions.warnings));
  // Brief, script, shot list — and the translation: four sessions' turns on the run's account.
  assert.equal(((await admin.call("jagentchill.workflow.video.spend", { runId: run.id })) as { turnCount: number }).turnCount, 4);
});

test("The approved card is what counts, not an earlier preview: a dry run at a lower price, then a card at ten times that which the person allows — the run starts confirmed for the amount ON THE CARD, runs to its end, and the same approval starts nothing a second time", async () => {
  const { h, admin } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } })).session.sessionKey as string;
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  const tool = async (name: string, args: Record<string, unknown>) => (await h.app.tools.call(sessionKey, name, args)).envelope as { ok: boolean; data?: any; error?: { code: string; message: string } };
  const requests = () => admin.events.filter((entry) => entry.event === "jagentchill.chat.permission.requested").map((entry) => (entry.payload as { request: { requestId: string; detail: string } }).request);
  const price = (usd: number) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: usd } } });
  const args = { templateId: TEMPLATE, prompt: "A short film about tea", params: { targetDuration_s: 10, musicMood: "none", voice: "none" }, approvalOverride: "auto", idempotencyKey: randomUUID() };
  // A preview nobody was shown on a card: $0.003 a picture.
  await price(0.003);
  const dry = await tool("jc_workflow_start", { ...args, dryRun: true });
  // The card: $0.03 a picture — ten times the preview before it.
  await price(0.03);
  assert.equal((await tool("jc_workflow_start", args)).error?.code, "APPROVAL_PENDING");
  await until(() => requests(), (list) => list.length === 1, "the permission card");
  const onCard = Number(/Estimated cost \$[\d.]+ – \$([\d.]+)/.exec(requests()[0].detail)?.[1]);
  assert.ok(onCard >= dry.data.estimate.highUsd * 9, `${dry.data.estimate.highUsd} previewed, ${onCard} on the card`);
  await admin.call("jagentchill.chat.approval.resolve", { requestId: requests()[0].requestId, decision: "allow-once" });
  const started = await tool("jc_workflow_start", args);
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const spend = (await admin.call("jagentchill.workflow.video.spend", { runId: started.data.runId })) as { confirmedUsd: number | null };
  assert.equal(spend.confirmedUsd, onCard, "confirmed for the amount on the allowed card");
  const done = await ended(admin, started.data.runId);
  assert.deepEqual([done.status, done.pauseReason], ["succeeded", undefined], "no second money question");
  // The approval was for one start: the same call again starts no second run, and the same request under a new key asks the person again.
  await tool("jc_workflow_start", args);
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 1);
  assert.equal((await tool("jc_workflow_start", { ...args, idempotencyKey: randomUUID() })).error?.code, "APPROVAL_PENDING");
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 1);
});

// — w2-leftovers-3: a hard-stop budget cannot be passed by any action but raising it —
test("Budgets during a run: with the limit UNCHANGED nothing more is paid for — not by Resume, not by Retry, not by cancel and run again, not from a second device, not by another run, not after a restart of the host — and the rest is paid for once the limit is really raised", async () => {
  const { h, admin, stub, model } = await setup();
  const five: Answers["script"] = (_attempt, message) => JSON.stringify({ title: "Tea", segments: Array.from({ length: 5 }, (_value, index) => ({ beatLabel: `Beat ${index + 1}`, kind: "on-screen-text", text: `Line ${index + 1}`, estimatedDuration_s: Number(/must last (\d+) s/.exec(message)![1]) / 5 })) });
  model.set({ script: five });
  const LIMIT = { scope: "provider", scopeId: "openrouter", limitUsd: 0.01, period: "month", hardStop: true };
  // Pictures at $0.003 each: the provider budget of $0.01 lets three be paid for and refuses the fourth of five.
  await admin.call("jagentchill.provider.budget.set", { budget: LIMIT });
  const paid = () => stub.calls.filter((call) => call.path === "/images").length;
  const refusals = async (device: Device, runId: string) => ((await device.call("jagentchill.workflow.node.logs", { runId, nodeId: "assets" })).entries as Array<{ message: string }>).filter((entry) => entry.message.startsWith("BUDGET_EXCEEDED")).length;
  /** The run is held at the pictures again, by the same unchanged budget, after one more refusal — and nothing was paid for. */
  const heldAgain = async (device: Device, runId: string, before: number, what: string) => {
    await until(() => refusals(device, runId), (count) => count > before, `${what}: the step to be refused again`);
    const run = await until(() => runOf(device, runId), (found) => found.status !== "running", `${what}: the run to stop`);
    const step = (await execs(device, runId)).assets;
    assert.deepEqual([run.status, run.pauseReason, step.status, step.blockedBy, (step.error?.details as { scope?: string; scopeId?: string }).scope, (step.error?.details as { scopeId?: string }).scopeId], ["paused", "budget_exceeded", "ready", "budget_exceeded", "provider", "openrouter"], what);
    assert.equal(paid(), 3, `${what}: nothing more was paid for`);
    assert.equal(((await device.call("jagentchill.provider.budget.list", {})).budgets as Array<{ scope: string; limitUsd: number }>).find((budget) => budget.scope === "provider")!.limitUsd, 0.01, `${what}: the limit is unchanged`);
    return refusals(device, runId);
  };
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none" }));
  let seen = await heldAgain(admin, run.id, 0, "the first stop");

  // Resume: the step is dispatched, refused again, held again.
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  seen = await heldAgain(admin, run.id, seen, "Resume");

  // Retry: a held step is not a failed step; there is nothing to retry and nothing is dispatched.
  assert.equal((await admin.fail("jagentchill.workflow.node.retry", { runId: run.id, nodeId: "assets", path: "" })).code, "WORKFLOW_NODE_NOT_ACTIVE");
  assert.deepEqual([await refusals(admin, run.id), paid(), (await runOf(admin, run.id)).status], [seen, 3, "paused"]);

  // A second device (another admin of the host): its Resume meets the same budget.
  const laptop = await h.pair("Laptop", "admin");
  await laptop.call("jagentchill.workflow.run.resume", { runId: run.id });
  seen = await heldAgain(laptop, run.id, seen, "Resume from a second device");

  // Another run, started by that device: the budget is the host's, so its first picture is refused too.
  const other = (await laptop.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none", prompt: "Another short film about tea" }))).run;
  await heldAgain(laptop, other.id, 0, "another run from a second device");
  await laptop.call("jagentchill.workflow.run.cancel", { runId: other.id });

  // Cancel, then run the step again: it is refused again.
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
  assert.equal((await runOf(admin, run.id)).status, "cancelled");
  await admin.call("jagentchill.workflow.node.rerun", { runId: run.id, nodeId: "assets" });
  seen = await heldAgain(admin, run.id, seen, "cancel and run again");

  // The host restarts on its data directory (budgets, the run's checkpoint and the paid pictures are all that is left).
  h.stop();
  const againSkew = { ms: 0 };
  const again = await createHarness({ dataDir: h.dataDir, now: () => Date.now() + againSkew.ms, models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [20, 40], jitter: () => 0, circuitMs: 50 } } } });
  open.push(again);
  await billedByKey(again, againSkew);
  // The model of the restarted host answers the same way (the picture checks of the Vision role).
  let answered = 0;
  const timer = setInterval(() => {
    const sends = again.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string }>;
    for (; answered < sends.length; answered++) {
      const call = sends[answered], kind = /\[\[jc-(?:video|film):(\w+)\]\]/.exec(call.message)?.[1] as keyof Answers | undefined;
      if (!kind) continue;
      try { again.fake.reply(call.sessionKey, (kind === "script" ? five : DEFAULTS[kind])(1, call.message)); } catch { /* the turn's session was closed meanwhile */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  const desk = await again.pair("Desk", "admin");
  const restored = await runOf(desk, run.id);
  assert.deepEqual([restored.status, restored.pauseReason, paid()], ["paused", "budget_exceeded", 3], "after the restart the run is still held and nothing was paid for");
  const beforeResume = await refusals(desk, run.id);  // read BEFORE the resume: the refusal can be logged before the call returns
  await desk.call("jagentchill.workflow.run.resume", { runId: run.id });
  await heldAgain(desk, run.id, beforeResume, "Resume after a restart");

  // The limit is really raised: the same Resume now pays for the two pictures that were missing, and only those.
  await desk.call("jagentchill.provider.budget.set", { budget: { ...LIMIT, limitUsd: 5 } });
  await desk.call("jagentchill.workflow.run.resume", { runId: run.id });
  const done = await ended(desk, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal(paid(), 5, "the three pictures paid for before the stop were not paid for again");
});

// — w2 run 4: nothing is sent that the confirmed amount (or an automation's limit) does not cover —
const sent = (h: Harness) => h.fake.callsOf("startTurn").length;
/**
 * $1 a million tokens in, $10 out. Ruling R10, on a `measured` host (a first request to opus measured at 10,000
 * tokens, its documented longest answer 12,000 tokens) — a turn costs about:
 *   in  (10,000 + the bytes of its message) × $1 a million
 *   out  12,000 × $10 a million = $0.12
 * In the estimate the brief message is already known: (10,000 + its 1,130 UTF-8 bytes) × $1 + 120,000 = 131,130
 * millionths = $0.13113. Script and shot-list messages do not exist yet, so each remains $0.13.
 * (Before R10: the model's whole window read and answered — $0.22 on a window of 20,000, $2.20 on a real one of 200,000.)
 */
const PRICED = { inputPerMillionUsd: 1, outputPerMillionUsd: 10, source: "admin" as const };
/** A turn as it is reserved when it is SENT, by the same rule with its real message — in dollars, at the given prices. */
const turnUsd = (message: string, price: { inputPerMillionUsd: number; outputPerMillionUsd: number } = PRICED): number => Math.ceil((MEASURED_PROMPT + Buffer.byteLength(message, "utf8")) * price.inputPerMillionUsd + MAX_OUTPUT * price.outputPerMillionUsd - 1e-9) / 1e6;

test("Before dispatching a costed node the engine reserves its estimate: a writing turn is in the estimate at the most its request can cost and is reserved at that before it is sent — when the model's price has risen past what was confirmed the turn is NOT sent and the run pauses with the new figure; an automation's limit that the writing alone can pass starts nothing", async () => {
  const { h, admin, prices } = await setup({ measured: true });
  prices.set(PRICED);
  const quiet = { mode: "checkpoints" as const, voice: "none", musicMood: "none" as const };
  const shown = await admin.call("jagentchill.workflow.video.estimate", form(quiet, null));
  const rows = Object.fromEntries((shown.estimate.stages as Array<{ stage: string; highUsd: number | null; note?: string }>).map((stage) => [stage.stage, stage]));
  // RE-DERIVED on ruling R10. Brief: (10,000 measured tokens + 1,130 known UTF-8 bytes) × $1 + 12,000 × $10
  // = $0.13113. Script and shot list are not written yet: 10,000 × $1 + 12,000 × $10 = $0.13 each.
  assert.deepEqual([rows.brief.highUsd, (rows.brief as { measured?: true }).measured], [0.13113, true]);
  for (const stage of ["script_draft", "shot_list"]) assert.deepEqual([rows[stage].highUsd, (rows[stage] as { measured?: true }).measured], [0.13, true], `${stage}: ${rows[stage].highUsd}`);
  assert.deepEqual([shown.estimate.unknown, shown.confirmation.unpricedModels], [false, []]);
  // The whole question: $0.13113 + 2 × $0.13 = $0.39113 of writing, plus $0.018 for pictures = $0.40913;
  // the estimate is $0.40913 before money4 displays $0.4091; 120 % is $0.490956, displayed as $0.4909.
  assert.deepEqual([shown.estimate.highUsd, shown.confirmation.stopsAtUsd], [0.4091, 0.4909], "the amount the person confirms covers the writing");
  const { run } = await admin.call("jagentchill.workflow.video.start", form(quiet, shown.estimate.highUsd));
  await until(() => execs(admin, run.id), (steps) => steps.check_brief?.status === "waiting_approval", "the brief checkpoint");
  assert.equal(sent(h), 1);
  // The brief's turn was reserved, before it was sent, with its real message (1,130 bytes when this was written):
  // (10,000 + 1,130) × $1 + 120,000 = 131,130 millionths = $0.13113 — and stays on the run's record at that until Usage says what it cost.
  const briefUsd = turnUsd((h.fake.callsOf("startTurn")[0] as { message: string }).message);
  assert.ok(briefUsd > 0.13 && briefUsd < 0.14, String(briefUsd));
  assert.equal(h.app.generation.gate.action(`run:${run.id}`)!.spentUsd, briefUsd);
  // The price of the model is now ten times what it was: the next turn alone is about $1.31 — more than 120 % of what was confirmed ($0.4909).
  prices.set({ inputPerMillionUsd: 10, outputPerMillionUsd: 100, source: "admin" });
  await admin.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "check_brief", path: "", outcome: "approved" });
  const paused = await ended(admin, run.id, "paused");
  const held = (await execs(admin, run.id)).script_draft;
  assert.deepEqual([paused.status, paused.pauseReason, held.error?.code, (held.error?.details as { reason: string }).reason, sent(h)], ["paused", "budget_exceeded", "BUDGET_EXCEEDED", "confirmation_required", 1], "the script's turn was not sent");
  const askedUsd = (held.error!.details as { estimate: { amountUsd: number } }).estimate.amountUsd;
  assert.ok(askedUsd > 1.3, `the figure asked covers the turn that was not sent: ${askedUsd}`);
  assert.deepEqual([(held.error!.details as { confirmedUsd: number }).confirmedUsd, (held.error!.details as { limitUsd: number }).limitUsd], [0.4091, 0.4909]);
  assert.equal(((await admin.call("jagentchill.workflow.video.spend", { runId: run.id })) as { spentUsd: number }).spentUsd <= shown.estimate.highUsd * 1.2, true);
  // The person confirms the new figure (room for the two turns still to come): the same turn is sent now.
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, confirmedUsd: 6 });
  await until(() => sent(h), (count) => count === 2, "the script's turn after the confirmation");
  // The figure that was asked, checked against the message that then went out (1,485 bytes when this was written): the
  // script's turn at the new prices — (10,000 + 1,485) × $10 + 12,000 × $100 = 114,850 + 1,200,000 = 1,314,850 millionths
  // = $1.31485 — on top of the brief's $0.13113 the run already holds: $1.44598, asked as $1.446.
  const scriptUsd = turnUsd((h.fake.callsOf("startTurn")[1] as { message: string }).message, { inputPerMillionUsd: 10, outputPerMillionUsd: 100 });
  assert.equal(askedUsd, Math.round((briefUsd + scriptUsd) * 10_000) / 10_000, `asked ${askedUsd} = brief ${briefUsd} + script ${scriptUsd}`);
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });

  // Nobody present: the $0.012 automation limit is under the writing alone ($0.13113 + $0.13 + $0.13 = $0.39113) — no run, no turn.
  prices.set(PRICED);
  const { automation } = await admin.call("jagentchill.automation.create", { automation: {
    name: "Nightly video", triggers: [{ id: "t1", type: "schedule", schedule: { rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=3;BYMINUTE=0", tzid: "UTC", dtstart: new Date().toISOString().slice(0, 10) } }],
    instructions: [{ kind: "run_workflow", workflowId: TEMPLATE, params: { prompt: "A short film about tea", targetDuration_s: 10, voice: "none", musicMood: "none", model: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } }, maxCostUsd: 0.012, continueOnFailure: false }],
    advanced: { concurrency: "skip", catchUp: "skip", timeoutMinutes: 120, parkedTimeoutHours: 72, notify: "never", budgetUsd: 50 },
  } });
  const before = [sent(h), (await admin.call("jagentchill.workflow.run.list", {})).runs.length];
  h.app.workflows.automations.run(automation.id);
  const step = (await until(async () => (await admin.call("jagentchill.automation.run.list", { automationId: automation.id })).runs[0], (entry) => entry?.status === "failed", "the automation's run refused")).steps[0];
  assert.deepEqual([step.error.code, step.runId, sent(h), (await admin.call("jagentchill.workflow.run.list", {})).runs.length], ["BUDGET_EXCEEDED", undefined, ...before]);
  assert.match(step.error.message, /above the \$0\.012 this instruction allows for a run: it was not started/);
});

test("A model whose price is not known: the run's one money question names it — nothing starts until the person who was told its name starts all the same; a model that becomes unpriced in the middle of a run is not sent to, the run pauses naming it, and goes on when the person allows that model", async () => {
  const { h, admin, prices } = await setup();
  const quiet = { mode: "checkpoints" as const, voice: "none", musicMood: "none" as const };
  // opus is billed by the call and the host has no price for it.
  prices.set(undefined);
  const shown = await admin.call("jagentchill.workflow.video.estimate", form(quiet, null));
  assert.deepEqual([shown.estimate.unknown, shown.confirmation.needed, shown.confirmation.unpricedModels], [true, true, ["opus"]]);
  // Money confirmed amply — the model was not: that is no start.
  const refused = await admin.fail("jagentchill.workflow.video.start", form(quiet, 5));
  assert.deepEqual([refused.code, refused.details.reason, refused.details.estimate.unpricedModels, sent(h)], ["PERMISSION_DENIED", "confirmation_required", ["opus"], 0]);
  assert.equal((await admin.fail("jagentchill.workflow.run.create", { workflowId: TEMPLATE, params: form(quiet).params, confirmedUsd: 5 })).details.reason, "confirmation_required", "nor through the generic start");
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 0);
  // Another model's name is not this model's.
  assert.equal((await admin.fail("jagentchill.workflow.video.start", { ...form(quiet, 5), allowUnpriced: ["haiku"] })).details.reason, "confirmation_required");
  const first = (await admin.call("jagentchill.workflow.video.start", { ...form(quiet, 5), allowUnpriced: ["opus"] })).run;
  await until(() => execs(admin, first.id), (steps) => steps.check_brief?.status === "waiting_approval", "the brief, written by the model the person allowed");
  await admin.call("jagentchill.workflow.run.cancel", { runId: first.id });

  // A run started while the model had a price; the price is gone when its next turn is due.
  prices.set(FREE);
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ ...quiet, prompt: "A short film about rain" }));
  await until(() => execs(admin, run.id), (steps) => steps.check_brief?.status === "waiting_approval", "the brief checkpoint");
  const before = sent(h);
  prices.set(undefined);
  await admin.call("jagentchill.workflow.node.resolve", { runId: run.id, nodeId: "check_brief", path: "", outcome: "approved" });
  const paused = await ended(admin, run.id, "paused");
  const details = (await execs(admin, run.id)).script_draft.error!.details as { reason: string; modelId: string; unpricedModels: string[]; scope: string };
  assert.deepEqual([paused.pauseReason, details.reason, details.modelId, details.scope, sent(h)], ["budget_exceeded", "unpriced_model", "opus", "confirmed_estimate", before], "nothing was sent to it");
  // An amount is no answer to "its price is not known"; the model's name is.
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, confirmedUsd: 50 });
  assert.equal((await ended(admin, run.id, "paused")).status, "paused");
  assert.equal(sent(h), before);
  await admin.call("jagentchill.workflow.video.confirm", { runId: run.id, allowUnpriced: ["opus"] });
  await until(() => sent(h), (count) => count === before + 1, "the script's turn once the person allowed the model");
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
});

test("The exact estimate is bound to the permission request: two cards whose words read the same to the cent ($0.6000 and $0.6006) — the person allows the second, and the run starts confirmed for exactly the amount THAT card was made from; the card starts one run", async () => {
  const { h, admin } = await setup();
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } })).session.sessionKey as string;
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  const tool = async (name: string, args: Record<string, unknown>) => (await h.app.tools.call(sessionKey, name, args)).envelope as { ok: boolean; data?: any; error?: { code: string; message: string } };
  const requests = () => admin.events.filter((entry) => entry.event === "jagentchill.chat.permission.requested").map((entry) => (entry.payload as { request: { requestId: string; detail: string } }).request);
  const price = (usd: number) => admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: usd } } });
  const args = { templateId: TEMPLATE, prompt: "A short film about tea", params: { targetDuration_s: 10, musicMood: "none", voice: "none" }, approvalOverride: "auto" };
  const high = async () => (await tool("jc_workflow_start", { ...args, idempotencyKey: randomUUID(), dryRun: true })).data.estimate.highUsd as number;
  const firstKey = randomUUID(), secondKey = randomUUID();
  // Two prices of a picture whose estimates differ in the fourth decimal.
  await price(0.1);
  const lower = await high();
  await price(0.1001);
  const higher = await high();
  assert.ok(higher > lower && higher.toFixed(2) === lower.toFixed(2), `${lower} and ${higher} read the same on a card`);
  // The first card, at the lower price; then the price rises and the agent asks again: a second card in the same words.
  await price(0.1);
  assert.equal((await tool("jc_workflow_start", { ...args, idempotencyKey: firstKey })).error?.code, "APPROVAL_PENDING");
  await price(0.1001);
  assert.equal((await tool("jc_workflow_start", { ...args, idempotencyKey: secondKey })).error?.code, "APPROVAL_PENDING");
  await until(() => requests(), (list) => list.length === 2, "the two permission cards");
  assert.equal(requests()[0].detail, requests()[1].detail, "the same words");
  // The person allows the SECOND card.
  await admin.call("jagentchill.chat.approval.resolve", { requestId: requests()[1].requestId, decision: "allow-once" });
  const started = await tool("jc_workflow_start", { ...args, idempotencyKey: secondKey });
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const spend = (await admin.call("jagentchill.workflow.video.spend", { runId: started.data.runId })) as { confirmedUsd: number | null };
  assert.equal(spend.confirmedUsd, higher, "confirmed for the amount of the card that was allowed — not the lower one in the same words, and not nothing");
  // That card has started its run: the call again starts no second one.
  await tool("jc_workflow_start", { ...args, idempotencyKey: secondKey });
  assert.equal((await admin.call("jagentchill.workflow.run.list", {})).runs.length, 1);
  await admin.call("jagentchill.workflow.run.cancel", { runId: started.data.runId });
});

// — w2 run 5 —
const pausedOrEnded = (device: Device, runId: string) => until(() => runOf(device, runId), (run) => ["succeeded", "failed", "cancelled", "paused"].includes(run.status), "the run to end or to stop for a person");
test("One money question per run (run 5 #7): the start card names EVERY model the run will use whose price is not known — the reader and the listener too — so ONE Start covers them and the run reaches its end without another stop", async () => {
  const { admin, stub } = await setup({ sound: false });
  const answer = await admin.call("jagentchill.workflow.video.estimate", form({}, null));
  const named = answer.confirmation.unpricedModels as string[];
  // Both sound models of this host have no computable price: the question says so, by the names a person reads.
  assert.equal(named.length, 2, `the reader and the listener are named on the start card: ${JSON.stringify(named)}`);
  const { run } = await admin.call("jagentchill.workflow.video.start", { ...form({}, Math.max(answer.confirmation.amountUsd, 0.5)), allowUnpriced: named });
  const done = await pausedOrEnded(admin, run.id);
  assert.equal(done.status, "succeeded", `the run was stopped again: ${JSON.stringify(done.error ?? done.pauseReason)} named ${JSON.stringify(named)} ${JSON.stringify(Object.values(await execs(admin, run.id)).filter((step) => step.error).map((step) => [step.nodeId, step.error]))}`);
  assert.ok(speechCalls(stub).length >= 1, "the reader was really asked");
  assert.ok(stub.calls.some((call) => call.path === "/chat/completions" || call.path === "/audio/transcriptions"), "the listener was really asked");
});

test("Ruling R9 (run 5 #9): writing on the person's own signed-in Codex account is no part of the money question — not in the amount, never 'price not known', nothing to allow; the estimate says it in one quiet line (which work, whose account) and the run starts and ends with the ONE confirmation of its priced parts; the same writing on a built-in model with no price is still named", async () => {
  const { admin, prices } = await setup();
  const codex = { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" };
  const shown = await admin.call("jagentchill.workflow.video.estimate", form({ model: codex }, null));
  assert.deepEqual([shown.estimate.unknown, shown.confirmation.unpricedModels], [false, []], "nothing of the own account is 'price not known'");
  assert.deepEqual((shown.estimate.ownAccount as { label: string; model: string; account?: string }[]).map((entry) => [entry.label, entry.model, entry.account]), [["Brief", "gpt-x", "Codex"], ["Script", "gpt-x", "Codex"], ["Shot list", "gpt-x", "Codex"]]);
  const rows = Object.fromEntries((shown.estimate.stages as Array<{ stage: string; highUsd: number | null; source?: string }>).map((stage) => [stage.stage, stage]));
  assert.deepEqual([rows.brief.highUsd, rows.script_draft.highUsd, rows.shot_list.highUsd], [0, 0, 0]);
  // w7 item 4: those steps are MARKED as the person's own account — a screen draws them as no money row (never "Chat model $0.00") — and named by their model, not by a made-up source.
  assert.deepEqual((shown.estimate.stages as Array<{ stage: string; ownAccount?: boolean; source: string }>).filter((stage) => stage.ownAccount).map((stage) => [stage.stage, stage.source]), [["brief", "gpt-x"], ["script_draft", "gpt-x"], ["shot_list", "gpt-x"]]);
  assert.equal((shown.estimate.stages as Array<{ stage: string; ownAccount?: boolean }>).some((stage) => ["assets", "voiceover", "assemble"].includes(stage.stage) && stage.ownAccount), false);
  // The amount is the priced parts alone (pictures, voice, listening, music): exactly what the same video shows with a free writer.
  assert.equal(shown.confirmation.amountUsd, (await admin.call("jagentchill.workflow.video.estimate", form({}, null))).confirmation.amountUsd);
  // One Start, with the amount and no model to allow.
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ model: codex }, 5));
  const done = await pausedOrEnded(admin, run.id);
  assert.equal(done.status, "succeeded", `stopped: ${JSON.stringify(done.error ?? done.pauseReason)} ${JSON.stringify(Object.values(await execs(admin, run.id)).filter((step) => step.error).map((step) => [step.nodeId, step.error]))}`);
  // A built-in model with no price is NOT that: it is named, and nothing starts until the person allows it.
  prices.set(undefined);
  const named = await admin.call("jagentchill.workflow.video.estimate", form({}, null));
  assert.deepEqual([named.confirmation.unpricedModels, named.estimate.ownAccount], [["opus"], undefined]);
});

test("Budgets during a run (run 5 #2): a turn is held to the run's HARD budget before it is sent — with $5 confirmed and a $0.01 budget of the run, the brief's turn (about $0.13 by ruling R10: 10,000 measured tokens in at $1 a million, 12,000 out at $10) is NOT sent: the run pauses at its own budget, and the turn goes out after the person raises it", async () => {
  const { h, admin, prices } = await setup({ measured: true });
  prices.set(PRICED);
  const { run } = await admin.call("jagentchill.workflow.video.start", form({ voice: "none", musicMood: "none", budgetUsd: 0.01 }, 5));
  const paused = await pausedOrEnded(admin, run.id);
  const held = (await execs(admin, run.id)).brief;
  assert.deepEqual([paused.status, paused.pauseReason, held.error?.code, (held.error?.details as { scope?: string; scopeId?: string })?.scope, (held.error?.details as { scopeId?: string })?.scopeId, sent(h)], ["paused", "budget_exceeded", "BUDGET_EXCEEDED", "session", `run:${run.id}`, 0], "nothing was sent past the run's budget");
  assert.equal((held.error!.details as { remainingUsd: number }).remainingUsd, 0.01);
  await admin.call("jagentchill.workflow.video.budget", { runId: run.id, budgetUsd: 3 });
  await admin.call("jagentchill.workflow.run.resume", { runId: run.id });
  await until(() => sent(h), (count) => count >= 1, "the brief's turn after the budget was raised");
  await admin.call("jagentchill.workflow.run.cancel", { runId: run.id });
});

test("The approved card's amount (run 5 #4): two cards made at the same moment whose words read the same to the cent ($0.99 at two prices of the writing model) — the person allows the FIRST, and the run starts confirmed for exactly the amount THAT card was made from: a request is bound to its preview by identity when it is made, not by its words", async () => {
  const { h, admin, prices } = await setup({ measured: true });
  await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 0 } });
  await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.1 } } });
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } })).session.sessionKey as string;
  await admin.call("jagentchill.chat.subscribe", { sessionKey });
  const tool = async (name: string, args: Record<string, unknown>) => (await h.app.tools.call(sessionKey, name, args)).envelope as { ok: boolean; data?: any; error?: { code: string; message: string } };
  const requests = () => admin.events.filter((entry) => entry.event === "jagentchill.chat.permission.requested").map((entry) => (entry.payload as { request: { requestId: string; detail: string } }).request);
  const args = { templateId: TEMPLATE, prompt: "A short film about tea", params: { targetDuration_s: 10, musicMood: "none", voice: "none" }, approvalOverride: "auto" };
  // The writing model's price as the host reads it: LOW for the first `low` readings from now, HIGH afterwards.
  const LOW = PRICED, HIGH = { ...PRICED, outputPerMillionUsd: 10.005 };
  let reads = 0, low = Infinity;
  Object.defineProperty(prices, "now", { configurable: true, get: () => (++reads <= low ? LOW : HIGH) });
  const high = async () => (await tool("jc_workflow_start", { ...args, idempotencyKey: randomUUID(), dryRun: true })).data.estimate.highUsd as number;
  const lower = await high(), perCall = reads;
  low = 0;
  const higher = await high();
  // RE-DERIVED on ruling R10 (was $0.96: three turns at the window's $0.22). Three pictures cost $0.60. The known
  // brief adds 1,108 bytes × $1 / million = $0.001108:
  //   at $10 out:     $0.60 + 3 × $0.13 + $0.001108 = $0.991108 → $0.9911
  //   at $10.005 out: $0.60 + 3 × $0.13006 + $0.001108 = $0.991288 → $0.9913
  assert.deepEqual([lower, higher], [0.9911, 0.9913]);
  assert.ok(higher > lower && higher.toFixed(2) === lower.toFixed(2), `${lower} and ${higher} read the same on a card`);
  // Two starts asked at the same moment: the first is estimated at the lower price, the second at the higher — both previews exist before either card does.
  reads = 0; low = perCall;
  const firstKey = randomUUID(), secondKey = randomUUID();
  const [first, second] = await Promise.all([tool("jc_workflow_start", { ...args, idempotencyKey: firstKey }), tool("jc_workflow_start", { ...args, idempotencyKey: secondKey })]);
  assert.deepEqual([first.error?.code, second.error?.code], ["APPROVAL_PENDING", "APPROVAL_PENDING"]);
  await until(() => requests(), (list) => list.length === 2, "the two permission cards");
  assert.equal(requests()[0].detail, requests()[1].detail, "the same words");
  const firstId = /APPROVAL_PENDING:([0-9a-f-]+)/.exec(first.error!.message)![1];
  assert.notEqual(firstId, /APPROVAL_PENDING:([0-9a-f-]+)/.exec(second.error!.message)![1]);
  // The price is the lower one again; the person allows the FIRST card.
  low = Infinity;
  await admin.call("jagentchill.chat.approval.resolve", { requestId: firstId, decision: "allow-once" });
  const started = await tool("jc_workflow_start", { ...args, idempotencyKey: firstKey });
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const spend = (await admin.call("jagentchill.workflow.video.spend", { runId: started.data.runId })) as { confirmedUsd: number | null };
  assert.equal(spend.confirmedUsd, lower, "confirmed for the amount of the card that was allowed — not the other card's in the same words, and not nothing");
  await admin.call("jagentchill.workflow.run.cancel", { runId: started.data.runId });
});

test("A priced chat model (run 5 #5): the question of an ordinary 10-second video is ONE total that contains the writing turns and the picture checks at their bounds beside the pictures, the voice, the listening and the music — nothing is 'price not known', and one Start with that amount carries the run to its end", async () => {
  const { h: h5, admin, prices } = await setup({ measured: true });
  prices.set(PRICED);
  await routeVision(admin);
  const shown = await admin.call("jagentchill.workflow.video.estimate", form({}, null));
  const rows = Object.fromEntries((shown.estimate.stages as Array<{ stage: string; count: number; highUsd: number | null }>).map((stage) => [stage.stage, stage]));
  assert.deepEqual([shown.estimate.unknown, shown.confirmation.unpricedModels, shown.confirmation.needed], [false, [], true]);
  // RE-DERIVED on ruling R10 (was $0.22 a turn). Brief includes its known 1,108 bytes: $0.131108. Script and shot
  // list messages do not exist yet, so they remain $0.13 each; three picture checks remain 3 × $0.13 = $0.39.
  assert.deepEqual([rows.brief.highUsd, rows.script_draft.highUsd, rows.shot_list.highUsd, rows.picture_check.count, rows.picture_check.highUsd], [0.131108, 0.13, 0.13, 3, 0.39]);
  const media = ["assets", "voiceover", "voice_check", "music"].reduce((sum, stage) => sum + (rows[stage].highUsd ?? 0), 0);
  // One total: $0.0981 media plus $0.131108 + five × $0.13 = $0.879208, shown as $0.8792; its 120 % guard is $1.0550.
  const quotedTurns = 0.131108 + 5 * 0.13;
  assert.equal(shown.confirmation.amountUsd, Math.round((media + quotedTurns) * 10_000) / 10_000, "one total: media and the known / not-yet-written turns");
  assert.deepEqual([Math.round(media * 10_000) / 10_000, shown.confirmation.amountUsd, shown.confirmation.stopsAtUsd], [0.0981, 0.8792, 1.055]);
  console.log(`RUN5#5 question: total $${shown.confirmation.amountUsd} = media $${Math.round(media * 10_000) / 10_000} + writing $${quotedTurns}; stops at $${shown.confirmation.stopsAtUsd}`);
  const { run } = await admin.call("jagentchill.workflow.video.start", form({}, shown.confirmation.amountUsd));
  const done = await pausedOrEnded(admin, run.id);
  assert.equal(done.status, "succeeded", `stopped: ${JSON.stringify(done.error ?? done.pauseReason)} ${JSON.stringify(Object.values(await execs(admin, run.id)).filter((step) => step.error).map((step) => [step.nodeId, step.error]))}`);
  // What the six turns were reserved at when they were SENT — each with its real message, by the same rule
  // ((10,000 + bytes) × $1 + 120,000 millionths). The brief quote now includes its same 1,108 bytes; script 1,454 →
  // $0.131454, shot list 1,214 → $0.131214, each look 765 bytes (and its picture, which the measurement alone stands
  // for) → $0.130765: $0.786071 against the $0.78 of the question — inside the run's 120 %, so nobody was asked again.
  const turns = (h5.fake.callsOf("startTurn") as Array<{ message: string }>).map((call) => turnUsd(call.message)), turnsUsd = Math.round(turns.reduce((sum, usd) => sum + usd, 0) * 1e6) / 1e6;
  assert.equal(turns.length, 6);
  assert.ok(turns.every((usd) => usd > 0.13 && usd < 0.135) && turnsUsd > 0.78 && turnsUsd < 0.8, JSON.stringify(turns));
  // The run's record at the paid-call gate: those six reservations (no bill came for them: the test model reports no usage) and what the media was billed.
  const media$ = (await admin.call("jagentchill.workflow.video.spend", { runId: run.id }) as { spentUsd: number }).spentUsd, onRecord = h5.app.generation.gate.action(`run:${run.id}`)!.spentUsd!;
  assert.ok(Math.abs(onRecord - (turnsUsd + media$)) < 0.0001 && onRecord <= shown.confirmation.stopsAtUsd, `on record ${onRecord} = turns ${turnsUsd} + media ${media$}`);
});

test("One money question per run (run 5 #7, with a budget): a run with its own budget whose reader and listener have no known price — named on the start card and allowed by the Start — is not stopped at Voice by that budget for 'a model without a price': it reaches its end, and what those models are billed counts against the budget", async () => {
  const { admin } = await setup({ sound: false });
  const answer = await admin.call("jagentchill.workflow.video.estimate", form({ budgetUsd: 5 }, null));
  const { run } = await admin.call("jagentchill.workflow.video.start", { ...form({ budgetUsd: 5 }, Math.max(answer.confirmation.amountUsd, 0.5)), allowUnpriced: answer.confirmation.unpricedModels });
  const done = await pausedOrEnded(admin, run.id);
  assert.equal(done.status, "succeeded", `the run was stopped again: ${JSON.stringify(done.error ?? done.pauseReason)} ${JSON.stringify(Object.values(await execs(admin, run.id)).filter((step) => step.error).map((step) => [step.nodeId, step.error?.message, step.error?.details]))}`);
  const spend = await admin.call("jagentchill.workflow.video.spend", { runId: run.id });
  assert.ok(spend.budgetUsd === 5 && spend.spentUsd > 0 && spend.remainingUsd < 5, JSON.stringify(spend));
});

// (Added by the price-bound piece, w7 — coordinator's ruling R10.) The rule itself, on the facts it is given: each
// amount is written out so it can be checked by hand. The model: $3 a million in, $15 out, a window of 200,000 tokens.
test("Ruling R10 — what one request of an API-billed chat turn costs: the prompt as MEASURED (a first request to the model, or the session's last prompt and answer) plus the BYTES of the message at the input price, and the model's maximum output at the output price — marked as measured; 'price not known' only for a model that never ran here, one without a known maximum output, or one without a price; the context window prices nothing", async () => {
  const { h } = await setup();
  type Facts = { price?: { inputPerMillionUsd: number; outputPerMillionUsd: number }; maxOutputTokens?: number; overheadTokens?: number; contextWindow?: number };
  const full: Facts = { price: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, maxOutputTokens: 8_000, overheadTokens: 15_000, contextWindow: 200_000 };
  let facts: Facts = full;
  const carried = new Map<string, number>([["session-with-history", 42_000]]);
  const films = new DatabaseSync(":memory:");
  open.push(films);
  const video = createPromptVideo({ now: Date.now, workflows: () => h.app.workflows, generation: () => h.app.generation, sync: h.app.sync, filmDb: films, turnModel: () => ({ billedByCall: true, ...facts }), turnContext: (key) => carried.get(key) });
  const ref = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
  const bound = (turn: { message: string; sessionKey?: string }) => { const made = video.automationMoney.turnBound!({ ref, ...turn } as never) as { usd: number | null; measured?: true }; return [made.usd, made.measured]; };
  // A first turn, "Hello" (5 bytes): (15,000 + 5) × $3 = 45,015; 8,000 × $15 = 120,000 → 165,015 millionths = $0.165015.
  assert.deepEqual(bound({ message: "Hello" }), [0.165015, true]);
  // The message is counted by its BYTES, not its characters: "こんにちは" is 5 characters and 15 bytes — (15,000 + 15) × $3 = 45,045 → $0.165045.
  assert.deepEqual(bound({ message: "こんにちは" }), [0.165045, true]);
  // A later turn of a session whose last prompt and answer were measured at 42,000 tokens: (42,000 + 5) × $3 = 126,015 → 246,015 millionths = $0.246015.
  assert.deepEqual(bound({ message: "Hello", sessionKey: "session-with-history" }), [0.246015, true]);
  // A session nothing was measured of is priced like a first turn of its model.
  assert.deepEqual(bound({ message: "Hello", sessionKey: "session-without-a-turn" }), [0.165015, true]);
  // The window is not read: the same model with a window of 1,000,000 tokens costs the same (before R10: 200,000 × $3 + 200,000 × $15 = $3.60, and $18 with the larger window).
  facts = { ...full, contextWindow: 1_000_000 };
  assert.deepEqual(bound({ message: "Hello" }), [0.165015, true]);
  // "Price not known" — and only then: the model never ran on this host …
  facts = { ...full, overheadTokens: undefined };
  assert.deepEqual(bound({ message: "Hello" }), [null, undefined]);
  // … (a session of it that WAS measured has what the rule needs: its own last prompt) …
  assert.deepEqual(bound({ message: "Hello", sessionKey: "session-with-history" }), [0.246015, true]);
  // … no maximum output is known for it (no window stands in for one) …
  facts = { ...full, maxOutputTokens: undefined };
  assert.deepEqual(bound({ message: "Hello" }), [null, undefined]);
  // … or it has no price.
  facts = { ...full, price: undefined };
  assert.deepEqual(bound({ message: "Hello" }), [null, undefined]);
  // A model that is free is $0, and that is no measurement.
  facts = { ...full, price: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } };
  assert.deepEqual(bound({ message: "Hello" }), [0, undefined]);
  // Never rounded down: at $0.0000004 a million in, 15,005 tokens are 0.006002 millionths of a dollar — counted as one millionth.
  facts = { ...full, price: { inputPerMillionUsd: 0.0000004, outputPerMillionUsd: 0 } };
  assert.deepEqual(bound({ message: "Hello" }), [0.000001, true]);
});

test("Ruling R10 — the maximum output of a catalogue model is the one its provider documents: read from the published list (`top_provider.max_completion_tokens`) beside the price; a model whose entry does not say has none, and nothing is put in its place", async () => {
  const list = { data: [
    { id: "vendor/big", name: "Big", context_length: 200_000, pricing: { prompt: "0.000003", completion: "0.000015" }, top_provider: { context_length: 200_000, max_completion_tokens: 64_000 } },
    { id: "vendor/silent", name: "Silent", context_length: 200_000, pricing: { prompt: "0.000003", completion: "0.000015" }, top_provider: { max_completion_tokens: null } },
    { id: "vendor/bare", name: "Bare", pricing: { prompt: "0.000001", completion: "0.000002" } },
  ] };
  const catalogue = createAggregatorCatalogue({ now: Date.now, http: (async () => new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } })) as never });
  // Not read yet: nothing is known, of the price or of the limit.
  assert.deepEqual([catalogue.priceOf("openrouter", "vendor/big"), catalogue.maxOutputOf("openrouter", "vendor/big")], [undefined, undefined]);
  await catalogue.find("openrouter", "vendor/big");
  assert.deepEqual([catalogue.priceOf("openrouter", "vendor/big"), catalogue.maxOutputOf("openrouter", "vendor/big")], [{ inputPerMillionUsd: 3, outputPerMillionUsd: 15, source: "aggregator" }, 64_000]);
  assert.deepEqual([catalogue.maxOutputOf("openrouter", "vendor/silent"), catalogue.maxOutputOf("openrouter", "vendor/bare"), catalogue.maxOutputOf("acme", "vendor/big")], [undefined, undefined, undefined]);
});
