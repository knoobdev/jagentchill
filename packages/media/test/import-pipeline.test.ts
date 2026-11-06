// Storage is an in-memory stand-in for the platform store (OPFS / disk / app files cannot run in this process); the
// pipeline, hashing, type detection, probing of real generated files and the document commands are the real code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize } from "@jagentchill/editor-core";
import { projectDocumentSchema, type LocalAsset, type ProjectDocument } from "@jagentchill/protocol";
import {
  NO_FILTERS, DEFAULT_SORT, bytesSource, documentLibrary, importFiles, importPercent, importProgressMessage, isExternalFileDrag, isMediaMime, listLibrary, localAssetOf, message, pasteImportApplies,
  pastedImageName, preselectedImportMode, probeMedia, provenance, sha256Hex, storageFooter, thumbnailSize,
  type BackgroundJob, type Detected, type ImportFile, type ImportHost, type ImportNotice, type ImportProgress, type ProbeResult, type Thumbnail,
} from "../src/index.ts";
import { fixture } from "./support/fixtures.ts";
import { GIB, MIB, project, session, type TestSession } from "./support/project.ts";

const file = (name: string, mimeType = "", over: Partial<ImportFile> = {}): ImportFile => {
  const bytes = fixture(name);
  return { name, mimeType, size: bytes.length, lastModified_ms: 1_700_000_000_000, source: bytesSource(bytes), ...over };
};
/** A file of a claimed size whose content hash is supplied, as content-addressed transfers deliver it. */
const sized = (name: string, size: number, contentHash: string, like = "h264-aac.mp4"): ImportFile => ({ ...file(like), name, size, contentHash });

