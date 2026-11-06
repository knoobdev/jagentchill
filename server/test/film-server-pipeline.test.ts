// Evidence copied from film.test.ts helpers after the read recorded in .dev/orc/vf-film/read-start.json (2026-10-09T16:13:00Z); assertions check findings 7 and 8 through film service.
// TEST DOUBLES: the MODEL is the fake agent runtime of `harness.ts` (each writing turn is answered by this file) and the
// generation PROVIDER is `scripts/stub-generation.ts` (one-colour PNGs, sine tones). The film service, the workflow
// engine, sessions, the generation service with its budgets and cache, the blob store and the document store are real.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { film as fm, script, validateProjectDocument, workflow as wf } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { startStubGeneration, type StubGeneration } from "../scripts/stub-generation.ts";
import { createFilmService, type FilmActivity } from "../src/film/service.ts";
import { createWorkflowService } from "../src/workflows/service.ts";
import { createHarness, model as runtimeModel, SAMPLE_MODELS, tick, type Harness } from "./harness.ts";

const open: Array<{ close(): unknown }> = [];
/** The model the Vision role is routed to in the tests that check pictures. */
const VISION = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
/** The Claude Code catalogue of these tests: the harness's, and two more models (every one of them sees pictures) a person may pick for one call or one role. */
const FILM_MODELS = { ...SAMPLE_MODELS, "claude-code": [...SAMPLE_MODELS["claude-code"]!, runtimeModel("haiku", { input: ["text", "image"] }), runtimeModel("opusplan", { input: ["text", "image"] })] };
afterEach(async () => { for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } } });
type Answers = Partial<Record<"story" | "breakdown" | "look", (attempt: number, message: string) => string>>;
type Answer = { film: fm.Film; activity: FilmActivity };

