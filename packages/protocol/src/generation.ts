import { z } from "zod";
import type { Scope } from "./roles.ts";

/**
 * Wire types of media generation (`generation-providers`): the provider registry, the model catalogue with its
 * capability metadata and cost model, estimates, provider jobs, consent, thresholds and the result cache.
 */
export const GENERATION_CAPABILITIES = ["image", "video", "tts", "voice-design", "music", "sfx", "lipsync", "transcription", "translation", "stock-media"] as const;
export type GenerationCapability = (typeof GENERATION_CAPABILITIES)[number];
const capability = z.enum(GENERATION_CAPABILITIES);

/** The closed set of provider failure classes. */
export const GENERATION_ERROR_CLASSES = [
  "auth_error", "forbidden", "rate_limited", "quota_exhausted", "timeout", "server_error", "network", "model_unavailable", "capability_mismatch",
  "invalid_request", "content_blocked", "invalid_output", "budget_exceeded", "cancelled", "unknown", "out_of_memory",
] as const;
export type GenerationErrorClass = (typeof GENERATION_ERROR_CLASSES)[number];
/** What each class says to a person, whether it is retried, and what it suggests. */
export const GENERATION_ERROR_INFO: Record<GenerationErrorClass, { message: string; retryable: boolean | "once"; action: "Open provider settings" | "Switch model" | "Edit prompt" | "Raise budget" | "Retry" }> = {
  auth_error: { message: "The provider rejected this API key", retryable: false, action: "Open provider settings" },
  forbidden: { message: "The key is not allowed to use this model", retryable: false, action: "Open provider settings" },
  rate_limited: { message: "The provider is limiting requests", retryable: true, action: "Retry" },
  quota_exhausted: { message: "The provider account has no credit left", retryable: false, action: "Open provider settings" },
  timeout: { message: "The provider did not answer in time", retryable: true, action: "Retry" },
  server_error: { message: "The provider had an error", retryable: true, action: "Retry" },
  network: { message: "Unable to reach the provider", retryable: true, action: "Retry" },
  model_unavailable: { message: "This model is not available right now", retryable: true, action: "Switch model" },
  capability_mismatch: { message: "This model cannot do what was asked", retryable: false, action: "Switch model" },
  invalid_request: { message: "The provider did not accept this request", retryable: false, action: "Edit prompt" },
  content_blocked: { message: "The provider blocked this request under its content policy", retryable: false, action: "Edit prompt" },
  invalid_output: { message: "The provider returned a file that cannot be read", retryable: "once", action: "Retry" },
  budget_exceeded: { message: "A budget has been reached", retryable: false, action: "Raise budget" },
  cancelled: { message: "The job was cancelled", retryable: false, action: "Retry" },
  unknown: { message: "The provider returned an unexpected error", retryable: "once", action: "Retry" },
  /** A model that runs on the host ran out of memory: a smaller quant or picture size fits. */
  out_of_memory: { message: "This computer ran out of memory for this picture. Choose a smaller quant or picture size under Settings, Providers, Generation, Local models", retryable: false, action: "Switch model" },
};

const usd = z.number().min(0).max(100_000);
const when = z.record(z.union([z.string(), z.number(), z.boolean()]));
/**
 * WHERE a price was taken from (coordinator's ruling R7, 2026-10-08) — a price without one is not used in a quote: the
 * work is "price not known". "provider-list": the provider's own published price (its models API), read on `date`.
 * "measured": taken from real bills on `date` (`sample` says of what) — an estimate: a quote made from it says "about".
 * "admin": typed in on this host by its admin on `date` (the host's own statement of what it pays).
 */
