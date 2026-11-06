import { usePathname, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  childFolders, destinationById, folderSubtree, LIBRARY_CATEGORIES, matchesQuery, PREFS, RECENT_PAGE, relativeTime, rowMeta, type ProjectFolder, type ProjectSummary,
} from "@jagentchill/app-core";
import { Button, Disclosure, IconButton, ListCaption, ListRow, Menu, SearchField, Text, space, useTheme, type MenuItem, SkeletonList } from "@jagentchill/ui";
import { useSessionActions } from "../agents/sessionActions";
import { FilmSidebarRows, useNewFilm } from "../film/FilmList";
import { sessionTitle, useHost } from "../host";
import { useLibraryCounts } from "../library/hooks";
import { useT } from "../locale";
import { useProjectActions } from "../projects/actions";
import { ScriptRows } from "../scripts/ScriptRows";
import { useLibraryState, usePref } from "../state";
import { useSync } from "../sync/SyncProvider";
import { WorkflowSidebarRows } from "../workflows/SidebarRows";

const LIST_TITLE: Record<string, string> = { projects: "Projects", sessions: "Sessions", library: "Library", devices: "Devices" };
/** "No <items> yet", by list. */
const EMPTY: Record<string, string> = {
  projects: "No projects yet", sessions: "No sessions yet", workflows: "No workflows yet", film: "No films yet", agents: "No agent teams yet", automations: "No automations yet",
  workspaces: "No workspaces yet", skills: "No skills yet", scripts: "No scripts yet", devices: "No devices yet",
};

