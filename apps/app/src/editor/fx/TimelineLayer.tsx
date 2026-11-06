import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { boxFromBounds, EDITOR_PREFS, FX_PREFS, hitCandidates, hitTest, TIMELINE_FRAME, rowAtY, type FxTile, type TimelineRow } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import { ConfirmDialog, Icon, Menu, Tap, Text, radius, space, useTheme, useToast, type MenuItem, dragHandle } from "@jagentchill/ui";
import { useT } from "../../locale";
import { getPref, setPref } from "../../state";
import { tileOfPayload } from "../assets/FxLibrary";
import { bindCanvasDrop } from "../content-dom";
import { useEditor, useEditorVersion } from "../context";
import { bindDropZone, bindPointer } from "../dom";
import { acceptsTile, addDefaultTransitions, applyTransitionTile, dropEffectAt, dropEffectOnClip, endTransitionLoop, showAssetTab, type FxUi } from "./actions";
import { copiedEffects, setCopiedEffects } from "./clipboard";
import { onTracksPress, tracksElement } from "./dom";
import { useFx } from "./store";

const HANDLE = TIMELINE_FRAME.transitionHandle;
const cutKey = (cut: timeline.Cut): string => `${cut.fromId}>${cut.toId}`;
/** The centre line of a transition handle in its row: the middle of the filmstrip under the clip header. */
const handleY = (row: TimelineRow): number => row.top + TIMELINE_FRAME.clipHeader + (row.baseHeight - TIMELINE_FRAME.clipHeader) / 2;

/**
 * What transitions, effects and filters draw over the tracks: the handle of every transition and the "+" of a cut
 * under the pointer, the window of the selected transition with its draggable edges, the drop zones of a tile that is
 * being dragged from a library tab, and the wand of a clip that has effects.
 */
