// Fakes declared: none. This runs the web store in a real Chromium (Playwright) on the browser's own IndexedDB and Origin Private File System, served by a static server started here (`test/browser/server.ts`).
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { startHarnessServer } from "./browser/server.ts";

test("Storage port and per-platform stores — Scenario: Web layout (real Chromium: IndexedDB + OPFS)", { timeout: 180_000 }, async () => {
  const served = await startHarnessServer(fileURLToPath(new URL("../../..", import.meta.url)));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${served.origin}/packages/storage/test/browser/harness.html`);
    await page.waitForFunction(() => (globalThis as { __result?: unknown }).__result !== undefined, undefined, { timeout: 120_000 });
    const result = await page.evaluate(() => (globalThis as { __result?: unknown }).__result) as Record<string, any>;
    assert.equal(result.fatal, undefined, String(result.fatal));
    assert.deepEqual(errors, []);
    assert.match(result.userAgent, /Chrome\//);

    assert.deepEqual(result.layout, { recordInIndexedDb: true, opfsFileSize: 300_000, hashMatches: true, readBack: true, range: result.layout.expectedRange, expectedRange: result.layout.expectedRange }, "the record and the asset metadata are in IndexedDB and the asset bytes are an OPFS file");
    assert.deepEqual(result.sharing, { shared: true, referencesBefore: 2, referencesAfter: 1, survivorReadable: true, opfsProjects: ["p2"], deletedDirectory: null, listed: ["p2"] }, "bytes stored once with reference count 2; deleting a project leaves no OPFS directory and the file readable from the other");
    assert.deepEqual([result.journal.patches, result.journal.check, result.journal.replayEqualsRecord], [3, { ok: true, patches: 3, revision: 3 }, true], "the journal replays to the saved record in the browser's engine");
    assert.deepEqual([result.cache.cached, result.cache.afterRebuild, result.cache.cleared, result.cache.references], [5000, 5000, 5000, 1]);
    assert.ok(typeof result.cache.available === "number" && result.cache.available > 0, "quota − usage from navigator.storage.estimate()");
    assert.deepEqual(result.package, { entries: [`project.json`, result.package.entries[1]], imported: "p2", assets: 1, media: true, name: "Second" });
    assert.match(result.package.entries[1], /^media\/[0-9a-f]{64}$/);
    assert.deepEqual([result.classicAbsent, result.noDatabaseCreatedByAsking], [false, true], "asking whether classic data exists creates no database");
    assert.deepEqual(result.classic, { present: true, imported: [["classic-1", 31]], skipped: [], schemaVersion: 32, importedFrom: { source: "opencut-classic", id: "classic-1" }, classicUnchanged: true, noClassicDatabaseAdded: true }, "the classic stores are read, never modified or created");
    assert.equal(result.persistence.persisted, result.persistence.browserSays, "the request reports what navigator.storage.persisted() says");
    assert.equal(result.persistence.dialog, null);
    assert.ok(result.persistence.persisted ? result.persistence.banner === null : result.persistence.banner === "This browser can delete your projects. Install the app or turn on sync");
    assert.match(result.persistence.preferenceInLocalStorage, /"persistRequested":true/);
    assert.deepEqual(result.reopened, { projects: ["From classic", "Second", "Three"], journal: 3 });

    // Storage unavailable: a browser mode without OPFS gets the blocking message and creates nothing.
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => { Object.defineProperty(navigator.storage, "getDirectory", { value: undefined }); });
    await blocked.goto(`${served.origin}/packages/storage/test/browser/harness.html`);
    await blocked.waitForFunction(() => (globalThis as { __result?: unknown }).__result !== undefined, undefined, { timeout: 60_000 });
    assert.match(String(((await blocked.evaluate(() => (globalThis as { __result?: unknown }).__result)) as { fatal?: string }).fatal), /Storage is not available in this browser mode/);
  } finally {
    await browser.close();
    await served.close();
  }
});
