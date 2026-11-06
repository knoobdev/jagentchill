import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { place, type Rect } from "./logic/position.ts";
import { tooltipController } from "./logic/tooltip.ts";
import { hasDom, onGlobalKey, onViewportScroll } from "./platform/dom";
import { Kbd } from "./kbd.tsx";
import { Text } from "./text.tsx";
import { Portal, useShortcut, useTheme } from "./theme.tsx";
import { radius, size, space } from "./tokens.ts";

export type TooltipContent = { label: string; keys?: readonly string[] | null; shortcut?: string };

/** The inverse pill of a tooltip: `strong` fill with `text/on-strong` in both themes. */
export function TooltipBubble(props: { label: string; keys?: readonly string[] | null; onLayout?(event: LayoutChangeEvent): void }) {
  const theme = useTheme();
  return (
    <View onLayout={props.onLayout} role="tooltip"
      style={[{ flexDirection: "row", alignItems: "center", gap: space[1.5], backgroundColor: theme.color("strong"), borderRadius: radius.sm, paddingVertical: space[1], paddingHorizontal: space[2], maxWidth: size.tooltipMax }, theme.elevation(2), { borderWidth: 0 }]}>
      <Text variant="meta" color="text/on-strong" style={{ flexShrink: 1 }}>{props.label}</Text>
      {props.keys?.length ? <Kbd keys={[...props.keys]} inverse /> : null}
    </View>
  );
}

/**
 * Tooltip behaviour for a trigger. Hover shows it after 500 ms and keyboard focus at once; it stays while the pointer is
 * over the trigger or the tooltip itself and closes on Escape, scroll or press. At compact-touch density it is replaced by
 * the long-press label, shown for 1.5 s without firing the trigger's action.
 */
export function useTooltip(content: TooltipContent | undefined, anchor: RefObject<View | null>) {
  const theme = useTheme();
  const bound = useShortcut(content?.shortcut);
  const keys = content?.keys ?? bound;
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubble, setBubble] = useState<{ width: number; height: number } | null>(null);
  const controller = useMemo(() => tooltipController(setVisible), []);
  const longPressed = useRef(false);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (!visible) { setBubble(null); return; }
    anchor.current?.measureInWindow((x, y, width, height) => setRect({ x, y, width, height }));
    const offKey = onGlobalKey((key) => { if (key.key !== "Escape") return false; controller.dismiss(); return true; });
    const offScroll = onViewportScroll(() => controller.dismiss());
    return () => { offKey(); offScroll(); };
  }, [visible, anchor, controller]);
  if (!content) return { handlers: {}, node: null as ReactNode, consumePress: () => false };
  const at = rect && bubble ? place({ anchor: rect, size: bubble, viewport: theme, side: "top", align: "center", offset: size.tooltipGap, rtl: theme.rtl }) : null;
  const node = visible && rect ? (
    <Portal layer="tooltip">
      <Pressable onHoverIn={controller.tipEnter} onHoverOut={controller.tipLeave} accessible={false} focusable={false}
        style={{ position: "absolute", left: at?.x ?? 0, top: at?.y ?? 0, opacity: at ? 1 : 0, transitionProperty: "opacity", transitionDuration: `${theme.duration("fast")}ms`, ...(hasDom ? { width: "max-content", maxWidth: size.tooltipMax } : null) } as object}>
        <TooltipBubble label={content.label} keys={keys} onLayout={(event) => setBubble({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })} />
      </Pressable>
    </Portal>
  ) : null;
  return {
    node,
    handlers: theme.touch
      ? { onLongPress: () => { longPressed.current = true; controller.longPress(theme.minToastMs); } }
      : { onHoverIn: controller.pointerEnter, onHoverOut: controller.pointerLeave, onFocusVisible: controller.focus, onBlur: controller.blur, onPressIn: controller.dismiss },
    /** True once after a long-press showed the label, so the press that ends it does not fire the action. */
    consumePress: () => { const was = longPressed.current; longPressed.current = false; return was; },
  };
}

/** Wraps any element with a tooltip. Tooltip content is never the only place essential information lives. */
export function Tooltip(props: TooltipContent & { children: ReactNode }) {
  const anchor = useRef<View>(null);
  const tip = useTooltip(props, anchor);
  const handlers = tip.handlers as { onHoverIn?(): void; onHoverOut?(): void; onFocusVisible?(): void; onBlur?(): void; onLongPress?(): void };
  return (
    <Pressable ref={anchor} accessible={false} focusable={false} onHoverIn={handlers.onHoverIn} onHoverOut={handlers.onHoverOut} onLongPress={handlers.onLongPress}
      onFocus={handlers.onFocusVisible} onBlur={handlers.onBlur} style={{ alignSelf: "flex-start" }}>
      {props.children}
      {tip.node}
    </Pressable>
  );
}
