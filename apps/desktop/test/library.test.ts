import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DESKTOP_CHANNELS, DESKTOP_CHANNEL_ARGS, DESKTOP_EVENTS, isDesktopChannel } from "@jagentchill/protocol";
import { createBridgeStorage, type LibraryBridge, type LibraryStatus } from "@jagentchill/desktop-core";
import { StorageError } from "@jagentchill/storage";
import { createFileAccess } from "../src/files.ts";
import { BridgeError, createLibraryService } from "../src/library.ts";
import { createSettings } from "../src/settings.ts";

/** The library service as the renderer reaches it: the calls of the preload bridge, with errors as replies. */
function setup(root = mkdtempSync(join(tmpdir(), "jc-library-"))) {
  const statuses: LibraryStatus[] = [];
  const settings = createSettings(join(root, "desktop.json"));
  const service = createLibraryService({ settings, defaultLibrary: join(root, "Library"), cache: join(root, "cache"), onStatus: (status) => statuses.push(status), onMoveProgress: () => undefined, onChanged: () => undefined });
  const reply = async <T>(run: () => Promise<T> | T) => { try { return { value: await run() }; } catch (error) { const e = error as BridgeError; return { error: { code: e.code ?? "INTERNAL", message: e.message, kind: e.kind, details: e.details } }; } };
  const bridge: LibraryBridge = {
    call: (method, args) => reply(() => service.call(method, args)), readRange: (method, args, range) => reply(() => service.readRange(method, args, range)),
    uploadOpen: async () => service.uploadOpen(), uploadWrite: (id, bytes) => reply(() => service.uploadWrite(id, bytes)), uploadAbort: (id) => service.uploadAbort(id), release: async (id) => service.release(id),
  };
  return { root, settings, service, statuses, bridge, storage: createBridgeStorage(bridge) };
}
const record = (id: string, name: string) => JSON.stringify({ schemaVersion: 1, metadata: { id, name, duration: 0, updated_ms: 5 }, local: {} });

test("Files on disk: a project created through the bridge is a row of library.sqlite and a readable project.json in its own folder", async () => {
  const { service, storage, root, statuses } = setup();
  await service.open();
  assert.equal(statuses.at(-1)!.state, "ready");
  await storage.writeProjectText("trip-1", record("trip-1", "Trip"));
  const file = join(root, "Library", "trip-1", "project.json");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).metadata.name, "Trip");
  assert.ok(existsSync(join(root, "Library", "library.sqlite")));
  assert.deepEqual((await storage.listProjects()).map((entry) => [entry.id, entry.name]), [["trip-1", "Trip"]]);
  assert.equal(storage.platform, "desktop");
  // Media in pieces: written through an upload, read back by ranges, hashed on the way in.
  const bytes = new Uint8Array(3 * 1024 * 1024 + 17).map((_unused, index) => index % 251);
  const written = await storage.writeMediaStream("trip-1", "a1", (async function* () { yield bytes.subarray(0, 1_500_000); yield bytes.subarray(1_500_000); })(), { extension: "mp4" });
  assert.equal(written.size, bytes.length);
  const parts: Uint8Array[] = [];
  for await (const part of storage.readMediaStream("trip-1", "a1")) parts.push(part);
  assert.deepEqual(Buffer.concat(parts).equals(Buffer.from(bytes)), true);
  const slice: Uint8Array[] = [];
  for await (const part of storage.readMediaStream("trip-1", "a1", { start: 10, end: 20 })) slice.push(part);
  assert.deepEqual([...Buffer.concat(slice)], [...bytes.subarray(10, 20)]);
  assert.equal(statSync(join(root, "Library", "trip-1", "media", "a1.mp4")).size, bytes.length);
  assert.deepEqual(readdirSync(join(root, "cache", "uploads")), []);
  // The cache lives outside the library.
  await storage.cache.put({ kind: "thumbnail", contentHash: "abc123" }, new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await storage.cache.get({ kind: "thumbnail", contentHash: "abc123" }))!], [1, 2, 3]);
  assert.equal(readdirSync(join(root, "Library")).includes("cache"), false);
  service.close();
  // It survives a restart of the app.
  const again = setup(root);
  await again.service.open();
  assert.deepEqual((await again.storage.listProjects()).map((entry) => entry.name), ["Trip"]);
  again.service.close();
});

test("Renderer has no path access: a read with a path outside the library is rejected and the store's errors keep their type", async () => {
  const { service, storage, bridge } = setup();
  await service.open();
  for (const [method, args] of [["readProjectText", ["../../../etc/hosts"]], ["readLibraryFile", ["../../etc/hosts"]], ["readFile", ["/etc/hosts"]], ["moveTo", ["/tmp/x"]]] as [string, unknown[]][]) {
    const reply = await bridge.call(method, args);
    assert.ok("error" in reply && /^LIBRARY_/.test(reply.error.code), method);
  }
  await assert.rejects(storage.readProjectText("../../../etc/hosts"), (error: unknown) => error instanceof StorageError && error.kind === "Unavailable");
  await assert.rejects(storage.readProjectText("absent"), (error: unknown) => error instanceof StorageError && error.kind === "NotFound");
  assert.ok("error" in (await bridge.readRange("readMediaStream", ["p", "a"], { start: 0, end: 64 * 1024 * 1024 })));
  service.close();
});

