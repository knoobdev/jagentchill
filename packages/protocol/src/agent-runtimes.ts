import { z } from "zod";
import type { Scope } from "./roles.ts";

/** Domain codes of runtime and provider failures (`agent-runtimes.Error mapping` and the endpoint codes). */
export const RUNTIME_ERROR_CODES = [
  "runtime/not-installed", "runtime/signed-out", "runtime/disabled", "runtime/no-provider", "runtime/probe-timeout",
  "runtime/launch-failed", "runtime/auth-failed", "runtime/rate-limited", "runtime/billing", "runtime/model-unavailable",
  "runtime/context-overflow", "runtime/unsupported-capability", "runtime/switch-required", "runtime/switch-refused",
  "runtime/acp-spawn-unsupported", "runtime/mode-not-inheritable", "runtime/unattended-not-granted", "runtime/login-expired",
  "runtime/policy-denied", "runtime/relay-unsupported", "runtime/dialect-mismatch", "runtime/override-not-allowed",
  "runtime/endpoint-unreachable",
] as const;
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const LOGIN_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const RUNTIME_LIMITS = {
  endpoints: 40, endpointModels: 2000, endpointHeaders: 16, endpointQuery: 8, userPresets: 20, equivalents: 4, pinnedModels: 50,
  customProfiles: 20, addedRuntimes: 40, authProfilesPerProvider: 8, configuredModels: 200, additionalModels: 50, envVariables: 32,
  commandArguments: 32, snapshotScopes: 32, concurrentProbes: 4, loginsPerProvider: 1, concurrentLogins: 4, switchesPerHour: 20,
  diagnosticsBytes: 65_536,
} as const;

const runtimeId = z.string().regex(RUNTIME_ID_PATTERN);
const secretName = z.string().regex(SECRET_NAME_PATTERN);
const sessionKey = z.string().min(1).max(200);

/** A model is always named by the runtime that serves it, the provider and the model id; a bare model id is not a reference. */
export const modelRefSchema = z.object({
  runtimeId,
  providerId: z.string().min(1).max(80),
  modelId: z.string().min(1).max(200),
}).strict();
export type ModelRef = z.infer<typeof modelRefSchema>;

export const PRODUCT_MODES = ["ask", "plan", "edit", "auto"] as const;
export type ProductMode = (typeof PRODUCT_MODES)[number];
/** The id of the no-prompt mode every runtime that has one publishes. */
export const UNATTENDED_MODE_ID = "unattended";
export const QUEUE_MODES = ["steer", "followup", "interrupt"] as const;
export type QueueMode = (typeof QUEUE_MODES)[number];

// ---- Runtime configuration document (`<dataDir>/config.json`, key `runtimes`) ----

const secretRef = z.object({ secret: secretName }).strict();
const envValue = z.union([z.string().max(4096), secretRef]);
const configuredModel = z.object({
  modelId: z.string().min(1).max(200).regex(/^\S+$/, "Model ID cannot contain spaces"),
  providerId: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(80).optional(),
  description: z.string().max(200).optional(),
  contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
  isDefault: z.boolean().optional(),
  source: z.enum(["additional", "custom"]).optional(),
}).strict();
export type ConfiguredModel = z.infer<typeof configuredModel>;

/**
 * Which sign-in a CLI runtime runs on: the CLI's own account (the default), an API key stored on the host for a
 * provider, or a custom endpoint. A key or endpoint reaches the CLI only through the environment and the per-session
 * configuration of the process the server starts; the CLI's own credential files are never written.
 */
export const runtimeSignInSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli") }).strict(),
  z.object({ kind: z.literal("key"), providerId: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/) }).strict(),
  z.object({ kind: z.literal("endpoint"), endpointId: runtimeId }).strict(),
]);
export type RuntimeSignIn = z.infer<typeof runtimeSignInSchema>;

