/** Navigation and filtering shared by menus, listboxes, tabs, trees and breadcrumbs. */

/** Case- and diacritic-insensitive form of a label: "Tiếng Việt" → "tieng viet". */
export const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
export const matches = (label: string, query: string) => fold(label).includes(fold(query.trim()));
export function filterOptions<T extends { label: string }>(options: readonly T[], query: string): T[] {
  return query.trim() === "" ? [...options] : options.filter((option) => matches(option.label, query));
}
/** Lists longer than this are windowed: only the rows near the viewport are mounted. */
export const VIRTUALISE = { options: 50, rows: 100, tree: 200 } as const;
/** Index range of the rows to mount for a scroll offset, with `overscan` rows on each side. */
export function windowOf(count: number, rowHeight: number, scrollTop: number, viewportHeight: number, overscan = 6): { from: number; to: number; before: number; after: number } {
  const from = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const to = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { from, to, before: from * rowHeight, after: (count - to) * rowHeight };
}

/** Next focus index for Down/Up/Home/End over the enabled indexes of a list. */
export function moveIndex(current: number, key: string, count: number, options: { wrap?: boolean; skip?(index: number): boolean; horizontal?: boolean; rtl?: boolean } = {}): number | null {
  if (count === 0) return null;
  const forward = options.horizontal ? (options.rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
  const backward = options.horizontal ? (options.rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
  const step = key === forward ? 1 : key === backward ? -1 : 0;
  const usable = (index: number) => !options.skip?.(index);
  if (key === "Home" || key === "End") {
    const order = Array.from({ length: count }, (_, i) => (key === "Home" ? i : count - 1 - i));
    return order.find(usable) ?? null;
  }
  if (step === 0) return null;
  let index = current;
  for (let tries = 0; tries < count; tries++) {
    index += step;
    if (index < 0 || index >= count) { if (!options.wrap) return current < 0 ? null : current; index = (index + count) % count; }
    if (usable(index)) return index;
  }
  return current;
}
/** Type-ahead: the next label after `current` that starts with the typed characters. */
export function typeAhead(labels: readonly string[], typed: string, current: number): number | null {
  const query = fold(typed);
  if (!query) return null;
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (current + offset + labels.length) % labels.length;
    if (fold(labels[index]!).startsWith(query)) return index;
  }
  return null;
}
/** Characters typed within 500 ms accumulate into one type-ahead query. */
export function typeAheadBuffer(now: () => number = Date.now) {
  let text = "", at = 0;
  return { push(char: string) { const time = now(); text = time - at > 500 ? char : text + char; at = time; return text; } };
}

export const BREADCRUMB = { maxSegments: 5, maxChars: 24, chevron: 12 } as const;
/**
 * Which breadcrumb segments are shown: all when they fit; otherwise the first, a "…" menu with the hidden middle ones and
 * the current page. On compact form factors only the parent is shown, as a back control.
 */
export function collapseBreadcrumb(widths: readonly number[], available: number, extras: { separator: number; ellipsis: number }): { visible: number[]; hidden: number[] } {
  const all = widths.map((_, index) => index);
  const total = (indexes: number[], withEllipsis: boolean) =>
    indexes.reduce((sum, index) => sum + widths[index]!, 0) + (indexes.length - 1 + (withEllipsis ? 1 : 0)) * extras.separator + (withEllipsis ? extras.ellipsis : 0);
  if (widths.length <= 2 || total(all, false) <= available) return { visible: all, hidden: [] };
  // Segments return from the end backwards, so the nearest ancestors stay visible longest.
  const last = widths.length - 1;
  let visible = [0, last];
  for (let index = last - 1; index >= 1; index--) {
    const candidate = [0, ...all.slice(index, last), last];
    if (total(candidate, true) <= available) visible = candidate; else break;
  }
  return { visible, hidden: all.filter((index) => !visible.includes(index)) };
}

/** Sort cycle of a table column: ascending, descending, none. */
export type SortDirection = "ascending" | "descending" | "none";
export const nextSort = (direction: SortDirection): SortDirection => (direction === "none" ? "ascending" : direction === "ascending" ? "descending" : "none");
/** Header checkbox of a selectable list: unchecked, indeterminate or checked; activating it selects all unless all are selected. */
export function bulkState(selected: number, total: number): "none" | "some" | "all" {
  return selected === 0 ? "none" : selected >= total ? "all" : "some";
}
export const toggleAll = <K>(selected: ReadonlySet<K>, all: readonly K[]): Set<K> => (selected.size >= all.length && all.length > 0 ? new Set() : new Set(all));

/** Tree rows. */
export type TreeNode = { id: string; label: string; children?: TreeNode[]; hasChildren?: boolean };
export type TreeRow = { node: TreeNode; depth: number; parent: string | null; expandable: boolean; expanded: boolean };
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, depth = 0, parent: string | null = null): TreeRow[] {
  return nodes.flatMap((node) => {
    const expandable = Boolean(node.children?.length || node.hasChildren);
    const open = expandable && expanded.has(node.id);
    return [{ node, depth, parent, expandable, expanded: open }, ...(open && node.children ? flattenTree(node.children, expanded, depth + 1, node.id) : [])];
  });
}
/** WAI-ARIA tree keyboard pattern. Returns the row to focus and the expansion change, if any. */
export function treeKey(rows: readonly TreeRow[], focused: number, key: string, rtl = false): { focus: number; expand?: string[]; collapse?: string } | null {
  const row = rows[focused];
  if (!row) return null;
  const open = rtl ? "ArrowLeft" : "ArrowRight", close = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === open) {
    if (row.expandable && !row.expanded) return { focus: focused, expand: [row.node.id] };
    return row.expanded && rows[focused + 1]?.parent === row.node.id ? { focus: focused + 1 } : { focus: focused };
  }
  if (key === close) {
    if (row.expanded) return { focus: focused, collapse: row.node.id };
    const parent = rows.findIndex((item) => item.node.id === row.parent);
    return { focus: parent >= 0 ? parent : focused };
  }
  if (key === "*") return { focus: focused, expand: rows.filter((item) => item.parent === row.parent && item.expandable).map((item) => item.node.id) };
  const next = moveIndex(focused, key, rows.length);
  return next === null ? null : { focus: next };
}
/** Selection of a tree or list: plain press selects one, Ctrl/Cmd toggles, Shift selects the range from the anchor. */
export function selectWith(ids: readonly string[], selected: ReadonlySet<string>, anchor: string | null, id: string, modifiers: { toggle?: boolean; range?: boolean }, multiple: boolean): { selected: Set<string>; anchor: string } {
  if (!multiple || (!modifiers.toggle && !modifiers.range)) return { selected: new Set([id]), anchor: id };
  if (modifiers.range && anchor !== null) {
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)];
    return { selected: new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)), anchor };
  }
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return { selected: next, anchor: id };
}
/** A node cannot be dropped onto itself or one of its own descendants. */
export function canDrop(nodes: readonly TreeNode[], dragged: string, target: string): boolean {
  if (dragged === target) return false;
  const find = (list: readonly TreeNode[], id: string): TreeNode | null => {
    for (const node of list) { if (node.id === id) return node; const inner = find(node.children ?? [], id); if (inner) return inner; }
    return null;
  };
  const source = find(nodes, dragged);
  return source !== null && find(source.children ?? [], target) === null;
}
