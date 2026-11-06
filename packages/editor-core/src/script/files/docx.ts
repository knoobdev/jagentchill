import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import Encoding from "encoding-japanese";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import type { ScriptDocument } from "@jagentchill/protocol";
import { hasSceneHeading, parseFountain, type ParsedScript } from "../fountain.ts";
import { assertCharacters, previewOf, type ExportOptions, type ImportResult } from "../io.ts";
import { ScriptError, type ScriptIds } from "../model.ts";
import { screenplayBlocks, type Block, type BlockKind } from "../screenplay.ts";

/**
 * Word files and text decoding (`script-studio.Import`, `Export`): pure JavaScript libraries only, so the same code
 * runs in a browser, in the desktop app and in Hermes.
 */
/** UTF-8, UTF-16 by byte-order mark, or Shift_JIS through the bundled table; anything else is refused. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const little = bytes[0] === 0xff;
    let out = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) out += String.fromCharCode(little ? bytes[index] | (bytes[index + 1] << 8) : (bytes[index] << 8) | bytes[index + 1]);
    return out;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* not UTF-8: Shift_JIS is the one other encoding read */ }
  if (Encoding.detect(bytes, "SJIS")) return Encoding.convert(bytes, { to: "UNICODE", from: "SJIS", type: "string" }) as unknown as string;
  throw new ScriptError("SCRIPT_IMPORT_UNSUPPORTED", "This file's text encoding is not supported", {});
}
export const encodeShiftJis = (text: string): Uint8Array => Uint8Array.from(Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }) as number[]);

const STYLES: Record<string, { name: string; indent?: number; right?: boolean; bold?: boolean; italics?: boolean; caps?: boolean; before?: number }> = {
  SceneHeading: { name: "Scene Heading", bold: true, caps: true, before: 360 }, Action: { name: "Action", before: 240 }, Character: { name: "Character", indent: 3168, caps: true, before: 240 },
  Parenthetical: { name: "Parenthetical", indent: 2304 }, Dialogue: { name: "Dialogue", indent: 1440 }, Transition: { name: "Transition", right: true, caps: true, before: 240 },
  Shot: { name: "Shot", bold: true, before: 240 }, Note: { name: "Note", italics: true, before: 240 },
};
const STYLE_OF: Record<BlockKind, keyof typeof STYLES> = { act: "SceneHeading", scene: "SceneHeading", beat: "Note", action: "Action", cue: "Character", parenthetical: "Parenthetical", dialogue: "Dialogue", transition: "Transition", shot: "Shot", note: "Note", onscreen: "Action", header: "Note" };
/** The first strong character decides the direction: a right-to-left paragraph is marked bidirectional. */
const isRtl = (text: string): boolean => { for (const char of text) { if (/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char)) return true; if (/\p{L}/u.test(char)) return false; } return false; };
/** `*italic*`, `**bold**` and `_underline_` become runs. */
function runs(text: string): TextRun[] {
  const out: TextRun[] = [];
  let bold = false, italics = false, underline = false;
  for (const part of text.split(/(\*\*|\*|_(?=\S)|(?<=\S)_|\n)/)) {
    if (part === "**") bold = !bold; else if (part === "*") italics = !italics; else if (part === "_") underline = !underline;
    else if (part === "\n") out.push(new TextRun({ break: 1 }));
    else if (part) out.push(new TextRun({ text: part, bold, italics, ...(underline ? { underline: {} } : {}) }));
  }
  return out;
}
// An act is a heading of the document outline; everything else carries one of the eight screenplay styles.
const paragraph = (block: Block): Paragraph => new Paragraph({ ...(block.kind === "act" ? { heading: HeadingLevel.HEADING_1 } : { style: STYLE_OF[block.kind] }), children: runs(block.text), ...(isRtl(block.text) ? { bidirectional: true } : {}) });

