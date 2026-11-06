import { Fragment, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, View } from "react-native";
import { availableWeights, isFontAvailable } from "@jagentchill/app-core";
import {
  applyStyleToAllText, applyTextPreset, clampTextContent, copyTextStyle, FONT_WEIGHT_NAMES, otherTextElements, pasteTextStyle, saveTextPreset, setElementFields, setTextBackground, setTextBoxMode, storedFontSize, TEXT_ANIMATIONS,
  TEXT_BUBBLES, TEXT_PRESETS, toggledBoldWeight, timeline,
} from "@jagentchill/editor-core";
import { animatablePath } from "@jagentchill/protocol";
import { Button, ColorPicker, ConfirmDialog, IconButton, Input, MenuButton, Modal, NumberField, Segmented, Select, Slider, Tabs, Text, Textarea, space, useToast } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useBrandColors } from "../../templates/brand-store";
import { usePref } from "../../state";
import { PresetGrid } from "../assets/PresetGrid";
import { SAVED_TEXT_PRESETS, setCopiedTextStyle, useCopiedTextStyle } from "../assets/text-store";
import { useEditor, useHeldTransport } from "../context";
import { BUNDLED_FACES } from "../fonts.gen";
import { BubbleTab } from "./BubbleTab";
import { EmojiButton } from "./EmojiPicker";
import { FontPicker } from "./FontPicker";
import { KeyToggle } from "./keys";
import { elementOf, Note, objectOf, Row, Section, shownAt, writeFields, writePath, type Fields } from "./parts";

type El = timeline.El;
const CASES = [{ value: "none", label: "None" }, { value: "upper", label: "UPPERCASE" }, { value: "lower", label: "lowercase" }, { value: "title", label: "Title Case" }] as const;
const upper = (color: unknown, fallback: string) => String(color ?? fallback).toUpperCase();
const lower = (color: string) => color.toLowerCase();
/** A fill counts as off when it is fully transparent: the hollow looks of the presets. */
const fillOn = (color: string) => !(color.length === 9 && color.slice(7).toLowerCase() === "00");

/**
 * The Basic tab of a selection. For a text element it is the Text tab — the sub-tabs Basic, Bubble and Effects, with the
 * text's own fields above the Transform and Blend sections (`children`) and its style actions below; for any other
 * selection it is those sections, under what the kind adds (`above`: a shape's parameters, a sticker's playback).
 * ONE frame for every kind, so that Transform and Blend stay mounted when the selection goes from a picture to a text
 * and back: only the text's own parts are mounted and removed (the two sections were built again at every such click).
 */
export function TextInspector(props: { element: El | null; above?: ReactNode; children: ReactNode }) {
  const t = useT();
  const runtime = useEditor();
  const [sub, setSub] = useState<"basic" | "bubble" | "effects">("basic");
  const { element } = props, ids = element ? [element.id] : [];
  // The sub-tab is the text's: after another kind of selection the next text starts at Basic again.
  if (!element && sub !== "basic") setSub("basic");
  const shown = element ? sub : "basic";
  return (
    <View testID={element ? "text-inspector" : undefined}>
      {element ? (
        <View key="tabs" style={{ paddingHorizontal: space[3], paddingVertical: space[2] }}>
          <Tabs id="text-sub" label={t("Text")} variant="pill" size="xs" items={[{ id: "basic", label: t("Basic") }, { id: "bubble", label: t("Bubble") }, { id: "effects", label: t("Effects") }]} value={sub} onChange={(id) => setSub(id as "basic" | "bubble" | "effects")} />
        </View>
      ) : null}
      {element && shown === "basic" ? <TextBasic key="text" element={element} /> : null}
      {element && shown === "bubble" ? <BubbleTab key="bubble" element={element} /> : null}
      {element && shown === "effects" ? (
        <View key="effects" style={{ paddingHorizontal: space[3], paddingBottom: space[3] }}>
          <PresetGrid selectedId={typeof element.stylePresetId === "string" ? element.stylePresetId : undefined}
            onHover={(presetId, inside) => { if (inside) runtime.controller.external((doc, ctx) => applyTextPreset(doc, ctx, ids, presetId), true); else runtime.controller.discardPreview(); }}
            onPick={(presetId) => { runtime.controller.external((doc, ctx) => applyTextPreset(doc, ctx, ids, presetId)); }} />
        </View>
      ) : null}
      {props.above}
      {shown === "basic" ? <Fragment key="shared">{props.children}</Fragment> : null}
      {element && shown === "basic" ? <StyleActions key="actions" element={element} /> : null}
    </View>
  );
}

