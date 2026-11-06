export type SafeInsets = { top: number; bottom: number };

/** Insets for the shared compact screen scaffold. Wide layouts and web keep their existing zero-inset geometry. */
export function screenScaffoldMetrics(insets: SafeInsets, compact: boolean, barHeight: number) {
  // Keep the first row's expanded native touch bounds a point clear of the status bar.
  const top = compact && insets.top > 0 ? insets.top + 1 : 0;
  return {
    headerHeight: barHeight + top,
    headerPaddingTop: top,
    barHeight,
    contentPaddingBottom: compact ? insets.bottom : 0,
  };
}

/** expo-status-bar style matching the app's light or dark surface theme. */
export function statusBarStyle(scheme: "light" | "dark"): "dark" | "light" {
  return scheme === "dark" ? "light" : "dark";
}
