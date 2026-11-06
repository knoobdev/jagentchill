import type { z } from "zod";
import type { ModelEntry, modelsSearchParams } from "@jagentchill/protocol";
import type { HttpFetch } from "./http.ts";

/**
 * The catalogue an aggregator publishes itself. OpenRouter lists every model at `https://openrouter.ai/api/v1/models`
 * (no key needed); the product ships no list of its own. The list is kept for ten minutes; when a fetch fails the last
 * list is served and marked stale.
 */
export type PublishedModel = {
  id: string; label: string; upstreamProvider?: string; contextWindow?: number; input: ModelEntry["input"]; supportsTools: boolean; reasoning: boolean;
  pricing?: { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number; cacheWritePerMillionUsd?: number }; free: boolean; created_ms?: number;
  /** The longest answer the model gives, as the provider's list documents it (`top_provider.max_completion_tokens`). Absent: the list does not say. */
  maxOutputTokens?: number;
};
type Cached = { models: PublishedModel[]; fetched_ms: number; stale: boolean };
type SearchParams = z.infer<typeof modelsSearchParams>;

const SOURCES: Record<string, string> = { openrouter: "https://openrouter.ai/api/v1/models" };
const REUSE_MS = 600_000;
const INPUTS = new Set(["text", "image", "audio", "video"]);

/** Maps Anthropic CLI spelling to the exact version spelling published by the catalogue. */
export function anthropicCatalogueModelId(modelId: string): string {
  const versioned = /^(claude-[a-z]+)-(\d+)-(\d+)(?:-(?:\d{8}|latest))?$/.exec(modelId);
  return versioned ? `${versioned[1]}-${versioned[2]}.${versioned[3]}` : modelId;
}

function readOpenRouter(body: unknown): PublishedModel[] {
  const rows = (body as { data?: unknown })?.data;
  if (!Array.isArray(rows)) throw new Error("unexpected catalogue shape");
  return rows.flatMap((row): PublishedModel[] => {
    const record = row as {
      id?: unknown; name?: unknown; context_length?: unknown; created?: unknown; supported_parameters?: unknown;
      architecture?: { input_modalities?: unknown };
      pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
      top_provider?: { max_completion_tokens?: unknown } | null;
    };
    if (typeof record.id !== "string" || !record.id) return [];
    const parameters = Array.isArray(record.supported_parameters) ? record.supported_parameters.map(String) : [];
    const modalities = Array.isArray(record.architecture?.input_modalities) ? record.architecture.input_modalities.map(String).map((kind) => (kind === "file" ? "document" : kind)) : ["text"];
    const price = (value: unknown) => (value === undefined || value === null || value === "" ? undefined : Number(value) * 1_000_000);
    const input = price(record.pricing?.prompt);
    const output = price(record.pricing?.completion);
    const cachedInput = price(record.pricing?.input_cache_read);
    const cacheWrite = price(record.pricing?.input_cache_write);
    const priced = input !== undefined && output !== undefined && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
    const longest = record.top_provider?.max_completion_tokens;
    return [{
      id: record.id, label: typeof record.name === "string" ? record.name.slice(0, 120) : record.id,
      ...(record.id.includes("/") ? { upstreamProvider: record.id.split("/")[0].replace(/^~/, "") } : {}),
      ...(typeof record.context_length === "number" && record.context_length > 0 ? { contextWindow: record.context_length } : {}),
      input: modalities.filter((kind) => INPUTS.has(kind) || kind === "document") as ModelEntry["input"],
      supportsTools: parameters.includes("tools"), reasoning: parameters.includes("reasoning"),
      ...(priced ? { pricing: {
        inputPerMillionUsd: input, outputPerMillionUsd: output,
        ...(cachedInput !== undefined && Number.isFinite(cachedInput) && cachedInput >= 0 ? { cachedInputPerMillionUsd: cachedInput } : {}),
        ...(cacheWrite !== undefined && Number.isFinite(cacheWrite) && cacheWrite >= 0 ? { cacheWritePerMillionUsd: cacheWrite } : {}),
      } } : {}),
      free: priced && input === 0 && output === 0,
      ...(typeof record.created === "number" ? { created_ms: record.created * 1000 } : {}),
      ...(typeof longest === "number" && Number.isInteger(longest) && longest > 0 ? { maxOutputTokens: longest } : {}),
    }];
  });
}

