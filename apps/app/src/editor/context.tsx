import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { carryThroughPortals } from "@jagentchill/ui";
import type { EditorRuntime, TransportState } from "./runtime";

export const EditorContext = createContext<EditorRuntime | null>(null);
// Popovers and dialogs are drawn in the overlay stack, outside the editor's own tree: what they show reads the open project too.
carryThroughPortals(EditorContext);
/** The runtime of the open project. Every region of the editor reads the project and acts on it through this. */
export function useEditor(): EditorRuntime {
  const runtime = useContext(EditorContext);
  if (!runtime) throw new Error("the editor regions render inside an open project");
  return runtime;
}
/** Re-renders on every change of the project, the selection, the view or the editor's own state. */
export function useEditorVersion(): number {
  const runtime = useEditor();
  return useSyncExternalStore(runtime.subscribe, () => runtime.uiVersion, () => 0);
}
/**
 * Re-renders on a change of the project's content, the selection, a tool, a dialog or a setting — not on a scroll, a zoom
 * or a seek of the timeline, nor when a filmstrip frame arrives (`contentVersion` in `runtime.ts`). For the regions
 * that do not draw the timeline's view; the time they show comes from the transport.
 */
export function useEditorContent(): number {
  const runtime = useEditor();
  return useSyncExternalStore(runtime.subscribe, () => runtime.contentVersion, () => 0);
}
/** The transport: it changes many times a second during playback, so only what shows the time subscribes to it. */
export function useTransport(): TransportState {
  const runtime = useEditor();
  // What is read here follows the running clock as fast as this tree commits, not faster (`paced-store.ts`): the store
  // is told when a value has been committed and its effects have run, and only then shows the next one.
  const shown = useSyncExternalStore(runtime.shownTransport.subscribe, runtime.shownTransport.get, runtime.shownTransport.get);
  useEffect(() => { runtime.shownTransport.committed(shown); });
  return shown;
}

/** Same value, or the same entries of an array / the same fields of a plain object (one level). */
export function sameShallow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, index) => Object.is(entry, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/**
 * One reading of the editor: re-renders only when what `select` returns has changed (`sameShallow`). A region that
 * shows the document does not render again for a selection, a scroll or a dialog, and the other way round — with
 * `useEditorVersion` one click rendered the whole editor.
 */
export function useEditorSelect<T>(select: (runtime: EditorRuntime) => T, same: (a: T, b: T) => boolean = sameShallow): T {
  const runtime = useEditor(), held = useRef<{ value: T } | null>(null);
  const read = () => { const next = select(runtime); if (held.current && same(held.current.value, next)) return held.current.value; held.current = { value: next }; return next; };
  return useSyncExternalStore(runtime.subscribe, read, read);
}
/** One reading of the transport (see `useEditorSelect`). For what does not show the running clock: playing or not, the engine, the volume. */
export function useTransportSelect<T>(select: (transport: TransportState) => T, same: (a: T, b: T) => boolean = sameShallow): T {
  const runtime = useEditor(), held = useRef<{ value: T } | null>(null);
  const read = () => { const next = select(runtime.transport); if (held.current && same(held.current.value, next)) return held.current.value; held.current = { value: next }; return next; };
  return useSyncExternalStore(runtime.subscribeTransport, read, read);
}
const sameButTime = (a: TransportState, b: TransportState): boolean => a === b || (Object.keys(a) as (keyof TransportState)[]).every((key) => key === "time" || Object.is(a[key], b[key]));
/**
 * The transport without the running clock: while it plays, `time` stays where it was when playback started, and it is
 * the true time again as soon as it stops, seeks or anything else changes. For the regions that do not show the moving
 * time (the tracks, the canvas overlays, which are hidden while it plays): they render when playback starts and stops,
 * not on every frame of it. What moves with the clock is moved outside React (`runtime.subscribeTransport`).
 */
export function useSettledTransport(): TransportState {
  return useTransportSelect((transport) => transport, (held, next) => held === next || (held.playing && next.playing && sameButTime(held, next)));
}

// — The transport as the inspector reads it —
const heldEpoch = new WeakMap<object, number>(), heldListeners = new WeakMap<object, Set<() => void>>();
/** Makes what `useHeldTransport` shows the true time now, also in the middle of playback (the person reached for a control). */
export function refreshHeldTransport(runtime: EditorRuntime): void {
  heldEpoch.set(runtime, (heldEpoch.get(runtime) ?? 0) + 1);
  for (const listener of heldListeners.get(runtime) ?? []) listener();
}
/**
 * The transport for the panels that show "the value under the playhead" (the inspector's tabs, the keyframe lanes).
 * While it plays, the time stays where it was — playing renders none of them, with or without a selection — and it is
 * the true time again when playback stops, on a seek, and the moment the person reaches for one of their controls
 * (`refreshHeldTransport`), so that what they then change is written at the time they see.
 */
export function useHeldTransport(): TransportState {
  const runtime = useEditor(), held = useRef<{ value: TransportState; epoch: number } | null>(null);
  const read = () => {
    const next = runtime.transport, epoch = heldEpoch.get(runtime) ?? 0, last = held.current;
    if (last && last.epoch === epoch && (last.value === next || (last.value.playing && next.playing && sameButTime(last.value, next)))) return last.value;
    held.current = { value: next, epoch };
    return next;
  };
  const subscribe = useCallback((listener: () => void) => {
    const off = runtime.subscribeTransport(listener), all = heldListeners.get(runtime) ?? new Set<() => void>();
    heldListeners.set(runtime, all); all.add(listener);
    return () => { off(); all.delete(listener); };
  }, [runtime]);
  return useSyncExternalStore(subscribe, read, read);
}
