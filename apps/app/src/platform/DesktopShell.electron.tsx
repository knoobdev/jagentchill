import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { EDITOR_BINDINGS, formatDateTime, parseDeepLink } from "@jagentchill/app-core";
import { menuLabels } from "@jagentchill/desktop-core/renderer";
import { AppMenu, Banner, Button, Callout, Card, Input, Modal, ProgressDialog, Switch, Text, space, useTheme, useToast, type AppMenuModel, type MenuItem } from "@jagentchill/ui";
import { exportService } from "../editor/export/service";
import { useHost } from "../host";
import { useT } from "../locale";
import { useProjectActions } from "../projects/actions";
import { useLibraryState } from "../state";
import { OtpCells } from "../shell/Otp";
import { DESKTOP_ACTION_EVENT, DESKTOP_MEDIA_EVENT, requireDesktop, type BackgroundState, type DesktopActionDetail, type DesktopFile, type HostStatus, type LibraryStatus, type MenuNode, type TailnetStatus, type TopMenu, type UpdateState } from "./desktop";
import type { PairingRequest } from "../host";
import { fileFromDesktop } from "./store.electron";
import { deviceConnectionPath } from "../pairing/connection-path";

const bridge = requireDesktop();

/** The library folder states only the desktop app has: missing, rebuilding its index, open elsewhere, and a move in progress. */
function LibraryFolder(props: { moving: boolean; onMoved(): void }) {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<LibraryStatus>({ state: "opening" });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ file: string; value: number } | null>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const apply = (next: LibraryStatus) => {
      setStatus(next);
      if (next.state !== "ready") return;
      // Another folder is now the library: everything in memory belongs to the old one.
      if (opened.current && opened.current !== next.path) window.location.reload();
      opened.current = next.path;
    };
    void bridge.library.status().then(apply);
    const off = bridge.library.onStatus(apply);
    const offProgress = bridge.library.onMoveProgress((p) => setProgress({ file: p.file, value: p.totalBytes ? p.copiedBytes / p.totalBytes : 0 }));
    return () => { off(); offProgress(); };
  }, []);
  const run = async (action: "retry" | "locate" | "create" | "quit") => {
    if (action === "quit") return void bridge.app.quit();
    setBusy(true);
    try { setStatus(await (action === "retry" ? bridge.library.retry() : action === "locate" ? bridge.library.locate() : bridge.library.createHere())); }
    catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!props.moving) return;
    (async () => {
      const target = await bridge.library.chooseMoveTarget();
      if (!target) return props.onMoved();
      setProgress({ file: "", value: 0 });
      const result = await bridge.library.move(target.token).catch((error: Error) => ({ moved: false as const, message: t("The library was not moved"), reason: error.message, code: "copy-failed" }));
      setProgress(null);
      props.onMoved();
      if (!result.moved) toast.show({ kind: "error", message: `${result.message}: ${result.reason}`, sticky: true });
      else toast.show({ kind: "success", message: t("Project library moved to {path}", { path: result.library }) });
    })();
  }, [props.moving]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {status.state === "blocked" ? (
        <Modal title={t("Project library")} description={status.message} blocking hideClose onClose={() => {}} width={480}
          footer={(
            <View testID="library-missing" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] }}>
              {status.actions.map((action) => (
                <Button key={action.id} testID={`library-${action.id}`} label={action.label} kind={action.id === "locate" ? "primary" : action.id === "quit" ? "ghost" : "secondary"} disabled={!action.enabled || busy} onPress={() => void run(action.id)} />
              ))}
            </View>
          )}>
          <Text color="text/secondary">{t("No project was changed or removed. Connect the drive and retry, or choose where the library is.")}</Text>
        </Modal>
      ) : null}
      {status.state === "ready" && status.rebuilding ? <ProgressDialog open title={status.rebuilding} value={null} onClose={() => {}} /> : null}
      {status.state === "ready" && status.banner ? (
        <View testID="library-read-only" style={{ position: "absolute", top: space[2], alignSelf: "center", zIndex: 200 }}><Callout tone="warning">{status.banner}</Callout></View>
      ) : null}
      <ProgressDialog open={progress !== null} title={t("Moving project library…")} step={progress?.file} value={progress?.value ?? null} onCancel={() => void bridge.library.cancelMove()} onClose={() => {}} />
    </>
  );
}

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function Row(props: { name: string; value: string | number | undefined | null; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space[3], paddingVertical: space[1] }}>
      <Text color="text/secondary" style={{ width: 168 }}>{props.name}</Text>
      <Text testID={props.testID} selectable style={{ flex: 1 }}>{props.value === undefined || props.value === null || props.value === "" ? "—" : String(props.value)}</Text>
    </View>
  );
}

