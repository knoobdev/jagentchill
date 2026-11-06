import { formatUsd } from "@jagentchill/app-core";
import { useCallback, useEffect, useState } from "react";
import type { GenerationCapability, GenerationCapabilityState, GenerationEstimate, GenerationPricing, GenerationProvider } from "@jagentchill/protocol";
import { HostError } from "@jagentchill/client";
import { useHost } from "../host";
import type { T } from "../locale";

export type GenerationState = {
  providers: GenerationProvider[]; capabilities: GenerationCapabilityState[]; loaded: boolean; error: unknown;
  /** Whether a connected provider can serve this capability now: an entry point is shown only then. */
  available(capability: GenerationCapability): boolean;
  reload(): Promise<void>;
  /** A call to the host; one that changes something is followed by a fresh read of the registry. */
  call<R = unknown>(method: string, params?: unknown): Promise<R>;
};

/** The generation providers of the connected host, kept current from the host's own events. */
export function useGeneration(): GenerationState {
  const { connection, onEvent } = useHost();
  const [state, setState] = useState<{ providers: GenerationProvider[]; capabilities: GenerationCapabilityState[]; loaded: boolean; error: unknown }>({ providers: [], capabilities: [], loaded: false, error: null });
  const reload = useCallback(async () => {
    if (!connection) return setState({ providers: [], capabilities: [], loaded: false, error: null });
    try {
      const result = await connection.call<{ providers: GenerationProvider[]; capabilities: GenerationCapabilityState[] }>("jagentchill.provider.subscribe", {});
      setState({ ...result, loaded: true, error: null });
    } catch (error) { setState((current) => ({ ...current, loaded: true, error })); }
  }, [connection]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.provider.changed" && event.payload?.generation) void reload(); }), [onEvent, reload]);
  const available = useCallback((capability: GenerationCapability) => state.capabilities.some((entry) => entry.capability === capability && entry.available), [state.capabilities]);
  const call = useCallback(async <R = unknown>(method: string, params?: unknown): Promise<R> => {
    if (!connection) throw new HostError("CONNECTION_CLOSED", "The connection is closed.", { retryable: true });
    const result = await connection.call<R>(method, params ?? {});
    if (!/\.(list|get|check|estimate)$/.test(method)) void reload();
    return result;
  }, [connection, reload]);
  return { ...state, available, reload, call };
}

/**
 * The name of a generation model as the host's catalogue calls it, by its id ("openai/gpt-5-image-mini" → "GPT-5 Image
 * Mini"). An id the catalogue does not hold (a runtime's model, or a list this device may not read) is returned as it is.
 */
export function useModelNames(): (modelId: string) => string {
  const { connection, onEvent } = useHost();
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    if (!connection) return;
    void (async () => {
      const found: Record<string, string> = {};
      const { providers } = await connection.call<{ providers: GenerationProvider[] }>("jagentchill.provider.subscribe", {});
      for (const provider of providers.filter((entry) => entry.connection === "connected")) for (const model of (await connection.call<{ models: { id: string; label: string }[] }>("jagentchill.provider.model.list", { providerId: provider.id })).models) if (model.label) found[model.id] = model.label;
      setNames(found);
    })().catch(() => undefined);
  }, [connection]);
  useEffect(load, [load]);
  // A provider connected, a model added or renamed: the names are read again.
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.provider.changed") load(); }), [onEvent, load]);
  return useCallback((modelId: string) => names[modelId] ?? modelId, [names]);
}

/** "$0.04", four decimals under one cent, "under $0.0001" below that, "≈" for an estimate that is not exact, "Cost unknown" without a price. */
export function costText(t: T, estimate: Pick<GenerationEstimate, "amountUsd" | "confidence"> | null | undefined): string {
  if (!estimate || estimate.amountUsd === null) return t("Cost unknown");
  // An amount that would print as "$0.0000" is not nothing: it is said to be under the smallest amount that prints.
  if (estimate.amountUsd > 0 && estimate.amountUsd < 0.00005) return t("under {amount}", { amount: usd(0.0001) });
  return `${estimate.confidence === "exact" ? "" : "≈ "}${usd(estimate.amountUsd)}`;
}
export const usd = (amount: number) => formatUsd(amount);

