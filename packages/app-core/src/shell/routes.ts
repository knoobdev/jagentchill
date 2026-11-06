/**
 * The route map of `app-shell-navigation.Route map`: the only route list of the product. Patterns use expo-router
 * segments (`[param]`); `host` marks the routes that need a connected host.
 */
export type RouteRow = { pattern: string; host: boolean; owner: string };
const row = (pattern: string, owner: string, host = false): RouteRow => ({ pattern, host, owner });
const STAGES = ["story", "script", "assets", "storyboard", "video", "voice", "sound", "timeline"] as const;
export const LIBRARY_CATEGORIES = [
  { id: "templates", label: "Templates" }, { id: "packs", label: "Preset packs" }, { id: "fonts", label: "Fonts" }, { id: "luts", label: "LUTs" },
  { id: "sounds", label: "Saved sounds" }, { id: "stickers", label: "Stickers" }, { id: "brand-kits", label: "Brand kits" },
] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]["id"];
export const isLibraryCategory = (value: string): value is LibraryCategory => LIBRARY_CATEGORIES.some((category) => category.id === value);
const EXPORT_TABS = ["queue", "history", "links"] as const;
const USAGE_TABS = ["overview", "providers", "projects", "sessions", "plan"] as const;

export const ROUTE_TABLE: readonly RouteRow[] = [
  row("/", "app-shell-navigation.Startup routing and restore"),
  row("/welcome", "app-shell-navigation.First-run welcome"),
  row("/pair/start", "device-pairing-signing.Pairing flow on the new device"), row("/pair/scan", "device-pairing-signing.Pairing flow on the new device"),
  row("/pair/link", "device-pairing-signing.Pairing flow on the new device"), row("/pair/tailnet", "device-pairing-signing.Tailnet login step"),
  row("/pair/verify", "device-pairing-signing.Pairing flow on the new device"),
  row("/pair", "device-pairing-signing.Pairing flow on the new device"),
  row("/pair-link", "device-pairing-signing.Pairing flow on the new device"), row("/pair-scan", "device-pairing-signing.Pairing flow on the new device"),
  row("/pair-start", "device-pairing-signing.Pairing flow on the new device"),
  row("/join-tailnet", "device-pairing-signing.Tailnet login step"), row("/host/add-connection", "device-pairing-signing.Add host connection"),
  row("/home", "app-shell-navigation.Home screen"),
  row("/projects", "projects.Projects list"), row("/projects/folder/[folderId]", "projects.Project folders"), row("/projects/trash", "projects.Trash"),
  row("/editor/[projectId]", "app-shell-navigation.Editor four-region layout"),
  row("/scripts", "script-studio.Scripts list"), row("/scripts/[scriptId]", "script-studio.Editor layout"), row("/scripts/[scriptId]/review", "script-studio.Review screen"),
  row("/h/[hostId]/scripts/[scriptId]", "script-studio.Entry points", true),
  row("/library", "app-shell-navigation.Library screen"), row("/library/[category]", "app-shell-navigation.Library screen"), row("/library/[category]/[itemId]", "app-shell-navigation.Library screen"),
  row("/exports", "app-shell-navigation.Exports screen"), row("/exports/[tab]", "app-shell-navigation.Exports screen"),
  row("/devices", "device-pairing-signing.Device list management"), row("/devices/[deviceId]", "device-pairing-signing.Device list management", true),
  row("/settings/devices", "settings-preferences.Legacy device settings redirect"),
  row("/notifications", "notifications.Notification inbox"),
  row("/settings", "settings-preferences.Settings navigation structure"), row("/settings/[section]", "settings-preferences.Settings navigation structure"),
  row("/settings/host/[hostId]", "settings-preferences.Settings navigation structure", true), row("/settings/host/[hostId]/[section]", "settings-preferences.Settings navigation structure", true),
  row("/settings/host/[hostId]/[section]/[itemId]", "settings-preferences.Settings navigation structure", true),
  row("/changelog", "updates-distribution.Release notes view"), row("/changelog/[version]", "updates-distribution.Release notes view"),
  row("/h/[hostId]/sessions", "chat-agent.Session list in the sidebar", true), row("/h/[hostId]/sessions/import", "agent-runtimes.Session import from a CLI's native history", true),
  row("/h/[hostId]/sessions/[sessionId]", "chat-agent.Session split view", true),
  row("/h/[hostId]/workflows", "agent-workflows.Workflows list screen", true), row("/h/[hostId]/workflows/[workflowId]", "workflow-diagram.Hosting in the Workflows screens and automations", true),
  row("/h/[hostId]/workflows/runs/[runId]", "agent-workflows.Run view", true), row("/h/[hostId]/workflows/video", "prompt-to-video-workflow.Workflow run entry points and Gateway dependency", true),
  row("/h/[hostId]/film", "film-production.Film list and creation", true), row("/h/[hostId]/film/hub", "film-production.Asset hub shared across films", true),
  row("/h/[hostId]/film/hub/[folderId]", "film-production.Asset hub shared across films", true), row("/h/[hostId]/film/[filmId]", "film-production.Studio navigation and stage tabs", true),
  row("/h/[hostId]/film/[filmId]/direction", "film-production.Creative direction and style bible", true),
  row("/h/[hostId]/film/[filmId]/episode/[episodeId]/[stage]", "film-production.Studio navigation and stage tabs", true),
  row("/h/[hostId]/agents", "multi-agent-orchestration.Host-wide Agents screen", true), row("/h/[hostId]/agents/runs/[runId]", "multi-agent-orchestration.Team run panel", true),
  row("/h/[hostId]/workspaces", "workspaces-terminal.Workspaces index and start tiles", true), row("/h/[hostId]/workspaces/new", "workspaces-terminal.New workspace screen", true),
  row("/h/[hostId]/workspaces/open", "workspaces-terminal.New workspace screen", true), row("/h/[hostId]/workspaces/[workspaceId]", "workspaces-terminal.Workspace screen layout", true),
  row("/h/[hostId]/automations", "automations.Automations index", true), row("/h/[hostId]/automations/new", "automations.Automation editor", true),
  row("/h/[hostId]/automations/[automationId]", "automations.Automation detail and run history", true),
  row("/h/[hostId]/skills", "skills.Skills screen — Installed", true), row("/h/[hostId]/skills/[skillId]", "skills.Skill detail", true),
  row("/h/[hostId]/usage", "usage-tracking.Usage screen — Overview", true), row("/h/[hostId]/usage/[tab]", "usage-tracking.Usage screen — Overview", true),
  row("/_catalogue", "design-system.Component state coverage and catalogue"),
];

