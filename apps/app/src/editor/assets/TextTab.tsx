import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { applyTextPreset, pasteTextStyle, timeline, type SavedTextPreset } from "@jagentchill/editor-core";
import { Button, Icon, IconButton, Input, Menu, Modal, SearchField, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { bindDrag } from "../../platform/store";
import { usePref } from "../../state";
import { bindCanvasDrop } from "../content-dom";
import { useEditor, useEditorVersion } from "../context";
import { PresetGrid } from "./PresetGrid";
import { TemplateGrid } from "./TemplateGrid";
import { SAVED_TEXT_PRESETS } from "./text-store";

/** The payload of a library item dragged out of an asset tab: the timeline and the canvas place it where it is dropped. */
export const itemsPayload = (items: timeline.LibraryItem[]): string => JSON.stringify({ items });
export function itemsOfPayload(payload: string | null): timeline.LibraryItem[] {
  try { const items = (JSON.parse(payload ?? "{}") as { items?: timeline.LibraryItem[] }).items; return Array.isArray(items) ? items : []; } catch { return []; }
}

/**
 * The Text tab: the default text card (click, or drag onto the timeline or the canvas), the text templates and the effect presets. A preset
 * clicked with text selected restyles it; with none selected it adds a new text in that look.
 */
export function TextTab(props: { readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime;
  const [query, setQuery] = useState("");
  const [presets, setPresets] = usePref(SAVED_TEXT_PRESETS);
  const [menu, setMenu] = useState<{ preset: SavedTextPreset; at: { x: number; y: number } } | null>(null);
  const [renaming, setRenaming] = useState<{ preset: SavedTextPreset; name: string } | null>(null);
  const card = useRef<View>(null);
  const content = t("Default text");
  const sceneId = () => controller.session.sceneId;
  const add = (extra: { position?: { x: number; y: number }; presetId?: string; fields?: Record<string, unknown> } = {}) => controller.run(timeline.addDefaultText({ sceneId: sceneId(), time: controller.session.playhead, ...extra, fields: { content, ...extra.fields } }));
  const selectedText = (): string[] => controller.session.selection.selectedElements.filter((id) => timeline.locate(controller.stored, id)?.element.type === "text");
  const canvas = controller.stored.settings.canvasSize;

  useEffect(() => (props.readOnly ? undefined : bindDrag(card.current, () => itemsPayload([{ kind: "text", fields: { content } }]))), [content, props.readOnly]);
  // A text card dropped on the canvas lands with its centre at the drop point.
  useEffect(() => (props.readOnly ? undefined : bindCanvasDrop(canvas, (payload) => itemsOfPayload(payload).some((item) => item.kind === "text"), (payload, point) => {
    const item = itemsOfPayload(payload).find((entry) => entry.kind === "text");
    if (item?.kind === "text") controller.run(timeline.addDefaultText({ sceneId: sceneId(), time: controller.session.playhead, position: point, fields: item.fields }));
  })), [canvas.width, canvas.height, props.readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (presetId: string | null) => {
    const ids = selectedText();
    if (ids.length > 0) controller.external((doc, ctx) => applyTextPreset(doc, ctx, ids, presetId));
    else add(presetId ? { presetId } : {});
  };
  const pickSaved = (preset: SavedTextPreset) => {
    const ids = selectedText();
    if (ids.length > 0) controller.external((doc, ctx) => pasteTextStyle(doc, ctx, ids, preset.style));
    else add({ fields: { ...preset.style, ...(preset.animation ? { textAnimation: preset.animation } : {}) } });
  };
  return (
    <View testID="text-tab" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ padding: space[2], paddingHorizontal: space[3] }}>
        <SearchField label={t("Search text presets")} placeholder={t("Search text presets...")} size="sm" value={query} onChangeText={setQuery} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[3] }}>
        {query.trim() === "" ? (
          <View ref={card} testID="text-card" style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/elevated") }}>
            <Tap role="button" label={t("Add text")} disabled={props.readOnly} testID="text-card-add" onPress={() => add()} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Icon name="type" size={16} color="text/secondary" />
              <View style={{ flex: 1 }}>
                <Text variant="body-medium">{content}</Text>
                <Text variant="meta" color="text/secondary">{t("Click or drag onto the timeline or canvas")}</Text>
              </View>
            </Tap>
            <IconButton icon="plus" size="sm" variant="outline" label={t("Add text")} disabled={props.readOnly} testID="text-add" onPress={() => add()} />
          </View>
        ) : null}
        <TemplateGrid query={query} disabled={props.readOnly} onPick={(templateId) => { controller.run(timeline.addTextTemplate({ sceneId: sceneId(), templateId, time: controller.session.playhead })); }} />
        <View style={{ gap: space[2] }}>
          <Text variant="meta" color="text/secondary">{t("Effects")}</Text>
          <PresetGrid query={query} disabled={props.readOnly} saved={presets} onPick={pick} onPickSaved={pickSaved} onSavedMenu={(preset, at) => setMenu({ preset, at })} />
        </View>
      </ScrollView>
      <Menu open={menu !== null} onClose={() => setMenu(null)} anchor={{ x: menu?.at.x ?? 0, y: menu?.at.y ?? 0, width: 1, height: 1 }} label={t("My presets")} items={menu ? [
        { id: "rename", label: t("Rename"), onSelect: () => setRenaming({ preset: menu.preset, name: menu.preset.name }) },
        { id: "delete", label: t("Delete"), danger: true, onSelect: () => setPresets(presets.filter((entry) => entry.id !== menu.preset.id)) },
      ] : []} />
      {renaming ? (
        <Modal title={t("Rename preset")} width={360} onClose={() => setRenaming(null)}
          footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={() => setRenaming(null)} /><Button size="sm" kind="primary" label={t("Rename")} disabled={renaming.name.trim().length === 0 || presets.some((entry) => entry.id !== renaming.preset.id && entry.name === renaming.name.trim())}
            onPress={() => { setPresets(presets.map((entry) => (entry.id === renaming.preset.id ? { ...entry, name: renaming.name.trim() } : entry))); setRenaming(null); }} /></>}>
          <Input accessibilityLabel={t("Preset name")} autoFocus maxLength={60} value={renaming.name} onChangeText={(name) => setRenaming({ ...renaming, name })} />
        </Modal>
      ) : null}
    </View>
  );
}
