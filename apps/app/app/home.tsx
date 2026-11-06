import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useLocalPicturesPill } from "../src/agents/controls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, ScrollView, View, type TextInput } from "react-native";
import { AGENT_PREFS, applyComposerKind, checklist, COMPOSER_KINDS, composerKind, draftModel, durationBadge, findModel, groupOf, noRuntimeReady, PREFS, pushRecent, relativeTime, roleConfig, sameRef, STARTER_TIPS, type OrcDescription, type ProjectSummary } from "@jagentchill/app-core";
import type { ModelRef } from "@jagentchill/protocol";
import { PICKER_ACCEPT } from "@jagentchill/media";
import { sha256Hex, uploadBlob } from "@jagentchill/client";
import {
  Button, Card, ConfirmDialog, Disclosure, Icon, IconButton, Logo, Menu, MenuList, Modal, Popover, ProgressBar, SearchField, Tap, Text, compactScale, homeScrollBottomPadding, layout, radius, space, useHostGate, useInsets, useTheme, useToast, type Attachment, type ComposerPill, type IconName, type MenuItem, SkeletonGrid,
} from "@jagentchill/ui";
import { AgentComposer } from "../src/agents/AgentComposer";
import { ContextMeter } from "../src/agents/context";
import { useFileDrop } from "../src/agents/useFileDrop";
import { startDictation } from "../src/platform/media";
import { pickFiles } from "../src/platform/store";
import { useAgentData } from "../src/agents/data";
import { reasonOf } from "../src/agents/errors";
import { hostSettingsRoute, ModelBrowser } from "../src/agents/ModelBrowser";
import { useDraftThinking } from "../src/agents/thinking";
import { useSkillPicker } from "../src/skills/SkillPicker";
import { useSlashCommands } from "../src/agents/useSlashCommands";
import { useHost, type Session } from "../src/host";
import { desktop } from "../src/platform/desktop";
import { loadSigner } from "../src/identity";
import { useT } from "../src/locale";
import { ProjectActionsProvider, useProjectActions } from "../src/projects/actions";
import { ProjectThumbnail } from "../src/projects/ProjectsScreen";
import { HostSwitcher, Screen } from "../src/shell/Shell";
import { hostSwitcherConnection, hostSwitcherDetail } from "../src/shell/host-switcher";
import { mobileHomeMustConnect } from "../src/shell/mobile-layout";
import { useSync } from "../src/sync/SyncProvider";
import { getPref, setPref, useLibraryState, usePref } from "../src/state";


export default function Home() {
  // Native stack screens are mounted outside the layout's React context tree. Keep the
  // project actions provider inside Home as well so this route has its own actions scope.
  return <ProjectActionsProvider><HomeScreen /></ProjectActionsProvider>;
}

