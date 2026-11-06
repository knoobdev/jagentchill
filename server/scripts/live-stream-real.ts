// ONE real turn on a signed-in runtime (owner decision 2026-10-07), to see how its text reaches a device: how many
// increments, how large, how spread in time. Sends exactly one short prompt, then deletes nothing (the session stays in
// the host's list). Usage: JAGENTCHILL_PORT=<port> node server/scripts/live-stream-real.ts <server-log> <runtimeId> [modelId-substring]
import { readFileSync } from "node:fs";
import { pairAdmin, settle } from "./live-lib.ts";

const [logFile, runtimeId = "claude-code", wanted = "haiku"] = process.argv.slice(2);
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile!, "utf8"))![0];
const rpc = await pairAdmin(offer, logFile!, "Stream probe");
let runtime: any;
for (let wait = 0; wait < 60; wait++) {
  runtime = (await rpc.call("jagentchill.runtime.snapshot.get", {})).runtimes.find((entry: any) => entry.runtimeId === runtimeId);
  if (runtime?.models?.length) break;
  await settle(1000);
}
if (!runtime?.models?.length) { console.log(`FAIL ${runtimeId} lists no model: ${JSON.stringify(runtime?.error ?? runtime?.readiness)}`); process.exit(1); }
console.log("models:", runtime.models.map((entry: any) => entry.modelId).join(", "));
const model = runtime.models.find((entry: any) => String(entry.modelId).includes(wanted)) ?? runtime.models.find((entry: any) => /haiku/.test(entry.modelId)) ?? runtime.models.find((entry: any) => /sonnet/.test(entry.modelId)) ?? runtime.models[0];
if (process.env.LIST_ONLY) { rpc.close(); process.exit(0); }
const ref = { runtimeId, providerId: model.providerId, modelId: model.modelId };
const { session } = await rpc.call("jagentchill.session.create", { ref });
await rpc.call("jagentchill.chat.subscribe", { sessionKey: session.sessionKey });
const deltas: Array<{ t: number; seq: number; chars: number; length: number; replace: boolean }> = [];
const tools: string[] = [];
let done: (state: string) => void = () => undefined, finalText = "";
const ended = new Promise<string>((resolve) => { done = resolve; });
const started = Date.now();
rpc.on((event: string, payload: any) => {
  if (payload?.sessionKey !== session.sessionKey) return;
  if (event === "jagentchill.chat.activity" && payload.stream === "tool" && payload.data?.phase === "start") tools.push(String(payload.data.name));
  if (event !== "jagentchill.chat.stream") return;
  if (payload.state === "delta") deltas.push({ t: Date.now() - started, seq: payload.seq, chars: String(payload.deltaText ?? "").length, length: payload.length, replace: payload.replace === true });
  else if (["final", "error", "aborted"].includes(payload.state)) { finalText = (payload.message?.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join(""); done(payload.state); }
});
await rpc.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "In about 120 words, explain what a J-cut is in video editing. No tools, plain text." });
const state = await Promise.race([ended, settle(180_000).then(() => "timeout")]);
const gaps = deltas.slice(1).map((delta, index) => delta.t - deltas[index]!.t);
console.log(JSON.stringify({
  runtime: runtimeId, model: model.modelId, state, turn_ms: Date.now() - started, finalChars: finalText.length,
  increments: deltas.length, firstAt_ms: deltas[0]?.t, lastAt_ms: deltas[deltas.length - 1]?.t,
  chars: { min: Math.min(...deltas.map((d) => d.chars)), max: Math.max(...deltas.map((d) => d.chars)), mean: deltas.length ? Math.round(deltas.reduce((sum, d) => sum + d.chars, 0) / deltas.length) : 0 },
  gap_ms: gaps.length ? { min: Math.min(...gaps), max: Math.max(...gaps), mean: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) } : null,
  replaced: deltas.filter((d) => d.replace).length, seqInOrder: deltas.every((d, index) => d.seq === index + 1), lengthConsistent: deltas.length ? deltas[deltas.length - 1]!.length : 0, tools,
}));
console.log("increments (ms:chars):", deltas.map((d) => `${d.t}:${d.chars}`).join(" ").slice(0, 900));
rpc.close();
process.exit(state === "final" ? 0 : 1);
