import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, View } from "react-native";
import { panelLayout, type PanelSpec } from "./logic/surfaces.ts";
import { dragHandle } from "./draghandle.ts";
import { beginPanelMotion, gateWhilePanelsMove } from "./panelmotion.ts";
import { cssGlide, cssMotion } from "./platform/dom";
import { Tap } from "./tap.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, easing, motion, size } from "./tokens.ts";

const ENTER = Easing.bezier(...easing.enter), EXIT = Easing.bezier(...easing.exit);

export type Panel = PanelSpec & { content: ReactNode; minPx?: number; maxPx?: number };
export type PanelGroupProps = {
  panels: Panel[]; direction?: "horizontal" | "vertical"; label: string;
  /** Sizes in percent, reported on release so the caller can persist them. */
  onLayout?(sizes: number[]): void; sizes?: number[];
  /** Ids of the collapsed panels, when the caller's toggle controls own that state. */
  collapsed?: string[]; onCollapsedChange?(collapsed: string[]): void; forceActive?: number;
};

/**
 * Panels laid out horizontally or vertically with draggable splitters: a 1 px hairline with an 8 px hit area (16 px on touch)
 * that shows 2 px `accent` on hover, drag and keyboard focus. Each panel keeps within its minimum and maximum.
 * Collapsing or restoring a panel slides it to or from the edge it lies at in `motion/slow` (at once under reduced
 * motion): its content keeps its size and is clipped while it moves. `data-settled` on the group is false meanwhile.
 * In a browser that slide is one CSS transition of the panels' shares, with the "panels are moving" signal on
 * (`panelmotion.ts`); a splitter drag never has a transition, the panels follow the pointer 1:1.
 */
