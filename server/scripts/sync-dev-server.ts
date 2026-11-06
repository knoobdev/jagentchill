// The JAgentChill Server app without its agents, for the browser e2e of cross-device sync
// (apps/app/e2e/sync.mjs). Sync never uses an agent, so this is the whole of what that test talks to. It prints the
// pairing offer and the codes in the same lines as `src/main.ts`, which the e2e scripts read from the log.
// Usage: JAGENTCHILL_PORT=18930 JAGENTCHILL_DATA_DIR=<dir> JAGENTCHILL_DEV_ALLOWED_ORIGINS=http://localhost:8089 node server/scripts/sync-dev-server.ts
import { resolve } from "node:path";
import { encodeOfferUrl } from "@jagentchill/protocol";
import { createServerApp } from "../src/app.ts";

const port = Number(process.env.JAGENTCHILL_PORT ?? 18930);
const dataDir = resolve(process.env.JAGENTCHILL_DATA_DIR ?? ".dev/sync-dev-data");
const app = createServerApp({ dataDir, allowedOrigins: (process.env.JAGENTCHILL_DEV_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean), health: () => ({ gateway: "not started (sync dev server)" }) });
app.http.listen(port, "127.0.0.1", () => {
  console.log(`[server] listening on 127.0.0.1:${port} (host ${app.host.gatewayId}) — no agents`);
  const offer = app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { firstDeviceIsAdmin: true });
  console.log(`[pairing] Pair a device with this offer (valid 10 minutes):\n  ${encodeOfferUrl(offer)}`);
  app.pairing.listen({
    requested: (request, code) => console.log(`[pairing] "${request.deviceName}" (${request.platform}, ${request.deviceId.slice(0, 8)}) from ${request.sourceAddress} — code ${code}`),
    completed: (request) => console.log(`[pairing] "${request.deviceName}" paired as ${request.role}`),
  });
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { app.close(); process.exit(0); });
