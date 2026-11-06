import { ORC_LLM_TASK_ROUTES, type OrcCapabilityType, type OrcConfig, type OrcProfile, type OrcRoleConfig, type OrcRoute } from "@jagentchill/protocol";

/** One role as `jagentchill.orc.config.get` describes it. */
export type OrcRoleView = {
  id: string; label: string; description: string; capability: OrcCapabilityType; group: "coordination" | "creative" | "understanding" | "generation" | "custom";
  builtin: boolean; state: "ready" | "not_configured" | "primary_failing" | "disabled"; taskRoutes: string[];
  /** Each profile of the role with the reason it cannot serve right now, when there is one. */
  profiles: Array<{ id: string; unusableReason?: string }>;
};
export type OrcDescription = { config: OrcConfig; revision: number; roles: OrcRoleView[] };

/** The captions the role cards are grouped under, in page order. */
export const ORC_GROUPS: ReadonlyArray<{ id: OrcRoleView["group"]; label: string }> = [
  { id: "coordination", label: "Coordination" }, { id: "creative", label: "Agents" }, { id: "understanding", label: "Understanding" }, { id: "generation", label: "Generation" }, { id: "custom", label: "Custom" },
];
export const ROLE_STATE_LABEL: Record<OrcRoleView["state"], { label: string; tone: "success" | "neutral" | "danger" }> = {
  ready: { label: "Ready", tone: "success" }, not_configured: { label: "Not configured", tone: "neutral" }, primary_failing: { label: "Primary failing", tone: "danger" }, disabled: { label: "Disabled", tone: "neutral" },
};
export const ROLE_ICON: Record<string, string> = {
  supervisor: "shield", lead: "flag", peer: "user", director: "bot", screenwriter: "pencil", storyboard: "grid", editor: "split", reviewer: "check", vision: "eye", translation: "globe",
  transcription: "transcript", image: "image", video: "video", "voice-tts": "mic", "voice-design": "sliders", music: "music", sfx: "vol", lipsync: "smile",
};
export const MAX_FALLBACKS = 5;

/** Roles whose label, id or description contains the query, grouped under the page's captions; empty groups are left out. */
export function groupedRoles(roles: OrcRoleView[], query: string): Array<{ id: string; label: string; roles: OrcRoleView[] }> {
  const needle = query.trim().toLowerCase();
  const shown = roles.filter((role) => !needle || role.label.toLowerCase().includes(needle) || role.id.includes(needle));
  return ORC_GROUPS.map((group) => ({ ...group, roles: shown.filter((role) => (role.builtin ? role.group : "custom") === group.id) })).filter((group) => group.roles.length > 0);
}

export const emptyRole = (): OrcRoleConfig => ({ enabled: true, profiles: [], routes: {}, limits: {} });
export const roleConfig = (config: OrcConfig, roleId: string): OrcRoleConfig => config.roles[roleId] ?? emptyRole();
export const defaultProfile = (role: OrcRoleConfig): OrcProfile | undefined => role.profiles.find((profile) => profile.id === role.defaultProfileId) ?? role.profiles[0];
/** "<provider> · <model> · thinking medium", the header summary of a role card. */
export const profileSummary = (profile: OrcProfile | undefined, providerLabel: (id: string) => string): string | null =>
  profile ? [providerLabel(profile.provider), profile.model, profile.thinking ? `thinking ${profile.thinking}` : null].filter(Boolean).join(" · ") : null;
export const profileOptions = (profile: OrcProfile): string =>
  [profile.thinking ? `thinking ${profile.thinking}` : null, profile.mode ? `mode ${profile.mode}` : null, ...Object.entries(profile.params ?? {}).filter(([, value]) => typeof value !== "object").map(([key, value]) => `${key} ${String(value)}`)].filter(Boolean).join(" · ");

/** The routes of a role in display order: `default`, the built-in task routes, then custom ones. */
export function routeIds(role: OrcRoleView, config: OrcRoleConfig): string[] {
  const builtin = role.capability === "llm" && role.taskRoutes.length === 0 ? [...ORC_LLM_TASK_ROUTES] : role.taskRoutes;
  const custom = Object.keys(config.routes).filter((id) => id !== "default" && !builtin.includes(id));
  return ["default", ...builtin, ...custom];
}
/** The routes that name a profile, by their display name — what a refused deletion states. */
export function routesUsing(config: OrcRoleConfig, profileId: string): string[] {
  return Object.entries(config.routes).filter(([, route]) => route.primary.profileId === profileId || route.fallbacks.some((target) => target.profileId === profileId)).map(([id]) => id);
}
export const routeLabel = (routeId: string): string => { const last = routeId.split(".").pop()!; return last[0].toUpperCase() + last.slice(1).replace(/_/g, " "); };

/** Why a profile cannot be deleted, or `null`: the default profile and a profile a route uses stay. */
export function deleteRefusal(config: OrcRoleConfig, profileId: string): string | null {
  const used = routesUsing(config, profileId);
  if (used.length) return `Used by route ${routeLabel(used[0])}`;
  if (config.profiles.length > 1 && (config.defaultProfileId ?? config.profiles[0]?.id) === profileId) return "This is the default profile — choose another default first";
  return null;
}

