import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { ScriptDocument } from "@jagentchill/protocol";
import type { ExportOptions } from "../io.ts";
import { ScriptError } from "../model.ts";
import { columnsOf, isWide, PAPER, paginate, SCREENPLAY, screenplayBlocks, type PaperSize, type Row } from "../screenplay.ts";

/**
 * PDF in screenplay layout (`script-studio.Export`, "PDF fonts"): subsets of exactly two bundled faces are embedded —
 * Noto Sans Mono (Regular and Bold) and Noto Sans JP (Regular), the latter set on a cell of two monospaced columns.
 * Text with a character neither face has is not written at all.
 */
export type PdfFonts = { mono: Uint8Array; monoBold: Uint8Array; /** Needed only when the text has full-width glyphs. */ jp?: Uint8Array };
const SCRIPT_NAMES: [RegExp, string][] = [
  [/\p{Script=Hangul}/u, "Hangul"], [/\p{Script=Han}/u, "Chinese characters"], [/\p{Script=Thai}/u, "Thai"], [/\p{Script=Arabic}/u, "Arabic"], [/\p{Script=Hebrew}/u, "Hebrew"],
  [/\p{Script=Devanagari}/u, "Devanagari"], [/\p{Script=Bengali}/u, "Bengali"], [/\p{Script=Tamil}/u, "Tamil"], [/\p{Script=Khmer}/u, "Khmer"], [/\p{Script=Lao}/u, "Lao"], [/\p{Script=Myanmar}/u, "Myanmar"],
  [/\p{Script=Armenian}/u, "Armenian"], [/\p{Script=Georgian}/u, "Georgian"], [/\p{Script=Ethiopic}/u, "Ethiopic"], [/\p{Extended_Pictographic}/u, "Emoji"],
];
export const scriptNameOf = (char: string): string => SCRIPT_NAMES.find(([pattern]) => pattern.test(char))?.[1] ?? "Other symbols";
export const pdfUnsupportedMessage = (scripts: readonly string[]): string => `PDF export does not support ${scripts.join(", ")} — export Word (.docx), Fountain or plain text instead`;
/** Whether the text needs the Japanese face at all. */
export const needsJapaneseFace = (text: string): boolean => Array.from(text).some(isWide);
const invisible = (char: string): boolean => /[\s​-‍﻿]/u.test(char);

export type PdfOptions = ExportOptions & { paper?: PaperSize; fonts: PdfFonts };
export type PdfResult = { bytes: Uint8Array; pages: number; breaks: string[] };
/** The text of every row a PDF of this script would hold, for the scan and for tests of pagination. */
export function pdfPages(document: ScriptDocument, options: Omit<PdfOptions, "fonts">): Row[][] {
  const paper = options.paper ?? "a4";
  return paginate(screenplayBlocks(document, { ...options, paper, shots: options.shots ?? true, notes: options.notes ?? false }), paper);
}
export async function exportPdf(source: ScriptDocument, options: PdfOptions): Promise<PdfResult> {
  const paper = options.paper ?? "a4", size = PAPER[paper];
  const document: ScriptDocument = JSON.parse(JSON.stringify(source).normalize("NFC"));
  const pages = pdfPages(document, options);
  const titleLines = options.titlePage ? [document.title, ...(document.meta.author ? ["", "Written by", "", document.meta.author] : [])] : [];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(document.title);
  pdf.setCreator("JAgentChill");
  const all = [...titleLines, ...pages.flatMap((page) => page.map((row) => row.text))].join("\n");
  const mono = await pdf.embedFont(options.fonts.mono, { subset: true }), bold = await pdf.embedFont(options.fonts.monoBold, { subset: true });
  // The CFF subsetter of the font library writes a Japanese subset that readers reject, so this face is embedded whole.
  const jp = options.fonts.jp && needsJapaneseFace(all) ? await pdf.embedFont(options.fonts.jp, { subset: false }) : null;
  const sets = { mono: new Set(mono.getCharacterSet()), bold: new Set(bold.getCharacterSet()), jp: jp ? new Set(jp.getCharacterSet()) : new Set<number>() };
  // The scan: one character without a glyph in the two faces and no PDF is produced.
  const missing = new Set<string>();
  for (const char of all) { if (invisible(char)) continue; const code = char.codePointAt(0)!; if (!(isWide(char) ? sets.jp.has(code) || (sets.mono.has(code) && sets.bold.has(code)) : (sets.mono.has(code) && sets.bold.has(code)) || sets.jp.has(code))) missing.add(scriptNameOf(char)); }
  if (missing.size > 0) { const scripts = [...missing].sort(); throw new ScriptError("SCRIPT_EXPORT_UNSUPPORTED", pdfUnsupportedMessage(scripts), { scripts }); }
  const draw = (page: PDFPage, text: string, column: number, baseline: number, face: PDFFont) => {
    let x = SCREENPLAY.marginLeft + column * SCREENPLAY.cell, run = "", runX = x;
    const flush = () => { if (run) page.drawText(run, { x: runX, y: baseline, size: SCREENPLAY.fontSize, font: face }); run = ""; };
    for (const char of text) {
      const code = char.codePointAt(0)!, wide = isWide(char);
      if (!wide && (sets.mono.has(code) || invisible(char))) { if (!run) runX = x; run += invisible(char) ? " " : char; x += SCREENPLAY.cell; continue; }
      flush();
      // A full-width glyph sits centred on its cell of two columns.
      if (jp) page.drawText(char, { x: x + (wide ? (SCREENPLAY.cell * 2 - jp.widthOfTextAtSize(char, SCREENPLAY.fontSize)) / 2 : 0), y: baseline, size: SCREENPLAY.fontSize, font: jp });
      x += SCREENPLAY.cell * (wide ? 2 : 1);
    }
    flush();
  };
  const top = size.height - SCREENPLAY.marginTop - SCREENPLAY.fontSize;
  if (titleLines.length) {
    const page = pdf.addPage([size.width, size.height]), columns = Math.floor((size.width - SCREENPLAY.marginLeft - SCREENPLAY.marginRight) / SCREENPLAY.cell);
    titleLines.forEach((line, index) => draw(page, index === 0 ? line.toUpperCase() : line, Math.max(0, Math.floor((columns - columnsOf(line)) / 2)), size.height * 0.62 - index * SCREENPLAY.lineHeight, index === 0 ? bold : mono));
  }
  pages.forEach((rows, index) => {
    const page = pdf.addPage([size.width, size.height]);
    // Page numbers top right, from page 2.
    if (index > 0) { const label = `${index + 1}.`; page.drawText(label, { x: size.width - SCREENPLAY.marginRight - label.length * SCREENPLAY.cell, y: size.height - 36 - SCREENPLAY.fontSize, size: SCREENPLAY.fontSize, font: mono }); }
    rows.forEach((row, line) => { if (row.text) draw(page, row.text, row.indent, top - line * SCREENPLAY.lineHeight, row.bold ? bold : mono); });
  });
  return { bytes: await pdf.save(), pages: pages.length + (titleLines.length ? 1 : 0), breaks: pages.map((rows) => rows.find((row) => row.text)?.text ?? "") };
}
