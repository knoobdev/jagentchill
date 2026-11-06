/** Compact shell measurements are modelled at the iPhone 15 logical size, with safe areas and an open keyboard. */
export type CompactWindow = { width: number; height: number; insetTop: number; insetBottom: number; keyboard: number };

export function globalSearchViewport(window: CompactWindow) {
  return {
    surfaceWidth: window.width,
    usableHeight: Math.max(0, window.height - window.insetTop - window.insetBottom - window.keyboard),
    touchTarget: 44,
  };
}

export function notificationRowLayout(window: CompactWindow) {
  const contentWidth = Math.max(0, window.width - 32);
  return { contentWidth, minRowHeight: 44, actionTarget: 44, usableHeight: Math.max(0, window.height - window.insetTop - window.insetBottom - window.keyboard) };
}

export function projectCardLayout(window: CompactWindow) {
  const cardWidth = Math.max(0, (window.width - 32 - 12) / 2);
  return { cardWidth, rowWidth: cardWidth * 2 + 12, actionTarget: 44 };
}

export function projectPlaceholderInitial(name: string) {
  return [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
}

/** A compact remote cannot stay on Home after its last paired host is removed. */
export function mobileHomeMustConnect(compact: boolean, hostsLoaded: boolean, hostCount: number) {
  return compact && hostsLoaded && hostCount === 0;
}
