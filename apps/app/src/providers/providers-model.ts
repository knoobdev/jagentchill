import type { AccessMethod, AuthChoice, AuthProfile, ProviderGroup, ProviderListing, RuntimeSignIn, RuntimeSnapshotEntry } from "@jagentchill/protocol";

/**
 * Host ▸ Providers, as data: the tabs, the "More providers" list and its filters, the health words of a sign-in, the
 * secret name a typed key is stored under, and the sign-ins a CLI can be set to run on. The screens render these.
 */
export const PROVIDER_TABS = [
  { id: "providers", label: "Providers" }, { id: "keys", label: "Sign-in & keys" }, { id: "runtimes", label: "CLI runtimes" },
  { id: "endpoints", label: "Endpoints" }, { id: "generation", label: "Generation" }, { id: "matrix", label: "Compare runtimes" },
] as const;
export type ProviderTabId = (typeof PROVIDER_TABS)[number]["id"];
export const GROUP_LABEL: Record<ProviderGroup, string> = { "first-party": "Model makers", aggregators: "Routers", cloud: "Cloud platforms", local: "Local", custom: "Custom" };

export const HEALTH: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ok: { label: "Connected", tone: "success" }, rate_limited: { label: "Rate limited", tone: "warning" }, billing: { label: "Billing problem", tone: "danger" }, auth_failed: { label: "Signed out", tone: "danger" },
  expired: { label: "Expired", tone: "warning" }, cooldown: { label: "Cooling down", tone: "warning" }, unknown: { label: "Not checked", tone: "neutral" },
};
/** The health of one sign-in in words: a key that fails is an invalid key, a CLI that fails is signed out. */
export function healthOf(profile: Pick<AuthProfile, "health" | "type">): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (profile.health === "auth_failed" && (profile.type === "api-key" || profile.type === "oauth")) return { label: "Invalid key", tone: "danger" };
  return HEALTH[profile.health] ?? HEALTH.unknown;
}

/** `openrouter` → `OPENROUTER_API_KEY`; when that name is taken by something else, a numbered one. */
export function secretNameFor(providerId: string, taken: readonly string[]): string {
  const base = `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+/, "")}_API_KEY`.slice(0, 58);
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 20; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now() % 100000}`;
}

/** Which of the three ways a choice is, as the host classifies it; undefined for a host-only choice. */
export const methodOf = (choice: AuthChoice): AccessMethod | undefined => choice.method
  ?? (choice.kind === "api-key" ? "api-key" : choice.kind === "oauth" || choice.kind === "device-code" ? "oauth" : choice.kind === "cli-login" || choice.kind === "setup-token" ? "cli" : undefined);

/** How a provider can be used, in a few words for its row: "Installed CLI · API key · 1 account". */
export function accessWords(provider: ProviderListing): string[] {
  const kinds: string[] = [];
  for (const choice of provider.choices) {
    const method = choice.available ? methodOf(choice) : undefined;
    const kind = method === "cli" ? "Installed CLI" : method === "oauth" ? "Account sign-in" : method === "api-key" ? "API key" : undefined;
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/**
 * The providers of the "More providers" list (tab Providers: those not in use yet) or of the Sign-in & keys tab (all),
 * filtered by group and by a search over label and id. Custom endpoints are listed on their own tab.
 */
export function otherProviders(providers: readonly ProviderListing[], opts: { tab: ProviderTabId; group: ProviderGroup | "all"; needle: string }): ProviderListing[] {
  const needle = opts.needle.trim().toLowerCase();
  return providers.filter((provider) => provider.group !== "custom"
    && (opts.tab === "keys" || !(provider.connected || provider.profiles.length))
    && (opts.group === "all" || provider.group === opts.group)
    && (!needle || provider.label.toLowerCase().includes(needle) || provider.providerId.includes(needle)));
}

/** The groups offered as filters: every group a listed provider has, in the catalogue's order. */
export function groupFilters(providers: readonly ProviderListing[]): Array<ProviderGroup | "all"> {
  const order: ProviderGroup[] = ["first-party", "aggregators", "cloud", "local"];
  return ["all", ...order.filter((group) => providers.some((provider) => provider.group === group))];
}

export type SignInChoice = { value: string; label: string; detail?: string; signIn: RuntimeSignIn; usable: boolean };
export const signInValue = (signIn: RuntimeSignIn | undefined): string => (!signIn || signIn.kind === "cli" ? "cli" : signIn.kind === "key" ? `key:${signIn.providerId}` : `endpoint:${signIn.endpointId}`);
/**
 * What a CLI can be set to run on: its own account first (the default), then the stored keys and endpoints the host
 * offers it, each usable or with the reason it is not.
 */
export function signInChoices(entry: Pick<RuntimeSnapshotEntry, "label" | "signInOptions">): SignInChoice[] {
  return [
    { value: "cli", label: "The CLI's own account", detail: `${entry.label} signs in as itself`, signIn: { kind: "cli" }, usable: true },
    ...(entry.signInOptions ?? []).map((option): SignInChoice => ({
      value: `${option.kind}:${option.id}`, label: option.label, ...(option.usable ? { detail: option.kind === "key" ? "API key stored on the host" : "Custom endpoint" } : option.reason ? { detail: option.reason } : {}),
      signIn: option.kind === "key" ? { kind: "key", providerId: option.id } : { kind: "endpoint", endpointId: option.id }, usable: option.usable,
    })),
  ];
}
