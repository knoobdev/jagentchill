import { randomUUID } from "node:crypto";
import type { RpcProcess } from "./jsonl.ts";
import type { PermissionAnswer, RuntimeAttachment, RuntimeEvent, RuntimeKind, RuntimeListener, RuntimeSession } from "./types.ts";

export type RpcSessionOptions = { /** The name JAgentChill's own MCP server is registered under ("jagentchill"). */ ownMcpServer?: string; runtime: RuntimeKind; sessionId: string; nativeHandle?: unknown; rpc: RpcProcess; turnMethod: string; interruptMethod: string; makeTurnParams?: (turnId: string, prompt: string, attachments: RuntimeAttachment[], sessionId: string) => unknown; makeInterruptParams?: (turnId: string, sessionId: string, nativeTurnId: string | undefined) => unknown; /** ACP's `session/cancel` is a notification, not a request. */ interruptIsNotification?: boolean; steerMethod?: string; makeSteerParams?: (prompt: string, sessionId: string, nativeTurnId: string) => unknown; mode?: string; model?: string };

const allows = (decision: string) => /allow|accept|once/i.test(decision);

/** The answer of an accepted MCP elicitation: every field of the form at its default (a tool-approval form has only switches). */
function elicitationContent(params: any): Record<string, unknown> {
  const properties = params?.requestedSchema?.properties && typeof params.requestedSchema.properties === "object" ? params.requestedSchema.properties : {};
  const content: Record<string, unknown> = {};
  for (const [name, field] of Object.entries<any>(properties)) {
    if (field?.default !== undefined && field.default !== null) content[name] = field.default;
    else if (field?.type === "boolean") content[name] = true;
    else if (Array.isArray(field?.enum) && field.enum.length) content[name] = field.enum[0];
    else if (Array.isArray(field?.oneOf) && field.oneOf[0]?.const !== undefined) content[name] = field.oneOf[0].const;
  }
  return content;
}

/** The answer to a permission request in the wire form of the protocol that asked: ACP picks one of the offered options, Codex names a decision. */
function permissionReply(method: string, params: any, decision: string, answer: PermissionAnswer | undefined): unknown {
  if (/elicitation/i.test(method)) return allows(decision) ? { action: "accept", content: answer?.updatedInput ?? elicitationContent(params) } : { action: "decline" };
  if (/requestuserinput/i.test(method.replace(/[_-]/g, ""))) return allows(decision) ? { answers: answer?.updatedInput ?? {} } : { answers: {} };
  const options: Array<{ optionId?: string; kind?: string; name?: string }> = Array.isArray(params?.options) ? params.options : [];
  if (/session\/request_permission|requestpermission/i.test(method.replace(/[_-]/g, "")) || options.length) {
    if (!allows(decision)) {
      const reject = options.find((option) => /reject_once|reject/i.test(`${option.kind ?? ""} ${option.optionId ?? ""}`));
      return reject?.optionId ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    }
    const allow = options.find((option) => /allow_once/i.test(`${option.kind ?? ""} ${option.optionId ?? ""}`)) ?? options.find((option) => /allow/i.test(`${option.kind ?? ""} ${option.optionId ?? ""}`));
    return { outcome: { outcome: "selected", optionId: allow?.optionId ?? "allow_once" } };
  }
  return { decision: allows(decision) ? "accept" : "decline" };
}

