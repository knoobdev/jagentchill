import net from "node:net";
import { writeFileSync } from "node:fs";

const mode = process.env.FAKE_TSNET_MODE ?? "ready";
const out = (line) => process.stdout.write(`${line}\n`);
let forwarder;
if (process.env.FAKE_TSNET_ENV_CAPTURE) writeFileSync(process.env.FAKE_TSNET_ENV_CAPTURE, JSON.stringify({ hasAuthKey: Object.hasOwn(process.env, "TS_AUTHKEY"), stateDir: process.env.TS_STATE_DIR }));
if (mode === "login" || mode === "login-ready") out("TSNET_LOGIN_URL https://login.tailscale.com/a/fake-token");
if (mode === "error") out("TSNET_ERROR simulated bridge failure");
if (mode === "exit") process.exit(7);
if (mode === "ready" || mode === "login-ready") {
  setTimeout(() => {
    const forwardPort = Number(process.env.FAKE_TSNET_FORWARD_PORT ?? 0);
    const localPort = Number(process.env.JAGENTCHILL_TAILNET_LOCAL_PORT ?? 0);
    if (forwardPort && localPort) {
      forwarder = net.createServer((remote) => {
        const local = net.connect(localPort, "127.0.0.1");
        local.pipe(remote);
        let request = Buffer.alloc(0);
        const onData = (chunk) => {
          request = Buffer.concat([request, chunk]);
          const end = request.indexOf("\r\n\r\n");
          if (end < 0) return;
          const headers = request.subarray(0, end).toString("latin1");
          const rest = request.subarray(end + 4);
          local.write(`${headers}\r\nX-JAgentChill-Tailnet-Ingress: ${process.env.JAGENTCHILL_TAILNET_INGRESS_TOKEN}\r\n\r\n`);
          if (rest.length) local.write(rest);
          request = Buffer.alloc(0);
          remote.off("data", onData);
          remote.pipe(local);
        };
        remote.on("data", onData);
        remote.on("error", () => local.destroy());
        local.on("error", () => remote.destroy());
      });
      forwarder.listen(forwardPort, "127.0.0.1");
    }
    out("TSNET_READY fake-host.example.ts.net 43111");
    if (process.env.FAKE_TSNET_EXIT_AFTER_READY_MS) setTimeout(() => process.exit(7), Number(process.env.FAKE_TSNET_EXIT_AFTER_READY_MS));
  }, Number(process.env.FAKE_TSNET_DELAY_MS ?? 25));
}
process.on("SIGTERM", () => { forwarder?.close(); process.exit(0); });
process.on("SIGINT", () => { forwarder?.close(); process.exit(0); });
setInterval(() => {}, 60_000);
