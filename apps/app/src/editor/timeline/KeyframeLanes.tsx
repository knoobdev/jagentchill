import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { TIMELINE_FRAME, type TimelineRow } from "@jagentchill/app-core";
import { clickKeySelection, keysOfPath, lanePaths, moveKeys, neighbourKeyTime, pathLabel, removeAllKeys, removeKeys, resolvedValue, snapKeyDrag, timeline, toggleKeyframe, toggleState, type KeyRef } from "@jagentchill/editor-core";
import { IconButton, KeyframeDiamond, Menu, SnapLine, Tap, Text, space, useTheme, type MenuItem } from "@jagentchill/ui";
import { useT } from "../../locale";
import { refreshHeldTransport, useEditor, useHeldTransport } from "../context";
import { bindPointer, setCursor } from "../dom";
import { Diamond } from "../inspector/keys";

type El = timeline.El;
const sameRef = (a: KeyRef, b: KeyRef): boolean => a.elementId === b.elementId && a.path === b.path && a.keyId === b.keyId;
/** The lanes of a row, top to bottom: the animated properties of its expanded elements in lane order. */
export const rowLanePaths = (elements: El[]): string[] => [...new Set(elements.flatMap((element) => lanePaths(element)))];

/**
 * The keyframe lanes under the clips of a row: one 20 px lane per animated property, a diamond per key. A click
 * seeks to the key and selects it (Mod toggles, Shift selects the range), a drag moves the selected keys in time with
 * snapping, a drag on empty lane draws a selection rectangle.
 */
