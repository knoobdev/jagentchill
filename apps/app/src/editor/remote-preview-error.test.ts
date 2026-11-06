import assert from "node:assert/strict";
import { test } from "node:test";
import { remotePreviewError } from "./remote-preview-error.ts";

test("remote preview distinguishes a renderer failure from a host connection failure", () => {
  assert.equal(remotePreviewError("The render host is unavailable."), "The render host is unavailable.");
  assert.equal(remotePreviewError("RENDERER_UNAVAILABLE: JAGENTCHILL_RENDER_HOST_PATH is not set"), "RENDERER_UNAVAILABLE: JAGENTCHILL_RENDER_HOST_PATH is not set");
  assert.equal(remotePreviewError("Connection closed (1006 )."), "Host unreachable");
  assert.equal(remotePreviewError("Network request failed"), "Host unreachable");
});