/** A pending device request is surfaced as a desktop modal from every route, while Devices owns its own detailed view. */
function PairingRequestPopup() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { connection, pairingRequests, dismissPairingRequest, can } = useHost();
  const [now, setNow] = useState(Date.now());
  const request: PairingRequest | undefined = pairingRequests[0];
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request?.requestId]);
  if (!request || !connection || !can("jagentchill.devices.manage") || /^\/(?:devices|settings\/devices|settings\/host\/[^/]+\/(?:connections|devices))(?:\/|$)/.test(pathname)) return null;
  const decline = () => void connection.call("jagentchill.pairing.request.decline", { requestId: request.requestId }).then(() => dismissPairingRequest(request.requestId), (error: Error) => toast.show({ kind: "error", message: error.message }));
  const review = () => router.push(`/devices?requestId=${encodeURIComponent(request.requestId)}` as never);
  return (
    <Modal priority={100} title={t("A new device wants to pair")} description={t("Type this code on the new device. It is shown only here and on the host command line.")}
      onClose={() => dismissPairingRequest(request.requestId)}
      footer={<>
        <Button kind="ghost" tone="danger" label={t("Decline")} onPress={decline} />
        <View style={{ flex: 1 }} />
        <Button kind="primary" testID="pairing-request-popup-review" label={t("Review request")} onPress={review} />
      </>}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-medium">{request.deviceName}</Text>
          <Text variant="meta" color="text/secondary">{t("{host} · {path} · {role} · key {key}", { host: request.platform, path: t(deviceConnectionPath(request.transport)), role: t(request.role), key: request.deviceId.slice(0, 12) })}</Text>
        </View>
        <Text variant="meta" color="text/secondary">{t("Verifying")}</Text>
      </Card>
      <View style={{ alignItems: "center", gap: space[2] }}>
        <View testID="pairing-request-popup-code"><OtpCells value={request.code} large /></View>
        <Text variant="meta" color="text/secondary">{t("Code valid for")} {Math.max(0, Math.ceil((request.expires_ms - now) / 1000))} s</Text>
      </View>
    </Modal>
  );
}

