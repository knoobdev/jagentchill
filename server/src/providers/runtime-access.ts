import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EndpointRecord, ModelEntry, RuntimeErrorInfo, RuntimeSignIn, RuntimeSignInOption } from "@jagentchill/protocol";
import type { SecretStore } from "../secrets/store.ts";
import { KEY_PROVIDERS, applyPlan, endpointPlan, endpointUsableBy, familyOf, keyPlan, keyUsableBy, type AccessPlan, type KeyModel } from "./cli-access.ts";

/** A key stored on the host, as the runtimes see it: never its value, only where to read it. */
export type StoredKeyView = { providerId: string; label: string; secretName: string; models: KeyModel[] };
type RuntimeFacts = { id: string; base?: string; label: string; entry?: { signIn?: RuntimeSignIn } };

export type RuntimeAccessDeps = {
  keys: () => StoredKeyView[];
  endpoints: () => EndpointRecord[];
  secrets: SecretStore;
  /** The settings file that makes Gemini CLI sign in with a key (written by the server; holds no secret). */
  geminiSettingsFile: string;
};

/**
 * Which sign-in each CLI runtime runs on, the models that sign-in offers, and what a session on it is started with
 * (`cli-access.ts`). The CLI's own account is the default and needs nothing from here.
 */
export function createRuntimeAccess(deps: RuntimeAccessDeps) {
  const keyOf = (providerId: string) => deps.keys().find((entry) => entry.providerId === providerId);
  const endpointOf = (endpointId: string) => deps.endpoints().find((entry) => entry.id === endpointId);

  /** The stored keys and endpoints a runtime can be set to, with why one cannot. */
  function options(runtime: RuntimeFacts): RuntimeSignInOption[] {
    const family = familyOf(runtime);
    return [
      ...deps.keys().map((key): RuntimeSignInOption => ({ kind: "key", id: key.providerId, label: `${key.label} API key`, ...keyUsableBy(key.providerId, family) })),
      ...deps.endpoints().filter((endpoint) => endpoint.capabilities.includes("llm")).map((endpoint): RuntimeSignInOption => ({ kind: "endpoint", id: endpoint.id, label: endpoint.label, ...endpointUsableBy(endpoint, family) })),
    ];
  }

  /** The label and models of a runtime's key or endpoint sign-in, or why it cannot run on it now. */
  function resolve(runtime: RuntimeFacts, signIn: Exclude<RuntimeSignIn, { kind: "cli" }>): { label: string; models: ModelEntry[] } | { label: string; error: RuntimeErrorInfo } {
    const family = familyOf(runtime);
    if (signIn.kind === "key") {
      const key = keyOf(signIn.providerId);
      const label = `${KEY_PROVIDERS[signIn.providerId]?.label ?? signIn.providerId} API key`;
      if (!key || !deps.secrets.has(key.secretName)) return { label, error: { code: "runtime/no-provider", message: `The ${label} ${runtime.label} runs on was removed. Choose another sign-in.` } };
      const usable = keyUsableBy(signIn.providerId, family);
      if (!usable.usable) return { label, error: { code: "runtime/no-provider", message: usable.reason ?? "This CLI cannot run on this key." } };
      // Gemini CLI picks its own model when it is not named; every other CLI is given the one the session chose.
      const models = key.models.length ? key.models : family === "gemini-cli" ? [{ id: "default", label: "Gemini default" }] : [];
      if (!models.length) return { label, error: { code: "runtime/no-provider", message: `No model is listed for the ${label} yet. Test the key under Providers.` } };
      return {
        label,
        models: models.map((model, index): ModelEntry => ({
          providerId: signIn.providerId, modelId: model.id, label: model.label, isDefault: index === 0, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          input: model.input ?? ["text"], supportsTools: true, thinkingOptions: [], supportsFastMode: false, readiness: "ready", source: "configured",
        })),
      };
    }
    const endpoint = endpointOf(signIn.endpointId);
    if (!endpoint) return { label: signIn.endpointId, error: { code: "runtime/no-provider", message: `The endpoint ${runtime.label} runs on was removed. Choose another sign-in.` } };
    const usable = endpointUsableBy(endpoint, family);
    if (!usable.usable) return { label: endpoint.label, error: { code: "runtime/no-provider", message: usable.reason ?? "This CLI cannot run on this endpoint." } };
    if (!endpoint.enabled) return { label: endpoint.label, error: { code: "runtime/no-provider", message: `${endpoint.label} is turned off.` } };
    if (endpoint.auth.mode !== "none" && (!endpoint.auth.secretName || !deps.secrets.has(endpoint.auth.secretName))) return { label: endpoint.label, error: { code: "runtime/no-provider", message: `The key of ${endpoint.label} is missing on this host.` } };
    const models = endpoint.models.filter((model) => model.enabled);
    if (!models.length) return { label: endpoint.label, error: { code: "runtime/no-provider", message: `${endpoint.label} has no model turned on.` } };
    return {
      label: endpoint.label,
      models: models.map((model, index): ModelEntry => ({
        providerId: endpoint.id, modelId: model.id, label: model.alias ?? model.label, isDefault: index === 0, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        input: model.input, supportsTools: model.supportsTools, thinkingOptions: [], supportsFastMode: false, readiness: "ready", source: "configured",
      })),
    };
  }

  function geminiSettings(): string {
    // Merged over the person's own settings (system settings come last): only the kind of sign-in is set here.
    mkdirSync(dirname(deps.geminiSettingsFile), { recursive: true, mode: 0o700 });
    writeFileSync(deps.geminiSettingsFile, JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }, null, 2), { mode: 0o600 });
    return deps.geminiSettingsFile;
  }

  /**
   * What a session of `runtime` on `modelId` is started with when the runtime runs on a key or an endpoint; undefined
   * on the CLI's own account (nothing is added: no key reaches the CLI).
   */
  function plan(runtime: RuntimeFacts, modelId: string | undefined): (AccessPlan & { signature: string }) | undefined {
    const signIn = runtime.entry?.signIn;
    if (!signIn || signIn.kind === "cli") return undefined;
    const family = familyOf(runtime);
    let made: AccessPlan | undefined;
    if (signIn.kind === "key") {
      const key = keyOf(signIn.providerId);
      const value = key ? deps.secrets.read(key.secretName) : undefined;
      const provider = KEY_PROVIDERS[signIn.providerId];
      if (value && provider) made = keyPlan(family, provider, value, modelId, family === "gemini-cli" ? { geminiSettings: geminiSettings() } : {});
    } else {
      const endpoint = endpointOf(signIn.endpointId);
      if (endpoint) made = endpointPlan(family, endpoint, (name) => deps.secrets.read(name), modelId);
    }
    if (!made) return undefined;
    // A changed key or address opens the session again; the fingerprint is kept in memory only.
    const signature = createHash("sha256").update(JSON.stringify([signIn, made.env, made.config ?? null])).digest("hex").slice(0, 16);
    return { ...made, signature };
  }

  return { options, resolve, plan, apply: applyPlan };
}

export type RuntimeAccess = ReturnType<typeof createRuntimeAccess>;
