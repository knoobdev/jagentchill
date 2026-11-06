/** Small content rules: errors, charts, the composer and token text. */
import type { Translate } from "../strings.ts";
import type { ColorToken } from "../tokens.ts";

/** Message of an error state: the localised string of the code, or "Something went wrong (<code>)". Raw exception text is never shown. */
export function errorMessage(code: string, resolve: (code: string) => string | undefined | null, t: Translate): string {
  return resolve(code) || t("somethingWrong", { code });
}
const SECRET_KEY = /(secret|token|password|passphrase|authorization|api[-_]?key|cookie|signature|credential)/i;
/** Text of "Copy details": code, message, request name and timestamp. Values under secret-looking keys are left out. */
export function errorDetails(error: { code: string; message: string; request: string; at_ms: number; context?: Record<string, unknown> }): string {
  const lines = [`code: ${error.code}`, `message: ${error.message}`, `request: ${error.request}`, `time: ${new Date(error.at_ms).toISOString()}`];
  for (const [key, value] of Object.entries(error.context ?? {})) if (!SECRET_KEY.test(key)) lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return lines.join("\n");
}

export type Series = { name: string; values: number[] };
export const CHART_SERIES = 8;
export const chartColor = (index: number) => `chart/${(index % CHART_SERIES) + 1}` as ColorToken;
/** More than eight series: the seven largest stay and the rest are summed as "Other", which takes `chart/8`. */
export function groupSeries(series: readonly Series[], otherLabel: string): Series[] {
  if (series.length <= CHART_SERIES) return [...series];
  const total = (item: Series) => item.values.reduce((sum, value) => sum + value, 0);
  const keep = new Set([...series].sort((a, b) => total(b) - total(a)).slice(0, CHART_SERIES - 1));
  const rest = series.filter((item) => !keep.has(item));
  const length = Math.max(...series.map((item) => item.values.length));
  return [...series.filter((item) => keep.has(item)), { name: otherLabel, values: Array.from({ length }, (_, i) => rest.reduce((sum, item) => sum + (item.values[i] ?? 0), 0)) }];
}
/** The table alternative of a chart: one row per data point, one column per series. */
export function chartTable(categories: readonly string[], series: readonly Series[]): { columns: string[]; rows: Array<{ category: string; values: number[] }> } {
  return { columns: series.map((item) => item.name), rows: categories.map((category, i) => ({ category, values: series.map((item) => item.values[i] ?? 0) })) };
}
/** Round upper bound for an axis and its tick values. */
export function axisTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count, power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((value) => value >= rough)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => Number((i * step).toFixed(6)));
}
export const SPARKLINE = { minHeight: 16, maxHeight: 32, minWidth: 48, maxWidth: 160, stroke: 1.5 } as const;
/** Points of a sparkline polyline inside its box, inset by half the stroke. */
export function sparklinePoints(values: readonly number[], width: number, height: number): Array<[number, number]> {
  const inset = SPARKLINE.stroke / 2, low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  return values.map((value, i) => [inset + (values.length === 1 ? 0 : (i / (values.length - 1)) * (width - 2 * inset)), inset + (1 - (value - low) / span) * (height - 2 * inset)]);
}

/** The send button is enabled by one non-whitespace character or an attachment that has finished uploading; a failed attachment blocks sending. */
export function sendState(input: { text: string; attachments: ReadonlyArray<{ status: "uploading" | "ready" | "failed" }>; running: boolean }): { mode: "send" | "stop"; enabled: boolean } {
  const typed = input.text.trim().length > 0 || input.attachments.length > 0;
  // The stop button stands in for send only while the composer is EMPTY (`chat-agent.Stop`: "when the input is
  // empty"). With something typed the button sends it, as the send key does — otherwise a press made the moment an
  // answer is on screen, before the turn has reported its end, stops that turn and leaves the message unsent.
  if (input.running && !typed) return { mode: "stop", enabled: true };
  const blocked = input.attachments.some((item) => item.status !== "ready");
  return { mode: "send", enabled: !blocked && typed };
}
/**
 * What the send key (Enter) does. While a turn runs a typed message is still sent — the caller steers, interrupts or
 * queues it (`chat-agent.Steer, queue and interrupt while running`); only an empty composer's send key stops the turn.
 * The button does the same (`sendState`).
 */
