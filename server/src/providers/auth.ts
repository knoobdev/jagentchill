import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  RUNTIME_LIMITS, RUNTIME_METHOD_SCOPES, authListParams, authLogoutParams, authSetApiKeyParams, authTestParams, loginIdParams, loginNextParams, loginStartParams, loginTransferParams,
  type AuthChoice, type AuthProfile, type LoginStep, type ProfileHealth, type ProviderListing, type Scope,
} from "@jagentchill/protocol";
import type { RateLimiter } from "../channel/rate-limit.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import type { SecretStore } from "../secrets/store.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import type { CommandResult, LoginResult } from "../runtimes/probe.ts";
import { PROVIDER_DATA, providerById, providerGroupOf, type ProviderData } from "./catalogue.ts";
import { KEY_PROVIDERS, keyRuntimes, type KeyModel, type KeyProvider } from "./cli-access.ts";
import { parseModelList } from "./endpoint-client.ts";
import { loginArguments, logoutArguments, startCliLogin, type SignInHost, type SignInSession, type SpawnLogin } from "./cli-login.ts";
import type { HttpFetch } from "./http.ts";
import { OAuthError, OPENROUTER_CALLBACK_PATH, createPkce, openRouterAuthorizeUrl, openRouterExchange, readPastedCode } from "./oauth.ts";
import { PRODUCT_SIGN_INS, SIGN_IN_NOTES, SIGN_IN_PROVIDERS, productSignIn, signInReplacement, type ProductSignIn } from "./sign-in-policy.ts";
import type { StoredKeyView } from "./runtime-access.ts";

export { OPENROUTER_CALLBACK_PATH };

const LOGIN_TTL_MS = 600_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** How long `login.next` waits for a step the host is working on itself to change before it answers with the same step. */
const STEP_WAIT_MS = 20_000;

/** The answers of the methods whose feature left the product with the built-in runtime: an old app gets a clean refusal. */
const NO_KEY_HERE = "No agent CLI on this host runs on a key of this provider.";
const NO_ORDER = "Accounts are no longer ordered: a provider has one key, and each CLI chooses which sign-in it runs on.";
const NO_OVERRIDE = "Provider addresses are not changed here: add a custom endpoint and choose it for a CLI.";
const ONLY_CLI = "Only the agent CLIs on this host and OpenRouter sign in from the app.";
const KEY_TIMEOUT_MS = 20_000;
/** The secret a key from OpenRouter's sign-in is stored under. */
const OPENROUTER_OAUTH_SECRET = "OPENROUTER_OAUTH_KEY";
/** How many models of a key are kept for the model list. */
const KEY_MODELS = 500;

type CliSignIn = ProductSignIn & { driver: { type: "cli" } };
/** A provider key stored on this host: the value is a host secret; this is everything else about it. */
type StoredKey = { secretName: string; label: string; via: "api-key" | "oauth"; created_ms: number; health: ProfileHealth; checked_ms?: number; models: KeyModel[] };
type Login = {
  loginId: string; providerId: string; choiceId: string; ownerDeviceId: string; started_ms: number; step: LoginStep; ended: boolean;
  /** The vendor CLI's sign-in the server runs and relays. */
  session?: SignInSession;
};
/** What the runtime service knows about the vendor CLIs on the host. */
export type CliAccess = {
  command(runtimeId: string, overlay?: Record<string, string>): { path: string; env: Record<string, string>; label: string } | undefined;
  loginState(runtimeId: string): Promise<LoginResult>;
  /** The sign-in the last probe saw, without running anything. */
  lastLogin(runtimeId: string): { state: "signed_in" | "signed_out" | "unknown"; account?: string; checked_ms?: number } | undefined;
  installSteps(runtimeId: string): { steps: string[]; docsUrl?: string };
  run(runtimeId: string, args: string[]): Promise<CommandResult | undefined>;
  noopCommand(): string | undefined;
  reprobe(runtimeId: string): Promise<void>;
};

export type ProviderAuthDeps = {
  db: DatabaseSync;
  /** Where the stored keys are described (never their values: those are host secrets). */
  config: ServerConfigFile;
  secrets: SecretStore;
  devices: DeviceRegistry;
  now: () => number;
  /** Delivery targeted at one device (login steps). */
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  /** Delivery to the connections that opened the settings streams. */
  announce: (scope: Scope, event: string, stream: string, payload: unknown) => void;
  isOnline: (deviceId: string) => boolean;
  mutations: RateLimiter;
  /** Endpoint records listed as providers of the group Custom. */
  endpoints: () => Array<{ id: string; label: string; enabled: boolean; projected: boolean }>;
  /** A provider was signed in or out: the runtime catalogue and the ORC defaults follow. */
  onChanged: (providerId: string) => Promise<void> | void;
  cli: CliAccess;
  spawnLogin: SpawnLogin;
  /** The server's outbound HTTP (the model list of a key; OpenRouter's sign-in). */
  http: HttpFetch;
  /** `http://127.0.0.1:<port>` of this server, for a sign-in that returns to it; undefined while it is not listening. */
  callbackOrigin: () => string | undefined;
  /** Replaced in tests, where a step the host works on must not hold a call for seconds. */
  stepWaitMs?: number;
};

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  // An unknown field is refused like any other mismatch.
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}

