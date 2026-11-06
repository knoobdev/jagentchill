import { formatAmount } from "@jagentchill/app-core";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { saveProject } from "@jagentchill/storage";
import { script as s, uuidV4, validatorTransitionRegistry } from "@jagentchill/editor-core";
import { Callout, Checkbox, FormDialog, FormField, RadioGroup, Select, Spinner, Text, fontFamily, space, useTheme, useToast } from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { useDevice } from "../state";
import { loadPdfFonts, readFile, renderSlate, saveFile, slatesSupported } from "./platform";
import { ids, type ScriptSession } from "./store";
import { exportName, messageOf } from "./strings";

export const IMPORT_ACCEPT = ".txt,.md,.fountain,.spmd,.docx,.jcscript";
export type ParsedImport = { result: s.ImportResult; text?: string; fileName: string } | { csv: string; fileName: string };
/** Reads a picked file as untrusted input: type, size and character limits first, then the parser of its format. */
export async function parseImport(file: File, language: string, split?: s.SplitMode): Promise<ParsedImport> {
  const extension = s.assertImportable(file.name, file.size), bytes = await readFile(file);
  const files = await import("@jagentchill/editor-core/script-files");
  if (extension === "docx") return { result: files.importDocx(bytes, file.name, { ids, language }), fileName: file.name };
  const text = files.decodeText(bytes);
  if (extension === "csv") return { csv: text, fileName: file.name };
  if (extension === "jcscript") return { result: s.importNative(text), fileName: file.name };
  return { result: s.importText(text, file.name, { ids, language, split }), text, fileName: file.name };
}

/** The import preview: the detected title, the counts, the first three scenes and any warnings, before the user confirms. */
export function ImportDialog(props: { file: File | null; intoOpen?: boolean; language: string; onClose(): void; onConfirm(content: s.ScriptContent, fileName: string): void | Promise<void> }) {
  const t = useT();
  const [parsed, setParsed] = useState<Extract<ParsedImport, { result: unknown }> | null>(null);
  const [split, setSplit] = useState<s.SplitMode>("one");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setParsed(null); setError(null); setSplit("one");
    if (!props.file) return;
    let cancelled = false;
    parseImport(props.file, props.language).then((next) => { if (!cancelled && "result" in next) setParsed(next); }).catch((cause) => { if (!cancelled) setError(messageOf(t, cause)); });
    return () => { cancelled = true; };
  }, [props.file]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (mode: s.SplitMode) => {
    setSplit(mode);
    if (parsed?.text !== undefined) try { setParsed({ ...parsed, result: s.importText(parsed.text, parsed.fileName, { ids, language: props.language, split: mode }) }); } catch (cause) { setError(messageOf(t, cause)); }
  };
  const preview = parsed?.result.preview;
  return (
    <FormDialog open={!!props.file} title={props.intoOpen ? t("Import into this script") : t("Import script")} description={props.file?.name} width={480} dirty={false} busy={busy} canSubmit={!!parsed && !error}
      submitLabel={props.intoOpen ? t("Replace content as a new version") : t("Import")} onClose={props.onClose}
      onSubmit={async () => { if (!parsed) return; const { warnings: _warnings, ...content } = parsed.result.content; setBusy(true); try { await props.onConfirm(content, parsed.fileName); } catch (cause) { setError(messageOf(t, cause)); } finally { setBusy(false); } }}>
      {error ? <Callout tone="danger">{error}</Callout> : !preview ? <Spinner size={16} label={t("Reading the file")} /> : (
        <View testID="import-preview" style={{ gap: space[3] }}>
          <View>
            <Text variant="title-sm" testID="import-title">{preview.title}</Text>
            <Text color="text/secondary" testID="import-counts">{[preview.scenes === 1 ? t("1 scene") : t("{n} scenes", { n: preview.scenes }), preview.lines === 1 ? t("1 line") : t("{n} lines", { n: preview.lines }), t("{n} characters", { n: formatAmount(preview.characters) })].join(" · ")}</Text>
          </View>
          {parsed.result.needsSplit ? <View style={{ gap: space[1] }}><Text color="text/secondary">{t("No scene headings were found")}</Text><RadioGroup label={t("No scene headings were found")} value={split} onChange={choose} options={[{ value: "one", label: t("Keep as one scene") }, { value: "blank-lines", label: t("Split into scenes by blank-line groups") }, { value: "headings", label: t("Split into scenes by headings") }]} /></View> : null}
          <View style={{ gap: space[1] }}>
            {preview.firstScenes.map((scene, index) => (
              <View key={index}>
                <Text variant="body-medium" numberOfLines={1}>{`${index + 1}. ${scene.heading || t("Scene")}`}</Text>
                {scene.firstLine ? <Text color="text/secondary" numberOfLines={2}>{scene.firstLine}</Text> : null}
              </View>
            ))}
          </View>
          {preview.warnings.map((warning) => <Callout key={warning} tone="warning">{warning}</Callout>)}
        </View>
      )}
    </FormDialog>
  );
}

