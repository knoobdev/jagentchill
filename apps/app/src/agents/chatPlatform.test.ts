import assert from "node:assert/strict";
import { test } from "node:test";
import { needsFilePickerNotice, usesDomChatScroll } from "./chatPlatform.ts";

test("the chat explains when its browser file picker cannot run", () => {
  assert.equal(needsFilePickerNotice("ios", false), true);
  assert.equal(needsFilePickerNotice("android", false), true);
  assert.equal(needsFilePickerNotice("web", false), true);
  assert.equal(needsFilePickerNotice("web", true), false);
});

test("DOM chat scroll handlers are absent on native scroll nodes", () => {
  assert.equal(usesDomChatScroll("ios"), false);
  assert.equal(usesDomChatScroll("android"), false);
  assert.equal(usesDomChatScroll("web"), true);
});