type Harness = {
  host: ImportHost; session: TestSession; notices: ImportNotice[]; progress: ImportProgress[]; jobs: BackgroundJob[]; probes: string[];
  stored: Map<string, { bytes: number; thumbnail: Thumbnail | null }>; device: Set<string>; available: number; trash: number; failWrites: Set<string>; yields: number; usedBytes(): number;
};
function harness(options: { available?: number; doc?: ProjectDocument; device?: Set<string>; canDecode?: (probe: ProbeResult) => boolean | null; mezzanine?: boolean } = {}): Harness {
  const editing = session(options.doc ?? project());
  const h: Harness = {
    session: editing, notices: [], progress: [], jobs: [], probes: [], stored: new Map(), device: options.device ?? new Set(), available: options.available ?? 100 * GIB, trash: 0, failWrites: new Set(), yields: 0,
    usedBytes: () => [...h.stored.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    host: undefined as unknown as ImportHost,
  };
  const RESERVE = 50 * MIB;
  h.host = {
    library: documentLibrary(editing),
    async probe(item: ImportFile, detected: Detected) {
      h.probes.push(item.name);
      const probe = await probeMedia({ name: item.name, type: detected.type, format: detected.format, source: item.source });
      return options.canDecode ? { ...probe, canDecode: options.canDecode(probe) } : probe;
    },
    // No canvas in this process: the thumbnail stand-in carries the size the real encoder would produce.
    thumbnail: async (_item, probe) => (probe.type === "audio" || probe.canDecode === false ? null : { bytes: new Uint8Array([1]), mimeType: "image/jpeg", ...thumbnailSize({ width: probe.width!, height: probe.height! }) }),
    ...(options.mezzanine ? { mezzanine: async () => ({ bytes: new Uint8Array([9]), mimeType: "image/jpeg" }) } : {}),
    storage: {
      evaluate: async (bytes) => (h.available - RESERVE >= bytes ? { allowed: true } : { allowed: false, required: bytes, available: Math.max(0, h.available - RESERVE) }),
      hasBytes: async (hash) => h.device.has(hash),
      trashBytes: async () => h.trash,
      availableAfterReserve: async () => Math.max(0, h.available - RESERVE),
      async persist(assetId, item, extras) {
        if (h.failWrites.has(item.name)) { h.stored.set(assetId, { bytes: 1, thumbnail: null }); throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" }); }
        const fresh = !item.external && !h.device.has(extras.contentHash);
        if (fresh) h.available -= item.size;
        h.device.add(extras.contentHash);
        h.stored.set(assetId, { bytes: fresh ? item.size : 0, thumbnail: extras.thumbnail });
      },
      discard: async (assetId) => { h.stored.delete(assetId); },
    },
    schedule: (job) => { h.jobs.push(job); },
    notify: (notice) => { h.notices.push(notice); },
    progress: (state) => { h.progress.push(state); },
    yield: async () => { h.yields++; },
  };
  return h;
}
const libraryNames = (doc: ProjectDocument) => listLibrary(doc, { folderId: null, query: "", filters: NO_FILTERS, sort: { key: "created", direction: "asc" } }).rows.map((row) => row.asset.name);
const texts = (h: Harness) => h.notices.map((notice) => notice.text);

test("Batch with one failure: five files with an unsupported third give four assets in order and one report", async () => {
  const h = harness();
  const result = await importFiles(h.host, [file("h264-aac.mp4"), file("alpha.png"), file("notes.docx"), file("tone.mp3"), file("vp9-opus.webm")]);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["imported", "imported", "failed", "imported", "imported"]);
  assert.deepEqual(result.imported.map((entry) => entry.name), ["h264-aac.mp4", "alpha.png", "tone.mp3", "vp9-opus.webm"]);
  assert.deepEqual(h.session.document.media.assets.map((entry) => entry.created_ms).length, 4);
  assert.deepEqual([...h.session.document.media.assets].sort((a, b) => a.created_ms - b.created_ms).map((entry) => entry.name), ["h264-aac.mp4", "alpha.png", "tone.mp3", "vp9-opus.webm"]);
  assert.deepEqual(texts(h), ["Unsupported file type: notes.docx"]);
  assert.deepEqual(result.summary.map((line) => line.text), ["4 media assets have been uploaded", "notes.docx: Unsupported file type: notes.docx"]);
  // The record carries what the pipeline measured, and the sha256 of the real bytes.
  const video = h.session.document.media.assets.find((entry) => entry.name === "h264-aac.mp4")!;
  assert.equal(video.contentHash, sha256Hex(fixture("h264-aac.mp4")));
  assert.deepEqual([video.type, video.width, video.height, video.duration, video.fps, video.hasAudio, video.videoCodec, video.audioCodec, video.container], ["video", 640, 360, 240_000, { numerator: 30, denominator: 1 }, true, "h264", "aac", "mp4"]);
  assert.deepEqual(video.provenance, { source: "imported", originalFileName: "h264-aac.mp4", attributionRequired: false, referenceAssetIds: [] });
  assert.deepEqual(localAssetOf(h.session.document, video.id).present, { original: true, proxy: false, mezzanine: false });
  // Background jobs: waveform for everything with audio, filmstrip for video.
  assert.deepEqual(h.jobs.map((job) => job.kind).sort(), ["filmstrip", "filmstrip", "waveform", "waveform", "waveform"]);
});

test("Duplicate content when storage is short: a 2 GiB file equal to an existing asset creates nothing, consumes nothing, shows no quota message and highlights the existing asset", async () => {
  const h = harness({ available: 100 * MIB + 50 * MIB });
  const hash = "d".repeat(64);
  await importFiles(h.host, [sized("big-original.mp4", 60 * MIB, hash)]);
  const existing = h.session.document.media.assets[0], availableBefore = h.available;
  h.notices.length = 0;
  const result = await importFiles(h.host, [sized("big-copy.mp4", 2 * GIB, hash)]);
  assert.deepEqual(result.outcomes, [{ file: "big-copy.mp4", status: "reused", assetId: existing.id }]);
  assert.equal(h.session.document.media.assets.length, 1);
  assert.equal(h.available, availableBefore);
  assert.deepEqual(h.notices.map((notice) => [notice.text, notice.level, notice.assetId]), [["big-copy.mp4 is already in this project", "info", existing.id]]);
  assert.ok(!texts(h).some((text) => text.startsWith("Not enough storage")));
});

test("Persistence rollback: when writing the media file fails after the optimistic add, the asset disappears, no partial file remains and the quota message is shown", async () => {
  const h = harness({ available: 80 * MIB });
  h.failWrites.add("tone.mp3");
  const result = await importFiles(h.host, [file("tone.mp3"), file("alpha.png")]);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["failed", "imported"]);
  assert.deepEqual(libraryNames(h.session.document), ["alpha.png"]);
  assert.equal(h.session.rollbacks, 1);
  assert.equal(h.stored.size, 1, "the partially written file was removed");
  const size = (fixture("tone.mp3").length / 1024).toFixed(1);
  assert.equal(h.notices[0].text, `Not enough storage for tone.mp3 (${size} KiB). 30.0 MiB available.`);
  assert.deepEqual(h.notices[0].actions?.map((action) => action.text), ["Manage storage"]);
  assert.ok(!h.jobs.some((job) => job.kind === "waveform"), "no job is scheduled for a rolled-back asset");
});

