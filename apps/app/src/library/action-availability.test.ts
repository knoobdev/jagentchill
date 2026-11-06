import assert from "node:assert/strict";
import test from "node:test";
import { nativeLibraryActionUnavailable } from "./action-availability.ts";

test("native Library import and preview actions report their unsupported platform path", () => {
  for (const platform of ["ios", "android"]) {
    assert.equal(nativeLibraryActionUnavailable(platform, "import"), "Importing Library items is not available on this device yet.");
    assert.equal(nativeLibraryActionUnavailable(platform, "preview"), "Sound preview is not available on this device yet.");
  }
  assert.equal(nativeLibraryActionUnavailable("web", "import"), null);
  assert.equal(nativeLibraryActionUnavailable("web", "preview"), null);
});
