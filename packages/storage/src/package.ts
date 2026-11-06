import { utf8, validateProjectDocument, type Registries } from "@jagentchill/editor-core";
import { splitRecord, withLocalSection } from "./autosave.ts";
import { isStorageError, StorageError } from "./errors.ts";
import { createSha256, type ByteSource, type HasherFactory } from "./hash.ts";
import type { StoragePort } from "./port.ts";
import { capacityMessage, evaluateStorageCapacity } from "./quota.ts";
import { CURRENT_SCHEMA_VERSION } from "./records.ts";
import { storageString, type StorageLocale } from "./strings.ts";
import { createZipWriter, decodeUtf8, isSafeEntryName, readZipDirectory, readZipEntry, ZipError, type ZipEntry, type ZipSink, type ZipSource } from "./zip.ts";

/** The product's file formats. No other extension is produced for these contents. */
export const FILE_FORMATS = {
  project: { extension: ".jagentchill", mime: "application/vnd.jagentchill.project+zip", container: "zip", format: "jagentchill-project", formatVersion: 1 },
  template: { extension: ".jctpl", mime: "application/vnd.jagentchill.template+zip", container: "zip", format: null, formatVersion: 1 },
  pack: { extension: ".jcpack", mime: "application/vnd.jagentchill.pack+zip", container: "zip", format: null, formatVersion: 1 },
  script: { extension: ".jcscript", mime: "application/json", container: "json", format: "jagentchill.script.file", formatVersion: 1 },
  workflow: { extension: ".jcworkflow", mime: "application/json", container: "json", format: "jagentchill.workflow.file", formatVersion: 1 },
  keys: { extension: ".jckeys", mime: "application/json", container: "json", format: "jagentchill-keybindings", formatVersion: 1 },
} as const;
export type FileFormatKind = keyof typeof FILE_FORMATS;
export type JsonFormatKind = "script" | "workflow" | "keys";

export type PackageErrorCode = "invalid" | "newer" | "no-space" | "cancelled";
/** Why a file was refused. `message` is the text shown to the user. */
export class PackageError extends Error {
  readonly code: PackageErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: PackageErrorCode, message: string, details?: Record<string, unknown>) { super(message); this.name = "PackageError"; this.code = code; this.details = details; }
}
const invalid = (locale?: StorageLocale, cause?: string) => new PackageError("invalid", storageString("invalidProjectFile", {}, locale), cause ? { cause } : undefined);
const newer = (locale?: StorageLocale) => new PackageError("newer", storageString("newerFile", {}, locale));

/** The file name of a product file: characters illegal in file names become `_`, and the one final extension is appended. */
export function packageFileName(name: string, kind: FileFormatKind): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim() || "Untitled";
  return `${base}${FILE_FORMATS[kind].extension}`;
}

/**
 * The common header rule of every format: a top-level `format` identifier and an integer `formatVersion`; a file
 * with a higher `formatVersion` than the app supports is refused with the update message.
 */
export function checkFormatHeader(value: unknown, expected: { format: string | null; formatVersion: number }, locale?: StorageLocale): { format: string; formatVersion: number } {
  const header = value as { format?: unknown; formatVersion?: unknown } | null;
  if (!header || typeof header !== "object" || typeof header.format !== "string" || !Number.isInteger(header.formatVersion) || (header.formatVersion as number) < 1) throw invalid(locale, "the file has no format header");
  if (expected.format !== null && header.format !== expected.format) throw invalid(locale, `the file is a "${header.format}", not a "${expected.format}"`);
  if ((header.formatVersion as number) > expected.formatVersion) throw newer(locale);
  return { format: header.format, formatVersion: header.formatVersion as number };
}

/**
 * Reads one of the three JSON formats. The file is recognised by its content, so a file with the earlier compound
 * name (`*.jcscript.json`, `*.jcworkflow.json`, `*.jckeys.json`) is accepted on import; such a name is never written.
 */
export function readJsonFormat<T extends Record<string, unknown>>(text: string, kind?: JsonFormatKind, locale?: StorageLocale): { kind: JsonFormatKind; value: T } {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, "")); } catch { throw invalid(locale, "the file is not JSON"); }
  const format = (value as { format?: unknown } | null)?.format;
  const found = (["script", "workflow", "keys"] as const).find((candidate) => FILE_FORMATS[candidate].format === format);
  if (!found || (kind && found !== kind)) throw invalid(locale, "the file is of another kind");
  checkFormatHeader(value, FILE_FORMATS[found], locale);
  return { kind: found, value: value as T };
}
/** Writes one of the three JSON formats: UTF-8 JSON with the format header first. */
export function writeJsonFormat(kind: JsonFormatKind, body: Record<string, unknown>): { fileName: (name: string) => string; text: string } {
  const { format, formatVersion } = FILE_FORMATS[kind];
  return { fileName: (name) => packageFileName(name, kind), text: JSON.stringify({ format, formatVersion, ...body }) };
}

