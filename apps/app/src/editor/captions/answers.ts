import { answerTo, confirmWithOf } from "../../generation/cost.ts";

/**
 * The money side of the captions tools without their screens (no React here: `answers.test.ts` checks the rules without
 * a browser). An action a person starts is asked about ONCE; the host approves only an answer that names its question
 * (`confirmWith`: the action and the quote), so every request of the action carries the WHOLE answer — a later batch
 * that sent less would start a new action and be asked about again.
 */
export type Answer = { confirmed?: true } & Record<string, unknown>;
export type Quoted = { amountUsd: number | null; confirmAboveUsd: number; needsConfirmation: boolean; provider?: string; model?: string; listener?: string; via?: "generation" | "runtime"; remainingUsd?: number | null; confirmWith?: Record<string, unknown>; /** Work that runs on the person's own signed-in account: not billed by this app, no part of the amount. */ ownAccount?: { label: string; model: string }[] };

/** Where a translation is in its work: kept while it waits for an answer about money — and across a reload — so nothing that was paid for is sent again. */
export type Progress = { /** The captions and texts this is the progress of. */ key: string; /** The first caption not yet done. */ at: number; done: [string, string][]; missed: string[]; /** The answer the action runs under. */ answer: Answer };
export type Line = { id: string; text: string };
export type BatchResult = { status: "done" | "asked" | "stopped"; done: Map<string, string>; missed: string[]; lastError: unknown; /** The host's refusal, when it asked. */ asked?: unknown };

/** What names a run of captions: the same captions with the same texts into the same language go on where they stopped. */
export const progressKey = (list: readonly Line[], language: string): string => `${language}\n${list.map((line) => `${line.id}:${line.text}`).join("\n")}`;
/** The whole the batches are of: the host quotes, and approves, the action once for all of it. */
export const wholeOf = (list: readonly Line[]): { characters: number; lines: number } => ({ characters: list.reduce((sum, line) => sum + line.text.length, 0), lines: list.length });

/**
 * What the estimate of a translation is asked with: the captions themselves, in the order they will be sent, and the
 * names the requests will carry — the host prices the batches that will really go out. (Without the texts it can count
 * nothing, says "price not known", and asks about every batch on its own.)
 */
export const translationEstimate = (list: readonly Line[], targetName: string, source?: string): { kind: "translation"; characters: number; lines: number; texts: string[]; targetName: string; source?: string } =>
  ({ kind: "translation", ...wholeOf(list), texts: list.map((line) => line.text), targetName, ...(source && source !== "und" ? { source } : {}) });

/**
 * Sends the captions in batches. Every batch carries the complete answer; a batch the host asks about stops the run
 * with its place saved, and the run called again with the answer goes on from that batch with what was done before it.
 * A batch that fails for another reason is counted as missed and the run goes on.
 */
export async function translateBatches(input: {
  list: readonly Line[]; size: number; key: string; /** The answer of the person, or `{}` before any. */ answer: Answer; /** What was kept of an earlier run of the same captions. */ kept: Progress | null;
  send(texts: string[], answer: Answer): Promise<string[]>; asks(error: unknown): boolean; live(): boolean; save(progress: Progress | null): void; onProgress?(done: number, total: number): void;
}): Promise<BatchResult> {
  const kept = input.kept && input.kept.key === input.key ? input.kept : null;
  const done = new Map<string, string>(kept?.done ?? []), missed = [...(kept?.missed ?? [])];
  // A new answer replaces the kept one (the host asked again and the person answered); with none, the action goes on under the one it had.
  const answer: Answer = input.answer.confirmed ? input.answer : kept?.answer ?? input.answer;
  let lastError: unknown = null;
  input.onProgress?.(kept?.at ?? 0, input.list.length);
  for (let at = kept?.at ?? 0; at < input.list.length; at += input.size) {
    const batch = input.list.slice(at, at + input.size);
    try {
      const translations = await input.send(batch.map((line) => line.text), answer);
      if (!input.live()) return { status: "stopped", done, missed, lastError };
      // A blank answer is not a translation, whatever sent it.
      batch.forEach((line, index) => { const text = (translations[index] ?? "").trim(); if (text) done.set(line.id, text); else missed.push(line.id); });
    } catch (error) {
      if (!input.live()) return { status: "stopped", done, missed, lastError };
      if (input.asks(error)) { input.save({ key: input.key, at, done: [...done], missed, answer }); return { status: "asked", done, missed, lastError, asked: error }; }
      lastError = error; missed.push(...batch.map((line) => line.id));
    }
    // What is paid for is kept from this moment: a reload, or a lost connection, does not send it again.
    input.save({ key: input.key, at: Math.min(input.list.length, at + input.size), done: [...done], missed, answer });
    input.onProgress?.(Math.min(input.list.length, at + input.size), input.list.length);
  }
  input.save(null);
  return { status: "done", done, missed, lastError };
}

