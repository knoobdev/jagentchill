import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Image, ScrollView, View } from "react-native";
import { binarySize, durationBadge, formatDateTime, mediaGridColumns, usageBadge } from "@jagentchill/app-core";
import type { Commit, CommitContext } from "@jagentchill/editor-core";
import type { Transfer } from "@jagentchill/client";
import {
  actionTargets, activeFilterCount, canCreateFolderIn, cardLabel, chooseSort, connectorMenuItem, CONNECTORS, deleteFolderCommand, EMPTY_SELECTION, FILTER_LABELS, GRID_MIN_COLUMN_PX, isMediaMime, listLibrary, localAssetOf,
  marqueeHits, MEDIA_MESSAGES, moveToFolderCommand, NO_FILTERS, offlineBanner, pasteImportApplies, PICKER_ACCEPT, recordingSources, removalImpact, revealAsset, sampleWaveform, SEARCH_DEBOUNCE_MS, selection as select, SORT_LABELS,
  sourceBadges, stockSectionState, storageFooter, importProgressMessage,
  type ConnectorId, type LibraryFilters, type LibraryRow, type LibrarySelection, type MediaMessage, type RecordingKind, type SortKey, type SourceFilter, type StatusFilter, type WaveformState,
} from "@jagentchill/media";
import type { LibraryFolder, ProjectDocument } from "@jagentchill/protocol";
import { PREFERENCES } from "@jagentchill/storage";
import {
  Badge, Breadcrumb, Button, ConfirmDialog, FilterChip, Icon, IconButton, Menu, Modal, ProgressBar, SearchField, Skeleton, Tabs, Tap, Text, Tooltip, radius, space, useHostGate, useTheme, useToast, type Crumb, type IconName, type MenuItem,
} from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { bindFileDrop, bindMarquee, boxOf, captureSupported, onMediaPaste, scrollIntoView, type Box, type PickedFile } from "../platform/media";
import { bindDrag, bindDrop, focusById, heldModifiers, pickFiles } from "../platform/store";
import { useStoragePref } from "../state";
import { AssetInfo, FolderDialog, MoveToDialog, RelinkDialog, RenameAssetDialog, UrlImportDialog } from "./MediaDialogs";
import { Recorder } from "./Recorder";
import { useSync } from "../sync/SyncProvider";
import type { MediaNotice, MediaSession, RelinkCheck } from "./session";

export type CommitFn = (change: (doc: ProjectDocument, ctx: CommitContext) => Commit | null, live?: boolean) => boolean;
/** What the timeline offers the library. Absent while no timeline is mounted: the library then shows no timeline action. */
export type TimelineBridge = { add(assetIds: string[], options?: { overlay?: boolean }): void; selectClips(assetId: string): void; pasteAt(assetIds: string[]): void; clipboardHasEntry(): boolean };
export type MediaPanelProps = {
  session: MediaSession; document: ProjectDocument; commit: CommitFn; readOnly?: boolean; timeline?: TimelineBridge | null;
  /** The mobile sheet: a tap adds the asset through the entry that opened the sheet. */
  onPick?(assetIds: string[]): void;
  reveal?: { assetId: string; nonce: number } | null;
};
const mediaText = (t: T, message: MediaMessage): string => t(MEDIA_MESSAGES[message.code], message.params);
const TYPE_ICON: Record<"video" | "image" | "audio", IconName> = { video: "video", image: "image", audio: "music" };
const TYPE_LABEL = { video: "Video", image: "Image", audio: "Audio" } as const;
const ITEM = "asset-", THUMB_RATIO = 1.94, GAP = space[2];
type Dialog =
  | { kind: "rename"; assetId: string } | { kind: "folder"; folder?: LibraryFolder } | { kind: "move"; assetIds: string[]; folderIds: string[] } | { kind: "delete"; assetIds: string[] }
  | { kind: "delete-folder"; folder: LibraryFolder } | { kind: "url" } | { kind: "relink"; assetId: string; check: Extract<RelinkCheck, { name: string }> } | { kind: "record"; source: RecordingKind }
  | { kind: "quota"; notice: MediaNotice };

/** Real peaks of an audio asset's waveform summary, drawn as the card glyph. */
function WaveformGlyph(props: { session: MediaSession; assetId: string; bars: number }) {
  const theme = useTheme();
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let live = true;
    props.session.waveform(props.assetId, (state: WaveformState) => {
      if (!live || state.state !== "ready") return;
      const seconds = state.summary.totalSamples / state.summary.sampleRate;
      setPeaks(sampleWaveform(state.summary, { startSeconds: 0, endSeconds: seconds, bars: props.bars }));
    });
    return () => { live = false; };
  }, [props.session, props.assetId, props.bars]);
  return (
    <View testID={`waveform-${props.assetId}`} accessibilityLabel="" style={{ position: "absolute", top: space[4], right: space[1], bottom: space[1], left: space[1], flexDirection: "row", alignItems: "center", gap: 1 }}>
      {peaks ? Array.from(peaks, (peak, index) => <View key={index} style={{ flex: 1, height: `${Math.max(6, Math.min(100, Math.round(peak * 100)))}%`, borderRadius: 1, backgroundColor: theme.color("waveform/fill") }} />) : <View style={{ flex: 1, alignItems: "center" }}><Icon name="music" size={20} color="clip/label" /></View>}
    </View>
  );
}

type TileProps = {
  row: LibraryRow; session: MediaSession; document: ProjectDocument; width: number; selected: boolean; selecting: boolean; highlighted: boolean; progress: number | undefined; list: boolean; tabbable: boolean; download?: Transfer;
  canAdd: boolean;
  /** The picture of the tile as the session has it now (`null`: it has none, `undefined`: it is being made). */
  thumb: ReturnType<MediaSession["thumbnail"]> | null;
  /** What the tile does, as the panel means it NOW (one object for the life of the panel, filled at each of its renders). */
  calls: { current: TileCalls };
};
type TileKey = { key: string; shift: boolean; ctrl: boolean; meta: boolean; preventDefault(): void };
type TileCalls = { press(id: string): void; double(id: string): void; longPress(id: string): void; key(id: string, key: TileKey): void; add(id: string): void; retryProxy(id: string): void; retryDownload(id: string): void; remove(id: string): void; dragPayload(id: string): string | null; menuOf(row: LibraryRow): MenuItem[] };
/**
 * A tile is drawn again when what it SHOWS changes — its asset, how often it is used, its state, its picture, whether it
 * is selected — not with the panel, which renders on every edit of the project (a split drew all the tiles again, for one
 * "Used ×2"). So it is handed no function of the panel's render: it calls the panel's current ones through `calls`.
 */
