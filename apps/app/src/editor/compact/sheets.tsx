import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanResponder, ScrollView, View } from "react-native";
import { PLAYBACK_RATES, PREVIEW_QUALITY_LABELS, rateLabel, type PreviewQuality } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type ProjectDocument } from "@jagentchill/protocol";
import { Button, Icon, IconButton, Input, MARKER_COLORS, NumberField, Segmented, Switch, Tap, Text, radius, space, useTheme, type IconName, inlineIcon } from "@jagentchill/ui";
import { useT } from "../../locale";
import { AudioTab } from "../assets/AudioTab";
import { CaptionsTab } from "../assets/CaptionsTab";
import { EffectsTab, FiltersTab, TransitionsTab } from "../assets/FxLibrary";
import { StickersTab } from "../assets/StickersTab";
import { TextTab } from "../assets/TextTab";
import { TranscriptTab } from "../assets/TranscriptTab";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { TransitionInspector } from "../fx/inspector";
import { GraphEditor } from "../graph/GraphEditor";
import { Inspector } from "../Inspector";
import { GuidesPanel, VolumePanel } from "../Player";
import { TrackSoundPanel } from "../Timeline";
import { clock, COMPACT } from "./layout";
import type { Sheet } from "./tools";

const TRACK_ICON: Record<string, IconName> = { video: "video", audio: "music", text: "type", graphic: "smile", effect: "sparkles", adjustment: "adjust", caption: "cc" };
const ADDABLE = ["video", "audio", "text", "graphic", "effect"] as const;

/**
 * A tool sheet: it takes the place of the bottom toolbar and of the lanes, under the 48 pt timeline, and never covers
 * the preview. Every change made in it is drawn at once and is the same undo step as on the wide layout.
 */
export function ToolSheet(props: { title: string; height: number; width?: number; landscape?: boolean; onClose(): void; /** A sheet that edits the project is cancelled with ✕ (its changes are taken back) and confirmed with ✓ (they are one undo step); one that only shows or switches things is put away with ⌄. */ onCancel?(): void; children: ReactNode; testID?: string }) {
  const t = useT();
  const theme = useTheme();
  const handlePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy > 64 || gesture.vy > 0.8) props.onClose(); },
  }), [props.onClose]);
  return (
    <View testID={props.testID ?? "tool-sheet"} role="region" aria-label={props.title} style={{ height: props.landscape ? "100%" : props.height, width: props.landscape ? props.width : undefined, flex: props.landscape ? 1 : undefined, backgroundColor: theme.color("bg/elevated"), borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: theme.color("border/hairline"), overflow: "hidden" }}>
      <View testID="tool-sheet-handle-zone" {...handlePan.panHandlers} style={{ height: 24, alignItems: "center", justifyContent: "center" }}>
        <Tap role="button" label={t("Close")} testID="tool-sheet-handle" onPress={props.onClose} style={{ width: 48, height: 24, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 36, height: 4, borderRadius: radius.full, backgroundColor: theme.color("border/strong") }} />
        </Tap>
      </View>
      <View style={{ height: COMPACT.sheetHeader, flexDirection: "row", alignItems: "center", paddingHorizontal: space[1] }}>
        {props.onCancel ? <IconButton icon="x" label={t("Cancel")} testID="tool-sheet-cancel" onPress={props.onCancel} /> : <View style={{ width: 44 }} />}
        <Text variant="title-sm" level={2} numberOfLines={1} align="center" testID="tool-sheet-title" style={{ flex: 1 }}>{props.title}</Text>
        <IconButton icon={props.onCancel ? "check" : "chev-d"} label={t(props.onCancel ? "Apply" : "Close")} testID="tool-sheet-close" onPress={props.onClose} />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{props.children}</View>
    </View>
  );
}

/** The inspector of the selection, as the wide layout draws it: every tab, section and control is the same component. */
export function InspectorSheet(props: { onModify(): void }) {
  return <Inspector onModify={props.onModify} />;
}

