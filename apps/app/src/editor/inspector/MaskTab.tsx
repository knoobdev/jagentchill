import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  addMaskOfType, chromaOf, duplicateMask, isKeyable, isMaskable, MASK_COMBINE, MASK_LIMIT, MASK_LIMIT_MESSAGE, MASK_MENU, maskDisplay, maskHas, maskName, maskParamAt, maskStored, masksOf, removeMask, reorderMask, resetChromaKey, resetMask,
  setChromaKey, setMaskField, setMaskParams, setPathClosed, timeline, uuidV4, type MaskEntry,
} from "@jagentchill/editor-core";
import { Button, ColorPicker, Icon, IconButton, Input, Menu, NumberField, Select, Slider, Switch, Tap, Text, Tooltip, radius, space, useTheme, type IconName, type MenuItem } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor, useHeldTransport } from "../context";
import { KeyToggle } from "./keys";
import { Note, Row, Section } from "./parts";

type El = timeline.El;
/** The names the Mask and Cutout tabs take from the engine's tables, listed for the locale resources. */
const MASK_STRINGS = { menu: ["Split", "Mirror", "Filmstrip", "Rectangle", "Ellipse", "Heart", "Diamond", "Star", "Text", "Pen tool", "Pen"], combine: ["Base", "Add", "Subtract", "Intersect", "Exclude"], align: ["Inside", "Center", "Outside"], reasons: ["Maximum of 8 masks per clip", "Select a clip that can be masked", "This mask no longer exists"] };
void MASK_STRINGS;
const MASK_ICON: Record<string, IconName> = { split: "split", mirror: "mirror", "cinematic-bars": "film", rectangle: "box", ellipse: "circle", heart: "heart", diamond: "diamond", star: "star", text: "type", freeform: "pencil" };
const COMBINE_NAME = { add: "Add", subtract: "Subtract", intersect: "Intersect", exclude: "Exclude" } as const;

