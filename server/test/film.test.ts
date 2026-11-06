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
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
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

/** The clock of each host (the host's and its film service's): moved on, a CLI sign-in the host read is read again. */
const clocks = new WeakMap<Harness, { skewMs: number }>();
const clockOf = (h: Harness) => () => Date.now() + (clocks.get(h)?.skewMs ?? 0);
/**
 * The CLI of a runtime is signed in with an API KEY (its own status command says so): its turns are billed per call and
 * asked about like any paid work (ruling R9) — as the turns of the removed built-in models were. The host reads the
 * sign-in when it starts; its clock is moved past the time a reading holds, the new one is waited for, and the clock is
 * put back (a reading taken "in the future" stays fresh; signed requests of devices need the true time).
 */
async function billedByKey(h: Harness, runtimeId: "claude-code" | "codex"): Promise<void> {
  if (runtimeId === "claude-code") h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })));
  else h.results.set("codex login status", h.ok("Logged in using an API key - sk-***\n"));
  clocks.get(h)!.skewMs += LOGIN_STALE_MS + 1;
  const billing = () => h.app.generation.gate.billingOf({ ref: { runtimeId, providerId: runtimeId === "codex" ? "openai" : "anthropic", modelId: "m" } });
  for (let i = 0; i < 200 && billing() !== "per_call"; i++) await tick(5);
  clocks.get(h)!.skewMs = 0;
  assert.equal(billing(), "per_call", `${runtimeId} is billed per call`);
}
/** A host with the generation stub connected and the scripted model. */
async function host(options: { /** How the Claude Code CLI is signed in: "key" (default) — an API key, every turn billed per call; "own" — the person's own subscription. */ signIn?: "key" | "own"; connect?: boolean; /** false: the host has no stored consent at all (nothing asks for one). */ consent?: boolean; vision?: boolean; /** The host's "Ask before spending more than" (the product's default is 0: always ask). */ ask?: number; /** false: the provider's list names no listener, so the shipped listener keeps its shipped price. */ listeners?: boolean } = {}) {
  const stub: StubGeneration = await startStubGeneration();
  if (options.listeners === false) stub.listListeners(false);
  const clock = { skewMs: 0 };
  const h = await createHarness({ models: FILM_MODELS, now: () => Date.now() + clock.skewMs, extra: { generation: { openRouterBaseUrl: stub.url, /* W7: the double's video tasks are asked about every 20 ms, not the provider's 30 s */ videoPollMs: 20, timings: { retryDelaysMs: [20, 40], jitter: () => 0, circuitMs: 50 } } } as never });
  open.push(stub, h);
  clocks.set(h, clock);
  if (options.signIn !== "own") await billedByKey(h, "claude-code");
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
async function setup(options: { signIn?: "key" | "own"; connect?: boolean; consent?: boolean; vision?: boolean; roles?: Roles; ask?: number; listeners?: boolean; /** What the host knows of the models its turns run on (their price, their limits); without it every turn's price is "not known". */ turnModel?: TurnFacts } = {}) {
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
  const films = createFilmService({ db: h.app.db, now: clockOf(h), broadcast: (_scope, event, _stream, payload) => void events.push({ event, payload }), workflows: () => workflows, generation: () => h.app.generation, sync: h.app.sync, ...(roles ? { roleModel: (roleId: string) => roles[roleId] } : {}), ...(turnModel ? { turnModel } : {}) });
  workflows = createWorkflowService({ db: h.app.db, now: clockOf(h), devices: h.app.devices, broadcast: () => undefined, agentsReady: () => true, sessions: () => h.app.relay, stepTools: () => films.tools });
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
/**
 * The agent sessions that ran a turn, in the order of their first turn, each with the title it has now (a runtime
 * session is opened with a session's first turn, so a session that never wrote is not here).
 */
function sessionsMade(h: Harness): { key: string; displayName?: string }[] {
  const keys = [...new Set((h.fake.callsOf("startTurn") as { sessionKey: string }[]).map((call) => call.sessionKey))];
  return keys.map((key) => { const row = h.app.db.prepare("SELECT title FROM agent_sessions WHERE session_key = ?").get(key) as { title: string | null } | undefined; return { key, ...(row?.title ? { displayName: row.title } : {}) }; });
}
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

test("Create with defaults: a film is stored on the host with the spec's defaults, listed, changed only by the person's changes, and deleted", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper" })) as Answer;
  assert.deepEqual([film.aspectRatio, film.artStyle, film.frameRate, film.captions, film.revision], ["16:9", "cinematic-realistic", 24, true, 1]);
  // A second film of the same name gets its own title.
  assert.equal(((await world.call("create", { title: "The Lantern Keeper" })) as Answer).film.title, "The Lantern Keeper 2");
  assert.deepEqual((await world.call("list")).films.map((entry: { title: string }) => entry.title).sort(), ["The Lantern Keeper", "The Lantern Keeper 2"]);
  const changed = (await world.call("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { sourceText: "Hoi An.", artStyle: "watercolour" } }, { op: "asset.add", kind: "character", fields: { name: "Linh" } }] })) as Answer;
  assert.deepEqual([changed.film.revision, changed.film.sourceText, changed.film.artStyle, changed.film.characters[0].name], [2, "Hoi An.", "watercolour", "Linh"]);
  assert.ok(world.events.some((entry) => entry.event === "jagentchill.film.updated" && entry.payload.filmId === film.id && entry.payload.revision === 2), "every change is announced with the film");
  // Duplicate character name
  const duplicate = await world.fail("apply", { filmId: film.id, ops: [{ op: "asset.add", kind: "character", fields: { name: "linh" } }] });
  assert.deepEqual([duplicate.code, duplicate.message], ["INVALID_PARAMS", "A character with this name already exists"]);
  // Custom style without text
  assert.equal((await world.fail("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { artStyle: "custom" } }] })).message, "Describe the custom style");
  // Method outside the table: what a generation records cannot be sent from a screen.
  const refused = await world.fail("apply", { filmId: film.id, ops: [{ op: "spent.add", usd: 5 }] });
  assert.deepEqual([refused.code, refused.details!.op], ["INVALID_PARAMS", "spent.add"]);
  assert.equal(world.films.read(film.id).revision, 2, "a refused change changes nothing");
  await world.call("delete", { filmId: film.id });
  assert.equal((await world.fail("get", { filmId: film.id })).code, "NOT_FOUND");
  assert.equal((await world.call("list")).films.length, 1);
});

test("Viewer device: the film methods carry the scopes of reading, editing and generating", async () => {
  const world = await setup();
  const scope = (name: string) => world.films.methods.get(`jagentchill.film.${name}`)!.scope;
  assert.deepEqual(["list", "get", "estimate"].map(scope), Array(3).fill("jagentchill.projects.read"));
  assert.deepEqual(["create", "apply", "delete", "assemble"].map(scope), Array(4).fill("jagentchill.projects.write"));
  assert.deepEqual(["write", "generate", "pipeline.start"].map(scope), Array(3).fill("jagentchill.generation.run"));
});

test("Expansion sized to target, Markup rejected: a story with Markdown goes back to the model and its plain second answer becomes the story", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "Tea" })) as Answer;
  // Empty text
  assert.deepEqual([(await world.fail("write", { filmId: film.id, what: "story", idea: " ", seconds: 30, model: MODEL })).code, world.counts.story], ["INVALID_PARAMS", undefined]);
  world.model.set({ story: (attempt) => (attempt === 1 ? `# Title\n\n${words(120)}` : words(120)) });
  const written = (await world.call("write", { filmId: film.id, what: "story", idea: "A girl mends a lantern", seconds: 30, tone: "quiet", model: MODEL })) as Answer;
  assert.equal(world.counts.story, 2);
  assert.match(world.messages[0], /between 100 and 150 words/);
  assert.match(world.messages[1], /remove the Markdown headings/);
  assert.equal(fm.storyCounts(written.film.sourceText).words, 120);
  assert.deepEqual(written.activity, {});
  // Generation fails: three answers of the wrong size leave the story as it was and say why.
  world.model.set({ story: () => "Too short." });
  const failed = await world.failed("write", { filmId: film.id, what: "story", idea: "Another idea", seconds: 30, model: MODEL });
  assert.match(failed.details!.problems[0], /the story has 2 words/);
  assert.equal(world.films.read(film.id).sourceText, written.film.sourceText);
  assert.equal(world.films.activityOf(film.id).story.state, "failed");
});

test("Repairable output: an invalid film plan is corrected by the model, and Invalid after all attempts leaves the film unchanged", async () => {
  const world = await setup();
  assert.equal((await world.fail("write", { filmId: ((await world.call("create", { title: "Empty" })) as Answer).film.id, what: "breakdown", model: MODEL })).message, "Write the story first.");
  world.model.set({ breakdown: (attempt) => (attempt === 1 ? JSON.stringify({ ...PLAN, clips: [{ title: "x", panels: [{ action: "A", characters: ["Nobody"] }] }] }) : `Here it is:\n${JSON.stringify(PLAN)}`) });
  const film = await scripted(world);
  assert.equal(world.counts.breakdown, 2);
  assert.match(world.messages[1], /names the character "Nobody", which is not in your list/);
  assert.deepEqual([film.characters.map((entry) => entry.id), film.locations.length, film.props.length, film.clips.length, film.panels.length, film.lines.length], [["ch_linh", "ch_minh"], 1, 1, 2, 3, 3]);
  assert.deepEqual(film.lines.map((line) => [line.speakerId, line.kind, line.panelId]), [["narrator", "narration", "pa_1"], ["ch_minh", "dialogue", "pa_3"], ["ch_linh", "dialogue", "pa_3"]]);
  world.model.set({ breakdown: () => "I cannot do that." });
  const failed = await world.failed("write", { filmId: film.id, what: "breakdown", model: MODEL });
  assert.equal(world.counts.breakdown, 5, "the first answer and two corrections");
  assert.deepEqual(failed.details!.problems, ["the answer is not a JSON object"]);
  assert.equal(world.films.read(film.id).revision, film.revision);
});

test("One session per film: every writing turn of a film shares the film's own session, named after the film", async () => {
  const world = await setup();
  const before = sessionsMade(world.h).length;
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  // Three writing turns for one film: the story, then the script twice.
  await world.call("write", { filmId: film.id, what: "story", idea: "A lantern mender", seconds: 30, model: MODEL });
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  const created = sessionsMade(world.h);
  assert.equal(created.length - before, 1, "three writing turns leave exactly one session");
  assert.equal((created.at(-1) as { displayName?: string }).displayName, "The Lantern Keeper", "the session is titled with the film's name");
  // A second film writes in its own session.
  const other = ((await world.call("create", { title: "The Second Film", sourceText: STORY })) as Answer).film;
  await world.call("write", { filmId: other.id, what: "breakdown", model: MODEL });
  assert.equal(sessionsMade(world.h).length - before, 2, "each film has its own session");
});

test("One session per film survives a restart: a new service reuses the film's stored session", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  const created = sessionsMade(world.h).length;
  // The host stops and starts again: only the store is left (the same as a server restart).
  world.workflows.close();
  const next = start(world.h, world.admin);
  await next.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  assert.equal(sessionsMade(world.h).length, created, "a restart reuses the film's stored session, it makes none");
});

test("A film whose stored session was deleted gets a replacement: the association is cleared and writing succeeds", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  const first = sessionsMade(world.h);
  const stale = (first.at(-1) as { key: string }).key;
  // The person deletes the film's session from the Sessions list while the film still names it.
  world.h.app.db.prepare("DELETE FROM agent_sessions WHERE session_key = ?").run(stale);
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  const after = sessionsMade(world.h);
  assert.equal(after.length, first.length + 1, "exactly one replacement session is created");
  const replacement = (after.at(-1) as { key: string }).key;
  assert.notEqual(replacement, stale, "the replacement is a new session");
  const linked = world.h.app.db.prepare("SELECT session_key FROM film_sessions WHERE film_id = ?").get(film.id) as { session_key: string };
  assert.equal(linked.session_key, replacement, "the film now names the replacement");
  assert.equal(world.films.read(film.id).panels.length, 3, "the writing succeeded on the replacement session");
});

test("A film's writing session is shared: a second editor device continues the same session", async () => {
  const { h } = await host();
  const first = await h.pair("Editor One", "editor");
  const second = await h.pair("Editor Two", "editor");
  const { film } = await first.call("jagentchill.film.create", { title: "The Lantern Keeper", sourceText: STORY });
  const before = sessionsMade(h).length;
  await first.yes("jagentchill.film.write", { filmId: film.id, what: "story", idea: "A lantern mender", seconds: 30, model: MODEL });
  assert.equal(sessionsMade(h).length - before, 1, "the first editor created the film's writing session");
  const sessionKey = (sessionsMade(h).at(-1) as { key: string }).key;
  const stored = h.app.db.prepare("SELECT access, owner_device_id FROM agent_sessions WHERE session_key = ?").get(sessionKey) as { access: string; owner_device_id: string };
  assert.deepEqual([stored.access, stored.owner_device_id], ["host", first.device.deviceId], "the session is shared (host access), owned by its creator");
  // The second editor reads the session and writes the script of the same film in it.
  assert.equal((await second.call("jagentchill.session.get", { sessionKey })).session.sessionKey, sessionKey);
  await second.yes("jagentchill.film.write", { filmId: film.id, what: "breakdown", model: MODEL });
  assert.equal(sessionsMade(h).length - before, 1, "the second editor reused the shared session, it created none");
});

test("Concurrent first calls for one film create exactly one session", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const before = sessionsMade(world.h).length;
  // The story and the script are two different targets of the same film, so both start while no session exists yet.
  await Promise.all([
    world.call("write", { filmId: film.id, what: "story", idea: "A lantern mender", seconds: 30, model: MODEL }),
    world.call("write", { filmId: film.id, what: "breakdown", model: MODEL }),
  ]);
  assert.equal(sessionsMade(world.h).length - before, 1, "two concurrent first calls share one session");
});

test("A writing role's profile is applied whole and nothing of the role before it stays: the Screenwriter's thinking option is set, the Storyboard's profile — same model, NO thinking option, another mode — resets the thinking to the model's own and sets its mode, and model options an agent runtime cannot take per turn are said in the run log, not dropped unseen", async () => {
  // (A model that offers thinking options: Claude Code's sonnet of the harness, low and high.)
  const THINKS = { ...MODEL, modelId: "sonnet" };
  const world = await setup({ roles: { screenwriter: { ...THINKS, thinking: "high", mode: "edit", params: {} }, storyboard: { ...THINKS, thinking: null, mode: "ask", params: { temperature: 0.2, extraBody: { top_k: 5 } } } } });
  const { film } = (await world.call("create", { title: "Routed", sourceText: "" })) as Answer;
  const session = async () => { const all = (await world.admin.call("jagentchill.session.list", { includeWorkflowRuns: true })).sessions as any[]; assert.equal(all.length, 1, "one session for the film"); return all[0]; };
  // The thinking option the runtime session ran each turn with, as it was opened for that turn.
  const sentWith = () => (world.h.fake.callsOf("startTurn") as { options: { thinking?: string } }[]).map((call) => call.options.thinking ?? null);
  await world.call("write", { filmId: film.id, what: "story", idea: "a lantern", seconds: 30 });
  let now = await session();
  assert.deepEqual([now.ref.modelId, now.thinkingOptionId, now.modeId], ["sonnet", "high", "edit"]);
  // The Storyboard role runs on the SAME model with a profile that names no thinking option: the Screenwriter's must not stay.
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints" });
  await waiting(world, run.id, "check_breakdown");
  now = await session();
  assert.deepEqual([now.ref.modelId, now.thinkingOptionId, now.modeId], ["sonnet", null, "ask"]);
  assert.deepEqual(sentWith(), ["high", null], "each turn was sent with its own profile's thinking");
  assert.match(world.workflows.runs.logs(run.id).map((entry) => entry.message).join("\n"), /The storyboard profile's model options \(temperature, extraBody\) are not applied to this turn/);
  // And back: the story written again gets the Screenwriter's option and mode again.
  await world.call("write", { filmId: film.id, what: "story", idea: "a lantern, again", seconds: 30 });
  now = await session();
  assert.deepEqual([now.thinkingOptionId, now.modeId, sentWith()], ["high", "edit", ["high", null, "high"]]);
});

test("A reused session takes the model the person selected for this call", async () => {
  const world = await setup();
  // The model and the session of each turn are observed at the moment the turn is actually sent.
  const sent = () => world.h.fake.callsOf("startTurn") as { sessionKey: string; options: { model?: string } }[];
  const film = await scripted(world);
  const created = sessionsMade(world.h).length;
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL2 });
  const calls = sessionsMade(world.h);
  assert.equal(calls.length, created, "the second call continues the film's session, it does not create one");
  const sessionKey = (calls.at(-1) as { key: string }).key;
  assert.deepEqual(sent().map((call) => call.options.model), ["opus", "haiku"], "each turn was sent on the model of its own call");
  assert.deepEqual(sent().map((call) => call.sessionKey), [sessionKey, sessionKey], "both turns ran in the film's own session");
  // The switch is applied before the second turn is sent: the film's session is opened again on the new model for it.
  const all = world.h.fake.calls;
  const lastSend = all.map((call, index) => ({ call, index })).filter(({ call }) => call.method === "startTurn").at(-1)!.index;
  const switched = all.map((call, index) => ({ call, index })).find(({ call }) => (call.method === "createSession" || call.method === "resumeSession") && call.params?.sessionKey === sessionKey && call.params?.model === "haiku")?.index;
  assert.ok(switched !== undefined && switched < lastSend, "the model switch happens before the second turn is sent");
});

test("A pipeline run writes the script of a film in the studio's own session", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const before = sessionsMade(world.h).length;
  await world.call("write", { filmId: film.id, what: "story", idea: "A lantern mender", seconds: 30, model: MODEL });
  assert.equal(sessionsMade(world.h).length - before, 1, "the studio writing created the film's session");
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  assert.equal(sessionsMade(world.h).length - before, 1, "the pipeline's script stage reused the studio's session");
});

