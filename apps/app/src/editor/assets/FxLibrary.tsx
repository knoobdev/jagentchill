import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  FX_CATEGORY, FX_PREFS, FX_PREVIEW, fxCategories, fxDefaultCategory, fxEmptyText, fxTiles, fxGridColumns, gridMove, type FxKind, type FxTile,
} from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { Button, ConfirmDialog, Icon, Input, Menu, Modal, NoResultsState, SearchField, Skeleton, Tap, Text, radius, space, useTheme, useToast, type IconName } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { bindDrag, focusById } from "../../platform/store";
import { usePref } from "../../state";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { applyTile, bodyEffectsAvailable, type FxUi } from "../fx/actions";
import { whenVisible } from "../fx/dom";
import { toggleFavourite, useFx, type FxStore } from "../fx/store";

/** The payload of a tile dragged out of a library tab: the timeline and the canvas apply it where it is dropped. */
export const tilePayload = (tile: FxTile): string => JSON.stringify({ fx: tile });
export function tileOfPayload(payload: string | null): FxTile | null {
  try { const tile = (JSON.parse(payload ?? "{}") as { fx?: FxTile }).fx; return tile && typeof tile.type === "string" && typeof tile.kind === "string" ? tile : null; } catch { return null; }
}
const TAB_ICON: Record<FxKind, IconName> = { effect: "sparkles", filter: "filter", transition: "transition" };
const SEARCH: Record<FxKind, [string, string]> = { effect: ["Search effects", "Search effects…"], filter: ["Search filters", "Search filters…"], transition: ["Search transitions", "Search transitions…"] };
const PAD = 12, GAP = 12;

/** The frames a tile shows: its still, and its animation once the pointer has rested on it. */
function useTilePictures(store: FxStore, tile: FxTile, hovered: boolean, enabled: boolean): { url: string | null; ready: boolean } {
  const [animate, setAnimate] = useState(false), [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!hovered || !tile.timeDriven || !enabled) { setAnimate(false); setFrame(0); return; }
    const timer = setTimeout(() => setAnimate(true), FX_PREVIEW.hoverDelay_ms);
    return () => clearTimeout(timer);
  }, [hovered, tile.timeDriven, enabled]);
  const request = { key: tile.key, kind: tile.kind, type: tile.type, params: tile.params };
  const still = enabled && tile.available ? store.pictures({ ...request, animated: false }) : [];
  const frames = animate ? store.pictures({ ...request, animated: true }) : undefined;
  const count = frames?.length ?? 0;
  useEffect(() => {
    if (count === 0) return;
    // An effect loops over two seconds; a transition runs once at the default duration, then waits out the second.
    const step = tile.kind === "transition" ? (timeline.DEFAULT_TRANSITION_SECONDS * 1000) / (count - 1) : (FX_PREVIEW.effectSeconds * 1000) / count;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      setFrame(tile.kind === "transition" ? Math.min(count - 1, Math.floor((elapsed % FX_PREVIEW.transitionPeriod_ms) / step)) : Math.floor(elapsed / step) % count);
    }, 33);
    return () => clearInterval(timer);
  }, [count, tile.kind]);
  return { url: count > 0 ? frames![Math.min(frame, count - 1)] : still?.[0] ?? null, ready: still !== undefined };
}

