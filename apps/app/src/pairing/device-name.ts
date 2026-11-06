export function nativeDeviceDisplayName(platform: "ios" | "android", deviceName?: string | null, modelName?: string | null): string {
  const candidate = deviceName?.trim() || modelName?.trim();
  if (candidate) return candidate;
  return platform === "ios" ? "iPhone" : "Android device";
}
