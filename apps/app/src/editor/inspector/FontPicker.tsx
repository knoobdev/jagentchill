import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { bundledFamilyOf, FONT_PREFS, FONT_TAB_EMPTY, fontPickerRows, pushRecentFont, toggleFavoriteFont, type FontPickerTab } from "@jagentchill/app-core";
import { Icon, IconButton, Popover, SearchField, Tabs, Tap, Text, fieldBox, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { usePref } from "../../state";
import { registerFontFaces } from "../content-dom";
import { BUNDLED_FACES } from "../fonts.gen";

const ROW = 40, LIST_MAX = 288, HOVER_PREVIEW_MS = 300;
/**
 * The font picker of every `font` parameter: a 288 px popover with a search field and the tabs All, Favorites and
 * Recent. Hovering a row for 300 ms previews it on the selection, a click commits one step, Escape discards the preview.
 */
export function FontPicker(props: { value: string | null; onPreview(family: string): void; onCommit(family: string): void; onDiscard(): void }) {
  const t = useT();
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FontPickerTab>("all");
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = usePref(FONT_PREFS);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(false);
  // The rows are drawn in the family itself: the bundled faces of the baseline names are given to the browser once the picker opens.
  useEffect(() => { if (open) registerFontFaces(BUNDLED_FACES.filter((face) => face.load === "engine")); }, [open]);
  const rows = fontPickerRows(tab, query, prefs);
  // The list stays as it is while the popover fades out: a row that slid under the pointer must not start a preview.
  const live = useRef(false);
  live.current = open;
  const stopHover = () => { if (hover.current) clearTimeout(hover.current); hover.current = null; };
  useEffect(() => stopHover, []);
  const close = (discard: boolean) => { stopHover(); live.current = false; if (discard && !committed.current) props.onDiscard(); setOpen(false); };
  const commit = (family: string) => { committed.current = true; setPrefs(pushRecentFont(prefs, family)); props.onCommit(family); close(false); };
  return (
    <>
      <Tap ref={anchor} role="button" label={t("Font")} expanded={open} testID="font-picker" onPress={() => { committed.current = false; setQuery(""); setOpen(true); }}
        style={(state) => [fieldBox(theme, "sm", { hovered: state.hovered, focused: open }), { flex: 1, flexDirection: "row", alignItems: "center", gap: space[1] }]}>
        <Text numberOfLines={1} style={{ flex: 1 }}>{props.value ?? "—"}</Text><Icon name="chev-d" size={14} color="text/secondary" />
      </Tap>
      <Popover open={open} onClose={() => close(true)} anchor={anchor} width={288} label={t("Font")} title={t("Font")} padded={false} role="dialog">
        <View testID="font-popover" style={{ padding: space[2], gap: space[2] }}>
          <SearchField label={t("Search fonts")} placeholder={t("Search fonts")} size="sm" autoFocus value={query} onChangeText={setQuery} onEscape={() => close(true)} />
          <Tabs id="font-tabs" label={t("Fonts")} size="xs" variant="pill" items={[{ id: "all", label: t("All") }, { id: "favorites", label: t("Favorites") }, { id: "recent", label: t("Recent") }]} value={tab} onChange={(id) => setTab(id as FontPickerTab)} />
        </View>
        <ScrollView style={{ maxHeight: LIST_MAX }}>
          {rows.length === 0 ? <View style={{ padding: space[4], alignItems: "center" }}><Text variant="meta" color="text/secondary" align="center" testID="font-empty">{t(query.trim() ? "No fonts found" : FONT_TAB_EMPTY[tab])}</Text></View> : null}
          {rows.map((family) => {
            const starred = prefs.favorites.includes(family);
            return (
              <View key={family} style={{ height: ROW, flexDirection: "row", alignItems: "center", paddingEnd: space[1] }}>
                <Tap role="option" label={family} selected={props.value === family} testID={`font-row-${family}`} onPress={() => commit(family)}
                  onHoverIn={() => { stopHover(); if (live.current) hover.current = setTimeout(() => { if (live.current) props.onPreview(family); }, HOVER_PREVIEW_MS); }} onHoverOut={stopHover}
                  style={(state) => ({ flex: 1, height: ROW, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
                  <Text numberOfLines={1} style={[{ flex: 1, fontSize: 15 }, { fontFamily: `"JC ${bundledFamilyOf(family)}", system-ui` } as object]}>{family}</Text>
                  {props.value === family ? <Icon name="check" size={14} color="accent/text" /> : null}
                </Tap>
                <IconButton icon="star" size="xs" label={t(starred ? "Remove {name} from favourites" : "Add {name} to favourites", { name: family })} on={starred} toggle tone="accent" testID={`font-star-${family}`} onPress={() => setPrefs(toggleFavoriteFont(prefs, family))} />
              </View>
            );
          })}
        </ScrollView>
      </Popover>
    </>
  );
}