/**
 * The price of a model in one short phrase. Where the price comes from decides how sure it reads: a price taken from
 * the provider's own list is said plainly; one worked out from what real requests were billed is "about". The origin
 * itself is never printed.
 */
export function priceText(t: T, pricing: GenerationPricing | undefined): string {
  if (!pricing) return t("Unpriced");
  const measured = (pricing as { source?: { kind?: string } }).source?.kind === "measured", price = (amount: number) => (measured ? t("about {cost}", { cost: usd(amount) }) : usd(amount));
  switch (pricing.kind) {
    case "free": return t("Free");
    case "per_image": return t("{price} per image", { price: price(pricing.baseUsd) });
    case "per_clip": return t("{price} per clip", { price: price(pricing.tiers[0]?.usd ?? 0) });
    case "per_second": return t("{price} per second", { price: price(pricing.usd) });
    case "per_character": return t("{price} per 1,000 characters", { price: price(pricing.perThousandUsd) });
    case "per_call": return t("{price} per call", { price: price(pricing.usd) });
    case "tokens": return t("{price} per million tokens", { price: price(pricing.outputPerMillionUsd) });
  }
}

export const CAPABILITY_LABEL: Record<GenerationCapability, string> = {
  image: "Image", video: "Video", tts: "Speech", "voice-design": "Voice design", music: "Music", sfx: "Sound effects", lipsync: "Lip-sync", transcription: "Transcription", translation: "Translation", "stock-media": "Stock media",
};
export const HEALTH_LABEL: Record<GenerationProvider["health"], { label: string; tone: "success" | "warning" | "danger" | "off" }> = {
  ready: { label: "Ready", tone: "success" }, degraded: { label: "Degraded", tone: "warning" }, down: { label: "Not answering", tone: "danger" }, unauthorized: { label: "Key rejected", tone: "danger" },
  unknown: { label: "Not checked yet", tone: "off" }, disabled: { label: "Turned off", tone: "off" },
};
/** Sentences the host sends about a provider or a job, with the action each one suggests: the screens translate them by their English text. */
export const HOST_SENTENCES: Record<string, string> = {
  "The provider rejected this API key": "Open provider settings", "The key is not allowed to use this model": "Open provider settings", "The provider is limiting requests": "Retry",
  "The provider account has no credit left": "Open provider settings", "The provider did not answer in time": "Retry", "The provider had an error": "Retry", "Unable to reach the provider": "Retry",
  "This model is not available right now": "Switch model", "This model cannot do what was asked": "Switch model", "The provider did not accept this request": "Edit prompt",
  "The provider blocked this request under its content policy": "Edit prompt", "The provider returned a file that cannot be read": "Retry", "A budget has been reached": "Raise budget",
  "The job was cancelled": "Retry", "The provider returned an unexpected error": "Retry", "Waiting for provider rate limit": "Retry", "The key is valid but the account has no credit": "Open provider settings",
  "Reconnect the provider": "Open provider settings", "The provider is not answering": "Retry", "Some requests are failing": "Retry",
};
/** What the host says about what a provider is sent (`sendingNote`, `sends` of a provider): shown once, on the provider's own screen, translated by their English text. */
export const SENDING_LINES: string[] = [
  "Connecting lets JAgentChill send this provider what the features you start need — nothing is asked again for each action",
  "Pictures: the description of each picture, and the reference pictures it is drawn with — a film's or a video's own sheets and frames, or pictures you chose — made small, without their file data",
  "Voice: the text to be spoken (script lines, captions, text clips)",
  "Music: the description of the music",
  "Listening: audio to be written back as text — the voice lines made here (to check them) and the speech of your clips (for captions)",
  "Translation: the text of captions to be translated",
];