export function sendKeyAction(input: { text: string; attachments: ReadonlyArray<{ status: "uploading" | "ready" | "failed" }>; running: boolean; canSend?: boolean }): "send" | "stop" | "none" {
  // Something is in the composer: it is sent when it can be, and never stops the turn by accident when it cannot.
  if (input.text.trim().length > 0 || input.attachments.length > 0) return input.canSend !== false && sendState({ text: input.text, attachments: input.attachments, running: false }).enabled ? "send" : "none";
  return input.running ? "stop" : "none";
}
/** Which caller pills fit the control row; the rest go to the overflow button. The mode pill and "+" always stay. */
export function fitPills(available: number, fixed: number, pills: readonly number[], gap: number, overflowButton: number): { shown: number; overflow: number } {
  const all = pills.reduce((sum, width) => sum + width + gap, 0);
  if (fixed + all <= available) return { shown: pills.length, overflow: 0 };
  let used = fixed + overflowButton + gap, shown = 0;
  for (const width of pills) { if (used + width + gap > available) break; used += width + gap; shown++; }
  return { shown, overflow: pills.length - shown };
}
export const COMPOSER = { minWidth: 320, maxWidth: 460, minLines: 2, maxLines: 10 } as const;

/** Text with inline token chips: each chip is one character for caret movement and deletion. */
export type TokenPart = string | { token: string; label: string; icon?: string };
const lengthOf = (part: TokenPart) => (typeof part === "string" ? part.length : 1);
export const tokenTextLength = (parts: readonly TokenPart[]) => parts.reduce((sum, part) => sum + lengthOf(part), 0);
/** Backspace at a caret position: removes one character, or the whole chip when the caret is immediately after one. */
export function backspaceAt(parts: readonly TokenPart[], caret: number): { parts: TokenPart[]; caret: number } {
  if (caret <= 0) return { parts: [...parts], caret: 0 };
  let offset = 0;
  const next: TokenPart[] = [];
  let done = false;
  for (const part of parts) {
    const end = offset + lengthOf(part);
    if (!done && caret > offset && caret <= end) {
      done = true;
      if (typeof part === "string") { const at = caret - offset; const text = part.slice(0, at - 1) + part.slice(at); if (text) next.push(text); }
    } else next.push(part);
    offset = end;
  }
  // Neighbouring strings left by a removed chip are joined again.
  const merged = next.reduce<TokenPart[]>((list, part) => {
    const last = list.at(-1);
    if (typeof part === "string" && typeof last === "string") list[list.length - 1] = last + part; else list.push(part);
    return list;
  }, []);
  return { parts: merged, caret: caret - 1 };
}
/** Auto-grow of a textarea: from `min` lines to `max`, then it scrolls. */
export function textareaHeight(contentLines: number, lineHeight: number, padding: number, min = 2, max = 8): { height: number; scrolls: boolean } {
  const lines = Math.max(min, Math.min(max, contentLines));
  return { height: lines * lineHeight + padding, scrolls: contentLines > max };
}
export const CODE = { collapseAfter: 30, noHighlightAfter: 2000, copiedMs: 2000 } as const;

/** Ruler ticks: the step is widened until neighbouring ticks are at least 6 px apart. */
export function rulerStep(pixelsPerUnit: number, steps: readonly number[], minGap = 6): number {
  return steps.find((step) => step * pixelsPerUnit >= minGap) ?? steps.at(-1)!;
}
/** Accessible name of a clip: its label and every state that is otherwise only drawn. */
export function clipName(label: string, state: { offline?: boolean; muted?: boolean; hidden?: boolean; locked?: boolean }, t: Translate): string {
  return [label, state.offline && t("mediaOffline"), state.muted && t("muted"), state.hidden && t("hidden"), state.locked && t("locked")].filter(Boolean).join(", ");
}
