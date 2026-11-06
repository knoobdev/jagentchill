// Deferred capability probes in headless Chromium: they run after engine.ready in a worker while the transport is paused, are put off by playback, and their result is cached for the browser version.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(Number(process.env.W17_TEST_BROWSER_PORT ?? 19118)); });
after(async () => { await harness?.close(); });

test("Engine disposal clears its deferred probe timer and terminates an active probe worker", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    localStorage.removeItem("jagentchill.engine.probes.v1");
    const counts = { created: 0, terminated: 0 };
    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        counts.created += 1;
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => { counts.terminated += 1; terminate(); };
        return worker;
      },
    });
    const opened = await jc.open(jc.project({ width: 320, height: 180 }), { width: 320, height: 180, exportWorker: true, probeClip: true });
    await opened.port.command("engine.dispose", {});
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return { ...counts, constraintsChanged: opened.events.filter((event) => event.type === "engine.constraintsChanged").length };
  });
  assert.equal(result.created, result.terminated, `probe workers created/terminated=${result.created}/${result.terminated}`);
  assert.equal(result.constraintsChanged, 0, "a disposed surface does not apply a late probe result");
});

test("Deferred probes — never before engine.ready: the handshake reports calibrated false with the defaults; the decode and encode probes run at the earliest 500 ms later, in a worker, within 4 000 ms, and arrive with engine.constraintsChanged; playback puts them off; the result is cached for this browser and OS version", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    localStorage.removeItem("jagentchill.engine.probes.v1");
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const doc = () => jc.project({ width: 320, height: 180 });
    // 1. Paused from the start: the probes run by themselves.
    const started = performance.now();
    const first = await jc.open(doc(), { width: 320, height: 180, exportWorker: true, probeClip: true });
    const atReady = first.ready().constraints, readyAt = performance.now();
    // While they run the app's thread stays free: the longest gap between two timer ticks is measured.
    let last = performance.now(), gap = 0, watching = true;
    const watch = () => { const now = performance.now(); gap = Math.max(gap, now - last); last = now; if (watching) setTimeout(watch, 5); };
    watch();
    const changed = await first.waitFor("engine.constraintsChanged", 0, 15_000);
    watching = false;
    const arrived = performance.now() - readyAt;
    const probe = (first.engine as any).probeResult;
    const stored = JSON.parse(localStorage.getItem("jagentchill.engine.probes.v1") ?? "null");
    // 2. The next engine of this browser starts calibrated and measures nothing.
    const second = await jc.open(doc(), { width: 320, height: 180, exportWorker: true, probeClip: true });
    const cachedReady = second.ready().constraints;
    await sleep(900);
    const again = second.events.filter((event) => event.type === "engine.constraintsChanged").length;
    // 3. A cache entry of another browser version is discarded: calibrated false again, and playback puts the probes off.
    localStorage.setItem("jagentchill.engine.probes.v1", JSON.stringify({ agent: "another browser 1.0", result: stored.result }));
    const longer = jc.project({ width: 320, height: 180 });
    longer.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [jc.element("graphic", { id: "g", startTime: 0, duration: 1_200_000, definitionId: "rectangle", params: { fill: "#ffffff", strokeWidth: 0, cornerRadius: 0 } })])];
    const third = await jc.open(longer, { width: 320, height: 180, exportWorker: true, probeClip: true });
    const staleReady = third.ready().constraints;
    await third.port.command("transport.play", {});
    await sleep(1500);
    const whilePlaying = third.events.filter((event) => event.type === "engine.constraintsChanged").length;
    await third.port.command("transport.pause", {});
    const afterPause = await third.waitFor("engine.constraintsChanged", 0, 15_000);
    return { atReady, handshake: readyAt - started, arrived, changed, probe, stored, gap, cachedReady, again, staleReady, whilePlaying, afterPause };
  });
  console.log(`deferred probes: decode ${result.probe.decode?.realtime.toFixed(1)}× real time, seek p95 ${result.probe.decode?.seekP95.toFixed(0)} ms, encode ${result.probe.encode?.realtime.toFixed(2)}× real time, ran ${Math.round(result.probe.elapsed)} ms; longest main-thread gap while they ran ${Math.round(result.gap)} ms`);
  assert.deepEqual([result.atReady.calibrated, result.atReady.proxyEditing, result.atReady.onDeviceVideoExport], [false, "optional", true], "defaults until a result exists");
  assert.ok(result.arrived >= 500, `not before 500 ms after engine.ready: ${result.arrived} ms`);
  assert.ok(result.probe.elapsed <= 4000, `the probes ran ${result.probe.elapsed} ms`);
  assert.ok(result.probe.decode && result.probe.decode.realtime > 0 && result.probe.decode.seekP95 > 0, "the bundled clip was decoded and sought");
  assert.ok(result.probe.encode && result.probe.encode.realtime > 0, "60 frames of 1080p were encoded");
  assert.equal(result.changed.constraints.calibrated, true);
  assert.equal(result.changed.constraints.proxyEditing, result.probe.decode.realtime < 1 || result.probe.decode.seekP95 > 150 ? "required" : "optional");
  assert.equal(result.changed.constraints.onDeviceVideoExport, result.probe.encode.realtime >= 0.5);
  assert.ok(result.gap < 100, `the app's thread was not blocked: longest gap ${result.gap} ms`);
  assert.deepEqual(result.stored.result, result.probe);
  assert.deepEqual([result.cachedReady.calibrated, result.cachedReady.proxyEditing, result.again], [true, result.changed.constraints.proxyEditing, 0]);
  assert.equal(result.staleReady.calibrated, false, "another version's entry is discarded");
  assert.equal(result.whilePlaying, 0, "no probe while the transport plays");
  assert.equal(result.afterPause.constraints.calibrated, true);
});
