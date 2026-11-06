import { usePathname, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { preference } from "@jagentchill/app-core";
import { promptVideo as pv, script as s } from "@jagentchill/editor-core";
import type { ScriptLineKind } from "@jagentchill/protocol";
import { Banner, BottomSheet, Button, Chip, ConfirmDialog, DestructiveConfirmDialog, EdgePanel, EmptyState, FormDialog, FormField, Icon, IconButton, Input, Menu, Segmented, LoadingSkeleton, Skeleton, Tap, Text, control, radius, space, useInsets, useTheme, useToast, type IconName, type MenuItem, inlineIcon } from "@jagentchill/ui";
import { AgentPanel, AgentPanelSlot, AgentPanelToggle, agentPanelLayout, useAgentPanel } from "../editor/AgentPanel";
import { useHost } from "../host";
import { useT } from "../locale";
import { bindSplitter, onWindowKey, pickFiles } from "../platform/store";
import { handToSetup } from "../prompt-video/handoff";
import { Screen } from "../shell/Shell";
import { screenScaffoldMetrics } from "../shell/safeArea.ts";
import { usePref } from "../state";
import { ComparePane } from "./Compare";
import { ScriptEditorProvider, type FocusTarget, type InspectorTab, type ScriptEditorState, type Selection } from "./context";
import { ExportDialog, IMPORT_ACCEPT, ImportDialog, parseImport, TimelineDialog } from "./dialogs";
import { FindBar } from "./FindBar";
import { Inspector } from "./Inspector";
import { Navigator } from "./Navigator";
import { StructuredPane, TextPane } from "./ScriptPane";
import { durationText, StatusChip } from "./ScriptsScreen";
import { ShotListPane } from "./ShotList";
import { StoryboardPane } from "./Storyboard";
import { ids, takePendingAction, useScriptLibrary, useScriptSession, useSessionTick, type ScriptSession } from "./store";
import { LABELS, messageOf } from "./strings";

/** The widths of the two side panes, in px, and what this device remembers of them. The inspector opens wide enough to show its six tabs. */
export const SCRIPT_PANES = { navigator: { min: 200, max: 400, width: 260 }, inspector: { min: 280, max: 480, width: 416 }, columnFloor: 420 } as const;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const within = (range: { min: number; max: number }) => (value: unknown): value is number => typeof value === "number" && value >= range.min && value <= range.max;
const NAVIGATOR_OPEN = preference<boolean>("script.navigator.open", true, isBoolean);
const NAVIGATOR_WIDTH = preference<number>("script.navigator.width", SCRIPT_PANES.navigator.width, within(SCRIPT_PANES.navigator));
const INSPECTOR_OPEN = preference<boolean>("script.inspector.open", true, isBoolean);
const INSPECTOR_WIDTH = preference<number>("script.inspector.width", SCRIPT_PANES.inspector.width, within(SCRIPT_PANES.inspector));
/** Widths of the editor, in px: from `full` the bar shows everything; under `wrap` it takes a second row. */
const BAR = { full: 1400, wrap: 1120 } as const;
type Mode = "structured" | "text";
type ViewId = "script" | "shots" | "storyboard";
/** The mode of each script, remembered per script on this device. */
const MODES = preference<Record<string, Mode>>("script.modes", {}, (value): value is Record<string, Mode> => !!value && typeof value === "object" && !Array.isArray(value));

export function ScriptEditorScreen(props: { scriptId: string; /** The route `/scripts/<id>/review`: the editor opens on its Review tab. */ review?: boolean }) {
  const t = useT(), router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const state = useScriptSession(props.scriptId, attempt);
  if (state.state === "ready") return <Editor session={state.session} review={props.review} />;
  if (state.state === "loading") return <Screen title={t("Loading script…")}><LoadingSkeleton testID="script-loading" style={{ padding: space[5], gap: space[3], alignItems: "center" }}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} width={720} height={140} />)}</LoadingSkeleton></Screen>;
  return (
    <Screen title={state.state === "missing" ? t("Script not found") : t("Unable to open this script")}>
      <View testID={`script-${state.state}`} style={{ flex: 1 }}>
        <EmptyState icon={state.state === "missing" ? "doc" : "warn"} title={state.state === "missing" ? t("Script not found") : t("Unable to open this script")} description={state.state === "missing" ? t("It may have been moved to the trash on this device.") : undefined}
          actions={[...(state.state === "error" ? [{ label: t("Retry"), kind: "strong" as const, onPress: () => setAttempt(attempt + 1) }] : []), { label: t("All scripts"), onPress: () => router.push("/scripts" as never) }]} />
      </View>
    </Screen>
  );
}

