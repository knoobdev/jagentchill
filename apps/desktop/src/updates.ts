import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, renameSync, createReadStream } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { compareVersions, downloadName, feedBase, feedFileName, feedFileUrl, installableFile, parseUpdateFeed, type FeedFile, type OsPlatform } from "@jagentchill/desktop-core";

/**
 * Updates for a build that cannot replace itself (an unsigned macOS app, a build run from source): the feed is read,
 * the new package is downloaded and checked against the feed's SHA-512, and it is left in a folder for the person to
 * open. Nothing is installed from here. A request carries the feed path and a random cache-busting value, nothing else.
 */
export type ManualUpdate =
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; progress: number }
  | { status: "downloaded"; version: string; file: string }
  | { status: "error"; error: string; reason: "unreachable" | "feed" | "verification" | "download" };

export type ManualUpdaterOptions = {
  feedUrl: string; platform: OsPlatform; arch: string; currentVersion: string;
  /** The folder downloaded packages are kept in. */
  dir: string;
  onState(next: ManualUpdate): void;
  log(line: string): void;
  fetch?: typeof fetch;
  /** Opens the file a download is written to (tests pass a stream that fails). */
  open?: (path: string) => Writable;
};

export const sha512Of = (path: string): Promise<string> => new Promise((done, fail) => {
  const hash = createHash("sha512");
  createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", fail).on("end", () => done(hash.digest("base64")));
});

export function createManualUpdater(options: ManualUpdaterOptions) {
  const request = options.fetch ?? fetch;
  const open = options.open ?? ((path: string): Writable => createWriteStream(path));
  const base = feedBase(options.feedUrl);
  let found: { version: string; file: FeedFile; url: string; name: string } | null = null;
  let downloading: Promise<ManualUpdate> | null = null;
  const tell = (next: ManualUpdate): ManualUpdate => { options.onState(next); return next; };
  const fail = (reason: Extract<ManualUpdate, { status: "error" }>["reason"], error: string): ManualUpdate => tell({ status: "error", reason, error });

  async function check(): Promise<ManualUpdate> {
    if (!base) return fail("feed", "The update feed address is not valid");
    let text: string;
    try {
      const response = await request(`${base}${feedFileName(options.platform, options.arch)}?noCache=${randomBytes(8).toString("hex")}`, { redirect: "error", cache: "no-store" });
      if (!response.ok) return fail("unreachable", `The update feed answered ${response.status}`);
      text = await response.text();
    } catch (error) { return fail("unreachable", error instanceof Error ? error.message : String(error)); }
    const feed = parseUpdateFeed(text);
    if (!feed) return fail("feed", "The update feed could not be read");
    const order = compareVersions(feed.version, options.currentVersion);
    if (order === null) return fail("feed", "The update feed could not be read");
    if (order <= 0) { found = null; return tell({ status: "up-to-date" }); }
    const file = installableFile(feed, options.platform);
    const url = feedFileUrl(base, file.url), name = downloadName(file.url);
    if (!url || !name) return fail("feed", "The update feed names a file that cannot be downloaded");
    found = { version: feed.version, file, url, name };
    // A package already downloaded and still matching the feed is not fetched again.
    const kept = join(options.dir, name);
    if (existsSync(kept) && (await sha512Of(kept).catch(() => "")) === file.sha512) return tell({ status: "downloaded", version: feed.version, file: kept });
    return tell({ status: "available", version: feed.version });
  }

  async function fetchPackage(target: NonNullable<typeof found>): Promise<ManualUpdate> {
    const kept = join(options.dir, target.name), part = `${kept}.part`;
    // Whatever stopped the download, the partial file does not stay; a folder that cannot even be cleaned is left as it is.
    const drop = () => { try { rmSync(part, { force: true }); } catch { /* reported by the failure that brought us here */ } };
    tell({ status: "downloading", version: target.version, progress: 0 });
    const hash = createHash("sha512");
    let received = 0;
    const stop = new AbortController();
    // Every failure of the folder or the file (no permission, disk full, a folder that cannot be made) ends here as a
    // download error the screen shows: none may escape into the main process.
    try {
      mkdirSync(options.dir, { recursive: true });
      // Only the newest package is kept.
      for (const name of readdirSync(options.dir)) if (name !== target.name) rmSync(join(options.dir, name), { recursive: true, force: true });
      const response = await request(target.url, { redirect: "error", cache: "no-store", signal: stop.signal });
      if (!response.ok || !response.body) return fail("download", `The download answered ${response.status}`);
      const total = target.file.size ?? Number(response.headers.get("content-length") ?? 0);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const out = open(part);
      // A write that fails (disk full, no permission, a device that goes away) is told by an event, at any moment —
      // also while the next piece of the download is being waited for. Every wait below races it, so a failed file
      // ends the download at once instead of leaving it pending behind a response that has stalled.
      const failure = new Promise<never>((_, broke) => { out.once("error", broke); });
      failure.catch(() => undefined);
      let shown = 0;
      try {
        for (;;) {
          const piece = await Promise.race([reader.read(), failure]);
          if (piece.done) break;
          hash.update(piece.value);
          received += piece.value.byteLength;
          if (!out.write(piece.value)) await Promise.race([new Promise<void>((drained) => out.once("drain", drained)), failure]);
          const progress = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0;
          if (progress !== shown) { shown = progress; tell({ status: "downloading", version: target.version, progress }); }
        }
        await Promise.race([new Promise<void>((closed, broke) => out.end((error?: Error | null) => (error ? broke(error) : closed()))), failure]);
      } catch (error) {
        // The response is given up (a stalled one would stay open for ever) and the file is closed before it is removed.
        stop.abort();
        void reader.cancel().catch(() => undefined);
        await new Promise<void>((closed) => { if (out.closed) closed(); else { out.once("close", closed); out.destroy(); } });
        throw error;
      }
      // The package is what the feed says it is, to the byte, or it is not kept.
      if (hash.digest("base64") !== target.file.sha512 || (target.file.size !== undefined && received !== target.file.size)) {
        drop();
        options.log(`update_verification_failed version=${target.version} file=${target.name} bytes=${received}`);
        return fail("verification", "The downloaded file did not match the published checksum and was deleted");
      }
      renameSync(part, kept);
    } catch (error) {
      drop();
      const message = error instanceof Error ? error.message : String(error);
      options.log(`update_download_failed version=${target.version} file=${target.name} error=${JSON.stringify(message)}`);
      return fail("download", message);
    }
    return tell({ status: "downloaded", version: target.version, file: kept });
  }

  return {
    check,
    /** Downloads the version the last check found. One download at a time. */
    download(): Promise<ManualUpdate> {
      if (!found) return Promise.resolve(fail("feed", "No newer version was found"));
      const target = found;
      downloading ??= fetchPackage(target).finally(() => { downloading = null; });
      return downloading;
    },
  };
}
