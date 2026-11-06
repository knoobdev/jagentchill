// Headless 390 px mobile-path check against a built web app. The QR path is checked in its web fallback state;
// the pairing link is a synthetic fixture and never reaches a real host.
import { chromium } from "playwright";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { encodeOfferPayload, handshakeTranscript } from "@jagentchill/protocol";

const base = process.env.E2E_BASE ?? "http://127.0.0.1:8084";
const shots = process.argv[2] ?? ".refs/apply/briefs";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const gateway = generateKeyPairSync("ed25519");
const gatewayId = "ab".repeat(16);
const gatewayPublicKey = gateway.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const offer = { v: 1, offerId: randomBytes(16).toString("base64url"), gatewayId, gatewayPublicKey, addresses: [{ kind: "lan", url: "ws://127.0.0.1:18963/jagentchill/v1/ws" }], expires_ms: Date.now() + 60_000 };
const offerPayload = encodeOfferPayload(offer);
const pairingLink = `jagentchill://pair#offer=${offerPayload}`;
let failPairing = false;
await page.route("http://127.0.0.1:18963/**", async (route) => {
  const request = route.request();
  const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "*", "content-type": "application/json" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  const path = new URL(request.url()).pathname;
  if (failPairing) return route.fulfill({ status: 503, headers, body: "" });
  const body = request.postDataJSON();
  if (path.endsWith("/challenge")) {
    const gatewayNonce = randomBytes(32).toString("base64url"), ts = Date.now();
    const transcript = handshakeTranscript({ role: "gateway", context: `enrol:${offer.offerId}`, gatewayNonce, deviceNonce: body.deviceNonce, ts, gatewayId, deviceId: body.deviceId, devicePublicKey: body.devicePublicKey, protocolVersion: 1 });
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ requestId: "request-fixture-c", gatewayNonce, ts, gatewayId, gatewaySignature: sign(null, Buffer.from(transcript), gateway.privateKey).toString("base64url") }) });
  }
  if (path.endsWith("/prove")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ expires_ms: Date.now() + 60_000, attemptsRemaining: 5 }) });
  if (path.endsWith("/verify")) return route.fulfill({ status: 200, headers, body: JSON.stringify({ role: "viewer", gatewayName: "Fixture host", deviceToken: { value: "fixture-device-token", expires_ms: Date.now() + 86_400_000 } }) });
  return route.fulfill({ status: 404, headers, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "fixture route not found" } }) });
});
let assertions = 0;
const check = async (condition, name) => { assertions++; if (!condition) throw new Error(`assertion ${assertions} failed: ${name}`); };
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText("Connect to JAgentChill", { exact: true }).first().waitFor({ timeout: 60_000 });
  await check(await page.getByText("Scan QR code", { exact: true }).count() === 1, "welcome offers QR scan");
  await check(await page.getByText("Direct connection", { exact: true }).count() === 1, "welcome offers direct connection");
  await check(await page.getByText("Paste pairing link", { exact: true }).count() === 1, "welcome offers link paste");
  await check(await page.getByRole("button", { name: "Use this device only", exact: true }).count() === 1, "welcome offers a local-only choice");
  await page.screenshot({ path: `${shots}/w8c-mobile-welcome.png` });

  await page.getByRole("button", { name: "Use this device only", exact: true }).click();
  await page.getByTestId("home-page").waitFor();
  await page.getByText("Projects", { exact: true }).first().waitFor();
  await check(await page.getByText("No projects yet", { exact: true }).count() > 0, "local-only choice opens the project home without a host");
  await page.screenshot({ path: `${shots}/w8j-home-after-local-choice.png` });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("home-page").waitFor();
  await check(await page.getByText("Connect to JAgentChill", { exact: true }).count() === 0, "reload stays on Home after choosing local-only");
  await page.screenshot({ path: `${shots}/w8j-home-after-reload.png` });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Scan QR code", { exact: true }).waitFor();
  await check(await page.getByRole("button", { name: "Use this device only", exact: true }).count() === 1, "Home connect entry returns to welcome options");

  await page.getByText("Scan QR code", { exact: true }).click();
  await page.getByText("Camera scanning is not available on web.", { exact: true }).waitFor();
  await check(await page.getByText("Scan desktop QR", { exact: true }).count() > 0, "scanner route is reachable");
  await page.screenshot({ path: `${shots}/w8c-mobile-scan-web.png` });

  await page.getByRole("button", { name: "Paste pairing link", exact: true }).click();
  const link = page.getByLabel("Pairing link").filter({ visible: true }).first();
  await link.waitFor();
  await link.fill(pairingLink);
  await page.waitForFunction((expected) => localStorage.getItem("jagentchill.identity.pending-offer.v1") === expected, pairingLink);
  await page.goto(`${base}/pair-start`, { waitUntil: "networkidle" });
  await page.getByText("Paste pairing link", { exact: true }).click();
  const restored = page.getByLabel("Pairing link").filter({ visible: true }).first();
  await restored.waitFor();
  await check((await restored.inputValue()) === pairingLink, "pending offer survives leaving and reopening pairing screen");
  await page.getByLabel("Name of this device").filter({ visible: true }).first().waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).filter({ visible: true }).first().waitFor();
  await page.waitForTimeout(350);
  await link.focus();
  await check(await page.getByRole("button", { name: "Cancel", exact: true }).filter({ visible: true }).isVisible(), "modal footer remains visible while a field is focused");
  await page.screenshot({ path: `${shots}/w8k-modal-footer-focused.png` });
  await page.screenshot({ path: `${shots}/w8c-mobile-pending-offer.png` });
  await page.goto(`${base}/pair?offer=${encodeURIComponent(offerPayload)}`, { waitUntil: "networkidle" });
  const deepLink = page.getByLabel("Pairing link").filter({ visible: true }).first();
  await deepLink.waitFor();
  await check((await deepLink.inputValue()) === pairingLink, "deep-link offer opens the paste and verify path");
  await page.screenshot({ path: `${shots}/w8k-deep-link-rewrite.png` });
  failPairing = true;
  await page.getByRole("button", { name: "Continue", exact: true }).filter({ visible: true }).first().click();
  await page.getByText("The host answered without a pairing response. Check that it is online and try again.", { exact: true }).waitFor();
  await check(await page.getByText("The host answered without a pairing response. Check that it is online and try again.", { exact: true }).isVisible(), "empty host response has an actionable pairing error instead of a generic failure");
  await page.screenshot({ path: `${shots}/w8k-pairing-error.png` });
  failPairing = false;
  await page.getByLabel("Name of this device").filter({ visible: true }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${shots}/w8c-mobile-verify.png` });
  await check(await page.getByLabel("Verification code").filter({ visible: true }).count() === 1, "six-digit verification step follows signed host challenge");
  await page.getByLabel("Verification code").filter({ visible: true }).fill("123456");
  await page.getByText("Fixture host", { exact: true }).waitFor({ timeout: 15_000 });
  await check(await page.getByText("Fixture host", { exact: true }).count() > 0, "verified host is saved and selected");
  await check(errors.length === 0, `browser has no uncaught page errors (${errors.join("; ")})`);
} catch (error) {
  await page.screenshot({ path: `${shots}/w8c-mobile-failure.png` }).catch(() => undefined);
  console.error(String(error).split("\n")[0]);
  console.error((await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 900));
  errors.push("test failed");
}
await browser.close();
console.log(errors.length ? `FAILED after ${assertions} assertions: ${errors.join("\n")}` : `PASS: ${assertions} assertions at 390×844`);
process.exit(errors.length ? 1 : 0);
