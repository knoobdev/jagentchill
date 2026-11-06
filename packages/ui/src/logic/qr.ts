import qrcode from "qrcode-generator";

export const QR = { quietZone: 4, min: 160, default: 220, max: 320, minModulePx: 3 } as const;
export type QrSymbol = { modules: boolean[][]; count: number };

/** Module matrix of a payload at error-correction level M, or Q when a logo covers part of the symbol; null when it is too long for any symbol. Drawn locally. */
export function qrSymbol(payload: string, withLogo = false): QrSymbol | null {
  const code = qrcode(0, withLogo ? "Q" : "M");
  code.addData(payload, "Byte");
  // A payload beyond the largest symbol cannot be drawn at all.
  try { code.make(); } catch { return null; }
  const count = code.getModuleCount();
  return { count, modules: Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, column) => code.isDark(row, column))) };
}
/**
 * Geometry of the tile: the symbol plus a 4-module quiet zone on every side fills `size` px. A payload whose modules would
 * be smaller than 3 device pixels at the maximum size is refused.
 */
export function qrLayout(count: number, requested: number = QR.default, pixelRatio = 1): { size: number; module: number } | { error: "too-long" } {
  const cells = count + 2 * QR.quietZone;
  if ((QR.max * pixelRatio) / cells < QR.minModulePx) return { error: "too-long" };
  let size = Math.max(QR.min, Math.min(QR.max, requested));
  if ((size * pixelRatio) / cells < QR.minModulePx) size = Math.min(QR.max, Math.ceil((cells * QR.minModulePx) / pixelRatio));
  return { size, module: size / cells };
}
/** One SVG path of the dark modules, in module units, offset by the quiet zone. */
export function qrPath(symbol: QrSymbol): string {
  let path = "";
  symbol.modules.forEach((row, y) => {
    let run = -1;
    for (let x = 0; x <= row.length; x++) {
      if (row[x] && run < 0) run = x;
      if (!row[x] && run >= 0) { path += `M${run + QR.quietZone} ${y + QR.quietZone}h${x - run}v1h-${x - run}z`; run = -1; }
    }
  });
  return path;
}
