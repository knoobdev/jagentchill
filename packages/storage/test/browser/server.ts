import { createServer, type Server } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join, normalize, sep } from "node:path";

/** Bare specifiers the storage sources import, as the browser resolves them through the page's import map. */
export const IMPORT_MAP = {
  imports: {
    "@jagentchill/editor-core": "/packages/editor-core/src/index.ts",
    "@jagentchill/content": "/packages/content/src/index.ts",
    "@jagentchill/protocol": "/packages/protocol/src/index.ts",
    zod: "/packages/protocol/node_modules/zod/index.js",
    culori: "/packages/storage/node_modules/culori/bundled/culori.min.mjs",
  },
};
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".json": "application/json" };

/**
 * A static server over the repository for the browser harness: `.ts` sources are served with their types stripped
 * (the same erasable-syntax rule Node runs them by), everything else as it is. Listens on a free port of 127.0.0.1.
 */
export async function startHarnessServer(repoRoot: string): Promise<{ origin: string; server: Server; close(): Promise<void> }> {
  const root = await realpath(repoRoot);
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
        const file = await realpath(join(root, path));
        if (file !== root && !file.startsWith(root + sep)) throw new Error("outside the repository");
        const extension = file.slice(file.lastIndexOf("."));
        let body: string | Buffer = await readFile(file);
        if (extension === ".ts") body = stripTypeScriptTypes(body.toString("utf8"));
        if (path.endsWith("harness.html")) body = body.toString("utf8").replace("__IMPORT_MAP__", JSON.stringify(IMPORT_MAP));
        response.writeHead(200, { "content-type": TYPES[extension] ?? "application/octet-stream", "cache-control": "no-store" });
        response.end(body);
      } catch (error) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end(String(error));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, server, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
