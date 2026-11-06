import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Animated, Easing, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Button, IconButton } from "./button.tsx";
import { dragHandle } from "./draghandle.ts";
import { place, type Rect, type Side } from "./logic/position.ts";
import { closeDecision, drawerWidth, modalQueue, shouldDismiss, snapPoints, type CloseReason } from "./logic/surfaces.ts";
import { cycleFocus, focusElement, focusFirstIn, focusedElement, loadSheetWidth, lockScroll, onGlobalKey, onViewportScroll, storeSheetWidth } from "./platform/dom";
import { Text } from "./text.tsx";
import { Portal, useTheme, type Theme } from "./theme.tsx";
import { borderWidth, easing, layout, motion, radius, size, space } from "./tokens.ts";

export type { CloseReason };
const ENTER = Easing.bezier(...easing.enter), EXIT = Easing.bezier(...easing.exit);
const FILL: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
export const useInsets = () => useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;

// Some shared screens pass the surface that holds a toolbar as their anchor. Remember the last activated control so
// Popover can use the actual button inside that surface without making every caller keep a second ref.
let lastPopoverTrigger: { element: HTMLElement; at: number; rect: Rect } | null = null;
const composerSelector = "[data-testid='composer'],[data-testid='agent-composer-surface']";
function triggerIdentity(element: HTMLElement) {
  const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent ?? "";
  return { label: label.replace(/\s+/g, " ").trim(), role: element.getAttribute("role") ?? "button", tag: element.tagName };
}
function visibleInViewport(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || node.getAttribute("aria-hidden") === "true") return false;
  }
  return true;
}
if (typeof document !== "undefined") {
  const rememberTrigger = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest?.("button,[role='button'],[role^='menuitem']") as HTMLElement | null;
    if (element) {
      const rect = element.getBoundingClientRect();
      lastPopoverTrigger = { element, at: Date.now(), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
    }
  };
  document.addEventListener("pointerdown", rememberTrigger, true);
  document.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") rememberTrigger(event); }, true);
}

/** Keeps a surface mounted through its exit: every overlay leaves in 120 ms with the exit easing. */
const EXIT_GRACE_MS = 80;
function usePresence(open: boolean, enterMs: number, theme: Theme) {
  const progress = useRef(new Animated.Value(0)).current;
  const gone = useRef(0);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const enter = theme.reduceMotion ? Math.min(enterMs, motion.reducedFade) : enterMs;
      progress.stopAnimation();
      Animated.timing(progress, { toValue: 1, duration: enter, easing: ENTER, useNativeDriver: false }).start();
      // The animation is a nicety; being visible is not. A surface whose entrance did not arrive (seen in the desktop
      // app: the second opening of a popover stayed at opacity 0 while taking every click) is put in place regardless.
      const arrive = setTimeout(() => { progress.stopAnimation(); progress.setValue(1); }, enter + EXIT_GRACE_MS);
      return () => clearTimeout(arrive);
    }
    const exit = Animated.timing(progress, { toValue: 0, duration: motion.exit, easing: EXIT, useNativeDriver: false });
    // An exit lasts `motion.exit`. Past this moment the surface counts as gone even if the screen that owns it was put
    // away before the animation could report its end.
    gone.current = Date.now() + motion.exit + EXIT_GRACE_MS;
    exit.start(({ finished }) => { if (finished) setMounted(false); });
    // ...and it IS taken away then, whether or not the animation reported its end: a surface left mounted at opacity 0
    // is what came back invisible the next time it was opened.
    const leave = setTimeout(() => { progress.stopAnimation(); progress.setValue(0); setMounted(false); }, motion.exit + EXIT_GRACE_MS);
    return () => { clearTimeout(leave); exit.stop(); };
  }, [open, enterMs, progress, theme.reduceMotion]);
  if (open) gone.current = 0;
  // The owner was hidden (navigated away from) and is shown again: a surface that was told to close meanwhile is gone,
  // it does not play its exit over the screen the person came back to.
  const wanted = useRef(open);
  wanted.current = open;
  useLayoutEffect(() => { if (!wanted.current) { progress.stopAnimation(); progress.setValue(0); setMounted(false); } }, [progress]);
  return { mounted: mounted && (open || gone.current === 0 || Date.now() <= gone.current), progress };
}

