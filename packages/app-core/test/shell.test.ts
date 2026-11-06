import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentPanelPresentation, canDockRoster, checklist, clampAgentPanel, clampChatPane, clampSidebarWidth, clampSidePanel, commitTitle, compareRoutes, createLinkQueue, DESTINATIONS, documentTitle,
  drawerDragStarts, drawerWidth, hostScope, isAssetTab, isLibraryCategory, LIBRARY_CATEGORIES, listHeight, LOCAL_HOST, LOCAL_MENTION_CATEGORIES, matchRoute, mentionOpensUpward, MODES, DEFAULT_MODE,
  MORE, moreCount, moreState, parentList, parseDeepLink, PENDING_ROUTES, pickPromo, PREFS, PRIMARY, promoEligibility, promoFits, readPreference, ROUTE_TABLE, routeAfterHostSwitch, rowMeta,
  secondaryList, sectionCount, sectionOf, sendRoute, startupRoute, STARTER_TIPS, TARGETS, writePreference, type KeyValueStore,
} from "../src/index.ts";

const memory = (): KeyValueStore & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, get: (key) => data.get(key) ?? null, set: (key, value) => { data.set(key, value); }, remove: (key) => { data.delete(key); } }; };
const appDir = join(import.meta.dirname, "../../../apps/app/app");
const walk = (dir: string, prefix = ""): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]));

