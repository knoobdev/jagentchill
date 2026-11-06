import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { relativeTime } from "@jagentchill/app-core";
import type { RuntimeDescriptionCode, RuntimeInstallSnapshot, RuntimeSignIn, RuntimeSnapshotEntry, RuntimesConfig } from "@jagentchill/protocol";
import { Button, Callout, Card, Chip, ConfirmDialog, GroupedSettingCard, Icon, IconButton, ProgressBar, RadioGroup, SearchField, SettingRow, SideSheet, Spinner, StatusPill, Switch, Tap, Text, radius, space, useTheme, useToast, SkeletonCards } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { reasonOf } from "../agents/errors";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { useHost } from "../host";
import { useT } from "../locale";
import { copyText } from "../platform/media";
import { openExternal } from "../platform/store";
import { signInChoices, signInValue } from "./providers-model";

type CatalogueEntry = { id: string; title: string; description: string; descriptionCode?: RuntimeDescriptionCode; installUrl: string; added: boolean };
type Translate = ReturnType<typeof useT>;
/** A description the host words from a pattern is worded here in the language of the screen; any other is shown as the host gave it. */
const describe = (t: Translate, entry: { description: string; descriptionCode?: RuntimeDescriptionCode }): string =>
  entry.descriptionCode?.code === "runtime/acp-native" ? t("{name} on the host, driven over the Agent Client Protocol with its own sign-in and permissions.", { name: entry.descriptionCode.name })
    : entry.descriptionCode?.code === "runtime/acp-session" ? t("The {name} agent on the host, driven over the Agent Client Protocol.", { name: entry.descriptionCode.name })
    : entry.description;
/** What is wrong with a runtime, by its code where the app has the words for it. */
const problem = (t: Translate, runtime: { label: string; error?: { code: string; message: string } }): string | undefined =>
  runtime.error?.code === "runtime/not-installed" ? t("{name} is not installed on this host.", { name: runtime.label }) : runtime.error?.message;
type Diagnostic = { text: string; rows: Array<{ label: string; value: string; level: "info" | "ok" | "warn" | "error" }>; generated_ms: number };
export const RUNTIME_STATUS: Record<string, { label: string; tone: "success" | "info" | "danger" | "neutral" | "warning" }> = {
  ready: { label: "Ready", tone: "success" }, loading: { label: "Checking", tone: "info" }, error: { label: "Error", tone: "danger" }, unavailable: { label: "Unavailable", tone: "neutral" },
};
/** "Not installed", "Signed out"…: the reason a runtime that is not ready gives, in two words. */
export function runtimeState(entry: RuntimeSnapshotEntry): { label: string; tone: "success" | "info" | "danger" | "neutral" | "warning" } {
  if (!entry.enabled) return { label: "Turned off", tone: "neutral" };
  if (entry.status === "unavailable") {
    const code = entry.error?.code;
    return code === "runtime/not-installed" ? { label: "Not installed", tone: "neutral" } : code === "runtime/signed-out" ? { label: "Signed out", tone: "warning" } : code === "runtime/no-provider" ? { label: "No provider", tone: "neutral" } : RUNTIME_STATUS.unavailable;
  }
  return RUNTIME_STATUS[entry.status] ?? RUNTIME_STATUS.unavailable;
}
const LEVEL_ICON = { info: "info", ok: "check-c", warn: "warn", error: "x-c" } as const;
const LEVEL_LABEL = { info: "Info", ok: "OK", warn: "Warning", error: "Error" } as const;

