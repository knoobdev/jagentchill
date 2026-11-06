import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, ScrollView, View } from "react-native";
import { workflow as wf } from "@jagentchill/editor-core";
import type { WorkflowDocument, WorkflowNodeType, WorkflowOp } from "@jagentchill/protocol";
import {
  BottomSheet, Button, ConfirmDialog, DestructiveConfirmDialog, EmptyState, FormDialog, FormField, Icon, IconButton, Input, ListRow, Menu, Portal, Select, LoadingSkeleton, Skeleton, Switch, Text, Textarea,
  radius, space, useTheme, useToast, type MenuItem, dragHandle } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { copyText, saveBlob } from "../platform/media";
import { onWindowKey } from "../platform/store";
import { Screen, useHostScopeState } from "../shell/Shell";
import { Canvas, NO_SELECTION, type CanvasHandle, type CanvasSelection, type PortRef } from "./Canvas";
import { failureOf, useWorkflowCalls, useWorkflowDoc, useWorkflowIndex, type WorkflowDoc } from "./data";
import { NodeInspector, Section, TextControl } from "./Inspector";
import { diagramSvg } from "./diagram";
import { canRasterise, isShown, onPasteText, svgToPng } from "./platform";
import { ScheduleEditor, ScheduleSentence, whenText } from "./Schedule";
import { ALIGN_LABELS, CONNECTION_LABELS, EDGE_KIND_LABELS, NODE_ICONS, NODE_LABELS, NODE_NOTES } from "./strings";
import { useRunStarter } from "./RunSetup";
import { cardLook } from "./look";
import { WORKFLOW_AGENT_PANEL, WorkflowAgentPanel, WorkflowAgentSlot, useWorkflowAgentWidth } from "./WorkflowAgentPanel";

/** The last copied fragment of this app: the paste of a touch platform, and of a browser that refuses the clipboard. */
let copied: wf.Fragment | null = null;
const INSPECTOR_WIDTH = 320, PALETTE_WIDTH = 248;

/** What the agent is told about the workflow in front of the person: its steps and how they are connected. */
export function outlineText(doc: WorkflowDocument): string {
  const lines = doc.nodes.slice(0, 40).map((node) => `- ${node.id} (${node.type}) "${node.name}"${doc.edges.filter((edge) => edge.from.node === node.id).length ? ` → ${[...new Set(doc.edges.filter((edge) => edge.from.node === node.id).map((edge) => edge.to.node))].join(", ")}` : ""}`);
  return `[Workflow "${doc.name}" (${doc.id}), revision ${doc.revision}, ${doc.nodes.length} steps]\n${lines.join("\n")}`;
}

/**
 * One node type of the palette, as a small card in the look of a step: the icon tile of its kind, its name and what it
 * does. A press adds it beside the selection; a drag carries a ghost of the step and drops it on the canvas or on an edge.
 */
function PaletteItem(props: { type: WorkflowNodeType; onAdd(): void; onDrop(pageX: number, pageY: number): void; disabled?: boolean }) {
  const t = useT(), theme = useTheme();
  const [hover, setHover] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const live = useRef(props);
  live.current = props;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.disabled, onMoveShouldSetPanResponder: () => !live.current.disabled,
    onPanResponderMove: (_event, gesture) => setGhost(Math.hypot(gesture.dx, gesture.dy) > 4 ? { x: gesture.moveX, y: gesture.moveY } : null),
    onPanResponderRelease(event, gesture) { setGhost(null); if (Math.hypot(gesture.dx, gesture.dy) > 4) live.current.onDrop(event.nativeEvent.pageX, event.nativeEvent.pageY); else live.current.onAdd(); },
    onPanResponderTerminate: () => setGhost(null),
  })).current;
  const label = t(NODE_LABELS[props.type]), note = NODE_NOTES[props.type] ? t(NODE_NOTES[props.type]!) : "", look = cardLook(theme, props.type);
  const hairline = theme.color(theme.scheme === "dark" ? "border/strong" : "border/hairline");
  const face = (
    <>
      <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: look.tile }}><Icon name={NODE_ICONS[props.type]} size={16} color={look.token} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-medium" numberOfLines={1} style={{ lineHeight: 20 }}>{label}</Text>
        {note ? <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ fontSize: 12, lineHeight: 16 }}>{note}</Text> : null}
      </View>
    </>
  );
  return (
    <View testID={`wf-palette-${props.type}`} role="button" accessibilityLabel={t("Add {type} step", { type: label })} aria-label={t("Add {type} step", { type: label })} aria-disabled={props.disabled || undefined} {...responder.panHandlers} {...dragHandle(props.disabled ? null : "grab")}
      {...({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), tabIndex: props.disabled ? -1 : 0, onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onAdd(); } } } as object)}
      style={[{ flexDirection: "row", alignItems: "center", gap: 10, height: 68, paddingHorizontal: 10, borderRadius: 10, backgroundColor: theme.color("bg/elevated"), opacity: props.disabled ? 0.4 : ghost ? 0.55 : 1 }, hover && !props.disabled ? theme.elevation(1) : null,
        { borderWidth: 1, borderColor: hover && !props.disabled ? theme.color(theme.scheme === "dark" ? "border/control" : "border/strong") : hairline, ...({ cursor: "default", userSelect: "none" } as object) }]}>
      {face}
      {ghost ? (
        <Portal layer="tooltip">
          <View pointerEvents="none" testID="wf-palette-ghost" style={[{ position: "absolute", left: ghost.x - 120, top: ghost.y - 28, width: 240, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.color("bg/elevated"), opacity: 0.94 }, theme.elevation(2), { borderWidth: 1.5, borderColor: theme.color("accent") }]}>
            {face}
          </View>
        </Portal>
      ) : null}
    </View>
  );
}

