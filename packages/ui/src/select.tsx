import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type TextInput } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Button } from "./button.tsx";
import { Chip } from "./chips.tsx";
import { fieldBox } from "./input.tsx";
import { VIRTUALISE, filterOptions, moveIndex, typeAhead, typeAheadBuffer, windowOf } from "./logic/lists.ts";
import { MenuCaption } from "./menu.tsx";
import { Popover } from "./overlay.tsx";
import { Spinner } from "./progress.tsx";
import { SearchField } from "./search.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { densityDefaults, opacity, radius, space } from "./tokens.ts";

export type SelectOption<T extends string = string> = { value: T; label: string; icon?: IconName; description?: string; disabled?: boolean; group?: string };

/** The rows of a listbox: 28 px (44 px at compact-touch density), a check mark on the selected row, group captions, windowed above 50 options. */
export function OptionList<T extends string>(props: {
  options: ReadonlyArray<SelectOption<T>>; selected: readonly T[]; highlighted: number; onHighlight(index: number): void; onSelect(option: SelectOption<T>): void;
  label: string; multiple?: boolean; before?: ReactNode; after?: ReactNode; maxHeight?: number; id?: string;
}) {
  const theme = useTheme();
  const height = densityDefaults[theme.density].row;
  const [scroll, setScroll] = useState(0);
  const viewport = props.maxHeight ?? height * 8;
  const virtual = props.options.length > VIRTUALISE.options;
  // Group captions break the uniform row height, so grouped lists are not windowed.
  const grouped = props.options.some((option) => option.group);
  const range = virtual && !grouped ? windowOf(props.options.length, height, scroll, viewport) : { from: 0, to: props.options.length, before: 0, after: 0 };
  const view = useRef<ScrollView>(null);
  useEffect(() => {
    if (props.highlighted < 0) return;
    const top = props.highlighted * height;
    if (top < scroll) view.current?.scrollTo({ y: top, animated: false });
    else if (top + height > scroll + viewport) view.current?.scrollTo({ y: top + height - viewport, animated: false });
  }, [props.highlighted]); // eslint-disable-line react-hooks/exhaustive-deps
  let group: string | undefined;
  return (
    <ScrollView ref={view} style={{ maxHeight: viewport }} scrollEventThrottle={16} onScroll={(event) => setScroll(event.nativeEvent.contentOffset.y)} keyboardShouldPersistTaps="handled">
      <View role={"listbox" as "list"} aria-label={props.label} accessibilityLabel={props.label} aria-multiselectable={props.multiple || undefined} nativeID={props.id}>
        {props.before}
        {range.before ? <View style={{ height: range.before }} /> : null}
        {props.options.slice(range.from, range.to).map((option, offset) => {
          const index = range.from + offset;
          const on = props.selected.includes(option.value);
          const caption = option.group !== group ? option.group : undefined;
          group = option.group;
          return (
            <View key={option.value}>
              {caption ? <MenuCaption label={caption} /> : null}
              <Tap role="option" label={option.label} selected={on} aria={{ "aria-selected": on, "aria-disabled": option.disabled || undefined }} focusable={false} noRing testID={`option-${option.value}`}
                onPress={() => { if (!option.disabled) props.onSelect(option); }} onHoverIn={() => props.onHighlight(index)}
                style={{ height: option.description ? densityDefaults[theme.density].rowTwoLine : height, paddingHorizontal: theme.touch ? space[4] : space[2], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[2],
                  backgroundColor: index === props.highlighted ? theme.color("bg/hover") : "transparent", opacity: option.disabled ? opacity.disabled : 1 }}>
                {option.icon ? <Icon name={option.icon} size={16} color="text/secondary" /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1}>{option.label}</Text>
                  {option.description ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{option.description}</Text> : null}
                </View>
                {on ? <Icon name="check" size={14} color="text/secondary" /> : null}
              </Tap>
            </View>
          );
        })}
        {range.after ? <View style={{ height: range.after }} /> : null}
        {props.after}
      </View>
    </ScrollView>
  );
}