export type ManifestEntry = { path: string; size: number; sha256: string };
export type PackageManifest = { format: string; formatVersion: number; entries: ManifestEntry[]; [key: string]: unknown };
export type PackageSink = ZipSink & { close(): Promise<void>; abort(): Promise<void> };
export type CancelSignal = { aborted: boolean };

/**
 * Writes a ZIP package: the entries as given, each hashed while it is streamed, and `manifest.json` listing every
 * entry with its byte size and SHA-256. A failure or a cancellation aborts the sink, which removes the partial file.
 */
export async function writePackage(sink: PackageSink, header: Record<string, unknown> & { format: string; formatVersion: number }, entries: AsyncIterable<{ path: string; data: Uint8Array | ByteSource; size?: number }> | Iterable<{ path: string; data: Uint8Array | ByteSource; size?: number }>, options: { signal?: CancelSignal; hasher?: HasherFactory; onEntry?: (entry: ManifestEntry) => void; manifest?: (entries: ManifestEntry[]) => Record<string, unknown> } = {}): Promise<{ manifest: PackageManifest; bytes: number }> {
  const zip = createZipWriter(sink), listed: ManifestEntry[] = [], newHasher = options.hasher ?? createSha256;
  const cancelled = () => { if (options.signal?.aborted) throw new PackageError("cancelled", "the export was cancelled"); };
  try {
    for await (const entry of entries) {
      cancelled();
      const hasher = newHasher();
      const hashed = async function* (): AsyncGenerator<Uint8Array> { for await (const chunk of entry.data instanceof Uint8Array ? [entry.data] : entry.data) { cancelled(); hasher.update(chunk); yield chunk; } };
      const { size } = await zip.add(entry.path, hashed(), { size: entry.data instanceof Uint8Array ? entry.data.length : entry.size });
      const row = { path: entry.path, size, sha256: hasher.digestHex() };
      listed.push(row);
      options.onEntry?.(row);
    }
    cancelled();
    const manifest: PackageManifest = { ...header, ...(options.manifest?.(listed) ?? {}), entries: listed };
    await zip.add("manifest.json", utf8(JSON.stringify(manifest)));
    const bytes = await zip.finish();
    await sink.close();
    return { manifest, bytes };
  } catch (error) {
    await sink.abort().catch(() => undefined);
    throw error;
  }
}

export type OpenedPackage = {
  manifest: PackageManifest;
  /** The sum of the uncompressed sizes of every entry. */
  uncompressedBytes: number;
  has(path: string): boolean;
  /** The entry's bytes in pieces; size and SHA-256 are checked against the manifest when the last piece was read. */
  stream(path: string): AsyncGenerator<Uint8Array>;
  text(path: string): Promise<string>;
};
const decoder = decodeUtf8;
export async function gather(source: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of source) { length += part.length; if (length > limit) throw new ZipError("the entry is too large to be a document"); parts.push(part); }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
/** A JSON entry of a package is a document, not media: it is bounded so that a hostile archive cannot exhaust memory. */
const JSON_ENTRY_LIMIT = 128 * 1024 * 1024;

/**
 * Opens a ZIP package for reading. The archive is refused as a whole when any entry name is not a relative path
 * (`..`, an absolute path, a drive letter) or is a symbolic link, when `manifest.json` is missing or does not list
 * every entry, or when its format is not the expected one; a higher `formatVersion` is refused with the update message.
 */
