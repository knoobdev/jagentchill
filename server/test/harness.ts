// Test support. The agent runtimes here are FAKES of the runtime layer (`server/src/agents/runtime/types.ts`): every
// runtime client the server builds is an in-memory stand-in that records every call and lets a test report what the
// runtime would (`emit`, `text`, `endTurn`). No CLI is started either: the command runner is a table. The runtime
// adapters themselves are tested against fake CLIs in runtime-layer.test.ts.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServerApp, type ServerApp } from "../src/app.ts";
import type { PermissionAnswer, RuntimeAttachment, RuntimeClient, RuntimeEvent, RuntimeKind, RuntimeListener, RuntimeModel, RuntimeOpenOptions, RuntimePersistence, RuntimeSession } from "../src/agents/runtime/types.ts";
import type { ResolvedRuntime } from "../src/runtimes/registry.ts";
import type { SpawnLogin } from "../src/providers/cli-login.ts";
import type { HttpFetch } from "../src/providers/http.ts";
import type { CommandResult } from "../src/runtimes/probe.ts";
import { DeviceSim } from "./device-sim.ts";

type Handler = (params: any) => unknown | Promise<unknown>;
/** One runtime session the server opened, as the fake keeps it. */
export type FakeSession = {
  sessionKey: string; runtimeId: string; options: RuntimeOpenOptions; resumed?: RuntimePersistence; closed: boolean;
  /** The id of the turn running now ("" between turns). */
  turnId: string;
  emit(event: RuntimeEvent): void;
};

/**
 * Fakes of the runtime layer. `factory` is what the server builds a runtime's client with; every call any session makes
 * is in `calls` (`createSession`, `resumeSession`, `startTurn`, `interrupt`, `respondToPermission`, `close`, `catalog`),
 * and `on(method, handler)` replaces what one of them does (a handler that throws makes the call fail).
 */
