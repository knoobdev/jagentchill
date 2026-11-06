import { script as s } from "@jagentchill/editor-core";
import type { T } from "../locale";
import { exporting, formatAmount } from "@jagentchill/app-core";

/**
 * The English text of everything the script model names — statuses, kinds, shot values, formats, refusals — keyed by
 * the model's value. The screens translate them by that text, so every label here is a key of the locale resources.
 */
const STATUS_LABELS = { draft: "Draft", in_review: "In review", changes_requested: "Changes requested", approved: "Approved", locked: "Locked" };
const KIND_LABELS = { action: "Action", dialogue: "Dialogue", narration: "Narration", on_screen_text: "On-screen text", visual_note: "Visual note", sound_note: "Sound note", transition: "Transition" };
const SETTING_LABELS = { NONE: "No setting", INT: "INT.", EXT: "EXT.", INT_EXT: "INT./EXT." };
const SIZE_LABELS = { "extreme-wide": "Extreme wide", wide: "Wide", medium: "Medium", "close-up": "Close-up", "extreme-close-up": "Extreme close-up", insert: "Insert" };
const ANGLE_LABELS = { "eye-level": "Eye level", high: "High", low: "Low", overhead: "Overhead", dutch: "Dutch", "over-the-shoulder": "Over the shoulder", pov: "Point of view" };
const MOVEMENT_LABELS = { static: "Static", pan: "Pan", tilt: "Tilt", "push-in": "Push in", "pull-out": "Pull out", track: "Track", handheld: "Handheld", orbit: "Orbit" };
const SOURCE_LABELS = { auto: "Automatic", "generate-video": "Generated video", "generate-image": "Generated image", stock: "Stock", library: "Library", "title-card": "Title card" };
const GENRE_LABELS = { drama: "Drama", comedy: "Comedy", action: "Action", thriller: "Thriller", horror: "Horror", romance: "Romance", "science-fiction": "Science fiction", fantasy: "Fantasy", documentary: "Documentary", educational: "Educational", commercial: "Commercial", lifestyle: "Lifestyle", news: "News", music: "Music", other: "Other" };
const PACE_LABELS = { slow: "Slow", normal: "Normal", fast: "Fast" };
const FORMAT_NAMES = { blank: "Blank", "short-form": "Short-form vertical video", explainer: "Explainer", advertisement: "Advertisement", vlog: "Vlog", "short-drama": "Short drama episode", tutorial: "Tutorial", "narrated-story": "Narrated story" };
const FORMAT_NOTES = { blank: "An empty script", "short-form": "9:16, 30 seconds, narration-led", explainer: "16:9, 90 seconds, problem to next step", advertisement: "16:9 or 9:16, 30 seconds, attention to call to action", vlog: "16:9, 5 minutes, talking points", "short-drama": "9:16, 2 minutes, full screenplay formatting", tutorial: "16:9, 3 minutes, result first", "narrated-story": "Any ratio, 60 seconds, narration with a shot per sentence" };
const ENTITY_LABELS = { characters: "Characters", locations: "Locations", props: "Props" };
const POLICY_LABELS = { human: "Human approval", auto: "Automatic approval" };
const AUDIT_LABELS = {
  "script.created": "Script created", "script.imported": "Imported from a file", "review.submitted": "Submitted for review", "review.resubmitted": "Resubmitted for review", "review.withdrawn": "Review withdrawn",
  "review.approved": "Approved", "review.auto_approved": "Approved automatically", "review.changes_requested": "Changes requested", "review.rejected": "Rejected and closed", "review.reopened": "Review of the approved version opened",
  "script.locked": "Locked", "script.unlocked": "Unlocked", "policy.changed": "Approval policy changed", "version.restored": "Version restored", "script.exported": "Exported", "timeline.created": "Timeline created",
};
const SUMMARY_LABELS = { created: "Created", submitted: "Submitted for review", approved: "Approved", approvedAuto: "Approved automatically", approvedEdits: "Approved with the reviewer's edits", saved: "Saved", savedUser: "Saved by the user", autosaved: "Autosaved", beforeImport: "Before import", exported: "Exported", timeline: "Timeline created" };
/** Refusals with a fixed sentence. Those that carry numbers are built in `messageOf`. */
const ERROR_MESSAGES = {
  locked: "Locked — unlock to edit", review: "This script is in review", approved: "Editing creates a new draft", restore: "Withdraw the review to restore a version", policy: "Withdraw the review to change the policy",
  empty: "Add some content before submitting for review", note: "Add a note or at least one comment", rejectNote: "Add a note to reject", noReview: "No review is open", notApproved: "This script has no approved version",
  shot: "Shot duration must be between 0.5 and 120 seconds", target: "Target duration must be between 5 seconds and 3 hours", doc: "Save the file as .docx and import again", type: "This file type cannot be imported",
  large: "This file is larger than 20 MiB", unreadable: "This file cannot be read", notScript: "This file is not a JAgentChill script", notWord: "This file is not a Word document", encoding: "This file's text encoding is not supported",
  csv: "This CSV file is not a shot list", named: "A script can have at most 100 named versions", storage: "Version storage is full", speaker: "Add a speaker", fact: "Check this fact", submitNow: "This script cannot be submitted now",
  noVersion: "This version does not exist", badVersion: "This version cannot be read", comment: "A comment has 1 to 2,000 characters", retention: "Older automatic versions were removed to save space",
};
const SCRIPT_NAMES = { Hangul: "Hangul", Chinese: "Chinese characters", Thai: "Thai", Arabic: "Arabic", Hebrew: "Hebrew", Devanagari: "Devanagari", Emoji: "Emoji", Other: "Other symbols" };
export const LABELS = { status: STATUS_LABELS, kind: KIND_LABELS, setting: SETTING_LABELS, size: SIZE_LABELS, angle: ANGLE_LABELS, movement: MOVEMENT_LABELS, source: SOURCE_LABELS, genre: GENRE_LABELS, pace: PACE_LABELS, formatName: FORMAT_NAMES, formatNote: FORMAT_NOTES, entity: ENTITY_LABELS, policy: POLICY_LABELS, audit: AUDIT_LABELS } as const;
void SUMMARY_LABELS; void ERROR_MESSAGES; void SCRIPT_NAMES;

