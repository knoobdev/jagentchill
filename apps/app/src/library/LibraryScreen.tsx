import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, ScrollView, View } from "react-native";
import { LIBRARY_CATEGORIES, PREFS, type LibraryCategory, formatDay } from "@jagentchill/app-core";
import type { StoragePort } from "@jagentchill/storage";
import {
  AddFilterChip, Badge, Button, Callout, ConfirmDialog, ContextMenu, EmptyState, FilterChip, FirstUseState, FormDialog, Icon, IconButton, Input, Menu, NoResultsState, SearchField, Segmented, Select, LoadingSkeleton, Skeleton, Tabs, Tap, Text,
  radius, space, useTheme, useToast, type Crumb, type IconName, type MenuItem,
} from "@jagentchill/ui";
import { playSound, registerFontFaces, type SoundPreview } from "../editor/content-dom";
import { objectUrl, releaseUrl } from "../editor/dom";
import { BUNDLED_FACES } from "../editor/fonts.gen";
import { useT } from "../locale";
import { pickFiles } from "../platform/store";
import { Screen } from "../shell/Shell";
import { setPref, usePref } from "../state";
import { useLibraryCounts, useLibraryListing } from "./hooks";
import { nativeLibraryActionUnavailable } from "./action-availability";
import { BrandKitPanel } from "../templates/BrandKit";
import { PacksTab } from "../templates/PacksTab";
import { TemplatesTab } from "../templates/TemplatesTab";
import { imageSize } from "./platform";
import {
  committedItemName, createFolder, deleteFolder, deleteItem, importFiles, isItemCategory, itemBytes, LIBRARY_ACCEPT, LIBRARY_VIEW, lutSwatches, mimeOfFile, moveItem, NAME_MAX, renameFolder, renameItem, shownItems, sizeLabel,
  type ItemCategory, type LibraryShelf, type LibraryItem, type LibrarySortKey, type SourceFilter,
} from "./store";

const ICON: Record<LibraryCategory, IconName> = { templates: "template", packs: "box", fonts: "type", luts: "palette", sounds: "music", stickers: "smile", "brand-kits": "star" };
// The first-use state of each category: what it will hold, and — where this build can keep such items — how to add one.
const FIRST_USE: Record<LibraryCategory, { title: string; description: string }> = {
  templates: { title: "No templates yet", description: "Templates saved from a project are kept here and can start a new project." },
  packs: { title: "No preset packs yet", description: "Preset packs bundle effects, filters and text styles to reuse across projects." },
  fonts: { title: "No fonts yet", description: "The fonts of the text and caption tools are listed here." },
  luts: { title: "No imported LUTs yet", description: "Import .cube or .3dl files to use them in the Adjust tab of every project." },
  sounds: { title: "No saved sounds yet", description: "Import music and sound effects to add them to any project from its Audio tab." },
  stickers: { title: "No imported stickers yet", description: "Import PNG, JPEG, WebP, SVG, GIF or APNG files to use them as stickers in every project." },
  "brand-kits": { title: "No brand kits yet", description: "A brand kit keeps the logos, colours and fonts of a brand together." },
};
const SORT_LABEL: Record<LibrarySortKey, string> = { name: "Name", added: "Date added", size: "Size" };
const SOURCE_LABEL: Record<SourceFilter, string> = { imported: "Imported", "built-in": "Built-in" };
// A family whose glyphs are another script's is shown by a letter of that script; its file is large and is fetched only when a project uses it.
const SCRIPT_SAMPLE: Record<string, string> = { "Noto Sans JP": "あ", "Noto Sans SC": "汉", "Noto Sans KR": "한", "Noto Naskh Arabic": "ع", "Noto Sans Hebrew": "א", "Noto Sans Thai": "ก", "Noto Sans Devanagari": "अ", "Noto Color Emoji": "😀" };
const PAGE = 120;

