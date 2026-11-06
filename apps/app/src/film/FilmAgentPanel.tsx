import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type TextInput } from "react-native";
import { AGENT_PREFS, draftModel, groupOf, noRuntimeReady, preference, pushRecent } from "@jagentchill/app-core";
import { ConfirmDialog, Icon, IconButton, Text, space, useTheme, useToast, SkeletonText } from "@jagentchill/ui";
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
import { useHost, type Session } from "../host";
import { useT } from "../locale";
import { bindSplitter } from "../platform/store";
import { usePref, getPref } from "../state";

/** The default width of the film assistant, and its floor: the limits are the editor's, 320 px … 40 % of the studio row. */
export const FILM_AGENT_WIDTH = 320;
/** The film assistant resizes like the editor's agent panel: 320 px at least, 40 % of the room it shares with the stage. */
const FILM_AGENT = { min: FILM_AGENT_WIDTH, maxShare: 0.4 } as const;
/** How wide the film assistant is, remembered on this device. */
const WIDTH = preference<number>("film.agent-panel.width", FILM_AGENT_WIDTH, (value): value is number => typeof value === "number" && value >= FILM_AGENT.min && value <= 2000);

/**
 * The ceiling of the panel: 40 % of the studio row it shares with the stage. `room` is that row's measured width, 0 until
 * it is known; `own` keeps the ceiling at the floor while a width around it is unknown.
 */
function filmAgentMax(room: number, own: number): number {
  const available = room > 0 ? room : own;
  return Math.max(FILM_AGENT.min, Math.floor(available * FILM_AGENT.maxShare));
}

/**
 * The film assistant: the chat with the agent about the open film, at the inline-start side of the studio. It shows the
 * most recent session bound to the film, or the composer of a new one; the first message creates a session bound to
 * the film on the host (the binding a script studio session uses), so the conversation is found again from any device.
 */