type Motion = "fade" | "pop" | "rise" | "from-bottom" | "from-end" | "from-start";
/** Enter transform of a surface. Under reduced motion every translation is removed and only the opacity fade remains. */
function motionStyle(kind: Motion, progress: Animated.Value, theme: Theme, extent = 0): object {
  const slide = (from: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  const fade = { opacity: progress };
  if (theme.reduceMotion || kind === "fade") return fade;
  const inline = theme.rtl ? -1 : 1;
  switch (kind) {
    case "pop": return { ...fade, transform: [{ translateY: slide(-motion.popoverShift) }] };
    case "rise": return { ...fade, transform: [{ translateY: slide(motion.maxShift) }] };
    // Drawers and sheets translate their full size.
    case "from-bottom": return { transform: [{ translateY: slide(extent) }] };
    case "from-end": return { transform: [{ translateX: slide(extent * inline) }] };
    default: return { transform: [{ translateX: slide(-extent * inline) }] };
  }
}

export type SurfaceProps = {
  open: boolean;
  /** Asked to close by Escape, a scrim press or the system back action. */
  onRequestClose(reason: CloseReason): void;
  level?: "popover" | "modal" | "drawer";
  /** `dim` draws `bg/scrim`; `clear` catches outside presses without drawing; `none` leaves the page interactive. */
  scrim?: "dim" | "clear" | "none";
  enterMs?: number;
  /** Moves focus in, keeps Tab inside and restores focus on close. On by default for surfaces with a scrim. */
  trap?: boolean;
  /** Selector of the control that takes initial focus; the first control otherwise. */
  initialFocus?: string;
  children(progress: Animated.Value, container: RefObject<View | null>): ReactNode;
};

/**
 * A layer above the page. While open it traps Tab inside itself, closes on Escape and on scrim press, locks background
 * scroll, makes the page inert, and gives focus back to the opener when it closes.
 */
export function Surface(props: SurfaceProps) {
  const theme = useTheme();
  const modal = props.scrim !== "none";
  const trap = props.trap ?? modal;
  const { mounted, progress } = usePresence(props.open, props.enterMs ?? motion.base, theme);
  const container = useRef<View>(null);
  const request = useRef(props.onRequestClose);
  request.current = props.onRequestClose;
  // What the surface holds page-wide: the scroll lock and the Escape / Tab handler. Let go when it closes, and also the
  // moment its owner's screen is hidden; taken again if that screen comes back with the surface still open.
  const held = useRef<(() => void) | null>(null);
  const hold = () => {
    if (held.current) return;
    const unlock = modal ? lockScroll() : () => {};
    const off = onGlobalKey((key) => {
      if (key.key === "Escape") { request.current("escape"); return true; }
      if (key.key === "Tab" && trap) return cycleFocus(container.current, key.shift);
      return false;
    });
    held.current = () => { off(); unlock(); held.current = null; };
  };
  const live = useRef(mounted);
  live.current = mounted;
  // React disconnects layout effects when the owner's screen is hidden and connects them again when it is shown.
  useLayoutEffect(() => { if (live.current) hold(); return () => held.current?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mounted) return;
    const opener = focusedElement();
    hold();
    // The surface is drawn by the overlay stack one render later: initial focus waits until its container exists.
    let tries = 0;
    let focus = setTimeout(function place() { if (!trap) return; if (!container.current && tries++ < 20) { focus = setTimeout(place, 16); return; } focusFirstIn(container.current, props.initialFocus); }, 0);
    return () => { clearTimeout(focus); held.current?.(); if (trap) focusElement(opener); };
    // The surface is set up once per mount; `initialFocus` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, modal, trap]);
  if (!mounted) return null;
  return (
    <Portal layer={props.level ?? "modal"} modal={modal && props.open} onOwnerHidden={(hidden) => { if (hidden) held.current?.(); else if (live.current && props.open) hold(); }}>
      <View pointerEvents={props.open ? props.scrim === "none" ? "box-none" : "auto" : "none"} style={FILL}>
        {props.scrim === "none" || !props.open ? null : (
          <Animated.View style={[FILL, { opacity: progress }]}>
            <Pressable accessible={false} focusable={false} tabIndex={-1} aria-hidden testID="scrim" onPress={() => props.onRequestClose("scrim")}
              style={[FILL, { backgroundColor: props.scrim === "clear" ? "transparent" : theme.color("bg/scrim") }]} />
          </Animated.View>
        )}
        {props.children(progress, container)}
      </View>
    </Portal>
  );
}

/** The elevated box of popovers and menus: `bg/elevated`, radius 8, `elevation/2`, 4 px padding, 180–320 px wide (400 for `wide`). */
export function popoverBox(theme: Theme, wide = false): ViewStyle {
  return { backgroundColor: theme.color("bg/elevated"), borderRadius: radius.md, padding: space[1], minWidth: layout.popoverMin, maxWidth: wide ? layout.popoverWideMax : layout.popoverMax, ...theme.elevation(2) };
}

export type PopoverProps = {
  open: boolean; onClose(): void; anchor: RefObject<View | null> | Rect;
  side?: Side; align?: "start" | "center" | "end"; wide?: boolean;
  /** Keep pointer travel across the anchor gap inside one hover region. */
  hoverBridge?: boolean;
  /** At least as wide as the anchor, for selects. */
  matchAnchor?: boolean; width?: number; label?: string; role?: "dialog" | "menu" | "listbox" | "grid";
  /** Title of the bottom sheet this becomes on compact form factors. */
  title?: string; initialFocus?: string; padded?: boolean; children: ReactNode;
  /** Keeps the popover presentation on compact form factors (tooltips of charts, nested submenus on tablets). */
  neverSheet?: boolean; onRequestClose?(reason: CloseReason): void; style?: StyleProp<ViewStyle>;
  /** `none` for a submenu: its parent menu stays live under it and the root menu's scrim catches outside presses. */
  scrim?: "clear" | "none";
};

/**
 * A surface anchored to its trigger with a 4 px offset, flipped and shifted to stay 8 px inside the viewport. It enters
 * with a fade and a 4 px translation in 160 ms. On compact form factors it is presented as a bottom sheet.
 */
export function Popover(props: PopoverProps) {
  const theme = useTheme();
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const composerTrigger = useRef<{ owner: HTMLElement; identity: ReturnType<typeof triggerIdentity> } | null>(null);
  const close = (reason: CloseReason) => (props.onRequestClose ? props.onRequestClose(reason) : props.onClose());
  useEffect(() => {
    // Closed: the measured box is dropped once. Nothing is set when there is none — a closed popover whose anchor is a
    // new rectangle on every render of its parent (a parent that renders on every frame of playback) would otherwise
    // set state from this effect on each of those renders.
    if (!props.open) { trigger.current = null; composerTrigger.current = null; if (box !== null) setBox(null); return; }
    trigger.current = null;
    composerTrigger.current = null;
    let live = true, frame = 0, resizeTarget: HTMLElement | null = null;
    const measure = () => {
      if (!live) return;
      const binding = composerTrigger.current;
      if (binding && Platform.OS === "web") {
        resizeTarget = binding.owner;
        const controls = [...binding.owner.querySelectorAll<HTMLElement>("button,[role='button'],[role^='menuitem']")];
        const matches = controls.filter((element) => {
          const identity = triggerIdentity(element);
          return identity.label === binding.identity.label && identity.role === binding.identity.role && identity.tag === binding.identity.tag && visibleInViewport(element);
        });
        if (matches.length === 0) { close("action"); return; }
        const previous = trigger.current?.getBoundingClientRect();
        const next = matches.length === 1 ? matches[0]! : matches.reduce((best, element) => {
          if (!previous) return best;
          const rect = element.getBoundingClientRect(), bestRect = best.getBoundingClientRect();
          return Math.hypot(rect.x - previous.x, rect.y - previous.y) < Math.hypot(bestRect.x - previous.x, bestRect.y - previous.y) ? element : best;
        });
        trigger.current = next;
        const rect = next.getBoundingClientRect();
        setAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        return;
      }
      if (trigger.current?.isConnected) {
        const rect = trigger.current.getBoundingClientRect();
        setAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        return;
      }
      const target = props.anchor;
      if (!("current" in target)) { setAnchor(target); return; }
      if (Platform.OS === "web") {
        const candidate = target.current as unknown as HTMLElement | null;
        const surface = Platform.OS === "web" && typeof candidate?.closest === "function" ? candidate : null;
        const recent = lastPopoverTrigger;
        const recentOwner = recent?.element.closest<HTMLElement>(composerSelector) ?? null;
        if (recent && recentOwner && Date.now() - recent.at < 1200) {
          const rect = recent.element.getBoundingClientRect();
          trigger.current = recent.element;
          composerTrigger.current = { owner: recentOwner, identity: triggerIdentity(recent.element) };
          resizeTarget = recentOwner;
          setAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
          return;
        }
        const controls = surface?.querySelectorAll("button,[role='button'],[role^='menuitem']");
        const directControl = surface?.matches("button,[role='button'],[role^='menuitem']")
          ? surface
          : controls?.length === 1 ? controls[0] as HTMLElement : null;
        const directRect = directControl?.getBoundingClientRect();
        if (directControl?.isConnected && directRect && directRect.width > 0 && directRect.height > 0) {
          trigger.current = directControl;
          const owner = directControl.closest<HTMLElement>(composerSelector);
          if (owner) { composerTrigger.current = { owner, identity: triggerIdentity(directControl) }; resizeTarget = owner; }
          setAnchor({ x: directRect.x, y: directRect.y, width: directRect.width, height: directRect.height });
          return;
        }
        const recentComposer = recent?.element.closest("[data-testid='composer'],[data-testid='agent-composer-surface']");
        if (recent && recentComposer && Date.now() - recent.at < 1200) {
          const rect = recent.element.isConnected ? recent.element.getBoundingClientRect() : recent.rect;
          trigger.current = recent.element.isConnected ? recent.element : null;
          const owner = recent.element.closest<HTMLElement>(composerSelector);
          if (owner) { composerTrigger.current = { owner, identity: triggerIdentity(recent.element) }; resizeTarget = owner; }
          setAnchor({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          return;
        }
      }
      target.current?.measureInWindow((x, y, width, height) => {
        if (!live) return;
        if (Platform.OS !== "web") { setAnchor({ x, y, width, height }); return; }
        const recent = lastPopoverTrigger;
        const surface = target.current as unknown as HTMLElement | null;
        const anchorComposer = surface?.closest("[data-testid='composer'],[data-testid='agent-composer-surface']")
          ?? surface?.querySelector("[data-testid='composer'],[data-testid='agent-composer-surface']");
        const recentComposer = recent?.element.closest("[data-testid='composer'],[data-testid='agent-composer-surface']");
        const controls = surface?.querySelectorAll("button,[role='button'],[role^='menuitem']");
        const directControl = surface?.matches("button,[role='button'],[role^='menuitem']")
          ? surface
          : controls?.length === 1 ? controls[0] as HTMLElement : null;
        const ownsRecent = !!(recent && ((surface && (surface === recent.element || surface.contains(recent.element) || (anchorComposer && anchorComposer === recentComposer) || recent.element.getAttribute("role")?.startsWith("menuitem"))) || (!surface && recentComposer)));
        const activeControl = recent && ownsRecent && Date.now() - recent.at < 1200 ? recent.element : directControl;
        const rect = activeControl?.isConnected ? activeControl.getBoundingClientRect() : recent && ownsRecent && Date.now() - recent.at < 1200 ? recent.rect : null;
        if (rect && rect.width > 0 && rect.height > 0) {
          trigger.current = activeControl?.isConnected ? activeControl : null;
          const owner = activeControl?.closest<HTMLElement>(composerSelector);
          if (owner) { composerTrigger.current = { owner, identity: triggerIdentity(activeControl!) }; resizeTarget = owner; }
          setAnchor({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        } else setAnchor({ x, y, width, height });
      });
    };
    measure();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const schedule = () => { if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
      window.addEventListener("resize", schedule);
      const unwatch = onViewportScroll(schedule);
      const observer = resizeTarget && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
      if (resizeTarget) observer?.observe(resizeTarget);
      return () => { live = false; if (frame) cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); unwatch(); observer?.disconnect(); };
    }
    return () => { live = false; };
  }, [props.open, props.anchor]);
  const anchorNode = "current" in props.anchor ? props.anchor.current as unknown as HTMLElement | null : null;
  const recentNode = lastPopoverTrigger && Date.now() - lastPopoverTrigger.at < 1200 ? lastPopoverTrigger.element : null;
  const belongsToComposer = Boolean(recentNode?.closest("[data-testid='composer'],[data-testid='agent-composer-surface']")
    || anchorNode?.closest?.("[data-testid='composer'],[data-testid='agent-composer-surface']")
    || anchorNode?.querySelector?.("[data-testid='composer'],[data-testid='agent-composer-surface']"));
  const composerOwned = Boolean(composerTrigger.current) || belongsToComposer;
  useEffect(() => {
    if (!props.open || !composerOwned || Platform.OS !== "web" || typeof document === "undefined") return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-testid='popover']") || target.closest("[role='separator']") || trigger.current?.contains(target)) return;
      close("scrim");
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [props.open, composerOwned, props.onClose, props.onRequestClose]);
  if (theme.compact && !props.neverSheet && !belongsToComposer) {
    return <BottomSheet open={props.open} onClose={props.onClose} onRequestClose={props.onRequestClose} title={props.title} label={props.label} padded={props.padded} initialFocus={props.initialFocus}>{props.children}</BottomSheet>;
  }
  const at = anchor && box ? place({ anchor, size: box, viewport: theme, side: props.side, align: props.align, offset: space[1], inset: layout.viewportInset, rtl: theme.rtl }) : null;
  const bridge = props.hoverBridge && anchor && box && at ? (() => {
    const vertical = at.side === "top" || at.side === "bottom";
    const left = Math.min(anchor.x, at.x);
    const right = Math.max(anchor.x + anchor.width, at.x + box.width);
    const top = at.side === "top" ? at.y + box.height : anchor.y + anchor.height;
    const bottom = at.side === "top" ? anchor.y : at.y;
    return { position: "absolute" as const, left, top, width: right - left, height: Math.max(0, bottom - top), ...(vertical ? {} : { display: "none" as const }) };
  })() : null;
  return (
    <Surface open={props.open} onRequestClose={close} level="popover" scrim={props.scrim ?? (composerOwned ? "none" : "clear")} trap initialFocus={props.initialFocus}>
      {(progress, container) => (
        <>
        {bridge ? <View pointerEvents="auto" aria-hidden testID="context-meter-hover-bridge" style={bridge} /> : null}
        <Animated.View ref={container} pointerEvents={props.open ? "auto" : "none"} role={(props.role ?? "dialog") as "dialog"} aria-label={props.label} accessibilityLabel={props.label} testID="popover"
          onLayout={(event) => { const { width, height } = event.nativeEvent.layout; if (!box || box.width !== width || box.height !== height) setBox({ width, height }); }}
          style={[popoverBox(theme, props.wide), props.padded ? { padding: space[3] } : null, props.width ? { width: props.width, maxWidth: props.width } : null,
            props.matchAnchor && anchor ? { minWidth: Math.max(layout.popoverMin, anchor.width) } : null,
            { position: "absolute", left: at?.x ?? 0, top: at?.y ?? 0, maxHeight: at?.maxHeight }, props.style,
            at ? motionStyle("pop", progress, theme) : { opacity: 0 }]}>
          {props.children}
        </Animated.View>
        </>
      )}
    </Surface>
  );
}

export type BottomSheetProps = {
  open: boolean; onClose(): void; onRequestClose?(reason: CloseReason): void; title?: string; label?: string; children: ReactNode; footer?: ReactNode;
  /** A non-modal tool sheet: centred title, confirm at the inline-end, no scrim; the page above it stays interactive. */
  modal?: boolean; onConfirm?(): void; headerStart?: ReactNode; headerEnd?: ReactNode; scrollable?: boolean;
  /** Height as a fraction of the viewport (0.5 or 0.9); the content height otherwise, never above 90%. */
  snap?: 0.5 | 0.9; padded?: boolean; initialFocus?: string; fullHeight?: boolean;
};

/**
 * A sheet from the bottom edge: 16 px top corners, a 36×4 px grab handle, drag-to-dismiss past 30% of its height or with a
 * downward fling above 800 px/s, keyboard avoidance and safe-area padding.
 */
export function BottomSheet(props: BottomSheetProps) {
  const theme = useTheme();
  const insets = useInsets();
  const modal = props.modal ?? true;
  const [height, setHeight] = useState(theme.height);
  const drag = useRef(new Animated.Value(0)).current;
  const close = (reason: CloseReason) => (props.onRequestClose ? props.onRequestClose(reason) : props.onClose());
  const latest = useRef({ close, height });
  latest.current = { close, height };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4,
    onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      // Velocity is reported in px/ms.
      if (shouldDismiss(gesture.dy, latest.current.height, gesture.vy * 1000)) latest.current.close("scrim");
      Animated.timing(drag, { toValue: 0, duration: motion.fast, useNativeDriver: false }).start();
    },
  }), [drag]);
  useEffect(() => { if (props.open) drag.setValue(0); }, [props.open, drag]);
  const cap = theme.height * 0.9;
  const fixed = props.fullHeight ? theme.height - insets.top : props.snap ? snapPoints(0, theme.height)[props.snap === 0.5 ? 1 : 2] : undefined;
  return (
    <Surface open={props.open} onRequestClose={close} level="modal" scrim={modal ? "dim" : "none"} enterMs={motion.slow} initialFocus={props.initialFocus}>
      {(progress, container) => (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none" style={[FILL, { justifyContent: "flex-end" }]}>
          <Animated.View ref={container} pointerEvents={props.open ? "auto" : "none"} role="dialog" aria-modal={modal} aria-label={props.label ?? props.title} accessibilityLabel={props.label ?? props.title} accessibilityViewIsModal={modal} testID="bottom-sheet"
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            style={[{ backgroundColor: theme.color("bg/elevated"), borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: props.fullHeight ? undefined : cap, height: fixed, paddingBottom: insets.bottom },
              theme.elevation(3), { borderBottomWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 },
              theme.reduceMotion ? { opacity: progress, transform: [{ translateY: drag }] } : { transform: [{ translateY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag) }] }]}>
            <View {...pan.panHandlers} style={{ alignItems: "center", paddingTop: space[2], paddingBottom: space[1] }}>
              <View style={{ width: size.grabWidth, height: size.grabHeight, borderRadius: radius.full, backgroundColor: theme.color("border/strong") }} />
            </View>
            {props.title || props.headerStart || props.headerEnd || props.onConfirm ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], minHeight: theme.touch ? size.tableRow : size.tableHeader }}>
                <View style={{ flex: 1, alignItems: "flex-start" }}>{props.headerStart}</View>
                {props.title ? <Text variant="title-sm" level={2} numberOfLines={1}>{props.title}</Text> : null}
                <View style={{ flex: 1, alignItems: "flex-end" }}>{props.headerEnd ?? (props.onConfirm ? <IconButton icon="check" label={theme.t("apply")} onPress={props.onConfirm} /> : null)}</View>
              </View>
            ) : null}
            {props.scrollable === false ? props.children : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={props.padded ? { padding: space[4], gap: space[3] } : { padding: space[1] }} style={{ flexGrow: 0, flexShrink: 1 }}>{props.children}</ScrollView>}
            {props.footer ? <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2], paddingVertical: space[3], paddingHorizontal: space[4], borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>{props.footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      )}
    </Surface>
  );
}