const sameTile = (a: TileProps, b: TileProps): boolean =>
  a.row.asset === b.row.asset && a.row.usage === b.row.usage && a.row.folderPath === b.row.folderPath && a.row.statuses.join() === b.row.statuses.join()
  && a.session === b.session && a.width === b.width && a.selected === b.selected && a.selecting === b.selecting && a.highlighted === b.highlighted && a.progress === b.progress && a.list === b.list
  && a.tabbable === b.tabbable && a.canAdd === b.canAdd && a.thumb === b.thumb && a.calls === b.calls && a.download?.state === b.download?.state && a.download?.error === b.download?.error && localAssetOf(a.document, a.row.asset.id).proxy.state === localAssetOf(b.document, b.row.asset.id).proxy.state;
const AssetTile = memo(function AssetTile(input: TileProps) {
  const t = useT();
  const theme = useTheme();
  const { asset } = input.row, { calls } = input, id = asset.id;
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const props = {
    ...input, menu: menuAt ? calls.current.menuOf(input.row) : [],
    onPress: () => calls.current.press(id), onDouble: () => calls.current.double(id), onLongPress: () => calls.current.longPress(id), onKey: (key: TileKey) => calls.current.key(id, key), onAdd: () => calls.current.add(id), onRetryProxy: () => calls.current.retryProxy(id), onRetryDownload: () => calls.current.retryDownload(id),
  };
  const local = localAssetOf(props.document, asset.id);
  const url = asset.type === "audio" ? null : props.thumb;
  const node = useRef<View>(null);
  useEffect(() => bindDrag(node.current, () => calls.current.dragPayload(id)), [calls, id]);
  const offline = props.row.statuses.includes("offline"), cantPreview = props.row.statuses.includes("cant-preview");
  const usage = usageBadge(props.row.usage);
  const proxy = local.proxy.state;
  const badges: ReactNode[] = [];
  if (offline) badges.push(<Badge key="offline" label={t("Offline")} tone="danger" />);
  if (input.download?.state === "failed" || input.download?.state === "not-uploaded") badges.push(<Badge key="download-failed" label={t("Download failed — Retry")} tone="danger" />);
  if (usage) badges.push(<Badge key="used" label={props.row.usage === 1 ? t("Used") : t("Used ×{n}", { n: props.row.usage })} tone="accent" />);
  for (const badge of sourceBadges(asset)) badges.push(<Badge key={badge} label={t(badge)} tone="purple" />);
  if (proxy === "succeeded") badges.push(<Badge key="proxy" label={t("Proxy")} tone="neutral" />);
  else if (proxy === "running" || proxy === "queued") badges.push(<Badge key="proxy" label={proxy === "queued" ? t("Proxy queued") : t("Proxy {percent} %", { percent: props.progress ?? 0 })} tone="neutral" />);
  else if (proxy === "failed") badges.push(<Badge key="proxy" label={t("Proxy failed")} tone="danger" />);
  else if (proxy === "cancelled") badges.push(<Badge key="proxy" label={t("Proxy cancelled")} tone="neutral" />);
  if (cantPreview) badges.push(<Tooltip key="cant" label={t("Can't preview {name}", { name: asset.name })}><View accessibilityLabel={t("Can't preview {name}", { name: asset.name })} style={{ width: 16, height: 16, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("warning/subtle") }}><Icon name="warn" size={12} color="warning/icon" /></View></Tooltip>);
  const thumbHeight = Math.round(props.width / THUMB_RATIO);
  const thumb = (height: number, small = false) => (
    <View style={{ height, width: small ? Math.round(height * THUMB_RATIO) : undefined, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color(asset.type === "audio" ? "clip/audio" : offline ? "preview/offline-fill" : "bg/subtle"), alignItems: "center", justifyContent: "center", outlineWidth: props.selected || props.highlighted ? 2 : 0, outlineStyle: "solid", outlineOffset: 1, outlineColor: theme.color("accent") } as object}>
      {asset.type === "audio" ? (small ? <Icon name="music" size={14} color="clip/label" /> : <WaveformGlyph session={props.session} assetId={asset.id} bars={Math.max(12, Math.floor(props.width / 4))} />)
        : url ? <Image source={{ uri: url }} accessibilityLabel="" resizeMode="cover" testID={`thumb-${asset.name}`} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }} />
          : url === null ? <Icon name={TYPE_ICON[asset.type]} size={small ? 14 : 24} color="text/secondary" /> : <Skeleton height={null} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 0 }} />}
      {small ? null : (
        <>
          <View pointerEvents="none" style={{ position: "absolute", top: space[1], left: space[1], right: space[1], flexDirection: "row", flexWrap: "wrap", gap: space[0.5] }}>{badges}</View>
          {asset.type !== "image" && asset.duration ? (
            <View pointerEvents="none" style={{ position: "absolute", end: space[1], bottom: space[1], backgroundColor: theme.color("clip/label-scrim"), borderRadius: radius.xs, paddingHorizontal: space[1] }}>
              <Text variant="caption" color="clip/label" tabular testID={`duration-${asset.name}`}>{durationBadge(asset.duration)}</Text>
            </View>
          ) : null}
          {props.selecting ? <View pointerEvents="none" style={{ position: "absolute", start: space[1], bottom: space[1], width: 18, height: 18, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: theme.color(props.selected ? "accent" : "clip/label"), backgroundColor: theme.color(props.selected ? "accent" : "clip/label-scrim") }}>{props.selected ? <Icon name="check" size={12} color="text/on-accent" /> : null}</View> : null}
        </>
      )}
    </View>
  );
  const common = {
    role: "button" as const, nativeID: `${ITEM}${asset.id}`, testID: `asset-${asset.name}`, label: asset.name, selected: props.selected, tabIndex: (props.tabbable ? 0 : -1) as 0 | -1,
    tooltip: asset.name.length > 22 || props.row.folderPath ? { label: props.row.folderPath ? `${asset.name} — ${props.row.folderPath}` : asset.name } : undefined,
    onPress: props.onPress, onDoublePress: props.canAdd ? props.onDouble : undefined, onLongPress: props.onLongPress, onContextMenu: (at: { x: number; y: number }) => setMenuAt({ x: at.x, y: at.y, width: 0, height: 0 }),
    onKeyDown: (key: { key: string; shift: boolean; ctrl: boolean; meta: boolean; preventDefault(): void }) => { if (key.key === "ContextMenu" || (key.key === "F10" && key.shift)) { key.preventDefault(); const box = boxOf(node.current); setMenuAt({ x: box?.x ?? 0, y: (box?.y ?? 0) + (box?.height ?? 0), width: 0, height: 0 }); } else props.onKey(key); },
  };
  const menu = menuAt ? <Menu open anchor={menuAt} items={props.menu} label={t("Actions for {name}", { name: asset.name })} onClose={() => setMenuAt(null)} /> : null;
  const note = proxy === "unavailable" ? t("Proxy unavailable on this device") : null;
  if (props.list) {
    return (
      <View ref={node}>
      <Tap {...common} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: space[2], height: 32, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color(props.selected ? "accent/subtle" : state.hovered ? "bg/hover" : "bg/app") })}>
        {thumb(22, true)}
        <Text numberOfLines={1} style={{ width: 150 }}>{asset.name}</Text>
        <Text variant="meta" color="text/secondary" style={{ width: 52 }}>{t(TYPE_LABEL[asset.type])}</Text>
        <Text variant="meta" color="text/secondary" tabular style={{ width: 56 }}>{asset.type !== "image" && asset.duration ? durationBadge(asset.duration) : "—"}</Text>
        <Text variant="meta" color="text/secondary" tabular style={{ width: 84 }}>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</Text>
        <Text variant="meta" color="text/secondary" tabular style={{ width: 72 }}>{binarySize(asset.size)}</Text>
        <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ width: 132 }}>{formatDateTime(asset.created_ms, theme.locale)}</Text>
        {offline ? <Badge label={t("Offline")} tone="danger" /> : null}
        {menu}
      </Tap>
      </View>
    );
  }
  return (
    // The wrapper is the drag source: a button element itself is not draggable in every browser.
    <View ref={node} style={{ width: props.width }}>
      <Tap {...common} noRing={false} style={{ gap: space[1], borderRadius: radius.sm }}>
        {thumb(thumbHeight)}
        <Text variant="meta" numberOfLines={1} testID={`label-${asset.name}`}>{cardLabel(asset.name)}</Text>
        {props.row.folderPath ? <Text variant="caption" color="text/secondary" numberOfLines={1}>{props.row.folderPath}</Text> : null}
        {note ? <Text variant="caption" color="warning/text" numberOfLines={2}>{note}</Text> : null}
        {menu}
      </Tap>
      {input.download?.state === "failed" || input.download?.state === "not-uploaded" ? <View role="status" style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Button kind="ghost" size="xs" icon="refresh" label={t("Retry")} onPress={props.onRetryDownload} /><Button kind="ghost" size="xs" tone="danger" label={t("Delete")} onPress={() => calls.current.remove(id)} /></View> : null}
      {props.canAdd ? <View style={{ position: "absolute", start: space[1], top: thumbHeight - 24 - space[1] }}><IconButton icon="plus" size="xs" variant="outline" label={t("Add to timeline")} onPress={props.onAdd} /></View> : null}
      {proxy === "failed" ? <View style={{ position: "absolute", end: space[1], top: space[1] }}><IconButton icon="refresh" size="xs" variant="outline" label={t("Retry")} onPress={props.onRetryProxy} /></View> : null}
    </View>
  );
}, sameTile);