test("Atomic save: a write that fails leaves the previous project.json intact, no temporary file, and the renderer gets a storage error", async () => {
  const { service, storage, root } = setup();
  await service.open();
  await storage.writeProjectText("p1", record("p1", "Before"));
  const folder = join(root, "Library", "p1");
  // The volume refuses the write: the project folder is made read-only, as a full or failing volume would.
  const { chmodSync } = await import("node:fs");
  chmodSync(folder, 0o500);
  try {
    await assert.rejects(storage.writeProjectText("p1", record("p1", "After")), StorageError);
  } finally { chmodSync(folder, 0o700); }
  assert.equal(JSON.parse(readFileSync(join(folder, "project.json"), "utf8")).metadata.name, "Before");
  assert.deepEqual(readdirSync(folder).filter((name) => name.includes(".tmp")), []);
  service.close();
});

test("Library missing: a library that was used and is not there blocks with Retry, Locate library…, Create a new library here and Quit, and changes nothing", async () => {
  const first = setup();
  await first.service.open();
  await first.storage.writeProjectText("p1", record("p1", "Kept"));
  first.service.close();
  // The drive is unplugged.
  renameSync(join(first.root, "Library"), join(first.root, "Unplugged"));
  const second = setup(first.root);
  await second.service.open();
  const blocked = second.statuses.at(-1)!;
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.state === "blocked" && blocked.message, `Project library not found at ${join(first.root, "Library")}`);
  assert.deepEqual(blocked.state === "blocked" && blocked.actions.map((action) => action.label), ["Retry", "Locate library…", "Create a new library here", "Quit"]);
  assert.equal(existsSync(join(first.root, "Library")), false);
  assert.ok("error" in (await second.bridge.call("listProjects", [])));
  // "Locate library…" opens the store on the folder the user chose; nothing was lost.
  await second.service.useFolder(join(first.root, "Unplugged"));
  assert.equal(second.statuses.at(-1)!.state, "ready");
  assert.deepEqual((await second.storage.listProjects()).map((entry) => entry.name), ["Kept"]);
  assert.equal(second.settings.get("libraryPath"), join(first.root, "Unplugged"));
  second.service.close();
});

test("Rebuilding library index…: a project folder copied in while the app was closed is listed after the index is rebuilt", async () => {
  const first = setup();
  await first.service.open();
  await first.storage.writeProjectText("p1", record("p1", "One"));
  first.service.close();
  mkdirSync(join(first.root, "Library", "p2"));
  writeFileSync(join(first.root, "Library", "p2", "project.json"), record("p2", "Copied in"));
  const second = setup(first.root);
  await second.service.open();
  assert.ok(second.statuses.some((status) => status.state === "ready" && status.rebuilding === "Rebuilding library index…"));
  assert.equal((second.statuses.at(-1) as { rebuilding: string | null }).rebuilding, null);
  assert.deepEqual((await second.storage.listProjects()).map((entry) => entry.name).sort(), ["Copied in", "One"]);
  second.service.close();
});

test("This library is open on another computer: a lock held by a live process elsewhere opens the library read-only with the banner", async () => {
  const { service, storage, root, statuses } = setup();
  mkdirSync(join(root, "Library"), { recursive: true });
  writeFileSync(join(root, "Library", "library.lock"), JSON.stringify({ host: "another-computer", pid: 1, started_ms: Date.now(), heartbeat_ms: Date.now() }));
  await service.open();
  const status = statuses.at(-1)!;
  assert.deepEqual(status.state === "ready" && [status.readOnly, status.banner], [true, "This library is open on another computer"]);
  await assert.rejects(storage.writeProjectText("p1", record("p1", "No")), StorageError);
  assert.equal(existsSync(join(root, "Library", "p1")), false);
  service.close();
});

test("The library was not moved: a move into a folder that is not empty fails, the old library stays in use; a move to an empty folder switches and removes the old copy", async () => {
  const { service, storage, root, settings } = setup();
  await service.open();
  await storage.writeProjectText("p1", record("p1", "Movable"));
  mkdirSync(join(root, "Busy"));
  writeFileSync(join(root, "Busy", "other.txt"), "x");
  const refused = await service.move(join(root, "Busy"));
  assert.deepEqual([refused.moved, !refused.moved && refused.message], [false, "The library was not moved"]);
  assert.deepEqual((await storage.listProjects()).map((entry) => entry.name), ["Movable"]);
  assert.equal(settings.get("libraryPath"), join(root, "Library"));
  const moved = await service.move(join(root, "Elsewhere"));
  assert.equal(moved.moved, true);
  assert.equal(settings.get("libraryPath"), join(root, "Elsewhere"));
  assert.equal(JSON.parse(readFileSync(join(root, "Elsewhere", "p1", "project.json"), "utf8")).metadata.name, "Movable");
  assert.equal(existsSync(join(root, "Library", "p1")), false);
  // The same bridge now reaches the new folder.
  await storage.writeProjectText("p2", record("p2", "After the move"));
  assert.ok(existsSync(join(root, "Elsewhere", "p2", "project.json")));
  service.close();
});

