import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { availableWeights } from "@jagentchill/app-core";
import {
  applyCaptionStyle, CAPTION_STYLES, FONT_WEIGHT_NAMES, formatTimecode, mergeCaptionWithPrevious, overrideCaptionStyle, parseTimecode, setCaptionText, setCaptionTiming, setCaptionTrack, setElementFields, splitCaption, storedFontSize, timeline,
  toggledBoldWeight,
} from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { Button, ColorPicker, IconButton, Input, NumberField, Segmented, Select, Slider, Switch, Tap, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor } from "../context";
import { BUNDLED_FACES } from "../fonts.gen";
import { setCaptionApplyAll, useCaptionApplyAll } from "./caption-store";
import { FontPicker } from "./FontPicker";
import { elementOf, Note, objectOf, Row, Section } from "./parts";

type El = timeline.El;
type Obj = Record<string, unknown>;
/** The highlight styles of a caption track; `background` shows its text colour and `scale` its factor. */
const HIGHLIGHTS = [{ value: "none", label: "None" }, { value: "color", label: "Colour" }, { value: "background", label: "Box" }, { value: "scale", label: "Scale" }, { value: "underline", label: "Underline" }, { value: "karaoke", label: "Karaoke" }, { value: "reveal", label: "Reveal" }] as const;
const ANCHORS = [{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }] as const;

/**
 * The Captions tab of a selected caption: its text and timing, Split at caret and Merge with previous, then the
 * sections Style (the 24 bundled styles), Word highlight and Layout of its track. "Apply to all" decides whether a
 * style goes to the track or to this caption alone; what exists only per track is disabled while it is off.
 */