function FolderTile(props: { folder: LibraryFolder; count: number; menu: MenuItem[]; onOpen(): void; onDrop(payload: string): void }) {
  const t = useT();
  const theme = useTheme();
  const node = useRef<View>(null);
  const [over, setOver] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const drop = useRef(props.onDrop);
  drop.current = props.onDrop;
  useEffect(() => {
    const undrag = bindDrag(node.current, () => JSON.stringify({ media: { assetIds: [], folderIds: [props.folder.id] } }));
    const undrop = bindDrop(node.current, { accept: (types) => types.includes("application/x-jagentchill"), onEnter: () => setOver(true), onLeave: () => setOver(false), onDrop: (data) => drop.current(data.text) });
    return () => { undrag(); undrop(); };
  }, [props.folder.id]);
  return (
    <View ref={node} testID={`folder-${props.folder.name}`} style={{ flexDirection: "row", alignItems: "center", height: 32, paddingEnd: space[1], borderRadius: radius.sm, borderWidth: over ? 2 : 1, borderColor: theme.color(over ? "accent" : "border/hairline"), backgroundColor: theme.color(over ? "accent/subtle" : "bg/app") }}>
      <Tap role="button" label={props.folder.name} onPress={props.onOpen} onContextMenu={(at) => setMenuAt({ x: at.x, y: at.y, width: 0, height: 0 })}
        style={(state) => ({ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered && !over ? theme.color("bg/hover") : "transparent" })}>
        <Icon name="folder" size={16} color="text/secondary" />
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{props.folder.name}</Text>
        <Text variant="meta" color="text/secondary">{props.count}</Text>
      </Tap>
      <IconButton icon="more" size="xs" label={t("Actions for {name}", { name: props.folder.name })} onPress={() => { const box = boxOf(node.current); setMenuAt({ x: (box?.x ?? 0) + (box?.width ?? 0) - 8, y: (box?.y ?? 0) + (box?.height ?? 0), width: 0, height: 0 }); }} />
      {menuAt ? <Menu open anchor={menuAt} items={props.menu} label={t("Actions for {name}", { name: props.folder.name })} onClose={() => setMenuAt(null)} /> : null}
    </View>
  );
}

/**
 * The Media tab of a project: its library with views, sorting, filters, search, folders, selection, import from every
 * source this device has, the Info panel, relink, proxies and recording. It lists only the open project's assets.
 */