const queue = modalQueue<{ id: string; parent?: string; priority?: number }>();
const queueListeners = new Set<() => void>();
let queueVersion = 0;
const notifyQueue = () => { queueVersion++; queueListeners.forEach((listener) => listener()); };
const ModalParent = createContext<string | undefined>(undefined);
/** True when this modal is one of those drawn now: the first requested, or a confirmation raised by it. */
function useModalTurn(open: boolean, priority?: number): { visible: boolean; id: string } {
  const id = useId();
  const parent = useContext(ModalParent);
  useEffect(() => {
    if (!open) return;
    queue.open({ id, parent, priority });
    notifyQueue();
    return () => { queue.close(id); notifyQueue(); };
  }, [open, id, parent, priority]);
  useSyncExternalStore((listener) => { queueListeners.add(listener); return () => { queueListeners.delete(listener); }; }, () => queueVersion, () => queueVersion);
  return { visible: open && queue.visible().some((entry) => entry.id === id), id };
}

export type ModalProps = {
  title: string; description?: string; width?: 360 | 480 | 640; onClose(): void; children?: ReactNode; footer?: ReactNode; open?: boolean; priority?: number;
  /** Compact forms with a docked composer can use a height resize so their footer clears the iOS keyboard. */
  keyboardBehavior?: "padding" | "height";
  /** Not dismissible by Escape or scrim press, e.g. while a non-cancellable step runs. */
  blocking?: boolean;
  /** Holds unsaved input: closing asks "Discard changes?" first. */
  dirty?: boolean; hideClose?: boolean; initialFocus?: string;
};