/** The schedule source of the trigger: its sentence, the editor, and the switch only a device turns on. */
function TriggerSchedule(props: { flow: WorkflowDoc; disabled?: boolean }) {
  const t = useT(), theme = useTheme(), toast = useToast();
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const trigger = props.flow.trigger, first = trigger?.triggers[0], schedule = first?.type === "schedule" ? first.schedule : null;
  const write = (input: Parameters<WorkflowDoc["setTrigger"]>[0]) => props.flow.setTrigger(input).catch((error) => { toast.show({ kind: "error", message: failureOf(error).message }); throw error; });
  return (
    <Section title={t("Schedule")}>
      {schedule ? <ScheduleSentence schedule={schedule} onPress={props.disabled ? undefined : () => setOpen(true)} /> : <Text color="text/secondary">{t("No schedule: the workflow runs when someone starts it.")}</Text>}
      {schedule && trigger ? (
        <>
          <Switch label={t("Active")} disabled={props.disabled} value={trigger.enabled} onChange={(enabled) => write({ schedule, enabled })} />
          <Text variant="meta" color="text/secondary" testID="wf-trigger-next">{trigger.enabled && trigger.stats.nextRun_ms ? t("Next run {when}", { when: whenText(trigger.stats.nextRun_ms, schedule.tzid, theme.locale) }) : t("Next run —")}</Text>
        </>
      ) : null}
      <View ref={anchor} style={{ flexDirection: "row", gap: space[2] }}>
        <Button size="sm" icon="clock" label={schedule ? t("Edit schedule") : t("Set schedule")} disabled={props.disabled} testID="wf-trigger-schedule" onPress={() => setOpen(true)} />
        {schedule ? <Button kind="ghost" size="sm" label={t("Remove schedule")} disabled={props.disabled} onPress={() => void write({ schedule: null, enabled: false })} /> : null}
      </View>
      <ScheduleEditor open={open} onClose={() => setOpen(false)} anchor={anchor} value={schedule} onApply={(next) => void write({ schedule: next, enabled: trigger?.enabled ?? false })} />
    </Section>
  );
}

