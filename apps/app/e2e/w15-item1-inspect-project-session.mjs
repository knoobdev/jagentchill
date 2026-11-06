// Isolated follow-up for W15 item 1 with settled questions in a long session transcript.
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";
import { freshOffer } from "../../../.dev/orc/vf-chat/fresh-offer.mjs";
const logFile = process.argv[2], shots = process.argv[3];
if (!logFile || !shots) throw new Error("usage: w15-item1-inspect-project-session.mjs <server-log> <shots-dir>");
const setup = await pairAdmin(await freshOffer(logFile), logFile, `W15 inspect ${Date.now() % 100000}`);
const { sessions } = await setup.call("jagentchill.session.list", {});
const session = sessions.find((entry) => entry.title === "W15 settled questions after external answers");
if (!session) throw new Error("settled project session not found");
const questions = await setup.call("jagentchill.chat.question.list", { sessionKey: session.sessionKey });
if (questions.questions.length !== 8 || questions.questions.some((entry) => entry.state !== "answered")) throw new Error(`expected eight answered host requests: ${JSON.stringify(questions.questions.map((entry) => entry.state))}`);
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.addInitScript(() => { Object.defineProperty(window, "__w11ScrollTrace", { value: {}, configurable: true }); });
  const codes = new Map();
  setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  const token = /#offer=(.+)$/.exec(offer)?.[1];
  await page.goto(`${process.env.E2E_BASE}/pair-link?offer=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name of this device", { exact: true }).fill("W15 inspect browser");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pairing-verification-code").waitFor({ timeout: 60_000 });
  for (let n = 0; n < 100 && !codes.has("W15 inspect browser"); n++) await page.waitForTimeout(100);
  await page.getByTestId("pairing-verification-code").fill(codes.get("W15 inspect browser"));
  await page.getByTestId("sidebar").waitFor({ timeout: 60_000 });
  await page.goto(`${process.env.E2E_BASE}/h/${setup.offer.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-scroll").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const diagnostics = await page.evaluate(() => ({
    body: document.body.innerText.slice(-1800),
    cards: [...document.querySelectorAll('[data-testid="question-card"]')].map((card) => ({ state: card.getAttribute("data-state"), question: card.getAttribute("data-question") })),
    scrollables: [...document.querySelectorAll('[data-testid="chat-scroll"]')].map((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, top: node.scrollTop, rect: (() => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })),
  }));
  const records = [];
  const list = page.locator('[data-testid="chat-scroll"]').filter({ visible: true }).first();
  const cdp = await page.context().newCDPSession(page);
  for (const [width, height] of [[1440, 900], [1100, 700]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
    // Settled cards stay at their transcript position; inspect them at the start of the history.
    await list.evaluate((node) => { node.scrollTop = 0; });
    await page.waitForTimeout(150);
    const settled = await list.evaluate((node) => {
      const cards = [...document.querySelectorAll('[data-testid="question-card"]')], composer = document.querySelector('[data-testid="chat-composer-dock"]');
      return { top: Math.round(node.scrollTop), max: Math.round(node.scrollHeight - node.clientHeight), cards: cards.map((card) => ({ state: card.getAttribute("data-state"), question: card.getAttribute("data-question"), bottom: Math.round(card.getBoundingClientRect().bottom) })), composerTop: Math.round(composer?.getBoundingClientRect().top ?? 0) };
    });
    if (settled.cards.length !== 8 || settled.cards.some((entry) => entry.state !== "answered")) throw new Error(`all eight answered host requests must render settled at the start at ${width}x${height}: ${JSON.stringify({ settled, diagnostics })}`);
    await page.screenshot({ path: `${shots}/item1-session-answered-${width}x${height}-start.png` });
    await list.evaluate((node) => { node.scrollTop = node.scrollHeight - node.clientHeight; });
    await page.waitForTimeout(150);
    const coords = await list.evaluate((node) => {
      node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2);
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), start: Math.round(node.scrollTop), max: Math.round(node.scrollHeight - node.clientHeight) };
    });
    await page.waitForTimeout(150);
    const start = await list.evaluate((node) => Math.round(node.scrollTop));
    if (start < 1 || Math.abs(start - coords.max / 2) > 40 || start >= coords.max - 1) throw new Error(`wheel baseline was not the middle at ${width}x${height}: ${JSON.stringify({ start, max: coords.max })}`);
    await page.evaluate(() => { window.__w15SessionScroll = []; const tick = () => { const node = document.querySelector('[data-testid="chat-scroll"]'), win = node?.querySelector('[data-testid="chat-window"]'); window.__w15SessionScroll.push({ top: Math.round(node?.scrollTop ?? 0), max: Math.round((node?.scrollHeight ?? 0) - (node?.clientHeight ?? 0)), placed: win?.dataset.placed, first: win?.dataset.first, end: win?.dataset.end, rows: win?.dataset.rows, anchor: window.__w11ScrollTrace }); if (window.__w15SessionScroll.length < 5000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    let previous = start, stable = 0, events = 0;
    for (; events < 1000 && stable < 10; events++) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: coords.x, y: coords.y, deltaX: 0, deltaY: 40 }); await page.waitForTimeout(16); const now = await list.evaluate((node) => node.scrollTop); stable = Math.abs(now - previous) < 1 ? stable + 1 : 0; previous = now; }
    await page.waitForTimeout(80);
    const measured = await page.evaluate(() => {
      const values = window.__w15SessionScroll ?? [], card = [...document.querySelectorAll('[data-testid="question-card"]')].at(-1), composer = document.querySelector('[data-testid="chat-composer-dock"]'), list = document.querySelector('[data-testid="chat-scroll"]');
      let wrong = 0, maxWrong = 0; const samples = []; for (let i = 1; i < values.length; i++) if (values[i].top < values[i - 1].top - 2) { wrong++; maxWrong = Math.max(maxWrong, values[i - 1].top - values[i].top); if (samples.length < 8) samples.push({ frame: i, before: values[i - 1], after: values[i] }); }
      return { frames: values.length, wrong_direction_frames: wrong, max_wrong_direction_px: maxWrong, wrong_samples: samples, final: Math.round(list?.scrollTop ?? 0), max: Math.round((list?.scrollHeight ?? 0) - (list?.clientHeight ?? 0)), cardBottom: Math.round(card?.getBoundingClientRect().bottom ?? 0), composerTop: Math.round(composer?.getBoundingClientRect().top ?? 0) };
    });
    records.push({ viewport: `${width}x${height}`, start, wheel_events: events, ...measured });
    await page.screenshot({ path: `${shots}/item1-session-answered-${width}x${height}-wheel.png` });
  }
  console.log(JSON.stringify({ projectId: session.projectId, sessionKey: session.sessionKey, questionStates: questions.questions.map((entry) => entry.state), diagnostics: { cards: diagnostics.cards, scrollables: diagnostics.scrollables }, records }));
  if (records.some((entry) => entry.wrong_direction_frames > 0 || entry.max - entry.final > 2)) throw new Error(`answered question scroll assertions failed: ${JSON.stringify(records)}`);
} finally { await browser.close(); setup.close(); }
