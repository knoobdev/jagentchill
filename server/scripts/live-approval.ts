// Live check with a real model: an admin device starts a workspace session, the agent asks to run a host command, the
// device receives the approval request on the product channel and answers it. Run once with allow-once, once with deny.
// Usage: node server/scripts/live-approval.ts <offer-url> <server-log-file>
import { existsSync, readFileSync, rmSync } from "node:fs";
import { decodeOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../test/device-sim.ts";
// The server's address is `JAGENTCHILL_PORT` (live-lib.ts): no default reaches a person's own server on 18910.
import { BASE } from "./live-lib.ts";

const [offerUrl, logFile] = process.argv.slice(2);
const decoded = decodeOffer(offerUrl);
if (!decoded.ok) throw new Error(decoded.code);
const device = new DeviceSim(BASE, "Approval check");
const requestId = await device.enrolUntilProved(decoded.offer);
await new Promise((r) => setTimeout(r, 300));
const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`${device.deviceId.slice(0, 8)})`)).pop() ?? "")![1];
await device.verify(decoded.offer, requestId, code);
const conn = device.connect(decoded.offer);
await conn.outcome;

let ok = true;
for (const decision of ["allow-once", "deny"] as const) {
  const marker = `/tmp/jagentchill-live-approval-${decision}-${Date.now()}.txt`;
  const { sessionKey } = (await conn.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5" } })).result.session;
  await conn.call("jagentchill.chat.subscribe", { sessionKey });
  const asked: string[] = [];
  const finished = new Promise<void>((resolve) => {
    const onMessage = async (data: any) => {
      const frame = JSON.parse(data.toString());
      if (frame.t !== "evt") return;
      if (frame.event === "jagentchill.approval.requested" && frame.payload.sessionKey === sessionKey) {
        asked.push(frame.payload.detail);
        conn.ws.send(JSON.stringify({ t: "req", id: `a-${frame.payload.approvalId}`, method: "jagentchill.approval.resolve", params: { approvalId: frame.payload.approvalId, decision } }));
      }
      if (frame.event === "jagentchill.chat.stream" && frame.payload.sessionKey === sessionKey && ["final", "error", "aborted"].includes(frame.payload.state)) {
        conn.ws.off("message", onMessage);
        resolve();
      }
    };
    conn.ws.on("message", onMessage);
  });
  conn.ws.send(JSON.stringify({ t: "req", id: `s-${decision}`, method: "jagentchill.chat.send", params: { sessionKey, message: `Run exactly this shell command, once, with nothing appended: touch ${marker}` } }));
  await Promise.race([finished, new Promise((r) => setTimeout(r, 150_000))]);
  const created = existsSync(marker);
  const right = asked.length > 0 && created === (decision === "allow-once");
  ok &&= right;
  console.log(right ? "OK  " : "FAIL", decision, `approval requests shown to device: ${asked.length}`, `file created: ${created}`);
  rmSync(marker, { force: true });
}
console.log(ok ? "APPROVAL RELAY OK" : "APPROVAL RELAY FAILED");
conn.ws.close();
process.exit(ok ? 0 : 1);
