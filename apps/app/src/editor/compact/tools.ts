import { EDITOR_PREFS } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { IconName } from "@jagentchill/ui";
import { getPref, setPref } from "../../state";
import { inspectorTabsOf } from "../Inspector";
import type { EditorRuntime } from "../runtime";
import type { LaneGroup } from "./layout";

/** A tool sheet of the phone editor: the panel of the wide layout that a tool opens, drawn under the preview. */
export type Sheet =
  | { kind: "inspector"; title: string }
  | { kind: "asset"; tab: "audio" | "text" | "stickers" | "effects" | "filters" | "captions" | "transcript"; title: string }
  | { kind: "transition" } | { kind: "more" } | { kind: "tracks"; trackId?: string } | { kind: "markers" } | { kind: "graph" } | { kind: "guides" } | { kind: "marker"; markerId: string; field: "colour" | "duration" };
/** The sub-toolbars of the root toolbar: the lane groups, and Markers. */
export type ToolGroup = LaneGroup | "markers";
/** One item of the bottom toolbar. `id` is the stable tool id: the test id and the accessibility id of the item. */
export type Tool = { id: string; label: string; icon: IconName; run(): void; pressed?: boolean };
/** What the tools reach besides the project: the sheets, groups and pickers of the screen. */
export type ToolHost = {
  runtime: EditorRuntime;
  open(sheet: Sheet): void; setGroup(group: ToolGroup | null): void; pickMedia(target: "main" | "overlay"): void; openSettings(tab: "info" | "background"): void;
  record(): void; setMulti(on: boolean): void; addText(): void; toast(message: string): void; editMarker(markerId: string): void;
};

/** Shows a tab of the inspector for the selection's type, as a press on that tab would. */
export function showInspectorTab(type: string, tab: string, sub?: string): void {
  setPref(EDITOR_PREFS.inspectorTabs, { ...getPref(EDITOR_PREFS.inspectorTabs), [type]: tab, ...(sub ? { [`${type}.sub`]: sub } : {}) });
}

const MESSAGES = { addMediaFirst: "Add media first" };
const PREFIX: Record<string, string> = { video: "clip", image: "clip", compound: "clip", audio: "aclip", text: "tclip", sticker: "sclip", graphic: "sclip", caption: "ccap", effect: "fx", adjustment: "adj" };
// The inspector tabs as the tools of a strip: the tool id suffix, the label of the strip and its icon.
const PANELS: Record<string, { tool: string; label: string; icon: IconName }> = {
  "basic": { tool: "transform", label: "Transform", icon: "sliders" }, "basic.basic": { tool: "transform", label: "Transform", icon: "sliders" },
  "basic.cutout": { tool: "cutout", label: "Remove BG", icon: "scissors" }, "basic.mask": { tool: "mask", label: "Mask", icon: "circle" }, "mask": { tool: "mask", label: "Mask", icon: "circle" },
  "audio": { tool: "volume", label: "Volume", icon: "vol" }, "speed": { tool: "speed", label: "Speed", icon: "gauge" }, "animation": { tool: "animation", label: "Animations", icon: "wand" },
  "adjustment": { tool: "adjust", label: "Adjust", icon: "adjust" }, "effects": { tool: "effect-list", label: "Effect settings", icon: "sliders" }, "parameters": { tool: "adjust", label: "Adjust", icon: "sliders" },
  "captions": { tool: "style", label: "Style", icon: "cc" }, "caption-text": { tool: "edit", label: "Edit captions", icon: "pencil" }, "tts": { tool: "tts", label: "Text to speech", icon: "voice" },
};

