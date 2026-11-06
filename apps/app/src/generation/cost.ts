import type { T } from "../locale";

/**
 * The money question of an action a person starts, without its screen (no React here, so its rules are checked by
 * `cost.test.ts` without a browser): what the host's refusal is read into, and the ONE way an answer is built —
 * `answerTo`. The host approves only an answer that names the question it put (`details.confirmWith`: the action and
 * the quote that was shown); an answer without them is asked about again.
 */

/** What a person started: it decides the words of the question. */
export type CostKind = "film" | "pictures" | "voice" | "music" | "captions" | "translation" | "speech" | "clips";
export type CostRow = { id: string; label: string; /** How many are made, where they are counted. */ count?: number; usd: number | null; model?: string };
/** A part of the work whose price the host does not know: it is named beside the total, never counted in it as zero. */
export type CostUnknown = { id: string; /** What is done ("Writing the script"). */ label: string; /** Who does it, as a person knows it. */ model: string };
/** Work done on the person's own signed-in account: what is done (as the host labels it) and the model that does it. */
export type CostOwn = { what: "writing" | "vision" | "translation" | "other"; model: string; /** The account's runtime as the host names it for a person ("Claude Code"), when it says. */ runtime?: string };
/**
 * The ONE money question of an action a person starts, as the host sends it with its refusal (`PERMISSION_DENIED`,
 * `details.reason "confirmation_required"`): the estimate with its parts, what the spending limits still leave, and
 * the amount above which the host asks.
 */
export type CostAsk = {
  kind: CostKind; amountUsd: number | null; rows: CostRow[]; remainingUsd: number | null; confirmAboveUsd: number | null;
  /** Work that is part of the action and has no price here (a film's writing and picture check are turns of a chat model): `amountUsd` does not include it. */
  unknown: CostUnknown[];
  /** `amountUsd` is the total of the parts that have a price only (`amountKind "subtotal_of_priced"`): the total's label says so. */
  subtotal?: boolean;
  /**
   * Work of the action that runs on an account the person signed in to themselves (Claude Code, Codex): this app is
   * not billed for it, so it is no part of the amount and nothing is asked about it — it is told in one quiet line.
   */
  own?: CostOwn[];
  /** The estimate is of the most the action may need, not of a known list of work (a film whose script is not written yet). */
  upper?: boolean;
  /** A film's run asks about money again only when it is about to pass this. */
  stopsAtUsd?: number | null;
  /** The work is done by a model of a runtime (the kind that answers in the chat): the host has no price for it, and its own account is charged. */
  via?: "generation" | "runtime";
  /**
   * Not the first question: the action was confirmed and started, and a further paid part of it would pass what was
   * confirmed — or needs a model whose price is not known (`amountUsd` null). `amountUsd` is the new total; `remainsUsd`
   * what is still to pay of it.
   */
  again?: { spentUsd: number; confirmedUsd: number | null; remainsUsd: number | null };
  /** What the host wants sent back, unchanged, with the confirmation of THIS question (`details.confirmWith` of its refusal). */
  confirmWith?: Record<string, unknown>;
};
/** The answer "Start" gives: what a screen sends with its action again. */
export type CostAnswer = { confirmed: true } & Record<string, unknown>;

/** What the host named to be sent back with the answer to its question, as it came; undefined when it named nothing. */
export function confirmWithOf(details: { confirmWith?: unknown } | null | undefined): Record<string, unknown> | undefined {
  const named = details?.confirmWith;
  return named && typeof named === "object" && !Array.isArray(named) ? (named as Record<string, unknown>) : undefined;
}
/**
 * THE answer to a money question — every place that answers one builds it here. The host's own `confirmWith` goes back
 * unchanged (nothing a screen adds may replace a field of it); `extra` is what the action itself needs beside it (the
 * amount a run is held to).
 */
export const answerTo = (confirmWith: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): CostAnswer => ({ ...extra, ...(confirmWith ?? {}), confirmed: true });
export const costAnswer = (ask: CostAsk): CostAnswer => answerTo(ask.confirmWith);

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
type Part = { id?: unknown; label?: unknown; count?: unknown; usd?: unknown; model?: unknown; maxClipSeconds?: unknown };
/** How a model is called on screen, by the id the host names it with; an id nobody has a name for stays as it is. */
export type NameOf = (modelId: string) => string;

/**
 * Reads the host's refusal into the question. `details` is the `details` of the error. Returns null when the refusal
 * is not the money question. A film's estimate has its parts (pictures, voice, music — each with its count, amount and
 * model); a single job or a captions action is one part.
 */
