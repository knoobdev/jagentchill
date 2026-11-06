import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { AGENT_PREFS, findModel, groupOf, listedModes, MODE_ICON, pushRecent, refKey, type BrowserGroup, type BrowserModel } from "@jagentchill/app-core";
import { LOCAL_IMAGE_FEATURE, LOCAL_MODELS_CHANGED, type LocalModelsView, type ModelRef, type Notice, type SessionSelection } from "@jagentchill/protocol";
import { Checkbox, ConfirmDialog, Text, space, useToast, type ComposerPill, type IconName, type MenuItem } from "@jagentchill/ui";
import { useHost, type Session } from "../host";
import { useT } from "../locale";
import { getPref, setPref, usePref } from "../state";
import { useAgentData } from "./data";
import { codeOf, detailsOf, reasonOf } from "./errors";
import { ModelBrowser } from "./ModelBrowser";
import { thinkingLabel, thinkingPill } from "./thinking";

type ControlResult = { applied?: SessionSelection; pending?: { modeId: string }; notices: Notice[]; resetFeatures?: string[] };
type SwitchResult = { session: Session; switched: "model" | "runtime"; handover?: { itemCount: number }; notices: Notice[] };
const title = (text: string) => text[0].toUpperCase() + text.slice(1);

/**
 * The control row of a live session — model, mode, thinking — and what choosing in them does: a model of the same
 * runtime is a control change, a model of another runtime is a runtime switch with its confirmation, and the
 * unattended mode is granted only through its own confirmed call.
 */
