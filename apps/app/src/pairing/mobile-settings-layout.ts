/** Settings rows and tables use their phone layout below 600 pt. */
export const stacksSettingsRows = (width: number): boolean => width < 600;
export const pairedHostLayout = (width: number): "stacked" | "inline" => stacksSettingsRows(width) ? "stacked" : "inline";
export const deviceRowsLayout = (width: number): "stacked" | "table" => stacksSettingsRows(width) ? "stacked" : "table";
export const providerCatalogLayout = (width: number): "stacked" | "inline" => stacksSettingsRows(width) ? "stacked" : "inline";
export const hostSpaceControlsLayout = (width: number): "stacked" | "inline" => stacksSettingsRows(width) ? "stacked" : "inline";
export const DEVICE_ROLE_OPTIONS = [{ value: "admin", label: "Admin" }, { value: "editor", label: "Editor" }, { value: "viewer", label: "Viewer" }] as const;

/** Space left for a scrollable settings page when safe areas and the keyboard are visible. */
export const settingsViewportHeight = (input: { height: number; topInset: number; bottomInset: number; keyboardHeight: number }): number =>
  Math.max(0, input.height - input.topInset - input.bottomInset - input.keyboardHeight);