export function costAskOf(t: T, details: Record<string, unknown> | undefined | null, kind: CostKind, nameOf?: NameOf): CostAsk | null {
  if (!details || details.reason !== "confirmation_required" || details.scope === "confirmed_estimate") return null;
  return costAsk(t, kind, (details.estimate ?? {}) as Record<string, unknown>, details, nameOf);
}
/** The same question from an estimate that is already known (a checkpoint of a run, the estimate a tool shows before its action). */
export function costAsk(t: T, kind: CostKind, estimate: Record<string, unknown>, around: { remainingUsd?: unknown; confirmAboveUsd?: unknown; stopsAtUsd?: unknown; spentUsd?: unknown; confirmedUsd?: unknown; confirmWith?: unknown; scripted?: unknown; upperPlan?: unknown; /** One voice line: the amount holds this many recordings (the first and the automatic ones after a failed check) — the most it can come to. */ attempts?: unknown } = {}, nameOf: NameOf = (id) => id): CostAsk {
  // An upper limit, not a forecast: the host derived the most the story may need (`upperPlan`) because no script exists yet.
  const most = (!!around.upperPlan && typeof around.upperPlan === "object") || around.scripted === false;
  const amountUsd = number(estimate.amountUsd), parts = Array.isArray(estimate.breakdown) ? (estimate.breakdown as Part[]) : [];
  const counted = parts.filter((part) => part && typeof part.id === "string" && typeof part.count === "number");
  let rows: CostRow[];
  if (counted.length) rows = counted.map((part) => {
    const n = part.count as number;
    const label = most && part.id === "pictures" ? t("Up to {n} pictures", { n }) : most && part.id === "voice" ? t("Up to {n} voice lines", { n }) : most && part.id === "listening" ? t("Checking up to {n} recordings by listening to them", { n })
      : most && part.id === "video" && typeof part.maxClipSeconds === "number" ? t("Up to {n} clips of up to {seconds} s", { n, seconds: part.maxClipSeconds })
      : most && part.id === "video" ? t("Up to {n} video clips", { n }) : part.id === "video" ? (n === 1 ? t("1 video clip") : t("{n} video clips", { n }))
      : part.id === "pictures" ? (n === 1 ? t("1 picture") : t("{n} pictures", { n })) : part.id === "voice" ? (n === 1 ? t("1 voice line") : t("{n} voice lines", { n })) : part.id === "music" ? t("Music") : part.id === "listening" ? (n === 1 ? t("Checking 1 recording by listening to it") : t("Checking {n} recordings by listening to them", { n })) : t(TURN_PARTS[String(part.label)] ?? UNKNOWN_PARTS[String(part.id)] ?? String(part.label ?? part.id));
    // The turns of a chat model (writing, the picture check) are named by the host with the model's id: shown by its name.
    const turns = part.id === "writing" || part.id === "vision";
    return { id: String(part.id), label, count: n, usd: number(part.usd), ...(typeof part.model === "string" && part.model ? { model: turns ? nameOf(part.model) : part.model } : {}) };
  });
  else {
    // One job: what is made, and the model that makes it (speech that is read back names who listens too).
    const label = kind === "pictures" ? t("1 picture") : kind === "voice" || kind === "speech" ? t("Voice") : kind === "music" ? t("Music") : kind === "clips" ? t("1 video clip") : kind === "captions" ? t("Writing down what is said") : kind === "translation" ? t("Translation") : t("Film");
    const model = [estimate.label ?? estimate.model, estimate.listener].filter((entry): entry is string => typeof entry === "string" && !!entry).join(" · ");
    rows = [{ id: kind, label, ...(kind === "pictures" ? { count: 1 } : {}), usd: amountUsd, ...(model ? { model } : {}) }];
  }
  // Work the host names as having no price (`unpricedParts`: what is done, and by which model): every one is shown by name.
  const unknown: CostUnknown[] = (Array.isArray(estimate.unpricedParts) ? (estimate.unpricedParts as Part[]) : []).filter((part) => part && typeof part.id === "string")
    .map((part) => ({ id: String(part.id), label: t(UNKNOWN_PARTS[String(part.id)] ?? String(part.label ?? part.id)), model: typeof part.model === "string" && part.model ? nameOf(part.model) : "" }));
  // A model the host lists as unpriced without saying which part it does (`unpricedModels`, beside an amount) is a row too, by its name.
  const bare = (id: string) => id.replace(/^runtime:/, ""), covered = new Set((Array.isArray(estimate.unpricedParts) ? (estimate.unpricedParts as Part[]) : []).map((part) => String(part?.model ?? "")));
  // (A model whose own row already says "Price not known" — the voice, its read-back — is not said a second time.)
  const said = new Set(rows.filter((row) => row.usd === null && row.model).map((row) => row.model));
  if (amountUsd !== null && counted.length) (Array.isArray(estimate.unpricedModels) ? (estimate.unpricedModels as unknown[]) : []).filter((id): id is string => typeof id === "string" && !!id && !!nameOf(id) && !said.has(nameOf(id)) && ![...covered].some((model) => model && (bare(id) === model || bare(id).endsWith(`/${model}`))))
    .forEach((id, at) => unknown.push({ id: `model-${at + 1}`, label: t("Work done by {model}", { model: nameOf(id) }), model: "" }));
  const own: CostOwn[] = (Array.isArray(estimate.ownAccount) ? (estimate.ownAccount as { label?: unknown; model?: unknown }[]) : []).filter((entry) => entry && typeof entry.label === "string")
    .map((entry) => ({ what: OWN_PARTS[String(entry.label)] ?? "other", model: typeof entry.model === "string" ? entry.model : "", ...(typeof (entry as { runtime?: unknown }).runtime === "string" && (entry as { runtime: string }).runtime ? { runtime: (entry as { runtime: string }).runtime } : {}) }));
  // What the amount is: the host says it (`amountKind`); an older answer is read by whether it names work without a price.
  const subtotal = estimate.amountKind === "subtotal_of_priced" || (estimate.amountKind === undefined && unknown.length > 0);
  // A film with nothing to draw, record or compose: only the unknown parts are left, and the one made-up "Film" row says nothing.
  if (unknown.length && !counted.length) rows = [];
  const spentUsd = number(estimate.spentUsd) ?? number(around.spentUsd), confirmedUsd = number(around.confirmedUsd), confirmWith = confirmWithOf(around);
  return {
    kind, amountUsd: unknown.length && !rows.length ? null : amountUsd, rows, unknown, remainingUsd: number(around.remainingUsd), confirmAboveUsd: number(around.confirmAboveUsd), ...(around.stopsAtUsd !== undefined ? { stopsAtUsd: number(around.stopsAtUsd) } : {}), ...((most || (number(around.attempts) ?? 0) > 1) && rows.length ? { upper: true } : {}),
    ...(subtotal && rows.length && amountUsd !== null ? { subtotal: true } : {}), ...(own.length ? { own } : {}),
    ...(estimate.via === "runtime" || estimate.via === "generation" ? { via: estimate.via } : {}),
    // The host says what the action has cost so far only when it asks a second time.
    ...(spentUsd !== null ? { again: { spentUsd, confirmedUsd, remainsUsd: number(estimate.remainsUsd) } } : {}),
    ...(confirmWith ? { confirmWith } : {}),
  };
}
/**
 * A question the host puts AFTER the person already answered one for the same action is never shown as the first
 * question again (the same words twice read as "my answer was lost"): it is the "again" form, also when the host's
 * refusal carries no figures of what was spent (nothing was — the model that was doing the work failed before it cost anything).
 */
