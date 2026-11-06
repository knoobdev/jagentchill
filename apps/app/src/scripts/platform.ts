import type { script as s } from "@jagentchill/editor-core";

/** Native: the file dialog, the share sheet and the slate renderer are not wired on this platform. */
export function saveFile(_name: string, _data: Uint8Array | string, _mime: string): void {}
export const readFile = async (file: Blob): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());
export async function loadPdfFonts(_japanese: boolean): Promise<{ mono: Uint8Array; monoBold: Uint8Array; jp?: Uint8Array }> { throw new Error("PDF fonts are not available on this platform"); }
export const slatesSupported = false;
export type SlateColors = { background: string; primary: string; secondary: string; rule: string; family: string };
export async function renderSlate(_slate: Pick<s.SlatePlan, "number" | "heading" | "detail" | "description">, _size: { width: number; height: number }, _colors: SlateColors): Promise<Uint8Array> { throw new Error("slates are not available on this platform"); }