export function RuntimeInstallAction(props: { runtimeId: string; label: string; onInstalled(): void }) {
  const t = useT();
  const router = useRouter();
  const { connection, host } = useHost();
  const [confirm, setConfirm] = useState(false);
  const [job, setJob] = useState<RuntimeInstallSnapshot | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [request, setRequest] = useState(false);
  const active = job?.state === "downloading" || job?.state === "verifying";
  useEffect(() => {
    if (!job || !active || !connection) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await connection.call<{ install: RuntimeInstallSnapshot }>("jagentchill.runtime.install.status", { installId: job.installId });
        if (cancelled) return;
        setJob(next.install);
        if (next.install.state === "installed") props.onInstalled();
        if (next.install.state === "downloading" || next.install.state === "verifying") timer = setTimeout(() => void tick(), 650);
      } catch (error) { if (!cancelled) setJob({ ...job, state: "failed", progress: null, step: t("Installation failed"), error: reasonOf(error) }); }
    };
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => void tick(), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.installId, job?.state, connection]); // eslint-disable-line react-hooks/exhaustive-deps
  const begin = async () => {
    if (!connection) return;
    setRequest(true);
    try {
      const started = await connection.call<{ install: RuntimeInstallSnapshot; estimateMiB: number }>("jagentchill.runtime.install.start", { runtimeId: props.runtimeId });
      setEstimate(started.estimateMiB); setJob(started.install); setConfirm(false);
    } catch (error) { setJob({ installId: "", runtimeId: props.runtimeId, state: "failed", progress: null, step: t("Installation failed"), error: reasonOf(error) }); }
    finally { setRequest(false); }
  };
  const cancel = async () => {
    if (!connection || !job) return;
    try { const result = await connection.call<{ install: RuntimeInstallSnapshot }>("jagentchill.runtime.install.cancel", { installId: job.installId }); setJob(result.install); }
    catch (error) { setJob({ ...job, error: reasonOf(error) }); }
  };
  if (active) return <View style={{ gap: space[1], minWidth: 220, flex: 1 }}>
    <ProgressBar value={job.progress} label={t(job.step)} />
    <Button size="xs" kind="ghost" label={t("Cancel")} onPress={() => void cancel()} />
  </View>;
  if (confirm) return <>
    <Button size="xs" label={t("Install")} testID={`install-${props.runtimeId}`} onPress={() => setConfirm(true)} />
    <ConfirmDialog open title={t("Install {name}", { name: props.label })} confirmLabel={t("Install now")} busy={request} onClose={() => setConfirm(false)} onConfirm={() => void begin()}>
      <View style={{ gap: space[2] }} testID={`install-confirm-${props.runtimeId}`}>
        <Text variant="body-medium">{t("Approx. {size} MiB package size; dependencies can add more.", { size: estimate ?? (props.runtimeId === "codex" ? 440 : props.runtimeId === "claude-code" ? 250 : 95) })}</Text>
        <Text variant="meta" color="text/secondary">{t("Installs for this user in the app data folder, under tools/{name}; no admin rights.", { name: props.runtimeId })}</Text>
      </View>
    </ConfirmDialog>
  </>;
  if (job?.state === "failed") return <View style={{ gap: space[1], minWidth: 240, flex: 1 }}>
    <Callout tone="danger">{job.error ?? t("The install did not finish. Retry.")}</Callout>
    <Button size="xs" label={t("Retry")} onPress={() => setConfirm(true)} />
  </View>;
  if (job?.state === "installed") return <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Chip size="sm" icon="check-c" label={t("Installed, not signed in")} /><Button size="xs" label={t("Sign in")} onPress={() => host && router.push(hostSettingsRoute(host.gatewayId, "runtimes", "keys") as never)} /></View>;
  return <Button size="xs" label={t("Install")} testID={`install-${props.runtimeId}`} onPress={() => { setJob(null); setConfirm(true); }} />;
}

