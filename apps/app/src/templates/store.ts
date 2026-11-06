import { template, uuidV4 } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { expectStarterMusic } from "../music/notes.ts";
import { keptBytes } from "./kept.ts";
import { FILE_FORMATS, gather, openPackage, PackageError, saveProject, trashDocument, writePackage, type CancelSignal, type PackageSink, type StoragePort, type ZipSource } from "@jagentchill/storage";

/**
 * The templates of this device. A personal template is one record (its manifest, its snapshot and the list of its
 * embedded media) plus its files under `templates/<id>/` in the library files; the starter templates the app ships
 * are listed with them and are never renamed, deleted or exported.
 */
export type TemplateMedia = { assetId: string; file: string; extension: string; size: number };
export type TemplateRecord = { name: string; manifest: template.TemplateManifest; snapshot: ProjectDocument; media: TemplateMedia[]; trash?: unknown };
export type TemplateEntry = { manifest: template.TemplateManifest; snapshot: ProjectDocument; media: TemplateMedia[]; bundled: boolean };
const TEMPLATE_FORMAT = "jagentchill-template";
import { APP_VERSION } from "../platform/build.ts";
const THUMBNAIL = "thumbnail.jpg";
const dir = (id: string): string => `templates/${id}`;

const listeners = new Set<() => void>();
/** Every list of templates on screen (the Library tab, its count, the editor's Templates tab) reads again after a change. */
export const onTemplatesChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function changed(): void { for (const listener of [...listeners]) listener(); }

export const bundledEntries = (): TemplateEntry[] => template.bundledTemplates().map((entry) => ({ ...entry, media: [], bundled: true }));
/** A stored record as a template, or `null` when it is in the trash or is not a template this build can list. */
function entryOf(record: TemplateRecord | undefined): TemplateEntry | null {
  if (!record || record.trash) return null;
  try {
    const manifest = template.readTemplateManifest(record.manifest);
    if (template.templateProblems(manifest, record.snapshot).length > 0) return null;
    return { manifest, snapshot: record.snapshot, media: Array.isArray(record.media) ? record.media : [], bundled: false };
  } catch { return null; }
}
/** My templates, newest first. */
export async function listPersonalTemplates(storage: StoragePort): Promise<TemplateEntry[]> {
  const entries: TemplateEntry[] = [];
  for (const id of await storage.listDocuments("template")) { const entry = entryOf(await storage.getDocument<TemplateRecord>("template", id)); if (entry) entries.push(entry); }
  return entries.sort((a, b) => b.manifest.created_ms - a.manifest.created_ms || a.manifest.name.localeCompare(b.manifest.name));
}
export const countTemplates = async (storage: StoragePort): Promise<number> => (await listPersonalTemplates(storage)).length + bundledEntries().length;
export async function findTemplate(storage: StoragePort | null, id: string): Promise<TemplateEntry | null> {
  return bundledEntries().find((entry) => entry.manifest.id === id) ?? (storage ? entryOf(await storage.getDocument<TemplateRecord>("template", id)) : null);
}
const put = (storage: StoragePort, entry: Omit<TemplateEntry, "bundled">): Promise<void> => storage.putDocument("template", entry.manifest.id, { name: entry.manifest.name, manifest: entry.manifest, snapshot: entry.snapshot, media: entry.media, trash: null } satisfies TemplateRecord);

/**
 * "Save as template": the built template under My templates, with the bytes of the media it embeds copied out of the
 * project and its thumbnail. The media of a slot is never read. The project is not written.
 */
