import type { OsPlatform } from "./os.ts";

/**
 * The update feed as a build that cannot replace itself reads it: the static file a release publishes beside its
 * packages (`latest-mac.yml`, `latest.yml`, `latest-linux.yml` — the generic feed of electron-builder), which names
 * the version and, per package, its file, size and SHA-512. Nothing here touches the network or the disk.
 */
export type FeedFile = { url: string; sha512: string; size?: number };
export type UpdateFeed = { version: string; files: FeedFile[]; releaseDate?: string };

export const feedFileName = (platform: OsPlatform, arch: string): string =>
  platform === "darwin" ? "latest-mac.yml" : platform === "win32" ? "latest.yml" : arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";

const scalar = (text: string): string => { const value = text.trim(); return /^'.*'$|^".*"$/.test(value) ? value.slice(1, -1) : value; };
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const VERSION = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

/** Reads the feed file. `null` for anything that is not a complete feed: a version and at least one file with its hash. */
export function parseUpdateFeed(text: string): UpdateFeed | null {
  if (text.length > 64 * 1024) return null;
  const top: Record<string, string> = {};
  const files: Record<string, string>[] = [];
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s+(\w+):\s*(.*)$/.exec(line), field = /^\s+(\w+):\s*(.*)$/.exec(line), key = /^(\w+):\s*(.*)$/.exec(line);
    if (key) { inFiles = key[1] === "files" && key[2] === ""; if (!inFiles) top[key[1]] = scalar(key[2]); }
    else if (inFiles && item) files.push({ [item[1]]: scalar(item[2]) });
    else if (inFiles && field && files.length) files[files.length - 1][field[1]] = scalar(field[2]);
    else return null;
  }
  // A feed written before `files` existed names its one package at the top.
  if (files.length === 0 && top.path && top.sha512) files.push({ url: top.path, sha512: top.sha512 });
  const parsed: FeedFile[] = [];
  for (const file of files) {
    const size = file.size === undefined ? undefined : Number(file.size);
    if (!file.url || !SHA512_BASE64.test(file.sha512 ?? "") || (size !== undefined && (!Number.isSafeInteger(size) || size <= 0))) return null;
    parsed.push({ url: file.url, sha512: file.sha512, ...(size === undefined ? {} : { size }) });
  }
  // There is one release channel: a version with a pre-release label is not a release and is never offered.
  if (!VERSION.test(top.version ?? "") || parsed.length === 0) return null;
  return { version: top.version, files: parsed, ...(top.releaseDate ? { releaseDate: top.releaseDate } : {}) };
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer; `null` when either is not `x.y.z`. */
export function compareVersions(a: string, b: string): number | null {
  const left = VERSION.exec(a), right = VERSION.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) { const difference = Number(left[index]) - Number(right[index]); if (difference) return difference; }
  return 0;
}

/** The package a person opens to install the version by hand: the disk image on macOS, otherwise the feed's first file. */
export const installableFile = (feed: UpdateFeed, platform: OsPlatform): FeedFile =>
  (platform === "darwin" ? feed.files.find((file) => /\.dmg$/i.test(file.url)) : platform === "linux" ? feed.files.find((file) => /\.AppImage$/i.test(file.url)) : feed.files.find((file) => /\.exe$/i.test(file.url))) ?? feed.files[0];

const loopback = (host: string): boolean => host === "127.0.0.1" || host === "localhost" || host === "[::1]";
/** The feed address as configured: HTTPS, or plain HTTP only on this computer. `null` for anything else. */
export function feedBase(configured: string): string | null {
  try {
    const url = new URL(configured.trim());
    if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname)))) return null;
    url.search = ""; url.hash = "";
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch { return null; }
}
/** Where a file of the feed is fetched from, under the same rule as the feed itself; `null` when the feed points elsewhere. */
export function feedFileUrl(base: string, file: string): string | null {
  try { return feedBase(new URL(file, base).href)?.replace(/\/$/, "") ?? null; } catch { return null; }
}
/** The name the download is kept under: the last path segment, and only if it is a plain file name. */
export function downloadName(file: string): string | null {
  let name: string;
  try { name = decodeURIComponent(file.split(/[?#]/)[0].split("/").pop() ?? ""); } catch { return null; }
  return /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,180}$/.test(name) && !name.includes("..") ? name : null;
}
/** The address electron-builder wrote into the package (`app-update.yml`): `url: …` of a generic feed. */
export const feedUrlOfAppUpdate = (yaml: string): string | null => { const match = /^url:\s*(.+)$/m.exec(yaml); return match ? scalar(match[1]) : null; };

/**
 * Whether macOS will let this app replace itself: Squirrel.Mac only installs an update whose signature satisfies the
 * running app's own, so an unsigned or ad-hoc signed build can never apply one. Reads the text `codesign -dv` prints.
 */
export function macCanSelfUpdate(codesign: { status: number | null; output: string }): boolean {
  if (codesign.status !== 0 || /Signature=adhoc/.test(codesign.output)) return false;
  const team = /^TeamIdentifier=(.+)$/m.exec(codesign.output)?.[1].trim();
  return !!team && team !== "not set";
}