/** A non-interactive row of a list: "No results", "Loading more…" or an error with "Retry". */
function NoteRow(props: { children: ReactNode; tone?: "danger" }) {
  const theme = useTheme();
  return <View style={{ minHeight: densityDefaults[theme.density].row, paddingHorizontal: theme.touch ? space[4] : space[2], flexDirection: "row", alignItems: "center", gap: space[2] }}>{props.children}</View>;
}

export type SelectProps<T extends string> = {
  options: Array<SelectOption<T>>; value: T | null; onChange(value: T): void; label: string; width?: number; size?: "xs" | "sm" | "md";
  placeholder?: string; disabled?: boolean; invalid?: boolean; forceState?: ForcedState; forceOpen?: boolean;
};

/**
 * A select: the trigger has the geometry, fill and boundary of an input and shows the chosen label with a 14 px chevron; it
 * opens a listbox at least as wide as the trigger and at most 320 px. Typing in a closed select jumps to the first match.
 */
export function Select<T extends string>(props: SelectProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [highlighted, setHighlighted] = useState(-1);
  const [query, setQuery] = useState("");
  const anchor = useRef<View>(null);
  const buffer = useRef(typeAheadBuffer()).current;
  const current = props.options.find((option) => option.value === props.value);
  // On compact form factors the list is a bottom sheet with a search field pinned at the top.
  const options = theme.compact ? filterOptions(props.options, query) : props.options;
  const show = () => { setQuery(""); setHighlighted(Math.max(0, props.options.findIndex((option) => option.value === props.value))); setOpen(true); };
  const choose = (option: SelectOption<T>) => { setOpen(false); if (option.value !== props.value) props.onChange(option.value); };
  const listKey = (key: { key: string; preventDefault(): void; ctrl: boolean; meta: boolean; alt: boolean }) => {
    if (key.key === "Enter" || key.key === " ") { key.preventDefault(); const option = options[highlighted]; if (option && !option.disabled) choose(option); return; }
    const next = moveIndex(highlighted, key.key, options.length, { skip: (index) => Boolean(options[index]!.disabled) });
    if (next !== null) { key.preventDefault(); setHighlighted(next); return; }
    if (key.key.length === 1 && !key.ctrl && !key.meta && !key.alt) { const match = typeAhead(options.map((option) => option.label), buffer.push(key.key), highlighted); if (match !== null) setHighlighted(match); }
  };
  return (
    <View style={{ width: props.width, flexShrink: props.width ? 0 : 1, minWidth: 0 }}>
      <Tap ref={anchor} role="combobox" label={props.label} disabled={props.disabled} expanded={open} forceState={props.forceState} noRing
        aria={{ "aria-haspopup": "listbox", "aria-invalid": props.invalid || undefined }} onPress={show}
        onKeyDown={(key) => {
          if (key.key === "ArrowDown" || key.key === "ArrowUp") { key.preventDefault(); show(); return; }
          if (key.key.length === 1 && key.key !== " " && !key.ctrl && !key.meta && !key.alt) {
            const match = typeAhead(props.options.map((option) => option.label), buffer.push(key.key), props.options.findIndex((option) => option.value === props.value));
            if (match !== null && !props.options[match]!.disabled && props.options[match]!.value !== props.value) props.onChange(props.options[match]!.value);
          }
        }}
        style={(state) => fieldBox(theme, props.size ?? "md", { hovered: state.hovered, focused: state.focused || open, invalid: props.invalid })}>
        {current?.icon ? <Icon name={current.icon} size={14} color="text/secondary" /> : null}
        <Text numberOfLines={1} color={current ? "text/primary" : "text/placeholder"} style={{ flex: 1 }}>{current?.label ?? props.placeholder ?? "—"}</Text>
        <Icon name="chev-d" size={14} color="text/secondary" />
      </Tap>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} matchAnchor label={props.label} title={props.label} role="dialog" initialFocus='[data-testid="listbox-keys"],[role="searchbox"]'>
        {theme.compact ? <View style={{ padding: space[1] }}><SearchField label={props.label} value={query} onChangeText={(text) => { setQuery(text); setHighlighted(0); }} placeholder={theme.t("search")} /></View> : null}
        <Tap testID="listbox-keys" noRing label={props.label} onKeyDown={listKey} style={{ outlineWidth: 0 }}>
          {options.length === 0 ? <NoteRow><Text color="text/secondary">{theme.t("noResults")}</Text></NoteRow>
            : <OptionList options={options} selected={props.value === null ? [] : [props.value]} highlighted={highlighted} onHighlight={setHighlighted} onSelect={choose} label={props.label} />}
        </Tap>
      </Popover>
    </View>
  );
}

