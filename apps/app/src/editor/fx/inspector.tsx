import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import {
  EASING_LABELS, EDITOR_PREFS, FADE_SHAPE_LABELS, FADE_SHAPES, FX_PREFS, optionLabel, paramLabel, transitionPlace, type FxKind,
} from "@jagentchill/app-core";
import { effectDefinition, resolvedValue, timeline, TRANSITION_EASINGS, transitionDefinition, writeProperty } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import {
  Button, ColorPicker, ConfirmDialog, Icon, IconButton, Input, Modal, NumberField, Select, Skeleton, Slider, Switch, Tabs, Tap, Text, Tooltip, radius, space, useTheme, useToast, type IconName, dragHandle } from "@jagentchill/ui";
import { useT } from "../../locale";
import { getPref, setPref, usePref } from "../../state";
import { useEditor, useEditorVersion } from "../context";
import { bindPointer } from "../dom";
import { KeyToggle } from "../inspector/keys";
import { Section } from "../inspector/parts";
import { bodyEffectsAvailable, endTransitionLoop, showAssetTab, touchTransitionLoop } from "./actions";
import { setCopiedEffects } from "./clipboard";
import { focusInput, rowMiddles } from "./dom";
import { useFx } from "./store";

type El = timeline.El;
type Param = timeline.ElementParamDefinition;
type Value = number | boolean | string;
export type InspectorTab = { id: string; label: string };
const CLIP_TYPES = ["video", "image", "text", "sticker", "graphic", "compound"];
const KIND_ICON: Record<FxKind, IconName> = { effect: "sparkles", filter: "filter", transition: "transition" };

/** The selected transition, when one is: the inspector shows it in place of the project's details. */
export function useSelectedTransition(): string | null {
  const runtime = useEditor();
  return useFx(runtime).state.transitionId;
}
/** The tabs effects and filters add to a selection: "Parameters" for a standalone layer, "Effects" for a clip. */
export function fxInspectorTabs(elements: El[], tabs: InspectorTab[]): InspectorTab[] {
  if (elements.length !== 1) return tabs;
  if (elements[0].type === "effect") return [{ id: "parameters", label: "Parameters" }];
  return CLIP_TYPES.includes(elements[0].type) ? [...tabs, { id: "effects", label: "Effects" }] : tabs;
}
/** The body of the tabs of `fxInspectorTabs`; `null` for every other tab. */
export function FxInspectorTab(props: { active: string | undefined; elements: El[]; playhead: number }) {
  const [first] = props.elements;
  if (!first || props.elements.length !== 1) return null;
  if (props.active === "parameters" && first.type === "effect") return <LayerParameters element={first} playhead={props.playhead} />;
  if (props.active === "effects" && CLIP_TYPES.includes(first.type)) return <ClipEffects element={first} playhead={props.playhead} />;
  return null;
}

