// Fakes declared: time is the fake clock of packages/storage's tests and the store is its fake-indexeddb web store; the
// save manager (`createProjectAutosave`), the unsaved-work registry and the reload gate are the real ones. The page
// (worker, location) is a recorder.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocal } from "@jagentchill/editor-core";
import { createProjectDocument } from "@jagentchill/protocol";
import { createProjectAutosave, saveProject, type StoragePort } from "@jagentchill/storage";
import { fakeClock } from "../../../../packages/storage/test/support/clock.ts";
import { platforms } from "../../../../packages/storage/test/support/platforms.ts";
import { registerUnsaved, settleUnsaved, unsavedPending } from "./unsavedWork.ts";
import { reloadIntoUpdate, type ReloadGate } from "./webReload.ts";

const NOW = 1_800_000_000_000;
/** An open editor the way EditorScreen wires it: the leave question writes the last view change on its way. */
async function editor() {
  const port = (await platforms()[0].open()) as StoragePort, clock = fakeClock(NOW);
  const initial = createProjectDocument({ id: "p1", mainSceneId: "p1-scene", mainTrackId: "p1-track", now_ms: NOW, name: "Project" });
  await saveProject(port, initial);
  let writes = 0;
  const counted: StoragePort = { ...port, writeProjectText: async (id, text) => { writes++; await port.writeProjectText(id, text); } };
  const autosave = createProjectAutosave({ port: counted, document: initial, clock });
  clock.busy.push(() => autosave.status.state === "saving");
  let flushes = 0;
  const flushLocal = () => { flushes++; autosave.changeLocal(autosave.document); };
  const dirty = () => autosave.status.dirty || autosave.status.state !== "saved";
  const forget = registerUnsaved(() => { flushLocal(); return dirty(); }, { settle: async () => { flushLocal(); await autosave.flush(); }, pending: dirty });
  const calls: string[] = [];
  let takeover: (() => void) | null = null;
  const gate = (overrides: Partial<ReloadGate> = {}): ReloadGate => ({
    exporting: () => false, settle: settleUnsaved, unsaved: unsavedPending,
    waiting: () => ({ postMessage: (message) => { calls.push(`activate ${JSON.stringify(message)} after ${writes} write(s)`); takeover?.(); } }),
    onTakeover: (run) => { takeover = run; }, reload: () => { calls.push("reload"); },
    sleep: (ms) => clock.advance(ms), ...overrides,
  });
  const zoom = (zoomLevel: number) => autosave.changeLocal(setLocal(autosave.document, (local) => { local.timelineViewState = { zoomLevel, scrollLeft: 0, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] }; }));
  const stored = async () => JSON.parse(await port.readProjectText("p1"));
  return { autosave, clock, gate, calls, zoom, stored, forget, counts: () => ({ writes, flushes }) };
}

test("Reload right after a change: the editor's last change is written ONCE and saved, then the worker is activated and the page reloads — the save is not pushed away by the waiting", async (t) => {
  const page = await editor();
  t.after(page.forget);
  page.zoom(3);
  assert.equal(page.autosave.status.dirty, true, "the change is not saved yet");
  assert.equal(await reloadIntoUpdate(page.gate()), "reloading");
  assert.equal(page.counts().flushes, 1, "the last change was handed to the save manager once");
  assert.equal(page.counts().writes, 1);
  assert.deepEqual(page.calls, ['activate {"type":"activate"} after 1 write(s)', "reload"]);
  assert.equal((await page.stored()).local.timelineViewState.zoomLevel, 3, "the change is in the stored project");
  assert.equal(page.autosave.status.dirty, false);
});

test("Reload with work that cannot be saved: the waiting worker is NOT activated and the page does not reload", async (t) => {
  const page = await editor();
  t.after(page.forget);
  // A draft that is saved only by the person (Automations): nothing can settle it.
  const forgetDraft = registerUnsaved(() => true);
  t.after(forgetDraft);
  assert.equal(await reloadIntoUpdate(page.gate()), "unsaved");
  assert.deepEqual(page.calls, [], "the worker of this tab and of every other tab is unchanged");
});

test("Reload while an export runs: refused before anything is saved or activated", async (t) => {
  const page = await editor();
  t.after(page.forget);
  page.zoom(2);
  assert.equal(await reloadIntoUpdate(page.gate({ exporting: () => true })), "export");
  assert.deepEqual(page.calls, []);
  assert.equal(page.counts().flushes, 0);
});

test("Reload with everything saved and no waiting worker: a plain reload", async (t) => {
  const page = await editor();
  t.after(page.forget);
  assert.equal(await reloadIntoUpdate(page.gate({ waiting: () => null })), "reloading");
  assert.deepEqual(page.calls, ["reload"]);
});
