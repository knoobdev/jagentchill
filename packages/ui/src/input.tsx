import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Pressable, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { textareaHeight } from "./logic/content.ts";
import type { KeyInfo } from "./platform/types.ts";
import { Tap, keyOf, type ForcedState, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme, type Theme } from "./theme.tsx";
import { borderWidth, controlHeight, opacity, radius, space, type ColorToken } from "./tokens.ts";

export type FieldState = { hovered?: boolean; focused?: boolean; invalid?: boolean; disabled?: boolean; readOnly?: boolean };
/**
 * The box every field shares: radius 6, `bg/app`, 1 px `border/control`; hover draws the border in `text/primary`, focus is a
 * 2 px `accent` border and invalid a 2 px `danger` border. The padding shrinks with the border so the content does not move.
 */
export function fieldBox(theme: Theme, sizeToken: "xs" | "sm" | "md", state: FieldState, padding: number = space[2] + space[0.5]): ViewStyle {
  const thick = state.invalid || state.focused;
  const width = thick ? borderWidth.focus : borderWidth.hairline;
  const border: ColorToken = state.invalid ? "danger" : state.focused ? "accent" : state.hovered ? "text/primary" : "border/control";
  return {
    height: controlHeight(sizeToken, theme.density), borderRadius: radius.sm, borderWidth: width, borderColor: theme.color(border),
    paddingHorizontal: padding - width, backgroundColor: theme.color(state.readOnly ? "bg/inset" : "bg/app"),
    flexDirection: "row", alignItems: "center", gap: space[1.5], opacity: state.disabled ? opacity.disabled : 1, minWidth: 0,
  };
}

/** The error line below a field: a 14 px error icon and a `danger/text` message, announced when it appears. */
export function FieldError(props: { message: string; id?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], marginTop: space[1] }}>
      <Icon name="x-c" size={14} color="danger" />
      <Text variant="meta" color="danger/text" nativeID={props.id} live="polite" role="alert" style={{ flex: 1 }}>{props.message}</Text>
    </View>
  );
}

export type InputProps = Omit<TextInputProps, "style"> & {
  invalid?: boolean; mono?: boolean; size?: "xs" | "sm" | "md"; style?: StyleProp<ViewStyle>;
  leadingIcon?: IconName; leading?: ReactNode; trailingIcon?: IconName; trailing?: ReactNode; prefix?: string; suffix?: string;
  /** Shows a clear button when the field is non-empty and focused or hovered; always at compact-touch density or with `clearAlways`. */
  clearable?: boolean; clearAlways?: boolean; clearLabel?: string; onClear?(): void;
  /** Shows "n / max" at the end of the field. */
  counter?: boolean; error?: string; disabled?: boolean; readOnly?: boolean; forceState?: ForcedState;
  onKey?(key: KeyInfo): void; inputRef?: Ref<TextInput>; labelledBy?: string; describedBy?: string; role?: "searchbox" | "combobox" | "spinbutton";
  aria?: Record<string, unknown>;
  /** The field uses Escape itself, e.g. to clear its value: surfaces around it do not close on that press. */
  ownsEscape?: boolean;
};

