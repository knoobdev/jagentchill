import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { PITCH_DRIFT_MAX, alignPieces, bytesOfPcm, medianPitch, pcmOfWav, pitchDrift, splitAtPauses } from "./voice-batch.ts";
import { sniffMedia, wavFromPcm16 } from "../generation/adapter.ts";
import { canonicalJson, film as fm, promptVideo as pv, script, validatorEffectRegistry, validatorTransitionRegistry, workflow as wf, type Registries } from "@jagentchill/editor-core";
import type { ErrorCode, GenerationCapability, GenerationJob, GenerationModel, GenerationParams, Scope, WorkflowRunRecord } from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import { speaks } from "../generation/catalogue.ts";
import type { GenerationService } from "../generation/service.ts";
import { isSpendStop, modelName, usdText, type Quote, type SpendAnswer, type SpendStop } from "../generation/spend-gate.ts";
import type { SyncService } from "../sync/service.ts";
import type { StepTool } from "../workflows/runs.ts";
import type { WorkflowService } from "../workflows/service.ts";

/**
 * Film Studio on the host: the film documents (one row each), the channel methods of the five studio screens, and the
 * step tools of the film pipeline. A screen and a pipeline stage call the same functions here, so both change the same
 * film through `fm.applyOps`. It owns no engine, queue or budget: writing is a session turn of the device that asked,
 * pictures, voice and music are jobs of the generation service, the timeline is a project in the document store.
 */
export type FilmDeps = {
  db: DatabaseSync;
  now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  workflows: () => Pick<WorkflowService, "docs" | "runs">;
  generation: () => GenerationService | undefined;
  /** What the turns of a session have cost so far (Usage); null when not known. With it a writing turn is charged what it cost; without it, as "price not known". */
  turnCost?: (sessionKey: string) => Promise<number | null>;
  /**
   * What the host knows of the model a session turn runs on, for the most one request to it can cost: whether a turn is
   * billed by the call at all (a runtime's own sign-in is a plan: not billed), its price by the token, the longest
   * answer it is allowed and its context window. Undefined: the host does not know the model. Absent: every turn's
   * price is "not known".
   */
  turnModel?: (ref: { runtimeId: string; providerId: string; modelId: string }) => {
    billedByCall: boolean; price?: { inputPerMillionUsd: number; outputPerMillionUsd: number };
    /** NOT READ since 2026-10-08 (review 14 #5): figures of the model and measurements of earlier turns are not a count of the request a runtime sends for THIS turn, so they price nothing. Accepted so that the host's wiring keeps compiling. */
    maxOutputTokens?: number; contextWindow?: number; overheadTokens?: number; imageTokens?: number;
  } | undefined;
  /** NOT READ since 2026-10-08 (review 14 #5): what an earlier turn measured is not a bound of the next request. */
  turnContext?: (sessionKey: string) => number | undefined;
  /** The `runs.turn` this service is given is ALREADY a request of the spend gate for a run that put its confirmation on record (one-prompt video's own guarded turn, `prompt-video-money.ts`): such a run's turn is then ONE request of its action — this service does not put a second one around it (it would be charged twice, and would wait for itself). */
  turnsGuarded?: boolean;
  /**
   * ORC: the profile a role runs on right now — the first usable one of its route, with its thinking option and mode.
   * Undefined only when the role has no profile at all (nothing was routed); a role that is turned off or whose
   * profiles cannot serve THROWS `NO_ROUTE` saying why, so no other model writes in its place unseen.
   */
  roleModel?: (roleId: string) => (z.infer<typeof modelRef> & { /** `null`: the profile sets none — the model's own default. */ thinking?: string | null; mode?: string; /** The profile's model options (temperature, extraBody…). */ params?: Record<string, unknown>; profileId?: string }) | undefined;
  sync: Pick<SyncService, "blobs" | "documents">;
};

export const FILM_MIGRATION = `
  CREATE TABLE IF NOT EXISTS films (
    film_id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, opened_ms INTEGER NOT NULL, deleted_ms INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS film_sessions (
    film_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, created_ms INTEGER NOT NULL
  ) STRICT;
`;
const READ: Scope = "jagentchill.projects.read", WRITE: Scope = "jagentchill.projects.write", RUN: Scope = "jagentchill.generation.run";
const failure = (code: string, message: string, extra: { retryable?: boolean; details?: Record<string, unknown> } = {}) => Object.assign(new Error(message), { code, ...extra });
const round = (usd: number): number => Math.round(usd * 10_000) / 10_000;

