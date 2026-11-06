import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { spawnRpc } from "./jsonl.ts";
import { createRpcSession } from "./rpc-session.ts";
import type { PermissionAnswer, RuntimeAttachment, RuntimeCatalog, RuntimeClient, RuntimeEvent, RuntimeListener, RuntimeModel, RuntimeOpenOptions, RuntimePersistence, RuntimeSession } from "./types.ts";

const hasBinary = (bin: string, args: string[] = ["--version"]) => spawnSync(bin, args, { stdio: "ignore" }).status === 0;
const authHeaders = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
const mcpConfig = (url?: string, token?: string): Record<string, { type: "http"; url: string; headers: Record<string, string> }> => url ? { jagentchill: { type: "http", url, headers: authHeaders(token) } } : {};
/**
 * How long a CLI waits for one JAgentChill tool call. A picture made on the host by the local image model takes minutes
 * (about 4.5 min at 512 px on an M1 Pro); Codex's default (60 s) and Claude Code's would cut the call and lose the result.
 */
const JC_TOOL_TIMEOUT_MS = 60 * 60 * 1000;
/** The environment is given whole (the server already left out what a CLI must not inherit). */
const childEnv = (env?: Record<string, string>): NodeJS.ProcessEnv | undefined => (env ? { ...env } : undefined);
const imageOf = (attachment: RuntimeAttachment) => (attachment.data && /^image\//.test(attachment.mimeType ?? "") ? { mimeType: attachment.mimeType!, data: attachment.data } : undefined);
const fileNote = (attachment: RuntimeAttachment) => `[attachment] ${attachment.path ?? attachment.name ?? "file"}`;

/** Codex: `codex app-server`, JSON-RPC over stdio, one child per session. */
export class CodexRuntimeClient implements RuntimeClient {
  readonly kind = "codex" as const;
  private readonly command: string;
  constructor(command = "codex") { this.command = command; }
  async isAvailable() { return hasBinary(this.command, ["--version"]); }
  async catalog(): Promise<RuntimeCatalog> {
    if (!await this.isAvailable()) return { models: [], modes: [] };
    const rpc = spawnRpc(this.command, ["app-server"]);
    try {
      await rpc.request("initialize", { clientInfo: { name: "jagentchill", version: "0.0.0" }, capabilities: {} });
      const result: any = await rpc.request("model/list", {});
      const models: RuntimeModel[] = (result?.data ?? result?.models ?? []).map((model: any) => ({
        id: String(model.id ?? model.model), label: String(model.displayName ?? model.label ?? model.id), ...(model.description ? { description: String(model.description) } : {}),
        ...(Array.isArray(model.supportedReasoningEfforts) ? { thinkingLevels: model.supportedReasoningEfforts.map((effort: any) => { const id = String(effort?.reasoningEffort ?? effort); return { id, label: id }; }) } : {}),
        ...(model.defaultReasoningEffort ? { thinkingDefault: String(model.defaultReasoningEffort) } : {}), ...(model.isDefault ? { isDefault: true } : {}), input: ["text", "image"],
      }));
      return { models, modes: ["read-only", "workspace-write", "danger-full-access"] };
    } finally { await rpc.close(); }
  }
  private async open(handle: RuntimePersistence | undefined, options: RuntimeOpenOptions = {}) {
    const rpc = spawnRpc(this.command, ["app-server"], { ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.env ? { env: childEnv(options.env) } : {}) });
    try {
      await rpc.request("initialize", { clientInfo: { name: "jagentchill", version: "0.0.0" }, capabilities: {} });
      try { rpc.notify("initialized", {}); } catch { /* a closed child fails the next request */ }
      const sandbox = options.mode ?? "workspace-write";
      // A stored key or an endpoint arrives as a custom model provider (`options.config`); its key is in the child's environment.
      // Codex's own picture tool is off: pictures go through jc_generate_image (the media library, the local model, ORC).
      const overrides = { ...(options.config ?? {}), features: { ...((options.config?.features as Record<string, unknown> | undefined) ?? {}), image_generation: false }, ...(options.mcpUrl ? { mcp_servers: { jagentchill: { url: options.mcpUrl, http_headers: authHeaders(options.mcpToken), tool_timeout_sec: JC_TOOL_TIMEOUT_MS / 1000 } } } : {}) };
      const provider = typeof options.config?.model_provider === "string" ? options.config.model_provider : undefined;
      const config = {
        ...(options.model ? { model: options.model } : {}), ...(provider ? { modelProvider: provider } : {}), ...(options.cwd ? { cwd: options.cwd } : {}),
        approvalPolicy: sandbox === "danger-full-access" ? "never" : "on-request", sandbox,
        ...(Object.keys(overrides).length ? { config: overrides } : {}),
        ...(options.instructions ? { developerInstructions: options.instructions } : {}),
      };
      const result: any = await rpc.request(handle ? "thread/resume" : "thread/start", handle ? { threadId: handle.sessionId, ...config } : config);
      const sessionId = String(result?.thread?.id ?? handle?.sessionId ?? randomUUID());
      return createRpcSession({
        runtime: this.kind, sessionId, nativeHandle: { threadId: sessionId }, rpc, turnMethod: "turn/start", interruptMethod: "turn/interrupt",
        makeTurnParams: (turnId, prompt, attachments, threadId) => ({
          threadId, turnId,
          input: [{ type: "text", text: prompt }, ...attachments.map((attachment) => { const image = imageOf(attachment); return image ? { type: "image", url: `data:${image.mimeType};base64,${image.data}` } : { type: "text", text: fileNote(attachment) }; })],
          ...(options.model ? { model: options.model } : {}), ...(options.thinking ? { effort: options.thinking } : {}),
        }),
        makeInterruptParams: (turnId, threadId, nativeTurnId) => ({ threadId, turnId: nativeTurnId ?? turnId }),
        steerMethod: "turn/steer", makeSteerParams: (prompt, threadId, nativeTurnId) => ({ threadId, input: [{ type: "text", text: prompt }], expectedTurnId: nativeTurnId }),
        model: options.model, mode: options.mode,
      });
    } catch (error) { await rpc.close().catch(() => undefined); throw error; }
  }
  createSession(options?: RuntimeOpenOptions) { return this.open(undefined, options); }
  resumeSession(handle: RuntimePersistence, options?: RuntimeOpenOptions) { return this.open(handle, options); }
}