test("Generate one panel, Regenerate keeps the current image, Select a candidate, Dismiss: pictures are jobs of the generation service and a second picture waits beside the first", async () => {
  const world = await setup(), film = await scripted(world);
  const started = (await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_3" } })) as Answer;
  assert.equal(started.activity["panel:pa_3"].state, "running", "the answer comes at once, the job is listed");
  await idle(world, film.id);
  let panel = world.films.read(film.id).panels[2];
  assert.ok(panel.picture.current && !panel.picture.candidates.length);
  // Consistency: the request repeats the appearance of the cast, the place and the prop of the panel.
  const asked = world.stub.calls.find((call) => call.path === "/images")!.text;
  for (const part of ["close-up", "black braid, indigo ao dai", "short hair, grey hoodie", "lantern-lit shopfronts", "faded red paper lantern", "cinematic"]) assert.ok(asked.includes(part), `the request names "${part}"`);
  assert.equal(world.h.app.sync.blobs.status(panel.picture.current!.media.blobId).state, "complete");
  assert.equal(world.films.read(film.id).spentUsd, 0.011);
  // Regenerate bypasses the cache: a second request reaches the provider, and its picture is a candidate.
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_3" } });
  await idle(world, film.id);
  panel = world.films.read(film.id).panels[2];
  assert.deepEqual([images(world.stub), panel.picture.candidates.length], [2, 1]);
  const kept = panel.picture.current!.id, offered = panel.picture.candidates[0].id;
  assert.notEqual(kept, offered);
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.dismiss", id: "pa_3" }] });
  assert.deepEqual([world.films.read(film.id).panels[2].picture.current!.id, world.films.read(film.id).panels[2].picture.candidates.length], [kept, 0]);
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_3" } });
  await idle(world, film.id);
  const next = world.films.read(film.id).panels[2].picture.candidates[0].id;
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.use", id: "pa_3", versionId: next }] });
  assert.equal(world.films.read(film.id).panels[2].picture.current!.id, next);

  // Reference pictures: "Generate missing" makes one per character, place and prop, and only the missing ones.
  await world.call("generate", { filmId: film.id, target: { kind: "asset", assetKind: "character", id: "ch_linh" } });
  await idle(world, film.id);
  const before = images(world.stub);
  await world.call("generate", { filmId: film.id, target: { kind: "assets", scope: "missing" } });
  await idle(world, film.id);
  assert.equal(images(world.stub) - before, 3);
  assert.equal(fm.counts(world.films.read(film.id)).assetsMissing, 0);
  // Appearance change marks panels: the reference and the panels that show the character are outdated.
  const edited = (await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_linh", fields: { appearance: "short bob, yellow raincoat" } }] })) as Answer;
  assert.deepEqual([edited.film.characters[0].picture.stale, edited.film.panels[2].picture.stale], [true, true]);
  // Provider refuses the prompt: the failure is listed beside the panel and nothing is stored.
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_1", fields: { action: "A street [blocked]" } }] });
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_1" } });
  await idle(world, film.id);
  assert.deepEqual([world.films.activityOf(film.id)["panel:pa_1"].state, world.films.activityOf(film.id)["panel:pa_1"].code, world.films.read(film.id).panels[0].picture.current], ["failed", "CONTENT_BLOCKED", null]);
});

test("Re-take, Generate all, Assign from the character card: takes are kept per line, a batch makes only the lines without a usable take", async () => {
  const world = await setup(), film = await scripted(world);
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_2" } });
  await idle(world, film.id);
  const first = world.films.read(film.id).lines[1];
  assert.deepEqual([first.takes.length, first.activeTakeId, first.takes[0].duration_ticks > 0], [1, first.takes[0].id, true]);
  // Re-take with "Keep current take": the new take is kept beside the one in use.
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_2", keepCurrent: true } });
  await idle(world, film.id);
  const second = world.films.read(film.id).lines[1];
  assert.deepEqual([second.takes.length, second.activeTakeId, speech(world.stub)], [2, first.takes[0].id, 2]);
  await world.call("apply", { filmId: film.id, ops: [{ op: "line.take.use", id: "li_2", takeId: second.takes[0].id }] });
  assert.equal(world.films.read(film.id).lines[1].activeTakeId, second.takes[0].id);
  // Generate all: the two lines without a take.
  await world.call("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } });
  await idle(world, film.id);
  assert.deepEqual([speech(world.stub), fm.counts(world.films.read(film.id)).linesMissing], [4, 0]);
  // A new voice for Minh (not the one automatic casting gave him): his takes are outdated, and only his line is made again.
  const offered = (await world.call("estimate", { filmId: film.id })).voices as { voiceId: string }[];
  const before = world.films.read(film.id).characters.find((entry) => entry.id === "ch_minh")!.voiceId;
  const voice = offered.find((entry) => entry.voiceId !== before)!.voiceId;
  const assigned = (await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_minh", fields: { voiceId: voice } }] })) as Answer;
  assert.deepEqual([assigned.film.lines[1].takes.every((take) => take.stale), assigned.film.stale], [true, ["voice"]]);
  await world.call("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } });
  await idle(world, film.id);
  const done = world.films.read(film.id);
  assert.deepEqual([speech(world.stub), fm.activeTake(done.lines[1])!.voiceId, done.stale], [5, voice, []]);
});

test("Tracks created, Canvas from film settings, Panels without media, Unbound line reported: the film becomes a real project and the same film is the same project", async () => {
  const world = await setup(), film = await scripted(world, { aspectRatio: "9:16" });
  assert.equal((await world.fail("assemble", { filmId: film.id })).message, "3 panels have no media. Generate them, or assemble without them.");
  await world.call("generate", { filmId: film.id, target: { kind: "panels", scope: "missing", clipId: "cl_1" } });
  await world.call("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } });
  await idle(world, film.id);
  assert.deepEqual([images(world.stub), fm.counts(world.films.read(film.id)).panelsMissing], [2, 1]);
  assert.equal((await world.fail("assemble", { filmId: film.id })).message, "1 panel has no media. Generate them, or assemble without them.");
  const assembled = (await world.call("assemble", { filmId: film.id, withoutMissing: true })) as Answer, made = assembled.film.project!;
  const document = project(world.h, made.projectId);
  assert.ok(validateProjectDocument(document, { mode: "strict" }).ok);
  assert.deepEqual(document.settings.canvasSize, { width: 1080, height: 1920 });
  const main = document.scenes[0].tracks.main.elements as Array<Record<string, any>>;
  assert.deepEqual([main.length, made.clips, made.voiceElements], [2, 2, 1]);
  assert.ok(main[1].animations["transform.scale.x"], "the push-in panel has its motion");
  assert.equal(track(document, "Voiceover")!.elements.length, 1);
  assert.ok(track(document, "Captions")!.elements.length >= 1);
  // The lines of the panel that was left out are not placed.
  assert.deepEqual(fm.layout(assembled.film).unbound.map((line) => line.id), ["li_2", "li_3"]);
  assert.equal(((await world.call("assemble", { filmId: film.id, withoutMissing: true })) as Answer).film.project!.projectId, made.projectId);
  // A panel drawn afterwards: the timeline is outdated until it is assembled again, into another project.
  await world.call("generate", { filmId: film.id, target: { kind: "panels", scope: "missing" } });
  await idle(world, film.id);
  assert.deepEqual(world.films.read(film.id).stale, ["timeline"]);
  const again = (await world.call("assemble", { filmId: film.id })) as Answer;
  assert.notEqual(again.film.project!.projectId, made.projectId);
  assert.deepEqual([again.film.project!.clips, again.film.project!.voiceElements, again.film.stale], [3, 3, []]);
});

test("Cost report, No model for pictures at all: the estimate counts what is missing at the host's prices and makes no request; without an image provider nothing starts", async () => {
  const world = await setup(), film = await scripted(world);
  const answer = await world.call("estimate", { filmId: film.id });
  assert.deepEqual(answer.rows.map((row: { id: string; count: number }) => [row.id, row.count]), [["assets", 4], ["panels", 3], ["voice", 3], ["listening", 3], ["music", 1]]);
  // The estimate counts pictures at the price the film really pays for them (the low quality tier), not the model's default.
  assert.ok(answer.rows[0].unitUsd === 0.003 && answer.totalUsd > 0.05 && answer.rows[0].usd === answer.rows[0].unitUsd * 4, JSON.stringify(answer.rows));
  assert.deepEqual(answer.capabilities, { image: true, speech: true, music: true, video: false });
  assert.equal(world.stub.calls.filter((call) => call.path === "/images" || call.path === "/chat/completions" || call.path === "/audio/speech").length, 0);

  const bare = await setup({ connect: false }), other = await scripted(bare);
  assert.deepEqual((await bare.call("estimate", { filmId: other.id })).capabilities, { image: false, speech: false, music: false, video: false });
  const refused = await bare.fail("generate", { filmId: other.id, target: { kind: "panels", scope: "missing" } });
  assert.equal(refused.code, "NO_ROUTE");
  assert.match(refused.message, /connect an image provider/);
});

test("Review 14 #7 — Make the film checks what it needs BEFORE it asks or spends: on a host that cannot make pictures, speech or music the start is refused at once — it says which roles are missing and where they are set — no money question is put, no run starts and the script is NOT written (nothing is paid for a film that cannot be made); with the provider connected the same press makes the film", async () => {
  const bare = await setup({ connect: false });
  const { film } = (await bare.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const refused = await bare.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL }), details = refused.details as { reason: string; missing: { capability: string; role: string }[]; confirmWith?: unknown; estimate?: unknown };
  assert.deepEqual([refused.code, details.reason, details.missing.map((entry) => [entry.capability, entry.role]), details.confirmWith, details.estimate], ["NO_ROUTE", "route_missing", [["image", "Image"], ["tts", "Voice"], ["music", "Music"]], undefined, undefined]);
  assert.match(refused.message, /Settings, Providers, Generation.*Settings, Model routing/);
  const made = bare.films.read(film.id);
  assert.deepEqual([made.pipelineRunId, made.panels.length, bare.counts.breakdown ?? 0, bare.h.app.generation.gate.action(`film.start:${film.id}`)], [null, 0, 0, undefined], "no run, no script, no writing turn, no question on record");
  assert.equal(bare.stub.calls.filter((call) => call.path === "/images" || call.path === "/chat/completions" || call.path === "/audio/speech").length, 0, "nothing reached the generation provider");
  // The person connects an image provider, then presses Make the film again: the run continues from the pictures.
  await bare.admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
  await bare.admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
  await bare.admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 5 } });
  for (const [id, capability, pricing] of [["google/gemini-3.8-flash-lite-tts", "tts", { kind: "per_character", perThousandUsd: 0.000125 }], ["qwen/qwen3-asr-1.7b", "transcription", { kind: "per_call", usd: 0.00002 }]] as const) await bare.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id, capability, pricing } });
  assert.deepEqual((await bare.call("estimate", { filmId: film.id })).capabilities, { image: true, speech: true, music: true, video: false });
  const { run: second } = await bare.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(bare, second.id)).status, "succeeded");
  assert.equal(bare.counts.breakdown, 1, "the script was written once, by the run that could make the film");
  const done = bare.films.read(film.id);
  assert.deepEqual([fm.counts(done).assetsMissing, fm.counts(done).panelsMissing, fm.counts(done).linesMissing], [0, 0, 0]);
  assert.equal(images(bare.stub), 7, "the four reference pictures and the three panels were made once");
});

test("Editing the story makes the script outdated: Make the film writes the breakdown again from the new story", async () => {
  const world = await setup(), film = await scripted(world);
  assert.equal(world.counts.breakdown, 1);
  const edited = (await world.call("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { sourceText: "A completely different story about a river." } }] })) as Answer;
  assert.equal(edited.film.scriptStale, true, "editing the story marks the script outdated");
  // A second plan, so the rewrite is observable.
  world.model.set({ breakdown: () => told({ ...PLAN, characters: [{ name: "Lan", role: "lead", description: "a ferryman", appearance: "straw hat" }], clips: [{ title: "The river", panels: [{ action: "A river at dawn.", duration_s: 3 }] }] }) });
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  await runEnded(world, run.id);
  const made = world.films.read(film.id);
  assert.equal(world.counts.breakdown, 2, "the script was written again");
  assert.deepEqual([made.characters.map((entry) => entry.name), made.clips.length], [["Lan"], 1]);
  assert.equal(made.scriptStale, false, "the new script is no longer outdated");
});

test("Template validates, Unattended run, Fan-out skips finished items: one run takes a story to an assembled film, and a second run makes nothing again", async () => {
  const world = await setup();
  const template = world.workflows.docs.get(fm.FILM_TEMPLATE_ID);
  assert.deepEqual([template.meta.protected, template.nodes.length, wf.validate(template).errors.length], [true, 24, 0]);
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL })).code, "CONFLICT");
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const made = world.films.read(film.id);
  assert.deepEqual([made.pipelineRunId, fm.counts(made).assetsMissing, fm.counts(made).panelsMissing, fm.counts(made).linesMissing, !!made.music.current, images(world.stub)], [run.id, 0, 0, 0, true, 7]);
  const document = project(world.h, made.project!.projectId);
  assert.ok(validateProjectDocument(document, { mode: "strict" }).ok);
  assert.deepEqual([document.scenes[0].tracks.main.elements.length, track(document, "Voiceover")!.elements.length, document.metadata.name], [3, 3, "The Lantern Keeper"]);
  assert.ok(track(document, "Music")!.elements.length >= 1);
  const steps = Object.fromEntries(world.workflows.runs.executions(run.id).map((exec) => [exec.nodeId, exec]));
  assert.deepEqual([steps.asset_images.outputs!.costUsd, steps.panel_images.outputs!.costUsd], [0.044, 0.033], "what each stage paid, from the ledger");
  assert.ok(steps.breakdown.sessionKey, "the writing step links to its session");
  assert.equal(made.spentUsd > 0.077, true);
  // Second run on the same episode: Hand-made script and storyboard are kept, nothing is made again.
  const turns = world.counts.breakdown, requests = world.stub.calls.length;
  const second = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, second.run.id)).status, "succeeded");
  assert.deepEqual([world.counts.breakdown, world.stub.calls.length, world.films.read(film.id).project!.projectId], [turns, requests, made.project!.projectId]);
});

test("Budget reached mid-batch: a spending limit stops the run at the stage that would pass it; after the limit is raised a retry makes only what is missing", async () => {
  const world = await setup(), film = await scripted(world);
  // The four reference pictures cost $0.044; the limit lets them and one panel through (each picture is reserved by
  // its "low" estimate of $0.003, so 0.047 reserves the fourth picture's spend plus the first panel).
  await world.admin.call("jagentchill.provider.budget.set", { budget: { scope: "provider", scopeId: "openrouter", limitUsd: 0.047, period: "month", hardStop: true } });
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  // A person follows this run: the hard stop pauses it at the stage, which is held with the refusal — nothing is failed.
  const stopped = await until(() => world.workflows.runs.record(run.id), (record) => ["paused", "succeeded", "failed", "cancelled"].includes(record.status), "the run to stop");
  const held = world.workflows.runs.executions(run.id, { nodeId: "panel_images" })[0];
  assert.deepEqual([stopped.status, stopped.pauseReason, stopped.error, held.status, held.blockedBy, held.error?.code], ["paused", "budget_exceeded", undefined, "ready", "budget_exceeded", "BUDGET_EXCEEDED"]);
  const paid = images(world.stub);
  assert.ok(paid >= 4 && paid < 7, `${paid} pictures were paid for before the stop`);
  await world.admin.call("jagentchill.provider.budget.set", { budget: { scope: "provider", scopeId: "openrouter", limitUsd: 5, period: "month", hardStop: true } });
  world.workflows.runs.resume(run.id, world.admin.device.deviceId);
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  assert.equal(images(world.stub), 7, "the pictures made before the stop were not made again");
});

test("Look approval, Storyboard run during a host restart: the run waits at each checkpoint, keeps what a person changed, goes on after a restart of the host, and one stage runs again for a new panel", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, model: MODEL });
  await waiting(world, run.id, "check_breakdown");
  assert.deepEqual([world.films.read(film.id).panels.length, images(world.stub)], [3, 0], "nothing is drawn before the script is approved");
  // The person edits the cast at the checkpoint; the pictures are made from the edit.
  await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_linh", fields: { appearance: "short bob, yellow raincoat" } }] });
  world.workflows.runs.resolve(run.id, { nodeId: "check_breakdown", path: "", outcome: "approved" }, world.connection as never);
  await waiting(world, run.id, "check_assets");
  assert.ok(world.stub.calls.some((call) => call.path === "/images" && call.text.includes("yellow raincoat")));
  assert.equal(images(world.stub), 4);

  // The host stops while the run waits: only the store is left.
  world.workflows.close();
  const next = start(world.h, world.admin);
  assert.equal(next.workflows.runs.record(run.id).status, "waiting_approval");
  assert.equal(next.films.read(film.id).characters[0].picture.current!.prompt.includes("yellow raincoat"), true);
  next.workflows.runs.resolve(run.id, { nodeId: "check_assets", path: "", outcome: "approved" }, next.connection as never);
  await waiting(next, run.id, "check_storyboard");
  assert.equal(images(world.stub), 7);
  // A panel added at the checkpoint: the storyboard stage runs again and draws only that panel.
  await next.call("apply", { filmId: film.id, ops: [{ op: "panel.add", clipId: "cl_2", fields: { action: "They float the lantern on the river." } }] });
  next.workflows.runs.rerun(run.id, "panel_images", {}, world.admin.device.deviceId);
  await until(() => images(world.stub), (count) => count === 8, "the new panel's picture");
  await waiting(next, run.id, "check_storyboard");
  next.workflows.runs.resolve(run.id, { nodeId: "check_storyboard", path: "", outcome: "approved" }, next.connection as never);
  await waiting(next, run.id, "check_voice");
  next.workflows.runs.resolve(run.id, { nodeId: "check_voice", path: "", outcome: "approved" }, next.connection as never);
  const done = await runEnded(next, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const made = next.films.read(film.id);
  assert.deepEqual([made.project!.clips, made.project!.voiceElements, images(world.stub), world.counts.breakdown], [4, 3, 8, 1]);
});

test("One engine: through the channel of a running host a device creates a film, is told of its changes, and the pipeline runs on the host's workflow engine", async () => {
  const { h, admin, stub } = await host();
  const viewer = await h.pair("Tablet", "viewer");
  const { film } = await admin.call("jagentchill.film.create", { title: "The Lantern Keeper", sourceText: STORY });
  assert.equal((await viewer.call("jagentchill.film.list")).films[0].title, "The Lantern Keeper");
  assert.equal((await viewer.fail("jagentchill.film.apply", { filmId: film.id, ops: [{ op: "film.set", fields: { title: "Mine" } }] })).code, "SCOPE_DENIED");
  const { run } = await admin.yes("jagentchill.film.pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const done = await until(async () => (await admin.call("jagentchill.workflow.run.get", { runId: run.id })).run as { status: string; error?: unknown }, (found) => ["succeeded", "failed", "cancelled"].includes(found.status), "the run to end");
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const answer = await admin.call("jagentchill.film.get", { filmId: film.id });
  assert.deepEqual([answer.pipeline.status, answer.film.project.clips, images(stub)], ["succeeded", 3, 7]);
  assert.equal((await admin.call("jagentchill.film.list")).films[0].assembled, true);
  // The prompt-video template still finds its own step tools beside the film's.
  assert.equal(h.app.film!.tools.has("jc_film_assemble") && (await admin.call("jagentchill.workflow.get", { workflowId: "tpl.one-prompt-video" })).validation.errors.length === 0, true);
});

test("Fan-out skips finished items: a voice stage answered entirely by the host's cache still stops at its checkpoint and the run ends when it is approved", async () => {
  const world = await setup(), first = await scripted(world);
  await world.call("generate", { filmId: first.id, target: { kind: "lines", scope: "missing" } });
  await idle(world, first.id);
  const recorded = speech(world.stub);
  const { film } = (await world.call("create", { title: "Second", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, model: MODEL });
  for (const nodeId of ["check_breakdown", "check_assets", "check_storyboard", "check_voice"]) { await waiting(world, run.id, nodeId); world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection as never); }
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.deepEqual([speech(world.stub), world.films.read(film.id).project!.voiceElements], [recorded, 3]);
});

test("Automatic casting: the speakers of a breakdown are cast by gender and distinct where possible, without a person's pick; a character with no line is not", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => JSON.stringify({ ...PLAN, characters: [
    { name: "Linh", role: "lead", gender: "female", description: "the lantern maker's granddaughter", appearance: "black braid" },
    { name: "Minh", role: "supporting", gender: "male", description: "a visitor", appearance: "grey hoodie" },
    { name: "Bao", role: "extra", gender: "male", description: "a neighbour", appearance: "blue shirt" },
  ] }) });
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const made = ((await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL })) as Answer).film;
  const voices = (await world.call("estimate", { filmId: film.id })).voices as { voiceId: string; gender?: string }[];
  // The characters who speak are cast, each to a different voice; one with no line gets none.
  const speaking = new Set(made.lines.map((line) => line.speakerId)), speakers = made.characters.filter((entry) => speaking.has(entry.id)), cast = speakers.map((entry) => entry.voiceId);
  assert.ok(speakers.length >= 2, "the script of this test has at least two speakers");
  assert.deepEqual([made.characters.length, cast.every(Boolean), new Set(cast).size, made.characters.filter((entry) => !speaking.has(entry.id)).every((entry) => !entry.voiceId)], [3, true, speakers.length, true], JSON.stringify(made.characters.map((entry) => entry.voiceId)));
  for (const character of speakers) {
    assert.equal(voices.find((voice) => voice.voiceId === character.voiceId)?.gender, character.gender, `${character.name} is cast a voice of their gender`);
    assert.equal(character.voiceAuto, true, "the tag says the casting chose it");
  }
  // A voice a person picks afterwards is kept and clears the tag.
  const picked = voices.find((voice) => voice.voiceId !== made.characters[0].voiceId)!.voiceId;
  const changed = ((await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: made.characters[0].id, fields: { voiceId: picked } }] })) as Answer).film.characters[0];
  assert.deepEqual([changed.voiceId, changed.voiceAuto], [picked, false]);
});

test("Automatic casting prefers the voices of the film's language: a Vietnamese film on a speech model with vi-VN voices is cast from them, and its lines are spoken in them", async () => {
  const world = await setup();
  // The Voice role of ORC names a model the provider's list brought in; naming it turns it on.
  const state = await world.admin.call("jagentchill.orc.config.get", {});
  await world.admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { "voice-tts": { enabled: true, profiles: [{ id: "main", provider: "openrouter", model: "stub/locale-voice", params: {}, enabled: true }], defaultProfileId: "main", routes: {}, limits: {} } } } });
  const vietnamese = await scripted(world, { language: "vi" });
  const cast = [...vietnamese.characters.map((entry) => entry.voiceId), vietnamese.narratorVoiceId];
  assert.ok(cast.every((voiceId) => voiceId.startsWith("vi-VN-")), `cast from the Vietnamese voices: ${cast.join(", ")}`);
  assert.deepEqual((await world.call("estimate", { filmId: vietnamese.id })).voices.map((voice: any) => voice.voiceId), ["vi-VN-Grant:Stub-Voice", "vi-VN-Harper:Stub-Voice"]);
  await world.call("generate", { filmId: vietnamese.id, target: { kind: "line", id: "li_1" } });
  await idle(world, vietnamese.id);
  const spoken = world.stub.calls.filter((call) => call.path === "/audio/speech").at(-1)!;
  assert.deepEqual([spoken.model, spoken.voice], ["stub/locale-voice", vietnamese.narratorVoiceId]);
  // The same model for a German film: the German voice; for a language it has no voice for, every voice is offered.
  const german = await scripted(world, { title: "Die Laterne", language: "de" });
  assert.deepEqual([...german.characters.map((entry) => entry.voiceId), german.narratorVoiceId], Array(3).fill("de-DE-Klaus:Stub-Voice"));
  assert.equal((await world.call("estimate", { filmId: (await scripted(world, { title: "La lanterne", language: "fr" })).id })).voices.length, 5);
});