/** Whether a "Sub-workflow" step of another workflow may run this workflow: the trigger's `subworkflow` source. */
function TriggerSubworkflow(props: { flow: WorkflowDoc; disabled?: boolean }) {
  const t = useT(), toast = useToast();
  const node = props.flow.doc?.nodes.find((entry) => entry.type === "trigger");
  if (!node) return null;
  const sources = ((node.config.sources as Array<Record<string, unknown>>) ?? []);
  const on = sources.some((source) => source.kind === "subworkflow" && source.enabled === true);
  const change = (enabled: boolean) => {
    const next = sources.some((source) => source.kind === "subworkflow") ? sources.map((source) => (source.kind === "subworkflow" ? { ...source, enabled } : source)) : [...sources, { kind: "subworkflow", enabled }];
    const result = props.flow.apply([{ op: "node.update", id: node.id, patch: { config: { ...node.config, sources: next } } }], "Edit trigger");
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  return (
    <Section title={t("Sub-workflow")}>
      <View testID="wf-trigger-subworkflow" {...({ dataSet: { on: String(on) } } as object)}><Switch label={t("Other workflows can run this one")} disabled={props.disabled} value={on} onChange={change} /></View>
      <Text variant="meta" color="text/secondary">{t("A Sub-workflow step in another workflow can start this workflow and wait for its result.")}</Text>
    </Section>
  );
}

/**
 * The workflow editor: the palette of step types, the canvas, the configuration of what is selected, and the agent
 * panel. Every gesture ends as one batch of graph operations, so one undo takes back one gesture.
 */
export function WorkflowEditorScreen(props: { workflowId: string; node?: string }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Workflows"));
  const flow = useWorkflowDoc(props.workflowId);
  const index = useWorkflowIndex();
  const calls = useWorkflowCalls();
  const canvas = useRef<CanvasHandle>(null);
  const canvasBox = useRef<View>(null);
  const [selection, setSelection] = useState<CanvasSelection>(props.node ? { nodeIds: [props.node], edgeIds: [], noteIds: [] } : NO_SELECTION);
  const [view, setView] = useState<wf.Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitted, setFitted] = useState(false);
  const [agent, setAgent] = useState(false);
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [replace, setReplace] = useState<{ from: PortRef; to: PortRef } | null>(null);
  const [addInput, setAddInput] = useState<{ from: PortRef; node: string; name: string; type: string } | null>(null);
  const [pick, setPick] = useState<{ from: PortRef; point: wf.Point; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const menuRef = useRef<View>(null), alignRef = useRef<View>(null);
  const [align, setAlign] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const agentPanelWidth = useWorkflowAgentWidth();
  const doc = flow.doc;
  const readOnly = !can("jagentchill.projects.write");
  const mayRun = can("jagentchill.generation.run");
  const live = useRef({ doc, selection, view, size });
  live.current = { doc, selection, view, size };

  // The first layout shows the whole graph.
  // A narrow window reads a card at a smaller scale than a wide one.
  const floor = theme.compact ? wf.READABLE_ZOOM : wf.SMALL_GRAPH_ZOOM;
  useEffect(() => { if (!fitted && doc && size.width > 0) { setView(wf.openView(doc, size, 32, floor)); setFitted(true); } }, [doc, size, fitted, floor]);
  /** "Fit to screen": a small graph stays readable and says that it continues; asked again from there, the whole graph is shown. */
  const fit = (of: Pick<WorkflowDocument, "nodes" | "notes"> | null = live.current.doc) => {
    if (!of) return;
    const now = live.current, readable = wf.fitReadable(of, now.size, 48, floor);
    const there = Math.abs(now.view.zoom - readable.zoom) < 0.001 && Math.abs(now.view.x - readable.x) < 1 && Math.abs(now.view.y - readable.y) < 1;
    setView(there ? wf.fitView(of, now.size) : readable);
  };
  useEffect(() => { flow.onRefused.current = (failure) => toast.show({ kind: "error", message: failure.message }); }, [flow, toast]);
  // A node removed elsewhere leaves the selection.
  useEffect(() => {
    if (!doc) return;
    const nodeIds = selection.nodeIds.filter((id) => doc.nodes.some((node) => node.id === id)), edgeIds = selection.edgeIds.filter((id) => doc.edges.some((edge) => edge.id === id)), noteIds = selection.noteIds.filter((id) => doc.notes.some((note) => note.id === id));
    if (nodeIds.length !== selection.nodeIds.length || edgeIds.length !== selection.edgeIds.length || noteIds.length !== selection.noteIds.length) setSelection({ nodeIds, edgeIds, noteIds });
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (message: string) => toast.show({ kind: "error", message });
  // The run's start: its parameters and its one money question in one form; neither → it starts at once.
  const starter = useRunStarter({ onStarted: (record) => router.push(`/h/${host!.gatewayId}/workflows/runs/${record.id}` as never), onError: (error) => say(failureOf(error).message) });
  /** Applies one gesture; a refusal is said and nothing changes. */
  const run = (given: WorkflowOp[], label: string): boolean => {
    if (readOnly || !given.length) return false;
    let ops = given;
    // A note never ends under or over a card: whatever the gesture did, the notes it covered move to the nearest free place.
    const now = live.current.doc;
    if (now?.notes.length || given.some((op) => op.op === "note.add")) { try { const after = wf.applyBatch(now!, given).doc, settled = wf.settleNotes(after); if (settled.length) ops = [...given, ...settled.map((note): WorkflowOp => ({ op: "note.update", id: note.id, patch: { x: note.x, y: note.y } }))]; } catch { /* the refusal is said by the apply below */ } }
    const result = flow.apply(ops, label); if (!result.ok) say(result.message); return result.ok; };
  const attempt = <R,>(make: () => R): R | undefined => { try { return make(); } catch (error) { const failure = failureOf(error); say(CONNECTION_LABELS[failure.code] ? t(CONNECTION_LABELS[failure.code]) : failure.message); return undefined; } };
  const centre = (): wf.Point => wf.toWorld(live.current.view, { x: live.current.size.width / 2, y: live.current.size.height / 2 });

  const addNode = (type: WorkflowNodeType, at?: wf.Point) => {
    const now = live.current.doc;
    if (!now) return;
    const world = at ?? null, edge = world ? wf.edgeAt(now, world, 10) : now.edges.find((entry) => live.current.selection.edgeIds.length === 1 && entry.id === live.current.selection.edgeIds[0]);
    const made = attempt(() => {
      if (edge) { const ends = wf.edgeEnds(now, edge)!, middle = world ?? wf.edgeMidpoint(ends.from, ends.to, edge.kind); return { ...wf.insertOnEdgeOps(now, type, edge.id, { x: middle.x - wf.NODE_SIZE.width / 2, y: middle.y - wf.NODE_SIZE.height / 2 }), label: "Insert step" }; }
      const position = world ? { x: world.x - wf.NODE_SIZE.width / 2, y: world.y - wf.NODE_SIZE.height / 2 } : wf.placeAlone(now, live.current.selection.nodeIds.at(-1));
      return { ...wf.addNodeOps(now, type, position), label: "Add step" };
    });
    if (!made || !run(made.ops, made.label)) return;
    setSelection({ nodeIds: [made.nodeId], edgeIds: [], noteIds: [] });
    setPalette(false);
    // A step placed outside the viewport is brought into it: the view is centred on the step at the same zoom.
    const added = made.ops.find((op): op is Extract<WorkflowOp, { op: "node.add" }> => op.op === "node.add")?.node.position;
    const { view: seen, size: area } = live.current;
    if (!added || area.width <= 0) return;
    const corner = wf.toScreen(seen, added);
    if (corner.x < 0 || corner.y < 48 || corner.x + wf.NODE_SIZE.width * seen.zoom > area.width || corner.y + wf.NODE_SIZE.height * seen.zoom > area.height) setView({ zoom: seen.zoom, x: area.width / 2 - (added.x + wf.NODE_SIZE.width / 2) * seen.zoom, y: area.height / 2 - (added.y + wf.NODE_SIZE.height / 2) * seen.zoom });
  };
  const connect = (from: PortRef, to: PortRef, replaceOld = false) => { const now = live.current.doc; if (!now) return; const made = attempt(() => wf.connectOps(now, from, to, { replace: replaceOld })); if (made) run(made.ops, "Connect"); };
  const onConnect = (from: PortRef, target: { port: PortRef } | { node: string } | { point: wf.Point }) => {
    const now = live.current.doc;
    if (!now || readOnly) return;
    if ("port" in target) {
      const problem = wf.connectionProblem(now, wf.analyse(now), from, target.port);
      if (problem === "WORKFLOW_PORT_OCCUPIED") return setReplace({ from, to: target.port });
      if (problem) return say(t(CONNECTION_LABELS[problem] ?? CONNECTION_LABELS.WORKFLOW_TYPE_MISMATCH));
      return connect(from, target.port);
    }
    if ("node" in target) {
      const port = wf.firstCompatibleInput(now, from, target.node);
      if (port) return connect(from, { node: target.node, port });
      const node = now.nodes.find((entry) => entry.id === target.node), source = now.nodes.find((entry) => entry.id === from.node), out = source && wf.dataPort(source, "out", from.port);
      // A node that takes declared inputs can grow the one this connection needs.
      if (node && out && wf.NODE_TYPES[node.type].userInputs && !node.inputs.some((entry) => entry.id === out.id)) return setAddInput({ from, node: node.id, name: out.id, type: out.type });
      return say(t(CONNECTION_LABELS.WORKFLOW_TYPE_MISMATCH));
    }
    const screen = wf.toScreen(live.current.view, target.point);
    canvasBox.current?.measureInWindow((x, y) => setPick({ from, point: target.point, rect: { x: x + screen.x, y: y + screen.y, width: 1, height: 1 } }));
  };
  /** The types that can take the connection being dropped on empty canvas, each with the input it would enter. */
  const pickItems = useMemo((): MenuItem[] => {
    if (!pick || !doc) return [];
    return wf.OFFERED_NODE_TYPES.flatMap((info): MenuItem[] => {
      const position = { x: pick.point.x, y: pick.point.y - wf.NODE_HEAD };
      const node = wf.makeNode(doc, info.type, position), trial = { ...doc, nodes: [...doc.nodes, node] };
      const port = wf.firstCompatibleInput(trial, pick.from, node.id);
      if (!port) return [];
      return [{ id: info.type, label: t(NODE_LABELS[info.type]), icon: NODE_ICONS[info.type], onSelect: () => {
        const edgeId = wf.nextEdgeId(doc), kind = wf.inferEdgeKind(trial, pick.from, { node: node.id, port });
        if (kind && run([{ op: "node.add", node }, { op: "edge.add", edge: { id: edgeId, kind, from: pick.from, to: { node: node.id, port } } }], "Add step")) setSelection({ nodeIds: [node.id], edgeIds: [], noteIds: [] });
      } }];
    });
  }, [pick, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (nodeIds: string[], noteIds: string[], dx: number, dy: number) => {
    const now = live.current.doc;
    if (!now) return;
    const ops: WorkflowOp[] = wf.moveOps(now, nodeIds, dx, dy);
    for (const note of now.notes.filter((entry) => noteIds.includes(entry.id))) ops.push({ op: "note.update", id: note.id, patch: { x: wf.snap(note.x + dx), y: wf.snap(note.y + dy) } });
    // A group follows its members.
    const moved = { nodes: now.nodes.map((node) => { const op = ops.find((entry) => entry.op === "node.move" && entry.id === node.id) as Extract<WorkflowOp, { op: "node.move" }> | undefined; return op ? { ...node, position: op.position } : node; }) };
    for (const group of now.groups) { if (!group.nodeIds.some((id) => nodeIds.includes(id))) continue; const frame = wf.frameOf(moved, group.nodeIds); if (frame) ops.push({ op: "group.update", id: group.id, patch: { frame } }); }
    run(ops, "Move");
  };
  const removeSelection = () => { const now = live.current.doc; if (!now) return; const picked = live.current.selection; if (run(wf.deleteOps(now, { ...picked, groupIds: now.groups.filter((group) => group.nodeIds.length > 0 && group.nodeIds.every((id) => picked.nodeIds.includes(id))).map((group) => group.id) }), "Delete")) setSelection(NO_SELECTION); };
  const copy = (): boolean => {
    const now = live.current.doc;
    if (!now) return false;
    const fragment = wf.copyFragment(now, live.current.selection);
    if (!fragment.nodes.length && !fragment.notes.length) return false;
    copied = fragment;
    void copyText(JSON.stringify(fragment));
    return true;
  };
  const paste = (fragment: wf.Fragment | null, at?: wf.Point) => {
    const now = live.current.doc;
    if (!now || !fragment) return;
    const made = attempt(() => wf.pasteOps(now, fragment, at));
    if (made && made.ops.length && run(made.ops, "Paste")) setSelection({ nodeIds: made.nodeIds, edgeIds: [], noteIds: [] });
  };
  const duplicate = () => { const now = live.current.doc; if (!now) return; const made = attempt(() => wf.duplicateOps(now, live.current.selection)); if (made && made.ops.length && run(made.ops, "Duplicate")) setSelection({ nodeIds: made.nodeIds, edgeIds: [], noteIds: [] }); };
  const undo = (direction: "undo" | "redo") => { const result = direction === "undo" ? flow.undo() : flow.redo(); if (result && !result.ok) say(t("This change can no longer be undone")); };
  const autoLayout = () => { const now = live.current.doc; if (!now) return; const ops = wf.layoutBatch(now); if (ops.length) { run(ops, "Auto-layout"); const after = wf.applyBatch(now, ops).doc; setView(wf.fitReadable(after, live.current.size, 48, floor)); } else setView(wf.fitReadable(now, live.current.size, 48, floor)); };
  const zoom = (factor: number) => setView(wf.zoomAbout(live.current.view, { x: live.current.size.width / 2, y: live.current.size.height / 2 }, live.current.view.zoom * factor));

  // The keyboard of the canvas; a field that has the focus keeps its keys.
  useEffect(() => onWindowKey((event) => {
    if (event.inField || !live.current.doc || !isShown(canvasBox.current)) return;
    const mod = event.meta || event.ctrl, key = event.key.toLowerCase();
    if (mod && key === "z") { event.preventDefault(); undo(event.shift ? "redo" : "undo"); }
    else if (mod && key === "y") { event.preventDefault(); undo("redo"); }
    else if (mod && key === "c") { if (copy()) event.preventDefault(); }
    else if (mod && key === "x") { if (copy()) { event.preventDefault(); removeSelection(); } }
    else if (mod && key === "d") { event.preventDefault(); duplicate(); }
    else if (mod && key === "a") { event.preventDefault(); setSelection({ nodeIds: live.current.doc.nodes.map((node) => node.id), edgeIds: [], noteIds: [] }); }
    else if (key === "delete" || key === "backspace") { event.preventDefault(); removeSelection(); }
    else if (key === "escape") setSelection(NO_SELECTION);
    else if (key === "=" || key === "+") zoom(wf.ZOOM.step);
    else if (key === "-") zoom(1 / wf.ZOOM.step);
    else if (key === "1" && event.shift || key === "!") fit();
    else if (key.startsWith("arrow") && live.current.selection.nodeIds.length) { event.preventDefault(); const step = event.shift ? 100 : 20; move(live.current.selection.nodeIds, live.current.selection.noteIds, key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0); }
  }), [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  // The platform's paste: a fragment copied here, in another workflow or on another host.
  useEffect(() => onPasteText((text) => { if (isShown(canvasBox.current)) paste(wf.parseFragment(text) ?? copied, centre()); }), [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => {
    const out: Record<string, { errors: number; warnings: number }> = {};
    for (const [kind, list] of [["errors", flow.validation?.errors ?? []], ["warnings", flow.validation?.warnings ?? []]] as const) for (const problem of list) if (problem.nodeId) (out[problem.nodeId] ??= { errors: 0, warnings: 0 })[kind] += 1;
    return out;
  }, [flow.validation]);
  const errorCount = flow.validation?.errors.length ?? 0;

  if (scope) return <Screen title={t("Workflows")}>{scope}</Screen>;
  const crumbs = [
    { id: "workflows", label: t("Workflows"), onPress: () => router.replace(`/h/${host?.gatewayId}/workflows` as never) },
    { id: "workflow", label: doc?.name ?? t("Workflow"), ...(doc && !readOnly ? { onRename: (name: string) => { if (name.trim() && name.trim() !== doc.name) run([{ op: "meta.update", patch: { name: name.trim().slice(0, 80) } }], "Rename"); } } : {}) },
  ];
  if (flow.error && !doc) {
    return <Screen title={t("Workflow")} crumbs={crumbs}><EmptyState icon="flow" title={t("This workflow is not available")} description={failureOf(flow.error).message} actions={[{ label: t("Retry"), onPress: flow.reload }, { label: t("All workflows"), onPress: () => router.replace(`/h/${host?.gatewayId}/workflows` as never) }]} /></Screen>;
  }
  if (!doc) return <Screen title={t("Workflow")} crumbs={crumbs}><LoadingSkeleton style={{ padding: space[5], gap: space[2] }}>{Array.from({ length: 5 }, (_, at) => <Skeleton key={at} height={40} />)}</LoadingSkeleton></Screen>;

  const exportFile = async () => { try { const file = await calls.exportFile(doc.id); saveBlob(file.fileName, new Blob([file.text], { type: file.mimeType })); } catch (error) { say(failureOf(error).message); } };
  const exportPicture = async (format: "png" | "svg") => {
    const picture = diagramSvg(doc, theme, t), name = doc.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "workflow";
    const blob = format === "svg" ? new Blob([picture.svg], { type: "image/svg+xml" }) : await svgToPng(picture.svg, picture.width, picture.height);
    if (blob) saveBlob(`${name}.${format}`, blob); else say(t("The picture could not be created."));
  };
  const runReason = !mayRun ? t("Your role on this host does not allow this") : errorCount ? (errorCount === 1 ? t("Fix 1 problem to run") : t("Fix {n} problems to run", { n: errorCount })) : null;
  const selectedNode = selection.nodeIds.length === 1 ? doc.nodes.find((node) => node.id === selection.nodeIds[0]) : undefined;
  const selectedEdge = selection.edgeIds.length === 1 && !selection.nodeIds.length ? doc.edges.find((edge) => edge.id === selection.edgeIds[0]) : undefined;
  const selectedNote = selection.noteIds.length === 1 && !selection.nodeIds.length ? doc.notes.find((note) => note.id === selection.noteIds[0]) : undefined;
  const many = selection.nodeIds.length > 1;
  const compact = theme.compact;
  const overlayAgent = width > 0 && width - agentPanelWidth - INSPECTOR_WIDTH - PALETTE_WIDTH < 360;
  const goTo = (nodeId?: string, edgeId?: string) => { setSelection({ nodeIds: nodeId ? [nodeId] : [], edgeIds: edgeId ? [edgeId] : [], noteIds: [] }); if (nodeId) setView(wf.fitView(doc, size, 160, [nodeId])); if (compact && nodeId) setSheet(true); };

  const alignItems: MenuItem[] = (Object.keys(ALIGN_LABELS) as wf.AlignMode[])
    .map((mode): MenuItem => ({ id: mode, label: t(ALIGN_LABELS[mode]), disabled: selection.nodeIds.length < (mode.startsWith("distribute") ? 3 : 2), onSelect: () => void run(wf.alignOps(doc, selection.nodeIds, mode), "Align") }));
  const selectedGroup = doc.groups.find((group) => group.nodeIds.length === selection.nodeIds.length && group.nodeIds.every((id) => selection.nodeIds.includes(id)));
  const overflow: MenuItem[] = [
    { id: "rename", label: t("Rename"), icon: "pencil", disabled: readOnly, onSelect: () => setRename(doc.name) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", disabled: readOnly, onSelect: () => void calls.duplicate(doc.id).then((made) => router.push(`/h/${host!.gatewayId}/workflows/${made.document.id}` as never)).catch((error) => say(failureOf(error).message)) },
    { id: "export", label: t("Export"), icon: "export", onSelect: () => void exportFile() },
    // The diagram as a picture, where the platform can write a file.
    ...(canRasterise ? [{ id: "export-png", label: t("Export as PNG"), icon: "image" as const, onSelect: () => void exportPicture("png") }, { id: "export-svg", label: t("Export as SVG"), icon: "image" as const, onSelect: () => void exportPicture("svg") }] : []),
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: readOnly, onSelect: () => setRemove(true) },
  ];

  const paletteBody = (
    <View testID="wf-palette" style={{ gap: space[1.5] }}>
      {wf.OFFERED_NODE_TYPES.map((info) => <PaletteItem key={info.type} type={info.type} disabled={readOnly} onAdd={() => addNode(info.type)} onDrop={(pageX, pageY) => { const world = canvas.current?.worldAt(pageX, pageY); if (world) addNode(info.type, world); }} />)}
    </View>
  );
  const problemList = (flow.validation?.errors.length ?? 0) + (flow.validation?.warnings.length ?? 0) > 0 ? (
    <Section title={t("Problems")}>
      <View testID="wf-problems" style={{ gap: space[1] }}>
        {[...(flow.validation?.errors ?? []).map((problem) => ({ problem, error: true })), ...(flow.validation?.warnings ?? []).map((problem) => ({ problem, error: false }))].map(({ problem, error }, at) => (
          <View key={at} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2] }}>
            <View style={{ paddingTop: 2 }}><Icon name={error ? "x-c" : "warn"} size={14} color={error ? "danger/text" : "warning/text"} /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Text>{problem.message}</Text><Text variant="caption" color="text/tertiary">{problem.code}</Text></View>
            {problem.nodeId || problem.edgeId ? <Button kind="link" size="sm" label={t("Go to")} onPress={() => goTo(problem.nodeId, problem.edgeId)} /> : null}
          </View>
        ))}
      </View>
    </Section>
  ) : null;
  const side: ReactNode = selectedNode ? (
    <NodeInspector key={selectedNode.id} doc={doc} node={selectedNode} apply={flow.apply} workflows={index.workflows ?? []} readOnly={readOnly} onDelete={removeSelection} trigger={<><TriggerSchedule flow={flow} disabled={readOnly} /><TriggerSubworkflow flow={flow} disabled={readOnly} /></>} />
  ) : selectedEdge ? (
    <View testID="wf-edge-panel" style={{ paddingHorizontal: space[4] }}>
      <Section title={t("Connection")}>
        <Text>{`${doc.nodes.find((node) => node.id === selectedEdge.from.node)?.name ?? selectedEdge.from.node} · ${selectedEdge.from.port}  →  ${doc.nodes.find((node) => node.id === selectedEdge.to.node)?.name ?? selectedEdge.to.node} · ${selectedEdge.to.port}`}</Text>
        <Text variant="meta" color="text/secondary">{t(EDGE_KIND_LABELS[selectedEdge.kind])}</Text>
        <TextControl key={selectedEdge.id} label={t("Label")} max={40} disabled={readOnly} value={selectedEdge.label} onCommit={(label) => { const result = flow.apply([{ op: "edge.update", id: selectedEdge.id, patch: { label } }], "Edit connection"); return result.ok ? undefined : result.message; }} />
        {readOnly ? null : <View style={{ alignItems: "flex-start" }}><Button kind="ghost" tone="danger" size="sm" icon="trash" label={t("Remove connection")} testID="wf-delete-edge" onPress={removeSelection} /></View>}
      </Section>
    </View>
  ) : selectedNote ? (
    <View style={{ paddingHorizontal: space[4] }}>
      <Section title={t("Note")}>
        <TextControl key={selectedNote.id} label={t("Text")} multiline max={2000} minLines={4} disabled={readOnly} value={selectedNote.text} testID="wf-note-text" onCommit={(text) => { const result = flow.apply([{ op: "note.update", id: selectedNote.id, patch: { text } }], "Edit note"); return result.ok ? undefined : result.message; }} />
        {readOnly ? null : <View style={{ alignItems: "flex-start" }}><Button kind="ghost" tone="danger" size="sm" icon="trash" label={t("Delete note")} onPress={removeSelection} /></View>}
      </Section>
    </View>
  ) : many ? (
    <View style={{ paddingHorizontal: space[4] }}>
      <Section title={t("{n} steps selected", { n: selection.nodeIds.length })}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Button size="sm" icon="copy" label={t("Duplicate")} disabled={readOnly} onPress={duplicate} />
          {selectedGroup ? <Button size="sm" label={t("Ungroup")} disabled={readOnly} testID="wf-ungroup" onPress={() => void run([{ op: "group.remove", id: selectedGroup.id }], "Ungroup")} /> : <Button size="sm" label={t("Group")} disabled={readOnly} testID="wf-group" onPress={() => void run(wf.groupOps(doc, selection.nodeIds, t("Group")), "Group")} />}
          <Button size="sm" kind="ghost" tone="danger" icon="trash" label={t("Delete")} disabled={readOnly} onPress={removeSelection} />
        </View>
      </Section>
    </View>
  ) : (
    <ScrollView testID="wf-workflow-panel" contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: space[5] }}>
      <Section title={t("Workflow")}>
        <TextControl label={t("Name")} max={80} disabled={readOnly} value={doc.name} testID="wf-name" check={(text) => (text.trim() ? undefined : t("Name is required"))} onCommit={(name) => { const result = flow.apply([{ op: "meta.update", patch: { name: name.trim() } }], "Rename"); return result.ok ? undefined : result.message; }} />
        <TextControl label={t("Description")} multiline minLines={2} max={1000} disabled={readOnly} value={doc.description} onCommit={(description) => { const result = flow.apply([{ op: "meta.update", patch: { description } }], "Edit description"); return result.ok ? undefined : result.message; }} />
        <Text variant="meta" color="text/tertiary">{t("{nodes} steps · {edges} connections · revision {revision}", { nodes: doc.nodes.length, edges: doc.edges.length, revision: doc.revision })}</Text>
      </Section>
      {problemList ?? <Section title={t("Problems")}><Text color="text/secondary" testID="wf-no-problems">{t("No problems: this workflow can run.")}</Text></Section>}
      <Section title={t("Outline")}>
        <View testID="wf-outline">{doc.nodes.map((node) => <ListRow key={node.id} title={node.name} meta={t(NODE_LABELS[node.type])} icon={NODE_ICONS[node.type]} onPress={() => goTo(node.id)} />)}</View>
      </Section>
    </ScrollView>
  );

  const undoButtons = (
    <>
      <IconButton icon="undo" size="sm" label={t("Undo")} keys={["Mod", "Z"]} disabled={readOnly || !flow.canUndo} testID="wf-undo" onPress={() => undo("undo")} />
      <IconButton icon="redo" size="sm" label={t("Redo")} keys={["Mod", "Shift", "Z"]} disabled={readOnly || !flow.canRedo} testID="wf-redo" onPress={() => undo("redo")} />
    </>
  );
  // On a narrow window the toolbar is one row: what is used less sits behind "More".
  const addNote = () => { const at = centre(), made = wf.noteOps(doc, { x: at.x - 100, y: at.y - 50 }); if (run(made.ops, "Add note")) setSelection({ nodeIds: [], edgeIds: [], noteIds: [made.noteId] }); };
  const moreItems: MenuItem[] = [
    { id: "zoom-in", label: t("Zoom in"), icon: "plus", onSelect: () => zoom(wf.ZOOM.step) },
    { id: "zoom-out", label: t("Zoom out"), icon: "minus", onSelect: () => zoom(1 / wf.ZOOM.step) },
    { type: "separator" },
    { id: "layout", label: t("Auto-layout"), icon: "flow", disabled: readOnly, onSelect: autoLayout },
    { id: "align", label: t("Align and distribute"), icon: "al-l", disabled: readOnly || selection.nodeIds.length < 2, onSelect: () => setAlign(true) },
    { id: "note", label: t("Add note"), icon: "doc", disabled: readOnly, onSelect: addNote },
    { type: "separator" },
    { id: "copy", label: t("Copy"), icon: "copy", disabled: !selection.nodeIds.length && !selection.noteIds.length, onSelect: () => void copy() },
    { id: "paste", label: t("Paste"), icon: "download", disabled: readOnly, onSelect: () => paste(copied, centre()) },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: readOnly || (!selection.nodeIds.length && !selection.edgeIds.length && !selection.noteIds.length), onSelect: removeSelection },
  ];
  const toolbar = (
    <View testID="wf-toolbar" style={[{ position: "absolute", top: space[3], start: space[3], maxWidth: size.width > 0 ? size.width - 2 * space[3] : undefined, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[0.5], padding: space[0.5], borderRadius: radius.lg, backgroundColor: theme.color("bg/app"), borderWidth: 1, borderColor: theme.color("border/hairline") }, theme.elevation(1)]}>
      {compact ? <IconButton icon="spark" size="sm" label={t("Add step")} disabled={readOnly} testID="wf-open-palette" onPress={() => setPalette(true)} /> : null}
      {compact ? undoButtons : null}
      {compact ? null : <IconButton icon="minus" size="sm" label={t("Zoom out")} testID="wf-zoom-out" onPress={() => zoom(1 / wf.ZOOM.step)} />}
      <View style={{ minWidth: 40, alignItems: "center" }}><Text variant="meta" tabular testID="wf-zoom">{`${Math.round(view.zoom * 100)}%`}</Text></View>
      {compact ? null : <IconButton icon="plus" size="sm" label={t("Zoom in")} testID="wf-zoom-in" onPress={() => zoom(wf.ZOOM.step)} />}
      <IconButton icon="fit" size="sm" label={t("Fit to screen")} testID="wf-fit" onPress={() => fit()} />
      {compact ? null : <>
      <IconButton icon="flow" size="sm" label={t("Auto-layout")} disabled={readOnly} testID="wf-layout" onPress={autoLayout} />
      <View ref={alignRef}><IconButton icon="al-l" size="sm" label={t("Align and distribute")} disabled={readOnly || selection.nodeIds.length < 2} expanded={align} testID="wf-align" onPress={() => setAlign(true)} /></View>
      <IconButton icon="doc" size="sm" label={t("Add note")} disabled={readOnly} testID="wf-add-note" onPress={addNote} />
      <IconButton icon="copy" size="sm" label={t("Copy")} keys={["Mod", "C"]} disabled={!selection.nodeIds.length && !selection.noteIds.length} testID="wf-copy" onPress={() => void copy()} />
      <IconButton icon="download" size="sm" label={t("Paste")} keys={["Mod", "V"]} disabled={readOnly} testID="wf-paste" onPress={() => paste(copied, centre())} />
      <IconButton icon="trash" size="sm" label={t("Delete")} disabled={readOnly || (!selection.nodeIds.length && !selection.edgeIds.length && !selection.noteIds.length)} testID="wf-delete" onPress={removeSelection} />
      </>}
      {compact && (selectedNode || selectedEdge || selectedNote) ? <IconButton icon="sliders" size="sm" label={t("Configure")} testID="wf-configure" onPress={() => setSheet(true)} /> : null}
      {compact ? <View ref={moreRef}><IconButton icon="more" size="sm" label={t("More")} expanded={more} testID="wf-canvas-more" onPress={() => setMore(true)} /></View> : null}
      <Menu open={align} anchor={compact ? moreRef : alignRef} items={alignItems} label={t("Align and distribute")} onClose={() => setAlign(false)} />
      {compact ? <Menu open={more} anchor={moreRef} items={moreItems} label={t("More")} onClose={() => setMore(false)} /> : null}
    </View>
  );

  return (
    <Screen title={doc.name} crumbs={crumbs} documentTitle={doc.name}
      actions={<>
        {compact ? null : undoButtons}
        <IconButton icon="bot" size="sm" label={t("Agent")} on={agent} toggle testID="wf-toggle-agent" onPress={() => setAgent(!agent)} />
        {runReason && !compact ? <Text variant="meta" color={errorCount ? "danger/text" : "text/secondary"} testID="wf-run-reason" numberOfLines={1}>{runReason}</Text> : null}
        <Button kind="strong" size="sm" icon="play" label={t("Run")} disabled={!!runReason} loading={starter.busy} testID="wf-run" onPress={() => void starter.begin(doc)} />
        <View ref={menuRef}><IconButton icon="more" size="sm" label={t("Workflow options")} expanded={menu} testID="wf-menu" onPress={() => setMenu(true)} /></View>
      </>}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {compact ? null : (
          <ScrollView style={{ width: PALETTE_WIDTH, flexGrow: 0, borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }} contentContainerStyle={{ padding: space[2], gap: space[1] }}>
            <Text variant="meta" color="text/secondary" style={{ paddingHorizontal: space[2], paddingVertical: space[1] }}>{t("Steps")}</Text>
            {paletteBody}
          </ScrollView>
        )}
        <View ref={canvasBox} style={{ flex: 1, minWidth: 0 }}>
          <Canvas ref={canvas} doc={doc} mode={readOnly ? "view" : "edit"} view={view} onView={setView} selection={selection} onSelect={setSelection} problems={problems} minimap={!compact} onSize={setSize}
            onMove={move} onConnect={onConnect} portProblem={(from, to) => wf.connectionProblem(doc, wf.analyse(doc), from, to)} onOpen={() => { if (compact) setSheet(true); }} />
          {toolbar}
          {compact && runReason ? <View style={{ position: "absolute", bottom: space[3], start: space[3], end: space[3], alignItems: "center" }} pointerEvents="none"><Text variant="meta" color={errorCount ? "danger/text" : "text/secondary"} testID="wf-run-reason">{runReason}</Text></View> : null}
        </View>
        {compact ? null : <View testID="wf-side" style={{ width: INSPECTOR_WIDTH, borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), minHeight: 0 }}>{side}</View>}
        <WorkflowAgentSlot open={agent && !compact} overlay={overlayAgent}><WorkflowAgentPanel workflowId={doc.id} workflowName={doc.name} context={outlineText(doc)} overlay={overlayAgent} onClose={() => setAgent(false)} /></WorkflowAgentSlot>
      </View>
      {compact ? (
        <>
          <BottomSheet open={palette} onClose={() => setPalette(false)} title={t("Add step")} padded>{paletteBody}</BottomSheet>
          <BottomSheet open={sheet} onClose={() => setSheet(false)} title={selectedNode?.name ?? t("Workflow")}><View style={{ maxHeight: 520 }}>{side}</View></BottomSheet>
          <BottomSheet open={agent} onClose={() => setAgent(false)} title={t("Agent")}><View style={{ height: 560 }}><WorkflowAgentPanel sheet workflowId={doc.id} workflowName={doc.name} context={outlineText(doc)} overlay={false} onClose={() => setAgent(false)} /></View></BottomSheet>
        </>
      ) : null}
      <Menu open={menu} anchor={menuRef} items={overflow} label={t("Workflow options")} align="end" onClose={() => setMenu(false)} />
      <Menu open={!!pick && pickItems.length > 0} anchor={pick?.rect ?? { x: 0, y: 0, width: 1, height: 1 }} items={pickItems} label={t("Add a step for this connection")} title={t("Add step")} onClose={() => setPick(null)} />
      {starter.dialog}
      <ConfirmDialog open={!!replace} title={t("Replace connection")} description={t("This input already has a connection")} confirmLabel={t("Replace connection")} onClose={() => setReplace(null)} onConfirm={() => { const now = replace; setReplace(null); if (now) connect(now.from, now.to, true); }} />
      <ConfirmDialog open={!!addInput} title={addInput ? t("Add input '{name}'", { name: addInput.name }) : ""} description={t("The step has no input that fits this connection.")} confirmLabel={addInput ? t("Add input '{name}'", { name: addInput.name }) : ""} onClose={() => setAddInput(null)}
        onConfirm={() => {
          const now = addInput, target = now && doc.nodes.find((node) => node.id === now.node);
          setAddInput(null);
          if (now && target) run([{ op: "node.update", id: target.id, patch: { inputs: [...target.inputs, { id: now.name, label: now.name, type: now.type }] } }, { op: "edge.add", edge: { id: wf.nextEdgeId(doc), kind: "data", from: now.from, to: { node: target.id, port: now.name } } }], "Connect");
        }} />
      <FormDialog open={rename !== null} title={t("Rename workflow")} submitLabel={t("Rename")} dirty={rename !== null && rename !== doc.name} canSubmit={!!rename?.trim()} onClose={() => setRename(null)}
        onSubmit={() => { const name = rename?.trim(); setRename(null); if (name) run([{ op: "meta.update", patch: { name } }], "Rename"); }}>
        <FormField label={t("Name")}>{() => <Input value={rename ?? ""} maxLength={80} autoFocus onChangeText={setRename} />}</FormField>
      </FormDialog>
      <DestructiveConfirmDialog open={remove} title={t("Delete '{name}'?", { name: doc.name })} description={t("Its runs stay in the run history.")} confirmLabel={t("Delete")} onClose={() => setRemove(false)}
        onConfirm={() => { setRemove(false); void calls.remove(doc.id).then(() => router.replace(`/h/${host!.gatewayId}/workflows` as never)).catch((error) => say(failureOf(error).message)); }} />
    </Screen>
  );
}
