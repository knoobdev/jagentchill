import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { downloadHostExport } from "@jagentchill/client";
import { binarySize, relativeTime, formatDay } from "@jagentchill/app-core";
import { SKILL_LIMITS, SKILL_NAME_PATTERN, type SkillCard, type SkillCatalogueItem, type SkillRecord, type SkillSource } from "@jagentchill/protocol";
import {
  AdaptiveSheet, Badge, Button, Callout, Card, Checkbox, Chip, ConfirmDialog, DestructiveConfirmDialog, EmptyState, FormDialog, FormField, Icon, Input, MarkdownView, Segmented, Select,
  SideSheet, Spinner, Switch, Table, Tabs, Text, Textarea, radius, space, useTheme, useToast, type Column, type Crumb, type MenuItem, SkeletonList, SkeletonText,
} from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { copyText, saveBlob } from "../platform/media";
import { openExternal } from "../platform/store";
import { SettingsPageFrame } from "../settings/SettingsScreen";
import { useHostScopeState, Screen } from "../shell/Shell";
import { skillReason, useSkills } from "./data";

type CardResult = { card: SkillCard; source?: { kind: string; label: string; reference: string; revision?: string }; skill?: SkillRecord; installedBy?: string };
type Prompt = { item: SkillCatalogueItem; card: SkillCard; source: NonNullable<CardResult["source"]>; update?: SkillRecord; onModified?: "fork" | "overwrite" };
const short = (revision: string | undefined) => (revision && /^[0-9a-f]{40,64}$/.test(revision) ? revision.slice(0, 7) : revision);
// "ClawHub" names where a skill installed before that registry was dropped came from.
const SOURCE_LABEL: Record<string, string> = { bundled: "Built-in", clawhub: "ClawHub", git: "Git repository", local: "Folder on the host", authored: "Written in the app", fork: "Copy of a skill", host: "Found on the host" };

