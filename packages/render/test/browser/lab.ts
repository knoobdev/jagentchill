// Shared by the library pixel tests: one engine in the page, and frames rendered from documents handed to it.
// A frame goes through the real `buildFrame`, texture sync and wasm compositor of that engine; only the transport is
// bypassed, so that hundreds of frames do not each open an engine.
import type { Harness } from "./harness.ts";

export type Frame = { width: number; height: number; data: Uint8Array; diagnostics: string[] };
export const W = 640, H = 360;

/** Installs `window.lab` and opens its engine with the three test pictures. */
export async function installLab(harness: Harness, forceBackend?: "webgl2"): Promise<void> {
  await harness.page.evaluate(async ({ W, H, origin, forceBackend }) => {
    const { jc } = window;
    // T: grey with a white, a red and a blue block and a black disc. A: red with a white square top-left.
    // B: blue with a white square bottom-right. M: the person matte, a white ellipse on black.
    const t = await jc.imageUrl(W, H, (c) => { c.fillStyle = "#808080"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.fillRect(40, 40, 120, 80); c.fillStyle = "#ff0000"; c.fillRect(400, 40, 120, 80); c.fillStyle = "#0000ff"; c.fillRect(40, 220, 120, 100); c.fillStyle = "#000000"; c.beginPath(); c.arc(460, 250, 60, 0, 7); c.fill(); });
    const a = await jc.imageUrl(W, H, (c) => { c.fillStyle = "#c02020"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.fillRect(40, 40, 80, 80); });
    const b = await jc.imageUrl(W, H, (c) => { c.fillStyle = "#2040c0"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.fillRect(520, 240, 80, 80); });
    const m = await jc.imageUrl(W / 2, H / 2, (c) => { c.fillStyle = "#000000"; c.fillRect(0, 0, W / 2, H / 2); c.fillStyle = "#ffffff"; c.beginPath(); c.ellipse(160, 100, 60, 75, 0, 0, 7); c.fill(); });
    // L: the 33-point colour lattice, entry n = r + 33 g + 1089 b at pixel (n mod 640, floor(n / 640)).
    const l = await jc.imageUrl(W, H, (c) => { const image = c.createImageData(W, H); for (let n = 0; n < W * H; n++) { const k = n < 35937 ? n : 0; image.data.set([Math.round(((k % 33) * 255) / 32), Math.round(((Math.floor(k / 33) % 33) * 255) / 32), Math.round((Math.floor(k / 1089) * 255) / 32), 255], n * 4); } c.putImageData(image, 0, 0); });
    // A table baked from the recipe "highlights 30°, 0.2", delivered as a user LUT.
    const wheel = URL.createObjectURL(new Blob([jc.cubeText(jc.bakeRecipe(jc.parseRecipe("W{highlights: 30°, 0.2, 0}")))], { type: "text/plain" }));
    const sources = [{ assetId: "t", original: t }, { assetId: "a", original: a }, { assetId: "b", original: b }, { assetId: "l", original: l }];
    const project = (background: unknown = { kind: "color", color: "#000000" }) => { const doc = jc.project({ width: W, height: H }, background); for (const id of ["t", "a", "b", "l"]) doc.media.assets.push(jc.asset(id, "image", { width: W, height: H })); return doc; };
    const image = (id: string, mediaId: string, fields: Record<string, unknown> = {}) => jc.element("image", { id, startTime: 0, duration: 120000, mediaId, ...fields });
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }];
    const opened = await jc.open(project(), { width: W, height: H, forceBackend }, sources, async (port) => {
      await port.command("fonts.setSources", { fonts });
      await port.command("derived.setSources", { entries: [{ key: "person-matte:t", kind: "person-matte", url: m, sha256: "a".repeat(64) }, { key: "user:" + "c".repeat(64), kind: "lut", url: wheel, sha256: "b".repeat(64) }] });
    });
    const engine = opened.engine as any;
    // The matte and the fonts load behind the first use; they are in place before any frame is asked for.
    engine.personMatte("t");
    await engine.whenMattesSettled();
    engine.lutSize("user:" + "c".repeat(64));
    await engine.whenLutsSettled();
    for (const weight of [400, 700]) for (const source of engine.fonts.chain("Arial", weight, "normal").pending) await engine.fonts.ensure(source);
    const encode = (pixels: Uint8Array) => { let binary = ""; for (let index = 0; index < pixels.length; index += 0x8000) binary += String.fromCharCode(...pixels.subarray(index, index + 0x8000)); return btoa(binary); };
    const size = { width: W, height: H };
    // The engine renders frames of its own (after a font or a matte arrives); a lab frame takes its turn in the same
    // queue, so that nothing else is drawn between its render and its read-back.
    const turn = <T>(work: () => Promise<T>): Promise<T> => { const run = engine.renderChain.then(work); engine.renderChain = run.catch(() => undefined); return run; };
    const draw = async (descriptor: any, size = { width: W, height: H }) => {
      const report = engine.compositor.render(descriptor);
      await engine.compositor.drawn();
      // Read through the compositor: `engine.readPixels` waits for the render queue this frame is part of.
      return { pixels: encode(await engine.compositor.readPixels(0, 0, size.width, size.height)), diagnostics: report.diagnostics.map((entry: any) => `${entry.id}:${entry.subject}`), size };
    };
    const build = async (doc: any, time: number, renderSize = size) => {
      const built = jc.buildFrame({ document: doc, sceneId: "s1", time, render: renderSize, quality: "preview", text: engine.textServices, lutSize: engine.lutSize, personMatte: engine.personMatte });
      const missing = await engine.compositor.sync(built.textures, (texture: any) => engine.resolveTexture(texture, { size: renderSize, quality: "preview", time, sceneId: "s1" }));
      if (missing.size > 0) throw new Error(`textures missing: ${[...missing].join(", ")}`);
      return built;
    };
    const lab = {
      project, image, build, draw, turn,
      /** A frame of a document at a time. */
      frame: (doc: any, time = 0) => turn(async () => draw((await build(doc, time)).descriptor)),
      /** T with one effect entry, as a standalone effect element over the canvas (or as a clip effect). */
      effect: (type: string, params: Record<string, unknown>, options: { clip?: boolean; time?: number; kind?: string; transform?: unknown; duration?: number } = {}) => {
        const doc = project();
        const entry = { id: "fx", type, kind: options.kind ?? "effect", enabled: true, params };
        const duration = options.duration ?? 120000;
        if (options.clip) doc.scenes[0].tracks.main.elements.push(image("m", "t", { duration, effects: [entry], ...(options.transform ? { transform: options.transform } : {}) }));
        else { doc.scenes[0].tracks.main.elements.push(image("m", "t", { duration })); doc.scenes[0].tracks.overlay = [jc.track("effect", "fx", [jc.element("effect", { id: "f", startTime: 0, duration, effects: [entry] })])]; }
        return lab.frame(doc, options.time ?? 40000);
      },
      /** A → B on the main track, 30 frames, linear, with a transition of `type`; the frame at eased progress `p`. */
      transition: (type: string, params: Record<string, unknown>, p: number) => turn(async () => {
        const doc = project();
        doc.scenes[0].tracks.main.elements.push(image("A", "a", { transitionOut: "x" }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", transitionIn: "x" }));
        doc.scenes[0].tracks.main.transitions = [{ id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type, params, easing: "linear", audioCrossfade: true }];
        // The descriptor of the window's middle frame, re-timed to the progress asked for (0 and 1 included).
        const built = await build(doc, 120000);
        const item = built.descriptor.items.find((entry: any) => entry.type === "transition");
        const shader = jc.transitionShader(type, params, p, { seconds: p, frame: Math.round(15 + 30 * p), scale: W / 1920 });
        Object.assign(item!, { progress: p, uniforms: shader.uniforms, postPasses: shader.postPasses });
        return draw(built.descriptor);
      }),
      transitionAtSize: (type: string, params: Record<string, unknown>, p: number, width: number, height: number) => turn(async () => {
        const renderSize = { width, height }, doc = project();
        doc.settings.canvasSize = renderSize;
        doc.scenes[0].tracks.main.elements.push(image("A", "a", { transitionOut: "x" }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", transitionIn: "x" }));
        doc.scenes[0].tracks.main.transitions = [{ id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type, params, easing: "linear", audioCrossfade: true }];
        const built = await build(doc, 120000, renderSize), item = built.descriptor.items.find((entry: any) => entry.type === "transition");
        const shader = jc.transitionShader(type, params, p, { seconds: p, frame: Math.round(15 + 30 * p), scale: Math.min(width, height) / 1920 });
        Object.assign(item!, { progress: p, uniforms: shader.uniforms, postPasses: shader.postPasses });
        return draw(built.descriptor, renderSize);
      }),
    };
    (window as any).lab = lab;
  }, { W, H, origin: harness.origin, forceBackend });
}

const decode = (out: { pixels: string; diagnostics: string[]; size?: { width: number; height: number } }): Frame => ({ width: out.size?.width ?? W, height: out.size?.height ?? H, data: new Uint8Array(Buffer.from(out.pixels, "base64")), diagnostics: out.diagnostics });
/** Runs a function of `window.lab` in the page and returns the frame it rendered. */
export async function shot(harness: Harness, code: string, args?: unknown): Promise<Frame> {
  return decode(await harness.page.evaluate(async ({ code, args }) => new (Object.getPrototypeOf(async () => 0).constructor)("lab", "jc", "args", code)((window as any).lab, window.jc, args), { code, args }));
}
export const effectShot = (harness: Harness, type: string, params: Record<string, unknown> = {}, options: Record<string, unknown> = {}): Promise<Frame> => shot(harness, "return lab.effect(args.type, args.params, args.options);", { type, params, options });
export const transitionShot = (harness: Harness, type: string, params: Record<string, unknown>, p: number): Promise<Frame> => shot(harness, "return lab.transition(args.type, args.params, args.p);", { type, params, p });
export const transitionShotAtSize = (harness: Harness, type: string, params: Record<string, unknown>, p: number, width: number, height: number): Promise<Frame> => shot(harness, "return lab.transitionAtSize(args.type, args.params, args.p, args.width, args.height);", { type, params, p, width, height });

// ---- reading frames -------------------------------------------------------------------------------------------------
export type Rgb = [number, number, number];
export const px = (frame: Frame, x: number, y: number): Rgb => { const at = (Math.round(y) * frame.width + Math.round(x)) * 4; return [frame.data[at], frame.data[at + 1], frame.data[at + 2]]; };
export const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const near = (a: Rgb, b: Rgb, tolerance = 4): boolean => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
/** Mean colour of a rectangle. */
export function mean(frame: Frame, x0: number, y0: number, x1: number, y1: number): Rgb {
  const sum = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = px(frame, x, y); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; }
  const count = (x1 - x0) * (y1 - y0);
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}
/** Fraction of pixels for which `test` holds. */
export function share(frame: Frame, test: (c: Rgb, x: number, y: number) => boolean, x0 = 0, y0 = 0, x1 = frame.width, y1 = frame.height): number {
  let hits = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (test(px(frame, x, y), x, y)) hits++;
  return hits / ((x1 - x0) * (y1 - y0));
}
/** Fraction of pixels that differ between two frames by more than `tolerance` on a channel. */
export const changed = (a: Frame, b: Frame, tolerance = 8): number => share(a, (c, x, y) => !near(c, px(b, x, y), tolerance));
/** Largest channel difference between two frames. */
export function worst(a: Frame, b: Frame): number {
  let out = 0;
  for (let index = 0; index < a.data.length; index++) out = Math.max(out, Math.abs(a.data[index] - b.data[index]));
  return out;
}
export const GREY: Rgb = [128, 128, 128], WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0], RED_A: Rgb = [192, 32, 32], BLUE_B: Rgb = [32, 64, 192];
export const mix = (a: Rgb, b: Rgb, weight: number): Rgb => [a[0] + (b[0] - a[0]) * weight, a[1] + (b[1] - a[1]) * weight, a[2] + (b[2] - a[2]) * weight];
