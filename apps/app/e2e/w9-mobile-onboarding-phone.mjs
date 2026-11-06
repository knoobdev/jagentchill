// Browser-only 390 px check. Pairing host and Tailscale are browser fixtures; no real host or tailnet is contacted.
import { chromium } from "playwright";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { encodeOfferPayload, handshakeTranscript } from "@jagentchill/protocol";

const base = process.env.E2E_BASE ?? "http://127.0.0.1:8098";
const fixturePort = Number(process.env.W9_ONBOARDING_FIXTURE_PORT ?? 19110);
const shots = process.argv[2] ?? ".dev/shots/w9-mobile-onboarding";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const gateway = generateKeyPairSync("ed25519");
const gatewayId = "e1".repeat(16);
const gatewayPublicKey = gateway.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const offer = { v: 1, offerId: randomBytes(16).toString("base64url"), gatewayId, gatewayPublicKey, addresses: [{ kind: "tailnet", url: `ws://fixture-host.tailnet.ts.net:${fixturePort}/jagentchill/v1/ws` }], expires_ms: Date.now() + 60_000 };
const offerPayload = encodeOfferPayload(offer);
const pairingLink = `jagentchill://pair#offer=${offerPayload}`;
await page.addInitScript((port) => {
  let state = "needs-login";
  window.__JCH_TEST_TAILSCALE_ADAPTER__ = {
    isSupported: true,
    getStatus: async () => state,
    startInteractiveLogin: async () => ({ ok: true }),
    getInteractiveLoginUrl: () => "https://login.tailscale.com/a/onboarding-fixture",
    loginWithAuthKey: async (key) => { if (key !== "fixture-auth-key") return { ok: false }; state = "connected"; return { ok: true }; },
    getProxyAddress: (target) => target === `fixture-host.tailnet.ts.net:${port}` ? `127.0.0.1:${port}` : null,
  };
}, fixturePort);
let challengeCalls = 0;
let rejectFirstCode = true;
await page.route(`http://127.0.0.1:${fixturePort}/**`, async (route) => {
  const request = route.request();
  const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "*", "content-type": "application/json" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  const path = new URL(request.url()).pathname;
  const body = request.postDataJSON();
  if (path.endsWith("/challenge")) {
    challengeCalls++;
    const gatewayNonce = randomBytes(32).toString("base64url"), ts = Date.now();
    const transcript = handshakeTranscript({ role: "gateway", context: `enrol:${offer.offerId}`, gatewayNonce, deviceNonce: body.deviceNonce, ts, gatewayId, deviceId: body.deviceId, devicePublicKey: body.devicePublicKey, protocolVersion: 1 });
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ requestId: "request-w9-onboarding", gatewayNonce, ts, gatewayId, gatewaySignature: sign(null, Buffer.from(transcript), gateway.privateKey).toString("base64url") }) });
  }
  if (path.endsWith("/prove")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ expires_ms: Date.now() + 60_000, attemptsRemaining: 5 }) });
  if (path.endsWith("/verify") && body.code && rejectFirstCode) {
    rejectFirstCode = false;
    return route.fulfill({ status: 400, headers, body: JSON.stringify({ error: { code: "CODE_INVALID", message: "wrong code", details: { attemptsRemaining: 4 } } }) });
  }
  if (path.endsWith("/verify")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ role: "viewer", gatewayName: "JAgentChill", deviceToken: { value: "fixture-device-token-w9", expires_ms: Date.now() + 86_400_000 } }) });
  return route.fulfill({ status: 404, headers, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "fixture route not found" } }) });
});

