// Engine recovery in headless Chromium: a wasm panic and a lost GPU context (or device) while a scene is shown; the engine comes back with the same frame, scene, playhead and transport.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

// A panic discards the wasm instance of its page: each test has a page of its own.
const harnesses: Harness[] = [];
after(async () => { for (const harness of harnesses) await harness.close(); });
const page = async () => { const harness = await startHarness(); harnesses.push(harness); return harness; };

const scene = `async (jc, origin, view) => {
  const fonts = [{ fontId: "arimo-700", family: "Arimo", url: origin + "/fixtures/fonts/Arimo-Bold.ttf", weight: 700 }];
  const red = await jc.imageUrl(64, 64, (c) => { c.fillStyle = "#ff0000"; c.fillRect(0, 0, 64, 64); });
  const doc = jc.project({ width: 320, height: 180 }, { kind: "color", color: "#0000ff" });
  doc.media.assets.push(jc.asset("red", "image", { width: 64, height: 64 }));
  doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 480000, mediaId: "red", transform: { position: { x: -80, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }));
  doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 480000, content: "IIII", fontFamily: "Arial", fontWeight: 700, fontSize: 30, color: "#ffffff", transform: { position: { x: 80, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 } })])];
  const opened = await jc.open(doc, view, [{ assetId: "red", original: red }], (port) => port.command("fonts.setSources", { fonts }));
  await opened.engine.whenFontsSettled();
  return opened;
}`;
/** Red picture, white text and blue background of a frame: [picture, brightest of the text row, background]. */
const look = `(frame) => { let text = 0; for (let x = 180; x < 300; x++) text = Math.max(text, frame.at(x, 90)[1]); return [frame.at(80, 90), text, frame.at(160, 10)]; }`;

