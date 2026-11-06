import type { EndpointDialect, EndpointRecord } from "@jagentchill/protocol";

/**
 * How a stored API key or a custom endpoint reaches the agent CLIs (w23a). Nothing here writes a CLI's own credential
 * file (~/.claude*, ~/.codex, the Keychain): a key is handed only to the process the server starts, through its
 * environment, and a provider address only through the per-session configuration the CLI takes —
 *
 *  - Claude Code: `ANTHROPIC_API_KEY`; an Anthropic-compatible endpoint as `ANTHROPIC_BASE_URL` with
 *    `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` (a token is always set, so the subscription's own token is never
 *    sent to another address).
 *  - Codex (app-server): a `model_providers` entry with `env_key` in the `config` of `thread/start`. Codex 0.160 no
 *    longer speaks Chat Completions (`wire_api = "chat"` is refused), so only Responses-API addresses: OpenAI, OpenRouter
 *    and endpoints of the `openai-responses` dialect.
 *  - Gemini CLI (ACP): `GEMINI_API_KEY` and `GEMINI_MODEL`; in ACP mode it authenticates only from its settings, so a
 *    server-owned system-settings file (no secret in it, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`) selects the key sign-in.
 *  - OpenCode (ACP): an inline configuration in `OPENCODE_CONFIG_CONTENT` (provider, address, model) that names the key
 *    by an environment variable (`{env:…}`), never by value.
 */

export type KeyModel = { id: string; label: string; contextWindow?: number; input?: Array<"text" | "image" | "audio" | "video"> };
type ModelAuth = "bearer" | "x-api-key" | "x-goog-api-key";
export type KeyProvider = {
  providerId: string;
  label: string;
  /** The API's base address (OpenAI-compatible ones end in their version segment). */
  baseUrl: string;
  /** The variable the key is handed in. */
  envName: string;
  /** The model-list route, which is also the key check: listing models generates nothing and costs nothing. */
  models: { path: string; auth: ModelAuth; headers?: Record<string, string>; keep?: (id: string) => boolean };
  /** OpenCode: the provider id it knows (its own provider of that name), or a provider defined here (`npm`). */
  opencode: { id: string; npm?: string };
  /** Codex: the Responses-API address it is given as a custom model provider. */
  codex?: { baseUrl: string };
};