export async function openPackage(source: ZipSource, expected: { format: string | null; formatVersion: number; manifestName?: string }, options: { locale?: StorageLocale; hasher?: HasherFactory } = {}): Promise<OpenedPackage> {
  const { locale } = options, manifestName = expected.manifestName ?? "manifest.json";
  let entries: ZipEntry[];
  try { entries = await readZipDirectory(source); } catch (error) { throw invalid(locale, error instanceof Error ? error.message : String(error)); }
  for (const entry of entries) if (!isSafeEntryName(entry.name) || entry.isSymlink) throw invalid(locale, `the archive has an unsafe entry "${entry.name}"`);
  const files = new Map(entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name, entry]));
  if (files.size !== entries.filter((entry) => !entry.isDirectory).length) throw invalid(locale, "the archive names an entry twice");
  const manifestEntry = files.get(manifestName);
  if (!manifestEntry) throw invalid(locale, `the archive has no ${manifestName}`);
  let manifest: PackageManifest;
  try { manifest = JSON.parse(decoder(await gather(readZipEntry(source, manifestEntry), JSON_ENTRY_LIMIT))) as PackageManifest; } catch (error) { throw invalid(locale, error instanceof Error ? error.message : String(error)); }
  checkFormatHeader(manifest, expected, locale);
  if (!Array.isArray(manifest.entries)) throw invalid(locale, "the manifest lists no entries");
  const listed = new Map<string, ManifestEntry>();
  for (const row of manifest.entries) {
    if (!row || typeof row.path !== "string" || !Number.isInteger(row.size) || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)) throw invalid(locale, "a manifest entry is malformed");
    const entry = files.get(row.path);
    if (!entry || entry.size !== row.size) throw invalid(locale, `the entry "${row.path}" does not match the manifest`);
    listed.set(row.path, row);
  }
  for (const name of files.keys()) if (name !== manifestName && !listed.has(name)) throw invalid(locale, `the entry "${name}" is not in the manifest`);
  const newHasher = options.hasher ?? createSha256;
  const stream = async function* (path: string): AsyncGenerator<Uint8Array> {
    const row = listed.get(path), entry = files.get(path);
    if (!row || !entry) throw invalid(locale, `the archive has no entry "${path}"`);
    const hasher = newHasher();
    try { for await (const chunk of readZipEntry(source, entry)) { hasher.update(chunk); yield chunk; } } catch (error) { if (error instanceof ZipError) throw invalid(locale, error.message); throw error; }
    if (hasher.digestHex() !== row.sha256) throw invalid(locale, `the entry "${path}" does not match its SHA-256`);
  };
  return {
    manifest, uncompressedBytes: [...files.values()].reduce((sum, entry) => sum + entry.size, 0),
    has: (path) => listed.has(path), stream,
    text: async (path) => decoder(await gather(stream(path), JSON_ENTRY_LIMIT)),
  };
}

// ───────────────────────────── the project package ─────────────────────────────

export type ProjectPackageMedia = { assetId: string; sha256: string; size: number; variant: "original" | "mezzanine"; name: string; external?: true };
export type ProjectPackageManifest = PackageManifest & {
  schemaVersion: number; minReaderSchemaVersion: number; appVersion: string; exported_ms: number;
  project: { id: string; name: string }; media: ProjectPackageMedia[];
};
export type ExportOptions = {
  appVersion: string; now_ms: number;
  /** "Include media" (default on): off lists the assets as external and writes no media bytes. */
  includeMedia?: boolean;
  /** The save manager of the open project: flushed first. */
  autosave?: { flush(): Promise<void> };
  /** Desktop: the bytes of an externally referenced asset, embedded when media is included. */
  externalMedia?: (assetId: string) => Promise<{ source: ByteSource; size: number; sha256?: string } | null>;
  signal?: CancelSignal; hasher?: HasherFactory; locale?: StorageLocale;
  onProgress?: (progress: { writtenBytes: number; totalBytes: number; percent: number }) => void;
};
export type ExportSummary = {
  manifest: ProjectPackageManifest; bytes: number; fileName: string;
  /** Assets whose bytes are not on this device: skipped, and listed in the completion summary. */
  offline: { assetId: string; name: string }[];
  /** Storage is full: the package holds the last saved record. */
  unsavedChangesExcluded: boolean; notice: string | null;
};
type AssetRow = { id: string; name?: string; contentHash?: string | null; size?: number };

/**
 * "Export package": one `.jagentchill` file — `manifest.json`, `project.json` (the canonical document, with no
 * `local` section), `media/<sha256>` (original bytes, stored without recompression) and the cover and thumbnail
 * images. Written by streaming. Proxies, caches, snapshots, undo history and preferences are never included.
 */