export type ComboboxProps<T extends string> = {
  label: string; placeholder?: string; disabled?: boolean; invalid?: boolean; size?: "sm" | "md"; width?: number;
  /** The options, or a function that loads them; a failed load shows the error row with "Retry" and keeps the selection. */
  options: Array<SelectOption<T>> | (() => Promise<Array<SelectOption<T>>>);
  /** One value, or the chosen values of a multi-select, which are shown as removable chips. */
  value: T | null | T[]; onChange(value: T | T[]): void;
  /** Adds the row Create "<query>". */
  onCreate?(query: string): void; forceOpen?: boolean; initialQuery?: string; forceState?: ForcedState;
};

/**
 * A select with a text field that filters the options, case- and diacritic-insensitively, as the user types and highlights
 * the first match. Down/Up move, Enter selects, Escape closes without change.
 */
export function Combobox<T extends string>(props: ComboboxProps<T>) {
  const theme = useTheme();
  const multiple = Array.isArray(props.value);
  const selected = (multiple ? props.value : props.value === null ? [] : [props.value]) as T[];
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [highlighted, setHighlighted] = useState(0);
  const [loaded, setLoaded] = useState<{ status: "idle" | "loading" | "ready" | "error"; options: Array<SelectOption<T>> }>(
    typeof props.options === "function" ? { status: "idle", options: [] } : { status: "ready", options: props.options });
  const anchor = useRef<View>(null);
  const field = useRef<TextInput>(null);
  const source = props.options;
  const load = useMemo(() => () => {
    if (typeof source !== "function") return;
    setLoaded((state) => ({ ...state, status: "loading" }));
    source().then((options) => setLoaded({ status: "ready", options }), () => setLoaded((state) => ({ ...state, status: "error" })));
  }, [source]);
  useEffect(() => { if (typeof source !== "function") setLoaded({ status: "ready", options: source }); }, [source]);
  useEffect(() => { if (open && loaded.status === "idle") load(); }, [open, loaded.status, load]);
  const matches = filterOptions(loaded.options, query);
  const creatable = Boolean(props.onCreate) && query.trim() !== "" && !loaded.options.some((option) => option.label.toLowerCase() === query.trim().toLowerCase());
  const labelOf = (value: T) => loaded.options.find((option) => option.value === value)?.label ?? value;
  const choose = (option: SelectOption<T>) => {
    if (multiple) props.onChange(selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value]);
    else { props.onChange(option.value); setOpen(false); }
    setQuery("");
    setHighlighted(0);
  };
  const single = !multiple && selected[0] !== undefined ? labelOf(selected[0]) : undefined;
  return (
    <View style={{ width: props.width, minWidth: 0, flexShrink: props.width ? 0 : 1 }}>
      <Tap ref={anchor} role="combobox" label={props.label} expanded={open} disabled={props.disabled} forceState={props.forceState} noRing aria={{ "aria-haspopup": "listbox", "aria-invalid": props.invalid || undefined }} onPress={() => setOpen(true)}
        onKeyDown={(key) => { if (key.key === "ArrowDown") { key.preventDefault(); setOpen(true); } }}
        style={(state) => [fieldBox(theme, props.size ?? "md", { hovered: state.hovered, focused: state.focused || open, invalid: props.invalid }), multiple && selected.length ? { height: undefined, minHeight: fieldBox(theme, props.size ?? "md", {}).height, flexWrap: "wrap", paddingVertical: space[1] } : null]}>
        {multiple ? selected.map((value) => <Chip key={value} label={labelOf(value)} onRemove={() => props.onChange(selected.filter((item) => item !== value))} />) : null}
        <Text numberOfLines={1} color={single ? "text/primary" : "text/placeholder"} style={{ flex: 1 }}>{single ?? (multiple && selected.length ? "" : props.placeholder ?? "")}</Text>
        <Icon name="chev-d" size={14} color="text/secondary" />
      </Tap>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} matchAnchor label={props.label} title={props.label} initialFocus='[role="searchbox"]'>
        <View style={{ padding: space[1] }}>
          <SearchField label={props.label} size="sm" value={query} debounce={0} inputRef={field} placeholder={theme.t("search")} resultCount={loaded.status === "ready" ? matches.length : null}
            onChangeText={(text) => { setQuery(text); setHighlighted(0); }} onEscape={() => setOpen(false)}
            />
        </View>
        <View>
          <View>
            {loaded.status === "error" ? (
              <NoteRow><Icon name="warn" size={14} color="danger" /><Text color="danger/text" style={{ flex: 1 }}>{theme.t("optionsFailed")}</Text><Button kind="link" label={theme.t("retry")} onPress={load} /></NoteRow>
            ) : matches.length === 0 && !creatable && loaded.status === "ready" ? (
              <NoteRow><Text color="text/secondary">{theme.t("noResults")}</Text></NoteRow>
            ) : (
              <OptionList options={matches} selected={selected} highlighted={highlighted} onHighlight={setHighlighted} onSelect={choose} label={props.label} multiple={multiple}
                after={<>
                  {loaded.status === "loading" ? <NoteRow><Spinner size={12} /><Text color="text/secondary">{theme.t("loadingMore")}</Text></NoteRow> : null}
                  {creatable ? (
                    <Tap role="option" label={theme.t("create", { query: query.trim() })} focusable={false} noRing onPress={() => { props.onCreate!(query.trim()); setQuery(""); if (!multiple) setOpen(false); }}
                      style={{ height: densityDefaults[theme.density].row, paddingHorizontal: theme.touch ? space[4] : space[2], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: highlighted === matches.length ? theme.color("bg/hover") : "transparent" }}>
                      <Icon name="plus" size={14} color="text/secondary" /><Text>{theme.t("create", { query: query.trim() })}</Text>
                    </Tap>
                  ) : null}
                </>} />
            )}
          </View>
        </View>
        <ComboKeys field={field} count={matches.length + (creatable ? 1 : 0)} highlighted={highlighted} onHighlight={setHighlighted}
          onEnter={() => { const option = matches[highlighted]; if (option && !option.disabled) choose(option); else if (creatable && highlighted === matches.length) { props.onCreate!(query.trim()); setQuery(""); if (!multiple) setOpen(false); } }} />
      </Popover>
    </View>
  );
}

/** Keeps focus in the search field while Down/Up/Home/End move the highlight and Enter selects it. */
function ComboKeys(props: { field: { current: TextInput | null }; count: number; highlighted: number; onHighlight(index: number): void; onEnter(): void }) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const node = props.field.current as unknown as { addEventListener?(type: string, listener: (event: KeyboardEvent) => void): void; removeEventListener?(type: string, listener: (event: KeyboardEvent) => void): void } | null;
    if (!node?.addEventListener) return;
    const listener = (event: KeyboardEvent) => {
      const now = latest.current;
      if (event.key === "Enter") { event.preventDefault(); now.onEnter(); return; }
      const next = moveIndex(now.highlighted, event.key, now.count);
      if (next !== null && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); now.onHighlight(next); }
    };
    node.addEventListener("keydown", listener);
    return () => node.removeEventListener?.("keydown", listener);
  });
  return null;
}