/** A blob URL of an imported item's file while the tile that shows it is mounted. */
function useItemUrl(storage: StoragePort | null, item: LibraryItem, wanted: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const file = item.stored?.file ?? null;
  useEffect(() => {
    if (!storage || !item.stored || !wanted) return;
    let made: string | null = null, cancelled = false;
    void itemBytes(storage, item.stored).then((bytes) => { if (cancelled || !bytes) return; made = objectUrl(bytes, mimeOfFile(item.stored!.file)); setUrl(made); }).catch(() => undefined);
    return () => { cancelled = true; if (made) releaseUrl(made); setUrl(null); };
  }, [storage, file, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** What a tile shows of its item: the sticker itself, a font's own letters, a LUT's rendering of reference colours, a sound's play button. */
function Thumb(props: { item: LibraryItem; storage: StoragePort | null; height: number; playing: boolean; onPlay(): void }) {
  const t = useT();
  const theme = useTheme();
  const { item } = props;
  const url = useItemUrl(props.storage, item, item.category === "stickers");
  const [swatches, setSwatches] = useState<string[] | null>(() => (item.category === "luts" && item.builtIn ? lutSwatches(item) : null));
  useEffect(() => {
    if (item.category !== "luts" || item.builtIn || !props.storage || !item.stored) return;
    let cancelled = false;
    void itemBytes(props.storage, item.stored).then((bytes) => { if (!cancelled) setSwatches(lutSwatches(item, bytes)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [props.storage, item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = { height: props.height, borderRadius: radius.md, overflow: "hidden" as const, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: theme.color("bg/subtle"), borderWidth: 1, borderColor: theme.color("border/hairline") };
  if (item.category === "fonts") {
    const sample = SCRIPT_SAMPLE[item.family ?? ""];
    return <View style={frame}><Text style={[{ fontSize: props.height * 0.42, lineHeight: props.height * 0.6 }, (sample ? {} : { fontFamily: `"JC ${item.family}", system-ui` }) as object]}>{sample ?? "Aa"}</Text></View>;
  }
  if (item.category === "luts") {
    return <View style={[frame, { flexDirection: "row", alignItems: "stretch" }]}>{swatches ? swatches.map((colour, index) => <View key={index} style={{ flex: 1, backgroundColor: colour }} />) : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name="palette" size={24} color="text/secondary" /></View>}</View>;
  }
  if (item.category === "stickers") return <View style={frame}>{url ? <Image source={{ uri: url }} accessibilityLabel="" resizeMode="contain" style={{ width: "80%", height: "80%" }} /> : <Icon name="smile" size={24} color="text/secondary" />}</View>;
  return (
    <View style={frame}>
      <IconButton icon={props.playing ? "pause" : "play"} variant="outline" label={t(props.playing ? "Pause {name}" : "Play {name}", { name: item.name })} testID="library-play" on={props.playing} toggle onPress={props.onPlay} />
    </View>
  );
}

type Shared = { storage: StoragePort | null; menu(item: LibraryItem): MenuItem[]; playing: string | null; onPlay(item: LibraryItem): void };
const metaOf = (t: ReturnType<typeof useT>, item: LibraryItem): string => item.category === "fonts" ? (item.faces === 1 ? t("1 style") : t("{n} styles", { n: item.faces ?? 0 })) : item.builtIn ? t("Built-in") : sizeLabel(item.size);

function ItemMenu(props: { item: LibraryItem; items: MenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const more = useRef<View>(null);
  if (props.items.length === 0) return null;
  return (
    <>
      <IconButton ref={more} icon="more" size="xs" compactVisual label={t("Actions for {name}", { name: props.item.name })} testID="library-item-menu" expanded={open} onPress={() => setOpen(true)} />
      <Menu open={open} anchor={more} items={props.items} label={props.item.name} align="end" onClose={() => setOpen(false)} />
    </>
  );
}

function ItemTile(props: Shared & { item: LibraryItem }) {
  const t = useT();
  const theme = useTheme();
  const { item } = props, menu = props.menu(item);
  const tile = (
    <View testID="library-item" {...({ dataSet: { name: item.name, source: item.builtIn ? "built-in" : "imported" } } as object)} style={{ gap: space[1] }}>
      <Thumb item={item} storage={props.storage} height={98} playing={props.playing === item.id} onPlay={() => props.onPlay(item)} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], minHeight: theme.touch ? 32 : 20 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} testID="library-item-name">{item.builtIn && item.category === "luts" ? t(item.name) : item.name}</Text>
          <Text variant="meta" color="text/secondary" numberOfLines={1}>{metaOf(t, item)}</Text>
        </View>
        <ItemMenu item={item} items={menu} />
      </View>
    </View>
  );
  return menu.length === 0 || theme.touch ? tile : <ContextMenu items={menu} label={item.name}>{tile}</ContextMenu>;
}

function ItemRow(props: Shared & { item: LibraryItem }) {
  const t = useT();
  const theme = useTheme();
  const { item } = props, menu = props.menu(item);
  const row = (
    <View testID="library-item" {...({ dataSet: { name: item.name, source: item.builtIn ? "built-in" : "imported" } } as object)} style={{ minHeight: theme.touch ? 48 : 40, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      <View style={{ width: 48 }}><Thumb item={item} storage={props.storage} height={32} playing={props.playing === item.id} onPlay={() => props.onPlay(item)} /></View>
      <Text numberOfLines={1} testID="library-item-name" style={{ flex: 1, minWidth: 0 }}>{item.builtIn && item.category === "luts" ? t(item.name) : item.name}</Text>
      {item.builtIn ? <Badge label={t("Built-in")} /> : null}
      {theme.compact ? null : <Text variant="meta" color="text/secondary" tabular style={{ width: 90 }}>{item.category === "fonts" ? metaOf(t, item) : item.builtIn ? "" : sizeLabel(item.size)}</Text>}
      {theme.compact ? null : <Text variant="meta" color="text/secondary" tabular style={{ width: 110 }}>{item.builtIn ? "" : formatDay(item.addedAt_ms)}</Text>}
      <View style={{ width: 28, alignItems: "flex-end" }}><ItemMenu item={item} items={menu} /></View>
    </View>
  );
  return menu.length === 0 || theme.touch ? row : <ContextMenu items={menu} label={item.name}>{row}</ContextMenu>;
}

function FolderCard(props: { folder: LibraryShelf; count: number; menu: MenuItem[]; onOpen(): void }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const more = useRef<View>(null);
  return (
    <ContextMenu items={props.menu} label={props.folder.name} disabled={theme.touch}>
      <View testID="library-folder" style={{ flexDirection: "row", alignItems: "center", width: theme.compact ? undefined : 180, borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/app") }}>
        <Tap role="button" label={t("Folder {name}, {n} items", { name: props.folder.name, n: props.count })} onPress={props.onOpen}
          style={(state) => ({ flex: 1, minWidth: 0, height: theme.touch ? 44 : 40, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[3], borderRadius: radius.md, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
          <Icon name="folder" size={16} color="text/secondary" />
          <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{props.folder.name}</Text>
          <Text variant="meta" color="text/secondary" tabular>{props.count}</Text>
        </Tap>
        <IconButton ref={more} icon="more" size="xs" compactVisual label={t("Actions for {name}", { name: props.folder.name })} testID="library-folder-menu" expanded={open} onPress={() => setOpen(true)} />
        <Menu open={open} anchor={more} items={props.menu} label={props.folder.name} align="end" onClose={() => setOpen(false)} />
      </View>
    </ContextMenu>
  );
}

type Naming = { kind: "item"; item: LibraryItem; draft: string } | { kind: "folder"; folder: LibraryShelf; draft: string } | { kind: "new-folder"; draft: string };

/**
 * The Library: the reusable items of this device, one category at a time. The sidebar lists the categories; the screen
 * repeats them as pill tabs only when that list is not on screen. Works without a host.
 */
export function LibraryScreen(props: { category: LibraryCategory }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [view, setView] = usePref(LIBRARY_VIEW);
  const category: ItemCategory | null = isItemCategory(props.category) ? props.category : null;
  const { storage, listing, failed, retry } = useLibraryListing(category);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [removing, setRemoving] = useState<LibraryItem | LibraryShelf | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [playing, setPlaying] = useState<string | null>(null);
  const preview = useRef<{ sound: SoundPreview; url: string } | null>(null);
  const filterRef = useRef<View>(null);
  // Owner (2026-10-07): the categories are always tabs inside the screen, never a list in the sidebar.
  const tabs = true;
  const counts = useLibraryCounts(true);
  const current = LIBRARY_CATEGORIES.find((entry) => entry.id === props.category)!;
  const stop = () => { const now = preview.current; preview.current = null; if (now) { now.sound.stop(); releaseUrl(now.url); } setPlaying(null); };
  useEffect(() => setPref(PREFS.libraryCategory, props.category), [props.category]);
  // A category starts unfiltered, at its top level.
  useEffect(() => { setQuery(""); setSource(null); setFolderId(null); setShown(PAGE); stop(); }, [props.category]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const now = preview.current; if (now) { now.sound.stop(); releaseUrl(now.url); } }, []);
  // The families that are loaded with the engine are drawn in their own letters.
  useEffect(() => { if (props.category === "fonts") registerFontFaces(BUNDLED_FACES.filter((face) => face.load === "engine" && face.weight === 400 && face.style === "normal")); }, [props.category]);

  const items = listing?.items ?? [], folders = listing?.folders ?? [];
  const folder = folders.find((entry) => entry.id === folderId) ?? null;
  useEffect(() => { if (folderId !== null && listing && !folder) setFolderId(null); }, [folderId, listing, folder]);
  const displayed = useMemo(() => shownItems(items, { folderId: folder?.id ?? null, source, query, sortKey: view.sortKey, order: view.order }), [items, folder, source, query, view.sortKey, view.order]);
  const imported = items.filter((item) => !item.builtIn).length;
  const hasBuiltIns = items.some((item) => item.builtIn);
  // Fonts ship with the app and this screen has no font importer, so Fonts alone gets no Import action, no New folder
  // and no inline import hint (coordinator decision, library-empty-r2 finding 1) — do not add a font import here.
  const canImportHere = category !== null && category !== "fonts";

  const play = (item: LibraryItem) => {
    const was = playing === item.id;
    stop();
    if (was || !storage || !item.stored) return;
    const unavailable = nativeLibraryActionUnavailable(Platform.OS, "preview");
    if (unavailable) { toast.show({ kind: "warning", message: t(unavailable) }); return; }
    setPlaying(item.id);
    void itemBytes(storage, item.stored).then((bytes) => {
      if (!bytes) { setPlaying(null); toast.show({ kind: "warning", message: t("Preview unavailable") }); return; }
      const url = objectUrl(bytes, mimeOfFile(item.stored!.file));
      const sound = playSound(url, 1, { onProgress: () => undefined, onEnd: (failed) => { if (preview.current?.url === url) { preview.current = null; releaseUrl(url); setPlaying(null); } if (failed) toast.show({ kind: "warning", message: t("Preview unavailable") }); } });
      preview.current = { sound, url };
    }).catch(() => setPlaying(null));
  };
  const runImport = async () => {
    if (!storage) return;
    const unavailable = nativeLibraryActionUnavailable(Platform.OS, "import");
    if (unavailable) { toast.show({ kind: "warning", message: t(unavailable) }); return; }
    const files = await pickFiles(LIBRARY_ACCEPT, true);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const outcome = await importFiles(storage, files, { imageSize }, category !== null && category !== "fonts" ? folder?.id ?? null : null);
      for (const entry of outcome.rejected) toast.show({ kind: "warning", message: `${entry.name}: ${t(entry.reason, entry.params)}` });
      if (outcome.existing.length > 0) toast.show({ kind: "info", message: outcome.existing.length === 1 ? t("{name} is already in the Library", { name: outcome.existing[0] }) : t("{n} files are already in the Library", { n: outcome.existing.length }) });
      if (outcome.added.length > 0) {
        toast.show({ kind: "success", message: outcome.added.length === 1 ? t("Added {name} to the Library", { name: outcome.added[0].name }) : t("Added {n} items to the Library", { n: outcome.added.length }) });
        // The files of another category are shown where they went.
        const first = outcome.added[0].category;
        if (!outcome.added.some((entry) => entry.category === props.category)) router.push(`/library/${first}` as never);
      }
    } finally { setBusy(false); }
  };
  const itemMenu = (item: LibraryItem): MenuItem[] => item.builtIn || !storage ? [] : [
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => setNaming({ kind: "item", item, draft: item.name }) },
    { id: "move", label: t("Move to folder"), icon: "folder", submenu: [
      { id: "root", label: t(current.label), icon: "folder", checked: item.folderId === null || undefined, onSelect: () => void moveItem(storage, item, null) },
      ...folders.map((entry): MenuItem => ({ id: entry.id, label: entry.name, icon: "folder", checked: item.folderId === entry.id || undefined, onSelect: () => void moveItem(storage, item, entry.id) })),
      { type: "separator" }, { id: "new", label: t("New folder"), icon: "plus", onSelect: () => setNaming({ kind: "new-folder", draft: "" }) },
    ] },
    { type: "separator" }, { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => setRemoving(item) },
  ];
  const folderMenu = (entry: LibraryShelf): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "folder", onSelect: () => setFolderId(entry.id) },
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => setNaming({ kind: "folder", folder: entry, draft: entry.name }) },
    { type: "separator" }, { id: "delete", label: t("Delete folder"), icon: "trash", danger: true, onSelect: () => setRemoving(entry) },
  ];
  const commitName = async () => {
    if (!naming || !storage || !category) return;
    const name = committedItemName(naming.draft);
    if (!name) return;
    setNaming(null);
    if (naming.kind === "item") await renameItem(storage, naming.item, name);
    else if (naming.kind === "folder") await renameFolder(storage, naming.folder.id, name);
    else await createFolder(storage, category, name);
  };
  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target || !storage) return;
    if ("builtIn" in target) { if (playing === target.id) stop(); await deleteItem(storage, target); toast.show({ kind: "info", message: t("Deleted {name}", { name: target.name }) }); }
    else await deleteFolder(storage, target);
  };

  const sortOptions = [
    ...(Object.keys(SORT_LABEL) as LibrarySortKey[]).map((key) => ({ value: key as string, label: key === view.sortKey ? `${t(SORT_LABEL[key])} ${view.order === "asc" ? "↑" : "↓"}` : t(SORT_LABEL[key]), group: t("Sort by") })),
    { value: "asc", label: t("Ascending"), group: t("Order"), icon: view.order === "asc" ? "check" as const : undefined }, { value: "desc", label: t("Descending"), group: t("Order"), icon: view.order === "desc" ? "check" as const : undefined },
  ];
  const chooseSort = (value: string) => setView(value === "asc" || value === "desc" ? { ...view, order: value } : { ...view, sortKey: value as LibrarySortKey });
  const importButton = <Button kind="strong" icon="download" label={t("Import")} testID="library-import" loading={busy} disabled={!storage} onPress={() => void runImport()} />;
  const filterMenu: MenuItem[] = (Object.keys(SOURCE_LABEL) as SourceFilter[]).map((entry) => ({ id: entry, label: t("Source is {value}", { value: t(SOURCE_LABEL[entry]) }), checked: source === entry || undefined, onSelect: () => setSource(entry) }));
  const filtered = source !== null || folder !== null;
  // A category that is not a list of files brings its own screen, toolbar included.
  const own: ReactNode = props.category === "templates" ? <TemplatesTab /> : props.category === "packs" ? <PacksTab /> : props.category === "brand-kits" ? <BrandKitPanel /> : null;
  const toolbar = own ? null : category === null ? <View style={{ flexDirection: "row" }}><View style={{ flex: 1 }} />{importButton}</View> : (
    <View testID="library-toolbar" style={theme.compact ? { gap: space[2] } : { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
      <View style={theme.compact ? { width: "100%" } : { width: 300 }}><SearchField label={t("Search {category}", { category: t(current.label) })} placeholder={t("Search by name…")} value={query} onChangeText={(next) => { setQuery(next); setShown(PAGE); }} debounce={0} /></View>
      {folder ? <FilterChip field={t("Folder")} value={folder.name} onRemove={() => setFolderId(null)} /> : null}
      {source ? <FilterChip field={t("Source")} value={t(SOURCE_LABEL[source])} onRemove={() => setSource(null)} /> : null}
      {/* Where nothing can be imported every item has the same source: there is nothing to filter by. */}
      {!canImportHere ? null : <View ref={filterRef}><AddFilterChip onPress={() => setFilterOpen(true)} /><Menu open={filterOpen} anchor={filterRef} items={filterMenu} label={t("Add filter")} onClose={() => setFilterOpen(false)} /></View>}
      {filtered ? <Button kind="link" size="sm" label={t("Clear filters")} testID="library-clear-filters" onPress={() => { setSource(null); setFolderId(null); }} /> : null}
      {theme.compact ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Select label={t("Sort by")} width={150} options={sortOptions} value={view.sortKey} onChange={chooseSort} />
        <Segmented label={t("View")} size="md" options={[{ value: "grid", label: t("Grid"), icon: "grid", iconOnly: true }, { value: "list", label: t("List"), icon: "list", iconOnly: true }]} value={view.view} onChange={(next) => setView({ ...view, view: next as "grid" | "list" })} />
      </View> : <>
        <View style={{ flex: 1 }} />
        <Select label={t("Sort by")} width={150} options={sortOptions} value={view.sortKey} onChange={chooseSort} />
        <Segmented label={t("View")} size="md" options={[{ value: "grid", label: t("Grid"), icon: "grid", iconOnly: true }, { value: "list", label: t("List"), icon: "list", iconOnly: true }]} value={view.view} onChange={(next) => setView({ ...view, view: next as "grid" | "list" })} />
      </>}
      {canImportHere ? <Button kind="secondary" icon="folder" label={t("New folder")} testID="library-new-folder" disabled={!storage} onPress={() => setNaming({ kind: "new-folder", draft: "" })} /> : null}
      {canImportHere ? importButton : null}
    </View>
  );

  const columns = theme.width < 480 ? 2 : theme.width < 760 ? 3 : theme.width < 1100 ? 4 : 6, gap = space[3];
  const shared: Shared = { storage, menu: itemMenu, playing, onPlay: play };
  const firstUse = FIRST_USE[props.category];
  let body: ReactNode;
  if (own) body = own;
  else if (category === null) body = <FirstUseState icon={ICON[props.category]} title={t(firstUse.title)} description={t(firstUse.description)} />;
  else if (listing === null && failed) body = <Callout tone="danger" actions={[{ label: t("Retry"), onPress: retry }]}>{t("The library could not be read.")}</Callout>;
  else if (listing === null) body = <LoadingSkeleton testID="library-skeleton" style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }}>{Array.from({ length: columns }, (_, index) => <View key={index} style={{ width: `${100 / columns}%`, padding: gap / 2 }}><Skeleton height={120} /></View>)}</LoadingSkeleton>;
  else {
    const visible = displayed.slice(0, shown), searching = query.trim() !== "";
    const cards = searching || folder ? [] : folders;
    // A category that ships built-in items with nothing imported gets one quiet hint under the toolbar; only a category
    // with nothing to show at all gets the big centred first-use state.
    const showHint = canImportHere && imported === 0 && hasBuiltIns && !searching && !folder;
    const showFirstUse = canImportHere && imported === 0 && !hasBuiltIns && !searching && source !== "built-in" && !folder;
    const list = visible.length === 0 ? null : view.view === "grid" ? (
      <View role="list" aria-label={t(current.label)} testID="library-grid" style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2, marginVertical: -gap / 2 }}>
        {visible.map((item) => <View key={item.id} role="listitem" style={{ width: `${100 / columns}%`, padding: gap / 2 }}><ItemTile {...shared} item={item} /></View>)}
      </View>
    ) : (
      <View role="list" aria-label={t(current.label)} testID="library-list">
        {visible.map((item) => <View key={item.id} role="listitem"><ItemRow {...shared} item={item} /></View>)}
      </View>
    );
    body = (
      <View style={{ gap: space[4] }}>
        {/* Built-ins with nothing imported: one quiet inline hint directly under the toolbar, above the folder cards. */}
        {showHint ? (
          <View testID="library-import-hint" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
            <Icon name="download" size={16} color="text/secondary" />
            <Text color="text/secondary" style={{ flex: 1 }}>{t(firstUse.description)}</Text>
            <Button kind="link" size="sm" label={t("Import")} testID="library-import-hint-action" disabled={!storage} onPress={() => void runImport()} />
          </View>
        ) : null}
        {cards.length ? <View style={{ flexDirection: theme.compact ? "column" : "row", flexWrap: "wrap", gap: space[3] }}>{cards.map((entry) => <FolderCard key={entry.id} folder={entry} count={items.filter((item) => item.folderId === entry.id).length} menu={folderMenu(entry)} onOpen={() => setFolderId(entry.id)} />)}</View> : null}
        {/* Nothing at all to show yet: the first-use state of the category. */}
        {showFirstUse ? <View testID="library-first-use" style={{ paddingVertical: space[6] }}><FirstUseState icon={ICON[props.category]} title={t(firstUse.title)} description={t(firstUse.description)} action={{ label: t("Import"), onPress: () => void runImport() }} /></View> : null}
        {displayed.length === 0 ? (
          searching ? <NoResultsState query={query.trim()} onClear={() => setQuery("")} />
            : folder ? <EmptyState icon="folder" title={t("This folder is empty")} actions={[{ label: t("Import"), kind: "strong", onPress: () => void runImport() }]} />
            : source === "imported" && imported === 0 ? null
            : source ? <EmptyState icon={ICON[props.category]} title={t("No items match this filter")} actions={[{ label: t("Clear filters"), onPress: () => setSource(null) }]} /> : null
        ) : list}
        {displayed.length > shown ? <View style={{ alignItems: "center" }}><Button kind="outline" label={t("Show more")} onPress={() => setShown(shown + PAGE)} /></View> : null}
      </View>
    );
  }
  const crumbs: Crumb[] = [{ id: "library", label: t("Library"), onPress: () => router.push("/library") }, { id: props.category, label: t(current.label) }];
  const dialogTitle = naming?.kind === "item" ? t("Rename") : naming?.kind === "folder" ? t("Rename folder") : t("New folder");
  return (
    <Screen title={t("Library")} crumbs={crumbs} documentTitle={t(current.label)}>
      <ScrollView testID="library-screen" contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? space[3] : space[5], gap: space[3] }}>
        <View>
          <Text variant="h1" level={1}>{t("Library")}</Text>
          <Text color="text/secondary" style={{ marginTop: space[0.5] }}>{t("Templates, presets, fonts, LUTs, sounds, stickers and brand kits shared by all projects on this device.")}</Text>
        </View>
        {tabs ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <Tabs id="library-category" variant="pill" label={t("Category")} value={props.category} onChange={(id) => router.setParams({ category: id })} items={LIBRARY_CATEGORIES.map((entry) => ({ id: entry.id, label: t(entry.label), count: counts[entry.id] }))} />
          </ScrollView>
        ) : null}
        {toolbar}
        {body}
      </ScrollView>
      <FormDialog open={naming !== null} title={dialogTitle} submitLabel={naming?.kind === "new-folder" ? t("Create") : t("Rename")} dirty={false} canSubmit={naming !== null && committedItemName(naming.draft) !== null} onSubmit={() => void commitName()} onClose={() => setNaming(null)}>
        {naming ? <Input accessibilityLabel={t("Name")} autoFocus maxLength={NAME_MAX} value={naming.draft} placeholder={naming.kind === "new-folder" ? t("Folder name") : undefined} testID="library-name-input" onChangeText={(draft) => setNaming({ ...naming, draft })} onSubmitEditing={() => void commitName()} /> : null}
      </FormDialog>
      <ConfirmDialog open={removing !== null} title={removing && "builtIn" in removing ? t("Delete {name}?", { name: removing.name }) : t("Delete folder")} confirmLabel={t("Delete")}
        description={removing && "builtIn" in removing ? t("It is removed from the Library of this device. Projects that already use it keep their own copy.") : t("The items of this folder stay in the Library.")} onClose={() => setRemoving(null)} onConfirm={() => void confirmRemove()} />
    </Screen>
  );
}