export function useSessionControls(session: Session | undefined, options: { running: boolean; onStatus(text: string): void }): { pills: ComposerPill[]; modelPill: ComposerPill; overlays: ReactNode; anchor: React.RefObject<View | null>; group: BrowserGroup | undefined; model: BrowserModel | undefined } {
  const t = useT();
  const toast = useToast();
  const { connection, status, role, host } = useHost();
  const data = useAgentData();
  const anchor = useRef<View>(null);
  const [browser, setBrowser] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [switching, setSwitching] = useState<{ model: BrowserModel; group: BrowserGroup; acceptModeChange?: string } | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const [unattended, setUnattended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = usePref(AGENT_PREFS.modelRecents);

  const group = groupOf(data.catalogue, session?.ref);
  const model = findModel(data.catalogue, session?.ref);
  const connected = status === "connected";
  const readOnly = !connected || role === "viewer" || !session;
  const notices = (list: Notice[]) => { for (const notice of list) toast.show({ kind: "info", message: notice.message }); };
  const remember = (ref: ModelRef) => { setRecents(pushRecent(recents, ref)); setPref(AGENT_PREFS.draftModel, ref); };

  async function control(params: Record<string, unknown>, what: string, done: (result: ControlResult) => string | null) {
    if (!connection || !session) return;
    setPending(what);
    try {
      const result = await connection.call<ControlResult>("jagentchill.session.control.set", { sessionKey: session.sessionKey, ...params });
      notices(result.notices);
      if (result.resetFeatures?.length) toast.show({ kind: "info", message: t("Reset: {labels}", { labels: result.resetFeatures.join(", ") }) });
      const line = done(result);
      if (line) options.onStatus(line);
    } catch (error) {
      toast.show({ kind: "error", message: reasonOf(error) });
    } finally { setPending(null); }
  }

  async function runSwitch(target: { model: BrowserModel; group: BrowserGroup; acceptModeChange?: string }) {
    if (!connection || !session) return;
    setBusy(true);
    try {
      const result = await connection.call<SwitchResult>("jagentchill.session.runtime.switch", {
        sessionKey: session.sessionKey, ref: target.model.ref, idempotencyKey: `sw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        ...(target.acceptModeChange ? { acceptModeChange: target.acceptModeChange } : {}), ...(target.group.requiresFullAccess ? { confirmFullAccess: true } : {}),
      });
      if (dontAsk) setPref(AGENT_PREFS.switchConfirmed, true);
      remember(target.model.ref);
      setSwitching(null);
      if (result.switched === "runtime") toast.show({ kind: "success", message: t("Runtime switched — your chat context carries over to the next message.") });
      else options.onStatus(t("Model changed to {model}", { model: target.model.label }));
      notices(result.notices.filter((notice) => notice.code !== "summary-context" && notice.code !== "full-context"));
    } catch (error) {
      // The product mode cannot be kept: the dialog names the mode the session will take and asks again.
      const offer = codeOf(error) === "runtime/unsupported-capability" ? detailsOf(error).acceptModeChange : undefined;
      if (typeof offer === "string" && !target.acceptModeChange) setSwitching({ ...target, acceptModeChange: offer });
      else { setSwitching(null); toast.show({ kind: "error", message: reasonOf(error) }); }
    } finally { setBusy(false); }
  }

  function select(next: BrowserModel, nextGroup: BrowserGroup) {
    if (!session?.ref || readOnly) return;
    if (refKey(next.ref) === refKey(session.ref)) return;
    if (next.ref.runtimeId === session.ref.runtimeId) {
      remember(next.ref);
      void control({ ref: next.ref }, "model", () => t("Model changed to {model}", { model: next.label }));
      return;
    }
    // Crossing runtimes asks first, unless this device said not to; a runtime with its own permissions always asks.
    if (getPref(AGENT_PREFS.switchConfirmed) && !nextGroup.requiresFullAccess) void runSwitch({ model: next, group: nextGroup });
    else { setDontAsk(false); setSwitching({ model: next, group: nextGroup }); }
  }

  async function grantUnattended(enabled: boolean) {
    if (!connection || !session) return;
    setBusy(true);
    try {
      await connection.call("jagentchill.session.unattended.set", { sessionKey: session.sessionKey, enabled, ...(enabled ? { confirm: true } : {}) });
      options.onStatus(enabled ? t("Running without asking") : t("Unattended turned off"));
      setUnattended(false);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    finally { setBusy(false); }
  }

  const localPictures = useLocalPicturesPill(session, (on) => control({ features: { [LOCAL_IMAGE_FEATURE]: on } }, "local-image", () => (on ? t("Pictures are made on this computer") : t("Pictures use the Image role's model"))));
  const modes = listedModes(group, { role: role ?? "viewer" });
  const currentModeId = session?.unattended ? "unattended" : session?.pendingModeId ?? session?.modeId ?? group?.defaultModeId ?? "edit";
  const currentMode = group?.modes.find((mode) => (session?.unattended ? mode.isUnattended : mode.id === currentModeId));
  const modeItems: MenuItem[] = modes.map((mode): MenuItem => ({
    id: mode.id, label: mode.label, description: mode.supported ? mode.description : mode.reason ?? mode.description, icon: (mode.isUnattended ? "warn" : MODE_ICON[mode.id] ?? "sliders") as IconName,
    checked: mode === currentMode, disabled: readOnly || !mode.supported || (group?.requiresFullAccess ?? false), danger: mode.isUnattended,
    onSelect: () => {
      if (!session) return;
      if (mode.isUnattended) { if (!session.unattended) setUnattended(true); return; }
      void (async () => {
        if (session.unattended) await grantUnattended(false);
        setPref(AGENT_PREFS.modeByRuntime, { ...getPref(AGENT_PREFS.modeByRuntime), [session.ref?.runtimeId ?? ""]: mode.id });
        await control({ modeId: mode.id, expected: { modeId: session.modeId } }, "mode", (result) => (result.pending ? null : t("Mode changed to {mode}", { mode: mode.label })));
      })();
    },
  }));
  const thinking = model?.thinkingOptions ?? [];
  const thinkingControl = thinkingPill(t, model, session?.thinkingOptionId, {
    disabled: readOnly,
    onSelect: (optionId) => {
      if (!session?.ref) return;
      setPref(AGENT_PREFS.thinkingByModel, { ...getPref(AGENT_PREFS.thinkingByModel), [refKey(session.ref)]: optionId });
      // The value shown afterwards is the option the runtime read back.
      void control({ thinkingOptionId: optionId }, "thinking", (result) => { const applied = thinking.find((entry) => entry.id === (result.applied?.thinkingOptionId ?? optionId)); return t("Thinking set to {option}", { option: applied ? thinkingLabel(t, applied) : optionId }); });
    },
  });
  const modelLabel = model?.label ?? session?.ref?.modelId ?? t("Select model");
  const cliProvider = group?.kind === "cli" ? data.providers.find((provider) => group.providers.some((entry) => entry.providerId === provider.providerId)) : undefined;
  const cliSignedIn = cliProvider?.choices.some((choice) => choice.method === "cli" && choice.signedIn) ?? false;
  const authStatus = group?.kind === "cli"
    ? group.readiness === "needs-install" ? t("Not installed")
      : group.readiness === "needs-auth" ? t("Sign-in expired")
        : cliSignedIn ? t("Signed in") : undefined
    : undefined;
  const modelPill: ComposerPill = {
    id: "model", label: pending === "model" ? t("Changing…") : connected ? `${modelLabel}${authStatus ? ` · ${authStatus}` : ""}` : `${modelLabel} · ${t("Offline")}`,
    icon: group?.readiness === "needs-auth" ? "warn" : "bot", onPress: () => setBrowser(true),
  };
  const pills: ComposerPill[] = [
    ...(group ? [{ id: "mode", label: currentMode?.label ?? title(currentModeId), icon: (session?.pendingModeId ? "clock" : MODE_ICON[currentModeId] ?? "sliders") as IconName, unattended: session?.unattended, menu: modeItems }] : []),
    ...(thinkingControl ? [thinkingControl] : []),
    ...(localPictures ? [localPictures] : []),
  ];
  const from = group ? `${group.label} · ${model?.label ?? session?.ref?.modelId ?? ""}` : "";
  const overlays = (
    <>
      <ModelBrowser open={browser} onClose={() => setBrowser(false)} anchor={anchor} current={session?.ref ?? null} catalogue={data.catalogue} onSelect={select} />
      <ConfirmDialog open={switching !== null} title={t("Switch runtime?")} confirmLabel={t("Switch runtime")} busy={busy} onClose={() => setSwitching(null)} onConfirm={() => switching && void runSwitch(switching)}>
        {switching ? (
          <View style={{ gap: space[2] }}>
            <Text>{t("From {from} to {to}.", { from, to: `${switching.group.label} · ${switching.model.label}` })}</Text>
            <Text color="text/secondary">{t("Kept: this session, its title, the timeline you see, its project and its usage totals. The conversation so far travels to the new runtime with your next message.")}</Text>
            <Text color="text/secondary">{t("Reset: thinking, features and the unattended grant start from the new runtime's defaults.")}</Text>
            {options.running ? <Text color="warning/text">{t("The running turn is stopped first.")}</Text> : null}
            {switching.acceptModeChange ? <Text color="warning/text">{t("{runtime} cannot run in the current mode. The session will take {mode} mode.", { runtime: switching.group.label, mode: title(switching.acceptModeChange) })}</Text> : null}
            {switching.group.requiresFullAccess ? <Text color="danger/text">{t("{runtime} runs commands and changes files on {host} without asking. Confirming grants that for this session.", { runtime: switching.group.label, host: host?.gatewayName ?? "" })}</Text>
              : <Checkbox checked={dontAsk} onChange={setDontAsk} label={t("Don't ask again on this device")} />}
          </View>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog open={unattended} title={t("Run without asking?")} confirmLabel={t("Run without asking")} busy={busy} onClose={() => setUnattended(false)} onConfirm={() => void grantUnattended(true)}
        description={t("The agent will run commands and change files on {host} without asking for approval until you turn this off or the host restarts.", { host: host?.gatewayName ?? "" })} />
    </>
  );
  return { pills, modelPill, overlays, anchor, group, model };
}

/**
 * The composer switch "make pictures on this computer": shown once the local image model is downloaded (Settings ▸
 * Providers ▸ Generation ▸ Local models). It is kept on this device, so it can be ticked before the first message; a
 * session that starts while it is on takes it, and in a session it is the session's own setting.
 */
export function useLocalPicturesPill(session: Session | undefined, apply?: (on: boolean) => Promise<void> | void): ComposerPill | undefined {
  const t = useT();
  const { connection, status, role } = useHost();
  const [model, setModel] = useState<string | null>(null);
  const [kept, setKept] = usePref(AGENT_PREFS.localImage);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let live = true;
    const read = (view: LocalModelsView) => { if (live) setModel(view.installs.some((install) => install.state === "installed") ? "Qwen-Image-2.1" : null); };
    void connection.call<{ view: LocalModelsView }>("jagentchill.localModels.get", {}).then((result) => read(result.view), () => undefined);
    const off = connection.on((event) => { if (event.event === LOCAL_MODELS_CHANGED) read((event.payload as { view: LocalModelsView }).view); });
    return () => { live = false; off(); };
  }, [connection, status]);
  const writable = status === "connected" && role !== "viewer";
  // On, what is written in this session goes to the picture model as written (the host routes it); a draft shows the device's choice.
  const on = session ? session.featureValues?.[LOCAL_IMAGE_FEATURE] === true : kept;
  // A session that starts while the switch is on takes it once.
  const taken = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !model || !kept || !writable || !apply || taken.current === session.sessionKey) return;
    taken.current = session.sessionKey;
    if (session.featureValues?.[LOCAL_IMAGE_FEATURE] !== true) void apply(true);
  }, [session?.sessionKey, model, kept, writable]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!model) return undefined;
  return {
    id: "local-image", label: on ? t("Pictures: {model}", { model }) : t("Pictures: default"), icon: "image",
    menu: [{
      // On: what the person writes goes to the picture model as written — no agent reads it, so no agent's model can refuse it.
      id: "local-image-toggle", label: t("Make pictures on this computer ({model})", { model }), checked: on, disabled: !writable,
      onSelect: () => { setKept(!on); if (session && apply) void apply(!on); },
    }],
  };
}
