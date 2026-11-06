// Inspect the coordinator-supplied real-data copy without sending a model turn.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const logFile = process.argv[2], shots = process.argv[3];
if (!logFile || !shots) throw new Error("usage: w15c-realdata-inspect.mjs <host-log> <shots-dir>");
mkdirSync(shots, { recursive: true });
const offerUrl = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!offerUrl) throw new Error("host pairing offer was not printed");
const offerToken = /#offer=(.+)$/.exec(offerUrl)?.[1];
const offer = JSON.parse(Buffer.from(offerToken, "base64url").toString("utf8"));
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`http://localhost:8098/pair/start?offer=${encodeURIComponent(offerToken)}`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name of this device", { exact: true }).fill("W15c real-data browser");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pairing-verification-code").waitFor({ timeout: 30_000 });
  let log = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    log = readFileSync(logFile, "utf8");
    if (log.includes("W15c real-data browser")) break;
    await page.waitForTimeout(100);
  }
  const line = log.split("\n").filter((entry) => entry.includes("W15c real-data browser")).at(-1) ?? "";
  const code = /code (\d{6})/.exec(line)?.[1];
  if (!code) throw new Error(`pairing code not found in host log: ${line}`);
  await page.getByTestId("pairing-verification-code").fill(code);
  await page.getByTestId("sidebar").waitFor({ timeout: 30_000 });

  const sessions = [
    ["agent:main:jc:c3299951-015f-40a1-ada9-03390b06713d", "search-1"],
    ["agent:main:jc:da2182f4-327c-44f4-9bc4-843b3b398c43", "search-2"],
    ["agent:main:jc:a553ef4b-1c51-477a-b224-b5efdba55111", "script"],
    ["agent:main:jc:47c07f6e-8fd5-4a4a-9cdc-450e16ee5866", "video-project"],
  ];
  const records = [];
  for (const [sessionKey, name] of sessions) {
    for (const [width, height] of [[1440, 900], [1100, 700]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`http://localhost:8098/h/${offer.gatewayId}/sessions/${encodeURIComponent(sessionKey)}`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("chat-scroll").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="chat-scroll"]');
        const cards = [...document.querySelectorAll('[data-testid="question-card"]')];
        const composer = document.querySelector('[data-testid="chat-composer-dock"]');
        const status = [...document.querySelectorAll("body *")].find((node) => node.childElementCount === 0 && node.textContent?.includes("Waiting for your answer"));
        return {
          title: document.title,
          cards: cards.map((card) => ({ state: card.getAttribute("data-state"), text: card.textContent?.slice(0, 120), top: Math.round(card.getBoundingClientRect().top), bottom: Math.round(card.getBoundingClientRect().bottom) })),
          waitingText: Boolean(status),
          composerDisabled: Boolean(composer?.querySelector("textarea:disabled,button:disabled")),
          list: list ? { top: Math.round(list.scrollTop), max: Math.round(list.scrollHeight - list.clientHeight), client: list.clientHeight, height: list.scrollHeight } : null,
          bodyTail: document.body.innerText.slice(-700),
        };
      });
      records.push({ sessionKey, viewport: `${width}x${height}`, ...state });
      await page.screenshot({ path: `${shots}/${name}-${width}x${height}.png` });
    }
  }
  await page.goto(`http://localhost:8098/editor/290d9b88-2e09-4f5a-bba7-29c5ab8175e7`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const editor = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(-1200), agentVisible: Boolean([...document.querySelectorAll('[data-testid="agent-panel"]')].find((node) => node.getBoundingClientRect().width > 0)), projectRoot: Boolean(document.querySelector('[data-testid="editor-bar"]')) }));
  await page.screenshot({ path: `${shots}/project-editor-1440x900.png` });
  console.log(JSON.stringify({ gatewayId: offer.gatewayId, sessions: records, editor }));
} finally { await browser.close(); }