/** A 26-character upper-case ULID: 48 bits of time, 80 of randomness. */
export function ulid(now: number): string {
  let time = "";
  for (let i = 0, value = now; i < 10; i++, value = Math.floor(value / 32)) time = CROCKFORD[value % 32] + time;
  const random = [...randomBytes(16)].map((byte) => CROCKFORD[byte % 32]).join("");
  return time + random;
}

const cliChoices = (providerId: string): CliSignIn[] => (PRODUCT_SIGN_INS[providerId] ?? []).filter((choice): choice is CliSignIn => choice.driver.type === "cli");
const cliProfileId = (runtimeId: string) => `${runtimeId}:cli`;
const keyProfileId = (providerId: string) => `${providerId}:api-key`;

type KeyCheck = { outcome: "ok"; models: KeyModel[] } | { outcome: "auth" | "unreachable" | "format" };
/**
 * Asks the provider for its model list with the key: the key check that generates nothing (no model is run and nothing
 * is spent), and the models the CLIs are offered on it. The key goes only into the request's header.
 */
export async function checkKey(http: HttpFetch, provider: KeyProvider, key: string): Promise<KeyCheck> {
  const auth: Record<string, string> = provider.models.auth === "bearer" ? { authorization: `Bearer ${key}` } : { [provider.models.auth]: key };
  const path = provider.providerId === "anthropic" ? `${provider.models.path}?limit=1000` : provider.providerId === "google" ? `${provider.models.path}?pageSize=1000` : provider.models.path;
  let status: number;
  let body: string;
  try {
    const response = await http(`${provider.baseUrl}${path}`, { headers: { accept: "application/json", ...provider.models.headers, ...auth }, signal: AbortSignal.timeout(KEY_TIMEOUT_MS) });
    status = response.status;
    body = await response.text();
  } catch {
    return { outcome: "unreachable" };
  }
  if (status === 401 || status === 403) return { outcome: "auth" };
  if (status < 200 || status >= 300) return { outcome: status >= 500 || status === 429 ? "unreachable" : "format" };
  const listed = parseModelList(body);
  if (!listed) return { outcome: "format" };
  const keep = provider.models.keep ?? (() => true);
  const models = listed.filter((model) => keep(model.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, KEY_MODELS)
    .map((model): KeyModel => ({ id: model.id, label: model.label, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), ...(model.input ? { input: model.input } : {}) }));
  return { outcome: "ok", models };
}

/**
 * Provider access through the server: the sign-in of each vendor CLI on the host, started from the app and relayed to
 * the device that asked. The credential stays in the CLI's own store; the server keeps none.
 */
