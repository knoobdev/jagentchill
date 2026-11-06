import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, RefreshControl, ScrollView, View } from "react-native";
import {
  canCreateFolderIn, childFolders, countProjectsIn, durationBadge, durationCell, effectiveFolder, EMPTY_SELECTION, folderPath, folderSubtree, formatDay, gridColumns, matchesQuery, moveFocus,
  NARROW_HEADER, pinTarget, PREFS, pruneSelection, relativeTime, selectAllState, selectRange, SKELETON_COUNT, SORT_KEYS, sortProjects, toggleSelectAll, toggleSelected,
  type ProjectFolder, type ProjectSummary, type Selection, type SortKey,
} from "@jagentchill/app-core";
import { WEB_STORAGE_UNAVAILABLE } from "@jagentchill/storage";
import {
  AddFilterChip, Badge, BottomSheet, Button, Checkbox, compactScale, ContextMenu, EmptyState, FilterChip, Icon, IconButton, Menu, MenuButton, SearchField, Segmented, Select, LoadingSkeleton, Skeleton, Switch, Tap, Text, Tooltip, radius, space, useInsets, useTheme,
  type Crumb, type MenuItem,
} from "@jagentchill/ui";
import { useT } from "../locale";
import { useHost } from "../host";
import { bindDrag, bindDrop, focusById, heldModifiers } from "../platform/store";
import { Screen } from "../shell/Shell";
import { useDevice, useLibraryState, usePref, useProjectImage } from "../state";
import { useProjectActions } from "./actions";
import { StorageNotices } from "./StorageNotices";
import { HostProjects, SyncBadge, useProjectSync } from "../sync/ProjectsSync";
import { compactEditedDate, phoneProjectsBottomPadding, phoneProjectsGrid, showPhoneNewProjectAction } from "./layout";
import { projectPlaceholderInitial } from "../shell/mobile-layout";

type Payload = { projects?: string[]; folder?: string };
const parsePayload = (text: string): Payload => { try { return JSON.parse(text) as Payload; } catch { return {}; } };
const acceptsApp = (types: readonly string[]) => types.includes("application/x-jagentchill");
const CHECKER = (a: string, b: string) => ({ backgroundImage: `repeating-conic-gradient(${a} 0% 25%, ${b} 0% 50%)`, backgroundSize: "32px 32px" });

