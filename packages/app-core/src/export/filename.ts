/**
 * The one file-name rule of exported files (`export-share.Filename sanitisation`): it removes only what a file system
 * forbids and keeps every letter, digit and mark of every script.
 */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const encoder = new TextEncoder();
const isMark = (char: string) => /\p{M}/u.test(char);

/** The sanitised base name (no extension) of an output file. */
export function sanitiseFileName(name: string): string {
  let text = name.normalize("NFC").replace(FORBIDDEN, "_").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
  // At most 120 code points and 200 UTF-8 bytes, cut between characters: a combining mark stays with its base.
  const points = [...text];
  let bytes = 0, kept = 0;
  for (; kept < Math.min(points.length, 120); kept++) {
    const size = encoder.encode(points[kept]).length;
    if (bytes + size > 200) break;
    bytes += size;
  }
  if (kept < points.length) {
    while (kept > 0 && isMark(points[kept])) kept--;
    text = points.slice(0, kept).join("").replace(/[ .]+$/g, "");
  }
  if (RESERVED.test(text)) text = `_${text}`;
  return text === "" ? "Untitled" : text;
}
/** `name.ext`, made unique among `taken` by appending ` (2)`, ` (3)`, … */
export function uniqueFileName(base: string, extension: string, taken: (fileName: string) => boolean): string {
  const first = `${base}.${extension}`;
  if (!taken(first)) return first;
  for (let index = 2; ; index++) { const candidate = `${base} (${index}).${extension}`; if (!taken(candidate)) return candidate; }
}
type Rate = { numerator: number; denominator: number };
/** `HH-MM-SS-FF` of a playhead time, the frame number last. */
export function timecodeForFile(ticks: number, rate: Rate): string {
  const frame = Math.floor((Math.max(0, ticks) * rate.numerator) / (120_000 * rate.denominator)), perSecond = Math.max(1, Math.round(rate.numerator / rate.denominator));
  const seconds = Math.floor(frame / perSecond), pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}-${pad(Math.floor(seconds / 60) % 60)}-${pad(seconds % 60)}-${pad(frame % perSecond)}`;
}
/** `<project>-<HH-MM-SS-FF>.<ext>`: the one naming rule of stills and of the preview's snapshot. */
export const stillFileName = (project: string, ticks: number, rate: Rate, format: "png" | "jpeg"): string => `${sanitiseFileName(project)}-${timecodeForFile(ticks, rate)}.${format === "png" ? "png" : "jpg"}`;
/** `<name>_<NNNNNN>.<ext>`: six digits, zero-padded, counted from 1. */
export const sequenceFrameName = (name: string, index: number, format: "png" | "jpeg"): string => `${sanitiseFileName(name)}_${String(index + 1).padStart(6, "0")}.${format === "png" ? "png" : "jpg"}`;
export const sequenceZipName = (name: string): string => `${sanitiseFileName(name)}_frames.zip`;
const baseOf = (fileName: string) => fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "");
/** `<videoFileName>.<language>.<ext>` beside the video; the language is always present, `und` when unknown. */
export const sidecarFileName = (videoFileName: string, language: string | undefined, format: string): string => `${baseOf(videoFileName)}.${language && language.trim() ? language.trim() : "und"}.${format}`;
export const creditsFileName = (outputFileName: string): string => `${baseOf(outputFileName)}.credits.txt`;
export const coverFileName = (outputFileName: string): string => `${baseOf(outputFileName)}_cover.jpg`;