test("Automatic casting: a character with no line gets no voice — in a silent breakdown nobody is cast", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => JSON.stringify({ ...PLAN, characters: [
    { name: "Linh", role: "lead", gender: "female", description: "the lantern maker's granddaughter", appearance: "black braid" },
    { name: "Minh", role: "supporting", gender: "male", description: "a visitor", appearance: "grey hoodie" },
    { name: "Bao", role: "extra", gender: "male", description: "a neighbour", appearance: "blue shirt" },
  ], clips: [{ title: "The stall", panels: [{ action: "An empty street at dusk.", duration_s: 3 }] }] }) });
  const { film } = (await world.call("create", { title: "Silent", sourceText: "Dusk." })) as Answer;
  const made = ((await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL })) as Answer).film;
  assert.equal(made.lines.length, 0, "nobody speaks in this script");
  assert.deepEqual([made.characters.length, made.characters.every((entry) => !entry.voiceId)], [3, true], JSON.stringify(made.characters.map((entry) => entry.voiceId)));
});

test("Film pictures: the low quality tier is asked for, and the film's 16:9 becomes the nearest 3:2 the model offers", async () => {
  const world = await setup(), film = await scripted(world);
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_3" } });
  await idle(world, film.id);
  const asked = world.stub.calls.filter((call) => call.path === "/images");
  assert.ok(asked.length >= 1, "a picture was requested");
  // Film pictures are cheap: the low tier. The model has no 16:9, so the nearest offered shape, 3:2, is used.
  assert.deepEqual([asked[0].quality, asked[0].aspect], ["low", "3:2"]);
  assert.ok(world.films.read(film.id).panels[2].picture.current, "the panel still gets its picture");
});

test("Reference pictures: a panel is drawn with the current sheets of the characters, the place and the props it shows, and with the frame before it in its scene", async () => {
  const world = await setup();
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  const made = world.films.read(film.id), drawn = world.stub.calls.filter((call) => call.path === "/images" && call.status === 200);
  const sheets = drawn.filter((call) => !call.text.includes("Now draw:")), panels = drawn.filter((call) => call.text.includes("Now draw:"));
  // The four sheets are drawn from words. Panel 1 shows the street only; panel 2 Linh in the street, after panel 1 in
  // its scene; panel 3 opens a scene with Minh, Linh, the street and the lantern.
  assert.deepEqual(sheets.map((call) => call.references), [0, 0, 0, 0]);
  const by = (action: string) => panels.find((call) => call.text.includes(action))!;
  assert.deepEqual([by("Empty street at dusk.").references, by("Linh glues silk").references, by("Minh holds the lantern out.").references], [1, 3, 4]);
  assert.match(by("Linh glues silk").text, /Reference pictures are attached, in this order: 1 — the character Linh; 2 — the place Tran Phu street, shown empty; 3 — the frame just before this one\./);
  const blob = (entry: { picture: { current: fm.Version | null } }) => entry.picture.current!.media.blobId;
  assert.deepEqual(made.panels[1].picture.current!.media.provenance!.referenceAssetIds, [blob(made.characters[0]), blob(made.locations[0]), blob(made.panels[0])]);
  assert.deepEqual(fm.panelReferenceList(made, made.panels[2]).map((entry) => entry.blobId), [blob(made.characters[0]), blob(made.characters[1]), blob(made.locations[0]), blob(made.props[0])], "the lead first, though the panel names Minh first");
  // A model takes only so many (the bundled one 5: with more, the real provider drew unrelated pictures): the list is cut from its end — people and place stay.
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", metadata: { referenceImages: 2 } } });
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_3" } });
  await idle(world, film.id);
  assert.deepEqual(world.films.read(film.id).panels[2].picture.candidates.at(-1)!.media.provenance!.referenceAssetIds, [blob(made.characters[0]), blob(made.characters[1])]);
  // A model that takes no reference pictures is asked in words alone.
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", metadata: { referenceImages: 0 } } });
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } });
  await idle(world, film.id);
  const again = world.stub.calls.filter((call) => call.path === "/images").at(-1)!;
  assert.deepEqual([again.references, again.text.includes("Reference pictures")], [0, false]);
});

test("At most five reference pictures on every film path: a frame that shows six people in a place is drawn with five — the leads first — from the pipeline and from the storyboard screen, also when the model's row says it takes 16", async () => {
  const world = await setup();
  const names = ["An", "Binh", "Chi", "Dung", "Em", "Giang"];
  world.model.set({ breakdown: () => told({
    logline: "Six friends meet.", synopsis: "Six friends meet in a yard.",
    characters: names.map((name, index) => ({ name, role: index === 5 ? "lead" : "supporting", description: "a friend", appearance: `friend number ${index}` })), locations: [{ name: "The yard", description: "a yard", appearance: "a brick yard" }], props: [],
    clips: [{ title: "One", panels: [{ action: "Everyone stands in the yard.", duration_s: 2, shotSize: "wide", location: "The yard", characters: names }, { action: "Everyone waves.", duration_s: 2, shotSize: "wide", location: "The yard", characters: names }] }],
  }) });
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", metadata: { referenceImages: 16 } } });
  const { film } = (await world.call("create", { title: "Six", sourceText: "Six friends meet in a yard. Everyone waves." })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  const made = world.films.read(film.id), sent = () => world.stub.calls.filter((call) => call.path === "/images" && call.status === 200).map((call) => call.references ?? 0);
  assert.equal(Math.max(...sent()), 5, "the pipeline");
  const blob = (name: string) => made.characters.find((entry) => entry.name === name)!.picture.current!.media.blobId;
  // The lead (listed last) is first. (The double draws some sheets alike, and a picture is sent once: which ones follow is not asserted.)
  const carried = made.panels[1].picture.current!.media.provenance!.referenceAssetIds as string[];
  assert.deepEqual([carried.length, carried[0]], [5, blob("Giang")]);
  const before = sent().length;
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } });
  await idle(world, film.id);
  assert.deepEqual(sent().slice(before), [5], "one frame from the storyboard screen");
  assert.ok(world.stub.calls.filter((call) => call.path === "/images").flatMap((call) => call.referenceFiles ?? []).every((file) => file.kind === "jpeg" && !file.exif), "every reference went out as a re-encoded JPEG");
});

test("A frame the provider refuses is not dropped silently: also in mode auto the run waits at the storyboard for a person, draws the frame whose words they changed and leaves out the one they did not", async () => {
  const world = await setup();
  const panel = (action: string) => ({ action, duration_s: 2, shotSize: "wide", location: "Good street", characters: ["Linh"] });
  world.model.set({ breakdown: () => told({
    logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
    characters: [{ name: "Linh", role: "lead", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" }], locations: [{ name: "Good street", description: "a street", appearance: "lantern-lit shopfronts" }], props: [],
    clips: [{ title: "One", panels: [panel("A street at dusk."), panel("Linh falls [blocked]."), panel("Linh cries [blocked].")] }],
  }) });
  const { film } = (await world.call("create", { title: "Refused", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  // Mode "auto" approves every review by itself; this is not a review, and it waits.
  const asked = await waiting(world, run.id, "fix_storyboard");
  assert.equal(world.workflows.runs.record(run.id).status, "waiting_approval");
  assert.match(String(asked.request!.instructions), /refused to draw these frames under its content policy, also when asked in plainer words: Panel 2, Panel 3\./);
  assert.equal(asked.request!.title, "Some frames could not be had", "the request a screen shows is the resolved one: it names the frames");
  assert.ok(!/\{\{/.test(String(asked.request!.instructions) + String(asked.request!.title)));
  assert.deepEqual((asked.request!.subject as { refused: number; refusedIds: string[] }).refusedIds, ["pa_2", "pa_3"]);
  let made = world.films.read(film.id);
  assert.deepEqual(made.panels.map((entry) => [!!entry.picture.current, !!entry.refused]), [[true, false], [false, true], [false, true]]);
  assert.equal(made.project, null, "nothing was assembled without the frames");
  // Each refused frame was asked twice (its words, then plainer words) and never a third time by itself.
  assert.equal(world.stub.calls.filter((call) => call.path === "/images" && call.status === 403).length, 4);
  // The person changes the words of panel 2 and leaves panel 3 as it is.
  made = (await world.call("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_2", fields: { action: "Linh sits down on the kerb." } }] })).film;
  assert.equal(made.panels[1].refused, undefined);
  world.workflows.runs.resolve(run.id, { nodeId: "fix_storyboard", path: "", outcome: "approved" }, world.connection);
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  made = world.films.read(film.id);
  assert.deepEqual(made.panels.map((entry) => [!!entry.picture.current, !!entry.refused, entry.leftOut === true]), [[true, false, false], [true, false, false], [false, false, true]]);
  const document = project(world.h, made.project!.projectId);
  assert.equal(document.scenes[0].tracks.main.elements.length, 2, "the timeline holds the two drawn frames");
  // A frame left out is not made again by a later run, and the Timeline screen does not call it missing.
  const requests = world.stub.calls.length;
  const second = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, second.run.id)).status, "succeeded");
  assert.equal(world.stub.calls.length, requests);
  assert.equal((await world.call("assemble", { filmId: film.id })).film.project.projectId, made.project!.projectId);
  // Left out is a person's decision they can take back; and it can be made from a screen for any frame.
  made = (await world.call("apply", { filmId: film.id, ops: [{ op: "panel.leave", id: "pa_3", leftOut: false }] })).film;
  assert.equal(made.panels[2].leftOut, undefined);
  assert.equal((await world.fail("apply", { filmId: film.id, ops: [{ op: "panel.refused", id: "pa_3", message: "x" }] })).code, "INVALID_PARAMS");
});

test("A frame refused again after its words were changed comes back to a person instead of failing the run; a retry never leaves out a frame nobody was asked about", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => told({
    logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
    characters: [{ name: "Linh", role: "lead", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" }], locations: [{ name: "Good street", description: "a street", appearance: "lantern-lit shopfronts" }], props: [],
    clips: [{ title: "One", panels: [{ action: "Linh falls [blocked].", duration_s: 2, shotSize: "wide", location: "Good street", characters: ["Linh"] }] }],
  }) });
  const { film } = (await world.call("create", { title: "Refused twice", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  for (const nodeId of ["check_breakdown", "check_assets"]) { await waiting(world, run.id, nodeId); world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection); }
  const words = (action: string) => world.call("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_1", fields: { action } }] });
  const approve = (nodeId: string) => world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection);
  await waiting(world, run.id, "fix_storyboard");
  await words("Linh trips [blocked].");
  approve("fix_storyboard");
  // Refused again: the run is not failed — the next checkpoint asks a person, naming the frame.
  const second = await waiting(world, run.id, "fix_storyboard_2");
  assert.equal(world.workflows.runs.record(run.id).status, "waiting_approval");
  assert.match(String(second.request!.instructions), /Panel 1\./);
  assert.deepEqual([world.films.read(film.id).panels[0].leftOut, !!world.films.read(film.id).panels[0].refused], [undefined, true]);
  await words("Linh stumbles [blocked].");
  approve("fix_storyboard_2");
  await waiting(world, run.id, "fix_storyboard_3");
  await words("Linh slips [blocked].");
  approve("fix_storyboard_3");
  // The template's last round: there is no checkpoint left, so the step stops the run rather than go on without the frame.
  const stopped = await runEnded(world, run.id);
  assert.deepEqual([stopped.status, stopped.error!.code, stopped.failedNodeId], ["failed", "CONTENT_BLOCKED", "panel_redraw_3"]);
  assert.equal(world.films.read(film.id).project, null);
  // Retried as it is: the frame is refused again and is NOT marked "left out" — no person was asked about this refusal.
  world.workflows.runs.node(run.id, "retry", "panel_redraw_3", "", world.admin.device.deviceId);
  const again = await until(() => world.workflows.runs.record(run.id), (record) => record.status === "failed" && world.workflows.runs.executions(run.id, { nodeId: "panel_redraw_3" })[0]?.attempt === 2, "the retried step to fail");
  assert.equal(again.failedNodeId, "panel_redraw_3");
  assert.deepEqual([world.films.read(film.id).panels[0].leftOut, !!world.films.read(film.id).panels[0].refused], [undefined, true]);
  // With words the provider accepts, a retry of the step draws the frame and the run goes on to its review.
  await words("Linh walks on.");
  world.workflows.runs.node(run.id, "retry", "panel_redraw_3", "", world.admin.device.deviceId);
  await waiting(world, run.id, "check_storyboard");
  assert.ok(world.films.read(film.id).panels[0].picture.current);
});

test("A frame a person leaves as it is at the second asking is left out, and the run goes on", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => told({
    logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
    characters: [{ name: "Linh", role: "lead", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" }], locations: [{ name: "Good street", description: "a street", appearance: "lantern-lit shopfronts" }], props: [],
    clips: [{ title: "One", panels: [{ action: "A street at dusk.", duration_s: 2, shotSize: "wide", location: "Good street", characters: [] }, { action: "Linh falls [blocked].", duration_s: 2, shotSize: "wide", location: "Good street", characters: ["Linh"] }] }],
  }) });
  const { film } = (await world.call("create", { title: "Refused, then left", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  await waiting(world, run.id, "fix_storyboard");
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_2", fields: { action: "Linh trips [blocked]." } }] });
  world.workflows.runs.resolve(run.id, { nodeId: "fix_storyboard", path: "", outcome: "approved" }, world.connection);
  await waiting(world, run.id, "fix_storyboard_2");
  world.workflows.runs.resolve(run.id, { nodeId: "fix_storyboard_2", path: "", outcome: "approved" }, world.connection);
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.deepEqual(world.films.read(film.id).panels.map((entry) => [!!entry.picture.current, entry.leftOut === true]), [[true, false], [false, true]]);
});

const LOOK_NO = '{"shows": false, "text": true, "why": "A poster with the words VOTE FOR WOMEN."}', LOOK_YES = '{"shows": true, "text": false, "why": "A girl glues silk on a frame in a lantern-lit street."}';
test("A picture is looked at before it is kept: the Vision model is shown the picture with the panel's words; told 'no' the frame is drawn again, told 'yes' it is kept with that verdict", async () => {
  const world = await setup({ vision: true });
  const film = await scripted(world);
  await allowLooking(world, film.id);
  await world.call("generate", { filmId: film.id, target: { kind: "assets", scope: "missing" } });
  await idle(world, film.id);
  const before = images(world.stub), sessions = (await world.admin.call("jagentchill.session.list", {})).sessions.length;
  world.model.set({ look: (attempt) => (attempt === 1 ? LOOK_NO : LOOK_YES) });
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } });
  await idle(world, film.id);
  // The second drawing is more than the one frame that was confirmed: the action stopped and asks ("spent so far, what remains") — the person says yes, and it goes on from there.
  assert.deepEqual([images(world.stub) - before, (await world.fail("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } })).details?.gate], [1, "over_amount"]);
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } });
  await idle(world, film.id);
  const panel = world.films.read(film.id).panels[1];
  assert.equal(images(world.stub) - before, 2, "drawn twice");
  assert.deepEqual([panel.picture.current!.check, panel.picture.candidates.length, panel.refused], [{ ok: true, shows: true, text: false, why: "A girl glues silk on a frame in a lantern-lit street." }, 0, undefined]);
  // What the model was shown and asked: one small JPEG, the panel's own words, the person by age, the closed question.
  assert.equal(world.looks.length, 2);
  assert.deepEqual(world.looks[0].pictures.map((file) => [file.type, file.mime, file.jpeg]), [["image", "image/jpeg", true]]);
  assert.match(world.looks[0].message, /Linh glues silk onto a bamboo frame\./);
  assert.match(world.looks[0].message, /Linh \(about 17 years old\)/);
  assert.match(world.looks[0].message, /"shows": true\|false, "text": true\|false/);
  // Both drawings were paid for, and the question leaves no session behind.
  assert.equal(world.films.read(film.id).spentUsd, round4(world.stub.calls.filter((call) => call.path === "/images" && call.status === 200).length * 0.011));
  assert.equal((await world.admin.call("jagentchill.session.list", {})).sessions.length, sessions);
});

test("Three drawings that are not the frame: it never reaches the film — the last drawing is kept beside the frame, and the run waits for a person also in mode auto; the person's choice goes on", async () => {
  const world = await setup({ vision: true });
  // Only the second frame is "wrong": the model is told which by the words of the question.
  world.model.set({ look: (_attempt, message) => (/Linh glues silk/.test(message) ? LOOK_NO : LOOK_YES) });
  const film = await scripted(world);
  await allowLooking(world, film.id);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  // The double bills a drawing more than its estimate, and frames are drawn again here: the person names a higher amount for this run (an approval is capped at its own amount — review 12 #2).
  await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 5 });
  const asked = await waiting(world, run.id, "fix_storyboard");
  assert.equal(asked.request!.title, "A frame could not be had");
  assert.match(String(asked.request!.instructions), /drawn 3 times and the picture still is not the frame .*: Panel 2\./);
  let made = world.films.read(film.id);
  assert.deepEqual(made.panels.map((entry) => [!!entry.picture.current, entry.refused?.reason, entry.picture.candidates.map((candidate) => candidate.check?.ok)]), [[true, undefined, []], [false, "picture", [false]], [true, undefined, []]]);
  assert.match(made.panels[1].refused!.message, /^Drawn 3 times, and the picture still does not show this frame: A poster with the words VOTE FOR WOMEN\./);
  assert.equal(world.looks.filter((look) => /Linh glues silk/.test(look.message)).length, 3, "looked at three times, drawn three times");
  assert.equal(made.project, null, "nothing was assembled around the missing frame");
  assert.equal(world.films.activityOf(film.id)["panel:pa_2"]?.code, "PICTURE_REJECTED");
  // The person looks at the kept drawing and takes it: the frame has a picture, and approving goes on.
  made = (await world.call("apply", { filmId: film.id, ops: [{ op: "panel.use", id: "pa_2", versionId: made.panels[1].picture.candidates[0].id }] })).film;
  assert.deepEqual([!!made.panels[1].picture.current, made.panels[1].refused], [true, undefined]);
  world.workflows.runs.resolve(run.id, { nodeId: "fix_storyboard", path: "", outcome: "approved" }, world.connection);
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  assert.equal(world.films.read(film.id).panels.filter((entry) => entry.leftOut).length, 0);
});

test("No Vision model routed: the frames are drawn and kept WITHOUT a check, and the run says so; an answer that holds no verdict is asked once more and then also kept unchecked, said in the log", async () => {
  const world = await setup();
  const film = await scripted(world);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  assert.ok(world.films.read(film.id).panels.every((entry) => entry.picture.current && entry.picture.current.check === undefined));
  assert.match(world.workflows.runs.logs(run.id).map((entry) => entry.message).join("\n"), /No Vision model is routed .*NOT checked/);
  assert.equal(world.looks.length, 0);
  // A Vision model that does not answer the question.
  const seeing = await setup({ vision: true });
  seeing.model.set({ look: () => "What a lovely picture!" });
  const other = await scripted(seeing);
  await allowLooking(seeing, other.id);
  const second = await seeing.call("pipeline.start", { filmId: other.id, mode: "auto", model: MODEL });
  // The double bills a drawing more than its estimate, and frames are drawn again here: the person names a higher amount for this run (an approval is capped at its own amount — review 12 #2).
  await seeing.call("pipeline.confirm", { filmId: other.id, confirmedUsd: 5 });
  assert.equal((await runEnded(seeing, second.run.id)).status, "succeeded");
  assert.ok(seeing.films.read(other.id).panels.every((entry) => entry.picture.current && entry.picture.current.check === undefined));
  assert.equal(seeing.looks.length, 6, "each of the three frames was asked twice");
  assert.match(seeing.workflows.runs.logs(second.run.id).map((entry) => entry.message).join("\n"), /Panel 1 was not checked: the Vision model did not answer the question \(twice\)/);
});

