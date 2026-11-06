/** `captions-subtitles`: reading and writing subtitle files — SRT, WebVTT, ASS/SSA, TXT. Times are milliseconds. Pure functions. */

export type Cue = {
  start_ms: number; end_ms: number; text: string; speaker?: string;
  words?: { text: string; start_ms: number; end_ms: number }[];
  /** Per-caption overrides read from the file: emphasis, alignment, anchor, or a whole style. */
  style?: Record<string, unknown>; anchor?: "top" | "bottom";
};
export type ParsedSubtitles = { format: SubtitleFormat; cues: Cue[]; skipped: number; trimmed: number; warnings: string[]; trackStyle?: Record<string, unknown>; layout?: Record<string, unknown> };
export type SubtitleFormat = "srt" | "vtt" | "ass";
export class SubtitleError extends Error {}
export const SUBTITLE_MAX_BYTES = 10 * 1024 * 1024;
export const SUBTITLE_MESSAGES = { tooLarge: "Subtitle files can be up to 10 MB", notVtt: "Not a valid WebVTT file", unsupported: "Subtitle files can be SRT, VTT, ASS or SSA", empty: "No captions found in this file" };

/** The format a file name names, or `null` for an extension that is not a subtitle file. */
export function subtitleFormatOf(fileName: string): SubtitleFormat | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase();
  return extension === "srt" ? "srt" : extension === "vtt" ? "vtt" : extension === "ass" || extension === "ssa" ? "ass" : null;
}
/** Decodes subtitle bytes: by byte-order mark (UTF-8, UTF-16 LE/BE), otherwise UTF-8; `uncertain` when that yields replacement characters. */
export function decodeSubtitle(bytes: Uint8Array, encoding?: string): { text: string; uncertain: boolean } {
  if (bytes.length > SUBTITLE_MAX_BYTES) throw new SubtitleError(SUBTITLE_MESSAGES.tooLarge);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  const text = new TextDecoder(encoding ?? bom ?? "utf-8").decode(bytes).replace(/^﻿/, "");
  return { text, uncertain: !encoding && !bom && text.includes("�") };
}

const lines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");
/** `HH:MM:SS,mmm`, `HH:MM:SS.mmm` or `MM:SS.mmm` → milliseconds; `null` when malformed. */
export function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  if (Number(minutes) > 59 || Number(seconds) > 59) return null;
  return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, "0"));
}
const stripTags = (text: string): string => text.replace(/\{\\[^}]*\}/g, "").replace(/<\/?[^>]+>/g, "");
/** A cue that overlaps the next one ends where the next one starts. */
function trimOverlaps(cues: Cue[]): number {
  cues.sort((a, b) => a.start_ms - b.start_ms);
  let trimmed = 0;
  for (let index = 0; index + 1 < cues.length; index++) if (cues[index].end_ms > cues[index + 1].start_ms) { cues[index].end_ms = cues[index + 1].start_ms; trimmed++; }
  return trimmed;
}

export function parseSrt(text: string): ParsedSubtitles {
  const cues: Cue[] = [];
  let skipped = 0;
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/)) {
    const rows = block.split("\n").filter((row, index) => row.trim() !== "" || index > 0);
    const at = rows.findIndex((row) => row.includes("-->"));
    if (at < 0) continue;
    const [from, to] = rows[at].split("-->").map((part) => parseTimestamp(part.trim().split(/\s+/)[0] ?? ""));
    const raw = rows.slice(at + 1).join("\n").trim();
    if (from === null || to === null || to <= from) { skipped++; continue; }
    // A tag that wraps the whole cue becomes the caption's own emphasis; every other tag is dropped.
    const whole = /^<([ibu])>([\s\S]*)<\/\1>$/.exec(raw.replace(/\{\\[^}]*\}/g, "").trim());
    const style = whole && !/<\/?[ibu]>/.test(whole[2]) ? (whole[1] === "i" ? { fontStyle: "italic" } : whole[1] === "b" ? { fontWeight: 700 } : { underline: true }) : undefined;
    const content = stripTags(raw).replace(/[ \t]+/g, " ").trim();
    if (content === "") { skipped++; continue; }
    cues.push({ start_ms: from, end_ms: to, text: content, ...(style ? { style } : {}) });
  }
  return { format: "srt", cues, skipped, trimmed: trimOverlaps(cues), warnings: [] };
}

