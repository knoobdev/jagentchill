/**
 * The part of a long list that is mounted: the rows that cross the viewport plus a margin above and below it. The rows
 * outside are not mounted at all — two spacers stand for them, as tall as those rows are (measured when they were
 * mounted, estimated until then). Pure: the screen measures and scrolls, this only says which rows and how tall the spacers.
 */
export type ListWindow = { first: number; /** One past the last mounted row. */ end: number; /** Height of the spacer above / below the mounted rows. */ before: number; after: number; total: number };

/** A prepend at physical top reveals the older rows; elsewhere it keeps the reader's existing window in place. */
export function listWindowPrependShift(scrollTop: number | null, _hasOlder: boolean, shift: number): number {
  return scrollTop !== null && scrollTop <= 1 ? 0 : Math.max(0, shift);
}

export function listWindow(input: {
  /** The rows' keys, top to bottom. */ keys: readonly string[];
  /** Measured heights by key. */ heights: ReadonlyMap<string, number>;
  /** The height taken for a row that was never measured. */ estimate: number;
  /** The gap between two rows. */ gap?: number;
  scrollTop: number; viewport: number;
  /** How far beyond the viewport rows stay mounted, above and below. */ overscan: number;
  /** Rows that stay mounted wherever they are (the row that holds the focus, the newest row while it is written). */ keep?: ReadonlySet<string>;
}): ListWindow {
  const { keys, heights, estimate, scrollTop, viewport, overscan } = input, gap = input.gap ?? 0;
  const from = scrollTop - overscan, to = scrollTop + viewport + overscan;
  let top = 0, first = -1, end = -1, before = 0;
  const tops: number[] = new Array(keys.length);
  for (let index = 0; index < keys.length; index++) {
    const height = heights.get(keys[index]!) ?? estimate;
    tops[index] = top;
    const bottom = top + height;
    const inside = (bottom >= from && top <= to) || input.keep?.has(keys[index]!) === true;
    if (inside) { if (first === -1) { first = index; before = top; } end = index + 1; }
    top = bottom + gap;
  }
  const total = Math.max(0, top - gap);
  if (first === -1) {
    // Nothing crosses the viewport (the list is shorter than the scroll offset says, or empty): the last rows are shown.
    if (!keys.length) return { first: 0, end: 0, before: 0, after: 0, total: 0 };
    let index = keys.length - 1, covered = 0;
    while (index > 0 && covered < viewport + overscan) { covered += (heights.get(keys[index]!) ?? estimate) + gap; index -= 1; }
    return { first: index, end: keys.length, before: tops[index]!, after: 0, total };
  }
  const lastBottom = tops[end - 1]! + (heights.get(keys[end - 1]!) ?? estimate);
  return { first, end, before, after: Math.max(0, total - lastBottom), total };
}

/** Where a row starts, by the heights known now: what a jump to that row scrolls to. */
export function rowTop(keys: readonly string[], heights: ReadonlyMap<string, number>, estimate: number, key: string, gap = 0): number | null {
  let top = 0;
  for (const entry of keys) { if (entry === key) return top; top += (heights.get(entry) ?? estimate) + gap; }
  return null;
}