/** Members of the closed sets a dynamic segment may take; any other segment is a free id. */
const CLOSED: Record<string, readonly string[]> = { category: LIBRARY_CATEGORIES.map((category) => category.id), tab: [...EXPORT_TABS, ...USAGE_TABS], stage: STAGES };
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export type RouteMatch = { row: RouteRow; params: Record<string, string> };

const segmentsOf = (path: string) => path.split("/").filter(Boolean);
/** The row a path belongs to. Literal segments win over parameters; parameters match the id pattern or their closed set. */
export function matchRoute(path: string): RouteMatch | null {
  const parts = segmentsOf(path.split(/[?#]/)[0]);
  let best: (RouteMatch & { literals: number }) | null = null;
  for (const candidate of ROUTE_TABLE) {
    const pattern = segmentsOf(candidate.pattern);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0, ok = true;
    for (const [index, segment] of pattern.entries()) {
      const name = /^\[(\w+)\]$/.exec(segment)?.[1];
      if (!name) { if (segment !== parts[index]) { ok = false; break; } literals++; continue; }
      let value: string;
      try { value = decodeURIComponent(parts[index]); } catch { ok = false; break; }
      const closed = CLOSED[name];
      // A session key is the one id that may carry characters outside the id pattern (it is percent-encoded in the path).
      if (closed ? !closed.includes(value) : name !== "sessionId" && !ID_PATTERN.test(value)) { ok = false; break; }
      params[name] = value;
    }
    if (ok && (!best || literals > best.literals)) best = { row: candidate, params, literals };
  }
  return best ? { row: best.row, params: best.params } : null;
}

/** The pattern of a file of the expo-router tree: `h/[hostId]/sessions/index.tsx` → `/h/[hostId]/sessions`. Layout files are not routes. */
export function routeOfFile(file: string): string | null {
  const path = file.replace(/\.(tsx|ts|jsx|js)$/, "");
  if (/(^|\/)_layout$/.test(path)) return null;
  const parts = path.split("/").filter((part) => !/^\(.*\)$/.test(part));
  if (parts.at(-1)?.startsWith("+")) return null;
  if (parts[parts.length - 1] === "index") parts.pop();
  return `/${parts.join("/")}`;
}
/** What differs between the route table and the router's files. Both lists are empty when they agree. */
export function compareRoutes(files: readonly string[], pending: readonly string[] = []): { unlisted: string[]; missing: string[]; stalePending: string[] } {
  const present = new Set(files.map(routeOfFile).filter((route): route is string => route !== null));
  const listed = new Set(ROUTE_TABLE.map((entry) => entry.pattern));
  return {
    unlisted: [...present].filter((route) => !listed.has(route)).sort(),
    missing: [...listed].filter((route) => !present.has(route) && !pending.includes(route)).sort(),
    // A pending entry whose file exists (or that the table no longer names) must leave the pending list.
    stalePending: pending.filter((route) => present.has(route) || !listed.has(route)).sort(),
  };
}

export const DEEP_LINK_SCHEME = "jagentchill://";
export const DEEP_LINK_MAX = 4096;
export const DEEP_LINK_QUEUE = 10;
/** Query parameters a route accepts; anything else makes the link invalid. */
const QUERIES: Record<string, readonly string[]> = {
  "/editor/[projectId]": ["scene", "time"], "/scripts/[scriptId]": ["version", "scene"], "/scripts/[scriptId]/review": ["review"],
  "/h/[hostId]/scripts/[scriptId]": ["version", "scene", "review"], "/exports/[tab]": ["job"], "/devices": ["pair"],
  "/h/[hostId]/sessions/[sessionId]": ["tab", "agent", "item"], "/h/[hostId]/workflows": ["tab"], "/h/[hostId]/workflows/[workflowId]": ["node"],
  "/h/[hostId]/workflows/runs/[runId]": ["node", "diagram"], "/h/[hostId]/workflows/video": ["prompt", "runtimeId", "providerId", "modelId"], "/h/[hostId]/workspaces/[workspaceId]": ["file", "terminal"], "/h/[hostId]/agents": ["tab"], "/h/[hostId]/skills": ["tab"], "/pair/link": ["offer"],
};
export type DeepLink = { kind: "route"; path: string } | { kind: "pair"; offer: string };
/**
 * Strict parsing of a `jagentchill://` link (or, on web, of a path under the app origin). A link only navigates: the one
 * non-route form, `jagentchill://pair#offer=…`, opens the offer review. `null` is "This link is not valid".
 */
export function parseDeepLink(link: string): DeepLink | null {
  if (link.length > DEEP_LINK_MAX || !link.startsWith(DEEP_LINK_SCHEME)) return null;
  const rest = link.slice(DEEP_LINK_SCHEME.length);
  const pair = /^pair#offer=([A-Za-z0-9_-]+)$/.exec(rest);
  if (pair) return { kind: "pair", offer: pair[1] };
  if (rest.includes("#") || rest.includes("..") || rest.includes("//") || rest.startsWith("/")) return null;
  const [pathPart, query = ""] = rest.split("?");
  if (rest.split("?").length > 2 || !/^[A-Za-z0-9_\-/%+.]*$/.test(pathPart)) return null;
  const path = `/${pathPart.replace(/\/$/, "")}`;
  const match = matchRoute(path);
  if (!match || match.row.pattern === "/+not-found" || match.row.pattern === "/_catalogue" || match.row.pattern === "/") return null;
  const allowed = QUERIES[match.row.pattern] ?? [];
  const params = new URLSearchParams(query);
  for (const [key, value] of params) if (!allowed.includes(key) || value.length === 0 || !/^[A-Za-z0-9_\-.:]{1,256}$/.test(value)) return null;
  return { kind: "route", path: query ? `${path}?${query}` : path };
}
/** Links that arrive during a blocking modal or before startup routing has finished wait here, in arrival order. */
export function createLinkQueue(limit: number = DEEP_LINK_QUEUE) {
  const waiting: string[] = [];
  return {
    get size() { return waiting.length; },
    /** `false`: the queue is full and the link is dropped. */
    push(link: string): boolean { if (waiting.length >= limit) return false; waiting.push(link); return true; },
    drain(): string[] { return waiting.splice(0, waiting.length); },
  };
}
/** "<item or screen> — JAgentChill". */
export const documentTitle = (name: string): string => `${name} — JAgentChill`;