/** This computer's host: state, the facts diagnostics needs, network access, the key and the library folder, with their actions. */
function HostPanel(props: { status: HostStatus | null; onClose(): void; onMoveLibrary(): void }) {
  const t = useT();
  const toast = useToast();
  const theme = useTheme();
  const router = useRouter();
  const { status } = props;
  const [now, setNow] = useState(Date.now());
  const [paths, setPaths] = useState<{ library: string; logs: string } | null>(null);
  const [connectionMode, setConnectionMode] = useState<"tailscale" | "local" | null>(null);
  const [tailnet, setTailnet] = useState<TailnetStatus | null>(null);
  const [tailnetUnavailable, setTailnetUnavailable] = useState(false);
  const [confirm, setConfirm] = useState<null | "restore">(null);
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    void bridge.background.get().then(setBackground);
    void bridge.connectionMode.get().then(setConnectionMode);
    void bridge.device.getPublicKey().then((reply) => setFingerprint("value" in reply ? reply.value.deviceId.slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ") : null));
    return bridge.background.onState(setBackground);
  }, []);
  const [word, setWord] = useState("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { void bridge.app.paths().then(setPaths); }, [status?.state]);
  useEffect(() => {
    let active = true;
    const refresh = () => void bridge.tailnet.getStatus().then((next) => { if (active) { setTailnet(next); setTailnetUnavailable(false); } }, () => { if (active) { setTailnet(null); setTailnetUnavailable(true); } });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [status?.state]);
  const act = (run: () => Promise<unknown>) => () => void run().catch((error: Error) => toast.show({ kind: "error", message: error.message }));
  const tailnetLabel = tailnetUnavailable ? t("Unavailable") : tailnet?.connected ? t("Connected") : tailnet?.enabled && tailnet.loginUrl ? t("Needs sign-in") : tailnet?.enabled ? t("Connecting…") : t("Unavailable");
  const running = !!status && !["stopped", "failed"].includes(status.state);
  const diagnosticsText = JSON.stringify({ ...status, app: bridge.app.version, platform: `${bridge.app.platform}/${bridge.app.arch}`, paths }, null, 2);
  return (
    <Modal title={t("This computer's host")} width={640} onClose={props.onClose}
      footer={(
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" }}>
          <Button testID="host-open-logs" kind="ghost" label={t("Open logs folder")} onPress={act(() => bridge.gateway.openLogs())} />
          <Button kind="ghost" label={t("Copy diagnostics")} onPress={() => { void navigator.clipboard.writeText(diagnosticsText); toast.show({ kind: "success", message: t("Diagnostics copied") }); }} />
          <Button label={t("Run repair")} disabled={!running} onPress={act(() => bridge.gateway.runDoctor())} />
          <Button testID="host-restart" label={t("Restart")} disabled={!running} onPress={act(() => bridge.gateway.restart())} />
          {running ? <Button testID="host-stop" label={t("Stop")} onPress={act(() => bridge.gateway.stop())} /> : <Button testID="host-start" kind="primary" label={t("Start")} onPress={act(() => bridge.gateway.start())} />}
        </View>
      )}>
      <View testID="host-panel" style={{ gap: space[1] }}>
        <Row name={t("State")} value={status ? t(status.label) : "—"} testID="host-state" />
        {status?.portChange ? <View testID="host-port-changed"><Callout tone="warning">{t("The host moved from {previous} to {current} because the saved port was in use. Paired devices may need the new address.", status.portChange)}</Callout></View> : null}
        {status?.reasonTexts.length ? <Callout tone={status.state === "failed" ? "danger" : "warning"}>{[...status.reasonTexts.map((text) => t(text)), status.message].filter(Boolean).join(" · ")}</Callout> : null}
        {status?.reasons.includes("not_a_device") ? <Button testID="host-restore-admin" label={t("Restore this computer as admin")} onPress={() => setConfirm("restore")} /> : null}
        <Row name={t("Connection path")} value={t("This computer")} />
        <Row name={t("Process id")} value={status?.pid} testID="host-pid" />
        <Row name={t("Port")} value={status?.port} testID="host-port" />
        <Row name={t("Uptime")} value={status?.started_ms && running ? clock(now - status.started_ms) : undefined} />
        <Row name={t("Server version")} value={status?.serverVersion} />
        <Row name={t("Agents")} value={status?.gateway ? `${status.gateway.state} · ${t("{n} restarts", { n: status.gateway.restartCount })}` : undefined} />
        <Row name={t("Protocol version")} value={status?.protocolVersion} />
        <Row name={t("Last exit")} value={status?.lastExit ? `${status.lastExit.code ?? status.lastExit.signal} · ${formatDateTime(status.lastExit.ts_ms)}` : undefined} />
        <Row name={t("Restarts in the last hour")} value={status?.restartsLastHour} />
        <Row name={t("Device key")} value={status?.keyProtection === "file" ? t("Device key stored in a file") : status?.keyProtection === "os-store" ? t("Protected by the system store") : undefined} />
        {status?.keyProtection === "file" ? <Button label={t("Move the key to the system store")} onPress={act(() => bridge.gateway.resolveKeyStorage("move-to-store"))} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
          <Text color="text/secondary" style={{ width: 168 }}>{t("Device key fingerprint")}</Text>
          <Text testID="device-fingerprint" variant="mono" selectable style={{ flex: 1 }}>{fingerprint ?? "—"}</Text>
          <Button size="sm" testID="rotate-key" label={t("Rotate device key")} onPress={() => void bridge.device.rotate().then((reply) => {
            if ("error" in reply) return void toast.show({ kind: reply.error.code === "SIGN_REFUSED" ? "info" : "error", message: reply.error.code === "SIGN_REFUSED" ? t("The device key was not replaced") : reply.error.message });
            // Everything in this window was signed for by the old key: it starts again with the new one.
            window.location.reload();
          })} />
        </View>
        {background ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
              <Text color="text/secondary" style={{ width: 168 }}>{t("Keep running in the tray")}</Text>
              <Switch accessibilityLabel={t("Keep running in the tray")} value={background.keepInTray} disabled={!background.trayAvailable} onChange={(keepInTray) => bridge.background.set({ keepInTray }).then(setBackground)} />
              {background.noTrayText ? <Text testID="no-tray" color="text/secondary">{t(background.noTrayText)}</Text> : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
              <Text color="text/secondary" style={{ width: 168 }}>{t("Launch at login")}</Text>
              <Switch accessibilityLabel={t("Launch at login")} value={background.launchAtLogin} disabled={!background.trayAvailable} onChange={(launchAtLogin) => bridge.background.set({ launchAtLogin }).then(setBackground)} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
              <View style={{ width: 168 }}><Text color="text/secondary">{t("Keep host running after quit")}</Text></View>
              <Switch accessibilityLabel={t("Keep host running after quit")} value={background.keepHostAfterQuit} onChange={(keepHostAfterQuit) => bridge.background.set({ keepHostAfterQuit }).then(setBackground)} />
            </View>
          </>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
          <View style={{ width: 168 }}><Text color="text/secondary">{t("Manage built-in host")}</Text></View>
          <Switch accessibilityLabel={t("Manage built-in host")} value={status?.enabled ?? true} onChange={(enabled) => void bridge.gateway.setEnabled(enabled).catch((error: Error) => toast.show({ kind: "error", message: error.message }))} />
        </View>
        <View style={{ gap: space[2], paddingVertical: space[2] }}>
          <Row name={t("Connect type")} value={connectionMode ? t(connectionMode === "tailscale" ? "Tailscale (default)" : "Local") : "—"} />
          <View testID="tailnet-status-card" style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: 8, padding: space[3], gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="body-medium" style={{ flex: 1 }}>{t("Tailscale")}</Text>
              <Text testID="tailnet-status" color={tailnet?.connected ? "success/text" : "text/secondary"}>{tailnetLabel}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: space[2], justifyContent: "flex-end" }}>
              {!tailnet?.connected ? <Button size="sm" testID="tailnet-connect" label={t("Connect with Tailscale")} onPress={act(() => bridge.tailnet.startLogin({ mode: "interactive" }).then((next) => { setTailnet(next); setTailnetUnavailable(false); }))} /> : null}
              <Button size="sm" kind="ghost" label={t("Manage connection")} onPress={() => { props.onClose(); router.push("/join-tailnet?manage=1" as never); }} />
            </View>
            {connectionMode === "local" ? <Text color="text/secondary">{t("Phones cannot connect to this computer in Local mode. Choose Tailscale to connect from another device.")}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] }}>
          <Text color="text/secondary" style={{ width: 168 }}>{t("Project library")}</Text>
          <Text testID="library-path" selectable numberOfLines={2} style={{ flex: 1 }}>{paths?.library ?? "—"}</Text>
          <Button size="sm" label={t("Show")} onPress={act(() => bridge.files.reveal("library"))} />
          <Button size="sm" testID="library-move" label={t("Move…")} onPress={props.onMoveLibrary} />
        </View>
      </View>
      {confirm === "restore" ? (
        <Modal title={t("Restore this computer as admin")} description={t("This computer becomes an admin device of its own host again. Type RESTORE to confirm.")} width={360} onClose={() => { setConfirm(null); setWord(""); }}
          footer={<Button kind="primary" label={t("Restore")} disabled={word !== "RESTORE"} onPress={() => { setConfirm(null); setWord(""); act(() => bridge.gateway.restoreAdmin("RESTORE"))(); }} />}>
          <Input accessibilityLabel={t("Confirmation")} value={word} onChangeText={setWord} autoCapitalize="characters" />
        </Modal>
      ) : null}
    </Modal>
  );
}

function KeychainAccessDialog() {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await bridge.gateway.start(); } catch { /* The supervisor status supplies the current reason and keeps this panel open. */ }
    finally { setRetrying(false); }
  };
  return (
    <Modal title={t("Host unavailable")} blocking hideClose onClose={() => {}} width={480}
      footer={<Button kind="primary" testID="host-keychain-retry" label={t("Try again")} disabled={retrying} onPress={() => void retry()} />}>
      <Text testID="host-keychain-access-message">{t("JAgentChill needs access to its key in your keychain. macOS asks once per installed version — choose Always Allow, then press Try again.")}</Text>
    </Modal>
  );
}

