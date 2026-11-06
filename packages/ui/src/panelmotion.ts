/**
 * "Panels are moving": the one signal shared by everything that slides a docked panel (`EdgePanel`, `PanelGroup`) and
 * everything that reacts to its own size (the timeline, the preview, lists that measure themselves). While a panel
 * slides, the browser moves the boxes by itself (a CSS transition); a consumer that re-rendered on every size it sees
 * would cost a React commit per frame, which is what makes a slide stutter. So consumers hold their size while this is
 * on and take the final one once, when it goes off.
 */
import { gateResizeObservers } from "./platform/dom";

let moving = 0;
const listeners = new Set<(moving: boolean) => void>();

export const panelsMoving = (): boolean => moving > 0;
/** Starts a move; the function returned ends it (once). Listeners hear the first start and the last end. */
export function beginPanelMotion(): () => void {
  let ended = false;
  if (++moving === 1) for (const listener of [...listeners]) listener(true);
  return () => {
    if (ended) return;
    ended = true;
    if (--moving === 0) for (const listener of [...listeners]) listener(false);
  };
}
export function onPanelMotion(listener: (moving: boolean) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
// Every ResizeObserver of the page — and with them every `onLayout` — waits for the end of a slide as well.
gateResizeObservers(panelsMoving, (listener) => { onPanelMotion((on) => { if (!on) listener(); }); });
/**
 * Holds a size callback while panels move: `report` passes sizes through at rest, keeps the last one while moving
 * and delivers it when the move ends. Returns the gate and its disposer.
 */
export function gateWhilePanelsMove<T>(deliver: (value: T) => void): { report(value: T): void; dispose(): void } {
  let pending: { value: T } | null = null;
  const off = onPanelMotion((on) => { if (!on && pending) { const held = pending; pending = null; deliver(held.value); } });
  return { report(value) { if (panelsMoving()) pending = { value }; else deliver(value); }, dispose: off };
}
