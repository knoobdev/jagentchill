import type { TailnetLoginState } from "../tailscale/adapter.ts";

export type MobileOfferPath = "pair" | "join-tailnet" | "release-refused";

/** A phone can only reach an enrolled host through its signed-in embedded tailnet proxy. */
export function mobileOfferPath(input: {
  hasNativeTailnet: boolean;
  hasTailnetAddress: boolean;
  tailnetStatus: TailnetLoginState | null;
  isDevelopment: boolean;
}): MobileOfferPath {
  if (input.hasNativeTailnet && input.hasTailnetAddress && input.tailnetStatus !== "connected") return "join-tailnet";
  if (input.hasNativeTailnet && !input.hasTailnetAddress && !input.isDevelopment) return "release-refused";
  return "pair";
}