/** The root toolbar: the entries of the content the wide layout keeps in its asset panel, toolbar and menus. */
export function rootTools(host: ToolHost): Tool[] {
  const { runtime } = host, { controller } = runtime, session = controller.session;
  const group = (id: string, label: string, icon: IconName, name: ToolGroup): Tool => ({ id, label, icon, run: () => host.setGroup(name) });
  return [
    ...(controller.clipboard.isEmpty ? [] : [{ id: "root.paste", label: "Paste", icon: "copy" as const, run: () => void runtime.act("timeline.paste") }]),
    { id: "root.edit", label: "Edit", icon: "scissors", run: () => {
      const main = timeline.sceneById(controller.stored, session.sceneId).tracks.main;
      if (main.elements.length === 0) { host.toast(MESSAGES.addMediaFirst); return; }
      // The main-track clip under the playhead; at the very end of the track, the last one.
      const under = main.elements.find((element) => element.startTime <= session.playhead && session.playhead < timeline.endOf(element)) ?? main.elements[main.elements.length - 1];
      controller.select(timeline.selectElements([under.id]));
    } },
    group("root.audio", "Audio", "music", "audio"), group("root.text", "Text", "type", "text"),
    { id: "root.stickers", label: "Stickers", icon: "smile", run: () => host.open({ kind: "asset", tab: "stickers", title: "Stickers" }) },
    group("root.overlay", "Overlay", "layers", "overlay"), group("root.effects", "Effects", "sparkles", "effects"),
    { id: "root.filters", label: "Filters", icon: "filter", run: () => host.open({ kind: "asset", tab: "filters", title: "Filters" }) },
    group("root.captions", "Captions", "cc", "captions"),
    { id: "root.ratio", label: "Aspect ratio", icon: "aspect", run: () => host.openSettings("info") },
    { id: "root.background", label: "Background", icon: "bg", run: () => host.openSettings("background") },
    { id: "root.media", label: "Media", icon: "image", run: () => host.pickMedia("main") },
    group("root.markers", "Markers", "flag", "markers"),
    { id: "root.more", label: "More", icon: "more", run: () => host.open({ kind: "more" }) },
  ];
}

/** The sub-toolbar of a group. */
export function groupTools(group: ToolGroup, host: ToolHost): Tool[] {
  const { runtime } = host, { controller } = runtime, session = controller.session;
  switch (group) {
    case "audio": return [
      { id: "audio.sounds", label: "Sounds", icon: "music", run: () => host.open({ kind: "asset", tab: "audio", title: "Sounds" }) },
      { id: "audio.voiceover", label: "Voiceover", icon: "mic", run: host.record },
    ];
    case "text": return [
      { id: "text.add", label: "Add text", icon: "type", run: host.addText },
      { id: "text.templates", label: "Text templates", icon: "template", run: () => host.open({ kind: "asset", tab: "text", title: "Text" }) },
    ];
    case "overlay": return [{ id: "overlay.add", label: "Add overlay", icon: "plus", run: () => host.pickMedia("overlay") }];
    case "effects": return [{ id: "fx.video", label: "Video effects", icon: "sparkles", run: () => host.open({ kind: "asset", tab: "effects", title: "Effects" }) }];
    case "stickers": return [{ id: "stickers.add", label: "Stickers", icon: "smile", run: () => host.open({ kind: "asset", tab: "stickers", title: "Stickers" }) }];
    case "adjust": return [];
    case "captions": return [
      { id: "cap.import", label: "Captions", icon: "cc", run: () => host.open({ kind: "asset", tab: "captions", title: "Captions" }) },
      { id: "cap.transcript", label: "Transcript", icon: "transcript", run: () => host.open({ kind: "asset", tab: "transcript", title: "Transcript" }) },
    ];
    case "markers": {
      const scene = timeline.sceneById(controller.stored, session.sceneId), on = (scene.markers as { time: number }[]).some((marker) => marker.time === session.playhead);
      return [
        { id: "marker.add", label: on ? "Remove marker" : "Add marker", icon: "flag", pressed: on, run: () => void runtime.act("marker.toggle") },
        { id: "marker.prev", label: "Previous", icon: "skip-b", run: () => void runtime.act("marker.previous") },
        { id: "marker.next", label: "Next", icon: "skip-f", run: () => void runtime.act("marker.next") },
        { id: "marker.list", label: "List", icon: "list", run: () => host.open({ kind: "markers" }) },
      ];
    }
  }
}

/** The strip of a selected marker: its note, colour, duration, and Delete. */
export function markerTools(markerId: string, host: ToolHost): Tool[] {
  const { controller } = host.runtime;
  return [
    { id: "marker.note", label: "Edit note", icon: "pencil", run: () => host.editMarker(markerId) },
    { id: "marker.colour", label: "Colour", icon: "palette", run: () => host.open({ kind: "marker", markerId, field: "colour" }) },
    { id: "marker.duration", label: "Duration", icon: "clock", run: () => host.open({ kind: "marker", markerId, field: "duration" }) },
    { id: "marker.delete", label: "Delete", icon: "trash", run: () => void controller.run(timeline.deleteMarker({ sceneId: controller.session.sceneId, markerId })) },
  ];
}