export async function saveTemplate(storage: StoragePort, projectId: string, built: template.BuiltTemplate, thumbnail: Uint8Array | null): Promise<TemplateEntry> {
  const id = built.manifest.id, media: TemplateMedia[] = [];
  for (const assetId of built.embeddedAssetIds) {
    const info = await storage.mediaInfo(projectId, assetId);
    // An asset whose bytes are not on this device (offline media) stays a reference without a file.
    if (!info) continue;
    const file = `${dir(id)}/media/${assetId}${info.extension ? `.${info.extension}` : ""}`;
    await storage.writeLibraryFile(file, await storage.readMedia(projectId, assetId));
    media.push({ assetId, file, extension: info.extension, size: info.size });
  }
  if (thumbnail) await storage.writeLibraryFile(`${dir(id)}/${THUMBNAIL}`, thumbnail);
  const manifest = { ...built.manifest, thumbnail: thumbnail ? THUMBNAIL : null };
  await put(storage, { manifest, snapshot: built.snapshot, media });
  changed();
  return { manifest, snapshot: built.snapshot, media, bundled: false };
}
/** The stored picture of a template: a library file of a personal template, the static cover file of a starter (web and desktop). */
export async function thumbnailBytes(storage: StoragePort, entry: TemplateEntry): Promise<Uint8Array | undefined> {
  if (!entry.manifest.thumbnail) return undefined;
  if (!entry.bundled) return storage.readLibraryFile(`${dir(entry.manifest.id)}/${entry.manifest.thumbnail}`);
  if (typeof fetch !== "function" || typeof location === "undefined") return undefined;
  // The copy the gallery keeps comes first: a starter is copied with its cover with the network off.
  const path = `/templates/${entry.manifest.id}/${entry.manifest.thumbnail}`, jpeg = (bytes: Uint8Array | undefined) => (bytes && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : undefined);
  try {
    const kept = await keptBytes(path).catch(() => null);
    if (kept) return jpeg(new Uint8Array(kept));
    const response = await fetch(path);
    // A JPEG, not the page a single-page host answers an unknown path with.
    return jpeg(response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined);
  } catch { return undefined; }
}