test("Multiple files: 3 videos and 2 images picked together appear as 5 assets in the picker's order", async () => {
  const h = harness();
  const picked = [file("h264-aac.mp4"), file("alpha.png"), file("vp9-opus.webm"), file("plain.jpg"), file("sixty.mp4")];
  await importFiles(h.host, picked);
  assert.deepEqual(libraryNames(h.session.document), picked.map((entry) => entry.name));
  assert.deepEqual(h.probes, picked.map((entry) => entry.name), "files are processed sequentially in the given order");
});

test("Picker cancelled: an empty selection changes nothing and shows no toast", async () => {
  const h = harness();
  const result = await importFiles(h.host, []);
  assert.deepEqual([result.imported.length, result.failures.length, h.notices.length, h.session.commits.length], [0, 0, 0, 0]);
});

test("Several files: 4 successful imports pass through 25, 50, 75 and 100 % and end with \"4 media assets have been uploaded\"", async () => {
  const h = harness();
  const result = await importFiles(h.host, [file("alpha.png"), file("plain.jpg"), file("tone.mp3"), file("silent.webm")]);
  assert.deepEqual(h.progress.map((state) => state.percent), [0, 25, 50, 75, 100]);
  assert.equal(result.summary[0].text, "4 media assets have been uploaded");
  // The UI yields before processing begins and between files.
  assert.equal(h.yields, 5);
  assert.equal(importPercent(1, 3), 33);
  assert.equal(importProgressMessage(false).text, "Uploading media asset(s)…");
  assert.equal(importProgressMessage(true).text, "Importing media…");
  const one = harness();
  assert.equal((await importFiles(one.host, [file("alpha.png")])).summary[0].text, "alpha.png has been uploaded");
  assert.equal((await importFiles(one.host, [file("notes.docx")])).summary[0].text, "No media assets were uploaded");
});