/** A tab of the asset panel. */
export function AssetSheet(props: { tab: Extract<Sheet, { kind: "asset" }>["tab"]; document: ProjectDocument; readOnly: boolean; onOpenCaptions(): void }) {
  switch (props.tab) {
    case "audio": return <AudioTab document={props.document} readOnly={props.readOnly} />;
    case "text": return <TextTab readOnly={props.readOnly} />;
    case "stickers": return <StickersTab readOnly={props.readOnly} />;
    case "effects": return <EffectsTab readOnly={props.readOnly} />;
    case "filters": return <FiltersTab readOnly={props.readOnly} />;
    case "captions": return <CaptionsTab document={props.document} readOnly={props.readOnly} />;
    case "transcript": return <TranscriptTab document={props.document} readOnly={props.readOnly} onOpenCaptions={props.onOpenCaptions} />;
  }
}

/** The transition of a cut: its settings, and the library to choose another one from. */
export function TransitionSheet(props: { transitionId: string; readOnly: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"settings" | "library">("settings");
  return (
    <View testID="transition-sheet" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: space[3], paddingBottom: space[2] }}>
        <Segmented label={t("Transition")} size="sm" block value={tab} onChange={(next) => setTab(next as "settings" | "library")} options={[{ value: "settings", label: t("Settings") }, { value: "library", label: t("Library") }]} />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{tab === "settings" ? <ScrollView><TransitionInspector transitionId={props.transitionId} /></ScrollView> : <TransitionsTab readOnly={props.readOnly} />}</View>
    </View>
  );
}

export function GraphSheet() { return <View testID="graph-sheet" style={{ flex: 1, minHeight: 0 }}><GraphEditor /></View>; }
export function GuidesSheet() { return <ScrollView contentContainerStyle={{ padding: space[3] }}><GuidesPanel /></ScrollView>; }

