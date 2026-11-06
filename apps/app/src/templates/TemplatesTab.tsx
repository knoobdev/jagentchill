import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { durationBadge, formatFileSize, formatSeconds } from "@jagentchill/app-core";
import { template } from "@jagentchill/editor-core";
import { PROJECT_SCHEMA_VERSION } from "@jagentchill/protocol";
import { blobZipSource, FILE_FORMATS, PackageError, type StoragePort } from "@jagentchill/storage";
import {
  Badge, Button, Callout, ConfirmDialog, EmptyState, FormDialog, FormField, IconButton, Input, LoadingSkeleton, Menu, Modal, SearchField, Select, Skeleton, Tabs, Tap, Text, radius, space, useTheme, useToast, type MenuItem,
} from "@jagentchill/ui";
import { useT } from "../locale";
import { createFileSink } from "../platform/media";
import { pickFiles } from "../platform/store";
import { useDevice } from "../state";
import { useTemplates } from "./hooks";
import {
  committedTemplateName, createProjectFromTemplate, deleteTemplate, duplicateTemplate, exportSummary, exportTemplatePackage, importTemplatePackage, templateFileName, updateTemplate, type ImportConflict, type TemplateEntry,
} from "./store";
import { starterDescription } from "./strings";
import { TemplateThumb } from "./TemplateThumb";

const SECOND = 120_000;
type Source = "bundled" | "mine";
type Dialog =
  | { kind: "preview"; entry: TemplateEntry } | { kind: "rename"; entry: TemplateEntry; draft: string } | { kind: "details"; entry: TemplateEntry; category: template.TemplateCategory; tags: string }
  | { kind: "delete"; entry: TemplateEntry } | { kind: "export"; entry: TemplateEntry } | { kind: "conflict"; name: string; resolve(choice: ImportConflict): void };
const sizeLabel = (bytes: number): string => formatFileSize(bytes);
const seconds = (ticks: number): string => formatSeconds(ticks / SECOND, ticks % SECOND === 0 ? 0 : 1);

