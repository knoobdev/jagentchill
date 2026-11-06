export const LINK_SCHEME = "jagentchill:";
export const LINK_MAX_LENGTH = 4096;
export const HELD_LINKS = 10;
export const HELD_FILES = 50;

/**
 * The check the main process makes before a link reaches the renderer: the scheme is exactly `jagentchill` and the
 * URL is at most 4,096 characters. What the link means is decided by the app's own strict parser.
 */
export function acceptDeepLink(url: unknown): { ok: true; url: string } | { ok: false; reason: "not-a-string" | "too-long" | "wrong-scheme" } {
  if (typeof url !== "string") return { ok: false, reason: "not-a-string" };
  if (url.length > LINK_MAX_LENGTH) return { ok: false, reason: "too-long" };
  if (!/^jagentchill:\/\//.test(url) || /[\u0000- ]/.test(url)) return { ok: false, reason: "wrong-scheme" };
  return { ok: true, url };
}

/**
 * Things that arrive before the renderer listens wait here in arrival order and are handed over once, when it
 * subscribes. Above the limit a new arrival is dropped and counted.
 */
export function createHeldQueue<T>(limit: number) {
  let waiting: T[] = [];
  let listener: ((item: T) => void) | null = null;
  let skipped = 0;
  return {
    get size() { return waiting.length; },
    get skipped() { return skipped; },
    push(item: T): boolean {
      if (listener) { listener(item); return true; }
      if (waiting.length >= limit) { skipped++; return false; }
      waiting.push(item);
      return true;
    },
    /** The renderer is ready: everything held is delivered, then each new arrival at once. */
    subscribe(next: (item: T) => void): () => void {
      listener = next;
      const held = waiting;
      waiting = [];
      for (const item of held) next(item);
      return () => { if (listener === next) listener = null; };
    },
    takeSkipped(): number { const count = skipped; skipped = 0; return count; },
  };
}

export type FileKind = "project-package" | "template" | "preset-pack" | "workflow" | "script" | "keys" | "fountain" | "media" | "subtitle";
/** Every product file type has one final extension; `.json` is never ours. */
export const PRODUCT_FILE_TYPES: readonly { ext: string; kind: FileKind; mime: string; name: string; default: boolean }[] = [
  { ext: "jagentchill", kind: "project-package", mime: "application/vnd.jagentchill.project+zip", name: "JAgentChill Project", default: true },
  { ext: "jctpl", kind: "template", mime: "application/vnd.jagentchill.template+zip", name: "JAgentChill Template", default: false },
  { ext: "jcpack", kind: "preset-pack", mime: "application/vnd.jagentchill.pack+zip", name: "JAgentChill Preset Pack", default: false },
  { ext: "jcworkflow", kind: "workflow", mime: "application/vnd.jagentchill.workflow+json", name: "JAgentChill Workflow", default: false },
  { ext: "jcscript", kind: "script", mime: "application/vnd.jagentchill.script+json", name: "JAgentChill Script", default: false },
  { ext: "jckeys", kind: "keys", mime: "application/vnd.jagentchill.keys+json", name: "JAgentChill Shortcuts", default: false },
  { ext: "fountain", kind: "fountain", mime: "text/vnd.fountain", name: "Fountain Screenplay", default: false },
];
export const OPEN_WITH_MEDIA: Readonly<Record<"video" | "audio" | "image" | "subtitle", readonly string[]>> = {
  video: ["mp4", "mov", "m4v", "webm", "mkv"], audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  image: ["png", "jpg", "jpeg", "webp", "gif"], subtitle: ["srt", "vtt", "ass"],
};
const extensionOf = (path: string): string => /\.([A-Za-z0-9]+)$/.exec(path.replace(/[\\/]+$/, ""))?.[1].toLowerCase() ?? "";
/** What opening a file with the app means, by its last extension; `null` for a type the app does not handle. */
export function fileKind(path: string): FileKind | null {
  const ext = extensionOf(path);
  const product = PRODUCT_FILE_TYPES.find((type) => type.ext === ext);
  if (product) return product.kind;
  if (OPEN_WITH_MEDIA.subtitle.includes(ext)) return "subtitle";
  return [...OPEN_WITH_MEDIA.video, ...OPEN_WITH_MEDIA.audio, ...OPEN_WITH_MEDIA.image].includes(ext) ? "media" : null;
}

export type LaunchTargets = { links: string[]; files: string[]; hidden: boolean; renderHost: boolean; rejected: string[] };
/**
 * What a launch (or a second launch, forwarded by the single-instance lock) asks for: `jagentchill://` links, files to
 * open, and the two mode switches. Chromium and Electron switches are ignored; so is the app path of a development run.
 */
export function launchTargets(argv: readonly string[], opts: { skip?: number; isFile(path: string): boolean }): LaunchTargets {
  const out: LaunchTargets = { links: [], files: [], hidden: false, renderHost: false, rejected: [] };
  for (const arg of argv.slice(opts.skip ?? 1)) {
    if (arg === "--hidden") out.hidden = true;
    else if (arg === "--render-host") out.renderHost = true;
    else if (arg.startsWith("-")) continue;
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) {
      const link = acceptDeepLink(arg);
      if (link.ok) out.links.push(link.url);
      else out.rejected.push(arg.slice(0, 64));
    } else if (fileKind(arg) !== null && opts.isFile(arg)) out.files.push(arg);
  }
  return out;
}

export const DROP_MAX_DEPTH = 5;
export const DROP_MAX_FILES = 2000;
export type DropEntry = { path: string; directory: boolean };
/**
 * Expands dropped files and folders: folders recursively to five levels and 2,000 files; hidden files and types the
 * app does not import are skipped and counted.
 */
export async function expandDrop(paths: readonly string[], fs: { list(directory: string): Promise<DropEntry[]>; isDirectory(path: string): Promise<boolean> }): Promise<{ files: string[]; skipped: number }> {
  const files: string[] = [];
  let skipped = 0;
  const base = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  async function visit(entry: DropEntry, depth: number): Promise<void> {
    if (base(entry.path).startsWith(".")) { skipped++; return; }
    if (entry.directory) {
      if (depth >= DROP_MAX_DEPTH) { skipped++; return; }
      const children = (await fs.list(entry.path)).sort((a, b) => a.path.localeCompare(b.path));
      for (const child of children) await visit(child, depth + 1);
      return;
    }
    const kind = fileKind(entry.path);
    if ((kind !== "media" && kind !== "subtitle") || files.length >= DROP_MAX_FILES) { skipped++; return; }
    files.push(entry.path);
  }
  for (const path of paths) await visit({ path, directory: await fs.isDirectory(path) }, 0);
  return { files, skipped };
}
export const dropSummary = (imported: number, skipped: number): string => `${imported} imported, ${skipped} skipped`;
