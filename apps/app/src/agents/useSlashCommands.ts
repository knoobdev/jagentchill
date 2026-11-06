import { useEffect, useRef, useState } from "react";
import type { ModelRef } from "@jagentchill/protocol";
import { useHost } from "../host";

export type SlashCommand = { name: string; description: string; argsHint?: string; acceptsArgs?: boolean; source?: string; template?: string };
export function useSlashCommands(input: { sessionKey?: string; ref?: ModelRef | null; agentId?: string; projectId?: string | null; modelLabel?: string }) {
  const { connection, onEvent } = useHost();
  const subscribe = useRef(onEvent);
  subscribe.current = onEvent;
  const [state, setState] = useState<{ commands: SlashCommand[]; loaded: boolean; model: string }>({ commands: [], loaded: false, model: input.modelLabel ?? "model" });
  useEffect(() => {
    if (!connection || (!input.sessionKey && !input.ref)) { setState({ commands: [], loaded: false, model: input.modelLabel ?? "model" }); return; }
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setState({ commands: [], loaded: false, model: input.modelLabel ?? input.ref?.modelId ?? "model" });
    const refresh = () => {
      attempts += 1;
      void connection.call<{ commands: SlashCommand[]; model?: string }>("jagentchill.chat.commands", {
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : { ref: input.ref, ...(input.agentId ? { agentId: input.agentId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}) }),
      }).then((result) => {
        if (live) setState({ commands: result.commands, loaded: true, model: input.modelLabel ?? result.model ?? input.ref?.modelId ?? "model" });
      }, (error: unknown) => {
        const failure = error as { code?: string; retryable?: boolean; message?: string };
        const gatewayStarting = failure?.code === "GATEWAY_UNAVAILABLE" || (failure?.retryable === true && /gateway|agent engine is not running/i.test(failure.message ?? ""));
        if (live && gatewayStarting && attempts < 12) retryTimer = setTimeout(refresh, 500);
        else if (live) setState({ commands: [], loaded: true, model: input.modelLabel ?? input.ref?.modelId ?? "model" });
      });
    };
    refresh();
    const unsubscribe = input.sessionKey ? subscribe.current((event) => {
      const payload = event.payload ?? {};
      if (event.event === "jagentchill.chat.stream" && payload.sessionKey === input.sessionKey && ["final", "error", "aborted"].includes(String(payload.state))) refresh();
    }) : undefined;
    return () => { live = false; if (retryTimer) clearTimeout(retryTimer); unsubscribe?.(); };
  }, [connection, input.sessionKey, input.ref?.runtimeId, input.ref?.providerId, input.ref?.modelId, input.agentId, input.projectId, input.modelLabel]);
  return state;
}