function Row(props: { icon?: IconName; label: string; onPress?(): void; children?: ReactNode; testID?: string; value?: string }) {
  const theme = useTheme();
  const content = (
    <>
      {props.icon ? <Icon name={props.icon} size={20} color="text/secondary" /> : null}
      <Text style={{ flex: 1 }} numberOfLines={1}>{props.label}</Text>
      {props.value ? <Text variant="meta" color="text/secondary">{props.value}</Text> : null}
      {props.children}
      {props.onPress && !props.children ? <Icon name={inlineIcon(theme.rtl, "chev-r")} size={16} color="text/secondary" /> : null}
    </>
  );
  const style = { minHeight: 48, flexDirection: "row" as const, alignItems: "center" as const, gap: space[3], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") };
  return props.onPress ? <Tap role="button" label={props.label} testID={props.testID} onPress={props.onPress} style={style}>{content}</Tap> : <View testID={props.testID} style={style}>{content}</View>;
}

/**
 * The More sheet: scenes, tracks, the range, the editing switches and the monitoring settings of the player. The phone has
 * no magnet and no ripple switch: its main track is magnetic whenever Free layer is off, and nothing else ripples.
 */
export function MoreSheet(props: { multi: boolean; onOpen(sheet: Sheet): void; onSelectMode(): void; onOpenSettings(): void; onClose(): void }) {
  const t = useT();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const { controller } = runtime, session = controller.session, prefs = runtime.prefs;
  const scene = timeline.sceneById(controller.stored, session.sceneId);
  const toggle = (label: string, value: boolean, action: string, testID: string, disabled = false) => <Row label={label} testID={testID}><Switch accessibilityLabel={label} value={value} disabled={disabled} onChange={() => { runtime.act(action); }} /></Row>;
  return (
    <ScrollView testID="more-sheet" contentContainerStyle={{ paddingBottom: space[4] }}>
      <Row icon="film" label={t("Scenes")} value={scene.name} testID="more.scenes" onPress={() => { props.onClose(); runtime.act("timeline.scenes.open"); }} />
      <Row icon="layers" label={t("Tracks")} testID="more.tracks" onPress={() => props.onOpen({ kind: "tracks" })} />
      <Row icon="transcript" label={t("Transcript")} testID="more.transcript" onPress={() => props.onOpen({ kind: "asset", tab: "transcript", title: "Transcript" })} />
      <Row label={t("In/out range")} testID="more.range">
        <Button size="xs" kind="outline" label={t("Set in")} testID="range-in" onPress={() => void runtime.act("range.set-in")} />
        <Button size="xs" kind="outline" label={t("Set out")} testID="range-out" onPress={() => void runtime.act("range.set-out")} />
        <IconButton icon="x" label={t("Clear range")} testID="range-clear" disabled={scene.inPoint === undefined && scene.outPoint === undefined} onPress={() => void runtime.act("range.clear")} />
      </Row>
      <Row icon="check-check" label={t("Select")} testID="more.select" onPress={props.onSelectMode} />
      {toggle(t("Auto snapping"), prefs.snapping, "timeline.snapping.toggle", "more.snapping")}
      {toggle(t("Linkage"), prefs.linkage, "timeline.linkage.toggle", "more.linkage")}
      {toggle(t("Free layer"), prefs.freeLayer, "timeline.toggle-free-layer", "more.free-layer")}
      <Row label={t("Loop")} testID="more.loop"><Switch accessibilityLabel={t("Loop")} value={transport.loop} onChange={(on) => runtime.setLoop(on)} /></Row>
      <Row label={t("Playback rate")} testID="more.rate"><Segmented label={t("Playback rate")} size="xs" value={String(transport.menuRate)} onChange={(value) => runtime.setRate(Number(value))} options={PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: rateLabel(rate) }))} /></Row>
      <Row label={t("Preview quality")} testID="more.quality"><Segmented label={t("Preview quality")} size="xs" value={transport.quality} onChange={(value) => runtime.setQuality(value as PreviewQuality)} options={(Object.keys(PREVIEW_QUALITY_LABELS) as PreviewQuality[]).map((quality) => ({ value: quality, label: t(PREVIEW_QUALITY_LABELS[quality]) }))} /></Row>
      <View testID="more.volume" style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}><Text variant="meta" color="text/secondary">{t("Volume")}</Text><VolumePanel /></View>
      <Row icon="grid" label={t("Guides")} testID="more.guides" onPress={() => props.onOpen({ kind: "guides" })} />
      <Row icon="camera" label={t("Save snapshot")} testID="more.snapshot" onPress={() => void runtime.act("player.snapshot")} />
      <Row icon="gear" label={t("Project settings")} testID="more.settings" onPress={props.onOpenSettings} />
    </ScrollView>
  );
}

