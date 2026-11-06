// Live check against a running server and the agent CLIs installed on this machine: an admin
// device reads the runtime snapshot, sees which CLIs are installed and signed in, and runs one real turn through each
// runtime that is ready. Nothing here is simulated; a CLI that is missing or signed out is reported as such.
// Usage: node server/scripts/live-runtimes.ts <offer-url> <server-log-file>
import { pairAdmin, settle, turn } from "./live-lib.ts";

const [offerUrl, logFile] = process.argv.slice(2);
const admin = await pairAdmin(offerUrl, logFile);
console.log("admin ready", admin.role);
await admin.call("jagentchill.runtime.subscribe", {});
const updates: string[] = [];
admin.on((event, payload) => event === "jagentchill.runtime.updated" && updates.push(payload.runtimeIds.join(",")));

const started = Date.now();
const cold = await admin.call("jagentchill.runtime.snapshot.get", {});
console.log(`snapshot.get (cold) answered in ${Date.now() - started} ms:`, cold.runtimes.map((r: any) => `${r.runtimeId}=${r.status}`).join(" "));
let runtimes: any[] = [];
for (let i = 0; i < 150; i++) {
  await settle(1000);
  runtimes = (await admin.call("jagentchill.runtime.snapshot.get", {})).runtimes;
  if (runtimes.every((r: any) => r.status !== "loading")) break;
}
// The host lists an ACP agent's models only after it asked the agent, which can take longer than one probe: "Retry".
for (let i = 0; i < 6; i++) {
  const waiting = runtimes.filter((r: any) => r.status === "error" && r.error?.step === "catalogue").map((r: any) => r.runtimeId);
  if (!waiting.length) break;
  console.log(`retry (${i + 1}) for ${waiting.join(", ")} after ${Math.round((Date.now() - started) / 1000)} s: ${runtimes.find((r: any) => r.runtimeId === waiting[0]).error.code}`);
  runtimes = (await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: waiting })).runtimes;
}
console.log(`runtime.updated events received: ${updates.length}`);
for (const r of runtimes) {
  console.log(`runtime ${r.runtimeId}: status=${r.status} enabled=${r.enabled}` + (r.binary ? ` binary=${r.binary.path.replace(process.env.HOME ?? "", "~")} version="${r.binary.version}"` : "")
    + (r.login ? ` login=${r.login.state}${r.login.account ? ` (${r.login.account})` : ""}` : "") + ` models=${r.models.length}` + (r.error ? ` error=${r.error.code}: ${r.error.message}` : ""));
}

const diagnostic = await admin.call("jagentchill.runtime.diagnose", { runtimeId: "claude-code" });
console.log("diagnose claude-code:", diagnostic.rows.filter((row: any) => ["Command", "Version", "Login", "Status"].includes(row.label)).map((row: any) => `${row.label}: ${row.value} [${row.level}]`).join(" | "));

// One real turn per ready CLI runtime. The model is the runtime's default from its own catalogue unless one is named.
const prefer: Record<string, string | undefined> = { "claude-code": process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5", codex: process.env.LIVE_CODEX_MODEL, "acp-opencode": process.env.LIVE_OPENCODE_MODEL ?? "opencode/big-pickle" };
let failed = 0;
for (const r of runtimes.filter((r: any) => r.kind === "cli" && r.enabled)) {
  if (r.status !== "ready") {
    console.log(`TURN ${r.runtimeId}: not run — ${r.error?.code ?? r.status}: ${r.error?.message ?? ""}`);
    continue;
  }
  const model = r.models.find((m: any) => m.modelId === prefer[r.runtimeId]) ?? r.models.find((m: any) => m.isDefault) ?? r.models[0];
  const ref = { runtimeId: r.runtimeId, providerId: model.providerId, modelId: model.modelId };
  const word = `${r.runtimeId.replace(/[^a-z]/g, "")}-ok`;
  try {
    if (r.requiresFullAccess) {
      const refused = await admin.refused("jagentchill.session.create", { ref });
      console.log(`  ${r.runtimeId} without the admin's confirmation → ${refused.code}`);
    }
    const created = await admin.call("jagentchill.session.create", { ref, title: `Live ${r.label}`, ...(r.requiresFullAccess ? { confirmFullAccess: true } : {}) });
    const session = created.session;
    const result = await turn(admin, session.sessionKey, `Reply with exactly this word and nothing else: ${word}`);
    await settle(1500);
    const usage = await admin.call("jagentchill.session.usage.list", { sessionKey: session.sessionKey });
    const ok = result.state === "final" && result.text.includes(word);
    if (!ok) failed += 1;
    console.log(`${ok ? "OK  " : "FAIL"} TURN ${r.runtimeId} model=${ref.modelId} unattended=${session.unattended} → ${result.state} "${result.text.slice(0, 80)}" usage=${JSON.stringify(usage.totals)} (${usage.reports})`);
  } catch (err: any) {
    failed += 1;
    console.log(`FAIL TURN ${r.runtimeId}: ${err.code ?? ""} ${err.message ?? err}`);
  }
}
console.log(failed ? "RUNTIMES FAILED" : "RUNTIMES OK");
admin.close();
process.exit(failed ? 1 : 0);
