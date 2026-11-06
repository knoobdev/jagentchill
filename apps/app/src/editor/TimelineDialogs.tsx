import { useState } from "react";
import { View } from "react-native";
import { durationBadge } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { Button, ConfirmDialog, FormField, Icon, IconButton, Input, MARKER_COLORS, Modal, NumberField, Tap, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { useEditor, useEditorVersion } from "./context";

type MarkerRecord = { id: string; time: number; color: number | string; note?: string; duration?: number };

/** The editor of one marker: note, colour and duration, each change one undo step; Delete removes it. */
export function MarkerPopover(props: { markerId: string; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, sceneId = controller.session.sceneId, scene = timeline.sceneById(controller.stored, sceneId);
  const marker = (scene.markers as MarkerRecord[]).find((entry) => entry.id === props.markerId);
  const [note, setNote] = useState(marker?.note ?? "");
  const [editSession] = useState(() => `marker-${props.markerId}-${Date.now()}`);
  if (!marker) return null;
  const sceneDuration = timeline.sceneDurationOf(scene);
  return (
    <Modal title={t("Marker")} width={360} onClose={props.onClose}
      footer={<><Button kind="ghost" tone="danger" size="sm" icon="trash" label={t("Delete marker")} testID="marker-delete" onPress={() => { controller.run(timeline.deleteMarker({ sceneId, markerId: marker.id })); props.onClose(); }} /><View style={{ flex: 1 }} /><Button size="sm" label={t("Done")} onPress={props.onClose} /></>}>
      <View style={{ gap: space[3] }}>
        <FormField label={t("Note")}>
          <Textarea accessibilityLabel={t("Note")} value={note} maxLength={timeline.MARKER_NOTE_MAX} minLines={2} maxLines={5} testID="marker-note"
            onChangeText={(text) => { setNote(text); controller.run(timeline.editMarker({ sceneId, markerId: marker.id, note: text, editSession })); }} />
        </FormField>
        <FormField label={t("Color")}>
          <View role="radiogroup" aria-label={t("Color")} style={{ flexDirection: "row", gap: space[1.5] }}>
            {MARKER_COLORS.map(([token, name], index) => (
              <Tap key={token} role="radio" label={t(name)} checked={marker.color === index} tooltip={{ label: t(name) }} onPress={() => controller.run(timeline.editMarker({ sceneId, markerId: marker.id, color: index }))}
                style={{ width: 24, height: 24, borderRadius: radius.full, backgroundColor: theme.color(token), borderWidth: marker.color === index ? 2 : 0, borderColor: theme.color("timeline/selection") }} />
            ))}
          </View>
        </FormField>
        <FormField label={t("Duration")}>
          <NumberField label={t("Duration")} hideLabel unit="s" min={0} max={Math.max(0, (sceneDuration - marker.time) / TICKS_PER_SECOND)} step={0.1} width={96} value={Number(((marker.duration ?? 0) / TICKS_PER_SECOND).toFixed(2))}
            onCommit={(seconds) => controller.run(timeline.editMarker({ sceneId, markerId: marker.id, durationSeconds: seconds }))} />
        </FormField>
      </View>
    </Modal>
  );
}

/** The Scenes sheet: the scenes of the project with their durations; switch, create, rename, duplicate, reorder and delete. */
export function ScenesSheet(props: { onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, doc = controller.stored;
  const scenes = timeline.sceneList(doc), limit = timeline.sceneLimitState(doc);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const commitRename = () => { if (!renaming) return; const name = timeline.committedName(renaming.draft); setRenaming(null); if (name) controller.run(timeline.renameScene({ sceneId: renaming.id, name })); };
  const deletion = deleting ? timeline.sceneDeletionState(doc, [deleting]) : null;
  return (
    <Modal title={t("Scenes")} width={480} onClose={props.onClose}
      footer={<><Button size="sm" icon="plus" label={t("New scene")} disabled={!limit.enabled} testID="scene-new" onPress={() => controller.run(timeline.createScene())} />{limit.reason ? <Text variant="meta" color="text/secondary">{t(limit.reason)}</Text> : null}<View style={{ flex: 1 }} /><Button size="sm" label={t("Close")} onPress={props.onClose} /></>}>
      <View role="list" aria-label={t("Scenes")} style={{ gap: space[1] }}>
        {scenes.map((scene, index) => (
          <View key={scene.id} role="listitem" testID={`scene-row-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: space[1], height: 40, paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: scene.active ? theme.color("bg/subtle") : "transparent" }}>
            {renaming?.id === scene.id ? (
              <View style={{ flex: 1 }}><Input autoFocus accessibilityLabel={t("Scene name")} value={renaming.draft} maxLength={64} onChangeText={(draft) => setRenaming({ id: scene.id, draft })} onBlur={commitRename} onSubmitEditing={commitRename} /></View>
            ) : (
              <Tap role="button" label={t("Open scene {name}", { name: scene.name })} current={scene.active} onPress={() => { controller.switchScene(scene.id); props.onClose(); }} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[2], height: 32 }}>
                {scene.isMain ? <Icon name="star" size={14} color="text/secondary" /> : scene.kind !== "timeline" ? <Icon name="layers" size={14} color="text/secondary" /> : null}
                <Text variant={scene.active ? "body-medium" : "body"} numberOfLines={1} style={{ flexShrink: 1 }}>{scene.name}</Text>
                <Text variant="meta" color="text/secondary" tabular>{durationBadge(scene.duration)}</Text>
              </Tap>
            )}
            <IconButton icon="arrow-up" size="xs" label={t("Move up")} disabled={index === 0} onPress={() => controller.run(timeline.reorderScene({ sceneId: scene.id, toIndex: index - 1 }))} />
            <IconButton icon="arrow-d" size="xs" label={t("Move down")} disabled={index === scenes.length - 1} onPress={() => controller.run(timeline.reorderScene({ sceneId: scene.id, toIndex: index + 1 }))} />
            <IconButton icon="pencil" size="xs" label={t("Rename")} onPress={() => setRenaming({ id: scene.id, draft: scene.name })} />
            <IconButton icon="copy" size="xs" label={t("Duplicate")} disabled={!limit.enabled} onPress={() => controller.run(timeline.duplicateScene({ sceneId: scene.id }))} />
            <IconButton icon="trash" size="xs" label={t("Delete")} disabled={scene.isMain || !timeline.sceneDeletionState(doc, [scene.id]).enabled} onPress={() => setDeleting(scene.id)} />
          </View>
        ))}
      </View>
      {deleting && deletion ? <ConfirmDialog open title={t("Delete scene")} description={deletion.confirmation ?? t("This scene and everything on it are removed.")} confirmLabel={t("Delete")} onClose={() => setDeleting(null)}
        onConfirm={() => { const id = deleting; setDeleting(null); controller.run(timeline.deleteScenes({ sceneIds: [id] })); }} /> : null}
    </Modal>
  );
}

/** "Rename": the name of a clip, 1–64 characters after trimming. */
export function RenameElementDialog(props: { elementId: string; onClose(): void }) {
  const t = useT();
  const runtime = useEditor();
  const { controller } = runtime, element = timeline.locate(controller.stored, props.elementId)?.element;
  const [name, setName] = useState(element?.name ?? "");
  if (!element) return null;
  const commit = () => { const next = timeline.committedName(name); props.onClose(); if (next && next !== element.name) controller.run(timeline.renameElement({ sceneId: controller.session.sceneId, elementId: element.id, name: next })); };
  return (
    <Modal title={t("Rename")} width={360} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={props.onClose} /><Button size="sm" kind="primary" label={t("Rename")} disabled={timeline.committedName(name) === null} testID="rename-apply" onPress={commit} /></>}>
      <FormField label={t("Name")}><Input autoFocus accessibilityLabel={t("Name")} value={name} maxLength={64} onChangeText={setName} onSubmitEditing={commit} /></FormField>
    </Modal>
  );
}

/** "Replace media": the project's assets the clip can take; picking one replaces the source and keeps the clip's place and length. */
export function ReplaceMediaDialog(props: { elementId: string; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { controller } = runtime, element = timeline.locate(controller.stored, props.elementId)?.element;
  if (!element) return null;
  const assets = controller.stored.media.assets.filter((asset) => !asset.ephemeral && asset.id !== element.mediaId && timeline.canReplaceWith(element, asset));
  return (
    <Modal title={t("Replace media")} width={480} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={props.onClose} /></>}>
      <View role="list" testID="replace-list" style={{ gap: 2 }}>
        {assets.length === 0 ? <Text variant="meta" color="text/secondary">{t("No other media of this kind in the project")}</Text> : null}
        {assets.map((asset) => (
          <Tap key={asset.id} role="button" label={asset.name} onPress={() => { props.onClose(); controller.run(timeline.replaceMedia({ elementId: element.id, assetId: asset.id })); }}
            style={(state) => ({ flexDirection: "row", alignItems: "center", gap: space[2], height: 36, paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
            <Icon name={asset.type === "audio" ? "music" : "image"} size={14} color="text/secondary" /><Text numberOfLines={1} style={{ flex: 1 }}>{asset.name}</Text><Text variant="meta" color="text/secondary" tabular>{asset.duration ? durationBadge(asset.duration) : ""}</Text>
          </Tap>
        ))}
      </View>
    </Modal>
  );
}
