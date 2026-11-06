import { timeline } from "@jagentchill/editor-core";
import { preference } from "../shell/prefs.ts";
import { GUIDE_DEFAULTS, isGuideSettings, type GuideSettings } from "./preview-view.ts";
import { isVolume, VOLUME_DEFAULT, type Volume } from "./transport.ts";

const isTimelinePrefs = (value: unknown): value is timeline.TimelinePreferences => {
  const prefs = value as timeline.TimelinePreferences | null;
  return prefs !== null && typeof prefs === "object" && (["magnet", "ripple", "linkage", "freeLayer", "snapping", "previewAxis"] as const).every((key) => typeof prefs[key] === "boolean") && ["page", "smooth", "off"].includes(prefs.autoFollow);
};
export type PreviewQuality = "auto" | "full" | "half" | "quarter";
export const PREVIEW_QUALITY_LABELS: Record<PreviewQuality, string> = { auto: "Auto", full: "Full", half: "1/2", quarter: "1/4" };
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isRecord = <T>(check: (value: unknown) => value is T) => (value: unknown): value is Record<string, T> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(check);
export type EditorRegions = { assets: boolean; inspector: boolean; timeline: boolean };

/** What the editor keeps per device: the toolbar toggles of the timeline, the monitoring settings of the player and the open regions. */
export const EDITOR_PREFS = {
  timeline: preference<timeline.TimelinePreferences>("timeline.toggles.2", timeline.DEFAULT_TIMELINE_PREFERENCES, isTimelinePrefs),
  loop: preference<boolean>("player.loop", false, isBoolean),
  volume: preference<Volume>("player.volume", VOLUME_DEFAULT, isVolume),
  quality: preference<PreviewQuality>("player.quality", "auto", (value): value is PreviewQuality => ["auto", "full", "half", "quarter"].includes(value as string)),
  guides: preference<GuideSettings>("player.guides", GUIDE_DEFAULTS, isGuideSettings),
  regions: preference<EditorRegions>("editor.regions", { assets: true, inspector: true, timeline: true }, (value): value is EditorRegions => value !== null && typeof value === "object" && (["assets", "inspector", "timeline"] as const).every((key) => typeof (value as EditorRegions)[key] === "boolean")),
  /** The last inspector tab per element type, and the collapsed inspector sections by key. */
  inspectorTabs: preference<Record<string, string>>("inspector.tabs", {}, isRecord((value): value is string => typeof value === "string")),
  inspectorCollapsed: preference<Record<string, boolean>>("inspector.collapsed", {}, isRecord(isBoolean)),
  /** The active asset tab, per project id. */
  assetTabs: preference<Record<string, string>>("editor.asset-tabs", {}, isRecord((value): value is string => typeof value === "string")),
};

/** The asset panel tabs the editor frame draws, in order. */
export const ASSET_TAB_ITEMS = [
  { id: "media", label: "Media", icon: "image" }, { id: "audio", label: "Audio", icon: "music" }, { id: "text", label: "Text", icon: "type" }, { id: "stickers", label: "Stickers", icon: "smile" },
  { id: "effects", label: "Effects", icon: "sparkles" }, { id: "transitions", label: "Transitions", icon: "transition" }, { id: "captions", label: "Captions", icon: "cc" }, { id: "transcript", label: "Transcript", icon: "transcript" },
  { id: "filters", label: "Filters", icon: "filter" }, { id: "adjustment", label: "Adjustment", icon: "adjust" }, { id: "templates", label: "Templates", icon: "template" }, { id: "brand-kit", label: "Brand kit", icon: "palette" },
] as const;
export type AssetTabId = (typeof ASSET_TAB_ITEMS)[number]["id"];
