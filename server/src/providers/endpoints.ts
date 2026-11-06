import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  RUNTIME_LIMITS, RUNTIME_METHOD_SCOPES, endpointDiscoverParams, endpointDuplicateParams, endpointExportParams, endpointIdParams, endpointImportParams,
  endpointTestParams, endpointUpsertParams, presetListParams, presetRemoveParams, presetUpsertParams, type EndpointDraft, type EndpointModel,
  type EndpointPreset, type EndpointRecord, type EndpointTestStep, type Scope,
} from "@jagentchill/protocol";
import type { RateLimiter } from "../channel/rate-limit.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { SecretStore } from "../secrets/store.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import { RESERVED_PROVIDER_IDS, SHIPPED_PRESETS } from "./catalogue.ts";
import { EndpointClient, modelListPath, parseModelList } from "./endpoint-client.ts";

const DEFAULT_ENABLED_MODELS = 50;
type Stored = { records: Record<string, EndpointRecord>; presets: Record<string, EndpointPreset> };

export type EndpointServiceDeps = {
  db: DatabaseSync;
  config: ServerConfigFile;
  secrets: SecretStore;
  now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown) => void;
  mutations: RateLimiter;
  /** Called after a record changed, so the runtimes that read endpoints see the new records. */
  onChanged: () => Promise<void> | void;
  /** ORC profiles that name an endpoint id. */
  referencesTo: (endpointId: string) => string[];
};

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}