type TileProps = {
  tile: FxTile; index: number; focused: boolean; on: boolean; favourite: boolean; readOnly: boolean; pictures: boolean; size: { width: number; height: number };
  onApply(): void; onFocus(): void; onKey(key: string): boolean; onStar(): void; onMenu?(at: { x: number; y: number }): void; onDrag(dragging: boolean): void;
};
function Tile(props: TileProps) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const store = useFx(runtime);
  const node = useRef<View>(null);
  const [hovered, setHovered] = useState(false), [seen, setSeen] = useState(false);
  const { tile, size } = props;
  // Pictures are rendered for the tiles in view only.
  useEffect(() => whenVisible(node.current, () => setSeen(true)), []);
  const bodyOff = tile.body && !bodyEffectsAvailable(), disabled = !tile.available || bodyOff;
  const picture = useTilePictures(store, tile, hovered || props.focused, props.pictures && !disabled && seen);
  const handlers = useRef(props);
  handlers.current = props;
  useEffect(() => (props.readOnly || disabled ? undefined : bindDrag(node.current, () => tilePayload(handlers.current.tile), { onStart: () => handlers.current.onDrag(true), onEnd: () => handlers.current.onDrag(false) })), [props.readOnly, disabled]);
  const name = tile.preset ?? t(tile.name);
  const label = !tile.available ? `${name} — ${t(tile.kind === "transition" ? timeline.TRANSITION_MESSAGES.unavailable : timeline.EFFECT_MESSAGES.unavailable)}` : name;
  // A transition tile is applied by its "+"; an effect or filter tile by a click on it.
  const press = tile.kind === "transition" && store.state.replace?.kind !== "transition" ? props.onFocus : props.onApply;
  return (
    <View ref={node} testID={`fx-tile-${tile.kind}-${tile.preset ? `preset-${tile.preset}` : tile.type}`} style={{ width: size.width, gap: space[1], opacity: disabled ? 0.5 : 1 }}
      {...({ dataSet: { selected: props.on ? "1" : "0" }, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } as object)}>
      <Tap role="button" nativeID={`fx-tile-${tile.kind}-${props.index}`} label={label} disabled={props.readOnly || disabled} pressedState={props.on} tabIndex={props.focused ? 0 : -1}
        tooltip={bodyOff ? { label: t(timeline.EFFECT_MESSAGES.bodyUnavailable) } : !tile.available ? { label: t(tile.kind === "transition" ? timeline.TRANSITION_MESSAGES.unavailable : timeline.EFFECT_MESSAGES.unavailable) } : undefined}
        onPress={press} onFocus={props.onFocus} onContextMenu={props.onMenu}
        onKeyDown={(key) => { if (props.onKey(key.key)) { key.preventDefault(); key.stopPropagation?.(); } }}
        style={{ width: size.width, height: size.height, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle") }}>
        {picture.url ? <View testID="fx-tile-picture" style={[{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }, { backgroundImage: `url("${picture.url}")`, experimental_backgroundImage: `url("${picture.url}")`, backgroundSize: "cover", backgroundPosition: "center" } as object]} />
          : props.pictures && !disabled && !picture.ready ? <Skeleton width="100%" height={size.height} />
          : <View testID="fx-tile-icon" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name={TAB_ICON[tile.kind]} size={24} color="text/secondary" /></View>}
      </Tap>
      {props.on ? <View pointerEvents="none" testID="fx-tile-on" style={{ position: "absolute", left: -3, top: -3, width: size.width + 6, height: size.height + 6, borderRadius: radius.sm + 3, borderWidth: 2, borderColor: theme.color("accent") }} /> : null}
      {(hovered || props.favourite || theme.touch) && !tile.preset && !disabled ? (
        <Tap role="button" label={t(props.favourite ? "Remove from favourites: {name}" : "Add to favourites: {name}", { name })} pressedState={props.favourite} focusable={false} testID={`fx-star-${tile.type}`} onPress={props.onStar}
          style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: radius.xs, backgroundColor: hovered ? theme.color("clip/label-scrim") : "transparent" }}>
          <Icon name="star" size={14} color="clip/label" />
          {props.favourite ? <View pointerEvents="none" style={{ position: "absolute", width: 5, height: 5, borderRadius: 3, backgroundColor: theme.color("clip/label") }} /> : null}
        </Tap>
      ) : null}
      {tile.kind === "transition" && (hovered || theme.touch) && !disabled && !props.readOnly ? (
        <Tap role="button" label={t("Add transition: {name}", { name })} focusable={false} testID={`fx-add-${tile.preset ? `preset-${tile.preset}` : tile.type}`} onPress={props.onApply}
          style={{ position: "absolute", top: size.height - 24, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: radius.xs, backgroundColor: theme.color("bg/elevated"), borderWidth: 1, borderColor: theme.color("border/control") }}>
          <Icon name="plus" size={12} />
        </Tap>
      ) : null}
      <Text variant="meta" numberOfLines={1} testID="fx-tile-name">{name}</Text>
    </View>
  );
}

/**
 * A library tab of the asset panel — Effects, Filters or Transitions: the search field, the category strip and the
 * grid of tiles, each rendered by the engine from the bundled sample pictures.
 */
