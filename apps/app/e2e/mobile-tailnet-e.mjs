// Headless 390 px mobile tailnet pairing flow. Pairing host/signatures and the native bridge are fixtures;
// this browser proof never starts a Tailscale login or contacts a real host.
import { chromium } from "playwright";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { encodeOfferPayload, handshakeTranscript } from "@jagentchill/protocol";

const base = process.env.E2E_BASE ?? "http://127.0.0.1:8084";
const shots = process.argv[2] ?? ".dev/shots/w8-host-connect-E";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const gateway = generateKeyPairSync("ed25519");
const gatewayId = "cd".repeat(16);
const gatewayPublicKey = gateway.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const offer = { v: 1, offerId: randomBytes(16).toString("base64url"), gatewayId, gatewayPublicKey, addresses: [{ kind: "tailnet", url: "ws://fixture-host.tailnet.ts.net:55750/jagentchill/v1/ws" }], expires_ms: Date.now() + 60_000 };
const offerPayload = encodeOfferPayload(offer);
const pairingLink = `jagentchill://pair#offer=${offerPayload}`;
await page.addInitScript(() => {
  let state = "needs-login";
  window.__JCH_TEST_TAILSCALE_ADAPTER__ = {
    isSupported: true,
    getStatus: async () => state,
    startInteractiveLogin: async () => ({ ok: true }),
    getInteractiveLoginUrl: () => null,
    loginWithAuthKey: async (key) => { if (key !== "fixture-auth-key") return { ok: false }; state = "connected"; return { ok: true }; },
    getProxyAddress: (target) => target === "fixture-host.tailnet.ts.net:55750" ? "127.0.0.1:18962" : null,
  };
});
await page.route("http://127.0.0.1:18962/**", async (route) => {
  const request = route.request();
  const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "*", "content-type": "application/json" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  const path = new URL(request.url()).pathname;
  const body = request.postDataJSON();
  if (path.endsWith("/challenge")) {
    challengeCalls++;
    const gatewayNonce = randomBytes(32).toString("base64url"), ts = Date.now();
    const transcript = handshakeTranscript({ role: "gateway", context: `enrol:${offer.offerId}`, gatewayNonce, deviceNonce: body.deviceNonce, ts, gatewayId, deviceId: body.deviceId, devicePublicKey: body.devicePublicKey, protocolVersion: 1 });
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ requestId: "request-fixture-e", gatewayNonce, ts, gatewayId, gatewaySignature: sign(null, Buffer.from(transcript), gateway.privateKey).toString("base64url") }) });
  }
  if (path.endsWith("/prove")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ expires_ms: Date.now() + 60_000, attemptsRemaining: 5 }) });
  if (path.endsWith("/verify")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ role: "viewer", gatewayName: "Tailnet fixture host", deviceToken: { value: "fixture-device-token-e", expires_ms: Date.now() + 86_400_000 } }) });
  return route.fulfill({ status: 404, headers, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "fixture route not found" } }) });
});
let assertions = 0;
let challengeCalls = 0;
const check = async (condition, name) => { assertions++; if (!condition) throw new Error(`assertion ${assertions} failed: ${name}`); };
try {
  await page.goto(`${base}/pair?offer=${encodeURIComponent(offerPayload)}`, { waitUntil: "networkidle" });
  const link = page.getByLabel("Pairing link").filter({ visible: true }).first();
  await link.waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).filter({ visible: true }).first().click();
  await page.getByTestId("mobile-join-tailnet").waitFor();
  await check(await page.getByText("Join your tailnet", { exact: true }).count() === 1, "native tailnet join step appears before host challenge");
  await check(challengeCalls === 0, "no host challenge is sent before tailnet sign-in");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/e2-mobile-join-tailnet-390.png` });
  await page.getByTestId("mobile-tailnet-auth-key").fill("fixture-auth-key");
  await page.getByTestId("mobile-tailnet-auth-key-submit").click();
  await page.getByText(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 20_000 });
  await check(await page.getByLabel("Verification code").filter({ visible: true }).count() === 1, "six-digit verification follows mocked tailnet join and signed challenge");
  await check(challengeCalls === 1, "one signed challenge reaches the mocked loopback proxy after tailnet sign-in");
  await page.screenshot({ path: `${shots}/e2-mobile-verify-390.png` });
  await page.getByLabel("Verification code").filter({ visible: true }).fill("123456");
  await page.getByText("Tailnet fixture host", { exact: true }).waitFor({ timeout: 20_000 });
  await check(await page.getByText("Tailnet fixture host", { exact: true }).count() > 0, "host pairs through loopback proxy fixture");
  const savedTailnet = await page.evaluate(async () => {
    const request = indexedDB.open("jagentchill-identity", 1);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return await new Promise((resolve, reject) => { const get = db.transaction("hosts", "readonly").objectStore("hosts").get("cd".repeat(16)); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
  });
  await check(savedTailnet?.connections?.[0]?.kind === "tailnet" && savedTailnet.connections[0].tailnetAddress === "fixture-host.tailnet.ts.net:55750", "saved route retains tailnet endpoint metadata rather than ephemeral proxy address");
  await check(errors.length === 0, `browser has no uncaught page errors (${errors.join("; ")})`);
} catch (error) {
  await page.screenshot({ path: `${shots}/e2-mobile-failure-390.png` }).catch(() => undefined);
  console.error(String(error).split("\n")[0]);
  console.error((await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 900));
  errors.push("test failed");
}
await browser.close();
console.log(errors.length ? `FAILED after ${assertions} assertions: ${errors.join("\n")}` : `PASS: ${assertions} assertions at 390×844`);
process.exit(errors.length ? 1 : 0);