export const generationPriceSourceSchema = z.object({ kind: z.enum(["provider-list", "measured", "admin"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(400).optional(), sample: z.string().max(400).optional() }).strict();
export type GenerationPriceSource = z.infer<typeof generationPriceSourceSchema>;
/**
 * The ONE approval card of an assistant message's costed calls (spec `agent-editing-tools`, "Cost guard", rule 4;
 * coordinator's ruling R8): every costed call the message issued — the ones already made inside the amount ("made")
 * and the ones that wait for the answer ("waiting") — and their total. Nothing that waits is queued until "allow".
 */
export type GenerationMessageCard = {
  cardId: string; sessionKey: string; /** The runtime's id of the assistant message (its turn). */ messageId: string; state: "pending" | "allowed" | "denied";
  items: { itemId: string; tool: string; capability: GenerationCapability; provider: string; model: string; modelLabel: string; /** What the call is estimated at; null: the price of its model is not known. */ amountUsd: number | null; /** The beginning of what it asks for (its prompt or text). */ words: string; state: "made" | "waiting" }[];
  /** The sum of the items whose price is known (made and waiting). */ totalUsd: number; /** The models of waiting items whose price is not known: each is named on the card. */ unpricedModels: string[];
  /** The amount a message may spend unasked (the session's per-call approval amount). */ allowanceUsd: number; created_ms: number; decided_ms?: number;
};
const source = generationPriceSourceSchema.optional();
/** The cost model of one model. `approximate` marks a list price that the provider bills by tokens underneath. `source`: where the price was taken from — without it the price is not used. */
export const generationPricingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tokens"), inputPerMillionUsd: usd, outputPerMillionUsd: usd, cachedInputPerMillionUsd: usd.optional(), source }).strict(),
  z.object({ kind: z.literal("per_image"), baseUsd: usd, tiers: z.array(z.object({ when, usd }).strict()).max(16).optional(), approximate: z.boolean().optional(), /** What each reference picture sent with a request adds. */ referenceUsd: usd.optional(), source }).strict(),
  z.object({ kind: z.literal("per_second"), usd, tiers: z.array(z.object({ when, usd }).strict()).max(16).optional(), /** video: what each picture sent with a request (its first frame) adds, where the provider's list prices it. */ referenceUsd: usd.optional(), source }).strict(),
  z.object({ kind: z.literal("per_clip"), tiers: z.array(z.object({ when, usd }).strict()).min(1).max(16), source }).strict(),
  z.object({ kind: z.literal("per_character"), perThousandUsd: usd, approximate: z.boolean().optional(), source }).strict(),
  z.object({ kind: z.literal("per_call"), usd, source }).strict(),
  z.object({ kind: z.literal("free") }).strict(),
]);
export type GenerationPricing = z.infer<typeof generationPricingSchema>;

