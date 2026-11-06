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
import { createPromptVideo, PROMPTS } from "../src/workflows/templates/prompt-video.ts";
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

// Verifier evidence: real server methods / reservations, fake model and generation provider.
test("VF finding 1: the known brief message is included in the quote approved by the person", async () => {
 const {h,admin,prices}=await setup({measured:true});
 prices.set({inputPerMillionUsd:1,outputPerMillionUsd:10,source:"admin"});
 const input=form({mode:"checkpoints",voice:"none",musicMood:"none"},null);
 const shown=await admin.call("jagentchill.workflow.video.estimate",input);
 const brief=shown.estimate.stages.find((s:any)=>s.stage==="brief");
 const {run}=await admin.call("jagentchill.workflow.video.start",{...input,confirmedUsd:shown.estimate.highUsd});
 await until(()=>h.fake.callsOf("startTurn"),(s)=>s.length===1,"first dispatched brief");
 const sent=h.fake.callsOf("startTurn")[0] as {message:string};
 const reserved=h.app.generation.gate.action(`run:${run.id}`)!.spentUsd;
 const known=PROMPTS.brief(input.params as pv.VideoParams);
 console.log("VF_FINDING_1",JSON.stringify({quotedBrief:brief.highUsd,reservedBrief:reserved,messageBytes:Buffer.byteLength(sent.message),knownBeforeStart:known===sent.message,quotedTotal:shown.estimate.highUsd,underquote:reserved-brief.highUsd}));
 assert.equal(brief.highUsd,reserved,"the approved brief quote must equal its initial reservation");
});
test("VF finding 2 control: with price and measurement present, only missing maximum output makes the model unpriced", async()=>{
 const skew={ms:0};const h=await createHarness({now:()=>Date.now()+skew.ms,models:MODELS,extra:{modelPrice:()=>({inputPerMillionUsd:3,outputPerMillionUsd:15,source:"admin"}),modelMaxOutput:()=>undefined}});open.push(h);await billedByKey(h,skew);
 const admin=await h.pair("Verifier","admin");
 const ref={runtimeId:"claude-code",providerId:"anthropic",modelId:"haiku"};h.measured(ref,10000);
 let {document}=await admin.call("jagentchill.workflow.create",{name:"Missing output only"});
 const {workflow:wf}=await import("@jagentchill/editor-core");const made=wf.makeNode(document,"agent",{x:400,y:200},"writer");
 await admin.call("jagentchill.workflow.apply",{workflowId:document.id,baseRevision:document.revision,ops:[{op:"node.add",node:{...made,config:{...made.config,promptTemplate:"Draft a line about kites.",runtime:{mode:"override",runtime:"claude-code",provider:"anthropic",model:"haiku"}}}},{op:"edge.add",edge:{id:"e1",from:{node:"start",port:"done"},to:{node:"writer",port:"start"}}}]});
 const shown=await admin.call("jagentchill.workflow.run.estimate",{workflowId:document.id});
 console.log("VF_FINDING_2_CONTROL",JSON.stringify({price:[3,15],measurementRows:h.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE model_id='haiku'").get()!.n,maxOutput:null,unitUsd:shown.estimate.steps[0].unitUsd}));
 assert.equal(shown.estimate.steps[0].unitUsd,null);
});
