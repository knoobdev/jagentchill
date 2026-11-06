import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpEndpoint } from "../src/tools/mcp-endpoint.ts";
import { registerAgentTools } from "../src/tools/mcp.ts";

test("The MCP URL names the session: jc_* calls are served for that session, and a URL naming no known session is refused", async () => {
  const known = new Set(["session-from-url"]);
  const endpoint = createMcpEndpoint({ secret: "unit-test-secret", register(server, directSessionKey) {
    registerAgentTools(server, {
      tools: () => ({ has: () => true, definitions: () => [], call: async () => ({ envelope: { ok: true, warnings: [] }, images: [] }) }) as never,
      session: (key) => (known.has(key) ? { sessionKey: key } as never : undefined), assertBudget: () => undefined,
      ...(directSessionKey ? { directSessionKey } : {}),
    });
  } });
  const http = createServer((req, res) => { void endpoint(req, res); });
  // An ephemeral loopback port: nothing of the owner's running app is touched.
  await new Promise<void>((resolve, reject) => http.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  const headers = { authorization: "Bearer unit-test-secret", "content-type": "application/json", accept: "application/json, text/event-stream" };
  const whoami = async (session: string) => {
    const url = `http://127.0.0.1:${port}/agent-tools/mcp?session=${encodeURIComponent(session)}`;
    const initialized = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } }) });
    assert.equal(initialized.status, 200);
    const mcpSession = initialized.headers.get("mcp-session-id");
    assert.ok(mcpSession);
    const result = await fetch(url, { method: "POST", headers: { ...headers, "mcp-session-id": mcpSession! }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "jc_session_whoami", arguments: {} } }) });
    assert.equal(result.status, 200);
    return result.text();
  };
  try {
    assert.match(await whoami("session-from-url"), /session-from-url/);
    assert.match(await whoami("agent:main:jc:unknown"), /SESSION_UNBOUND/);
    // Without the bearer nothing is served.
    assert.equal((await fetch(`http://127.0.0.1:${port}/agent-tools/mcp?session=session-from-url`, { method: "POST", headers: { ...headers, authorization: "Bearer wrong" }, body: "{}" })).status, 401);
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
