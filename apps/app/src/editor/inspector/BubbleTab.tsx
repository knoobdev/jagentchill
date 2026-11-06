import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { setTextBubble, TEXT_BUBBLE_GROUPS, TEXT_BUBBLES, timeline, type TextBubble } from "@jagentchill/editor-core";
import { animatablePath } from "@jagentchill/protocol";
import { ColorPicker, NumberField, Slider, Switch, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor, useHeldTransport } from "../context";
import { KeyToggle } from "./keys";
import { objectOf, Row, Section, shownAt, writePath } from "./parts";

type El = timeline.El;
/** A bubble drawn from its catalogue path on the 100 × 100 box, in its own colours. */
function BubbleShape(props: { bubble: TextBubble; size: number }) {
  const { bubble } = props;
  return <Svg width={props.size} height={props.size} viewBox="-6 -6 112 112"><Path d={bubble.path} fill={bubble.strokeOnly ? "none" : bubble.color} stroke={bubble.strokeColor} strokeWidth={Math.max(bubble.strokeOnly ? 3 : 0, bubble.strokeWidth)} strokeLinejoin="round" /></Svg>;
}

/** The Bubble sub-tab of a text element: "None" and the 20 bundled bubbles under their groups, then the colours, stroke and flip of the chosen one. */
export function BubbleTab(props: { element: El }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const playhead = useHeldTransport().time;
  const { controller } = runtime, { element } = props, stored = objectOf(element.bubble), current = typeof stored.id === "string" ? stored.id : null;
  const catalogue = TEXT_BUBBLES.find((bubble) => bubble.id === current);
  const pick = (id: string | null, live = false) => controller.external((doc, ctx) => setTextBubble(doc, ctx, element.id, id), live);
  const change = (fields: Record<string, unknown>, live = false) => { if (current) controller.external((doc, ctx) => setTextBubble(doc, ctx, element.id, current, fields), live); };
  const tile = (id: string | null, name: string, bubble?: TextBubble) => (
    <Tap key={id ?? "none"} role="button" label={name} pressedState={current === id} testID={`bubble-${id ?? "none"}`} tooltip={{ label: name }} onPress={() => pick(id)}
      onHoverIn={() => pick(id, true)} onHoverOut={() => controller.discardPreview()} style={{ width: "22%", gap: space[1] }}>
      {(state) => (
        <>
          <View style={{ height: 48, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("qr/tile"), borderWidth: current === id ? 2 : 1, borderColor: theme.color(current === id ? "accent/text" : state.hovered ? "border/strong" : "border/hairline") }}>
            {bubble ? <BubbleShape bubble={bubble} size={38} /> : <Text variant="meta" style={{ color: theme.color("qr/module") }}>—</Text>}
          </View>
          <Text variant="caption" numberOfLines={1}>{name}</Text>
        </>
      )}
    </Tap>
  );
  const colourPath = "bubble.color", colour = shownAt(element, colourPath, String(stored.color ?? catalogue?.color ?? "#ffffff"), playhead);
  return (
    <View testID="bubble-tab">
      <View style={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[2] }}>
        {TEXT_BUBBLE_GROUPS.map((group, index) => (
          <View key={group} style={{ gap: space[1] }}>
            <Text variant="caption" color="text/secondary">{t(group)}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: space[2] }}>
              {index === 0 ? tile(null, t("None")) : null}
              {TEXT_BUBBLES.filter((bubble) => bubble.group === group).map((bubble) => tile(bubble.id, t(bubble.name), bubble))}
            </View>
          </View>
        ))}
      </View>
      {current && catalogue ? (
        <Section id="text-bubble" title={t("Bubble")} testID="bubble-settings">
          <Row label={t("Colour")}>
            <View style={{ flex: 1 }}><ColorPicker label={t("Bubble colour")} value={colour.toUpperCase()} defaultValue={catalogue.color.toUpperCase()} onChange={(next) => writePath(runtime, element, colourPath, next.toLowerCase(), "Bubble", true)} onCommit={(next) => writePath(runtime, element, colourPath, next.toLowerCase(), "Bubble")} /></View>
            {animatablePath(element as never, colourPath) ? <KeyToggle element={element} path={colourPath} value={colour} label={t("Bubble colour")} playhead={playhead} testID="kf-bubble.color" /> : null}
          </Row>
          <Row label={t("Stroke")}><View style={{ flex: 1 }}><ColorPicker label={t("Bubble stroke colour")} value={String(stored.strokeColor ?? catalogue.strokeColor).toUpperCase()} defaultValue={catalogue.strokeColor.toUpperCase()} onChange={(next) => change({ strokeColor: next.toLowerCase() }, true)} onCommit={(next) => change({ strokeColor: next.toLowerCase() })} /></View></Row>
          <Row label={t("Width")} testID="bubble-stroke-width">
            <View style={{ flex: 1 }}><Slider label={t("Bubble stroke width")} min={0} max={20} step={0.5} value={Number(stored.strokeWidth ?? catalogue.strokeWidth)} defaultValue={catalogue.strokeWidth} onChange={(next) => change({ strokeWidth: next as number }, true)} onCommit={(next) => change({ strokeWidth: next as number })} /></View>
            <NumberField label={t("Bubble stroke width")} hideLabel size="sm" width={64} min={0} max={20} step={0.5} value={Number(stored.strokeWidth ?? catalogue.strokeWidth)} onCommit={(next) => change({ strokeWidth: Math.round(next * 2) / 2 })} />
          </Row>
          <Row label={t("Flip")}><View testID="bubble-flip"><Switch accessibilityLabel={t("Flip horizontal")} value={stored.flipHorizontal === true} onChange={(on) => change({ flipHorizontal: on })} /></View></Row>
        </Section>
      ) : null}
    </View>
  );
}
