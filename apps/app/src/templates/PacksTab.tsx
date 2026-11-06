import { useMemo, useState } from "react";
import { View } from "react-native";
import { template } from "@jagentchill/editor-core";
import { blobZipSource, FILE_FORMATS, PackageError } from "@jagentchill/storage";
import { Button, Checkbox, ConfirmDialog, EmptyState, FormDialog, FormField, Input, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { createFileSink } from "../platform/media";
import { pickFiles } from "../platform/store";
import { usePref } from "../state";
import { exportPack, importPack, INSTALLED_PACKS, ownPresets, PACK_KIND_LABEL, packFileName, removePack, type OwnPreset } from "./packs";

const REFUSAL: Record<template.PackRefusal["reason"], string> = { "unknown-kind": "This kind of preset is not supported", code: "Files that hold code are never imported", invalid: "It is not a preset this version can read" };

/**
 * Preset packs: the packs imported on this device, with "Remove pack", and "Export as pack" for the presets the user
 * saved in the editor. An imported preset is listed and applied in the editor where the user's own presets are.
 */
export function PacksTab() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const [packs] = usePref(INSTALLED_PACKS);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<template.InstalledPack | null>(null);
  const [exporting, setExporting] = useState<{ name: string; chosen: Set<string>; presets: OwnPreset[] } | null>(null);
  const own = useMemo(() => ownPresets(), [packs, exporting === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const runImport = async () => {
    const files = await pickFiles(FILE_FORMATS.pack.extension, true);
    if (files.length === 0) return;
    setBusy(true);
    for (const file of files) {
      try {
        const result = await importPack(blobZipSource(file));
        toast.show({ kind: "success", message: result.replaced ? t("Replaced {name}: {n} presets", { name: result.pack.name, n: result.imported }) : t("Imported {name}: {n} presets", { name: result.pack.name, n: result.imported }) });
        for (const refusal of result.refused) toast.show({ kind: "warning", sticky: true, message: t("Refused {name}: {reason}", { name: refusal.name, reason: t(REFUSAL[refusal.reason]) }) });
      } catch (error) { toast.show({ kind: "error", sticky: true, message: `${file.name}: ${error instanceof PackageError ? t(error.message) : error instanceof Error ? error.message : String(error)}` }); }
    }
    setBusy(false);
  };
  const runExport = async () => {
    if (!exporting) return;
    const { name, chosen, presets } = exporting;
    setExporting(null);
    try {
      const manifest = await exportPack(presets.filter((entry) => chosen.has(entry.key)), name, await createFileSink(packFileName(name), FILE_FORMATS.pack.mime));
      toast.show({ kind: "success", message: t("Exported {name}: {n} presets", { name: manifest.name, n: manifest.items.length }) });
    } catch (error) { if (!(error instanceof PackageError && error.code === "cancelled")) toast.show({ kind: "error", message: error instanceof template.PackInvalid ? t(error.reason) : error instanceof Error ? error.message : String(error) }); }
  };
  const toggle = (key: string, on: boolean) => { if (!exporting) return; const chosen = new Set(exporting.chosen); if (on) chosen.add(key); else chosen.delete(key); setExporting({ ...exporting, chosen }); };
  const sorted = [...packs].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <View testID="packs-tab" style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Text color="text/secondary" style={{ flex: 1, minWidth: 200 }}>{own.length === 1 ? t("1 preset of your own can be exported.") : t("{n} presets of your own can be exported.", { n: own.length })}</Text>
        <Button kind="secondary" icon="export" label={t("Export as pack")} testID="packs-export" disabled={own.length === 0} onPress={() => setExporting({ name: "", chosen: new Set(own.map((entry) => entry.key)), presets: own })} />
        <Button kind="strong" icon="download" label={t("Import")} testID="packs-import" loading={busy} onPress={() => void runImport()} />
      </View>
      {sorted.length === 0 ? (
        <View testID="packs-first-use"><EmptyState icon="box" title={t("No preset packs yet")} description={t("A preset pack adds text, effect, transition and adjustment presets to the editor. Import a pack, or export the presets you saved as one.")} actions={[{ label: t("Import"), kind: "strong", onPress: () => void runImport() }]} /></View>
      ) : (
        <View role="list" aria-label={t("Preset packs")} testID="packs-list" style={{ gap: space[2] }}>
          {sorted.map((pack) => (
            <View key={pack.id} role="listitem" testID="pack-row" {...({ dataSet: { name: pack.name } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap", padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
              <View style={{ flex: 1, minWidth: 180 }}>
                <Text variant="body-medium" numberOfLines={1} testID="pack-name">{pack.name}</Text>
                <Text variant="meta" color="text/secondary" testID="pack-meta">{[pack.itemCount === 1 ? t("1 preset") : t("{n} presets", { n: pack.itemCount }), pack.author ? t("by {author}", { author: pack.author }) : null, pack.license || null].filter(Boolean).join(" · ")}</Text>
                <Text variant="meta" color="text/secondary">{template.PACK_KINDS.filter((kind) => pack.counts[kind]).map((kind) => `${t(PACK_KIND_LABEL[kind])}: ${pack.counts[kind]}`).join(" · ")}</Text>
              </View>
              <Button kind="secondary" tone="danger" icon="trash" label={t("Remove pack")} testID="pack-remove" onPress={() => setRemoving(pack)} />
            </View>
          ))}
        </View>
      )}
      <ConfirmDialog open={removing !== null} title={removing ? t("Remove {name}?", { name: removing.name }) : ""} confirmLabel={t("Remove pack")} description={t("The presets of this pack are removed from the editor's libraries. Projects that already use them are not changed.")} onClose={() => setRemoving(null)}
        onConfirm={() => { const pack = removing; setRemoving(null); if (pack) { removePack(pack.id); toast.show({ kind: "info", message: t("Removed {name}", { name: pack.name }) }); } }} />
      <FormDialog open={exporting !== null} title={t("Export as pack")} submitLabel={t("Export")} dirty={false} width={480} canSubmit={exporting !== null && exporting.name.trim() !== "" && exporting.chosen.size > 0} onSubmit={() => void runExport()} onClose={() => setExporting(null)}>
        {exporting ? (
          <View testID="packs-export-dialog" style={{ gap: space[3] }}>
            <FormField label={t("Pack name")} required><Input accessibilityLabel={t("Pack name")} autoFocus maxLength={template.PACK_LIMITS.name} value={exporting.name} testID="packs-export-name" onChangeText={(name) => setExporting({ ...exporting, name })} /></FormField>
            {template.PACK_KINDS.filter((kind) => exporting.presets.some((entry) => entry.kind === kind)).map((kind) => (
              <View key={kind} style={{ gap: space[1] }}>
                <Text variant="body-medium">{t(PACK_KIND_LABEL[kind])}</Text>
                {exporting.presets.filter((entry) => entry.kind === kind).map((entry) => <Checkbox key={entry.key} label={entry.preset.name} checked={exporting.chosen.has(entry.key)} onChange={(on) => toggle(entry.key, on)} />)}
              </View>
            ))}
          </View>
        ) : null}
      </FormDialog>
    </View>
  );
}
