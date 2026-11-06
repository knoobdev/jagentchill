import { answerTo, asAgain, confirmWithOf, costAsk, costAskOf, type CostAnswer, type CostAsk, type NameOf } from "../generation/cost.ts";
import type { T } from "../locale";

/**
 * The paid actions of the film screens and the money question the host may put before one — without React, so the
 * rules are checked by `paid.test.ts`: a question that waits is DATA (what was asked, and the request it belongs to),
 * never a function bound to a connection; its answer is sent through whatever connection is current when the person
 * answers (the one that asked may be gone after a reconnect), and it carries the question's own ids back unchanged.
 */
export type Outcome = { ok: true } | { ok: false; code: string; message: string; details?: Record<string, unknown> };
export type FilmCall = (method: string, params?: Record<string, unknown>) => Promise<({ ok: true } & { value: unknown }) | { ok: false; code: string; message: string; details?: Record<string, unknown> }>;
export type PaidKind = "film" | "pictures" | "voice" | "music" | "clips";
/** The action that waits for its cost to be confirmed: the question, and the request to send again with the answer. */
export type Pending = { ask: CostAsk; kind: PaidKind; method: string; params: Record<string, unknown> };

/**
 * What a failure of a film is said as. The host's own sentence, except where a person would be left with a code or
 * with words about the app's inner plan: a script that came out larger than the film that was confirmed.
 */
export const filmFailure = (t: T, error: { code?: string; message?: string; details?: Record<string, unknown> | null } | null | undefined, fallback: string): string =>
  noWriter(error) ? NO_WRITER(t) : routeMissing(error) ? missingText(t, routeMissing(error)!) : error?.code === "PLAN_EXCEEDED" ? t("The script written for this story came out longer than the film you confirmed allows, so nothing of it was kept. Try again — or shorten the story, or split it into parts.") : error?.message ?? fallback;

/** Nobody is set to write: the sentence, the same wherever it is said. Its button is "Open Model routing" — never a model picker. */
export const NO_WRITER = (t: T): string => t("No model is set to write this film's script. Choose one in Settings ▸ Model routing.");
/** A failure that means "no model writes": the host found no route for the writing role (it answers "Choose a model", which no film screen offers). */
export const noWriter = (error: { code?: string; details?: Record<string, unknown> | null } | null | undefined): boolean =>
  error?.code === "NO_ROUTE" && (error.details?.reason === "no-model-chosen" || error.details?.reason === "orc_route_unusable");
/**
 * Who writes a film's script, as Model routing has it: the Storyboard role's model, else the Director's (the host's own
 * order). `true` a model writes, `false` none does, `null` not known yet (nothing is held back on a guess). The device
 * names no model of its own — which model does what is decided only in Model routing.
 */
export function writingRouted(writing: readonly { role: string; model: unknown | null; problem?: string }[] | undefined, director: { enabled: boolean; state: string } | null): boolean | null {
  const own = writing?.find((entry) => entry.role === "storyboard");
  if (own?.model) return true;
  if (own?.problem) return false;
  if (!writing || !director) return null;
  return director.enabled && director.state === "ready";
}
/** What "Make the film" cannot do without and this host does not have (`NO_ROUTE`, `details.reason "route_missing"`): the capabilities, in the host's order; null for every other failure. */
export function routeMissing(error: { code?: string; details?: Record<string, unknown> | null } | null | undefined): string[] | null {
  if (error?.code !== "NO_ROUTE" || error.details?.reason !== "route_missing" || !Array.isArray(error.details.missing)) return null;
  const found = (error.details.missing as { capability?: unknown }[]).map((entry) => String(entry?.capability ?? "")).filter((capability) => capability in MISSING);
  return found.length ? found : null;
}
/** (The names the film's settings use for the same three things; said in lower case inside the sentence.) */
const MISSING: Record<string, string> = { image: "Pictures", tts: "Voice", music: "Music" };
/** One sentence: what is missing, and where it is connected. */
export const missingText = (t: T, missing: readonly string[]): string =>
  t("This film cannot be made yet — nothing connected here makes: {what}. Connect it in Settings ▸ Providers ▸ Generation. Nothing was spent.", { what: missing.map((capability) => t(MISSING[capability]).toLocaleLowerCase()).join(", ") });

