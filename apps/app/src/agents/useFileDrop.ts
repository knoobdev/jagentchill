import { useEffect, useRef } from "react";
import type { View } from "react-native";

const handledEvents = new WeakSet<Event>();

/** React Native Web does not forward drop/paste props on every surface, so bind browser events while this composer is mounted. */
export function useFileDrop(ref: { current: View | null }, onFiles: ((files: File[]) => void) | undefined) {
  const callback = useRef(onFiles);
  callback.current = onFiles;
  useEffect(() => {
    if (!onFiles || typeof document === "undefined") return;
    // Capture lets the active pane receive browser file gestures before a
    // React Native Web wrapper cancels them. Restrict delivery to this mounted
    // surface so hidden router screens cannot consume events for the visible one.
    const surface = ref.current as unknown as HTMLElement | null;
    const node = document;
    const belongsHere = (event: Event) => !!surface && event.composedPath().includes(surface);
    const dragOver = (event: DragEvent) => { if (belongsHere(event) && event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    const drop = (event: DragEvent) => {
      if (!belongsHere(event)) return;
      if (handledEvents.has(event)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      handledEvents.add(event);
      event.preventDefault(); event.stopPropagation(); callback.current?.(files);
    };
    const paste = (event: ClipboardEvent) => {
      if (!belongsHere(event)) return;
      if (handledEvents.has(event)) return;
      const files = Array.from(event.clipboardData?.items ?? []).map((item) => item.getAsFile()).filter((file): file is File => !!file);
      if (!files.length) return;
      handledEvents.add(event);
      event.preventDefault(); event.stopPropagation(); callback.current?.(files);
    };
    node.addEventListener("dragover", dragOver, true); node.addEventListener("drop", drop, true); node.addEventListener("paste", paste, true);
    return () => { node.removeEventListener("dragover", dragOver, true); node.removeEventListener("drop", drop, true); node.removeEventListener("paste", paste, true); };
  }, [ref, onFiles]);
}
