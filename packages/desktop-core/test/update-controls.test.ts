import assert from "node:assert/strict";
import { test } from "node:test";
import { updateControls } from "../src/platform.ts";

test("Updates page: an install the app cannot replace gets a working download link, and only a package-manager install is told so", () => {
  // A read-only macOS or Windows install: no package manager is involved, and "Download" opens the published package.
  const readOnly = updateControls({ mode: "link", status: "available", downloadUrl: "https://updates.example.com/JAgentChill-0.2.0.dmg" });
  assert.equal(readOnly.note, null, "nothing untrue is said about a package manager");
  assert.equal(readOnly.download, "link");
  assert.equal(readOnly.autoDownload, false);
  // Without an address there is no control rather than one that cannot work.
  assert.equal(updateControls({ mode: "link", status: "available" }).download, null);
  assert.equal(updateControls({ mode: "link", status: "up-to-date", downloadUrl: "https://updates.example.com/x.dmg" }).download, null);
  // A Linux .deb / .rpm install: the package manager installs updates; the app offers no download of its own.
  const managed = updateControls({ mode: "link", status: "available", managed: true, downloadUrl: "https://updates.example.com/JAgentChill-0.2.0.AppImage" });
  assert.deepEqual(managed, { note: "package-manager", autoDownload: false, download: null, retry: false });
});

test("Updates page: builds that fetch the update themselves offer Download, and Try again after a download that failed", () => {
  assert.deepEqual(updateControls({ mode: "auto", status: "available" }), { note: null, autoDownload: true, download: "package", retry: false });
  assert.deepEqual(updateControls({ mode: "manual", status: "available" }), { note: "unsigned", autoDownload: true, download: "package", retry: false });
  assert.equal(updateControls({ mode: "manual", status: "error", reason: "download" }).retry, true);
  assert.equal(updateControls({ mode: "manual", status: "error", reason: "verification" }).retry, true);
  // A check that failed is retried with "Check now", not with a download.
  assert.equal(updateControls({ mode: "manual", status: "error", reason: "unreachable" }).retry, false);
  assert.equal(updateControls({ mode: "manual", status: "downloading" }).download, null);
  assert.deepEqual(updateControls({ mode: "off", status: "idle" }), { note: null, autoDownload: false, download: null, retry: false });
});
