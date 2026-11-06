import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  RUNTIME_LIMITS, RUNTIME_METHOD_SCOPES, catalogueListParams, diagnoseParams, emptyParams, modelsListParams, modelsSearchParams, runtimeConfigUpdateParams, runtimesConfigSchema,
  snapshotGetParams, snapshotRefreshParams, type AggregatorModel, type ConfiguredModel, type ModelEntry, type ModelRef, type Readiness, type Role,
  runtimeInstallIdParams, runtimeInstallStartParams, type RuntimeInstallSnapshot, type RuntimeErrorInfo, type RuntimeFeature, type RuntimeSignIn, type RuntimeSignInOption, type RuntimeSnapshotEntry, type RuntimesConfig, type Scope, type SessionSelection,
} from "@jagentchill/protocol";
import type { RuntimeClient } from "../agents/runtime/types.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { AggregatorCatalogue, PublishedModel } from "../providers/aggregator.ts";
import type { SecretStore } from "../secrets/store.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import {
  Limiter, STEP_LABEL, interpretStatus, launchEnvironment, resolveBinary, runCommand, searchPath, type CommandResult, type HostPlatform, type LoginResult,
  type ProbeStep,
} from "./probe.ts";
import { BUILTIN_RUNTIMES, isDefaultRuntimeId, isKnownBase, isShippedRuntimeId, modesOf, resolveRuntimes, type ResolvedRuntime } from "./registry.ts";

const GLOBAL_SCOPE = "global";
const VERSION_TIMEOUT_MS = 5000;
const CATALOGUE_TIMEOUT_MS = 30_000;
export const LOGIN_STALE_MS = 600_000;
/** Literal environment values that look like a credential must be stored as a secret instead. */
const CREDENTIAL_PATTERN = /^(?:[A-Za-z0-9+/=_-]{32,}|[0-9a-fA-F]{32,}|(?:sk-|sk_|ghp_|gho_|github_pat_|xox[abp]-|AIza|AKIA|hf_|gsk_|pk-)\S{8,})$/;
/** Builds the client of a runtime the server drives (`agents/runtime/launcher.ts`); replaced in tests by fakes. */
export type RuntimeClientFactory = (runtime: ResolvedRuntime, command: { path: string; env: Record<string, string> } | undefined) => RuntimeClient | undefined;

export type RuntimeServiceDeps = {
  db: DatabaseSync;
  config: ServerConfigFile;
  secrets: SecretStore;
  now: () => number;
  /** The client of a runtime: its model catalogue is read from the runtime itself. */
  clients: RuntimeClientFactory;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  /** Called after the runtime configuration changed. */
  onConfigChanged: () => void;
  /** Label of a provider or endpoint id, for the model browser. */
  providerLabel: (providerId: string) => string | undefined;
  /** The session's current selection, when the caller can read the session. */
  selectionOf: (sessionKey: string, connection: Connection) => SessionSelection | undefined;
  /** Profiles of other capabilities that name a runtime id (ORC profiles), so a referenced profile is not removed. */
  referencesTo: (runtimeId: string) => string[];
  host?: HostPlatform;
  dataDir?: string;
  /** Replaced in tests, where no CLI can be started. */
  run?: (file: string, args: string[], opts: { env: Record<string, string>; timeoutMs: number; signal?: AbortSignal }) => Promise<CommandResult>;
  /** The stored keys and endpoints a CLI can run on instead of its own account (`providers/runtime-access.ts`). */
  access?: {
    options(runtime: ResolvedRuntime): RuntimeSignInOption[];
    resolve(runtime: ResolvedRuntime, signIn: Exclude<RuntimeSignIn, { kind: "cli" }>): { label: string; models: ModelEntry[] } | { label: string; error: RuntimeErrorInfo };
  };
};

type ScopeState = { entries: Map<string, RuntimeSnapshotEntry>; read_ms: number };
type ProbeTrace = { login?: LoginResult; searched: string[]; versionCommand?: string; duration_ms: number; catalogue?: string };

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A rule with its own wording is reported in those words; a plain shape mismatch is not explained field by field.
    const own = issue?.message && !/^(Invalid|Required|Expected|String must|Number must|Array must|Unrecognized)/.test(issue.message);
    throw new ProtocolError("INVALID_PARAMS", own ? issue.message : "The parameters do not match the expected shape.", { details: { path: issue?.path.join(".") ?? "" } });
  }
  return parsed.data;
}

export function defaultRuntimesConfig(): RuntimesConfig {
  return { version: 1, revision: 0, probeTimeout_ms: 120_000, extraPath: [], offerEditorToolsToAcp: true, providerGroups: {}, pinnedModelIds: {}, entries: {} };
}

