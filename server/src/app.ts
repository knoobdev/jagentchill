import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CLOSE_CODES, DIRECT_CONNECTION_METHODS, LOCAL_IMAGE_PROVIDER_ID, stripInjectedUserText, ORC_BUILTIN_ROLES, PROTOCOL_VERSION, ROLES, TAILNET_METHODS, encodeOfferUrl, type AddressKind, type DirectConnectionStatus, type OfferAddress, type Role, type Scope, type TailnetStatus } from "@jagentchill/protocol";
import { NonceCache, RequestAuthenticator } from "./channel/request-auth.ts";
import { createAgentRelay } from "./agents/sessions.ts";
import { createTranscriptStore } from "./agents/transcript.ts";
import { runtimeClient } from "./agents/runtime/launcher.ts";
import { AGENT_INSTRUCTIONS } from "./tools/context.ts";
import { createSessionAttachments } from "./agents/attachments.ts";
import { createAgentTeamService } from "./agents/team/service.ts";
import { RateLimiter } from "./channel/rate-limit.ts";
import { DatabaseSync } from "node:sqlite";
import { createProductChannel, type Connection, type RpcMethod } from "./channel/ws-channel.ts";
import { createOrcService } from "./orc/service.ts";
import { anthropicCatalogueModelId, createAggregatorCatalogue } from "./providers/aggregator.ts";
import { OPENROUTER_CALLBACK_PATH, createProviderAuth } from "./providers/auth.ts";
import { createRuntimeAccess } from "./providers/runtime-access.ts";
import { spawnLoginProcess, type SpawnLogin } from "./providers/cli-login.ts";
import type { HttpFetch } from "./providers/http.ts";
import { createEndpointService } from "./providers/endpoints.ts";
import type { CommandResult, HostPlatform } from "./runtimes/probe.ts";
import { createRuntimeService, LOGIN_STALE_MS, type RuntimeClientFactory } from "./runtimes/service.ts";
import { SecretStore } from "./secrets/store.ts";
import { ServerConfigFile } from "./store/server-config.ts";
import { restoreLocalAdmin } from "./devices/bootstrap.ts";
import { DeviceRegistry } from "./devices/registry.ts";
import { ProtocolError } from "./errors.ts";
import { loadOrCreateHostIdentity } from "./identity/host-identity.ts";
import { ChallengeBook } from "./pairing/challenges.ts";
import { EnrolmentService, challengeBodySchema, type EnrolmentListener } from "./pairing/enrolment.ts";
import { audit, openDatabase } from "./store/database.ts";
import { createSyncService, type SyncDeps } from "./sync/service.ts";
import { createToolService, type ToolServiceDeps } from "./tools/service.ts";
import { createSkillService } from "./skills/service.ts";
import { createUsageService } from "./usage/service.ts";
import type { CliAccountReportOptions } from "./usage/cli-account-report.ts";
import { createContextWindowService } from "./agents/context-window.ts";
import { createWorkflowService } from "./workflows/service.ts";
import { createPromptVideo, type PromptVideo } from "./workflows/templates/prompt-video.ts";
import { createWorkflowRunPort, type WorkflowRunPort } from "./workflows/agent-runs.ts";
import { createFilmService, type FilmDeps, type FilmService } from "./film/service.ts";
import { createCaptionsService } from "./captions/service.ts";
import { createGenerationService, type GenerationDeps } from "./generation/service.ts";
import { createOpenRouterAdapter } from "./generation/openrouter.ts";
import { createLocalModels, type LocalModelsDeps } from "./local-models/service.ts";
import { createGenerationToolPort } from "./generation/tools.ts";
import { guessIntent, readIntent } from "./local-models/intent.ts";
import { isWholePrompt } from "./local-models/picture-request.ts";
import { createRuntimeBilling } from "./generation/billing.ts";
import { createMusicService } from "./music/service.ts";
import { createOpenverseProvider } from "./music/openverse.ts";
import type { MusicProvider } from "./music/provider.ts";
import type { RenderHostManager } from "./render-host/manager.ts";
import type { ImportNet } from "./tools/import.ts";
import { constantTimeEqual } from "./crypto.ts";
import type { TailnetListener } from "./tailnet/listener.ts";
import { directPasswordFromProtocols, hashDirectPassword, verifyDirectPassword } from "./tailnet/direct-auth.ts";
import { createRemoteExportService, remoteExportFeatures, type RemoteExportRenderer } from "./export/service.ts";
import { createRenderPreviewService } from "./render-host/preview.ts";

const MAX_JSON_BODY_BYTES = 65_536;
const MAX_SECRET_BODY_BYTES = 20_000;
/** Mutations of the admin proxy: 30 per device per minute. */
const MUTATIONS_PER_MINUTE = 30;
const PREFIX = "/jagentchill/v1";
type StoredDirectNetwork = { enabled: boolean; address: string; passwordHash?: string };

export type ServerAppOptions = {
  dataDir: string;
  renderHost?: RenderHostManager;
  now?: () => number;
  /** Extra HTTP handlers tried before the product routes (agent-tool endpoint, static web app). */
  extraRoutes?: (req: IncomingMessage, res: ServerResponse, path: string) => boolean;
  health?: () => Record<string, unknown>;
  /** How the client of an agent runtime is built: the real CLIs by default; fakes of the runtime layer in tests. */
  runtimeClients?: RuntimeClientFactory;
  /** The agent-tool endpoint: its address for one session (the session named in the URL) and its bearer. */
  agentTools?: { url: (sessionKey: string) => string; token: string };
  /** Browser origins other than the server's own that may use the product routes (the web app's dev server). */
  allowedOrigins?: string[];
  /** The host's operating system and environment as runtime detection sees them; replaced in tests. */
  hostPlatform?: HostPlatform;
  /** How runtime detection starts a command; replaced in tests, where no CLI can be started. */
  runCommand?: (file: string, args: string[], opts: { env: Record<string, string>; timeoutMs: number; signal?: AbortSignal }) => Promise<CommandResult>;
  /** How a vendor CLI's sign-in command is started; replaced in tests by a scripted process. */
  spawnLogin?: SpawnLogin;
  /** Outbound HTTP of the provider sign-ins and catalogues; replaced in tests by a simulated provider. */
  http?: HttpFetch;
  /** Test only: how long `login.next` holds a step the host is working on. */
  loginStepWaitMs?: number;
  /** The state of the host as the process that supervises it knows it. */
  hostStatus?: () => HostStatus;
  /** Makes the host safe to stop: ends every agent CLI and every other child. Called for the local supervisor device only. */
  prepareShutdown?: () => Promise<{ safe: boolean; running: string[] }>;
  /** "Restart agents": stops every turn and closes every agent CLI; the next turn starts them again. */
  restartService?: () => Promise<void>;
  /** Bearer of the local admin endpoint the host CLI uses on this machine; without it the endpoint does not exist. */
  localAdminToken?: string;
  /** Where the skills this product ships are; the repository's `skills/` folder unless a test says otherwise. */
  bundledSkillsDir?: string;
  /** Test only: which repository addresses a git skill source may name. */
  skillGitUrlAllowed?: (url: string) => boolean;
  /** The music catalogue of the editor's shelf: another address for the keyless default (a local test double in tests and e2e), or other providers; `net` is a test's network for the download of a track. */
  music?: { openverseBaseUrl?: string; providers?: MusicProvider[]; net?: ImportNet; warmAddresses?: boolean };
  /** Media generation: where the OpenRouter adapter sends its requests (a local test double in tests and e2e), and test timings. */
  generation?: { openRouterBaseUrl?: string; /** Test only (with a test double as the provider): the wait between two asks about a video task. */ videoPollMs?: number; timings?: GenerationDeps["timings"] };
  /** The models that run on the host: where they are kept, and — in tests and e2e only — another manifest (files of a local test server), hardware reading and network. */
  localModels?: Pick<LocalModelsDeps, "folder" | "manifest" | "probe" | "fetch" | "timings">;
  /** The list price of a model, where one is known; used to estimate the cost of turns billed per call. */
  modelPrice?: (ref: { runtimeId: string; providerId: string; modelId: string }) => { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number; cacheWritePerMillionUsd?: number; source: "aggregator" | "admin" } | undefined;
  /** Test injection for the CLI quota readers and HTTP fetch. Production uses read-only host CLI stores. */
  usageAccount?: CliAccountReportOptions;
  /**
   * The documented maximum output of a model (the longest answer its provider lets it give), where a caller states it
   * beside `modelPrice`. Default: a custom endpoint's own `maxOutputTokens` (what the host sends as `max_tokens`), else
   * the provider's published list. Without one a turn on the model has no price to show (ruling R10).
   */
  modelMaxOutput?: (ref: { runtimeId: string; providerId: string; modelId: string }) => number | undefined;
  /** Cross-device sync: the storage quota and, in tests, the schema maxima and the host-batch timings. */
  sync?: Pick<SyncDeps, "quotaBytes" | "freeDiskBytes" | "maxSchemaVersion" | "timings" | "media">;
  /** Electron render host adapter. Absent until the render host exposes remote export. */
  remoteExportRenderer?: RemoteExportRenderer;
  /** Optional host-owned embedded tsnet controller. The server does not persist its auth key. */
  tailnet?: TailnetListener;
  /** Port used by the server's direct listener and a host callback that rebinds the HTTP server. */
  directListenPort?: number;
  rebindDirectListener?: (address: string) => Promise<void>;
  /** Test only: the timings of the agent tools. */
  toolTimings?: ToolServiceDeps["timings"];
  /** Test only: timings of the sub-agent service (how long settled children are gathered, delivery retries, the writer queue). */
  agentTimings?: { notifyBatchMs?: number; retryMs?: number[]; writerQueueMs?: number; usageSettleMs?: number; reviewTimeoutMs?: number; handbackWaitMs?: number; handbackGraceMs?: number; remindAfterMs?: number };
};