const EXPORT_FORMATS = { pdf: "PDF (.pdf)", docx: "Word (.docx)", fountain: "Fountain (.fountain)", txt: "Plain text (.txt)", csv: "Shot list (.csv)", jcscript: "JAgentChill script (.jcscript)" };
const MIME: Record<s.ExportFormat, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fountain: "text/plain;charset=utf-8", txt: "text/plain;charset=utf-8", csv: "text/csv;charset=utf-8", jcscript: "application/json" };
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Produces the file of an export on the device and hands it to the file dialog. */
export async function runExport(t: T, session: ScriptSession, format: s.ExportFormat, options: s.ExportOptions & { paper?: s.PaperSize }): Promise<string> {
  // Exporting creates a version when the head changed since the last one.
  if ((options.version ?? "head") === "head") session.saveVersion();
  const source = s.exportSource(session.document, session.history, options.version ?? "head");
  const approvedAt = session.history.reviews.find((review) => review.versionId === source.versionId && review.decision === "approve")?.decided_ms;
  const label = s.approvalLabel(session.document, session.history);
  // A file of the approved version states the version and when it was approved, and whether anyone reviewed it.
  const header = options.version === "approved" ? `${t("Version {n}", { n: source.number ?? "" })} — ${label === "Approved automatically — not reviewed" ? t("Approved automatically — not reviewed") : t("Approved")} ${approvedAt ? day(approvedAt) : ""}`.trim() : undefined;
  const name = exportName(source.document.title, source.number, format);
  if (format === "pdf" || format === "docx") {
    const files = await import("@jagentchill/editor-core/script-files");
    if (format === "docx") saveFile(name, await files.exportDocx(source.document, { ...options, header }), MIME.docx);
    else {
      const text = JSON.stringify(s.contentOf(source.document));
      // The scan comes first: no font is fetched for a script the PDF cannot hold.
      saveFile(name, (await files.exportPdf(source.document, { ...options, header, fonts: await loadPdfFonts(files.needsJapaneseFace(text)) })).bytes, MIME.pdf);
    }
  } else saveFile(name, s.exportTextFormat(format, source.document, session.history, { ...options, header }), MIME[format]);
  session.checkpoint("Exported", "script.exported", { format, fileName: name });
  return name;
}
export function ExportDialog(props: { open: boolean; session: ScriptSession; onClose(): void }) {
  const t = useT(), theme = useTheme(), toast = useToast(), { session } = props;
  const [format, setFormat] = useState<s.ExportFormat>("pdf");
  const [version, setVersion] = useState("head");
  const [flags, setFlags] = useState({ shots: true, notes: true, sceneNumbers: false, twoColumn: false, titlePage: true, allVersions: false, comments: false, activity: false });
  const [paper, setPaper] = useState<s.PaperSize>(s.defaultPaper(theme.locale));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (props.open) { setError(null); setVersion("head"); } }, [props.open]);
  const versions = useMemo(() => [
    { value: "head", label: t("Current") }, ...(session.document.approvedVersionId ? [{ value: "approved", label: t("Approved version") }] : []),
    ...[...session.history.versions].reverse().map((entry) => ({ value: entry.versionId, label: `${t("Version {n}", { n: entry.number })} — ${entry.label ?? t(entry.summary)}` })),
  ], [session.history.versions, session.document.approvedVersionId, t]);
  const flag = (key: keyof typeof flags, label: string) => <Checkbox key={key} label={label} checked={flags[key]} onChange={(checked) => setFlags({ ...flags, [key]: checked })} />;
  const layout = format === "pdf" || format === "docx" || format === "txt" || format === "fountain";
  return (
    <FormDialog open={props.open} title={t("Export script")} width={480} dirty={false} busy={busy} submitLabel={t("Export")} onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true); setError(null);
        try {
          const name = await runExport(t, session, format, { version, shots: flags.shots, notes: flags.notes, sceneNumbers: flags.sceneNumbers, twoColumn: flags.twoColumn, titlePage: flags.titlePage, paper, versions: flags.allVersions ? "all" : "head", comments: flags.comments, activity: flags.activity });
          toast.show({ kind: "success", message: t("Exported {name}", { name }) });
          props.onClose();
        } catch (cause) {
          // A refusal has its own sentence; anything else is a fault of the exporter and is left in the log.
          if (!(cause instanceof s.ScriptError)) console.error("script export failed", cause);
          setError(messageOf(t, cause));
        } finally { setBusy(false); }
      }}>
      <View testID="export-dialog" style={{ gap: space[3] }}>
        <FormField label={t("Format")}>{() => <Select label={t("Format")} value={format} onChange={(value) => { setFormat(value); setError(null); }} options={(Object.keys(EXPORT_FORMATS) as s.ExportFormat[]).map((value) => ({ value, label: t(EXPORT_FORMATS[value]) }))} />}</FormField>
        <FormField label={t("Version")}>{() => <Select label={t("Version")} value={version} onChange={setVersion} options={versions} />}</FormField>
        {format === "pdf" ? <FormField label={t("Paper size")}>{() => <Select label={t("Paper size")} value={paper} onChange={(value) => setPaper(value as s.PaperSize)} options={[{ value: "a4", label: "A4" }, { value: "letter", label: "US Letter" }]} />}</FormField> : null}
        {layout ? <View style={{ gap: space[1] }}>{[flag("shots", t("Include shots")), flag("notes", t("Include notes")), flag("sceneNumbers", t("Include scene numbers")), ...(format === "docx" ? [flag("twoColumn", t("Two-column audio/visual layout"))] : []), ...(format === "pdf" ? [flag("titlePage", t("Title page"))] : [])]}</View> : null}
        {format === "jcscript" ? <View style={{ gap: space[1] }}>{[flag("allVersions", t("Include all versions")), flag("comments", t("Include comments")), flag("activity", t("Include activity"))]}</View> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </View>
    </FormDialog>
  );
}

