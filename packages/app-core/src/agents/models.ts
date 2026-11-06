import type { ModelEntry, ModelRef, ProductMode, QueueMode, Readiness, RuntimeCapabilities, RuntimeErrorInfo, RuntimeFeature, RuntimeMode, RuntimeStatus, SessionSelection } from "@jagentchill/protocol";

/** One model of `jagentchill.runtime.models.list`: the snapshot entry with its reference and the runtime's flags narrowed by the model. */
export type BrowserModel = ModelEntry & { ref: ModelRef; capabilities: RuntimeCapabilities };
export type BrowserProvider = { providerId: string; label: string; connected: boolean; health?: string; models: BrowserModel[] };
export type BrowserGroup = {
  runtimeId: string; kind: "cli"; label: string; status: RuntimeStatus; readiness: Readiness; order: number; error?: RuntimeErrorInfo;
  capabilities: RuntimeCapabilities; defaultModeId: string; modes: RuntimeMode[]; features: RuntimeFeature[]; requiresFullAccess: boolean;
  providers: BrowserProvider[];
};
export type ModelCatalogue = {
  groups: BrowserGroup[]; selection?: SessionSelection;
  policy: { canSelect: boolean; reason?: string };
};

/** How a model is reached: an agent CLI on the host, or an endpoint an admin added (Providers ▸ Endpoints). */
export type AccessMethod = "cli" | "endpoint";
export const ACCESS_METHOD_LABEL: Record<AccessMethod, string> = { cli: "Installed CLI", endpoint: "Custom endpoint" };
/** The order of the sections of the model browser's All view. */
export const ACCESS_METHODS: readonly AccessMethod[] = ["cli", "endpoint"];