function TextBasic(props: { element: El }) {
  const t = useT();
  const brand = useBrandColors();
  const toast = useToast();
  const runtime = useEditor();
  const { element } = props, ids = [element.id];
  // The element drawn here carries the live preview of a field being edited; what a blur compares with is the stored content.
  const stored = String(elementOf(runtime.controller.stored, element.id)?.content ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const part = (key: string) => objectOf(element[key]);
  const fill = part("fill"), box = part("box"), stroke = part("stroke"), shadow = part("shadow"), glow = part("glow"), background = part("background");
  const family = String(element.fontFamily ?? "Arial"), weight = Number(element.fontWeight ?? 400), color = String(element.color ?? "#ffffff");
  const weights = availableWeights(family, BUNDLED_FACES), available = isFontAvailable(family, BUNDLED_FACES);
  const playhead = useHeldTransport().time;
  const set = (fields: Fields, label: string, live = false) => writeFields(runtime, ids, fields, label, live);
  /** A keyframable property by its path: its value at the playhead, its write (the key under the playhead once it has keys) and its keyframe toggle. */
  const at = <T extends number | string>(path: string, stored: T): T => shownAt(element, path, stored, playhead);
  const put = (path: string, value: number | string, label: string, live = false) => writePath(runtime, element, path, value, label, live);
  const key = (path: string, value: number | string, label: string) => (animatablePath(element as never, path) ? <KeyToggle element={element} path={path} value={value} label={t(label)} playhead={playhead} testID={`kf-${path}`} /> : null);
  /** A change inside one nested object (`stroke.width`): the object is written whole, with the change on top. */
  const setIn = (key: string, change: Fields, label: string, live = false) => writeFields(runtime, ids, (current) => ({ [key]: { ...objectOf(current[key]), ...change } }), label, live);
  const writeContent = (content: string, live: boolean) => runtime.controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { content }, { commandType: "element.text", label: "Edit text" }), live);
  const type = (text: string) => {
    const clamped = clampTextContent(text);
    if (clamped.shortened) toast.show({ kind: "warning", message: t("Text was shortened to 10,000 characters") });
    setDraft(clamped.content); writeContent(clamped.content, true);
  };
  const number = (label: string, value: unknown, fallback: number, onCommit: (next: number, live: boolean) => void, options: { min: number; max: number; step: number; unit?: string; width?: number }) => (
    <View style={options.width ? { width: options.width } : { flex: 1 }}><NumberField label={label} size="sm" min={options.min} max={options.max} step={options.step} unit={options.unit} value={Number(value ?? fallback)} onChange={(next) => onCommit(next, true)} onCommit={(next) => onCommit(next, false)} /></View>
  );
  const slider = (label: string, group: string, field: string, value: unknown, fallback: number, max: number, step = 1, unit = "%", min = 0) => {
    const path = `${group}.${field}`, shown = at(path, Number(value ?? fallback));
    return (
      <Row label={t(label)}>
        <View style={{ flex: 1 }}><Slider label={t(label)} min={min} max={max} step={step} value={shown} defaultValue={fallback} onChange={(next) => put(path, next as number, label, true)} onCommit={(next) => put(path, next as number, label)} /></View>
        <NumberField label={t(label)} hideLabel size="sm" width={64} unit={unit} min={min} max={max} step={step} value={Math.round(shown * 10) / 10} onCommit={(next) => put(path, next, label)} />
        {key(path, shown, label)}
      </Row>
    );
  };
  /** A colour row; with `path` the colour is keyframable and gets its toggle. */
  const colour = (label: string, value: unknown, fallback: string, write: (next: string, live: boolean) => void, path?: string) => {
    const shown = path ? at(path, String(value ?? fallback)) : String(value ?? fallback);
    return <Row label={t(label)}><View style={{ flex: 1 }}><ColorPicker brandColors={brand} label={t(label)} value={upper(shown, fallback)} defaultValue={fallback.toUpperCase()} onChange={(next) => write(lower(next), true)} onCommit={(next) => write(lower(next), false)} /></View>{path ? key(path, shown, label) : null}</Row>;
  };
  const size = at("fontSize", Number(element.fontSize ?? 15)), letter = at("letterSpacing", Number(element.letterSpacing ?? 0)), line = at("lineHeight", Number(element.lineHeight ?? 1.2)), curve = at("curve", Number(element.curve ?? 0));
  const content = useRef<{ start: number; end: number }>({ start: stored.length, end: stored.length });
  const switchBox = async (mode: "auto" | "fixed") => {
    // Switching to fixed keeps the layout: the box takes the width the engine laid the block out at.
    const laid = mode === "fixed" ? (await runtime.engine?.layout(ids, runtime.transport.time).catch(() => ({} as Record<string, { width: number }>)))?.[element.id] : undefined;
    const scale = Math.abs(Number(objectOf(objectOf(element.transform).scale).x ?? 1)) || 1;
    runtime.controller.external((doc, ctx) => setTextBoxMode(doc, ctx, element.id, mode, laid ? laid.width / scale : undefined));
  };
  const missing = [
    ...(typeof objectOf(element.bubble).id === "string" && !TEXT_BUBBLES.some((bubble) => bubble.id === objectOf(element.bubble).id) ? [t("Bubble not available in this version")] : []),
    ...(["in", "out", "loop"].some((group) => { const id = objectOf(objectOf(element.textAnimation)[group]).id; return typeof id === "string" && !TEXT_ANIMATIONS.some((animation) => animation.id === id); }) ? [t("Animation not available in this version")] : []),
    ...(typeof element.stylePresetId === "string" && !TEXT_PRESETS.some((preset) => preset.id === element.stylePresetId) ? [t("Text effect not available in this version")] : []),
  ];
  return (
    <>
      <View style={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[1.5] }}>
        <Textarea accessibilityLabel={t("Text")} testID="text-content" value={draft ?? stored} minLines={2} maxLines={6} onFocus={() => setDraft(stored)} onChangeText={type}
          returnKeyType={Platform.OS === "web" ? "default" : "done"} blurOnSubmit={Platform.OS !== "web"} onSubmitEditing={Platform.OS === "web" ? undefined : Keyboard.dismiss}
          onSelectionChange={(event) => { content.current = event.nativeEvent.selection; }}
          onBlur={() => { const next = draft; setDraft(null); if (next !== null && next !== stored) writeContent(next, false); else runtime.controller.discardPreview(); }} />
        <View style={{ position: "absolute", right: space[3] + 2, top: 2 }}><EmojiButton onPick={(emoji) => { const text = draft ?? stored, { start, end } = content.current, next = clampTextContent(text.slice(0, Math.min(start, text.length)) + emoji + text.slice(Math.min(end, text.length))).content; content.current = { start: start + emoji.length, end: start + emoji.length }; if (draft !== null) setDraft(next); writeContent(next, false); }} /></View>
        <Row label={t("Font")} testID="text-font-row">
          <FontPicker value={family} onPreview={(next) => set({ fontFamily: next }, "Font", true)} onDiscard={() => runtime.controller.discardPreview()}
            onCommit={(next) => set({ fontFamily: next, fontWeight: availableWeights(next, BUNDLED_FACES).includes(weight) ? weight : toggledBoldWeight(weight >= 600 ? 400 : 700, availableWeights(next, BUNDLED_FACES)) }, "Font")} />
          <View style={{ width: 96 }} testID="text-weight"><Select label={t("Weight")} size="sm" value={String(weight)} options={(weights.length ? weights : [weight]).map((entry) => ({ value: String(entry), label: `${t(FONT_WEIGHT_NAMES[entry] ?? "Regular")} ${entry}` }))} onChange={(next) => set({ fontWeight: Number(next) }, "Font weight")} /></View>
        </Row>
        {available ? null : <Note tone="warning" testID="font-fallback">{t("Font unavailable — using fallback")}</Note>}
        {missing.map((message) => <Note key={message} tone="warning">{message}</Note>)}
        <Row label={t("Style")}>
          <IconButton icon="bold" size="sm" variant="outline" label={t("Bold")} testID="text-bold" on={weight >= 600} toggle onPress={() => set({ fontWeight: toggledBoldWeight(weight, weights.length ? weights : [400, 700]) }, "Bold")} />
          <IconButton icon="italic" size="sm" variant="outline" label={t("Italic")} testID="text-italic" on={element.fontStyle === "italic"} toggle onPress={() => set({ fontStyle: element.fontStyle === "italic" ? "normal" : "italic" }, "Italic")} />
          <IconButton icon="underline" size="sm" variant="outline" label={t("Underline")} testID="text-underline" on={element.underline === true} toggle onPress={() => set({ underline: element.underline !== true }, "Underline")} />
          <IconButton icon="strike" size="sm" variant="outline" label={t("Strikethrough")} testID="text-strike" on={element.strikethrough === true} toggle onPress={() => set({ strikethrough: element.strikethrough !== true }, "Strikethrough")} />
          <View style={{ flex: 1 }} testID="text-size"><NumberField label={t("Size")} size="sm" min={1} max={500} step={0.5} value={size} onChange={(next) => put("fontSize", storedFontSize(next), "Font size", true)} onCommit={(next) => put("fontSize", storedFontSize(next), "Font size")} /></View>
          {key("fontSize", size, "Font size")}
        </Row>
        <Row label={t("Case")}>
          <View style={{ flex: 1 }} testID="text-case"><Select label={t("Case")} size="sm" value={String(element.textCase ?? "none")} options={CASES.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => set({ textCase: next }, "Case")} /></View>
          <View testID="text-align"><Segmented label={t("Alignment")} size="sm" value={String(element.textAlign ?? "center") as "left"} onChange={(next) => set({ textAlign: next }, "Alignment")}
            options={[{ value: "left", label: t("Align left"), icon: "al-l", iconOnly: true }, { value: "center", label: t("Align center"), icon: "al-c", iconOnly: true }, { value: "right", label: t("Align right"), icon: "al-r", iconOnly: true }, { value: "justify", label: t("Justify"), icon: "al-j", iconOnly: true }]} /></View>
        </Row>
        <Row label={t("Spacing")}>
          {number(t("Letter"), letter, 0, (next, live) => put("letterSpacing", Math.round(next * 10) / 10, "Letter spacing", live), { min: -100, max: 500, step: 1 })}
          {key("letterSpacing", letter, "Letter spacing")}
          {number(t("Line"), line, 1.2, (next, live) => put("lineHeight", Math.round(next * 10) / 10, "Line height", live), { min: 0.1, max: 10, step: 0.1 })}
          {key("lineHeight", line, "Line height")}
        </Row>
        <Row label={t("Text box")}>
          <View testID="text-box-mode"><Segmented label={t("Text box")} size="sm" value={box.mode === "fixed" ? "fixed" : "auto"} options={[{ value: "auto", label: t("Auto") }, { value: "fixed", label: t("Fixed") }]} onChange={(next) => void switchBox(next)} /></View>
          <View style={{ flex: 1 }} testID="text-box-width"><NumberField label="W" size="sm" unit="%" min={5} max={400} step={1} disabled={box.mode !== "fixed"} value={box.mode === "fixed" ? Number(box.width ?? 80) : null} onChange={(next) => setIn("box", { width: Math.round(next * 10) / 10 }, "Text box", true)} onCommit={(next) => setIn("box", { width: Math.round(next * 10) / 10 }, "Text box")} /></View>
        </Row>
        <Row label={t("Curve")} testID="text-curve">
          <View style={{ flex: 1 }}><Slider label={t("Curve")} min={-360} max={360} step={1} centre value={curve} defaultValue={0} onChange={(next) => put("curve", Math.round(next as number), "Curve", true)} onCommit={(next) => put("curve", Math.round(next as number), "Curve")} /></View>
          <NumberField label={t("Curve")} hideLabel size="sm" width={64} unit="°" min={-360} max={360} step={1} value={Math.round(curve)} onCommit={(next) => put("curve", Math.round(next), "Curve")} />
          {key("curve", curve, "Curve")}
        </Row>
      </View>
      <Section id="text-fill" title={t("Fill")} testID="text-fill" enabled={fillOn(color)} onToggle={(on) => set({ color: `${color.slice(0, 7)}${on ? "" : "00"}` }, "Fill")}>
        {colour("Colour", color, "#ffffff", (next, live) => put("color", next, "Fill colour", live), "color")}
        <Row label={t("Type")}><View testID="text-fill-type"><Segmented label={t("Fill type")} size="sm" value={fill.type === "gradient" ? "gradient" : "solid"} options={[{ value: "solid", label: t("Solid") }, { value: "gradient", label: t("Gradient") }]} onChange={(next) => setIn("fill", { type: next }, "Fill")} /></View></Row>
        {fill.type === "gradient" ? (
          <>
            {colour("To", fill.gradientColor, "#ffd400", (next, live) => put("fill.gradientColor", next, "Gradient colour", live), "fill.gradientColor")}
            {slider("Angle", "fill", "gradientAngle", fill.gradientAngle, 90, 360, 1, "°")}
          </>
        ) : null}
      </Section>
      <Section id="text-stroke" title={t("Stroke")} testID="text-stroke" enabled={stroke.enabled === true} onToggle={(on) => setIn("stroke", { enabled: on }, "Stroke")}>
        {colour("Colour", stroke.color, "#000000", (next, live) => put("stroke.color", next, "Stroke colour", live), "stroke.color")}
        {slider("Width", "stroke", "width", stroke.width, 6, 50, 0.5)}
        <Row label={t("Position")}><View style={{ flex: 1 }}><Select label={t("Stroke position")} size="sm" value={String(stroke.position ?? "outside")} options={[{ value: "outside", label: t("Outside") }, { value: "center", label: t("Center") }]} onChange={(next) => setIn("stroke", { position: next }, "Stroke")} /></View></Row>
      </Section>
      <Section id="text-shadow" title={t("Shadow")} testID="text-shadow" enabled={shadow.enabled === true} onToggle={(on) => setIn("shadow", { enabled: on }, "Shadow")}>
        {colour("Colour", shadow.color, "#000000", (next, live) => put("shadow.color", next.slice(0, 7), "Shadow colour", live), "shadow.color")}
        {slider("Opacity", "shadow", "opacity", shadow.opacity, 80, 100)}
        {slider("Blur", "shadow", "blur", shadow.blur, 10, 100)}
        {slider("Distance", "shadow", "distance", shadow.distance, 5, 100)}
        {slider("Angle", "shadow", "angle", shadow.angle, -45, 180, 1, "°", -180)}
      </Section>
      <Section id="text-glow" title={t("Glow")} testID="text-glow" enabled={glow.enabled === true} onToggle={(on) => setIn("glow", { enabled: on }, "Glow")}>
        {colour("Colour", glow.color, "#ffffff", (next, live) => put("glow.color", next.slice(0, 7), "Glow colour", live), "glow.color")}
        {slider("Intensity", "glow", "intensity", glow.intensity, 50, 100, 1, "")}
        {slider("Radius", "glow", "radius", glow.radius, 20, 100)}
      </Section>
      <Section id="text-background" title={t("Background")} testID="text-background" enabled={background.enabled === true} onToggle={(on) => { runtime.controller.external((doc, ctx) => setTextBackground(doc, ctx, element.id, { enabled: on })); }}>
        {colour("Colour", background.color, "#000000", (next, live) => put("background.color", next, "Background colour", live), "background.color")}
        {slider("Radius", "background", "cornerRadius", background.cornerRadius, 0, 100, 1, "")}
        <Row label={t("Padding")}>
          {number("X", background.paddingX, 30, (next, live) => setIn("background", { paddingX: Math.round(next) }, "Background padding", live), { min: 0, max: 1000, step: 1 })}
          {number("Y", background.paddingY, 42, (next, live) => setIn("background", { paddingY: Math.round(next) }, "Background padding", live), { min: 0, max: 1000, step: 1 })}
        </Row>
        <Row label={t("Offset")}>
          {number("X", background.offsetX, 0, (next, live) => setIn("background", { offsetX: Math.round(next) }, "Background offset", live), { min: -100_000, max: 100_000, step: 1 })}
          {number("Y", background.offsetY, 0, (next, live) => setIn("background", { offsetY: Math.round(next) }, "Background offset", live), { min: -100_000, max: 100_000, step: 1 })}
        </Row>
      </Section>
    </>
  );
}

