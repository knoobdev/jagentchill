// A JAgentChill Server for the supervisor tests: the real server application (identity, devices, bootstrap, product
// channel), with a delay before it listens. While it waits it can also accept connections
// and drop them, as a port that answers before the server is ready does.
import { createServer } from "node:net";
import { createServerApp } from "@jagentchill/server/src/app.ts";

const args = process.argv.slice(2);
const dataDir = args[args.indexOf("--data-dir") + 1], port = Number(args[args.indexOf("--port") + 1]);
const delay = Number(process.env.JC_TEST_LISTEN_DELAY_MS ?? 0);
const exitAfter = Number(process.env.JC_TEST_EXIT_AFTER_MS ?? 0);
const { bootstrapFirstDevice } = await import(new URL("../../../../server/src/devices/bootstrap.ts", import.meta.url).href);
const app = createServerApp({ dataDir, allowedOrigins: [] });
bootstrapFirstDevice({ devices: app.devices, dataDir, publicKey: process.env.JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY });
const dropper = process.env.JC_TEST_DROP_CONNECTIONS === "1" ? createServer((socket) => socket.destroy()).listen(port, "127.0.0.1") : null;
setTimeout(() => {
  const listen = () => app.http.listen(port, "127.0.0.1", () => console.log(`[server] listening on 127.0.0.1:${port}`));
  if (dropper) dropper.close(listen); else listen();
}, delay);
if (exitAfter > 0) setTimeout(() => process.exit(1), exitAfter);
process.on("SIGTERM", () => { try { app.close(); } catch { /* closing */ } process.exit(0); });