export function createFakeRuntimes() {
  const calls: Array<{ method: string; params: any }> = [];
  const overrides = new Map<string, Handler>();
  const state = {
    /** The model catalogue of each runtime, by runtime id (a custom profile reads its base's). */
    models: {} as Record<string, RuntimeModel[]>,
    /** The newest runtime session of each product session. */
    sessions: new Map<string, FakeSession>(),
    /** Every runtime session ever opened, oldest first. */
    opened: [] as FakeSession[],
    runs: 0,
    threads: 0,
  };
  const record = async (method: string, params: any): Promise<unknown> => {
    calls.push({ method, params });
    const handler = overrides.get(method);
    return handler ? await handler(params) : undefined;
  };
  const kindOf = (runtime: ResolvedRuntime): RuntimeKind => (runtime.driver === "claude" ? "claude" : runtime.driver === "codex" ? "codex" : "acp");

  function openSession(runtime: ResolvedRuntime, options: RuntimeOpenOptions, resumed?: RuntimePersistence): RuntimeSession {
    const listeners = new Set<RuntimeListener>();
    const sessionKey = options.sessionKey ?? "";
    const sessionId = resumed?.sessionId ?? `${kindOf(runtime)}-thread-${++state.threads}`;
    const fake: FakeSession = {
      sessionKey, runtimeId: runtime.id, options, ...(resumed ? { resumed } : {}), closed: false, turnId: "",
      emit(event) {
        if (event.type === "turn_completed" || event.type === "turn_failed" || event.type === "turn_cancelled") fake.turnId = "";
        for (const listener of [...listeners]) listener(event);
      },
    };
    state.sessions.set(sessionKey, fake);
    state.opened.push(fake);
    return {
      async startTurn(prompt: string, attachments: RuntimeAttachment[] = []) {
        const answer = await record("startTurn", { sessionKey, runtimeId: runtime.id, message: prompt, attachments, options }) as { turnId?: string } | undefined;
        const turnId = answer?.turnId ?? `run-${++state.runs}`;
        fake.turnId = turnId;
        fake.emit({ type: "turn_started", turnId });
        return { turnId };
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async interrupt() {
        const turnId = fake.turnId;
        const answer = await record("interrupt", { sessionKey, turnId }) as { keepRunning?: boolean } | undefined;
        // By default the runtime confirms the stop with the end of the turn, as every adapter does.
        if (turnId && !answer?.keepRunning && fake.turnId === turnId) fake.emit({ type: "turn_cancelled", turnId });
      },
      async respondToPermission(id: string, decision: string, answer?: PermissionAnswer) { await record("respondToPermission", { sessionKey, id, decision, ...(answer ? { answer } : {}) }); },
      async answerQuestion(id: string, answer: string) { await record("answerQuestion", { sessionKey, id, answer }); },
      async setModel(model: string) { await record("setModel", { sessionKey, model }); },
      async setMode(mode: string) { await record("setMode", { sessionKey, mode }); },
      persistence: () => ({ runtime: kindOf(runtime), sessionId }),
      async close() { fake.closed = true; listeners.clear(); await record("close", { sessionKey }); },
    };
  }

  /** The client of a runtime, as the server's `runtimeClients` option builds it. */
  const factory = (runtime: ResolvedRuntime): RuntimeClient => ({
    kind: kindOf(runtime),
    async isAvailable() { return true; },
    async catalog() {
      await record("catalog", { runtimeId: runtime.id });
      return { models: state.models[runtime.id] ?? state.models[runtime.base ?? ""] ?? [], modes: [] };
    },
    async createSession(options: RuntimeOpenOptions = {}) {
      await record("createSession", { runtimeId: runtime.id, ...options });
      return openSession(runtime, options);
    },
    async resumeSession(handle: RuntimePersistence, options: RuntimeOpenOptions = {}) {
      await record("resumeSession", { runtimeId: runtime.id, handle, ...options });
      return openSession(runtime, options, handle);
    },
  });

  const live = (sessionKey: string): FakeSession => {
    const session = state.sessions.get(sessionKey);
    assert.ok(session && !session.closed, `no open runtime session for ${sessionKey}`);
    return session!;
  };
  const turnOf = (sessionKey: string, runId?: string) => runId ?? live(sessionKey).turnId;
  return {
    factory, calls, state,
    /** Replaces what one call of the runtime layer does. */
    on: (method: string, handler: Handler) => void overrides.set(method, handler),
    reset: (method: string) => void overrides.delete(method),
    callsOf: (method: string) => calls.filter((call) => call.method === method).map((call) => call.params),
    /** The runtime session open now for a product session. */
    session: live,
    /** Reports one event of the runtime session of a product session. */
    emit: (sessionKey: string, event: RuntimeEvent) => live(sessionKey).emit(event),
    /** The runtime streams text of the running turn. */
    text: (sessionKey: string, text: string, runId?: string) => live(sessionKey).emit({ type: "assistant_text_delta", turnId: turnOf(sessionKey, runId), text }),
    /** The runtime reports a tool call of the running turn, started and (with `output`) finished. */
    tool(sessionKey: string, call: { id: string; name: string; input?: unknown; output?: unknown; failed?: boolean }) {
      const turnId = turnOf(sessionKey);
      live(sessionKey).emit({ type: "tool_call_started", turnId, id: call.id, name: call.name, input: call.input ?? {} });
      if ("output" in call) live(sessionKey).emit({ type: "tool_call_finished", turnId, id: call.id, name: call.name, input: call.input ?? {}, output: call.output, status: call.failed ? "failed" : "completed" });
    },
    /** The runtime reports the usage of the running turn. */
    usage: (sessionKey: string, usage: Omit<Extract<RuntimeEvent, { type: "usage" }>, "type">) => live(sessionKey).emit({ type: "usage", ...usage }),
    /** The runtime asks for a permission: Claude Code's shape (`{ name, input }`) unless `detail`/`kind` say otherwise. */
    ask(sessionKey: string, request: { id: string; name?: string; input?: unknown; kind?: string; detail?: unknown }) {
      live(sessionKey).emit({ type: "permission_requested", id: request.id, kind: request.kind ?? "tool", detail: request.detail ?? { name: request.name ?? "Bash", input: request.input ?? {} }, actions: ["allow", "deny"] });
    },
    /** The answers the server gave to permission requests, by request id. */
    answers: () => new Map(calls.filter((call) => call.method === "respondToPermission").map((call) => [call.params.id as string, call.params as { decision: string; answer?: PermissionAnswer }])),
    /** The runtime answers the running turn with `text` (and its usage) and ends it. */
    reply(sessionKey: string, text: string, opts: { runId?: string; usage?: Omit<Extract<RuntimeEvent, { type: "usage" }>, "type">; state?: "final" | "error" | "aborted"; errorMessage?: string } = {}) {
      const turnId = turnOf(sessionKey, opts.runId);
      if (text) live(sessionKey).emit({ type: "assistant_text_delta", turnId, text });
      if (opts.usage) live(sessionKey).emit({ type: "usage", ...opts.usage });
      const state = opts.state ?? "final";
      live(sessionKey).emit(state === "final" ? { type: "turn_completed", turnId } : state === "aborted" ? { type: "turn_cancelled", turnId } : { type: "turn_failed", turnId, code: "RUNTIME_ERROR", diagnostic: opts.errorMessage ?? "The turn failed" });
    },
    /** Whether a product session has a runtime session open now. */
    isOpen: (sessionKey: string): boolean => !!state.sessions.get(sessionKey) && !state.sessions.get(sessionKey)!.closed,
    /** Ends the running turn of a session the way the runtime reports it. */
    endTurn(sessionKey: string, runId?: string, stateName: "final" | "error" | "aborted" = "final", errorMessage?: string) {
      const turnId = turnOf(sessionKey, runId);
      live(sessionKey).emit(stateName === "final" ? { type: "turn_completed", turnId } : stateName === "aborted" ? { type: "turn_cancelled", turnId } : { type: "turn_failed", turnId, code: "RUNTIME_ERROR", diagnostic: errorMessage ?? "The turn failed" });
    },
  };
}
export type FakeRuntimes = ReturnType<typeof createFakeRuntimes>;

export const model = (id: string, over: Partial<RuntimeModel> = {}): RuntimeModel => ({ id, label: id, input: ["text"], ...over });

/** The catalogues of the CLIs a test host has: Claude Code (vendor `anthropic`) and Codex (vendor `openai`). */
export const SAMPLE_MODELS: Record<string, RuntimeModel[]> = {
  "claude-code": [
    model("sonnet", { isDefault: true, thinkingLevels: [{ id: "low", label: "low" }, { id: "high", label: "high" }], thinkingDefault: "low", input: ["text", "image"], supportsFastMode: true, contextWindow: 200_000 }),
    model("opus", { input: ["text", "image"] }),
  ],
  codex: [model("gpt-x", { thinkingLevels: [{ id: "low", label: "low" }, { id: "xhigh", label: "xhigh" }] })],
  "acp-opencode": [model("default", { label: "Agent default", isDefault: true })],
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * A server app on a temporary data directory with the fake Gateway. `installed` names the CLIs that "exist" on the
 * host: an executable file of that name is put on the host's PATH, and the command table decides what running it says.
 */
export async function createHarness(opts: { /** An existing data directory: the server starts again on what an earlier harness left (`stop()`). */ dataDir?: string; /** A fixed loopback port for browser e2e; absent in unit tests, which bind an ephemeral port. */ listenPort?: number; allowedOrigins?: string[]; installed?: string[]; /** Model catalogues by runtime id; SAMPLE_MODELS when absent. */ models?: Record<string, RuntimeModel[]>; /** More environment of the host (names a CLI would read, e.g. an API key variable). */ env?: Record<string, string>; /** What CLI commands answer from the start (`"<binary> <args>"`), over the defaults. */ commands?: Record<string, CommandResult>; now?: () => number; spawnLogin?: SpawnLogin; http?: HttpFetch; /** Real runtime clients (e.g. the adapters on the fake CLIs) instead of the in-memory fakes. */ runtimeClients?: Parameters<typeof createServerApp>[0]["runtimeClients"]; /** Directories after the stub CLIs on the host's PATH (a fake CLI script needs `node`). */ extraPath?: string[]; sync?: NonNullable<Parameters<typeof createServerApp>[0]["sync"]> ; extra?: Pick<Parameters<typeof createServerApp>[0], "bundledSkillsDir" | "skillGitUrlAllowed" | "modelPrice" | "modelMaxOutput" | "agentTimings" | "generation" | "localModels" | "usageAccount" | "remoteExportRenderer" | "renderHost" | "agentTools"> } = {}) {
  const fixtureRoot = process.env.W17_TEST_DATA_ROOT ? resolve(process.env.W17_TEST_DATA_ROOT) : tmpdir();
  const dataDir = opts.dataDir ?? mkdtempSync(join(fixtureRoot, "jagentchill-agents-"));
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const name of opts.installed ?? ["claude", "codex"]) {
    writeFileSync(join(binDir, name), "");
    chmodSync(join(binDir, name), 0o755);
  }
  const fake = createFakeRuntimes();
  fake.state.models = opts.models ?? SAMPLE_MODELS;
  const commands: Array<{ file: string; args: string[] }> = [];
  const results = new Map<string, CommandResult | (() => Promise<CommandResult>)>();
  const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "", timedOut: false });
  results.set("claude --version", ok("2.3.1 (Claude Code)\n"));
  // What the real CLI answers for a person signed in on their own plan (the kind of sign-in decides how its turns are billed: `generation/billing.ts`).
  results.set("claude auth status", ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "ada@example.com", subscriptionType: "max" })));
  results.set("codex --version", ok("codex-cli 1.0.0\n"));
  results.set("codex login status", ok("Logged in using ChatGPT\n"));
  for (const [line, result] of Object.entries(opts.commands ?? {})) results.set(line, result);
  const app = createServerApp({
    dataDir, runtimeClients: opts.runtimeClients ?? fake.factory,
    // Each runtime session is given the agent-tool endpoint with its own session named in the URL (main.ts does the same).
    agentTools: { url: (sessionKey: string) => `http://127.0.0.1:0/agent-tools/mcp?session=${encodeURIComponent(sessionKey)}`, token: "test-tool-secret" },
    ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
    hostPlatform: { platform: process.platform, env: { PATH: [binDir, ...(opts.extraPath ?? [])].join(":"), HOME: dataDir, ...opts.env } },
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sync ? { sync: opts.sync } : {}),
    loginStepWaitMs: 300,
    // Tests never inspect the developer's real CLI sign-ins or call a quota endpoint.
    usageAccount: { readClaudeCredentials: async () => null, readCodexCredentials: async () => null, fetch: async () => { throw new Error("unexpected account-usage request in test"); } },
    ...opts.extra,
    ...(opts.spawnLogin ? { spawnLogin: opts.spawnLogin } : {}),
    // No test reaches a real provider: without a simulated one every outbound request fails.
    http: opts.http ?? (async (url) => { throw new Error(`unexpected outbound request to ${new URL(url).host}`); }),
    runCommand: async (file, args) => {
      commands.push({ file, args });
      const entry = results.get(`${file.split("/").pop()} ${args.join(" ")}`);
      return typeof entry === "function" ? await entry() : entry ?? { code: 1, stdout: "", stderr: "unknown command", timedOut: false };
    },
  });
  await new Promise<void>((resolve, reject) => { app.http.once("error", reject); app.http.listen(opts.listenPort ?? 0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;

  const sockets: Array<{ terminate(): void }> = [];

  async function pair(name: string, role: "admin" | "editor" | "viewer", platform?: string) {
    const offer = app.pairing.createOffer([{ kind: "loopback", url: "ws://127.0.0.1/jagentchill/v1/ws" }], { rolePreset: role });
    const device = new DeviceSim(base, name);
    const requestId = await device.enrolUntilProved(offer);
    await device.verify(offer, requestId, app.pairing.pending().find((r) => r.requestId === requestId)!.code);
    if (platform) app.db.prepare("UPDATE devices SET platform = ? WHERE device_id = ?").run(platform, device.deviceId);
    const session = device.connect(offer);
    sockets.push(session.ws);
    assert.equal((await session.outcome).ready.role, role);
    const pending = new Map<string, (frame: any) => void>();
    const events: Array<{ event: string; payload: any }> = [];
    const frames: string[] = [];
    let id = 0;
    session.ws.on("message", (data) => {
      frames.push(data.toString());
      const frame = JSON.parse(data.toString());
      if (frame.t === "res") pending.get(frame.id)?.(frame);
      else if (frame.t === "evt") events.push({ event: frame.event, payload: frame.payload });
    });
    const raw = (method: string, params?: unknown) => new Promise<any>((resolve) => {
      const requestId = `t${++id}`;
      pending.set(requestId, resolve);
      session.ws.send(JSON.stringify({ t: "req", id: requestId, method, params }));
    });
    return {
      device, offer, events, frames, ws: session.ws,
      /** The answer frame of a call, whatever it is (`ok` + `result`, or `error`). */
      raw,
      /** The result of a call that must succeed. */
      async call(method: string, params?: unknown): Promise<any> {
        const frame = await raw(method, params);
        assert.equal(frame.ok, true, `${method} failed: ${JSON.stringify(frame.error)}`);
        return frame.result;
      },
      /**
       * A person says yes to the money question they are shown: the call, and — when it is refused with that question —
       * the same call again with `confirmed: true` and what the question named to be sent back (`details.confirmWith`),
       * as the cost dialog of the screens does. `questions`: how many questions may be asked and answered before the
       * call must have succeeded (1: the one question of an action; more for an action that stops again on the way).
       */
      async yes(method: string, params: Record<string, unknown> = {}, questions = 1): Promise<any> {
        let frame = await raw(method, params);
        for (let asked = 0; !frame.ok && asked < questions && frame.error?.details?.reason === "confirmation_required"; asked++) frame = await raw(method, { ...params, ...frame.error.details.confirmWith, confirmed: true });
        assert.equal(frame.ok, true, `${method} failed (after at most ${questions} answered money question(s)): ${JSON.stringify(frame.error ?? null).slice(0, 700)}`);
        return frame.result;
      },
      /** The same, for a call that must fail AFTER its money question was answered: the error of the answered call. */
      async yesFail(method: string, params: Record<string, unknown> = {}): Promise<{ code: string; message: string; details?: any; retryable: boolean }> {
        const asked = await raw(method, params);
        assert.equal(asked.ok, false, `${method} was expected to ask or fail`);
        if (asked.error?.details?.reason !== "confirmation_required") return asked.error;
        const frame = await raw(method, { ...params, ...asked.error.details.confirmWith, confirmed: true });
        assert.equal(frame.ok, false, `${method} was expected to fail`);
        return frame.error;
      },
      /** The error of a call that must fail. */
      async fail(method: string, params?: unknown): Promise<{ code: string; message: string; details?: any; retryable: boolean }> {
        const frame = await raw(method, params);
        assert.equal(frame.ok, false, `${method} was expected to fail`);
        return frame.error;
      },
      async putSecret(secretName: string, value: string) {
        const target = `/jagentchill/v1/secrets/${secretName}`;
        const res = await fetch(base + target, { method: "PUT", headers: device.signedHeaders(offer.gatewayId, "PUT", target, value), body: value });
        return { status: res.status, body: (await res.json()) as any };
      },
    };
  }

  return {
    app, base, dataDir, binDir, fake, commands, results, ok, pair,
    /** The runtime snapshot once every probe has settled. */
    async settled() {
      for (const runtime of app.runtimes.runtimes()) if (runtime.enabled) await app.runtimes.settled(runtime.id);
      return app.runtimes.snapshot();
    },
    /**
     * TEST SEED (ruling R10): puts on record, in this host's Usage, that a FIRST turn of a session on `ref` was measured
     * with a prompt of `promptTokens` tokens — what the host holds after such a turn really ran (the row Usage writes for
     * it; a turn that costs nothing and belongs to no session of the test). The price of a turn on that model is worked
     * out from it. One test in workflows.test.ts gets the same measurement from a real turn instead.
     */
    measured: (ref: { runtimeId: string; providerId: string; modelId: string }, promptTokens: number): void => {
      app.db.prepare(`INSERT INTO usage_records (session_key, run_id, root_session_key, agent_id, runtime_id, provider_id, model_id, billing, outcome, input_tokens, output_tokens, total_tokens, token_source, cost_usd, cost_source, price_source, started_ms, context_used, open)
        VALUES (?, 'seed', ?, 'main', ?, ?, ?, 'api', 'succeeded', ?, 0, ?, 'reported', 0, 'calculated', 'admin', ?, ?, 0)`).run(`seed:${ref.modelId}:${promptTokens}`, `seed:${ref.modelId}:${promptTokens}`, ref.runtimeId, ref.providerId, ref.modelId, promptTokens, promptTokens, Date.now(), promptTokens);
    },
    /** TEST SEED: messages written straight into a session's transcript (what earlier turns left), oldest first. */
    seedHistory(sessionKey: string, messages: Array<{ role: "user" | "assistant" | "toolResult"; content: unknown; timestamp?: number; toolCallId?: string; toolName?: string; isError?: boolean; usage?: unknown }>): void {
      for (const message of messages) app.transcript.append(sessionKey, { timestamp: Date.now(), ...message, content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content } as never);
    },
    audit: (action: string) => (app.db.prepare("SELECT * FROM audit WHERE action = ? ORDER BY id").all(action) as Array<{ actor: string; details: string }>).map((row) => ({ actor: row.actor, ...JSON.parse(row.details) })),
    /** Stops the server and keeps its data directory, as a host that goes down does; a new harness on `dataDir` is the restart. */
    stop: async () => {
      for (const socket of sockets) socket.terminate();
      await app.close();
    },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
