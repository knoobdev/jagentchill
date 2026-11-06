// Copying a starter template with the network off keeps its cover: `thumbnailBytes` reads the copy the gallery keeps in
// Cache Storage before it asks the network. Run with `node --test apps/app/src/templates/store.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoragePort } from "@jagentchill/storage";
import { thumbnailBytes, type TemplateEntry } from "./store.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const entry = { bundled: true, manifest: { id: "memories", thumbnail: "cover.jpg" } } as unknown as TemplateEntry;
const storage = {} as StoragePort;

test("a starter's cover comes from the kept copy: offline it is still there and no request is made for it", async () => {
  const kept = new Map<string, Response>(), requests: string[] = [];
  let online = true;
  Object.assign(globalThis, {
    location: { origin: "http://localhost" },
    caches: { keys: async () => [], delete: async () => true, open: async () => ({ match: async (path: string) => kept.get(path)?.clone(), put: async (path: string, response: Response) => { kept.set(path, response); } }) },
    fetch: async (path: string) => { requests.push(path); if (!online) throw new TypeError("Failed to fetch"); return new Response(JPEG, { headers: { "content-type": "image/jpeg" } }); },
  });
  // The gallery showed the card once while online: the file is kept.
  assert.deepEqual(await thumbnailBytes(storage, entry), JPEG);
  assert.deepEqual(requests, ["/templates/memories/cover.jpg"]);
  online = false;
  requests.length = 0;
  assert.deepEqual(await thumbnailBytes(storage, entry), JPEG, "offline, the cover is read from the kept copy");
  assert.deepEqual(requests, [], "no request is made for a kept file");
});