test("Wasm panic capture and recovery — Single panic recovers: engine.error engine/wasm-panic (not fatal) and a correct frame for the playhead within 2 000 ms, with the scene, the playhead and the fonts kept; Panic loop: the third panic within 60 s is fatal engine/wasm-panic-loop and editing commands still answer", async () => {
  const harness = await page();
  const result = await harness.page.evaluate(async ({ origin, scene, look }) => {
    const { jc } = window;
    const opened = await (0, eval)(`(${scene})`)(jc, origin, { width: 320, height: 180 }), read = (0, eval)(`(${look})`);
    const engine = opened.engine as any;
    const before = read(await opened.frameAt(120000));
    let target = 120000;
    const panic = async () => {
      target += 4000;
      const mark = opened.events.length, at = performance.now();
      // The next render call into the module panics.
      const real = engine.compositor.wasm, original = engine.compositor.render.bind(engine.compositor);
      engine.compositor.render = () => { engine.compositor.render = original; real.debugPanic(); };
      await opened.port.command("transport.seek", { time: target, mode: "exact" });
      const error = await opened.waitFor("engine.error", mark, 5000);
      const fatal = opened.events.slice(mark).filter((event: any) => event.type === "engine.error").map((event: any) => event.payload);
      const frame = error.fatal || fatal.some((entry: any) => entry.fatal) ? null : await opened.waitFor("frame.ready", mark, 5000).then(() => true, () => false);
      return { error, all: fatal, frame, ms: performance.now() - at };
    };
    const first = await panic();
    const size = engine.renderSize, pixels = await engine.readPixels(0, 0, size.width, size.height);
    const after = read({ at: (x: number, y: number) => Array.from(pixels.slice((y * size.width + x) * 4, (y * size.width + x) * 4 + 4)) });
    const state = { time: opened.events.filter((event: any) => event.type === "frame.ready").at(-1)?.payload.time, canvas: opened.host.querySelectorAll("canvas").length };
    // A later seek renders normally in the new instance, and audio maths (the stateless stretch) still works.
    const moved = read(await opened.frameAt(240000));
    const second = await panic();
    const third = await panic();
    const mark = opened.events.length;
    const patched = await opened.port.command("scene.patch", { baseRevision: 1, revision: 2, patches: [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e1/opacity", value: 0.5 }] }).then(() => "ok", (error: any) => error.code);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { before, first, after, state, moved, second: { error: second.error, frame: second.frame }, third: third.all, patched, framesAfterStop: opened.events.slice(mark).filter((event: any) => event.type === "frame.ready").length };
  }, { origin: harness.origin, scene, look });
  assert.deepEqual([result.first.error.code, result.first.error.fatal], ["engine/wasm-panic", false]);
  assert.match(result.first.error.message, /debug panic requested/, "the panic message and location are recorded");
  assert.ok(result.first.frame && result.first.ms < 2000, `recovered in ${result.first.ms} ms`);
  assert.ok(near(result.before[0] as number[], [255, 0, 0, 255]) && (result.before[1] as number) > 200 && near(result.before[2] as number[], [0, 0, 255, 255]), JSON.stringify(result.before));
  assert.deepEqual(result.after, result.before, "the same frame: picture, text (its font loaded again) and background");
  assert.deepEqual([result.state.time, result.state.canvas], [124000, 1]);
  assert.deepEqual(result.moved, result.before);
  assert.deepEqual([result.second.error.code, result.second.frame], ["engine/wasm-panic", true]);
  assert.deepEqual(result.third.map((entry: any) => [entry.code, entry.fatal]), [["engine/wasm-panic", false], ["engine/wasm-panic-loop", true]]);
  assert.equal(result.patched, "ok", "the scene still accepts edits");
  assert.equal(result.framesAfterStop, 0, "the stopped engine renders nothing more");
});

test("GPU device-lost recovery — Context loss and restore: engine.error engine/device-lost (not fatal), the same frame again within 2 000 ms on the same backend, and no texture cache hit refers to a destroyed texture; a second loss recovers as well", async () => {
  for (const forceBackend of [undefined, "webgl2"] as const) {
    const harness = await page();
    const result = await harness.page.evaluate(async ({ origin, scene, look, forceBackend }) => {
      const { jc } = window;
      const opened = await (0, eval)(`(${scene})`)(jc, origin, { width: 320, height: 180, forceBackend }), read = (0, eval)(`(${look})`);
      const engine = opened.engine as any;
      const backend = opened.ready().backend as string;
      const before = read(await opened.frameAt(120000));
      const lose = async () => {
        const mark = opened.events.length, at = performance.now();
        if (backend === "webgl2") engine.compositor.canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext();
        else engine.compositor.debugLoseDevice();
        const error = await opened.waitFor("engine.error", mark, 5000);
        await opened.waitFor("frame.ready", mark, 5000);
        const ms = performance.now() - at;
        const size = engine.renderSize, pixels = await engine.readPixels(0, 0, size.width, size.height);
        return { error, ms, after: read({ at: (x: number, y: number) => Array.from(pixels.slice((y * size.width + x) * 4, (y * size.width + x) * 4 + 4)) }), uploaded: engine.counters.textureUpload, hits: engine.counters.textureCacheHit, changed: opened.events.slice(mark).filter((event: any) => event.type === "engine.backendChanged").length };
      };
      const first = await lose(), second = await lose();
      const moved = read(await opened.frameAt(240000));
      return { backend, before, first, second, moved, canvases: opened.host.querySelectorAll("canvas").length, now: (engine.compositor.info.backend as string) };
    }, { origin: harness.origin, scene, look, forceBackend });
    if (forceBackend) assert.equal(result.backend, "webgl2");
    for (const [name, loss] of [["first", result.first], ["second", result.second]] as const) {
      assert.deepEqual([loss.error.code, loss.error.fatal], ["engine/device-lost", false], `${result.backend} ${name}`);
      assert.ok(loss.ms < 2000, `${result.backend} ${name}: recovered in ${loss.ms} ms`);
      assert.deepEqual(loss.after, result.before, `${result.backend} ${name}: the same frame`);
      // The new compositor starts with no texture: the three of the frame are uploaded, none is taken from a cache.
      assert.ok(loss.uploaded >= 3 && loss.hits === 0, `${result.backend} ${name}: every texture of the frame was uploaded again (${loss.uploaded} uploads, ${loss.hits} cache hits)`);
      assert.equal(loss.changed, 0, "the same backend");
    }
    console.log(`device lost on ${result.backend}: recovered in ${Math.round(result.first.ms)} ms and ${Math.round(result.second.ms)} ms`);
    assert.deepEqual([result.now, result.canvases], [result.backend, 1]);
    assert.deepEqual(result.moved, result.before);
  }
});
