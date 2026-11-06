// W11 repeatable scroll measurement against an already seeded isolated host/session.
// Usage: JAGENTCHILL_PORT=<host> VF_RUN=<run-dir> E2E_BASE=<web> node apps/app/e2e/w11-chat-scroll-measure.mjs <server-log> <session-key> <shots-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, sessionKey, shots = ".dev/shots/w11-chat-scroll"] = process.argv.slice(2);
if (!logFile || !sessionKey) throw new Error("usage: w11-chat-scroll-measure.mjs <server-log> <session-key> <shots-dir>");
const base = process.env.E2E_BASE ?? "http://localhost:8097";
mkdirSync(shots, { recursive: true });
const { freshOffer } = await import("../../../.dev/orc/vf-chat/fresh-offer.mjs");
const setup = await pairAdmin(await freshOffer(logFile), logFile, `W11 measurement ${Date.now() % 100000}`);
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const numbers = {};
const report = (key, value) => { numbers[key] = value; console.log(`numbers ${key}: ${JSON.stringify(value)}`); };
try {
  await (await import("./lib/long-measure.mjs")).measureLong({
    browser, setup, codes, gatewayId: setup.offer.gatewayId, sessionKey,
    LAST: "The last answer of this chat, number 401.", shots, report,
  }, "w11", base);
  writeFileSync(`${shots}/numbers.json`, JSON.stringify(numbers, null, 2));
} finally {
  await browser.close();
  setup.close();
}