export function FxTimelineLayer(props: { rows: TimelineRow[]; zoomLevel: number; scrollLeft: number; scrollTop: number; viewportWidth: number; /** Touch has no hover: the "+" of every eligible cut is always drawn. */ showCuts?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const fx = useFx(runtime);
  const { controller } = runtime, session = controller.session, document = controller.document;
  const scene = timeline.sceneById(document, session.sceneId), fps = document.settings.fps as Rational;
  const [zones, setZones] = useState<string[]>([]);
  const [dropClip, setDropClip] = useState<string | null>(null);
  const [hoverCut, setHoverCut] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [removeAll, setRemoveAll] = useState(false);
  const ui: FxUi = useMemo(() => ({ t, toast: (message, tone) => toast.show({ kind: tone ?? "info", message }) }), [t, toast]);
  const live = useRef({ ...props, ui });
  live.current = { ...props, ui };
  const cuts = useMemo(() => timeline.eligibleCuts(scene), [scene]);
  const x = (time: number) => timeline.ticksToPixels(time, props.zoomLevel);

  // — A tile dragged from a library tab: a transition lands on a cut, an effect or filter on a clip or on an empty part of the tracks —
  useEffect(() => {
    const at = (info: { x: number; y: number }) => { const state = live.current, contentX = Math.max(0, info.x + state.scrollLeft); return { contentX, time: timeline.pixelsToTicks(contentX, state.zoomLevel), y: info.y + state.scrollTop }; };
    const target = (tile: FxTile, info: { x: number; y: number }) => {
      const state = live.current, point = at(info), stored = timeline.sceneById(controller.stored, controller.session.sceneId), hit = rowAtY(state.rows, point.y);
      if (tile.kind === "transition") {
        // Every eligible cut within 24 px of the pointer, on the row under it.
        const near = timeline.transitionDropZones(stored, point.contentX, (time) => timeline.ticksToPixels(time, state.zoomLevel)).filter((zone) => zone.cut.trackId === hit.row?.trackId);
        const nearest = near.reduce<(typeof near)[number] | null>((best, zone) => (!best || Math.abs(zone.x + 8 - point.contentX) < Math.abs(best.x + 8 - point.contentX) ? zone : best), null);
        return { cuts: near.map((zone) => zone.cut), cut: nearest?.cut ?? null, point };
      }
      const track = hit.row && point.y < hit.row.top + hit.row.baseHeight ? timeline.trackById(stored, hit.row.trackId) : undefined;
      const element = track?.elements.find((entry) => entry.startTime <= point.time && point.time < timeline.endOf(entry));
      return { element, locked: track?.locked === true, point };
    };
    return bindDropZone(tracksElement(), {
      over(info) {
        const tile = tileOfPayload(info.payload);
        if (!tile) return false;
        const found = target(tile, info);
        if (tile.kind === "transition") { setZones((found.cuts ?? []).map(cutKey)); return found.cut !== null && found.cut !== undefined; }
        const ok = found.element ? !found.locked && acceptsTile(tile, found.element) : !tile.body;
        setDropClip(found.element && ok ? found.element.id : null);
        return ok;
      },
      leave() { setZones([]); setDropClip(null); },
      drop(info) {
        const tile = tileOfPayload(info.payload);
        setZones([]); setDropClip(null);
        if (!tile) return;
        const found = target(tile, info), state = live.current;
        if (tile.kind === "transition") { if (found.cut) applyTransitionTile(runtime, tile, state.ui, found.cut); return; }
        if (found.element) dropEffectOnClip(runtime, tile, found.element.id, state.ui);
        else dropEffectAt(runtime, tile, timeline.seekTime(found.point.time, Number.MAX_SAFE_INTEGER, controller.stored.settings.fps as Rational), state.ui);
      },
    });
  }, [controller, runtime]);

  // — An effect or filter tile dropped on the preview goes on the topmost element under the pointer that accepts it —
  const canvas = document.settings.canvasSize;
  useEffect(() => bindCanvasDrop(canvas, (payload) => { const tile = tileOfPayload(payload); return tile !== null && tile.kind !== "transition"; }, (payload, point) => {
    const tile = tileOfPayload(payload), stored = controller.stored, time = controller.session.playhead;
    if (!tile) return;
    const ids = hitCandidates(stored, controller.session.sceneId, time);
    void runtime.engine?.layout(ids, time).then((found) => {
      const boxes = ids.flatMap((id) => (found[id] ? [boxFromBounds(id, found[id], found[id].rotation, stored.settings.canvasSize, found[id].width / Math.max(1, found[id].height))] : []));
      const hit = hitTest(boxes, point).find((id) => { const element = timeline.locate(stored, id)?.element; return element !== undefined && acceptsTile(tile, element); });
      if (hit) dropEffectOnClip(runtime, tile, hit, live.current.ui);
    });
  }), [canvas.width, canvas.height, controller, runtime]);

  // A press anywhere else on the tracks deselects the transition, like a press on empty space deselects a clip.
  useEffect(() => onTracksPress(() => { if (fx.state.transitionId !== null) fx.selectTransition(null); }), [fx]);

  // — Actions of the menus and the keys —
  useEffect(() => runtime.registerActions((actionId) => {
    const selected = fx.state.transitionId, elements = controller.session.selection.selectedElements, sceneId = controller.session.sceneId;
    switch (actionId) {
      case "transition.add-default": addDefaultTransitions(runtime, live.current.ui); return true;
      case "transition.remove-all": if (timeline.countTransitions(controller.stored, sceneId) > 0) setRemoveAll(true); return true;
      case "editor.cancel": case "selection.none": if (selected) fx.selectTransition(null); return false;
      case "transition.focus-duration": if (!selected) return false; fx.set({ focusDuration: fx.state.focusDuration + 1 }); return true;
      case "timeline.delete": case "timeline.ripple-delete": {
        if (!selected || elements.length > 0) return false;
        endTransitionLoop(runtime);
        controller.run(timeline.removeTransition(selected));
        return true;
      }
      case "effects.copy": { const clipboard = elements.length === 1 ? timeline.copyEffects(controller.stored, elements[0]) : null; if (clipboard) setCopiedEffects(clipboard); return true; }
      case "effects.paste": {
        const clipboard = copiedEffects();
        if (!clipboard || elements.length === 0) return true;
        const result = controller.run(timeline.pasteEffects({ sceneId, elementIds: elements, clipboard }));
        if (result.ok && result.info && result.info.notPasted > 0) live.current.ui.toast(live.current.ui.t("{n} effects not pasted (limit reached)", { n: result.info.notPasted }));
        return true;
      }
      case "effects.remove-filter": {
        const targets = elements.filter((id) => ((timeline.locate(controller.stored, id)?.element.effects ?? []) as timeline.StackEntry[]).some((entry) => entry.kind === "filter"));
        if (targets.length === 1) controller.run(timeline.removeFilter(targets[0]));
        else if (targets.length > 1) controller.run({ type: "effect.remove-filter", label: "Remove filter", run(draft, env) { for (const id of targets) timeline.removeFilter(id).run(draft, env); return { info: { removed: true } }; } });
        return true;
      }
      default: return false;
    }
  }), [controller, runtime, fx]);

  const handleMenu = (transitionId: string): MenuItem[] => [
    { id: "replace", label: t("Replace"), onSelect: () => { fx.selectTransition(transitionId); fx.set({ replace: { kind: "transition", transitionId } }); showAssetTab(runtime, "transitions"); } },
    { id: "remove", label: t("Remove transition"), danger: true, onSelect: () => { endTransitionLoop(runtime); controller.run(timeline.removeTransition(transitionId)); } },
    { type: "separator" },
    { id: "remove-all", label: t("Remove all transitions"), onSelect: () => setRemoveAll(true) },
  ];
  const addOnCut = (cut: timeline.Cut) => {
    const defaults = getPref(FX_PREFS.transitionDefaults);
    applyTransitionTile(runtime, { key: `transition:${defaults.type}`, kind: "transition", type: defaults.type, name: defaults.type, category: "", available: true, timeDriven: true, body: false }, ui, cut);
    showAssetTab(runtime, "transitions");
  };
  const count = timeline.countTransitions(controller.stored, session.sceneId);
  const left = props.scrollLeft - 200, right = props.scrollLeft + props.viewportWidth + 200;

  return (
    <>
      {cuts.map((cut) => {
        const row = props.rows.find((entry) => entry.trackId === cut.trackId), cx = x(cut.time);
        if (!row || cx < left || cx > right) return null;
        const key = cutKey(cut), zone = zones.includes(key);
        const record = cut.transitionId ? timeline.findTransition(document, cut.transitionId)?.record : undefined;
        if (!record) {
          const shown = props.showCuts === true || hoverCut === key || zone;
          return (
            <View key={key} testID={`tl-ctl-cut-${cut.toId}`} style={{ position: "absolute", left: cx - HANDLE / 2, top: handleY(row) - HANDLE / 2, width: HANDLE, height: HANDLE, zIndex: 4 }} {...({ onMouseEnter: () => setHoverCut(key), onMouseLeave: () => setHoverCut((current) => (current === key ? null : current)) } as object)}>
              {zone ? <View pointerEvents="none" testID="transition-drop-zone" style={{ position: "absolute", left: HANDLE / 2 - 8, top: 0, width: 16, height: HANDLE, borderRadius: radius.xs, backgroundColor: theme.color("accent/subtle"), borderWidth: 2, borderColor: theme.color("timeline/selection") }} /> : null}
              {shown && !row.locked ? (
                <Tap role="button" label={t("Add transition")} tooltip={{ label: t("Add transition") }} testID="transition-add" onPress={() => addOnCut(cut)}
                  style={[{ width: HANDLE, height: HANDLE, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/elevated"), borderWidth: 1, borderColor: theme.color("border/control") }, theme.elevation(1)]}>
                  <Icon name="plus" size={12} />
                </Tap>
              ) : null}
            </View>
          );
        }
        const track = timeline.trackById(scene, cut.trackId)!;
        return <TransitionHandle key={record.id} record={record} cut={cut} row={row} zoomLevel={props.zoomLevel} fps={fps} selected={fx.state.transitionId === record.id} dropZone={zone} warning={timeline.heldFrames(track, record, fps).warning} tip={fx.state.resizeTip?.transitionId === record.id ? fx.state.resizeTip.text : null}
          onMenu={(at) => { fx.selectTransition(record.id); setMenu({ at, items: handleMenu(record.id) }); }} />;
      })}
      {dropClip ? (() => {
        const hit = timeline.locate(document, dropClip), row = hit ? props.rows.find((entry) => entry.trackId === hit.track.id) : undefined;
        return hit && row ? <View pointerEvents="none" testID="effect-drop-target" style={{ position: "absolute", left: x(hit.element.startTime), top: row.top, width: x(hit.element.duration), height: row.baseHeight, borderRadius: radius.xs, borderWidth: 2, borderColor: theme.color("timeline/selection"), zIndex: 4 }} /> : null;
      })() : null}
      {props.rows.flatMap((row) => {
        const track = timeline.trackById(scene, row.trackId);
        return (track?.elements ?? []).filter((element) => element.type !== "effect" && timeline.hasEnabledEffects(element as never)).map((element) => {
          const start = x(element.startTime), width = x(element.duration), selected = session.selection.selectedElements.includes(element.id);
          if (start + width < left || start > right || !timeline.clipPresentation(document, element, width, { selected }).showHeader || width < 40) return null;
          const inset = selected ? TIMELINE_FRAME.trimHandle + 4 : 4;
          return (
            <Tap key={element.id} role="button" label={t("Effects: {name}", { name: element.name })} tooltip={{ label: t("Effects") }} testID={`tl-ctl-wand-${element.id}`}
              onPress={() => { controller.select(timeline.selectElements([element.id])); setPref(EDITOR_PREFS.inspectorTabs, { ...getPref(EDITOR_PREFS.inspectorTabs), [element.type]: "effects" }); }}
              style={{ position: "absolute", left: start + width - inset - 20, top: row.top + 1, width: 20, height: 16, zIndex: 4, borderRadius: radius.xs }} />
          );
        });
      })}
      <Menu open={menu !== null} anchor={{ x: menu?.at.x ?? 0, y: menu?.at.y ?? 0, width: 1, height: 1 }} items={menu?.items ?? []} label={t("Transition")} onClose={() => setMenu(null)} />
      <ConfirmDialog open={removeAll} title={t("Remove all transitions")} description={t("Remove {n} transitions from this scene?", { n: count })} confirmLabel={t("Remove all")} onClose={() => setRemoveAll(false)}
        onConfirm={() => { setRemoveAll(false); endTransitionLoop(runtime); fx.selectTransition(null); controller.run(timeline.removeAllTransitions(session.sceneId)); }} />
    </>
  );
}

/**
 * The handle of a transition on its cut: a press selects it, a horizontal drag changes the duration about the cut
 * (both edges move), and a selected one shows its window over the two clips, hatched.
 */
function TransitionHandle(props: { record: timeline.PictureTransition; cut: timeline.Cut; row: TimelineRow; zoomLevel: number; fps: Rational; selected: boolean; dropZone: boolean; warning: boolean; tip: string | null; onMenu(at: { x: number; y: number }): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const fx = useFx(runtime);
  const node = useRef<View>(null);
  const live = useRef(props);
  live.current = props;
  const { record, cut, row } = props, { controller } = runtime;
  const window = timeline.transitionWindow(cut.time, record.duration, props.fps);
  const start = timeline.ticksToPixels(window.start, props.zoomLevel), width = Math.max(HANDLE, timeline.ticksToPixels(record.duration, props.zoomLevel));
  // Unselected it takes the room of its chip only, so the clips under its window keep their own gestures.
  const centre = timeline.ticksToPixels(cut.time, props.zoomLevel), wide = props.selected || props.tip !== null;
  const boxLeft = wide ? Math.min(start, centre - HANDLE / 2) : centre - HANDLE / 2, boxWidth = wide ? Math.max(start + width, centre + HANDLE / 2) - boxLeft : HANDLE;
  const origin = useRef(0);
  origin.current = centre - boxLeft;
  useEffect(() => bindPointer(node.current, {
    down(info) {
      if (info.button !== 0) return null;
      const state = live.current, id = state.record.id;
      // The side of the cut the press is on decides which way is "outward".
      const element = node.current as unknown as { getBoundingClientRect(): { left: number } }, pressed = info.clientX - element.getBoundingClientRect().left;
      const side = pressed >= origin.current ? 1 : -1;
      let moved = false;
      return {
        move(next) {
          const dx = next.clientX - info.clientX;
          if (!moved && Math.abs(dx) < 3) return;
          moved = true;
          const delta = Math.sign(dx * side) * timeline.pixelsToTicks(Math.abs(dx), live.current.zoomLevel);
          const result = controller.preview(timeline.resizeTransition(id, Math.round(delta)));
          if (result.ok && result.info) fx.set({ resizeTip: { transitionId: id, text: result.info.tooltip } });
        },
        up() {
          if (moved) { controller.commitPreview(); fx.set({ resizeTip: null }); }
          fx.selectTransition(id);
        },
        cancel() { controller.discardPreview(); fx.set({ resizeTip: null }); },
      };
    },
    context(info) { live.current.onMenu({ x: info.clientX, y: info.clientY }); },
  }), [controller, fx]);
  const hatch = { backgroundImage: `repeating-linear-gradient(45deg, ${theme.color("timeline/selection")} 0 1px, transparent 1px 6px)` } as object;
  const name = timeline.transitionInspectorState(record).name, seconds = (record.duration / TICKS_PER_SECOND).toFixed(1);
  return (
    <View {...dragHandle("ew-resize")} ref={node} testID={`tl-ctl-transition-${record.id}`} nativeID={`transition-${record.id}`} role="button" aria-label={t("Transition: {name}, {seconds} s", { name: t(name), seconds })} aria-pressed={props.selected}
      {...({ dataSet: { type: record.type, duration: String(record.duration), selected: props.selected ? "true" : "false" } } as object)}
      style={{ position: "absolute", left: boxLeft, top: handleY(row) - HANDLE / 2, width: boxWidth, height: HANDLE, zIndex: props.selected ? 5 : 4 }}>
      {wide ? <View pointerEvents="none" testID="transition-window" style={[{ position: "absolute", left: start - boxLeft, top: 0, width, height: HANDLE, borderRadius: radius.xs, borderWidth: 1, borderColor: theme.color("timeline/selection"), backgroundColor: theme.color("clip/label-scrim"), opacity: 0.9 }, hatch]} /> : null}
      {props.dropZone ? <View pointerEvents="none" testID="transition-drop-zone" style={{ position: "absolute", left: centre - boxLeft - 8, top: 0, width: 16, height: HANDLE, borderRadius: radius.xs, borderWidth: 2, borderColor: theme.color("timeline/selection"), backgroundColor: theme.color("accent/subtle") }} /> : null}
      <View pointerEvents="none" testID="transition-chip" style={[{ position: "absolute", left: centre - boxLeft - HANDLE / 2, top: 0, width: HANDLE, height: HANDLE, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/elevated"), borderWidth: props.selected ? 2 : 1, borderColor: theme.color(props.selected ? "timeline/selection" : "border/strong") }, theme.elevation(1)]}>
        <Icon name="transition" size={12} />
        {props.warning ? <View testID="transition-warning" style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color("warning/icon"), borderWidth: 1, borderColor: theme.color("bg/elevated") }} /> : null}
      </View>
      {props.tip ? <View pointerEvents="none" testID="transition-tooltip" style={{ position: "absolute", left: centre - boxLeft - 20, top: -22, width: 40, alignItems: "center", paddingVertical: space[0.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{props.tip}</Text></View> : null}
    </View>
  );
}
