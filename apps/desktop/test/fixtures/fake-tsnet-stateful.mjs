#!/usr/bin/env node
// Isolated test bridge with a loopback-only authenticated forwarder. The configured target is a local fixture host;
// no Tailscale client, DNS lookup, external service, or provider is used.
import { timingSafeEqual } from "node:crypto";
import { createConnection } from "node:net";
import { createServer, request as httpRequest } from "node:http";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const stateFile = process.env.TSNET_TEST_STATE_FILE;
const secret = process.env.JAGENTCHILL_TAILNET_PROXY_SECRET ?? "";
const targetAddress = process.env.TSNET_TEST_PROXY_TARGET ?? "";
const advertisedAddress = process.env.TSNET_TEST_TAILNET_ADDRESS ?? "jc-test.tailnet.ts.net:18955";
const targetRoutes = (() => { try { return JSON.parse(process.env.TSNET_TEST_PROXY_ROUTES ?? "{}"); } catch { return {}; } })();
const trace = (message) => { if (process.env.TSNET_TEST_PROXY_TRACE) appendFileSync(process.env.TSNET_TEST_PROXY_TRACE, `${message}\n`); };
if (!stateFile || secret.length < 32 || !targetAddress) process.exit(2);
const readState = () => { try { return readFileSync(stateFile, "utf8").trim(); } catch { return "login"; } };
const initial = readState();
console.log("TSNET_LOGIN_URL https://login.tailscale.com/example-host-login");
const hasAuthKey = Boolean(process.env.TS_AUTHKEY);
const connectAfterMs = Number(process.env.TSNET_TEST_CONNECT_AFTER_MS ?? 0);
if (hasAuthKey) writeFileSync(`${stateFile}.auth-key-seen`, "auth-key-present", { flag: "w" });
let connected = false;
let previousMode;
let proxy;
let proxyPort;
let ingressForwarder;

function startIngressForwarder() {
  const forwardPort = Number(process.env.FAKE_TSNET_FORWARD_PORT ?? 0);
  const localPort = Number(process.env.JAGENTCHILL_TAILNET_LOCAL_PORT ?? 0);
  const ingressToken = process.env.JAGENTCHILL_TAILNET_INGRESS_TOKEN ?? "";
  if (!forwardPort || !localPort || !ingressToken || ingressForwarder) return;
  ingressForwarder = createServer((remote) => {
    const local = createConnection(localPort, "127.0.0.1");
    local.pipe(remote);
    let request = Buffer.alloc(0);
    const onData = (chunk) => {
      request = Buffer.concat([request, chunk]);
      const end = request.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headers = request.subarray(0, end).toString("latin1");
      const rest = request.subarray(end + 4);
      local.write(`${headers}\r\nX-JAgentChill-Tailnet-Ingress: ${ingressToken}\r\n\r\n`);
      if (rest.length) local.write(rest);
      remote.off("data", onData);
      remote.pipe(local);
    };
    remote.on("data", onData);
    remote.on("error", () => local.destroy());
    local.on("error", () => remote.destroy());
  });
  ingressForwarder.listen(forwardPort, "127.0.0.1");
}

