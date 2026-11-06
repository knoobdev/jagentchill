export const APP_SCHEME = "app";
export const APP_HOST = "jagentchill";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const GATEWAY_MEDIA_SCHEME = "jagentchill-gw";
export const FILE_SCHEME = "jagentchill-file";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", wasm: "application/wasm", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", ttf: "font/ttf", otf: "font/otf", woff: "font/woff",
  woff2: "font/woff2", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain; charset=utf-8", cube: "text/plain; charset=utf-8",
};
export const mimeOf = (path: string): string => MIME[/\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? ""] ?? "application/octet-stream";

export type AppRequest =
  | { status: 200; file: string; mime: string; fallback: boolean }
  | { status: 404 };

/**
 * Maps a request of the app scheme to a file of the bundled web export. Only `app://jagentchill/…` is served; a path
 * that leaves the bundle directory in any spelling is 404 and nothing is read. A route of the single-page app (a path
 * without a file extension that names no file) is answered with `index.html`.
 */
export function resolveAppRequest(url: string, bundle: { root: string; separator: "/" | "\\"; isFile(path: string): boolean }): AppRequest {
  // The raw text is checked before any parser normalises it: `..` never reaches the file system in any encoding.
  const match = /^app:\/\/([^/?#]*)(\/[^?#]*)?(?:[?#].*)?$/i.exec(url);
  if (!match || match[1].toLowerCase() !== APP_HOST) return { status: 404 };
  let path: string;
  try { path = decodeURIComponent(match[2] ?? "/"); } catch { return { status: 404 }; }
  if (/[\u0000-\u001f\\:]/.test(path)) return { status: 404 };
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === ".." || /%2e|%2f|%5c/i.test(part))) return { status: 404 };
  const root = bundle.root.replace(/[\\/]+$/, "");
  const file = [root, ...parts].join(bundle.separator);
  if (parts.length > 0 && bundle.isFile(file)) return { status: 200, file, mime: mimeOf(file), fallback: false };
  const last = parts[parts.length - 1] ?? "";
  // An asset that is missing stays missing; only a route gets the app shell.
  if (/\.[A-Za-z0-9]{1,8}$/.test(last)) return { status: 404 };
  const index = [root, "index.html"].join(bundle.separator);
  return bundle.isFile(index) ? { status: 200, file: index, mime: MIME.html, fallback: parts.length > 0 } : { status: 404 };
}

export type ConnectInputs = {
  /** The loopback port of the built-in host's server; never the Gateway port. */
  serverPort?: number;
  /** `http(s)://host[:port]` origins of paired hosts whose address the renderer reaches directly. */
  pairedOrigins?: readonly string[];
  /** Hosts of the external-hosts table that are enabled on this device. */
  egressHosts?: readonly string[];
};
/** `connect-src`, recomputed whenever a host is paired or forgotten or an egress switch changes. */
export function connectSources(input: ConnectInputs): string[] {
  const sources = ["'self'", "app:", "blob:", "data:", `${GATEWAY_MEDIA_SCHEME}:`, `${FILE_SCHEME}:`];
  const add = (source: string) => { if (!sources.includes(source)) sources.push(source); };
  if (input.serverPort) { add(`http://127.0.0.1:${input.serverPort}`); add(`ws://127.0.0.1:${input.serverPort}`); }
  for (const origin of input.pairedOrigins ?? []) {
    const match = /^(https?):\/\/(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/i.exec(origin);
    if (!match) continue;
    const secure = match[1].toLowerCase() === "https", host = `${match[2].toLowerCase()}${match[3] ?? ""}`;
    add(`${secure ? "https" : "http"}://${host}`);
    add(`${secure ? "wss" : "ws"}://${host}`);
  }
  for (const host of input.egressHosts ?? []) if (/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) add(`https://${host.toLowerCase()}`);
  return sources;
}

/** The product's one Content-Security-Policy, as the desktop app applies it to every `app://` response. */
export function contentSecurityPolicy(input: ConnectInputs = {}): string {
  const desktop = `${GATEWAY_MEDIA_SCHEME}: ${FILE_SCHEME}:`;
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${desktop}`,
    `media-src 'self' blob: ${desktop}`,
    "font-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // The app's own scripts start their workers from blob: URLs. Without this directive `script-src` is the fallback and every worker is refused.
    "worker-src 'self' blob:",
    `connect-src ${connectSources(input).join(" ")}`,
  ].join("; ");
}
/** The render host loads the engine and nothing from any network. */
export const renderHostCsp = (): string => contentSecurityPolicy({}).replace(/connect-src [^;]+$/, "connect-src app: blob: data: jagentchill-file:");

/** Every window is created with exactly these flags. */
export const WEB_PREFERENCES = {
  contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
} as const;

/** A window never leaves the app origin. */
export const navigationAllowed = (url: string): boolean => {
  try { const parsed = new URL(url); return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST; } catch { return false; }
};
/** `https:` and `mailto:` links go to the system browser after validation; every other scheme is refused. */
export function externalOpen(url: string): { open: true; url: string } | { open: false; scheme: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { open: false, scheme: "invalid" }; }
  if (parsed.protocol === "https:" && parsed.hostname !== "" && parsed.username === "" && parsed.password === "") return { open: true, url: parsed.toString() };
  if (parsed.protocol === "mailto:" && /^[^\s?]+@[^\s?]+/.test(parsed.pathname)) return { open: true, url: parsed.toString() };
  return { open: false, scheme: parsed.protocol.replace(/:$/, "") };
}

export const GRANTED_PERMISSIONS = ["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock", "notifications", "display-capture"] as const;
/** Permission requests are denied unless the permission is in the short list and the request comes from the app itself. */
export function permissionGranted(permission: string, requestingUrl: string, details: { userGesture?: boolean } = {}): boolean {
  if (!navigationAllowed(requestingUrl)) return false;
  if (!(GRANTED_PERMISSIONS as readonly string[]).includes(permission)) return false;
  // The eyedropper and screen recording start from a person's action, never from script alone.
  return permission !== "display-capture" || details.userGesture === true;
}

/** The caller of an IPC channel must be a frame of the app itself. */
export const senderAllowed = (frameUrl: string | undefined | null): boolean => typeof frameUrl === "string" && navigationAllowed(frameUrl);
