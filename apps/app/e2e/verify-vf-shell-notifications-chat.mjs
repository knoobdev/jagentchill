// Evidence copy: only safety ports/run paths adapted from notifications-chat.mjs.
// Production web UI + the server's fake Gateway from test/harness.ts. Pair and send chat turns through the app;
// the fake Gateway ends each turn without running a model or CLI. The browser Notification API is a recorder.
// Usage: JAGENTCHILL_PORT=18995 JAGENTCHILL_GATEWAY_PORT=18996 node apps/app/e2e/notifications-chat.mjs --port 18995 --data-dir .dev/run-vf-shell-7/data <shots-dir> [base-url]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { encodeOfferUrl } from "@jagentchill/protocol";
import { createHarness, SAMPLE_MODELS } from "../../../server/test/harness.ts";

const arg = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const port = Number(arg("--port")), dataDir = arg("--data-dir");
const positionals = process.argv.slice(2).filter((value, index, all) => !["--port", "--data-dir"].includes(all[index - 1]) && !["--port", "--data-dir"].includes(value) && !/^\d+$/.test(value));
const shots = positionals[0] ?? ".dev/shots/w7-shell/notifications-chat";
const base = positionals[1]?.startsWith("http") ? positionals[1] : "http://localhost:8071";
if (!Number.isInteger(port) || port < 19020 || port > 19028 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !dataDir?.startsWith(".dev/run-vf-shell-")) throw new Error("Pass this e2e its own W7-K port, matching environment, and fresh run directory.");
mkdirSync(shots, { recursive: true });
const h = await createHarness({ dataDir: `${process.cwd()}/${dataDir}`, listenPort: port, allowedOrigins: [new URL(base).origin], models: SAMPLE_MODELS, connected: ["acme"] });
const offer = encodeOfferUrl(h.app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { firstDeviceIsAdmin: true }));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await context.addInitScript(() => { window.__os = []; class Recorder { static permission = "default"; static requestPermission = async () => "granted"; constructor(title, options) { window.__os.push({ title, body: options?.body ?? "" }); } close() {} } window.Notification = Recorder; });
const page = await context.newPage(), errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const field = (label) => visible(page.getByLabel(label, { exact: true }));
const button = (label) => visible(page.getByRole("button", { name: label, exact: true }));
const tid = (id) => visible(page.getByTestId(id));
const step = async (name, run) => { await run(); console.log(`ok  ${name}`); };
const waitFor = async (read, test, message) => { for (let i = 0; i < 120; i++) { const value = await read(); if (test(value)) return value; await page.waitForTimeout(100); } throw new Error(`${message}: ${JSON.stringify(await read())}`); };
const sendTurn = async (message) => {
  await field("Message").fill(message);
  await button("Send").click();
  await waitFor(() => h.fake.state.runs, (runs) => runs >= sendTurn.target, "fake Gateway received chat.send");
  const sessionKey = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1));
  return { sessionKey, runId: `run-${h.fake.state.runs}` };
};
let failure;
try {
  await step("pair this browser with the local fake-Gateway host", async () => {
    await page.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
    await field("Pairing link").fill(offer);
    await field("Name of this device").fill("Notification test browser");
    await button("Continue").click();
    await text(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 60_000 });
    await field("Verification code").fill(h.app.pairing.pending()[0].code);
    await text("Connected", { exact: true }).waitFor({ timeout: 60_000 });
  });
  let sessionKey;
  await step("create and send a chat turn through Home; fake Gateway reports success while the browser is on Projects", async () => {
    await page.goto(`${base}/home?focus=1`, { waitUntil: "networkidle" });
    await field("Message").waitFor({ timeout: 60_000 });
    sendTurn.target = h.fake.state.runs + 1;
    const started = await sendTurn("notification e2e successful turn"); sessionKey = started.sessionKey;
    await waitFor(() => decodeURIComponent(new URL(page.url()).pathname), (path) => path.endsWith(`/sessions/${sessionKey}`), "opened the session view");
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    h.fake.endTurn(sessionKey, started.runId, "final");
    await page.waitForTimeout(250);
    await page.goto(`${base}/h/${h.app.host.gatewayId}/sessions/${encodeURIComponent(sessionKey)}`, { waitUntil: "networkidle" });
    sendTurn.target = h.fake.state.runs + 1;
    const sameWording = await sendTurn("notification e2e second successful turn");
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    h.fake.endTurn(sameWording.sessionKey, sameWording.runId, "final");
  });
  await step("the finished turn reaches the centre as an unread entry with a route to its session", async () => {
    if (!(await tid("inbox").count())) await button("Notifications").click().catch(async () => tid("footer-notifications").click());
    await tid("inbox").waitFor({ timeout: 10_000 });
    await text("“Agent” finished", { exact: true }).waitFor({ timeout: 10_000 });
    const finished = page.getByTestId("inbox-entry").filter({ visible: true, hasText: "“Agent” finished" });
    await waitFor(() => finished.count(), (count) => count === 2, "two matching completion messages remain separate entries");
    const entry = visible(finished);
    if (await entry.getAttribute("data-read") !== "false") throw new Error("finished-turn entry was not unread");
    if (await entry.getAttribute("data-waiting") !== "false") throw new Error("a finished turn was incorrectly placed under Needs you");
    if (await entry.evaluate((node) => node.closest('[data-testid^="inbox-group-"]')?.getAttribute("data-testid")) !== "inbox-group-today") throw new Error("finished turn was not in today's history");
    await page.screenshot({ path: `${shots}/chat-finished-centre.png` });
  });
  await step("a failed turn sent through the session also reaches the centre while the browser is elsewhere", async () => {
    await page.keyboard.press("Escape");
    await page.goto(`${base}/h/${h.app.host.gatewayId}/sessions/${encodeURIComponent(sessionKey)}`, { waitUntil: "networkidle" });
    sendTurn.target = h.fake.state.runs + 1;
    const failed = await sendTurn("notification e2e failing turn");
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    h.fake.endTurn(failed.sessionKey, failed.runId, "error", "TEST DOUBLE failure");
    if (!(await tid("inbox").count())) await button("Notifications").click().catch(async () => tid("footer-notifications").click());
    await tid("inbox").waitFor({ timeout: 10_000 });
    await text("“Agent” failed", { exact: true }).waitFor({ timeout: 10_000 });
    const entry = visible(tid("inbox-entry").filter({ hasText: "“Agent” failed" }));
    if (await entry.getAttribute("data-read") !== "false") throw new Error("failed-turn entry was not unread");
    await page.screenshot({ path: `${shots}/chat-finished-and-failed-centre.png` });
  });
  await step("permission, money and question requests sent by the host appear in Needs your attention", async () => {
    const hostId = h.app.host.gatewayId;
    for (const [event, payload] of [
      ["jagentchill.chat.permission.requested", { request: { requestId: "fixture-permission", sessionKey, toolLabel: "Read project files" } }],
      ["jagentchill.chat.permission.requested", { request: { requestId: "fixture-money", sessionKey, toolLabel: "Render preview", money: { amount: 0.02 } } }],
      ["jagentchill.chat.question.requested", { question: { questionId: "fixture-question", sessionKey, questions: [{ text: "Which title should the cut use?" }] } }],
    ]) h.app.channel.sendToScope("jagentchill.projects.read", event, `session:${sessionKey}`, payload);
    if (!(await tid("inbox").count())) await button("Notifications").click().catch(async () => tid("footer-notifications").click());
    await tid("inbox").getByText("The agent asks for permission: Read project files", { exact: true }).waitFor();
    await tid("inbox").getByText("Waiting for your OK before it spends money: Render preview", { exact: true }).waitFor();
    await tid("inbox").getByText("The agent asks: Which title should the cut use?", { exact: true }).waitFor();
    await page.screenshot({ path: `${shots}/chat-requests-centre.png` });
    if (!hostId) throw new Error("host fixture did not have an id");
  });
  await step("a Gateway host-command approval is announced by the server and added to the centre", async () => {
    h.fake.emit("exec.approval.requested", { id: "fixture-approval", request: { sessionKey, title: "Run the preview command", command: "render-preview", toolName: "exec" } });
    await tid("inbox").getByText("The agent asks for permission: Run the preview command", { exact: true }).waitFor();
    const approval = visible(tid("inbox-entry-link").filter({ hasText: "Run the preview command" }));
    await approval.click();
    await page.waitForFunction(({ hostId, sessionKey }) => {
      const path = decodeURIComponent(new URL(location.href).pathname);
      return path.includes(`/h/${hostId}/sessions/`) && path.endsWith(sessionKey);
    }, { hostId: h.app.host.gatewayId, sessionKey });
    await page.screenshot({ path: `${shots}/host-approval-session.png` });
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await button("Notifications").click().catch(async () => tid("footer-notifications").click());
    await tid("inbox").waitFor();
  });
  await step("workflow completion, failure and each pause reason are listed with the workflow route", async () => {
    const hostId = h.app.host.gatewayId;
    for (const [runId, status, pauseReason] of [
      ["wf-done", "succeeded"], ["wf-failed", "failed"],
      ["wf-pause-permission", "paused", "permission"], ["wf-pause-question", "paused", "question"],
      ["wf-pause-money", "paused", "money"], ["wf-pause-budget", "paused", "budget_exceeded"],
      ["wf-pause-dissent", "paused", "dissent"], ["wf-pause-handoff", "paused", "handoff"],
    ]) h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.workflow.notice", "workflow.notice", { runId, kind: "ended", status, ...(pauseReason ? { pauseReason } : {}), workflowName: runId });
    for (const runId of ["wf-done", "wf-failed", "wf-pause-permission", "wf-pause-question", "wf-pause-money", "wf-pause-budget", "wf-pause-dissent", "wf-pause-handoff"]) {
      await tid("inbox").getByText(new RegExp(runId), { exact: false }).waitFor();
    }
    const routed = visible(tid("inbox-entry-link").filter({ hasText: "wf-pause-handoff" }));
    await routed.click();
    await page.waitForURL(`**/h/${hostId}/workflows/runs/wf-pause-handoff`);
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await button("Notifications").click().catch(async () => tid("footer-notifications").click());
    await tid("inbox").waitFor();
    await page.screenshot({ path: `${shots}/workflow-ended-paused-centre.png` });
  });
  await step("film success, film failure and generation success/failure updates reach the centre", async () => {
    h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.film.updated", "film:fixture-film", { film: { id: "fixture-film", title: "Fixture film" }, activity: { breakdown: { state: "running" } } });
    h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.film.updated", "film:fixture-film", { film: { id: "fixture-film", title: "Fixture film" }, activity: {} });
    h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.film.updated", "film:fixture-failed-film", { film: { id: "fixture-failed-film", title: "Failed fixture film" }, activity: { stills: { state: "failed", message: "provider private detail" } } });
    for (const [jobId, state] of [["fixture-job-done", "succeeded"], ["fixture-job-failed", "failed"]]) h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.job.updated", "job", { job: { jobId, state, kind: "image", projectId: "fixture-project" } });
    await tid("inbox").getByText("“Fixture film” finished", { exact: true }).waitFor();
    await tid("inbox").getByText("“Failed fixture film” failed", { exact: true }).waitFor();
    await tid("inbox").getByText("Generation finished", { exact: true }).waitFor();
    await tid("inbox").getByText("Generation failed", { exact: true }).waitFor();
    if (await tid("inbox").getByText("provider private detail", { exact: false }).count()) throw new Error("film failure leaked its provider message");
    await page.screenshot({ path: `${shots}/film-generation-centre.png` });
  });
  await step("a budget pause leaves Needs you when the host resumes or cancels the run", async () => {
    const send = (runId, status) => h.app.channel.sendToScope("jagentchill.projects.read", "jagentchill.workflow.notice", "workflow.notice", { runId, kind: "ended", status, ...(status === "paused" ? { pauseReason: "budget_exceeded" } : {}), workflowName: "Budget run" });
    send("budget-resumed", "paused");
    const resumedText = "“Budget run” paused: budget_exceeded";
    await tid("inbox").getByText(resumedText, { exact: true }).waitFor();
    const resumedEntry = visible(tid("inbox-entry").filter({ hasText: resumedText }));
    if (await resumedEntry.getAttribute("data-waiting") !== "true") throw new Error("the budget pause did not wait initially");
    send("budget-resumed", "running");
    await tid("inbox").getByText(new RegExp(`No longer waiting .*Budget run.*budget_exceeded`), { exact: false }).waitFor();
    const resolvedResume = visible(tid("inbox-entry").filter({ hasText: resumedText }));
    if (await resolvedResume.getAttribute("data-waiting") !== "false") throw new Error("resuming left the budget pause in Needs you");
    send("budget-cancelled", "paused");
    const cancelledText = "“Budget run” paused: budget_exceeded";
    await waitFor(() => tid("inbox-entry").filter({ hasText: cancelledText }).count(), (count) => count >= 2, "a second budget-pause event has a separate entry");
    send("budget-cancelled", "cancelled");
    await waitFor(() => tid("inbox-entry").filter({ hasText: /No longer waiting/ }).count(), (count) => count >= 2, "the cancelled pause is resolved");
    const all = await tid("inbox-entry").filter({ hasText: cancelledText }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-waiting")));
    if (all.some((value) => value !== "false")) throw new Error(`a budget pause still waits: ${JSON.stringify(all)}`);
    await page.screenshot({ path: `${shots}/budget-pauses-resolved.png` });
  });
} catch (error) { failure = error; await page.screenshot({ path: `${shots}/failure.png` }).catch(() => undefined); }
finally { await browser.close(); await h.stop(); }
if (failure || errors.length) { console.error(failure ? String(failure).split("\n")[0] : errors.join("\n")); process.exitCode = 1; }
else console.log("9/9 steps ok; content: fake Gateway ended turns and requested a host approval after real browser-created sessions; host event fixtures exercised chat request, workflow, film, generation and budget-pause transitions; no model or CLI ran; Notification API recorder only.");
