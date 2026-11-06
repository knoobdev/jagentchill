import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeImportPlacement } from "./native-import-placement.ts";

test("native import placement waits for the synchronized asset before adding its clip", () => {
  const added: { ids: string[]; overlay: boolean }[] = [];
  const placement = createNativeImportPlacement((ids, overlay) => added.push({ ids, overlay }));
  let assets = new Set<string>();
  const hasAsset = (id: string) => assets.has(id);

  placement.request(["phone-video"], false, hasAsset);
  assert.equal(placement.pendingCount, 1);
  assert.deepEqual(added, []);
  placement.flush(hasAsset);
  assert.deepEqual(added, []);

  assets.add("phone-video");
  placement.flush(hasAsset);
  assert.equal(placement.pendingCount, 0);
  assert.deepEqual(added, [{ ids: ["phone-video"], overlay: false }]);

  placement.request(["already-synced"], true, () => true);
  assert.deepEqual(added.at(-1), { ids: ["already-synced"], overlay: true });
});

