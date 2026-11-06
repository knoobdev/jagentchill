import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "../support/fixtures.ts";

/**
 * Static server of the browser harness. It serves this package's TypeScript with the types stripped (the same
 * erasable-syntax rule Node applies), the workspace packages and libraries it imports, and the generated fixtures.
 * Bare specifiers are rewritten to URLs here because import maps do not reach module workers.
 */
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const modulesOf = (name: string): string => realpathSync(join(packageRoot, "node_modules", name));
const ROOTS: Record<string, string> = {
  "/media/": packageRoot + "/",
  "/pkg/protocol/": modulesOf("@jagentchill/protocol") + "/",
  "/pkg/editor-core/": modulesOf("@jagentchill/editor-core") + "/",
  // editor-core reads the catalogue data package; it is resolved through editor-core, which depends on it.
  "/pkg/content/": realpathSync(join(modulesOf("@jagentchill/editor-core"), "node_modules/@jagentchill/content")) + "/",
  "/lib/mediabunny/": modulesOf("mediabunny") + "/dist/bundles/",
  "/lib/zod/": realpathSync(join(modulesOf("@jagentchill/protocol"), "node_modules/zod")) + "/",
};
const BARE: Record<string, string> = {
  "@jagentchill/protocol": "/pkg/protocol/src/index.ts",
  "@jagentchill/editor-core": "/pkg/editor-core/src/index.ts",
  "@jagentchill/content": "/pkg/content/src/index.ts",
  mediabunny: "/lib/mediabunny/mediabunny.mjs",
  zod: "/lib/zod/index.js",
};
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const rewrite = (code: string): string => code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'.\/][^"']*)\2/g, (whole, lead: string, quote: string, specifier: string) => (BARE[specifier] ? `${lead}${quote}${BARE[specifier]}${quote}` : whole));

export type HarnessServer = { origin: string; requests: string[]; close(): Promise<void> };
export function startHarnessServer(): Promise<HarnessServer> {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    requests.push(path);
    const send = (status: number, body: Uint8Array | string, type = "text/plain") => {
      // Cross-origin isolation is not needed; `no-store` keeps reruns honest.
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    };
    try {
      if (path === "/") return send(200, readFileSync(join(here, "harness.html")), "text/html");
      if (path.startsWith("/fixtures/")) return send(200, fixture(path.slice("/fixtures/".length)), "application/octet-stream");
      const prefix = Object.keys(ROOTS).find((candidate) => path.startsWith(candidate));
      if (!prefix) return send(404, "not found");
      const file = normalize(join(ROOTS[prefix], path.slice(prefix.length)));
      if (!file.startsWith(ROOTS[prefix]) || !existsSync(file)) return send(404, "not found");
      const source = readFileSync(file, "utf8");
      return send(200, rewrite(extname(file) === ".ts" ? stripTypeScriptTypes(source) : source), TYPES[extname(file)] ?? "application/octet-stream");
    } catch (error) {
      send(500, String(error));
    }
  });
  return new Promise((ready) => server.listen(0, "127.0.0.1", () => {
    const address = server.address() as { port: number };
    ready({ origin: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }) });
  }));
}