/** A runtime session over a JSON-RPC child (Codex app-server, ACP agents): native notifications become `RuntimeEvent`s. */
export function createRpcSession(opts: RpcSessionOptions): RuntimeSession {
  const listeners = new Set<RuntimeListener>(), permissions = new Map<string, (decision: string, answer?: PermissionAnswer) => void>();
  const toolNames = new Map<string, string>();
  let turnId = "", nativeTurnId: string | undefined, active = false, stderr = "", wrote = false, current = "", previous = "", held: string | undefined;
  const emit = (event: RuntimeEvent) => { for (const fn of listeners) fn(event); };
  const started = (id: string, name: string, input: unknown) => { toolNames.set(id, name); emit({ type: "tool_call_started", turnId, id, name, input }); };
  const finished = (id: string, name: string | undefined, input: unknown, output: unknown, failed: boolean) =>
    emit({ type: "tool_call_finished", turnId, id, name: name && name !== "tool" ? name : toolNames.get(id) ?? name ?? "tool", input, output, status: failed ? "failed" : "completed" });
  const off = opts.rpc.onNotification((method, p) => {
    if (method === "session/update" && p?.update) {
      const update = p.update, kind = String(update.sessionUpdate ?? update.type ?? "");
      if (/agent_message_chunk|text_delta/i.test(kind)) { emit({ type: "assistant_text_delta", turnId, text: String(update.content?.text ?? update.text ?? "") }); return; }
      if (/agent_thought_chunk|reasoning/i.test(kind)) { emit({ type: "reasoning_delta", turnId, text: String(update.content?.text ?? update.text ?? "") }); return; }
      if (/tool_call_update/i.test(kind)) {
        const id = String(update.toolCallId ?? update.id ?? ""), state = String(update.status ?? "");
        if (/completed|failed/i.test(state)) finished(id, update.title, update.rawInput ?? {}, update.content ?? update.rawOutput, /failed/i.test(state));
        else emit({ type: "tool_call_updated", turnId, id, input: update.rawInput, output: update.content });
        return;
      }
      if (/tool_call/i.test(kind)) {
        const state = String(update.status ?? ""), id = String(update.toolCallId ?? update.id ?? randomUUID());
        if (/completed|failed/i.test(state)) finished(id, update.title, update.rawInput ?? {}, update.content, /failed/i.test(state));
        else started(id, String(update.title ?? "tool"), update.rawInput ?? {});
        return;
      }
      return;
    }
    // One turn runs at a time: every event is the running turn's, whatever id the runtime gives it.
    const id = turnId;
    if (/question/i.test(method)) { emit({ type: "question_requested", id: String(p?.id ?? randomUUID()), question: String(p?.question ?? p?.prompt ?? ""), options: p?.options }); return; }
    const item = p?.item ?? p;
    // Items that are not tool calls (the answer, the person's message, reasoning) are reported by their own deltas.
    const toolish = !/^(agentMessage|userMessage|reasoning|plan)$/i.test(String(item?.type ?? ""));
    if (/reasoning/i.test(method)) { if (/delta/i.test(method)) emit({ type: "reasoning_delta", turnId: id, text: String(p?.delta ?? p?.text ?? "") }); }
    else if (/textDelta|agent_message_chunk|assistant.*delta|agentMessage\/delta/i.test(method)) {
      const text = String(p?.delta ?? p?.text ?? p?.content ?? "");
      if (!text) return;
      // A Codex message is held while it repeats the one before it word for word (its "commentary" and "final" messages
      // often say the same thing); as soon as it differs, it is written out.
      if (held !== undefined) {
        held += text;
        if (previous.startsWith(held)) return;
        const out = (wrote ? "\n\n" : "") + held;
        held = undefined; wrote = true; current += out.replace(/^\n\n/, "");
        emit({ type: "assistant_text_delta", turnId: id, text: out });
        return;
      }
      wrote = true; current += text;
      emit({ type: "assistant_text_delta", turnId: id, text });
    }
    else if (!toolish && /^item\//i.test(method)) {
      // Codex writes several messages in a turn with nothing between them: each new one is a new paragraph.
      if (/agentMessage/i.test(String(item?.type ?? "")) && /started/i.test(method)) {
        if (current) previous = current.trim();
        current = "";
        held = wrote ? "" : undefined;
      } else if (/agentMessage/i.test(String(item?.type ?? "")) && /completed/i.test(method) && held !== undefined) {
        // The whole message repeated the one before it: it is not written again.
        if (held.trim() !== previous) { const out = (wrote ? "\n\n" : "") + held; wrote = true; current = held; emit({ type: "assistant_text_delta", turnId: id, text: out }); }
        held = undefined;
      }
      return;
    }
    else if (/tool.*start|item.*(created|started)/i.test(method)) {
      started(String(item?.id ?? randomUUID()), String(item?.name ?? item?.toolName ?? item?.tool ?? item?.type ?? "tool"), item?.input ?? item?.arguments ?? item?.command ?? {});
    } else if (/tool.*update|item.*updated/i.test(method)) {
      emit({ type: "tool_call_updated", turnId: id, id: String(item?.id ?? p?.itemId ?? ""), input: item?.input, output: item?.output });
    } else if (/tool.*finish|item.*completed/i.test(method)) {
      finished(String(item?.id ?? p?.itemId ?? ""), item?.name ?? item?.toolName ?? item?.tool ?? item?.type, item?.input ?? item?.arguments ?? {}, item?.output ?? item?.aggregatedOutput ?? item?.result?.content ?? item?.result ?? item?.error, /fail|error/i.test(String(item?.status ?? p?.status ?? "")));
    } else if (/usage|token/i.test(method)) {
      const usage = p?.tokenUsage?.last ?? p?.usage ?? p;
      emit({ type: "usage", inputTokens: usage?.inputTokens ?? usage?.input_tokens, outputTokens: usage?.outputTokens ?? usage?.output_tokens, cacheReadTokens: usage?.cacheReadTokens ?? usage?.cachedInputTokens ?? usage?.cached_input_tokens, costUsd: usage?.costUsd ?? usage?.cost_usd, ...(typeof p?.tokenUsage?.modelContextWindow === "number" ? { contextWindow: p.tokenUsage.modelContextWindow } : {}) });
    }
    else if (/compaction|compacted/i.test(method)) emit({ type: "compaction", phase: "end", detail: p });
    else if (/turn.*completed|turn.*finished/i.test(method)) { if (active) { active = false; emit({ type: "turn_completed", turnId: id }); } }
    else if (/turn.*failed|turn.*error|^error$/i.test(method)) { if (active) { active = false; emit({ type: "turn_failed", turnId: id, code: String(p?.code ?? "RUNTIME_ERROR"), diagnostic: String(p?.message ?? p?.error?.message ?? p?.error ?? stderr) }); } }
  });
  opts.rpc.child.stderr?.on("data", (b: Buffer) => { stderr = (stderr + b.toString()).slice(-8192); });
  opts.rpc.child.once("exit", (code, signal) => { if (active) { active = false; emit({ type: "turn_failed", turnId, code: String(code ?? signal ?? "PROCESS_EXIT"), diagnostic: `Process exited (code=${code}, signal=${signal})${stderr.trim() ? `\n${stderr.trim().split(/\r?\n/).slice(-8).join("\n")}` : ""}` }); } });
  opts.rpc.onRequest(async (method, p, id) => {
    const flat = method.replace(/[_-]/g, "");
    // Codex asks before an MCP tool runs with an MCP elicitation. JAgentChill's own tools are allowed by the server's
    // policy in every mode (jc_* calls are checked at the tool endpoint), so that question is answered here; any other
    // MCP server's question goes to the person like a permission.
    if (/elicitation/i.test(flat) && String(p?.serverName ?? "") === (opts.ownMcpServer ?? "jagentchill")) return permissionReply(method, p, "allow", undefined);
    if (/requestpermission|requestapproval|requestuserinput|elicitation/i.test(flat)) {
      const requestId = String(id);
      // Waited for before it is announced: an answer given during the announcement (auto-allowed) must not be lost.
      const answered = new Promise((resolve) => permissions.set(requestId, (decision, answer) => { emit({ type: "permission_resolved", id: requestId, decision }); resolve(permissionReply(method, p, decision, answer)); }));
      emit({ type: "permission_requested", id: requestId, kind: method, detail: p, actions: ["allow", "deny"] });
      return await answered;
    }
    return undefined;
  });
  return {
    async startTurn(prompt: string, attachments: RuntimeAttachment[] = []) {
      turnId = randomUUID(); nativeTurnId = undefined; active = true; wrote = false; current = ""; previous = ""; held = undefined; emit({ type: "turn_started", turnId });
      const mine = turnId;
      // The turn runs in the background: the request answers when the turn has ended (ACP) or at once (Codex).
      void opts.rpc.request(opts.turnMethod, opts.makeTurnParams?.(turnId, prompt, attachments, opts.sessionId) ?? { turnId, prompt, attachments, ...(opts.nativeHandle && typeof opts.nativeHandle === "object" ? opts.nativeHandle : {}) })
        .then((result: any) => { nativeTurnId = typeof result?.turn?.id === "string" ? result.turn.id : typeof result?.turnId === "string" ? result.turnId : nativeTurnId; if (active && turnId === mine && opts.runtime === "acp" && result?.stopReason) { active = false; emit(result.stopReason === "cancelled" ? { type: "turn_cancelled", turnId } : { type: "turn_completed", turnId }); } })
        .catch((e) => { if (active && turnId === mine) { active = false; emit({ type: "turn_failed", turnId, code: "TURN_START_FAILED", diagnostic: e instanceof Error ? e.message : String(e) }); } });
      return { turnId };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ...(opts.steerMethod && opts.makeSteerParams ? {
      async steer(prompt: string) {
        if (!active || !nativeTurnId) return false;
        try { await opts.rpc.request(opts.steerMethod!, opts.makeSteerParams!(prompt, opts.sessionId, nativeTurnId)); return true; } catch { return false; }
      },
    } : {}),
    async interrupt() {
      for (const [id, resolve] of permissions) { permissions.delete(id); resolve("deny"); }
      if (!active) return;
      const params = opts.makeInterruptParams?.(turnId, opts.sessionId, nativeTurnId) ?? { turnId };
      if (opts.interruptIsNotification) { try { opts.rpc.notify(opts.interruptMethod, params); } catch { /* already gone */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
      else await Promise.race([opts.rpc.request(opts.interruptMethod, params).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (!active) { await opts.rpc.close(); return; }
      active = false; emit({ type: "turn_cancelled", turnId }); await opts.rpc.close();
    },
    async respondToPermission(id, decision, answer) { const resolve = permissions.get(id); if (resolve) { permissions.delete(id); resolve(decision, answer); } },
    async answerQuestion(id, answer) { emit({ type: "question_resolved", id, answer }); const resolve = permissions.get(id); if (resolve) { permissions.delete(id); resolve("allow", { updatedInput: answer }); } },
    async setModel(model) { opts.model = model; },
    async setMode(mode) { opts.mode = mode; },
    persistence() { return { runtime: opts.runtime, sessionId: opts.sessionId, nativeHandle: opts.nativeHandle }; },
    async close() { off(); for (const [id, resolve] of permissions) { permissions.delete(id); resolve("deny"); } await opts.rpc.close(); },
  };
}
