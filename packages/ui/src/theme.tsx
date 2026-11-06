import type React from "react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { I18nManager, View, useColorScheme, useWindowDimensions, type ViewStyle } from "react-native";
import { defaultStorage, directionOfDocument, hasDom, osName, setInert, setThemeColor, watchCoarsePointer, watchHidden, watchReducedMotion } from "./platform/dom";
import type { OsName, PreferenceStorage } from "./platform/types.ts";
import { translator, type Translate } from "./strings.ts";
import {
  breakpointOf, densityOf, elevationLayer, elevationShadow, fontFamily, formFactorOf, motion, needsJapaneseFace, palettes, resolveColor,
  typography, zIndex, type Breakpoint, type ColorToken, type Density, type ElevationLevel, type FormFactor, type Scheme, type TypeStyle, type TypeToken,
} from "./tokens.ts";
import { applyScheme } from "./unistyles.ts";

export type { Density, FormFactor };
export type ThemePreference = "system" | "light" | "dark";
export const THEME_PREFERENCE_KEY = "jagentchill.theme";

export type Theme = {
  scheme: Scheme;
  preference: ThemePreference;
  setPreference(preference: ThemePreference): void;
  /** `touch` is the compact-touch density: compact form factor or a coarse primary pointer. Decides sizes. */
  density: Density;
  /** Decided by viewport width only. Decides layout and presentation. */
  formFactor: FormFactor;
  breakpoint: Breakpoint;
  /** True on compact form factors: the single-column layout. */
  compact: boolean;
  width: number;
  height: number;
  /** True where controls revealed on hover must always be visible, and tooltips become long-press labels. */
  touch: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
  underlineLinks: boolean;
  os: OsName;
  locale: string;
  rtl: boolean;
  hour12: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  firstDayOfWeek: number;
  minToastMs: number;
  t: Translate;
  color(token: ColorToken): string;
  type(token: TypeToken, text?: string): TypeStyle & { fontFamily: string; letterSpacing: 0 };
  elevation(level: ElevationLevel): ViewStyle;
  /** A transition duration: translations and scales collapse to an opacity fade of at most 120 ms under reduced motion. */
  duration(token: "fast" | "base" | "slow" | "exit"): number;
};

/** Shadow of an elevation token. In the dark theme every elevated surface also carries a hairline border. */
export function elevation(level: ElevationLevel, scheme: Scheme = "light"): ViewStyle {
  if (level === 0) return {};
  const layer = elevationLayer(level, scheme);
  return {
    boxShadow: elevationShadow(level, scheme), elevation: level * 3,
    ...(scheme === "dark" ? { borderWidth: 1, borderColor: palettes.dark["border/hairline"] } : null),
    ...(hasDom ? null : { shadowColor: palettes.light["strong"], shadowOpacity: layer.alpha, shadowRadius: layer.blur / 2, shadowOffset: { width: 0, height: layer.offsetY } }),
  } as ViewStyle;
}

export type HostGate = { connected: boolean; onRequiresHost(feature?: string): void };
/** Looks up the current binding of an action as display keys, e.g. `["Mod", "B"]`; null when unbound. */
export type ShortcutLookup = (actionId: string) => string[] | null;

type Layer = { id: number; z: number; modal: boolean; node: ReactNode };
type Overlays = { set(layer: Layer): void; remove(id: number): void };

const ThemeContext = createContext<Theme | null>(null);
const OverlayContext = createContext<Overlays | null>(null);
const HostGateContext = createContext<HostGate>({ connected: true, onRequiresHost: () => {} });
const ShortcutContext = createContext<{ lookup: ShortcutLookup; version: number }>({ lookup: () => null, version: 0 });
/** Stacking order of the surface a component is rendered in: a surface opened from it goes above it whatever its own token. */
const LayerContext = createContext(0);

export type ThemeProviderProps = {
  children: ReactNode;
  /** Forces a theme regardless of preference and OS, for previews and tests. */
  scheme?: Scheme;
  /** Controlled preference; when absent the provider keeps it and persists it in `storage`. */
  preference?: ThemePreference;
  onPreferenceChange?(preference: ThemePreference): void;
  storage?: PreferenceStorage;
  density?: Density;
  /** Viewport size override, for catalogue frames that render a form factor inside a larger window. */
  viewport?: { width: number; height: number };
  reduceMotion?: boolean;
  increaseContrast?: boolean;
  underlineLinks?: boolean;
  locale?: string;
  rtl?: boolean;
  hour12?: boolean;
  firstDayOfWeek?: number;
  minToastMs?: number;
  os?: OsName;
  host?: HostGate;
  shortcuts?: ShortcutLookup;
  /** Changes whenever a binding changes, so hints re-read the lookup. */
  shortcutsVersion?: number;
};

const firstDay = (locale: string) => {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?(): { firstDay: number } };
    const day = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (day) return day % 7;
  } catch { /* unknown locale: fall through */ }
  return /^(en-US|en$|ja|pt-BR|he|ar-SA|zh)/i.test(locale) ? 0 : 1;
};
const usesHour12 = (locale: string) => {
  try { return new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12 ?? false; } catch { return false; }
};

