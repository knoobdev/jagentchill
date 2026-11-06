import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { canvasRect, clampCropTo, CROP_NONE, hitTest, toCanvas, toScreen, type Box, type Crop, type PreviewView } from "@jagentchill/app-core";
import {
  addPathPoint, averageColor, dragMaskHandle, editPathPoints, featherFromDrag, isKeyable, isMaskable, maskFrame, maskHandlePoints, maskHas, maskParamAt, masksOf, removePathPoints, rotationFromDrag, setChromaKey, setElementFields, setMaskParams, setPathClosed,
  timeline, type MaskEntry, type MaskHandle,
} from "@jagentchill/editor-core";
import { Button, Icon, Text, radius, space, useTheme, dragHandle } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor, useEditorContent, useSettledTransport } from "../context";
import { bindPointer, objectUrl, releaseUrl } from "../dom";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type PathPoint = { id: string; x: number; y: number };
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const turn = (point: Point, degrees: number): Point => ({ x: point.x * Math.cos(rad(degrees)) - point.y * Math.sin(rad(degrees)), y: point.x * Math.sin(rad(degrees)) + point.y * Math.cos(rad(degrees)) });
const HIT = 9;

/**
 * What the inspector's tools draw and take on the canvas: the handles of the selected mask, the crop frame, the
 * eyedropper of the chroma key, in-place text editing and the Before / After divider of Compare. While one of them
 * is active it receives the pointer before selection and the transform handles do.
 */
