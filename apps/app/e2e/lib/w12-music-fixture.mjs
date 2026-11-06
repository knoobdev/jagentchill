// Local, deterministic Openverse-shaped fixture for W12 music shelf browser checks.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 19104);
if (port !== 19104) throw new Error("W12 music fixture must use port 19104");
let mode = "good", counts = 0;
const id = "9d3f48f1-62a0-4f54-a7d3-9ea112345678";
const tracks = Array.from({ length: 8 }, (_, index) => ({
  id: index ? `${id.slice(0, 24)}${String(index).padStart(12, "0")}` : id,
  title: `Fixture music ${index + 1}`, creator: `Fixture artist ${index + 1}`, creator_url: "https://fixture.invalid/artist",
  url: `https://fixture.invalid/audio/${index + 1}.mp3`, foreign_landing_url: `https://fixture.invalid/track/${index + 1}`,
  license: "cc0", license_version: "", license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  duration: 120000, category: "music", filetype: "mp3", tags: [{ name: "upbeat", accuracy: 0.99 }], genres: ["instrumental"], fields_matched: ["tags"],
}));
const server = createServer((req, res) => {
  if (req.url === "/__state") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ mode, counts })); return; }
  if (req.url?.startsWith("/__mode?")) { mode = new URL(req.url, "http://127.0.0.1").searchParams.get("value") ?? "good"; res.writeHead(200).end("ok"); return; }
  if (req.url?.startsWith("/v1/audio/")) {
    counts++;
    if (mode === "fail") { res.writeHead(503, { "content-type": "application/json" }).end('{"detail":"fixture unavailable"}'); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results: tracks, page_count: 1 })); return;
  }
  res.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => console.log(`[w12 fixture] Openverse-shaped HTTP fixture on 127.0.0.1:${port}`));
