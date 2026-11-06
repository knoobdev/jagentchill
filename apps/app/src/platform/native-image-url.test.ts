import assert from "node:assert/strict";
import test from "node:test";
import { nativeImageUrl } from "./native-image-url.ts";

test("native project images use an Image-readable data URI without constructing a Blob", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  assert.equal(nativeImageUrl(bytes, "image/jpeg", (value) => Buffer.from(value).toString("base64")), "data:image/jpeg;base64,/9j/");
});
