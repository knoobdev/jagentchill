import { clampInput } from "../projects/logic.ts";
import { matchRoute } from "./routes.ts";

/** The destinations of the app: the eight rows of the sidebar, then the sections that have routes but no sidebar row. */
export type Destination = {
  id: string; group: "primary" | "more"; label: string; icon: string; needsHost: boolean; action: string;
  route(hostId: string): string; match: RegExp;
};
/** The host id of "This device only": host-scoped routes under it show the requires-host state. */
export const LOCAL_HOST = "local";
const hosted = (id: string, label: string, icon: string, group: Destination["group"], segment = id): Destination =>
  ({ id, group, label, icon, needsHost: true, action: `nav.go.${id}`, route: (hostId) => `/h/${hostId}/${segment}`, match: new RegExp(`^/h/[^/]+/${segment}(/|$)`) });
const local = (id: string, label: string, icon: string, group: Destination["group"]): Destination =>
  ({ id, group, label, icon, needsHost: false, action: `nav.go.${id}`, route: () => `/${id}`, match: new RegExp(`^/${id}(/|$)`) });
export const DESTINATIONS: readonly Destination[] = [
  // The sidebar of the design: eight primary rows. "New" is the Home screen with its composer.
  local("home", "New", "plus", "primary"), local("projects", "Projects", "folder", "primary"), hosted("sessions", "Sessions", "chat", "primary"),
  hosted("workflows", "Workflows", "flow", "primary"), hosted("film", "Film Studio", "film", "primary"), hosted("automations", "Automations", "zap", "primary"),
  local("library", "Library", "library", "primary"), local("devices", "Devices", "device", "primary"),
  // Sections with routes of their own that the sidebar does not list.
  local("scripts", "Scripts", "doc", "more"), hosted("agents", "Agents", "bot", "more"),
  hosted("workspaces", "Workspaces", "box", "more"), hosted("skills", "Skills", "spark", "more"), hosted("usage", "Usage", "gauge", "more"),
];
export const PRIMARY = DESTINATIONS.filter((destination) => destination.group === "primary");
export const MORE = DESTINATIONS.filter((destination) => destination.group === "more");
export const destinationById = (id: string | null) => DESTINATIONS.find((destination) => destination.id === id);

/** The section a route belongs to: the destination whose row is selected. The editor and `/projects/*` belong to Projects. */
export function sectionOf(pathname: string): string | null {
  if (pathname === "/") return "home";
  if (/^\/editor(\/|$)/.test(pathname)) return "projects";
  if (/^\/h\/[^/]+\/scripts\//.test(pathname)) return "scripts";
  return DESTINATIONS.find((destination) => destination.match.test(pathname))?.id ?? null;
}
/** Routes whose main area is already the section list must not repeat it in the sidebar. */
const INDEX_ROUTES = new Set(["/projects", "/scripts", "/library", "/devices"]);
const HOST_INDEX_ROUTES = [
  /^\/h\/[^/]+\/sessions\/?$/, /^\/h\/[^/]+\/workflows\/?$/, /^\/h\/[^/]+\/film\/?$/,
  /^\/h\/[^/]+\/film\/hub\/?$/, /^\/h\/[^/]+\/automations\/?$/, /^\/h\/[^/]+\/agents\/?$/,
  /^\/h\/[^/]+\/workspaces\/?$/, /^\/h\/[^/]+\/skills\/?$/,
];
const LISTLESS_DETAILS = [
  /^\/h\/[^/]+\/sessions\/import\/?$/, /^\/h\/[^/]+\/workflows\/video\/?$/,
  /^\/h\/[^/]+\/film\/hub(?:\/[^/]+)?\/?$/, /^\/h\/[^/]+\/automations\/new\/?$/,
  /^\/h\/[^/]+\/workspaces\/(?:new|open)\/?$/,
];
const hasOwnIndex = (pathname: string): boolean => INDEX_ROUTES.has(pathname) || /^\/library\//.test(pathname) || HOST_INDEX_ROUTES.some((route) => route.test(pathname)) || LISTLESS_DETAILS.some((route) => route.test(pathname));
export type SecondaryList = { section: string; list: string } | null;
/**
 * Which index the sidebar shows under the navigation. Every section owns its list; Home shows the host's sessions when
 * a host is connected and the projects otherwise. A section index already displays its list in the main area, and
 * routes without a section never inherit another section's list.
 */
export function secondaryList(pathname: string, hostConnected: boolean, _lastSection: string | null): SecondaryList {
  const section = matchRoute(pathname) ? sectionOf(pathname) : null;
  if (!section || hasOwnIndex(pathname) || pathname === "/projects/trash") return null;
  if (section === "usage") return null;
  if (section === "home") return { section, list: hostConnected ? "sessions" : "projects" };
  return { section, list: section };
}

export const SIDEBAR = { width: 240, min: 200, max: 360, header: 48, footer: 44, listMin: 240, listHeader: 28, edgeReveal: 3, revealDelay: 300, revealDwell: 650 } as const;
export const clampSidebarWidth = (width: number): number => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(width)));
export const rowHeight = (density: "regular" | "touch"): number => (density === "touch" ? 44 : 28);
/** Height the sidebar body needs for the More group to open inline: 14 rows, the list header and 240 px of list. */
export const inlineMoreHeight = (density: "regular" | "touch"): number => 14 * rowHeight(density) + SIDEBAR.listHeader + SIDEBAR.listMin;
/** Height of the sidebar between its header and its footer. */
export const sidebarBody = (windowHeight: number): number => windowHeight - SIDEBAR.header - SIDEBAR.footer;
export type MoreState = { presentation: "inline" | "popover"; expanded: boolean; label: string; selected: boolean };
/**
 * The "More" row. It opens inline only where that leaves the list 240 px; otherwise the same six rows open as a popover.
 * While it is closed (or a popover) and the current section is one of its six, it reads "More · <section>" and is selected.
 */