/** Every track of the scene in stack order with its controls: the header column of the wide timeline, as rows. */
export function TracksSheet(props: { trackId?: string; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, session = controller.session, scene = timeline.sceneById(controller.document, session.sceneId), tracks = timeline.tracksOfScene(scene);
  const [open, setOpen] = useState<string | null>(props.trackId ?? null);
  const [flash, setFlash] = useState<string | null>(props.trackId ?? null);
  const [renaming, setRenaming] = useState<{ trackId: string; draft: string } | null>(null);
  // The row a lane label opened is marked for a second.
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), 1000); return () => clearTimeout(timer); }, [flash]);
  const commitName = () => {
    if (!renaming) return;
    const name = timeline.committedName(renaming.draft), track = tracks.find((entry) => entry.id === renaming.trackId);
    setRenaming(null);
    if (name && track && name !== track.name) controller.run(timeline.renameTrack({ trackId: track.id, name }));
  };
  return (
    <ScrollView testID="tracks-sheet" contentContainerStyle={{ paddingBottom: space[4] }}>
      {tracks.map((track) => {
        const isMain = track === scene.tracks.main, expanded = open === track.id;
        const flag = (icon: IconName, label: string, on: boolean, action: string, id: string) => <IconButton key={id} icon={icon} label={label} on={on} toggle testID={`track-${id}-${track.type}`} onPress={() => void runtime.act(action, { trackId: track.id })} />;
        return (
          <View key={track.id} testID={`track-row-${isMain ? "main" : track.type}`} style={{ borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: flash === track.id ? theme.color("accent/subtle") : "transparent" }}>
            <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[4], paddingEnd: space[1] }}>
              <Icon name={TRACK_ICON[track.type] ?? "layers"} size={20} color="text/secondary" />
              {renaming?.trackId === track.id ? (
                <View style={{ flex: 1 }}><Input accessibilityLabel={t("Rename track")} autoFocus maxLength={60} value={renaming.draft} onChangeText={(draft) => setRenaming({ trackId: track.id, draft })} onBlur={commitName} onSubmitEditing={commitName} /></View>
              ) : (
                <Tap role="button" label={t("Track {name}", { name: track.name })} testID={`track-open-${isMain ? "main" : track.type}`} onPress={() => setOpen(expanded ? null : track.id)} style={{ flex: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: space[2] }}>
                  <Text numberOfLines={1}>{track.name}</Text>
                </Tap>
              )}
              {timeline.trackSupports(track, "hidden") && !isMain ? flag(track.hidden === true ? "eye-off" : "eye", t(track.hidden === true ? "Show" : "Hide"), track.hidden === true, "timeline.track.hide.toggle", "hide") : null}
              {flag("lock", t(track.locked ? "Unlock" : "Lock"), track.locked, "timeline.track-lock.toggle", "lock")}
              {timeline.trackSupports(track, "muted") ? flag(track.muted === true ? "mute" : "vol", t(track.muted === true ? "Unmute" : "Mute"), track.muted === true, "timeline.track.mute.toggle", "mute") : null}
              {timeline.trackSupports(track, "solo") ? flag("star", t(track.solo === true ? "Unsolo" : "Solo"), track.solo === true, "timeline.track.solo.toggle", "solo") : null}
            </View>
            {expanded ? (
              <View style={{ paddingHorizontal: space[4], paddingBottom: space[3], gap: space[2] }}>
                {timeline.trackSupports(track, "volume") ? <TrackSoundPanel trackId={track.id} /> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  <Button size="xs" kind="outline" icon="pencil" label={t("Rename")} testID="track-rename" onPress={() => setRenaming({ trackId: track.id, draft: track.name })} />
                  <Button size="xs" kind="outline" label={t("Select all on track")} testID="track-select-all" onPress={() => { runtime.act("timeline.track.select-all", { trackId: track.id }); props.onClose(); }} />
                  {isMain ? null : <>
                    <Button size="xs" kind="outline" icon="arrow-up" label={t("Move track up")} testID="track-up" onPress={() => void runtime.act("timeline.track.move-up", { trackId: track.id })} />
                    <Button size="xs" kind="outline" icon="arrow-d" label={t("Move track down")} testID="track-down" onPress={() => void runtime.act("timeline.track.move-down", { trackId: track.id })} />
                    <Button size="xs" kind="ghost" tone="danger" icon="trash" label={t("Delete track")} testID="track-delete" onPress={() => void runtime.act("timeline.track.delete", { trackId: track.id })} />
                  </>}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], padding: space[4] }}>
        <Text variant="meta" color="text/secondary">{t("Add track")}</Text>
        {ADDABLE.map((type) => <Button key={type} size="xs" kind="outline" icon={TRACK_ICON[type]} label={t(timeline.DEFAULT_TRACK_NAMES[type])} testID={`track-add-${type}`} onPress={() => void controller.run(timeline.addTrack({ sceneId: session.sceneId, type }))} />)}
      </View>
    </ScrollView>
  );
}

/** Every marker of the scene: a row seeks to it, its pencil edits it. */
export function MarkersSheet(props: { onEdit(markerId: string): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, scene = timeline.sceneById(controller.stored, controller.session.sceneId);
  const markers = [...(scene.markers as { id: string; time: number; color: number | string; note?: string }[])].sort((a, b) => a.time - b.time);
  if (markers.length === 0) {
    return (
      <View testID="markers-empty" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
        <Text color="text/secondary">{t("No markers yet")}</Text>
        <Button size="sm" kind="outline" icon="flag" label={t("Add marker")} testID="markers-add" onPress={() => void runtime.act("marker.toggle")} />
      </View>
    );
  }
  return (
    <ScrollView testID="markers-sheet" contentContainerStyle={{ paddingBottom: space[4] }}>
      {markers.map((marker) => {
        const index = typeof marker.color === "number" ? marker.color : 0, token = MARKER_COLORS[((index % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length]![0];
        return (
          <View key={marker.id} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), paddingEnd: space[1] }}>
            <Tap role="button" label={t("Go to marker at {time}", { time: clock(marker.time) })} testID="marker-row" onPress={() => { runtime.pause(); runtime.seek(marker.time); }} style={{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4] }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.color(token) }} />
              <Text variant="mono">{clock(marker.time)}</Text>
              <Text color="text/secondary" numberOfLines={1} style={{ flex: 1 }}>{marker.note ?? ""}</Text>
            </Tap>
            <IconButton icon="pencil" label={t("Edit marker")} testID="marker-edit" onPress={() => props.onEdit(marker.id)} />
            <IconButton icon="trash" label={t("Delete marker")} testID="marker-remove" onPress={() => void controller.run(timeline.deleteMarker({ sceneId: controller.session.sceneId, markerId: marker.id }))} />
          </View>
        );
      })}
      <View style={{ flexDirection: "row", padding: space[4] }}><Button size="sm" kind="ghost" tone="danger" icon="trash" label={t("Delete all markers")} testID="markers-delete-all" onPress={() => void runtime.act("timeline.marker.delete-all")} /></View>
    </ScrollView>
  );
}