function CardMenu(props: { name: string; items: MenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const more = useRef<View>(null);
  return (
    <>
      <IconButton ref={more} icon="more" size="xs" compactVisual label={t("Actions for {name}", { name: props.name })} testID="template-menu" expanded={open} onPress={() => setOpen(true)} />
      <Menu open={open} anchor={more} items={props.items} label={props.name} align="end" onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The template gallery: the starter templates and My templates, by category, aspect ratio and a search of names and
 * tags. A card opens the template's preview; "Use template" starts a new project from it. It reads only this device.
 */
export function TemplatesTab(props: { onUse?(entry: TemplateEntry): void; actionLabel?: string; columns?: number }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { library } = useDevice();
  const { storage, bundled, personal, failed, retry } = useTemplates();
  const [source, setSource] = useState<Source>("bundled");
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState<template.TemplateFilter>(template.NO_TEMPLATE_FILTER);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  const entries = source === "bundled" ? bundled : personal ?? [];
  const shown = useMemo(() => { const ids = new Set(template.filterTemplates(entries.map((entry) => entry.manifest), filter).map((manifest) => manifest.id)); return entries.filter((entry) => ids.has(entry.manifest.id)); }, [entries, filter]);
  const filtered = filter.category !== null || filter.ratio !== null || filter.query.trim() !== "";
  const clear = () => { setTyped(""); setFilter(template.NO_TEMPLATE_FILTER); };

  const use = async (entry: TemplateEntry) => {
    if (props.onUse) { setDialog(null); props.onUse(entry); return; }
    if (!storage || busy) return;
    setBusy(true);
    try {
      const project = await createProjectFromTemplate(storage, entry);
      await library?.refresh(project.metadata.id);
      setDialog(null);
      router.push(`/editor/${project.metadata.id}` as never);
    } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); } finally { setBusy(false); }
  };
  const duplicate = async (entry: TemplateEntry) => {
    if (!storage) return;
    const copy = await duplicateTemplate(storage, entry, entry.bundled ? entry.manifest.name : `${entry.manifest.name.slice(0, 75)} copy`).catch((error: unknown) => { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); return null; });
    if (!copy) return;
    toast.show({ kind: "success", message: t("Added {name} to My templates", { name: copy.manifest.name }) });
    setSource("mine");
  };
  const runExport = async (entry: TemplateEntry) => {
    setDialog(null);
    if (!storage) return;
    try {
      await exportTemplatePackage(storage, entry, await createFileSink(templateFileName(entry.manifest.name), FILE_FORMATS.template.mime));
      toast.show({ kind: "success", message: t("Package exported") });
    } catch (error) { if (!(error instanceof PackageError && error.code === "cancelled")) toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const runImport = async () => {
    if (!storage) return;
    const files = await pickFiles(FILE_FORMATS.template.extension, true);
    if (files.length === 0) return;
    setBusy(true);
    const done = { imported: 0, replaced: 0, skipped: 0 };
    for (const file of files) {
      try {
        const result = await importTemplatePackage(storage, blobZipSource(file), { schemaVersion: PROJECT_SCHEMA_VERSION, onConflict: (name) => new Promise<ImportConflict>((resolve) => setDialog({ kind: "conflict", name, resolve })) });
        done[result.status]++;
      } catch (error) { toast.show({ kind: "error", sticky: true, message: `${file.name}: ${error instanceof PackageError ? t(error.message) : error instanceof Error ? error.message : String(error)}` }); }
    }
    setBusy(false);
    if (done.imported + done.replaced + done.skipped > 0) {
      toast.show({ kind: done.imported + done.replaced > 0 ? "success" : "info", message: t("Templates: {imported} imported, {replaced} replaced, {skipped} skipped", done) });
      if (done.imported + done.replaced > 0) setSource("mine");
    }
  };
  const menuOf = (entry: TemplateEntry): MenuItem[] => entry.bundled ? [
    { id: "use", label: t(props.actionLabel ?? "Use template"), icon: "plus", onSelect: () => void use(entry) },
    { id: "duplicate", label: t("Duplicate to My templates"), icon: "copy", disabled: !storage, onSelect: () => void duplicate(entry) },
  ] : [
    { id: "use", label: t(props.actionLabel ?? "Use template"), icon: "plus", onSelect: () => void use(entry) },
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => setDialog({ kind: "rename", entry, draft: entry.manifest.name }) },
    { id: "details", label: t("Edit details"), icon: "gear", onSelect: () => setDialog({ kind: "details", entry, category: entry.manifest.category, tags: entry.manifest.tags.join(", ") }) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => void duplicate(entry) },
    { id: "export", label: t("Export package"), icon: "export", onSelect: () => setDialog({ kind: "export", entry }) },
    { type: "separator" }, { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => setDialog({ kind: "delete", entry }) },
  ];
  const metaOf = (entry: TemplateEntry): string => [durationBadge(entry.manifest.duration), template.ratioLabel(entry.manifest.canvas), entry.manifest.slots.length === 1 ? t("1 clip") : t("{n} clips", { n: entry.manifest.slots.length })].join(" · ");

  const columns = props.columns ?? (width < 480 ? 2 : width < 760 ? 3 : width < 1100 ? 4 : 5), gap = space[3];
  const cardWidth = width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : 0;
  const categories = [{ value: "all", label: t("All categories") }, ...template.TEMPLATE_CATEGORIES.map((category) => ({ value: category as string, label: t(category) }))];
  const ratios = [{ value: "all", label: t("All ratios") }, ...template.TEMPLATE_RATIOS.map((ratio) => ({ value: ratio as string, label: ratio }))];
  let body;
  if (source === "mine" && personal === null && failed) body = <Callout tone="danger" actions={[{ label: t("Retry"), onPress: retry }]}>{t("The library could not be read.")}</Callout>;
  else if (source === "mine" && personal === null) body = <LoadingSkeleton testID="templates-skeleton" style={{ flexDirection: "row", gap }}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={{ flex: 1 }}><Skeleton height={160} /></View>)}</LoadingSkeleton>;
  else if (shown.length === 0 && filtered) body = <View testID="templates-no-results"><EmptyState icon="search" title={t("No templates match your search")} actions={[{ label: t("Clear filters"), onPress: clear }]} /></View>;
  else if (shown.length === 0) body = <View testID="templates-first-use"><EmptyState icon="template" title={t("No templates yet")} description={t("Save a project as a template from the editor's menu, or import a template package.")} actions={[{ label: t("Import"), kind: "strong", onPress: () => void runImport() }]} /></View>;
  else body = (
    <View role="list" aria-label={t("Templates")} testID="templates-grid" style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {cardWidth > 0 ? shown.map((entry) => (
        <View key={entry.manifest.id} role="listitem" testID="template-card" {...({ dataSet: { id: entry.manifest.id, name: entry.manifest.name, source: entry.bundled ? "bundled" : "mine" } } as object)} style={{ width: cardWidth, gap: space[1] }}>
          <Tap label={t("Preview {name}", { name: entry.manifest.name })} testID="template-open" onPress={() => setDialog({ kind: "preview", entry })} style={{ height: cardWidth, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
            <TemplateThumb entry={entry} storage={storage} width={cardWidth - space[3]} maxHeight={cardWidth - space[3]} />
          </Tap>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} testID="template-name">{entry.bundled ? t(entry.manifest.name) : entry.manifest.name}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1} testID="template-meta">{metaOf(entry)}</Text>
            </View>
            <CardMenu name={entry.manifest.name} items={menuOf(entry)} />
          </View>
        </View>
      )) : null}
    </View>
  );

  const preview = dialog?.kind === "preview" ? dialog.entry : null;
  const exporting = dialog?.kind === "export" ? exportSummary(dialog.entry) : null;
  return (
    <View testID="templates-tab" style={{ gap: space[3] }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Tabs id="templates-source" variant="pill" label={t("Templates")} value={source} onChange={(id) => setSource(id as Source)} items={[{ id: "bundled", label: t("Bundled"), count: bundled.length }, { id: "mine", label: t("My templates"), count: personal?.length }]} />
        <View style={{ flex: 1 }} />
        <Button kind="secondary" icon="download" label={t("Import")} testID="templates-import" loading={busy} disabled={!storage} onPress={() => void runImport()} />
      </View>
      <View testID="templates-toolbar" style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <View style={theme.compact ? { flexBasis: "100%" } : { width: 300 }}><SearchField label={t("Search templates")} placeholder={t("Search by name or tag…")} value={typed} onChangeText={setTyped} debounce={150} onSearch={(query) => setFilter((current) => ({ ...current, query }))} /></View>
        <Select label={t("Category")} width={170} options={categories} value={filter.category ?? "all"} onChange={(value) => setFilter({ ...filter, category: value === "all" ? null : value as template.TemplateCategory })} />
        <Select label={t("Aspect ratio")} width={130} options={ratios} value={filter.ratio ?? "all"} onChange={(value) => setFilter({ ...filter, ratio: value === "all" ? null : value as template.TemplateRatio })} />
        {filtered ? <Button kind="link" size="sm" label={t("Clear filters")} testID="templates-clear" onPress={clear} /> : null}
      </View>
      {body}

      <Modal open={preview !== null} title={preview ? (preview.bundled ? t(preview.manifest.name) : preview.manifest.name) : ""} width={640} onClose={() => setDialog(null)}
        footer={preview ? <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2] }}><Button kind="secondary" label={t("Close")} onPress={() => setDialog(null)} /><Button kind="strong" icon="plus" label={t(props.actionLabel ?? "Use template")} testID="template-use" loading={busy} disabled={!storage && !props.onUse} onPress={() => void use(preview)} /></View> : null}>
        {preview ? (
          <View testID="template-preview" style={{ flexDirection: theme.compact ? "column" : "row", gap: space[4] }}>
            <View style={{ alignItems: "center" }}><TemplateThumb entry={preview} storage={storage} width={theme.compact ? 220 : 260} maxHeight={320} play /></View>
            <View style={{ flex: 1, minWidth: 0, gap: space[2] }}>
              <View style={{ flexDirection: "row", gap: space[1], flexWrap: "wrap" }}><Badge label={t(preview.manifest.category)} /><Badge label={template.ratioLabel(preview.manifest.canvas)} /><Badge label={durationBadge(preview.manifest.duration)} />{preview.bundled ? <Badge kind="built-in" label={t("Built-in")} /> : null}</View>
              {preview.bundled && starterDescription(preview.manifest.id) ? <Text testID="template-description">{t(starterDescription(preview.manifest.id)!)}</Text> : null}
              {preview.manifest.tags.length ? <Text variant="meta" color="text/secondary">{preview.manifest.tags.join(", ")}</Text> : null}
              <Text variant="body-medium">{preview.manifest.slots.length === 1 ? t("1 clip to add") : t("{n} clips to add", { n: preview.manifest.slots.length })}</Text>
              {preview.manifest.slots.map((slot) => <Text key={slot.slotId} variant="meta" color="text/secondary" testID="template-preview-slot">{`${slot.index}. ${slot.label || t("Clip {n}", { n: slot.index })} · ${seconds(slot.duration)} · ${t(slot.required ? "Required" : "Optional")}`}</Text>)}
              {preview.manifest.editableTexts.length ? <Text variant="body-medium" style={{ marginTop: space[1] }}>{t("Texts you can change")}</Text> : null}
              {preview.manifest.editableTexts.map((text) => <Text key={text.elementId} variant="meta" color="text/secondary">{`${text.label} · ${t("up to {n} characters", { n: text.maxLength })}`}</Text>)}
            </View>
          </View>
        ) : null}
      </Modal>
      <FormDialog open={dialog?.kind === "rename"} title={t("Rename")} submitLabel={t("Rename")} dirty={false} canSubmit={dialog?.kind === "rename" && committedTemplateName(dialog.draft) !== null}
        onSubmit={() => { if (dialog?.kind !== "rename" || !storage) return; const name = committedTemplateName(dialog.draft); setDialog(null); if (name) void updateTemplate(storage, dialog.entry, { name }); }} onClose={() => setDialog(null)}>
        {dialog?.kind === "rename" ? <Input accessibilityLabel={t("Name")} autoFocus maxLength={template.TEMPLATE_LIMITS.name} value={dialog.draft} testID="template-name-input" onChangeText={(draft) => setDialog({ ...dialog, draft })} /> : null}
      </FormDialog>
      <FormDialog open={dialog?.kind === "details"} title={t("Edit details")} submitLabel={t("Save")} dirty={false}
        onSubmit={() => { if (dialog?.kind !== "details" || !storage) return; setDialog(null); void updateTemplate(storage, dialog.entry, { category: dialog.category, tags: dialog.tags.split(",") }); }} onClose={() => setDialog(null)}>
        {dialog?.kind === "details" ? (
          <View style={{ gap: space[3] }}>
            <FormField label={t("Category")}><Select label={t("Category")} options={template.TEMPLATE_CATEGORIES.map((category) => ({ value: category, label: t(category) }))} value={dialog.category} onChange={(category) => setDialog({ ...dialog, category })} /></FormField>
            <FormField label={t("Tags")} description={t("Separate tags with commas.")}><Input accessibilityLabel={t("Tags")} value={dialog.tags} testID="template-tags-input" onChangeText={(tags) => setDialog({ ...dialog, tags })} /></FormField>
          </View>
        ) : null}
      </FormDialog>
      <ConfirmDialog open={dialog?.kind === "delete"} title={dialog?.kind === "delete" ? t("Delete {name}?", { name: dialog.entry.manifest.name }) : ""} confirmLabel={t("Delete")} description={t("The template moves to the trash and can be restored from there for 30 days. Projects made from it are not changed.")}
        onClose={() => setDialog(null)} onConfirm={() => { if (dialog?.kind !== "delete" || !storage) return; const { entry } = dialog; setDialog(null); void deleteTemplate(storage, entry).then(() => toast.show({ kind: "info", message: t("Moved {name} to the trash", { name: entry.manifest.name }) })); }} />
      <ConfirmDialog open={dialog?.kind === "export"} title={t("Export package")} confirmLabel={t("Export")}
        description={exporting ? (exporting.media === 0 ? t("The package holds the template and no media file.") : t("The package holds the template and {n} media files ({size}). Fonts are referenced by name and are not included.", { n: exporting.media, size: sizeLabel(exporting.bytes) })) : ""}
        onClose={() => setDialog(null)} onConfirm={() => { if (dialog?.kind === "export") void runExport(dialog.entry); }} />
      <Modal open={dialog?.kind === "conflict"} title={t("This template is already in My templates")} description={dialog?.kind === "conflict" ? dialog.name : ""} width={480} hideClose blocking onClose={() => undefined}
        footer={dialog?.kind === "conflict" ? (
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2] }}>
            {(["skip", "keep-both", "replace"] as const).map((choice) => <Button key={choice} kind={choice === "replace" ? "strong" : "secondary"} testID={`template-conflict-${choice}`} label={t(choice === "skip" ? "Skip" : choice === "keep-both" ? "Keep both" : "Replace")} onPress={() => { const { resolve } = dialog; setDialog(null); resolve(choice); }} />)}
          </View>
        ) : null} />
    </View>
  );
}