test("A reference picture the provider refuses under its content policy does not fail the run; the film assembles without it", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => told({
    logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
    characters: [{ name: "Linh", role: "lead", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" }],
    locations: [{ name: "Good street", description: "a street", appearance: "lantern-lit shopfronts" }, { name: "Blocked alley", description: "an alley", appearance: "a dark alley [blocked]" }],
    props: [],
    clips: [{ title: "One", panels: [{ action: "A street at dusk.", duration_s: 3, shotSize: "wide", location: "Good street", characters: ["Linh"] }] }],
  }) });
  const { film } = (await world.call("create", { title: "Policy", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const made = world.films.read(film.id);
  // The run says what was left out; the refused reference stays missing, the panel that does not name it is drawn, and
  // the film is assembled from what exists.
  assert.match(world.workflows.runs.logs(run.id).map((entry) => entry.message).join("\n"), /content policy/);
  assert.deepEqual([fm.counts(made).assetsMissing, fm.counts(made).panelsMissing, !!made.project], [1, 0, true]);
});

test("A writing turn reads the whole answer: a 20 000-character JSON plan is accepted, and the display cut still applies without maxChars", async () => {
  const world = await setup();
  const huge = told({ ...PLAN, clips: [{ title: "Big", panels: [{ action: "A".repeat(20_000), duration_s: 3, shotSize: "wide" }] }] });
  assert.ok(huge.length > 20_000, "the answer is much longer than the 8 000 characters the transcript shows");
  world.model.set({ breakdown: () => huge });
  const { film } = (await world.call("create", { title: "Whole", sourceText: STORY })) as Answer;
  const written = (await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL })) as Answer;
  assert.equal(world.counts.breakdown, 1, "the whole answer was read on the first turn, not a truncated one");
  assert.equal(written.film.panels.length, 1);
  // The step asked for the whole text (`maxChars`); without it the transcript is cut at 8 000 for display.
  const sessionKey = (world.h.app.db.prepare("SELECT session_key FROM film_sessions WHERE film_id = ?").get(film.id) as { session_key: string }).session_key;
  const textOf = (message: { content?: Array<{ type: string; text?: string }> }) => (message.content ?? []).map((part) => part.text ?? "").join("");
  const whole = (await world.admin.call("jagentchill.chat.history", { sessionKey, limit: 20, maxChars: 500_000 })) as { messages: Array<{ content?: Array<{ type: string; text?: string }> }> };
  assert.equal(textOf(whole.messages.at(-1)!), huge, "the transcript holds the whole answer");
  const plain = (await world.admin.call("jagentchill.chat.history", { sessionKey, limit: 20 })) as { messages: Array<{ content?: Array<{ type: string; text?: string }> }> };
  assert.equal(textOf(plain.messages.at(-1)!), `${huge.slice(0, 8000)}…`, "the display cut applies without maxChars");
});

test("A take is listened to before it is kept: a recording that does not say the line is made again, and a take that does carries its passed check", async () => {
  const world = await setup(), film = await scripted(world);
  // The line is changed to one the provider double reads WRONG the first time (it is heard as other words once).
  await world.call("apply", { filmId: film.id, ops: [{ op: "line.update", id: "li_2", fields: { text: "The lantern is mended at last [misread]" } }] });
  const before = speech(world.stub);
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_2" } });
  await idle(world, film.id);
  const line = world.films.read(film.id).lines[1], take = line.takes.find((entry) => entry.id === line.activeTakeId)!;
  assert.equal(speech(world.stub) - before, 2, "the first recording was heard wrong, so the line was recorded a second time");
  assert.deepEqual([take.check?.ok, take.check?.score, take.check?.heard], [true, 1, "The lantern is mended at last [misread]"]);
  assert.equal(world.stub.calls.filter((call) => call.path === "/audio/transcriptions").length >= 2, true, "each recording was listened to");
  // A line read right the first time is recorded once.
  const again = speech(world.stub);
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_1" } });
  await idle(world, film.id);
  assert.equal(speech(world.stub) - again, 1);
  assert.equal(world.films.read(film.id).lines[0].takes[0].check?.ok, true);
});

test("One recording per speaker: all the lines of a speaker are spoken in one call and cut back into the lines, each listened to and carrying the pitch of its voice", async () => {
  const world = await setup(), film = await scripted(world);
  // Linh gets two more lines: she now speaks three times, Minh once, the narrator once.
  await world.call("apply", { filmId: film.id, ops: [
    { op: "line.add", fields: { kind: "dialogue", speakerId: "ch_linh", text: "It was my grandmother who made this one.", panelId: "pa_3" } },
    { op: "line.add", fields: { kind: "dialogue", speakerId: "ch_linh", text: "Come back tomorrow, it will be whole again.", panelId: "pa_3" } },
  ] });
  const before = speech(world.stub);
  await world.call("generate", { filmId: film.id, target: { kind: "lines", scope: "all" } });
  await idle(world, film.id);
  const made = world.films.read(film.id), linh = made.lines.filter((line) => line.speakerId === "ch_linh");
  assert.equal(linh.length, 3);
  // Three speakers, three calls — not five (one per line).
  assert.equal(speech(world.stub) - before, 3, "one speech request per speaker");
  const takes = linh.map((line) => line.takes.find((take) => take.id === line.activeTakeId)!);
  assert.deepEqual(takes.map((take) => [take.check?.ok, take.check?.score]), [[true, 1], [true, 1], [true, 1]], JSON.stringify(takes.map((take) => take.check)));
  assert.deepEqual(takes.map((take) => take.check?.heard), linh.map((line) => line.text), "each cut holds exactly its own line");
  assert.equal(new Set(takes.map((take) => take.media.blobId)).size, 3, "each line has its own file");
  assert.ok(takes.every((take) => take.duration_ticks > 0 && (take.check?.pitchHz ?? 0) > 0));
  assert.ok(made.lines.every((line) => line.takes.length === 1 && line.takes[0].check?.ok === true), "every line of the film was recorded and passed");
});

/** Linh speaks the given lines (her one line of the plan is removed first), on panel 3. */
async function linhSays(world: World, filmId: string, texts: { text: string; rate?: number }[]): Promise<string[]> {
  const film = world.films.read(filmId), old = film.lines.filter((line) => line.speakerId === "ch_linh");
  const { film: next } = (await world.call("apply", { filmId, ops: [...old.map((line) => ({ op: "line.remove", id: line.id })), ...texts.map((entry) => ({ op: "line.add", fields: { kind: "dialogue", speakerId: "ch_linh", text: entry.text, panelId: "pa_3", ...(entry.rate ? { rate: entry.rate } : {}) } }))] })) as Answer;
  return next.lines.filter((line) => line.speakerId === "ch_linh").map((line) => line.id);
}
const activeOf = (film: fm.Film, lineId: string) => fm.activeTake(film.lines.find((line) => line.id === lineId)!)!;

test("Nobody listened is not 'checked': with no transcription model on, a take has NO verdict and says why; the voice stage reports the lines as not listened to", async () => {
  const world = await setup(), film = await scripted(world);
  await world.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["qwen/qwen3-asr-1.7b"], enabled: false });
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_1" } });
  await idle(world, film.id);
  const take = activeOf(world.films.read(film.id), "li_1");
  assert.deepEqual([take.check, take.unchecked?.why, (take.unchecked?.seconds ?? 0) > 0], [undefined, "no_listener", true]);
  assert.equal(speech(world.stub), 1, "not recorded again: nobody could tell a second take from the first");
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  assert.ok(world.films.read(film.id).lines.every((line) => { const active = fm.activeTake(line)!; return active.check === undefined && active.unchecked?.why === "no_listener"; }));
  assert.match(world.workflows.runs.logs(run.id).map((entry) => entry.message).join("\n"), /3 of 3 voice lines were NOT listened to/);
});

test("A line of a speaker's recording that is not its line is recorded again before it is kept: words heard between the two thresholds (0.7 lays it over the line, 0.8 passes), and a line in another voice", async () => {
  const world = await setup(), film = await scripted(world);
  const [plain, slurred, drifting] = await linhSays(world, film.id, [{ text: "It was my grandmother who made this one." }, { text: "one two three four five six seven [slur]" }, { text: "Come back tomorrow, it will be whole again [drift]." }]);
  const before = speech(world.stub);
  await world.call("generate", { filmId: film.id, target: { kind: "speaker", speakerId: "ch_linh" } });
  await idle(world, film.id);
  const made = world.films.read(film.id);
  // One recording of the three lines, then the two that failed, each once more by itself.
  assert.equal(speech(world.stub) - before, 3);
  assert.deepEqual([plain, slurred, drifting].map((id) => [activeOf(made, id).check?.ok, activeOf(made, id).check?.score]), [[true, 1], [true, 1], [true, 1]]);
  assert.ok(made.lines.filter((line) => line.speakerId !== "ch_linh").every((line) => line.takes.length === 0), "only this speaker was recorded");
  const log = Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed");
  assert.deepEqual(log, []);
  // An unknown speaker is refused.
  assert.equal((await world.fail("generate", { filmId: film.id, target: { kind: "speaker", speakerId: "ch_nobody" } })).code, "NOT_FOUND");
});

test("A speaker's recording has one pace: lines read at another rate are a recording of their own, asked at that rate", async () => {
  const world = await setup(), film = await scripted(world);
  await linhSays(world, film.id, [{ text: "It was my grandmother who made this one." }, { text: "Come back tomorrow, it will be whole again." }, { text: "Slowly now, hold the frame still.", rate: 0.75 }, { text: "And do not let go of the silk.", rate: 0.75 }]);
  // The model that speaks takes a pace (the shipped row of the double's model says nothing about one).
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", metadata: { speed: { min: 0.5, max: 2 } } } });
  const from = world.stub.calls.length;
  await world.call("generate", { filmId: film.id, target: { kind: "speaker", speakerId: "ch_linh" } });
  await idle(world, film.id);
  const asked = world.stub.calls.slice(from).filter((call) => call.path === "/audio/speech");
  assert.deepEqual(asked.map((call) => [call.speed, call.text.split("\n\n").length]).sort(), [[0.75, 2], [undefined, 2]].sort());
  assert.ok(world.films.read(film.id).lines.filter((line) => line.speakerId === "ch_linh").every((line) => fm.activeTake(line)?.check?.ok === true));
});

test("Casting follows the model that will speak: when the Voice role is moved to a model with other voices, automatic voices are cast again from it and a person's own pick is left alone", async () => {
  const world = await setup(), film = await scripted(world);
  const first = world.films.read(film.id), voicesOf = (made: fm.Film) => [made.characters[0].voiceId, made.characters[1].voiceId, made.narratorVoiceId];
  const gemini = new Set((await world.admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "tts" })).models.find((model: any) => model.id === "google/gemini-3.8-flash-lite-tts").metadata.voices.map((voice: any) => voice.voiceId));
  assert.ok(voicesOf(first).every((voiceId) => gemini.has(voiceId)), JSON.stringify(voicesOf(first)));
  // Minh's voice is a person's pick; then the Voice role goes to the other bundled speech model.
  await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_minh", fields: { voiceId: voicesOf(first)[1], voiceAuto: false } }] });
  const other = (await world.admin.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "tts" })).models.find((model: any) => model.id !== "google/gemini-3.8-flash-lite-tts" && model.source === "bundled");
  const revision = (await world.admin.call("jagentchill.orc.config.get", {})).revision;
  await world.admin.call("jagentchill.orc.config.update", { expectedRevision: revision, patch: { roles: { "voice-tts": { enabled: true, profiles: [{ id: "main", provider: "openrouter", model: other.id, params: {}, enabled: true }], defaultProfileId: "main", routes: {}, limits: {} } } } });
  // (The double's list prices this model per token, sound included — "price not known" under ruling R4: this host's person gave it a price per character.)
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: other.id, capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
  const offered = new Set(other.metadata.voices.map((voice: any) => voice.voiceId));
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_3" } });
  await idle(world, film.id);
  const recast = world.films.read(film.id);
  assert.deepEqual([offered.has(recast.characters[0].voiceId), recast.characters[0].voiceAuto, offered.has(recast.narratorVoiceId), recast.characters[1].voiceId, recast.characters[1].voiceAuto], [true, true, true, voicesOf(first)[1], false]);
  // Linh's line was spoken by the new model, in the voice she was cast again.
  const take = activeOf(recast, "li_3");
  assert.deepEqual([world.stub.calls.some((call) => call.model === other.id && call.status === 200), take.voiceId], [true, recast.characters[0].voiceId]);
});

test("A script that rewords a line the story quotes, or gives it to someone else, goes back to the model with the reason; the plan that speaks it word for word by its speaker is stored", async () => {
  const world = await setup();
  const story = 'On the night of the full moon the town turns off its lights. Minh held out the lantern. "Can you fix it for me?" Minh asked.';
  const plan = (speaker: string, text: string) => JSON.stringify({ ...PLAN, clips: [{ title: "The stall", panels: [{ action: "Minh holds the lantern out.", duration_s: 3, characters: ["Minh", "Linh"], location: "Tran Phu street", lines: [{ kind: "narration", speaker: "Narrator", text: "On the night of the full moon the town turns off its lights." }, { kind: "dialogue", speaker, text }] }] }] });
  world.model.set({ breakdown: (attempt) => (attempt === 1 ? plan("Minh", "Could you fix this lantern for me?") : attempt === 2 ? plan("Linh", "Can you fix it for me?") : plan("Minh", "Can you fix it for me?")) });
  const { film } = (await world.call("create", { title: "Quoted", sourceText: story })) as Answer;
  const made = ((await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL })) as Answer).film;
  assert.equal(world.counts.breakdown, 3);
  assert.match(world.messages[1], /the story's line "Can you fix it for me\?" is not spoken word for word in the plan/);
  assert.match(world.messages[2], /the story's line "Can you fix it for me\?" is said by Minh in the story, not by Linh/);
  assert.deepEqual(made.lines.map((line) => [line.speakerId, line.text]), [["narrator", "On the night of the full moon the town turns off its lights."], ["ch_minh", "Can you fix it for me?"]]);
});

test("What the film screens asked of the engine: the estimate names the model of each writing role (or none), a refused sheet is still marked after a restart of the service, and starting a film that is already being made says so in plain words", async () => {
  const world = await setup({ roles: { screenwriter: { ...MODEL, thinking: "high" } } });
  world.model.set({ breakdown: () => JSON.stringify({ ...PLAN, characters: [PLAN.characters[0], { ...PLAN.characters[1], appearance: "short hair [blocked]" }] }) });
  const { film } = (await world.call("create", { title: "Marked", sourceText: STORY })) as Answer;
  const estimate = await world.call("estimate", { filmId: film.id });
  assert.deepEqual(estimate.writing, [{ role: "screenwriter", model: { ...MODEL, label: "opus" } }, { role: "storyboard", model: null }, { role: "vision", model: null }]);
  // A sheet the provider refuses: the mark is in the film document, not only in the running service's memory.
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  await world.call("generate", { filmId: film.id, target: { kind: "asset", assetKind: "character", id: "ch_minh" } });
  await idle(world, film.id);
  assert.equal(world.films.activityOf(film.id)["character:ch_minh"]?.code, "CONTENT_BLOCKED");
  const restarted = start(world.h, world.admin);
  assert.deepEqual(restarted.films.activityOf(film.id), {}, "a new service remembers no job");
  const kept = restarted.films.read(film.id).characters[1];
  assert.deepEqual([kept.picture.current, typeof kept.refused?.message, kept.refused!.at_ms > 0], [null, "string", true]);
  // Changing the words clears the mark.
  assert.equal((await restarted.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_minh", fields: { appearance: "short hair, grey hoodie" } }] })).film.characters[1].refused, undefined);
  // A second start while the first run waits at its checkpoint.
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  const again = await world.fail("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  // The run is left waiting at its first checkpoint, so nothing of it is still working when the host of this test closes.
  await waiting(world, run.id, "check_breakdown");
  assert.deepEqual([again.code, again.message], ["CONFLICT", "This film is already being made: wait for it to finish or stop it, then start again."]);
  assert.ok(!/pipeline/i.test(again.message));
});

test("A frame whose words changed and whose three new drawings all fail keeps no place for its outdated picture: it is marked, the run waits for a person, and left as it is it is out of the film", async () => {
  const world = await setup({ vision: true });
  const film = await scripted(world);
  await allowLooking(world, film.id);
  const first = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 5 });
  assert.equal((await runEnded(world, first.run.id)).status, "succeeded");
  const old = world.films.read(film.id).panels[1].picture.current!.id;
  // The person changes the frame; from now on the Vision model says the drawings are not it.
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_2", fields: { action: "Linh hangs the lantern above the door." } }] });
  world.model.set({ look: (_attempt, message) => (/hangs the lantern/.test(message) ? LOOK_NO : LOOK_YES) });
  const before = images(world.stub);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  // The double bills a drawing more than its estimate, and frames are drawn again here: the person names a higher amount for this run (an approval is capped at its own amount — review 12 #2).
  await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 5 });
  const asked = await waiting(world, run.id, "fix_storyboard");
  assert.match(String(asked.request!.instructions), /Panel 2\./);
  assert.equal(images(world.stub) - before, 3, "the outdated frame was drawn again, three times");
  let panel = world.films.read(film.id).panels[1];
  assert.deepEqual([panel.picture.current!.id, panel.picture.stale, panel.refused?.reason, panel.picture.candidates.at(-1)!.check?.ok], [old, true, "picture", false]);
  // Approved as it is: the frame is left out — its outdated picture is not in the film.
  world.workflows.runs.resolve(run.id, { nodeId: "fix_storyboard", path: "", outcome: "approved" }, world.connection);
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
  panel = world.films.read(film.id).panels[1];
  assert.equal(panel.leftOut, true);
  const document = project(world.h, world.films.read(film.id).project!.projectId);
  assert.equal(document.scenes[0].tracks.main.elements.length, 2, "two of the three frames are on the timeline");
});

test("The storyboard checkpoint's request is the RESOLVED text a screen shows in its banner: the title and the instructions name the frames (or the provider), carry no template marks, and differ from the static words of the checkpoint", async () => {
  const world = await setup();
  const panel = (action: string) => ({ action, duration_s: 2, shotSize: "wide", location: "Good street", characters: ["Linh"] });
  world.model.set({ breakdown: () => told({
    logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
    characters: [{ name: "Linh", role: "lead", description: "the lantern maker's granddaughter", appearance: "black braid, indigo ao dai" }], locations: [{ name: "Good street", description: "a street", appearance: "lantern-lit shopfronts" }], props: [],
    clips: [{ title: "One", panels: [panel("A street at dusk."), panel("Linh falls [blocked].")] }],
  }) });
  const { film } = (await world.call("create", { title: "Banner", sourceText: STORY })) as Answer;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const waitingAt = await waiting(world, run.id, "fix_storyboard"), fixed = fm.CHECKPOINTS.find((entry) => entry.id === "fix_storyboard")!;
  // This is the record `jagentchill.workflow.run.executions` gives a screen: `request.title` / `request.instructions`.
  const request = waitingAt.request as { title: string; instructions: string };
  assert.equal(request.title, "A frame could not be had");
  assert.match(request.instructions, /^The image provider refused to draw this frame under its content policy, also when asked in plainer words: Panel 2\. Change the words/);
  assert.ok(!/\{\{|\}\}|undefined/.test(request.title + request.instructions));
  assert.ok(request.title !== fixed.title && request.instructions !== fixed.instructions, "the static words are only the fallback");
  // The template itself asks the stage for the text.
  const node = fm.buildFilmTemplate(0).nodes.find((entry) => entry.id === "fix_storyboard")!;
  assert.deepEqual([node.config.title, node.config.instructions], ["{{inputs.subject.askTitle}}", "{{inputs.subject.ask}}"]);
});