/** Preserve the existing protected-file choice on platforms without the macOS keychain prompt. */
function KeyStorageDialog(props: { status: HostStatus; onClose(): void }) {
  const t = useT();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const choose = (choice: "retry" | "file" | "cancel", confirmed = false) => bridge.gateway.resolveKeyStorage(choice, choice === "file" ? { confirmed } : undefined)
    .then(() => props.onClose(), (error: Error) => toast.show({ kind: "error", message: error.message }));
  return (
    <Modal title={t("The device key cannot be stored")} description={props.status.message} width={480} onClose={() => void choose("cancel")}
      footer={confirming ? (
        <View style={{ flexDirection: "row", gap: space[2], justifyContent: "flex-end" }}>
          <Button label={t("Back")} onPress={() => setConfirming(false)} />
          <Button testID="key-file-confirm" kind="primary" label={t("Store the key in a protected file")} onPress={() => void choose("file", true)} />
        </View>
      ) : (
        <View testID="key-storage-unavailable" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" }}>
          <Button kind="ghost" label={t("Cancel")} onPress={() => void choose("cancel")} />
          <Button label={t("Store the key in a protected file")} onPress={() => setConfirming(true)} />
          <Button kind="primary" label={t("Try again")} onPress={() => void choose("retry")} />
        </View>
      )}>
      <Text color="text/secondary">{confirming ? t("The key will be protected only by this account's file permissions") : t("Without a key this computer cannot run its host or pair with another one. The editor keeps working on this device.")}</Text>
    </Modal>
  );
}

