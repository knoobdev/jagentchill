import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { relativeTime } from "@jagentchill/app-core";
import { script as s } from "@jagentchill/editor-core";
import { Badge, Button, DestructiveConfirmDialog, EmptyState, FormDialog, FormField, Icon, Input, NoResultsState, SearchField, Select, LoadingSkeleton, Skeleton, SplitButton, Table, Text, compactScale, space, useTheme, useToast, type Column, type MenuItem, type TableSort } from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { bindDrop, pickFiles } from "../platform/store";
import { Screen } from "../shell/Shell";
import { ImportDialog, IMPORT_ACCEPT } from "./dialogs";
import { setPendingAction, useScriptLibrary, type ScriptSummary } from "./store";
import { formatName, LABELS, messageOf } from "./strings";
import { scriptListLayout } from "./mobileLayout";


const STATUS_TONE = { draft: "neutral", in_review: "attention", changes_requested: "warning", approved: "accent", locked: "purple" } as const;
const STATUS_ICON = { draft: "pencil", in_review: "eye", changes_requested: "warn", approved: "check", locked: "lock" } as const;
/** The status of a script as a chip with an icon and text: never by colour alone. */
export function StatusChip(props: { status: ScriptSummary["status"] }) {
  const t = useT();
  return (
    <View testID="script-status" {...({ dataSet: { status: props.status } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
      <Icon name={STATUS_ICON[props.status]} size={12} color="text/secondary" />
      <Badge label={t(LABELS.status[props.status])} tone={STATUS_TONE[props.status]} />
    </View>
  );
}
/** "0:42", or "0:42 of 0:30 target" in the warning colour when it is outside the tolerance. */
export const durationText = (t: T, target: s.TargetState): string => (target.target_s === null ? s.formatClock(target.estimate_ticks) : t("{estimate} of {target} target", { estimate: s.formatClock(target.estimate_ticks), target: s.formatClock(target.target_s * s.TICKS_PER_SECOND) }));

type Sort = "updated" | "title" | "duration";
export function ScriptsScreen() {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { library, scripts, formats } = useScriptLibrary();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ScriptSummary["status"]>("all");
  const [sort, setSort] = useState<TableSort>({ column: "updated", direction: "descending" });
  const [file, setFile] = useState<File | null>(null);
  const [rename, setRename] = useState<{ script: ScriptSummary; title: string } | null>(null);
  const [trash, setTrash] = useState<ScriptSummary | null>(null);
  const root = useRef<View>(null);
  const language = theme.locale;
  // No wait for the menu's exit: an overlay leaves the stack with the screen that owns it (packages/ui Portal).
  const open = (id: string) => { router.push(`/scripts/${id}` as never); };
  const create = async (format: s.ScriptFormat) => { if (!library) return; try { open(await library.create(format, language)); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } };
  const pick = async () => { const [picked] = await pickFiles(IMPORT_ACCEPT, false); if (picked) setFile(picked); };
  // A script file dropped on the list starts its import preview.
  useEffect(() => bindDrop(root.current, { accept: (types) => types.includes("Files"), onDrop: (data) => { if (data.files[0]) setFile(data.files[0]); } }), []);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (scripts ?? []).filter((script) => (status === "all" || script.status === status) && (!needle || script.search.includes(needle)));
    const by: Record<Sort, (a: ScriptSummary, b: ScriptSummary) => number> = { updated: (a, b) => a.updated_ms - b.updated_ms, title: (a, b) => a.title.localeCompare(b.title, theme.locale), duration: (a, b) => a.estimate_ticks - b.estimate_ticks };
    return rows.sort((a, b) => (by[sort.column as Sort] ?? by.updated)(a, b) * (sort.direction === "ascending" ? 1 : -1));
  }, [scripts, query, status, sort, theme.locale]);
  const menu = (script: ScriptSummary): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "ext", onSelect: () => open(script.id) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => void library?.duplicate(script.id).then(() => toast.show({ kind: "success", message: t("Script duplicated") })) },
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => setRename({ script, title: script.title }) },
    { id: "timeline", label: t("Create timeline"), icon: "film", onSelect: () => { setPendingAction(script.id, "timeline"); open(script.id); } },
    { id: "export", label: t("Export"), icon: "export", onSelect: () => { setPendingAction(script.id, "export"); open(script.id); } },
    { type: "separator" },
    { id: "trash", label: t("Move to trash"), icon: "trash", danger: true, onSelect: () => setTrash(script) },
  ];
  const columns: Column<ScriptSummary>[] = [
    { id: "title", title: t("Title"), flex: 2, sortable: true, text: (row) => row.title, render: (row) => <Text variant="body-medium" numberOfLines={1} testID={`script-row-${row.title}`}>{row.title}</Text> },
    { id: "status", title: t("Status"), width: 170, text: (row) => t(LABELS.status[row.status]), render: (row) => <StatusChip status={row.status} /> },
    { id: "language", title: t("Language"), width: 90, text: (row) => row.language },
    { id: "scenes", title: t("Scenes"), width: 80, numeric: true, text: (row) => String(row.scenes) },
    { id: "shots", title: t("Shots"), width: 80, numeric: true, text: (row) => String(row.shots) },
    { id: "duration", title: t("Duration"), width: 170, sortable: true, text: (row) => durationText(t, row.target), render: (row) => <Text tabular color={row.target.onTarget ? "text/primary" : "warning/text"}>{durationText(t, row.target)}</Text> },
    { id: "linked", title: t("Linked project"), width: 130, text: (row) => (row.projectIds.length === 0 ? "—" : row.projectIds.length === 1 ? t("1 project") : t("{n} projects", { n: row.projectIds.length })) },
    { id: "updated", title: t("Updated"), width: 130, sortable: true, text: (row) => relativeTime(row.updated_ms, Date.now(), theme.locale) },
  ];
  const newItems: MenuItem[] = [
    ...[...s.SCRIPT_FORMATS, ...formats].map((format): MenuItem => ({ id: `format-${format.id}`, label: formatName(t, format), description: format.personal ? t("Your format") : t((LABELS.formatNote as Record<string, string>)[format.id] ?? ""), icon: "doc", onSelect: () => void create(format) })),
    { type: "separator" }, { id: "import", label: t("Import"), icon: "download", onSelect: () => void pick() },
  ];
  const empty = scripts !== null && scripts.length === 0;
  const compactLayout = scriptListLayout(theme.compact);
  return (
    <Screen title={t("Scripts")}>
      <View ref={root} style={{ flex: 1, minHeight: 0 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: compactLayout.padding, gap: theme.compact ? compactScale.space.gapMedium : space[3] }}>
          <View style={{ flexDirection: compactLayout.direction, alignItems: compactLayout.align, gap: compactLayout.gap, flexWrap: "wrap" }}>
            {theme.compact ? null : <View style={{ flex: 1, minWidth: 160 }}><Text variant="h1" level={1}>{t("Scripts")}</Text></View>}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: compactScale.space.gapSmall }}>
              <Button kind="ghost" icon="trash" label={t("Trash")} testID="scripts-trash" onPress={() => router.push("/projects/trash" as never)} />
              <SplitButton kind="strong" icon="plus" label={t("New script")} menuLabel={t("New script from a format")} onPress={() => void create(s.SCRIPT_FORMATS[0])} items={newItems} testID="scripts-new" />
            </View>
          </View>
          {empty ? null : (
            <View testID="scripts-list-controls" style={{ flexDirection: compactLayout.direction, alignItems: compactLayout.align, gap: compactLayout.gap, flexWrap: "wrap" }}>
              <SearchField label={t("Search scripts")} placeholder={t("Search scripts")} value={query} onChangeText={setQuery} style={compactLayout.fullWidth ? { width: "100%" } : { flex: 1, minWidth: 200, maxWidth: 360 }} />
              <Select label={t("Status")} size="sm" width={theme.compact ? undefined : 190} value={status} onChange={(value) => setStatus(value as typeof status)} options={[{ value: "all", label: t("All statuses") }, ...(Object.keys(LABELS.status) as ScriptSummary["status"][]).map((value) => ({ value, label: t(LABELS.status[value]) }))]} />
              <Select label={t("Sort")} size="sm" width={theme.compact ? undefined : 170} value={`${sort.column}:${sort.direction}`} onChange={(value) => { const [column, direction] = value.split(":"); setSort({ column, direction: direction as TableSort["direction"] }); }}
                options={[{ value: "updated:descending", label: t("Recently updated") }, { value: "title:ascending", label: t("Title") }, { value: "duration:descending", label: t("Duration") }]} />
            </View>
          )}
          {scripts === null ? <LoadingSkeleton style={{ gap: space[1] }}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={40} />)}</LoadingSkeleton>
            : empty ? <EmptyState icon="doc" title={t("No scripts yet")} description={t("Write a script here, or import one.")} actions={[{ label: t("New script"), kind: "strong", onPress: () => void create(s.SCRIPT_FORMATS[0]) }, { label: t("Import"), onPress: () => void pick() }]} />
            : shown.length === 0 ? <NoResultsState title={t("No scripts match")} query={query} onClear={() => { setQuery(""); setStatus("all"); }} />
            : <Table label={t("Scripts")} columns={columns} rows={shown} rowKey={(row) => row.id} sort={sort} onSort={setSort} rowMenu={menu} onRowPress={(row) => open(row.id)} />}
        </ScrollView>
      </View>
      <ImportDialog file={file} language={language} onClose={() => setFile(null)} onConfirm={async (content, fileName) => { if (!library) return; const id = await library.createFromContent(content, fileName, language); setFile(null); open(id); }} />
      <FormDialog open={!!rename} title={t("Rename script")} submitLabel={t("Rename")} dirty={!!rename && rename.title !== rename.script.title} canSubmit={!!rename && rename.title.trim().length > 0} onClose={() => setRename(null)}
        onSubmit={() => { if (!rename) return; void library?.rename(rename.script.id, rename.title).catch((error) => toast.show({ kind: "error", message: messageOf(t, error) })); setRename(null); }}>
        <FormField label={t("Title")}>{() => <Input value={rename?.title ?? ""} maxLength={120} autoFocus onChangeText={(title) => rename && setRename({ ...rename, title })} />}</FormField>
      </FormDialog>
      <DestructiveConfirmDialog open={!!trash} title={t("Move to trash?")} description={trash ? t("{name} stays in the trash for 30 days.", { name: trash.title }) : undefined} confirmLabel={t("Move to trash")} onClose={() => setTrash(null)}
        onConfirm={() => { const script = trash; setTrash(null); if (script) void library?.trash(script.id).then(() => toast.show({ kind: "success", message: t("Moved to trash") })); }} />
    </Screen>
  );
}
