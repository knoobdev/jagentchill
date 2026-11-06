import { formatDateTime } from "@jagentchill/app-core";
import type { AuthorDisplay } from "@jagentchill/protocol";
import { holderPhrase, lastEditedBy } from "./authorWords";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { HostError } from "@jagentchill/client";
import { HOST_SPACE_PAGE, STORAGE_WARN_RATIO, type HostBlobInfo, type HostStorageInfo, type TrashEntry } from "@jagentchill/protocol";
import { Banner, Button, Callout, EmptyState, ProgressBar, SearchField, Select, SkeletonList, Tabs, Text, compactScale, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { Screen } from "../shell/Shell";
import { hostSpaceControlsLayout } from "../pairing/mobile-settings-layout";
import { useLibraryState } from "../state";
import { SyncActivity } from "./EditorSync";
import { useProjectSync } from "./ProjectsSync";
import { formatBytes, useSync } from "./SyncProvider";

type Section = "projects" | "scripts" | "exports" | "media" | "trash";
type DocItem = { doc: { kind: "project" | "script"; id: string }; name: string; duration: number; updated_ms: number; lastAuthorName: string; lastAuthorDisplay?: AuthorDisplay; lease: { holderName: string; holderDisplay?: AuthorDisplay } | null };
type Sort = "name" | "date" | "size";
const SECTIONS: { id: Section; label: string }[] = [{ id: "projects", label: "Projects" }, { id: "scripts", label: "Scripts" }, { id: "exports", label: "Exports" }, { id: "media", label: "Media" }, { id: "trash", label: "Trash" }];
const KIND_LABEL: Record<string, string> = { project: "Project", script: "Script", template: "Template", "workflow-run": "Workflow run", film: "Film", "film-panel-asset": "Film panel asset" };
const when = (time_ms: number) => formatDateTime(time_ms);

/** The paired host's storage as a space: what is synced there, how much room it takes, and what lies in its trash. */
export function HostSpaceScreen() {
  const t = useT();
  const theme = useTheme();
  const compact = hostSpaceControlsLayout(theme.width) === "stacked";
  const toast = useToast();
  const router = useRouter();
  const host = useHost();
  const sync = useSync();
  const actions = useProjectSync();
  const library = useLibraryState();
  const [section, setSection] = useState<Section>("projects");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [storage, setStorage] = useState<HostStorageInfo | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [blobs, setBlobs] = useState<HostBlobInfo[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const connection = host.connection;
  const local = new Set(library.projects.map((project) => project.id));

  const load = useCallback(async (from: number) => {
    if (!connection) return;
    const page = { ...(query.trim() ? { search: query.trim() } : {}), sort, limit: HOST_SPACE_PAGE, ...(from ? { cursor: from } : {}) };
    setStorage(await connection.call<HostStorageInfo>("jagentchill.settings.storage.get").catch(() => null));
    if (section === "projects" || section === "scripts") {
      const result = await connection.call<{ items: DocItem[]; nextCursor: number | null }>(section === "projects" ? "jagentchill.sync.project.list" : "jagentchill.sync.doc.list", section === "projects" ? page : { kind: "script", ...page });
      setDocs((current) => (from ? [...current, ...result.items] : result.items)); setCursor(result.nextCursor);
    } else if (section === "media") {
      const result = await connection.call<{ blobs: HostBlobInfo[]; nextCursor: number | null }>("jagentchill.blob.list", page);
      setBlobs((current) => (from ? [...current, ...result.blobs] : result.blobs)); setCursor(result.nextCursor);
    } else if (section === "trash") {
      const needle = query.trim().toLowerCase(), entries = (await connection.call<{ entries: TrashEntry[] }>("jagentchill.trash.list", {})).entries.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
      setTrash(sort === "name" ? entries.sort((a, b) => a.name.localeCompare(b.name)) : entries); setCursor(null);
    } else setCursor(null);
  }, [connection, section, query, sort]);
  // The first read of a section (or of a new search) shows a skeleton; a refresh of what is on screen does not.
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const loadedKey = useRef("");
  useEffect(() => {
    const key = `${section}|${query}|${sort}`;
    if (loadedKey.current !== key) setPhase("loading");
    void load(0).then(() => { loadedKey.current = key; setPhase("ready"); }, () => setPhase("error"));
  }, [load, tick, sync.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (work: () => Promise<unknown>, done: string) => {
    try { await work(); toast.show({ kind: "success", message: done }); setTick((count) => count + 1); actions.refresh(); } catch (error) {
      const code = error instanceof HostError ? error.code : "";
      toast.show({ kind: "error", message: code === "SCOPE_DENIED" ? t("Your role on this host does not allow this") : code === "CONFLICT" ? t("Still used by a project") : error instanceof Error ? error.message : String(error) });
    }
  };

  if (!host.host || !connection) return <Screen title={t("Storage on host")}><EmptyState icon="cloud" title={t("Connect a host")} description={t("Sync projects between your devices through your own host.")} actions={[{ label: t("Connect a host"), kind: "strong", onPress: () => router.push("/pair/start" as never) }]} /></Screen>;
  const ratio = storage ? storage.usedBytes / Math.max(1, storage.quotaBytes) : 0, nearlyFull = ratio >= STORAGE_WARN_RATIO;
  const row = (key: string, title: string, meta: string, buttons: React.ReactNode) => (
    <View key={key} role="listitem" testID="host-space-row" style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <View style={{ flex: 1, minWidth: 0 }}><Text>{title}</Text><Text variant="meta" color="text/secondary" numberOfLines={compact ? 3 : 1}>{meta}</Text></View>
      {buttons ? <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: space[1] }}>{buttons}</View> : null}
    </View>
  );
  let body: React.ReactNode;
  if (section !== "exports" && phase === "error") {
    body = <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => setTick((count) => count + 1) }]}>{t("The host list could not be read.")}</Callout>;
  } else if (section !== "exports" && phase === "loading") {
    body = <SkeletonList rows={4} meta testID="host-space-skeleton" />;
  } else if (section === "projects" || section === "scripts") {
    body = docs.length === 0 ? <EmptyState icon="folder" title={section === "projects" ? t("No projects on this host yet") : t("No scripts on this host yet")} actions={section === "projects" ? [{ label: t("Open Projects"), kind: "strong", onPress: () => router.push("/projects") }] : []} />
      : docs.map((item) => row(item.doc.id, item.name || t("Untitled Project"), `${when(item.updated_ms)} · ${lastEditedBy(t, item.lastAuthorDisplay, item.lastAuthorName)}${item.lease ? ` · ${t("{name} is editing this project", { name: holderPhrase(t, item.lease.holderDisplay, item.lease.holderName) })}` : ""}`,
        section === "projects" ? <Button size="sm" label={local.has(item.doc.id) ? t("Open") : t("Open on this device")} onPress={() => (local.has(item.doc.id) ? router.push(`/editor/${item.doc.id}` as never) : void actions.openFromHost(item.doc.id))} /> : null));
  } else if (section === "exports") {
    body = <EmptyState icon="export" title={t("No exports on this host yet")} actions={[{ label: t("Export a project"), kind: "strong", onPress: () => router.push("/projects") }]} />;
  } else if (section === "media") {
    body = blobs.length === 0 ? <EmptyState icon="image" title={t("No media on this host yet")} actions={[{ label: t("Open Projects"), kind: "strong", onPress: () => router.push("/projects") }]} />
      : blobs.map((blob) => row(blob.sha256, blob.name || blob.sha256.slice(0, 12), `${blob.mime} · ${formatBytes(blob.size)} · ${blob.variants.join(", ")} · ${blob.linked ? t("Linked") : t("Stored")} · ${blob.refCount === 1 ? t("Used by 1 document") : t("Used by {n} documents", { n: blob.refCount })}`,
        <Button kind="ghost" size="sm" tone="danger" label={t("Delete")} disabled={blob.refCount > 0 || !sync.canWrite} onPress={() => void act(() => connection.call("jagentchill.blob.delete", { sha256: blob.sha256 }), t("Deleted"))} />));
  } else {
    body = trash.length === 0 ? <EmptyState icon="trash" title={t("The host trash is empty")} actions={[{ label: t("Open Projects"), kind: "strong", onPress: () => router.push("/projects") }]} />
      : trash.map((entry) => row(`${entry.kind}:${entry.id}`, entry.name || t("Untitled Project"), `${t(KIND_LABEL[entry.kind])} · ${t("Deleted on {name}", { name: entry.deletedByName })} · ${when(entry.deleted_ms)}`, (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button size="sm" label={t("Restore")} disabled={!sync.canWrite} testID="host-trash-restore" onPress={() => void act(() => connection.call("jagentchill.trash.restore", { kind: entry.kind, id: entry.id }), t("Restored"))} />
          <Button kind="ghost" size="sm" tone="danger" label={t("Delete permanently")} disabled={!sync.isAdmin} onPress={() => void act(() => connection.call("jagentchill.trash.purge", { kind: entry.kind, id: entry.id }), t("Deleted"))} />
        </View>
      )));
  }
  return (
    <Screen title={t("Storage on host")}>
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? compactScale.space.side : space[6], paddingBottom: compact ? compactScale.space.side : space[6], gap: compact ? compactScale.space.gapMedium : space[4], maxWidth: 960, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: space[1] }}>
          <Text variant="title-md">{t("Storage on {host}", { host: host.host.gatewayName })}</Text>
          <Text color="text/secondary">{t("Everyone paired with this host can see these items")}</Text>
        </View>
        <View style={{ gap: space[1] }} testID="host-storage">
          <ProgressBar value={Math.min(1, ratio)} tone={nearlyFull ? "warning" : undefined} label={t("Host storage")} />
          <Text variant="meta" color="text/secondary" testID="host-storage-text">{storage ? t("{used} of {total}", { used: formatBytes(storage.usedBytes), total: formatBytes(storage.quotaBytes) }) : ""}</Text>
        </View>
        {nearlyFull ? <Banner id="host-storage-full" tone="warning" actions={[{ label: t("Media"), onPress: () => { setSection("media"); setSort("size"); } }]}>{t("Host storage is almost full")}</Banner> : null}
        <Tabs id="host-space" label={t("Storage on host")} items={SECTIONS.map((entry) => ({ id: entry.id, label: t(entry.label) }))} value={section} onChange={(id) => { setSection(id as Section); setPhase("loading"); setDocs([]); setBlobs([]); setTrash([]); }} />
        <View style={{ flexDirection: compact ? "column" : "row", gap: space[2], alignItems: compact ? "stretch" : "center" }}>
          <View style={{ flex: 1, minWidth: 0 }}><SearchField label={t("Search by name")} placeholder={t("Search by name")} size="sm" value={query} onChangeText={setQuery} /></View>
          <Select label={t("Sort by")} width={compact ? undefined : 140} options={[{ value: "name", label: t("Name") }, { value: "date", label: t("Date") }, { value: "size", label: t("Size") }]} value={sort} onChange={(value) => setSort(value as Sort)} />
        </View>
        <View {...(Array.isArray(body) ? { role: "list" as const, "aria-label": t(SECTIONS.find((entry) => entry.id === section)!.label) } : null)}>{body}</View>
        {cursor !== null ? <Button size="sm" label={t("Show more")} onPress={() => void load(cursor)} /> : null}
        <View style={{ gap: space[2], marginTop: space[4] }}>
          <Text variant="title-sm">{t("Sync activity")}</Text>
          <SyncActivity />
        </View>
      </ScrollView>
    </Screen>
  );
}