test("Cancel: cancelling while file 2 of 5 is processing leaves files 1 and 2 in the library and files 3–5 not imported", async () => {
  const h = harness(), controller = new AbortController();
  const probe = h.host.probe;
  h.host.probe = async (item, detected) => { if (item.name === "plain.jpg") controller.abort(); return probe(item, detected); };
  const result = await importFiles(h.host, [file("alpha.png"), file("plain.jpg"), file("tone.mp3"), file("silent.webm"), file("sixty.mp4")], { signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.deepEqual(libraryNames(h.session.document), ["alpha.png", "plain.jpg"]);
  assert.deepEqual(h.probes, ["alpha.png", "plain.jpg"]);
});

test("One file too large: a 3 GiB file that exceeds storage is refused with its size and the available space, and the 20 MiB file in the same batch is imported", async () => {
  const h = harness({ available: 1 * GIB + 50 * MIB });
  const result = await importFiles(h.host, [sized("huge.mov", 3 * GIB, "1".repeat(64)), sized("small.mp4", 20 * MIB, "2".repeat(64))]);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["failed", "imported"]);
  assert.equal(h.notices[0].text, "Not enough storage for huge.mov (3.0 GiB). 1.0 GiB available.");
  assert.equal(h.notices[0].code, "media.quota");
  assert.deepEqual(libraryNames(h.session.document), ["small.mp4"]);
});

test("Trash offered: a quota rejection while the trash holds 3 GiB offers \"Empty trash (3.0 GiB)\"", async () => {
  const h = harness({ available: 60 * MIB });
  h.trash = 3 * GIB;
  await importFiles(h.host, [sized("clip.mp4", 200 * MIB, "3".repeat(64))]);
  assert.deepEqual(h.notices[0].actions?.map((action) => action.text), ["Empty trash (3.0 GiB)", "Manage storage"]);
});

test("Low-space warning: with 300 MiB available after the reserve the footer shows the usage in the warning colour", () => {
  assert.deepEqual(storageFooter(2 * GIB, 300 * MIB), { used: "2.0 GiB", available: "300.0 MiB", warning: true });
  assert.equal(storageFooter(2 * GIB, 500 * MIB).warning, false);
  assert.equal(storageFooter(0, null).warning, false);
});

test("Probe results survive reload: a 60 fps video with audio reports 60 fps and hasAudio after the project is closed and reopened, without being probed again", async () => {
  const h = harness({ canDecode: () => true });
  await importFiles(h.host, [file("sixty.mp4", "video/mp4")]);
  assert.deepEqual(h.probes, ["sixty.mp4"]);
  // Close and reopen: the stored record (canonical document plus the device-local section) is all that is read.
  const stored = JSON.stringify(h.session.document);
  const reopened = projectDocumentSchema.parse(JSON.parse(stored)) as ProjectDocument;
  const reloaded = reopened.media.assets[0];
  assert.deepEqual(reloaded.fps, { numerator: 60, denominator: 1 });
  assert.equal(reloaded.hasAudio, true);
  assert.deepEqual([reloaded.videoCodec, reloaded.audioCodec], ["h264", "aac"]);
  const local = (JSON.parse(stored) as { local: { media: Record<string, LocalAsset> } }).local.media[reloaded.id];
  assert.deepEqual([local.canDecode, local.needsProbe], [true, false]);
  assert.deepEqual(h.probes, ["sixty.mp4"], "nothing was probed again");
});

test("Linked import: a file imported in link mode is usable after probing and adds nothing to storage usage", async () => {
  const h = harness({ available: 60 * MIB });
  const linked = { ...sized("camera-a.mp4", 4 * GIB, "4".repeat(64)), external: { path: "/Volumes/Shoot/camera-a.mp4", grantId: "grant-1", mtime_ms: 1_700_000_000_123 } };
  const result = await importFiles(h.host, [linked]);
  assert.equal(result.outcomes[0].status, "imported");
  assert.equal(h.usedBytes(), 0);
  assert.equal(h.available, 60 * MIB);
  const local = localAssetOf(h.session.document, h.session.document.media.assets[0].id);
  assert.deepEqual([local.storage, local.externalPath, local.externalGrantId, local.externalSize, local.externalMtime_ms], ["external", "/Volumes/Shoot/camera-a.mp4", "grant-1", 4 * GIB, 1_700_000_000_123]);
  // The desktop picker preselects linking when "Reference files in place" is on; web and mobile always copy.
  assert.deepEqual([preselectedImportMode("desktop"), preselectedImportMode("desktop", false), preselectedImportMode("web"), preselectedImportMode("mobile")], ["link", "copy", "copy", "copy"]);
});

test("HEVC on a browser without HEVC support, no Gateway: the asset is added with canDecode false and the toast \"Can't preview {name}\"", async () => {
  const h = harness({ canDecode: (probe) => probe.videoCodec !== "hevc" });
  const result = await importFiles(h.host, [file("phone-hevc.mp4")]);
  assert.equal(result.outcomes[0].status, "imported");
  const added = h.session.document.media.assets[0];
  assert.equal(localAssetOf(h.session.document, added.id).canDecode, false);
  assert.deepEqual(h.notices.map((notice) => [notice.text, notice.level]), [["Can't preview phone-hevc.mp4", "warning"]]);
  assert.match(message("media.codec-guidance.hevc").text, /HEVC.*H\.264 MP4/);
  // No thumbnail and no filmstrip can be made; a proxy is wanted for the undecodable codec.
  assert.equal(h.stored.get(added.id)!.thumbnail, null);
  assert.deepEqual(h.jobs.map((job) => [job.kind, "reason" in job ? job.reason : undefined]), [["waveform", undefined], ["proxy", "undecodable"]]);
});

test("HEIC dropped on the web app without a host: it is not imported and the toast names the file and suggests converting or connecting a host", async () => {
  const heic = (): ImportFile => { const bytes = Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic")]); return { name: "IMG_0007.HEIC", mimeType: "", size: bytes.length, source: bytesSource(bytes) }; };
  const h = harness();
  const result = await importFiles(h.host, [heic()]);
  assert.equal(result.outcomes[0].status, "failed");
  assert.deepEqual(texts(h), ["HEIC photos need a host to convert them. Convert IMG_0007.HEIC to JPEG or PNG, or connect a host."]);
  assert.equal(h.session.document.media.assets.length, 0);
});

test("the automatic proxy job is scheduled at import for footage whose short side exceeds 1080 px, and not for a 1080p clip", async () => {
  const h = harness({ canDecode: () => true });
  h.host.decodeTest = async () => 200;
  await importFiles(h.host, [file("uhd.webm"), file("h264-aac.mp4")]);
  assert.deepEqual(h.jobs.filter((job) => job.kind === "proxy").map((job) => "reason" in job && job.reason), ["resolution"]);
  const slow = harness({ canDecode: () => true });
  slow.host.decodeTest = async () => 21;
  await importFiles(slow.host, [file("h264-aac.mp4")]);
  assert.deepEqual(slow.jobs.filter((job) => job.kind === "proxy").map((job) => "reason" in job && job.reason), ["slow-decode"]);
});

test("Paste a screenshot: a pasted bitmap without a file name becomes the image asset \"Pasted image 1.png\"", async () => {
  const h = harness();
  const name = pastedImageName(h.session.document.media.assets.map((entry) => entry.name));
  assert.equal(name, "Pasted image 1.png");
  await importFiles(h.host, [{ ...file("alpha.png", "image/png"), name }]);
  assert.deepEqual(libraryNames(h.session.document), ["Pasted image 1.png"]);
  assert.equal(h.session.document.media.assets[0].type, "image");
  assert.equal(pastedImageName(h.session.document.media.assets.map((entry) => entry.name)), "Pasted image 2.png");
  assert.equal(isMediaMime("image/png") && isMediaMime("video/mp4") && !isMediaMime("text/plain"), true);
});

test("Paste inside a text field: a paste while a typable field has focus imports nothing; an editor clipboard entry is handled first", () => {
  assert.equal(pasteImportApplies({ targetIsTypable: true, editorClipboardHasEntry: false, mediaItemCount: 1 }), false);
  assert.equal(pasteImportApplies({ targetIsTypable: false, editorClipboardHasEntry: true, mediaItemCount: 1 }), false);
  assert.equal(pasteImportApplies({ targetIsTypable: false, editorClipboardHasEntry: false, mediaItemCount: 1 }), true);
  assert.equal(pasteImportApplies({ targetIsTypable: false, editorClipboardHasEntry: false, mediaItemCount: 0 }), false);
});

test("Internal drag ignored: a drag that originates from the timeline or the library does not show the import drop zone", () => {
  assert.equal(isExternalFileDrag({ types: ["application/x-jagentchill-element"], internal: true }), false);
  assert.equal(isExternalFileDrag({ types: ["Files"], internal: true }), false);
  assert.equal(isExternalFileDrag({ types: ["text/plain"] }), false);
  assert.equal(isExternalFileDrag({ types: ["Files"] }), true);
});

test("Drop files: dropped audio files are imported, and a dropped folder tree creates matching library folders capped at depth 4", async () => {
  const h = harness();
  await importFiles(h.host, [file("tone.mp3"), file("sine-10s.wav")]);
  assert.deepEqual(libraryNames(h.session.document), ["tone.mp3", "sine-10s.wav"]);
  const dropped = [
    { ...file("alpha.png"), relativePath: "Trip/Day 1/alpha.png" }, { ...file("plain.jpg"), relativePath: "Trip/Day 1/plain.jpg" },
    { ...file("silent.webm"), relativePath: "Trip/A/B/C/D/E/silent.webm" }, { ...file("opaque.png"), relativePath: "Trip/opaque.png" },
  ];
  await importFiles(h.host, dropped);
  const doc = h.session.document, folder = (name: string) => doc.media.folders.find((entry) => entry.name === name)!;
  const pathOf = (assetName: string) => { const names: string[] = []; for (let id = doc.media.assets.find((entry) => entry.name === assetName)!.folderId; id; id = doc.media.folders.find((entry) => entry.id === id)!.parentId) names.unshift(doc.media.folders.find((entry) => entry.id === id)!.name); return names.join("/"); };
  assert.equal(doc.media.folders.filter((entry) => entry.name === "Trip").length, 1, "the same folder is reused for every file");
  assert.equal(folder("Day 1").parentId, folder("Trip").id);
  assert.deepEqual([pathOf("alpha.png"), pathOf("plain.jpg"), pathOf("opaque.png")], ["Trip/Day 1", "Trip/Day 1", "Trip"]);
  // Deeper files are placed in the level-4 folder.
  assert.equal(pathOf("silent.webm"), "Trip/A/B/C");
});

test("Use a starter track: a bundled music track becomes one audio asset with provenance source \"bundled\" and its licence", async () => {
  const h = harness();
  const starter = { ...file("tone.mp3", "audio/mpeg"), name: "Morning Walk.mp3", provenance: provenance.bundled({ itemId: "music-calm-03", licence: "CC0-1.0", sourceUrl: "https://example.org/morning-walk" }) };
  await importFiles(h.host, [starter]);
  const added = h.session.document.media.assets[0];
  assert.deepEqual([added.type, added.provenance.source, added.provenance.itemId, added.provenance.licence, added.provenance.sourceUrl], ["audio", "bundled", "music-calm-03", "CC0-1.0", "https://example.org/morning-walk"]);
  assert.equal(added.provenance.originalFileName, undefined);
  assert.equal(listLibrary(h.session.document, { folderId: null, query: "", filters: { ...NO_FILTERS, sources: ["stock"] }, sort: DEFAULT_SORT }).rows.length, 1);
});

test("Same item in two projects: its bytes are stored once on the device and both projects hold the asset", async () => {
  const device = new Set<string>(), first = harness({ device }), second = harness({ device, available: 60 * MIB });
  const starter = () => ({ ...sized("Drum Loop.mp3", 30 * MIB, "7".repeat(64), "tone.mp3"), provenance: provenance.bundled({ itemId: "music-01", licence: "CC0-1.0", sourceUrl: "https://example.org/drum" }) });
  await importFiles(first.host, [starter()]);
  // The second project has less free space than the file needs: bytes already on the device cost no quota.
  const result = await importFiles(second.host, [starter()]);
  assert.equal(result.outcomes[0].status, "imported");
  assert.equal(first.usedBytes() + second.usedBytes(), 30 * MIB);
  assert.equal(second.session.document.media.assets.length, 1);
  assert.equal(second.notices.length, 0);
});

test("Re-render is deduplicated: rendering the same slate again reuses the existing asset by content hash", async () => {
  const h = harness();
  const slate = () => ({ ...file("opaque.png", "image/png"), name: "Shot 1.png", kind: "slate" as const, provenance: provenance.slate({ scriptId: "script-1", sceneId: "scene-1", shotId: "shot-1", versionId: "v1" }) });
  await importFiles(h.host, [slate()]);
  const second = await importFiles(h.host, [slate()]);
  assert.equal(second.outcomes[0].status, "reused");
  assert.equal(h.session.document.media.assets.length, 1);
  const only = h.session.document.media.assets[0];
  assert.equal(h.session.document.media.folders.find((entry) => entry.id === only.folderId)!.name, "Slates");
  assert.equal(only.kind, "slate");
});

test("import is an undoable command that emits a state patch", async () => {
  const h = harness();
  await importFiles(h.host, [file("alpha.png")]);
  assert.ok(h.session.commits[0].patch.length > 0);
  assert.equal(h.session.commits[0].history, true);
  const before = canonicalize({ ...h.session.document, local: undefined, metadata: undefined });
  h.session.undo();
  assert.equal(h.session.document.media.assets.length, 0);
  h.session.redo();
  assert.equal(canonicalize({ ...h.session.document, local: undefined, metadata: undefined }), before);
});
