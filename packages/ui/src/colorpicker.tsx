import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View, type ViewStyle } from "react-native";
import { IconButton } from "./button.tsx";
import { Input, fieldBox } from "./input.tsx";
import {
  COLOR_FORMATS, HUE_BAR, SAVED_COLORS_KEY, svSquare, cssColor, extractColor, formatColorText, hsvToRgb, parseColorText, parseHex, pushRecent, rgbToHsv, savedColors, toHex,
  type ColorFormat, type Hsva,
} from "./logic/color.ts";
import { defaultStorage, hasEyeDropper, pickScreenColor } from "./platform/dom";
import { Popover } from "./overlay.tsx";
import { Select } from "./select.tsx";
import { Segmented } from "./tabs.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { CHECKERBOARD, borderWidth, radius, size, space } from "./tokens.ts";
import type { PreferenceStorage } from "./platform/types.ts";

const checker = (cell: number): object => { const value = `repeating-conic-gradient(${CHECKERBOARD[0]} 0 25%, ${CHECKERBOARD[1]} 0 50%)`; return { experimental_backgroundImage: value, backgroundImage: value, backgroundSize: `${cell}px ${cell}px` }; };
const gradient = (value: string): object => ({ experimental_backgroundImage: value, backgroundImage: value });

/** A colour drawn over a checkerboard, so its transparency is visible. These are user-chosen content colours. */
export function Swatch(props: { color: string; size?: "sm" | "md"; label?: string; onPress?(): void; selected?: boolean }) {
  const theme = useTheme();
  const box = props.size === "sm" ? size.swatchSm : size.swatch;
  const rgba = parseHex(props.color);
  const face = (
    <View style={[{ width: box, height: box, borderRadius: radius.xs, overflow: "hidden", borderWidth: props.selected ? borderWidth.focus : borderWidth.hairline, borderColor: theme.color(props.selected ? "accent" : "border/control") }, checker(size.checker)]}>
      <View style={{ flex: 1, backgroundColor: rgba ? cssColor(rgba) : "transparent" }} />
    </View>
  );
  return props.onPress ? <Tap role="button" label={props.label ?? props.color} onPress={props.onPress} target style={{ borderRadius: radius.xs }}>{face}</Tap> : face;
}

/** A draggable bar or square: reports the pointer position as fractions of its box, and the end of the gesture. */
function DragArea(props: { label: string; style: ViewStyle | object; onMove(x: number, y: number): void; onEnd(): void; onStart(): void; children?: React.ReactNode; value?: number; onKey?(dx: number, dy: number): void }) {
  const ref = useRef<View>(null);
  const box = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const latest = useRef(props);
  latest.current = props;
  const pan = useMemo(() => {
    const at = (pageX: number, pageY: number) => latest.current.onMove(Math.max(0, Math.min(1, (pageX - box.current.x) / box.current.width)), Math.max(0, Math.min(1, (pageY - box.current.y) / box.current.height)));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const { pageX, pageY } = event.nativeEvent;
        latest.current.onStart();
        ref.current?.measureInWindow((x, y, width, height) => { box.current = { x, y, width: width || 1, height: height || 1 }; at(pageX, pageY); });
      },
      onPanResponderMove: (_event, gesture) => at(gesture.moveX, gesture.moveY),
      onPanResponderRelease: () => latest.current.onEnd(), onPanResponderTerminate: () => latest.current.onEnd(),
    });
  }, []);
  return (
    <Tap ref={ref} label={props.label} noRing aria={{ role: "slider", "aria-valuenow": props.value === undefined ? undefined : Math.round(props.value) }}
      onKeyDown={(key) => {
        const step = key.shift ? 0.1 : 0.01;
        const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const delta = move[key.key];
        if (delta) { key.preventDefault(); props.onKey?.(delta[0], delta[1]); }
      }}
      style={(state) => [props.style as ViewStyle, state.focused ? { outlineWidth: size.focusRing, outlineStyle: "solid", outlineOffset: size.focusOffset } : null]}>
      <View {...pan.panHandlers} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>{props.children}</View>
    </Tap>
  );
}

