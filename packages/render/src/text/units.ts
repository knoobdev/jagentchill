import type { TextGlyph, TextLayout, TextSpec } from "./layout.ts";
import type { UnitKind } from "./motion.ts";

/**
 * The placement units of a laid-out text: the shaped grapheme cluster (inside a cursive-joining script the whole
 * joined word), the word and the line, each numbered in reading order, and where `curve` puts every unit.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };
/** A rigid move of a unit onto its arc: rotate by `angle` (radians) about the pivot, then put the pivot at `(x, y)`. */
export type CurveMove = { pivotX: number; pivotY: number; x: number; y: number; angle: number };
export type PlacedGlyph = { fontId: string; glyph: TextGlyph; line: number; character: number; word: number; curve?: CurveMove };
export type Placement = {
  glyphs: PlacedGlyph[];
  counts: Record<UnitKind, number>;
  /** Advance boxes of the units, in the straight layout. */
  boxes: Record<UnitKind, Box[]>;
  /** Bounds of the placed block (the layout box when straight, the union of the moved unit boxes when curved). */
  bounds: { x: number; y: number; width: number; height: number };
};

const decoder = new TextDecoder(), encoder = new TextEncoder();
/** Letters of scripts that join: a word of them is one unit. The twin of `cursive` in the shaper. */
function cursive(code: number): boolean {
  return (code >= 0x0600 && code <= 0x077f) || (code >= 0x07c0 && code <= 0x07ff) || (code >= 0x08a0 && code <= 0x08ff) || (code >= 0x1800 && code <= 0x18af) || (code >= 0xfb50 && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff) || (code >= 0x1e900 && code <= 0x1e95f);
}

/** Byte ranges of the words of a text (runs without white space) and whether each joins. */
export function wordSpans(content: string): { start: number; end: number; joined: boolean }[] {
  const spans: { start: number; end: number; joined: boolean }[] = [];
  let offset = 0, open: { start: number; end: number; joined: boolean } | null = null;
  for (const character of content) {
    const length = encoder.encode(character).length;
    if (/\s/u.test(character)) open = null;
    else {
      if (!open) spans.push(open = { start: offset, end: offset, joined: false });
      open.end = offset + length;
      if (cursive(character.codePointAt(0)!)) open.joined = true;
    }
    offset += length;
  }
  return spans;
}

const grow = (box: Box | undefined, next: Box): Box => (box ? { x0: Math.min(box.x0, next.x0), y0: Math.min(box.y0, next.y0), x1: Math.max(box.x1, next.x1), y1: Math.max(box.y1, next.y1) } : { ...next });

/** Applies a curve move to a point of the straight layout. */
export function moved(curve: CurveMove | undefined, x: number, y: number): [number, number] {
  if (!curve) return [x, y];
  const dx = x - curve.pivotX, dy = y - curve.pivotY, cos = Math.cos(curve.angle), sin = Math.sin(curve.angle);
  return [curve.x + dx * cos - dy * sin, curve.y + dx * sin + dy * cos];
}

export function placeText(spec: Pick<TextSpec, "content" | "curve">, layout: TextLayout): Placement {
  const words = wordSpans(spec.content);
  const wordOf = (cluster: number): number => {
    let found = 0;
    for (let index = 0; index < words.length; index++) if (words[index].start <= cluster) found = index;
    return found;
  };
  const glyphs: PlacedGlyph[] = [];
  // A unit key per glyph, then numbered by where the unit starts in the text.
  const keys: string[] = [], first = new Map<string, number>();
  layout.lines.forEach((line, lineIndex) => {
    for (const run of line.runs) for (const glyph of run.glyphs) {
      const word = wordOf(glyph.cluster);
      const inWord = words[word] && glyph.cluster >= words[word].start && glyph.cluster < words[word].end;
      const key = inWord && words[word].joined ? `w${word}` : `c${glyph.cluster}`;
      keys.push(key);
      first.set(key, Math.min(first.get(key) ?? Number.MAX_SAFE_INTEGER, glyph.cluster));
      glyphs.push({ fontId: run.fontId, glyph, line: lineIndex, character: 0, word });
    }
  });
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
  const index = new Map(order.map((key, at) => [key, at]));
  const boxes: Record<UnitKind, Box[]> = { character: [], word: [], line: [] };
  glyphs.forEach((placed, at) => {
    placed.character = index.get(keys[at])!;
    const line = layout.lines[placed.line];
    const box = { x0: placed.glyph.x, x1: placed.glyph.x + placed.glyph.advance, y0: line.baseline - line.ascent, y1: line.baseline + line.descent };
    boxes.character[placed.character] = grow(boxes.character[placed.character], box);
    boxes.word[placed.word] = grow(boxes.word[placed.word], box);
    boxes.line[placed.line] = grow(boxes.line[placed.line], box);
  });
  layout.lines.forEach((line, at) => { boxes.line[at] ??= { x0: line.x, x1: line.x + line.width, y0: line.baseline - line.ascent, y1: line.baseline + line.descent }; });
  let bounds = { x: 0, y: 0, width: layout.width, height: layout.height };
  const degrees = Math.min(Math.max(spec.curve ?? 0, -360), 360);
  if (degrees !== 0 && layout.lines.length > 0 && layout.width > 0) {
    // Every line lies on an arc about one centre; the first line's baseline has the radius that makes the block
    // width subtend the curve angle, and the lines below it are a line height nearer to (or farther from) the centre.
    const theta = (Math.abs(degrees) * Math.PI) / 180, radius = layout.width / theta, up = degrees > 0;
    const centreX = layout.width / 2, firstBaseline = layout.lines[0].baseline;
    const centreY = up ? firstBaseline + radius : firstBaseline - radius;
    let box: Box | undefined;
    for (const placed of glyphs) {
      const unit = boxes.character[placed.character], baseline = layout.lines[placed.line].baseline;
      const lineRadius = Math.max(up ? radius - (baseline - firstBaseline) : radius + (baseline - firstBaseline), 1e-3);
      const pivotX = (unit.x0 + unit.x1) / 2, angle = (pivotX - centreX) / lineRadius;
      placed.curve = up ? { pivotX, pivotY: baseline, x: centreX + lineRadius * Math.sin(angle), y: centreY - lineRadius * Math.cos(angle), angle }
        : { pivotX, pivotY: baseline, x: centreX + lineRadius * Math.sin(angle), y: centreY + lineRadius * Math.cos(angle), angle: -angle };
      for (const [x, y] of [[unit.x0, unit.y0], [unit.x1, unit.y0], [unit.x0, unit.y1], [unit.x1, unit.y1]]) {
        const [px, py] = moved(placed.curve, x, y);
        box = grow(box, { x0: px, y0: py, x1: px, y1: py });
      }
    }
    if (box) bounds = { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
  }
  return { glyphs, counts: { character: order.length, word: Math.max(words.length, 1), line: layout.lines.length }, boxes, bounds };
}

/** Kept for callers that want the decoded text of a cluster range. */
export const clusterText = (content: string, start: number, end: number): string => decoder.decode(encoder.encode(content).subarray(start, end));
