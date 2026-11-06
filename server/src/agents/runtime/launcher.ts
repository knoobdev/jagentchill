import type { ResolvedRuntime } from "../../runtimes/registry.ts";
import { AcpRuntimeClient, ClaudeRuntimeClient, CodexRuntimeClient } from "./clients.ts";
import type { RuntimeClient } from "./types.ts";

/**
 * The client of a runtime the server drives itself: Claude Code through the Claude Agent SDK, Codex through its
 * app-server, every other CLI over the Agent Client Protocol. `command` is the installed CLI the runtime probe found
 * (with an admin's command override); without one the runtime cannot be started.
 */
export function runtimeClient(runtime: ResolvedRuntime, command: { path: string; env: Record<string, string> } | undefined): RuntimeClient | undefined {
  if (!command) return undefined;
  if (runtime.driver === "claude") return new ClaudeRuntimeClient(command.path);
  if (runtime.driver === "codex") return new CodexRuntimeClient(command.path);
  // An admin's command for a custom ACP agent names its arguments too; a shipped one has its own ACP switch.
  const args = runtime.entry?.command ? runtime.entry.command.slice(1) : runtime.acpArgs ?? ["--acp"];
  // OpenCode lists the models it can use (its free Zen ones included) in its ACP session; it is started once to read them.
  return new AcpRuntimeClient(command.path, args, { listModels: runtime.id === "acp-opencode" });
}
