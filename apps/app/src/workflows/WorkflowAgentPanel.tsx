import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View, type TextInput } from "react-native";
import { AGENT_PREFS, draftModel, groupOf, noRuntimeReady, preference, pushRecent, relativeTime } from "@jagentchill/app-core";
import { Button, ConfirmDialog, EdgePanel, Icon, IconButton, Menu, Text, space, useTheme, useToast, type MenuItem, SkeletonText } from "@jagentchill/ui";
import { AgentComposer } from "../agents/AgentComposer";
import { ChatPane } from "../agents/ChatPane";
import { useChat } from "../agents/chat";
import { useSessionControls, useLocalPicturesPill } from "../agents/controls";
import { useAgentData } from "../agents/data";
import { reasonOf } from "../agents/errors";
import { ModelBrowser } from "../agents/ModelBrowser";
import { useDraftThinking } from "../agents/thinking";
import { useDraftMode } from "../agents/draftMode";
import { useDraftAttachments } from "../agents/useDraftAttachments";
import { useSlashCommands } from "../agents/useSlashCommands";
import { useSkillPicker } from "../skills/SkillPicker";
import { sessionTitle, useHost, type Session } from "../host";
import { useT } from "../locale";
import { usePref, getPref } from "../state";
import { bindSplitter } from "../platform/store";

export const WORKFLOW_AGENT_PANEL = { width: 360, min: 320, floor: 760 } as const;
const WORKFLOW_AGENT_WIDTH = preference<number>("workflow.agent-panel.width", WORKFLOW_AGENT_PANEL.width, (value): value is number => typeof value === "number" && value >= WORKFLOW_AGENT_PANEL.min && value <= 2000);
export function useWorkflowAgentWidth(): number {
  const [stored] = usePref(WORKFLOW_AGENT_WIDTH);
  const { width } = useTheme();
  return width > 0 ? Math.min(stored, Math.max(WORKFLOW_AGENT_PANEL.min, Math.min(width * 0.4, width - WORKFLOW_AGENT_PANEL.floor))) : stored;
}

/** Where a workflow screen puts its agent panel: it slides in from the inline-end edge and back out to it, docked or over the screen. */
export function WorkflowAgentSlot(props: { open: boolean; overlay: boolean; children: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const [stored, setStored] = usePref(WORKFLOW_AGENT_WIDTH);
  const [drag, setDrag] = useState<number | null>(null);
  const width = theme.width > 0 ? Math.min(stored, Math.max(WORKFLOW_AGENT_PANEL.min, Math.min(theme.width * 0.4, theme.width - WORKFLOW_AGENT_PANEL.floor))) : stored;
  const size = drag ?? width;
  const splitter = useRef<View>(null), start = useRef(width), live = useRef({ width }); live.current = { width };
  useEffect(() => props.overlay ? undefined : bindSplitter(splitter.current, {
    onStart: () => { start.current = live.current.width; setDrag(start.current); },
    onDrag: (dx) => setDrag(Math.max(WORKFLOW_AGENT_PANEL.min, Math.min(2000, start.current + dx))),
    onEnd: () => setDrag((value) => { if (value !== null) setStored(value); return null; }),
    onReset: () => setStored(WORKFLOW_AGENT_PANEL.width),
  }), [props.open, props.overlay, setStored]);
  return <EdgePanel open={props.open} edge="end" size={size} fit testID="workflow-agent-slot" overlay={props.overlay} style={props.overlay ? { zIndex: 40 } : undefined}>
    <View style={{ flex: 1, width: size, minWidth: 0, height: "100%" }}>{props.children}</View>
    {!props.overlay ? <View ref={splitter} testID="workflow-agent-splitter" role="separator" aria-label={t("Resize agent panel")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, start: -4, width: 8, zIndex: 2 }} /> : null}
  </EdgePanel>;
}

/**
 * The agent panel of a workflow or of a run: the chat with the agent about what is open. It shows the most recent
 * session bound to the workflow, or the composer of a new one; the first message creates a session and binds it to
 * this workflow on the host, so the same conversation is found again from any device.
 */