export const runtimeEntrySchema = z.object({
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).max(9999).optional(),
  label: z.string().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
  command: z.array(z.string().min(1).max(1024)).min(1).max(RUNTIME_LIMITS.commandArguments).optional(),
  env: z.record(z.string().regex(ENV_NAME_PATTERN), envValue).refine((env) => Object.keys(env).length <= RUNTIME_LIMITS.envVariables).optional(),
  params: z.object({
    supportsMcpServers: z.boolean().optional(),
    clientCapabilities: z.object({ fsRead: z.boolean().optional(), fsWrite: z.boolean().optional(), terminal: z.boolean().optional() }).strict().optional(),
  }).strict().optional(),
  models: z.array(configuredModel).max(RUNTIME_LIMITS.configuredModels).optional(),
  additionalModels: z.array(configuredModel).max(RUNTIME_LIMITS.additionalModels).optional(),
  disallowedTools: z.array(z.string().min(1).max(120)).max(64).optional(),
  extends: z.string().min(1).max(40).optional(),
  signIn: runtimeSignInSchema.optional(),
}).strict();
export type RuntimeEntry = z.infer<typeof runtimeEntrySchema>;

export const runtimesConfigSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  probeTimeout_ms: z.number().int(),
  extraPath: z.array(z.string().startsWith("/").max(1024)).max(16),
  offerEditorToolsToAcp: z.boolean(),
  providerGroups: z.record(z.string(), z.string()),
  pinnedModelIds: z.record(z.string(), z.array(z.string()).max(RUNTIME_LIMITS.pinnedModels)),
  entries: z.record(runtimeId, runtimeEntrySchema),
}).strict();
export type RuntimesConfig = z.infer<typeof runtimesConfigSchema>;

