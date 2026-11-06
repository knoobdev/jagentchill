// Spike S23, live: two agent sessions call jc_session_whoami at the same time, twice each. Each must be told its own key.
// Usage: node server/scripts/live-binding.ts <offer-url> <server-log-file>
import { readFileSync } from "node:fs";
import { decodeOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../test/device-sim.ts";
// The server's address is `JAGENTCHILL_PORT` (live-lib.ts): no default reaches a person's own server on 18910.
import { BASE } from "./live-lib.ts";

const [offerUrl, logFile] = process.argv.slice(2);
const decoded = decodeOffer(offerUrl);
if (!decoded.ok) throw new Error(decoded.code);
const device = new DeviceSim(BASE, "Binding check");
const requestId = await device.enrolUntilProved(decoded.offer);
await new Promise((r) => setTimeout(r, 300));
const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`${device.deviceId.slice(0, 8)})`)).pop() ?? "")![1];
await device.verify(decoded.offer, requestId, code);
const conn = device.connect(decoded.offer);
await conn.outcome;

const finals = new Map<string, string[]>();
const waiters = new Map<string, () => void>();
conn.ws.on("message", (data) => {
  const frame = JSON.parse(data.toString());
  if (frame.t === "evt" && frame.event === "jagentchill.chat.stream" && frame.payload?.state === "final") {
    const key = frame.payload.sessionKey;
    finals.set(key, [...(finals.get(key) ?? []), JSON.stringify(frame.payload.message?.content?.map((c: any) => c.text).join(""))]);
    waiters.get(key)?.();
  }
});
const keys: string[] = [];
for (let i = 0; i < 2; i++) {
  const created = await conn.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5" } });
  if (!created.ok) throw new Error(`session.create: ${created.error.code} ${created.error.message}`);
  const { sessionKey } = created.result.session;
  await conn.call("jagentchill.chat.subscribe", { sessionKey });
  keys.push(sessionKey);
}
const ask = "Call the tool jc_session_whoami from the jagentchill MCP server (if it returns an error, call it again) and reply with exactly the text it returned, nothing else.";
for (let round = 1; round <= 2; round++) {
  const done = keys.map((key) => new Promise<void>((resolve) => waiters.set(key, resolve)));
  await Promise.all(keys.map((sessionKey) => conn.call("jagentchill.chat.send", { sessionKey, message: ask })));
  await Promise.race([Promise.all(done), new Promise((r) => setTimeout(r, 150_000))]);
}
let ok = true;
for (const key of keys) {
  const answers = finals.get(key) ?? [];
  const right = answers.length === 2 && answers.every((answer) => answer === JSON.stringify(key));
  ok &&= right;
  console.log(right ? "OK  " : "FAIL", key, answers.join(" | "));
}
console.log(ok ? "BINDING OK" : "BINDING FAILED");
conn.ws.close();
process.exit(ok ? 0 : 1);
