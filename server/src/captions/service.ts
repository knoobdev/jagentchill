import { createHash } from "node:crypto";
import { z } from "zod";
import { film as fm } from "@jagentchill/editor-core";
import { ORC_DEFAULT_FALLBACK_ON, type ErrorCode, type GenerationAsset, type Scope } from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { FilmDeps } from "../film/service.ts";
import { pcmOfWav } from "../film/voice-batch.ts";
import type { GenerationService } from "../generation/service.ts";
import { isSpendStop, modelName, type SpendAnswer, type SpendStop } from "../generation/spend-gate.ts";
import { classifyTurnError, turnFailureClass } from "../runtimes/errors.ts";
import type { SyncService } from "../sync/service.ts";

/**
 * Captions and the editor's speech tools on the host: what a piece of a recording says (the Transcription role),
 * captions in another language (the Translation role), and a text spoken aloud and listened back to (the Voice
 * role). It owns no model choice, queue or budget: listening, translating and speaking are all work of the generation
 * service under its rules — the estimate reserved against the budgets, a ledger row per call. Nothing is asked about
 * what is sent: a connected provider gets what the action a person started needs (their clip's sound for captions, the
 * caption text, the recording that is listened back to); the old `consent` / `listenConsent` parameters are taken and
 * decide nothing. MONEY is asked once per action, and the rule is not here: every paid call is a request of an action
 * of the generation service's SPEND GATE (`generation/spend-gate.ts`), which shows the quote, takes the answer to it,
 * and holds each request to what was approved.
 *
 * The device finds the pieces of speech itself (it has the media; see `speechPieces` in editor-core) and sends one
 * piece per call, so every caption has the start and end of what was actually said, whatever the provider returns.
 */
export type CaptionsDeps = {
  generation: () => GenerationService | undefined;
  /** `documents`: the host's copy of a synced project — the captions of a translation are read from it when no screen sent them (review 16 #3). A project that is not synced has none. */
  sync: Pick<SyncService, "blobs"> & { documents?: Pick<SyncService["documents"], "row" | "head"> };
  /** The route of a role of Model routing (`orc.route`): its candidates that can serve now, in order, and the failure classes that move on to the next one. */
  roleRoute?: (roleId: string) => { configured: boolean; candidates: NonNullable<ReturnType<NonNullable<FilmDeps["roleModel"]>>>[]; fallbackOn: readonly string[]; reason?: string };
  /** The session path: one turn of a model of a runtime (through the session service), for a Translation role routed to one. */
  workflows?: () => Pick<ReturnType<FilmDeps["workflows"]>, "runs">;
  /** What the turns of a session have cost so far (Usage); null when not known. */
  turnCost?: (sessionKey: string) => Promise<number | null>;
};

const READ: Scope = "jagentchill.projects.read", RUN: Scope = "jagentchill.generation.run";
/** One channel frame is at most 1 MiB: a piece of 20 s at 16 kHz mono is 640 kB, 854 kB as base64. */
export const PIECE_MAX_BASE64 = 900_000;
export const TRANSLATE_BATCH_MAX = 40;
const schemas = {
  status: z.object({}).strict(),
  transcribe: z.object({ audio: z.string().min(60).max(PIECE_MAX_BASE64).regex(/^[A-Za-z0-9+/]+=*$/), language: z.string().min(2).max(16).optional(), projectId: z.string().max(64).optional(), consent: z.literal("once").optional(), confirmed: z.literal(true).optional(), /** The answer to a money question: what its refusal named to be sent back (`details.confirmWith`), with `confirmed: true`. */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), /** The length of ALL the pieces of the recording this piece is of: the action is quoted, and approved, once for the whole. */ wholeSeconds: z.number().positive().max(86_400).optional(), /** …and how many pieces that is. */ wholePieces: z.number().int().positive().max(20_000).optional() }).strict(),
  translate: z.object({ texts: z.array(z.string().min(1).max(500)).min(1).max(TRANSLATE_BATCH_MAX), source: z.string().min(2).max(35).optional(), target: z.string().min(2).max(35), targetName: z.string().min(2).max(60), projectId: z.string().max(64).optional(), consent: z.literal("once").optional(), confirmed: z.literal(true).optional(), /** The answer to a money question: what its refusal named to be sent back (`details.confirmWith`), with `confirmed: true`. */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), /** ALL the captions this batch is of (their characters, how many they are): the action is quoted, and approved, once for the whole. */ whole: z.object({ characters: z.number().int().positive().max(5_000_000), lines: z.number().int().positive().max(100_000) }).strict().optional(), /** Taken from screens written before the spend gate; decides nothing (an answer is `confirmWith`). The amount the person confirmed, when it is not the first estimate (a translation that needed more paid calls asked again with a new figure). */ confirmedUsd: z.number().min(0).max(100_000).optional(), /** The model whose price is not known and which the person said may be used (`details.estimate.model` of the question that named it). */ confirmedUnpriced: z.string().min(1).max(200).optional() }).strict(),
  /** What a piece of work is estimated to cost before it is started: listening to `seconds` of sound, translating `characters` of text, or speaking a text (and listening back to it). */
  estimate: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("transcription"), seconds: z.number().positive().max(86_400), /** How many pieces the recording is sent in (one request each): a listener priced per call is paid that many times. */ pieces: z.number().int().positive().max(20_000).optional() }).strict(),
    z.object({ kind: z.literal("translation"), characters: z.number().int().positive().max(5_000_000), /** How many captions they are (they are sent in batches of forty, each with its instruction). */ lines: z.number().int().positive().max(100_000).optional(), /** ALL the captions, in the order they will be sent, and the names the requests will carry (ruling R6): the quote is computed from the batches that will really go out — forty captions each, in this order. Without them nothing can be counted, and the translation is "price not known". */ texts: z.array(z.string().min(1).max(500)).min(1).max(100_000).optional(), targetName: z.string().min(2).max(60).optional(), source: z.string().min(2).max(35).optional(), /** The project (and its caption track) the captions are of: when no `texts` are sent the host reads them from its own copy of the project — the same quote, of the same action, as when a screen sends them (review 16 #3). */ projectId: z.string().max(64).optional(), trackId: z.string().min(1).max(128).optional() }).strict(),
    z.object({ kind: z.literal("speech"), text: z.string().min(1).max(2000), language: z.string().min(2).max(16).optional(), /** A NEW recording is wanted (`again` of `…captions.speak`): the one in the cache does not make it free. */ again: z.boolean().optional() }).strict(),
  ]),
  speak: z.object({ text: z.string().min(1).max(2000), language: z.string().min(2).max(16).optional(), projectId: z.string().max(64).optional(), consent: z.literal("once").optional(), listenConsent: z.literal("once").optional(), /** The person saw the estimate and confirmed it. */ confirmed: z.literal(true).optional(), /** The answer to a money question: what its refusal named to be sent back (`details.confirmWith`), with `confirmed: true`. */ actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(), again: z.boolean().optional() }).strict(),
};
function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: String(parsed.error.issues[0]?.path.join(".") ?? "") } });
  return parsed.data;
}
/** A fault of the generation service or of a turn, in the channel's envelope. */
function wire(error: unknown): never {
  if (error instanceof ProtocolError) throw error;
  const known = error as { code?: string; message?: string; details?: Record<string, unknown>; class?: string };
  if (typeof known.code === "string" && /^[A-Z_]+$/.test(known.code)) throw new ProtocolError(known.code as ErrorCode, known.message ?? "The request failed.", { details: known.details });
  // A provider failure (rate limit, refused key, timeout…) keeps its class and its sentence.
  if (typeof known.class === "string") throw new ProtocolError("UNAVAILABLE", known.message ?? "The provider failed.", { retryable: true, details: { ...known.details, reason: known.class } });
  throw error;
}

