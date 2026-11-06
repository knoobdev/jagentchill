import { useEffect, useState, type ReactNode } from "react";
import { Image, ScrollView, View } from "react-native";
import { durationBadge } from "@jagentchill/app-core";
import { DocumentRejected, findElement, leaveTemplateMode, setElementFields, template, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Badge, Button, ColorPicker, ConfirmDialog, IconButton, Input, Slider, Switch, Tabs, Tap, Text, Tooltip, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useEditor, useEditorVersion } from "../editor/context";
import { useT } from "../locale";
import type { MediaSession } from "../media/session";
import { pickFiles } from "../platform/store";
import { ApplyBrandButton } from "./BrandKit";

type Json = Record<string, any>;
type Tab = "media" | "text" | "audio";
const SECOND = 120_000;
const MEDIA_ACCEPT = "video/*,image/*", AUDIO_ACCEPT = "audio/*";

/** The content of an editable text: typed freely up to its limit, written to the project when the field is left. */
function TextRow(props: { elementId: string; label: string; maxLength: number; content: string; onFocus(): void; onCommit(content: string): void }) {
  const t = useT();
  const [draft, setDraft] = useState(props.content);
  useEffect(() => setDraft(props.content), [props.content]);
  const commit = () => { if (draft !== props.content) props.onCommit(draft); };
  return (
    <View testID="template-text" {...({ dataSet: { element: props.elementId } } as object)} style={{ gap: space[1] }}>
      <Text variant="meta" color="text/secondary">{props.label || t("Text")}</Text>
      <Input accessibilityLabel={props.label || t("Text")} value={draft} maxLength={props.maxLength} counter testID="template-text-input" onFocus={props.onFocus}
        onChangeText={(next) => setDraft([...next].slice(0, props.maxLength).join(""))} onBlur={commit} onSubmitEditing={commit} />
    </View>
  );
}

