import type { SessionRecord } from "../agents/sessions.ts";

export type ToolSurface = "editor" | "team" | "film" | "workflow" | "workflow-run" | "general";

/** The surface is product context, not an ORC model role. */
export function surfaceForSession(session: Pick<SessionRecord, "toolSurface" | "agentId" | "scriptId" | "projectId">): ToolSurface {
  if (session.toolSurface) return session.toolSurface;
  if (session.agentId === "jagentchill-team") return "team";
  if (session.scriptId) return "film";
  if (session.projectId) return "editor";
  return "general";
}

const shared = new Set(["jc_server_info", "jc_echo", "jc_session_whoami", "jc_tool_help"]);

/** Names visible to the model and accepted by the MCP guard for a product surface. */
export function toolNamesForSurface(names: readonly string[], surface: ToolSurface): string[] {
  return names.filter((name) => {
    if (shared.has(name)) return true;
    if (surface === "general") return true;
    if (surface === "film") return name.startsWith("jc_film_");
    if (surface === "workflow") return !name.startsWith("jc_film_") && !name.startsWith("jc_agent_") && !name.startsWith("jc_team_") && name !== "jc_review_submit";
    if (surface === "workflow-run") return !name.startsWith("jc_film_") && !name.startsWith("jc_agent_") && !name.startsWith("jc_team_") && name !== "jc_review_submit" && name !== "jc_session_ask";
    return !name.startsWith("jc_film_") && !name.startsWith("jc_workflow_");
  });
}

export function deniedToolNames(names: readonly string[], surface: ToolSurface): string[] {
  const allowed = new Set(toolNamesForSurface(names, surface));
  return names.filter((name) => !allowed.has(name));
}
