import { useState, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Defs, Line, Path, Pattern, Polyline, Rect } from "react-native-svg";
import { Button } from "./button.tsx";
import { SPARKLINE, axisTicks, chartColor, chartTable, groupSeries, sparklinePoints, type Series } from "./logic/content.ts";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, radius, size, space, type ColorToken } from "./tokens.ts";

export type { Series };
export type ChartProps = {
  /** Accessible name of the chart. */
  label: string; categories: string[]; series: Series[]; height?: number; width?: number;
  /** Shown centred in the plot area, with no axes, when there is no data. */
  emptyMessage: string; formatValue?(value: number): string;
};
type Kind = "bar" | "stacked" | "horizontal" | "line";
// Series are told apart by a pattern as well as by colour: every second series is hatched, and lines alternate dash patterns.
const DASHES = [undefined, "6 3", "2 3", "8 3 2 3"] as const;

/** The legend: one entry per series, a swatch in the series colour and its direct label. */
function Legend(props: { series: Series[]; kind: Kind }) {
  const theme = useTheme();
  return (
    <View role="list" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
      {props.series.map((item, index) => (
        <View key={item.name} role="listitem" style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
          <View style={{ width: size.legendSwatch, height: size.legendSwatch, borderRadius: props.kind === "line" ? radius.full : radius.none, backgroundColor: theme.color(chartColor(index)), borderWidth: index % 2 ? borderWidth.hairline : 0, borderColor: theme.color("text/primary") }} />
          <Text variant="caption" color="chart/axis-text">{item.name}</Text>
        </View>
      ))}
    </View>
  );
}