export const asAgain = (ask: CostAsk): CostAsk => (ask.again ? ask : { ...ask, again: { spentUsd: 0, confirmedUsd: null, remainsUsd: null } });
/** What the host calls the work that runs on the person's own account, read into what the dialog's line is about. */
const OWN_PARTS: Record<string, CostOwn["what"]> = { "Writing the script": "writing", "Writing the story": "writing", "Checking the pictures": "vision", Translation: "translation" };
const OWN_LINES: Record<string, [string, string]> = {
  both: ["Writing and checking the pictures run on your {account} account — not billed by this app.", "Writing and checking the pictures run on your own account — not billed by this app."],
  writing: ["Writing runs on your {account} account — not billed by this app.", "Writing runs on your own account — not billed by this app."],
  vision: ["Checking the pictures runs on your {account} account — not billed by this app.", "Checking the pictures runs on your own account — not billed by this app."],
  translation: ["Translation runs on your {account} account — not billed by this app.", "Translation runs on your own account — not billed by this app."],
  other: ["A part of this runs on your {account} account — not billed by this app.", "A part of this runs on your own account — not billed by this app."],
};
/**
 * The ONE quiet line about work on the person's own account: [what is done, with {account} | without]. `account` is
 * the name of the account as a person knows it ("Claude Code"); "" when the screen cannot name it.
 */
export function ownLine(t: T, own: readonly CostOwn[], account: string): string {
  const has = (what: CostOwn["what"]) => own.some((entry) => entry.what === what);
  const words = OWN_LINES[has("writing") && has("vision") ? "both" : has("writing") ? "writing" : has("vision") ? "vision" : has("translation") ? "translation" : "other"];
  return account ? t(words[0], { account }) : t(words[1]);
}
/**
 * The name of the account the own-account work runs on, as a person knows it: the label of the signed-in runtime
 * ("Claude Code") that offers every model named — "" when they are not all found in one such runtime.
 */
export function accountOf(groups: readonly { kind: string; label: string; providers: readonly { models: readonly { ref: { modelId: string } }[] }[] }[] | null | undefined, own: readonly CostOwn[]): string {
  // The host names the account itself (`ownAccount[].runtime`): that name, when every part runs on the same one.
  const named = [...new Set(own.map((entry) => entry.runtime ?? ""))];
  if (own.length && named.length === 1 && named[0]) return named[0];
  const bare = (id: string) => id.replace(/^runtime:/, "").split("/").pop() ?? id;
  const found = (groups ?? []).filter((group) => group.kind === "cli" && own.every((entry) => group.providers.some((provider) => provider.models.some((model) => model.ref.modelId === entry.model || model.ref.modelId === bare(entry.model)))));
  return own.length && found.length === 1 ? found[0].label : "";
}
/** The turns of a chat model the host prices and lists among a film's parts, by the label it gives them. */
const TURN_PARTS: Record<string, string> = { "Writing the script": "Writing the script", "Writing the story": "Writing the story", "Checking the pictures": "Checking the pictures by looking at them" };
/** The unknown parts a film names, in the words of the dialog (the host's own labels are the fallback). */
const UNKNOWN_PARTS: Record<string, string> = { writing: "Writing the script", vision: "Checking the pictures by looking at them" };