export function PanelGroup(props: PanelGroupProps) {
  const theme = useTheme();
  const horizontal = props.direction !== "vertical";
  const css = cssMotion();
  const [extent, setExtent] = useState(0);
  // The group's own size is one of the things that change while a panel around it slides: it is taken once, at the end.
  const extentGate = useMemo(() => gateWhilePanelsMove<number>(setExtent), []);
  useEffect(() => extentGate.dispose, [extentGate]);
  const outer = useRef<unknown[]>([]);
  const extentRef = useRef(0);
  extentRef.current = extent;
  // Limits given in pixels become percentages of the measured group.
  // The panels are told by what they say, not by the array they come in: a caller that writes `panels={[…]}` hands over
  // a new array on every one of its renders, and the layout (with the sizes a person dragged) must not be rebuilt — nor
  // a state set from an effect — each time the caller renders (during playback that was on every frame).
  const panelsKey = props.panels.map((panel) => [panel.id, panel.default, panel.collapsible ?? "", panel.min ?? "", panel.max ?? "", panel.minPx ?? "", panel.maxPx ?? ""].join(":")).join("|");
  const specs = useMemo(() => props.panels.map((panel) => ({
    id: panel.id, default: panel.default, collapsible: panel.collapsible,
    min: panel.minPx !== undefined && extent > 0 ? (panel.minPx / extent) * 100 : panel.min, max: panel.maxPx !== undefined && extent > 0 ? (panel.maxPx / extent) * 100 : panel.max,
  })), [panelsKey, extent]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(() => panelLayout(specs, () => extentRef.current, props.sizes), [specs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sizes, setSizes] = useState(model.sizes());
  const shown = useRef(sizes);
  shown.current = sizes;
  const [active, setActive] = useState<number | null>(null);
  const report = useRef(props.onLayout);
  report.current = props.onLayout;
  const sync = (commit: boolean) => { const next = [...model.sizes()]; setSizes(next); if (commit) report.current?.(next); };
  /** Brings the model in line with the caller's `collapsed` list. */
  const applyCollapsed = () => {
    if (!props.collapsed) return;
    props.panels.forEach((panel, index) => {
      if (props.collapsed!.includes(panel.id) !== model.collapsed(index)) model.toggleCollapse(index, index === props.panels.length - 1 ? index - 1 : index + 1);
    });
  };
  // A rebuilt model starts with every panel open: the collapsed ones are collapsed again before its sizes are shown.
  useEffect(() => { applyCollapsed(); const next = [...model.sizes()]; if (next.length !== shown.current.length || next.some((size, index) => size !== shown.current[index])) setSizes(next); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  // A collapse or a restore under way: the sizes it started from and the ones it ends at, mixed by `glide`.
  const [move, setMove] = useState<{ from: number[]; to: number[] } | null>(null);
  const glide = useRef(new Animated.Value(1)).current;
  const laidOut = useRef(false);
  const slide = (from: number[]) => {
    const to = [...model.sizes()];
    if (theme.reduceMotion || !laidOut.current || extentRef.current === 0 || from.every((value, index) => value === to[index])) { glide.stopAnimation(); setMove(null); return; }
    glide.stopAnimation(); glide.setValue(0); setMove({ from, to });
    // In a browser the move is handed to a CSS transition once this state is in the tree (the layout effect below).
    if (css) return;
    const closing = to.some((value, index) => value === 0 && from[index]! > 0);
    Animated.timing(glide, { toValue: 1, duration: motion.slow, easing: closing ? EXIT : ENTER, useNativeDriver: false }).start(({ finished }) => { if (finished) setMove(null); });
  };
  useLayoutEffect(() => {
    if (!move || !css) return;
    const end = beginPanelMotion();
    const closing = move.to.some((value, index) => value === 0 && move.from[index]! > 0);
    const cancel = cssGlide(move.from.map((value, index) => ({ node: outer.current[index], property: "flexGrow" as const, from: String(value), to: String(move.to[index]) })),
      closing ? motion.exit : motion.slow, closing ? motion.easeExit : motion.easeEnter, () => { end(); setMove(null); });
    return () => { cancel(); end(); };
  }, [move]); // eslint-disable-line react-hooks/exhaustive-deps
  // The caller's toggle controls collapse and restore panels through `collapsed`.
  useEffect(() => {
    if (!props.collapsed) return;
    // What is on screen, not what the model holds: the model may have been rebuilt for this render, already restored.
    const from = [...shown.current];
    applyCollapsed();
    sync(false);
    // The state a screen opens with is not a change: nothing moves on the first layout.
    slide(from); laidOut.current = true;
  }, [props.collapsed?.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (index: number) => {
    const target = specs[index]!.collapsible ? index : specs[index + 1]!.collapsible ? index + 1 : -1;
    if (target < 0) return;
    const from = [...shown.current];
    model.toggleCollapse(target, target === index ? index + 1 : index);
    sync(true);
    slide(from);
    props.onCollapsedChange?.(props.panels.filter((_, at) => model.collapsed(at)).map((panel) => panel.id));
  };
  const releases = useRef<number[]>([]);
  const responders = useMemo(() => props.panels.slice(0, -1).map((_, index) => {
    let last = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // The grip holds a pressable (focus, keys): the drag takes the gesture first, in the capture phase, or the pressable would keep it.
      onStartShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { last = 0; setActive(index); },
      onPanResponderMove: (_event, gesture) => {
        const raw = horizontal ? gesture.dx * (theme.rtl ? -1 : 1) : gesture.dy;
        model.move(index, model.pxToPercent(raw - last));
        last = raw;
        sync(false);
      },
      onPanResponderRelease: (_event, gesture) => {
        setActive(null);
        // A press without a drag, twice within 350 ms, restores the default size.
        const still = Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3, now = Date.now();
        if (still && now - (releases.current[index] ?? 0) < 350) { releases.current[index] = 0; model.reset(index); } else if (still) releases.current[index] = now;
        sync(true);
      },
      onPanResponderTerminate: () => { setActive(null); sync(true); },
    });
  }), [props.panels.length, horizontal, theme.rtl, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const hit = theme.touch ? size.splitterHitTouch : size.splitterHit;
  return (
    <View onLayout={(event) => extentGate.report(horizontal ? event.nativeEvent.layout.width : event.nativeEvent.layout.height)} {...({ dataSet: { settled: String(!move) } } as object)} style={{ flex: 1, flexDirection: horizontal ? "row" : "column", minWidth: 0, minHeight: 0 }}>
      {props.panels.map((panel, index) => {
        // The panel that collapses or comes back keeps the size it has when open and is clipped, so it slides; the others follow.
        const from = move?.from[index] ?? 0, to = move?.to[index] ?? 0, sliding = move !== null && from !== to && (from === 0 || to === 0);
        const grow = move && !css ? glide.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) : sizes[index] ?? 0;
        return (
        <Animated.View key={panel.id} ref={(node: unknown) => { outer.current[index] = node; }} style={{ flexDirection: horizontal ? "row" : "column", flexGrow: grow, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, ...(index < props.panels.length - 1 ? { zIndex: 1 } : null) }}>
          <View testID={`panel-${panel.id}`} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", flexDirection: horizontal ? "row" : "column", justifyContent: index === 0 ? "flex-end" : "flex-start", display: (sizes[index] ?? 0) === 0 && !sliding ? "none" : "flex" }}>
            <View style={sliding ? { [horizontal ? "width" : "height"]: (Math.max(from, to) / 100) * extent, flexShrink: 0 } : { flex: 1, minWidth: 0, minHeight: 0 }}>{panel.content}</View>
          </View>
          {index < props.panels.length - 1 ? (
            <View style={{ [horizontal ? "width" : "height"]: borderWidth.hairline, zIndex: 1 }}>
              <View {...responders[index]!.panHandlers} {...dragHandle(horizontal ? "col-resize" : "row-resize")} style={{ position: "absolute", [horizontal ? "top" : "left"]: 0, [horizontal ? "bottom" : "right"]: 0, [horizontal ? "left" : "top"]: -hit / 2, [horizontal ? "width" : "height"]: hit, alignItems: "center", justifyContent: "center", flexDirection: horizontal ? "row" : "column" }}>
                <Tap label={props.label} noRing testID={`splitter-${index}`} forceState={props.forceActive === index ? "focus" : undefined}
                  aria={{ role: "separator", "aria-orientation": horizontal ? "vertical" : "horizontal", "aria-valuenow": Math.round(sizes[index] ?? 0), "aria-valuemin": Math.round(specs[index]!.min ?? 0), "aria-valuemax": Math.round(specs[index]!.max ?? 100), tabIndex: 0 }}
                  onDoublePress={() => { model.reset(index); sync(true); }} onPress={() => {}}
                  onKeyDown={(key) => {
                    if (key.key === "Enter") { key.preventDefault(); toggle(index); return; }
                    if (model.key(index, key.key, key.shift, theme.rtl && horizontal)) { key.preventDefault(); sync(true); }
                  }}
                  style={(state) => ({ alignSelf: "stretch", flexGrow: 1, [horizontal ? "width" : "height"]: hit, alignItems: "center", justifyContent: "center", flexDirection: horizontal ? "row" : "column" })}>
                  {(state) => {
                    const on = state.hovered || state.focused || active === index;
                    return <View style={{ [horizontal ? "width" : "height"]: on ? size.splitterActive : borderWidth.hairline, alignSelf: "stretch", flexGrow: horizontal ? 0 : undefined, backgroundColor: theme.color(on ? "accent" : "border/hairline") }} />;
                  }}
                </Tap>
              </View>
            </View>
          ) : null}
        </Animated.View>
        );
      })}
    </View>
  );
}
