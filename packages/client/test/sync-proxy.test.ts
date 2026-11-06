// Cross-device sync: proxy-first media by platform, "not uploaded yet" filling in by itself, and library items.
// The JAgentChill Server app with the system's real ffmpeg/ffprobe, the client's sync engine and the storage ports are
// real (see support/devices.ts); the source video is ffmpeg's own test pattern, made here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { blobStatus, sha256Hex, type Transfer } from "../src/index.ts";
import { startHost, until, type Device, type Editor, type Host } from "./support/devices.ts";

let host: Host, desktop: Device, phone: Device, web: Device, work: string, hd: Uint8Array;
before(async () => {
  work = mkdtempSync(join(tmpdir(), "jc-proxy-"));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "hd.mp4")]);
  hd = new Uint8Array(readFileSync(join(work, "hd.mp4")));
  host = await startHost();
  desktop = await host.device("Studio Mac", "admin", "desktop");
  phone = await host.device("Phone", "editor", "mobile");
  web = await host.device("Browser", "editor", "web");
});
after(async () => { await host.close(); rmSync(work, { recursive: true, force: true }); });

const env = (device: Device) => ({ host: device.host, signer: device.signer });
const transferOf = (device: Device, assetId: string, variant?: string) => device.engine.transfers().find((transfer: Transfer) => transfer.assetId === assetId && transfer.direction === "download" && transfer.variant === variant);
async function importVideo(editor: Editor, name: string, bytes: Uint8Array): Promise<{ assetId: string; sha256: string }> {
  const assetId = editor.device.context().newId();
  const stored = await editor.device.storage.writeMedia(editor.projectId, assetId, bytes, { extension: "mp4" });
  editor.change(`Import ${name}`, (draft) => { draft.media.assets.push({ id: assetId, name, type: "video", size: bytes.length, contentHash: stored.contentHash, created_ms: Date.now(), width: 1920, height: 1080 }); draft.media.assets.sort((x: any, y: any) => (x.id < y.id ? -1 : 1)); });
  return { assetId, sha256: stored.contentHash };
}

test("Scenario: Phone opens a desktop project — a phone and a browser download the 720p proxy the host made and no original; a desktop downloads the original", async () => {
  const id = await desktop.createProject("4K shoot"), editor = await desktop.edit(id);
  const { assetId, sha256 } = await importVideo(editor, "hd.mp4", hd);
  await editor.autosave.flush();
  await desktop.engine.enable(id);
  await until(() => desktop.engine.transfers().some((transfer) => transfer.assetId === assetId && transfer.state === "done"), "the original to be uploaded");
  // The host's media.proxy job starts when the upload completes.
  await phone.engine.fetchProject(id);
  await until(() => transferOf(phone, assetId, "preview")?.state === "done", "the phone to hold the proxy", 60_000);
  const status = await blobStatus(env(phone), sha256);
  assert.ok(status.variants.preview, "the host made the preview variant");
  assert.equal(await phone.storage.hasMedia(id, assetId), false, "no original was downloaded");
  const proxy = await phone.storage.cache.get({ kind: "proxy", contentHash: sha256, variant: "mp4" });
  assert.equal(await sha256Hex(proxy!), status.variants.preview.sha256, "the proxy in the phone's cache is the variant the host reports");
  assert.ok(proxy!.length < hd.length);
  assert.equal(phone.network.count("GET", new RegExp(`/blobs/${sha256}$`)), 0, "the original was never requested");
  assert.ok(phone.network.count("GET", new RegExp(`/blobs/${sha256}/variants/preview$`)) >= 1);
  // Thumbnails arrive too, so the media panel is populated before any proxy finishes.
  await until(async () => (await phone.storage.getBlob("thumbnail", id, `${assetId}.jpg`)) !== undefined, "the thumbnail to arrive");
  assert.equal(phone.engine.mediaState(id, assetId), undefined, "the clip is playable: nothing is waiting");

  await web.engine.fetchProject(id);
  await until(() => transferOf(web, assetId, "preview")?.state === "done", "the browser to hold the proxy", 60_000);
  assert.equal(await web.storage.hasMedia(id, assetId), false);

  // "Download original" on demand (an export above 720p needs it).
  await phone.engine.downloadOriginal(id, assetId);
  await until(async () => await phone.storage.hasMedia(id, assetId), "the original to arrive on demand", 60_000);
  assert.equal((await phone.storage.mediaInfo(id, assetId))!.contentHash, sha256);

  // A second desktop downloads originals by default.
  const other = await host.device("Edit bay", "editor", "desktop");
  await other.engine.fetchProject(id);
  await until(async () => await other.storage.hasMedia(id, assetId), "the desktop to hold the original", 60_000);
  assert.equal(transferOf(other, assetId, "preview"), undefined);
  await editor.close();
});

