import type { LocalAsset, Provenance } from "@jagentchill/protocol";
import { detectMediaType, extensionOf, SNIFF_BYTES, type Detected } from "./detect.ts";
import { hashSource, type ByteSource } from "./hash.ts";
import { message, quotaMessage, type MediaMessage } from "./messages.ts";
import { ProbeError, probeRecordFields, type ProbeResult } from "./probe.ts";
import { automaticProxyReason, type ProxyReason } from "./proxy.ts";
import type { Thumbnail } from "./thumbnail.ts";

/**
 * The one import pipeline. Every import path — picker, drop, paste, URL, recording, connector, device, stock,
 * bundled, generated, slate — hands its files to `importFiles`, which processes them one after another:
 * detect → hash (reuse on a known hash) → quota → probe → thumbnail → add and persist (roll back on failure) →
 * schedule waveform, filmstrip and proxy. One file failing never stops the rest. [PORT M-001, M-006, M-013:
 * `processMediaAssets` and `showMediaUploadToast` of OpenCut classic]
 */
export type ImportFile = {
  name: string;
  mimeType?: string;
  size: number;
  lastModified_ms?: number;
  source: ByteSource;
  /** The file as a `Blob`, where the platform has one (web, desktop): decoders read it without copying. */
  blob?: Blob;
  /** Desktop "Link to original files": the file is read in place and never copied. */
  external?: { path: string; grantId: string; mtime_ms: number };
  provenance?: Partial<Provenance> & { source: Provenance["source"] };
  /** Explicit placement; otherwise the folder the library panel shows. */
  folderId?: string | null;
  /** Path inside a dropped directory tree ("Trip/Day 1/a.mp4"): matching library folders are created. */
  relativePath?: string;
  kind?: null | "slate";
  ephemeral?: boolean;
  /** A content hash that is already known (content-addressed transfers enter the pipeline at the hashing step with it). */
  contentHash?: string;
};
export type AssetFields = Record<string, unknown> & { name: string; type: "image" | "video" | "audio"; size: number };
/** The library side: the project document. `add` is the optimistic insert; `rollback` undoes it without leaving an undo step. */
export interface ImportLibrary {
  findByHash(contentHash: string): { id: string; name: string } | undefined;
  add(fields: AssetFields, local: Partial<LocalAsset>): string;
  rollback(assetId: string): void;
  /** Creates (or finds) the folder chain under `baseFolderId` and returns the innermost folder. */
  ensureFolders?(chain: string[], baseFolderId: string | null): string | null;
  setLocal?(assetId: string, change: Partial<LocalAsset>): void;
}
export type QuotaDecision = { allowed: true } | { allowed: false; required: number; available: number };
export type BackgroundJob =
  | { kind: "waveform"; assetId: string; contentHash: string }
  | { kind: "filmstrip"; assetId: string; contentHash: string; duration: number }
  | { kind: "proxy"; assetId: string; contentHash: string; reason: ProxyReason };
