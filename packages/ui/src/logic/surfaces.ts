/** Decisions of modal surfaces: drag-to-dismiss, snap points, the modal queue and the unsaved-input guard. */
export const DISMISS = { fraction: 0.3, fling: 800 } as const;
/** A sheet or drawer closes when dragged past 30% of its size toward its closing edge, or flung faster than 800 px/s. */
export function shouldDismiss(distance: number, size: number, velocity: number): boolean {
  return distance > size * DISMISS.fraction || velocity > DISMISS.fling;
}
/** Snap heights of a bottom sheet: its content, half and 90% of the viewport, never taller than 90%. */
export function snapPoints(contentHeight: number, viewportHeight: number): number[] {
  const cap = viewportHeight * 0.9;
  return [...new Set([Math.min(contentHeight, cap), viewportHeight * 0.5, cap].map(Math.round))].sort((a, b) => a - b);
}
export function nearestSnap(height: number, points: readonly number[]): number {
  return points.reduce((best, point) => (Math.abs(point - height) < Math.abs(best - height) ? point : best), points[0] ?? height);
}
/** Width of the drawer: 86% of the viewport up to 320 px. */
export const drawerWidth = (viewportWidth: number) => Math.min(320, Math.round(viewportWidth * 0.86));

export type CloseReason = "escape" | "scrim" | "button" | "action";
/** What a close request does: nothing on a blocking surface, a discard confirmation when input is unsaved, otherwise close. */
export function closeDecision(reason: CloseReason, state: { blocking?: boolean; dirty?: boolean }): "close" | "confirm-discard" | "ignore" {
  if (reason === "action") return "close";
  if (state.blocking && reason !== "button") return "ignore";
  return state.dirty ? "confirm-discard" : "close";
}
/**
 * Only one modal is visible at a time: a second request waits until the first closes, except a confirmation raised by the
 * open modal, which overlays it.
 */
export function modalQueue<T extends { id: string; parent?: string; priority?: number }>() {
  let queue: T[] = [];
  return {
    open(item: T) { queue = [...queue.filter((entry) => entry.id !== item.id), item]; },
    close(id: string) { queue = queue.filter((entry) => entry.id !== id && entry.parent !== id); },
    /** The highest-priority root modal and the confirmations it raised. Ties keep request order. */
    visible(): T[] {
      const [first] = queue.map((entry, order) => ({ entry, order }))
        .filter(({ entry }) => !entry.parent || !queue.some((other) => other.id === entry.parent))
        .sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.order - b.order)
        .map(({ entry }) => entry);
      return first ? [first, ...queue.filter((entry) => entry.parent === first.id)] : [];
    },
    size: () => queue.length,
  };
}
/** A destructive confirmation needs the name typed when it deletes more than 10 objects or deletes irreversibly. */
export const needsTypedConfirmation = (count: number, irreversible: boolean) => count > 10 || irreversible;

/** PanelGroup sizes are percentages of the group. */
export type PanelSpec = { id: string; default: number; min?: number; max?: number; collapsible?: boolean };
export function panelLayout(specs: readonly PanelSpec[], groupPx: () => number = () => 0, initial?: readonly number[]) {
  let sizes = initial ? [...initial] : specs.map((spec) => spec.default);
  const before = new Map<number, number>();
  const limit = (index: number, kind: "min" | "max") => {
    const raw = specs[index]![kind] ?? (kind === "min" ? 0 : 100);
    return raw;
  };
  /** Moves the splitter after panel `index` by `delta` percent, within both neighbours' limits. */
  const move = (index: number, delta: number) => {
    const [a, b] = [sizes[index]!, sizes[index + 1]!];
    const low = Math.max(limit(index, "min") - a, b - limit(index + 1, "max"));
    const high = Math.min(limit(index, "max") - a, b - limit(index + 1, "min"));
    const applied = Math.max(low, Math.min(high, delta));
    sizes = sizes.map((size, at) => (at === index ? a + applied : at === index + 1 ? b - applied : size));
    return applied;
  };
  return {
    sizes: () => sizes,
    move,
    /** Left/Right or Up/Down move by 1%, with Shift by 5%; Home/End go to the minimum and maximum. */
    key(index: number, key: string, shift: boolean, rtl = false): boolean {
      const amount = shift ? 5 : 1;
      const forward = key === "ArrowDown" || key === (rtl ? "ArrowLeft" : "ArrowRight");
      const backward = key === "ArrowUp" || key === (rtl ? "ArrowRight" : "ArrowLeft");
      if (forward) move(index, amount); else if (backward) move(index, -amount); else if (key === "Home") move(index, -100); else if (key === "End") move(index, 100); else return false;
      return true;
    },
    /** Double-click: the two adjacent panels return to their default sizes. */
    reset(index: number) {
      const total = sizes[index]! + sizes[index + 1]!;
      const share = specs[index]!.default / (specs[index]!.default + specs[index + 1]!.default);
      before.delete(index); before.delete(index + 1);
      sizes = sizes.map((size, at) => (at === index ? total * share : at === index + 1 ? total * (1 - share) : size));
    },
    /** Collapsing leaves a 0 px footprint; expanding restores the size held before collapse. */
    toggleCollapse(index: number, neighbour: number) {
      if (!specs[index]!.collapsible) return;
      const held = before.get(index);
      const amount = held === undefined ? -sizes[index]! : held;
      if (held === undefined) before.set(index, sizes[index]!); else before.delete(index);
      sizes = sizes.map((size, at) => (at === index ? size + amount : at === neighbour ? size - amount : size));
    },
    collapsed: (index: number) => before.has(index),
    pxToPercent: (px: number) => (groupPx() > 0 ? (px / groupPx()) * 100 : 0),
  };
}