const round4 = (usd: number) => Math.round(usd * 10_000) / 10_000;
const words = (count: number) => Array.from({ length: count }, (_value, index) => `word${index}`).join(" ");
const PLAN = {
  logline: "A girl mends a stranger's lantern.", synopsis: "Linh mends the lantern Minh brings her. Inside is her grandmother's mark.",
  characters: [
    { name: "Linh", role: "lead", age: "17", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" },
    { name: "Minh", role: "supporting", age: 16, description: "a visitor from Da Nang", appearance: "short hair, grey hoodie" },
  ],
  locations: [{ name: "Tran Phu street", description: "old town street at night", appearance: "lantern-lit shopfronts, wet cobbles" }],
  props: [{ name: "Paper lantern", description: "carries the maker's mark", appearance: "faded red paper lantern" }],
  clips: [
    { title: "The stall", panels: [
      { action: "Empty street at dusk.", duration_s: 2, shotSize: "wide", cameraMotion: "static", characters: [], location: "Tran Phu street", props: [], videoPrompt: "slow drift", lines: [{ kind: "narration", speaker: "Narrator", text: "On the night of the full moon the town turns off its lights.", emotion: "Calm" }] },
      { action: "Linh glues silk onto a bamboo frame.", duration_s: 3, shotSize: "medium", cameraMotion: "push-in", characters: ["Linh"], location: "Tran Phu street", props: [], lines: [] },
    ] },
    { title: "The lantern", panels: [
      { action: "Minh holds the lantern out.", duration_s: 3, shotSize: "close-up", cameraMotion: "static", characters: ["Minh", "Linh"], location: "Tran Phu street", props: ["Paper lantern"], lines: [{ kind: "dialogue", speaker: "Minh", text: "Can you fix it?", emotion: "hopeful" }, { kind: "dialogue", speaker: "Linh", text: "Where did you get this?", emotion: "startled" }] },
    ] },
  ],
};
/** A plan of a test as a model's answer. The story of every film here has prose, so its plan must tell it: a plan written for another point with no narration gets a line of it on each of its panels that has no line. */
function told(plan: { clips: ({ panels: Record<string, unknown>[] } & Record<string, unknown>)[] } & Record<string, unknown>): string {
  const linesOf = (panel: Record<string, unknown>) => (panel.lines as { kind?: string }[] | undefined) ?? [];
  if (plan.clips.some((entry) => entry.panels.some((panel) => linesOf(panel).some((line) => line.kind === "narration")))) return JSON.stringify(plan);
  return JSON.stringify({ ...plan, clips: plan.clips.map((entry) => ({ ...entry, panels: entry.panels.map((panel) => (linesOf(panel).length ? panel : { ...panel, lines: [{ kind: "narration", speaker: "Narrator", text: "It was the night of the full moon.", emotion: "" }] })) })) });
}
const DEFAULTS: Required<Answers> = { story: () => words(120), breakdown: () => JSON.stringify(PLAN), look: () => '{"shows": true, "text": false, "why": "It shows the moment."}' };

/** A host with the generation stub connected and the scripted model. */
async function host(options: { connect?: boolean; /** false: the host has no stored consent at all (nothing asks for one). */ consent?: boolean; vision?: boolean; /** The host's "Ask before spending more than" (the product's default is 0: always ask). */ ask?: number; /** false: the provider's list names no listener, so the shipped listener keeps its shipped price. */ listeners?: boolean } = {}) {
  const stub: StubGeneration = await startStubGeneration();
  if (options.listeners === false) stub.listListeners(false);
  const h = await createHarness({ models: FILM_MODELS, extra: { generation: { openRouterBaseUrl: stub.url, /* W7: the double's video tasks are asked about every 20 ms, not the provider's 30 s */ videoPollMs: 20, timings: { retryDelaysMs: [20, 40], jitter: () => 0, circuitMs: 50 } } } as never });
  open.push(stub, h);
  const admin = await h.pair("Studio Mac", "admin");
  if (options.connect !== false) {
    await admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    // TEST-WORLD PRICES (ruling R4: a per-token price is computed only from the request and documented figures — and the double's list prices its reader and its listener per token,
    // sound included, which nobody can count before the sound exists: both would be "price not known", see "Review 14 #10 (film)"): this host's person gave the reader a price per
    // character and the listener the price per call it ships with. A test about another kind of price sets it itself.
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
    await admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.00002 } } });
    // Most tests are about something else than the money question: the host asks only above an amount no film here reaches.
    await admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: options.ask ?? 5 } });
    if (options.consent !== false) await admin.call("jagentchill.provider.consent.grant", { providerId: "openrouter", contentKinds: ["image", "audio"] });
  }
  const counts: Record<string, number> = {}, messages: string[] = [], looks: { message: string; pictures: { type: string; mime: string; jpeg: boolean; bytes: number }[] }[] = [];
  let seen = 0, answers: Answers = {}, paused = false;
  const timer = setInterval(() => {
    if (paused) return;
    // Every turn the server starts on the fake runtime: the message exactly as the runtime gets it, and its pictures.
    const sends = h.fake.callsOf("startTurn") as Array<{ sessionKey: string; message: string; attachments?: { mimeType?: string; data?: string; name?: string }[] }>;
    for (; seen < sends.length; seen++) {
      const call = sends[seen], kind = /\[\[jc-film:(\w+)\]\]/.exec(call.message)?.[1] as keyof Answers | undefined;
      if (!kind) continue;
      messages.push(call.message);
      if (kind === "look") looks.push({ message: call.message, pictures: (call.attachments ?? []).map((file) => ({ type: "image", mime: file.mimeType ?? "", jpeg: Buffer.from(file.data ?? "", "base64").subarray(0, 2).toString("hex") === "ffd8", bytes: Buffer.from(file.data ?? "", "base64").length })) });
      const attempt = (counts[kind] = (counts[kind] ?? 0) + 1);
      // The runtime answers the turn and ends it; the server writes both into the session's transcript.
      const answer = (answers[kind] ?? DEFAULTS[kind])(attempt, call.message);
      try { h.fake.reply(call.sessionKey, answer); } catch { /* the turn's session was closed meanwhile (the step was stopped) */ }
    }
  }, 10);
  open.push({ close: () => clearInterval(timer) });
  return { h, admin, stub, counts, messages, looks, model: { set(next: Answers) { answers = next; }, pause(value: boolean) { paused = value; }, drop() { seen = h.fake.callsOf("startTurn").length; } } };
}
/** That host with a film service built on its store, as after a start of the host. */
async function setup(options: { connect?: boolean; consent?: boolean; vision?: boolean; roles?: Roles; ask?: number; listeners?: boolean; /** What the host knows of the models its turns run on (their price, their limits); without it every turn's price is "not known". */ turnModel?: TurnFacts } = {}) {
  const base = await host(options);
  // The host's own workflow service stops, so the runs of this file belong to the service built here.
  base.h.app.workflows.close();
  return { ...base, ...start(base.h, base.admin, options.vision === true ? { vision: VISION, ...options.roles } : options.roles, options.turnModel) };
}
type Device = Awaited<ReturnType<Harness["pair"]>>;
/** The film service and the workflow service it runs its pipeline on, over the host's store. */
type Roles = Record<string, { runtimeId: string; providerId: string; modelId: string; thinking?: string | null; mode?: string; params?: Record<string, unknown> }>;
type TurnFacts = NonNullable<Parameters<typeof createFilmService>[0]["turnModel"]>;
function start(h: Harness, admin: Device, roles?: Roles, turnModel?: TurnFacts) {
  const events: { event: string; payload: any }[] = [];
  let workflows!: ReturnType<typeof createWorkflowService>;
  const films = createFilmService({ db: h.app.db, now: Date.now, broadcast: (_scope, event, _stream, payload) => void events.push({ event, payload }), workflows: () => workflows, generation: () => h.app.generation, sync: h.app.sync, ...(roles ? { roleModel: (roleId: string) => roles[roleId] } : {}), ...(turnModel ? { turnModel } : {}) });
  workflows = createWorkflowService({ db: h.app.db, now: Date.now, devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, stepTools: () => films.tools });
  films.install();
  open.push(workflows);
  const connection = { deviceId: admin.device.deviceId, role: () => "admin" as const, scopes: () => h.app.devices.scopesOf(admin.device.deviceId) } as never;
  const raw = async (name: string, params: unknown = {}): Promise<any> => films.methods.get(`jagentchill.film.${name}`)!.handle(params, connection);
  /**
   * A call as a person makes it on a screen: when it is refused with the money question, they say yes to the question
   * they are shown — the same call again with `confirmed: true` and what the question named (`details.confirmWith`),
   * as the cost dialog does. Once. (`fail` is the bare call: a test about the question reads the refusal itself.)
   */
  const call = async (name: string, params: unknown = {}): Promise<any> => {
    try { return await raw(name, params); } catch (error) {
      const refused = error as { code?: string; details?: { reason?: string; confirmWith?: Record<string, unknown> } };
      if (refused.code !== "PERMISSION_DENIED" || refused.details?.reason !== "confirmation_required") throw error;
      return raw(name, { ...(params as object), ...refused.details.confirmWith, confirmed: true });
    }
  };
  const fail = async (name: string, params: unknown = {}): Promise<{ code: string; message: string; details?: Record<string, any> }> => { try { await raw(name, params); } catch (error) { return error as never; } return assert.fail(`${name} should have been refused`); };
  /** The failure of a call a person said yes to the cost of (the work itself failed). */
  const failed = async (name: string, params: unknown = {}): Promise<{ code: string; message: string; details?: Record<string, any> }> => { try { await call(name, params); } catch (error) { return error as never; } return assert.fail(`${name} should have failed`); };
  return { films, workflows, events, call, raw, fail, failed, connection: connection as { deviceId: string; role: () => "admin" } };
}
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let value = await read();
  for (let n = 0; n < 1500 && !done(value); n++) { await tick(10); value = await read(); }
  if (!done(value)) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value).slice(0, 6000)}`);
  return value;
}
type World = Awaited<ReturnType<typeof setup>>;
/** The story of most films here: three sentences — the plan of a film comes from its story's sentences (at most a line and a frame for each), and the double's script has three frames and three lines. */
const STORY = "Hoi An, the night of the full moon. Linh glues silk onto a bamboo frame. The lantern rises over the river.";
const MODEL = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
/** Another model the person may pick for one call: a reused film session must move to it. */
const MODEL2 = { runtimeId: "claude-code", providerId: "anthropic", modelId: "haiku" };
/** Nothing is being made for the film any more. */
const idle = (world: Pick<World, "films">, filmId: string) => until(() => world.films.activityOf(filmId), (activity) => !Object.values(activity).some((entry) => entry.state === "running"), "the film's jobs to end");
const images = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/images" && call.status === 200).length;
const speech = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/audio/speech" && call.status === 200).length;
/** A film with its story written and its script made. */
/** A picture a person brought themselves: made here by ffmpeg, not by generation. */
async function ownPng(/** Another number, another picture (other bytes). */ shade = 0): Promise<Uint8Array> {
  const { spawnSync } = await import("node:child_process");
  const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", shade ? `color=c=0x${shade.toString(16).padStart(2, "0")}8040:size=640x360` : "testsrc2=size=640x360", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { maxBuffer: 16 * 1_048_576 });
  assert.equal(made.status, 0, "ffmpeg is needed by this test");
  return made.stdout;
}
/** A person's leave, for this film, to show its frames to the Vision model's provider (a model provider has no host-wide consent of its own). */
const allowLooking = (world: Pick<World, "call">, filmId: string) => world.call("apply", { filmId, ops: [{ op: "references.allow", providerId: VISION.providerId }] });
async function scripted(world: World, patch: Record<string, unknown> = {}): Promise<fm.Film> {
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY, ...patch })) as Answer;
  return ((await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL })) as Answer).film;
}
function project(h: Harness, projectId: string): ProjectDocument {
  const row = h.app.sync.documents.row({ kind: "project", id: projectId });
  assert.ok(row && row.state === "active", "the project is in the host's document store");
  return h.app.sync.documents.head(row) as unknown as ProjectDocument;
}
const track = (document: ProjectDocument, name: string) => [...document.scenes[0].tracks.overlay, ...document.scenes[0].tracks.audio].find((entry) => entry.name === name) as unknown as { elements: Array<Record<string, any>> } | undefined;
const runEnded = (world: Pick<World, "workflows">, runId: string) => until(() => world.workflows.runs.record(runId), (record) => ["succeeded", "failed", "cancelled"].includes(record.status), "the run to end");
const waiting = (world: Pick<World, "workflows">, runId: string, nodeId: string) => until(() => world.workflows.runs.executions(runId, { nodeId })[0], (exec) => exec?.status === "waiting_approval", `${nodeId} to wait`);

async function routeRole(admin: Device, role: "video" | "voice-tts", model: string): Promise<void> {
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [model], enabled: true });
  const state = await admin.call("jagentchill.orc.config.get", {});
  await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { [role]: { enabled: true, profiles: [{ id: "main", provider: "openrouter", model, params: {}, enabled: true }], defaultProfileId: "main", routes: { default: { primary: { profileId: "main" }, fallbacks: [] } }, limits: {} } } } });
}
const videoPosts = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/videos" && call.status === 202 || (call.path === "/videos" && call.status === 200));
const mainOf = (document: ProjectDocument) => (document.scenes[0].tracks.main as unknown as { elements: Array<Record<string, any>> }).elements;


const priceAsBilled = (world: World) => world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.011 } } });
test("VF finding 7: 4:3 quote and actual video request use the same accepted ratio", async () => {
 const world=await setup(); await priceAsBilled(world); await routeRole(world.admin,"video","stub/video-fast");
 let film=await scripted(world); film=(await world.call("apply",{filmId:film.id,ops:[{op:"film.set",fields:{aspectRatio:"4:3",musicMood:"none"}}]})).film;
 const estimate=await world.call("estimate",{filmId:film.id});
 const {run}=await world.call("pipeline.start",{filmId:film.id,mode:"auto",model:MODEL});
 const ended=await runEnded(world,run.id); const posts=videoPosts(world.stub);
 console.log("VF7",JSON.stringify({aspect:film.aspectRatio,capabilities:estimate.capabilities,clipRow:estimate.rows.find((r:any)=>r.id==="clips")??null,run:ended.status,posts:posts.length,requestedRatios:posts.map(p=>p.video?.aspect),errors:world.workflows.runs.executions(run.id,{}).map(e=>({node:e.nodeId,status:e.status,error:e.error})),timeline:world.films.read(film.id).project}));
 assert.equal(estimate.capabilities.video,true,"4:3 must keep motion capability when submission falls back to accepted ratio");
 assert.equal(posts.length,3); assert.ok(estimate.rows.find((r:any)=>r.id==="clips")?.usd>0);
});
test("VF finding 8: Stop Make the film cancels pending video jobs, polling and retry lock", async () => {
 const world=await setup(); await priceAsBilled(world); await routeRole(world.admin,"video","stub/video-fast");
 world.model.set({breakdown:()=>JSON.stringify({...PLAN,clips:PLAN.clips.map(c=>({...c,panels:c.panels.map(p=>({...p,videoPrompt:"Slow movement [video-asks:1000]"}))}))})});
 let film=await scripted(world); film=(await world.call("apply",{filmId:film.id,ops:[{op:"film.set",fields:{musicMood:"none"}}]})).film;
 const {run}=await world.call("pipeline.start",{filmId:film.id,mode:"auto",model:MODEL});
 await until(()=>({tasks:world.stub.videoTasks(),run:world.workflows.runs.record(run.id),execs:world.workflows.runs.executions(run.id,{})}),x=>x.tasks.length>=2||x.run.status==="failed","two video tasks pending"); console.log("VF8 before cancel",JSON.stringify(world.workflows.runs.executions(run.id,{}).map(e=>({node:e.nodeId,status:e.status,error:e.error}))));
 world.workflows.runs.cancel(run.id,"user",world.admin.device.deviceId);
 await tick(150); const before=world.stub.calls.filter(c=>c.path==="/videos/:id").length;
 await tick(400); const after=world.stub.calls.filter(c=>c.path==="/videos/:id").length;
 const activity=world.films.activityOf(film.id);
 let retry:any; try{retry=await world.raw("generate",{filmId:film.id,target:{kind:"clip",id:film.panels[0].id}});}catch(e){retry={code:(e as any).code,message:(e as any).message};}
 console.log("VF8",JSON.stringify({run:world.workflows.runs.record(run.id).status,pollsBefore:before,pollsAfter:after,activity,retry}));
 assert.equal(after,before,"no provider polling after Stop");
 assert.ok(!Object.values(activity).some(a=>a.state==="running"),"shots released after cancellation");
 assert.notEqual(retry?.message,"This is already being made");
});