export function parseVtt(text: string): ParsedSubtitles {
  if (!/^WEBVTT(?:[ \t\n]|$)/.test(text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"))) throw new SubtitleError(SUBTITLE_MESSAGES.notVtt);
  const cues: Cue[] = [], ignored = new Set<string>();
  let skipped = 0;
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/).slice(1)) {
    const rows = block.split("\n");
    if (/^(NOTE|STYLE|REGION)\b/.test(rows[0] ?? "")) continue;
    const at = rows.findIndex((row) => row.includes("-->"));
    if (at < 0) continue;
    const [left, right = ""] = rows[at].split("-->");
    const [end, ...settings] = right.trim().split(/\s+/);
    const from = parseTimestamp(left), to = parseTimestamp(end ?? "");
    if (from === null || to === null || to <= from) { skipped++; continue; }
    const cue: Cue = { start_ms: from, end_ms: to, text: "" };
    for (const setting of settings) {
      const [key, value = ""] = setting.split(":");
      if (key === "line") { const percent = /^(-?[\d.]+)%/.exec(value); if (percent) cue.anchor = Number(percent[1]) < 50 ? "top" : "bottom"; }
      else if (key === "align") cue.style = { ...cue.style, textAlign: ["start", "left"].includes(value) ? "left" : ["end", "right"].includes(value) ? "right" : "center" };
      else if (["position", "size", "vertical", "region"].includes(key)) ignored.add(key);
    }
    const raw = rows.slice(at + 1).join("\n").trim();
    const voice = /<v(?:\.[^ >]*)? ([^>]+)>/.exec(raw);
    if (voice) cue.speaker = voice[1].trim().slice(0, 80);
    // Inline word timestamps split the cue into words: each lasts until the next stamp, the last until the cue ends.
    if (/<\d{1,3}:\d{2}(?::\d{2})?\.\d{3}>/.test(raw)) {
      const parts = raw.split(/<(\d{1,3}:\d{2}(?::\d{2})?\.\d{3})>/);
      const words: NonNullable<Cue["words"]> = [];
      let at_ms = from;
      for (let index = 0; index < parts.length; index += 2) {
        const word = stripTags(parts[index]).trim(), next = index + 1 < parts.length ? parseTimestamp(parts[index + 1]) ?? to : to;
        if (word) words.push({ text: word, start_ms: at_ms - from, end_ms: Math.max(at_ms, next) - from });
        at_ms = next;
      }
      cue.words = words;
    }
    cue.text = stripTags(raw).replace(/[ \t]+/g, " ").trim();
    if (cue.text === "") { skipped++; continue; }
    cues.push(cue);
  }
  return { format: "vtt", cues, skipped, trimmed: trimOverlaps(cues), warnings: [...ignored].sort().map((key) => `cue setting "${key}" ignored`) };
}

/** `&HAABBGGRR` (alpha inverted) → `#rrggbbaa`. */
export function assColour(value: string): string {
  const hex = value.replace(/^&H/i, "").replace(/&$/, "").padStart(8, "0").toLowerCase();
  const alpha = (255 - parseInt(hex.slice(0, 2), 16)).toString(16).padStart(2, "0");
  return `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}${alpha === "ff" ? "" : alpha}`;
}
const assTime = (value: string): number | null => { const match = /^(\d+):(\d{2}):(\d{2})[.:](\d{2})$/.exec(value.trim()); return match ? ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]) * 10 : null; };