const KIND_ORDER = Object.keys(LABELS.kind) as ScriptLineKind[];
function Editor(props: { session: ScriptSession; review?: boolean }) {
  const { session } = props;
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast(), pathname = usePathname();
  const insets = useInsets();
  const safe = screenScaffoldMetrics(insets, theme.compact, 0);
  const tick = useSessionTick(session);
  const { library } = useScriptLibrary();
  const { host } = useHost();
  const agentPanel = useAgentPanel();
  const [selection, setSelection] = useState<Selection>({ sceneId: null, lineIds: [], shotIds: [] });
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [reviewerEdit, setReviewerEdit] = useState(false);
  const [pending, setPending] = useState<s.ScriptCommand<unknown> | null>(null);
  const [view, setView] = useState<ViewId>("script");
  const [modes, setModes] = usePref(MODES);
  const [tab, setTab] = useState<InspectorTab>(props.review ? "review" : "details");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());
  const [navigatorOpen, setNavigatorOpen] = usePref(NAVIGATOR_OPEN);
  const [navigatorWidth, setNavigatorWidth] = usePref(NAVIGATOR_WIDTH);
  const [inspectorOpen, setInspectorOpen] = usePref(INSPECTOR_OPEN);
  const [inspectorWidth, setInspectorWidth] = usePref(INSPECTOR_WIDTH);
  const [drag, setDragState] = useState<{ pane: "navigator" | "inspector"; width: number } | null>(null);
  const dragging = useRef<{ pane: "navigator" | "inspector"; width: number } | null>(null);
  const setDrag = (value: { pane: "navigator" | "inspector"; width: number } | null) => { dragging.current = value; setDragState(value); };
  const [width, setWidth] = useState(0);
  const [dialog, setDialog] = useState<"export" | "timeline" | "trash" | "format" | null>(null);
  const [importing, setImporting] = useState<File | null>(null);
  const [formatName, setFormatName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [kindMenu, setKindMenu] = useState(false);
  const [sheet, setSheet] = useState<"navigator" | "review" | "more" | "agent" | null>(null);
  const scroll = useRef<ScrollView>(null), offsets = useRef(new Map<string, number>());
  const menuRef = useRef<View>(null), kindRef = useRef<View>(null), navigatorSplitter = useRef<View>(null), inspectorSplitter = useRef<View>(null);
  const mode: Mode = modes[session.id] ?? "structured";
  const head = session.document, status = head.status;
  const document = useMemo(() => { if (!viewing) return head; try { return s.documentAt(head, session.history, viewing); } catch { return head; } }, [viewing, head, session.history]);
  const readOnly = !!viewing || status === "locked" || (status === "in_review" && !reviewerEdit);
  const live = useRef({ viewing, reviewerEdit, navigatorWidth, inspectorWidth, here: false, blocked: false });
  live.current = { viewing, reviewerEdit, navigatorWidth, inspectorWidth, here: pathname === `/scripts/${session.id}` || pathname === `/scripts/${session.id}/review`, blocked: dialog !== null || importing !== null || pending !== null };
  useEffect(() => { if (status !== "in_review") setReviewerEdit(false); }, [status]);
  // The lists of scripts (the screen and the one under the navigation) show the title and status once they are saved.
  useEffect(() => { void session.flush().then(() => library?.refresh()); }, [head.title, status, session, library]);
  // The list asked for an export or a timeline of this script.
  useEffect(() => { const action = takePendingAction(session.id); if (action) setDialog(action); }, [session.id]);

  const refuse = (error: unknown) => toast.show({ kind: "error", message: messageOf(t, error) });
  // What to report once an approved script's edit was confirmed (the command's own result is not returned through the dialog).
  const afterConfirm = useRef<((result: unknown) => void) | null>(null);
  function run<I>(command: s.ScriptCommand<I>, done?: (result: I) => void): I | undefined {
    if (live.current.viewing) return undefined;
    try { return session.execute(command, { reviewerEdit: live.current.reviewerEdit }); } catch (error) {
      // An approved script is edited only after the user confirmed that a new draft starts.
      if (error instanceof s.ScriptError && error.details.needsConfirmation) { afterConfirm.current = done as ((result: unknown) => void) | undefined ?? null; setPending(command as s.ScriptCommand<unknown>); } else refuse(error);
      return undefined;
    }
  }
  const select = (next: Partial<Selection>) => setSelection((current) => ({ ...current, ...next, fromCaret: next.lineIds ? next.fromCaret === true : current.fromCaret }));
  const scrollToScene = (sceneId: string) => { setComparing(null); setView("script"); select({ sceneId }); setTimeout(() => scroll.current?.scrollTo({ y: offsets.current.get(sceneId) ?? 0, animated: false }), 90); };
  const goToScene = (sceneId: string) => {
    const scene = s.findScene(document, sceneId), first = scene ? s.sceneLines(scene)[0] : undefined;
    if (first) setFocus({ lineId: first.id, field: "text", caret: 0 });
    scrollToScene(sceneId);
    setSheet(null);
  };
  const goToLine = (lineId: string) => { const ref = s.findLine(document, lineId); if (!ref) return; scrollToScene(ref.scene.id); setFocus({ lineId, field: "text" }); setSheet(null); };
  const openInspector = (next: InspectorTab) => { setTab(next); if (theme.compact) setSheet("more"); else setInspectorOpen(true); };
  const editor: ScriptEditorState = { session, document, readOnly, run, selection, select, goToScene, goToLine, scrollToScene, focus, setFocus, found, openInspector };

  const undo = () => { if (!readOnly) session.undo(); }, redo = () => { if (!readOnly) session.redo(); };
  useEffect(() => onWindowKey((event) => {
    // A script editor kept in the navigation history listens too: only the one on screen answers.
    if (!live.current.here || live.current.blocked || !(event.meta || event.ctrl)) return;
    const key = event.key.toLowerCase();
    if (key === "z") { event.preventDefault(); if (event.shift) redo(); else undo(); }
    else if (key === "y") { event.preventDefault(); redo(); }
    else if (key === "f" && !event.shift) { event.preventDefault(); setFinding(true); }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => bindSplitter(navigatorSplitter.current, {
    onStart: () => setDrag({ pane: "navigator", width: live.current.navigatorWidth }), onDrag: (dx) => setDrag({ pane: "navigator", width: Math.min(SCRIPT_PANES.navigator.max, Math.max(SCRIPT_PANES.navigator.min, live.current.navigatorWidth + dx)) }),
    onEnd: () => { const value = dragging.current; setDrag(null); if (value) setNavigatorWidth(value.width); }, onReset: () => setNavigatorWidth(SCRIPT_PANES.navigator.width),
  }), [navigatorOpen, theme.compact, setNavigatorWidth]);
  useEffect(() => bindSplitter(inspectorSplitter.current, {
    onStart: () => setDrag({ pane: "inspector", width: live.current.inspectorWidth }), onDrag: (dx) => setDrag({ pane: "inspector", width: Math.min(SCRIPT_PANES.inspector.max, Math.max(SCRIPT_PANES.inspector.min, live.current.inspectorWidth - dx)) }),
    onEnd: () => { const value = dragging.current; setDrag(null); if (value) setInspectorWidth(value.width); }, onReset: () => setInspectorWidth(SCRIPT_PANES.inspector.width),
  }), [inspectorOpen, theme.compact, theme.formFactor, agentPanel.open, width, setInspectorWidth]);

  const review = (action: s.ReviewAction, done?: string) => { try { session.review(action); if (done) toast.show({ kind: "success", message: done }); } catch (error) { refuse(error); } };
  const policy = s.effectivePolicy(head), target = s.targetState(document);
  const versionNumber = (versionId: string | undefined) => session.history.versions.find((entry) => entry.versionId === versionId)?.number;
  const saveState = session.saveStatus?.state ?? "saved";
  const indicator = saveState === "saved" ? t("Saved") : saveState === "storage-full" ? t("Storage full — not saved") : saveState === "failed" ? t("Save failed — Retry") : t("Saving…");
  const commitTitle = () => { const title = (renaming ?? "").trim(); setRenaming(null); if (title && title !== head.title) run(s.setTitle(title.slice(0, 120))); };
  const importFile = async () => {
    const [file] = await pickFiles(`${IMPORT_ACCEPT},.csv`, false);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setImporting(file); return; }
    // A CSV file is a shot list: it goes into this script, matched by shot id.
    try {
      const parsed = await parseImport(file, head.meta.language);
      const reported = (report: { updated: number; added: number }) => toast.show({ kind: "success", message: t("Shot list imported: {updated} updated, {added} added", { updated: report.updated, added: report.added }) });
      const report = "csv" in parsed ? run(s.importShotCsv(parsed.csv), reported) : undefined;
      if (report) reported(report);
    } catch (error) { refuse(error); }
  };
  const duplicateVersion = (versionId: string) => {
    try { void library?.duplicate(session.id, s.versionContent(session.history, versionId)).then(() => toast.show({ kind: "success", message: t("Script duplicated") })); } catch (error) { refuse(error); }
  };
  const setMode = (next: Mode) => { session.seal(); setModes({ ...Object.fromEntries(Object.entries(modes).slice(-199)), [session.id]: next }); };
  const nextKind = () => { const lineId = selection.lineIds[0]; if (!lineId) return; const outcome = s.typingRule(document, { key: "Tab", lineId, field: "text", caret: 0 }); if (outcome) for (const command of outcome.commands) run(command); };
  const items: MenuItem[] = [
    ...(theme.compact ? [
      { id: "mode", label: mode === "structured" ? t("Text mode") : t("Structured mode"), icon: "type" as const, onSelect: () => { setView("script"); setMode(mode === "structured" ? "text" : "structured"); } },
      { id: "find", label: t("Find and replace"), icon: "search" as const, onSelect: () => { setView("script"); setFinding(true); } },
      { id: "undo", label: t("Undo"), icon: "undo" as const, disabled: readOnly || !session.canUndo, onSelect: undo }, { id: "redo", label: t("Redo"), icon: "redo" as const, disabled: readOnly || !session.canRedo, onSelect: redo },
      { id: "agent", label: t("Agent"), icon: "bot" as const, onSelect: () => setSheet("agent") },
      { id: "timeline", label: t("Create timeline"), icon: "film" as const, onSelect: () => setDialog("timeline") },
      ...(status === "draft" ? [{ id: "submit", label: policy.mode === "auto" ? t("Submit") : t("Submit for review"), icon: "check-c" as const, onSelect: () => review({ type: "submit" }, policy.mode === "auto" ? t("Approved automatically — not reviewed") : t("Submitted for review")) }] : []),
      { type: "separator" as const },
    ] : []),
    // An approved script goes to "One prompt → video" as its own script: its narration and dialogue are spoken as written.
    ...(host && (status === "approved" || status === "locked") ? [{ id: "workflow", label: t("Send to workflow…"), icon: "flow" as const, onSelect: () => {
      const spoken = pv.spokenTextOfScript(head);
      if (!spoken.trim()) { toast.show({ kind: "error", message: t("This script has no narration or dialogue to speak") }); return; }
      handToSetup({ script: spoken.slice(0, pv.SCRIPT_MAX), title: head.title, language: head.meta.language.toLowerCase().split(/[-_]/)[0] });
      router.push(`/h/${host.gatewayId}/workflows/video` as never);
    } }] : []),
    { id: "export", label: t("Export"), icon: "export", onSelect: () => setDialog("export") },
    { id: "import", label: t("Import"), icon: "download", disabled: readOnly && status !== "approved", onSelect: () => void importFile() },
    { id: "version", label: t("Save version"), icon: "pin", onSelect: () => { try { const saved = session.saveVersion(); toast.show({ kind: "success", message: t("Version {n} saved", { n: saved.version.number }) }); } catch (error) { refuse(error); } } },
    { id: "versions", label: t("Versions"), icon: "clock", onSelect: () => openInspector("versions") },
    { id: "format", label: t("Save as format"), icon: "template", onSelect: () => { setFormatName(head.title); setDialog("format"); } },
    ...(status === "approved" ? [{ id: "lock", label: t("Lock"), icon: "lock" as const, onSelect: () => review({ type: "lock" }, t("Locked")) }] : []),
    ...(status === "locked" ? [{ id: "unlock", label: t("Unlock"), icon: "lock" as const, onSelect: () => review({ type: "unlock" }, t("Unlocked")) }] : []),
    { type: "separator" }, { id: "trash", label: t("Move to trash"), icon: "trash", danger: true, onSelect: () => setDialog("trash") },
  ];

  // — The centre: what is being looked at.
  const many = selection.lineIds.length > 1 && !readOnly && view === "script" && mode === "structured" && !comparing;
  const kindItems: MenuItem[] = KIND_ORDER.map((kind) => ({ id: `bulk-${kind}`, label: t(LABELS.kind[kind]), onSelect: () => run(s.setLineKind(selection.lineIds, kind)) }));
  const centre: ReactNode = comparing ? <ComparePane versionId={comparing} onClose={() => setComparing(null)} /> : view === "shots" ? <ShotListPane /> : view === "storyboard" ? <StoryboardPane /> : (
    <View style={{ flex: 1, minHeight: 0 }}>
      {finding ? <FindBar onFound={setFound} onClose={() => setFinding(false)} /> : null}
      {many ? (
        <View testID="selection-toolbar" style={{ flexDirection: "row", alignItems: "center", gap: space[1], padding: space[2], flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
          <Text variant="meta" color="text/secondary" testID="selection-count">{t("{n} selected", { n: selection.lineIds.length })}</Text>
          <Button ref={kindRef} kind="outline" size="sm" icon="type" trailingIcon="chev-d" label={t("Change kind")} testID="selection-kind" expanded={kindMenu} onPress={() => setKindMenu(true)} />
          <Menu open={kindMenu} anchor={kindRef} items={kindItems} label={t("Change kind")} onClose={() => setKindMenu(false)} />
          <Button kind="outline" size="sm" icon="camera" label={t("Create shot")} testID="selection-shot" onPress={() => { const made = run(s.shotFromSelection(selection.lineIds)); if (made) { select({ shotIds: [made.shotId] }); toast.show({ kind: "success", message: t("Shot {n} created", { n: s.shotNumber(session.document, made.shotId) }) }); } }} />
          <Button kind="outline" size="sm" icon="chat" label={t("Comment")} testID="selection-comment" onPress={() => { select({ lineIds: [selection.lineIds[0]] }); openInspector("comments"); }} />
          <Button kind="outline" size="sm" icon="bot" label={t("Ask the agent")} testID="selection-agent" onPress={() => (theme.compact ? setSheet("agent") : agentPanel.open ? undefined : agentPanel.toggle())} />
          <Button kind="ghost" size="sm" tone="danger" icon="trash" label={t("Delete")} testID="selection-delete" onPress={() => { run(s.deleteLines(selection.lineIds)); select({ lineIds: [] }); }} />
          <View style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" label={t("Clear selection")} testID="selection-clear" onPress={() => select({ lineIds: [] })} />
        </View>
      ) : null}
      {mode === "text" ? <TextPane /> : <StructuredPane scroll={scroll} offsets={offsets} onImport={() => void importFile()} />}
    </View>
  );
  const inspector = (paneWidth: number | "100%") => <Inspector width={paneWidth} tab={tab} onTab={setTab} onView={(versionId) => { setComparing(null); setView("script"); setViewing(versionId); setSheet(null); }} onCompare={(versionId) => { setViewing(null); setComparing(versionId); setSheet(null); }} onDuplicate={duplicateVersion} />;
  const viewed = versionNumber(viewing ?? undefined);
  const banners = (
    <>
      {viewing ? <View testID="version-banner"><Banner id="script-version" tone="info" actions={[{ label: t("Restore"), onPress: () => { try { session.restore(viewing); setViewing(null); toast.show({ kind: "success", message: t("Version {n} restored", { n: viewed ?? "" }) }); } catch (error) { refuse(error); } } }, { label: t("Close"), onPress: () => setViewing(null) }]}>{t("Viewing version {n}", { n: viewed ?? "" })}</Banner></View> : null}
      {!viewing && status === "locked" ? <View testID="locked-banner"><Banner id="script-locked" tone="warning" actions={[{ label: t("Unlock"), onPress: () => review({ type: "unlock" }, t("Unlocked")) }]}>{t("Locked — unlock to edit")}</Banner></View> : null}
      {!viewing && status === "in_review" ? <View testID="review-banner"><Banner id="script-review" tone="info" actions={[{ label: reviewerEdit ? t("Stop editing") : t("Edit and approve"), onPress: () => setReviewerEdit(!reviewerEdit) }, { label: t("Review"), onPress: () => (theme.compact ? setSheet("review") : openInspector("review")) }]}>{reviewerEdit ? t("Your edits become the approved version") : t("In review — read-only")}</Banner></View> : null}
      {saveState === "failed" || saveState === "storage-full" ? <View testID="save-banner"><Banner id="script-save" tone="danger" actions={[{ label: t("Retry"), onPress: () => session.retry() }]}>{saveState === "storage-full" ? t("Storage is full — your recent changes are not saved") : t("Your changes could not be saved")}</Banner></View> : null}
    </>
  );
  const dialogs = (
    <>
      <ConfirmDialog open={!!pending} title={t("Edit the approved script?")} description={t("Editing creates a new draft; version {n} stays approved", { n: versionNumber(head.approvedVersionId) ?? "" })} confirmLabel={t("Edit")} onClose={() => setPending(null)}
        onConfirm={() => { const command = pending, done = afterConfirm.current; setPending(null); afterConfirm.current = null; if (command) try { const result = session.execute(command, { confirmApprovedEdit: true }); done?.(result); } catch (error) { refuse(error); } }} />
      <ExportDialog open={dialog === "export"} session={session} onClose={() => setDialog(null)} />
      <TimelineDialog open={dialog === "timeline"} session={session} onClose={() => setDialog(null)} />
      <ImportDialog file={importing} intoOpen language={head.meta.language} onClose={() => setImporting(null)} onConfirm={(content, fileName) => { session.replaceWithImport(content, fileName); setImporting(null); toast.show({ kind: "success", message: t("Imported as a new version") }); }} />
      <FormDialog open={dialog === "format"} title={t("Save as format")} description={t("Keeps the scenes, beat labels and guidance, the details and constraints. Lines and shots are left out.")} submitLabel={t("Save")} dirty={formatName !== head.title} canSubmit={!!formatName.trim()} onClose={() => setDialog(null)}
        onSubmit={() => { void library?.saveFormat(s.formatFromScript(head, ids, formatName)).then(() => toast.show({ kind: "success", message: t("Format saved") })); setDialog(null); }}>
        <FormField label={t("Name")}>{() => <Input value={formatName} maxLength={80} autoFocus testID="format-name" onChangeText={setFormatName} />}</FormField>
      </FormDialog>
      <DestructiveConfirmDialog open={dialog === "trash"} title={t("Move to trash?")} description={t("{name} stays in the trash for 30 days.", { name: head.title })} confirmLabel={t("Move to trash")} onClose={() => setDialog(null)}
        onConfirm={() => { setDialog(null); void session.flush().then(() => library?.trash(session.id)).then(() => { toast.show({ kind: "success", message: t("Moved to trash") }); router.replace("/scripts" as never); }); }} />
    </>
  );
  const title = renaming !== null ? (
    <TextInput autoFocus selectTextOnFocus aria-label={t("Script title")} value={renaming} maxLength={120} testID="script-title-input" onChangeText={setRenaming} onBlur={commitTitle} onSubmitEditing={commitTitle}
      {...({ onKeyPress: (event: { nativeEvent: { key: string }; preventDefault(): void }) => { if (event.nativeEvent.key === "Escape") { event.preventDefault(); setRenaming(null); } } } as object)}
      style={[theme.type("body-medium"), { height: control.sm, minWidth: 140, maxWidth: 320, paddingHorizontal: space[1.5], borderRadius: radius.sm, borderWidth: 2, borderColor: theme.color("accent"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app"), outlineWidth: 0 }]} />
  ) : (
    <Tap role="button" label={t("Rename: {name}", { name: head.title })} tooltip={{ label: t("Rename") }} disabled={readOnly && status !== "approved"} onPress={() => setRenaming(head.title)}
      style={(state) => ({ height: control.sm, justifyContent: "center", paddingHorizontal: space[1.5], borderRadius: radius.sm, flexShrink: 1, minWidth: 0, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
      <Text variant="body-medium" numberOfLines={1} testID="script-title">{head.title}</Text>
    </Tap>
  );
  const divider = <View style={{ width: 1, alignSelf: "stretch", marginVertical: 14, marginHorizontal: space[1], backgroundColor: theme.color("border/hairline") }} />;
  const provider = (children: ReactNode) => <Screen title={head.title} bare documentTitle={head.title}><ScriptEditorProvider value={editor}><View testID="script-editor" {...({ dataSet: { status, revision: String(head.revision), tick: String(tick), mode, view: comparing ? "compare" : view, readonly: readOnly ? "true" : "false" } } as object)} style={{ flex: 1, minHeight: 0, paddingTop: safe.headerPaddingTop }}>{children}</View></ScriptEditorProvider></Screen>;

  if (theme.compact) {
    const line = selection.lineIds.length === 1 && !readOnly && view === "script" && mode === "structured" && !comparing ? s.findLine(document, selection.lineIds[0]) : undefined;
    const bottom = (id: string, icon: IconName, label: string, on: boolean, onPress: () => void, badge = 0) => (
      <Tap key={id} role="button" label={badge ? `${label} (${badge})` : label} testID={`script-bottom-${id}`} onPress={onPress} style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 2 }}>
        <Icon name={icon} size={20} color={on ? "text/primary" : "text/secondary"} />
        <Text variant="caption" color={on ? "text/primary" : "text/secondary"} numberOfLines={1}>{badge ? `${label} · ${badge}` : label}</Text>
      </Tap>
    );
    return provider(
      <>
        <View testID="script-bar" style={{ height: control["editor-bar-compact"], flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
          <IconButton icon={inlineIcon(theme.rtl, "chev-l")} label={t("All scripts")} testID="script-back" onPress={() => router.push("/scripts" as never)} />
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[1] }}>{title}</View>
          <StatusChip status={status} />
          <IconButton ref={menuRef} icon="more" label={t("Script actions")} testID="script-menu" expanded={menu} onPress={() => setMenu(true)} />
          <Menu open={menu} anchor={menuRef} items={items} label={t("Script actions")} align="end" onClose={() => setMenu(false)} />
        </View>
        {banners}
        <View style={{ flex: 1, minHeight: 0 }}>{centre}</View>
        {line ? (
          <ScrollView horizontal testID="script-accessory" keyboardShouldPersistTaps="always" style={{ flexGrow: 0, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }} contentContainerStyle={{ gap: space[1], padding: space[1], alignItems: "center" }}>
            <Chip size="sm" label={t("Next kind")} onPress={nextKind} />
            {KIND_ORDER.map((kind) => <Chip key={kind} size="sm" label={t(LABELS.kind[kind])} selected={line.line.kind === kind} onPress={() => run(s.setLineKind([line.line.id], kind))} />)}
            <Chip size="sm" label={t("New scene")} onPress={() => { const made = run(s.addScene({ afterSceneId: line.scene.id })); if (made) setFocus({ lineId: made.lineId, field: "text" }); }} />
            <Chip size="sm" label={t("New shot")} onPress={() => run(s.addShot(line.scene.id, { fields: { lineIds: [line.line.id], beatId: line.beat.id } }))} />
            <IconButton icon="undo" size="sm" label={t("Undo")} disabled={!session.canUndo} onPress={undo} />
            <IconButton icon="redo" size="sm" label={t("Redo")} disabled={!session.canRedo} onPress={redo} />
            <Chip size="sm" label={t("Ask the agent")} onPress={() => setSheet("agent")} />
          </ScrollView>
        ) : null}
        <View testID="script-bottom-bar" style={{ flexDirection: "row", paddingBottom: safe.contentPaddingBottom, borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
          {bottom("navigator", "list", t("Navigator"), false, () => setSheet("navigator"))}
          {bottom("shots", "camera", t("Shots"), view === "shots" && !comparing, () => { setComparing(null); setView(view === "shots" ? "script" : "shots"); })}
          {bottom("storyboard", "grid", t("Storyboard"), view === "storyboard" && !comparing, () => { setComparing(null); setView(view === "storyboard" ? "script" : "storyboard"); })}
          {bottom("review", "check-c", t("Review"), false, () => { setTab("review"); setSheet("review"); }, session.history.openReview ? 1 : 0)}
          {bottom("more", "more", t("More"), false, () => { if (tab === "review") setTab("details"); setSheet("more"); })}
        </View>
        <BottomSheet open={sheet === "navigator"} onClose={() => setSheet(null)} title={t("Scenes")} snap={0.9}><Navigator width={theme.width} /></BottomSheet>
        <BottomSheet open={sheet === "review" || sheet === "more"} onClose={() => setSheet(null)} title={sheet === "review" ? t("Review") : t("Details")} snap={0.9}>{inspector("100%")}</BottomSheet>
        <BottomSheet open={sheet === "agent"} onClose={() => setSheet(null)} title={t("Agent")} fullHeight><AgentPanel sheet projectId="" scriptId={session.id} projectName={head.title} editorWidth={theme.width} onClose={() => setSheet(null)} /></BottomSheet>
        {dialogs}
      </>,
    );
  }

  // Wide and medium: three panes. The inspector is an overlay sheet at the medium form factor, and steps aside while a
  // docked agent panel would leave the script column too narrow.
  const agent = agentPanel.open ? agentPanelLayout(width, 360) : null;
  const navigatorShown = navigatorOpen, navWidth = drag?.pane === "navigator" ? drag.width : navigatorWidth, inspWidth = drag?.pane === "inspector" ? drag.width : inspectorWidth;
  const overlay = theme.formFactor === "medium";
  const room = width - (navigatorShown ? navWidth : 0) - (agent?.mode === "docked" ? agent.width : 0);
  const inspectorShown = inspectorOpen && (overlay || width === 0 || room - inspWidth >= SCRIPT_PANES.columnFloor || !agent);
  // The bar is one row: below `BAR.full` the policy chip goes (it is in the Review tab) and the submit label shortens; only a narrow window wraps.
  const roomy = width === 0 || width >= BAR.full, wraps = width > 0 && width < BAR.wrap;
  return provider(
    <>
      <View testID="script-bar" style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[2], paddingEnd: space[3], paddingVertical: space[1], flexWrap: wraps ? "wrap" : "nowrap", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
        <IconButton icon={inlineIcon(theme.rtl, "chev-l")} size="sm" label={t("All scripts")} testID="script-back" onPress={() => router.push("/scripts" as never)} />
        {title}
        <StatusChip status={status} />
        {roomy ? <View testID="script-policy"><Chip size="sm" icon={policy.mode === "auto" ? "zap" : "user"} label={t(LABELS.policy[policy.mode])} onPress={() => openInspector("review")} /></View> : null}
        {saveState === "failed" || saveState === "storage-full" ? <Button kind="ghost" size="xs" tone="danger" icon="warn" label={indicator} testID="script-save-state" onPress={() => session.retry()} /> : <Text variant="meta" color="text/secondary" live="polite" testID="script-save-state">{indicator}</Text>}
        {divider}
        <IconButton icon="undo" size="sm" label={t("Undo")} keys={["Mod", "Z"]} testID="script-undo" disabled={readOnly || !session.canUndo} onPress={undo} />
        <IconButton icon="redo" size="sm" label={t("Redo")} keys={["Mod", "Shift", "Z"]} testID="script-redo" disabled={readOnly || !session.canRedo} onPress={redo} />
        <View style={{ flex: 1 }} />
        <View testID="script-mode"><Segmented size="sm" label={t("Mode")} value={mode} disabled={view !== "script" || !!comparing} onChange={setMode} options={[{ value: "structured", label: t("Structured") }, { value: "text", label: t("Text") }]} /></View>
        <View testID="script-view"><Segmented size="sm" label={t("View")} value={view} onChange={(next) => { setComparing(null); setView(next); }} options={[{ value: "script", label: t("Script") }, { value: "shots", label: t("Shot list") }, { value: "storyboard", label: t("Storyboard") }]} /></View>
        <Text variant="meta" tabular color={target.onTarget ? "text/secondary" : "warning/text"} testID="script-duration">{durationText(t, target)}</Text>
        {divider}
        <IconButton icon="search" size="sm" label={t("Find and replace")} keys={["Mod", "F"]} on={finding} toggle testID="script-find" onPress={() => { setComparing(null); setView("script"); setFinding(!finding); }} />
        <IconButton icon="panel" size="sm" label={t("Navigator")} on={navigatorOpen} toggle testID="toggle-navigator" onPress={() => setNavigatorOpen(!navigatorOpen)} />
        <IconButton icon="panel-r" size="sm" label={t("Inspector")} on={inspectorOpen} toggle testID="toggle-script-inspector" onPress={() => setInspectorOpen(!inspectorOpen)} />
        <AgentPanelToggle open={agentPanel.open} onToggle={agentPanel.toggle} />
        {divider}
        {status === "draft" ? <Button kind="outline" size="sm" label={policy.mode === "auto" || !roomy ? t("Submit") : t("Submit for review")} testID="script-submit" onPress={() => review({ type: "submit" }, policy.mode === "auto" ? t("Approved automatically — not reviewed") : t("Submitted for review"))} /> : null}
        {status === "changes_requested" ? <Button kind="outline" size="sm" label={t("Resubmit")} testID="script-resubmit" onPress={() => review({ type: "resubmit" }, t("Submitted for review"))} /> : null}
        {status === "in_review" ? <Button kind="outline" size="sm" label={t("Review")} testID="script-review" onPress={() => openInspector("review")} /> : null}
        <Button kind="primary" size="sm" icon="film" label={t("Create timeline")} testID="script-timeline" onPress={() => setDialog("timeline")} />
        <IconButton ref={menuRef} icon="more" size="sm" label={t("Script actions")} testID="script-menu" expanded={menu} onPress={() => setMenu(true)} />
        <Menu open={menu} anchor={menuRef} items={items} label={t("Script actions")} align="end" onClose={() => setMenu(false)} />
      </View>
      {banners}
      <View testID="script-regions" style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <EdgePanel open={navigatorShown} edge="start" size={navWidth} style={{ zIndex: 1 }}>
          <View style={{ minHeight: 0, zIndex: 1 }}>
            <Navigator width={navWidth} />
            <View ref={navigatorSplitter} testID="navigator-splitter" role="separator" aria-label={t("Resize navigator")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, end: -space[1], width: space[2], zIndex: 1 }} />
          </View>
        </EdgePanel>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{centre}</View>
        <EdgePanel open={inspectorShown} edge="end" size={inspWidth} overlay={overlay} style={overlay ? { end: agent?.mode === "docked" ? agent.width : 0, zIndex: 30 } : undefined}>
          <View style={overlay ? [theme.elevation(2), { flex: 1, minHeight: 0 }] : { minHeight: 0 }}>
            {inspector(inspWidth)}
            <View ref={inspectorSplitter} testID="inspector-splitter" role="separator" aria-label={t("Resize inspector")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, start: -space[1], width: space[2], zIndex: 1 }} />
          </View>
        </EdgePanel>
        <AgentPanelSlot open={agentPanel.open} editorWidth={width}><AgentPanel projectId="" scriptId={session.id} projectName={head.title} editorWidth={width} onClose={agentPanel.close} /></AgentPanelSlot>
      </View>
      {dialogs}
    </>,
  );
}
