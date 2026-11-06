import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, TextInput, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { IconButton } from "./button.tsx";
import { dragHandle } from "./draghandle.ts";
import { fieldBox } from "./input.tsx";
import { INVALID_FLASH_MS, MIXED, commitInput, formatNumber, scrubber, stepByKey, type ScrubOptions } from "./logic/number.ts";
import { hasDom, lockPointer, onPointerMoveUp } from "./platform/dom";
import { keyOf, type ForcedState, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { space } from "./tokens.ts";

export type NumberFieldProps = {
  /** Accessible name; drawn as the scrub handle unless `hideLabel` or `icon` is given. */
  label: string; icon?: IconName; hideLabel?: boolean;
  /** `null` is the mixed state of a multi-selection: an em dash is shown and typing a value applies it to all. */
  value: number | null;
  /** Live preview while scrubbing. */
  onChange?(value: number): void;
  /** One event per edit or gesture. */
  onCommit(value: number): void;
  min?: number; max?: number; step?: number; unit?: string;
  /** Shows a reset button while the value differs from it. */
  defaultValue?: number; resetLabel?: string;
  /** 0.5 unit per pixel. */
  slow?: boolean; scrubRanges?: ScrubOptions["ranges"]; scrubClamp?: ScrubOptions["clamp"];
  size?: "xs" | "sm" | "md"; width?: number; disabled?: boolean; invalid?: boolean; forceText?: string; forceState?: ForcedState;
};

/**
 * A numeric field. Typing accepts `+ - * /`, parentheses and decimals; Enter commits and blurs, Escape restores the value
 * held before editing. Dragging the label scrubs the value: 1 unit per pixel, 10× with Shift, 0.1× with Alt, under pointer
 * lock on desktop and web.
 */
export function NumberField(props: NumberFieldProps) {
  const theme = useTheme();
  const range = { min: props.min, max: props.max, step: props.step };
  const shown = props.value === null ? "" : formatNumber(props.value, props.step);
  const [text, setText] = useState<string | null>(props.forceText ?? null);
  const [focused, setFocused] = useState(false);
  const [flash, setFlash] = useState(false);
  const [hovered, setHovered] = useState(false);
  const input = useRef<TextInput>(null);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const latest = useRef(props);
  latest.current = props;

  const commit = (raw: string) => {
    setText(null);
    if (raw.trim() === "" || raw === shown) return;
    const value = commitInput(raw, range);
    if (value === null) {
      // The previous value stays and the field is marked invalid for 1.5 s.
      setFlash(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(false), INVALID_FLASH_MS);
      return;
    }
    if (value !== props.value) props.onCommit(value);
  };
  const scrub = useMemo(() => {
    let session: ReturnType<typeof scrubber> | null = null;
    const begin = () => { const now = latest.current; session = scrubber(now.value ?? 0, { min: now.min, max: now.max, step: now.step, slow: now.slow, ranges: now.scrubRanges, clamp: now.scrubClamp }); };
    const move = (dx: number, modifiers: { shift?: boolean; alt?: boolean }) => { if (session) latest.current.onChange?.(session.move(dx, modifiers)); };
    const end = () => { if (session) latest.current.onCommit(session.value()); session = null; };
    return { begin, move, end };
  }, []);
  const pan = useMemo(() => {
    let last = 0;
    // On touch devices scrubbing is a horizontal drag on the label, without pointer lock.
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !hasDom && !latest.current.disabled,
      onPanResponderGrant: () => { last = 0; scrub.begin(); scrub.move(0, {}); },
      onPanResponderMove: (_event, gesture) => { scrub.move(gesture.dx - last, {}); last = gesture.dx; },
      onPanResponderRelease: scrub.end, onPanResponderTerminate: scrub.end,
    });
  }, [scrub]);
  const webScrub = hasDom ? {
    onPointerDown: (event: { currentTarget: unknown; preventDefault(): void }) => {
      if (latest.current.disabled) return;
      event.preventDefault();
      scrub.begin();
      const unlock = lockPointer(event.currentTarget);
      onPointerMoveUp((dx, _dy, modifiers) => scrub.move(dx, modifiers), () => { unlock(); scrub.end(); });
    },
  } : {};
  const differs = props.defaultValue !== undefined && props.value !== props.defaultValue;
  const sizeToken = props.size ?? "sm";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexGrow: props.width ? 0 : 1, flexShrink: 1, minWidth: 0 }}>
      <View {...({ onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } as object)} style={[fieldBox(theme, sizeToken, { focused: focused || props.forceState === "focus", hovered: hovered || props.forceState === "hover", invalid: flash || props.invalid, disabled: props.disabled }, space[2]), { flexGrow: 1, flexShrink: 1, width: props.width }]}>
        {props.hideLabel ? null : (
          <View {...pan.panHandlers} {...(webScrub as object)} {...dragHandle(props.disabled ? null : "ew-resize")} testID="scrub-handle">
            {props.icon ? <Icon name={props.icon} size={14} color="text/secondary" /> : <Text variant="meta" color="text/secondary" selectable={false}>{props.label}</Text>}
          </View>
        )}
        <TextInput ref={input} accessibilityLabel={props.value === null ? `${props.label}, ${theme.t("mixed")}` : props.label} aria-label={props.label} aria-invalid={flash || props.invalid || undefined}
          {...({ role: "spinbutton", "aria-valuenow": props.value ?? undefined, "aria-valuemin": props.min, "aria-valuemax": props.max } as object)}
          value={text ?? shown} placeholder={props.value === null ? MIXED : undefined} placeholderTextColor={theme.color("text/placeholder")} editable={!props.disabled} selectTextOnFocus keyboardType="numbers-and-punctuation"
          onChangeText={setText}
          onFocus={() => { setFocused(true); cancelled.current = false; }}
          onBlur={() => { setFocused(false); if (cancelled.current) setText(null); else if (text !== null) commit(text); }}
          onSubmitEditing={() => input.current?.blur()}
          {...({ "data-escape": "", onKeyPress: (event: KeyEvent) => {
            const key = keyOf(event);
            if (key.key === "Enter") { key.preventDefault(); input.current?.blur(); }
            if (key.key === "Escape") { key.preventDefault(); key.stopPropagation?.(); cancelled.current = true; setText(null); input.current?.blur(); }
            if ((key.key === "ArrowUp" || key.key === "ArrowDown") && props.value !== null) {
              key.preventDefault();
              setText(null);
              props.onCommit(stepByKey(props.value, key.key === "ArrowUp" ? 1 : -1, key, range));
            }
          } } as object)}
          style={[theme.type("body"), { flex: 1, minWidth: 0, alignSelf: "stretch", padding: 0, outlineWidth: 0, color: theme.color("text/primary"), fontVariant: ["tabular-nums"] }]} />
        {props.unit ? <Text color="text/secondary" >{props.unit}</Text> : null}
      </View>
      {differs ? <IconButton icon="rotate" size="xs" compactVisual label={props.resetLabel ?? theme.t("reset")} onPress={() => props.onCommit(props.defaultValue!)} /> : null}
    </View>
  );
}
