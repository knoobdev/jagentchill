import { forwardRef, memo, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";
import { workflow as wf } from "@jagentchill/editor-core";
import type { WorkflowDocument, WorkflowEdge, WorkflowEdgeState, WorkflowNode, WorkflowNodeAggregate } from "@jagentchill/protocol";
import { Icon, Spinner, Text, radius, space, useTheme, wfMotion, type ColorToken, dragHandle, holdDragCursor } from "@jagentchill/ui";
import { useT } from "../locale";
import { heldModifiers } from "../platform/store";
import { alpha, cardFacts, cardLook, edgeLabel, edgeLook, kindLabel, kindsInUse, mix, portLabel } from "./look";
import { bindHover, bindWheel } from "./platform";
import { KIND_LABELS, NODE_ICONS, NODE_LABELS, NODE_NOTES, NODE_STATUS_ICONS, NODE_STATUS_LABELS, NODE_STATUS_TOKENS, clock } from "./strings";

export type CanvasSelection = { nodeIds: string[]; edgeIds: string[]; noteIds: string[] };
export const NO_SELECTION: CanvasSelection = { nodeIds: [], edgeIds: [], noteIds: [] };
export type PortRef = { node: string; port: string };
export type CanvasHandle = {
  /** The world point under a point of the window, or null when the point is outside the canvas. */
  worldAt(pageX: number, pageY: number): wf.Point | null;
  size(): { width: number; height: number };
};
export type CanvasProps = {
  doc: WorkflowDocument; mode: "edit" | "view"; view: wf.Viewport; onView(view: wf.Viewport): void;
  selection: CanvasSelection; onSelect(selection: CanvasSelection): void;
  /** Problems per node, drawn as badges. */
  problems?: Record<string, { errors: number; warnings: number }>;
  /** The state of a run drawn over the graph. */
  run?: { nodes: Record<string, WorkflowNodeAggregate>; edges: Record<string, WorkflowEdgeState>; now: number };
  onMove?(nodeIds: string[], noteIds: string[], dx: number, dy: number): void;
  /** A connection dropped on a port, on a node body, or on empty canvas. */
  onConnect?(from: PortRef, target: { port: PortRef } | { node: string } | { point: wf.Point }): void;
  /** The reason a port refuses the connection being dragged, or undefined when it accepts it. */
  portProblem?(from: PortRef, to: PortRef): string | undefined;
  onOpen?(nodeId: string): void; onSize?(size: { width: number; height: number }): void; minimap?: boolean; testID?: string;
};

type Drag =
  | { kind: "pan"; from: wf.Viewport } | { kind: "move"; dx: number; dy: number } | { kind: "marquee"; a: wf.Point; b: wf.Point }
  | { kind: "connect"; from: PortRef; at: wf.Point } | { kind: "pinch"; from: wf.Viewport; distance: number; centre: wf.Point };
const MINIMAP = { width: 132, height: 84 };
const MARGIN = 600;
/** The background is a faint pattern of dots this far apart. */
const DOTS = 22;
const CARD_RADIUS = 12;
/** What the pointer rests on. `port` is `in:<id>` or `out:<id>` of the hovered step. */
type Hover = { node?: string; edge?: string; port?: string };
const NO_HOVER: Hover = {};
/** A step's helper card appears once the pointer has rested on it this long. */
const TIP_DELAY = 400;
const TIP_WIDTH = 300;
type Side = "start" | "end" | "above" | "below";
const SIDES: Side[] = ["start", "end", "above", "below"];
const SIDE_ICONS = { start: "arrow-l", end: "arrow-r", above: "arrow-up", below: "arrow-d" } as const;
const HINT = { width: 132, height: 40 };
/** Where the chip of a side sits: on a row above the legend — start, below and end — clear of the lane the cards run on; "above" sits under the toolbar. */
const hintAt = (side: Side, size: { width: number; height: number }): wf.Point => ({
  x: side === "start" ? 12 : side === "end" ? size.width - 12 - HINT.width : size.width / 2 - HINT.width / 2,
  y: side === "above" ? 64 : size.height - (size.width < 520 ? 76 : 52) - HINT.height,
});
/** The view that brings the nearest step hidden on a side into sight, at the same zoom. */
function reveal(doc: Pick<WorkflowDocument, "nodes">, view: wf.Viewport, size: { width: number; height: number }, side: Side): wf.Viewport {
  const left = -view.x / view.zoom, top = -view.y / view.zoom, right = left + size.width / view.zoom, bottom = top + size.height / view.zoom, pad = 32;
  const boxes = doc.nodes.map((node) => wf.nodeBox(node)), mid = (box: wf.Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (side === "end") { const next = boxes.filter((box) => mid(box).x >= right).sort((a, b) => a.x - b.x)[0]; return next ? { ...view, x: Math.min(view.x, size.width - pad - (next.x + next.width) * view.zoom, size.width * 0.35 - next.x * view.zoom) } : view; }
  if (side === "start") { const next = boxes.filter((box) => mid(box).x <= left).sort((a, b) => b.x - a.x)[0]; return next ? { ...view, x: Math.max(view.x, pad - next.x * view.zoom, size.width * 0.65 - (next.x + next.width) * view.zoom) } : view; }
  if (side === "below") { const next = boxes.filter((box) => mid(box).y >= bottom).sort((a, b) => a.y - b.y)[0]; return next ? { ...view, y: size.height - 72 - (next.y + next.height) * view.zoom } : view; }
  const next = boxes.filter((box) => mid(box).y <= top).sort((a, b) => b.y - a.y)[0];
  return next ? { ...view, y: 72 - next.y * view.zoom } : view;
}

/**
 * The node canvas: the graph in world units under a pan-and-zoom viewport. Every gesture is resolved against the
 * geometry of the document — nothing is measured on screen — and ends as one call of the owner, which turns it into
 * one batch of graph operations. In `view` mode the graph can only be panned, zoomed and selected.
 */
export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(props, handle) {
  const t = useT(), theme = useTheme();
  const root = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState(NO_HOVER);
  const [tip, setTip] = useState<string | null>(null);
  const gridId = useId();
  const origin = useRef({ x: 0, y: 0 });
  const releasePanCursor = useRef<(() => void) | null>(null);
  const live = useRef({ props, size, drag: null as Drag | null, lastTap: { id: "", at: 0 } });
  live.current.props = props;
  live.current.size = size;
  const { doc, view } = props;
  const measure = () => root.current?.measureInWindow((x, y) => { origin.current = { x, y }; });
  const local = (event: GestureResponderEvent): wf.Point => ({ x: event.nativeEvent.pageX - origin.current.x, y: event.nativeEvent.pageY - origin.current.y });
  const update = (next: Drag | null) => { live.current.drag = next; setDrag(next); };
  const beginPan = (from: wf.Viewport) => {
    releasePanCursor.current?.();
    releasePanCursor.current = holdDragCursor("grabbing");
    update({ kind: "pan", from });
  };

  useImperativeHandle(handle, () => ({
    worldAt(pageX, pageY) {
      const point = { x: pageX - origin.current.x, y: pageY - origin.current.y }, now = live.current;
      return point.x < 0 || point.y < 0 || point.x > now.size.width || point.y > now.size.height ? null : wf.toWorld(now.props.view, point);
    },
    size: () => live.current.size,
  }), []);
  useEffect(() => bindWheel(root.current, (info) => {
    const now = live.current.props;
    now.onView(info.zoom ? wf.zoomAbout(now.view, { x: info.x, y: info.y }, now.view.zoom * Math.exp(-info.dy / 240)) : { ...now.view, x: now.view.x - info.dx, y: now.view.y - info.dy });
  }), []);
  // What the pointer rests on, for the hover look of a step and of an edge and for the handles of a step's ports.
  useEffect(() => bindHover(root.current, (point) => {
    const now = live.current;
    if (!point || now.drag) return setHover((old) => (old.node || old.edge ? NO_HOVER : old));
    const world = wf.toWorld(now.props.view, point), reach = wf.PORT_HIT / Math.min(1, now.props.view.zoom);
    const out = wf.portAt(now.props.doc, world, "out", reach), into = out ? undefined : wf.portAt(now.props.doc, world, "in", reach);
    const node = out?.node ?? into?.node ?? wf.nodeAt(now.props.doc, world)?.id, port = out ? `out:${out.port}` : into ? `in:${into.port}` : undefined;
    const edge = node ? undefined : wf.edgeAt(now.props.doc, world, 6 / Math.min(1, now.props.view.zoom))?.id;
    setHover((old) => (old.node === node && old.edge === edge && old.port === port ? old : node || edge ? { node, edge, port } : NO_HOVER));
  }), []);
  // The helper card of a step: shown after the pointer has rested on the step, gone as soon as it leaves or a gesture starts.
  const resting = drag ? undefined : hover.node;
  useEffect(() => {
    setTip(null);
    if (!resting) return;
    const timer = setTimeout(() => setTip(resting), TIP_DELAY);
    return () => clearTimeout(timer);
  }, [resting]);

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant(event) {
      releasePanCursor.current?.();
      releasePanCursor.current = null;
      const now = live.current.props, touches = event.nativeEvent.touches ?? [];
      measure();
      const world = wf.toWorld(now.view, local(event)), held = heldModifiers(), extend = held.shift || held.toggle;
      if (touches.length >= 2) return;
      const port = now.mode === "edit" ? wf.portAt(now.doc, world, "out", wf.PORT_HIT / Math.min(1, now.view.zoom)) : undefined;
      if (port) return update({ kind: "connect", from: port, at: world });
      const node = wf.nodeAt(now.doc, world);
      if (node) {
        const selected = now.selection.nodeIds.includes(node.id);
        if (extend) now.onSelect({ ...now.selection, edgeIds: [], nodeIds: selected ? now.selection.nodeIds.filter((id) => id !== node.id) : [...now.selection.nodeIds, node.id] });
        else if (!selected) now.onSelect({ nodeIds: [node.id], edgeIds: [], noteIds: [] });
        return now.mode === "edit" ? update({ kind: "move", dx: 0, dy: 0 }) : beginPan(now.view);
      }
      const note = now.doc.notes.find((entry) => world.x >= entry.x && world.x <= entry.x + entry.width && world.y >= entry.y && world.y <= entry.y + entry.height);
      if (note) {
        if (!now.selection.noteIds.includes(note.id)) now.onSelect({ nodeIds: extend ? now.selection.nodeIds : [], edgeIds: [], noteIds: extend ? [...now.selection.noteIds, note.id] : [note.id] });
        return now.mode === "edit" ? update({ kind: "move", dx: 0, dy: 0 }) : beginPan(now.view);
      }
      const edge = wf.edgeAt(now.doc, world, 8 / Math.min(1, now.view.zoom));
      if (edge) { now.onSelect({ nodeIds: [], noteIds: [], edgeIds: [edge.id] }); return beginPan(now.view); }
      if (held.shift && now.mode === "edit") update({ kind: "marquee", a: world, b: world });
      else beginPan(now.view);
    },
    onPanResponderMove(event, gesture) {
      const now = live.current.props, current = live.current.drag, touches = event.nativeEvent.touches ?? [];
      // Two fingers pinch about their centre, whatever the first finger started.
      if (touches.length >= 2) {
        const [a, b] = touches, distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), centre = { x: (a.pageX + b.pageX) / 2 - origin.current.x, y: (a.pageY + b.pageY) / 2 - origin.current.y };
        if (current?.kind !== "pinch") return update({ kind: "pinch", from: now.view, distance, centre });
        const zoomed = wf.zoomAbout(current.from, current.centre, current.from.zoom * (distance / Math.max(current.distance, 1)));
        return now.onView({ ...zoomed, x: zoomed.x + centre.x - current.centre.x, y: zoomed.y + centre.y - current.centre.y });
      }
      if (!current) return;
      if (current.kind === "pan") now.onView({ ...current.from, x: current.from.x + gesture.dx, y: current.from.y + gesture.dy });
      else if (current.kind === "move") update({ kind: "move", dx: gesture.dx / now.view.zoom, dy: gesture.dy / now.view.zoom });
      else if (current.kind === "marquee") update({ ...current, b: wf.toWorld(now.view, local(event)) });
      else if (current.kind === "connect") update({ ...current, at: wf.toWorld(now.view, local(event)) });
    },
    onPanResponderRelease(event, gesture) {
      const now = live.current.props, current = live.current.drag;
      releasePanCursor.current?.();
      releasePanCursor.current = null;
      update(null);
      if (!current) return;
      const moved = Math.hypot(gesture.dx, gesture.dy) > 3;
      const world = wf.toWorld(now.view, local(event));
      if (current.kind === "move") {
        if (moved) return now.onMove?.(now.selection.nodeIds, now.selection.noteIds, current.dx, current.dy);
        const node = wf.nodeAt(now.doc, world);
        if (!node) return;
        const held = heldModifiers(), tap = live.current.lastTap, at = Date.now();
        // A press without a drag on one of several selected nodes keeps that one.
        if (!held.shift && !held.toggle && now.selection.nodeIds.length > 1) now.onSelect({ nodeIds: [node.id], edgeIds: [], noteIds: [] });
        if (tap.id === node.id && at - tap.at < 350) now.onOpen?.(node.id);
        live.current.lastTap = { id: node.id, at };
      } else if (current.kind === "pan") {
        if (moved) return;
        // A press on the chip that says the graph continues brings the next hidden step into sight.
        const at = local(event), area = live.current.size, more = wf.beyond(now.doc, now.view, area);
        const side = SIDES.find((entry) => { const corner = hintAt(entry, area); return more[entry] > 0 && at.x >= corner.x && at.x <= corner.x + HINT.width && at.y >= corner.y && at.y <= corner.y + HINT.height; });
        if (side) return now.onView(reveal(now.doc, now.view, area, side));
        const node = wf.nodeAt(now.doc, world), edge = node ? undefined : wf.edgeAt(now.doc, world, 8 / Math.min(1, now.view.zoom));
        const note = now.doc.notes.some((entry) => world.x >= entry.x && world.x <= entry.x + entry.width && world.y >= entry.y && world.y <= entry.y + entry.height);
        if (!node && !edge && !note) now.onSelect(NO_SELECTION);
      } else if (current.kind === "marquee") {
        now.onSelect({ nodeIds: wf.nodesIn(now.doc, current.a, current.b), edgeIds: [], noteIds: [] });
      } else if (current.kind === "connect") {
        if (!moved) return;
        const port = wf.portAt(now.doc, world, "in", wf.PORT_HIT / Math.min(1, now.view.zoom)), node = port ? undefined : wf.nodeAt(now.doc, world);
        now.onConnect?.(current.from, port ? { port } : node && node.id !== current.from.node ? { node: node.id } : { point: world });
      }
    },
    onPanResponderTerminate: () => { releasePanCursor.current?.(); releasePanCursor.current = null; update(null); },
  })).current;

  const offset = drag?.kind === "move" ? drag : null;
  const shifted = (node: WorkflowNode): WorkflowNode => (offset && props.selection.nodeIds.includes(node.id) ? { ...node, position: { x: node.position.x + offset.dx, y: node.position.y + offset.dy } } : node);
  const shown = useMemo(() => ({ nodes: doc.nodes.map(shifted), edges: doc.edges }), [doc.nodes, doc.edges, offset?.dx, offset?.dy, props.selection.nodeIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(shown.nodes.map((node) => [node.id, node])), [shown]);
  const bounds = wf.boundsOf(shown) ?? { x: 0, y: 0, width: 0, height: 0 };
  const sheet = { x: bounds.x - MARGIN, y: bounds.y - MARGIN, width: bounds.width + MARGIN * 2, height: bounds.height + MARGIN * 2 };
  // The dots thin out when zoomed far away, so they stay a texture and never a moiré.
  const cell = DOTS * view.zoom * (view.zoom < 0.5 ? 4 : view.zoom < 0.8 ? 2 : 1);
  const map = props.minimap ? wf.minimap(shown, view, size, MINIMAP) : null;
  const frames = wf.bodyFrames(doc, shown);
  const legend = useMemo(() => kindsInUse(doc), [doc.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = !!props.run;
  const more = wf.beyond(doc, view, size);
  const canvasBg = theme.color("bg/canvas"), raised = theme.color("bg/elevated"), hairline = theme.color(theme.scheme === "dark" ? "border/strong" : "border/hairline");

  const lines = wf.edgeLines(shown);
  const edges = doc.edges.flatMap((edge) => {
    const line = lines.get(edge.id);
    if (!line) return [];
    const state = props.run?.edges[edge.id];
    const look = edgeLook(theme, edge, byId.get(edge.from.node), { selected: props.selection.edgeIds.includes(edge.id), hovered: hover.edge === edge.id, run: state, running });
    return [{ edge, look, state, d: line.d, tip: line.tip, mid: line.mid, routed: line.routed }];
  });
  const flowing = edges.filter((entry) => entry.state === "flowing");
  const tipNode = tip ? byId.get(tip) : undefined;

  // What the press would do here: carry a step (the hand), draw a connection (the cross), or nothing of the kind.
  const handleCursor = drag?.kind === "pan" || drag?.kind === "move" ? "grabbing" as const : hover.port && props.mode === "edit" ? "crosshair" as const : hover.node && props.mode === "edit" ? "grab" as const : null;
  return (
    <View ref={root} testID={props.testID ?? "wf-canvas"} {...({ dataSet: { zoom: String(view.zoom), mode: props.mode, nodes: String(doc.nodes.length), edges: String(doc.edges.length), ...(dragHandle(handleCursor) as { dataSet?: object }).dataSet } } as object)} {...responder.panHandlers}
      accessibilityLabel={t("Workflow canvas")} aria-label={t("Workflow canvas")}
      onLayout={(event) => { const next = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height }; setSize(next); measure(); props.onSize?.(next); }}
      style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: canvasBg, ...({ cursor: hover.node || hover.edge ? "pointer" : "default", userSelect: "none", touchAction: "none" } as object) }}>
      {cell >= 10 && size.width > 0 ? (
        <Svg pointerEvents="none" width={size.width} height={size.height} style={{ position: "absolute", top: 0, left: 0 }}>
          <Defs><Pattern id={gridId} width={cell} height={cell} patternUnits="userSpaceOnUse" x={view.x % cell} y={view.y % cell}><Circle cx={1.5} cy={1.5} r={1} fill={theme.color("wf/grid-major")} opacity={theme.scheme === "dark" ? 0.75 : 0.9} /></Pattern></Defs>
          <Rect width={size.width} height={size.height} fill={`url(#${gridId})`} />
        </Svg>
      ) : null}
      {/* Back to front: containers, edges and their labels, notes, cards. */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.zoom }], ...({ transformOrigin: "0px 0px" } as object) }}>
        {frames.map((entry) => (
          <Frame key={`body-${entry.owner}`} testID={`wf-body-${entry.owner}`} frame={entry.frame} token="wf/type/flow" icon={entry.kind === "loop" ? "loop" : "layers"} label={`${byId.get(entry.owner)?.name ?? ""} · ${(entry.kind === "loop" ? t("Loop body") : t("Parallel body"))}`} />
        ))}
        {doc.groups.map((group) => {
          // A group follows its steps while they are dragged; its stored frame is rewritten when the drag ends.
          const frame = offset && group.nodeIds.some((id) => props.selection.nodeIds.includes(id)) ? wf.frameOf(shown, group.nodeIds) ?? group.frame : group.frame;
          return <Frame key={group.id} testID={`wf-group-${group.id}`} frame={frame} token={`wf/group/${group.colorIndex}` as ColorToken} label={group.label} />;
        })}
        <Svg width={sheet.width} height={sheet.height} viewBox={`${sheet.x} ${sheet.y} ${sheet.width} ${sheet.height}`} style={{ position: "absolute", left: sheet.x, top: sheet.y }}>
          {edges.map(({ edge, look, d }) => (look.glow ? <Path key={`glow-${edge.id}`} d={d} stroke={look.color} strokeWidth={look.width + 6} strokeLinecap="round" opacity={look.glow} fill="none" /> : null))}
          {edges.map(({ edge, look, d, state, routed }) => <Path key={edge.id} testID={`wf-edge-${edge.id}`} {...({ "data-routed": routed ? "1" : "0" } as object)} d={d} stroke={look.color} strokeWidth={look.width} strokeDasharray={look.dash} strokeLinecap="round" opacity={state === "flowing" ? 0.35 : look.opacity} fill="none" />)}
          {edges.map(({ edge, look, tip: end }) => <Path key={`tip-${edge.id}`} d={arrow(end)} stroke={look.color} strokeWidth={look.width} strokeLinecap="round" strokeLinejoin="round" opacity={look.opacity} fill="none" />)}
          {flowing.length ? <Trace paths={flowing.map((entry) => ({ id: entry.edge.id, d: entry.d, color: entry.look.color }))} /> : null}
          {drag?.kind === "connect" ? (() => {
            const source = byId.get(drag.from.node), from = source && wf.portPoint(source, "out", drag.from.port);
            return from ? <Path d={wf.edgePath(from, drag.at)} stroke={theme.color("accent")} strokeWidth={2} strokeDasharray="6 6" strokeLinecap="round" fill="none" /> : null;
          })() : null}
        </Svg>
        {edges.map(({ edge, look, mid, state }) => {
          const label = edgeLabel(shown, edge, t);
          if (!label) return null;
          const loud = props.selection.edgeIds.includes(edge.id) || state === "flowing" || state === "delivered" || state === "error";
          return (
            <View key={edge.id} testID={`wf-edge-label-${edge.id}`} style={{ position: "absolute", left: mid.x - 80, top: mid.y - 10, width: 160, alignItems: "center", opacity: look.opacity }}>
              <View style={{ height: 20, paddingHorizontal: 8, borderRadius: radius.full, justifyContent: "center", backgroundColor: raised, borderWidth: 1, borderColor: loud ? alpha(look.color, 0.6) : hairline }}>
                <Text variant="caption" color={loud ? look.token : "text/secondary"} numberOfLines={1} style={LABEL_TEXT}>{label}</Text>
              </View>
            </View>
          );
        })}
        {doc.notes.map((note) => {
          const moving = offset && props.selection.noteIds.includes(note.id) ? offset : { dx: 0, dy: 0 }, selected = props.selection.noteIds.includes(note.id), tone = theme.color("warning");
          // A sticky note: a sheet of warm paper lying on the canvas, with a strip of the same paper a shade deeper along its top.
          const paper = mix(raised, tone, theme.scheme === "dark" ? 0.12 : 0.16);
          return (
            <View key={note.id} testID={`wf-note-${note.id}`} style={[{ position: "absolute", left: note.x + moving.dx, top: note.y + moving.dy, width: note.width, height: note.height, borderRadius: 6, backgroundColor: paper, overflow: "hidden" }, theme.elevation(1), { borderWidth: selected ? 1.5 : 0, borderColor: theme.color("accent") }]}>
              <View style={{ height: 8, backgroundColor: mix(paper, tone, theme.scheme === "dark" ? 0.3 : 0.25) }} />
              <View style={{ paddingVertical: space[2], paddingHorizontal: space[3] }}>
                <Text variant="meta" color={note.text ? "text/primary" : "text/tertiary"} style={NOTE_TEXT}>{note.text || t("Empty note")}</Text>
              </View>
            </View>
          );
        })}
        {shown.nodes.map((node) => (
          <NodeView key={node.id} node={node} edit={props.mode === "edit"} selected={props.selection.nodeIds.includes(node.id)} hovered={hover.node === node.id} port={hover.node === node.id ? hover.port : undefined} problems={props.problems?.[node.id]} run={props.run?.nodes[node.id]} now={props.run?.now} running={running}
            connectFrom={drag?.kind === "connect" ? drag.from : undefined} portProblem={props.portProblem} />
        ))}
      </View>
      {drag?.kind === "marquee" ? (() => {
        const a = wf.toScreen(view, drag.a), b = wf.toScreen(view, drag.b);
        return <View pointerEvents="none" testID="wf-marquee" style={{ position: "absolute", left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("accent"), backgroundColor: alpha(theme.color("accent"), 0.08) }} />;
      })() : null}
      {tipNode && size.width > 0 ? <NodeTip node={tipNode} view={view} size={size} error={props.run?.nodes[tipNode.id]?.latest?.error?.message} /> : null}
      {/* The legend is worth its room only when a workflow mixes more than three kinds of step. */}
      {legend.length > 3 && size.width > 0 ? (
        <View pointerEvents="none" testID="wf-legend" accessibilityLabel={t("Legend")} style={{ position: "absolute", start: space[3], bottom: space[3], maxWidth: Math.max(160, size.width - space[3] * 2), flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5] }}>
          {legend.map((entry) => (
            <View key={entry.kind} {...({ dataSet: { kind: entry.kind } } as object)} style={{ height: 22, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: 8, borderRadius: radius.full, borderWidth: 1, borderColor: hairline, backgroundColor: alpha(raised, 0.9) }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: cardLook(theme, entry.type).tone }} />
              <Text variant="caption" color="text/secondary">{t(KIND_LABELS[entry.kind] ?? KIND_LABELS.unknown)}</Text>
              <Text variant="caption" color="text/tertiary" tabular>{String(entry.count)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {size.width > 0 ? SIDES.map((side) => {
        if (!more[side]) return null;
        const at = hintAt(side, size), back = side === "start" || side === "above";
        return (
          <View key={side} pointerEvents="none" testID={`wf-more-${side}`} {...({ dataSet: { count: String(more[side]) } } as object)} style={{ position: "absolute", left: at.x, top: at.y, width: HINT.width, height: HINT.height, alignItems: side === "start" ? "flex-start" : side === "end" ? "flex-end" : "center", justifyContent: "center", ...({ cursor: "pointer" } as object) }}>
            <View accessibilityLabel={t("{n} more steps this way", { n: more[side] })} style={[{ height: 30, paddingHorizontal: 12, flexDirection: back ? "row-reverse" : "row", alignItems: "center", gap: space[1.5], borderRadius: radius.full, backgroundColor: raised }, theme.elevation(2), { borderWidth: 1, borderColor: hairline }]}>
              <Text variant="meta" color="text/primary" numberOfLines={1}>{t("{n} more", { n: more[side] })}</Text>
              <Icon name={SIDE_ICONS[side]} size={14} color="text/secondary" />
            </View>
          </View>
        );
      }) : null}
      {map ? (
        <View pointerEvents="none" testID="wf-minimap" accessibilityLabel={t("Minimap")} style={[{ position: "absolute", top: space[3], end: space[3], width: MINIMAP.width, height: MINIMAP.height, borderRadius: radius.lg, backgroundColor: alpha(raised, 0.92), overflow: "hidden" }, theme.elevation(1), { borderWidth: 1, borderColor: hairline }]}>
          {shown.nodes.map((node) => {
            const box = wf.nodeBox(node), status = props.run?.nodes[node.id]?.status, picked = props.selection.nodeIds.includes(node.id);
            const tone: ColorToken = picked ? "accent" : status === "failed" ? "danger" : status === "running" ? "accent" : status === "succeeded" ? "success" : status === "waiting_approval" ? "warning" : "text/tertiary";
            return <View key={node.id} style={{ position: "absolute", left: (box.x - map.origin.x) * map.scale, top: (box.y - map.origin.y) * map.scale, width: Math.max(4, box.width * map.scale), height: Math.max(3, box.height * map.scale), borderRadius: 2, backgroundColor: theme.color(tone), opacity: tone === "text/tertiary" ? 0.5 : 0.9 }} />;
          })}
          {doc.notes.map((note) => <View key={note.id} style={{ position: "absolute", left: (note.x - map.origin.x) * map.scale, top: (note.y - map.origin.y) * map.scale, width: Math.max(3, note.width * map.scale), height: Math.max(2, note.height * map.scale), borderRadius: 1.5, backgroundColor: theme.color("warning"), opacity: 0.4 }} />)}
          <View testID="wf-minimap-view" style={{ position: "absolute", left: map.viewRect.x, top: map.viewRect.y, width: map.viewRect.width, height: map.viewRect.height, borderRadius: 4, borderWidth: 1, borderColor: alpha(theme.color("accent"), 0.8), backgroundColor: alpha(theme.color("accent"), 0.08) }} />
        </View>
      ) : null}
    </View>
  );
});

/** Text inside the graph keeps one size: the graph is scaled as a whole, and a card's height does not follow the density. */
const NAME_TEXT = { fontSize: 14, lineHeight: 18, fontWeight: "500" } as const;
const KIND_TEXT = { fontSize: 11, lineHeight: 14, fontWeight: "400" } as const;
const BODY_TEXT = { fontSize: 13, lineHeight: 18, fontWeight: "400" } as const;
const CHIP_TEXT = { fontSize: 11, lineHeight: 14, fontWeight: "500" } as const;
const ROW_TEXT = { fontSize: 12, lineHeight: 16, fontWeight: "400" } as const;
const LABEL_TEXT = { fontSize: 11, lineHeight: 14, fontWeight: "500" } as const;
const NOTE_TEXT = { fontSize: 13, lineHeight: 18 } as const;

/** The arrowhead of an edge: a small open chevron with round ends, pointing into the card. */
const arrow = (tip: wf.Point): string => `M ${tip.x - 8} ${tip.y - 4.5} L ${tip.x - 2} ${tip.y} L ${tip.x - 8} ${tip.y + 4.5}`;

/** The live trace: short dashes that drift along the edges carrying data right now. */
function Trace(props: { paths: Array<{ id: string; d: string; color: string }> }) {
  const still = useTheme().reduceMotion;
  const [phase, setPhase] = useState(0);
  // With reduced motion nothing travels: the edges carrying data are a steady highlighted line.
  useEffect(() => { if (still) return; const timer = setInterval(() => setPhase((old) => (old + 1) % 16), 40); return () => clearInterval(timer); }, [still]);
  return (
    <>
      {props.paths.map((path) => <Path key={`halo-${path.id}`} d={path.d} stroke={path.color} strokeWidth={8} strokeLinecap="round" opacity={0.12} fill="none" />)}
      {props.paths.map((path) => <Path key={path.id} testID={`wf-trace-${path.id}`} d={path.d} stroke={path.color} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={still ? undefined : "4 12"} strokeDashoffset={still ? undefined : -phase} fill="none" />)}
    </>
  );
}

/** A container: a soft rounded area with its title on a chip — a group the user made, or the body of a loop or of a fan-out. */
function Frame(props: { frame: wf.Box; token: ColorToken; label: string; icon?: "loop" | "layers"; testID?: string }) {
  const theme = useTheme(), color = theme.color(props.token), dark = theme.scheme === "dark";
  return (
    <View testID={props.testID} style={{ position: "absolute", left: props.frame.x, top: props.frame.y, width: props.frame.width, height: props.frame.height, borderRadius: 16, borderWidth: 1, borderColor: alpha(color, dark ? 0.3 : 0.24), backgroundColor: alpha(mix(theme.color("bg/elevated"), color, 0.06), dark ? 0.45 : 0.6) }}>
      {props.label ? (
        <View style={{ position: "absolute", top: 10, left: 12, maxWidth: Math.max(40, props.frame.width - 24), height: 24, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.full, backgroundColor: alpha(color, dark ? 0.18 : 0.12) }}>
          {props.icon ? <Icon name={props.icon} size={12} color={props.token} /> : null}
          <Text variant="caption" color="text/primary" numberOfLines={1} style={[LABEL_TEXT, { flexShrink: 1 }]}>{props.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The helper card of a step: what its type does, in sentences that wrap on words, and what it takes and gives as two
 * short lists. It stands above the step — below when there is no room above — and never over it.
 */
function NodeTip(props: { node: WorkflowNode; view: wf.Viewport; size: { width: number; height: number }; error?: string }) {
  const t = useT(), theme = useTheme();
  const { node, view, size } = props;
  const box = wf.nodeBox(node), corner = wf.toScreen(view, box), ports = wf.canvasPorts(node);
  const width = Math.min(TIP_WIDTH, size.width - 16), below = corner.y < 196, bottom = corner.y + box.height * view.zoom;
  const left = Math.min(Math.max(8, corner.x + (box.width * view.zoom - width) / 2), Math.max(8, size.width - width - 8));
  const names = (list: wf.CanvasPort[]) => { const all = list.map((port) => portLabel(port, t)); return all.length > 4 ? [...all.slice(0, 4), t("{n} more", { n: all.length - 4 })] : all; };
  const lists = [{ title: t("Inputs"), items: names(ports.inputs) }, { title: t("Outputs"), items: names(ports.outputs) }].filter((list) => list.items.length);
  const type = t(NODE_LABELS[node.type]);
  return (
    <View pointerEvents="none" testID="wf-node-tip" role="tooltip" {...({ dataSet: { node: node.id, side: below ? "below" : "above" } } as object)}
      style={[{ position: "absolute", left, width, ...(below ? { top: bottom + 12 } : { bottom: size.height - corner.y + 12 }), paddingVertical: 12, paddingHorizontal: 14, gap: 6, borderRadius: 12, backgroundColor: theme.color("bg/elevated") }, theme.elevation(2), { borderWidth: 1, borderColor: theme.color(theme.scheme === "dark" ? "border/strong" : "border/hairline") }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: cardLook(theme, node.type).tile }}><Icon name={NODE_ICONS[node.type]} size={12} color={cardLook(theme, node.type).token} /></View>
        <Text variant="body-medium" numberOfLines={1} style={[TIP_TITLE, { flex: 1 }]}>{node.name.trim() && node.name.trim() !== type ? `${node.name} · ${type}` : type}</Text>
      </View>
      <Text variant="body" color="text/secondary" style={TIP_TEXT}>{t(NODE_NOTES[node.type] ?? "Runs when you start it")}</Text>
      {props.error ? <Text variant="body" color="danger/text" style={TIP_TEXT} numberOfLines={4}>{props.error}</Text> : null}
      {lists.length ? (
        <View style={{ flexDirection: "row", gap: 16, paddingTop: 6, marginTop: 2, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          {lists.map((list) => (
            <View key={list.title} style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="caption" color="text/tertiary" style={LABEL_TEXT}>{list.title}</Text>
              {list.items.map((item, index) => <Text key={`${item}-${index}`} variant="meta" color="text/primary" numberOfLines={1} style={TIP_ITEM}>{item}</Text>)}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
const TIP_TITLE = { fontSize: 13, lineHeight: 19, fontWeight: "600" } as const;
/** Sentences break between words only. */
const TIP_TEXT = { fontSize: 13, lineHeight: 19, ...({ wordBreak: "normal", overflowWrap: "break-word", hyphens: "none" } as object) } as const;
const TIP_ITEM = { fontSize: 12, lineHeight: 18 } as const;

type NodeViewProps = {
  node: WorkflowNode; /** Whether connections can be drawn: the handles of the ports are offered. */ edit: boolean; selected: boolean; hovered: boolean; /** The port under the pointer, as `in:<id>` or `out:<id>`. */ port?: string;
  problems?: { errors: number; warnings: number }; run?: WorkflowNodeAggregate; now?: number; running: boolean;
  connectFrom?: PortRef; portProblem?(from: PortRef, to: PortRef): string | undefined;
};
/**
 * One step as a card: a tile with the icon of its kind, its name, a line in plain words saying what it does and a few
 * of its settings as chips. The outputs it fires by name — the paths of a branch, the answers of an approval — are
 * rows at its bottom, each with its own handle; the other ports are handles on its sides, shown when they are wanted.
 */
const NodeView = memo(function NodeView(props: NodeViewProps) {
  const t = useT(), theme = useTheme();
  const { node } = props;
  const box = wf.nodeBox(node), body = wf.bodyHeight(node), ports = wf.canvasPorts(node), rows = ports.outputs.filter((port) => port.row !== undefined);
  const status = props.run?.status ?? (props.running ? "pending" : undefined);
  const active = status && status !== "pending" && status !== "ready" ? status : undefined;
  const look = cardLook(theme, node.type, status);
  const latest = props.run?.latest;
  const elapsed = latest?.started_ms ? (latest.finished_ms ?? props.now ?? latest.started_ms) - latest.started_ms : null;
  const facts = useMemo(() => cardFacts(node, t), [node, t]);
  const kind = kindLabel(node, t);
  const failure = status === "failed" ? latest?.error?.message : undefined;
  const state = active ? [t(NODE_STATUS_LABELS[active]), props.run?.counts ? `${props.run.counts.succeeded}/${props.run.counts.total}` : null].filter(Boolean).join(" · ") : null;
  const chips = failure ? [] : facts.chips;
  const quiet = node.disabled || status === "skipped" || status === "cancelled" ? 0.45 : status === "pending" || status === "ready" ? 0.7 : 1;
  const raisedUp = props.selected || props.hovered || status === "running";
  const border = props.selected ? theme.color("accent") : props.hovered && !active ? theme.color(theme.scheme === "dark" ? "border/control" : "border/strong") : look.border;
  const connecting = !!props.connectFrom;
  const handle = (port: wf.CanvasPort, side: "in" | "out") => {
    const y = wf.portOffset(node, side, port.id) ?? 0, key = `${side}:${port.id}`;
    const target = side === "in" && connecting && props.connectFrom!.node !== node.id;
    const refused = target ? props.portProblem?.(props.connectFrom!, { node: node.id, port: port.id }) : undefined;
    const open = target && !refused, source = side === "out" && props.connectFrom?.node === node.id && props.connectFrom.port === port.id;
    const pointed = props.port === key, row = port.row !== undefined;
    // Handles stay out of sight until they are wanted: the pointer is on the step, the step is selected, or a connection is looking for a place to land.
    const wanted = props.edit && (props.hovered || props.selected || target || source);
    const loud = open || source || (pointed && props.edit), sized = loud ? 14 : 10;
    const named = !row && props.edit && (pointed || source || (open && props.hovered));
    return (
      <View key={key} pointerEvents="none" style={{ position: "absolute", top: y - 10, height: 20, [side === "in" ? "right" : "left"]: box.width - sized / 2, flexDirection: side === "in" ? "row-reverse" : "row", alignItems: "center", gap: 6 }}>
        <View testID={`wf-port-${node.id}-${side}-${port.id}`} {...({ dataSet: { type: port.type, accepts: connecting && side === "in" ? String(!refused) : "" } } as object)}
          style={{ width: sized, height: sized, borderRadius: sized / 2, borderWidth: 2, borderColor: loud ? theme.color("accent") : row && !wanted ? theme.color("border/strong") : theme.color("text/tertiary"), backgroundColor: open || source ? theme.color("accent") : look.surface,
            opacity: target && refused ? 0.25 : wanted || row ? 1 : 0, ...(loud ? ({ boxShadow: `0 0 0 4px ${alpha(theme.color("accent"), 0.18)}` } as object) : null) }} />
        {named ? (
          <View style={{ height: 22, paddingHorizontal: 8, justifyContent: "center", borderRadius: 7, backgroundColor: theme.color("strong") }}>
            <Text variant="caption" color="text/on-strong" numberOfLines={1} style={LABEL_TEXT}>{portLabel(port, t)}</Text>
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <View testID={`wf-node-${node.id}`} {...({ dataSet: { type: node.type, selected: String(props.selected), status: status ?? "", x: String(node.position.x), y: String(node.position.y) } } as object)}
      style={{ position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height }}>
      {status === "running" ? <Pulse color={theme.color("accent")} /> : null}
      {/* The card: a raised surface. What is quiet in a run fades its words, never the card — nothing under it shows through. */}
      <View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: CARD_RADIUS, backgroundColor: look.surface }, theme.elevation(raisedUp ? 2 : 1),
        { borderWidth: props.selected || active ? 1.5 : 1, borderStyle: node.disabled ? "dashed" : "solid", borderColor: border }, props.selected ? ({ boxShadow: `0 0 0 3px ${alpha(theme.color("accent"), 0.22)}, 0 6px 16px ${alpha("#000000", theme.scheme === "dark" ? 0.4 : 0.1)}` } as object) : null]} />
      <View style={{ position: "absolute", top: 0, right: 0, left: 0, height: body, paddingHorizontal: 14, paddingTop: 12, opacity: quiet }}>
        <View style={{ height: 32, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: look.tile }}><Icon name={NODE_ICONS[node.type]} size={16} color={look.token} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-medium" numberOfLines={1} style={NAME_TEXT}>{node.name}</Text>
            {kind ? <Text variant="caption" color="text/tertiary" numberOfLines={1} style={KIND_TEXT}>{kind}</Text> : null}
          </View>
          {props.problems?.errors ? <Badge count={props.problems.errors} tone="danger" label={t("{n} errors", { n: props.problems.errors })} /> : null}
          {props.problems?.warnings ? <Badge count={props.problems.warnings} tone="warning" label={t("{n} warnings", { n: props.problems.warnings })} /> : null}
          {active ? (
            <View testID={`wf-node-status-${node.id}`} accessibilityLabel={t(NODE_STATUS_LABELS[active])} style={{ height: 22, paddingHorizontal: elapsed !== null ? 7 : 5, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.full, backgroundColor: alpha(theme.color(NODE_STATUS_TOKENS[active]), theme.scheme === "dark" ? 0.2 : 0.12) }}>
              {active === "running" ? <Spinner size={12} /> : <Icon name={active === "succeeded" ? "check" : active === "failed" ? "x" : NODE_STATUS_ICONS[active]} size={12} color={NODE_STATUS_TOKENS[active]} />}
              {elapsed !== null ? <Text variant="caption" color={active === "running" ? "text/primary" : "text/secondary"} tabular style={CHIP_TEXT}>{clock(elapsed)}</Text> : null}
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: 8 }}>
          <Text variant="body" color={failure ? "danger/text" : "text/secondary"} numberOfLines={chips.length || (state && !failure) ? 1 : 2} style={BODY_TEXT}>{failure || facts.summary}</Text>
          {chips.length || (state && !failure) ? (
            <View style={{ marginTop: 4, height: 20, flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden" }}>
              {state && !failure ? <Text variant="caption" color={NODE_STATUS_TOKENS[active!]} numberOfLines={1} style={CHIP_TEXT}>{state}</Text> : null}
              {chips.map((chip) => (
                <View key={chip} style={{ height: 20, maxWidth: "100%", paddingHorizontal: 7, justifyContent: "center", borderRadius: 6, backgroundColor: theme.color("bg/subtle"), flexShrink: 1 }}>
                  <Text variant="caption" color="text/secondary" numberOfLines={1} style={CHIP_TEXT}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      {rows.length ? (
        <View style={{ position: "absolute", top: body, right: 0, left: 0, borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), opacity: quiet }}>
          {rows.map((port) => {
            const fired = latest?.fired?.includes(port.id);
            return (
              <View key={port.id} style={{ height: wf.OUTCOME_ROW, paddingStart: 14, paddingEnd: 16, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
                <Text variant="meta" color={fired ? "text/primary" : "text/secondary"} numberOfLines={1} style={[ROW_TEXT, fired ? { fontWeight: "600" } : null]}>{caseLabel(node, port, t)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {ports.inputs.map((port) => handle(port, "in"))}
      {ports.outputs.map((port) => handle(port, "out"))}
    </View>
  );
});
/** What a row of a card says: the label the user gave a path of a branch, or the name of the outcome. */
function caseLabel(node: WorkflowNode, port: wf.CanvasPort, t: ReturnType<typeof useT>): string {
  const given = ((node.config.cases as Array<{ id: string; label?: string }> | undefined) ?? []).find((entry) => entry.id === port.id)?.label;
  return given || portLabel(port, t);
}
/** The step that is running: a soft ring that breathes around its card. */
function Pulse(props: { color: string }) {
  const beat = useRef(new Animated.Value(0)).current, still = useTheme().reduceMotion;
  useEffect(() => {
    // With reduced motion the ring does not breathe: it stands at its highlight.
    if (still) return beat.setValue(0.7);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: wfMotion.pulse / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(beat, { toValue: 0, duration: wfMotion.pulse / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [beat, still]);
  return <Animated.View style={{ position: "absolute", top: -5, right: -5, bottom: -5, left: -5, borderRadius: CARD_RADIUS + 5, backgroundColor: props.color, opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.26] }) }} />;
}
function Badge(props: { count: number; tone: "danger" | "warning"; label: string }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={props.label} aria-label={props.label} style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(`${props.tone}/subtle` as ColorToken) }}>
      <Text variant="caption" color={`${props.tone}/text` as ColorToken} tabular style={CHIP_TEXT}>{String(props.count)}</Text>
    </View>
  );
}