export function moreState(input: { windowHeight: number; density: "regular" | "touch"; open: boolean; section: string | null; drawer?: boolean }): MoreState {
  if (input.drawer) return { presentation: "inline", expanded: true, label: "More", selected: false };
  const presentation = sidebarBody(input.windowHeight) >= inlineMoreHeight(input.density) ? "inline" : "popover";
  const expanded = presentation === "inline" && input.open;
  const current = MORE.find((destination) => destination.id === input.section);
  return { presentation, expanded, label: current && !expanded ? `More · ${current.label}` : "More", selected: Boolean(current) && !expanded };
}
/** Height left for the secondary list with the given fixed parts. */
export function listHeight(input: { windowHeight: number; density: "regular" | "touch"; moreExpanded: boolean; promo?: number }): number {
  const rows = (input.moreExpanded ? 14 : 8) * rowHeight(input.density);
  return sidebarBody(input.windowHeight) - rows - (input.promo ?? 0);
}
/** A promo card is shown only while the list keeps 240 px. */
export const promoFits = (input: { windowHeight: number; density: "regular" | "touch"; moreExpanded: boolean; promo: number }): boolean => listHeight(input) >= SIDEBAR.listMin;

export type PromoId = "update" | "desktop" | "pair-phone";
export const PROMO_ORDER: readonly PromoId[] = ["update", "desktop", "pair-phone"];
export const PROMO_DISMISS_MS = 30 * 86_400_000;
/** The one promo card to show: the first eligible one in priority order that is not dismissed. The update card ignores dismissal across launches. */
export function pickPromo(eligible: readonly PromoId[], dismissed: Readonly<Record<string, number>>, now_ms: number, dismissedThisLaunch: readonly PromoId[] = []): PromoId | null {
  for (const id of PROMO_ORDER) {
    if (!eligible.includes(id) || dismissedThisLaunch.includes(id)) continue;
    if (id !== "update" && dismissed[id] !== undefined && now_ms - dismissed[id] < PROMO_DISMISS_MS) continue;
    return id;
  }
  return null;
}
export function promoEligibility(input: { desktopApp: boolean; desktopOs: boolean; updateReady: boolean; downloadUrl: string | undefined; builtInHostRunning: boolean; mobilePaired: boolean; hostConnected?: boolean }): PromoId[] {
  const out: PromoId[] = [];
  if (input.desktopApp && input.updateReady) out.push("update");
  if (!input.desktopApp && input.desktopOs && input.downloadUrl) out.push("desktop");
  // With a connected host a phone can be paired from any surface (the sidebar card of the design).
  if (((input.desktopApp && input.builtInHostRunning) || input.hostConnected) && !input.mobilePaired) out.push("pair-phone");
  return out;
}

