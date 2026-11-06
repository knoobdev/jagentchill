import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { generationParamsSchema, ORC_DEFAULT_FALLBACK_ON } from "@jagentchill/protocol";
import {
  GENERATION_CAPABILITIES, GENERATION_ERROR_INFO, GENERATION_METHOD_SCOPES, GENERATION_THRESHOLD_DEFAULTS, generationRpcParams, generationThresholdsSchema,
  type Budget, type GenerationAsset, type GenerationCapability, type GenerationCapabilityState, type GenerationConsent, type GenerationContentKind, type GenerationCreateParams,
  type GenerationErrorClass, type GenerationEstimate, type GenerationEstimateResult, type GenerationHealth, type GenerationJob, type GenerationLimits, type GenerationModel,
  type GenerationMessageCard, type GenerationModelMetadata, type GenerationParams, type GenerationPricing, type GenerationProvider, type GenerationThresholds, type GenerationVoice, type Scope,
} from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { SecretStore } from "../secrets/store.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import type { BlobStore } from "../sync/blobs.ts";
import type { MediaProbe } from "../sync/media-jobs.ts";
import { ProviderFailure, sniffMedia, type AdapterResult, type JcProviderAdapter } from "./adapter.ts";
import { BUNDLED_MODELS, DEFAULT_CONCURRENCY, PRICES_AS_OF, REFERENCES_MAX, estimateOf, speaks, violationOf, type PricedWork } from "./catalogue.ts";
import { REFERENCE_MAX_BYTES, REFERENCE_TOTAL_MAX_BYTES, createSmallPictures } from "./picture.ts";
import { GENERATION_MIGRATION } from "./schema.ts";
import { usdText, createSpendGate, isSpendStop, modelName, type SpendCall, type SpendStop, type SpendToken } from "./spend-gate.ts";

export type GenerationDeps = {
  db: DatabaseSync; config: ServerConfigFile; secrets: SecretStore; now: () => number; dataDir: string;
  blobs: BlobStore; probe: (path: string) => Promise<MediaProbe>;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  adapters: JcProviderAdapter[];
  /**
   * ORC: what Model routing says for the role of a capability. `configured` — the role has at least one profile, so
   * routing is in force for it: a request that names no model runs on the first of `targets` (primary, then fallbacks)
   * the host can use, with that profile's `params` as the request's defaults, and FAILS when there is none (`reason`:
   * the role is turned off, or why its profiles cannot serve). Not configured — the recommended model of the capability.
   */
  orcRoute?: (capability: GenerationCapability) => OrcRouted;
  /** Test only: the waits of the retry policy and of the health circuit. */
  timings?: { retryDelaysMs?: [number, number]; jitter?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; circuitMs?: number; /** The wait before the first attempt on the next candidate of a route (the retry policy's 30 s). */ nextRouteWaitMs?: number };
};
export type OrcRouted = { configured: boolean; targets: { provider: string; model: string; params?: Record<string, unknown> }[]; reason?: string };
/** Who asked for a job: a person on a device, or an agent's tool call. */
export type GenerationActor = {
  deviceId: string; by: "user" | "agent"; sessionId?: string; toolCallId?: string; priority?: GenerationJob["priority"];
  /**
   * The action of the spend gate this job's requests are charged to and held by (a film run, a screen's action, a
   * captions action): the caller opened it. Without one, a person's job is an action of its own — asked about like
   * any other — and an agent's is the host's own work (budgets only).
   */
  action?: string;
  /** This job is a person's retry of that failed or cancelled job. */
  retryOf?: string;
};

type Stored = {
  connections: Record<string, { secretName: string; source: "own" | "sign-in"; connected_ms: number; notice?: string }>;
  disabled: string[]; limits: Record<string, GenerationLimits>; thresholds: Partial<GenerationThresholds>; consents: GenerationConsent[];
  fetched_ms: Record<string, number>; refreshFailed_ms: Record<string, number>; warned: Record<string, number>; cacheLimitBytes?: number; /** The agent allowances a person set for ONE session (spec rules 2 and 3), by session key. */ sessionThresholds?: Record<string, { perCallApprovalUsd?: number; autoSessionBudgetUsd?: number }>;
};
type Overlay = {
  enabled?: boolean; label?: string; capability?: GenerationCapability; description?: string; metadata?: Partial<GenerationModelMetadata>; pricing?: GenerationPricing | null; source?: "fetched" | "user"; updated_ms: number;
  /** What the provider's own list said of a fetched model at the last refresh; a person's edits (`metadata`, `pricing`) go over it. */
  listed?: { metadata?: Partial<GenerationModelMetadata>; pricing?: GenerationPricing; fetched_ms: number };
};
type Health = { state: GenerationHealth; reason?: string; failures: number; recent: boolean[]; circuitUntil: number; lastSuccess_ms?: number; lastError?: string; pausedUntil: number };
type Internal = { contentKinds: GenerationContentKind[]; cacheKey: string; cacheable: boolean; cacheMode: "use" | "bypass"; idempotencyKey: string };
type Live = { job: GenerationJob; internal: Internal; abort: AbortController; emitted: number; /** What the provider has billed this job so far, every attempt counted — also one whose answer could not be kept. */ chargedUsd: number };
/** A job as it is stored: with the gate's action it spends under, and whether that action is the job's own (it ends with the job). */
type Gated = GenerationJob & { actionId?: string; ownsAction?: boolean; idempotencyKey?: string; /** The provider's handle of the task this job was accepted as (a video): with it the job is waited for again after the host restarted, and never sent a second time. */ task?: string };
/** The largest voice sample a speech request carries: the provider's documented limit of one inline reference (15 MiB of decoded media). */
export const VOICE_SAMPLE_MAX_BYTES = 15 * 1024 * 1024;

const DEFAULT_METADATA: Partial<Record<GenerationCapability, GenerationModelMetadata>> = {
  image: { resumable: false, cancellable: false, aspectRatios: ["1:1"], maxImages: 1, maxPromptLength: 4000, seed: false, negativePrompt: false, referenceImages: 0 },
  tts: { resumable: false, cancellable: false, voices: [], languages: ["multi"], formats: ["wav"], maxCharacters: 4000, wordTimings: false },
  music: { resumable: false, cancellable: false, durationSeconds: { min: 30, max: 30 }, instrumental: true, lyrics: false, maxPromptLength: 2000 },
  // A video model somebody typed in by hand: nothing is known of what it takes until its row says so.
  video: { resumable: true, cancellable: false },
};
/** Stochastic capabilities are served from the cache only on an explicit seed or `reuse`. */
const DETERMINISTIC: GenerationCapability[] = ["tts", "transcription", "translation"];
/** The options of an ORC profile a generation request takes as its defaults (the same set ORC's validation calls "applied"). */
const GENERATION_PROFILE_OPTIONS = new Set(Object.keys(generationParamsSchema.shape).filter((key) => !["prompt", "text", "referenceBlobIds", "negativePrompt", "lyrics"].includes(key)));
/** What connecting a provider means for what is sent to it (shown by the Providers screen). */
export const SENDING_NOTE = "Connecting lets JAgentChill send this provider what the features you start need — nothing is asked again for each action";
/** The same for a model that runs on the host. */
export const LOCAL_NOTE = "Nothing is sent anywhere: pictures are made on this computer";
/** What each kind of work sends to the provider that serves it. */
const SENDS: Partial<Record<GenerationCapability, string>> = {
  image: "Pictures: the description of each picture, and the reference pictures it is drawn with — a film's or a video's own sheets and frames, or pictures you chose — made small, without their file data",
  video: "Video: the description of each clip and the picture it starts from — a film's own frame — made small, without its file data",
  tts: "Voice: the text to be spoken (script lines, captions, text clips), and the voice sample of a character you gave one",
  music: "Music: the description of the music",
  transcription: "Listening: audio to be written back as text — the voice lines made here (to check them) and the speech of your clips (for captions)",
  translation: "Translation: the text of captions to be translated",
};
/** The kind of the jobs the host runs for itself (listening to a recording): stored, budgeted and logged like any job, not listed among a person's jobs. */
const INTERNAL_TRANSCRIPTION = "generation.transcription.internal";
/** The same for captions written in another language. */
const INTERNAL_TRANSLATION = "generation.translation.internal";
const RETRY_FULL: GenerationErrorClass[] = ["rate_limited", "timeout", "server_error", "network", "model_unavailable"], RETRY_ONCE: GenerationErrorClass[] = ["invalid_output", "unknown"];
const CACHE_TTL_MS = 30 * 86_400_000, JOB_TTL_MS = 30 * 86_400_000, PROGRESS_GAP_MS = 250;
const money = (value: number) => Math.round(value * 1e6) / 1e6;
const canonical = (value: unknown): string => (Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value ?? null));
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
function monthStart(now: number): number { const date = new Date(now); return new Date(date.getFullYear(), date.getMonth(), 1).getTime(); }

/**
 * Media generation on the host (`generation-providers`): the registry of providers by capability, their model
 * catalogue, cost estimates, the provider jobs with the one retry policy, budgets with reservation, consent, the
 * result cache, the cost ledger, and the channel methods of all of it. Keys never leave the host: every provider call
 * is made here, and a client sees a name and the last four characters at most.
 */
