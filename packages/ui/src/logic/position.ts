export type Rect = { x: number; y: number; width: number; height: number };
export type Side = "top" | "bottom" | "start" | "end";
export type Placement = { x: number; y: number; side: Side; maxHeight: number };

/**
 * Places a floating surface next to its anchor: `offset` px away on `side`, flipped to the opposite side when it does
 * not fit, then shifted to stay `inset` px inside the viewport. `start`/`end` are inline sides and mirror in RTL.
 */
export function place(input: {
  anchor: Rect; size: { width: number; height: number }; viewport: { width: number; height: number };
  side?: Side; align?: "start" | "center" | "end"; offset?: number; inset?: number; rtl?: boolean;
}): Placement {
  const { anchor, size, viewport } = input;
  const offset = input.offset ?? 4, inset = input.inset ?? 8, rtl = input.rtl ?? false;
  let side = input.side ?? "bottom";
  const align = input.align ?? "start";
  const room: Record<Side, number> = {
    top: anchor.y - offset - inset,
    bottom: viewport.height - (anchor.y + anchor.height) - offset - inset,
    start: (rtl ? viewport.width - (anchor.x + anchor.width) : anchor.x) - offset - inset,
    end: (rtl ? anchor.x : viewport.width - (anchor.x + anchor.width)) - offset - inset,
  };
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", start: "end", end: "start" };
  const need = side === "top" || side === "bottom" ? size.height : size.width;
  if (room[side] < need && room[opposite[side]] > room[side]) side = opposite[side];
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));
  let x: number, y: number;
  if (side === "top" || side === "bottom") {
    y = side === "bottom" ? anchor.y + anchor.height + offset : anchor.y - offset - size.height;
    const startEdge = rtl ? anchor.x + anchor.width - size.width : anchor.x;
    const endEdge = rtl ? anchor.x : anchor.x + anchor.width - size.width;
    const wouldOverflowStart = startEdge + size.width > viewport.width - inset;
    const endFits = endEdge >= inset && endEdge + size.width <= viewport.width - inset;
    x = align === "center" ? anchor.x + (anchor.width - size.width) / 2 : align === "start" ? (wouldOverflowStart && endFits ? endEdge : startEdge) : endEdge;
  } else {
    const physicalRight = (side === "end") !== rtl;
    x = physicalRight ? anchor.x + anchor.width + offset : anchor.x - offset - size.width;
    y = align === "center" ? anchor.y + (anchor.height - size.height) / 2 : align === "start" ? anchor.y : anchor.y + anchor.height - size.height;
  }
  return {
    x: clamp(x, inset, viewport.width - inset - size.width), y: clamp(y, inset, viewport.height - inset - size.height), side,
    maxHeight: viewport.height - 2 * inset,
  };
}

/** True while the pointer heads from a menu row toward its open submenu, so the submenu stays open on a diagonal path. */
export function headingToward(from: { x: number; y: number }, to: { x: number; y: number }, submenu: Rect): boolean {
  const nearX = submenu.x >= from.x ? submenu.x : submenu.x + submenu.width;
  const movingToward = Math.abs(nearX - to.x) < Math.abs(nearX - from.x);
  if (!movingToward) return false;
  const span = nearX - from.x;
  if (span === 0) return false;
  const slope = (to.y - from.y) / (to.x - from.x || 1e-6);
  const yAtEdge = from.y + slope * span;
  return yAtEdge >= submenu.y - 8 && yAtEdge <= submenu.y + submenu.height + 8;
}
