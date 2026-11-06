import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { checkLibraryCall } from "../../desktop-core/src/library-bridge.ts";
import { createBridgeStorage } from "../../desktop-core/src/storage-client.ts";
import { mimeOf } from "../../desktop-core/src/scheme.ts";
import { createSyncEngine } from "../src/sync/engine.ts";
import { DOWNLOAD_HASH_MISMATCH_MESSAGE, downloadExtension, extensionOf } from "../src/sync/media-extension.ts";

function wavFixture(): Uint8Array {
  const data = new Uint8Array(44 + 800 * 2), view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, data.length - 8, true); data.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); data.set(new TextEncoder().encode("data"), 36); view.setUint32(40, data.length - 44, true);
  return data;
}
let screenshotRows: string[] = [];
let decodeLine = "";

test("download names infer safe media extensions through the desktop bridge and WAV bytes decode", async () => {
  const stored = new Map<string, { bytes: Uint8Array; extension: string }>(), uploads = new Map<string, Uint8Array[]>();
  let nextUpload = 0;
  const bridge = {
    async uploadOpen() { const id = String(++nextUpload).padStart(32, "0"); uploads.set(id, []); return id; },
    async uploadWrite(id: string, bytes: Uint8Array) { uploads.get(id)!.push(bytes.slice()); return { value: undefined }; },
    async uploadAbort(id: string) { uploads.delete(id); }, async release() {},
    async readRange() { return { value: new Uint8Array() }; },
    async call(method: string, args: unknown[]) {
      const check = checkLibraryCall(method, args);
      assert.deepEqual(check, { ok: true }, `desktop bridge accepts ${method}`);
      if (method === "writeMediaStream") {
        const [projectId, assetId, upload, options] = args as [string, string, { upload: string }, { extension?: string }];
        const extension = options?.extension ?? "bin", bytes = Uint8Array.from(uploads.get(upload.upload)!.flatMap((chunk) => [...chunk]));
        stored.set(`${projectId}/${assetId}`, { bytes, extension });
        uploads.delete(upload.upload);
        return { value: { contentHash: "a".repeat(64), size: bytes.length, extension } };
      }
      if (method === "mediaInfo") {
        const file = stored.get(`${args[0]}/${args[1]}`);
        return { value: file ? { assetId: args[1], contentHash: "a".repeat(64), size: file.bytes.length, extension: file.extension } : undefined };
      }
      if (method === "readMedia") return { value: stored.get(`${args[0]}/${args[1]}`)?.bytes };
      return { value: undefined };
    },
  };
  const storage = createBridgeStorage(bridge as never), wav = wavFixture(), mp3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);
  const records = [
    { name: "Bài 04 · VI · Xin chào", bytes: wav, extension: "wav" },
    { name: "Bài 05 · VI · Xin chào.", bytes: mp3, extension: "mp3" },
    { name: "voice.take words", bytes: wav, extension: "wav" },
    { name: "x.mp3", bytes: mp3, extension: "mp3" },
  ];
  const shown: string[] = [];
  for (const [index, entry] of records.entries()) {
    const extension = downloadExtension(entry.name, entry.bytes);
    assert.equal(extension, entry.extension, entry.name);
    await storage.writeMediaStream("project", `asset${index}`, [entry.bytes], { contentHash: "a".repeat(64), extension });
    const info = await storage.mediaInfo("project", `asset${index}`);
    assert.equal(info?.extension, entry.extension, `${entry.name} stored with the inferred extension`);
    assert.equal(mimeOf(`asset${index}.${info!.extension}`), entry.extension === "wav" ? "audio/wav" : "audio/mpeg");
    shown.push(`${entry.name} → .${info!.extension} · ${mimeOf(`asset${index}.${info!.extension}`)}`);
  }
  assert.equal(extensionOf("x.mp3"), "mp3", "a valid existing extension takes precedence");
  assert.equal(extensionOf("voice.take words"), "", "a dot followed by words is not treated as an extension");
  assert.equal(DOWNLOAD_HASH_MISMATCH_MESSAGE, "The downloaded file did not match its expected hash.");
  shown.push(`Transfer failure detail: ${DOWNLOAD_HASH_MISMATCH_MESSAGE}`);
  screenshotRows = shown;

  const desktopFile = await storage.readMedia("project", "asset0");
  const browser = await chromium.launch({ headless: true });
  let decoded: { sampleRate: number; duration: number };
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 360 } });
    await page.setContent(`<main><h1>Downloaded speech on desktop</h1><ul>${shown.map((item) => `<li>${item}</li>`).join("")}</ul><p id="decode">Decoding WAV fixture…</p></main><style>body{font:16px system-ui;background:#10141b;color:#edf2fa;padding:24px}li{margin:12px 0}#decode{color:#71e0b4}</style>`);
    decoded = await page.evaluate(async (base64: string) => {
      const audio = new AudioContext(), bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const result = await audio.decodeAudioData(bytes.buffer);
      await audio.close();
      return { sampleRate: result.sampleRate, duration: result.duration };
    }, Buffer.from(desktopFile!).toString("base64"));
    assert.ok(decoded.sampleRate >= 8000);
    assert.ok(Math.abs(decoded.duration - 0.1) < 0.001);
    decodeLine = `Decoded and playable: 1 channel · ${decoded.sampleRate} Hz · ${decoded.duration.toFixed(2)} s`;
  } finally { await browser.close(); }
});

test("a failed persisted download is requeued automatically when the host reconnects", async () => {
  const transfer = { id: "download:project:asset", projectId: "project", assetId: "asset", sha256: "a".repeat(64), name: "voice.wav", direction: "download", size: 4, bytes: 0, speed: 0, state: "failed", error: "bridge rejected the old extension" };
  const sessions = new Map<string, unknown>([["sync.transfers", [transfer]]]);
  const storage = {
    async getSession(key: string) { return sessions.get(key); },
    async putSession(key: string, value: unknown) { sessions.set(key, value); },
  };
  const engine = createSyncEngine({
    storage: storage as never, connection: () => ({} as never), host: () => undefined, signer: async () => ({} as never),
    deviceName: () => "Desktop", platform: "desktop", supportedSchemaVersion: { project: 1, script: 1, workflow: 1 },
    newId: () => "id", prefs: { metered: () => true },
  });
  try {
    engine.connectionChanged();
    for (let attempt = 0; attempt < 100 && engine.transfers()[0]?.state !== "waiting-wifi"; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(engine.transfers()[0]?.state, "waiting-wifi");
    assert.equal(engine.transfers()[0]?.error, undefined, "the persisted failure no longer needs a per-file Retry action");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 440 } });
      await page.setContent(`<main><h1>Downloaded speech on desktop</h1><ul>${screenshotRows.map((item) => `<li>${item}</li>`).join("")}<li>Reconnect recovery: waiting-wifi · retry not required</li></ul><p>${decodeLine}</p></main><style>body{font:16px system-ui;background:#10141b;color:#edf2fa;padding:24px}li{margin:12px 0}p{color:#71e0b4}</style>`);
      mkdirSync(".refs/apply/screenshots", { recursive: true });
      await page.screenshot({ path: join(".refs/apply/screenshots", "w20a-download-names.png"), fullPage: true });
    } finally { await browser.close(); }
  } finally { engine.dispose(); }
});
