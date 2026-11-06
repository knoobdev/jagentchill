import { formatUsd, formatSeconds } from "@jagentchill/app-core";
import type { film as fm } from "@jagentchill/editor-core";

/** The words of Film Studio that are held in tables: the key is the value of the model, the text is English (translated where it is shown). */
type Row<T extends string> = { id: T; label: string };
const table = <T extends string>(rows: Row<T>[]): ((id: string) => string) => { const map = new Map<string, string>(rows.map((row) => [row.id, row.label])); return (id) => map.get(id) ?? id; };
export const STAGE_ROWS: Row<fm.StageId>[] = [{ id: "story", label: "Story" }, { id: "assets", label: "Assets" }, { id: "storyboard", label: "Storyboard" }, { id: "voice", label: "Voice" }, { id: "timeline", label: "Timeline" }];
export const SHOT_ROWS: Row<fm.ShotSize>[] = [
  { id: "extreme-wide", label: "Extreme wide" }, { id: "wide", label: "Wide" }, { id: "full", label: "Full" }, { id: "medium", label: "Medium" }, { id: "medium-close", label: "Medium-close" }, { id: "close-up", label: "Close-up" },
  { id: "extreme-close-up", label: "Extreme close-up" }, { id: "insert", label: "Insert" },
];
export const MOTION_ROWS: Row<fm.CameraMotion>[] = [
  { id: "static", label: "Static" }, { id: "pan-left", label: "Pan-left" }, { id: "pan-right", label: "Pan-right" }, { id: "tilt-up", label: "Tilt-up" }, { id: "tilt-down", label: "Tilt-down" }, { id: "push-in", label: "Push-in" },
  { id: "pull-out", label: "Pull-out" }, { id: "track", label: "Track" }, { id: "orbit", label: "Orbit" }, { id: "handheld", label: "Handheld" },
];
export const KIND_ROWS: Row<fm.LineKind>[] = [{ id: "dialogue", label: "dialogue" }, { id: "inner", label: "inner" }, { id: "narration", label: "narration" }];
export const EMOTION_ROWS: Row<string>[] = [
  { id: "", label: "Neutral" }, { id: "calm", label: "Calm" }, { id: "warm", label: "Warm" }, { id: "tender", label: "Tender" }, { id: "hopeful", label: "Hopeful" }, { id: "earnest", label: "Earnest" }, { id: "startled", label: "Startled" },
  { id: "joyful", label: "Joyful" }, { id: "sad", label: "Sad" }, { id: "angry", label: "Angry" }, { id: "fearful", label: "Fearful" },
];
export const ROLE_ROWS: Row<string>[] = [{ id: "lead", label: "Lead" }, { id: "supporting", label: "Supporting" }, { id: "extra", label: "Extra" }];
export const STYLE_ROWS: Row<fm.ArtStyle>[] = [
  { id: "cinematic-realistic", label: "Cinematic realistic" }, { id: "anime", label: "Anime" }, { id: "comic", label: "Comic" }, { id: "watercolour", label: "Watercolour storybook" }, { id: "3d-animation", label: "3D animation" }, { id: "custom", label: "Custom" },
];
export const MOOD_ROWS: Row<string>[] = [
  { id: "none", label: "No music" }, { id: "calm", label: "Calm" }, { id: "upbeat", label: "Upbeat" }, { id: "dramatic", label: "Dramatic" }, { id: "playful", label: "Playful" }, { id: "dark", label: "Dark" }, { id: "epic", label: "Epic" }, { id: "romantic", label: "Romantic" },
];
export const LANGUAGE_ROWS: Row<string>[] = [
  { id: "en", label: "English" }, { id: "vi", label: "Vietnamese" }, { id: "ja", label: "Japanese" }, { id: "es", label: "Spanish" }, { id: "fr", label: "French" }, { id: "de", label: "German" }, { id: "pt", label: "Portuguese" }, { id: "ko", label: "Korean" }, { id: "zh", label: "Chinese" },
];
/** The accents a voice can be asked for (`fm.ACCENTS`), as a person reads them. */
export const ACCENT_ROWS: Row<string>[] = [{ id: "northern", label: "Northern" }, { id: "central", label: "Central" }, { id: "southern", label: "Southern" }];
export const PIPELINE_ROWS: Row<string>[] = [{ id: "breakdown", label: "Script" }, { id: "asset_images", label: "Assets" }, { id: "panel_images", label: "Storyboard" }, { id: "voice", label: "Voice" }, { id: "music", label: "Music" }, { id: "assemble", label: "Timeline" }];
export const NODE_ROWS: Row<string>[] = [
  { id: "pending", label: "Waiting" }, { id: "queued", label: "Queued" }, { id: "running", label: "Running" }, { id: "waiting_approval", label: "Awaiting review" }, { id: "succeeded", label: "Done" }, { id: "failed", label: "Failed" },
  { id: "skipped", label: "Skipped" }, { id: "cancelled", label: "Cancelled" }, { id: "paused", label: "Paused" }, { id: "interrupted", label: "Interrupted" },
];
export const RUN_ROWS: Row<string>[] = [
  { id: "queued", label: "Queued" }, { id: "running", label: "Generating" }, { id: "paused", label: "Paused" }, { id: "waiting_approval", label: "Awaiting review" }, { id: "succeeded", label: "Completed" }, { id: "failed", label: "Failed" }, { id: "cancelled", label: "Cancelled" },
];
export const stageLabel = table(STAGE_ROWS), shotLabel = table(SHOT_ROWS), motionLabel = table(MOTION_ROWS), kindLabel = table(KIND_ROWS), emotionLabel = table(EMOTION_ROWS), roleLabel = table(ROLE_ROWS), styleLabel = table(STYLE_ROWS),
  moodLabel = table(MOOD_ROWS), pipelineLabel = table(PIPELINE_ROWS), nodeLabel = table(NODE_ROWS), runLabel = table(RUN_ROWS);

