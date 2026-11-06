/**
 * Routes of the route map whose screen has no file in the router yet, because the capability that owns the screen is
 * not built. The route-map test fails when a route is missing and not listed here, and when a listed one has a file.
 */
export const PENDING_ROUTES: readonly string[] = [
  "/pair/scan", "/pair/link", "/pair/tailnet", "/pair/verify",
  "/h/[hostId]/scripts/[scriptId]", "/library/[category]/[itemId]",
  "/devices/[deviceId]",
  "/changelog", "/changelog/[version]",
  "/h/[hostId]/sessions/import",
  "/h/[hostId]/film/hub", "/h/[hostId]/film/hub/[folderId]", "/h/[hostId]/film/[filmId]/direction",
  "/h/[hostId]/agents/runs/[runId]",
  "/h/[hostId]/workspaces", "/h/[hostId]/workspaces/new", "/h/[hostId]/workspaces/open", "/h/[hostId]/workspaces/[workspaceId]",
];