let assertions = 0;
const check = async (condition, name) => { assertions++; if (!condition) throw new Error(`assertion ${assertions} failed: ${name}`); };
try {
  await page.goto(`${base}/welcome`, { waitUntil: "networkidle" });
  await page.getByText("Connect your computer to get started", { exact: true }).waitFor();
  const welcomeActions = page.locator("[role=button]");
  await check(await welcomeActions.filter({ hasText: "Scan QR code" }).count() === 1, "welcome puts Scan QR code first");
  await check(await welcomeActions.filter({ hasText: "Paste pairing link" }).count() === 1, "welcome offers Paste pairing link second");
  await check(await page.getByText("Direct connection", { exact: true }).count() === 0, "phone welcome has only the two pairing choices");
  await page.screenshot({ path: `${shots}/welcome-390-browser-only.png` });

  await page.goto(`${base}/pair-start`, { waitUntil: "networkidle" });
  await page.getByText("Connect your computer to get started", { exact: true }).waitFor();
  await check(await page.getByText("Scan QR code", { exact: true }).count() === 1, "pair-start uses the same scan action");
  await check(await page.getByText("Paste pairing link", { exact: true }).count() === 1, "pair-start uses the same paste action");
  await page.screenshot({ path: `${shots}/pair-start-390-browser-only.png` });

  await page.getByText("Scan QR code", { exact: true }).click();
  await page.getByText("Camera scanning is not available on web.", { exact: true }).waitFor();
  await check(await page.getByRole("button", { name: "Paste pairing link", exact: true }).isVisible(), "browser QR fallback offers Paste instead");
  await page.screenshot({ path: `${shots}/scan-web-fallback-390-browser-only.png` });

  await page.goto(`${base}/pair-link?link=${encodeURIComponent(pairingLink)}`, { waitUntil: "networkidle" });
  await page.getByTestId("mobile-join-tailnet").waitFor();
  await check(await page.getByText("Your phone reaches your computer over Tailscale. Sign in with the same Tailscale account as the computer.", { exact: true }).isVisible(), "tailnet screen explains why and requires the computer's account");
  await page.getByTestId("mobile-tailnet-sign-in").click();
  await page.getByTestId("tailscale-waiting").waitFor();
  await check(await page.getByText("Finish signing in in the browser…", { exact: true }).isVisible(), "waiting state explains the browser sign-in step");
  await check(await page.getByTestId("tailscale-open-login").isVisible(), "waiting state can reopen the sign-in page");
  await check(await page.getByTestId("tailscale-cancel-waiting").isVisible(), "waiting state offers Cancel");
  await page.screenshot({ path: `${shots}/tailnet-waiting-390-browser-only.png` });
  await page.getByTestId("tailscale-cancel-waiting").click();
  await check(await page.getByText("Connect your computer to get started", { exact: true }).isVisible(), "Cancel exits pairing and returns to the connection choices");

  await page.goto(`${base}/pair-link?link=${encodeURIComponent(pairingLink)}`, { waitUntil: "networkidle" });
  await page.getByTestId("mobile-join-tailnet").waitFor();
  await page.getByTestId("mobile-tailnet-auth-key").fill("fixture-auth-key");
  await page.getByTestId("mobile-tailnet-auth-key-submit").click();
  await page.getByText("Verify pairing", { exact: true }).waitFor({ timeout: 20_000 });
  await check(challengeCalls === 1, "host challenge starts only after the fake phone adapter signs in");
  await check(await page.getByText("Host: JAgentChill", { exact: true }).isVisible(), "verification step identifies the host");
  await check(await page.getByLabel("Verification code").count() === 1, "verification uses one numeric-keypad code field");
  await page.screenshot({ path: `${shots}/verify-pairing-390-browser-only.png` });
  await page.getByLabel("Verification code").fill("000000");
  await page.getByText(/That code is not right/).waitFor({ timeout: 10_000 });
  await check(await page.getByText("That code is not right. 4 attempts left.", { exact: true }).isVisible(), "wrong code shows a plain-language retry message");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByText("JAgentChill", { exact: true }).waitFor({ timeout: 20_000 });
  await check(await page.getByText("JAgentChill", { exact: true }).count() > 0, "successful code leaves verification for the connected host");
  await check(errors.length === 0, `browser has no uncaught errors (${errors.join("; ")})`);
} catch (error) {
  await page.screenshot({ path: `${shots}/failure-390-browser-only.png` }).catch(() => undefined);
  console.error(String(error).split("\n")[0]);
  console.error((await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 900));
  errors.push("test failed");
}
await browser.close();
console.log(errors.length ? `FAILED after ${assertions} assertions: ${errors.join("\n")}` : `PASS: ${assertions} assertions at 390×844 (browser only)`);
process.exit(errors.length ? 1 : 0);
