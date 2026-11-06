import type { Billing } from "./spend-gate.ts";

/**
 * HOW A RUNTIME IS BILLED (ruling R9, narrowed by review 16 #1): work on the person's own signed-in SUBSCRIPTION of a
 * CLI is not money of this app — and that is said of a runtime ONLY when the runtime itself positively reports such a
 * sign-in. Everything else is billed per call and asked about: a CLI that runs on an API key (Claude Code or Codex
 * logged in with a key, a console account, a cloud provider, or with a key in the environment it is started in); a
 * profile that changes how the CLI is launched; a runtime with no status command that names its kind of sign-in; a
 * status command that fails, times out or says something this file does not know. In doubt: per call.
 *
 * Only WHICH KIND of sign-in is read — from the CLI's own status command (the one the runtime service already runs to
 * know whether it is signed in) and from the NAMES of the variables in the environment the CLI is started in. No
 * credential file is opened, no value of a variable is read, and nothing of the status output is kept or logged but
 * the kind.
 */
export type SignIn = "subscription" | "api_key" | "unknown";
export type StatusOutput = { code: number | null; stdout: string; stderr: string; timedOut: boolean };
type RuntimeFacts = { id: string; kind: "cli"; base?: string; statusCommand?: string[]; entry?: { env?: unknown; command?: unknown; signIn?: { kind: string } } };

/**
 * The variables that make a CLI bill an API key (or another endpoint) whatever its own sign-in says — by the shipped
 * runtime a runtime is (or extends). A runtime that is not here has no sign-in this file can call a subscription at all.
 */
const KEY_VARIABLES: Record<string, readonly RegExp[]> = {
  "claude-code": [/^ANTHROPIC_API_KEY$/, /^ANTHROPIC_AUTH_TOKEN$/, /^ANTHROPIC_BASE_URL$/, /^ANTHROPIC_(BEDROCK|VERTEX|FOUNDRY)_/, /^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$/, /^CLAUDE_CODE_OAUTH_TOKEN$/, /^AWS_BEARER_TOKEN_BEDROCK$/],
  codex: [/^OPENAI_API_KEY$/, /^CODEX_API_KEY$/, /^OPENAI_BASE_URL$/, /^AZURE_OPENAI_API_KEY$/],
};

/** What the CLI's own status command says of the KIND of its sign-in. Anything that is not a plain statement of a personal subscription is not one. */
export function signInOf(runtime: string, result: StatusOutput): SignIn {
  if (result.timedOut || result.code !== 0) return "unknown";
  if (runtime === "claude-code") {
    // `claude auth status` answers JSON: { loggedIn, authMethod, apiProvider, subscriptionType, … }.
    let status: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown; subscriptionType?: unknown };
    try { status = JSON.parse(result.stdout) as typeof status; } catch { return "unknown"; }
    if (!status || typeof status !== "object" || status.loggedIn !== true || typeof status.authMethod !== "string") return "unknown";
    if (status.authMethod !== "claude.ai") return "api_key";
    if (status.apiProvider !== undefined && status.apiProvider !== "firstParty") return "api_key";
    return typeof status.subscriptionType === "string" && status.subscriptionType.trim() ? "subscription" : "unknown";
  }
  if (runtime === "codex") {
    // `codex login status` answers one line: "Logged in using ChatGPT" / "Logged in using an API key - …".
    const via = /logged in using\s+(.+)/i.exec(`${result.stdout}\n${result.stderr}`)?.[1]?.trim() ?? "";
    return /^chatgpt\b/i.test(via) ? "subscription" : /api key/i.test(via) ? "api_key" : "unknown";
  }
  return "unknown";
}

export type RuntimeBillingDeps = {
  runtime(runtimeId: string): RuntimeFacts | undefined;
  /** The environment the server starts that CLI in (only the NAMES of its variables are read); undefined: the CLI is not installed. */
  launchEnv(runtimeId: string): Record<string, string> | undefined;
  /** The environment the server itself runs in (the CLI it starts inherits it): names only. */
  hostEnv(): Record<string, string | undefined>;
  /** Runs the CLI's own status command; undefined: it cannot be run. */
  status(runtimeId: string, args: string[]): Promise<StatusOutput | undefined>;
  now(): number;
  /** For how long a reported sign-in is taken as it was read (the runtime service's own rule for a sign-in it has read). */
  staleMs: number;
};