/** The token, preference and overlay root. `ThemeProvider` of `provider.tsx` adds the toast viewport to it. */
export function ThemeRoot(props: ThemeProviderProps) {
  const system = useColorScheme();
  const window = useWindowDimensions();
  const storage = props.storage ?? defaultStorage;
  const [stored, setStored] = useState<ThemePreference>(() => {
    const value = storage.get(THEME_PREFERENCE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  });
  const [coarse, setCoarse] = useState(!hasDom);
  const [osReduce, setOsReduce] = useState(false);
  useEffect(() => watchCoarsePointer(setCoarse), []);
  useEffect(() => watchReducedMotion(setOsReduce), []);

  const preference = props.preference ?? stored;
  const scheme: Scheme = props.scheme ?? (preference === "system" ? (system === "dark" ? "dark" : "light") : preference);
  const { onPreferenceChange } = props;
  const setPreference = useCallback((next: ThemePreference) => {
    storage.set(THEME_PREFERENCE_KEY, next);
    setStored(next);
    onPreferenceChange?.(next);
  }, [storage, onPreferenceChange]);

  const width = props.viewport?.width ?? window.width;
  const height = props.viewport?.height ?? window.height;
  const locale = props.locale ?? "en";
  const reduceMotion = props.reduceMotion ?? osReduce;
  const increaseContrast = props.increaseContrast ?? false;
  const density = props.density ?? densityOf(width, coarse);
  const theme = useMemo<Theme>(() => {
    const formFactor = formFactorOf(width);
    return {
      scheme, preference, setPreference, density, formFactor, breakpoint: breakpointOf(width), compact: formFactor === "compact", width, height,
      touch: density === "touch", reduceMotion, increaseContrast, underlineLinks: props.underlineLinks ?? false,
      os: props.os ?? osName(), locale, rtl: props.rtl ?? (hasDom ? directionOfDocument() === "rtl" : I18nManager.isRTL),
      hour12: props.hour12 ?? usesHour12(locale), firstDayOfWeek: props.firstDayOfWeek ?? firstDay(locale), minToastMs: props.minToastMs ?? 0,
      t: translator(locale),
      color: (token) => resolveColor(scheme, token, increaseContrast),
      type: (token, text) => ({
        ...typography[token][density], letterSpacing: 0,
        fontFamily: token === "mono" ? fontFamily.mono : needsJapaneseFace(locale, text) ? fontFamily.uiJa : fontFamily.ui,
      }),
      elevation: (level) => ({ ...elevation(level, scheme), ...(scheme === "dark" && level > 0 ? { borderColor: resolveColor(scheme, "border/hairline", increaseContrast) } : null) }),
      duration: (token) => (reduceMotion ? Math.min(motion[token], motion.reducedFade) : motion[token]),
    };
  }, [scheme, preference, setPreference, density, width, height, reduceMotion, increaseContrast, props.underlineLinks, props.os, locale, props.rtl, props.hour12, props.firstDayOfWeek, props.minToastMs]);

  useEffect(() => { applyScheme(scheme); setThemeColor(theme.color("bg/app")); }, [scheme, theme]);

  const [layers, setLayers] = useState<Layer[]>([]);
  const overlays = useMemo<Overlays>(() => ({
    set: (layer) => setLayers((list) => [...list.filter((item) => item.id !== layer.id), layer].sort((a, b) => a.z - b.z || a.id - b.id)),
    remove: (id) => setLayers((list) => list.filter((item) => item.id !== id)),
  }), []);
  const appRef = useRef<View>(null);
  const topModal = layers.findLast((layer) => layer.modal);
  // The page behind a modal surface is inert; surfaces above it (toasts, tooltips) stay live.
  useEffect(() => { setInert(appRef.current, Boolean(topModal)); }, [topModal]);
  const shortcuts = useMemo(() => ({ lookup: props.shortcuts ?? (() => null), version: props.shortcutsVersion ?? 0 }), [props.shortcuts, props.shortcutsVersion]);
  const gate = useMemo(() => props.host ?? { connected: true, onRequiresHost: () => {} }, [props.host]);

  // On the web the `start` / `end` style properties are resolved from the direction the tree DECLARES (react-native-web
  // reads the nearest `dir`), not from the document: without it a right-to-left page keeps its inline-start borders and
  // paddings on the left. Native takes the direction from I18nManager.
  const direction = theme.rtl && hasDom ? ({ dir: "rtl" } as object) : null;

  return (
    <ThemeContext.Provider value={theme}>
      <HostGateContext.Provider value={gate}>
        <ShortcutContext.Provider value={shortcuts}>
          <OverlayContext.Provider value={overlays}>
            <View ref={appRef} {...direction} style={FILL} importantForAccessibility={topModal ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={Boolean(topModal)}>{props.children}</View>
            {layers.map((layer) => (
              <View key={layer.id} {...direction} pointerEvents="box-none" style={[ABSOLUTE, { zIndex: layer.z }]}
                ref={(node) => setInert(node, Boolean(topModal && layer.modal && layer !== topModal && layer.z <= topModal.z))}>
                {layer.node}
              </View>
            ))}
          </OverlayContext.Provider>
        </ShortcutContext.Provider>
      </HostGateContext.Provider>
    </ThemeContext.Provider>
  );
}

const FILL: ViewStyle = { flex: 1 };
const ABSOLUTE: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme needs a ThemeProvider");
  return theme;
}
/**
 * Draws a subtree with the colour tokens of one scheme whatever the app's theme is — the preview and timeline of the
 * phone editor are on the dark editor surface in both themes. Overlays opened from inside keep the app's theme.
 */
export function SchemeScope(props: { scheme: Scheme; children: ReactNode }) {
  const theme = useTheme();
  const scoped = useMemo<Theme>(() => (theme.scheme === props.scheme ? theme : {
    ...theme, scheme: props.scheme,
    color: (token) => resolveColor(props.scheme, token, theme.increaseContrast),
    elevation: (level) => ({ ...elevation(level, props.scheme), ...(props.scheme === "dark" && level > 0 ? { borderColor: resolveColor(props.scheme, "border/hairline", theme.increaseContrast) } : null) }),
  }), [theme, props.scheme]);
  return <ThemeContext.Provider value={scoped}>{props.children}</ThemeContext.Provider>;
}
export const useHostGate = () => useContext(HostGateContext);
/** Display keys of an action's current binding. Re-reads when bindings change. */
export function useShortcut(actionId: string | undefined): string[] | null {
  const { lookup } = useContext(ShortcutContext);
  return actionId ? lookup(actionId) : null;
}

/** Contexts that content rendered in the overlay stack must still see, e.g. the toast queue inside a modal. */
const carried: Array<React.Context<unknown>> = [];
export function carryThroughPortals<T>(context: React.Context<T>): void { carried.push(context as React.Context<unknown>); }

let nextLayer = 1;
/**
 * Renders its children in the overlay stack of the provider, above the page, at a stacking-order token.
 *
 * An overlay never outlives the screen that owns it. When a navigator hides or freezes that screen, the overlay (scrim
 * included) leaves the stack at once, whatever exit animation its owner had started and can no longer finish; it
 * returns with the screen if it is still open then. Two signals cover the ways a screen is put away: React disconnects
 * the layout effects of a hidden tree, and on the web a marker left in the owner's tree stops being drawn.
 */
export function Portal(props: { layer: keyof typeof zIndex; modal?: boolean; /** Called when the owner's screen is hidden and when it is shown again, so the owner can let go of what it holds page-wide. */ onOwnerHidden?(hidden: boolean): void; children: ReactNode }) {
  const overlays = useContext(OverlayContext);
  const theme = useTheme();
  const gate = useContext(HostGateContext);
  const shortcuts = useContext(ShortcutContext);
  const [id] = useState(() => nextLayer++);
  const parent = useContext(LayerContext);
  if (!overlays) throw new Error("Portal needs a ThemeProvider");
  const z = Math.max(zIndex[props.layer], parent + 1);
  // The list is fixed at module load, so the hook order is stable.
  const values = carried.map((context) => useContext(context)); // eslint-disable-line react-hooks/rules-of-hooks
  const content = carried.reduceRight<ReactNode>((inner, Context, index) => <Context.Provider value={values[index]}>{inner}</Context.Provider>, props.children);
  const marker = useRef<View>(null);
  const latest = useRef<Layer | null>(null);
  const ownerHidden = useRef(false);
  const notify = useRef(props.onOwnerHidden);
  notify.current = props.onOwnerHidden;
  useLayoutEffect(() => {
    // The nearest theme travels with the content, so a surface opened inside a nested provider keeps its tokens.
    latest.current = { id, z, modal: Boolean(props.modal), node: (
      <ThemeContext.Provider value={theme}><HostGateContext.Provider value={gate}><ShortcutContext.Provider value={shortcuts}><LayerContext.Provider value={z}>{content}</LayerContext.Provider></ShortcutContext.Provider></HostGateContext.Provider></ThemeContext.Provider>
    ) };
    if (!ownerHidden.current) overlays.set(latest.current);
  });
  useLayoutEffect(() => {
    const stop = watchHidden(() => marker.current, (hidden) => {
      ownerHidden.current = hidden;
      if (hidden) overlays.remove(id); else if (latest.current) overlays.set(latest.current);
      notify.current?.(hidden);
    });
    return () => { stop(); overlays.remove(id); };
  }, [overlays, id]);
  // Takes no room and draws nothing: it only says whether this place in the page is drawn.
  return <View ref={marker} pointerEvents="none" aria-hidden style={{ position: "absolute", width: 0, height: 0 }} />;
}