function Chart(props: ChartProps & { kind: Kind }) {
  const theme = useTheme();
  const [table, setTable] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);
  const [measured, setMeasured] = useState(props.width ?? 0);
  const series = groupSeries(props.series, theme.t("other"));
  const format = props.formatValue ?? ((value: number) => value.toLocaleString(theme.locale));
  const height = props.height ?? size.chartHeight;
  const empty = series.length === 0 || props.categories.length === 0 || series.every((item) => item.values.every((value) => !value));
  const data = chartTable(props.categories, series);
  const toggle = <Button size="xs" kind="ghost" label={theme.t(table ? "viewAsChart" : "viewAsTable")} pressed={table} onPress={() => setTable((value) => !value)} />;
  if (empty) {
    return <View accessible accessibilityLabel={`${props.label}: ${props.emptyMessage}`} style={{ height, alignItems: "center", justifyContent: "center" }}><Text color="text/secondary">{props.emptyMessage}</Text></View>;
  }
  if (table) {
    return (
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>{toggle}</View>
        <View role={"table" as "list"} aria-label={props.label} accessibilityLabel={props.label}>
          <View role="row" style={{ flexDirection: "row", minHeight: size.tableHeader, alignItems: "center", backgroundColor: theme.color("bg/sidebar") }}>
            <View role="columnheader" style={{ flex: 1, paddingHorizontal: space[3] }}><Text variant="meta" color="text/secondary">{" "}</Text></View>
            {data.columns.map((column) => <View key={column} role="columnheader" style={{ flex: 1, paddingHorizontal: space[3], alignItems: "flex-end" }}><Text variant="meta" color="text/secondary">{column}</Text></View>)}
          </View>
          {data.rows.map((row) => (
            <View key={row.category} role="row" style={{ flexDirection: "row", minHeight: size.tableRowDense, alignItems: "center", borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
              <View role="cell" style={{ flex: 1, paddingHorizontal: space[3] }}><Text>{row.category}</Text></View>
              {row.values.map((value, index) => <View key={index} role="cell" style={{ flex: 1, paddingHorizontal: space[3], alignItems: "flex-end" }}><Text tabular>{format(value)}</Text></View>)}
            </View>
          ))}
        </View>
      </View>
    );
  }
  const stacked = props.kind === "stacked";
  const totals = props.categories.map((_, i) => series.reduce((sum, item) => sum + (item.values[i] ?? 0), 0));
  const top = stacked ? Math.max(...totals) : Math.max(...series.flatMap((item) => item.values));
  const ticks = axisTicks(top);
  const max = ticks.at(-1) || 1;
  const horizontal = props.kind === "horizontal";
  const axis = space[10];
  const plot = Math.max(0, measured - axis);
  const band = (horizontal ? height : plot) / props.categories.length;
  const gap = size.chartBarGap;
  const colour = (index: number) => theme.color(chartColor(index));
  const fill = (index: number) => (index % 2 ? `url(#hatch-${index})` : colour(index));
  const marks: ReactNode[] = [];
  if (props.kind === "line") {
    series.forEach((item, index) => {
      const points = item.values.map((value, i) => `${band * i + band / 2},${height - (value / max) * height}`).join(" ");
      marks.push(<Polyline key={item.name} points={points} fill="none" stroke={colour(index)} strokeWidth={2} strokeDasharray={DASHES[index % DASHES.length]} />);
    });
  } else {
    props.categories.forEach((category, i) => {
      let offset = 0;
      const inner = Math.max(0, stacked ? band - 2 * gap : (band - 2 * gap) / series.length);
      series.forEach((item, index) => {
        const value = item.values[i] ?? 0;
        const length = Math.max(0, (value / max) * (horizontal ? plot : height));
        const across = band * i + gap + (stacked ? 0 : inner * index);
        marks.push(horizontal
          ? <Rect key={`${category}-${item.name}`} x={stacked ? offset : 0} y={across} width={length} height={inner} fill={fill(index)} />
          : <Rect key={`${category}-${item.name}`} x={across} y={height - length - (stacked ? offset : 0)} width={inner} height={length} fill={fill(index)} />);
        if (stacked) offset += length;
      });
    });
  }
  const tip = focused === null ? null : (
    <View pointerEvents="none" role="tooltip" style={[{ position: "absolute", top: 0, start: horizontal ? axis + space[2] : Math.min(Math.max(0, plot - size.sliderMin * 4), axis + band * focused), backgroundColor: theme.color("strong"), borderRadius: radius.sm, paddingVertical: space[1], paddingHorizontal: space[2] }, theme.elevation(2), { borderWidth: 0 }]}>
      <Text variant="meta" color="text/on-strong" style={{ fontWeight: "500" }}>{props.categories[focused]}</Text>
      {series.map((item) => <Text key={item.name} variant="meta" color="text/on-strong" tabular>{`${item.name}: ${format(item.values[focused] ?? 0)}`}</Text>)}
    </View>
  );
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><View style={{ flex: 1 }}><Legend series={series} kind={props.kind} /></View>{toggle}</View>
      <View onLayout={(event) => setMeasured(event.nativeEvent.layout.width)} accessibilityLabel={props.label} aria-label={props.label} role={"group" as "none"} style={{ flexDirection: "row", height: height + space[5] }}>
        <View style={{ width: axis, height, justifyContent: "space-between", alignItems: "flex-end", paddingEnd: space[1.5] }}>
          {horizontal
            ? props.categories.map((category) => <View key={category} style={{ height: band, justifyContent: "center" }}><Text variant="caption" color="chart/axis-text" numberOfLines={1}>{category}</Text></View>)
            : [...ticks].reverse().map((tick) => <Text key={tick} variant="caption" color="chart/axis-text" tabular>{format(tick)}</Text>)}
        </View>
        <View style={{ flex: 1 }}>
          <Svg width={plot} height={height}>
            <Defs>
              {series.map((_, index) => (index % 2 ? (
                <Pattern key={index} id={`hatch-${index}`} patternUnits="userSpaceOnUse" width={4} height={4}>
                  <Rect width={4} height={4} fill={colour(index)} /><Path d="M0 4L4 0" stroke={theme.color("bg/app")} strokeWidth={1} />
                </Pattern>
              ) : null))}
            </Defs>
            {ticks.map((tick) => (horizontal
              ? <Line key={tick} x1={(tick / max) * plot} x2={(tick / max) * plot} y1={0} y2={height} stroke={theme.color("chart/grid")} strokeWidth={1} />
              : <Line key={tick} x1={0} x2={plot} y1={height - (tick / max) * height} y2={height - (tick / max) * height} stroke={theme.color("chart/grid")} strokeWidth={1} />))}
            {marks}
          </Svg>
          {/* One focusable column per position: hover or keyboard focus lists every series value there. */}
          <View style={{ position: "absolute", top: 0, start: 0, width: plot, height, flexDirection: horizontal ? "column" : "row" }}>
            {props.categories.map((category, i) => (
              <Tap key={category} label={`${category}: ${series.map((item) => `${item.name} ${format(item.values[i] ?? 0)}`).join(", ")}`} noRing onPress={() => setFocused(i)}
                onHoverIn={() => setFocused(i)} onHoverOut={() => setFocused((current) => (current === i ? null : current))} onFocus={() => setFocused(i)} onBlur={() => setFocused((current) => (current === i ? null : current))}
                style={(state) => ({ flex: 1, borderWidth: borderWidth.focus, borderColor: state.focused ? theme.color("accent") : "transparent" })} />
            ))}
          </View>
          {horizontal
            ? <View style={{ flexDirection: "row", justifyContent: "space-between", width: plot }}>{ticks.map((tick) => <Text key={tick} variant="caption" color="chart/axis-text" tabular>{format(tick)}</Text>)}</View>
            : <View style={{ flexDirection: "row", width: plot }}>{props.categories.map((category) => <View key={category} style={{ flex: 1, alignItems: "center" }}><Text variant="caption" color="chart/axis-text" numberOfLines={1}>{category}</Text></View>)}</View>}
        </View>
        {tip}
      </View>
    </View>
  );
}