/** Capability metadata of a model: what a request to it may ask for. Feature code reads it from the catalogue only. */
export type GenerationModelMetadata = {
  resumable: boolean; cancellable: boolean;
  /** image */
  aspectRatios?: string[]; maxImages?: number; maxPromptLength?: number; seed?: boolean; negativePrompt?: boolean; referenceImages?: number;
  /** tts */
  voices?: { voiceId: string; name: string; languages: string[]; gender?: "female" | "male" | "neutral"; tags?: string[] }[];
  languages?: string[]; speed?: { min: number; max: number }; formats?: string[]; maxCharacters?: number; wordTimings?: boolean;
  /** tts: the model takes delivery instructions beside the text (how the provider documents saying an accent, a tone); it speaks in the voice of a sample sent with the request (stateless voice cloning). Absent: the provider documents neither for this model. */
  instructions?: boolean; voiceClone?: boolean;
  /** music */
  durationSeconds?: { min: number; max: number }; instrumental?: boolean; lyrics?: boolean;
  /** video: the lengths (whole seconds) and resolutions a request may ask for, and which frames a picture may be given as ("first_frame", "last_frame") — from the provider's own list. */
  durations?: number[]; resolutions?: string[]; frameImages?: string[];
  /**
   * Documented provider figures that a per-token price is computed from — and `sources[<field>]` says where each was
   * read (the provider's model list, its documentation page). A figure WITHOUT its source prices nothing: the request
   * is then "price not known". `maxOutputTokens`: the longest answer the model gives (sent with the request as its
   * limit); `audioTokensPerSecond`: the tokens the provider counts for one second of sound it is given.
   */
  maxOutputTokens?: number; audioTokensPerSecond?: number; sources?: Record<string, string>;
  /**
   * A text model that thinks before it answers, where the provider counts that thinking inside the limit of the answer
   * (ruling R6): "none" — the thinking can be switched off, and a translation asks for none; "minimal" — it can only be
   * turned down, and a translation asks for the least; "fixed" — it cannot be changed: how much of a limit it uses is
   * not known, so a translation on this model is "price not known". Absent: the row says nothing of thinking.
   */
  reasoning?: "none" | "minimal" | "fixed";
};
export type GenerationModel = {
  provider: string; id: string; label: string; capability: GenerationCapability; description?: string; recommended?: boolean; deprecated?: boolean;
  enabled: boolean; source: "bundled" | "fetched" | "user"; metadata: GenerationModelMetadata; pricing?: GenerationPricing; pricesAsOf?: string;
  edited?: boolean; customPrice?: boolean; updated_ms: number;
};
export const GENERATION_HEALTH = ["ready", "degraded", "down", "unauthorized", "unknown", "disabled"] as const;
export type GenerationHealth = (typeof GENERATION_HEALTH)[number];
export type GenerationLimits = { maxConcurrent: Partial<Record<GenerationCapability, number>>; requestsPerMinute?: number };
export type GenerationProvider = {
  /** `local`: a model that runs on the host itself (nothing is sent anywhere, nothing is billed). */
  id: string; label: string; description: string; source: "builtin" | "server" | "endpoint" | "local"; host: string; capabilities: GenerationCapability[];
  connection: "connected" | "not_connected" | "invalid"; enabled: boolean; health: GenerationHealth; healthReason?: string; lastSuccess_ms?: number; lastError?: string;
  secrets: { name: string; set: boolean; last4?: string }[]; modelCounts: Partial<Record<GenerationCapability, { total: number; enabled: number }>>;
  limits: GenerationLimits; docsUrl?: string; updated_ms: number;
  /** What connecting this provider means for what is sent to it: one sentence, then one line per kind of work it serves on this host now (which content goes to it). Shown by the Providers screen when the provider is connected and afterwards; nothing is asked per action. */
  sendingNote: string; sends: string[];
  /** A key of this vendor stored under Sign-in & keys that Generation can use without it being entered again. */
  signInKeyAvailable: boolean; keySource?: "own" | "sign-in"; modelsAge_ms?: number;
};
/** A capability no connected provider serves is listed with the reason, and no entry point is shown for it. */
export type GenerationCapabilityState = { capability: GenerationCapability; available: boolean; reason?: string };

export const GENERATION_CONTENT_KINDS = ["image", "video", "audio", "frames", "transcript", "document_text"] as const;
export type GenerationContentKind = (typeof GENERATION_CONTENT_KINDS)[number];
export type GenerationConsent = { providerId: string; contentKinds: GenerationContentKind[]; grantedBy: { deviceId: string }; granted_ms: number };

/** The parameters of one generation request; which of them a capability reads is in its catalogue metadata. */
export const generationParamsSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000).optional(), negativePrompt: z.string().max(20_000).optional(),
  aspectRatio: z.string().max(12).optional(), quality: z.enum(["low", "medium", "high"]).optional(), count: z.number().int().min(1).max(10).optional(), seed: z.number().int().min(0).max(2_147_483_647).optional(),
  text: z.string().trim().min(1).max(20_000).optional(), voice: z.string().min(1).max(80).optional(), language: z.string().max(16).optional(), speed: z.number().min(0.25).max(4).optional(),
  durationSeconds: z.number().min(1).max(600).optional(), instrumental: z.boolean().optional(), lyrics: z.string().max(5000).optional(),
  /** video: the resolution asked for ("720p"), one of the model's `resolutions`. */
  resolution: z.string().regex(/^[0-9A-Za-z]{2,8}$/).optional(),
  /** tts: how the text is to be delivered (an accent, a tone), for models whose `instructions` is true. */
  instructions: z.string().trim().min(1).max(400).optional(),
  /** tts: a recording of the host's blob store whose voice the text is spoken in, for models whose `voiceClone` is true; and what that recording says, when known. */
  voiceSampleBlobId: z.string().regex(/^[a-f0-9]{64}$/).optional(), voiceSampleText: z.string().max(10_000).optional(),
  /** image: pictures of the host's blob store the new picture is drawn WITH (a character sheet, a place, the frame before), at most what the model's `referenceImages` says. */
  referenceBlobIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(16).optional(),
}).strict();
export type GenerationParams = z.infer<typeof generationParamsSchema>;

