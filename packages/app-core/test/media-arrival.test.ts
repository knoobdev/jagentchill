// A media file arrives (sync downloaded it) while the editor is open: the document learns that the file is on this device.
// Finding that out READS STORAGE, which takes time, and the person keeps editing meanwhile. The real editor controller is
// used, with a store whose answers are held back until the test lets them go — the edit below is made in between.
// (`packages/media` is imported by path: this package does not depend on it; the editor screen wires the two together.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { ids, NOW, REGISTRIES } from "../../editor-core/test/support/fixtures.ts";
import { project } from "../../editor-core/test/support/timeline.ts";
import { findArrivedMedia, markArrivedMedia, settleArrivedMedia, type ArrivedProbe } from "../../media/src/arrived.ts";
import { localAssetOf, setLocalAsset } from "../../media/src/commands.ts";
import { createEditorController } from "../src/index.ts";

const prefs = { ...timeline.DEFAULT_TIMELINE_PREFERENCES };
/** A store that answers only when the test says so: every question waits at `gate`. */
function heldStore(originals: Set<string>, proxies = new Set<string>()) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let asked = 0;
  const probe: ArrivedProbe = {
    hasOriginal: async (assetId) => { asked++; await gate; return originals.has(assetId); },
    hasProxy: async (contentHash) => { asked++; await gate; return proxies.has(contentHash); },
  };
  return { probe, open, asked: () => asked };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** The fixture project with every asset marked absent on this device, as a project that arrived by sync is. */
function opened() {
  let document = project();
  for (const asset of document.media.assets) document = setLocalAsset(document, asset.id, { present: {} });
  const controller = createEditorController({ document, newId: ids("gen"), now: () => NOW + 1, registries: REGISTRIES, platform: "web", prefs: () => prefs });
  return controller;
}
const elementsOf = (document: ProjectDocument) => document.scenes.flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]).flatMap((track) => track.elements.map((element) => element.id));

test("media arrival: an edit made while the store is being read is kept — only the presence of the arrived file is merged into the document of that later moment", async () => {
  const controller = opened(), store = heldStore(new Set(["a4"]));
  const applied: ProjectDocument[] = [];
  const settling = settleArrivedMedia(store.probe, () => controller.stored, (next) => { applied.push(next); controller.replace(next); });
  await tick();
  assert.ok(store.asked() > 0, "the store is being read");
  // The person adds a clip while the reads are held.
  const added = controller.run(timeline.addToTimeline({ sceneId: controller.session.sceneId, items: [{ kind: "media", assetId: "a2" }], time: 0 })).info!.elementIds[0];
  assert.ok(elementsOf(controller.stored).includes(added));
  const edited = controller.stored;
  store.open();
  assert.equal(await settling, true);
  assert.ok(elementsOf(controller.stored).includes(added), "the clip added during the reads is still on the timeline");
  assert.equal(localAssetOf(controller.stored, "a4").present?.original, true, "the arrived file is marked present");
  // Nothing but the device-local section differs from the document the person had made.
  const { local: _a, ...after } = controller.stored as ProjectDocument & { local?: unknown }, { local: _b, ...before } = edited as ProjectDocument & { local?: unknown };
  assert.deepEqual(after, before);
  assert.equal(applied.length, 1);

  // The defect this guards, as the editor screen did it before: the OLD document is transformed and put back.
  const old = opened(), slow = heldStore(new Set(["a4"]));
  const stale = old.stored, finding = findArrivedMedia(slow.probe, stale);
  const lost = old.run(timeline.addToTimeline({ sceneId: old.session.sceneId, items: [{ kind: "media", assetId: "a2" }], time: 0 })).info!.elementIds[0];
  slow.open();
  old.replace(markArrivedMedia(stale, await finding)!);
  assert.equal(elementsOf(old.stored).includes(lost), false, "transforming the document read before the await loses the edit");
});

test("media arrival: an asset imported during the reads keeps its record, an asset removed during them is not brought back, and a proxy is marked only where no original is", async () => {
  const controller = opened(), store = heldStore(new Set(["a4", "a2"]), new Set(["hash-of-a1"]));
  // Give one asset a content hash the proxy cache knows.
  controller.replace({ ...controller.stored, media: { ...controller.stored.media, assets: controller.stored.media.assets.map((asset) => (asset.id === "a1" ? { ...asset, contentHash: "hash-of-a1" } : asset)) } });
  const settling = settleArrivedMedia(store.probe, () => controller.stored, (next) => controller.replace(next));
  await tick();
  const template = controller.stored.media.assets.find((asset) => asset.id === "a2")!;
  // Meanwhile: a new asset is imported, and a2 is removed from the library.
  controller.replace({ ...controller.stored, media: { ...controller.stored.media, assets: [...controller.stored.media.assets, { ...template, id: "fresh", name: "fresh.jpg" }] } });
  controller.replace({ ...controller.stored, media: { ...controller.stored.media, assets: controller.stored.media.assets.filter((asset) => asset.id !== "a2") } });
  store.open();
  await settling;
  const ids = controller.stored.media.assets.map((asset) => asset.id);
  assert.ok(ids.includes("fresh"), "the import made during the reads is kept");
  assert.equal(ids.includes("a2"), false, "the removed asset stays removed");
  assert.notEqual(localAssetOf(controller.stored, "a2").present?.original, true, "no presence is written for an asset that is gone");
  assert.equal(localAssetOf(controller.stored, "a4").present?.original, true);
  assert.equal(localAssetOf(controller.stored, "a1").present?.proxy, true);
  assert.equal(localAssetOf(controller.stored, "a1").proxy?.state, "succeeded");
  // A second pass finds nothing new and changes nothing.
  const again = heldStore(new Set(["a4"]), new Set(["hash-of-a1"]));
  again.open();
  assert.equal(await settleArrivedMedia(again.probe, () => controller.stored, () => assert.fail("nothing to apply")), false);
  // A document that is no longer the open one is left alone.
  assert.equal(await settleArrivedMedia(again.probe, () => null, () => assert.fail("closed")), false);
});
