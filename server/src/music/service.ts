// The host side of the editor's "Music" shelf. The shelf is a client of a remote catalogue: it browses and searches
// through `music.search`, and the ONE track a person plays or adds is fetched by the host through the same guarded
// download a URL import takes (https only, no address inside this machine or its networks, redirects re-checked) and
// handed to the device as a media blob. No music is shipped with the app and none is fetched before a person asks.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { MEDIA_IMPORT_MAX_REDIRECTS, type Scope } from "@jagentchill/protocol";
import type { RpcMethod } from "../channel/ws-channel.ts";
import type { RequestAuthenticator } from "../channel/request-auth.ts";
import { ProtocolError } from "../errors.ts";
import { importUrl, systemNet, vetAddress, type ImportNet } from "../tools/import.ts";
import { MUSIC_CHIPS, MusicUnavailable, orderForChip, type MusicProvider, type MusicTrack } from "./provider.ts";

/** Search answers are kept for ten minutes (the provider counts every request against the host's daily limit); a track file is never kept by this service. */
export const MUSIC_SEARCH_TTL_MS = 10 * 60_000;
/** The most a single track may weigh: longer than any song at any usual bit rate. */
export const MUSIC_TRACK_MAX_BYTES = 80 * 1024 * 1024;
/** Search can overlap DNS vetting with the person's short browse-to-play pause. The actual request still pins a
 * recently vetted public address, so a DNS change cannot redirect it to a private host. */
