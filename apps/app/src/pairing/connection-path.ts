/** The transport label is the path the authenticated peer used, not the IP of a local forwarding socket. */
export function deviceConnectionPath(transport: string | null | undefined): "Tailscale" | "Local" | "Local network" | "Unknown" {
  if (transport === "tailnet") return "Tailscale";
  if (transport === "lan") return "Local network";
  if (transport === "loopback") return "Local";
  return "Unknown";
}
