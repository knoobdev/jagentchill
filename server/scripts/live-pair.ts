// Live check against a running server: pair one device with the offer + code printed by the server, then call an RPC.
import { decodeOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../test/device-sim.ts";
// The server's address is `JAGENTCHILL_PORT` (live-lib.ts): no default reaches a person's own server on 18910.
import { BASE } from "./live-lib.ts";
const [offerUrl, codeFile] = process.argv.slice(2);
const decoded = decodeOffer(offerUrl);
if (!decoded.ok) throw new Error(decoded.code);
const base = BASE;
const device = new DeviceSim(base, "Live check laptop");
const requestId = await device.enrolUntilProved(decoded.offer);
await new Promise((r) => setTimeout(r, 300));
const { readFileSync } = await import("node:fs");
const code = /code (\d{6})/.exec(readFileSync(codeFile, "utf8").split("\n").filter((l) => l.includes(device.deviceId.slice(0, 8))).pop() ?? "")?.[1];
const verified = await device.verify(decoded.offer, requestId, code!);
console.log("verify", verified.status, verified.body.role);
const { ws, outcome, call } = device.connect(decoded.offer);
const { ready, close } = await outcome;
console.log("ready", ready?.role, ready?.transport, ready?.scopes.length, close ?? "");
console.log("device.list", JSON.stringify((await call("jagentchill.device.list")).result.devices.map((d: any) => [d.name, d.role])));
ws.close();