export async function exportProjectPackage(port: StoragePort, projectId: string, sink: PackageSink, options: ExportOptions): Promise<ExportSummary> {
  let unsavedChangesExcluded = false;
  try { await options.autosave?.flush(); } catch (error) {
    // `flush()` rejects after one attempt while storage is full: the export goes on with the last saved record.
    if (!isStorageError(error)) { await sink.abort().catch(() => undefined); throw error; }
    unsavedChangesExcluded = true;
  }
  const canonical = splitRecord(await port.readProjectText(projectId)).canonical;
  const document = JSON.parse(canonical) as { schemaVersion: number; minReaderSchemaVersion: number; metadata: { id: string; name: string }; media?: { assets?: AssetRow[] } };
  const includeMedia = options.includeMedia !== false, media: ProjectPackageMedia[] = [], offline: ExportSummary["offline"] = [];
  type Plan = { path: string; size: number; open: () => ByteSource };
  const plans: Plan[] = [], embedded = new Set<string>();
  for (const asset of document.media?.assets ?? []) {
    const name = asset.name ?? asset.id, info = await port.mediaInfo(projectId, asset.id);
    if (info) {
      media.push({ assetId: asset.id, sha256: info.contentHash, size: info.size, variant: "original", name, ...(includeMedia ? {} : { external: true as const }) });
      if (includeMedia && !embedded.has(info.contentHash)) { embedded.add(info.contentHash); plans.push({ path: `media/${info.contentHash}`, size: info.size, open: () => port.readMediaStream(projectId, asset.id) }); }
      continue;
    }
    const external = includeMedia ? await options.externalMedia?.(asset.id) : null;
    const sha256 = external?.sha256 ?? (typeof asset.contentHash === "string" ? asset.contentHash : null);
    if (external && sha256) {
      media.push({ assetId: asset.id, sha256, size: external.size, variant: "original", name });
      if (!embedded.has(sha256)) { embedded.add(sha256); plans.push({ path: `media/${sha256}`, size: external.size, open: () => external.source }); }
    } else if (!includeMedia && sha256) media.push({ assetId: asset.id, sha256, size: asset.size ?? 0, variant: "original", name, external: true });
    else offline.push({ assetId: asset.id, name });
  }
  const images: { path: string; data: Uint8Array }[] = [];
  for (const [kind, names, path] of [["cover", ["cover.jpg", "cover.png"], "cover"], ["thumbnail", ["project.jpg", "project.png"], "thumbnail"]] as const) {
    for (const name of names) { const bytes = await port.getBlob(kind, projectId, name); if (bytes) { images.push({ path: `${path}.${name.slice(name.lastIndexOf(".") + 1)}`, data: bytes }); break; } }
  }
  const record = utf8(canonical), totalBytes = record.length + plans.reduce((sum, plan) => sum + plan.size, 0) + images.reduce((sum, image) => sum + image.data.length, 0);
  let writtenBytes = 0;
  const progress = (bytes: number) => { writtenBytes += bytes; options.onProgress?.({ writtenBytes, totalBytes, percent: totalBytes === 0 ? 100 : Math.min(100, Math.floor((writtenBytes / totalBytes) * 100)) }); };
  const counted = async function* (source: ByteSource): AsyncGenerator<Uint8Array> { for await (const chunk of source) { progress(chunk.length); yield chunk; } };
  const entries = async function* () {
    yield { path: "project.json", data: counted([record]), size: record.length };
    for (const plan of plans) yield { path: plan.path, data: counted(plan.open()), size: plan.size };
    for (const image of images) yield { path: image.path, data: counted([image.data]), size: image.data.length };
  };
  const header = {
    format: FILE_FORMATS.project.format, formatVersion: FILE_FORMATS.project.formatVersion, schemaVersion: document.schemaVersion, minReaderSchemaVersion: document.minReaderSchemaVersion,
    appVersion: options.appVersion, exported_ms: options.now_ms, project: { id: document.metadata.id, name: document.metadata.name }, media,
  };
  const { manifest, bytes } = await writePackage(sink, header, entries(), { signal: options.signal, hasher: options.hasher });
  return { manifest: manifest as ProjectPackageManifest, bytes, fileName: packageFileName(document.metadata.name, "project"), offline, unsavedChangesExcluded, notice: unsavedChangesExcluded ? storageString("packageUnsavedExcluded", {}, options.locale) : null };
}

export type ImportOptions = {
  now_ms: number; newId: () => string;
  registries?: Registries; signal?: CancelSignal; hasher?: HasherFactory; locale?: StorageLocale;
  /** Bytes in the trash, for the "Empty trash" action of the storage message. */
  trashBytes?: number;
  onProgress?: (progress: { writtenBytes: number; totalBytes: number; percent: number }) => void;
  /** The name the imported project gets: the caller applies the duplicate-naming rule when the packaged name is taken. */
  rename?: (name: string) => string;
};
export type ImportSummary = { projectId: string; name: string; assets: number; offline: string[]; importedAsCopy: boolean };
const extensionOf = (name: string): string => { const dot = name.lastIndexOf("."); return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : ""; };

/**
 * Imports a `.jagentchill` package. Nothing is written before the archive, its manifest and the free space have been
 * checked; a cancelled or failed import removes everything it wrote.
 */