test("Make the film asks nothing on the way: on a host with no stored consent at all, with the Vision model on another provider and one of the film's sheets the person's OWN photo, one press runs to the assembled film — no stop, no question — with the frames drawn with their references and checked and the takes listened to", async () => {
  const world = await setup({ consent: false, vision: true });
  assert.deepEqual((await world.admin.call("jagentchill.provider.consent.list", {})).consents, []);
  const film = await scripted(world);
  await world.call("generate", { filmId: film.id, target: { kind: "assets", scope: "missing" } });
  await idle(world, film.id);
  // The person's own photo is Linh's sheet (a file generation did not make).
  const photo = world.h.app.sync.blobs.put(await ownPng(), { mime: "image/png", name: "linh.png", purpose: "media" });
  world.films.mutate(film.id, [{ op: "asset.picture", kind: "character", id: "ch_linh", version: { id: "own", media: { blobId: photo.sha256, name: "linh.png", kind: "image", bytes: photo.size } as never, costUsd: 0, prompt: "", created_ms: 1 } }, { op: "asset.use", kind: "character", id: "ch_linh", versionId: "own" }]);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  // No checkpoint asked a person anything: every storyboard gate went straight on.
  const stops = world.workflows.runs.executions(run.id, {}).filter((exec) => exec.nodeId.startsWith("fix_storyboard"));
  assert.ok(stops.length > 0 && stops.every((exec) => exec.status === "skipped"), JSON.stringify(stops.map((exec) => [exec.nodeId, exec.status])));
  const made = world.films.read(film.id);
  assert.deepEqual([made.sendAllowed, made.panels.every((entry) => entry.picture.current?.check?.ok === true), made.lines.every((line) => fm.activeTake(line)?.check?.ok === true), world.looks.length, !!made.project], [undefined, true, true, 3, true]);
  assert.ok((made.panels[1].picture.current!.media.provenance as { referenceAssetIds: string[] }).referenceAssetIds.includes(photo.sha256), "the person's own sheet was sent as a reference");
  assert.ok(world.stub.calls.filter((call) => call.path === "/images").flatMap((call) => call.referenceFiles ?? []).every((file) => file.kind === "jpeg" && !file.exif), "still small and bare");
  // The screens are not asked either, and nothing was recorded as consent.
  await world.call("generate", { filmId: film.id, target: { kind: "panel", id: "pa_2" } });
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: "li_1" } });
  await idle(world, film.id);
  assert.deepEqual(Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed"), []);
  assert.deepEqual((await world.admin.call("jagentchill.provider.consent.list", {})).consents, []);
});

const made = (world: World, filmId: string): boolean => { const film = world.films.read(filmId); return film.panels.every((panel) => !!panel.picture.current) && film.lines.every((line) => !!fm.activeTake(line)) && !!film.project; };
/** The picture model priced as the provider double bills it, so that an estimate is what the run then costs. */
const priceAsBilled = (world: World) => world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.011 } } });
const paidCalls = (stub: StubGeneration) => stub.calls.filter((call) => ["/images", "/audio/speech", "/chat/completions", "/audio/transcriptions"].includes(call.path)).length;

test("One confirmation for a whole film: with the product's default (always ask) 'Make the film' is refused with the estimate — pictures, voice, music, their models, what the budgets leave — and nothing is generated before the confirmation; confirmed once, the run goes to the end with no other money question", async () => {
  const world = await setup({ ask: 0 });
  assert.equal((await world.admin.call("jagentchill.provider.threshold.get", {})).thresholds.confirmAboveUsd, 0);
  await priceAsBilled(world);
  const film = await scripted(world), before = paidCalls(world.stub);
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  assert.deepEqual([asked.code, asked.details!.reason, asked.details!.confirmAboveUsd, asked.details!.remainingUsd, asked.details!.filmId], ["PERMISSION_DENIED", "confirmation_required", 0, null, film.id]);
  const estimate = asked.details!.estimate as { amountUsd: number; breakdown: { id: string; label: string; count: number; usd: number; model: string }[]; models: string[] };
  assert.deepEqual(estimate.breakdown.map((part) => [part.id, part.label, part.count]), [["pictures", "Pictures", 7], ["voice", "Voice", 3], ["listening", "Listening", 3], ["music", "Music", 1]]);
  assert.ok(estimate.amountUsd > 0 && Math.abs(estimate.amountUsd - estimate.breakdown.reduce((sum, part) => sum + part.usd, 0)) < 1e-6, JSON.stringify(estimate));
  assert.ok(estimate.models.length >= 2 && estimate.breakdown.every((part) => estimate.models.includes(part.model) && part.model.length > 0), JSON.stringify(estimate.models));
  assert.equal(asked.details!.stopsAtUsd, round4(estimate.amountUsd * 1.2));
  // Nothing was made, and no run exists.
  assert.deepEqual([paidCalls(world.stub) - before, world.films.read(film.id).pipelineRunId ?? null, world.workflows.runs.list({}).length], [0, null, 0]);
  // An amount under the estimate is not a confirmation of it.
  assert.equal((await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, confirmedUsd: round4(estimate.amountUsd / 2) })).details!.reason, "confirmation_required");
  // A spending limit in scope is what the confirmation shows as left.
  await world.admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 3, period: "month", hardStop: true, allowUnknownCost: false } });
  const left = (await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL })).details!.remainingUsd as number;
  assert.ok(left > 2.5 && left <= 3, String(left));
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, confirmed: true });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const steps = world.workflows.runs.executions(run.id, {});
  assert.deepEqual(steps.filter((exec) => exec.nodeId === "confirm_cost" || exec.nodeId === "cost").map((exec) => [exec.nodeId, exec.status]).sort(), [["confirm_cost", "skipped"], ["cost", "succeeded"]]);
  assert.equal((steps.find((exec) => exec.nodeId === "cost")!.outputs!.summary as { needs: number }).needs, 0, "what was confirmed at the start covers the run");
  assert.ok(made(world, film.id));
});

/** A script that asks for far more than the story's upper plan foresees: fourteen frames, each with a line, from a story of one sentence. */
const BIG = { ...PLAN, clips: [{ title: "The long walk", panels: Array.from({ length: 14 }, (_value, index) => ({ action: `Linh walks on past stall ${index + 1}.`, duration_s: 2, shotSize: "wide", cameraMotion: "static", characters: ["Linh"], location: "Tran Phu street", props: [], lines: [{ kind: "narration", speaker: "Narrator", text: `She keeps walking under the lanterns of the old town, past stall number ${index + 1}.`, emotion: "Calm" }] })) }] };

/** A story of exactly `count` words: plain sentences, with two quoted lines in its first paragraph. */
function storyOf(count: number): string {
  const opening = `Linh lived above her grandmother's lantern shop on the oldest street of Hoi An. Every evening she glued silk onto bamboo frames while the river turned gold. One night the power failed across the whole town, and the festival was about to begin. "We have no light," the mayor said. "Then we use ours," Linh answered.`;
  const more = ["She carried the lanterns out, one by one, and the neighbours lit candles inside.", "Soon the street glowed red and yellow, brighter than any lamp.", "The visitors stayed until morning, and nobody asked for the power again.", "Her grandmother smiled and hung the last lantern above the door.", "The harbour was quiet before the boats returned that evening.", "Minh counted the crates twice and wrote the number in his book."];
  const words = opening.split(" ");
  for (let at = 0; words.length < count; at++) words.push(...more[at % more.length].split(" "));
  const cut = words.slice(0, count).join(" ");
  return /[.!?"]$/.test(cut) ? cut : `${cut.replace(/[,;:]$/, "")}.`;
}
test("Review 12 #9 — the film's ONE quote: the plan comes from the story's own sentences (lines ≤ sentences, frames ≤ lines, sheets ≤ what the frames can show), it is what the whole run is quoted by up front, and it BINDS the writer — the limits are in the script prompt, a script over them gets one correction that names the limit, and a script still over them fails clearly with nothing kept and nothing paid; a story-only 'Make the film' asks ONE question in all", async (t) => {
  // (The provider's list names no listener here, so the shipped listener keeps its shipped price: every price of this quote is the product's own.)
  const world = await setup({ ask: 0, listeners: false });
  // (a) The plan of a story, and its quote at the prices of the rows the product SHIPS (the reader at $0.01 a thousand characters, the listener at $0.00002 a call; the picture and music rows as bundled).
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.01 } } });
  const shown: Record<string, unknown>[] = [];
  for (const count of [120, 2000]) {
    const story = storyOf(count), plan = fm.upperPlan(story, "en");
    assert.equal(story.split(/\s+/).length, count);
    assert.ok(plan.lines <= Math.max(plan.sentences, Math.ceil(story.length / fm.LIMITS.lineText), Math.ceil(plan.seconds / 15)) && plan.panels <= plan.lines && plan.assets === Math.min(fm.LIMITS.assets, fm.sheetsShown(plan.panels)), JSON.stringify(plan));
    const { film } = (await world.call("create", { title: `A story of ${count} words`, sourceText: story })) as Answer;
    const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL }), estimate = asked.details!.estimate as { amountUsd: number | null; breakdown: { id: string; count: number; usd: number }[]; unpricedParts?: { id: string; model: string }[] };
    assert.deepEqual([asked.details!.reason, asked.details!.scripted, asked.details!.upperPlan, estimate.breakdown.map((part) => [part.id, part.count])], ["confirmation_required", false, plan, [["pictures", plan.assets + plan.panels], ["voice", plan.lines], ["listening", plan.lines], ["music", 1]]]);
    const priced = Math.round(estimate.breakdown.reduce((sum, part) => sum + part.usd, 0) * 1e6) / 1e6;
    shown.push({ amountKind: (estimate as { amountKind?: string }).amountKind, words: count, sentences: plan.sentences, sheets: plan.assets, frames: plan.panels, lines: plan.lines, quoteUsd: priced, parts: Object.fromEntries(estimate.breakdown.map((part) => [part.id, part.usd])), priceNotKnown: (estimate.unpricedParts ?? []).map((part) => `${part.id}: ${part.model}`), stopsAtUsd: asked.details!.stopsAtUsd });
  }
  t.diagnostic(`FILM QUOTES AT THE SHIPPED ROWS' PRICES: ${JSON.stringify(shown)}`);
  assert.deepEqual(shown.map((entry) => [entry.words, entry.sentences, entry.sheets, entry.frames, entry.lines, entry.quoteUsd]), QUOTES);

  // (b) A story-only "Make the film": ONE question, before anything is written or made; then the run goes to its end.
  await priceAsBilled(world);
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer, plan = fm.upperPlan(STORY, "en"), before = paidCalls(world.stub);
  assert.deepEqual([plan.sentences, plan.lines, plan.panels, plan.assets], [3, 3, 3, 27]);
  let questions = 0;
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  questions++;
  assert.deepEqual([asked.details!.reason, asked.details!.upperPlan, world.counts.breakdown, paidCalls(world.stub) - before], ["confirmation_required", plan, undefined, 0], "one question, for everything, before anything");
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, ...asked.details!.confirmWith, confirmed: true });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const step = (runId: string, nodeId: string) => world.workflows.runs.executions(runId, { nodeId })[0];
  if (step(run.id, "confirm_cost").status !== "skipped") questions++;
  assert.deepEqual([questions, made(world, film.id), step(run.id, "confirm_cost").status, (step(run.id, "cost").outputs!.summary as { needs: number }).needs, world.h.app.generation.gate.action(`film.run:${run.id}`)!.approved!.amountUsd], [1, true, "skipped", 0, (asked.details!.estimate as { amountUsd: number }).amountUsd], "ONE question in all");
  assert.ok(world.h.app.generation.gate.spentOf(`film.run:${run.id}`) <= (asked.details!.estimate as { amountUsd: number }).amountUsd + 1e-9, "the run cost no more than the quote");
  // The writer was told the limits.
  assert.match(world.messages.find((message) => /\[\[jc-film:breakdown\]\]/.test(message))!, /at most 3 panels in all, at most 3 lines in all, and at most 27 characters, locations and props together/);

  // (c) A script of fourteen frames for the three-sentence story: ONE correction that names the limit; the corrected script is kept.
  const turns = () => world.counts.breakdown ?? 0;
  let writing = turns();
  world.model.set({ breakdown: (_attempt, message) => (/was not accepted/.test(message) ? JSON.stringify(PLAN) : told(BIG)) });
  const corrected = ((await world.call("create", { title: "The Long Walk", sourceText: STORY })) as Answer).film;
  const second = (await world.call("pipeline.start", { filmId: corrected.id, mode: "auto", model: MODEL })).run;
  assert.equal((await runEnded(world, second.id)).status, "succeeded");
  assert.deepEqual([turns() - writing, world.films.read(corrected.id).panels.length, step(second.id, "confirm_cost").status], [2, 3, "skipped"]);
  assert.match(world.messages.filter((message) => /was not accepted/.test(message)).at(-1)!, /the plan has 14 panels; this film takes at most 3/);
  // A writer that stays over the plan: after that one correction the writing FAILS — nothing is kept, nothing is drawn or spoken.
  // What WAS paid for is the writing itself: its two turns are requests of the run's action, each with its charge row (on this host the writing model's price is not known: "not known", never nothing).
  writing = turns();
  world.model.set({ breakdown: () => told(BIG) });
  const stubborn = ((await world.call("create", { title: "The Longest Walk", sourceText: STORY })) as Answer).film, paid = paidCalls(world.stub);
  const third = (await world.call("pipeline.start", { filmId: stubborn.id, mode: "auto", model: MODEL })).run, failed = await runEnded(world, third.id);
  const billable = world.h.app.db.prepare("SELECT kind, model FROM gen_charges WHERE action_id LIKE ? ORDER BY id").all(`film.run:${third.id}%`).map((row) => ({ ...row }));
  assert.deepEqual([failed.status, turns() - writing, world.films.read(stubborn.id).panels.length, paidCalls(world.stub) - paid, billable], ["failed", 2, 0, 0, [{ kind: "turn", model: MODEL.modelId }, { kind: "turn", model: MODEL.modelId }]], "no picture, no recording — and the two writing turns are on the run's account");
  assert.match(JSON.stringify(failed.error ?? world.workflows.runs.executions(third.id, {}).map((entry) => entry.error)), /larger than this film's plan \(at most 3 panels, 3 lines, 27 characters, locations and props\)/);
});
/** [words, sentences, sheets, frames, lines, quote in USD] of the two stories of the test above, at the prices the product ships with. */
// (At the shipped rows: 36 sheets + 13 frames with 5 references each $0.407, 13 lines of at most 600 characters at $0.01 a thousand $0.078, 13 read-backs at $0.00002, one music clip $0.04.)
const QUOTES: unknown[] = [[120, 13, 36, 13, 13, 0.52526], [2000, 174, 36, 174, 174, 5.19748]];

test("Review 14 #5 / #11 (R3, R5) — a turn of a runtime's model has no price the host can state before it is sent: the runtime adds its own system prompt, tools and history to the film's message and the host never sees that request — so even on a host that knows the model's price, its longest answer, a figure per picture and what earlier turns measured, the writing and the looking are 'price not known — <model>', named and approved by name, in NO amount; the figure shown is then called what it is (amountKind 'subtotal_of_priced'); nothing that reaches the runtime carries a limit on the answer; and every turn's real cost is a charge of the run", async () => {
  const full = { billedByCall: true, price: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, maxOutputTokens: 4000, contextWindow: 100_000, overheadTokens: 5000, imageTokens: 800 };
  const facts: TurnFacts = (ref) => (ref.modelId === "opus" || ref.modelId === VISION.modelId ? full : ref.modelId === "sonnet" ? { billedByCall: false } : undefined);
  const world = await setup({ ask: 0, vision: true, turnModel: facts });
  await priceAsBilled(world);
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer, plan = fm.upperPlan(STORY, "en");
  type Row = { id: string; count: number; usd: number | null; model: string };
  type Estimate = { amountUsd: number | null; amountKind: string; breakdown: Row[]; unpricedParts?: { id: string; label: string; model: string }[]; unpricedModels?: string[] };
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL }), estimate = asked.details!.estimate as Estimate;
  // The turns are named — not priced by a measurement of some earlier request, a model's limit or its window.
  assert.deepEqual(estimate.unpricedParts, [{ id: "writing", label: "Writing the script", model: "opus" }, { id: "vision", label: "Checking the pictures", model: VISION.modelId }]);
  assert.deepEqual([estimate.breakdown.filter((part) => part.id === "writing" || part.id === "vision"), estimate.unpricedModels, asked.details!.unpriced], [[], ["runtime:anthropic/opus"], true]);
  // The figure is the sum of the parts that HAVE a price, and says so: it is not the bound of the whole film.
  assert.deepEqual([estimate.amountKind, estimate.amountUsd], ["subtotal_of_priced", Math.round(estimate.breakdown.reduce((sum, part) => sum + (part.usd ?? 0), 0) * 1e6) / 1e6]);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, ...asked.details!.confirmWith, confirmed: true });
  const ended = await runEnded(world, run.id);
  assert.equal(ended.status, "succeeded", JSON.stringify([ended.error, world.workflows.runs.executions(run.id, {}).filter((entry) => entry.error).map((entry) => [entry.nodeId, entry.error])]).slice(0, 1500));
  // WHAT WAS REALLY SENT: every turn went to the runtime as a message — none with a limit on its answer (an agent CLI takes none), so no limit was "enforced" that a price could count.
  const sends = world.h.fake.callsOf("startTurn") as Record<string, unknown>[];
  const keysOf = (sent: Record<string, unknown>) => [...Object.keys(sent), ...Object.keys((sent.options ?? {}) as object)];
  assert.ok(sends.length >= 1 + plan.panels && sends.every((sent) => !keysOf(sent).some((key) => /max|limit|tokens/i.test(key))), JSON.stringify(sends.map(keysOf)[0]));
  // WHAT WAS CHARGED: each of those turns is a charge row of the run's action (never nothing).
  const charged = world.h.app.db.prepare("SELECT kind FROM gen_charges WHERE action_id = ? AND kind = 'turn'").all(`film.run:${run.id}`);
  assert.equal(charged.length, sends.length);
  // A film whose every part has a price says "total": a model not billed by the call (a sign-in) costs nothing and is not asked about.
  const plain = await setup({ ask: 0, turnModel: facts });
  await priceAsBilled(plain);
  const other = ((await plain.call("create", { title: "Another", sourceText: STORY })) as Answer).film;
  const included = (await plain.fail("pipeline.start", { filmId: other.id, mode: "auto", model: { ...MODEL, modelId: "sonnet" } })).details!.estimate as Estimate;
  // (Ruling R9: such a model is no row of the quote at all — it is told beside it, as running on the person's own account.)
  assert.deepEqual([included.amountKind, included.unpricedParts, included.breakdown.find((part) => part.id === "writing"), (included as { ownAccount?: unknown }).ownAccount, included.amountUsd === Math.round(included.breakdown.reduce((sum, part) => sum + (part.usd ?? 0), 0) * 1e6) / 1e6], ["total", undefined, undefined, [{ label: "Writing the script", model: "sonnet" }], true]);
  // A model the host knows nothing of is named the same way.
  const named = (await plain.fail("pipeline.start", { filmId: other.id, mode: "auto", model: { ...MODEL, modelId: "haiku" } })).details!.estimate as Estimate;
  assert.deepEqual([named.unpricedParts, named.amountKind], [[{ id: "writing", label: "Writing the script", model: "haiku" }], "subtotal_of_priced"]);
});

test("Review 13 #9 (R2) — an approval is an amount for the whole action, not a count of requests: a story-only 'Make the film' in which two frames are drawn again after the picture check and one line is recorded again after its read-back asks ONE question in all — the repairs spend from what was confirmed", async (t) => {
  const world = await setup({ ask: 0, vision: true });
  await priceAsBilled(world);
  const script = JSON.parse(JSON.stringify(PLAN)) as typeof PLAN;
  script.clips[0].panels[0].lines[0].text = "On the night of the full moon the town turns off its lights [misread]";
  let looked = 0;
  world.model.set({ breakdown: () => JSON.stringify(script), look: () => (++looked === 1 || looked === 3 ? LOOK_NO : LOOK_YES) });
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const drawn = images(world.stub), said = speech(world.stub);
  let questions = 0;
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  questions++;
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, ...asked.details!.confirmWith, confirmed: true });
  const done = await runEnded(world, run.id), steps = world.workflows.runs.executions(run.id, {});
  assert.equal(done.status, "succeeded", JSON.stringify([done.error, steps.filter((entry) => entry.error || entry.status === "waiting_approval").map((entry) => [entry.nodeId, entry.status, entry.error])]).slice(0, 1500));
  questions += steps.filter((entry) => entry.nodeId === "confirm_cost" && entry.status !== "skipped").length;
  const after = world.films.read(film.id), sheets = after.characters.length + after.locations.length + after.props.length, line = after.lines.find((entry) => /\[misread\]/.test(entry.text))!, gate = world.h.app.generation.gate, action = gate.action(`film.run:${run.id}`)!;
  t.diagnostic(`STORY-ONLY RUN WITH REPAIRS: questions ${questions}; pictures ${images(world.stub) - drawn} (= ${sheets} sheets + ${after.panels.length} frames + 2 redraws); recordings ${speech(world.stub) - said}; confirmed $${action.approved!.amountUsd}, spent $${action.spentUsd}`);
  assert.deepEqual([questions, images(world.stub) - drawn, looked, line.takes.find((entry) => entry.id === line.activeTakeId)?.check?.ok, gate.pending(`film.run:${run.id}`), action.spentUsd <= action.approved!.amountUsd], [1, sheets + after.panels.length + 2, after.panels.length + 2, true, undefined, true]);
  assert.ok(world.stub.calls.filter((call) => call.path === "/audio/transcriptions").length > after.lines.length, "the line that was heard wrong was recorded and listened to again");
});

