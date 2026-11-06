import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, View } from "react-native";
import { Button, Checkbox, ContextMenu, EmptyState, Icon, IconButton, Menu, Modal, SearchField, Select, SkeletonList, StatusPill, Tap, Text, space, useTheme, Card, radius, compactScale, compactSessionFilterMetrics, type MenuItem } from "@jagentchill/ui";
import { useSessionActions } from "../../../../src/agents/sessionActions";
import { relativeTime } from "@jagentchill/app-core";
import { stripInjectedUserText } from "@jagentchill/protocol";
import { sessionTitle, useHost, type Session } from "../../../../src/host";
import { useT } from "../../../../src/locale";
import { useLibraryState } from "../../../../src/state";
import { Screen, useHostScopeState } from "../../../../src/shell/Shell";

type Filter = "all" | "running" | "needs-you" | "project" | "archived" | "workflow-runs";
type Sort = "recent" | "oldest" | "title";
type SearchMatch = { snippet: string; ts_ms?: number };
type HistoryMessage = { role?: string; content?: string | Array<{ type?: string; text?: string }>; timestamp?: number };
const textOf = (entry: HistoryMessage): string => {
  const text = typeof entry.content === "string" ? entry.content : (entry.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
  return entry.role === "user" ? stripInjectedUserText(text) : text;
};
const avatarPalette = ["accent", "success", "warning", "purple", "danger"] as const;
const avatarTone = (session: Session) => avatarPalette[[...`${session.agentId}:${session.ref?.runtimeId ?? ""}`].reduce((value, char) => value + char.charCodeAt(0), 0) % avatarPalette.length];

function SessionStateChip(props: { needsYou: boolean; label: string }) {
  const theme = useTheme();
  if (props.needsYou) return <StatusPill label={props.label} tone="warning" />;
  return <View testID="sessions-working-chip" accessibilityLabel={props.label} {...({ role: "status" } as object)} style={{ height: 20, paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: theme.color("success/subtle"), flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
    <View testID="sessions-live-dot" style={{ width: 6, height: 6, borderRadius: radius.full, backgroundColor: theme.color("success") }} />
    <Text variant="meta" color="success/text">{props.label}</Text>
  </View>;
}

function SessionListRow(props: { session: Session; title: string; snippet: string; project: string | null; when: string; dense: boolean; compact: boolean; needsYou: boolean; selected: boolean; anySelected: boolean; selectLabel: string; needsYouLabel: string; workingLabel: string; onSelect(): void; onOpen(): void; menu: MenuItem[]; last?: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<View>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null), longPressSelected = useRef(false);
  const { session } = props;
  const runtime = session.ref?.runtimeId ?? "unknown runtime";
  const provider = session.ref?.providerId ?? "unknown provider";
  const model = session.ref?.modelId ?? "No model selected";
  const agent = session.agentId || "main";
  const tooltip = `${props.title} · ${agent} · ${runtime} · ${provider} · ${model}`;
  const tone = avatarTone(session);
  const active = props.needsYou || session.running;
  const checkboxVisible = props.compact ? props.anySelected || props.selected : hovered || focused || props.anySelected || props.selected;
  const beginSelectionPress = () => {
    if (!props.compact) return;
    longPressSelected.current = false;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => { selectionTimer.current = null; longPressSelected.current = true; props.onSelect(); }, 500);
  };
  const cancelSelectionPress = () => { if (selectionTimer.current) clearTimeout(selectionTimer.current); selectionTimer.current = null; };
  return <ContextMenu items={props.menu} label={props.title} onLongPress={props.compact ? () => setMenuOpen(true) : undefined}><View testID={`sessions-box-${session.sessionKey}`} style={{ height: props.compact ? compactScale.control.listRow : props.dense ? 44 : 64, borderBottomWidth: props.last ? 0 : 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: props.selected ? theme.color("accent/subtle") : hovered ? theme.color("bg/hover") : "transparent" }}
    {...({ onPointerEnter: () => setHovered(!theme.touch), onPointerLeave: () => setHovered(false), onPointerDown: beginSelectionPress, onPointerUp: cancelSelectionPress, onPointerCancel: cancelSelectionPress } as object)}>
    <View style={{ height: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: props.compact ? compactScale.space.card : space[1.5], gap: props.compact ? 0 : space[1.5] }}>
      <View style={{ width: props.compact ? (props.anySelected || props.selected ? 28 : 0) : 18, alignItems: "center", justifyContent: "center", opacity: checkboxVisible ? 1 : 0 }} pointerEvents={checkboxVisible ? "auto" : "none"}>
        {checkboxVisible ? <Checkbox checked={props.selected} accessibilityLabel={`${props.selectLabel}: ${props.title}`} onChange={props.onSelect} /> : null}
      </View>
      <Tap role="button" label={`${props.title}, ${props.snippet}`} tooltip={props.compact ? undefined : { label: tooltip }} selected={props.selected} onPress={() => {
        if (longPressSelected.current) { longPressSelected.current = false; return; }
        if (props.compact && props.anySelected) props.onSelect(); else props.onOpen();
      }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={(key) => {
          if (key.key === " ") { key.preventDefault(); props.onSelect(); return; }
          if (key.key !== "ArrowDown" && key.key !== "ArrowUp") return;
          key.preventDefault();
          const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='sessions-row-']"));
          const index = rows.indexOf(document.activeElement as HTMLElement);
          rows[Math.max(0, Math.min(rows.length - 1, index + (key.key === "ArrowDown" ? 1 : -1)))]?.focus();
        }}
        testID={`sessions-row-${session.sessionKey}`}
        style={({ focused: hasFocus }) => ({ flex: 1, minWidth: 0, height: "100%", flexDirection: "row", alignItems: "center", gap: props.compact ? space[1] : space[2], paddingHorizontal: props.compact ? 0 : space[0.5], outlineWidth: hasFocus ? 2 : 0, outlineColor: theme.color("accent"), outlineOffset: -2, borderRadius: radius.sm })}>
        {props.compact ? <>
          <View testID={`sessions-avatar-${session.sessionKey}`} aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(`${tone}/subtle`) }}><Text variant="body-medium" color={`${tone}/text`}>{agent.slice(0, 1).toUpperCase()}</Text></View>
          <View testID={`sessions-title-${session.sessionKey}`} style={{ flex: 1, minWidth: 0, justifyContent: "center", gap: 2 }}>
            <Text variant="body-medium" color="text/primary" numberOfLines={1}>{props.title}</Text>
            <Text testID={`sessions-snippet-${session.sessionKey}`} variant="meta" color="text/secondary" numberOfLines={1}>{props.snippet}</Text>
          </View>
          <View testID={`sessions-right-${session.sessionKey}`} style={{ width: 88, alignItems: "flex-end", justifyContent: "center", flexShrink: 0, gap: 3 }}>
            <Text testID={`sessions-time-${session.sessionKey}`} variant="meta" color="text/tertiary" numberOfLines={1} style={{ textAlign: "right" }}>{props.when}</Text>
            <View style={{ height: 16, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>{session.pinned ? <Icon name="pin" size="xs" color="text/secondary" /> : active ? <SessionStateChip needsYou={props.needsYou} label={props.needsYou ? props.needsYouLabel : props.workingLabel} /> : null}</View>
          </View>
        </> : <>
        <View testID={`sessions-avatar-${session.sessionKey}`} aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: props.dense ? 28 : 32, height: props.dense ? 28 : 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(`${tone}/subtle`) }}>
          <Text variant="body-medium" color={`${tone}/text`}>{agent.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View testID={`sessions-title-${session.sessionKey}`} style={{ flex: 1, minWidth: 0, justifyContent: "center", gap: props.dense ? 0 : 2 }}>
          <Text variant="body-medium" color="text/primary" numberOfLines={1}>{props.title}</Text>
          {!props.dense ? <Text testID={`sessions-snippet-${session.sessionKey}`} variant="meta" color="text/secondary" numberOfLines={1}>{props.snippet}</Text> : null}
        </View>
        {!props.compact && props.project ? <View testID={`sessions-project-${session.sessionKey}`} style={{ maxWidth: 132, minWidth: 0, flexShrink: 1 }}><View style={{ flexDirection: "row", alignItems: "center", gap: space[1], maxWidth: "100%", height: 22, paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: theme.color("accent/subtle") }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color("accent") }} /><Text variant="meta" color="accent" numberOfLines={1} style={{ flexShrink: 1 }}>{props.project}</Text></View></View> : null}
        {!props.compact ? <View style={{ width: props.dense ? 86 : 94, alignItems: "flex-start" }}>{active ? <SessionStateChip needsYou={props.needsYou} label={props.needsYou ? props.needsYouLabel : props.workingLabel} /> : null}</View> : null}
        {!props.compact ? <Text testID={`sessions-model-${session.sessionKey}`} variant="meta" color="text/secondary" numberOfLines={1} style={{ width: 104 }}>{model}</Text> : null}
        <View testID={`sessions-right-${session.sessionKey}`} style={{ width: props.compact ? 88 : 72, alignItems: "flex-end", justifyContent: "center", flexShrink: 0, gap: props.compact ? 1 : 0 }}>
          <Text testID={`sessions-time-${session.sessionKey}`} variant="meta" color="text/tertiary" numberOfLines={1} style={{ textAlign: "right", fontVariant: ["tabular-nums"] }}>{props.when}</Text>
          {props.compact ? <View style={{ height: 20, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
            {active ? <SessionStateChip needsYou={props.needsYou} label={props.needsYou ? props.needsYouLabel : props.workingLabel} /> : props.needsYou ? <View testID={`sessions-unread-${session.sessionKey}`} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color("accent") }} /> : session.pinned ? <Icon name="pin" size="xs" color="text/secondary" /> : null}
          </View> : null}
        </View>
        {!props.compact ? <View style={{ width: 16, height: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {props.needsYou ? <View testID={`sessions-unread-${session.sessionKey}`} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color("accent") }} /> : session.pinned ? <Icon name="pin" size="xs" color="text/secondary" /> : null}
        </View> : null}
      </>}
      </Tap>
      {props.compact ? <IconButton ref={more} icon="more" size="sm" label={`${props.title} actions`} expanded={menuOpen} onPress={() => setMenuOpen(true)} /> : null}
      {!props.compact ? <View style={{ opacity: theme.touch && !props.compact || hovered || focused || menuOpen ? 1 : 0 }}>
        <IconButton ref={more} icon="more" size="xs" compactVisual label={theme.t("moreActions")} expanded={menuOpen} onPress={() => setMenuOpen(true)} />
      </View> : null}
      <Menu open={menuOpen} anchor={more} items={props.menu} label={props.title} onClose={() => setMenuOpen(false)} />
    </View>
  </View></ContextMenu>;
}

