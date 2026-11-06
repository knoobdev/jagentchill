import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { NativeTailscaleAdapter, type JAgentChillTailscaleNativeModule } from "./adapter";

declare global {
  interface Window { __JCH_TEST_TAILSCALE_ADAPTER__?: NativeTailscaleAdapter }
}

export function getOptionalNativeTailscaleAdapter(): NativeTailscaleAdapter | null {
  if (typeof window !== "undefined" && window.__JCH_TEST_TAILSCALE_ADAPTER__) return window.__JCH_TEST_TAILSCALE_ADAPTER__;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  return getNativeTailscaleAdapter();
}

export function getNativeTailscaleAdapter(): NativeTailscaleAdapter {
  const module = requireOptionalNativeModule<JAgentChillTailscaleNativeModule>("JAgentChillTailscale");
  return new NativeTailscaleAdapter(Platform.OS === "android" ? "android" : "ios", module);
}

/** Writes pairing diagnostics through the existing Expo module's native log, visible in release device logs. */
export function logPairingTechnicalError(stage: string, error: unknown): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  const module = requireOptionalNativeModule<{ logTechnicalError?(message: string): void }>("JAgentChillTailscale");
  if (!module?.logTechnicalError) return;
  const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const safe = value.replace(/jagentchill:\/\/[^\s]+/gi, "[pairing link]").replace(/tskey-[a-z0-9-]+/gi, "[auth key]").slice(0, 400);
  module.logTechnicalError(`[JAgentChill pairing] ${stage}: ${safe}`);
}
