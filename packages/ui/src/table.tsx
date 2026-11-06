import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, ScrollView, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Button, IconButton } from "./button.tsx";
import { dragHandle } from "./draghandle.ts";
import { EmptyState, ErrorState, NoResultsState, type EmptyAction, type ErrorInfo } from "./empty.tsx";
import { bulkState, nextSort, toggleAll, type SortDirection } from "./logic/lists.ts";
import { Menu, type MenuItem } from "./menu.tsx";
import { Skeleton } from "./progress.tsx";
import { LoadingSkeleton } from "./skeletons.tsx";
import { SearchField } from "./search.tsx";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { Checkbox } from "./toggles.tsx";
import { borderWidth, radius, size, space } from "./tokens.ts";

export type Column<R> = {
  id: string; title: string; width?: number; flex?: number; numeric?: boolean; sortable?: boolean; mono?: boolean;
  /** Text of the cell, also used on compact form factors as the value of a label–value line. */
  text(row: R): string; render?(row: R): ReactNode;
};
export type TableSort = { column: string; direction: SortDirection };
export type TableProps<R> = {
  label: string; columns: Array<Column<R>>; rows: R[]; rowKey(row: R): string; dense?: boolean;
  sort?: TableSort; onSort?(sort: TableSort): void;
  selection?: ReadonlySet<string>; onSelectionChange?(selection: Set<string>): void;
  /** Actions of the bar that replaces the toolbar while a selection exists. */
  bulkActions?: Array<{ label: string; onPress(keys: string[]): void; danger?: boolean }>;
  rowMenu?(row: R): MenuItem[]; onRowPress?(row: R): void;
  search?: { value: string; onChange(value: string): void; placeholder?: string; label: string }; toolbar?: ReactNode;
  loading?: boolean; error?: { title: string; info: ErrorInfo; resolve(code: string): string | undefined | null; onRetry(): void };
  empty?: { icon: IconName; title: string; description?: string; action?: EmptyAction };
  /** Pagination, or infinite scrolling with a 200 px threshold. */
  page?: { index: number; count: number; onChange(index: number): void }; onEndReached?(): void; maxHeight?: number;
  resizable?: boolean;
};

/**
 * A table: a 32 px `bg/sidebar` header and body rows of 36 px (dense) or 44 px separated by hairlines, with sorting, resizable
 * columns on desktop, a sticky header, selection with a bulk-action bar, a row ⋯ menu, a toolbar, and loading, error and
 * empty states. On compact form factors each row is a stacked card.
 */