export function parseAss(text: string): ParsedSubtitles {
  const warnings = new Set<string>(), styles = new Map<string, { style: Record<string, unknown>; layout: Record<string, unknown> }>();
  const events: { cue: Cue; styleName: string }[] = [];
  let section = "", format: string[] = [], playResY = 288, skipped = 0;
  for (const line of lines(text)) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) { section = header[1].toLowerCase(); format = []; continue; }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim(), value = line.slice(colon + 1).trim();
    if (section === "script info") { if (key === "PlayResY") playResY = Number(value) || 288; continue; }
    if (key === "Format") { format = value.split(",").map((part) => part.trim()); continue; }
    const fields = (count: number) => { const parts = value.split(","); return [...parts.slice(0, count - 1), parts.slice(count - 1).join(",")]; };
    if (section.includes("styles") && key === "Style") {
      const row = Object.fromEntries(fields(format.length).map((part, index) => [format[index], part.trim()]));
      const alignment = Number(row.Alignment ?? 2), column = (alignment - 1) % 3, band = Math.floor((alignment - 1) / 3), border = Number(row.BorderStyle ?? 1);
      const style: Record<string, unknown> = {
        fontFamily: row.Fontname || "Arial", fontSize: Math.min(500, Math.max(1, Math.round(((Number(row.Fontsize) || 20) / playResY) * 90 * 10) / 10)), color: assColour(row.PrimaryColour ?? "&H00FFFFFF"),
        fontWeight: Number(row.Bold) !== 0 ? 700 : 400, fontStyle: Number(row.Italic) !== 0 ? "italic" : "normal", underline: Number(row.Underline) !== 0, strikethrough: Number(row.StrikeOut) !== 0,
        letterSpacing: Number(row.Spacing) || 0, textAlign: ["left", "center", "right"][column],
        stroke: { enabled: border === 1 && Number(row.Outline) > 0, color: assColour(row.OutlineColour ?? "&H00000000"), width: Math.min(50, Math.round(((Number(row.Outline) || 0) / (Number(row.Fontsize) || 20)) * 100 * 2) / 2), position: "outside" },
        background: { enabled: border === 3, color: assColour(row.BackColour ?? "&H00000000") },
        shadow: { enabled: Number(row.Shadow) > 0, distance: Math.min(100, Math.round(((Number(row.Shadow) || 0) / (Number(row.Fontsize) || 20)) * 100)) },
      };
      for (const ignored of ["Angle", "ScaleX", "ScaleY", "Encoding"]) if (row[ignored] !== undefined && !["0", "100", "1", ""].includes(row[ignored])) warnings.add(`${ignored} ignored`);
      styles.set(row.Name, { style, layout: { anchor: ["bottom", "middle", "top"][band], marginY: Math.min(50, Math.round(((Number(row.MarginV) || 0) / playResY) * 100)) } });
      continue;
    }
    if (section === "events") {
      if (key !== "Dialogue") { if (key === "Comment") warnings.add("Comment events ignored"); continue; }
      const row = Object.fromEntries(fields(format.length).map((part, index) => [format[index], part]));
      const from = assTime(row.Start ?? ""), to = assTime(row.End ?? "");
      if (from === null || to === null || to <= from) { skipped++; continue; }
      let content = row.Text ?? "";
      if (/\{[^}]*\}/.test(content)) { warnings.add("override tags ignored"); content = content.replace(/\{[^}]*\}/g, ""); }
      content = content.replace(/\\N|\\n/g, "\n").replace(/\\h/g, " ").trim();
      if (content === "") { skipped++; continue; }
      if (row.Effect?.trim()) warnings.add("event Effect ignored");
      if (row.Layer?.trim() && row.Layer.trim() !== "0") warnings.add("event Layer ignored");
      events.push({ cue: { start_ms: from, end_ms: to, text: content, ...(row.Name?.trim() ? { speaker: row.Name.trim().slice(0, 80) } : {}) }, styleName: (row.Style ?? "").trim() });
    }
  }
  // The most frequent style of the Dialogue events is the track's; the others are per-caption overrides.
  const counts = new Map<string, number>();
  for (const event of events) if (styles.has(event.styleName)) counts.set(event.styleName, (counts.get(event.styleName) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const event of events) {
    const own = styles.get(event.styleName);
    if (!own) { warnings.add(`style "${event.styleName}" is missing`); continue; }
    if (event.styleName !== main) { event.cue.style = own.style; event.cue.anchor = own.layout.anchor === "top" ? "top" : "bottom"; }
  }
  const cues = events.map((event) => event.cue);
  return { format: "ass", cues, skipped, trimmed: trimOverlaps(cues), warnings: [...warnings].sort(), ...(main ? { trackStyle: styles.get(main)!.style, layout: styles.get(main)!.layout } : {}) };
}

/** Parses a subtitle file by its name. A file with no valid cue is an error: nothing is created. */
export function parseSubtitles(fileName: string, text: string): ParsedSubtitles {
  const format = subtitleFormatOf(fileName);
  if (!format) throw new SubtitleError(SUBTITLE_MESSAGES.unsupported);
  const parsed = format === "srt" ? parseSrt(text) : format === "vtt" ? parseVtt(text) : parseAss(text);
  if (parsed.cues.length === 0) throw new SubtitleError(SUBTITLE_MESSAGES.empty);
  return parsed;
}
/** "8 captions imported, 2 skipped", with the trimmed count when cues overlapped. */
export function importSummary(parsed: Pick<ParsedSubtitles, "cues" | "skipped" | "trimmed">): string {
  const parts = [`${parsed.cues.length} ${parsed.cues.length === 1 ? "caption" : "captions"} imported`];
  if (parsed.skipped > 0) parts.push(`${parsed.skipped} skipped`);
  if (parsed.trimmed > 0) parts.push(`${parsed.trimmed} trimmed`);
  return parts.join(", ");
}