export const optionsOf = <K extends string>(t: T, labels: Record<K, string>): { value: K; label: string }[] => (Object.keys(labels) as K[]).map((value) => ({ value, label: t(labels[value]) }));
export const formatName = (t: T, format: s.ScriptFormat): string => (format.personal ? format.name : t((FORMAT_NAMES as Record<string, string>)[format.id] ?? format.name));
/** The message of a refusal in the language of the app: built from the code and its details, never shown in English by accident. */
export function messageOf(t: T, error: unknown): string {
  if (!(error instanceof s.ScriptError)) return t("Something went wrong");
  const { details } = error, limit = typeof details.limit === "string" ? details.limit : "";
  if (error.code === "SCRIPT_LIMIT_EXCEEDED") {
    if (limit === "characters" && /^This file/.test(error.message)) return t("This file has {n} characters; the limit is {max}", { n: formatAmount(Number(details.value)), max: formatAmount(s.SCRIPT_LIMITS.characters) });
    if (limit === "scenes") return t("A script can have at most {n} scenes", { n: s.SCRIPT_LIMITS.scenes });
    if (limit === "acts") return t("A script can have at most {n} acts", { n: s.SCRIPT_LIMITS.acts });
    if (limit === "beatsPerScene") return t("A scene can have at most {n} beats", { n: s.SCRIPT_LIMITS.beatsPerScene });
    if (limit === "linesPerBeat") return t("A beat can have at most {n} lines", { n: s.SCRIPT_LIMITS.linesPerBeat });
    if (limit === "shotsPerScene") return t("A scene can have at most {n} shots", { n: s.SCRIPT_LIMITS.shotsPerScene });
    if (limit === "shots") return t("A script can have at most {n} shots", { n: formatAmount(s.SCRIPT_LIMITS.shots) });
    if (limit === "characters") return t("A script can have at most {n} characters of text", { n: formatAmount(s.SCRIPT_LIMITS.characters) });
    if (limit === "entities") return t("A script can have at most {n} characters, locations or props of each kind", { n: s.SCRIPT_LIMITS.entities });
    if (limit === "bytes") return t("A script can be at most 10 MiB");
  }
  if (error.code === "SCRIPT_EXPORT_UNSUPPORTED" && Array.isArray(details.scripts)) return t("PDF export does not support {scripts} — export Word (.docx), Fountain or plain text instead", { scripts: (details.scripts as string[]).map((name) => t(name)).join(", ") });
  if (error.code === "SCRIPT_CONSTRAINT_VIOLATION" && typeof details.blockers === "number") return details.blockers === 1 ? t("Fix 1 constraint violation or request human review") : t("Fix {n} constraint violations or request human review", { n: details.blockers });
  if (error.code === "SCRIPT_SCHEMA_INVALID" && /^[a-zA-Z.0-9]+: /.test(error.message)) return details.path === "title" ? t("A title has 1 to 120 characters") : /name$/.test(String(details.path)) ? t("That name is already used") : t("This change is not valid");
  return t(error.message);
}
/** `<title>-v<number>.<ext>`: the default name of an exported file, by the one file-name rule of exported files. */
export const exportName = (title: string, versionNumber: number | null, extension: string): string => `${exporting.sanitiseFileName(title)}${versionNumber ? `-v${versionNumber}` : ""}.${extension}`;