/** The changes a person makes on a screen. What a generation or a pipeline stage records is not accepted from a device. */
/* "references.allow" is still accepted from screens written before 2026-10-08; it decides nothing (no leave is asked) */
const PERSON_OPS = new Set(["references.allow", "film.set", "asset.add", "asset.update", "asset.remove", "asset.use", "asset.dismiss", "clip.add", "clip.update", "clip.remove", "panel.add", "panel.update", "panel.remove", "panel.move", "panel.use", "panel.dismiss", "panel.leave", "panel.still", "voice.sample", "line.add", "line.update", "line.remove", "line.take.use", "line.take.remove"]);
const id = z.string().min(1).max(64);
const modelRef = z.object({ runtimeId: z.string().min(1).max(120), providerId: z.string().min(1).max(120), modelId: z.string().min(1).max(200) }).strict();
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetKind: z.enum(fm.ASSET_KINDS), id }).strict(),
  z.object({ kind: z.literal("panel"), id }).strict(),
  z.object({ kind: z.literal("line"), id, keepCurrent: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("music") }).strict(),
  /** One shot's picture set in motion (a clip from its still), or every shot that has a picture and no clip of it. */
  z.object({ kind: z.literal("clip"), id }).strict(),
  z.object({ kind: z.literal("clips"), scope: z.enum(["missing", "all"]) }).strict(),
  z.object({ kind: z.literal("assets"), scope: z.enum(["missing", "all"]) }).strict(),
  z.object({ kind: z.literal("panels"), scope: z.enum(["missing", "all"]), clipId: id.optional() }).strict(),
  z.object({ kind: z.literal("lines"), scope: z.enum(["missing", "all"]), keepCurrent: z.boolean().optional() }).strict(),
  /** Every line of ONE speaker (a character id, or the narrator), recorded again as one recording cut into its lines. */
  z.object({ kind: z.literal("speaker"), speakerId: id }).strict(),
]);
type Target = z.infer<typeof target>;
const schemas = {
  film: z.object({ filmId: id }).strict(),
  create: z.object({ title: z.string().max(fm.LIMITS.title).optional(), sourceText: z.string().max(fm.LIMITS.sourceText).optional(), aspectRatio: z.enum(fm.FILM_ASPECT_RATIOS).optional(), artStyle: z.enum(fm.ART_STYLES.map((entry) => entry.id) as [fm.ArtStyle, ...fm.ArtStyle[]]).optional(), language: z.string().min(2).max(16).optional() }).strict(),
  apply: z.object({ filmId: id, ops: z.array(z.object({ op: z.string().max(40) }).passthrough()).min(1).max(200) }).strict(),
  write: z.object({ filmId: id, what: z.enum(["story", "breakdown"]), idea: z.string().max(20_000).optional(), seconds: z.number().int().optional(), tone: z.string().max(200).optional(), model: modelRef.nullable().optional(), /** The person saw what this writing costs — an amount, or "price not known" with the model — and said yes: the answer to that question. */ confirmed: z.literal(true).optional(), actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional() }).strict(),
  generate: z.object({ filmId: id, target, /** The person saw the estimate of this action and confirmed it. */ confirmed: z.literal(true).optional(), /** The answer to the money question: what its refusal named to be sent back (`details.confirmWith`). */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), }).strict(),
  assemble: z.object({ filmId: id, withoutMissing: z.boolean().optional() }).strict(),
  pipeline: z.object({ filmId: id, mode: z.enum(fm.PIPELINE_MODES).optional(), model: modelRef.nullable().optional(), /** The person saw the estimate of the whole run and confirmed it (`confirmedUsd`: the amount they confirmed, when the screen sends it). */ confirmed: z.literal(true).optional(), /** The answer to the money question: what its refusal named to be sent back (`details.confirmWith`). */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), /** Taken from screens written before the spend gate; decides nothing (an answer is `confirmWith`). */ confirmedUsd: z.number().min(0).max(100_000).optional() }).strict(),
  confirm: z.object({ filmId: id, /** A new amount for a run that stopped because it would pass what was confirmed. */ confirmedUsd: z.number().min(0.0001).max(100_000).optional(), /** The answer to the question the run stopped with (also one about a model whose price is not known, which no amount answers). */ confirmed: z.literal(true).optional(), /** The answer to the money question: what its refusal named to be sent back (`details.confirmWith`). */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), }).strict(),
};
function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: String(parsed.error.issues[0]?.path.join(".") ?? "") } });
  return parsed.data;
}
/** A fault of the film model or of a step, in the channel's envelope. */
function wire(error: unknown): never {
  if (error instanceof ProtocolError) throw error;
  const known = error as { code?: string; message?: string; details?: Record<string, unknown>; problems?: string[] };
  if (error instanceof fm.FilmError) throw new ProtocolError(error.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_PARAMS", error.message, { details: error.details });
  if (typeof known.code === "string") throw new ProtocolError(known.code as ErrorCode, known.message ?? "The request failed.", { details: { ...known.details, ...(known.problems ? { problems: known.problems } : {}) } });
  throw error;
}

/** What is being made for a film right now, and what failed last, by target (`story`, `breakdown`, `character:<id>`, `panel:<id>`, `line:<id>`, `music`). Not stored: a restart ends every job of a screen. */
export type FilmActivity = Record<string, { state: "running" | "failed"; code?: string; message?: string; /** A failure that is a MONEY QUESTION (the action stopped to ask): the body of that question as its refusal carried it — `reason: "confirmation_required"`, `estimate`, `spentUsd`, `confirmWith` — so the screen can put the question and send the answer (`confirmed: true` + `confirmWith`) from the activity alone. */ details?: Record<string, unknown> }>;
export type FilmSummary = {
  id: string; title: string; revision: number; updated_ms: number; opened_ms: number; created_ms: number; stale: fm.StageId[]; panels: number; panelsWithImage: number; lines: number; assets: number;
  duration_ticks: number; assembled: boolean; cover: string | null; pipeline: WorkflowRunRecord["status"] | null; busy: boolean;
};
type Actor = { deviceId: string; sessionId: string; signal?: AbortSignal; log?(level: "info" | "warn", message: string): void; /** The pipeline run this work belongs to: its spending is held to what was confirmed for it. */ run?: { runId: string; filmId: string }; /** The action of the spend gate everything this work pays for is a request of: the run's, or the screen action's. */ action?: string };
type Row = { film_id: string; json: string };

export function createFilmService(deps: FilmDeps) {
  const { db, now } = deps;
  db.exec(FILM_MIGRATION);
  const activity = new Map<string, FilmActivity>();
  /** One writing session per film: the studio screens and the pipeline stages share it, so they never litter the Sessions list. */
  const writingSessions = new Map<string, string>();
  /** The film ↔ session association is on the store, so the same session comes back after a restart; the map is its cache. */
  const sessionStore = {
    get: (filmId: string): string | undefined => (db.prepare("SELECT session_key FROM film_sessions WHERE film_id = ?").get(filmId) as { session_key: string } | undefined)?.session_key,
    set: (filmId: string, sessionKey: string): void => { db.prepare("INSERT INTO film_sessions (film_id, session_key, created_ms) VALUES (?, ?, ?) ON CONFLICT(film_id) DO UPDATE SET session_key = excluded.session_key").run(filmId, sessionKey, now()); },
    /** A session the person deleted is no longer there: the film forgets it, so the next writing makes a fresh one. */
    clear: (filmId: string): void => { db.prepare("DELETE FROM film_sessions WHERE film_id = ?").run(filmId); },
  };
  /** One writing at a time per film: two first calls made together queue, so they cannot create two sessions. */
  const writing = new Map<string, Promise<unknown>>();
  function serial<T>(filmId: string, work: () => Promise<T>): Promise<T> {
    const previous = writing.get(filmId) ?? Promise.resolve();
    const next = previous.then(work, work);
    writing.set(filmId, next.then(() => undefined, () => undefined));
    return next;
  }
  const activityOf = (filmId: string): FilmActivity => activity.get(filmId) ?? {};
  const service = (): GenerationService => { const found = deps.generation(); if (!found) throw failure("UNAVAILABLE", "This host has no generation service."); return found; };
  const available = (capability: GenerationCapability): boolean => deps.generation()?.available(capability) === true;

  // — the store —
  function read(filmId: string): fm.Film {
    const row = db.prepare("SELECT film_id, json FROM films WHERE film_id = ? AND deleted_ms IS NULL").get(filmId) as Row | undefined;
    if (!row) throw new ProtocolError("NOT_FOUND", "This film is no longer on the host.", { details: { filmId } });
    return fm.normaliseFilm(JSON.parse(row.json) as fm.Film);
  }
  const announce = (film: fm.Film): void => deps.broadcast(READ, "jagentchill.film.updated", `film:${film.id}`, { filmId: film.id, revision: film.revision, film, activity: activityOf(film.id) });
  function save(film: fm.Film): fm.Film {
    db.prepare("UPDATE films SET title = ?, revision = ?, json = ?, updated_ms = ?, opened_ms = ? WHERE film_id = ?").run(film.title, film.revision, JSON.stringify(film), film.updated_ms, film.opened_ms, film.id);
    announce(film);
    return film;
  }
  /** One change of a film: read, apply, store, announce — synchronous, so a screen and a stage never overwrite each other. */
  const mutate = (filmId: string, ops: readonly fm.FilmOp[]): fm.Film => save(fm.applyOps(read(filmId), ops, { now_ms: now(), newId: () => randomUUID().slice(0, 12) }));
  function mark(filmId: string, key: string, state?: FilmActivity[string]): void {
    const next = { ...activityOf(filmId) };
    if (state) next[key] = state; else delete next[key];
    activity.set(filmId, next);
    try { announce(read(filmId)); } catch { /* the film was deleted while something was made for it */ }
  }
  /** Runs `work` as the job of `key`: listed as running, then gone or listed as failed. */
  async function tracked<T>(filmId: string, key: string, work: () => Promise<T>): Promise<T> {
    if (activityOf(filmId)[key]?.state === "running") throw failure("CONFLICT", "This is already being made.", { details: { target: key } });
    mark(filmId, key, { state: "running" });
    try { const made = await work(); mark(filmId, key); return made; } catch (error) {
      const known = error as { code?: string; message?: string };
      const asked = (error as { details?: Record<string, unknown> }).details;
      mark(filmId, key, { state: "failed", ...(known.code ? { code: known.code } : {}), message: (known.message ?? "It could not be made.").slice(0, 500), ...(asked?.reason === "confirmation_required" && asked.confirmWith ? { details: asked } : {}) });
      throw error;
    }
  }
  const pipelineOf = (film: fm.Film): WorkflowRunRecord | null => {
    if (!film.pipelineRunId) return null;
    try { return (deps.workflows().runs.get(film.pipelineRunId) as { run: WorkflowRunRecord }).run; } catch { return null; }
  };
  function summary(film: fm.Film): FilmSummary {
    const counts = fm.counts(film), cover = fm.orderedPanels(film).find((panel) => panel.picture.current)?.picture.current?.media.blobId ?? null;
    return {
      id: film.id, title: film.title, revision: film.revision, updated_ms: film.updated_ms, opened_ms: film.opened_ms, created_ms: film.created_ms, stale: film.stale, panels: counts.panels, panelsWithImage: counts.panelsWithImage, lines: counts.lines, assets: counts.assets,
      duration_ticks: counts.duration_ticks, assembled: !!film.project, cover, pipeline: pipelineOf(film)?.status ?? null, busy: Object.values(activityOf(film.id)).some((entry) => entry.state === "running"),
    };
  }
  const list = (): FilmSummary[] => (db.prepare("SELECT film_id, json FROM films WHERE deleted_ms IS NULL ORDER BY opened_ms DESC, created_ms DESC").all() as Row[]).map((row) => summary(JSON.parse(row.json) as fm.Film));
  const toIndex = (): void => deps.broadcast(READ, "jagentchill.film.index", "film.index", {});
  /**
   * One change of a film as a screen or an agent tool makes it: the same `mutate`, plus the list refresh a story edit
   * needs (the film's row shows its title). Used by `jagentchill.film.apply` and the `jc_film_*` tools, one write path.
   */
  const edit = (filmId: string, ops: readonly fm.FilmOp[]): fm.Film => {
    const film = mutate(filmId, ops);
    if (ops.some((op) => op.op === "film.set")) toIndex();
    return film;
  };
  /**
   * Reorder the scenes of a film (the model's clips). The film model has no `clip.move` op, so this reorders the clips
   * array and stores it through the same `save` every other change uses; panels keep their `clipId`, so the storyboard
   * and an already assembled timeline follow the new order (which is marked outdated).
   */
  function reorderClips(filmId: string, orderedIds: readonly string[]): fm.Film {
    const film = read(filmId), wanted = [...orderedIds];
    if (new Set(wanted).size !== wanted.length) throw new ProtocolError("INVALID_PARAMS", "List every scene exactly once: an id appears twice.", { details: { ids: wanted } });
    const byId = new Map(film.clips.map((entry) => [entry.id, entry])), missing = wanted.find((entry) => !byId.has(entry));
    if (missing !== undefined) throw new ProtocolError("NOT_FOUND", "This scene is no longer in the film.", { details: { id: missing } });
    if (wanted.length !== film.clips.length) throw new ProtocolError("INVALID_PARAMS", `List every scene exactly once: the film has ${film.clips.length} scene(s).`, { details: { expected: film.clips.length, got: wanted.length } });
    const next: fm.Film = { ...film, clips: wanted.map((entry) => byId.get(entry)!), revision: film.revision + 1, updated_ms: now() };
    if (next.project && !next.stale.includes("timeline")) next.stale = [...next.stale, "timeline"];
    return save(next);
  }
  function create(input: z.infer<typeof schemas.create>): fm.Film {
    const taken = new Set(list().map((entry) => entry.title.toLowerCase()));
    let title = input.title?.trim() || "Untitled film";
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${(input.title?.trim() || "Untitled film").slice(0, fm.LIMITS.title - 6)} ${n}`;
    const film = fm.createFilm({ id: `film_${randomUUID().replace(/-/g, "").slice(0, 16)}`, now_ms: now(), title, ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}), ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(input.artStyle ? { artStyle: input.artStyle } : {}), ...(input.language ? { language: input.language } : {}) });
    db.prepare("INSERT INTO films (film_id, title, revision, json, created_ms, updated_ms, opened_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").run(film.id, film.title, film.revision, JSON.stringify(film), film.created_ms, film.updated_ms, film.opened_ms);
    toIndex();
    return film;
  }

  // — writing: one session turn per film, its answer checked, with the problems sent back twice at most —
  /** The model's answer is checked; on a contract failure the problems and the instruction go back, twice at most. */
  async function write<T>(filmId: string, actor: Actor & { onSession?(sessionKey: string): void }, model: z.infer<typeof modelRef> | null | undefined, title: string, prompt: string, check: (text: string) => T, subject: string, instruction = "", role = "director"): Promise<T> {
    return serial(filmId, async () => {
      let message = prompt, last: unknown, sessionKey = sessionStore.get(filmId) ?? writingSessions.get(filmId);
      // The stored session may have been deleted from the Sessions list: forget the association and let the turn make a replacement (still under this lock).
      if (sessionKey && !db.prepare("SELECT 1 FROM agent_sessions WHERE session_key = ?").get(sessionKey)) {
        sessionStore.clear(filmId);
        writingSessions.delete(filmId);
        sessionKey = undefined;
      }
      const routedTo = deps.roleModel?.(role);
      // No agent runtime takes a model's options with a turn: a profile's options cannot be applied by a turn, and that is SAID, not passed over.
      if (routedTo?.params && Object.keys(routedTo.params).length) actor.log?.("warn", `The ${role} profile's model options (${Object.keys(routedTo.params).join(", ")}) are not applied to this turn: an agent runtime takes no per-turn model options.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        // (No writing role routed, no model sent: the turn goes to the Director ROLE as before — and is a request of the action under the Director's MODEL, the name its quote gave it.)
        const turn = await paidTurn(actor, filmId, routedTo ?? model ?? (role === "director" ? undefined : directorModel()) ?? { providerId: "role", modelId: "director" }, {
          // Who writes is decided in Model routing (ORC): the role of this kind of writing when it has a model; else the
          // model the person's composer is on; else the Director.
          // Named as a model, not as a role: the film's writing turns share one session, and a session reused for another
          // role must be moved to that role's model.
          ...(routedTo ? { ref: { runtimeId: routedTo.runtimeId, providerId: routedTo.providerId, modelId: routedTo.modelId }, ...(routedTo.thinking !== undefined ? { thinkingOptionId: routedTo.thinking } : {}), ...(routedTo.mode ? { modeId: routedTo.mode } : {}) } : model ? { ref: model } : { role: "director" }), title, message, ...(sessionKey ? { sessionKey } : {}),
          ...(actor.signal ? { signal: actor.signal } : {}),
          // The film's writing session is shared like the film: every device that may edit the film may continue it.
          access: "host",
          onSession: (key) => { writingSessions.set(filmId, key); sessionStore.set(filmId, key); actor.onSession?.(key); },
        });
        sessionKey = turn.sessionKey;
        try { return check(turn.text); } catch (error) {
          if (!(error instanceof pv.ContractError)) throw error;
          last = error;
          actor.log?.("warn", `${error.message} — asking for a correction (${attempt + 1} of 2). The answer had ${turn.text.length} characters${turn.text ? `, starting "${turn.text.slice(0, 80).replace(/\s+/g, " ")}"` : ""}.`);
          message = `${prompt}\nYour previous answer was not accepted:\n${error.problems.map((problem) => `- ${problem}`).join("\n")}\nPrevious answer: ${turn.text.slice(0, 6000)}\nAnswer again, complete and corrected.${instruction ? `\n${instruction}` : ""}`;
        }
      }
      throw failure((last as pv.ContractError).code, `The model did not answer with ${subject}. Try again, or pick another model.`, { details: { problems: (last as pv.ContractError).problems, reason: (last as Error).message } });
    });
  }
  /** "Write with AI": the story of the film from an idea, as plain prose of the asked length. */
  async function writeStory(filmId: string, actor: Actor, input: { idea: string; seconds: number; tone: string; model?: z.infer<typeof modelRef> | null }): Promise<fm.Film> {
    const film = read(filmId);
    if (!input.idea.trim()) throw failure("INVALID_PARAMS", "Describe the idea of the film first.", { details: { field: "idea" } });
    if (!(fm.STORY_LENGTHS as readonly number[]).includes(input.seconds)) throw failure("INVALID_PARAMS", "This length is not offered.", { details: { field: "seconds" } });
    const story = await write(filmId, actor, input.model, film.title, fm.PROMPTS.story(film, input.idea, input.seconds, input.tone), (text) => fm.checkStory(text, film.language, input.seconds), "a story", "", "screenwriter");
    return mutate(filmId, [{ op: "film.set", fields: { sourceText: story } }]);
  }
  /** The words "Create script" sends: the contract, the plan's limits, the person's notes. (One function: the quote counts this very message.) */
  const breakdownPrompt = (film: fm.Film, notes = ""): string => fm.PROMPTS.breakdown(film, fm.upperPlan(film.sourceText, film.language)) + (notes.trim() ? `\nThe person asked for these changes to the previous plan: """${notes.trim().slice(0, 2000)}"""` : "") + `\n${fm.RULES}`;
  /** "Create script": the story becomes the cast, the places, the props, the panels and the lines. */
  async function writeBreakdown(filmId: string, actor: Actor & { onSession?(sessionKey: string): void }, model?: z.infer<typeof modelRef> | null, notes = ""): Promise<fm.Film> {
    const film = read(filmId);
    if (!film.sourceText.trim()) throw failure("INVALID_PARAMS", "Write the story first.", { details: { field: "sourceText" } });
    // The plan the film is quoted by (from its story alone) is BINDING on the writer: stated in the prompt, and
    // enforced on the answer — over a limit, ONE correction that names it; over it again, the writing fails and says
    // so. Never silently more (the quote would not hold), never silently cut (the film would lose what was written).
    const limits = fm.upperPlan(film.sourceText, film.language);
    const prompt = breakdownPrompt(film, notes);
    let overBefore = false;
    const breakdown = await write(filmId, actor, model, film.title, prompt, (text) => {
      const raw = fm.extractJson(text);
      if (raw === undefined) throw new pv.ContractError("The film plan is not valid", ["the answer is not a JSON object"]);
      const plan = fm.normaliseBreakdown(raw, film);
      const over = fm.planProblems(plan, limits);
      if (over.length) {
        if (overBefore) throw failure("PLAN_EXCEEDED", `The script the model wrote is larger than this film's plan (at most ${limits.panels} panels, ${limits.lines} lines, ${limits.assets} characters, locations and props), also after it was told so. Nothing was kept. Try again, or pick another model.`, { details: { limits: { panels: limits.panels, lines: limits.lines, assets: limits.assets }, had: { panels: plan.panels.length, lines: plan.lines.length, assets: plan.characters.length + plan.locations.length + plan.props.length }, problems: over } });
        overBefore = true;
        throw new pv.ContractError("The film plan is larger than this film takes", over);
      }
      // The script speaks the story's own lines, word for word and by the story's speaker, and tells the rest: a plan
      // that rewords a quote, gives it to someone else or leaves a panel with no line goes back.
      const names = new Map(plan.characters.map((entry) => [entry.id, entry.name]));
      const problems = fm.scriptProblems(film.sourceText, plan.lines.map((line) => ({ text: line.text, speaker: line.speakerId === fm.NARRATOR ? "Narrator" : names.get(line.speakerId) ?? "", kind: line.kind, panelId: line.panelId })), plan.panels.map((panel) => panel.id), plan.characters.map((entry) => entry.name));
      if (problems.length) throw new pv.ContractError("The film plan is not valid", problems.slice(0, 8));
      return plan;
    }, "a film plan", fm.RULES, "storyboard");
    mutate(filmId, [{ op: "breakdown.set", breakdown }]);
    // The cast is cast automatically from the host's voices: the same function and the same ops the picker uses.
    return castSpeakers(filmId);
  }

  // — generation: one job of the generation service per file —
  /** A film is dozens of pictures: they are made at the low quality tier (about a fifteenth of the default price on the bundled image model). */
  const FILM_IMAGE_QUALITY = "low" as const;
  type Made = { file: pv.MediaFile; costUsd: number; prompt: string };
  /** The parameters a request is really sent with — the one place that decides it, for the job and for its estimate alike. */
  function acceptedParams(base: { capability: GenerationCapability; sessionId?: string; reuse?: boolean; cache?: "bypass" }, params: GenerationParams): GenerationParams {
    // A model that does not offer the wanted shape or pace still makes the file, in its own.
    try { service().prepare({ ...base, params }); return params; } catch (error) {
      if ((error as { code?: string }).code !== "INVALID_PARAMS" || (!params.aspectRatio && params.speed === undefined)) throw error;
      const { aspectRatio: wanted, speed: _speed, ...rest } = params;
      // The shape the model does offer that is nearest the wanted one (16:9 → 3:2), so a wide film is not drawn square.
      const offered = (error as { details?: { field?: string; allowed?: unknown } }).details, shapes = offered?.field === "params.aspectRatio" && Array.isArray(offered.allowed) ? (offered.allowed as unknown[]).filter((shape): shape is string => typeof shape === "string" && /^\d+:\d+$/.test(shape)) : [];
      const ratio = (shape: string) => { const [w, h] = shape.split(":").map(Number); return Math.log(w / h); };
      const nearest = wanted && /^\d+:\d+$/.test(wanted) && shapes.length ? [...shapes].sort((a, b) => Math.abs(ratio(a) - ratio(wanted)) - Math.abs(ratio(b) - ratio(wanted)))[0] : undefined;
      return { ...rest, ...(nearest ? { aspectRatio: nearest } : {}) };
    }
  }
  /** The words of one speech request: a line, or all the given lines of one speaker in one recording. */
  /**
   * What the voice model in use takes beside the text and a voice id, as its catalogue row says (from the provider's
   * documentation): delivery instructions — how an accent is asked — and a sample of a voice to speak in. A model
   * that takes neither is sent neither: an accent or a sample is never dropped into a request that would ignore it.
   */
  const voiceFacts = (): { instructions: boolean; clone: boolean; model: string } => { try { const model = service().prepare({ capability: "tts", params: { text: "a line" } }).model; return { instructions: model.metadata.instructions === true, clone: model.metadata.voiceClone === true, model: model.label }; } catch { return { instructions: false, clone: false, model: "" }; } };
  /** The accent a speaker's lines are ASKED in, and the sample they are spoken in — as far as the voice model in use takes them. */
  const speakerVoice = (film: fm.Film, speakerId: string): { accent: string; sample?: fm.VoiceSample } => { const facts = voiceFacts(), sample = speakerId === fm.NARRATOR ? undefined : film.characters.find((entry) => entry.id === speakerId)?.voiceSample; return { accent: facts.instructions ? fm.accentOf(film, speakerId) : "", ...(facts.clone && sample ? { sample } : {}) }; };
  const speechParams = (film: fm.Film, lines: readonly fm.Line[]): GenerationParams => {
    const voiceId = fm.voiceOf(film, lines[0].speakerId), { accent, sample } = speakerVoice(film, lines[0].speakerId), words = fm.accentWords(film.language, accent);
    // A speaker with a sample speaks in THAT voice: the sample goes with the request instead of a voice id.
    return { text: lines.map((line) => line.text).join("\n\n"), language: film.language, ...(sample ? { voiceSampleBlobId: sample.blobId, ...(sample.text ? { voiceSampleText: sample.text } : {}) } : voiceId ? { voice: voiceId } : {}), ...(words ? { instructions: words } : {}), ...(lines[0].rate !== 1 ? { speed: lines[0].rate } : {}) };
  };
  /** What a take records of HOW it was asked: the accent (never verified — nothing here measures one) and the sample it was spoken in. */
  const takeVoice = (film: fm.Film, speakerId: string): Pick<fm.Take, "accent" | "voiceSampleId"> => { const { accent, sample } = speakerVoice(film, speakerId); return { ...(accent ? { accent } : {}), ...(sample ? { voiceSampleId: sample.blobId } : {}) }; };
  /**
   * A recording is listened to (the read-back): paid work of the run like any other, so the run's guard is asked
   * before EACH call — one that would take the run past what was confirmed is not sent. Undefined: nobody listens here.
   */
  async function listen(actor: Actor, input: { bytes: Uint8Array; format: "wav" | "mp3"; language: string; seconds: number }): Promise<{ text: string; costUsd: number } | undefined> {
    const generation = deps.generation(), listener = generation?.listener(undefined, input.language);
    if (!generation || !listener) return undefined;
    // ONE bound for the quote and the request (review 14 #6): a read-back was quoted before its recording existed, so
    // without a length — and it is reserved the same way, not by the length the take came out at. (A listener whose
    // price depends on the length was quoted as "price not known" and goes out as that.)
    try { return await generation.transcribe({ bytes: input.bytes, format: input.format, language: input.language }, actor.signal, { sessionId: actor.sessionId, ...(actor.action ? { action: actor.action } : {}) }); } catch (error) { if (isSpendStop(error)) throw moneyStop(actor) ?? error; throw error; }
  }
  /**
   * A turn of a runtime's model that the film pays for (writing the script, looking at a frame): ONE request of the
   * action, through the spend gate like a provider's. The host knows no price for it, so it goes out only to a model
   * the person approved by name — it was listed, as "price not known", in the quote of the run or of the action.
   * Writing a person starts by itself on a screen (`…film.write`) is the host's own work, like a message in a chat.
   */
  type Turn = ReturnType<FilmDeps["workflows"]>["runs"]["turn"];
  async function paidTurn(actor: Actor, filmId: string, ref: { providerId: string; modelId: string }, input: Parameters<Turn>[1]): Promise<Awaited<ReturnType<Turn>>> {
    const gate = service().gate;
    // What the quote said of this turn (`turnUsd`): nothing (the model is not billed by the call), or "price not known" — the same for the request as for the quote.
    const bound = turnUsd(input.ref ?? (typeof (ref as { runtimeId?: unknown }).runtimeId === "string" ? (ref as { runtimeId: string; providerId: string; modelId: string }) : undefined));
    // The workflow service's turn, behind the gate: it is reachable here only as a request of the actor's action, charged when it answers.
    if (!actor.action) throw failure("PERMISSION_DENIED", "Confirm the cost of this request first.", { details: { reason: "confirmation_required", filmId } });
    try {
      const answer = await gate.guardTurn(deps.workflows().runs.turn as Turn, deps.turnCost)(actor.action, ref, actor.deviceId, input, bound.usd, deps.turnsGuarded && gate.covered(actor.action) === actor.action ? { relay: true } : { leaf: true });
      return answer;
    } catch (error) { if (isSpendStop(error)) throw moneyStop(actor) ?? error; throw error; }
  }
  /**
   * What ONE turn of a runtime's model costs, as far as the host can say BEFORE it is sent (review 14 #5, rulings R3/R4):
   *  - 0 when the model is not billed by the call (a runtime's own sign-in) or its price is zero;
   *  - null — "price not known — <model>" — for every other model. The request a runtime sends for a turn is not the
   *    film's message alone: the runtime adds its system prompt, its tools and the session's history, and the host
   *    never sees that request. What an EARLIER turn measured (Usage's context figure, the largest first turn on that
   *    model) is not a count of THIS request, and no limit on the answer can be sent with a turn (no agent CLI
   *    takes one). So nothing here is a bound, and none is made up: the model is named in the quote and
   *    approved by name; what the turn really cost is charged to the action when Usage's record of it says.
   */
  function turnUsd(ref: { runtimeId: string; providerId: string; modelId: string } | undefined): { usd: number | null; /** Ruling R9: the model runs on the person's own signed-in account — not billed by this app, no part of a quote. */ own?: true } {
    // Ruling R9: HOW the model is billed is the gate's one classification (the host's runtimes): the person's own signed-in account is no money of this app.
    if (ref && deps.generation()?.gate.billingOf({ ref }) === "own_account") return { usd: 0, own: true };
    const known = ref ? deps.turnModel?.(ref) : undefined;
    if (!known) return { usd: null };
    if (!known.billedByCall) return { usd: 0, own: true };
    return { usd: known.price && known.price.inputPerMillionUsd === 0 && known.price.outputPerMillionUsd === 0 ? 0 : null };
  }
  async function generate(actor: Actor, capability: GenerationCapability, params: GenerationParams, name: string, fresh: boolean, film?: fm.Film): Promise<Made> {
    const generation = service(), base = { capability, sessionId: actor.sessionId, reuse: true, ...(fresh ? { cache: "bypass" as const } : {}) };
    let job: GenerationJob;
    try {
      const accepted = acceptedParams(base, params);
      // The job is a request of the actor's action: the gate checks it before it is queued, and holds every attempt of
      // it to what was approved — a run is not asked about money again until it is about to pass that.
      job = generation.create({ ...base, params: accepted }, { deviceId: actor.deviceId, by: "agent", sessionId: actor.sessionId, priority: "batch", ...(actor.action ? { action: actor.action } : {}) });
    } catch (error) {
      if (isSpendStop(error)) throw moneyStop(actor) ?? error;
      const known = error as { code?: string; message?: string; details?: Record<string, unknown> };
      if (known.code === "BUDGET_EXCEEDED") throw failure("BUDGET_EXCEEDED", known.message ?? "A spending limit of this host was reached.", { details: known.details });
      throw error;
    }
    const cancel = () => { generation.cancel(job.jobId); };
    actor.signal?.addEventListener("abort", cancel, { once: true });
    if (actor.signal?.aborted) cancel();
    try { job = await generation.settled(job.jobId); }
    finally { actor.signal?.removeEventListener("abort", cancel); }
    if (actor.signal?.aborted) throw failure("CANCELLED", "The step was cancelled.");
    if (job.state !== "succeeded" || !job.results[0]) {
      const error = job.error ?? { class: "unknown", message: "The provider returned nothing", action: "", retryable: false };
      // The gate stopped the job (it would pass what was approved, or its model's price is not known): the action's question, not a provider's failure.
      if (error.class === "budget_exceeded" && error.details?.reason === "confirmation_required") { const stopped = moneyStop(actor); if (stopped) throw stopped; }
      throw failure(error.class === "budget_exceeded" ? "BUDGET_EXCEEDED" : error.class === "content_blocked" ? "CONTENT_BLOCKED" : "PROVIDER_ERROR", error.message, { details: { class: error.class, jobId: job.jobId } });
    }
    const asset = job.results[0];
    return {
      file: { blobId: asset.blobId, name: `${name}.${asset.name.split(".").pop() ?? "bin"}`, kind: asset.kind === "image" ? "image" : asset.kind === "video" ? "video" : "audio", bytes: asset.size, ...(asset.width ? { width: asset.width, height: asset.height } : {}), ...(asset.durationSeconds ? { duration_ticks: Math.round(asset.durationSeconds * pv.TICKS) } : {}), provenance: { ...asset.provenance } },
      costUsd: job.actualUsd ?? 0, prompt: params.prompt ?? params.text ?? "",
    };
  }
  const version = (made: Made): fm.Version => ({ id: randomUUID().slice(0, 12), media: made.file, costUsd: made.costUsd, prompt: made.prompt, created_ms: now() });
  const needImages = (): void => { if (!available("image")) throw failure("NO_ROUTE", "No way to obtain pictures: connect an image provider under Settings, Providers, Generation.", { details: { capability: "image" } }); };
  const assetsOf = (film: fm.Film): { kind: fm.AssetKind; asset: fm.Asset }[] => [...film.characters.map((asset) => ({ kind: "character" as const, asset })), ...film.locations.map((asset) => ({ kind: "location" as const, asset })), ...film.props.map((asset) => ({ kind: "prop" as const, asset }))];

  /** The reference picture of a character, place or prop. A second picture is offered beside the one in use. */
  function makeAsset(filmId: string, kind: fm.AssetKind, assetId: string, actor: Actor): Promise<fm.Film> {
    return tracked(filmId, `${kind}:${assetId}`, async () => {
      needImages();
      const film = read(filmId), asset = assetsOf(film).find((entry) => entry.kind === kind && entry.asset.id === assetId)?.asset;
      if (!asset) throw failure("NOT_FOUND", `This ${kind} is no longer in the film.`, { details: { id: assetId } });
      let made: Made;
      try { made = await generate(actor, "image", { prompt: fm.assetPrompt(film, kind, asset), aspectRatio: fm.ASSET_ASPECT[kind], quality: FILM_IMAGE_QUALITY }, asset.name, !!asset.picture.current, film); } catch (error) {
        // A refusal is written into the film: the screen still knows it after a restart, when the job's failure is forgotten.
        if ((error as { code?: string }).code === "CONTENT_BLOCKED") { try { mutate(filmId, [{ op: "asset.refused", kind, id: assetId, message: (error as Error).message.slice(0, 500) }]); } catch { /* the asset was removed meanwhile */ } }
        throw error;
      }
      return mutate(filmId, [{ op: "asset.picture", kind, id: assetId, version: version(made) }, { op: "spent.add", usd: made.costUsd }]);
    });
  }
  /**
   * A model that can see (the Vision role of Model routing) is shown the picture and asked whether it is the frame.
   * Undefined = nobody judged it: no Vision model is routed, the picture could not be shown, or the answer held no
   * verdict after two askings — the caller keeps the picture WITHOUT a check, and the run log says which.
   */
  type Routed = NonNullable<ReturnType<NonNullable<FilmDeps["roleModel"]>>>;
  async function look(film: fm.Film, panel: fm.Panel, label: string, file: pv.MediaFile, actor: Actor, vision: Routed | undefined): Promise<fm.PictureCheck | undefined> {
    if (!vision) return undefined;
    try {
      const bytes = await deps.generation()?.smallPicture(file.blobId);
      if (!bytes) { actor.log?.("warn", `${label} was not checked: this host cannot prepare the picture for the Vision model (ffmpeg is missing).`); return undefined; }
      for (let asked = 0; asked < 2; asked++) {
        const turn = await paidTurn(actor, film.id, vision, { ref: { runtimeId: vision.runtimeId, providerId: vision.providerId, modelId: vision.modelId }, ...(typeof vision.thinking === "string" ? { thinkingOptionId: vision.thinking } : {}), ...(vision.mode ? { modeId: vision.mode } : {}), title: `Picture check — ${film.title}`.slice(0, 120), message: fm.pictureQuestion(film, panel), images: [{ mime: "image/jpeg", name: "frame.jpg", bytes }], discard: true, ...(actor.signal ? { signal: actor.signal } : {}) });
        const verdict = fm.readPictureVerdict(turn.text);
        if (verdict) return verdict;
      }
      actor.log?.("warn", `${label} was not checked: the Vision model did not answer the question (twice).`);
    } catch (error) {
      if ((error as { code?: string }).code === "CANCELLED" || (error as { details?: { reason?: unknown } }).details?.reason === "confirmation_required") throw error;
      actor.log?.("warn", `${label} was not checked: the Vision model could not be asked (${(error as Error).message.slice(0, 160)}).`);
    }
    return undefined;
  }
  /**
   * The still of a panel, drawn from its words WITH the pictures of what it shows, then looked at: a picture that is
   * not the frame (a poster, a stranger, lettering) is drawn again, three drawings at most; if none is the frame, the
   * last one is kept beside the panel — not in it — and the panel waits for a person.
   */
  function makePanel(filmId: string, panelId: string, actor: Actor): Promise<fm.Film> {
    return tracked(filmId, `panel:${panelId}`, async () => {
      needImages();
      const film = read(filmId), panel = film.panels.find((entry) => entry.id === panelId);
      if (!panel) throw failure("NOT_FOUND", "This panel is no longer in the film.", { details: { id: panelId } });
      // Who will look at the picture is settled before anything is paid for: a Vision role that is routed but cannot serve stops here.
      const vision = deps.roleModel?.("vision");
      // Drawn WITH pictures, not from words alone: the sheets of who and what the panel shows and the frame before it,
      // as many as the model that will draw takes and never more than five (none when it takes none — then the words carry the look).
      let most = 0, provider = "";
      try { const model = service().prepare({ capability: "image", params: { prompt: "a picture" } }).model; most = model.metadata.referenceImages ?? 0; provider = model.provider; } catch { /* no route: `generate` says so */ }
      const references = fm.panelReferenceList(film, panel).slice(0, Math.min(most, fm.PANEL_REFERENCES_MAX)), words = fm.referenceWords(references);
      const label = `Panel ${fm.orderedPanels(film).indexOf(panel) + 1}`, shape = { aspectRatio: pv.imageAspect(film.aspectRatio), quality: FILM_IMAGE_QUALITY, ...(references.length ? { referenceBlobIds: references.map((entry) => entry.blobId) } : {}) };
      const worded = (prompt: string): string => (words ? `${prompt} ${words}` : prompt);
      const draw = async (fresh: boolean): Promise<Made> => {
        try { return await generate(actor, "image", { prompt: worded(fm.panelPrompt(film, panel)), ...shape }, label, fresh, film); } catch (error) {
          // Refused under the provider's content policy: the frame is asked once more in plain words before it is given up.
          if ((error as { code?: string }).code !== "CONTENT_BLOCKED") throw error;
          actor.log?.("warn", `${label} was refused by the provider's content policy; asking again in plainer words.`);
          try { return await generate(actor, "image", { prompt: worded(fm.plainPanelPrompt(film, panel)), ...shape }, label, true, film); } catch (again) {
            // Refused twice: the frame is not dropped — it is marked, and waits for a person (new words, or "leave it out").
            if ((again as { code?: string }).code === "CONTENT_BLOCKED") mutate(filmId, [{ op: "panel.refused", id: panelId, message: (again as Error).message.slice(0, 500) }]);
            throw again;
          }
        }
      };
      let costUsd = 0;
      // An action that stopped to ask about money in the middle of a frame's drawings goes on, after the answer, with
      // the drawing it stopped before: the picture that was just found wrong is not taken from the cache and shown again.
      const gate = deps.generation()?.gate, mark = `drawing:${panelId}`, stoodAt = actor.action ? gate?.action(actor.action)?.checkpoints[mark] : undefined;
      for (let attempt = typeof stoodAt === "number" ? stoodAt : 0; ; attempt++) {
        let made: Made;
        try { made = await draw(!!panel.picture.current || attempt > 0); } catch (error) {
          if (costUsd) mutate(filmId, [{ op: "spent.add", usd: costUsd }]);
          if (actor.action && attempt > 0 && (error as { details?: { reason?: unknown } }).details?.reason === "confirmation_required") gate?.checkpoint(actor.action, mark, attempt);
          throw error;
        }
        costUsd += made.costUsd;
        const check = await look(film, panel, label, made.file, actor, vision), next = fm.afterPictureCheck(check, attempt), kept: fm.Version = { ...version(made), ...(check ? { check } : {}), drawing: attempt + 1 };
        if (next !== "again" && actor.action && typeof stoodAt === "number") gate?.checkpoint(actor.action, mark, undefined);
        if (next === "keep") return mutate(filmId, [{ op: "panel.picture", id: panelId, version: kept }, { op: "spent.add", usd: costUsd }]);
        actor.log?.("warn", `${label}, drawing ${attempt + 1}: the picture is not the frame (${check!.why})${next === "again" ? " — drawing it again." : "."}`);
        if (next === "again") continue;
        // Three drawings, none the frame: the last is kept BESIDE the panel for a person to see; the panel itself stays without a picture.
        // A frame with no picture, or with an OUTDATED one (its words changed since), is marked: it waits for a person. Only a frame whose current picture still is the frame stays as it is.
        const problem = fm.pictureProblem(check!, attempt + 1), held = read(filmId).panels.find((entry) => entry.id === panelId)?.picture, good = !!held?.current && !held.stale;
        mutate(filmId, [{ op: "panel.candidate", id: panelId, version: kept }, ...(good ? [] : [{ op: "panel.refused" as const, id: panelId, message: problem, reason: "picture" as const }]), { op: "spent.add", usd: costUsd }]);
        throw failure("PICTURE_REJECTED", `${label}: ${problem}`, { details: { panelId, check } });
      }
    });
  }
  /** One recording as a candidate take of a line: the file, its verdict (none when nobody listened), and what it cost. */
  type Heard = { made: Made; check?: fm.SpeechCheck; unchecked?: fm.Unchecked; costUsd: number };
  /** Better of two candidates: a passed check, then one nobody could judge, then the higher score. */
  const rank = (entry: Heard): number => (entry.check?.ok ? 3 : !entry.check ? 2 : entry.check.score);
  /**
   * One take of a voice line in the voice of its speaker. A take is listened to before it is kept: the words a
   * transcription model writes back must be the line, the recording must be as long as a person reading it, and — when
   * the speaker's pitch is known (`within.speakerHz`, from the speaker's one recording) — the voice must be that
   * speaker's. A take that is not is made again (three recordings at most, counting the one handed in as `within.first`);
   * if none passes, the best one is kept WITH its failed check, and the run names the line. A take nobody could listen
   * to is kept as UNCHECKED, said in the log.
   */
  /** How many recordings a line gets at most before its best take is kept with its failed check: the first and the automatic ones after a failed read-back. The quote of "Record again" holds all of them (`costOfTarget`). */
  const TAKE_ATTEMPTS = 3;
  function makeTake(filmId: string, lineId: string, actor: Actor, keepCurrent = false, within?: { first?: Heard; speakerHz?: number }): Promise<fm.Film> {
    return tracked(filmId, `line:${lineId}`, async () => {
      if (!available("tts")) throw failure("NO_ROUTE", "No way to obtain speech: connect a speech provider under Settings, Providers, Generation.", { details: { capability: "tts" } });
      const film = read(filmId), line = film.lines.find((entry) => entry.id === lineId);
      if (!line) throw failure("NOT_FOUND", "This line is no longer in the film.", { details: { id: lineId } });
      const voiceId = fm.voiceOf(film, line.speakerId), number = film.lines.indexOf(line) + 1;
      let best = within?.first, costUsd = within?.first?.costUsd ?? 0, gaveUp = false;
      for (let attempt = within?.first ? 1 : 0; attempt < TAKE_ATTEMPTS && !(best && best.check?.ok); attempt++) {
        let made: Made;
        try { made = await generate(actor, "tts", speechParams(film, [line]), `Line ${number}`, line.takes.length > 0 || attempt > 0, film); } catch (error) {
          // An AUTOMATIC recording after a failed read-back is never a new money question (the owner's rule: one action,
          // one approval): when what was approved does not hold it, the best take so far is kept with its failed check.
          if (best && !actor.run && moneyAsks(error)) { actor.log?.("warn", `Line ${number} was not recorded again: what was confirmed for it is used up. The best take is kept with its failed check.`); gaveUp = true; break; }
          throw error;
        }
        costUsd += made.costUsd;
        const seconds = (made.file.duration_ticks ?? 0) / pv.TICKS, bytes = deps.sync.blobs.read(made.file.blobId);
        let heard: string | undefined, why: fm.Unchecked["why"] = "no_listener";
        try {
          const listened = await listen(actor, { bytes, format: /\.mp3$/i.test(made.file.name) ? "mp3" : "wav", language: film.language, seconds });
          if (listened) { heard = listened.text; costUsd += listened.costUsd; }
        } catch (error) {
          // Listening is paid: a spending limit that refuses it stops the work like any other spending would.
          // (The read-back of an AUTOMATIC recording that what was confirmed does not hold: no new question — the recording is not judged, the best take so far stays.)
          if (best && !actor.run && moneyAsks(error)) { gaveUp = true; break; }
          if (stops(error)) { if (costUsd) mutate(filmId, [{ op: "spent.add", usd: costUsd }]); throw failure(String((error as { code?: string }).code), (error as Error).message, { details: (error as { details?: Record<string, unknown> }).details }); }
          why = "listener_failed"; actor.log?.("warn", `Line ${number} could not be listened to (${(error as Error).message.slice(0, 160)}).`); }
        let check = heard !== undefined ? fm.checkSpeech(line.text, seconds, heard) : fm.checkUnheard(line.text, seconds);
        // The same person as the speaker's other lines: measured, when this line is re-recorded out of the speaker's recording.
        const pcm = within?.speakerHz ? pcmOfWav(bytes) : undefined, lineHz = pcm ? medianPitch(pcm) : 0;
        if (check && lineHz) check = { ...check, pitchHz: lineHz, ...(check.ok && pitchDrift(lineHz, within!.speakerHz!) > PITCH_DRIFT_MAX ? { ok: false, reason: "voice" as const } : {}) };
        const next: Heard = { made, costUsd: 0, ...(check ? { check } : { unchecked: { seconds: Math.round(seconds * 100) / 100, why } }) };
        if (!best || rank(next) > rank(best)) best = next;
        if (check && !check.ok) actor.log?.("warn", `Line ${number} take ${attempt + 1} is not the line (${check.reason}; heard "${check.heard.slice(0, 80)}", ${check.seconds} s)${attempt < 2 ? " — recording it again." : "."}`);
        // Nobody can listen: recording again would not tell more.
        if (!check) { actor.log?.("warn", `Line ${number} was NOT listened to (${why === "no_listener" ? "no transcription model is on for this host" : "the listener failed"}): the take is kept unchecked.`); break; }
      }
      // The question a given-up automatic recording left with the gate is nobody's to answer: the action ends with the take that is kept.
      if (gaveUp && actor.action) deps.generation()?.gate.forget(actor.action);
      const kept = best!, take: fm.Take = { id: randomUUID().slice(0, 12), media: kept.made.file, costUsd, duration_ticks: kept.made.file.duration_ticks ?? pv.TICKS, stale: false, voiceId, created_ms: now(), ...takeVoice(film, line.speakerId), ...(kept.check ? { check: kept.check } : {}), ...(kept.unchecked ? { unchecked: kept.unchecked } : {}) };
      return mutate(filmId, [{ op: "line.take", id: lineId, take, keepCurrent }, { op: "spent.add", usd: costUsd }]);
    });
  }
  /**
   * All the given lines of ONE speaker in one recording, cut back into the lines: asked line by line, a speech model
   * picks how the voice sounds each time (age, accent, pitch); asked once, the speaker stays one person. Each line is
   * then listened to like any take, and its pitch is compared with the speaker's. When the recording cannot be laid
   * over the lines after two tries, the lines are recorded one by one instead — never guessed.
   */
  function makeSpeakerTakes(filmId: string, lineIds: readonly string[], actor: Actor): Promise<fm.Film> {
    return tracked(filmId, `speaker:${lineIds[0]}`, async () => {
      if (!available("tts")) throw failure("NO_ROUTE", "No way to obtain speech: connect a speech provider under Settings, Providers, Generation.", { details: { capability: "tts" } });
      const film = read(filmId), lines = lineIds.map((id) => film.lines.find((entry) => entry.id === id)).filter((entry): entry is fm.Line => !!entry);
      if (!lines.length) return film;
      const voiceId = fm.voiceOf(film, lines[0].speakerId), generation = deps.generation(), number = (line: fm.Line) => film.lines.indexOf(line) + 1;
      const who = lines[0].speakerId === fm.NARRATOR ? "Narrator" : film.characters.find((entry) => entry.id === lines[0].speakerId)?.name ?? "Speaker";
      let costUsd = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const made = await generate(actor, "tts", speechParams(film, lines), `Voice ${who}`, attempt > 0 || lines.some((line) => line.takes.length > 0), film);
        costUsd += made.costUsd;
        const pcm = pcmOfWav(deps.sync.blobs.read(made.file.blobId));
        if (!pcm || !generation) break;
        const pieces = splitAtPauses(pcm), heard: string[] = [];
        try {
          for (const piece of pieces) {
            const listened = await listen(actor, { bytes: wavFromPcm16(bytesOfPcm(pcm.samples.subarray(piece.from, piece.to)), pcm.rate, 1), format: "wav", language: film.language, seconds: (piece.to - piece.from) / pcm.rate });
            if (!listened) throw new Error("no provider can listen");
            heard.push(listened.text); costUsd += listened.costUsd;
          }
        } catch (error) { if (stops(error)) { if (costUsd) mutate(filmId, [{ op: "spent.add", usd: costUsd }]); throw failure(String((error as { code?: string }).code), (error as Error).message, { details: (error as { details?: Record<string, unknown> }).details }); } actor.log?.("warn", `${who}: the recording could not be listened to (${(error as Error).message.slice(0, 160)}); the lines are recorded one by one.`); break; }
        const laid = alignPieces(lines.map((line) => line.text), heard);
        if (!laid) { actor.log?.("warn", `${who}: the recording of ${lines.length} lines came back as ${pieces.length} pieces that do not match them${attempt < 1 ? " — recording again." : "; the lines are recorded one by one."}`); continue; }
        const speakerHz = medianPitch(pcm), ops: fm.FilmOp[] = [], again: { line: fm.Line; first: Heard }[] = [];
        lines.forEach((line, index) => {
          const span = laid[index], samples = pcm.samples.subarray(pieces[span.from].from, pieces[span.to - 1].to), seconds = samples.length / pcm.rate;
          const stored = deps.sync.blobs.put(wavFromPcm16(bytesOfPcm(samples), pcm.rate, 1), { mime: "audio/wav", name: `Line ${number(line)}.wav`, purpose: "media" });
          const lineHz = medianPitch({ samples, rate: pcm.rate }), verdict = fm.checkSpeech(line.text, seconds, heard.slice(span.from, span.to).join(" "));
          const check: fm.SpeechCheck = { ...verdict, ...(lineHz ? { pitchHz: lineHz } : {}), ...(verdict.ok && pitchDrift(lineHz, speakerHz) > PITCH_DRIFT_MAX ? { ok: false, reason: "voice" as const } : {}) };
          const media: pv.MediaFile = { blobId: stored.sha256, name: `Line ${number(line)}.wav`, kind: "audio", bytes: stored.size, duration_ticks: Math.round(seconds * pv.TICKS), provenance: { ...made.file.provenance, prompt: line.text } };
          // A piece that is not its line (words, length, or another voice) is not kept as it is: the line is recorded
          // again by itself, with this piece as the first of its three tries.
          if (!check.ok) { again.push({ line, first: { made: { file: media, costUsd: 0, prompt: line.text }, check, costUsd: 0 } }); return; }
          ops.push({ op: "line.take", id: line.id, take: { id: randomUUID().slice(0, 12), media, costUsd: 0, duration_ticks: Math.round(seconds * pv.TICKS), stale: false, voiceId, created_ms: now(), ...takeVoice(film, line.speakerId), check } });
        });
        let last = mutate(filmId, [...ops, { op: "spent.add", usd: costUsd }]);
        for (const entry of again) {
          actor.log?.("warn", `${who}: line ${number(entry.line)} of the recording is not the line (${entry.first.check!.reason}) — recording it again by itself.`);
          last = await makeTake(filmId, entry.line.id, actor, false, { first: entry.first, ...(speakerHz ? { speakerHz } : {}) });
        }
        return last;
      }
      if (costUsd) mutate(filmId, [{ op: "spent.add", usd: costUsd }]);
      let last = read(filmId);
      for (const line of lines) last = await makeTake(filmId, line.id, actor);
      return last;
    });
  }
  function makeMusic(filmId: string, actor: Actor): Promise<fm.Film> {
    return tracked(filmId, "music", async () => {
      const film = read(filmId);
      if (film.music.mood === "none") throw failure("INVALID_PARAMS", "Choose a music mood first.", { details: { field: "musicMood" } });
      if (!available("music")) throw failure("NO_ROUTE", "No way to obtain music: connect a music provider under Settings, Providers, Generation.", { details: { capability: "music" } });
      const made = await generate(actor, "music", { prompt: `Instrumental background music, ${film.music.mood}. ${film.logline}`.trim().slice(0, 2000), instrumental: true }, "Music", !!film.music.current, film);
      return mutate(filmId, [{ op: "music.set", version: version(made) }, { op: "spent.add", usd: made.costUsd }]);
    });
  }
  // — clips: a shot's picture set in motion —
  /**
   * A film's shots become clips only when Model routing gives the Video role a profile and a model of it can serve
   * (W7): then every shot that has its picture is animated FROM that picture, so the people stay the same. Without it
   * a shot is its still, as before.
   */
  const videoOn = (): boolean => available("video") && deps.generation()?.routed("video") === true;
  /** The film's own output is assembled at 1080p (`fm.assembleFilm`): a clip is asked at that resolution when the model lists it, else at the highest it lists below it — unless the Video role's profile sets one (Model routing), which wins. */
  const FILM_RESOLUTION = 1080;
  /**
   * The request of one clip, as it is sent AND as it is quoted: the model's own lengths, shapes and resolutions
   * (its catalogue row, from the provider's list). The length is the shortest the model makes that covers `seconds`
   * (the frame's own length), else its longest — a shot longer than its clip holds the clip's last frame. Null: no
   * video model can serve.
   */
  function clipParams(film: fm.Film, seconds: number, words: string, stillBlobId?: string): GenerationParams | null {
    let prepared: ReturnType<GenerationService["prepare"]>;
    try { prepared = service().prepare({ capability: "video", params: { prompt: "a clip" } }); } catch { return null; }
    const meta = prepared.model.metadata, lengths = [...(meta.durations ?? [])].sort((a, b) => a - b), listed = meta.resolutions ?? [];
    const length = lengths.find((entry) => entry >= seconds - 1e-9) ?? lengths[lengths.length - 1];
    const sized = listed.map((entry) => ({ entry, lines: Number(/^(\d+)p$/i.exec(entry)?.[1] ?? NaN) })).filter((entry) => Number.isFinite(entry.lines) && entry.lines <= FILM_RESOLUTION).sort((a, b) => b.lines - a.lines)[0]?.entry ?? listed[0];
    const resolution = prepared.params.resolution ?? sized;
    return { prompt: words.trim().slice(0, 2000) || "The scene comes to life with gentle, natural movement.", ...(length !== undefined ? { durationSeconds: length } : {}), ...(resolution ? { resolution } : {}), aspectRatio: film.aspectRatio, ...(stillBlobId && (meta.frameImages ?? []).includes("first_frame") ? { referenceBlobIds: [stillBlobId] } : {}) };
  }
  /** The words a clip is asked with: how the frame moves (the script's `videoPrompt`), what happens in it, and the camera. */
  const clipWords = (panel: fm.Panel): string => [panel.videoPrompt, panel.action, panel.cameraMotion !== "static" ? `Camera: ${panel.cameraMotion.replace(/-/g, " ")}.` : "The camera stays still."].map((part) => part.trim()).filter(Boolean).join(" ");
  const panelSeconds = (panel: Pick<fm.Panel, "duration_ticks">): number => panel.duration_ticks / pv.TICKS;
  /** The shots a clip is still to be made for: those with a picture in use, not kept a still by a person, without a clip of THAT picture (`all`: every shot with a picture). */
  const missingClips = (film: fm.Film, all: boolean): fm.Panel[] => fm.orderedPanels(film).filter((panel) => !!panel.picture.current && !panel.picture.stale && panel.leftOut !== true && panel.still !== true && (all || !fm.clipOf(panel)));
  /** One shot's picture set in motion: a video job started from the frame's picture in use. */
  function makeClip(filmId: string, panelId: string, actor: Actor): Promise<fm.Film> {
    return tracked(filmId, `clip:${panelId}`, async () => {
      const film = read(filmId), panel = film.panels.find((entry) => entry.id === panelId);
      if (!panel) throw failure("NOT_FOUND", "This panel is no longer in the film.", { details: { id: panelId } });
      if (!videoOn()) throw failure("NO_ROUTE", "No way to obtain video clips: give the Video role a model under Settings, Model routing (its provider must be connected under Settings, Providers, Generation).", { details: { capability: "video" } });
      const picture = panel.picture.current;
      if (!picture || panel.picture.stale) throw failure("INVALID_PARAMS", "This frame has no picture to start a clip from. Draw it first.", { details: { panelId } });
      const params = clipParams(film, panelSeconds(panel), clipWords(panel), picture.media.blobId);
      if (!params) throw failure("NO_ROUTE", "No video model can serve right now.", { details: { capability: "video" } });
      // A model that does not start from a picture would make strangers: the shot stays its still, and that is said.
      if (!params.referenceBlobIds?.length) throw failure("INVALID_PARAMS", "The video model in use does not start a clip from a picture, so the people of this film would not stay the same. Choose a model that takes a first frame under Settings, Model routing.", { details: { capability: "video", reason: "no_first_frame" } });
      const made = await generate(actor, "video", params, `Shot ${fm.orderedPanels(film).indexOf(panel) + 1}`, !!panel.clip, film);
      const clip: fm.PanelClip = { ...version(made), pictureId: picture.id, duration_ticks: made.file.duration_ticks ?? Math.round((params.durationSeconds ?? 0) * pv.TICKS) };
      return mutate(filmId, [{ op: "panel.clip", id: panelId, clip }, { op: "spent.add", usd: made.costUsd }]);
    });
  }
  /** The gate (or the run's guard) refused a request because what was confirmed does not hold it: a money question. */
  const moneyAsks = (error: unknown): boolean => isSpendStop(error) || (String((error as { code?: string }).code) === "BUDGET_EXCEEDED" && (error as { details?: { reason?: string } }).details?.reason === "confirmation_required");
  const stops = (error: unknown): boolean => ["BUDGET_EXCEEDED", "CANCELLED", "UNAVAILABLE", "NO_ROUTE", "PERMISSION_DENIED"].includes(String((error as { code?: string }).code));
  /**
   * Makes several things `limit` at a time. One that fails does not stop the others; a spending limit, a missing
   * provider or a cancel does. What was made stays in the film either way.
   */
  async function batch<T>(items: readonly T[], limit: number, work: (item: T) => Promise<unknown>): Promise<{ made: number; failed: { message: string; code?: string }[]; stop?: unknown }> {
    let next = 0, made = 0, stop: unknown;
    const failed: { message: string; code?: string }[] = [];
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop) {
        const item = items[next++];
        try { await work(item); made += 1; } catch (error) { if (stops(error)) stop ??= error; else failed.push({ message: (error as Error).message, code: String((error as { code?: string }).code ?? "") }); }
      }
    }));
    return { made, failed, ...(stop ? { stop } : {}) };
  }
  /**
   * Draws panels scene by scene: the panels of one scene one after the other, in order, because each is drawn with the
   * frame before it as a reference; up to four scenes at a time. The outcome counts panels, like `batch`.
   */
  async function drawPanels(filmId: string, panels: readonly fm.Panel[], actor: Actor): Promise<Awaited<ReturnType<typeof batch>>> {
    const scenes = new Map<string, fm.Panel[]>(), failed: { message: string; code?: string }[] = [];
    for (const panel of panels) scenes.set(panel.clipId, [...(scenes.get(panel.clipId) ?? []), panel]);
    let made = 0;
    const outcome = await batch([...scenes.values()], 4, async (scene) => {
      for (const panel of scene) {
        try { await makePanel(filmId, panel.id, actor); made += 1; } catch (error) { if (stops(error)) throw error; failed.push({ message: (error as Error).message, code: String((error as { code?: string }).code ?? "") }); }
      }
    });
    return { made, failed, ...(outcome.stop ? { stop: outcome.stop } : {}) };
  }
  const missingAssets = (film: fm.Film, all: boolean) => assetsOf(film).filter((entry) => all || !entry.asset.picture.current);
  /** A frame a person left out is not "missing": only "all" draws it again. */
  /** A frame has its picture when it has one that is not outdated: a frame whose words changed since it was drawn is drawn again like one that was never drawn. */
  const undrawn = (panel: fm.Panel): boolean => !panel.picture.current || panel.picture.stale;
  const missingPanels = (film: fm.Film, all: boolean, clipId?: string) => fm.orderedPanels(film).filter((panel) => (all || (undrawn(panel) && panel.leftOut !== true)) && (!clipId || panel.clipId === clipId));
  /** The clips a RUN still has to make: of the shots that have their picture now, and of those it will draw first. */
  const clipsToMake = (film: fm.Film): fm.Panel[] => (videoOn() ? fm.orderedPanels(film).filter((panel) => panel.leftOut !== true && panel.still !== true && !fm.clipOf(panel)) : []);
  const missingLines = (film: fm.Film, all: boolean) => film.lines.filter((line) => { const take = fm.activeTake(line); return all || !take || take.stale; });
  function makeMany(filmId: string, wanted: Exclude<Extract<Target, { scope: string }>, { kind: "clips" }> | Extract<Target, { kind: "speaker" }> | Extract<Target, { kind: "clips" }>, actor: Actor) {
    const film = read(filmId), all = wanted.kind === "speaker" || wanted.scope === "all";
    if (wanted.kind === "assets") return batch(missingAssets(film, all), 4, (entry) => makeAsset(filmId, entry.kind, entry.asset.id, actor));
    if (wanted.kind === "panels") return drawPanels(filmId, missingPanels(film, all, wanted.clipId), actor);
    if (wanted.kind === "clips") return batch(missingClips(film, all), 2, (panel) => makeClip(filmId, panel.id, actor));
    // One speaker again: every line of theirs in one recording, so the voice is one person from the first line to the last.
    if (wanted.kind === "speaker") return batch(voiceJobs(film.lines.filter((line) => line.speakerId === wanted.speakerId)), 2, (lines) => (lines.length > 1 ? makeSpeakerTakes(filmId, lines.map((line) => line.id), actor) : makeTake(filmId, lines[0].id, actor)));
    // "Keep current take" adds a take beside the one in use, line by line; otherwise each speaker is recorded once.
    if (wanted.keepCurrent === true) return batch(missingLines(film, all), 2, (line) => makeTake(filmId, line.id, actor, true));
    return batch(voiceJobs(missingLines(film, all)), 2, (lines) => (lines.length > 1 ? makeSpeakerTakes(filmId, lines.map((line) => line.id), actor) : makeTake(filmId, lines[0].id, actor)));
  }
  /**
   * The recordings a set of lines needs: one per speaker (cut back into the lines), so a speaker sounds like one
   * person; a speaker with more text than one request takes is recorded in parts, a single line on its own.
   */
  function voiceJobs(todo: readonly fm.Line[]): fm.Line[][] {
    // A speaker's recording is cut back into its lines by what a listener HEARS in it: with nobody to listen on this
    // host it cannot be, so every line is a recording of its own from the start — the one plan the estimate and the
    // work both follow (asking for the whole first would be a request that is paid for and thrown away).
    if (!deps.generation()?.listener()) return todo.map((line) => [line]);
    const groups = new Map<string, fm.Line[]>(), jobs: fm.Line[][] = [];
    // One recording has one pace: the lines of a speaker that are read at another rate are a recording of their own.
    for (const line of todo) { const key = `${line.speakerId}\n${line.rate}`; groups.set(key, [...(groups.get(key) ?? []), line]); }
    for (const lines of groups.values()) {
      let part: fm.Line[] = [], size = 0;
      for (const line of lines) { if (part.length && size + line.text.length > 3000) { jobs.push(part); part = []; size = 0; } part.push(line); size += line.text.length + 2; }
      if (part.length) jobs.push(part);
    }
    return jobs;
  }

  // — the timeline —
  /** The film as an editor project in the host's document store. The same film is the same project. */
  function assemble(filmId: string, withoutMissing: boolean, principal: string): fm.Film {
    const film = read(filmId), hash = wf.hashOf(fm.assemblyKey(film, withoutMissing)), hex = createHash("sha256").update(`${film.id}:${hash}`).digest("hex");
    const projectId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const ref = { kind: "project" as const, id: projectId }, existing = deps.sync.documents.row(ref);
    if (film.project?.hash === hash && existing?.state === "active") return film.stale.includes("timeline") ? mutate(filmId, [{ op: "project.set", project: film.project }]) : film;
    const built = fm.assembleFilm({ film, projectId, runId: film.id, hash, withoutMissing }, { now_ms: now(), newId: randomUUID, writer: { id: principal }, registries: { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() } });
    if (!existing || existing.state === "purged") {
      const stored = deps.sync.blobs.put(gzipSync(Buffer.from(canonicalJson(built.document), "utf8")), { mime: "application/gzip", name: `project-${projectId}-r1.json.gz`, purpose: "snapshot" });
      deps.sync.documents.enable(ref, stored.sha256, built.document.schemaVersion, { kind: "host", principal });
    }
    return mutate(filmId, [{ op: "project.set", project: built.project }]);
  }

  // — what the rest of the film costs —
  /**
   * The voices the film's speakers are cast from: those of the speech model that will speak, that read the film's
   * language — the ones made for that language first (a `vi-VN` voice for a Vietnamese film), then the ones that read
   * any language. A voice made for another language is offered only when nothing else is.
   */
  function speakingVoices(language: string): { offered: fm.VoiceOption[]; all: Set<string> } {
    const generation = deps.generation(), none = { offered: [], all: new Set<string>() };
    if (!generation || !available("tts")) return none;
    // The voices of the ONE model that will speak (the Voice role of ORC, else the recommended reader) — a voice of
    // another enabled model would be refused by the model that is actually asked.
    let model: GenerationModel;
    try { model = generation.prepare({ capability: "tts", params: { text: "a line" } }).model; } catch { return none; }
    const all = model.metadata.voices ?? [], native = all.filter((voice) => !voice.languages.includes("multi") && speaks(voice.languages, language)), any = all.filter((voice) => voice.languages.includes("multi"));
    return { all: new Set(all.map((voice) => voice.voiceId)), offered: (native.length || any.length ? [...native, ...any] : all).map((voice) => ({ voiceId: voice.voiceId, name: voice.name, gender: voice.gender === "female" || voice.gender === "male" ? voice.gender : "neutral", tags: voice.tags ?? [] })) };
  }
  const availableVoices = (language: string): fm.VoiceOption[] => speakingVoices(language).offered;
  /**
   * Casts the voices of a film's speakers through the same ops the Voice screen's picker uses: a character op and, for
   * the narrator, `film.set`. A speaker with no voice is cast; so is one whose AUTOMATIC voice the model that will
   * speak now does not have (the Voice role was moved to another model — its old voice would be refused). A voice a
   * person picked is theirs: it is never replaced here. Applying it again is a no-op.
   */
  function castSpeakers(filmId: string): fm.Film {
    const film = read(filmId), ops = castOps(film);
    return ops.length ? mutate(filmId, ops) : film;
  }
  /**
   * The film with the voices casting WILL give (nothing is stored): what a recording is really asked with, so an
   * estimate is of the request that goes out — not of the film as it stands before `castSpeakers` runs.
   */
  function projectedCast(film: fm.Film): fm.Film {
    let next = film;
    for (const op of castOps(film)) {
      if (op.op === "asset.update" && op.kind === "character") next = { ...next, characters: next.characters.map((entry) => (entry.id === op.id ? { ...entry, ...(op.fields as Partial<fm.Character>) } : entry)) };
      else if (op.op === "film.set") next = { ...next, ...(op.fields as Partial<fm.Film>) };
    }
    return next;
  }
  /** The changes casting makes to a film, as the ops of the Voice screen's picker; none when nothing is to cast. */
  function castOps(film: fm.Film): fm.FilmOp[] {
    const { offered, all } = speakingVoices(film.language);
    // Nothing happens when the host offers no voices (no speech provider): casting waits for the voice stage.
    if (!offered.length) return [];
    // The characters who speak are cast, and the narrator; one with no line gets no voice.
    const speaking = new Set(film.lines.map((line) => line.speakerId));
    const open = (voiceId: string, auto: boolean): boolean => !voiceId || (auto && !all.has(voiceId));
    if (film.characters.every((entry) => !speaking.has(entry.id) || !open(entry.voiceId, entry.voiceAuto)) && !open(film.narratorVoiceId, film.narratorVoiceAuto)) return [];
    // A voice that is being replaced is not "kept": the casting sees those speakers as unassigned.
    const cast = fm.castVoices(film.characters.map((entry) => (open(entry.voiceId, entry.voiceAuto) ? { ...entry, voiceId: "" } : entry)), film.lines, offered, open(film.narratorVoiceId, film.narratorVoiceAuto) ? "" : film.narratorVoiceId);
    if (!cast) return [];
    const ops: fm.FilmOp[] = [];
    for (const entry of cast.characters) {
      const character = film.characters.find((found) => found.id === entry.id);
      if (character && open(character.voiceId, character.voiceAuto) && character.voiceId !== entry.voiceId) ops.push({ op: "asset.update", kind: "character", id: entry.id, fields: { voiceId: entry.voiceId, voiceAuto: true } });
    }
    if (cast.narratorVoiceId && open(film.narratorVoiceId, film.narratorVoiceAuto) && cast.narratorVoiceId !== film.narratorVoiceId) ops.push({ op: "film.set", fields: { narratorVoiceId: cast.narratorVoiceId, narratorVoiceAuto: true } });
    return ops;
  }
  type Unit = { usd: number; label: string; provider: string; /** The model as the spend gate names it. */ name: string; /** false: the model has no price — the cost is not known. */ known: boolean; /** The duration of the longest supported clip requested by the film's video plan. */ maxClipSeconds?: number };
  function unit(capability: GenerationCapability, params: GenerationParams): Unit | null {
    if (!available(capability)) return null;
    try { const prepared = service().prepare({ capability, params }); return { usd: prepared.estimate.amountUsd ?? 0, label: prepared.model.label, provider: prepared.model.provider, name: modelName(prepared.model.provider, prepared.model.id), known: prepared.estimate.amountUsd !== null }; } catch { return null; }
  }
  /** What one job of each kind costs on the model the host would use now, and what a reference picture adds to a frame. */
  function prices(film: fm.Film) {
    const image = unit("image", { prompt: "a picture", aspectRatio: pv.imageAspect(film.aspectRatio), quality: FILM_IMAGE_QUALITY }) ?? unit("image", { prompt: "a picture", quality: FILM_IMAGE_QUALITY }), speech = unit("tts", { text: "One spoken line of the script, of ordinary length." }), music = unit("music", { prompt: "music", instrumental: true });
    // A panel is drawn with reference pictures, and each costs: the sheets of what it shows (they exist by the time it
    // is drawn) and the frame before it in its scene, as many as the model takes.
    let reference = { usd: 0, most: 0 };
    try { const model = service().prepare({ capability: "image", params: { prompt: "a picture" } }).model; reference = { usd: model.pricing?.kind === "per_image" ? model.pricing.referenceUsd ?? 0 : 0, most: model.metadata.referenceImages ?? 0 }; } catch { /* no route: the row has no price */ }
    /**
     * The voice as it will be SENT: the recordings the lines need (`voiceJobs` — a speaker's lines in one request — or
     * line by line), each priced by its own text; and the read-back of every line — of a recording that does not exist
     * yet, so at the listener's price where that does not depend on the recording's length, else "price not known".
     * `usd` null: the model has no price. Undefined: no model for it on this host.
     */
    const cast = projectedCast(film);
    const priced = (params: GenerationParams, fresh: boolean): number | null => { const prepared = service().prepare({ capability: "tts", reuse: true, ...(fresh ? { cache: "bypass" as const } : {}), params: acceptedParams({ capability: "tts", reuse: true }, params) }); return prepared.hit ? 0 : prepared.estimate.amountUsd; };
    const voiceOf = (lines: readonly fm.Line[], grouped = true, /** Every recording is a new one (an automatic recording after a failed read-back is never the cached one). */ again = false): { count: number; usd: number | null } => {
      let usd: number | null = 0;
      if (speech) for (const job of grouped ? voiceJobs(lines) : lines.map((line) => [line])) {
        // Asked as the recording will be: in the voice casting gives the speaker (`cast`), fresh when the line has a take already — only then is a cached recording the one that is used, and free.
        let next: number | null;
        try { next = priced(speechParams(cast, job), again || job.some((line) => line.takes.length > 0)); } catch { next = null; }
        usd = usd === null || next === null ? null : usd + next;
      }
      return { count: lines.length, usd };
    };
    const listener = deps.generation()?.listener(undefined, film.language), listening: Unit | null = listener ? { usd: listener.estimateUsd ?? 0, label: listener.modelLabel, provider: listener.provider, name: modelName(listener.provider, listener.model), known: listener.estimateUsd !== null } : null;
    const listeningOf = (lines: readonly fm.Line[]): { count: number; usd: number | null } => ({ count: lines.length, usd: !listening ? 0 : !listening.known ? null : listening.usd * lines.length });
    const referencesOf = (panels: readonly fm.Panel[]): number => panels.reduce((sum, panel) => sum + Math.min(reference.most, panel.characterIds.length + (panel.locationId ? 1 : 0) + panel.propIds.length + (film.panels.filter((entry) => entry.clipId === panel.clipId)[0]?.id === panel.id ? 0 : 1)), 0) * reference.usd;
    /** One recording of this many characters, as it is priced (for a plan that has no lines yet). */
    const speechOf = (characters: number): number | null => { try { return priced({ text: "x".repeat(Math.max(1, Math.min(2000, Math.round(characters)))), language: film.language }, true); } catch { return null; } };
    /**
     * The clips, each priced as its own request will be sent (`clipParams`: the model's length for the frame's own
     * length, the resolution, one picture). `clipsOf(panels)`: these frames; `clipsUpTo(count)`: that many frames of a
     * script that is not written yet, each at the longest a frame may be. Unit null: shots are not animated on this host.
     */
    const clipUnit = (seconds: number): Unit | null => {
      if (!videoOn()) return null;
      const params = clipParams(film, seconds, "a clip");
      if (!params) return null;
      try {
        // Priced without the picture's file (it may not be drawn yet); what the provider's list charges for the one picture a clip starts from is added as the list states it.
        const accepted = acceptedParams({ capability: "video" }, params);
        const prepared = service().prepare({ capability: "video", params: accepted }), pricing = prepared.model.pricing, picture = (prepared.model.metadata.frameImages ?? []).includes("first_frame") && pricing?.kind === "per_second" ? pricing.referenceUsd ?? 0 : 0;
        // A model whose list names no lengths is asked for none: what its clip costs cannot be said.
        const known = prepared.estimate.amountUsd !== null && params.durationSeconds !== undefined;
        return { usd: known ? exact(prepared.estimate.amountUsd! + picture) : 0, label: prepared.model.label, provider: prepared.model.provider, name: modelName(prepared.model.provider, prepared.model.id), known, ...(params.durationSeconds !== undefined ? { maxClipSeconds: params.durationSeconds } : {}) };
      } catch { return null; }
    };
    const video = clipUnit(fm.LIMITS.panelMax_ticks / pv.TICKS);
    const clipsOf = (panels: readonly fm.Panel[]): { count: number; usd: number | null } => { let usd: number | null = 0; for (const panel of panels) { const one = clipUnit(panelSeconds(panel)); usd = usd === null || !one || !one.known ? null : usd + one.usd; } return { count: panels.length, usd }; };
    return { image, speech, music, listening, referencesOf, voiceOf, listeningOf, reference, speechOf, video, clipsOf };
  }
  function estimate(filmId: string) {
    const film = read(filmId), { image, speech, music, listening, referencesOf, voiceOf, listeningOf, video, clipsOf } = prices(film), todo = missingPanels(film, false), lines = missingLines(film, false), voice = voiceOf(lines), heard = listeningOf(lines), clips = clipsOf(clipsToMake(film));
    // The voice and its read-back are the sums of the real requests; their "unit" is what one line comes to on average.
    const summed = (id: string, unit: Unit | null, sum: { count: number; usd: number | null }) => ({ id, count: sum.count, unitUsd: unit ? (sum.count && sum.usd !== null ? exact(sum.usd / sum.count) : unit.usd) : null, usd: unit ? round(sum.usd ?? 0) : null, model: unit?.label ?? "" });
    const rows = [
      ...[{ id: "assets", count: missingAssets(film, false).length, unit: image, extraUsd: 0 }, { id: "panels", count: todo.length, unit: image, extraUsd: referencesOf(todo) }].map((row) => ({ id: row.id, count: row.count, unitUsd: row.unit?.usd ?? null, usd: row.unit ? round(row.unit.usd * row.count + row.extraUsd) : null, model: row.unit?.label ?? "" })),
      // The shots set in motion — a row only when the Video role is routed on this host.
      ...(video ? [summed("clips", video, clips)] : []),
      summed("voice", speech, voice),
      // The read-back of every line that is recorded — a row only when a transcription model listens on this host.
      ...(listening ? [summed("listening", listening, heard)] : []),
      ...[{ id: "music", count: film.music.mood !== "none" && !film.music.current ? 1 : 0, unit: music }].map((row) => ({ id: row.id, count: row.count, unitUsd: row.unit?.usd ?? null, usd: row.unit ? round(row.unit.usd * row.count) : null, model: row.unit?.label ?? "" })),
    ];
    let blocked: { scope?: string; remainingUsd?: number } | undefined;
    if (image) { try { const found = service().prepare({ capability: "image", params: { prompt: "a picture", quality: FILM_IMAGE_QUALITY } }).estimate.blocked; if (found?.reason === "budget_exceeded") blocked = { scope: found.scope, remainingUsd: found.remainingUsd }; } catch { /* no route: the capability is listed as missing */ } }
    // Who writes and who looks: what each role of Model routing resolves to right now — the model, none (the role has
    // no profile: the writing falls back to the model of the person's composer; pictures are not checked), or why it cannot serve.
    const writing = (["screenwriter", "storyboard", "vision"] as const).map((role) => {
      try { const routed = deps.roleModel?.(role); return { role, model: routed ? { runtimeId: routed.runtimeId, providerId: routed.providerId, modelId: routed.modelId, label: routed.modelId } : null, ...(routed?.params && Object.keys(routed.params).length ? { optionsNotApplied: Object.keys(routed.params) } : {}) }; } catch (error) { return { role, model: null, problem: (error as Error).message.slice(0, 300) }; }
    });
    const generation = deps.generation(), total = round(rows.reduce((sum, row) => sum + (row.usd ?? 0), 0));
    const capabilityProblems: Partial<Record<"image" | "video" | "tts" | "music" | "transcription", string>> = {};
    const routedChecks = [
      ["image", { prompt: "a picture" }], ["video", { prompt: "a clip", durationSeconds: 4 }], ["tts", { text: "A voice sample." }],
      ["music", { prompt: "a music cue" }], ["transcription", {}],
    ] as const;
    for (const [capability, params] of routedChecks) {
      if (!generation?.routed(capability)) continue;
      try { service().prepare({ capability, params }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        capabilityProblems[capability] = message.replace(/^Model routing gives [^:]+ no usable model: /, "").replace(/\. Change the role under Settings, Model routing\.?$/, "");
      }
    }
    return { rows, writing, totalUsd: total, spentUsd: film.spentUsd, capabilities: { image: !!image, speech: !!speech, music: !!music, video: !!video },
      ...(Object.keys(capabilityProblems).length ? { capabilityProblems } : {}),
      // What the voice model in use takes beside the text (its catalogue row, from the provider's documentation): the screens offer an accent or a voice sample only where it reaches the model.
      voice: voiceFacts(), voices: availableVoices(film.language).slice(0, 200), ...(blocked ? { blocked } : {}), ...(generation ? { confirmAboveUsd: generation.thresholds().confirmAboveUsd } : {}) };
  }

  // — money. The RULE is not here: it is the generation service's SPEND GATE (`generation/spend-gate.ts`). A person
  // approves an ACTION — the whole run, or one action of a screen (a single file or a batch) — by the quote they are
  // shown; every paid request of it (a picture, its redraws, a recording, its read-back, the music, a turn of the model
  // that writes the script or looks at a frame) then passes through the gate under that action. This file says what an
  // action will make (the quote), and turns a stop of the gate into the refusal the screens and the engine know. —
  type CostPart = { id: "pictures" | "video" | "voice" | "listening" | "music" | "writing" | "vision"; label: string; count: number; usd: number | null; model: string; /** The maximum shot length in the pre-script video plan; describes the quoted ceiling without changing its price. */ maxClipSeconds?: number };
  /**
   * The turns of a runtime's model the action will pay for: `count` of them, `usd` the most they can cost together when
   * the host knows the model's price (a row of the estimate, in its sum); null when it does not — then the model is
   * NAMED in the quote ("price not known") and approved by name.
   */
  type TurnPart = { id: "writing" | "vision"; label: string; model: string; name: string; count: number; usd: number | null; /** Ruling R9: runs on the person's own account — told, never quoted. */ own?: true; /** The name a person knows that account's runtime by ("Claude Code"). */ runtime?: string };
  type Cost = { /** Ruling R9: the work that runs on the person's own signed-in account (not billed by this app): told beside the quote, no part of it. */ ownAccount: { label: string; model: string; runtime?: string }[]; amountUsd: number | null; breakdown: CostPart[]; models: string[]; providerIds: string[]; /** For the gate: every model by its name, those without a known price, and the sum of what has one. */ names: string[]; unpriced: string[]; pricedUsd: number; turns: TurnPart[] };
  /** The estimate a confirmation shows: pictures, voice and music with their models, and their sum (null when a model has no price). */
  /** An estimate keeps the precision of the prices: a few spoken lines cost less than a hundredth of a cent, and are still not nothing. */
  const exact = (amount: number): number => Math.round(amount * 1e6) / 1e6;
  /** `sumUsd`: the part's cost was added up request by request (the voice, its read-back) — it is not `count` times the unit. */
  function costOf(parts: { id: Exclude<CostPart["id"], "writing" | "vision">; count: number; unit: Unit | null; extraUsd?: number; sumUsd?: number | null; maxClipSeconds?: number }[], turns: (TurnPart | undefined)[] = []): Cost {
    const labels = { pictures: "Pictures", video: "Video clips", voice: "Voice", listening: "Listening", music: "Music" } as const, breakdown: CostPart[] = [], providerIds = new Set<string>(), names = new Set<string>(), unpriced = new Set<string>(), paid = turns.filter((turn): turn is TurnPart => !!turn);
    for (const part of parts.filter((entry) => entry.count > 0 && entry.unit)) {
      const unit = part.unit!, usd = !unit.known ? null : part.sumUsd !== undefined ? part.sumUsd : unit.usd * part.count + (part.extraUsd ?? 0), found = breakdown.find((entry) => entry.id === part.id);
      providerIds.add(unit.provider); names.add(unit.name);
      if (usd === null) unpriced.add(unit.name);
      if (found) { found.count += part.count; found.usd = found.usd === null || usd === null ? null : exact(found.usd + usd); } else breakdown.push({ id: part.id, label: labels[part.id], count: part.count, usd: usd === null ? null : exact(usd), model: unit.label, ...(part.maxClipSeconds !== undefined ? { maxClipSeconds: part.maxClipSeconds } : {}) });
    }
    for (const turn of paid) {
      // Ruling R9: a turn on the person's own account is in no quote — not a row, not a model to approve, not "price not known".
      if (turn.own) continue;
      names.add(turn.name);
      if (turn.usd === null) unpriced.add(turn.name); else breakdown.push({ id: turn.id, label: turn.label, count: turn.count, usd: exact(turn.usd), model: turn.model });
    }
    return { amountUsd: breakdown.some((entry) => entry.usd === null) ? null : exact(breakdown.reduce((sum, entry) => sum + entry.usd!, 0)), breakdown, models: [...new Set(breakdown.map((entry) => entry.model))], providerIds: [...providerIds], names: [...names], unpriced: [...unpriced], pricedUsd: exact(breakdown.reduce((sum, entry) => sum + (entry.usd ?? 0), 0)), turns: paid.filter((turn) => turn.usd === null && !turn.own), ownAccount: paid.filter((turn) => turn.own).map((turn) => ({ label: turn.label, model: turn.model, ...(turn.runtime ? { runtime: turn.runtime } : {}) })) };
  }
  /**
   * Who writes — the role's model (Storyboard for the script, Screenwriter for the story), else the model the person's
   * composer is on, else the Director — and what ONE turn of it costs as far as the host can say (`turnUsd`).
   */
  /** The Director's model (Model routing): who writes when no writing role has one and none was sent. Undefined: the Director has none either. */
  const directorModel = (): Routed | undefined => { try { return deps.roleModel?.("director") ?? undefined; } catch { return undefined; } };
  /** The name of the person's own account a model runs on ("Claude Code") — only for a runtime the gate classifies as their own sign-in. */
  const accountOf = (ref: { runtimeId?: string; providerId: string; modelId: string } | undefined): string | undefined => { const gate = deps.generation()?.gate; return ref?.runtimeId && gate?.billingOf({ ref }) === "own_account" ? gate.accountOf(ref.runtimeId) : undefined; };
  const writingTurn = (model: z.infer<typeof modelRef> | null | undefined, role: "storyboard" | "screenwriter", message: string, filmId: string): TurnPart => {
    let routed: Routed | undefined;
    try { routed = deps.roleModel?.(role) ?? undefined; } catch { /* the role cannot serve: the step that writes says so */ }
    // No writing role routed and no model sent: the DIRECTOR writes (`write` sends the turn to that role) — the quote is of the Director's model, by its name and by how it is billed.
    const ref = routed ?? model ?? directorModel(), named = ref ?? { providerId: "role", modelId: "director" };
    const bound = turnUsd(ref), runtime = bound.own ? accountOf(ref) : undefined;
    return { id: "writing", label: role === "screenwriter" ? "Writing the story" : "Writing the script", model: named.modelId, name: modelName(named.providerId, named.modelId, "runtime"), count: 1, usd: bound.usd, ...(bound.own ? { own: true as const } : {}), ...(runtime ? { runtime } : {}) };
  };
  /**
   * Who looks at the frames: the Vision role's model, once for each of `panels` (or of `count` frames of a script that
   * is not written yet). Undefined when none is routed (the frames are then not checked).
   */
  const visionTurn = (film: fm.Film, panels: readonly fm.Panel[] | number): TurnPart | undefined => {
    let routed: Routed | undefined;
    try { routed = deps.roleModel?.("vision") ?? undefined; } catch { /* the role cannot serve: the step that draws says so */ }
    const count = typeof panels === "number" ? panels : panels.length;
    if (!routed || count <= 0) return undefined;
    const bound = turnUsd(routed), each = bound.usd, runtime = bound.own ? accountOf(routed) : undefined;
    return { id: "vision", label: "Checking the pictures", model: routed.modelId, name: modelName(routed.providerId, routed.modelId, "runtime"), count, usd: each === null ? null : each * count, ...(bound.own ? { own: true as const } : {}), ...(runtime ? { runtime } : {}) };
  };
  /**
   * Everything of the film that is still to be made: what a whole run costs from here. A film whose script is not
   * written yet is quoted by the PLAN of its story (`fm.upperPlan`: the most sheets, frames and lines a script of this
   * story may have — the writer is held to it — each frame with as many reference pictures as a request takes),
   * together with the turn of the model that writes the script and one look at each frame: ONE quote for the whole
   * run, up front. The approval of that quote is an AMOUNT for the whole action, not a count of requests (coordinator's
   * ruling R2, 2026-10-08): a second try of something the plan holds — a frame drawn again after the picture check
   * and looked at again, a line recorded again after its read-back, a correction of the script — is part of the same
   * action and spends from the same amount. The person is asked again only when what the run has spent would pass
   * its guard (120 % of what was confirmed) — or for what is OUTSIDE the action: another model, an item the plan
   * does not hold.
   */
  function costOfRest(filmId: string, model?: z.infer<typeof modelRef> | null): Cost & { upper?: fm.UpperPlan } {
    const film = read(filmId), { image, speech, music, listening, referencesOf, voiceOf, listeningOf, reference, speechOf, video, clipsOf } = prices(film), scripted = film.panels.length > 0 && film.scriptStale !== true;
    const tune = { id: "music" as const, count: film.music.mood !== "none" && !film.music.current ? 1 : 0, unit: music };
    if (!scripted) {
      const upper = fm.upperPlan(film.sourceText, film.language), each = upper.spokenCharacters / upper.lines, one = speech ? speechOf(each) : 0, heard = listening ? (listening.known ? listening.usd : null) : 0;
      // (The clips of a script that is not written yet: one for each frame the plan may have, each at the longest a frame may be.)
      return { ...costOf([{ id: "pictures", count: upper.assets, unit: image }, { id: "pictures", count: upper.panels, unit: image, extraUsd: upper.panels * Math.min(reference.most, fm.PANEL_REFERENCES_MAX) * reference.usd }, { id: "video", count: video ? upper.panels : 0, unit: video, ...(video?.maxClipSeconds !== undefined ? { maxClipSeconds: video.maxClipSeconds } : {}) }, { id: "voice", count: upper.lines, unit: speech, sumUsd: one === null ? null : one * upper.lines }, { id: "listening", count: speech ? upper.lines : 0, unit: listening, sumUsd: heard === null ? null : heard * upper.lines }, tune],
        [writingTurn(model, "storyboard", breakdownPrompt(film), filmId), image ? visionTurn(film, upper.panels) : undefined]), upper };
    }
    const todo = missingPanels(film, false), lines = missingLines(film, false), voice = voiceOf(lines), heard = listeningOf(lines), clips = clipsOf(clipsToMake(film));
    return costOf([{ id: "pictures", count: missingAssets(film, false).length, unit: image }, { id: "pictures", count: todo.length, unit: image, extraUsd: referencesOf(todo) }, { id: "video", count: video ? clips.count : 0, unit: video, sumUsd: clips.usd }, { id: "voice", count: voice.count, unit: speech, sumUsd: voice.usd }, { id: "listening", count: speech ? heard.count : 0, unit: listening, sumUsd: heard.usd }, tune],
      [image ? visionTurn(film, todo) : undefined]);
  }
  /** What one action of a screen makes. */
  function costOfTarget(film: fm.Film, wanted: Target): Cost {
    const { image, speech, music, listening, referencesOf, voiceOf, listeningOf, video, clipsOf } = prices(film), all = wanted.kind === "speaker" || ("scope" in wanted && wanted.scope === "all");
    if (wanted.kind === "clip" || wanted.kind === "clips") { const panels = wanted.kind === "clip" ? film.panels.filter((panel) => panel.id === wanted.id) : missingClips(film, all), clips = clipsOf(panels); return costOf([{ id: "video", count: clips.count, unit: video, sumUsd: clips.usd }]); }
    if (wanted.kind === "asset") return costOf([{ id: "pictures", count: 1, unit: image }]);
    if (wanted.kind === "assets") return costOf([{ id: "pictures", count: missingAssets(film, all).length, unit: image }]);
    if (wanted.kind === "panel" || wanted.kind === "panels") { const panels = wanted.kind === "panel" ? film.panels.filter((panel) => panel.id === wanted.id) : missingPanels(film, all, wanted.clipId); return costOf([{ id: "pictures", count: panels.length, unit: image, extraUsd: referencesOf(panels) }], [image ? visionTurn(film, panels) : undefined]); }
    if (wanted.kind === "music") return costOf([{ id: "music", count: 1, unit: music }]);
    // The lines this action records, in the requests it sends them in (`makeMany`): "keep current take" and a single line go line by line.
    const lines = wanted.kind === "line" ? film.lines.filter((line) => line.id === wanted.id) : wanted.kind === "speaker" ? film.lines.filter((line) => line.speakerId === wanted.speakerId) : missingLines(film, all);
    const voice = voiceOf(lines, !(wanted.kind === "line" || (wanted.kind === "lines" && wanted.keepCurrent === true))), heard = listeningOf(lines);
    // ONE line ("Record again"): the action is the recording, its read-back AND the automatic recordings after a failed
    // check (`TAKE_ATTEMPTS` in all, each listened to) — the one approval holds all of them, so the action never comes
    // back with a second question; what is charged is what was really made.
    if (wanted.kind === "line") { const more = voiceOf(lines, false, true), times = TAKE_ATTEMPTS - 1; return costOf([{ id: "voice", count: voice.count, unit: speech, sumUsd: voice.usd === null || more.usd === null ? null : voice.usd + more.usd * times }, { id: "listening", count: speech ? heard.count : 0, unit: listening, sumUsd: heard.usd === null ? null : heard.usd * TAKE_ATTEMPTS }]); }
    return costOf([{ id: "voice", count: voice.count, unit: speech, sumUsd: voice.usd }, { id: "listening", count: speech ? heard.count : 0, unit: listening, sumUsd: heard.usd }]);
  }
  const usd = usdText;
  const costWords = (cost: Cost): string => [...cost.breakdown.map((part) => `${part.label.toLowerCase()} ${part.usd === null ? "at an unknown price" : usd(part.usd)} (${part.count}, ${part.model})`), ...cost.turns.map((turn) => `${turn.label.toLowerCase()} at a price this host does not know (${turn.model})`)].join("; ");
  /** The estimate as the screens are shown it: the parts with a price and their sum, and — named, never counted as zero — what has none (`unpricedParts`). */
  /** `amountKind` (ruling R5): "total" — every part has a price and `amountUsd` is the whole; "subtotal_of_priced" — a part's price is not known (`unpricedParts`, or a row whose `usd` is null): the figure is the sum of the priced parts ONLY and bounds nothing of the whole. */
  /** (Review 15 #9) With a part of unknown price `amountUsd` IS the subtotal of the priced parts — a figure, as `amountKind` says — never null. */
  const estimateOf = (cost: Cost) => ({ amountUsd: cost.amountUsd ?? cost.pricedUsd, amountKind: cost.unpriced.length ? "subtotal_of_priced" as const : "total" as const, breakdown: cost.breakdown, models: cost.models, ...(cost.ownAccount.length ? { ownAccount: cost.ownAccount } : {}), ...(cost.turns.length ? { unpricedParts: cost.turns.map((turn) => ({ id: turn.id, label: turn.label, model: turn.model })) } : {}) });
  /** The quote of an action for the gate: the sum of what has a price, every model by name, and the ones whose price is not known. */
  const quoteOf = (cost: Cost, plan: string): Quote => service().gate.quote({ amountUsd: cost.pricedUsd, models: cost.names, unpriced: cost.unpriced, plan });
  /**
   * What a film's paid work is MADE FROM: the words and choices a person (or the script) set — and nothing that was
   * made from them (pictures, takes, verdicts, costs, times, a voice that casting chose by itself). Its hash is the
   * PLAN of every quote of the film (review 14 #8): a question is about these words, so an answer that arrives after
   * a line, a frame's words or the story changed is an answer to another question — the quote of now is asked.
   */
  const inputsOf = (film: fm.Film) => ({
    language: film.language, aspectRatio: film.aspectRatio, artStyle: film.artStyle, artStyleText: film.artStyleText, sourceText: film.sourceText, music: film.music.mood, narrator: film.narratorVoiceAuto ? null : film.narratorVoiceId,
    // (An accent, a voice sample or a shot kept a still is appended only where there is one: a film without any has the plan — and so the open questions — it had before these existed.)
    ...(film.accent && film.accentAuto === false ? { accent: film.accent } : {}),
    characters: film.characters.map((entry) => [entry.id, entry.name, entry.role, entry.age, entry.description, entry.appearance, entry.gender, entry.voiceAuto ? null : entry.voiceId, ...(entry.accent && entry.accentAuto === false ? [`accent:${entry.accent}`] : []), ...(entry.voiceSample ? [`sample:${entry.voiceSample.blobId}`] : [])]),
    locations: film.locations.map((entry) => [entry.id, entry.name, entry.description, entry.appearance]), props: film.props.map((entry) => [entry.id, entry.name, entry.description, entry.appearance]),
    panels: film.panels.map((panel) => [panel.id, panel.clipId, panel.shotSize, panel.cameraMotion, panel.action, panel.characterIds, panel.locationId, panel.propIds, panel.videoPrompt, panel.leftOut === true, ...(panel.still === true ? ["still"] : [])]),
    lines: film.lines.map((line) => [line.id, line.kind, line.speakerId, line.text, line.panelId, line.emotion, line.intensity, line.rate]),
  });
  /**
   * The pictures a directly started drawing will be drawn WITH (review 15 #8): for each frame of the target, the files
   * of the sheets and of the frame before it that go with the request (`fm.panelReferenceList` — the same list
   * `makePanel` sends, by the id of each file's bytes). Choosing another picture of a sheet while the question is open
   * changes what is sent, so it is another plan: the old answer approves nothing. (A run draws with pictures it makes
   * itself: its plan is the film's words.)
   */
  const referencesOf = (film: fm.Film, wanted: Target): unknown => {
    if (wanted.kind !== "panel" && wanted.kind !== "panels") return null;
    const panels = wanted.kind === "panel" ? film.panels.filter((panel) => panel.id === wanted.id) : missingPanels(film, wanted.scope === "all", wanted.clipId);
    return panels.map((panel) => [panel.id, fm.panelReferenceList(film, panel).slice(0, fm.PANEL_REFERENCES_MAX).map((entry) => entry.blobId)]);
  };
  const planOf = (kind: string, film: fm.Film, what: unknown = null): string => `${kind}:${createHash("sha256").update(canonicalJson([inputsOf(film), what])).digest("hex").slice(0, 24)}`;
  /**
   * The plan of a RUN's quote. A question that is open is about the film as it stands NOW (its words are in the plan:
   * an edit while it is open makes it another question). A run that was approved goes on under the plan it was approved
   * by — the script the run itself writes, and edits made while it runs, are held by its amount, not asked about anew.
   */
  const runPlan = (actionId: string, film: fm.Film): string => { const gate = service().gate; return gate.pending(actionId) ? planOf(RUN_ACTION.kind, film) : gate.action(actionId)?.approved?.plan || planOf(RUN_ACTION.kind, film); };
  /** Opens a run's action with the quote of now; a question it puts on record is bound to the film's words of now. */
  const openRun = (actionId: string, filmId: string, cost: Cost, more: { requote?: boolean; answer?: SpendAnswer } = {}) => {
    const gate = service().gate, open = () => gate.open({ fixedId: actionId, ...RUN_ACTION, owner: `film:${filmId}`, quote: quoteOf(cost, runPlan(actionId, read(filmId))), ...more });
    try { return open(); } catch (error) {
      // The question was put on record under the plan the run was approved by: asked again at once as a question about the film's words of now.
      if (isSpendStop(error) && error.question.at === "start" && error.question.plan !== planOf(RUN_ACTION.kind, read(filmId))) return open();
      throw error;
    }
  };
  /**
   * What "Make the film" cannot do without (review 14 #7), checked BEFORE the money question and before anything is
   * paid for: pictures, speech, and music when the film has a mood. Missing → said at once — which role, and where it
   * is set — and nothing is asked.
   */
  function needRoutes(film: fm.Film): void {
    const missing = ([["image", "Image", "pictures"], ["tts", "Voice", "speech"], ...(film.music.mood !== "none" && !film.music.current ? [["music", "Music", "music"] as const] : [])] as const).filter(([capability]) => !available(capability)).map(([capability, role, what]) => ({ capability, role, what }));
    if (missing.length) throw failure("NO_ROUTE", `This film cannot be made yet: nothing on this host makes ${missing.map((entry) => entry.what).join(" or ")}. Connect a provider under Settings, Providers, Generation, and give the ${missing.map((entry) => entry.role).join(", ")} role${missing.length === 1 ? "" : "s"} a model under Settings, Model routing. Nothing was asked and nothing was spent.`, { details: { reason: "route_missing", missing, filmId: film.id } });
  }
  const answerOf = (input: { confirmed?: true; actionId?: string; quoteId?: string }): SpendAnswer => ({ confirmed: input.confirmed === true, ...(input.actionId ? { actionId: input.actionId } : {}), ...(input.quoteId ? { quoteId: input.quoteId } : {}) });
  /** The action of the gate a pipeline run spends under. Its share is the spec's: the run stops and asks at 120 % of what was approved. */
  const runAction = (runId: string): string => `film.run:${runId}`;
  const RUN_ACTION = { kind: "film.run", share: fm.CONFIRMED_SHARE } as const;
  const spentOfRun = (runId: string): number => round(service().gate.spentOf(runAction(runId)));
  /**
   * The gate stopped a request of this actor's action (it would take the action past what was approved, a model's
   * price is not known, or its money question has no answer yet). For a run the stage stops like one that reached a
   * budget, and the engine pauses there, with the new figure — what was spent and what the REST of the film is
   * estimated at — for a person to confirm (`…film.pipeline.confirm`). Undefined: nothing is open for the action.
   */
  function moneyStop(actor: Actor): Error | undefined {
    if (!actor.action) return undefined;
    const gate = service().gate;
    if (actor.run) { const rest = costOfRest(actor.run.filmId); gate.rest(actor.action, rest.amountUsd === null ? null : rest.pricedUsd); }
    const stop = gate.pending(actor.action);
    if (!stop) return undefined;
    const asked = stop.question, unknown = asked.unpriced.length > 0;
    const message = asked.at === "start" ? `The cost of this film${unknown ? "" : ` (about ${usd(asked.amountUsd)})`} was not confirmed yet. Confirm it to go on.`
      : unknown ? `The next step uses a model whose price this host does not know (${asked.unpriced.join(", ")}), and that was not confirmed. Confirm it to go on.`
        : `This film has cost ${usd(asked.spentUsd)} so far and would pass the ${usd(stop.approvedUsd ?? 0)} that was confirmed for it: it now comes to about ${usd(asked.amountUsd)}. Confirm the new amount to go on.`;
    return failure("BUDGET_EXCEEDED", message, { details: { ...stop.details({ amountUsd: unknown ? null : asked.amountUsd }), scope: "confirmed_estimate", ...(actor.run ? { filmId: actor.run.filmId, runId: actor.run.runId } : {}), confirmedUsd: stop.approvedUsd, limitUsd: stop.limitUsd === null ? null : round(stop.limitUsd), spentUsd: asked.spentUsd } });
  }
  /** The refusal that carries the money question of an action: the estimate with its parts and models, the host's amount, what the budgets leave, and what the answer sends back (`confirmWith`). */
  const askCost = (stop: SpendStop, cost: Cost, filmId: string, sessionId: string, extra: Record<string, unknown> = {}): Error => service().asked(stop, stop.question.at === "start" ? estimateOf(cost) : {}, { providerIds: cost.providerIds, sessionId }, { filmId, ...extra });

  // — the pipeline: every stage works on the film document and makes only what is missing, so a stage started again after a restart repeats nothing —
  type Run = Parameters<StepTool>[1];
  const filmOf = (context: wf.ExecutorContext): { filmId: string; model: z.infer<typeof modelRef> | null } => {
    const params = context.inputs.params as { filmId?: unknown; model?: unknown } | undefined, parsed = modelRef.safeParse(params?.model);
    if (typeof params?.filmId !== "string") throw failure("WORKFLOW_INPUT_INVALID", "This run names no film.", { details: { parameter: "filmId" } });
    read(params.filmId);
    return { filmId: params.filmId, model: parsed.success ? parsed.data : null };
  };
  const actorOf = (context: wf.ExecutorContext, run: Run): Actor & { onSession(sessionKey: string): void } => { const filmId = (context.inputs.params as { filmId?: unknown } | undefined)?.filmId; return { deviceId: run.deviceId, sessionId: `run:${run.runId}`, signal: context.signal, log: context.log, onSession: context.setSession, ...(typeof filmId === "string" ? { run: { runId: run.runId, filmId }, ...((action) => (action ? { action } : {}))(actionOfRun(run, filmId)) } : {}) }; };
  /**
   * The action of the gate a stage of a run spends under. A run of "Make the film" has its own, approved at its start.
   * The film's pipeline started some other way is asked like any run — its action is opened here with the quote of
   * now, and its first paid request stops with that question. A stage ANOTHER workflow runs on a film (one-prompt
   * video) spends under what THAT run's person confirmed, when the run put it on record with the gate (`gate.cover`);
   * a run that did not has no authority of its own.
   */
  const FILM_WORKFLOW = fm.buildFilmTemplate(0).name;
  function actionOfRun(run: Run, filmId: string): string | undefined {
    const gate = deps.generation()?.gate, id = runAction(run.runId);
    if (!gate) return undefined;
    if (gate.action(id)) return id;
    // (A run that put nothing on record has no authority beyond the host's "ask before spending more than": its stages are held to that.)
    if (run.workflowName !== FILM_WORKFLOW) return gate.covered(`run:${run.runId}`) ?? gate.open({ fixedId: `unattended:run:${run.runId}`, kind: "unattended", owner: `run:${run.runId}`, quote: gate.quote({ amountUsd: 0, models: [], plan: "unattended" }) }).id;
    try { openRun(id, filmId, costOfRest(filmId)); } catch (error) { if (!isSpendStop(error)) throw error; }
    return id;
  }
  const notesOf = (context: wf.ExecutorContext): unknown => (context.scope.vars?.__notes as Record<string, unknown> | undefined)?.[context.node.id] ?? null;
  /** What a run has paid for one capability so far, from the generation ledger; a stage reports what it added to it. */
  const spent = (run: Run, capability: GenerationCapability): number => round(service().ledgerRows().filter((row) => row.session_id === `run:${run.runId}` && row.capability === capability).reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0));
  const settle = (outcome: Awaited<ReturnType<typeof batch>>, total: number, what: string, optional?: (message: string) => void): void => {
    if (outcome.stop) throw outcome.stop;
    // A reference picture the provider refuses to draw under its content policy does not hold the film back: the panels
    // are drawn from the words of the script. The asset keeps its "failed" mark, and the run says what was left out.
    if (optional && outcome.failed.length && outcome.failed.every((entry) => entry.code === "CONTENT_BLOCKED" || entry.code === "PICTURE_REJECTED")) return optional(`${outcome.failed.length} of ${total} ${what} could not be had (refused by the provider's content policy, or not the picture that was asked) and are not in the film: ${outcome.failed[0].message}.`);
    if (outcome.failed.length) throw failure("PROVIDER_ERROR", `${outcome.failed.length} of ${total} ${what} could not be made: ${outcome.failed[0].message}. What was made is kept: retry makes only the missing ones.`);
  };
  const tools = new Map<string, StepTool>();
  tools.set("jc_film_breakdown", async (context, run) => {
    const { filmId, model } = filmOf(context), notes = notesOf(context);
    let film = read(filmId);
    // A script that exists is kept — unless the story changed under it (`scriptStale`), or a person asked for changes.
    if (!film.panels.length || film.scriptStale === true || (typeof notes === "string" && notes.trim())) film = await tracked(filmId, "breakdown", () => writeBreakdown(filmId, actorOf(context, run), model, typeof notes === "string" ? notes : ""));
    const counts = fm.counts(film);
    return { outputs: { summary: { characters: film.characters.length, locations: film.locations.length, props: film.props.length, clips: film.clips.length, panels: counts.panels, lines: counts.lines }, costUsd: 0 } };
  });
  /**
   * The one money question of a run, at the first step that knows what the run will make (the script exists). Nothing
   * is asked when the person confirmed at least this much at the start, or when it is not above the host's amount.
   * Either way the amount is what the run is held to from here (`hold`) — but an amount a person must confirm is only
   * PENDING until they approve: the step that follows the checkpoint (round "confirmed") stores it as confirmed.
   */
  tools.set("jc_film_cost", async (context, run) => {
    const { filmId, model } = filmOf(context), generation = deps.generation();
    if (!generation) return { outputs: { summary: { needs: 0 }, costUsd: 0 } };
    // The run's action of the gate, with the quote of NOW (the script exists: what the run will make is known). The
    // gate decides: the quote is covered by what was approved at the start; or it needs no asking; or it is put on
    // record as the run's question — and while that stands, nothing of the run is paid for.
    const gate = generation.gate, actionId = runAction(run.runId), cost = costOfRest(filmId, model), threshold = generation.thresholds().confirmAboveUsd;
    const opened = (answer?: SpendAnswer) => openRun(actionId, filmId, cost, { requote: true, ...(answer ? { answer } : {}) });
    if ((context.node.config.args as { round?: string } | undefined)?.round === "confirmed") {
      // After "confirm_cost": the answer of a person — and nothing else — approves the question that is on record, and only while it is still the quote of now.
      const decision = context.inputs.decision as { outcome?: unknown; by?: { kind?: unknown } } | undefined, waiting = gate.pending(actionId);
      if (decision?.outcome !== "approved" || decision.by?.kind !== "device") throw failure("PERMISSION_DENIED", "The cost of this film was not confirmed by a person.", { details: { reason: "confirmation_required", filmId, runId: run.runId, estimate: { amountUsd: waiting && !waiting.question.unpriced.length ? waiting.question.amountUsd : null } } });
      let held: ReturnType<typeof opened>;
      try { held = opened(waiting ? { confirmed: true, actionId, quoteId: waiting.question.id } : undefined); } catch (error) {
        if (isSpendStop(error)) throw failure("PERMISSION_DENIED", "The cost of this film is not the one that was shown any more: run the cost step again.", { details: { ...error.details(estimateOf(cost)), filmId, runId: run.runId } });
        throw error;
      }
      const confirmedUsd = cost.amountUsd === null ? null : held.approved?.amountUsd ?? null;
      context.log("info", `The cost of this film was confirmed: ${confirmedUsd === null ? "unknown" : usd(confirmedUsd)}.`);
      return { outputs: { summary: { needs: 0, confirmedUsd, stopsAtUsd: cost.amountUsd === null ? null : held.limitUsd }, costUsd: 0 } };
    }
    // What was approved for the run before this step (at its start, by the upper plan of the story): the script's real needs are measured against it.
    const before = gate.action(actionId)?.approved, spentUsd = spentOfRun(run.runId);
    let needs = false, held: ReturnType<typeof opened> | undefined;
    try { held = opened(); } catch (error) { if (!isSpendStop(error)) throw error; needs = true; }
    const remainingUsd = generation.remaining({ providerIds: cost.providerIds, sessionId: `run:${run.runId}` }), stopsAtUsd = cost.amountUsd === null ? null : held?.limitUsd ?? round(Math.max(cost.pricedUsd * fm.CONFIRMED_SHARE, threshold));
    const ask = needs ? {
      askTitle: cost.amountUsd === null ? "Confirm making this film: its cost is not known" : before?.by === "person" ? `This film would cost more than you confirmed: about ${usd(round(spentUsd + cost.amountUsd))}` : `Confirm the cost of this film: about ${usd(cost.amountUsd)}`,
      ask: [
        cost.amountUsd === null ? `What this film will cost is not known (a model has no price): ${costWords(cost)}.`
          : before?.by === "person" ? `You confirmed ${usd(before.amountUsd)} for this film. The script that was written needs more: ${usd(spentUsd)} spent so far, and about ${usd(cost.amountUsd)} still to make — ${costWords(cost)}.`
            : `Making this film is estimated at ${usd(cost.amountUsd)}: ${costWords(cost)}.`,
        remainingUsd === null ? "No spending limit applies." : `The spending limits of this host leave ${usd(remainingUsd)}.`,
        stopsAtUsd === null ? "Approve to make it: nothing more is asked about money." : `Approve to make it: nothing more is asked about money unless the film is about to cost more than ${usd(stopsAtUsd)}.`,
      ].join(" "),
    } : {};
    if (needs) context.log("info", `The run waits for its cost to be confirmed: ${cost.amountUsd === null ? "unknown" : usd(cost.amountUsd)}.`);
    return { outputs: { summary: { needs: needs ? 1 : 0, estimate: estimateOf(cost), confirmAboveUsd: threshold, remainingUsd, stopsAtUsd, ...(before?.by === "person" ? { confirmedUsd: before.amountUsd, spentUsd, remainsUsd: cost.amountUsd } : {}), ...ask }, costUsd: 0 } };
  });
  tools.set("jc_film_assets", async (context, run) => {
    const { filmId } = filmOf(context);
    // The image provider is checked only when there is a picture to make: a stage with nothing missing runs on.
    const todo = missingAssets(read(filmId), false);
    if (todo.length) needImages();
    const before = spent(run, "image");
    settle(await batch(todo, 4, (entry) => makeAsset(filmId, entry.kind, entry.asset.id, actorOf(context, run))), todo.length, "reference pictures", (message) => context.log("warn", message));
    const counts = fm.counts(read(filmId));
    return { outputs: { summary: { assets: counts.assets, made: todo.length, missing: counts.assetsMissing }, costUsd: round(spent(run, "image") - before) } };
  });
  tools.set("jc_film_panels", async (context, run) => {
    const { filmId } = filmOf(context), args = (context.node.config.args ?? {}) as { round?: string; last?: boolean }, again = args.round === "again";
    const numbered = (film: fm.Film, panels: readonly fm.Panel[]): string => { const order = fm.orderedPanels(film); return panels.map((panel) => `Panel ${order.findIndex((entry) => entry.id === panel.id) + 1}`).join(", "); };
    const waitingFor = (film: fm.Film) => film.panels.filter((panel) => undrawn(panel) && panel.refused);
    if (again) {
      const decision = context.inputs.decision as { decided_ms?: unknown } | undefined;
      // A frame whose words a person changed is drawn (its mark is gone); one they left as it was when they approved is
      // theirs to leave out — that is what approving said. A frame that failed AFTER that approval (this step, tried
      // before) was never shown to them: it is not left out by a retry.
      const decided = typeof decision?.decided_ms === "number" ? decision.decided_ms : 0, untouched = waitingFor(read(filmId)).filter((panel) => panel.refused!.at_ms <= decided);
      if (untouched.length) mutate(filmId, untouched.map((panel) => ({ op: "panel.leave" as const, id: panel.id, leftOut: true })));
    }
    const todo = missingPanels(read(filmId), false);
    const summary = (film: fm.Film, made: number, extra: Record<string, unknown>) => { const counts = fm.counts(film); return { panels: counts.panels, made, missing: counts.panelsMissing, refused: 0, refusedNames: "", refusedIds: [] as string[], leftOut: film.panels.filter((panel) => panel.leftOut).length, needs: 0, ...extra }; };
    if (todo.length) needImages();
    if (todo.length && !deps.roleModel?.("vision")) context.log("warn", "No Vision model is routed (Settings, Model routing): the frames are drawn but NOT checked against what they should show.");
    const before = spent(run, "image");
    settle(await drawPanels(filmId, todo, actorOf(context, run)), todo.length, "panel images", (message) => context.log("warn", message));
    const film = read(filmId), refused = waitingFor(film), policy = refused.filter((panel) => panel.refused!.reason !== "picture"), wrong = refused.filter((panel) => panel.refused!.reason === "picture");
    // The last round the template has: the run does not go on without the frames by itself, and there is no checkpoint left to ask at.
    if (args.last && refused.length) throw failure(wrong.length === refused.length ? "PICTURE_REJECTED" : "CONTENT_BLOCKED", `${numbered(film, refused)} still could not be had after ${fm.STORYBOARD_ROUNDS} rounds. Change the words on the storyboard, choose a drawing, or leave the frame out, then retry this step.`, { details: { panelIds: refused.map((panel) => panel.id) } });
    if (refused.length) context.log("warn", `${numbered(film, refused)}: the run waits for a person.`);
    const ask = [
      policy.length ? `The image provider refused to draw ${policy.length === 1 ? "this frame" : "these frames"} under its content policy, also when asked in plainer words: ${numbered(film, policy)}.` : "",
      wrong.length ? `${wrong.length === 1 ? "This frame was" : "These frames were"} drawn ${fm.PICTURE_ATTEMPTS} times and the picture still is not the frame (it does not show the moment, or it carries lettering): ${numbered(film, wrong)}. The last drawing is kept beside the frame.` : "",
      "Change the words of a frame on the storyboard to have it drawn again, or choose one of its drawings yourself. Then approve: the frames you changed are drawn, and the ones you left as they are stay out of the film.",
    ].filter(Boolean).join(" ");
    return { outputs: { summary: summary(film, todo.length - refused.length, { refused: refused.length, refusedNames: numbered(film, refused), refusedIds: refused.map((panel) => panel.id), needs: refused.length, ...(refused.length ? { askTitle: refused.length === 1 ? "A frame could not be had" : "Some frames could not be had", ask } : {}) }), costUsd: round(spent(run, "image") - before) } };
  });
  tools.set("jc_film_voice", async (context, run) => {
    const { filmId } = filmOf(context);
    // The voice stage starts: the speakers without a voice are cast from the host's voices first.
    castSpeakers(filmId);
    const todo = missingLines(read(filmId), false);
    if (!todo.length) return { outputs: { summary: { lines: read(filmId).lines.length, made: 0 }, costUsd: 0 } };
    // No speech provider: the run stops here (a NO_ROUTE of `makeTake`) with what was made before kept.
    const jobs = voiceJobs(todo);
    const voiced = await batch(jobs, 2, (lines) => (lines.length > 1 ? makeSpeakerTakes(filmId, lines.map((line) => line.id), actorOf(context, run)) : makeTake(filmId, lines[0].id, actorOf(context, run))));
    settle(voiced, jobs.length, "speakers' recordings");
    // Lines whose recording still is not the line after the retries are named — the film is not passed off as checked.
    const film = read(filmId), unsure = film.lines.filter((line) => fm.activeTake(line)?.check?.ok === false);
    if (unsure.length) context.log("warn", `${unsure.length} of ${film.lines.length} voice lines do not match their text after three recordings: ${unsure.map((line) => `line ${film.lines.indexOf(line) + 1} (${fm.activeTake(line)!.check!.reason})`).join(", ")}. Listen to them in the Voice stage.`);
    // And the ones nobody listened to are said too: "made" is not "checked".
    const unheard = film.lines.filter((line) => { const take = fm.activeTake(line); return !!take && !take.check && !!take.unchecked; });
    if (unheard.length) context.log("warn", `${unheard.length} of ${film.lines.length} voice lines were NOT listened to (no transcription model could be asked): they are kept unchecked. Listen to them in the Voice stage.`);
    return { outputs: { summary: { lines: film.lines.length, made: todo.length, unsure: unsure.length, unchecked: unheard.length }, costUsd: spent(run, "tts") } };
  });
  tools.set("jc_film_music", async (context, run) => {
    const { filmId } = filmOf(context), film = read(filmId);
    if (film.music.mood === "none" || film.music.current) return { outputs: { summary: { music: !!film.music.current }, costUsd: 0 } };
    // No music provider: `makeMusic` throws NO_ROUTE, which the catch below rethrows, so the run stops here.
    try { await makeMusic(filmId, actorOf(context, run)); } catch (error) {
      // A film without music is still a film; a spending limit still stops the run.
      if (stops(error)) throw error;
      context.log("warn", `MUSIC_UNAVAILABLE: ${(error as Error).message}`);
      return { outputs: { summary: { music: false, skipped: (error as Error).message }, costUsd: 0 } };
    }
    return { outputs: { summary: { music: true }, costUsd: spent(run, "music") } };
  });
  tools.set("jc_film_assemble", async (context, run) => {
    const { filmId } = filmOf(context);
    let film: fm.Film;
    // Only frames a person left out ("Some frames were refused"), or ones a stage run by hand skipped, have no picture here.
    const leftOut = read(filmId).panels.filter((panel) => !panel.picture.current && panel.leftOut === true).length, undrawn = read(filmId).panels.filter((panel) => !panel.picture.current && panel.leftOut !== true).length;
    if (leftOut) context.log("info", `${leftOut} ${leftOut === 1 ? "frame was" : "frames were"} left out by a person and ${leftOut === 1 ? "is" : "are"} not on the timeline.`);
    if (undrawn) context.log("warn", `${undrawn} ${undrawn === 1 ? "panel has" : "panels have"} no picture and ${undrawn === 1 ? "is" : "are"} left out of the timeline.`);
    // The shots are set in motion before the timeline is built — only when the Video role is routed (Model routing): each clip starts from its frame's picture. A clip that cannot be had does not hold the film back: that shot is its still, and the run says so. A money stop, a cancel or a missing route stops the step like any other.
    let clipsUsd = 0;
    if (videoOn()) {
      const todo = missingClips(read(filmId), false), before = spent(run, "video");
      if (todo.length) {
        context.log("info", `Setting ${todo.length} ${todo.length === 1 ? "shot" : "shots"} in motion.`);
        const outcome = await batch(todo, 2, (panel) => makeClip(filmId, panel.id, actorOf(context, run)));
        if (outcome.stop) throw outcome.stop;
        if (outcome.failed.length) context.log("warn", `${outcome.failed.length} of ${todo.length} clips could not be made and those shots stay stills: ${outcome.failed[0].message}`);
        clipsUsd = round(spent(run, "video") - before);
      }
    }
    try { film = assemble(filmId, undrawn > 0, `run:${run.runId}`); } catch (error) { if (error instanceof fm.FilmError) throw failure(error.code, error.message, { details: error.details }); throw error; }
    const project = film.project!;
    context.log("info", `Project "${project.name}": ${project.clips} clips, ${project.voiceElements} voice clips, ${project.captionCues} captions, ${project.musicElements} music clips.`);
    return { outputs: { summary: { project, clips: read(filmId).panels.filter((panel) => panel.still !== true && fm.clipOf(panel)).length }, costUsd: clipsUsd } };
  });

  // — the channel methods of the studio —
  const methods = new Map<string, RpcMethod>();
  const define = (name: string, scope: Scope, handle: RpcMethod["handle"]): void => { methods.set(name, { scope, handle: async (raw, connection) => { try { return await handle(raw, connection); } catch (error) { return wire(error); } } }); };
  const answer = (film: fm.Film) => ({ film, activity: activityOf(film.id), pipeline: pipelineOf(film) });
  const studio = (connection: Connection, filmId: string): Actor => ({ deviceId: connection.deviceId, sessionId: `film:${filmId}` });
  define("jagentchill.film.list", READ, () => ({ films: list() }));
  define("jagentchill.film.create", WRITE, (raw) => answer(create(parse(schemas.create, raw))));
  define("jagentchill.film.get", READ, (raw) => answer(read(parse(schemas.film, raw).filmId)));
  define("jagentchill.film.open", READ, (raw) => { const film = mutate(parse(schemas.film, raw).filmId, [{ op: "opened" }]); toIndex(); return answer(film); });
  define("jagentchill.film.apply", WRITE, (raw) => {
    const { filmId, ops } = parse(schemas.apply, raw), refused = ops.find((op) => !PERSON_OPS.has(op.op));
    if (refused) throw new ProtocolError("INVALID_PARAMS", "This change cannot be made from a screen.", { details: { op: refused.op } });
    // A voice sample: only where the voice model in use speaks in a sample's voice (else the control is off and says so — nothing is stored that would be ignored), and only a recording that really is on the host; its size and kind are read from the file, not taken from the screen.
    for (const op of ops as unknown as fm.FilmOp[]) {
      if (op.op !== "voice.sample" || !op.sample) continue;
      const facts = voiceFacts();
      if (!facts.clone) throw new ProtocolError("INVALID_PARAMS", facts.model ? `${facts.model}, the voice model in use, does not speak in the voice of a sample. Choose a voice model that does under Settings, Model routing.` : "No voice model is in use on this host.", { details: { reason: "voice_clone_unavailable", model: facts.model } });
      const blobId = String(op.sample.blobId ?? ""), status = /^[a-f0-9]{64}$/.test(blobId) ? deps.sync.blobs.status(blobId) : undefined;
      if (!status || status.state !== "complete") throw new ProtocolError("INVALID_PARAMS", "This recording is not on the host yet.", { details: { field: "sample.blobId" } });
      if (status.size > fm.VOICE_SAMPLE_LIMITS.maxBytes) throw new ProtocolError("INVALID_PARAMS", `A voice sample is at most ${fm.VOICE_SAMPLE_LIMITS.maxBytes / 1_048_576} MB.`, { details: { field: "sample", max: fm.VOICE_SAMPLE_LIMITS.maxBytes, bytes: status.size } });
      const kind = sniffMedia(deps.sync.blobs.read(blobId))?.mime;
      if (!kind?.startsWith("audio/")) throw new ProtocolError("INVALID_PARAMS", "A voice sample is a recording (WAV, MP3, M4A, OGG or FLAC).", { details: { field: "sample" } });
      op.sample = { ...op.sample, bytes: status.size, mime: kind };
    }
    return answer(edit(filmId, ops as unknown as fm.FilmOp[]));
  });
  define("jagentchill.film.delete", WRITE, (raw) => {
    const { filmId } = parse(schemas.film, raw);
    read(filmId);
    db.prepare("UPDATE films SET deleted_ms = ? WHERE film_id = ?").run(now(), filmId);
    activity.delete(filmId);
    toIndex();
    return { filmId };
  });
  define("jagentchill.film.estimate", READ, (raw) => estimate(parse(schemas.film, raw).filmId));
  define("jagentchill.film.write", RUN, async (raw, connection) => {
    const input = parse(schemas.write, raw), actor = studio(connection, input.filmId), generation = deps.generation(), film = read(input.filmId);
    // What cannot be written at all is said as that — before anybody is asked about its cost.
    if (input.what === "story" && !(input.idea ?? "").trim()) throw failure("INVALID_PARAMS", "Describe the idea of the film first.", { details: { field: "idea" } });
    if (input.what === "story" && !(fm.STORY_LENGTHS as readonly number[]).includes(input.seconds ?? 60)) throw failure("INVALID_PARAMS", "This length is not offered.", { details: { field: "seconds" } });
    if (input.what === "breakdown" && !film.sourceText.trim()) throw failure("INVALID_PARAMS", "Write the story first.", { details: { field: "sourceText" } });
    // "Write with AI" is paid work like any other: ONE action of the spend gate, asked about first — the model that writes, at a price this host does not know (or its amount, when it does) — and held to the answer.
    if (generation) {
      const cost = costOf([], [input.what === "story" ? writingTurn(input.model, "screenwriter", fm.PROMPTS.story(film, input.idea ?? "", input.seconds ?? 60, input.tone ?? ""), film.id) : writingTurn(input.model, "storyboard", breakdownPrompt(film), film.id)]);
      try { actor.action = generation.gate.open({ fixedId: `film.write:${createHash("sha256").update(canonicalJson([input.filmId, input.what, input.idea ?? "", input.seconds ?? 0, input.tone ?? ""])).digest("hex").slice(0, 32)}`, kind: "film.write", owner: `film:${input.filmId}`, quote: quoteOf(cost, planOf(`film.write: ${input.what}`, film)), answer: answerOf(input) }).id; } catch (error) {
        if (isSpendStop(error)) throw askCost(error, cost, input.filmId, actor.sessionId, { what: input.what });
        throw error;
      }
    }
    const action = actor.action, ended = (): void => { if (action && generation && !generation.gate.pending(action)) generation.gate.close(action); };
    try { return answer(await tracked(input.filmId, input.what, () => (input.what === "story" ? writeStory(input.filmId, actor, { idea: input.idea ?? "", seconds: input.seconds ?? 60, tone: input.tone ?? "", model: input.model }) : writeBreakdown(input.filmId, actor, input.model)))); } finally { ended(); }
  });
  /** Starts the work and answers at once: the screens follow it through `jagentchill.film.updated` (activity by target). */
  define("jagentchill.film.generate", RUN, (raw, connection) => {
    const { filmId, target: wanted, ...said } = parse(schemas.generate, raw), actor = studio(connection, filmId), film = read(filmId);
    // ONE action of the spend gate for what this request makes — a single file or a whole batch: its quote is shown
    // first when it is above the host's amount or a price is not known, and approved by the answer to that question;
    // every request of the action (a redraw, a second recording, a read-back, a look at a frame) is then held to it.
    const generation = deps.generation(), cost = generation ? costOfTarget(film, wanted) : undefined;
    if (generation && cost) {
      try { actor.action = generation.gate.open({ fixedId: `film.generate:${createHash("sha256").update(canonicalJson([filmId, wanted])).digest("hex").slice(0, 32)}`, kind: "film.generate", owner: `film:${filmId}`, quote: quoteOf(cost, planOf("film.generate", film, [wanted, referencesOf(film, wanted)])), answer: answerOf(said) }).id; } catch (error) {
        // (`attempts`: the amount of a single line is the MOST it can come to — so many recordings, each listened to; the screen says "up to".)
        if (isSpendStop(error)) throw askCost(error, cost, filmId, actor.sessionId, { target: wanted, ...(wanted.kind === "line" ? { attempts: TAKE_ATTEMPTS } : {}) });
        throw error;
      }
    }
    const work = (): Promise<unknown> => {
      if (wanted.kind === "asset") { needImages(); return makeAsset(filmId, wanted.assetKind, wanted.id, actor); }
      if (wanted.kind === "panel") { needImages(); return makePanel(filmId, wanted.id, actor); }
      if (wanted.kind === "line") { castSpeakers(filmId); return makeTake(filmId, wanted.id, actor, wanted.keepCurrent === true); }
      if (wanted.kind === "music") return makeMusic(filmId, actor);
      if (wanted.kind === "clip") return makeClip(filmId, wanted.id, actor);
      if (wanted.kind === "clips") return makeMany(filmId, wanted, actor);
      if (wanted.kind === "lines" || wanted.kind === "speaker") castSpeakers(filmId); else needImages();
      if (wanted.kind === "speaker" && !film.lines.some((line) => line.speakerId === wanted.speakerId)) throw new ProtocolError("NOT_FOUND", "This speaker has no line in the film.", { details: { speakerId: wanted.speakerId } });
      return makeMany(filmId, wanted, actor);
    };
    const action = actor.action, gate = generation?.gate;
    // The action ends with its work — unless it stopped to ask: then it is kept, with its question and what it has spent, for the answer.
    const ended = (): void => { if (action && gate && !gate.pending(action)) gate.close(action); };
    let started: Promise<unknown>;
    try { started = action && gate ? gate.once(action, work) : work(); } catch (error) { ended(); throw error; }
    // A failure is in the film's activity, where the screen shows it beside what failed.
    void started.then(ended, ended);
    return answer(read(film.id));
  });
  define("jagentchill.film.assemble", WRITE, (raw, connection) => { const input = parse(schemas.assemble, raw); return answer(assemble(input.filmId, input.withoutMissing === true, `device:${connection.deviceId}`)); });
  define("jagentchill.film.pipeline.start", RUN, (raw, connection) => {
    const input = parse(schemas.pipeline, raw), film = read(input.filmId), current = pipelineOf(film);
    if (!film.sourceText.trim()) throw new ProtocolError("INVALID_PARAMS", "Write the story first.", { details: { field: "sourceText" } });
    if (current && !["succeeded", "failed", "cancelled"].includes(current.status)) throw new ProtocolError("CONFLICT", "This film is already being made: wait for it to finish or stop it, then start again.", { details: { runId: current.id } });
    // The run starts as soon as a writing model is available: a stage with a missing provider stops there, after the
    // stages before it have been kept, so connecting the provider and starting again continues where it stopped.
    const mode = input.mode ?? "checkpoints";
    // The ONE money question of the run, BEFORE anything of it is paid for — the writing of the script too. A film
    // whose script exists is quoted for all it will make; a film with only its story by the upper plan of that story
    // (`costOfRest`). When the script is there the cost step compares what it really needs with what was approved:
    // inside the run's guard (the spec's 120 %) the run goes on unasked; only past it does "confirm_cost" ask again.
    const generation = deps.generation();
    // What the run cannot do without is checked FIRST: a film that cannot be drawn or spoken on this host is not asked about, and nothing of it — its script neither — is paid for.
    if (generation) needRoutes(film);
    const scripted = film.panels.length > 0 && film.scriptStale !== true, cost = generation ? costOfRest(film.id, input.model) : undefined;
    let actionId: string | undefined;
    if (generation && cost) {
      try { actionId = generation.gate.open({ fixedId: `film.start:${film.id}`, ...RUN_ACTION, owner: `film:${film.id}`, quote: quoteOf(cost, planOf(RUN_ACTION.kind, film)), answer: answerOf(input) }).id; } catch (error) {
        if (isSpendStop(error)) throw askCost(error, cost, film.id, `film:${film.id}`, { mode, scripted, ...(cost.upper ? { upperPlan: cost.upper } : {}), stopsAtUsd: cost.amountUsd === null ? null : round(Math.max(cost.pricedUsd * fm.CONFIRMED_SHARE, generation.thresholds().confirmAboveUsd)) });
        throw error;
      }
    }
    const run = deps.workflows().runs.start({
      workflowId: fm.FILM_TEMPLATE_ID, params: { filmId: film.id, mode, ...(input.model ? { model: input.model } : {}) }, origin: "user", originRef: { deviceId: connection.deviceId }, startedByDeviceId: connection.deviceId, attended: true,
      ...(mode === "auto" ? { approvalOverride: "auto" as const } : {}),
    });
    // What was approved at the start is the run's from here: its action, under the run's id.
    if (generation && actionId) generation.gate.rename(actionId, runAction(run.id));
    return { run, ...answer(mutate(film.id, [{ op: "pipeline.set", runId: run.id }])) };
  });
  /**
   * A person answers the question a run stopped with: a new amount (`confirmedUsd`) for a run that would pass what was
   * confirmed, or `confirmed: true` with what the question named — the only answer to a model whose price is not known.
   * A run paused there goes on (a run that failed there — nobody followed it — has its step run again with `…workflow.node.rerun`).
   */
  define("jagentchill.film.pipeline.confirm", RUN, (raw, connection) => {
    const input = parse(schemas.confirm, raw), film = read(input.filmId), current = pipelineOf(film);
    if (!current) throw new ProtocolError("NOT_FOUND", "This film has no run.", { details: { filmId: film.id } });
    const gate = service().gate, actionId = runAction(current.id), before = gate.action(actionId);
    if (input.confirmedUsd === undefined && input.confirmed !== true) throw new ProtocolError("INVALID_PARAMS", "Say what is confirmed: an amount, or the question that was shown.", { details: { field: "confirmedUsd" } });
    if (input.confirmedUsd !== undefined) {
      if (before?.approved && input.confirmedUsd < before.approved.amountUsd) throw new ProtocolError("INVALID_PARAMS", "The new amount is lower than what was confirmed before.", { details: { field: "confirmedUsd", confirmedUsd: before.approved.amountUsd } });
      // A run the gate does not know yet (it was started some other way) gets its action here, with the amount a person names.
      if (!before) { const cost = costOfRest(film.id); try { openRun(actionId, film.id, cost); } catch (error) { if (!isSpendStop(error)) throw error; } }
      gate.raise(actionId, input.confirmedUsd, answerOf(input));
    } else {
      const cost = costOfRest(film.id);
      try { openRun(actionId, film.id, cost, { requote: true, answer: answerOf(input) }); } catch (error) { if (isSpendStop(error)) throw askCost(error, cost, film.id, `film:${film.id}`, { runId: current.id }); throw error; }
    }
    const after = gate.action(actionId)!;
    if (!after.question && current.status === "paused" && current.pauseReason === "budget_exceeded") deps.workflows().runs.resume(current.id, connection.deviceId);
    return { runId: current.id, confirmedUsd: after.approved?.amountUsd ?? input.confirmedUsd ?? null, stopsAtUsd: after.limitUsd, spentUsd: spentOfRun(current.id), ...(after.question ? { pending: gate.pending(actionId)!.details() } : {}) };
  });

  return {
    tools, methods, read, list, create, mutate, edit, reorderClips, assemble, estimate, activityOf,
    /** Stores the pipeline's template document under its fixed id (and replaces an older graph). */
    install(): void { deps.workflows().docs.install(fm.buildFilmTemplate(now())); },
  };
}
export type FilmService = ReturnType<typeof createFilmService>;