export function MediaPanel(props: MediaPanelProps) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const gate = useHostGate();
  const { engine } = useSync();
  const { session, document: doc, commit } = props;
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [viewMode, setViewMode] = useStoragePref(PREFERENCES.mediaViewMode);
  const [storedSort, setStoredSort] = useStoragePref(PREFERENCES.mediaSort);
  const sort = useMemo(() => ({ key: ((Object.keys(SORT_LABELS) as SortKey[]).includes(storedSort.key as SortKey) ? storedSort.key : "name") as SortKey, direction: storedSort.order }), [storedSort]);
  const [tab, setTab] = useState<"project" | "library">("project");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<LibrarySelection>(EMPTY_SELECTION);
  const [selecting, setSelecting] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importRef = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const root = useRef<View>(null), body = useRef<View>(null), options = useRef<View>(null);
  const progressToast = useRef<number | null>(null);
  const tileCalls = useRef<TileCalls>(null as unknown as TileCalls);

  // A folder that no longer exists (undo of its creation, a restored version) falls back to the root.
  const folder = folderId !== null && doc.media.folders.some((entry) => entry.id === folderId) ? folderId : null;
  useEffect(() => session.setCurrentFolder(folder), [session, folder]);
  const listing = useMemo(() => listLibrary(doc, { folderId: folder, query, filters, sort }), [doc, folder, query, filters, sort]);
  const displayed = useMemo(() => listing.rows.map((row) => row.asset.id), [listing]);
  const offline = session.offlineAssets();
  const failedDownloads = new Map((engine?.transfers() ?? []).filter((transfer) => transfer.projectId === doc.metadata.id && transfer.direction === "download" && (transfer.state === "failed" || transfer.state === "not-uploaded")).map((transfer) => [transfer.assetId, transfer]));
  useEffect(() => { setSelected((current) => { const next = select.prune(current, displayed); return next.ids.length === current.ids.length ? current : next; }); }, [displayed]);
  useEffect(() => { if (selected.ids.length === 0) setSelecting(false); }, [selected.ids.length]);

  // ── Import, with the progress toast and the completion summary ────────────────────────────────────────────────────
  const say = useCallback((message: MediaMessage) => mediaText(t, message), [t]);
  const flash = useCallback((assetId: string) => { setHighlight(assetId); setTimeout(() => setHighlight((current) => (current === assetId ? null : current)), 2000); setTimeout(() => scrollIntoView(`${ITEM}${assetId}`), 50); }, []);
  useEffect(() => session.onNotice((notice) => {
    if (notice.message.code === "media.quota") { setDialog({ kind: "quota", notice }); return; }
    if (notice.level === "error") return;
    toast.show({ kind: notice.level === "warning" ? "warning" : "info", message: say(notice.message) });
    if (notice.message.code === "media.already-in-project" && notice.assetId) { const asset = doc.media.assets.find((entry) => entry.id === notice.assetId); if (asset) { setFolderId(asset.folderId); setInput(""); setQuery(""); setFilters(NO_FILTERS); setSelected({ ids: [asset.id], anchor: asset.id }); flash(asset.id); } }
  }), [session, toast, say, doc, flash]);
  useEffect(() => {
    if (session.platform === "mobile") {
      if (progressToast.current !== null) { toast.dismiss(progressToast.current); progressToast.current = null; }
      return;
    }
    if (state.importing && progressToast.current === null) progressToast.current = toast.show({ kind: "progress", message: `${say(importProgressMessage(false))} ${state.importing.percent} %`, progress: state.importing.percent / 100, action: { label: t("Cancel"), onPress: () => session.cancelImport() } });
    else if (state.importing && progressToast.current !== null) toast.update(progressToast.current, { message: `${say(importProgressMessage(false))} ${state.importing.percent} %`, progress: state.importing.percent / 100 });
    else if (!state.importing && progressToast.current !== null) { toast.dismiss(progressToast.current); progressToast.current = null; }
  }, [state.importing, toast, say, t, session]);
  const report = useCallback((result: Awaited<ReturnType<MediaSession["importFiles"]>>) => {
    if (result.imported.length === 0 && result.failures.length === 0) return;
    const [head, ...lines] = result.summary;
    toast.show({ kind: result.imported.length > 0 ? "success" : "warning", message: say(head) });
    // Quota refusals have their own dialog with its actions; every other failure is one line with its reason.
    for (const [index, line] of lines.entries()) if (result.failures[index]?.reason.code !== "media.quota") toast.show({ kind: "error", message: t("{name}: {reason}", { name: result.failures[index].name, reason: say(result.failures[index].reason) }) || say(line), sticky: true });
    if (result.imported.length > 0) flash(result.imported[result.imported.length - 1].assetId);
  }, [toast, say, t, flash]);
  const importPicked = useCallback(async (files: PickedFile[]) => { if (files.length === 0 || props.readOnly) return; report(await session.importFiles(files)); }, [session, report, props.readOnly]);
  const pick = useCallback(async () => importPicked((await pickFiles(PICKER_ACCEPT, true)).map((file) => ({ file }))), [importPicked]);

  useEffect(() => bindFileDrop(root.current, { onEnter: () => setDragOver(true), onLeave: () => setDragOver(false), onDrop: (files) => void importPicked(files) }), [importPicked]);
  useEffect(() => onMediaPaste((items) => {
    if (props.readOnly || !pasteImportApplies({ targetIsTypable: false, editorClipboardHasEntry: props.timeline?.clipboardHasEntry() ?? false, mediaItemCount: items.filter((item) => isMediaMime(item.file.type)).length })) return false;
    void session.importPasted(items).then((result) => { report(result); props.timeline?.pasteAt([...result.imported, ...result.reused].map((entry) => entry.assetId)); });
    return true;
  }), [session, report, props.readOnly, props.timeline]);
  useEffect(() => bindMarquee(body.current, ITEM, {
    onChange: (box, items, additive) => { setMarquee(box); setSelected((current) => select.marquee(additive ? current : EMPTY_SELECTION, marqueeHits(box, items), additive)); },
    onEnd: (moved) => { setMarquee(null); if (!moved) setSelected(EMPTY_SELECTION); },
  }), []);

  // ── Reveal ────────────────────────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!props.reveal) return;
    const result = revealAsset(doc, { folderId: folder, query, filters, sort }, props.reveal.assetId, Date.now());
    if (!result.found) { toast.show({ kind: "warning", message: t("Media not found in this project") }); return; }
    setTab("project"); setInfo(null); setFolderId(result.view.folderId); setInput(""); setQuery(""); setFilters(result.view.filters); setSelected(result.selection); flash(result.scrollTo);
  }, [props.reveal?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const remove = (assetIds: string[]) => {
    if (assetIds.length === 0 || props.readOnly) return;
    if (removalImpact(doc, assetIds).clips > 0) setDialog({ kind: "delete", assetIds }); else { session.remove(assetIds); setSelected(EMPTY_SELECTION); }
  };
  const relink = async (assetId: string) => {
    const [file] = await pickFiles(PICKER_ACCEPT, false);
    if (!file) return;
    const check = await session.relink(assetId, { file });
    if ("failed" in check) { toast.show({ kind: "error", message: say(check.failed) }); return; }
    if (check.decision.kind === "different") setDialog({ kind: "relink", assetId, check }); else toast.show({ kind: "success", message: t("Media relinked") });
  };
  const exportOriginals = async (assetIds: string[]) => {
    const result = await session.exportOriginals(assetIds);
    if (result.notice) toast.show({ kind: "warning", message: say(result.notice), sticky: true });
    if (result.written.length > 0) toast.show({ kind: "success", message: result.written.length === 1 ? t("{name} exported", { name: result.written[0] }) : t("{n} files exported", { n: result.written.length }) });
  };
  const moveInto = (payload: string, target: string | null) => {
    let items: { assetIds?: string[]; folderIds?: string[] } | undefined;
    try { items = (JSON.parse(payload) as { media?: { assetIds?: string[]; folderIds?: string[] } }).media; } catch { items = undefined; }
    if (!items || ((items.assetIds?.length ?? 0) === 0 && (items.folderIds?.length ?? 0) === 0) || items.folderIds?.includes(target ?? "")) return;
    commit((document, ctx) => moveToFolderCommand(document, ctx, items!, target));
  };
  const press = (id: string) => {
    if (props.onPick && !selecting) { props.onPick([id]); return; }
    const held = heldModifiers();
    setSelected((current) => (selecting || held.toggle ? select.toggle(current, id) : held.shift ? select.range(current, id, displayed) : select.click(current, id)));
  };
  const columns = viewMode === "list" ? 1 : mediaGridColumns(Math.max(0, width - space[3] * 2), GRID_MIN_COLUMN_PX, GAP);
  const tileWidth = Math.floor((Math.max(0, width - space[3] * 2) - GAP * (columns - 1)) / columns);
  const key = (id: string) => (event: { key: string; shift: boolean; ctrl: boolean; meta: boolean; preventDefault(): void }) => {
    const index = displayed.indexOf(id), step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : 0;
    if (step !== 0) { event.preventDefault(); const next = displayed[Math.max(0, Math.min(displayed.length - 1, index + step))]; if (next) focusById(`${ITEM}${next}`); }
    else if (event.key === " ") { event.preventDefault(); setSelected((current) => select.toggle(current, id)); }
    else if (event.key === "Enter" && props.timeline) { event.preventDefault(); props.timeline.add([id]); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(actionTargets(selected, id)); }
    else if (event.key === "F2") { event.preventDefault(); setDialog({ kind: "rename", assetId: id }); }
    else if (event.key.toLowerCase() === "a" && (event.ctrl || event.meta)) { event.preventDefault(); setSelected(select.all(displayed)); }
    else if (event.key === "Escape") { event.preventDefault(); setSelected(EMPTY_SELECTION); }
  };
  const menuOf = (row: LibraryRow): MenuItem[] => {
    const id = row.asset.id, targets = actionTargets(selected, id), local = localAssetOf(doc, id), isVideo = row.asset.type === "video";
    const proxyItems: MenuItem[] = !isVideo ? [] : local.proxy.state === "succeeded" ? [{ id: "delete-proxy", label: t("Delete proxy"), icon: "x", onSelect: () => session.deleteProxy(id) }]
      : local.proxy.state === "running" || local.proxy.state === "queued" ? [{ id: "cancel-proxy", label: t("Cancel proxy"), icon: "x", onSelect: () => session.cancelProxy(id) }]
        : [{ id: "create-proxy", label: local.proxy.state === "failed" ? t("Retry proxy") : t("Create proxy"), icon: "refresh", disabled: row.statuses.includes("offline"), onSelect: () => session.createProxy(id) }];
    return [
      { id: "info", label: t("Info"), icon: "info", onSelect: () => setInfo(id) },
      { id: "rename", label: t("Rename"), icon: "pencil", shortcut: "list.rename", disabled: props.readOnly, onSelect: () => setDialog({ kind: "rename", assetId: id }) },
      { id: "move", label: t("Move to…"), icon: "folder", disabled: props.readOnly, onSelect: () => setDialog({ kind: "move", assetIds: targets, folderIds: [] }) },
      ...(props.timeline ? [{ type: "separator" as const }, { id: "overlay", label: t("Add as overlay"), icon: "plus" as const, onSelect: () => props.timeline!.add([id], { overlay: true }) }, ...(row.usage > 0 ? [{ id: "select-clips", label: t("Select clips in timeline"), icon: "film" as const, onSelect: () => props.timeline!.selectClips(id) }] : [])] : []),
      { type: "separator" },
      { id: "relink", label: t("Relink…"), icon: "link", disabled: props.readOnly, onSelect: () => void relink(id) },
      ...(engine?.mediaState(doc.metadata.id, id)?.state === "failed" || engine?.mediaState(doc.metadata.id, id)?.state === "not-uploaded" ? [{ id: "retry-download", label: t("Retry"), icon: "refresh" as const, onSelect: () => { const transfer = engine.mediaState(doc.metadata.id, id); if (transfer) engine.resumeTransfer(transfer.id); } }] : []),
      ...proxyItems,
      { id: "export", label: t("Export original files"), icon: "download", onSelect: () => void exportOriginals(targets) },
      { type: "separator" },
      { id: "delete", label: targets.length > 1 ? t("Delete {n} items", { n: targets.length }) : t("Delete"), icon: "trash", danger: true, shortcut: "list.delete", disabled: props.readOnly, onSelect: () => remove(targets) },
    ];
  };
  // What a tile does, as of this render (see `sameTile`): the tiles read it when they are pressed, not when they are drawn.
  tileCalls.current = {
    press, double: (id) => { props.timeline?.add([id]); }, longPress: (id) => { if (theme.touch) { setSelecting(true); setSelected((current) => select.toggle(current, id)); } }, key: (id, event) => key(id)(event),
    add: (id) => { props.timeline?.add(selected.ids.includes(id) ? displayed.filter((entry) => selected.ids.includes(entry)) : [id]); }, retryProxy: (id) => { void session.createProxy(id); }, retryDownload: (id) => { const transfer = engine?.mediaState(doc.metadata.id, id); if (transfer) engine?.resumeTransfer(transfer.id); }, remove: (id) => remove([id]),
    dragPayload: (id) => JSON.stringify({ media: { assetIds: actionTargets(selected, id), folderIds: [] } }), menuOf,
  };
  const folderMenu = (entry: LibraryFolder): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "folder", onSelect: () => setFolderId(entry.id) },
    { id: "rename", label: t("Rename"), icon: "pencil", disabled: props.readOnly, onSelect: () => setDialog({ kind: "folder", folder: entry }) },
    { id: "move", label: t("Move to…"), icon: "arrow-r", disabled: props.readOnly, onSelect: () => setDialog({ kind: "move", assetIds: [], folderIds: [entry.id] }) },
    { type: "separator" }, { id: "delete", label: t("Delete folder"), icon: "trash", danger: true, disabled: props.readOnly, onSelect: () => setDialog({ kind: "delete-folder", folder: entry }) },
  ];

  // ── Menus ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const toggle = <K extends "types" | "sources" | "statuses">(field: K, value: LibraryFilters[K][number]) => setFilters((current) => ({ ...current, [field]: (current[field] as string[]).includes(value) ? (current[field] as string[]).filter((entry) => entry !== value) : [...current[field], value] }));
  const optionItems: MenuItem[] = [
    { type: "caption", label: t("Sort by") },
    ...(Object.keys(SORT_LABELS) as SortKey[]).map((entry): MenuItem => ({ id: `sort-${entry}`, label: sort.key === entry ? `${t(SORT_LABELS[entry])} ${sort.direction === "asc" ? "↑" : "↓"}` : t(SORT_LABELS[entry]), checked: sort.key === entry, onSelect: () => { const next = chooseSort(sort, entry); setStoredSort({ key: next.key, order: next.direction }); } })),
    { type: "separator" }, { type: "caption", label: t("Filter") },
    { id: "f-type", label: t("Type"), submenu: (["video", "image", "audio"] as const).map((value) => ({ id: value, label: t(FILTER_LABELS.type[value]), checked: filters.types.includes(value), onSelect: () => toggle("types", value) })) },
    { id: "f-usage", label: t("Usage"), submenu: (["used", "unused"] as const).map((value) => ({ id: value, label: t(FILTER_LABELS.usage[value]), checked: filters.usage === value, onSelect: () => setFilters((current) => ({ ...current, usage: current.usage === value ? null : value })) })) },
    { id: "f-source", label: t("Source"), submenu: (Object.keys(FILTER_LABELS.source) as SourceFilter[]).map((value) => ({ id: value, label: t(FILTER_LABELS.source[value]), checked: filters.sources.includes(value), onSelect: () => toggle("sources", value) })) },
    { id: "f-status", label: t("Status"), submenu: (Object.keys(FILTER_LABELS.status) as StatusFilter[]).map((value) => ({ id: value, label: t(FILTER_LABELS.status[value]), checked: filters.statuses.includes(value), onSelect: () => toggle("statuses", value) })) },
    ...(activeFilterCount(filters) > 0 ? [{ type: "separator" as const }, { id: "clear", label: t("Clear filters"), icon: "x" as const, onSelect: () => setFilters(NO_FILTERS) }] : []),
    { type: "separator" },
    // Content labels come from the host's vision model: without a host the action states what it needs.
    { id: "index", label: t("Index media for search"), icon: "search", disabled: true, description: t("Connect a host to index media for search") },
  ];
  const connectorItem = (connector: ConnectorId): MenuItem => {
    const item = connectorMenuItem(connector, null, "editor");
    return { id: connector, label: t(CONNECTORS[connector].label), icon: "cloud", disabled: !item.enabled, description: item.hint ? say(item.hint) : undefined };
  };
  const sources = recordingSources(session.platform).filter((source) => captureSupported(source));
  const importItems: MenuItem[] = [
    { id: "files", label: t("Import files…"), icon: "download", onSelect: () => void pick() },
    { id: "url", label: t("Import from URL…"), icon: "globe", onSelect: () => setDialog({ kind: "url" }) },
    ...(sources.length > 0 ? [{ id: "record", label: t("Record"), icon: "record" as const, submenu: sources.map((source): MenuItem => ({ id: source, label: t(source === "camera" ? "Camera" : source === "screen" ? "Screen" : "Voice"), icon: source === "camera" ? "camera" : source === "screen" ? "monitor" : "mic", onSelect: () => setDialog({ kind: "record", source }) })) }] : []),
    { type: "separator" },
    connectorItem("google-drive"), connectorItem("dropbox"),
    { id: "devices", label: t("From devices"), icon: "phone", disabled: true, description: t("Connect a host to import from your devices") },
  ];
  const chips: ReactNode[] = [
    ...filters.types.map((value) => <FilterChip key={`t-${value}`} field={t("Type")} value={t(FILTER_LABELS.type[value])} onRemove={() => toggle("types", value)} />),
    ...(filters.usage ? [<FilterChip key="usage" field={t("Usage")} value={t(FILTER_LABELS.usage[filters.usage])} onRemove={() => setFilters((current) => ({ ...current, usage: null }))} />] : []),
    ...filters.sources.map((value) => <FilterChip key={`s-${value}`} field={t("Source")} value={t(FILTER_LABELS.source[value])} onRemove={() => toggle("sources", value)} />),
    ...filters.statuses.map((value) => <FilterChip key={`st-${value}`} field={t("Status")} value={t(FILTER_LABELS.status[value])} onRemove={() => toggle("statuses", value)} />),
  ];
  const crumbs: Crumb[] = [{ id: "root", label: t("Project media"), onPress: () => setFolderId(null) }, ...listing.breadcrumb.map((entry) => ({ id: entry.id, label: entry.name, onPress: () => setFolderId(entry.id) }))];
  const canNest = canCreateFolderIn(doc, folder);
  const footer = state.usage ? storageFooter(state.usage.used, state.usage.available) : null;
  const banner = offlineBanner(offline.length);
  const stock = stockSectionState({ enabledSources: 0, gatewayConnected: gate.connected, role: "editor" });
  const newFolder = <IconButton icon="folder" size="xs" label={t("New folder")} disabled={!canNest || props.readOnly} noTooltip={!canNest} onPress={() => setDialog({ kind: "folder" })} />;
  const counts = useMemo(() => { const map = new Map<string, number>(); for (const asset of doc.media.assets) if (asset.folderId && !asset.ephemeral && asset.kind !== "derived") map.set(asset.folderId, (map.get(asset.folderId) ?? 0) + 1); return map; }, [doc]);

  const infoAsset = info ? doc.media.assets.find((asset) => asset.id === info) : undefined;

  return (
    <View ref={root} testID="media-panel" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.color("bg/app") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], paddingTop: space[2] }}>
        <SearchField label={t("Search media")} placeholder={t("Search media…")} size="sm" value={input} onChangeText={setInput} onSearch={setQuery} debounce={SEARCH_DEBOUNCE_MS} resultCount={query ? listing.rows.length : null} />
        <IconButton icon={viewMode === "grid" ? "list" : "grid"} size="xs" label={viewMode === "grid" ? t("List view") : t("Grid view")} testID="media-view" onPress={() => setViewMode(viewMode === "grid" ? "list" : "grid")} />
        <IconButton ref={options} icon="sliders" size="xs" label={t("Sort and filter")} badge={activeFilterCount(filters) || undefined} expanded={optionsOpen} onPress={() => setOptionsOpen(true)} />
        <Menu open={optionsOpen} anchor={options} items={optionItems} label={t("Sort and filter")} align="end" onClose={() => setOptionsOpen(false)} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], paddingVertical: space[2] }}>
        <Tabs id="media-scope" variant="pill" size="xs" label={t("Media")} value={tab} onChange={(id) => setTab(id as "project" | "library")} items={[{ id: "project", label: t("Project") }, { id: "library", label: t("Library") }]} />
        <View style={{ flex: 1 }} />
        {tab === "project" ? <>{canNest ? newFolder : <Tooltip label={t("Folders can be nested up to 4 levels")}>{newFolder}</Tooltip>}<Button ref={importRef} kind="strong" size="xs" icon="plus" label={t("Import")} disabled={props.readOnly} expanded={importOpen} testID="media-import" onPress={() => setImportOpen(true)} /><Menu open={importOpen} anchor={importRef} items={importItems} label={t("Import")} align="end" onClose={() => setImportOpen(false)} /></> : null}
      </View>
      {tab === "library" ? (
        <View testID="media-stock" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
          <Icon name="film" size={32} color="text/secondary" />
          {stock.state === "connect" ? <Text variant="body-medium" align="center">{say(stock.message)}</Text> : null}
          <Text color="text/secondary" align="center">{t("Stock video and images are searched through a connected host.")}</Text>
          {gate.connected ? null : <Button size="sm" label={t("Connect a host")} onPress={() => gate.onRequiresHost(t("Stock media"))} />}
        </View>
      ) : (
        <>
          {chips.length > 0 ? <View testID="media-filters" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], paddingBottom: space[2] }}>{chips}<Text variant="meta" color="accent/text" onPress={() => setFilters(NO_FILTERS)}>{t("Clear filters")}</Text></View> : null}
          {listing.breadcrumb.length > 0 && !query ? <View style={{ paddingHorizontal: space[3], paddingBottom: space[1.5] }}><BreadcrumbDrop crumbs={crumbs} onDrop={moveInto} /></View> : null}
          {banner ? (
            <View role="status" testID="media-offline-banner" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginHorizontal: space[3], marginBottom: space[2], paddingHorizontal: space[2], paddingVertical: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("warning/subtle") }}>
              <Icon name="warn" size={16} color="warning/icon" />
              <Text variant="meta" style={{ flex: 1, minWidth: 120 }}>{say(banner)}</Text>
              <Text variant="meta" color="accent/text" onPress={() => { setFilters({ ...NO_FILTERS, statuses: ["offline"] }); if (offline.length === 1) void relink(offline[0].id); }}>{t("Relink…")}</Text>
            </View>
          ) : null}
          {state.recovered.map((entry) => (
            <View key={entry.id} role="status" testID="media-recovered" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginHorizontal: space[3], marginBottom: space[2], paddingHorizontal: space[2], paddingVertical: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("accent/subtle") }}>
              <Icon name="record" size={16} color="accent/text" />
              <Text variant="meta" style={{ flex: 1, minWidth: 120 }}>{t("Recovered recording")} · {binarySize(entry.bytes)}</Text>
              <Text variant="meta" color="accent/text" onPress={() => void session.recoverRecording(entry.id).then((result) => { if (result) report(result); })}>{t("Add to library")}</Text>
              <Text variant="meta" color="text/secondary" onPress={() => void session.discardRecording(entry.id)}>{t("Discard")}</Text>
            </View>
          ))}
          <View ref={body} style={{ flex: 1, minHeight: 0 }}>
            {listing.empty ? (
              <Tap role="button" label={t("Drag and drop videos, photos, and audio files here")} testID="media-dropzone" disabled={props.readOnly} onPress={() => void pick()}
                style={(pressed) => ({ flex: 1, margin: space[3], marginTop: 0, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4], borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.color(dragOver ? "accent" : "border/strong"), backgroundColor: theme.color(dragOver ? "accent/subtle" : pressed.hovered ? "bg/hover" : "bg/app") })}>
                <Icon name={state.importing ? "clock" : "download"} size={32} color="text/secondary" />
                <Text align="center" color="text/secondary" live="polite">{state.importing ? t("Processing your files ({percent} %)", { percent: state.importing.percent }) : t("Drag and drop videos, photos, and audio files here")}</Text>
                {state.importing ? <View style={{ width: 160 }}><ProgressBar value={state.importing.percent / 100} label={t("Processing your files ({percent} %)", { percent: state.importing.percent })} /></View> : null}
              </Tap>
            ) : listing.noResults ? (
              <View testID="media-no-results" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
                <Icon name="search" size={32} color="text/secondary" />
                <Text variant="body-medium">{t("No media found")}</Text>
                {query ? <Button size="sm" label={t("Clear search")} onPress={() => { setInput(""); setQuery(""); }} /> : null}
                {activeFilterCount(filters) > 0 ? <Button size="sm" kind="ghost" label={t("Clear filters")} onPress={() => setFilters(NO_FILTERS)} /> : null}
              </View>
            ) : (
              <ScrollView horizontal={viewMode === "list"} contentContainerStyle={viewMode === "list" ? { paddingHorizontal: space[3] } : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={{ paddingHorizontal: viewMode === "list" ? 0 : space[3], paddingBottom: space[3], gap: space[2] }}>
                  {listing.folders.length > 0 ? <View style={{ gap: space[1.5] }}>{listing.folders.map((entry) => <FolderTile key={entry.id} folder={entry} count={counts.get(entry.id) ?? 0} menu={folderMenu(entry)} onOpen={() => setFolderId(entry.id)} onDrop={(payload) => moveInto(payload, entry.id)} />)}</View> : null}
                  {viewMode === "list" && listing.rows.length > 0 ? (
                    <View role="row" style={{ flexDirection: "row", gap: space[2], paddingHorizontal: space[1.5], height: 24, alignItems: "center" }}>
                      <View style={{ width: 43 }} />
                      {([["Name", 150], ["Type", 52], ["Duration", 56], ["Resolution", 84], ["Size", 72], ["Date added", 132]] as const).map(([label, column]) => <Text key={label} variant="caption" color="text/secondary" style={{ width: column }}>{t(label)}</Text>)}
                    </View>
                  ) : null}
                  <View role="group" aria-label={t("Media")} testID="media-items" style={viewMode === "list" ? { gap: 1 } : { flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                    {listing.rows.map((row, index) => (
                      <AssetTile key={row.asset.id} row={row} session={session} document={doc} width={tileWidth} list={viewMode === "list"} selected={selected.ids.includes(row.asset.id)} selecting={selecting} highlighted={highlight === row.asset.id} download={failedDownloads.get(row.asset.id)}
                        progress={state.proxyProgress[row.asset.id]} tabbable={selected.anchor ? selected.anchor === row.asset.id : index === 0} canAdd={Boolean(props.timeline) && !props.onPick}
                        thumb={row.asset.type === "audio" ? null : session.thumbnail(row.asset.id)} calls={tileCalls} />
                    ))}
                  </View>
                </ScrollView>
              </ScrollView>
            )}
            {marquee ? <MarqueeBox box={marquee} container={body.current} /> : null}
            {dragOver && !listing.empty ? (
              <View pointerEvents="none" testID="media-drop-overlay" style={{ position: "absolute", top: 0, right: space[2], bottom: space[2], left: space[2], alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4], borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: theme.color("accent"), backgroundColor: theme.color("accent/subtle") }}>
                <Icon name="download" size={32} color="accent/text" />
                <Text align="center" color="accent/text">{t("Drag and drop videos, photos, and audio files here")}</Text>
              </View>
            ) : null}
          </View>
          {selecting ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], height: 40, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
              <Text variant="meta" style={{ flex: 1 }}>{t("{n} selected", { n: selected.ids.length })}</Text>
              {props.onPick ? <Button size="xs" kind="strong" label={t("Add ({n})", { n: selected.ids.length })} disabled={selected.ids.length === 0} onPress={() => { props.onPick!(selected.ids); setSelected(EMPTY_SELECTION); }} /> : null}
              <IconButton icon="trash" size="xs" label={t("Delete")} disabled={selected.ids.length === 0 || props.readOnly} onPress={() => remove(selected.ids)} />
              <IconButton icon="x" size="xs" label={t("Cancel")} onPress={() => setSelected(EMPTY_SELECTION)} />
            </View>
          ) : null}
          {footer ? (
            <View testID="media-footer" style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], height: 24, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
              <Text variant="caption" color={footer.warning ? "warning/text" : "text/secondary"} numberOfLines={1}>{footer.available === null ? t("{used} used", { used: footer.used }) : t("{used} used · {available} available", { used: footer.used, available: footer.available })}</Text>
            </View>
          ) : null}
        </>
      )}
      {/* The Info panel covers the library, which stays mounted with its drop zone and selection. */}
      {infoAsset ? <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}><AssetInfo session={session} document={doc} asset={infoAsset} commit={commit} readOnly={props.readOnly} usage={session.usageCounts().get(infoAsset.id) ?? 0} onClose={() => setInfo(null)} onRelink={() => void relink(infoAsset.id)} /></View> : null}
      {dialog?.kind === "rename" ? <RenameAssetDialog document={doc} assetId={dialog.assetId} commit={commit} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "folder" ? <FolderDialog document={doc} parentId={dialog.folder ? dialog.folder.parentId : folder} folder={dialog.folder} commit={commit} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "move" ? <MoveToDialog document={doc} assetIds={dialog.assetIds} folderIds={dialog.folderIds} commit={commit} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "delete" ? (() => {
        const impact = removalImpact(doc, dialog.assetIds);
        const text = impact.assets === 1 ? (impact.clips === 1 ? t("1 asset is used by 1 clip. Deleting them also removes those clips.") : t("1 asset is used by {m} clips. Deleting them also removes those clips.", { m: impact.clips }))
          : impact.clips === 1 ? t("{n} assets are used by 1 clip. Deleting them also removes those clips.", { n: impact.assets }) : t("{n} assets are used by {m} clips. Deleting them also removes those clips.", { n: impact.assets, m: impact.clips });
        return <ConfirmDialog open title={impact.assets === 1 ? t("Delete media?") : t("Delete {n} items?", { n: impact.assets })} description={text} confirmLabel={t("Delete")} onClose={() => setDialog(null)} onConfirm={() => { session.remove(dialog.assetIds); setSelected(EMPTY_SELECTION); setDialog(null); }} />;
      })() : null}
      {dialog?.kind === "delete-folder" ? <ConfirmDialog open title={t("Delete folder '{name}'?", { name: dialog.folder.name })} description={t("Its media moves to the parent folder. No media is deleted.")} confirmLabel={t("Delete folder")} onClose={() => setDialog(null)}
        onConfirm={() => { const target = dialog.folder; setDialog(null); if (commit((document, ctx) => deleteFolderCommand(document, ctx, target.id)) && folder === target.id) setFolderId(target.parentId); }} /> : null}
      {dialog?.kind === "url" ? <UrlImportDialog session={session} onClose={() => setDialog(null)} onDone={report} /> : null}
      {dialog?.kind === "relink" ? <RelinkDialog document={doc} assetId={dialog.assetId} check={dialog.check} onClose={() => setDialog(null)} onDone={() => { setDialog(null); toast.show({ kind: "success", message: t("Media relinked") }); }} /> : null}
      {dialog?.kind === "record" ? <Recorder session={session} source={dialog.source} onClose={() => setDialog(null)} onDone={report} /> : null}
      {dialog?.kind === "quota" ? (
        <Modal title={t("Not enough storage")} width={480} onClose={() => setDialog(null)} footer={<>
          {dialog.notice.actions?.filter((action) => action.code === "media.quota.empty-trash").map((action) => <Button key="trash" kind="ghost" label={say(action)} onPress={() => { setDialog(null); router.push("/projects/trash" as never); }} />)}
          <View style={{ flex: 1 }} />
          <Button kind="ghost" label={t("Close")} onPress={() => setDialog(null)} />
          <Button kind="strong" label={t("Manage storage")} onPress={() => { setDialog(null); router.push("/settings/storage" as never); }} />
        </>}>
          <Text testID="quota-message">{say(dialog.notice.message)}</Text>
        </Modal>
      ) : null}
    </View>
  );
}