/** One field of a marker: its colour among the eight marker colours, or its duration. */
export function MarkerFieldSheet(props: { markerId: string; field: "colour" | "duration" }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, sceneId = controller.session.sceneId, scene = timeline.sceneById(controller.stored, sceneId);
  const marker = (scene.markers as { id: string; time: number; color: number | string; duration?: number }[]).find((entry) => entry.id === props.markerId);
  if (!marker) return null;
  if (props.field === "colour") {
    return (
      <View testID="marker-colours" role="radiogroup" aria-label={t("Color")} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[3], padding: space[4] }}>
        {MARKER_COLORS.map(([token, name], index) => (
          <Tap key={token} role="radio" label={t(name)} checked={marker.color === index} testID={`marker-colour-${index}`} onPress={() => void controller.run(timeline.editMarker({ sceneId, markerId: marker.id, color: index }))}
            style={{ width: 44, height: 44, borderRadius: radius.full, backgroundColor: theme.color(token), borderWidth: marker.color === index ? 3 : 0, borderColor: theme.color("text/primary") }} />
        ))}
      </View>
    );
  }
  const most = Math.max(0, (timeline.sceneDurationOf(scene) - marker.time) / TICKS_PER_SECOND);
  return (
    <View testID="marker-duration" style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4] }}>
      <Text style={{ flex: 1 }}>{t("Duration")}</Text>
      <NumberField label={t("Duration")} hideLabel unit="s" min={0} max={most} step={0.1} width={120} value={Number(((marker.duration ?? 0) / TICKS_PER_SECOND).toFixed(2))} onCommit={(seconds) => void controller.run(timeline.editMarker({ sceneId, markerId: marker.id, durationSeconds: seconds }))} />
    </View>
  );
}