function NumberVariableRow(props: { id: string; label: string; value: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => { const value = Number(draft); if (Number.isFinite(value) && value !== props.value) props.onCommit(value); else setDraft(String(props.value)); };
  return <View testID="template-variable" {...({ dataSet: { variable: props.id } } as object)} style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{props.label}</Text><Input accessibilityLabel={props.label} role="spinbutton" keyboardType="decimal-pad" value={draft} testID="template-variable-number" onChangeText={setDraft} onBlur={commit} onSubmitEditing={commit} /></View>;
}

/**
 * Template mode: the editor of a locked template draft. The player, the row of slot chips under it, and the tabs
 * Media, Text and Audio — no timeline, no asset panel, no inspector, and no control that would change the structure.
 */
export function TemplateEditor(props: { player: ReactNode; media: MediaSession | null; readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const doc = runtime.controller.document, mode = doc.template!;
  const session = runtime.controller.session;
  const [tab, setTab] = useState<Tab>("media");
  const [selected, setSelected] = useState<string | null>(mode.slots[0]?.slotId ?? null);
  const [busy, setBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [, setThumbs] = useState(0);
  // A thumbnail that is still being read arrives a moment later: the chips are drawn again then.
  useEffect(() => props.media?.subscribe(() => setThumbs((count) => count + 1)), [props.media]);
  const slot = mode.slots.find((entry) => entry.slotId === selected) ?? null;
  const elementOf = (elementId: string): Json | undefined => findElement(doc, elementId)?.element as unknown as Json | undefined;
  const missing = template.missingRequired(doc);

  /** One change of the draft, one undo step. A refusal is said, and nothing changes. */
  const run = (change: (document: ProjectDocument, context: CommitContext) => Commit | null): boolean => {
    if (props.readOnly) return false;
    try { return runtime.controller.external(change); } catch (error) {
      toast.show({
        kind: "warning", message: error instanceof template.SlotRefused ? t(error.needs === "video" ? "This slot needs a video" : "This slot needs an image")
          : error instanceof DocumentRejected && error.errors.some((entry) => entry.code === "document/template-locked") ? t("This project is a template draft — open it in the full editor to change its structure") : error instanceof template.AudioRefused ? t(error.message) : error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
  const choose = (slotId: string) => { const entry = mode.slots.find((candidate) => candidate.slotId === slotId); if (!entry) return; setSelected(slotId); setTab("media"); const element = elementOf(entry.elementId); if (element) runtime.seek(element.startTime); };
  /** Imports picked files into the project and returns their assets in the order they were picked. */
  const importPicked = async (accept: string, multiple: boolean): Promise<{ id: string; type: string }[]> => {
    if (!props.media) return [];
    const files = await pickFiles(accept, multiple);
    if (files.length === 0) return [];
    setBusy(true);
    try {
      const result = await props.media.importFiles(files.map((file) => ({ file })));
      for (const failure of result.failures) toast.show({ kind: "warning", message: `${failure.name}: ${t("Couldn't import this file")}` });
      const assets = runtime.controller.document.media.assets;
      return result.outcomes.flatMap((outcome) => { const asset = outcome.status === "failed" ? undefined : assets.find((entry) => entry.id === outcome.assetId); return asset ? [{ id: asset.id, type: asset.type }] : []; });
    } finally { setBusy(false); }
  };
  /** "Add clips": the n-th picked file fills the n-th empty slot; fewer files leave the remaining slots empty. */
  const fillInOrder = async () => {
    const picked = await importPicked(MEDIA_ACCEPT, true);
    if (picked.length === 0) return;
    const empty = runtime.controller.document.template!.slots.filter((entry) => !entry.filled);
    const plan = template.fillPlan(empty.map((entry, index) => ({ ...entry, index: index + 1 })), picked);
    for (const fill of plan.fills) run((document, context) => template.fillSlot(document, context, fill.slotId, fill.assetId));
    for (const refusal of plan.refused) toast.show({ kind: "warning", message: t(refusal.needs === "video" ? "This slot needs a video" : "This slot needs an image") });
    if (picked.length > empty.length) toast.show({ kind: "info", message: t("{n} files were added to the project's media without a slot", { n: picked.length - empty.length }) });
  };
  const replace = async (slotId: string) => { const [asset] = await importPicked(MEDIA_ACCEPT, false); if (asset) run((document, context) => template.fillSlot(document, context, slotId, asset.id)); };
  const replaceAudio = async (elementId: string) => {
    const [asset] = await importPicked(AUDIO_ACCEPT, false);
    if (!asset) return;
    run((document, context) => template.replaceTemplateAudio(document, context, elementId, asset.id));
  };

  const chip = (entry: (typeof mode.slots)[number]) => {
    const element = elementOf(entry.elementId), url = entry.filled && element?.mediaId ? props.media?.thumbnail(element.mediaId) : null, on = entry.slotId === selected;
    const short = template.shorterThanSlot(doc, entry.slotId);
    return (
      <View key={entry.slotId} testID="template-slot" {...({ dataSet: { slot: entry.slotId, filled: String(entry.filled), required: String(entry.required) } } as object)}>
      <Tap role="tab" selected={on} label={t("Slot {n}", { n: entry.index })} onPress={() => choose(entry.slotId)}
        style={{ width: 76, gap: space[0.5], padding: space[1], borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: theme.color(on ? "accent" : "border/hairline"), backgroundColor: theme.color("bg/app") }}>
        <View style={{ height: 48, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/subtle") }}>
          {url ? <Image source={{ uri: url }} accessibilityLabel="" resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : <Text variant="title-sm" color="text/tertiary">{String(entry.index)}</Text>}
          {entry.required && !entry.filled ? <View testID="template-slot-required" style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color("danger") }} /> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text variant="meta" color="text/secondary">{`${entry.index} · ${(entry.duration / SECOND).toFixed(1)}s`}</Text>
          {short ? <Tooltip label={t("Shorter than slot")}><View testID="template-slot-short"><Text variant="meta" color="warning">!</Text></View></Tooltip> : null}
        </View>
      </Tap>
      </View>
    );
  };

  const element = slot ? elementOf(slot.elementId) : undefined;
  const isVideo = element?.type === "video" && slot?.filled === true;
  const maxOffset = isVideo ? template.maxSourceOffset(element!.sourceDuration ?? 0, slot!.duration) : 0;
  const adjust = (change: Parameters<typeof template.adjustTemplateSlot>[3]) => { if (slot) run((document, context) => template.adjustTemplateSlot(document, context, slot.slotId, change)); };
  const mediaTab = slot ? (
    <View testID="template-media-tab" style={{ gap: space[3] }}>
      <View style={{ gap: space[0.5] }}>
        <Text variant="body-medium">{slot.label ? `${t("Slot {n}", { n: slot.index })} — ${slot.label}` : t("Slot {n}", { n: slot.index })}</Text>
        <Text variant="meta" color="text/secondary">{`${durationBadge(slot.duration)} · ${t(slot.accepts === "video" ? "Video" : slot.accepts === "image" ? "Image" : "Video or image")} · ${t(slot.required ? "Required" : "Optional")}`}</Text>
        {template.shorterThanSlot(doc, slot.slotId) ? <Badge tone="warning" label={t("Shorter than slot")} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        <Button kind={slot.filled ? "secondary" : "strong"} icon="image" label={t(slot.filled ? "Replace" : "Choose media")} testID="template-slot-replace" loading={busy} disabled={props.readOnly || !props.media} onPress={() => void replace(slot.slotId)} />
        {slot.filled ? <Button kind="secondary" icon="trash" label={t("Remove")} testID="template-slot-remove" disabled={props.readOnly} onPress={() => run((document, context) => template.clearTemplateSlot(document, context, slot.slotId))} /> : null}
      </View>
      {slot.filled ? (
        <View testID="template-adjust" style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Adjust")}</Text>
          <Text variant="meta" color="text/secondary">{`${t("Zoom")} · ${slot.framing.zoom.toFixed(2)}×`}</Text>
          <Slider label={t("Zoom")} min={1} max={5} step={0.05} value={slot.framing.zoom} disabled={props.readOnly} onCommit={(value) => adjust({ zoom: value as number })} />
          <Text variant="meta" color="text/secondary">{t("Horizontal position")}</Text>
          <Slider label={t("Horizontal position")} min={-1} max={1} step={0.02} value={slot.framing.panX} disabled={props.readOnly} onCommit={(value) => adjust({ panX: value as number })} />
          <Text variant="meta" color="text/secondary">{t("Vertical position")}</Text>
          <Slider label={t("Vertical position")} min={-1} max={1} step={0.02} value={slot.framing.panY} disabled={props.readOnly} onCommit={(value) => adjust({ panY: value as number })} />
          {isVideo && maxOffset > 0 ? <Text variant="meta" color="text/secondary" testID="template-offset">{`${t("Start of the clip")} · ${durationBadge(slot.sourceOffset)}`}</Text> : null}
          {isVideo && maxOffset > 0 ? <Slider label={t("Start of the clip")} min={0} max={maxOffset / SECOND} step={0.1} value={slot.sourceOffset / SECOND} disabled={props.readOnly} onCommit={(value) => adjust({ sourceOffset: Math.round((value as number) * SECOND) })} /> : null}
          {isVideo ? <Switch label={t("Mute")} value={element!.muted === true} disabled={props.readOnly} onChange={(muted) => { run((document, context) => setElementFields(document, context, slot.elementId, { muted })); }} /> : null}
        </View>
      ) : null}
    </View>
  ) : <Text color="text/secondary">{t("This template has no clips to add.")}</Text>;
  const textTab = mode.variables?.length ? (
    <View testID="template-variables" style={{ gap: space[3] }}>
      {mode.variables.map((variable) => {
        if (variable.type === "text") {
          const binding = variable.bindings.find((entry) => entry.field === "content"), value = String(variable.value ?? variable.defaultValue ?? "");
          return <TextRow key={variable.id} elementId={binding?.elementId ?? variable.id} label={variable.label} maxLength={variable.maxLength ?? 10_000} content={value} onFocus={() => { const target = binding ? elementOf(binding.elementId) : undefined; if (target) runtime.seek(target.startTime); }} onCommit={(next) => run((document, context) => template.fillTemplateVariables(document, context, { [variable.id]: next }))} />;
        }
        if (variable.type === "color") return <View key={variable.id} testID="template-variable" {...({ dataSet: { variable: variable.id } } as object)}><ColorPicker label={variable.label === "Brand color {n}" ? t("Brand color {n}", { n: Number(/(\d+)$/.exec(variable.id)?.[1] ?? 1) }) : t(variable.label)} value={String(variable.value ?? variable.defaultValue ?? "#000000")} onChange={() => undefined} onCommit={(value) => { run((document, context) => template.fillTemplateVariables(document, context, { [variable.id]: value })); }} disabled={props.readOnly} width={240} onPickFromPreview={() => undefined} /></View>;
        if (variable.type === "number") return <NumberVariableRow key={variable.id} id={variable.id} label={variable.label} value={Number(variable.value ?? variable.defaultValue ?? 0)} onCommit={(value) => run((document, context) => template.fillTemplateVariables(document, context, { [variable.id]: value }))} />;
        return <View key={variable.id} testID="template-variable" {...({ dataSet: { variable: variable.id } } as object)} style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{variable.label}</Text><Button kind="secondary" icon="image" label={t("Choose media")} testID={`template-variable-image-${variable.id}`} loading={busy} disabled={props.readOnly || !props.media} onPress={async () => { const [asset] = await importPicked("image/*", false); if (asset) run((document, context) => template.fillTemplateVariables(document, context, { [variable.id]: asset.id })); }} /></View>;
      })}
    </View>
  ) : mode.editableTexts.length === 0 ? <Text color="text/secondary">{t("This template has no text to change.")}</Text> : (
    <View testID="template-text-tab" style={{ gap: space[3] }}>
      {mode.editableTexts.map((entry) => {
        const text = elementOf(entry.elementId);
        return <TextRow key={entry.elementId} elementId={entry.elementId} label={entry.label} maxLength={entry.maxLength} content={String(text?.content ?? "")} onFocus={() => { if (text) runtime.seek(text.startTime); }} onCommit={(content) => { run((document, context) => template.setTemplateText(document, context, entry.elementId, content)); }} />;
      })}
    </View>
  );
  const audioTab = mode.audioSlots.length === 0 ? <Text color="text/secondary" testID="template-audio-empty">{t("This template has no audio.")}</Text> : (
    <View testID="template-audio-tab" style={{ gap: space[3] }}>
      {mode.audioSlots.map((entry) => {
        const audio = elementOf(entry.elementId);
        return (
          <View key={entry.elementId} testID="template-audio" style={{ gap: space[1] }}>
            <Text variant="body-medium">{entry.label || t("Audio")}</Text>
            <Text variant="meta" color="text/secondary">{`${audio?.name ?? ""} · ${durationBadge(audio?.duration ?? 0)}`}</Text>
            <View style={{ flexDirection: "row", gap: space[3], alignItems: "center", flexWrap: "wrap" }}>
              {entry.replaceable ? <Button kind="secondary" icon="music" label={t("Replace")} testID="template-audio-replace" loading={busy} disabled={props.readOnly || !props.media} onPress={() => void replaceAudio(entry.elementId)} /> : null}
              <Switch label={t("Mute")} value={audio?.muted === true} disabled={props.readOnly} onChange={(muted) => { run((document, context) => setElementFields(document, context, entry.elementId, { muted })); }} />
            </View>
          </View>
        );
      })}
    </View>
  );

  const wide = theme.formFactor === "wide";
  const empty = mode.slots.filter((entry) => !entry.filled).length;
  const panel = (
    <View testID="template-panel" style={[{ minHeight: 0, backgroundColor: theme.color("bg/app") }, wide ? { width: 340, borderLeftWidth: 1, borderLeftColor: theme.color("border/hairline") } : { flex: 1, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }]}>
      <View style={{ paddingHorizontal: space[3], paddingTop: space[2] }}>
        <Tabs id="template-mode" label={t("Template")} value={tab} onChange={(id) => setTab(id as Tab)} items={[{ id: "media", label: t("Media"), count: mode.slots.length }, { id: "text", label: t("Text"), count: mode.editableTexts.length }, { id: "audio", label: t("Audio"), count: mode.audioSlots.length }]} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[3], gap: space[3] }}>{tab === "media" ? mediaTab : tab === "text" ? textTab : audioTab}</ScrollView>
    </View>
  );
  return (
    <View testID="template-editor" style={{ flex: 1, minHeight: 0 }}>
      <View testID="template-bar" style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap", paddingHorizontal: space[3], paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Badge tone="purple" label={t("Template draft")} />
        <IconButton icon="undo" size="sm" testID="template-undo" label={t("Undo")} disabled={!session.canUndo || props.readOnly} onPress={() => runtime.act("edit.undo")} />
        <IconButton icon="redo" size="sm" testID="template-redo" label={t("Redo")} disabled={!session.canRedo || props.readOnly} onPress={() => runtime.act("edit.redo")} />
        <View style={{ flex: 1 }} />
        {missing.length > 0 ? <Text variant="meta" color="text/secondary" testID="template-missing">{missing.length === 1 ? t("1 required clip is missing") : t("{n} required clips are missing", { n: missing.length })}</Text> : null}
        <ApplyBrandButton disabled={props.readOnly} run={run} />
        <Button kind="secondary" size="sm" label={t("Edit in full editor")} testID="template-unlock" disabled={props.readOnly} onPress={() => setUnlocking(true)} />
      </View>
      <View style={{ flex: 1, minHeight: 0, flexDirection: wide ? "row" : "column" }}>
        <View style={{ flex: wide ? 1 : 1.2, minWidth: 0, minHeight: 0 }}>
          <View style={{ flex: 1, minHeight: 0 }}>{props.player}</View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: space[2] }}><View role="tablist" aria-label={t("Slots")} testID="template-slots" style={{ flexDirection: "row", gap: space[2] }}>{mode.slots.map(chip)}</View></ScrollView>
            {empty > 0 ? <Button kind={empty === mode.slots.length ? "strong" : "secondary"} icon="plus" label={t("Add clips")} testID="template-fill" loading={busy} disabled={props.readOnly || !props.media} onPress={() => void fillInOrder()} /> : null}
          </View>
        </View>
        {panel}
      </View>
      <ConfirmDialog open={unlocking} title={t("Edit in full editor")} confirmLabel={t("Edit in full editor")} description={t("Structure locks are removed. This cannot be turned back into template mode.")} onClose={() => setUnlocking(false)}
        onConfirm={() => { setUnlocking(false); run((document, context) => leaveTemplateMode(document, context)); }} />
    </View>
  );
}