/** The picture of a project: its cover or frame-0 thumbnail; a placeholder icon when it has none; a 16 px checkerboard under a transparent background. */
export function ProjectThumbnail(props: { project: ProjectSummary; version: number; round?: number; initialPlaceholder?: boolean; emptyLabel?: string }) {
  const theme = useTheme();
  const url = useProjectImage(props.project.id, props.project.cover, props.version, props.project.thumbnailAssetId);
  const picture = url;
  const transparent = props.project.background?.kind === "transparent";
  return (
    <View style={[{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/subtle"), borderRadius: props.round ?? 0, overflow: "hidden" }, transparent ? (CHECKER(theme.color("bg/subtle"), theme.color("bg/app")) as object) : null]}>
      {props.project.assets === 0 && !picture ? <View testID="project-empty-thumbnail" style={{ alignItems: "center", gap: space[1] }}><Icon name="film" size={props.round ? 14 : 24} color="text/secondary" />{props.emptyLabel ? <Text variant="meta" color="text/secondary" align="center">{props.emptyLabel}</Text> : null}</View>
        : picture ? <Image source={{ uri: picture }} accessibilityLabel="" testID="project-thumbnail-image" resizeMode="cover" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }} />
        : transparent ? null : props.project.assets === 0 ? <View testID="project-empty-thumbnail" style={{ alignItems: "center", gap: space[1] }}><Icon name="film" size={props.round ? 14 : 24} color="text/secondary" />{props.emptyLabel ? <Text variant="meta" color="text/secondary" align="center">{props.emptyLabel}</Text> : null}</View>
          : props.initialPlaceholder ? <Text testID="project-placeholder-initial" variant="title-sm" color="text/secondary" style={{ fontSize: props.round ? 14 : 32, fontWeight: "600" }}>{projectPlaceholderInitial(props.project.name)}</Text>
          : <Icon name="film" size={props.round ? 14 : 24} color="text/secondary" />}
    </View>
  );
}

function badgesOf(project: ProjectSummary, t: (text: string) => string): ReactNode {
  return (
    <>
      {project.unreadable ? <Badge label={t("Unreadable")} tone="danger" /> : null}
      {project.needsNewerApp ? <Badge label={t("Needs newer app")} tone="warning" /> : null}
      {project.templateDraft ? <Badge label={t("Template draft")} tone="purple" /> : null}
      {project.imported ? <Badge label={t("Imported")} tone="neutral" /> : null}
      {project.links.film ? <Badge label={t("From film")} tone="neutral" /> : null}
      {project.links.workflow ? <Badge label={t("From workflow")} tone="neutral" /> : null}
      {project.links.scripts ? <Badge label={t("From script")} tone="neutral" /> : null}
      <SyncBadge projectId={project.id} />
    </>
  );
}
/** The pin mark of a pinned project: before its name on a card and in a row. */
function PinMark(props: { project: ProjectSummary }) {
  const t = useT();
  return props.project.pinned_ms === null ? null : <View testID="pin-mark" role="img" aria-label={t("Pinned")} accessibilityLabel={t("Pinned")}><Icon name="pin" size={12} color="accent" /></View>;
}

type ItemProps = {
  project: ProjectSummary; selected: boolean; selecting: boolean; multi: boolean; version: number; menu: MenuItem[]; tabbable: boolean;
  onOpen(): void; onToggle(range: boolean): void; onKey(key: { key: string; meta: boolean; preventDefault(): void }): void; onLongPress(): void; dragPayload(): string | null; onFocus(): void;
};
/** Attaches the drag source to a card or row; the payload is every selected project when the dragged one is selected. */
function useDragSource(payload: () => string | null) {
  const node = useRef<View>(null);
  const latest = useRef(payload);
  latest.current = payload;
  useEffect(() => bindDrag(node.current, () => latest.current()), []);
  return node;
}

function ProjectCard(props: ItemProps) {
  const t = useT();
  const theme = useTheme();
  const { project } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<View>(null);
  const node = useDragSource(props.dragPayload);
  const lastKey = useRef("");
  const card = (
    <View ref={node} testID={`project-${project.name}`} style={{ borderWidth: 1, borderColor: theme.color(props.selected ? "accent" : "border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/app"), overflow: "hidden" }}>
      <Tap role="button" nativeID={`project-${project.id}`} testID={`project-open-${project.id}`} label={project.name || t("Unreadable project")} selected={props.selected} tabIndex={props.tabbable ? 0 : -1} onFocus={props.onFocus}
        onKeyDown={(key) => { lastKey.current = key.key; props.onKey(key); }} onLongPress={theme.touch ? props.onLongPress : undefined}
        onPress={() => {
          const key = lastKey.current; lastKey.current = "";
          const held = heldModifiers();
          // Space toggles the selection; Enter or a plain press opens. While selecting, a press selects.
          if (key === " " || held.toggle || held.shift || props.selecting) props.onToggle(held.shift); else props.onOpen();
        }}
        style={{ borderRadius: radius.md }}>
        <View style={{ aspectRatio: 16 / 9 }}>
          <ProjectThumbnail project={project} version={props.version} />
          {project.unreadable ? null : (
            <View style={{ position: "absolute", end: space[1.5], bottom: space[1.5], backgroundColor: theme.color("clip/label-scrim"), borderRadius: radius.xs, paddingHorizontal: space[1] }}>
              <Text variant="caption" color="clip/label" tabular>{durationBadge(project.duration)}</Text>
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: compactScale.space.card, paddingVertical: compactScale.space.card, gap: space[0.5], minHeight: 58 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            <PinMark project={project} />
            <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{project.name || t("Unreadable project")}</Text>
          </View>
          <Text variant="meta" color="text/secondary" numberOfLines={1} testID={`project-edited-${project.id}`}>
            {project.unreadable ? "—" : durationCell(project.duration)} · {project.updated_ms ? (theme.compact ? compactEditedDate(project.updated_ms, theme.locale) : t("Edited {when}", { when: relativeTime(project.updated_ms, Date.now(), theme.locale) })) : "—"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{badgesOf(project, t)}</View>
        </View>
      </Tap>
      {props.selected ? <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: 1, borderColor: theme.color("accent"), borderRadius: radius.md - 1 }} /> : null}
      {props.selecting ? <View testID={`project-selection-check-${project.id}`} style={{ position: "absolute", top: space[1], start: space[1], width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/app"), borderRadius: radius.sm }}>
        <Checkbox accessibilityLabel={t("Select {name}", { name: project.name || t("Unreadable project") })} checked={props.selected} onChange={() => props.onToggle(heldModifiers().shift)} />
      </View> : null}
      {props.multi ? null : (
        // On compact cards keep ⋯ inside the image, clear of the title and metadata below it.
        <Tap ref={more} role="button" label={t("Actions for {name}", { name: project.name || t("Unreadable project") })} testID={`project-actions-${project.id}`} expanded={menuOpen} onPress={() => setMenuOpen(true)}
          style={{ position: "absolute", ...(theme.compact ? { top: space[1], end: space[1] } : { start: 0, bottom: 58 - space[1.5] }), width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 }}>
          <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("clip/label-scrim"), borderRadius: 16 }}><Icon name="more" size={20} color="clip/label" /></View>
        </Tap>
      )}
      <Menu open={menuOpen} anchor={more} items={props.menu} label={project.name} align="start" onClose={() => setMenuOpen(false)} />
    </View>
  );
  // Long-press starts selection on touch; the context menu belongs to the secondary click and the menu key.
  return theme.touch ? card : <ContextMenu items={props.menu} label={project.name}>{card}</ContextMenu>;
}

const COLUMNS = { duration: 96, modified: 150, created: 130 } as const;
function ProjectRow(props: ItemProps) {
  const t = useT();
  const theme = useTheme();
  const { project } = props;
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<View>(null);
  const node = useDragSource(props.dragPayload);
  const lastKey = useRef("");
  const row = (
    <View ref={node} testID={`project-${project.name}`} {...({ onPointerEnter: () => setHovered(!theme.touch), onPointerLeave: () => setHovered(false) } as object)}
      style={{ minHeight: theme.touch ? 56 : 36, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"),
        backgroundColor: theme.color(props.selected ? "accent/subtle" : hovered ? "bg/hover" : "bg/app") }}>
      <Checkbox accessibilityLabel={t("Select {name}", { name: project.name || t("Unreadable project") })} checked={props.selected} onChange={() => props.onToggle(heldModifiers().shift)} />
      <Tap role="button" nativeID={`project-${project.id}`} testID={`project-open-${project.id}`} label={project.name || t("Unreadable project")} selected={props.selected} tabIndex={props.tabbable ? 0 : -1} onFocus={props.onFocus}
        onKeyDown={(key) => { lastKey.current = key.key; props.onKey(key); }} onLongPress={theme.touch ? props.onLongPress : undefined}
        onPress={() => { const key = lastKey.current; lastKey.current = ""; const held = heldModifiers(); if (key === " " || held.toggle || held.shift || props.selecting) props.onToggle(held.shift); else props.onOpen(); }}
        style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: space[3], borderRadius: radius.sm }}>
        <View style={{ width: 40, height: 22.5 }}><ProjectThumbnail project={project} version={props.version} round={radius.xs} /></View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <PinMark project={project} />
          <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{project.name || t("Unreadable project")}</Text>
          {badgesOf(project, t)}
        </View>
        {theme.compact ? null : (
          <>
            <View style={{ width: COLUMNS.duration }}><Text variant="mono" color="text/primary">{project.unreadable ? "—" : durationCell(project.duration)}</Text></View>
            <View style={{ width: COLUMNS.modified }}><Text color="text/secondary" numberOfLines={1}>{project.updated_ms ? relativeTime(project.updated_ms, Date.now(), theme.locale) : "—"}</Text></View>
            <View style={{ width: COLUMNS.created }}><Text color="text/secondary" numberOfLines={1}>{project.created_ms ? formatDay(project.created_ms, theme.locale) : "—"}</Text></View>
          </>
        )}
      </Tap>
      <View style={{ width: 28, opacity: props.multi ? 0 : 1 }} pointerEvents={props.multi ? "none" : "auto"}>
        <IconButton ref={more} icon="more" size="xs" compactVisual label={t("Actions for {name}", { name: project.name || t("Unreadable project") })} testID={`project-actions-${project.id}`} expanded={menuOpen} disabled={props.multi} onPress={() => setMenuOpen(true)} />
      </View>
      <Menu open={menuOpen} anchor={more} items={props.menu} label={project.name} align="end" onClose={() => setMenuOpen(false)} />
    </View>
  );
  return theme.touch ? row : <ContextMenu items={props.menu} label={project.name}>{row}</ContextMenu>;
}