export const runtimeConfigUpdateParams = z.object({
  patch: z.object({
    probeTimeout_ms: z.number().int().optional(),
    extraPath: runtimesConfigSchema.shape.extraPath.optional(),
    offerEditorToolsToAcp: z.boolean().optional(),
    providerGroups: runtimesConfigSchema.shape.providerGroups.optional(),
    pinnedModelIds: runtimesConfigSchema.shape.pinnedModelIds.optional(),
    entries: z.record(runtimeId, runtimeEntrySchema).optional(),
  }).strict(),
  removeRuntimeIds: z.array(runtimeId).max(64).optional(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

// ---- Snapshot ----

export type RuntimeStatus = "loading" | "ready" | "error" | "unavailable";
export type Readiness = "ready" | "loading" | "needs-install" | "needs-auth" | "cooldown" | "unsupported" | "disabled" | "error";
export type ModeSupport = { supported: boolean; reason?: string };

export type RuntimeCapabilities = {
  jcTools: "native" | "bridge" | "none";
  jcToolsOnly: boolean;
  nativeToolCoverage: boolean;
  steer: boolean;
  queueModes: QueueMode[];
  productModes: Record<ProductMode, ModeSupport>;
  liveModeChange: boolean;
  thinking: boolean;
  attachments: { image: boolean; document: boolean; audio: boolean; video: boolean };
  resume: boolean;
  fork: boolean;
  importSessions: boolean;
  usage: "tokens-and-cost" | "tokens" | "none";
  approvals: "host" | "relayed" | "runtime" | "none";
  questions: boolean;
  compaction: "host" | "runtime" | "none";
  subAgents: boolean;
  pty: boolean;
  skills: "token" | "native-dir" | "sentence";
  proxy: "acp" | "no";
};

export type RuntimeMode = {
  id: string;
  label: string;
  description: string;
  icon: string;
  colorTier: "safe" | "moderate" | "dangerous" | "planning";
  isUnattended: boolean;
  productMode?: ProductMode;
  supported: boolean;
  reason?: string;
};

export type RuntimeFeature =
  | { type: "toggle"; id: string; label: string; description?: string; value: boolean }
  | { type: "select"; id: string; label: string; description?: string; value: string | null; options: { id: string; label: string }[] };

export type ModelEntry = {
  providerId: string;
  modelId: string;
  label: string;
  description?: string;
  isDefault: boolean;
  contextWindow?: number;
  contextWindows?: string[];
  input: ("text" | "image" | "audio" | "video" | "document")[];
  supportsTools: boolean;
  thinkingOptions: { id: string; label: string }[];
  defaultThinkingOptionId?: string;
  supportsFastMode: boolean;
  readiness: Readiness;
  unavailableUntil_ms?: number;
  source: "discovered" | "configured" | "additional" | "custom";
};

export type RuntimeErrorInfo = { code: string; message: string; step?: string };
/** A runtime description that follows a pattern: which pattern, and the name of the agent it is about. */
export type RuntimeDescriptionCode = { code: "runtime/acp-native" | "runtime/acp-session"; name: string };
export type InstallHint = { docsUrl: string; steps: { platform: "macos" | "windows" | "linux" | "any"; command?: string; text: string }[] };

export type RuntimeSnapshotEntry = {
  runtimeId: string;
  kind: "cli";
  source: "builtin" | "catalogue" | "custom";
  status: RuntimeStatus;
  enabled: boolean;
  order: number;
  label: string;
  description: string;
  /** Present when the description follows a pattern: the app words it from this in the language of the screen (`description` stays the English text). */
  descriptionCode?: RuntimeDescriptionCode;
  /** How the server drives the runtime (`claude`, `codex`, `acp`). */
  gatewayTarget: string;
  binary?: { path: string; source: "override" | "default"; version: string | null };
  login?: { state: "signed_in" | "signed_out" | "unknown"; account?: string; checked_ms: number };
  defaultModeId: string;
  modes: RuntimeMode[];
  features: RuntimeFeature[];
  models: ModelEntry[];
  capabilities: RuntimeCapabilities;
  install: InstallHint;
  signInHint?: string;
  /** True when the runtime acts on the host only with its own permissions (the session must be unattended). */
  requiresFullAccess: boolean;
  fetched_ms?: number;
  stale?: boolean;
  error?: RuntimeErrorInfo;
  /** The sign-in the runtime runs on now (absent: the CLI's own account), with the name of the key or endpoint. */
  signIn?: RuntimeSignIn & { label: string };
  /** The stored keys and endpoints this CLI can run on, besides its own account. */
  signInOptions?: RuntimeSignInOption[];
};
export type RuntimeSignInOption = { kind: "key" | "endpoint"; id: string; label: string; usable: boolean; reason?: string };

export const snapshotGetParams = z.object({ cwd: z.string().min(1).max(1024).optional() }).strict();
export const snapshotRefreshParams = z.object({
  cwd: z.string().min(1).max(1024).optional(),
  runtimeIds: z.array(runtimeId).max(64).optional(),
  /** "Refresh all" from settings: clears every scope and re-probes `global`. */
  all: z.boolean().optional(),
  /** The login-only re-check the model browser asks for when the last check is older than ten minutes. */
  loginOnly: z.boolean().optional(),
}).strict();
export const diagnoseParams = z.object({ runtimeId }).strict();
export const catalogueListParams = z.object({ query: z.string().max(80).optional() }).strict();
export const modelsListParams = z.object({
  cwd: z.string().min(1).max(1024).optional(),
  sessionKey: sessionKey.optional(),
  agentId: z.string().min(1).max(64).optional(),
  query: z.string().max(120).optional(),
}).strict();
export const emptyParams = z.object({}).strict();
/** One page of an aggregator's own published catalogue (`agent-runtimes.Aggregator model catalogues`). */
export const modelsSearchParams = z.object({
  providerId: z.string().min(1).max(80),
  includeIds: z.array(z.string().min(1).max(200)).max(60).optional(),
  query: z.string().max(120).optional(),
  filters: z.object({
    input: z.array(z.enum(["image", "audio", "video"])).max(3).optional(), minContextWindow: z.number().int().positive().optional(),
    supportsTools: z.boolean().optional(), reasoning: z.boolean().optional(), maxInputPricePerMillionUsd: z.number().nonnegative().optional(),
    free: z.boolean().optional(), upstreamProvider: z.string().max(80).optional(),
  }).strict().optional(),
  sort: z.enum(["name", "context", "price", "recent"]).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export type AggregatorModel = ModelEntry & {
  ref: ModelRef; upstreamProvider?: string; free: boolean;
  pricing?: { inputPerMillionUsd: number; outputPerMillionUsd: number }; reasoning: boolean; created_ms?: number;
};

// ---- Provider access: keys, sign-in, profiles ----

export const AUTH_KINDS = ["api-key", "oauth", "device-code", "cli-login", "setup-token", "local", "custom-endpoint", "cloud-credentials"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];
export const PROFILE_HEALTH = ["ok", "rate_limited", "billing", "auth_failed", "expired", "cooldown", "unknown"] as const;
export type ProfileHealth = (typeof PROFILE_HEALTH)[number];
export const PROVIDER_GROUPS = ["first-party", "aggregators", "cloud", "local", "custom"] as const;
export type ProviderGroup = (typeof PROVIDER_GROUPS)[number];

/** The three ways a provider is reached: the vendor's CLI installed on the host, a sign-in with the provider under this product's own identity, or an API key. */
export const ACCESS_METHODS = ["cli", "oauth", "api-key"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];
export type AuthChoice = {
  choiceId: string; kind: AuthKind; label: string; hint?: string; available: boolean; unavailableReason?: string;
  /** Which of the three access methods this choice belongs to; absent on host-only choices (local, cloud credentials). */
  method?: AccessMethod;
  /** True when `jagentchill.provider.auth.login.start` runs this choice from the app (whatever its `kind`). */
  appDriven?: boolean;
  /** Who the provider sees signing in: the vendor's CLI ("Claude Code", "Codex CLI"), this product, or the agent engine. */
  identity?: string;
  /** CLI choices: whether the CLI on the host is signed in now, and as whom (masked). */
  signedIn?: boolean;
  account?: string;
  /** Present when the choice cannot start until the host owner did something once (register the app, install the CLI). */
  setup?: { reason: "needs-app-registration" | "needs-install"; steps: string[]; docsUrl?: string };
};
/** A sign-in the agent engine could perform under its own identity; the product does not offer it and names what to use instead. */
export type ReplacedChoice = { choiceId: string; label: string; replacedBy?: string; message: string };
export type AuthProfile = {
  profileId: string;
  label: string;
  type: Exclude<AuthKind, "local" | "custom-endpoint">;
  choiceId?: string;
  account?: string;
  keyHint?: string;
  health: ProfileHealth;
  lastProbe_ms?: number;
  cooldownUntil_ms?: number;
  order: number;
};
export type ProviderListing = {
  providerId: string;
  label: string;
  description: string;
  docsUrl: string;
  group: ProviderGroup;
  choices: AuthChoice[];
  connected: boolean;
  profiles: AuthProfile[];
  pluginAllowed: boolean;
  overrideActive: boolean;
  replacedChoices?: ReplacedChoice[];
  /** One line for the Sign-in area when the provider offers no sign-in to other apps. */
  signInNote?: string;
};

const providerId = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
export const authListParams = z.object({ query: z.string().max(80).optional() }).strict();
export const authTestParams = z.object({ providerId, profileId: z.string().min(1).max(120) }).strict();
/** Stores a key that was written to the host over the signed secret route; the call names the secret, never the value. */
export const authSetApiKeyParams = z.object({
  providerId,
  choiceId: z.string().min(1).max(80).optional(),
  secretName,
  profileLabel: z.string().trim().min(1).max(40).optional(),
  /** Keep the key although the provider could not be reached ("Save anyway"). */
  saveAnyway: z.boolean().optional(),
}).strict();
export const authLogoutParams = z.object({ providerId, profileIds: z.array(z.string().min(1).max(120)).min(1).max(RUNTIME_LIMITS.authProfilesPerProvider).optional() }).strict();

const loginId = z.string().regex(LOGIN_ID_PATTERN);
export const loginStartParams = z.object({
  providerId, choiceId: z.string().min(1).max(80), profileLabel: z.string().trim().min(1).max(40).optional(),
  /**
   * Whether the browser that opens the sign-in page runs on the host computer (a loopback callback reaches the server
   * only then). Default: true for a device connected over loopback. With false the flow uses the provider's
   * paste-back form where it has one.
   */
  browserOnHost: z.boolean().optional(),
  /** Claude Code: pre-fills the e-mail address on the sign-in page / forces the SSO flow. */
  email: z.string().email().max(200).optional(),
  sso: z.boolean().optional(),
}).strict();
export const loginNextParams = z.object({ loginId, answer: z.union([z.string().max(200), z.number(), z.boolean()]).optional() }).strict();
export const loginIdParams = z.object({ loginId }).strict();
export const loginTransferParams = z.object({ loginId, toDeviceId: z.string().min(1).max(64) }).strict();

/** What a login sheet shows next. Never carries a token or an authorisation code issued to the host. */
export type LoginStep =
  | {
    kind: "open-url"; url: string; instructions: string;
    /** How the sign-in comes back: a code the page shows and the user pastes (`login.next` then asks for it), the browser returning to the host by itself, or the vendor's CLI noticing. */
    returns?: "paste-code" | "callback" | "cli";
  }
  | { kind: "device-code"; userCode: string; verificationUrl: string; expires_ms: number; intervalSec: number; instructions: string }
  | { kind: "enter-text"; prompt: string; masked: boolean; secretName: string; /** Why the previous answer was not accepted. */ retryReason?: string }
  | { kind: "choose"; prompt: string; options: { id: string; label: string; hint?: string }[] }
  | { kind: "progress"; message: string }
  | { kind: "done"; profileId?: string; account?: string }
  | { kind: "error"; code: string; message: string };

// ---- Endpoints ----

export const ENDPOINT_DIALECTS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "ollama"] as const;
export type EndpointDialect = (typeof ENDPOINT_DIALECTS)[number];
export const ENDPOINT_CAPABILITIES = ["llm", "image", "video", "tts", "transcription", "music", "sfx", "voice-design", "lipsync", "stock-media", "translation"] as const;

const headerValue = z.union([z.string().max(2048), secretRef]);
export const endpointModelSchema = z.object({
  id: z.string().min(1).max(200).regex(/^\S+$/),
  alias: z.string().min(1).max(60).optional(),
  label: z.string().min(1).max(120),
  enabled: z.boolean(),
  contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(1).max(10_000_000).optional(),
  input: z.array(z.enum(["text", "image", "audio", "video"])).min(1).default(["text"]),
  supportsTools: z.boolean().default(true),
  supportsStrictTools: z.boolean().optional(),
  reasoning: z.boolean().default(false),
  reasoningEfforts: z.array(z.string().min(1).max(24)).max(9).optional(),
  maxTokensField: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
  usageInStreaming: z.boolean().default(true),
  extraBody: z.record(z.string(), z.unknown()).refine((body) => JSON.stringify(body).length <= 8192, "extraBody is larger than 8 KiB").optional(),
  equivalents: z.array(z.object({ endpointId: runtimeId, modelId: z.string().min(1).max(200) }).strict()).max(RUNTIME_LIMITS.equivalents).optional(),
  source: z.enum(["discovered", "manual"]),
  editedFields: z.array(z.string().max(40)).max(32).default([]),
  noLongerListed: z.boolean().optional(),
}).strict();
export type EndpointModel = z.infer<typeof endpointModelSchema>;

export const endpointDraftSchema = z.object({
  id: runtimeId,
  label: z.string().trim().min(1).max(40),
  presetId: z.string().min(1).max(60).optional(),
  presetVersion: z.number().int().positive().optional(),
  baseUrl: z.string().url().max(2048),
  dialect: z.enum(ENDPOINT_DIALECTS),
  auth: z.object({
    mode: z.enum(["none", "bearer", "header"]),
    secretName: secretName.optional(),
    headerName: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    prefix: z.string().max(32).optional(),
  }).strict(),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), headerValue).refine((h) => Object.keys(h).length <= RUNTIME_LIMITS.endpointHeaders).optional(),
  query: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), headerValue).refine((q) => Object.keys(q).length <= RUNTIME_LIMITS.endpointQuery).optional(),
  tls: z.object({
    caSecretName: secretName.optional(), serverName: z.string().max(253).optional(), allowSelfSigned: z.boolean(),
    clientCertSecretName: secretName.optional(), clientKeySecretName: secretName.optional(),
  }).strict().optional(),
  allowPrivateNetwork: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(5).max(3600).default(120),
  maxConcurrency: z.number().int().min(1).max(64).default(4),
  modelSource: z.enum(["discover", "manual", "discover-and-manual"]).default("discover-and-manual"),
  models: z.array(endpointModelSchema).max(RUNTIME_LIMITS.endpointModels).default([]),
  capabilities: z.array(z.enum(ENDPOINT_CAPABILITIES)).min(1).default(["llm"]),
  enabled: z.boolean().default(true),
  order: z.number().int().min(0).max(9999).default(0),
  notes: z.string().max(500).optional(),
}).strict();
export type EndpointDraft = z.infer<typeof endpointDraftSchema>;
export type EndpointTestStep = { id: string; status: "pass" | "fail" | "skipped"; latency_ms?: number; detail: string; code?: string };
export type EndpointRecord = EndpointDraft & {
  created_ms: number;
  updated_ms: number;
  lastTest?: { at_ms: number; steps: EndpointTestStep[] };
  lastDiscovery_ms?: number;
};

