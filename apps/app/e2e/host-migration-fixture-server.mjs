// Test-only server for W8 D pairing and legacy-host migration. It runs on the range reserved for this work package.
import { createServerApp } from "../../../server/src/app.ts";
import { encodeOfferUrl } from "../../../packages/protocol/src/index.ts";

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const port = Number(arg("--port"));
const dataDir = arg("--data-dir");
if (port !== 18945 || process.env.JAGENTCHILL_PORT !== "18945" || process.env.JAGENTCHILL_GATEWAY_PORT !== "18946" || !dataDir?.startsWith(".dev/run-w8d-add-host-")) {
  throw new Error("fixture server requires port 18945, gateway port 18946, and a package-D fresh data directory");
}

let app;
app = createServerApp({
  dataDir,
  allowedOrigins: ["http://127.0.0.1:8089"],
  extraRoutes(req, res, path) {
    if (req.method !== "GET") return false;
    if (path === "/__fixture/offer") {
      const offer = app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { rolePreset: "admin", firstDeviceIsAdmin: true });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ url: encodeOfferUrl(offer), gatewayId: offer.gatewayId }));
      return true;
    }
    if (path === "/__fixture/pending") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ requests: app.pairing.pending() }));
      return true;
    }
    return false;
  },
});
await new Promise((resolve, reject) => { app.http.once("error", reject); app.http.listen(port, "127.0.0.1", resolve); });
console.log(JSON.stringify({ ready: true, port, gatewayPort: 18946, dataDir }));
const stop = () => { app.close(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