/** The index of the current section under the navigation: a header with search, create and options, then the rows. */
export function SecondaryList(props: { list: string; onNavigate?(): void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const actions = useProjectActions();
  const sync = useSync();
  const sessionActions = useSessionActions();
  const newFilm = useNewFilm();
  const { host, hosts, sessions, sessionsLoaded, approvals, status } = useHost();
  const library = useLibraryState();
  const [collapsed, setCollapsed] = usePref(PREFS.collapsedFolders);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(RECENT_PAGE);
  const [options, setOptions] = useState(false);
  const optionsRef = useRef<View>(null);
  const now = Date.now();
  const title = t(LIST_TITLE[props.list] ?? destinationById(props.list)?.label ?? "Projects");
  const folderOf = /^\/projects\/folder\/([^/]+)/.exec(pathname)?.[1] ?? null;
  // A new list starts unfiltered.
  useEffect(() => { setQuery(""); setSearching(false); setShown(RECENT_PAGE); }, [props.list]);
  // Library counts are the items each category lists on its screen.
  const counts = useLibraryCounts(props.list === "library");

  const go = (route: string) => { router.push(route as never); props.onNavigate?.(); };
  const projects = useMemo(() => library.projects.filter((project) => project.trash === null && matchesQuery(project.name, query)).sort((a, b) => b.updated_ms - a.updated_ms), [library.projects, query]);
  const projectMenu = (project: ProjectSummary): MenuItem[] => {
    const isPinned = project.pinned_ms !== null;
    const folders: MenuItem[] = [
      { id: "root", label: t("All projects"), icon: "folder", checked: project.folderId === null || undefined, onSelect: () => void actions.moveInto([project.id], null) },
      ...library.folders.map((folder): MenuItem => ({ id: folder.id, label: folder.name, icon: "folder", checked: project.folderId === folder.id || undefined, onSelect: () => void actions.moveInto([project.id], folder.id) })),
      { type: "separator" }, { id: "new", label: t("New folder"), icon: "plus", onSelect: () => actions.newFolder(null) },
    ];
    return [
      { id: "open", label: t("Open"), icon: "ext", disabled: project.unreadable, onSelect: () => { actions.open(project); props.onNavigate?.(); } },
      { id: "pin", label: isPinned ? t("Unpin") : t("Pin"), icon: "pin", disabled: project.unreadable || project.needsNewerApp, onSelect: () => void actions.togglePin([project]) },
      { id: "move", label: t("Move to folder"), icon: "folder", submenu: folders },
      { id: "rename", label: t("Rename"), icon: "pencil", disabled: project.unreadable, onSelect: () => actions.rename(project) },
      { id: "duplicate", label: t("Duplicate"), icon: "copy", disabled: project.unreadable, onSelect: () => void actions.duplicate([project.id]) },
      { type: "separator" },
      { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => actions.trash([project]) },
    ];
  };
  const projectRow = (project: ProjectSummary) => {
    const meta = rowMeta({ attention: sync.statuses[project.id]?.kind === "conflict" ? t("Conflict") : undefined, updated: project.updated_ms ? t("Edited {when}", { when: relativeTime(project.updated_ms, now, theme.locale) }) : t("Unreadable") });
    return <ListRow key={project.id} title={project.name || t("Unreadable project")} meta={meta.text} metaTone={meta.tone} icon={project.pinned_ms !== null ? "pin" : undefined} testID={`sidebar-project-${project.name}`} selected={pathname === `/editor/${project.id}`} menu={projectMenu(project)}
      onPress={() => { if (project.unreadable) void actions.info(project); else { actions.open(project); props.onNavigate?.(); } }} />;
  };

  let body: React.ReactNode;
  let create: (() => void) | null = null;
  let optionItems: MenuItem[] = [];
  if (props.list === "projects") {
    create = () => { void actions.create(folderOf); props.onNavigate?.(); };
    optionItems = [
      { id: "folder", label: t("New folder"), icon: "folder", onSelect: () => actions.newFolder(null) },
      { id: "all", label: t("All projects"), icon: "grid", onSelect: () => go("/projects") },
      { id: "import", label: t("Import project"), icon: "download", onSelect: () => void actions.importPackage() },
      { id: "trash", label: t("Trash"), icon: "trash", onSelect: () => go("/projects/trash") },
    ];
    // The pin is the project's own (`pinned_ms` of its record): the same projects are pinned here, in the grid, in the list and on the other devices.
    const pinnedRows = projects.filter((project) => project.pinned_ms !== null);
    const top = childFolders(library.folders, null, theme.locale);
    const grouped = (folder: ProjectFolder) => { const ids = folderSubtree(library.folders, folder.id); return projects.filter((project) => project.pinned_ms === null && project.folderId !== null && ids.includes(project.folderId)); };
    const inFolders = new Set(top.flatMap((folder) => grouped(folder).map((project) => project.id)));
    const recent = projects.filter((project) => project.pinned_ms === null && !inFolders.has(project.id));
    body = library.status === "loading" ? <SkeletonList rows={4} testID="projects-skeleton" /> : projects.length === 0 ? <Empty text={query ? t("No results") : t(EMPTY.projects)} /> : (
      <>
        {pinnedRows.length ? <><ListCaption label={t("Pinned")} />{pinnedRows.map(projectRow)}</> : null}
        {top.map((folder) => {
          const rows = grouped(folder);
          if (rows.length === 0) return null;
          const open = !collapsed.includes(folder.id);
          return (
            <Disclosure key={folder.id} title={folder.name} open={open} summary={<Text variant="meta" color="text/secondary">{rows.length}</Text>}
              onToggle={(next) => setCollapsed(next ? collapsed.filter((id) => id !== folder.id) : [...collapsed, folder.id])}>
              {rows.map(projectRow)}
            </Disclosure>
          );
        })}
        {recent.length ? <><ListCaption label={t("Recent")} />{recent.slice(0, shown).map(projectRow)}</> : null}
        {recent.length > shown ? <View style={{ alignItems: "flex-start", padding: space[1] }}><Button kind="ghost" size="xs" label={t("Show more")} onPress={() => setShown(shown + RECENT_PAGE)} /></View> : null}
      </>
    );
  } else if (props.list === "sessions") {
    create = () => go("/home?focus=1");
    const waiting = new Set(approvals.map((approval) => approval.sessionKey));
    const rows = sessions.filter((session) => matchesQuery(sessionTitle(session), query));
    body = !sessionsLoaded && host && status !== "unavailable" ? <SkeletonList rows={4} testID="sessions-skeleton" /> : rows.length === 0 ? <Empty text={query ? t("No results") : t(status === "connected" ? EMPTY.sessions : "Connect a host to see its sessions")} /> : rows.slice(0, shown).map((session) => {
      const meta = rowMeta({ attention: waiting.has(session.sessionKey) ? t("Needs approval") : undefined, updated: relativeTime(session.created_ms, now, theme.locale) });
      return <ListRow key={session.sessionKey} title={sessionTitle(session)} meta={meta.text} metaTone={meta.tone} menu={sessionActions.menu(session)} testID="session-row"
        selected={pathname.includes(encodeURIComponent(session.sessionKey)) || pathname.includes(session.sessionKey)} onPress={() => go(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}`)} />;
    });
  } else if (props.list === "library") {
    const category = /^\/library\/([^/]+)/.exec(pathname)?.[1];
    body = LIBRARY_CATEGORIES.map((entry) => {
      const count = counts[entry.id] ?? 0;
      return <ListRow key={entry.id} title={t(entry.label)} meta={entry.id === "fonts" ? (count === 1 ? t("1 family") : t("{n} families", { n: count })) : count === 1 ? t("1 item") : t("{n} items", { n: count })} testID={`library-row-${entry.id}`} selected={category === entry.id} onPress={() => go(`/library/${entry.id}`)} />;
    });
  } else if (props.list === "scripts") body = <ScriptRows query={query} onNavigate={props.onNavigate} />;
  else if ((props.list === "workflows" || props.list === "automations") && host) {
    create = () => go(props.list === "workflows" ? `/h/${host.gatewayId}/workflows` : `/h/${host.gatewayId}/automations/new`);
    body = <WorkflowSidebarRows list={props.list} query={query} onNavigate={props.onNavigate} />;
  } else if (props.list === "film" && host) {
    create = () => { void newFilm.create(); props.onNavigate?.(); };
    body = <FilmSidebarRows query={query} onNavigate={props.onNavigate} />;
  } else body = <Empty text={t(EMPTY[props.list] ?? "No projects yet")} />;

  const searchable = props.list !== "library";
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ minHeight: 28, flexDirection: "row", alignItems: "center", paddingTop: space[3], paddingStart: space[2], paddingEnd: space[1], paddingBottom: space[1] }}>
        <Text variant="body-medium" level={2} style={{ flex: 1 }}>{title}</Text>
        {searchable ? <IconButton icon="search" size="xs" label={t("Search {list}", { list: title })} on={searching} toggle onPress={() => { setSearching(!searching); if (searching) setQuery(""); }} /> : null}
        {create ? <IconButton icon="plus" size="xs" label={props.list === "projects" ? t("New project") : props.list === "workflows" ? t("New workflow") : props.list === "automations" ? t("Create automation") : props.list === "film" ? t("New film") : t("New session")} onPress={create} /> : null}
        {optionItems.length ? <IconButton ref={optionsRef} icon="more" size="xs" label={t("{list} list options", { list: title })} expanded={options} onPress={() => setOptions(true)} /> : null}
      </View>
      {searching ? <View style={{ paddingHorizontal: space[1], paddingBottom: space[1] }}><SearchField label={t("Search {list}", { list: title })} placeholder={t("Search…")} size="xs" value={query} onChangeText={setQuery} debounce={0} autoFocus onEscape={() => { setSearching(false); setQuery(""); }} /></View> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[2] }}>{body}</ScrollView>
      <Menu open={options} anchor={optionsRef} items={optionItems} label={t("{list} list options", { list: title })} onClose={() => setOptions(false)} />
      {props.list === "sessions" ? sessionActions.dialogs : null}
    </View>
  );
}
function Empty(props: { text: string }) {
  return <View style={{ paddingVertical: space[2], paddingHorizontal: space[2] }}><Text color="text/secondary">{props.text}</Text></View>;
}
