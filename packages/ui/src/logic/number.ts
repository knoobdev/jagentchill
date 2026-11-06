/** NumberField arithmetic: expression parsing, clamping, stepping and scrubbing. Ported from OpenCut classic's number field. */

/**
 * Evaluates `+ - * /`, parentheses and decimals with a recursive-descent parser. Any other character, division by zero or
 * an unparsable expression gives null.
 */
export function evaluateExpression(input: string): number | null {
  const text = input.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/,/g, ".");
  if (text === "" || /[^0-9.+\-*/()]/.test(text)) return null;
  let at = 0;
  let failed = false;
  const peek = () => text[at];
  function factor(): number {
    if (peek() === "-") { at++; return -factor(); }
    if (peek() === "+") { at++; return factor(); }
    if (peek() === "(") {
      at++;
      const value = sum();
      if (peek() !== ")") failed = true; else at++;
      return value;
    }
    const match = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(at));
    if (!match) { failed = true; return 0; }
    at += match[0].length;
    return Number(match[0]);
  }
  function product(): number {
    let value = factor();
    while (!failed && (peek() === "*" || peek() === "/")) {
      const operator = text[at++];
      const right = factor();
      if (operator === "/" && right === 0) { failed = true; return 0; }
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (!failed && (peek() === "+" || peek() === "-")) {
      const operator = text[at++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  return failed || at !== text.length || !Number.isFinite(result) ? null : result;
}

export type NumberRange = { min?: number; max?: number; step?: number };
const decimalsOf = (step: number) => (String(step).split(".")[1] ?? "").length;
/** Clamps to the range and snaps to the step (measured from `min`, or from 0 without one). */
export function constrain(value: number, range: NumberRange): number {
  const step = range.step && range.step > 0 ? range.step : 0;
  let next = value;
  if (step) {
    const origin = range.min ?? 0;
    next = origin + Math.round((next - origin) / step) * step;
    next = Number(next.toFixed(Math.min(10, decimalsOf(step) + decimalsOf(origin))));
  }
  if (range.min !== undefined) next = Math.max(range.min, next);
  if (range.max !== undefined) next = Math.min(range.max, next);
  return next;
}
/** Value after committing typed input; null when the input is invalid and the previous value stays. */
export function commitInput(input: string, range: NumberRange): number | null {
  const value = evaluateExpression(input);
  return value === null ? null : constrain(value, range);
}
/** Up/Down change by one step, Shift by 10 steps, Alt by 0.1 step. */
export function stepByKey(value: number, direction: 1 | -1, modifiers: { shift?: boolean; alt?: boolean }, range: NumberRange): number {
  const step = range.step ?? 1;
  const amount = step * (modifiers.shift ? 10 : modifiers.alt ? 0.1 : 1);
  const next = Number((value + direction * amount).toFixed(10));
  // An Alt step is finer than the grid, so it is clamped but not snapped.
  return modifiers.alt ? constrain(next, { min: range.min, max: range.max }) : constrain(next, range);
}

export type ScrubOptions = NumberRange & {
  /** 0.5 unit per pixel instead of 1. */
  slow?: boolean;
  /** Pixels per unit for value ranges, e.g. finer control near zero: the first range containing the value applies. */
  ranges?: Array<{ from: number; to: number; pixelsPerUnit: number }>;
  /** Limits of the scrub gesture, when narrower than the field's range. */
  clamp?: { min: number; max: number };
};
/** A scrub gesture: the first move event is discarded (pointer lock reports a jump), then pixels become units. */
export function scrubber(start: number, options: ScrubOptions) {
  let value = start, first = true;
  return {
    move(dx: number, modifiers: { shift?: boolean; alt?: boolean } = {}): number {
      if (first) { first = false; return this.value(); }
      const piece = options.ranges?.find((range) => value >= range.from && value < range.to);
      const perPixel = piece ? 1 / piece.pixelsPerUnit : options.slow ? 0.5 : 1;
      const scale = (options.step ?? 1) * perPixel * (modifiers.shift ? 10 : 1) * (modifiers.alt ? 0.1 : 1);
      value += dx * scale;
      const limit = options.clamp ?? { min: options.min ?? -Infinity, max: options.max ?? Infinity };
      value = Math.max(Math.max(limit.min, options.min ?? -Infinity), Math.min(Math.min(limit.max, options.max ?? Infinity), value));
      return this.value();
    },
    /** The value shown and committed: scrubbing with Alt may land between steps, so only rounding noise is removed. */
    value: () => Number(value.toFixed(6)),
  };
}
export const INVALID_FLASH_MS = 1500;
export const MIXED = "—";
/** Display text of a value: trailing zeros dropped, a true minus sign for negatives. */
export function formatNumber(value: number, step = 1): string {
  const text = String(Number(value.toFixed(Math.max(decimalsOf(step), value % 1 === 0 ? 0 : 2))));
  return text.replace("-", "−");
}

/** Slider geometry and keyboard steps. */
export function sliderValueAt(fraction: number, range: Required<Pick<NumberRange, "min" | "max">> & { step?: number }): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return constrain(range.min + clamped * (range.max - range.min), range);
}
export const sliderFraction = (value: number, min: number, max: number) => (max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min))));
/** Arrow keys move one step, Shift+arrow 10 steps, Page Up/Down 10% of the range, Home/End to the ends. */
export function sliderKey(value: number, key: string, shift: boolean, range: { min: number; max: number; step?: number }): number | null {
  const step = range.step ?? 1;
  const span = range.max - range.min;
  const delta: Record<string, number> = {
    ArrowLeft: -step * (shift ? 10 : 1), ArrowDown: -step * (shift ? 10 : 1), ArrowRight: step * (shift ? 10 : 1), ArrowUp: step * (shift ? 10 : 1),
    PageUp: span * 0.1, PageDown: -span * 0.1,
  };
  if (key === "Home") return range.min;
  if (key === "End") return range.max;
  return key in delta ? constrain(value + delta[key]!, range) : null;
}
/**
 * One gesture on a slider: live values are delivered at most once per animation frame and exactly one commit fires on
 * release, so the consumer records a single undo step.
 */
export function dragSession(handlers: { onChange?(value: number): void; onCommit?(value: number): void }, requestFrame: (fn: () => void) => void = (fn) => fn()) {
  let latest: number | null = null, scheduled = false, last: number | null = null;
  const deliver = () => { scheduled = false; if (latest !== null && latest !== last) { last = latest; handlers.onChange?.(latest); } };
  return {
    update(value: number) { latest = value; if (!scheduled) { scheduled = true; requestFrame(deliver); } },
    end() { if (latest !== null) handlers.onCommit?.(latest); latest = null; },
  };
}
/** Fill of a slider track as fractions: from the start, or from the default tick in centre-origin mode. */
export function sliderFill(value: number, range: { min: number; max: number; origin?: number }): { from: number; to: number } {
  const at = sliderFraction(value, range.min, range.max);
  const origin = range.origin === undefined ? 0 : sliderFraction(range.origin, range.min, range.max);
  return { from: Math.min(at, origin), to: Math.max(at, origin) };
}