function Row(props: { label: string; children: ReactNode; testID?: string }) {
  return <View testID={props.testID} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}><Text variant="meta" color="text/secondary" numberOfLines={2} style={{ width: 80 }}>{props.label}</Text>{props.children}</View>;
}
/** The picture of an entry, rendered by the engine like its tile. */
function Thumb(props: { kind: FxKind; type: string; params?: Record<string, Value>; width: number; height: number }) {
  const theme = useTheme();
  const runtime = useEditor();
  const store = useFx(runtime);
  const known = props.kind === "transition" ? transitionDefinition(props.type) !== undefined : effectDefinition(props.type) !== undefined;
  const frames = known && runtime.transport.engine === "ready" ? store.pictures({ key: `${props.kind}:${props.type}`, kind: props.kind, type: props.type, animated: false }) : [];
  const url = frames?.[0];
  return (
    <View testID="fx-inspector-thumb" style={{ width: props.width, height: props.height, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
      {url ? <View style={[{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }, { backgroundImage: `url("${url}")`, experimental_backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" } as object]} />
        : frames === undefined ? <Skeleton width="100%" height={props.height} /> : <Icon name={KIND_ICON[props.kind]} size={20} color="text/secondary" />}
    </View>
  );
}

/**
 * One parameter by its definition: a slider with a number field, a switch, a colour picker or a select. `onLive`
 * draws a drag without recording; `onCommit` records the one step of the edit.
 */
function ParamControl(props: { param: Param; value: Value; testID: string; onLive(value: Value): void; onCommit(value: Value): void; trailing?: ReactNode }) {
  const t = useT();
  const { param } = props, label = t(paramLabel(param.key));
  if (param.type === "number") {
    const value = Number(props.value), min = param.min ?? 0, max = param.max ?? 100, step = param.step ?? 1;
    if (param.key === "seed") {
      return (
        <Row label={label} testID={props.testID}>
          <View style={{ flex: 1 }}><NumberField label={label} hideLabel size="sm" min={min} max={max} step={step} value={value} onCommit={props.onCommit} /></View>
          <IconButton icon="refresh" size="sm" variant="outline" label={t("Randomise")} testID={`${props.testID}-random`} onPress={() => props.onCommit(Math.floor(Math.random() * (max + 1)))} />
        </Row>
      );
    }
    return (
      <Row label={label} testID={props.testID}>
        <View style={{ flex: 1 }}><Slider label={label} min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} defaultValue={Number(param.default)} onChange={(next) => props.onLive(next as number)} onCommit={(next) => props.onCommit(next as number)} /></View>
        <NumberField label={label} hideLabel size="sm" width={64} unit={param.unit} min={min} max={max} step={step} value={Math.round(value * 1000) / 1000} onCommit={props.onCommit} />
        {props.trailing}
      </Row>
    );
  }
  if (param.type === "boolean") return <Row label={label} testID={props.testID}><View style={{ flex: 1 }} /><Switch accessibilityLabel={label} value={props.value === true} onChange={(on) => props.onCommit(on)} /></Row>;
  if (param.type === "color") {
    return (
      <Row label={label} testID={props.testID}>
        <View style={{ flex: 1 }}><ColorPicker label={label} value={String(props.value).toUpperCase()} defaultValue={String(param.default).toUpperCase()} onChange={(next) => props.onLive(next.slice(0, 7).toLowerCase())} onCommit={(next) => props.onCommit(next.slice(0, 7).toLowerCase())} /></View>
        {props.trailing}
      </Row>
    );
  }
  return <Row label={label} testID={props.testID}><View style={{ flex: 1 }}><Select label={label} size="sm" value={String(props.value)} options={(param.options ?? []).map((option) => ({ value: option, label: t(optionLabel(option)) }))} onChange={(next) => props.onCommit(next)} /></View></Row>;
}

/** The name a preset is saved under. */
function PresetDialog(props: { suggestion: string; onClose(): void; onSave(name: string): void }) {
  const t = useT();
  const [name, setName] = useState(props.suggestion);
  return (
    <Modal title={t("Save as preset")} width={360} onClose={props.onClose}
      footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={props.onClose} /><Button size="sm" kind="primary" label={t("Save")} testID="fx-preset-save" disabled={name.trim().length === 0} onPress={() => props.onSave(name.trim())} /></>}>
      <Input accessibilityLabel={t("Preset name")} autoFocus maxLength={60} value={name} onChangeText={setName} />
    </Modal>
  );
}

// ---- transition --------------------------------------------------------------------------------------------------------

/** The inspector of the selected transition: what it is, its duration, easing and parameters, the paired audio crossfade and its actions. */
export function TransitionInspector(props: { transitionId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const fx = useFx(runtime);
  const { controller } = runtime, document = controller.document, id = props.transitionId;
  const [limited, setLimited] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const found = timeline.findTransition(document, id);
  const focus = fx.state.focusDuration;
  useEffect(() => { if (focus > 0) focusInput("fx-transition-duration"); }, [focus]);
  useEffect(() => () => endTransitionLoop(runtime), [runtime, id]);
  useEffect(() => setLimited(null), [id]);
  if (!found) return null;
  const { record } = found, scene = timeline.sceneById(document, found.sceneId), track = timeline.trackById(scene, found.trackId)!, fps = document.settings.fps as Rational;
  const definition = transitionDefinition(record.type), state = timeline.transitionInspectorState(record), place = transitionPlace(document, id);
  const held = timeline.heldFrames(track, record, fps), audio = timeline.audioCrossfadeState(scene, record);
  const seconds = Math.round((record.duration / TICKS_PER_SECOND) * 10) / 10;
  /** A drag draws through the preview layer; the release records one step. Either way the cut plays on a loop. */
  const edit = (change: timeline.TransitionEdit, live: boolean) => {
    if (live) { controller.preview(timeline.editTransition(id, change)); touchTransitionLoop(runtime, id); return; }
    controller.discardPreview();
    const result = controller.run(timeline.editTransition(id, change));
    if (change.seconds !== undefined) setLimited(result.ok && result.info?.clamped ? t("Limited to {seconds}s by clip length", { seconds: result.info.seconds.toFixed(1) }) : null);
    touchTransitionLoop(runtime, id);
  };
  const remove = () => { endTransitionLoop(runtime); controller.run(timeline.removeTransition(id)); };
  const replace = () => { fx.set({ replace: { kind: "transition", transitionId: id } }); showAssetTab(runtime, "transitions"); };
  const applyAll = () => {
    const result = controller.run(timeline.applyTransitionToAll(id));
    if (result.ok && result.info) toast.show({ kind: "success", message: result.info.shortened > 0 ? t("Applied to {n} cuts ({m} shortened to fit)", { n: result.info.applied, m: result.info.shortened }) : t("Applied to {n} cuts", { n: result.info.applied }) });
  };
  const savePreset = (name: string) => {
    const saved = timeline.saveTransitionPreset(getPref(FX_PREFS.transitionPresets), name, record);
    setSaving(false);
    if (!saved.ok) { toast.show({ kind: "warning", message: t(saved.message) }); return; }
    setPref(FX_PREFS.transitionPresets, saved.presets);
    toast.show({ kind: "success", message: t("Preset “{name}” saved", { name: saved.preset.name }) });
  };
  return (
    <View testID="inspector" accessibilityLabel={`${t("Transition")}: ${t(state.name)}`} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <Tabs id="inspector" label={t("Inspector")} items={[{ id: "transition", label: t("Transition") }]} value="transition" onChange={() => undefined} />
      <View testID="transition-inspector" {...({ dataSet: { type: record.type, duration: String(record.duration) } } as object)} style={{ flex: 1, minHeight: 0 }}>
       <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: 10, paddingHorizontal: space[3] }}>
          <Thumb kind="transition" type={record.type} width={72} height={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title-sm" numberOfLines={1} testID="transition-name">{t(state.name)}</Text>
            <Text variant="meta" color="text/secondary" numberOfLines={2}>{[definition ? t(definition.category) : null, place ? t("between clip {a} and clip {b}", { a: place.from, b: place.to }) : null].filter(Boolean).join(" · ")}</Text>
          </View>
          <Button kind="secondary" size="sm" label={t("Replace")} testID="transition-replace" onPress={replace} />
        </View>
        {state.available && definition ? (
          <Section id="fx-transition" title={t("Transition")}>
            <Row label={t("Duration")} testID="transition-duration">
              <View style={{ flex: 1 }}><Slider label={t("Duration")} min={timeline.TRANSITION_MIN_SECONDS} max={timeline.TRANSITION_MAX_SECONDS} step={0.1} value={seconds} defaultValue={timeline.DEFAULT_TRANSITION_SECONDS} onChange={(next) => edit({ seconds: next as number }, true)} onCommit={(next) => edit({ seconds: next as number }, false)} /></View>
              <View nativeID="fx-transition-duration"><NumberField label={t("Duration")} hideLabel size="sm" width={64} unit="s" min={0} max={99} step={0.1} value={seconds} onCommit={(next) => edit({ seconds: next }, false)} /></View>
            </Row>
            {limited ? <Text variant="meta" color="warning/text" testID="transition-limited">{limited}</Text> : null}
            {held.warning ? <View testID="transition-held" style={{ flexDirection: "row", gap: space[1.5] }}><Icon name="warn" size={14} color="warning/icon" /><Text variant="meta" color="warning/text" style={{ flex: 1 }}>{t("Not enough extra footage: {x}s of the outgoing clip and {y}s of the incoming clip are held frames.", { x: (held.outgoing / TICKS_PER_SECOND).toFixed(1), y: (held.incoming / TICKS_PER_SECOND).toFixed(1) })}</Text></View> : null}
            <Row label={t("Easing")} testID="transition-easing">
              <View style={{ flex: 1 }}><Select label={t("Easing")} size="sm" value={record.easing} options={TRANSITION_EASINGS.map((easing) => ({ value: easing as string, label: t(EASING_LABELS[easing]) }))} onChange={(easing) => edit({ easing }, false)} /></View>
            </Row>
            {definition.params.map((param) => (
              <ParamControl key={param.key} param={param} value={record.params[param.key] ?? param.default} testID={`transition-param-${param.key}`} onLive={(value) => edit({ params: { [param.key]: value } }, true)} onCommit={(value) => edit({ params: { [param.key]: value } }, false)} />
            ))}
            <Row label={t("Audio crossfade")} testID="transition-audio">
              <View style={{ flex: 1 }} />
              <Tooltip label={audio.available ? t("Audio crossfade") : t(audio.tooltip ?? "")}><View><Switch accessibilityLabel={t("Audio crossfade")} disabled={!audio.available} value={audio.available && record.audioCrossfade} onChange={(on) => edit({ audioCrossfade: on }, false)} /></View></Tooltip>
            </Row>
            {audio.available && record.audioCrossfade ? (
              <Row label={t("Curve")} testID="transition-curve">
                <View style={{ flex: 1 }}><Select label={t("Crossfade curve")} size="sm" value={record.shape} options={FADE_SHAPES.map((shape) => ({ value: shape as string, label: t(FADE_SHAPE_LABELS[shape]) }))} onChange={(shape) => edit({ shape }, false)} /></View>
              </Row>
            ) : null}
          </Section>
        ) : null}
        <View style={{ gap: space[1.5], paddingVertical: 10, paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
            {state.available ? <Button kind="secondary" size="sm" label={t("Apply to all")} testID="transition-apply-all" onPress={applyAll} /> : null}
            {state.available ? <Button kind="secondary" size="sm" label={t("Set as default")} testID="transition-set-default" onPress={() => { setPref(FX_PREFS.transitionDefaults, timeline.defaultsFrom(record)); toast.show({ kind: "success", message: t("Default transition set") }); }} /> : null}
            <View style={{ flex: 1 }} />
            <Button kind="ghost" size="sm" tone="danger" label={t("Remove")} testID="transition-remove" onPress={remove} />
          </View>
          {state.available ? <View style={{ flexDirection: "row" }}><Button kind="ghost" size="sm" label={t("Save as preset")} testID="transition-save-preset" onPress={() => setSaving(true)} /></View> : null}
          {state.available ? <Text variant="meta" color="text/secondary">{t("The preview loops from 1 s before to 1 s after the cut while parameters change.")}</Text> : null}
        </View>
       </ScrollView>
      </View>
      {saving ? <PresetDialog suggestion={t(state.name)} onClose={() => setSaving(false)} onSave={savePreset} /> : null}
    </View>
  );
}

// ---- effects and filters -------------------------------------------------------------------------------------------------

/** Writes of an entry's parameters: a drag is drawn live and recorded once; Escape during it leaves the value as it was. */
function useParamWrites(element: El, entry: timeline.StackEntry, playhead: number) {
  const runtime = useEditor();
  const { controller } = runtime;
  const drag = useRef({ active: false, cancelled: false });
  useEffect(() => runtime.registerActions((actionId) => {
    // Escape during a drag ends the drag only: the selection stays.
    if (actionId !== "editor.cancel" || !drag.current.active || drag.current.cancelled) return false;
    drag.current.cancelled = true;
    controller.discardPreview();
    return true;
  }), [runtime, controller]);
  const local = Math.max(0, Math.min(element.duration, Math.round(playhead - element.startTime)));
  const write = (param: Param, value: Value, live: boolean): void => {
    if (live) { if (drag.current.cancelled) return; drag.current.active = true; }
    else if (drag.current.cancelled) { drag.current = { active: false, cancelled: false }; controller.discardPreview(); return; }
    else drag.current.active = false;
    let coerced: Value;
    try { coerced = timeline.coerceParam(param, value); } catch { return; }
    controller.external((doc, ctx) => writeProperty(doc, ctx, element.id, timeline.effectParamPath(entry.id, param.key), coerced, local, { commandType: "effect.param", label: "Edit effect" }), live);
  };
  const shown = (param: Param): Value => (resolvedValue(element as never, timeline.effectParamPath(entry.id, param.key), local, entry.params[param.key] ?? param.default) ?? param.default) as Value;
  return { write, shown, local };
}
/** The parameters of one entry with their keyframe toggles. */
function EntryParams(props: { element: El; entry: timeline.StackEntry; playhead: number }) {
  const t = useT();
  const { element, entry } = props, definition = effectDefinition(entry.type);
  const { write, shown } = useParamWrites(element, entry, props.playhead);
  if (!definition) return null;
  return (
    <>
      {definition.params.map((param) => {
        const value = shown(param);
        return <ParamControl key={param.key} param={param} value={value} testID={`fx-param-${param.key}`} onLive={(next) => write(param, next, true)} onCommit={(next) => write(param, next, false)}
          trailing={param.keyframable ? <KeyToggle element={element} path={timeline.effectParamPath(entry.id, param.key)} value={value} label={t(paramLabel(param.key))} playhead={props.playhead} testID={`fx-kf-${param.key}`} /> : undefined} />;
      })}
    </>
  );
}
function useSavePreset(element: El, entry: timeline.StackEntry, playhead: number) {
  const t = useT();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const definition = effectDefinition(entry.type), local = Math.max(0, Math.round(playhead - element.startTime));
  const save = (name: string) => {
    // A keyframed parameter is stored at the value it has under the playhead.
    const resolved = Object.fromEntries((definition?.params ?? []).map((param) => [param.key, (resolvedValue(element as never, timeline.effectParamPath(entry.id, param.key), local, entry.params[param.key] ?? param.default) ?? param.default) as Value]));
    const saved = timeline.saveEffectPreset(getPref(FX_PREFS.effectPresets), name, entry, resolved);
    setSaving(false);
    if (!saved.ok) { toast.show({ kind: "warning", message: t(saved.message) }); return; }
    setPref(FX_PREFS.effectPresets, saved.presets);
    toast.show({ kind: "success", message: t("Preset “{name}” saved", { name: saved.preset.name }) });
  };
  return { open: () => setSaving(true), dialog: saving ? <PresetDialog suggestion={definition ? t(definition.name) : ""} onClose={() => setSaving(false)} onSave={save} /> : null };
}

/** The Effects tab of a clip: its stack top to bottom in render order, each row with its parameters. */
function ClipEffects(props: { element: El; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { controller } = runtime, { element } = props;
  const entries = ((element.effects ?? []) as timeline.StackEntry[]);
  const [drop, setDrop] = useState<number | null>(null);
  if (entries.length === 0) {
    return (
      <View testID="effects-empty" style={{ padding: space[4], alignItems: "center", gap: space[2] }}>
        <Icon name="sparkles" size={24} color="text/secondary" />
        <Text variant="meta" color="text/secondary">{t(timeline.EFFECT_MESSAGES.emptyStack)}</Text>
        <Button size="sm" kind="outline" label={t("Open effects")} testID="effects-open" onPress={() => showAssetTab(runtime, "effects")} />
      </View>
    );
  }
  const move = (effectId: string, toIndex: number) => { if (toIndex >= 0 && toIndex < entries.length) controller.run(timeline.reorderEffect(element.id, effectId, toIndex)); };
  return (
    <View testID="effects-list" role="list" aria-label={t("Effects")}>
      {entries.map((entry, index) => (
        <View key={entry.id}>
          {drop === index ? <View pointerEvents="none" testID="effects-drop-line" style={{ height: 2, backgroundColor: theme.color("accent") }} /> : null}
          <EffectRow element={element} entry={entry} index={index} ids={entries.map((item) => item.id)} playhead={props.playhead} onMove={move} onDrop={setDrop} />
        </View>
      ))}
      {drop === entries.length ? <View pointerEvents="none" testID="effects-drop-line" style={{ height: 2, backgroundColor: theme.color("accent") }} /> : null}
    </View>
  );
}
function EffectRow(props: { element: El; entry: timeline.StackEntry; index: number; ids: string[]; playhead: number; onMove(effectId: string, toIndex: number): void; onDrop(index: number | null): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { controller } = runtime, { element, entry } = props;
  const [collapsed, setCollapsed] = usePref(EDITOR_PREFS.inspectorCollapsed);
  const [confirm, setConfirm] = useState(false);
  const grip = useRef<View>(null);
  const live = useRef(props);
  live.current = props;
  const definition = effectDefinition(entry.type), enabled = entry.enabled !== false, open = collapsed[`fx:${entry.id}`] !== true;
  const name = definition ? t(definition.name) : t(timeline.EFFECT_MESSAGES.unavailable);
  const preset = useSavePreset(element, entry, props.playhead);
  // Dragging the grip moves the row: the line shows where it would land.
  useEffect(() => bindPointer(grip.current, {
    down(info) {
      if (info.button !== 0) return null;
      const middles = rowMiddles(live.current.ids.map((id) => `fx-row-${id}`));
      const target = (clientY: number) => middles.filter((middle) => middle < clientY).length;
      return {
        move(next) { live.current.onDrop(target(next.clientY)); },
        up(next) {
          const state = live.current, slot = target(next.clientY);
          state.onDrop(null);
          // A slot after the row's own place counts the row itself.
          const toIndex = slot > state.index ? slot - 1 : slot;
          if (toIndex !== state.index) state.onMove(state.entry.id, toIndex);
        },
        cancel() { live.current.onDrop(null); },
      };
    },
  }), []);
  const counts = timeline.countFilterTargets(controller.stored, controller.session.sceneId);
  const intensity = Number(resolvedValue(element as never, timeline.effectParamPath(entry.id, "intensity"), Math.max(0, Math.round(props.playhead - element.startTime)), entry.params.intensity ?? 100) ?? 100);
  return (
    <View nativeID={`fx-row-${entry.id}`} testID={`effect-row-${entry.type}`} role="listitem" {...({ dataSet: { effectId: entry.id, enabled: enabled ? "true" : "false" } } as object)} style={{ borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <View style={{ height: 32, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[1.5], paddingEnd: space[2], opacity: enabled ? 1 : 0.5 }}>
        <View {...dragHandle("grab")} ref={grip} testID="effect-grip" accessibilityLabel={t("Drag to reorder")} style={{ width: 16, height: 24, alignItems: "center", justifyContent: "center" }}><Icon name="grip" size={14} color="text/secondary" /></View>
        <Tap role="button" label={name} expanded={open} testID="effect-name" onPress={() => setCollapsed({ ...collapsed, [`fx:${entry.id}`]: open })}
          onKeyDown={(key) => { if (key.alt && (key.key === "ArrowUp" || key.key === "ArrowDown")) { key.preventDefault(); key.stopPropagation?.(); props.onMove(entry.id, props.index + (key.key === "ArrowUp" ? -1 : 1)); } }}
          style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[1], height: 28 }}>
          <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
          <Icon name={entry.kind === "filter" ? "filter" : "sparkles"} size={14} color="text/secondary" />
          <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
          {definition?.requires === "person-matte" && !bodyEffectsAvailable() ? <Tooltip label={t(timeline.EFFECT_MESSAGES.bodyUnavailable)}><View testID="effect-warning"><Icon name="warn" size={14} color="warning/icon" /></View></Tooltip> : null}
        </Tap>
        {definition ? <IconButton icon={enabled ? "eye" : "eye-off"} size="xs" label={t(enabled ? "Disable effect" : "Enable effect")} on={!enabled} toggle testID="effect-toggle" onPress={() => controller.run(timeline.toggleEffect(element.id, entry.id))} /> : null}
        {definition ? <IconButton icon="rotate" size="xs" label={t("Reset effect")} testID="effect-reset" onPress={() => controller.run(timeline.resetEffect(element.id, entry.id))} /> : null}
        <IconButton icon="trash" size="xs" label={t("Remove effect")} testID="effect-remove" onPress={() => controller.run(timeline.removeEffectEntry(element.id, entry.id))} />
      </View>
      {open && definition ? (
        <View style={{ paddingHorizontal: space[3], paddingTop: space[1], paddingBottom: space[3], gap: space[1.5], opacity: enabled ? 1 : 0.5 }}>
          <EntryParams element={element} entry={entry} playhead={props.playhead} />
          <View style={{ flexDirection: "row", gap: space[1.5], marginTop: space[1] }}>
            {entry.kind === "filter" ? <Button kind="secondary" size="sm" label={t("Apply to all")} testID="filter-apply-all" onPress={() => setConfirm(true)} /> : null}
            <Button kind="ghost" size="sm" label={t("Save as preset")} testID="effect-save-preset" onPress={preset.open} />
          </View>
        </View>
      ) : null}
      {preset.dialog}
      <ConfirmDialog open={confirm} title={t("Apply filter to all clips")} confirmLabel={t("Apply to all")} onClose={() => setConfirm(false)}
        description={counts.skippedLocked > 0 ? t("{n} clips get “{name}” at {intensity}%; {m} skipped (locked)", { n: counts.affected, name, intensity: Math.round(intensity), m: counts.skippedLocked }) : t("{n} clips get “{name}” at {intensity}%", { n: counts.affected, name, intensity: Math.round(intensity) })}
        onConfirm={() => { setConfirm(false); controller.run(timeline.applyFilterToAll({ sceneId: controller.session.sceneId, type: entry.type, intensity: Math.round(intensity) })); }} />
    </View>
  );
}

/** The Parameters tab of a standalone effect or filter layer: its one entry, its target, and its actions. */
function LayerParameters(props: { element: El; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  const fx = useFx(runtime);
  const { controller } = runtime, { element } = props;
  const entry = ((element.effects ?? []) as timeline.StackEntry[])[0];
  const preset = useSavePreset(element, entry ?? ({ id: "", type: "", kind: "effect", enabled: true, params: {} } as timeline.StackEntry), props.playhead);
  const scene = timeline.sceneById(controller.document, controller.session.sceneId);
  const definition = entry ? effectDefinition(entry.type) : undefined;
  const targets = useMemo(() => (definition ? timeline.tracksOfScene(scene).flatMap((track) => (track.locked ? [] : track.elements)).filter((candidate) => candidate.type !== "effect" && candidate.type !== "adjustment" && timeline.acceptsEffect(definition, candidate)) : []), [scene, definition]);
  if (!entry) return null;
  const filter = entry.kind === "filter", name = definition ? t(definition.name) : t(timeline.EFFECT_MESSAGES.unavailable), enabled = entry.enabled !== false;
  const convert = (targetId: string) => {
    if (targetId === "beneath") return;
    const result = controller.run(timeline.convertLayerToClip(element.id, targetId));
    if (result.ok) setPref(EDITOR_PREFS.inspectorTabs, { ...getPref(EDITOR_PREFS.inspectorTabs), [timeline.locate(controller.stored, targetId)?.element.type ?? "video"]: "effects" });
  };
  return (
    <View testID="layer-parameters" {...({ dataSet: { type: entry.type, kind: entry.kind } } as object)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: 10, paddingHorizontal: space[3] }}>
        <Thumb kind={entry.kind} type={entry.type} width={56} height={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title-sm" numberOfLines={1} testID="layer-name">{name}</Text>
          <Text variant="meta" color="text/secondary" numberOfLines={2}>{[definition ? t(definition.category) : null, t(filter ? "standalone filter layer" : "standalone effect layer")].filter(Boolean).join(" · ")}</Text>
        </View>
        {definition ? <Switch accessibilityLabel={t(filter ? "Filter on" : "Effect on")} value={enabled} onChange={() => { controller.run(timeline.toggleEffect(element.id, entry.id)); }} /> : null}
      </View>
      {definition ? (
        <Section id="fx-layer-params" title={t("Parameters")} trailing={<IconButton icon="rotate" size="xs" label={t("Reset")} testID="layer-reset" onPress={() => controller.run(timeline.resetEffect(element.id, entry.id))} />}>
          <EntryParams element={element} entry={entry} playhead={props.playhead} />
        </Section>
      ) : null}
      {definition ? (
        <Section id="fx-layer-target" title={t("Target")}>
          <Row label={t("Object")} testID="layer-target">
            <View style={{ flex: 1 }}><Select label={t("Target")} size="sm" value="beneath" options={[{ value: "beneath", label: t("Global") }, ...targets.map((candidate) => ({ value: candidate.id, label: candidate.type === "text" ? String(candidate.content ?? candidate.name) : candidate.name, group: t("Clip…") }))]} onChange={convert} /></View>
          </Row>
        </Section>
      ) : null}
      <View style={{ gap: space[1.5], paddingVertical: space[2], paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
          <Button kind="secondary" size="sm" label={t("Replace")} testID="layer-replace" onPress={() => { fx.set({ replace: { kind: "layer", elementId: element.id, entryKind: entry.kind } }); showAssetTab(runtime, filter ? "filters" : "effects"); }} />
          <Button kind="secondary" size="sm" label={t(filter ? "Copy filter" : "Copy effect")} testID="layer-copy" onPress={() => { const clipboard = timeline.copyEffects(controller.stored, element.id); if (clipboard) { setCopiedEffects(clipboard); toast.show({ kind: "info", message: t(filter ? "Filter copied" : "Effect copied") }); } }} />
          <View style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" tone="danger" label={t("Remove")} testID="layer-remove" onPress={() => runtime.act("timeline.delete")} />
        </View>
        {definition ? <View style={{ flexDirection: "row" }}><Button kind="ghost" size="sm" label={t("Save as preset")} testID="effect-save-preset" onPress={preset.open} /></View> : null}
      </View>
      {preset.dialog}
    </View>
  );
}