function loopback(request) {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
function authorized(request, websocket = false) {
  if (websocket) {
    return (request.headers["sec-websocket-protocol"] ?? "").split(",").map((item) => item.trim()).some((item) => {
      const supplied = item.startsWith("jagentchill.proxy.") ? item.slice("jagentchill.proxy.".length) : "";
      return supplied.length === secret.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
    });
  }
  const supplied = request.headers["x-jagentchill-tailnet-proxy"] ?? "";
  return supplied.length === secret.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}
function parseTarget(path) {
  const prefix = "/_jagentchill/tailnet/";
  if (!path.startsWith(prefix)) return null;
  const remaining = path.slice(prefix.length);
  const slash = remaining.indexOf("/");
  if (slash <= 0) return null;
  let target;
  try { target = decodeURIComponent(remaining.slice(0, slash)); } catch { return null; }
  if (target !== advertisedAddress && !Object.hasOwn(targetRoutes, target)) return null;
  return { target, rest: remaining.slice(slash) || "/" };
}
function targetParts(address = advertisedAddress) {
  const destination = targetRoutes[address] ?? targetAddress;
  const split = destination.lastIndexOf(":");
  if (split < 1) throw new Error("test proxy target must be host:port");
  return { host: destination.slice(0, split), port: Number(destination.slice(split + 1)) };
}
function startProxy() {
  if (proxy) return;
  proxy = createServer((request, response) => {
    const parsed = parseTarget(request.url ?? "");
    if (!loopback(request) || !authorized(request) || !parsed) { response.writeHead(403, { connection: "close" }).end(); return; }
    const destination = targetParts(parsed.target);
    const headers = { ...request.headers, host: parsed.target };
    delete headers["x-jagentchill-tailnet-proxy"];
    const upstream = httpRequest({ hostname: destination.host, port: destination.port, method: request.method, path: parsed.rest, headers }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.statusMessage, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
    request.pipe(upstream);
  });
  proxy.on("upgrade", (request, socket, head) => {
    const parsed = parseTarget(request.url ?? "");
    if (!loopback(request) || !authorized(request, true) || !parsed || request.headers.origin !== "app://jagentchill") {
      trace(`reject loopback=${loopback(request)} auth=${authorized(request, true)} target=${Boolean(parsed)} origin=${request.headers.origin ?? ""}`);
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const destination = targetParts(parsed.target);
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((item) => item.trim()).filter((item) => item && !item.startsWith("jagentchill.proxy."));
    const upstream = createConnection(destination);
    upstream.once("connect", () => {
      trace(`dial ${parsed.target} ${destination.host}:${destination.port} path=${parsed.rest}`);
      const headers = Object.entries(request.headers)
        .filter(([name]) => name !== "host" && name !== "sec-websocket-protocol" && name !== "x-jagentchill-tailnet-proxy")
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      headers.push(`Host: ${parsed.target}`);
      if (protocols.length) headers.push(`Sec-WebSocket-Protocol: ${protocols.join(", ")}`);
      upstream.write(`GET ${parsed.rest} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      let responseBuffer = Buffer.alloc(0), upgradeReplied = false;
      upstream.on("data", (chunk) => {
        if (upgradeReplied) { socket.write(chunk); return; }
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        const end = responseBuffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        let responseHead = responseBuffer.subarray(0, end + 4).toString("latin1");
        trace(`upstream ${parsed.target} ${responseHead.split("\r\n", 1)[0]}`);
        if (responseHead.startsWith("HTTP/1.1 101 ") && !/^sec-websocket-protocol:/im.test(responseHead)) {
          responseHead = responseHead.replace(/\r\n\r\n$/, `\r\nSec-WebSocket-Protocol: jagentchill.proxy.${secret}\r\n\r\n`);
        }
        socket.write(Buffer.concat([Buffer.from(responseHead, "latin1"), responseBuffer.subarray(end + 4)]));
        responseBuffer = Buffer.alloc(0);
        upgradeReplied = true;
      });
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  proxy.listen(Number(process.env.TSNET_TEST_PROXY_PORT ?? 0), "127.0.0.1", () => {
    proxyPort = proxy.address().port;
    console.log(`TSNET_READY ${advertisedAddress.split(":")[0]} ${proxyPort}`);
  });
}
function stopProxy() {
  if (!proxy) return;
  const current = proxy;
  proxy = undefined;
  proxyPort = undefined;
  current.close();
}
const update = () => {
  const mode = readState();
  const next = mode === "connected" || (hasAuthKey && mode === "auth");
  if (mode !== previousMode) { trace(`state ${mode} connected=${next}`); previousMode = mode; }
  if (next && !connected) { connected = true; startProxy(); }
  else if (!next && connected) { connected = false; stopProxy(); console.log("TSNET_LOGIN_URL https://login.tailscale.com/example-host-login"); }
};
startIngressForwarder();
if (initial === "connected") update();
if (initial === "delayed" && connectAfterMs > 0) setTimeout(() => { writeFileSync(stateFile, "connected\n"); update(); }, connectAfterMs);
const timer = setInterval(update, 100);
function stop() { clearInterval(timer); stopProxy(); ingressForwarder?.close(); process.exit(0); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
