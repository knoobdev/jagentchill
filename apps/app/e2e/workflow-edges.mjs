// End-to-end in a real browser on the PRODUCTION web build: the edges of a workflow with a branch, a fan-out, a join,
// a line that skips two steps and a line that runs backwards are drawn clear of the cards — none under a card, none
// through one. It is measured on what is ON SCREEN: every edge's SVG path is walked (getPointAtLength, every 4 px) and
// each point is tested against the rectangles of the cards as the page laid them out.
// REAL: the app, the JAgentChill Server, the workflow document (made over the host's own API by the admin device, as
// `jagentchill.workflow.create` + `.apply` — the same batches the canvas sends), the canvas. No model is used.
// Usage: JAGENTCHILL_PORT=<port> node apps/app/e2e/workflow-edges.mjs <server-log-file> <screenshot-dir>   (env: E2E_BASE, JC_REPORT=1 → never fails, prints the numbers)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { workflow as wf } from "../../../packages/editor-core/src/index.ts";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/workflow-edges"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8087";
const report = process.env.JC_REPORT === "1";
mkdirSync(shots, { recursive: true });

const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const setup = await pairAdmin(firstOffer, logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });

// — The workflow: the positions are a person's (cards dragged where they wanted them), not the auto-layout's —
let { document } = await setup.call("jagentchill.workflow.create", { name: "Branch, fan-out and join" });
const apply = async (ops) => { await setup.call("jagentchill.workflow.apply", { workflowId: document.id, baseRevision: document.revision, ops }); document = (await setup.call("jagentchill.workflow.get", { workflowId: document.id })).document; };
const trigger = document.nodes.find((node) => node.type === "trigger");
await apply([{ op: "node.move", moves: [{ id: trigger.id, position: { x: 120, y: 200 } }] }]).catch(() => undefined);
const cards = [["branch", "branch", "Which way?", 440, 200], ["wait", "a", "Upper", 760, 60], ["wait", "b", "Lower", 760, 380], ["parallel", "fan", "Fan out", 1080, 60], ["wait", "worker", "Per item", 1400, 60],
  ["wait", "c", "Lower 2", 1080, 380], ["wait", "d", "Lower 3", 1400, 380], ["join", "join", "Join", 1720, 220], ["wait", "end", "End", 2040, 220], ["wait", "far", "Far", 2040, 600], ["wait", "near", "Near", 1080, 640], ["wait", "between", "Between", 1540, 640]];
