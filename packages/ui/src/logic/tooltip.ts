import { realTimers, type Timers } from "./timers.ts";

export const TOOLTIP = { delay: 500, leave: 100, adjacent: 300, longPress: 1500, longPressDelay: 500, gap: 6, maxWidth: 240 } as const;

// One tooltip having shown, the next trigger within 300 ms shows without delay: the moment is shared by all tooltips.
let lastHiddenAt = -Infinity;
export const resetTooltipWarmth = () => { lastHiddenAt = -Infinity; };

/**
 * Decides when a tooltip is visible. The pointer may travel from the trigger onto the tooltip across the gap: the
 * tooltip closes 100 ms after the pointer has left both.
 */
export function tooltipController(onChange: (visible: boolean) => void, timers: Timers = realTimers) {
  let visible = false, overTrigger = false, overTip = false, focused = false;
  let showTimer: unknown = null, hideTimer: unknown = null;
  const cancel = () => { if (showTimer !== null) timers.clear(showTimer); if (hideTimer !== null) timers.clear(hideTimer); showTimer = hideTimer = null; };
  const show = () => { cancel(); if (!visible) { visible = true; onChange(true); } };
  const hide = () => { cancel(); if (visible) { visible = false; lastHiddenAt = timers.now(); onChange(false); } };
  const settle = () => {
    if (overTrigger || overTip || focused) return;
    if (showTimer !== null) { timers.clear(showTimer); showTimer = null; }
    if (visible && hideTimer === null) hideTimer = timers.set(hide, TOOLTIP.leave);
  };
  return {
    pointerEnter() {
      overTrigger = true;
      if (hideTimer !== null) { timers.clear(hideTimer); hideTimer = null; }
      if (visible || showTimer !== null) return;
      if (timers.now() - lastHiddenAt <= TOOLTIP.adjacent) show(); else showTimer = timers.set(show, TOOLTIP.delay);
    },
    pointerLeave() { overTrigger = false; settle(); },
    tipEnter() { overTip = true; if (hideTimer !== null) { timers.clear(hideTimer); hideTimer = null; } },
    tipLeave() { overTip = false; settle(); },
    /** Keyboard focus shows the tooltip immediately. */
    focus() { focused = true; show(); },
    blur() { focused = false; settle(); if (!overTrigger && !overTip) hide(); },
    /** Escape, scroll and press close it; focus does not move. */
    dismiss() { overTrigger = overTip = false; hide(); },
    /** Touch long-press: the label shows for 1.5 s, or for the minimum toast duration when that is longer. */
    longPress(minMs = 0) { show(); hideTimer = timers.set(hide, Math.max(TOOLTIP.longPress, minMs)); },
    visible: () => visible,
    dispose: cancel,
  };
}