export function KeyframeLanes(props: { row: TimelineRow; elements: El[]; zoomLevel: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { controller } = runtime, selected = controller.session.selection.selectedKeyframes as KeyRef[];
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const node = useRef<View>(null);
  const paths = rowLanePaths(props.elements), lane = TIMELINE_FRAME.laneHeight;
  const live = useRef({ props, paths, selected });
  live.current = { props, paths, selected };
  useEffect(() => bindPointer(node.current, {
    hover(info) {
      const state = live.current;
      const path = info && state.paths[Math.floor(info.y / lane)];
      const hit = path && info ? state.props.elements.some((element) => keysOfPath(element, path).some((key) => Math.abs(timeline.ticksToPixels(element.startTime + key.time, state.props.zoomLevel) - info.x) <= 7)) : false;
      setCursor(node.current, hit ? "grab" : "default");
    },
    down(info) {
      const state = live.current, zoom = state.props.zoomLevel, px = (ticks: number) => timeline.ticksToPixels(ticks, zoom), ticksPerPx = 1 / px(1);
      const select = (keys: KeyRef[], anchor?: KeyRef) => controller.select(timeline.selectKeyframes(controller.session.selection, keys as never, anchor as never));
      const at = Math.floor(info.y / lane), path = state.paths[at];
      const hit = path ? state.props.elements.flatMap((element) => keysOfPath(element, path).map((key) => ({ element, key }))).find(({ element, key }) => Math.abs(px(element.startTime + key.time) - info.x) <= 7) : undefined;
      if (!hit) {
        // Empty lane: a rectangle selects, a click clears.
        const base = info.mod ? state.selected : [];
        return {
          move: (pointer) => { if (Math.hypot(pointer.x - info.x, pointer.y - info.y) >= 5) setBox({ x1: info.x, y1: info.y, x2: pointer.x, y2: pointer.y }); },
          up: (pointer) => {
            setBox(null);
            if (Math.hypot(pointer.x - info.x, pointer.y - info.y) < 5) { select([]); return; }
            let found = base;
            // The rectangle is in row lanes; an element's own lane order may differ from the row's.
            found = [...base, ...state.props.elements.flatMap((element) => state.paths.flatMap((lanePath, row) => keysOfPath(element, lanePath).filter((key) => { const x = px(element.startTime + key.time), y = row * lane + lane / 2; return x + 7 >= Math.min(info.x, pointer.x) && x - 7 <= Math.max(info.x, pointer.x) && y + 7 >= Math.min(info.y, pointer.y) && y - 7 <= Math.max(info.y, pointer.y); }).map((key) => ({ elementId: element.id, path: lanePath, keyId: key.id })))).filter((key) => !base.some((entry) => sameRef(entry, key)))];
            select(found);
          },
          cancel: () => setBox(null),
        };
      }
      const ref: KeyRef = { elementId: hit.element.id, path, keyId: hit.key.id }, already = state.selected.some((entry) => sameRef(entry, ref));
      const next = info.mod || info.shift || !already ? clickKeySelection(hit.element, state.selected, controller.session.selection.keyframeAnchor as KeyRef | undefined, ref, { mod: info.mod, shift: info.shift }) : { keys: state.selected, anchor: ref };
      select(next.keys, next.anchor);
      if (info.mod || info.shift) return null;
      const moving = next.keys, prefs = runtime.prefs;
      const targets = timeline.keySnapTargets(controller.stored, controller.session.sceneId, moving, { playhead: controller.session.playhead });
      let moved = false;
      const drag = (pointer: { x: number; shift: boolean }, isLive: boolean) => {
        const dx = pointer.x - info.x;
        if (!moved && Math.abs(dx) < 5) return;
        moved = true;
        // The dragged key snaps within 10 px; Shift (or Auto snapping off) leaves frame rounding only.
        const snapped = snapKeyDrag(hit.key.time, dx * ticksPerPx, targets, 10 * ticksPerPx, prefs.snapping && !pointer.shift);
        setSnapLine(isLive && snapped.line !== null ? hit.element.startTime + snapped.line : null);
        controller.external((doc, ctx) => moveKeys(doc, ctx, moving, snapped.delta), isLive);
      };
      return {
        move: (pointer) => drag(pointer, true),
        up: (pointer) => { if (moved) { controller.discardPreview(); drag(pointer, false); setSnapLine(null); } else runtime.seek(hit.element.startTime + hit.key.time); },
        cancel: () => { controller.discardPreview(); setSnapLine(null); },
      };
    },
    context(info) {
      const state = live.current, px = (ticks: number) => timeline.ticksToPixels(ticks, state.props.zoomLevel), path = state.paths[Math.floor(info.y / lane)];
      const hit = path ? state.props.elements.flatMap((element) => keysOfPath(element, path).map((key) => ({ element, key }))).find(({ element, key }) => Math.abs(px(element.startTime + key.time) - info.x) <= 7) : undefined;
      const owner = hit?.element ?? state.props.elements.find((element) => path && keysOfPath(element, path).length > 0);
      if (!path || !owner) return;
      const local = Math.min(owner.duration, Math.max(0, controller.session.playhead - owner.startTime));
      setMenu({ at: { x: info.clientX, y: info.clientY }, items: [
        ...(hit ? [{ id: "delete", label: t("Delete keyframe"), icon: "trash", danger: true, onSelect: () => controller.external((doc, ctx) => removeKeys(doc, ctx, [{ elementId: hit.element.id, path, keyId: hit.key.id }], { localTimes: { [hit.element.id]: local } })) } as MenuItem] : []),
        { id: "remove-all", label: t("Remove all keyframes"), danger: true, onSelect: () => controller.external((doc, ctx) => removeAllKeys(doc, ctx, owner.id, path, local)) },
      ] });
    },
  }), [runtime, controller, lane, t]);
  return (
    <View ref={node} testID="tl-ctl-lanes" style={{ position: "absolute", left: 0, right: 0, top: props.row.baseHeight, height: paths.length * lane }}>
      {paths.map((path, index) => (
        <View key={path} testID="keyframe-lane" pointerEvents="none" aria-label={pathLabel(path)} style={{ position: "absolute", left: 0, right: 0, top: index * lane, height: lane, backgroundColor: theme.color("bg/inset") }}>
          {props.elements.flatMap((element) => keysOfPath(element, path).map((key) => {
            const on = selected.some((entry) => entry.elementId === element.id && entry.path === path && entry.keyId === key.id);
            return <View key={`${element.id}-${key.id}`} testID="lane-key" aria-label={`${pathLabel(path)} ${key.time}`} aria-selected={on} style={{ position: "absolute", left: timeline.ticksToPixels(element.startTime + key.time, props.zoomLevel) - (on ? 6 : 4), top: on ? 4 : 6 }}><KeyframeDiamond selected={on} /></View>;
          }))}
        </View>
      ))}
      {snapLine !== null ? <View pointerEvents="none" testID="key-snap-line" style={{ position: "absolute", left: timeline.ticksToPixels(snapLine, props.zoomLevel), top: -props.row.baseHeight }}><SnapLine height={props.row.height} /></View> : null}
      {box ? <View pointerEvents="none" testID="key-marquee" style={{ position: "absolute", left: Math.min(box.x1, box.x2), top: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1), borderWidth: 1, borderColor: theme.color("timeline/selection"), backgroundColor: theme.color("accent/subtle"), opacity: 0.6 }} /> : null}
      <Menu open={menu !== null} anchor={menu ? { x: menu.at.x, y: menu.at.y, width: 1, height: 1 } : { x: 0, y: 0, width: 1, height: 1 }} items={menu?.items ?? []} label={t("Keyframe")} onClose={() => setMenu(null)} />
    </View>
  );
}

