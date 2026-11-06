import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { AGENT_PREFS, costLabel, noticeFocus, sessionState, tokenCount, type ChatItem, type ToolItem, formatUsd } from "@jagentchill/app-core";
import { Badge, Chip, EmptyState, Icon, IconButton, Menu, Popover, ProgressBar, StatusPill, Switch, Tap, Text, compactScale, workspaceTabMetrics, radius, space, useInsets, useTheme, useToast, type IconName, type MenuItem, inlineIcon } from "@jagentchill/ui";
import { sessionTitle, useHost } from "../host";
import { useT } from "../locale";
import { copyText } from "../platform/media";
import { onWindowKey } from "../platform/store";
import { useProjectActions } from "../projects/actions";
import { Screen, useHostScopeState, useShell } from "../shell/Shell";
import { screenScaffoldMetrics } from "../shell/safeArea.ts";
import { useLibraryState, usePref } from "../state";
import { useChat } from "./chat";
import { ChatPane } from "./ChatPane";
import { useSessionControls } from "./controls";
import { useAgentData } from "./data";
import { reasonOf } from "./errors";
import { useSessionActions } from "./sessionActions";
import { useProposals } from "./proposals/data";
import { ChangesTab, shownProposals, TimelinePreviewTab } from "./SessionTabs";
import { StepDetail } from "./Timeline";
import { AgentsTab, DockedRoster } from "./team/AgentsTab";
import { cardFocus } from "./team/focus";