export function FilmAgentPanel(props: { filmId: string; filmTitle: string; /** Put in front of the first message, so the agent knows what the person is looking at. */ context: string; sheet?: boolean; onClose(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter();
  const { host, status, sessions, localOnly } = useHost();
  const [fresh, setFresh] = useState(false);
  const [stored, setStored] = usePref(WIDTH);
  const [drag, setDrag] = useState<number | null>(null);
  const [room, setRoom] = useState(0);
  const root = useRef<View>(null);
  const splitter = useRef<View>(null);
  // The rendered width is always inside the limits, whatever is on screen: the drag, a saved width, or the default.
  const max = filmAgentMax(room, stored);
  const width = Math.min(max, Math.max(FILM_AGENT.min, drag ?? stored));
  const live = useRef({ width, max });
  live.current = { width, max };
  // A drag starts from the rendered (clamped) width, not the saved one: a 700 px preference shown at a 400 px ceiling
  // narrows on the first pixel. `from` holds that base, captured at pointer-down and left alone until the drag ends.
  const from = useRef(width);
  // The studio row the panel shares with the stage is the ceiling's base; re-read it on mount and whenever that row resizes.
  useEffect(() => {
    if (props.sheet) return;
    const parent = (root.current as unknown as { parentElement?: { getBoundingClientRect(): { width: number } } } | null)?.parentElement;
    if (!parent) return;
    const read = () => setRoom(parent.getBoundingClientRect().width);
    read();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : undefined;
    observer?.observe(parent as unknown as Element);
    globalThis.addEventListener?.("resize", read);
    return () => { observer?.disconnect(); globalThis.removeEventListener?.("resize", read); };
  }, [props.sheet]);
  // The panel grows towards the inline end: dragging its inner edge that way widens it, clamped at 320 px and its ceiling.
  // `bindSplitter` reports `dx` as a pointer delta along the inline axis already (it negates it when the document is RTL,
  // the same `document.documentElement.dir` that `theme.rtl` reads), so `+ dx` widens in both directions; the handle's
  // physical side is what changes, not the sign.
  useEffect(() => (props.sheet ? undefined : bindSplitter(splitter.current, {
    onStart: () => { from.current = live.current.width; setDrag(from.current); },
    onDrag: (dx) => setDrag(Math.min(live.current.max, Math.max(FILM_AGENT.min, from.current + dx))),
    onEnd: () => setDrag((value) => { if (value !== null) setStored(value); return null; }),
    onReset: () => setStored(FILM_AGENT_WIDTH),
  })), [props.sheet, setStored]);
  const connected = status === "connected" && !!host && !localOnly;
  const bound = sessions.filter((session) => session.scriptId === props.filmId).sort((a, b) => b.created_ms - a.created_ms);
  const current = fresh ? undefined : bound[0];
  const body: ReactNode = !connected ? (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
      <Icon name="device" size={32} color="text/secondary" />
      <Text variant="title-sm" level={2} align="center">{t("Requires a host")}</Text>
      <Text color="text/secondary" align="center">{status === "connecting" ? t("Connecting…") : t("Host offline — reconnecting…")}</Text>
    </View>
  ) : current ? <PanelSession key={current.sessionKey} session={current} hostId={host!.gatewayId} />
    : <NewSession filmId={props.filmId} filmTitle={props.filmTitle} context={props.context} onCreated={() => setFresh(false)} />;
  return (
    <View ref={root} testID="film-agent-panel" role="complementary" aria-label={t("Film assistant")} {...({ dataSet: { film: props.filmId, session: current?.sessionKey ?? "" } } as object)}
      style={props.sheet ? { flex: 1, minHeight: 0, backgroundColor: theme.color("bg/app") } : { width, alignSelf: "stretch", minHeight: 0, backgroundColor: theme.color("bg/app"), ...(theme.rtl ? { borderLeftWidth: 1, borderLeftColor: theme.color("border/hairline") } : { borderRightWidth: 1, borderRightColor: theme.color("border/hairline") }) }}>
      {/* The handle sits on the panel's inner edge — the one that touches the stage. The panel is at the inline start, so
          that is its physical right when LTR and its physical left when RTL; choosing `left`/`right` from `theme.rtl`
          avoids React Native Web resolving `start`/`end` with a locale context that stays LTR. */}
      {props.sheet ? null : <View ref={splitter} testID="film-agent-splitter" role="separator" aria-label={t("Resize film assistant")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, width: space[2], zIndex: 1, ...(theme.rtl ? { left: -space[1] } : { right: -space[1] }) }} />}
      <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[3], paddingEnd: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Icon name="bot" size="sm" color="text/secondary" />
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{t("Film assistant")}</Text>
        {connected && current ? <IconButton icon="plus" size="sm" label={t("New session")} testID="film-agent-new-session" onPress={() => setFresh(true)} /> : null}
        {connected && current ? <IconButton icon="ext" size="sm" label={t("Open in session view")} onPress={() => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(current.sessionKey)}` as never)} /> : null}
        <IconButton icon="x" size="sm" label={t("Close film assistant")} testID="film-agent-close" onPress={props.onClose} />
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

/** No session is bound yet, or a new one was asked for: the first message creates it, bound to this film. */
function NewSession(props: { filmId: string; filmTitle: string; context: string; onCreated(session: Session): void }) {
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
      const { session } = await connection.call<{ session: Session }>("jagentchill.session.create", { ...(getPref(AGENT_PREFS.localImage) ? { pictures: true } : {}), ref: model.ref, modeId: mode.modeId, scriptId: props.filmId, ...(thinking.optionId ? { thinkingOptionId: thinking.optionId } : {}), title: props.filmTitle.slice(0, 120), ...(group?.requiresFullAccess ? { confirmFullAccess: true } : {}) });
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
    <View testID="film-agent-new" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
        {agents.catalogue === null ? <View style={{ alignSelf: "stretch" }}><SkeletonText lines={2} /></View> : <>
          <Icon name="bot" size={24} color="text/secondary" />
          <Text variant="body-medium" align="center">{t("Ask the agent about {project}", { project: props.filmTitle })}</Text>
          <Text color="text/secondary" align="center">{t("The first message starts a session for this film.")}</Text>
        </>}
      </View>
      <View ref={anchor} style={{ paddingHorizontal: space[3], paddingBottom: space[3] }}>
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
