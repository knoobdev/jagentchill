/**
 * The build this page was loaded with, read from the page itself (`scripts/finish-web-export.mjs` writes it into
 * `index.html`). The page puts it on the address of every worker it starts and of every file it hands a worker — the
 * engine's script, its wasm, its fonts, its probe clip — so that the service worker (`public/sw.js`) answers them from
 * this build's files even after a newer build has taken over in another tab. A worker never has to be recognised.
 */
export function pageBuild(scope: { document?: { querySelector(selector: string): { getAttribute(name: string): string | null } | null } } = globalThis as never): string | null {
  const id = scope.document?.querySelector('meta[name="jagentchill-build"]')?.getAttribute("content");
  return id && /^[0-9a-f]{6,64}$/.test(id) ? id : null;
}

/**
 * A path of the app (`/wasm/…`) with this page's build on it — whenever the page names its build, also on a first
 * visit before the service worker answers the page: the engine keeps the addresses it was started with and goes on
 * using them after the worker has taken over. Unchanged in development and in the desktop and mobile apps, whose page
 * names no build. Never an object URL, a data URL or an address of a host.
 */
export function ofThisBuild(url: string, scope: { document?: unknown } = globalThis as never): string {
  const build = pageBuild(scope as never);
  if (!build || !/^\/(?!\/)/.test(url)) return url;
  const [address, fragment = ""] = url.split("#");
  return `${address}${address.includes("?") ? "&" : "?"}build=${build}${fragment ? `#${fragment}` : ""}`;
}
