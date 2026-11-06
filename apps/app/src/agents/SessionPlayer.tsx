import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { clockOf, createEditorController, EDITOR_PREFS } from "@jagentchill/app-core";
import { uuidV4 } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import type { StoragePort } from "@jagentchill/storage";
import { IconButton, Slider, Text, space, useTheme } from "@jagentchill/ui";
import { EditorContext, useEditor, useTransport } from "../editor/context";
import { Player } from "../editor/Player";
import { createEditorRuntime, type EditorRuntime } from "../editor/runtime";
import { useT } from "../locale";
import { createMediaSession } from "../media/session";
import { getPref, setPref } from "../state";

const PREF_STORE = { get: getPref, set: setPref } as never;

/**
 * The project of a session, played by the editor's own preview engine over a read-only session of its own: the same
 * player region as the editor's, without its editing gestures. Nothing here changes or saves the project; `document`
 * is what is drawn (the stored project, or a proposal applied to it).
 */
export function SessionPlayer(props: { storage: StoragePort; projectId: string; document: ProjectDocument; onOpen(): void }) {
  const t = useT();
  const translate = useRef(t);
  translate.current = t;
  const shown = useRef(props.document);
  const [runtime, setRuntime] = useState<EditorRuntime | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const controller = createEditorController({ document: shown.current, newId: () => uuidV4(), platform: "web", prefs: () => getPref(EDITOR_PREFS.timeline), readOnly: translate.current("Read-only") });
    const refuse = () => { throw new Error("read-only"); };
    // The library only reads here: a change it would record is refused, so closing it removes nothing from the store.
    const media = createMediaSession({ storage: props.storage, projectId: props.projectId, document: () => controller.stored, context: () => ({ now_ms: Date.now(), newId: () => uuidV4() }), commit: refuse, rollback: () => undefined, setDocument: () => undefined, flush: async () => undefined, hostConnected: () => false });
    const made = createEditorRuntime({ controller, media, prefs: PREF_STORE, toast: () => undefined, t: (text, values) => translate.current(text, values) });
    const off = made.subscribe(() => setTick((value) => value + 1));
    setRuntime(made);
    return () => { off(); made.close(); controller.close(); void media.close(); };
  }, [props.storage, props.projectId]);
  // Another state of the same project (saved again, or the proposed one) is drawn by the same engine.
  useEffect(() => {
    if (shown.current === props.document) return;
    shown.current = props.document;
    if (!runtime) return;
    runtime.pause();
    runtime.controller.replace(props.document);
    if (runtime.controller.session.playhead > runtime.duration()) runtime.controller.seek(runtime.duration());
  }, [props.document, runtime]);
  if (!runtime) return <View style={{ flex: 1 }} />;
  return (
    <EditorContext.Provider value={runtime}>
      <Player viewOnly onOpenCanvasSettings={props.onOpen} surface="bg/inset" bar={(state) => <TransportBar fullscreen={state.fullscreen} onFullscreen={state.toggleFullscreen} />} />
    </EditorContext.Provider>
  );
}

/** Play, scrub, the time and fullscreen: the transport of a preview that edits nothing. */
function TransportBar(props: { fullscreen: boolean; onFullscreen(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useTransport();
  const duration = runtime.duration();
  const ready = duration > 0 && transport.engine === "ready";
  return (
    <View testID="session-player-bar" {...({ dataSet: { engine: transport.engine, playing: String(transport.playing), time: String(Math.round(transport.time)) } } as object)}
      style={{ minHeight: theme.touch ? 48 : 36, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], backgroundColor: theme.color("bg/inset"), borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <IconButton testID="session-player-play" icon={transport.playing ? "pause" : "play"} size="sm" color="text/primary" label={t(transport.playing ? "Pause" : "Play")} disabled={!ready} onPress={() => runtime.toggle()} />
      <View testID="session-player-scrub" style={{ flex: 1, minWidth: 60 }}>
        <Slider label={t("Current time")} min={0} max={Math.max(1, duration)} step={1} disabled={!ready} value={Math.min(duration, transport.time)} onChange={(value) => runtime.seek(value as number)} onCommit={(value) => runtime.seek(value as number)} />
      </View>
      <Text variant="mono" color="text/secondary" testID="session-player-time">{`${clockOf(Math.round(transport.time)) ?? ""} / ${clockOf(duration) ?? ""}`}</Text>
      <IconButton testID="session-player-fullscreen" icon="full" size="sm" label={t(props.fullscreen ? "Exit fullscreen" : "Fullscreen")} on={props.fullscreen} onPress={props.onFullscreen} />
    </View>
  );
}