/** A vertical bar chart, plain or stacked. */
export function BarChart(props: ChartProps & { stacked?: boolean }) { return <Chart {...props} kind={props.stacked ? "stacked" : "bar"} />; }
/** A horizontal bar chart. */
export function HorizontalBarChart(props: ChartProps & { stacked?: boolean }) { return <Chart {...props} kind="horizontal" />; }
/** A line chart. */
export function LineChart(props: ChartProps) { return <Chart {...props} kind="line" />; }

/**
 * A single-series strip 16–32 px tall and 48–160 px wide with no axes, legend or tooltip, drawn with a 1.5 px stroke. It is
 * never the only carrier of its data: `summary` is its accessible name and the caller shows the latest value as text beside it.
 */
export function Sparkline(props: { values: number[]; summary: string; width?: number; height?: number; kind?: "line" | "bar"; tone?: ColorToken }) {
  const theme = useTheme();
  const width = Math.max(SPARKLINE.minWidth, Math.min(SPARKLINE.maxWidth, props.width ?? 96));
  const height = Math.max(SPARKLINE.minHeight, Math.min(SPARKLINE.maxHeight, props.height ?? SPARKLINE.minHeight));
  const colour = theme.color(props.tone ?? "chart/1");
  const high = Math.max(1, ...props.values);
  const bar = width / Math.max(1, props.values.length);
  return (
    <View accessible accessibilityRole="image" role="img" accessibilityLabel={props.summary} aria-label={props.summary} style={{ width, height, flexShrink: 0 }}>
      <Svg width={width} height={height}>
        {props.kind === "bar"
          ? props.values.map((value, index) => <Rect key={index} x={index * bar + 0.5} y={height - Math.max(1, (value / high) * height)} width={Math.max(1, bar - 1)} height={Math.max(1, (value / high) * height)} fill={colour} />)
          : <Polyline points={sparklinePoints(props.values, width, height).map((point) => point.join(",")).join(" ")} fill="none" stroke={colour} strokeWidth={size.sparklineStroke} strokeLinejoin="round" strokeLinecap="round" />}
      </Svg>
    </View>
  );
}
