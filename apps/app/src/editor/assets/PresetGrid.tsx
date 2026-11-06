import { View } from "react-native";
import { TEXT_PRESET_GROUPS, TEXT_PRESETS, type SavedTextPreset, type TextPreset } from "@jagentchill/editor-core";
import { Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";

type Look = Pick<TextPreset, "color" | "gradient" | "stroke" | "shadow" | "glow">;
const TILE_FONT = 18;
/** The look of a preset on the letters "Aa", from the preset's own values (lengths are % of the font size, as in the document). */
function lookStyle(look: Look): object {
  const px = (percent: number) => (percent / 100) * TILE_FONT, shadows: string[] = [];
  if (look.glow) shadows.push(`0 0 ${px(look.glow.radius).toFixed(1)}px ${look.glow.color}`, `0 0 ${(px(look.glow.radius) / 2).toFixed(1)}px ${look.glow.color}`);
  if (look.shadow) {
    const radians = (look.shadow.angle * Math.PI) / 180, distance = px(look.shadow.distance), alpha = Math.round((look.shadow.opacity / 100) * 255).toString(16).padStart(2, "0");
    shadows.push(`${(Math.cos(radians) * distance).toFixed(1)}px ${(-Math.sin(radians) * distance).toFixed(1)}px ${px(look.shadow.blur).toFixed(1)}px ${look.shadow.color.slice(0, 7)}${alpha}`);
  }
  return {
    color: look.color, fontSize: TILE_FONT, lineHeight: 24, fontWeight: "700",
    ...(shadows.length ? { textShadow: shadows.join(", ") } : {}),
    ...(look.stroke ? { WebkitTextStroke: `${Math.max(0.6, px(look.stroke.width) * (look.stroke.position === "outside" ? 2 : 1)).toFixed(1)}px ${look.stroke.color}`, paintOrder: "stroke fill" } : {}),
    ...(look.gradient ? { backgroundImage: `linear-gradient(${180 - (look.gradient.angle - 90)}deg, ${look.color}, ${look.gradient.color})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent" } : {}),
  };
}
/** The look a saved style has, read from its stored text fields. */
export function lookOfStyle(style: Record<string, unknown>): Look {
  const part = (key: string) => (style[key] ?? {}) as Record<string, unknown>;
  const fill = part("fill"), stroke = part("stroke"), shadow = part("shadow"), glow = part("glow");
  return {
    color: String(style.color ?? "#ffffff"),
    ...(fill.type === "gradient" ? { gradient: { color: String(fill.gradientColor), angle: Number(fill.gradientAngle) } } : {}),
    ...(stroke.enabled ? { stroke: { color: String(stroke.color), width: Number(stroke.width), position: stroke.position as "outside" | "center" } } : {}),
    ...(shadow.enabled ? { shadow: { color: String(shadow.color), opacity: Number(shadow.opacity), blur: Number(shadow.blur), distance: Number(shadow.distance), angle: Number(shadow.angle) } } : {}),
    ...(glow.enabled ? { glow: { color: String(glow.color), intensity: Number(glow.intensity), radius: Number(glow.radius) } } : {}),
  };
}

export function PresetTile(props: { id: string; name: string; look: Look; selected?: boolean; disabled?: boolean; onPress(): void; onHover?(inside: boolean): void; onContextMenu?(at: { x: number; y: number }): void }) {
  const theme = useTheme();
  // A light fill reads on the dark tile and a dark one on the light tile, whatever the theme of the app: both tiles keep their value in either theme.
  const dark = /^#(?:[0-3][0-9a-f]){3}/i.test(props.look.color) && !props.look.gradient && !props.look.glow;
  return (
    <Tap role="button" label={props.name} disabled={props.disabled} pressedState={props.selected} testID={`text-preset-${props.id}`} onPress={props.onPress} onHoverIn={() => props.onHover?.(true)} onHoverOut={() => props.onHover?.(false)} onContextMenu={props.onContextMenu}
      style={{ width: "31%", gap: space[1] }}>
      {(state) => (
        <>
          <View style={{ height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: theme.color(dark ? "qr/tile" : "qr/module"), borderWidth: props.selected ? 2 : 1, borderColor: theme.color(props.selected ? "accent/text" : state.hovered ? "border/strong" : "border/hairline") }}>
            <Text style={lookStyle(props.look) as never}>Aa</Text>
          </View>
          <Text variant="meta" numberOfLines={1}>{props.name}</Text>
        </>
      )}
    </Tap>
  );
}

/** "None" followed by the 40 bundled presets in catalogue order under their groups, then the user's saved ones. */
export function PresetGrid(props: { query?: string; selectedId?: string | null; disabled?: boolean; saved?: SavedTextPreset[]; onPick(presetId: string | null): void; onHover?(presetId: string | null, inside: boolean): void; onPickSaved?(preset: SavedTextPreset): void; onSavedMenu?(preset: SavedTextPreset, at: { x: number; y: number }): void }) {
  const t = useT();
  const needle = (props.query ?? "").trim().toLowerCase();
  const match = (name: string, group = "") => needle === "" || name.toLowerCase().includes(needle) || group.toLowerCase().includes(needle);
  const saved = (props.saved ?? []).filter((preset) => match(preset.name));
  const groups = TEXT_PRESET_GROUPS.map((group) => ({ group, presets: TEXT_PRESETS.filter((preset) => preset.group === group && match(preset.name, group)) })).filter((entry) => entry.presets.length > 0);
  const grid = { flexDirection: "row", flexWrap: "wrap", columnGap: "3.5%", rowGap: space[2] } as const;
  return (
    <View testID="text-presets" style={{ gap: space[2] }}>
      {groups.map((entry, index) => (
        <View key={entry.group} style={{ gap: space[1] }}>
          <Text variant="caption" color="text/secondary">{t(entry.group)}</Text>
          <View style={grid}>
            {index === 0 && match("None") ? <PresetTile id="none" name={t("None")} look={{ color: "#ffffff" }} disabled={props.disabled} selected={props.selectedId === null} onPress={() => props.onPick(null)} onHover={(inside) => props.onHover?.(null, inside)} /> : null}
            {entry.presets.map((preset) => <PresetTile key={preset.id} id={preset.id} name={t(preset.name)} look={preset} disabled={props.disabled} selected={props.selectedId === preset.id} onPress={() => props.onPick(preset.id)} onHover={(inside) => props.onHover?.(preset.id, inside)} />)}
          </View>
        </View>
      ))}
      {saved.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="text/secondary">{t("My presets")}</Text>
          <View style={grid}>{saved.map((preset) => <PresetTile key={preset.id} id={`saved-${preset.name}`} name={preset.name} look={lookOfStyle(preset.style)} disabled={props.disabled} onPress={() => props.onPickSaved?.(preset)} onContextMenu={(at) => props.onSavedMenu?.(preset, at)} />)}</View>
        </View>
      ) : null}
      {groups.length === 0 && saved.length === 0 ? <Text variant="meta" color="text/secondary" align="center" testID="text-presets-empty">{t("No text presets found")}</Text> : null}
    </View>
  );
}