export function createGenerationService(deps: GenerationDeps) {
  const { db, now } = deps;
  db.exec(GENERATION_MIGRATION);
  // THE SPEND GATE: every paid provider request of this host passes through it (`spend`). The adapters are held here
  // only as the gate guards them — their paid methods take a token that nothing but `spend` gives.
  const gate = createSpendGate({ db, now, thresholdUsd: () => thresholds().confirmAboveUsd });
  const adapters = new Map(deps.adapters.map((adapter) => gate.guard(adapter)).map((adapter) => [adapter.describe().id, adapter]));
  // A provider that runs on the host (`local`): asked directly whether a model of it is installed — that costs nothing and is no request of the gate.
  const onHost = new Map([...adapters].filter(([, adapter]) => adapter.describe().local));
  const isLocal = (providerId: string) => onHost.has(providerId);
  const installed = (providerId: string, modelId: string) => onHost.get(providerId)?.ready?.(modelId) === true;
  const wait = deps.timings?.sleep ?? sleep, jitter = deps.timings?.jitter ?? Math.random, retryDelays = deps.timings?.retryDelaysMs ?? [2000, 8000], circuitMs = deps.timings?.circuitMs ?? 60_000, nextRouteWaitMs = deps.timings?.nextRouteWaitMs ?? 30_000;
  const health = new Map<string, Health>(), live = new Map<string, Live>(), waiters = new Map<string, ((job: GenerationJob) => void)[]>();
  const subscriptions = new WeakMap<Connection, { job: boolean; provider: boolean }>();
  let closed = false;
  const subscriptionOf = (connection: Connection) => { let found = subscriptions.get(connection); if (!found) subscriptions.set(connection, (found = { job: false, provider: false })); return found; };

  const stored = (): Stored => ({ connections: {}, disabled: [], limits: {}, thresholds: {}, consents: [], fetched_ms: {}, refreshFailed_ms: {}, warned: {}, ...(deps.config.get<Partial<Stored>>("generation") ?? {}) });
  const save = (patch: Partial<Stored>) => deps.config.set("generation", { ...stored(), ...patch });
  const thresholds = (): GenerationThresholds => ({ ...GENERATION_THRESHOLD_DEFAULTS, ...stored().thresholds });
  /** The two agent allowances as they hold for ONE session: its own where a person set one for it (spec rules 2 and 3), else the host's. */
  const sessionThresholds = (sessionKey: string): { perCallApprovalUsd: number; autoSessionBudgetUsd: number } => { const host = thresholds(), own = stored().sessionThresholds?.[sessionKey]; return { perCallApprovalUsd: Math.min(host.perCallApprovalUsd, own?.perCallApprovalUsd ?? host.perCallApprovalUsd), autoSessionBudgetUsd: own?.autoSessionBudgetUsd ?? host.autoSessionBudgetUsd }; };
  /** What the unfinished jobs of these sessions are estimated at: requests an allowance has let out and that have no ledger row yet. */
  const pendingUsd = (sessionIds: ReadonlySet<string>, since_ms = 0): number => money([...live.values()].filter((entry) => (entry.job.state === "queued" || entry.job.state === "running") && !!entry.job.sessionId && sessionIds.has(entry.job.sessionId) && entry.job.created_ms >= since_ms).reduce((sum, entry) => sum + (entry.job.estimateUsd ?? 0), 0));
  const adapterOf = (providerId: string) => adapters.get(providerId) ?? (() => { throw new ProtocolError("NOT_FOUND", "There is no such generation provider.", { details: { providerId } }); })();
  const healthOf = (providerId: string): Health => { let found = health.get(providerId); if (!found) health.set(providerId, (found = { state: "unknown", failures: 0, recent: [], circuitUntil: 0, pausedUntil: 0 })); return found; };
  const scrub = (text: string) => deps.secrets.redact(text);
  const changed = (providerId: string) => deps.broadcast("jagentchill.projects.read", "jagentchill.provider.changed", "provider", { providerId, generation: true }, (connection) => subscriptions.get(connection)?.provider === true);

  // ---- connection ----
  /** A key of this vendor that Sign-in & keys already holds. */
  function signInSecret(providerId: string): string | undefined {
    const profiles = deps.config.get<Record<string, Record<string, { secretName?: string; gatewayProvider: string }>>>("providerProfiles") ?? {};
    for (const group of Object.values(profiles)) for (const profile of Object.values(group)) if (profile.gatewayProvider === providerId && profile.secretName && deps.secrets.has(profile.secretName)) return profile.secretName;
    return undefined;
  }
  /** The key a call uses; a sign-in key that was removed since leaves the provider `invalid`. */
  const secretOf = (providerId: string): string | undefined => { const connection = stored().connections[providerId]; return connection ? deps.secrets.read(connection.secretName) : undefined; };
  /** A provider on the host is "connected" while a model of it is installed: it has no key. */
  const connectionOf = (providerId: string): GenerationProvider["connection"] => (isLocal(providerId) ? (BUNDLED_MODELS.some((model) => model.provider === providerId && installed(providerId, model.id)) ? "connected" : "not_connected")
    : !stored().connections[providerId] ? "not_connected" : secretOf(providerId) ? "connected" : "invalid");
  const enabled = (providerId: string) => !stored().disabled.includes(providerId);
  const usable = (providerId: string) => connectionOf(providerId) === "connected" && enabled(providerId);

  // ---- catalogue ----
  const overlays = (providerId: string): Map<string, Overlay> => new Map((db.prepare("SELECT model, json FROM gen_models WHERE provider = ?").all(providerId) as { model: string; json: string }[]).map((row) => [row.model, JSON.parse(row.json) as Overlay]));
  const setOverlay = (providerId: string, modelId: string, overlay: Overlay | null) => (overlay
    ? db.prepare("INSERT INTO gen_models (provider, model, json) VALUES (?, ?, ?) ON CONFLICT (provider, model) DO UPDATE SET json = excluded.json").run(providerId, modelId, JSON.stringify(overlay))
    : db.prepare("DELETE FROM gen_models WHERE provider = ? AND model = ?").run(providerId, modelId));
  /** Bundled rows, then the provider's live list, then what an admin added or edited — each over the one before. */
  function models(providerId: string): GenerationModel[] {
    const connected = connectionOf(providerId) === "connected", over = overlays(providerId), out: GenerationModel[] = [];
    for (const { verified = [], ...bundled } of BUNDLED_MODELS.filter((model) => model.provider === providerId)) {
      const edit = over.get(bundled.id);
      over.delete(bundled.id);
      // Three layers: the row as shipped, what the provider's own list said at the last refresh (except what was
      // measured on the real provider for this row), then a person's edits.
      const listedMeta = Object.fromEntries(Object.entries(edit?.listed?.metadata ?? {}).filter(([key]) => !(verified as readonly string[]).includes(key))), listedPrice = verified.includes("pricing") ? undefined : edit?.listed?.pricing;
      const pricing = edit?.pricing === undefined ? listedPrice ?? bundled.pricing : edit.pricing ?? undefined;
      out.push({
        ...bundled, ...(edit?.label ? { label: edit.label } : {}), metadata: { ...bundled.metadata, ...listedMeta, ...edit?.metadata }, ...(pricing ? { pricing } : { pricing: undefined }),
        enabled: connected && (!isLocal(providerId) || installed(providerId, bundled.id)) && (edit?.enabled ?? bundled.recommended === true), source: "bundled", pricesAsOf: edit?.pricing === undefined && listedPrice ? new Date(edit!.listed!.fetched_ms).toISOString().slice(0, 10) : PRICES_AS_OF, updated_ms: edit?.updated_ms ?? 0,
        ...(edit && (edit.metadata || edit.label || edit.pricing !== undefined) ? { edited: true } : {}), ...(edit?.pricing ? { customPrice: true } : {}),
      });
    }
    for (const [id, edit] of over) {
      if (!edit.capability || !edit.source) continue;
      out.push({
        provider: providerId, id, label: edit.label ?? id, capability: edit.capability, ...(edit.description ? { description: edit.description } : {}), enabled: connected && edit.enabled === true, source: edit.source,
        metadata: { resumable: false, cancellable: false, ...DEFAULT_METADATA[edit.capability], ...edit.listed?.metadata, ...edit.metadata },
        ...(edit.pricing ? { pricing: edit.pricing, customPrice: true } : edit.pricing === undefined && edit.listed?.pricing ? { pricing: edit.listed.pricing, pricesAsOf: new Date(edit.listed.fetched_ms).toISOString().slice(0, 10) } : {}),
        ...(edit.metadata ? { edited: true } : {}), updated_ms: edit.updated_ms,
      });
    }
    // No row offers more reference pictures than the measured cap — bundled, listed by the provider, or edited by a person.
    for (const model of out) if (model.capability === "image" && (model.metadata.referenceImages ?? 0) > REFERENCES_MAX) model.metadata = { ...model.metadata, referenceImages: REFERENCES_MAX };
    return out;
  }
  const allModels = () => [...adapters.keys()].flatMap(models);
  const smallPicture = createSmallPictures((blobId) => deps.blobs.read(blobId));
  /** How many recordings each provider is listening to right now. */
  const listening = new Map<string, number>();
  /** How many translations each provider is writing right now. */
  const translating = new Map<string, number>();
  /**
   * Who writes a translation AS A JOB of this service: the models of the Translation role when Model routing has any
   * — those the catalogue has a translation row for, on a connected generation provider that answers text — else the
   * enabled translation rows of the catalogue, the recommended first. A routed model the catalogue has no row for is
   * NOT a generation model: it is a model of a runtime, and the caller runs it as a turn of a session (the captions
   * service does); it is never sent through a generation adapter at an unknown price.
   */
  function translators(): GenerationModel[] {
    const routing = deps.orcRoute?.("translation"), rows = allModels().filter((model) => model.capability === "translation");
    const can = (provider: string) => !!adapters.get(provider)?.translate && usable(provider) && !!secretOf(provider);
    if (routing?.configured) return routing.targets.filter((target) => can(target.provider)).flatMap((target) => rows.filter((row) => row.provider === target.provider && row.id === target.model && !row.deprecated));
    return rows.filter((model) => model.enabled && !model.deprecated && can(model.provider)).sort((a, b) => Number(b.recommended === true) - Number(a.recommended === true));
  }
  /**
   * What a call that is not a listed job costs: the catalogue's ONE pricing function (`estimateOf` — its tiers, its
   * arithmetic) given how much work there is, for the estimate a person confirms and for the amount reserved and
   * charged alike. Null: no price; a kind that says nothing about this work (a price per picture or per clip for a
   * recording); or a length the price needs (per token, per second, per character) that the caller does not know.
   */
  function unlistedUsd(model: GenerationModel, params: GenerationParams, work: PricedWork): number | null {
    const kind = model.pricing?.kind;
    if (!kind || kind === "per_image" || kind === "per_clip") return null;
    if ((kind === "per_second" && !work.seconds) || (kind === "per_character" && work.characters === undefined)) return null;
    return estimateOf(model, params, work).amountUsd;
  }
  /**
   * A documented provider figure of a model's catalogue row (coordinator's ruling R4, 2026-10-08: no number prices
   * anything unless it is a count of the actual request or media, a limit really sent to the provider, or a documented
   * provider figure recorded WITH its source). A figure whose row does not say where it was read is not used.
   */
  const documented = (model: GenerationModel, field: "maxOutputTokens" | "audioTokensPerSecond"): number | undefined => {
    const value = model.metadata[field], source = model.metadata.sources?.[field];
    return typeof value === "number" && Number.isFinite(value) && value > 0 && typeof source === "string" && source.trim().length > 0 ? value : undefined;
  };
  /**
   * A translation request — the WHOLE request, as it is sent and billed: the prompt (the instruction as well as the
   * captions). What it can cost on a model is `translationUsd`; nothing about its answer is assumed here.
   * (`characters` and `lines`, the size of the text to translate, are accepted for the callers; they price nothing.)
   */
  type TranslationWork = { characters: number; prompt: string; /** The limit of the answer the request will SEND, in tokens (ruling R6: the caller derives it from the request — the bytes of the text to translate and of the answer's fixed structure). */ maxOutputTokens?: number };
  const translationWork = (prompt: string, _characters = 0, _lines = 1, maxOutputTokens?: number): TranslationWork => ({ characters: prompt.length, prompt, ...(maxOutputTokens && maxOutputTokens > 0 ? { maxOutputTokens: Math.ceil(maxOutputTokens) } : {}) });
  /**
   * The most a translation request can be billed on this model, or null — "price not known". Per token: the input is
   * the text of the request the adapter will send, counted in UTF-8 bytes (no tokenizer makes more tokens than a text
   * has bytes); the answer is at most the model's documented longest answer (`metadata.maxOutputTokens`, with its
   * source) — which is also SENT with the request as its limit, so the provider holds the answer to what was quoted.
   * The product sets no shorter limit of its own: how long a translation comes out is not known before it is written.
   */
  /**
   * The limit a translation request SENDS (`max_tokens`) — and so what its answer is quoted at (ruling R6): the limit
   * the caller derived from the request (`work.maxOutputTokens`), never above the model's documented longest answer;
   * without one from the caller, that documented figure. Neither: no limit can be sent, and a priced answer is "not known".
   */
  const translationLimit = (model: GenerationModel, work?: TranslationWork): number | undefined => { const longest = documented(model, "maxOutputTokens"), asked = work?.maxOutputTokens; return asked !== undefined ? (longest !== undefined ? Math.min(asked, longest) : asked) : longest; };
  /** The thinking a translation asks the model for, where its row says it can be switched off or turned down: it counts inside the limit of the answer (ruling R6). */
  const translationReasoning = (model: GenerationModel): "none" | "minimal" | undefined => (model.metadata.reasoning === "none" || model.metadata.reasoning === "minimal" ? model.metadata.reasoning : undefined);
  const translationUsd = (model: GenerationModel, work: TranslationWork): number | null => {
    if (model.pricing?.kind !== "tokens") return unlistedUsd(model, {}, { characters: work.characters });
    // A model whose thinking cannot be changed uses an unknown part of any limit: what a translation on it needs to be sent is not known.
    if (model.metadata.reasoning === "fixed") return null;
    const bytes = adapters.get(model.provider)?.textBytes?.({ translate: { prompt: work.prompt, model: model.id } }), limit = translationLimit(model, work);
    return unlistedUsd(model, {}, { characters: work.characters, ...(bytes !== undefined ? { inputTokens: bytes } : {}), ...(limit !== undefined ? { outputTokens: limit } : {}) });
  };
  /** The action of a call nobody approved by a quote (see `gate.unattended`): the session's, or the call's own. */
  const unattendedOf = (sessionId: string | undefined, call: SpendCall): string => gate.unattended("unattended", sessionId ?? "host", call, sessionId ? `unattended:${sessionId}` : `unattended:call:${randomUUID()}`);
  /** The refusal that carries a question of the gate, in the one shape of a money question (`confirmation`). */
  const asked = (stop: SpendStop, estimate: Record<string, unknown> = {}, scope: Parameters<typeof remaining>[0] = {}, extra: Record<string, unknown> = {}): ProtocolError =>
    new ProtocolError("PERMISSION_DENIED", stop.message, { details: stop.details(estimate, { confirmAboveUsd: thresholds().confirmAboveUsd, remainingUsd: remaining(scope), ...extra }) });
  /**
   * What listening to a recording can cost, or null — "price not known". `seconds` is the length of the ACTUAL
   * recording; a recording that does not exist yet (the read-back of a line that is about to be spoken) has none, and
   * no reading pace is assumed for it: its listening has a price only where the price does not depend on its length
   * (per call, free). Per token: the sound is `seconds` × the tokens the provider documents for a second of sound
   * (`metadata.audioTokensPerSecond`, with its source), the text of the request counted in bytes, and an answer of at
   * most the model's documented longest (`metadata.maxOutputTokens`, with its source) — any of them missing where
   * its side has a price: not known.
   */
  const listeningUsd = (model: GenerationModel, seconds: number | undefined, language?: string): number | null => {
    const params = language ? { language } : {};
    if (model.pricing?.kind !== "tokens") return unlistedUsd(model, params, seconds ? { seconds } : {});
    // The ANSWER: a transcription request carries no limit of its text (the adapter sends the model, the language and
    // the sound — the endpoint documents nothing that bounds what comes back), so nothing bounds it: a listener whose
    // answer has a price is "not known". (A longest answer the row documents is not a limit of THIS request — review 15 #6.)
    const rate = documented(model, "audioTokensPerSecond"), bytes = adapters.get(model.provider)?.textBytes?.({ transcribe: { model: model.id, ...(language ? { language } : {}) } });
    return unlistedUsd(model, params, { ...(seconds ? { seconds } : {}), ...(seconds && rate !== undefined && bytes !== undefined ? { inputTokens: Math.ceil(seconds * rate) + bytes } : {}) });
  };
  const classifyThrownFailure = (error: unknown, signal: AbortSignal): ProviderFailure => (signal.aborted ? new ProviderFailure("cancelled", "Cancelled.") : new ProviderFailure("unknown", error instanceof Error ? error.message.slice(0, 300) : "Unexpected failure."));
  /** A reference that is gone, or too large to be read into memory and re-encoded: told from the store's record, before any byte is read. */
  function referenceSizeProblem(ids: readonly string[]): { message: string; details: Record<string, unknown> } | undefined {
    let total = 0;
    for (const blobId of ids) {
      const status = deps.blobs.status(blobId);
      if (status.state !== "complete") return { message: "A reference picture of this request is no longer on the host.", details: { blobId } };
      if (status.size > REFERENCE_MAX_BYTES) return { message: `A reference picture is larger than ${REFERENCE_MAX_BYTES / 1_048_576} MB.`, details: { blobId, bytes: status.size, max: REFERENCE_MAX_BYTES } };
      total += status.size;
    }
    return total > REFERENCE_TOTAL_MAX_BYTES ? { message: `The reference pictures of one request are larger than ${REFERENCE_TOTAL_MAX_BYTES / 1_048_576} MB together.`, details: { bytes: total, max: REFERENCE_TOTAL_MAX_BYTES } } : undefined;
  }
  const makes = (providerId: string, capability: GenerationCapability): boolean => adapters.get(providerId)?.describe().capabilities.includes(capability) === true;
  /**
   * The model a request runs on: the one it names; else the one Model routing gives the capability's role (with the
   * profile's own options); else — only when that role has no profile at all — the recommended model of the capability.
   * A role that is turned off, or whose profiles cannot serve, is a failure that says so: no other model steps in unseen.
   */
  function resolveRoute(capability: GenerationCapability, providerId?: string, modelId?: string): { model: GenerationModel; defaults: Record<string, unknown> } {
    const none = (reason: string, extra: Record<string, unknown> = {}) => new ProtocolError("NO_ROUTE", `No provider is configured for ${capability}`, { details: { capability, reason, action: "Configure", ...extra } });
    if (providerId && modelId) {
      const model = models(adapterOf(providerId).describe().id).find((entry) => entry.id === modelId && entry.capability === capability);
      if (!model) throw new ProtocolError("NOT_FOUND", "This provider has no such model for this capability.", { details: { providerId, modelId, capability } });
      if (!usable(providerId)) throw none(connectionOf(providerId) !== "connected" ? "provider_not_connected" : "provider_disabled");
      if (!model.enabled) throw none("model_disabled");
      if (!makes(providerId, capability)) throw none("no_enabled_model");
      return { model, defaults: {} };
    }
    // A catalogue row is routable as a job only for what its provider's adapter makes.
    const candidates = allModels().filter((model) => model.capability === capability && model.enabled && !model.deprecated && usable(model.provider) && makes(model.provider, capability) && (!providerId || model.provider === providerId));
    const routing = deps.orcRoute?.(capability);
    if (routing?.configured) {
      for (const target of routing.targets) { const model = candidates.find((entry) => entry.provider === target.provider && entry.id === target.model); if (model) return { model, defaults: target.params ?? {} }; }
      const why = routing.reason ?? (routing.targets.length ? "The models of the role's profiles are turned off or their provider is not connected" : "No profile of the role can serve");
      throw new ProtocolError("NO_ROUTE", `Model routing gives ${capability} no usable model: ${why}. Change the role under Settings, Model routing.`, { details: { capability, reason: "orc_route_unusable", why, action: "Configure" } });
    }
    const found = candidates.find((model) => model.recommended) ?? candidates[0];
    if (!found) throw none("no_enabled_model");
    return { model: found, defaults: {} };
  }
  const route = (capability: GenerationCapability, providerId?: string, modelId?: string): GenerationModel => resolveRoute(capability, providerId, modelId).model;
  /**
   * The options of a profile that reach the provider for this model: the request options its adapter says it sends
   * (`sends`), less the ones the model's own row says it does not take (a seed, a pace — a request carrying one of
   * those is refused, so a profile must not put it there).
   */
  function appliedOptions(capability: string, providerId: string, modelId: string): string[] {
    const sent = (adapters.get(providerId)?.sends?.(capability as GenerationCapability, modelId) ?? []).filter((key) => GENERATION_PROFILE_OPTIONS.has(key));
    const meta = adapters.has(providerId) ? models(providerId).find((model) => model.id === modelId && model.capability === capability)?.metadata : undefined;
    return meta ? sent.filter((key) => (key === "seed" ? meta.seed === true : key === "speed" ? !!meta.speed : key === "instrumental" ? meta.instrumental !== false : true)) : sent;
  }
  /** A request's parameters over the options of the routed profile: what the request says wins, what it leaves open the profile decides. Only the options the model's adapter sends are taken: one that would reach nobody is dropped (and said by Model routing as not applied). */
  function withDefaults(model: GenerationModel, defaults: Record<string, unknown>, params: GenerationParams): GenerationParams {
    const applied = new Set(appliedOptions(model.capability, model.provider, model.id)), known = Object.fromEntries(Object.entries(defaults).filter(([key]) => applied.has(key)));
    if (!Object.keys(known).length) return params;
    const merged = generationParamsSchema.safeParse({ ...known, ...params });
    return merged.success ? merged.data : params;
  }
  async function refresh(providerId: string): Promise<{ added: number }> {
    const adapter = adapterOf(providerId);
    try {
      const listed = await adapter.listModels(secretOf(providerId)), known = new Set(BUNDLED_MODELS.filter((model) => model.provider === providerId).map((model) => model.id)), over = overlays(providerId);
      let added = 0;
      for (const model of listed) {
        // Ruling R7: a price read from the provider's own list is recorded WITH that origin and the day it was read.
        const said = { ...(model.metadata ? { metadata: model.metadata } : {}), ...(model.pricing ? { pricing: model.pricing.kind === "free" ? model.pricing : { ...model.pricing, source: { kind: "provider-list" as const, date: new Date(now()).toISOString().slice(0, 10) } } } : {}), fetched_ms: now() }, existing = over.get(model.id);
        // A model the catalogue ships with: what the provider says of it now lies beneath a person's edits (and beneath what was measured for the row).
        if (known.has(model.id)) { if (BUNDLED_MODELS.some((row) => row.provider === providerId && row.id === model.id && row.capability === model.capability)) setOverlay(providerId, model.id, { ...(existing ?? { updated_ms: 0 }), listed: said }); continue; }
        // A model fetched before keeps its switch and a person's edits; what the provider says of it now replaces what it said then.
        if (existing) { if (existing.source === "fetched") setOverlay(providerId, model.id, { ...existing, listed: said }); continue; }
        // New rows are off: a person turns a model on, or an ORC profile that names it does.
        setOverlay(providerId, model.id, { source: "fetched", capability: model.capability, label: model.label, ...(model.description ? { description: model.description } : {}), enabled: false, listed: said, updated_ms: now() });
        added++;
      }
      const state = stored(), { [providerId]: _failed, ...failures } = state.refreshFailed_ms;
      save({ fetched_ms: { ...state.fetched_ms, [providerId]: now() }, refreshFailed_ms: failures });
      changed(providerId);
      return { added };
    } catch (error) {
      save({ refreshFailed_ms: { ...stored().refreshFailed_ms, [providerId]: now() } });
      changed(providerId);
      throw new ProtocolError("UNAVAILABLE", "The model list could not be refreshed. The previous list stays in use.", { retryable: true, details: { class: error instanceof ProviderFailure ? error.class : "unknown" } });
    }
  }

  // ---- registry ----
  function limitsOf(providerId: string): GenerationLimits {
    // A model on the host makes one thing at a time, whatever was set.
    if (isLocal(providerId)) return { maxConcurrent: Object.fromEntries(adapterOf(providerId).describe().capabilities.map((capability) => [capability, 1])) };
    const set = stored().limits[providerId];
    return { maxConcurrent: { ...Object.fromEntries(adapterOf(providerId).describe().capabilities.map((capability) => [capability, DEFAULT_CONCURRENCY[capability]])), ...set?.maxConcurrent }, ...(set?.requestsPerMinute ? { requestsPerMinute: set.requestsPerMinute } : {}) };
  }
  function providerView(providerId: string): GenerationProvider {
    const definition = adapterOf(providerId).describe(), state = stored(), connection = state.connections[providerId], status = connectionOf(providerId), list = models(providerId), probe = healthOf(providerId);
    const counts: GenerationProvider["modelCounts"] = {};
    for (const model of list) { const count = (counts[model.capability] ??= { total: 0, enabled: 0 }); count.total++; if (model.enabled) count.enabled++; }
    const hint = connection ? deps.secrets.hint(connection.secretName) : undefined;
    const healthState: GenerationHealth = status !== "connected" ? "unknown" : !enabled(providerId) ? "disabled" : connection?.notice && probe.state === "unknown" ? "degraded" : definition.local && probe.state === "unknown" ? "ready" : probe.state;
    return {
      id: providerId, label: definition.label, description: definition.description, source: definition.source, host: definition.hosts[0] ?? "", capabilities: definition.capabilities, connection: status, enabled: enabled(providerId),
      health: healthState, ...(probe.reason ?? connection?.notice ? { healthReason: probe.reason ?? connection?.notice } : {}), ...(probe.lastSuccess_ms ? { lastSuccess_ms: probe.lastSuccess_ms } : {}), ...(probe.lastError ? { lastError: probe.lastError } : {}),
      secrets: definition.authFields.map((field) => ({ name: field.name, set: status === "connected", ...(hint ? { last4: hint.slice(-4) } : {}) })), modelCounts: counts, limits: limitsOf(providerId), sendingNote: definition.local ? LOCAL_NOTE : SENDING_NOTE,
      // One line per kind of work this provider serves on this host now (a model of that kind is on). A model on the host is sent nothing.
      sends: definition.local ? [] : (Object.keys(SENDS) as GenerationCapability[]).filter((capability) => (counts[capability]?.enabled ?? 0) > 0).map((capability) => SENDS[capability]!),
      ...(definition.docsUrl ? { docsUrl: definition.docsUrl } : {}), updated_ms: connection?.connected_ms ?? 0, signInKeyAvailable: !!signInSecret(providerId), ...(connection ? { keySource: connection.source } : {}),
      ...(state.refreshFailed_ms[providerId] && state.fetched_ms[providerId] ? { modelsAge_ms: now() - state.fetched_ms[providerId] } : {}),
    };
  }
  /** Every media capability with whether anything can serve it now; the ones without a provider get no entry point. */
  function capabilities(): GenerationCapabilityState[] {
    const routable = allModels().filter((model) => model.enabled && usable(model.provider) && makes(model.provider, model.capability));
    return GENERATION_CAPABILITIES.map((capability) => {
      if (routable.some((model) => model.capability === capability)) return { capability, available: true };
      const offered = [...adapters.values()].some((adapter) => adapter.describe().capabilities.includes(capability));
      return { capability, available: false, reason: offered ? `No provider is configured for ${capability}` : "no provider available" };
    });
  }
  async function connect(providerId: string, secretName: string | undefined, deviceId: string, replacing = false) {
    const adapter = adapterOf(providerId), own = !!secretName, name = secretName ?? signInSecret(providerId);
    const key = name ? deps.secrets.read(name) : undefined;
    if (!name || key === undefined) throw new ProtocolError("NOT_FOUND", own ? "The secret does not exist on this host. Send the key over the secret route first." : "No key of this provider is stored under Sign-in & keys.", { details: { providerId } });
    const drop = () => { if (own) deps.secrets.delete(name); };
    if (key.length < 8 || key.length > 512) { drop(); throw new ProtocolError("INVALID_PARAMS", "An API key has 8–512 characters.", { details: { path: "secretNames" } }); }
    const outcome = await adapter.validateConnection(key);
    audit(db, now(), `device:${deviceId}`, replacing ? "generation.provider.key.replace" : "generation.provider.connect", { providerId, outcome: outcome.outcome, source: own ? "own" : "sign-in" });
    if (outcome.outcome !== "ok" && outcome.outcome !== "quota") {
      drop();
      throw new ProtocolError(outcome.outcome === "network" ? "UNAVAILABLE" : "PERMISSION_DENIED", outcome.message, { retryable: outcome.outcome === "network", details: { outcome: outcome.outcome, ...(outcome.statusCode ? { statusCode: outcome.statusCode } : {}) } });
    }
    const previous = stored().connections[providerId];
    save({ connections: { ...stored().connections, [providerId]: { secretName: name, source: own ? "own" : "sign-in", connected_ms: now(), ...(outcome.outcome === "quota" ? { notice: outcome.message } : {}) } } });
    if (previous?.source === "own" && previous.secretName !== name) deps.secrets.delete(previous.secretName);
    health.set(providerId, { state: outcome.outcome === "quota" ? "degraded" : "ready", ...(outcome.outcome === "quota" ? { reason: outcome.message } : {}), failures: 0, recent: [], circuitUntil: 0, pausedUntil: 0 });
    await refresh(providerId).catch(() => undefined);
    changed(providerId);
    pump();
    return { provider: providerView(providerId), outcome: outcome.outcome, message: outcome.message };
  }
  function disconnect(providerId: string, deviceId: string) {
    adapterOf(providerId);
    const state = stored(), { [providerId]: connection, ...rest } = state.connections;
    if (!connection) throw new ProtocolError("NOT_FOUND", "This provider is not connected.");
    save({ connections: rest, consents: state.consents.filter((consent) => consent.providerId !== providerId) });
    if (connection.source === "own") deps.secrets.delete(connection.secretName);
    health.delete(providerId);
    for (const entry of [...live.values()]) if (entry.job.provider === providerId && entry.job.state === "queued") finish(entry, "cancelled", fault("cancelled", "The provider was disconnected.", { reason: "provider_disconnected" }));
    audit(db, now(), `device:${deviceId}`, "generation.provider.disconnect", { providerId });
    changed(providerId);
    return { provider: providerView(providerId) };
  }

  // ---- estimate, consent, budgets ----
  function estimateFor(model: GenerationModel, params: GenerationParams, scope: { projectId?: string; sessionId?: string }): GenerationEstimate {
    const estimate = estimateOf(model, params), block = budgetBlock(model.provider, scope, estimate.amountUsd);
    return { provider: model.provider, model: model.id, label: model.label, ...estimate, ...(block ? { blocked: block } : {}) };
  }
  const budgets = (): Budget[] => deps.config.get<Budget[]>("budgets") ?? [];
  const budgetColumn = (budget: Budget) => (budget.scope === "provider" ? "provider_id" : budget.scope === "project" ? "project_id" : budget.scope === "session" ? "session_key" : null);
  function spentOf(budget: Budget): number {
    const column = budgetColumn(budget), since = budget.period === "month" ? monthStart(now()) : 0;
    const row = db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS spent FROM budget_commits WHERE ts_ms >= ?${column ? ` AND ${column} = ?` : ""}`).get(...(column ? [since, budget.scopeId!] : [since])) as { spent: number };
    return money(row.spent);
  }
  const applicable = (providerId: string, scope: { projectId?: string; sessionId?: string }) => budgets().filter((budget) => budget.scope === "global" || (budget.scope === "provider" && budget.scopeId === providerId)
    || (budget.scope === "project" && !!scope.projectId && budget.scopeId === scope.projectId) || (budget.scope === "session" && !!scope.sessionId && budget.scopeId === scope.sessionId));
  /** The hard-stop budget this request would break, if any: spent + reserved + estimate against the limit. */
  function budgetBlock(providerId: string, scope: { projectId?: string; sessionId?: string }, amountUsd: number | null): GenerationEstimate["blocked"] {
    const hard = applicable(providerId, scope).filter((budget) => budget.hardStop);
    if (amountUsd === null) { const strict = hard.find((budget) => !budget.allowUnknownCost); return strict ? { reason: "unpriced_model", scope: strict.scope, ...(strict.scopeId ? { scopeId: strict.scopeId } : {}) } : undefined; }
    for (const budget of hard) {
      const remaining = money(Math.max(0, budget.limitUsd - spentOf(budget)));
      if (amountUsd > remaining + 1e-9) return { reason: "budget_exceeded", scope: budget.scope, ...(budget.scopeId ? { scopeId: budget.scopeId } : {}), remainingUsd: remaining };
    }
    return undefined;
  }
  /** A hard-stop budget in scope forbids this request: said as that, before anybody is asked to confirm a cost that cannot be spent. */
  function refuseOverBudget(providerId: string, scope: { projectId?: string; sessionId?: string }, amountUsd: number | null): void {
    const block = budgetBlock(providerId, scope, amountUsd);
    if (!block) return;
    throw new ProtocolError("BUDGET_EXCEEDED", block.reason === "unpriced_model" ? "This model has no known price, and a budget in scope does not allow unknown-cost models." : `Budget reached — ${block.scope}`,
      { details: { scope: block.scope, scopeId: block.scopeId ?? null, ...(block.remainingUsd !== undefined ? { remainingUsd: block.remainingUsd } : {}), ...(block.reason === "unpriced_model" ? { reason: "unpriced_model" } : {}), class: "budget_exceeded" } });
  }
  /** Reserves the estimate against every budget in scope, or refuses before anything is sent. One statement: two requests cannot both take the last of a budget. */
  function reserve(job: GenerationJob): string[] {
    const scope = { ...(job.projectId ? { projectId: job.projectId } : {}), ...(job.sessionId ? { sessionId: job.sessionId } : {}) };
    refuseOverBudget(job.provider, scope, job.estimateUsd);
    db.prepare("INSERT INTO budget_commits (ref, provider_id, project_id, session_key, amount_usd, unpriced, ts_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`gen:${job.jobId}`, job.provider, job.projectId ?? null, job.sessionId ?? null, job.estimateUsd ?? 0, job.estimateUsd === null ? 1 : 0, now());
    // The first time a budget passes 80% in its period, the job that did it says so.
    const warnings: string[] = [], warned = { ...stored().warned };
    for (const budget of applicable(job.provider, scope)) {
      const key = `${budget.scope}:${budget.scopeId ?? ""}`, period = budget.period === "month" ? monthStart(now()) : 1;
      if (spentOf(budget) >= budget.limitUsd * 0.8 && warned[key] !== period) { warned[key] = period; warnings.push(`The ${budget.scope} budget of $${budget.limitUsd.toFixed(2)} is at least 80% used`); }
    }
    if (warnings.length) save({ warned });
    return warnings;
  }
  const settle = (jobId: string, actualUsd: number | null) => (actualUsd === null || actualUsd > 0
    ? db.prepare("UPDATE budget_commits SET amount_usd = ? WHERE ref = ?").run(actualUsd ?? 0, `gen:${jobId}`)
    : db.prepare("DELETE FROM budget_commits WHERE ref = ?").run(`gen:${jobId}`));
  const release = (jobId: string) => db.prepare("DELETE FROM budget_commits WHERE ref = ?").run(`gen:${jobId}`);
  /**
   * Before a FURTHER attempt of a job — EVERY further attempt, whether the earlier ones were billed or not, and at the
   * moment it is sent (after the wait of the retry policy: a budget set or lowered during that wait holds it): what the
   * earlier attempts were billed is committed to the budgets as spent, and the next attempt's estimate is checked
   * against every budget in scope and reserved on top of it — exactly as a first request is. A hard-stop budget that
   * does not hold it refuses the retry before it is sent (`BUDGET_EXCEEDED`); the bills stay committed. One
   * transaction: two retries cannot both take the last of a budget.
   */
  function reserveNext(job: GenerationJob, billedUsd: number): void {
    gate.atomically(() => {
      db.prepare("UPDATE budget_commits SET amount_usd = ?, unpriced = 0 WHERE ref = ?").run(billedUsd, `gen:${job.jobId}`);
      refuseOverBudget(job.provider, { ...(job.projectId ? { projectId: job.projectId } : {}), ...(job.sessionId ? { sessionId: job.sessionId } : {}) }, job.estimateUsd);
      db.prepare("UPDATE budget_commits SET amount_usd = ?, unpriced = ? WHERE ref = ?").run(money(billedUsd + (job.estimateUsd ?? 0)), job.estimateUsd === null ? 1 : 0, `gen:${job.jobId}`);
    });
  }
  /** What the tightest hard-stop budget in scope still leaves for work on these providers; null when no such budget applies. */
  function remaining(scope: { providerIds?: readonly string[]; projectId?: string; sessionId?: string }): number | null {
    const hard = budgets().filter((budget) => budget.hardStop && (budget.scope === "global" || (budget.scope === "provider" && (scope.providerIds ?? []).includes(budget.scopeId ?? ""))
      || (budget.scope === "project" && !!scope.projectId && budget.scopeId === scope.projectId) || (budget.scope === "session" && !!scope.sessionId && budget.scopeId === scope.sessionId)));
    return hard.length ? Math.min(...hard.map((budget) => money(Math.max(0, budget.limitUsd - spentOf(budget))))) : null;
  }
  /** "Ask before spending more than": an action a person starts is confirmed first when its estimate is above the host's amount, or unknown. */
  const confirmationNeeded = (amountUsd: number | null): boolean => amountUsd === null || amountUsd > thresholds().confirmAboveUsd;
  /**
   * The ONE money question of an action a person starts (a job, a batch, a whole run): refused before anything is
   * made, with what the confirmation shows — the estimate (`amountUsd`, null when unknown, and whatever breakdown and
   * models the caller has), the host's amount and what the budgets in scope still leave. The same call with
   * `confirmed: true` then runs to its end with no second question.
   */
  const confirmation = (estimate: { amountUsd: number | null } & Record<string, unknown>, scope: Parameters<typeof remaining>[0] = {}, extra: Record<string, unknown> = {}): ProtocolError =>
    new ProtocolError("PERMISSION_DENIED", "Confirm the cost of this request first.", { details: { reason: "confirmation_required", estimate, confirmAboveUsd: thresholds().confirmAboveUsd, remainingUsd: remaining(scope), ...extra } });
  /**
   * NOTHING IS ASKED PER ACTION (owner decision, 2026-10-08). A provider the host has connected and enabled is sent
   * what the feature a person started needs — what the product generated and the person's own media alike: starting
   * the feature is the instruction. What goes where is told once, where the provider is connected and in Settings,
   * Providers (`sendingNote`, `sends` of the provider). So no content kind is ever "missing consent"; the `consent`
   * and `contentKinds` parameters and the consent methods are still accepted, and decide nothing.
   */
  const consentFor = (_providerId: string, _kinds: GenerationContentKind[]): GenerationContentKind[] => [];

  // ---- ledger and cache ----
  function ledger(job: GenerationJob, outcome: "succeeded" | "failed" | "cancelled", extra: { units?: AdapterResult["units"]; actualUsd: number | null; priceSource: string; errorClass?: string; duration_ms: number }) {
    db.prepare("INSERT INTO gen_ledger (id, ts_ms, provider, model, capability, project_id, session_id, job_id, tool_call_id, units, estimate_usd, actual_usd, price_source, outcome, error_class, cache_hit, used_fallback, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), now(), job.provider, job.model, job.capability, job.projectId ?? null, job.sessionId ?? null, job.jobId, job.toolCallId ?? null, JSON.stringify(extra.units ?? {}), job.estimateUsd, extra.actualUsd, extra.priceSource, outcome, extra.errorClass ?? null, job.cacheHit ? 1 : 0, job.usedFallback ? 1 : 0, extra.duration_ms);
  }
  function cacheKeyOf(model: GenerationModel, params: GenerationParams): string {
    const { prompt, negativePrompt, seed, referenceBlobIds, ...rest } = params;
    return createHash("sha256").update(canonical({ capability: model.capability, provider: model.provider, model: model.id, normalisedParams: rest, prompt: prompt ?? null, negativePrompt: negativePrompt ?? null, instructions: null, referenceBlobHashes: referenceBlobIds ?? [], seed: seed ?? null })).digest("hex");
  }
  function cached(key: string): GenerationAsset[] | undefined {
    const row = db.prepare("SELECT results, used_ms FROM gen_cache WHERE key = ?").get(key) as { results: string; used_ms: number } | undefined;
    if (!row) return undefined;
    const results = JSON.parse(row.results) as GenerationAsset[];
    // An entry not used for 30 days, or whose file is gone from the blob store, is no longer an answer.
    if (now() - row.used_ms > CACHE_TTL_MS || results.some((asset) => deps.blobs.status(asset.blobId).state !== "complete")) { db.prepare("DELETE FROM gen_cache WHERE key = ?").run(key); return undefined; }
    db.prepare("UPDATE gen_cache SET used_ms = ? WHERE key = ?").run(now(), key);
    return results;
  }
  const cacheLimit = () => stored().cacheLimitBytes ?? 20 * 1024 ** 3;
  function cachePut(key: string, capability: string, results: GenerationAsset[]) {
    db.prepare("INSERT INTO gen_cache (key, capability, results, bytes, created_ms, used_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET results = excluded.results, bytes = excluded.bytes, used_ms = excluded.used_ms")
      .run(key, capability, JSON.stringify(results), results.reduce((sum, asset) => sum + asset.size, 0), now(), now());
    // Least recently used entries go first; only the index entry is dropped, never a file a project may use.
    let total = (db.prepare("SELECT COALESCE(SUM(bytes), 0) AS bytes FROM gen_cache").get() as { bytes: number }).bytes;
    for (const row of db.prepare("SELECT key, bytes FROM gen_cache ORDER BY used_ms ASC").all() as { key: string; bytes: number }[]) {
      if (total <= cacheLimit() || row.key === key) break;
      db.prepare("DELETE FROM gen_cache WHERE key = ?").run(row.key); total -= row.bytes;
    }
  }

  // ---- jobs ----
  const persist = (job: GenerationJob) => db.prepare("INSERT INTO gen_jobs (job_id, kind, state, project_id, batch_id, json, created_ms, finished_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (job_id) DO UPDATE SET state = excluded.state, json = excluded.json, finished_ms = excluded.finished_ms")
    .run(job.jobId, job.kind, job.state, job.projectId ?? null, job.batchId ?? null, JSON.stringify(job), job.created_ms, job.finished_ms ?? null);
  const stored_job = (jobId: string): GenerationJob | undefined => { const row = db.prepare("SELECT json FROM gen_jobs WHERE job_id = ?").get(jobId) as { json: string } | undefined; return row && (JSON.parse(row.json) as GenerationJob); };
  const jobOf = (jobId: string): GenerationJob => live.get(jobId)?.job ?? stored_job(jobId) ?? (() => { throw new ProtocolError("NOT_FOUND", "There is no such job.", { details: { jobId } }); })();
  const terminal = (job: GenerationJob) => job.state === "succeeded" || job.state === "failed" || job.state === "cancelled";
  /** Where a queued job stands among the queued jobs of its provider. */
  const position = (job: GenerationJob) => { if (job.state !== "queued") return void delete job.queuePosition; const ahead = [...live.values()].filter((other) => other.job.state === "queued" && other.job.provider === job.provider); job.queuePosition = ahead.indexOf(live.get(job.jobId)!) + 1 || ahead.length + 1; };
  function emit(entry: Live, force = false) {
    const job = entry.job;
    if (!force && !terminal(job) && now() - entry.emitted < PROGRESS_GAP_MS) return;
    entry.emitted = now();
    position(job);
    deps.broadcast("jagentchill.projects.read", "jagentchill.job.updated", "job", { job }, (connection) => subscriptions.get(connection)?.job === true);
  }
  const fault = (errorClass: GenerationErrorClass, raw: string, details: Record<string, unknown> = {}): NonNullable<GenerationJob["error"]> => {
    const info = GENERATION_ERROR_INFO[errorClass], categories = Array.isArray(details.categories) ? ` (${(details.categories as string[]).join(", ")})` : "";
    return { class: errorClass, message: `${info.message}${categories}`, action: info.action, retryable: info.retryable !== false, details: { ...details, providerMessage: scrub(String(details.providerMessage ?? raw)).slice(0, 600) } };
  };
  function finish(entry: Live, state: "succeeded" | "failed" | "cancelled", error?: GenerationJob["error"]) {
    const job = entry.job;
    if (terminal(job)) return;
    job.state = state; job.finished_ms = now(); delete job.status;
    if (state === "succeeded") job.progress = 1;
    if (error) job.error = error;
    // A job that did not succeed gives its reservation back — except what the provider billed on the way: that was spent.
    if (state !== "succeeded") { if (entry.chargedUsd > 0) { job.actualUsd = money(entry.chargedUsd); settle(job.jobId, job.actualUsd); } else release(job.jobId); }
    if ((job as Gated).ownsAction && (job as Gated).actionId) gate.close((job as Gated).actionId!);
    persist(job);
    live.delete(job.jobId);
    emit(entry, true);
    for (const done of waiters.get(job.jobId) ?? []) done(job);
    waiters.delete(job.jobId);
    pump();
  }
  /** What a provider's answer does to its health: three failures in a row open the circuit for a minute. */
  function noteHealth(providerId: string, failure?: ProviderFailure) {
    const state = healthOf(providerId), before = state.state;
    if (!failure) { if (before === "down") state.recent = []; state.failures = 0; state.circuitUntil = 0; state.recent.push(true); state.lastSuccess_ms = now(); state.state = "ready"; delete state.reason; }
    else if (failure.class === "auth_error") { state.state = "unauthorized"; state.reason = "Reconnect the provider"; state.lastError = scrub(failure.message).slice(0, 300); }
    else if (["network", "timeout", "server_error", "model_unavailable"].includes(failure.class)) {
      state.failures++; state.recent.push(false); state.lastError = scrub(failure.message).slice(0, 300);
      if (state.failures >= 3) { state.state = "down"; state.reason = "The provider is not answering"; state.circuitUntil = now() + circuitMs; }
    } else if (failure.class === "rate_limited") state.recent.push(false);
    state.recent = state.recent.slice(-20);
    if (state.state === "ready" && state.recent.length >= 5 && state.recent.filter((ok) => !ok).length / state.recent.length >= 0.2) { state.state = "degraded"; state.reason = "Some requests are failing"; }
    if (state.state !== before) changed(providerId);
  }
  /** One provider call with the checks that come before it. */
  async function attempt(entry: Live, model: GenerationModel, token: SpendToken): Promise<AdapterResult> {
    const job = entry.job, state = healthOf(job.provider), secret = isLocal(job.provider) ? "" : secretOf(job.provider);
    if (isLocal(job.provider) && !installed(job.provider, job.model)) throw new ProviderFailure("model_unavailable", "This local model is not downloaded. Download it under Settings, Providers, Generation, Local models.");
    if (secret === undefined || (!secret && !isLocal(job.provider))) throw new ProviderFailure("auth_error", "No key is stored for this provider.");
    if (state.circuitUntil > now()) throw new ProviderFailure("model_unavailable", "The provider is not answering; calls are held back for a minute.");
    // The reference pictures are read here, at the call: a file that left the store since the request is said, not skipped.
    // They are sent small (longest side 768 px, JPEG, re-encoded so no EXIF, GPS or other metadata of the file leaves the
    // host): the provider bills every reference and the request carries every byte of it. A file is sized before it is
    // read. A host that cannot re-encode (no ffmpeg) sends no reference at all rather than the original file.
    const ids = job.params.referenceBlobIds ?? [];
    if (ids.length > REFERENCES_MAX) throw new ProviderFailure("invalid_request", `A request carries at most ${REFERENCES_MAX} reference pictures.`, { details: { max: REFERENCES_MAX } });
    const oversized = referenceSizeProblem(ids);
    if (oversized) throw new ProviderFailure("invalid_request", oversized.message, { details: oversized.details });
    const references = await Promise.all(ids.map(async (blobId) => {
      const bytes = deps.blobs.read(blobId);
      if (!sniffMedia(bytes)?.mime.startsWith("image/")) throw new ProviderFailure("invalid_request", "A reference of this request is not a picture.", { details: { blobId } });
      const small = await smallPicture(blobId);
      if (!small) throw new ProviderFailure("invalid_request", "This host cannot prepare reference pictures for sending: ffmpeg is missing, or it could not read the picture.", { details: { blobId } });
      return { bytes: small, mime: "image/jpeg" };
    }));
    // The voice sample of a speech request is read here too, and is a recording: anything else is said, never sent.
    let voiceSample: { bytes: Uint8Array; mime: string } | undefined;
    if (job.params.voiceSampleBlobId) {
      const status = deps.blobs.status(job.params.voiceSampleBlobId);
      if (status.state !== "complete") throw new ProviderFailure("invalid_request", "The voice sample of this request is no longer on the host.", { details: { blobId: job.params.voiceSampleBlobId } });
      if (status.size > VOICE_SAMPLE_MAX_BYTES) throw new ProviderFailure("invalid_request", `A voice sample is at most ${VOICE_SAMPLE_MAX_BYTES / 1_048_576} MB.`, { details: { bytes: status.size, max: VOICE_SAMPLE_MAX_BYTES } });
      const bytes = deps.blobs.read(job.params.voiceSampleBlobId), kind = sniffMedia(bytes)?.mime;
      if (!kind?.startsWith("audio/")) throw new ProviderFailure("invalid_request", "The voice sample of this request is not a recording.", { details: { blobId: job.params.voiceSampleBlobId } });
      voiceSample = { bytes, mime: kind };
    }
    const gated = job as Gated, resume = gated.task;
    // The provider's handle of an accepted task goes into the store with the job AT ONCE: a host that stops a moment later still knows what it is waiting for.
    const task = { ...(resume ? { resume } : {}), started: (handle: string): void => { if (!terminal(job)) { gated.task = handle; job.status = "The provider is making it"; persist(job); emit(entry, true); } } };
    const { result } = await adapterOf(job.provider).submit({ capability: job.capability, model: job.model, params: job.params, metadata: model.metadata, ...(references.length ? { references } : {}), ...(voiceSample ? { voiceSample } : {}) }, {
      secret, signal: entry.abort.signal, idempotencyKey: entry.internal.idempotencyKey,
      progress: (fraction) => { if (!terminal(job)) { job.progress = Math.max(job.progress, Math.min(0.99, fraction)); emit(entry); } },
      task,
    }, token);
    return result;
  }
  /** Stores what the provider returned: each file is checked to be what was asked for before it becomes a blob. */
  async function store(job: GenerationJob, result: AdapterResult, costUsd: number | null): Promise<GenerationAsset[]> {
    const assets: GenerationAsset[] = [], dir = join(deps.dataDir, "tmp"), wanted = job.capability === "image" ? "image" : job.capability === "video" ? "video" : "audio";
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const label = (job.params.prompt ?? job.params.text ?? job.capability).replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 40) || job.capability;
    for (const [index, output] of result.outputs.entries()) {
      const extension = output.mime.split("/")[1]?.replace("mpeg", "mp3").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin", file = join(dir, `gen-${job.jobId}-${index}.${extension}`);
      // A decoder will read almost anything as some format: the file must first be a container this editor knows.
      if (!sniffMedia(output.bytes)) throw new ProviderFailure("invalid_output", "The provider returned a file that cannot be decoded.");
      if (wanted === "video") {
        // A clip: it must really hold moving pictures, and it is kept with its size and its length.
        writeFileSync(file, output.bytes, { mode: 0o600 });
        let clip: MediaProbe;
        try { clip = await deps.probe(file); } catch { throw new ProviderFailure("invalid_output", "The provider returned a file that cannot be decoded."); } finally { rmSync(file, { force: true }); }
        if (!clip.video || !(clip.duration_s > 0)) throw new ProviderFailure("invalid_output", "The provider returned a file that is not a video.");
        const clipName = `${label}${result.outputs.length > 1 ? ` ${index + 1}` : ""}.${extension}`, kept = deps.blobs.put(output.bytes, { mime: output.mime, name: clipName, purpose: "media" });
        assets.push({
          blobId: kept.sha256, mime: output.mime, name: clipName, size: kept.size, kind: "video", width: clip.width, height: clip.height, durationSeconds: Math.round(clip.duration_s * 1000) / 1000, ...(clip.codec ? { codec: clip.codec } : {}),
          provenance: { source: "ai", provider: job.provider, model: job.model, role: job.capability, ...(job.params.prompt ? { prompt: job.params.prompt } : {}), ...(job.params.seed !== undefined ? { seed: job.params.seed } : {}), jobId: job.jobId, ...(costUsd !== null ? { cost: { amount: money(costUsd / result.outputs.length), currency: "USD" as const } } : {}), created_ms: now(), referenceAssetIds: [...(job.params.referenceBlobIds ?? [])] },
        });
        continue;
      }
      writeFileSync(file, output.bytes, { mode: 0o600 });
      let facts: MediaProbe;
      try { facts = await deps.probe(file); } catch { throw new ProviderFailure("invalid_output", "The provider returned a file that cannot be decoded."); } finally { rmSync(file, { force: true }); }
      if (wanted === "image" ? !facts.image : !facts.audio || facts.video) throw new ProviderFailure("invalid_output", `The provider returned a file that is not ${wanted === "image" ? "an image" : "audio"}.`);
      const name = `${label}${result.outputs.length > 1 ? ` ${index + 1}` : ""}.${extension}`, put = deps.blobs.put(output.bytes, { mime: output.mime, name, purpose: "media" });
      assets.push({
        blobId: put.sha256, mime: output.mime, name, size: put.size, kind: wanted, ...(wanted === "image" ? { width: facts.width, height: facts.height } : { durationSeconds: Math.round(facts.duration_s * 1000) / 1000 }), ...(facts.codec ? { codec: facts.codec } : {}),
        provenance: {
          source: "ai", provider: job.provider, model: job.model, role: job.capability, ...(job.params.prompt ?? job.params.text ? { prompt: job.params.prompt ?? job.params.text } : {}), ...(job.params.negativePrompt ? { negativePrompt: job.params.negativePrompt } : {}),
          ...((output.seed ?? job.params.seed) !== undefined ? { seed: output.seed ?? job.params.seed } : {}), jobId: job.jobId, ...(costUsd !== null ? { cost: { amount: money(costUsd / result.outputs.length), currency: "USD" as const } } : {}), created_ms: now(), referenceAssetIds: [...(job.params.referenceBlobIds ?? [])],
        },
      });
    }
    return assets;
  }
  /** Runs a job under the one retry policy: three attempts at 0 s, 2 s and 8 s for transient classes, one retry for an unreadable or unknown answer, none for the rest. */
  async function run(entry: Live) {
    const job = entry.job;
    // A job that was ACCEPTED by the provider as a task before the host stopped is waited for again — nothing is sent, so nothing new is spent: what its request was held at is already on its action (the gate keeps the reservation of a host that died as that request's charge).
    const resumed = !!(job as Gated).task;
    job.state = "running"; job.started_ms = now(); job.progress = 0.02; delete job.status;
    if (resumed) job.status = "The provider is making it";
    persist(job); emit(entry, true);
    const model = models(job.provider).find((candidate) => candidate.id === job.model);
    let last: ProviderFailure = new ProviderFailure("unknown", "The job did not run.");
    for (let n = 1; n <= 3 && model; n++) {
      const started = now();
      // EVERY attempt — the first and each retry — is a request of the job's action: the gate holds it to what was
      // approved, counting what the attempts before it were billed, and records its charge when the provider answers.
      let token: SpendToken | undefined, counted = false;
      const billed = (): number | null | undefined => { const usd = token?.chargedUsd; if (usd !== undefined && !counted) { counted = true; entry.chargedUsd = money(entry.chargedUsd + (usd ?? 0)); } return usd; };
      try {
        const result = await gate.spend((job as Gated).actionId ?? "", { provider: job.provider, model: job.model, estimateUsd: resumed ? 0 : estimateOf(model, job.params).amountUsd, kind: job.capability, ref: job.jobId }, (given) => { token = given; return attempt(entry, model, given); });
        // The task's real bill is now on record: the amount the dead host had held for the same request is not a second charge beside it.
        if (resumed && typeof result.costUsd === "number" && (job as Gated).actionId) gate.reconcile((job as Gated).actionId!, { providerId: job.provider, modelId: job.model }, 0);
        const actual = billed() ?? null;
        const assets = await store(job, result, actual);
        if (closed) return;
        if (terminal(job)) { ledger(job, "cancelled", { units: result.units, actualUsd: actual, priceSource: typeof result.costUsd === "number" ? "provider" : model.customPrice ? "admin" : model.pricing ? "catalogue" : "none", duration_ms: now() - started }); return; }
        noteHealth(job.provider);
        job.attempts.push({ n, provider: job.provider, model: job.model, started_ms: started, duration_ms: now() - started });
        job.actualUsd = actual === null && !entry.chargedUsd ? null : money(entry.chargedUsd); job.results = assets;
        if (result.blocked) job.warnings.push(`${result.blocked} of ${result.blocked + assets.length} ${job.capability === "image" ? "images" : "items"} ${result.blocked === 1 ? "was" : "were"} blocked by the provider`);
        settle(job.jobId, job.actualUsd);
        ledger(job, "succeeded", { units: result.units, actualUsd: actual, priceSource: typeof result.costUsd === "number" ? "provider" : model.customPrice ? "admin" : model.pricing ? "catalogue" : "none", duration_ms: now() - started });
        if (entry.internal.cacheable || entry.internal.cacheMode === "bypass") cachePut(entry.internal.cacheKey, job.capability, assets);
        return finish(entry, "succeeded");
      } catch (error) {
        // The gate did not let the request out: the action stops with its question; nothing is retried past it.
        if (isSpendStop(error)) { if (closed || terminal(job)) return; return finish(entry, "failed", fault("budget_exceeded", error.message, { ...error.details(), actionId: error.actionId, attempts: job.attempts })); }
        last = error instanceof ProviderFailure ? error : new ProviderFailure("unknown", error instanceof Error ? error.message : "Unexpected failure.");
        // The provider answered and billed, and its answer could not be kept (not a file, not storable): the charge stands — in the ledger, the budgets and the action.
        const lost = billed();
        if (closed || terminal(job)) return;
        if (entry.abort.signal.aborted) last = new ProviderFailure("cancelled", "Cancelled.");
        job.attempts.push({ n, provider: job.provider, model: job.model, errorClass: last.class, started_ms: started, duration_ms: now() - started });
        ledger(job, last.class === "cancelled" ? "cancelled" : "failed", { actualUsd: lost ?? 0, priceSource: lost ? "provider" : "none", errorClass: last.class, duration_ms: now() - started });
        noteHealth(job.provider, last);
        // A request the provider ACCEPTED as a task is never sent a second time by the retry policy: the first one may still be made and billed. (A person's own retry is a new job, with its own approval.)
        // …nor is a picture made on the host: it fails for a reason of the host (memory, time), and a person decides what to change.
        const again = (job as Gated).task || isLocal(job.provider) ? false : RETRY_FULL.includes(last.class) ? n < 3 : RETRY_ONCE.includes(last.class) ? n < 2 : false;
        if (!again) break;
        // The attempt that follows is a request like the first: the bills so far are committed, and the budgets are asked again before it goes out.
        try { reserveNext(job, entry.chargedUsd); } catch (refused) { return finish(entry, "failed", fault("budget_exceeded", refused instanceof Error ? refused.message : "Budget reached.", { ...((refused as { details?: Record<string, unknown> }).details ?? {}), attempts: job.attempts })); }
        const base = last.class === "rate_limited" && last.retryAfterMs ? Math.min(120_000, last.retryAfterMs) : retryDelays[n - 1] * (1 + 0.2 * jitter());
        if (last.class === "rate_limited") { healthOf(job.provider).pausedUntil = now() + base; job.status = "Waiting for provider rate limit"; }
        else job.status = `Retrying (${n + 1} of 3)`;
        persist(job); emit(entry, true);
        await wait(base, entry.abort.signal);
        if (terminal(job)) return;
        // …and asked once more NOW, when the attempt is sent: the wait may have been long, and a budget may have been set or lowered during it.
        try { reserveNext(job, entry.chargedUsd); } catch (refused) { return finish(entry, "failed", fault("budget_exceeded", refused instanceof Error ? refused.message : "Budget reached.", { ...((refused as { details?: Record<string, unknown> }).details ?? {}), attempts: job.attempts })); }
        delete job.status;
      }
    }
    finish(entry, last.class === "cancelled" ? "cancelled" : "failed", fault(last.class, last.message, { ...last.details, ...(last.statusCode ? { statusCode: last.statusCode } : {}), attempts: job.attempts }));
  }
  /** Starts what the limits allow: interactive before batch before automation, first in first out inside a class. */
  function pump() {
    const order = { interactive: 0, batch: 1, automation: 2 } as const;
    const queued = [...live.values()].filter((entry) => entry.job.state === "queued").sort((a, b) => order[a.job.priority] - order[b.job.priority] || a.job.created_ms - b.job.created_ms);
    for (const entry of queued) {
      const job = entry.job;
      if (!enabled(job.provider)) { finish(entry, "failed", fault("model_unavailable", "The provider was turned off.", { reason: "provider_disabled" })); continue; }
      const running = [...live.values()].filter((other) => other.job.state === "running" && other.job.provider === job.provider && other.job.capability === job.capability).length;
      const paused = healthOf(job.provider).pausedUntil - now();
      if (paused > 0) { if (job.status !== "Waiting for provider rate limit") { job.status = "Waiting for provider rate limit"; emit(entry, true); } setTimeout(pump, Math.min(paused, 120_000) + 5).unref?.(); continue; }
      if (running >= (limitsOf(job.provider).maxConcurrent[job.capability] ?? 1)) { emit(entry, true); continue; }
      void run(entry);
    }
  }

  /** What a request would run on and cost, with nothing started. */
  function prepare(params: z.infer<(typeof generationRpcParams)["jagentchill.generation.create"]>) {
    const { model, defaults } = resolveRoute(params.capability, params.provider, params.model);
    params = { ...params, params: withDefaults(model, defaults, params.params) };
    const violation = violationOf(model, params.params);
    if (violation) throw new ProtocolError("INVALID_PARAMS", violation.message, { details: { field: `params.${violation.field}`, ...(violation.allowed !== undefined ? { allowed: violation.allowed } : {}) } });
    const gone = (params.params.referenceBlobIds ?? []).find((blobId) => deps.blobs.status(blobId).state !== "complete");
    if (gone) throw new ProtocolError("INVALID_PARAMS", "A reference picture of this request is not on the host.", { details: { field: "params.referenceBlobIds", blobId: gone } });
    // The cap and the sizes hold for every caller and every model row, whatever its metadata says.
    if ((params.params.referenceBlobIds?.length ?? 0) > REFERENCES_MAX) throw new ProtocolError("INVALID_PARAMS", `A request carries at most ${REFERENCES_MAX} reference pictures.`, { details: { field: "params.referenceBlobIds", allowed: { max: REFERENCES_MAX } } });
    const oversized = referenceSizeProblem(params.params.referenceBlobIds ?? []);
    if (oversized) throw new ProtocolError("INVALID_PARAMS", oversized.message, { details: { field: "params.referenceBlobIds", ...oversized.details } });
    const estimate = estimateFor(model, params.params, { ...(params.projectId ? { projectId: params.projectId } : {}), ...(params.sessionId ? { sessionId: params.sessionId } : {}) });
    const key = cacheKeyOf(model, params.params);
    const cacheable = DETERMINISTIC.includes(model.capability) || params.params.seed !== undefined || params.reuse === true;
    return { model, params: params.params, estimate, key, cacheable, hit: cacheable && params.cache !== "bypass" ? cached(key) : undefined };
  }
  /**
   * ONE logical request, one job — also between two hosts on one database: finding the action's approval, finding the
   * job it already made, and making the job (its row, its place in the action, its reservation) are ONE transaction of
   * the store. A second identical confirmation, from this host or another, comes after it and gets that job.
   */
  function create(raw: GenerationCreateParams, actor: GenerationActor): GenerationJob {
    const job = gate.atomically(() => createNow(raw, actor));
    pump();
    return job;
  }
  function createNow(raw: GenerationCreateParams, actor: GenerationActor): GenerationJob {
    const params = generationRpcParams["jagentchill.generation.create"].parse(raw);
    if (params.idempotencyKey) { const row = db.prepare("SELECT job_id FROM gen_jobs WHERE json LIKE ? ORDER BY created_ms DESC LIMIT 1").get(`%"idempotencyKey":"${params.idempotencyKey}"%`) as { job_id: string } | undefined; if (row) return jobOf(row.job_id); }
    const prepared = prepare(params), { model, estimate, key, cacheable, hit } = prepared, definition = adapterOf(model.provider).describe();
    // From here on the request is what will be sent: its own parameters over the routed profile's options.
    params.params = prepared.params;
    // The action of the spend gate this job spends under. The caller's, when it opened one (its approval is checked
    // here, before anything is queued, and again at every attempt). Else a person's job is an action of its own: its
    // estimate is the quote, shown first when it is above the host's amount or unknown, and approved only by the
    // answer to THAT question. An agent's job is the host's own work. A job served from the cache spends nothing.
    // (A run that confirmed its cost with its own person — `gate.cover` — is found by its session: its jobs are requests of that action.)
    let actionId = actor.action ?? gate.covered(params.sessionId ?? actor.sessionId), ownsAction = false;
    if (!hit) {
      refuseOverBudget(model.provider, { ...(params.projectId ? { projectId: params.projectId } : {}), ...(params.sessionId ?? actor.sessionId ? { sessionId: params.sessionId ?? actor.sessionId } : {}) }, estimate.amountUsd);
      const call: SpendCall = { provider: model.provider, model: model.id, estimateUsd: estimate.amountUsd, kind: model.capability };
      if (actionId) gate.check(actionId, call);
      else if (actor.by === "user") {
        // What will be made — the prompt and inputs, the count, the size, the model (all in the cache key) — is the request's id AND part of its quote: the answer to another request's question approves nothing here.
        const name = modelName(model.provider, model.id), request = createHash("sha256").update(canonical([actor.deviceId, key, params.projectId ?? "", params.batchId ?? "", params.cache ?? ""])).digest("hex").slice(0, 32);
        const quote = gate.quote({ amountUsd: estimate.amountUsd ?? 0, models: [name], unpriced: estimate.amountUsd === null ? [name] : [], plan: `generation.${model.capability}:${request}` });
        try { actionId = gate.open({ fixedId: actor.retryOf ? `job.retry:${actor.retryOf}` : `generation.create:${request}`, kind: actor.retryOf ? "job.retry" : "generation.create", owner: `device:${actor.deviceId}`, quote, answer: { confirmed: params.confirmed === true, ...(params.actionId ? { actionId: params.actionId } : {}), ...(params.quoteId ? { quoteId: params.quoteId } : {}) } }).id; } catch (error) {
          if (isSpendStop(error)) throw asked(error, estimate, { providerIds: [model.provider], ...(params.projectId ? { projectId: params.projectId } : {}), ...(params.sessionId ?? actor.sessionId ? { sessionId: params.sessionId ?? actor.sessionId } : {}) });
          throw error;
        }
        ownsAction = true;
        // ONE logical request, one job: the same confirmation sent twice (a second click) gets the job the first one made — claimed in the store with the action.
        const made = gate.action(actionId)?.checkpoints.jobId;
        if (typeof made === "string") { const going = live.get(made)?.job ?? stored_job(made); if (going && !terminal(going)) return going; }
      } else {
        // An agent's job, or a run's, that nobody approved by a quote (no action of the caller, no confirmation of the run on record): it has no authority beyond the host's "ask before spending more than" — held to it, every charge counted; past it, or at a price that is not known, it is refused with the money question.
        const session = params.sessionId ?? actor.sessionId;
        try { actionId = gate.unattended("unattended", session ?? `device:${actor.deviceId}`, call, session ? `unattended:${session}` : undefined); gate.check(actionId, call); } catch (error) { if (isSpendStop(error)) throw asked(error, estimate, { providerIds: [model.provider], ...(params.projectId ? { projectId: params.projectId } : {}), ...(session ? { sessionId: session } : {}) }); throw error; }
      }
    }
    const jobId = randomUUID();
    const job: GenerationJob = {
      jobId, kind: `generation.${model.capability}`, capability: model.capability, state: "queued", progress: 0, provider: model.provider, model: model.id, params: params.params,
      ...(params.projectId ? { projectId: params.projectId } : {}), ...(params.sessionId ?? actor.sessionId ? { sessionId: params.sessionId ?? actor.sessionId } : {}), ...(actor.toolCallId ? { toolCallId: actor.toolCallId } : {}), ...(params.batchId ? { batchId: params.batchId } : {}),
      createdBy: actor.deviceId, priority: actor.priority ?? "interactive", attempts: [], resumable: model.metadata.resumable, cancellable: model.metadata.cancellable, estimateUsd: hit ? 0 : estimate.amountUsd, actualUsd: null, cacheHit: !!hit, usedFallback: false,
      results: [], warnings: [], created_ms: now(),
    };
    const entry: Live = { job, internal: { contentKinds: params.contentKinds ?? [], cacheKey: key, cacheable, cacheMode: params.cache ?? "use", idempotencyKey: params.idempotencyKey ?? jobId }, abort: new AbortController(), emitted: 0, chargedUsd: 0 };
    if (params.idempotencyKey) (job as Gated).idempotencyKey = params.idempotencyKey;
    if (actionId) { (job as Gated).actionId = actionId; if (ownsAction) { (job as Gated).ownsAction = true; gate.checkpoint(actionId, "jobId", jobId); } }
    if (hit) {
      // Served from the cache: the stored files as this job's results, at no cost and without a provider call.
      job.results = hit.map((asset) => ({ ...asset, provenance: { ...asset.provenance, jobId, cost: { amount: 0, currency: "USD" as const }, created_ms: now() } }));
      job.actualUsd = 0; job.state = "succeeded"; job.progress = 1; job.started_ms = job.finished_ms = now();
      ledger(job, "succeeded", { actualUsd: 0, priceSource: "none", duration_ms: 0 });
      persist(job); emit(entry, true);
      return job;
    }
    try { job.warnings.push(...reserve(job)); } catch (error) { if (ownsAction && actionId) gate.close(actionId); throw error; }
    live.set(jobId, entry);
    persist(job);
    audit(db, now(), actor.by === "agent" ? `agent:${actor.sessionId ?? ""}` : `device:${actor.deviceId}`, "generation.job.create", { jobId, capability: job.capability, provider: job.provider, model: job.model, estimateUsd: job.estimateUsd });
    emit(entry, true);
    return job;
  }
  function cancel(jobId: string): GenerationJob {
    const entry = live.get(jobId);
    if (!entry) return jobOf(jobId);
    const wasRunning = entry.job.state === "running";
    if (wasRunning && !entry.job.cancellable) entry.job.warnings.push("The provider can still bill this request");
    if (wasRunning) ledger(entry.job, "cancelled", { actualUsd: null, priceSource: "none", errorClass: "cancelled", duration_ms: now() - (entry.job.started_ms ?? now()) });
    finish(entry, "cancelled", fault("cancelled", "Cancelled."));
    entry.abort.abort("cancelled");
    return entry.job;
  }
  const settled = (jobId: string): Promise<GenerationJob> => { const job = jobOf(jobId); return terminal(job) ? Promise.resolve(job) : new Promise((resolve) => waiters.set(jobId, [...(waiters.get(jobId) ?? []), resolve])); };

  // A job that was running when the server stopped and whose request was ONE call (a picture, a line, music) cannot be
  // picked up again: it is failed with the truth about billing, and its reservation is released. Queued jobs wait in the queue again.
  const resuming: Live[] = [];
  for (const row of db.prepare("SELECT json FROM gen_jobs WHERE state IN ('queued', 'running')").all() as { json: string }[]) {
    const job = JSON.parse(row.json) as GenerationJob, entry: Live = { job, internal: { contentKinds: [], cacheKey: "", cacheable: false, cacheMode: "use", idempotencyKey: job.jobId }, abort: new AbortController(), emitted: 0, chargedUsd: 0 };
    live.set(job.jobId, entry);
    // What the provider billed this job before the host stopped is in the gate's store (its charges are never deleted): the job ends with that, not with nothing.
    // A job the provider had accepted as a task (its handle is in the store) is picked up again: the task is asked about until it has ended, and its file fetched.
    if (job.state === "running" && (job as Gated).task && adapters.has(job.provider)) { resuming.push(entry); continue; }
    if (job.state === "running") { entry.chargedUsd = gate.chargedFor(job.jobId); if (!isLocal(job.provider)) job.warnings.push("The provider can still bill this request"); finish(entry, "failed", fault("unknown", "The server restarted while this job was running.", { reason: "server_restarted" })); }
  }
  db.prepare("DELETE FROM budget_commits WHERE ref LIKE 'gen:%' AND substr(ref, 5) IN (SELECT job_id FROM gen_jobs WHERE state IN ('failed', 'cancelled') AND COALESCE(json_extract(json, '$.actualUsd'), 0) = 0)").run();
  db.prepare("DELETE FROM gen_jobs WHERE finished_ms IS NOT NULL AND finished_ms < ?").run(now() - JOB_TTL_MS);
  db.prepare("DELETE FROM gen_ledger WHERE ts_ms < ?").run(now() - 730 * 86_400_000);
  queueMicrotask(() => { for (const entry of resuming) void run(entry); pump(); });

  // ---- channel methods ----
  const methods = new Map<string, RpcMethod>();
  type Name = keyof typeof generationRpcParams;
  function method<N extends Name>(name: N, handle: (params: z.infer<(typeof generationRpcParams)[N]>, connection: Connection) => unknown) {
    methods.set(name, { scope: GENERATION_METHOD_SCOPES[name], handle: (raw, connection) => {
      const parsed = generationRpcParams[name].safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
      return handle(parsed.data as z.infer<(typeof generationRpcParams)[N]>, connection);
    } });
  }
  const listed = (capability?: GenerationCapability) => [...adapters.keys()].map(providerView).filter((provider) => !capability || provider.capabilities.includes(capability));
  method("jagentchill.provider.list", (p) => ({ providers: listed(p.capability), capabilities: capabilities() }));
  method("jagentchill.provider.connect", (p, connection) => connect(p.providerId, p.secretNames[0], connection.deviceId));
  method("jagentchill.provider.disconnect", (p, connection) => disconnect(p.providerId, connection.deviceId));
  method("jagentchill.provider.key.replace", (p, connection) => {
    if (!stored().connections[p.providerId]) throw new ProtocolError("NOT_FOUND", "This provider is not connected.");
    // The new key is validated before it takes the old one's place; a key that fails leaves the old one in use.
    return connect(p.providerId, p.secretName, connection.deviceId, true);
  });
  method("jagentchill.provider.test", async (p) => {
    const secret = secretOf(p.providerId);
    if (!secret) throw new ProtocolError("NOT_FOUND", "This provider is not connected.");
    const outcome = await adapterOf(p.providerId).validateConnection(secret), state = healthOf(p.providerId);
    if (outcome.outcome === "ok") { state.state = "ready"; state.failures = 0; state.circuitUntil = 0; delete state.reason; } else if (outcome.outcome === "invalid_key") { state.state = "unauthorized"; state.reason = outcome.message; }
    changed(p.providerId);
    return outcome;
  });
  method("jagentchill.provider.update", (p, connection) => {
    adapterOf(p.providerId);
    const state = stored();
    if (p.limits) {
      for (const [capability, value] of Object.entries(p.limits.maxConcurrent ?? {})) if (value < 1 || value > 64) throw new ProtocolError("INVALID_PARAMS", "Concurrent jobs are 1–64.", { details: { field: `limits.maxConcurrent.${capability}`, min: 1, max: 64, value } });
      const perMinute = p.limits.requestsPerMinute;
      if (typeof perMinute === "number" && (perMinute < 1 || perMinute > 10_000)) throw new ProtocolError("INVALID_PARAMS", "Requests per minute are 1–10,000.", { details: { field: "limits.requestsPerMinute", min: 1, max: 10_000, value: perMinute } });
      const previous = state.limits[p.providerId];
      state.limits = { ...state.limits, [p.providerId]: { maxConcurrent: { ...previous?.maxConcurrent, ...p.limits.maxConcurrent }, ...(perMinute === null ? {} : perMinute ?? previous?.requestsPerMinute ? { requestsPerMinute: (perMinute ?? previous?.requestsPerMinute)! } : {}) } };
    }
    if (p.enabled !== undefined) state.disabled = p.enabled ? state.disabled.filter((id) => id !== p.providerId) : [...new Set([...state.disabled, p.providerId])];
    save({ limits: state.limits, disabled: state.disabled });
    audit(db, now(), `device:${connection.deviceId}`, "generation.provider.update", { providerId: p.providerId, ...(p.enabled !== undefined ? { enabled: p.enabled } : {}), ...(p.limits ? { limits: true } : {}) });
    changed(p.providerId);
    pump();
    return { provider: providerView(p.providerId) };
  });
  method("jagentchill.provider.model.list", (p) => {
    const needle = p.query?.trim().toLowerCase();
    return { models: (p.providerId ? models(adapterOf(p.providerId).describe().id) : allModels()).filter((model) => (!p.capability || model.capability === p.capability) && (!p.enabledOnly || (model.enabled && usable(model.provider))) && (!needle || model.id.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle))), pricesAsOf: PRICES_AS_OF };
  });
  method("jagentchill.provider.model.refresh", async (p) => ({ ...(await refresh(p.providerId)), provider: providerView(p.providerId) }));
  method("jagentchill.provider.model.upsert", (p) => {
    adapterOf(p.providerId);
    const existing = models(p.providerId).find((model) => model.id === p.model.id), previous = overlays(p.providerId).get(p.model.id);
    setOverlay(p.providerId, p.model.id, {
      ...previous, ...(existing ? {} : { source: "user" as const }), ...(existing && existing.source !== "bundled" ? { source: existing.source as "fetched" | "user" } : {}), capability: existing && existing.source === "bundled" ? previous?.capability : p.model.capability,
      ...(p.model.label ? { label: p.model.label } : {}), ...(p.model.enabled !== undefined ? { enabled: p.model.enabled } : existing ? {} : { enabled: true }), ...(p.model.metadata ? { metadata: { ...previous?.metadata, ...(p.model.metadata as Partial<GenerationModelMetadata>) } } : {}),
      // Ruling R7: a price an admin types in is recorded as that — the host's own statement, with its day — unless they say where it is from.
      ...(p.model.pricing !== undefined ? { pricing: p.model.pricing && p.model.pricing.kind !== "free" && !p.model.pricing.source ? { ...p.model.pricing, source: { kind: "admin" as const, date: new Date(now()).toISOString().slice(0, 10) } } : p.model.pricing } : {}), updated_ms: now(),
    });
    changed(p.providerId);
    pump();
    return { model: models(p.providerId).find((model) => model.id === p.model.id) };
  });
  method("jagentchill.provider.model.reset", (p) => {
    const overlay = overlays(p.providerId).get(p.modelId);
    if (!overlay) throw new ProtocolError("NOT_FOUND", "This model has no edits.");
    // A model an admin added goes away; a fetched or bundled one returns to what the catalogue says.
    setOverlay(p.providerId, p.modelId, overlay.source === "fetched" ? { source: "fetched", capability: overlay.capability, label: overlay.label, ...(overlay.description ? { description: overlay.description } : {}), enabled: false, ...(overlay.listed ? { listed: overlay.listed } : {}), updated_ms: now() } : null);
    changed(p.providerId);
    return { model: models(p.providerId).find((model) => model.id === p.modelId) ?? null };
  });
  method("jagentchill.provider.model.setEnabled", (p) => {
    const over = overlays(p.providerId);
    for (const model of models(adapterOf(p.providerId).describe().id)) {
      if ((p.capability && model.capability !== p.capability) || (p.modelIds && !p.modelIds.includes(model.id))) continue;
      setOverlay(p.providerId, model.id, { ...over.get(model.id), enabled: p.enabled, updated_ms: now() });
    }
    changed(p.providerId);
    pump();
    return { models: models(p.providerId) };
  });
  method("jagentchill.provider.cache.get", () => { const row = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS entries FROM gen_cache").get() as { bytes: number; entries: number }; return { bytes: row.bytes, entries: row.entries, limitBytes: cacheLimit() }; });
  method("jagentchill.provider.cache.clear", (_p, connection) => { const removed = db.prepare("DELETE FROM gen_cache").run().changes; audit(db, now(), `device:${connection.deviceId}`, "generation.cache.clear", { entries: Number(removed) }); return { bytes: 0, entries: 0, limitBytes: cacheLimit() }; });
  // ---- the ONE approval card of an assistant message's costed calls (spec `agent-editing-tools`, "Cost guard", rule 4; ruling R8) ----
  const CARD = "card:";
  /**
   * A card as the host keeps it. `collecting`: the assistant message it belongs to is still being written — its costed
   * calls are being COLLECTED (none is dispatched), it is no question yet and no screen is told of it (review 16 #2).
   * `byAllowance`: the message ended with its total inside the amount a message may spend unasked — nobody was asked,
   * so no screen shows it; it only lets the collected calls out when the agent makes them again.
   */
  type Card = GenerationMessageCard & { collecting?: true; byAllowance?: true };
  const shown = (card: Card): boolean => !card.collecting && !card.byAllowance;
  const cardOf = (cardId: string): Card | undefined => { const row = db.prepare("SELECT json FROM gen_standing WHERE key = ?").get(CARD + cardId) as { json: string } | undefined; try { return row ? (JSON.parse(row.json) as Card) : undefined; } catch { return undefined; } };
  const cardsOf = (sessionKey: string): Card[] => (db.prepare("SELECT json FROM gen_standing WHERE key LIKE 'card:%' ORDER BY updated_ms, rowid").all() as { json: string }[]).flatMap((row) => { try { const card = JSON.parse(row.json) as Card; return card.sessionKey === sessionKey ? [card] : []; } catch { return []; } });
  const putCard = (card: Card): Card => {
    const priced = card.items.filter((item) => item.amountUsd !== null), waiting = card.items.filter((item) => item.state === "waiting");
    const next = { ...card, totalUsd: money(priced.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0)), unpricedModels: [...new Set(waiting.filter((item) => item.amountUsd === null).map((item) => `${item.provider}/${item.model}`))] };
    db.prepare("INSERT INTO gen_standing (key, json, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_ms = excluded.updated_ms").run(CARD + next.cardId, JSON.stringify(next), now());
    if (shown(next)) deps.broadcast("jagentchill.projects.read", "jagentchill.provider.messageCard.updated", "job", { card: next }, (connection) => subscriptions.get(connection)?.job === true);
    return next;
  };
  /** Whether a session has a turn running, as the host's session service says; undefined: not bound. */
  let sessionRunning: ((sessionKey: string) => boolean) | undefined;
  /**
   * The costed calls of ONE assistant message are decided TOGETHER, when the message has ended (spec
   * `agent-editing-tools`, "Cost guard", rule 4; ruling R8; review 16 #2): until then each call was only collected — none
   * was dispatched. A message is over when the session has a newer turn in Usage, or — for the host's own signal that
   * a turn ended (`ended`) — when the session has no turn running. Then:
   *  - a turn that was stopped or failed: its collection is dropped (nobody is asked, the agent is not woken);
   *  - the total of the collected calls is inside the amount a message may spend unasked, every price known: they are
   *    let out with no card — the agent is told to make them again (its next turn), and they run;
   *  - else ONE card lists each of them and the total, and nothing runs until "Allow".
   */
  async function settleMessages(sessionKey: string, how: { /** The host saw a turn of the session end. */ ended?: boolean; /** How that turn ended, as the host's session service says: one that was stopped ("aborted") or failed ("error") is not answered for. */ state?: "final" | "error" | "aborted" } = {}): Promise<void> {
    if (!cardsOf(sessionKey).some((card) => card.collecting)) return;
    const turns = await gate.usage.turns(sessionKey), newest = turns?.at(-1);
    for (const stale of cardsOf(sessionKey).filter((card) => card.collecting)) {
      const over = (newest !== undefined && newest.runId !== stale.messageId) || (how.ended === true && sessionRunning?.(sessionKey) === false);
      const card = over ? cardOf(stale.cardId) : undefined;
      if (!card?.collecting) continue;
      const outcome = turns?.find((turn) => turn.runId === card.messageId)?.outcome, waiting = card.items.filter((item) => item.state === "waiting");
      if (outcome === "cancelled" || outcome === "failed" || (how.ended === true && how.state !== undefined && how.state !== "final") || !waiting.length) { db.prepare("DELETE FROM gen_standing WHERE key = ?").run(CARD + card.cardId); continue; }
      const allowanceUsd = sessionThresholds(sessionKey).perCallApprovalUsd, total = money(waiting.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0)), inside = waiting.every((item) => item.amountUsd !== null) && total <= allowanceUsd + 1e-9;
      const { collecting: _collecting, ...rest } = card;
      if (!inside) { putCard({ ...rest, state: "pending", allowanceUsd }); continue; }
      putCard({ ...rest, state: "allowed", allowanceUsd, decided_ms: now(), byAllowance: true });
      void Promise.resolve(tellSession?.(sessionKey, `[JAgentChill] The generation calls of your last message come to ${usdText(total)}, inside the amount the user lets one message spend without asking. Make these calls again now with exactly the same parameters to carry them out: ${waiting.map((item) => `${item.tool} "${item.words}"`).join("; ")}.\nThis is a status message of the editor, not a request of the user.\n${JSON.stringify({ requestId: card.cardId, state: "allowed" })}`)).catch(() => undefined);
    }
  }
  /** How a session is told that its card was answered (the host's session service: it opens the agent's next turn). */
  let tellSession: ((sessionKey: string, message: string) => unknown) | undefined;
  method("jagentchill.provider.messageCard.list", (p) => ({ cards: cardsOf(p.sessionKey).filter(shown) }));
  method("jagentchill.provider.messageCard.resolve", (p, connection) => {
    const card = cardOf(p.cardId);
    if (!card) throw new ProtocolError("NOT_FOUND", "There is no such approval card.", { details: { cardId: p.cardId } });
    if (!connection.scopes().includes("jagentchill.generation.run")) throw new ProtocolError("SCOPE_DENIED", "This needs the scope jagentchill.generation.run.", { details: { scope: "jagentchill.generation.run" } });
    if (card.collecting) throw new ProtocolError("NOT_FOUND", "There is no such approval card.", { details: { cardId: p.cardId } });
    if (card.state !== "pending") throw new ProtocolError("ALREADY_RESOLVED", "This card was already answered.", { details: { state: card.state } });
    const next = putCard({ ...card, state: p.decision === "allow" ? "allowed" : "denied", decided_ms: now() });
    audit(db, now(), `device:${connection.deviceId}`, "generation.messageCard.resolve", { cardId: card.cardId, sessionKey: card.sessionKey, decision: p.decision, totalUsd: next.totalUsd });
    const waiting = next.items.filter((item) => item.state === "waiting");
    // The decision opens the agent's next turn; an allow tells it to make the listed calls again.
    void Promise.resolve(tellSession?.(card.sessionKey, `[JAgentChill] The approval card of your generation calls (${card.cardId}) was ${p.decision === "allow" ? `allowed. Make these calls again with exactly the same parameters to carry them out: ${waiting.map((item) => `${item.tool} "${item.words}"`).join("; ")}.` : "denied. Do not make these calls again unless the user asks."}\nThis is a status message of the editor, not a request of the user.\n${JSON.stringify({ requestId: card.cardId, state: next.state })}`)).catch(() => undefined);
    return { card: next };
  });
  method("jagentchill.provider.threshold.get", (p) => ({ thresholds: thresholds(), ...(p.sessionKey ? { session: sessionThresholds(p.sessionKey) } : {}) }));
  method("jagentchill.provider.threshold.set", (p, connection) => {
    const scopes = connection.scopes(), denied = (scope: string): ProtocolError => new ProtocolError("SCOPE_DENIED", `This needs the scope ${scope}.`, { details: { scope } });
    if (p.sessionKey) {
      // ONE session's allowances (spec "Approval thresholds and spending caps", rules 2 and 3): the per-call amount can only be lowered; the Auto allowance lowered by who may use the agent, raised by who may run generation — up to the host's self-service maximum.
      const host = thresholds(), was = sessionThresholds(p.sessionKey), own: { perCallApprovalUsd?: number; autoSessionBudgetUsd?: number } = { ...stored().sessionThresholds?.[p.sessionKey] };
      if (p.patch.confirmAboveUsd !== undefined || p.patch.maxSelfServiceUsd !== undefined) throw new ProtocolError("INVALID_PARAMS", "A session has only the two agent allowances of its own.", { details: { field: p.patch.confirmAboveUsd !== undefined ? "confirmAboveUsd" : "maxSelfServiceUsd" } });
      for (const field of ["perCallApprovalUsd", "autoSessionBudgetUsd"] as const) {
        const value = p.patch[field];
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value < 0) throw new ProtocolError("INVALID_PARAMS", "The amount is outside its range.", { details: { field, reason: "OUT_OF_RANGE" } });
        if (value <= was[field]) { if (!scopes.includes("jagentchill.agent.use") && !scopes.includes("jagentchill.config.write")) throw denied("jagentchill.agent.use"); }
        else if (field === "perCallApprovalUsd") throw new ProtocolError("INVALID_PARAMS", "A session can only lower the per-call approval amount.", { details: { field, max: was[field], reason: "OUT_OF_RANGE" } });
        else { if (!scopes.includes("jagentchill.generation.run")) throw denied("jagentchill.generation.run"); const most = Math.min(host.maxSelfServiceUsd, generationThresholdsSchema.shape.autoSessionBudgetUsd.maxValue ?? Infinity); if (value > most) throw new ProtocolError("INVALID_PARAMS", "A session's Auto allowance can be raised up to the host's self-service maximum, and never above the most an Auto allowance can be.", { details: { field, max: most, reason: "OUT_OF_RANGE" } }); }
        own[field] = value;
      }
      save({ sessionThresholds: { ...stored().sessionThresholds, [p.sessionKey]: own } });
      audit(db, now(), `device:${connection.deviceId}`, "generation.threshold.session.set", { sessionKey: p.sessionKey, ...p.patch });
      return { thresholds: thresholds(), session: sessionThresholds(p.sessionKey) };
    }
    if (!scopes.includes("jagentchill.config.write")) throw denied("jagentchill.config.write");
    const next = generationThresholdsSchema.safeParse({ ...thresholds(), ...p.patch });
    if (!next.success) throw new ProtocolError("INVALID_PARAMS", "The amount is outside its range.", { details: { field: next.error.issues[0]?.path.join(".") ?? "", reason: "OUT_OF_RANGE" } });
    save({ thresholds: next.data });
    audit(db, now(), `device:${connection.deviceId}`, "generation.threshold.set", { ...p.patch });
    return { thresholds: next.data };
  });
  method("jagentchill.provider.estimate", (p) => {
    const items = p.items.map((item): GenerationEstimate => {
      try { return prepare({ capability: item.capability, ...(item.provider ? { provider: item.provider } : {}), ...(item.model ? { model: item.model } : {}), params: item.params }).estimate; }
      catch (error) { if (error instanceof ProtocolError && error.code === "NO_ROUTE") return { provider: null, model: null, label: null, amountUsd: null, basis: error.message, breakdown: [], confidence: "unknown", blocked: { reason: "no_route" } }; throw error; }
    });
    return { items, totalUsd: money(items.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0)), excludesUnknown: items.some((item) => item.amountUsd === null), confirmAboveUsd: thresholds().confirmAboveUsd } satisfies GenerationEstimateResult;
  });
  method("jagentchill.provider.voice.list", (p) => {
    const needle = p.query?.trim().toLowerCase(), voices: GenerationVoice[] = [];
    for (const model of allModels()) {
      if (model.capability !== "tts" || !model.enabled || !usable(model.provider) || (p.provider && model.provider !== p.provider)) continue;
      for (const voice of model.metadata.voices ?? []) {
        if ((p.language && !speaks(voice.languages, p.language)) || (needle && !voice.name.toLowerCase().includes(needle))) continue;
        voices.push({ voiceId: voice.voiceId, provider: model.provider, model: model.id, name: voice.name, languages: voice.languages, ...(voice.gender ? { gender: voice.gender } : {}), tags: voice.tags ?? [], source: "provider" });
      }
    }
    return { voices };
  });
  method("jagentchill.provider.consent.list", () => ({ consents: stored().consents }));
  method("jagentchill.provider.consent.grant", (p, connection) => {
    adapterOf(p.providerId);
    const state = stored(), previous = state.consents.find((consent) => consent.providerId === p.providerId);
    const consent: GenerationConsent = { providerId: p.providerId, contentKinds: [...new Set([...(previous?.contentKinds ?? []), ...p.contentKinds])], grantedBy: { deviceId: connection.deviceId }, granted_ms: now() };
    save({ consents: [...state.consents.filter((entry) => entry.providerId !== p.providerId), consent] });
    audit(db, now(), `device:${connection.deviceId}`, "generation.consent.grant", { providerId: p.providerId, contentKinds: p.contentKinds });
    changed(p.providerId);
    return { consent };
  });
  method("jagentchill.provider.consent.revoke", (p, connection) => {
    save({ consents: stored().consents.filter((consent) => consent.providerId !== p.providerId) });
    audit(db, now(), `device:${connection.deviceId}`, "generation.consent.revoke", { providerId: p.providerId });
    changed(p.providerId);
    return { consents: stored().consents };
  });
  method("jagentchill.provider.consent.check", (p) => {
    const ids = p.providers ?? (p.capability ? [...new Set(allModels().filter((model) => model.capability === p.capability && model.enabled && usable(model.provider)).map((model) => model.provider))] : [...adapters.keys()]);
    return { missing: ids.map((providerId) => ({ providerId, definition: adapterOf(providerId).describe(), kinds: consentFor(providerId, p.contentKinds) })).filter((entry) => entry.kinds.length).map((entry) => ({ providerId: entry.providerId, label: entry.definition.label, host: entry.definition.hosts[0], contentKinds: entry.kinds })) };
  });
  method("jagentchill.provider.subscribe", (_p, connection) => { subscriptionOf(connection).provider = true; return { providers: listed(), capabilities: capabilities() }; });
  method("jagentchill.provider.unsubscribe", (_p, connection) => { subscriptionOf(connection).provider = false; return {}; });
  method("jagentchill.generation.create", (p, connection) => ({ job: create(p, { deviceId: connection.deviceId, by: "user" }) }));
  const list = (p: { kind?: string; state?: string; projectId?: string; batchId?: string; limit?: number }) => (db.prepare(`SELECT json FROM gen_jobs WHERE ${p.kind ? "1 = 1" : `kind NOT IN ('${INTERNAL_TRANSCRIPTION}', '${INTERNAL_TRANSLATION}')`}${p.kind ? " AND kind = @kind" : ""}${p.state ? " AND state = @state" : ""}${p.projectId ? " AND project_id = @projectId" : ""}${p.batchId ? " AND batch_id = @batchId" : ""} ORDER BY created_ms DESC LIMIT @limit`)
    .all({ ...(p.kind ? { kind: p.kind } : {}), ...(p.state ? { state: p.state } : {}), ...(p.projectId ? { projectId: p.projectId } : {}), ...(p.batchId ? { batchId: p.batchId } : {}), limit: p.limit ?? 50 }) as { json: string }[]).map((row) => { const job = JSON.parse(row.json) as GenerationJob, current = live.get(job.jobId)?.job ?? job; position(current); return current; });
  method("jagentchill.job.list", (p) => ({ jobs: list(p) }));
  method("jagentchill.job.get", (p) => ({ job: jobOf(p.jobId) }));
  method("jagentchill.job.cancel", (p) => ({ job: cancel(p.jobId) }));
  method("jagentchill.job.retry", (p, connection) => {
    const job = jobOf(p.jobId);
    if (job.state !== "failed" && job.state !== "cancelled") throw new ProtocolError("CONFLICT", "Only a failed or cancelled job can be retried.", { details: { state: job.state } });
    // A retry is paid work a person starts: it goes through the money question like the job did — the estimate of
    // NOW, answered by them (`confirmed` with what the question named). Nothing is confirmed on their behalf.
    return { job: create({ capability: job.capability, provider: job.provider, model: job.model, params: job.params, ...(job.projectId ? { projectId: job.projectId } : {}), ...(job.sessionId ? { sessionId: job.sessionId } : {}), ...(p.confirmed === true ? { confirmed: true } : {}), ...(p.actionId ? { actionId: p.actionId } : {}), ...(p.quoteId ? { quoteId: p.quoteId } : {}) }, { deviceId: connection.deviceId, by: "user", retryOf: job.jobId }) };
  });
  method("jagentchill.job.subscribe", (_p, connection) => { subscriptionOf(connection).job = true; return { jobs: [...live.values()].map((entry) => entry.job) }; });
  method("jagentchill.job.unsubscribe", (_p, connection) => { subscriptionOf(connection).job = false; return {}; });

  return {
    /** The jobs that have not ended (queued or running), with their progress. */
    liveJobs: (): GenerationJob[] => [...live.values()].map((entry) => entry.job),
    methods, providers: listed, capabilities, models, prepare, create, cancel, settled, job: jobOf, thresholds, confirmationNeeded, confirmation, remaining,
    /** THE SPEND GATE of this host: every paid provider request passes through it, and so does a paid turn of a runtime's model that film or captions run. */
    gate, asked, translationWork, sessionThresholds, pendingUsd,
    /** Tells a session something (a status message of the editor); a no-op until the host bound its sessions. */
    tell(sessionKey: string, message: string): void { void Promise.resolve(tellSession?.(sessionKey, message)).catch(() => undefined); },
    /** The session service's way to tell a session something (bound by the host): an answered card opens the agent's next turn. */
    bindSessions(port: { deliver(sessionKey: string, message: string): unknown; /** Whether the session has a turn running. */ running?(sessionKey: string): boolean }): void { tellSession = (sessionKey, message) => port.deliver(sessionKey, message); sessionRunning = port.running ? (sessionKey) => port.running!(sessionKey) : undefined; },
    /** The approval cards of assistant messages, for the generation tools: read, and written whole. */
    messageCards: { of: cardsOf, put: putCard, settle: settleMessages },
    /** A hard-stop budget in scope forbids this request: thrown as that (`BUDGET_EXCEEDED`), before anything is collected or asked. */
    refuseOverBudget,
    /** What ORC checks a generation profile against, and the switch it turns when a profile names a model that is off. */
    catalogue: {
      models: (capability: string) => allModels().filter((model) => model.capability === capability).map((model) => ({ provider: model.provider, id: model.id, label: model.label, enabled: model.enabled, connected: isLocal(model.provider) ? installed(model.provider, model.id) : connectionOf(model.provider) === "connected" })),
      /** The profile options that are really sent for this model (what its adapter's request carries). */
      applied: appliedOptions,
      enable(providerId: string, modelId: string): void { if (!adapters.has(providerId)) return; setOverlay(providerId, modelId, { ...overlays(providerId).get(modelId), enabled: true, updated_ms: now() }); changed(providerId); pump(); },
    },
    /** Whether an agent tool of this capability has anything to run on now. */
    available: (capability: GenerationCapability) => capabilities().find((entry) => entry.capability === capability)?.available === true,
    /** The ledger as the usage query reads it; no channel method returns these rows. */
    ledgerRows: (query: { from_ms?: number; to_ms?: number; projectId?: string } = {}) => db.prepare(`SELECT * FROM gen_ledger WHERE ts_ms >= ? AND ts_ms <= ?${query.projectId ? " AND project_id = ?" : ""} ORDER BY ts_ms`).all(...[query.from_ms ?? 0, query.to_ms ?? Number.MAX_SAFE_INTEGER, ...(query.projectId ? [query.projectId] : [])]) as Record<string, unknown>[],
    /**
     * What a recording says, as text: the Transcription role of ORC decides the model, else the catalogue's recommended listener. Undefined
     * when no connected provider can listen — a caller then goes on unchecked and says so.
     */
    /**
     * Speech written back as text. It is paid work of a provider like any job, and runs under the job path's own
     * rules — the estimate is reserved against every budget in scope before anything is sent (a hard stop refuses it),
     * each call is a row of the ledger under the caller's session and project, a provider serves only as many at once
     * as its transcription limit says, and a failed call is retried by the one retry policy. It is not a listed job:
     * nothing of it is a file a person keeps. Undefined when no listener is on for this host.
     */
    /**
     * The listener `transcribe` would ask right now — the same choice, made without sending anything. `consentMissing`
     * is always empty (nothing is asked per action); the field stays for the screens that read it.
     */
    listener(seconds?: number, /** The language the request will name, when it names one: what the request says is in its price. */ language?: string): { provider: string; model: string; /** The model's own name, as a confirmation shows it. */ modelLabel: string; label: string; host: string; consentMissing: GenerationContentKind[]; /** What listening to `seconds` of sound is estimated to cost; null when it is not known. */ estimateUsd: number | null } | undefined {
      const routing = deps.orcRoute?.("transcription");
      const listeners = allModels().filter((model) => model.capability === "transcription" && model.enabled).sort((a, b) => Number(b.recommended === true) - Number(a.recommended === true));
      const targets = routing?.configured ? routing.targets.flatMap((target) => listeners.filter((model) => model.provider === target.provider && model.id === target.model)) : listeners;
      const model = targets.find((entry) => !!adapters.get(entry.provider)?.transcribe && usable(entry.provider) && !!secretOf(entry.provider));
      if (!model) return undefined;
      const definition = adapterOf(model.provider).describe();
      return { provider: model.provider, model: model.id, modelLabel: model.label, label: definition.label, host: definition.hosts[0] ?? "", consentMissing: consentFor(model.provider, ["audio"]), estimateUsd: listeningUsd(model, seconds, language) };
    },
    /** The model `translate` would ask right now, and the estimate for `characters` of text (`consentMissing`: always empty, as for `listener`). */
    translator(work: TranslationWork = translationWork("")): { provider: string; model: string; label: string; host: string; consentMissing: GenerationContentKind[]; estimateUsd: number | null } | undefined {
      const model = translators()[0];
      if (!model) return undefined;
      const definition = adapterOf(model.provider).describe();
      return { provider: model.provider, model: model.id, label: definition.label, host: definition.hosts[0] ?? "", consentMissing: consentFor(model.provider, ["transcript"]), estimateUsd: translationUsd(model, work) };
    },
    /**
     * A text answered by the Translation role's model, as paid work under the job path's rules like listening is:
     * the estimate reserved against every budget in scope, a ledger row per call under the caller's session and
     * project, the provider's translation limit, the one retry policy. An internal job: stored while it runs, never
     * listed. Undefined when no model can translate on this host.
     */
    /** Every model that can translate as a job, in the order they are tried: the role's candidates (primary, then fallbacks), else the catalogue's. */
    translatorList(work: TranslationWork = translationWork("")): { provider: string; model: string; label: string; estimateUsd: number | null }[] {
      return translators().map((model) => ({ provider: model.provider, model: model.id, label: adapterOf(model.provider).describe().label, estimateUsd: translationUsd(model, work) }));
    },
    /** The retry policy's wait before the first attempt on the next candidate of a route. */
    nextRoute: (signal: AbortSignal = new AbortController().signal): Promise<void> => wait(nextRouteWaitMs, signal),
    /**
     * `scope.provider` + `scope.model`: that candidate only (the caller walks the route itself — the captions service,
     * whose candidates may also be models of a runtime). Without them the candidates are tried IN ORDER here: after the
     * retry policy is exhausted on one, the next is asked only for a failure class of the fallback set
     * (`scope.fallbackOn`, by default ORC's) — never for a budget, a content block or a cancel — and the answer says
     * `usedFallback` when it was not the first that served.
     */
    async translate(input: { prompt: string; /** The length of the text to translate, and how many lines it is. */ characters: number; lines?: number; /** The limit of the answer this request sends (ruling R6). */ maxOutputTokens?: number }, signal: AbortSignal = new AbortController().signal, scope: { sessionId?: string; projectId?: string; consent?: "once"; provider?: string; model?: string; fallbackOn?: readonly string[]; /** The action of the spend gate this call is charged to and held by; without one it is the host's own work. */ action?: string; /** The caller walks the route itself and this candidate is not its first: the job and its ledger rows say a fallback served. */ usedFallback?: boolean } = {}): Promise<{ text: string; costUsd: number; model: string; usedFallback?: true; cutOff?: true } | undefined> {
      const candidates = translators().filter((model) => !scope.provider || (model.provider === scope.provider && model.id === scope.model));
      if (!candidates.length) return undefined;
      const fallbackOn: readonly string[] = scope.fallbackOn ?? ORC_DEFAULT_FALLBACK_ON;
      for (const [index, model] of candidates.entries()) {
        if (index) await wait(nextRouteWaitMs, signal);
        try { const written = await this.translateOn(model, input, signal, { ...scope, usedFallback: scope.usedFallback === true || index > 0 }); return index ? { ...written, usedFallback: true as const } : written; } catch (error) {
          if (index === candidates.length - 1 || !(error instanceof ProviderFailure) || !fallbackOn.includes(error.class)) throw error;
        }
      }
      return undefined;
    },
    /** One candidate, under the job path's rules and the one retry policy. */
    async translateOn(model: GenerationModel, input: { prompt: string; characters: number; lines?: number; maxOutputTokens?: number }, signal: AbortSignal, scope: { sessionId?: string; projectId?: string; usedFallback?: boolean; action?: string }): Promise<{ text: string; costUsd: number; model: string; /** The provider stopped the answer at the limit: `text` is not a whole answer. */ cutOff?: true }> {
      const adapter = adapters.get(model.provider)!, secret = secretOf(model.provider)!;
      const work = translationWork(input.prompt, input.characters, input.lines, input.maxOutputTokens), estimateUsd = translationUsd(model, work), limit = model.pricing?.kind === "tokens" || work.maxOutputTokens !== undefined ? translationLimit(model, work) : undefined, reasoning = translationReasoning(model);
      const covered = scope.action ?? gate.covered(scope.sessionId) ?? unattendedOf(scope.sessionId, { provider: model.provider, model: model.id, estimateUsd, kind: model.capability }), actionId = covered;
      const job: GenerationJob = {
        jobId: randomUUID(), kind: INTERNAL_TRANSLATION, capability: "translation", state: "running", progress: 0, provider: model.provider, model: model.id, params: {},
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}), ...(scope.projectId ? { projectId: scope.projectId } : {}), createdBy: "host", priority: "batch", attempts: [], resumable: false, cancellable: false,
        estimateUsd, actualUsd: null, cacheHit: false, usedFallback: scope.usedFallback === true, results: [], warnings: [], created_ms: now(), started_ms: now(),
      };
      let billed = 0;
      // The LOGICAL request (review 16 #4): the same action asking the same model for the same text is the same request, however often it is taken up again — each time as a new job. A person's leave for it when it stopped is found by this, not by a job's id.
      const request = `translation:${createHash("sha256").update(JSON.stringify([actionId, model.provider, model.id, input.prompt, limit ?? null])).digest("hex").slice(0, 32)}`;
      reserve(job);
      persist(job);
      const end = (state: "succeeded" | "failed" | "cancelled", actualUsd: number | null): void => { job.state = state; job.finished_ms = now(); job.actualUsd = actualUsd; if (state === "succeeded") job.progress = 1; persist(job); };
      const most = stored().limits[model.provider]?.maxConcurrent?.translation ?? DEFAULT_CONCURRENCY.translation;
      try {
        while ((translating.get(model.provider) ?? 0) >= most) { await wait(25, signal); if (signal.aborted) throw new ProviderFailure("cancelled", "Cancelled."); }
        translating.set(model.provider, (translating.get(model.provider) ?? 0) + 1);
        try {
          for (let n = 1; ; n++) {
            const started = now();
            let token: SpendToken | undefined;
            try {
              const written = await gate.spend(actionId, { provider: model.provider, model: model.id, estimateUsd, kind: "translation", ref: job.jobId, request }, (given) => { token = given; return adapter.translate!({ prompt: input.prompt, model: model.id, ...(limit !== undefined ? { maxOutputTokens: limit } : {}), ...(reasoning ? { reasoning } : {}) }, { secret, signal }, given); });
              // What THIS attempt was charged — and the job, the budgets and the caller are told everything the request was billed, the attempts that failed after their bill included.
              const actual = token!.chargedUsd ?? null, whole = billed > 0 ? money(billed + (actual ?? 0)) : actual;
              settle(job.jobId, whole);
              end("succeeded", whole);
              ledger(job, "succeeded", { units: { calls: 1, characters: input.characters }, actualUsd: actual, priceSource: typeof written.costUsd === "number" ? "provider" : model.pricing ? "catalogue" : "none", duration_ms: now() - started });
              noteHealth(model.provider);
              return { text: written.text, costUsd: whole ?? 0, model: model.id, ...(written.cutOff ? { cutOff: true as const } : {}) };
            } catch (error) {
              if (isSpendStop(error)) throw error;
              const failure = error instanceof ProviderFailure ? (signal.aborted ? new ProviderFailure("cancelled", "Cancelled.") : error) : classifyThrownFailure(error, signal);
              // A request the provider billed and then failed (the gate charged it at the answer): its bill is this attempt's row, and stays with the job.
              const bill = typeof token?.chargedUsd === "number" ? token.chargedUsd : 0;
              billed = money(billed + bill);
              ledger(job, failure.class === "cancelled" ? "cancelled" : "failed", { actualUsd: bill, priceSource: bill > 0 ? "provider" : "none", errorClass: failure.class, duration_ms: now() - started });
              const again = RETRY_FULL.includes(failure.class) ? n < 3 : RETRY_ONCE.includes(failure.class) ? n < 2 : false;
              if (!again) throw failure;
              // The attempt that follows is a request like the first: the bills so far are committed, and the budgets are asked again before it goes out.
              reserveNext(job, billed);
              await wait(failure.class === "rate_limited" && failure.retryAfterMs ? Math.min(120_000, failure.retryAfterMs) : retryDelays[n - 1] * (1 + 0.2 * jitter()), signal);
              // …and asked once more NOW, when the attempt is sent: a budget set or lowered during the wait holds it.
              reserveNext(job, billed);
            }
          }
        } finally { translating.set(model.provider, Math.max(0, (translating.get(model.provider) ?? 1) - 1)); }
      } catch (error) {
        // Nothing was billed: the reservation goes back. Something was: it is kept by the budgets as what the job cost, though it failed.
        if (billed > 0) settle(job.jobId, billed); else release(job.jobId);
        end(signal.aborted ? "cancelled" : "failed", billed > 0 ? billed : null);
        throw error;
      } finally { if (actionId.startsWith("unattended:call:")) gate.close(actionId); }
    },
    async transcribe(input: { bytes: Uint8Array; format: "wav" | "mp3"; language?: string; /** The length of the recording, for the estimate. */ seconds?: number }, signal: AbortSignal = new AbortController().signal, scope: { sessionId?: string; projectId?: string; /** Accepted from callers written before 2026-10-08; decides nothing. */ consent?: "once"; /** The action of the spend gate this call is charged to and held by; without one it is the host's own work. */ action?: string } = {}): Promise<{ text: string; costUsd: number; model: string } | undefined> {
      const routing = deps.orcRoute?.("transcription");
      // Only a listener that is on for this host is asked: the models of the Transcription role when Model routing has
      // any (and no other — a role that is off or cannot serve means nobody listens); else the recommended one, then any other.
      const listeners = allModels().filter((model) => model.capability === "transcription" && model.enabled).sort((a, b) => Number(b.recommended === true) - Number(a.recommended === true));
      const targets = routing?.configured ? routing.targets.flatMap((target) => listeners.filter((model) => model.provider === target.provider && model.id === target.model)) : listeners;
      const model = targets.find((entry) => !!adapters.get(entry.provider)?.transcribe && usable(entry.provider) && !!secretOf(entry.provider));
      if (!model) return undefined;
      const adapter = adapters.get(model.provider)!, secret = secretOf(model.provider)!;
      // The same price as the estimate a person was shown (`listener`): by the model's declared kind of price. Without a price (or a length a per-token or per-second price needs) the cost is unknown, and a strict budget refuses it.
      const estimateUsd = listeningUsd(model, input.seconds, input.language);
      const covered = scope.action ?? gate.covered(scope.sessionId) ?? unattendedOf(scope.sessionId, { provider: model.provider, model: model.id, estimateUsd, kind: model.capability }), actionId = covered;
      // An INTERNAL job: stored like any job while it runs (so a host that stops in the middle finds it at its next
      // start, fails it and gives its reservation back), never queued, and not shown among the jobs a person made.
      const job: GenerationJob = {
        jobId: randomUUID(), kind: INTERNAL_TRANSCRIPTION, capability: "transcription", state: "running", progress: 0, provider: model.provider, model: model.id, params: { ...(input.language ? { language: input.language } : {}) },
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}), ...(scope.projectId ? { projectId: scope.projectId } : {}), createdBy: "host", priority: "batch", attempts: [], resumable: false, cancellable: false,
        estimateUsd, actualUsd: null, cacheHit: false, usedFallback: false, results: [], warnings: [], created_ms: now(), started_ms: now(),
      };
      let billed = 0;
      reserve(job);
      persist(job);
      const end = (state: "succeeded" | "failed" | "cancelled", actualUsd: number | null): void => { job.state = state; job.finished_ms = now(); job.actualUsd = actualUsd; if (state === "succeeded") job.progress = 1; persist(job); };
      const most = stored().limits[model.provider]?.maxConcurrent?.transcription ?? DEFAULT_CONCURRENCY.transcription;
      try {
        while ((listening.get(model.provider) ?? 0) >= most) { await wait(25, signal); if (signal.aborted) throw new ProviderFailure("cancelled", "Cancelled."); }
        listening.set(model.provider, (listening.get(model.provider) ?? 0) + 1);
        try {
          for (let n = 1; ; n++) {
            const started = now();
            let token: SpendToken | undefined;
            try {
              const heard = await gate.spend(actionId, { provider: model.provider, model: model.id, estimateUsd, kind: "transcription", ref: job.jobId, request: `transcription:${createHash("sha256").update(JSON.stringify([actionId, model.provider, model.id, input.language ?? null, input.format])).update(input.bytes).digest("hex").slice(0, 32)}` }, (given) => { token = given; return adapter.transcribe!({ bytes: input.bytes, format: input.format, ...(input.language ? { language: input.language } : {}), model: model.id }, { secret, signal }, given); });
              // What THIS attempt was charged — and the job, the budgets and the caller are told everything the request was billed, the attempts that failed after their bill included.
              const actual = token!.chargedUsd ?? null, whole = billed > 0 ? money(billed + (actual ?? 0)) : actual;
              settle(job.jobId, whole);
              end("succeeded", whole);
              ledger(job, "succeeded", { units: { calls: 1, ...(input.seconds ? { seconds: input.seconds } : {}) }, actualUsd: actual, priceSource: typeof heard.costUsd === "number" ? "provider" : model.pricing ? "catalogue" : "none", duration_ms: now() - started });
              noteHealth(model.provider);
              return { text: heard.text, costUsd: whole ?? 0, model: model.id };
            } catch (error) {
              if (isSpendStop(error)) throw error;
              const failure = error instanceof ProviderFailure ? (signal.aborted ? new ProviderFailure("cancelled", "Cancelled.") : error) : classifyThrownFailure(error, signal);
              // A request the provider billed and then failed (the gate charged it at the answer): its bill is this attempt's row, and stays with the job.
              const bill = typeof token?.chargedUsd === "number" ? token.chargedUsd : 0;
              billed = money(billed + bill);
              ledger(job, failure.class === "cancelled" ? "cancelled" : "failed", { actualUsd: bill, priceSource: bill > 0 ? "provider" : "none", errorClass: failure.class, duration_ms: now() - started });
              const again = RETRY_FULL.includes(failure.class) ? n < 3 : RETRY_ONCE.includes(failure.class) ? n < 2 : false;
              if (!again) throw failure;
              // The attempt that follows is a request like the first: the bills so far are committed, and the budgets are asked again before it goes out.
              reserveNext(job, billed);
              await wait(failure.class === "rate_limited" && failure.retryAfterMs ? Math.min(120_000, failure.retryAfterMs) : retryDelays[n - 1] * (1 + 0.2 * jitter()), signal);
              // …and asked once more NOW, when the attempt is sent: a budget set or lowered during the wait holds it.
              reserveNext(job, billed);
            }
          }
        } finally { listening.set(model.provider, Math.max(0, (listening.get(model.provider) ?? 1) - 1)); }
      } catch (error) {
        // Nothing was billed: the reservation goes back. Something was: it is kept by the budgets as what the job cost, though it failed.
        if (billed > 0) settle(job.jobId, billed); else release(job.jobId);
        end(signal.aborted ? "cancelled" : "failed", billed > 0 ? billed : null);
        throw error;
      } finally { if (actionId.startsWith("unattended:call:")) gate.close(actionId); }
    },
    /** A picture of the blob store as a JPEG of at most 768 px, for showing it to a model; undefined when the host cannot make one. */
    smallPicture: (blobId: string): Promise<Uint8Array | undefined> => (deps.blobs.status(blobId).state === "complete" ? smallPicture(blobId) : Promise.resolve(undefined)),
    /** Model routing gives this capability's role at least one profile (ORC is in force for it): what a feature reads that uses a capability ONLY when its role was routed (a film's shots become clips only then). */
    routed: (capability: GenerationCapability): boolean => { try { return deps.orcRoute?.(capability)?.configured === true; } catch { return false; } },
    close(): void { closed = true; for (const entry of live.values()) entry.abort.abort("cancelled"); },
    /** A provider's state changed outside this service (a local model was installed or removed): screens are told, and queued work may start. */
    providerChanged(providerId: string): void { changed(providerId); pump(); },
  };
}
export type GenerationService = ReturnType<typeof createGenerationService>;
