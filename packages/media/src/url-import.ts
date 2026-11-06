import { detectMediaType, SNIFF_BYTES } from "./detect.ts";
import { message, type MediaMessage } from "./messages.ts";
import type { QuotaDecision } from "./import-pipeline.ts";

/** "Import from URL": validation, routing and the download itself (progress, cancel, stall timeout, redirect limit). */
export const URL_MAX_LENGTH = 2048;
export const URL_MAX_REDIRECTS = 5;
/** A download that receives no bytes for this long is aborted. */
export const URL_STALL_TIMEOUT_MS = 30_000;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: "empty" | "too-long" | "invalid" | "scheme" | "private-address" };
/** Loopback, private, link-local and metadata addresses are refused (`security-privacy.Outbound request hardening` owns the full rule). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  return false;
}
export function checkImportUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > URL_MAX_LENGTH) return { ok: false, reason: "too-long" };
  let url: URL;
  try { url = new URL(text); } catch { return { ok: false, reason: "invalid" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: "private-address" };
  return { ok: true, url };
}
/**
 * Who fetches: desktop and mobile fetch in the app; the web app fetches directly when the server allows cross-origin
 * requests and otherwise through a connected Gateway — with neither, the link cannot be imported.
 */
export function urlImportRoute(context: { platform: "web" | "desktop" | "mobile"; corsAllowed: boolean; gatewayConnected: boolean }): { route: "direct" | "gateway" } | { route: "blocked"; message: MediaMessage } {
  if (context.platform !== "web" || context.corsAllowed) return { route: "direct" };
  return context.gatewayConnected ? { route: "gateway" } : { route: "blocked", message: message("media.url.needs-gateway") };
}

export class UrlImportError extends Error {
  readonly notice: MediaMessage;
  readonly reason: string;
  constructor(notice: MediaMessage, reason: string) { super(notice.text); this.name = "UrlImportError"; this.notice = notice; this.reason = reason; }
}
/** Where downloaded bytes go. `abort` leaves no partial file. */
export interface DownloadSink {
  write(chunk: Uint8Array): Promise<void> | void;
  close(): Promise<void> | void;
  abort(): Promise<void> | void;
}
export function memorySink(): DownloadSink & { bytes(): Uint8Array } {
  let chunks: Uint8Array[] = [];
  return {
    write: (chunk) => { chunks.push(chunk); },
    close: () => undefined,
    abort: () => { chunks = []; },
    bytes: () => {
      const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
      return out;
    },
  };
}
export type Downloaded = { name: string; mimeType: string; size: number; finalUrl: string; provenance: { source: "url"; url: string } };
const fileNameOf = (url: URL, disposition: string | null): string => {
  const named = disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1] ?? disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let name = named ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
  try { name = decodeURIComponent(name); } catch { /* keep the raw name */ }
  return name.replace(/[\\/]/g, "_") || url.hostname;
};

/**
 * Downloads a media file. The response must have a supported media content type or extension; the declared size and
 * the received size are checked against quota; no bytes for 30 s aborts; at most 5 redirects are followed, each
 * target checked like the first URL. Every failure removes the partial file and names the host.
 */
export async function downloadMedia(options: {
  url: string;
  sink: DownloadSink;
  fetch?: typeof fetch;
  evaluateQuota(bytes: number): Promise<QuotaDecision>;
  onProgress?(state: { received: number; total: number | null; fraction: number | null }): void;
  signal?: AbortSignal;
  stallTimeoutMs?: number;
  maxRedirects?: number;
  /** Extra address check supplied by the platform (resolved addresses on desktop and the Gateway). */
  allowUrl?(url: URL): boolean | Promise<boolean>;
}): Promise<Downloaded> {
  const first = checkImportUrl(options.url);
  if (!first.ok) throw new UrlImportError(message("media.url.failed", { host: hostOf(options.url), reason: first.reason === "private-address" ? "this address is not allowed" : "the link is not valid" }), first.reason);
  const doFetch = options.fetch ?? fetch, stallMs = options.stallTimeoutMs ?? URL_STALL_TIMEOUT_MS, controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);
  let url = first.url, stalled = false, timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs); };
  const failed = (reason: string, code = reason): UrlImportError => new UrlImportError(message("media.url.failed", { host: url.host, reason }), code);
  try {
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      if (options.allowUrl && !(await options.allowUrl(url))) throw failed("this address is not allowed", "private-address");
      arm();
      response = await doFetch(url, { redirect: "manual", signal: controller.signal });
      // A browser hides the redirect target: let it follow, it applies its own limit.
      if (response.type === "opaqueredirect") { arm(); response = await doFetch(url, { redirect: "follow", signal: controller.signal }); break; }
      if (response.status < 300 || response.status >= 400 || !response.headers.get("location")) break;
      if (redirects >= (options.maxRedirects ?? URL_MAX_REDIRECTS)) throw failed("too many redirects", "too-many-redirects");
      await response.body?.cancel().catch(() => undefined);
      const next = checkImportUrl(new URL(response.headers.get("location")!, url).toString());
      if (!next.ok) throw failed(next.reason === "private-address" ? "this address is not allowed" : "the link is not valid", next.reason);
      url = next.url;
    }
    if (!response.ok) throw failed(`the server answered ${response.status}`, "http-status");
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const name = fileNameOf(new URL(response.url || url.toString()), response.headers.get("content-disposition"));
    // A media content type, or a supported extension on a response that is not a page (`application/octet-stream` and the like).
    const isMedia = /^(image|video|audio)\//.test(mimeType), isText = /^text\//.test(mimeType) || /^application\/(json|xhtml\+xml|xml|pdf|javascript)$/.test(mimeType);
    const byHeader = isMedia ? detectMediaType({ name, mimeType }) : isText ? null : detectMediaType({ name });
    if (!byHeader) throw new UrlImportError(message("media.url.not-media"), "not-media");
    const declared = Number(response.headers.get("content-length") ?? NaN), total = Number.isFinite(declared) && declared >= 0 ? declared : null;
    // Nothing is allowed yet when the size is undeclared: the first bytes trigger the check.
    let allowance = 0;
    const check = async (bytes: number) => {
      const decision = await options.evaluateQuota(bytes);
      if (!decision.allowed) throw failed("not enough storage", "quota");
    };
    if (total !== null) { await check(total); allowance = total; }
    const reader = response.body?.getReader();
    if (!reader) throw failed("the server sent no data", "empty");
    let received = 0;
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      // An undeclared or under-declared size is re-checked as the bytes arrive.
      if (received > allowance) { await check(received + SNIFF_BYTES * 256); allowance = received + SNIFF_BYTES * 256; }
      await options.sink.write(value);
      options.onProgress?.({ received, total, fraction: total ? Math.min(1, received / total) : null });
    }
    if (total !== null && received < total) throw failed("the connection closed early", "truncated");
    clearTimeout(timer);
    await options.sink.close();
    return { name, mimeType: byHeader.mimeType, size: received, finalUrl: response.url || url.toString(), provenance: { source: "url", url: options.url.trim().slice(0, 2000) } };
  } catch (error) {
    clearTimeout(timer);
    await Promise.resolve(options.sink.abort()).catch(() => undefined);
    if (error instanceof UrlImportError) throw error;
    if (stalled) throw failed("no data received for 30 seconds", "stalled");
    if (options.signal?.aborted) throw failed("cancelled", "cancelled");
    throw failed(error instanceof Error && error.message ? error.message : "network error", "network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
const hostOf = (raw: string): string => { try { return new URL(raw.trim()).host; } catch { return raw.trim().slice(0, 80); } };