export function Table<R>(props: TableProps<R>) {
  const theme = useTheme();
  const keys = props.rows.map(props.rowKey);
  const selection = props.selection ?? new Set<string>();
  const selectable = Boolean(props.onSelectionChange);
  const bulk = bulkState(keys.filter((key) => selection.has(key)).length, keys.length);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{ key: string; items: MenuItem[] } | null>(null);
  const menuAnchors = useRef(new Map<string, View | null>());
  const rowHeight = props.dense ? size.tableRowDense : size.tableRow;
  const line = { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") };
  const cell = (column: Column<R>) => ({ width: widths[column.id] ?? column.width, flex: widths[column.id] ?? column.width ? undefined : column.flex ?? 1, minWidth: 0, paddingHorizontal: space[3] });
  const toggleRow = (key: string) => { const next = new Set(selection); if (next.has(key)) next.delete(key); else next.add(key); props.onSelectionChange?.(next); };

  const toolbar = selection.size > 0 && selectable ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.tableHeader, paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), marginBottom: space[2] }}>
      <Text variant="body-medium" live="polite" style={{ flex: 1 }}>{theme.t("selected", { n: selection.size })}</Text>
      {props.bulkActions?.map((action) => <Button key={action.label} size="sm" kind="ghost" tone={action.danger ? "danger" : undefined} label={action.label} onPress={() => action.onPress([...selection])} />)}
      <Button size="sm" kind="ghost" label={theme.t("clear")} onPress={() => props.onSelectionChange?.(new Set())} />
    </View>
  ) : props.search || props.toolbar ? (
    <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2], marginBottom: space[2] }}>
      {props.search ? <View style={theme.compact ? { width: "100%" } : { flex: 1 }}><SearchField label={props.search.label} value={props.search.value} onChangeText={props.search.onChange} placeholder={props.search.placeholder} /></View> : <View style={{ flex: 1 }} />}
      {props.toolbar}
    </View>
  ) : null;

  let body: ReactNode;
  if (props.error) body = <ErrorState title={props.error.title} error={props.error.info} resolve={props.error.resolve} onRetry={props.error.onRetry} />;
  else if (props.loading) {
    // Loading is six skeleton rows in the shape of the table, drawn after 150 ms.
    body = <LoadingSkeleton>{Array.from({ length: 6 }, (_, index) => (
      <View key={index} aria-hidden style={[{ flexDirection: "row", alignItems: "center", height: rowHeight }, line]}>
        {selectable ? <View style={{ width: size.tableCheck }} /> : null}
        {props.columns.map((column) => <View key={column.id} style={cell(column)}><Skeleton width={`${50 + ((index * 17 + column.id.length * 11) % 40)}%`} height={space[2] + space[0.5]} /></View>)}
      </View>
    ))}</LoadingSkeleton>;
  } else if (props.rows.length === 0) {
    body = props.search?.value
      ? <NoResultsState query={props.search.value} onClear={() => props.search!.onChange("")} />
      : props.empty ? <EmptyState icon={props.empty.icon} title={props.empty.title} description={props.empty.description} actions={props.empty.action ? [{ kind: "primary", ...props.empty.action }] : undefined} /> : null;
    // A table may own rows only: its empty state is the one cell of one row.
    if (body) body = <View role="row"><View role="cell" style={{ flex: 1 }}>{body}</View></View>;
  } else if (theme.compact) {
    // Stacked cards: the first column is the title and the others are label–value lines.
    const [first, ...rest] = props.columns;
    body = props.rows.map((row) => {
      const key = props.rowKey(row);
      return (
        <View key={key} role="row" style={line}>
         {/* A stacked card is one row with one cell: its lines are the cell's content. */}
         <View role="cell" style={{ paddingVertical: space[3], paddingHorizontal: space[1], gap: space[1] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            {selectable ? <Checkbox checked={selection.has(key)} onChange={() => toggleRow(key)} accessibilityLabel={`${theme.t("selectRow")}: ${first!.text(row)}`} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>{first!.render ? first!.render(row) : <Text variant="body-medium" numberOfLines={1}>{first!.text(row)}</Text>}</View>
            {props.rowMenu ? <IconButton ref={(node) => { menuAnchors.current.set(key, node); }} icon="more" label={theme.t("rowActions")} onPress={() => setMenu({ key, items: props.rowMenu!(row) })} /> : null}
          </View>
          {rest.map((column) => (
            <View key={column.id} style={{ flexDirection: "row", gap: space[2] }}>
              <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{column.title}</Text>
              {column.render ? column.render(row) : <Text variant={column.mono ? "mono" : "meta"} tabular={column.numeric}>{column.text(row)}</Text>}
            </View>
          ))}
         </View>
        </View>
      );
    });
  } else {
    body = props.rows.map((row) => {
      const key = props.rowKey(row);
      const on = selection.has(key);
      const cells = (
        <>
          {selectable ? <View role="cell" style={{ width: size.tableCheck, alignItems: "center" }}><Checkbox checked={on} onChange={() => toggleRow(key)} accessibilityLabel={`${theme.t("selectRow")}: ${props.columns[0]!.text(row)}`} /></View> : null}
          {props.columns.map((column) => (
            <View key={column.id} role="cell" style={[cell(column), column.numeric ? { alignItems: "flex-end" } : null]}>
              {column.render ? column.render(row) : <Text variant={column.mono ? "mono" : "body"} tabular={column.numeric} numberOfLines={1}>{column.text(row)}</Text>}
            </View>
          ))}
          {props.rowMenu ? <View role="cell" style={{ paddingHorizontal: space[1] }}><IconButton ref={(node) => { menuAnchors.current.set(key, node); }} icon="more" size="xs" label={theme.t("rowActions")} onPress={() => setMenu({ key, items: props.rowMenu!(row) })} /></View> : null}
        </>
      );
      const style = [{ flexDirection: "row" as const, alignItems: "center" as const, minHeight: rowHeight, backgroundColor: on ? theme.color("accent/subtle") : "transparent" }, line];
      return props.onRowPress
        ? <Tap key={key} role="row" selected={on} onPress={() => props.onRowPress!(row)} style={(state) => [style, state.hovered && !on ? { backgroundColor: theme.color("bg/hover") } : null]}>{cells}</Tap>
        : <View key={key} role="row" aria-selected={selectable ? on : undefined} style={style}>{cells}</View>;
    });
  }
  const header = theme.compact ? null : (
    <View role="row" style={[{ flexDirection: "row", alignItems: "center", height: size.tableHeader, backgroundColor: theme.color("bg/sidebar") }, line]}>
      {selectable ? (
        <View role="columnheader" style={{ width: size.tableCheck, alignItems: "center" }}>
          <Checkbox checked={bulk === "all"} indeterminate={bulk === "some"} accessibilityLabel={theme.t("selectAll")} onChange={() => props.onSelectionChange?.(bulk === "some" ? new Set(keys) : toggleAll(new Set(keys.filter((key) => selection.has(key))), keys))} />
        </View>
      ) : null}
      {props.columns.map((column) => {
        const direction: SortDirection = props.sort?.column === column.id ? props.sort.direction : "none";
        const title = <Text variant="meta" color="text/secondary" numberOfLines={1}>{column.title}</Text>;
        return (
          <View key={column.id} role="columnheader" aria-sort={column.sortable ? direction : undefined} style={[cell(column), { flexDirection: "row", alignItems: "center", justifyContent: column.numeric ? "flex-end" : "flex-start", height: "100%" }]}>
            {column.sortable && props.onSort ? (
              <Tap role="button" label={theme.t("sortBy", { name: column.title })} onPress={() => props.onSort!({ column: column.id, direction: nextSort(direction) })} style={{ flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.xs }}>
                {title}{direction === "none" ? null : <Icon name={direction === "ascending" ? "arrow-up" : "arrow-d"} size={12} color="text/secondary" />}
              </Tap>
            ) : title}
            {props.resizable !== false && !theme.touch ? <ColumnResizer onResize={(delta) => setWidths((all) => ({ ...all, [column.id]: Math.max(size.sliderMin + space[6], (all[column.id] ?? column.width ?? 160) + delta) }))} /> : null}
          </View>
        );
      })}
      {props.rowMenu ? <View role="columnheader" style={{ width: size.toggleHit + space[2] }} /> : null}
    </View>
  );
  return (
    <View>
      {toolbar}
      {/* The header is the sticky first child of the scrolling region. */}
      <ScrollView role={"table" as "list"} aria-label={props.label} accessibilityLabel={props.label} aria-busy={props.loading || undefined} stickyHeaderIndices={header ? [0] : undefined} style={{ maxHeight: props.maxHeight }} scrollEventThrottle={64}
        onScroll={props.onEndReached ? (event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; if (contentSize.height - contentOffset.y - layoutMeasurement.height < size.scrollThreshold) props.onEndReached!(); } : undefined}>
        {header}
        <View role="rowgroup">{body}</View>
      </ScrollView>
      {props.page && props.page.count > 1 ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space[2], paddingTop: space[2] }}>
          <Text variant="meta" color="text/secondary" tabular>{theme.t("nOfM", { n: props.page.index + 1, m: props.page.count })}</Text>
          <IconButton icon={theme.rtl ? "chev-r" : "chev-l"} size="xs" label={theme.t("back")} disabled={props.page.index === 0} onPress={() => props.page!.onChange(props.page!.index - 1)} />
          <IconButton icon={theme.rtl ? "chev-l" : "chev-r"} size="xs" label={theme.t("more")} disabled={props.page.index >= props.page.count - 1} onPress={() => props.page!.onChange(props.page!.index + 1)} />
        </View>
      ) : null}
      {menu ? <Menu open anchor={{ current: menuAnchors.current.get(menu.key) ?? null }} items={menu.items} label={theme.t("rowActions")} align="end" onClose={() => setMenu(null)} /> : null}
    </View>
  );
}

/** The drag handle at the inline-end edge of a column header. */
function ColumnResizer(props: { onResize(delta: number): void }) {
  const theme = useTheme();
  const latest = useRef(props.onResize);
  latest.current = props.onResize;
  const pan = useMemo(() => { let last = 0; return PanResponder.create({
    onStartShouldSetPanResponder: () => true, onPanResponderGrant: () => { last = 0; },
    onPanResponderMove: (_event, gesture) => { latest.current((gesture.dx - last) * (theme.rtl ? -1 : 1)); last = gesture.dx; },
  }); }, [theme.rtl]);
  return <View {...pan.panHandlers} {...dragHandle("col-resize")} testID="column-resizer" style={{ position: "absolute", end: 0, top: 0, bottom: 0, width: size.splitterHit }} />;
}
