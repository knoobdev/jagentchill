import { createServerApp } from "../../../../server/src/app.ts";
import { encodeOfferUrl } from "../../../../packages/protocol/src/index.ts";

const port = Number(process.env.JAGENTCHILL_PORT);
const gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT);
const dataDir = process.env.JAGENTCHILL_DATA_DIR;
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR;
const expectedRunDir = `${runDir}/remote-host`;
const argPortIndex = process.argv.indexOf("--port");
if (port !== 18953 || gatewayPort !== 18954 || argPortIndex < 0 || process.argv[argPortIndex + 1] !== String(port) || dataDir !== expectedRunDir) {
  throw new Error("tailnet host fixture requires fresh W8U data and assigned server/Gateway ports 18953/18954");
}

const address = "remote-fixture.tailnet.ts.net:18953";
let app;
app = createServerApp({ dataDir, allowedOrigins: ["app://jagentchill"], extraRoutes(_request, response, path) {
  if (path === "/__fixture/offer") {
    const offer = app.pairing.createOffer([{ kind: "tailnet", url: `ws://${address}/jagentchill/v1/ws` }], { rolePreset: "admin", firstDeviceIsAdmin: true });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ url: encodeOfferUrl(offer), gatewayId: offer.gatewayId }));
    return true;
  }
  if (path === "/__fixture/pending") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ requests: app.pairing.pending() }));
    return true;
  }
  return false;
} });

await new Promise((resolve, reject) => { app.http.once("error", reject); app.http.listen(port, "127.0.0.1", resolve); });
console.log(`REMOTE_FIXTURE_READY ${port} ${gatewayPort}`);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => app.close());
