// Openverse (https://api.openverse.org/v1/, terms https://docs.openverse.org/terms_of_service.html): a documented
// public search API over openly licensed audio that names the licence of every row. It answers without a key
// (anonymous: 20 requests a minute and 200 a day per address, as its response headers say on 2026-10-08), so the shelf
// works on a host nobody has configured. Its terms ask: keep to the rate limits, never scrape, give attribution, and
// say the product was "made using Openverse but is not endorsed or certified by Openverse" (the `notice` below).
import { MUSIC_LICENCES, MusicUnavailable, isOfferedLicence, type MusicPage, type MusicProvider, type MusicQuery, type MusicTrack } from "./provider.ts";

export const OPENVERSE_URL = "https://api.openverse.org/v1";
/** What an anonymous caller may ask for in one page. */
const PAGE_SIZE = 20;
type Row = Record<string, unknown>;
const text = (value: unknown, max = 300): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const https = (value: unknown): string => { const url = text(value, 2000); return /^https:\/\//.test(url) ? url : ""; };
const decoded = (value: string): string => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/**
 * A row of the API as a track of the shelf, or null when it must not be offered: a licence that is not CC0 / public
 * domain / CC BY (the request already asks for those only — this is the second lock, on what actually came back), a
 * row that is not music, or one without a title, author, page, https file or usable 45 s–5 min length.
 */
export function trackOfRow(row: Row): MusicTrack | null {
  const licenceId = text(row.license).toLowerCase();
  if (!isOfferedLicence(licenceId)) return null;
  if (row.category !== undefined && row.category !== null && row.category !== "music") return null;
  const id = text(row.id, 64), title = decoded(text(row.title, 200)), author = decoded(text(row.creator, 200)), fileUrl = https(row.url), sourceUrl = https(row.foreign_landing_url);
  const duration = Number(row.duration), seconds = Math.round(duration / 10) / 100;
  if (!/^[0-9a-f-]{36}$/.test(id) || !title || !author || !fileUrl || !sourceUrl || !Number.isFinite(duration) || duration < 45_000 || duration > 300_000) return null;
  const version = text(row.license_version, 8), licence = `${MUSIC_LICENCES[licenceId]}${licenceId === "by" && version ? ` ${version}` : ""}`;
  const licenceUrl = https(row.license_url) || (licenceId === "by" ? `https://creativecommons.org/licenses/by/${version || "4.0"}/` : licenceId === "cc0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/publicdomain/mark/1.0/");
  const names = (list: unknown): string[] => (Array.isArray(list) ? list.map((entry) => text(typeof entry === "string" ? entry : (entry as Row | null)?.name, 40)).filter(Boolean).slice(0, 24) : []);
  const tagRows = Array.isArray(row.tags) ? row.tags as Row[] : [];
  const tagAccuracy = tagRows.reduce((top, tag) => typeof tag.accuracy === "number" && Number.isFinite(tag.accuracy) ? Math.max(top, tag.accuracy) : top, 0);
  const fields = Array.isArray(row.fields_matched) ? row.fields_matched.map((field) => text(field, 40)).filter(Boolean) : [];
  const authorUrl = https(row.creator_url);
  return {
    provider: "openverse", id, title, author, ...(authorUrl ? { authorUrl } : {}), seconds, licenceId, licence, licenceUrl, sourceUrl,
    // Title, author, source and licence — what a CC licence asks a credit to carry.
    credit: `"${title}"${author ? ` by ${author}` : ""} — ${licence} (${licenceUrl}) — ${sourceUrl}`,
    attributionRequired: licenceId === "by", genres: names(row.genres), tags: names(row.tags), apiMatch: { fields, tagAccuracy }, fileUrl, fileType: text(row.filetype, 12),
  };
}

export function createOpenverseProvider(options: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): MusicProvider {
  const base = (options.baseUrl ?? OPENVERSE_URL).replace(/\/+$/, ""), ask = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 15_000;
  async function get(path: string): Promise<Row | null> {
    let response: Response;
    try { response = await ask(`${base}${path}`, { headers: { accept: "application/json", "user-agent": "JAgentChill (music shelf)" }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new MusicUnavailable("offline", "The music catalogue could not be reached."); }
    if (response.status === 404) return null;
    if (response.status === 429) throw new MusicUnavailable("rate_limited", "The music catalogue's limit for today or this minute is used up.");
    if (!response.ok) throw new MusicUnavailable("provider_error", `The music catalogue answered ${response.status}.`);
    try { return (await response.json()) as Row; } catch { throw new MusicUnavailable("provider_error", "The music catalogue's answer could not be read."); }
  }
  return {
    id: "openverse", name: "Openverse", site: "https://openverse.org/", notice: "Made using Openverse — not endorsed or certified by Openverse.",
    ready: () => true,
    async search(query: MusicQuery): Promise<MusicPage> {
      // Asked for music under CC0 or CC BY only; `trackOfRow` checks every row again.
      const params = new URLSearchParams({ q: query.text.slice(0, 200), license: "by,cc0", category: "music", page_size: String(PAGE_SIZE), page: String(query.page) });
      const answer = await get(`/audio/?${params}`);
      const rows = Array.isArray(answer?.results) ? (answer.results as Row[]) : [];
      return { tracks: rows.map(trackOfRow).filter((track): track is MusicTrack => track !== null), more: Number(answer?.page_count ?? 0) > query.page };
    },
    async track(id: string): Promise<MusicTrack | null> {
      if (!/^[0-9a-f-]{36}$/.test(id)) return null;
      const row = await get(`/audio/${id}/`);
      return row ? trackOfRow(row) : null;
    },
  };
}
