import {
  SCRIPT_FILE_FORMAT, scriptFileSchema, SHOT_ANGLES, SHOT_DURATION_TICKS, SHOT_MOVEMENTS, SHOT_SIZES, SHOT_SOURCES,
  type ScriptDocument, type ScriptFile, type ScriptShot,
} from "@jagentchill/protocol";
import type { ScriptCommand } from "./commands.ts";
import { shotTicks, TICKS_PER_SECOND } from "./estimate.ts";
import { hasSceneHeading, parseFountain, parsePlainText, serializeFountain, type ParsedScript, type SplitMode } from "./fountain.ts";
import { assertLimits, clone, entityName, headingText, newEntity, newShot, sceneLines, ScriptError, SCRIPT_LIMITS, validateScript, type ScriptIds } from "./model.ts";
import { screenplayText, type ScreenplayOptions } from "./screenplay.ts";
import { documentAt, type ScriptHistoryStore } from "./versions.ts";

/** `script-studio.Import` and `Export`: the formats that need no library. Word and PDF are in `files/`. */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_EXTENSIONS = ["txt", "md", "fountain", "spmd", "docx", "jcscript", "csv"] as const;
export type ImportExtension = (typeof IMPORT_EXTENSIONS)[number];
export const extensionOf = (fileName: string): string => (/\.([A-Za-z0-9]+)$/.exec(fileName)?.[1] ?? "").toLowerCase();
const grouped = (value: number): string => value.toLocaleString("en-US");

/** The checks every imported file passes before it is parsed: type, size and character count. */
export function assertImportable(fileName: string, bytes: number): ImportExtension {
  const extension = extensionOf(fileName);
  if (extension === "doc") throw new ScriptError("SCRIPT_IMPORT_UNSUPPORTED", "Save the file as .docx and import again", { fileName });
  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(extension)) throw new ScriptError("SCRIPT_IMPORT_UNSUPPORTED", "This file type cannot be imported", { fileName, extension });
  if (bytes > IMPORT_MAX_BYTES) throw new ScriptError("SCRIPT_IMPORT_UNSUPPORTED", "This file is larger than 20 MiB", { fileName, bytes });
  return extension as ImportExtension;
}
export function assertCharacters(text: string): void {
  const count = Array.from(text).length;
  if (count > SCRIPT_LIMITS.characters) throw new ScriptError("SCRIPT_LIMIT_EXCEEDED", `This file has ${grouped(count)} characters; the limit is ${grouped(SCRIPT_LIMITS.characters)}`, { limit: "characters", value: count });
}

export type ImportPreview = { title: string; scenes: number; lines: number; characters: number; firstScenes: { heading: string; firstLine: string }[]; warnings: string[] };
export type ImportResult = { content: ParsedScript; preview: ImportPreview; /** The text has no scene heading: the importer offers the three ways to split it. */ needsSplit: boolean; format: "fountain" | "text" | "native" | "docx"; file?: ScriptFile };
export function previewOf(content: ParsedScript): ImportPreview {
  const lines = content.scenes.flatMap(sceneLines);
  return {
    title: content.title, scenes: content.scenes.length, lines: lines.length, characters: lines.reduce((sum, line) => sum + line.text.length, 0),
    firstScenes: content.scenes.slice(0, 3).map((scene) => ({ heading: headingText(content, scene) || scene.title, firstLine: sceneLines(scene)[0]?.text.slice(0, 120) ?? "" })), warnings: content.warnings,
  };
}
const titleFrom = (fileName: string): string => fileName.replace(/\.[A-Za-z0-9]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Untitled script";
/**
 * Text of a `.txt`, `.md`, `.fountain` or `.spmd` file. Fountain is tried first; text with no scene heading is prose,
 * which is split by the chosen mode ("Keep as one scene" until the user chooses).
 */
export function importText(text: string, fileName: string, options: { ids: ScriptIds; language: string; split?: SplitMode }): ImportResult {
  assertCharacters(text);
  const fountain = extensionOf(fileName) === "fountain" || extensionOf(fileName) === "spmd" || hasSceneHeading(text);
  const content = fountain ? parseFountain(text, options) : parsePlainText(text, options.split ?? "one", options);
  if (!/^Title:/im.test(text) && content.title === "Untitled script") content.title = titleFrom(fileName);
  check(content);
  return { content, preview: previewOf(content), needsSplit: !fountain, format: fountain ? "fountain" : "text" };
}
/** An import that exceeds a limit is rejected as a whole. */
function check(content: ParsedScript): void {
  assertLimits({ ...content, entities: content.entities } as unknown as ScriptDocument);
}

export type NativeOptions = { versions?: "head" | "all"; comments?: boolean; activity?: boolean };
/** The native file `.jcscript`: every id survives it. */
export function exportNative(document: ScriptDocument, history: ScriptHistoryStore | null, options: NativeOptions = {}): string {
  const file: ScriptFile = { format: SCRIPT_FILE_FORMAT, version: 1, script: clone(document), versions: options.versions ?? "head" };
  if (history && options.versions === "all") file.history = { versions: clone(history.versions), blobs: clone(history.blobs) };
  if (history && options.comments) file.comments = clone(history.comments);
  if (history && options.activity) file.audit = clone(history.audit);
  return `${JSON.stringify(file, null, 2)}\n`;
}
export function importNative(text: string): ImportResult {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ScriptError("SCRIPT_IMPORT_INVALID", "This file cannot be read", {}); }
  const parsed = scriptFileSchema.safeParse(value);
  if (!parsed.success) throw new ScriptError("SCRIPT_IMPORT_INVALID", "This file is not a JAgentChill script", { path: parsed.error.issues[0]?.path.join(".") });
  const result = validateScript(parsed.data.script);
  if (!result.ok) throw new ScriptError("SCRIPT_IMPORT_INVALID", "This file is not a JAgentChill script", { path: result.errors[0].path });
  const script = parsed.data.script;
  assertLimits(script);
  const content: ParsedScript = { title: script.title, meta: script.meta, acts: script.acts, scenes: script.scenes, entities: script.entities, ...(script.constraints ? { constraints: script.constraints } : {}), warnings: [] };
  return { content, preview: previewOf(content), needsSplit: false, format: "native", file: parsed.data };
}

