import { useRouter } from "expo-router";
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { View, type TextInput } from "react-native";
import { AGENT_PREFS, draftModel, groupOf, noRuntimeReady, preference, pushRecent, relativeTime } from "@jagentchill/app-core";
import { Button, ConfirmDialog, EdgePanel, Icon, IconButton, Menu, Segmented, Spinner, Text, beginPanelMotion, space, useTheme, useToast, type MenuItem, SkeletonText } from "@jagentchill/ui";
import { AgentComposer } from "../agents/AgentComposer";
import { ChatPane } from "../agents/ChatPane";
import { useChat } from "../agents/chat";
import { useSessionControls, useLocalPicturesPill } from "../agents/controls";
import { useAgentData } from "../agents/data";
import { useDraft, useSelection } from "../agents/drafts";
import { reasonOf } from "../agents/errors";
import { ModelBrowser } from "../agents/ModelBrowser";
import { useDraftThinking } from "../agents/thinking";
import { useDraftMode } from "../agents/draftMode";
import { useDraftAttachments } from "../agents/useDraftAttachments";
import { useSlashCommands } from "../agents/useSlashCommands";
import { useSkillPicker } from "../skills/SkillPicker";
import { sessionTitle, useHost, type Session } from "../host";
import { useT } from "../locale";
import { bindSplitter, onWindowKey } from "../platform/store";
import { getPref, setPref, usePref } from "../state";

/** The widths of the editor's agent panel, in px. */
export const AGENT_PANEL = { width: 360, min: 320, maxShare: 0.4, overlay: 420, editorFloor: 860 } as const;
/** Whether the panel is open and how wide it is, remembered on this device. */
const OPEN = preference<boolean>("editor.agent-panel.open", false, (value): value is boolean => typeof value === "boolean");
const WIDTH = preference<number>("editor.agent-panel.width", AGENT_PANEL.width, (value): value is number => typeof value === "number" && value >= AGENT_PANEL.min && value <= 2000);

/**
 * How the panel sits in an editor of a given width: docked at its width while the other regions keep 860 px, clamped
 * between 320 px and 40 % of the editor, and otherwise a 420 px overlay.
 */
export function agentPanelLayout(editorWidth: number, wanted: number): { mode: "docked" | "overlay"; width: number; max: number } {
  const max = Math.floor(Math.min(editorWidth * AGENT_PANEL.maxShare, editorWidth - AGENT_PANEL.editorFloor));
  if (editorWidth <= 0 || max < AGENT_PANEL.min) return { mode: "overlay", width: Math.min(AGENT_PANEL.overlay, Math.max(AGENT_PANEL.min, editorWidth)), max: AGENT_PANEL.min };
  return { mode: "docked", width: Math.min(max, Math.max(AGENT_PANEL.min, Math.round(wanted))), max };
}