export type ColorPickerProps = {
  label: string;
  /** `#RRGGBB` or `#RRGGBBAA`, uppercase. */
  value: string;
  /** Fires during drags, for live preview. */
  onChange?(value: string): void;
  /** Fires once on release, Enter or blur. */
  onCommit(value: string): void;
  defaultValue?: string; brandColors?: string[]; storage?: PreferenceStorage; recent?: string[]; onRecentChange?(recent: string[]): void;
  /** Offers the in-preview sampler where no screen eyedropper exists. */
  onPickFromPreview?(): void; disabled?: boolean; forceOpen?: boolean; width?: number; forceState?: ForcedState;
};

/**
 * A swatch with an inline uppercase hex input, and a popover with a saturation/value square, hue and opacity sliders, a format
 * select with a text input, an eyedropper, "Custom | Saved", the 12 most recently used colours and reset-to-default.
 */
export function ColorPicker(props: ColorPickerProps) {
  const theme = useTheme();
  const storage = props.storage ?? defaultStorage;
  const rgba = parseHex(props.value) ?? { r: 0, g: 0, b: 0, a: 1 };
  // The hue is kept while the colour is a grey, so raising saturation again returns to it.
  const hue = useRef(rgbToHsv(rgba).h);
  const hsv = rgbToHsv(rgba, hue.current);
  if (hsv.s > 0 && hsv.v > 0) hue.current = hsv.h;
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [tab, setTab] = useState<"custom" | "saved">("custom");
  const [format, setFormat] = useState<ColorFormat>("HEX");
  const [text, setText] = useState<string | null>(null);
  const [hexText, setHexText] = useState<string | null>(null);
  const [alphaText, setAlphaText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>(() => savedColors.parse(storage.get(SAVED_COLORS_KEY)));
  const [ownRecent, setOwnRecent] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const recent = props.recent ?? ownRecent;
  const anchor = useRef<View>(null);
  const live = useRef(props.value);
  useEffect(() => { live.current = props.value; }, [props.value]);

  const preview = (next: Hsva) => { if (next.s > 0 && next.v > 0) hue.current = next.h; live.current = toHex(hsvToRgb(next)); props.onChange?.(live.current); };
  const commit = (value: string) => {
    live.current = value;
    const list = pushRecent(recent, value);
    if (props.onRecentChange) props.onRecentChange(list); else setOwnRecent(list);
    if (value !== props.value) props.onCommit(value);
  };
  const end = () => { setDragging(false); commit(live.current); };
  const persist = (list: string[]) => { setSaved(list); storage.set(SAVED_COLORS_KEY, JSON.stringify(list)); };
  const commitText = (raw: string, kind: ColorFormat) => {
    const parsed = parseColorText(raw, kind, rgba.a);
    // Invalid input is ignored and the previous value restored.
    if (parsed) commit(toHex(parsed));
  };
  const paste = (pasted: string) => { const found = extractColor(pasted, rgba.a); if (found) commit(toHex(found)); return Boolean(found); };
  const current = hsvToRgb({ ...hsv, h: hue.current });
  const pureHue = toHex(hsvToRgb({ h: hue.current, s: 1, v: 1, a: 1 }));
  const thumb = (left: number, top: number): ViewStyle => ({ position: "absolute", start: `${left * 100}%`, top: `${top * 100}%`, width: size.pickerThumb, height: size.pickerThumb, margin: -size.pickerThumb / 2, borderRadius: radius.full, borderWidth: borderWidth.focus, borderColor: theme.color("control/thumb") });
  return (
    <View style={{ width: props.width }}>
      <View ref={anchor} style={[fieldBox(theme, "sm", { disabled: props.disabled, focused: open || props.forceState === "focus", hovered: props.forceState === "hover" }), { paddingStart: space[1] }]}>
        <Swatch color={props.value} onPress={props.disabled ? undefined : () => setOpen(true)} label={`${props.label}: ${props.value}`} />
        <Input accessibilityLabel={props.label} mono size="sm" disabled={props.disabled} value={hexText ?? props.value} autoCapitalize="characters" autoCorrect={false}
          onChangeText={(value) => { if (value.length - (hexText ?? props.value).length > 2 && paste(value)) { setHexText(null); return; } setHexText(value.toUpperCase()); }}
          onBlur={() => { if (hexText !== null) { commitText(hexText, "HEX"); setHexText(null); } }} onSubmitEditing={() => { if (hexText !== null) { commitText(hexText, "HEX"); setHexText(null); } }}
          style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0, height: undefined, backgroundColor: "transparent" }} />
      </View>
      {/* Dismissal by outside press is suppressed while dragging. */}
      <Popover open={open} onClose={() => setOpen(false)} onRequestClose={() => { if (!dragging) setOpen(false); }} anchor={anchor} label={props.label} title={props.label} width={size.pickerWidth} padded>
        <Segmented<"custom" | "saved"> block size="xs" label={props.label} options={[{ value: "custom" as const, label: theme.t("custom") }, { value: "saved" as const, label: theme.t("saved") }]} value={tab} onChange={setTab} />
        {tab === "custom" ? (
          <View style={{ gap: space[2], marginTop: space[2] }}>
            <DragArea label={theme.t("color")} onStart={() => setDragging(true)} onEnd={end} onMove={(x, y) => preview({ h: hue.current, s: x, v: 1 - y, a: rgba.a })} onKey={(dx, dy) => { const next = { h: hue.current, s: Math.max(0, Math.min(1, hsv.s + dx)), v: Math.max(0, Math.min(1, hsv.v - dy)), a: rgba.a }; preview(next); commit(toHex(hsvToRgb(next))); }}
              style={[{ height: size.pickerSquare, borderRadius: radius.sm, overflow: "hidden", backgroundColor: pureHue }, gradient(svSquare(pureHue))]}>
              <View pointerEvents="none" style={thumb(hsv.s, 1 - hsv.v)} />
            </DragArea>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              {hasEyeDropper()
                ? <IconButton icon="eyedrop" size="xs" compactVisual variant="outline" label={theme.t("eyedropper")} onPress={() => { void pickScreenColor().then((hex) => { const picked = hex ? parseHex(hex) : null; if (picked) commit(toHex({ ...picked, a: rgba.a })); }); }} />
                : props.onPickFromPreview ? <IconButton icon="eyedrop" size="xs" compactVisual variant="outline" label={theme.t("pickFromPreview")} onPress={() => { setOpen(false); props.onPickFromPreview!(); }} /> : null}
              <View style={{ flex: 1, gap: space[1.5] }}>
                <DragArea label={theme.t("hue")} value={hue.current} onStart={() => setDragging(true)} onEnd={end} onMove={(x) => { hue.current = x * 360; preview({ h: x * 360, s: hsv.s, v: hsv.v, a: rgba.a }); }}
                  onKey={(dx) => { hue.current = (hue.current + dx * 360 + 360) % 360; const next = { h: hue.current, s: hsv.s, v: hsv.v, a: rgba.a }; preview(next); commit(toHex(hsvToRgb(next))); }}
                  style={[{ height: size.pickerBar, borderRadius: radius.xs }, gradient(HUE_BAR)]}>
                  <View pointerEvents="none" style={thumb(hue.current / 360, 0.5)} />
                </DragArea>
                <View style={[{ height: size.pickerBar, borderRadius: radius.xs, overflow: "hidden" }, checker(size.pickerBar)]}>
                  <DragArea label={theme.t("opacity")} value={rgba.a * 100} onStart={() => setDragging(true)} onEnd={end} onMove={(x) => preview({ ...hsv, h: hue.current, a: x })}
                    onKey={(dx) => { const next = { ...hsv, h: hue.current, a: Math.max(0, Math.min(1, rgba.a + dx)) }; preview(next); commit(toHex(hsvToRgb(next))); }}
                    style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, gradient(`linear-gradient(90deg, transparent, ${toHex({ ...current, a: 1 })})`)]}>
                    <View pointerEvents="none" style={thumb(rgba.a, 0.5)} />
                  </DragArea>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: space[1.5] }}>
              <Select size="xs" label={theme.t("format")} width={size.sliderMin * 2} value={format} options={COLOR_FORMATS.map((value) => ({ value, label: value }))} onChange={(value) => { setFormat(value); setText(null); }} />
              <Input size="xs" mono accessibilityLabel={`${theme.t("color")} ${format}`} value={text ?? formatColorText(rgba, format)} style={{ flex: 1 }}
                onChangeText={(value) => { if (value.length - (text ?? formatColorText(rgba, format)).length > 2 && paste(value)) { setText(null); return; } setText(value); }}
                onBlur={() => { if (text !== null) { commitText(text, format); setText(null); } }} onSubmitEditing={() => { if (text !== null) { commitText(text, format); setText(null); } }} />
              <Input size="xs" mono accessibilityLabel={theme.t("opacity")} value={alphaText ?? `${Math.round(rgba.a * 100)}%`} style={{ width: size.sliderMin + space[3] }} onChangeText={setAlphaText}
                onBlur={() => { if (alphaText !== null) { const amount = Number(alphaText.replace("%", "")); if (Number.isFinite(amount) && alphaText.trim() !== "") commit(toHex({ ...rgba, a: Math.max(0, Math.min(100, amount)) / 100 })); setAlphaText(null); } }} />
            </View>
            {recent.length ? (
              <View accessibilityLabel={theme.t("recent")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
                {recent.map((hex) => <Swatch key={hex} size="sm" color={hex} onPress={() => commit(hex)} />)}
              </View>
            ) : null}
            {props.defaultValue ? <View style={{ alignItems: "flex-start" }}><IconButton icon="rotate" size="xs" compactVisual label={theme.t("reset")} disabled={props.value === props.defaultValue} onPress={() => commit(props.defaultValue!)} /></View> : null}
          </View>
        ) : (
          <View style={{ gap: space[2], marginTop: space[2] }}>
            {props.brandColors?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{props.brandColors.map((hex) => <Swatch key={hex} size="sm" color={hex} onPress={() => commit(hex)} />)}</View> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
              {saved.map((hex, index) => (
                <View key={hex} style={{ alignItems: "center" }}>
                  <Swatch size="sm" color={hex} selected={hex === props.value} onPress={() => commit(hex)} />
                  {hex === props.value ? (
                    <View style={{ flexDirection: "row" }}>
                      <Tap role="button" label={`${theme.t("back")}: ${hex}`} disabled={index === 0} onPress={() => persist(savedColors.move(saved, index, index - 1))}><Text variant="caption" color="text/secondary">‹</Text></Tap>
                      <Tap role="button" label={theme.t("remove", { name: hex })} onPress={() => persist(savedColors.remove(saved, hex))}><Text variant="caption" color="text/secondary">×</Text></Tap>
                      <Tap role="button" label={`${theme.t("more")}: ${hex}`} disabled={index === saved.length - 1} onPress={() => persist(savedColors.move(saved, index, index + 1))}><Text variant="caption" color="text/secondary">›</Text></Tap>
                    </View>
                  ) : null}
                </View>
              ))}
              <IconButton icon="plus" size="xs" compactVisual variant="outline" label={theme.t("saveColor")} disabled={saved.includes(props.value)} onPress={() => persist(savedColors.add(saved, props.value))} />
            </View>
          </View>
        )}
      </Popover>
    </View>
  );
}