test("The cost step run again without an answer still asks: while 'confirm_cost' waits, running the step again does not count as the person's yes — the run waits there again, nothing is generated, and only the approval lets the paid work start", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  // The picture model's price rises tenfold while the script is being written: the film now needs far more than what was approved at the start — the run's one further question, at 'confirm_cost'. (A larger script cannot be the cause: the writer is held to the plan.)
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const before = paidCalls(world.stub);
  world.model.pause(true);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.11 } } });
  world.model.pause(false);
  await waiting(world, run.id, "confirm_cost");
  const step = (nodeId: string) => world.workflows.runs.executions(run.id, { nodeId })[0];
  for (let again = 2; again <= 3; again++) {
    world.workflows.runs.rerun(run.id, "cost", {}, world.admin.device.deviceId);
    // The step has run again and the run has settled on what follows it: the question, or (the defect) the pictures.
    await until(() => [step("cost"), step("confirm_cost"), step("asset_images")], ([cost, confirm, assets]) => cost.attempt === again && cost.status === "succeeded" && (confirm.status === "waiting_approval" || assets.status !== "pending"), "the cost step to run again");
    assert.deepEqual([(step("cost").outputs!.summary as { needs: number }).needs, step("confirm_cost").status, step("asset_images").status, paidCalls(world.stub) - before], [1, "waiting_approval", "pending", 0], `run ${again} of the cost step`);
  }
  world.workflows.runs.resolve(run.id, { nodeId: "confirm_cost", path: "", outcome: "approved" }, world.connection as never);
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.ok(made(world, film.id));
  // What the person approved is what the run was held to: the amount they were shown.
  const shown = (step("cost").outputs!.summary as { estimate: { amountUsd: number } }).estimate.amountUsd;
  const held = world.h.app.generation.gate.action(`film.run:${run.id}`)!;
  assert.deepEqual([held.approved?.amountUsd, held.approved?.by, held.question], [shown, "person", undefined]);
});

test("A host amount above the estimate means no confirmation: the run starts at once and its cost step lets it through, and a single picture or a batch is made without a question", async () => {
  const world = await setup({ ask: 5 });
  const film = await scripted(world);
  await world.call("generate", { filmId: film.id, target: { kind: "asset", assetKind: "character", id: "ch_linh" } });
  await idle(world, film.id);
  assert.equal(images(world.stub), 1);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  const steps = world.workflows.runs.executions(run.id, {});
  assert.deepEqual([steps.find((exec) => exec.nodeId === "confirm_cost")!.status, (steps.find((exec) => exec.nodeId === "cost")!.outputs!.summary as { needs: number }).needs], ["skipped", 0]);
  assert.equal((await world.call("estimate", { filmId: film.id })).confirmAboveUsd, 5);
});

test("Confirmed-estimate guard, film: a run that is about to cost more than was confirmed is PAUSED with pauseReason budget_exceeded and says the new figure — past 120 % of the confirmed amount the next job is not started, the stage stays ready with blockedBy budget_exceeded and reason confirmation_required; a person confirms a new amount and the run goes on by itself to the finished film", async () => {
  // The double bills $0.011 a picture; the catalogue's low tier says less — so the estimate is too low, as a real price change would make it.
  const world = await setup({ ask: 0 });
  const film = await scripted(world);
  await world.call("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { musicMood: "none" } }] });
  const estimate = (await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL })).details!.estimate as { amountUsd: number };
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, confirmed: true });
  const held = await until(() => world.workflows.runs.record(run.id), (record) => ["paused", "succeeded", "failed", "cancelled"].includes(record.status), "the run to stop");
  assert.deepEqual([held.status, held.pauseReason, held.error], ["paused", "budget_exceeded", undefined]);
  const blocked = world.workflows.runs.executions(run.id).filter((exec) => exec.blockedBy === "budget_exceeded");
  assert.deepEqual(blocked.map((exec) => exec.status), ["ready"]);
  // Nothing was failed or skipped: the steps after the held one still wait for it.
  assert.deepEqual(world.workflows.runs.executions(run.id).filter((exec) => exec.status === "failed" || exec.reason === "upstream_failed").length, 0);
  const stopped = { error: blocked[0].error, failedNodeId: blocked[0].nodeId };
  const details = stopped.error!.details as { reason: string; scope: string; confirmedUsd: number; limitUsd: number; spentUsd: number; estimate: { amountUsd: number }; filmId: string };
  assert.deepEqual([stopped.error!.code, details.reason, details.scope, details.confirmedUsd, details.limitUsd, details.filmId], ["BUDGET_EXCEEDED", "confirmation_required", "confirmed_estimate", estimate.amountUsd, round4(estimate.amountUsd * 1.2), film.id]);
  assert.ok(details.spentUsd <= details.limitUsd + 1e-9 && details.estimate.amountUsd > details.limitUsd, JSON.stringify(details));
  assert.match(stopped.error!.message, /^This film has cost \$[\d.]+ so far and would pass the \$[\d.]+ that was confirmed for it: it now comes to about \$[\d.]+\. Confirm the new amount to go on\.$/);
  const ledger = () => round4(world.h.app.generation.ledgerRows().filter((row) => row.session_id === `run:${run.id}`).reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0));
  assert.ok(ledger() <= details.limitUsd + 1e-9, `spent ${ledger()} of ${details.limitUsd}`);
  const drawn = images(world.stub);
  assert.ok(drawn < 7, "not every picture was paid for");
  // A lower amount is no confirmation; the new one lets the stopped step go on.
  assert.equal((await world.fail("pipeline.confirm", { filmId: film.id, confirmedUsd: round4(estimate.amountUsd / 2) })).code, "INVALID_PARAMS");
  // An amount with no word of which question it answers approves nothing (the run stays paused); with the question's ids it is the answer.
  assert.equal(!!(await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 1 })).pending, true);
  const confirmed = await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 1, ...(details as any).confirmWith });
  assert.deepEqual([confirmed.runId, confirmed.confirmedUsd, confirmed.stopsAtUsd], [run.id, 1, 1.2]);
  // Confirming IS the answer: the run is running again without any other action, and the held step shows no refusal any more.
  assert.notEqual(world.workflows.runs.record(run.id).status, "paused");
  const done = await until(() => world.workflows.runs.record(run.id), (record) => record.status === "succeeded" || (record.status === "failed" && record.error?.code !== "BUDGET_EXCEEDED"), "the run to finish after the new confirmation");
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.ok(images(world.stub) > drawn && world.films.read(film.id).panels.every((panel) => panel.picture.current));
});

test("The voice estimate is the film's own lines as they will be sent: every speaker's lines in one request (a line read at another pace on its own), priced by their real length — a film of long lines is not quoted as so many short ones", async () => {
  const world = await setup({ ask: 0 });
  const film = await scripted(world), long = (n: number) => `${words(n)}.`;
  // Linh: two long lines at one pace (one request) and one read faster (its own request). Minh and the narrator: a line each.
  await linhSays(world, film.id, [{ text: long(60) }, { text: long(80) }, { text: long(30), rate: 1.25 }]);
  await world.call("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { musicMood: "none" } }] });
  const now = world.films.read(film.id), linh = now.lines.filter((line) => line.speakerId === "ch_linh"), others = now.lines.filter((line) => line.speakerId !== "ch_linh");
  // What the speech model asks for a text of this length, read from the service that will make it.
  const priced = (text: string) => world.h.app.generation.prepare({ capability: "tts", params: { text, language: now.language } }).estimate.amountUsd!;
  const requests = [`${linh[0].text}\n\n${linh[1].text}`, linh[2].text, ...others.map((line) => line.text)], expected = Math.round(requests.reduce((sum, text) => sum + priced(text), 0) * 1e6) / 1e6;
  const voice = (details: Record<string, any>) => (details.estimate.breakdown as { id: string; count: number; usd: number }[]).find((part) => part.id === "voice")!;
  const whole = voice((await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL })).details!);
  assert.deepEqual([whole.count, whole.usd], [5, expected]);
  // …and it is far from five times a short sample sentence.
  assert.ok(whole.usd > 5 * priced("One spoken line of the script, of ordinary length.") * 3, String(whole.usd));
  // The same on the screens: all the lines, one speaker's lines, one line.
  assert.deepEqual(voice((await world.fail("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } })).details!).usd, expected);
  const speaker = voice((await world.fail("generate", { filmId: film.id, target: { kind: "speaker", speakerId: "ch_linh" } })).details!);
  assert.deepEqual([speaker.count, speaker.usd], [3, Math.round((priced(requests[0]) + priced(requests[1])) * 1e6) / 1e6]);
  // (Final #1: ONE line is quoted with the recordings a failed read-back makes automatically — three in all.)
  assert.equal(voice((await world.fail("generate", { filmId: film.id, target: { kind: "line", id: linh[1].id } })).details!).usd, Math.round(priced(linh[1].text) * 3 * 1e6) / 1e6);
  // The estimate of the Cost report says the same sum.
  const report = (await world.call("estimate", { filmId: film.id })).rows.find((row: { id: string }) => row.id === "voice") as { count: number; usd: number };
  assert.deepEqual([report.count, report.usd], [5, round4(expected)]);
});

test("Listening is in the estimate and under the run's guard: the confirmation shows a 'listening' row — one read-back per line to record, at the price of the transcription model — and a read-back that would take the run past 120 % of what was confirmed is NOT sent: single lines and a speaker's recording alike stop there, and go on when the new amount is confirmed", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  const film = await scripted(world);
  // Linh has two lines (one recording, cut into pieces that are each listened to); Minh and the narrator one each.
  await linhSays(world, film.id, [{ text: "Where did you get this?" }, { text: "It carries my grandmother's mark." }]);
  await world.call("apply", { filmId: film.id, ops: [{ op: "film.set", fields: { musicMood: "none" } }] });
  const lines = world.films.read(film.id).lines, heard = () => world.stub.calls.filter((call) => call.path === "/audio/transcriptions").length;
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  const estimate = asked.details!.estimate as { amountUsd: number; breakdown: { id: string; label: string; count: number; usd: number; model: string }[]; models: string[] };
  assert.deepEqual(estimate.breakdown.map((part) => [part.id, part.label, part.count]), [["pictures", "Pictures", 7], ["voice", "Voice", 4], ["listening", "Listening", 4]]);
  // Four read-backs at the listener's price per call ($0.00002): of recordings that do not exist yet, so no length — and no reading pace — is in the figure.
  const listening = estimate.breakdown[2];
  assert.deepEqual([lines.length, listening.usd], [4, 0.00008], JSON.stringify(listening));
  assert.ok(listening.model.length > 0 && estimate.models.includes(listening.model) && Math.abs(estimate.amountUsd - estimate.breakdown.reduce((sum, part) => sum + part.usd, 0)) < 1e-6);
  // The screens' own actions count it too.
  assert.deepEqual(((await world.fail("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } })).details!.estimate as typeof estimate).breakdown.map((part) => [part.id, part.count]), [["voice", 4], ["listening", 4]]);
  assert.deepEqual((await world.call("estimate", { filmId: film.id })).rows.map((row: { id: string; count: number }) => [row.id, row.count]), [["assets", 4], ["panels", 3], ["voice", 4], ["listening", 4], ["music", 0]]);

  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL, confirmed: true });
  const approve = async (nodeId: string) => { await waiting(world, run.id, nodeId); world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection as never); };
  await approve("check_breakdown"); await approve("check_assets");
  await waiting(world, run.id, "check_storyboard");
  // The provider's list now says a much higher price for listening than the one the person confirmed (a real price change does this).
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.5 } } });
  world.workflows.runs.resolve(run.id, { nodeId: "check_storyboard", path: "", outcome: "approved" }, world.connection as never);
  const held = await until(() => world.workflows.runs.record(run.id), (record) => ["paused", "succeeded", "failed", "cancelled"].includes(record.status) || world.workflows.runs.executions(run.id, { nodeId: "check_voice" })[0]?.status === "waiting_approval", "the voice stage to stop or end");
  assert.deepEqual([held.status, held.pauseReason, heard()], ["paused", "budget_exceeded", 0], "no read-back was sent past the confirmed amount");
  const blocked = world.workflows.runs.executions(run.id).filter((exec) => exec.blockedBy === "budget_exceeded"), details = blocked[0].error!.details as { reason: string; scope: string; confirmedUsd: number; limitUsd: number; spentUsd: number };
  assert.deepEqual([blocked.map((exec) => exec.nodeId), details.reason, details.scope, details.confirmedUsd, details.limitUsd], [["voice"], "confirmation_required", "confirmed_estimate", estimate.amountUsd, round4(estimate.amountUsd * 1.2)]);
  assert.ok(details.spentUsd <= details.limitUsd + 1e-9, JSON.stringify(details));
  // Confirmed anew, the stage goes on: every line is recorded and listened to.
  await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 5, ...(details as any).confirmWith });
  await waiting(world, run.id, "check_voice");
  const done = world.films.read(film.id);
  assert.ok(heard() >= 4 && done.lines.every((line) => fm.activeTake(line)?.check?.ok === true), JSON.stringify(done.lines.map((line) => fm.activeTake(line)?.check ?? fm.activeTake(line)?.unchecked)));
});

test("The listener the product ships has a price per call, and the film's estimate has its number: 'listening' is so many calls at $0.00002, the total is a figure — not 'unknown' — and the run is held to 120 % of it", async () => {
  const world = await setup({ ask: 0, listeners: false });
  assert.deepEqual((({ source: _source, ...price }: any) => price)(world.h.app.generation.models("openrouter").find((model) => model.id === "qwen/qwen3-asr-1.7b")!.pricing), { kind: "per_call", usd: 0.00002 });
  const film = await scripted(world);
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const estimate = asked.details!.estimate as { amountUsd: number | null; breakdown: { id: string; count: number; usd: number | null }[] }, listening = estimate.breakdown.find((part) => part.id === "listening")!;
  assert.deepEqual([listening.count, listening.usd], [3, 0.00006]);
  assert.ok(typeof estimate.amountUsd === "number" && Math.abs(estimate.amountUsd - estimate.breakdown.reduce((sum, part) => sum + part.usd!, 0)) < 1e-6, JSON.stringify(estimate));
  assert.equal(asked.details!.stopsAtUsd, round4(estimate.amountUsd! * 1.2));
});

/** A recording of exactly this request is put in the host's cache (as another film, or an earlier take, would have left it). */
const cachedSpeech = async (world: World, params: Record<string, unknown>) => { const job = await world.h.app.generation.settled((await world.admin.yes("jagentchill.generation.create", { capability: "tts", params, reuse: true, confirmed: true })).job.jobId); assert.equal(job.state, "succeeded", JSON.stringify(job.error)); };
const noListener = (world: World) => world.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["qwen/qwen3-asr-1.7b"], enabled: false });

test("The estimate is of the cast that WILL speak: a line whose speaker has no voice yet is not quoted from a cached recording made without one — casting gives the speaker a voice, the request is a new paid one, and it is asked about before anything is sent", async () => {
  const world = await setup({ ask: 0 });
  await noListener(world);
  const film = await scripted(world), line = film.lines.find((entry) => entry.speakerId === "ch_minh")!;
  // Minh loses his voice (as a speaker has none before casting), and the cache holds his line spoken with no voice named.
  await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_minh", fields: { voiceId: "", voiceAuto: true } }] });
  await cachedSpeech(world, { text: line.text, language: film.language });
  const sent = speech(world.stub), target = { kind: "line", id: line.id };
  const asked = await world.fail("generate", { filmId: film.id, target });
  const voice = (asked.details!.estimate as { amountUsd: number; breakdown: { id: string; count: number; usd: number }[] }).breakdown.find((part) => part.id === "voice")!;
  assert.deepEqual([asked.code, asked.details!.reason, voice.count, voice.usd > 0, speech(world.stub) - sent], ["PERMISSION_DENIED", "confirmation_required", 1, true, 0]);
  // Confirmed, the one request the estimate counted goes out — in the voice casting gave.
  await world.call("generate", { filmId: film.id, target, confirmed: true });
  await idle(world, film.id);
  const cast = fm.voiceOf(world.films.read(film.id), "ch_minh");
  assert.ok(cast.length > 0 && speech(world.stub) - sent === 1 && fm.activeTake(world.films.read(film.id).lines.find((entry) => entry.id === line.id)!)?.voiceId === cast);
});

test("The estimate is of the recordings that WILL be sent: with nobody to listen a speaker's lines cannot be cut out of one recording, so they are recorded line by line — the estimate counts those requests (a cached recording of the lines together does not make them free), nothing is sent before the confirmation, and the wasted request for the whole is not sent at all", async () => {
  const world = await setup({ ask: 0 });
  await noListener(world);
  const film = await scripted(world);
  const ids = await linhSays(world, film.id, [{ text: "Where did you get this?" }, { text: "It carries my grandmother's mark." }]), now = world.films.read(film.id), lines = ids.map((id) => now.lines.find((line) => line.id === id)!), voice = fm.voiceOf(now, "ch_linh");
  assert.ok(voice.length > 0);
  await cachedSpeech(world, { text: lines.map((line) => line.text).join("\n\n"), language: now.language, voice });
  const sent = speech(world.stub), target = { kind: "speaker", speakerId: "ch_linh" };
  const priced = (text: string) => world.h.app.generation.prepare({ capability: "tts", params: { text, language: now.language, voice } }).estimate.amountUsd!;
  const asked = await world.fail("generate", { filmId: film.id, target });
  const estimate = asked.details!.estimate as { amountUsd: number; breakdown: { id: string; count: number; usd: number }[] };
  assert.deepEqual([asked.details!.reason, estimate.breakdown.map((part) => [part.id, part.count, part.usd]), speech(world.stub) - sent], ["confirmation_required", [["voice", 2, Math.round((priced(lines[0].text) + priced(lines[1].text)) * 1e6) / 1e6]], 0]);
  await world.call("generate", { filmId: film.id, target, confirmed: true });
  await idle(world, film.id);
  const texts = world.stub.calls.filter((call) => call.path === "/audio/speech").slice(sent).map((call) => call.text);
  assert.deepEqual(texts.sort(), lines.map((line) => line.text).sort(), "exactly the two requests the estimate counted");
  assert.ok(world.films.read(film.id).lines.filter((line) => line.speakerId === "ch_linh").every((line) => fm.activeTake(line)?.unchecked?.why === "no_listener"));
});

test("One confirmation for an action started on a screen: a single picture and a whole batch are each refused once with their estimate and made when confirmed — a batch is not asked about picture by picture", async () => {
  const world = await setup({ ask: 0 });
  const film = await scripted(world);
  const one = { filmId: film.id, target: { kind: "asset", assetKind: "character", id: "ch_linh" } };
  const asked = await world.fail("generate", one);
  assert.deepEqual([asked.code, asked.details!.reason, asked.details!.confirmAboveUsd, (asked.details!.estimate as { breakdown: { id: string; count: number }[] }).breakdown.map((part) => [part.id, part.count]), asked.details!.target], ["PERMISSION_DENIED", "confirmation_required", 0, [["pictures", 1]], one.target]);
  assert.equal(images(world.stub), 0, "nothing is generated before the confirmation");
  await world.call("generate", { ...one, confirmed: true });
  await idle(world, film.id);
  assert.equal(images(world.stub), 1);
  const batch = { filmId: film.id, target: { kind: "assets", scope: "missing" } };
  const whole = (await world.fail("generate", batch)).details!.estimate as { amountUsd: number; breakdown: { id: string; count: number; usd: number }[] };
  assert.deepEqual([whole.breakdown.map((part) => [part.id, part.count]), whole.amountUsd], [[["pictures", 3]], whole.breakdown[0].usd]);
  await world.call("generate", { ...batch, confirmed: true });
  await idle(world, film.id);
  assert.deepEqual([images(world.stub), Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed")], [4, []]);
  // Voice lines: one question for all of them.
  const lines = (await world.fail("generate", { filmId: film.id, target: { kind: "lines", scope: "missing" } })).details!.estimate as { breakdown: { id: string; count: number }[] };
  assert.deepEqual(lines.breakdown.map((part) => [part.id, part.count]), [["voice", 3], ["listening", 3]]);
  assert.equal(speech(world.stub), 0);
});

test("Review 10 #3 (film) — an action started on a screen retries inside the approved amount: one picture is quoted and confirmed; the provider bills it and its answer cannot be kept, and the second request — which would double what was confirmed — is NOT sent: the action stops with what was spent and what remains, and only the answer to that question sends it", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  const film = await scripted(world), target = { kind: "asset", assetKind: "character", id: "ch_linh" };
  // The double answers this picture with bytes that are no picture — and bills it $0.011 like any other.
  await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_linh", fields: { appearance: "black braid [corrupt]" } }] });
  const sent = () => world.stub.calls.filter((call) => call.path === "/images").length, spent = () => round4(world.h.app.generation.ledgerRows().reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0));
  const quote = await world.fail("generate", { filmId: film.id, target });
  assert.deepEqual([quote.details!.reason, quote.details!.estimate.amountUsd, sent()], ["confirmation_required", 0.011, 0]);
  await world.call("generate", { filmId: film.id, target, ...quote.details!.confirmWith, confirmed: true });
  await idle(world, film.id);
  assert.deepEqual([sent(), spent()], [1, 0.011], "one request was sent and billed: what was confirmed. The retry would have made it $0.022");
  const failed = Object.values(world.films.activityOf(film.id)).find((entry) => entry.state === "failed") as { code?: string } | undefined;
  assert.equal(failed?.code, "BUDGET_EXCEEDED", JSON.stringify(failed));
  // The action stands, with its question: asked again without an answer — the same question, nothing sent.
  const stopped = await world.fail("generate", { filmId: film.id, target });
  assert.deepEqual([stopped.details!.reason, stopped.details!.gate, stopped.details!.spentUsd, stopped.details!.estimate.spentUsd, stopped.details!.estimate.remainsUsd, stopped.details!.estimate.amountUsd, stopped.details!.confirmedUsd, sent()], ["confirmation_required", "over_amount", 0.011, 0.011, 0.011, 0.022, 0.011, 1]);
  // The answer to the FIRST question is not an answer to this one.
  assert.deepEqual([(await world.fail("generate", { filmId: film.id, target, ...quote.details!.confirmWith, confirmed: true })).details!.gate, sent()], ["over_amount", 1]);
  await world.call("generate", { filmId: film.id, target, ...stopped.details!.confirmWith, confirmed: true });
  await idle(world, film.id);
  assert.deepEqual([sent(), spent()], [2, 0.022], "the answer let one more request go — and no more");
});

