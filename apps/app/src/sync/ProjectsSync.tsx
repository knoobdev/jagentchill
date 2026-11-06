import { useRouter } from "expo-router";
import type { AuthorDisplay } from "@jagentchill/protocol";
import { holderPhrase, lastEditedBy } from "./authorWords";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { HostError } from "@jagentchill/client";
import type { ProjectSummary } from "@jagentchill/app-core";
import { Badge, Button, Modal, Radio, Text, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { useDevice, useLibraryState } from "../state";
import { statusView, useSync } from "./SyncProvider";

type HostProject = { doc: { kind: "project"; id: string }; name: string; duration: number; updated_ms: number; lastAuthorName: string; lastAuthorDisplay?: AuthorDisplay; head: number; lease: { holderName: string; holderDisplay?: AuthorDisplay } | null };
type Actions = {
  /** The sync rows of a project's menu: "Sync with <host name>" and "On this device only". */
  menu(project: ProjectSummary): MenuItem[];
  /** Downloads a project of the host space to this device and opens it. */
  openFromHost(projectId: string): Promise<boolean>;
  /** Deleting a synced project moves the host copy to the host trash; `false`: refused, the local copy stays. */
  beforeTrash(projects: ProjectSummary[]): Promise<boolean>;
  hostProjects: HostProject[]; refresh(): void;
};
/** Ticks (120 000 per second) as m:ss. */
const formatDuration = (ticks: number): string => { const seconds = Math.round(ticks / 120000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
const SyncActionsContext = createContext<Actions>({ menu: () => [], openFromHost: async () => false, beforeTrash: async () => true, hostProjects: [], refresh: () => undefined });

/** The sync entry points of the project list: turning sync on and off per project, and the projects that are on the host only. */
export function ProjectSyncProvider(props: { children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const sync = useSync();
  const host = useHost();
  const { library } = useDevice();
  const [turningOff, setTurningOff] = useState<ProjectSummary | null>(null);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hostProjects, setHostProjects] = useState<HostProject[]>([]);
  const [tick, setTick] = useState(0);
  const hostName = sync.hostName ?? "";

  useEffect(() => {
    const connection = host.connection;
    if (!connection) { setHostProjects([]); return; }
    let cancelled = false;
    void connection.call<{ items: HostProject[] }>("jagentchill.sync.project.list", { sort: "date" }).then((result) => { if (!cancelled) setHostProjects(result.items); }, () => undefined);
    return () => { cancelled = true; };
  }, [host.connection, sync.version, tick]);

  const explain = useCallback((error: unknown): string => {
    const code = error instanceof HostError ? error.code : "";
    if (code === "SCOPE_DENIED") return t("Your role on this host does not allow this");
    if (code === "SCHEMA_TOO_NEW") return t("Update JAgentChill on this device to open this project");
    if (code === "BLOB_HASH_MISMATCH") return t("Unable to download this project");
    if (code === "CONNECTION_CLOSED" || code === "GATEWAY_UNREACHABLE") return t("The host is not reachable");
    return error instanceof Error ? error.message : String(error);
  }, [t]);
  const enable = useCallback(async (project: ProjectSummary) => {
    if (!sync.engine) return;
    try {
      const result = await sync.engine.enable(project.id);
      toast.show({ kind: "success", message: result.media > 0 ? t("Syncing with {host} — 0 of {n} files", { host: hostName, n: result.media }) : t("Synced with {host}", { host: hostName }) });
    } catch (error) { toast.show({ kind: "error", message: explain(error) }); }
  }, [sync.engine, toast, t, hostName, explain]);
  const openFromHost = useCallback(async (projectId: string) => {
    if (!sync.engine) return false;
    try {
      await sync.engine.fetchProject(projectId);
      await library?.load(true);
      router.push(`/editor/${projectId}` as never);
      return true;
    } catch (error) {
      const code = error instanceof HostError ? error.code : "";
      toast.show({ kind: code === "PROJECT_NOT_SYNCED" || code === "PROJECT_PURGED" ? "info" : "error", message: code === "PROJECT_NOT_SYNCED" || code === "PROJECT_PURGED" || code === "PROJECT_IN_TRASH" ? t("Not on {host} either", { host: hostName }) : explain(error), ...(code === "BLOB_HASH_MISMATCH" ? { action: { label: t("Retry"), onPress: () => void openFromHost(projectId) } } : {}) } as never);
      return false;
    }
  }, [sync.engine, library, router, toast, t, hostName, explain]);
  const beforeTrash = useCallback(async (projects: ProjectSummary[]) => {
    if (!sync.engine) return true;
    for (const project of projects) {
      const result = await sync.engine.remove(project.id).catch(() => "local" as const);
      if (typeof result === "object") { toast.show({ kind: "warning", message: t("{name} is editing this project", { name: result.refused }) }); return false; }
    }
    return true;
  }, [sync.engine, toast, t]);

  const value = useMemo<Actions>(() => ({
    hostProjects, refresh: () => setTick((count) => count + 1), openFromHost, beforeTrash,
    menu(project) {
      // With no host paired the sync controls are one entry that opens pairing.
      if (!sync.hostName) return [{ type: "separator" }, { id: "sync-connect", label: t("Connect a host"), icon: "cloud", onSelect: () => router.push("/pair/start" as never) }];
      const on = (sync.statuses[project.id]?.kind ?? "local") !== "local";
      const denied = !sync.canWrite || !sync.connected;
      const reason = !sync.connected ? t("The host is not reachable") : t("Your role on this host does not allow this");
      return [{ type: "separator" }, {
        id: "sync", label: t("Sync"), icon: "cloud", submenu: [
          { id: "sync-off", label: t("On this device only"), checked: !on || undefined, disabled: denied && on, ...(denied && on ? { description: reason } : {}), onSelect: () => { if (on) { setRemove(false); setTurningOff(project); } } },
          { id: "sync-on", label: t("Sync with {host}", { host: hostName }), checked: on || undefined, disabled: denied && !on, ...(denied && !on ? { description: reason } : {}), onSelect: () => { if (!on) void enable(project); } },
        ],
      } as MenuItem];
    },
  }), [hostProjects, openFromHost, beforeTrash, sync.hostName, sync.statuses, sync.canWrite, sync.connected, t, router, hostName, enable]);

  const confirmOff = async () => {
    if (!turningOff || !sync.engine) return;
    setBusy(true);
    try { await sync.engine.disable(turningOff.id, remove); setTurningOff(null); toast.show({ kind: "success", message: t("On this device only") }); } catch (error) { toast.show({ kind: "error", message: explain(error) }); } finally { setBusy(false); }
  };
  return (
    <SyncActionsContext.Provider value={value}>
      {props.children}
      <Modal open={turningOff !== null} width={360} title={t("Stop syncing “{name}”?", { name: turningOff?.name ?? "" })} description={t("The project stays on this device. Changes are no longer sent to {host}.", { host: hostName })} onClose={() => setTurningOff(null)}
        footer={<><Button label={t("Cancel")} onPress={() => setTurningOff(null)} /><Button kind="strong" label={t("Stop syncing")} loading={busy} testID="sync-off-confirm" onPress={() => void confirmOff()} /></>}>
        <View style={{ gap: space[2] }} role="radiogroup">
          <Radio label={t("Keep on host")} selected={!remove} onSelect={() => setRemove(false)} />
          <Radio label={t("Remove from host")} selected={remove} onSelect={() => setRemove(true)} />
        </View>
      </Modal>
    </SyncActionsContext.Provider>
  );
}
export const useProjectSync = (): Actions => useContext(SyncActionsContext);

/** The sync status of a project on its card and row. Nothing for a project that is on this device only. */
export function SyncBadge(props: { projectId: string }) {
  const t = useT();
  const { statuses, hostName } = useSync();
  const view = statuses[props.projectId] ? statusView(statuses[props.projectId], t, hostName) : null;
  if (!view) return null;
  return <View testID={`sync-badge-${props.projectId}`}><Badge label={view.text} tone={view.tone === "danger" ? "danger" : view.tone === "warning" ? "warning" : view.tone === "accent" ? "accent" : "neutral"} /></View>;
}

/** Projects that are on the host and not on this device, under the project list; "Connect a host" when none is paired. */
export function HostProjects() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const sync = useSync();
  const actions = useProjectSync();
  const library = useLibraryState();
  const [opening, setOpening] = useState<string | null>(null);
  // A copy in this device's trash does not count as being here: the host's copy can be opened again.
  const local = new Set(library.projects.filter((project) => project.trash === null).map((project) => project.id));
  const remote = actions.hostProjects.filter((project) => !local.has(project.doc.id));
  if (library.status !== "ready") return null;
  if (!sync.hostName) {
    return (
      <View testID="host-projects" style={{ marginTop: space[6], padding: space[4], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1 }}><Text variant="body-medium">{t("Connect a host")}</Text><Text color="text/secondary">{t("Sync projects between your devices through your own host.")}</Text></View>
        <Button size="sm" label={t("Connect a host")} testID="sync-connect-host" onPress={() => router.push("/pair/start" as never)} />
      </View>
    );
  }
  if (remote.length === 0) return null;
  return (
    <View testID="host-projects" style={{ marginTop: space[6], gap: space[2] }}>
      <Text variant="title-sm">{t("On {host}", { host: sync.hostName })}</Text>
      <Text color="text/secondary">{t("Everyone paired with this host can see these items")}</Text>
      <View role="list" aria-label={t("On {host}", { host: sync.hostName })}>
        {remote.map((project) => (
          <View key={project.doc.id} role="listitem" testID="host-project" style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1}>{project.name || t("Untitled Project")}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1}>{`${formatDuration(project.duration)} · ${lastEditedBy(t, project.lastAuthorDisplay, project.lastAuthorName)}${project.lease ? ` · ${t("{name} is editing this project", { name: holderPhrase(t, project.lease.holderDisplay, project.lease.holderName) })}` : ""}`}</Text>
            </View>
            <Button size="sm" label={t("Open on this device")} loading={opening === project.doc.id} testID={`host-project-open-${project.doc.id}`} onPress={async () => { setOpening(project.doc.id); await actions.openFromHost(project.doc.id); setOpening(null); }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** On the project-not-found screen: "Look for it on <host>". */
export function LookOnHost(props: { projectId: string; onFound(): void }) {
  const t = useT();
  const sync = useSync();
  const actions = useProjectSync();
  const [state, setState] = useState<"idle" | "looking" | "absent">("idle");
  if (!sync.hostName || !sync.connected) return null;
  if (state === "absent") return <Text color="text/secondary" testID="look-on-host-absent">{t("Not on {host} either", { host: sync.hostName })}</Text>;
  return <Button size="sm" label={t("Look for it on {host}", { host: sync.hostName })} loading={state === "looking"} testID="look-on-host" onPress={async () => { setState("looking"); if (await actions.openFromHost(props.projectId)) props.onFound(); else setState("absent"); }} />;
}
