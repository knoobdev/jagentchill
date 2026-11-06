import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { addFallback, contextLabel, defaultProfile, deleteRefusal, extraBodyCounter, fallbackChoices, groupedRoles, MAX_FALLBACKS, modelBadges, moveProfile, nextRequest, profileOptions, profileProblems, profileSummary, removeFallback, ROLE_ICON, ROLE_STATE_LABEL, roleConfig, routeIds, slugOf, withDefault, withoutProfile, withoutRoute, withProfile, withRoute, type OrcDescription, type OrcRoleView, formatAmount } from "@jagentchill/app-core";
import { PRODUCT_MODES, type GenerationModel, type GenerationProvider, type OrcConfig, type OrcProfile, type OrcRoleConfig } from "@jagentchill/protocol";
import { priceText } from "../generation/data";
import {
  Button, Callout, Card, Chip, FormField, GroupedSettingCard, Icon, IconButton, Input, ListCaption, Menu, Modal, NumberField, Radio, SearchField, Select, SettingRow, LoadingSkeleton, Skeleton, StatusPill, Switch, Tap, Text, Textarea,
  radius, space, useTheme, useToast, type Crumb, type IconName, type MenuItem, inlineIcon } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { reasonOf } from "../agents/errors";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { useHost } from "../host";
import { useT } from "../locale";
import { stacksSettingsRows } from "../pairing/mobile-settings-layout";
import { saveBlob } from "../platform/media";
import { pickFiles } from "../platform/store";
import { SettingsPageFrame } from "../settings/SettingsScreen";
import { AgentLimitRow } from "../agents/team/TeamsScreen";

const LIMITS: Array<{ key: string; label: string; unit?: string; min: number; max: number; step?: number }> = [
  { key: "concurrency", label: "Concurrency", min: 1, max: 16 }, { key: "timeoutSeconds", label: "Timeout", unit: "s", min: 5, max: 3600 }, { key: "retries", label: "Retries", min: 0, max: 5 }, { key: "costCapUsd", label: "Cost cap", unit: "USD", min: 0, max: 1000, step: 0.05 },
];