/**
 * A dialog centred over `bg/scrim`: radius 12, `elevation/3`, 360 (confirm), 480 (form) or 640 (complex) wide, at most 85%
 * of the viewport tall with a scrolling body. On compact form factors it is a full-height sheet with the title bar pinned
 * and the actions pinned above the safe area. Only one modal is visible at a time.
 */
export function Modal(props: ModalProps) {
  const theme = useTheme();
  const insets = useInsets();
  const open = props.open ?? true;
  const turn = useModalTurn(open, props.priority);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const request = (reason: CloseReason) => {
    const decision = closeDecision(reason, { blocking: props.blocking, dirty: props.dirty });
    if (decision === "close") props.onClose(); else if (decision === "confirm-discard") setConfirming(true);
  };
  const header = (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingTop: space[4], paddingHorizontal: space[4], paddingBottom: space[3] }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title-sm" level={2} nativeID={titleId}>{props.title}</Text>
        {props.description ? <Text variant="meta" color="text/secondary">{props.description}</Text> : null}
      </View>
      {props.hideClose || props.blocking ? null : <IconButton icon="x" label={theme.t("close")} onPress={() => request("button")} />}
    </View>
  );
  const footer = props.footer ? (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space[2], paddingVertical: space[3], paddingHorizontal: space[4], borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>{props.footer}</View>
  ) : null;
  const body = <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] }}>{/* The overlay stack draws the surface outside this subtree: a confirmation raised from the body still names this modal as its parent. */}<ModalParent.Provider value={turn.id}>{props.children}</ModalParent.Provider></ScrollView>;
  return (
    <ModalParent.Provider value={turn.id}>
      <Surface open={turn.visible} onRequestClose={request} level="modal" scrim="dim" enterMs={theme.compact ? motion.slow : motion.base} initialFocus={props.initialFocus}>
        {(progress, container) => (theme.compact ? (
          <KeyboardAvoidingView testID="modal-keyboard-avoiding" behavior={Platform.OS === "ios" ? props.keyboardBehavior ?? "padding" : undefined} pointerEvents="box-none" style={FILL}>
            <Animated.View ref={container} role="dialog" aria-modal aria-labelledby={titleId} accessibilityViewIsModal testID="modal"
              style={[{ flex: 1, backgroundColor: theme.color("bg/elevated"), paddingTop: insets.top, paddingBottom: insets.bottom }, motionStyle("from-bottom", progress, theme, theme.height)]}>
              {header}<View style={{ flex: 1, minHeight: 0 }}>{body}</View>{footer}
            </Animated.View>
          </KeyboardAvoidingView>
        ) : (
          <View pointerEvents="box-none" style={[FILL, { alignItems: "center", justifyContent: "center", padding: space[4] }]}>
            <Animated.View ref={container} role="dialog" aria-modal aria-labelledby={titleId} accessibilityViewIsModal testID="modal"
              style={[{ width: "100%", maxWidth: props.width ?? layout.modal.form, maxHeight: "85%", backgroundColor: theme.color("bg/elevated"), borderRadius: radius.lg }, theme.elevation(3), motionStyle("rise", progress, theme)]}>
              {header}{body}{footer}
            </Animated.View>
          </View>
        ))}
      </Surface>
      {confirming ? <DiscardConfirm onKeep={() => setConfirming(false)} onDiscard={() => { setConfirming(false); props.onClose(); }} /> : null}
    </ModalParent.Provider>
  );
}