/** Space the top bar keeps free for the window controls, and the regions that drag the window. */
function useWindowChrome(): void {
  const theme = useTheme();
  useEffect(() => {
    void bridge.window.setChrome({ background: theme.color("bg/app"), text: theme.color("text/primary"), scheme: theme.scheme }).catch(() => undefined);
  }, [theme.scheme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const style = document.createElement("style");
    document.head.appendChild(style);
    let fullscreen = false, start = 0, end = 0, lights = 0;
    const draw = () => {
      const s = fullscreen ? 0 : start, e = fullscreen ? 0 : end;
      // `strip`: native controls at the start edge (macOS) sit in their own strip above a sidebar; `menu`: the in-window menu button shares the header row.
      const strip = !fullscreen && lights > 0, menu = start - lights;
      style.textContent = `
        [data-testid="top-bar"], [data-testid="editor-bar"], [data-testid="sidebar"] > div:first-child { -webkit-app-region: drag; }
        body:not(:has([data-testid="sidebar"])) [data-testid="editor-bar"] { padding-inline-start: ${s + 8}px !important; }
        [data-testid="editor-bar"] { padding-inline-end: ${e + 12}px !important; }
        [data-testid="editor-bar"] :is(button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="combobox"], [tabindex]),
        [data-testid="top-bar"] :is(button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="combobox"], [tabindex]),
        [data-testid="sidebar"] > div:first-child :is(button, a, input, [role="button"], [tabindex]) { -webkit-app-region: no-drag; }
        /* macOS: the window controls get their own strip above the sidebar header, so the host name keeps the full width. */
        [data-testid="sidebar"] { ${strip ? "padding-top: 30px;" : ""} }
        /* Only this strip drags the window: a sidebar that was itself a drag region swallowed the clicks on its rows. */
        ${strip ? `[data-testid="sidebar"]::before, [data-testid="settings-nav"]::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 30px; -webkit-app-region: drag; }` : ""}
        [data-testid="sidebar"] > div:first-child { padding-inline-start: ${menu}px; }
        /* Settings draws its own sidebar: "Back to app" sits beside the window controls, and its strip drags the window. */
        [data-testid="settings-nav"] { ${strip ? "padding-top: 30px;" : `padding-inline-start: ${8 + menu}px;`} }
        body:not(:has([data-testid="sidebar"], [data-testid="settings-nav"])) [data-testid="top-bar"] { padding-inline-start: ${s + 16}px !important; }
        [data-testid="top-bar"] { padding-inline-end: ${e + 12}px !important; }`;
    };
    void bridge.window.controls().then((controls) => { lights = controls.start.drawn === "native" ? controls.start.inset : 0; start = controls.start.inset + (bridge.policy.appMenuInWindow ? MENU_BUTTON : 0); end = controls.end.inset; draw(); });
    void bridge.window.getState().then((state) => { fullscreen = state.fullscreen; draw(); });
    const off = bridge.window.onState((state) => { fullscreen = state.fullscreen; draw(); });
    return () => { off(); style.remove(); };
  }, []);
}

const MENU_BUTTON = 44;
/**
 * The application menu inside the window, for Windows and Linux: the same model the macOS menu bar shows, with the
 * same items, state and hints. Choosing an item asks the main process for it by id, exactly as the native menu does.
 */
function WindowMenu() {
  const [model, setModel] = useState<TopMenu[]>([]);
  useEffect(() => { void bridge.menu.getModel().then(setModel); return bridge.menu.onModel(setModel); }, []);
  const items = useMemo<AppMenuModel>(() => {
    const row = (node: MenuNode): MenuItem | null => {
      if (node.type === "separator") return { type: "separator" };
      // The list of open windows is the system's own on macOS; inside the window the roles that have an equivalent stay.
      if (node.role === "windowMenu" || node.role === "services" || node.role === "front") return null;
      const select = node.role === "minimize" ? () => void bridge.window.minimize() : node.role === "zoom" ? () => void bridge.window.maximize() : () => void bridge.menu.invoke(node.id!);
      return {
        id: node.id!, label: node.label!, disabled: node.enabled === false || node.statusLine === true, ...(node.checked !== undefined ? { checked: node.checked } : {}),
        ...(node.hint ? { keys: node.hint.split("+").map((key) => (key === "Mod" ? "Ctrl" : key)) } : {}),
        ...(node.submenu ? { submenu: node.submenu.map(row).filter((item): item is MenuItem => item !== null) } : { onSelect: select }),
      };
    };
    return model.map((menu) => ({ id: menu.id, title: menu.label, items: menu.items.map(row).filter((item): item is MenuItem => item !== null) }));
  }, [model]);
  return (
    <View testID="app-menu" style={{ position: "absolute", top: 8, start: 8, zIndex: 180 }}>
      <AppMenu model={items} desktopApp os={bridge.app.platform === "win32" ? "windows" : "linux"} />
    </View>
  );
}