/** Switching host: a host-scoped route becomes the same section's index under the new host; local routes stay. */
export function routeAfterHostSwitch(pathname: string, hostId: string): string {
  const section = DESTINATIONS.find((destination) => destination.needsHost && destination.match.test(pathname));
  if (section) return section.route(hostId);
  return /^\/h\/[^/]+(\/|$)/.test(pathname) || /^\/settings\/host\//.test(pathname) ? "/home" : pathname;
}
export type HostScope = "ok" | "not-paired" | "requires-host" | "local-route";
/** What a route shows with the hosts this device knows: its screen, "not paired", or the requires-host state. */
export function hostScope(pathname: string, pairedHostIds: readonly string[], connectedHostId: string | null): HostScope {
  const match = matchRoute(pathname);
  const hostId = match?.params.hostId ?? /^\/h\/([^/]+)/.exec(pathname)?.[1];
  if (!hostId) return "local-route";
  if (hostId === LOCAL_HOST) return "requires-host";
  if (!pairedHostIds.includes(hostId)) return "not-paired";
  return connectedHostId === hostId ? "ok" : "requires-host";
}

/** The count badge of a section: unresolved requests for action plus failed runs nobody has opened yet. */
export function sectionCount(requiresAction: readonly { section: string }[], failedRuns: readonly { section: string; opened: boolean }[], section: string): number {
  return requiresAction.filter((entry) => entry.section === section).length + failedRuns.filter((run) => run.section === section && !run.opened).length;
}
export const COUNTED_SECTIONS = ["sessions", "workflows", "film", "scripts", "agents", "workspaces", "automations"] as const;
export const moreCount = (counts: Readonly<Record<string, number>>): number => MORE.reduce((sum, destination) => sum + (counts[destination.id] ?? 0), 0);

/** The meta line of a list row, in priority order. */
export type RowStatus = { attention?: string; running?: string; failed?: boolean; ready?: string; finished?: string; updated: string };
export function rowMeta(status: RowStatus): { text: string; tone: "warning" | "danger" | "success" | "purple" | undefined; running: boolean } {
  if (status.attention) return { text: status.attention, tone: "warning", running: false };
  if (status.running) return { text: status.running, tone: undefined, running: true };
  if (status.failed) return { text: "Failed", tone: "danger", running: false };
  if (status.ready) return { text: status.ready, tone: "success", running: false };
  if (status.finished) return { text: status.finished, tone: "purple", running: false };
  return { text: status.updated, tone: undefined, running: false };
}
export const RECENT_PAGE = 30;