/** "Discard changes?": shown when a surface holding unsaved input is asked to close. "Keep editing" has the initial focus. */
function DiscardConfirm(props: { onKeep(): void; onDiscard(): void }) {
  const theme = useTheme();
  return (
    <Modal title={theme.t("discardTitle")} description={theme.t("discardBody")} width={layout.modal.confirm} onClose={props.onKeep} initialFocus='[data-testid="keep-editing"]'
      footer={<><Button kind="ghost" label={theme.t("keepEditing")} testID="keep-editing" onPress={props.onKeep} /><Button kind="destructive" label={theme.t("discard")} onPress={props.onDiscard} /></>} />
  );
}

const SIDE_SHEET_MIN = 320;
/**
 * The width a side sheet starts with: the stored value when it reads as a finite number, never below the minimum; the
 * default otherwise. The render-time maximum is applied separately, so a width saved on a wider window still opens safely.
 */
export function restoredSheetWidth(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(SIDE_SHEET_MIN, Math.round(value)) : fallback;
}
/** The width the person last gave a side sheet: restored at startup and kept for the sheets opened after it in this run. */
let sideSheetWidth: number = restoredSheetWidth(loadSheetWidth(), layout.sideSheet);
export type SideSheetProps = { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode; modal?: boolean; dirty?: boolean };
/** A sheet from the inline-end edge: 400 px wide (full width on compact form factors), full height, header, scrolling body, pinned footer. */
export function SideSheet(props: SideSheetProps) {
  const theme = useTheme();
  const insets = useInsets();
  const [confirming, setConfirming] = useState(false);
  // The sheet can be dragged wider or narrower by its inner edge (not on compact, where it fills the screen); the width is
  // kept for the next sheet of this run. Double-press on the edge returns to the default.
  const [chosen, setChosen] = useState<number>(sideSheetWidth);
  const widest = Math.max(layout.sideSheet, Math.round(theme.width * 0.7));
  const width = theme.compact ? theme.width : Math.min(widest, Math.max(SIDE_SHEET_MIN, chosen));
  const from = useRef(width), lastPress = useRef(0), live = useRef({ width, widest, rtl: theme.rtl });
  live.current = { width, widest, rtl: theme.rtl };
  const resize = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    // A second press within 350 ms of the first returns the edge to the default; that default is persisted too.
    onPanResponderGrant: () => { from.current = live.current.width; const now = Date.now(); if (now - lastPress.current < 350) { sideSheetWidth = layout.sideSheet; setChosen(layout.sideSheet); storeSheetWidth(layout.sideSheet); } lastPress.current = now; },
    onPanResponderMove: (_event, gesture) => { const next = Math.min(live.current.widest, Math.max(SIDE_SHEET_MIN, Math.round(from.current + (live.current.rtl ? gesture.dx : -gesture.dx)))); sideSheetWidth = next; setChosen(next); },
    // Only on drag end: the chosen width is written once, not on every move.
    onPanResponderRelease: () => storeSheetWidth(sideSheetWidth),
    onPanResponderTerminate: () => storeSheetWidth(sideSheetWidth),
  })).current;
  const [gripHover, setGripHover] = useState(false);
  const request = (reason: CloseReason) => {
    const decision = closeDecision(reason, { dirty: props.dirty });
    if (decision === "close") props.onClose(); else if (decision === "confirm-discard") setConfirming(true);
  };
  return (
    <>
      <Surface open={props.open} onRequestClose={request} level="modal" scrim={props.modal === false ? "none" : "dim"} enterMs={motion.slow}>
        {(progress, container) => (
          <Animated.View ref={container} role="dialog" aria-modal={props.modal !== false} aria-label={props.title} accessibilityViewIsModal={props.modal !== false} testID="side-sheet"
            style={[{ position: "absolute", top: 0, bottom: 0, end: 0, width, backgroundColor: theme.color("bg/elevated"), paddingTop: insets.top, paddingBottom: insets.bottom }, theme.elevation(3), motionStyle("from-end", progress, theme, width)]}>
            {theme.compact ? null : (
              <View {...resize.panHandlers} {...dragHandle("col-resize")} testID="side-sheet-grip" role="separator" aria-orientation="vertical" aria-label={props.title}
                {...({ onMouseEnter: () => setGripHover(true), onMouseLeave: () => setGripHover(false) } as object)}
                style={{ position: "absolute", top: 0, bottom: 0, start: -3, width: 8, zIndex: 2, alignItems: "center" }}>
                <View style={{ width: 2, flex: 1, backgroundColor: gripHover ? theme.color("accent") : "transparent" }} />
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[3], paddingHorizontal: space[4], borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
              <Text variant="title-sm" level={2} style={{ flex: 1 }}>{props.title}</Text>
              <IconButton icon="x" label={theme.t("close")} onPress={() => request("button")} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3] }}>{props.children}</ScrollView>
            {props.footer ? <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2], paddingVertical: space[3], paddingHorizontal: space[4], borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>{props.footer}</View> : null}
          </Animated.View>
        )}
      </Surface>
      {confirming ? <DiscardConfirm onKeep={() => setConfirming(false)} onDiscard={() => { setConfirming(false); props.onClose(); }} /> : null}
    </>
  );
}