/** Copy style, Paste style, Save as preset, and "Apply to all text" in the overflow menu. */
function StyleActions(props: { element: El }) {
  const t = useT();
  const toast = useToast();
  const runtime = useEditor();
  const { controller } = runtime, { element } = props;
  const copied = useCopiedTextStyle();
  const [presets, setPresets] = usePref(SAVED_TEXT_PRESETS);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const nextId = useRef(0);
  const others = otherTextElements(controller.stored, controller.session.sceneId, element.id);
  const selectedText = controller.session.selection.selectedElements.filter((id) => ["text", "caption"].includes(String(timeline.locate(controller.stored, id)?.element.type)));
  const save = (onDuplicate?: "replace" | "keep-both") => {
    const result = saveTextPreset(presets, { id: `preset-${Date.now()}-${nextId.current++}`, name, style: copyTextStyle(controller.stored, element.id), animation: element.textAnimation, savedAt_ms: Date.now() }, onDuplicate);
    if (result.ok) { setPresets(result.presets); setSaving(false); setDuplicate(false); toast.show({ kind: "success", message: t("Preset saved") }); return; }
    if (result.reason === "duplicate") setDuplicate(true);
    else toast.show({ kind: "warning", message: t(result.message) });
  };
  return (
    <View testID="text-style-actions" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], padding: space[3] }}>
      <Button size="sm" label={t("Copy style")} onPress={() => { setCopiedTextStyle(copyTextStyle(controller.stored, element.id)); toast.show({ kind: "success", message: t("Style copied") }); }} />
      <Button size="sm" label={t("Paste style")} disabled={copied === null} onPress={() => { if (copied) controller.external((doc, ctx) => pasteTextStyle(doc, ctx, selectedText.length ? selectedText : [element.id], copied)); }} />
      <View style={{ flex: 1 }} />
      <Button size="sm" kind="outline" label={t("Save as preset")} onPress={() => { setName(""); setDuplicate(false); setSaving(true); }} />
      <MenuButton label={t("More text actions")} icon="more" kind="ghost" size="sm" items={[{ id: "apply-all", label: t("Apply to all text"), disabled: others.length === 0, onSelect: () => setApplyAll(true) }]} />
      {saving ? (
        <Modal title={t("Save as preset")} width={360} onClose={() => setSaving(false)}
          footer={duplicate
            ? <><Button size="sm" label={t("Cancel")} onPress={() => setSaving(false)} /><View style={{ flex: 1 }} /><Button size="sm" label={t("Keep both")} onPress={() => save("keep-both")} /><Button size="sm" kind="primary" label={t("Replace")} onPress={() => save("replace")} /></>
            : <><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={() => setSaving(false)} /><Button size="sm" kind="primary" label={t("Save")} testID="preset-save" disabled={name.trim().length === 0} onPress={() => save()} /></>}>
          <View style={{ gap: space[2] }}>
            <Input accessibilityLabel={t("Preset name")} placeholder={t("Preset name")} testID="preset-name" autoFocus maxLength={60} value={name} onChangeText={(next) => { setName(next); setDuplicate(false); }} onSubmitEditing={() => { if (name.trim()) save(); }} />
            {duplicate ? <Text variant="meta" color="text/secondary">{t("A preset with this name already exists")}</Text> : null}
          </View>
        </Modal>
      ) : null}
      <ConfirmDialog open={applyAll} title={t("Apply to all text")} description={t("This style will be applied to {n} text elements in this scene.", { n: others.length })} confirmLabel={t("Apply")} onClose={() => setApplyAll(false)}
        onConfirm={() => { setApplyAll(false); controller.external((doc, ctx) => applyStyleToAllText(doc, ctx, controller.session.sceneId, element.id)); }} />
    </View>
  );
}

/** The Text-to-speech tab: the tool runs on a host, so without one the tab states that and the action stays disabled. */
export function TextToSpeechTab(props: { text: string; connected: boolean; onOpenSettings(): void }) {
  const t = useT();
  const empty = props.text.trim().length === 0;
  return (
    <View testID="tts-tab" style={{ padding: space[3], gap: space[2] }}>
      <Text variant="body-medium">{t("Text to speech")}</Text>
      <Note testID="tts-state">{t(props.connected ? "No provider is configured for speech" : "Connect to a host to use this tool")}</Note>
      <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
        <Button size="sm" kind="primary" icon="voice" label={t("Generate speech")} disabled testID="tts-generate" />
        <Button size="sm" kind="ghost" label={t("Connection settings")} testID="tts-settings" onPress={props.onOpenSettings} />
      </View>
      {empty ? <Text variant="meta" color="text/secondary">{t("Add text first")}</Text> : null}
    </View>
  );
}
