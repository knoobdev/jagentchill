import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import { beginPanelMotion } from "./panelmotion.ts";
import { computedSize, computedStyleOf, cssGlide, cssMotion, setInlineStyle } from "./platform/dom";
import { useTheme } from "./theme.tsx";
import { easing, motion } from "./tokens.ts";

const ENTER = Easing.bezier(...easing.enter), EXIT = Easing.bezier(...easing.exit);
export type Edge = "start" | "end" | "top" | "bottom";

/**
 * The motion of a panel that opens from an edge (`design-system.Motion tokens`): `motion/slow` with the enter easing on
 * the way in and the exit easing on the way out. `progress` runs 0 → 1; `mounted` stays true through the way out, so the
 * content leaves the tree only once it is off screen; `settled` is false while it moves. Under reduced motion, and when
 * `instant` is set (the frame around the panel was swapped, nothing should move), the panel is simply there or gone.
 */
export function useEdgeMotion(open: boolean, options: { instant?: boolean; onSettled?(open: boolean): void } = {}) {
  const theme = useTheme();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);
  const [settled, setSettled] = useState(true);
  const first = useRef(true);
  // Where the panel last came to rest. Until the effect below has run for a change, the render already knows it is moving.
  const rest = useRef(open);
  const done = useRef(options.onSettled);
  done.current = options.onSettled;
  const still = theme.reduceMotion || Boolean(options.instant);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const finish = () => { rest.current = open; setMounted(open); setSettled(true); done.current?.(open); };
    if (open) setMounted(true);
    if (still) { progress.stopAnimation(); progress.setValue(open ? 1 : 0); finish(); return; }
    setSettled(false);
    const run = Animated.timing(progress, { toValue: open ? 1 : 0, duration: motion.slow, easing: open ? ENTER : EXIT, useNativeDriver: false });
    // Coming in, the content mounts first: its first render and layout would otherwise eat the first frames of the slide
    // (the time-based animation then jumps ahead). The slide starts once that work has been drawn.
    let frames = 0, wait = 0;
    const begin = () => { if (++frames < 2) { wait = requestAnimationFrame(begin); return; } run.start(({ finished }) => { if (finished) finish(); }); };
    if (open) wait = requestAnimationFrame(begin); else run.start(({ finished }) => { if (finished) finish(); });
    return () => { if (wait) cancelAnimationFrame(wait); run.stop(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { progress, mounted: mounted || open, settled: settled && rest.current === open };
}

export type EdgePanelProps = {
  open: boolean;
  /** The edge the panel is anchored to: it slides in from there and back out to it. */
  edge: Edge;
  /** The panel's width (start, end) or height (top, bottom) when open, in px. A change while open is applied at once: a splitter drag is not animated. */
  size: number;
  /**
   * Docked (default): the panel takes room in the layout and its neighbours follow as that room grows and shrinks.
   * Overlay: it lies over its positioned parent, anchored to the edge, and only itself moves.
   */
  overlay?: boolean;
  /** A docked panel whose content sizes itself (it has its own splitter): at rest the box follows the content, `size` is only the distance it travels. */
  fit?: boolean;
  /** Skips the motion for this change. */
  instant?: boolean;
  /** Called when the panel has come to rest, open or closed: the moment to move focus. */
  onSettled?(open: boolean): void;
  children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
};

/**
 * A panel, drawer or sheet anchored to an edge. Its content keeps its full size while it moves and is clipped by the
 * panel's box, so it slides instead of being squeezed; it is out of the tree while closed. `data-open` and
 * `data-settled` say where it is, for callers and checks that must wait for it to rest.
 *
 * In a browser the slide is ONE CSS transition (`CssEdgePanel`): no script runs per frame, and while a docked panel
 * moves the shared "panels are moving" signal is on (`panelmotion.ts`). Elsewhere the Animated API drives it.
 */
export function EdgePanel(props: EdgePanelProps) {
  // Fixed for the life of the page, so the choice never changes between renders.
  return cssMotion() ? <CssEdgePanel {...props} /> : <AnimatedEdgePanel {...props} />;
}

function CssEdgePanel(props: EdgePanelProps) {
  const theme = useTheme();
  const [mounted, setMounted] = useState(props.open);
  const [settled, setSettled] = useState(true);
  const node = useRef<View>(null);
  const first = useRef(true);
  const done = useRef(props.onSettled);
  done.current = props.onSettled;
  const kept = useRef(props.children);
  if (props.open) kept.current = props.children;
  const horizontal = props.edge === "start" || props.edge === "end", leading = props.edge === "start" || props.edge === "top";
  const dimension = horizontal ? "width" : "height";
  const overlay = Boolean(props.overlay), fit = Boolean(props.fit) && !overlay;
  const still = theme.reduceMotion || Boolean(props.instant);
  // Off screen is one full size towards the edge; the inline edges follow the reading direction.
  const away = (leading ? -1 : 1) * (horizontal && theme.rtl ? -1 : 1) * props.size;
  const live = useRef({ size: props.size, away, still, fit });
  live.current = { size: props.size, away, still, fit };
  // Whether the node was in the tree before this change (a panel mounted by the change starts closed), and whether a slide owns its size.
  const was = useRef(props.open), busy = useRef(false);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const open = props.open, now = live.current;
    const property = overlay ? "transform" as const : dimension;
    const shut = overlay ? `translate${horizontal ? "X" : "Y"}(${now.away}px)` : "0px", shown = overlay ? `translate${horizontal ? "X" : "Y"}(0px)` : `${now.size}px`;
    // Where the panel is right now: the closed state when it has just been mounted, else what is on screen (a change of mind mid-slide).
    const current = () => (overlay ? computedStyleOf(node.current, "transform") : `${computedSize(node.current, dimension)}px`);
    // A closed overlay keeps its place off screen until it leaves the tree.
    const rest = () => setInlineStyle(node.current, overlay ? (open ? { transform: "" } : {}) : { [dimension]: open && now.fit ? "" : open ? shown : shut });
    let over = false;
    const end = overlay ? () => {} : beginPanelMotion();
    const finish = () => { if (over) return; over = true; busy.current = false; rest(); end(); setMounted(open); setSettled(true); done.current?.(open); };
    if (open) setMounted(true);
    busy.current = true;
    if (now.still) { if (!open) setInlineStyle(node.current, { [property]: shut }); finish(); return () => { end(); }; }
    setSettled(false);
    let cancel: (finish?: boolean) => void = () => {}, wait = 0, frames = 0;
    if (open) {
      const from = was.current ? current() : shut;
      // Before the first paint the panel is at its start; the slide begins two frames later, once the first render and
      // layout of what it holds have been drawn (they would otherwise eat the first frames of the slide).
      setInlineStyle(node.current, { transition: "none", [property]: from });
      const begin = () => { if (++frames < 2) { wait = requestAnimationFrame(begin); return; } wait = 0; cancel = cssGlide([{ node: node.current, property, from, to: shown }], motion.slow, motion.easeEnter, finish); };
      wait = requestAnimationFrame(begin);
    } else {
      cancel = cssGlide([{ node: node.current, property, from: current(), to: shut }], motion.exit, motion.easeExit, finish);
    }
    return () => {
      if (wait) cancelAnimationFrame(wait);
      if (!over) { const held = current(); cancel(); setInlineStyle(node.current, { [property]: held }); over = true; busy.current = false; }
      end();
    };
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { was.current = mounted || props.open; });
  // At rest the box has the size asked for (a splitter drag changes it at once, without a transition).
  useLayoutEffect(() => { if (!busy.current && settled && !overlay && props.open) setInlineStyle(node.current, { [dimension]: fit ? "" : `${props.size}px` }); }, [props.size, settled, fit, overlay, dimension, props.open]);
  if (!mounted && !props.open) return null;
  const data = { dataSet: { open: String(props.open), settled: String(settled) } } as object;
  const leaving = !props.open;
  if (overlay) {
    const anchor: ViewStyle = horizontal ? { top: 0, bottom: 0, [props.edge]: 0, width: props.size } : { left: 0, right: 0, [props.edge]: 0, height: props.size };
    return (
      <View ref={node} testID={props.testID} {...data} aria-hidden={leaving || undefined} pointerEvents={leaving ? "none" : "box-none"} style={[{ position: "absolute" }, anchor, props.style]}>
        {kept.current}
      </View>
    );
  }
  return (
    <View ref={node} testID={props.testID} {...data} aria-hidden={leaving || undefined} pointerEvents={leaving ? "none" : "auto"}
      style={[{
        // The size along the edge is set on the node itself (see above): React never writes it, so a render mid-slide cannot cut the transition short.
        overflow: settled ? "visible" : "hidden",
        flexDirection: horizontal ? "row" : "column", justifyContent: leading ? "flex-end" : "flex-start", flexShrink: 0, alignSelf: "stretch",
      }, props.style]}>
      <View style={{ [dimension]: settled && fit ? undefined : props.size, flexShrink: 0, flexDirection: horizontal ? "row" : "column" }}>{kept.current}</View>
    </View>
  );
}