export async function importProjectPackage(port: StoragePort, source: ZipSource, options: ImportOptions): Promise<ImportSummary> {
  const { locale } = options;
  const opened = await openPackage(source, FILE_FORMATS.project, { locale, hasher: options.hasher });
  const manifest = opened.manifest as ProjectPackageManifest;
  if (!Number.isInteger(manifest.minReaderSchemaVersion) || !Array.isArray(manifest.media) || !opened.has("project.json")) throw invalid(locale, "the manifest is incomplete");
  if (manifest.minReaderSchemaVersion > CURRENT_SCHEMA_VERSION) throw newer(locale);
  // The uncompressed total is checked against the quota before anything is written.
  const space = await evaluateStorageCapacity(port, opened.uncompressedBytes, { kind: "media", evictCache: (needed) => port.cache.evict(needed) });
  if (!space.allowed) throw new PackageError("no-space", capacityMessage(String(manifest.project?.name ?? ""), space, options.trashBytes ?? 0).text, { required: space.required, available: space.available });

  let record: Record<string, unknown> & { metadata: Record<string, unknown>; media?: { assets?: AssetRow[] } };
  try { record = JSON.parse(await opened.text("project.json")) as typeof record; } catch (error) { if (error instanceof PackageError) throw error; throw invalid(locale, "project.json is not JSON"); }
  // A package never carries device-local state.
  delete (record as { local?: unknown }).local;
  const checked = validateProjectDocument(record, { mode: "strict", registries: options.registries });
  if (!checked.ok) throw invalid(locale, checked.errors.slice(0, 3).map((error) => `${error.code} at ${error.path}`).join("; "));
  const packagedId = String(record.metadata.id), importedAsCopy = await port.hasProject(packagedId);
  const projectId = importedAsCopy ? options.newId() : packagedId;
  if (importedAsCopy) record.metadata = { ...record.metadata, id: projectId };
  if (options.rename) record.metadata = { ...record.metadata, name: options.rename(String(record.metadata.name ?? "")) };

  const totalBytes = opened.uncompressedBytes, offline: string[] = [];
  let writtenBytes = 0, assets = 0;
  const cancelled = () => { if (options.signal?.aborted) throw new PackageError("cancelled", "the import was cancelled"); };
  // The store reports a failure of the stream it is fed in its own error type; the cause is kept to be reported as it is.
  let streamFailure: unknown;
  const counted = async function* (data: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    try {
      for await (const chunk of data) { cancelled(); writtenBytes += chunk.length; options.onProgress?.({ writtenBytes, totalBytes, percent: totalBytes === 0 ? 100 : Math.min(100, Math.floor((writtenBytes / totalBytes) * 100)) }); yield chunk; }
    } catch (error) { streamFailure = error; throw error; }
  };
  try {
    for (const item of manifest.media) {
      cancelled();
      if (!item || typeof item.assetId !== "string" || typeof item.sha256 !== "string") throw invalid(locale, "a media entry is malformed");
      const path = `media/${item.sha256}`;
      if (item.variant !== "original") continue;
      if (!opened.has(path)) { offline.push(item.assetId); continue; }
      const stored = await port.writeMediaStream(projectId, item.assetId, counted(opened.stream(path)), { extension: extensionOf(String(item.name ?? "")) });
      if (stored.contentHash !== item.sha256) throw invalid(locale, `the media of "${item.assetId}" does not match its SHA-256`);
      assets++;
    }
    for (const [kind, prefix, target] of [["cover", "cover", "cover"], ["thumbnail", "thumbnail", "project"]] as const) {
      for (const extension of ["jpg", "png"]) if (opened.has(`${prefix}.${extension}`)) await port.putBlob(kind, projectId, `${target}.${extension}`, await gather(counted(opened.stream(`${prefix}.${extension}`)), JSON_ENTRY_LIMIT));
    }
    cancelled();
    await port.writeProjectText(projectId, withLocalSection(JSON.stringify(record), undefined));
  } catch (error) {
    // Everything this import wrote goes: media, images, the container itself.
    await port.deleteProject(projectId).catch(() => undefined);
    if (streamFailure instanceof PackageError) throw streamFailure;
    if (error instanceof PackageError) throw error;
    if (isStorageError(error, "QuotaExceeded")) throw new PackageError("no-space", error.message);
    if (error instanceof ZipError || (error instanceof StorageError && error.kind === "Corrupt")) throw invalid(locale, error.message);
    throw error;
  }
  return { projectId, name: String(record.metadata.name ?? ""), assets, offline, importedAsCopy };
}
