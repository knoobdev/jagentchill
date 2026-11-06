// W11h user-path re-checks for virtual-list extremes, keyboard/thumb, search restoration, and the new-messages pill.
// Usage: JAGENTCHILL_PORT=<p> STUB_PORT=<p+2> STUB_KEY=<local> E2E_BASE=<web> VF_RUN=<run-dir> node apps/app/e2e/w11h-chat-scroll-interactions.mjs <server-log> <shots-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";
import { freshOffer } from "../../../.dev/orc/vf-chat/fresh-offer.mjs";

const [logFile, shots = ".dev/shots/w11h-chat-scroll-interactions"] = process.argv.slice(2);
if (!logFile) throw new Error("usage: w11h-chat-scroll-interactions.mjs <server-log> <shots-dir>");
const base = process.env.E2E_BASE ?? "http://localhost:8098";
const stubPort = Number(process.env.STUB_PORT), stubKey = process.env.STUB_KEY;
mkdirSync(shots, { recursive: true });
const admin = await pairAdmin(await freshOffer(logFile), logFile, `W11h interactions ${Date.now() % 100000}`);
const { sessions } = await admin.call("jagentchill.session.list", {});
const session = sessions.find((entry) => entry.title?.startsWith("Turn 1: what is on the timeline")) ?? sessions[0];
if (!session) throw new Error("isolated long fixture session was not found");
await admin.call("jagentchill.chat.subscribe", { sessionKey: session.sessionKey });
const streamSession = (await admin.call("jagentchill.session.create", { ref: session.ref, title: "W11h stream pill fixture" })).session;
await admin.call("jagentchill.session.access.set", { sessionKey: streamSession.sessionKey, access: "host" });
await admin.call("jagentchill.chat.subscribe", { sessionKey: streamSession.sessionKey });
let streamFinals = 0;
admin.on((event, payload) => { if (event === "jagentchill.chat.stream" && payload.sessionKey === streamSession.sessionKey && payload.state === "final") streamFinals++; });
const registerScript = async (match, say, stream = {}) => {
  const response = await fetch(`http://127.0.0.1:${stubPort}/__script`, { method: "POST", headers: { authorization: `Bearer ${stubKey}`, "content-type": "application/json" }, body: JSON.stringify({ match, steps: [{ say, ...stream }] }) });
  if (!response.ok) throw new Error(`stub rejected ${match}: ${response.status}`);
};
for (let n = 1; n <= 3; n++) {
  const match = `W11h pill baseline ${n}`, expected = streamFinals + 1;
  await registerScript(match, `Baseline answer ${n}: keep the newest cut clear.`);
  await admin.call("jagentchill.chat.send", { sessionKey: streamSession.sessionKey, message: match });
  const until = Date.now() + 30_000;
  while (streamFinals < expected && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
  if (streamFinals < expected) throw new Error(`local stub baseline did not finish: ${match}`);
}
const codes = new Map();
admin.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--disable-features=OverlayScrollbar"], ignoreDefaultArgs: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, colorScheme: "light" });
const cdp = await page.context().newCDPSession(page);
const historyOffsets = [];
await page.addInitScript(() => { window.__w11ScrollTrace = { frames: [], writers: [] }; });
page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
  if (typeof payload !== "string") return;
  try { const frame = JSON.parse(payload); if (frame.method === "jagentchill.chat.history") historyOffsets.push(frame.params?.offset ?? 0); } catch { /* channel frame */ }
}));
const numbers = {};
const list = page.getByTestId("chat-scroll").filter({ visible: true }).first();
const state = () => page.evaluate(() => {
  const list = [...document.querySelectorAll('[data-testid="chat-scroll"]')].filter((node) => { const r = node.getBoundingClientRect(); return r.width && r.height; }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
  if (!list) return null;
  const rect = list.getBoundingClientRect(), content = list.firstElementChild, rows = [...list.querySelectorAll("[data-wkey]")];
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { top: Math.round((r.top - rect.top) * 10) / 10, bottom: Math.round((r.bottom - rect.top) * 10) / 10, height: Math.round(r.height * 10) / 10, key: node.dataset.wkey ?? null }; };
  const messages = [...list.querySelectorAll('[data-testid="user-message"],[data-testid="assistant-message"],[data-testid="activity-group"],[data-testid="host-status-card"]')];
  const windowed = list.querySelector('[data-testid="chat-window"]');
  const listRect = list.getBoundingClientRect(), composer = document.querySelector('[data-testid="chat-composer-dock"]'), composerRect = composer?.getBoundingClientRect();
  return { top: Math.round(list.scrollTop), maxTop: Math.round(list.scrollHeight - list.clientHeight), clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, listTop: listRect.top, listBottom: listRect.bottom, listPaddingTop: parseFloat(getComputedStyle(list).paddingTop) || 0, composerRect: composerRect ? { top: composerRect.top, bottom: composerRect.bottom } : null, composerVisible: Boolean(composerRect && composerRect.top >= 0 && composerRect.bottom <= window.innerHeight), hasOlder: window.__w11ScrollTrace?.hasOlder ?? null, loadingOlder: window.__w11ScrollTrace?.loadingOlder ?? null, transform: content ? getComputedStyle(content).transform : null, transformY: content ? new DOMMatrixReadOnly(getComputedStyle(content).transform).m42 : 0, contentRect: box(content), firstRow: box(rows[0]), lastRow: box(rows.at(-1)), firstMessageRow: box(messages[0]), lastMessageRow: box(messages.at(-1)), firstRowText: rows[0]?.textContent?.replace(/\s+/g, " ").slice(0, 180) ?? null, visibleRowsText: rows.map((row) => row.textContent ?? "").join(" ").replace(/\s+/g, " ").slice(0, 800), window: windowed ? { placed: windowed.dataset.placed, first: Number(windowed.dataset.first), end: Number(windowed.dataset.end), rows: Number(windowed.dataset.rows) } : null, scrollbarWidth: list.offsetWidth - list.clientWidth, activeElement: document.activeElement?.tagName, activeTabIndex: document.activeElement?.getAttribute("tabindex"), activeTestId: document.activeElement?.getAttribute("data-testid") };
});
const wheelToEdge = async (direction) => {
  const point = await list.evaluate((node) => { const r = node.getBoundingClientRect(); return { x: Math.round(r.left + node.clientWidth / 2), y: Math.round(r.top + node.clientHeight / 2) }; });
  const values = [];
  for (let event = 0; event < 1400; event++) {
    const before = await list.evaluate((node) => node.scrollTop);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: direction === "down" ? 5000 : -5000 });
    await page.waitForTimeout(16);
    const after = await list.evaluate((node) => node.scrollTop);
    values.push(after);
    const max = await list.evaluate((node) => node.scrollHeight - node.clientHeight);
    const atTrueTop = direction === "up" ? await state() : null;
    if (direction === "down" ? after >= max - 1 : after <= 1 && Math.abs(atTrueTop.transformY) <= 2 && atTrueTop.window?.first === 0) return { reached: true, events: event + 1, wrongFrames: values.slice(1).filter((value, i) => direction === "down" ? value < values[i] - 2 : value > values[i] + 2).length, top: Math.round(after), maxTop: Math.round(max) };
    if (Math.abs(after - before) < 1 && event > 5) { await page.waitForTimeout(200); }
  }
  const end = await state();
  return { reached: direction === "down" ? end.top >= end.maxTop - 1 : end.top <= 1, events: 1400, wrongFrames: values.slice(1).filter((value, i) => direction === "down" ? value < values[i] - 2 : value > values[i] + 2).length, top: end.top, maxTop: end.maxTop };
};
try {
  const offer = (await admin.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByLabel("Pairing link", { exact: true }).fill(offer);
  await page.getByLabel("Name of this device", { exact: true }).fill("W11h interaction browser");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText(/next to [0-9a-f]{8}/).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("W11h interaction browser"); wait++) await page.waitForTimeout(100);
  await page.getByTestId("pairing-verification-code").fill(codes.get("W11h interaction browser"));
  await page.goto(`${base}/h/${admin.offer.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "domcontentloaded" });
  await list.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => { const list = document.querySelector('[data-testid="chat-scroll"]'), windowed = list?.querySelector('[data-testid="chat-window"]'); return !!list && Number(windowed?.dataset.rows ?? 0) >= 30 && list.scrollHeight > 3000; }, null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.waitForTimeout(400);

  // Start from the top of the currently loaded page; the loop below loads each preceding page explicitly.
  const traversals = [{ topOfLoadedPage: await list.evaluate((node) => { node.scrollTop = 0; return Math.round(node.scrollTop); }) }];
  const olderLoads = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const before = await state();
    if (/Turn 1:/.test(before.visibleRowsText ?? "")) break;
    const requestCount = historyOffsets.length;
    await list.evaluate((node) => { node.scrollTop = 2; });
    const point = await list.evaluate((node) => { const r = node.getBoundingClientRect(); return { x: Math.round(r.left + node.clientWidth / 2), y: Math.round(r.top + 30) }; });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -40 });
    for (let wait = 0; wait < 30 && historyOffsets.length === requestCount; wait++) await page.waitForTimeout(100);
    await page.waitForTimeout(150);
    const after = await state();
    olderLoads.push({ attempt: attempt + 1, requestsBefore: requestCount, requestsAfter: historyOffsets.length, firstRowText: after.firstRowText, window: after.window, top: after.top });
    if (historyOffsets.length === requestCount) break;
  }
  const oldestPageOffsets = [...historyOffsets];
  const oldestLoaded = (await state()).hasOlder === false;
  if (!oldestLoaded) throw new Error(`older history loading stopped before Turn 1; offsets=${JSON.stringify(oldestPageOffsets)}`);
  // Once the oldest page is present, traverse the complete transcript five times before taking the edge screenshots.
  const fullHistoryTraversals = [];
  for (let cycle = 1; cycle <= 5; cycle++) {
    const up = await wheelToEdge("up"); await page.waitForTimeout(200);
    const atTop = await state();
    if (cycle === 1 && !/Turn 1:/.test(atTop.visibleRowsText ?? "")) throw new Error(`all older pages loaded but Turn 1 is not visible at top: ${JSON.stringify({ top: atTop.top, transformY: atTop.transformY, window: atTop.window, firstRowText: atTop.firstRowText })}`);
    const down = await wheelToEdge("down"); await page.waitForTimeout(200);
    const atBottom = await state();
    fullHistoryTraversals.push({ cycle, up, atTop, down, atBottom });
  }
  const top = await wheelToEdge("up");
  await page.waitForTimeout(500);
  const topGeometry = await state();
  await page.screenshot({ path: `${shots}/five-cycles-top-1100x700.png` });
  const bottom = await wheelToEdge("down");
  await page.waitForTimeout(300);
  const bottomGeometry = await state();
  await page.screenshot({ path: `${shots}/five-cycles-bottom-1100x700.png` });
  numbers.fiveCycleEdges = { traversalsBeforeOldestLoaded: traversals, olderLoads, oldestLoaded, fullHistoryTraversals, top, topGeometry, bottom, bottomGeometry, historyOffsets: oldestPageOffsets };
  writeFileSync(`${shots}/numbers.json`, JSON.stringify(numbers, null, 2));

  // Keyboard movement through the focused conversation list.
  await list.click({ position: { x: 80, y: 80 } });
  await list.evaluate((node) => node.focus());
  const keyboard = [];
  for (const key of ["PageUp", "PageDown", "Home", "End"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    keyboard.push({ key, ...(await state()) });
  }
  numbers.keyboard = keyboard;

  // Drag at the native scrollbar track edge. On macOS Chromium may report an overlay scrollbar with zero layout width.
  const beforeThumb = await state();
  let scrollbar = { available: beforeThumb.maxTop > 0, width: beforeThumb.scrollbarWidth, moved: false, beforeTop: beforeThumb.top, afterTop: beforeThumb.top };
  if (scrollbar.available) {
    const rect = await list.boundingBox();
    const thumbHeight = Math.max(24, beforeThumb.clientHeight * beforeThumb.clientHeight / beforeThumb.scrollHeight);
    const track = Math.max(1, beforeThumb.clientHeight - thumbHeight);
    const startY = rect.y + (beforeThumb.top / beforeThumb.maxTop) * track + thumbHeight / 2;
    const endY = rect.y + track / 2 + thumbHeight / 2;
    const x = rect.x + rect.width - Math.max(2, scrollbar.width / 2);
    await page.mouse.move(x, startY); await page.mouse.down(); await page.mouse.move(x, endY, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const afterTop = (await state()).top;
    scrollbar = { ...scrollbar, moved: Math.abs(afterTop - beforeThumb.top) > 50, afterTop };
  }
  numbers.scrollbarThumb = scrollbar;
  writeFileSync(`${shots}/numbers.json`, JSON.stringify(numbers, null, 2));
  await page.screenshot({ path: `${shots}/keyboard-scrollbar-1100x700.png` });

  // Search from a mid-history reading position, step to another result, then escape back to the held row.
  await list.evaluate((node) => { node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) * 0.45); });
  await page.waitForTimeout(200);
  const beforeSearch = await list.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const row = [...node.querySelectorAll("[data-wkey]")].find((entry) => { const r = entry.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; });
    return { top: node.scrollTop, key: row?.dataset.wkey ?? null, offset: row ? row.getBoundingClientRect().top - bounds.top : null };
  });
  await page.evaluate((key) => { document.body.dataset.w11hSearchKey = key ?? ""; }, beforeSearch.key);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  const input = page.getByTestId("chat-search-input"); await input.waitFor({ timeout: 15_000 });
  await input.fill("Turn ");
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="chat-search-count"]')?.textContent?.match(/\d+ of (\d+)/)?.[1] ?? 0) > 1, null, { timeout: 30_000 });
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const firstSearch = await page.getByTestId("chat-search-count").innerText();
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
  const secondSearch = await page.getByTestId("chat-search-count").innerText();
  const matchRect = await page.evaluate(() => {
    const row = [...document.querySelectorAll("[data-search-id]")].find((entry) => { const r = entry.getBoundingClientRect(); return r.width && r.height; });
    const list = [...document.querySelectorAll('[data-testid="chat-scroll"]')].find((entry) => { const r = entry.getBoundingClientRect(); return r.width && r.height; });
    if (!row || !list) return null;
    const a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
    return { rowTop: Math.round(a.top - b.top), rowBottom: Math.round(a.bottom - b.top), listHeight: b.height, centerDelta: Math.round(((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) * 10) / 10 };
  });
  await page.screenshot({ path: `${shots}/search-match-1100x700.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  const returned = await list.evaluate((node) => {
    const bounds = node.getBoundingClientRect(), row = [...node.querySelectorAll("[data-wkey]")].find((entry) => entry.dataset.wkey === document.body.dataset.w11hSearchKey);
    return { top: node.scrollTop, rowOffset: row ? row.getBoundingClientRect().top - bounds.top : null };
  });
  numbers.search = { beforeSearch, firstSearch, secondSearch, matchRect, returned, originalAnchorOffset: beforeSearch.offset };
  writeFileSync(`${shots}/numbers.json`, JSON.stringify(numbers, null, 2));
  await page.screenshot({ path: `${shots}/search-escape-restored-1100x700.png` });

  // A real UI send starts the stream; wheel away during growth, click New messages, then verify follow-end resumes.
  await page.goto(`${base}/h/${admin.offer.gatewayId}/sessions/${encodeURIComponent(streamSession.sessionKey)}`, { waitUntil: "domcontentloaded" });
  await list.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await list.evaluate((node) => { node.scrollTop = node.scrollHeight; }); await page.waitForTimeout(250);
  const streamPrompt = `W11h stream pill ${Date.now()}`;
  const finalCountBeforeStream = streamFinals;
  const streamText = `STREAM_START ${Array.from({ length: 260 }, (_, index) => `Segment ${index + 1}: the last messages continue while the reader stays in the middle.`).join(" ")} STREAM_END`;
  await registerScript(streamPrompt, streamText, { chunks: 400, chunk_ms: 40, pause_at: 9_000, pause_ms: 20_000 });
  const composer = page.getByPlaceholder(/Ask or guide the agent/);
  await composer.fill(streamPrompt); await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-scroll"]')].some((node) => { const r = node.getBoundingClientRect(); return r.width && r.height && node.textContent?.includes("STREAM_START"); }), null, { timeout: 30_000 });
  const point = await list.evaluate((node) => { const r = node.getBoundingClientRect(); return { x: Math.round(r.left + node.clientWidth / 2), y: Math.round(r.top + node.clientHeight / 2) }; });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 80; i++) {
    const position = await list.evaluate((node) => ({ top: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
    const ratio = position.max > 0 ? position.top / position.max : 1;
    if (ratio >= 0.3 && ratio <= 0.7 && position.max > 200) break;
    const deltaY = ratio > 0.7 ? -250 : 100;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY });
    await page.waitForTimeout(16);
  }
  const pill = page.getByTestId("chat-jump-newest").filter({ visible: true }).first();
  await pill.waitFor({ timeout: 15_000 });
  const pillWasVisible = await pill.isVisible();
  const pillState = await state();
  const pillRatio = pillState.maxTop > 0 ? pillState.top / pillState.maxTop : 1;
  const streamActiveAtClick = streamFinals === finalCountBeforeStream;
  await page.screenshot({ path: `${shots}/new-messages-pill-streaming-1100x700.png` });
  await pill.click();
  await page.getByText("STREAM_END", { exact: false }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(200);
  const following = await state();
  numbers.newMessages = { midHistory: pillState, ratioFromEnd: pillRatio, pillVisible: pillWasVisible, streamActiveAtClick, afterClick: following, distanceFromEnd: following.maxTop - following.top };
  await page.screenshot({ path: `${shots}/new-messages-follow-end-1100x700.png` });

  writeFileSync(`${shots}/numbers.json`, JSON.stringify(numbers, null, 2));
  console.log(JSON.stringify(numbers));
  const edge = (s) => Math.abs(s.transformY) <= 2;
  if (!top.reached || !bottom.reached || topGeometry.top !== 0 || topGeometry.window?.first !== 0 || !topGeometry.firstRow || !bottomGeometry.lastRow || !edge(topGeometry) || !edge(bottomGeometry) || Math.abs(topGeometry.firstRow.top - topGeometry.listPaddingTop) > 2 || Math.abs((bottomGeometry.lastMessageRow?.bottom ?? -Infinity) - bottomGeometry.clientHeight) > 2 || bottomGeometry.top !== bottomGeometry.maxTop || !bottomGeometry.composerVisible || bottomGeometry.lastMessageRow.bottom + bottomGeometry.listTop > bottomGeometry.composerRect.top + 2) throw new Error("five-cycle top/bottom geometry failed after all older pages were loaded");
  if (Number(secondSearch.match(/(\d+) of/)?.[1]) <= Number(firstSearch.match(/(\d+) of/)?.[1]) || Math.abs((returned.rowOffset ?? Infinity) - beforeSearch.offset) > 3) throw new Error("search stepping or Escape reading-place restore failed");
  if (!pillWasVisible || !streamActiveAtClick || pillRatio < 0.25 || pillRatio > 0.75 || following.maxTop - following.top > 48) throw new Error("new-messages mid-history or follow-end check failed");
  if (!scrollbar.moved) throw new Error("native scrollbar drag did not move the chat list");
} finally { await browser.close(); admin.close(); }