export function createProviderAuth(deps: ProviderAuthDeps) {
  const logins = new Map<string, Login>();
  /** What a CLI's status command said when a sign-in or sign-out through the app just ended, until the next probe has it. */
  const cliLogins = new Map<string, { state: "signed_in" | "signed_out"; account?: string; at: number }>();
  /** When a turn last failed on a CLI's sign-in, until a newer check of that CLI. */
  const authFailures = new Map<string, number>();

  const cliLoginOf = (runtimeId: string): { state: "signed_in" | "signed_out" | "unknown"; account?: string; at: number } | undefined => {
    const checked = deps.cli.lastLogin(runtimeId);
    const probed = checked ? { state: checked.state, ...(checked.account ? { account: checked.account } : {}), at: checked.checked_ms ?? 0 } : undefined;
    // A runtime probe asks the vendor CLI again. Its current answer must replace the short-lived result of an app
    // sign-in; otherwise an expired/revoked CLI login keeps appearing as signed in for two minutes after Refresh.
    const recent = cliLogins.get(runtimeId);
    if (probed && probed.state !== "unknown" && (!recent || probed.at > recent.at)) return probed;
    return recent && deps.now() - recent.at < 120_000 ? recent : probed;
  };

  function providerOrThrow(providerId: string): ProviderData {
    const provider = providerById(providerId);
    if (!provider) throw new ProtocolError("NOT_FOUND", "No such provider.");
    return provider;
  }

  // ---- keys stored on the host ----

  const storedKeys = (): Record<string, StoredKey> => deps.config.get<Record<string, StoredKey>>("providerKeys") ?? {};
  function rememberKey(providerId: string, value: StoredKey | undefined): void {
    const { [providerId]: _old, ...rest } = storedKeys();
    deps.config.set("providerKeys", value ? { ...rest, [providerId]: value } : rest);
  }

  /** The CLI sign-ins of a provider, read from each CLI's status command, and its stored key. */
  function profilesOf(provider: ProviderData): AuthProfile[] {
    const profiles: AuthProfile[] = [];
    for (const choice of cliChoices(provider.providerId)) {
      const runtimeId = choice.driver.runtimeId;
      const profileId = cliProfileId(runtimeId);
      const login = cliLoginOf(runtimeId);
      if (login?.state !== "signed_in" || profiles.some((profile) => profile.profileId === profileId)) continue;
      const failed = (authFailures.get(runtimeId) ?? 0) > login.at;
      profiles.push({
        profileId, label: choice.label, type: "cli-login", choiceId: choice.choiceId, ...(login.account ? { account: login.account } : {}),
        health: failed ? "auth_failed" : "ok", ...(login.at ? { lastProbe_ms: login.at } : {}), order: profiles.length,
      });
    }
    const key = storedKeys()[provider.providerId];
    if (key && deps.secrets.has(key.secretName)) {
      const hint = deps.secrets.hint(key.secretName);
      profiles.push({
        profileId: keyProfileId(provider.providerId), label: key.label, type: key.via === "oauth" ? "oauth" : "api-key", choiceId: key.via === "oauth" ? "openrouter-oauth" : keyChoice(provider)?.choiceId ?? `${provider.providerId}-api-key`,
        ...(hint ? { keyHint: hint.replace(/^•+/, "") } : {}), health: key.health, ...(key.checked_ms ? { lastProbe_ms: key.checked_ms } : {}), order: profiles.length,
      });
    }
    return profiles;
  }

  /** A sign-in the product performs itself (a vendor CLI's own, or OpenRouter's under this app's identity), as a choice of the list. */
  function productChoice(choice: ProductSignIn): AuthChoice {
    const base = { choiceId: choice.choiceId, kind: choice.kind, label: choice.label, hint: choice.hint, method: choice.method, appDriven: true, identity: choice.identity };
    if (choice.driver.type !== "cli") return { ...base, available: true };
    const command = deps.cli.command(choice.driver.runtimeId);
    if (!command) {
      const install = deps.cli.installSteps(choice.driver.runtimeId);
      return { ...base, available: false, unavailableReason: `Install ${choice.identity} on the host first`, setup: { reason: "needs-install", ...install } };
    }
    const login = cliLoginOf(choice.driver.runtimeId);
    return { ...base, available: true, signedIn: login?.state === "signed_in", ...(login?.state === "signed_in" && login.account ? { account: login.account } : {}) };
  }

  /** The key choice of a provider a CLI can run on. */
  function keyChoice(provider: ProviderData): AuthChoice | undefined {
    if (!KEY_PROVIDERS[provider.providerId]) return undefined;
    const listed = provider.choices.find((choice) => choice.kind === "api-key" && choice.provider === provider.providerId) ?? provider.choices.find((choice) => choice.kind === "api-key");
    return {
      choiceId: listed?.choiceId ?? `${provider.providerId}-api-key`, kind: "api-key", method: "api-key", label: listed?.label ?? "API key", available: true,
      hint: `Used by ${keyRuntimes(provider.providerId).join(", ")} when a CLI is set to run on it.`,
    };
  }

  /** The providers a CLI on the host signs in to or runs on with a key, then the custom endpoints. */
  function list(raw: unknown): { providers: ProviderListing[]; counts: typeof PROVIDER_DATA.counts } {
    const query = parse(authListParams, raw).query?.trim().toLowerCase();
    const providers: ProviderListing[] = [];
    for (const providerId of new Set([...Object.keys(PRODUCT_SIGN_INS), ...Object.keys(KEY_PROVIDERS)])) {
      const provider = providerById(providerId);
      if (!provider) continue;
      const profiles = profilesOf(provider);
      const text = SIGN_IN_PROVIDERS[providerId];
      const key = keyChoice(provider);
      // The three ways in a fixed order: the vendor's CLI, a sign-in as this app, an API key.
      const rank = (choice: AuthChoice) => (choice.method === "cli" ? 0 : choice.method === "oauth" ? 1 : 2);
      const choices = [...(PRODUCT_SIGN_INS[providerId] ?? []).map(productChoice), ...(key ? [key] : [])].sort((a, b) => rank(a) - rank(b));
      providers.push({
        providerId: provider.providerId, label: provider.label, description: text?.description ?? `API key for ${keyRuntimes(providerId).join(", ")}`, docsUrl: text?.docsUrl ?? "", group: providerGroupOf(provider),
        choices, connected: profiles.some((profile) => !["auth_failed", "expired"].includes(profile.health)), profiles,
        pluginAllowed: true, overrideActive: false, ...(SIGN_IN_NOTES[providerId] ? { signInNote: SIGN_IN_NOTES[providerId] } : {}),
      });
    }
    for (const endpoint of deps.endpoints()) {
      providers.push({
        providerId: endpoint.id, label: endpoint.label, description: "Custom endpoint", docsUrl: "", group: "custom",
        choices: [{ choiceId: "custom-endpoint", kind: "custom-endpoint", label: "Custom endpoint", available: true }], connected: endpoint.projected, profiles: [], pluginAllowed: true, overrideActive: false,
      });
    }
    const matches = (provider: ProviderListing) => !query || [provider.label, provider.providerId, provider.group].some((text) => text.toLowerCase().includes(query));
    // Connected providers first, then by name; the app groups by `group`.
    return { providers: providers.filter(matches).sort((a, b) => Number(b.connected) - Number(a.connected) || a.label.localeCompare(b.label)), counts: PROVIDER_DATA.counts };
  }

  async function changed(providerId: string): Promise<void> {
    await deps.onChanged(providerId);
    deps.announce("jagentchill.config.read", "jagentchill.provider.changed", "provider", { providerId });
  }

  type KeyConnection = { providerId: string; secretName: string; label?: string; via: "api-key" | "oauth"; saveAnyway?: boolean; deviceId: string };

  /**
   * Stores the key named by a secret for a provider and says whether it works. The check lists the provider's models
   * with it: nothing is generated, so connecting a key spends nothing. A rejected key is deleted from the host.
   */
  async function connectKey(params: KeyConnection) {
    const provider = providerOrThrow(params.providerId);
    const target = KEY_PROVIDERS[provider.providerId];
    if (!target) throw new ProtocolError("UNSUPPORTED_FEATURE", NO_KEY_HERE, { details: { providerId: provider.providerId } });
    const key = deps.secrets.read(params.secretName);
    if (key === undefined) throw new ProtocolError("NOT_FOUND", "The secret does not exist on this host. Send the key over the secret route first.", { details: { secretName: params.secretName } });
    if (Buffer.byteLength(key) < 8) throw new ProtocolError("INVALID_PARAMS", "A key is at least 8 characters.", { details: { path: "secretName" } });
    const profileId = keyProfileId(provider.providerId);
    const note = (outcome: string) => audit(deps.db, deps.now(), `device:${params.deviceId}`, "provider.auth.connect", { providerId: provider.providerId, profileId, outcome });
    const check = await checkKey(deps.http, target, key);
    if (check.outcome === "auth") {
      deps.secrets.delete(params.secretName);
      note("rejected");
      throw new ProtocolError("runtime/auth-failed", "The provider rejected this key", { details: { providerId: provider.providerId } });
    }
    if (check.outcome !== "ok" && !params.saveAnyway) {
      note("unreachable");
      throw new ProtocolError("UNAVAILABLE", check.outcome === "format" ? "Unexpected response from the provider" : "Unable to reach the provider", { retryable: true, details: { providerId: provider.providerId, canSaveAnyway: check.outcome === "unreachable" } });
    }
    const previous = storedKeys()[provider.providerId];
    // One key per provider: a new one replaces the old, whose secret is not kept.
    if (previous && previous.secretName !== params.secretName) deps.secrets.delete(previous.secretName);
    const health: ProfileHealth = check.outcome === "ok" ? "ok" : "unknown";
    const label = params.label ?? (params.via === "oauth" ? `${target.label} sign-in` : `${target.label} API key`);
    rememberKey(provider.providerId, {
      secretName: params.secretName, label, via: params.via, created_ms: previous?.created_ms ?? deps.now(), health, checked_ms: deps.now(),
      models: check.outcome === "ok" ? check.models : previous?.models ?? [],
    });
    note(health);
    await changed(provider.providerId);
    const hint = deps.secrets.hint(params.secretName);
    return {
      connected: true, models: check.outcome === "ok" ? check.models.length : 0,
      profile: { profileId, label, type: params.via === "oauth" ? "oauth" : "api-key", health, ...(hint ? { keyHint: hint.replace(/^•+/, "") } : {}), lastProbe_ms: deps.now(), order: 0 } satisfies AuthProfile,
    };
  }

  /**
   * Stores a key. The value was written to the host over the signed secret route; this call names it. It never returns
   * the key, and the key is not a parameter of any channel frame.
   */
  function setApiKey(raw: unknown, connection: Connection) {
    const params = parse(authSetApiKeyParams, raw);
    const provider = providerOrThrow(params.providerId);
    if (!KEY_PROVIDERS[provider.providerId]) throw new ProtocolError("UNSUPPORTED_FEATURE", NO_KEY_HERE, { details: { providerId: provider.providerId } });
    return connectKey({
      providerId: provider.providerId, secretName: params.secretName, via: "api-key", deviceId: connection.deviceId,
      ...(params.profileLabel ? { label: params.profileLabel } : {}), ...(params.saveAnyway ? { saveAnyway: true } : {}),
    });
  }

  /** Asks a CLI's own status command whether its sign-in still holds, or the provider whether a stored key does. */
  async function testProfile(raw: unknown, connection: Connection) {
    const params = parse(authTestParams, raw);
    const provider = providerOrThrow(params.providerId);
    if (params.profileId === keyProfileId(provider.providerId)) {
      const stored = storedKeys()[provider.providerId];
      const value = stored ? deps.secrets.read(stored.secretName) : undefined;
      const target = KEY_PROVIDERS[provider.providerId];
      if (!stored || value === undefined || !target) throw new ProtocolError("NOT_FOUND", "No such sign-in.");
      const check = await checkKey(deps.http, target, value);
      const health: ProfileHealth = check.outcome === "ok" ? "ok" : check.outcome === "auth" ? "auth_failed" : "unknown";
      rememberKey(provider.providerId, { ...stored, health, checked_ms: deps.now(), ...(check.outcome === "ok" ? { models: check.models } : {}) });
      audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.test", { providerId: provider.providerId, profileId: params.profileId, outcome: check.outcome });
      await changed(provider.providerId);
      return { profileId: params.profileId, result: check.outcome, health, tested_ms: deps.now() };
    }
    const choice = cliChoices(provider.providerId).find((candidate) => cliProfileId(candidate.driver.runtimeId) === params.profileId);
    if (!choice) throw new ProtocolError("NOT_FOUND", "No such sign-in.");
    const runtimeId = choice.driver.runtimeId;
    const state = await deps.cli.loginState(runtimeId).catch((): LoginResult => ({ state: "unknown" }));
    if (state.state !== "unknown") {
      cliLogins.set(runtimeId, { state: state.state, ...(state.account ? { account: state.account } : {}), at: deps.now() });
      authFailures.delete(runtimeId);
    }
    const outcome = state.state === "signed_in" ? "ok" : state.state === "signed_out" ? "auth" : "unknown";
    const health: ProfileHealth = outcome === "ok" ? "ok" : outcome === "auth" ? "auth_failed" : "unknown";
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.test", { providerId: provider.providerId, profileId: params.profileId, outcome });
    if (state.state === "signed_out") await changed(provider.providerId);
    return { profileId: params.profileId, result: outcome, health, tested_ms: deps.now() };
  }

  async function logout(raw: unknown, connection: Connection) {
    const params = parse(authLogoutParams, raw);
    const provider = providerOrThrow(params.providerId);
    const removed: string[] = [];
    // A vendor CLI is signed out with its own command, and only when its profile is named: "remove all" leaves the CLI alone.
    for (const runtimeId of new Set(cliChoices(provider.providerId).map((choice) => choice.driver.runtimeId))) {
      const profileId = cliProfileId(runtimeId);
      if (!params.profileIds?.includes(profileId)) continue;
      const result = await deps.cli.run(runtimeId, logoutArguments(runtimeId));
      if (!result || result.code !== 0) throw new ProtocolError("UNAVAILABLE", "The CLI on the host did not sign out.", { details: { runtimeId } });
      cliLogins.set(runtimeId, { state: "signed_out", at: deps.now() });
      authFailures.delete(runtimeId);
      void deps.cli.reprobe(runtimeId).catch(() => undefined);
      removed.push(profileId);
    }
    // A stored key goes with "remove all" or when its profile is named: the secret is deleted from the host.
    const key = storedKeys()[provider.providerId];
    if (key && (!params.profileIds || params.profileIds.includes(keyProfileId(provider.providerId)))) {
      deps.secrets.delete(key.secretName);
      rememberKey(provider.providerId, undefined);
      removed.push(keyProfileId(provider.providerId));
    }
    // Removal is recorded by profile id only.
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.logout", { providerId: provider.providerId, profileIds: removed });
    await changed(provider.providerId);
    return { removedProfileIds: removed };
  }

  // ---- sign-in of a vendor CLI, run by the server ----

  const secretNameOf = (loginId: string) => `LOGIN_${loginId}`;

  function publish(login: Login): void {
    // Login events reach only the device that owns the login.
    deps.broadcast("jagentchill.config.write", "jagentchill.provider.auth.login.updated", "provider", { loginId: login.loginId, providerId: login.providerId, step: login.step }, (connection) => connection.deviceId === login.ownerDeviceId);
  }

  async function finish(login: Login, step: LoginStep): Promise<void> {
    login.step = step;
    login.ended = true;
    deps.secrets.delete(secretNameOf(login.loginId));
    if (step.kind === "done") {
      audit(deps.db, deps.now(), `device:${login.ownerDeviceId}`, "provider.auth.connect", { providerId: login.providerId, profileId: step.profileId ?? null, outcome: "signed_in" });
      await changed(login.providerId);
    }
    publish(login);
  }

  const waitChange = (login: Login, from: LoginStep, ms: number) => new Promise<void>((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (login.ended || login.step !== from || Date.now() - started >= ms) {
        clearInterval(poll);
        resolve();
      }
    }, 20);
    poll.unref();
  });

  function hostOf(login: Login, onDone?: (step: Extract<LoginStep, { kind: "done" }>) => void): SignInHost {
    return {
      step: () => login.step,
      update: (step) => {
        if (login.ended) return;
        login.step = step;
        publish(login);
      },
      finish: async (step) => {
        if (login.ended) return;
        if (step.kind === "done") onDone?.(step);
        await finish(login, step);
      },
      secretName: secretNameOf(login.loginId), now: deps.now, redact: (text) => deps.secrets.redact(text),
    };
  }

  function startCli(login: Login, choice: CliSignIn, opts: { email?: string; sso?: boolean }): SignInSession {
    const runtimeId = choice.driver.runtimeId;
    const noop = deps.cli.noopCommand();
    // Nothing opens on the host by itself: the address goes to the device that asked. Only the variant the person chose
    // for a browser on the host leaves the CLI free to open one. (Claude Code was seen to honour BROWSER; Codex is given it too.)
    const command = deps.cli.command(runtimeId, { NO_COLOR: "1", ...(choice.driver.flow !== "codex-browser" && noop ? { BROWSER: noop } : {}) })!;
    const host = hostOf(login, (step) => {
      cliLogins.set(runtimeId, { state: "signed_in", ...(step.account ? { account: step.account } : {}), at: deps.now() });
      authFailures.delete(runtimeId);
      void deps.cli.reprobe(runtimeId).catch(() => undefined);
    });
    return startCliLogin(host, {
      flow: choice.driver.flow, label: choice.identity, binary: command.path, args: loginArguments(choice.driver.flow, opts), env: command.env, spawn: deps.spawnLogin,
      profileId: cliProfileId(runtimeId), status: () => deps.cli.loginState(runtimeId),
    });
  }

  // ---- OpenRouter's sign-in under this app's identity: its key is stored like a typed one ----

  /** One-time `state` values of OpenRouter sign-ins waiting for the browser to return to this server. */
  const callbacks = new Map<string, { login: Login; complete: (code: string) => Promise<void> }>();

  const stepError = (err: unknown, fallback: string): LoginStep => ({
    kind: "error", code: err instanceof ProtocolError ? err.code : "runtime/auth-failed",
    message: deps.secrets.redact(err instanceof ProtocolError || err instanceof OAuthError ? err.message || fallback : fallback).slice(0, 300),
  });

  /** OpenRouter's PKCE flow with this server as the app: the code comes back to our callback, or is pasted when the browser cannot reach the host. */
  function startOpenRouter(login: Login, browserOnHost: boolean): SignInSession {
    const pkce = createPkce();
    const origin = deps.callbackOrigin();
    // OpenRouter accepts a localhost callback on any port. Another device's browser cannot reach it: there the page shows the code instead.
    const callbackUrl = browserOnHost && origin ? `http://localhost:${new URL(origin).port}${OPENROUTER_CALLBACK_PATH}` : undefined;
    const host = hostOf(login);
    const paste = (retryReason?: string): LoginStep => ({
      kind: "enter-text", masked: false, secretName: host.secretName, ...(retryReason ? { retryReason } : {}),
      prompt: callbackUrl ? "If the browser did not come back by itself, paste the address it ended on" : "Paste the code OpenRouter shows",
    });
    let busy = false;
    const complete = async (code: string, from: "callback" | "paste") => {
      if (busy || login.ended) return;
      busy = true;
      callbacks.delete(pkce.state);
      host.update({ kind: "progress", message: "Connecting OpenRouter…" });
      let key: string;
      try {
        key = await openRouterExchange(deps.http, { code, verifier: pkce.verifier });
      } catch (err) {
        busy = false;
        // A mistyped code can be pasted again; a code the callback delivered cannot be wrong that way.
        if (from === "paste" && err instanceof OAuthError && err.status === 403) return host.update(paste("OpenRouter did not accept that code. Copy it again, or start over if it is older than ten minutes."));
        return void (await host.finish(stepError(err, "OpenRouter did not complete the sign-in.")));
      }
      try {
        deps.secrets.set(OPENROUTER_OAUTH_SECRET, key);
        key = "";
        const result = await connectKey({ providerId: "openrouter", secretName: OPENROUTER_OAUTH_SECRET, via: "oauth", deviceId: login.ownerDeviceId, saveAnyway: true });
        await host.finish({ kind: "done", profileId: result.profile.profileId });
      } catch (err) {
        await host.finish(stepError(err, "The key could not be connected."));
      }
    };
    if (callbackUrl) callbacks.set(pkce.state, { login, complete: (code) => complete(code, "callback") });
    host.update({
      kind: "open-url", returns: callbackUrl ? "callback" : "paste-code",
      url: openRouterAuthorizeUrl({ ...(callbackUrl ? { callbackUrl } : {}), challenge: pkce.challenge, state: pkce.state, keyLabel: "JAgentChill" }),
      instructions: callbackUrl
        ? "Sign in to OpenRouter and authorise JAgentChill. The page then returns to this host and the key is connected."
        : "Sign in to OpenRouter and authorise JAgentChill. The page then shows a code: copy it and paste it here.",
    });
    return {
      async next(answer) {
        const step = host.step();
        if (step.kind === "open-url") return host.update(paste());
        if (step.kind !== "enter-text" || answer === undefined) return;
        const pasted = readPastedCode(answer);
        if (pasted.state && pasted.state !== pkce.state) return host.update(paste("That address belongs to another sign-in. Use the page this sign-in opened."));
        await complete(pasted.code, "paste");
      },
      cancel: () => void callbacks.delete(pkce.state),
    };
  }

  /**
   * The browser came back from OpenRouter to this server. The `state` is single-use and names the login; the login must
   * still be running and its owner must still be an active admin device. Answers with what the page shows.
   */
  async function oauthCallback(query: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    const state = query.get("state") ?? "";
    const pending = callbacks.get(state);
    const invalid = { ok: false, message: "This sign-in link is not valid any more. Start the sign-in again in JAgentChill." };
    if (!pending) return invalid;
    callbacks.delete(state);
    const login = pending.login;
    const owner = deps.devices.get(login.ownerDeviceId);
    if (login.ended || deps.now() - login.started_ms > LOGIN_TTL_MS) return invalid;
    if (!owner || owner.state !== "active" || owner.role !== "admin") {
      await finish(login, { kind: "error", code: "SCOPE_DENIED", message: "The device that started this sign-in may no longer change provider access." });
      return invalid;
    }
    const code = query.get("code");
    if (query.get("error") || !code) {
      await finish(login, { kind: "error", code: "CANCELLED", message: "The sign-in was not allowed at the provider." });
      return { ok: false, message: "The sign-in was not completed. You can close this tab and start again in JAgentChill." };
    }
    void pending.complete(code).catch(() => undefined);
    return { ok: true, message: "Finishing the sign-in in JAgentChill. You can close this tab." };
  }

  function loginOf(loginId: string, connection: Connection): Login {
    const login = logins.get(loginId);
    if (!login || login.ownerDeviceId !== connection.deviceId) throw new ProtocolError("NOT_FOUND", "No such login.");
    if (!login.ended && deps.now() - login.started_ms > LOGIN_TTL_MS) {
      login.ended = true;
      login.step = { kind: "error", code: "runtime/login-expired", message: "The sign-in took too long. Start again." };
      deps.secrets.delete(secretNameOf(loginId));
      login.session?.cancel();
    }
    return login;
  }

  /** The choice a sign-in runs, or the refusal for a catalogue choice the product does not perform. */
  function productChoiceOrThrow(provider: ProviderData, choiceId: string): ProductSignIn {
    const product = productSignIn(provider.providerId, choiceId);
    if (product) return product;
    const listed = provider.choices.find((candidate) => candidate.choiceId === choiceId);
    if (!listed) throw new ProtocolError("INVALID_PARAMS", "This provider has no sign-in with that choice.", { details: { path: "choiceId" } });
    const replacement = signInReplacement(listed);
    const message = replacement?.message ?? (listed.kind === "api-key" ? "An API key is entered, not signed in: use setApiKey." : ONLY_CLI);
    throw new ProtocolError("UNSUPPORTED_FEATURE", message, {
      details: { providerId: provider.providerId, choiceId, reason: "product-sign-in", ...(replacement?.replacedBy ? { replacedBy: replacement.replacedBy } : {}) },
    });
  }

  async function loginStart(raw: unknown, connection: Connection) {
    const params = parse(loginStartParams, raw);
    const provider = providerOrThrow(params.providerId);
    const choice = productChoiceOrThrow(provider, params.choiceId);
    for (const login of logins.values()) if (!login.ended && deps.now() - login.started_ms > LOGIN_TTL_MS) loginOf(login.loginId, { deviceId: login.ownerDeviceId } as Connection);
    const running = [...logins.values()].filter((login) => !login.ended);
    const same = running.find((login) => login.providerId === provider.providerId);
    // One login per provider: the device that started it gets it back, another device is refused.
    if (same) {
      if (same.ownerDeviceId === connection.deviceId) return { loginId: same.loginId, step: same.step };
      throw new ProtocolError("CONFLICT", "Another device is signing in to this provider.");
    }
    if (running.length >= RUNTIME_LIMITS.concurrentLogins) throw new ProtocolError("QUOTA_EXCEEDED", "Too many sign-ins are running", { details: { limit: "concurrentLogins", max: RUNTIME_LIMITS.concurrentLogins } });
    if (choice.driver.type === "cli" && !deps.cli.command(choice.driver.runtimeId)) throw new ProtocolError("runtime/not-installed", `${choice.identity} is not installed on this host.`, { details: { runtimeId: choice.driver.runtimeId } });
    const login: Login = {
      loginId: ulid(deps.now()), providerId: provider.providerId, choiceId: choice.choiceId, ownerDeviceId: connection.deviceId, started_ms: deps.now(),
      step: { kind: "progress", message: "Starting sign-in…" }, ended: false,
    };
    login.session = choice.driver.type === "cli"
      ? startCli(login, choice as CliSignIn, { ...(params.email ? { email: params.email } : {}), ...(params.sso ? { sso: true } : {}) })
      : startOpenRouter(login, params.browserOnHost ?? connection.transport === "loopback");
    // The first step that needs the person: a CLI takes a moment to print its address.
    if (login.step.kind === "progress") await waitChange(login, login.step, 15_000);
    logins.set(login.loginId, login);
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.login.start", { providerId: provider.providerId, choiceId: choice.choiceId, loginId: login.loginId });
    return { loginId: login.loginId, step: login.step };
  }

  async function loginNext(raw: unknown, connection: Connection) {
    const params = parse(loginNextParams, raw);
    const login = loginOf(params.loginId, connection);
    if (login.ended || !login.session) return { step: login.step };
    let pasted: string | undefined;
    if (login.step.kind === "enter-text") {
      // The pasted code travels over the signed secret route under a single-use name and is deleted when it is read.
      const name = secretNameOf(login.loginId);
      pasted = deps.secrets.read(name);
      if (pasted === undefined) throw new ProtocolError("INVALID_PARAMS", "Send the text over the secret route first.", { details: { secretName: name } });
      deps.secrets.delete(name);
    }
    await login.session.next(pasted);
    // A step the host is working on is answered when it changes, so a device that asks again does not spin.
    if (!login.ended && (login.step.kind === "progress" || login.step.kind === "device-code")) await waitChange(login, login.step, deps.stepWaitMs ?? STEP_WAIT_MS);
    return { step: login.step };
  }

  function loginCancel(raw: unknown, connection: Connection) {
    const login = loginOf(parse(loginIdParams, raw).loginId, connection);
    if (!login.ended) {
      login.ended = true;
      login.step = { kind: "error", code: "CANCELLED", message: "The sign-in was cancelled." };
      deps.secrets.delete(secretNameOf(login.loginId));
      login.session?.cancel();
      publish(login);
      audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.login.cancel", { providerId: login.providerId, loginId: login.loginId });
    }
    return { step: login.step };
  }

  function loginTransfer(raw: unknown, connection: Connection) {
    const params = parse(loginTransferParams, raw);
    const login = loginOf(params.loginId, connection);
    if (login.ended) throw new ProtocolError("CONFLICT", "This sign-in has ended.");
    const target = deps.devices.get(params.toDeviceId);
    const desktop = target && ["macos", "windows", "linux", "web"].includes(target.platform);
    if (!target || target.state !== "active" || target.role !== "admin" || !desktop || !deps.isOnline(target.deviceId)) {
      throw new ProtocolError("NOT_FOUND", "No desktop device is online");
    }
    // The login belongs to the target device from this moment; no credential moves with it.
    login.ownerDeviceId = target.deviceId;
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.auth.login.transfer", { providerId: login.providerId, loginId: login.loginId, toDeviceId: target.deviceId });
    deps.broadcast("jagentchill.config.write", "jagentchill.provider.auth.login.transferred", "provider", { loginId: login.loginId, providerId: login.providerId, providerLabel: providerById(login.providerId)?.label, step: login.step }, (candidate) => candidate.deviceId === target.deviceId);
    return { loginId: login.loginId, toDeviceId: target.deviceId, toDeviceName: target.name };
  }

  const methods = new Map<string, RpcMethod>();
  const add = (name: string, mutating: boolean, handle: RpcMethod["handle"]) => methods.set(name, {
    scope: RUNTIME_METHOD_SCOPES[name],
    handle: (raw, connection) => {
      if (mutating) deps.mutations.hit(connection.deviceId);
      return handle(raw, connection);
    },
  });
  const gone = (message: string): RpcMethod["handle"] => () => {
    throw new ProtocolError("UNSUPPORTED_FEATURE", message);
  };
  add("jagentchill.provider.auth.list", false, (raw) => list(raw));
  add("jagentchill.provider.auth.setApiKey", true, (raw, connection) => setApiKey(raw, connection));
  add("jagentchill.provider.auth.test", true, (raw, connection) => testProfile(raw, connection));
  add("jagentchill.provider.auth.order.set", true, gone(NO_ORDER));
  add("jagentchill.provider.auth.logout", true, (raw, connection) => logout(raw, connection));
  add("jagentchill.provider.auth.login.start", true, (raw, connection) => loginStart(raw, connection));
  add("jagentchill.provider.auth.login.next", true, (raw, connection) => loginNext(raw, connection));
  add("jagentchill.provider.auth.login.status", false, (raw, connection) => ({ step: loginOf(parse(loginIdParams, raw).loginId, connection).step }));
  add("jagentchill.provider.auth.login.cancel", true, (raw, connection) => loginCancel(raw, connection));
  add("jagentchill.provider.auth.login.transfer", true, (raw, connection) => loginTransfer(raw, connection));
  add("jagentchill.provider.override.get", false, gone(NO_OVERRIDE));
  add("jagentchill.provider.override.set", true, gone(NO_OVERRIDE));
  add("jagentchill.provider.override.remove", true, gone(NO_OVERRIDE));

  return {
    methods,
    /** The server is stopping: running sign-ins end and their CLI processes are removed. */
    close(): void {
      for (const login of logins.values()) if (!login.ended) login.session?.cancel();
    },
    /** The secrets a sign-in holds: the single-use pasted codes of running logins, and the stored keys. */
    usesSecret: (name: string) => [...logins.values()].some((login) => !login.ended && secretNameOf(login.loginId) === name) || Object.values(storedKeys()).some((key) => key.secretName === name),
    label: (providerId: string) => providerById(providerId)?.label,
    /** The keys stored on this host, for the runtimes that run on them: where each value is, never the value. */
    storedKeys: (): StoredKeyView[] => Object.entries(storedKeys()).filter(([, key]) => deps.secrets.has(key.secretName)).map(([providerId, key]) => ({ providerId, label: KEY_PROVIDERS[providerId]?.label ?? providerId, secretName: key.secretName, models: key.models })),
    oauthCallback,
    /**
     * A turn failed on a CLI's sign-in: its profile shows the failure until the CLI is checked again (a probe, a test, a
     * new sign-in). Takes a runtime id (`claude-code`, `codex`) or a provider id, whose CLIs are all marked.
     */
    noteAuthFailure(id: string): void {
      const all = Object.values(PRODUCT_SIGN_INS).flat().filter((choice): choice is CliSignIn => choice.driver.type === "cli");
      const own = all.filter((choice) => choice.driver.runtimeId === id);
      const provider = providerById(id)?.providerId;
      const marked = own.length ? own : provider ? cliChoices(provider) : [];
      for (const runtimeId of new Set(marked.map((choice) => choice.driver.runtimeId))) authFailures.set(runtimeId, deps.now());
    },
  };
}

export type ProviderAuth = ReturnType<typeof createProviderAuth>;