export const refKey = (ref: ModelRef): string => `${ref.runtimeId}/${ref.providerId}/${ref.modelId}`;
export const sameRef = (a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean => !!a && !!b && refKey(a) === refKey(b);
const isRef = (value: unknown): value is ModelRef => !!value && typeof value === "object" && ["runtimeId", "providerId", "modelId"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");
export const isRefList = (value: unknown): value is ModelRef[] => Array.isArray(value) && value.every(isRef);
export const isRefOrNull = (value: unknown): value is ModelRef | null => value === null || isRef(value);

/** One row of the All view: a runtime together with one of its providers. A runtime that lists no provider still has its row. */
export type BrowserRow = { id: string; group: BrowserGroup; provider: BrowserProvider | null; method: AccessMethod; title: string; subtitle: string; count: number };

/** The rows of the All view in the host's order: one per runtime and provider. Every runtime is an agent CLI on the host. */
export function browserRows(catalogue: ModelCatalogue): BrowserRow[] {
  const rows: BrowserRow[] = [];
  for (const group of [...catalogue.groups].sort((a, b) => a.order - b.order)) {
    if (group.providers.length === 0) {
      rows.push({ id: group.runtimeId, group, provider: null, method: "cli", title: group.label, subtitle: "", count: 0 });
      continue;
    }
    for (const provider of group.providers) {
      rows.push({ id: `${group.runtimeId}/${provider.providerId}`, group, provider, method: "cli", title: group.label, subtitle: provider.label, count: provider.models.length });
    }
  }
  return rows;
}

export const allModels = (catalogue: ModelCatalogue): BrowserModel[] => catalogue.groups.flatMap((group) => group.providers.flatMap((provider) => provider.models));
export const groupOf = (catalogue: ModelCatalogue | null | undefined, ref: ModelRef | null | undefined): BrowserGroup | undefined => (ref ? catalogue?.groups.find((group) => group.runtimeId === ref.runtimeId) : undefined);
export const findModel = (catalogue: ModelCatalogue | null | undefined, ref: ModelRef | null | undefined): BrowserModel | undefined =>
  ref ? groupOf(catalogue, ref)?.providers.find((provider) => provider.providerId === ref.providerId)?.models.find((model) => model.modelId === ref.modelId) : undefined;

/** Case-insensitive substring of the model label, the model id, the provider label or the runtime label, across every runtime. */
export function searchModels(catalogue: ModelCatalogue, query: string): Array<{ model: BrowserModel; group: BrowserGroup; provider: BrowserProvider }> {
  const needle = query.trim().toLowerCase();
  const found: Array<{ model: BrowserModel; group: BrowserGroup; provider: BrowserProvider }> = [];
  for (const group of [...catalogue.groups].sort((a, b) => a.order - b.order)) for (const provider of group.providers) for (const model of provider.models) {
    if (!needle || [model.label, model.modelId, provider.label, group.label].some((text) => text.toLowerCase().includes(needle))) found.push({ model, group, provider });
  }
  return found;
}

/** The models of one group row, favourites first while nothing is searched. */
export function rowModels(row: BrowserRow, query: string, favourites: readonly ModelRef[]): BrowserModel[] {
  const needle = query.trim().toLowerCase();
  const models = (row.provider?.models ?? []).filter((model) => !needle || model.label.toLowerCase().includes(needle) || model.modelId.toLowerCase().includes(needle));
  if (needle) return models;
  const starred = new Set(favourites.map(refKey));
  return [...models].sort((a, b) => Number(starred.has(refKey(b.ref))) - Number(starred.has(refKey(a.ref))));
}

/** Which view the browser opens on: the only group, else the current model's group unless it is a favourite, else All. */
export function initialView(rows: BrowserRow[], current: ModelRef | null | undefined, favourites: readonly ModelRef[]): { view: "all" } | { view: "group"; rowId: string; back: boolean } {
  if (rows.length === 1) return { view: "group", rowId: rows[0].id, back: false };
  if (current && !favourites.some((ref) => sameRef(ref, current))) {
    const row = rows.find((candidate) => candidate.group.runtimeId === current.runtimeId && (candidate.provider === null || candidate.provider.providerId === current.providerId));
    if (row) return { view: "group", rowId: row.id, back: true };
  }
  return { view: "all" };
}

export const toggleFavourite = (favourites: readonly ModelRef[], ref: ModelRef): ModelRef[] =>
  favourites.some((entry) => sameRef(entry, ref)) ? favourites.filter((entry) => !sameRef(entry, ref)) : [...favourites, ref];
export const RECENT_MODELS = 5;
/** The last five distinct models used on this device, newest first. */
export const pushRecent = (recents: readonly ModelRef[], ref: ModelRef): ModelRef[] => [ref, ...recents.filter((entry) => !sameRef(entry, ref))].slice(0, RECENT_MODELS);

export type Role = "admin" | "editor" | "viewer";
/** Why a model cannot be chosen, and the one action offered; `null` when it can. */
export type Blocked = { text: string; action?: "install" | "sign-in" | "enable" | "retry" };

export function blockedReason(group: BrowserGroup, model: BrowserModel | null, policy: ModelCatalogue["policy"], role: Role): Blocked | null {
  if (role === "viewer" || !policy.canSelect) return { text: policy.reason ?? "Viewers cannot select a runtime" };
  const readiness = model?.readiness ?? group.readiness;
  if (group.readiness === "needs-install") return { text: "Not installed", action: "install" };
  if (group.readiness === "disabled") return { text: "Turned off", ...(role === "admin" ? { action: "enable" as const } : {}) };
  if (group.readiness === "loading") return { text: "Loading" };
  if (group.readiness === "error") return { text: group.error?.message ?? "Error", action: "retry" };
  if (readiness === "ready" || readiness === "cooldown") return null;
  if (readiness === "needs-auth") return { text: "Sign in required", action: "sign-in" };
  if (readiness === "unsupported") return { text: `Not available on ${group.label}` };
  if (readiness === "loading") return { text: "Loading" };
  return { text: group.error?.message ?? "Error", action: "retry" };
}

/** The model a draft starts on: the remembered one when it can still be chosen, else the first ready model in the host's order. */
export function draftModel(catalogue: ModelCatalogue | null | undefined, remembered: ModelRef | null, role: Role): BrowserModel | null {
  if (!catalogue) return null;
  const usable = (model: BrowserModel | undefined) => !!model && blockedReason(groupOf(catalogue, model.ref)!, model, catalogue.policy, role) === null;
  const kept = findModel(catalogue, remembered);
  if (usable(kept)) return kept!;
  for (const group of [...catalogue.groups].sort((a, b) => a.order - b.order)) {
    const models = group.providers.flatMap((provider) => provider.models).filter(usable);
    if (models.length) return models.find((model) => model.isDefault) ?? models[0];
  }
  return null;
}

/** No agent CLI on the host is ready: the "Set up an AI runtime" state. */
export const noRuntimeReady = (catalogue: ModelCatalogue | null | undefined): boolean => !!catalogue && !catalogue.groups.some((group) => group.readiness === "loading") && !allModels(catalogue).some((model) => model.readiness === "ready" || model.readiness === "cooldown");

/** Badges of a model row: what the session can do on this model through this runtime. */
export function modelBadges(model: BrowserModel): string[] {
  const badges: string[] = [];
  if (model.capabilities.jcTools !== "none") badges.push("Editor tools");
  if (model.capabilities.steer) badges.push("Steer");
  if (model.capabilities.attachments.image) badges.push("Images");
  if (model.thinkingOptions.length > 1) badges.push("Thinking");
  return badges;
}

export const contextLabel = (tokens: number | undefined): string | null => (tokens ? `${tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`} context` : null);

// ---- modes ----

export const MODE_ICON: Record<string, string> = { ask: "chat", plan: "list", edit: "pencil", auto: "zap", unattended: "warn" };
/** The modes the control lists: product modes first, native ones after, the unattended mode last and only where it may be granted (a runtime that needs full access, an admin device). */
export function listedModes(group: BrowserGroup | undefined, context: { role: Role }): RuntimeMode[] {
  if (!group) return [];
  const product = group.modes.filter((mode) => mode.productMode && !mode.isUnattended);
  const native = group.modes.filter((mode) => !mode.productMode && !mode.isUnattended);
  const unattended = group.requiresFullAccess && context.role === "admin" ? group.modes.filter((mode) => mode.isUnattended) : [];
  return [...product, ...native, ...unattended];
}
export const PRODUCT_MODE_IDS: readonly ProductMode[] = ["ask", "plan", "edit", "auto"];

// ---- sending while a turn runs ----

export type DefaultSend = "steer" | "interrupt" | "queue";
/** What the send key and the alternate send do while a turn runs, by the personal setting "Default send". */
export function sendPlan(setting: DefaultSend): { primary: QueueMode; alternate: QueueMode } {
  if (setting === "interrupt") return { primary: "interrupt", alternate: "followup" };
  if (setting === "queue") return { primary: "followup", alternate: "steer" };
  return { primary: "steer", alternate: "interrupt" };
}
export const QUEUE_LABEL: Record<QueueMode, string> = { steer: "Steer now", interrupt: "Interrupt and send", followup: "Send after this turn" };
export const MESSAGE_LIMIT = 32_000;
export const MESSAGE_COUNTER_FROM = 30_000;
/** The counter shown from 30,000 characters, and whether the text may be sent. */
export function messageLength(text: string): { counter: string | null; over: boolean } {
  const length = text.length;
  return { counter: length >= MESSAGE_COUNTER_FROM ? `${length.toLocaleString("en-US")} / ${MESSAGE_LIMIT.toLocaleString("en-US")}` : null, over: length > MESSAGE_LIMIT };
}

/** What the composer shows for the answer of `jagentchill.chat.send` to a message sent during a turn. */
export function sendOutcome(result: { delivered?: boolean; effective?: string; downgradedFrom?: string; reason?: string }, runtimeLabel: string): { restore: boolean; notice: string | null; chip: string | null } {
  if (result.delivered === false && result.reason === "turn-changed") return { restore: true, notice: "The agent's turn changed before your message arrived", chip: null };
  if (result.downgradedFrom === "steer" && result.effective === "followup") return { restore: false, notice: `${runtimeLabel} cannot take messages mid-turn`, chip: "Will send after this turn" };
  if (result.effective === "followup") return { restore: false, notice: null, chip: "Will send after this turn" };
  return { restore: false, notice: null, chip: null };
}

// ---- usage ----

export type UsageTurn = { runId: string; runtimeId: string | null; providerId: string | null; modelId: string | null; reported: boolean; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; totalTokens: number | null; cost: number | null; ts_ms: number };
export type SessionUsage = { reports: "tokens-and-cost" | "tokens" | "none"; turns: UsageTurn[]; totals: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number; turns: number } | null; unreportedTurns: number };
export const tokenCount = (value: number | null | undefined): string => (value === null || value === undefined ? "—" : value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(2)}M` : value >= 10_000 ? `${+(value / 1000).toFixed(1)}k` : value.toLocaleString("en-US"));
/** A turn's cost: an amount only where the runtime reports one — never zero for "not reported". */
export const costLabel = (turn: Pick<UsageTurn, "reported" | "cost">): string => (!turn.reported ? "Not reported" : turn.cost === null ? "Tokens only" : `est. $${turn.cost.toFixed(turn.cost < 0.1 ? 4 : 2)}`);

/**
 * The thinking option a composer shows for a model: the one asked for (a live session's, or the one this device
 * remembers for the model) while the model still offers it, else the model's default, else its first option.
 * `null` when the model offers no choice (zero or one option): the control is absent.
 */
export function thinkingChoice(model: Pick<BrowserModel, "thinkingOptions" | "defaultThinkingOptionId"> | null | undefined, wanted: string | null | undefined): string | null {
  const options = model?.thinkingOptions ?? [];
  if (options.length < 2) return null;
  if (wanted && options.some((option) => option.id === wanted)) return wanted;
  return options.find((option) => option.id === model?.defaultThinkingOptionId)?.id ?? options[0].id;
}
