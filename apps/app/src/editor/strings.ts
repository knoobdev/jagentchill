/**
 * The wording the timeline engine gives the editor — menu items, tool states, refusals, undo labels and default
 * names. The engine speaks English; the screens translate these when they show them, so each one is listed here
 * for the locale resources.
 */
const ENGINE_STRINGS = {
  menu: ["Split", "Cut", "Copy", "Paste", "Duplicate", "Mute", "Unmute", "Extract audio", "Recover audio", "Link", "Unlink", "Hide", "Show", "Deactivate", "Activate", "Group", "Ungroup", "Undo compound", "Create compound clip",
    "Create multi-camera clip", "Switch angle", "Flatten multi-camera clip", "To overlay", "To main track", "Freeze frame", "Reverse", "Crop", "Rotate 90°", "Mirror", "Replace media", "Collapse keyframes", "Expand keyframes", "Reveal media",
    "Open source", "Unlink source", "Rename", "Delete clip", "Delete text", "Ripple delete"],
  track: ["Add track", "Rename track", "Mute track", "Unmute track", "Solo track", "Unsolo track", "Hide track", "Show track", "Lock track", "Unlock track", "Move track up", "Move track down", "Select all on track", "Delete track",
    "Video track", "Text track", "Audio track", "Graphic track", "Effect track", "Adjustment track", "Caption track", "Main Track"],
  state: ["Select a clip first", "Select a visual clip", "Select a video clip and move the playhead onto it", "Select a video or audio clip", "Select a video clip", "Select a clip or move the playhead onto one", "Select a clip that can be masked",
    "Main track magnet — on", "Main track magnet — off", "Main track magnet — on. Turn off and on to close the gaps on this track", "Unlock the main track to close its gaps", "Off while Free layer is on", "The track is locked",
    "The main track is locked", "Track limit reached (99)", "Scene limit reached (200)", "A marker already exists at this time", "Marker limit reached (1000)", "Select adjacent main-track clips", "The project changed meanwhile",
    "This project is open read-only", "A compound clip cannot contain itself", "Compound clips can be nested up to 8 levels"],
  step: ["Move", "Trim", "Add to timeline", "Close gaps", "Add text", "Transform", "Position", "Scale", "Rotation", "Opacity", "Blend mode", "Volume", "Marker", "Move marker", "Edit marker", "Delete marker", "Paste", "Group", "Rename track",
    "Lock track", "New scene", "Rename scene", "Duplicate scene", "Delete scenes", "Reorder scenes", "Reorder tracks", "Set range to selection", "Clear range", "Record voiceover", "Add keyframe", "Remove keyframe", "Reset transform", "Nudge", "Speed"],
  field: ["Left", "Top", "Right", "Bottom", "Free", "Original", "Auto", "Full", "Title safe", "Action safe", "Vertical feed — side buttons", "Vertical feed — tall caption area", "Vertical feed — wide side buttons", "Vertical feed — compact",
    "Normal", "Darken", "Multiply", "Color burn", "Lighten", "Screen", "Plus lighter", "Color dodge", "Overlay", "Soft light", "Hard light", "Difference", "Exclusion", "Hue", "Saturation", "Luminosity", "Undo {label}", "Redo {label}",
    "Remove marker", "Remove keyframe: {name}", "Add keyframe: {name}", "Delete {n} elements", "Solo", "Unsolo", "Horizontal", "Vertical", "Choose picture…", "Choose another picture…", "Track volume", "Track pan"],
  // The refusals and empty states of the engine's effect, transition and timeline message tables, and its default scene name.
  message: ["This clip already has 16 effects. Remove one to add another.", "Select a video or image clip to use body effects", "Body effects need the on-device person model, which is not available on this device",
    "Unavailable effect", "Favourites limit reached (500)", "Star an effect to keep it here", "Effects you apply appear here", "No effects",
    "This project is a template draft. Choose 'Edit in full editor' to change its structure.", "Select 2 to 8 video clips", "Recover audio into the clips first", "A multi-camera source holds only its angles",
    "Turn on 'Audio follows video' to flatten", "No scene changes detected", "Place two clips next to each other to add a transition", "Audio was extracted. Add a crossfade on the audio track.",
    "Replaced by the transition's audio crossfade", "Unavailable transition", "Main scene"],
};
/** The sentences the engine words with a count: listed as calls, so that the locale resources hold them. */
export const countedStrings = (t: (text: string) => string): string[] => [t("{n} keyframes not pasted"), t("1 keyframe not pasted")];
/** Every engine-worded string the editor shows. */
export const engineStrings = (): string[] => Object.values(ENGINE_STRINGS).flat();