export function FxLibrary(props: { kind: FxKind; readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const store = useFx(runtime);
  const { kind } = props, { controller } = runtime;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(fxDefaultCategory(kind));
  const [library] = usePref(FX_PREFS.library);
  const [effectPresets, setEffectPresets] = usePref(FX_PREFS.effectPresets);
  const [transitionPresets, setTransitionPresets] = usePref(FX_PREFS.transitionPresets);
  const [focus, setFocus] = useState(0);
  const [width, setWidth] = useState(312);
  const [menu, setMenu] = useState<{ tile: FxTile; at: { x: number; y: number } } | null>(null);
  const [renaming, setRenaming] = useState<{ tile: FxTile; name: string } | null>(null);
  const [deleting, setDeleting] = useState<FxTile | null>(null);
  const ui: FxUi = useMemo(() => ({ t, toast: (message, tone) => toast.show({ kind: tone ?? "info", message }) }), [t, toast]);
  const tileSize = theme.compact ? (kind === "transition" ? { width: 72, height: 48 } : { width: 72, height: 72 }) : kind === "transition" ? { width: 96, height: 64 } : { width: 96, height: 96 };
  const searching = query.trim() !== "";
  const tiles = useMemo(() => fxTiles(kind, { category, query, library, effectPresets, transitionPresets, localise: (name) => t(name) }), [kind, category, query, library, effectPresets, transitionPresets, t]);
  const columns = fxGridColumns(width, tileSize.width, GAP, PAD);
  const pictures = transport.engine !== "no-gpu" && transport.engine !== "unsupported";
  // The tile of what is selected: the type of the selected transition, or of the selected layer's entry.
  const selectedType = (() => {
    if (kind === "transition") return store.state.transitionId ? timeline.findTransition(controller.document, store.state.transitionId)?.record.type ?? null : null;
    const [only, ...rest] = controller.session.selection.selectedElements;
    const element = only && rest.length === 0 ? timeline.locate(controller.document, only)?.element : undefined;
    const entry = element?.type === "effect" ? (element.effects as timeline.StackEntry[] | undefined)?.[0] : undefined;
    return entry && entry.kind === kind ? entry.type : null;
  })();
  const replacing = store.state.replace !== null && (kind === "transition" ? store.state.replace.kind === "transition" : store.state.replace.kind === "layer" && store.state.replace.entryKind === kind);
  const key = (index: number, pressed: string): boolean => {
    const tile = tiles[index];
    if (pressed === "Enter") { if (!props.readOnly) applyTile(runtime, tile, ui); return true; }
    if (pressed === "f" || pressed === "F") { if (!tile.preset) { const message = toggleFavourite(kind, tile.type); if (message) ui.toast(t(message)); } return true; }
    const next = gridMove(index, pressed, columns, tiles.length);
    if (next === index) return pressed.startsWith("Arrow");
    setFocus(next); focusById(`fx-tile-${kind}-${next}`);
    return true;
  };
  const presetMenu = (tile: FxTile) => (at: { x: number; y: number }) => setMenu({ tile, at });
  const renamePreset = (tile: FxTile, name: string) => {
    if (kind === "transition") setTransitionPresets(timeline.renameTransitionPreset(transitionPresets, tile.preset!, name));
    else setEffectPresets(effectPresets.map((preset) => (preset.name === tile.preset && preset.type === tile.type ? { ...preset, name: timeline.uniquePresetName(name, effectPresets.filter((other) => other.type === tile.type && other.name !== tile.preset).map((other) => other.name)) } : preset)));
  };
  const deletePreset = (tile: FxTile) => {
    if (kind === "transition") setTransitionPresets(timeline.deleteTransitionPreset(transitionPresets, tile.preset!));
    else setEffectPresets(effectPresets.filter((preset) => !(preset.name === tile.preset && preset.type === tile.type)));
  };
  const empty = searching ? null : fxEmptyText(category);
  return (
    <View testID={`fx-library-${kind}`} style={{ flex: 1, minHeight: 0 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ paddingTop: space[2], paddingHorizontal: PAD }}>
        <SearchField label={t(SEARCH[kind][0])} placeholder={t(SEARCH[kind][1])} size="sm" value={query} onChangeText={(text) => { setQuery(text); setFocus(0); }} />
      </View>
      {replacing ? (
        <View testID="fx-replace-banner" style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginTop: space[2], marginHorizontal: PAD, paddingHorizontal: space[2], height: 28, borderRadius: radius.sm, backgroundColor: theme.color("accent/subtle") }}>
          <Text variant="meta" style={{ flex: 1 }} numberOfLines={1}>{t(kind === "transition" ? "Pick a transition to replace it" : kind === "filter" ? "Pick a filter to replace it" : "Pick an effect to replace it")}</Text>
          <Button kind="ghost" size="xs" label={t("Cancel")} onPress={() => store.set({ replace: null })} />
        </View>
      ) : null}
      <View style={{ paddingVertical: space[2] }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: PAD, gap: space[1] }}>
          <View role="tablist" aria-label={t("Categories")} style={{ flexDirection: "row", gap: space[1] }}>
            {fxCategories(kind).map((entry) => {
              const on = !searching && category === entry;
              return (
                <Tap key={entry} role="tab" label={t(entry)} selected={on} testID={`fx-category-${entry}`} onPress={() => { setCategory(entry); setQuery(""); setFocus(0); }}
                  style={(state) => ({ height: 24, paddingHorizontal: space[2], borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: on ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
                  <Text variant="meta" color={on ? "text/primary" : "text/secondary"} style={{ fontWeight: on ? "500" : "400" }} numberOfLines={1}>{t(entry)}</Text>
                </Tap>
              );
            })}
          </View>
        </ScrollView>
        <View pointerEvents="none" style={[{ position: "absolute", right: 0, top: 0, bottom: 0, width: 24 }, { backgroundImage: `linear-gradient(90deg, transparent, ${theme.color("bg/app")})` } as object]} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: space[3], flexGrow: 1 }}>
        {!searching && category === FX_CATEGORY.ai ? <AiStyles /> : tiles.length === 0 ? (
          searching ? <View testID="fx-no-results" style={{ flex: 1 }}><NoResultsState query={query.trim()} onClear={() => setQuery("")} /></View>
            : <View testID="fx-empty" style={{ padding: space[4], alignItems: "center", gap: space[1] }}><Icon name={category === FX_CATEGORY.favourites ? "star" : TAB_ICON[kind]} size={24} color="text/secondary" /><Text variant="meta" color="text/secondary" align="center">{t(empty ?? "Nothing here yet")}</Text></View>
        ) : (
          <View testID="fx-grid" role="group" aria-label={t(kind === "transition" ? "Transitions" : kind === "filter" ? "Filters" : "Effects")} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: GAP, rowGap: kind === "transition" ? space[2] : 10 }}>
            {tiles.map((tile, index) => (
              <Tile key={tile.key} tile={tile} index={index} size={tileSize} focused={Math.min(focus, tiles.length - 1) === index} on={!tile.preset && selectedType === tile.type} favourite={!tile.preset && library.favourites[kind].includes(tile.type)} readOnly={props.readOnly} pictures={pictures}
                onApply={() => { setFocus(index); if (!props.readOnly) applyTile(runtime, tile, ui); }} onFocus={() => setFocus(index)} onKey={(pressed) => key(index, pressed)}
                onStar={() => { const message = toggleFavourite(kind, tile.type); if (message) ui.toast(t(message)); }} onMenu={tile.preset ? presetMenu(tile) : undefined}
                onDrag={(dragging) => store.set(dragging ? { drag: { kind, type: tile.type, preset: tile.preset } } : { drag: null, dropCut: null, dropClip: null })} />
            ))}
          </View>
        )}
      </ScrollView>
      <Menu open={menu !== null} onClose={() => setMenu(null)} anchor={{ x: menu?.at.x ?? 0, y: menu?.at.y ?? 0, width: 1, height: 1 }} label={t("My presets")} items={menu ? [
        { id: "rename", label: t("Rename"), onSelect: () => setRenaming({ tile: menu.tile, name: menu.tile.preset! }) },
        { id: "delete", label: t("Delete"), danger: true, onSelect: () => setDeleting(menu.tile) },
      ] : []} />
      {renaming ? (
        <Modal title={t("Rename preset")} width={360} onClose={() => setRenaming(null)}
          footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={() => setRenaming(null)} /><Button size="sm" kind="primary" label={t("Rename")} testID="fx-preset-rename-confirm" disabled={renaming.name.trim().length === 0} onPress={() => { renamePreset(renaming.tile, renaming.name); setRenaming(null); }} /></>}>
          <Input accessibilityLabel={t("Preset name")} autoFocus maxLength={60} value={renaming.name} onChangeText={(name) => setRenaming({ ...renaming, name })} />
        </Modal>
      ) : null}
      <ConfirmDialog open={deleting !== null} title={t("Delete preset")} description={deleting ? t("Delete the preset “{name}”?", { name: deleting.preset ?? "" }) : undefined} confirmLabel={t("Delete")} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) deletePreset(deleting); setDeleting(null); }} />
    </View>
  );
}

/** The "AI styles" category: an entry point that needs a connected host with an image or video model. */
function AiStyles() {
  const t = useT();
  const router = useRouter();
  const host = useHost();
  const connected = host.status === "connected";
  return (
    <View testID="fx-ai-styles" style={{ padding: space[4], alignItems: "center", gap: space[2] }}>
      <Icon name="spark" size={24} color="text/secondary" />
      <Text variant="meta" color="text/secondary" align="center">{t(connected ? "Set up an image or video model to use AI styles" : "Connect a host to use AI styles")}</Text>
      <Button size="sm" kind="outline" label={t(connected ? "Open model settings" : "Connect a host")} testID="fx-ai-action" onPress={() => router.push("/settings" as never)} />
    </View>
  );
}

export const EffectsTab = (props: { readOnly: boolean }) => <FxLibrary kind="effect" readOnly={props.readOnly} />;
export const FiltersTab = (props: { readOnly: boolean }) => <FxLibrary kind="filter" readOnly={props.readOnly} />;
export const TransitionsTab = (props: { readOnly: boolean }) => <FxLibrary kind="transition" readOnly={props.readOnly} />;
