import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Easing, PanResponder, ScrollView, View, type LayoutRectangle } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Badge } from "./avatar.tsx";
import { IconButton } from "./button.tsx";
import { holdDragCursor } from "./draghandle.ts";
import { moveIndex } from "./logic/lists.ts";
import { focusElement } from "./platform/dom";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, controlHeight, densityDefaults, easing, motion, radius, size, space } from "./tokens.ts";

/** `iconOnly` draws the icon alone; the label stays the accessible name and the tooltip. */
type Option<T extends string> = { value: T; label: string; count?: number; icon?: IconName; disabled?: boolean; iconOnly?: boolean };

type Boxes = Record<string, LayoutRectangle>;
type BoxStore = { get(): Boxes; set(next: Boxes): void; subscribe(listener: () => void): () => void };
function createBoxStore(): BoxStore {
  let boxes: Boxes = {};
  const listeners = new Set<() => void>();
  return { get: () => boxes, set: (next) => { boxes = next; for (const listener of listeners) listener(); }, subscribe: (listener) => { listeners.add(listener); return () => void listeners.delete(listener); } };
}
/** The sliding fill under the chosen segment. It alone follows the measured boxes of the segments. */
function SegmentIndicator(props: { boxes: BoxStore; value: string }) {
  const theme = useTheme();
  const selected = useSyncExternalStore(props.boxes.subscribe, props.boxes.get, props.boxes.get)[props.value];
  const x = useRef(new Animated.Value(0)).current, width = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!selected) return;
    const duration = placed.current && !theme.reduceMotion ? motion.base : 0;
    placed.current = true;
    Animated.parallel([
      Animated.timing(x, { toValue: selected.x, duration, easing: Easing.bezier(...easing.enter), useNativeDriver: false }),
      Animated.timing(width, { toValue: selected.width, duration, easing: Easing.bezier(...easing.enter), useNativeDriver: false }),
    ]).start();
  }, [selected?.x, selected?.width, x, width, theme.reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  return selected ? <Animated.View pointerEvents="none" style={[{ position: "absolute", top: space[0.5], bottom: space[0.5], left: x, width, borderRadius: radius.xs, backgroundColor: theme.color("bg/elevated") }, theme.elevation(1), { borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline") }]} /> : null;
}
/**
 * 2–5 mutually exclusive options in a `bg/subtle` track. The selected segment is `bg/elevated` with `elevation/1` and a 1 px
 * `border/control` outline, so selection does not rest on the fill difference alone; the indicator slides in 160 ms.
 */
export function Segmented<T extends string>(props: { options: Array<Option<T>>; value: T; onChange(value: T): void; size?: "xs" | "sm" | "md"; label?: string; block?: boolean; disabled?: boolean; forceState?: Record<string, ForcedState> }) {
  const theme = useTheme();
  const height = controlHeight(props.size ?? "md", theme.density);
  const refs = useRef(new Map<string, View | null>());
  // The segments report their boxes one by one when the control appears. They are taken together, and they go to the
  // indicator alone (`SegmentIndicator`): each report used to draw the whole control and its segments again.
  const boxes = useRef(createBoxStore()).current;
  const reported = useRef<Record<string, { measured: LayoutRectangle | null; box: LayoutRectangle }> | null>(null);
  const place = (value: string, measured: LayoutRectangle | null, box: LayoutRectangle) => {
    if (!reported.current) {
      reported.current = {};
      queueMicrotask(() => {
        const got = reported.current ?? {}, all = boxes.get(), next = { ...all };
        reported.current = null;
        let moved = false;
        for (const [key, entry] of Object.entries(got)) {
          const now = entry.measured ?? all[key] ?? entry.box, was = all[key];
          if (!was || was.x !== now.x || was.y !== now.y || was.width !== now.width || was.height !== now.height) { next[key] = now; moved = true; }
        }
        if (moved) boxes.set(next);
      });
    }
    reported.current[value] = { measured, box };
  };
  return (
    <View accessibilityRole="radiogroup" role="radiogroup" aria-label={props.label} accessibilityLabel={props.label}
      style={{ flexDirection: "row", backgroundColor: theme.color("bg/subtle"), borderRadius: radius.sm, padding: space[0.5], height, flexShrink: 0, alignSelf: props.block ? "stretch" : "flex-start" }}>
      <SegmentIndicator boxes={boxes} value={props.value} />
      {props.options.map((option, index) => {
        const on = option.value === props.value;
        return (
          <Tap key={option.value} ref={(node) => { refs.current.set(option.value, node); }} role="radio" label={option.count === undefined ? option.label : `${option.label} ${option.count}`} checked={on} forceState={props.forceState?.[option.value]} aria={{ "aria-checked": on }} disabled={props.disabled || option.disabled}
            tabIndex={on ? 0 : -1} onPress={() => props.onChange(option.value)}
            onKeyDown={(key) => {
              const next = moveIndex(index, key.key, props.options.length, { wrap: true, horizontal: true, rtl: theme.rtl, skip: (i) => Boolean(props.options[i]!.disabled) });
              if (next === null) return;
              key.preventDefault();
              props.onChange(props.options[next]!.value);
              focusElement(refs.current.get(props.options[next]!.value));
            }}
            style={(state) => ({ paddingHorizontal: space[2] + space[0.5], borderRadius: radius.xs, flexDirection: "row", gap: space[1.5], alignItems: "center", justifyContent: "center", flexGrow: props.block ? 1 : 0, backgroundColor: !on && (state.hovered || state.pressed) ? theme.color("bg/hover") : "transparent" })}>
            <View onLayout={(event) => { const node = refs.current.get(option.value) as unknown as { offsetLeft?: number; offsetWidth?: number } | null; const box = event.nativeEvent.layout;
              // The indicator needs the segment's box inside the track: on web the label's layout event is relative to the segment.
              place(option.value, node?.offsetWidth ? { ...box, x: node.offsetLeft ?? 0, width: node.offsetWidth } : null, box); }}
              style={{ flexDirection: "row", gap: space[1.5], alignItems: "center" }}>
              {option.icon ? <Icon name={option.icon} size={14} color={on ? "text/primary" : "text/secondary"} /> : null}
              {option.iconOnly && option.icon ? null : <Text variant={on ? "body-medium" : "body"} color={on ? "text/primary" : "text/secondary"} numberOfLines={1}>{option.label}</Text>}
              {option.count === undefined ? null : <Text variant="caption" color="text/tertiary" tabular>{option.count}</Text>}
            </View>
          </Tap>
        );
      })}
    </View>
  );
}
export const SegmentedControl = Segmented;

export type TabItem = { id: string; label: string; icon?: IconName; count?: number; disabled?: boolean };
export const tabId = (group: string, id: string) => `${group}-tab-${id}`;
export const panelId = (group: string, id: string) => `${group}-panel-${id}`;

/**
 * Tabs in two variants. `underline`: a 36 px strip (44 at compact-touch density) with a 2 px `text/primary` underline on the
 * selected tab. `pill`: 28 px pills, the selected one a soft `bg/subtle` fill with no outline.
 * Left/Right move between tabs, Home/End jump; with manual activation Enter or Space selects.
 */
export function Tabs(props: { id: string; items: TabItem[]; value: string; onChange(id: string): void; variant?: "underline" | "pill"; manual?: boolean; label?: string; size?: "xs" | "sm"; forceState?: Record<string, ForcedState> }) {
  const theme = useTheme();
  const pill = props.variant === "pill";
  const refs = useRef(new Map<string, View | null>());
  const strip = densityDefaults[theme.density].tabStrip;
  const [focused, setFocused] = useState(props.value);
  // A screen that draws its content without a `TabPanel` has no element for the selected tab to control.
  const [hasPanel, setHasPanel] = useState(true);
  useEffect(() => { const dom = (globalThis as { document?: { getElementById(id: string): unknown } }).document; if (dom) setHasPanel(Boolean(dom.getElementById(panelId(props.id, props.value)))); }, [props.id, props.value]);
  const row = (
    <View accessibilityRole="tablist" role="tablist" aria-label={props.label} accessibilityLabel={props.label}
      style={pill ? { flexDirection: "row", gap: space[1], alignItems: "center", minHeight: theme.touch ? strip : undefined }
        : { flexDirection: "row", gap: size.tabGap, height: strip, paddingHorizontal: space[3], borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
      {props.items.map((item, index) => {
        const on = item.id === props.value;
        return (
          <Tap key={item.id} ref={(node) => { refs.current.set(item.id, node); }} role="tab" label={item.label} selected={on} disabled={item.disabled} forceState={props.forceState?.[item.id]}
            nativeID={tabId(props.id, item.id)} aria={{ "aria-selected": on, "aria-controls": on && !hasPanel ? undefined : panelId(props.id, item.id) }} tabIndex={(props.manual ? item.id === focused : on) ? 0 : -1}
            onPress={() => props.onChange(item.id)} onFocus={() => setFocused(item.id)}
            onKeyDown={(key) => {
              const next = moveIndex(index, key.key, props.items.length, { wrap: true, horizontal: true, rtl: theme.rtl, skip: (i) => Boolean(props.items[i]!.disabled) });
              if (next === null) return;
              key.preventDefault();
              const target = props.items[next]!;
              focusElement(refs.current.get(target.id));
              setFocused(target.id);
              // Automatic activation: focus and selection move together.
              if (!props.manual) props.onChange(target.id);
            }}
            style={(state) => pill
              ? { height: props.size === "xs" ? controlHeight("xs", "regular") : controlHeight("sm", "regular"), paddingHorizontal: space[2] + space[0.5], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[1.5],
                backgroundColor: on ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent", borderWidth: borderWidth.hairline, borderColor: "transparent" }
              : { flexDirection: "row", alignItems: "center", gap: space[1.5], borderBottomWidth: borderWidth.focus, borderBottomColor: on ? theme.color("text/primary") : "transparent", marginBottom: -borderWidth.hairline }}>
            {item.icon ? <Icon name={item.icon} size={14} color={on ? "text/primary" : "text/secondary"} /> : null}
            <Text color={on ? "text/primary" : "text/secondary"} numberOfLines={1} style={on ? { fontWeight: "500" } : undefined}>{item.label}</Text>
            {item.count !== undefined ? <Badge count={item.count} /> : null}
          </Tap>
        );
      })}
    </View>
  );
  // On compact form factors every tab strip scrolls horizontally and never wraps.
  return theme.compact ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>{row}</ScrollView> : row;
}

export function TabPanel(props: { group: string; id: string; active: boolean; children: ReactNode }) {
  if (!props.active) return null;
  return <View role="tabpanel" nativeID={panelId(props.group, props.id)} aria-labelledby={tabId(props.group, props.id)} style={{ flexGrow: 1, flexShrink: 1 }}>{props.children}</View>;
}

const edgeFade = (angle: string, colour: string): object => { const value = `linear-gradient(${angle}, transparent, ${colour})`; return { experimental_backgroundImage: value, backgroundImage: value }; };

export type StripTab = { id: string; label: string; icon?: IconName; closable?: boolean };
/**
 * The workspace tab strip: closable tabs (× on hover, on focus or when selected, and always at compact-touch density), a "+"
 * button, drag reordering on desktop and web, middle-click close, and overflow scrolling with a 24 px edge fade that keeps
 * the selected tab in view.
 */
export function TabStrip(props: { id: string; tabs: StripTab[]; value: string; onChange(id: string): void; onClose?(id: string): void; onNew?(): void; onReorder?(from: number, to: number): void; trailing?: ReactNode; label?: string; forceState?: Record<string, ForcedState> }) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const boxes = useRef(new Map<string, LayoutRectangle>());
  const refs = useRef(new Map<string, View | null>());
  const [fade, setFade] = useState({ start: false, end: false });
  const [dragging, setDragging] = useState<string | null>(null);
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  const updateFade = () => { const { offset, viewport, content } = metrics.current; setFade({ start: offset > 1, end: offset + viewport < content - 1 }); };
  useEffect(() => {
    const box = boxes.current.get(props.value);
    const { offset, viewport } = metrics.current;
    if (!box || viewport === 0) return;
    if (box.x < offset) scroll.current?.scrollTo({ x: box.x - size.tabFade, animated: !theme.reduceMotion });
    else if (box.x + box.width > offset + viewport) scroll.current?.scrollTo({ x: box.x + box.width - viewport + size.tabFade, animated: !theme.reduceMotion });
  }, [props.value, props.tabs.length, theme.reduceMotion]);
  const latest = useRef(props);
  latest.current = props;
  const responders = useMemo(() => new Map<string, ReturnType<typeof PanResponder.create>>(), []);
  const carried = useRef<() => void>(() => {});
  const responderFor = (id: string) => {
    let responder = responders.get(id);
    if (!responder) {
      responder = PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => Boolean(latest.current.onReorder) && Math.abs(gesture.dx) > 6,
        // A tab is pressed like a button; once it is carried the hand closes on it, wherever the pointer goes.
        onPanResponderGrant: () => { setDragging(id); carried.current = holdDragCursor("grabbing"); },
        onPanResponderRelease: (_event, gesture) => {
          setDragging(null); carried.current();
          const order = latest.current.tabs.map((tab) => tab.id);
          const from = order.indexOf(id), box = boxes.current.get(id);
          if (!box) return;
          const centre = box.x + box.width / 2 + gesture.dx;
          const to = order.findIndex((other) => { const b = boxes.current.get(other); return b ? centre < b.x + b.width : false; });
          const target = to < 0 ? order.length - 1 : to;
          if (target !== from) latest.current.onReorder?.(from, target);
        },
        onPanResponderTerminate: () => { setDragging(null); carried.current(); },
      });
      responders.set(id, responder);
    }
    return responder;
  };
  const edge = (side: "start" | "end") => (
    <View pointerEvents="none" testID={`tab-fade-${side}`} style={[{ position: "absolute", top: 0, bottom: 0, width: size.tabFade, [side]: 0 },
      edgeFade((side === "end") !== theme.rtl ? "90deg" : "270deg", theme.color("bg/app"))]} />
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: densityDefaults[theme.density].tabStrip, borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline"), paddingHorizontal: space[1], gap: space[1] }}>
      <View style={{ flexShrink: 1, flexGrow: 1, minWidth: 0 }}>
        <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
          onLayout={(event) => { metrics.current.viewport = event.nativeEvent.layout.width; updateFade(); }}
          onContentSizeChange={(width) => { metrics.current.content = width; updateFade(); }}
          onScroll={(event) => { metrics.current.offset = event.nativeEvent.contentOffset.x; updateFade(); }}>
          <View accessibilityRole="tablist" role="tablist" aria-label={props.label} accessibilityLabel={props.label} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            {props.tabs.map((tab, index) => {
              const on = tab.id === props.value;
              return (
                <View key={tab.id} {...(theme.touch ? null : responderFor(tab.id).panHandlers)} onLayout={(event) => { boxes.current.set(tab.id, event.nativeEvent.layout); }} style={{ opacity: dragging === tab.id ? 0.6 : 1 }}>
                  <Tap ref={(node) => { refs.current.set(tab.id, node); }} role="tab" label={tab.label} selected={on} forceState={props.forceState?.[tab.id]} aria={{ "aria-selected": on, "aria-controls": panelId(props.id, tab.id) }} nativeID={tabId(props.id, tab.id)} tabIndex={on ? 0 : -1}
                    onPress={() => props.onChange(tab.id)} onAuxPress={tab.closable && props.onClose ? () => props.onClose!(tab.id) : undefined}
                    onKeyDown={(key) => {
                      const next = moveIndex(index, key.key, props.tabs.length, { wrap: true, horizontal: true, rtl: theme.rtl });
                      if (next === null) return;
                      key.preventDefault();
                      props.onChange(props.tabs[next]!.id);
                      focusElement(refs.current.get(props.tabs[next]!.id));
                    }}
                    style={(state) => ({ height: densityDefaults[theme.density].row, paddingHorizontal: space[2] + space[0.5], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[1.5],
                      backgroundColor: on ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
                    {(state) => (
                      <>
                        {tab.icon ? <Icon name={tab.icon} size={14} color={on ? "text/primary" : "text/secondary"} /> : null}
                        <Text color={on ? "text/primary" : "text/secondary"} numberOfLines={1} style={on ? { fontWeight: "500" } : undefined}>{tab.label}</Text>
                        {tab.closable && props.onClose ? (
                          <View style={{ opacity: on || state.hovered || state.focused || theme.touch ? 1 : 0 }}>
                            <Tap role="button" label={theme.t("closeTab", { name: tab.label })} onPress={() => props.onClose!(tab.id)} target style={{ borderRadius: radius.xs }}><Icon name="x" size={12} color="text/secondary" /></Tap>
                          </View>
                        ) : null}
                      </>
                    )}
                  </Tap>
                </View>
              );
            })}
          </View>
        </ScrollView>
        {fade.start ? edge("start") : null}
        {fade.end ? edge("end") : null}
      </View>
      {props.onNew ? <IconButton icon="plus" size="xs" label={theme.t("newTab")} onPress={props.onNew} /> : null}
      {props.trailing}
    </View>
  );
}
