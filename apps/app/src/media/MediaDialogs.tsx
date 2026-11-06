import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { binarySize, channelsLabel, durationBadge, formatDateTime, frameRateLabel, sampleRateLabel } from "@jagentchill/app-core";
import {
  addTag, ASSET_NAME_MAX, canCreateFolderIn, canMoveFolder, checkAssetName, checkFolderName, codecGuidance, codecLabel, createFolderCommand, FOLDER_NAME_MAX, localAssetOf, MAX_TAGS, MEDIA_MESSAGES, moveToFolderCommand,
  renameAssetCommand, renameFolderCommand, setAssetTagsCommand, shortHash, TAG_MAX, URL_MAX_LENGTH, type MediaMessage,
} from "@jagentchill/media";
import type { AssetRecord, LibraryFolder, ProjectDocument } from "@jagentchill/protocol";
import { Button, Chip, FieldError, FormDialog, FormField, IconButton, Input, Modal, ProgressBar, Text, Tooltip, Tree, radius, space, useTheme, useToast, type TreeItem, inlineIcon } from "@jagentchill/ui";
import { useT } from "../locale";
import { copyText, MediaPreview } from "../platform/media";
import type { CommitFn } from "./MediaPanel";
import type { LiveFacts, MediaSession, RelinkCheck } from "./session";

const clamp = (text: string, max: number) => [...text].slice(0, max).join("");

export function RenameAssetDialog(props: { document: ProjectDocument; assetId: string; commit: CommitFn; onClose(): void }) {
  const t = useT();
  const asset = props.document.media.assets.find((entry) => entry.id === props.assetId);
  const [name, setName] = useState(asset?.name ?? "");
  const done = useRef(false);
  if (!asset) return null;
  // An empty name reverts: the dialog closes and nothing changes. Enter reaches both the field and the dialog: one rename.
  const submit = (text: string) => { if (done.current) return; done.current = true; if (checkAssetName(text) !== null && checkAssetName(text) !== asset.name) props.commit((doc, ctx) => renameAssetCommand(doc, ctx, asset.id, text)); props.onClose(); };
  return (
    <FormDialog open title={t("Rename media")} submitLabel={t("Rename")} dirty={name !== asset.name} canSubmit onClose={props.onClose} onSubmit={() => submit(name)}>
      <FormField label={t("New name")}>
        <Input accessibilityLabel={t("New name")} autoFocus selectTextOnFocus value={name} onChangeText={(text) => setName(clamp(text, ASSET_NAME_MAX))} onSubmitEditing={(event) => submit(clamp(event.nativeEvent.text, ASSET_NAME_MAX))} />
      </FormField>
    </FormDialog>
  );
}

