import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { addDrawingAt, addShapeItem, addStickerItem, EMOJI_STICKER_SIZE, parseStickerId, pushRecentSticker, searchShapes, shapeOutline, timeline, type ShapeItem } from "@jagentchill/editor-core";
import type { StoragePort } from "@jagentchill/storage";
import { Button, ColorPicker, Icon, IconButton, NumberField, SearchField, Segmented, Slider, Tabs, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useLibraryImports } from "../../library/hooks";
import { itemBytes, itemFile, mimeOfFile, type LibraryItem } from "../../library/store";
import { useT } from "../../locale";
import { bindDrag, pickFiles } from "../../platform/store";
import { usePref } from "../../state";
import { draw, useDraw } from "../canvas/draw-store";
import { bindCanvasDrop, registerFontFaces } from "../content-dom";
import { useEditor, useEditorVersion } from "../context";
import { objectUrl, releaseUrl } from "../dom";
import { BUNDLED_FACES } from "../fonts.gen";
import { EmojiGrid, emojiOf } from "../inspector/EmojiPicker";
import { EMOJI } from "./emoji.gen";
import { categoryOf, STICKER_ACCEPT, STICKER_MAX_BYTES, STICKER_SETTINGS, type StickerCategory, type UserSticker } from "./sticker-store";

const TILE = 72;
const CATEGORY_LABELS: Record<StickerCategory, string> = { all: "All", emoji: "Emoji", shapes: "Shapes", user: "My stickers" };
type Dragged = { sticker?: { id: string; name: string; width: number; height: number; animated?: boolean }; shape?: string };
const payloadOf = (item: Dragged): string => JSON.stringify({ items: item.shape ? [{ kind: "graphic", definitionId: item.shape }] : [{ kind: "sticker", stickerId: item.sticker!.id, name: item.sticker!.name, width: item.sticker!.width, height: item.sticker!.height }], stickerDrop: item });
const draggedOf = (payload: string): Dragged | null => { try { return (JSON.parse(payload) as { stickerDrop?: Dragged }).stickerDrop ?? null; } catch { return null; } };
const emojiName = (codes: string): string => EMOJI.find((row) => row[0] === codes)?.[2] ?? "Emoji";

/**
 * The Stickers tab: a search field, the categories All, Emoji, Shapes and My stickers, and the Draw tool. A tile is
 * drawn from the sticker itself; a click adds it at the playhead, centred, and a drag puts it on a track or at a point
 * of the canvas. While the Draw tool is on, the tab shows its brush controls and the canvas takes strokes.
 */