export type GatewayState = "starting" | "ready" | "restarting" | "config_invalid" | "crash_loop" | "stopped";
export type HostStatus = {
  gateway: { state: GatewayState; pid?: number; restartCount: number; lastExit?: { code: number | null; signal: string | null; ts_ms: number } };
  serverVersion: string;
  started_ms: number;
  port: number;
  mediaTools?: { available: boolean; reason?: string };
};
/** The pid of a supervised child goes to the device that supervises this server and to no other. */
const hostView = (status: HostStatus, supervisor: boolean, tailnet: TailnetStatus = { connected: false, host: null, loginUrl: null, port: null, enabled: false, updatedAt: status.started_ms }, direct: DirectConnectionStatus = { enabled: false, address: "0.0.0.0", port: null, passwordEnabled: false }, settingsApplication?: { state: "applied" | "pending" | "failed"; reason?: string }) => ({
  ...status, protocolVersion: PROTOCOL_VERSION,
  ...(settingsApplication ? { settingsApplication } : {}),
  gateway: supervisor ? status.gateway : { ...status.gateway, pid: undefined },
  // The product listeners are another capability: until they exist the host is reachable on loopback only.
  network: { tailnet: { enabled: tailnet.enabled, available: tailnet.connected }, lan: { enabled: direct.enabled, available: direct.enabled } },
});

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ProtocolError("PAYLOAD_TOO_LARGE", "The request body is too large.", { httpStatus: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson<T>(schema: z.ZodType<T>, body: Buffer): T {
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ProtocolError("INVALID_PARAMS", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request body does not match the expected shape.");
  return parsed.data;
}

function params<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.");
  return parsed.data;
}

/** The JAgentChill Server: identity, devices, pairing, the product channel, and the agent runtimes it drives. */
export function createServerApp(opts: ServerAppOptions) {
  const now = opts.now ?? Date.now;
  const db = openDatabase(join(opts.dataDir, "jagentchill.sqlite"));
  const host = loadOrCreateHostIdentity(join(opts.dataDir, "secrets", "GATEWAY_IDENTITY_KEY"));
  const devices = new DeviceRegistry(db, now);
  const challenges = new ChallengeBook(now);
  const enrolment = new EnrolmentService({ host, devices, challenges, now });
  const auth = new RequestAuthenticator({ gatewayId: host.gatewayId, devices, nonces: new NonceCache(now), now });
  const methods = new Map<string, RpcMethod>();
  const manage = "jagentchill.devices.manage" as const;
  const tailnetSubscribers = new Set<Connection>();
  let directNetwork: StoredDirectNetwork = { enabled: false, address: "0.0.0.0" };
  const tailnetStatus = (): TailnetStatus => opts.tailnet?.status() ?? {
    connected: false, host: null, loginUrl: null, port: null, enabled: false, updatedAt: now(),
  };
  const requireTailnetAdmin = (connection: Connection): void => {
    if (connection.role() !== "admin") throw new ProtocolError("PERMISSION_DENIED", "Only an admin device can manage the host's Tailscale connection.", { httpStatus: 403 });
  };

  /** Addresses a new device can reach this server on; a tailnet URL is advertised only after tsnet is ready. */
  const offerAddresses = (): OfferAddress[] => {
    const address = http.address();
    const port = typeof address === "object" && address ? address.port : 0;
    // Tailscale is how other devices reach this host: once the host is on the tailnet an offer names that address
    // alone, as a loopback address means nothing to a phone. With Tailscale off only a program on this computer can pair.
    const tailnet = tailnetStatus();
    if (tailnet.connected && tailnet.host && tailnet.port) return [{ kind: "tailnet", url: `ws://${tailnet.host}:${tailnet.port}/jagentchill/v1/ws` }];
    return [{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }];
  };

  /** A browser request carries an Origin; it must be the server's own origin or one the operator allowed. */
  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      if (new URL(origin).host === req.headers.host) return true;
    } catch {
      return false;
    }
    return opts.allowedOrigins?.includes(origin) ?? false;
  };

  /** A non-loopback peer is admitted only while the admin has enabled the direct listener. */
  const transportOf = (req: IncomingMessage, forced?: AddressKind): AddressKind | null => {
    if (!originAllowed(req)) return null;
    if (forced) return forced;
    const address = req.socket.remoteAddress ?? "";
    if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return "loopback";
    return directNetwork.enabled ? "lan" : null;
  };

  const broadcast = (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => channel.sendToScope(scope, event, stream, payload, filter);
  /** Changes of host settings go to the connections that opened the settings streams. */
  const announce = (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) =>
    broadcast(scope, event, stream, payload, (connection) => runtimes.isSubscribed(connection) && (!filter || filter(connection)));
  const config = new ServerConfigFile(join(opts.dataDir, "config.json"));
  const storedDirectNetwork = z.object({ enabled: z.boolean(), address: z.string().refine((value) => isIP(value) !== 0), passwordHash: z.string().optional() }).strict().safeParse(config.get("directNetwork"));
  if (storedDirectNetwork.success) directNetwork = storedDirectNetwork.data;
  const directNetworkStatus = (): DirectConnectionStatus => ({ enabled: directNetwork.enabled, address: directNetwork.address, port: directNetwork.enabled ? opts.directListenPort ?? null : null, passwordEnabled: Boolean(directNetwork.passwordHash) });
  const secrets = new SecretStore(join(opts.dataDir, "secrets", "host-secrets.json"), now);
  const mutations = new RateLimiter(MUTATIONS_PER_MINUTE, 60_000, now);
  const outbound: HttpFetch = opts.http ?? ((url, init) => fetch(url, init));
  const aggregators = createAggregatorCatalogue({ http: outbound, now });
  const runtimes = createRuntimeService({
    db, config, secrets, now, broadcast, clients: opts.runtimeClients ?? runtimeClient,
    onConfigChanged: () => undefined,
    providerLabel: (providerId) => endpoints.label(providerId) ?? providerAuth.label(providerId),
    selectionOf: (sessionKey, connection) => relay.selectionFor(sessionKey, connection),
    referencesTo: (runtimeId) => orc.referencesToRuntime(runtimeId),
    dataDir: opts.dataDir, ...(opts.hostPlatform ? { host: opts.hostPlatform } : {}), ...(opts.runCommand ? { run: opts.runCommand } : {}),
    access: { options: (runtime) => runtimeAccess.options(runtime), resolve: (runtime, signIn) => runtimeAccess.resolve(runtime, signIn) },
  });
  /** A provider, an endpoint or a sign-in changed: the CLIs show what they can run on now. No model becomes a default by this. */
  const providersChanged = async () => { runtimes.accessChanged(); };
  const endpoints = createEndpointService({
    db, config, secrets, now, mutations, broadcast: announce,
    onChanged: providersChanged, referencesTo: (endpointId) => orc.referencesToProvider(endpointId),
  });
  const providerAuth = createProviderAuth({
    db, secrets, devices, now, mutations, broadcast, announce,
    isOnline: (deviceId) => channel.isOnline(deviceId),
    endpoints: () => endpoints.records().map((record) => ({ id: record.id, label: record.label, enabled: record.enabled, projected: record.enabled && record.models.some((model) => model.enabled) })),
    onChanged: providersChanged,
    cli: {
      command: (runtimeId, overlay) => runtimes.cliCommand(runtimeId, overlay),
      loginState: (runtimeId) => runtimes.cliLoginState(runtimeId),
      lastLogin: (runtimeId) => runtimes.snapshot().find((entry) => entry.runtimeId === runtimeId)?.login,
      installSteps: (runtimeId) => {
        const install = runtimes.runtime(runtimeId)?.install;
        return { steps: (install?.steps ?? []).map((step) => (step.command ? `${step.text} (${step.command})` : step.text)), ...(install?.docsUrl ? { docsUrl: install.docsUrl } : {}) };
      },
      run: (runtimeId, args) => runtimes.cliRun(runtimeId, args),
      noopCommand: () => runtimes.noopCommand(),
      reprobe: (runtimeId) => runtimes.reprobe(runtimeId),
    },
    spawnLogin: opts.spawnLogin ?? spawnLoginProcess, http: outbound, config,
    callbackOrigin: () => {
      const address = http.address();
      return typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : undefined;
    },
    ...(opts.loginStepWaitMs !== undefined ? { stepWaitMs: opts.loginStepWaitMs } : {}),
  });
  /** Which sign-in each CLI runs on (its own account, a stored key, an endpoint) and what a session on it is started with. */
  const runtimeAccess = createRuntimeAccess({
    keys: () => providerAuth.storedKeys(), endpoints: () => endpoints.records(), secrets,
    geminiSettingsFile: join(opts.dataDir, "runtime-access", "gemini-system-settings.json"),
  });
  const orc = createOrcService({
    db, now, mutations, broadcast: announce,
    snapshot: () => runtimes.snapshot(), project: async () => true, canActInSession: (sessionKey, connection) => relay.canAct(sessionKey, connection),
    generation: () => generation.catalogue,
  });

  let readUsagePlan: (runtimeId: string, providerId: string) => Promise<{ status: string; planLabel?: string; windows: Array<{ label: string; usedPct?: number; resetsAt_ms?: number }> } | undefined> = async () => undefined;
  let answerPendingQuestion: ((sessionKey: string, text: string) => boolean) | undefined;
  let directImage: ((sessionKey: string, prompt: string, options?: { change?: boolean; quiet?: boolean }) => Promise<{ title: string; rows: Array<{ label: string; value: string }>; jobId?: string }>) | undefined;
  const transcript = createTranscriptStore(db);
  const relay = createAgentRelay({
    db, devices, now, transcript, broadcast, runtimes, orc, isOnline: (deviceId) => channel.isOnline(deviceId),
    client: (runtimeId) => { const runtime = runtimes.runtime(runtimeId); return runtime ? (opts.runtimeClients ?? runtimeClient)(runtime, runtimes.cliCommand(runtimeId)) : undefined; },
    runtimeEnv: (runtimeId) => runtimes.cliCommand(runtimeId)?.env,
    runtimeAccess: (runtimeId, modelId) => {
      const runtime = runtimes.runtime(runtimeId);
      const signIn = runtime?.entry?.signIn;
      if (!runtime || !signIn || signIn.kind === "cli") return undefined;
      const plan = runtimeAccess.plan(runtime, modelId);
      // A CLI set to run on a key or endpoint never falls back to its own account (that would bill another account).
      if (!plan) throw new ProtocolError("runtime/no-provider", `${runtime.label} is set to run on a key or endpoint that is not available. Choose another sign-in under Providers.`, { details: { runtimeId } });
      const base = runtimes.cliCommand(runtimeId)?.env ?? {};
      return { env: runtimeAccess.apply(base, plan), ...(plan.config ? { config: plan.config } : {}), signature: plan.signature };
    },
    ...(opts.agentTools ? { mcp: (sessionKey: string) => ({ url: opts.agentTools!.url(sessionKey), token: opts.agentTools!.token }) } : {}),
    // An agent works in its project's workspace; a session without a project has a folder of its own.
    workdir: (session) => (session.projectId ? join(opts.dataDir, "workspaces", session.projectId) : join(opts.dataDir, "agent-sessions", session.sessionKey.replace(/[^A-Za-z0-9_-]/g, "_"))),
    instructions: AGENT_INSTRUCTIONS,
    projectWorkspace: (projectId) => join(opts.dataDir, "workspaces", projectId),
    onAuthFailure: (runtimeId) => providerAuth.noteAuthFailure(runtimes.runtime(runtimeId)?.vendorProviderId ?? runtimeId),
    redact: (text) => secrets.redact(text),
    skillAttached: (sessionKey, name) => skills.attachedTo(sessionKey).some((skillId) => skillId.split(":").pop() === name),
    skillFiles: (sessionKey) => skills.skillFiles(sessionKey),
    beforeTurn: (sessionKey) => { usage.assertBudget(sessionKey); team.assertBudget(sessionKey); contextWindow.assertTokens(sessionKey); },
    answeringSession: (sessionKey) => team.answeringSession(sessionKey),
    answerPendingQuestion: (sessionKey, text) => answerPendingQuestion?.(sessionKey, text) ?? false,
    directImage: (sessionKey, prompt, options) => directImage!(sessionKey, prompt, options),
    pictureIntent: async (sessionKey, message) => {
      const last = db.prepare("SELECT json_extract(json, '$.params.prompt') AS prompt FROM gen_jobs WHERE json_extract(json, '$.sessionId') = ? AND json_extract(json, '$.provider') = ? AND state = 'succeeded' ORDER BY created_ms DESC LIMIT 1").get(sessionKey, LOCAL_IMAGE_PROVIDER_ID) as { prompt?: string } | undefined;
      const text = localModels.textModel();
      const read = text ? await readIntent({ ...text, message, ...(last?.prompt ? { lastPicture: last.prompt } : {}) }) : undefined;
      // A change needs a picture before it; a whole new description (quoted, or long) is a new picture.
      return read === "change" && (!last?.prompt || isWholePrompt(message)) ? "picture" : read ?? guessIntent(message, !!last?.prompt);
    },
    hasLocalPicture: (sessionKey) => !!db.prepare("SELECT 1 FROM gen_jobs WHERE json_extract(json, '$.sessionId') = ? AND json_extract(json, '$.provider') = ? AND state = 'succeeded' LIMIT 1").get(sessionKey, LOCAL_IMAGE_PROVIDER_ID),
    onStopped: (sessionKey) => { for (const job of generation.liveJobs()) if (job.sessionId === sessionKey) generation.cancel(job.jobId); },
    onTurnStarted: (sessionKey, runId, deviceId) => { usage.turnStarted(sessionKey, runId, deviceId); tools.turnStarted(sessionKey); team.turnStarted(sessionKey); },
    // Agent tools: what a turn staged is put to the person when it ends; a pending proposal pins the session's project.
    onTurnEnded: (sessionKey, state) => { contextWindow.turnOver(sessionKey); void contextWindow.turnEnded(sessionKey); tools.turnEnded(sessionKey); void team.turnEnded(sessionKey, state); void generation.messageCards.settle(sessionKey, { ended: true, state }).catch(() => undefined); },
    onRuntimeEvent: (sessionKey, runId, event) => { usage.runtimeEvent(sessionKey, runId, event); contextWindow.runtimeEvent(sessionKey, event); },
    beforeProjectChange: (sessionKey) => tools.assertRebindable(sessionKey),
    onSessionDeleted: (sessionKey) => { contextWindow.sessionDeleted(sessionKey); team.sessionDeleted(sessionKey); return tools.sessionDeleted(sessionKey); },
    onSessionForked: (sourceKey, forkKey) => team.sessionForked(sourceKey, forkKey),
    turnContext: (session) => tools.turnContext(session),
    onRuntimeQuestion: (session, question) => tools.runtimeQuestion(session, question),
    onRuntimeQuestionClosed: (questionId) => tools.runtimeQuestionClosed(questionId),
    contextState: (sessionKey) => contextWindow.stateOf(sessionKey),
    planState: (runtimeId, providerId) => readUsagePlan(runtimeId, providerId),
    compactSession: async (sessionKey, connection) => await contextWindow.methods.get("jagentchill.session.compact")!.handle({ sessionKey }, connection) as { compacted: boolean },
  });
  const skills = createSkillService({
    dataDir: opts.dataDir, db, config, now, broadcast, runtimes: () => runtimes.runtimes(),
    sessionRuntime: (sessionKey, connection) => (relay.canAct(sessionKey, connection) ? relay.selectionFor(sessionKey, connection)?.ref.runtimeId : undefined),
    deviceName: (deviceId) => devices.get(deviceId)?.name, bundledDir: opts.bundledSkillsDir ?? resolve(import.meta.dirname, "../../skills"),
    ...(opts.skillGitUrlAllowed ? { gitUrlAllowed: opts.skillGitUrlAllowed } : {}),
  });
  const usage = createUsageService({
    dataDir: opts.dataDir, db, config, now, broadcast, canRead: (sessionKey, connection) => relay.canRead(sessionKey, connection), billedByCall: (runtimeId) => billedByCall(runtimeId),
    runtimeOf: (runtimeId) => { const runtime = runtimes.runtime(runtimeId); return runtime && { label: runtime.label, kind: runtime.kind, usage: runtime.capabilities.usage }; },
    providerLabel: (providerId) => endpoints.label(providerId) ?? providerAuth.label(providerId), endpointOf: (providerId) => (endpoints.label(providerId) ? providerId : undefined),
    // What a turn cost is known for models with a published list price; without one the turn counts tokens only.
    priceOf: (ref) => opts.modelPrice?.(ref) ?? (ref.runtimeId === "codex" && ref.providerId === "openai"
      ? aggregators.priceOf("openrouter", `openai/${ref.modelId}`)
      : ref.providerId === "anthropic"
        ? aggregators.priceOf("openrouter", `anthropic/${anthropicCatalogueModelId(ref.modelId)}`)
        : aggregators.priceOf(ref.providerId, ref.modelId)),
    resolvePriceOf: async (ref) => {
      const injected = opts.modelPrice?.(ref);
      if (injected) return injected;
      if (ref.runtimeId === "codex" && ref.providerId === "openai") {
        const entry = await aggregators.find("openrouter", `openai/${ref.modelId}`);
        return entry?.pricing ? { ...entry.pricing, source: "aggregator" } : undefined;
      }
      if (ref.providerId === "anthropic") {
        const entry = await aggregators.find("openrouter", `anthropic/${anthropicCatalogueModelId(ref.modelId)}`);
        return entry?.pricing ? { ...entry.pricing, source: "aggregator" } : undefined;
      }
      return aggregators.priceOf(ref.providerId, ref.modelId);
    },
    contextWindowOf: (ref) => runtimes.snapshot().find((entry) => entry.runtimeId === ref.runtimeId)?.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId)?.contextWindow,
    deviceName: (deviceId) => devices.get(deviceId)?.name, hostName: () => "JAgentChill", ...(opts.usageAccount ? { accountReportOptions: opts.usageAccount } : {}),
  });
  readUsagePlan = async (runtimeId, providerId) => {
    const method = usage.methods.get("jagentchill.usage.plan.list");
    if (!method) return undefined;
    const result = await method.handle({ runtimeId, providerIds: [providerId] }, { deviceId: "", role: () => "admin", scopes: () => ["jagentchill.projects.read"] } as unknown as Connection) as { providers?: Array<{ status: string; planLabel?: string; windows?: Array<{ label: string; usedPct?: number; resetsAt_ms?: number }> }> };
    const provider = result.providers?.[0];
    return provider ? { status: provider.status, ...(provider.planLabel ? { planLabel: provider.planLabel } : {}), windows: provider.windows ?? [] } : undefined;
  };
  // The context meter, compaction at a threshold and on request; the numbers are the usage records' own.
  const contextWindow = createContextWindowService({
    db, config, now, compact: (key) => relay.compact(key), session: (key) => relay.session(key), canRead: (key, connection) => relay.canRead(key, connection), canAct: (key, connection) => relay.canAct(key, connection),
    isRunning: (key) => relay.isRunning(key), notify: (key, event, payload) => relay.notify(key, event, payload),
    compactionOf: (runtimeId) => runtimes.runtime(runtimeId)?.capabilities.compaction ?? "none",
    onCompacted: (key) => tools.contextForgotten(key),
    onSettings: (settings) => tools.setCompactContext(settings.shortTurnContext),
    contextWindowOf: (ref) => runtimes.snapshot().find((entry) => entry.runtimeId === ref.runtimeId)?.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId)?.contextWindow,
  });
  for (const [name, method] of contextWindow.methods) methods.set(name, method);
  // Sync never touches the agent runtimes: documents, leases and blobs are the server's own.
  const sync = createSyncService({ db, dataDir: opts.dataDir, now, devices, auth, agentName: (sessionKey) => team.agentName(sessionKey), ...opts.sync });
  createSessionAttachments({ db, blobs: sync.blobs, dataDir: opts.dataDir, now, access: { canRead: (key, connection) => relay.canRead(key, connection), canAct: (key, connection) => relay.canAct(key, connection) }, projectMedia: (key) => {
    const projectId = relay.session(key)?.projectId;
    if (!projectId) return [];
    const row = sync.documents.row({ kind: "project", id: projectId });
    if (!row) return [];
    const document = sync.documents.head(row) as { media?: { assets?: Array<{ name?: string; contentHash?: string | null }> } };
    return (document.media?.assets ?? []).flatMap((asset) => {
      if (!asset.contentHash) return [];
      const blob = db.prepare("SELECT mime, size, state FROM blobs WHERE sha256 = ? AND purpose = 'media'").get(asset.contentHash) as { mime: string; size: number; state: string } | undefined;
      return blob?.state === "complete" ? [{ blobId: asset.contentHash, name: asset.name ?? "Project media", mime: blob.mime, size: blob.size }] : [];
    });
  }, supportsImage: (key) => {
    const ref = relay.session(key)?.ref;
    if (!ref) return false;
    const runtime = runtimes.snapshot().find((entry) => entry.runtimeId === ref.runtimeId);
    return Boolean(runtime?.capabilities.attachments.image && runtime.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId)?.input.includes("image"));
  } }).install(relay.methods);
  // The agent tools run on the host replica of sync and reach devices through its operation log.
  // Sub-agents and teams: the tree of a session, who may call and write, and what a caller gets back.
  const team = createAgentTeamService({
    db, now, config, sessions: () => relay, broadcast, turnContext: (session) => tools.turnContext(session), rootBudget: (sessionKey) => usage.assertBudget(sessionKey),
    proposals: { view: (proposalId) => tools.proposal(proposalId), resolve: (proposalId, action, by, options) => tools.resolve(proposalId, action, by, options) },
    roleTimeoutSeconds: (roleId) => orc.load().config.roles[roleId]?.limits?.timeoutSeconds,
    taint: { is: (sessionKey) => tools.requests.isTainted(sessionKey), mark: (sessionKey, source, texts) => tools.requests.taint(sessionKey, source, texts), retained: (sessionKey) => tools.requests.untrustedOf(sessionKey) },
    ...(opts.agentTimings ? { timings: opts.agentTimings } : {}),
  });
  for (const [name, method] of team.methods) methods.set(name, method);
  // Declared before the tool service because its `jc_film_*` tools reach the film service lazily.
  let film: FilmService | undefined;
  const tools = createToolService({ db, now, sync, devices, sessions: () => relay, broadcast, dataDir: opts.dataDir, renderHost: opts.renderHost, agents: () => team, callsPerTurn: () => contextWindow.settings().turnToolCalls, generation: () => generationTools, workflows: () => workflows.docs, workflowRuns: () => workflowRuns, films: () => film, ...(opts.toolTimings ? { timings: opts.toolTimings } : {}) });
  answerPendingQuestion = tools.answerPendingQuestion;
  const RATIOS: Array<[string, number]> = [["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:3", 4 / 3], ["3:4", 3 / 4], ["3:2", 3 / 2], ["2:3", 2 / 3]];
  directImage = async (sessionKey, written, options = {}) => {
    // "/image 9:16 …" names the shape; without it the picture takes the shape of the project's canvas.
    const named = /^(1:1|16:9|9:16|4:3|3:4|3:2|2:3)\s+([\s\S]+)$/.exec(written);
    let prompt = named ? named[2]!.trim() : written;
    // A change of the session's last picture ("sexier", "other clothes"): its words, then the new ones, on its seed.
    let seed: number | undefined;
    if (options.change) {
      const last = db.prepare("SELECT json_extract(json, '$.params.prompt') AS prompt, json_extract(json, '$.results[0].provenance.seed') AS seed FROM gen_jobs WHERE json_extract(json, '$.sessionId') = ? AND json_extract(json, '$.provider') = ? AND state = 'succeeded' ORDER BY created_ms DESC LIMIT 1").get(sessionKey, LOCAL_IMAGE_PROVIDER_ID) as { prompt?: string; seed?: number } | undefined;
      if (last?.prompt) { prompt = `${last.prompt}\n${prompt}`; if (typeof last.seed === "number") seed = last.seed; }
    }
    let aspectRatio = named?.[1];
    const projectId = relay.session(sessionKey)?.projectId;
    const row = projectId ? sync.documents.row({ kind: "project", id: projectId }) : undefined;
    if (!aspectRatio && row) {
      const canvas = (sync.documents.head(row) as { settings?: { canvasSize?: { width: number; height: number } } }).settings?.canvasSize;
      if (canvas?.width && canvas.height) aspectRatio = RATIOS.reduce((best, entry) => (Math.abs(Math.log(entry[1] / (canvas.width / canvas.height))) < Math.abs(Math.log(best[1] / (canvas.width / canvas.height))) ? entry : best))[0];
    }
    const { envelope } = await tools.call(sessionKey, "jc_generate_image", { prompt, provider: LOCAL_IMAGE_PROVIDER_ID, quiet: options.quiet !== false, ...(aspectRatio ? { aspectRatio } : {}), ...(seed !== undefined ? { seed } : {}) });
    const data = envelope.data as { jobId?: string } | undefined;
    if (!envelope.ok || !data?.jobId) return { title: "JAgentChill", rows: [{ label: "Picture", value: envelope.error?.message ?? "The picture could not be started." }] };
    return { title: "JAgentChill", rows: [{ label: "Picture", value: `Your words go to Qwen-Image-2.1 on this computer as written${aspectRatio ? ` (${aspectRatio})` : ""}.` }], jobId: data.jobId };
  };
  tools.setCompactContext(contextWindow.settings().shortTurnContext);
  for (const service of [relay, runtimes, endpoints, providerAuth, orc, sync, skills, usage, tools]) for (const [name, method] of service.methods) methods.set(name, method);
  // Workflows and automations: documents, runs and the one scheduler; an agent step is a session of the relay.
  let promptVideo: PromptVideo | undefined;
  let workflowRuns: WorkflowRunPort | undefined;
  const workflows = createWorkflowService({ db, now, devices, broadcast, agentsReady: () => true, sessions: () => relay, stepTools: () => (film ? new Map([...(promptVideo?.tools ?? []), ...film.tools]) : promptVideo?.tools), pendingSessions: () => tools.requests.pendingPermissionSessions(), closePendingQuestions: (sessionKey) => tools.requests.closePendingQuestions(sessionKey), taint: (sessionKey, source, texts) => tools.requests.taint(sessionKey, source, texts) });
  for (const [name, method] of workflows.methods) methods.set(name, method);
  // The models that run on the host (Qwen-Image-2.1): downloaded on demand, checked against the hardware first; a generation provider of their own.
  const localModels = createLocalModels({ db, config, dataDir: opts.dataDir, now, broadcast, ...opts.localModels });
  for (const [name, method] of localModels.methods) methods.set(name, method);
  // Media generation: providers, the model catalogue, provider jobs, budgets and the result cache. Its calls never go through an agent runtime.
  const generation = createGenerationService({
    db, config, secrets, now, dataDir: opts.dataDir, blobs: sync.blobs, probe: (path) => sync.mediaJobs.probe(path), broadcast,
    adapters: [createOpenRouterAdapter(opts.generation?.openRouterBaseUrl ? { baseUrl: opts.generation.openRouterBaseUrl, ...(opts.generation.videoPollMs ? { videoPollMs: opts.generation.videoPollMs } : {}) } : {}), localModels.adapter],
    // Model routing for a generation role: in force as soon as the role has a profile. Its resolved profiles go to the
    // service WITH their options; a role that is off, or none of whose profiles can serve, is said — not replaced.
    orcRoute: (capability) => {
      const role = ORC_BUILTIN_ROLES.find((entry) => entry.capability === capability) ?? (capability === "translation" ? ORC_BUILTIN_ROLES.find((entry) => entry.id === "translation") : undefined), loaded = orc.load().config, own = role ? loaded.roles[role.id] : undefined;
      if (!role || !loaded.enabled || !own?.profiles.length) return { configured: false, targets: [] };
      const resolution = orc.resolve(role.id);
      return { configured: true, targets: resolution.candidates.map((target) => ({ provider: target.ref.providerId, model: target.ref.modelId, params: target.params })), ...(!own.enabled ? { reason: `The ${role.label} role is turned off` } : !resolution.candidates.length ? { reason: resolution.skipped[0]?.reason ?? `No profile of the ${role.label} role can serve` } : {}) };
    }, ...(opts.generation?.timings ? { timings: opts.generation.timings } : {}),
  });
  for (const [name, method] of generation.methods) methods.set(name, method);
  localModels.bindGeneration(() => generation.providerChanged(localModels.adapter.describe().id));
  // A project the host comes to hold is an event automations can wait for (`project.created`): seen at the one door
  // every project enters the document store by, whoever brings it (a device, an agent, a run).
  const enableDocument = sync.documents.enable.bind(sync.documents);
  sync.documents.enable = (doc, sha256, schemaVersion, author) => {
    const result = enableDocument(doc, sha256, schemaVersion, author);
    if (!result.attached && doc.kind === "project") {
      const principal = author.kind === "host" ? author.principal : "", runId = principal.startsWith("run:") ? principal.slice(4) : undefined;
      queueMicrotask(() => {
        try {
          let source = {};
          if (runId) { try { source = workflows.automations.sourceOfRun(workflows.runs.record(runId)); } catch { /* not a run of a workflow */ } }
          workflows.automations.event("project.created", { projectId: doc.id, name: sync.documents.row(doc)?.name ?? "", origin: author.kind === "device" ? "user" : runId ? "workflow" : principal.startsWith("agent:") ? "agent" : "user" }, source);
        } catch (error) { console.error(`[automations] project.created failed: ${error instanceof Error ? error.message : error}`); }
      });
    }
    return result;
  };
  const generationTools = createGenerationToolPort(() => generation, {
    userWords(sessionKey, change) {
      // The person's latest message (the editor's context block and the host's status messages are not theirs).
      const said = transcript.recent(sessionKey, 60).filter((message) => message.role === "user").map((message) => stripInjectedUserText(message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")).trim())
        .filter((text) => text && !text.startsWith("[JAgentChill]"));
      const latest = said.at(-1);
      if (!latest) return undefined;
      if (!change) return latest;
      // A change of a picture made before: the words of the session's last picture made here, then what is changed.
      const last = db.prepare("SELECT json_extract(json, '$.params.prompt') AS prompt FROM gen_jobs WHERE json_extract(json, '$.sessionId') = ? AND json_extract(json, '$.provider') = ? AND state = 'succeeded' ORDER BY created_ms DESC LIMIT 1").get(sessionKey, LOCAL_IMAGE_PROVIDER_ID) as { prompt?: string } | undefined;
      return last?.prompt && last.prompt !== latest ? `${last.prompt}\n${latest}` : latest;
    },
  });
  // "One prompt → video": a template on the workflow engine; its step tools write through sessions, generate through the service above and store the project in sync.
  // A writing role of Model routing as the film uses it: the resolved profile whole (model, thinking, mode), not its model alone.
  const roleModel: FilmDeps["roleModel"] = (roleId) => {
      const loaded = orc.load().config, own = loaded.roles[roleId];
      if (!loaded.enabled || !own?.profiles.length) return undefined;
      const resolution = orc.resolve(roleId), target = resolution.candidates[0];
      if (!target) throw new ProtocolError("NO_ROUTE", `Model routing gives the ${roleId} role no usable model: ${!own.enabled ? "the role is turned off" : resolution.skipped[0]?.reason ?? "no profile can serve"}. Change the role under Settings, Model routing.`, { details: { role: roleId, reason: "orc_route_unusable", skipped: resolution.skipped } });
      // The profile WHOLE: what it leaves out is said too (thinking back to the model's own, the runtime's default mode), so a session another role used last does not keep that role's settings.
      const runtime = runtimes.snapshot().find((entry) => entry.runtimeId === target.ref.runtimeId);
      return { ...target.ref, thinking: target.thinking ?? null, ...(target.mode ?? runtime?.defaultModeId ? { mode: target.mode ?? runtime!.defaultModeId } : {}), params: target.params, profileId: target.profileId };
  };
  // Its pictures and voice are made by the film engine on working films kept in a store of their own (they are not films of the Film Studio).
  const videoFilms = new DatabaseSync(join(opts.dataDir, "prompt-video-films.sqlite"));
  promptVideo = createPromptVideo({
    now, workflows: () => workflows, generation: () => generation, sync, filmDb: videoFilms, roleModel,
    // A run's translation is the run's cost (its ledger rows, its budget, the amount confirmed for it), not the device's.
    translate: (input, deviceId, runId, payer) => captions.translate(input, { deviceId } as Connection, { sessionId: `run:${runId}`, payer }),
    // What a turn on a model costs (ruling R10): billed by the call or by the runtime's own sign-in, its price, the limit of its answer
    // (the `max_tokens` the host sends for a custom endpoint's model, else the model's documented maximum output), and what a first request to it was MEASURED to carry on this host.
    turnModel: (ref) => { const runtime = runtimes.runtime(ref.runtimeId); if (!runtime) return undefined; const price = opts.modelPrice?.(ref) ?? aggregators.priceOf(ref.providerId, ref.modelId), own = endpoints.records().find((record) => record.id === ref.providerId)?.models.find((model) => model.id === ref.modelId), longest = own?.maxOutputTokens ?? opts.modelMaxOutput?.(ref) ?? aggregators.maxOutputOf(ref.providerId, ref.modelId); return { billedByCall: billedByCall(ref.runtimeId) ?? true, account: runtime.label, ...(price ? { price } : {}), ...(longest ? { maxOutputTokens: longest } : {}), ...turnOverhead(ref) }; },
    // What the next request of a session carries of its history, as its last turn was measured (ruling R10: "a later turn").
    turnContext: (sessionKey) => sessionCarried(sessionKey),
    translateQuote: (characters) => { try { const quote = captions.estimate({ kind: "translation", characters }) as { amountUsd: number | null; model?: string; ownAccount?: unknown[] }; return { usd: quote.amountUsd, label: String(quote.model ?? "Translation"), ...(quote.ownAccount?.length ? { ownAccount: true } : {}) }; } catch { return null; } },
    rpc: async (name, params, connection) => { const method = methods.get(name); if (!method) throw new ProtocolError("UNAVAILABLE", `This host has no method ${name}.`); return method.handle(params, connection); },
    call: (name, params, connection) => { const method = methods.get(name); if (!method) throw new ProtocolError("UNAVAILABLE", `This host has no method ${name}.`); return method.handle(params, connection); },
  });
  promptVideo.install();
  // Nobody confirms a cost when an automation runs: its limits are checked against what its runs are estimated at and have paid.
  const filmAutomationMoney = promptVideo.automationMoney;
  workflows.automations.bindMoney({
    ...filmAutomationMoney,
    estimate: (workflowId, params) => {
      if (workflowId === "tpl.one-prompt-video") return filmAutomationMoney.estimate(workflowId, params);
      const estimate = workflows.estimate(workflowId, params);
      return { highUsd: estimate.highUsd, unknown: estimate.unpricedModels.length > 0, unpricedModels: estimate.unpricedModels };
    },
  });
  // What an agent may start and follow: the templates that have a starter of their own.
  workflowRuns = createWorkflowRunPort({ workflows: () => workflows, starters: () => new Map(promptVideo ? [["tpl.one-prompt-video", promptVideo.starter]] : []) });
  for (const [name, method] of promptVideo.methods) methods.set(name, method);
  // Film Studio: the film documents, the methods of its screens, and the step tools of the film pipeline (same engine, same generation service).
  /** What a session's turns have cost so far, as Usage has it: a paid turn of film or captions is charged by it (the spend gate's `guardTurn`). */
  const sessionCost = async (sessionKey: string): Promise<number | null> => { try { return Number(((await methods.get("jagentchill.usage.session.get")!.handle({ sessionId: sessionKey }, { deviceId: "", role: () => "admin", scopes: () => ["jagentchill.projects.read"] } as unknown as Connection)) as { session?: { agentCostUsd?: number } }).session?.agentCostUsd ?? 0); } catch { return null; } };
  // Usage that settles AFTER a turn has answered reaches the paid-call gate through the Usage service's own "updated" event: the turn's charge gets its amount.
  /** The turns of a session as Usage has them, one record a turn: a paid turn's charge is settled by ITS record (the spend gate's `settleTurns`), not by what the session cost in all. */
  const sessionTurns = async (sessionKey: string): Promise<{ runId: string; costUsd?: number; started_ms: number; billedByCall: boolean }[] | null> => { try { return (((await methods.get("jagentchill.usage.session.get")!.handle({ sessionId: sessionKey }, { deviceId: "", role: () => "admin", scopes: () => ["jagentchill.projects.read"] } as unknown as Connection)) as { session?: { records?: { runId: string; costUsd?: number; started_ms: number; runtimeId?: string | null }[] } }).session?.records ?? []).map((record) => ({ runId: record.runId, ...(typeof record.costUsd === "number" ? { costUsd: record.costUsd } : {}), started_ms: record.started_ms, billedByCall: record.runtimeId ? billedByCall(record.runtimeId) ?? true : true })); } catch { return null; } };
  /** The sessions of the agent tree a session belongs to, its root first, as Usage has them: an agent tree is held to ONE Auto allowance (the generation tools). */
  const sessionTree = async (sessionKey: string): Promise<string[] | null> => { try { type Node = { sessionKey?: string; children?: Node[] }; const flat = (node: Node | undefined): string[] => (node?.sessionKey ? [node.sessionKey, ...(node.children ?? []).flatMap(flat)] : []); const keys = flat(((await methods.get("jagentchill.usage.session.get")!.handle({ sessionId: sessionKey, includeTree: true }, { deviceId: "", role: () => "admin", scopes: () => ["jagentchill.projects.read"] } as unknown as Connection)) as { tree?: Node }).tree); return keys.length ? keys : null; } catch { return null; } };
  generation.gate.bindUsage(sessionCost, sessionTurns, sessionTree);
  // The id the runtime gives a turn at its DISPATCH reaches the paid-call gate from the dispatch itself (the session service's `chat.send`, as film, captions and workflow runs call it in-process): a turn's charge is settled by Usage's record with THAT id, never by which records are new.
  { const send = relay.methods.get("jagentchill.chat.send"); if (send) relay.methods.set("jagentchill.chat.send", { ...send, handle: async (params, connection) => { const answer = await send.handle(params, connection); const sessionKey = (params as { sessionKey?: unknown } | null)?.sessionKey, runId = (answer as { runId?: unknown } | null)?.runId; if (typeof sessionKey === "string" && typeof runId === "string") generation.gate.turnSent(sessionKey, runId); return answer; } }); }
  // An answered approval card of a message's generation calls opens the agent's next turn, as an answered permission does.
  generation.bindSessions({ deliver: (sessionKey, message) => relay.deliver(sessionKey, message, { hostNote: true, reason: "host" }), running: (sessionKey) => relay.isRunning(sessionKey) });
  // Ruling R9, as review 16 #1 narrowed it — how the model of a turn is BILLED is read from the runtime's ACTUAL sign-in (`generation/billing.ts`): "own account" (no money question, nothing charged) only for a CLI that positively reports a personal subscription sign-in; the built-in runtime, a CLI on an API key (Gemini CLI on the host's Google key; Claude Code / Codex logged in with a key or started with one in their environment), a profile that changes the launch, and every runtime whose kind of sign-in cannot be told are billed per call and asked about.
  const runtimeBilling = createRuntimeBilling({ runtime: (runtimeId) => runtimes.runtime(runtimeId), launchEnv: (runtimeId) => runtimes.cliCommand(runtimeId)?.env, hostEnv: () => opts.hostPlatform?.env ?? process.env, status: (runtimeId, args) => runtimes.cliRun(runtimeId, args), now, staleMs: LOGIN_STALE_MS });
  const billedByCall = (runtimeId: string): boolean | undefined => (runtimes.runtime(runtimeId) ? runtimeBilling.of(runtimeId) !== "own_account" : undefined);
  generation.gate.bindBilling((who) => { const ref = who.ref?.runtimeId ? who.ref : who.role ? roleModel(who.role) : undefined; return ref?.runtimeId && billedByCall(ref.runtimeId) === false ? "own_account" : "per_call"; }, async (who) => { const ref = who.ref?.runtimeId ? who.ref : who.role ? roleModel(who.role) : undefined; return ref?.runtimeId ? runtimeBilling.verify(ref.runtimeId) : "per_call"; }, (runtimeId) => runtimes.runtime(runtimeId)?.label);
  void runtimeBilling.warm(runtimes.runtimes().filter((runtime) => runtime.kind === "cli" && runtime.enabled).map((runtime) => runtime.id)).catch(() => undefined);
  void Promise.resolve(methods.get("jagentchill.usage.subscribe")?.handle({ aggregate: true }, { deviceId: "", role: () => "admin", scopes: () => ["jagentchill.projects.read"], send: (_event: string, _stream: string, payload?: { sessionId?: string }) => { void generation.gate.usageUpdated(payload?.sessionId).catch(() => undefined); const ended = payload?.sessionId; if (ended) setImmediate(() => void generation.messageCards.settle(ended, { ended: true }).catch(() => undefined)); } } as unknown as Connection)).catch(() => undefined);
  // Turns of workflow runs and automations: what a turn cost comes back with it, and a run whose limit the paid-call gate knows sends its agent steps through the gate.
  // (`more`: an estimate made before the run for a turn that also reads text only the run will know. Ruling R10: the
  // bound counts the bytes of the message as far as it is known then; the same turn is reserved with its whole message
  // when it is sent, and the run's 120 % guard is what holds the difference.)
  workflows.bindSpend({ gate: () => generation.gate, turnCost: sessionCost, turnBound: (turn) => { const bound = promptVideo?.automationMoney.turnBound?.(turn) as ReturnType<NonNullable<Parameters<typeof workflows.bindSpend>[0]["turnBound"]>>; if (!bound?.ownAccount || bound.account) return bound; const ref = turn.ref ?? (turn.role ? roleModel(turn.role) : undefined), account = ref ? runtimes.runtime(ref.runtimeId)?.label : undefined; return account ? { ...bound, account } : bound; } });
  /**
   * MEASURED: what the next request of a session carries of its history — the prompt of its last measured turn and that
   * turn's answer, as the provider counted them. Undefined: the session has no measured turn (its next request is priced
   * like a first one of its model).
   */
  const sessionCarried = (sessionKey: string): number | undefined => { try { const last = db.prepare("SELECT context_used, output_tokens FROM usage_records WHERE session_key = ? AND context_used IS NOT NULL ORDER BY id DESC LIMIT 1").get(sessionKey) as { context_used: number; output_tokens: number | null } | undefined; return last ? last.context_used + (last.output_tokens ?? 0) : undefined; } catch { return undefined; } };
  /** What a turn on a model is sent beside its message (the runtime's system prompt and tools), as the provider counted it: the largest FIRST turn of a session on that model in this host's Usage. Nothing measured yet: nothing is said (a film then shows that turn's price as not known). */
  const turnOverhead = (ref: { runtimeId: string; providerId: string; modelId: string }): { overheadTokens?: number } => { try { const row = db.prepare("SELECT MAX(context_used) AS tokens FROM usage_records WHERE runtime_id = ? AND provider_id = ? AND model_id = ? AND context_used IS NOT NULL AND id IN (SELECT MIN(id) FROM usage_records GROUP BY session_key)").get(ref.runtimeId, ref.providerId, ref.modelId) as { tokens: number | null } | undefined; return typeof row?.tokens === "number" ? { overheadTokens: row.tokens } : {}; } catch { return {}; } };
  film = createFilmService({ turnCost: sessionCost,
    // What the host knows of the model a film's writing or looking turn runs on (the same facts one-prompt video prices its turns by): the film's quote prices those turns by them.
    turnModel: (ref) => { const runtime = runtimes.runtime(ref.runtimeId); if (!runtime) return undefined; const price = opts.modelPrice?.(ref) ?? aggregators.priceOf(ref.providerId, ref.modelId), own = endpoints.records().find((record) => record.id === ref.providerId)?.models.find((model) => model.id === ref.modelId), listed = runtimes.snapshot().find((entry) => entry.runtimeId === ref.runtimeId)?.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId); return { billedByCall: billedByCall(ref.runtimeId) ?? true, ...(price ? { price } : {}), ...(own?.maxOutputTokens ? { maxOutputTokens: own.maxOutputTokens } : {}), ...(own?.contextWindow ?? listed?.contextWindow ? { contextWindow: (own?.contextWindow ?? listed?.contextWindow)! } : {}), ...turnOverhead(ref) }; },
    turnContext: (sessionKey) => { try { const last = db.prepare("SELECT context_used, output_tokens FROM usage_records WHERE session_key = ? AND context_used IS NOT NULL ORDER BY id DESC LIMIT 1").get(sessionKey) as { context_used: number; output_tokens: number | null } | undefined; return last ? last.context_used + (last.output_tokens ?? 0) : undefined; } catch { return undefined; } },
    db, now, broadcast, workflows: () => workflows, generation: () => generation, sync, 
    roleModel,
  });
  film.install();
  for (const [name, method] of film.methods) methods.set(name, method);
  // Captions and the editor's speech tools: listening, translating and speaking for a device that holds the media.
  const captions = createCaptionsService({
    generation: () => generation, sync, roleRoute: (roleId) => orc.route(roleId), workflows: () => workflows, turnCost: sessionCost,
  });
  for (const [name, method] of captions.methods) methods.set(name, method);
  // Music: a remote catalogue behind a provider interface (keyless Openverse by default). Nothing musical is shipped; a track is fetched when a person plays or adds it.
  const music = createMusicService({ providers: opts.music?.providers ?? [createOpenverseProvider(opts.music?.openverseBaseUrl ? { baseUrl: opts.music.openverseBaseUrl } : {})], now, auth, ...(opts.music?.net ? { net: opts.music.net } : {}), warmAddresses: opts.music?.warmAddresses ?? false });
  for (const [name, method] of music.methods) methods.set(name, method);
  const previews = createRenderPreviewService({ db, now, dataDir: opts.dataDir, renderHost: opts.renderHost, blobs: sync.blobs, documents: sync.documents });
  for (const [name, method] of previews.methods) methods.set(name, method);
  const remoteExports = createRemoteExportService({ db, now, dataDir: opts.dataDir, blobs: sync.blobs, documents: sync.documents, auth, renderer: opts.remoteExportRenderer,
    jobs: { subscribe: (jobId, connection) => sync.subscribeJob(jobId, connection), unsubscribe: (jobId, connection) => sync.unsubscribeJob(jobId, connection), publish: (jobId, event, payload) => sync.publishJob(jobId, event, payload) },
  });
  for (const [name, method] of remoteExports.methods) methods.set(name, method);

  const channel = createProductChannel({
    host, devices, challenges, now, methods, admit: transportOf,
    onClose: (connection) => {
      tailnetSubscribers.delete(connection);
      relay.dropConnection(connection);
      runtimes.dropConnection(connection);
      sync.dropConnection(connection);
      tools.dropConnection(connection);
      skills.dropConnection(connection);
      usage.dropConnection(connection);
    },
    onPresenceChange: (deviceId, online, transport) => channel.sendToScope(
      "jagentchill.devices.manage", "jagentchill.device.presence.changed", "devices",
      { deviceId, online, lastTransport: transport },
    ),
    ...(opts.sync?.maxSchemaVersion ? { maxSchemaVersion: opts.sync.maxSchemaVersion } : {}),
    features: () => remoteExportFeatures(opts.remoteExportRenderer),
  });

  const tailnetUnsubscribe = opts.tailnet?.subscribe((status) => {
    for (const connection of tailnetSubscribers) connection.send(TAILNET_METHODS.statusUpdated, "tailnet", status);
  });
  let closePromise: Promise<void> | undefined;
  let httpClosed: Promise<void> | undefined;
  const stopAcceptingWork = (): Promise<void> => {
    if (httpClosed) return httpClosed;
    tailnetUnsubscribe?.();
    // Mark the channel closed before terminating sockets so their close callbacks cannot
    // publish a late device-presence event.
    channel.closeAll();
    httpClosed = new Promise<void>((resolve) => {
      if (!http.listening) { resolve(); return; }
      http.close(() => resolve());
      http.closeAllConnections();
    });
    return httpClosed;
  };
  const tailnetParams = z.object({}).strict();
  methods.set(TAILNET_METHODS.statusGet, {
    scope: manage,
    handle: (_raw, connection) => { tailnetParams.parse(_raw ?? {}); requireTailnetAdmin(connection); return tailnetStatus(); },
  });
  methods.set(TAILNET_METHODS.proxyCredentials, {
    scope: manage,
    handle: (_raw, connection) => {
      tailnetParams.parse(_raw ?? {});
      requireTailnetAdmin(connection);
      if (connection.transport !== "loopback") throw new ProtocolError("PERMISSION_DENIED", "The outbound proxy is available only to this computer.", { httpStatus: 403 });
      return opts.tailnet?.proxyCredentials() ?? null;
    },
  });
  methods.set(TAILNET_METHODS.statusSubscribe, {
    scope: manage,
    handle: (_raw, connection) => { tailnetParams.parse(_raw ?? {}); requireTailnetAdmin(connection); tailnetSubscribers.add(connection); return { status: tailnetStatus() }; },
  });
  methods.set(TAILNET_METHODS.loginStart, {
    scope: manage,
    handle: async (_raw, connection) => { tailnetParams.parse(_raw ?? {}); requireTailnetAdmin(connection); if (!opts.tailnet) throw new ProtocolError("UNAVAILABLE", "The embedded Tailscale bridge is unavailable."); return opts.tailnet.startInteractiveLogin(); },
  });
  methods.set(TAILNET_METHODS.authKeyJoin, {
    scope: manage,
    handle: async (raw, connection) => {
      requireTailnetAdmin(connection);
      const { authKey } = z.object({ authKey: z.string().trim().min(1).max(256) }).strict().parse(raw ?? {});
      if (!opts.tailnet) throw new ProtocolError("UNAVAILABLE", "The embedded Tailscale bridge is unavailable.");
      return opts.tailnet.joinWithAuthKey(authKey);
    },
  });
  methods.set(TAILNET_METHODS.disable, {
    scope: manage,
    handle: async (_raw, connection) => { tailnetParams.parse(_raw ?? {}); requireTailnetAdmin(connection); if (!opts.tailnet) return tailnetStatus(); return opts.tailnet.setEnabled(false); },
  });
  methods.set(DIRECT_CONNECTION_METHODS.statusGet, {
    scope: manage,
    handle: (_raw, connection) => { tailnetParams.parse(_raw ?? {}); requireTailnetAdmin(connection); return directNetworkStatus(); },
  });
  methods.set(DIRECT_CONNECTION_METHODS.statusSet, {
    scope: manage,
    handle: async (raw, connection) => {
      requireTailnetAdmin(connection);
      const input = z.object({
        enabled: z.boolean(),
        address: z.string().refine((value) => isIP(value) !== 0).optional(),
        password: z.string().min(1).max(256).nullable().optional(),
      }).strict().parse(raw ?? {});
      if (!opts.rebindDirectListener) throw new ProtocolError("UNAVAILABLE", "Direct network listening is unavailable in this host process.");
      const next: StoredDirectNetwork = {
        enabled: input.enabled,
        address: input.address ?? directNetwork.address,
        ...(Object.hasOwn(input, "password")
          ? input.password === null ? {} : { passwordHash: hashDirectPassword(input.password!) }
          : directNetwork.passwordHash ? { passwordHash: directNetwork.passwordHash } : {}),
      };
      const previous = directNetwork;
      config.set("directNetwork", next);
      directNetwork = next;
      channel.closeTransport("lan", CLOSE_CODES.unauthenticated, "DIRECT_LISTENER_CHANGED");
      try {
        await opts.rebindDirectListener(next.enabled ? next.address : "127.0.0.1");
      } catch (error) {
        directNetwork = previous;
        config.set("directNetwork", previous);
        throw new ProtocolError("UNAVAILABLE", `The direct listener could not be changed: ${error instanceof Error ? error.message : "bind failed"}.`, { httpStatus: 503, retryable: true });
      }
      return directNetworkStatus();
    },
  });

  enrolment.listen({
    requested: (request, code) => channel.sendToScope("jagentchill.devices.manage", "jagentchill.pairing.requested", "pairing", { request, code }),
    completed: (request) => channel.sendToScope("jagentchill.devices.manage", "jagentchill.pairing.completed", "pairing", { request }),
  });

  methods.set("jagentchill.pairing.request.list", { scope: manage, handle: () => ({ requests: enrolment.pending() }) });
  methods.set("jagentchill.pairing.request.decline", {
    scope: manage,
    handle: (p) => enrolment.decline(params(z.object({ requestId: z.string().uuid() }), p).requestId),
  });
  methods.set("jagentchill.pairing.request.setRole", {
    scope: manage,
    handle: (p) => {
      const { requestId, role } = params(z.object({ requestId: z.string().uuid(), role: z.enum(ROLES) }), p);
      enrolment.setRole(requestId, role);
    },
  });
  methods.set("jagentchill.device.list", {
    scope: manage,
    handle: (_p, connection) => ({
      devices: devices.list().map((device) => ({ ...device, online: channel.isOnline(device.deviceId), lastTransport: channel.lastTransportOf(device.deviceId) ?? device.lastTransport, thisDevice: device.deviceId === connection.deviceId })),
    }),
  });
  methods.set("jagentchill.pairing.offer.create", {
    scope: manage,
    handle: (p, connection) => {
      const { role } = params(z.object({ role: z.enum(ROLES).default("editor") }), p);
      // The offer lists the address this trusted device itself reached the host on.
      const offer = enrolment.createOffer(offerAddresses(), { rolePreset: role });
      audit(db, now(), `device:${connection.deviceId}`, "pairing.offer.create", { offerId: offer.offerId, role });
      return { url: encodeOfferUrl(offer), expires_ms: offer.expires_ms, gatewayId: offer.gatewayId, role };
    },
  });
  methods.set("jagentchill.pairing.offer.cancel", { scope: manage, handle: () => enrolment.cancelOffer() });
  methods.set("jagentchill.device.role.set", {
    scope: manage,
    handle: (p, connection) => {
      const { deviceId, role } = params(z.object({ deviceId: z.string(), role: z.enum(ROLES) }), p);
      return { device: devices.setRole(deviceId, role, `device:${connection.deviceId}`) };
    },
  });
  methods.set("jagentchill.device.revoke", {
    scope: manage,
    handle: (p, connection) => {
      const { deviceId } = params(z.object({ deviceId: z.string() }), p);
      devices.revoke(deviceId, `device:${connection.deviceId}`);
      relay.orphanSessionsOf(deviceId);
      channel.closeDevice(deviceId, CLOSE_CODES.revoked, "DEVICE_REVOKED");
      sync.dropDevice(deviceId);
    },
  });

  const isSupervisor = (connection: Connection) => devices.get(connection.deviceId)?.localSupervisor === true;
  const hostStatus = (): HostStatus => ({ ...(opts.hostStatus?.() ?? { gateway: { state: "ready", restartCount: 0 }, serverVersion: "0.0.0", started_ms: 0, port: 0 }), mediaTools: sync.mediaJobs.status() });
  methods.set("jagentchill.settings.host.get", {
    scope: "jagentchill.config.read",
    handle: (_p, connection) => hostView(hostStatus(), isSupervisor(connection), tailnetStatus(), directNetworkStatus()),
  });
  methods.set("jagentchill.diagnostics.shutdown.prepare", {
    scope: "jagentchill.config.write",
    handle: async (_p, connection) => {
      // Only the desktop app that started this server may make it ready to be stopped.
      if (!isSupervisor(connection)) throw new ProtocolError("PERMISSION_DENIED", "Only this computer's own app may stop its host.", { httpStatus: 403 });
      audit(db, now(), `device:${connection.deviceId}`, "host.shutdown.prepare", {});
      const result = (await opts.prepareShutdown?.()) ?? { safe: true, running: [] };
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return result.safe ? { safe: true } : result;
    },
  });

  methods.set("jagentchill.diagnostics.service.restart", {
    scope: "jagentchill.config.write",
    handle: async (p, connection) => {
      const { service } = params(z.object({ service: z.literal("gateway") }).strict(), p);
      if (!opts.restartService) throw new ProtocolError("UNSUPPORTED_FEATURE", "This host does not supervise that service.");
      audit(db, now(), `device:${connection.deviceId}`, "service.restart", { service });
      await opts.restartService();
      return { service, gateway: hostView(hostStatus(), isSupervisor(connection), tailnetStatus(), directNetworkStatus()).gateway };
    },
  });
  methods.set("jagentchill.device.key.rotate", {
    scope: "jagentchill.config.read",
    handle: (p, connection) => {
      const proof = params(z.object({ newDevicePublicKey: z.string().max(64), ts: z.number().int().nonnegative(), signatureByOldKey: z.string().max(128), signatureByNewKey: z.string().max(128) }).strict(), p);
      const rotated = devices.rotateKey(connection.deviceId, proof, host.gatewayId, { transport: connection.transport });
      db.prepare("UPDATE agent_sessions SET owner_device_id = ? WHERE owner_device_id = ?").run(rotated.device.deviceId, connection.deviceId);
      // Every admin learns of it, so that a rotation nobody asked for is seen by a person.
      channel.sendToScope("jagentchill.devices.manage", "jagentchill.device.key_rotated", "devices", { oldDeviceId: connection.deviceId, newDeviceId: rotated.device.deviceId, name: rotated.device.name });
      // The old key's connections end once this answer is on its way.
      setTimeout(() => channel.closeDevice(connection.deviceId, CLOSE_CODES.revoked, "DEVICE_REVOKED"), 50);
      return { deviceId: rotated.device.deviceId, deviceToken: rotated.token };
    },
  });

  function sendPage(res: ServerResponse, ok: boolean, message: string): void {
    const text = message.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(`<!doctype html><meta charset="utf-8"><title>JAgentChill</title><body style="font:16px system-ui;margin:20vh auto;max-width:28rem;text-align:center"><h1 style="font-size:20px">${ok ? "Sign-in received" : "Sign-in not completed"}</h1><p>${text}</p></body>`);
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  }

  async function route(req: IncomingMessage, res: ServerResponse, forcedTransport?: AddressKind): Promise<void> {
    const target = req.url ?? "/";
    const url = new URL(target, "http://host.invalid");
    const path = url.pathname;
    const transport = transportOf(req, forcedTransport);
    if (!transport) return sendJson(res, 403, { error: new ProtocolError("SCOPE_DENIED", "Not reachable from this address.").envelope() });
    // Tailnet requests use the same product HTTP handlers, but may not enter routes whose trust decision assumes
    // the socket itself is the local desktop (the private ingress socket is loopback by design).
    if (forcedTransport !== "tailnet" && opts.extraRoutes?.(req, res, path)) return;
    const origin = req.headers.origin;
    if (origin && originAllowed(req)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST, PUT, DELETE",
          "access-control-allow-headers": "content-type, range, x-jagentchill-rate, x-jagentchill-device, x-jagentchill-timestamp, x-jagentchill-nonce, x-jagentchill-signature",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }
    }
    const peer = { address: req.socket.remoteAddress ?? "", transport };

    // Where a provider's sign-in page sends the browser back. Unsigned: the single-use `state` names the login, which
    // belongs to the admin device that started it; the authorisation code is useless without the verifier kept here.
    if (req.method === "GET" && path === OPENROUTER_CALLBACK_PATH) {
      const result = await providerAuth.oauthCallback(url.searchParams);
      return sendPage(res, result.ok, result.message);
    }
    if (req.method === "GET" && path === `${PREFIX}/health`) {
      return sendJson(res, 200, { ok: true, gatewayId: host.gatewayId, gatewayPublicKey: host.gatewayPublicKey, protocolVersion: PROTOCOL_VERSION, ...opts.health?.() });
    }
    // The host CLI's endpoint on this machine. It answers only with the token kept in the server's own data directory.
    if (req.method === "POST" && path === `${PREFIX}/local-admin/devices/add-admin`) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (transport !== "loopback" || !opts.localAdminToken || req.headers.origin || !constantTimeEqual(bearer, opts.localAdminToken)) throw new ProtocolError("NOT_FOUND", "No such route.", { httpStatus: 404 });
      const body = parseJson(z.object({ publicKey: z.string().max(64), localSupervisor: z.boolean().default(false), keyProtection: z.enum(["os-store", "file"]).optional() }).strict(), await readBody(req, MAX_JSON_BODY_BYTES));
      const restored = restoreLocalAdmin({ devices, db, dataDir: opts.dataDir, publicKey: body.publicKey, localSupervisor: body.localSupervisor === true, keyProtection: body.keyProtection, now });
      return sendJson(res, 200, { deviceId: restored.device.deviceId, role: restored.device.role, localSupervisor: restored.device.localSupervisor });
    }
    if (req.method === "POST" && path === `${PREFIX}/pair/challenge`) {
      const body = parseJson(challengeBodySchema, await readBody(req, MAX_JSON_BODY_BYTES));
      return sendJson(res, 200, enrolment.challenge(body, peer));
    }
    if (req.method === "POST" && path === `${PREFIX}/pair/prove`) {
      const body = parseJson(z.object({ requestId: z.string().uuid(), signature: z.string().max(128) }).strict(), await readBody(req, MAX_JSON_BODY_BYTES));
      return sendJson(res, 200, enrolment.prove(body.requestId, body.signature));
    }
    if (req.method === "POST" && path === `${PREFIX}/pair/verify`) {
      const raw = await readBody(req, MAX_JSON_BODY_BYTES);
      const body = parseJson(
        z.union([
          z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict(),
          z.object({ requestId: z.string().uuid(), action: z.literal("cancel") }).strict(),
        ]),
        raw,
      );
      // The signature is required before the code is looked at: an unsigned guess counts no attempt.
      const key = enrolment.enrollingKey(body.requestId);
      if (!key) throw new ProtocolError("NOT_FOUND", "No such pairing request.", { httpStatus: 404 });
      auth.authenticateEnrolling({ method: "POST", target, headers: req.headers, body: raw }, key);
      if ("action" in body) {
        enrolment.cancel(body.requestId);
        return sendJson(res, 200, { state: "cancelled" });
      }
      const result = enrolment.verify(body.requestId, body.code);
      return sendJson(res, 200, { role: result.role, gatewayName: "JAgentChill", deviceToken: result.deviceToken });
    }
    // Secret values travel only on these signed routes, never in a channel frame, and are never sent back.
    // An export a device asked for: the archive of a skill, or a usage CSV. Signed like every other route, never a public link.
    const exported = req.method === "GET" ? /^\/jagentchill\/v1\/(skills|usage)\/exports\/([0-9a-f]{64})$/.exec(path) : null;
    if (exported) {
      auth.authenticate({ method: "GET", target, headers: req.headers, body: new Uint8Array() }, exported[1] === "skills" ? "jagentchill.agent.use" : "jagentchill.config.read");
      const bytes = exported[1] === "skills" ? skills.exportBlob(exported[2]) : usage.exportBlob(exported[2]);
      if (!bytes) throw new ProtocolError("NOT_FOUND", "This export is no longer kept.", { httpStatus: 404 });
      res.writeHead(200, { "content-type": exported[1] === "skills" ? "application/zip" : "text/csv; charset=utf-8", "content-length": String(bytes.length), "cache-control": "no-store" });
      res.end(bytes);
      return;
    }
    if (path === `${PREFIX}/secrets` && req.method === "GET") {
      auth.authenticate({ method: "GET", target, headers: req.headers, body: new Uint8Array() }, "jagentchill.secrets.manage");
      return sendJson(res, 200, { secrets: secrets.list() });
    }
    if (path.startsWith(`${PREFIX}/secrets/`) && (req.method === "PUT" || req.method === "DELETE")) {
      const name = decodeURIComponent(path.slice(`${PREFIX}/secrets/`.length));
      const raw = req.method === "PUT" ? await readBody(req, MAX_SECRET_BODY_BYTES) : Buffer.alloc(0);
      const deviceId = auth.authenticate({ method: req.method, target, headers: req.headers, body: raw }, "jagentchill.secrets.manage");
      SecretStore.assertName(name);
      if (req.method === "PUT") {
        secrets.set(name, raw.toString("utf8"));
        audit(db, now(), `device:${deviceId}`, "secret.put", { name });
        return sendJson(res, 200, { name, ...(secrets.hint(name) ? { hint: secrets.hint(name) } : {}) });
      }
      if (endpoints.usesSecret(name) || providerAuth.usesSecret(name)) throw new ProtocolError("CONFLICT", "This secret is still used by a provider or an endpoint.", { httpStatus: 409 });
      if (!secrets.delete(name)) throw new ProtocolError("NOT_FOUND", "No such secret.", { httpStatus: 404 });
      audit(db, now(), `device:${deviceId}`, "secret.delete", { name });
      return sendJson(res, 200, { name });
    }
    if (req.method === "GET" && path === `${PREFIX}/pair/status`) {
      const requestId = url.searchParams.get("requestId") ?? "";
      const key = enrolment.enrollingKey(requestId);
      if (!key) throw new ProtocolError("NOT_FOUND", "No such pairing request.", { httpStatus: 404 });
      auth.authenticateEnrolling({ method: "GET", target, headers: req.headers, body: new Uint8Array() }, key);
      return sendJson(res, 200, enrolment.status(requestId));
    }
    // Media bytes of cross-device sync: the signed blob routes.
    if (await remoteExports.route(req, res, target)) return;
    if (await music.route({ req, res, target, path })) return;
    if (await sync.route({ req, res, target, path, loopback: transport === "loopback" })) return;
    throw new ProtocolError("NOT_FOUND", "No such route.", { httpStatus: 404 });
  }

  const dispatch = (req: IncomingMessage, res: ServerResponse, forcedTransport?: AddressKind) => {
    route(req, res, forcedTransport).catch((err) => {
      if (res.headersSent) return res.destroy();
      const error = err instanceof ProtocolError ? err : new ProtocolError("INTERNAL", "Internal error.", { httpStatus: 500, retryable: true });
      if (!(err instanceof ProtocolError)) console.error(`[server] ${err instanceof Error ? err.stack : err}`);
      const retryAfter: Record<string, string> = typeof error.details?.retryAfter_ms === "number" ? { "retry-after": String(Math.ceil(error.details.retryAfter_ms / 1000)) } : {};
      sendJson(res, error.httpStatus, { error: error.envelope() }, retryAfter);
    });
  };
  const http: Server = createServer((req, res) => dispatch(req, res));
  http.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://host.invalid").pathname !== `${PREFIX}/ws`) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (transportOf(req) === "lan" && directNetwork.passwordHash) {
      const password = directPasswordFromProtocols(req.headers["sec-websocket-protocol"]);
      if (password === null || !verifyDirectPassword(password, directNetwork.passwordHash)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
    }
    channel.handleUpgrade(req, socket, head);
  });

  // Results of sub-agents that were ready when the server stopped are delivered now that it runs again.
  setImmediate(() => { try { team.start(); } catch (error) { console.error(`[agents] start failed: ${error instanceof Error ? error.message : error}`); } });

  return {
    /** The host's context and token settings as they are stored now. */
    contextSettings: () => contextWindow.settings(),
    directConnection: {
      status: directNetworkStatus,
      listenAddress: () => directNetwork.enabled ? directNetwork.address : "127.0.0.1",
    },
    http,
    handleTailnetHttp: (req: IncomingMessage, res: ServerResponse) => dispatch(req, res, "tailnet"),
    host,
    devices,
    methods,
    channel,
    relay,
    transcript,
    sync,
    tools,
    team,
    runtimes,
    orc,
    providerAuth,
    skills,
    usage,
    contextWindow,
    workflows,
    generation,
    localModels,
    film,
    captions,
    secrets,
    db,
    /** "Restart agents": every running turn is stopped and every agent CLI closed; the next turn starts them again. */
    async restartAgents(): Promise<void> {
      await relay.stopAll();
      await relay.close();
    },
    /** Host-side pairing: what the host CLI and a local trusted display use. */
    pairing: {
      createOffer: (addresses: OfferAddress[], o?: { rolePreset?: Role; firstDeviceIsAdmin?: boolean }) => enrolment.createOffer(addresses, o),
      pending: () => enrolment.pending(),
      decline: (requestId: string) => enrolment.decline(requestId),
      setRole: (requestId: string, role: Role) => enrolment.setRole(requestId, role),
      listen: (listener: EnrolmentListener) => enrolment.listen(listener),
    },
    close: (): Promise<void> => {
      if (closePromise) return closePromise;
      const stoppedHttp = stopAcceptingWork();
      usage.closeOpenTurns();
      generation.close();
      localModels.close();
      workflows.close();
      const relayClosed = relay.close();
      team.close();
      tools.close();
      providerAuth.close();
      videoFilms.close();
      closePromise = (async () => {
        await Promise.allSettled([relayClosed, sync.close(), remoteExports.close(), opts.renderHost?.stop?.()]);
        await stoppedHttp;
        db.close();
      })();
      return closePromise;
    },
    stopAcceptingWork,
  };
}

export type ServerApp = ReturnType<typeof createServerApp>;
