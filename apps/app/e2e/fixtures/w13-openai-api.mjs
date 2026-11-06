// Local OpenAI-compatible API for W13 first-run browser coverage. Never forwards requests.
import { createServer } from "node:http";

const port = Number(process.env.W13_API_STUB_PORT ?? 19113);
if (port !== 19113) throw new Error("W13 API fixture must use port 19113");
let modelRequests = 0;
let authorizedRequests = 0;
let probeRequests = 0;
const server = createServer((request, response) => {
  if (request.url === "/__state" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ modelRequests, probeRequests, authorizedRequests }));
    return;
  }
  if (request.url === "/__reset" && request.method === "POST") {
    modelRequests = 0;
    probeRequests = 0;
    authorizedRequests = 0;
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/v1/models" && request.method === "GET") {
    modelRequests++;
    if (request.headers.authorization === "Bearer sk-local-w13-fixture-key") authorizedRequests++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5.5", object: "model", created: 1_700_000_000, owned_by: "w13-local-fixture" }] }));
    return;
  }
  if (request.url === "/v1/responses" && request.method === "POST") {
    probeRequests++;
    if (request.headers.authorization === "Bearer sk-local-w13-fixture-key") authorizedRequests++;
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      let model = "fixture-model";
      try { model = JSON.parse(body).model ?? model; } catch { /* the caller receives the same deterministic fixture reply */ }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const events = [
        { type: "response.created", response: { id: "resp_w13_fixture", object: "response", status: "in_progress", model } },
        { type: "response.output_text.delta", delta: "local fixture probe passed" },
        { type: "response.completed", response: { id: "resp_w13_fixture", object: "response", status: "completed", model, output: [{ id: "msg_w13_fixture", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "local fixture probe passed", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: "Fixture route not found", type: "invalid_request_error" } }));
});
server.listen(port, "127.0.0.1", () => console.log(`W13 OpenAI-compatible API fixture listening on 127.0.0.1:${port}`));