// — CSV —
export const SHOT_CSV_COLUMNS = ["shot_id", "scene", "shot", "description", "size", "angle", "movement", "duration_s", "characters", "location", "props", "lines", "on_screen_text", "source", "transition", "notes"] as const;
const quote = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
/** RFC 4180 rows with CRLF. */
export const toCsv = (rows: readonly (readonly string[])[]): string => rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
/** UTF-8 with a byte-order mark, so that spreadsheet software reads Vietnamese and Japanese text intact. */
export const CSV_BOM = "﻿";
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (char === '"') { if (source[index + 1] === '"') { cell += '"'; index++; } else quoted = false; } else cell += char; continue; }
    if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[index + 1] === "\n") index++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => value !== ""));
}
/** The shot list as CSV: a header row and one row per shot, in script order. The `lines` column holds the ids of the covered lines. */
export function exportShotCsv(document: ScriptDocument, options: { sceneIds?: readonly string[] } = {}): string {
  const rows: string[][] = [[...SHOT_CSV_COLUMNS]];
  document.scenes.forEach((scene, sceneIndex) => {
    if (options.sceneIds && !options.sceneIds.includes(scene.id)) return;
    scene.shots.forEach((shot, index) => rows.push([
      shot.id, String(sceneIndex + 1), `${sceneIndex + 1}.${index + 1}`, shot.description, shot.size, shot.angle, shot.movement, String(Number((shotTicks(document, scene, shot) / TICKS_PER_SECOND).toFixed(1))),
      shot.characterIds.map((id) => entityName(document, "characters", id) ?? "").filter(Boolean).join("; "), entityName(document, "locations", shot.locationId) ?? "",
      shot.propIds.map((id) => entityName(document, "props", id) ?? "").filter(Boolean).join("; "), shot.lineIds.join(" "), shot.onScreenText, shot.source, shot.transitionOut, shot.notes,
    ]));
  });
  return CSV_BOM + toCsv(rows);
}
export type ShotCsvReport = { updated: number; added: number; skipped: number };
/**
 * A CSV shot list into an existing script: rows are matched to shots by `shot_id`, else added to the scene named by
 * `scene`. One undo step. Values outside a column's set keep the shot's current value.
 */
