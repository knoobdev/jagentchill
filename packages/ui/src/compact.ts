/** Shared measurements for compact phone layouts (points). */
export const compactScale = {
  type: {
    title: { fontSize: 20, lineHeight: 26, fontWeight: "600" as const },
    section: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
    body: { fontSize: 15, lineHeight: 21, fontWeight: "400" as const },
    secondary: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  },
  space: { side: 16, card: 12, gapSmall: 8, gapMedium: 12, gapLarge: 16 },
  control: { height: 44, icon: 20, listRow: 64 },
} as const;

/** Available phone content geometry after safe areas and a visible keyboard. */
export function compactViewport(input: { width: number; height: number; insetTop: number; insetBottom: number; keyboardHeight: number }) {
  const keyboardHeight = Math.max(0, Math.min(input.height, input.keyboardHeight));
  const bottomInset = keyboardHeight > 0 ? 0 : Math.max(0, input.insetBottom);
  const top = Math.max(0, input.insetTop);
  const bottom = Math.max(0, input.height - keyboardHeight - bottomInset);
  return {
    width: Math.max(0, input.width),
    top,
    bottom,
    height: Math.max(0, bottom - top),
    keyboardTop: keyboardHeight > 0 ? input.height - keyboardHeight : null,
  };
}

/** The inner card width after the phone's side gutters and card padding. */
export function compactCardContentWidth(width: number) {
  return Math.max(0, width - compactScale.space.side * 2 - compactScale.space.card * 2);
}

/** Text constraints shared by compact timeline rows so long tool and waiting copy wraps instead of widening the card. */
export function compactCardTextLayout(compact: boolean) {
  return compact ? { minWidth: 0, flexShrink: 1, maxWidth: "100%" as const } : {};
}

/** One-column card width inside the phone list's shared side gutters. */
export function compactListCardWidth(width: number) {
  return Math.max(0, width - compactScale.space.side * 2);
}

/** Session chat occupies the phone width; the workspace is reached by pushing a route. */
export function compactSessionMetrics(width: number) {
  return { headerHeight: compactScale.control.height, timelineWidth: Math.max(0, width - compactScale.space.side * 2), workspaceMode: "pushed-screen" as const, composerMode: "in-flow-dock" as const };
}

/** Workspace tabs stay thumb-sized on phones and use the compact row height on larger layouts. */
export function workspaceTabMetrics(compact: boolean) {
  return { height: compact ? compactScale.control.height : 36, minTarget: compact ? compactScale.control.height : 28 };
}

/** The Sessions filters collapse into one labeled action on compact screens. */
export function compactSessionFilterMetrics(width: number) {
  const contentWidth = Math.max(0, width - compactScale.space.side * 2);
  return {
    contentWidth,
    triggerWidth: Math.min(112, contentWidth),
    triggerHeight: compactScale.control.height,
    fieldWidth: Math.min(320, contentWidth),
    presentation: "sheet" as const,
  };
}

/** Settings controls move below their labels across compact phone widths. */
export function compactSettingRowStacks(width: number, compact: boolean, hasControl: boolean) {
  return compact && width < 600 && hasControl;
}

/** Scroll content clears the fixed Home composer and the device's bottom safe area. */
export function homeScrollBottomPadding(dockHeight: number, insetBottom: number) {
  return Math.max(0, dockHeight) + Math.max(0, insetBottom);
}