/** Host ▸ Model routing (ORC): which model each role uses — roles hold profiles, routes pick a primary profile and ordered fallbacks. */
export function OrcScreen() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { host, connection, can, onEvent, status } = useHost();
  const data = useAgentData();
  const admin = can("jagentchill.config.write");
  const [orc, setOrc] = useState<OrcDescription | null>(null);
  const [settingsFailure, setSettingsFailure] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ roleId: string; text: string } | null>(null);
  const [editing, setEditing] = useState<{ role: OrcRoleView; profile: OrcProfile | null } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(async () => {
    if (!connection) return;
    const [next, hostStatus] = await Promise.all([
      connection.call<OrcDescription>("jagentchill.orc.config.get", {}).catch(() => null),
      connection.call<{ settingsApplication?: { state: string; reason?: string } }>("jagentchill.settings.host.get", {}).catch(() => null),
    ]);
    setOrc(next);
    setSettingsFailure(hostStatus?.settingsApplication?.state === "failed" ? hostStatus.settingsApplication.reason ?? "" : null);
  }, [connection]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.orc.config.changed" || event.event === "jagentchill.runtime.updated" || event.event === "jagentchill.provider.changed" || event.event === "jagentchill.settings.host.changed") void load(); }), [onEvent, load]);

  /** Every control commits on its own: the change is stored, "Saved" shows for 2 s, and a refused change puts the stored value back. */
  async function commit(roleId: string | null, patch: { roles?: OrcConfig["roles"]; enabled?: boolean; autoPrepareBrief?: boolean; askWhenAmbiguous?: boolean }): Promise<boolean> {
    if (!connection || !orc) return false;
    setFailed(null);
    try {
      await connection.call("jagentchill.orc.config.update", { patch, expectedRevision: orc.revision });
      await load();
      setSaved(roleId ?? "global");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(null), 2000);
      return true;
    } catch (error) {
      await load();
      if (roleId) setFailed({ roleId, text: reasonOf(error) }); else toast.show({ kind: "error", message: reasonOf(error) });
      throw error;
    }
  }
  const saveRole = (roleId: string, next: OrcRoleConfig) => commit(roleId, { roles: { [roleId]: next } }).catch(() => false);
  const exportConfig = async () => {
    try {
      const { document } = await connection!.call<{ document: unknown }>("jagentchill.orc.config.export", {});
      saveBlob("jagentchill-orc.json", new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
      toast.show({ kind: "success", message: t("Routing exported") });
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
  };
  const importConfig = async () => {
    const [file] = await pickFiles("application/json,.json", false);
    if (!file || !orc) return;
    try {
      const document = JSON.parse(await file.text());
      const checked = await connection!.call<{ valid: boolean; issues: Array<{ path: string; message: string; level: string }> }>("jagentchill.orc.config.validate", { config: document?.config });
      if (!checked.valid) { toast.show({ kind: "error", message: `${t("The file was not imported")}: ${checked.issues.find((issue) => issue.level === "error")?.message ?? ""}` }); return; }
      await connection!.call("jagentchill.orc.config.import", { document, expectedRevision: orc.revision });
      await load();
      toast.show({ kind: "success", message: t("Routing imported") });
    } catch (error) { toast.show({ kind: "error", message: error instanceof SyntaxError ? t("The file is not valid JSON") : reasonOf(error) }); }
  };
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }, { id: "orc", label: t("Model routing (ORC)") }];
  const nothingUsable = data.catalogue !== null && !data.catalogue.groups.some((group) => group.providers.some((provider) => provider.models.some((model) => model.readiness === "ready")));
  const director = orc ? defaultProfile(roleConfig(orc.config, "director")) : undefined;
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Model routing (ORC)")} description={t("Which model each role uses, with ordered fallbacks. Stored on {host} and shared by every paired device.", { host: host?.gatewayName ?? t("the host") })}
      actions={<><Button size="sm" label={t("Import")} disabled={!admin || !orc} onPress={() => void importConfig()} /><Button size="sm" label={t("Export")} disabled={!admin || !orc} testID="orc-export" onPress={() => void exportConfig()} /></>}>
      {status !== "connected" ? <Callout tone="warning">{t("Reconnect to edit")}</Callout> : null}
      {settingsFailure !== null ? <Callout tone="warning"><View style={{ gap: space[1] }}><Text role="alert">{t("Settings not applied")}</Text>{settingsFailure ? <Text variant="meta">{settingsFailure}</Text> : null}</View></Callout> : null}
      {!orc ? <LoadingSkeleton style={{ gap: space[3] }}><Skeleton height={132} /><Skeleton height={56} /><Skeleton height={56} /></LoadingSkeleton> : (
        <>
          {!admin ? <Text variant="meta" color="text/secondary">{t("Admin devices can change these settings")}</Text> : null}
          <GroupedSettingCard>
            <SettingRow label={t("ORC enabled")} description={t("Route every agent and generation call through roles.")}><Switch value={orc.config.enabled} disabled={!admin} accessibilityLabel={t("ORC enabled")} onChange={(value) => commit(null, { enabled: value })} errorMessage={reasonOf} /></SettingRow>
            <SettingRow label={t("Prepare a brief automatically")} description={t("The director writes a task brief before delegating.")}><Switch value={orc.config.autoPrepareBrief} disabled={!admin} accessibilityLabel={t("Prepare a brief automatically")} onChange={(value) => commit(null, { autoPrepareBrief: value })} errorMessage={reasonOf} /></SettingRow>
            <SettingRow label={t("Ask when ambiguous")}><Switch value={orc.config.askWhenAmbiguous} disabled={!admin} accessibilityLabel={t("Ask when ambiguous")} onChange={(value) => commit(null, { askWhenAmbiguous: value })} errorMessage={reasonOf} /></SettingRow>
            <AgentLimitRow admin={admin} />
          </GroupedSettingCard>
          {!orc.config.enabled ? <Callout tone="info">{t("ORC is off: every role uses its default profile, with no fallbacks.")}</Callout> : null}
          {nothingUsable ? <Callout tone="info" actions={host ? [{ label: t("Open Providers"), onPress: () => router.push(hostSettingsRoute(host.gatewayId, "runtimes") as never) }] : undefined}>{t("Connect a provider to configure models")}</Callout> : null}
          <SearchField label={t("Search roles")} placeholder={t("Search roles…")} value={query} onChangeText={setQuery} debounce={0} />
          {groupedRoles(orc.roles, query).map((group) => (
            <View key={group.id} style={{ gap: space[2] }}>
              <ListCaption label={t(group.label)} />
              {group.roles.map((role) => (
                <RoleCard key={role.id} role={role} config={roleConfig(orc.config, role.id)} admin={admin} expanded={expanded === role.id} saved={saved === role.id} failure={failed?.roleId === role.id ? failed.text : null}
                  inherits={role.group === "coordination" && !roleConfig(orc.config, role.id).profiles.length ? (director ? t("Uses Director's model") : null) : null} providerLabel={data.providerLabel}
                  onToggle={() => setExpanded(expanded === role.id ? null : role.id)} onSave={(next) => saveRole(role.id, next)} onEdit={(profile) => setEditing({ role, profile })} />
              ))}
            </View>
          ))}
          {groupedRoles(orc.roles, query).length === 0 ? <Text color="text/secondary">{t("No roles match your search")}</Text> : null}
        </>
      )}
      {editing && orc ? <ProfileModal role={editing.role} config={roleConfig(orc.config, editing.role.id)} profile={editing.profile} admin={admin} failure={failed?.roleId === editing.role.id ? failed.text : null} onClose={() => { setFailed(null); setEditing(null); }}
        onSave={async (profile) => { const ok = await saveRole(editing.role.id, withProfile(roleConfig(orc.config, editing.role.id), profile)); if (ok) { setEditing(null); setExpanded(editing.role.id); } return ok; }} /> : null}
    </SettingsPageFrame>
  );
}

