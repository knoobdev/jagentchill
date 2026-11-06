import { formatDateTime } from "@jagentchill/app-core";
import { holderPhrase } from "./authorWords";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { SessionState, SyncSession, Transfer } from "@jagentchill/client";
import { CONTINUITY_CHIP_MS } from "@jagentchill/protocol";
import { Avatar, Banner, Button, Icon, Modal, Popover, ProgressBar, Switch, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { useForegroundActive } from "../platform/foreground";
import { formatBytes, statusView, useSync } from "./SyncProvider";

const nothing = () => () => {};
const ROLE_LABEL: Record<string, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };
/** The state of a project's sync session, re-read on every change of it. */
export function useSessionState(session: SyncSession | null): SessionState | null {
  useSyncExternalStore(session ? session.subscribe : nothing, () => session?.state ?? null, () => null);
  useSync();
  return session?.state ?? null;
}
const clock = (time_ms: number) => formatDateTime(time_ms);
const seconds = (until_ms: number, now: number) => Math.max(0, Math.ceil((until_ms - now) / 1000));
/** Re-renders once a second while a countdown is shown. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  const foreground = useForegroundActive();
  useEffect(() => { if (!active || !foreground) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [active, foreground]);
  return now;
}

/** The transfers of one project (or of all): name, direction, size, percentage, speed, time remaining, with Pause, Resume and Cancel. */
export function SyncActivity(props: { projectId?: string }) {
  const t = useT();
  const { engine } = useSync();
  const transfers = (engine?.transfers() ?? []).filter((transfer) => !props.projectId || transfer.projectId === props.projectId);
  const label = (transfer: Transfer) => ({
    queued: t("Queued"), active: `${Math.round((transfer.bytes / Math.max(1, transfer.size)) * 100)}% · ${formatBytes(transfer.speed)}/s${transfer.speed > 0 ? ` · ${t("{n} s left", { n: Math.ceil((transfer.size - transfer.bytes) / transfer.speed) })}` : ""}`,
    paused: t("Paused"), failed: t("Failed"), done: t("Done"), "waiting-wifi": t("Waiting for Wi-Fi"), "too-large": t("Too large to sync"), "no-space": t("Not enough space on this device"),
    "host-full": t("Host storage full"), "not-uploaded": t("Not uploaded yet"),
  })[transfer.state];
  return (
    <View style={{ gap: space[2], minWidth: 300 }} testID="sync-activity">
      <View testID="sync-pause-all"><Switch label={t("Pause all sync")} value={engine?.pausedAll ?? false} onChange={(value) => engine?.setPausedAll(value)} /></View>
      {transfers.length === 0 ? <Text color="text/secondary">{t("No transfers")}</Text> : transfers.map((transfer) => (
        <View key={transfer.id} testID="sync-transfer" style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Icon name={transfer.direction === "upload" ? "cloud" : "download"} size={14} color="text/secondary" />
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1}>{transfer.name}</Text><Text variant="meta" color="text/secondary">{`${transfer.direction === "upload" ? t("Upload") : t("Download")} · ${formatBytes(transfer.size)} · ${label(transfer)}`}</Text></View>
            {transfer.state === "active" || transfer.state === "queued" ? <Button kind="ghost" size="xs" label={t("Pause")} onPress={() => engine?.pauseTransfer(transfer.id)} /> : null}
            {transfer.state === "paused" ? <Button kind="ghost" size="xs" label={t("Resume")} onPress={() => engine?.resumeTransfer(transfer.id)} /> : null}
            {transfer.state === "failed" || transfer.state === "host-full" || transfer.state === "not-uploaded" ? <Button kind="ghost" size="xs" label={t("Retry")} onPress={() => engine?.resumeTransfer(transfer.id)} /> : null}
            {transfer.state === "waiting-wifi" ? <Button kind="ghost" size="xs" label={t("Download now")} onPress={() => engine?.downloadNow(transfer.id)} /> : null}
            {transfer.state !== "done" ? <Button kind="ghost" size="xs" label={t("Cancel")} onPress={() => engine?.cancelTransfer(transfer.id)} /> : null}
          </View>
          {transfer.state === "active" ? <ProgressBar thin value={transfer.bytes / Math.max(1, transfer.size)} label={transfer.name} /> : null}
        </View>
      ))}
    </View>
  );
}