export function createAggregatorCatalogue(deps: { http: HttpFetch; now: () => number }) {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();

  const publishes = (providerId: string): boolean => Object.hasOwn(SOURCES, providerId);

  function load(providerId: string): Promise<Cached> {
    const cached = cache.get(providerId);
    if (cached && !cached.stale && deps.now() - cached.fetched_ms < REUSE_MS) return Promise.resolve(cached);
    const running = inflight.get(providerId);
    if (running) return running;
    const task = (async (): Promise<Cached> => {
      try {
        const response = await deps.http(SOURCES[providerId], { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next: Cached = { models: readOpenRouter(await response.json()), fetched_ms: deps.now(), stale: false };
        cache.set(providerId, next);
        return next;
      } catch (err) {
        // The last list stays usable; without one the caller reports the failure.
        if (cached) return { ...cached, stale: true };
        throw err;
      } finally {
        inflight.delete(providerId);
      }
    })();
    inflight.set(providerId, task);
    return task;
  }

  /** One page: the pre-search set (`pinned ∪ includeIds`) without a query and filters, the matching models otherwise. */
  async function search(params: SearchParams, pinned: string[]): Promise<{ models: PublishedModel[]; total: number; catalogueTotal: number; nextCursor?: string; stale: boolean; fetched_ms: number }> {
    const { models, stale, fetched_ms } = await load(params.providerId);
    const query = params.query?.trim().toLowerCase();
    const filters = params.filters ?? {};
    const searching = !!query || Object.keys(filters).length > 0 || params.sort !== undefined || params.cursor !== undefined;
    let found: PublishedModel[];
    if (!searching) {
      const wanted = [...new Set([...pinned, ...(params.includeIds ?? [])])];
      const byId = new Map(models.map((model) => [model.id, model]));
      found = wanted.flatMap((id) => byId.get(id) ?? []);
    } else {
      found = models.filter((model) => {
        if (query && ![model.id, model.label, model.upstreamProvider ?? ""].some((text) => text.toLowerCase().includes(query))) return false;
        if (filters.input?.some((kind) => !model.input.includes(kind))) return false;
        if (filters.minContextWindow !== undefined && (model.contextWindow ?? 0) < filters.minContextWindow) return false;
        if (filters.supportsTools !== undefined && model.supportsTools !== filters.supportsTools) return false;
        if (filters.reasoning !== undefined && model.reasoning !== filters.reasoning) return false;
        if (filters.free !== undefined && model.free !== filters.free) return false;
        if (filters.maxInputPricePerMillionUsd !== undefined && (model.pricing?.inputPerMillionUsd ?? Infinity) > filters.maxInputPricePerMillionUsd) return false;
        if (filters.upstreamProvider && model.upstreamProvider !== filters.upstreamProvider) return false;
        return true;
      });
      const sort = params.sort ?? "name";
      found = [...found].sort((a, b) => (sort === "context" ? (b.contextWindow ?? 0) - (a.contextWindow ?? 0)
        : sort === "price" ? (a.pricing?.inputPerMillionUsd ?? Infinity) - (b.pricing?.inputPerMillionUsd ?? Infinity)
        : sort === "recent" ? (b.created_ms ?? 0) - (a.created_ms ?? 0) : 0) || a.label.localeCompare(b.label));
      // Pinned models lead every listing.
      const pins = new Set(pinned);
      found = [...found.filter((model) => pins.has(model.id)), ...found.filter((model) => !pins.has(model.id))];
    }
    const offset = Number(params.cursor ?? 0);
    const limit = params.limit ?? 50;
    const page = found.slice(offset, offset + limit);
    return { models: page, total: found.length, catalogueTotal: models.length, ...(offset + limit < found.length ? { nextCursor: String(offset + limit) } : {}), stale, fetched_ms };
  }

  const priceTried = new Map<string, number>();
  return {
    publishes, search,
    /**
     * The list price of a model, from the provider's published list as this host last read it. It never waits: while
     * the list is not in memory (after a restart) it is read in the background, at most once in five minutes, and the
     * price is unknown until then.
     */
    priceOf(providerId: string, modelId: string): { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number; cacheWritePerMillionUsd?: number; source: "aggregator" } | undefined {
      if (!publishes(providerId)) return undefined;
      const cached = cache.get(providerId);
      if (!cached && deps.now() - (priceTried.get(providerId) ?? -Infinity) > 300_000) { priceTried.set(providerId, deps.now()); void load(providerId).catch(() => undefined); }
      const pricing = cached?.models.find((model) => model.id === modelId)?.pricing;
      return pricing && { ...pricing, source: "aggregator" };
    },
    /**
     * The longest answer a model gives, as the provider's published list documents it (ruling R10: a documented provider
     * limit is an enforced limit — the model cannot write more). Read from the list this host holds in memory, like the
     * price (`priceOf` starts the reading); undefined: the list is not read yet, or does not say.
     */
    maxOutputOf(providerId: string, modelId: string): number | undefined {
      return publishes(providerId) ? cache.get(providerId)?.models.find((model) => model.id === modelId)?.maxOutputTokens : undefined;
    },
    /** A model by its id in the provider's published list; undefined when the list does not have it or cannot be read. */
    find: async (providerId: string, modelId: string): Promise<PublishedModel | undefined> => (publishes(providerId) ? (await load(providerId).catch(() => undefined))?.models.find((model) => model.id === modelId) : undefined),
  };
}

export type AggregatorCatalogue = ReturnType<typeof createAggregatorCatalogue>;
