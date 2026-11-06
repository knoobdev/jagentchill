import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { IconButton, Popover, SearchField, Tabs, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { EMOJI, EMOJI_GROUPS } from "../assets/emoji.gen";
import { registerFontFaces } from "../content-dom";
import { BUNDLED_FACES } from "../fonts.gen";

/** The characters of an emoji id (`1f44d-1f3fd`). */
export const emojiOf = (codes: string): string => String.fromCodePoint(...codes.split("-").map((hex) => Number.parseInt(hex, 16)));
const PAGE = 240;
/** The emoji of one group, or those whose name contains the query (any group). */
export function emojiRows(group: number, query: string): readonly (readonly [string, number, string])[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? EMOJI.filter((row) => row[1] === group) : EMOJI.filter((row) => row[2].toLowerCase().includes(needle));
}
// The picker's own tiles are drawn with the bundled colour font, as the engine draws them.
const GLYPH = { fontFamily: '"JC Noto Color Emoji", "Noto Color Emoji", system-ui' } as object;

/** A grid of emoji with the eight sub-group tabs and a search by name; `onPick` receives the id of the pressed one. */
export function EmojiGrid(props: { onPick(codes: string, name: string): void; tile?: number; maxHeight?: number; disabled?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => emojiRows(group, query), [group, query]);
  const tile = props.tile ?? 32;
  useEffect(() => registerFontFaces(BUNDLED_FACES.filter((face) => face.family === "Noto Color Emoji")), []);
  return (
    <View testID="emoji-grid" style={{ gap: space[2] }}>
      <SearchField label={t("Search emoji")} placeholder={t("Search emoji")} size="sm" value={query} onChangeText={(text) => { setQuery(text); setShown(PAGE); }} />
      {query.trim() === "" ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><Tabs id="emoji-groups" label={t("Emoji groups")} size="xs" variant="pill" items={EMOJI_GROUPS.map((name, index) => ({ id: String(index), label: t(name) }))} value={String(group)} onChange={(id) => { setGroup(Number(id)); setShown(PAGE); }} /></ScrollView> : null}
      <ScrollView style={props.maxHeight ? { maxHeight: props.maxHeight } : undefined} onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; if (contentOffset.y + layoutMeasurement.height > contentSize.height - 200 && shown < rows.length) setShown(shown + PAGE); }} scrollEventThrottle={64}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
          {rows.slice(0, shown).map(([codes, , name]) => (
            <Tap key={codes} role="button" label={name} disabled={props.disabled} testID={`emoji-${codes}`} tooltip={{ label: name }} onPress={() => props.onPick(codes, name)}
              style={(state) => ({ width: tile, height: tile, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
              <Text style={[{ fontSize: tile * 0.62, lineHeight: tile * 0.82 }, GLYPH]}>{emojiOf(codes)}</Text>
            </Tap>
          ))}
        </View>
        {rows.length === 0 ? <Text variant="meta" color="text/secondary" align="center" testID="emoji-empty" style={{ padding: space[3] }}>{t("No emoji found")}</Text> : null}
      </ScrollView>
    </View>
  );
}

/** The emoji button of a text field: a popover with the grid; the picked emoji is handed to `onPick` as characters. */
export function EmojiButton(props: { onPick(emoji: string): void }) {
  const t = useT();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <View ref={anchor}><IconButton icon="smile" size="xs" label={t("Insert emoji")} testID="text-emoji" onPress={() => setOpen(true)} /></View>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={304} label={t("Emoji")} title={t("Emoji")} role="dialog">
        <View testID="emoji-popover"><EmojiGrid maxHeight={240} onPick={(codes) => { props.onPick(emojiOf(codes)); setOpen(false); }} /></View>
      </Popover>
    </>
  );
}
