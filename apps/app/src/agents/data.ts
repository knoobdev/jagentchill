import { useSyncExternalStore } from "react";
import type { HostConnection, HostEvent } from "@jagentchill/client";
import type { ModelCatalogue } from "@jagentchill/app-core";
import type { EndpointRecord, ProviderListing } from "@jagentchill/protocol";
import { useHost } from "../host";

export type EndpointView = EndpointRecord & { projected: boolean; keyHint?: string; rowNotes: string[] };
export type AgentData = {
  /** `null` until the first answer of the host. */
  catalogue: ModelCatalogue | null;
  providers: ProviderListing[];
  endpoints: EndpointView[];
  error: unknown;
  /** Runtime ids being re-probed on request ("Retrying…"). */
  retrying: readonly string[];
};
const EMPTY: AgentData = { catalogue: null, providers: [], endpoints: [], error: null, retrying: [] };

type Store = { data: AgentData; listeners: Set<() => void>; reload(): void; retry(runtimeIds: string[]): Promise<void>; dispose(): void };
const stores = new WeakMap<HostConnection, Store>();

/**
 * One copy per connection of what the model browser and the settings pages read: the model catalogue, the provider
 * list and the endpoint records. It follows `runtime.updated` and `provider.changed`, polls while a runtime is still
 * being probed, and asks again for a runtime whose models the host could not list yet.
 */
function storeOf(connection: HostConnection): Store {
  const existing = stores.get(connection);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let catalogueRetries = 0;
  const store: Store = {
    data: EMPTY, listeners,
    reload: () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 150); },
    async retry(runtimeIds) {
      set({ retrying: [...new Set([...store.data.retrying, ...runtimeIds])] });
      try { await connection.call("jagentchill.runtime.snapshot.refresh", { runtimeIds }); } catch (error) { set({ error }); }
      set({ retrying: store.data.retrying.filter((id) => !runtimeIds.includes(id)) });
      await load();
    },
    dispose() { disposed = true; if (timer) clearTimeout(timer); off(); },
  };
  const set = (patch: Partial<AgentData>) => { store.data = { ...store.data, ...patch }; for (const listener of listeners) listener(); };
  async function load(): Promise<void> {
    if (disposed) return;
    try {
      const [catalogue, auth, endpoints] = await Promise.all([
        connection.call<ModelCatalogue>("jagentchill.runtime.models.list", {}),
        connection.call<{ providers: ProviderListing[] }>("jagentchill.provider.auth.list", {}),
        connection.call<{ endpoints: EndpointView[] }>("jagentchill.provider.endpoint.list", {}),
      ]);
      set({ catalogue, providers: auth.providers, endpoints: endpoints.endpoints, error: null });
      // The host lists a CLI's models only after it asked the CLI, which can take longer than one probe.
      const waiting = catalogue.groups.filter((group) => group.readiness === "error" && group.error?.step === "catalogue").map((group) => group.runtimeId);
      // The count starts again once all are listed.
      if (!waiting.length) catalogueRetries = 0;
      if (waiting.length && catalogueRetries < 8) { catalogueRetries += 1; void store.retry(waiting); }
      else if (catalogue.groups.some((group) => group.readiness === "loading")) { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 2000); }
    } catch (error) { set({ error }); }
  }
  const off = connection.on((event: HostEvent) => {
    if (event.event === "jagentchill.runtime.updated" || event.event === "jagentchill.provider.changed" || event.event === "jagentchill.orc.config.changed") store.reload();
  });
  void connection.call("jagentchill.runtime.subscribe", {}).catch(() => undefined);
  void load();
  stores.set(connection, store);
  return store;
}

const subscribeNone = () => () => undefined;
/** The model catalogue, providers and endpoints of the connected host, shared by every screen that shows them. */
export function useAgentData(): AgentData & { reload(): void; retry(runtimeIds: string[]): Promise<void>; providerLabel(providerId: string): string } {
  const { connection } = useHost();
  const store = connection ? storeOf(connection) : null;
  const data = useSyncExternalStore(store ? (listener) => { store.listeners.add(listener); return () => void store.listeners.delete(listener); } : subscribeNone, () => (store ? store.data : EMPTY));
  return {
    ...data,
    reload: () => store?.reload(),
    retry: (runtimeIds) => store?.retry(runtimeIds) ?? Promise.resolve(),
    providerLabel: (providerId) => data.endpoints.find((endpoint) => endpoint.id === providerId)?.label ?? data.providers.find((provider) => provider.providerId === providerId)?.label
      ?? data.catalogue?.groups.flatMap((group) => group.providers).find((provider) => provider.providerId === providerId)?.label ?? providerId,
  };
}