/** An inline title edit: Enter or blur saves the trimmed value, an empty value reverts, 120 characters at most. */
export function commitTitle(previous: string, text: string): { save: string } | { revert: true } {
  const next = clampInput(text.trim()).trim();
  return next.length === 0 || next === previous ? { revert: true } : { save: next };
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TARGETS = [{ id: "session", label: "Chat" }, { id: "video", label: "Video" }, { id: "film", label: "Film" }] as const;
export type ComposerTarget = (typeof TARGETS)[number]["id"];
export const MODES = [{ id: "ask", label: "Ask" }, { id: "plan", label: "Plan" }, { id: "edit", label: "Edit" }, { id: "auto", label: "Auto" }] as const;
export type ComposerMode = (typeof MODES)[number]["id"];
export const DEFAULT_MODE: ComposerMode = "edit";
/** Where sending from Home navigates, by target. */
export function sendRoute(target: ComposerTarget, hostId: string, ids: { sessionId?: string; runId?: string; filmId?: string; episodeId?: string }): string {
  if (target === "video") return `/h/${hostId}/workflows/runs/${ids.runId}`;
  if (target === "film") return `/h/${hostId}/film/${ids.filmId}/episode/${ids.episodeId}/story`;
  return `/h/${hostId}/sessions/${encodeURIComponent(ids.sessionId ?? "")}`;
}
export const QUICK_START = [
  { id: "blank", label: "New blank project", icon: "plus", needsHost: false }, { id: "import", label: "Import media", icon: "download", needsHost: false },
  { id: "prompt", label: "Prompt to video", icon: "spark", needsHost: true }, { id: "film", label: "New film", icon: "film", needsHost: true },
  { id: "template", label: "Use a template", icon: "template", needsHost: false },
] as const;
/** The one pill of the Home composer: what sending starts. Agent, Plan and Ask are sessions in a mode; Video and Film are targets. */
export const COMPOSER_KINDS = [
  { id: "agent", label: "Agent", text: "The agent acts with tools", icon: "bot", target: "session" }, { id: "plan", label: "Plan", text: "Proposes a plan; no change until approved", icon: "list", target: "session" },
  { id: "ask", label: "Ask", text: "Read-only answers", icon: "help", target: "session" }, { id: "video", label: "Video", text: "Starts a prompt-to-video workflow", icon: "spark", target: "video" },
  { id: "film", label: "Film", text: "Starts a film from a story", icon: "film", target: "film" },
] as const;
export type ComposerKind = (typeof COMPOSER_KINDS)[number]["id"];
/** The pill value for a stored target and mode, and back. Edit and Auto are both "Agent"; Run options chooses between them. */
export const composerKind = (target: ComposerTarget, mode: ComposerMode): ComposerKind => (target !== "session" ? target : mode === "plan" ? "plan" : mode === "ask" ? "ask" : "agent");
export function applyComposerKind(kind: ComposerKind, mode: ComposerMode): { target: ComposerTarget; mode: ComposerMode } {
  if (kind === "video" || kind === "film") return { target: kind, mode };
  return { target: "session", mode: kind === "agent" ? (mode === "auto" ? "auto" : "edit") : kind };
}
export const STARTER_TIPS: readonly { key: string; text: string; target: ComposerTarget }[] = [
  { key: "shell.starter.1", text: "Make a 30-second vertical recap of my last project with captions and upbeat music", target: "video" },
  { key: "shell.starter.2", text: "Cut the silences and filler words from the open project and add subtitles", target: "session" },
  { key: "shell.starter.3", text: "Write a 60-second script about a morning coffee routine and build a draft timeline from it", target: "session" },
  { key: "shell.starter.4", text: "Turn this short story into a three-scene film with one narrator", target: "film" },
  { key: "shell.starter.5", text: "Build a workflow that makes a weekly highlight video from new clips in my library", target: "session" },
];
export type ChecklistFacts = { projects: number; projectsWithMedia: number; exportsCompleted: number; hostsPaired: number; providersReady: number; workflowRunsSucceeded: number };
export const CHECKLIST = [
  { id: "project", label: "Create or open a project" }, { id: "media", label: "Import media" }, { id: "export", label: "Export a video" },
  { id: "host", label: "Connect a host" }, { id: "provider", label: "Add a model provider key" }, { id: "prompt", label: "Make a video from a prompt" },
] as const;
/** The checklist is derived from real state, never from clicks. */
export function checklist(facts: ChecklistFacts): { rows: { id: string; label: string; done: boolean }[]; done: number; total: number; allSet: boolean } {
  const done: Record<string, boolean> = {
    project: facts.projects > 0, media: facts.projectsWithMedia > 0, export: facts.exportsCompleted > 0, host: facts.hostsPaired > 0,
    provider: facts.providersReady > 0, prompt: facts.workflowRunsSucceeded > 0,
  };
  const rows = CHECKLIST.map((entry) => ({ ...entry, done: done[entry.id] }));
  const count = rows.filter((entry) => entry.done).length;
  return { rows, done: count, total: rows.length, allSet: count === rows.length };
}
/** The mention popover opens upward when fewer than 280 px remain below the caret. */
export const mentionOpensUpward = (caretBottom: number, windowHeight: number): boolean => windowHeight - caretBottom < 280;
export const LOCAL_MENTION_CATEGORIES = ["Projects", "Media", "Scripts", "Templates"] as const;

/** The first screen at launch, in the order the requirement gives. */
export function startupRoute(input: { deepLink?: string | null; welcomeSeen: boolean; pairingStep?: string | null; lastRoute?: string | null; lastRouteValid?: boolean }): string {
  if (input.deepLink) return input.deepLink;
  if (!input.welcomeSeen) return "/welcome";
  if (input.pairingStep) return input.pairingStep;
  if (input.lastRoute && input.lastRouteValid !== false && input.lastRoute !== "/" && matchRoute(input.lastRoute)) return input.lastRoute;
  return "/home";
}
/** The list a deleted target's route falls back to. */
export function parentList(pathname: string): string {
  if (/^\/editor\//.test(pathname)) return "/projects";
  const hosted = /^(\/h\/[^/]+\/[^/]+)\/.+/.exec(pathname);
  return hosted ? hosted[1] : "/home";
}

// ── Layout numbers of the frames this capability owns ────────────────────────────────────────────────────────────────

export const SPLIT = { chatDefault: 0.4, chatMin: 320, chatMax: 0.6, workspaceMin: 360, mediumOverlay: 420, column: 720, roster: 264, dockMin: 944 } as const;
/** The chat pane's width for a requested width: never under 320 px, never over 60 % of the content (50 % with a docked roster). */
export function clampChatPane(requested: number, contentWidth: number, rosterDocked = false): number {
  const max = Math.min(contentWidth * (rosterDocked ? 0.5 : SPLIT.chatMax), contentWidth - SPLIT.workspaceMin - (rosterDocked ? SPLIT.roster : 0));
  return Math.round(Math.max(SPLIT.chatMin, Math.min(max, requested)));
}
export const canDockRoster = (contentWidth: number): boolean => contentWidth >= SPLIT.dockMin;
export const EDITOR_PANELS = {
  top: { default: 50, min: 30, max: 85 }, timeline: { default: 50, min: 15, max: 70 }, assets: { default: 25, min: 15, max: 40 },
  player: { default: 50, min: 30, max: 100 }, inspector: { default: 25, min: 15, max: 40 }, floor: 280,
} as const;
/** A side panel's width in percent of the editor: inside its limits and never narrower than 280 px. */
export function clampSidePanel(percent: number, editorWidth: number, panel: "assets" | "inspector" = "inspector"): number {
  const limits = EDITOR_PANELS[panel], floor = (EDITOR_PANELS.floor / editorWidth) * 100;
  return Math.min(limits.max, Math.max(limits.min, floor, percent));
}
export const AGENT_PANEL = { width: 360, min: 320, maxShare: 0.4, overlay: 420, remainingMin: 860 } as const;
export function agentPanelPresentation(editorWidth: number, width: number = AGENT_PANEL.width): "docked" | "overlay" {
  return editorWidth - width >= AGENT_PANEL.remainingMin ? "docked" : "overlay";
}
export const clampAgentPanel = (width: number, editorWidth: number): number =>
  Math.round(Math.max(AGENT_PANEL.min, Math.min(width, editorWidth * AGENT_PANEL.maxShare, editorWidth - AGENT_PANEL.remainingMin)));
export const ASSET_TABS = ["media", "audio", "text", "stickers", "effects", "transitions", "captions", "transcript", "filters", "adjustment", "templates", "ai", "brand-kit"] as const;
/** `assets-panel.show`: `false` for a tab id that is not in the table. */
export const isAssetTab = (id: string): boolean => (ASSET_TABS as readonly string[]).includes(id);
/** The drawer of compact form factors: 86 % of the screen width, 320 px at most. */
export const drawerWidth = (screenWidth: number): number => Math.min(320, Math.round(screenWidth * 0.86));
/** A drag opens the drawer only when it starts more than 24 px inside the inline-start edge. */
export const drawerDragStarts = (startX: number, screenWidth: number, rtl = false): boolean => (rtl ? screenWidth - startX : startX) > 24;
