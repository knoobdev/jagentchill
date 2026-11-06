import { useMemo, useState } from "react";
import { View } from "react-native";
import { durationBadge, formatFileSize } from "@jagentchill/app-core";
import { template, uuidV4 } from "@jagentchill/editor-core";
import { Button, Callout, FormDialog, FormField, IconButton, Input, Select, Switch, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useEditor, useEditorVersion } from "../editor/context";
import { useT } from "../locale";
import { useDevice } from "../state";
import { saveTemplate } from "./store";

const sizeLabel = (bytes: number): string => formatFileSize(bytes);

/**
 * "Save as template": the scene that is open becomes a template under My templates. The dialog chooses which clips
 * are slots, which texts can be changed and which audio can be replaced; the project itself is not changed.
 */
export function SaveTemplateDialog(props: { onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const { storage } = useDevice();
  const doc = runtime.controller.document, sceneId = runtime.controller.session.sceneId;
  const [draft, setDraft] = useState(() => template.proposeTemplate(doc, sceneId));
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const embedded = useMemo(() => template.embeddedAssets(doc, sceneId, draft), [doc, sceneId, draft]);
  const tooLarge = embedded.bytes > template.TEMPLATE_LIMITS.embeddedBytes;
  const slots = draft.media.filter((row) => row.slot).sort((a, b) => a.order - b.order);
  const setMedia = (elementId: string, change: Partial<template.TemplateDraft["media"][number]>) => setDraft({ ...draft, media: draft.media.map((row) => (row.elementId === elementId ? { ...row, ...change } : row)) });
  const setText = (elementId: string, change: Partial<template.TemplateDraft["texts"][number]>) => setDraft({ ...draft, texts: draft.texts.map((row) => (row.elementId === elementId ? { ...row, ...change } : row)) });
  /** A slot moves one place earlier or later: the order numbers of the two slots are exchanged. */
  const move = (elementId: string, by: -1 | 1) => {
    const at = slots.findIndex((row) => row.elementId === elementId), other = slots[at + by];
    if (at < 0 || !other) return;
    setDraft({ ...draft, media: draft.media.map((row) => (row.elementId === elementId ? { ...row, order: other.order } : row.elementId === other.elementId ? { ...row, order: slots[at].order } : row)) });
  };

  const save = async () => {
    if (!storage || busy) return;
    setBusy(true);
    try {
      const built = template.buildTemplate(doc, sceneId, { ...draft, tags: tags.split(",") }, { id: uuidV4(), now_ms: Date.now() });
      // The thumbnail is the project's own frame at the chosen time, as the engine renders it.
      const thumbnail = await runtime.engine?.still(draft.thumbnailTime, "jpeg", sceneId, { width: Math.round(480 * Math.min(1, built.manifest.canvas.width / built.manifest.canvas.height)), height: Math.round(480 * Math.min(1, built.manifest.canvas.height / built.manifest.canvas.width)) }).catch(() => null) ?? null;
      const entry = await saveTemplate(storage, doc.metadata.id, built, thumbnail);
      toast.show({ kind: "success", message: t("Saved {name} to My templates", { name: entry.manifest.name }) });
      props.onClose();
    } catch (error) {
      toast.show({ kind: "error", message: error instanceof template.TemplateRefused ? t(error.message) : error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  };
  const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: space[2], flexWrap: "wrap" as const };
  const section = (title: string, count: number) => <Text variant="body-medium" style={{ marginTop: space[1] }}>{`${title} · ${count}`}</Text>;
  if (!template.canSaveAsTemplate(doc)) return null;
  return (
    <FormDialog open title={t("Save as template")} width={640} submitLabel={t("Save template")} dirty={false} busy={busy} canSubmit={draft.name.trim() !== "" && !tooLarge && storage !== null} onSubmit={() => void save()} onClose={props.onClose}>
      <View testID="save-template" style={{ gap: space[3] }}>
        {doc.scenes.length > 1 ? <Callout tone="info">{t("This project has more than one scene. Only the scene that is open is saved.")}</Callout> : null}
        <FormField label={t("Name")} required><Input accessibilityLabel={t("Name")} autoFocus maxLength={template.TEMPLATE_LIMITS.name} value={draft.name} testID="save-template-name" onChangeText={(name) => setDraft({ ...draft, name })} /></FormField>
        <View style={{ flexDirection: theme.compact ? "column" : "row", gap: space[3] }}>
          <View style={{ flex: 1 }}><FormField label={t("Category")}><Select label={t("Category")} options={template.TEMPLATE_CATEGORIES.map((category) => ({ value: category, label: t(category) }))} value={draft.category} onChange={(category) => setDraft({ ...draft, category })} /></FormField></View>
          <View style={{ flex: 1 }}><FormField label={t("Tags")} description={t("Separate tags with commas.")}><Input accessibilityLabel={t("Tags")} value={tags} testID="save-template-tags" onChangeText={setTags} /></FormField></View>
        </View>

        {section(t("Clips"), draft.media.length)}
        {draft.media.length === 0 ? <Text variant="meta" color="text/secondary">{t("This scene has no video or image clip: the template has no slots.")}</Text> : null}
        {[...draft.media].sort((a, b) => Number(b.slot) - Number(a.slot) || a.order - b.order).map((item) => {
          const position = slots.findIndex((entry) => entry.elementId === item.elementId);
          return (
            <View key={item.elementId} testID="save-template-clip" {...({ dataSet: { slot: String(item.slot) } } as object)} style={[row, { padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }]}>
              <Switch accessibilityLabel={t("{name} is a slot", { name: item.name })} value={item.slot} onChange={(slot) => setMedia(item.elementId, { slot })} />
              <View style={{ width: 28, alignItems: "center" }}><Text variant="body-medium" color={item.slot ? "text/primary" : "text/tertiary"}>{item.slot ? String(position + 1) : "–"}</Text></View>
              <View style={{ flex: 1, minWidth: 120 }}><Text numberOfLines={1}>{item.name}</Text><Text variant="meta" color="text/secondary">{t(item.slot ? "Slot — the clip is replaced when the template is used" : "Kept — the clip is saved with the template")}</Text></View>
              {item.slot ? (
                <>
                  <IconButton icon="chev-u" size="xs" label={t("Move {name} earlier", { name: item.name })} disabled={position <= 0} onPress={() => move(item.elementId, -1)} />
                  <IconButton icon="chev-d" size="xs" label={t("Move {name} later", { name: item.name })} disabled={position === slots.length - 1} onPress={() => move(item.elementId, 1)} />
                  <Input accessibilityLabel={t("Label of slot {n}", { n: position + 1 })} size="sm" placeholder={t("Label")} maxLength={template.TEMPLATE_LIMITS.label} value={item.label} style={{ width: 130 }} onChangeText={(label) => setMedia(item.elementId, { label })} />
                  <Switch label={t("Required")} value={item.required} onChange={(required) => setMedia(item.elementId, { required })} />
                </>
              ) : null}
            </View>
          );
        })}

        {draft.texts.length ? section(t("Texts"), draft.texts.length) : null}
        {draft.texts.map((item) => (
          <View key={item.elementId} testID="save-template-text" style={[row, { padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }]}>
            <Switch accessibilityLabel={t("{name} can be changed", { name: item.label || item.content })} value={item.editable} onChange={(editable) => setText(item.elementId, { editable })} />
            <View style={{ flex: 1, minWidth: 120 }}><Text numberOfLines={1}>{item.content || t("Empty text")}</Text><Text variant="meta" color="text/secondary">{t(item.editable ? "Editable" : "Locked")}</Text></View>
            {item.editable ? (
              <>
                <Input accessibilityLabel={t("Label")} size="sm" placeholder={t("Label")} maxLength={template.TEMPLATE_LIMITS.label} value={item.label} style={{ width: 130 }} onChangeText={(label) => setText(item.elementId, { label })} />
                <Input accessibilityLabel={t("Maximum length")} size="sm" inputMode="numeric" suffix={t("characters")} value={String(item.maxLength)} style={{ width: 130 }} onChangeText={(value) => setText(item.elementId, { maxLength: Math.min(template.TEMPLATE_LIMITS.textMax, Math.max(1, Number(value.replace(/\D/g, "")) || 1)) })} />
              </>
            ) : null}
          </View>
        ))}

        {draft.audio.length ? section(t("Audio"), draft.audio.length) : null}
        {draft.audio.map((item) => (
          <View key={item.elementId} testID="save-template-audio" style={[row, { padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }]}>
            <Switch label={t("Replaceable")} value={item.replaceable} onChange={(replaceable) => setDraft({ ...draft, audio: draft.audio.map((entry) => (entry.elementId === item.elementId ? { ...entry, replaceable } : entry)) })} />
            <View style={{ flex: 1, minWidth: 120 }}><Text numberOfLines={1}>{item.name}</Text></View>
          </View>
        ))}

        {draft.themeColors.length ? section(t("Theme colours"), draft.themeColors.length) : null}
        {draft.themeColors.length ? (
          <View style={row}>
            {draft.themeColors.map((color) => (
              <View key={color} testID="save-template-colour" style={[row, { gap: space[1], paddingLeft: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }]}>
                <View style={{ width: 16, height: 16, borderRadius: radius.xs, backgroundColor: color, borderWidth: 1, borderColor: theme.color("border/control") }} />
                <Text variant="mono">{color}</Text>
                <IconButton icon="x" size="xs" label={t("Remove {name}", { name: color })} onPress={() => setDraft({ ...draft, themeColors: draft.themeColors.filter((entry) => entry !== color) })} />
              </View>
            ))}
          </View>
        ) : null}
        {draft.themeColors.length ? <Text variant="meta" color="text/secondary">{t("\"Apply brand\" replaces these colours in the texts and shapes that use them.")}</Text> : null}

        <View style={row}>
          <Text variant="body-medium">{t("Thumbnail")}</Text>
          <Text color="text/secondary" testID="save-template-thumb-time">{t("The frame at {time}", { time: durationBadge(draft.thumbnailTime) })}</Text>
          <Button kind="secondary" size="sm" label={t("Use the current frame")} onPress={() => setDraft({ ...draft, thumbnailTime: runtime.controller.session.playhead })} />
        </View>
        {tooLarge ? <Callout tone="danger">{t("The template would embed {size} of media, more than 2 GB. Turn more clips into slots.", { size: sizeLabel(embedded.bytes) })}</Callout>
          : <Text variant="meta" color="text/secondary" testID="save-template-size">{embedded.ids.length === 0 ? t("No media is saved with the template.") : t("Media saved with the template: {size}", { size: sizeLabel(embedded.bytes) })}</Text>}
      </View>
    </FormDialog>
  );
}
