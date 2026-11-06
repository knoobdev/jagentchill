// D.1/D.3 proof: an old-shape stored host is upgraded, shown in the switcher and opened in per-host Connections.
// Usage: node apps/app/e2e/host-connections.mjs <screenshot-dir> <base-url>
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { runDesktopMigration } from "./host-migration-desktop.mjs";

const shots = process.argv[2] ?? ".dev/shots/w8-host-connect-D";
const base = process.argv[3] ?? "http://127.0.0.1:8089";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const desktopMigration = await runDesktopMigration();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const legacyHost = {
  gatewayId: "gateway-12345678901234567890123456789012", gatewayPublicKey: "fixture-public-key", gatewayName: "Fixture host",
  origin: "https://fixture.example:19443", role: "editor", deviceToken: { value: "fixture-token", expires_ms: 4_000_000_000_000 }, verifiedClockOffset_ms: 0,
};
const records = [legacyHost, ...Array.from({ length: 10 }, (_, index) => ({
  ...legacyHost, gatewayId: `fixture-gateway-${String(index + 1).padStart(2, "0")}`, gatewayName: `Fixture host ${index + 1}`,
  origin: `http://192.0.2.${index + 1}:18945`, deviceToken: { ...legacyHost.deviceToken },
})), {
  ...legacyHost, gatewayId: "fixture-gateway-multi", gatewayName: "Multi-route host", origin: "http://192.168.1.18:18945",
  connections: [
    { id: "fixture-local", kind: "direct", origin: "http://192.168.1.18:18945" },
    { id: "fixture-tailnet", kind: "tailnet", origin: "https://multi.example.ts.net:18945" },
  ], preferredConnectionId: "fixture-local",
}];
await page.addInitScript(async (record) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("jagentchill-identity", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("keys"); request.result.createObjectStore("hosts", { keyPath: "gatewayId" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("hosts", "readwrite"); for (const host of record) tx.objectStore("hosts").put(host);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}, records);
page.on("pageerror", (error) => console.error("pageerror:", error.message));
await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
await page.getByTestId("host-switcher").waitFor({ timeout: 30_000 });
await page.getByTestId("host-switcher").click();
const row = page.getByTestId(`host-row-${legacyHost.gatewayId}`);
await row.waitFor({ timeout: 15_000 });
assert.match(await row.innerText(), /Fixture host[\s\S]*fixture\.example:19443/);
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/d1-migrated-host-switcher.png` });
const search = page.getByLabel("Search hosts", { exact: true });
await search.waitFor({ timeout: 10_000 });
await search.fill("Fixture host 10");
await page.getByTestId("host-row-fixture-gateway-10").waitFor();
assert.equal(await page.getByTestId("host-row-fixture-gateway-01").count(), 0, "search filters the host rows");
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/d3-host-switcher-search.png` });
await search.fill("");
await page.getByTestId(`host-settings-${legacyHost.gatewayId}`).click();
await page.getByRole("heading", { name: "Connections", exact: true }).waitFor({ timeout: 15_000 });
await page.getByTestId(/host-connection-/).waitFor({ timeout: 15_000 });
const migrated = await page.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get(gatewayId); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}), legacyHost.gatewayId);
assert.equal(migrated.connections.length, 1);
assert.equal(migrated.connections[0].origin, legacyHost.origin);
assert.equal(migrated.deviceToken.value, legacyHost.deviceToken.value);
await page.screenshot({ path: `${shots}/d3-per-host-connections.png` });
await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
await page.getByTestId("host-switcher").click();
await page.getByTestId("host-settings-fixture-gateway-multi").click();
await page.getByTestId("host-connection-fixture-tailnet").waitFor();
assert.equal(await page.getByTestId(/host-connection-/).count(), 2);
await page.getByRole("button", { name: "Remove", exact: true }).first().click();
await page.getByRole("button", { name: "Remove connection", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid^="host-connection-"]').length === 1, null, { timeout: 10_000 });
assert.equal(await page.getByTestId(/host-connection-/).count(), 1);
const multi = await page.evaluate(async () => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get("fixture-gateway-multi"); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}));
assert.equal(multi.connections.length, 1, "removing an address persists the remaining route");
await page.goto(`${base}/host/add-connection`, { waitUntil: "domcontentloaded" });
const methodRows = page.locator('[data-testid^="add-connection-method-"]');
await methodRows.first().waitFor();
assert.equal(await methodRows.count(), 4, "the Add connection sheet offers all four methods");
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/d2-add-connection-methods.png` });
await page.getByTestId("add-connection-method-direct").click();
await page.getByLabel("Host", { exact: true }).fill("new-route.local");
await page.getByLabel("Port", { exact: true }).fill("19444");
await page.getByLabel("Password (optional)", { exact: true }).fill("fixture-pass");
await page.getByLabel("Use SSL", { exact: true }).waitFor();
await page.route("**/jagentchill/v1/health", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ gatewayId: legacyHost.gatewayId, gatewayPublicKey: legacyHost.gatewayPublicKey }) }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/d2-direct-connection-form.png` });
await page.getByRole("button", { name: "Probe host", exact: true }).click();
await page.waitForURL("**/home", { timeout: 15_000 });
const directAdded = await page.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get(gatewayId); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}), legacyHost.gatewayId);
assert.equal(directAdded.connections.length, 2, "the probed route merges into the existing host profile");
assert.equal(directAdded.origin, "http://new-route.local:19444", "the successful direct endpoint becomes preferred");
assert.equal(directAdded.connections.find((connection) => connection.origin === directAdded.origin).password, "fixture-pass", "the direct-route second factor is saved with its address");

const directPairContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const directPairPage = await directPairContext.newPage();
await directPairPage.goto(`${base}/host/add-connection`, { waitUntil: "domcontentloaded" });
await directPairPage.getByTestId("add-connection-method-direct").click();
await directPairPage.getByLabel("Host", { exact: true }).fill("127.0.0.1");
await directPairPage.getByLabel("Port", { exact: true }).fill("18945");
await directPairPage.getByRole("button", { name: "Probe host", exact: true }).click();
await directPairPage.getByText("Pair this host", { exact: true }).waitFor({ timeout: 15_000 });
const directOffer = await (await fetch("http://127.0.0.1:18945/__fixture/offer")).json();
await directPairPage.getByLabel("Pairing link", { exact: true }).fill(directOffer.url);
await directPairPage.getByRole("button", { name: "Continue", exact: true }).click();
await directPairPage.getByLabel("Verification code", { exact: true }).waitFor({ timeout: 20_000 });
await directPairPage.screenshot({ path: `${shots}/d2-direct-pair-confirmation.png` });
let directPairCode;
for (let attempt = 0; attempt < 30 && !directPairCode; attempt++) {
  const pending = await (await fetch("http://127.0.0.1:18945/__fixture/pending")).json();
  directPairCode = pending.requests.at(-1)?.code;
  if (!directPairCode) await new Promise((resolve) => setTimeout(resolve, 150));
}
assert.match(directPairCode ?? "", /^\d{6}$/, "the direct path reaches the host's six-digit pairing request");
await directPairPage.getByLabel("Verification code", { exact: true }).fill(directPairCode);
await directPairPage.waitForURL("**/home", { timeout: 20_000 });
const directPaired = await directPairPage.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get(gatewayId); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}), directOffer.gatewayId);
assert.equal(directPaired.gatewayId, directOffer.gatewayId, "the direct pairing saves the trusted host identity");
assert.equal(directPaired.connections[0].origin, "http://127.0.0.1:18945", "the pairing link uses the probed direct endpoint");
await directPairContext.close();

const migrationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const migrationPage = await migrationContext.newPage();
const fixture = await (await fetch("http://127.0.0.1:18945/__fixture/offer")).json();
const offerPayload = new URL(fixture.url).hash.split("offer=")[1];
await migrationPage.goto(`${base}/pair/start?offer=${encodeURIComponent(offerPayload)}`, { waitUntil: "domcontentloaded" });
await migrationPage.getByRole("button", { name: "Continue", exact: true }).click();
await migrationPage.getByLabel("Verification code", { exact: true }).waitFor({ timeout: 20_000 });
let pairingCode;
for (let attempt = 0; attempt < 30 && !pairingCode; attempt++) {
  const pending = await (await fetch("http://127.0.0.1:18945/__fixture/pending")).json();
  pairingCode = pending.requests[0]?.code;
  if (!pairingCode) await new Promise((resolve) => setTimeout(resolve, 150));
}
assert.match(pairingCode ?? "", /^\d{6}$/, "the server produced a six-digit pairing code");
await migrationPage.getByLabel("Verification code", { exact: true }).fill(pairingCode);
const migratedRow = migrationPage.getByTestId(`host-row-${fixture.gatewayId}`);
await migrationPage.getByTestId("host-switcher").waitFor({ timeout: 30_000 });
await migrationPage.getByTestId("host-switcher").click();
await migratedRow.waitFor({ timeout: 30_000 });
await migrationPage.waitForFunction((id) => document.querySelector(`[data-testid="host-row-${id}"]`)?.textContent?.includes("Connected"), fixture.gatewayId, { timeout: 30_000 });
const beforeDowngrade = await migrationPage.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get(gatewayId); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}), fixture.gatewayId);
assert.equal(beforeDowngrade.connections.length, 1, "new pair writes one route before the legacy migration step");
await migrationPage.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const tx = db.transaction("hosts", "readwrite"), store = tx.objectStore("hosts"), get = store.get(gatewayId); get.onsuccess = () => { const oldShape = { ...get.result }; delete oldShape.connections; delete oldShape.preferredConnectionId; store.put(oldShape); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  request.onerror = () => reject(request.error);
}), fixture.gatewayId);
await migrationPage.reload({ waitUntil: "domcontentloaded" });
await migrationPage.getByTestId("host-switcher").click();
const reconnectedRow = migrationPage.getByTestId(`host-row-${fixture.gatewayId}`);
await reconnectedRow.waitFor({ timeout: 30_000 });
await migrationPage.waitForFunction((id) => document.querySelector(`[data-testid="host-row-${id}"]`)?.textContent?.includes("Connected"), fixture.gatewayId, { timeout: 30_000 });
const afterMigration = await migrationPage.evaluate(async (gatewayId) => new Promise((resolve, reject) => {
  const request = indexedDB.open("jagentchill-identity", 1);
  request.onsuccess = () => { const db = request.result; const get = db.transaction("hosts", "readonly").objectStore("hosts").get(gatewayId); get.onsuccess = () => { const value = get.result; db.close(); resolve(value); }; get.onerror = () => reject(get.error); };
  request.onerror = () => reject(request.error);
}), fixture.gatewayId);
assert.equal(afterMigration.connections.length, 1, "the legacy IndexedDB row was upgraded on reload");
assert.equal(afterMigration.gatewayId, beforeDowngrade.gatewayId);
assert.equal(afterMigration.deviceToken.value, beforeDowngrade.deviceToken.value);
assert.equal(afterMigration.origin, "http://127.0.0.1:18945");
await migrationPage.waitForTimeout(350);
await migrationPage.screenshot({ path: `${shots}/d1-migrated-web-indexeddb-connected.png` });
console.log(JSON.stringify({ migration: "real host paired, old IndexedDB shape restored, then reconnected", gatewayId: afterMigration.gatewayId, connectionCount: afterMigration.connections.length, sameDeviceToken: afterMigration.deviceToken.value === beforeDowngrade.deviceToken.value, status: "Connected", desktopStoreMigration: desktopMigration, searchableHostCount: records.length, removedRouteCount: 1, directRouteAdded: directAdded.connections.length - 1, directPasswordPersisted: true, directPairing: "six-digit confirmation passed", assertions: 28, screenshots: [`${shots}/d1-migrated-host-switcher.png`, `${shots}/d1-migrated-web-indexeddb-connected.png`, `${shots}/d3-host-switcher-search.png`, `${shots}/d3-per-host-connections.png`, `${shots}/d2-add-connection-methods.png`, `${shots}/d2-direct-connection-form.png`, `${shots}/d2-direct-pair-confirmation.png`] }, null, 2));
await migrationContext.close();
await context.close();
await browser.close();