export function CaptionInspector(props: { element: El }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const applyAll = useCaptionApplyAll();
  const { controller } = runtime, { element } = props, fps = controller.stored.settings.fps as Rational;
  const located = timeline.locate(controller.document, element.id), track = located?.track, caption = objectOf(track?.caption), highlight = objectOf(caption.highlight), layout = objectOf(caption.layout), bilingual = objectOf(caption.bilingual);
  const stored = String(elementOf(controller.stored, element.id)?.text ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const [caret, setCaret] = useState(stored.length);
  const [times, setTimes] = useState<{ start?: string; end?: string }>({});
  const end = element.startTime + element.duration;
  const commitTime = (side: "start" | "end") => {
    const typed = times[side];
    setTimes(({ [side]: _gone, ...rest }) => rest);
    const parsed = typed === undefined ? null : parseTimecode(typed.trim(), "HH:MM:SS:FF", fps);
    if (parsed !== null) controller.external((doc, ctx) => setCaptionTiming(doc, ctx, element.id, { [side]: Number(parsed) }));
  };
  const first = track ? [...track.elements].sort((a, b) => a.startTime - b.startTime)[0]?.id === element.id : true;
  if (!track) return null;
  const overridden = element.style !== undefined || element.transform !== undefined;
  const setTrack = (change: Parameters<typeof setCaptionTrack>[3], label: string, live = false) => controller.external((doc, ctx) => setCaptionTrack(doc, ctx, track.id, change, label), live);
  const setHighlight = (change: Obj, live = false) => setTrack({ highlight: change }, "Word highlight", live);
  const setLayout = (change: Obj, live = false) => setTrack({ layout: change }, "Caption layout", live);
  const setFlag = (key: "burnIn" | "showSpeakerLabels", on: boolean) => controller.external((doc, ctx) => setCaptionTrack(doc, ctx, track.id, { [key]: on } as never, "Captions"));
  const style = String(highlight.style ?? "none"), locked = applyAll ? null : { opacity: 0.4 };
  const slider = (label: string, value: number, fallback: number, min: number, max: number, step: number, unit: string, write: (next: number, live: boolean) => void, testID?: string) => (
    <Row label={t(label)} testID={testID}>
      <View style={{ flex: 1 }}><Slider label={t(label)} min={min} max={max} step={step} value={value} defaultValue={fallback} disabled={!applyAll} onChange={(next) => write(next as number, true)} onCommit={(next) => write(next as number, false)} /></View>
      <NumberField label={t(label)} hideLabel size="sm" width={64} unit={unit} min={min} max={max} step={step} disabled={!applyAll} value={value} onCommit={(next) => write(next, false)} />
    </Row>
  );
  return (
    <View testID="caption-inspector">
      <View style={{ padding: space[3], gap: space[1.5] }}>
        <Textarea accessibilityLabel={t("Caption text")} testID="caption-content" value={draft ?? stored} minLines={2} maxLines={5} maxLength={500} onFocus={() => setDraft(stored)} onChangeText={setDraft}
          onSelectionChange={(event) => setCaret(event.nativeEvent.selection.start)}
          onBlur={() => { const next = draft; setDraft(null); if (next !== null && next !== stored) controller.external((doc, ctx) => setCaptionText(doc, ctx, element.id, next)); }} />
        {(["start", "end"] as const).map((side) => (
          <Row key={side} label={t(side === "start" ? "Start" : "End")}>
            <View style={{ flex: 1 }}><Input accessibilityLabel={t(side === "start" ? "Start" : "End")} size="sm" testID={`caption-${side}`} value={times[side] ?? formatTimecode(side === "start" ? element.startTime : end, "HH:MM:SS:FF", fps) ?? ""} onChangeText={(text) => setTimes({ ...times, [side]: text })} onBlur={() => commitTime(side)} onSubmitEditing={() => commitTime(side)} /></View>
          </Row>
        ))}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
          <Button size="sm" label={t("Split at caret")} testID="caption-split" disabled={caret <= 0 || caret >= stored.length} onPress={() => { controller.external((doc, ctx) => splitCaption(doc, ctx, element.id, caret)); }} />
          <Button size="sm" label={t("Merge with previous")} testID="caption-merge" disabled={first} onPress={() => { controller.external((doc, ctx) => mergeCaptionWithPrevious(doc, ctx, element.id)); }} />
          {overridden ? <Button size="sm" kind="ghost" label={t("Reset to track style")} testID="caption-reset-style" onPress={() => { controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { style: undefined, transform: undefined }, { commandType: "caption.style", label: "Caption style" })); }} /> : null}
        </View>
      </View>
      <Section id="caption-style" title={t("Style")} testID="caption-style" trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Text variant="meta" color="text/secondary">{t("Apply to all")}</Text><View testID="caption-apply-all"><Switch accessibilityLabel={t("Apply to all")} value={applyAll} onChange={setCaptionApplyAll} /></View></View>}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: space[2] }}>
          {CAPTION_STYLES.map((entry) => {
            const on = applyAll ? caption.styleId === entry.id && element.style === undefined : false;
            const tint = entry.highlight.style !== "none" && entry.highlight.color ? entry.highlight.color : entry.color;
            return (
              <Tap key={entry.id} role="button" label={t(entry.name)} pressedState={on} testID={`caption-style-${entry.id}`} onPress={() => { controller.external((doc, ctx) => applyCaptionStyle(doc, ctx, track.id, entry.id, applyAll ? undefined : [element.id])); }} style={{ width: "22%", gap: space[1] }}>
                <View style={{ height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: entry.background ? entry.background.color.slice(0, 7) : theme.color("qr/module"), borderWidth: on ? 2 : 1, borderColor: theme.color(on ? "accent/text" : "border/hairline") }}>
                  <Text style={{ color: entry.color, fontSize: 11, lineHeight: 14, fontWeight: entry.fontWeight >= 600 ? "700" : "400", ...(entry.stroke ? ({ WebkitTextStroke: `0.6px ${entry.stroke.color}`, paintOrder: "stroke fill" } as object) : {}) } as never}>Aa <Text style={{ color: tint, fontSize: 11, lineHeight: 14, fontWeight: entry.fontWeight >= 600 ? "700" : "400" } as never}>bb</Text></Text>
                </View>
                <Text variant="caption" numberOfLines={1}>{t(entry.name)}</Text>
              </Tap>
            );
          })}
        </View>
      </Section>
      <Section id="caption-highlight" title={t("Word highlight")} testID="caption-highlight">
        {applyAll ? null : <Note testID="caption-track-only">{t("Applies to the whole track")}</Note>}
        <Row label={t("Style")}><View style={{ flex: 1 }} testID="caption-highlight-style"><Select label={t("Highlight style")} size="sm" disabled={!applyAll} value={style} options={HIGHLIGHTS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => { setHighlight({ style: next }); }} /></View></Row>
        <Row label={t("Colour")}><View style={[{ flex: 1 }, locked]} pointerEvents={applyAll ? "auto" : "none"} testID="caption-highlight-colour"><ColorPicker label={t("Highlight colour")} value={String(highlight.color ?? "#ffd400").toUpperCase()} defaultValue="#FFD400" onChange={(color) => setHighlight({ color: color.toLowerCase() }, true)} onCommit={(color) => { setHighlight({ color: color.toLowerCase() }); }} /></View></Row>
        {style === "background" ? <Row label={t("Text")}><View style={[{ flex: 1 }, locked]} pointerEvents={applyAll ? "auto" : "none"} testID="caption-highlight-text"><ColorPicker label={t("Highlight text colour")} value={String(highlight.textColor ?? "#000000").toUpperCase()} defaultValue="#000000" onChange={(color) => setHighlight({ textColor: color.toLowerCase() }, true)} onCommit={(color) => { setHighlight({ textColor: color.toLowerCase() }); }} /></View></Row> : null}
        {style === "scale" ? slider("Scale", Math.round(Number(highlight.scale ?? 1.2) * 100), 120, 100, 200, 1, "%", (next, live) => setHighlight({ scale: Math.round(next) / 100 }, live), "caption-highlight-scale") : null}
      </Section>
      <Section id="caption-bilingual" title={t("Bilingual")} testID="caption-bilingual">
        {typeof caption.translationLanguage !== "string" ? <Note testID="caption-bilingual-hint">{t("Translate this track to add a second language")}</Note> : (
          <>
            <Row label={t("Show")}><View testID="caption-bilingual-visible"><Switch accessibilityLabel={t("Show translation")} disabled={!applyAll} value={bilingual.visible !== false} onChange={(on) => { setTrack({ bilingual: { visible: on } }, "Bilingual captions"); }} /></View><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Show translation")}</Text></Row>
            <Row label={t("Order")}><View testID="caption-bilingual-order"><Segmented label={t("Translation order")} size="sm" value={bilingual.order === "above" ? "above" : "below"} options={[{ value: "below", label: t("Below") }, { value: "above", label: t("Above") }]} onChange={(next) => { if (applyAll) setTrack({ bilingual: { order: next } }, "Bilingual captions"); }} /></View></Row>
            {slider("Size", Number(bilingual.scale ?? 80), 80, 50, 150, 1, "%", (next, live) => setTrack({ bilingual: { scale: Math.round(next) } }, "Bilingual captions", live), "caption-bilingual-scale")}
            <Row label={t("Colour")}>
              <View testID="caption-bilingual-same"><Switch accessibilityLabel={t("Same as text")} disabled={!applyAll} value={typeof bilingual.color !== "string"} onChange={(same) => { setTrack({ bilingual: { color: same ? undefined : "#ffd400" } }, "Bilingual captions"); }} /></View>
              {typeof bilingual.color === "string" ? <View style={[{ flex: 1 }, locked]} pointerEvents={applyAll ? "auto" : "none"}><ColorPicker label={t("Translation colour")} value={bilingual.color.toUpperCase()} defaultValue="#FFD400" onChange={(color) => setTrack({ bilingual: { color: color.toLowerCase() } }, "Bilingual captions", true)} onCommit={(color) => { setTrack({ bilingual: { color: color.toLowerCase() } }, "Bilingual captions"); }} /></View> : <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Same as text")}</Text>}
            </Row>
          </>
        )}
      </Section>
      <Section id="caption-layout" title={t("Layout")} testID="caption-layout">
        <Row label={t("Anchor")}><View testID="caption-anchor"><Segmented label={t("Anchor")} size="sm" value={String(layout.anchor ?? "bottom") as "top"} options={ANCHORS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => { if (applyAll) setLayout({ anchor: next }); }} /></View></Row>
        {slider("Margin", Number(layout.marginY ?? 5), 5, 0, 50, 0.5, "%", (next, live) => setLayout({ marginY: Math.round(next * 2) / 2 }, live), "caption-margin")}
        {slider("Max width", Number(layout.maxWidth ?? 80), 80, 20, 100, 1, "%", (next, live) => setLayout({ maxWidth: Math.round(next) }, live), "caption-max-width")}
        {slider("Scale", Math.round(Number(layout.scale ?? 1) * 100), 100, 10, 1000, 1, "%", (next, live) => setLayout({ scale: Math.round(next) / 100 }, live), "caption-scale")}
        <Row label={t("Position")}><Button size="sm" kind="outline" label={t("Reset position")} testID="caption-reset-position" onPress={() => { if (applyAll) setLayout({ offset: { x: 0, y: 0 } }); else controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { transform: undefined }, { commandType: "caption.style", label: "Caption layout" })); }} /></Row>
        <Row label={t("Speakers")}><View testID="caption-speakers"><Switch accessibilityLabel={t("Show speaker labels")} disabled={!applyAll} value={caption.showSpeakerLabels === true} onChange={(on) => { setFlag("showSpeakerLabels", on); }} /></View><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Show speaker labels")}</Text></Row>
        <Row label={t("Burn-in")}><View testID="caption-burn-in"><Switch accessibilityLabel={t("Burn-in")} disabled={!applyAll} value={caption.burnIn !== false} onChange={(on) => { setFlag("burnIn", on); }} /></View></Row>
      </Section>
    </View>
  );
}