/** Any agent that speaks the Agent Client Protocol on stdio (Gemini CLI, Copilot, OpenCode, Qwen, custom commands). */
/** The model choices an ACP session answer carries: a `configOptions` select of category "model", or `models.availableModels`. */
function acpModelChoices(session: any): { id: string; label: string; current: boolean; configId?: string }[] {
  const option = Array.isArray(session?.configOptions) ? session.configOptions.find((entry: any) => entry?.category === "model" || entry?.id === "model") : undefined;
  if (option && Array.isArray(option.options)) {
    return option.options.filter((entry: any) => typeof entry?.value === "string").map((entry: any) => ({ id: entry.value, label: String(entry.name ?? entry.value), current: entry.value === option.currentValue, configId: String(option.id) }));
  }
  const models = session?.models;
  if (models && Array.isArray(models.availableModels)) {
    return models.availableModels.filter((entry: any) => typeof entry?.modelId === "string").map((entry: any) => ({ id: entry.modelId, label: String(entry.name ?? entry.modelId), current: entry.modelId === models.currentModelId }));
  }
  return [];
}
/**
 * Puts an ACP session on a model: through its "model" config option, else the older `session/set_model`. The agent
 * decides whether it knows the model (a key or endpoint given to it for this session adds models it did not list at
 * startup); its refusal is the error. An agent with neither keeps its own model.
 */
async function applyAcpModel(rpc: { request(method: string, params: unknown): Promise<unknown> }, sessionId: string, session: any, model: string): Promise<void> {
  const option = Array.isArray(session?.configOptions) ? session.configOptions.find((entry: any) => entry?.category === "model" || entry?.id === "model") : undefined;
  if (option?.id) { await rpc.request("session/set_config_option", { sessionId, configId: String(option.id), value: model }); return; }
  if (session?.models) await rpc.request("session/set_model", { sessionId, modelId: model });
}