function RoleCard(props: {
  role: OrcRoleView; config: OrcRoleConfig; admin: boolean; expanded: boolean; saved: boolean; failure: string | null; inherits: string | null; providerLabel(id: string): string;
  onToggle(): void; onSave(next: OrcRoleConfig): Promise<boolean>; onEdit(profile: OrcProfile | null): void;
}) {
  const t = useT();
  const theme = useTheme();
  const { role, config, admin } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [instructionsFor, setInstructionsFor] = useState<string | null>(null);
  const [instructions, setInstructions] = useState(config.instructions ?? "");
  const anchors = useRef(new Map<string, View | null>());
  useEffect(() => { setInstructions(config.instructions ?? ""); }, [config.instructions]);
  const state = ROLE_STATE_LABEL[role.state] ?? ROLE_STATE_LABEL.not_configured;
  const summary = profileSummary(defaultProfile(config), props.providerLabel);
  const unusable = (profileId: string) => role.profiles.find((profile) => profile.id === profileId)?.unusableReason;
  const labelOf = (profileId: string) => { const profile = config.profiles.find((entry) => entry.id === profileId); return profile?.label ?? profileId; };
  const routes = routeIds(role, config);
  const profileChoices = config.profiles.filter((profile) => profile.enabled !== false).map((profile) => ({ value: profile.id, label: profile.label ?? profile.id }));
  const compact = stacksSettingsRows(theme.width);
  return (
    <Card padding={0}>
      <View testID={`role-${role.id}`}>
        <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: space[1], paddingHorizontal: space[3], paddingVertical: compact ? space[2] : space[1], minHeight: 52 }}>
          <Tap role="button" label={t(role.label)} expanded={props.expanded} onPress={props.onToggle} style={{ flex: compact ? undefined : 1, minWidth: 0, flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: space[1], paddingVertical: space[1] }}>
            {compact ? <>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1.5] }}>
                <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}><Icon name={(ROLE_ICON[role.id] ?? "bot") as IconName} size={16} /></View>
                <Text variant="body-medium" numberOfLines={2} style={{ flexShrink: 1 }}>{t(role.label)}</Text>
                <Chip size="sm" label={role.capability} />
                <StatusPill label={t(state.label)} tone={state.tone} />
              </View>
              <Text variant="meta" color="text/secondary" numberOfLines={2}>{summary ?? props.inherits ?? ""}</Text>
            </> : <>
              <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}><Icon name={(ROLE_ICON[role.id] ?? "bot") as IconName} size={16} /></View>
              <Text variant="body-medium" numberOfLines={1}>{t(role.label)}</Text>
              <Chip size="sm" label={role.capability} />
              <StatusPill label={t(state.label)} tone={state.tone} />
              <Text variant="meta" color="text/secondary" numberOfLines={1} align="right" style={{ flex: 1 }}>{summary ?? props.inherits ?? ""}</Text>
            </>}
          </Tap>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: compact ? "flex-end" : undefined, gap: space[1] }}>
            {props.saved ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Icon name="check" size={14} color="success" /><Text variant="meta" color="success/text">{t("Saved")}</Text></View> : null}
            <Switch value={config.enabled !== false} disabled={!admin} accessibilityLabel={t("Enable {name}", { name: t(role.label) })} onChange={(value) => props.onSave({ ...config, enabled: value }).then((ok) => { if (!ok) throw new Error(); })} errorMessage={() => t("The change was not saved")} />
            <IconButton icon={props.expanded ? "chev-d" : "chev-r"} size={compact ? undefined : "xs"} label={props.expanded ? t("Collapse {name}", { name: t(role.label) }) : t("Expand {name}", { name: t(role.label) })} expanded={props.expanded} onPress={props.onToggle} />
          </View>
        </View>
        {props.expanded ? (
          <View style={{ borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), padding: space[3], gap: space[2] }}>
            <Text variant="meta" color="text/secondary">{t(role.description)}</Text>
            {props.failure ? <Text color="danger/text" role="alert">{props.failure}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Profiles")}</Text>
              <Button kind="ghost" size="xs" icon="plus" label={t("Add profile")} disabled={!admin} testID={`add-profile-${role.id}`} onPress={() => props.onEdit(null)} />
            </View>
            {config.profiles.length === 0 ? <Text color="text/secondary">{props.inherits ?? t("Not configured")}</Text> : config.profiles.map((profile, index) => {
              const reason = unusable(profile.id);
              return (
                <View key={profile.id} testID={`profile-${profile.id}`} style={{ flexDirection: "row", flexWrap: stacksSettingsRows(theme.width) ? "wrap" : "nowrap", alignItems: "center", columnGap: space[2], rowGap: space[1], minHeight: 44 }}>
                  <IconButton icon="chev-u" size="xs" label={t("Move up")} disabled={!admin || index === 0} onPress={() => void props.onSave(moveProfile(config, profile.id, -1))} />
                  <IconButton icon="chev-d" size="xs" label={t("Move down")} disabled={!admin || index === config.profiles.length - 1} onPress={() => void props.onSave(moveProfile(config, profile.id, 1))} />
                  <Radio selected={(config.defaultProfileId ?? config.profiles[0].id) === profile.id} disabled={!admin} accessibilityLabel={t("Default profile: {name}", { name: profile.label ?? profile.id })} onSelect={() => void props.onSave(withDefault(config, profile.id))} />
                  <Text variant="body-medium" numberOfLines={1} style={{ width: 96 }}>{profile.label ?? profile.id}</Text>
                  <Text numberOfLines={1} color={reason && reason !== "disabled" ? "warning/text" : "text/primary"} style={{ flex: 1 }}>{[profile.runtime ?? null, props.providerLabel(profile.provider), profile.model].filter(Boolean).join(" · ")}</Text>
                  <Text variant="meta" color={reason && reason !== "disabled" ? "warning/text" : "text/secondary"} numberOfLines={1}>{reason && reason !== "disabled" ? reason : profileOptions(profile)}</Text>
                  <Switch value={profile.enabled !== false} disabled={!admin} accessibilityLabel={t("Enable {name}", { name: profile.label ?? profile.id })} onChange={(value) => void props.onSave(withProfile(config, { ...profile, enabled: value }))} />
                  <IconButton icon="pencil" size="xs" label={t("Edit {name}", { name: profile.label ?? profile.id })} disabled={!admin} onPress={() => props.onEdit(profile)} />
                  <IconButton icon="trash" size="xs" label={t("Delete {name}", { name: profile.label ?? profile.id })} disabled={!admin} onPress={() => { const why = deleteRefusal(config, profile.id); if (why) setRefusal(why); else { setRefusal(null); void props.onSave(withoutProfile(config, profile.id)); } }} />
                </View>
              );
            })}
            {refusal ? <Text color="danger/text" role="alert">{t(refusal)}</Text> : null}
            {config.profiles.length ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: space[1] }}>
                  <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Routes")}</Text>
                  <Text variant="meta" color="text/secondary">{t("primary → fallbacks in order (up to 5)")}</Text>
                </View>
                {routes.map((routeId) => {
                  const route = config.routes[routeId];
                  if (!route) {
                    return (
                      <View key={routeId} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 30 }}>
                        <Text variant="mono" style={{ width: 96 }} numberOfLines={1}>{routeId}</Text>
                        <Text color="text/secondary" style={{ flex: 1 }}>{t("Uses default")}</Text>
                        <Button kind="ghost" size="xs" label={t("Customise")} disabled={!admin} onPress={() => void props.onSave(withRoute(config, routeId, (current) => current))} />
                      </View>
                    );
                  }
                  const choices = fallbackChoices(config, route);
                  const next = nextRequest(route, (id) => !unusable(id));
                  const rowMenu: MenuItem[] = [
                    { id: "instructions", label: t("Route instructions"), icon: "pencil", onSelect: () => { setInstructions(route.instructions ?? ""); setInstructionsFor(routeId); } },
                    ...(routeId !== "default" ? [{ id: "reset", label: t("Reset to default"), icon: "undo" as IconName, onSelect: () => void props.onSave(withoutRoute(config, routeId)) }] : []),
                  ];
                  return (
                    <View key={routeId} testID={`route-${routeId}`} style={{ gap: space[1] }}>
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2], minHeight: 30 }}>
                        <Text variant="mono" style={{ width: 96 }} numberOfLines={1}>{routeId}</Text>
                        <Select label={t("Primary profile of {route}", { route: routeId })} size="sm" width={132} disabled={!admin} value={route.primary.profileId} options={profileChoices} onChange={(value) => void props.onSave(withRoute(config, routeId, (current) => ({ ...current, primary: { ...current.primary, profileId: value }, fallbacks: current.fallbacks.filter((target) => target.profileId !== value) })))} />
                        {unusable(route.primary.profileId) ? <Icon name="warn" size={14} color="warning/icon" label={unusable(route.primary.profileId)} /> : null}
                        <Icon name={inlineIcon(theme.rtl, "arrow-r")} size={14} color="text/tertiary" />
                        {route.fallbacks.map((target, index) => (
                          <Chip key={`${target.profileId}-${index}`} size="md" icon={unusable(target.profileId) ? "warn" : undefined} label={labelOf(target.profileId)} onRemove={admin ? () => void props.onSave(withRoute(config, routeId, (current) => removeFallback(current, index))) : undefined} />
                        ))}
                        <View ref={(node) => { anchors.current.set(`f-${routeId}`, node); }}>
                          <IconButton icon="plus" size="xs" label={route.fallbacks.length >= MAX_FALLBACKS ? t("Up to 5 fallbacks") : t("Add a fallback to {route}", { route: routeId })} disabled={!admin || route.fallbacks.length >= MAX_FALLBACKS || choices.length === 0} onPress={() => setFallbackFor(routeId)} />
                        </View>
                        <View style={{ flex: 1 }} />
                        <View ref={(node) => { anchors.current.set(`m-${routeId}`, node); }}><IconButton icon="more" size="xs" label={t("Options of {route}", { route: routeId })} disabled={!admin} onPress={() => setMenuFor(routeId)} /></View>
                        <Menu open={fallbackFor === routeId} anchor={{ current: anchors.current.get(`f-${routeId}`) ?? null }} label={t("Add a fallback")} onClose={() => setFallbackFor(null)}
                          items={choices.map((profile) => ({ id: profile.id, label: profile.label ?? profile.id, description: `${props.providerLabel(profile.provider)} · ${profile.model}`, onSelect: () => void props.onSave(withRoute(config, routeId, (current) => addFallback(current, profile.id))) }))} />
                        <Menu open={menuFor === routeId} anchor={{ current: anchors.current.get(`m-${routeId}`) ?? null }} label={t("Options of {route}", { route: routeId })} align="end" onClose={() => setMenuFor(null)} items={rowMenu} />
                      </View>
                      {next ? <Text variant="meta" color="warning/text">{t("Next request: {profile}", { profile: labelOf(next) })}</Text> : null}
                      {route.instructions ? <Text variant="meta" color="text/secondary" numberOfLines={2}>{route.instructions}</Text> : null}
                    </View>
                  );
                })}
                {role.capability === "llm" ? <Text variant="meta" color="text/secondary">{t("Retries and fallback timing for chat turns follow the host's failover")}</Text> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] }}>
                  {LIMITS.map((limit) => (
                    <NumberField key={limit.key} label={t(limit.label)} size="sm" width={132} unit={limit.unit} min={limit.min} max={limit.max} step={limit.step} disabled={!admin} value={config.limits[limit.key] ?? null}
                      onCommit={(value) => void props.onSave({ ...config, limits: { ...config.limits, [limit.key]: value } })} />
                  ))}
                </View>
              </>
            ) : null}
            <FormField label={t("Instructions for this role")} description={`${formatAmount(instructions.length)} / ${formatAmount(8000)}`}>
              {(ids) => <Textarea value={instructions} maxLength={8000} minLines={2} maxLines={8} disabled={!admin} labelledBy={ids.labelledBy} describedBy={ids.describedBy} onChangeText={setInstructions}
                onBlur={() => { if ((config.instructions ?? "") !== instructions) void props.onSave({ ...config, instructions: instructions || undefined }); }} />}
            </FormField>
          </View>
        ) : null}
        {instructionsFor ? (
          <Modal title={t("Route instructions")} description={`${t(role.label)} · ${instructionsFor}`} width={480} onClose={() => { setInstructionsFor(null); setInstructions(config.instructions ?? ""); }}
            footer={<><Button kind="ghost" label={t("Cancel")} onPress={() => { setInstructionsFor(null); setInstructions(config.instructions ?? ""); }} /><Button kind="primary" label={t("Save")} onPress={() => { const routeId = instructionsFor; const text = instructions; setInstructionsFor(null); setInstructions(config.instructions ?? ""); void props.onSave(withRoute(config, routeId, (current) => ({ ...current, instructions: text || undefined }))); }} /></>}>
            <Textarea value={instructions} maxLength={4000} minLines={4} maxLines={12} onChangeText={setInstructions} accessibilityLabel={t("Route instructions")} />
          </Modal>
        ) : null}
      </View>
    </Card>
  );
}

