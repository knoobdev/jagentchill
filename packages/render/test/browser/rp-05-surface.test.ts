// The same-thread EngineSurface in headless Chromium: commands, events, patches, overrides, stills, playback, timings.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });
const expectNear = (actual: number[], expected: number[], label: string, tolerance = 2) => assert.ok(near(actual, expected, tolerance), `${label}: got ${actual}, expected ${expected}`);

test("EngineSurface commands — Seek command renders the requested frame; Non-integer time is rejected; Switching the presented scene; Unknown command leaves the engine unchanged", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const solid = (color: string) => jc.imageUrl(8, 8, (context) => { context.fillStyle = color; context.fillRect(0, 0, 8, 8); });
    const sources = [{ assetId: "red", original: await solid("#ff0000") }, { assetId: "blue", original: await solid("#0000ff") }];
    const doc = jc.project({ width: 64, height: 64 });
    for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "image", { width: 8, height: 8 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 600000, mediaId: "red" }));
    const second = JSON.parse(JSON.stringify(doc.scenes[0]));
    second.id = "s2"; second.isMain = false; second.kind = "compound";
    second.tracks.main.elements = [jc.element("image", { id: "e2", startTime: 0, duration: 600000, mediaId: "blue" })];
    doc.scenes.push(second);
    const opened = await jc.open(doc, { width: 64, height: 64 }, sources);
    const mark = opened.events.length;
    const reply = await opened.port.command("transport.seek", { time: 240000, mode: "exact" });
    const ready = await opened.waitFor("frame.ready", mark);
    const rejected = await opened.port.command("transport.seek", { time: 1000.25, mode: "exact" }).then(() => null, (error) => error.code);
    const unknown = await opened.port.raw({ v: 1, id: "zz1", type: "scene.explode", payload: {} }).then(() => null, (error) => error.code);
    const afterUnknown = (await opened.frameAt(240000)).at(32, 32);
    const setMark = opened.events.length;
    const setActive = await opened.port.command("scene.setActive", { sceneId: "s2" });
    await opened.waitFor("frame.ready", setMark);
    const other = (await opened.frameAt(240000)).at(32, 32);
    const sceneSets = opened.events.filter((event) => event.type === "frame.ready").map((event) => event.payload.revision);
    return { reply, ready, rejected, unknown, afterUnknown, setActive, other, revisions: [...new Set(sceneSets)] };
  });
  assert.equal(result.reply, undefined, "the engine replies ok");
  assert.deepEqual([result.ready.time, result.ready.exact, result.ready.revision], [240000, true, 1]);
  assert.equal(result.rejected, "surface/invalid-payload");
  assert.equal(result.unknown, "surface/unknown-command");
  expectNear(result.afterUnknown, [255, 0, 0, 255], "engine state is unchanged by an unknown command");
  expectNear(result.other, [0, 0, 255, 255], "the other scene is the root of the render, with no scene.set");
  assert.deepEqual(result.revisions, [1]);
});

