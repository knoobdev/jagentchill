export type NativeLibraryAction = "import" | "preview";

/** Native Library actions that currently depend on browser file/media APIs must explain why they cannot run. */
export function nativeLibraryActionUnavailable(platform: string, action: NativeLibraryAction): string | null {
  if (platform === "web") return null;
  return action === "import"
    ? "Importing Library items is not available on this device yet."
    : "Sound preview is not available on this device yet.";
}
