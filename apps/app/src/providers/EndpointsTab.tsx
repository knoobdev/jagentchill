import { useEffect, useState } from "react";
import { View } from "react-native";
import { slugOf } from "@jagentchill/app-core";
import { ENDPOINT_DIALECTS, type EndpointDialect, type EndpointPreset, type EndpointTestStep } from "@jagentchill/protocol";
import { Button, Callout, Card, Chip, DestructiveConfirmDialog, FormField, Icon, IconButton, Input, Select, SideSheet, StatusPill, Switch, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useAgentData, type EndpointView } from "../agents/data";
import { reasonOf } from "../agents/errors";
import { useHost } from "../host";
import { useT } from "../locale";
import { saveBlob } from "../platform/media";
import { pickFiles } from "../platform/store";

const DIALECT_LABEL: Record<EndpointDialect, string> = { "openai-completions": "OpenAI-compatible (Chat Completions)", "openai-responses": "OpenAI-compatible (Responses)", "anthropic-messages": "Anthropic-compatible (Messages)", "google-generative-ai": "Google Generative AI", ollama: "Ollama" };
type Draft = { id: string; idTouched: boolean; label: string; presetId: string; baseUrl: string; dialect: EndpointDialect; authMode: "none" | "bearer" | "header"; headerName: string; key: string; allowPrivateNetwork: boolean; models: string };
const emptyDraft = (): Draft => ({ id: "", idTouched: false, label: "", presetId: "custom", baseUrl: "", dialect: "openai-completions", authMode: "bearer", headerName: "x-api-key", key: "", allowPrivateNetwork: false, models: "" });
/** The stored record without what the host adds for display: the shape `endpoint.upsert` accepts. */
const draftOf = (endpoint: EndpointView) => { const { created_ms: _c, updated_ms: _u, lastTest: _t, lastDiscovery_ms: _d, projected: _p, keyHint: _k, rowNotes: _n, ...draft } = endpoint; return draft; };
const isPrivate = (url: string) => /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(url);

function Steps(props: { steps: EndpointTestStep[]; summary?: string }) {
  const t = useT();
  return (
    <View testID="endpoint-test-steps" style={{ gap: space[1] }}>
      {props.steps.map((step) => (
        <View key={step.id} style={{ flexDirection: "row", gap: space[2] }}>
          <Icon name={step.status === "pass" ? "check-c" : step.status === "fail" ? "x-c" : "minus"} size={14} color={step.status === "pass" ? "success" : step.status === "fail" ? "danger" : "text/tertiary"} label={t(step.status === "pass" ? "Passed" : step.status === "fail" ? "Failed" : "Skipped")} />
          <Text variant="meta" style={{ width: 120 }}>{step.id}</Text>
          <Text variant="meta" color={step.status === "fail" ? "danger/text" : "text/secondary"} style={{ flex: 1 }}>{step.detail}{step.latency_ms !== undefined ? ` · ${step.latency_ms} ms` : ""}</Text>
        </View>
      ))}
      {props.summary ? <Text variant="meta" color="text/secondary">{props.summary}</Text> : null}
    </View>
  );
}

/**
 * Custom endpoints and proxies: any address that speaks an OpenAI-compatible or Anthropic-compatible API — a router
 * such as OpenRouter or a self-hosted one, a local server — added with its own key, its models discovered, and tested.
 */