export function FolderDialog(props: { document: ProjectDocument; parentId: string | null; folder?: LibraryFolder; commit: CommitFn; onClose(): void }) {
  const t = useT();
  const [name, setName] = useState(props.folder?.name ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (text: string) => {
    const check = checkFolderName(props.document, props.parentId, text, props.folder?.id);
    if (!check.ok) { setProblem(check.reason === "duplicate" ? t("A folder with this name already exists") : check.reason === "too-long" ? t("A folder name has at most 80 characters") : null); return; }
    const done = props.folder ? props.commit((doc, ctx) => renameFolderCommand(doc, ctx, props.folder!.id, text)) : props.commit((doc, ctx) => createFolderCommand(doc, ctx, text, props.parentId));
    if (done) props.onClose();
  };
  return (
    <FormDialog open title={props.folder ? t("Rename folder") : t("New folder")} submitLabel={props.folder ? t("Rename") : t("Create")} dirty={name !== (props.folder?.name ?? "")} canSubmit={name.trim().length > 0} onClose={props.onClose} onSubmit={() => submit(name)}>
      <FormField label={t("Folder name")}>
        <Input accessibilityLabel={t("Folder name")} autoFocus selectTextOnFocus value={name} invalid={Boolean(problem)} onChangeText={(text) => { setName(clamp(text, FOLDER_NAME_MAX)); setProblem(null); }} onSubmitEditing={(event) => { const text = clamp(event.nativeEvent.text, FOLDER_NAME_MAX); if (text.trim()) submit(text); }} />
        {problem ? <FieldError message={problem} /> : null}
      </FormField>
    </FormDialog>
  );
}

const ROOT = "__root__";
/** "Move to…": the folder tree of the project library with its root. */
export function MoveToDialog(props: { document: ProjectDocument; assetIds: string[]; folderIds: string[]; commit: CommitFn; onClose(): void }) {
  const t = useT();
  const [selected, setSelected] = useState<string>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT]));
  const build = (parentId: string | null): TreeItem[] => props.document.media.folders.filter((folder) => folder.parentId === parentId && !props.folderIds.includes(folder.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((folder) => ({ id: folder.id, label: folder.name, icon: "folder" as const, children: build(folder.id) }));
  const target = selected === ROOT ? null : selected;
  const blocked = props.folderIds.some((id) => props.document.media.folders.find((folder) => folder.id === id)?.parentId !== target && !canMoveFolder(props.document, id, target));
  const canNest = canCreateFolderIn(props.document, target);
  const newFolder = <Button kind="ghost" icon="plus" label={t("New folder")} disabled={!canNest} onPress={() => {
    let made: string | null = null;
    const taken = new Set(props.document.media.folders.filter((folder) => folder.parentId === target).map((folder) => folder.name.toLowerCase()));
    let name = t("New folder");
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${t("New folder")} ${n}`;
    props.commit((doc, ctx) => { const commit = createFolderCommand(doc, ctx, name, target); made = commit.folderId; return commit; });
    if (made) { setExpanded((open) => new Set([...open, selected])); setSelected(made); }
  }} />;
  return (
    <Modal title={t("Move to…")} width={480} onClose={props.onClose}
      footer={<>{canNest ? newFolder : <Tooltip label={t("Folders can be nested up to 4 levels")}>{newFolder}</Tooltip>}<View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={props.onClose} />
        <Button kind="primary" label={t("Move")} disabled={blocked} onPress={() => { if (props.commit((doc, ctx) => moveToFolderCommand(doc, ctx, { assetIds: props.assetIds, folderIds: props.folderIds }, target))) props.onClose(); }} /></>}>
      <Tree label={t("Folders")} nodes={[{ id: ROOT, label: t("Project media"), icon: "folder", children: build(null) }]} expanded={expanded} onExpandedChange={setExpanded} selected={new Set([selected])} onSelectedChange={(next) => { const [id] = [...next]; if (id) setSelected(id); }} height={280} />
      {blocked ? <FieldError message={t("Folders can be nested up to 4 levels")} /> : null}
    </Modal>
  );
}

/** "Import from URL": an http or https link to a media file, downloaded with progress and Cancel. */
export function UrlImportDialog(props: { session: MediaSession; onClose(): void; onDone(result: Awaited<ReturnType<MediaSession["importFiles"]>>): void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<MediaMessage | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async () => {
    setBusy(true); setProblem(null); setProgress(null);
    abort.current = new AbortController();
    const outcome = await props.session.importUrl(url.trim(), { signal: abort.current.signal, onProgress: setProgress });
    setBusy(false);
    if (outcome.ok) { props.onDone(outcome.result); props.onClose(); } else if (!abort.current.signal.aborted) setProblem(outcome.message);
  };
  return (
    <Modal title={t("Import from URL")} width={480} onClose={() => { abort.current?.abort(); props.onClose(); }}
      footer={<><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={() => { abort.current?.abort(); props.onClose(); }} /><Button kind="primary" label={t("Import")} loading={busy} disabled={busy || url.trim().length === 0} onPress={() => void run()} /></>}>
      <FormField label={t("Link to a video, image or audio file")}>
        <Input accessibilityLabel={t("Link to a video, image or audio file")} autoFocus placeholder="https://" autoCapitalize="none" autoCorrect={false} value={url} invalid={Boolean(problem)} onChangeText={(text) => { setUrl(text.slice(0, URL_MAX_LENGTH)); setProblem(null); }} onSubmitEditing={() => { if (!busy && url.trim()) void run(); }} />
        {problem ? <FieldError message={t(MEDIA_MESSAGES[problem.code], problem.params)} /> : null}
      </FormField>
      {busy ? <ProgressBar value={progress} label={t("Downloading…")} /> : null}
    </Modal>
  );
}

/** A replacement file with different content: duration, resolution and frame rate side by side, then the confirmation. */
export function RelinkDialog(props: { document: ProjectDocument; assetId: string; check: Extract<RelinkCheck, { name: string }>; onClose(): void; onDone(): void }) {
  const t = useT();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const asset = props.document.media.assets.find((entry) => entry.id === props.assetId);
  if (props.check.decision.kind !== "different" || !asset) return null;
  const { comparison, shorter } = props.check.decision;
  const size = (value?: [number, number]) => (value ? `${value[0]} × ${value[1]}` : "—");
  const rows: [string, string, string][] = [
    [t("Duration"), comparison.duration.from ? durationBadge(comparison.duration.from) : "—", comparison.duration.to ? durationBadge(comparison.duration.to) : "—"],
    [t("Resolution"), size(comparison.resolution.from), size(comparison.resolution.to)],
    [t("Frame rate"), comparison.fps.from ? t("{fps} fps", { fps: frameRateLabel(comparison.fps.from) }) : "—", comparison.fps.to ? t("{fps} fps", { fps: frameRateLabel(comparison.fps.to) }) : "—"],
  ];
  return (
    <Modal title={t("Relink to a different file?")} description={t("'{file}' is not the file '{name}' was imported from.", { file: props.check.name, name: asset.name })} width={480} onClose={props.onClose}
      footer={<><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={props.onClose} /><Button kind="primary" label={t("Relink")} loading={busy} onPress={() => { setBusy(true); void props.check.apply().then(props.onDone, props.onClose); }} /></>}>
      <View role="table" testID="relink-compare">
        <View role="row" style={{ flexDirection: "row", paddingVertical: space[1] }}><View style={{ flex: 1 }} /><Text variant="meta" color="text/secondary" style={{ width: 120 }}>{t("Current")}</Text><Text variant="meta" color="text/secondary" style={{ width: 120 }}>{t("New file")}</Text></View>
        {rows.map(([label, from, to]) => (
          <View key={label} role="row" style={{ flexDirection: "row", paddingVertical: space[1.5], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <Text color="text/secondary" style={{ flex: 1 }}>{label}</Text><Text tabular style={{ width: 120 }}>{from}</Text><Text tabular style={{ width: 120 }}>{to}</Text>
          </View>
        ))}
      </View>
      {shorter ? <Text color="warning/text">{t("Clips longer than the new file will be trimmed to it.")}</Text> : null}
    </Modal>
  );
}

const SOURCE_LABEL: Record<string, string> = { imported: "Imported", recorded: "Recorded", url: "Imported from a link", stock: "Stock", bundled: "Bundled", ai: "AI-generated", connector: "Connector", device: "From a device", slate: "Slate", tool: "Created by a tool" };
/** The Info panel of an asset: preview, the values probed from the file, storage, proxy, usage, hash, tags and provenance. */
export function AssetInfo(props: { session: MediaSession; document: ProjectDocument; asset: AssetRecord; commit: CommitFn; readOnly?: boolean; usage: number; onClose(): void; onRelink(): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { asset, session } = props;
  const local = localAssetOf(props.document, asset.id);
  const [url, setUrl] = useState<string | null>(null);
  const [facts, setFacts] = useState<LiveFacts>({});
  const [name, setName] = useState(asset.name);
  const [tag, setTag] = useState("");
  const [tagProblem, setTagProblem] = useState<string | null>(null);
  useEffect(() => setName(asset.name), [asset.name]);
  useEffect(() => {
    let live = true;
    void session.mediaUrl(asset.id).then((value) => { if (live) setUrl(value); });
    void session.liveFacts(asset.id).then((value) => { if (live) setFacts(value); });
    return () => { live = false; };
  }, [session, asset.id, asset.contentHash]);
  const offline = !local.present.original, hasAudio = asset.type === "audio" || (asset.type === "video" && asset.hasAudio !== false);
  const codecs = [asset.videoCodec ? codecLabel(asset.videoCodec) : null, hasAudio && asset.audioCodec ? codecLabel(asset.audioCodec) : null].filter(Boolean).join(" · ");
  const proxy = local.proxy.state;
  const proxyText = proxy === "succeeded" ? `${t("Proxy")} · ${(local.proxy.container ?? "").toUpperCase()}${local.proxy.size ? ` · ${binarySize(local.proxy.size)}` : ""}` : proxy === "running" ? t("Proxy {percent} %", { percent: session.getState().proxyProgress[asset.id] ?? 0 })
    : proxy === "queued" ? t("Proxy queued") : proxy === "failed" ? t("Proxy failed") : proxy === "cancelled" ? t("Proxy cancelled") : proxy === "unavailable" ? t("Proxy unavailable on this device") : t("No proxy");
  const rows: [string, string, string][] = [
    ["type", t("Type"), t(asset.type === "video" ? "Video" : asset.type === "image" ? "Image" : "Audio")],
    ["container", t("Format"), [(asset.container ?? "").toUpperCase(), codecs].filter(Boolean).join(" · ") || "—"],
    ...(asset.type !== "audio" ? [["resolution", t("Resolution"), asset.width && asset.height ? `${asset.width} × ${asset.height}${facts.hasAlpha ? ` · ${t("Alpha")}` : ""}` : "—"] as [string, string, string]] : []),
    ...(asset.type === "video" && asset.fps ? [["fps", t("Frame rate"), t("{fps} fps", { fps: frameRateLabel(asset.fps) })] as [string, string, string]] : []),
    ...(asset.type !== "image" ? [["duration", t("Duration"), asset.duration ? durationBadge(asset.duration) : "—"] as [string, string, string]] : []),
    ...(hasAudio && asset.type !== "image" && facts.sampleRate ? [["audio", t("Audio"), `${sampleRateLabel(facts.sampleRate)}${facts.channels ? ` · ${t(channelsLabel(facts.channels))}` : ""}`] as [string, string, string]] : []),
    ["size", t("File size"), binarySize(asset.size)],
    ["added", t("Date added"), formatDateTime(asset.created_ms, theme.locale)],
    ["storage", t("Storage"), local.storage === "external" ? `${t("Linked file")} · ${local.externalPath ?? ""}` : offline ? t("Media offline") : t("In the project")],
    ...(asset.type === "video" ? [["proxy", t("Proxy"), proxyText] as [string, string, string]] : []),
    ["usage", t("Used by"), props.usage === 1 ? t("1 clip") : t("{n} clips", { n: props.usage })],
  ];
  const provenance = asset.provenance, source = provenance?.source ?? "imported";
  const provenanceRows: [string, string][] = [
    [t("Source"), t(SOURCE_LABEL[source] ?? "Imported")],
    ...(provenance?.originalFileName && provenance.originalFileName !== asset.name ? [[t("Original file"), provenance.originalFileName] as [string, string]] : []),
    ...(provenance?.url ? [[t("Link"), provenance.url] as [string, string]] : []),
    ...(provenance?.provider ? [[t("Provider"), provenance.provider] as [string, string]] : []),
    ...(provenance?.model ? [[t("Model"), provenance.model] as [string, string]] : []),
    ...(provenance?.author ? [[t("Author"), provenance.author] as [string, string]] : []),
    ...(provenance?.licence ? [[t("Licence"), provenance.attributionRequired ? `${provenance.licence} · ${t("Attribution required")}` : provenance.licence] as [string, string]] : []),
    ...(provenance?.prompt ? [[t("Prompt"), provenance.prompt] as [string, string]] : []),
  ];
  const commitName = () => { const next = checkAssetName(name); if (next === null || next === asset.name) { setName(asset.name); return; } props.commit((doc, ctx) => renameAssetCommand(doc, ctx, asset.id, name)); };
  const addOne = () => {
    const check = addTag(asset.tags, tag);
    if (!check.ok) { setTagProblem(check.reason === "limit" ? t("Up to 20 tags") : check.reason === "too-long" ? t("A tag has at most 32 characters") : check.reason === "duplicate" ? t("This tag is already added") : null); return; }
    if (props.commit((doc, ctx) => setAssetTagsCommand(doc, ctx, asset.id, check.tags))) { setTag(""); setTagProblem(null); }
  };
  const full = asset.tags.length >= MAX_TAGS;
  return (
    <View testID="asset-info" style={{ flex: 1, minHeight: 0, backgroundColor: theme.color("bg/app") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[2], height: 40, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <IconButton icon={inlineIcon(theme.rtl, "arrow-l")} size="sm" label={t("Back to media")} onPress={props.onClose} />
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{t("Info")}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space[3], gap: space[3] }}>
        <View style={{ borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color(asset.type === "audio" ? "bg/subtle" : "preview/offline-fill"), minHeight: asset.type === "audio" ? 54 : 150, justifyContent: "center", padding: asset.type === "audio" ? space[2] : 0 }}>
          {url ? <MediaPreview type={asset.type} url={url} label={asset.name} height={150} /> : <Text align="center" color={asset.type === "audio" ? "text/secondary" : "clip/label"}>{offline ? t("Media offline") : t("Loading…")}</Text>}
        </View>
        {offline ? <Button size="sm" icon="link" label={t("Relink…")} disabled={props.readOnly} onPress={props.onRelink} /> : null}
        {local.canDecode === false && asset.type === "video" ? <Text variant="meta" color="warning/text" testID="info-guidance">{(() => { const guidance = codecGuidance(codecLabel(asset.videoCodec), asset.videoCodec); return t(MEDIA_MESSAGES[guidance.code], guidance.params); })()}</Text> : null}
        <FormField label={t("Name")}>
          <Input accessibilityLabel={t("Name")} size="sm" value={name} readOnly={props.readOnly} onChangeText={(text) => setName(clamp(text, ASSET_NAME_MAX))} onBlur={commitName} onSubmitEditing={commitName} />
        </FormField>
        <View role="table">
          {rows.map(([id, label, value]) => (
            <View key={id} role="row" style={{ flexDirection: "row", gap: space[2], paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
              <Text variant="meta" color="text/secondary" style={{ width: 84 }}>{label}</Text>
              <Text variant="meta" selectable testID={`info-${id}`} style={{ flex: 1, minWidth: 0 }}>{value}</Text>
            </View>
          ))}
          <View role="row" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
            <Text variant="meta" color="text/secondary" style={{ width: 84 }}>{t("Content hash")}</Text>
            <Text variant="mono" testID="info-hash" style={{ flex: 1 }}>{shortHash(asset.contentHash) || "—"}</Text>
            {asset.contentHash ? <IconButton icon="copy" size="xs" label={t("Copy content hash")} onPress={() => void copyText(asset.contentHash ?? "").then((ok) => { if (ok) toast.show({ kind: "info", message: t("Copied") }); })} /> : null}
          </View>
        </View>
        <View style={{ gap: space[1.5] }}>
          <Text variant="meta" color="text/secondary">{t("Tags")}</Text>
          {asset.tags.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{asset.tags.map((entry) => <Chip key={entry} label={entry} onRemove={props.readOnly ? undefined : () => props.commit((doc, ctx) => setAssetTagsCommand(doc, ctx, asset.id, asset.tags.filter((other) => other !== entry)))} />)}</View> : null}
          <Input accessibilityLabel={t("Add a tag")} size="sm" placeholder={full ? t("Up to 20 tags") : t("Add a tag")} value={tag} disabled={full || props.readOnly} invalid={Boolean(tagProblem)} onChangeText={(text) => { setTag(clamp(text, TAG_MAX)); setTagProblem(null); }} onSubmitEditing={addOne} />
          {full ? <Text variant="meta" color="text/secondary" testID="tag-limit">{t("Up to 20 tags")}</Text> : tagProblem ? <FieldError message={tagProblem} /> : null}
        </View>
        <View role="table">
          {provenanceRows.map(([label, value]) => (
            <View key={label} role="row" style={{ flexDirection: "row", gap: space[2], paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
              <Text variant="meta" color="text/secondary" style={{ width: 84 }}>{label}</Text>
              <Text variant="meta" selectable style={{ flex: 1, minWidth: 0 }}>{value}</Text>
            </View>
          ))}
        </View>
        {provenance?.prompt ? <View style={{ alignItems: "flex-start" }}><Button size="xs" icon="copy" label={t("Copy prompt")} onPress={() => void copyText(provenance.prompt ?? "").then((ok) => { if (ok) toast.show({ kind: "info", message: t("Copied") }); })} /></View> : null}
      </ScrollView>
    </View>
  );
}