test("Review 10 #7 — a price that is not known is not zero in a confirmed run: the picture model of a run whose cost was confirmed becomes one this host knows no price for — the next picture is NOT drawn on the strength of the amount that was confirmed; the run pauses and asks about that model, no amount answers it, and the answer to that question lets the run go on", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  const film = await scripted(world);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  const approve = async (nodeId: string) => { await waiting(world, run.id, nodeId); world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection as never); };
  await approve("check_breakdown");
  await waiting(world, run.id, "check_assets");
  const drawn = images(world.stub);
  assert.equal(drawn, 4, "the reference pictures were drawn at the confirmed price");
  // The model loses its price (as when the role is moved to a model the catalogue has no price for).
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: null } });
  await approve("check_assets");
  const paused = await until(() => world.workflows.runs.record(run.id), (record) => record.status === "paused" || ["succeeded", "failed"].includes(record.status), "the run to pause");
  const held = world.workflows.runs.executions(run.id).find((exec) => exec.blockedBy === "budget_exceeded"), details = held?.error?.details as Record<string, any> | undefined;
  assert.deepEqual([paused.status, paused.pauseReason, images(world.stub) - drawn, details?.reason, details?.gate, details?.unpriced, details?.estimate.unpricedModels], ["paused", "budget_exceeded", 0, "confirmation_required", "unpriced_model", true, ["openrouter/openai/gpt-5-image-mini"]], "no picture was drawn at a price nobody knows");
  // A figure — however large — is not an approval of a price nobody knows: the run stays where it is.
  const figure = await world.call("pipeline.confirm", { filmId: film.id, confirmedUsd: 1000 });
  await tick(150);
  assert.deepEqual([!!figure.pending, world.workflows.runs.record(run.id).status, images(world.stub) - drawn], [true, "paused", 0]);
  await world.call("pipeline.confirm", { filmId: film.id, ...details!.confirmWith, confirmed: true });
  await until(() => images(world.stub), (count) => count > drawn, "the storyboard to be drawn after the answer");
});

test("Review 10 #8 — the turns of a runtime's model are in the run's approval: script writing does not start before the money question (the question names the model that writes and the model that looks, each as 'price not known'), every such turn is a charge of the run's action, and a look by a model that was NOT approved is not sent — the run pauses and asks", async () => {
  const roles: Roles = { vision: { ...MODEL2 } };
  const world = await setup({ ask: 0, roles });
  await priceAsBilled(world);
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const turns = () => (world.h.fake.callsOf("startTurn") as unknown[]).length;
  // Only the story exists: "Make the film" is refused BEFORE the script is written.
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL });
  assert.deepEqual([asked.code, asked.details!.reason, asked.details!.scripted, asked.details!.estimate.unpricedParts, asked.details!.estimate.unpricedModels, turns(), world.films.read(film.id).panels.length],
    ["PERMISSION_DENIED", "confirmation_required", false, [{ id: "writing", label: "Writing the script", model: "opus" }, { id: "vision", label: "Checking the pictures", model: "haiku" }], ["runtime:anthropic/haiku", "runtime:anthropic/opus"], 0, 0], "nothing was written before the question");
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "checkpoints", model: MODEL, ...asked.details!.confirmWith, confirmed: true });
  const approve = async (nodeId: string) => { await waiting(world, run.id, nodeId); world.workflows.runs.resolve(run.id, { nodeId, path: "", outcome: "approved" }, world.connection as never); };
  await approve("check_breakdown");
  // The script is there, and what it needs fits what was approved at the start: no second question — the run is at its next checkpoint.
  await waiting(world, run.id, "check_assets");
  const charges = () => (world.h.app.db.prepare("SELECT model, kind, usd FROM gen_charges WHERE action_id = ? ORDER BY id").all(`film.run:${run.id}`) as { model: string; kind: string; usd: number | null }[]);
  assert.deepEqual([charges().slice(0, 1).map((row) => [row.model, row.kind, row.usd]), charges().filter((row) => row.kind === "image").length, world.looks.length], [[["opus", "turn", null]], 4, 0], "the writing turn is a charge of the run: its price is not known, and it is on record");
  assert.equal(world.workflows.runs.executions(run.id, { nodeId: "confirm_cost" })[0].status, "skipped");
  // The Vision role is moved to a model nobody approved for this run.
  roles.vision = { ...MODEL2, modelId: "opusplan" };
  const drawn = images(world.stub);
  await approve("check_assets");
  const paused = await until(() => world.workflows.runs.record(run.id), (record) => record.status === "paused" || ["succeeded", "failed"].includes(record.status), "the run to pause");
  const details = world.workflows.runs.executions(run.id).find((exec) => exec.blockedBy === "budget_exceeded")?.error?.details as Record<string, any> | undefined;
  assert.deepEqual([paused.status, paused.pauseReason, details?.gate, details?.estimate.unpricedModels, world.looks.length], ["paused", "budget_exceeded", "unpriced_model", ["runtime:anthropic/opusplan"], 0], "the look by a model that was not approved was not sent");
  assert.ok(images(world.stub) > drawn, "the frame it would have looked at was drawn (and paid for) under the approval");
  // Back on the model that was approved, and the stop answered: the looks go out, each a charge of the run.
  roles.vision = { ...MODEL2 };
  await world.call("pipeline.confirm", { filmId: film.id, ...details!.confirmWith, confirmed: true });
  await until(() => world.looks.length, (count) => count > 0, "a frame to be looked at");
  await tick(100);
  assert.equal(charges().filter((row) => row.kind === "turn" && row.model === "haiku").length, world.looks.length);
  // The run is still drawing: let it reach its next checkpoint before the host of this test is closed.
  await waiting(world, run.id, "check_storyboard");
});

test("Review 11 #7 and #14 — 'Write with AI' is asked about like all paid work, and no turn of a runtime's model is sent outside the spend gate: the story is not written before the answer (the question names the model, 'price not known'); and through a whole run — the script, the looks at every frame — the workflow service's turn is only ever reached while the gate has a request of an approved action out", async () => {
  const world = await setup({ ask: 0, vision: true });
  await priceAsBilled(world);
  const { film } = (await world.call("create", { title: "The Lantern Keeper" })) as Answer;
  // Every turn the workflow service is asked for, with whether the gate had let a request out at that moment.
  const gate = world.h.app.generation.gate, real = world.workflows.runs.turn, seen: boolean[] = [];
  world.workflows.runs.turn = ((...args: Parameters<typeof real>) => { seen.push(gate.stats().spending > 0); return real(...args); }) as typeof real;
  const ask = { filmId: film.id, what: "story", idea: "A lantern mender", seconds: 30, model: MODEL };
  const asked = await world.fail("write", ask);
  assert.deepEqual([asked.code, asked.details!.reason, asked.details!.estimate.unpricedParts, asked.details!.estimate.unpricedModels, seen.length, world.counts.story], ["PERMISSION_DENIED", "confirmation_required", [{ id: "writing", label: "Writing the story", model: "opus" }], ["runtime:anthropic/opus"], 0, undefined]);
  // `confirmed: true` with no word of which question it answers writes nothing.
  assert.deepEqual([(await world.fail("write", { ...ask, confirmed: true })).details!.reason, seen.length], ["confirmation_required", 0]);
  await world.call("write", { ...ask, ...asked.details!.confirmWith, confirmed: true });
  assert.deepEqual([seen, world.films.read(film.id).sourceText.length > 0], [[true], true]);
  const { run } = await world.call("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL });
  const done = await runEnded(world, run.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.ok(seen.length >= 2 + world.looks.length && world.looks.length > 0, `${seen.length} turns, ${world.looks.length} looks`);
  assert.ok(seen.every(Boolean), "every turn — writing and looking — was a request the gate had let out");
});

test("Review 14 #8 — a film's approval is bound to the words it was asked about: a line's recording is asked about, the line's text is changed to other words of the SAME length (the same price, the same model, the same target) while the question is open — the old answer starts nothing and the question of now is asked; the same for 'Make the film' when a frame's words change while its question is open; the answer to the question of now runs", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  const film = await scripted(world), one = { filmId: film.id, target: { kind: "line", id: "li_2" } }, before = speech(world.stub);
  const text = world.films.read(film.id).lines.find((line) => line.id === "li_2")!.text, other = text.split("").reverse().join("");
  const asked = await world.raw("generate", one).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  await world.raw("apply", { filmId: film.id, ops: [{ op: "line.update", id: "li_2", fields: { text: other } }] });
  const again = await world.raw("generate", { ...one, confirmed: true, ...asked.details.confirmWith }).then(() => assert.fail("the answer to the OLD words started the recording of the new ones"), (error) => error as { details: Record<string, any> });
  assert.deepEqual([again.details.reason, again.details.estimate.amountUsd, again.details.confirmWith.quoteId !== asked.details.confirmWith.quoteId, speech(world.stub) - before], ["confirmation_required", asked.details.estimate.amountUsd, true, 0], "the same amount, another question");
  await world.raw("generate", { ...one, confirmed: true, ...again.details.confirmWith });
  await idle(world, film.id);
  assert.equal(speech(world.stub) - before, 1);
  // "Make the film": the question is open, a frame's words change (the same count, the same prices) — the old answer starts no run.
  const start = { filmId: film.id, mode: "auto", model: MODEL };
  const first = await world.raw("pipeline.start", start).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  await world.raw("apply", { filmId: film.id, ops: [{ op: "panel.update", id: "pa_2", fields: { action: "Linh sits down on the kerb." } }] });
  const second = await world.raw("pipeline.start", { ...start, confirmed: true, ...first.details.confirmWith }).then(() => assert.fail("the answer to the OLD frame started the run"), (error) => error as { details: Record<string, any> });
  assert.deepEqual([second.details.reason, second.details.confirmWith.quoteId !== first.details.confirmWith.quoteId, world.films.read(film.id).pipelineRunId], ["confirmation_required", true, null]);
  const { run } = await world.raw("pipeline.start", { ...start, confirmed: true, ...second.details.confirmWith });
  assert.equal((await runEnded(world, run.id)).status, "succeeded");
});

test("Review 14 #6 — one bound for the quote and the request of a read-back, and a stop that can be answered: with a listener priced by the SECOND a line's recording is quoted without a figure for listening (the recording does not exist; no reading pace is assumed) — 'price not known', by name — and after that ONE answer the take is recorded, listened to and saved, however long it came out; when the action does stop (a take that was heard wrong is recorded again, which the confirmed amount does not hold) the failure in the film's activity carries the question itself (details.confirmWith), its sentence shows the amounts as they are — never '$0.000' — and answering it saves the take", async () => {
  const world = await setup({ ask: 0 });
  const film = await scripted(world), listener = "openrouter/qwen/qwen3-asr-1.7b";
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_second", usd: 0.01 } } });
  const one = { filmId: film.id, target: { kind: "line", id: "li_1" } }, heard = () => world.stub.calls.filter((call) => call.path === "/audio/transcriptions").length, takes = (id: string) => world.films.read(film.id).lines.find((line) => line.id === id)!.takes.length;
  const asked = await world.raw("generate", one).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  const rows = asked.details.estimate.breakdown as { id: string; usd: number | null }[];
  assert.deepEqual([rows.map((row) => [row.id, row.usd === null]), asked.details.estimate.unpricedModels, asked.details.estimate.amountKind], [[["voice", false], ["listening", true]], [listener], "subtotal_of_priced"]);
  await world.raw("generate", { ...one, confirmed: true, ...asked.details.confirmWith });
  await idle(world, film.id);
  assert.deepEqual([takes("li_1"), heard(), Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed")], [1, 1, []], "one answer: recorded, listened to, saved");
  // (Final #1 — this test used to assert a STOP here, with a second question and an endless third: that was the defect.) Another line's first take is heard wrong. Its listener has NO price and its one bill ($0.01 a second) has passed the amount that was confirmed for the priced part (rule (h): what a named model reports still counts against an amount the quote held) — so the automatic second recording is not made, and NOT asked about either: the action ends with the take kept WITH its failed check (the line 'needs attention'); pressing Record again is a new action.
  await world.raw("apply", { filmId: film.id, ops: [{ op: "line.update", id: "li_2", fields: { text: "The lantern is mended at last [misread]" } }] });
  const two = { filmId: film.id, target: { kind: "line", id: "li_2" } }, spoken = speech(world.stub);
  const second = await world.raw("generate", two).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  await world.raw("generate", { ...two, confirmed: true, ...second.details.confirmWith });
  await idle(world, film.id);
  const line = world.films.read(film.id).lines.find((entry) => entry.id === "li_2")!;
  assert.deepEqual([fm.activeTake(line)?.check?.ok, speech(world.stub) - spoken, heard(), Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed")], [false, 1, 2, []], "one answer, one end: no failure, no second question");
});

test("Review 14 #10 (film, ruling R4) — a film is quoted from prices that exist: with a reader and a listener the provider prices per token, sound included (how much sound a text becomes and how long it will be are in no documented figure) the voice and its read-back are rows WITHOUT an amount, their models are named 'price not known', and the figure shown is the subtotal of the pictures and the music — said so", async () => {
  const world = await setup({ ask: 0 });
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "tokens", inputPerMillionUsd: 0.5, outputPerMillionUsd: 6 } } });
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "tokens", inputPerMillionUsd: 7.5, outputPerMillionUsd: 0 } } });
  const film = await scripted(world);
  const asked = await world.raw("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL }).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  const estimate = asked.details.estimate as { amountUsd: number | null; amountKind: string; breakdown: { id: string; usd: number | null }[]; unpricedModels: string[] };
  assert.deepEqual([estimate.breakdown.map((row) => [row.id, row.usd === null]), estimate.amountKind, estimate.unpricedModels.filter((name) => name.startsWith("openrouter/"))], [[["pictures", false], ["voice", true], ["listening", true], ["music", false]], "subtotal_of_priced", ["openrouter/google/gemini-3.8-flash-lite-tts", "openrouter/qwen/qwen3-asr-1.7b"]]);  // (Review 15 #9) …and the figure IS that subtotal — the pictures and the music, to the cent — not "nothing".
  const subtotal = Math.round(estimate.breakdown.reduce((sum, row) => sum + (row.usd ?? 0), 0) * 1e6) / 1e6;
  assert.ok(subtotal > 0);
  assert.equal(estimate.amountUsd, subtotal);
});

test("Review 15 #8 — a drawing's approval is bound to the pictures it will be drawn WITH: a frame's drawing is asked about, then another picture of the sheet it shows is chosen (`asset.use` — the same count of references, the same price, other bytes) — the answer to the old question draws nothing and the question of now is asked; its answer draws the frame with the chosen picture", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  const film = await scripted(world), panel = world.films.read(film.id).panels.find((entry) => entry.characterIds.length > 0)!, sheet = panel.characterIds[0];
  const version = async (id: string, colour: number) => { const blob = world.h.app.sync.blobs.put(await ownPng(colour), { mime: "image/png", name: `${id}.png`, purpose: "media" }); return { op: "asset.picture" as const, kind: "character" as const, id: sheet, version: { id, media: { blobId: blob.sha256, name: `${id}.png`, kind: "image", bytes: blob.size } as never, costUsd: 0, prompt: "", created_ms: 1 } }; };
  world.films.mutate(film.id, [await version("first", 40), await version("second", 200)]);
  const one = { filmId: film.id, target: { kind: "panel", id: panel.id } }, drawn = () => world.stub.calls.filter((call) => call.path === "/images").length, before = drawn();
  const asked = await world.raw("generate", one).then(() => assert.fail("it was started unasked"), (error) => error as { details: Record<string, any> });
  await world.raw("apply", { filmId: film.id, ops: [{ op: "asset.use", kind: "character", id: sheet, versionId: "second" }] });
  const again = await world.raw("generate", { ...one, confirmed: true, ...asked.details.confirmWith }).then(() => assert.fail("the answer about the OLD reference picture started the drawing"), (error) => error as { details: Record<string, any> });
  assert.deepEqual([again.details.reason, again.details.estimate.amountUsd, again.details.confirmWith.quoteId !== asked.details.confirmWith.quoteId, drawn() - before], ["confirmation_required", asked.details.estimate.amountUsd, true, 0], "the same amount, another question");
  await world.raw("generate", { ...one, confirmed: true, ...again.details.confirmWith });
  await idle(world, film.id);
  assert.ok(drawn() - before >= 1);
});