/** The header of each lane: the property's name, its keyframe toggle, and the buttons to the previous and next key of that lane. */
export function LaneHeaders(props: { elements: El[] }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const root = useRef<View>(null);
  useEffect(() => {
    const node = root.current as unknown as { addEventListener?(type: string, listener: () => void, capture: boolean): void; removeEventListener?(type: string, listener: () => void, capture: boolean): void } | null;
    if (!node?.addEventListener) return;
    const reached = () => { if (runtime.transport.playing) refreshHeldTransport(runtime); };
    node.addEventListener("pointerdown", reached, true); node.addEventListener("keydown", reached, true);
    return () => { node.removeEventListener?.("pointerdown", reached, true); node.removeEventListener?.("keydown", reached, true); };
  }, [runtime]);
  const paths = rowLanePaths(props.elements);
  return (
    <View ref={root} style={{ width: "100%" }}>
      <>
      {paths.map((path) => {
        // The lane acts on the expanded element that owns the property and holds the playhead, else the first that owns it.
        const owners = props.elements.filter((element) => keysOfPath(element, path).length > 0), element = owners.find((entry) => transport.time >= entry.startTime && transport.time <= entry.startTime + entry.duration) ?? owners[0];
        if (!element) return null;
        const local = Math.round(Math.min(element.duration, Math.max(0, transport.time - element.startTime))), inside = transport.time >= element.startTime && transport.time <= element.startTime + element.duration;
        const state = toggleState(element, path, local), previous = neighbourKeyTime(element, local, "previous", path), next = neighbourKeyTime(element, local, "next", path);
        return (
          <View key={path} testID="lane-header" style={{ height: TIMELINE_FRAME.laneHeight, flexDirection: "row", alignItems: "center", paddingStart: space[1], borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }}>
            <Text variant="caption" color="text/secondary" numberOfLines={1} style={{ flex: 1, textAlign: "right", marginEnd: 2 }}>{t(pathLabel(path))}</Text>
            <IconButton icon="chev-l" size="xs" label={t("Previous keyframe")} disabled={previous === null} testID="lane-previous" onPress={() => runtime.seek(element.startTime + previous!)} />
            <Tap role="button" label={t(state === "filled" ? "Remove keyframe: {name}" : "Add keyframe: {name}", { name: t(pathLabel(path)) })} disabled={!inside} testID="lane-toggle" onPress={() => {
              refreshHeldTransport(runtime);
              const time = runtime.transport.time, at = Math.round(Math.min(element.duration, Math.max(0, time - element.startTime)));
              runtime.controller.external((doc, ctx) => toggleKeyframe(doc, ctx, element.id, path, at, resolvedValue(element, path, at) as number));
            }} style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}><Diamond state={state} size={7} disabled={!inside} /></Tap>
            <IconButton icon="chev-r" size="xs" label={t("Next keyframe")} disabled={next === null} testID="lane-next" onPress={() => {
              refreshHeldTransport(runtime);
              const time = runtime.transport.time, at = Math.round(Math.min(element.duration, Math.max(0, time - element.startTime)));
              const upcoming = neighbourKeyTime(element, at, "next", path);
              if (upcoming !== null) runtime.seek(element.startTime + upcoming);
            }} />
          </View>
        );
      })}
      </>
    </View>
  );
}
