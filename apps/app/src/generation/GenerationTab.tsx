import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { HostError } from "@jagentchill/client";
import { GENERATION_CAPABILITIES, type BudgetState, type GenerationCapability, type GenerationModel, type GenerationProvider, type GenerationThresholds } from "@jagentchill/protocol";
import { Avatar, Badge, Button, Callout, Card, Chip, ConfirmDialog, Dot, FormField, Input, SearchField, SkeletonTable, Switch, Tap, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { CAPABILITY_LABEL, HEALTH_LABEL, priceText, usd, useGeneration } from "./data";
import { LocalModelsCard } from "./LocalModelsCard";

const KEY_SECRET = "PROVIDER_OPENROUTER_API_KEY";
const message = (error: unknown, fallback: string) => (error instanceof HostError ? error.message : fallback);

/** Settings ▸ Providers ▸ Generation: the media providers of the host, their models, and the budgets and approvals of generation. */
export function GenerationTab() {
  const t = useT();
  const theme = useTheme();
  const { can, status } = useHost();
  const generation = useGeneration();
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState<GenerationCapability | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const admin = can("jagentchill.config.write") && status === "connected";
  if (!generation.loaded) return <SkeletonTable rows={3} columns={5} style={{ padding: space[4] }} />;
  const needle = query.trim().toLowerCase();
  const rows = generation.providers.filter((provider) => (capability === "all" || provider.capabilities.includes(capability)) && (!needle || provider.label.toLowerCase().includes(needle)));
  const open = generation.providers.find((provider) => provider.id === openId) ?? null;
  const offered = GENERATION_CAPABILITIES.filter((id) => generation.providers.some((provider) => provider.capabilities.includes(id)));
  // A kind of work is "without a provider" only when no provider that is connected and on has a model of that kind
  // turned on: the same fact the provider's own card states with its "what is sent" lines (the host's capability list
  // alone leaves out the kinds a provider serves beside its main ones — listening, translating).
  const served = (id: GenerationCapability) => generation.providers.some((provider) => provider.connection === "connected" && provider.enabled && (provider.modelCounts[id]?.enabled ?? 0) > 0);
  const missing = generation.capabilities.filter((entry) => !entry.available && entry.reason === "no provider available" && !served(entry.capability));
  return (
    <View testID="generation-tab" style={{ gap: space[3] }}>
      {!admin ? <Callout tone="info">{t("Admin devices can change these settings")}</Callout> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <View style={{ width: 220 }}><SearchField label={t("Search providers")} placeholder={t("Search providers…")} size="sm" value={query} onChangeText={setQuery} debounce={0} /></View>
        {(["all", ...offered] as const).map((id) => <Chip key={id} size="md" label={id === "all" ? t("All") : t(CAPABILITY_LABEL[id])} selected={capability === id} onPress={() => setCapability(id)} />)}
      </View>
      <Card padding={0}>
        {rows.length === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("No providers match")}</Text></View> : rows.map((provider, index) => {
          const health = HEALTH_LABEL[provider.health], enabledModels = Object.values(provider.modelCounts).reduce((sum, count) => sum + (count?.enabled ?? 0), 0);
          return (
            <View key={provider.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 44, paddingHorizontal: space[3], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
              <Tap role="button" label={provider.label} testID={`generation-provider-${provider.id}`} onPress={() => setOpenId(openId === provider.id ? null : provider.id)} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1.5] }}>
                <Avatar name={provider.label} id={provider.id} square size={20} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Text variant="body-medium" numberOfLines={1}>{provider.label}</Text><Badge label={t(provider.source === "server" ? "Built in" : provider.source === "endpoint" ? "Endpoint" : provider.source === "local" ? "On this computer" : "Agent engine")} /></View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{provider.capabilities.map((id) => <Chip key={id} size="sm" label={t(CAPABILITY_LABEL[id])} />)}</View>
                </View>
                <Text testID={`generation-connection-${provider.id}`} color={provider.connection === "connected" ? "success/text" : provider.connection === "invalid" ? "danger/text" : "text/secondary"}>{t(provider.source === "local" ? (provider.connection === "connected" ? "Downloaded" : "Not downloaded") : provider.connection === "connected" ? "Connected" : provider.connection === "invalid" ? "Key missing" : "Not connected")}</Text>
                {provider.connection === "connected" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Dot tone={health.tone} label={t(health.label)} /><Text variant="meta" color="text/secondary">{t(health.label)}</Text></View> : null}
                <Text variant="meta" tabular color="text/secondary">{t("{n} models on", { n: enabledModels })}</Text>
              </Tap>
              <Switch accessibilityLabel={t("Use {provider} for generation", { provider: provider.label })} value={provider.enabled} disabled={!admin || provider.connection !== "connected"} onChange={(enabled) => generation.call("jagentchill.provider.update", { providerId: provider.id, enabled })} />
            </View>
          );
        })}
      </Card>
      {missing.length ? <Text variant="meta" color="text/secondary" testID="generation-missing">{t("No provider available for: {list}", { list: missing.map((entry) => t(CAPABILITY_LABEL[entry.capability])).join(", ") })}</Text> : null}
      {open ? <ProviderDetail key={open.id} provider={open} admin={admin} call={generation.call} /> : null}
      {/* Models that run on the host: downloaded here, on demand, after the hardware check. */}
      <View testID="local-models" style={{ gap: space[2], marginTop: space[3] }}>
        <Text variant="body-medium" level={2}>{t("Local models")}</Text>
        <Text variant="meta" color="text/secondary">{t("Free models that run on this computer. Nothing is downloaded until you press Download.")}</Text>
        <LocalModelsCard admin={admin} />
      </View>
      <BudgetsAndApprovals admin={admin} call={generation.call} />
    </View>
  );
}