export interface ImportHost {
  library: ImportLibrary;
  /** Runs off the UI thread on web and desktop (the worker client of `browser/`). */
  hash?(file: ImportFile, signal: AbortSignal): Promise<string>;
  probe(file: ImportFile, detected: Detected): Promise<ProbeResult>;
  /** `null`: no thumbnail could be made (undecodable video); the card falls back to a type icon. */
  thumbnail(file: ImportFile, probe: ProbeResult, detected: Detected): Promise<Thumbnail | null>;
  /** Average decode rate of the import decode test in frames per second, when the platform can run it. */
  decodeTest?(file: ImportFile, probe: ProbeResult): Promise<number | undefined>;
  /** Produces the decodable mezzanine of a HEIC/HEIF still; absent when this device has no producer. */
  mezzanine?(file: ImportFile, probe: ProbeResult): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  storage: {
    /** `project-storage.Quota evaluation`. */
    evaluate(bytes: number): Promise<QuotaDecision>;
    /** Bytes of this hash are already stored on the device: they are linked by reference count and cost no quota. */
    hasBytes(contentHash: string): Promise<boolean>;
    trashBytes?(): Promise<number>;
    /** Free bytes after the reserve, for the message of a quota error the store raised during a write; `null` when unknown. */
    availableAfterReserve?(): Promise<number | null>;
    /** Writes the media file (managed assets), the thumbnail and the mezzanine, then saves the record. */
    persist(assetId: string, file: ImportFile, extras: { contentHash: string; extension: string; thumbnail: Thumbnail | null; mezzanine: { bytes: Uint8Array; mimeType: string } | null }): Promise<void>;
    /** Removes whatever a failed `persist` left behind. */
    discard(assetId: string): Promise<void>;
  };
  schedule(job: BackgroundJob): void;
  notify(notice: ImportNotice): void;
  progress?(state: ImportProgress): void;
  /** Lets the UI paint between files; the first call happens before any processing. */
  yield?(): Promise<void>;
  /** The folder the library panel shows: where plain imports land. */
  currentFolderId?(): string | null;
  now?(): number;
}
export type ImportNotice = MediaMessage & { level: "info" | "warning" | "error"; fileName: string; assetId?: string; actions?: MediaMessage[] };
export type ImportProgress = { completed: number; total: number; percent: number; current: string | null };
export type ImportOutcome =
  | { file: string; status: "imported"; assetId: string }
  | { file: string; status: "reused"; assetId: string }
  | { file: string; status: "failed"; reason: MediaMessage };
export type ImportResult = {
  outcomes: ImportOutcome[];
  imported: { assetId: string; name: string }[];
  reused: { assetId: string; name: string }[];
  failures: { name: string; reason: MediaMessage }[];
  cancelled: boolean;
  /** The completion toast followed by one line per failure with its reason. */
  summary: MediaMessage[];
};

export const isQuotaError = (error: unknown): boolean => {
  const value = error as { name?: string; kind?: string; code?: string; message?: string } | null;
  return !!value && (value.kind === "QuotaExceeded" || value.name === "QuotaExceededError" || value.code === "ENOSPC" || value.code === "EDQUOT" || /quota|disk is full/i.test(value.message ?? ""));
};
/** `round(completed / total × 100)`. */
export const importPercent = (completed: number, total: number): number => (total <= 0 ? 100 : Math.round((completed / total) * 100));
/** The toast shown while importing: "Uploading media asset(s)…", or "Importing media…" on native platforms. */
export const importProgressMessage = (native: boolean): MediaMessage => message(native ? "media.import.progress.native" : "media.import.progress");
export function importSummary(imported: { name: string }[], failures: { name: string; reason: MediaMessage }[]): MediaMessage[] {
  const head = imported.length === 1 ? message("media.import.done.one", { name: imported[0].name }) : imported.length > 1 ? message("media.import.done.many", { n: imported.length }) : message("media.import.done.none");
  return [head, ...failures.map((failure) => message("media.import.failure-line", { name: failure.name, reason: failure.reason.text }))];
}
const cleanName = (name: string): string => [...(name.trim().normalize("NFC") || "Untitled")].slice(0, 255).join("");
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function importFiles(host: ImportHost, files: ImportFile[], options: { signal?: AbortSignal } = {}): Promise<ImportResult> {
  const result: ImportResult = { outcomes: [], imported: [], reused: [], failures: [], cancelled: false, summary: [] };
  const total = files.length, pause = host.yield ?? nextTask, never = new AbortController().signal;
  const fail = (file: ImportFile, reason: MediaMessage, actions?: MediaMessage[]) => {
    result.failures.push({ name: file.name, reason });
    result.outcomes.push({ file: file.name, status: "failed", reason });
    host.notify({ ...reason, level: "error", fileName: file.name, ...(actions ? { actions } : {}) });
  };
  host.progress?.({ completed: 0, total, percent: importPercent(0, total), current: files[0]?.name ?? null });
  // The first progress frame is painted before processing begins.
  await pause();
  for (let index = 0; index < files.length; index++) {
    // Cancel stops after the current file: what was imported stays, the rest is not started.
    if (options.signal?.aborted) { result.cancelled = true; break; }
    const file = files[index];
    try {
      await importOne(host, file, result, fail, options.signal ?? never);
    } catch (error) {
      fail(file, error instanceof ProbeError ? message("media.unreadable", { name: file.name }) : message("media.save-failed", { name: file.name }));
    }
    host.progress?.({ completed: index + 1, total, percent: importPercent(index + 1, total), current: files[index + 1]?.name ?? null });
    await pause();
  }
  result.summary = importSummary(result.imported, result.failures);
  return result;
}