const endpointTarget = z.union([z.object({ endpointId: runtimeId }).strict(), z.object({ draft: endpointDraftSchema }).strict()]);
export const endpointIdParams = z.object({ endpointId: runtimeId }).strict();
export const endpointUpsertParams = z.object({ endpoint: endpointDraftSchema }).strict();
export const endpointDuplicateParams = z.object({ endpointId: runtimeId, newId: runtimeId.optional() }).strict();
export const endpointDiscoverParams = endpointTarget;
export const endpointTestParams = z.union([
  z.object({ endpointId: runtimeId, modelId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ draft: endpointDraftSchema, modelId: z.string().min(1).max(200).optional() }).strict(),
]);
export const endpointExportParams = z.object({ endpointIds: z.array(runtimeId).max(RUNTIME_LIMITS.endpoints).optional() }).strict();
export const endpointImportParams = z.object({
  document: z.object({ format: z.literal("jagentchill-endpoints"), version: z.literal(1), endpoints: z.array(endpointDraftSchema).max(RUNTIME_LIMITS.endpoints) }).strict(),
  onConflict: z.enum(["skip", "rename"]).default("skip"),
}).strict();

export const PRESET_KINDS = ["bundled-provider", "custom-endpoint", "media-endpoint", "stock-source"] as const;
export const endpointPresetSchema = z.object({
  presetId: z.string().regex(/^[a-z][a-z0-9-]{1,59}$/),
  version: z.number().int().positive(),
  label: z.string().min(1).max(60),
  description: z.string().max(300),
  kind: z.enum(PRESET_KINDS),
  bundledProviderId: z.string().optional(),
  baseUrlTemplate: z.string().max(2048),
  variables: z.array(z.object({ name: z.string(), label: z.string(), example: z.string(), required: z.boolean() }).strict()),
  dialect: z.enum(ENDPOINT_DIALECTS),
  auth: z.object({ mode: z.enum(["none", "bearer", "header"]), headerName: z.string().optional(), prefix: z.string().optional() }).strict(),
  headers: z.record(z.string(), z.string()).optional(),
  modelListPath: z.string().optional(),
  modelSource: z.enum(["discover", "manual", "discover-and-manual"]),
  capabilities: z.array(z.enum(ENDPOINT_CAPABILITIES)),
  allowPrivateNetwork: z.boolean().optional(),
  docsUrl: z.string(),
  notes: z.string(),
  verified: z.object({ by: z.enum(["vendor-docs", "user"]), ref: z.string() }).strict(),
}).strict();
export type EndpointPreset = z.infer<typeof endpointPresetSchema>;
export const presetListParams = z.object({ kind: z.enum(PRESET_KINDS).optional(), capability: z.enum(ENDPOINT_CAPABILITIES).optional() }).strict();
export const presetUpsertParams = z.object({ preset: endpointPresetSchema }).strict();
export const presetRemoveParams = z.object({ presetId: z.string().min(1).max(60) }).strict();

