import assert from "node:assert/strict";
import { test } from "node:test";
import { ofThisBuild, pageBuild } from "./buildTag.ts";

const page = (content: string | null, controlled = true) => ({
  document: { querySelector: (selector: string) => (selector === 'meta[name="jagentchill-build"]' && content !== null ? { getAttribute: () => content } : null) },
  navigator: { serviceWorker: { controller: controlled ? {} : null } },
});

test("Worker files carry the page's build: the address of a worker, its wasm and its fonts is tagged with the build written in the page", () => {
  assert.equal(pageBuild(page("2f7f7d447a90")), "2f7f7d447a90");
  assert.equal(ofThisBuild("/engine/export-worker.js", page("2f7f7d447a90")), "/engine/export-worker.js?build=2f7f7d447a90");
  assert.equal(ofThisBuild("/wasm/opencut_wasm_bg.wasm?v=1#x", page("2f7f7d447a90")), "/wasm/opencut_wasm_bg.wasm?v=1&build=2f7f7d447a90#x");
});

test("Worker files carry the page's build on a first visit too: the tag does not wait for the service worker to answer the page", () => {
  assert.equal(ofThisBuild("/wasm/opencut_wasm_bg.wasm", page("2f7f7d447a90", false)), "/wasm/opencut_wasm_bg.wasm?build=2f7f7d447a90");
  assert.equal(ofThisBuild("/engine/decode-1080p30.mp4", { document: page("2f7f7d447a90").document }), "/engine/decode-1080p30.mp4?build=2f7f7d447a90");
});

test("Worker files carry the page's build: no tag where the page names no build", () => {
  assert.equal(ofThisBuild("/engine/export-worker.js", page(null)), "/engine/export-worker.js");
  assert.equal(ofThisBuild("/engine/export-worker.js", page("not an id")), "/engine/export-worker.js");
  assert.equal(ofThisBuild("/engine/export-worker.js", {}), "/engine/export-worker.js");
  // A font the person imported (an object URL) or a file of a host is not a file of the build.
  for (const other of ["blob:http://localhost:8088/0b9c", "data:font/ttf;base64,AAAA", "https://host.example/jagentchill/v1/media/a.ttf", "//host.example/a.ttf"]) assert.equal(ofThisBuild(other, page("2f7f7d447a90")), other);
});
