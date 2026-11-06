import type { LocalInstall, LocalModelQuant, LocalModelVariant, LocalModelsView, LocalVerdict, LocalVerdictKind, OrcConfig, OrcRoleConfig } from "@jagentchill/protocol";
import { LOCAL_IMAGE_PROVIDER_ID } from "@jagentchill/protocol";

/** What each verdict of the hardware check is called on the card, and its tone. */
export const VERDICT_LABEL: Record<LocalVerdictKind, { label: string; tone: "success" | "warning" | "danger" | "off" }> = {
  well: { label: "Runs well", tone: "success" }, slow: { label: "Runs slowly", tone: "warning" }, memory: { label: "Not enough memory", tone: "danger" }, disk: { label: "Not enough disk space", tone: "danger" }, unsupported: { label: "Not supported on this computer", tone: "off" },
};
/** The sentences the host sends about the local models (hardware check, downloads, errors): the card translates them by their English text. */
export const LOCAL_SENTENCES = [
  "Unified memory: {have} — this needs about {need}", "Parts of the model are kept in main memory and moved in turn: slower", "Graphics card {card}: {have} of memory — this needs about {need}",
  "Main memory: {have} — this needs about {need}", "The graphics card is too small for this quant: parts run from main memory, slower", "No supported graphics processor: the processor makes the picture, several minutes each",
  "Free disk: {have} — the download needs {need}", "Free memory right now: {have} — close other apps before making pictures", "The engine has no build for this computer ({platform}, {arch})",
  "The download was interrupted and could not be resumed. Check the connection, then press Resume.", "A downloaded file is damaged (its checksum does not match). It was removed. Press Resume to download it again.",
  "The disk is full. Free some space, then press Resume.", "The engine archive could not be unpacked.", "Files of this model are missing from the models folder. Press Resume to download them again.",
  "Nothing is sent anywhere: pictures are made on this computer", "This computer ran out of memory for this picture. Choose a smaller quant or picture size under Settings, Providers, Generation, Local models",
  "Qwen-Image-2.1 as Qwen released it.", "A community build of Qwen-Image-2.1 without content refusals.", "Pictures made on this computer by Qwen-Image-2.1. Free, and nothing leaves the computer.",
  "There is not enough free disk space for this download.", "This computer does not have enough memory for this quant. Choose a smaller one.", "The engine has no build for this computer.",
  "A picture is being made with a local model. Remove it when the picture is done.",
];
/** The picture sizes of the host's setting. */
export const PICTURE_SIZES = [{ value: "1024", label: "Large — about 1 megapixel" }, { value: "768", label: "Medium — faster, less memory" }, { value: "512", label: "Small — fastest" }] as const;

/** Decimal units, as the download sizes and the hardware check say them on the host ("9.9 GB", "36.5 MB"). */
export const bytesText = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);
export const installOf = (view: LocalModelsView | null, variant: LocalModelVariant): LocalInstall | undefined => view?.installs.find((install) => install.variant === variant);
export const verdictOf = (view: LocalModelsView | null, variant: LocalModelVariant, quant: LocalModelQuant): LocalVerdict | undefined => view?.verdicts.find((verdict) => verdict.variant === variant && verdict.quant === quant);
/** The quant the card starts on: the one installed or on its way, else the check's recommendation, else the smallest. */
export function defaultQuant(view: LocalModelsView | null, variant: LocalModelVariant): LocalModelQuant {
  return installOf(view, variant)?.quant ?? view?.verdicts.find((verdict) => verdict.variant === variant && verdict.recommended)?.quant ?? "q4";
}
/** A download can start only where the check says the quant can run (or before the check has numbers — the host checks again first). */
export const canDownload = (verdict: LocalVerdict | undefined): boolean => !verdict || verdict.verdict === "well" || verdict.verdict === "slow";
/** "1.2 GB of 9.9 GB · 24.5 MB/s · about 6 min left". */
export function progressText(install: LocalInstall): { text: string; params: Record<string, string> } {
  const params = { done: bytesText(install.bytesDone), total: bytesText(install.bytesTotal) };
  if (!install.rateBps) return { text: "{done} of {total}", params };
  const seconds = Math.max(1, Math.round((install.bytesTotal - install.bytesDone) / install.rateBps));
  return { text: "{done} of {total} · {rate}/s · about {left} left", params: { ...params, rate: bytesText(install.rateBps), left: seconds < 90 ? `${seconds} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h` } };
}
export const percentOf = (install: LocalInstall): number => (install.bytesTotal ? Math.floor((install.bytesDone / install.bytesTotal) * 1000) / 10 : 0);

/** The Image role routes to this local model (its primary profile names it). */
export function usedByImageRole(config: OrcConfig | null | undefined, modelId: string): boolean {
  const role = config?.roles.image, primary = role?.routes.default?.primary.profileId ?? role?.defaultProfileId ?? role?.profiles[0]?.id;
  const profile = role?.profiles.find((entry) => entry.id === primary);
  return !!role?.enabled && profile?.provider === LOCAL_IMAGE_PROVIDER_ID && profile.model === modelId;
}
/**
 * The Image role with this local model first: a profile of its own (made once, kept), its primary; the profile that
 * was the primary becomes the first fallback, so a cloud model still serves when the computer cannot.
 */
export function withLocalImageRole(role: OrcRoleConfig | undefined, modelId: string, label: string): OrcRoleConfig {
  const id = modelId.endsWith("uncensored") ? "local-uncensored" : "local", base: OrcRoleConfig = role ?? { enabled: true, profiles: [], routes: {}, limits: {} };
  const profiles = base.profiles.some((profile) => profile.id === id) ? base.profiles.map((profile) => (profile.id === id ? { ...profile, provider: LOCAL_IMAGE_PROVIDER_ID, model: modelId, enabled: true } : profile)) : [...base.profiles, { id, label, provider: LOCAL_IMAGE_PROVIDER_ID, model: modelId, params: {}, enabled: true, source: "user" as const }];
  const before = base.routes.default?.primary.profileId ?? base.defaultProfileId ?? base.profiles[0]?.id;
  const fallbacks = [...(before && before !== id ? [{ profileId: before }] : []), ...(base.routes.default?.fallbacks ?? []).filter((entry) => entry.profileId !== id && entry.profileId !== before)].slice(0, 5);
  return { ...base, enabled: true, profiles, defaultProfileId: id, routes: { ...base.routes, default: { ...base.routes.default, primary: { profileId: id }, fallbacks } } };
}
