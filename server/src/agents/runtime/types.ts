import type { ChildProcess } from "node:child_process";

export type RuntimeKind = "claude" | "codex" | "opencode" | "acp";
export type RuntimeAttachment = { path?: string; mimeType?: string; data?: string; name?: string };
export type RuntimeModel = {
  id: string; label: string; description?: string;
  /** Facts a runtime may report about a model; absent when it does not say. */
  contextWindow?: number; input?: Array<"text" | "image" | "audio" | "video" | "document">;
  thinkingLevels?: Array<{ id: string; label: string }>; thinkingDefault?: string; supportsFastMode?: boolean; isDefault?: boolean;
};
export type RuntimeCatalog = { models: RuntimeModel[]; modes: string[] };
export type RuntimePersistence = { runtime: RuntimeKind; sessionId: string; nativeHandle?: unknown };
export type RuntimeEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "turn_completed"; turnId: string }
  | { type: "turn_failed"; turnId: string; code: string; diagnostic: string }
  | { type: "turn_cancelled"; turnId: string }
  | { type: "assistant_text_delta"; turnId: string; text: string }
  | { type: "reasoning_delta"; turnId: string; text: string }
  | { type: "tool_call_started"; turnId: string; id: string; name: string; input: unknown }
  | { type: "tool_call_updated"; turnId: string; id: string; input?: unknown; output?: unknown }
  | { type: "tool_call_finished"; turnId: string; id: string; name: string; input: unknown; output?: unknown; status: "completed" | "failed" }
  | { type: "permission_requested"; id: string; kind: string; detail: unknown; actions: string[] }
  | { type: "permission_resolved"; id: string; decision: string }
  | { type: "question_requested"; id: string; question: string; options?: string[] }
  | { type: "question_resolved"; id: string; answer: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; contextWindow?: number; model?: string }
  | { type: "compaction"; phase?: "start" | "end"; detail?: unknown };
export type RuntimeListener = (event: RuntimeEvent) => void;
/** What a permission answer may carry besides allow/deny: the tool input to run with (an answered question), or why it was refused. */
export type PermissionAnswer = { updatedInput?: unknown; message?: string };
export type RuntimeSession = {
  startTurn(prompt: string, attachments?: RuntimeAttachment[]): Promise<{ turnId: string }>;
  subscribe(listener: RuntimeListener): () => void;
  interrupt(): Promise<void>;
  /** A message of the person added to the turn that is running (Codex `turn/steer`); false when it could not be added. */
  steer?(prompt: string): Promise<boolean>;
  respondToPermission(id: string, decision: string, answer?: PermissionAnswer): Promise<void>;
  answerQuestion(id: string, answer: string): Promise<void>;
  setModel(model: string): Promise<void>;
  setMode(mode: string): Promise<void>;
  persistence(): RuntimePersistence;
  close(): Promise<void>;
};
/** How a session is opened: the model, the runtime's own permission mode, where it works, and the server's tools it reaches. */
export type RuntimeOpenOptions = {
  model?: string; mode?: string; thinking?: string; mcpUrl?: string; mcpToken?: string;
  /** The working directory of the agent. */
  cwd?: string;
  /** The whole environment of the CLI process; absent: the server's own. */
  env?: Record<string, string>;
  /**
   * Per-session configuration of the runtime itself (Codex: merged into the `config` of `thread/start`, e.g. a custom
   * `model_providers` entry for a stored key or an endpoint). Never holds a secret: keys travel in `env`.
   */
  config?: Record<string, unknown>;
  /** Text the runtime adds to its own system instructions. */
  instructions?: string;
  /** The product session the runtime session belongs to (fakes and diagnostics only; adapters do not send it). */
  sessionKey?: string;
};
export type RuntimeClient = {
  readonly kind: RuntimeKind;
  isAvailable(): Promise<boolean>;
  createSession(options?: RuntimeOpenOptions): Promise<RuntimeSession>;
  resumeSession(handle: RuntimePersistence, options?: RuntimeOpenOptions): Promise<RuntimeSession>;
  catalog(): Promise<RuntimeCatalog>;
};
export type ProcessLike = Pick<ChildProcess, "stdin" | "stdout" | "stderr" | "pid" | "kill" | "once" | "on">;

export function errorDiagnostic(code: string | number | null, signal: string | null, stderr: string): string {
  const tail = stderr.trim().split(/\r?\n/).slice(-8).join("\n");
  return `Process exited (code=${String(code)}, signal=${String(signal)})${tail ? `\n${tail}` : ""}`;
}
