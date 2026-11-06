import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenCodeRuntimeClient } from "../src/agents/runtime/clients.ts";

const until = async <T>(promise: Promise<T>, ms = 3000): Promise<T> => Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

test("OpenCode adapter: fake HTTP/SSE server streams tool lifecycle and usage, handles allow/deny, abort, crash, and resume", async () => {
  const originalFetch = globalThis.fetch;
  let eventController: ReadableStreamDefaultController<Uint8Array> | undefined, sessionNumber = 0, promptNumber = 0, aborts = 0;
  const permissionReplies: string[] = [];
  const enc = new TextEncoder();
  const push = (event: unknown) => eventController?.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url), method = request.method;
    if (url.pathname === "/global/health") return Response.json({ healthy: true });
    // The shape OpenCode 1.18 really answers (seen on the owner's machine 2026-10-19): every known provider in `all`, the
    // usable ones in `connected` — OpenCode Zen's free models are usable without a sign-in.
    if (url.pathname === "/provider") return Response.json({
      all: [
        { id: "fixture", models: { "test-model": { id: "test-model", name: "Fixture" } } },
        { id: "opencode", models: { "glm-5.3-flash-free": { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free" }, "deepseek-v4.1-flash-free": { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" } } },
        { id: "not-signed-in", models: { "paid-model": { id: "paid-model", name: "Paid" } } },
      ],
      default: { opencode: "glm-5.3-flash-free" }, connected: ["fixture", "opencode"],
    });
    if (url.pathname === "/session" && method === "POST") return Response.json({ id: `opencode-fixture-${++sessionNumber}` });
    if (url.pathname === "/mcp" && method === "POST") return new Response(null, { status: 204 });
    if (url.pathname === "/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { eventController = controller; }, cancel() { eventController = undefined; } }), { headers: { "content-type": "text/event-stream" } });
    if (/\/prompt_async$/.test(url.pathname)) {
      const body = JSON.parse(await request.text().catch(() => "{}")), prompt = body.parts?.[0]?.text ?? ""; promptNumber++;
      if (prompt === "crash") push({ type: "session.error", properties: { code: "FIXTURE_CRASH", message: "fixture opencode crashed" } });
      else if (prompt === "interrupt") { /* the fake remains active until abort */ }
      else {
        push({ type: "message.part.delta", properties: { delta: "opencode hello" } });
        push({ type: "tool.started", properties: { id: "oc-tool", name: "jc_echo", input: { text: prompt } } });
        push({ type: "tool.updated", properties: { id: "oc-tool", input: { text: prompt }, output: "working" } });
        push({ type: "tool.finished", properties: { id: "oc-tool", name: "jc_echo", input: { text: prompt }, output: "echoed", status: "completed" } });
        push({ type: "message.updated", properties: { info: { tokens: { input: 6, output: 2, cache: { read: 1, write: 0 } }, cost: 0.02 } } });
        push({ type: "permission.asked", properties: { id: `oc-permission-${promptNumber}`, permission: "shell", patterns: ["echo"] } });
        push({ type: "session.idle", properties: { sessionID: url.pathname.split("/")[2] } });
      }
      return Response.json({ accepted: true });
    }
    if (/\/abort$/.test(url.pathname) && method === "POST") { aborts++; return new Response(null, { status: 204 }); }
    if (/\/session\/.*\/permissions\/.*$/.test(url.pathname)) { permissionReplies.push(JSON.parse(await request.text()).response); return new Response("true", { status: 200, headers: { "content-type": "application/json" } }); }
    return new Response(`unexpected ${method} ${url.pathname}`, { status: 404 });
  }) as typeof fetch;
  try {
    const client = new OpenCodeRuntimeClient("http://127.0.0.1:18932");
    assert.equal(await client.isAvailable(), true);
    assert.deepEqual((await client.catalog()).models, [
      { id: "fixture/test-model", label: "Fixture" },
      { id: "opencode/glm-5.3-flash-free", label: "GLM 5.3 Flash Free" }, { id: "opencode/deepseek-v4.1-flash-free", label: "DeepSeek V4.1 Flash Free" },
    ], "the usable providers' models, the free Zen models included; a provider that is not connected is left out");
    const session = await client.createSession({ model: "fixture/test-model", mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=opencode-fixture", mcpToken: "fixture" });
    const events: any[] = []; session.subscribe((event) => events.push(event));
    const { turnId } = await session.startTurn("hello");
    await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
    await session.respondToPermission("oc-permission-1", "allow");
    await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
    assert.ok(events.some((event) => event.type === "turn_started" && event.turnId === turnId));
    assert.ok(events.some((event) => event.type === "assistant_text_delta" && event.text === "opencode hello"));
    assert.ok(events.some((event) => event.type === "tool_call_started" && event.name === "jc_echo"));
    assert.ok(events.some((event) => event.type === "tool_call_updated" && event.id === "oc-tool"));
    assert.ok(events.some((event) => event.type === "tool_call_finished" && event.id === "oc-tool" && event.status === "completed"));
    assert.ok(events.some((event) => event.type === "usage" && event.inputTokens === 6 && event.outputTokens === 2 && event.costUsd === 0.02));
    const handle = session.persistence(); await session.close();
    const resumed = await client.resumeSession(handle); assert.equal(resumed.persistence().sessionId, handle.sessionId); await resumed.close();

    const denied = await client.createSession(); const deniedEvents: any[] = []; denied.subscribe((event) => deniedEvents.push(event));
    await denied.startTurn("deny");
    await until(new Promise<void>((resolve) => { const poll = () => deniedEvents.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
    await denied.respondToPermission("oc-permission-2", "deny");
    assert.ok(deniedEvents.some((event) => event.type === "permission_requested")); await denied.close();
    assert.deepEqual(permissionReplies, ["once", "reject"]);

    const crashed = await client.createSession(); const crashEvents: any[] = []; crashed.subscribe((event) => crashEvents.push(event));
    await crashed.startTurn("crash");
    const failed = await until(new Promise<any>((resolve) => { const poll = () => { const event = crashEvents.find((candidate) => candidate.type === "turn_failed"); return event ? resolve(event) : setTimeout(poll, 10); }; poll(); }));
    assert.equal(failed.code, "FIXTURE_CRASH"); assert.match(failed.diagnostic, /fixture opencode crashed/); await crashed.close();

    const interrupted = await client.createSession(); const interruptEvents: any[] = []; interrupted.subscribe((event) => interruptEvents.push(event));
    await interrupted.startTurn("interrupt"); await interrupted.interrupt();
    assert.equal(aborts, 1); assert.ok(interruptEvents.some((event) => event.type === "turn_cancelled")); await interrupted.close();
  } finally { globalThis.fetch = originalFetch; }
});
