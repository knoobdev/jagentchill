import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import type { AgentNotice } from "@jagentchill/protocol";
import type { NoticeFocus } from "@jagentchill/app-core";
import { radius, useTheme } from "@jagentchill/ui";

/**
 * The card a notification led to: the session screen sets it from its route (`?focus=<kind>:<id>`), the card that is
 * about that subject brings itself into view and is outlined for a few seconds. One at a time, for this device only.
 */
type Target = NoticeFocus & { at: number };
let target: Target | null = null;
const listeners = new Set<() => void>();
const publish = (next: Target | null) => { target = next; for (const listener of listeners) listener(); };
const SHOWN_MS = 8000;
export const cardFocus = {
  set(focus: NoticeFocus): void { publish({ ...focus, at: Date.now() }); },
  /** Ends the focus that was set at `at` (a later one stays). */
  clear(at?: number): void { if (target && (at === undefined || target.at === at)) publish(null); },
  get: (): Target | null => target,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
};
export function useCardFocus(): Target | null {
  return useSyncExternalStore(cardFocus.subscribe, cardFocus.get, cardFocus.get);
}

/** Wraps the card of one subject: while a notification points at it, it scrolls into view and is outlined. */
export function Focusable(props: { kind: AgentNotice["kind"]; id: string; children: ReactNode }) {
  const theme = useTheme(), ref = useRef<View>(null), current = useCardFocus();
  const on = !!current && current.kind === props.kind && current.id === props.id, at = on ? current!.at : 0;
  useEffect(() => {
    if (!on) return;
    // (Web: the element scrolls itself into view. Native: the Team view opens on the card's section; it is outlined there.)
    const show = setTimeout(() => (ref.current as unknown as { scrollIntoView?(options: object): void } | null)?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 80);
    const done = setTimeout(() => cardFocus.clear(at), SHOWN_MS);
    return () => { clearTimeout(show); clearTimeout(done); };
  }, [on, at]);
  return (
    <View ref={ref} testID={`focusable-${props.id}`} {...({ dataSet: { focused: on ? "1" : "0" } } as object)}
      style={on ? ({ borderRadius: radius.md, outlineWidth: 2, outlineStyle: "solid", outlineColor: theme.color("accent"), outlineOffset: 2 } as object) : undefined}>
      {props.children}
    </View>
  );
}