async function importOne(host: ImportHost, file: ImportFile, result: ImportResult, fail: (file: ImportFile, reason: MediaMessage, actions?: MediaMessage[]) => void, signal: AbortSignal): Promise<void> {
  // (1) type
  const head = await file.source.read(0, Math.min(file.size, SNIFF_BYTES));
  const detected = detectMediaType({ name: file.name, mimeType: file.mimeType, head });
  if (!detected) return fail(file, message("media.unsupported-type", { name: file.name }));
  if (detected.needsMezzanine && !host.mezzanine) return fail(file, message("media.heic-needs-host", { name: file.name }));

  // (2) content hash; a hash the project already holds reuses the asset and consumes no quota
  const contentHash = file.contentHash ?? (host.hash ? await host.hash(file, signal) : await hashSource(file.source, { signal }));
  const existing = host.library.findByHash(contentHash);
  if (existing) {
    result.reused.push({ assetId: existing.id, name: existing.name });
    result.outcomes.push({ file: file.name, status: "reused", assetId: existing.id });
    host.notify({ ...message("media.already-in-project", { name: file.name }), level: "info", fileName: file.name, assetId: existing.id });
    return;
  }

  // (3) quota — skipped for external references and for bytes this device already stores under the same hash
  const managed = !file.external;
  if (managed && !(await host.storage.hasBytes(contentHash))) {
    const decision = await host.storage.evaluate(file.size);
    if (!decision.allowed) {
      const quota = quotaMessage(file.name, decision, (await host.storage.trashBytes?.()) ?? 0);
      return fail(file, quota, quota.actions);
    }
  }

  // (4) probe
  let probe: ProbeResult;
  try {
    probe = await host.probe(file, detected);
  } catch {
    return fail(file, message("media.unreadable", { name: file.name }));
  }
  let mezzanine: { bytes: Uint8Array; mimeType: string } | null = null;
  if (detected.needsMezzanine) {
    mezzanine = await host.mezzanine!(file, probe).catch(() => null);
    if (!mezzanine) return fail(file, message("media.heic-needs-host", { name: file.name }));
  }

  // (5) thumbnail; a failure falls back to the type icon and is retried when a proxy becomes available
  const thumbnail = await host.thumbnail(file, probe, detected).catch(() => null);

  // (6) optimistic add, then persist; roll back when the write fails
  const provenanceSource = file.provenance?.source ?? "imported";
  // AI-generated assets and slates are filed in their automatic folders unless a folder is given.
  const automatic = provenanceSource === "ai" || provenanceSource === "slate";
  const chain = file.relativePath && host.library.ensureFolders ? file.relativePath.split(/[\\/]+/).filter(Boolean).slice(0, -1) : [];
  const baseFolder = file.folderId !== undefined ? file.folderId : automatic ? null : host.currentFolderId?.() ?? null;
  const folderId = chain.length > 0 ? host.library.ensureFolders!(chain, baseFolder) : baseFolder;
  const provenance = { originalFileName: file.name, ...(file.provenance ?? { source: "imported" as const }) };
  if (!["imported", "connector", "device"].includes(provenance.source)) delete (provenance as { originalFileName?: string }).originalFileName;
  const name = cleanName(file.name);
  const local: Partial<LocalAsset> = {
    storage: managed ? "managed" : "external", canDecode: probe.canDecode, ...(probe.canDecodeSound !== undefined ? { canDecodeSound: probe.canDecodeSound } : {}), needsProbe: false,
    present: { original: true, proxy: false, mezzanine: mezzanine !== null },
    ...(file.external ? { externalPath: file.external.path, externalGrantId: file.external.grantId, externalSize: file.size, externalMtime_ms: file.external.mtime_ms } : {}),
  };
  const assetId = host.library.add({
    name, size: file.size, contentHash, ...probeRecordFields(probe), type: probe.type,
    ...(file.lastModified_ms !== undefined ? { lastModified_ms: file.lastModified_ms } : {}),
    ...(folderId != null ? { folderId } : {}),
    ...(file.kind ? { kind: file.kind } : {}), ...(file.ephemeral ? { ephemeral: true } : {}), provenance,
  }, local);
  try {
    await host.storage.persist(assetId, file, { contentHash, extension: extensionOf(file.name) || detected.format || "", thumbnail, mezzanine });
  } catch (error) {
    host.library.rollback(assetId);
    await host.storage.discard(assetId).catch(() => undefined);
    if (!isQuotaError(error)) return fail(file, message("media.save-failed", { name: file.name }));
    // The estimate allowed the write and the store still refused it: report what is free now.
    const available = (await host.storage.availableAfterReserve?.().catch(() => null)) ?? 0;
    const quota = quotaMessage(file.name, { required: file.size, available }, (await host.storage.trashBytes?.()) ?? 0);
    return fail(file, quota, quota.actions);
  }
  result.imported.push({ assetId, name });
  result.outcomes.push({ file: file.name, status: "imported", assetId });
  if (probe.type === "video" && probe.canDecode === false) host.notify({ ...message("media.cant-preview", { name: file.name }), level: "warning", fileName: file.name, assetId });

  // (7) background jobs: waveform summary, filmstrip and, when applicable, proxy
  if (probe.type === "audio" || (probe.type === "video" && probe.hasAudio !== false)) host.schedule({ kind: "waveform", assetId, contentHash });
  if (probe.type === "video") {
    if (probe.canDecode !== false && probe.duration) host.schedule({ kind: "filmstrip", assetId, contentHash, duration: probe.duration });
    const decodeTestFps = probe.canDecode && host.decodeTest ? await host.decodeTest(file, probe).catch(() => undefined) : undefined;
    const reason = automaticProxyReason({ ...probe, decodeTestFps });
    if (reason) host.schedule({ kind: "proxy", assetId, contentHash, reason });
  }
}

/** A pasted bitmap without a file name: "Pasted image {n}.png", n the first number the library does not use yet. */
export function pastedImageName(existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  for (let n = 1; ; n++) if (!taken.has(`Pasted image ${n}.png`)) return `Pasted image ${n}.png`;
}
/** Which clipboard or drop items the pipeline takes: files and images with a media MIME type. */
export const isMediaMime = (mimeType: string): boolean => /^(image|video|audio)\//i.test(mimeType);
/** A paste is never intercepted inside a typable field, and the editor clipboard is asked first. */
export function pasteImportApplies(context: { targetIsTypable: boolean; editorClipboardHasEntry: boolean; mediaItemCount: number }): boolean {
  return !context.targetIsTypable && !context.editorClipboardHasEntry && context.mediaItemCount > 0;
}
/** The OS drop zone reacts only to drags that carry files from outside: timeline and library drags are ignored. */
export const isExternalFileDrag = (drag: { types: readonly string[]; internal?: boolean }): boolean => !drag.internal && drag.types.includes("Files");