function FolderCard(props: { folder: ProjectFolder; count: number; menu: MenuItem[]; onOpen(): void; onDrop(payload: Payload): void }) {
  const t = useT();
  const theme = useTheme();
  const [over, setOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<View>(null);
  const node = useRef<View>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const drag = bindDrag(node.current, () => JSON.stringify({ folder: latest.current.folder.id }));
    const drop = bindDrop(node.current, { accept: acceptsApp, onEnter: () => setOver(true), onLeave: () => setOver(false), onDrop: (data) => latest.current.onDrop(parsePayload(data.text)) });
    return () => { drag(); drop(); };
  }, []);
  return (
    <ContextMenu items={props.menu} label={props.folder.name} disabled={theme.touch}>
      <View ref={node} testID={`folder-${props.folder.name}`} style={{ flexDirection: "row", alignItems: "center", width: theme.compact ? undefined : 190, borderWidth: over ? 2 : 1, borderColor: theme.color(over ? "accent" : "border/hairline"), borderRadius: radius.md, backgroundColor: theme.color(over ? "accent/subtle" : "bg/app") }}>
        <Tap role="button" label={t("Folder {name}, {n} projects", { name: props.folder.name, n: props.count })} onPress={props.onOpen}
          style={(state) => ({ flex: 1, minWidth: 0, height: theme.touch ? 44 : 36, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[3] - (over ? 1 : 0), borderRadius: radius.md, backgroundColor: state.hovered && !over ? theme.color("bg/hover") : "transparent" })}>
          <Icon name="folder" size={16} color="text/secondary" />
          <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{props.folder.name}</Text>
          <Text variant="meta" color="text/secondary" tabular>{props.count}</Text>
        </Tap>
        <IconButton ref={more} icon="more" size="xs" compactVisual label={t("Actions for {name}", { name: props.folder.name })} expanded={menuOpen} onPress={() => setMenuOpen(true)} />
        <Menu open={menuOpen} anchor={more} items={props.menu} label={props.folder.name} align="end" onClose={() => setMenuOpen(false)} />
      </View>
    </ContextMenu>
  );
}

