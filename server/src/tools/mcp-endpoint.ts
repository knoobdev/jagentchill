import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AGENT_INSTRUCTIONS } from "./context.ts";

export type ToolRegistrar = (server: McpServer, directSessionKey?: string) => void;

/**
 * The agent-tool endpoint of the JAgentChill Server. The agent CLIs the server starts reach JAgentChill's tools here over
 * MCP Streamable HTTP; the bearer secret is known only to this server and handed to each runtime session it opens, with
 * the session named in the URL (`?session=<key>`).
 */
export function createMcpEndpoint(opts: { secret: string; register: ToolRegistrar; onSessionClosed?: (mcpSessionId: string) => void }) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${opts.secret}`) {
      res.writeHead(401).end();
      return;
    }
    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    }
    const sessionId = req.headers["mcp-session-id"];
    let transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session" }, id: null }));
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { transports.set(id, created); },
      });
      created.onclose = () => {
        if (!created.sessionId) return;
        transports.delete(created.sessionId);
        opts.onSessionClosed?.(created.sessionId);
      };
      // `instructions` is what an MCP client hands its model about this server as a whole.
      const server = new McpServer({ name: "jagentchill", version: "0.0.0" }, { instructions: AGENT_INSTRUCTIONS });
      const directSessionKey = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("session") ?? undefined;
      (server.server as typeof server.server & { _jagentchillDirectSessionKey?: string })._jagentchillDirectSessionKey = directSessionKey;
      opts.register(server, directSessionKey);
      await server.connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res, body);
  };
}