test("Scenario: Referenced file missing on desktop — media another device has not uploaded shows \"Not uploaded yet\" and downloads by itself once it is on the host", async () => {
  const id = await desktop.createProject("Late upload"), editor = await desktop.edit(id);
  await desktop.engine.enable(id);
  await until(() => editor.session.state.mode === "editing", "the desktop to edit");
  // The desktop's link is down for media only: the operation syncs, the bytes do not.
  desktop.network.cut = (method, url) => /\/blobs\/[0-9a-f]{64}\/(init|chunks|complete)/.test(url);
  const { assetId, sha256 } = await importVideo(editor, "late.mp4", hd.slice(0, hd.length - 1));
  await until(() => host.app.sync.documents.row({ kind: "project", id })!.head >= 2, "the asset record to sync");
  await web.engine.fetchProject(id);
  await until(() => web.engine.mediaState(id, assetId)?.state === "not-uploaded", "the browser to show Not uploaded yet");
  assert.equal((await blobStatus(env(web), sha256)).state, "absent");
  desktop.network.cut = null;
  const failed = desktop.engine.transfers().find((transfer) => transfer.assetId === assetId && transfer.direction === "upload");
  if (failed) desktop.engine.resumeTransfer(failed.id); else await desktop.engine.queueUploads(id, editor.document);
  // Nobody touches the browser: it asks the host again every few seconds.
  await until(async () => (await web.storage.hasMedia(id, assetId)) || (await web.storage.cache.has({ kind: "proxy", contentHash: sha256, variant: "mp4" })), "the media to arrive by itself", 60_000);
  assert.equal(web.engine.mediaState(id, assetId), undefined);
  await editor.close();
});

test("Scenario: Preset appears on another device, Scenario: Concurrent rename offline — \"Sync my library\" carries library records through the host; the later writer wins and the host keeps the other value", async () => {
  const io = (device: Device) => ({ read: (name: string) => device.storage.readLibrary(name as never), write: (name: string, value: unknown) => device.storage.writeLibrary(name as never, value) });
  const names = ["saved-sounds", "brand-kits", "styles", "luts"] as const;
  await desktop.storage.writeLibrary("styles", { styles: [{ id: "s1", name: "Teal and orange" }] });
  assert.deepEqual((await desktop.engine.syncLibrary(names, io(desktop))).pushed, ["styles"]);
  const received = await phone.engine.syncLibrary(names, io(phone));
  assert.deepEqual([received.pulled, received.pushed], [["styles"], []]);
  assert.deepEqual(await phone.storage.readLibrary("styles" as never), { styles: [{ id: "s1", name: "Teal and orange" }] });
  // Nothing changed: nothing travels.
  assert.deepEqual([(await desktop.engine.syncLibrary(names, io(desktop))).pushed, (await phone.engine.syncLibrary(names, io(phone))).pulled], [[], []]);
  // Both rename it without having seen the other's change; the desktop reaches the host first, the phone second.
  await desktop.storage.writeLibrary("styles", { styles: [{ id: "s1", name: "Teal (desktop)" }] });
  await phone.storage.writeLibrary("styles", { styles: [{ id: "s1", name: "Teal (phone)" }] });
  assert.deepEqual((await desktop.engine.syncLibrary(names, io(desktop))).conflicts, []);
  const second = await phone.engine.syncLibrary(names, io(phone));
  assert.deepEqual([second.pushed, second.conflicts], [["styles"], ["styles (conflict Studio Mac)"]]);
  // The desktop receives the phone's value: the last writer by the host's clock.
  assert.deepEqual((await desktop.engine.syncLibrary(names, io(desktop))).pulled, ["styles"]);
  assert.deepEqual(await desktop.storage.readLibrary("styles" as never), { styles: [{ id: "s1", name: "Teal (phone)" }] });
  const { items } = await desktop.connection!.call<any>("jagentchill.sync.library.list", {});
  assert.deepEqual(items.map((item: any) => item.name).sort(), ["styles", "styles (conflict Studio Mac)"]);
  assert.ok((await desktop.engine.librarySyncedAt())! > 0);
});