function HomeScreen() {
  const t = useT();
  const theme = useTheme();
  const insets = useInsets();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; tips?: string; setup?: string }>();
  const actions = useProjectActions();
  const { version: syncVersion } = useSync();
  const { host, hosts, hostsLoaded, connection, status, can, addSession, role } = useHost();
  const hostPresentation = host ? hostSwitcherConnection(host, connection?.ready.transport) : null;
  const agents = useAgentData();
  const [remembered, setRemembered] = usePref(AGENT_PREFS.draftModel);
  const [recents, setRecents] = usePref(AGENT_PREFS.modelRecents);
  const [browser, setBrowser] = useState(false);
  const [setupDismissed, setSetupDismissed] = usePref(PREFS.modelSetupDismissed);
  const [setupStarted, setSetupStarted] = usePref(PREFS.modelSetupStarted);
  const [setupOpen, setSetupOpen] = useState(false);
  const [fullAccess, setFullAccess] = useState<boolean | null>(null);
  const modelRef = useRef<View>(null);
  const pageSurface = useRef<View>(null);
  const [routed, setRouted] = useState<ModelRef | null>(null);
  // What the host's Director route gives a session that names no model.
  useEffect(() => {
    if (!connection) { setRouted(null); return; }
    const read = () => void connection.call<OrcDescription>("jagentchill.orc.config.get", {}).then((orc) => {
      const config = roleConfig(orc.config, "director");
      const profile = config.profiles.find((entry) => entry.id === (config.routes.default?.primary.profileId ?? config.defaultProfileId));
      const usable = profile && orc.config.roles.director?.enabled !== false && !orc.roles.find((entry) => entry.id === "director")?.profiles.find((entry) => entry.id === profile.id)?.unusableReason;
      setRouted(usable && profile.runtime ? { runtimeId: profile.runtime, providerId: profile.provider, modelId: profile.model } : null);
    }).catch(() => setRouted(null));
    read();
    return connection.on((event) => { if (event.event === "jagentchill.orc.config.changed" || event.event === "jagentchill.provider.changed") read(); });
  }, [connection]);
  useEffect(() => { if (setupStarted && routed) { setSetupStarted(false); setSetupDismissed(true); } }, [setupStarted, routed, setSetupStarted, setSetupDismissed]);
  // The draft's model: the one chosen on this device when it can still be used; else what the routing gives; else the first ready one.
  const explicit = remembered ? draftModel(agents.catalogue, remembered, role ?? "viewer") : null;
  const followsRouting = !(explicit && sameRef(explicit.ref, remembered)) && routed !== null && findModel(agents.catalogue, routed) !== undefined;
  const model = followsRouting ? findModel(agents.catalogue, routed)! : explicit ?? draftModel(agents.catalogue, null, role ?? "viewer");
  const composerModelLabel = model ? (theme.compact ? model.label.replace(/\s+\([^)]*\)$/, "").replace(/\s+\d+(?:\.\d+)*$/, "") : model.label) : t(theme.compact ? "No runtime" : "No AI runtime is ready");
  const modelGroup = groupOf(agents.catalogue, model?.ref);
  // The "make pictures on this computer" switch, before the session exists (kept on this device).
  const localPictures = useLocalPicturesPill(undefined);
  const thinking = useDraftThinking(model);
  const nothingReady = status === "connected" && noRuntimeReady(agents.catalogue);
  const showModelSetup = !theme.compact && status === "connected" && ((model === null && !setupDismissed) || setupStarted || setupOpen);
  const library = useLibraryState();
  const [draft, setDraft] = usePref(PREFS.composerDraft);
  const [mode, setMode] = usePref(PREFS.composerMode);
  const [target, setTarget] = usePref(PREFS.composerTarget);
  const gate = useHostGate();
  const [attached, setAttached] = useState<Array<{ file: File; status: Attachment["status"]; progress: number; error?: string; thumbnail?: string }>>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const stopDictation = useRef<(() => void) | null>(null);
  const kind = composerKind(target, mode);
  const kindEntry = COMPOSER_KINDS.find((entry) => entry.id === kind)!;
  const [projectId, setProjectId] = usePref(PREFS.composerProject);
  const [dismissed, setDismissed] = usePref(PREFS.checklistDismissed);
  const [completed, setCompleted] = usePref(PREFS.checklistCompleted);
  const [busy, setBusy] = useState(false);
  const [homeComposerOpen, setHomeComposerOpen] = useState(false);
  const focusHomeComposer = useRef(false);
  const [tips, setTips] = useState(params.tips === "1");
  const [picker, setPicker] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<ProjectSummary | null>(null);
  const input = useRef<TextInput | null>(null);
  const projectRef = useRef<View>(null);
  const hostRef = useRef<View>(null);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const skillPicker = useSkillPicker(undefined, modelRef, { skillIds, onChange: setSkillIds, runtimeId: model?.ref.runtimeId });
  const menuAnchor = useRef<View>(null);
  const live = library.projects.filter((project) => project.trash === null);
  const recent = useMemo(() => [...live].sort((a, b) => b.updated_ms - a.updated_ms), [live]);
  const project = live.find((entry) => entry.id === projectId) ?? null;
  const slashCommands = useSlashCommands({ ref: model?.ref, agentId: "main", projectId: project?.id, modelLabel: model?.label });
  const connected = status === "connected";
  const list = checklist({ projects: live.length, projectsWithMedia: live.filter((entry) => entry.assets > 0).length, exportsCompleted: 0, hostsPaired: hosts.length, providersReady: 0, workflowRunsSucceeded: 0 });
  // "All set" removes the card at the next launch.
  const wasComplete = useRef(completed);
  useEffect(() => { if (list.allSet && !completed) setCompleted(true); }, [list.allSet, completed, setCompleted]);
  const openHomeComposer = (nextTarget?: "session" | "video" | "film") => {
    if (nextTarget) setTarget(nextTarget);
    focusHomeComposer.current = true;
    setHomeComposerOpen(true);
  };
  useFocusEffect(useCallback(() => () => {
    focusHomeComposer.current = false;
    setHomeComposerOpen(false);
    input.current?.blur();
    Keyboard.dismiss();
  }, []));
  useEffect(() => {
    if (!homeComposerOpen || !focusHomeComposer.current) return;
    focusHomeComposer.current = false;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [homeComposerOpen]);
  useEffect(() => { if (params.focus === "1") { if (theme.compact) openHomeComposer(); else input.current?.focus(); } if (params.tips === "1") setTips(true); }, [params.focus, params.tips]);
  useEffect(() => { if (params.setup === "1") setSetupOpen(true); }, [params.setup]);
  useEffect(() => {
    if (desktop() || !theme.compact || !hostsLoaded) return;
    // A phone is a remote for a host. If its final paired host disappears, return it to pairing even
    // when this device has completed onboarding before. Desktop and wide web retain their local Home.
    if (mobileHomeMustConnect(theme.compact, hostsLoaded, hosts.length)) {
      // Pair completion selects and persists the new host before the asynchronous host list refresh
      // finishes. Give that refresh a short window so a successful pairing is not mistaken for removal.
      const timer = setTimeout(() => router.replace("/welcome" as never), 2000);
      return () => clearTimeout(timer);
    }
    if (!getPref(PREFS.welcomeSeen)) setPref(PREFS.welcomeSeen, true);
  }, [hosts.length, hostsLoaded, router, theme.compact]);

  async function send(stay: boolean, confirmedFullAccess = false) {
    if (!connection || !host || busy) return;
    // Film creates a film from the text and opens its Story stage: a short text is the idea "Write with AI" starts with. Nothing is generated before the person asks.
    if ((target as string) === "film") {
      const story = draft.trim();
      if (!story) return;
      setBusy(true);
      try {
        const made = await connection.call<{ film: { id: string } }>("jagentchill.film.create", { title: story.replace(/\s+/g, " ").slice(0, 60).trim(), sourceText: story });
        setDraft("");
        router.push(`/h/${host.gatewayId}/film/${made.film.id}/episode/e1/story${story.length < 600 ? "?idea=1" : ""}` as never);
      } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(false); }
      return;
    }
    if (!model) { toast.show({ kind: "warning", message: t("No AI runtime is ready") }); return; }
    // Video opens the setup of a prompt-to-video run with the prompt and the chosen model; nothing starts before its estimate is seen.
    if ((target as string) === "video") { setDraft(""); router.push({ pathname: "/h/[hostId]/workflows/video", params: { hostId: host.gatewayId, prompt: draft.trim(), ...(followsRouting ? {} : { runtimeId: model.ref.runtimeId, providerId: model.ref.providerId, modelId: model.ref.modelId }) } } as never); return; }
    // A runtime that runs with its own permissions on the host starts only after an admin said so.
    if (modelGroup?.requiresFullAccess && !confirmedFullAccess) { setFullAccess(stay); return; }
    const text = draft.trim();
    if (!text && !attached.length) return;
    setBusy(true);
    try {
      // Attached media goes into the session's project: a new one when none is chosen. It is imported when that project opens.
      const files = attached.map((entry) => entry.file);
      const withMedia = files.length > 0 && !project ? await actions.createWithMedia(files, null) : null;
      const projectOfSession = project?.id ?? withMedia ?? undefined;
      const modeSupported = modelGroup?.modes.find((entry) => entry.id === mode)?.supported;
      const { session } = await connection.call<{ session: Session }>("jagentchill.session.create", {
        ...(getPref(AGENT_PREFS.localImage) && target !== "video" && target !== "film" ? { pictures: true } : {}),
        ...(followsRouting ? { role: "director" } : { ref: model.ref }), ...(projectOfSession ? { projectId: projectOfSession } : {}), ...(modeSupported && !modelGroup?.requiresFullAccess ? { modeId: mode } : {}),
        ...(modelGroup?.requiresFullAccess ? { confirmFullAccess: true } : {}), ...(thinking.optionId ? { thinkingOptionId: thinking.optionId } : {}),
      });
      addSession(session);
      setRecents(pushRecent(recents, session.ref ?? model.ref));
      if (!followsRouting) setRemembered(model.ref);
      const registered: Array<{ attachmentId: string; blobId: string; name: string; mime: string; size: number }> = [];
      for (let index = 0; index < attached.length; index++) {
        const entry = attached[index]!, file = entry.file, mime = file.type;
        const bytes = new Uint8Array(await file.arrayBuffer()), blobId = await sha256Hex(bytes);
        setAttached((current) => current.map((item, at) => at === index ? { ...item, status: "uploading", progress: 1 } : item));
        await uploadBlob({ host, signer: await loadSigner() }, { sha256: blobId, size: bytes.length, mime, name: file.name || t("Attachment"), purpose: "media", read: async (start, end) => bytes.subarray(start, end) }, {
          onProgress: ({ bytes: sent, total }) => setAttached((current) => current.map((item, at) => at === index ? { ...item, status: "uploading", progress: total ? Math.min(95, Math.round(sent / total * 95)) : 95 } : item)),
        });
        const made = await connection.call<{ attachment: { attachmentId: string } }>("jagentchill.chat.attachment.create", { sessionKey: session.sessionKey, blobId, name: file.name || t("Attachment"), mime, size: file.size });
        registered.push({ attachmentId: made.attachment.attachmentId, blobId, name: file.name || t("Attachment"), mime, size: file.size });
        setAttached((current) => current.map((item, at) => at === index ? { ...item, status: "ready", progress: 100 } : item));
      }
      const typedCommand = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      const isListedCommand = !attached.length && !!typedCommand && slashCommands.commands.some((entry) => entry.name.toLowerCase() === typedCommand);
      const message = isListedCommand ? text : await skillPicker.prepare(text || t("Please review the attached files."), session.sessionKey);
      setDraft(""); setAttached([]);
      // Video and Film start from the session through their slash commands.
      const first = target === "video" ? `/workflow ${text}` : target === "film" ? `/film ${text}` : text;
      const open = { pathname: "/h/[hostId]/sessions/[sessionId]", params: { hostId: host.gatewayId, sessionId: session.sessionKey, first } };
      if (registered.length) {
        await connection.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: message || first, attachmentIds: registered.map((entry) => entry.attachmentId) });
        if (stay) toast.show({ kind: "success", message: t("Session started"), action: { label: t("Open"), onPress: () => router.push({ ...open, params: { hostId: host.gatewayId, sessionId: session.sessionKey } } as never) } });
        else router.push({ ...open, params: { hostId: host.gatewayId, sessionId: session.sessionKey } } as never);
      } else if (stay) {
        // The session starts working at once; this screen stays.
        void connection.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: message || first }).catch((error) => toast.show({ kind: "error", message: reasonOf(error) }));
        toast.show({ kind: "success", message: t("Session started"), action: { label: t("Open"), onPress: () => router.push({ ...open, params: { hostId: host.gatewayId, sessionId: session.sessionKey } } as never) } });
      } else router.push(open as never);
    } catch (error) {
      // The draft is kept; the toast offers to try again.
      toast.show({ kind: "error", message: reasonOf(error), action: { label: t("Retry"), onPress: () => void send(stay, confirmedFullAccess) } });
    } finally { setBusy(false); }
  }
  const kindItems: MenuItem[] = COMPOSER_KINDS.map((entry) => ({ id: entry.id, label: t(entry.label), description: t(entry.text), icon: entry.icon as IconName, checked: kind === entry.id, onSelect: () => { const next = applyComposerKind(entry.id, mode); setTarget(next.target); setMode(next.mode); } }));
  const permissionPill: ComposerPill = { id: "permission", label: t(mode[0]!.toUpperCase() + mode.slice(1)), icon: "sliders", menu: [
    { id: "edit", label: t("Edit"), checked: mode === "edit", onSelect: () => setMode("edit") },
    { id: "auto", label: t("Auto"), checked: mode === "auto", onSelect: () => setMode("auto") },
  ] };
  const attachmentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/aac", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"]);
  const attach = async () => {
    if (Platform.OS !== "web") { setAttachNotice(t("File attachments are not available on this device yet.")); return; }
    const files = await pickFiles([...attachmentTypes].join(","), true);
    addFiles(files);
  };
  const addFiles = (files: FileList | File[]) => {
    const accepted: typeof attached = [];
    for (const file of Array.from(files)) {
      if (!attachmentTypes.has(file.type)) { setAttachNotice(t("{name} has a file type this chat does not accept. Accepted: images, video, audio, PDF and text files.", { name: file.name })); continue; }
      if (file.size > 50 * 1024 * 1024) { setAttachNotice(t("{name} is too large. Attachments must be 50 MB or smaller.", { name: file.name })); continue; }
      if (attached.length + accepted.length >= 10) { setAttachNotice(t("This chat accepts up to 10 files per message.")); break; }
      accepted.push({ file, status: "ready", progress: 100, ...(file.type.startsWith("image/") ? { thumbnail: URL.createObjectURL(file) } : {}) });
    }
    if (accepted.length) setAttached((current) => [...current, ...accepted].slice(0, 10));
  };
  useFileDrop(pageSurface, addFiles);
  const dictate = () => {
    if (dictating) { stopDictation.current?.(); return; }
    const base = draft ? `${draft.replace(/\s+$/, "")} ` : "";
    let spoken = "";
    const stop = startDictation(theme.locale, {
      onText: (text, final) => { if (final) spoken += text; setDraft(`${base}${spoken}${final ? "" : text}`); },
      onEnd: (error) => { setDictating(false); stopDictation.current = null; if (error && error !== "aborted" && error !== "no-speech") toast.show({ kind: "warning", message: error === "not-allowed" ? t("Allow the microphone to dictate") : t("Dictation stopped: {reason}", { reason: error }) }); },
    });
    if (!stop) { toast.show({ kind: "info", message: t("Dictation is not available in this browser") }); return; }
    stopDictation.current = stop; setDictating(true);
  };
  const attachments: Attachment[] = attached.map((entry) => ({ name: entry.file.name, status: entry.status, progress: entry.progress / 100, ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}), ...(entry.error ? { error: entry.error } : {}) }));
  const composerOverlays = <>
    <ModelBrowser open={browser} onClose={() => setBrowser(false)} anchor={modelRef} current={model?.ref ?? null} catalogue={agents.catalogue} onSelect={(next) => setRemembered(next.ref)}
      routing={routed && findModel(agents.catalogue, routed) ? { model: findModel(agents.catalogue, routed)!.label, active: followsRouting, onSelect: () => setRemembered(null) } : undefined} />
    <ConfirmDialog open={fullAccess !== null} title={t("Run without asking?")} confirmLabel={t("Run without asking")} onClose={() => setFullAccess(null)}
      onConfirm={() => { const stay = fullAccess === true; setFullAccess(null); void send(stay, true); }}
      description={t("{runtime} runs commands and changes files on {host} without asking. Confirming grants that for this session.", { runtime: modelGroup?.label ?? "", host: host?.gatewayName ?? "" })} />
    {target === "session" ? skillPicker.overlay : null}
  </>;
  const composer = (
    <AgentComposer value={draft} onChangeText={setDraft} onSend={() => void send(false)} inputRef={input} docked={theme.compact} maxLines={theme.compact ? 3 : undefined} placeholder={t("Describe the video you want, or ask for an edit…")}
      canSend={connected && can("jagentchill.agent.use") && !busy && model !== null}
      target={{ id: "kind", label: t(kindEntry.label), icon: kindEntry.icon as IconName, menu: kindItems }}
      model={{ id: "model", label: status === "unavailable" && host ? t("Reconnecting to {host}…", { host: host.gatewayName }) : !connected ? t("Set up models") : composerModelLabel, icon: "bot", onPress: () => (connected ? (nothingReady && !theme.compact ? setSetupOpen(true) : setBrowser(true)) : gate.onRequiresHost(t("Models"))) }}
      permission={permissionPill} skills={target === "session" ? skillPicker.pill : null} options={[thinking.pill, localPictures].filter((pill): pill is NonNullable<typeof pill> => !!pill)}
      onAttach={() => void attach()} attachments={attachments} onRemoveAttachment={(index) => setAttached((current) => current.filter((_, at) => at !== index))}
      commands={slashCommands.commands} commandListLoaded={slashCommands.loaded} commandModelLabel={model?.label ?? t("model")}
      onFiles={addFiles} attachOptions={[{ id: "choose-files", label: t("Choose files"), icon: "plus", onSelect: () => void attach() }]} onDictate={dictate} dictating={dictating}
      sendOptions={[{ id: "stay", label: t("Send and stay here"), icon: "arrow-up", onSelect: () => void send(true) }]}
      context={<ContextMeter runtimeLabel={modelGroup?.label ?? ""} runtimeId={model?.ref.runtimeId} providerId={model?.ref.providerId} modelId={model?.ref.modelId} contextWindow={model?.contextWindow} reports={model?.capabilities.usage} />}
      banner={attachNotice ? <Banner text={attachNotice} action={<Button size="xs" label={t("Dismiss")} onPress={() => setAttachNotice(null)} />} /> : !host ? <Banner text={t("Connect a host to use the agent")} action={<Button size="xs" label={t("Connect")} onPress={() => router.push("/welcome" as never)} />} />
        : status === "unavailable" && host ? <Banner text={t("Reconnecting to {host}…", { host: host.gatewayName })} action={<Button size="xs" label={t("Devices")} onPress={() => router.push("/devices")} />} />
        : status === "unavailable" ? <Banner text={t("Host offline — reconnecting…")} action={<Button size="xs" label={t("Devices")} onPress={() => router.push("/devices")} />} />
        : nothingReady ? <Banner text={role === "admin" ? t("Set up an AI runtime") : t("Ask an admin device to set up a runtime")} action={role === "admin" ? <><Button size="xs" label={t("Use an installed CLI")} onPress={() => router.push(hostSettingsRoute(host.gatewayId, "runtimes", "runtimes") as never)} /><Button size="xs" label={t("Sign in")} onPress={() => router.push(hostSettingsRoute(host.gatewayId, "runtimes", "keys") as never)} /></> : null} /> : undefined} overlays={composerOverlays} />
  );
  const contextRow = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1], marginTop: space[2], flexWrap: "wrap" }}>
      <View ref={projectRef}><ContextPill icon="folder" label={project ? project.name : t("No project")} hint={t("Project")} expanded={picker} onPress={() => setPicker(true)} /></View>
      <Text variant="meta" color="text/secondary">·</Text>
      <View ref={hostRef}><ContextPill icon="device" label={host?.gatewayName ?? t("This device")} hint={t("Host")} expanded={switcher} onPress={() => setSwitcher(true)} /></View>
      <HostSwitcher open={switcher} onClose={() => setSwitcher(false)} anchor={hostRef} />
      <Popover open={picker} onClose={() => { setPicker(false); setQuery(""); }} anchor={projectRef} label={t("Project")} title={t("Project")} wide padded={false}>
        <View style={{ padding: space[2], gap: space[1] }}>
          <SearchField label={t("Search projects")} placeholder={t("Search…")} size="sm" value={query} onChangeText={setQuery} debounce={0} autoFocus />
          <MenuList autoFocus={false} label={t("Project")} onClose={() => setPicker(false)} onCloseAll={() => { setPicker(false); setQuery(""); }} items={[
            { id: "none", label: t("No project"), icon: "x", checked: project === null, onSelect: () => setProjectId(null) },
            ...recent.filter((entry) => !entry.unreadable && entry.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 50).map((entry): MenuItem => ({ id: entry.id, label: entry.name, icon: "film", checked: entry.id === projectId, onSelect: () => setProjectId(entry.id) })),
            { type: "separator" }, { id: "new", label: t("New project"), icon: "plus", onSelect: () => void actions.create(null) },
          ]} />
        </View>
      </Popover>
    </View>
  );
  const modelSetup = showModelSetup ? (
    <View testID="first-run-model-setup" style={{ width: "100%", maxWidth: layout.columnComposer, alignSelf: "center" }}><Card padding={space[3]} style={{ gap: space[2] }}>
      <Text variant="body-medium" level={2}>{t("Set up your first model")}</Text>
      <Text variant="meta" color="text/secondary">{t("Choose how to connect. You can set the default in Model routing.")}</Text>
      <Text variant="meta" color="text/secondary">{t("Use a subscription you already have")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
        <Button size="sm" label={t("Claude Code subscription")} onPress={() => { setSetupStarted(true); if (host) router.push(hostSettingsRoute(host.gatewayId, "runtimes", "runtimes") as never); }} />
        <Button size="sm" label={t("ChatGPT subscription (Codex)")} onPress={() => { setSetupStarted(true); if (host) router.push(hostSettingsRoute(host.gatewayId, "runtimes", "runtimes") as never); }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
        <Button size="sm" kind="ghost" label={t("Choose a default in Model routing")} onPress={() => { setSetupStarted(true); if (host) router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never); }} />
        <Button size="sm" kind="ghost" label={t("Later")} onPress={() => { setSetupStarted(false); setSetupDismissed(true); setSetupOpen(false); }} />
      </View>
    </Card></View>
  ) : null;
  const tiles: Array<{ id: string; label: string; icon: IconName; onPress(): void }> = [
    { id: "blank", label: t("New blank project"), icon: "plus", onPress: () => void actions.create(null) },
    { id: "import", label: t("Import media"), icon: "download", onPress: () => void pickFiles(PICKER_ACCEPT, true).then((files) => { if (files.length) void actions.createWithMedia(files, null); }) },
    { id: "prompt", label: t("Prompt to video"), icon: "spark", onPress: () => { if (!connected) { gate.onRequiresHost(t("Prompt to video")); return; } openHomeComposer("video"); } },
    { id: "film", label: t("New film"), icon: "film", onPress: () => { if (!connected) { gate.onRequiresHost(t("New film")); return; } openHomeComposer("film"); } },
    { id: "template", label: t("Use a template"), icon: "template", onPress: () => router.push("/library/templates" as never) },
  ];
  const showChecklist = !dismissed && !(wasComplete.current && list.allSet);
  const checklistCard = showChecklist ? (
    <Card style={{ marginTop: space[4] }} padding={space[3]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium" level={2}>{list.allSet ? t("All set") : t("Get started")}</Text>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("{n} of {m}", { n: list.done, m: list.total })}</Text>
        <IconButton icon="x" size="xs" label={t("Dismiss Get started")} onPress={() => setDismissed(true)} />
      </View>
      <ProgressBar thin value={list.done / list.total} label={t("Get started")} style={{ marginVertical: space[2] }} />
      {list.rows.map((row) => {
        const press = row.done ? undefined : row.id === "project" ? () => router.push("/projects") : row.id === "host" ? () => router.push("/welcome" as never) : undefined;
        const content = (
          <>
            <Icon name={row.done ? "check-f" : "circle"} size={16} color={row.done ? "accent" : "text/tertiary"} label={row.done ? t("Done") : t("To do")} />
            <Text color={row.done ? "accent/text" : "text/primary"}>{t(row.label)}</Text>
          </>
        );
        return press ? <Tap key={row.id} role="button" label={t(row.label)} testID={`home-checklist-${row.id}`} onPress={press} style={(state) => ({ height: theme.touch ? 44 : 28, flexDirection: "row", alignItems: "center", gap: space[2], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>{content}</Tap>
          : <View key={row.id} testID={`home-checklist-${row.id}`} style={{ height: theme.touch ? 44 : 28, flexDirection: "row", alignItems: "center", gap: space[2] }}>{content}</View>;
      })}
      <Disclosure title={t("Show starter tips")} open={tips} onToggle={setTips}>
        {STARTER_TIPS.map((tip) => (
          <Tap key={tip.key} role="button" label={t(tip.text)} testID={tip.key} onPress={() => { setDraft(t(tip.text)); openHomeComposer(tip.target); }}
            style={(state) => ({ paddingVertical: space[1.5], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
            <Text color="text/secondary">{t(tip.text)}</Text>
          </Tap>
        ))}
      </Disclosure>
    </Card>
  ) : null;
  const projectMenu = (entry: ProjectSummary): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "ext", onSelect: () => actions.open(entry) },
    { id: "rename", label: t("Rename"), icon: "pencil", onSelect: () => actions.rename(entry) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => void actions.duplicate([entry.id]) },
    { id: "move", label: t("Move to folder"), icon: "folder", onSelect: () => actions.move([entry.id]) },
    { id: "info", label: t("Info"), icon: "info", onSelect: () => void actions.info(entry) },
    { type: "separator" }, { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => actions.trash([entry]) },
  ];

  if (theme.compact) {
    // Mobile Home keeps project creation and recents in the scroll; AI writing opens a keyboard-aware full-screen composer.
    const columns = theme.width >= 576 ? 4 : 2;
    const tileWidth = Math.max(132, Math.floor((theme.width - 2 * compactScale.space.side - compactScale.space.gapSmall) / 2));
    const quickStartTiles = [{ id: "new", label: t("New project"), icon: "plus" as IconName, onPress: () => void actions.create(null) }, ...tiles.filter((tile) => tile.id !== "blank")];
    return (
      <Screen title={<View ref={hostRef} style={{ flex: 1, alignItems: "flex-start", minWidth: 0 }}><ContextPill icon="device" label={host?.gatewayName ?? t("This device")} detail={hostPresentation ? hostSwitcherDetail(hostPresentation, t) : t("This computer")} hint={t("Host")} expanded={switcher} onPress={() => setSwitcher(true)} /><HostSwitcher open={switcher} onClose={() => setSwitcher(false)} anchor={hostRef} /></View>} documentTitle={t("Home")}>
        <View ref={pageSurface} testID="home-page" style={{ flex: 1 }}>
          <ScrollView testID="home-mobile-scroll" keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compactScale.space.side, paddingBottom: homeScrollBottomPadding(compactScale.control.height + 2 * compactScale.space.card + 1, insets.bottom), gap: compactScale.space.gapMedium, flexGrow: 1 }}>
          {host && status === "unavailable" ? <View testID="home-host-reconnecting" style={{ gap: compactScale.space.gapSmall }}>
            <Text variant="body-medium">{t("Reconnecting to {host}…", { host: host.gatewayName })}</Text>
            <Text variant="meta" color="text/secondary">{t("The agent composer, host projects and sync actions need {host} to be online.", { host: host.gatewayName })}</Text>
          </View> : null}
          <View testID="home-quick-start-row" style={{ gap: compactScale.space.gapSmall }}>
            <View testID="home-quick-start-new">
              {/* One row, the height of a control: the first action of the screen, not a banner (the owner: "cái nút new project nó to vl ra"). */}
              <Card padding={0} label={quickStartTiles[0]!.label} onPress={quickStartTiles[0]!.onPress} style={{ minHeight: 48 }}>
                <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: compactScale.space.gapSmall, paddingHorizontal: compactScale.space.card }}>
                  <Icon name="plus" size={compactScale.control.icon} color="accent" />
                  <Text variant="body-medium" style={{ flex: 1, minWidth: 0 }}>{quickStartTiles[0]!.label}</Text>
                  <Icon name="chev-r" size={compactScale.control.icon} color="text/secondary" />
                </View>
              </Card>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: compactScale.space.gapSmall }}>
              {quickStartTiles.slice(1).map((tile) => (
                <View key={tile.id} testID={`home-quick-start-${tile.id}`} style={{ width: tileWidth }}>
                  <Card padding={compactScale.space.card} label={tile.label} onPress={tile.onPress} style={{ minHeight: 64, width: tileWidth, gap: compactScale.space.gapSmall }}><Icon name={tile.icon} size={compactScale.control.icon} /><Text variant="body-medium" numberOfLines={2}>{tile.label}</Text></Card>
                </View>
              ))}
            </ScrollView>
          </View>
          <Text variant="title-sm" level={2}>{t("Recent projects")}</Text>
          {library.status === "loading" ? <SkeletonGrid items={columns} minWidth={160} testID="home-projects-skeleton" /> : library.status === "ready" && recent.length === 0 ? (
            <View testID="home-empty-projects" style={{ flexDirection: "row", alignItems: "center", gap: compactScale.space.gapSmall, paddingVertical: compactScale.space.gapSmall }}>
              <Icon name="folder" size={compactScale.control.icon} color="text/secondary" />
              <Text variant="body" color="text/secondary">{t("No projects yet")}</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", margin: -space[1] }}>
              {recent.map((entry) => (
                <View key={entry.id} style={{ width: `${100 / columns}%`, padding: space[1] }}>
                  <Tap role="button" testID={`home-recent-project-${entry.id}`} label={entry.name || t("Unreadable project")} onPress={() => actions.open(entry)} onLongPress={() => setMenuFor(entry)}
                    style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden" }}>
                    <View style={{ aspectRatio: 16 / 9 }}><ProjectThumbnail project={entry} version={actions.imageVersion + syncVersion} initialPlaceholder={theme.compact} emptyLabel={t("No media in this project yet.")} /></View>
                    <View style={{ padding: space[2] }}>
                      <Text variant="body-medium" numberOfLines={1}>{entry.name || t("Unreadable project")}</Text>
                      <Text variant="meta" color="text/secondary" numberOfLines={1}>{durationBadge(entry.duration)} · {relativeTime(entry.updated_ms, Date.now(), theme.locale)}</Text>
                    </View>
                  </Tap>
                </View>
              ))}
            </View>
          )}
          {checklistCard}
        </ScrollView>
        <View ref={modelRef} testID="home-composer-dock" style={{ flexShrink: 0, padding: compactScale.space.card, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          <Tap role="button" label={t("Ask")} testID="home-open-composer" onPress={() => openHomeComposer()} target
            style={(state) => ({ minHeight: compactScale.control.height, flexDirection: "row", alignItems: "center", gap: compactScale.space.gapSmall, paddingHorizontal: compactScale.space.card, borderWidth: 1, borderColor: theme.color(state.pressed ? "border/control" : "border/hairline"), borderRadius: radius.md, backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : theme.color("bg/app") })}>
            <Icon name="spark" size={compactScale.control.icon} color="accent" />
            <Text variant="body-medium" style={compactScale.type.section}>{t("Ask")}</Text>
            <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{t("Describe the video you want…")}</Text>
            <Icon name="chev-r" size={compactScale.control.icon} color="text/secondary" />
          </Tap>
        </View>
        <Modal open={homeComposerOpen} title={t("Describe the video you want…")} onClose={() => setHomeComposerOpen(false)} keyboardBehavior="height" footer={<View style={{ width: "100%", minWidth: 0 }}>{composer}</View>}>
          <View />
        </Modal>
        <Menu open={menuFor !== null} anchor={menuAnchor} items={menuFor ? projectMenu(menuFor) : []} label={menuFor?.name} title={menuFor?.name} onClose={() => setMenuFor(null)} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen title={t("Home")}>
        <View ref={pageSurface} testID="home-page" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", paddingTop: space[10], paddingBottom: space[10], paddingHorizontal: space[4] }}>
        <View style={{ width: "100%", maxWidth: layout.columnComposer }}>
          {modelSetup}
          <View style={{ alignItems: "center", opacity: 0.4 }}><Logo size={36} /></View>
          <Text variant="display" level={1} align="center" style={{ marginTop: space[3], marginBottom: space[5] }}>{t("What do you want to make?")}</Text>
          <View ref={modelRef} style={{ width: "100%" }}>{composer}</View>
          {contextRow}
          <View style={{ flexDirection: "row", gap: space[2], marginTop: space[5] }}>
            {tiles.map((tile) => (
              <Card key={tile.id} padding={space[2]} label={tile.label} onPress={tile.onPress} style={{ flex: 1, minWidth: 0, gap: space[1.5] }}>
                <Icon name={tile.icon} size={16} color="text/secondary" />
                <Text variant="meta" style={{ fontWeight: "500" }}>{tile.label}</Text>
              </Card>
            ))}
          </View>
          {checklistCard}
          {recent.length ? (
            <View style={{ marginTop: space[5] }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space[2] }}>
                <Text variant="body-medium" level={2} style={{ flex: 1 }}>{t("Recent projects")}</Text>
                <Button kind="link" label={t("View all")} onPress={() => router.push("/projects")} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", margin: -space[1] }}>
                {recent.slice(0, 8).map((entry) => (
                  <View key={entry.id} style={{ width: "25%", padding: space[1] }}>
                    <Tap role="button" label={entry.name || t("Unreadable project")} onPress={() => actions.open(entry)} style={{ borderRadius: radius.sm }}>
                      <View style={{ aspectRatio: 16 / 9, borderRadius: radius.sm, overflow: "hidden" }}><ProjectThumbnail project={entry} version={actions.imageVersion} /></View>
                      <Text variant="meta" numberOfLines={1} style={{ fontWeight: "500", marginTop: space[1] }}>{entry.name || t("Unreadable project")}</Text>
                      <Text variant="meta" color="text/secondary" numberOfLines={1}>{relativeTime(entry.updated_ms, Date.now(), theme.locale)}</Text>
                    </Tap>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      </View>
    </Screen>
  );
}

function Banner(props: { text: string; action: React.ReactNode }) {
  return (
    <>
      <Icon name="info" size={14} color="text/secondary" />
      {/* The text keeps a readable measure: on a narrow card the actions wrap under it. */}
      <Text variant="meta" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>{props.text}</Text>
      {props.action}
    </>
  );
}
function ContextPill(props: { icon?: IconName; label: string; hint: string; expanded: boolean; warning?: boolean; detail?: string; onPress(): void }) {
  const theme = useTheme();
  return (
    <Tap role="button" label={`${props.hint}: ${props.label}`} expanded={props.expanded} onPress={props.onPress}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: space[1], minHeight: theme.touch ? 44 : 24, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: state.hovered || state.pressed || props.expanded ? theme.color("bg/hover") : "transparent" })}>
      {props.icon ? <Icon name={props.icon} size={theme.compact ? compactScale.control.icon : 12} color="text/secondary" /> : null}
      <View style={{ flex: props.detail ? 1 : undefined, minWidth: 0 }}>
        <Text variant="meta" color={props.warning ? "warning/text" : "text/primary"} numberOfLines={1} style={theme.compact ? compactScale.type.section : { maxWidth: 160 }}>{props.label}</Text>
        {props.detail ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{props.detail}</Text> : null}
      </View>
      <Icon name="chev-d" size={theme.compact ? compactScale.control.icon : 12} color="text/secondary" />
    </Tap>
  );
}
