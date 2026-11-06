import { useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, type AccessibilityRole, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./Icon.tsx";
import { isKeyboardModality } from "./platform/dom";
import type { KeyInfo } from "./platform/types.ts";
import { useHostGate, useTheme, type Theme } from "./theme.tsx";
import { useTooltip, type TooltipContent } from "./tooltip.tsx";
import { control, opacity, size } from "./tokens.ts";

export type Interaction = { hovered: boolean; pressed: boolean; focused: boolean };
/** A state drawn regardless of input, for the component catalogue. */
export type ForcedState = "hover" | "pressed" | "focus";
export type KeyEvent = { nativeEvent: { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean }; preventDefault(): void; stopPropagation(): void };
export const keyOf = (event: KeyEvent): KeyInfo => ({
  key: event.nativeEvent.key, shift: Boolean(event.nativeEvent.shiftKey), alt: Boolean(event.nativeEvent.altKey), ctrl: Boolean(event.nativeEvent.ctrlKey),
  meta: Boolean(event.nativeEvent.metaKey), repeat: Boolean(event.nativeEvent.repeat), preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation(),
});

/** The focus-visible ring: 2 px `accent`, 2 px outside the edge. Drawn for keyboard focus only. */
export const focusRing = (theme: Theme, on: boolean): ViewStyle =>
  (on ? { outlineWidth: size.focusRing, outlineColor: theme.color("accent"), outlineOffset: size.focusOffset, outlineStyle: "solid" } : { outlineWidth: 0 });

export type TapProps = {
  onPress?(): void; onLongPress?(): void; onContextMenu?(at: { x: number; y: number }): void;
  disabled?: boolean;
  /** Needs a connected host: without one the control stays enabled, shows the link badge and opens the requires-host sheet. */
  requiresHost?: boolean;
  label?: string; role?: AccessibilityRole | "option" | "treeitem" | "row" | "gridcell" | "menuitemcheckbox" | "menuitemradio" | "separator" | "searchbox" | "listbox";
  selected?: boolean; checked?: boolean | "mixed"; expanded?: boolean; pressedState?: boolean; current?: "page" | boolean; busy?: boolean;
  aria?: Record<string, unknown>;
  style?: StyleProp<ViewStyle> | ((state: Interaction) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: Interaction) => ReactNode);
  /** Extends the pressable area to at least 44×44 px at compact-touch density while the visible part keeps its size. */
  target?: boolean; outerStyle?: StyleProp<ViewStyle>;
  forceState?: ForcedState; tooltip?: TooltipContent; focusable?: boolean; tabIndex?: 0 | -1; noRing?: boolean; hideBadge?: boolean;
  onKeyDown?(key: KeyInfo): void; onFocus?(): void; onBlur?(): void; onHoverIn?(): void; onHoverOut?(): void; onDoublePress?(): void; onAuxPress?(): void;
  ref?: Ref<View>; testID?: string; nativeID?: string;
};

