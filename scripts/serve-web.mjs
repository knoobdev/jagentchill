// Serves a static web build of the app (single-page: unknown paths without a file extension fall back to index.html).
// Usage: node scripts/serve-web.mjs <build-dir> [port]
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".dev/build/web");
const port = Number(process.argv[3] ?? 8090);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".ico": "image/x-icon", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2", ".map": "application/json",
};
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(root, path);
  const send = async (target) => {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  };
  // A path with an extension names a file: a missing one is 404, never the page (a script asking for `/build.json`
  // would be handed HTML). Only a path without one is an app route and gets the page.
  if (file.startsWith(root) && extname(file)) return void (await send(file).catch(() => res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("Not found")));
  await send(join(root, "index.html")).catch(() => res.writeHead(404).end());
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://localhost:${port}`));