/** A single-line field. With `multiline` it is the plain multi-line box; `Textarea` adds auto-grow. */
export function Input(props: InputProps) {
  const theme = useTheme();
  const { invalid, mono, size: sizeToken, style, leadingIcon, leading, trailingIcon, trailing, prefix, suffix, clearable, clearAlways, clearLabel, onClear, counter, error, disabled, readOnly, forceState, onKey, inputRef, labelledBy, describedBy, role, aria, ownsEscape, ...rest } = props;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const own = useRef<TextInput | null>(null);
  const errorId = useId();
  const value = rest.value ?? "";
  const bad = Boolean(invalid || error);
  const isReadOnly = Boolean(readOnly || rest.editable === false) && !disabled;
  const state = { hovered: forceState === "hover" || hovered, focused: forceState === "focus" || focused, invalid: bad, disabled, readOnly: isReadOnly };
  const showClear = clearable && value.length > 0 && !disabled && !isReadOnly && (clearAlways || theme.touch || focused || hovered);
  const type = theme.type(mono ? "mono" : "body", value);
  const box = fieldBox(theme, sizeToken ?? "md", state);
  // tabIndex -1: react-native-web's Pressable is a tab stop unless told otherwise (`focusable={false}` alone is not enough),
  // which put a nameless stop in front of every field.
  const field = (
    <Pressable onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPress={() => own.current?.focus()} accessible={false} focusable={false} tabIndex={-1}
      style={[box, rest.multiline ? { height: undefined, flexGrow: 1, alignItems: "flex-start", paddingVertical: space[2] - (box.borderWidth as number) } : null]}>
      {leading ?? (leadingIcon ? <Icon name={leadingIcon} size={14} color="text/secondary" /> : null)}
      {prefix ? <Text color="text/secondary">{prefix}</Text> : null}
      <TextInput placeholderTextColor={theme.color("text/placeholder")} {...rest}
        ref={(node) => { own.current = node; if (typeof inputRef === "function") inputRef(node); else if (inputRef) (inputRef as { current: TextInput | null }).current = node; }}
        editable={!disabled && !isReadOnly} readOnly={isReadOnly} aria-invalid={bad || undefined} aria-labelledby={labelledBy} aria-describedby={error ? errorId : describedBy} aria-disabled={disabled || undefined}
        {...({ role, ...aria, "data-escape": ownsEscape ? "" : undefined, onKeyPress: onKey ? (event: KeyEvent) => onKey(keyOf(event)) : undefined } as object)}
        onFocus={(event) => { setFocused(true); rest.onFocus?.(event); }} onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
        style={[type, { flex: 1, minWidth: 0, alignSelf: "stretch", color: theme.color("text/primary"), outlineWidth: 0, padding: 0, textAlignVertical: rest.multiline ? "top" : "center" }]} />
      {suffix ? <Text color="text/secondary">{suffix}</Text> : null}
      {counter && rest.maxLength ? <Text variant="meta" color="text/secondary" tabular>{theme.t("characters", { n: value.length.toLocaleString(theme.locale), max: rest.maxLength.toLocaleString(theme.locale) })}</Text> : null}
      {showClear ? (
        <Tap role="button" label={clearLabel ?? theme.t("clear")} target style={{ borderRadius: radius.full }}
          onPress={() => { if (onClear) onClear(); else rest.onChangeText?.(""); own.current?.focus(); }}>
          <Icon name="x" size={14} color="text/secondary" />
        </Tap>
      ) : null}
      {trailing ?? (trailingIcon ? <Icon name={trailingIcon} size={14} color="text/secondary" /> : null)}
    </Pressable>
  );
  // One structure with and without an error, so the field keeps its focus and caret when the message appears.
  return <View style={[WRAP, style]}>{field}{error ? <FieldError message={error} id={errorId} /> : null}</View>;
}

/** A multi-line field that grows from 2 lines to `maxLines` (8 by default) and then scrolls. */
export function Textarea(props: Omit<InputProps, "multiline" | "size"> & { minLines?: number; maxLines?: number }) {
  const theme = useTheme();
  const { minLines, maxLines, style, ...rest } = props;
  const lineHeight = theme.type(props.mono ? "mono" : "body").lineHeight;
  const breaks = (props.value ?? "").split("\n").length;
  const [measured, setMeasured] = useState(breaks);
  // The box is as tall as its lines; past the limit it stays there and the text scrolls.
  const grown = textareaHeight(Math.max(measured, breaks), lineHeight, 2 * space[2], minLines ?? 2, maxLines ?? 8);
  return (
    <Input {...rest} multiline scrollEnabled={grown.scrolls} style={[{ height: grown.height }, style]}
      onContentSizeChange={(event) => { setMeasured(Math.max(1, Math.round(event.nativeEvent.contentSize.height / lineHeight))); rest.onContentSizeChange?.(event); }} />
  );
}

export type FieldIds = { labelledBy: string; describedBy: string | undefined; invalid: boolean; error: string | undefined; onBlur(): void };
/**
 * Wraps a control with a label, an optional description and an error message, and links them for assistive technology.
 * With `validate`, the message appears on blur or submit — not on every keystroke — and clears as soon as the value is valid.
 */
export function FormField(props: {
  label: string; description?: string; error?: string; required?: boolean; value?: unknown; validate?(value: unknown): string | undefined | null;
  /** Increment to validate now, e.g. on submit. */
  submitCount?: number; children: ReactNode | ((ids: FieldIds) => ReactNode);
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const problem = props.validate ? props.validate(props.value) || undefined : undefined;
  useEffect(() => { if (props.submitCount) setTouched(true); }, [props.submitCount]);
  // Becoming valid clears the message at once; it comes back only on the next blur or submit.
  useEffect(() => { if (!problem) setTouched(false); }, [problem]);
  const error = props.error ?? (touched ? problem : undefined);
  const ids: FieldIds = { labelledBy: `${id}-label`, describedBy: error ? `${id}-error` : props.description ? `${id}-description` : undefined, invalid: Boolean(error), error, onBlur: () => setTouched(true) };
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="body-medium" nativeID={ids.labelledBy}>{props.label}{props.required ? " *" : ""}</Text>
      {props.description ? <Text variant="meta" color="text/secondary" nativeID={`${id}-description`} numberOfLines={3}>{props.description}</Text> : null}
      {typeof props.children === "function" ? props.children(ids) : props.children}
      {error && typeof props.children !== "function" ? <FieldError message={error} id={`${id}-error`} /> : null}
    </View>
  );
}
const WRAP: ViewStyle = { minWidth: 0 };