const CASES = [{ value: "none", label: "None" }, { value: "upper", label: "UPPERCASE" }, { value: "lower", label: "lowercase" }, { value: "title", label: "Title Case" }] as const;
/**
 * The Text tab of a selected caption: font, size, fill, stroke, shadow, glow, background, alignment and spacing of the
 * track style ("Apply to all" on) or of this caption's own override.
 */
export function CaptionTextTab(props: { element: El }) {
  const t = useT();
  const runtime = useEditor();
  const applyAll = useCaptionApplyAll();
  const { controller } = runtime, { element } = props;
  const track = timeline.locate(controller.document, element.id)?.track;
  if (!track) return null;
  const trackStyle = objectOf(objectOf(track.caption).style), own = objectOf(element.style);
  // What the caption shows: the track style with the caption's own override on top, one level deep.
  const style: Obj = { ...trackStyle };
  for (const [key, value] of Object.entries(own)) style[key] = value !== null && typeof value === "object" ? { ...objectOf(trackStyle[key]), ...(value as Obj) } : value;
  const write = (change: Obj, label: string, live = false) => controller.external((doc, ctx) => {
    if (!applyAll) return overrideCaptionStyle(doc, ctx, element.id, change);
    const before = objectOf(objectOf(timeline.locate(doc, element.id)?.track.caption).style), next: Obj = {};
    for (const [key, value] of Object.entries(change)) next[key] = value !== null && typeof value === "object" ? { ...objectOf(before[key]), ...(value as Obj) } : value;
    return setCaptionTrack(doc, ctx, track.id, { style: next }, label);
  }, live);
  const part = (key: string) => objectOf(style[key]);
  const family = String(style.fontFamily ?? "Arial"), weight = Number(style.fontWeight ?? 700), weights = availableWeights(family, BUNDLED_FACES);
  const colour = (label: string, value: unknown, fallback: string, change: (next: string) => Obj, step: string) => (
    <Row label={t(label)}><View style={{ flex: 1 }}><ColorPicker label={t(label)} value={String(value ?? fallback).toUpperCase()} defaultValue={fallback.toUpperCase()} onChange={(next) => write(change(next.toLowerCase()), step, true)} onCommit={(next) => { write(change(next.toLowerCase()), step); }} /></View></Row>
  );
  const slider = (label: string, group: string, field: string, fallback: number, max: number, unit = "%", min = 0, step = 1) => (
    <Row label={t(label)}>
      <View style={{ flex: 1 }}><Slider label={t(label)} min={min} max={max} step={step} value={Number(part(group)[field] ?? fallback)} defaultValue={fallback} onChange={(next) => write({ [group]: { [field]: next as number } }, label, true)} onCommit={(next) => { write({ [group]: { [field]: next as number } }, label); }} /></View>
      <NumberField label={t(label)} hideLabel size="sm" width={64} unit={unit} min={min} max={max} step={step} value={Number(part(group)[field] ?? fallback)} onCommit={(next) => { write({ [group]: { [field]: next } }, label); }} />
    </Row>
  );
  const section = (id: string, title: string, group: string, children: ReactNode) => (
    <Section id={`caption-text-${id}`} title={t(title)} testID={`caption-text-${id}`} enabled={part(group).enabled === true} onToggle={(on) => { write({ [group]: { enabled: on } }, title); }}>{children}</Section>
  );
  return (
    <View testID="caption-text-tab">
      <View style={{ padding: space[3], gap: space[1.5] }}>
        {applyAll ? null : <Note>{t("Changes apply to this caption only")}</Note>}
        <Row label={t("Font")}>
          <FontPicker value={family} onPreview={(next) => write({ fontFamily: next }, "Font", true)} onDiscard={() => controller.discardPreview()} onCommit={(next) => { write({ fontFamily: next, fontWeight: availableWeights(next, BUNDLED_FACES).includes(weight) ? weight : toggledBoldWeight(weight >= 600 ? 400 : 700, availableWeights(next, BUNDLED_FACES)) }, "Font"); }} />
          <View style={{ width: 96 }}><Select label={t("Weight")} size="sm" value={String(weight)} options={(weights.length ? weights : [weight]).map((entry) => ({ value: String(entry), label: `${t(FONT_WEIGHT_NAMES[entry] ?? "Regular")} ${entry}` }))} onChange={(next) => { write({ fontWeight: Number(next) }, "Font weight"); }} /></View>
        </Row>
        <Row label={t("Style")}>
          <IconButton icon="bold" size="sm" variant="outline" label={t("Bold")} on={weight >= 600} toggle onPress={() => { write({ fontWeight: toggledBoldWeight(weight, weights.length ? weights : [400, 700]) }, "Bold"); }} />
          <IconButton icon="italic" size="sm" variant="outline" label={t("Italic")} on={style.fontStyle === "italic"} toggle onPress={() => { write({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" }, "Italic"); }} />
          <View style={{ flex: 1 }} testID="caption-text-size"><NumberField label={t("Size")} size="sm" min={1} max={500} step={0.5} value={Number(style.fontSize ?? 5)} onChange={(next) => write({ fontSize: storedFontSize(next) }, "Font size", true)} onCommit={(next) => { write({ fontSize: storedFontSize(next) }, "Font size"); }} /></View>
        </Row>
        <Row label={t("Case")}>
          <View style={{ flex: 1 }}><Select label={t("Case")} size="sm" value={String(style.textCase ?? "none")} options={CASES.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => { write({ textCase: next }, "Case"); }} /></View>
          <Segmented label={t("Alignment")} size="sm" value={String(style.textAlign ?? "center") as "left"} onChange={(next) => { write({ textAlign: next }, "Alignment"); }}
            options={[{ value: "left", label: t("Align left"), icon: "al-l", iconOnly: true }, { value: "center", label: t("Align center"), icon: "al-c", iconOnly: true }, { value: "right", label: t("Align right"), icon: "al-r", iconOnly: true }]} />
        </Row>
        <Row label={t("Spacing")}>
          <View style={{ flex: 1 }}><NumberField label={t("Letter")} size="sm" min={-100} max={500} step={1} value={Number(style.letterSpacing ?? 0)} onCommit={(next) => { write({ letterSpacing: Math.round(next * 10) / 10 }, "Letter spacing"); }} /></View>
          <View style={{ flex: 1 }}><NumberField label={t("Line")} size="sm" min={0.1} max={10} step={0.1} value={Number(style.lineHeight ?? 1.2)} onCommit={(next) => { write({ lineHeight: Math.round(next * 10) / 10 }, "Line height"); }} /></View>
        </Row>
        <View testID="caption-text-fill">{colour("Colour", style.color, "#ffffff", (next) => ({ color: next }), "Fill colour")}</View>
      </View>
      {section("stroke", "Stroke", "stroke", <>{colour("Colour", part("stroke").color, "#000000", (next) => ({ stroke: { color: next } }), "Stroke colour")}{slider("Width", "stroke", "width", 6, 50, "%", 0, 0.5)}</>)}
      {section("shadow", "Shadow", "shadow", <>{colour("Colour", part("shadow").color, "#000000", (next) => ({ shadow: { color: next.slice(0, 7) } }), "Shadow colour")}{slider("Opacity", "shadow", "opacity", 80, 100)}{slider("Blur", "shadow", "blur", 10, 100)}{slider("Distance", "shadow", "distance", 5, 100)}{slider("Angle", "shadow", "angle", -45, 180, "°", -180)}</>)}
      {section("glow", "Glow", "glow", <>{colour("Colour", part("glow").color, "#ffffff", (next) => ({ glow: { color: next.slice(0, 7) } }), "Glow colour")}{slider("Intensity", "glow", "intensity", 50, 100, "")}{slider("Radius", "glow", "radius", 20, 100)}</>)}
      {section("background", "Background", "background", <>{colour("Colour", part("background").color, "#000000b3", (next) => ({ background: { color: next } }), "Background colour")}{slider("Radius", "background", "cornerRadius", 0, 100, "")}</>)}
    </View>
  );
}