// — Writing —
const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
export function formatTimestamp(ms: number, separator: "," | "." = "."): string {
  const total = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)}${separator}${pad(total % 1000, 3)}`;
}
export type ExportCue = { start_ms: number; end_ms: number; text: string; translation?: string; words?: { text: string; start_ms: number; end_ms: number }[] };
export type ExportOptions = { content?: "primary" | "translation" | "both"; timestamps?: boolean; wordTimings?: boolean; range?: { start_ms: number; end_ms: number } };
/** The cues a file holds: in time order, inside the range, the chosen content, empty ones left out. */
function cuesFor(cues: ExportCue[], options: ExportOptions): { start_ms: number; end_ms: number; text: string; words?: ExportCue["words"] }[] {
  const content = options.content ?? "primary";
  return [...cues].sort((a, b) => a.start_ms - b.start_ms).filter((cue) => !options.range || (cue.end_ms > options.range.start_ms && cue.start_ms < options.range.end_ms))
    .map((cue) => ({ start_ms: cue.start_ms, end_ms: cue.end_ms, words: content === "primary" ? cue.words : undefined, text: content === "primary" ? cue.text : content === "translation" ? cue.translation ?? "" : [cue.text, cue.translation ?? ""].filter((line) => line.trim() !== "").join("\n") }))
    .filter((cue) => cue.text.trim() !== "");
}
/** SRT: UTF-8, `\r\n` line endings, cues numbered from 1. */
export const writeSrt = (cues: ExportCue[], options: ExportOptions = {}): string =>
  cuesFor(cues, options).map((cue, index) => `${index + 1}\r\n${formatTimestamp(cue.start_ms, ",")} --> ${formatTimestamp(cue.end_ms, ",")}\r\n${cue.text.replace(/\n/g, "\r\n")}\r\n`).join("\r\n");
export function writeVtt(cues: ExportCue[], options: ExportOptions = {}): string {
  const body = cuesFor(cues, options).map((cue, index) => {
    const text = options.wordTimings && cue.words?.length ? cue.words.map((word, at) => (at === 0 ? word.text : `<${formatTimestamp(cue.start_ms + word.start_ms)}>${word.text}`)).join(" ") : cue.text;
    return `${index + 1}\n${formatTimestamp(cue.start_ms)} --> ${formatTimestamp(cue.end_ms)}\n${text}\n`;
  });
  return `WEBVTT\n\n${body.join("\n")}`;
}
/** TXT: one caption per line; with timestamps each line is prefixed with `[HH:MM:SS.mmm]`. */
export const writeTxt = (cues: ExportCue[], options: ExportOptions = {}): string =>
  cuesFor(cues, options).map((cue) => `${options.timestamps ? `[${formatTimestamp(cue.start_ms)}] ` : ""}${cue.text.replace(/\n/g, " ")}`).join("\n") + "\n";
const assStamp = (ms: number): string => { const total = Math.max(0, Math.round(ms / 10)); return `${Math.floor(total / 360_000)}:${pad(Math.floor(total / 6000) % 60)}:${pad(Math.floor(total / 100) % 60)}.${pad(total % 100)}`; };
/**
 * ASS (Advanced SubStation Alpha v4+): one `Default` style and one `Dialogue` event per caption, times to the
 * centisecond (the format's resolution), a line break written as `\N`. `parseAss` reads back what this writes.
 */
export function writeAss(cues: ExportCue[], options: ExportOptions = {}): string {
  const events = cuesFor(cues, options).map((cue) => `Dialogue: 0,${assStamp(cue.start_ms)},${assStamp(cue.end_ms)},Default,,0,0,0,,${cue.text.replace(/\r?\n/g, "\\N").replace(/[{}]/g, "")}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 384", "PlayResY: 288", "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,16,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events, "",
  ].join("\n");
}
/** `<projectName>.<language>.<ext>`: the language segment is always present, `und` when unknown; characters a file name cannot hold are replaced. */
export function captionFileName(projectName: string, language: string | undefined, extension: "srt" | "vtt" | "txt" | "ass"): string {
  const name = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim() || "Untitled";
  return `${name}.${language && language.trim() ? language.trim() : "und"}.${extension}`;
}
