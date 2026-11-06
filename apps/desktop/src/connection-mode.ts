export type ConnectionMode = "tailscale" | "local";
export type ConnectionModeAction = "none" | "start" | "restart" | "stop";

/** The bundled host has no network policy before the person chooses a connection mode. */
export function shouldStartBundledHost(mode: ConnectionMode | null | undefined): boolean {
  return mode === "tailscale" || mode === "local";
}

/** First choice starts the host; changing a saved mode restarts it with the new listener policy. */
export function connectionModeAction(previous: ConnectionMode | null, next: ConnectionMode | null): ConnectionModeAction {
  if (next === null) return previous === null ? "none" : "stop";
  return previous === next ? "none" : previous === null ? "start" : "restart";
}