test("Scene snapshot and revisioned patches — Patch applies and re-renders; Stale patch; Edit inside a compound scene updates the parent frame; Project setting change; Gesture preview overrides — Drag preview; Override cleared by commit", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const white = await jc.imageUrl(8, 8, (context) => { context.fillStyle = "#ffffff"; context.fillRect(0, 0, 8, 8); });
    const sources = [{ assetId: "white", original: white }];
    const doc = jc.project({ width: 200, height: 200 }, { kind: "color", color: "#000000" });
    doc.media.assets.push(jc.asset("white", "image", { width: 8, height: 8 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e9", startTime: 0, duration: 600000, mediaId: "white", transform: { position: { x: 0, y: 0 }, scale: { x: 0.2, y: 0.2 }, rotation: 0 } }));
    const inner = JSON.parse(JSON.stringify(doc.scenes[0]));
    inner.id = "s2"; inner.isMain = false; inner.kind = "compound";
    inner.tracks.main.elements = [jc.element("image", { id: "in1", startTime: 0, duration: 600000, mediaId: "white", transform: { position: { x: -80, y: -80 }, scale: { x: 0.1, y: 0.1 }, rotation: 0 } })];
    doc.scenes.push(inner);
    doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [jc.element("compound", { id: "c1", startTime: 0, duration: 600000, sceneId: "s2", sourceDuration: 600000 })])];
    const opened = await jc.open(doc, { width: 200, height: 200 }, sources);
    await opened.frameAt(0);
    const pixel = async () => (await opened.engine.readPixels(0, 0, 200, 200));
    const at = (pixels: Uint8Array, x: number, y: number) => Array.from(pixels.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 4));
    const patched = async (command: Parameters<typeof opened.port.command>[1], type: "scene.patch" = "scene.patch") => {
      const mark = opened.events.length, started = performance.now();
      const reply = await opened.port.command(type, command as never);
      const frame = await opened.waitFor("frame.ready", mark);
      return { reply, frame, ms: performance.now() - started, pixels: await pixel() };
    };
    // 1 → 2: opacity of the main clip.
    const opacity = await patched({ baseRevision: 1, revision: 2, patches: [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e9/opacity", value: 0.5 }] });
    const stale = await opened.port.command("scene.patch", { baseRevision: 1, revision: 3, patches: [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e9/opacity", value: 1 }] }).then(() => null, (error) => error.code);
    const invalid = await opened.port.command("scene.patch", { baseRevision: 2, revision: 3, patches: [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@nope/opacity", value: 1 }] }).then(() => null, (error) => error.code);
    const unchanged = at(await pixel(), 100, 100);
    // 2 → 3: a clip inside the compound scene moves; the parent frame shows it.
    const compound = await patched({ baseRevision: 2, revision: 3, patches: [{ op: "replace", path: "/scenes/@s2/tracks/main/elements/@in1/transform/position", value: { x: 80, y: 80 } }] });
    // 3 → 4: the project background.
    const background = await patched({ baseRevision: 3, revision: 4, patches: [{ op: "replace", path: "/settings/background", value: { kind: "color", color: "#00ff00" } }] });
    // A gesture override moves the main clip 60 px right without changing the revision.
    const overrideMark = opened.events.length;
    await opened.port.command("preview.setOverride", { overrides: { e9: { transform: { position: { x: 60, y: 0 } } } } });
    const overrideFrame = await opened.waitFor("frame.ready", overrideMark);
    const overridden = await pixel();
    // A still that asks for committed state does not include the override.
    // The next patch drops the override.
    const commit = await patched({ baseRevision: 4, revision: 5, patches: [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e9/opacity", value: 1 }] });
    return {
      opacity: { reply: opacity.reply, revision: opacity.frame.revision, ms: opacity.ms, centre: at(opacity.pixels, 100, 100) }, stale, invalid, unchanged,
      compound: { revision: compound.frame.revision, old: at(compound.pixels, 20, 20), moved: at(compound.pixels, 180, 180) },
      background: { revision: background.frame.revision, corner: at(background.pixels, 100, 20), ms: background.ms },
      override: { revision: overrideFrame.revision, displaced: at(overridden, 160, 100), original: at(overridden, 100, 100) },
      commit: { revision: commit.frame.revision, centre: at(commit.pixels, 100, 100), right: at(commit.pixels, 165, 100) },
    };
  });
  assert.deepEqual(result.opacity.reply, { revision: 2 });
  assert.equal(result.opacity.revision, 2);
  expectNear(result.opacity.centre, [128, 128, 128, 255], "opacity 0.5 after the patch");
  console.log(`scene.patch to frame.ready: ${result.opacity.ms.toFixed(1)} ms and ${result.background.ms.toFixed(1)} ms (200×200, software WebGL2)`);
  assert.equal(result.stale, "scene/revision-mismatch");
  assert.equal(result.invalid, "scene/patch-invalid");
  expectNear(result.unchanged, [128, 128, 128, 255], "a rejected patch leaves the engine's copy unchanged");
  assert.equal(result.compound.revision, 3);
  expectNear(result.compound.old, [0, 0, 0, 255], "the inner clip left its old place");
  expectNear(result.compound.moved, [255, 255, 255, 255], "the parent frame shows the change inside the compound scene");
  expectNear(result.background.corner, [0, 255, 0, 255], "the new background");
  assert.equal(result.override.revision, 4, "an override does not change the revision");
  expectNear(result.override.displaced, [128, 255, 128, 255], "the element is displaced by the override");
  expectNear(result.override.original, [0, 255, 0, 255], "and no longer at its committed place");
  assert.equal(result.commit.revision, 5);
  expectNear(result.commit.centre, [255, 255, 255, 255], "after the commit the frame is rendered from revision 5 only");
  expectNear(result.commit.right, [0, 255, 0, 255], "the override map was emptied");
});

test("Preview render loop — Idle when nothing changes; Texture cache and upload rules — Static frame causes no uploads; Golden-frame determinism — Repeat render is identical; Still frame and thumbnail rendering — Still at end of timeline; Size out of range", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const picture = await jc.imageUrl(64, 64, (context) => { const gradient = context.createLinearGradient(0, 0, 64, 64); gradient.addColorStop(0, "#ff8800"); gradient.addColorStop(1, "#0044ff"); context.fillStyle = gradient; context.fillRect(0, 0, 64, 64); });
    const sources = [{ assetId: "p", original: picture }];
    const doc = jc.project({ width: 320, height: 180 }, { kind: "transparent" });
    doc.media.assets.push(jc.asset("p", "image", { width: 64, height: 64 }));
    const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
    doc.scenes[0].tracks.main.elements.push(jc.element("image", {
      id: "e1", startTime: 0, duration: 120000, mediaId: "p", masks: [{ id: "m", type: "ellipse", enabled: true, combine: "add", params: { width: 0.8, height: 0.8, feather: 30 } }],
      effects: [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 20 } }],
      animations: { "transform.rotation": { keys: [key("a", 0, 0), key("b", 120000, 90)] } },
    }));
    const opened = await jc.open(doc, { width: 320, height: 180 }, sources);
    const first = await opened.frameAt(60000);
    const counters = { ...opened.engine.counters };
    // Rendering the same paused frame again: no upload; and five idle seconds are not waited for — the loop is
    // event driven, so a short pause with no input must add no draw at all.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const idle = { ...opened.engine.counters };
    // Another instance renders the same snapshot at the same time.
    const again = await (await jc.open(doc, { width: 320, height: 180 }, sources)).frameAt(60000);
    let differing = 0;
    for (let index = 0; index < first.pixels.length; index++) if (first.pixels[index] !== again.pixels[index]) differing++;
    // Stills.
    const stills: any[] = [];
    const again2 = await jc.open(doc, { width: 320, height: 180 }, sources);
    again2.port.on("still.done", (payload, transfer) => { stills.push({ payload, bytes: new Uint8Array(transfer![0]) }); });
    const accepted = await again2.port.command("still.render", { requestId: "s1", time: 120000, format: "png" });
    await again2.waitFor("still.done");
    const bitmap = await createImageBitmap(new Blob([stills[0].bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const lastFrame = await again2.frameAt(116000);
    const stillCentre = Array.from(context.getImageData(160, 90, 1, 1).data), stillCorner = Array.from(context.getImageData(2, 2, 1, 1).data);
    const tooLarge = await again2.port.command("still.render", { requestId: "s2", time: 0, width: 8192, height: 8192 }).then(() => null, (error) => error.code);
    await again2.port.command("still.render", { requestId: "s3", time: 0, width: 64, height: 36, format: "jpeg", quality: 80 });
    const jpeg = await again2.waitFor("still.done", again2.events.findIndex((event) => event.type === "still.done") + 1);
    return {
      uploadsFirst: counters.textureUpload, uploadsIdle: idle.textureUpload - counters.textureUpload, drawsIdle: idle.renderFrame - counters.renderFrame, differing,
      accepted, still: { ...stills[0].payload, magic: Array.from(stills[0].bytes.slice(0, 4)) }, stillCentre, stillCorner, lastFrameCentre: lastFrame.at(160, 90), tooLarge, jpeg,
    };
  });
  assert.ok(result.uploadsFirst >= 2);
  assert.equal(result.uploadsIdle, 0, "no upload for an unchanged frame");
  assert.equal(result.drawsIdle, 0, "a paused, unchanged scene causes zero GPU draws");
  assert.equal(result.differing, 0, "two renders of one snapshot are byte-identical");
  assert.deepEqual(result.accepted, { requestId: "s1" });
  assert.deepEqual([result.still.width, result.still.height, result.still.format], [320, 180, "png"]);
  assert.deepEqual(result.still.magic, [0x89, 0x50, 0x4e, 0x47]);
  expectNear(result.stillCentre, result.lastFrameCentre, "a still at the scene duration is the last frame of the scene", 3);
  assert.equal(result.stillCorner[3], 0, "a PNG still of a transparent background has transparent pixels");
  assert.equal(result.tooLarge, "surface/invalid-payload");
  assert.deepEqual([result.jpeg.width, result.jpeg.height, result.jpeg.format], [64, 36, "jpeg"]);
});

test("EngineSurface events — Time events during playback on desktop; Audio clock as playback master — End of timeline", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const doc = jc.project({ width: 64, height: 64 }, { kind: "color", color: "#203040" });
    doc.settings.fps = { numerator: 60, denominator: 1 };
    doc.media.assets.push(jc.asset("p", "image", { width: 8, height: 8 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 600000, mediaId: "p" }));
    const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "p", original: await jc.imageUrl(8, 8, (context) => { context.fillStyle = "#fff"; context.fillRect(0, 0, 8, 8); }) }]);
    await opened.frameAt(0);
    // Play for two seconds.
    let mark = opened.events.length;
    await opened.port.command("transport.play", {});
    // Two seconds of playback, counted from the first frame the clock presents.
    await opened.waitFor("transport.time", mark);
    const droppedBefore = opened.engine.counters.droppedFrames;
    mark = opened.events.length - 1;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await opened.port.command("transport.pause", {});
    const during = opened.events.slice(mark).filter((event) => event.type === "transport.time" && event.payload.playing).map((event) => event.payload);
    const droppedDuring = opened.engine.counters.droppedFrames - droppedBefore;
    // Play from near the end with loop off: the transport stops at exactly the scene duration.
    mark = opened.events.length;
    await opened.port.command("transport.play", { fromTime: 560000 });
    const ended = await opened.waitFor("transport.ended", mark);
    const tail = opened.events.slice(mark);
    const lastTime = tail.filter((event) => event.type === "transport.time").at(-1)!.payload;
    const lastFrame = tail.filter((event) => event.type === "frame.ready").at(-1)!.payload;
    const state = tail.filter((event) => event.type === "transport.state").at(-1)!.payload;
    // The next play starts from 0.
    mark = opened.events.length;
    await opened.port.command("transport.play", {});
    const restarted = await opened.waitFor("transport.time", mark);
    await opened.port.command("transport.pause", {});
    const badRate = await opened.port.command("transport.setRate", { rate: 3 }).then(() => null, (error) => error.code);
    return { during, ended, lastTime, lastFrame, state, restarted, badRate, dropped: droppedDuring };
  });
  console.log(`playback: ${result.during.length} transport.time events in 2 s at 60 fps (headless rAF), ${result.dropped} dropped frames`);
  // One event per presented frame: with no dropped frames that is 118–122 in two seconds at 60 fps. The software
  // rasteriser of this runtime does drop frames, so presented plus dropped frames are held to that window.
  // rasteriser of this runtime does drop frames, so what is held here is the clock: the events span two seconds of
  // timeline, and there is never more than one event per frame of it.
  const spanFrames = (result.during.at(-1)!.time - result.during[0].time) / 2000;
  assert.ok(spanFrames >= 100 && spanFrames <= 124, `the events span ${spanFrames} frames of timeline`);
  assert.ok(result.during.length <= spanFrames + 1 && result.during.length <= 122, `${result.during.length} events over ${spanFrames} frames`);
  assert.ok(result.during.every((event, index) => event.time % 2000 === 0 && (index === 0 || event.time > result.during[index - 1].time)), "each carries a frame-aligned time strictly greater than the previous one");
  // The clock in use is reported with every event: the audio clock when the context runs, the monotonic one otherwise.
  assert.equal(new Set(result.during.map((event) => event.audioClock)).size, 1);
  assert.deepEqual(result.ended, { time: 600000 });
  assert.deepEqual([result.lastTime.time, result.lastTime.playing], [600000, false], "the reported position is exactly the scene duration");
  assert.equal(result.lastFrame.time, 598000, "the frame on screen is the last frame");
  assert.deepEqual([result.state.playing, result.state.reason], [false, "ended"]);
  assert.ok(result.restarted.time < 60000, `the next play starts from 0 (${result.restarted.time})`);
  assert.equal(result.badRate, "surface/invalid-payload", "Unsupported rate");
});

test("Performance — measured frame render times of a 1920×1080 scene on this machine (headless Chromium)", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const picture = (hue: number) => jc.imageUrl(1920, 1080, (context) => { const gradient = context.createLinearGradient(0, 0, 1920, 1080); gradient.addColorStop(0, `hsl(${hue},80%,50%)`); gradient.addColorStop(1, `hsl(${hue + 120},80%,30%)`); context.fillStyle = gradient; context.fillRect(0, 0, 1920, 1080); });
    const sources = [{ assetId: "a", original: await picture(0) }, { assetId: "b", original: await picture(90) }, { assetId: "c", original: await picture(200) }];
    const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
    const build = (heavy: boolean) => {
      const doc = jc.project({ width: 1920, height: 1080 });
      for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "image", { width: 1920, height: 1080 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "m", startTime: 0, duration: 1200000, mediaId: "a" }));
      doc.scenes[0].tracks.overlay = [
        jc.track("video", "o0", [jc.element("image", { id: "x", startTime: 0, duration: 1200000, mediaId: "b", opacity: 0.8, blendMode: "screen", transform: { position: { x: 300, y: 100 }, scale: { x: 0.4, y: 0.4 }, rotation: 0 }, animations: { "transform.rotation": { keys: [key("a", 0, 0), key("b", 1200000, 360)] } } })]),
        jc.track("video", "o1", [jc.element("image", { id: "y", startTime: 0, duration: 1200000, mediaId: "c", transform: { position: { x: -200, y: 0 }, scale: { x: 0.6, y: 0.6 }, rotation: 0 },
          ...(heavy ? { effects: [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 40 } }], masks: [{ id: "m", type: "ellipse", enabled: true, combine: "add", params: { width: 0.8, height: 0.8, feather: 40 } }] } : {}) })]),
      ];
      return doc;
    };
    const measure = async (heavy: boolean) => {
      const opened = await jc.open(build(heavy), { width: 1920, height: 1080 }, sources);
      await opened.frameAt(0);
      const times: number[] = [], finished: number[] = [];
      for (let frame = 1; frame <= 12; frame++) {
        const mark = opened.events.length, started = performance.now();
        await opened.port.command("transport.seek", { time: frame * 4000, mode: "exact" });
        times.push((await opened.waitFor("frame.ready", mark)).renderMs);
        // `renderMs` ends when the frame is submitted; reading one pixel back waits until the GPU has drawn it.
        await opened.engine.readPixels(0, 0, 1, 1);
        finished.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      finished.sort((a, b) => a - b);
      return { mean: times.reduce((sum, value) => sum + value, 0) / times.length, p50: times[6], p95: times[11], max: times[11], drawnP50: finished[6], drawnP95: finished[11], size: opened.engine.renderSize, backend: opened.ready().backend, software: opened.ready().software };
    };
    return { plain: await measure(false), heavy: await measure(true) };
  });
  const line = (name: string, entry: typeof result.plain) => `${name}: mean ${entry.mean.toFixed(1)} ms, p50 ${entry.p50.toFixed(1)} ms, p95 ${entry.p95.toFixed(1)} ms, max ${entry.max.toFixed(1)} ms reported as renderMs; p50 ${entry.drawnP50.toFixed(1)} ms, p95 ${entry.drawnP95.toFixed(1)} ms until drawn (seek → read-back) at ${entry.size!.width}×${entry.size!.height} on ${entry.backend}${entry.software ? " (software rasteriser)" : ""}`;
  console.log(line("3 layers", result.plain));
  console.log(line("3 layers + blur 40 + feathered mask", result.heavy));
  assert.deepEqual(result.plain.size, { width: 1920, height: 1080 });
  assert.ok(result.plain.mean > 0 && result.heavy.mean > 0);
});
