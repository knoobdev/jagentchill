/** What the canvas needs from a pointer-and-keyboard platform; touch platforms pan and zoom by gestures instead. */
export type WheelInfo = { dx: number; dy: number; zoom: boolean; x: number; y: number };
export function bindWheel(_node: unknown, _handler: (info: WheelInfo) => void): () => void { return () => {}; }
/** Text pasted with the platform's paste command while no field has the focus. */
export function onPasteText(_handler: (text: string) => void): () => void { return () => {}; }
export async function readFileText(_file: unknown): Promise<string> { return ""; }
/** Whether a view is on screen: a screen kept in the navigation history is not. */
export const isShown = (_node: unknown): boolean => true;
/** The pointer hovering over a view, in the view's own coordinates; null when it leaves. Touch platforms have no hover. */
export function bindHover(_node: unknown, _handler: (point: { x: number; y: number } | null) => void): () => void { return () => {}; }
/** Whether this platform can turn a drawing into a PNG. */
export const canRasterise = false;
export async function svgToPng(_svg: string, _width: number, _height: number, _scale = 2): Promise<Blob | null> { return null; }
