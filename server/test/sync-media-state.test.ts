import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { S, toolWorld } from "./support/tools.ts";

test("a connected device's missing media reaches project reads and the result of adding it", async () => {
  const runDir = fileURLToPath(new URL("../../.dev/run-w20b-2", import.meta.url));
  mkdirSync(runDir, { recursive: true });
  const w = await toolWorld({ harness: { dataDir: `${runDir}/data`, listenPort: 18937 } });
  const device = await w.h.pair("Editing Laptop", "editor");
  await device.call("jagentchill.sync.media-state.report", {
    projectId: w.doc.id,
    assets: [
      { assetId: w.project.assets.drone, state: "failed", reason: "Download failed after retry." },
      { assetId: w.project.assets.silent, state: "no-space", reason: "Not enough free space on this device." },
    ],
  });

  const listed = await w.ok("jc_media_list", { query: "drone_dalat_01" });
  assert.deepEqual(listed.data.assets[0].deviceIssues.map((issue: any) => [issue.deviceName, issue.state, issue.reason]), [["Editing Laptop", "failed", "Download failed after retry."]]);
  const got = await w.ok("jc_media_get", { assetId: w.project.assets.drone });
  assert.deepEqual(got.data.asset.deviceIssues.map((issue: any) => issue.deviceName), ["Editing Laptop"]);
  assert.equal(w.h.app.sync.host.mediaDeviceIssues(w.doc.id, w.project.assets.silent)[0]?.state, "no-space");

  const added = await w.write("jc_clip_add", { assetId: w.project.assets.silent, start: 30 * S, duration: S });
  assert.match(added.summary!, /Editing Laptop could not get "timelapse\.mp4": Not enough free space on this device\./);
  assert.deepEqual(added.data.deviceMediaIssues.map((issue: any) => [issue.name, issue.deviceName, issue.state]), [["timelapse.mp4", "Editing Laptop", "no-space"]]);
  w.close();
});