export function importShotCsv(text: string): ScriptCommand<ShotCsvReport> {
  const rows = parseCsv(text), header = rows[0]?.map((name) => name.trim().toLowerCase()) ?? [];
  if (!header.includes("shot_id") || !header.includes("scene")) throw new ScriptError("SCRIPT_IMPORT_INVALID", "This CSV file is not a shot list", { columns: header });
  const records = rows.slice(1).map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""])) as Record<string, string>);
  return {
    type: "script.shot.importCsv", label: "Import shot list",
    run(draft, env) {
      const report: ShotCsvReport = { updated: 0, added: 0, skipped: 0 };
      const named = (kind: "characters" | "locations" | "props", value: string): string[] => value.split(";").map((name) => name.trim()).filter(Boolean).map((name) => {
        let entity = draft.entities[kind].find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (!entity) { entity = newEntity(env.ids, name.slice(0, 60), (draft.entities[kind].length % 8) + 1); draft.entities[kind].push(entity); }
        return entity.id;
      });
      for (const record of records) {
        const scene = draft.scenes.find((entry) => entry.shots.some((shot) => shot.id === record.shot_id)) ?? draft.scenes[Number(record.scene) - 1];
        if (!scene) { report.skipped++; continue; }
        let shot = scene.shots.find((entry) => entry.id === record.shot_id);
        if (shot) report.updated++; else { shot = newShot(env.ids); scene.shots.push(shot); report.added++; }
        const set = <T extends string>(values: readonly T[], value: string | undefined, current: T): T => (values.includes((value ?? "").trim() as T) ? ((value ?? "").trim() as T) : current);
        const lineIds = new Set(sceneLines(scene).map((line) => line.id));
        const patch: Partial<ScriptShot> = {
          description: (record.description ?? shot.description).slice(0, 800), size: set(SHOT_SIZES, record.size, shot.size), angle: set(SHOT_ANGLES, record.angle, shot.angle), movement: set(SHOT_MOVEMENTS, record.movement, shot.movement),
          source: set(SHOT_SOURCES, record.source, shot.source), onScreenText: (record.on_screen_text ?? shot.onScreenText).slice(0, 120), notes: (record.notes ?? shot.notes).slice(0, 600),
          transitionOut: (record.transition ?? "").trim() || shot.transitionOut,
        };
        if (header.includes("characters")) patch.characterIds = named("characters", record.characters).slice(0, 6);
        if (header.includes("props")) patch.propIds = named("props", record.props).slice(0, 8);
        if (header.includes("lines") && record.lines.trim()) patch.lineIds = record.lines.split(/\s+/).filter((id) => lineIds.has(id)).slice(0, 40);
        Object.assign(shot, patch);
        if (header.includes("location")) { const [location] = named("locations", record.location); if (location) shot.locationId = location; else delete shot.locationId; }
        // A duration that differs from the estimate is an override; one that equals it leaves the shot on its estimate.
        const seconds = Number(record.duration_s);
        if (record.duration_s?.trim() && Number.isFinite(seconds)) {
          const ticks = Math.round(seconds * TICKS_PER_SECOND), { durationOverride_ticks: _override, ...bare } = shot;
          const estimate = Number((shotTicks(draft, scene, bare as ScriptShot) / TICKS_PER_SECOND).toFixed(1));
          if (seconds === estimate) delete shot.durationOverride_ticks;
          else if (ticks >= SHOT_DURATION_TICKS.min && ticks <= SHOT_DURATION_TICKS.max) shot.durationOverride_ticks = ticks;
        }
      }
      return report;
    },
  };
}

export type ExportFormat = "txt" | "fountain" | "docx" | "pdf" | "csv" | "jcscript";
export type ExportOptions = ScreenplayOptions & { version?: "head" | "approved" | string; twoColumn?: boolean; titlePage?: boolean } & NativeOptions;
/** The document a file is written from: the head, the approved version or a chosen one. */
export function exportSource(document: ScriptDocument, history: ScriptHistoryStore, version: ExportOptions["version"] = "head"): { document: ScriptDocument; versionId: string; number: number | null } {
  const versionId = version === "head" ? document.headVersionId : version === "approved" ? document.approvedVersionId : version;
  if (!versionId) throw new ScriptError("SCRIPT_NOT_APPROVED", "This script has no approved version", { scriptId: document.id });
  const entry = history.versions.find((item) => item.versionId === versionId);
  return { document: version === "head" ? document : documentAt(document, history, versionId), versionId, number: entry?.number ?? null };
}
/** `<title>-v<number>.<ext>` with characters no file system refuses. */
export function exportFileName(title: string, versionNumber: number | null, extension: string): string {
  const safe = title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100) || "script";
  return `${safe}${versionNumber ? `-v${versionNumber}` : ""}.${extension}`;
}
/** The text formats, produced on the device with no host. */
export function exportTextFormat(format: "txt" | "fountain" | "csv" | "jcscript", document: ScriptDocument, history: ScriptHistoryStore | null, options: ExportOptions = {}): string {
  if (format === "fountain") return serializeFountain(document, { titlePage: true, shots: options.shots ?? true, notes: options.notes ?? true, sceneNumbers: options.sceneNumbers, sceneIds: options.sceneIds, forExport: true });
  if (format === "csv") return exportShotCsv(document, options);
  if (format === "jcscript") return exportNative(document, history, options);
  return screenplayText(document, options);
}