let lastKeyToggle = 0;
/** Where an editor puts its agent panel: the panel slides in from the inline-end edge and back out to it, docked or over the editor. */
export function AgentPanelSlot(props: { open: boolean; editorWidth: number; children: ReactNode }) {
  const [stored] = usePref(WIDTH);
  const layout = agentPanelLayout(props.editorWidth, stored);
  const docked = layout.mode === "docked";
  // A docked panel changes the width of every other region. They take the new width once, two frames after the panel
  // has come to rest: taken at the instant the slide ends, that re-render of the editor lands inside its last frame.
  const hold = useRef<{ end(): void; frame: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const release = () => { const held = hold.current; if (!held) return; hold.current = null; cancelAnimationFrame(held.frame); clearTimeout(held.timer); held.end(); };
  const releaseSoon = () => { const held = hold.current; if (!held) return; cancelAnimationFrame(held.frame); held.frame = requestAnimationFrame(() => { if (hold.current === held) held.frame = requestAnimationFrame(release); }); };
  const change = useRef({ open: props.open, settled: true });
  if (change.current.open !== props.open) change.current = { open: props.open, settled: false };
  useLayoutEffect(() => {
    release();
    // The edge panel's own effect has run by now: with nothing to animate it is already at rest.
    if (!docked || change.current.settled) return;
    // The timer is a floor under the hold: a slide that never reports its end must not leave the editor's sizes frozen.
    hold.current = { end: beginPanelMotion(), frame: 0, timer: setTimeout(release, 1000) };
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => release, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <EdgePanel open={props.open} edge="end" size={layout.width} fit testID="agent-panel-slot" overlay={!docked} style={docked ? undefined : { zIndex: 40 }}
      onSettled={(open) => { if (open === change.current.open) change.current.settled = true; releaseSoon(); }}>
      {props.children}
    </EdgePanel>
  );
}

/** Mod+Shift+J opens and closes the panel. */
function useAgentPanelShortcut(): void {
  useEffect(() => onWindowKey((event) => {
    if (!(event.meta || event.ctrl) || !event.shift || event.key.toLowerCase() !== "j") return;
    event.preventDefault();
    // An editor kept in the navigation history listens too: one key press toggles once.
    const now = Date.now();
    if (now - lastKeyToggle < 30) return;
    lastKeyToggle = now;
    toggleAgentPanel();
  }), []);
}
/** The stored value, not a render's: a screen that is not shown does not re-render. */
export const toggleAgentPanel = (): void => setPref(OPEN, !getPref(OPEN));
export const openAgentPanel = (): void => setPref(OPEN, true);
export const closeAgentPanel = (): void => setPref(OPEN, false);

/** The open state of the panel for a screen that lays itself out around it (the script studio). */
export function useAgentPanel(): { open: boolean; toggle(): void; openPanel(): void; close(): void } {
  const [open] = usePref(OPEN);
  useAgentPanelShortcut();
  return { open, toggle: toggleAgentPanel, openPanel: openAgentPanel, close: closeAgentPanel };
}

/** The agent toggle of a top bar. Without props it reads the open state itself, so pressing it re-renders the toggle and the panel, not the screen around them. */
export function AgentPanelToggle(props: { open?: boolean; onToggle?(): void }) {
  const t = useT();
  const [stored] = usePref(OPEN);
  return <IconButton icon="bot" size="sm" label={t("Agent")} keys={["Mod", "Shift", "J"]} on={props.open ?? stored} toggle testID="toggle-agent" onPress={props.onToggle ?? toggleAgentPanel} />;
}

/**
 * The video editor's agent panel with its open state: the editor screen renders this once and is not re-rendered when
 * the panel opens or closes. `hidden` keeps it away where the editor shows the agent another way (the phone editor).
 */
// Memoised (w7): it is given four plain values, and the panel reads the host and the sessions by itself. Without this
// every render of the editor screen — each edit of the project, each change of the sync state — drew the whole chat
// again (3 400 components with a 50-message chat, also under a key typed in the composer).
export const AgentPanelDock = memo(function AgentPanelDock(props: { projectId: string; projectName: string; editorWidth: number; hidden?: boolean; commentsOpen?: boolean; commentCount?: number; onCommentsTab?(): void; onAgentTab?(): void; comments?: ReactNode }) {
  const [open] = usePref(OPEN);
  useAgentPanelShortcut();
  const showingComments = Boolean(props.commentsOpen);
  const showTabs = Boolean(props.comments);
  const shown = (open || showingComments) && !props.hidden;
  // The dock has ONE width for whatever it shows (agent or comments): the stored panel width, clamped to the editor.
  // (The slot takes its size from this box: without a width here the dock grew to fill the editor.)
  const theme = useTheme();
  const t = useT();
  const [stored, setStored] = usePref(WIDTH);
  const [drag, setDrag] = useState<number | null>(null);
  const layout = agentPanelLayout(props.editorWidth, drag ?? stored);
  const splitter = useRef<View>(null), live = useRef({ stored, max: layout.max });
  live.current = { stored, max: layout.max };
  useEffect(() => (shown && layout.mode === "docked" ? bindSplitter(splitter.current, {
    onStart: () => setDrag(live.current.stored), onDrag: (dx) => setDrag(Math.min(live.current.max, Math.max(AGENT_PANEL.min, live.current.stored - dx))),
    onEnd: () => setDrag((value) => { if (value !== null) setStored(value); return null; }), onReset: () => setStored(AGENT_PANEL.width),
  }) : undefined), [shown, layout.mode, setStored]);
  return (
    <AgentPanelSlot open={shown} editorWidth={props.editorWidth}>
      <View style={{ width: layout.width, height: layout.mode === "overlay" ? "100%" : undefined, flexGrow: 0, flexShrink: 0, alignSelf: "stretch", minHeight: 0, backgroundColor: theme.color("bg/app"), borderStartWidth: 1, borderStartColor: theme.color("border/hairline") }} testID="editor-right-dock">
        {layout.mode === "docked" ? <View ref={splitter} testID="agent-panel-splitter" role="separator" aria-label={t("Resize agent panel")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, start: -space[1], width: space[2], zIndex: 1 }} /> : null}
        {showTabs ? <View testID="editor-dock-tabs"><Segmented block size="xs" label={t("Editor dock")} value={showingComments ? "comments" : "agent"} onChange={(value) => value === "comments" ? props.onCommentsTab?.() : props.onAgentTab?.()} options={[{ value: "agent", label: t("Agent") }, { value: "comments", label: t("Comments") }]} /></View> : null}
        <View style={{ flex: 1, minHeight: 0, display: showingComments ? "none" : "flex" }}><AgentPanel projectId={props.projectId} projectName={props.projectName} editorWidth={props.editorWidth} onClose={closeAgentPanel} embedded /></View>
        {props.comments ? <View style={{ flex: 1, minHeight: 0, display: showingComments ? "flex" : "none" }}>{props.comments}</View> : null}
      </View>
    </AgentPanelSlot>
  );
});

/**
 * The editor's fifth region: the chat with the agent about the open project, at the inline-end side of the inspector.
 * It shows the most recent session bound to the project, or the composer of a new one; sending there creates a session
 * bound to this project without leaving the editor.
 */
export function AgentPanel(props: { projectId: string; /** The panel of the script studio: its sessions are bound to this script, not to a project. */ scriptId?: string; projectName: string; editorWidth: number; onClose(): void; /** The full-height sheet of the phone editor: the panel fills what holds it. */ sheet?: boolean; embedded?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { host, status, sessions, localOnly } = useHost();
  const [stored, setStored] = usePref(WIDTH);
  const [drag, setDrag] = useState<number | null>(null);
  // Kept with the drafts, outside the panel: closing the panel takes it out of the tree, and it must open again on the
  // conversation the person was in — the new-session composer included, not the newest session.
  const [picked, setPicked] = useSelection(props.scriptId ? `script:${props.scriptId}` : `project:${props.projectId}`);
  const [switcher, setSwitcher] = useState(false);
  const splitter = useRef<View>(null);
  const switcherRef = useRef<View>(null);
  const layout = agentPanelLayout(props.editorWidth, drag ?? stored);
  const live = useRef({ stored, max: layout.max });
  live.current = { stored, max: layout.max };
  // The panel grows towards the inline start: dragging the splitter that way widens it. It stops at 320 px and at its ceiling.
  useEffect(() => (layout.mode === "docked" ? bindSplitter(splitter.current, {
    onStart: () => setDrag(live.current.stored), onDrag: (dx) => setDrag(Math.min(live.current.max, Math.max(AGENT_PANEL.min, live.current.stored - dx))),
    onEnd: () => setDrag((value) => { if (value !== null) setStored(value); return null; }), onReset: () => setStored(AGENT_PANEL.width),
  }) : undefined), [layout.mode, setStored]);
  useEffect(() => (layout.mode === "overlay" ? onWindowKey((event) => { if (event.key === "Escape" && !event.inField) props.onClose(); }) : undefined), [layout.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sessions bound to this project, newest first.
  const bound = sessions.filter((session) => (props.scriptId ? session.scriptId === props.scriptId : session.projectId === props.projectId)).sort((a, b) => b.created_ms - a.created_ms);
  const current = picked === "new" ? undefined : bound.find((session) => session.sessionKey === picked) ?? bound[0];
  const connected = status === "connected" && !!host && !localOnly;
  const items: MenuItem[] = [
    ...bound.map((session): MenuItem => ({ id: session.sessionKey, label: sessionTitle(session), description: relativeTime(session.created_ms, Date.now(), theme.locale), icon: "chat", checked: session.sessionKey === current?.sessionKey, onSelect: () => setPicked(session.sessionKey) })),
    ...(bound.length ? [{ type: "separator" as const }] : []),
    { id: "new", label: t("New session"), icon: "plus", checked: !current, onSelect: () => setPicked("new") },
  ];
  const body: ReactNode = !connected ? (
    <View testID="agent-panel-requires-host" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
      <Icon name="device" size={32} color="text/secondary" />
      <Text variant="title-sm" level={2} align="center">{t("Requires a host")}</Text>
      <Text color="text/secondary" align="center">{status === "connecting" ? t("Connecting…") : status === "unavailable" ? t("Host offline — reconnecting…") : t("The agent runs on a host. Editing works without one.")}</Text>
      {status === "connecting" || status === "unavailable" ? null : <View style={{ marginTop: space[2] }}><Button kind="primary" size="sm" label={t("Connect a host")} testID="agent-panel-connect" onPress={() => router.push("/pair/start" as never)} /></View>}
    </View>
  ) : current ? <PanelSession key={current.sessionKey} session={current} hostId={host!.gatewayId} />
    : <NewSession projectId={props.projectId} scriptId={props.scriptId} projectName={props.projectName} onCreated={(session) => setPicked(session.sessionKey)} />;
  return (
    <View testID="agent-panel" {...({ dataSet: { mode: layout.mode } } as object)} role="complementary" aria-label={t("Agent")}
      style={props.sheet || props.embedded ? { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.color("bg/app") } : [{ width: layout.width, backgroundColor: theme.color("bg/app"), borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), minHeight: 0 }, layout.mode === "overlay" ? [theme.elevation(2), { position: "absolute", top: 0, bottom: 0, end: 0, zIndex: 40 }] : { alignSelf: "stretch" }]}>
      {!props.embedded && layout.mode === "docked" ? <View ref={splitter} testID="agent-panel-splitter" role="separator" aria-label={t("Resize agent panel")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, start: -space[1], width: space[2], zIndex: 1 }} /> : null}
      {!props.embedded ? <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[2], paddingEnd: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <View ref={switcherRef} style={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
          {connected ? <Button kind="ghost" size="sm" icon="chat" trailingIcon="chev-d" label={current ? sessionTitle(current) : t("New session")} expanded={switcher} testID="agent-panel-switcher" onPress={() => setSwitcher(true)} style={{ maxWidth: "100%" }} />
            : <Text variant="body-medium" style={{ paddingStart: space[1] }}>{t("Agent")}</Text>}
        </View>
        {connected && current ? <IconButton icon="ext" size="sm" label={t("Open in session view")} testID="agent-panel-open-session" onPress={() => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(current.sessionKey)}` as never)} /> : null}
        <IconButton icon="x" size="sm" label={t("Close agent panel")} testID="agent-panel-close" onPress={props.onClose} />
        <Menu open={switcher} anchor={switcherRef} items={items} label={props.scriptId ? t("Sessions of this script") : t("Sessions of this project")} onClose={() => setSwitcher(false)} />
      </View> : null}
      <View style={{ flex: 1, minHeight: 0 }}>{body}</View>
    </View>
  );
}

/** One session of the project: the same chat pane the session screen draws. */
function PanelSession(props: { session: Session; hostId: string }) {
  const router = useRouter();
  const chat = useChat(props.session.sessionKey);
  const controls = useSessionControls(props.session, { running: chat.chat.running, onStatus: chat.status });
  // The detail of a step belongs to the session view's Worklog; the panel opens it there.
  return <ChatPane session={props.session} sessionKey={props.session.sessionKey} chat={chat} controls={controls}
    onOpenStep={() => router.push(`/h/${props.hostId}/sessions/${encodeURIComponent(props.session.sessionKey)}` as never)} />;
}

/** No session is bound yet, or a new one was asked for: the first message creates it, bound to this project. */
function NewSession(props: { projectId: string; scriptId?: string; projectName: string; onCreated(session: Session): void }) {
  const t = useT();
  const toast = useToast();
  const { connection, role, can, addSession } = useHost();
  const agents = useAgentData();
  // Not component state alone: the panel leaves the tree when it closes, and what was typed must be there when it opens again.
  const [draft, setDraft] = useDraft(`new:${props.scriptId ? `script:${props.scriptId}` : `project:${props.projectId}`}`);
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [remembered, setRemembered] = usePref(AGENT_PREFS.draftModel);
  const [recents, setRecents] = usePref(AGENT_PREFS.modelRecents);
  const anchor = useRef<View>(null);
  const input = useRef<TextInput | null>(null);
  const model = draftModel(agents.catalogue, remembered, role ?? "viewer");
  const commandList = useSlashCommands({ ref: model?.ref, agentId: "main", modelLabel: model?.label });
  const group = groupOf(agents.catalogue, model?.ref);
  const mayAct = can("jagentchill.agent.use") && role !== "viewer";
  // The "make pictures on this computer" switch, before the session exists (kept on this device).
  const localPictures = useLocalPicturesPill(undefined);
  const thinking = useDraftThinking(model, !mayAct);
  const mode = useDraftMode(model, !mayAct);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const skills = useSkillPicker(undefined, anchor, { skillIds, onChange: setSkillIds, runtimeId: model?.ref.runtimeId });
  const fileDraft = useDraftAttachments();

  async function send(confirmed = false) {
    const text = draft.trim();
    if (!connection || (!text && !fileDraft.count) || busy || !model) return;
    // A runtime that runs with its own permissions on the host starts only after an admin said so.
    if (group?.requiresFullAccess && !confirmed) { setConfirm(true); return; }
    setBusy(true);
    try {
      const { session } = await connection.call<{ session: Session }>("jagentchill.session.create", { ...(getPref(AGENT_PREFS.localImage) ? { pictures: true } : {}), ref: model.ref, ...(mode.modeId ? { modeId: mode.modeId } : {}), ...(thinking.optionId ? { thinkingOptionId: thinking.optionId } : {}), ...(props.scriptId ? { scriptId: props.scriptId } : { projectId: props.projectId }), ...(group?.requiresFullAccess ? { confirmFullAccess: true } : {}) });
      addSession(session);
      setRecents(pushRecent(recents, model.ref));
      const commandName = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      const isCommand = !fileDraft.count && !!commandName && commandList.commands.some((entry) => entry.name.toLowerCase() === commandName);
      const message = isCommand ? text : await skills.prepare(text || t("Please review the attached files."), session.sessionKey);
      const attachmentIds = await fileDraft.register(session.sessionKey);
      await connection.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message, ...(attachmentIds.length ? { attachmentIds } : {}) });
      setDraft(""); fileDraft.clear();
      props.onCreated(session);
      // The session starts working at once; the editor stays where it is.
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    finally { setBusy(false); }
  }
  return (
    <View testID="agent-panel-new" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
        {agents.catalogue === null ? <SkeletonText lines={2} /> : <>
          <Icon name="bot" size={24} color="text/secondary" />
          <Text variant="body-medium" align="center">{t("Ask the agent about {project}", { project: props.projectName })}</Text>
          <Text color="text/secondary" align="center">{props.scriptId ? t("The first message starts a session for this script.") : t("The first message starts a session for this project.")}</Text>
        </>}
      </View>
      <View ref={anchor} style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>
        <AgentComposer docked inputRef={input} value={draft} onChangeText={setDraft} onSend={() => void send()} placeholder={t("Ask or guide the agent…")} canSend={mayAct && !!model && !busy} disabled={!mayAct}
          model={{ id: "model", label: model?.label ?? t("Select model"), icon: "bot", onPress: () => setBrowser(true) }} permission={mode.pill} skills={skills.pill} options={[thinking.pill, localPictures].filter((pill): pill is NonNullable<typeof pill> => !!pill)}
          commands={commandList.commands} commandListLoaded={commandList.loaded} commandModelLabel={model?.label ?? t("model")} attachments={fileDraft.attachments} onRemoveAttachment={fileDraft.remove} onAttach={fileDraft.pickFiles} onFiles={fileDraft.addFiles} attachOptions={[{ id: "choose-files", label: t("Choose files"), icon: "plus", onSelect: fileDraft.pickFiles }]}
          banner={fileDraft.notice ? <Text variant="meta" color="danger/text" style={{ flex: 1 }}>{fileDraft.notice}</Text> : !mayAct ? <Text variant="meta" style={{ flex: 1 }}>{t("Viewers cannot start a session")}</Text> : noRuntimeReady(agents.catalogue) ? <Text variant="meta" style={{ flex: 1 }}>{role === "admin" ? t("Set up an AI runtime") : t("Ask an admin device to set up a runtime")}</Text> : undefined} overlays={skills.overlay} />
      </View>
      <ModelBrowser open={browser} onClose={() => setBrowser(false)} anchor={anchor} current={model?.ref ?? null} catalogue={agents.catalogue} onSelect={(next) => setRemembered(next.ref)} />
      <ConfirmDialog open={confirm} title={t("Run without asking?")} confirmLabel={t("Run without asking")} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void send(true); }}
        description={group ? t("{runtime} runs with its own permissions on the host. Confirming grants that for this session.", { runtime: group.label }) : undefined} />
    </View>
  );
}
