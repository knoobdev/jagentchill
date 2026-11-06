import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { binarySize, daysRemaining, formatDay, kindsPresent, type TrashEntry, type TrashKind } from "@jagentchill/app-core";
import { Button, Callout, EmptyState, Icon, IconButton, Menu, LoadingSkeleton, Skeleton, Tabs, Text, radius, space, useTheme, type Crumb, type IconName } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { Screen } from "../shell/Shell";
import { useDevice, useLibraryState } from "../state";
import { useProjectActions } from "./actions";
import { ProjectThumbnail } from "./ProjectsScreen";

const KIND: Record<TrashKind, { label: string; one: string; icon: IconName }> = {
  project: { label: "Projects", one: "Project", icon: "film" }, template: { label: "Templates", one: "Template", icon: "template" }, script: { label: "Scripts", one: "Script", icon: "doc" },
  "workflow-run": { label: "Workflow runs", one: "Workflow run", icon: "flow" }, film: { label: "Films", one: "Film", icon: "film" }, "film-panel-asset": { label: "Film assets", one: "Film asset", icon: "image" },
};

/** The one trash of the product: what was deleted on this device, kept for 30 days. Host-side kinds are listed only while the host is connected. */
export function TrashScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const actions = useProjectActions();
  const { library } = useDevice();
  const { host, status } = useHost();
  const state = useLibraryState();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [bytes, setBytes] = useState(0);
  const [filter, setFilter] = useState<"all" | TrashKind>("all");
  const now = Date.now();
  useEffect(() => {
    if (!library || state.status !== "ready") return;
    let cancelled = false;
    void Promise.all([library.trashEntries(), library.trashBytes()]).then(([list, size]) => { if (!cancelled) { setEntries(list); setBytes(size); } });
    return () => { cancelled = true; };
  }, [library, state.status, state.projects]);
  const kinds = useMemo(() => kindsPresent(entries ?? []), [entries]);
  useEffect(() => { if (filter !== "all" && !kinds.includes(filter)) setFilter("all"); }, [kinds, filter]);
  const shown = (entries ?? []).filter((entry) => filter === "all" || entry.kind === filter);
  const crumbs: Crumb[] = [{ id: "home", label: t("Home"), onPress: () => router.push("/home") }, { id: "all", label: t("All projects"), onPress: () => router.push("/projects") }, { id: "trash", label: t("Trash") }];
  const empty = entries !== null && entries.length === 0;
  return (
    <Screen title={t("Trash")} crumbs={crumbs}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? space[3] : space[5], gap: space[3] }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h1" level={1}>{t("Trash")}</Text>
            <Text color="text/secondary" style={{ marginTop: space[0.5] }}>{t("Items are kept for 30 days, then deleted permanently. Trash uses {size}.", { size: binarySize(bytes) })}</Text>
          </View>
          <Button kind="outline" tone="danger" icon="trash" label={t("Empty trash")} disabled={!entries || entries.length === 0} onPress={() => actions.emptyTrash(entries?.length ?? 0)} />
        </View>
        {host && status !== "connected" ? <Callout tone="info">{t("Connect to {host} to see items deleted there", { host: host.gatewayName })}</Callout> : null}
        {kinds.length > 1 ? <Tabs id="trash-kind" variant="pill" label={t("Kind")} value={filter} onChange={(id) => setFilter(id as "all" | TrashKind)}
          items={[{ id: "all", label: t("All"), count: entries?.length }, ...kinds.map((kind) => ({ id: kind, label: t(KIND[kind].label), count: entries?.filter((entry) => entry.kind === kind).length }))]} /> : null}
        {entries === null ? <LoadingSkeleton style={{ gap: space[1] }}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={40} />)}</LoadingSkeleton>
          : empty ? <EmptyState icon="trash" title={t("Trash is empty")} description={t("Deleted projects appear here for 30 days.")} actions={[{ label: t("All projects"), onPress: () => router.push("/projects") }]} />
          : (
            <View role="list" aria-label={t("Trash")}>
              {shown.map((entry) => <TrashRow key={`${entry.kind}-${entry.id}`} entry={entry} days={daysRemaining(entry.deleted_ms, now)} />)}
            </View>
          )}
      </ScrollView>
    </Screen>
  );
}

function TrashRow(props: { entry: TrashEntry; days: number }) {
  const t = useT();
  const theme = useTheme();
  const actions = useProjectActions();
  const state = useLibraryState();
  const [menu, setMenu] = useState(false);
  const more = useRef<View>(null);
  const { entry } = props;
  const project = state.projects.find((item) => item.id === entry.id);
  const name = entry.name || t("Unreadable project");
  return (
    <View role="listitem" testID={`trash-${name}`} style={{ minHeight: theme.touch ? 56 : 44, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      <View style={{ width: 48, height: 27, borderRadius: radius.xs, overflow: "hidden", backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
        {project ? <ProjectThumbnail project={project} version={actions.imageVersion} round={radius.xs} /> : <Icon name={KIND[entry.kind].icon} size={14} color="text/secondary" />}
      </View>
      <Icon name={KIND[entry.kind].icon} size={14} color="text/secondary" label={t(KIND[entry.kind].one)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-medium" numberOfLines={1}>{name}</Text>
        <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("Deleted {date}", { date: formatDay(entry.deleted_ms, theme.locale) })} · {props.days === 1 ? t("1 day left") : t("{n} days left", { n: props.days })}</Text>
      </View>
      {theme.compact ? (
        <>
          <IconButton ref={more} icon="more" label={t("Actions for {name}", { name })} expanded={menu} onPress={() => setMenu(true)} />
          <Menu open={menu} anchor={more} label={name} align="end" onClose={() => setMenu(false)} items={[
            { id: "restore", label: t("Restore"), icon: "undo", onSelect: () => void actions.restore([entry]) },
            { id: "delete", label: t("Delete permanently"), icon: "trash", danger: true, onSelect: () => actions.deleteForever([entry]) },
          ]} />
        </>
      ) : (
        <>
          <Button size="sm" icon="undo" label={t("Restore")} onPress={() => void actions.restore([entry])} />
          <Button size="sm" kind="ghost" tone="danger" label={t("Delete permanently")} onPress={() => actions.deleteForever([entry])} />
        </>
      )}
    </View>
  );
}
