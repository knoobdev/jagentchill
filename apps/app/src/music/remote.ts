import { signedRequest } from "@jagentchill/client";
import { loadSigner } from "../identity";
import { type MusicCaller, type MusicDown, type MusicProviderInfo, type ShelfAnswer, type ShelfTrack } from "./remote-search";
export { cachedMusicSearch, refreshMusicSearch, searchMusic } from "./remote-search";
export type { MusicDown, MusicProviderInfo, ShelfAnswer, ShelfTrack } from "./remote-search";

/**
 * The Music shelf's client. The catalogue is REMOTE and reached through the paired host (`jagentchill.music.*`): this
 * device ships no music and keeps none — a track's file arrives only when a person plays or adds that track.
 */
type Caller = MusicCaller;
type HostOf = Parameters<typeof signedRequest>[0]["host"];
const down = (error: unknown): MusicDown => ({ ok: false, reason: "offline", message: error instanceof Error ? error.message : String(error) });
/** One signed, one-consumer stream. The `file` promise resolves from the same bytes the preview consumed. */
export type MusicStream = { ok: true; track: ShelfTrack; mime: string; body: ReadableStream<Uint8Array>; firstByte: Promise<void>; file: Promise<File>; complete(): Promise<File>; cancel(): void } | MusicDown;
/** Opens the host pass-through for ONE track. The host stores no preview blob; this device may keep the bytes in memory so Add can reuse them. */
export async function openMusicStream(link: { connection: Caller | undefined; host: HostOf | undefined }, id: string, query?: string, knownTrack?: ShelfTrack): Promise<MusicStream> {
  const { connection, host } = link;
  if (!connection || !host) return { ok: false, reason: "no_host", message: "" };
  try {
    // Search already returned the complete shelf row and the host remembers it. Reuse it on the common ▶/+ path;
    // a template still resolves its named id (and fallback query) with one host call.
    let track = knownTrack?.id === id ? knownTrack : undefined;
    if (!track) {
      const found = await connection.call<{ ok: true; track: ShelfTrack } | MusicDown>("jagentchill.music.track", { id, ...(query ? { query } : {}) });
      if (!found.ok) return found;
      track = found.track;
    }
    const target = `/jagentchill/v1/music/stream/${encodeURIComponent(track.id)}`;
    const response = await signedRequest({ host, signer: await loadSigner() }, "GET", target);
    if (!response.ok || !response.body) return { ok: false, reason: response.status === 429 ? "rate_limited" : "offline", message: `The host answered HTTP ${response.status}.` };
    const reader = response.body.getReader(), pieces: Uint8Array[] = [];
    let finished = false, started = false, rejectFile: (error: unknown) => void = () => {}, resolveFile: (value: File) => void = () => {}, rejectFirstByte: (error: unknown) => void = () => {}, resolveFirstByte: () => void = () => {};
    const file = new Promise<File>((resolve, reject) => {
      rejectFile = reject; resolveFile = resolve;
    });
    const firstByte = new Promise<void>((resolve, reject) => { resolveFirstByte = resolve; rejectFirstByte = reject; });
    void firstByte.catch(() => undefined);
    // A stream wrapper lets MediaSource consume progressively while collecting the exact same chunks for Add.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          started = true;
          const next = await reader.read();
          if (next.done) {
            finished = true;
            rejectFirstByte(new Error("The catalogue returned an empty track."));
            const name = `${track!.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Track"}.mp3`;
            resolveFile(new File(pieces as unknown as BlobPart[], name, { type: response.headers.get("content-type") ?? "audio/mpeg" }));
            controller.close();
            return;
          }
          if (next.value.byteLength) resolveFirstByte();
          pieces.push(next.value);
          controller.enqueue(next.value);
        } catch (error) { rejectFirstByte(error); rejectFile(error); controller.error(error); }
      },
      cancel(reason) { if (!finished) { void reader.cancel(reason); rejectFirstByte(reason); rejectFile(reason); } },
    }, { highWaterMark: 0 });
    const complete = async () => {
      if (!started) { const consume = body.getReader(); for (;;) { const next = await consume.read(); if (next.done) break; } }
      return file;
    };
    return { ok: true, track, mime: response.headers.get("content-type") ?? "audio/mpeg", body, firstByte, file, complete, cancel: () => { if (!finished) { void reader.cancel(); const error = new Error("The preview was stopped."); rejectFirstByte(error); rejectFile(error); } } };
  } catch (error) { return down(error); }
}
/** Adds a starter track without playing it: consume the same guarded stream that a preview uses. */
export async function fetchMusic(link: { connection: Caller | undefined; host: HostOf | undefined }, id: string, query?: string): Promise<({ ok: true; track: ShelfTrack; file: File }) | MusicDown> {
  const stream = await openMusicStream(link, id, query);
  if (!stream.ok) return stream;
  try { return { ok: true, track: stream.track, file: await stream.complete() }; }
  catch (error) { stream.cancel(); return down(error); }
}
/** What the project records about a catalogue track: where it is from, whose it is, its licence and the credit line to publish. */
export const trackProvenance = (track: ShelfTrack) => ({ source: "stock" as const, provider: track.provider, itemId: track.id, author: track.author, licence: track.licence, licenceUrl: track.licenceUrl, sourceUrl: track.sourceUrl, attributionRequired: track.attributionRequired, credit: track.credit.slice(0, 1000) });