export const TICKS = 120_000;
export const secondsOf = (ticks: number): string => { const value = ticks / TICKS; return formatSeconds(value, Number.isInteger(value) ? 0 : 1); };
/** m:ss of a take. */
export const short = (ticks: number): string => { const total = Math.round(ticks / TICKS); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; };
/** hh:mm:ss:ff at the film's frame rate. */
export const timecode = (ticks: number, frameRate: number): string => {
  const frames = Math.round((ticks / TICKS) * frameRate), pad = (value: number) => String(value).padStart(2, "0"), total = Math.floor(frames / frameRate);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(frames % frameRate)}`;
};
export const usd = (amount: number | null): string => formatUsd(amount, { fine: true });
export const ratioOf = (aspect: string): number => { const [w, h] = aspect.split(":").map(Number); return w > 0 && h > 0 ? w / h : 16 / 9; };
export const filmRoute = (hostId: string, filmId: string, stage: fm.StageId = "story"): string => `/h/${hostId}/film/${filmId}/episode/e1/${stage}`;

/** Words the screens translate from a value they compute (a section, a checkpoint of the pipeline, a state): listed here so the locale tables carry them. */
export const FILM_WORDS = {
  sections: ["Characters", "Locations", "Props", "Add character", "Add location", "Add prop", "Reference sheet 16:9 — face close-up left, front / side / back views right", "Plate 16:9, no people", "Sheet 1:1"],
  forms: ["Edit", "Save", "Add", "Edit line", "Add line", "Saved", "Saving…", "Not saved", "Images missing", "Outdated", "Ready", "Narrator", "This film is no longer on the host", "Unable to load the film"],
  timeline: ["Main", "Dialogue", "Captions", "Music", "Reference pictures", "Panel images", "Voice lines", "Create the script from the story first", "No panel has an image yet"],
  checkpoints: [
    "Check the cast and the script", "Read the characters, places and panels the story was turned into. Edit them, then approve to make the reference pictures.",
    "Check the reference pictures", "Every panel is drawn from these pictures. Regenerate or edit any of them, then approve to draw the storyboard.",
    "Check the storyboard", "Reorder, retime or redraw panels, then approve to record the voice lines.", "Check the voice lines", "Listen to the takes, then approve to assemble the timeline.",
  ],
};