await apply(cards.map(([type, id, name, x, y]) => ({ op: "node.add", node: { ...wf.makeNode(document, type, { x, y }, id), name } })));
const link = async (from, to) => { const [fromNode, fromPort = "done"] = from.split("."), [toNode, toPort = "start"] = to.split("."); await apply(wf.connectOps(document, { node: fromNode, port: fromPort }, { node: toNode, port: toPort }).ops); };
for (const [from, to] of [[trigger.id, "branch"], ["branch.case_1", "a"], ["branch.else", "b"], ["a", "fan"], ["fan", "worker"], ["worker", "join"], ["join", "end"], ["b", "c"], ["c", "d"], ["b.error", "join"], ["far", "near"]]) await link(from, to);
console.log(`     workflow: ${document.nodes.length} steps, ${document.edges.length} edges`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => { if (!/GPU context not initialized/.test(String(err))) errors.push(String(err)); });
const visible = (locator) => locator.filter({ visible: true }).first();
await page.goto(`${base}/home`, { waitUntil: "networkidle" });
await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 120_000 });
await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
await visible(page.getByLabel("Pairing link", { exact: true })).fill((await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url);
await visible(page.getByLabel("Name of this device", { exact: true })).fill("Studio browser");
await visible(page.getByRole("button", { name: "Continue" })).click();
await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
for (let wait = 0; wait < 50 && !codes.has("Studio browser"); wait++) await page.waitForTimeout(100);
await visible(page.getByLabel("Verification code", { exact: true })).fill(codes.get("Studio browser"));
await visible(page.getByText("Connected", { exact: true })).waitFor();
console.log("ok   The browser pairs with the host");

await page.goto(`${base}/h/${setup.offer.gatewayId}/workflows/${document.id}`, { waitUntil: "networkidle" });
await visible(page.getByTestId("wf-canvas")).waitFor({ timeout: 120_000 });
await page.waitForFunction((count) => document.querySelectorAll('[data-testid^="wf-node-"]:not([data-testid^="wf-node-status"]):not([data-testid="wf-node-tip"])').length >= count, document.nodes.length, { timeout: 60_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/workflow-edges-as-opened.png` });
// The whole graph in view, for the picture and for the measurement.
await visible(page.getByTestId("wf-fit")).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${shots}/workflow-edges.png` });

/** Every drawn edge against every card, on screen. An edge is any stroked, unfilled path of the canvas longer than an arrowhead that starts at a card's edge. */
const measured = await page.evaluate(() => {
  const canvas = [...document.querySelectorAll('[data-testid="wf-canvas"]')].find((node) => node.getClientRects().length > 0);
  const cards = [...canvas.querySelectorAll('[data-testid^="wf-node-"]')].filter((node) => !/^wf-node-(status|tip)/.test(node.getAttribute("data-testid")) && node.getClientRects().length > 0).map((node) => ({ id: node.getAttribute("data-testid").slice(8), box: node.getBoundingClientRect() }));
  const named = [...canvas.querySelectorAll('path[data-testid^="wf-edge-"]')];
  // A build without ids on its edges: the paths that are long enough to be an edge, once each (the glow and the trace draw the same line again).
  const paths = named.length ? named : [...new Map([...canvas.querySelectorAll("svg path")].filter((path) => path.getAttribute("fill") === "none" && path.getTotalLength() > 40 && path.ownerSVGElement.getBoundingClientRect().width > 300 /* the sheet of the edges, not an icon's own svg */).map((path) => [path.getAttribute("d"), path])).values()];
  const inside = (point, box, grow) => point.x > box.left - grow && point.x < box.right + grow && point.y > box.top - grow && point.y < box.bottom + grow;
  const edges = paths.map((path) => {
    const length = path.getTotalLength(), matrix = path.getScreenCTM(), at = (distance) => { const point = path.getPointAtLength(distance); return new DOMPoint(point.x, point.y).matrixTransform(matrix); };
    const first = at(0), last = at(length);
    // The two cards an edge joins are those its ends touch.
    const own = cards.filter((card) => inside(first, card.box, 6) || inside(last, card.box, 6)).map((card) => card.id);
    const through = new Set();
    for (let distance = 0; distance <= length; distance += 4) { const point = at(distance); for (const card of cards) if (!own.includes(card.id) && inside(point, card.box, -1)) through.add(card.id); }
    // Its own cards: away from its two ends it must not be inside them either.
    for (let distance = 24; distance <= length - 24; distance += 4) { const point = at(distance); for (const card of cards) if (own.includes(card.id) && inside(point, card.box, -2)) through.add(`${card.id} (its own)`); }
    return { id: path.getAttribute("data-testid")?.slice(8) ?? null, routed: path.getAttribute("data-routed"), own, through: [...through], length: Math.round(length) };
  });
  return { cards: cards.length, edges };
});
const crossing = measured.edges.filter((edge) => edge.through.length > 0);
const numbers = { cards: measured.cards, edges: measured.edges.length, routed: measured.edges.filter((edge) => edge.routed === "1").length, edgesThroughCards: crossing.length, which: crossing.map((edge) => `${edge.own.join(" → ")} runs through ${edge.through.join(", ")}`) };
console.log(`numbers ${JSON.stringify(numbers)}`);
if (measured.cards < 13 || measured.edges.length < 11) errors.push(`the canvas did not draw the workflow: ${measured.cards} cards, ${measured.edges.length} edges`);
if (crossing.length) errors.push(`${crossing.length} of ${measured.edges.length} edges are drawn through a card`);
await browser.close();
setup.close?.();
console.log(errors.length ? `errors\n${errors.join("\n")}` : "no errors");
process.exit(errors.length && !report ? 1 : 0);