const modelRef = { provider: z.string().min(1).max(120).optional(), model: z.string().min(1).max(200).optional() };
export const generationEstimateParams = z.object({ items: z.array(z.object({ ...modelRef, capability, params: generationParamsSchema }).strict()).min(1).max(100) }).strict();
export type GenerationEstimate = {
  provider: string | null; model: string | null; label: string | null; amountUsd: number | null; basis: string; breakdown: { label: string; usd: number }[];
  confidence: "exact" | "upper_bound" | "approximate" | "unknown"; blocked?: { reason: "unpriced_model" | "budget_exceeded" | "no_route"; scope?: string; scopeId?: string; remainingUsd?: number };
};
export type GenerationEstimateResult = { items: GenerationEstimate[]; totalUsd: number; excludesUnknown: boolean; confirmAboveUsd: number };

export const GENERATION_JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type GenerationJobState = (typeof GENERATION_JOB_STATES)[number];
export const GENERATION_PRIORITIES = ["interactive", "batch", "automation"] as const;
export type GenerationAsset = {
  blobId: string; mime: string; name: string; size: number; kind: "image" | "audio" | "video"; width?: number; height?: number; durationSeconds?: number; codec?: string;
  provenance: { source: "ai"; provider: string; model: string; role: string; prompt?: string; negativePrompt?: string; seed?: number; jobId: string; cost?: { amount: number; currency: "USD" }; created_ms: number; referenceAssetIds: string[] };
};
export type GenerationJob = {
  jobId: string; kind: string; capability: GenerationCapability; state: GenerationJobState; progress: number; status?: string; queuePosition?: number;
  provider: string; model: string; params: GenerationParams; projectId?: string; sessionId?: string; toolCallId?: string; batchId?: string; createdBy: string;
  priority: (typeof GENERATION_PRIORITIES)[number]; attempts: { n: number; provider: string; model: string; errorClass?: GenerationErrorClass; started_ms: number; duration_ms: number }[];
  resumable: boolean; cancellable: boolean; estimateUsd: number | null; actualUsd: number | null; cacheHit: boolean; usedFallback: boolean; results: GenerationAsset[]; warnings: string[];
  error?: { class: GenerationErrorClass; message: string; action: string; retryable: boolean; details?: Record<string, unknown> };
  created_ms: number; started_ms?: number; finished_ms?: number;
};
export const generationCreateParams = z.object({
  capability, ...modelRef, params: generationParamsSchema, projectId: z.string().min(1).max(64).optional(), sessionId: z.string().min(1).max(200).optional(), batchId: z.string().min(1).max(64).optional(),
  /** The estimate the person saw and accepted; needed above "Ask before spending more than" and for an unknown cost. */
  confirmed: z.boolean().optional(),
  /** What the money question named to be sent back with the answer (`details.confirmWith`): the action and the quote that was shown. */
  actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional(),
  /** Project-derived content this request carries, and the one-time consent for it. */
  contentKinds: z.array(z.enum(GENERATION_CONTENT_KINDS)).max(6).optional(), consent: z.literal("once").optional(),
  cache: z.enum(["use", "bypass"]).optional(), reuse: z.boolean().optional(), idempotencyKey: z.string().min(8).max(64).optional(),
}).strict();
export type GenerationCreateParams = z.input<typeof generationCreateParams>;