/** The name a rename leaves: trimmed, single spaces, at most 80 characters; `null` when nothing is left. */
export const committedTemplateName = (draft: string): string | null => { const name = draft.trim().replace(/\s+/g, " ").slice(0, template.TEMPLATE_LIMITS.name); return name === "" ? null : name; };
/** Rename and "Edit details": the name, the category and the tags of a personal template. */
export async function updateTemplate(storage: StoragePort, entry: TemplateEntry, change: { name?: string; category?: template.TemplateCategory; tags?: string[] }): Promise<void> {
  if (entry.bundled) return;
  const manifest = template.readTemplateManifest({ ...entry.manifest, ...change, ...(change.tags ? { tags: [...new Set(change.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, template.TEMPLATE_LIMITS.tags) } : {}) });
  const snapshot = change.name ? { ...entry.snapshot, metadata: { ...entry.snapshot.metadata, name: manifest.name } } : entry.snapshot;
  await put(storage, { manifest, snapshot, media: entry.media });
  changed();
}
/** "Duplicate" / "Duplicate to My templates": an editable copy under a new id, with its own files. */
export async function duplicateTemplate(storage: StoragePort, entry: TemplateEntry, name: string): Promise<TemplateEntry> {
  const id = uuidV4(), media: TemplateMedia[] = [];
  for (const item of entry.media) {
    const bytes = await storage.readLibraryFile(item.file);
    if (!bytes) continue;
    const file = `${dir(id)}/media/${item.assetId}${item.extension ? `.${item.extension}` : ""}`;
    await storage.writeLibraryFile(file, bytes);
    media.push({ ...item, file });
  }
  // (A starter holds no file: its copy is the starter as it is, with its empty Music track.)
  const source = entry.snapshot;
  const thumbnail = await thumbnailBytes(storage, entry);
  if (thumbnail) await storage.writeLibraryFile(`${dir(id)}/${THUMBNAIL}`, thumbnail);
  const manifest = template.readTemplateManifest({ ...entry.manifest, id, name: name.slice(0, template.TEMPLATE_LIMITS.name), created_ms: Date.now(), thumbnail: thumbnail ? THUMBNAIL : null, preview: null, ...(entry.bundled ? { author: "" } : {}) });
  const snapshot = { ...source, metadata: { ...source.metadata, id, name: manifest.name }, template: source.template ? { ...source.template, templateId: id } : undefined } as ProjectDocument;
  await put(storage, { manifest, snapshot, media });
  changed();
  return { manifest, snapshot, media, bundled: false };
}
/** Delete: the template goes to the trash, restorable for 30 days. */
export async function deleteTemplate(storage: StoragePort, entry: TemplateEntry): Promise<void> {
  if (entry.bundled) return;
  await trashDocument(storage, "template", entry.manifest.id, Date.now());
  changed();
}

/**
 * "Use template": a new project, a locked template draft with every slot empty, holding the media the template
 * embeds. The template is not changed.
 */
export async function createProjectFromTemplate(storage: StoragePort, entry: TemplateEntry, name?: string): Promise<ProjectDocument> {
  const project = template.projectFromTemplate(entry.manifest, entry.snapshot, { id: uuidV4(), now_ms: Date.now(), name });
  for (const item of entry.media) {
    const bytes = await storage.readLibraryFile(item.file);
    if (bytes) await storage.writeMedia(project.metadata.id, item.assetId, bytes, { extension: item.extension });
  }
  // A starter NAMES its music (a track of the remote catalogue): nothing is shipped, so the project is made with its
  // empty Music track and a note that the track is still to be fetched — the editor does that on a connected device.
  if (entry.bundled && template.starterMusic(entry.manifest.id)) expectStarterMusic(project.metadata.id, entry.manifest.id);
  await saveProject(storage, project);
  return project;
}

// — Packages (`.jctpl`) —
export const templateFileName = (name: string): string => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || "template"}${FILE_FORMATS.template.extension}`;
/** What an export writes, for the summary shown before it: the embedded media and the total size. */
export const exportSummary = (entry: TemplateEntry): { media: number; bytes: number } => ({ media: entry.media.length, bytes: entry.media.reduce((sum, item) => sum + item.size, 0) });
/**
 * "Export package": `manifest.json` (the template manifest, with the SHA-256 and size of every file), `project.json`,
 * the embedded media under `media/` and the thumbnail under `thumbnails/`. A starter template is not exportable.
 */
export async function exportTemplatePackage(storage: StoragePort, entry: TemplateEntry, sink: PackageSink, signal?: CancelSignal): Promise<void> {
  if (entry.bundled) { await sink.abort().catch(() => undefined); throw new PackageError("invalid", "A starter template cannot be exported"); }
  const thumbnail = await thumbnailBytes(storage, entry);
  const files = async function* (): AsyncGenerator<{ path: string; data: Uint8Array }> {
    yield { path: "project.json", data: new TextEncoder().encode(JSON.stringify(entry.snapshot)) };
    for (const item of entry.media) { const bytes = await storage.readLibraryFile(item.file); if (bytes) yield { path: `media/${item.assetId}${item.extension ? `.${item.extension}` : ""}`, data: bytes }; }
    if (thumbnail) yield { path: `thumbnails/${THUMBNAIL}`, data: thumbnail };
  };
  await writePackage(sink, { format: TEMPLATE_FORMAT, formatVersion: FILE_FORMATS.template.formatVersion, appVersion: APP_VERSION, ...entry.manifest, thumbnail: thumbnail ? `thumbnails/${THUMBNAIL}` : null, preview: null }, files(), { signal });
}

export type ImportConflict = "replace" | "keep-both" | "skip";
export type TemplateImport = { status: "imported" | "replaced" | "skipped"; name: string };
const MEDIA_LIMIT = 1024 ** 3;
/**
 * Imports a `.jctpl`. Everything is checked before anything is written: the archive (safe paths, every file listed
 * with a matching size and hash), the manifest, the snapshot against the manifest, and the schema version. The files
 * are written under a staging directory and the record — what makes the template listed — is put last, so that an
 * interrupted import lists nothing. When a template with the same id exists, `onConflict` decides.
 */
export async function importTemplatePackage(storage: StoragePort, source: ZipSource, options: { onConflict(name: string): Promise<ImportConflict>; schemaVersion: number; signal?: CancelSignal }): Promise<TemplateImport> {
  let opened;
  try { opened = await openPackage(source, { format: TEMPLATE_FORMAT, formatVersion: FILE_FORMATS.template.formatVersion }); } catch (error) {
    if (error instanceof PackageError && /unsafe entry/.test(error.message)) throw new PackageError("invalid", "Package contains unsafe paths");
    throw error;
  }
  const { entries: listed, format: _format, formatVersion: _version, appVersion: _app, ...raw } = opened.manifest as Record<string, unknown> & { entries: { path: string; size: number }[] };
  let manifest: template.TemplateManifest;
  try { manifest = template.readTemplateManifest(raw); } catch (error) { throw new PackageError("invalid", error instanceof template.TemplateInvalid ? error.reason : "the template manifest is not valid"); }
  if (manifest.schemaVersion > options.schemaVersion) throw new PackageError("newer", "This template was made with a newer version of the app");
  for (const row of listed) if (!/^(project\.json|preview\.mp4|(media|fonts|thumbnails)\/[^/]+)$/.test(row.path) || template.isCodeFile(row.path)) throw new PackageError("invalid", "Package contains unsafe paths");
  if (!opened.has("project.json")) throw new PackageError("invalid", "the package has no project.json");
  let snapshot: ProjectDocument;
  try { snapshot = JSON.parse(await opened.text("project.json")) as ProjectDocument; } catch (error) { if (error instanceof PackageError) throw error; throw new PackageError("invalid", "project.json is not a project document"); }
  const problems = template.templateProblems(manifest, snapshot);
  if (problems.length > 0) throw new PackageError("invalid", problems[0]);
  // Every file is read once before anything is written: a file whose hash differs from the manifest refuses the whole package.
  const read = new Map<string, Uint8Array>();
  for (const row of listed) {
    if (row.path === "project.json") continue;
    if (options.signal?.aborted) throw new PackageError("cancelled", "the import was cancelled");
    try { read.set(row.path, await gather(opened.stream(row.path), MEDIA_LIMIT)); } catch (error) { throw new PackageError("invalid", `${row.path}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  let id = manifest.id, name = manifest.name, status: TemplateImport["status"] = "imported";
  const existing = template.isBundledTemplate(id) || (await storage.getDocument<TemplateRecord>("template", id)) !== undefined;
  if (existing) {
    const choice = template.isBundledTemplate(id) ? "keep-both" : await options.onConflict(name);
    if (choice === "skip") return { status: "skipped", name };
    if (choice === "keep-both") { id = uuidV4(); name = `${name.slice(0, template.TEMPLATE_LIMITS.name - 2)} 2`; }
    else status = "replaced";
  }
  const media: TemplateMedia[] = [];
  const thumbnail = typeof manifest.thumbnail === "string" ? read.get(manifest.thumbnail) : undefined;
  if (status === "replaced") for (const file of await storage.listLibraryFiles(dir(id))) await storage.deleteLibraryFile(file.path).catch(() => undefined);
  for (const [path, bytes] of read) {
    if (!path.startsWith("media/")) continue;
    const base = path.slice("media/".length), dot = base.lastIndexOf("."), assetId = dot > 0 ? base.slice(0, dot) : base, extension = dot > 0 ? base.slice(dot + 1) : "";
    if (!snapshot.media.assets.some((asset) => asset.id === assetId)) continue;
    const file = `${dir(id)}/media/${base}`;
    await storage.writeLibraryFile(file, bytes);
    media.push({ assetId, file, extension, size: bytes.length });
  }
  if (thumbnail) await storage.writeLibraryFile(`${dir(id)}/${THUMBNAIL}`, thumbnail);
  const stored = template.readTemplateManifest({ ...manifest, id, name, thumbnail: thumbnail ? THUMBNAIL : null, preview: null });
  await put(storage, { manifest: stored, snapshot: { ...snapshot, metadata: { ...snapshot.metadata, id, name }, ...(snapshot.template ? { template: { ...snapshot.template, templateId: id } } : {}) } as ProjectDocument, media });
  changed();
  return { status, name };
}