/**
 * Sends a paid action. A refusal that is the money question is not a failure: it comes back as `pending`, for the
 * cost dialog. Money is the person's decision — nothing is confirmed here by itself.
 */
export async function sendPaid(call: FilmCall, t: T, kind: PaidKind, method: string, params: Record<string, unknown>, answer?: Record<string, unknown>, nameOf?: NameOf): Promise<{ outcome: Outcome; pending: Pending | null }> {
  const result = await call(method, { ...params, ...(answer ?? {}) });
  if (result.ok) return { outcome: { ok: true }, pending: null };
  const ask = result.code === "PERMISSION_DENIED" ? costAskOf(t, result.details, kind, nameOf) : null;
  if (!ask) return { outcome: { ok: false, code: result.code, message: filmFailure(t, result, result.message), ...(result.details ? { details: result.details } : {}) }, pending: null };
  return { outcome: { ok: true }, pending: { ask, kind, method, params } };
}
/**
 * The money question a failed step of the film carries (`activity[key].details`: the host could not go on with what
 * was confirmed, and says what to send back): the question for the request this device last sent, in the "again"
 * form. `seen` holds the questions already shown (or already there when the request was sent) — each is put once.
 */
export function activityQuestion(t: T, activity: Readonly<Record<string, { state: string; code?: string; message?: string; details?: Record<string, unknown> }>>, request: { kind: PaidKind; params: Record<string, unknown> } | null, seen: Set<string>, nameOf?: NameOf): Pending | null {
  for (const entry of Object.values(activity)) {
    const details = entry.details, named = confirmWithOf(details);
    if (entry.state !== "failed" || !details || details.reason !== "confirmation_required" || !named) continue;
    const id = JSON.stringify(named);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!request) continue;
    return { ask: asAgain(costAsk(t, request.kind, (details.estimate ?? {}) as Record<string, unknown>, details, nameOf)), kind: request.kind, method: "generate", params: request.params };
  }
  return null;
}
/**
 * What "Start" sends for a question that waits: the host's `confirmWith` as it came, `confirmed: true`, and — for the
 * film's run — the amount the person saw (the run is held to it).
 */
export const pendingAnswer = (pending: Pending, answer?: CostAnswer): CostAnswer => answerTo(answer ?? pending.ask.confirmWith, pending.kind === "film" && pending.ask.amountUsd !== null ? { confirmedUsd: pending.ask.amountUsd } : {});
/** The person's Start: the same request again with the answer, through the connection that is current NOW. */
export const answerPending = (call: FilmCall, t: T, pending: Pending, answer?: CostAnswer, nameOf?: NameOf) => sendPaid(call, t, pending.kind, pending.method, pending.params, pendingAnswer(pending, answer), nameOf);

/**
 * The name a person knows a model by, from the id the host names it with in a film's money question (a bare model id,
 * `<provider>/<model>`, or `runtime:<provider>/<model>`): the label Model routing resolved for a writing role of the
 * film, else the catalogue's name, else the id without its prefixes — never the `runtime:` form.
 */
export function filmModelName(name: string, writing: readonly { model: { providerId: string; modelId: string; label: string } | null }[], catalogue: (modelId: string) => string = (id) => id, director = ""): string {
  const bare = name.replace(/^runtime:/, "");
  // No writing role has a model of its own: the host names the Director ROLE where a model would be (`director`,
  // `role/director`). A role's id is not a name a person knows: the model Model routing gives the Director is said,
  // and nothing when the screen does not know it.
  if (bare === "director" || bare === "role/director") return director ? catalogue(director) : "";
  for (const entry of writing) if (entry.model?.label && (entry.model.modelId === bare || `${entry.model.providerId}/${entry.model.modelId}` === bare)) return entry.model.label;
  const listed = catalogue(bare);
  if (listed !== bare) return listed;
  // `<provider>/<model>`: the catalogue knows the model by its own id (which may itself hold a slash).
  const cut = bare.indexOf("/"), rest = cut > 0 ? bare.slice(cut + 1) : bare, named = catalogue(rest);
  return named !== rest ? named : rest;
}
