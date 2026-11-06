/** Caption files written at export (`export-share.Caption burn-in and sidecar options`): which tracks, which content, which name. */
import { sidecarFileName } from "./filename.ts";
import type { ExportSettings } from "./settings.ts";

export type SidecarCue = { start_ms: number; end_ms: number; text: string; translation?: string };
export type SidecarTrack = { id: string; language?: string; cues: SidecarCue[]; burnIn?: boolean; hidden?: boolean };
type Content = "primary" | "translation" | "both";
const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const stamp = (ms: number, separator: string, hundredths = false) => {
  const total = Math.max(0, Math.round(ms)), head = `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)}`;
  return hundredths ? `${String(Math.floor(total / 3_600_000))}:${head.slice(3)}.${pad(Math.floor((total % 1000) / 10))}` : `${head}${separator}${pad(total % 1000, 3)}`;
};
/** The cues of a file: inside the range, times relative to its start, the chosen content, empty ones left out. */
export function sidecarCues(cues: SidecarCue[], content: Content, range: { start_ms: number; end_ms: number }): { start_ms: number; end_ms: number; lines: string[] }[] {
  return [...cues].sort((a, b) => a.start_ms - b.start_ms).filter((cue) => cue.end_ms > range.start_ms && cue.start_ms < range.end_ms)
    .map((cue) => ({ start_ms: Math.max(0, cue.start_ms - range.start_ms), end_ms: Math.min(range.end_ms, cue.end_ms) - range.start_ms, lines: (content === "primary" ? [cue.text] : content === "translation" ? [cue.translation ?? ""] : [cue.text, cue.translation ?? ""]).filter((line) => line.trim() !== "") }))
    .filter((cue) => cue.lines.length > 0);
}
/** The text of a caption file in SRT, VTT, ASS or TXT. With "both", each cue has the primary line followed by the translation line. */
export function sidecarText(format: ExportSettings["sidecar"]["format"], cues: SidecarCue[], content: Content, range: { start_ms: number; end_ms: number }): string {
  const list = sidecarCues(cues, content, range);
  if (format === "srt") return list.map((cue, index) => `${index + 1}\r\n${stamp(cue.start_ms, ",")} --> ${stamp(cue.end_ms, ",")}\r\n${cue.lines.join("\r\n")}\r\n`).join("\r\n");
  if (format === "vtt") return `WEBVTT\n\n${list.map((cue, index) => `${index + 1}\n${stamp(cue.start_ms, ".")} --> ${stamp(cue.end_ms, ".")}\n${cue.lines.join("\n")}\n`).join("\n")}`;
  if (format === "txt") return `${list.map((cue) => cue.lines.join(" ")).join("\n")}\n`;
  const head = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BorderStyle, Outline, Alignment, MarginV\nStyle: Default,Arial,54,&H00FFFFFF,&H00000000,1,3,2,60\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n";
  return head + list.map((cue) => `Dialogue: 0,${stamp(cue.start_ms, ".", true)},${stamp(cue.end_ms, ".", true)},Default,${cue.lines.join("\\N")}`).join("\n") + "\n";
}
/** The tracks a sidecar export writes: the chosen ones, or by default every caption track that has captions, visible and hidden alike. */
export const sidecarTracks = (tracks: SidecarTrack[], chosen: string[] | null): SidecarTrack[] => tracks.filter((track) => track.cues.length > 0 && (chosen === null || chosen.includes(track.id)));
/** The caption files of an export: `<outputFileName>.<language>.<ext>` each, a second track of the same language numbered. */
export function sidecarFiles(tracks: SidecarTrack[], settings: Pick<ExportSettings, "sidecar">, outputFileName: string, range: { start_ms: number; end_ms: number }): { name: string; text: string }[] {
  const used = new Set<string>();
  return sidecarTracks(tracks, settings.sidecar.trackIds).map((track) => {
    let name = sidecarFileName(outputFileName, track.language, settings.sidecar.format);
    for (let index = 2; used.has(name); index++) name = sidecarFileName(outputFileName, `${track.language && track.language.trim() ? track.language.trim() : "und"}-${index}`, settings.sidecar.format);
    used.add(name);
    return { name, text: sidecarText(settings.sidecar.format, track.cues, settings.sidecar.content, range) };
  });
}
/** Under the master switch each visible track is burned by its own `burnIn`; with the switch off nothing is burned. */
export const burnedTracks = (tracks: SidecarTrack[], master: boolean): string[] => (master ? tracks.filter((track) => track.burnIn !== false && track.hidden !== true).map((track) => track.id) : []);