function MarqueeBox(props: { box: Box; container: unknown }) {
  const theme = useTheme();
  const origin = boxOf(props.container);
  if (!origin) return null;
  const left = Math.min(props.box.x, props.box.x + props.box.width) - origin.x, top = Math.min(props.box.y, props.box.y + props.box.height) - origin.y;
  return <View pointerEvents="none" testID="media-marquee" style={{ position: "absolute", left, top, width: Math.abs(props.box.width), height: Math.abs(props.box.height), borderWidth: 1, borderColor: theme.color("accent"), backgroundColor: theme.color("accent/subtle"), opacity: 0.6 }} />;
}
/** The breadcrumb of the current folder; a drop on a segment moves the dragged assets or folders there. */
function BreadcrumbDrop(props: { crumbs: Crumb[]; onDrop(payload: string, target: string | null): void }) {
  const drop = useRef(props.onDrop);
  drop.current = props.onDrop;
  const unbind = useRef(new Map<string, () => void>());
  useEffect(() => () => { for (const stop of unbind.current.values()) stop(); }, []);
  const segments = props.crumbs.map((crumb) => ({
    ...crumb,
    onNode: (node: View | null) => {
      unbind.current.get(crumb.id)?.(); unbind.current.delete(crumb.id);
      if (node) unbind.current.set(crumb.id, bindDrop(node, { accept: (types) => types.includes("application/x-jagentchill"), onDrop: (data) => drop.current(data.text, crumb.id === "root" ? null : crumb.id) }));
    },
  }));
  return <Breadcrumb segments={segments} />;
}