/** Host ▸ Skills: what is installed, what can be installed, and the one place a skill is created, updated or removed. */
export function SkillsScreen(props: { skillId?: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const scope = useHostScopeState(t("Skills"));
  const { host, connection, status, can } = useHost();
  const agents = useAgentData();
  const admin = can("jagentchill.config.write");
  const { skills, stale, notices, error, reload } = useSkills();
  const [tab, setTab] = useState("installed");
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState<string | null>(props.skillId ?? null);
  const [editing, setEditing] = useState<{ skill?: SkillRecord; body?: string } | null>(null);
  const [removing, setRemoving] = useState<SkillRecord | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [sheet, setSheet] = useState<"sources" | "removed" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const call = useCallback(async <T,>(method: string, params: unknown, done?: string): Promise<T | undefined> => {
    if (!connection) return undefined;
    try {
      const result = await connection.call<T>(method, params);
      if (done) toast.show({ kind: "success", message: done });
      return result;
    } catch (err) { toast.show({ kind: "error", message: skillReason(err) }); return undefined; }
  }, [connection, toast]);
  const runtimeLabel = useCallback((id: string) => agents.catalogue?.groups.find((group) => group.runtimeId === id)?.label ?? id, [agents.catalogue]);
  const hostName = host?.gatewayName ?? t("the host");

  const shown = useMemo(() => (skills ?? []).filter((skill) => {
    const needle = query.trim().toLowerCase();
    if (needle && !`${skill.name}\n${skill.description}`.toLowerCase().includes(needle)) return false;
    if (scopeFilter !== "all" && (scopeFilter === "bundled") !== skill.bundled) return false;
    if (statusFilter === "enabled") return skill.enabled;
    if (statusFilter === "disabled") return !skill.enabled && skill.status === "ok";
    if (statusFilter === "invalid") return skill.status === "invalid";
    if (statusFilter === "update") return !!skill.updateAvailable;
    return true;
  }), [skills, query, scopeFilter, statusFilter]);
  const updatable = (skills ?? []).filter((skill) => skill.updateAvailable && !skill.pinned);
  const pinnedWithUpdate = (skills ?? []).filter((skill) => skill.updateAvailable && skill.pinned).length;

  /** The card of what would be installed, then the trust prompt: nothing is installed or updated without it. */
  async function review(item: SkillCatalogueItem, update?: SkillRecord, onModified?: "fork" | "overwrite") {
    setBusy(item.itemId);
    const result = await call<CardResult>("jagentchill.skill.catalogue.get", { itemId: item.itemId });
    setBusy(null);
    if (result?.source) setPrompt({ item, card: result.card, source: result.source, ...(update ? { update } : {}), ...(onModified ? { onModified } : {}) });
  }
  async function reviewUpdate(skill: SkillRecord, onModified?: "fork" | "overwrite") {
    const checked = await call<{ results: Array<{ skillId: string; itemId?: string; error?: string }> }>("jagentchill.skill.update.check", { skillIds: [skill.skillId] });
    const found = checked?.results[0];
    if (!found?.itemId) { if (found?.error) toast.show({ kind: "warning", message: t(found.error) }); return; }
    await review({ itemId: found.itemId, sourceId: skill.source.sourceId ?? "", sourceLabel: t(SOURCE_LABEL[skill.source.kind] ?? skill.source.kind), sourceKind: skill.source.kind as SkillCatalogueItem["sourceKind"], name: skill.name, description: skill.description, updateAvailable: true, reference: skill.source.ref ?? "" }, skill, onModified);
  }
  async function confirmPrompt(trustSource: boolean) {
    if (!prompt) return;
    setBusy("install");
    const done = prompt.update
      ? await call("jagentchill.skill.update.apply", { skillId: prompt.update.skillId, confirmedContentHash: prompt.card.contentHash, ...(prompt.onModified ? { onModified: prompt.onModified } : {}) }, t("{name} updated", { name: prompt.card.name }))
      : await call("jagentchill.skill.install", { itemId: prompt.item.itemId, confirmedContentHash: prompt.card.contentHash, trustSource, idempotencyKey: `install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, t("{name} installed", { name: prompt.card.name }));
    setBusy(null);
    if (done) { setPrompt(null); await reload(); }
  }
  async function checkUpdates() {
    setBusy("check");
    const result = await call<{ results: Array<{ updateAvailable: boolean }> }>("jagentchill.skill.update.check", {});
    setBusy(null);
    if (result) { const n = result.results.filter((entry) => entry.updateAvailable).length; toast.show({ kind: "info", message: n ? (n === 1 ? t("1 update available") : t("{n} updates available", { n })) : t("Every skill is up to date") }); await reload(); }
  }
  async function exportSkill(skill: SkillRecord) {
    const exported = await call<{ blobSha256: string; fileName: string; excluded: string[] }>("jagentchill.skill.export", { skillId: skill.skillId });
    if (!exported || !host) return;
    try {
      saveBlob(exported.fileName, await downloadHostExport(host, await loadSigner(), "skills", exported.blobSha256));
      toast.show({ kind: "success", message: exported.excluded.length ? t("Exported. Not included: {files}", { files: exported.excluded.join(", ") }) : t("Exported {name}", { name: exported.fileName }) });
    } catch (err) { toast.show({ kind: "error", message: skillReason(err) }); }
  }
  const setEnabled = (skill: SkillRecord, enabled: boolean) => connection!.call("jagentchill.skill.setEnabled", { skillId: skill.skillId, enabled }).then(() => reload());
  const menuOf = (skill: SkillRecord): MenuItem[] => [
    { id: "details", label: t("Details"), icon: "info", onSelect: () => setDetail(skill.skillId) },
    ...(admin ? [
      ...(skill.status === "ok" ? [{ id: "toggle", label: skill.enabled ? t("Disable") : t("Enable"), icon: "sliders" as const, onSelect: () => void setEnabled(skill, !skill.enabled).catch((err) => toast.show({ kind: "error", message: skillReason(err) })) }] : []),
      ...(skill.owned && (skill.source.kind === "git" || skill.source.kind === "local") && !skill.source.removed ? [{ id: "update", label: t("Update"), icon: "download" as const, onSelect: () => void reviewUpdate(skill) }] : []),
      ...(skill.owned ? [{ id: "pin", label: skill.pinned ? t("Unpin") : t("Pin this version"), icon: "pin" as const, onSelect: () => void call("jagentchill.skill.pin.set", { skillId: skill.skillId, pinned: !skill.pinned }).then(reload) }] : []),
      ...(skill.status === "ok" ? [{ id: "fork", label: t("Fork"), icon: "split" as const, onSelect: () => void call("jagentchill.skill.fork", { skillId: skill.skillId }, t("A copy of {name} was created", { name: skill.name })).then(reload) }] : []),
    ] : []),
    ...(Platform.OS === "web" && can("jagentchill.agent.use") && skill.status === "ok" ? [{ id: "export", label: t("Export"), icon: "ext" as const, onSelect: () => void exportSkill(skill) }] : []),
    ...(admin && skill.realPath ? [{ id: "path", label: t("Copy folder path"), icon: "copy" as const, onSelect: () => void copyText(skill.realPath!).then((ok) => ok && toast.show({ kind: "success", message: t("Folder path copied") })) }] : []),
    ...(admin && !skill.bundled ? [{ type: "separator" as const }, { id: "remove", label: t("Remove…"), icon: "trash" as const, danger: true, onSelect: () => setRemoving(skill) }] : []),
  ];
  const badges = (skill: SkillRecord) => [
    skill.bundled ? <Badge key="b" kind="built-in" label={t("Built-in")} /> : skill.owned ? <Badge key="o" label="JAgentChill" /> : <Badge key="f" label={t("Other")} />,
    skill.status === "invalid" ? <Badge key="i" tone="danger" label={t("Invalid")} /> : !skill.enabled ? <Badge key="d" label={t("Disabled")} /> : null,
    skill.hasScripts ? <Badge key="s" tone="warning" label={t("Has scripts")} /> : null, skill.pinned ? <Badge key="p" label={`${t("Pinned")} ${short(skill.pinnedRevision) ?? ""}`.trim()} /> : null,
    skill.updateAvailable ? <Badge key="u" tone="accent" label={t("Update available")} /> : null, skill.modifiedLocally ? <Badge key="m" label={t("Modified")} /> : null, skill.training ? <Badge key="t" label={t("Training")} /> : null,
  ];
  const columns: Array<Column<SkillRecord>> = [
    { id: "name", title: t("Skill"), flex: 3, text: (skill) => skill.name, render: (skill) => (
      <View style={{ gap: space[0.5], paddingVertical: space[1.5], minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], flexWrap: "wrap" }}><Text variant="body-medium" numberOfLines={1}>{skill.name}</Text>{badges(skill)}</View>
        <Text variant="meta" color={skill.status === "invalid" ? "danger/text" : "text/secondary"} numberOfLines={2}>{skill.status === "invalid" ? t(skill.invalidReason ?? "Invalid") : skill.description}</Text>
      </View>
    ) },
    { id: "version", title: t("Version"), width: 84, mono: true, text: (skill) => skill.version ?? short(skill.source.revision) ?? "—" },
    { id: "source", title: t("Source"), width: 140, text: (skill) => t(SOURCE_LABEL[skill.source.kind] ?? skill.source.kind) },
    { id: "runtimes", title: t("Runtimes"), flex: 2, text: (skill) => skill.visibleTo.map(runtimeLabel).join(", ") || "—", render: (skill) => <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>{skill.visibleTo.length ? <>{skill.visibleTo.slice(0, 2).map((id) => <Chip key={id} label={runtimeLabel(id)} />)}{skill.visibleTo.length > 2 ? <Text variant="meta" color="text/secondary">+{skill.visibleTo.length - 2}</Text> : null}</> : <Text color="text/secondary">—</Text>}</View> },
    { id: "enabled", title: t("Enabled"), width: 72, text: (skill) => (skill.enabled ? t("Enabled") : t("Disabled")), render: (skill) => <Switch value={skill.enabled} disabled={!admin || skill.status !== "ok" || stale} accessibilityLabel={t("Enable {name}", { name: skill.name })} onChange={(on) => setEnabled(skill, on)} errorMessage={skillReason} /> },
  ];

  if (scope) return <Screen title={t("Skills")}>{scope}</Screen>;
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }, { id: "skills", label: t("Skills") }];
  const installed = skills?.length ?? 0;
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Skills")} width={760} description={t("One list of skills for every agent and runtime: install, enable, create and train them.")}
      actions={admin ? <Button kind="secondary" size="sm" icon="plus" label={t("Create skill")} testID="skill-create" disabled={stale} onPress={() => setEditing({})} /> : undefined}>
      {stale ? <Callout tone="warning">{t("The agent engine is restarting on {host}", { host: hostName })}</Callout> : null}
      {!admin ? <Callout tone="info">{t("Only admin devices can install or change skills")}</Callout> : null}
      {notices.map((notice, index) => <Callout key={index} tone="info">{t(notice)}</Callout>)}
      <Tabs id="skills" label={t("Skills")} value={tab} onChange={setTab} items={[{ id: "installed", label: `${t("Installed")} (${installed})` }, { id: "browse", label: t("Browse") }]} />
      {tab === "installed" ? (
        <View testID="skills-installed" style={{ gap: space[3] }}>
          {error && !skills ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void reload() }]}>{skillReason(error)}</Callout> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {admin ? <Button size="sm" label={t("Check for updates")} loading={busy === "check"} disabled={stale} onPress={() => void checkUpdates()} /> : null}
            {admin && updatable.length ? <Button size="sm" label={t("Update all ({n})", { n: updatable.length })} onPress={() => { if (pinnedWithUpdate) toast.show({ kind: "info", message: pinnedWithUpdate === 1 ? t("1 pinned skill skipped") : t("{n} pinned skills skipped", { n: pinnedWithUpdate }) }); void reviewUpdate(updatable[0]); }} /> : null}
            <Button size="sm" label={t("Sources")} testID="skill-sources" onPress={() => setSheet("sources")} />
            {admin ? <Button size="sm" label={t("Recently removed")} onPress={() => setSheet("removed")} /> : null}
          </View>
          <Table label={t("Installed skills")} rows={shown} rowKey={(skill) => skill.skillId} columns={columns} rowMenu={menuOf} onRowPress={(skill) => setDetail(skill.skillId)} loading={skills === null && !error}
            search={{ value: query, onChange: setQuery, label: t("Search skills"), placeholder: t("Search skills") }}
            toolbar={<>
              <Select label={t("Scope")} size="sm" width={130} value={scopeFilter} onChange={setScopeFilter} options={[{ value: "all", label: t("All scopes") }, { value: "bundled", label: t("Built-in") }, { value: "global", label: t("Global") }]} />
              <Select label={t("Status")} size="sm" width={150} value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: t("All statuses") }, { value: "enabled", label: t("Enabled") }, { value: "disabled", label: t("Disabled") }, { value: "invalid", label: t("Invalid") }, { value: "update", label: t("Update available") }]} />
            </>}
            empty={installed === 0 ? { icon: "spark", title: t("No skills yet"), action: { label: t("Browse skills"), onPress: () => setTab("browse") } } : { icon: "search", title: t("No skills match your filters"), action: { label: t("Clear filters"), onPress: () => { setQuery(""); setScopeFilter("all"); setStatusFilter("all"); } } }} />
        </View>
      ) : <Browse admin={admin && !stale} busy={busy} onReview={(item) => void review(item)} onUpdate={(skillId) => { const skill = skills?.find((entry) => entry.skillId === skillId); if (skill) void reviewUpdate(skill); }} onSources={() => setSheet("sources")} status={status} />}

      <Detail skillId={detail} onClose={() => setDetail(null)} admin={admin && !stale} runtimeLabel={runtimeLabel} call={call} reload={reload}
        onEdit={(skill, body) => { setDetail(null); setEditing({ skill, body }); }} onRemove={(skill) => { setDetail(null); setRemoving(skill); }} onUpdate={(skill, onModified) => { setDetail(null); void reviewUpdate(skill, onModified); }} onExport={exportSkill} version={skills} />
      <SkillEditor state={editing} onClose={() => setEditing(null)} taken={(skills ?? []).map((skill) => skill.name)} onSaved={async () => { setEditing(null); await reload(); }} />
      <TrustPrompt prompt={prompt} hostName={hostName} busy={busy === "install"} onClose={() => setPrompt(null)} onConfirm={confirmPrompt} />
      <SourcesSheet open={sheet === "sources"} onClose={() => setSheet(null)} admin={admin} call={call} />
      <RemovedSheet open={sheet === "removed"} onClose={() => setSheet(null)} call={call} reload={reload} />
      <DestructiveConfirmDialog open={removing !== null} title={removing ? t("Remove {name}?", { name: removing.name }) : ""} confirmLabel={t("Remove skill")} irreversible={!!removing?.owned}
        description={removing?.owned ? t("Agents will no longer be able to use it.") : removing ? t("JAgentChill did not install this skill. Its folder {path} is copied to Recently removed for 30 days, then deleted.", { path: removing.realPath ?? "" }) : undefined}
        onClose={() => setRemoving(null)} onConfirm={() => { const target = removing!; setRemoving(null); void call("jagentchill.skill.remove", { skillId: target.skillId, ...(target.owned ? {} : { confirm: true }) }, t("{name} removed", { name: target.name })).then(reload); }} />
      <View style={{ height: theme.compact ? space[4] : 0 }} />
    </SettingsPageFrame>
  );
}

type Call = <T>(method: string, params: unknown, done?: string) => Promise<T | undefined>;

function Browse(props: { admin: boolean; busy: string | null; status: string; onReview(item: SkillCatalogueItem): void; onUpdate(skillId: string): void; onSources(): void }) {
  const t = useT();
  const theme = useTheme();
  const { connection, onEvent } = useHost();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [result, setResult] = useState<{ items: SkillCatalogueItem[]; nextCursor?: string; failedSourceIds: string[]; enabledSources: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async (cursor?: string) => {
    if (!connection) return;
    try {
      const listed = await connection.call<{ sources: SkillSource[] }>("jagentchill.skill.source.list", {});
      setSources(listed.sources);
      const page = await connection.call<{ items: SkillCatalogueItem[]; nextCursor?: string; failedSourceIds: string[]; enabledSources: number }>("jagentchill.skill.catalogue.list", { ...(query.trim() ? { query: query.trim() } : {}), ...(source !== "all" ? { sourceIds: [source] } : {}), ...(cursor ? { cursor } : {}) });
      setResult((current) => (cursor && current ? { ...page, items: [...current.items, ...page.items] } : page));
      setError(null);
    } catch (err) { setError(err); }
  }, [connection, query, source]);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => clearTimeout(timer); }, [load]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.skill.changed") void load(); }), [onEvent, load]);
  const enabled = sources.filter((entry) => entry.enabled);
  const columns = theme.formFactor === "wide" ? 3 : theme.compact ? 1 : 2;
  return (
    <View testID="skills-browse" style={{ gap: space[3] }}>
      <Input leadingIcon="search" clearable accessibilityLabel={t("Search skills to install")} placeholder={t("Search skills to install")} value={query} onChangeText={setQuery} onClear={() => setQuery("")} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
        <Chip size="md" label={t("All")} selected={source === "all"} onPress={() => setSource("all")} />
        {enabled.map((entry) => <Chip key={entry.id} size="md" label={entry.label} selected={source === entry.id} onPress={() => setSource(entry.id)} />)}
      </View>
      {error ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void load() }]}>{skillReason(error)}</Callout> : null}
      {(result?.failedSourceIds ?? []).map((id) => <Callout key={id} tone="warning" actions={[{ label: t("Retry"), onPress: () => void load() }]}>{t("Unable to load {source}", { source: sources.find((entry) => entry.id === id)?.label ?? id })}</Callout>)}
      {!result && !error ? <SkeletonList rows={6} leading="icon" meta style={{ padding: space[2] }} />
        : result && sources.length > 0 && enabled.length === 0 ? <EmptyState icon="spark" title={t("No sources are enabled")} actions={[{ label: t("Open sources"), onPress: props.onSources }]} />
        : result && result.items.length === 0 ? <EmptyState icon="search" title={t("No skills found")} description={t("Add a folder or a git repository under Sources.")} actions={[{ label: t("Open sources"), onPress: props.onSources }]} /> : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
            {(result?.items ?? []).map((item) => (
              <Card key={item.itemId} style={{ width: columns === 1 ? "100%" : `${(100 - (columns - 1) * 2) / columns}%`, gap: space[1.5] }}>
                <View testID={`skill-card-${item.name}`} style={{ gap: space[1.5], flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], flexWrap: "wrap" }}>
                    <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</Text>
                    {item.installed ? <Badge label={t("Installed")} /> : null}{item.updateAvailable ? <Badge tone="accent" label={t("Update available")} /> : null}
                  </View>
                  <Text variant="meta" color="text/secondary" numberOfLines={3} style={{ flex: 1 }}>{item.description}</Text>
                  <Text variant="meta" color="text/secondary" numberOfLines={1}>{[item.sourceLabel, item.version ?? short(item.revision)].filter(Boolean).join(" · ")}</Text>
                  <View style={{ alignItems: "flex-start" }}>
                    {item.installed ? (item.updateAvailable && props.admin ? <Button size="xs" label={t("Update")} onPress={() => props.onUpdate(item.installed!.skillId)} /> : <Button size="xs" label={t("Installed")} disabled />)
                      : props.admin ? <Button size="xs" kind="primary" label={t("Install")} testID={`skill-install-${item.name}`} loading={props.busy === item.itemId} onPress={() => props.onReview(item)} />
                      : <Text variant="meta" color="text/secondary">{t("Ask an admin device to install this skill")}</Text>}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      {result?.nextCursor ? <View style={{ alignItems: "center" }}><Button size="sm" label={t("Load more")} onPress={() => void load(result.nextCursor)} /></View> : null}
    </View>
  );
}

/** Nothing is installed or updated before an admin has seen what it is and where it comes from. */
function TrustPrompt(props: { prompt: Prompt | null; hostName: string; busy: boolean; onClose(): void; onConfirm(trustSource: boolean): void }) {
  const t = useT();
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const [trust, setTrust] = useState(false);
  const [view, setView] = useState(false);
  const card = props.prompt?.card;
  // A skill with scripts cannot be confirmed in the first three seconds.
  useEffect(() => { setTrust(false); setView(false); if (!card) return; setReady(!card.hasScripts); if (!card.hasScripts) return; const timer = setTimeout(() => setReady(true), 3000); return () => clearTimeout(timer); }, [card]);
  if (!props.prompt || !card) return null;
  const { source, update } = props.prompt;
  const row = (label: string, value: string) => <View style={{ flexDirection: "row", gap: space[2] }}><Text color="text/secondary" style={{ width: 96 }}>{label}</Text><Text selectable style={{ flex: 1 }}>{value}</Text></View>;
  return (
    <ConfirmDialog open title={update ? t("Update {name}?", { name: card.name }) : t("Install {name}?", { name: card.name })} confirmLabel={!ready ? t("Read first…") : update ? t("Update") : t("Install")} busy={props.busy || !ready} onClose={props.onClose} onConfirm={() => props.onConfirm(trust)}>
      <View testID="trust-prompt" style={{ gap: space[2] }}>
        <Text color="text/secondary">{card.description}</Text>
        {row(t("Source"), `${source.label} · ${t(SOURCE_LABEL[source.kind] ?? source.kind)}`)}
        {row(t("Reference"), source.reference)}
        {card.version || source.revision ? row(t("Version"), [card.version, short(source.revision)].filter(Boolean).join(" · ")) : null}
        {card.fileCount ? row(t("Files"), `${card.fileCount} · ${binarySize(card.sizeBytes)}`) : null}
        {row(t("Installed to"), t("The skills folder of {host}, for every agent", { host: props.hostName }))}
        {card.hasScripts ? <Callout tone="warning">{t("This skill includes scripts. An agent that can run commands will be able to run them on {host}.", { host: props.hostName })}</Callout> : null}
        {update?.modifiedLocally ? <Callout tone="warning">{props.prompt.onModified === "fork" ? t("Your changes are kept as a copy named {name}.", { name: `${update.name}-custom` }) : t("Your changes to this skill on the host are overwritten.")}</Callout> : null}
        {card.files.length ? (
          <View style={{ maxHeight: 96, overflow: "hidden", borderRadius: radius.sm, backgroundColor: theme.color("bg/inset"), padding: space[2] }}>
            {card.files.slice(0, 5).map((file) => <Text key={file.path} variant="mono" numberOfLines={1} color={file.script ? "warning/text" : "text/secondary"}>{file.path}{file.script ? `  · ${t("script")}` : ""}</Text>)}
            {card.files.length > 5 ? <Text variant="meta" color="text/secondary">{t("and {n} more", { n: card.files.length - 5 })}</Text> : null}
          </View>
        ) : null}
        <View style={{ alignItems: "flex-start" }}><Button size="xs" kind="ghost" label={view ? t("Hide SKILL.md") : t("View SKILL.md")} onPress={() => setView(!view)} /></View>
        {view ? <View style={{ maxHeight: 220, overflow: "scroll", borderRadius: radius.sm, backgroundColor: theme.color("bg/inset"), padding: space[2] }}><Text variant="mono" selectable>{card.markdown}</Text></View> : null}
        {!update && !card.hasScripts ? <Checkbox checked={trust} onChange={setTrust} label={t("Trust this source for updates")} /> : null}
      </View>
    </ConfirmDialog>
  );
}

function Detail(props: {
  skillId: string | null; onClose(): void; admin: boolean; runtimeLabel(id: string): string; call: Call; reload(): Promise<void>; version: unknown;
  onEdit(skill: SkillRecord, body: string): void; onRemove(skill: SkillRecord): void; onUpdate(skill: SkillRecord, onModified?: "fork" | "overwrite"): void; onExport(skill: SkillRecord): void;
}) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection, can } = useHost();
  const [data, setData] = useState<CardResult | null>(null);
  const [raw, setRaw] = useState("rendered");
  const [lesson, setLesson] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!props.skillId || !connection) { setData(null); return; }
    try { setData(await connection.call<CardResult>("jagentchill.skill.catalogue.get", { itemId: `installed:${props.skillId}` })); }
    catch (err) { toast.show({ kind: "error", message: skillReason(err) }); props.onClose(); }
  }, [props.skillId, connection, props.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const skill = data?.skill, card = data?.card;
  const body = card ? card.markdown.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "") : "";
  const act = async (method: string, params: Record<string, unknown>, done?: string) => { if (await props.call(method, params, done)) { await props.reload(); await load(); } };
  const section = (title: string) => <Text variant="body-medium" level={3} style={{ marginTop: space[2] }}>{title}</Text>;
  const fact = (label: string, value: string) => <View style={{ flexDirection: "row", gap: space[2] }}><Text color="text/secondary" style={{ width: 120 }}>{label}</Text><Text selectable style={{ flex: 1 }}>{value}</Text></View>;
  return (
    <SideSheet open={props.skillId !== null} onClose={props.onClose} title={skill?.name ?? t("Skill")}>
      {!skill || !card ? <SkeletonText lines={6} style={{ padding: space[4] }} /> : (
        <View testID="skill-detail" style={{ gap: space[2] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            {skill.bundled ? <Badge kind="built-in" label={t("Built-in")} /> : skill.owned ? <Badge label="JAgentChill" /> : <Badge label={t("Other")} />}
            {skill.hasScripts ? <Badge tone="warning" label={t("Has scripts")} /> : null}
            {skill.version ? <Text variant="meta" color="text/secondary">{skill.version}</Text> : null}
            {skill.updated_ms ?? skill.installed_ms ? <Text variant="meta" color="text/secondary">{t("Updated {time}", { time: relativeTime(skill.updated_ms ?? skill.installed_ms!, Date.now(), theme.locale) })}</Text> : null}
            <View style={{ flex: 1 }} />
            <Switch value={skill.enabled} disabled={!props.admin || skill.status !== "ok"} label={t("Enabled")} onChange={(on) => connection!.call("jagentchill.skill.setEnabled", { skillId: skill.skillId, enabled: on }).then(async () => { await props.reload(); await load(); })} errorMessage={skillReason} />
          </View>
          <Text color="text/secondary">{skill.status === "invalid" ? t(skill.invalidReason ?? "Invalid") : skill.description}</Text>
          {skill.hasScripts ? <Text variant="meta" color="text/secondary">{t("Scripts run only where an agent can run commands; a creative agent cannot.")}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text variant="body-medium" level={3} style={{ flex: 1 }}>SKILL.md</Text>
            <Segmented size="xs" label={t("View")} value={raw} onChange={setRaw} options={[{ value: "rendered", label: t("Rendered") }, { value: "source", label: t("Source") }]} />
          </View>
          <View style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, padding: space[3] }}>
            {/* A skill's text never loads a remote image and never opens a link without asking. */}
            {raw === "source" ? <Text variant="mono" selectable>{card.markdown}</Text> : <MarkdownView source={body} resolveImage={() => null} onLink={(href, kind) => { if (kind === "external") setLink(href); }} />}
          </View>
          {section(t("Files"))}
          <View>
            {card.files.map((file) => (
              <View key={file.path} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 24 }}>
                <Icon name={file.script ? "warn" : "doc"} size={14} color={file.script ? "warning/icon" : "text/secondary"} />
                <Text variant="mono" numberOfLines={1} style={{ flex: 1 }}>{file.path}</Text>
                {file.script ? <Text variant="meta" color="warning/text">{t("script")}</Text> : null}
                <Text variant="meta" color="text/secondary" tabular>{binarySize(file.sizeBytes)}</Text>
              </View>
            ))}
          </View>
          {section(t("Source"))}
          {skill.bundled ? <Text color="text/secondary">{t("Built-in — updated with JAgentChill")}</Text> : (
            <View style={{ gap: space[1] }}>
              {fact(t("Kind"), t(SOURCE_LABEL[skill.source.kind] ?? skill.source.kind))}
              {skill.source.ref ? fact(t("Reference"), skill.source.ref) : null}
              {skill.source.revision ? fact(t("Revision"), short(skill.source.revision)!) : null}
              {skill.installed_ms ? fact(t("Installed"), `${data.installedBy ? t("by {device}", { device: data.installedBy }) : ""} ${formatDay(skill.installed_ms)}`.trim()) : null}
              {skill.realPath ? fact(t("Folder"), skill.realPath) : null}
              {skill.source.removed ? <Text color="text/secondary">{t("Source removed — updates unavailable")}</Text> : null}
              {skill.modifiedLocally ? <Text color="warning/text">{t("Changed on the host since it was installed")}</Text> : null}
              {props.admin && skill.owned ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] }}>
                  {(skill.source.kind === "git" || skill.source.kind === "local") && !skill.source.removed ? (
                    skill.modifiedLocally ? <><Button size="xs" label={t("Update, keep my changes as a fork")} onPress={() => props.onUpdate(skill, "fork")} /><Button size="xs" label={t("Update, overwrite my changes")} onPress={() => props.onUpdate(skill, "overwrite")} /></>
                      : <Button size="xs" label={skill.updateAvailable ? t("Update") : t("Check now")} onPress={() => props.onUpdate(skill)} />
                  ) : skill.source.kind === "authored" || skill.source.kind === "fork" ? <Text variant="meta" color="text/secondary">{t("No update source")}</Text> : null}
                  {skill.canRollBack ? <Button size="xs" label={t("Roll back")} onPress={() => void act("jagentchill.skill.rollback", { skillId: skill.skillId }, t("Rolled back"))} /> : null}
                  <Button size="xs" label={skill.pinned ? t("Unpin") : t("Pin this version")} onPress={() => void act("jagentchill.skill.pin.set", { skillId: skill.skillId, pinned: !skill.pinned })} />
                  {!skill.hasScripts && skill.source.sourceId ? <Checkbox checked={skill.trustSource} onChange={(on) => void act("jagentchill.skill.trust.set", { skillId: skill.skillId, trustSource: on })} label={t("Trust this source for updates")} /> : null}
                </View>
              ) : null}
            </View>
          )}
          {section(t("Available to"))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {skill.visibleTo.length ? skill.visibleTo.map((id) => <Chip key={id} label={props.runtimeLabel(id)} />) : <Text color="text/secondary">{skill.enabled ? t("No enabled runtime loads skills by name") : t("Turned off: no agent can use it")}</Text>}
          </View>
          {section(t("Training"))}
          {card.lessons.length === 0 ? <Text color="text/secondary">{t("No lessons yet. A lesson is one sentence the skill keeps for next time.")}</Text> : card.lessons.map((entry) => (
            <View key={entry.lessonId} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text style={{ flex: 1 }}>{entry.text}</Text>
              <Text variant="meta" color="text/secondary">{entry.date}</Text>
              {props.admin && skill.owned ? <Button size="xs" kind="ghost" tone="danger" label={t("Delete")} onPress={() => void act("jagentchill.skill.lesson.update", { skillId: skill.skillId, lessonId: entry.lessonId, delete: true })} /> : null}
            </View>
          ))}
          {props.admin && skill.status === "ok" ? (
            <View style={{ gap: space[1] }}>
              <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
                <View style={{ flex: 1 }}><Input size="sm" accessibilityLabel={t("New lesson")} placeholder={t("Teach this skill one thing…")} value={lesson} onChangeText={setLesson} maxLength={SKILL_LIMITS.lessonChars} /></View>
                <Button size="sm" label={t("Add lesson")} disabled={!lesson.trim()} onPress={() => { const text = lesson.trim(); setLesson(""); void props.call<{ forked: boolean; skill: SkillRecord }>("jagentchill.skill.learn", { skillId: skill.skillId, lesson: text, approved: true }).then(async (result) => { if (!result) return; if (result.forked) toast.show({ kind: "info", message: skill.bundled ? t("Built-in skills cannot be changed — a copy was created") : t("A copy was created for the lesson") }); await props.reload(); await load(); }); }} />
              </View>
              {!skill.owned ? <Text variant="meta" color="text/secondary">{t("The lesson goes to a copy of this skill; the original stays as it is.")}</Text> : null}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] }}>
            {props.admin && skill.owned ? <Button size="sm" icon="pencil" label={t("Edit")} onPress={() => props.onEdit(skill, body)} /> : null}
            {props.admin && skill.status === "ok" ? <Button size="sm" icon="split" label={t("Fork")} onPress={() => void act("jagentchill.skill.fork", { skillId: skill.skillId }, t("A copy of {name} was created", { name: skill.name }))} /> : null}
            {Platform.OS === "web" && can("jagentchill.agent.use") && skill.status === "ok" ? <Button size="sm" icon="ext" label={t("Export")} onPress={() => props.onExport(skill)} /> : null}
            {props.admin && !skill.bundled ? <Button size="sm" kind="ghost" tone="danger" icon="trash" label={t("Remove")} onPress={() => props.onRemove(skill)} /> : null}
          </View>
          <ConfirmDialog open={link !== null} title={link ? t("Open {host}?", { host: (() => { try { return new URL(link).host; } catch { return link; } })() }) : ""} confirmLabel={t("Open")} onClose={() => setLink(null)} onConfirm={() => { const href = link!; setLink(null); openExternal(href); }} description={link ?? undefined} />
        </View>
      )}
    </SideSheet>
  );
}

function SkillEditor(props: { state: { skill?: SkillRecord; body?: string } | null; onClose(): void; taken: string[]; onSaved(): Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const { connection } = useHost();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const existing = props.state?.skill;
  useEffect(() => { setName(existing?.name ?? ""); setDescription(existing?.description ?? ""); setBody((props.state?.body ?? "").replace(/\n## Lessons\n[\s\S]*$/, "\n").trim()); }, [props.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameError = !name ? undefined : !SKILL_NAME_PATTERN.test(name) || name.length > SKILL_LIMITS.name ? t("Lower-case letters, digits and single hyphens, at most 64 characters") : !existing && props.taken.includes(name) ? t("A skill of that name already exists") : undefined;
  const dirty = name !== (existing?.name ?? "") || description !== (existing?.description ?? "") || body !== (props.state?.body ?? "").trim();
  async function save() {
    if (!connection) return;
    setBusy(true);
    try {
      await connection.call("jagentchill.skill.author", { ...(existing ? { skillId: existing.skillId, expectedContentHash: existing.contentHash } : {}), name, description: description.trim(), body });
      toast.show({ kind: "success", message: existing ? t("{name} saved", { name }) : t("{name} created", { name }) });
      await props.onSaved();
    } catch (err) { toast.show({ kind: "error", message: (err as { code?: string }).code === "CONFLICT" ? t("This skill changed on another device. Close and open it again to edit the current text.") : skillReason(err) }); }
    finally { setBusy(false); }
  }
  return (
    <FormDialog open={props.state !== null} title={existing ? t("Edit {name}", { name: existing.name }) : t("Create skill")} submitLabel={existing ? t("Save") : t("Create skill")} width={640} dirty={dirty} busy={busy}
      canSubmit={!!name && !nameError && description.trim().length > 0 && body.trim().length > 0} onSubmit={() => void save()} onClose={props.onClose}>
      <FormField label={t("Name")} error={nameError}>{(ids) => <Input testID="skill-name" value={name} onChangeText={(value) => setName(value.toLowerCase())} disabled={!!existing} invalid={!!nameError} mono maxLength={SKILL_LIMITS.name} labelledBy={ids.labelledBy} describedBy={ids.describedBy} placeholder="brand-voice" />}</FormField>
      <FormField label={t("Description")} description={t("When an agent should use this skill, in a sentence.")}>{(ids) => <Input testID="skill-description" value={description} onChangeText={setDescription} maxLength={SKILL_LIMITS.description} counter labelledBy={ids.labelledBy} describedBy={ids.describedBy} />}</FormField>
      <FormField label={t("Instructions")} description={t("Markdown. The agent reads this when the skill is attached.")}>{(ids) => <Textarea testID="skill-body" value={body} onChangeText={setBody} minLines={8} maxLines={16} mono labelledBy={ids.labelledBy} describedBy={ids.describedBy} />}</FormField>
    </FormDialog>
  );
}

function SourcesSheet(props: { open: boolean; onClose(): void; admin: boolean; call: Call }) {
  const t = useT();
  const theme = useTheme();
  const { connection } = useHost();
  const [sources, setSources] = useState<SkillSource[] | null>(null);
  const [kind, setKind] = useState<"local" | "git">("local");
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState("");
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const load = useCallback(async () => { if (connection) setSources((await connection.call<{ sources: SkillSource[] }>("jagentchill.skill.source.list", {}).catch(() => ({ sources: [] }))).sources); }, [connection]);
  useEffect(() => { if (props.open) void load(); }, [props.open, load]);
  const state = (source: SkillSource) => (source.state === "disabled" ? t("Disabled") : refreshing === source.id ? t("Refreshing…") : source.state === "error" ? `${t("Error")} — ${source.error ?? ""}` : source.itemCount !== undefined ? t("Ready · {n} skills", { n: source.itemCount }) : t("Ready"));
  const stored = (source: SkillSource) => { const { state: _state, itemCount: _count, error: _error, ...rest } = source; return rest; };
  return (
    <AdaptiveSheet open={props.open} onClose={props.onClose} title={t("Sources")} width={640} description={t("Where skills can be installed from. Removing a source keeps the skills installed from it.")}>
      <View testID="skill-sources-sheet" style={{ gap: space[2] }}>
        {!sources ? <SkeletonList rows={3} meta /> : sources.map((source, index) => (
          <View key={source.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1.5], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{source.label}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1}>{[t(SOURCE_LABEL[source.kind]), source.kind === "git" ? source.url : source.kind === "local" ? source.path : null].filter(Boolean).join(" · ")}</Text>
              <Text variant="meta" color={source.state === "error" ? "danger/text" : "text/secondary"} numberOfLines={2}>{state(source)}</Text>
            </View>
            {props.admin ? <>
              <Switch value={source.enabled} accessibilityLabel={t("Enable {name}", { name: source.label })} onChange={(on) => connection!.call("jagentchill.skill.source.upsert", { source: { ...stored(source), enabled: on } }).then(load)} errorMessage={skillReason} />
              <Button size="xs" label={t("Refresh")} loading={refreshing === source.id} disabled={!source.enabled} onPress={() => { setRefreshing(source.id); void props.call("jagentchill.skill.source.refresh", { id: source.id }).then(async () => { setRefreshing(null); await load(); }); }} />
              <Button size="xs" kind="ghost" tone="danger" label={t("Remove")} onPress={() => void props.call("jagentchill.skill.source.remove", { id: source.id }).then(load)} />
            </> : null}
          </View>
        ))}
        {props.admin ? (
          <View style={{ gap: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), paddingTop: space[3] }}>
            <Text variant="body-medium">{t("Add source")}</Text>
            <Segmented size="sm" label={t("Kind of source")} value={kind} onChange={(value) => setKind(value as "local" | "git")} options={[{ value: "local", label: t("Folder on the host") }, { value: "git", label: t("Git repository") }]} />
            <Input testID="source-label" accessibilityLabel={t("Name of the source")} placeholder={t("Name of the source")} value={label} onChangeText={setLabel} maxLength={80} />
            <Input testID="source-location" mono accessibilityLabel={kind === "git" ? t("Repository URL") : t("Folder path on the host")} placeholder={kind === "git" ? "https://github.com/team/skills" : "/Users/me/skills"} value={location} onChangeText={setLocation} />
            <View style={{ alignItems: "flex-start" }}>
              <Button size="sm" kind="primary" label={t("Add source")} testID="source-add" disabled={!label.trim() || !location.trim()}
                onPress={() => void props.call("jagentchill.skill.source.upsert", { source: { kind, label: label.trim(), enabled: true, ...(kind === "git" ? { url: location.trim() } : { path: location.trim() }) } }, t("Source added")).then(async (ok) => { if (ok) { setLabel(""); setLocation(""); await load(); } })} />
            </View>
          </View>
        ) : null}
      </View>
    </AdaptiveSheet>
  );
}

function RemovedSheet(props: { open: boolean; onClose(): void; call: Call; reload(): Promise<void> }) {
  const t = useT();
  const theme = useTheme();
  const { connection } = useHost();
  const [items, setItems] = useState<Array<{ backupId: string; name: string; originalPath: string; removed_ms: number; expires_ms: number }> | null>(null);
  const load = useCallback(async () => { if (connection) setItems((await connection.call<{ items: NonNullable<typeof items> }>("jagentchill.skill.removed.list", {}).catch(() => ({ items: [] }))).items); }, [connection]);
  useEffect(() => { if (props.open) void load(); }, [props.open, load]);
  return (
    <AdaptiveSheet open={props.open} onClose={props.onClose} title={t("Recently removed")} width={480} description={t("Skills JAgentChill did not install are kept here for 30 days after they are removed.")}>
      {!items ? <SkeletonList rows={4} /> : items.length === 0 ? <Text color="text/secondary">{t("Nothing was removed in the last 30 days.")}</Text> : items.map((item) => (
        <View key={item.backupId} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1.5] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-medium" numberOfLines={1}>{item.name}</Text>
            <Text variant="meta" color="text/secondary" numberOfLines={1}>{item.originalPath} · {relativeTime(item.removed_ms, Date.now(), theme.locale)}</Text>
          </View>
          <Button size="xs" label={t("Restore")} onPress={() => void props.call("jagentchill.skill.restore", { backupId: item.backupId }, t("{name} restored", { name: item.name })).then(async () => { await load(); await props.reload(); })} />
        </View>
      ))}
    </AdaptiveSheet>
  );
}