export type DrawerProps = {
  open: boolean; onClose(): void; label: string; header?: ReactNode; footer?: ReactNode; children?: ReactNode;
  /** Two bodies switched by a segmented header; each keeps its own scroll position. */
  bodies?: [ReactNode, ReactNode]; active?: 0 | 1; segmented?: ReactNode;
  /** The only zone an opening drag may start in; the component never claims a screen edge the operating system reserves. */
  dragOpenZone?: { start: number; width: number }; onOpen?(): void;
};

/**
 * A modal panel from the inline-start edge over `bg/scrim`: `bg/sidebar`, `elevation/3`, 86% of the viewport up to 320 px.
 * It closes on scrim press, Escape, the system back action and a drag toward the inline-start edge past 30% of its width.
 */
export function Drawer(props: DrawerProps) {
  const theme = useTheme();
  const insets = useInsets();
  const width = drawerWidth(theme.width);
  const drag = useRef(new Animated.Value(0)).current;
  const latest = useRef(props);
  latest.current = props;
  const towardStart = theme.rtl ? 1 : -1;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) && gesture.dx * towardStart > 0,
    onPanResponderMove: (_event, gesture) => drag.setValue(towardStart * Math.max(0, gesture.dx * towardStart)),
    onPanResponderRelease: (_event, gesture) => {
      if (shouldDismiss(gesture.dx * towardStart, width, gesture.vx * towardStart * 1000)) latest.current.onClose();
      Animated.timing(drag, { toValue: 0, duration: motion.fast, useNativeDriver: false }).start();
    },
  }), [drag, towardStart, width]);
  const opener = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx * -towardStart > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => { if (shouldDismiss(gesture.dx * -towardStart, width, gesture.vx * -towardStart * 1000)) latest.current.onOpen?.(); },
  }), [towardStart, width]);
  return (
    <>
      {props.dragOpenZone && !props.open ? <View {...opener.panHandlers} style={{ position: "absolute", top: 0, bottom: 0, start: props.dragOpenZone.start, width: props.dragOpenZone.width }} /> : null}
      <Surface open={props.open} onRequestClose={() => props.onClose()} level="drawer" scrim="dim" enterMs={motion.slow}>
        {(progress, container) => (
          <Animated.View ref={container} {...pan.panHandlers} role="dialog" aria-modal aria-label={props.label} accessibilityViewIsModal testID="drawer"
            style={[{ position: "absolute", top: 0, bottom: 0, start: 0, width, backgroundColor: theme.color("bg/sidebar"), paddingTop: insets.top, paddingBottom: insets.bottom }, theme.elevation(3), { borderWidth: 0 },
              theme.reduceMotion ? { opacity: progress } : { transform: [{ translateX: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [width * towardStart, 0] }), drag) }] }]}>
            {props.header}
            {props.segmented}
            {props.bodies
              ? props.bodies.map((body, index) => <ScrollView key={index} style={{ flex: 1, display: (props.active ?? 0) === index ? "flex" : "none" }} contentContainerStyle={{ padding: space[2] }}>{body}</ScrollView>)
              : <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[2] }}>{props.children}</ScrollView>}
            {props.footer}
          </Animated.View>
        )}
      </Surface>
    </>
  );
}

/** One definition, two presentations: a Modal (or a popover when anchored) on medium and wide form factors, a BottomSheet on compact ones. */
export function AdaptiveSheet(props: { open: boolean; onClose(): void; title: string; description?: string; width?: 360 | 480 | 640; anchor?: RefObject<View | null>; children: ReactNode; footer?: ReactNode; dirty?: boolean }) {
  const theme = useTheme();
  if (theme.compact) return <BottomSheet open={props.open} onClose={props.onClose} title={props.title} footer={props.footer} padded>{props.children}</BottomSheet>;
  if (props.anchor) return <Popover open={props.open} onClose={props.onClose} anchor={props.anchor} label={props.title} padded>{props.children}{props.footer}</Popover>;
  return <Modal open={props.open} onClose={props.onClose} title={props.title} description={props.description} width={props.width} footer={props.footer} dirty={props.dirty}>{props.children}</Modal>;
}