/** The CLI runtimes tab: the agent CLIs found on the host with their sign-in state, their order, and the catalogue of runtimes that can be added. */
export function RuntimesTab() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { connection, host, can, onEvent, status } = useHost();
  const data = useAgentData();
  const admin = can("jagentchill.config.write");
  const [runtimes, setRuntimes] = useState<RuntimeSnapshotEntry[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [config, setConfig] = useState<RuntimesConfig | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!connection) return;
    try {
      const [snapshot, stored, list] = await Promise.all([
        connection.call<{ runtimes: RuntimeSnapshotEntry[] }>("jagentchill.runtime.snapshot.get", {}), connection.call<{ config: RuntimesConfig }>("jagentchill.runtime.config.get", {}),
        connection.call<{ entries: CatalogueEntry[] }>("jagentchill.runtime.catalogue.list", {}),
      ]);
      setRuntimes(snapshot.runtimes); setConfig(stored.config); setRevision(stored.config.revision); setCatalogue(list.entries);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.runtime.updated") void load(); }), [onEvent, load]);
  // The model catalogue retries a runtime whose list was not ready; the rows here follow it.
  useEffect(() => { void load(); }, [data.catalogue]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(patch: Record<string, unknown>, removeRuntimeIds?: string[]) {
    try {
      const result = await connection!.call<{ config: RuntimesConfig }>("jagentchill.runtime.config.update", { patch, expectedRevision: revision, ...(removeRuntimeIds ? { removeRuntimeIds } : {}) });
      setConfig(result.config); setRevision(result.config.revision);
      await load(); data.reload();
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); await load(); throw error; }
  }
  const entryOf = (id: string) => config?.entries[id] ?? {};
  // A catalogue runtime nobody added stays in the catalogue below; one an admin turned off keeps its row.
  const cli = (runtimes ?? []).filter((entry) => entry.kind === "cli" && (entry.enabled || config?.entries[entry.runtimeId] !== undefined || entry.source === "custom")).sort((a, b) => a.order - b.order);
  async function move(index: number, by: -1 | 1) {
    const order = cli.map((entry) => entry.runtimeId);
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to], order[index]];
    await update({ entries: Object.fromEntries(order.map((id, at) => [id, { ...entryOf(id), order: (at + 1) * 10 }])) }).catch(() => undefined);
  }
  async function refreshAll() {
    setRefreshing(true);
    try { setRuntimes((await connection!.call<{ runtimes: RuntimeSnapshotEntry[] }>("jagentchill.runtime.snapshot.refresh", { all: true })).runtimes); data.reload(); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setRefreshing(false); }
  }
  if (status !== "connected") return <Callout tone="info">{t("Connect to this host to see runtimes")}</Callout>;
  if (!runtimes) return <SkeletonCards cards={2} rows={2} style={{ padding: space[4] }} />;
  const needle = query.trim().toLowerCase();
  const offered = catalogue.filter((entry) => !entry.added && (!needle || entry.title.toLowerCase().includes(needle) || entry.id.includes(needle)));
  const open = runtimes.find((entry) => entry.runtimeId === detail) ?? null;
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium" level={2} style={{ flex: 1 }}>{t("CLI runtimes")}</Text>
        <Button size="sm" icon="refresh" label={refreshing ? t("Checking…") : t("Refresh all")} loading={refreshing} onPress={() => void refreshAll()} />
      </View>
      <Text variant="meta" color="text/secondary">{t("Agents run through the agent CLIs installed on this host. Each CLI uses its own account, or a key or endpoint you choose for it here.")}</Text>
      <Card padding={0}>
        {cli.length === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("No CLI runtime is added")}</Text></View> : cli.map((entry, index) => {
          const state = runtimeState(entry);
          const compact = theme.compact;
          return (
            <View key={entry.runtimeId} testID={`runtime-${entry.runtimeId}`} style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: space[1], paddingHorizontal: space[3], paddingVertical: compact ? space[2] : 0, minHeight: 52, borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
              <Tap role="button" label={entry.label} onPress={() => setDetail(entry.runtimeId)} style={{ flex: compact ? undefined : 1, minWidth: 0, flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: space[1], paddingVertical: space[1] }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 }}>
                  <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}><Icon name="kbd" size={16} color="text/secondary" /></View>
                  <Text variant="body-medium" numberOfLines={compact ? 2 : 1} style={{ flex: 1, minWidth: 0 }}>{entry.label}</Text>
                  {!compact ? <StatusPill label={t(state.label)} tone={state.tone} /> : null}
                </View>
                <View style={{ flexDirection: compact ? "row" : "column", alignItems: "center", gap: space[1], paddingStart: compact ? 36 : 0 }}>
                  <Text variant="meta" color="text/secondary" numberOfLines={compact ? 2 : 1} style={{ flex: 1 }}>{[entry.runtimeId, entry.binary?.version, entry.status === "ready" ? (entry.models.length === 1 ? t("1 model") : t("{n} models", { n: entry.models.length })) : problem(t, entry)].filter(Boolean).join(" · ")}</Text>
                  {compact ? <StatusPill label={t(state.label)} tone={state.tone} /> : null}
                  {entry.signIn && entry.signIn.kind !== "cli" ? <Chip size="sm" icon={entry.signIn.kind === "key" ? "key" : "link"} label={entry.signIn.label} />
                    : entry.login?.state === "signed_in" ? <Chip size="sm" icon="user" label={t("Signed in")} /> : null}
                </View>
              </Tap>
              {admin && entry.error?.code === "runtime/not-installed" && ["claude-code", "codex", "gemini-cli"].includes(entry.runtimeId) ? <RuntimeInstallAction runtimeId={entry.runtimeId} label={entry.label} onInstalled={() => { void load(); data.reload(); }} /> : null}
              {admin && entry.error?.code === "runtime/signed-out" && ["claude-code", "codex"].includes(entry.runtimeId) ? <Button size="xs" label={t("Sign in")} onPress={() => host && router.push(hostSettingsRoute(host.gatewayId, "runtimes", "keys") as never)} /> : null}
              {admin ? (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: compact ? "flex-end" : undefined, gap: space[1] }}>
                  <IconButton icon="chev-u" size={compact ? undefined : "xs"} label={t("Move {name} up", { name: entry.label })} disabled={index === 0} onPress={() => void move(index, -1)} />
                  <IconButton icon="chev-d" size={compact ? undefined : "xs"} label={t("Move {name} down", { name: entry.label })} disabled={index === cli.length - 1} onPress={() => void move(index, 1)} />
                  <Switch value={entry.enabled} accessibilityLabel={t("Enable {name}", { name: entry.label })} onChange={(value) => update({ entries: { [entry.runtimeId]: { ...entryOf(entry.runtimeId), enabled: value } } })} errorMessage={reasonOf} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
      {!admin ? <Text variant="meta" color="text/secondary">{t("Admin devices can change these settings")}</Text> : null}

      <Text variant="body-medium" level={2} style={{ marginTop: space[3] }}>{t("Add runtime")}</Text>
      <SearchField label={t("Search the runtime catalogue")} placeholder={t("Search the catalogue…")} size="sm" value={query} onChangeText={setQuery} debounce={0} />
      <Card padding={0}>
        {offered.length === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary">{needle ? t("No results") : t("Every runtime of the catalogue is added")}</Text></View> : offered.slice(0, needle ? 40 : 6).map((entry, index) => (
          <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{entry.title}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={2}>{describe(t, entry)}</Text>
            </View>
            <Button size="xs" kind="ghost" icon="ext" label={t("Install guide")} onPress={() => openExternal(entry.installUrl)} />
            <Button size="xs" label={t("Add")} disabled={!admin} testID={`add-runtime-${entry.id}`} onPress={() => void update({ entries: { [entry.id]: { ...entryOf(entry.id), enabled: true } } }).then(() => toast.show({ kind: "success", message: t("{name} added", { name: entry.title }) })).catch(() => undefined)} />
          </View>
        ))}
      </Card>
      {!needle && offered.length > 6 ? <Text variant="meta" color="text/secondary">{t("{n} more in the catalogue — search to find them", { n: offered.length - 6 })}</Text> : null}

      <GroupedSettingCard style={{ marginTop: space[3] }}>
        <SettingRow label={t("Offer editor tools to ACP agents")} description={t("Agents driven over the Agent Client Protocol get this host's editor tools.")} last>
          <Switch value={config?.offerEditorToolsToAcp ?? true} disabled={!admin} accessibilityLabel={t("Offer editor tools to ACP agents")} onChange={(value) => update({ offerEditorToolsToAcp: value })} errorMessage={reasonOf} />
        </SettingRow>
      </GroupedSettingCard>
      <RuntimeDetail runtime={open} admin={admin} onClose={() => setDetail(null)} onChanged={() => { void load(); data.reload(); }}
        onSignIn={(runtimeId, signIn) => update({ entries: { [runtimeId]: { ...entryOf(runtimeId), signIn } } }).then(() => toast.show({ kind: "success", message: t("Sign-in changed") })).catch(() => undefined)}
        onRemove={open && open.source !== "builtin" ? () => void update({}, [open.runtimeId]).then(() => { setDetail(null); toast.show({ kind: "success", message: t("{name} removed", { name: open.label }) }); }).catch(() => undefined) : undefined} />
    </>
  );
}