test("Path outside granted locations: a file the user did not select has no token and cannot be read", async () => {
  const root = mkdtempSync(join(tmpdir(), "jc-files-"));
  const access = createFileAccess({ settings: createSettings(join(root, "desktop.json")) });
  await assert.rejects(access.read("0".repeat(32), { start: 0, end: 10 }), (error: unknown) => error instanceof BridgeError && error.code === "PERMISSION_DENIED");
  assert.throws(() => access.pathOf("/etc/hosts"), BridgeError);
  writeFileSync(join(root, "chosen.txt"), "hello world");
  const handle = access.register(join(root, "chosen.txt"));
  assert.match(handle.token, /^[0-9a-f]{32}$/);
  assert.equal(Buffer.from(await access.read(handle.token, { start: 6, end: 11 })).toString(), "world");
  assert.equal(access.register(join(root, "chosen.txt")).token, handle.token);
  access.remember("export", join(root, "chosen.txt"));
  assert.equal(access.lastDirectory("export"), root);
  assert.equal(access.lastDirectory("import-media"), undefined);
});

test("Export to disk: out.mp4.part grows during the export and is renamed on completion. Cancel export: the .part file is deleted and no out.mp4 exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "jc-export-"));
  const access = createFileAccess({ settings: createSettings(join(root, "desktop.json")) });
  const target = access.register(join(root, "out.mp4"));
  const opened = await access.exportOpen(target.token, 1024);
  assert.equal(opened.lowSpace, false);
  await access.exportWrite(target.token, new Uint8Array(1000).fill(1));
  assert.equal(statSync(join(root, "out.mp4.part")).size, 1000);
  await access.exportWrite(target.token, new Uint8Array(500).fill(2));
  assert.equal(statSync(join(root, "out.mp4.part")).size, 1500);
  assert.equal(existsSync(join(root, "out.mp4")), false);
  const done = await access.exportFinish(target.token);
  assert.deepEqual([done.size, existsSync(join(root, "out.mp4.part")), statSync(join(root, "out.mp4")).size], [1500, false, 1500]);

  const cancelled = access.register(join(root, "cancelled.mp4"));
  await access.exportOpen(cancelled.token);
  await access.exportWrite(cancelled.token, new Uint8Array(100));
  await access.exportAbort(cancelled.token);
  assert.deepEqual([existsSync(join(root, "cancelled.mp4.part")), existsSync(join(root, "cancelled.mp4"))], [false, false]);
  // Less free space than the estimate plus 500 MiB is reported before the export starts.
  const huge = access.register(join(root, "huge.mp4"));
  assert.equal((await access.exportOpen(huge.token, Number.MAX_SAFE_INTEGER - 600 * 1024 * 1024)).lowSpace, true);
  await access.exportAbort(huge.token);
});

test("Unknown channel: the allowlist is closed — every channel has an argument schema, and arguments that do not parse are rejected", () => {
  assert.deepEqual(Object.keys(DESKTOP_CHANNEL_ARGS).sort(), [...DESKTOP_CHANNELS].sort());
  assert.equal(new Set([...DESKTOP_CHANNELS, ...DESKTOP_EVENTS]).size, DESKTOP_CHANNELS.length + new Set(DESKTOP_EVENTS.filter((event) => !(DESKTOP_CHANNELS as readonly string[]).includes(event))).size);
  for (const name of ["fs.readFile", "shell.exec", "invoke", "send", "require", "process", "device.exportKey", "device.signRaw"]) assert.equal(isDesktopChannel(name), false, name);
  const rejects = (channel: keyof typeof DESKTOP_CHANNEL_ARGS, args: unknown[]) => assert.equal(DESKTOP_CHANNEL_ARGS[channel].safeParse(args).success, false, `${channel} ${JSON.stringify(args)}`);
  rejects("files.read", ["/etc/hosts", { start: 0, end: 10 }]);
  rejects("files.reveal", ["/etc"]);
  rejects("window.new", ["https://example.com"]);
  rejects("secureStore.get", ["../device.key"]);
  rejects("secureStore.set", ["host/x/../y", "v"]);
  rejects("gateway.setNetworkAccess", [{ level: "public" }]);
  rejects("files.saveDialog", [{ purpose: "export", defaultName: "../../x.mp4" }]);
  rejects("app.quit", ["extra"]);
  rejects("device.sign", []);
  assert.equal(DESKTOP_CHANNEL_ARGS["files.read"].safeParse(["0".repeat(32), { start: 0, end: 10 }]).success, true);
});