/** Custom endpoints: OpenAI-compatible and Anthropic-compatible proxies, relays, routers and self-hosted model servers. */
export function createEndpointService(deps: EndpointServiceDeps) {
  const client = new EndpointClient(deps.secrets);
  const load = (): Stored => deps.config.get<Stored>("endpoints") ?? { records: {}, presets: {} };
  const save = (stored: Stored) => deps.config.set("endpoints", stored);
  const find = (endpointId: string): EndpointRecord => {
    const record = load().records[endpointId];
    if (!record) throw new ProtocolError("NOT_FOUND", "No such endpoint.");
    return record;
  };

  /** Rules a record must pass before it is stored; nothing is written when one fails. */
  function check(draft: EndpointDraft, existing: Record<string, EndpointRecord>): void {
    if (RESERVED_PROVIDER_IDS.has(draft.id)) {
      let n = 2;
      while (RESERVED_PROVIDER_IDS.has(`${draft.id}-${n}`) || existing[`${draft.id}-${n}`]) n += 1;
      throw new ProtocolError("ALREADY_EXISTS", "This id belongs to a built-in provider.", { details: { suggestion: `${draft.id}-${n}` } });
    }
    if (!existing[draft.id] && Object.keys(existing).length >= RUNTIME_LIMITS.endpoints) {
      throw new ProtocolError("QUOTA_EXCEEDED", "You can have up to 40 endpoints", { details: { limit: "endpoints", max: RUNTIME_LIMITS.endpoints } });
    }
    if (draft.auth.mode !== "none" && !draft.auth.secretName) throw new ProtocolError("INVALID_PARAMS", "This endpoint needs a key stored as a secret.", { details: { path: "auth.secretName" } });
    if (draft.auth.mode === "header" && !draft.auth.headerName) throw new ProtocolError("INVALID_PARAMS", "Name the header that carries the key.", { details: { path: "auth.headerName" } });
    if (draft.dialect === "ollama" && /\/v1\/?$/.test(new URL(draft.baseUrl).pathname)) {
      throw new ProtocolError("INVALID_PARAMS", "Use the native URL without /v1 — tool calling breaks on /v1", { details: { path: "baseUrl", suggestion: draft.baseUrl.replace(/\/v1\/?$/, "") } });
    }
    // An agent is given the base address as plain text, so a secret in the address could never reach agent chat safely.
    if (draft.capabilities.includes("llm") && Object.values(draft.query ?? {}).some((value) => typeof value !== "string")) {
      throw new ProtocolError("INVALID_PARAMS", "This endpoint needs its key in the address — agent chat cannot use it; put the key in a header", { details: { path: "query" } });
    }
    const aliases = draft.models.map((model) => model.alias).filter(Boolean);
    if (new Set(aliases).size !== aliases.length) throw new ProtocolError("INVALID_PARAMS", "Two models of one endpoint cannot share an alias.", { details: { path: "models" } });
    if (new Set(draft.models.map((model) => model.id)).size !== draft.models.length) throw new ProtocolError("INVALID_PARAMS", "A model id is listed twice.", { details: { path: "models" } });
  }

  /** What a device sees of a record: the record itself, which holds secret names and never values, with what its row shows. */
  function view(record: EndpointRecord) {
    const enabledModels = record.models.filter((model) => model.enabled);
    const notes: string[] = [];
    if (record.capabilities.includes("llm") && enabledModels.length === 0) notes.push("Add at least one model");
    if (enabledModels.length > 0 && enabledModels.every((model) => !model.supportsTools)) notes.push("No tools — chat only");
    const missing = [record.auth.secretName, ...Object.values(record.headers ?? {}).map((value) => (typeof value === "string" ? undefined : value.secret))].filter((name): name is string => !!name && !deps.secrets.has(name));
    if (missing.length) notes.push(`Missing secret: ${missing.join(", ")}`);
    return { ...record, projected: isUsable(record), keyHint: record.auth.secretName ? deps.secrets.hint(record.auth.secretName) : undefined, rowNotes: notes };
  }

  /**
   * Whether agent chat can use the record: turned on, a chat model enabled and its key present. Shown to devices as
   * `projected` (the field kept its name from when records were written into the agent engine's configuration).
   */
  function isUsable(record: EndpointRecord): boolean {
    return record.enabled && record.capabilities.includes("llm") && record.models.some((model) => model.enabled)
      && (record.auth.mode === "none" || (!!record.auth.secretName && deps.secrets.has(record.auth.secretName)));
  }

  async function changed(connection: Connection, action: string, endpointId: string): Promise<void> {
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, action, { endpointId });
    await deps.onChanged();
    deps.broadcast("jagentchill.config.read", "jagentchill.provider.changed", "provider", { endpointId });
  }

  async function upsert(draft: EndpointDraft, connection: Connection): Promise<EndpointRecord> {
    const stored = load();
    check(draft, stored.records);
    const previous = stored.records[draft.id];
    const record: EndpointRecord = { ...previous, ...draft, created_ms: previous?.created_ms ?? deps.now(), updated_ms: deps.now() };
    save({ ...stored, records: { ...stored.records, [draft.id]: record } });
    await changed(connection, previous ? "provider.endpoint.update" : "provider.endpoint.create", draft.id);
    return record;
  }

  const resolveTarget = (target: { endpointId: string } | { draft: EndpointDraft }): EndpointDraft => ("draft" in target ? target.draft : find(target.endpointId));

  /** Calls the model-list route from the host with the endpoint's own auth. */
  async function discover(raw: unknown, connection: Connection) {
    const params = parse(endpointDiscoverParams, raw);
    const endpoint = resolveTarget(params);
    const preset = allPresets().find((candidate) => candidate.presetId === endpoint.presetId);
    const response = await client.send(endpoint, modelListPath(endpoint, preset?.modelListPath), { method: "GET", timeoutMs: Math.min(endpoint.timeoutSeconds * 1000, 30_000) });
    if (response.status === 404 || response.status === 405) return { ok: false as const, reason: "no-model-list", message: "This endpoint has no model list — add models by ID", models: endpoint.models };
    if (response.status === 401 || response.status === 403) return { ok: false as const, reason: "auth", message: "The endpoint rejected the key for its model list", models: endpoint.models };
    const found = response.status >= 200 && response.status < 300 ? parseModelList(response.body) : undefined;
    if (!found) return { ok: false as const, reason: "unparseable", message: `The model list could not be read (HTTP ${response.status})`, models: endpoint.models };
    const listed = new Set(found.map((model) => model.id));
    const known = new Map(endpoint.models.map((model) => [model.id, model]));
    const merged: EndpointModel[] = [];
    const fresh = found.filter((model) => !known.has(model.id)).sort((a, b) => a.label.localeCompare(b.label));
    // Models enabled by default: the first fifty by name, or all when fewer.
    let room = Math.max(0, DEFAULT_ENABLED_MODELS - endpoint.models.filter((model) => model.enabled).length);
    for (const model of endpoint.models) {
      const now = found.find((candidate) => candidate.id === model.id);
      // Discovery never overwrites a field the admin edited, and a model that disappeared upstream is kept and flagged.
      const refreshed = now && model.source === "discovered" ? {
        ...(now.contextWindow && !model.editedFields.includes("contextWindow") ? { contextWindow: now.contextWindow } : {}),
        ...(now.input && !model.editedFields.includes("input") ? { input: now.input } : {}),
      } : {};
      const { noLongerListed: _flag, ...rest } = model;
      merged.push({ ...rest, ...refreshed, ...(model.source === "discovered" && !listed.has(model.id) ? { noLongerListed: true } : {}) });
    }
    for (const model of fresh) {
      if (merged.length >= RUNTIME_LIMITS.endpointModels) break;
      merged.push({
        id: model.id, label: model.label, enabled: room-- > 0, input: model.input ?? ["text"], supportsTools: model.supportsTools ?? true, reasoning: false, usageInStreaming: true,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), source: "discovered", editedFields: [],
      });
    }
    if ("endpointId" in params) {
      const stored = load();
      const record: EndpointRecord = { ...stored.records[params.endpointId], models: merged, lastDiscovery_ms: deps.now(), updated_ms: deps.now() };
      save({ ...stored, records: { ...stored.records, [params.endpointId]: record } });
      await changed(connection, "provider.endpoint.discover", params.endpointId);
    }
    return { ok: true as const, models: merged, found: found.length };
  }

  /** Real requests from the host, one step after another; a failing step does not stop the independent ones. */
  async function test(raw: unknown, connection: Connection) {
    const params = parse(endpointTestParams, raw);
    const endpoint = resolveTarget(params);
    const saved = "endpointId" in params;
    const steps: EndpointTestStep[] = [];
    const step = async (id: string, run: () => Promise<Omit<EndpointTestStep, "id">>) => {
      try {
        steps.push({ id, ...(await run()) });
      } catch (err) {
        steps.push({ id, status: "fail", detail: err instanceof ProtocolError ? err.message : "Unexpected failure", ...(err instanceof ProtocolError ? { code: err.code } : {}) });
      }
    };
    const skip = (id: string, detail: string) => steps.push({ id, status: "skipped", detail });
    const modelId = params.modelId ?? endpoint.models.find((model) => model.enabled)?.id ?? endpoint.models[0]?.id;

    await step("resolve", async () => {
      const resolved = await client.resolve(endpoint);
      return { status: "pass", detail: `${new URL(endpoint.baseUrl).hostname} is a ${resolved.addressClass} address` };
    });
    let listing: Awaited<ReturnType<EndpointClient["send"]>> | undefined;
    await step("connect", async () => {
      listing = await client.send(endpoint, modelListPath(endpoint), { method: "GET", timeoutMs: 15_000 });
      const tls = listing.tls;
      return { status: "pass", latency_ms: listing.firstByte_ms, detail: tls ? `TLS: ${tls.subject} issued by ${tls.issuer}; ${tls.authorized ? "chain validated" : tls.selfSigned ? "accepted as self-signed" : "not validated"}` : "Connected without TLS" };
    });
    if (!listing) skip("auth-and-models", "The endpoint could not be reached");
    else await step("auth-and-models", async () => {
      const response = listing!;
      if (response.status === 401 || response.status === 403) return { status: "fail", detail: "The endpoint rejected the key", code: "runtime/auth-failed" };
      if (response.status === 404 || response.status === 405) return { status: "skipped", detail: "This endpoint has no model list" };
      const found = parseModelList(response.body);
      return found ? { status: "pass", latency_ms: response.total_ms, detail: `${found.length} models listed` } : { status: "fail", detail: `The model list could not be read (HTTP ${response.status})` };
    });

    if (!modelId) {
      for (const id of ["completion", "streaming", "usage"]) skip(id, "Add a model to test a completion");
    } else if (endpoint.dialect === "openai-completions" || endpoint.dialect === "anthropic-messages") {
      // The minimal completion uses the server's own client, so the report can say whether tokens streamed and usage came back.
      const openai = endpoint.dialect === "openai-completions";
      let completion: Awaited<ReturnType<EndpointClient["send"]>> | undefined;
      await step("completion", async () => {
        const body = openai
          ? { model: modelId, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 16, stream: true, stream_options: { include_usage: true } }
          : { model: modelId, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 16, stream: true };
        completion = await client.send(endpoint, openai ? "/chat/completions" : /\/v1\/?$/.test(endpoint.baseUrl) ? "/messages" : "/v1/messages", { method: "POST", body, timeoutMs: 45_000 });
        if (completion.status >= 200 && completion.status < 300) return { status: "pass", latency_ms: completion.total_ms, detail: `First token after ${completion.firstByte_ms} ms, done after ${completion.total_ms} ms` };
        const looksAnthropic = /"type"\s*:\s*"error"/.test(completion.body) && /"(?:not_found_error|invalid_request_error|authentication_error)"/.test(completion.body);
        if (openai && looksAnthropic) return { status: "fail", code: "runtime/dialect-mismatch", detail: "This endpoint answered like an Anthropic-compatible API — change the dialect" };
        if (completion.status === 401 || completion.status === 403) return { status: "fail", code: "runtime/auth-failed", detail: "The endpoint rejected the key" };
        if (completion.status === 404) return { status: "fail", code: openai ? "runtime/dialect-mismatch" : "runtime/model-unavailable", detail: openai ? "This endpoint has no chat completions route — check the address and the dialect" : "The endpoint does not know this model" };
        return { status: "fail", detail: `The endpoint answered HTTP ${completion.status}` };
      });
      const ok = completion && completion.status >= 200 && completion.status < 300;
      if (!ok) {
        skip("streaming", "The completion did not succeed");
        skip("usage", "The completion did not succeed");
      } else {
        const events = completion!.body.split("\n").filter((line) => line.startsWith("data:")).length;
        steps.push({ id: "streaming", status: events > 1 ? "pass" : "fail", detail: events > 1 ? `${events} stream events arrived` : "The answer arrived in one piece" });
        const usage = /"usage"\s*:\s*\{/.test(completion!.body);
        steps.push({ id: "usage", status: usage ? "pass" : "fail", detail: usage ? "Token usage was returned" : "No token usage was returned — turn off usage in streaming for this model" });
      }
    } else {
      // The server sends a minimal completion itself only in the two dialects above.
      for (const id of ["completion", "streaming", "usage"]) skip(id, "A completion in this dialect is not tested by the server");
    }
    // A tool call and a vision request are not sent by the server's own client.
    skip("tool-call", "Not tested by the server");
    if (endpoint.models.find((model) => model.id === modelId)?.input.includes("image")) skip("vision", "Not tested by the server");

    const failed = steps.filter((entry) => entry.status === "fail");
    const summary = failed.length ? `${failed.length} of ${steps.length} checks failed` : "The endpoint answered every check that ran";
    if (saved) {
      const stored = load();
      save({ ...stored, records: { ...stored.records, [endpoint.id]: { ...stored.records[endpoint.id], lastTest: { at_ms: deps.now(), steps } } } });
      audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.endpoint.test", { endpointId: endpoint.id, failed: failed.map((entry) => entry.id) });
    }
    return { steps, summary };
  }

  const allPresets = (): EndpointPreset[] => [...SHIPPED_PRESETS, ...Object.values(load().presets)];

  const methods = new Map<string, RpcMethod>();
  const add = (name: string, mutating: boolean, handle: RpcMethod["handle"]) => methods.set(name, {
    scope: RUNTIME_METHOD_SCOPES[name],
    handle: (raw, connection) => {
      if (mutating) deps.mutations.hit(connection.deviceId);
      return handle(raw, connection);
    },
  });

  add("jagentchill.provider.endpoint.list", false, () => ({ endpoints: Object.values(load().records).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map(view) }));
  add("jagentchill.provider.endpoint.get", false, (raw) => ({ endpoint: view(find(parse(endpointIdParams, raw).endpointId)) }));
  add("jagentchill.provider.endpoint.upsert", true, async (raw, connection) => ({ endpoint: view(await upsert(parse(endpointUpsertParams, raw).endpoint, connection)) }));
  add("jagentchill.provider.endpoint.remove", true, async (raw, connection) => {
    const { endpointId } = parse(endpointIdParams, raw);
    const stored = load();
    if (!stored.records[endpointId]) throw new ProtocolError("NOT_FOUND", "No such endpoint.");
    const references = deps.referencesTo(endpointId);
    if (references.length) throw new ProtocolError("CONFLICT", "This endpoint is still used.", { details: { references } });
    const { [endpointId]: _removed, ...records } = stored.records;
    save({ ...stored, records });
    await changed(connection, "provider.endpoint.remove", endpointId);
  });
  add("jagentchill.provider.endpoint.duplicate", true, async (raw, connection) => {
    const params = parse(endpointDuplicateParams, raw);
    const source = find(params.endpointId);
    const stored = load();
    let newId = params.newId;
    for (let n = 2; !newId; n++) if (!stored.records[`${source.id}-${n}`] && !RESERVED_PROVIDER_IDS.has(`${source.id}-${n}`)) newId = `${source.id}-${n}`;
    if (stored.records[newId]) throw new ProtocolError("ALREADY_EXISTS", "An endpoint with this id exists.");
    const { created_ms: _c, updated_ms: _u, lastTest: _t, lastDiscovery_ms: _d, ...draft } = source;
    return { endpoint: view(await upsert({ ...draft, id: newId, label: `${source.label} copy`.slice(0, 40) }, connection)) };
  });
  add("jagentchill.provider.endpoint.discover", true, (raw, connection) => discover(raw, connection));
  add("jagentchill.provider.endpoint.test", true, (raw, connection) => test(raw, connection));
  add("jagentchill.provider.endpoint.export", false, (raw) => {
    const ids = parse(endpointExportParams, raw).endpointIds;
    // The export names secrets and never carries a value.
    const endpoints = Object.values(load().records).filter((record) => !ids || ids.includes(record.id)).map(({ created_ms: _c, updated_ms: _u, lastTest: _t, lastDiscovery_ms: _d, ...draft }) => draft);
    return { document: { format: "jagentchill-endpoints", version: 1, endpoints } };
  });
  add("jagentchill.provider.endpoint.import", true, async (raw, connection) => {
    const params = parse(endpointImportParams, raw);
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const draft of params.document.endpoints) {
      let id = draft.id;
      if (load().records[id]) {
        if (params.onConflict === "skip") {
          skipped.push(id);
          continue;
        }
        for (let n = 2; load().records[id]; n++) id = `${draft.id}-${n}`;
      }
      await upsert({ ...draft, id }, connection);
      imported.push(id);
    }
    const missingSecrets = [...new Set(params.document.endpoints.map((draft) => draft.auth.secretName).filter((name): name is string => !!name && !deps.secrets.has(name)))];
    return { imported, skipped, missingSecrets };
  });
  add("jagentchill.provider.preset.list", false, (raw) => {
    const params = parse(presetListParams, raw);
    const user = new Set(Object.keys(load().presets));
    return {
      presets: allPresets().filter((preset) => (!params.kind || preset.kind === params.kind) && (!params.capability || preset.capabilities.includes(params.capability)))
        .map((preset) => ({ ...preset, shipped: !user.has(preset.presetId) })),
    };
  });
  add("jagentchill.provider.preset.upsert", true, (raw, connection) => {
    const { preset } = parse(presetUpsertParams, raw);
    if (SHIPPED_PRESETS.some((shipped) => shipped.presetId === preset.presetId)) throw new ProtocolError("CONFLICT", "A shipped preset cannot be changed. Duplicate it first.");
    const stored = load();
    if (!stored.presets[preset.presetId] && Object.keys(stored.presets).length >= RUNTIME_LIMITS.userPresets) {
      throw new ProtocolError("QUOTA_EXCEEDED", "You can have up to 20 presets", { details: { limit: "userPresets", max: RUNTIME_LIMITS.userPresets } });
    }
    save({ ...stored, presets: { ...stored.presets, [preset.presetId]: { ...preset, verified: { by: "user", ref: "" } } } });
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.preset.upsert", { presetId: preset.presetId });
    return { preset };
  });
  add("jagentchill.provider.preset.remove", true, (raw, connection) => {
    const { presetId } = parse(presetRemoveParams, raw);
    if (SHIPPED_PRESETS.some((shipped) => shipped.presetId === presetId)) throw new ProtocolError("CONFLICT", "A shipped preset cannot be deleted.");
    const stored = load();
    if (!stored.presets[presetId]) throw new ProtocolError("NOT_FOUND", "No such preset.");
    const { [presetId]: _removed, ...presets } = stored.presets;
    save({ ...stored, presets });
    audit(deps.db, deps.now(), `device:${connection.deviceId}`, "provider.preset.remove", { presetId });
  });

  return {
    methods,
    records: () => Object.values(load().records),
    label: (endpointId: string) => load().records[endpointId]?.label,
    usesSecret: (name: string) => Object.values(load().records).some((record) => JSON.stringify(record).includes(`"${name}"`)),
    /** How many turns an endpoint serves at most at once (`maxConcurrency`), for the admission check of `chat.send`. */
    maxConcurrency: (endpointId: string) => load().records[endpointId]?.maxConcurrency,
  };
}

export type EndpointService = ReturnType<typeof createEndpointService>;
