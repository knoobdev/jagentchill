// Evidence extension: distinct sessions, exact unread counts, enabled-category focus suppression, unconditional Mark all read and session/workflow cursors.
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
await context.addInitScript(() => { class Recorder { static permission = "default"; static requestPermission = async () => {Recorder.permission="granted";return "granted"}; constructor() {} close() {} } window.Notification = Recorder;window.__os=[];const Base=Recorder;window.Notification=class extends Base {constructor(title,options){super();window.__os.push({title,options})}}; const set=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=function(id){window.__capture=this;return set.call(this,id)};window.addEventListener("pointerup",()=>window.__capture=null,true);document.hasFocus=()=>true; });
const page = await context.newPage(), errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const label = (name) => visible(page.getByLabel(name, { exact: true }));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const text = (value) => visible(page.getByText(value, { exact: true }));
const wait = async (read, yes, name) => { for (let i = 0; i < 100; i++) { const value = await read(); if (yes(value)) return value; await page.waitForTimeout(100); } throw new Error(`${name}: ${JSON.stringify(await read())}`); };

const cursorRows=[];
async function probe(handle,x,y,want,button="left"){
 await page.mouse.move(x,y);await page.waitForTimeout(100);
 const at=await page.evaluate(([x,y])=>{const n=document.elementFromPoint(x,y);return n?getComputedStyle(n).cursor:"none"},[x,y]);
 await page.mouse.down({button});await page.mouse.move(x+65,y+60,{steps:8});await page.waitForTimeout(100);
 const drag=await page.evaluate(([x,y])=>{const n=window.__capture?.isConnected?window.__capture:document.elementFromPoint(x,y);return {cursor:n?getComputedStyle(n).cursor:"none",select:n?getComputedStyle(n).userSelect:"?"}},[x+65,y+60]);
 await page.mouse.move(x,y,{steps:8});await page.mouse.up({button});
 cursorRows.push({handle,hover:at,drag:drag.cursor,selection:drag.select,want,ok:at===want&&drag.cursor===(want==="grab"?"grabbing":want)});
 console.log(`handle ${handle}: hover=${at} drag-off=${drag.cursor} selection=${drag.select}`);
}
async function survey(screen){
 const handles=await page.locator('[role="separator"][aria-orientation]').filter({visible:true}).all();console.log(`survey ${screen}: ${handles.length} separators`);
 for(const n of handles){const b=await n.boundingBox(),orientation=await n.getAttribute("aria-orientation"),id=await n.getAttribute("data-testid");if(b)await probe(`${screen} ${id}`,b.x+b.width/2,b.y+b.height/3,orientation==="vertical"?"col-resize":"row-resize");}
 await page.screenshot({path:`${shots}/${screen.replaceAll(" ","-")}.png`});
}

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
  await page.goto(`${base}/settings/notifications`,{waitUntil:"networkidle"});
  await page.getByRole("switch",{name:"Show notifications outside the app",exact:true}).click();
  await page.goto(`${base}/home?focus=1`,{waitUntil:"networkidle"});
  const first = await send("first matching completion");
  await survey("Session view");
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" }); h.fake.endTurn(first.sessionKey, first.runId, "final");
  await page.goto(`${base}/home?focus=1`, { waitUntil: "networkidle" });
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


  console.log(`completion rows=${results.length} groups=${results.map(r=>r.group).join(",")} waiting=${results.map(r=>r.waiting).join(",")}`);
  const badge=async()=>Number((await tid("footer-notifications").getAttribute("aria-label")).match(/\d+/)?.[0]??0);
  if(await badge()!==2)throw Error(`Expected unread badge 2 got ${await badge()}`);
  if((await page.evaluate(()=>window.__os)).length!==0)throw Error("Focused completion caused OS notification with Finished category ON");
  for(const expected of [second,first]){
   await page.locator('[data-testid="inbox-entry"][data-read="false"]').filter({visible:true}).filter({hasText:"“Agent” finished"}).getByTestId("inbox-entry-link").first().click();
   await wait(()=>decodeURIComponent(new URL(page.url()).pathname),p=>p.endsWith(`/sessions/${expected.sessionKey}`),"completion routes to correct separate session");
   const count=await badge();console.log(`clicked completed ${expected.runId}: route=${page.url()} unread=${count}`);
   if(count!==(expected===second?1:0))throw Error(`wrong unread ${count}`);
   await page.screenshot({path:`${shots}/clicked-${expected.runId}.png`});
   if(!(await tid("inbox").count()))await tid("footer-notifications").click();await tid("inbox").waitFor();
   // The clicked entry remains visible; identify the still-unread entry next time.

  }
  await page.goto(`${base}/projects`,{waitUntil:"networkidle"});await tid("footer-notifications").click();await tid("inbox").waitFor();
  for(const [requestId,sessionKey] of [["req-one",first.sessionKey],["req-two",second.sessionKey]])h.app.channel.sendToScope("jagentchill.projects.read","jagentchill.chat.permission.requested","fixture",{request:{requestId,sessionKey,toolLabel:"Read identical files"}});
  await wait(()=>page.getByTestId("inbox-entry").filter({visible:true,hasText:"Read identical files"}).count(),n=>n===2,"same-worded requests in two sessions");
  console.log(`same-worded permissions=2 unread=${await badge()}`);if(await badge()!==2)throw Error("request badge not 2");
  await tid("inbox-read-all").click();await wait(badge,n=>n===0,"unconditional mark all read");
  console.log("mark-all-read: unread 2 -> 0; focused Finished category ON: recorder 0");
  await page.screenshot({path:`${shots}/requests-mark-all-read.png`});
  await page.keyboard.press("Escape");
  await page.goto(`${base}/h/${h.app.host.gatewayId}/workflows`,{waitUntil:"networkidle"});await tid("workflow-new").click();await tid("wf-palette").waitFor();
  await survey("Workflow");
  const palette=await page.locator('[data-testid^="wf-palette-"]').filter({visible:true}).all();
  for(const node of palette){const id=await node.getAttribute("data-testid");if(id==="wf-palette-ghost")continue;await node.scrollIntoViewIfNeeded();const b=await node.boundingBox();if(b)await probe(id,b.x+20,b.y+b.height/2,"grab");}
  await tid("wf-palette-wait").focus();await tid("wf-palette-wait").press("Enter");await page.waitForTimeout(400);await tid("wf-fit").click();await page.waitForTimeout(400);
  const wfNodes=await page.locator('[data-testid^="wf-node-"][data-type]').filter({visible:true}).all();
  for(const node of wfNodes){const b=await node.boundingBox();if(b)await probe(await node.getAttribute("data-testid"),b.x+50,b.y+25,"grab");}
  const output=page.locator('[data-testid^="wf-port-"]').filter({visible:true}).filter({hasNot:page.locator('[data-accepts="false"]')});
  const startPort=page.getByTestId("wf-port-start-out-done");await page.getByTestId("wf-node-start").hover();await page.waitForTimeout(200);const portBox=await startPort.boundingBox();if(portBox)await probe("workflow output port",portBox.x+portBox.width/2,portBox.y+portBox.height/2,"crosshair");
  const canvas=await tid("wf-canvas").boundingBox();if(canvas)await probe("workflow canvas pan",canvas.x+canvas.width/2,canvas.y+canvas.height-120,"grab","middle");
  await tid("wf-toggle-agent").click();await tid("wf-agent-panel").waitFor();await survey("Workflow with agent");
  await page.screenshot({path:`${shots}/workflow-agent.png`});
  await page.goto(`${base}/projects`,{waitUntil:"networkidle"});await tid("footer-notifications").click();await tid("inbox").waitFor();

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
finally { const {writeFileSync}=await import("node:fs");writeFileSync(`${shots}/handles.json`,JSON.stringify(cursorRows,null,2));await browser.close();await h.stop(); }
if (failure || errors.length || cursorRows.some(row=>!row.ok)) { console.error(failure ? String(failure) : errors.join("\n")); process.exitCode = 1; }
else console.log("2/2 checks pass; turns came from the fake Gateway; run transitions came from host event fixtures; Notification API recorder only.");