// The design frame decides which rows the sidebar shows (eight, no "More" row); the spec's other sections keep their routes.
test("Primary navigation — Order and groups: the eight sidebar rows of the design, then the sections without a row", () => {
  assert.deepEqual(PRIMARY.map((entry) => entry.label), ["New", "Projects", "Sessions", "Workflows", "Film Studio", "Automations", "Library", "Devices"]);
  assert.deepEqual(MORE.map((entry) => entry.label), ["Scripts", "Agents", "Workspaces", "Skills", "Usage"]);
  assert.deepEqual(DESTINATIONS.filter((entry) => !entry.needsHost).map((entry) => entry.id), ["home", "projects", "library", "devices", "scripts"]);
  assert.equal(DESTINATIONS.find((entry) => entry.id === "film")!.route("abc"), "/h/abc/film");
  assert.ok(DESTINATIONS.every((entry) => entry.action === `nav.go.${entry.id}`));
});
test("Primary navigation — Selected destination: any Film Studio screen selects the Film Studio row", () => {
  assert.equal(sectionOf("/h/abc/film/f1/episode/e2/storyboard"), "film");
  assert.equal(sectionOf("/projects/folder/x"), "projects");
  assert.equal(sectionOf("/editor/p1"), "projects");
  assert.equal(sectionOf("/settings"), null);
});
test("Primary navigation — Minimum window keeps the list: at 960×600 the list keeps at least 240 px and no promo that would not fit", () => {
  assert.equal(listHeight({ windowHeight: 600, density: "regular", moreExpanded: false }), 284);
  assert.equal(promoFits({ windowHeight: 600, density: "regular", moreExpanded: false, promo: 112 }), false);
  assert.equal(promoFits({ windowHeight: 900, density: "regular", moreExpanded: false, promo: 112 }), true);
});
test("Primary navigation — More at the minimum window: the six destinations open as a popover", () => {
  const state = moreState({ windowHeight: 600, density: "regular", open: true, section: "home" });
  assert.deepEqual([state.presentation, state.expanded], ["popover", false]);
});
test("Primary navigation — More inline on a tall window: the six rows open inline and the list keeps 240 px", () => {
  const state = moreState({ windowHeight: 900, density: "regular", open: true, section: "home" });
  assert.deepEqual([state.presentation, state.expanded], ["inline", true]);
  assert.ok(listHeight({ windowHeight: 900, density: "regular", moreExpanded: true }) >= 240);
  // The open state is restored at the next launch.
  const store = memory();
  writePreference(store, PREFS.moreOpen, true);
  assert.equal(readPreference(store, PREFS.moreOpen), true);
});
test("Primary navigation — Current section inside a closed More group: the row reads \"More · Skills\" and is selected", () => {
  const state = moreState({ windowHeight: 900, density: "regular", open: false, section: sectionOf("/h/abc/skills") });
  assert.deepEqual([state.label, state.selected], ["More · Skills", true]);
  assert.equal(moreState({ windowHeight: 900, density: "regular", open: true, section: "skills" }).selected, false);
});
test("Primary navigation — Attention badge: two sessions with pending approvals show \"2\", and none once resolved", () => {
  assert.equal(sectionCount([{ section: "sessions" }, { section: "sessions" }, { section: "workflows" }], [], "sessions"), 2);
  assert.equal(sectionCount([], [], "sessions"), 0);
  assert.equal(moreCount({ agents: 1, workspaces: 2, sessions: 9 }), 3);
});
test("Primary navigation — Failed run stops counting when opened", () => {
  assert.equal(sectionCount([], [{ section: "workflows", opened: false }], "workflows"), 1);
  assert.equal(sectionCount([], [{ section: "workflows", opened: true }], "workflows"), 0);
});
test("Primary navigation — Destination without a host: Skills in local-only mode is the requires-host state", () => {
  assert.equal(DESTINATIONS.find((entry) => entry.id === "skills")!.route(LOCAL_HOST), "/h/local/skills");
  assert.equal(hostScope("/h/local/skills", [], null), "requires-host");
});
test("Sidebar header and host switcher — Switch host: Sessions of host A becomes /h/<B>/sessions", () => {
  assert.equal(routeAfterHostSwitch("/h/a/sessions/s1", "b"), "/h/b/sessions");
  assert.equal(routeAfterHostSwitch("/h/a/workflows/runs/r1", "b"), "/h/b/workflows");
});
test("Sidebar header and host switcher — Local-only mode: local routes stay and host-scoped ones show the requires-host state", () => {
  assert.equal(routeAfterHostSwitch("/projects/folder/f1", LOCAL_HOST), "/projects/folder/f1");
  assert.equal(routeAfterHostSwitch("/h/a/film", LOCAL_HOST), "/h/local/film");
  assert.equal(hostScope("/h/local/film", ["a"], null), "requires-host");
  assert.equal(hostScope("/projects", ["a"], null), "local-route");
  assert.equal(hostScope("/h/a/sessions", ["a"], "a"), "ok");
  assert.equal(hostScope("/h/a/sessions", ["a"], null), "requires-host", "a paired host that is offline");
});
test("Sidebar secondary list — every route pattern shows its own detail list or no list on index and listless routes", () => {
  const value = (name: string) => ({ hostId: "w7-host", projectId: "w7-project", folderId: "w7-folder", scriptId: "w7-script", category: "luts", itemId: "w7-item", deviceId: "w7-device", section: "general", version: "1-0-0", sessionId: "w7-session", workflowId: "w7-workflow", runId: "w7-run", filmId: "w7-film", episodeId: "w7-episode", stage: "story", workspaceId: "w7-workspace", automationId: "w7-automation", skillId: "w7-skill", tab: "overview" } as Record<string, string>);
  for (const route of ROUTE_TABLE) {
    const pathname = route.pattern.replace(/\[(\w+)\]/g, (_match, name: string) => value(name)[name]);
    const section = sectionOf(pathname);
    for (const connected of [false, true]) {
      let expected: ReturnType<typeof secondaryList>;
      const index = new Set(["/projects", "/scripts", "/library", "/library/[category]", "/library/[category]/[itemId]", "/devices", "/h/[hostId]/sessions", "/h/[hostId]/sessions/import", "/h/[hostId]/workflows", "/h/[hostId]/workflows/video", "/h/[hostId]/film", "/h/[hostId]/film/hub", "/h/[hostId]/film/hub/[folderId]", "/h/[hostId]/automations", "/h/[hostId]/automations/new", "/h/[hostId]/agents", "/h/[hostId]/workspaces", "/h/[hostId]/workspaces/new", "/h/[hostId]/workspaces/open", "/h/[hostId]/skills"]);
      if (!section || section === "usage" || index.has(route.pattern) || pathname === "/projects/trash") expected = null;
      else if (section === "home") expected = { section, list: connected ? "sessions" : "projects" };
      else expected = { section, list: section };
      assert.deepEqual(secondaryList(pathname, connected, null), expected, `${route.pattern} (hostConnected=${connected})`);
    }
  }
  for (const path of ["/settings/general", "/devices", "/pair/scan", "/exports", "/notifications", "/changelog", "/does-not-exist"]) {
    assert.equal(secondaryList(path, false, "automations"), null, `${path} never inherits the last section's list`);
  }
});
test("Sidebar secondary list — Home, Library and Devices use their own spec lists", () => {
  assert.deepEqual(secondaryList("/home", true, null), { section: "home", list: "sessions" });
  assert.deepEqual(secondaryList("/home", false, null), { section: "home", list: "projects" });
  assert.equal(secondaryList("/library", true, "sessions"), null);
  assert.equal(secondaryList("/library/luts/w7-item", false, "sessions"), null);
  assert.equal(secondaryList("/devices", false, "sessions"), null);
  assert.deepEqual(secondaryList("/devices/w7-device", true, null), { section: "devices", list: "devices" });
  assert.equal(LIBRARY_CATEGORIES.length, 7);
});
test("Sidebar secondary list — Status meta line priority: running with a pending approval reads \"Needs approval\" in warning", () => {
  assert.deepEqual(rowMeta({ attention: "Needs approval", running: "Working", updated: "2h ago" }), { text: "Needs approval", tone: "warning", running: false });
  assert.deepEqual(rowMeta({ running: "Rendering 42%", updated: "now" }), { text: "Rendering 42%", tone: undefined, running: true });
  assert.equal(rowMeta({ failed: true, ready: "Export ready", updated: "" }).tone, "danger");
});
test("Sidebar secondary list — Ready status: a finished run with an export reads \"Export ready\" in success", () => {
  assert.deepEqual(rowMeta({ ready: "Export ready", finished: "Completed", updated: "" }), { text: "Export ready", tone: "success", running: false });
});
test("Sidebar secondary list — Completed is purple", () => {
  assert.deepEqual(rowMeta({ finished: "Completed", updated: "1h ago" }), { text: "Completed", tone: "purple", running: false });
  assert.equal(rowMeta({ updated: "1h ago" }).text, "1h ago");
});
test("Sidebar footer — Promo dismissal: a dismissed card is not shown again for 30 days", () => {
  const day = 86_400_000;
  assert.equal(pickPromo(["pair-phone"], { "pair-phone": 0 }, 29 * day), null);
  assert.equal(pickPromo(["pair-phone"], { "pair-phone": 0 }, 31 * day), "pair-phone");
  assert.equal(pickPromo(["update"], { update: 0 }, day), "update", "the update card returns at the next launch");
  assert.equal(pickPromo(["update"], {}, day, ["update"]), null);
});
test("Sidebar footer — Promo priority: \"Update ready\" wins over \"Pair your phone\"", () => {
  assert.equal(pickPromo(["pair-phone", "update"], {}, 0), "update");
});
test("Sidebar footer — Download URL not configured: \"Install the desktop app\" is never eligible", () => {
  const base = { desktopApp: false, desktopOs: true, updateReady: false, builtInHostRunning: false, mobilePaired: false };
  assert.deepEqual(promoEligibility({ ...base, downloadUrl: undefined }), []);
  assert.deepEqual(promoEligibility({ ...base, downloadUrl: "https://example.test/download" }), ["desktop"]);
  assert.deepEqual(promoEligibility({ ...base, desktopOs: false, downloadUrl: "https://example.test/download" }), []);
});
test("Sidebar collapse, resize and persistence — Collapse and restore: the collapsed state and the width survive a restart", () => {
  const store = memory();
  writePreference(store, PREFS.sidebarCollapsed, true);
  writePreference(store, PREFS.sidebarWidth, 300);
  // A restart reads the same store again.
  assert.equal(readPreference(store, PREFS.sidebarCollapsed), true);
  assert.equal(readPreference(store, PREFS.sidebarWidth), 300);
});
test("Sidebar collapse, resize and persistence — Resize limits: a drag to 150 px stops at 200 px", () => {
  assert.equal(clampSidebarWidth(150), 200);
  assert.equal(clampSidebarWidth(500), 360);
  assert.equal(clampSidebarWidth(251.4), 251);
});
test("Top bar — Inline rename: the title is saved trimmed", () => {
  assert.deepEqual(commitTitle("Old", "  New name  "), { save: "New name" });
});
test("Top bar — Empty rename reverts: a cleared title restores the previous one and saves nothing", () => {
  assert.deepEqual(commitTitle("Old", "   "), { revert: true });
  assert.deepEqual(commitTitle("Old", "Old"), { revert: true });
});
test("Top bar — Title length limit: 300 pasted characters leave the first 120", () => {
  const result = commitTitle("Old", "y".repeat(300));
  assert.equal("save" in result && result.save.length, 120);
});
test("Home composer — Mode list: exactly Ask, Plan, Edit and Auto, Edit by default, and Video and Film are targets", () => {
  assert.deepEqual(MODES.map((mode) => mode.label), ["Ask", "Plan", "Edit", "Auto"]);
  assert.equal(DEFAULT_MODE, "edit");
  assert.equal(readPreference(memory(), PREFS.composerMode), "edit");
  assert.deepEqual(TARGETS.map((target) => target.label), ["Chat", "Video", "Film"]);
});
test("Home composer — Start a session, Video target and Film target navigate by target", () => {
  assert.equal(sendRoute("session", "abc", { sessionId: "agent:main:jc:1" }), "/h/abc/sessions/agent%3Amain%3Ajc%3A1");
  assert.equal(sendRoute("video", "abc", { runId: "r1" }), "/h/abc/workflows/runs/r1");
  assert.equal(sendRoute("film", "abc", { filmId: "f1", episodeId: "e1" }), "/h/abc/film/f1/episode/e1/story");
});
test("Composer mentions — Popover placement: 120 px above the bottom of the window opens upward", () => {
  assert.equal(mentionOpensUpward(780, 900), true);
  assert.equal(mentionOpensUpward(300, 900), false);
});
test("Composer mentions — Local-only mode: only the categories that exist without a host", () => {
  assert.deepEqual([...LOCAL_MENTION_CATEGORIES], ["Projects", "Media", "Scripts", "Templates"]);
});
test("Getting-started checklist — Derived completion: importing a first media file checks \"Import media\" with no click", () => {
  const before = checklist({ projects: 1, projectsWithMedia: 0, exportsCompleted: 0, hostsPaired: 0, providersReady: 0, workflowRunsSucceeded: 0 });
  const after = checklist({ projects: 1, projectsWithMedia: 1, exportsCompleted: 0, hostsPaired: 0, providersReady: 0, workflowRunsSucceeded: 0 });
  assert.deepEqual([before.done, after.done, after.total], [1, 2, 6]);
  assert.equal(after.rows.find((row) => row.id === "media")!.done, true);
  assert.deepEqual(after.rows.map((row) => row.label), ["Create or open a project", "Import media", "Export a video", "Connect a host", "Add a model provider key", "Make a video from a prompt"]);
  assert.equal(checklist({ projects: 1, projectsWithMedia: 1, exportsCompleted: 1, hostsPaired: 1, providersReady: 1, workflowRunsSucceeded: 1 }).allSet, true);
});
test("Getting-started checklist — OAuth alone completes the step: one ready provider by any method checks the row", () => {
  assert.equal(checklist({ projects: 0, projectsWithMedia: 0, exportsCompleted: 0, hostsPaired: 1, providersReady: 1, workflowRunsSucceeded: 0 }).rows.find((row) => row.id === "provider")!.done, true);
});
test("Getting-started checklist — Starter prompt: exactly five prompts and the fourth sets the target Film", () => {
  assert.equal(STARTER_TIPS.length, 5);
  assert.deepEqual([STARTER_TIPS[3].key, STARTER_TIPS[3].target, STARTER_TIPS[3].text], ["shell.starter.4", "film", "Turn this short story into a three-scene film with one narrator"]);
  assert.deepEqual(STARTER_TIPS.map((tip) => tip.target), ["video", "session", "session", "film", "session"]);
});
test("Getting-started checklist — Dismiss and restore: the dismissal is a stored flag that Help ▸ \"Starter tips\" clears", () => {
  const store = memory();
  writePreference(store, PREFS.checklistDismissed, true);
  assert.equal(readPreference(store, PREFS.checklistDismissed), true);
  writePreference(store, PREFS.checklistDismissed, false);
  assert.equal(readPreference(store, PREFS.checklistDismissed), false);
});
test("Session split view — Minimum widths: the chat pane stops at 320 px", () => {
  assert.equal(clampChatPane(100, 1000 - 240), 320);
});
test("Session split view — Maximum chat width: the chat pane stops at 60% of the content width", () => {
  assert.equal(clampChatPane(5000, 1360), 816);
});
test("Session split view — Roster needs width: 900 px cannot dock the roster, 944 px can", () => {
  assert.deepEqual([canDockRoster(900), canDockRoster(930), canDockRoster(944)], [false, false, true]);
});
test("Editor four-region layout — Percentage limit: the inspector stops at 40%", () => {
  assert.equal(clampSidePanel(55, 1440), 40);
});
test("Editor four-region layout — Pixel floor on a narrow wide window: at 1000 px the inspector stops at 280 px, not 150 px", () => {
  assert.equal(Math.round(clampSidePanel(5, 1000) * 10), 280, "28% of 1000 px");
});
test("Editor asset panel tabs — Unknown tab id: assets-panel.show returns false", () => {
  assert.equal(isAssetTab("effects"), true);
  assert.equal(isAssetTab("settings"), false);
});
test("Editor agent panel — Width limits: a drag to 200 px stops at 320 px", () => {
  assert.equal(clampAgentPanel(200, 1600), 320);
});
test("Editor agent panel — Narrow wide window: at 1,100 px the panel is the overlay", () => {
  assert.equal(agentPanelPresentation(1100), "overlay");
  assert.equal(agentPanelPresentation(1600), "docked");
});
test("Mobile drawer and top bar — the drawer is 86% of the screen up to 320 px and never opens from the edge zone", () => {
  assert.deepEqual([drawerWidth(390), drawerWidth(320)], [320, 275]);
  assert.deepEqual([drawerDragStarts(10, 390), drawerDragStarts(40, 390), drawerDragStarts(380, 390, true), drawerDragStarts(340, 390, true)], [false, true, false, true]);
});
test("Route map — Unknown route: /does-not-exist matches no row", () => {
  assert.equal(matchRoute("/does-not-exist"), null);
  assert.equal(matchRoute("/library/unknown"), null);
  assert.equal(matchRoute("/library/luts")?.row.pattern, "/library/[category]");
});
test("Route map — Host-scoped route without that host: /h/abc/sessions/123 on a device not paired with abc", () => {
  assert.equal(matchRoute("/h/abc/sessions/123")?.row.host, true);
  assert.equal(hostScope("/h/abc/sessions/123", ["other"], "other"), "not-paired");
});
test("Route map — Film stage route: the stage is a member of its closed set", () => {
  assert.deepEqual(matchRoute("/h/abc/film/f1/episode/e2/storyboard")?.params, { hostId: "abc", filmId: "f1", episodeId: "e2", stage: "storyboard" });
  assert.equal(matchRoute("/h/abc/film/f1/episode/e2/nonsense"), null);
});
test("Route map — Route table matches the router: every route file has a row, and every row has a file or is listed as pending", () => {
  const result = compareRoutes(walk(appDir), PENDING_ROUTES);
  assert.deepEqual(result.unlisted, [], "route files with no row in the route map");
  assert.deepEqual(result.missing, [], "rows with no route file that are not listed as pending");
  assert.deepEqual(result.stalePending, [], "pending entries whose file now exists");
  // A file added without a row is named.
  assert.deepEqual(compareRoutes([...walk(appDir), "surprise/index.tsx"], PENDING_ROUTES).unlisted, ["/surprise"]);
  assert.equal(new Set(ROUTE_TABLE.map((row) => row.pattern)).size, ROUTE_TABLE.length);
  assert.equal(documentTitle("Trip"), "Trip — JAgentChill");
});
test("Deep links and file types — Session link on a phone: jagentchill://h/abc/sessions/s_1 is that route", () => {
  assert.deepEqual(parseDeepLink("jagentchill://h/abc/sessions/s_1"), { kind: "route", path: "/h/abc/sessions/s_1" });
  assert.deepEqual(parseDeepLink("jagentchill://exports/history?job=j1"), { kind: "route", path: "/exports/history?job=j1" });
  assert.deepEqual(parseDeepLink("jagentchill://pair#offer=abc_DEF-1"), { kind: "pair", offer: "abc_DEF-1" });
  assert.deepEqual(parseDeepLink("jagentchill://editor/p1"), { kind: "route", path: "/editor/p1" });
});
test("Deep links and file types — Malformed link: jagentchill://editor/../../x is not valid", () => {
  assert.equal(parseDeepLink("jagentchill://editor/../../x"), null);
  assert.equal(parseDeepLink("jagentchill://settings/host/abc/unknown/x/y/z"), null);
  assert.equal(parseDeepLink("jagentchill://library/unknown"), null);
  assert.equal(parseDeepLink("https://example.test/editor/p1"), null);
  assert.equal(parseDeepLink(`jagentchill://editor/${"a".repeat(5000)}`), null);
  assert.equal(parseDeepLink("jagentchill://editor/p1?delete=1"), null, "a link only navigates: unknown parameters are refused");
});
test("Deep links and file types — Link during a blocking modal: links wait in arrival order, ten at most", () => {
  const queue = createLinkQueue();
  for (let index = 0; index < 12; index++) queue.push(`jagentchill://editor/p${index}`);
  assert.equal(queue.size, 10);
  assert.deepEqual(queue.drain().slice(0, 2), ["jagentchill://editor/p0", "jagentchill://editor/p1"]);
  assert.equal(queue.size, 0);
});
test("Startup routing and restore — Restore last route: the last visited route opens when it is still valid", () => {
  assert.equal(startupRoute({ welcomeSeen: true, lastRoute: "/h/abc/sessions/s1" }), "/h/abc/sessions/s1");
  assert.equal(startupRoute({ welcomeSeen: true, lastRoute: null }), "/home");
  assert.equal(startupRoute({ welcomeSeen: true, lastRoute: "/gone/forever" }), "/home");
  assert.equal(startupRoute({ welcomeSeen: false, lastRoute: "/projects" }), "/welcome");
  assert.equal(startupRoute({ welcomeSeen: true, pairingStep: "/pair/tailnet", lastRoute: "/projects" }), "/pair/tailnet");
});
test("Startup routing and restore — Restored target deleted: the parent list opens instead", () => {
  assert.equal(startupRoute({ welcomeSeen: true, lastRoute: "/editor/p1", lastRouteValid: false }), "/home");
  assert.equal(parentList("/editor/p1"), "/projects");
  assert.equal(parentList("/h/abc/sessions/s1"), "/h/abc/sessions");
});
test("Startup routing and restore — Deep link has priority over the last visited route", () => {
  assert.equal(startupRoute({ deepLink: "/editor/p9", welcomeSeen: true, lastRoute: "/projects" }), "/editor/p9");
});
test("Shell state persistence — Invalid stored entry: defaults apply, the entry is removed and startup continues", () => {
  const store = memory();
  store.set(PREFS.editorPanels.key, JSON.stringify({ v: 1, value: { top: 999, assets: "wide" } }));
  assert.deepEqual(readPreference(store, PREFS.editorPanels), { top: 50, assets: 25, inspector: 25 });
  assert.equal(store.data.has(PREFS.editorPanels.key), false);
  store.set(PREFS.sidebarWidth.key, "{ not json");
  assert.equal(readPreference(store, PREFS.sidebarWidth), 240);
  assert.ok(Object.values(PREFS).every((pref) => pref.key.startsWith("jagentchill.")), "keys are namespaced jagentchill.*");
});
test("Project views and view persistence — Persisted view: list view sorted by Name ascending is restored after a restart", () => {
  const store = memory();
  assert.deepEqual([readPreference(store, PREFS.projectsView), readPreference(store, PREFS.projectsSortKey), readPreference(store, PREFS.projectsSortOrder)], ["grid", "modified", "desc"]);
  writePreference(store, PREFS.projectsView, "list"); writePreference(store, PREFS.projectsSortKey, "name"); writePreference(store, PREFS.projectsSortOrder, "asc");
  assert.deepEqual([readPreference(store, PREFS.projectsView), readPreference(store, PREFS.projectsSortKey), readPreference(store, PREFS.projectsSortOrder)], ["list", "name", "asc"]);
});
test("Library screen — Categories: Templates, Preset packs, Fonts, LUTs, Saved sounds, Stickers and Brand kits in that order", () => {
  assert.deepEqual(LIBRARY_CATEGORIES.map((entry) => entry.label), ["Templates", "Preset packs", "Fonts", "LUTs", "Saved sounds", "Stickers", "Brand kits"]);
});
test("Library screen — Unknown category: /library/unknown is not a category", () => {
  assert.equal(isLibraryCategory("unknown"), false);
  assert.equal(isLibraryCategory("brand-kits"), true);
});