export function EndpointsTab() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection, can, secrets, status } = useHost();
  const data = useAgentData();
  const admin = can("jagentchill.config.write") && can("jagentchill.secrets.manage");
  const [presets, setPresets] = useState<EndpointPreset[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { steps: EndpointTestStep[]; summary?: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EndpointView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (connection) void connection.call<{ presets: EndpointPreset[] }>("jagentchill.provider.preset.list", { kind: "custom-endpoint" }).then((result) => setPresets(result.presets)).catch(() => undefined); }, [connection]);
  if (status !== "connected") return <Callout tone="info">{t("Connect to this host to see its endpoints")}</Callout>;
  const call = async <T,>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    setBusy(what);
    try { return await run(); } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); return undefined; } finally { setBusy(null); }
  };
  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const built = (value: Draft) => {
    const preset = presets.find((entry) => entry.presetId === value.presetId);
    const secretName = `${value.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY`;
    return {
      secretName,
      endpoint: {
        id: value.id, label: value.label.trim(), ...(preset ? { presetId: preset.presetId, presetVersion: preset.version } : {}), baseUrl: value.baseUrl.trim(), dialect: value.dialect,
        auth: value.authMode === "none" ? { mode: "none" as const } : { mode: value.authMode, secretName, ...(value.authMode === "header" ? { headerName: value.headerName.trim() } : {}) },
        allowPrivateNetwork: value.allowPrivateNetwork, capabilities: ["llm"],
        models: value.models.split(/[\s,]+/).filter(Boolean).map((id) => ({ id, label: id, enabled: true, source: "manual" as const })),
      },
    };
  };
  const draftProblems = (value: Draft): string | null =>
    !value.label.trim() ? t("Give the endpoint a name") : !/^[a-z][a-z0-9-]{1,39}$/.test(value.id) ? t("The ID is lower-case letters, digits and hyphens") : data.endpoints.some((entry) => entry.id === value.id) ? t("An endpoint with this ID exists")
      : !/^https?:\/\/\S+$/.test(value.baseUrl.trim()) ? t("Enter the base URL, starting with http:// or https://") : value.authMode !== "none" && value.key.trim().length < 8 ? t("Enter the key of this endpoint") : null;
  async function putKey(value: Draft, secretName: string) { if (value.authMode !== "none") await secrets!.put(secretName, value.key.trim()); }
  async function testDraft() {
    if (!draft) return;
    const { endpoint, secretName } = built(draft);
    await call("test-draft", async () => {
      await putKey(draft, secretName);
      const result = await connection!.call<{ steps: EndpointTestStep[]; summary?: string }>("jagentchill.provider.endpoint.test", { draft: endpoint });
      setTested((all) => ({ ...all, draft: result }));
    });
  }
  async function save() {
    if (!draft) return;
    const { endpoint, secretName } = built(draft);
    setProblem(null);
    const saved = await call("save", async () => {
      await putKey(draft, secretName);
      await connection!.call("jagentchill.provider.endpoint.upsert", { endpoint });
      // The address is asked for its models at once, so the endpoint appears in the model browser without another step.
      return connection!.call<{ ok: boolean; message?: string; models: unknown[] }>("jagentchill.provider.endpoint.discover", { endpointId: endpoint.id }).catch(() => ({ ok: false, message: undefined, models: [] }));
    });
    if (!saved) return;
    toast.show({ kind: saved.ok ? "success" : "warning", message: saved.ok ? t("{name} added — {n} models found", { name: endpoint.label, n: saved.models.length }) : saved.message ?? t("{name} added — add its models by ID", { name: endpoint.label }) });
    setDraft(null); setTested((all) => ({ ...all, draft: undefined as never })); setOpen(endpoint.id); data.reload();
  }
  const discover = (endpoint: EndpointView) => call(`discover-${endpoint.id}`, async () => {
    const result = await connection!.call<{ ok: boolean; message?: string; models: unknown[] }>("jagentchill.provider.endpoint.discover", { endpointId: endpoint.id });
    toast.show({ kind: result.ok ? "success" : "warning", message: result.ok ? (result.models.length === 1 ? t("1 model found") : t("{n} models found", { n: result.models.length })) : result.message ?? t("No models found") });
    data.reload();
  });
  const test = (endpoint: EndpointView) => call(`test-${endpoint.id}`, async () => { const result = await connection!.call<{ steps: EndpointTestStep[]; summary?: string }>("jagentchill.provider.endpoint.test", { endpointId: endpoint.id }); setTested((all) => ({ ...all, [endpoint.id]: result })); setOpen(endpoint.id); data.reload(); });
  const upsert = (endpoint: EndpointView, patch: Record<string, unknown>) => call(`save-${endpoint.id}`, async () => { await connection!.call("jagentchill.provider.endpoint.upsert", { endpoint: { ...draftOf(endpoint), ...patch } }); data.reload(); });
  const exportAll = () => call("export", async () => {
    const { document } = await connection!.call<{ document: unknown }>("jagentchill.provider.endpoint.export", {});
    saveBlob("jagentchill-endpoints.json", new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
    toast.show({ kind: "success", message: t("Endpoints exported — keys are named, never included") });
  });
  const importFile = async () => {
    const [file] = await pickFiles("application/json,.json", false);
    if (!file) return;
    await call("import", async () => {
      const document = JSON.parse(await file.text());
      const result = await connection!.call<{ imported: string[]; skipped: string[]; missingSecrets: string[] }>("jagentchill.provider.endpoint.import", { document, onConflict: "rename" });
      toast.show({ kind: result.missingSecrets.length ? "warning" : "success", message: result.missingSecrets.length ? t("{n} endpoints imported. Enter the keys: {names}", { n: result.imported.length, names: result.missingSecrets.join(", ") }) : t("{n} endpoints imported", { n: result.imported.length }) });
      data.reload();
    });
  };
  const sheetProblem = draft ? draftProblems(draft) : null;
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium" level={2} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180 }}>{t("Custom endpoints and proxies")}</Text>
        <Button size="sm" label={t("Import")} disabled={!admin || busy !== null} onPress={() => void importFile()} />
        <Button size="sm" label={t("Export")} disabled={!admin || data.endpoints.length === 0 || busy !== null} testID="endpoints-export" onPress={() => void exportAll()} />
        <Button size="sm" kind="primary" icon="plus" label={t("Add endpoint")} disabled={!admin} testID="add-endpoint" onPress={() => { setProblem(null); setTested((all) => ({ ...all, draft: undefined as never })); setDraft(emptyDraft()); }} />
      </View>
      <Text variant="meta" color="text/secondary">{t("Any address that speaks an OpenAI-compatible or Anthropic-compatible API: a router such as OpenRouter, a proxy you run, a local model server. Its models appear in the model browser under the name you give it.")}</Text>
      <Text variant="meta" color="text/secondary">{t("Agents run an endpoint through a CLI: choose it for OpenCode (any dialect), Codex (OpenAI Responses) or Claude Code (Anthropic Messages) under CLI runtimes ▸ Sign-in used.")}</Text>
      {!admin ? <Text variant="meta" color="text/secondary">{t("Admin devices can change these settings")}</Text> : null}
      {data.endpoints.length === 0 ? <Card><Text color="text/secondary">{t("No endpoint yet. Add one to use your own address and key.")}</Text></Card> : data.endpoints.map((endpoint) => {
        const result = tested[endpoint.id] ?? (endpoint.lastTest ? { steps: endpoint.lastTest.steps } : undefined);
        const failing = result?.steps.some((step) => step.status === "fail");
        const expanded = open === endpoint.id;
        return (
          <Card key={endpoint.id} padding={space[3]}>
            <View testID={`endpoint-${endpoint.id}`} style={{ gap: space[2] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <IconButton icon={expanded ? "chev-d" : "chev-r"} size="xs" label={expanded ? t("Collapse {name}", { name: endpoint.label }) : t("Expand {name}", { name: endpoint.label })} expanded={expanded} onPress={() => setOpen(expanded ? null : endpoint.id)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body-medium" numberOfLines={1}>{endpoint.label}</Text>
                  <Text variant="meta" color="text/secondary" numberOfLines={1}>{[endpoint.baseUrl, t(DIALECT_LABEL[endpoint.dialect]), endpoint.keyHint ? `••••${endpoint.keyHint}` : null].filter(Boolean).join(" · ")}</Text>
                </View>
                <Chip size="sm" label={endpoint.models.length === 1 ? t("1 model") : t("{n} models", { n: endpoint.models.length })} />
                <StatusPill label={t(!endpoint.enabled ? "Turned off" : failing ? "Test failed" : result ? "Test passed" : endpoint.projected ? "Ready" : "Not ready")} tone={!endpoint.enabled ? "neutral" : failing ? "danger" : result || endpoint.projected ? "success" : "warning"} />
                <Switch value={endpoint.enabled} disabled={!admin} accessibilityLabel={t("Enable {name}", { name: endpoint.label })} onChange={(value) => void upsert(endpoint, { enabled: value })} />
              </View>
              {endpoint.rowNotes.map((note) => <Text key={note} variant="meta" color="warning/text">{note}</Text>)}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                <Button size="xs" label={t("Discover models")} loading={busy === `discover-${endpoint.id}`} disabled={!admin || busy !== null} testID={`discover-${endpoint.id}`} onPress={() => void discover(endpoint)} />
                <Button size="xs" label={t("Test connection")} loading={busy === `test-${endpoint.id}`} disabled={!admin || busy !== null} testID={`test-${endpoint.id}`} onPress={() => void test(endpoint)} />
                <Button size="xs" kind="ghost" label={t("Duplicate")} disabled={!admin || busy !== null} onPress={() => void call("duplicate", async () => { await connection!.call("jagentchill.provider.endpoint.duplicate", { endpointId: endpoint.id }); data.reload(); })} />
                <View style={{ flex: 1 }} />
                <Button size="xs" kind="ghost" tone="danger" label={t("Remove")} disabled={!admin || busy !== null} onPress={() => setRemoving(endpoint)} />
              </View>
              {expanded ? (
                <View style={{ gap: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), paddingTop: space[2] }}>
                  {result ? <Steps steps={result.steps} summary={result.summary} /> : null}
                  {endpoint.models.map((model) => (
                    <View key={model.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
                      <Text variant="mono" numberOfLines={1} style={{ flex: 1 }}>{model.id}</Text>
                      <Text variant="meta" color="text/secondary">{t(model.source === "manual" ? "Added by ID" : model.noLongerListed ? "No longer listed" : "Discovered")}</Text>
                      <Switch value={model.enabled} disabled={!admin} accessibilityLabel={t("Enable {name}", { name: model.id })} onChange={(value) => void upsert(endpoint, { models: endpoint.models.map((entry) => (entry.id === model.id ? { ...entry, enabled: value } : entry)) })} />
                    </View>
                  ))}
                  {endpoint.models.length === 0 ? <Text variant="meta" color="text/secondary">{t("No models yet — discover them or add them by ID.")}</Text> : null}
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
      <DestructiveConfirmDialog open={removing !== null} title={t("Remove endpoint?")} description={removing ? t("“{name}” leaves the model browser. Its key stays in Secrets until you delete it there.", { name: removing.label }) : undefined} confirmLabel={t("Remove endpoint")}
        onClose={() => setRemoving(null)} onConfirm={() => { const target = removing!; setRemoving(null); void call("remove", async () => { await connection!.call("jagentchill.provider.endpoint.remove", { endpointId: target.id }); toast.show({ kind: "success", message: t("{name} removed", { name: target.label }) }); data.reload(); }); }} />
      {draft ? (
        <SideSheet open onClose={() => setDraft(null)} title={t("Add endpoint")} dirty={draft.label.length > 0 || draft.baseUrl.length > 0}
          footer={<><Button label={t("Test connection")} loading={busy === "test-draft"} disabled={!!sheetProblem || busy !== null} onPress={() => void testDraft()} /><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={() => setDraft(null)} /><Button kind="primary" label={t("Save")} loading={busy === "save"} disabled={busy !== null} testID="endpoint-save" onPress={() => (sheetProblem ? setProblem(sheetProblem) : void save())} /></>}>
          <FormField label={t("Template")}>{() => <Select label={t("Template")} value={draft.presetId} onChange={(value) => { const preset = presets.find((entry) => entry.presetId === value); set({ presetId: value, ...(preset ? { dialect: preset.dialect, authMode: preset.auth.mode, baseUrl: draft.baseUrl || (preset.baseUrlTemplate.includes("{") ? "" : preset.baseUrlTemplate) } : {}) }); }}
            options={[{ value: "custom", label: t("Custom") }, ...presets.map((preset) => ({ value: preset.presetId, label: preset.label, description: preset.description }))]} />}</FormField>
          <FormField label={t("Name")} description={t("Shown in the model browser as it is written here.")}>{(ids) => <Input value={draft.label} maxLength={40} labelledBy={ids.labelledBy} onChangeText={(value) => set({ label: value, ...(draft.idTouched ? {} : { id: slugOf(value) }) })} />}</FormField>
          <FormField label={t("ID")}>{(ids) => <Input value={draft.id} mono autoCapitalize="none" maxLength={40} labelledBy={ids.labelledBy} onChangeText={(value) => set({ id: value, idTouched: true })} />}</FormField>
          <FormField label={t("Base URL")}>{(ids) => <Input value={draft.baseUrl} mono autoCapitalize="none" autoCorrect={false} placeholder="https://api.example.com/v1" labelledBy={ids.labelledBy} onChangeText={(value) => set({ baseUrl: value, ...(isPrivate(value) ? { allowPrivateNetwork: true } : {}) })} />}</FormField>
          <FormField label={t("API dialect")}>{() => <Select label={t("API dialect")} value={draft.dialect} onChange={(value) => set({ dialect: value })} options={ENDPOINT_DIALECTS.map((dialect) => ({ value: dialect, label: t(DIALECT_LABEL[dialect]) }))} />}</FormField>
          <FormField label={t("Authentication")}>{() => <Select label={t("Authentication")} value={draft.authMode} onChange={(value) => set({ authMode: value })} options={[{ value: "bearer", label: t("Bearer key") }, { value: "header", label: t("Key in a header") }, { value: "none", label: t("None") }]} />}</FormField>
          {draft.authMode === "header" ? <FormField label={t("Header name")}>{(ids) => <Input value={draft.headerName} mono autoCapitalize="none" labelledBy={ids.labelledBy} onChangeText={(value) => set({ headerName: value })} />}</FormField> : null}
          {draft.authMode !== "none" ? <FormField label={t("API key")} description={t("8–512 characters. Stored on the host; other devices only see the last four characters.")}>{(ids) => <Input value={draft.key} secureTextEntry mono autoCapitalize="none" autoCorrect={false} labelledBy={ids.labelledBy} describedBy={ids.describedBy} onChangeText={(value) => set({ key: value })} />}</FormField> : null}
          <FormField label={t("Model IDs")} description={t("Optional. Leave empty to ask the endpoint for its model list.")}>{(ids) => <Input value={draft.models} mono autoCapitalize="none" placeholder="model-a, model-b" labelledBy={ids.labelledBy} describedBy={ids.describedBy} onChangeText={(value) => set({ models: value })} />}</FormField>
          <Switch value={draft.allowPrivateNetwork} onChange={(value) => set({ allowPrivateNetwork: value })} label={t("Allow an address on this computer or the local network")} />
          {problem ? <Text color="danger/text" role="alert">{problem}</Text> : null}
          {tested.draft ? <Steps steps={tested.draft.steps} summary={tested.draft.summary} /> : null}
        </SideSheet>
      ) : null}
    </>
  );
}