export function CanvasTools(props: { view: PreviewView; viewport: Size; canvas: Size; boxes: Box[] }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorContent();
  // Without the running clock: nothing of this is drawn while it plays.
  const transport = useSettledTransport();
  const { controller } = runtime, tool = runtime.tool, { view, viewport, canvas, boxes } = props;
  const [badge, setBadge] = useState<string | null>(null);
  const selectedIds = controller.session.selection.selectedElements, single = selectedIds.length === 1 ? timeline.locate(controller.document, selectedIds[0])?.element ?? null : null;
  const box = single ? boxes.find((entry) => entry.id === single.id) ?? null : null;
  const local = single ? Math.min(single.duration, Math.max(0, transport.time - single.startTime)) : 0;
  const mask = single && tool.inspector === "mask" && isMaskable(single) ? masksOf(single).find((entry) => entry.id === tool.maskId) ?? null : null;
  const cropping = single && tool.crop === single.id ? single : null;
  const mode = transport.playing ? "none" : tool.eyedropper && single && isKeyable(single) ? "eyedropper" : cropping && box ? "crop" : mask && box ? "mask" : "none";
  const scale = canvasRect(view, viewport, canvas).scale;
  const screen = (point: Point) => toScreen(point, view, viewport, canvas);
  const at = (key: string) => Number(maskParamAt(single!, mask!, key, local) ?? 0);
  const live = useRef({ mode, single, box, mask, local, view, viewport, canvas, scale, tool, boxes });
  live.current = { mode, single, box, mask, local, view, viewport, canvas, scale, tool, boxes };

  useEffect(() => runtime.registerCanvasTool({
    get hidesHandles() { return live.current.mode !== "none" || live.current.tool.textEdit !== null; },
    down(info) {
      const state = live.current, element = state.single, playhead = controller.session.playhead;
      // A press on the canvas outside the field ends an edit of text in place (the stage keeps the focus from moving on its own).
      if (state.tool.textEdit) { endTextEdit.current?.(); return null; }
      if (state.mode === "none" || !element) return undefined;
      const point = toCanvas({ x: info.x, y: info.y }, state.view, state.viewport, state.canvas);
      if (state.mode === "eyedropper") {
        // The clip's own picture under the pointer, before its key: the engine averages a 5 × 5 block of it. A press
        // beside the picture picks nothing and leaves the tool on.
        // `point` has its origin at the canvas centre; the engine takes canvas pixels from the top left.
        void runtime.engine?.sampleSource(element.id, point.x + state.canvas.width / 2, point.y + state.canvas.height / 2).then((color) => {
          if (!color) return;
          controller.external((doc, ctx) => setChromaKey(doc, ctx, element.id, { color, enabled: true }));
          runtime.setTool({ eyedropper: false });
        });
        return null;
      }
      const elementBox = state.box!;
      if (state.mode === "crop") {
        const stored = { ...CROP_NONE, ...((element.crop ?? {}) as Partial<Crop>) };
        const corners = cropHandles(elementBox), hit = (Object.keys(corners) as CropHandle[]).find((id) => Math.hypot(corners[id].x - point.x, corners[id].y - point.y) * state.scale <= HIT + 3);
        if (!hit) return null;
        // The box on screen is the cropped picture: its full size follows from the stored crop.
        const full = { width: elementBox.width / Math.max(0.01, 1 - stored.left - stored.right), height: elementBox.height / Math.max(0.01, 1 - stored.top - stored.bottom) };
        const next = (pointer: Point): Crop => {
          const moved = turn({ x: pointer.x - point.x, y: pointer.y - point.y }, -elementBox.rotation), crop = { ...stored };
          if (hit.includes("w")) crop.left = stored.left + moved.x / full.width; if (hit.includes("e")) crop.right = stored.right - moved.x / full.width;
          if (hit.includes("n")) crop.top = stored.top + moved.y / full.height; if (hit.includes("s")) crop.bottom = stored.bottom - moved.y / full.height;
          for (const side of ["left", "right", "top", "bottom"] as const) crop[side] = Math.round(Math.min(0.98, Math.max(0, crop[side])) * 1e4) / 1e4;
          return clampCropTo(crop, full);
        };
        const write = (pointer: { x: number; y: number }, isLive: boolean) => controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { crop: next(toCanvas(pointer, state.view, state.viewport, state.canvas)) }, { commandType: "element.crop", label: "Crop" }), isLive);
        return { move: (pointer: Point) => { write(pointer, true); }, up: (pointer: Point) => { controller.discardPreview(); write(pointer, false); }, cancel: () => controller.discardPreview() } as never;
      }
      const target = state.mask!, value = (key: string) => Number(maskParamAt(element, target, key, state.local) ?? 0);
      const frame = maskFrame(elementBox, target, value), handles = maskHandlePoints(frame, target.type, 20 / state.scale);
      const start: Record<string, number> = Object.fromEntries(["centerX", "centerY", "width", "height", "scale", "rotation", "size", "cornerRadius", "feather"].map((key) => [key, value(key)]));
      const write = (params: Record<string, number>, isLive: boolean, label: string) => { if (Object.keys(params).length > 0) controller.external((doc, ctx) => setMaskParams(doc, ctx, element.id, target.id, params, playhead, label), isLive); };
      const session = (compute: (pointer: Point & { shift: boolean; mod: boolean }) => Record<string, number>, label: string, show?: (params: Record<string, number>) => string) => ({
        move: (pointer: Point & { shift: boolean; mod: boolean }) => { const params = compute({ ...pointer, ...toCanvas(pointer, state.view, state.viewport, state.canvas) }); if (show) setBadge(show(params)); write(params, true, label); },
        up: (pointer: Point & { shift: boolean; mod: boolean }) => { const params = compute({ ...pointer, ...toCanvas(pointer, state.view, state.viewport, state.canvas) }); setBadge(null); controller.discardPreview(); if (pointer.x !== info.x || pointer.y !== info.y) write(params, false, label); },
        cancel: () => { setBadge(null); controller.discardPreview(); },
      }) as never;
      // Pen points come first: a point drags, a click on the first point of an open path closes it, a click elsewhere adds a point.
      if (target.type === "freeform") {
        const path = (Array.isArray(target.params.path) ? target.params.path : []) as PathPoint[], half = { x: (elementBox.width / 2) * (value("scale") || 1), y: (elementBox.height / 2) * (value("scale") || 1) };
        const toPath = (canvasPoint: Point): Point => { const own = turn({ x: canvasPoint.x - frame.cx, y: canvasPoint.y - frame.cy }, -frame.rotation); return { x: own.x / half.x, y: own.y / half.y }; };
        const fromPath = (pathPoint: Point): Point => { const placed = turn({ x: pathPoint.x * half.x, y: pathPoint.y * half.y }, frame.rotation); return { x: frame.cx + placed.x, y: frame.cy + placed.y }; };
        const hitPoint = path.find((entry) => { const placed = fromPath(entry); return Math.hypot(placed.x - point.x, placed.y - point.y) * state.scale <= HIT; });
        if (hitPoint) {
          if (hitPoint === path[0] && target.params.closed !== true && path.length >= 3) { controller.external((doc, ctx) => setPathClosed(doc, ctx, element.id, target.id, true)); return null; }
          const picked = info.shift ? [...new Set([...state.tool.maskPoints, hitPoint.id])] : state.tool.maskPoints.includes(hitPoint.id) ? state.tool.maskPoints : [hitPoint.id];
          runtime.setTool({ maskPoints: picked });
          const from = toPath(point);
          const drag = (pointer: Point, isLive: boolean) => { const now = toPath(toCanvas(pointer, state.view, state.viewport, state.canvas)); controller.external((doc, ctx) => editPathPoints(doc, ctx, element.id, target.id, picked, { dx: now.x - from.x, dy: now.y - from.y }), isLive); };
          return { move: (pointer: Point) => drag(pointer, true), up: (pointer: Point) => { controller.discardPreview(); if (pointer.x !== info.x || pointer.y !== info.y) drag(pointer, false); }, cancel: () => controller.discardPreview() } as never;
        }
        if (target.params.closed !== true) { const made = toPath(point); if (Math.abs(made.x) <= 1.5 && Math.abs(made.y) <= 1.5) controller.external((doc, ctx) => addPathPoint(doc, ctx, element.id, target.id, made)); return null; }
      }
      const hit = (Object.keys(handles) as MaskHandle[]).filter((id) => id !== "move").find((id) => Math.hypot(handles[id]!.x - point.x, handles[id]!.y - point.y) * state.scale <= HIT + 2);
      if (hit === "rotate") return session((pointer) => ({ rotation: rotationFromDrag(start.rotation, { x: frame.cx, y: frame.cy }, point, pointer, pointer.shift) }), "Rotate mask", (params) => `${Math.round(params.rotation)}°`);
      if (hit === "feather") {
        // The feather grows with the distance dragged along the handle's own direction, in screen px.
        const axis = turn({ x: 0, y: 1 }, frame.rotation);
        return session((pointer) => ({ feather: featherFromDrag(start.feather, ((pointer.x - point.x) * axis.x + (pointer.y - point.y) * axis.y) * state.scale) }), "Feather", (params) => t("Feather {n}%", { n: Math.round(params.feather / 10) }));
      }
      if (hit) return session((pointer) => dragMaskHandle(target, elementBox, start, hit, { x: pointer.x - point.x, y: pointer.y - point.y }), "Resize mask");
      // The body of the shape moves it; a press outside it is left to selection.
      const own = turn({ x: point.x - frame.cx, y: point.y - frame.cy }, -frame.rotation), inside = frame.shape === "line" ? Math.abs(own.y) * state.scale <= 12 : frame.shape === "band" ? Math.abs(own.y) <= frame.height / 2 + 6 / state.scale : Math.abs(own.x) <= frame.width / 2 && Math.abs(own.y) <= frame.height / 2;
      if (!inside) return undefined;
      return session((pointer) => dragMaskHandle(target, elementBox, start, "move", { x: pointer.x - point.x, y: pointer.y - point.y }, { snap: !pointer.mod, shift: pointer.shift }), "Move mask");
    },
    double(info) {
      const state = live.current, point = toCanvas(info, state.view, state.viewport, state.canvas);
      // A double-click on a text clip edits its words in place.
      const hit = hitTest(state.boxes, point).map((id) => ({ id }))[0];
      const element = hit ? timeline.locate(controller.stored, hit.id)?.element : undefined;
      if (!element || element.type !== "text" || runtime.transport.playing) return false;
      controller.select(timeline.selectElements([element.id]));
      runtime.setTool({ textEdit: element.id });
      return true;
    },
    key(key) {
      const state = live.current;
      if (key.type !== "down") return false;
      if (key.key === "Escape" && state.tool.maskPoints.length > 0) { runtime.setTool({ maskPoints: [] }); return true; }
      if ((key.key === "Delete" || key.key === "Backspace") && state.mode === "mask" && state.tool.maskPoints.length > 0 && state.single && state.mask) { const element = state.single, target = state.mask, ids = state.tool.maskPoints; controller.external((doc, ctx) => removePathPoints(doc, ctx, element.id, target.id, ids)); runtime.setTool({ maskPoints: [] }); return true; }
      if (key.key === "Escape" && state.tool.crop) { runtime.setTool({ crop: null }); return true; }
      return false;
    },
  }), [runtime, controller, t]);

  const outline = theme.color("preview/handle-fill"), border = theme.color("preview/handle-border");
  const dot = (id: string, point: Point, round = false) => { const placed = screen(point); return <View key={id} testID={`mask-handle-${id}`} pointerEvents="none" style={{ position: "absolute", left: placed.x - 5, top: placed.y - 5, width: 10, height: 10, borderRadius: round ? 5 : 1, backgroundColor: outline, borderWidth: 1, borderColor: border }} />; };
  let content = null;
  if (mode === "mask" && mask && box) {
    const frame = maskFrame(box, mask, at), handles = maskHandlePoints(frame, mask.type, 20 / scale), centre = screen({ x: frame.cx, y: frame.cy });
    const width = frame.width * scale, height = frame.height * scale, feather = (at("feather") * 0.11);
    const path = (Array.isArray(mask.params.path) ? mask.params.path : []) as PathPoint[], half = { x: (box.width / 2) * (at("scale") || 1), y: (box.height / 2) * (at("scale") || 1) };
    const pathScreen = path.map((entry) => { const placed = turn({ x: entry.x * half.x, y: entry.y * half.y }, frame.rotation); return { id: entry.id, ...screen({ x: frame.cx + placed.x, y: frame.cy + placed.y }) }; });
    content = (
      <View testID="mask-overlay" pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        {mask.type === "freeform" ? (
          <Svg width={viewport.width} height={viewport.height} style={{ position: "absolute", left: 0, top: 0 }}>
            {pathScreen.length > 1 ? <Path d={`${pathScreen.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ")}${mask.params.closed === true ? " Z" : ""}`} stroke={outline} strokeWidth={1.5} fill="none" /> : null}
            {pathScreen.map((point) => <Circle key={point.id} cx={point.x} cy={point.y} r={tool.maskPoints.includes(point.id) ? 5 : 4} fill={tool.maskPoints.includes(point.id) ? border : outline} stroke={border} strokeWidth={1.5} />)}
          </Svg>
        ) : frame.shape === "line" ? (
          <View style={{ position: "absolute", left: centre.x - width / 2, top: centre.y - 1, width, height: 2, backgroundColor: outline, transform: [{ rotate: `${frame.rotation}deg` }] }} />
        ) : (
          <>
            {feather > 0 ? <View testID="mask-feather-outline" style={{ position: "absolute", left: centre.x - width / 2 - feather, top: centre.y - height / 2 - feather, width: width + feather * 2, height: height + feather * 2, borderWidth: 1, borderStyle: "dashed", borderColor: outline, opacity: 0.8, borderRadius: mask.type === "ellipse" ? 9999 : 0, transform: [{ rotate: `${frame.rotation}deg` }] }} /> : null}
            <View testID="mask-outline" style={{ position: "absolute", left: centre.x - width / 2, top: centre.y - height / 2, width, height, borderWidth: frame.shape === "band" ? 0 : 1.5, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: outline, borderRadius: mask.type === "ellipse" ? 9999 : 0, transform: [{ rotate: `${frame.rotation}deg` }] }} />
          </>
        )}
        {(Object.keys(handles) as MaskHandle[]).filter((id) => id !== "move" && id !== "rotate" && id !== "feather").map((id) => dot(id, handles[id]!, id === "radius"))}
        {handles.rotate ? (() => { const placed = screen(handles.rotate!); return <View testID="mask-handle-rotate" style={{ position: "absolute", left: placed.x - 9, top: placed.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: outline, borderWidth: 1, borderColor: border, alignItems: "center", justifyContent: "center" }}><Icon name="rotate" size={12} color="preview/handle-border" /></View>; })() : null}
        {handles.feather ? (() => { const placed = screen(handles.feather!); return <View testID="mask-handle-feather" style={{ position: "absolute", left: placed.x - 9, top: placed.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: outline, borderWidth: 1, borderColor: border, alignItems: "center", justifyContent: "center" }}><Icon name="chev-u" size={12} color="preview/handle-border" /></View>; })() : null}
        {badge && handles.feather ? (() => { const placed = screen(handles.feather!); return <View testID="mask-badge" style={{ position: "absolute", left: placed.x + 16, top: placed.y - 10, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{badge}</Text></View>; })() : null}
        {mask.type === "freeform" && !maskHas(mask.type, "width") && path.length === 0 ? <View style={{ position: "absolute", left: centre.x - 110, top: centre.y - 12, width: 220, alignItems: "center" }}><View style={{ paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label">{t("Click to place points; click the first point to close")}</Text></View></View> : null}
      </View>
    );
  } else if (mode === "crop" && box) {
    const corners = cropHandles(box), centre = screen({ x: box.cx, y: box.cy }), width = box.width * scale, height = box.height * scale;
    content = (
      <View testID="crop-overlay" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
        <View pointerEvents="none" style={{ position: "absolute", left: centre.x - width / 2, top: centre.y - height / 2, width, height, borderWidth: 1.5, borderColor: outline, transform: [{ rotate: `${box.rotation}deg` }] }}>
          {[1, 2].map((third) => <View key={`v${third}`} style={{ position: "absolute", left: `${(third * 100) / 3}%`, top: 0, bottom: 0, width: 1, backgroundColor: outline, opacity: 0.5 } as object} />)}
          {[1, 2].map((third) => <View key={`h${third}`} style={{ position: "absolute", top: `${(third * 100) / 3}%`, left: 0, right: 0, height: 1, backgroundColor: outline, opacity: 0.5 } as object} />)}
        </View>
        {(Object.keys(corners) as CropHandle[]).map((id) => { const placed = screen(corners[id]); return <View key={id} testID={`crop-handle-${id}`} pointerEvents="none" style={{ position: "absolute", left: placed.x - 6, top: placed.y - 6, width: 12, height: 12, backgroundColor: outline, borderWidth: 1.5, borderColor: border }} />; })}
        <View testID="crop-bar" style={{ position: "absolute", left: centre.x - 110, top: Math.min(viewport.height - 40, centre.y + height / 2 + 12), width: 220, flexDirection: "row", justifyContent: "center", gap: space[1.5] }}>
          <Button size="xs" kind="secondary" label={t("Reset")} testID="crop-canvas-reset" onPress={() => controller.external((doc, ctx) => setElementFields(doc, ctx, cropping!.id, { crop: CROP_NONE }, { commandType: "element.crop", label: "Crop" }))} />
          <Button size="xs" kind="primary" label={t("Done")} testID="crop-canvas-done" onPress={() => runtime.setTool({ crop: null })} />
        </View>
      </View>
    );
  } else if (mode === "eyedropper") {
    content = <View testID="eyedropper-overlay" pointerEvents="none" style={{ position: "absolute", left: space[2], top: space[2], flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Icon name="eyedrop" size={14} color="clip/label" /><Text variant="caption" color="clip/label">{t("Click the colour to remove in the preview")}</Text></View>;
  }
  const editing = tool.textEdit ? timeline.locate(controller.document, tool.textEdit)?.element ?? null : null, editBox = editing ? boxes.find((entry) => entry.id === editing.id) ?? null : null;
  return (
    <>
      {content}
      {editing && editBox ? <TextEdit key={editing.id} element={editing} box={editBox} scale={scale} centre={screen({ x: editBox.cx, y: editBox.cy })} /> : null}
      {tool.compare === "split" ? <CompareSplit view={view} viewport={viewport} canvas={canvas} /> : null}
    </>
  );
}

/** Overrides are merged into the element: the look is bypassed by switching each of its sections off. */
const LOOK_BYPASS = { adjustments: { basic: { enabled: false }, hsl: { enabled: false }, curves: { enabled: false }, wheels: { enabled: false }, lut: { enabled: false } } };
/** Ends the open in-place text edit, keeping what was typed. */
const endTextEdit: { current: (() => void) | null } = { current: null };
type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
/** The eight handles of the crop frame, on the box of the cropped picture. */
function cropHandles(box: Box): Record<CropHandle, Point> {
  const w = box.width / 2, h = box.height / 2, place = (x: number, y: number) => { const placed = turn({ x, y }, box.rotation); return { x: box.cx + placed.x, y: box.cy + placed.y }; };
  return { nw: place(-w, -h), n: place(0, -h), ne: place(w, -h), e: place(w, 0), se: place(w, h), s: place(0, h), sw: place(-w, h), w: place(-w, 0) };
}

/** The words of a text clip, typed where they are drawn: every keystroke is shown at once and leaving the field records one step. */
function TextEdit(props: { element: timeline.El; box: Box; scale: number; centre: Point }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  // The words as they were when the edit began: what is drawn meanwhile is the live draft.
  const [stored] = useState(() => String(props.element.content ?? "")), id = props.element.id;
  const [draft, setDraft] = useState(stored);
  const done = useRef(false);
  const write = (content: string, isLive: boolean) => runtime.controller.external((doc, ctx) => setElementFields(doc, ctx, id, { content }, { commandType: "element.text", label: "Edit text" }), isLive);
  const finish = (keep: boolean) => { if (done.current) return; done.current = true; endTextEdit.current = null; runtime.controller.discardPreview(); if (keep && draft !== stored) write(draft, false); runtime.setTool({ textEdit: null }); };
  endTextEdit.current = () => finish(true);
  const width = Math.max(120, props.box.width * props.scale + 24), height = Math.max(32, props.box.height * props.scale + 12), lines = Math.max(1, draft.split("\n").length);
  return (
    <TextInput testID="canvas-text-edit" autoFocus multiline selectTextOnFocus accessibilityLabel={t("Edit text")} aria-label={t("Edit text")} value={draft} onChangeText={(text) => { setDraft(text); write(text, true); }} onBlur={() => finish(true)}
      {...({ onKeyPress: (event: { nativeEvent: { key: string }; preventDefault(): void }) => { if (event.nativeEvent.key === "Escape") { event.preventDefault(); finish(false); } } } as object)}
      // The engine draws the words; the field carries the caret and the selection over them.
      style={{ position: "absolute", left: props.centre.x - width / 2, top: props.centre.y - height / 2, width, height, textAlign: "center", fontSize: Math.max(10, (height - 12) / lines / 1.25), lineHeight: Math.max(12, (height - 12) / lines), color: "transparent", caretColor: theme.color("preview/handle-fill"), borderWidth: 1, borderStyle: "dashed", borderColor: theme.color("preview/handle-fill"), borderRadius: radius.sm, backgroundColor: "transparent", outlineWidth: 0, padding: 6, transform: [{ rotate: `${props.box.rotation}deg` }] } as object} />
  );
}

/** Compare, split view: the frame without the look of the selection on the left of a divider that drags, the result on the right. */
function CompareSplit(props: { view: PreviewView; viewport: Size; canvas: Size }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  // Without the running clock: nothing of this is drawn while it plays.
  const transport = useSettledTransport();
  const [before, setBefore] = useState<string | null>(null);
  const node = useRef<View>(null);
  const rect = canvasRect(props.view, props.viewport, props.canvas), split = runtime.tool.split;
  const live = useRef(rect);
  live.current = rect;
  const selection = runtime.controller.session.selection.selectedElements.join("|"), revision = runtime.controller.version, time = transport.time, playing = transport.playing;
  // "Before" is a still of this frame rendered with the look of the selection bypassed.
  useEffect(() => {
    if (playing) return;
    let stale = false, made: string | null = null;
    const timer = setTimeout(() => void (async () => {
      const engine = runtime.engine, document = runtime.controller.document;
      if (!engine) return;
      const overrides = Object.fromEntries(runtime.controller.session.selection.selectedElements.flatMap((id) => { const element = timeline.locate(document, id)?.element; return element ? [[id, LOOK_BYPASS]] : []; }));
      await engine.setOverride(overrides);
      const bytes = await engine.still(time, "jpeg");
      await engine.setOverride({});
      if (stale || !bytes) return;
      made = objectUrl(bytes, "image/jpeg");
      setBefore((old) => { if (old) releaseUrl(old); return made; });
    })(), 120);
    return () => { stale = true; clearTimeout(timer); };
  }, [runtime, selection, revision, time, playing]);
  useEffect(() => () => setBefore((old) => { if (old) releaseUrl(old); return null; }), []);
  useEffect(() => bindPointer(node.current, { down() { const to = (pointer: { x: number }) => runtime.setTool({ split: Math.min(1, Math.max(0, pointer.x / live.current.width)) }); return { move: to, up: to }; } }), [runtime]);
  const label = (text: string, side: object) => <View pointerEvents="none" style={[{ position: "absolute", top: space[2], paddingHorizontal: space[2], height: 20, justifyContent: "center", borderRadius: radius.full, backgroundColor: theme.color("clip/label-scrim") }, side]}><Text variant="caption" color="clip/label">{text}</Text></View>;
  return (
    <View ref={node} {...dragHandle("ew-resize")} testID="compare-split" style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, overflow: "hidden" }}>
      {before ? <View pointerEvents="none" testID="compare-before" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: rect.width * split, overflow: "hidden" }]}><View style={[{ width: rect.width, height: rect.height }, { backgroundImage: `url("${before}")`, backgroundSize: "100% 100%" } as object]} /></View> : null}
      <View pointerEvents="none" testID="compare-divider" style={{ position: "absolute", left: rect.width * split - 1, top: 0, bottom: 0, width: 2, backgroundColor: theme.color("preview/handle-fill") }} />
      {label(t("Before"), { left: space[2] })}{label(t("After"), { right: space[2] })}
    </View>
  );
}