/** The one pressable every control is built on: hover, pressed and focus-visible states, disabled, host gating and tooltip. */
export function Tap(props: TapProps) {
  const theme = useTheme();
  const gate = useHostGate();
  const inner = useRef<View>(null);
  const [focusVisible, setFocusVisible] = useState(false);
  const lastPress = useRef(0);
  const tip = useTooltip(props.tooltip, inner);
  const tipHandlers = tip.handlers as { onHoverIn?(): void; onHoverOut?(): void; onFocusVisible?(): void; onBlur?(): void; onPressIn?(): void; onLongPress?(): void };
  const gated = Boolean(props.requiresHost) && !gate.connected;
  const disabled = Boolean(props.disabled);
  const label = props.label === undefined ? undefined : gated ? `${props.label}, ${theme.t("requiresHostSuffix")}` : props.label;

  const press = () => {
    if (tip.consumePress()) return;
    if (gated) { gate.onRequiresHost(props.label); return; }
    const now = Date.now();
    if (props.onDoublePress && now - lastPress.current < 350) { lastPress.current = 0; props.onDoublePress(); return; }
    lastPress.current = now;
    props.onPress?.();
  };
  const state = (raw: { pressed: boolean; hovered?: boolean }): Interaction => ({
    hovered: props.forceState === "hover" || (!theme.touch && Boolean(raw.hovered)),
    pressed: props.forceState === "pressed" || raw.pressed,
    focused: props.forceState === "focus" || focusVisible,
  });
  // `aria-selected` belongs to tabs, options, rows and cells only: a selected button says so with `aria-pressed`
  // (or with `aria-current`, when its owner gives one).
  // A named pressable with no role of its own is a button: a name on a role-less element is not announced (and ARIA forbids it).
  const role = props.role ?? (label !== undefined && props.aria?.role === undefined && (props.onPress || props.onDoublePress) ? "button" : undefined);
  const selectable = isSelectableRole(role);
  const web = {
    onKeyDown: props.onKeyDown ? (event: KeyEvent) => props.onKeyDown!(keyOf(event)) : undefined,
    onContextMenu: props.onContextMenu ? (event: { nativeEvent: { pageX: number; pageY: number }; preventDefault(): void }) => { event.preventDefault(); props.onContextMenu!({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }); } : undefined,
    onAuxClick: props.onAuxPress ? (event: { nativeEvent: { button?: number }; preventDefault(): void }) => { if (event.nativeEvent.button === 1) { event.preventDefault(); props.onAuxPress!(); } } : undefined,
    // react-native-web's Pressable is a tab stop unless it is given a tabIndex: `focusable={false}` alone left wrappers
    // (a context-menu area, an option of a list box) as nameless stops in the Tab order.
    tabIndex: disabled || props.focusable === false ? -1 : props.tabIndex,
    "aria-current": props.current || undefined, "aria-pressed": props.pressedState ?? (selectable || role !== "button" || props.current !== undefined ? undefined : props.selected), "aria-disabled": disabled || undefined, "aria-expanded": props.expanded, "aria-selected": selectable ? props.selected : undefined, "aria-checked": CHECKABLE.has(role ?? "") ? props.checked ?? false : undefined, "aria-busy": props.busy || undefined, ...props.aria,
  };
  return (
    <Pressable
      ref={(node) => { inner.current = node; if (typeof props.ref === "function") props.ref(node); else if (props.ref) (props.ref as { current: View | null }).current = node; }}
      testID={props.testID} nativeID={props.nativeID} accessibilityRole={role as AccessibilityRole} role={role as never} accessibilityLabel={label} aria-label={label}
      accessibilityState={{ disabled, selected: selectable || Platform.OS !== "web" ? props.selected : undefined, checked: props.checked, expanded: props.expanded, busy: props.busy }}
      disabled={disabled} focusable={props.focusable ?? !disabled}
      onPress={press}
      onLongPress={tipHandlers.onLongPress ?? props.onLongPress ?? (props.onContextMenu ? () => inner.current?.measureInWindow((x, y, _w, height) => props.onContextMenu!({ x, y: y + height })) : undefined)}
      delayLongPress={500}
      onPressIn={tipHandlers.onPressIn}
      onHoverIn={() => { tipHandlers.onHoverIn?.(); props.onHoverIn?.(); }} onHoverOut={() => { tipHandlers.onHoverOut?.(); props.onHoverOut?.(); }}
      onFocus={() => { if (isKeyboardModality()) { setFocusVisible(true); tipHandlers.onFocusVisible?.(); } props.onFocus?.(); }}
      onBlur={() => { setFocusVisible(false); tipHandlers.onBlur?.(); props.onBlur?.(); }}
      {...(web as object)}
      style={(raw) => {
        const now = state(raw);
        const own = typeof props.style === "function" ? props.style(now) : props.style;
        const ring = props.noRing ? null : focusRing(theme, now.focused);
        return props.target
          ? [theme.touch ? HIT : null, CENTER, props.outerStyle, { outlineWidth: 0 }]
          : [own, disabled ? DISABLED : null, ring];
      }}>
      {(raw) => {
        const now = state(raw);
        const content = typeof props.children === "function" ? props.children(now) : props.children;
        const badge = gated && !props.hideBadge ? <Icon name="link" size={size.linkBadge} color="text/secondary" /> : null;
        if (!props.target) return <>{content}{badge}{tip.node}</>;
        const own = typeof props.style === "function" ? props.style(now) : props.style;
        return <><View style={[own, disabled ? DISABLED : null, props.noRing ? null : focusRing(theme, now.focused)]}>{content}{badge}</View>{tip.node}</>;
      }}
    </Pressable>
  );
}
// The roles that must say whether they are checked.
const CHECKABLE = new Set(["radio", "checkbox", "switch", "menuitemcheckbox", "menuitemradio"]);
/** The roles ARIA lets carry `aria-selected`; on any other role (a button, a link, a menu item) the attribute is invalid. */
const SELECTABLE = new Set(["tab", "option", "row", "gridcell", "treeitem", "columnheader", "rowheader"]);
export const isSelectableRole = (role: string | undefined) => SELECTABLE.has(role ?? "");
const HIT: ViewStyle ={ minWidth: control.touch, minHeight: control.touch };
const CENTER: ViewStyle = { alignItems: "center", justifyContent: "center", flexShrink: 0 };
const DISABLED: ViewStyle = { opacity: opacity.disabled };
