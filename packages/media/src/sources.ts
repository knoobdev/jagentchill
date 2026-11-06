import type { AssetRecord, Provenance } from "@jagentchill/protocol";
import { sha256OfText } from "./hash.ts";
import { message, type MediaMessage } from "./messages.ts";

/**
 * Provenance of every way media enters a library, the bundled starter catalogue handling, and the client-side rules
 * of the Gateway-backed sources (connectors, stock, paired devices). Field names are those of catalogue §12.5.
 */
type P<S extends Provenance["source"]> = Partial<Provenance> & { source: S };
export const provenance = {
  imported: (originalFileName?: string): P<"imported"> => ({ source: "imported", ...(originalFileName ? { originalFileName } : {}) }),
  recorded: (): P<"recorded"> => ({ source: "recorded" }),
  url: (url: string): P<"url"> => ({ source: "url", url: url.slice(0, 2000) }),
  stock: (item: { provider: string; itemId: string; author: string; licence: string; licenceUrl: string; sourceUrl: string; attributionRequired?: boolean }): P<"stock"> => ({ source: "stock", ...item, attributionRequired: item.attributionRequired ?? false }),
  bundled: (item: { itemId: string; licence: string; sourceUrl: string; author?: string }): P<"bundled"> => ({ source: "bundled", ...item, attributionRequired: false }),
  connector: (item: { connector: string; remoteId: string; originalFileName?: string }): P<"connector"> => ({ source: "connector", ...item }),
  device: (deviceId: string, originalFileName?: string): P<"device"> => ({ source: "device", deviceId, ...(originalFileName ? { originalFileName } : {}) }),
  ai: (item: { provider: string; model: string; role: string; jobId: string; prompt?: string; negativePrompt?: string; seed?: number; referenceAssetIds?: string[]; cost?: { amount: number; currency: string }; created_ms?: number }): P<"ai"> => ({ source: "ai", referenceAssetIds: [], ...item }),
  slate: (item: { scriptId: string; sceneId: string; versionId: string; shotId?: string }): P<"slate"> => ({ source: "slate", ...item }),
};
/** Card badges derived from the record. */
export function sourceBadges(asset: AssetRecord): ("AI" | "Slate")[] {
  return [...(asset.provenance?.source === "ai" ? ["AI" as const] : []), ...(asset.kind === "slate" ? ["Slate" as const] : [])];
}
/** Slates are PNGs at the project canvas size capped at 1920 px on the long side. */
export function slateSize(canvas: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, 1920 / Math.max(canvas.width, canvas.height));
  return { width: Math.max(1, Math.round(canvas.width * scale)), height: Math.max(1, Math.round(canvas.height * scale)) };
}
/** The pre-flight item of an export that still contains slate clips; `null` when there is none. */
export const slatePreflight = (slateClipCount: number): MediaMessage | null => (slateClipCount > 0 ? message("media.slates-in-export", { n: slateClipCount }) : null);
/** Provenance survives duplicate, package export/import and cross-project paste: it is copied as it is. */
export const copyProvenance = (source: AssetRecord): Provenance => JSON.parse(JSON.stringify(source.provenance)) as Provenance;

// ------------------------------------------------------------------------------------------------- bundled catalogue
/** One row of a bundled catalogue (`audio-editing.Bundled sound pack`, `stickers-shapes.Starter sticker pack`). */
export type StarterItem = { id: string; title: string; category: string; licence: string; sourceUrl: string; /** Path of the file inside the app bundle. */ file?: string; kind?: "music" | "sfx" | "sticker" };
/** Licences a bundled item may carry: CC0-1.0, or authored by the project. */
export const STARTER_LICENCES = ["CC0-1.0", "JAgentChill"] as const;
export type CatalogueProblem = { id: string; problem: "duplicate-id" | "licence" | "missing-field" };
/** Checks a catalogue the way the licence gate does: every row complete, ids unique, licence allowed. */
export function checkStarterCatalogue(items: StarterItem[]): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [], seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) problems.push({ id: item.id, problem: "duplicate-id" });
    seen.add(item.id);
    if (!(STARTER_LICENCES as readonly string[]).includes(item.licence)) problems.push({ id: item.id, problem: "licence" });
    if (![item.id, item.title, item.category, item.sourceUrl].every((value) => typeof value === "string" && value.length > 0)) problems.push({ id: item.id, problem: "missing-field" });
  }
  return problems;
}
/**
 * What the import pipeline receives when a starter item is used in a project: the item's bytes with `bundled`
 * provenance. Deduplication by content hash stores the bytes once per device however many projects use the item.
 */
export function starterImport(item: StarterItem, extension: string): { name: string; provenance: P<"bundled"> } {
  return { name: `${item.title}.${extension}`, provenance: provenance.bundled({ itemId: item.id, licence: item.licence, sourceUrl: item.sourceUrl }) };
}
/** Search over a sounds catalogue by title and category, diacritic- and case-insensitive. [PORT: sound search of OpenCut classic `sounds/`] */
export function searchStarterItems<T extends StarterItem>(items: T[], query: string, category?: string): T[] {
  const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(query.trim());
  return items.filter((item) => (!category || item.category === category) && (needle === "" || fold(`${item.title} ${item.category}`).includes(needle)));
}
/** Waveform key of a library sound that is not a project asset. */
export const librarySoundKey = (url: string): string => sha256OfText(url);