/** Media files opened with the app: a new project, or — while a project is open — that project. Nothing is imported before the choice. */
function OpenMedia(props: { files: DesktopFile[]; project: string | null; onDone(): void }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const actions = useProjectActions();
  const [busy, setBusy] = useState(false);
  const run = (target: "new" | "open") => {
    setBusy(true);
    void (async () => {
      try {
        const files = await Promise.all(props.files.map(fileFromDesktop));
        if (target === "open") window.dispatchEvent(new CustomEvent(DESKTOP_MEDIA_EVENT, { detail: { files } }));
        else { const id = await actions.createWithMedia(files); if (id) router.push(`/editor/${id}` as never); }
      } catch (error) { toast.show({ kind: "error", message: `${props.files[0]?.name}: ${error instanceof Error ? error.message : String(error)}`, sticky: true }); }
      props.onDone();
    })();
  };
  const names = props.files.length === 1 ? props.files[0].name : t("{n} files", { n: props.files.length });
  return (
    <Modal title={t("Open media")} description={names} width={480} onClose={props.onDone}
      footer={(
        <View testID="open-media" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" }}>
          <Button kind="ghost" label={t("Cancel")} disabled={busy} onPress={props.onDone} />
          {props.project ? <Button testID="open-media-add" label={t("Add to the open project")} loading={busy} onPress={() => run("open")} /> : null}
          <Button testID="open-media-new" kind="primary" label={t("Create a new project")} loading={busy} onPress={() => run("new")} />
        </View>
      )}>
      <Text color="text/secondary">{t("The files stay where they are until you choose.")}</Text>
    </Modal>
  );
}

