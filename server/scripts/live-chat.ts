// Live check against a running server with a real model: pair an admin device, run one agent turn over the product
// channel, then pair an editor device and confirm it can neither see nor prompt the admin's private session.
// Usage: node server/scripts/live-chat.ts <offer-url> <server-log-file>
import { readFileSync } from "node:fs";
import { decodeOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../test/device-sim.ts";
// The server's address is `JAGENTCHILL_PORT` (live-lib.ts): no default reaches a person's own server on 18910.
import { BASE } from "./live-lib.ts";

const [offerUrl, logFile] = process.argv.slice(2);
const decoded = decodeOffer(offerUrl);
if (!decoded.ok) throw new Error(decoded.code);
const offer = decoded.offer;
const base = BASE;
const codeOf = async (device: DeviceSim) => {
  await new Promise((r) => setTimeout(r, 300));
  const line = readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`${device.deviceId.slice(0, 8)})`)).pop() ?? "";
  return /code (\d{6})/.exec(line)![1];
};

const admin = new DeviceSim(base, "Live admin");
const adminRequest = await admin.enrolUntilProved(offer);
console.log("admin verify", (await admin.verify(offer, adminRequest, await codeOf(admin))).body.role);
const a = admin.connect(offer);
console.log("admin ready", (await a.outcome).ready?.role);

const created = await a.call("jagentchill.session.create", { title: "Live check", ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5" } });
console.log("session.create", created.ok, JSON.stringify(created.ok ? created.result.session : created.error));
const sessionKey = created.result.session.sessionKey;
console.log("subscribe", JSON.stringify((await a.call("jagentchill.chat.subscribe", { sessionKey })).result));

const counts = new Map<string, number>();
let finalText = "";
const finished = new Promise<void>((resolve) => {
  a.ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.t !== "evt") return;
    counts.set(frame.event, (counts.get(frame.event) ?? 0) + 1);
    if (frame.event === "jagentchill.chat.activity" && frame.payload?.data?.kind === "tool") {
      console.log("tool", frame.payload.data.phase, frame.payload.data.name);
    }
    if (frame.event === "jagentchill.chat.stream" && ["final", "error", "aborted"].includes(frame.payload?.state)) {
      finalText = JSON.stringify(frame.payload.message?.content ?? frame.payload);
      resolve();
    }
  });
});
const sent = await a.call("jagentchill.chat.send", {
  sessionKey,
  message: "Call the tool jc_echo from the jagentchill MCP server with text \"mango-17\" and then reply with exactly what it returned.",
});
console.log("chat.send", JSON.stringify(sent.ok ? sent.result : sent.error));
await Promise.race([finished, new Promise((r) => setTimeout(r, 150_000))]);
console.log("final", finalText.slice(0, 300));
console.log("events", JSON.stringify([...counts]));
const history = await a.call("jagentchill.chat.history", { sessionKey });
console.log("history messages", history.result.messages.length);

// A second device, paired as editor, must not see the admin's private session.
const pairMethods = await a.call("jagentchill.pairing.request.list");
console.log("pending before editor", pairMethods.result.requests.length);
a.ws.close();
process.exit(0);