/** Whether a stored value is a translation's progress (it is read back from the device's store). */
export function isProgress(value: unknown): value is Progress {
  const entry = value as Progress | null;
  return !!entry && typeof entry === "object" && typeof entry.key === "string" && Number.isInteger(entry.at) && entry.at >= 0 && Array.isArray(entry.done) && entry.done.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "string")
    && Array.isArray(entry.missed) && entry.missed.every((id) => typeof id === "string") && !!entry.answer && typeof entry.answer === "object";
}

/**
 * Several estimates shown as ONE question (speech: every selected text is its own request, estimated as it will be
 * sent). The amount is the sum; one part without a price makes the whole "price not known". `confirmWith` holds each
 * part's own ids under its key, for `answerOf`.
 */
export function sumEstimates(parts: readonly { key: string; estimate: Quoted }[]): Quoted | null {
  if (!parts.length) return null;
  const first = parts[0].estimate, amounts = parts.map((part) => part.estimate.amountUsd), each: Record<string, Record<string, unknown>> = {};
  for (const part of parts) { const named = confirmWithOf(part.estimate); if (named) each[part.key] = named; }
  const left = parts.map((part) => part.estimate.remainingUsd).filter((value): value is number => typeof value === "number");
  return {
    ...first, amountUsd: amounts.some((amount) => amount === null) ? null : Math.round(amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) * 1e6) / 1e6,
    needsConfirmation: parts.some((part) => part.estimate.needsConfirmation), ...(left.length ? { remainingUsd: Math.min(...left) } : {}), confirmWith: { each },
  };
}
/**
 * The answers of an action whose parts are each asked about by the host on their own: the dialog's one answer
 * (`each`) is every part's; a later answer (the host asked again about ONE part) is that part's alone.
 */
export function partAnswers(before: Readonly<Record<string, Answer>>, answer: Answer, asking: string | null): Record<string, Answer> {
  const each = answer.each;
  if (each && typeof each === "object" && !Array.isArray(each)) return Object.fromEntries(Object.entries(each as Record<string, Record<string, unknown>>).map(([key, named]) => [key, answerTo(named)]));
  if (answer.confirmed && asking !== null) return { ...before, [asking]: answer };
  return { ...before };
}
/** What goes with the request of one part: its own answer, else the bare confirmation the person gave, else nothing. */
export const answerOf = (answers: Readonly<Record<string, Answer>>, key: string, all: Answer): Answer => answers[key] ?? (all.confirmed && !all.each ? { confirmed: true } : {});

/**
 * The length a recording's estimate is asked for: the host takes a piece as part of the whole only when the whole is
 * LONGER than the piece, so the whole is the clips' length rounded up to a tenth, plus a tenth.
 */
export const wholeSeconds = (seconds: number): number => (seconds > 0 ? Math.round((Math.ceil(seconds * 10) + 1)) / 10 : 0);

/**
 * How a model of a runtime (the kind that also answers in the chat) is called where a tool says what it runs on: the
 * runtime or provider by its name and the model by its label ("Claude Code · Claude Opus 5.5") — never their ids.
 * Null when the catalogue does not list it (the caller then shows what the host gave).
 */
export function runtimeModelName(groups: readonly { kind: string; label: string; providers: readonly { providerId: string; label: string; models: readonly { label?: string; ref: { modelId: string } }[] }[] }[] | null | undefined, providerId: string | undefined, modelId: string | undefined): string | null {
  if (!modelId) return null;
  for (const group of groups ?? []) for (const provider of group.providers) {
    if (providerId && provider.providerId !== providerId) continue;
    const found = provider.models.find((model) => model.ref.modelId === modelId);
    // A signed-in CLI is known by its own name ("Claude Code").
    if (found) return `${group.label} · ${found.label || modelId}`;
  }
  return null;
}