/** Runtime configuration, detection, snapshots, the model browser data and the capability matrix. */
export function createRuntimeService(deps: RuntimeServiceDeps) {
  const host: HostPlatform = deps.host ?? { platform: process.platform, env: process.env };
  const run = deps.run ?? runCommand;
  const limiter = new Limiter(RUNTIME_LIMITS.concurrentProbes);
  const scopes = new Map<string, ScopeState>();
  const inflight = new Map<string, Promise<void>>();
  const traces = new Map<string, ProbeTrace>();
  const subscribers = new Set<Connection>();
  const installs = new Map<string, { snapshot: RuntimeInstallSnapshot; child?: ReturnType<typeof spawn>; cancelled: boolean }>();
  const installSpecs = {
    "claude-code": { label: "Claude Code", package: "@anthropic-ai/claude-code", binary: "claude", estimate: { darwin: 245, win32: 250, linux: 247 } },
    codex: { label: "Codex", package: "@openai/codex", binary: "codex", estimate: { darwin: 350, win32: 436, linux: 432 } },
    "gemini-cli": { label: "Gemini CLI", package: "@google/gemini-cli", binary: "gemini", estimate: { darwin: 95, win32: 95, linux: 95 } },
  } as const;
  const installBin = (prefix: string) => host.platform === "win32" ? prefix : join(prefix, "bin");
  function startInstall(raw: unknown) {
    const { runtimeId } = parse(runtimeInstallStartParams, raw);
    const spec = installSpecs[runtimeId];
    if (!deps.dataDir) throw new ProtocolError("UNAVAILABLE", "This host has no per-user tools folder.");
    if (host.platform !== "darwin" && host.platform !== "win32" && host.platform !== "linux") throw new ProtocolError("UNAVAILABLE", "This system is not supported for CLI installation.");
    if (!runtimeById(runtimeId)) throw new ProtocolError("NOT_FOUND", "This CLI is not available on this host.");
    if ([...installs.values()].some((job) => job.snapshot.runtimeId === runtimeId && ["downloading", "verifying"].includes(job.snapshot.state))) throw new ProtocolError("CONFLICT", "This CLI is already being installed.");
    const installId = randomUUID();
    const snapshot: RuntimeInstallSnapshot = { installId, runtimeId, state: "downloading", progress: 0.04, step: "Preparing the per-user install folder" };
    const job = { snapshot, cancelled: false };
    installs.set(installId, job);
    void runInstall(job, spec);
    return { install: snapshot, estimateMiB: spec.estimate[host.platform] };
  }
  async function runInstall(job: { snapshot: RuntimeInstallSnapshot; child?: ReturnType<typeof spawn>; cancelled: boolean }, spec: (typeof installSpecs)[keyof typeof installSpecs]) {
    const prefix = join(deps.dataDir!, "tools", job.snapshot.runtimeId);
    const bin = installBin(prefix);
    try {
      await mkdir(prefix, { recursive: true, mode: 0o700 });
      if (host.platform !== "win32") await chmod(prefix, 0o700);
      if (host.platform !== "win32") await mkdir(bin, { recursive: true, mode: 0o700 });
      job.snapshot = { ...job.snapshot, progress: 0.1, step: "Downloading the official CLI package and its dependencies" };
      const child = spawn("npm", ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "--fetch-retries=0", "--fetch-timeout=30000", "--loglevel=verbose", `${spec.package}@latest`], {
        cwd: prefix, env: { ...host.env, PATH: [bin, host.env.PATH ?? ""].filter(Boolean).join(host.platform === "win32" ? ";" : ":"), npm_config_update_notifier: "false", npm_config_cache: join(deps.dataDir!, "tools", ".npm-cache") },
        stdio: ["ignore", "pipe", "pipe"], shell: host.platform === "win32", windowsHide: true,
      });
      job.child = child;
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4096); if (/http fetch|fetch GET/i.test(chunk.toString())) job.snapshot = { ...job.snapshot, progress: 0.42, step: "Downloading the official CLI package" }; if (/added \d+ packages/i.test(output)) job.snapshot = { ...job.snapshot, progress: 0.78, step: "Installing the CLI" }; });
      child.stderr?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4096); if (/http fetch|fetch GET/i.test(chunk.toString())) job.snapshot = { ...job.snapshot, progress: 0.42, step: "Downloading the official CLI package" }; });
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", (value) => resolve(value)); });
      job.child = undefined;
      if (job.cancelled) { job.snapshot = { ...job.snapshot, state: "cancelled", progress: null, step: "Installation cancelled" }; return; }
      if (code !== 0) throw new Error(/ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|E503/.test(output) ? "Unable to reach the package registry. Check your connection and retry." : /EINTEGRITY|TAR_BAD_ARCHIVE|TAR_ENTRY_INVALID/.test(output) ? "The downloaded package could not be verified. Retry the install." : `The package manager could not install ${spec.label}. Check the connection and available disk space, then retry.`);
      job.snapshot = { ...job.snapshot, state: "verifying", progress: 0.88, step: "Checking the installed CLI version" };
      const path = join(bin, host.platform === "win32" ? `${spec.binary}.cmd` : spec.binary);
      const result = await run(path, ["--version"], { env: { ...host.env, PATH: [bin, host.env.PATH ?? ""].filter(Boolean).join(host.platform === "win32" ? ";" : ":") }, timeoutMs: 10_000 });
      if (result.code !== 0 || !result.stdout.trim()) throw new Error(`${spec.label} installed, but its version check failed. Retry the install.`);
      config = { ...config, revision: config.revision + 1, extraPath: [...new Set([bin, ...config.extraPath])] };
      deps.config.set("runtimes", config);
      runtimes = resolveRuntimes(config);
      job.snapshot = { ...job.snapshot, state: "installed", progress: 1, step: `${spec.label} ${result.stdout.trim().split(/\r?\n/)[0]} is installed` };
      announce(GLOBAL_SCOPE, [job.snapshot.runtimeId]);
      // A settings page can still have the cold-start "not installed" probe in flight. Await it and
      // probe again after installing, otherwise that older result can overwrite the installed row.
      await Promise.all([...scopes.keys()].map(async (scopeKey) => {
        await inflight.get(`${scopeKey}\n${job.snapshot.runtimeId}`)?.catch(() => undefined);
        await probe(scopeKey, job.snapshot.runtimeId);
      }));
    } catch (error) {
      job.child = undefined;
      job.snapshot = { ...job.snapshot, state: job.cancelled ? "cancelled" : "failed", progress: null, step: job.cancelled ? "Installation cancelled" : "Installation failed", ...(!job.cancelled ? { error: error instanceof Error ? error.message : "The install did not finish. Retry." } : {}) };
    }
  }
  function installStatus(raw: unknown) {
    const { installId } = parse(runtimeInstallIdParams, raw);
    const job = installs.get(installId);
    if (!job) throw new ProtocolError("NOT_FOUND", "This install is no longer available.");
    return { install: job.snapshot };
  }
  function cancelInstall(raw: unknown) {
    const { installId } = parse(runtimeInstallIdParams, raw);
    const job = installs.get(installId);
    if (!job) throw new ProtocolError("NOT_FOUND", "This install is no longer available.");
    if (job.snapshot.state === "downloading" || job.snapshot.state === "verifying") {
      job.cancelled = true;
      const child = job.child;
      child?.kill("SIGTERM");
      if (child) {
        // npm handles SIGTERM gracefully but can wait for a stalled registry response before exiting.
        const forceStop = setTimeout(() => { if (job.child === child) child.kill("SIGKILL"); }, 1000);
        child.once("exit", () => clearTimeout(forceStop));
      }
      job.snapshot = { ...job.snapshot, state: "cancelled", progress: null, step: "Installation cancelled" };
    }
    return { install: job.snapshot };
  }

  const readConfig = (): RuntimesConfig => {
    const stored = runtimesConfigSchema.safeParse(deps.config.get("runtimes"));
    return stored.success ? stored.data : defaultRuntimesConfig();
  };
  let config = readConfig();
  let runtimes = resolveRuntimes(config);
  const runtimeById = (id: string) => runtimes.find((runtime) => runtime.id === id);
  /** The installed command of a CLI runtime and the environment the server starts it in; undefined when it is not installed. */
  function cliCommandOf(runtime: ResolvedRuntime, overlay: Record<string, string> = {}): { path: string; env: Record<string, string>; label: string } | undefined {
    const override = runtime.entry?.command?.[0];
    if (!override && !runtime.binary) return undefined;
    const binary = resolveBinary(override ?? runtime.binary!, override ? "override" : "default", host, config.extraPath);
    if (!binary) return undefined;
    const own = Object.fromEntries(Object.entries(runtime.entry?.env ?? {}).flatMap(([name, value]) => {
      if (typeof value === "string") return [[name, value]];
      const secret = value && typeof value === "object" && "secret" in value ? deps.secrets.read(String((value as { secret: unknown }).secret)) : undefined;
      return secret ? [[name, secret]] : [];
    }));
    return { path: binary.path, label: runtime.label, env: { ...launchEnvironment(host.env, overlay, deps.secrets.list().map((secret) => secret.name), host.platform), ...own } };
  }

  // ---- configuration ----

  function validate(next: RuntimesConfig): void {
    if (next.probeTimeout_ms < 10_000 || next.probeTimeout_ms > 600_000) {
      throw new ProtocolError("INVALID_PARAMS", "The probe deadline must be between 10 000 and 600 000 ms.", { details: { path: "probeTimeout_ms", min: 10_000, max: 600_000 } });
    }
    let profiles = 0;
    let added = 0;
    for (const [id, entry] of Object.entries(next.entries)) {
      const path = `entries.${id}`;
      if (isShippedRuntimeId(id)) {
        if (entry.extends) throw new ProtocolError("INVALID_PARAMS", "A built-in runtime cannot extend another.", { details: { path: `${path}.extends` } });
        if (entry.env || entry.command) {
          throw new ProtocolError("INVALID_PARAMS", "A built-in runtime always uses the CLI's own sign-in. To change its address, key or command, create a profile.", { details: { path: `${path}.${entry.env ? "env" : "command"}` } });
        }
        if (!isDefaultRuntimeId(id)) added += 1;
      } else {
        if (!entry.extends) throw new ProtocolError("INVALID_PARAMS", "A custom runtime must name the runtime it extends.", { details: { path: `${path}.extends` } });
        if (!isKnownBase(entry.extends)) throw new ProtocolError("INVALID_PARAMS", `Unknown runtime '${entry.extends}'`, { details: { path: `${path}.extends` } });
        if (entry.extends === "acp" && !entry.command) throw new ProtocolError("INVALID_PARAMS", "A custom ACP runtime needs a command.", { details: { path: `${path}.command` } });
        if (!entry.label) throw new ProtocolError("INVALID_PARAMS", "A custom runtime needs a label.", { details: { path: `${path}.label` } });
        if (entry.extends !== "acp") profiles += 1;
        added += 1;
      }
      for (const [name, value] of Object.entries(entry.env ?? {})) {
        if (typeof value === "string" && CREDENTIAL_PATTERN.test(value)) {
          throw new ProtocolError("INVALID_PARAMS", "Store this value as a secret and reference it", { details: { path: `${path}.env.${name}` } });
        }
      }
    }
    // A CLI is set to run on a key or an endpoint only when it can. Only a sign-in this change sets is checked: one set
    // before whose key was removed since keeps its runtime unready, and does not block other changes.
    for (const runtime of resolveRuntimes(next)) {
      const signIn = runtime.entry?.signIn;
      if (!signIn || signIn.kind === "cli" || JSON.stringify(signIn) === JSON.stringify(config.entries[runtime.id]?.signIn)) continue;
      const id = signIn.kind === "key" ? signIn.providerId : signIn.endpointId;
      const option = deps.access?.options(runtime).find((candidate) => candidate.kind === signIn.kind && candidate.id === id);
      if (!option) throw new ProtocolError("INVALID_PARAMS", signIn.kind === "key" ? "No key of this provider is stored on this host." : "No such endpoint.", { details: { path: `entries.${runtime.id}.signIn` } });
      if (!option.usable) throw new ProtocolError("INVALID_PARAMS", option.reason ?? `${runtime.label} cannot run on ${option.label}.`, { details: { path: `entries.${runtime.id}.signIn` } });
    }
    if (profiles > RUNTIME_LIMITS.customProfiles) throw new ProtocolError("QUOTA_EXCEEDED", "You can have up to 20 custom profiles", { details: { limit: "customProfiles", max: RUNTIME_LIMITS.customProfiles } });
    if (added > RUNTIME_LIMITS.addedRuntimes) throw new ProtocolError("QUOTA_EXCEEDED", "You can add up to 40 runtimes", { details: { limit: "addedRuntimes", max: RUNTIME_LIMITS.addedRuntimes } });
  }

  function update(raw: unknown, connection: Connection): { config: RuntimesConfig } {
    const params = parse(runtimeConfigUpdateParams, raw);
    if (params.expectedRevision !== config.revision) {
      throw new ProtocolError("CONFLICT", "Settings changed on another device", { details: { currentRevision: config.revision } });
    }
    const entries = { ...config.entries, ...params.patch.entries };
    for (const id of params.removeRuntimeIds ?? []) {
      if (isDefaultRuntimeId(id)) throw new ProtocolError("INVALID_PARAMS", "Built-in runtimes cannot be removed, only disabled.", { details: { path: `removeRuntimeIds.${id}` } });
      const references = deps.referencesTo(id);
      if (references.length) throw new ProtocolError("CONFLICT", "This runtime is still used.", { details: { references } });
      delete entries[id];
    }
    const { entries: _entries, ...rest } = params.patch;
    const next: RuntimesConfig = { ...config, ...rest, entries, revision: config.revision + 1 };
    validate(next);
    const changed = [...new Set([...Object.keys(params.patch.entries ?? {}), ...(params.removeRuntimeIds ?? [])])];
    deps.config.set("runtimes", next);
    config = next;
    runtimes = resolveRuntimes(config);
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "runtime.config.update", { revision: next.revision, runtimeIds: changed, removed: params.removeRuntimeIds ?? [] });
    // A changed entry is re-probed in every cached scope and keeps what it last showed until the probe settles.
    for (const [scopeKey, scope] of scopes) {
      for (const id of changed) {
        const runtime = runtimeById(id);
        const previous = scope.entries.get(id);
        if (!runtime) scope.entries.delete(id);
        else scope.entries.set(id, initialEntry(runtime, previous));
        if (runtime?.enabled) void probe(scopeKey, id);
      }
    }
    announce(GLOBAL_SCOPE, changed.length ? changed : runtimes.map((runtime) => runtime.id));
    deps.onConfigChanged();
    return { config: next };
  }

  // ---- snapshot ----

  function announce(scope: string, runtimeIds: string[]): void {
    deps.broadcast("jagentchill.config.read", "jagentchill.runtime.updated", "runtime", { scope, runtimeIds }, (connection) => subscribers.has(connection));
  }

  function featuresOf(models: ModelEntry[]): RuntimeFeature[] {
    const features: RuntimeFeature[] = [];
    if (models.some((model) => model.supportsFastMode)) {
      features.push({ type: "select", id: "fast_mode", label: "Fast mode", value: "off", options: [{ id: "off", label: "Off" }, { id: "on", label: "On" }, { id: "auto", label: "Auto" }] });
    }
    features.push({ type: "select", id: "usage_footer", label: "Usage footer", value: "off", options: [{ id: "off", label: "Off" }, { id: "tokens", label: "Tokens" }, { id: "full", label: "Full" }] });
    return features;
  }

  function initialEntry(runtime: ResolvedRuntime, previous?: RuntimeSnapshotEntry): RuntimeSnapshotEntry {
    const { modes, defaultModeId } = modesOf(runtime);
    const models = previous?.models ?? [];
    return {
      runtimeId: runtime.id, kind: runtime.kind, source: runtime.source, status: runtime.enabled ? "loading" : "unavailable", enabled: runtime.enabled, order: runtime.order,
      label: runtime.label, description: runtime.description, ...(runtime.descriptionCode ? { descriptionCode: runtime.descriptionCode } : {}), gatewayTarget: runtime.driver, defaultModeId, modes, features: featuresOf(models), models,
      capabilities: runtime.capabilities, install: runtime.install, requiresFullAccess: runtime.requiresFullAccess,
      ...(runtime.signInHint ? { signInHint: runtime.signInHint } : {}), ...signInOf(runtime, previous),
      ...(previous?.binary ? { binary: previous.binary } : {}), ...(previous?.login ? { login: previous.login } : {}),
      ...(previous?.fetched_ms ? { fetched_ms: previous.fetched_ms, stale: true } : {}),
    };
  }

  /** The sign-in a runtime runs on and the keys and endpoints it could, as its snapshot shows them. */
  function signInOf(runtime: ResolvedRuntime, previous?: RuntimeSnapshotEntry): Pick<RuntimeSnapshotEntry, "signIn" | "signInOptions"> {
    const signIn = runtime.entry?.signIn;
    const options = deps.access?.options(runtime) ?? [];
    if (!signIn || signIn.kind === "cli") return options.length ? { signInOptions: options } : {};
    const id = signIn.kind === "key" ? signIn.providerId : signIn.endpointId;
    const label = options.find((option) => option.kind === signIn.kind && option.id === id)?.label ?? (previous?.signIn?.kind === signIn.kind ? previous.signIn.label : id);
    return { signIn: { ...signIn, label }, signInOptions: options };
  }

  function scopeOf(key: string): ScopeState {
    let scope = scopes.get(key);
    if (!scope) {
      // Directory scopes are bounded; the least recently read one goes first. `global` is never evicted.
      const directories = [...scopes].filter(([name]) => name !== GLOBAL_SCOPE);
      if (key !== GLOBAL_SCOPE && directories.length >= RUNTIME_LIMITS.snapshotScopes) {
        directories.sort((a, b) => a[1].read_ms - b[1].read_ms);
        scopes.delete(directories[0][0]);
      }
      scopes.set(key, (scope = { entries: new Map(), read_ms: deps.now() }));
    }
    scope.read_ms = deps.now();
    return scope;
  }

  /** Returns what is cached at once; entries never probed in this scope are `loading` and their probes start now. */
  function snapshot(cwd?: string): RuntimeSnapshotEntry[] {
    const key = cwd ?? GLOBAL_SCOPE;
    const scope = scopeOf(key);
    for (const runtime of runtimes) {
      if (scope.entries.has(runtime.id)) continue;
      scope.entries.set(runtime.id, initialEntry(runtime));
      // A disabled runtime is never probed.
      if (runtime.enabled) void probe(key, runtime.id);
    }
    for (const id of scope.entries.keys()) if (!runtimeById(id)) scope.entries.delete(id);
    return runtimes.map((runtime) => scope.entries.get(runtime.id)!);
  }

  /** The models a runtime lists itself (its own catalogue: the Claude manifest, Codex `model/list`, the ACP agent's default). */
  async function discover(runtime: ResolvedRuntime, signal: AbortSignal): Promise<ModelEntry[]> {
    const client = deps.clients(runtime, cliCommandOf(runtime));
    if (!client) return [];
    const timeout = new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("The runtime did not list its models in time.")), CATALOGUE_TIMEOUT_MS); timer.unref(); signal.addEventListener("abort", () => clearTimeout(timer)); });
    const catalogue = await Promise.race([client.catalog(), timeout]);
    const seen = new Set<string>();
    return catalogue.models.flatMap((model): ModelEntry[] => {
      if (seen.has(model.id)) return [];
      seen.add(model.id);
      const thinkingOptions = runtime.capabilities.thinking ? (model.thinkingLevels ?? []).map((level) => ({ id: level.id, label: level.label })) : [];
      return [{
        providerId: runtime.vendorProviderId, modelId: model.id, label: model.label, ...(model.description ? { description: model.description } : {}), isDefault: model.isDefault === true,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), input: model.input ?? ["text"], supportsTools: true, thinkingOptions,
        ...(thinkingOptions.length && model.thinkingDefault ? { defaultThinkingOptionId: model.thinkingDefault } : {}),
        supportsFastMode: model.supportsFastMode === true, readiness: "ready", source: "discovered",
      }];
    });
  }

  /** Configured lists: `models` replaces discovery, `additionalModels` is merged on top by model id. */
  function applyModelOverrides(runtime: ResolvedRuntime, discovered: ModelEntry[]): ModelEntry[] {
    const toEntry = (model: ConfiguredModel, source: ModelEntry["source"]): ModelEntry => ({
      providerId: model.providerId ?? runtime.vendorProviderId, modelId: model.modelId, label: model.label ?? model.modelId,
      ...(model.description ? { description: model.description } : {}), isDefault: model.isDefault === true,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), input: ["text"], supportsTools: true, thinkingOptions: [], supportsFastMode: false,
      readiness: "ready", source,
    });
    let models = runtime.entry?.models ? runtime.entry.models.map((model) => toEntry(model, "configured")) : discovered;
    for (const extra of runtime.entry?.additionalModels ?? []) {
      if (extra.isDefault) models = models.map((model) => ({ ...model, isDefault: false }));
      const existing = models.find((model) => model.modelId === extra.modelId);
      if (existing) {
        Object.assign(existing, {
          ...(extra.label ? { label: extra.label } : {}), ...(extra.description ? { description: extra.description } : {}),
          ...(extra.contextWindow ? { contextWindow: extra.contextWindow } : {}), ...(extra.isDefault !== undefined ? { isDefault: extra.isDefault } : {}),
        });
      } else {
        models.push(toEntry(extra, extra.source === "custom" ? "custom" : "additional"));
      }
    }
    if (models.length && !models.some((model) => model.isDefault)) models[0] = { ...models[0], isDefault: true };
    return models;
  }

  function probe(scopeKey: string, runtimeId: string, opts: { loginOnly?: boolean } = {}): Promise<void> {
    const key = `${scopeKey}\n${runtimeId}`;
    // Concurrent refreshes of one runtime in one scope share one probe.
    const running = inflight.get(key);
    if (running) return running;
    const task = limiter.run(() => runProbe(scopeKey, runtimeId, opts)).finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  async function runProbe(scopeKey: string, runtimeId: string, opts: { loginOnly?: boolean }): Promise<void> {
    const runtime = runtimeById(runtimeId);
    const scope = scopes.get(scopeKey);
    if (!runtime || !scope) return;
    const started = deps.now();
    const previous = scope.entries.get(runtimeId);
    const entry = initialEntry(runtime, previous);
    const trace: ProbeTrace = { searched: [], duration_ms: 0 };
    let step: ProbeStep = "resolve-binary";
    const abort = new AbortController();
    const fail = (status: "error" | "unavailable", error: RuntimeErrorInfo) => Object.assign(entry, { status, error, ...(previous?.models.length ? { stale: true } : {}) });
    const settle = () => {
      trace.duration_ms = deps.now() - started;
      traces.set(runtimeId, trace);
      if (entry.status === "loading") entry.status = "ready";
      if (entry.status === "ready") delete entry.stale;
      scope.entries.set(runtimeId, entry);
      announce(scopeKey, [runtimeId]);
    };
    const deadline = new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), config.probeTimeout_ms);
      timer.unref();
      abort.signal.addEventListener("abort", () => clearTimeout(timer));
    });

    const work = async (): Promise<void> => {
      if (!runtime.enabled) return void fail("unavailable", { code: "runtime/disabled", message: `${runtime.label} is turned off.` });
      const env = launchEnvironment(host.env, {}, deps.secrets.list().map((secret) => secret.name), host.platform);
      // The command of a custom ACP runtime is its own (`command[0]`); the base has no binary of its own.
      const override = runtime.entry?.command?.[0];
      const name = override ?? runtime.binary;
      if (name) {
        trace.searched = searchPath(host, config.extraPath);
        const binary = resolveBinary(name, override ? "override" : "default", host, config.extraPath);
        if (!binary) return void fail("unavailable", { code: "runtime/not-installed", message: `${runtime.label} is not installed on this host.`, step: "resolve-binary" });
        step = "version";
        trace.versionCommand = `${name} --version`;
        const version = await run(binary.path, ["--version"], { env, timeoutMs: VERSION_TIMEOUT_MS, signal: abort.signal });
        // A failing version command leaves the version unknown and changes nothing else.
        const line = version.code === 0 && !version.timedOut ? version.stdout.split("\n")[0].trim().slice(0, 120) : "";
        entry.binary = { ...binary, version: line || null };
        step = "login-check";
        let login: LoginResult = { state: "unknown" };
        if (runtime.statusCommand) {
          const command = `${name} ${runtime.statusCommand.join(" ")}`;
          login = interpretStatus(runtime.base ?? runtime.id, await run(binary.path, runtime.statusCommand, { env, timeoutMs: VERSION_TIMEOUT_MS, signal: abort.signal }), command);
        }
        trace.login = login;
        entry.login = { state: login.state, ...(login.account ? { account: login.account } : {}), checked_ms: deps.now() };
      }
      const signIn = runtime.entry?.signIn;
      if (signIn && signIn.kind !== "cli" && deps.access) {
        // On a stored key or an endpoint the CLI's own sign-in does not matter: its models are those of the key or endpoint.
        step = "catalogue";
        const resolved = deps.access.resolve(runtime, signIn);
        entry.signIn = { ...signIn, label: resolved.label };
        if ("error" in resolved) {
          entry.models = [];
          entry.features = featuresOf([]);
          return void fail("unavailable", { ...resolved.error, step: "login-check" });
        }
        entry.models = resolved.models;
        entry.features = featuresOf(entry.models);
        entry.fetched_ms = deps.now();
        trace.catalogue = `${resolved.models.length} models of ${resolved.label}`;
        return;
      }
      if (opts.loginOnly && previous) {
        // The login-only re-check keeps the catalogue of the last fetch.
        Object.assign(entry, { models: previous.models, features: previous.features, ...(previous.fetched_ms ? { fetched_ms: previous.fetched_ms } : {}) });
        delete entry.stale;
        if (entry.login?.state === "signed_out") fail("unavailable", { code: "runtime/signed-out", message: `Sign in to ${runtime.label} on this host.`, step: "login-check" });
        else if (previous.status !== "loading") Object.assign(entry, { status: previous.status, ...(previous.error ? { error: previous.error } : {}) });
        return;
      }
      step = "catalogue";
      let discovered: ModelEntry[] = [];
      // A replacement list needs no discovery at all; a CLI that is signed out lists nothing usable.
      if (!runtime.entry?.models && entry.login?.state !== "signed_out") {
        discovered = await discover(runtime, abort.signal);
        trace.catalogue = discovered.length ? `${discovered.length} models listed` : "no model listed";
      }
      entry.models = applyModelOverrides(runtime, discovered);
      entry.features = featuresOf(entry.models);
      entry.fetched_ms = deps.now();
      if (entry.login?.state === "signed_out") return void fail("unavailable", { code: "runtime/signed-out", message: `Sign in to ${runtime.label} on this host.`, step: "login-check" });
      if (entry.models.length === 0) return void fail("error", { code: "UNAVAILABLE", message: `${runtime.label} lists no model yet.`, step: "catalogue" });
    };

    try {
      const outcome = await Promise.race([work().then(() => "done" as const), deadline]);
      if (outcome === "timeout") {
        // Aborting removes every process the probe started, with its descendants.
        abort.abort();
        fail("error", { code: "runtime/probe-timeout", message: `Timed out after ${Math.round(config.probeTimeout_ms / 1000)} s while ${STEP_LABEL[step]}`, step });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail("error", { code: err instanceof ProtocolError ? err.code : "UNAVAILABLE", message: deps.secrets.redact(message).slice(0, 300), step });
    } finally {
      abort.abort();
      settle();
    }
  }

  async function refresh(raw: unknown): Promise<{ runtimes: RuntimeSnapshotEntry[] }> {
    const params = parse(snapshotRefreshParams, raw);
    if (params.all) {
      // Keep scope objects alive while probes are in flight. `runProbe` publishes into the scope object it
      // captured when it started; clearing the map here detached that object and left the replacement entries
      // stuck at `loading` when `probe()` shared the old in-flight promise.
      const entries = snapshot();
      await Promise.all(entries.filter((entry) => entry.enabled).map((entry) => probe(GLOBAL_SCOPE, entry.runtimeId)));
      return { runtimes: snapshot() };
    }
    const key = params.cwd ?? GLOBAL_SCOPE;
    const scope = scopeOf(key);
    snapshot(params.cwd);
    const ids = (params.runtimeIds ?? runtimes.map((runtime) => runtime.id)).filter((id) => runtimeById(id)?.enabled);
    await Promise.all(ids.map((id) => {
      const current = scope.entries.get(id);
      const stale = !current?.login || deps.now() - current.login.checked_ms > LOGIN_STALE_MS;
      if (params.loginOnly && !stale) return undefined;
      if (current && !inflight.has(`${key}\n${id}`)) scope.entries.set(id, { ...current, status: "loading" });
      return probe(key, id, { loginOnly: params.loginOnly });
    }));
    return { runtimes: snapshot(params.cwd) };
  }

  /** Waits until the runtime has left `loading` in the global scope and returns its entry. */
  async function settled(runtimeId: string): Promise<RuntimeSnapshotEntry | undefined> {
    const entry = snapshot().find((candidate) => candidate.runtimeId === runtimeId);
    if (entry?.status !== "loading") return entry;
    await probe(GLOBAL_SCOPE, runtimeId);
    return scopes.get(GLOBAL_SCOPE)?.entries.get(runtimeId);
  }

  // ---- selection ----

  /**
   * The pre-call check of every relayed method: the runtime must be enabled and usable and the model must be one it
   * lists. Every editor and admin device may select every runtime the host has turned on. Nothing is sent to the
   * runtime before this passes.
   */
  async function assertSelectable(ref: ModelRef, role: Role | undefined): Promise<{ runtime: ResolvedRuntime; entry: RuntimeSnapshotEntry; model: ModelEntry }> {
    const runtime = runtimeById(ref.runtimeId);
    if (!runtime) throw new ProtocolError("runtime/model-unavailable", `There is no runtime '${ref.runtimeId}' on this host.`, { details: { runtimeId: ref.runtimeId } });
    if (!role || role === "viewer") throw new ProtocolError("SCOPE_DENIED", "Viewers cannot select a runtime.", { details: { requiredRole: "editor" } });
    if (!runtime.enabled) throw new ProtocolError("runtime/disabled", `${runtime.label} is turned off on this host.`, { details: { runtimeId: runtime.id } });
    const entry = await settled(runtime.id);
    if (!entry || entry.status !== "ready") {
      const code = entry?.error?.code ?? "UNAVAILABLE";
      throw new ProtocolError((code.startsWith("runtime/") ? code : "UNAVAILABLE") as never, entry?.error?.message ?? `${runtime.label} is not ready.`, { details: { runtimeId: runtime.id }, retryable: entry?.status === "error" });
    }
    const model = entry.models.find((candidate) => candidate.providerId === ref.providerId && candidate.modelId === ref.modelId);
    if (!model) throw new ProtocolError("runtime/model-unavailable", `${runtime.label} does not list this model.`, { details: { ...ref } });
    if (model.readiness !== "ready" && model.readiness !== "cooldown") {
      throw new ProtocolError(model.readiness === "needs-auth" ? "runtime/signed-out" : "runtime/model-unavailable", "This model cannot be used right now.", { details: { ...ref, readiness: model.readiness } });
    }
    return { runtime, entry, model };
  }

  // ---- model browser, matrix, catalogue, diagnostics ----

  /** Aggregator catalogues served the built-in runtime, which this host no longer has. */
  function modelsSearch(raw: unknown): never {
    const params = parse(modelsSearchParams, raw);
    throw new ProtocolError("UNSUPPORTED_FEATURE", "This provider publishes no catalogue to search. Its models are in the model list.", { details: { providerId: params.providerId } });
  }

  function modelsList(raw: unknown, connection: Connection) {
    const params = parse(modelsListParams, raw);
    const query = params.query?.trim().toLowerCase();
    const role = connection.role();
    const groups = snapshot(params.cwd).filter((entry) => entry.enabled).map((entry) => {
      const byProvider = new Map<string, ModelEntry[]>();
      for (const model of entry.models) {
        const label = deps.providerLabel(model.providerId) ?? model.providerId;
        if (query && ![model.label, model.modelId, label, entry.label].some((text) => text.toLowerCase().includes(query))) continue;
        byProvider.set(model.providerId, [...(byProvider.get(model.providerId) ?? []), model]);
      }
      const readiness: Readiness = entry.status === "loading" ? "loading" : entry.status === "error" ? "error"
        : entry.status === "ready" ? "ready" : entry.error?.code === "runtime/not-installed" ? "needs-install"
        : entry.error?.code === "runtime/signed-out" || entry.error?.code === "runtime/no-provider" ? "needs-auth" : "unsupported";
      return {
        runtimeId: entry.runtimeId, kind: entry.kind, label: entry.label, status: entry.status, readiness, order: entry.order,
        ...(entry.error ? { error: entry.error } : {}), capabilities: entry.capabilities, defaultModeId: entry.defaultModeId, modes: entry.modes, features: entry.features,
        requiresFullAccess: entry.requiresFullAccess,
        providers: [...byProvider].map(([providerId, models]) => ({
          providerId, label: deps.providerLabel(providerId) ?? providerId, connected: models.some((model) => model.readiness === "ready"),
          models: models.map((model) => ({
            ...model, ref: { runtimeId: entry.runtimeId, providerId: model.providerId, modelId: model.modelId },
            capabilities: {
              ...entry.capabilities, jcTools: model.supportsTools ? entry.capabilities.jcTools : "none",
              attachments: {
                image: entry.capabilities.attachments.image && model.input.includes("image"), document: entry.capabilities.attachments.document && model.input.includes("document"),
                audio: entry.capabilities.attachments.audio && model.input.includes("audio"), video: entry.capabilities.attachments.video && model.input.includes("video"),
              },
            },
          })),
        })),
      };
    }).filter((group) => !query || group.providers.length > 0);
    const selection = params.sessionKey ? deps.selectionOf(params.sessionKey, connection) : undefined;
    return {
      groups, ...(selection ? { selection } : {}),
      // Who may choose a runtime here: every device that may use agents; a viewer reads the list only.
      policy: { canSelect: role === "admin" || role === "editor", ...(role === "admin" || role === "editor" ? {} : { reason: "Viewers cannot select a runtime" }) },
    };
  }

  function catalogueList(raw: unknown) {
    const query = parse(catalogueListParams, raw).query?.trim().toLowerCase();
    const targets = BUILTIN_RUNTIMES.filter((runtime) => runtime.driver === "acp" && !runtime.enabledByDefault).map((runtime) => ({
      id: runtime.id, title: runtime.label, description: runtime.description, ...(runtime.descriptionCode ? { descriptionCode: runtime.descriptionCode } : {}), installUrl: runtime.install.docsUrl, group: "gateway-target" as const,
      added: runtimeById(runtime.id)?.enabled === true,
    }));
    return { entries: targets.filter((entry) => !query || [entry.title, entry.id, entry.description].some((text) => text.toLowerCase().includes(query))) };
  }

  async function diagnose(raw: unknown) {
    const { runtimeId } = parse(diagnoseParams, raw);
    const runtime = runtimeById(runtimeId);
    if (!runtime) throw new ProtocolError("NOT_FOUND", "No such runtime.");
    snapshot();
    const scope = scopes.get(GLOBAL_SCOPE)!;
    if (runtime.enabled) {
      scope.entries.set(runtimeId, { ...scope.entries.get(runtimeId)!, status: "loading" });
      await probe(GLOBAL_SCOPE, runtimeId);
    }
    const entry = scope.entries.get(runtimeId)!;
    const trace = traces.get(runtimeId);
    const home = host.env.HOME ?? homedir();
    const tidy = (text: string) => deps.secrets.redact(text.split(home).join("~"));
    type Row = { label: string; value: string; level: "ok" | "warn" | "error" | "info" };
    const rows: Row[] = [
      { label: "Runtime id", value: runtime.id, level: "info" },
      { label: "Driver", value: runtime.driver === "claude" ? "Claude Agent SDK" : runtime.driver === "codex" ? "Codex app-server" : `Agent Client Protocol (${[runtime.entry?.command?.[0] ?? runtime.binary ?? "", ...(runtime.entry?.command?.slice(1) ?? runtime.acpArgs ?? [])].join(" ").trim()})`, level: "info" },
    ];
    const commandName = runtime.entry?.command?.[0] ?? runtime.binary;
    if (commandName) {
      rows.push({ label: "Command", value: entry.binary ? `${commandName} → ${tidy(entry.binary.path)} (${entry.binary.source})` : `${commandName} (not found)`, level: entry.binary ? "ok" : "error" });
      rows.push({ label: "Executable", value: entry.binary ? "yes" : "no", level: entry.binary ? "ok" : "error" });
      rows.push({ label: "Version", value: entry.binary?.version ? `${trace?.versionCommand}: ${entry.binary.version}` : "not reported", level: entry.binary?.version ? "ok" : "warn" });
      rows.push({ label: "PATH directories searched", value: String(trace?.searched.length ?? 0), level: "info" });
      const login = trace?.login;
      const how = login?.command ? ` (${login.command}, exit ${login.exitCode})` : "";
      rows.push({
        label: "Login", value: `${(entry.login?.state ?? "unknown").replace("_", " ")}${entry.login?.account ? ` as ${entry.login.account}` : ""}${how}`,
        level: entry.login?.state === "signed_in" ? "ok" : entry.login?.state === "signed_out" ? "error" : "warn",
      });
    }
    rows.push({ label: "Catalogue", value: trace?.catalogue ?? "not read", level: "info" });
    rows.push({ label: "Models", value: String(entry.models.length), level: entry.models.length ? "ok" : "warn" });
    rows.push({ label: "Modes", value: entry.modes.filter((mode) => mode.supported).map((mode) => mode.id).join(", "), level: "info" });
    for (const [flag, value] of Object.entries(entry.capabilities)) rows.push({ label: `Capability ${flag}`, value: typeof value === "object" ? JSON.stringify(value) : String(value), level: "info" });
    rows.push({ label: "Environment", value: Object.keys(runtime.entry?.env ?? {}).join(", ") || "none", level: "info" });
    rows.push({ label: "Status", value: entry.status, level: entry.status === "ready" ? "ok" : entry.status === "loading" ? "info" : "error" });
    if (entry.error) rows.push({ label: "Last error", value: tidy(`${entry.error.code}: ${entry.error.message}${entry.error.step ? ` (step ${entry.error.step})` : ""}`), level: "error" });
    rows.push({ label: "Duration", value: `${trace?.duration_ms ?? 0} ms`, level: "info" });
    const text = [...rows.map((row) => `${row.label}: ${row.value}`), ...(trace?.searched.length ? ["", "PATH:", ...trace.searched.map((dir) => `  ${tidy(dir)}`)] : [])].join("\n").slice(0, RUNTIME_LIMITS.diagnosticsBytes);
    return { text, rows, generated_ms: deps.now() };
  }

  const methods = new Map<string, RpcMethod>();
  const add = (name: string, handle: RpcMethod["handle"]) => methods.set(name, { scope: RUNTIME_METHOD_SCOPES[name], handle });
  add("jagentchill.runtime.install.start", (raw) => startInstall(raw));
  add("jagentchill.runtime.install.status", (raw) => installStatus(raw));
  add("jagentchill.runtime.install.cancel", (raw) => cancelInstall(raw));
  add("jagentchill.runtime.config.get", () => ({ config }));
  add("jagentchill.runtime.config.update", (raw, connection) => update(raw, connection));
  add("jagentchill.runtime.snapshot.get", (raw) => ({ runtimes: snapshot(parse(snapshotGetParams, raw).cwd) }));
  add("jagentchill.runtime.snapshot.refresh", (raw) => refresh(raw));
  add("jagentchill.runtime.diagnose", (raw) => diagnose(raw));
  add("jagentchill.runtime.catalogue.list", (raw) => catalogueList(raw));
  add("jagentchill.runtime.models.list", (raw, connection) => modelsList(raw, connection));
  add("jagentchill.runtime.models.search", (raw) => modelsSearch(raw));
  add("jagentchill.runtime.matrix.get", (raw) => {
    parse(emptyParams, raw);
    return { runtimes: Object.fromEntries(runtimes.filter((runtime) => runtime.enabled).map((runtime) => [runtime.id, { label: runtime.label, flags: runtime.capabilities, requiresFullAccess: runtime.requiresFullAccess }])) };
  });
  add("jagentchill.runtime.subscribe", (raw, connection) => {
    parse(emptyParams, raw);
    subscribers.add(connection);
    return { stream: "runtime" };
  });
  add("jagentchill.runtime.unsubscribe", (raw, connection) => {
    parse(emptyParams, raw);
    subscribers.delete(connection);
  });

  return {
    methods,
    config: () => config,
    runtimes: () => runtimes,
    runtime: runtimeById,
    /** Home chosen by the host environment (replaceable by the runtime probe test seam). */
    homeDirectory: (): string => host.env.HOME ?? homedir(),
    snapshot,
    settled,
    assertSelectable,
    probePeak: () => limiter.peak,
    /** The installed command of a CLI runtime and the environment the server starts it in; undefined when it is not installed. */
    cliCommand(runtimeId: string, overlay: Record<string, string> = {}): { path: string; env: Record<string, string>; label: string } | undefined {
      const runtime = runtimeById(runtimeId);
      return runtime ? cliCommandOf(runtime, overlay) : undefined;
    },
    /** Asks the CLI's own status command whether it is signed in. No credential file is opened. */
    async cliLoginState(runtimeId: string): Promise<LoginResult> {
      const runtime = runtimeById(runtimeId);
      const command = this.cliCommand(runtimeId);
      if (!runtime?.statusCommand || !command) return { state: "unknown" };
      return interpretStatus(runtime.base ?? runtime.id, await run(command.path, runtime.statusCommand, { env: command.env, timeoutMs: VERSION_TIMEOUT_MS }), `${runtime.binary} ${runtime.statusCommand.join(" ")}`);
    },
    /** Runs one short command of the CLI (its own sign-out). */
    async cliRun(runtimeId: string, args: string[]): Promise<CommandResult | undefined> {
      const command = this.cliCommand(runtimeId);
      return command ? await run(command.path, args, { env: command.env, timeoutMs: 20_000 }) : undefined;
    },
    /** A no-op command for `BROWSER`, so a CLI that opens the host's browser by itself does not; undefined where there is none. */
    noopCommand: (): string | undefined => (host.platform === "win32" ? undefined : resolveBinary("true", "default", { platform: host.platform, env: { PATH: "/usr/bin:/bin" } })?.path),
    /** A turn failed on a credential, or the CLI was signed in or out from the app: that runtime is probed again. */
    reprobe(runtimeId: string): Promise<void> {
      const scope = scopes.get(GLOBAL_SCOPE);
      const current = scope?.entries.get(runtimeId);
      if (!scope || !current) return Promise.resolve();
      scope.entries.set(runtimeId, { ...current, status: "loading" });
      return probe(GLOBAL_SCOPE, runtimeId);
    },
    /**
     * A stored key or an endpoint was added, changed or removed: every runtime shows what it can run on now, and the
     * ones that run on a key or an endpoint read their models again.
     */
    accessChanged(): void {
      const changed = new Set<string>();
      for (const [scopeKey, scope] of scopes) {
        for (const [id, current] of scope.entries) {
          const runtime = runtimeById(id);
          if (!runtime) continue;
          const { signIn: _signIn, signInOptions: _options, ...rest } = current;
          scope.entries.set(id, { ...rest, ...signInOf(runtime, current) });
          changed.add(id);
          if (runtime.enabled && runtime.entry?.signIn && runtime.entry.signIn.kind !== "cli") void probe(scopeKey, id);
        }
      }
      if (changed.size) announce(GLOBAL_SCOPE, [...changed]);
    },
    dropConnection: (connection: Connection) => void subscribers.delete(connection),
    /** `jagentchill.runtime.subscribe` opens the host's settings streams: `runtime`, `provider` and `orc`. */
    isSubscribed: (connection: Connection) => subscribers.has(connection),
  };
}

export type RuntimeService = ReturnType<typeof createRuntimeService>;
