// An actual same-thread engine surface must update its HTML canvas backing store when the stage/DPR changes.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });

test("preview compositor backing follows resized stage in device pixels and caps at the project resolution", async () => {
  const result = await harness.page.evaluate(async () => {
    const doc = window.jc.project({ width: 1080, height: 1920 });
    const opened = await window.jc.open(doc, { width: 640, height: 360 });
    const mark = opened.events.length;
    await opened.port.command("view.resize", { width: 200.8, height: 357, devicePixelRatio: 2, zoom: 1 });
    await opened.waitFor("frame.ready", mark);
    const canvas = opened.host.querySelector("canvas")!;
    const first = { backing: [canvas.width, canvas.height], target: opened.engine.renderSize };
    const resized = opened.events.length;
    await opened.port.command("view.resize", { width: 352.7, height: 627, devicePixelRatio: 2, zoom: 1 });
    await opened.waitFor("frame.ready", resized);
    const large = { backing: [canvas.width, canvas.height], target: opened.engine.renderSize };
    const zoomed = opened.events.length;
    await opened.port.command("view.resize", { width: 352.7, height: 627, devicePixelRatio: 2, zoom: 8 });
    await opened.waitFor("frame.ready", zoomed);
    return { first, large, capped: { backing: [canvas.width, canvas.height], target: opened.engine.renderSize } };
  });
  assert.deepEqual(result.first, { backing: [402, 714], target: { width: 402, height: 714 } });
  assert.deepEqual(result.large, { backing: [706, 1254], target: { width: 706, height: 1254 } });
  assert.deepEqual(result.capped, { backing: [1080, 1920], target: { width: 1080, height: 1920 } });
});
