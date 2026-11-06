export type ShelfTrack = {
  provider: string; id: string; title: string; author: string; authorUrl?: string; seconds: number;
  licenceId: "cc0" | "pdm" | "by"; licence: string; licenceUrl: string; sourceUrl: string; credit: string; attributionRequired: boolean; genres: string[]; tags: string[];
};
export type MusicProviderInfo = { id: string; name: string; notice: string; site: string };
export type MusicDown = { ok: false; reason: "offline" | "rate_limited" | "provider_error" | "not_connected" | "not_found" | "no_host"; message: string; provider?: MusicProviderInfo | null; chips?: string[] };
export type ShelfAnswer = { ok: true; provider: MusicProviderInfo; chips: string[]; query: string; page: number; more: boolean; tracks: ShelfTrack[] } | MusicDown;
export type MusicCaller = { call<T>(method: string, params?: unknown): Promise<T> };

const lastGood = new Map<string, Extract<ShelfAnswer, { ok: true }>>();
const searchKey = (hostId: string | undefined, params: { query?: string; chip?: string; page?: number }): string | null => hostId ? `${hostId}\n${params.query?.trim().toLowerCase() ?? ""}\n${params.chip ?? ""}\n${params.page ?? 1}` : null;

/** The last successful shelf for this host and query, shared across editor mounts. */
export function cachedMusicSearch(hostId: string | undefined, params: { query?: string; chip?: string; page?: number }): Extract<ShelfAnswer, { ok: true }> | null {
  const key = searchKey(hostId, params);
  return key ? lastGood.get(key) ?? null : null;
}

const down = (error: unknown): MusicDown => ({ ok: false, reason: "offline", message: error instanceof Error ? error.message : String(error) });

export async function searchMusic(connection: MusicCaller | undefined, params: { query?: string; chip?: string; page?: number }): Promise<ShelfAnswer> {
  if (!connection) return { ok: false, reason: "no_host", message: "" };
  try { return await connection.call<ShelfAnswer>("jagentchill.music.search", { ...(params.query?.trim() ? { query: params.query.trim().slice(0, 200) } : {}), ...(params.chip ? { chip: params.chip } : {}), ...(params.page ? { page: params.page } : {}) }); }
  catch (error) { return down(error); }
}

/** Reuses the last good rows immediately in the caller, retries transient catalogue failures, then refreshes the cache. */
export async function refreshMusicSearch(connection: MusicCaller | undefined, hostId: string | undefined, params: { query?: string; chip?: string; page?: number }, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<ShelfAnswer> {
  const key = searchKey(hostId, params), waits = [250, 750, 1500];
  for (let attempt = 0; ; attempt++) {
    const answer = await searchMusic(connection, params);
    if (answer.ok) { if (key) lastGood.set(key, answer); return answer; }
    if (!(answer.reason === "offline" || answer.reason === "rate_limited" || answer.reason === "provider_error") || attempt >= waits.length) return answer;
    await sleep(waits[attempt]!);
  }
}