export function createRuntimeBilling(deps: RuntimeBillingDeps) {
  /** What each CLI's status command said of its kind of sign-in, and when it was asked. (What is seen WITHOUT asking — a key in the environment, a changed launch — is never kept: it is looked at every time.) */
  const read = new Map<string, { signIn: SignIn; checked_ms: number }>();
  const reasons = new Map<string, string>();
  const checking = new Map<string, Promise<Billing>>();
  /** What can be said without asking the CLI: every case but "a native Claude Code / Codex with no key in its environment" is per call here and now. */
  const settledWithout = (runtimeId: string): { billing: Billing; why: string } | undefined => {
    const runtime = deps.runtime(runtimeId);
    if (!runtime) return { billing: "per_call", why: "runtime_unknown" };
    if (runtime.entry?.env || runtime.entry?.command) return { billing: "per_call", why: "launch_changed" };
    // A CLI set to run on a key stored on the host or on an endpoint is billed per call (w23a), whatever its own account is.
    if (runtime.entry?.signIn && runtime.entry.signIn.kind !== "cli") return { billing: "per_call", why: "stored_key_or_endpoint" };
    const variables = KEY_VARIABLES[runtime.base ?? runtime.id];
    if (!variables || !runtime.statusCommand?.length) return { billing: "per_call", why: "kind_of_sign_in_not_reported" };
    const env = deps.launchEnv(runtimeId);
    if (!env) return { billing: "per_call", why: "not_installed" };
    const names = [...Object.keys(env), ...Object.entries(deps.hostEnv()).filter(([, value]) => value !== undefined && value !== "").map(([name]) => name)];
    if (names.some((name) => variables.some((pattern) => pattern.test(name)) && (env[name] ?? deps.hostEnv()[name]) !== "")) return { billing: "per_call", why: "key_in_environment" };
    return undefined;
  };
  const said = (runtimeId: string, found: { billing: Billing; why: string }): Billing => { reasons.set(runtimeId, found.why); return found.billing; };
  const byStatus = (runtimeId: string): { billing: Billing; why: string } => { const signIn = read.get(runtimeId)?.signIn; return signIn === "subscription" ? { billing: "own_account", why: "subscription_sign_in" } : { billing: "per_call", why: signIn === "api_key" ? "api_key_sign_in" : signIn ? "cannot_tell" : "not_read_yet" }; };
  const check = (runtimeId: string): Promise<Billing> => {
    const going = checking.get(runtimeId);
    if (going) return going;
    const started = (async (): Promise<Billing> => {
      const before = settledWithout(runtimeId);
      if (before) return said(runtimeId, before);
      const runtime = deps.runtime(runtimeId)!;
      let signIn: SignIn = "unknown";
      try { const result = await deps.status(runtimeId, runtime.statusCommand!); if (result) signIn = signInOf(runtime.base ?? runtime.id, result); } catch { /* cannot be told: per call */ }
      read.set(runtimeId, { signIn, checked_ms: deps.now() });
      // What is seen without asking is looked at again after the wait: a key that appeared meanwhile decides.
      return said(runtimeId, settledWithout(runtimeId) ?? byStatus(runtimeId));
    })().finally(() => { checking.delete(runtimeId); });
    checking.set(runtimeId, started);
    return started;
  };
  const fresh = (runtimeId: string): boolean => { const entry = read.get(runtimeId); return !!entry && deps.now() - entry.checked_ms <= deps.staleMs; };
  return {
    /**
     * What is known NOW, for a quote (which cannot wait): "own_account" only when the runtime's last read status said a
     * personal subscription — and whatever can be seen without asking the CLI still holds. Never read, or it cannot be
     * told: per call. A reading that is missing or old is read again behind this answer.
     */
    of(runtimeId: string): Billing {
      const without = settledWithout(runtimeId);
      if (without) return said(runtimeId, without);
      if (!fresh(runtimeId)) void check(runtimeId).catch(() => undefined);
      return said(runtimeId, byStatus(runtimeId));
    },
    /** For a DISPATCH (which can wait): the runtime's status as read within `staleMs`, read now when it is older or was never read. */
    async verify(runtimeId: string): Promise<Billing> {
      const without = settledWithout(runtimeId);
      if (without) return said(runtimeId, without);
      return fresh(runtimeId) ? said(runtimeId, byStatus(runtimeId)) : check(runtimeId);
    },
    /** Reads the sign-in of these runtimes now (the host does it when it starts, so that the first quote already knows). */
    async warm(runtimeIds: readonly string[]): Promise<void> { await Promise.all(runtimeIds.map((id) => check(id).catch(() => "per_call" as const))); },
    /** Why a runtime is billed as it is (a word for the diagnostics and the tests; never anything of a credential). */
    why: (runtimeId: string): string | undefined => reasons.get(runtimeId),
  };
}
export type RuntimeBilling = ReturnType<typeof createRuntimeBilling>;