/**
 * What the model answered, as exactly `count` translations: a JSON array of strings (a fence or words around it are
 * tolerated). Anything else — another count, an entry that is not text, a BLANK entry (a caption with nothing under
 * it is not a translation) — is undefined: a batch is never half-guessed.
 */
export function translationsOf(answer: string, count: number): string[] | undefined {
  const start = answer.indexOf("["), end = answer.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(answer.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== count || parsed.some((entry) => typeof entry !== "string")) return undefined;
    const clean = (parsed as string[]).map((entry) => Array.from(entry.replace(/\s+/g, " ").trim()).slice(0, 500).join(""));
    return clean.some((entry) => entry.length === 0) ? undefined : clean;
  } catch { return undefined; }
}
/**
 * The limit of the answer a translation request sends, in tokens (coordinator's ruling R6): the UTF-8 bytes of the
 * captions it carries + the bytes of the answer's fixed structure — the JSON array of that many strings, empty
 * (brackets, quotes, commas). Derived from the request alone; no factor. (No tokenizer makes more tokens than a text
 * has bytes, so an answer as long as its source fits; one that does not is cut by the provider and says so.)
 */
export const translationLimitOf = (texts: readonly string[]): number => texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0) + Buffer.byteLength(JSON.stringify(texts.map(() => "")), "utf8");
export function translationPrompt(texts: readonly string[], targetName: string, source?: string): string {
  return [
    `Translate these ${texts.length} subtitle lines${source && source !== "und" ? ` from ${source}` : ""} into ${targetName}.`,
    "Each line is one caption shown on its own: translate line by line, keep the order, never merge, split, drop or add a line. Keep names and numbers. Write natural, short subtitle language.",
    `Answer with ONLY a JSON array of exactly ${texts.length} strings — the translations in the same order — and nothing else.`,
    JSON.stringify(texts),
  ].join("\n");
}

