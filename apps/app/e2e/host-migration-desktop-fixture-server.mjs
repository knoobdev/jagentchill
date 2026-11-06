// Isolated pairing host for the real Electron protected-store migration e2e.
import { createServerApp } from "../../../server/src/app.ts";
import { encodeOfferUrl } from "../../../packages/protocol/src/index.ts";

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const port = Number(arg("--port"));
const dataDir = arg("--data-dir");
if (port !== 18957 || process.env.JAGENTCHILL_PORT !== "18957" || process.env.JAGENTCHILL_GATEWAY_PORT !== "18958" || !dataDir?.startsWith(`${process.env.JAGENTCHILL_E2E_RUN_DIR}/remote-host`)) {
  throw new Error("fixture server requires ports 18957/18958 and a fresh W8 B reload test data directory");
}

let app;
app = createServerApp({
  dataDir,
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
console.log(JSON.stringify({ ready: true, port, gatewayPort: 18958, dataDir }));
const stop = () => app.close();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
