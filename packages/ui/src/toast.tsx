import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { liveRegionOf, toastStore, type Toast, type ToastKind, type ToastStore } from "./logic/toast.ts";
import { useInsets } from "./overlay.tsx";
import { ProgressBar, Spinner } from "./progress.tsx";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { Portal, carryThroughPortals, useTheme } from "./theme.tsx";
import { radius, size, space } from "./tokens.ts";

export type { Toast, ToastInput, ToastKind, ToastStore } from "./logic/toast.ts";

const ToastContext = createContext<ToastStore | null>(null);
// A dialog is drawn in the overlay stack, outside the toast root: the queue travels with it.
carryThroughPortals(ToastContext);
/** `show`, `update`, `dismiss` and `undo` of the toast queue. */
export function useToast(): ToastStore {
  const store = useContext(ToastContext);
  if (!store) throw new Error("useToast needs a ThemeProvider");
  return store;
}

// The four statuses are told apart by shape: check, "i", triangle and cross.
const ICONS: Record<Exclude<ToastKind, "progress">, IconName> = { success: "check-c", info: "info", warning: "warn", error: "x-c" };

/** One toast: an inverse pill in `strong` with `text/on-strong`, in both themes. Hover or focus pauses its timer; a horizontal swipe dismisses it on touch. */
export function ToastView(props: { toast: Toast; store?: ToastStore }) {
  const theme = useTheme();
  const { toast, store } = props;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => { if (Math.abs(gesture.dx) > 48) store?.dismiss(toast.id); },
  }), [store, toast.id]);
  const message = toast.count > 1 ? theme.t("repeated", { message: toast.message, n: toast.count }) : toast.message;
  const action = toast.undo ? { label: theme.t("undo"), onPress: () => void store?.undo(toast.id) } : toast.action ? { label: toast.action.label, onPress: () => { toast.action!.onPress(); store?.dismiss(toast.id); } } : null;
  return (
    <Pressable {...pan.panHandlers} accessible={false} focusable={false} testID="toast"
      onHoverIn={() => store?.pause(toast.id)} onHoverOut={() => store?.resume(toast.id)} {...({ onFocus: () => store?.pause(toast.id), onBlur: () => store?.resume(toast.id) } as object)}
      style={[{ minWidth: size.toastMin, maxWidth: size.toastMax, backgroundColor: theme.color("strong"), borderRadius: radius.md, paddingVertical: space[2] + space[0.5], paddingHorizontal: space[3], gap: space[2] }, theme.elevation(2), { borderWidth: 0 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        {toast.kind === "progress" ? <Spinner size={14} color="text/on-strong" /> : <Icon name={ICONS[toast.kind]} size={16} color="text/on-strong" />}
        <Text color="text/on-strong" numberOfLines={2} live={liveRegionOf(toast.kind)} role={toast.kind === "error" ? "alert" : "status"} style={{ flex: 1 }}>{message}</Text>
        {action ? <Tap role="button" label={action.label} onPress={action.onPress} style={{ borderRadius: radius.xs, marginStart: space[2] }}><Text variant="body-medium" color="text/on-strong" underline>{action.label}</Text></Tap> : null}
        <Tap role="button" label={theme.t("dismiss")} onPress={() => store?.dismiss(toast.id)} target style={{ borderRadius: radius.full }}><Icon name="x" size={14} color="text/on-strong" /></Tap>
      </View>
      {toast.kind === "progress" ? <ProgressBar thin value={toast.progress ?? null} label={toast.message} tone="text/on-strong" track="strong/hover" /> : null}
    </Pressable>
  );
}

/** The stack of visible toasts: bottom right on medium and wide form factors, bottom centre above the safe area and any docked toolbar on compact ones. */
// Toolbars docked at the bottom edge by a screen, by height: the toasts clear the tallest while it is mounted.
const docked = new Set<{ height: number }>(), dockedListeners = new Set<() => void>();
const dockedHeight = (): number => Math.max(0, ...[...docked].map((entry) => entry.height));
const dockedChanged = (): void => { for (const listener of [...dockedListeners]) listener(); };
/** A toolbar or sheet docked at the bottom edge of the screen (the tool strip of the phone editor): toasts are drawn above it while it is mounted. */
export function useToastClearance(height: number): void {
  useEffect(() => { const entry = { height }; docked.add(entry); dockedChanged(); return () => { docked.delete(entry); dockedChanged(); }; }, [height]);
}
function ToastViewport(props: { store: ToastStore; bottomOffset: number }) {
  const theme = useTheme();
  const insets = useInsets();
  const all = useSyncExternalStore(props.store.subscribe, props.store.all, props.store.all);
  const clearance = useSyncExternalStore((listener) => { dockedListeners.add(listener); return () => { dockedListeners.delete(listener); }; }, dockedHeight, dockedHeight);
  const visible = all.filter((toast) => toast.visible);
  if (visible.length === 0) return null;
  return (
    <Portal layer="toast">
      <View pointerEvents="box-none" style={{ position: "absolute", start: theme.compact ? size.toastEdge : undefined, end: size.toastEdge, bottom: size.toastEdge + insets.bottom + props.bottomOffset + clearance, alignItems: theme.compact ? "center" : "flex-end", gap: space[2] }}>
        {visible.map((toast) => <ToastView key={toast.id} toast={toast} store={props.store} />)}
      </View>
    </Portal>
  );
}

/** Owns the toast queue of the app and draws its viewport above modals. Part of `ThemeProvider`. */
export function ToastRoot(props: { children: ReactNode; bottomOffset?: number; onPersist?(toast: Toast): void }) {
  const theme = useTheme();
  const persist = useRef(props.onPersist);
  persist.current = props.onPersist;
  const strings = useRef({ restored: theme.t("restored"), undoFailed: theme.t("undoFailed") });
  strings.current.restored = theme.t("restored"); strings.current.undoFailed = theme.t("undoFailed");
  const store = useMemo(() => toastStore({ minDuration: theme.minToastMs, strings: strings.current, onPersist: (toast) => persist.current?.(toast) }), [theme.minToastMs]);
  return <ToastContext.Provider value={store}>{props.children}<ToastViewport store={store} bottomOffset={props.bottomOffset ?? 0} /></ToastContext.Provider>;
}