export function createCaptionsService(deps: CaptionsDeps) {
  const service = (): GenerationService => { const found = deps.generation(); if (!found) throw new ProtocolError("UNAVAILABLE", "This host has no generation service."); return found; };
  const money = (usd: number): number => Math.round(usd * 1e6) / 1e6, digest = (parts: unknown): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  /**
   * MONEY. Every paid call of this service is a request of an ACTION of the generation service's spend gate, and the
   * rule is the gate's, not this file's: the action is opened with the quote of what it will do (`open` — the person
   * is asked when it is above the host's amount or a price is not known, and approves by answering THAT question:
   * `confirmed: true` with the `confirmWith` of the refusal), and each provider request then passes through `spend`.
   * This turns a stop of the gate into the refusal the screens know.
   */
  const gate = () => service().gate;
  const refusal = (stop: SpendStop, estimate: Record<string, unknown>, scope: { providerIds: string[]; projectId?: string; sessionId?: string }): ProtocolError => service().asked(stop, estimate, scope);
  /** What a person sent as the answer to a money question. */
  const answerOf = (input: { confirmed?: true; actionId?: string; quoteId?: string }): SpendAnswer => ({ confirmed: input.confirmed === true, ...(input.actionId ? { actionId: input.actionId } : {}), ...(input.quoteId ? { quoteId: input.quoteId } : {}) });
  /**
   * The whole a screen last asked the estimate of (`…captions.estimate`), per device: an action made of several
   * requests (the pieces of a recording, the batches of a translation) is quoted ONCE for all of it — by the `whole`
   * its requests name, else by the estimate the screen showed just before them.
   */
  const planned = new Map<string, { seconds?: number; pieces?: number; characters?: number; lines?: number; at_ms: number }>();
  /** What listening to a whole recording costs: every piece is a request of its own (a listener priced per call is paid once a piece). */
  const hearingUsd = (seconds: number, pieces: number, language?: string): number | null => { const each = service().listener(seconds / pieces, language)?.estimateUsd ?? null; return each === null ? null : money(each * pieces); };
  /** The ids of the actions that cover several requests — the same for the estimate that mints the question and for the requests that answer it. */
  const wholeId = { transcription: (sessionId: string, seconds: number, pieces: number): string => `captions.transcribe:${digest([sessionId, "whole", Math.round(seconds * 1000), pieces])}`, /** A translation is identified by WHAT is translated — every caption, in order, and the names its requests carry — never by counts a screen says: the same whether a screen sent the captions or the host read them from the project (review 16 #3). */ translation: (sessionId: string, texts: readonly string[], targetName: string, source?: string): string => `captions.translate:${digest([sessionId, "whole", targetName, source ?? "", texts])}` };
  /**
   * The estimate a screen shows is the QUOTE of the action it is about to start: the question is put on record here,
   * and the estimate carries its ids (`confirmWith`) — so the answer of the first dialog is the exact answer to it,
   * never a blind `confirmed: true`. Undefined: nothing needs asking.
   */
  const minted = (open: () => unknown): { actionId: string; quoteId: string } | undefined => { try { open(); return undefined; } catch (error) { if (isSpendStop(error)) return error.confirmWith; throw error; } };
  const plannedOf = (deviceId: string, kind: "transcription" | "translation") => { const found = planned.get(`${deviceId}:${kind}`); return found && now() - found.at_ms < 30 * 60_000 ? found : undefined; };
  /**
   * An action that covers several requests is found by what it is of (the device, the project, the whole). One that
   * is approved, has no open question and is not named by this request's answer is the action of an EARLIER run of
   * the same work: it has ended, and this request starts a new one.
   */
  const fresh = (fixedId: string, answer: SpendAnswer): void => { const found = gate().action(fixedId); if (found?.approved && !found.question && answer.actionId !== fixedId) gate().close(fixedId); };
  /**
   * Who translates, in which order, and on which path. THE ROLE'S ROUTE DECIDES: the Translation role's candidates
   * (primary, then fallbacks) each name a model; one the generation catalogue has (a translation row of a connected
   * generation provider) writes as work of the generation service — the job path: estimate, budgets, ledger. Any
   * other routed model is a model of a runtime: one turn of a session of the session service, counted where every turn
   * is (Usage); the host knows no price for it, so its estimate is unknown. A role with no profile falls back to the
   * translation models that are on in the generation catalogue. A role whose profiles cannot serve is NO_ROUTE.
   */
  type Routed = NonNullable<ReturnType<NonNullable<FilmDeps["roleModel"]>>>;
  type Translator = { via: "generation" | "runtime"; provider: string; label: string; model: string; estimateUsd: number | null; ref?: Routed; /** Ruling R9: a runtime the person signed in to themselves — not billed by this app: no part of a quote, never "price not known". */ own?: true };
  type Work = ReturnType<GenerationService["translationWork"]>;
  function translatorsOf(work?: Work): { list: Translator[]; fallbackOn: readonly string[] } {
    const jobs = service().translatorList(work), viaJob = (job: (typeof jobs)[number]): Translator => ({ via: "generation", provider: job.provider, label: job.label, model: job.model, estimateUsd: job.estimateUsd });
    const route = deps.workflows ? deps.roleRoute?.("translation") : undefined;
    if (!route?.configured) return { list: jobs.map(viaJob), fallbackOn: ORC_DEFAULT_FALLBACK_ON };
    if (!route.candidates.length) throw new ProtocolError("NO_ROUTE", `Model routing gives the Translation role no usable model: ${route.reason ?? "no profile can serve"}. Change the role under Settings, Model routing.`, { details: { role: "translation", reason: "orc_route_unusable" } });
    return { list: route.candidates.map((routed) => { const job = jobs.find((entry) => entry.provider === routed.providerId && entry.model === routed.modelId); if (job) return viaJob(job); const own = service().gate.billingOf({ ref: routed }) === "own_account"; return { via: "runtime" as const, provider: routed.providerId, label: routed.providerId, model: routed.modelId, estimateUsd: own ? 0 : null, ref: routed, ...(own ? { own: true as const } : {}) }; }), fallbackOn: route.fallbackOn };
  }
  const translatorOf = (work?: Work): Translator | undefined => translatorsOf(work).list[0];
  /**
   * The figure a person confirms for a translation: the first candidate's estimate — or a dearer PRICED fallback's, so
   * that a priced fallback that serves never costs more than what was confirmed. Unknown (null) when the first
   * candidate has no price. A fallback whose price is not known is NOT in this figure and is not zero: it is named
   * beside it (`unpricedOf`) and is asked about, by itself, before it is ever called.
   */
  const quoteOf = (list: readonly Translator[]): number | null => (list[0].estimateUsd === null ? null : Math.max(...list.map((entry) => entry.estimateUsd ?? 0)));
  const unpricedOf = (list: readonly Translator[]) => list.slice(1).filter((entry) => entry.estimateUsd === null).map((entry) => ({ provider: entry.provider, model: entry.model, via: entry.via }));
  const nameOf = (entry: Translator): string => modelName(entry.provider, entry.model, entry.via);
  /** The models a QUOTE names: every candidate that is billed by this app (ruling R9: one on the person's own account is in no quote). */
  const quoted = (list: readonly Translator[]): string[] => list.filter((entry) => !entry.own).map(nameOf);
  /** …and what is told beside the quote: the candidates that run on the person's own account. */
  const ownOf = (list: readonly Translator[]) => { const own = list.filter((entry) => entry.own).map((entry) => { const runtime = service().gate.accountOf(entry.ref?.runtimeId); return { label: "Translation", model: entry.model, ...(runtime ? { runtime } : {}) }; }); return own.length ? { ownAccount: own } : {}; };
  /** One translation request as it is priced and sent: its real prompt, and the limit of its answer (ruling R6). */
  const workOf = (texts: readonly string[], targetName: string, source?: string): Work => service().translationWork(translationPrompt(texts, targetName, source), texts.reduce((sum, text) => sum + text.length, 0), texts.length, translationLimitOf(texts));
  /**
   * The ACTUAL batches of a whole translation, as the estimate was given them (`texts`: forty captions a request, in
   * order), kept by the id of the whole's action for as long as a dialog may be open: the whole is quoted — at the
   * estimate, and again at every batch, with the prices of that moment — from these very requests. No stand-in text,
   * no placeholder name. A whole nobody gave the captions of has no plan: each of its batches is then quoted by itself.
   */
  type Plan = { id: string; sessionId: string; batches: string[][]; targetName: string; source?: string; at_ms: number };
  const plans = new Map<string, Plan>();
  /** The plan of a whole translation — its action's id is the hash of its content (`wholeId.translation`) — put on record (again: it stays for as long as it is asked about). */
  const planOf = (sessionId: string, texts: readonly string[], targetName: string, source?: string): Plan => {
    const plan: Plan = { id: wholeId.translation(sessionId, texts, targetName, source), sessionId, batches: Array.from({ length: Math.ceil(texts.length / TRANSLATE_BATCH_MAX) }, (_, index) => texts.slice(index * TRANSLATE_BATCH_MAX, (index + 1) * TRANSLATE_BATCH_MAX)), targetName, ...(source ? { source } : {}), at_ms: now() };
    plans.set(plan.id, plan);
    return plan;
  };
  /**
   * The captions of a project as the HOST has them (its copy of a synced project): every caption track with the texts
   * a screen sends for it — the captions that have words, in order, their white space collapsed, at most 500
   * characters (the screens' own rule for a caption they send). Nothing for a project the host has no copy of.
   */
  const captionsOf = (projectId: string): { trackId: string; texts: string[] }[] => {
    try {
      const row = deps.sync.documents?.row({ kind: "project", id: projectId });
      if (!row || row.state !== "active") return [];
      const scenes = (deps.sync.documents!.head(row) as { scenes?: unknown }).scenes, found: { trackId: string; texts: string[] }[] = [];
      for (const scene of Array.isArray(scenes) ? (scenes as { tracks?: { main?: unknown; overlay?: unknown; audio?: unknown } }[]) : []) {
        for (const track of [scene?.tracks?.main, ...(Array.isArray(scene?.tracks?.overlay) ? scene.tracks.overlay : []), ...(Array.isArray(scene?.tracks?.audio) ? scene.tracks.audio : [])] as ({ id?: unknown; type?: unknown; elements?: unknown } | undefined)[]) {
          if (!track || track.type !== "caption" || typeof track.id !== "string" || !Array.isArray(track.elements)) continue;
          found.push({ trackId: track.id, texts: (track.elements as { text?: unknown }[]).map((caption) => (typeof caption?.text === "string" ? caption.text.replace(/\s+/g, " ").trim().slice(0, 500) : "")).filter((text) => text.length > 0) });
        }
      }
      return found;
    } catch { return []; }
  };
  const countsOf = (texts: readonly string[]): { characters: number; lines: number } => ({ characters: texts.reduce((sum, text) => sum + text.length, 0), lines: texts.length });
  /** The caption track of a project that IS the whole a screen says it translates (as many captions, as many characters; the track it names, when it names one). Undefined: the host has no such track — the screen translates something else (some of the captions; a copy the host has not got yet). */
  const trackOf = (projectId: string, said: { characters: number; lines: number }, trackId?: string, holds?: (texts: string[]) => boolean): string[] | undefined =>
    captionsOf(projectId).find((track) => (!trackId || track.trackId === trackId) && track.texts.length === said.lines && countsOf(track.texts).characters === said.characters && (!holds || holds(track.texts)))?.texts;
  const live = (plan: Plan): boolean => now() - plan.at_ms < 30 * 60_000;
  const isBatchOf = (batches: readonly string[][], texts: readonly string[]): boolean => batches.some((batch) => batch.length === texts.length && batch.every((text, index) => text === texts[index]));
  /**
   * The whole a request is a batch of — found by CONTENT: a plan of this session that goes to the same language and has
   * exactly these captions as one of its batches. The one the answer names; else the newest one an estimate put on
   * record; else — nobody gave the captions — the caption track of the request's project, read by the host, when it is
   * the whole the request says it is a part of (`whole`). Undefined: the request is quoted by itself.
   */
  const planFor = (sessionId: string, input: { texts: string[]; targetName: string; source?: string; projectId?: string; whole?: { characters: number; lines: number } }, answer: SpendAnswer): Plan | undefined => {
    const fits = (plan: { batches: string[][]; targetName: string; source?: string }): boolean => plan.targetName === input.targetName && (plan.source ?? "") === (input.source ?? "") && isBatchOf(plan.batches, input.texts);
    const known = [...plans.values()].filter((plan) => plan.sessionId === sessionId && live(plan) && fits(plan)).sort((a, b) => b.at_ms - a.at_ms);
    const found = known.find((plan) => plan.id === answer.actionId) ?? known[0];
    if (found) return found;
    if (!input.projectId || !input.whole || input.whole.lines <= input.texts.length) return undefined;
    const chunks = (texts: string[]): string[][] => Array.from({ length: Math.ceil(texts.length / TRANSLATE_BATCH_MAX) }, (_, index) => texts.slice(index * TRANSLATE_BATCH_MAX, (index + 1) * TRANSLATE_BATCH_MAX));
    const read = trackOf(input.projectId, input.whole, undefined, (texts) => isBatchOf(chunks(texts), input.texts));
    return read ? planOf(sessionId, read, input.targetName, input.source) : undefined;
  };
  /** What the whole can cost: every batch's own figure (`quoteOf` of the route for THAT request), summed; null when any of them has no price. */
  const planUsd = (plan: { batches: string[][]; targetName: string; source?: string }): number | null => { let sum = 0; for (const batch of plan.batches) { const each = quoteOf(translatorsOf(workOf(batch, plan.targetName, plan.source)).list); if (each === null) return null; sum += each; } return money(sum); };
  const now = (): number => Date.now();
  /** The class of a failed candidate, as the fallback rules name it; undefined for what never moves on (a budget, a cancel, a refusal of the request itself). */
  const failureClass = (error: unknown): string | undefined => {
    const known = error as { class?: unknown; code?: unknown; details?: { reason?: unknown } };
    if (typeof known.class === "string") return known.class;
    if (known.details?.reason === "bad_answer") return "invalid_output";
    // A turn of a runtime's model that failed: its class is the one the failure was normalized to (rate limit, sign-in,
    // content refusal…) — a refusal of the request never moves on, a route that falls back on sign-in failures only does so for those.
    // The code of the failure is preferred when the turn hands it over (`details.turnCode`); else the sentence it was given.
    if (known.code !== "WORKFLOW_RUNTIME_UNAVAILABLE") return known.code === "UNAVAILABLE" ? "unknown" : undefined;
    const message = String((error as Error).message ?? ""), turnCode = typeof (known.details as { turnCode?: unknown } | undefined)?.turnCode === "string" ? (known.details as { turnCode: string }).turnCode : undefined;
    const said = turnFailureClass(message, turnCode);
    if (said !== "unknown") return said;
    // An agent CLI reports a failed turn in its own words (the runtime's diagnostic, its own code): they are normalized
    // the way every runtime failure is, so that a content refusal or a sign-in failure keeps its class.
    const normal = classifyTurnError(message, "the runtime");
    return turnFailureClass(normal.message, normal.code);
  };

  function status() {
    const generation = deps.generation(), listener = generation?.listener();
    // A Translation role whose profiles cannot serve is "not available", said — never another model stepping in unseen.
    let translator: Translator | undefined;
    try { translator = generation ? translatorOf() : undefined; } catch { translator = undefined; }
    return {
      transcription: listener ? { available: true, provider: listener.provider, label: listener.label, model: listener.model } : { available: false },
      translation: translator ? { available: true, provider: translator.provider, label: translator.label, model: translator.model, via: translator.via } : { available: false, reason: "no_route" },
      speech: { available: generation?.available("tts") === true },
    };
  }

  /** What speaking a text and listening back to it will cost, with the models that do it: the estimate a screen shows, and the quote the action is approved by. */
  function speechCost(input: { text: string; language?: string; again?: boolean }) {
    const generation = service(), spoken = generation.prepare({ capability: "tts", params: { text: input.text, ...(input.language ? { language: input.language } : {}) } }), listener = generation.listener(undefined, input.language);
    // (The read-back is of a recording that does not exist yet: no reading pace is assumed for it — ruling R4. Its price is known only where it does not depend on the recording's length; else it is "price not known — <listener>", and the request is made on the same terms: see `speak`.)
    // A recording in the cache is free only when it is the one that will be used: `again` records anew (`cache: "bypass"`), and that is paid.
    const speakUsd = spoken.hit && input.again !== true ? 0 : spoken.estimate.amountUsd, listenUsd = listener ? listener.estimateUsd : 0;
    const speaker = modelName(spoken.model.provider, spoken.model.id), hearer = listener ? modelName(listener.provider, listener.model) : undefined;
    return {
      amountUsd: speakUsd === null || listenUsd === null ? null : money(speakUsd + listenUsd), spoken, listener, speakUsd, listenUsd,
      quote: generation.gate.quote({ amountUsd: (speakUsd ?? 0) + (listenUsd ?? 0), models: [speaker, ...(hearer ? [hearer] : [])], unpriced: [...(speakUsd === null ? [speaker] : []), ...(listenUsd === null && hearer ? [hearer] : [])], plan: "captions.speak" }),
    };
  }
  const speakId = (sessionId: string, input: { text: string; language?: string; again?: boolean }): string => `captions.speak:${digest([sessionId, input.text, input.language ?? "", input.again === true])}`;
  /** The estimate a screen shows before it starts paid work, and whether that work must be confirmed. */
  function estimate(input: z.infer<typeof schemas.estimate>, connection?: Connection) {
    const generation = service(), confirmAboveUsd = generation.thresholds().confirmAboveUsd;
    const answer = <T extends Record<string, unknown>>(amountUsd: number | null, extra: T) => ({ amountUsd, confirmAboveUsd, needsConfirmation: generation.confirmationNeeded(amountUsd), ...extra });
    if (input.kind === "transcription") {
      const listener = generation.listener(input.seconds);
      if (!listener) throw new ProtocolError("NO_ROUTE", "No transcription model is connected on this host.", { details: { capability: "transcription" } });
      const pieces = input.pieces ?? 1, amountUsd = hearingUsd(input.seconds, pieces), name = modelName(listener.provider, listener.model), sessionId = connection ? `device:${connection.deviceId}` : undefined;
      if (connection) planned.set(`${connection.deviceId}:transcription`, { seconds: input.seconds, pieces, at_ms: now() });
      const confirmWith = sessionId ? minted(() => { const fixedId = wholeId.transcription(sessionId, input.seconds, pieces); fresh(fixedId, {}); generation.gate.open({ fixedId, kind: "captions.transcribe", owner: sessionId, quote: generation.gate.quote({ amountUsd: amountUsd ?? 0, models: [name], unpriced: amountUsd === null ? [name] : [], plan: "captions.transcribe: a recording" }) }); }) : undefined;
      return answer(amountUsd, { provider: listener.label, model: listener.model, ...(confirmWith ? { confirmWith } : {}) });
    }
    if (input.kind === "translation") {
      // The whole as it will be sent: the captions — as the screen gave them, else as the host reads them from the project's caption track (the track that is what the screen counted) — forty a request, with the names the requests carry.
      const texts = input.texts ?? (input.projectId && input.targetName ? trackOf(input.projectId, { characters: input.characters, lines: input.lines ?? 1 }, input.trackId) : undefined);
      const sessionId = connection ? `device:${connection.deviceId}` : undefined;
      const plan = texts && input.targetName ? (sessionId ? planOf(sessionId, texts, input.targetName, input.source) : { batches: Array.from({ length: Math.ceil(texts.length / TRANSLATE_BATCH_MAX) }, (_, index) => texts.slice(index * TRANSLATE_BATCH_MAX, (index + 1) * TRANSLATE_BATCH_MAX)), targetName: input.targetName, ...(input.source ? { source: input.source } : {}) }) : undefined;
      const { list } = translatorsOf(plan ? workOf(plan.batches[0], plan.targetName, plan.source) : undefined), translator = list[0];
      if (!translator) throw new ProtocolError("NO_ROUTE", "No translation model is connected on this host.", { details: { role: "translation" } });
      // Without the captions there is nothing to count: no stand-in text is priced — the amount is not known. And NO
      // question is put on record for it: no request could answer one (a request is held to the quote of its real
      // captions) — the person would be asked a second time. The question comes with the first batch, about what it is of.
      const amountUsd = plan ? planUsd(plan) : translator.own ? 0 : null, unpriced = unpricedOf(list);
      const confirmWith = sessionId && plan && "id" in plan ? minted(() => { const fixedId = plan.id; fresh(fixedId, {}); generation.gate.open({ fixedId, kind: "captions.translate", owner: sessionId, quote: generation.gate.quote({ amountUsd: amountUsd ?? 0, models: quoted(list), unpriced: amountUsd === null ? [nameOf(translator)] : [], plan: "captions.translate" }) }); }) : undefined;
      return answer(amountUsd, { provider: translator.label, model: translator.model, via: translator.via, ...ownOf(list), ...(unpriced.length ? { unpricedFallbacks: unpriced } : {}), ...(confirmWith ? { confirmWith } : {}) });
    }
    // Speaking, and listening back to the recording (about fifteen characters a second).
    const cost = speechCost(input), sessionId = connection ? `device:${connection.deviceId}` : undefined;
    const confirmWith = sessionId ? minted(() => generation.gate.open({ fixedId: speakId(sessionId, input), kind: "captions.speak", owner: sessionId, quote: cost.quote })) : undefined;
    return answer(cost.amountUsd, { provider: cost.spoken.model.provider, model: cost.spoken.model.id, ...(cost.listener ? { listener: cost.listener.model } : {}), ...(confirmWith ? { confirmWith } : {}) });
  }

  /**
   * One piece of speech, as text. The piece is a 16-bit WAV the device cut out at the pauses around it. The pieces of
   * one recording are ONE action: quoted for the whole recording (`wholeSeconds`, else the length the screen last
   * asked the estimate of), approved once, each piece then held to that approval by the gate.
   */
  async function transcribe(input: z.infer<typeof schemas.transcribe>, connection: Connection) {
    const generation = service(), listener = generation.listener();
    if (!listener) throw new ProtocolError("NO_ROUTE", "No transcription model is connected on this host. Connect a provider under Settings, Providers, Generation.", { details: { capability: "transcription" } });
    const bytes = new Uint8Array(Buffer.from(input.audio, "base64")), pcm = pcmOfWav(bytes);
    if (!pcm || !pcm.samples.length) throw new ProtocolError("INVALID_PARAMS", "The audio is not a 16-bit WAV recording.", { details: { field: "audio" } });
    const seconds = pcm.samples.length / pcm.rate;
    if (seconds > 30) throw new ProtocolError("INVALID_PARAMS", "A piece of speech is at most 30 seconds.", { details: { field: "audio" } });
    const sessionId = `device:${connection.deviceId}`, scope = { sessionId, ...(input.projectId ? { projectId: input.projectId } : {}) };
    const answer = answerOf(input), plan = plannedOf(connection.deviceId, "transcription"), declared = input.wholeSeconds ?? plan?.seconds, saidPieces = input.wholePieces ?? (input.wholeSeconds === undefined ? plan?.pieces : undefined);
    // A recording is ONE action, the one its estimate put on record — also when it is a single piece: the piece IS the
    // whole when the screen (or its estimate) said "one piece", or when the answer names that recording's question.
    const whole = declared !== undefined && (declared > seconds || saidPieces === 1 || answer.actionId === wholeId.transcription(sessionId, declared, saidPieces ?? 1)) ? declared : undefined;
    // The pieces of the whole: as the request says, else as the screen's estimate said; unknown → at least as many as pieces of this length make it.
    const pieces = whole ? Math.max(1, saidPieces ?? Math.ceil(whole / seconds)) : 1;
    const cost = whole ? hearingUsd(whole, pieces, input.language) : generation.listener(seconds, input.language)?.estimateUsd ?? null, name = modelName(listener.provider, listener.model);
    const fixedId = whole ? wholeId.transcription(sessionId, whole, pieces) : `captions.transcribe:${digest([sessionId, input.projectId ?? "", createHash("sha256").update(bytes).digest("hex")])}`;
    if (whole) fresh(fixedId, answer);
    let actionId: string;
    try { actionId = generation.gate.open({ fixedId, kind: "captions.transcribe", owner: sessionId, quote: generation.gate.quote({ amountUsd: cost ?? 0, models: [name], unpriced: cost === null ? [name] : [], plan: whole ? "captions.transcribe: a recording" : "captions.transcribe: a piece" }), answer }).id; } catch (error) {
      if (isSpendStop(error)) throw refusal(error, { provider: listener.label, model: listener.model }, { providerIds: [listener.provider], ...scope });
      throw error;
    }
    try {
      const heard = await generation.transcribe({ bytes, format: "wav", ...(input.language ? { language: input.language } : {}), seconds }, new AbortController().signal, { ...scope, action: actionId });
      if (!heard) throw new ProtocolError("NO_ROUTE", "No transcription model is connected on this host. Connect a provider under Settings, Providers, Generation.", { details: { capability: "transcription" } });
      // A piece that is its own action — or the only piece of its recording — has ended; the action of a longer recording is there for its other pieces.
      if (!whole || pieces === 1) generation.gate.close(actionId);
      return { text: heard.text.replace(/\s+/g, " ").trim(), model: heard.model, costUsd: heard.costUsd, seconds: Math.round(seconds * 1000) / 1000 };
    } catch (error) {
      if (isSpendStop(error)) throw refusal(error, { provider: listener.label, model: listener.model }, { providerIds: [listener.provider], ...scope });
      if (!whole || pieces === 1) generation.gate.close(actionId);
      throw error;
    }
  }

  /**
   * Up to forty captions in another language, one for one, written by the Translation role's model on the path its
   * route gives (`translatorOf`): work of the generation service, or a turn of a runtime's model. `by: "user"` (a
   * device's own request) is an action a person approves; a run of the host is the host's own work, held to its
   * budgets and to the account of the run that pays (`payer`). EVERY request that costs — the first, the repair of an
   * answer that was not accepted, a fallback, a turn — passes through the spend gate under that action.
   *
   * Where the action stands inside its work is kept with it (the gate's checkpoint: the candidate, whether its next
   * request is the repair, what this request has spent, which candidates failed), so the answer to a question
   * CONTINUES it: nothing that was paid for is paid for again, and the cost an answer reports is the whole request's.
   */
  type Standing = { candidates: string[]; index: number; attempt: number; costUsd: number; attempts: { provider: string; model: string; via: string; class: string }[]; /** The parts of this request that were already asked on the candidate it stands at (ruling R6: a request whose answer was cut at its limit is split): the translations of a part that fitted, or "cut" for a part whose answer was cut — neither is paid for again when the action goes on after a money question. */ parts?: Record<string, string[] | "cut"> };
  async function translate(input: z.infer<typeof schemas.translate>, connection: Connection, options: { by?: "user"; /** Who pays, when it is not the device: a run of the host (`run:<id>`). */ sessionId?: string; /** A run that pays keeps its own account: `reserve` is asked before EVERY call that costs (the first, a repair, a fallback) with that call's estimate — it throws to stop the call and returns what gives the share back; `turn` carries a translation by a runtime's model, so the turn is the run's (guarded, its cost counted). */ payer?: { reserve(estimateUsd: number | null): () => void; turn?: NonNullable<CaptionsDeps["workflows"]> extends () => infer W ? W extends { runs: { turn: infer T } } ? T : never : never } } = {}) {
    const generation = service(), characters = input.texts.reduce((sum, text) => sum + text.length, 0), prompt = translationPrompt(input.texts, input.targetName, input.source);
    const work = workOf(input.texts, input.targetName, input.source), { list, fallbackOn } = translatorsOf(work), first = list[0];
    if (!first) throw new ProtocolError("NO_ROUTE", "No model can translate on this host: give the Translation role a model under Settings, Model routing, or turn a translation model on under Settings, Providers, Generation.", { details: { role: "translation", capability: "translation" } });
    const scope = { sessionId: options.sessionId ?? `device:${connection.deviceId}`, ...(input.projectId ? { projectId: input.projectId } : {}) }, asks = { providerIds: list.filter((entry) => entry.via === "generation").map((entry) => entry.provider), ...scope };
    // A person's action is held to what they approved; a run of the host (no `by`) to its budgets and its own account.
    const held = options.by === "user", answer = answerOf(input), request = digest([scope.sessionId, input.projectId ?? "", input.source ?? "", input.target, input.targetName, input.texts]);
    // The whole this request is a batch of, when it is more than the request itself: the action is quoted for all of it.
    // It is found by what it IS (`planFor`: the captions an estimate was given, or the project's own caption track) —
    // never by what a screen counted. Only then is there a quote of the whole to hold the request to; any other
    // request is quoted by itself.
    const plan = held ? planFor(scope.sessionId, input, answer) : undefined;
    const whole = plan && (plan.batches.length > 1 || answer.actionId === plan.id) ? plan : undefined;
    const each = quoteOf(list), unpriced = unpricedOf(list), wholeUsd = whole ? planUsd(plan!) : each;
    const shown = { provider: first.label, model: first.model, via: first.via, ...ownOf(list), ...(unpriced.length ? { unpricedFallbacks: unpriced } : {}) };
    let actionId: string;
    if (held) {
      const fixedId = whole ? whole.id : `captions.translate:${request}`;
      if (whole) fresh(fixedId, answer);
      const amountUsd = money(wholeUsd ?? 0);
      try { actionId = generation.gate.open({ fixedId, kind: "captions.translate", owner: scope.sessionId, quote: generation.gate.quote({ amountUsd, models: quoted(list), unpriced: first.estimateUsd === null ? [nameOf(first)] : [], plan: whole ? "captions.translate" : `captions.translate: ${input.targetName}` }), answer }).id; } catch (error) {
        if (!isSpendStop(error)) throw error;
        // The question an action stopped at inside its work is about the candidate it stopped before.
        const at = error.question.at === "stop" ? ((generation.gate.action(error.actionId)?.checkpoints[request] as Standing | undefined)) : undefined, about = at ? list.find((entry) => nameOf(entry) === at.candidates[at.index]) : undefined;
        throw refusal(error, about ? { provider: about.label, model: about.model, via: about.via } : shown, asks);
      }
    }
    // A run of the host. One that confirmed its cost with its own person (`gate.cover`) spends under that. Any other has
    // NO authority of its own: only the host's "ask before spending more than", everything its session spends counted
    // together (`gate.unattended`) — past it, or at a price that is not known, it is refused with the money question
    // before anything is sent.
    else actionId = generation.gate.covered(scope.sessionId) ?? generation.gate.unattended("unattended", scope.sessionId, { provider: first.provider, model: first.model, via: first.via, estimateUsd: first.estimateUsd, kind: "translation" }, `unattended:${scope.sessionId}`);
    // The action of a run is the run's (or its session's) — not this request's to end.
    const runs = !held, single = held && !whole;
    // Two identical requests made together (a second click on "Start") are one piece of work.
    return generation.gate.once(`${actionId}:${request}`, async () => {
      const stored = held ? (generation.gate.action(actionId)?.checkpoints[request] as Standing | undefined) : undefined;
      // The route was changed meanwhile: the request goes through the new one from its start — what it has spent stays spent, and counted.
      const kept = stored && stored.candidates.join("|") === list.map(nameOf).join("|") ? stored : undefined;
      const attempts: Standing["attempts"] = kept ? [...kept.attempts] : [];
      let costUsd = stored?.costUsd ?? 0, last: unknown;
      /** What was already asked of this request's parts on the candidate it stands at (kept with the action over a money question). */
      let parts: NonNullable<Standing["parts"]> = kept?.parts ? { ...kept.parts } : {};
      /**
       * One request to a generation model for `texts` — and, when the provider says its answer was CUT at the limit
       * (ruling R6), NOT a repair and NOT that text: the same captions in two halves, each a request of its own with
       * its own limit, under the same action (every bill counts against the approval; past it the gate stops and
       * asks). A single caption whose answer is cut cannot be made smaller: it fails, as cut off. Returns the
       * translations, or undefined when an answer that was whole is not one translation per caption (the caller's
       * one repair is for THAT).
       */
      const asked = async (texts: readonly string[], translator: Translator, usedFallback: boolean, repair: boolean): Promise<{ translations?: string[]; model: string }> => {
        const key = digest([repair, texts]), known = parts[key];
        if (Array.isArray(known)) return { translations: known, model: translator.model };
        let cut = known === "cut";
        if (!cut) {
          const words = translationPrompt(texts, input.targetName, input.source), message = repair ? `${words}\nYour previous answer was not accepted: it must be ONLY a JSON array of exactly ${texts.length} strings, none of them empty.` : words;
          const written = await generation.translate({ prompt: message, characters: texts.reduce((sum, text) => sum + text.length, 0), lines: texts.length, maxOutputTokens: translationLimitOf(texts) }, undefined, { ...scope, provider: translator.provider, model: translator.model, usedFallback, action: actionId });
          if (!written) throw new ProtocolError("UNAVAILABLE", "This translation model is no longer available.", { retryable: true, details: { reason: "model_unavailable" } });
          costUsd += written.costUsd;
          cut = written.cutOff === true;
          if (!cut) { const translations = translationsOf(written.text, texts.length); if (translations) parts[key] = translations; return { ...(translations ? { translations } : {}), model: written.model }; }
          parts[key] = "cut";
        }
        if (texts.length < 2) throw new ProtocolError("UNAVAILABLE", "The translation of one caption did not fit the limit its request was sent with, and was cut off. Nothing of it was kept.", { retryable: false, details: { reason: "answer_cut_off", caption: input.texts.indexOf(texts[0]), limitTokens: translationLimitOf(texts) } });
        const middle = Math.ceil(texts.length / 2), head = await asked(texts.slice(0, middle), translator, usedFallback, repair), tail = await asked(texts.slice(middle), translator, usedFallback, repair);
        return { ...(head.translations && tail.translations ? { translations: [...head.translations, ...tail.translations] } : {}), model: tail.model };
      };
      const ended = (): void => { if (runs) return; if (single) generation.gate.close(actionId); else generation.gate.checkpoint(actionId, request, undefined); };
      const repairOf = (): string => `${prompt}\nYour previous answer was not accepted: it must be ONLY a JSON array of exactly ${input.texts.length} strings, none of them empty.`;
      // The candidates in the route's order. Each is asked under its own rules (a job's retry policy; a turn's failover
      // inside the runtime); the next one is asked only for a failure class of the route's fallback set, after the
      // policy's wait — never for a budget, a cancel or a refused request.
      for (let index = kept?.index ?? 0; index < list.length; index++) {
        const translator = list[index], resumed = !!kept && index === kept.index;
        if (!resumed) parts = {};
        if (index && !resumed) await generation.nextRoute();
        try {
          for (let attempt = resumed ? kept!.attempt : 0; attempt < 2; attempt++) {
            let written: { text: string; costUsd: number; model: string } | undefined;
            const message = attempt ? repairOf() : prompt;
            let release: (() => void) | undefined;
            try {
              release = options.payer?.reserve(translator.estimateUsd);
              if (translator.via === "runtime") {
                // One question, one answer, in a session of its own that is not kept; what the turn used is in Usage, like any turn.
                const ref = translator.ref!;
                const turn = await paidTurn(actionId, ref, options.payer?.turn ?? deps.workflows!().runs.turn, connection.deviceId, { ref: { runtimeId: ref.runtimeId, providerId: ref.providerId, modelId: ref.modelId }, ...(ref.thinking !== undefined ? { thinkingOptionId: ref.thinking } : {}), ...(ref.mode ? { modeId: ref.mode } : {}), title: `Translation — ${input.targetName}`.slice(0, 120), message, discard: true });
                written = { text: turn.text, costUsd: 0, model: ref.modelId };
              } else { const made = await asked(input.texts, translator, index > 0, attempt > 0); written = { text: made.translations ? JSON.stringify(made.translations) : "", costUsd: 0, model: made.model }; }
            } catch (error) {
              // The gate did not let this request out: the action is kept as it stands, and the person is asked — "spent so far + what remains", or plainly that this model's price is not known. Their answer continues from here.
              if (isSpendStop(error)) { if (held) generation.gate.checkpoint(actionId, request, { candidates: list.map(nameOf), index, attempt, costUsd, attempts: [...attempts], ...(Object.keys(parts).length ? { parts } : {}) } satisfies Standing); throw refusal(error, { provider: translator.label, model: translator.model, via: translator.via }, asks); }
              throw error;
            } finally { release?.(); }
            if (!written) throw new ProtocolError("UNAVAILABLE", "This translation model is no longer available.", { retryable: true, details: { reason: "model_unavailable" } });
            costUsd += written.costUsd;
            const translations = translationsOf(written.text, input.texts.length);
            if (translations) { ended(); return { translations, model: written.model, costUsd: money(costUsd), via: translator.via, ...(index ? { usedFallback: true as const, primary: { provider: first.provider, model: first.model }, reason: attempts[0]?.class ?? "unknown" } : {}) }; }
          }
          throw new ProtocolError("UNAVAILABLE", "The model did not answer with one translation per caption.", { retryable: true, details: { reason: "bad_answer", count: input.texts.length } });
        } catch (error) {
          // The money question is an answer of its own: it is never taken for a failure of the candidate.
          if ((error as { details?: { reason?: unknown } }).details?.reason === "confirmation_required") throw error;
          const failed = (error as { details?: { reason?: unknown } }).details?.reason === "model_unavailable" ? "model_unavailable" : failureClass(error);
          if (!failed || !fallbackOn.includes(failed)) { ended(); throw error; }
          attempts.push({ provider: translator.provider, model: translator.model, via: translator.via, class: failed });
          last = error;
        }
      }
      ended();
      // Every candidate failed: the last failure, with what each one said.
      if (attempts.length < 2) throw last;
      throw new ProtocolError("UNAVAILABLE", (last as Error).message, { retryable: true, details: { ...(last as { details?: Record<string, unknown> }).details, reason: (last as { details?: { reason?: unknown } }).details?.reason ?? attempts.at(-1)!.class, attempts } });
    });
  }
  /**
   * A turn of a runtime's model that this service pays for: ONE request of the action, through the spend gate like a
   * provider's — the host knows no price for it, so it goes out only to a model the person approved by name.
   */
  type Turn = ReturnType<NonNullable<CaptionsDeps["workflows"]>>["runs"]["turn"];
  function paidTurn(actionId: string, ref: { providerId: string; modelId: string }, turn: Turn, deviceId: string, input: Parameters<Turn>[1]): ReturnType<Turn> {
    return gate().guardTurn(turn, deps.turnCost)(actionId, ref, deviceId, input, null, { leaf: true }) as ReturnType<Turn>;
  }

  /**
   * A text spoken by the model of the Voice role, then listened back to: the recording is kept when what was heard is
   * the text (and its length fits), recorded once more when it is not, and returned with the verdict either way —
   * `unchecked` when nobody on this host can listen. ONE action: speaking and listening together are its quote, and
   * every request of it — the second recording and its read-back too — is held to what was approved.
   */
  async function speak(input: z.infer<typeof schemas.speak>, connection: Connection) {
    const generation = service();
    if (!generation.available("tts")) throw new ProtocolError("NO_ROUTE", "No speech model is connected on this host. Connect a provider under Settings, Providers, Generation.", { details: { capability: "tts" } });
    const sessionId = `device:${connection.deviceId}`, scope = { sessionId, ...(input.projectId ? { projectId: input.projectId } : {}) };
    const cost = speechCost(input), shown = { provider: cost.spoken.model.provider, model: cost.spoken.model.id, ...(cost.listener ? { listener: cost.listener.model } : {}) };
    const asks = { providerIds: [...new Set([cost.spoken.model.provider, cost.listener?.provider].filter((entry): entry is string => !!entry))], ...scope };
    const fixedId = speakId(sessionId, input);
    let actionId: string;
    try { actionId = generation.gate.open({ fixedId, kind: "captions.speak", owner: sessionId, quote: cost.quote, answer: answerOf(input) }).id; } catch (error) { if (isSpendStop(error)) throw refusal(error, shown, asks); throw error; }
    return generation.gate.once(actionId, async () => {
      type Spoken = { asset: GenerationAsset; seconds: number; check?: fm.SpeechCheck; unchecked?: fm.Unchecked };
      // Where the action stood when it stopped to ask: the recording to go on from, and the best one so far — so the answer repeats nothing that was paid for.
      type Standing = { attempt: number; best?: Spoken; recorded?: GenerationAsset };
      const kept = generation.gate.action(actionId)?.checkpoints.speak as Standing | undefined;
      let best: Spoken | undefined = kept?.best;
      // The gate did not let a request out: the action is kept as it stands, and its question says what was spent and
      // what the REST of it needs (a second recording is listened to as well) — one answer, then it goes on from here.
      const stop = (at: Standing): ProtocolError | undefined => {
        if (!generation.gate.pending(actionId)) return undefined;
        generation.gate.checkpoint(actionId, "speak", at);
        const again = speechCost({ ...input, again: true });
        generation.gate.rest(actionId, again.speakUsd === null || again.listenUsd === null ? null : (at.recorded ? 0 : again.speakUsd) + again.listenUsd);
        return refusal(generation.gate.pending(actionId)!, shown, asks);
      };
      try {
        for (let attempt = kept?.attempt ?? 0; attempt < 2; attempt++) {
          let asset = attempt === kept?.attempt ? kept.recorded : undefined;
          if (!asset) {
            let job: Awaited<ReturnType<GenerationService["settled"]>>;
            try { job = await generation.settled(generation.create({ capability: "tts", params: { text: input.text, ...(input.language ? { language: input.language } : {}) }, reuse: true, ...(input.projectId ? { projectId: input.projectId } : {}), ...(attempt > 0 || input.again ? { cache: "bypass" as const } : {}) }, { deviceId: connection.deviceId, by: "user", sessionId, priority: "interactive", action: actionId }).jobId); } catch (error) { if (isSpendStop(error)) throw stop({ attempt, ...(best ? { best } : {}) }) ?? error; throw error; }
            asset = job.results[0];
            if (job.state !== "succeeded" || !asset) throw stop({ attempt, ...(best ? { best } : {}) }) ?? new ProtocolError(job.state === "cancelled" ? "CANCELLED" : "UNAVAILABLE", job.error?.message ?? "The speech could not be made.", { retryable: job.state !== "cancelled", details: { reason: job.error?.class ?? job.state, jobId: job.jobId } });
          }
          const bytes = deps.sync.blobs.read(asset.blobId), pcm = pcmOfWav(bytes), seconds = pcm ? pcm.samples.length / pcm.rate : asset.durationSeconds ?? 0;
          let check: fm.SpeechCheck | undefined, why: fm.Unchecked["why"] = "no_listener";
          if (pcm && generation.listener()) {
            try {
              // ONE bound for the quote and the request: the read-back was quoted without a length (the recording did not exist), so it is reserved without one.
              const heard = await generation.transcribe({ bytes, format: "wav", ...(input.language ? { language: input.language } : {}) }, undefined, { ...scope, action: actionId });
              if (heard) check = fm.checkSpeech(input.text, seconds, heard.text);
            } catch (error) {
              if (isSpendStop(error)) throw stop({ attempt, ...(best ? { best } : {}), recorded: asset }) ?? error;
              if (["BUDGET_EXCEEDED", "CANCELLED", "PERMISSION_DENIED"].includes(String((error as { code?: string }).code))) throw error;
              why = "listener_failed";
            }
          }
          const made: Spoken = { asset, seconds, ...(check ? { check } : { unchecked: { seconds: Math.round(seconds * 100) / 100, why } }) };
          if (!best || (made.check?.ok && !best.check?.ok) || (made.check && best.check && made.check.score > best.check.score)) best = made;
          // Heard and right, or nobody can listen: recording again would not tell more.
          if (!check || check.ok) break;
        }
      } catch (error) {
        // An action that stopped to ask is kept, with its question and its charges; any other end of it is its end.
        if ((error as { details?: { reason?: unknown } }).details?.reason !== "confirmation_required") generation.gate.close(actionId);
        throw error;
      }
      // What the action cost is every charge of it — also of the requests made before a question, in an earlier call.
      const costUsd = generation.gate.spentOf(actionId);
      generation.gate.close(actionId);
      const done = best!;
      return { file: { blobId: done.asset.blobId, name: done.asset.name, mime: done.asset.mime, size: done.asset.size, provenance: done.asset.provenance }, seconds: Math.round(done.seconds * 1000) / 1000, costUsd, ...(done.check ? { check: done.check } : {}), ...(done.unchecked ? { unchecked: done.unchecked } : {}) };
    });
  }

  const methods = new Map<string, RpcMethod>();
  const define = (name: string, scope: Scope, handle: RpcMethod["handle"]): void => { methods.set(name, { scope, handle: async (raw, connection) => { try { return await handle(raw, connection); } catch (error) { return wire(error); } } }); };
  define("jagentchill.captions.status", READ, (raw) => { parse(schemas.status, raw); return status(); });
  define("jagentchill.captions.transcribe", RUN, (raw, connection) => transcribe(parse(schemas.transcribe, raw), connection));
  define("jagentchill.captions.estimate", RUN, (raw, connection) => estimate(parse(schemas.estimate, raw), connection));
  define("jagentchill.captions.translate", RUN, (raw, connection) => translate(parse(schemas.translate, raw), connection, { by: "user" }));
  define("jagentchill.captions.speak", RUN, (raw, connection) => speak(parse(schemas.speak, raw), connection));
  return { methods, status, estimate, transcribe, translate, speak };
}
export type CaptionsService = ReturnType<typeof createCaptionsService>;