// --------------------------------------------------------------------------------------- Gateway-backed sources
export const CONNECTORS = { "google-drive": { label: "Google Drive", scopes: ["drive.readonly"] }, dropbox: { label: "Dropbox", scopes: ["files.content.read", "files.metadata.read"] } } as const;
export type ConnectorId = keyof typeof CONNECTORS;
export const CONNECTOR_PAGE_SIZE = 50;
export const CONNECTOR_MAX_SELECTION = 100;
export const STOCK_PAGE_SIZE = 30;
export const TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024;
/** The Import-menu item of a connector: enabled only with a connected Gateway that advertises the `connectors` feature. */
export function connectorMenuItem(connector: ConnectorId, host: { connected: boolean; features: readonly string[]; name?: string; configured?: boolean } | null, role: "admin" | "editor" | "viewer"): { enabled: boolean; hint: MediaMessage | null; opens: "browser" | "setup-sheet" | null; setupLink: boolean } {
  const label = CONNECTORS[connector].label;
  if (!host || !host.connected || !host.features.includes("connectors")) return { enabled: false, hint: message("media.connector.needs-host", { connector: label }), opens: null, setupLink: false };
  if (!host.configured) return { enabled: true, hint: message("media.connector.setup", { connector: label, host: host.name ?? "the host" }), opens: "setup-sheet", setupLink: role === "admin" };
  return { enabled: role !== "viewer", hint: null, opens: role === "viewer" ? null : "browser", setupLink: false };
}
/** Job errors of `connector.transfer` mapped to their messages. */
export function connectorErrorMessage(connector: ConnectorId, error: { code: string; fileName?: string }): MediaMessage {
  const label = CONNECTORS[connector].label;
  switch (error.code) {
    case "connector/auth-expired": case "connector/auth-revoked": return message("media.connector.reconnect", { connector: label });
    case "connector/rate-limited": return message("media.connector.busy", { connector: label });
    case "connector/file-gone": return message("media.connector.gone", { name: error.fileName ?? "" });
    default: return message("media.url.failed", { host: label, reason: error.code });
  }
}
/** Multi-selection in a connector browser is capped at 100 files. */
export const toggleConnectorSelection = (selected: string[], id: string): string[] => (selected.includes(id) ? selected.filter((entry) => entry !== id) : selected.length >= CONNECTOR_MAX_SELECTION ? selected : [...selected, id]);

/** "Send from phone": the code carries no secret — only the project id and the Gateway id. */
export const sendFromPhonePayload = (projectId: string, gatewayId: string): string => `jagentchill://send?project=${encodeURIComponent(projectId)}&host=${encodeURIComponent(gatewayId)}`;
export function parseSendFromPhonePayload(payload: string): { projectId: string; gatewayId: string } | null {
  const match = payload.match(/^jagentchill:\/\/send\?(.*)$/);
  if (!match) return null;
  const params = new URLSearchParams(match[1]), projectId = params.get("project"), gatewayId = params.get("host");
  return projectId && gatewayId && [...params.keys()].every((key) => key === "project" || key === "host") ? { projectId, gatewayId } : null;
}
/** What a phone that opened the code may do. No media is accepted before pairing is approved; a viewer is refused. */
export function sendFromPhoneAccess(device: { paired: boolean; role?: "admin" | "editor" | "viewer" }): { allowed: true } | { allowed: false; next: "pair" } | { allowed: false; next: "refuse"; message: MediaMessage } {
  if (!device.paired) return { allowed: false, next: "pair" };
  return device.role === "viewer" ? { allowed: false, next: "refuse", message: message("media.devices.viewer") } : { allowed: true };
}
/** Chunks of a content-addressed transfer still to send or fetch: it resumes from the last completed 4 MiB chunk. */
export function remainingChunks(size: number, completedChunks: number, chunkBytes = TRANSFER_CHUNK_BYTES): { index: number; start: number; end: number }[] {
  const chunks: { index: number; start: number; end: number }[] = [];
  for (let index = Math.max(0, completedChunks), count = Math.ceil(size / chunkBytes); index < count; index++) chunks.push({ index, start: index * chunkBytes, end: Math.min(size, (index + 1) * chunkBytes) });
  return chunks;
}
/** The Library (stock) section when it has nothing to list. */
export function stockSectionState(context: { enabledSources: number; gatewayConnected: boolean; role: "admin" | "editor" | "viewer" }): { state: "ready" } | { state: "connect"; message: MediaMessage; link: boolean } {
  if (context.enabledSources > 0 && context.gatewayConnected) return { state: "ready" };
  return context.role === "admin" ? { state: "connect", message: message("media.stock.connect"), link: true } : { state: "connect", message: message("media.stock.ask-admin"), link: false };
}
