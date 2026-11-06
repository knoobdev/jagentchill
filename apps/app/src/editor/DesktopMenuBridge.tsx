import { useEffect, useRef } from "react";
import type { MenuItem } from "@jagentchill/ui";
import type { MediaSession } from "../media/session";
import { useRouter } from "expo-router";
import { DESKTOP_ACTION_EVENT, DESKTOP_MEDIA_EVENT, desktop, type DesktopActionDetail } from "../platform/desktop";
import { pickFiles } from "../platform/store";
import { useEditor, useEditorVersion, useTransportSelect } from "./context";

/** Actions of the application menu the editor cannot perform yet: their items stay disabled instead of doing nothing. */
const NOT_BUILT = ["timeline.multicam.create", "timeline.multicam.flatten", "timeline.speed", "editor.layout.apply", "view.focus-mode.toggle"] as const;
/** Menu actions that need at least this many selected clips. */
const NEEDS_SELECTION: Record<string, number> = {
  "timeline.cut": 1, "timeline.copy": 1, "timeline.duplicate": 1, "timeline.delete": 1, "timeline.delete-left": 1, "timeline.delete-right": 1, "timeline.group": 2, "timeline.ungroup": 1,
  "timeline.compound.create": 1, "timeline.compound.dissolve": 1, "timeline.replace-media": 1, "audio.extract.toggle": 1, "timeline.freeze": 1, "timeline.reverse": 1, "timeline.activate.toggle": 1,
  "selection.none": 1,
};
const EDITS = /^(timeline\.(split|split-all|delete|delete-left|delete-right|cut|paste|duplicate|group|ungroup|compound\.|replace-media|freeze|reverse|activate)|audio\.|edit\.|media\.import|project\.save-version)/;

/** What the editor screen itself owns: the menu reaches it through these. */
export type ScreenActions = Partial<Record<"export.open" | "view.inspector.toggle" | "view.agent-panel.toggle" | "help.shortcuts", () => void>>;

/**
 * The desktop application menu, the tray and notifications ask for actions by id; this is where the editor performs
 * them — through `runtime.act`, the same entry its keys and buttons use — and where it tells the menu which items its
 * current state allows. Outside the desktop app it does nothing.
 */
export function DesktopMenuBridge(props: { items: MenuItem[]; screen: ScreenActions; media: MediaSession | null; readOnly: boolean }) {
  const runtime = useEditor();
  const version = useEditorVersion();
  // Of the transport the menu shows whether it plays and whether it loops: not the running clock.
  const transport = useTransportSelect((state) => ({ playing: state.playing, loop: state.loop }));
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!desktop()) return;
    const project = (id: string) => (latest.current.items.find((item) => "id" in item && item.id === id) as { onSelect?(): void; disabled?: boolean } | undefined);
    const listener = (event: Event) => {
      const { action, payload } = (event as CustomEvent<DesktopActionDetail>).detail;
      const { screen, media, readOnly } = latest.current;
      if (action in screen) return screen[action as keyof ScreenActions]?.();
      if (action === "project.close") return project("back")?.onSelect?.();
      if (action === "project.save-version") return project("save-version")?.onSelect?.();
      if (action === "project.export-package") return project("export-package")?.onSelect?.();
      if (action === "media.import") {
        if (!media || readOnly) return;
        return void pickFiles("video/*,audio/*,image/*", true).then((files) => (files.length ? media.importFiles(files.map((file) => ({ file }))) : undefined));
      }
      if ((NOT_BUILT as readonly string[]).includes(action)) return;
      runtime.act(action, payload ?? {});
    };
    // Media opened with the app while this project is open, after the user chose "Add to the open project".
    const addMedia = (event: Event) => {
      const { media, readOnly } = latest.current, files = (event as CustomEvent<{ files: File[] }>).detail.files;
      if (media && !readOnly && files.length) void media.importFiles(files.map((file) => ({ file })));
    };
    window.addEventListener(DESKTOP_ACTION_EVENT, listener);
    window.addEventListener(DESKTOP_MEDIA_EVENT, addMedia);
    return () => { window.removeEventListener(DESKTOP_ACTION_EVENT, listener); window.removeEventListener(DESKTOP_MEDIA_EVENT, addMedia); };
  }, [runtime]);

  // A project is open for editing in one window: a second window that opens it gives way to the first, which comes to the front.
  const router = useRouter();
  const projectId = runtime.controller.document.metadata.id;
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let claimed = false, left = false;
    void bridge.window.claimProject(projectId).then((answer) => {
      claimed = answer.claimed;
      if (left) { if (claimed) void bridge.window.releaseProject(projectId); return; }
      if (!claimed) router.replace("/projects" as never);
    }, () => undefined);
    return () => { left = true; if (claimed) void bridge.window.releaseProject(projectId).catch(() => undefined); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The keyboard's play/pause key: the system hands it to the app whose media session is the active one.
  useEffect(() => {
    const session = desktop() && typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!session) return;
    const toggle = () => { runtime.act("playback.toggle"); };
    for (const action of ["play", "pause"] as const) session.setActionHandler(action, toggle);
    return () => { for (const action of ["play", "pause"] as const) session.setActionHandler(action, null); session.playbackState = "none"; };
  }, [runtime]);
  useEffect(() => { if (desktop() && typeof navigator !== "undefined" && navigator.mediaSession) navigator.mediaSession.playbackState = transport.playing ? "playing" : "paused"; }, [transport.playing]);

  const selected = runtime.controller.session.selection.selectedElements.length;
  const { canUndo, canRedo } = runtime.controller.session;
  const clipboardEmpty = runtime.controller.clipboard.isEmpty;
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    const enabled: Record<string, boolean> = {};
    for (const action of NOT_BUILT) enabled[action] = false;
    for (const [action, count] of Object.entries(NEEDS_SELECTION)) enabled[action] = selected >= count;
    enabled["edit.undo"] = canUndo;
    enabled["edit.redo"] = canRedo;
    enabled["timeline.paste"] = !clipboardEmpty;
    // A project open elsewhere or a previewed version is read: nothing that changes it is offered.
    if (props.readOnly) for (const action of Object.keys({ ...enabled, "timeline.split": 1, "timeline.split-all": 1, "media.import": 1, "project.save-version": 1 })) if (EDITS.test(action)) enabled[action] = false;
    // The menu follows the selection within 200 ms.
    const timer = setTimeout(() => void bridge.menu.setState({ editorForeground: true, enabled, checked: { "playback.loop.toggle": transport.loop } }).catch(() => undefined), 60);
    return () => clearTimeout(timer);
  }, [version, selected, canUndo, canRedo, clipboardEmpty, transport.loop, props.readOnly]);
  // Leaving the editor: its state no longer decides anything.
  useEffect(() => () => { void desktop()?.menu.setState({ editorForeground: false, enabled: {}, checked: {} }).catch(() => undefined); }, []);
  return null;
}