/** The tool strip of the selection: every action and panel the wide layout offers for it, and none it does not. */
export function selectionTools(host: ToolHost): Tool[] {
  const { runtime } = host, { controller } = runtime, session = controller.session, doc = controller.document, sceneId = session.sceneId, scene = timeline.sceneById(doc, sceneId);
  const ids = session.selection.selectedElements, selected = timeline.elementsOfScene(scene).filter((element) => ids.includes(element.id)), first = selected[0];
  if (!first) return [];
  const single = selected.length === 1, prefix = single ? PREFIX[first.type] ?? "clip" : "multi";
  const states = timeline.toolStates(doc, { sceneId, selectedIds: ids, playhead: session.playhead, selectedKeyframes: session.selection.selectedKeyframes.length });
  const ok = (id: string) => states[id]?.enabled === true;
  // The action id is held under `run`: the locale collector reads a field named `action` as a screen string.
  const act = (entry: { tool: string; label: string; icon: IconName; run: string }, pressed?: boolean): Tool => ({ id: `${prefix}.${entry.tool}`, label: entry.label, icon: entry.icon, pressed, run: () => void runtime.act(entry.run) });
  const { tabs, subTabs } = inspectorTabsOf(doc, selected);
  const panels: Tool[] = tabs.flatMap((tab) => (tab.id === "basic" && subTabs.length > 1 ? subTabs.map((sub) => ({ key: `basic.${sub.id}`, tab: "basic", sub: sub.id as string | undefined, label: sub.label })) : [{ key: tab.id, tab: tab.id, sub: tab.id === "basic" ? "basic" : undefined, label: tab.label }])).map((entry) => {
    const text = first.type === "text" && entry.tab === "basic", meta = text ? { tool: "edit", label: "Edit", icon: "pencil" as IconName } : PANELS[entry.key] ?? { tool: entry.key, label: entry.label, icon: "sliders" as IconName };
    return { id: `${prefix}.${meta.tool}`, label: meta.label, icon: meta.icon, run: () => { showInspectorTab(first.type, entry.tab, entry.sub); host.open({ kind: "inspector", title: meta.label }); } };
  });
  const media = selected.every((element) => ["video", "image", "compound"].includes(element.type)), main = scene.tracks.main;
  const onMain = selected.every((element) => main.elements.some((entry) => entry.id === element.id)), onOverlay = selected.every((element) => !main.elements.some((entry) => entry.id === element.id));
  const sounding = selected.some((element) => element.type === "audio" || (timeline.isAudioCapable(doc, element) && !timeline.isFreeze(element)));
  const muted = selected.filter((element) => element.type === "audio" || timeline.isAudioCapable(doc, element)).every((element) => element.muted === true);
  const hidden = selected.every((element) => element.hidden === true), inactive = selected.every((element) => (!timeline.isHideable(element) || element.hidden === true) && (!timeline.isAudioCapable(doc, element) || element.muted === true));
  const grouped = selected.some((element) => element.groupId), linked = selected.some((element) => (element as { linkId?: string }).linkId);
  const pair = selected.length === 2 && selected.some((element) => element.type === "video") && selected.some((element) => element.type === "audio") && !linked;
  const track = timeline.locate(doc, first.id)?.track;
  return [
    ...(single && first.type === "compound" ? [act({ tool: "compound-edit", label: "Edit compound", icon: "layers", run: "timeline.compound.edit" }), act({ tool: "compound-dissolve", label: "Undo compound", icon: "undo", run: "timeline.compound.dissolve" })] : []),
    ...(ok("split") ? [act({ tool: "split", label: "Split", icon: "split", run: "timeline.split" })] : []),
    ...panels,
    act({ tool: "delete", label: "Delete", icon: "trash", run: "timeline.delete" }),
    act({ tool: "duplicate", label: "Duplicate", icon: "copy", run: "timeline.duplicate" }),
    ...(single && ["video", "image", "audio"].includes(first.type) ? [act({ tool: "replace", label: "Replace", icon: "refresh", run: "timeline.replace-media" })] : []),
    ...(media && ok("mirror") ? [act({ tool: "mirror", label: "Mirror", icon: "mirror", run: "preview.mirror" }), act({ tool: "rotate", label: "Rotate", icon: "rotate", run: "preview.rotate-90" })] : []),
    ...(single && media && ok("crop") ? [{ id: `${prefix}.crop`, label: "Crop", icon: "crop" as const, pressed: runtime.tool.crop === first.id, run: () => { showInspectorTab(first.type, "basic", "basic"); if (runtime.tool.crop !== first.id) runtime.setTool({ crop: first.id }); host.open({ kind: "inspector", title: "Crop" }); } }] : []),
    ...(single && timeline.isEffectCapable(first) ? [
      ...(media ? [{ id: `${prefix}.filter`, label: "Filters", icon: "filter" as const, run: () => host.open({ kind: "asset", tab: "filters", title: "Filters" }) }] : []),
      { id: `${prefix}.effects`, label: "Effects", icon: "sparkles" as const, run: () => host.open({ kind: "asset", tab: "effects", title: "Effects" }) },
    ] : []),
    ...(ok("reverse") ? [act({ tool: "reverse", label: "Reverse", icon: "reverse", run: "timeline.reverse" }, selected.every((element) => (element.retime as { reverse?: boolean } | undefined)?.reverse === true))] : []),
    ...(ok("freeze") ? [act({ tool: "freeze", label: "Freeze", icon: "snow", run: "timeline.freeze" })] : []),
    ...(ok("extract-audio") && selected.some((element) => element.type === "video" && (element.isSourceAudioEnabled === false || timeline.isAudioCapable(doc, element))) ? [act({ tool: "extract-audio", label: timeline.extractAudioTool(doc, ids) === "recover" ? "Recover audio" : "Extract audio", icon: "music", run: "audio.extract.toggle" })] : []),
    ...(sounding ? [act({ tool: "mute", label: muted ? "Unmute" : "Mute", icon: muted ? "mute" : "vol", run: "audio.mute.toggle" }, muted)] : []),
    ...(linked ? [act({ tool: "unlink", label: "Unlink", icon: "link", run: "timeline.unlink" })] : []),
    ...(pair ? [act({ tool: "link", label: "Link", icon: "link", run: "timeline.link" })] : []),
    ...(single && media && onMain ? [act({ tool: "to-overlay", label: "To overlay", icon: "layers", run: "timeline.to-overlay" })] : []),
    ...(single && media && onOverlay ? [act({ tool: "to-main", label: "To main track", icon: "arrow-d", run: "timeline.to-main" })] : []),
    ...(grouped ? [act({ tool: "ungroup", label: "Ungroup", icon: "box", run: "timeline.ungroup" })] : selected.length >= 2 ? [act({ tool: "group", label: "Group", icon: "box", run: "timeline.group" })] : []),
    ...(selected.every((element) => timeline.isVisual(element) || element.type === "audio") && !(single && first.type === "compound") ? [act({ tool: "compound", label: "Compound", icon: "archive", run: "timeline.compound.create" })] : []),
    act({ tool: "copy", label: "Copy", icon: "copy", run: "timeline.copy" }), act({ tool: "cut", label: "Cut", icon: "scissors", run: "timeline.cut" }),
    ...(selected.every(timeline.isHideable) ? [act({ tool: "hide", label: hidden ? "Show" : "Hide", icon: hidden ? "eye" : "eye-off", run: "timeline.toggle-hidden" }, hidden)] : []),
    act({ tool: "deactivate", label: inactive ? "Activate" : "Deactivate", icon: "slash-c", run: "timeline.activate.toggle" }, inactive),
    ...(single ? [act({ tool: "rename", label: "Rename", icon: "pencil", run: "timeline.element.rename" })] : []),
    ...(ok("graph-editor") ? [{ id: `${prefix}.graph`, label: "Graph editor", icon: "graph" as const, run: () => host.open({ kind: "graph" }) }] : []),
    ...(single && track && track !== main ? [{ id: `${prefix}.select-track`, label: "Select all on track", icon: "check-check" as const, run: () => void runtime.act("timeline.track.select-all", { trackId: track.id }) }] : []),
    { id: `${prefix}.layers`, label: "Tracks", icon: "layers", run: () => host.open({ kind: "tracks", trackId: track?.id }) },
  ];
}