// ---- Session controls delegated to this capability ----

export const sessionControlSetParams = z.object({
  sessionKey,
  ref: modelRefSchema.nullable().optional(),
  thinkingOptionId: z.string().min(1).max(24).nullable().optional(),
  modeId: z.string().min(1).max(40).optional(),
  features: z.record(z.string().max(60), z.union([z.string().max(60), z.boolean(), z.null()])).optional(),
  expected: z.object({ lifecycleRevision: z.string().max(80).optional(), modeId: z.string().max(40).optional() }).strict().optional(),
}).strict();
export const sessionRuntimeSwitchParams = z.object({
  sessionKey,
  ref: modelRefSchema,
  idempotencyKey: z.string().min(1).max(128),
  acceptModeChange: z.string().min(1).max(40).optional(),
  /** An admin's explicit acknowledgement that the target runs with its own permissions on the host. */
  confirmFullAccess: z.boolean().optional(),
}).strict();
export const sessionQueueResolveParams = z.object({ sessionKey, requested: z.enum(QUEUE_MODES), expectedRunId: z.string().min(1).max(120).optional() }).strict();
export const sessionUnattendedSetParams = z.object({ sessionKey, enabled: z.boolean(), confirm: z.boolean().optional() }).strict();
export const sessionKeyParams = z.object({ sessionKey }).strict();