test("Ruling R9 — writing on the person's own signed-in Claude Code is not a money question: a story-only film whose writing runs on a Claude Code model and whose pictures, voice and music are priced asks ONE question with only the priced rows — the writing is no row, no 'price not known' and no model to approve, it is told beside the quote (`ownAccount`); the same film written by a model billed per call (Codex on an API key) with no price still says 'price not known' by that model's name", async () => {
  // Claude Code is signed in with the person's own subscription; Codex runs on an API key (billed per call, no price) — what a built-in endpoint model was.
  const world = await setup({ ask: 0, signIn: "own" });
  await billedByKey(world.h, "codex");
  await priceAsBilled(world);
  const { film } = (await world.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  type Estimate = { amountUsd: number | null; amountKind: string; breakdown: { id: string; usd: number | null; model: string }[]; unpricedParts?: unknown[]; unpricedModels?: string[]; unpriced?: boolean; models: string[]; ownAccount?: { label: string; model: string }[] };
  const CLAUDE = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
  const asked = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: CLAUDE }), estimate = asked.details!.estimate as Estimate;
  assert.deepEqual([asked.details!.reason, estimate.amountKind, estimate.unpricedParts, estimate.unpricedModels, estimate.unpriced, estimate.breakdown.map((row) => row.id), estimate.ownAccount], ["confirmation_required", "total", undefined, undefined, undefined, ["pictures", "voice", "listening", "music"], [{ label: "Writing the script", model: "sonnet", runtime: "Claude Code" }]]);
  assert.ok(estimate.breakdown.every((row) => typeof row.usd === "number") && !JSON.stringify(estimate.models).includes("claude"), "only what this app is billed for is in the quote");
  assert.equal(estimate.amountUsd, Math.round(estimate.breakdown.reduce((sum, row) => sum + row.usd!, 0) * 1e6) / 1e6);
  // The answer to that ONE question starts the run: nothing else is asked about the writing.
  const { run } = await world.raw("pipeline.start", { filmId: film.id, mode: "auto", model: CLAUDE, confirmed: true, ...asked.details!.confirmWith });
  assert.equal(typeof run.id, "string");
  await world.raw("pipeline.cancel", { filmId: film.id }).catch(() => undefined);
  // (The run is waited for: a run still winding down when the file ends writes to a store that is closed.)
  await runEnded(world, run.id).catch(() => undefined);
  await idle(world, film.id).catch(() => undefined);
  // Billed per call through this host's key, and no price: the rule as it was.
  const other = (await world.call("create", { title: "The Lantern Keeper, again", sourceText: STORY })) as Answer;
  const keyed = (await world.fail("pipeline.start", { filmId: other.film.id, mode: "auto", model: { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" } })).details!.estimate as Estimate;
  assert.deepEqual([keyed.amountKind, (keyed.unpricedParts as { model: string }[]).map((part) => part.model), keyed.ownAccount], ["subtotal_of_priced", ["gpt-x"], undefined]);
});

test("Final #1 — 'Record again' on one line is ONE action with ONE approval: a line whose every recording fails its read-back is asked about ONCE — the question holds the recording, its read-back and the automatic recordings after a failed check — and that one answer ends with the best take kept WITH its failed check (the line 'needs attention', as in the pipeline): no failure, no further question, three recordings; pressing it again asks its one question anew; with the host asking only above $5 it asks nothing at all — also when an earlier question about the same line was left unanswered (Cancel)", async () => {
  const world = await setup({ ask: 0 });
  const film = await scripted(world), one = { filmId: film.id, target: { kind: "line", id: "li_2" } };
  // One word the provider double reads for three seconds: too long for the line, every time it is recorded.
  await world.raw("apply", { filmId: film.id, ops: [{ op: "line.update", id: "li_2", fields: { text: `M${"m".repeat(44)}.` } }] });
  const failures = () => Object.values(world.films.activityOf(film.id)).filter((entry) => entry.state === "failed"), line = () => world.films.read(film.id).lines.find((entry) => entry.id === "li_2")!;
  let questions = 0;
  const press = async (): Promise<void> => {
    let answer: Record<string, unknown> = {};
    // As the screen does: every question the host puts — at the start or on the stopped recording — is answered yes.
    for (let round = 0; round < 8; round++) {
      try { await world.raw("generate", { ...one, ...answer }); } catch (error) {
        const refused = error as { details?: { reason?: string; confirmWith?: Record<string, unknown> } };
        if (refused.details?.reason !== "confirmation_required") throw error;
        questions++; answer = { ...refused.details.confirmWith, confirmed: true }; continue;
      }
      await idle(world, film.id);
      const stopped = failures().find((entry) => (entry as { details?: { confirmWith?: unknown } }).details?.confirmWith) as { details: { confirmWith: Record<string, unknown> } } | undefined;
      if (!stopped) return;
      questions++; answer = { ...stopped.details.confirmWith, confirmed: true };
    }
  };
  const before = speech(world.stub);
  await press();
  const take = fm.activeTake(line());
  assert.deepEqual([questions, speech(world.stub) - before, line().takes.length, take?.check?.ok, take?.check?.reason, failures().length], [1, 3, 1, false, "too_long", 0], `ONE question, three recordings, the best take kept with its failed check (${JSON.stringify(failures()).slice(0, 400)})`);
  // The same press again is a new action: its one question, and again an end.
  questions = 0;
  await press();
  assert.deepEqual([questions, line().takes.length, failures().length], [1, 2, 0]);
  // An earlier question about this line that was never answered (Cancel) …
  questions = 0;
  await world.fail("generate", one);
  // … and the host then asks only above $5: the press asks nothing.
  await world.admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 5 } });
  const spoken = speech(world.stub);
  await press();
  assert.deepEqual([questions, speech(world.stub) - spoken, line().takes.length, failures().length], [0, 3, 3, 0], "under the host's amount nothing is asked");
});

test("Final #3 / #4 — a film whose ONLY routed role is the Director is quoted by the Director's model: with no Storyboard or Screenwriter role routed and no model sent, a Director on the person's own signed-in Claude Code makes the writing no money question (no 'price not known', told beside the quote with the runtime's NAME — never its id); a Director on a model billed per call (Claude Code on an API key) with no price is named by that MODEL ('price not known'), not by the word 'director'", async () => {
  const CLAUDE = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
  type Estimate = { amountKind: string; unpricedParts?: { model: string }[]; ownAccount?: { label: string; model: string; runtime?: string }[] };
  const own = await setup({ ask: 0, signIn: "own", roles: { director: CLAUDE } });
  await priceAsBilled(own);
  const first = (await own.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const asked = await own.fail("pipeline.start", { filmId: first.film.id, mode: "auto" }), estimate = asked.details!.estimate as Estimate;
  assert.deepEqual([estimate.amountKind, estimate.unpricedParts, estimate.ownAccount], ["total", undefined, [{ label: "Writing the script", model: "sonnet", runtime: own.h.app.runtimes.runtime("claude-code")!.label }]]);
  assert.ok(estimate.ownAccount![0].runtime && estimate.ownAccount![0].runtime !== "claude-code", "the runtime is named as a person knows it");
  // 'Write with AI' for the story on the same host: nothing to ask at all.
  await own.raw("write", { filmId: first.film.id, what: "story", idea: "A lantern", seconds: 30, tone: "warm" }).catch((error) => assert.notEqual((error as { details?: { reason?: string } }).details?.reason, "confirmation_required", "writing on the person's own account asked about money"));
  const keyed = await setup({ ask: 0, roles: { director: MODEL2 } });
  await priceAsBilled(keyed);
  const second = (await keyed.call("create", { title: "The Lantern Keeper", sourceText: STORY })) as Answer;
  const priced = (await keyed.fail("pipeline.start", { filmId: second.film.id, mode: "auto" })).details!.estimate as Estimate;
  assert.deepEqual([priced.amountKind, priced.unpricedParts?.map((part) => part.model), priced.ownAccount], ["subtotal_of_priced", ["haiku"], undefined]);
  // And the answer to that ONE question starts the run, whose writing turn passes the GATE under the name the quote gave it (a mismatch would stop it there with 'price not known' again). It then ends at the engine: in this test world Model routing itself has no Director (the roles above stand in for `roleModel` only) — the e2e `own-account.mjs` runs the same film with a really routed Director.
  const { run } = await keyed.call("pipeline.start", { filmId: second.film.id, mode: "auto" });
  const ended = await runEnded(keyed, run.id);
  assert.deepEqual([ended.status, keyed.workflows.runs.executions(run.id, {}).filter((exec) => exec.status === "failed").map((exec) => [exec.error?.code, (exec.error?.details as { reason?: string } | undefined)?.reason])], ["failed", [["NO_ROUTE", "no-model-chosen"]]]);
});

// ───────────────────────────── W7 (brief `w7-film.md`): clips for shots, the accent of a voice, a voice sample ─────────────────────────────
/** Model routing gives a generation role ONE profile: this model of the double (turned on for the host first). */
async function routeRole(admin: Device, role: "video" | "voice-tts", model: string): Promise<void> {
  await admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: [model], enabled: true });
  const state = await admin.call("jagentchill.orc.config.get", {});
  await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { [role]: { enabled: true, profiles: [{ id: "main", provider: "openrouter", model, params: {}, enabled: true }], defaultProfileId: "main", routes: { default: { primary: { profileId: "main" }, fallbacks: [] } }, limits: {} } } } });
}
const videoPosts = (stub: StubGeneration) => stub.calls.filter((call) => call.path === "/videos" && call.status === 202 || (call.path === "/videos" && call.status === 200));
const mainOf = (document: ProjectDocument) => (document.scenes[0].tracks.main as unknown as { elements: Array<Record<string, any>> }).elements;

test("W7 #1 — generated video for shots: WITHOUT a profile on the Video role a film is stills, as before, and nothing is asked of a video model; WITH one, the ONE money question of 'Make the film' carries a 'Video clips' row, the run sets every shot in motion from its own picture (the still rides as the first frame) with no second question, and the timeline holds videos", async () => {
  const world = await setup({ ask: 0 });
  await priceAsBilled(world);
  // — no Video role: stills —
  const plain = await scripted(world);
  const before = await world.call("estimate", { filmId: plain.id });
  assert.deepEqual([before.capabilities.video, before.rows.some((row: any) => row.id === "clips")], [false, false]);
  const asked = await world.fail("pipeline.start", { filmId: plain.id, mode: "auto", model: MODEL });
  assert.ok(!asked.details!.estimate.breakdown.some((part: any) => part.id === "video"), "no video row without the role");
  const first = await world.raw("pipeline.start", { filmId: plain.id, mode: "auto", model: MODEL, ...asked.details!.confirmWith, confirmed: true });
  assert.equal((await runEnded(world, first.run.id)).status, "succeeded");
  assert.deepEqual(mainOf(project(world.h, world.films.read(plain.id).project!.projectId)).map((element) => element.type), ["image", "image", "image"]);
  assert.equal(world.stub.calls.filter((call) => call.path === "/videos").length, 0);

  // — the Video role gets a profile —
  await routeRole(world.admin, "video", "stub/video-fast");
  await world.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/video-fast"], enabled: false });
  const unavailable = await world.call("estimate", { filmId: plain.id });
  assert.equal(unavailable.capabilityProblems.video, "The model is turned off");
  await world.admin.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/video-fast"], enabled: true });
  const { film } = (await world.call("create", { title: "The Lantern Keeper II", sourceText: STORY })) as Answer;
  await world.call("write", { filmId: film.id, what: "breakdown", model: MODEL });
  const estimate = await world.call("estimate", { filmId: film.id }), row = estimate.rows.find((entry: any) => entry.id === "clips");
  // Three frames of 2, 3 and 3 s: the model's shortest clip that covers each is 4 s; at 720p (the highest it lists up to the film's 1080p) $0.03 a second, and $0.01 for the picture it starts from.
  assert.deepEqual([estimate.capabilities.video, row.count, row.usd, row.model], [true, 3, 0.39, "Stub Video Fast"]);
  const question = await world.fail("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL }), parts = question.details!.estimate.breakdown as { id: string; label: string; count: number; usd: number | null; model: string }[];
  assert.deepEqual([question.code, question.details!.reason], ["PERMISSION_DENIED", "confirmation_required"]);
  assert.deepEqual(parts.find((part) => part.id === "video"), { id: "video", label: "Video clips", count: 3, usd: 0.39, model: "Stub Video Fast" });
  assert.ok(parts.some((part) => part.id === "pictures") && parts.some((part) => part.id === "voice"), "the same question holds the pictures and the voice");
  const sum = parts.reduce((total, part) => total + (part.usd ?? 0), 0);
  assert.ok(Math.abs(question.details!.estimate.amountUsd - sum) < 1e-6, "the amount asked is the sum of its rows, the video row included");
  const { run } = await world.raw("pipeline.start", { filmId: film.id, mode: "auto", model: MODEL, ...question.details!.confirmWith, confirmed: true });
  const ended = await runEnded(world, run.id);
  assert.equal(ended.status, "succeeded", JSON.stringify(world.workflows.runs.executions(run.id, {}).filter((exec) => exec.status === "failed").map((exec) => exec.error)).slice(0, 800));
  assert.deepEqual(world.workflows.runs.executions(run.id, {}).filter((exec) => exec.status === "waiting_approval"), [], "nothing more was asked");
  const made = world.films.read(film.id), sent = world.stub.calls.filter((call) => call.path === "/videos");
  assert.equal(sent.length, 3, "one request per shot");
  for (const call of sent) assert.deepEqual([call.video!.duration, call.video!.resolution, call.video!.audio, call.video!.frames.map((frame) => [frame.type, frame.kind])], [4, "720p", false, [["first_frame", "jpeg"]]]);
  assert.ok(sent[0].text.includes("slow drift") && sent[0].text.includes("Empty street at dusk."), "the clip is asked with how the frame moves and what happens in it");
  for (const panel of made.panels) assert.deepEqual([panel.clip?.pictureId, panel.clip?.media.kind, fm.clipOf(panel)?.id === panel.clip?.id], [panel.picture.current!.id, "video", true]);
  const main = mainOf(project(world.h, made.project!.projectId));
  assert.deepEqual([...new Set(main.map((element) => element.type))], ["video"], "every shot is a video on the timeline");
  assert.equal(main.filter((element) => !element.freeze).length, 3);
  assert.ok(made.spentUsd >= 0.39, "what the clips cost is in what the film has spent");
  assert.equal(world.h.app.generation.gate.spentOf(`film.run:${run.id}`) <= question.details!.estimate.amountUsd * fm.CONFIRMED_SHARE, true, "inside what was confirmed");

  // — from the film, afterwards: one shot's clip again (ONE question: one clip), and a shot a person keeps a still —
  const again = await world.fail("generate", { filmId: film.id, target: { kind: "clip", id: made.panels[0].id } });
  assert.deepEqual([again.details!.reason, again.details!.estimate.breakdown.map((part: any) => [part.id, part.count, part.usd])], ["confirmation_required", [["video", 1, 0.13]]]);
  await world.raw("generate", { filmId: film.id, target: { kind: "clip", id: made.panels[0].id }, ...again.details!.confirmWith, confirmed: true });
  await idle(world, film.id);
  assert.equal(world.stub.calls.filter((call) => call.path === "/videos").length, 4);
  assert.notEqual(world.films.read(film.id).panels[0].clip!.id, made.panels[0].clip!.id, "a new clip");
  await world.call("apply", { filmId: film.id, ops: [{ op: "panel.still", id: made.panels[1].id, still: true }] });
  await world.call("assemble", { filmId: film.id });
  const kept = mainOf(project(world.h, world.films.read(film.id).project!.projectId));
  assert.deepEqual(kept.filter((element) => !element.freeze).map((element) => element.type), ["video", "image", "video"]);
});

test("W7 #2 — the accent of a voice is ASKED the way the voice model documents it (delivery `instructions`, never inside the text it reads): the film's one default for the narrator and everybody without their own, a person's own where the story or the person says so; a take records what was asked; a voice model that takes no instructions is sent none, and the estimate says which it is", async () => {
  const world = await setup();
  world.model.set({ breakdown: () => JSON.stringify({ ...PLAN, accent: "southern", characters: [PLAN.characters[0], { ...PLAN.characters[1], accent: "northern" }] }) });
  const film = await scripted(world, { language: "vi" });
  assert.deepEqual([film.accent, film.accentAuto, film.characters.map((entry) => entry.accent ?? "")], ["southern", true, ["", "northern"]]);
  assert.deepEqual((await world.call("estimate", { filmId: film.id })).voice, { instructions: true, clone: false, model: "Gemini 3.8 Flash Lite TTS" });
  await world.call("generate", { filmId: film.id, target: { kind: "lines", scope: "all" } });
  await idle(world, film.id);
  const spoken = world.stub.calls.filter((call) => call.path === "/audio/speech");
  const asked = (words: string) => spoken.filter((call) => call.text.includes(words)).map((call) => call.instructions);
  assert.deepEqual(asked("On the night of the full moon"), ["Speak Vietnamese with a Southern (Sài Gòn) accent."], "the narrator: the film's default");
  assert.deepEqual(asked("Where did you get this?"), ["Speak Vietnamese with a Southern (Sài Gòn) accent."], "Linh has none of her own: the film's default");
  assert.deepEqual(asked("Can you fix it?"), ["Speak Vietnamese with a Northern (Hà Nội) accent."], "Minh: his own");
  for (const call of spoken) assert.ok(!/accent/i.test(call.text), "nothing about the accent is in the text that is read aloud");
  const takes = world.films.read(film.id).lines.map((line) => [line.speakerId, fm.activeTake(line)?.accent]);
  assert.deepEqual(takes, [[fm.NARRATOR, "southern"], ["ch_minh", "northern"], ["ch_linh", "southern"]]);
  // A person gives Linh a Central accent: her take is outdated, and recorded again in that accent.
  await world.call("apply", { filmId: film.id, ops: [{ op: "asset.update", kind: "character", id: "ch_linh", fields: { accent: "central" } }] });
  const linh = world.films.read(film.id).lines.find((line) => line.speakerId === "ch_linh")!;
  assert.equal(fm.activeTake(linh)!.stale, true);
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: linh.id } });
  await idle(world, film.id);
  assert.equal(world.stub.calls.filter((call) => call.path === "/audio/speech").pop()!.instructions, "Speak Vietnamese with a Central (Huế) accent.");
  assert.equal(fm.activeTake(world.films.read(film.id).lines.find((line) => line.id === linh.id)!)!.accent, "central");
  // Another voice model, which the provider does not document as taking instructions: nothing is sent, nothing is recorded as asked.
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/locale-voice", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
  await routeRole(world.admin, "voice-tts", "stub/locale-voice");
  assert.deepEqual((await world.call("estimate", { filmId: film.id })).voice, { instructions: false, clone: false, model: "Stub Locale Voice" });
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: linh.id } });
  await idle(world, film.id);
  const last = world.stub.calls.filter((call) => call.path === "/audio/speech").pop()!;
  assert.deepEqual([last.model, last.instructions], ["stub/locale-voice", undefined]);
  assert.equal(world.films.read(film.id).lines.find((line) => line.id === linh.id)!.takes[0].accent, undefined);
});

test("W7 #3 — voice clone: with a voice model that does not speak in a sample's voice the sample is REFUSED, naming the model (nothing is stored that would be ignored); with one that does, a person's recording is kept with the character and rides in the speech request as the provider documents (`input_references`, no voice id beside it), the take says so, and taking the sample away ends it", async () => {
  const world = await setup(), film = await scripted(world);
  const { wavFromPcm16 } = await import("../src/generation/adapter.ts"), { tone } = await import("../scripts/stub-generation.ts");
  const recording = world.h.app.sync.blobs.put(wavFromPcm16(tone(2, 24_000, 1, 180), 24_000, 1), { mime: "audio/wav", name: "my-voice.wav", purpose: "media" });
  const sample = { blobId: recording.sha256, name: "my-voice.wav", bytes: 1, mime: "text/plain", text: "Hello, this is my own voice." };
  // The voice model in use (the recommended one) takes no sample.
  assert.equal((await world.call("estimate", { filmId: film.id })).voice.clone, false);
  const refused = await world.fail("apply", { filmId: film.id, ops: [{ op: "voice.sample", id: "ch_linh", sample }] });
  assert.deepEqual([refused.code, refused.details!.reason, /Gemini 3\.8 Flash Lite TTS, the voice model in use, does not speak in the voice of a sample/.test(refused.message)], ["INVALID_PARAMS", "voice_clone_unavailable", true]);
  assert.equal(world.films.read(film.id).characters[0].voiceSample, undefined);
  // A voice model whose endpoint record says it takes one.
  await world.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/clone-voice", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
  await routeRole(world.admin, "voice-tts", "stub/clone-voice");
  assert.deepEqual((await world.call("estimate", { filmId: film.id })).voice, { instructions: false, clone: true, model: "Stub Clone Voice" });
  // Not a recording / not on the host: refused.
  const picture = world.h.app.sync.blobs.put(await ownPng(), { mime: "image/png", name: "not-a-voice.png", purpose: "media" });
  assert.match((await world.fail("apply", { filmId: film.id, ops: [{ op: "voice.sample", id: "ch_linh", sample: { ...sample, blobId: picture.sha256 } }] })).message, /A voice sample is a recording/);
  assert.match((await world.fail("apply", { filmId: film.id, ops: [{ op: "voice.sample", id: "ch_linh", sample: { ...sample, blobId: "0".repeat(64) } }] })).message, /not on the host yet/);
  await world.call("apply", { filmId: film.id, ops: [{ op: "voice.sample", id: "ch_linh", sample }] });
  const kept = world.films.read(film.id).characters.find((entry) => entry.id === "ch_linh")!.voiceSample!;
  assert.deepEqual([kept.blobId, kept.bytes, kept.mime, kept.text], [recording.sha256, recording.size, "audio/wav", "Hello, this is my own voice."], "its size and kind are the file's, not what the screen said");
  const linh = world.films.read(film.id).lines.find((line) => line.speakerId === "ch_linh")!, minh = world.films.read(film.id).lines.find((line) => line.speakerId === "ch_minh")!;
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: linh.id } });
  await idle(world, film.id);
  const sent = world.stub.calls.filter((call) => call.path === "/audio/speech").pop()!;
  assert.deepEqual([sent.status, sent.model, sent.voiceSample, sent.voice], [200, "stub/clone-voice", { bytes: recording.size, magic: "RIFF", text: "Hello, this is my own voice." }, undefined]);
  assert.equal(fm.activeTake(world.films.read(film.id).lines.find((line) => line.id === linh.id)!)!.voiceSampleId, recording.sha256);
  // A speaker without a sample is not given somebody else's.
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: minh.id } });
  await idle(world, film.id);
  assert.equal(world.stub.calls.filter((call) => call.path === "/audio/speech").pop()!.voiceSample, undefined);
  // Deletable: the sample is taken away, her takes are outdated, and the next recording carries none.
  await world.call("apply", { filmId: film.id, ops: [{ op: "voice.sample", id: "ch_linh", sample: null }] });
  assert.deepEqual([world.films.read(film.id).characters.find((entry) => entry.id === "ch_linh")!.voiceSample, fm.activeTake(world.films.read(film.id).lines.find((line) => line.id === linh.id)!)!.stale], [undefined, true]);
  await world.call("generate", { filmId: film.id, target: { kind: "line", id: linh.id } });
  await idle(world, film.id);
  assert.equal(world.stub.calls.filter((call) => call.path === "/audio/speech").pop()!.voiceSample, undefined);
});