/** "Add profile" and "Edit": runtime, provider, model and options on one scrolling form. */
function ProfileModal(props: { role: OrcRoleView; config: OrcRoleConfig; profile: OrcProfile | null; admin: boolean; failure: string | null; onClose(): void; onSave(profile: OrcProfile): Promise<boolean> }) {
  const t = useT();
  const theme = useTheme();
  const { host, connection } = useHost();
  const data = useAgentData();
  const { role, profile } = props;
  const llm = role.capability === "llm";
  // A generation role is also served by the host's generation catalogue (a connected provider, a model downloaded to this computer).
  const [catalogue, setCatalogue] = useState<{ providers: GenerationProvider[]; models: GenerationModel[] }>({ providers: [], models: [] });
  useEffect(() => {
    if (llm || !connection) return;
    void Promise.all([connection.call<{ providers: GenerationProvider[] }>("jagentchill.provider.list", { capability: role.capability }), connection.call<{ models: GenerationModel[] }>("jagentchill.provider.model.list", { capability: role.capability })])
      .then(([listed, found]) => setCatalogue({ providers: listed.providers, models: found.models })).catch(() => undefined);
  }, [connection, llm, role.capability]);
  const groups = llm ? (data.catalogue?.groups ?? []).filter((group) => !group.requiresFullAccess) : [];
  const [runtime, setRuntime] = useState(profile?.runtime ?? groups[0]?.runtimeId ?? "");
  const [provider, setProvider] = useState(profile?.provider ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState(profile?.thinking ?? "");
  const [mode, setMode] = useState<string>(profile?.mode ?? "");
  const [temperature, setTemperature] = useState<number | null>(typeof profile?.params?.temperature === "number" ? profile.params.temperature : null);
  const [maxOutput, setMaxOutput] = useState<number | null>(typeof profile?.params?.maxOutputTokens === "number" ? profile.params.maxOutputTokens : null);
  const [extraBody, setExtraBody] = useState(profile?.params?.extraBody ? JSON.stringify(profile.params.extraBody, null, 2) : "");
  const [label, setLabel] = useState(profile?.label ?? "");
  const [id, setId] = useState(profile?.id ?? "");
  const [idTouched, setIdTouched] = useState(profile !== null);
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const group = groups.find((entry) => entry.runtimeId === runtime);
  // Generation roles are served by the endpoints that declare the capability.
  const providers = llm ? (group?.providers ?? []).map((entry) => ({ id: entry.providerId, label: entry.label, endpoint: data.endpoints.some((endpoint) => endpoint.id === entry.providerId), ready: entry.connected }))
    : [...catalogue.providers.filter((entry) => catalogue.models.some((model) => model.provider === entry.id)).map((entry) => ({ id: entry.id, label: entry.label, endpoint: false, ready: entry.connection === "connected" })),
      ...data.endpoints.filter((endpoint) => endpoint.enabled && endpoint.capabilities.includes(role.capability as never) && !catalogue.providers.some((entry) => entry.id === endpoint.id)).map((endpoint) => ({ id: endpoint.id, label: endpoint.label, endpoint: true, ready: endpoint.projected }))];
  const models = llm ? (group?.providers.find((entry) => entry.providerId === provider)?.models ?? []).filter((entry) => !role.id.includes("vision") || entry.input.includes("image")) : [];
  const catalogueModels = llm ? [] : catalogue.models.filter((entry) => entry.provider === provider);
  const endpointModels = llm ? [] : catalogueModels.length ? catalogueModels.map((entry) => ({ id: entry.id, label: entry.label, price: priceText(t, entry.pricing), off: !entry.enabled })) : (data.endpoints.find((endpoint) => endpoint.id === provider)?.models.filter((entry) => entry.enabled) ?? []).map((entry) => ({ id: entry.id, label: entry.label, price: t("Price unknown"), off: false }));
  const needle = query.trim().toLowerCase();
  const chosen = models.find((entry) => entry.modelId === model);
  const counter = extraBodyCounter(extraBody);
  const problems = profileProblems({ id, label, provider, model, extraBody }, props.config.profiles.map((entry) => entry.id), profile !== null);
  const pickModel = (modelId: string) => {
    const next = models.find((entry) => entry.modelId === modelId);
    // Option values the new model does not offer are cleared, and the form says how many.
    const dropped = thinking && next && !next.thinkingOptions.some((option) => option.id === thinking) ? 1 : 0;
    if (dropped) setThinking("");
    setResetNote(dropped ? t("1 option was reset") : null);
    setModel(modelId);
  };
  const save = async () => {
    setBusy(true);
    const params: Record<string, unknown> = { ...(temperature !== null ? { temperature } : {}), ...(maxOutput !== null ? { maxOutputTokens: maxOutput } : {}), ...(extraBody.trim() ? { extraBody: JSON.parse(extraBody) } : {}) };
    await props.onSave({ id, ...(label.trim() ? { label: label.trim() } : {}), ...(llm ? { runtime } : {}), provider, model, ...(thinking ? { thinking } : {}), ...(mode ? { mode: mode as OrcProfile["mode"] } : {}), params, enabled, source: "user" });
    setBusy(false);
  };
  const step = (n: number, text: string) => <Text variant="body-medium" level={3}>{n} · {text}</Text>;
  let n = 0;
  return (
    <Modal title={profile ? t("Edit profile") : t("Add profile")} description={t("Role: {role} · capability {capability}", { role: t(role.label), capability: role.capability })} width={640} onClose={props.onClose} dirty={model !== (profile?.model ?? "") || label !== (profile?.label ?? "")}
      footer={<><Button kind="ghost" label={t("Cancel")} onPress={props.onClose} /><Button kind="primary" label={t("Save")} loading={busy} disabled={!props.admin || Object.keys(problems).length > 0} testID="profile-save" onPress={() => void save()} /></>}>
      <View testID="profile-modal" style={{ gap: space[2] }}>
        {props.failure ? <Callout tone="danger">{props.failure}</Callout> : null}
        {llm ? (
          <>
            {step(++n, t("Runtime"))}
            <Select label={t("Runtime")} value={runtime} onChange={(value) => { setRuntime(value); setProvider(""); setModel(""); setThinking(""); }}
              options={groups.map((entry) => ({ value: entry.runtimeId, label: entry.label, description: entry.readiness === "ready" ? t("Installed CLI") : t("Not ready") }))} />
            {group ? <Callout tone="warning">{t("Agents on this runtime can run commands on {host}", { host: host?.gatewayName ?? "" })}</Callout> : null}
          </>
        ) : null}
        {step(++n, t("Provider"))}
        <Select label={t("Provider")} value={provider || null} placeholder={providers.length ? t("Choose a provider") : t("Connect a provider to configure models")} disabled={providers.length === 0}
          onChange={(value) => { setProvider(value); setModel(""); setThinking(""); }} options={providers.map((entry) => ({ value: entry.id, label: entry.endpoint ? `${entry.label} · ${t("Endpoint")}` : entry.label, description: t(entry.ready ? "Connected" : "Not connected") }))} />
        {step(++n, t("Model"))}
        <SearchField label={t("Search models")} placeholder={t("Search models…")} size="sm" value={query} onChangeText={setQuery} debounce={0} />
        <ScrollView style={{ maxHeight: 200, borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md }}>
          {(llm ? models.filter((entry) => !needle || entry.label.toLowerCase().includes(needle) || entry.modelId.toLowerCase().includes(needle)).map((entry) => ({ id: entry.modelId, label: entry.label, badges: modelBadges(entry), detail: contextLabel(entry.contextWindow) ?? "", price: undefined as string | undefined }))
            : endpointModels.filter((entry) => !needle || entry.id.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle)).map((entry) => ({ id: entry.id, label: entry.label, badges: entry.off ? ["Off"] : [] as string[], detail: "", price: entry.price }))).map((entry) => (
            <Tap key={entry.id} role="radio" label={entry.label} checked={model === entry.id} testID={`profile-model-${entry.id}`} onPress={() => pickModel(entry.id)}
              style={(state) => ({ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1.5], backgroundColor: model === entry.id ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
              <Icon name={model === entry.id ? "check-f" : "circle"} size={16} color={model === entry.id ? "accent" : "text/tertiary"} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="body-medium" numberOfLines={1}>{entry.label}</Text>
                <View style={{ flexDirection: "row", gap: space[1] }}>{entry.badges.map((badge) => <Chip key={badge} size="sm" label={t(badge)} />)}</View>
              </View>
              <View style={{ alignItems: "flex-end" }}><Text variant="meta" color="text/secondary">{entry.price ?? t("Price unknown")}</Text><Text variant="meta" color="text/secondary">{entry.detail}</Text></View>
            </Tap>
          ))}
          {provider && (llm ? models.length : endpointModels.length) === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("No {capability} models are enabled for this provider", { capability: role.capability })}</Text></View> : null}
          {!provider ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("Choose a provider first")}</Text></View> : null}
        </ScrollView>
        <Text variant="body-medium" level={3}>{++n} · {t("Options")} <Text variant="meta" color="text/secondary">— {t("untouched options keep the model default")}</Text></Text>
        {resetNote ? <Text variant="meta" color="warning/text">{resetNote}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
          {llm && (chosen?.thinkingOptions.length ?? 0) > 0 ? <Select label={t("Thinking")} size="sm" width={160} value={thinking || "default"} onChange={(value) => setThinking(value === "default" ? "" : value)} options={[{ value: "default", label: t("Model default") }, ...chosen!.thinkingOptions.map((option) => ({ value: option.id, label: option.label }))]} /> : null}
          {llm ? <Select label={t("Starting mode")} size="sm" width={160} value={mode || "default"} onChange={(value) => setMode(value === "default" ? "" : value)} options={[{ value: "default", label: t("Runtime default") }, ...PRODUCT_MODES.map((entry) => ({ value: entry, label: entry[0].toUpperCase() + entry.slice(1) }))]} /> : null}
          <NumberField label={t("Temperature")} size="sm" width={150} min={0} max={2} step={0.1} value={temperature} onCommit={setTemperature} />
          <NumberField label={t("Max output")} size="sm" width={170} unit={t("tokens")} min={1} max={1_000_000} value={maxOutput} onCommit={setMaxOutput} />
        </View>
        <FormField label={t("Extra request body (JSON)")} description={counter.text} error={problems.extraBody ? `${counter.text} — ${t(problems.extraBody)}` : undefined}>
          {(ids) => <Textarea value={extraBody} mono minLines={2} maxLines={6} invalid={!!problems.extraBody} error={ids.error} labelledBy={ids.labelledBy} describedBy={ids.describedBy} onChangeText={setExtraBody} />}
        </FormField>
        <View style={{ flexDirection: "row", gap: space[2], alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}><FormField label={t("Label")}>{(ids) => <Input value={label} maxLength={60} labelledBy={ids.labelledBy} onChangeText={(value) => { setLabel(value); if (!idTouched) setId(slugOf(value)); }} />}</FormField></View>
          <View style={{ flex: 1 }}><FormField label={t("ID")} error={id && problems.id ? t(problems.id) : undefined}>{(ids) => <Input value={id} mono autoCapitalize="none" maxLength={40} readOnly={profile !== null} error={ids.error} labelledBy={ids.labelledBy} onChangeText={(value) => { setId(value); setIdTouched(true); }} />}</FormField></View>
          <Switch value={enabled} onChange={setEnabled} label={t("Enabled")} />
        </View>
      </View>
    </Modal>
  );
}
