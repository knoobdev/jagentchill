// The notification centre and notifications outside the app, on the PRODUCTION web build against a REAL server on a
// fresh data dir. What produces the entries is real: a second browser profile asks to pair with the host (the host
// announces it), a project package is exported on this device. No model runs.
// TEST DOUBLE, said plainly: the browser's Notification API is replaced by a recorder in the test's browser context, so
// that NOTHING is shown on this machine — the test asserts on what the app asked the browser to show and on whether it
// asked for the permission. The app's focus state is forced with `document.hasFocus` where a step needs "not in front".
// Usage: node apps/app/e2e/notifications.mjs <server-log-file> <screenshot-dir> [base-url]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [logFile, shots = ".dev/shots/w7-shell/notifications", base = "http://localhost:8083"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
/** The recorder that stands in for the browser's Notification API. The permission it holds survives a reload, as a browser's does. */
const recorder = () => {
  const KEY = "__e2e_notification_permission";
  window.__os = { asked: 0, shown: [] };
  class Recorder {
    static get permission() { return window.localStorage.getItem(KEY) ?? "default"; }
    static requestPermission() { window.__os.asked++; window.localStorage.setItem(KEY, "granted"); return Promise.resolve("granted"); }
    constructor(title, options) { this.title = title; window.__os.shown.push({ title, body: options?.body ?? "", tag: options?.tag ?? "" }); window.__os.last = this; }
    close() {}
  }
  window.Notification = Recorder;
};
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await context.addInitScript(recorder);
const page = await context.newPage();
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id, on = page) => visible(on.getByTestId(id));
const text = (value, options, on = page) => visible(on.getByText(value, options));
const os = () => page.evaluate(() => ({ asked: window.__os.asked, shown: window.__os.shown }));
const path = () => new URL(page.url()).pathname;
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push("ok"); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); results.push("FAIL"); await shot(`failure-${results.length}`).catch(() => {}); }
};
const entries = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="inbox-entry"]')].filter((node) => node.getBoundingClientRect().width > 0).map((node) => ({ text: node.querySelector('[role="button"]')?.getAttribute("aria-label") ?? "", read: node.getAttribute("data-read"), category: node.getAttribute("data-category"), waiting: node.getAttribute("data-waiting"), group: node.closest('[data-testid^="inbox-group-"]')?.getAttribute("data-testid").slice(12) })));
const bell = () => tid("footer-notifications");
const badge = async () => { const label = await bell().getAttribute("aria-label"); const match = /(\d+)/.exec(label ?? ""); return match ? Number(match[1]) : 0; };
const openCentre = async () => { if (!(await page.getByTestId("inbox").filter({ visible: true }).count())) { await bell().click(); await tid("inbox").waitFor(); await page.waitForTimeout(600); } };
const closeCentre = async () => { if (await page.getByTestId("inbox").filter({ visible: true }).count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
const until = async (read, ok, what) => { let got; for (let tries = 0; tries < 100; tries++) { got = await read(); if (ok(got)) return got; await page.waitForTimeout(150); } throw new Error(`${what}: ${JSON.stringify(got).slice(0, 300)}`); };
const codeFor = async (on) => {
  await text(/Enter the code shown next to [0-9a-f]{8}/, undefined, on).waitFor({ timeout: 60_000 });
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await on.content())[1];
  await on.waitForTimeout(500);
  return /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
};
const connect = async (on, link, name) => {
  await on.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(on.getByLabel("Pairing link")).fill(link, { timeout: 90_000 });
  await visible(on.getByLabel("Name of this device")).fill(name);
  await visible(on.getByRole("button", { name: "Continue" })).click();
};
let phone = null, phoneCode = "";

await step("on load the browser is NOT asked for the permission; the bell opens the centre, which is empty", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await bell().waitFor({ timeout: 90_000 });
  expect((await os()).asked === 0, "the permission was asked on load");
  expect((await badge()) === 0, "no number on the bell");
  await openCentre();
  await tid("inbox-empty").waitFor();
  expect(await text("You're all caught up").count(), "the empty state");
  await shot("01-centre-empty");
  await closeCentre();
});
await step("Settings ▸ Notifications opens inside Settings: outside-the-app is off, the permission is “Not asked yet”, nothing was asked", async () => {
  await tid("inbox-settings", page).count();
  await openCentre(); await tid("inbox-settings").click(); await page.waitForTimeout(800);
  expect(path() === "/settings/notifications", `the gear of the centre leads to ${path()}`);
  await tid("notification-settings").waitFor();
  expect((await page.getByTestId("settings-nav").filter({ visible: true }).count()) === 1, "inside the Settings layout");
  expect((await tid("notify-permission").innerText()) === "Not asked yet", `permission: ${await tid("notify-permission").innerText()}`);
  expect((await page.getByRole("switch", { name: "Show notifications outside the app", exact: true }).getAttribute("aria-checked")) === "false", "the switch is off");
  expect(await page.getByRole("switch", { name: "Pairing requests", exact: true }).isDisabled(), "the kinds wait for the first switch");
  expect((await os()).asked === 0, "still not asked");
  await shot("02-settings-off-wide-light");
});
await step("turning it on asks the browser once; the test button shows one notification outside the app", async () => {
  await page.getByRole("switch", { name: "Show notifications outside the app", exact: true }).click();
  await until(os, (state) => state.asked === 1, "the browser is asked");
  await until(() => tid("notify-permission").innerText(), (value) => value === "Allowed", "the permission");
  await page.getByRole("switch", { name: "Everything else", exact: true }).click();
  expect((await page.getByRole("switch", { name: "Show notifications outside the app", exact: true }).getAttribute("aria-checked")) === "true", "the switch is on");
  const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-testid="notification-settings"] [role="switch"]')].map((node) => `${node.getAttribute("aria-label")}=${node.getAttribute("aria-checked")}`));
  expect(kinds.join("|") === "Show notifications outside the app=true|Only when the app is not in front=true|The agent needs you=true|Finished or failed=true|Paused for money=true|Pairing requests=true|Sync conflicts=true|Media that could not be fetched=true|Everything else=true", `switches: ${kinds.join("|")}`);
  await tid("notify-test").click();
  const state = await until(os, (now) => now.shown.length === 1, "the test notification");
  expect(state.shown[0].title === "JAgentChill" && state.shown[0].body === "This is how a notification looks on this device.", JSON.stringify(state.shown[0]));
  await shot("03-settings-on-wide-light");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await shot("03-settings-on-wide-dark"); await page.emulateMedia({ colorScheme: "light" });
  await page.reload({ waitUntil: "networkidle" }); await tid("notification-settings").waitFor({ timeout: 60_000 });
  expect((await os()).asked === 0, "a reload asks nothing");
  expect((await page.getByRole("switch", { name: "Show notifications outside the app", exact: true }).getAttribute("aria-checked")) === "true", "the choice is remembered");
});
await step("this browser pairs with the host (admin); a second browser profile “Phone” asks to pair", async () => {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await connect(page, offer, "Studio browser");
  await page.getByLabel("Verification code").fill(await codeFor(page));
  await text("Connected", { exact: true }).waitFor({ timeout: 60_000 });
  await page.goto(`${base}/devices`, { waitUntil: "networkidle" });
  await visible(page.getByRole("button", { name: "Pair a device", exact: true })).click({ timeout: 60_000 });
  const link = await page.getByLabel("Pairing link").inputValue();
  expect(/offer=/.test(link), `the offer link: ${link.slice(0, 40)}`);
  const before = (await os()).shown.length;
  // Not in front: the person is in another window while the phone asks.
  await page.evaluate(() => { document.hasFocus = () => false; });
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await second.addInitScript(recorder);
  phone = await second.newPage();
  await connect(phone, link, "Phone");
  phoneCode = await codeFor(phone);
  const state = await until(os, (now) => now.shown.length === before + 1, "the pairing request shown outside the app");
  const shown = state.shown[state.shown.length - 1];
  expect(shown.title === "Pairing requests" && shown.body === "Phone asks to pair", `outside the app: ${JSON.stringify(shown)}`);
  expect(!shown.body.includes(phoneCode) && !shown.title.includes(phoneCode), "the verification code is not in the notification");
  await page.evaluate(() => { delete document.hasFocus; });
});
await step("the centre: “Needs you” holds the request, unread, with its kind; the bell counts it; closing the dialog does not end it", async () => {
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  await until(badge, (count) => count >= 1, "the number on the bell");
  await openCentre();
  const list = await until(entries, (rows) => rows.some((row) => row.text === "Phone asks to pair"), "the entry");
  const entry = list.find((row) => row.text === "Phone asks to pair");
  expect(entry.group === "waiting" && entry.read === "false" && entry.category === "pairing" && entry.waiting === "true", JSON.stringify(entry));
  expect(await visible(page.getByTestId("inbox-group-waiting").getByText("Needs you", { exact: true })).count(), "the group's heading");
  await shot("04-centre-needs-you-wide-light");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await shot("04-centre-needs-you-wide-dark"); await page.emulateMedia({ colorScheme: "light" });
});
await step("an entry opens the thing it is about and becomes read", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  const count = await until(badge, (value) => value >= 1, "the bell after going elsewhere");
  await openCentre();
  await visible(page.getByTestId("inbox-entry-link").filter({ hasText: "Phone asks to pair" })).click();
  await page.waitForTimeout(900);
  expect(path() === "/devices", `it opened ${path()}`);
  const dialog = visible(page.getByRole("dialog", { name: "A new device wants to pair" }));
  await dialog.waitFor({ timeout: 10_000 });
  const digits = (await dialog.innerText()).replace(/\D/g, "");
  expect(digits.includes(phoneCode), `notification reopened the pending pairing dialog with its code; dialog digits ${digits}`);
  await shot("04-pairing-request-reopened");
  expect((await badge()) === count - 1, `the bell: ${await badge()} after ${count}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
});
await step("with “only when the app is not in front”, nothing is shown outside while the app is in front — the centre still gets the entry", async () => {
  // A real second entry while the app IS in front: a project package exported on this device.
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await visible(page.getByRole("button", { name: /^(Create your first project|New project)$/ })).click({ timeout: 60_000 });
  await page.waitForURL(/\/editor\//); await tid("editor-bar").waitFor({ timeout: 60_000 });
  await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
  await visible(page.getByRole("button", { name: "Editor menu", exact: true })).click(); await visible(page.getByRole("menuitem", { name: "Back to projects" })).click();
  const before = (await os()).shown.length;
  await visible(page.getByTestId("project-New project")).hover(); await visible(page.getByRole("button", { name: "Actions for New project", exact: true })).click();
  const download = page.waitForEvent("download", { timeout: 60_000 }).catch(() => null);
  await visible(page.getByRole("menuitem", { name: "Export package", exact: true })).click();
  await download;
  await openCentre();
  const list = await until(entries, (rows) => rows.some((row) => row.text === "Package exported"), "the entry of the export");
  const entry = list.find((row) => row.text === "Package exported");
  expect(entry.group === "today" && entry.category === "other" && entry.read === "false", JSON.stringify(entry));
  expect((await os()).shown.length === before, "nothing was shown outside the app (the app is in front, and the export category is on)");
});
await step("the phone types the code: the request stops waiting on this device too", async () => {
  await phone.getByLabel("Verification code").fill(phoneCode);
  // (The phone-sized screen has no connection chip to read: the host's word is awaited on the first device.)
  await openCentre();
  const list = await until(entries, (rows) => rows.some((row) => /^No longer waiting — Phone asks to pair$/.test(row.text)), "the settled entry");
  const entry = list.find((row) => /No longer waiting/.test(row.text));
  expect(entry.group === "today" && entry.waiting === "false" && entry.read === "true", JSON.stringify(entry));
  expect(!list.some((row) => row.group === "waiting"), "nothing waits any more");
  await shot("05-centre-today-wide-light");
  // The same list as a screen, on a phone-sized window (the entries are the real ones of the steps above).
  await closeCentre();
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${base}/notifications`, { waitUntil: "networkidle" }); await tid("inbox").waitFor({ timeout: 30_000 }); await page.waitForTimeout(500);
  expect((await entries()).length >= 2, "the entries are on the phone-sized screen");
  await shot("06-centre-390-light");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await shot("06-centre-390-dark"); await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); await bell().waitFor({ timeout: 30_000 });
});
await step("mark all as read unconditionally, remove one, clear", async () => {
  await openCentre();
  const unread = (await entries()).filter((row) => row.read === "false").length;
  expect(unread >= 1, `unread entries: ${unread}`);
  await tid("inbox-read-all").click();
  const allRead = await until(entries, (rows) => rows.length > 0 && rows.every((row) => row.read === "true"), "all read");
  expect(allRead.every((row) => row.read === "true"), `all ${allRead.length} entries read`);
  await shot("08-mark-all-read");
  expect((await badge()) === 0, `the bell is clear: ${await badge()}`);
  const count = (await entries()).length;
  await visible(page.getByTestId("inbox-entry").filter({ hasText: "Package exported" }).getByTestId("inbox-entry-remove")).click();
  await until(entries, (rows) => rows.length === count - 1, "one removed");
  await tid("inbox-clear").click();
  await tid("inbox-empty").waitFor();
  await closeCentre();
});
await step("a phone-sized screen: the bell opens the centre as a screen; the settings page fits", async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${base}/settings/notifications`, { waitUntil: "networkidle" }); await tid("notification-settings").waitFor({ timeout: 30_000 });
  await shot("07-settings-390-dark");
  await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(400); await shot("07-settings-390-light");
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await visible(page.getByRole("button", { name: "Open navigation", exact: true })).click(); await page.waitForTimeout(600);
  await bell().click(); await page.waitForTimeout(900);
  expect(path() === "/notifications", `on a phone the bell leads to ${path()}`);
});
await browser.close();
console.log(`\n${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