const CHAT_ONLY = /(audio|realtime|tts|transcribe|image|embedding|moderation|whisper|dall-e|davinci|babbage|search|instruct|computer-use)/i;
const compatible = (providerId: string, label: string, baseUrl: string): KeyProvider => ({
  providerId, label, baseUrl, envName: `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
  models: { path: "/models", auth: "bearer", keep: (id) => !/(embed|whisper|tts|rerank|guard|moderation)/i.test(id) },
  opencode: { id: `jagentchill-${providerId}`, npm: "@ai-sdk/openai-compatible" },
});

/** The providers whose API key a CLI on the host can run on. */
export const KEY_PROVIDERS: Record<string, KeyProvider> = Object.fromEntries(([
  {
    providerId: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", envName: "ANTHROPIC_API_KEY",
    models: { path: "/models", auth: "x-api-key", headers: { "anthropic-version": "2023-06-01" }, keep: (id) => /^claude-/.test(id) }, opencode: { id: "anthropic" },
  },
  {
    providerId: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", envName: "OPENAI_API_KEY",
    models: { path: "/models", auth: "bearer", keep: (id) => /^(gpt-|o\d|codex|chatgpt)/.test(id) && !CHAT_ONLY.test(id) }, opencode: { id: "openai" },
    codex: { baseUrl: "https://api.openai.com/v1" },
  },
  {
    providerId: "google", label: "Google (Gemini)", baseUrl: "https://generativelanguage.googleapis.com/v1beta", envName: "GEMINI_API_KEY",
    models: { path: "/models", auth: "x-goog-api-key", keep: (id) => /^gemini-/.test(id) && !CHAT_ONLY.test(id) }, opencode: { id: "google" },
  },
  {
    providerId: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", envName: "OPENROUTER_API_KEY",
    models: { path: "/models", auth: "bearer" }, opencode: { id: "openrouter" }, codex: { baseUrl: "https://openrouter.ai/api/v1" },
  },
  compatible("groq", "Groq", "https://api.groq.com/openai/v1"),
  compatible("deepseek", "DeepSeek", "https://api.deepseek.com/v1"),
  compatible("mistral", "Mistral", "https://api.mistral.ai/v1"),
  compatible("xai", "xAI", "https://api.x.ai/v1"),
  compatible("together", "Together AI", "https://api.together.xyz/v1"),
  compatible("fireworks", "Fireworks", "https://api.fireworks.ai/inference/v1"),
  compatible("cerebras", "Cerebras", "https://api.cerebras.ai/v1"),
  compatible("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai"),
] satisfies KeyProvider[]).map((provider) => [provider.providerId, provider]));

/** The shipped runtime a runtime is (or extends): what decides how a key reaches it. */
export const familyOf = (runtime: { id: string; base?: string }): string => runtime.base ?? runtime.id;
const NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", "gemini-cli": "Gemini CLI", "acp-opencode": "OpenCode" };

/** Which runtimes run on a provider's key, by family. */
export function keyUsableBy(providerId: string, family: string): { usable: boolean; reason?: string } {
  const provider = KEY_PROVIDERS[providerId];
  if (!provider) return { usable: false, reason: "No agent CLI runs on a key of this provider." };
  if (family === "acp-opencode") return { usable: true };
  if (family === "claude-code") return providerId === "anthropic" ? { usable: true } : { usable: false, reason: "Claude Code runs only on an Anthropic key." };
  if (family === "codex") return provider.codex ? { usable: true } : { usable: false, reason: "Codex runs only on an OpenAI or OpenRouter key." };
  if (family === "gemini-cli") return providerId === "google" ? { usable: true } : { usable: false, reason: "Gemini CLI runs only on a Google key." };
  return { usable: false, reason: `${NAMES[family] ?? "This CLI"} uses only its own sign-in.` };
}

/** The runtimes that run on a provider's key, as names (for the provider sheet). */
export const keyRuntimes = (providerId: string): string[] => ["claude-code", "codex", "gemini-cli", "acp-opencode"].filter((family) => keyUsableBy(providerId, family).usable).map((family) => NAMES[family]);

const OPENCODE_DIALECTS: EndpointDialect[] = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "ollama"];
/** Whether a runtime can run on an endpoint, by family and the endpoint's dialect and transport settings. */
export function endpointUsableBy(endpoint: EndpointRecord, family: string): { usable: boolean; reason?: string } {
  if (!endpoint.capabilities.includes("llm")) return { usable: false, reason: "This endpoint serves no chat model." };
  if (endpoint.tls?.caSecretName || endpoint.tls?.clientCertSecretName || endpoint.tls?.allowSelfSigned) return { usable: false, reason: "The agent CLIs cannot take this endpoint's TLS settings." };
  if (family === "claude-code") return endpoint.dialect === "anthropic-messages" && !Object.keys(endpoint.query ?? {}).length ? { usable: true } : { usable: false, reason: "Claude Code needs an Anthropic-compatible endpoint." };
  if (family === "codex") return endpoint.dialect === "openai-responses" ? { usable: true } : { usable: false, reason: "Codex needs an endpoint that speaks the OpenAI Responses API." };
  if (family === "acp-opencode") {
    if (Object.keys(endpoint.query ?? {}).length) return { usable: false, reason: "OpenCode cannot add query parameters to an address." };
    return OPENCODE_DIALECTS.includes(endpoint.dialect) ? { usable: true } : { usable: false, reason: "OpenCode cannot use this dialect." };
  }
  if (family === "gemini-cli") return { usable: false, reason: "Gemini CLI runs only on a Google key or its own sign-in." };
  return { usable: false, reason: `${NAMES[family] ?? "This CLI"} uses only its own sign-in.` };
}

/** What a runtime session is opened with on a key or an endpoint: variables to add and to drop, and per-session configuration. */
export type AccessPlan = { env: Record<string, string>; unset: string[]; config?: Record<string, unknown> };

const CLAUDE_OWN = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
const GEMINI_OWN = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_GCA", "GOOGLE_GENAI_USE_VERTEXAI", "GEMINI_MODEL", "GEMINI_CLI_SYSTEM_SETTINGS_PATH"];
const envSafe = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const opencodeContent = (config: Record<string, unknown>) => JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config });

/** The session plan of a stored key. `modelId` is the model the session chose; `geminiSettings` the server-owned settings file. */
export function keyPlan(family: string, provider: KeyProvider, key: string, modelId: string | undefined, opts: { geminiSettings?: string } = {}): AccessPlan | undefined {
  if (!keyUsableBy(provider.providerId, family).usable) return undefined;
  if (family === "claude-code") return { env: { ANTHROPIC_API_KEY: key }, unset: CLAUDE_OWN };
  if (family === "gemini-cli") {
    return {
      env: { GEMINI_API_KEY: key, ...(opts.geminiSettings ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: opts.geminiSettings } : {}), ...(modelId && modelId !== "default" ? { GEMINI_MODEL: modelId } : {}) },
      unset: GEMINI_OWN,
    };
  }
  if (family === "codex") {
    const id = `jagentchill-${provider.providerId}`;
    return {
      env: { [provider.envName]: key }, unset: [],
      config: { model_provider: id, model_providers: { [id]: { name: `${provider.label} (API key)`, base_url: provider.codex!.baseUrl, env_key: provider.envName, wire_api: "responses" } } },
    };
  }
  // OpenCode
  const oc = provider.opencode;
  const entry = {
    ...(oc.npm ? { npm: oc.npm, name: provider.label } : {}),
    options: { apiKey: `{env:${provider.envName}}`, ...(oc.npm ? { baseURL: provider.baseUrl } : {}) },
    ...(modelId ? { models: { [modelId]: { name: modelId } } } : {}),
  };
  return { env: { [provider.envName]: key, OPENCODE_CONFIG_CONTENT: opencodeContent({ provider: { [oc.id]: entry }, ...(modelId ? { model: `${oc.id}/${modelId}` } : {}) }) }, unset: ["OPENCODE_CONFIG_CONTENT"] };
}

/**
 * The session plan of a custom endpoint. `secret` reads a host secret (the endpoint's key and secret header values);
 * a value is only ever put in a variable of the child's environment.
 */
export function endpointPlan(family: string, endpoint: EndpointRecord, secret: (name: string) => string | undefined, modelId: string | undefined): AccessPlan | undefined {
  if (!endpointUsableBy(endpoint, family).usable) return undefined;
  const base = `JAGENTCHILL_ENDPOINT_${envSafe(endpoint.id)}`;
  const key = endpoint.auth.mode !== "none" && endpoint.auth.secretName ? secret(endpoint.auth.secretName) : undefined;
  const env: Record<string, string> = {};
  const plainHeaders: Record<string, string> = {};
  const secretHeaders: Record<string, string> = {};
  Object.entries(endpoint.headers ?? {}).forEach(([name, value], index) => {
    if (typeof value === "string") plainHeaders[name] = value;
    else {
      const resolved = secret(value.secret);
      if (resolved === undefined) return;
      env[`${base}_HEADER_${index}`] = resolved;
      secretHeaders[name] = `${base}_HEADER_${index}`;
    }
  });
  const trimmed = endpoint.baseUrl.replace(/\/+$/, "");
  if (family === "claude-code") {
    // Claude Code appends `/v1/messages` itself. A credential is always given: without one it would send the
    // subscription's own token to this address.
    const prefix = endpoint.auth.prefix ?? "";
    const headerName = endpoint.auth.headerName ?? "x-api-key";
    const headers: Record<string, string> = { ...plainHeaders };
    for (const [name, variable] of Object.entries(secretHeaders)) headers[name] = env[variable];
    const auth: Record<string, string> = {};
    if (key && endpoint.auth.mode === "bearer") auth.ANTHROPIC_AUTH_TOKEN = key;
    else if (key && endpoint.auth.mode === "header" && headerName.toLowerCase() === "x-api-key") auth.ANTHROPIC_API_KEY = `${prefix}${key}`;
    else {
      auth.ANTHROPIC_AUTH_TOKEN = "jagentchill-no-key";
      if (key && endpoint.auth.mode === "header") headers[headerName] = `${prefix}${key}`;
    }
    return {
      env: {
        ANTHROPIC_BASE_URL: trimmed.replace(/\/v1$/, ""), ...auth,
        ...(Object.keys(headers).length ? { ANTHROPIC_CUSTOM_HEADERS: Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n") } : {}),
      },
      unset: CLAUDE_OWN,
    };
  }
  if (family === "codex") {
    const id = `jagentchill-endpoint-${endpoint.id}`;
    if (key && endpoint.auth.mode === "bearer") env[`${base}_KEY`] = key;
    if (key && endpoint.auth.mode === "header") {
      env[`${base}_KEY`] = `${endpoint.auth.prefix ?? ""}${key}`;
      secretHeaders[endpoint.auth.headerName ?? "x-api-key"] = `${base}_KEY`;
    }
    const provider = {
      name: endpoint.label, base_url: trimmed, wire_api: "responses",
      ...(key && endpoint.auth.mode === "bearer" ? { env_key: `${base}_KEY` } : {}),
      ...(Object.keys(plainHeaders).length ? { http_headers: plainHeaders } : {}), ...(Object.keys(secretHeaders).length ? { env_http_headers: secretHeaders } : {}),
      ...(Object.keys(endpoint.query ?? {}).length ? { query_params: Object.fromEntries(Object.entries(endpoint.query ?? {}).filter(([, value]) => typeof value === "string")) } : {}),
    };
    return { env, unset: [], config: { model_provider: id, model_providers: { [id]: provider } } };
  }
  // OpenCode
  const id = `jagentchill-${endpoint.id}`;
  const npm = endpoint.dialect === "anthropic-messages" ? "@ai-sdk/anthropic" : endpoint.dialect === "google-generative-ai" ? "@ai-sdk/google" : endpoint.dialect === "openai-responses" ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible";
  const baseURL = endpoint.dialect === "ollama" ? `${trimmed}/v1` : endpoint.dialect === "anthropic-messages" && !/\/v1$/.test(trimmed) ? `${trimmed}/v1` : trimmed;
  const headers: Record<string, string> = { ...plainHeaders, ...Object.fromEntries(Object.entries(secretHeaders).map(([name, variable]) => [name, `{env:${variable}}`])) };
  if (key) {
    env[`${base}_KEY`] = endpoint.auth.mode === "header" ? `${endpoint.auth.prefix ?? ""}${key}` : key;
    if (endpoint.auth.mode === "header" && (endpoint.auth.headerName ?? "").toLowerCase() !== "x-api-key") headers[endpoint.auth.headerName!] = `{env:${base}_KEY}`;
  }
  const apiKey = key && (endpoint.auth.mode === "bearer" || (endpoint.auth.headerName ?? "x-api-key").toLowerCase() === "x-api-key") ? `{env:${base}_KEY}` : undefined;
  const models = Object.fromEntries(endpoint.models.filter((model) => model.enabled).slice(0, 200).map((model) => [model.id, { name: model.label, ...(model.contextWindow ? { limit: { context: model.contextWindow, output: model.maxOutputTokens ?? 8192 } } : {}) }]));
  const entry = { npm, name: endpoint.label, options: { baseURL, ...(apiKey ? { apiKey } : {}), ...(Object.keys(headers).length ? { headers } : {}) }, models };
  return { env: { ...env, OPENCODE_CONFIG_CONTENT: opencodeContent({ provider: { [id]: entry }, ...(modelId ? { model: `${id}/${modelId}` } : {}) }) }, unset: ["OPENCODE_CONFIG_CONTENT"] };
}

/** Applies a plan to the environment a CLI is started in. */
export function applyPlan(base: Record<string, string>, plan: AccessPlan): Record<string, string> {
  const out = { ...base };
  for (const name of plan.unset) delete out[name];
  return { ...out, ...plan.env };
}
