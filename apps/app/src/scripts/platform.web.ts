import type { script as s } from "@jagentchill/editor-core";
import { saveBlob } from "../platform/media";

/** Web and desktop: files are saved through the browser's download and slates are drawn on a canvas. */
export function saveFile(name: string, data: Uint8Array | string, mime: string): void {
  saveBlob(name, new Blob([data as BlobPart], { type: mime }));
}
export const readFile = async (file: Blob): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());
const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url} is not available`);
  return new Uint8Array(await response.arrayBuffer());
};
/** The two bundled faces of the PDF export; the Japanese face is fetched only for text that needs it. */
export async function loadPdfFonts(japanese: boolean): Promise<{ mono: Uint8Array; monoBold: Uint8Array; jp?: Uint8Array }> {
  const [mono, monoBold, jp] = await Promise.all([fetchBytes("/fonts/NotoSansMono-Regular.ttf"), fetchBytes("/fonts/NotoSansMono-Bold.ttf"), japanese ? fetchBytes("/fonts/NotoSansJP-Regular.otf") : Promise.resolve(undefined)]);
  return { mono, monoBold, ...(jp ? { jp } : {}) };
}
export const slatesSupported = true;
export type SlateColors = { background: string; primary: string; secondary: string; rule: string; family: string };
function wrap(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width || !line) { line = next; continue; }
    lines.push(line); line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  else if (line && lines.length === maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{0,2}$/, "")}…`;
  return lines;
}
/**
 * A shot slate: shot number, scene heading, size / angle / movement and description on the inset background, at the
 * project's canvas size. Returned as PNG bytes.
 */
export async function renderSlate(slate: Pick<s.SlatePlan, "number" | "heading" | "detail" | "description">, size: { width: number; height: number }, colors: SlateColors): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d")!, unit = Math.min(size.width, size.height) / 1080, margin = 96 * unit, width = size.width - margin * 2;
  context.fillStyle = colors.background; context.fillRect(0, 0, size.width, size.height);
  context.textBaseline = "top";
  let y = Math.max(margin, size.height * 0.28);
  context.fillStyle = colors.secondary; context.font = `500 ${40 * unit}px ${colors.family}`;
  for (const line of wrap(context, slate.heading.toUpperCase(), width, 2)) { context.fillText(line, margin, y); y += 56 * unit; }
  y += 24 * unit;
  context.fillStyle = colors.primary; context.font = `600 ${168 * unit}px ${colors.family}`;
  context.fillText(slate.number, margin, y); y += 208 * unit;
  context.fillStyle = colors.rule; context.fillRect(margin, y, width, Math.max(2, 3 * unit)); y += 40 * unit;
  context.fillStyle = colors.secondary; context.font = `500 ${40 * unit}px ${colors.family}`;
  for (const line of wrap(context, slate.detail, width, 2)) { context.fillText(line, margin, y); y += 56 * unit; }
  y += 24 * unit;
  context.fillStyle = colors.primary; context.font = `400 ${48 * unit}px ${colors.family}`;
  for (const line of wrap(context, slate.description, width, 6)) { context.fillText(line, margin, y); y += 68 * unit; }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the slate could not be rendered");
  return new Uint8Array(await blob.arrayBuffer());
}
