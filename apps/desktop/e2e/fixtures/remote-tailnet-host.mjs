import { appendFileSync } from "node:fs";
import { createServerApp } from "../../../../server/src/app.ts";
import { encodeOfferUrl } from "../../../../packages/protocol/src/index.ts";

const port = Number(process.env.JAGENTCHILL_PORT);
const gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT);
const dataDir = process.env.JAGENTCHILL_DATA_DIR;
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR;
if (port !== 18957 || gatewayPort !== 18958 || process.argv.indexOf("--port") < 0 || process.argv[process.argv.indexOf("--port") + 1] !== "18957" || !dataDir?.startsWith(`${runDir}/remote-host`)) {
  throw new Error("remote tailnet fixture requires isolated ports 18957/18958 and its fresh W8Q data directory");
}
const tailnetAddress = "remote-fixture.tailnet.ts.net:18957";
let app;
app = createServerApp({ dataDir, allowedOrigins: ["app://jagentchill"], extraRoutes(_req, res, path) {
  if (path === "/__fixture/offer") {
    const offer = app.pairing.createOffer([{ kind: "tailnet", url: `ws://${tailnetAddress}/jagentchill/v1/ws` }], { rolePreset: "admin", firstDeviceIsAdmin: true });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ url: encodeOfferUrl(offer), gatewayId: offer.gatewayId }));
    return true;
  }
  if (path === "/__fixture/pending") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ requests: app.pairing.pending() }));
    return true;
  }
  return false;
} });
await new Promise((resolve, reject) => { app.http.once("error", reject); app.http.listen(port, "127.0.0.1", resolve); });
app.http.on("request", (request, response) => {
  if (!request.url?.startsWith("/jagentchill/v1/pair/")) return;
  response.once("finish", () => { if (process.env.JAGENTCHILL_E2E_TRACE) appendFileSync(process.env.JAGENTCHILL_E2E_TRACE, `${request.method} ${request.url} ${response.statusCode}\n`); });
});
console.log(`REMOTE_FIXTURE_READY ${port} ${gatewayPort}`);
const stop = () => app.close();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