/** How long reading an ACP agent's model list may take: OpenCode with plugins needs ~5 s on an idle Mac, much more while a picture is being made. */
const ACP_CATALOGUE_MS = 25_000;

export class AcpRuntimeClient implements RuntimeClient {
  readonly kind = "acp" as const;
  private readonly command: string;
  private readonly args: string[];
  private readonly listModels: boolean;
  /** `listModels`: the agent is started once to read its model list (OpenCode). Other ACP agents are not started for that. */
  constructor(command: string, args: string[] = ["--acp"], options: { listModels?: boolean } = {}) { this.command = command; this.args = args; this.listModels = options.listModels === true; }
  async isAvailable() { return hasBinary(this.command, ["--version"]); }
  /**
   * The models an ACP agent offers: the "model" select of the session's `configOptions` (OpenCode lists every model it
   * can use there, its free Zen models included), or the older `models.availableModels`. An agent that lists neither
   * runs on the model it is configured with, offered as the one "default" model.
   */
  async catalog(): Promise<RuntimeCatalog> {
    const fallback: RuntimeCatalog = { models: [{ id: "default", label: "Agent default", isDefault: true }], modes: ["default"] };
    if (!this.listModels) return fallback;
    const rpc = spawnRpc(this.command, this.args, { cwd: tmpdir() });
    // Never longer than a few seconds, and the agent is always stopped: an agent that waits (for a sign-in, say) must
    // not be left running — Gemini was, once per catalogue refresh.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ACP_CATALOGUE_MS); });
    try {
      const session: any = await Promise.race([(async () => {
        await rpc.request("initialize", { protocolVersion: 1, clientInfo: { name: "jagentchill", version: "0.0.0" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
        return rpc.request("session/new", { cwd: tmpdir(), mcpServers: [] });
      })(), late]);
      const choices = acpModelChoices(session);
      if (!choices.length) return fallback;
      return { models: choices.map((choice) => ({ id: choice.id, label: choice.label, ...(choice.current ? { isDefault: true } : {}) })), modes: ["default"] };
    } catch { return fallback; } finally {
      clearTimeout(timer);
      rpc.child.kill("SIGKILL");
      await Promise.race([rpc.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
  }
  private async open(handle: RuntimePersistence | undefined, options: RuntimeOpenOptions = {}) {
    const rpc = spawnRpc(this.command, this.args, { ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.env ? { env: childEnv(options.env) } : {}) });
    try {
      await rpc.request("initialize", { protocolVersion: 1, clientInfo: { name: "jagentchill", version: "0.0.0" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
      const mcpServers = options.mcpUrl ? [{ name: "jagentchill", type: "http", url: options.mcpUrl, headers: Object.entries(authHeaders(options.mcpToken)).map(([name, value]) => ({ name, value })) }] : [];
      const cwd = options.cwd ?? process.cwd();
      const result: any = await rpc.request(handle ? "session/load" : "session/new", handle ? { sessionId: handle.sessionId, cwd, mcpServers } : { cwd, mcpServers });
      const sessionId = String(result?.sessionId ?? handle?.sessionId ?? randomUUID());
      // The chosen model is set on the agent's session ("default" leaves the agent's own choice).
      if (options.model && options.model !== "default") await applyAcpModel(rpc, sessionId, result, options.model);
      return createRpcSession({
        runtime: this.kind, sessionId, nativeHandle: { sessionId }, rpc, turnMethod: "session/prompt", interruptMethod: "session/cancel", interruptIsNotification: true,
        makeTurnParams: (_turnId, prompt, attachments, id) => ({
          sessionId: id,
          prompt: [{ type: "text", text: options.instructions && !handle ? `${options.instructions}\n\n${prompt}` : prompt }, ...attachments.map((attachment) => { const image = imageOf(attachment); return image ? { type: "image", ...image } : { type: "text", text: fileNote(attachment) }; })],
        }),
        makeInterruptParams: (_turnId, id) => ({ sessionId: id }), model: options.model, mode: options.mode,
      });
    } catch (error) { await rpc.close().catch(() => undefined); throw error; }
  }
  createSession(options?: RuntimeOpenOptions) { return this.open(undefined, options); }
  resumeSession(handle: RuntimePersistence, options?: RuntimeOpenOptions) { return this.open(handle, options); }
}

/** Thinking budgets for the Claude Agent SDK, by the level a person chose. */
const CLAUDE_THINKING: Record<string, number> = { low: 4_000, medium: 10_000, high: 32_000 };
const claudeThinking = [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }];
export const CLAUDE_MODELS: RuntimeModel[] = [
  { id: "default", label: "Default (recommended)", isDefault: true, contextWindow: 200_000, input: ["text", "image"], thinkingLevels: claudeThinking },
  { id: "sonnet", label: "Sonnet", contextWindow: 200_000, input: ["text", "image"], thinkingLevels: claudeThinking },
  { id: "opus", label: "Opus", contextWindow: 200_000, input: ["text", "image"], thinkingLevels: claudeThinking },
  { id: "haiku", label: "Haiku", contextWindow: 200_000, input: ["text", "image"] },
];

/** Claude Code through the Claude Agent SDK in streaming-input mode; the SDK starts the person's own `claude`. */
export class ClaudeRuntimeClient implements RuntimeClient {
  readonly kind = "claude" as const;
  private readonly command: string;
  constructor(command = "claude") { this.command = command; }
  async isAvailable() { return hasBinary(this.command, ["--version"]); }
  async catalog(): Promise<RuntimeCatalog> { return { models: CLAUDE_MODELS, modes: ["default", "acceptEdits", "plan", "bypassPermissions"] }; }
  private async open(handle: RuntimePersistence | undefined, options: RuntimeOpenOptions = {}) {
    // The input stream of the query: each turn is one user message pushed onto it.
    const queue: any[] = [];
    let waiter: ((value: IteratorResult<any>) => void) | undefined, closed = false;
    const push = (message: any) => { if (waiter) { const resolve = waiter; waiter = undefined; resolve({ done: false, value: message }); } else queue.push(message); };
    const input: AsyncIterable<any> = {
      [Symbol.asyncIterator]() {
        return { next: () => queue.length ? Promise.resolve({ done: false, value: queue.shift() }) : closed ? Promise.resolve({ done: true, value: undefined }) : new Promise<IteratorResult<any>>((resolve) => { waiter = resolve; }) };
      },
    };
    const listeners = new Set<RuntimeListener>(), pending = new Map<string, (decision: string, answer?: PermissionAnswer) => void>();
    const toolNames = new Map<string, string>(), ended = new Set<string>();
    let currentTurn = "", sessionId = handle?.sessionId ?? randomUUID(), interrupted = false;
    const abortController = new AbortController();
    const emit = (event: RuntimeEvent) => { for (const fn of listeners) fn(event); };
    const end = (event: Extract<RuntimeEvent, { type: "turn_completed" | "turn_failed" | "turn_cancelled" }>) => { if (!event.turnId || ended.has(event.turnId)) return; ended.add(event.turnId); emit(event); };
    const queryOptions: any = {
      pathToClaudeCodeExecutable: this.command, abortController, includePartialMessages: true,
      ...(handle?.sessionId ? { resume: handle.sessionId } : {}), ...(options.model && options.model !== "default" ? { model: options.model } : {}),
      permissionMode: options.mode ?? "default", mcpServers: mcpConfig(options.mcpUrl, options.mcpToken),
      ...(options.cwd ? { cwd: options.cwd } : {}), env: { ...(childEnv(options.env) ?? process.env), MCP_TOOL_TIMEOUT: String(JC_TOOL_TIMEOUT_MS) },
      ...(options.thinking && CLAUDE_THINKING[options.thinking] ? { maxThinkingTokens: CLAUDE_THINKING[options.thinking] } : {}),
      ...(options.instructions ? { systemPrompt: { type: "preset", preset: "claude_code", append: options.instructions } } : {}),
      canUseTool: async (name: string, toolInput: unknown, ctx: any) => {
        const id = String(ctx?.toolUseID ?? randomUUID());
        // The answer is waited for BEFORE the request is announced: the server may answer within the announcement
        // itself (a jc_* tool is allowed at once), and an answer that arrives before anyone waits is lost — the call hung.
        const answered = new Promise((resolve: any) => pending.set(id, (decision, answer) => {
          emit({ type: "permission_resolved", id, decision });
          resolve(/allow|accept/i.test(decision) ? { behavior: "allow", updatedInput: answer?.updatedInput ?? toolInput } : { behavior: "deny", message: answer?.message ?? "Denied by user" });
        }));
        emit({ type: "permission_requested", id, kind: "tool", detail: { name, input: toolInput }, actions: ["allow", "deny"] });
        return await answered;
      },
    };
    const queryHandle: any = query({ prompt: input, options: queryOptions } as any);
    void (async () => {
      try {
        for await (const msg of queryHandle) {
          if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id ?? sessionId;
          if (msg.type === "system" && msg.subtype === "compact_boundary") emit({ type: "compaction", phase: "end", detail: msg.compact_metadata });
          if (msg.type === "stream_event") {
            const event = msg.event;
            if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") emit({ type: "assistant_text_delta", turnId: currentTurn, text: event.delta.text });
            else if (event?.type === "content_block_delta" && event.delta?.type === "thinking_delta") emit({ type: "reasoning_delta", turnId: currentTurn, text: event.delta.thinking });
          }
          if (msg.type === "assistant") {
            for (const block of msg.message?.content ?? []) if (block.type === "tool_use") { toolNames.set(block.id, block.name); emit({ type: "tool_call_started", turnId: currentTurn, id: block.id, name: block.name, input: block.input }); }
          }
          if (msg.type === "user") {
            for (const block of msg.message?.content ?? []) if (block.type === "tool_result") {
              emit({ type: "tool_call_finished", turnId: currentTurn, id: block.tool_use_id, name: toolNames.get(block.tool_use_id) ?? "tool", input: {}, output: block.content, status: block.is_error ? "failed" : "completed" });
            }
          }
          if (msg.type === "result") {
            const model = msg.modelUsage && typeof msg.modelUsage === "object" ? Object.keys(msg.modelUsage)[0] : undefined;
            const window = model ? msg.modelUsage[model]?.contextWindow : undefined;
            emit({ type: "usage", inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens, cacheReadTokens: msg.usage?.cache_read_input_tokens, cacheWriteTokens: msg.usage?.cache_creation_input_tokens, costUsd: msg.total_cost_usd, ...(typeof window === "number" ? { contextWindow: window } : {}), ...(model ? { model } : {}) });
            if (interrupted) end({ type: "turn_cancelled", turnId: currentTurn });
            else if (msg.subtype === "success" && !msg.is_error) end({ type: "turn_completed", turnId: currentTurn });
            else end({ type: "turn_failed", turnId: currentTurn, code: String(msg.subtype ?? "CLAUDE_TURN_FAILED"), diagnostic: Array.isArray(msg.errors) && msg.errors.length ? msg.errors.join("\n") : String(msg.result ?? msg.subtype ?? "The turn failed") });
          }
        }
      } catch (error) {
        if (!interrupted) end({ type: "turn_failed", turnId: currentTurn, code: "CLAUDE_QUERY_FAILED", diagnostic: error instanceof Error ? error.message : String(error) });
      }
    })();
    return {
      async startTurn(prompt: string, attachments: RuntimeAttachment[] = []) {
        currentTurn = randomUUID(); emit({ type: "turn_started", turnId: currentTurn });
        const content: any[] = [{ type: "text", text: prompt }, ...attachments.map((attachment) => {
          const image = imageOf(attachment);
          return image ? { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } } : { type: "text", text: fileNote(attachment) };
        })];
        push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: sessionId });
        return { turnId: currentTurn };
      },
      subscribe(fn: RuntimeListener) { listeners.add(fn); return () => listeners.delete(fn); },
      async interrupt() {
        interrupted = true;
        for (const [id, resolve] of pending) { pending.delete(id); resolve("deny"); }
        await Promise.race([queryHandle.interrupt?.().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2000))]);
        abortController.abort();
        end({ type: "turn_cancelled", turnId: currentTurn });
      },
      async respondToPermission(id: string, decision: string, answer?: PermissionAnswer) { const resolve = pending.get(id); pending.delete(id); resolve?.(decision, answer); },
      async answerQuestion(id: string, answer: string) { emit({ type: "question_resolved", id, answer }); },
      async setModel(model: string) { await queryHandle.setModel?.(model === "default" ? undefined : model); },
      async setMode(mode: string) { await queryHandle.setPermissionMode?.(mode); },
      persistence: () => ({ runtime: "claude" as const, sessionId }),
      async close() {
        closed = true;
        for (const [id, resolve] of pending) { pending.delete(id); resolve("deny"); }
        if (waiter) { const resolve = waiter; waiter = undefined; resolve({ done: true, value: undefined }); }
        try { queryHandle.close?.(); } catch { /* already closed */ }
        abortController.abort();
        listeners.clear();
      },
    } satisfies RuntimeSession;
  }
  createSession(options?: RuntimeOpenOptions) { return this.open(undefined, options); }
  resumeSession(handle: RuntimePersistence, options?: RuntimeOpenOptions) { return this.open(handle, options); }
}

/** OpenCode through one shared `opencode serve` (HTTP + SSE). */
export class OpenCodeRuntimeClient implements RuntimeClient {
  readonly kind = "opencode" as const;
  private readonly baseUrl: string;
  constructor(baseUrl = "http://127.0.0.1:4096") { this.baseUrl = baseUrl; }
  async isAvailable() { try { return (await fetch(`${this.baseUrl}/global/health`)).ok; } catch { return false; } }
  async catalog(): Promise<RuntimeCatalog> { const api = createOpencodeClient({ baseUrl: this.baseUrl }); const result: any = await api.provider.list(); if (result.error) throw new Error(`OpenCode catalog failed: ${JSON.stringify(result.error)}`); const body: any = result.data;
    // `GET /provider` answers {all, default, connected}: every provider OpenCode knows (200+) and the ids it can use now
    // (signed in, or free like OpenCode Zen's `*-free` models). Only the usable ones are offered. An older server answered
    // {providers: [...]} with the configured providers only.
    const connected = new Set<string>(Array.isArray(body.connected) ? body.connected : []);
    const providers: any[] = Array.isArray(body.all) ? body.all.filter((p: any) => connected.has(p.id)) : (body.providers ?? []);
    return { models: providers.flatMap((p: any) => Object.values(p.models ?? {}).map((m: any) => ({ id: `${p.id}/${m.id}`, label: m.name ?? m.id }))), modes: ["default", "plan", "build"] }; }
  private async open(handle: RuntimePersistence | undefined, options: RuntimeOpenOptions = {}) {
    const api = createOpencodeClient({ baseUrl: this.baseUrl });
    let sessionId = handle?.sessionId;
    if (!sessionId) { const result: any = await api.session.create({ body: {} }); if (result.error) throw new Error(`OpenCode session create failed: ${JSON.stringify(result.error)}`); sessionId = result.data.id; }
    if (options.mcpUrl) { const result: any = await api.mcp.add({ body: { name: "jagentchill", config: { type: "remote", url: options.mcpUrl, headers: authHeaders(options.mcpToken) } } }); if (result.error) throw new Error(`OpenCode MCP add failed: ${JSON.stringify(result.error)}`); }
    const listeners = new Set<RuntimeListener>(); let activeTurn = ""; const eventAbort = new AbortController();
    void (async () => { try { const response = await fetch(`${this.baseUrl}/event`, { signal: eventAbort.signal }); const reader = response.body?.getReader(); if (!reader) return; const decoder = new TextDecoder(); let buffer = ""; while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const parts = buffer.split("\n\n"); buffer = parts.pop() ?? ""; for (const part of parts) { const data = part.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim(); if (!data) continue; let event: any; try { event = JSON.parse(data); } catch { continue; } const props = event.properties ?? {}, partData = props.part ?? props; let outputs: RuntimeEvent[] = []; if (/message\.part\.delta/.test(event.type)) outputs = [{ type: "assistant_text_delta", turnId: activeTurn, text: props.delta ?? "" }]; else if (/permission\.asked/.test(event.type)) outputs = [{ type: "permission_requested", id: props.id, kind: "tool", detail: props, actions: ["allow", "deny"] }]; else if (/tool\.updated/.test(event.type)) outputs = [{ type: "tool_call_updated", turnId: activeTurn, id: String(props.id ?? partData.id ?? ""), input: props.input ?? partData.state?.input, output: props.output ?? partData.state?.output }]; else if (/tool\.(?:started|running)/.test(event.type)) outputs = [{ type: "tool_call_started", turnId: activeTurn, id: String(props.id ?? partData.id ?? randomUUID()), name: String(props.name ?? partData.tool ?? "tool"), input: props.input ?? partData.state?.input ?? {} }]; else if (/tool\.(?:finished|completed)/.test(event.type)) outputs = [{ type: "tool_call_finished", turnId: activeTurn, id: String(props.id ?? partData.id ?? ""), name: String(props.name ?? partData.tool ?? "tool"), input: props.input ?? partData.state?.input ?? {}, output: props.output ?? partData.state?.output, status: /error|fail/i.test(String(props.status ?? partData.state?.status ?? "")) ? "failed" : "completed" }]; else if (/message\.updated/.test(event.type) && (props.info?.tokens || props.tokens)) { const tokens = props.info?.tokens ?? props.tokens; outputs = [{ type: "usage", inputTokens: tokens.input ?? tokens.inputTokens, outputTokens: tokens.output ?? tokens.outputTokens, cacheReadTokens: tokens.cache?.read, cacheWriteTokens: tokens.cache?.write, costUsd: props.info?.cost ?? props.cost }]; } else if (/session\.error/.test(event.type)) outputs = [{ type: "turn_failed", turnId: activeTurn, code: String(props.code ?? "OPENCODE_ERROR"), diagnostic: String(props.message ?? props.error?.message ?? props.error ?? "OpenCode turn failed") }]; else if (/session\.idle/.test(event.type)) outputs = [{ type: "turn_completed", turnId: activeTurn }]; for (const output of outputs) for (const fn of listeners) fn(output); } } } catch { /* closed */ } })();
    return { async startTurn(prompt: string) { activeTurn = randomUUID(); for (const fn of listeners) fn({ type: "turn_started", turnId: activeTurn }); const [providerID, modelID] = (options.model ?? "").split("/"); const result: any = await api.session.promptAsync({ path: { id: sessionId! }, body: { parts: [{ type: "text", text: prompt }], ...(providerID && modelID ? { model: { providerID, modelID } } : {}) } }); if (result.error) throw new Error(`OpenCode prompt failed: ${JSON.stringify(result.error)}`); return { turnId: activeTurn }; },
      subscribe(fn: RuntimeListener) { listeners.add(fn); return () => listeners.delete(fn); }, async interrupt() { const result: any = await api.session.abort({ path: { id: sessionId! } }); if (result.error) throw new Error(`OpenCode abort failed: ${JSON.stringify(result.error)}`); for (const fn of listeners) fn({ type: "turn_cancelled", turnId: activeTurn }); },
      async respondToPermission(id: string, decision: string) { const result: any = await api.postSessionIdPermissionsPermissionId({ path: { id: sessionId!, permissionID: id }, body: { response: /allow/i.test(decision) ? "once" : "reject" } }); if (result.error) throw new Error(`OpenCode permission reply failed: ${JSON.stringify(result.error)}`); }, async answerQuestion(id: string, answer: string) { await this.respondToPermission(id, answer); },
      async setModel(model: string) { options.model = model; }, async setMode(mode: string) { options.mode = mode; }, persistence: () => ({ runtime: "opencode" as const, sessionId: sessionId! }), async close() { eventAbort.abort(); listeners.clear(); } } satisfies RuntimeSession;
  }
  createSession(options?: RuntimeOpenOptions) { return this.open(undefined, options); }
  resumeSession(handle: RuntimePersistence, options?: RuntimeOpenOptions) { return this.open(handle, options); }
}