export function StickersTab(props: { readOnly: boolean }) {
  const t = useT();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const drawing = useDraw();
  const { controller } = runtime, projectId = controller.stored.metadata.id;
  const [settings, setSettings] = usePref(STICKER_SETTINGS);
  const [query, setQuery] = useState("");
  const category = categoryOf(settings), mine = settings.user[projectId] ?? [];
  const canvas = controller.stored.settings.canvasSize;
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(() => registerFontFaces(BUNDLED_FACES.filter((face) => face.family === "Noto Color Emoji")), []);
  const remember = (id: string) => setSettings({ ...latest.current, recents: pushRecentSticker(latest.current.recents, id) });
  const addShape = (shapeId: string, position?: { x: number; y: number }) => { if (controller.run(addShapeItem({ sceneId: controller.session.sceneId, shapeId, time: controller.session.playhead, position })).ok) remember(`shapes:${shapeId}`); };
  const addSticker = (sticker: NonNullable<Dragged["sticker"]>, position?: { x: number; y: number }) => {
    if (controller.run(addStickerItem({ sceneId: controller.session.sceneId, stickerId: sticker.id, name: sticker.name, width: sticker.width, height: sticker.height, time: controller.session.playhead, position })).ok) remember(sticker.id);
  };
  const emojiSticker = (codes: string, name = emojiName(codes)) => ({ id: `emoji:${codes}`, name, width: EMOJI_STICKER_SIZE, height: EMOJI_STICKER_SIZE });
  const userSticker = (entry: UserSticker) => ({ id: `user:${entry.sha256}`, name: entry.name, width: entry.width, height: entry.height, animated: entry.animated });
  useEffect(() => (props.readOnly ? undefined : bindCanvasDrop(canvas, (payload) => draggedOf(payload) !== null, (payload, point) => { const dragged = draggedOf(payload); if (dragged?.shape) addShape(dragged.shape, point); else if (dragged?.sticker) addSticker(dragged.sticker, point); })), [canvas.width, canvas.height, props.readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Brings sticker files into the project and lists them under My stickers; the stickers it made, in the order of the files. */
  const keepStickers = async (files: File[]): Promise<UserSticker[]> => {
    const allowed = files.filter((file) => file.size <= STICKER_MAX_BYTES);
    if (allowed.length < files.length) toast.show({ kind: "warning", message: t("Stickers can be up to 20 MB") });
    if (allowed.length === 0) return [];
    const result = await runtime.media.importFiles(allowed.map((file) => ({ file })));
    const ids = [...result.imported, ...result.reused].map((entry) => entry.assetId), added: UserSticker[] = [];
    for (const assetId of ids) {
      const asset = runtime.controller.stored.media.assets.find((entry) => entry.id === assetId) as { id: string; name: string; contentHash?: string | null; width?: number; height?: number; type: string; duration?: number } | undefined;
      if (!asset?.contentHash) continue;
      added.push({ assetId, sha256: asset.contentHash, name: asset.name.replace(/\.[a-z0-9]+$/i, ""), width: asset.width || 512, height: asset.height || 512, animated: /\.(gif|apng)$/i.test(asset.name) || asset.type === "video" });
    }
    if (added.length === 0) { toast.show({ kind: "warning", message: t("Couldn't import this sticker") }); return []; }
    const current = latest.current, kept = (current.user[projectId] ?? []).filter((entry) => !added.some((next) => next.sha256 === entry.sha256));
    setSettings({ ...current, user: { ...current.user, [projectId]: [...kept, ...added] } });
    return added;
  };
  const importStickers = async () => { await keepStickers(await pickFiles(STICKER_ACCEPT, true)); };
  // The stickers imported in the Library of this device that the project does not hold yet: using one brings its file into the project.
  const library = useLibraryImports("stickers");
  const shelved = library.items.filter((item) => !mine.some((entry) => entry.sha256 === item.stored?.sha256));
  const useShelved = async (item: LibraryItem) => {
    const file = library.storage ? await itemFile(library.storage, item) : null;
    const [made] = file ? await keepStickers([file]) : [];
    if (made) addSticker(userSticker(made)); else if (!file) toast.show({ kind: "warning", message: t("Couldn't import this sticker") });
  };
  const removeSticker = (entry: UserSticker) => setSettings({ ...latest.current, user: { ...latest.current.user, [projectId]: (latest.current.user[projectId] ?? []).filter((other) => other.sha256 !== entry.sha256) } });

  const needle = query.trim().toLowerCase();
  const shapes = searchShapes(query), myFound = mine.filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle)), shelvedFound = shelved.filter((item) => needle === "" || item.name.toLowerCase().includes(needle));
  const emojiFound = needle === "" ? [] : EMOJI.filter((row) => row[2].toLowerCase().includes(needle)).slice(0, 96);
  const section = (title: string, children: ReactNode, action?: ReactNode) => (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 20 }}><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{title}</Text>{action}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{children}</View>
    </View>
  );
  const shapeTiles = shapes.map((item) => <ShapeTile key={item.id} item={item} disabled={props.readOnly} onPress={() => addShape(item.id)} />);
  const emojiTile = (codes: string, name: string) => <StickerTile key={codes} testID={`sticker-emoji-${codes}`} name={name} disabled={props.readOnly} payload={payloadOf({ sticker: emojiSticker(codes, name) })} onPress={() => addSticker(emojiSticker(codes, name))}><Text style={[{ fontSize: 40, lineHeight: 52 }, { fontFamily: '"JC Noto Color Emoji", "Noto Color Emoji", system-ui' } as object]}>{emojiOf(codes)}</Text></StickerTile>;
  const myTiles = myFound.map((entry) => <UserTile key={entry.sha256} entry={entry} disabled={props.readOnly} payload={payloadOf({ sticker: userSticker(entry) })} onPress={() => addSticker(userSticker(entry))} onRemove={() => removeSticker(entry)} />);
  const myCount = myFound.length + shelvedFound.length;
  myTiles.push(...shelvedFound.map((item) => <LibraryTile key={item.id} item={item} storage={library.storage} disabled={props.readOnly} onPress={() => void useShelved(item)} />));
  const importButton = <Button size="xs" kind="outline" icon="plus" label={t("Import")} disabled={props.readOnly} testID="stickers-import" onPress={() => void importStickers()} />;
  const recents = settings.recents.flatMap((id) => {
    const parsed = parseStickerId(id);
    if (parsed?.provider === "emoji" && EMOJI.some((row) => row[0] === parsed.value)) return [emojiTile(parsed.value, emojiName(parsed.value))];
    if (parsed?.provider === "shapes") { const item = searchShapes("").find((entry) => entry.id === parsed.value); return item ? [<ShapeTile key={`recent-${item.id}`} item={item} disabled={props.readOnly} onPress={() => addShape(item.id)} />] : []; }
    if (parsed?.provider === "user") { const entry = mine.find((other) => other.sha256 === parsed.value); return entry ? [<UserTile key={`recent-${entry.sha256}`} entry={entry} disabled={props.readOnly} payload={payloadOf({ sticker: userSticker(entry) })} onPress={() => addSticker(userSticker(entry))} />] : []; }
    return [];
  }).slice(0, 8);
  const featured = EMOJI.filter((row) => row[1] === 0).slice(0, 8);
  const nothing = needle !== "" && shapes.length === 0 && myCount === 0 && emojiFound.length === 0;

  if (drawing.active) return <DrawPanel onDone={() => { const strokes = draw.finish(); if (strokes.length > 0) controller.run(addDrawingAt({ sceneId: controller.session.sceneId, strokes, time: controller.session.playhead })); }} />;
  return (
    <View testID="stickers-tab" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ padding: space[2], paddingHorizontal: space[3], gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <View style={{ flex: 1 }}><SearchField label={t("Search stickers")} placeholder={t("Search stickers...")} size="sm" value={query} onChangeText={setQuery} /></View>
          <Button size="sm" kind="outline" icon="pencil" label={t("Draw")} disabled={props.readOnly} testID="stickers-draw" onPress={() => { runtime.pause(); controller.select(timeline.selectElements([])); draw.start(); }} />
        </View>
        {needle === "" ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><Tabs id="sticker-categories" label={t("Sticker categories")} size="xs" variant="pill" items={(Object.keys(CATEGORY_LABELS) as StickerCategory[]).map((id) => ({ id, label: t(CATEGORY_LABELS[id]) }))} value={category} onChange={(id) => setSettings({ ...settings, category: id })} /></ScrollView> : null}
      </View>
      {needle === "" && category === "emoji" ? (
        <View style={{ flex: 1, minHeight: 0, paddingHorizontal: space[3], paddingBottom: space[3] }} testID="stickers-emoji"><EmojiGrid tile={44} disabled={props.readOnly} onPick={(codes, name) => addSticker(emojiSticker(codes, name))} /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[3] }}>
          {needle !== "" ? (
            <>
              {emojiFound.length > 0 ? section(t("Emoji"), emojiFound.map((row) => emojiTile(row[0], row[2]))) : null}
              {shapes.length > 0 ? section(t("Shapes"), shapeTiles) : null}
              {myCount > 0 ? section(t("My stickers"), myTiles) : null}
              {nothing ? <View style={{ alignItems: "center", gap: space[2], padding: space[3] }}><Text variant="meta" color="text/secondary" align="center" testID="stickers-empty">{t("No stickers found for \"{query}\"", { query: query.trim() })}</Text><Button size="sm" label={t("Clear search")} onPress={() => setQuery("")} /></View> : null}
            </>
          ) : category === "shapes" ? section(t("Shapes"), shapeTiles)
            : category === "user" ? (
              <>
                {section(t("My stickers"), myTiles, importButton)}
                {mine.length + shelved.length === 0 ? <Text variant="meta" color="text/secondary" testID="stickers-user-empty">{t("No imported stickers yet — import PNG, JPEG, WebP, SVG, GIF or APNG files.")}</Text> : null}
              </>
            ) : (
              <>
                {recents.length > 0 ? section(t("Recently used"), recents) : null}
                {section(t("Emoji"), featured.map((row) => emojiTile(row[0], row[2])), <Button size="xs" kind="ghost" label={t("See all")} testID="stickers-see-all-emoji" onPress={() => setSettings({ ...settings, category: "emoji" })} />)}
                {section(t("Shapes"), shapeTiles)}
                {section(t("My stickers"), myTiles, importButton)}
              </>
            )}
        </ScrollView>
      )}
    </View>
  );
}

