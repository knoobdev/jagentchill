import { useSyncExternalStore } from "react";

// "Apply to all" of the caption tabs: one switch for the Captions, Text and Animation tabs of a selected caption, on by default.
let applyAll = true;
const listeners = new Set<() => void>();
export function setCaptionApplyAll(on: boolean): void { applyAll = on; for (const listener of [...listeners]) listener(); }
export function useCaptionApplyAll(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => void listeners.delete(listener); }, () => applyAll, () => true);
}