/** Everything the desktop shell adds to the app: the library folder, the host, links and files from the OS, and the native menu. */
export function DesktopShell() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const actions = useProjectActions();
  const { hosts, refreshHosts, host } = useHost();
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [legacyRecovery, setLegacyRecovery] = useState<"none" | "trying" | "needs-action" | "migrated">("none");
  const [panel, setPanel] = useState(false);
  const [keyDialogClosed, setKeyDialogClosed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [opened, setOpened] = useState<DesktopFile[] | null>(null);
  const [packages, setPackages] = useState<DesktopFile[]>([]);
  const libraryStatus = useLibraryState().status;
  useEffect(() => {
    if (packages.length === 0 || libraryStatus !== "ready") return;
    const batch = packages;
    setPackages([]);
    void (async () => {
      try { latest.current.router.push("/projects" as never); await latest.current.actions.importPackage(await Promise.all(batch.map(fileFromDesktop))); }
      catch (error) { toast.show({ kind: "error", message: `${batch[0]?.name}: ${error instanceof Error ? error.message : String(error)}`, sticky: true }); }
    })();
  }, [packages, libraryStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const { approvals } = useHost();
  const exports = useSyncExternalStore(exportService.subscribe, exportService.getState, exportService.getState);
  const latest = useRef({ actions, router, hosts, host });
  latest.current = { actions, router, hosts, host };
  useWindowChrome();

  useEffect(() => {
    void bridge.gateway.getStatus().then(setStatus);
    const offStatus = bridge.gateway.onStatus(setStatus);
    void bridge.gateway.getLegacyIdentityRecovery().then(setLegacyRecovery);
    const offLegacyRecovery = bridge.gateway.onLegacyIdentityRecovery(setLegacyRecovery);
    void bridge.updates.getState().then(setUpdate);
    const offUpdates = bridge.updates.onState(setUpdate);
    return () => { offStatus(); offLegacyRecovery(); offUpdates(); };
  }, []);
  useEffect(() => {
    let active = true;
    let checking = false;
    const key = "jagentchill.connectionNotice";
    const check = async () => {
      if (checking || !active) return;
      let notice: { mode: "tailscale" | "local"; returnTo?: string; createdAt: number } | null = null;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) notice = JSON.parse(raw) as { mode: "tailscale" | "local"; createdAt: number };
      } catch { return; }
      if (!notice) return;
      if (Date.now() - notice.createdAt > 120_000) { sessionStorage.removeItem(key); return; }
      if (notice.returnTo ? pathname !== notice.returnTo : pathname.startsWith("/join-tailnet")) return;
      checking = true;
      try {
        if (notice.mode === "local") {
          const host = await bridge.gateway.getStatus();
          if (active && (host.state === "ready" || host.state === "degraded")) {
            sessionStorage.removeItem(key);
            toast.show({ kind: "success", message: t("Using the local host on this computer") });
          }
        } else {
          const tailnet = await bridge.tailnet.getStatus();
          if (active && tailnet.connected) {
            sessionStorage.removeItem(key);
            toast.show({ kind: "success", message: t("Connected over Tailscale as {name}", { name: tailnet.host ?? t("this device") }) });
          } else if (active && tailnet.unavailableReason) sessionStorage.removeItem(key);
        }
      } catch { /* The next poll retries while the host starts. */ }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 500);
    return () => { active = false; clearInterval(timer); };
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const mode = await bridge.connectionMode.get().catch(() => null);
      if (!active || panel || pathname.startsWith("/join-tailnet")) return;
      if (mode === null) {
        if (pathname !== "/") router.replace(`/join-tailnet?returnTo=${encodeURIComponent(pathname)}` as never);
        return;
      }
      if (mode !== "tailscale") return;
      const tailnet = await bridge.tailnet.getStatus().catch(() => null);
      if (active && tailnet && !tailnet.connected && tailnet.loginUrl && !pathname.startsWith("/settings")) router.replace(`/join-tailnet?returnTo=${encodeURIComponent(pathname)}` as never);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [panel, pathname, router]);
  // The built-in host appears in the host list as soon as this computer is its device.
  useEffect(() => {
    if (status?.gatewayId && !hosts.some((record) => record.gatewayId === status.gatewayId)) void refreshHosts();
  }, [status?.gatewayId, status?.state, hosts, refreshHosts]);

  useEffect(() => { void bridge.window.setRoute(pathname).catch(() => undefined); }, [pathname]);
  useEffect(() => {
    void bridge.menu.setState({ ...(/^\/editor\//.test(pathname) ? {} : { editorForeground: false }), theme: theme.preference }).catch(() => undefined);
  }, [pathname, theme.preference]);
  // The menu is written in the language of the app, with the bindings in effect as its hints.
  useEffect(() => {
    const labels: Record<string, string> = {};
    for (const text of menuLabels()) { const translated = t(text); if (translated !== text) labels[text] = translated.slice(0, 96); }
    const hints: Record<string, string> = { "view.sidebar.toggle": "Mod+\\", "palette.open": "Mod+K", "project.new": "Alt+N" };
    for (const binding of EDITOR_BINDINGS) if (!binding.context && !hints[binding.action]) hints[binding.action] = binding.combos[0];
    void bridge.menu.setState({ labels, hints, locale: theme.locale }).catch(() => undefined);
  }, [theme.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  // What runs on this computer: the quit dialog, the tray and the update restart read it from here.
  useEffect(() => {
    const active = exports.queue.jobs.filter((job) => job.state === "running" || job.state === "paused");
    const item = (job: (typeof active)[number]) => ({ id: job.id, title: `${job.projectName} — ${job.fileName}`.slice(0, 160), percent: Math.max(0, Math.min(100, job.percent)), route: "/exports/queue" });
    void bridge.background.setWork({
      exports: active.filter((job) => job.target === "device").map(item), jobs: active.filter((job) => job.target === "host").map(item),
      attention: approvals.map((approval) => ({ id: approval.approvalId.slice(0, 96), title: approval.title.slice(0, 160), route: `/h/${latest.current.host?.gatewayId ?? "local"}/sessions/${encodeURIComponent(approval.sessionKey)}` })), unsavedProjects: 0,
    }).catch(() => undefined);
    for (const reason of ["export"] as const) void (active.some((job) => job.target === "device") ? bridge.capabilities.blockSleep(reason) : bridge.capabilities.unblockSleep(reason)).catch(() => undefined);
  }, [exports.queue.jobs, approvals]);

  const open = useCallback((route: string) => latest.current.router.push(route as never), []);
  useEffect(() => {
    // Links from the operating system only navigate; a pairing link opens the offer for the user to review.
    const offLinks = bridge.deepLinks.subscribe((url) => {
      const link = parseDeepLink(url);
      if (!link) return void toast.show({ kind: "error", message: t("This link is not valid") });
      open(link.kind === "pair" ? `/pair/start?offer=${link.offer}` : link.path);
    });
    const offFiles = bridge.files.onOpen((batch) => {
      void (async () => {
        if (batch.skipped > 0) toast.show({ kind: "warning", message: t("{n} files were skipped", { n: batch.skipped }) });
        const packages = batch.files.filter((file) => file.kind === "project-package");
        const media = batch.files.filter((file) => file.kind === "media");
        if (media.length) setOpened(media);
        // A package opened while the app is still starting waits until the library has been read: the import needs the names in use.
        if (packages.length) setPackages((waiting) => [...waiting, ...packages]);
      })();
    });
    const hostId = () => latest.current.host?.gatewayId ?? "local";
    const offMenu = bridge.menu.onInvoke((event) => {
      const { action } = event;
      // A text-editing item acts on the focused field.
      if (event.role && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return void document.execCommand(event.role === "selectAll" ? "selectAll" : event.role);
      // The palette and the sidebar are the shell's: its own key handler runs them.
      if (action === "palette.open") return void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: bridge.app.platform !== "darwin", bubbles: true }));
      if (action === "view.sidebar.toggle") return void window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: true, ctrlKey: bridge.app.platform !== "darwin", bubbles: true }));
      if (action === "session.new") return open(`/h/${hostId()}/sessions`);
      if (action === "help.starter-tips") return open("/home");
      if (action === "nav.back") return latest.current.router.back();
      if (action === "nav.forward") return window.history.forward();
      if (action === "nav.go.exports") return open("/exports");
      if (action.startsWith("nav.go.")) {
        const id = action.slice(7);
        return open(["home", "projects", "library", "devices", "scripts"].includes(id) ? `/${id}` : `/h/${hostId()}/${id}`);
      }
      if (action === "app.settings") return open("/settings");
      if (action === "app.settings.host") { setPanel(false); return open("/settings/devices"); }
      if (action === "app.settings.network-access" || action === "help.diagnostics") return setPanel(true);
      if (action === "devices.pair") return open("/devices?pair=1");
      if (action === "project.open") return open("/projects");
      if (action === "project.new") return void latest.current.actions.create().then((id) => { if (id) open(`/editor/${id}`); });
      if (action === "project.import-package") return void latest.current.actions.importPackage();
      if (action === "project.open-recent" && event.payload?.projectId) return open(`/editor/${event.payload.projectId}`);
      if (action === "app.theme.system" || action === "app.theme.light" || action === "app.theme.dark") return theme.setPreference(action.slice(10) as "system" | "light" | "dark");
      if (action === "help.whats-new") return open("/changelog");
      if (action === "app.about") return open("/settings/about");
      // Every other action belongs to the screen in the foreground, which runs it exactly as its shortcut would.
      window.dispatchEvent(new CustomEvent<DesktopActionDetail>(DESKTOP_ACTION_EVENT, { detail: { action, ...(event.payload ? { payload: event.payload } : {}), trigger: "menu" } }));
    });
    const offNotifications = bridge.notifications.onActivated((event) => {
      if (event.id === "host.repaired") return void toast.show({ kind: "success", message: t("The host configuration was repaired") });
      if (event.route) open(event.route);
    });
    return () => { offLinks(); offFiles(); offMenu(); offNotifications(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const keyProblem = status?.state === "failed" && status.reasons.includes("key_storage_unavailable");
  return (
    <>
      <LibraryFolder moving={moving} onMoved={() => setMoving(false)} />
      <PairingRequestPopup />
      {legacyRecovery === "needs-action" ? (
        <View testID="legacy-identity-recovery" style={{ position: "absolute", bottom: space[4], alignSelf: "center", zIndex: 191 }}>
          <Banner id="legacy-identity-recovery" tone="warning" actions={[
            { label: t("Try again"), onPress: () => void bridge.gateway.retryLegacyIdentity() },
            { label: t("Connect again"), onPress: () => router.push("/devices?pair=1" as never) },
          ]}>{t("This computer could not restore its previous identity. Connect it again to use paired hosts.")}</Banner>
        </View>
      ) : null}
      {status?.state === "failed" && !keyProblem ? (
        <View testID="host-stopped-banner" style={{ position: "absolute", bottom: space[4], alignSelf: "center", zIndex: 190 }}>
          <Banner id="host-stopped" tone="danger" actions={[{ label: t("Restart"), onPress: () => void bridge.gateway.start() }, { label: t("Open logs"), onPress: () => void bridge.gateway.openLogs() }]}>{status.message ?? t("The built-in host stopped")}</Banner>
        </View>
      ) : null}
      {update?.status === "ready" ? (
        <View style={{ position: "absolute", bottom: space[4], alignSelf: "center", zIndex: 190 }}>
          <Banner id="update-ready" tone="info" actions={[
            { label: t("Restart to update"), onPress: () => void bridge.updates.install().then((result) => { if (!result.restarted && result.blockers.length) toast.show({ kind: "info", message: t("The update will be installed when you quit") }); }) },
            { label: t("Remind me in 4 hours"), onPress: () => { setUpdate(null); void bridge.updates.remindLater(); } },
          ]}>{t("Version {version} is ready", { version: update.version ?? "" })}</Banner>
        </View>
      ) : null}
      {update?.status === "downloaded" || (update?.status === "available" && update.mode !== "link") ? (
        <View testID="update-banner" style={{ position: "absolute", bottom: space[4], alignSelf: "center", zIndex: 190 }}>
          <Banner id="update-found" tone="info" actions={[
            // An unsigned build cannot install the update: the verified package is shown in its folder for the person to open.
            update.status === "downloaded" ? { label: t("Show in folder"), onPress: () => void bridge.updates.reveal() } : { label: t("Download"), onPress: () => void bridge.updates.download() },
            { label: t("Remind me in 4 hours"), onPress: () => { setUpdate(null); void bridge.updates.remindLater(); } },
          ]}>{update.status === "downloaded" ? t("Version {version} was downloaded and verified", { version: update.version ?? "" }) : t("Version {version} is available", { version: update.version ?? "" })}</Banner>
        </View>
      ) : null}
      {keyProblem && status && bridge.app.platform === "darwin" ? <KeychainAccessDialog /> : null}
      {keyProblem && status && bridge.app.platform !== "darwin" && !keyDialogClosed ? <KeyStorageDialog status={status} onClose={() => setKeyDialogClosed(true)} /> : null}
      {bridge.policy.appMenuInWindow ? <WindowMenu /> : null}
      {opened ? <OpenMedia files={opened} project={/^\/editor\//.test(pathname) ? pathname : null} onDone={() => setOpened(null)} /> : null}
      {panel ? <HostPanel status={status} onClose={() => setPanel(false)} onMoveLibrary={() => { setPanel(false); setMoving(true); }} /> : null}
    </>
  );
}