/** "Create timeline": a script version becomes a real editor project on this device, with no host. */
export function TimelineDialog(props: { open: boolean; session: ScriptSession; onClose(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter(), { storage, library } = useDevice(), { session } = props;
  const approved = session.document.approvedVersionId;
  const [source, setSource] = useState<"approved" | "head">(approved ? "approved" : "head");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (props.open) { setSource(session.document.approvedVersionId ? "approved" : "head"); setError(null); } }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => {
    if (!props.open) return null;
    const versionId = source === "approved" && approved ? approved : session.document.headVersionId;
    const document = source === "approved" && approved ? s.documentAt(session.document, session.history, approved) : session.document;
    return s.planTimeline(document, { versionId, versionNumber: session.history.versions.find((entry) => entry.versionId === versionId)?.number ?? null, approved: source === "approved" });
  }, [props.open, source, approved, session.document, session.history]);
  async function create() {
    if (!storage || !plan) return;
    setBusy(true); setError(null);
    try {
      // The hand-off records a version, which the timeline's links then name.
      const version = source === "head" ? session.saveVersion().version : session.history.versions.find((entry) => entry.versionId === approved)!;
      const document = source === "head" ? session.document : s.documentAt(session.document, session.history, version.versionId);
      const final = s.planTimeline(document, { versionId: version.versionId, versionNumber: version.number, approved: source === "approved" });
      const projectId = uuidV4(), assets: Record<string, s.SlateAsset> = {};
      const colors = { background: theme.color("bg/inset"), primary: theme.color("text/primary"), secondary: theme.color("text/secondary"), rule: theme.color("border/hairline"), family: fontFamily.ui };
      for (const slate of final.slates) {
        const bytes = await renderSlate(slate, final.canvas, colors), assetId = uuidV4();
        const stored = await storage.writeMedia(projectId, assetId, bytes, { extension: "png" });
        assets[slate.key] = { assetId, size: stored.size, contentHash: stored.contentHash, width: final.canvas.width, height: final.canvas.height };
      }
      const built = s.buildTimelineProject(final, assets, { projectId, newId: uuidV4, now_ms: Date.now(), transitionTypes: Object.keys(validatorTransitionRegistry()) });
      await saveProject(storage, built.document);
      await library?.refresh(projectId);
      session.linkProject(projectId, version.versionId);
      await session.flush();
      props.onClose();
      router.push(`/editor/${projectId}` as never);
    } catch (cause) { setError(cause instanceof s.ScriptError ? messageOf(t, cause) : t("The timeline could not be created")); } finally { setBusy(false); }
  }
  const empty = !plan || plan.slates.length === 0;
  return (
    <FormDialog open={props.open} title={t("Create timeline")} description={t("A new project with one slate per shot, scene markers, titles and captions.")} width={480} dirty={false} busy={busy} canSubmit={!empty && slatesSupported} submitLabel={t("Create timeline")} onClose={props.onClose} onSubmit={() => void create()}>
      <View testID="timeline-dialog" style={{ gap: space[3] }}>
        {approved ? <RadioGroup label={t("Version")} value={source} onChange={(value) => setSource(value as "approved" | "head")} options={[{ value: "approved", label: t("Approved version") }, { value: "head", label: t("Current draft") }]} /> : null}
        {source === "head" && session.document.status !== "approved" ? <Callout tone="warning">{t("This version is not approved")}</Callout> : null}
        {plan ? <Text testID="timeline-summary" color="text/secondary">{[plan.slates.length === 1 ? t("1 slate") : t("{n} slates", { n: plan.slates.length }), s.formatClock(plan.duration), plan.cues.length === 1 ? t("1 caption") : t("{n} captions", { n: plan.cues.length }), plan.titles.length === 1 ? t("1 title") : t("{n} titles", { n: plan.titles.length })].join(" · ")}</Text> : null}
        {plan?.warnings.length ? <Callout tone="info">{t("Lines not covered by a shot are left out of the timeline.")}</Callout> : null}
        {empty ? <Callout tone="warning">{t("Add some content before creating a timeline")}</Callout> : null}
        {!slatesSupported ? <Callout tone="warning">{t("Slates cannot be rendered on this device")}</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </View>
    </FormDialog>
  );
}