export function WorkflowAgentPanel(props: { workflowId: string; workflowName: string; /** Put in front of the first message, so the agent knows what the person is looking at. */ context: string; overlay: boolean; sheet?: boolean; onClose(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter();
  const { host, status, sessions, connection, localOnly } = useHost();
  const [keys, setKeys] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | "new" | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const switcherRef = useRef<View>(null);
  const connected = status === "connected" && !!host && !localOnly;
  const load = useCallback(() => {
    if (!connection) return;
    void connection.call<{ sessionKeys: string[] }>("jagentchill.workflow.session.list", { workflowId: props.workflowId }).then((got) => setKeys(got.sessionKeys)).catch(() => setKeys([]));
  }, [connection, props.workflowId]);
  useEffect(() => { setKeys(null); load(); }, [load]);

  const bound = (keys ?? []).map((key) => sessions.find((session) => session.sessionKey === key)).filter((session): session is Session => !!session);
  const current = picked === "new" ? undefined : bound.find((session) => session.sessionKey === picked) ?? bound[0];
  const items: MenuItem[] = [
    ...bound.map((session): MenuItem => ({ id: session.sessionKey, label: sessionTitle(session), description: relativeTime(session.created_ms, Date.now(), theme.locale), icon: "chat", checked: session.sessionKey === current?.sessionKey, onSelect: () => setPicked(session.sessionKey) })),
    ...(bound.length ? [{ type: "separator" as const }] : []),
    { id: "new", label: t("New session"), icon: "plus", checked: !current, onSelect: () => setPicked("new") },
  ];
  const body: ReactNode = !connected ? (
    <View testID="wf-agent-requires-host" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
      <Icon name="device" size={32} color="text/secondary" />
      <Text variant="title-sm" level={2} align="center">{t("Requires a host")}</Text>
      <Text color="text/secondary" align="center">{status === "connecting" ? t("Connecting…") : t("Host offline — reconnecting…")}</Text>
    </View>
  ) : keys === null ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><SkeletonText lines={2} /></View>
    : current ? <PanelSession key={current.sessionKey} session={current} hostId={host!.gatewayId} />
    : <NewSession workflowId={props.workflowId} workflowName={props.workflowName} context={props.context} onCreated={(session) => { setKeys((list) => [session.sessionKey, ...(list ?? [])]); setPicked(session.sessionKey); }} />;
  return (
    <View testID="wf-agent-panel" role="complementary" aria-label={t("Agent")} {...({ dataSet: { workflow: props.workflowId } } as object)}
      style={props.sheet ? { flex: 1, minHeight: 0, height: "100%", backgroundColor: theme.color("bg/app") } : [{ width: "100%", flex: 1, height: "100%", backgroundColor: theme.color("bg/app"), borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), minHeight: 0 }, props.overlay ? [theme.elevation(2), { position: "absolute", top: 0, bottom: 0, end: 0, zIndex: 40 }] : { alignSelf: "stretch" }]}>
      <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[2], paddingEnd: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <View ref={switcherRef} style={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
          {connected ? <Button kind="ghost" size="sm" icon="chat" trailingIcon="chev-d" label={current ? sessionTitle(current) : t("New session")} expanded={switcher} testID="wf-agent-switcher" onPress={() => setSwitcher(true)} style={{ maxWidth: "100%" }} />
            : <Text variant="body-medium" style={{ paddingStart: space[1] }}>{t("Agent")}</Text>}
        </View>
        {connected && current ? <IconButton icon="ext" size="sm" label={t("Open in session view")} testID="wf-agent-open-session" onPress={() => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(current.sessionKey)}` as never)} /> : null}
        <IconButton icon="x" size="sm" label={t("Close agent panel")} testID="wf-agent-close" onPress={props.onClose} />
        <Menu open={switcher} anchor={switcherRef} items={items} label={t("Sessions of this workflow")} onClose={() => setSwitcher(false)} />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{body}</View>
    </View>
  );
}

function PanelSession(props: { session: Session; hostId: string }) {
  const router = useRouter();
  const chat = useChat(props.session.sessionKey);
  const controls = useSessionControls(props.session, { running: chat.chat.running, onStatus: chat.status });
  return <ChatPane session={props.session} sessionKey={props.session.sessionKey} chat={chat} controls={controls} onOpenStep={() => router.push(`/h/${props.hostId}/sessions/${encodeURIComponent(props.session.sessionKey)}` as never)} />;
}

/** No session is bound yet, or a new one was asked for: the first message creates it, bound to this workflow. */
function NewSession(props: { workflowId: string; workflowName: string; context: string; onCreated(session: Session): void }) {
  const t = useT(), toast = useToast();
  const { connection, role, can, addSession } = useHost();
  const agents = useAgentData();
  const [draft, setDraft] = useState("");
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
    if (group?.requiresFullAccess && !confirmed) { setConfirm(true); return; }
    setBusy(true);
    try {
      const { session } = await connection.call<{ session: Session }>("jagentchill.session.create", { ...(getPref(AGENT_PREFS.localImage) ? { pictures: true } : {}), ref: model.ref, ...(mode.modeId ? { modeId: mode.modeId } : {}), ...(thinking.optionId ? { thinkingOptionId: thinking.optionId } : {}), title: props.workflowName.slice(0, 120), toolSurface: "workflow", ...(group?.requiresFullAccess ? { confirmFullAccess: true } : {}) });
      await connection.call("jagentchill.workflow.session.bind", { workflowId: props.workflowId, sessionKey: session.sessionKey });
      addSession(session);
      setRecents(pushRecent(recents, model.ref));
      const commandName = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      const isCommand = !fileDraft.count && !!commandName && commandList.commands.some((entry) => entry.name.toLowerCase() === commandName);
      const message = isCommand ? text : await skills.prepare(`${props.context}\n\n${text || t("Please review the attached files.")}`, session.sessionKey);
      const attachmentIds = await fileDraft.register(session.sessionKey);
      await connection.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message, ...(attachmentIds.length ? { attachmentIds } : {}) });
      setDraft(""); fileDraft.clear();
      props.onCreated(session);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    finally { setBusy(false); }
  }
  return (
    <View testID="wf-agent-new" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
        {agents.catalogue === null ? <View style={{ alignSelf: "stretch" }}><SkeletonText lines={2} /></View> : <>
          <Icon name="bot" size={24} color="text/secondary" />
          <Text variant="body-medium" align="center">{t("Ask the agent about {project}", { project: props.workflowName })}</Text>
          <Text color="text/secondary" align="center">{t("The first message starts a session for this workflow.")}</Text>
        </>}
      </View>
      <View ref={anchor} style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>
        <AgentComposer docked inputRef={input} value={draft} onChangeText={setDraft} onSend={() => void send()} placeholder={t("Ask or guide the agent…")} canSend={mayAct && !!model && !busy} disabled={!mayAct}
          model={{ id: "model", label: model?.label ?? t("Select model"), icon: "bot", onPress: () => setBrowser(true) }} permission={mode.pill} skills={skills.pill} options={[thinking.pill, localPictures].filter((pill): pill is NonNullable<typeof pill> => !!pill)}
          commands={commandList.commands} commandListLoaded={commandList.loaded} commandModelLabel={model?.label ?? t("model")} attachments={fileDraft.attachments} onRemoveAttachment={fileDraft.remove} onAttach={fileDraft.pickFiles} onFiles={fileDraft.addFiles} attachOptions={[{ id: "choose-files", label: t("Choose files"), icon: "plus", onSelect: fileDraft.pickFiles }]}
          banner={fileDraft.notice ? <Text variant="meta" color="danger/text" style={{ flex: 1 }}>{fileDraft.notice}</Text> : !mayAct ? <Text variant="meta" style={{ flex: 1 }}>{t("Viewers cannot start a session")}</Text> : noRuntimeReady(agents.catalogue) ? <Text variant="meta" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>{role === "admin" ? t("Set up an AI runtime") : t("Ask an admin device to set up a runtime")}</Text> : undefined} overlays={skills.overlay} />
      </View>
      <ModelBrowser open={browser} onClose={() => setBrowser(false)} anchor={anchor} current={model?.ref ?? null} catalogue={agents.catalogue} onSelect={(next) => setRemembered(next.ref)} />
      <ConfirmDialog open={confirm} title={t("Run without asking?")} confirmLabel={t("Run without asking")} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void send(true); }}
        description={group ? t("{runtime} runs with its own permissions on the host. Confirming grants that for this session.", { runtime: group.label }) : undefined} />
    </View>
  );
}