function RuntimeDetail(props: { runtime: RuntimeSnapshotEntry | null; admin: boolean; onClose(): void; onChanged(): void; onRemove?: () => void; onSignIn(runtimeId: string, signIn: RuntimeSignIn): Promise<unknown> }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection } = useHost();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ state: "idle" | "running" | "failed"; report: Diagnostic | null }>({ state: "idle", report: null });
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const runtime = props.runtime;
  useEffect(() => { setQuery(""); setShowDiagnostic(false); setDiagnostic({ state: "idle", report: null }); }, [runtime?.runtimeId]);
  if (!runtime) return null;
  const state = runtimeState(runtime);
  const needle = query.trim().toLowerCase();
  const models = runtime.models.filter((model) => !needle || model.label.toLowerCase().includes(needle) || model.modelId.toLowerCase().includes(needle));
  const refresh = async () => {
    setBusy(true);
    try { await connection!.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: [runtime.runtimeId] }); props.onChanged(); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(false); }
  };
  const diagnose = async () => {
    setShowDiagnostic(true);
    setDiagnostic((current) => ({ state: "running", report: current.report }));
    try { setDiagnostic({ state: "idle", report: await connection!.call<Diagnostic>("jagentchill.runtime.diagnose", { runtimeId: runtime.runtimeId }) }); props.onChanged(); }
    catch { setDiagnostic((current) => ({ state: "failed", report: current.report })); }
  };
  const row = (label: string, value: string | undefined | null) => (value ? <View style={{ flexDirection: "row", gap: space[2] }}><Text variant="meta" color="text/secondary" style={{ width: 96 }}>{label}</Text><Text variant="meta" selectable style={{ flex: 1 }}>{value}</Text></View> : null);
  if (showDiagnostic) {
    return (
      <SideSheet open onClose={props.onClose} title={t("Diagnostic — {runtime}", { runtime: runtime.label })}
        footer={<><Button kind="ghost" label={t("Back")} onPress={() => setShowDiagnostic(false)} /><Button label={t("Copy")} disabled={!diagnostic.report} testID="diagnostic-copy" onPress={() => void copyText(diagnostic.report!.text).then((ok) => ok && toast.show({ kind: "success", message: t("Diagnostic copied") }))} /><Button kind="primary" label={t("Refresh")} loading={diagnostic.state === "running"} onPress={() => void diagnose()} /></>}>
        {diagnostic.state === "running" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Spinner size={14} label={t("Running diagnostic…")} /><Text>{t("Running diagnostic…")}</Text></View> : null}
        {diagnostic.state === "failed" ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void diagnose() }]}>{t("Failed to fetch diagnostic")}</Callout> : null}
        {diagnostic.report ? (
          <View testID="diagnostic-rows" style={{ opacity: diagnostic.state === "running" ? 0.5 : 1 }}>
            {diagnostic.report.rows.map((entry, index) => (
              <View key={`${entry.label}-${index}`} style={{ flexDirection: "row", gap: space[2], paddingVertical: space[1.5], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
                <Icon name={LEVEL_ICON[entry.level] ?? "info"} size={14} color={entry.level === "error" ? "danger" : entry.level === "warn" ? "warning/icon" : entry.level === "ok" ? "success" : "text/tertiary"} label={t(LEVEL_LABEL[entry.level] ?? "Info")} />
                <Text variant="meta" color="text/secondary" style={{ width: 120 }}>{entry.label}</Text>
                <Text variant="meta" selectable style={{ flex: 1 }}>{entry.value}</Text>
              </View>
            ))}
          </View>
        ) : diagnostic.state === "idle" ? <Text color="text/secondary">{t("No diagnostic available")}</Text> : null}
      </SideSheet>
    );
  }
  return (
    <SideSheet open onClose={props.onClose} title={runtime.label}
      footer={<>{props.onRemove && props.admin ? <Button kind="ghost" tone="danger" label={t("Remove runtime")} onPress={props.onRemove} /> : null}<Button label={t("Diagnostic")} disabled={!props.admin} testID="runtime-diagnostic" onPress={() => void diagnose()} /><Button kind="primary" label={t("Refresh")} loading={busy} onPress={() => void refresh()} /></>}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <StatusPill label={t(state.label)} tone={state.tone} />
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{runtime.fetched_ms ? t("Updated {when}", { when: relativeTime(runtime.fetched_ms, Date.now(), theme.locale) }) : ""}</Text>
      </View>
      <Text color="text/secondary">{describe(t, runtime)}</Text>
      {runtime.error ? <Callout tone={runtime.status === "error" ? "danger" : "warning"}>{problem(t, runtime)}{runtime.signInHint && runtime.error.code === "runtime/signed-out" ? ` ${runtime.signInHint}` : ""}</Callout> : null}
      <View style={{ gap: space[1] }}>
        {row(t("Runtime ID"), runtime.runtimeId)}
        {row(t("Command"), runtime.binary?.path)}
        {row(t("Version"), runtime.binary?.version)}
        {row(t("Sign-in"), runtime.login ? `${t(runtime.login.state === "signed_in" ? "Signed in" : runtime.login.state === "signed_out" ? "Signed out" : "Unknown")}${runtime.login.account ? ` · ${runtime.login.account}` : ""}` : null)}
        {row(t("Permissions"), runtime.requiresFullAccess ? t("Runs with its own permissions on the host — an admin confirms each session") : t("Host commands ask for approval"))}
      </View>
      {runtime.status === "unavailable" && runtime.error?.code === "runtime/not-installed" ? (
        <View style={{ gap: space[1] }}>
          {runtime.install.steps.slice(0, 3).map((entry, index) => <Text key={index} variant="meta" color="text/secondary" selectable>{entry.command ? `${entry.text}: ${entry.command}` : entry.text}</Text>)}
          {props.admin && ["claude-code", "codex", "gemini-cli"].includes(runtime.runtimeId) ? <RuntimeInstallAction runtimeId={runtime.runtimeId} label={runtime.label} onInstalled={props.onChanged} /> : null}
          <View style={{ alignItems: "flex-start" }}><Button size="xs" kind="ghost" icon="ext" label={t("Official install guide")} onPress={() => openExternal(runtime.install.docsUrl)} /></View>
        </View>
      ) : null}
      <SignInChoice runtime={runtime} admin={props.admin} onChange={(signIn) => props.onSignIn(runtime.runtimeId, signIn)} />
      <Text variant="body-medium" level={3}>{t("Modes")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{runtime.modes.map((mode) => <Chip key={mode.id} label={mode.supported ? mode.label : `${mode.label} — ${t("not supported")}`} icon={mode.isUnattended ? "warn" : undefined} />)}</View>
      <Text variant="body-medium" level={3}>{t("Models")}</Text>
      <SearchField label={t("Search models")} placeholder={t("Search models")} size="sm" value={query} onChangeText={setQuery} debounce={0} />
      <ScrollView style={{ maxHeight: 260 }}>
        {runtime.status === "loading" ? <Text color="text/secondary">{t("Loading models…")}</Text> : models.length === 0 ? <Text color="text/secondary">{needle ? t("No models match your search") : t("No models detected")}</Text>
          : models.map((model) => <View key={`${model.providerId}/${model.modelId}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}><Text numberOfLines={1} style={{ flex: 1 }}>{model.label}</Text>{model.isDefault ? <Chip size="sm" label={t("Default")} /> : null}<Text variant="meta" color="text/secondary" numberOfLines={1}>{model.modelId}</Text></View>)}
      </ScrollView>
    </SideSheet>
  );
}

/**
 * Which sign-in a CLI runs on: its own account (the default), or an API key / custom endpoint stored on the host. The
 * host hands a key only to this CLI's process; the CLI's own sign-in files are never changed.
 */
function SignInChoice(props: { runtime: RuntimeSnapshotEntry; admin: boolean; onChange(signIn: RuntimeSignIn): Promise<unknown> }) {
  const t = useT();
  const choices = signInChoices(props.runtime);
  const [busy, setBusy] = useState(false);
  const value = signInValue(props.runtime.signIn);
  const blocked = choices.filter((choice) => !choice.usable);
  return (
    <View testID="runtime-signin" style={{ gap: space[1] }}>
      <Text variant="body-medium" level={3}>{t("Sign-in used")}</Text>
      {choices.length === 1 ? <Text variant="meta" color="text/secondary">{t("No API key or endpoint is stored on this host yet. Add one under Sign-in & keys or Endpoints.")}</Text> : null}
      <RadioGroup label={t("Sign-in used")} value={value}
        options={choices.map((choice) => ({ value: choice.value, label: choice.value === "cli" ? t("The CLI's own account") : choice.usable ? `${choice.label} — ${t(choice.detail ?? "")}` : choice.label, disabled: !props.admin || busy || !choice.usable }))}
        onChange={(next) => {
          const chosen = choices.find((choice) => choice.value === next);
          if (!chosen || next === value) return;
          setBusy(true);
          void props.onChange(chosen.signIn).finally(() => setBusy(false));
        }} />
      {blocked.map((choice) => <Text key={choice.value} variant="meta" color="text/tertiary">{choice.label}: {choice.detail ? t(choice.detail) : t("not usable")}</Text>)}
      {value !== "cli" ? <Text variant="meta" color="text/secondary">{t("Turns on a key or endpoint are billed by the provider per call.")}</Text> : null}
    </View>
  );
}