/** A 72 px tile of the grid: a click adds the item, a drag carries it to the timeline or the canvas. */
function StickerTile(props: { name: string; testID: string; disabled: boolean; /** What a drag carries; `null` for a tile that is only pressed. */ payload: string | null; onPress(): void; children: ReactNode }) {
  const theme = useTheme();
  const node = useRef<View>(null);
  useEffect(() => (props.disabled ? undefined : bindDrag(node.current, () => props.payload)), [props.payload, props.disabled]);
  return (
    <View ref={node}>
      <Tap role="button" label={props.name} disabled={props.disabled} testID={props.testID} tooltip={{ label: props.name }} onPress={props.onPress}
        style={(state) => ({ width: TILE, height: TILE, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: radius.md, borderWidth: 1, borderColor: theme.color(state.hovered ? "border/strong" : "border/hairline"), backgroundColor: theme.color("bg/subtle") })}>
        {props.children}
      </Tap>
    </View>
  );
}
function ShapeTile(props: { item: ShapeItem; disabled: boolean; onPress(): void }) {
  const t = useT();
  const theme = useTheme();
  // A line has no area: its tile shows the stroke itself.
  const stroked = props.item.id === "line";
  return (
    <StickerTile name={t(props.item.name)} testID={`shape-${props.item.id}`} disabled={props.disabled} payload={payloadOf({ shape: props.item.id })} onPress={props.onPress}>
      <Svg width={40} height={40} viewBox="0 0 100 100"><Path d={shapeOutline(props.item.id)} fill={stroked ? "none" : theme.color("text/primary")} stroke={stroked ? theme.color("text/primary") : "none"} strokeWidth={stroked ? 8 : 0} strokeLinecap="round" /></Svg>
    </StickerTile>
  );
}
/** An imported sticker: its own file as the tile (an animated one plays in the tile), with a remove button under the pointer. */
function UserTile(props: { entry: UserSticker; disabled: boolean; payload: string; onPress(): void; onRemove?(): void }) {
  const t = useT();
  const runtime = useEditor();
  const [url, setUrl] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => { let alive = true; void runtime.media.mediaUrl(props.entry.assetId).then((made) => { if (alive) setUrl(made); }).catch(() => undefined); return () => { alive = false; }; }, [runtime, props.entry.assetId]);
  return (
    <View {...({ onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } as object)}>
      <StickerTile name={props.entry.name} testID={`sticker-user-${props.entry.sha256.slice(0, 8)}`} disabled={props.disabled} payload={props.payload} onPress={props.onPress}>
        {url ? <View style={[{ width: 56, height: 56 }, { backgroundImage: `url("${url}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } as object]} /> : <Icon name="image" size={24} color="text/secondary" />}
      </StickerTile>
      {props.onRemove && hovered ? <View style={{ position: "absolute", right: 2, top: 2 }}><IconButton icon="x" size="xs" label={t("Remove {name} from My stickers", { name: props.entry.name })} testID="sticker-user-remove" onPress={props.onRemove} /></View> : null}
    </View>
  );
}

/** A sticker of the device's Library that is not in the project yet: its own file as the tile; a press brings it into the project and adds it. */
function LibraryTile(props: { item: LibraryItem; storage: StoragePort | null; disabled: boolean; onPress(): void }) {
  const [url, setUrl] = useState<string | null>(null);
  const stored = props.item.stored;
  useEffect(() => {
    if (!props.storage || !stored) return;
    let made: string | null = null, alive = true;
    void itemBytes(props.storage, stored).then((bytes) => { if (alive && bytes) { made = objectUrl(bytes, stored.mime ?? mimeOfFile(stored.file)); setUrl(made); } }).catch(() => undefined);
    return () => { alive = false; if (made) releaseUrl(made); };
  }, [props.storage, stored?.file]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <StickerTile name={props.item.name} testID={`sticker-library-${(stored?.sha256 ?? props.item.id).slice(0, 8)}`} disabled={props.disabled} payload={null} onPress={props.onPress}>
      {url ? <View style={[{ width: 56, height: 56 }, { backgroundImage: `url("${url}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } as object]} /> : <Icon name="image" size={24} color="text/secondary" />}
    </StickerTile>
  );
}

/** The controls of the Draw tool: brush, colour, size, undo and redo of strokes, Done and Cancel. */
function DrawPanel(props: { onDone(): void }) {
  const t = useT();
  const state = useDraw();
  return (
    <View testID="draw-panel" style={{ flex: 1, minHeight: 0, padding: space[3], gap: space[3] }}>
      <Text variant="body-medium">{t("Draw")}</Text>
      <Text variant="meta" color="text/secondary">{t("Draw on the preview. Done makes one drawing of your strokes at the playhead.")}</Text>
      <View testID="draw-tool"><Segmented label={t("Brush")} size="sm" value={state.tool} options={[{ value: "pen", label: t("Pen") }, { value: "marker", label: t("Marker") }, { value: "eraser", label: t("Eraser") }]} onChange={(tool) => draw.setTool(tool)} /></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="meta" color="text/secondary" style={{ width: 56 }}>{t("Colour")}</Text>
        <View style={{ flex: 1 }} testID="draw-colour"><ColorPicker label={t("Brush colour")} value={state.color.toUpperCase()} defaultValue="#FFFFFF" onChange={(color) => draw.setColor(color.toLowerCase())} onCommit={(color) => draw.setColor(color.toLowerCase())} /></View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }} testID="draw-size">
        <Text variant="meta" color="text/secondary" style={{ width: 56 }}>{t("Size")}</Text>
        <View style={{ flex: 1 }}><Slider label={t("Brush size")} min={1} max={200} step={1} value={state.width} defaultValue={12} onChange={(next) => draw.setWidth(next as number)} onCommit={(next) => draw.setWidth(next as number)} /></View>
        <NumberField label={t("Brush size")} hideLabel size="sm" width={64} unit="px" min={1} max={200} step={1} value={state.width} onCommit={(next) => draw.setWidth(next)} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <IconButton icon="undo" size="sm" variant="outline" label={t("Undo stroke")} testID="draw-undo" disabled={state.past.length === 0} onPress={() => draw.undo()} />
        <IconButton icon="redo" size="sm" variant="outline" label={t("Redo stroke")} testID="draw-redo" disabled={state.future.length === 0} onPress={() => draw.redo()} />
        <Text variant="meta" color="text/secondary" testID="draw-count" style={{ flex: 1 }}>{t(state.strokes.length === 1 ? "1 stroke" : "{n} strokes", { n: state.strokes.length })}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <View style={{ flex: 1 }} />
        <Button size="sm" label={t("Cancel")} testID="draw-cancel" onPress={() => { draw.finish(); }} />
        <Button size="sm" kind="primary" label={t("Done")} testID="draw-done" disabled={state.strokes.length === 0} onPress={props.onDone} />
      </View>
    </View>
  );
}
