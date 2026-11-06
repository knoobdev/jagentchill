import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { durationBadge, formatDateTime } from "@jagentchill/app-core";
import { uuidV4 } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { SNAPSHOT_LABEL_MAX, storageString, type SnapshotManager, type StorageLocale, type VersionEntry } from "@jagentchill/storage";
import { Badge, Button, IconButton, Input, languageOf, Menu, Modal, Text, Tooltip, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useRef } from "react";
import { useT } from "../locale";

/** The one "Version history" panel: the local snapshots of the project with Preview, Restore, Duplicate as new project, Rename and Delete, and "Save version". */
export function VersionHistory(props: { manager: SnapshotManager; projectName: string; onClose(): void; onPreview(entry: { document: ProjectDocument; label: string; id: string }): void; onRestore(id: string): void; onDuplicated(projectId: string): void; /** The versions of a synced project that are kept on the host, under the local ones. */ extra?: ReactNode }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const locale = languageOf(theme.locale) as StorageLocale;
  const s = (key: Parameters<typeof storageString>[0], values?: Record<string, string | number>) => storageString(key, values, locale);
  const [entries, setEntries] = useState<VersionEntry[] | null>(null);
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const anchors = useRef(new Map<string, View | null>());
  const anchor = useRef<View | null>(null);
  const refresh = useCallback(async () => setEntries(await props.manager.history()), [props.manager]);
  useEffect(() => { void refresh(); }, [refresh]);
  const fail = (error: unknown) => toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  const save = () => void props.manager.saveVersion(label).then(() => { setLabel(""); toast.show({ kind: "success", message: t("Version saved") }); return refresh(); }, fail);
  const restore = props.manager.restoreAvailability();
  const menu = (entry: VersionEntry): MenuItem[] => [
    { id: "preview", label: s("preview"), icon: "eye", onSelect: () => void props.manager.preview(entry.id).then((result) => props.onPreview({ document: result.document, label: formatDateTime(entry.created_ms, theme.locale), id: entry.id }), fail) },
    { id: "restore", label: s("restore"), icon: "undo", disabled: !restore.enabled, description: restore.tooltip ?? undefined, onSelect: () => props.onRestore(entry.id) },
    { id: "duplicate", label: s("duplicateAsNew"), icon: "copy", onSelect: () => { const id = uuidV4(); void props.manager.duplicateAsNewProject(entry.id, { id, name: t("{name} (version)", { name: props.projectName }) }).then(() => { props.onDuplicated(id); toast.show({ kind: "success", message: t("Project duplicated") }); }, fail); } },
    { id: "rename", label: s("rename"), icon: "pencil", onSelect: () => setRenaming({ id: entry.id, label: entry.label }) },
    { type: "separator" },
    { id: "delete", label: s("delete"), icon: "trash", danger: true, onSelect: () => void props.manager.delete(entry.id).then(refresh, fail) },
  ];
  const open = entries?.find((entry) => entry.id === menuFor);
  return (
    <Modal title={s("versionHistory")} width={640} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={props.onClose} /></>}>
      <View testID="version-history" style={{ gap: space[3] }}>
        <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
          <View style={{ flex: 1 }}><Input accessibilityLabel={t("Version label")} placeholder={t("Label (optional)")} value={label} onChangeText={(text) => setLabel([...text].slice(0, SNAPSHOT_LABEL_MAX).join(""))} onSubmitEditing={save} /></View>
          <Button kind="strong" icon="plus" label={s("saveVersion")} onPress={save} />
        </View>
        <ScrollView style={{ maxHeight: 360 }}>
          {entries === null ? null : entries.length === 0 ? <Text color="text/secondary">{t("No versions yet")}</Text> : entries.map((entry) => (
            <View key={entry.id} testID="version-row" style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 44, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                {renaming?.id === entry.id ? (
                  <Input accessibilityLabel={t("Version label")} size="sm" autoFocus value={renaming.label} onChangeText={(text) => setRenaming({ id: entry.id, label: [...text].slice(0, SNAPSHOT_LABEL_MAX).join("") })}
                    onBlur={() => { const next = renaming; setRenaming(null); void props.manager.rename(next.id, next.label).then(refresh, fail); }} onSubmitEditing={(event) => (event.target as unknown as { blur?(): void }).blur?.()} />
                ) : <Text variant="body-medium" numberOfLines={1}>{entry.label || formatDateTime(entry.created_ms, theme.locale)}</Text>}
                <Text variant="meta" color="text/secondary" numberOfLines={1}>{formatDateTime(entry.created_ms, theme.locale)} · {durationBadge("duration" in entry ? entry.duration : 0)}</Text>
              </View>
              <Badge label={entry.kind === "manual" ? s("snapshotManual") : s("snapshotAutomatic")} tone={entry.kind === "manual" ? "accent" : "neutral"} />
              {restore.enabled ? <Button size="xs" label={s("restore")} onPress={() => props.onRestore(entry.id)} /> : <Tooltip label={restore.tooltip ?? ""}><Button size="xs" label={s("restore")} disabled /></Tooltip>}
              <View ref={(node) => { anchors.current.set(entry.id, node); }}><IconButton icon="more" size="xs" label={t("Actions for {name}", { name: entry.label || formatDateTime(entry.created_ms, theme.locale) })} onPress={() => { anchor.current = anchors.current.get(entry.id) ?? null; setMenuFor(entry.id); }} /></View>
            </View>
          ))}
        </ScrollView>
        {open ? <Menu open anchor={anchor} items={menu(open)} label={s("versionHistory")} align="end" onClose={() => setMenuFor(null)} /> : null}
        {props.extra}
      </View>
    </Modal>
  );
}