/** `.docx` with the paragraph styles Scene Heading, Action, Character, Parenthetical, Dialogue, Transition, Shot and Note. */
export async function exportDocx(document: ScriptDocument, options: ExportOptions = {}): Promise<Uint8Array> {
  const blocks = screenplayBlocks(document, { ...options, shots: options.shots ?? true, notes: options.notes ?? true });
  const children: (Paragraph | Table)[] = [new Paragraph({ heading: "Title", alignment: AlignmentType.CENTER, children: [new TextRun({ text: document.title, bold: true })] })];
  if (!options.twoColumn) children.push(...blocks.map(paragraph));
  else {
    // The audio/visual layout: per scene, a table with shots and visual notes on the left and narration, dialogue and sound notes on the right.
    const cell = (items: Block[]) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: items.length ? items.map(paragraph) : [new Paragraph("")] });
    let left: Block[] = [], right: Block[] = [], open = false;
    const flush = () => { if (open && (left.length || right.length)) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [cell(left), cell(right)] })] })); left = []; right = []; };
    for (const block of blocks) {
      if (block.kind === "scene" || block.kind === "act" || block.kind === "header") { flush(); children.push(paragraph(block)); open = true; continue; }
      open = true;
      const audio = block.kind === "cue" || block.kind === "parenthetical" || block.kind === "dialogue" || (block.kind === "note" && block.text.startsWith("[SOUND:"));
      (audio ? right : left).push(block);
    }
    flush();
  }
  const file = new Document({
    creator: document.meta.author || "JAgentChill", title: document.title,
    styles: {
      default: { document: { run: { font: "Courier New", size: 24 } } },
      paragraphStyles: Object.entries(STYLES).map(([id, style]) => ({
        id, name: style.name, basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { ...(style.bold ? { bold: true } : {}), ...(style.italics ? { italics: true } : {}), ...(style.caps ? { allCaps: true } : {}) },
        paragraph: { spacing: { before: style.before ?? 0 }, ...(style.indent ? { indent: { left: style.indent } } : {}), ...(style.right ? { alignment: AlignmentType.RIGHT } : {}) },
      })),
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}

type Node = Record<string, unknown>;
const tag = (node: Node): string => Object.keys(node).find((key) => key !== ":@") ?? "";
const kids = (node: Node): Node[] => { const value = node[tag(node)]; return Array.isArray(value) ? (value as Node[]) : []; };
const attr = (node: Node | undefined, name: string): string | undefined => (node?.[":@"] as Record<string, string> | undefined)?.[`@_${name}`];
const child = (node: Node | undefined, name: string): Node | undefined => (node ? kids(node).find((entry) => tag(entry) === name) : undefined);
type Para = { text: string; style: string; align: string; level: number | null };
const on = (node: Node | undefined): boolean => !!node && attr(node, "w:val") !== "0" && attr(node, "w:val") !== "false" && attr(node, "w:val") !== "none";
/**
 * Text only: paragraph text, heading levels, bold / italic / underline and alignment as hints. Images, table
 * formatting, comments and tracked changes (deleted runs) are ignored.
 */
export function readDocxParagraphs(bytes: Uint8Array): Para[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" || file.name === "word/styles.xml" }); } catch { throw new ScriptError("SCRIPT_IMPORT_INVALID", "This file cannot be read", {}); }
  if (!files["word/document.xml"]) throw new ScriptError("SCRIPT_IMPORT_INVALID", "This file is not a Word document", {});
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, processEntities: true });
  const names = new Map<string, string>();
  if (files["word/styles.xml"]) {
    const walk = (nodes: Node[]) => { for (const node of nodes) { if (tag(node) === "w:style") { const id = attr(node, "w:styleId"), name = attr(child(node, "w:name"), "w:val"); if (id && name) names.set(id, name); } else walk(kids(node)); } };
    walk(parser.parse(strFromU8(files["word/styles.xml"])) as Node[]);
  }
  const out: Para[] = [];
  const read = (node: Node) => {
    const properties = child(node, "w:pPr"), styleId = attr(child(properties, "w:pStyle"), "w:val") ?? "", name = names.get(styleId) ?? styleId;
    let text = "";
    const collect = (nodes: Node[]) => {
      for (const entry of nodes) {
        const name = tag(entry);
        if (name === "w:del" || name === "w:pPr") continue;
        if (name === "w:r") {
          const run = child(entry, "w:rPr");
          let piece = "";
          for (const part of kids(entry)) { const kind = tag(part); if (kind === "w:t") piece += kids(part).map((leaf) => String((leaf as { "#text"?: unknown })["#text"] ?? "")).join(""); else if (kind === "w:br" || kind === "w:cr") piece += "\n"; else if (kind === "w:tab") piece += " "; }
          if (!piece) continue;
          const mark = `${on(child(run, "w:b")) ? "**" : ""}${on(child(run, "w:i")) ? "*" : ""}`, underline = on(child(run, "w:u"));
          text += piece.trim() && (mark || underline) ? `${underline ? "_" : ""}${mark}${piece}${mark.split("").reverse().join("")}${underline ? "_" : ""}` : piece;
        } else collect(kids(entry));
      }
    };
    collect(kids(node));
    const heading = /^heading (\d)$/i.exec(name) ?? /^Heading(\d)$/.exec(styleId);
    out.push({ text: text.replace(/\*\*\*\*|(?<!\*)\*\*(?!\*)(?=\*\*)/g, "").trim(), style: name.replace(/\s+/g, "").toLowerCase(), align: attr(child(properties, "w:jc"), "w:val") ?? "", level: heading ? Number(heading[1]) : null });
  };
  const walk = (nodes: Node[]) => { for (const node of nodes) { if (tag(node) === "w:p") read(node); else walk(kids(node)); } };
  walk(parser.parse(strFromU8(files["word/document.xml"])) as Node[]);
  return out;
}
const upper = (text: string): boolean => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
const strip = (text: string): string => text.replace(/\*\*|\*|_/g, "");
/** A Word file as a script: its paragraphs are rewritten as Fountain, which the one parser reads. */
export function importDocx(bytes: Uint8Array, fileName: string, options: { ids: ScriptIds; language: string }): ImportResult {
  if (/\.doc$/i.test(fileName) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) throw new ScriptError("SCRIPT_IMPORT_UNSUPPORTED", "Save the file as .docx and import again", { fileName });
  const paragraphs = readDocxParagraphs(bytes).filter((entry) => entry.text !== "");
  assertCharacters(paragraphs.map((entry) => entry.text).join("\n"));
  const levels = new Set(paragraphs.map((entry) => entry.level).filter((level): level is number => level !== null)), actLevel = levels.size > 1 || (levels.size === 1 && paragraphs.some((entry) => entry.style === "sceneheading")) ? Math.min(...levels) : null;
  const out: string[] = [];
  let title: string | undefined;
  for (let index = 0; index < paragraphs.length; index++) {
    const { text, style, align, level } = paragraphs[index], plain = strip(text);
    const speech = () => { const body: string[] = []; for (; index + 1 < paragraphs.length; index++) { const next = paragraphs[index + 1]; if (next.style === "parenthetical" || next.style === "dialogue") body.push(next.style === "parenthetical" && !/^\(.*\)$/.test(next.text) ? `(${next.text})` : next.text); else if (body.length === 0 || /^\(.*\)$/.test(body[body.length - 1])) { if (next.level !== null || next.style !== "" && next.style !== "normal" && next.style !== "action") break; body.push(next.text); } else break; } return body; };
    if (style === "title" && title === undefined) { title = plain.slice(0, 120); continue; }
    if (level !== null && level === actLevel) out.push(`# ${plain}`);
    else if (level !== null || style === "sceneheading") out.push(hasSceneHeading(plain) ? plain : plain.toUpperCase() === "OMITTED" || /^\d+\.\s*OMITTED$/i.test(plain) ? ".OMITTED" : `.${plain.replace(/^\d+\.\s+/, "")}`);
    else if (style === "character" || (align === "center" && upper(plain) && paragraphs[index + 1])) { const body = speech(); out.push(body.length ? [`@${plain}`, ...body].join("\n") : plain); }
    else if (style === "transition" || (align === "right" && upper(plain) && /TO:$/.test(plain))) out.push(`> ${plain}`);
    else if (style === "shot") { const shot = /^SHOT\s+([\d.]+)\s+—\s+([^,]+),\s*([^,]+),\s*([^,]+),\s*([\d.]+)\s*s(?:\s+—\s+([\s\S]*))?$/.exec(plain); out.push(shot ? `[[SHOT ${shot[1]}: ${shot[2]}, ${shot[3]}, ${shot[4]}, ${shot[5]}s${shot[6] ? ` — ${shot[6]}` : ""}]]` : `[[${plain}]]`); }
    else if (style === "note") out.push(`[[${plain.replace(/^\[|\]$/g, "")}]]`);
    else out.push(upper(text.split("\n")[0]) && text.includes("\n") ? `!${text}` : text);
  }
  const content: ParsedScript = parseFountain(out.join("\n\n"), options);
  content.title = title ?? fileName.replace(/\.docx$/i, "").slice(0, 120) ?? content.title;
  return { content, preview: previewOf(content), needsSplit: false, format: "docx" };
}
