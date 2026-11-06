import { View } from "react-native";
import { setShapeParams, timeline } from "@jagentchill/editor-core";
import { animatablePath, GRAPHIC_PARAM_KEYS, type GraphicDefinitionId, type GraphicParamKey } from "@jagentchill/protocol";
import { ColorPicker, NumberField, Select, Slider, Switch } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useBrandColors } from "../../templates/brand-store";
import { useEditor, useHeldTransport } from "../context";
import { KeyToggle } from "./keys";
import { objectOf, Row, Section, shownAt, writePath } from "./parts";

type El = timeline.El;
const NUMBERS: Partial<Record<GraphicParamKey, { label: string; min: number; max: number; fallback: number }>> = {
  strokeWidth: { label: "Stroke width", min: 0, max: 64, fallback: 0 }, cornerRadius: { label: "Corner radius", min: 0, max: 50, fallback: 0 }, sides: { label: "Sides", min: 3, max: 12, fallback: 5 },
  points: { label: "Points", min: 3, max: 12, fallback: 5 }, depth: { label: "Depth", min: 1, max: 99, fallback: 45 }, dash: { label: "Dash", min: 0, max: 200, fallback: 0 },
  headSize: { label: "Head size", min: 10, max: 90, fallback: 40 }, shaftWidth: { label: "Shaft width", min: 5, max: 90, fallback: 30 },
};
/** The Shape section of a graphic element: the parameters its definition has — fill, stroke, and the geometry of a rectangle, polygon, star, line or arrow; a drawing has its colour override. Numbers and colours carry a keyframe toggle. */
export function ShapeInspector(props: { element: El }) {
  const t = useT();
  const brand = useBrandColors();
  const runtime = useEditor();
  const playhead = useHeldTransport().time;
  const { element } = props, definition = String(element.definitionId) as GraphicDefinitionId, keys = GRAPHIC_PARAM_KEYS[definition] ?? [], params = objectOf(element.params), line = definition === "line";
  const key = (param: string, value: number | string, label: string) => (animatablePath(element as never, `params.${param}`) ? <KeyToggle element={element} path={`params.${param}`} value={value} label={t(label)} playhead={playhead} testID={`kf-params.${param}`} /> : null);
  const keyed = (param: string) => ((objectOf(objectOf(element.animations)[`params.${param}`]).keys as unknown[] | undefined) ?? []).length > 0;
  /** A keyframed parameter takes the value as the key under the playhead; a plain one is stored through the shape's own operation, which coerces it. */
  const put = (param: GraphicParamKey, value: number | string, label: string, live = false) => (keyed(param) ? writePath(runtime, element, `params.${param}`, value, label, live) : write({ [param]: value }, live));
  const write = (change: Partial<Record<GraphicParamKey, unknown>>, live = false) => runtime.controller.external((doc, ctx) => setShapeParams(doc, ctx, [element.id], change), live);
  const colour = (param: "fill" | "stroke", label: string, fallback: string) => {
    if (!keys.includes(param)) return null;
    const shown = shownAt(element, `params.${param}`, String(params[param] ?? fallback), playhead);
    return <Row label={t(label)} testID={`shape-${param}`}><View style={{ flex: 1 }}><ColorPicker brandColors={brand} label={t(label)} value={shown.toUpperCase()} defaultValue={fallback.toUpperCase()} onChange={(next) => put(param, next.toLowerCase(), label, true)} onCommit={(next) => { put(param, next.toLowerCase(), label); }} /></View>{key(param, shown, label)}</Row>;
  };
  if (definition === "drawing") {
    const override = String(params.colorOverride ?? "");
    return (
      <Section id="shape" title={t("Drawing")} testID="drawing-inspector">
        <Row label={t("Override")}><View testID="drawing-override"><Switch accessibilityLabel={t("Colour override")} value={override !== ""} onChange={(on) => { write({ colorOverride: on ? "#ffffff" : "" }); }} /></View></Row>
        {override !== "" ? <Row label={t("Colour")}><View style={{ flex: 1 }}><ColorPicker label={t("Colour override")} value={override.toUpperCase()} defaultValue="#FFFFFF" onChange={(next) => write({ colorOverride: next.toLowerCase() }, true)} onCommit={(next) => { write({ colorOverride: next.toLowerCase() }); }} /></View></Row> : null}
      </Section>
    );
  }
  return (
    <Section id="shape" title={t("Shape")} testID="shape-inspector">
      {colour("fill", "Fill", "#ffffff")}
      {colour("stroke", "Stroke", line ? "#ffffff" : "#000000")}
      {(Object.keys(NUMBERS) as GraphicParamKey[]).filter((param) => keys.includes(param)).map((param) => {
        // A line always has a stroke: 1–64, 8 by default.
        const base = NUMBERS[param]!, row = line && param === "strokeWidth" ? { ...base, min: 1, fallback: 8 } : base, value = shownAt(element, `params.${param}`, Number(params[param] ?? row.fallback), playhead);
        return (
          <Row key={param} label={t(row.label)} testID={`shape-${param}`}>
            <View style={{ flex: 1 }}><Slider label={t(row.label)} min={row.min} max={row.max} step={1} value={value} defaultValue={row.fallback} onChange={(next) => put(param, next as number, row.label, true)} onCommit={(next) => { put(param, next as number, row.label); }} /></View>
            <NumberField label={t(row.label)} hideLabel size="sm" width={64} min={row.min} max={row.max} step={1} value={Math.round(value)} onCommit={(next) => { put(param, next, row.label); }} />
            {key(param, value, row.label)}
          </Row>
        );
      })}
      {keys.includes("lineCap") ? <Row label={t("Line cap")}><View style={{ flex: 1 }} testID="shape-lineCap"><Select label={t("Line cap")} size="sm" value={String(params.lineCap ?? "round")} options={[{ value: "butt", label: t("Butt") }, { value: "round", label: t("Round") }, { value: "square", label: t("Square") }]} onChange={(next) => write({ lineCap: next })} /></View></Row> : null}
      {keys.includes("doubleHeaded") ? <Row label={t("Two heads")}><View testID="shape-doubleHeaded"><Switch accessibilityLabel={t("Double-headed")} value={params.doubleHeaded === true} onChange={(on) => { write({ doubleHeaded: on }); }} /></View></Row> : null}
      {keys.includes("strokeAlign") ? <Row label={t("Stroke align")}><View style={{ flex: 1 }}><Select label={t("Stroke align")} size="sm" value={String(params.strokeAlign ?? "center")} options={[{ value: "inside", label: t("Inside") }, { value: "center", label: t("Center") }, { value: "outside", label: t("Outside") }]} onChange={(next) => write({ strokeAlign: next })} /></View></Row> : null}
    </Section>
  );
}