/** The Sessions index owns its list while open; message search uses the host's transcript index. */
export default function Sessions() {
  const t = useT(), theme = useTheme(), router = useRouter();
  const { host, sessions, sessionsLoaded, approvals, connection, status, onEvent, refreshSessions } = useHost();
  const library = useLibraryState();
  const actions = useSessionActions();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<Filter>("all"), [sort, setSort] = useState<Sort>("recent"), [runtime, setRuntime] = useState("all");
  const [selected, setSelected] = useState<string[]>([]), [snippets, setSnippets] = useState<Record<string, SearchMatch>>({}), [matches, setMatches] = useState<Record<string, SearchMatch>>({}), [searching, setSearching] = useState(false);
  const [questionWaiting, setQuestionWaiting] = useState<Record<string, boolean>>({});
  const [workflowSessions, setWorkflowSessions] = useState<Session[]>([]);
  const [dense, setDense] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const densityLabel = dense ? t("Comfortable rows") : t("Dense rows");
  const scope = useHostScopeState(t("Sessions"));
  const waiting = useMemo(() => new Set([...approvals.map((entry) => entry.sessionKey), ...Object.entries(questionWaiting).filter(([, pending]) => pending).map(([key]) => key)]), [approvals, questionWaiting]);
  const listSessions = filter === "workflow-runs" ? workflowSessions : sessions;

  useEffect(() => {
    if (!connection || status !== "connected") { setWorkflowSessions([]); return; }
    let live = true;
    void connection.call<{ sessions: Session[] }>("jagentchill.session.list", { includeWorkflowRuns: true }).then((result) => {
      if (live) setWorkflowSessions(result.sessions.filter((session) => session.origin === "workflow" || session.origin === "automation"));
    }).catch(() => { if (live) setWorkflowSessions([]); });
    return () => { live = false; };
  }, [connection, status]);

  useEffect(() => {
    if (!connection || !listSessions.length) { setSnippets({}); return; }
    let live = true;
    void Promise.all(listSessions.map(async (session) => {
      try {
        const result = await connection.call<{ messages?: HistoryMessage[] }>("jagentchill.chat.history", { sessionKey: session.sessionKey, limit: 30, maxChars: 120_000 });
        const last = [...(result.messages ?? [])].reverse().find((entry) => (entry.role === "assistant" || entry.role === "user") && textOf(entry).trim());
        return last ? [session.sessionKey, { snippet: textOf(last).replace(/\s+/g, " ").trim().slice(0, 220), ts_ms: last.timestamp }] as const : null;
      } catch { return null; }
    })).then((entries) => { if (live) setSnippets(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry))); });
    return () => { live = false; };
  }, [connection, listSessions]);

  useEffect(() => {
    if (!connection || !listSessions.length) { setQuestionWaiting({}); return; }
    let live = true;
    const refresh = async (sessionKey: string) => {
      const result = await connection.call<{ questions?: Array<{ state?: string }> }>("jagentchill.chat.question.list", { sessionKey }).catch(() => ({ questions: [] }));
      if (live) setQuestionWaiting((current) => ({ ...current, [sessionKey]: (result.questions ?? []).some((question) => question.state === "pending") }));
    };
    void Promise.all(listSessions.map((session) => refresh(session.sessionKey)));
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.chat.question.requested" && event.event !== "jagentchill.chat.question.resolved") return;
      const key = event.payload?.question?.sessionKey;
      if (typeof key === "string") void refresh(key);
    });
    return () => { live = false; off(); };
  }, [connection, onEvent, listSessions]);

  useEffect(() => {
    const term = query.trim();
    if (!term || !connection) { setMatches({}); setSearching(false); return; }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void Promise.all(listSessions.map(async (session) => {
        try {
          const result = await connection.call<{ matches?: SearchMatch[] }>("jagentchill.chat.search", { sessionKey: session.sessionKey, query: term, limit: 1 });
          return result.matches?.[0] ? [session.sessionKey, result.matches[0]] as const : null;
        } catch { return null; }
      })).then((entries) => { if (live) { setMatches(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry))); setSearching(false); } });
    }, 240);
    return () => { live = false; clearTimeout(timer); };
  }, [connection, query, listSessions]);

  const runtimes = [...new Set(listSessions.map((session) => session.ref?.runtimeId).filter((value): value is string => !!value))].sort();
  const projects = new Map(library.projects.map((project) => [project.id, project.name]));
  const visible = useMemo(() => listSessions.filter((session) => {
    if (filter === "workflow-runs" && session.origin !== "workflow" && session.origin !== "automation") return false;
    if (filter !== "workflow-runs" && (session.origin === "workflow" || session.origin === "automation")) return false;
    const archivedHere = session.archived;
    if (filter === "archived" ? !archivedHere : archivedHere) return false;
    if (filter === "running" && !session.running) return false;
    if (filter === "needs-you" && !waiting.has(session.sessionKey)) return false;
    if (filter === "project" && !session.projectId) return false;
    if (runtime !== "all" && session.ref?.runtimeId !== runtime) return false;
    const term = query.trim();
    if (term && !sessionTitle(session).toLocaleLowerCase().includes(term.toLocaleLowerCase()) && !matches[session.sessionKey]) return false;
    return true;
  }).sort((a, b) => {
    const pinOrder = Number(b.pinned) - Number(a.pinned);
    if (pinOrder) return pinOrder;
    return sort === "title" ? sessionTitle(a).localeCompare(sessionTitle(b), theme.locale) : sort === "oldest" ? a.created_ms - b.created_ms : b.created_ms - a.created_ms;
  }), [listSessions, filter, waiting, runtime, query, matches, sort, theme.locale]);

  if (scope) return <Screen title={t("Sessions")}>{scope}</Screen>;
  const organize = (keys: string[], patch: { pinned?: boolean; archived?: boolean }) => {
    if (!connection) return;
    void Promise.all(keys.map((key) => connection.call("jagentchill.session.organize", { sessionKey: key, ...patch })));
  };
  const open = (session: Session) => host && router.push(`/h/${host.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}` as never);
  const refresh = async () => { if (refreshing) return; setRefreshing(true); try { await refreshSessions(); } finally { setRefreshing(false); } };
  const filterOptions = ["all", "running", "needs-you", "project", "archived", "workflow-runs"] as const;
  const sortOptions = ["recent", "oldest", "title"] as const;
  const filterLabel: Record<Filter, string> = { all: "All sessions", running: "Working", "needs-you": "Needs you", project: "With a project", archived: "Archived", "workflow-runs": "Workflow runs" };
  const sortLabel: Record<Sort, string> = { recent: "Most recent", oldest: "Oldest", title: "Title" };
  const filterMetrics = compactSessionFilterMetrics(theme.width);

  return <Screen title={t("Sessions")} actions={<Button kind="strong" size="sm" icon="plus" label={t("New session")} onPress={() => router.push("/home?focus=1" as never)} />}>
    <View testID="sessions-index" style={{ flex: 1, minHeight: 0, alignSelf: "center", width: "100%", maxWidth: 1020, paddingHorizontal: theme.compact ? compactScale.space.side : space[4], paddingTop: space[2] }}>
      <SearchField style={{ flexGrow: 0, flexShrink: 0 }} label={t("Search sessions and messages")} placeholder={t("Search titles and messages…")} value={query} onChangeText={setQuery} debounce={0} />
      <ScrollView horizontal={theme.compact} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexDirection: "row", flexWrap: "nowrap", gap: theme.compact ? space[1] : space[2], paddingTop: space[2], paddingBottom: space[1], alignItems: "center" }}>
        {theme.compact ? <View style={{ width: filterMetrics.triggerWidth, minHeight: filterMetrics.triggerHeight }}><Button kind="secondary" size="sm" icon="filter" label={t("Filters")} testID="sessions-filters-open" onPress={() => setFiltersOpen(true)} /></View> : <>
          <Select label={t("Filter sessions")} value={filter} options={filterOptions.map((value) => ({ value, label: t(filterLabel[value]) }))} onChange={(value) => setFilter(value as Filter)} />
          <Select label={t("Sort sessions")} value={sort} options={sortOptions.map((value) => ({ value, label: t(sortLabel[value]) }))} onChange={(value) => setSort(value as Sort)} />
          <Select label={t("Runtime")} value={runtime} options={[{ value: "all", label: t("All runtimes") }, ...runtimes.map((value) => ({ value, label: value }))]} onChange={setRuntime} />
        </>}
        {selected.length ? <>
          <Text variant="meta" color="text/secondary">{t("{n} selected", { n: selected.length })}</Text>
          <Button size="xs" kind="secondary" icon="pin" label={t("Pin selected")} onPress={() => organize(selected, { pinned: true })} />
          <Button size="xs" kind="secondary" icon="archive" label={t("Archive selected")} onPress={() => { organize(selected, { archived: true }); setSelected([]); }} />
          <Button size="xs" kind="ghost" label={t("Clear selection")} onPress={() => setSelected([])} />
        </> : null}
      </ScrollView>
      {sessionsLoaded ? null : <SkeletonList rows={4} testID="sessions-loading" />}
      {sessionsLoaded && visible.length === 0 ? <EmptyState icon="chat" title={query ? t("No matching sessions") : filter === "archived" ? t("No archived sessions") : t("No sessions yet")} description={query ? t("Try another title or message search.") : t("A session is a conversation with an agent about your project.")} actions={query ? [{ label: t("Clear search"), onPress: () => setQuery("") }] : [{ label: t("New session"), onPress: () => router.push("/home?focus=1" as never) }]} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium">{visible.length} {t("Sessions")}</Text>
        <Button size="xs" kind="ghost" icon="list" label={densityLabel} onPress={() => setDense((value) => !value)} />
      </View>
      <ScrollView testID="sessions-list" style={{ flex: 1, minHeight: 0 }} refreshControl={theme.compact ? <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} /> : undefined} contentContainerStyle={{ paddingBottom: space[5], paddingTop: space[2], gap: space[3] }}>
        {(() => {
          const today = new Date();
          const day = (timestamp: number) => { const value = new Date(timestamp); return value.getFullYear() === today.getFullYear() && value.getMonth() === today.getMonth() && value.getDate() === today.getDate() ? "Today" : value.getTime() >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime() ? "Yesterday" : "Earlier"; };
          const groups = ["Pinned", "Today", "Yesterday", "Earlier"] as const;
          const sections = new Map<typeof groups[number], Session[]>(groups.map((group) => [group, []]));
          visible.forEach((session) => { const group = session.pinned ? "Pinned" : day(snippets[session.sessionKey]?.ts_ms ?? session.created_ms); sections.get(group)!.push(session); });
          return groups.filter((group) => sections.get(group)!.length > 0).map((group) => <View key={group} testID={`sessions-group-${group.toLowerCase()}`} style={{ gap: space[1] }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[1], paddingTop: space[1] }}><Text variant="meta" color="text/secondary">{t(group)}</Text><Text variant="meta" color="text/tertiary">{sections.get(group)!.length}</Text></View>
            <Card padding={0}>
              {sections.get(group)!.map((session) => {
          const needsYou = waiting.has(session.sessionKey);
          const snippet = (query.trim() ? matches[session.sessionKey]?.snippet : undefined) ?? snippets[session.sessionKey]?.snippet;
          const project = session.projectId ? projects.get(session.projectId) ?? session.projectId : null;
          const isPinned = session.pinned;
          const menu = [
            ...actions.menu(session).filter((item) => !("id" in item) || item.id !== "open"),
            { id: "pin-session", label: t(isPinned ? "Unpin" : "Pin"), icon: "pin" as const, onSelect: () => organize([session.sessionKey], { pinned: !isPinned }) },
            { id: "archive-session", label: t(session.archived ? "Unarchive" : "Archive"), icon: "archive" as const, onSelect: () => organize([session.sessionKey], { archived: !session.archived }) },
          ];
          const when = relativeTime(snippets[session.sessionKey]?.ts_ms ?? session.created_ms, Date.now(), theme.locale);
          return <SessionListRow key={session.sessionKey} session={session} title={sessionTitle(session)} snippet={(snippet || t("No messages yet")).slice(0, 220)} project={project} when={when} dense={dense} compact={theme.compact} selectLabel={t("Select session")} needsYouLabel={t("Needs you")} workingLabel={t("Working")}
            needsYou={needsYou} selected={selected.includes(session.sessionKey)} anySelected={selected.length > 0}
            onSelect={() => setSelected(selected.includes(session.sessionKey) ? selected.filter((key) => key !== session.sessionKey) : [...selected, session.sessionKey])}
            onOpen={() => open(session)} menu={menu} last={sections.get(group)!.at(-1) === session} />;
              })}
            </Card>
          </View>);
        })()}
      </ScrollView>
      {searching ? <Text testID="sessions-searching" variant="meta" color="text/secondary">{t("Searching messages…")}</Text> : null}
      {status === "connected" ? null : <Text variant="meta" color="text/secondary">{t("Host unavailable — reconnecting…")}</Text>}
      {theme.compact ? <Modal open={filtersOpen} title={t("Filters")} width={480} onClose={() => setFiltersOpen(false)}>
        <View testID="sessions-filters-sheet" style={{ padding: compactScale.space.side, gap: compactScale.space.gapMedium }}>
          <Select width={filterMetrics.fieldWidth} label={t("Filter sessions")} value={filter} options={filterOptions.map((value) => ({ value, label: t(filterLabel[value]) }))} onChange={(value) => setFilter(value as Filter)} />
          <Select width={filterMetrics.fieldWidth} label={t("Sort sessions")} value={sort} options={sortOptions.map((value) => ({ value, label: t(sortLabel[value]) }))} onChange={(value) => setSort(value as Sort)} />
          <Select width={filterMetrics.fieldWidth} label={t("Runtime")} value={runtime} options={[{ value: "all", label: t("All runtimes") }, ...runtimes.map((value) => ({ value, label: value }))]} onChange={setRuntime} />
        </View>
      </Modal> : null}
      {actions.dialogs}
    </View>
  </Screen>;
}