/** The sync status of the open project in the editor's top bar; pressing it opens the activity panel. */
export function SyncChip(props: { session: SyncSession | null; projectId: string; onConflict(): void; /** In the top bar of the phone editor: the icon alone, the text as its accessible name. */ compact?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { hostName, engine } = useSync();
  const host = useHost();
  const state = useSessionState(props.session);
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const view = state ? statusView(state.status, t, hostName) : null;
  if (!state || !view) return null;
  const transfers = (engine?.transfers() ?? []).filter((transfer) => transfer.projectId === props.projectId && transfer.direction === "upload");
  const moving = transfers.filter((transfer) => transfer.state !== "done").length;
  // Media of a project that was just synced: "n of 12 files".
  const text = state.status.kind === "syncing" && transfers.length > 0 && moving > 0 ? t("Syncing — {n} of {total} files", { n: transfers.length - moving, total: transfers.length }) : view.text;
  const press = () => {
    if (view.next === "conflict") return props.onConflict();
    if (view.next === "storage" && host.host) return router.push(`/settings/host/${host.host.gatewayId}/host-storage` as never);
    setOpen(true);
  };
  return (
    <View ref={anchor}>
      <Tap role="button" label={text} onPress={press} testID="sync-status"
        style={(tap) => ({ flexDirection: "row", alignItems: "center", gap: space[1], height: 24, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: tap.hovered ? theme.color("bg/hover") : "transparent" })}>
        <Icon name={view.icon} size={14} color={view.tone === "danger" ? "danger" : view.tone === "warning" ? "warning" : "text/secondary"} />
        {props.compact ? null : <Text variant="meta" color={view.tone === "danger" ? "danger" : "text/secondary"} live="polite" numberOfLines={1}>{text}</Text>}
      </Tap>
      {view.next === "retry" ? <Button kind="ghost" size="xs" label={t("Retry")} onPress={() => void props.session?.retry()} /> : null}
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={t("Sync activity")}>
        <View style={{ padding: space[3], gap: space[2] }}>
          <Text variant="body-medium">{t("Sync activity")}</Text>
          {state.status.kind === "error" ? <Text color="danger">{state.status.message}</Text> : null}
          <SyncActivity projectId={props.projectId} />
          {state.status.kind !== "local" ? <Button size="sm" label={t("Upload missing media")} testID="sync-upload-media" onPress={() => { if (props.session) void engine?.queueUploads(props.projectId, props.session.document()); }} /> : null}
          {state.mode === "editing" ? <TransferPicker session={props.session!} state={state} onDone={() => setOpen(false)} /> : null}
          {state.mode === "editing" ? <Button size="sm" label={t("Stop editing")} onPress={() => { setOpen(false); void props.session?.stopEditing(); }} testID="sync-stop-editing" /> : null}
        </View>
      </Popover>
    </View>
  );
}

/** "Transfer editing to…": the holder picks a connected device with write access; it gets the lease when it accepts within 30 seconds. */
function TransferPicker(props: { session: SyncSession; state: SessionState; onDone(): void }) {
  const t = useT();
  const toast = useToast();
  const [asking, setAsking] = useState<string | null>(null);
  const mine = props.state.lease?.holder.kind === "device" ? props.state.lease.holder.deviceId : "";
  const others = props.state.presence.filter((entry, index, all) => entry.deviceId !== mine && entry.role !== "viewer" && all.findIndex((other) => other.deviceId === entry.deviceId) === index);
  return (
    <View style={{ gap: space[1] }} testID="sync-transfer-picker">
      <Text variant="meta" color="text/secondary">{t("Transfer editing to…")}</Text>
      {others.length === 0 ? <Text variant="meta" color="text/secondary">{t("No other device with edit access has this project open")}</Text> : others.map((entry) => (
        <View key={entry.deviceId} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Avatar name={entry.deviceName} id={entry.deviceId} size={20} />
          <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1}>{entry.deviceName}</Text></View>
          <Button size="xs" label={asking === entry.deviceId ? t("Waiting for {name}…", { name: entry.deviceName }) : t("Transfer")} disabled={asking !== null} testID="sync-transfer-to"
            onPress={() => { setAsking(entry.deviceId); void props.session.transfer(entry.deviceId).then((result) => { setAsking(null); if (result.accepted) props.onDone(); else toast.show({ kind: "warning", message: t("{name} did not accept", { name: result.deviceName || entry.deviceName }) }); }, () => { setAsking(null); toast.show({ kind: "error", message: t("Sync error") }); }); }} />
        </View>
      ))}
    </View>
  );
}