/** The host values of the one set of spending thresholds. */
export const generationThresholdsSchema = z.object({
  perCallApprovalUsd: z.number().min(0).max(100), autoSessionBudgetUsd: z.number().min(0).max(1000), confirmAboveUsd: z.number().min(0).max(100), maxSelfServiceUsd: z.number().min(0).max(10_000),
}).strict();
export type GenerationThresholds = z.infer<typeof generationThresholdsSchema>;
export const GENERATION_THRESHOLD_DEFAULTS: GenerationThresholds = { perCallApprovalUsd: 0.5, autoSessionBudgetUsd: 5, confirmAboveUsd: 0, maxSelfServiceUsd: 50 };

export type GenerationVoice = { voiceId: string; provider: string; model: string; name: string; languages: string[]; gender?: string; tags: string[]; source: "provider" | "designed" | "cloned" };

const providerId = z.string().min(1).max(120), modelId = z.string().min(1).max(200);
export const generationRpcParams = {
  "jagentchill.provider.list": z.object({ capability: capability.optional() }).strict(),
  "jagentchill.provider.connect": z.object({ providerId, fields: z.record(z.string().max(200)).optional(), secretNames: z.array(z.string().min(1).max(80)).max(2).default([]) }).strict(),
  "jagentchill.provider.disconnect": z.object({ providerId }).strict(),
  "jagentchill.provider.update": z.object({ providerId, enabled: z.boolean().optional(), limits: z.object({ maxConcurrent: z.record(capability, z.number().int()).optional(), requestsPerMinute: z.number().int().nullable().optional() }).strict().optional() }).strict(),
  "jagentchill.provider.test": z.object({ providerId }).strict(),
  "jagentchill.provider.key.replace": z.object({ providerId, keyId: z.string().max(40).optional(), secretName: z.string().min(1).max(80) }).strict(),
  "jagentchill.provider.model.list": z.object({ providerId: providerId.optional(), capability: capability.optional(), enabledOnly: z.boolean().optional(), query: z.string().max(200).optional() }).strict(),
  "jagentchill.provider.model.refresh": z.object({ providerId }).strict(),
  "jagentchill.provider.model.upsert": z.object({ providerId, model: z.object({ id: modelId, label: z.string().min(1).max(120).optional(), capability, enabled: z.boolean().optional(), metadata: z.record(z.unknown()).optional(), pricing: generationPricingSchema.nullable().optional() }).strict() }).strict(),
  "jagentchill.provider.model.reset": z.object({ providerId, modelId }).strict(),
  "jagentchill.provider.model.setEnabled": z.object({ providerId, capability: capability.optional(), modelIds: z.array(modelId).max(500).optional(), enabled: z.boolean() }).strict(),
  "jagentchill.provider.cache.get": z.object({}).strict(),
  "jagentchill.provider.cache.clear": z.object({}).strict(),
  "jagentchill.provider.threshold.get": z.object({ /** With it: the answer also has `session`, the two agent allowances as they hold for that session (the host's, or the session's own). */ sessionKey: z.string().min(1).max(200).optional() }).strict(),
  "jagentchill.provider.threshold.set": z.object({ /** With it the patch is ONE SESSION's (spec rules 2 and 3): only `perCallApprovalUsd` (lower than the host's, never higher) and `autoSessionBudgetUsd` (lower: `jagentchill.agent.use`; higher: `jagentchill.generation.run`, up to `maxSelfServiceUsd`). Without it: the host's values (`jagentchill.config.write`). */ sessionKey: z.string().min(1).max(200).optional(), patch: z.object({ perCallApprovalUsd: z.number().optional(), autoSessionBudgetUsd: z.number().optional(), confirmAboveUsd: z.number().optional(), maxSelfServiceUsd: z.number().optional() }).strict() }).strict(),
  "jagentchill.provider.estimate": generationEstimateParams,
  /** The approval cards of a session's assistant messages (spec `agent-editing-tools`, "Cost guard", rule 4): ONE card a message, listing each costed call and the total. */
  "jagentchill.provider.messageCard.list": z.object({ sessionKey: z.string().min(1).max(200) }).strict(),
  /** The person's answer to a card: "allow" — the calls it lists as waiting may be made (the agent is told to make them again); "deny" — none of them. */
  "jagentchill.provider.messageCard.resolve": z.object({ cardId: z.string().min(1).max(200), decision: z.enum(["allow", "deny"]) }).strict(),
  "jagentchill.provider.voice.list": z.object({ provider: providerId.optional(), language: z.string().max(16).optional(), query: z.string().max(200).optional() }).strict(),
  "jagentchill.provider.consent.list": z.object({}).strict(),
  "jagentchill.provider.consent.grant": z.object({ providerId, contentKinds: z.array(z.enum(GENERATION_CONTENT_KINDS)).min(1).max(6) }).strict(),
  "jagentchill.provider.consent.revoke": z.object({ providerId }).strict(),
  "jagentchill.provider.consent.check": z.object({ providers: z.array(providerId).max(20).optional(), capability: capability.optional(), contentKinds: z.array(z.enum(GENERATION_CONTENT_KINDS)).max(6), projectId: z.string().max(64).optional() }).strict(),
  "jagentchill.provider.subscribe": z.object({}).strict(),
  "jagentchill.provider.unsubscribe": z.object({}).strict(),
  "jagentchill.generation.create": generationCreateParams,
  "jagentchill.job.list": z.object({ kind: z.string().max(40).optional(), state: z.enum(GENERATION_JOB_STATES).optional(), projectId: z.string().max(64).optional(), batchId: z.string().max(64).optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  "jagentchill.job.get": z.object({ jobId: z.string().min(1).max(64) }).strict(),
  "jagentchill.job.cancel": z.object({ jobId: z.string().min(1).max(64) }).strict(),
  "jagentchill.job.retry": z.object({ jobId: z.string().min(1).max(64), /** A retry is paid work like the job was: its estimate of now is confirmed like any other (the answer to its question). */ confirmed: z.boolean().optional(), actionId: z.string().min(1).max(200).optional(), quoteId: z.string().min(1).max(64).optional() }).strict(),
  "jagentchill.job.subscribe": z.object({}).strict(),
  "jagentchill.job.unsubscribe": z.object({}).strict(),
} as const;

const read: Scope = "jagentchill.config.read", write: Scope = "jagentchill.config.write", projects: Scope = "jagentchill.projects.read", run: Scope = "jagentchill.generation.run";
/** The scope each method of the generation service needs. */
export const GENERATION_METHOD_SCOPES: Record<keyof typeof generationRpcParams, Scope> = {
  "jagentchill.provider.list": read, "jagentchill.provider.connect": write, "jagentchill.provider.disconnect": write, "jagentchill.provider.update": write, "jagentchill.provider.test": write,
  "jagentchill.provider.key.replace": write, "jagentchill.provider.model.list": read, "jagentchill.provider.model.refresh": write, "jagentchill.provider.model.upsert": write,
  "jagentchill.provider.model.reset": write, "jagentchill.provider.model.setEnabled": write, "jagentchill.provider.cache.get": read, "jagentchill.provider.cache.clear": write,
  "jagentchill.provider.threshold.get": read, /* The host's values need `config.write` (checked by the handler); a session's own allowance needs less — see the method's parameters. */ "jagentchill.provider.threshold.set": projects, "jagentchill.provider.estimate": projects, "jagentchill.provider.voice.list": projects, "jagentchill.provider.messageCard.list": projects, /* Allowing spending needs `jagentchill.generation.run` (checked by the handler). */ "jagentchill.provider.messageCard.resolve": projects,
  "jagentchill.provider.consent.list": read, "jagentchill.provider.consent.grant": write, "jagentchill.provider.consent.revoke": write, "jagentchill.provider.consent.check": projects,
  "jagentchill.provider.subscribe": projects, "jagentchill.provider.unsubscribe": projects, "jagentchill.generation.create": run,
  "jagentchill.job.list": projects, "jagentchill.job.get": projects, "jagentchill.job.cancel": run, "jagentchill.job.retry": run, "jagentchill.job.subscribe": projects, "jagentchill.job.unsubscribe": projects,
};
