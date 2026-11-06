// The music catalogue of the editor's "Music" shelf is REMOTE: nothing musical is shipped in the app. A provider is a
// documented public API that names the licence of every track; the host asks it, filters what it answers, and hands
// the shelf rows it can show. A licensed catalogue replaces the keyless default by implementing this interface.

/** The licences a track may have to be offered: they allow commercial use and modification. Never NC, never ND, never SA. */
export const MUSIC_LICENCES = { cc0: "CC0", pdm: "Public domain", by: "CC BY" } as const;
export type MusicLicenceId = keyof typeof MUSIC_LICENCES;
export const isOfferedLicence = (licence: unknown): licence is MusicLicenceId => typeof licence === "string" && Object.hasOwn(MUSIC_LICENCES, licence);

/** One track as the shelf shows it. `id` is the provider's; `fileUrl` is where the host (never the app) fetches the one track a person adds. */
export type MusicTrack = {
  provider: string; id: string; title: string; author: string; authorUrl?: string;
  seconds: number;
  /** The licence family and, for a person, its name with the version ("CC BY 3.0"). */
  licenceId: MusicLicenceId; licence: string; licenceUrl: string;
  /** The page of the track at its source. */
  sourceUrl: string;
  /** The credit line to give for the track, complete: title, author, source, licence. */
  credit: string;
  attributionRequired: boolean;
  genres: string[]; tags: string[];
  /** Openverse's API has no relevance score; preserve its match fields and tag accuracy for a small, explainable rank. */
  apiMatch?: { fields: string[]; tagAccuracy: number };
  fileUrl: string; fileType: string;
};
export type MusicQuery = { text: string; page: number };
export type MusicPage = { tracks: MusicTrack[]; more: boolean };
/** Why a provider could not answer, in the words the shelf needs: no network, the provider's limit, or its own failure. */
export class MusicUnavailable extends Error {
  readonly reason: "offline" | "rate_limited" | "provider_error" | "not_connected";
  constructor(reason: MusicUnavailable["reason"], message: string) { super(message); this.name = "MusicUnavailable"; this.reason = reason; }
}
export interface MusicProvider {
  readonly id: string;
  /** As a person reads it. */
  readonly name: string;
  /** The line a provider's terms ask an application to show. */
  readonly notice: string;
  readonly site: string;
  /** False for a provider that needs a key the host does not hold yet. */
  ready(): boolean;
  search(query: MusicQuery): Promise<MusicPage>;
  /** One track by its id; null when the provider does not have it (any more) or its licence is not one that is offered. */
  track(id: string): Promise<MusicTrack | null>;
}

/**
 * The shelf's chips. Each is a search the provider is asked, and the words of a row's own genres and tags that make it
 * a match of the chip: matching rows come first. Nobody here listened — the order is the provider's relevance and the
 * uploader's own tags.
 */
export const MUSIC_CHIPS: readonly { id: string; query: string; queries: readonly string[]; match: readonly string[] }[] = [
  { id: "chill", query: "lofi", queries: ["lofi", "lounge instrumental", "downtempo"], match: ["lounge", "chillout", "downtempo", "lofi", "peaceful"] },
  { id: "upbeat", query: "upbeat instrumental", queries: ["upbeat instrumental", "happy instrumental", "pop"], match: ["upbeat", "happy", "pop"] },
  { id: "cinematic", query: "cinematic instrumental", queries: ["cinematic instrumental", "filmscore", "epic instrumental"], match: ["cinematic", "filmscore", "trailer", "epic"] },
  { id: "hiphop", query: "hiphop", queries: ["hiphop", "trap", "rap instrumental"], match: ["hiphop", "rap", "trap", "triphop"] },
  { id: "dance", query: "edm", queries: ["edm", "electronic instrumental", "dance"], match: ["dance", "electronic", "electropop", "house", "trance", "futurebass"] },
  { id: "acoustic", query: "acoustic instrumental", queries: ["acoustic instrumental", "guitar instrumental", "folk instrumental"], match: ["acousticguitar", "acoustical", "guitar", "folk"] },
  { id: "corporate", query: "corporate instrumental", queries: ["corporate instrumental", "business instrumental", "commercial instrumental"], match: ["corporate", "commercial", "advertising", "business"] },
  { id: "house", query: "house", queries: ["house", "deephouse", "chill house"], match: ["house", "deephouse", "acidhouse", "dance"] },
  { id: "piano", query: "piano instrumental", queries: ["piano instrumental", "emotional piano instrumental", "solo piano"], match: ["piano", "pianosolo", "grandpiano"] },
  { id: "travel", query: "travel instrumental", queries: ["travel instrumental", "adventure instrumental", "world instrumental"], match: ["travel", "world", "adventure"] },
];
/** Rows are ranked from returned fields only: exact title/tag/genre fit, API match fields and tag accuracy,
 * instrumental hints, then a preference for a usable short-video bed length. Ties retain merged query order. */
export function orderForChip(tracks: MusicTrack[], chipId: string | undefined): MusicTrack[] {
  const chip = MUSIC_CHIPS.find((entry) => entry.id === chipId);
  if (!chip) return tracks;
  const score = (track: MusicTrack) => {
    const terms = chip.match;
    const words = [...track.genres, ...track.tags].map((word) => word.toLowerCase());
    const title = track.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const tagged = words.filter((word) => terms.includes(word)).length;
    const titleHit = terms.some((word) => title.includes(word));
    const instrumental = words.includes("instrumental") || title.includes("instrumental");
    const apiFields = track.apiMatch?.fields ?? [];
    const accuracy = track.apiMatch?.tagAccuracy ?? 0;
    return tagged * 20 + (titleHit ? 15 : 0) + (instrumental ? 8 : 0) + Math.min(accuracy, 1) * 5 + (apiFields.includes("tags.name") ? 2 : 0) + (apiFields.includes("title") ? 2 : 0) - Math.abs(track.seconds - 150) / 100;
  };
  return tracks.map((track, index) => ({ track, index, score: score(track) })).sort((a, b) => b.score - a.score || a.index - b.index).map(({ track }) => track);
}