/** The avatars of the devices that have the project open: up to five, then "+n". */
export function PresenceStrip(props: { session: SyncSession | null }) {
  const t = useT();
  const state = useSessionState(props.session);
  if (!state || state.status.kind === "local" || state.presence.length < 2) return null;
  const shown = state.presence.slice(0, 5), rest = state.presence.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[0.5] }} testID="presence-strip" role="list" aria-label={t("Devices on this project")}>
      {shown.map((entry) => <View key={entry.connId} role="listitem" aria-label={`${entry.deviceName} · ${t(ROLE_LABEL[entry.role] ?? "Viewer")} · ${entry.mode === "editing" ? t("Editing") : t("Viewing")}`} {...({ title: `${entry.deviceName} · ${t(ROLE_LABEL[entry.role] ?? "Viewer")} · ${entry.mode === "editing" ? t("Editing") : t("Viewing")}` } as object)}><Avatar name={entry.deviceName} id={entry.deviceId} size={20} /></View>)}
      {rest > 0 ? <Text variant="meta" color="text/secondary">{`+${rest}`}</Text> : null}
    </View>
  );
}

/** Under the top bar: who is editing, and what this device can do about it. */
export function SyncBanner(props: { session: SyncSession | null; onConflict(): void; onRestore(): void }) {
  const t = useT();
  const toast = useToast();
  const { isAdmin, hostName } = useSync();
  const theme = useTheme();
  const state = useSessionState(props.session);
  const now = useNow(state?.requesting === "cooldown" || state?.requesting === "declined" || state?.continuity != null);
  const [taking, setTaking] = useState(false);
  // The "Continue where you left off" chip leaves by itself after ten seconds.
  useEffect(() => { if (!state?.continuity) return; const timer = setTimeout(() => props.session?.dismissContinuity(), CONTINUITY_CHIP_MS); return () => clearTimeout(timer); }, [state?.continuity, props.session]);
  if (!state || !props.session) return null;
  const session = props.session, status = state.status;
  const takeOver = isAdmin ? [{ label: t("Take over now"), onPress: () => setTaking(true) }] : [];
  let banner = null;
  const row = (tone: "info" | "warning", text: string, actions: { label: string; onPress(): void; testID?: string }[]) => (
    <View role="status" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2], minHeight: 36, paddingHorizontal: space[3], paddingVertical: space[1], backgroundColor: theme.color(tone === "warning" ? "warning/subtle" : "accent/subtle") }}>
      <Icon name={tone === "warning" ? "warn" : "info"} size={14} color={tone === "warning" ? "warning/text" : "accent/text"} />
      <View style={{ flex: 1, minWidth: 120 }}><Text variant="body-medium">{text}</Text></View>
      {actions.map((action) => <Button key={action.label} kind="ghost" size="xs" label={action.label} testID={action.testID} onPress={action.onPress} />)}
    </View>
  );
  if (status.kind === "deleted") banner = <Banner id="sync-deleted" tone="warning" actions={[{ label: t("Restore"), onPress: props.onRestore }]}>{t("Deleted on {name}", { name: status.by || (hostName ?? "") })}</Banner>;
  else if (status.kind === "conflict") banner = <Banner id="sync-conflict" tone="warning" actions={[{ label: t("Resolve"), onPress: props.onConflict }]}>{t("Sync paused — conflict")}</Banner>;
  else if (status.kind === "update-required") banner = <Banner id="sync-update" tone="warning">{t("Update JAgentChill on this device to edit this project")}</Banner>;
  else if (state.mode === "viewing" && state.lease) {
    const holder = holderPhrase(t, state.lease.holderDisplay, state.lease.holderName), sameDevice = status.kind === "viewing" && status.sameDevice, agent = state.lease.holder.kind === "host";
    const text = sameDevice ? t("Open in another tab or window of this device") : agent ? t("{name} is applying changes", { name: holder }) : state.requesting === "declined" || state.requesting === "cooldown" ? t("{name} is still editing", { name: holder }) : t("{name} is editing this project", { name: holder });
    const waiting = state.requesting === "waiting", cooling = (state.requesting === "cooldown" || state.requesting === "declined") && state.requestRetry_ms > now;
    const request = !state.canWrite || agent || sameDevice ? [] : [{ label: waiting ? t("Waiting for {name}…", { name: holder }) : cooling ? t("Request to edit ({n} s)", { n: seconds(state.requestRetry_ms, now) }) : t("Request to edit"), onPress: () => { if (!waiting && !cooling) void session.requestEdit(); } }];
    const follow = { label: state.following ? t("Following") : t("Follow"), onPress: () => session.setFollowing(!state.following), testID: "sync-follow" };
    banner = row("info", text, [...request.map((entry) => ({ ...entry, testID: "sync-request" })), ...(sameDevice || agent ? [] : takeOver.map((entry) => ({ ...entry, testID: "sync-take-over" }))), follow]);
  } else if (state.mode === "free" && state.canWrite && status.kind !== "local") {
    banner = <Banner id="sync-free" tone="info" actions={[{ label: t("Start editing"), onPress: () => void session.startEditing() }]}>{t("Nobody is editing this project")}</Banner>;
  } else if (status.kind === "offline" && status.waitingFor && state.canWrite) {
    banner = <Banner id="sync-waiting" tone="warning" actions={[{ label: t("Request to edit"), onPress: () => void session.requestEdit() }]}>{t("Offline changes ({n}) — waiting for {name}", { n: status.count, name: status.waitingFor })}</Banner>;
  }
  return (
    <>
      {banner ? <View testID="sync-banner">{banner}</View> : null}
      {state.continuity ? (
        <View testID="sync-continue" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[1] }}>
          <Button size="xs" icon="clock" label={t("Continue where you left off on {name}", { name: state.continuity.deviceName })} onPress={() => { const at = state.continuity!; session.dismissContinuity(); continueAt.current?.(at.sceneId, at.playhead_ticks); }} />
          <Button kind="ghost" size="xs" label={t("Dismiss")} onPress={() => session.dismissContinuity()} />
        </View>
      ) : null}
      <Modal open={taking} title={t("Take over now")} description={t("{name} stops editing at once. Changes that device has not synced stay on it as offline changes.", { name: state.lease?.holderName ?? "" })} width={360} onClose={() => setTaking(false)}
        footer={<><Button label={t("Cancel")} onPress={() => setTaking(false)} /><Button kind="strong" label={t("Take over now")} testID="sync-force-confirm" onPress={() => { setTaking(false); void session.forceTake().catch(() => toast.show({ kind: "error", message: t("Sync error") })); }} /></>} />
    </>
  );
}
/** Where the editor moves to when "Continue where you left off" is chosen; set by the editor screen. */
export const continueAt: { current: ((sceneId: string, playhead_ticks: number) => void) | null } = { current: null };

