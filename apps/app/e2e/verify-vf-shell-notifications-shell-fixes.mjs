// Evidence copy: only safety ports/run paths adapted from notifications-shell-fixes.mjs.
// Regression path for shell-3: distinct completed turns and budget-pause resolution in the live inbox.
// Production web build + fresh local harness; fake Gateway ends turns, workflow notices are host fixtures.
// The browser Notification API is a recorder. No model, provider, CLI, or OS notification runs.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { encodeOfferUrl } from "@jagentchill/protocol";
import { createHarness, SAMPLE_MODELS } from "../../../server/test/harness.ts";

const arg = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const port = Number(arg("--port")), dataDir = arg("--data-dir");
const shots = process.argv.at(-1) ?? ".dev/shots/w7-shell/notifications-shell-fixes";
const base = "http://localhost:8071";
if (!Number.isInteger(port) || port < 19020 || port > 19028 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !dataDir?.startsWith(".dev/run-vf-shell-")) throw new Error("Pass a fresh W7-K run directory and matching in-range ports.");
mkdirSync(shots, { recursive: true });
const h = await createHarness({ dataDir: `${process.cwd()}/${dataDir}`, listenPort: port, allowedOrigins: [new URL(base).origin], models: SAMPLE_MODELS, connected: ["acme"] });
const offer = encodeOfferUrl(h.app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { firstDeviceIsAdmin: true }));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await context.addInitScript(() => { class Recorder { static permission = "default"; static requestPermission = async () => "granted"; constructor() {} close() {} } window.Notification = Recorder; });
const page = await context.newPage(), errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const label = (name) => visible(page.getByLabel(name, { exact: true }));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const text = (value) => visible(page.getByText(value, { exact: true }));
const wait = async (read, yes, name) => { for (let i = 0; i < 100; i++) { const value = await read(); if (yes(value)) return value; await page.waitForTimeout(100); } throw new Error(`${name}: ${JSON.stringify(await read())}`); };
let failure;
try {
  await page.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
  await label("Pairing link").fill(offer); await label("Name of this device").fill("Shell fixes browser"); await button("Continue").click();
  await text(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 60_000 });
  await label("Verification code").fill(h.app.pairing.pending()[0].code); await text("Connected").waitFor({ timeout: 60_000 });
  await page.goto(`${base}/home?focus=1`, { waitUntil: "networkidle" }); await label("Message").waitFor({ timeout: 60_000 });
  const send = async (message) => {
    const target = h.fake.state.runs + 1;
    await label("Message").fill(message); await button("Send").click();
    await wait(() => h.fake.state.runs, (count) => count >= target, "Gateway chat.send");
    const sessionKey = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1));
    return { sessionKey, runId: `run-${h.fake.state.runs}` };
  };
  const first = await send("first matching completion");
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); h.fake.endTurn(first.sessionKey, first.runId, "final");
  await page.goto(`${base}/h/${h.app.host.gatewayId}/sessions/${encodeURIComponent(first.sessionKey)}`, { waitUntil: "networkidle" });
  const second = await send("second matching completion");
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); h.fake.endTurn(second.sessionKey, second.runId, "final");
  if (!(await tid("inbox").count())) await button("Notifications").click().catch(() => tid("footer-notifications").click());
  await tid("inbox").waitFor();
  const completed = page.getByTestId("inbox-entry").filter({ visible: true, hasText: "“Agent” finished" });
  await wait(() => completed.count(), (count) => count === 2, "two same-worded finished events remain separate");
  const results = await completed.evaluateAll((nodes) => nodes.map((node) => ({ waiting: node.getAttribute("data-waiting"), group: node.closest('[data-testid^="inbox-group-"]')?.getAttribute("data-testid") })));
  if (results.some((entry) => entry.waiting !== "false" || entry.group !== "inbox-group-today")) throw new Error(`completed turns are not in day history: ${JSON.stringify(results)}`);
  await page.screenshot({ path: `${shots}/same-worded-turns-in-today.png` });
  console.log("ok  two same-worded completed turns stay separate in Today, outside Needs you");

  const sendNotice = (runId, status) => h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.workflow.notice", "workflow.notice", { runId, kind: "ended", status, ...(status === "paused" ? { pauseReason: "budget_exceeded" } : {}), workflowName: "Budget run" });
  const pauseText = "“Budget run” paused: budget_exceeded";
  sendNotice("resume-budget", "paused"); await tid("inbox").getByText(pauseText, { exact: true }).waitFor();
  sendNotice("resume-budget", "running");
  await tid("inbox").getByText(/No longer waiting.*Budget run.*budget_exceeded/, { exact: false }).waitFor();
  sendNotice("cancel-budget", "paused");
  await wait(() => page.getByTestId("inbox-entry").filter({ visible: true, hasText: pauseText }).count(), (count) => count === 2, "two different pause entries");
  sendNotice("cancel-budget", "cancelled");
  await wait(() => page.getByTestId("inbox-entry").filter({ visible: true, hasText: /No longer waiting/ }).count(), (count) => count >= 2, "resume and cancel resolve both pause entries");
  const pauses = await page.getByTestId("inbox-entry").filter({ visible: true, hasText: pauseText }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-waiting")));
  if (pauses.some((value) => value !== "false")) throw new Error(`a budget pause still waits: ${JSON.stringify(pauses)}`);
  await page.screenshot({ path: `${shots}/budget-pauses-resumed-and-cancelled.png` });
  console.log("ok  Paused for money leaves Needs you immediately after resume and cancel");
} catch (error) { failure = error; await page.screenshot({ path: `${shots}/failure.png` }).catch(() => undefined); }
finally { await browser.close(); await h.stop(); }
if (failure || errors.length) { console.error(failure ? String(failure).split("\n")[0] : errors.join("\n")); process.exitCode = 1; }
else console.log("2/2 checks pass; turns came from the fake Gateway; run transitions came from host event fixtures; Notification API recorder only.");