/** The Projects index: folders, then a grid or a list of the projects of the folder being viewed. Works with no host. */
export function ProjectsScreen(props: { folderId: string | null }) {
  const t = useT();
  const theme = useTheme();
  const insets = useInsets();
  const router = useRouter();
  const actions = useProjectActions();
  const { host, status } = useHost();
  const { library } = useDevice();
  const state = useLibraryState();
  const [view, setView] = usePref(PREFS.projectsView);
  const [sortKey, setSortKey] = usePref(PREFS.projectsSortKey);
  const [order, setOrder] = usePref(PREFS.projectsSortOrder);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [selecting, setSelecting] = useState(false);
  const [focused, setFocused] = useState(0);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<View>(null);
  const folderId = effectiveFolder(state.folders, props.folderId);
  const missingFolder = state.status === "ready" && props.folderId !== null && folderId === null;
  const path = folderPath(state.folders, folderId);
  const narrow = theme.width < NARROW_HEADER;
  const phone = theme.compact;
  const columns = phone ? phoneProjectsGrid(theme.width, compactScale.space.side, compactScale.space.gapMedium).columns : view === "list" ? 1 : gridColumns(theme.width, false);

  // What each project holds on this device (its record and its media), read when the list is sorted by size.
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const sizeIds = state.projects.map((project) => `${project.id}:${project.updated_ms}`).join(",");
  useEffect(() => {
    if (sortKey !== "size" || !library) return;
    let stale = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const project of library.getState().projects) next[project.id] = await library.storageBytes(project.id);
      if (!stale) setSizes(next);
    })();
    return () => { stale = true; };
  }, [sortKey, library, sizeIds]);
  const folders = useMemo(() => (query.trim() ? [] : childFolders(state.folders, folderId, theme.locale)), [state.folders, folderId, query, theme.locale]);
  const displayed = useMemo(() => {
    const live = state.projects.filter((project) => project.trash === null);
    // Search covers the current folder and all its subfolders; without a query only the folder itself is listed.
    const scope = folderId === null ? null : new Set(folderSubtree(state.folders, folderId));
    const inScope = query.trim()
      ? live.filter((project) => (scope === null || (project.folderId !== null && scope.has(project.folderId))) && matchesQuery(project.name, query))
      : live.filter((project) => effectiveFolder(state.folders, project.folderId) === folderId);
    // Pinned projects first, in every view, search and folder; then the chosen sort.
    const filtered = pinnedOnly ? inScope.filter((project) => project.pinned_ms !== null) : inScope;
    return sortProjects(sortKey === "size" ? filtered.map((project) => ({ ...project, bytes: sizes[project.id] ?? 0 })) : filtered, sortKey, order, theme.locale);
  }, [state.projects, state.folders, folderId, query, sortKey, order, theme.locale, sizes, pinnedOnly]);
  const ids = useMemo(() => displayed.map((project) => project.id), [displayed]);
  // Projects hidden by the filter leave the selection.
  useEffect(() => setSelection((current) => pruneSelection(current, ids)), [ids]);
  useEffect(() => actions.onSettled(() => { setSelection(EMPTY_SELECTION); setSelecting(false); }), [actions]);
  useEffect(() => { if (selection.ids.size === 0) setSelecting(false); }, [selection.ids.size]);
  const chosen = displayed.filter((project) => selection.ids.has(project.id));
  const all = selectAllState(selection, ids);
  const clear = useCallback(() => { setSelection(EMPTY_SELECTION); setSelecting(false); }, []);

  const syncActions = useProjectSync();
  const menuOf = (project: ProjectSummary): MenuItem[] => (project.unreadable || project.needsNewerApp ? [
    { id: "info", label: t("Info"), icon: "info", onSelect: () => void actions.info(project) },
    ...(project.needsNewerApp ? [{ id: "export", label: t("Export package"), icon: "export" as const, onSelect: () => void actions.exportPackages([project.id]) }] : []),
    { type: "separator" }, { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => actions.trash([project]) },
  ] : [
    { id: "open", label: t("Open"), icon: "ext", shortcut: "list.open", onSelect: () => actions.open(project) },
    { id: "pin", label: project.pinned_ms === null ? t("Pin") : t("Unpin"), icon: "pin", shortcut: "list.pin", onSelect: () => void actions.togglePin([project]) },
    { id: "rename", label: t("Rename"), icon: "pencil", shortcut: "list.rename", onSelect: () => actions.rename(project) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => void actions.duplicate([project.id]) },
    { id: "move", label: t("Move to folder"), icon: "folder", submenu: [
      { id: "root", label: t("All projects"), icon: "folder", checked: project.folderId === null || undefined, onSelect: () => void actions.moveInto([project.id], null) },
      ...state.folders.map((folder): MenuItem => ({ id: folder.id, label: folder.name, icon: "folder", checked: project.folderId === folder.id || undefined, onSelect: () => void actions.moveInto([project.id], folder.id) })),
      { type: "separator" }, { id: "choose", label: t("Choose folder…"), icon: "arrow-r", onSelect: () => actions.move([project.id]) },
    ] },
    { id: "info", label: t("Info"), icon: "info", onSelect: () => void actions.info(project) },
    { id: "cover", label: t("Edit cover"), icon: "image", onSelect: () => void actions.editCover(project) },
    { id: "export", label: t("Export package"), icon: "export", onSelect: () => void actions.exportPackages([project.id]) },
    ...syncActions.menu(project),
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, shortcut: "list.delete", onSelect: () => actions.trash([project]) },
  ]);
  const item = (project: ProjectSummary, index: number): ItemProps => ({
    project, selected: selection.ids.has(project.id), selecting, multi: selection.ids.size > 1, version: actions.imageVersion, menu: menuOf(project), tabbable: index === Math.min(focused, displayed.length - 1),
    onFocus: () => setFocused(index), onOpen: () => actions.open(project),
    onToggle: (range) => setSelection((current) => (range ? selectRange(current, ids, project.id) : toggleSelected(current, project.id))),
    onLongPress: () => { setSelecting(true); setSelection((current) => (current.ids.has(project.id) ? current : toggleSelected(current, project.id))); },
    dragPayload: () => JSON.stringify({ projects: selection.ids.has(project.id) ? [...selection.ids] : [project.id] }),
    onKey: (key) => {
      const next = moveFocus(index, key.key, displayed.length, columns, theme.rtl);
      if (next !== null) { key.preventDefault(); setFocused(next); focusById(`project-${displayed[next].id}`); return; }
      if (key.key === "F2" && !project.unreadable) { key.preventDefault(); actions.rename(project); }
      // P pins or unpins the focused project, or the whole selection when it is part of it.
      if ((key.key === "p" || key.key === "P") && !key.meta) { key.preventDefault(); void actions.togglePin(selection.ids.has(project.id) ? chosen : [project]); }
      if (key.key === "Delete" || (key.key === "Backspace" && key.meta)) { key.preventDefault(); actions.trash(selection.ids.has(project.id) ? chosen : [project]); }
      if (key.key === "Escape") clear();
    },
  });
  const dropOn = (target: string | null) => (payload: Payload) => {
    if (payload.projects?.length) void actions.moveInto(payload.projects, target);
    else if (payload.folder) void actions.moveFolderInto(payload.folder, target);
  };
  const crumbTargets = useRef(new Map<string, () => void>());
  const crumbNode = (key: string, target: string | null) => (node: View | null) => {
    crumbTargets.current.get(key)?.();
    crumbTargets.current.delete(key);
    if (node) crumbTargets.current.set(key, bindDrop(node, { accept: acceptsApp, onDrop: (data) => dropOn(target)(parsePayload(data.text)) }));
  };
  const crumbs: Crumb[] = [
    { id: "home", label: t("Home"), onPress: () => router.push("/home") },
    { id: "all", label: t("All projects"), onPress: () => router.push("/projects"), onNode: crumbNode("all", null) },
    ...path.map((folder): Crumb => ({ id: folder.id, label: folder.name, onPress: () => router.push(`/projects/folder/${folder.id}` as never), onNode: crumbNode(folder.id, folder.id) })),
  ];
  const canNest = canCreateFolderIn(state.folders, folderId);
  const create = () => void actions.create(folderId);
  const folderMenu = (folder: ProjectFolder): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "folder", onSelect: () => router.push(`/projects/folder/${folder.id}` as never) },
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => actions.renameFolder(folder) },
    { id: "move", label: t("Move to folder"), icon: "arrow-r", onSelect: () => actions.moveFolder(folder) },
    { type: "separator" }, { id: "delete", label: t("Delete folder"), icon: "trash", danger: true, onSelect: () => actions.deleteFolder(folder) },
  ];
  // The one sort control of the toolbar: the key, and under it the direction.
  const sortOptions = [
    ...SORT_KEYS.map((key) => ({ value: key as string, label: t(key === "created" ? "Created" : key === "modified" ? "Last modified" : key === "name" ? "Name" : key === "size" ? "Size" : "Duration"), group: t("Sort by") })),
    { value: "asc", label: t("Ascending"), group: t("Order"), icon: order === "asc" ? "check" as const : undefined }, { value: "desc", label: t("Descending"), group: t("Order"), icon: order === "desc" ? "check" as const : undefined },
  ];
  const chooseSort = (value: string) => { if (value === "asc" || value === "desc") setOrder(value); else setSortKey(value as SortKey); };
  const viewToggle = <Segmented label={t("View")} size="md" options={[{ value: "grid", label: t("Grid"), icon: "grid", iconOnly: true }, { value: "list", label: t("List"), icon: "list", iconOnly: true }]} value={view} onChange={setView} />;
  const newFolderButton = <IconButton icon="folder" size="md" variant="outline" label={canNest ? t("New folder") : t("Folders can be nested up to 4 levels")} disabled={!canNest} onPress={() => actions.newFolder(folderId)} />;
  const search = <View style={phone ? { flex: 1 } : { width: 240 }}><SearchField label={t("Search projects")} placeholder={t("Search projects…")} value={query} onChangeText={setQuery} debounce={0} /></View>;

  const bulkItems = [
    { id: "pin", label: pinTarget(chosen) ? t("Pin") : t("Unpin"), icon: "pin" as const, onPress: () => void actions.togglePin(chosen) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy" as const, onPress: () => void actions.duplicate(chosen.filter((project) => !project.unreadable).map((project) => project.id)) },
    { id: "move", label: t("Move to folder"), icon: "folder" as const, onPress: () => actions.move(chosen.map((project) => project.id)) },
    { id: "export", label: t("Export packages"), icon: "export" as const, onPress: () => void actions.exportPackages(chosen.filter((project) => !project.unreadable).map((project) => project.id)) },
    { id: "delete", label: t("Delete"), icon: "trash" as const, onPress: () => actions.trash(chosen) },
  ];
  const bulkBar = (
    <View testID="bulk-bar" style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle") }}>
      {phone ? <Checkbox accessibilityLabel={t("Select all")} checked={all === "all"} indeterminate={all === "some"} onChange={() => setSelection((current) => toggleSelectAll(current, ids))} /> : null}
      <Text variant="body-medium" style={{ flex: 1, marginStart: space[1] }} live="polite">{t("{n} selected", { n: selection.ids.size })}</Text>
      {narrow ? <MenuButton label={t("Actions")} kind="ghost" size="sm" icon="more" items={bulkItems.map((entry) => ({ id: entry.id, label: entry.label, icon: entry.icon, danger: entry.id === "delete", onSelect: entry.onPress }))} />
        : bulkItems.map((entry) => <Button key={entry.id} kind="ghost" size="sm" icon={entry.icon} label={entry.label} onPress={entry.onPress} />)}
      <View style={{ width: 1, alignSelf: "stretch", marginVertical: space[2], backgroundColor: theme.color("border/hairline") }} />
      <Button kind="ghost" size="sm" label={t("Clear")} onPress={clear} />
    </View>
  );
  const filterMenu: MenuItem[] = state.folders.length ? state.folders.map((folder) => ({ id: folder.id, label: t("Folder is {name}", { name: folder.name }), icon: "folder", onSelect: () => router.push(`/projects/folder/${folder.id}` as never) }))
    : [{ id: "none", label: t("No folders yet"), disabled: true }, { id: "new", label: t("New folder"), icon: "plus", onSelect: () => actions.newFolder(null) }];
  const toolbar = phone ? (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="h1" level={1} style={[compactScale.type.title, { flex: 1 }]} numberOfLines={1}>{path.length ? path[path.length - 1].name : t("Projects")}</Text>
        <IconButton icon="search" label={t("Sort and filter")} testID="projects-sort-filter" on={headerOpen} toggle expanded={headerOpen} onPress={() => setHeaderOpen(true)} />
        <IconButton icon="trash" label={t("Trash")} onPress={() => router.push("/projects/trash" as never)} />
      </View>
      <BottomSheet open={headerOpen} title={t("Sort and filter")} onClose={() => setHeaderOpen(false)}>
        <View testID="projects-sort-filter-sheet" style={{ gap: compactScale.space.gapMedium, padding: compactScale.space.side }}>
          {search}
          <Select label={t("Sort by")} options={sortOptions} value={sortKey} onChange={chooseSort} />
          <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text style={{ flex: 1 }}>{t("Pinned")}</Text>
            <View testID="projects-pinned-filter" style={{ minWidth: compactScale.control.height, minHeight: compactScale.control.height, alignItems: "center", justifyContent: "center" }}>
              <Switch accessibilityLabel={t("Pinned")} value={pinnedOnly} onChange={setPinnedOnly} />
            </View>
          </View>
          {folderId === null ? newFolderButton : null}
        </View>
      </BottomSheet>
    </View>
  ) : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
      {search}
      {path.length ? <FilterChip field={t("Folder")} value={path[path.length - 1].name} onRemove={() => router.push("/projects")} /> : null}
      {view === "list" || path.length ? <View ref={filterRef}><AddFilterChip onPress={() => setFilterOpen(true)} /><Menu open={filterOpen} anchor={filterRef} items={filterMenu} label={t("Add filter")} onClose={() => setFilterOpen(false)} /></View> : null}
      <View style={{ flex: 1 }} />
      <Select label={t("Sort by")} width={150} options={sortOptions} value={sortKey} onChange={chooseSort} />
      {viewToggle}
      <Button kind="strong" icon="plus" label={narrow ? t("New") : t("New project")} shortcut="project.new" onPress={create} />
    </View>
  );

  let body: ReactNode;
  const gap = space[3];
  if (state.status === "error") {
    const unavailable = (state.error as { kind?: string } | null)?.kind === "Unavailable";
    body = <EmptyState icon="warn" title={unavailable ? t(WEB_STORAGE_UNAVAILABLE) : t("Projects could not be loaded")} description={unavailable ? t("Open JAgentChill in a normal browser window to keep projects on this device.") : undefined}
      actions={[{ label: t("Retry"), onPress: () => void library?.load(true) }]} />;
  } else if (state.status === "loading") {
    body = phone || view === "grid" ? (
      <LoadingSkeleton testID="projects-skeleton" style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }}>
        {Array.from({ length: SKELETON_COUNT }, (_, index) => <View key={index} style={{ width: `${100 / columns}%`, padding: gap / 2 }}><Skeleton height={190} /></View>)}
      </LoadingSkeleton>
    ) : <LoadingSkeleton testID="projects-skeleton" style={{ gap: space[1] }}>{Array.from({ length: SKELETON_COUNT }, (_, index) => <Skeleton key={index} height={32} />)}</LoadingSkeleton>;
  } else if (missingFolder) {
    body = <EmptyState icon="folder" title={t("This folder no longer exists")} actions={[{ label: t("All projects"), onPress: () => router.replace("/projects") }]} />;
  } else if (displayed.length === 0 && folders.length === 0) {
    body = query.trim() ? <EmptyState icon="search" title={t("No results found")} actions={[{ label: t("Clear search"), onPress: () => setQuery("") }]} />
      : folderId !== null ? <EmptyState icon="folder" title={t("This folder is empty")} actions={[{ label: t("New project"), kind: "strong", onPress: create }]} />
      : <EmptyState icon="folder" title={t("No projects yet")} description={t("A project holds your timeline, media and exports. It stays on this device and works offline.")} actions={phone ? [{ label: t("New project"), kind: "strong", onPress: create }] : [{ label: t("Create your first project"), kind: "strong", onPress: create }, { label: t("Import project"), onPress: () => void actions.importPackage() }]} />;
  } else {
    body = (
      <View style={{ gap: space[3] }}>
        {folders.length ? (
          <View style={{ flexDirection: phone ? "column" : "row", flexWrap: "wrap", gap: space[2] }}>
            {folders.map((folder) => <FolderCard key={folder.id} folder={folder} count={countProjectsIn(state.folders, state.projects, folder.id)} menu={folderMenu(folder)} onOpen={() => router.push(`/projects/folder/${folder.id}` as never)} onDrop={dropOn(folder.id)} />)}
          </View>
        ) : null}
        {displayed.length === 0 ? <View style={{ paddingVertical: space[6] }}><EmptyState icon="folder" title={folderId === null ? t("No projects in All projects") : t("This folder is empty")} actions={[{ label: t("New project"), kind: "strong", onPress: create }]} /></View>
          : phone || view === "grid" ? (
            <View role="list" aria-label={t("Projects")} style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2, marginVertical: -gap / 2 }}>
              {displayed.map((project, index) => <View key={project.id} role="listitem" style={{ width: `${100 / columns}%`, padding: gap / 2 }}><ProjectCard {...item(project, index)} /></View>)}
            </View>
          ) : (
            <View role="list" aria-label={t("Projects")}>
              <View style={{ height: 32, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[2], backgroundColor: theme.color("bg/sidebar"), borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                <Checkbox accessibilityLabel={t("Select all")} checked={all === "all"} indeterminate={all === "some"} onChange={() => setSelection((current) => toggleSelectAll(current, ids))} />
                <ColumnHeader label={t("Name")} flex active={sortKey === "name"} order={order} onPress={() => (sortKey === "name" ? setOrder(order === "asc" ? "desc" : "asc") : setSortKey("name"))} />
                {theme.compact ? null : (
                  <>
                    <ColumnHeader label={t("Duration")} width={COLUMNS.duration} active={sortKey === "duration"} order={order} onPress={() => (sortKey === "duration" ? setOrder(order === "asc" ? "desc" : "asc") : setSortKey("duration"))} />
                    <ColumnHeader label={t("Modified")} width={COLUMNS.modified} active={sortKey === "modified"} order={order} onPress={() => (sortKey === "modified" ? setOrder(order === "asc" ? "desc" : "asc") : setSortKey("modified"))} />
                    <ColumnHeader label={t("Created")} width={COLUMNS.created} active={sortKey === "created"} order={order} onPress={() => (sortKey === "created" ? setOrder(order === "asc" ? "desc" : "asc") : setSortKey("created"))} />
                  </>
                )}
                <View style={{ width: 28 }} />
              </View>
              {displayed.map((project, index) => <View key={project.id} role="listitem"><ProjectRow {...item(project, index)} /></View>)}
            </View>
          )}
      </View>
    );
  }
  const selected = selection.ids.size > 0;
  return (
    <Screen title={t("Projects")} crumbs={crumbs} documentTitle={path.length ? path[path.length - 1].name : t("Projects")}>
      <ScrollView
        refreshControl={phone ? <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void library?.load(true).finally(() => setRefreshing(false)); }} /> : undefined}
        contentContainerStyle={{ flexGrow: 1, padding: phone ? compactScale.space.side : space[5], paddingBottom: phone ? phoneProjectsBottomPadding(insets.bottom) : space[5], gap: phone ? compactScale.space.gapMedium : space[3] }}>
        {phone ? null : (
          <View>
            <Text variant="h1" level={1}>{path.length ? path[path.length - 1].name : t("Projects")}</Text>
            <Text color="text/secondary" style={{ marginTop: space[0.5] }}>{host ? t("Every project on this device, plus projects synced from {host}.", { host: host.gatewayName }) : t("Every project on this device.")}</Text>
          </View>
        )}
        <StorageNotices />
        {phone && host && status === "unavailable" ? <View testID="projects-host-reconnecting" style={{ padding: compactScale.space.card, gap: compactScale.space.gapSmall, borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
          <Text variant="body-medium">{t("Reconnecting to {host}…", { host: host.gatewayName })}</Text>
          <Text variant="meta" color="text/secondary">{t("Host projects and sync actions are unavailable while {host} reconnects.", { host: host.gatewayName })}</Text>
        </View> : null}
        {selected && !phone ? bulkBar : toolbar}
        {body}
        {folderId === null && !query.trim() ? <HostProjects /> : null}
      </ScrollView>
      {phone && selected ? <View style={{ position: "absolute", start: space[3], end: space[3], bottom: space[3] }}><View style={[{ borderRadius: radius.sm }, theme.elevation(2)]}>{bulkBar}</View></View> : null}
      {phone && showPhoneNewProjectAction({ ready: state.status === "ready", selected, projects: displayed.length, folders: folders.length }) ? (
        <View style={{ position: "absolute", end: space[4], bottom: space[4] }}>
          <View style={[{ borderRadius: radius.sm }, theme.elevation(2)]}><Button kind="strong" size="lg" icon="plus" label={t("New project")} onPress={create} /></View>
        </View>
      ) : null}
    </Screen>
  );
}

function ColumnHeader(props: { label: string; width?: number; flex?: boolean; active: boolean; order: "asc" | "desc"; onPress(): void }) {
  const t = useT();
  return (
    <View style={props.flex ? { flex: 1, minWidth: 0, paddingStart: 40 + space[3] } : { width: props.width }}>
      <Tooltip label={t("Sort by {name}", { name: props.label })}>
        <Tap role="button" label={t("Sort by {name}", { name: props.label })} onPress={props.onPress} style={{ flexDirection: "row", alignItems: "center", gap: space[1], alignSelf: "flex-start", borderRadius: radius.xs }}>
          <Text variant="meta" color="text/secondary">{props.label}</Text>
          {props.active ? <Icon name={props.order === "asc" ? "arrow-up" : "arrow-d"} size={12} color="text/secondary" /> : null}
        </Tap>
      </Tooltip>
    </View>
  );
}