export type SessionSelection = { ref: ModelRef; modeId: string; thinkingOptionId: string | null; featureValues: Record<string, string | boolean | null> };
export type Notice = { code: string; message: string };

/** Every method this capability owns on the product channel, with the scope its handler requires. */
export const RUNTIME_METHOD_SCOPES: Record<string, Scope> = {
  "jagentchill.runtime.install.start": "jagentchill.config.write",
  "jagentchill.runtime.install.status": "jagentchill.config.read",
  "jagentchill.runtime.install.cancel": "jagentchill.config.write",
  "jagentchill.runtime.config.get": "jagentchill.config.read",
  "jagentchill.runtime.config.update": "jagentchill.config.write",
  "jagentchill.runtime.snapshot.get": "jagentchill.config.read",
  "jagentchill.runtime.snapshot.refresh": "jagentchill.agent.use",
  "jagentchill.runtime.diagnose": "jagentchill.config.write",
  "jagentchill.runtime.catalogue.list": "jagentchill.config.read",
  "jagentchill.runtime.models.list": "jagentchill.config.read",
  "jagentchill.runtime.models.search": "jagentchill.config.read",
  "jagentchill.runtime.matrix.get": "jagentchill.config.read",
  "jagentchill.runtime.subscribe": "jagentchill.config.read",
  "jagentchill.runtime.unsubscribe": "jagentchill.config.read",
  "jagentchill.provider.auth.list": "jagentchill.config.read",
  "jagentchill.provider.auth.setApiKey": "jagentchill.config.write",
  "jagentchill.provider.auth.test": "jagentchill.config.write",
  "jagentchill.provider.auth.order.set": "jagentchill.config.write",
  "jagentchill.provider.auth.logout": "jagentchill.config.write",
  "jagentchill.provider.auth.login.start": "jagentchill.config.write",
  "jagentchill.provider.auth.login.next": "jagentchill.config.write",
  "jagentchill.provider.auth.login.status": "jagentchill.config.write",
  "jagentchill.provider.auth.login.cancel": "jagentchill.config.write",
  "jagentchill.provider.auth.login.transfer": "jagentchill.config.write",
  "jagentchill.provider.endpoint.list": "jagentchill.config.read",
  "jagentchill.provider.endpoint.get": "jagentchill.config.read",
  "jagentchill.provider.endpoint.upsert": "jagentchill.config.write",
  "jagentchill.provider.endpoint.remove": "jagentchill.config.write",
  "jagentchill.provider.endpoint.duplicate": "jagentchill.config.write",
  "jagentchill.provider.endpoint.discover": "jagentchill.config.write",
  "jagentchill.provider.endpoint.test": "jagentchill.config.write",
  "jagentchill.provider.endpoint.export": "jagentchill.config.write",
  "jagentchill.provider.endpoint.import": "jagentchill.config.write",
  "jagentchill.provider.preset.list": "jagentchill.config.read",
  "jagentchill.provider.preset.upsert": "jagentchill.config.write",
  "jagentchill.provider.preset.remove": "jagentchill.config.write",
  "jagentchill.provider.override.get": "jagentchill.config.read",
  "jagentchill.provider.override.set": "jagentchill.config.write",
  "jagentchill.provider.override.remove": "jagentchill.config.write",
  "jagentchill.session.control.set": "jagentchill.agent.use",
  "jagentchill.session.runtime.switch": "jagentchill.agent.use",
  "jagentchill.session.queue.resolve": "jagentchill.agent.use",
  "jagentchill.session.unattended.set": "jagentchill.config.write",
  "jagentchill.session.handover.get": "jagentchill.agent.use",
};

export const runtimeInstallStartParams = z.object({ runtimeId: z.enum(["claude-code", "codex", "gemini-cli"]) }).strict();
export const runtimeInstallIdParams = z.object({ installId: z.string().uuid() }).strict();
export type RuntimeInstallSnapshot = {
  installId: string;
  runtimeId: string;
  state: "downloading" | "verifying" | "installed" | "failed" | "cancelled";
  progress: number | null;
  step: string;
  error?: string;
};