/** The dialogs a sync session raises: a hand-over request with its countdown, a transfer offer, and the conflict choices. */
export function SyncDialogs(props: { session: SyncSession | null; conflictOpen: boolean; onConflictClose(): void; onCompare(): void; projectName: string; duration: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { hostName, canWrite } = useSync();
  const state = useSessionState(props.session);
  const now = useNow(state?.request != null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = props.session;
  if (!state || !session) return null;
  const request = state.request, conflict = state.conflict;
  const run = async (work: () => Promise<void>) => { setBusy(true); setNote(null); try { await work(); } catch (error) { setNote(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const column = (title: string, rows: [string, string][]) => (
    <View style={{ flex: 1, gap: space[1], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: "transparent" }} testID={`conflict-${title === t("Host") ? "host" : "device"}`}>
      <Text variant="body-medium">{title}</Text>
      {rows.map(([label, value]) => <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}><Text variant="meta" color="text/secondary">{label}</Text><Text variant="meta" numberOfLines={1}>{value}</Text></View>)}
    </View>
  );
  return (
    <>
      <Modal open={request?.role === "holder"} blocking hideClose width={360} title={t("{name} wants to edit this project", { name: request?.deviceName ?? "" })} onClose={() => undefined}
        description={t("Editing is handed over in {n} s unless you keep editing.", { n: seconds(request?.deadline_ms ?? 0, now) })}
        footer={<><Button label={t("Keep editing")} testID="sync-keep-editing" onPress={() => void session.answerTakeover(false)} /><Button kind="strong" label={t("Hand over")} testID="sync-hand-over" onPress={() => void session.answerTakeover(true)} /></>} />
      <Modal open={request?.role === "target"} blocking hideClose width={360} title={t("{name} wants to transfer editing to this device", { name: request?.deviceName ?? "" })} onClose={() => undefined}
        description={t("The offer ends in {n} s.", { n: seconds(request?.deadline_ms ?? 0, now) })}
        footer={<><Button label={t("Decline")} onPress={() => void session.answerTakeover(false)} /><Button kind="strong" label={t("Start editing")} onPress={() => void session.answerTakeover(true)} /></>} />
      <Modal open={props.conflictOpen && conflict != null} width={640} title={t("This project changed on another device")} description={t("Choose which version to keep. Nothing is discarded: the other version stays recoverable for 30 days.")} onClose={props.onConflictClose}
        footer={(
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" }}>
            <Button label={t("Compare")} disabled={busy} testID="conflict-compare" onPress={props.onCompare} />
            <Button label={t("Not now")} disabled={busy} testID="conflict-not-now" onPress={() => void run(async () => { await session.notNow(); props.onConflictClose(); })} />
            <Button label={t("Save mine as a copy")} disabled={busy} testID="conflict-copy" onPress={() => void run(async () => { const copy = await session.saveCopy(); props.onConflictClose(); toast.show({ kind: "success", message: t("Saved as “{name}”", { name: copy.name }), action: { label: t("Open"), onPress: () => router.push(`/editor/${copy.projectId}` as never) } } as never); })} />
            {conflict?.onlyCopy ? null : <Button label={t("Keep the host version")} disabled={busy} testID="conflict-theirs" onPress={() => void run(async () => { await session.keepTheirs(); props.onConflictClose(); })} />}
            {conflict?.onlyCopy ? null : <Button kind="strong" label={t("Keep this device's version")} disabled={busy || !canWrite} testID="conflict-mine" onPress={() => void run(async () => { const result = await session.keepMine(); if (result.ok) props.onConflictClose(); else setNote(t("{name} is editing — request to edit first", { name: result.holderName })); })} />}
          </View>
        )}>
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            {column(t("This device"), [[t("Changes since the common version"), String(state.pending)], [t("Name"), props.projectName], [t("Duration"), props.duration]])}
            {column(t("Host"), [[t("Last modified"), conflict ? clock(conflict.hostUpdated_ms) : ""], [t("Author"), conflict?.hostAuthorName ?? ""], [t("Changes since the common version"), String(Math.max(0, (conflict?.head ?? 0) - state.revision))], [t("On"), hostName ?? ""]])}
          </View>
          {conflict?.onlyCopy ? <Text color="text/secondary">{t("Update required to sync")}</Text> : null}
          {note ? <Text color="danger" live="assertive" testID="conflict-note">{note}</Text> : null}
        </View>
      </Modal>
    </>
  );
}
