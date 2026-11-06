import { realTimers, type Timers } from "./timers.ts";

export type ToastKind = "success" | "info" | "warning" | "error" | "progress";
export type ToastInput = {
  kind?: ToastKind; message: string;
  action?: { label: string; onPress(): void };
  /** Shows "Undo": invokes the revert, then a 2 s confirmation, or an error toast when the revert fails. */
  undo?: () => void | Promise<void>;
  /** An error that requires a decision, or a progress toast: no automatic dismissal. */
  sticky?: boolean;
  progress?: number | null;
  /** The action stays reachable in the notification inbox after the toast disappears. */
  persistent?: boolean;
  duration?: number;
};
export type Toast = ToastInput & { id: number; kind: ToastKind; count: number; remaining: number | null; visible: boolean };

export const TOAST = { plain: 4000, withAction: 8000, confirmation: 2000, visible: 3, mergeWindow: 2000, minWidth: 240, maxWidth: 420, edge: 16 } as const;

/** The toast queue: at most 3 visible, the rest wait; identical messages within 2 s merge with a count; hover or focus pauses the timer. */
export function toastStore(options: { timers?: Timers; minDuration?: number; strings?: { restored: string; undoFailed: string }; onPersist?(toast: Toast): void } = {}) {
  const timers = options.timers ?? realTimers;
  let list: Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const running = new Map<number, { handle: unknown; startedAt: number }>();
  const raisedAt = new Map<number, number>();
  const emit = () => { list = [...list]; listeners.forEach((listener) => listener()); };
  const durationOf = (toast: ToastInput): number | null => {
    if (toast.sticky || toast.kind === "progress") return null;
    return Math.max(toast.duration ?? (toast.action || toast.undo ? TOAST.withAction : TOAST.plain), options.minDuration ?? 0);
  };
  const start = (toast: Toast) => {
    if (toast.remaining === null || running.has(toast.id)) return;
    running.set(toast.id, { handle: timers.set(() => dismiss(toast.id), toast.remaining), startedAt: timers.now() });
  };
  const stop = (toast: Toast) => {
    const timer = running.get(toast.id);
    if (!timer) return;
    timers.clear(timer.handle);
    running.delete(toast.id);
    toast.remaining = Math.max(0, (toast.remaining ?? 0) - (timers.now() - timer.startedAt));
  };
  const promote = () => {
    let shown = list.filter((toast) => toast.visible).length;
    for (const toast of list) {
      if (shown >= TOAST.visible) break;
      if (!toast.visible) { toast.visible = true; shown++; start(toast); }
    }
  };
  function dismiss(id: number) {
    const toast = list.find((item) => item.id === id);
    if (!toast) return;
    stop(toast);
    // A sticky error required a decision: it stays reachable in the inbox like a persistent toast.
    if (toast.persistent || (toast.kind === "error" && toast.sticky)) options.onPersist?.(toast);
    list = list.filter((item) => item.id !== id);
    promote();
    emit();
  }
  function show(input: ToastInput): number {
    const now = timers.now();
    const same = list.find((toast) => toast.message === input.message && (toast.kind === (input.kind ?? "info")) && now - (raisedAt.get(toast.id) ?? 0) <= TOAST.mergeWindow);
    if (same) {
      same.count++;
      raisedAt.set(same.id, now);
      if (same.visible) { stop(same); same.remaining = durationOf(same); start(same); }
      emit();
      return same.id;
    }
    const toast: Toast = { ...input, id: nextId++, kind: input.kind ?? "info", count: 1, remaining: durationOf(input), visible: false };
    raisedAt.set(toast.id, now);
    list.push(toast);
    promote();
    emit();
    return toast.id;
  }
  return {
    show, dismiss,
    /** Updates a toast in place, e.g. a progress toast reaching its final state. */
    update(id: number, patch: Partial<ToastInput>) {
      const toast = list.find((item) => item.id === id);
      if (!toast) return;
      stop(toast);
      Object.assign(toast, patch);
      toast.remaining = durationOf(toast);
      if (toast.visible) start(toast);
      emit();
    },
    pause(id: number) { const toast = list.find((item) => item.id === id); if (toast) stop(toast); },
    resume(id: number) { const toast = list.find((item) => item.id === id); if (toast?.visible) start(toast); },
    /** Runs the revert of a toast and replaces it with a confirmation for 2 s. */
    async undo(id: number) {
      const toast = list.find((item) => item.id === id);
      if (!toast?.undo) return;
      const revert = toast.undo;
      stop(toast);
      try {
        await revert();
        Object.assign(toast, { kind: "success", message: options.strings?.restored ?? "Restored", undo: undefined, action: undefined, sticky: false, count: 1, remaining: TOAST.confirmation });
        start(toast);
        emit();
      } catch {
        list = list.filter((item) => item.id !== id);
        show({ kind: "error", message: options.strings?.undoFailed ?? "Couldn’t undo", sticky: true });
      }
    },
    visible: () => list.filter((toast) => toast.visible),
    all: () => list,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type ToastStore = ReturnType<typeof toastStore>;
/** Errors are announced assertively, everything else politely. */
export const liveRegionOf = (kind: ToastKind): "assertive" | "polite" => (kind === "error" ? "assertive" : "polite");
