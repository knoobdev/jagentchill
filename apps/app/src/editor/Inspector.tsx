import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import {
  chainCommits, clampCropTo, commitTransform, CROP_NONE, CROP_RATIOS, cropForRatio, durationBadge, EDITOR_PREFS, frameRateLabel, hasKeyframes, presetOf, transformOf, type Crop,
} from "@jagentchill/app-core";
import { isAdjustable, isClipAnimatable, isKeyable, isMaskable, setElementFields, timeline, toggleKeyframe, toggleState, upsertKeyframe, type Commit, type CommitContext } from "@jagentchill/editor-core";
import { BLEND_MODES, type ProjectDocument } from "@jagentchill/protocol";
import { Button, Icon, IconButton, Modal, NumberField, Select, Slider, Switch, Tabs, Tap, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { usePref } from "../state";
import { refreshHeldTransport, useEditor, useEditorContent, useHeldTransport } from "./context";
import { FxInspectorTab, fxInspectorTabs, TransitionInspector, useSelectedTransition } from "./fx/inspector";
import { ContentBasic, ContentTab, contentTabs } from "./inspector/content";
import { AdjustmentTab } from "./inspector/AdjustmentTab";
import { ClipAnimationTab } from "./inspector/ClipAnimationTab";
import { Diamond } from "./inspector/keys";
import { Act, Field, Pick, Press, Slide, TabStrip, useStableHandlers } from "./inspector/stable";
import { CutoutTab, MaskTab } from "./inspector/MaskTab";
import { SpeedTab } from "./inspector/SpeedTab";

type El = timeline.El;
type Keys = { id: string; time: number; value: unknown }[];
const ROLE: Record<string, string> = { video: "Video", image: "Image", audio: "Audio", text: "Text", caption: "Caption", sticker: "Sticker", graphic: "Shape", effect: "Effect", adjustment: "Adjustment", compound: "Compound clip" };
const keysOf = (element: El, path: string): Keys => (((element.animations ?? {}) as Record<string, { keys?: Keys }>)[path]?.keys ?? []);
/** The value a property shows: the animated value at the playhead when it has keyframes, the stored one otherwise. */
const shownValue = (element: El, path: string, stored: number, local: number): number => { const keys = keysOf(element, path); return keys.length > 0 ? Number(timeline.valueAt(keys as never, local) ?? stored) : stored; };
/** The tabs the inspector offers for a selection, of those whose panels this build has. */
function tabsFor(document: ProjectDocument, element: El): { id: string; label: string }[] {
  const audible = timeline.isAudioCapable(document, element), frozen = timeline.isFreeze(element);
  const speed = timeline.isRetimable(element) ? [{ id: "speed", label: "Speed" }] : [], look = isAdjustable(element) ? [{ id: "adjustment", label: "Adjustment" }] : [];
  // The frame's order: Video, Audio, Speed, Animation, Adjustment.
  const motion = isClipAnimatable(element) ? [{ id: "animation", label: "Animation" }] : [];
  if (element.type === "audio") return [{ id: "audio", label: "Audio" }, ...speed];
  if (element.type === "video" || element.type === "compound") return [{ id: "basic", label: "Video" }, ...(audible && !frozen ? [{ id: "audio", label: "Audio" }] : []), ...speed, ...motion, ...look];
  if (element.type === "adjustment") return [{ id: "adjustment", label: "Parameters" }, { id: "mask", label: "Mask" }];
  if (timeline.isVisual(element)) return [{ id: "basic", label: ROLE[element.type] ?? "Basic" }, ...motion, ...look];
  return [];
}
/** The sub-tabs of the first tab of a picture clip: its transform, its keying and its masks. */
const subTabsFor = (element: El): { id: string; label: string }[] => [{ id: "basic", label: "Basic" }, ...(isKeyable(element) ? [{ id: "cutout", label: "Cutout" }] : []), ...(isMaskable(element) ? [{ id: "mask", label: "Mask" }] : [])];

/** The tabs the inspector offers for a selection, and the sub-tabs of a single picture clip's first tab: the phone editor lists its clip tools from the same. */
export function inspectorTabsOf(document: ProjectDocument, selected: El[]): { tabs: { id: string; label: string }[]; subTabs: { id: string; label: string }[] } {
  const first = selected[0], single = selected.length === 1;
  if (!first) return { tabs: [], subTabs: [] };
  const tabs = fxInspectorTabs(selected, contentTabs(document, selected, single ? tabsFor(document, first) : [...(selected.some(timeline.isVisual) ? [{ id: "basic", label: "Basic" }] : []), ...(selected.every(timeline.isRetimable) ? [{ id: "speed", label: "Speed" }] : []), ...(selected.every(isClipAnimatable) ? [{ id: "animation", label: "Animation" }] : []), ...(selected.some(isAdjustable) ? [{ id: "adjustment", label: "Adjustment" }] : [])]));
  return { tabs, subTabs: single && first.type !== "text" && tabs.some((tab) => tab.id === "basic") ? subTabsFor(first) : [] };
}

/** The inspector region: the project's details with nothing selected, otherwise the tabs of the selection. */
export const Inspector = memo(function Inspector(props: { onModify(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  // The project and the selection: a scroll, a zoom or a seek of the timeline does not render the inspector again, and
  // with nothing selected it does not follow the clock at all (`SelectionInspector` does, for the values under the playhead).
  useEditorContent();
  const { controller } = runtime, session = controller.session, document = controller.document;
  const selected = timeline.elementsOfScene(timeline.sceneById(document, session.sceneId)).filter((element) => session.selection.selectedElements.includes(element.id));
  const transitionId = useSelectedTransition();
  if (selected.length === 0 && transitionId) return <TransitionInspector transitionId={transitionId} />;
  if (selected.length === 0) {
    const size = document.settings.canvasSize;
    const rows: [string, string][] = [[t("Name"), document.metadata.name], [t("Aspect ratio"), presetOf(size)?.ratio ?? t("Custom")], [t("Resolution"), `${size.width} × ${size.height}`], [t("Frame rate"), t("{fps} fps", { fps: frameRateLabel(document.settings.fps) })], [t("Duration"), durationBadge(runtime.duration())]];
    return (
      <View testID="inspector" style={{ flex: 1, minWidth: 0, padding: space[3], gap: space[3] }}>
        <View testID="inspector-details" style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, padding: space[3], gap: space[2] }}>
          <Text variant="body-medium" level={2}>{t("Details")}</Text>
          {rows.map(([label, value]) => <View key={label} style={{ flexDirection: "row", gap: space[2] }}><Text variant="meta" color="text/secondary" style={{ width: 96 }}>{label}</Text><Text variant="meta" numberOfLines={1} style={{ flex: 1 }}>{value}</Text></View>)}
          <View style={{ flexDirection: "row" }}><Button size="sm" kind="outline" label={t("Modify")} testID="inspector-modify" onPress={props.onModify} /></View>
        </View>
        <Text variant="meta" color="text/secondary">{t("Select an element on the timeline or canvas to edit its properties.")}</Text>
      </View>
    );
  }
  return <SelectionInspector selected={selected} />;
});
/**
 * The tabs of the selection. The values it shows are those under the playhead. While it plays they stay as they were
 * when playback started (playing renders nothing here); they are those of the true time again when it stops, and the
 * moment the person presses or types in the inspector — what is changed then is written at the time that is shown.
 */
function SelectionInspector(props: { selected: El[] }) {
  const t = useT();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const root = useRef<View>(null);
  useEffect(() => {
    const node = root.current as unknown as { addEventListener?(type: string, listener: () => void, capture: boolean): void; removeEventListener?(type: string, listener: () => void, capture: boolean): void } | null;
    if (!node?.addEventListener) return;
    const reached = () => { if (runtime.transport.playing) refreshHeldTransport(runtime); };
    node.addEventListener("pointerdown", reached, true); node.addEventListener("keydown", reached, true);
    return () => { node.removeEventListener?.("pointerdown", reached, true); node.removeEventListener?.("keydown", reached, true); };
  }, [runtime]);
  const document = runtime.controller.document, { selected } = props;
  const [tabs, setTabs] = usePref(EDITOR_PREFS.inspectorTabs);
  const first = selected[0], single = selected.length === 1;
  const offered = inspectorTabsOf(document, selected).tabs;
  const active = offered.find((tab) => tab.id === tabs[first.type])?.id ?? offered[0]?.id;
  const local = Math.max(0, transport.time - first.startTime);
  const subTabs = single && active === "basic" && first.type !== "text" ? subTabsFor(first) : [{ id: "basic", label: "Basic" }], sub = subTabs.find((tab) => tab.id === tabs[`${first.type}.sub`])?.id ?? "basic";
  // The tab strips are drawn again when their tabs or the chosen one change, not for every other clip of the same kind.
  const offeredKey = offered.map((tab) => `${tab.id}:${tab.label}`).join("|"), subKey = subTabs.map((tab) => `${tab.id}:${tab.label}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offeredItems = useMemo(() => offered.map((tab) => ({ id: tab.id, label: t(tab.label) })), [offeredKey, t]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subItems = useMemo(() => subTabs.map((tab) => ({ id: tab.id, label: t(tab.label) })), [subKey, t]);
  const on = useStableHandlers({ tab: (id: string) => setTabs({ ...tabs, [first.type]: id }), sub: (id: string) => setTabs({ ...tabs, [`${first.type}.sub`]: id }) });
  return (
    <View ref={root} testID="inspector" accessibilityLabel={single ? `${t(ROLE[first.type] ?? "Clip")}: ${first.type === "text" ? String(first.content ?? first.name) : first.name}` : undefined} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* One element is named by its tab; several are counted. */}
      {single ? null : <View style={{ height: 28, justifyContent: "center", paddingHorizontal: space[3] }}><Text variant="meta" color="text/secondary" numberOfLines={1} testID="inspector-header">{t("{n} elements selected", { n: selected.length })}</Text></View>}
      {offered.length > 0 ? <TabStrip id="inspector" label={t("Inspector")} items={offeredItems} value={active!} onChange={on.tab} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[4] }}>
        {active === "basic" && subTabs.length > 1 ? <View style={{ paddingHorizontal: space[3], paddingTop: space[2] }}><TabStrip id="inspector-sub" variant="pill" size="xs" label={t("Video")} items={subItems} value={sub} onChange={on.sub} /></View> : null}
        {active === "basic" && sub === "basic" ? <ContentBasic elements={selected}><BasicTab elements={selected.filter(timeline.isVisual)} local={local} playhead={transport.time} /></ContentBasic> : null}
        {active === "basic" && sub === "cutout" && single ? <CutoutTab element={first} /> : null}
        {(active === "basic" && sub === "mask" && single) || (active === "mask" && single) ? <MaskTab element={first} /> : null}
        {active === "speed" ? <SpeedTab elements={selected.filter(timeline.isRetimable)} /> : null}
        {active === "animation" && selected.every(isClipAnimatable) ? <ClipAnimationTab elements={selected} playhead={transport.time} /> : null}
        {active === "adjustment" ? <AdjustmentTab elements={selected} /> : null}
        <ContentTab active={active} elements={selected} />
        <FxInspectorTab active={active} elements={selected} playhead={transport.time} />
        {offered.length === 0 ? <View style={{ padding: space[3] }}><Text variant="meta" color="text/secondary">{t("This element has no properties to edit here.")}</Text></View> : null}
      </ScrollView>
    </View>
  );
}

const SECTION_BODY = { paddingHorizontal: space[3], paddingTop: space[1], paddingBottom: space[3], gap: space[1.5] }, SECTION_TITLE = { flex: 1, flexDirection: "row", alignItems: "center", gap: space[1.5], height: 28 } as const;
const ROW = { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 } as const, ROW_LABEL = { width: 80 }, GROW = { flex: 1 };
/** The header of a section: drawn again when it opens or closes, not with the values under it. `action` is an element its owner keeps (`useMemo`). */
const SectionHeader = memo(function SectionHeader(props: { id: string; title: string; action?: ReactNode }) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = usePref(EDITOR_PREFS.inspectorCollapsed);
  const open = collapsed[props.id] !== true;
  return (
    <View style={{ height: 32, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <Tap role="button" label={props.title} expanded={open} onPress={() => setCollapsed({ ...collapsed, [props.id]: open })} style={SECTION_TITLE}>
        <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" /><Text variant="body-medium">{props.title}</Text>
      </Tap>
      {props.action}
    </View>
  );
});
function Section(props: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  const [collapsed] = usePref(EDITOR_PREFS.inspectorCollapsed);
  const open = collapsed[props.id] !== true;
  return (
    <View>
      <SectionHeader id={props.id} title={props.title} action={props.action} />
      {open ? <View style={SECTION_BODY}>{props.children}</View> : null}
    </View>
  );
}
const RowLabel = memo(function RowLabel(props: { label: string }) { return <Text variant="meta" color="text/secondary" style={ROW_LABEL}>{props.label}</Text>; });
function Row(props: { label: string; children: ReactNode }) {
  return <View style={ROW}><RowLabel label={props.label} />{props.children}</View>;
}
/** A control that takes the free width of its row. One component, so that the box around the control is not drawn again when the control is not. */
const GrowField = memo(function GrowField(props: Parameters<typeof Field>[0]) { return <View style={GROW}><Field {...props} /></View>; });
const GrowSlide = memo(function GrowSlide(props: Parameters<typeof Slide>[0]) { return <View style={GROW}><Slide {...props} /></View>; });
/** The keyframe toggle of a property (its stored channels together): hollow, half-filled or filled; pressing adds a key with the shown value or removes the key under the playhead. */
function KeyToggle(props: { element: El; paths: string[]; local: number; values: number[]; label: string }) {
  const t = useT();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const { element } = props, time = Math.round(Math.min(element.duration, Math.max(0, props.local)));
  const inside = transport.time >= element.startTime && transport.time <= element.startTime + element.duration;
  const states = props.paths.map((path) => toggleState(element, path, time)), on = states.every((state) => state === "filled"), state = on ? "filled" : states.some((entry) => entry !== "hollow") ? "half" : "hollow";
  const press = useStableHandlers({ toggle: () => runtime.controller.external((doc, ctx) => chainCommits(doc, ctx, on ? "Remove keyframe" : "Add keyframe", "keyframe.toggle", props.paths.flatMap((path, index) => (on || toggleState(element, path, time) !== "filled" ? [(before: ProjectDocument, context: CommitContext): Commit | null => toggleKeyframe(before, context, element.id, path, time, props.values[index])] : [])))) });
  return <KeyButton on={on} state={state} inside={inside} name={props.label} testID={`kf-${props.paths[0]}`} onPress={press.toggle} />;
}
const KEY_BUTTON = { width: 20, height: 20, alignItems: "center", justifyContent: "center" } as const;
/** The diamond itself: drawn again when its state changes, not for another clip whose property is in the same state. */
const KeyButton = memo(function KeyButton(props: { on: boolean; state: "hollow" | "half" | "filled"; inside: boolean; name: string; testID: string; onPress(): void }) {
  const t = useT();
  const { on, inside } = props;
  const tooltip = useMemo(() => ({ label: !inside ? t("Move the playhead onto the clip to add a keyframe") : t(on ? "Remove keyframe" : "Add keyframe") }), [t, on, inside]);
  return (
    <Tap role="button" label={t(on ? "Remove keyframe: {name}" : "Add keyframe: {name}", { name: props.name })} pressedState={on} disabled={!inside} tooltip={tooltip} testID={props.testID} onPress={props.onPress} style={KEY_BUTTON}>
      <Diamond state={props.state} disabled={!inside} />
    </Tap>
  );
});

/** Transform and Blend of the selected visual elements. A value typed here applies to every one of them as one step. */
function BasicTab(props: { elements: El[]; local: number; playhead: number }) {
  const t = useT();
  const runtime = useEditor();
  const { controller } = runtime;
  const [locks, setLocks] = usePref(EDITOR_PREFS.inspectorCollapsed);
  const { elements } = props, first = elements[0] as El | undefined;
  const single = elements.length === 1, lockKey = `uniform:${first?.type}`, uniform = locks[lockKey] !== false;
  const value = (path: string, read: (element: El) => number): number | null => { const all = elements.map((element) => shownValue(element, path, read(element), Math.max(0, props.playhead - element.startTime))); return all.length > 0 && all.every((entry) => Math.abs(entry - all[0]) < 1e-9) ? all[0] : null; };
  const x = value("transform.position.x", (element) => transformOf(element).position.x), y = value("transform.position.y", (element) => transformOf(element).position.y);
  const sx = value("transform.scale.x", (element) => transformOf(element).scale.x), sy = value("transform.scale.y", (element) => transformOf(element).scale.y);
  const rotation = value("transform.rotation", (element) => transformOf(element).rotation);
  const opacity = value("opacity", (element) => Number(element.opacity ?? 1));
  const blend = first && elements.every((element) => (element.blendMode ?? "normal") === (first.blendMode ?? "normal")) ? String(first.blendMode ?? "normal") : null;
  /** One step over every selected element; `live` draws without recording. */
  const write = (change: (element: El) => Parameters<typeof commitTransform>[4], label: string, live = false) => controller.external((doc, ctx) => chainCommits(doc, ctx, label, "element.transform", elements.map((element) => (before: ProjectDocument, context: CommitContext) => commitTransform(before, context, element.id, props.playhead, change(element), label))), live);
  const scaleTo = (element: El, percent: number, axis?: "x" | "y") => {
    const current = transformOf(element).scale, factor = percent / 100;
    if (!uniform && axis) return { scale: { ...current, [axis]: factor } };
    // The lock multiplies both axes by one factor, so an existing X:Y ratio survives.
    const ratio = factor / (current.x || 1);
    return { scale: { x: factor, y: Math.min(100, Math.max(0.01, current.y * ratio)) } };
  };
  const setOpacity = (percent: number, live: boolean) => controller.external((doc, ctx) => chainCommits(doc, ctx, "Opacity", "element.opacity", elements.map((element) => (before: ProjectDocument, context: CommitContext) =>
    (hasKeyframes(element, "opacity") ? upsertKeyframe(before, context, element.id, "opacity", { time: Math.max(0, Math.round(props.playhead - element.startTime)), value: percent / 100 }) : setElementFields(before, context, element.id, { opacity: percent / 100 }, { commandType: "element.opacity", label: "Opacity" })))), live);
  const croppable = !!first && single && ["video", "image", "compound"].includes(first.type);
  // What the controls call. Each keeps one identity (`useStableHandlers`) and runs the function of the render that is on
  // screen: the controls are drawn again when their value changes, not for every other clip that is selected.
  const on = useStableHandlers({
    xLive: (next: number) => write((element) => ({ position: { x: next, y: transformOf(element).position.y } }), "Position", true),
    x: (next: number) => write((element) => ({ position: { x: next, y: transformOf(element).position.y } }), "Position"),
    yLive: (next: number) => write((element) => ({ position: { x: transformOf(element).position.x, y: next } }), "Position", true),
    y: (next: number) => write((element) => ({ position: { x: transformOf(element).position.x, y: next } }), "Position"),
    scaleLive: (next: number | [number, number]) => write((element) => scaleTo(element, next as number), "Scale", true),
    scale: (next: number | [number, number]) => write((element) => scaleTo(element, next as number), "Scale"),
    scaleX: (next: number) => write((element) => scaleTo(element, next, "x"), "Scale"),
    scaleY: (next: number) => write((element) => scaleTo(element, next, "y"), "Scale"),
    uniform: () => setLocks({ ...locks, [lockKey]: !uniform }),
    rotationLive: (next: number) => write(() => ({ rotation: next }), "Rotation", true),
    rotation: (next: number) => write(() => ({ rotation: next }), "Rotation"),
    reset: () => runtime.act("preview.reset-transform"), mirror: () => runtime.act("preview.mirror"), flip: () => runtime.act("preview.flip-vertical"),
    crop: () => runtime.setTool({ crop: runtime.tool.crop === first?.id ? null : first?.id ?? null }),
    opacityLive: (next: number | [number, number]) => setOpacity(next as number, true),
    opacity: (next: number | [number, number]) => setOpacity(next as number, false),
    blend: (mode: string) => controller.external((doc, ctx) => chainCommits(doc, ctx, "Blend mode", "element.blend", elements.map((element) => (before: ProjectDocument, context: CommitContext) => setElementFields(before, context, element.id, { blendMode: mode }, { commandType: "element.blend", label: "Blend mode" })))),
  });
  const resetAction = useMemo(() => <Act icon="rotate" size="xs" label={t("Reset transform")} testID="reset-transform" onPress={on.reset} />, [t, on]);
  const blendModes = useMemo(() => BLEND_MODES.map((mode) => ({ value: mode as string, label: t(mode.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => (dash ? " " : "") + (dash ? letter : letter.toUpperCase()))) })), [t]);
  if (!first) return null;
  return (
    <>
      <Section id="transform" title={t("Transform")} action={resetAction}>
        <Row label={t("Position")}>
          <GrowField label="X" size="sm" min={-100000} max={100000} step={1} value={x === null ? null : Math.round(x * 100) / 100} onChange={on.xLive} onCommit={on.x} />
          <GrowField label="Y" size="sm" min={-100000} max={100000} step={1} value={y === null ? null : Math.round(y * 100) / 100} onChange={on.yLive} onCommit={on.y} />
          {single ? <KeyToggle element={first} paths={["transform.position.x", "transform.position.y"]} local={props.local} values={[x ?? 0, y ?? 0]} label={t("Position")} /> : null}
        </Row>
        <Row label={t("Scale")}>
          {uniform ? (
            <>
              <GrowSlide label={t("Scale")} min={1} max={400} step={1} value={Math.min(400, Math.max(1, Math.round((sx ?? 1) * 100)))} defaultValue={100} onChange={on.scaleLive} onCommit={on.scale} />
              <Field label={t("Scale")} hideLabel size="sm" width={72} unit="%" min={1} max={10000} step={1} value={sx === null ? null : Math.round(sx * 10000) / 100} onCommit={on.scale} />
            </>
          ) : (
            <>
              <GrowField label="X" size="sm" unit="%" min={1} max={10000} step={1} value={sx === null ? null : Math.round(sx * 10000) / 100} onCommit={on.scaleX} />
              <GrowField label="Y" size="sm" unit="%" min={1} max={10000} step={1} value={sy === null ? null : Math.round(sy * 10000) / 100} onCommit={on.scaleY} />
            </>
          )}
          <Act icon="link" size="xs" label={t("Uniform scale")} on={uniform} toggle testID="uniform-scale" onPress={on.uniform} />
          {single ? <KeyToggle element={first} paths={["transform.scale.x", "transform.scale.y"]} local={props.local} values={[sx ?? 1, sy ?? 1]} label={t("Scale")} /> : null}
        </Row>
        <Row label={t("Rotation")}>
          <GrowField label={t("Rotation")} hideLabel size="sm" unit="°" min={-3600} max={3600} step={0.1} value={rotation === null ? null : Math.round(rotation * 10) / 10} onChange={on.rotationLive} onCommit={on.rotation} />
          {single ? <KeyToggle element={first} paths={["transform.rotation"]} local={props.local} values={[rotation ?? 0]} label={t("Rotation")} /> : null}
        </Row>
        <Row label={t("Flip")}>
          <Act icon="mirror" size="sm" variant="outline" label={t("Flip horizontal")} testID="flip-horizontal" on={elements.every((element) => transformOf(element).flip.horizontal)} toggle onPress={on.mirror} />
          <FlipVertical label={t("Flip vertical")} on={elements.every((element) => transformOf(element).flip.vertical)} onPress={on.flip} />
          <Spacer />
          {croppable ? <Press size="sm" kind="outline" icon="crop" label={t("Crop…")} testID="crop-open" pressed={runtime.tool.crop === first.id} onPress={on.crop} /> : null}
        </Row>
        {croppable && runtime.tool.crop === first.id ? <CropFields element={first} /> : null}
      </Section>
      <Section id="blend" title={t("Blend")}>
        <Row label={t("Opacity")}>
          <GrowSlide label={t("Opacity")} min={0} max={100} step={1} value={Math.round((opacity ?? 1) * 100)} defaultValue={100} onChange={on.opacityLive} onCommit={on.opacity} />
          <Field label={t("Opacity")} hideLabel size="sm" width={72} unit="%" min={0} max={100} step={1} value={opacity === null ? null : Math.round(opacity * 100)} onCommit={on.opacity} />
          {single ? <KeyToggle element={first} paths={["opacity"]} local={props.local} values={[opacity ?? 1]} label={t("Opacity")} /> : null}
        </Row>
        <Row label={t("Blend mode")}>
          <BlendPick label={t("Blend mode")} value={blend} options={blendModes} onChange={on.blend} />
        </Row>
      </Section>
    </>
  );
}
const TURNED = { transform: [{ rotate: "90deg" }] };
const FlipVertical = memo(function FlipVertical(props: { label: string; on: boolean; onPress(): void }) { return <View style={TURNED}><Act icon="mirror" size="sm" variant="outline" label={props.label} testID="flip-vertical" on={props.on} toggle onPress={props.onPress} /></View>; });
const Spacer = memo(function Spacer() { return <View style={GROW} />; });
const BlendPick = memo(function BlendPick(props: { label: string; value: string | null; options: { value: string; label: string }[]; onChange(mode: string): void }) { return <View style={GROW}><Pick label={props.label} value={props.value} placeholder="—" options={props.options} onChange={props.onChange} /></View>; });

/** The four sides of the crop as numbers, while the crop frame is on the canvas: a typed side is one step, like a dragged handle. */
function CropFields(props: { element: El }) {
  const t = useT();
  const runtime = useEditor();
  const { controller } = runtime, asset = controller.stored.media.assets.find((entry) => entry.id === props.element.mediaId);
  const source = { width: asset?.width || controller.stored.settings.canvasSize.width, height: asset?.height || controller.stored.settings.canvasSize.height };
  const crop = { ...CROP_NONE, ...((props.element.crop ?? {}) as Partial<Crop>) };
  const side = (key: keyof Crop, percent: number) => {
    const opposite = ({ left: "right", right: "left", top: "bottom", bottom: "top" } as const)[key], most = 0.99 - crop[opposite];
    const next = clampCropTo({ ...crop, [key]: Math.min(Math.max(0, most), Math.max(0, percent / 100)) }, source);
    controller.external((doc, ctx) => setElementFields(doc, ctx, props.element.id, { crop: next }, { commandType: "element.crop", label: "Crop" }));
  };
  return (
    <View testID="crop-fields" style={{ gap: space[1.5] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
        {(["left", "top", "right", "bottom"] as const).map((key) => <View key={key} style={{ width: "47%" }}><NumberField label={t(key.charAt(0).toUpperCase() + key.slice(1))} size="sm" unit="%" min={0} max={99} step={0.1} value={Math.round(crop[key] * 1000) / 10} onCommit={(next) => side(key, next)} /></View>)}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}><Button size="sm" kind="primary" label={t("Apply")} testID="crop-apply" onPress={() => runtime.setTool({ crop: null })} /></View>
    </View>
  );
}

/** Volume and mute of a clip's own sound. */
function AudioTab(props: { element: El }) {
  const t = useT();
  const runtime = useEditor();
  const { element } = props, volume = Number(element.volume ?? 0);
  const set = (decibels: number, live: boolean) => runtime.controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { volume: decibels }, { commandType: "element.volume", label: "Volume" }), live);
  return (
    <Section id="audio" title={t("Volume")}>
      <Row label={t("Volume")}>
        <View style={{ flex: 1 }}><Slider label={t("Volume")} min={-60} max={20} step={0.1} value={volume} defaultValue={0} onChange={(next) => set(next as number, true)} onCommit={(next) => set(next as number, false)} /></View>
        <NumberField label={t("Volume")} hideLabel size="sm" width={80} unit="dB" min={-60} max={20} step={0.1} value={Math.round(volume * 10) / 10} onCommit={(next) => set(next, false)} />
      </Row>
      <Row label={t("Mute")}><View testID="clip-mute"><Switch label={t("Mute")} value={element.muted === true} onChange={() => { runtime.act("audio.mute.toggle"); }} /></View></Row>
    </Section>
  );
}
