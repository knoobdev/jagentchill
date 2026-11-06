import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolEnvelope } from "@jagentchill/protocol";
import type { SessionRecord } from "../agents/sessions.ts";
import type { ToolService } from "./service.ts";
import { surfaceForSession, toolNamesForSurface } from "./surfaces.ts";

export type AgentToolDeps = {
  tools: () => ToolService;
  /** The server's record of a session. */
  session: (sessionKey: string) => SessionRecord | undefined;
  /** Refuses the call when a spending limit of the session is reached. */
  assertBudget: (sessionKey: string) => void;
  log?: (text: string) => void;
  /**
   * The session this MCP connection serves: the server names it in the URL it gives the runtime (`?session=<key>`),
   * captured by the endpoint from the authenticated request. Nothing the model says takes part in it.
   */
  directSessionKey?: string;
};
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

/** Small MCP utilities; help returns a full description and schema only when a client asks for a tool. */
const TRIAL = [
  { name: "jc_server_info", description: "Describe the JAgentChill Server this agent is attached to.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "jc_echo", description: "Return the given text unchanged.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
  { name: "jc_session_whoami", description: "Report which JAgentChill agent session is calling this tool.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "jc_tool_help", description: "Get the full description and input schema for one JAgentChill tool.", inputSchema: { type: "object", properties: { name: { type: "string", description: "Exact tool name from the tool list." } }, required: ["name"], additionalProperties: false } },
];
const failure = (code: string, message: string, retryable: boolean, details?: Record<string, unknown>): Result => {
  const envelope: ToolEnvelope = { ok: false, warnings: [], error: { code, message, retryable, ...(details ? { details } : {}) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(envelope) }] };
};
/** Keep argument constraints in the always-loaded list; move explanatory prose to jc_tool_help. */
function compactSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "description").map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map((item) => item && typeof item === "object" ? compactSchema(item as Record<string, unknown>) : item)
      : value && typeof value === "object" ? compactSchema(value as Record<string, unknown>) : value,
  ]));
}

/**
 * Serves the `jc_*` tools on one MCP connection. The tool list is the same for every caller; every call is served for
 * the session named in the connection's URL, and a connection that names no known session executes nothing.
 */
export function registerAgentTools(server: McpServer, deps: AgentToolDeps): void {
  const low = server.server;
  const directSessionKey = deps.directSessionKey ?? (low as typeof low & { _jagentchillDirectSessionKey?: string })._jagentchillDirectSessionKey;
  low.registerCapabilities({ tools: {} });
  low.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    ...TRIAL,
    ...deps.tools().definitions().map((tool) => ({
      ...tool,
      description: `${tool.name}: JAgentChill editing tool. Call jc_tool_help with this exact name for usage details.`,
      inputSchema: compactSchema(tool.inputSchema),
    })),
  ] }));
  low.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<Result> => {
    const name = request.params.name, args = (request.params.arguments ?? {}) as Record<string, unknown>;
    if (name === "jc_server_info") return { content: [{ type: "text", text: JSON.stringify({ server: "jagentchill", version: "0.0.0" }) }] };
    if (name === "jc_echo") { deps.log?.(`jc_echo called (${String(args.text ?? "").length} chars)`); return { content: [{ type: "text", text: String(args.text ?? "") }] }; }
    if (name !== "jc_session_whoami" && name !== "jc_tool_help" && !deps.tools().has(name)) return failure("TOOL_NOT_AVAILABLE", `The tool ${name} is not served by this host.`, false, { tool: name });
    const known = directSessionKey ? deps.session(directSessionKey) : undefined;
    const binding = known ? { ok: true as const, sessionKey: known.sessionKey } : { ok: false as const, reason: "no_session" };
    deps.log?.(`${name} mcp=${extra.sessionId} → ${JSON.stringify(binding)}`);
    if (!binding.ok) {
      if (name === "jc_session_whoami") return { isError: true, content: [{ type: "text", text: `SESSION_UNBOUND (${binding.reason}); call the tool again.` }] };
      // The denied call is audited by the tool service, under a key no session has.
      await deps.tools().call(`unbound:${extra.sessionId ?? ""}`, name, args);
      return failure("SESSION_UNBOUND", "The server could not tell which agent session is calling. Call the tool again.", true, { reason: binding.reason });
    }
    const session = deps.session(binding.sessionKey);
    const names = [...TRIAL.map((tool) => tool.name), ...deps.tools().definitions().map((tool) => tool.name)];
    const allowed = new Set(toolNamesForSurface(names, session ? surfaceForSession(session) : "general"));
    if (name === "jc_tool_help") {
      const requested = typeof args.name === "string" ? args.name : "";
      if (!allowed.has(requested)) {
        // A name the model made up (jc_generate_voice for jc_generate_speech): no tool of that name exists at all, and
        // the tools whose names share words with it are what it was looking for.
        if (!names.includes(requested)) {
          const words = new Set(requested.replace(/^jc_/, "").split("_").filter((word) => word.length > 2));
          const near = [...allowed].map((tool) => ({ tool, score: tool.replace(/^jc_/, "").split("_").filter((word) => words.has(word)).length })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((entry) => entry.tool);
          return failure("TOOL_NOT_AVAILABLE", `There is no tool named ${requested || "(empty name)"}.${near.length ? ` Tools with similar names: ${near.join(", ")}.` : " List the tools you have and pick one of those names."}`, false, { tool: requested, ...(near.length ? { similar: near } : {}) });
        }
        return failure("TOOL_NOT_AVAILABLE", `The tool ${requested} is not available on this surface.`, false, { tool: requested });
      }
      const definition = deps.tools().definitions().find((tool) => tool.name === requested);
      return definition
        ? { content: [{ type: "text", text: JSON.stringify(definition) }] }
        : failure("TOOL_NOT_AVAILABLE", `The tool ${requested || "(empty name)"} is not served by this host.`, false, { tool: requested });
    }
    if (!allowed.has(name)) return failure("TOOL_NOT_AVAILABLE", `The tool ${name} is not available on this surface.`, false, { tool: name, surface: session ? surfaceForSession(session) : "general" });
    try { deps.assertBudget(session?.sessionKey ?? binding.sessionKey); } catch (error) {
      const message = error instanceof Error ? error.message : "Budget reached";
      return name === "jc_session_whoami" ? { isError: true, content: [{ type: "text", text: `BUDGET_EXCEEDED: ${message}` }] } : failure("BUDGET_EXCEEDED", message, false);
    }
    if (name === "jc_session_whoami") return { content: [{ type: "text", text: binding.sessionKey }] };
    const { envelope, images } = await deps.tools().call(session?.sessionKey ?? binding.sessionKey, name, args);
    return { ...(envelope.ok ? {} : { isError: true }), content: [{ type: "text", text: JSON.stringify(envelope) }, ...images.map((image) => ({ type: "image" as const, data: image.dataBase64, mimeType: image.mime }))] };
  });
}