const TABS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "timeline", label: "Timeline preview", icon: "film" }, { id: "changes", label: "Changes", icon: "layers" },
  { id: "worklog", label: "Worklog", icon: "list" }, { id: "diagram", label: "Diagram", icon: "flow" }, { id: "assets", label: "Assets", icon: "image" },
  { id: "agents", label: "Agents", icon: "bot" },
];
/** The session split view: the chat on the leading side, the workspace tabs on the trailing side. */
export function SessionScreen(props: { sessionKey: string; first?: string; workspaceRoute?: boolean; /** The card a notification leads to: `<kind>:<subject id>`. */ focus?: string }) {
  const t = useT();
  const theme = useTheme();
  const insets = useInsets();
  const safe = screenScaffoldMetrics(insets, theme.compact, compactScale.control.height);
  const toast = useToast();
  const router = useRouter();
  const shell = useShell();
  const scope = useHostScopeState(t("Sessions"));
  const { sessionKey } = props;
  const { host, connection, status, sessions, approvals, can, role } = useHost();
  const [routeSession, setRouteSession] = useState<typeof sessions[number] | undefined>();
  const data = useAgentData();
  const library = useLibraryState();
  const projectActions = useProjectActions();
  const actions = useSessionActions();
  const listedSession = sessions.find((candidate) => candidate.sessionKey === sessionKey);
  useEffect(() => {
    setRouteSession(undefined);
    if (listedSession || !connection) return;
    let active = true;
    void connection.call<{ session?: typeof sessions[number] }>("jagentchill.session.get", { sessionKey }).then((result) => { if (active) setRouteSession(result.session); }).catch(() => undefined);
    return () => { active = false; };
  }, [connection, listedSession, sessionKey]);
  const session = listedSession ?? routeSession;
  const chatApi = useChat(sessionKey);
  const { chat, loading, usage, send, stop, status: addStatus } = chatApi;
  const controls = useSessionControls(session, { running: chat.running, onStatus: addStatus });
  const [tab, setTab] = usePref(AGENT_PREFS.workspaceTab);
  const [pinned, setPinned] = usePref(AGENT_PREFS.workspaceShown);
  // A compact screen shows one pane at a time and opens on the chat.
  const [compactWorkspace, setCompactWorkspace] = useState(false);
  const workspace = theme.compact ? (props.workspaceRoute === true || compactWorkspace) : pinned;
  const setWorkspace = (on: boolean) => {
    if (theme.compact) {
      if (on && !props.workspaceRoute) router.push({ pathname: `/h/${host?.gatewayId}/sessions/${encodeURIComponent(sessionKey)}`, params: { workspace: "1" } } as never);
      else if (!on && props.workspaceRoute) router.back();
      else setCompactWorkspace(on);
    } else setPinned(on);
  };
  const [maximised, setMaximised] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const openChatSearch = () => { setChatSearchOpen(true); setMaximised(false); if (theme.compact) setWorkspace(false); };
  const [menu, setMenu] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [handovers, setHandovers] = useState<Array<{ text: string; itemCount: number; status: string }> | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ToolItem[]>([]);
  const [stepsTotal, setStepsTotal] = useState(0);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [followLive, setFollowLive] = useState(true);
  const menuRef = useRef<View>(null);
  const sentFirst = useRef(false);
  const mine = approvals.filter((approval) => approval.sessionKey === sessionKey);
  const connected = status === "connected";
  const mayAct = connected && can("jagentchill.agent.use") && role !== "viewer";
  const failed = chat.items.at(-1)?.kind === "error";
  const state = sessionState({ approvals: mine.length, running: chat.running, failed });
  const media = chat.items.filter((item): item is Extract<ChatItem, { kind: "media" }> => item.kind === "media");
  // The Changes and Timeline preview tabs show the session's proposals: what its agent changed in the project.
  const proposals = useProposals({ sessionKey });
  const changes = shownProposals(proposals.proposals);
  const project = session?.projectId ? library.projects.find((entry) => entry.id === session.projectId) ?? null : null;

  // A notification led here: its card is brought into view — in the conversation, or in the Team view of the Agents tab, which is opened for it.
  useEffect(() => {
    const focus = noticeFocus(props.focus);
    if (!focus) return;
    cardFocus.set(focus);
    if (focus.place === "team") { setTab("agents"); setWorkspace(true); }
    router.setParams({ focus: undefined } as never);
  }, [props.focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // The first message of a session started on Home is sent as soon as the session is open.
  useEffect(() => {
    if (loading || !props.first || sentFirst.current || !connection) return;
    sentFirst.current = true;
    router.setParams({ first: undefined } as never);
    void send(props.first);
  }, [loading, props.first, connection]); // eslint-disable-line react-hooks/exhaustive-deps
  // The worklog is indexed by the host over the full transcript. Chat rows are paged and cannot be its source.
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    setStepsLoading(true);
    void (async () => {
      const all: ToolItem[] = [];
      let before: number | undefined;
      let total = 0;
      do {
        const page = await connection.call<{ total: number; from: number; steps: Array<{ id: string; name: string; status: "completed" | "failed"; input?: string; output?: string; ts_ms?: number }> }>(
          "jagentchill.chat.steps", { sessionKey, limit: 500, ...(before !== undefined ? { before } : {}) },
        );
        total = page.total;
        all.unshift(...page.steps.map((step) => ({ kind: "tool" as const, ...step, ...(step.ts_ms !== undefined ? { started_ms: step.ts_ms } : {}) })));
        if (page.from <= 0 || page.from >= (before ?? Number.MAX_SAFE_INTEGER)) break;
        before = page.from;
      } while (true);
      if (!cancelled) { setSteps(all); setStepsTotal(total); }
    })().catch(() => { if (!cancelled) { setSteps([]); setStepsTotal(0); } }).finally(() => { if (!cancelled) setStepsLoading(false); });
    return () => { cancelled = true; };
  }, [connection, status, sessionKey, chat.running]);
  useEffect(() => { if (followLive && steps.length) setStepId(steps[steps.length - 1].id); }, [steps, followLive]);
  useEffect(() => onWindowKey((event) => { if (event.key === "F2" && !event.inField && session) { event.preventDefault(); actions.rename(session); } }), [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const canFork = controls.group?.capabilities.fork === true && !controls.group.requiresFullAccess;
  const openHandovers = async () => {
    try { setHandovers((await connection!.call<{ handovers: Array<{ text: string; itemCount: number; status: string }> }>("jagentchill.session.handover.get", { sessionKey })).handovers); }
    catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
  };
  const userMessages = chat.items.filter((item) => item.kind === "user").length;
  const sessionMenu: MenuItem[] = session ? [
    ...(theme.compact ? [
      ...(!props.workspaceRoute ? [{ id: "workspace", label: t("Open workspace"), icon: "panel-r" as IconName, onSelect: () => setWorkspace(true) }] : []),
      ...(!props.workspaceRoute ? [{ id: "search", label: t("Search conversation"), icon: "search" as IconName, onSelect: openChatSearch }] : []),
    ] : []),
    { id: "rename", label: t("Rename"), icon: "pencil", keys: ["F2"], disabled: !mayAct, onSelect: () => actions.rename(session) },
    { id: "fork", label: t("Fork session"), icon: "split", disabled: !mayAct || !canFork, onSelect: () => void actions.fork(session) },
    { id: "copy-id", label: t("Copy session ID"), icon: "copy", onSelect: () => void copyText(sessionKey).then((ok) => ok && toast.show({ kind: "success", message: t("Session ID copied") })) },
    ...(project ? [{ id: "open-project", label: t("Open project in editor"), icon: "ext" as IconName, onSelect: () => projectActions.open(project) }] : []),
    { id: "usage", label: t("Usage per turn"), icon: "graph", onSelect: () => setUsageOpen(true) },
    { id: "context", label: t("View carried context"), icon: "chat", onSelect: () => void openHandovers() },
    { type: "separator" },
    { id: "stop", label: t("Stop run"), icon: "stop", disabled: !chat.running || !mayAct, description: chat.running ? undefined : t("Nothing is running"), onSelect: () => void stop() },
    { id: "delete", label: t("Delete session…"), icon: "trash", danger: true, disabled: !mayAct, onSelect: () => actions.remove(session) },
    { type: "separator" },
    { id: "focus", label: t("Focus mode"), icon: "expand", checked: shell.focusMode, onSelect: () => shell.setFocusMode(!shell.focusMode) },
    { type: "separator" },
    { type: "caption", label: `${t("Model spend")}  ·  ${usage?.totals ? (usage.reports === "tokens-and-cost" ? formatUsd(usage.totals.cost, { estimated: true }) : `${tokenCount(usage.totals.totalTokens)} ${t("tokens")}`) : t("Not reported")}` },
    { type: "caption", label: `${t("User messages")}  ·  ${userMessages}` },
    { type: "caption", label: `${t("Generated assets")}  ·  ${media.length}` },
  ] : [];

  if (scope) return <Screen title={t("Session")}>{scope}</Screen>;
  if (!session && !loading) {
    return <Screen title={t("Session")}><EmptyState icon="chat" title={t("This session is not available")} description={t("It was deleted, or this device may not read it.")} actions={[{ label: t("New session"), onPress: () => router.push("/home?focus=1" as never) }]} /></Screen>;
  }
  const split = workspace && !theme.compact;
  const workspaceTabs = workspaceTabMetrics(theme.compact);
  const showChat = theme.compact ? !workspace : !maximised || !split;
  const step = steps.find((entry) => entry.id === stepId) ?? steps[steps.length - 1];
  const stepIndex = step ? steps.indexOf(step) : -1;
  const pickStep = (index: number) => { setFollowLive(false); setStepId(steps[Math.max(0, Math.min(steps.length - 1, index))].id); };
  const mobileHeaderOverlays = theme.compact ? <>
    <Menu open={menu} anchor={menuRef} items={sessionMenu} label={t("Session actions")} align="end" onClose={() => setMenu(false)} />
    <Popover open={usageOpen} onClose={() => setUsageOpen(false)} anchor={menuRef} align="end" width={420} label={t("Usage per turn")} title={t("Usage per turn")}>
      <View testID="usage-popover" style={{ gap: space[2] }}><Text variant="body-medium">{t("Usage per turn")}</Text><Text color="text/secondary">{usage?.totals ? `${tokenCount(usage.totals.totalTokens)} ${t("tokens")}` : t("No turn has finished in this session yet.")}</Text></View>
    </Popover>
    <Popover open={handovers !== null} onClose={() => setHandovers(null)} anchor={menuRef} align="end" width={360} label={t("Carried context")} title={t("Carried context")}>
      <View style={{ gap: space[2] }}>{handovers?.length ? <ScrollView style={{ maxHeight: 320 }}><Text variant="mono" selectable>{handovers[0]!.text}</Text></ScrollView> : <Text color="text/secondary">{t("This session has not switched runtime, so no context was carried.")}</Text>}</View>
    </Popover>
    {actions.dialogs}
  </> : null;

  return (
    <Screen bare={theme.compact} documentTitle={session ? sessionTitle(session) : t("Session")}
      title={<>
        <Text variant="body-medium" numberOfLines={1} level={1} testID="session-title" style={{ flexShrink: 1, minWidth: theme.compact ? 96 : undefined }}>{session ? sessionTitle(session) : t("Session")}</Text>
        {/* On a phone, project and access details stay in Session actions so the chat controls fit beside the title. */}
        {session && !theme.compact ? <Chip label={t("creative agent")} /> : null}
        {session?.unattended ? <Chip icon="warn" label={t("Runs without asking")} /> : null}
      </>}
      actions={theme.compact ? null : <>
        {/* The chat already shows its live turn status on a phone. Keep the title's space in the header. */}
        {state && !(theme.compact && state.label === "Working") ? <StatusPill label={t(state.label)} tone={state.tone} /> : null}
        {project && !theme.compact ? <Chip size="md" icon="folder" label={project.name} onPress={() => projectActions.open(project)} /> : null}
        {session && !theme.compact ? <Chip size="md" icon={session.access === "host" ? "globe" : "lock"} label={t(session.access === "host" ? "Shared with the host" : "Private")} /> : null}
        <IconButton icon="search" label={t("Search conversation")} testID="chat-search-open" onPress={openChatSearch} />
        <IconButton ref={menuRef} icon="more" label={t("Session actions")} expanded={menu} testID="session-menu" onPress={() => setMenu(true)} />
        {!theme.compact ? <IconButton icon="panel-r" label={t("Toggle workspace")} on={workspace} toggle onPress={() => setWorkspace(!workspace)} /> : null}
        <Menu open={menu} anchor={menuRef} items={sessionMenu} label={t("Session actions")} align="end" onClose={() => setMenu(false)} />
        <Popover open={usageOpen} onClose={() => setUsageOpen(false)} anchor={menuRef} align="end" width={420} label={t("Usage per turn")} title={t("Usage per turn")}>
          <View testID="usage-popover" style={{ width: theme.compact ? undefined : 396, gap: space[2] }}>
            <Text variant="body-medium">{t("Usage per turn")}</Text>
            {!usage || usage.turns.length === 0 ? <Text color="text/secondary">{t("No turn has finished in this session yet.")}</Text> : (
              <>
                <ScrollView style={{ maxHeight: 260 }}>
                  {usage.turns.map((turn, index) => (
                    <View key={turn.runId} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28, borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
                      <Text variant="meta" color="text/secondary" tabular style={{ width: 20 }}>{index + 1}</Text>
                      <Text variant="meta" numberOfLines={1} style={{ flex: 1 }}>{[data.catalogue?.groups.find((group) => group.runtimeId === turn.runtimeId)?.label ?? turn.runtimeId, turn.modelId].filter(Boolean).join(" · ")}</Text>
                      <Text variant="meta" tabular color="text/secondary">{turn.reported ? `${tokenCount(turn.inputTokens)} in · ${tokenCount(turn.outputTokens)} out` : ""}</Text>
                      <Text variant="meta" tabular style={{ width: 84 }} align="right">{t(costLabel(turn))}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: "row", gap: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), paddingTop: space[2] }}>
                  <Text variant="body-medium" style={{ flex: 1 }}>{t("Session total")}</Text>
                  <Text tabular>{usage.totals ? `${tokenCount(usage.totals.totalTokens)} ${t("tokens")}${usage.reports === "tokens-and-cost" ? ` · ${formatUsd(usage.totals.cost, { estimated: true })}` : ""}` : t("Not reported")}</Text>
                </View>
                {usage.unreportedTurns ? <Text variant="meta" color="text/secondary">{t("{n} turns ran on a runtime that reports no usage; they are not counted as zero.", { n: usage.unreportedTurns })}</Text> : null}
                <Text variant="meta" color="text/secondary">{t("Token counts come from the runtime. Costs are estimates.")}</Text>
              </>
            )}
          </View>
        </Popover>
        <Popover open={handovers !== null} onClose={() => setHandovers(null)} anchor={menuRef} align="end" width={480} label={t("Carried context")} title={t("Carried context")}>
          <View style={{ width: theme.compact ? undefined : 456, gap: space[2] }}>
            {handovers?.length ? handovers.slice(0, 1).map((entry, index) => (
              <View key={index} style={{ gap: space[1] }}>
                <Text variant="meta" color="text/secondary">{t("Chat history ({n} items)", { n: entry.itemCount })} · {t(entry.status === "delivered" ? "Delivered" : entry.status === "staged" ? "Travels with your next message" : "Replaced")}</Text>
                <ScrollView style={{ maxHeight: 320, backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, padding: space[2] }}><Text variant="mono" selectable>{entry.text}</Text></ScrollView>
              </View>
            )) : <Text color="text/secondary">{t("This session has not switched runtime, so no context was carried.")}</Text>}
          </View>
        </Popover>
        {actions.dialogs}
      </>}>
      <KeyboardAvoidingView style={{ flex: 1, minHeight: 0 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flex: 1, minHeight: 0, paddingBottom: safe.contentPaddingBottom }}>
      {theme.compact ? <View testID="session-mobile-header" style={{ height: safe.headerHeight, paddingTop: safe.headerPaddingTop, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), flexDirection: "row", alignItems: "center", gap: compactScale.space.gapSmall, paddingHorizontal: compactScale.space.gapSmall }}>
        <IconButton icon={inlineIcon(theme.rtl, "chev-l")} size="sm" label={t("Back")} testID="session-back" onPress={() => router.replace("/home")} />
        <Text testID="session-mobile-title" variant="body-medium" numberOfLines={1} style={{ flex: 1, minWidth: 0, ...compactScale.type.title }}>{props.workspaceRoute ? t("Workspace") : session ? sessionTitle(session) : t("Session")}</Text>
        {!props.workspaceRoute ? <IconButton ref={menuRef} icon="more" size="sm" label={t("Session actions")} expanded={menu} testID="session-menu" onPress={() => setMenu(true)} /> : <IconButton icon="chat" size="sm" label={t("Back to conversation")} testID="workspace-back-to-chat" onPress={() => router.back()} />}
      </View> : null}
      {mobileHeaderOverlays}
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {showChat ? (
          <View testID="chat-pane" style={split ? { width: "40%", minWidth: 360, maxWidth: 560 } : { flex: 1, alignItems: "center" }}>
            <View style={{ flex: 1, width: "100%", maxWidth: split ? undefined : 760, minHeight: 0 }}>
              <ChatPane session={session} sessionKey={sessionKey} chat={chatApi} controls={controls} searchOpen={chatSearchOpen} onSearchOpen={openChatSearch} onSearchClose={() => setChatSearchOpen(false)} onFork={(messageId) => session && void actions.fork(session, messageId)}
                onOpenStep={(id) => { setFollowLive(false); setStepId(id); setTab("worklog"); if (!workspace) setWorkspace(true); }} />
            </View>
          </View>
        ) : null}
        {split && showChat ? <DockedRoster sessionKey={sessionKey} mayAct={can("jagentchill.agent.use")} /> : null}
        {split || (theme.compact && workspace) ? (
          <View testID="workspace-pane" style={{ flex: 1, minWidth: 0, borderStartWidth: showChat ? 1 : 0, borderStartColor: theme.color("border/hairline") }}>
            <View role="tablist" style={{ height: workspaceTabs.height, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: space[1] }} style={{ flex: 1 }}>
                {TABS.map((item) => {
                  const count = item.id === "worklog" ? stepsTotal : item.id === "changes" ? changes.length : item.id === "assets" ? media.length : 0;
                  return (
                    <Tap key={item.id} role="tab" label={t(item.label)} selected={tab === item.id} testID={`workspace-tab-${item.id}`} onPress={() => setTab(item.id)}
                      style={(interaction) => ({ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: workspaceTabs.minTarget, paddingHorizontal: space[2] + 2, borderRadius: radius.sm, backgroundColor: tab === item.id ? theme.color("bg/subtle") : interaction.hovered ? theme.color("bg/hover") : "transparent" })}>
                      <Icon name={item.icon} size={16} color={tab === item.id ? "text/primary" : "text/secondary"} />
                      <Text variant={tab === item.id ? "body-medium" : "body"} color={tab === item.id ? "text/primary" : "text/secondary"}>{t(item.label)}</Text>
                      {count ? <Badge count={count} /> : null}
                    </Tap>
                  );
                })}
              </ScrollView>
              {theme.compact ? null : <IconButton icon="expand" label={maximised ? t("Restore workspace") : t("Maximise workspace")} size="xs" on={maximised} toggle onPress={() => setMaximised(!maximised)} />}
            </View>
            {tab === "worklog" ? (
              <View style={{ flex: 1, minHeight: 0 }}>
                <ScrollView contentContainerStyle={{ padding: space[4] }}>
                  {stepsLoading && !steps.length ? <View testID="worklog-loading" /> : step ? <StepDetail step={step} index={stepIndex} total={stepsTotal} /> : <EmptyState icon="list" title={t("No tool calls in this session yet")} description={t("Each step the agent takes is listed here with what it was asked and what came back.")} />}
                </ScrollView>
                {steps.length ? (
                  <View testID="worklog-scrubber" style={{ height: 44, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
                    <IconButton icon={inlineIcon(theme.rtl, "chev-l")} size="sm" variant="outline" label={t("Previous step")} disabled={stepIndex <= 0} onPress={() => pickStep(stepIndex - 1)} />
                    <IconButton icon={inlineIcon(theme.rtl, "chev-r")} size="sm" variant="outline" label={t("Next step")} disabled={stepIndex >= steps.length - 1} onPress={() => pickStep(stepIndex + 1)} />
                    <Text variant="meta" tabular>{stepIndex + 1} / {stepsTotal}</Text>
                    <ProgressBar thin value={(stepIndex + 1) / stepsTotal} label={t("Worklog position")} style={{ flex: 1 }} />
                    <Switch value={followLive} onChange={setFollowLive} label={t("Live")} />
                  </View>
                ) : null}
              </View>
            ) : tab === "changes" ? <ChangesTab api={proposals} sessionKey={sessionKey} />
            : tab === "timeline" ? <TimelinePreviewTab session={session} api={proposals} />
            : tab === "agents" ? <AgentsTab sessionKey={sessionKey} mayAct={can("jagentchill.agent.use")} />
            : tab === "assets" ? (
              media.length ? <ScrollView contentContainerStyle={{ padding: space[4], gap: space[2] }}>{media.map((item) => <Text key={item.id} variant="mono" numberOfLines={1}>{item.name ?? item.mediaType}</Text>)}</ScrollView>
                : <EmptyState icon="image" title={t("No assets yet")} description={t("Images, clips and audio the agent generates are collected here.")} />
            ) : <EmptyState icon="flow" title={t("No workflow in this session")} description={t("A workflow the agent builds or runs is drawn here.")} />}
          </View>
        ) : null}
      </View>
      </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
