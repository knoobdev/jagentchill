import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * A picture made small enough to SEND: its longest side at most `longest` pixels, as a JPEG encoded anew: nothing of the file's metadata
 * (EXIF, GPS position, camera, comments) is carried over. A picture a request is drawn
 * with (a character sheet, the frame before) or a model is asked to look at does not need its 1536 pixels — the
 * provider bills and the request carries every byte of it. Made by the host's ffmpeg, in memory; never stored.
 */
export const REFERENCE_LONGEST_PX = 768;
/** A picture larger than this is not read into memory to be re-encoded; nor are the pictures of one request above the total. */
export const REFERENCE_MAX_BYTES = 20 * 1_048_576;
export const REFERENCE_TOTAL_MAX_BYTES = 40 * 1_048_576;

function ffmpegPath(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.JAGENTCHILL_FFMPEG;
  if (configured) return existsSync(configured) ? configured : undefined;
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) for (const file of ["ffmpeg", "ffmpeg.exe"]) if (existsSync(join(directory, file))) return join(directory, file);
  return undefined;
}

/** The picture as a JPEG no larger than `longest` on its longest side (never enlarged); undefined when the host has no ffmpeg or it cannot read the file. */
export function smallJpeg(bytes: Uint8Array, longest = REFERENCE_LONGEST_PX, env: NodeJS.ProcessEnv = process.env): Promise<Uint8Array | undefined> {
  const tool = ffmpegPath(env);
  if (!tool) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const child = spawn(tool, ["-v", "error", "-i", "pipe:0", "-map_metadata", "-1", "-frames:v", "1", "-vf", `scale='min(${longest},iw)':'min(${longest},ih)':force_original_aspect_ratio=decrease`, "-q:v", "4", "-f", "mjpeg", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    const pieces: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (piece: Buffer) => pieces.push(piece));
    child.on("error", () => { clearTimeout(timer); resolve(undefined); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(pieces);
      resolve(code === 0 && out.length > 3 && out[0] === 0xff && out[1] === 0xd8 ? out : undefined);
    });
    // ffmpeg may stop reading before the whole file is written (a broken file): that is its exit code's story, not a crash here.
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}

/** `smallJpeg` remembered by blob id: a film sends the same few sheets with every frame it draws. */
export function createSmallPictures(read: (blobId: string) => Uint8Array, longest = REFERENCE_LONGEST_PX) {
  const kept = new Map<string, Promise<Uint8Array | undefined>>();
  return (blobId: string): Promise<Uint8Array | undefined> => {
    let found = kept.get(blobId);
    if (!found) {
      found = smallJpeg(read(blobId), longest);
      kept.set(blobId, found);
      if (kept.size > 64) kept.delete(kept.keys().next().value!);
    }
    return found;
  };
}
