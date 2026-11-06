/** Provenance of exported files, the visible AI label, the export summary and the credits file (`export-share`). Pure rules and byte builders. */
export const IPTC_TRAINED = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
export const IPTC_COMPOSITE = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
export const PRODUCT_NAME = "JAgentChill";
export type DigitalSourceType = typeof IPTC_TRAINED | typeof IPTC_COMPOSITE | null;

type El = { id: string; type: string; startTime: number; duration: number; mediaId?: string; filmLink?: unknown; workflowLink?: unknown };
type Asset = { id: string; provenance?: { source?: string } | null };
const VISUAL = ["video", "image", "text", "sticker", "graphic", "compound", "caption"];
/** An element is AI-generated when its asset carries generation provenance or it links to a generated film or workflow asset. */
export const isGeneratedElement = (element: El, assets: Map<string, Asset>): boolean =>
  element.filmLink != null || element.workflowLink != null || (element.mediaId !== undefined && assets.get(element.mediaId)?.provenance?.source === "ai");
/**
 * `digitalSourceType` over the elements inside the export range: the trained-algorithmic term when every visual element
 * is generated, the composite term when some are (or only audio is), and nothing when none is.
 */
export function digitalSourceType(elements: El[], assets: Asset[], range: { start: number; end: number }): DigitalSourceType {
  const byId = new Map(assets.map((asset) => [asset.id, asset])), inside = elements.filter((element) => element.startTime < range.end && element.startTime + element.duration > range.start);
  const visual = inside.filter((element) => VISUAL.includes(element.type)), generated = inside.filter((element) => isGeneratedElement(element, byId));
  if (generated.length === 0) return null;
  const generatedVisual = visual.filter((element) => isGeneratedElement(element, byId));
  return visual.length > 0 && generatedVisual.length === visual.length ? IPTC_TRAINED : IPTC_COMPOSITE;
}
/** The computed value in words, as the Provenance section shows it. */
export const provenanceLabel = (value: DigitalSourceType): string => (value === IPTC_TRAINED ? "AI-generated" : value === IPTC_COMPOSITE ? "Contains AI-generated media" : "No AI-generated media");
export const AI_LABEL_DISABLED = "This export contains no AI-generated media";
export const creatorTool = (version: string): string => `${PRODUCT_NAME} ${version}`;

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The XMP packet of MP4, MOV, PNG, JPEG and GIF outputs: `xmp:CreatorTool` always, `Iptc4xmpExt:DigitalSourceType` when media is generated. */
export function xmpPacket(source: DigitalSourceType, version: string): string {
  const type = source ? ` Iptc4xmpExt:DigitalSourceType="${xmlEscape(source)}"` : "";
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
    + `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmp:CreatorTool="${xmlEscape(creatorTool(version))}"${type}/>`
    + `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}
/** The two values as Matroska tags (WebM) and as the comment of MP3, M4A, FLAC and WAV. */
export const provenanceTags = (source: DigitalSourceType, version: string): Record<string, string> => ({ ENCODER: creatorTool(version), ...(source ? { DIGITAL_SOURCE_TYPE: source } : {}) });
export const provenanceComment = (source: DigitalSourceType, version: string): string => (source ? `CreatorTool=${creatorTool(version)}; DigitalSourceType=${source}` : `CreatorTool=${creatorTool(version)}`);

/**
 * The visible AI label of a frame: text height and margin of 2.5 % of the short edge, in the bottom-right corner, white
 * with a black outline of one twelfth of the text height, at 60 % opacity.
 */
export function aiLabelGeometry(size: { width: number; height: number }): { textHeight: number; margin: number; outline: number; opacity: number; right: number; bottom: number } {
  const short = Math.min(size.width, size.height), textHeight = short * 0.025, margin = short * 0.025;
  return { textHeight, margin, outline: textHeight / 12, opacity: 0.6, right: size.width - margin, bottom: size.height - margin };
}
export const AI_LABEL_TEXT = "AI-generated";

// ---- export summary ---------------------------------------------------------------------------------------------------

export type ExportSummary = {
  fontsReplaced?: string[]; mediaMissing?: string[]; stickersMissing?: number; templateResourcesMissing?: string[]; transitionsHeld?: string[]; hdrConverted?: number;
  slatesExported?: number; codecFallback?: string; softwareEncoding?: boolean; aiLabel?: boolean;
};
export type SummaryLine = { text: string; values?: Record<string, string | number> };
const counted = (n: number, one: string, many: string, values: Record<string, string | number> = {}): SummaryLine => ({ text: n === 1 ? one : many, values: { n, ...values } });
/** Everything that differs from a clean render, one line each; "No issues" when nothing does. */
export function summaryLines(summary: ExportSummary | undefined): SummaryLine[] {
  const lines: SummaryLine[] = [], s = summary ?? {};
  if (s.fontsReplaced?.length) lines.push(counted(s.fontsReplaced.length, "1 font replaced: {names}", "{n} fonts replaced: {names}", { names: s.fontsReplaced.join(", ") }));
  if (s.mediaMissing?.length) lines.push(counted(s.mediaMissing.length, "1 clip rendered empty (media missing): {names}", "{n} clips rendered empty (media missing): {names}", { names: s.mediaMissing.join(", ") }));
  if (s.stickersMissing) lines.push(counted(s.stickersMissing, "1 sticker missing", "{n} stickers missing"));
  if (s.templateResourcesMissing?.length) lines.push(counted(s.templateResourcesMissing.length, "1 template resource missing: {names}", "{n} template resources missing: {names}", { names: s.templateResourcesMissing.join(", ") }));
  if (s.transitionsHeld?.length) lines.push(counted(s.transitionsHeld.length, "1 transition held a frame: {names}", "{n} transitions held a frame: {names}", { names: s.transitionsHeld.join(", ") }));
  if (s.hdrConverted) lines.push(counted(s.hdrConverted, "1 HDR source converted to SDR", "{n} HDR sources converted to SDR"));
  if (s.slatesExported) lines.push(counted(s.slatesExported, "1 placeholder shot exported", "{n} placeholder shots exported"));
  if (s.codecFallback) lines.push({ text: "Format changed: {change}", values: { change: s.codecFallback } });
  if (s.softwareEncoding) lines.push({ text: "Switched from hardware to software encoding" });
  if (s.aiLabel) lines.push({ text: "Visible AI label added" });
  return lines.length > 0 ? lines : [{ text: "No issues" }];
}
/** "SDR Rec.709", or with HDR sources "SDR Rec.709 — 2 HDR sources are converted to SDR". */
export const colourRow = (hdrSources: number): SummaryLine =>
  (hdrSources > 0 ? counted(hdrSources, "SDR Rec.709 — 1 HDR source is converted to SDR", "SDR Rec.709 — {n} HDR sources are converted to SDR") : { text: "SDR Rec.709" });

// ---- credits ----------------------------------------------------------------------------------------------------------

export type CreditAsset = { id: string; name: string; provenance?: { source?: string; author?: string; licence?: string; licenceUrl?: string; sourceUrl?: string } | null };
/** Licences that ask for attribution: everything except public-domain dedications and the user's own recordings. */
export const needsAttribution = (asset: CreditAsset): boolean => {
  const licence = asset.provenance?.licence?.trim() ?? "";
  return licence !== "" && !/^(cc0|public domain|pdm)/i.test(licence);
};
/** One line per attributed asset: title, author, licence name and source URL. `null` when no asset needs attribution. */
export function creditsFile(assets: CreditAsset[]): string | null {
  const lines = assets.filter(needsAttribution).map((asset) => [asset.name, asset.provenance?.author ?? "Unknown author", asset.provenance?.licence ?? "", asset.provenance?.sourceUrl ?? asset.provenance?.licenceUrl ?? ""].join(" — "));
  return lines.length > 0 ? `${lines.join("\n")}\n` : null;
}
