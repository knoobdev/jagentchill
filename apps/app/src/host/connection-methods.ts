import type { IconName } from "@jagentchill/ui";

export type ConnectionMethod = { id: "direct" | "scan" | "tailscale" | "paste"; title: string; description: string; icon: IconName };

/** The method order and copy mirror JAgentDesk's add-host sheet. */
export function connectionMethods(showScan: boolean): ConnectionMethod[] {
  return [
    { id: "direct", title: "Direct connection", description: "Local network or VPN.", icon: "device" },
    ...(showScan ? [{ id: "scan" as const, title: "Scan QR code", description: "Tailnet connection.", icon: "qr" as const }] : []),
    { id: "tailscale", title: "Pair over Tailscale", description: "Connect directly through your tailnet, then confirm with the 6-digit code.", icon: "cloud" },
    { id: "paste", title: "Paste pairing link", description: "Tailnet connection.", icon: "link" },
  ];
}
