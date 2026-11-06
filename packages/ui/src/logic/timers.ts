/** The clock a controller runs on; tests pass a fake one. */
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number };
export const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };

/** Calls `fn` once, `ms` after the last `call`. `flush` fires a pending call now; `cancel` drops it. */
export function debouncer<A extends unknown[]>(fn: (...args: A) => void, ms: number, timers: Timers = realTimers) {
  let handle: unknown = null;
  let pending: A | null = null;
  const fire = () => { const args = pending; handle = null; pending = null; if (args) fn(...args); };
  return {
    call(...args: A) { pending = args; if (handle !== null) timers.clear(handle); handle = timers.set(fire, ms); },
    flush() { if (handle !== null) { timers.clear(handle); fire(); } },
    cancel() { if (handle !== null) timers.clear(handle); handle = null; pending = null; },
    pending: () => handle !== null,
  };
}

/** Thresholds of loading feedback, in ms since the operation started. */
export const LOADING = { skeleton: 150, indicator: 1000, determinate: 10000, searchSpinner: 300 } as const;
/** What a running operation shows after `elapsed` ms. */
export function loadingFeedback(elapsed: number, cancellable = false) {
  return {
    skeleton: elapsed >= LOADING.skeleton,
    indicator: elapsed >= LOADING.indicator,
    determinate: elapsed >= LOADING.determinate,
    cancel: elapsed >= LOADING.determinate && cancellable,
  };
}
