import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TextInput, StyleProp, ViewStyle } from "react-native";
import { View, StyleSheet } from "react-native";
import { IconButton } from "./button.tsx";
import { Input } from "./input.tsx";
import type { ForcedState } from "./tap.tsx";
import { LOADING, debouncer } from "./logic/timers.ts";
import { Spinner, useElapsed } from "./progress.tsx";
import { resultCount } from "./strings.ts";
import { Announce } from "./text.tsx";
import { useTheme } from "./theme.tsx";

export type SearchFieldProps = {
  /** Accessible name, supplied by the caller: "Search projects". */
  label: string; value: string; onChangeText(value: string): void;
  /** Fires `debounce` ms after the last change (200 by default), at once on Enter, and with "" when cleared. */
  onSearch?(query: string): void; debounce?: number; placeholder?: string; size?: "xs" | "sm" | "md";
  loading?: boolean; resultCount?: number | null; trailing?: ReactNode;
  /** In a toolbar on compact form factors: an icon button that expands to the full width of the bar. */
  collapsible?: boolean; onExpandedChange?(expanded: boolean): void;
  /** Called for an Escape the field did not use, i.e. when it was already empty. */
  onEscape?(): void; autoFocus?: boolean; forceState?: ForcedState; disabled?: boolean; style?: StyleProp<ViewStyle>; inputRef?: { current: TextInput | null };
};

/** The one search input of the product: `searchbox` role, leading 14 px search icon, clear button, debounce, announced result count. */
export function SearchField(props: SearchFieldProps) {
  const theme = useTheme();
  const { onSearch } = props;
  const latest = useRef(onSearch);
  latest.current = onSearch;
  const debounced = useMemo(() => debouncer((query: string) => latest.current?.(query), props.debounce ?? 200), [props.debounce]);
  useEffect(() => () => debounced.cancel(), [debounced]);
  const spinning = useElapsed(Boolean(props.loading), LOADING.searchSpinner);
  const [open, setOpen] = useState(false);
  const collapsed = props.collapsible && theme.compact && !open && props.value === "";
  if (collapsed) return <IconButton icon="search" label={props.label} expanded={false} onPress={() => { setOpen(true); props.onExpandedChange?.(true); }} />;
  const change = (text: string) => { props.onChangeText(text); debounced.call(text); };
  const clear = () => { debounced.cancel(); props.onChangeText(""); latest.current?.(""); };
  // A caller that gives the field a width means that width: growing anyway pushed neighbouring tabs out of sight.
  return (
    <View style={[typeof StyleSheet.flatten(props.style)?.width === "number" ? { flexGrow: 0, flexShrink: 1, minWidth: 0 } : { flexGrow: 1, flexShrink: 1, minWidth: 0 }, props.style]}>
      <Input role="searchbox" ownsEscape={props.value !== ""} forceState={props.forceState} disabled={props.disabled} accessibilityLabel={props.label} placeholder={props.placeholder} value={props.value} size={props.size} onChangeText={change} inputRef={props.inputRef}
        autoFocus={props.autoFocus ?? (props.collapsible && open)} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
        leading={spinning ? <Spinner size={14} /> : undefined} leadingIcon="search" clearable clearAlways clearLabel={theme.t("clearSearch")} onClear={clear} trailing={props.trailing}
        onSubmitEditing={() => debounced.flush()}
        onBlur={() => { if (props.collapsible && props.value === "") { setOpen(false); props.onExpandedChange?.(false); } }}
        onKey={(key) => {
          if (key.key === "Enter") { debounced.cancel(); latest.current?.(props.value); }
          if (key.key !== "Escape") return;
          // The first Escape clears a non-empty field and goes no further; a second one is left to the surrounding surface.
          if (props.value !== "") { key.preventDefault(); key.stopPropagation?.(); clear(); } else props.onEscape?.();
        }} />
      {props.resultCount === null || props.resultCount === undefined ? null : <Announce>{resultCount(theme.t, props.resultCount)}</Announce>}
    </View>
  );
}