const MUSIC_ADDRESS_TTL_MS = 15_000;
const MUSIC_ADDRESS_WARM_ROWS = 6;
const READ: Scope = "jagentchill.projects.read";
export const MUSIC_METHOD_SCOPES = { "jagentchill.music.search": READ, "jagentchill.music.track": READ } as const;
const STREAM_ROUTE = /^\/jagentchill\/v1\/music\/stream\/([0-9a-f-]{36})$/;
const schemas = {
  search: z.object({ query: z.string().max(200).optional(), chip: z.string().max(40).optional(), page: z.number().int().min(1).max(12).optional() }).strict(),
  track: z.object({ id: z.string().min(1).max(64), query: z.string().max(200).optional() }).strict(),
};
export type MusicDeps = {
  /** In the order they are tried: the first that is ready serves the shelf. */
  providers: MusicProvider[];
  now: () => number;
  /** The network of a track download; a test serves its own bytes. */
  net?: ImportNet;
  /** Whether catalogue results may warm short lived, address vetted file hosts for lower click-to-play delay. */
  warmAddresses?: boolean;
  /** Authenticator for the signed, streaming preview route. */
  auth: RequestAuthenticator;
};
/** A row as the app gets it: everything but the address of the file, which only the host uses. */
export type ShelfTrack = Omit<MusicTrack, "fileUrl" | "fileType">;
const shelfRow = ({ fileUrl: _fileUrl, fileType: _fileType, ...row }: MusicTrack): ShelfTrack => row;
const extensionOf = (track: MusicTrack, mime: string): string => (/mpeg|mp3/.test(mime) || /^mp3/.test(track.fileType) ? "mp3" : /ogg/.test(mime) || track.fileType === "ogg" ? "ogg" : /flac/.test(mime) || track.fileType === "flac" ? "flac" : /wav/.test(mime) || track.fileType === "wav" ? "wav" : /mp4|m4a|aac/.test(mime) ? "m4a" : "mp3");
const mimeOf = (extension: string): string => ({ mp3: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac", wav: "audio/wav", m4a: "audio/mp4" })[extension] ?? "audio/mpeg";

export function createMusicService(deps: MusicDeps) {
  const searches = new Map<string, { at: number; tracks: MusicTrack[]; more: boolean }>();
  const checkedAddresses = new Map<string, { address: string; expires: number }>();
  const addressChecks = new Map<string, Promise<string>>();
  /** The rows the shelf was shown: adding one of them asks the provider nothing more. */
  const seen = new Map<string, MusicTrack>();
  const remember = (tracks: MusicTrack[]) => { for (const track of tracks) { seen.delete(track.id); seen.set(track.id, track); } while (seen.size > 2000) seen.delete(seen.keys().next().value as string); };
  const provider = (): MusicProvider | undefined => deps.providers.find((entry) => entry.ready());
  const about = (entry: MusicProvider | undefined) => (entry ? { id: entry.id, name: entry.name, notice: entry.notice, site: entry.site } : null);
  const down = (error: unknown, entry: MusicProvider | undefined) => {
    if (!(error instanceof MusicUnavailable)) throw error;
    return { ok: false as const, reason: error.reason, message: error.message, provider: about(entry), chips: MUSIC_CHIPS.map((chip) => chip.id) };
  };
  const notConnected = () => down(new MusicUnavailable("not_connected", "No music catalogue is connected on this host."), undefined);
  const net = deps.net ?? systemNet;
  const checkedAddress = (url: URL): Promise<string> => {
    const host = url.hostname.toLowerCase().replace(/\.$/, ""), cached = checkedAddresses.get(host);
    if (cached && cached.expires > deps.now()) return Promise.resolve(cached.address);
    const pending = addressChecks.get(host);
    if (pending) return pending;
    const check = vetAddress(net, url).then((address) => {
      checkedAddresses.set(host, { address, expires: deps.now() + MUSIC_ADDRESS_TTL_MS });
      while (checkedAddresses.size > 50) checkedAddresses.delete(checkedAddresses.keys().next().value as string);
      return address;
    }).finally(() => addressChecks.delete(host));
    addressChecks.set(host, check);
    return check;
  };
  const warmAddresses = (tracks: readonly MusicTrack[]) => {
    if (!deps.warmAddresses) return;
    for (const track of tracks.slice(0, MUSIC_ADDRESS_WARM_ROWS)) {
      try { void checkedAddress(importUrl(track.fileUrl)).catch(() => undefined); } catch { /* the stream route reports the URL error if selected */ }
    }
  };

  async function search(params: z.infer<typeof schemas.search>) {
    const entry = provider();
    if (!entry) return notConnected();
    const typed = (params.query ?? "").replace(/\s+/g, " ").trim(), chip = MUSIC_CHIPS.find((item) => item.id === params.chip) ?? MUSIC_CHIPS[1], page = params.page ?? 1;
    // Typed words are one query. Each chip merges a small, curated set of instrumental tag searches.
    const queries = typed ? [typed] : [...chip.queries], text = typed || chip.query, key = `${entry.id}\n${queries.join("\n").toLowerCase()}\n${page}`;
    let hit = searches.get(key);
    if (!hit || deps.now() - hit.at > MUSIC_SEARCH_TTL_MS) {
      try {
        const merged = new Map<string, MusicTrack>(); let more = false;
        for (const query of queries) {
          const answer = await entry.search({ text: query, page });
          more ||= answer.more;
          for (const track of answer.tracks) {
            if (!track.author || !track.licence || track.seconds < 45 || track.seconds > 300) continue;
            if (!merged.has(track.id)) merged.set(track.id, track);
          }
        }
        hit = { at: deps.now(), tracks: [...merged.values()], more };
      }
      catch (error) { return down(error, entry); }
      searches.set(key, hit);
      for (const [name, value] of searches) if (deps.now() - value.at > MUSIC_SEARCH_TTL_MS || searches.size > 200) searches.delete(name); else break;
      remember(hit.tracks);
    }
    const ordered = orderForChip(hit.tracks, typed ? undefined : chip.id);
    if (page === 1) warmAddresses(ordered);
    return { ok: true as const, provider: about(entry), chips: MUSIC_CHIPS.map((item) => item.id), query: text, page, more: hit.more, tracks: ordered.map(shelfRow) };
  }
  /** The track with this id; when the provider no longer has it and a fallback search is named, the first row of that search. */
  async function resolve(id: string, query?: string): Promise<MusicTrack | null> {
    const entry = provider();
    if (!entry) throw new MusicUnavailable("not_connected", "No music catalogue is connected on this host.");
    const known = seen.get(id) ?? (await entry.track(id));
    if (known) { remember([known]); return known; }
    if (!query) return null;
    const answer = await search({ query });
    if (!answer.ok) throw new MusicUnavailable(answer.reason, answer.message);
    return answer.tracks[0] ? seen.get(answer.tracks[0].id) ?? null : null;
  }
  async function track(params: z.infer<typeof schemas.track>) {
    try { const found = await resolve(params.id, params.query); return found ? { ok: true as const, provider: about(provider()), track: shelfRow(found) } : { ok: false as const, reason: "not_found" as const, message: "The catalogue no longer has this track.", provider: about(provider()) }; }
    catch (error) { return down(error, provider()); }
  }
  /** Signed pass-through for previews: the host guards the provider URL but stores no preview bytes. */
  async function route(request: { req: IncomingMessage; res: ServerResponse; target: string; path: string }): Promise<boolean> {
    const routeStarted = process.hrtime.bigint();
    const elapsedMs = (since: bigint) => Number(process.hrtime.bigint() - since) / 1_000_000;
    const match = STREAM_ROUTE.exec(request.path);
    if (!match || request.req.method !== "GET") return false;
    deps.auth.authenticate({ method: "GET", target: request.target, headers: request.req.headers, body: new Uint8Array() }, READ);
    let found: MusicTrack | null;
    try { found = await resolve(match[1]!); }
    catch (error) {
      if (error instanceof MusicUnavailable) throw new ProtocolError(error.reason === "rate_limited" ? "RATE_LIMITED" : "UNAVAILABLE", error.message, { httpStatus: error.reason === "rate_limited" ? 429 : 503, retryable: true });
      throw error;
    }
    if (!found) throw new ProtocolError("NOT_FOUND", "The catalogue no longer has this track.", { httpStatus: 404 });
    const rawRange = String(request.req.headers.range ?? "");
    const range = /^bytes=(?:\d+-\d*|-\d+)$/.exec(rawRange);
    const forwarded = range ? { range: rawRange } : undefined;
    let url: URL, address: string;
    try { url = importUrl(found.fileUrl); address = await checkedAddress(url); }
    catch (error) { throw new ProtocolError("UNAVAILABLE", error instanceof Error ? error.message : "The track address could not be checked.", { httpStatus: 502, retryable: true }); }
    let response: Awaited<ReturnType<ImportNet["download"]>>;
    let providerHeadersMs = 0;
    const providerStarted = process.hrtime.bigint();
    for (let hop = 0; ; hop++) {
      try { response = await net.download(url, address, forwarded); providerHeadersMs = elapsedMs(providerStarted); }
      catch (error) { throw new ProtocolError("UNAVAILABLE", error instanceof Error ? error.message : "The track could not be reached.", { httpStatus: 502, retryable: true }); }
      if (response.status >= 300 && response.status < 400 && response.location) {
        response.cancel();
        if (hop >= MEDIA_IMPORT_MAX_REDIRECTS) throw new ProtocolError("INVALID_PARAMS", "The track address redirects too many times.", { httpStatus: 502 });
        const next = new URL(response.location, url);
        if (next.protocol !== "https:") throw new ProtocolError("UNAVAILABLE", "The track redirected to a non-https address.", { httpStatus: 502 });
        try { address = await vetAddress(net, next); } catch (error) { throw new ProtocolError("UNAVAILABLE", error instanceof Error ? error.message : "The redirected address could not be checked.", { httpStatus: 502, retryable: true }); }
        url = next;
        continue;
      }
      break;
    }
    if (response.status !== 200 && response.status !== 206) {
      response.cancel();
      if (response.status === 416) { request.res.writeHead(416, { "cache-control": "no-store" }).end(); return true; }
      throw new ProtocolError("UNAVAILABLE", `The catalogue file answered ${response.status}.`, { httpStatus: 502, retryable: true });
    }
    if (response.contentLength !== undefined && response.contentLength > MUSIC_TRACK_MAX_BYTES) {
      response.cancel();
      throw new ProtocolError("OUT_OF_RANGE", "The track is larger than the preview limit.", { httpStatus: 413 });
    }
    if (range && response.status !== 206) {
      response.cancel();
      throw new ProtocolError("UNAVAILABLE", "The catalogue did not honor the requested byte range.", { httpStatus: 502, retryable: true });
    }
    const headers = {
      "content-type": response.mime ?? mimeOf(extensionOf(found, response.mime ?? "")), "accept-ranges": "bytes", "cache-control": "private, no-store",
      "access-control-expose-headers": "content-range, content-length, server-timing", ...(response.contentLength !== undefined ? { "content-length": String(response.contentLength) } : {}), ...(response.contentRange ? { "content-range": response.contentRange } : {}),
    };
    let sentHeaders = false;
    const sendHeaders = (providerBodyMs: number) => {
      if (sentHeaders) return;
      sentHeaders = true;
      request.res.writeHead(response.status, {
        ...headers,
        // Diagnostic timings split host checks, provider response headers, and waiting for the provider's first byte.
        "server-timing": `host;dur=${elapsedMs(routeStarted) - providerHeadersMs - providerBodyMs}, provider-headers;dur=${providerHeadersMs}, provider-first-byte;dur=${providerBodyMs}`,
      });
    };
    let size = 0, closed = false;
    const stop = () => { if (!closed) { closed = true; response.cancel(); } };
    request.res.on("close", stop);
    try {
      for await (const piece of response.body) {
        if (!sentHeaders) sendHeaders(Math.max(0, elapsedMs(providerStarted) - providerHeadersMs));
        size += piece.length;
        if (size > MUSIC_TRACK_MAX_BYTES) { stop(); request.res.destroy(); return true; }
        if (closed) return true;
        if (!request.res.write(piece)) await new Promise<void>((resolve) => request.res.once("drain", resolve));
      }
      if (!sentHeaders) sendHeaders(Math.max(0, elapsedMs(providerStarted) - providerHeadersMs));
      if (!request.res.destroyed) request.res.end();
    } catch { if (!request.res.destroyed) request.res.destroy(); }
    return true;
  }

  const methods = new Map<string, RpcMethod>();
  const parse = <T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> => { const read = schema.safeParse(raw ?? {}); if (!read.success) throw new ProtocolError("INVALID_PARAMS", read.error.issues[0]?.message ?? "Invalid parameters."); return read.data; };
  methods.set("jagentchill.music.search", { scope: MUSIC_METHOD_SCOPES["jagentchill.music.search"], handle: (raw) => search(parse(schemas.search, raw)) });
  methods.set("jagentchill.music.track", { scope: MUSIC_METHOD_SCOPES["jagentchill.music.track"], handle: (raw) => track(parse(schemas.track, raw)) });
  return { methods, search, track, route };
}
export type MusicService = ReturnType<typeof createMusicService>;
