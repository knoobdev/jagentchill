const TRANSPORT_LABEL: Record<string, string> = { loopback: "Local", lan: "Local network", tailnet: "Tailscale" };

export function connectionFooterParts(input: {
  desktopMode: "tailscale" | "local" | null;
  builtInHost?: boolean;
  tailnetConnected: boolean;
  preferredKind?: string;
  transport?: string;
  statusLabel: string;
}): { state: string; path?: string } {
  if (input.desktopMode === "tailscale" && input.builtInHost) {
    return { state: input.statusLabel, path: input.tailnetConnected ? "This computer (Tailscale on)" : "This computer (Tailscale needs sign-in)" };
  }
  const transport = input.preferredKind === "tailnet" && input.tailnetConnected && input.transport === "loopback"
    ? "tailnet"
    : input.transport ?? (input.desktopMode === "tailscale" ? "tailnet" : undefined);
  const path = transport ? TRANSPORT_LABEL[transport] : undefined;
  return { state: input.statusLabel, ...(path ? { path } : {}) };
}