export const slugOf = (label: string): string => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);

export function withProfile(config: OrcRoleConfig, profile: OrcProfile): OrcRoleConfig {
  const exists = config.profiles.some((entry) => entry.id === profile.id);
  const profiles = exists ? config.profiles.map((entry) => (entry.id === profile.id ? profile : entry)) : [...config.profiles, profile];
  // The first profile of a role is its default and serves the default route.
  const defaultProfileId = config.defaultProfileId ?? profile.id;
  const routes = config.routes.default ? config.routes : { ...config.routes, default: { primary: { profileId: defaultProfileId }, fallbacks: [] } };
  return { ...config, profiles, defaultProfileId, routes };
}
export function withoutProfile(config: OrcRoleConfig, profileId: string): OrcRoleConfig {
  const profiles = config.profiles.filter((profile) => profile.id !== profileId);
  if (profiles.length === 0) return { ...config, profiles, defaultProfileId: undefined, routes: {} };
  return { ...config, profiles };
}
export function withDefault(config: OrcRoleConfig, profileId: string): OrcRoleConfig {
  const previous = config.defaultProfileId;
  // The default route follows the default profile while it was still pointing at the previous one.
  const route = config.routes.default;
  const routes = !route || route.primary.profileId === previous ? { ...config.routes, default: { ...route, fallbacks: route?.fallbacks ?? [], primary: { profileId } } } : config.routes;
  return { ...config, defaultProfileId: profileId, routes };
}
export function moveProfile(config: OrcRoleConfig, profileId: string, by: -1 | 1): OrcRoleConfig {
  const from = config.profiles.findIndex((profile) => profile.id === profileId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= config.profiles.length) return config;
  const profiles = [...config.profiles];
  [profiles[from], profiles[to]] = [profiles[to], profiles[from]];
  return { ...config, profiles };
}

const routeOf = (config: OrcRoleConfig, routeId: string): OrcRoute => config.routes[routeId] ?? { primary: { profileId: config.defaultProfileId ?? config.profiles[0]?.id ?? "default" }, fallbacks: [] };
export const withRoute = (config: OrcRoleConfig, routeId: string, change: (route: OrcRoute) => OrcRoute): OrcRoleConfig => ({ ...config, routes: { ...config.routes, [routeId]: change(routeOf(config, routeId)) } });
export const withoutRoute = (config: OrcRoleConfig, routeId: string): OrcRoleConfig => ({ ...config, routes: Object.fromEntries(Object.entries(config.routes).filter(([id]) => id !== routeId)) });
/** Appends a fallback as the last one; a route holds at most five. */
export const addFallback = (route: OrcRoute, profileId: string): OrcRoute => (route.fallbacks.length >= MAX_FALLBACKS ? route : { ...route, fallbacks: [...route.fallbacks, { profileId }] });
export const removeFallback = (route: OrcRoute, index: number): OrcRoute => ({ ...route, fallbacks: route.fallbacks.filter((_, at) => at !== index) });
/** The profiles a route may still take as a fallback: enabled, not its primary and not already in the chain. */
export const fallbackChoices = (config: OrcRoleConfig, route: OrcRoute): OrcProfile[] =>
  config.profiles.filter((profile) => profile.enabled !== false && profile.id !== route.primary.profileId && !route.fallbacks.some((target) => target.profileId === profile.id));
/** The first target after an unhealthy primary that can serve: "Next request: <profile>". */
export function nextRequest(route: OrcRoute, usable: (profileId: string) => boolean): string | null {
  if (usable(route.primary.profileId)) return null;
  return route.fallbacks.find((target) => usable(target.profileId))?.profileId ?? null;
}

/** The form of the profile modal checked before "Save" is enabled. */
export function profileProblems(draft: { id: string; label: string; provider: string; model: string; extraBody: string }, existingIds: readonly string[], editing: boolean): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!draft.provider) problems.provider = "Choose a provider";
  if (!draft.model) problems.model = "Choose a model";
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(draft.id)) problems.id = "Lower-case letters, digits and hyphens, starting with a letter";
  else if (!editing && existingIds.includes(draft.id)) problems.id = "A profile with this ID exists";
  if (draft.label.length > 60) problems.label = "At most 60 characters";
  if (draft.extraBody.trim()) {
    if (extraBodyBytes(draft.extraBody) > 8192) problems.extraBody = "Larger than 8,192 bytes";
    else try { const parsed = JSON.parse(draft.extraBody); if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) problems.extraBody = "Must be a JSON object"; } catch { problems.extraBody = "Not valid JSON"; }
  }
  return problems;
}
export const extraBodyBytes = (text: string): number => new TextEncoder().encode(text.trim()).length;
/** "9,000 / 8,192 bytes". */
export const extraBodyCounter = (text: string): { text: string; over: boolean } => { const bytes = extraBodyBytes(text); return { text: `${bytes.toLocaleString("en-US")} / 8,192 bytes`, over: bytes > 8192 }; };