function AnimatedEdgePanel(props: EdgePanelProps) {
  const theme = useTheme();
  const { progress, mounted, settled } = useEdgeMotion(props.open, { instant: props.instant, onSettled: props.onSettled });
  // On the way out the panel shows what it held when it was open, whatever the caller passes by then.
  const kept = useRef(props.children);
  if (props.open) kept.current = props.children;
  if (!mounted) return null;
  const horizontal = props.edge === "start" || props.edge === "end", leading = props.edge === "start" || props.edge === "top";
  const dimension = horizontal ? "width" : "height";
  const data = { dataSet: { open: String(props.open), settled: String(settled) } } as object;
  const leaving = !props.open;
  if (props.overlay) {
    // Off screen is one full size towards the edge; the inline edges follow the reading direction.
    const away = (leading ? -1 : 1) * (horizontal && theme.rtl ? -1 : 1) * props.size;
    const shift = progress.interpolate({ inputRange: [0, 1], outputRange: [away, 0] });
    const anchor: ViewStyle = horizontal ? { top: 0, bottom: 0, [props.edge]: 0, width: props.size } : { left: 0, right: 0, [props.edge]: 0, height: props.size };
    return (
      <Animated.View testID={props.testID} {...data} aria-hidden={leaving || undefined} pointerEvents={leaving ? "none" : "box-none"}
        style={[{ position: "absolute" }, anchor, settled ? null : { transform: [horizontal ? { translateX: shift } : { translateY: shift }] }, props.style]}>
        {kept.current}
      </Animated.View>
    );
  }
  return (
    <Animated.View testID={props.testID} {...data} aria-hidden={leaving || undefined} pointerEvents={leaving ? "none" : "auto"}
      style={[{
        // At rest the box is not clipped: a splitter or a focus ring may reach over its edge.
        [dimension]: settled ? (props.fit ? undefined : props.size) : progress.interpolate({ inputRange: [0, 1], outputRange: [0, props.size] }), overflow: settled ? "visible" : "hidden",
        flexDirection: horizontal ? "row" : "column", justifyContent: leading ? "flex-end" : "flex-start", flexShrink: 0, alignSelf: "stretch",
      }, props.style]}>
      <Animated.View style={{ [dimension]: settled && props.fit ? undefined : props.size, flexShrink: 0, flexDirection: horizontal ? "row" : "column" }}>{kept.current}</Animated.View>
    </Animated.View>
  );
}
