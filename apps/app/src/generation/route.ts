import type { GenerationCapability, GenerationEstimate, GenerationParams, GenerationVoice } from "@jagentchill/protocol";
import type { CostAnswer } from "./cost";

/**
 * Which model makes a picture, speech or music is decided in ONE place: the roles of Model routing (ORC) — Image,
 * Voice, Music. A screen never chooses: its request names the capability and nothing else, the host resolves the
 * role, and the screen only SHOWS what the role resolves to. No React here: `route.test.ts` checks it without a browser.
 */
export type GenerateKind = "image" | "tts" | "music";
/** The role of Model routing that decides the model of each kind, by its label there. */
export const ROLE_OF: Record<GenerateKind, string> = { image: "Image", tts: "Voice", music: "Music" };
/** The model a role resolves to right now, as the host says it. */
export type Routed = { provider: string; model: string; label: string };

/**
 * The shortest request the host can resolve and price: asked before anything is typed, only to learn which model the
 * role gives. Nothing of it is sent to a provider (`…provider.estimate` starts nothing).
 */
export const probeParams = (kind: GenerateKind): GenerationParams => (kind === "tts" ? { text: "." } : { prompt: "." });
/** What the host is asked to estimate: the capability and the request — never a provider or a model. */
export const estimateRequest = (kind: GenerateKind, params: GenerationParams): { items: { capability: GenerationCapability; params: GenerationParams }[] } => ({ items: [{ capability: kind, params }] });
/** What the host is asked to make: the same, with the project and the answer to the money question. Never a provider or a model. */
export const createRequest = (kind: GenerateKind, params: GenerationParams, projectId: string, answer?: CostAnswer): Record<string, unknown> => ({ capability: kind, params, projectId, ...(answer ?? {}) });
/** The model the role resolved to, read from the host's estimate; null when the role gives none. */
export function routedOf(estimate: Pick<GenerationEstimate, "provider" | "model" | "label"> | null | undefined): Routed | null {
  return estimate && estimate.provider && estimate.model ? { provider: estimate.provider, model: estimate.model, label: estimate.label || estimate.model } : null;
}
/** The voices a person may choose: the routed speech model's own, and no other model's. */
export const voicesOf = (voices: readonly GenerationVoice[], routed: Routed | null): GenerationVoice[] => (routed ? voices.filter((voice) => voice.provider === routed.provider && voice.model === routed.model) : []);