type Call = <R = unknown>(method: string, params?: unknown) => Promise<R>;

function ProviderDetail(props: { provider: GenerationProvider; admin: boolean; call: Call }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { secrets, host } = useHost();
  const { provider, admin, call } = props;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; detail?: string } | null>(null);
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [asking, setAsking] = useState(false);
  const connected = provider.connection === "connected", local = provider.source === "local";
  const load = useCallback(async () => {
    setModels((await call<{ models: GenerationModel[] }>("jagentchill.provider.model.list", { providerId: provider.id })).models);
  }, [call, provider.id]);
  useEffect(() => { void load().catch(() => undefined); }, [load, provider.updated_ms, provider.connection]);
  const act = async (name: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(name); setProblem(null);
    try { await work(); await load(); if (done) toast.show({ kind: "success", message: done }); }
    catch (error) { const details = error instanceof HostError ? error.details : undefined; setProblem({ text: message(error, t("The request failed")), ...(details?.statusCode ? { detail: t("Details: status {code}", { code: String(details.statusCode) }) } : {}) }); }
    finally { setBusy(null); }
  };
  // The key travels over the secret route, never in a call; the call names it only.
  const connectWithKey = (replace: boolean) => act("connect", async () => {
    const value = key.trim();
    if (!value) throw new HostError("INVALID_PARAMS", t("Enter an API key"));
    const name = replace ? `${KEY_SECRET}_NEW` : KEY_SECRET;
    await secrets!.put(name, value);
    setKey("");
    await call(replace ? "jagentchill.provider.key.replace" : "jagentchill.provider.connect", replace ? { providerId: provider.id, secretName: name } : { providerId: provider.id, secretNames: [name] });
  }, t("Connected"));
  // Every kind of work this provider has a model for — also the ones beside its main kinds (listening, translating).
  const groups = GENERATION_CAPABILITIES.filter((capability) => provider.capabilities.includes(capability) || models.some((model) => model.capability === capability)).map((capability) => ({ capability, list: models.filter((model) => model.capability === capability) })).filter((group) => group.list.length);
  return (
    <View testID="generation-detail" style={{ gap: space[3] }}>
      {local ? (
        <Card><View style={{ gap: space[1] }}><Text variant="body-medium">{t("On this computer")}</Text><Text variant="meta" color="text/secondary">{connected ? t("Downloaded. It makes one picture at a time, for free.") : t("Download it under Local models below.")}</Text></View></Card>
      ) : <Card>
        <View style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Connection")}</Text>
          <Text variant="meta" color="text/secondary">{connected ? t("Stored on {host}, protected by file permissions", { host: host?.gatewayName ?? "" }) : provider.description}</Text>
          {connected ? <Text variant="meta" color="text/secondary" testID="generation-key-hint">{provider.keySource === "sign-in" ? t("Uses the key stored under Sign-in & keys") : t("API key")}{provider.secrets[0]?.last4 ? ` ····${provider.secrets[0].last4}` : ""}</Text> : null}
          {provider.healthReason && connected ? <Callout tone="warning">{t(provider.healthReason)}</Callout> : null}
          {admin ? (
            <>
              <FormField label={connected ? t("Enter a new key to replace") : t("API key")}>
                <Input accessibilityLabel={t("API key")} testID="generation-key" secureTextEntry autoCapitalize="none" autoCorrect={false} value={key} onChangeText={(value) => { setKey(value.slice(0, 512)); setProblem(null); }} />
              </FormField>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                {connected ? <Button size="sm" label={t("Replace key")} disabled={!key.trim()} loading={busy === "connect"} onPress={() => void connectWithKey(true)} /> : <Button kind="primary" size="sm" label={t("Connect")} testID="generation-connect" loading={busy === "connect"} onPress={() => void connectWithKey(false)} />}
                {!connected && provider.signInKeyAvailable ? <Button size="sm" label={t("Use the key from Sign-in & keys")} testID="generation-connect-existing" loading={busy === "existing"} onPress={() => void act("existing", () => call("jagentchill.provider.connect", { providerId: provider.id, secretNames: [] }), t("Connected"))} /> : null}
                {connected ? <Button size="sm" label={t("Test connection")} testID="generation-test" loading={busy === "test"} onPress={() => void act("test", async () => { const outcome = await call<{ outcome: string; message: string }>("jagentchill.provider.test", { providerId: provider.id }); toast.show({ kind: outcome.outcome === "ok" ? "success" : "warning", message: t(outcome.message) }); })} /> : null}
                {connected ? <Button size="sm" kind="ghost" tone="danger" label={t("Disconnect")} testID="generation-disconnect" onPress={() => setAsking(true)} /> : null}
              </View>
            </>
          ) : null}
          {problem ? <Callout tone="danger"><View testID="generation-problem"><Text>{problem.text}</Text>{problem.detail ? <Text variant="meta" color="text/secondary">{problem.detail}</Text> : null}</View></Callout> : null}
        </View>
      </Card>}
      {/* What is sent where is told ONCE, here — where the provider is connected — and never asked per action. */}
      {provider.sendingNote ? (
        <Card>
          <View testID="generation-sends" {...({ dataSet: { connected: connected ? "1" : "0", on: provider.enabled ? "1" : "0" } } as object)} style={{ gap: space[2] }}>
            <Text variant="body-medium">{t("What is sent to {provider}", { provider: provider.label })}</Text>
            <Text variant="meta" color="text/secondary" testID="generation-sending-note">{t(provider.sendingNote)}</Text>
            {/* A provider that is turned off is sent nothing. */}
            {connected && provider.enabled ? (provider.sends ?? []).map((line) => <Text key={line} variant="meta" color="text/secondary" testID="generation-sends-line">{`•  ${t(line)}`}</Text>) : null}
          </View>
        </Card>
      ) : null}
      {connected && !local ? (
        <Card>
          <View style={{ gap: space[2] }}>
            <Text variant="body-medium">{t("Jobs at once")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
              {provider.capabilities.map((capability) => <LimitField key={capability} label={t(CAPABILITY_LABEL[capability])} value={provider.limits.maxConcurrent[capability] ?? 1} disabled={!admin} onSave={(value) => act("limits", () => call("jagentchill.provider.update", { providerId: provider.id, limits: { maxConcurrent: { [capability]: value } } }))} />)}
            </View>
          </View>
        </Card>
      ) : null}
      {connected ? groups.map((group) => (
        <Card key={group.capability} padding={0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], paddingHorizontal: space[3], backgroundColor: theme.color("bg/sidebar") }}>
            <Text variant="body-medium" style={{ flex: 1 }}>{t(CAPABILITY_LABEL[group.capability])}</Text>
            {admin ? <><Button size="xs" kind="ghost" label={t("Enable all")} onPress={() => void act("bulk", () => call("jagentchill.provider.model.setEnabled", { providerId: provider.id, capability: group.capability, enabled: true }))} /><Button size="xs" kind="ghost" label={t("Disable all")} onPress={() => void act("bulk", () => call("jagentchill.provider.model.setEnabled", { providerId: provider.id, capability: group.capability, enabled: false }))} /></> : null}
          </View>
          {group.list.map((model) => (
            <View key={model.id} testID={`generation-model-${model.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 40, paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Text numberOfLines={1} style={{ flexShrink: 1 }}>{model.label}</Text>{model.source === "fetched" ? <Badge kind="new" label={t("New")} /> : null}{model.deprecated ? <Badge label={t("Deprecated")} /> : null}{model.customPrice ? <Badge label={t("Custom price")} /> : null}</View>
                <Text variant="meta" color="text/secondary" numberOfLines={1}>{model.id}</Text>
              </View>
              <Text variant="meta" color="text/secondary">{priceText(t, model.pricing)}</Text>
              <Switch accessibilityLabel={t("Use {model}", { model: model.label })} value={model.enabled} disabled={!admin} onChange={(enabled) => call("jagentchill.provider.model.upsert", { providerId: provider.id, model: { id: model.id, capability: model.capability, enabled } }).then(load)} />
            </View>
          ))}
        </Card>
      )) : null}
      {connected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          {admin && !local ? <Button size="sm" icon="refresh" label={t("Refresh models")} loading={busy === "refresh"} onPress={() => void act("refresh", () => call("jagentchill.provider.model.refresh", { providerId: provider.id }), t("Model list refreshed"))} /> : null}
          {models[0]?.pricesAsOf ? <Text variant="meta" color="text/secondary">{t("Prices as of {date}", { date: models[0].pricesAsOf })}</Text> : null}
          {provider.modelsAge_ms ? <Text variant="meta" color="warning/text">{t("Model list is {n} days old", { n: Math.max(1, Math.round(provider.modelsAge_ms / 86_400_000)) })}</Text> : null}
        </View>
      ) : null}
      <ConfirmDialog open={asking} title={t("Disconnect {provider}?", { provider: provider.label })} description={t("Queued generation jobs are cancelled and the key is removed from this host. Usage records are kept.")} confirmLabel={t("Disconnect")} onClose={() => setAsking(false)}
        onConfirm={() => { setAsking(false); void act("disconnect", () => call("jagentchill.provider.disconnect", { providerId: provider.id })); }} />
    </View>
  );
}

function LimitField(props: { label: string; value: number; disabled: boolean; onSave(value: number): unknown }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => { const value = Math.round(Number(text)); if (Number.isFinite(value) && value >= 1 && value <= 64 && value !== props.value) void props.onSave(value); else setText(String(props.value)); };
  return <View style={{ width: 110 }}><FormField label={props.label}><Input accessibilityLabel={props.label} size="sm" keyboardType="number-pad" editable={!props.disabled} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} /></FormField></View>;
}

/** The second section: the amounts of the one set of spending thresholds, the budgets, and the result cache. */
function BudgetsAndApprovals(props: { admin: boolean; call: Call }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { admin, call } = props;
  const [thresholds, setThresholds] = useState<GenerationThresholds | null>(null);
  const [budgets, setBudgets] = useState<BudgetState[]>([]);
  const [cache, setCache] = useState<{ bytes: number; entries: number } | null>(null);
  const [limit, setLimit] = useState("");
  const load = useCallback(async () => {
    setThresholds((await call<{ thresholds: GenerationThresholds }>("jagentchill.provider.threshold.get", {})).thresholds);
    setBudgets((await call<{ budgets: BudgetState[] }>("jagentchill.provider.budget.list", {})).budgets);
    setCache(await call<{ bytes: number; entries: number }>("jagentchill.provider.cache.get", {}));
  }, [call]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const fail = (error: unknown) => toast.show({ kind: "error", message: message(error, t("The request failed")) });
  const amount = (label: string, field: keyof GenerationThresholds, description: string, max: number) => thresholds ? (
    <AmountRow key={field} label={label} description={description} value={thresholds[field]} max={max} disabled={!admin} testID={`threshold-${field}`}
      onSave={(value) => call<{ thresholds: GenerationThresholds }>("jagentchill.provider.threshold.set", { patch: { [field]: value } }).then((result) => setThresholds(result.thresholds)).catch(fail)} />
  ) : null;
  const global = budgets.find((budget) => budget.scope === "global");
  return (
    <View testID="generation-budgets" style={{ gap: space[2], marginTop: space[3] }}>
      <Text variant="body-medium" level={2}>{t("Budgets and approvals")}</Text>
      <Card padding={0}>
        {amount(t("Ask before spending more than"), "confirmAboveUsd", t("A paid action you start — a film, pictures, captions, speech — shows its cost and asks first when it costs more than this. At 0 it asks before every paid action."), 100)}
        {amount(t("Agent approval per message"), "perCallApprovalUsd", t("In Edit mode an agent asks before generation that costs more than this in one message."), 100)}
        {amount(t("Auto mode session budget"), "autoSessionBudgetUsd", t("In Auto mode an agent spends up to this amount in a session before it asks."), 1000)}
        <View style={{ padding: space[3], gap: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          <Text>{t("Monthly budget for everything")}</Text>
          <Text variant="meta" color="text/secondary" testID="budget-global">{global ? t("{spent} of {limit} used this month. Requests stop at the limit.", { spent: usd(global.spentUsd), limit: usd(global.limitUsd) }) : t("No budget is set. Generation and agent turns are not limited.")}</Text>
          {admin ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <View style={{ width: 120 }}><Input accessibilityLabel={t("Monthly budget in USD")} testID="budget-limit" size="sm" keyboardType="decimal-pad" placeholder="10.00" prefix="$" value={limit} onChangeText={setLimit} /></View>
              <Button size="sm" label={t("Set budget")} testID="budget-set" disabled={!(Number(limit) >= 0.01 && Number(limit) <= 100_000)} onPress={() => void call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: Number(limit), period: "month", hardStop: true } }).then(() => { setLimit(""); return load(); }).catch(fail)} />
              {global ? <Button size="sm" kind="ghost" tone="danger" label={t("Remove budget")} testID="budget-remove" onPress={() => void call("jagentchill.provider.budget.remove", { scope: "global" }).then(load).catch(fail)} /> : null}
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          <View style={{ flex: 1 }}><Text>{t("Generation cache")}</Text><Text variant="meta" color="text/secondary" testID="generation-cache">{cache ? t("{n} results, {size} MB", { n: cache.entries, size: (cache.bytes / 1_048_576).toFixed(1) }) : ""}</Text></View>
          {admin ? <Button size="sm" label={t("Clear generation cache")} disabled={!cache?.entries} onPress={() => void call("jagentchill.provider.cache.clear", {}).then(load).catch(fail)} /> : null}
        </View>
      </Card>
    </View>
  );
}

function AmountRow(props: { label: string; description: string; value: number; max: number; disabled: boolean; testID: string; onSave(value: number): unknown }) {
  const theme = useTheme();
  const [text, setText] = useState(props.value.toFixed(2));
  useEffect(() => setText(props.value.toFixed(2)), [props.value]);
  const commit = () => { const value = Number(text); if (Number.isFinite(value) && value >= 0 && value <= props.max && value !== props.value) void props.onSave(value); else setText(props.value.toFixed(2)); };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[3], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      <View style={{ flex: 1 }}><Text>{props.label}</Text><Text variant="meta" color="text/secondary">{props.description}</Text></View>
      <View style={{ width: 110 }}><Input accessibilityLabel={props.label} testID={props.testID} size="sm" keyboardType="decimal-pad" prefix="$" editable={!props.disabled} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} /></View>
    </View>
  );
}
