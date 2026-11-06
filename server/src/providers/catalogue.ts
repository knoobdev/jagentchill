import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthKind, EndpointPreset, ProviderGroup } from "@jagentchill/protocol";

const dataDir = join(import.meta.dirname, "../../data");
const read = <T>(name: string): T => JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;

export type ProviderChoiceData = { choiceId: string; provider: string; method: string; kind: AuthKind; label: string; hint?: string };
export type ProviderData = { providerId: string; label: string; description: string; docsUrl: string; pluginIds: string[]; choices: ProviderChoiceData[] };

/**
 * The provider catalogue, generated from the provider manifests of the agent engine the product embedded before it
 * drove the agent CLIs itself (OpenClaw, since removed) and frozen with that removal (its documentation links dropped).
 * It names providers and their model ids; only the choices of `sign-in-policy.ts` are offered for sign-in.
 */
export const PROVIDER_DATA = read<{ counts: { manifests: number; choices: number; groups: number }; providers: ProviderData[] }>("providers.json");
const GROUPS = read<Record<string, { group: ProviderGroup; docPath: string }>>("provider-groups.json");
export const SHIPPED_PRESETS = read<EndpointPreset[]>("endpoint-presets.json");

/**
 * The group a listed provider is shown under. A manifest group can cover several provider ids (`opencode` covers
 * `opencode` and `opencode-go`); it takes their group when they agree, and is first-party otherwise.
 */
export function providerGroupOf(provider: ProviderData): ProviderGroup {
  const own = GROUPS[provider.providerId]?.group;
  if (own) return own;
  const groups = new Set(provider.choices.map((choice) => GROUPS[choice.provider]?.group ?? "first-party"));
  return groups.size === 1 ? [...groups][0] : "first-party";
}
const listed = (providerId: string): ProviderData | undefined => PROVIDER_DATA.providers.find((provider) => provider.providerId === providerId);
/**
 * A listed provider by its id, or by another provider id it covers (`github-copilot` is listed as `copilot`,
 * `minimax-portal` belongs to `minimax`).
 */
export const providerById = (providerId: string): ProviderData | undefined =>
  listed(providerId) ?? PROVIDER_DATA.providers.find((provider) => provider.choices.some((choice) => choice.provider === providerId));

/** Ids an endpoint record cannot take: every bundled provider id and the pseudo-providers of the CLI runtimes. */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  ...PROVIDER_DATA.providers.flatMap((provider) => [provider.providerId, ...provider.choices.map((choice) => choice.provider)]),
  "claude-cli", "google-gemini-cli", "codex", "codex-cli", "copilot", "builtin", "jagentchill-unset", "chatgpt-plan",
]);