/** The Mask sub-tab: the masks of the clip in order, each a row with its controls, and the fields of the selected one. */
export function MaskTab(props: { element: El }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const { controller } = runtime, { element } = props, masks = masksOf(element), playhead = transport.time;
  const [menu, setMenu] = useState(false);
  const addRef = useRef<View>(null);
  const selectedId = masks.some((mask) => mask.id === runtime.tool.maskId) ? runtime.tool.maskId : null;
  // The canvas shows mask handles while this tab is in view.
  useEffect(() => { runtime.setTool({ inspector: "mask" }); return () => runtime.setTool({ inspector: null, hoverMask: null }); }, [runtime]);
  useEffect(() => { if (!selectedId && masks[0]) runtime.setTool({ maskId: masks[0].id, maskPoints: [] }); }, [selectedId, masks, runtime]);
  if (!isMaskable(element)) return <View style={{ padding: space[3] }}><Note>{t("Select a clip that can be masked")}</Note></View>;
  const run = (change: Parameters<typeof controller.external>[0], live = false) => controller.external(change, live);
  const add = (type: MaskEntry["type"]) => { const id = uuidV4(); if (run((doc, ctx) => addMaskOfType(doc, ctx, element.id, type, id))) runtime.setTool({ maskId: id, maskPoints: [], hoverMask: null }); };
  const full = masks.length >= MASK_LIMIT;
  const items: MenuItem[] = MASK_MENU.map((entry) => ({ id: entry.type, label: t(entry.name), icon: MASK_ICON[entry.type], onSelect: () => add(entry.type) }));
  return (
    <View testID="mask-tab">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] }}>
        <View ref={addRef}><Tooltip label={t(full ? MASK_LIMIT_MESSAGE : "Add mask")}><Button size="sm" kind="outline" icon="plus" label={t("Add mask")} testID="mask-add" disabled={full} expanded={menu} onPress={() => setMenu(true)} /></Tooltip></View>
        <Text variant="meta" color="text/secondary" testID="mask-count">{masks.length === 0 ? t("No masks") : masks.length === 1 ? t("1 mask") : t("{n} masks · combined in order", { n: masks.length })}</Text>
        <Menu open={menu} anchor={addRef} items={items} label={t("Add mask")} onClose={() => setMenu(false)} />
      </View>
      {masks.map((mask, index) => {
        const open = mask.id === selectedId;
        return (
          <View key={mask.id} testID={`mask-row-${index}`} style={{ borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <View style={{ height: 34, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], backgroundColor: open ? theme.color("bg/subtle") : "transparent" }}>
              <Tap role="button" label={t("Move mask: Alt+Up / Alt+Down")} onKeyDown={(key) => { if (key.alt && (key.key === "ArrowUp" || key.key === "ArrowDown")) { key.preventDefault(); run((doc, ctx) => reorderMask(doc, ctx, element.id, mask.id, index + (key.key === "ArrowUp" ? -1 : 1))); } }} style={{ width: 16, alignItems: "center" }}><Icon name="grip" size={12} color="text/tertiary" /></Tap>
              <Tap role="button" label={maskName(masks, mask)} expanded={open} testID={`mask-select-${index}`} onPress={() => runtime.setTool({ maskId: mask.id, maskPoints: [] })} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[1], height: 28, minWidth: 0 }}>
                <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
                <Text variant="body-medium" numberOfLines={1}>{`${t(MASK_MENU.find((entry) => entry.type === mask.type)?.name.replace("Pen tool", "Pen") ?? mask.type)} ${index + 1}`}</Text>
              </Tap>
              <View testID={`mask-combine-${index}`}><Select label={t("Combine mode")} size="xs" width={104} value={mask.combine} options={MASK_COMBINE.map((mode) => ({ value: mode, label: t(index === 0 && mode === "add" ? "Base" : COMBINE_NAME[mode]) }))} onChange={(combine) => run((doc, ctx) => setMaskField(doc, ctx, element.id, mask.id, { combine }))} /></View>
              <IconButton icon={mask.enabled ? "eye" : "eye-off"} size="xs" label={t(mask.enabled ? "Disable mask" : "Enable mask")} testID={`mask-enable-${index}`} onPress={() => run((doc, ctx) => setMaskField(doc, ctx, element.id, mask.id, { enabled: !mask.enabled }))} />
              <IconButton icon="adjust" size="xs" label={t("Invert")} on={mask.params.inverted === true} toggle testID={`mask-invert-${index}`} onPress={() => run((doc, ctx) => setMaskParams(doc, ctx, element.id, mask.id, { inverted: mask.params.inverted !== true }, undefined, "Invert mask"))} />
              <IconButton icon="copy" size="xs" label={t("Duplicate mask")} disabled={full} testID={`mask-duplicate-${index}`} onPress={() => run((doc, ctx) => duplicateMask(doc, ctx, element.id, mask.id))} />
              <IconButton icon="trash" size="xs" label={t("Remove mask")} testID={`mask-remove-${index}`} onPress={() => run((doc, ctx) => removeMask(doc, ctx, element.id, mask.id))} />
            </View>
            {open ? <MaskFields element={element} mask={mask} playhead={playhead} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/** The fields of one mask, in displayed units; each numeric one has its keyframe toggle. */
function MaskFields(props: { element: El; mask: MaskEntry; playhead: number }) {
  const t = useT();
  const runtime = useEditor();
  const { element, mask, playhead } = props, local = Math.min(element.duration, Math.max(0, playhead - element.startTime));
  const stored = (key: string): number => Number(maskParamAt(element, mask, key, local) ?? 0), shown = (key: string): number => maskDisplay(key, stored(key));
  const write = (params: Record<string, number | boolean | string>, live = false) => runtime.controller.external((doc, ctx) => setMaskParams(doc, ctx, element.id, mask.id, params, playhead), live);
  const set = (key: string, value: number, live = false) => write({ [key]: maskStored(key, value) }, live);
  // Position and Size are two stored channels each: one toggle keys both.
  const toggle = (key: string, label: string, pair?: string) => <KeyToggle element={element} path={`masks.${mask.id}.params.${key}`} value={stored(key)} label={label} playhead={playhead} testID={`mask-kf-${key}`} also={pair ? [{ path: `masks.${mask.id}.params.${pair}`, value: stored(pair) }] : undefined} />;
  const number = (key: string, label: string, options: { min: number; max: number; unit?: string; step?: number; name?: string }) => (
    <View style={{ flex: 1 }} testID={`mask-${key}`}><NumberField label={options.name ?? label} hideLabel={options.name === undefined} size="sm" unit={options.unit} min={options.min} max={options.max} step={options.step ?? 1} value={shown(key)} onChange={(value) => set(key, value, true)} onCommit={(value) => set(key, value)} /></View>
  );
  const slider = (key: string, label: string, min: number, max: number, rest: number) => (
    <Row label={label}>
      <View style={{ flex: 1 }} testID={`mask-${key}-slider`}><Slider label={label} min={min} max={max} step={1} defaultValue={rest} value={Math.round(shown(key))} onChange={(value) => set(key, value as number, true)} onCommit={(value) => set(key, value as number)} /></View>
      <View testID={`mask-${key}`}><NumberField label={label} hideLabel size="sm" width={68} unit="%" min={min} max={max} step={1} value={Math.round(shown(key))} onCommit={(value) => set(key, value)} /></View>
      {toggle(key, label)}
    </Row>
  );
  const has = (key: string) => maskHas(mask.type, key);
  const path = Array.isArray(mask.params.path) ? (mask.params.path as unknown[]) : [];
  return (
    <View style={{ paddingHorizontal: space[3], paddingTop: space[1], paddingBottom: space[3], gap: space[1.5] }}>
      <Row label={t("Position")}>{number("centerX", t("Position"), { min: -100, max: 100, name: "X" })}{number("centerY", t("Position"), { min: -100, max: 100, name: "Y" })}{toggle("centerX", t("Position"), "centerY")}</Row>
      {has("width") && mask.type !== "cinematic-bars" ? <Row label={t("Size")}>{number("width", t("Size"), { min: 1, max: 100000, name: "W" })}{number("height", t("Size"), { min: 1, max: 100000, name: "H" })}{toggle("width", t("Size"), "height")}</Row> : null}
      {mask.type === "cinematic-bars" ? <Row label={t("Height")}>{number("height", t("Height"), { min: 1, max: 100000, unit: "%" })}{toggle("height", t("Height"))}</Row> : null}
      {has("size") ? <Row label={t("Thickness")}>{number("size", t("Thickness"), { min: 1, max: 500, unit: "%" })}{toggle("size", t("Thickness"))}</Row> : null}
      {has("scale") ? <Row label={t("Scale")}>{number("scale", t("Scale"), { min: 1, max: 500, unit: "%" })}{toggle("scale", t("Scale"))}</Row> : null}
      <Row label={t("Rotation")}>{number("rotation", t("Rotation"), { min: 0, max: 360, unit: "°" })}{toggle("rotation", t("Rotation"))}</Row>
      {has("cornerRadius") ? slider("cornerRadius", t("Corner radius"), 0, 100, 0) : null}
      {has("points") ? <Row label={t("Points")}>{number("points", t("Points"), { min: 3, max: 12 })}</Row> : null}
      {has("innerRatio") ? <Row label={t("Inner ratio")}>{number("innerRatio", t("Inner ratio"), { min: 10, max: 95, unit: "%" })}{toggle("innerRatio", t("Inner ratio"))}</Row> : null}
      {has("content") ? <Row label={t("Text")}><View style={{ flex: 1 }}><Input accessibilityLabel={t("Mask text")} testID="mask-content" value={String(mask.params.content ?? "")} onChangeText={(content) => write({ content: content.slice(0, 2000) })} /></View></Row> : null}
      {has("fontSize") ? <Row label={t("Font size")}>{number("fontSize", t("Font size"), { min: 5, max: 300 })}{toggle("fontSize", t("Font size"))}</Row> : null}
      {mask.type === "freeform" ? (
        <Row label={t("Path")}>
          <Text variant="meta" color="text/secondary" style={{ flex: 1 }} testID="mask-path-count">{t("{n} points — click the canvas to add", { n: path.length })}</Text>
          <Button size="xs" kind="outline" label={t(mask.params.closed === true ? "Open path" : "Close path")} disabled={path.length < 3} testID="mask-path-close" onPress={() => runtime.controller.external((doc, ctx) => setPathClosed(doc, ctx, element.id, mask.id, mask.params.closed !== true))} />
        </Row>
      ) : null}
      {slider("feather", t("Feather"), 0, 100, 0)}
      {slider("opacity", t("Opacity"), 0, 100, 100)}
      <Row label={t("Stroke")}>
        <View style={{ width: 76 }} testID="mask-strokeWidth"><NumberField label="W" size="sm" unit="px" min={0} max={100} step={1} value={stored("strokeWidth")} onCommit={(value) => write({ strokeWidth: value })} /></View>
        <View testID="mask-strokeColor"><ColorPicker label={t("Stroke colour")} width={96} value={String(mask.params.strokeColor ?? "#ffffff").toUpperCase()} onCommit={(value) => write({ strokeColor: value.toLowerCase() })} /></View>
        {has("width") ? <View style={{ flex: 1 }}><Select label={t("Stroke alignment")} size="sm" value={String(mask.params.strokeAlign ?? "center") as "inside" | "center" | "outside"} options={[{ value: "inside", label: t("Inside") }, { value: "center", label: t("Center") }, { value: "outside", label: t("Outside") }]} onChange={(strokeAlign) => write({ strokeAlign })} /></View> : null}
      </Row>
      <View style={{ flexDirection: "row" }}><Button size="xs" kind="ghost" icon="rotate" label={t("Reset mask")} testID="mask-reset" onPress={() => runtime.controller.external((doc, ctx) => resetMask(doc, ctx, element.id, mask.id))} /></View>
    </View>
  );
}

/** The Cutout sub-tab: the chroma key of a video or image clip. */
export function CutoutTab(props: { element: El }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const { element } = props, chroma = chromaOf(element), playhead = transport.time, local = Math.min(element.duration, Math.max(0, playhead - element.startTime));
  useEffect(() => () => { if (runtime.tool.eyedropper || runtime.tool.matte) runtime.setTool({ eyedropper: false, matte: false }); }, [runtime]);
  if (!isKeyable(element)) return <View style={{ padding: space[3] }}><Note>{t("Chroma key is available for video and image clips")}</Note></View>;
  const write = (change: Parameters<typeof setChromaKey>[3], live = false) => runtime.controller.external((doc, ctx) => setChromaKey(doc, ctx, element.id, change, playhead), live);
  const value = (key: "strength" | "edge" | "shadow" | "spill"): number => Number(timeline.locate(runtime.controller.document, element.id) ? (resolved(element, key, local) ?? chroma[key]) : chroma[key]);
  const names = { strength: "Strength", edge: "Edge", shadow: "Shadow", spill: "Spill" } as const;
  const picking = runtime.tool.eyedropper, matte = runtime.tool.matte, unavailable = transport.engine !== "ready";
  return (
    <View testID="cutout-tab">
      <Section id="chroma" title={t("Chroma key")} testID="chroma-section" enabled={chroma.enabled} onToggle={(on) => write({ enabled: on })} onReset={() => runtime.controller.external((doc, ctx) => resetChromaKey(doc, ctx, element.id))}>
        <Row label={t("Colour")}>
          <View testID="chroma-color"><ColorPicker label={t("Key colour")} width={104} value={chroma.color.toUpperCase()} onChange={(next) => write({ color: next }, true)} onCommit={(next) => write({ color: next })} /></View>
          <IconButton icon="eyedrop" size="sm" variant="outline" label={unavailable ? t("Preview is unavailable") : t("Pick the key colour from the preview")} on={picking} toggle disabled={unavailable} testID="chroma-eyedropper" onPress={() => runtime.setTool({ eyedropper: !picking })} />
          <View testID="chroma-swatch" style={{ width: 20, height: 20, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/control"), backgroundColor: chroma.color }} />
        </Row>
        {picking ? <Note>{t("Click the colour to remove in the preview")}</Note> : null}
        {(["strength", "edge", "shadow", "spill"] as const).map((key) => (
          <Row key={key} label={t(names[key])}>
            <View style={{ flex: 1 }} testID={`chroma-${key}`}><Slider label={t(names[key])} min={0} max={100} step={1} defaultValue={{ strength: 40, edge: 10, shadow: 0, spill: 50 }[key]} value={Math.round(value(key))} onChange={(next) => write({ [key]: next as number }, true)} onCommit={(next) => write({ [key]: next as number })} /></View>
            <View testID={`chroma-${key}-value`}><NumberField label={t(names[key])} hideLabel size="sm" width={60} min={0} max={100} step={1} value={Math.round(value(key))} onCommit={(next) => write({ [key]: next })} /></View>
            <KeyToggle element={element} path={`chromaKey.${key}`} value={value(key)} label={t(names[key])} playhead={playhead} />
          </Row>
        ))}
        <View testID="chroma-matte" style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}><Text variant="meta" color="text/secondary">{t("Show matte")}</Text><Switch accessibilityLabel={t("Show matte")} value={matte} onChange={(on) => runtime.setTool({ matte: on })} /><Text variant="meta" color="text/tertiary" numberOfLines={1} style={{ flex: 1 }}>{t("White is kept, black is removed")}</Text></View>
      </Section>
    </View>
  );
}
const resolved = (element: El, key: string, local: number): number | undefined => { const keys = ((element.animations ?? {}) as Record<string, { keys?: unknown[] }>)[`chromaKey.${key}`]?.keys; return keys && keys.length > 0 ? Number(timeline.valueAt(keys as never, local)) : undefined; };
