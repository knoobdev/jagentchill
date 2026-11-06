// Live check of provider sign-in against a running server and the REAL vendor CLIs installed on
// this machine. Nothing is simulated. Three modes:
//   relay      — the server must have been started with an EMPTY Claude Code / Codex home (CLAUDE_CONFIG_DIR, CODEX_HOME
//                pointing at fresh directories), so the real sign-ins of this machine are not touched. Each CLI's login is
//                started through the product channel up to the point where it shows its address / code and waits; the
//                script prints what the device received and cancels. (The app's own OAuth sign-ins — OpenRouter,
//                ChatGPT — went with the Built-in runtime: only the CLIs sign in now.)
//                No request to a provider is made by this mode except what the vendor CLIs do themselves.
//   signed-in  — the server runs with the machine's real homes: the script shows that both CLIs are listed as signed in
//                with their account, and runs one tiny real turn on each CLI runtime.
//   complete <providerId> <choiceId> — for the person at the keyboard: starts one sign-in, prints the full address to
//                open, reads a pasted code from standard input when the flow asks for one, and waits for the end.
// Usage: node server/scripts/live-sign-in.ts <offer-url> <server-log-file> relay|signed-in|complete [providerId choiceId]
import { createInterface } from "node:readline/promises";
import { pairAdmin, putSecret, settle, turn } from "./live-lib.ts";

const [offerUrl, logFile, mode, providerArg, choiceArg] = process.argv.slice(2);
let failed = 0;
const check = (ok: boolean, text: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${text}`);
};
/** Addresses are printed without the values that belong to one attempt. */
const tidy = (text: string) => text.replace(/(code_challenge|state|nonce|ext_agent_host_id)=[^&\s"]+/g, "$1=<…>").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]+/g, "<email>");

const admin = await pairAdmin(offerUrl, logFile);
await admin.call("jagentchill.runtime.subscribe", {});
const updates: Array<{ loginId: string; kind: string }> = [];
admin.on((event, payload) => event === "jagentchill.provider.auth.login.updated" && updates.push({ loginId: payload.loginId, kind: payload.step.kind }));
const provider = async (id: string) => (await admin.call("jagentchill.provider.auth.list", { query: id })).providers.find((p: any) => p.providerId === id);
const describe = (p: any) => p.choices.map((c: any) => `${c.choiceId} [${c.method ?? "-"}/${c.kind}${c.appDriven ? ", from the app" : ""}${c.identity ? `, as ${c.identity}` : ""}${c.signedIn !== undefined ? `, signedIn=${c.signedIn}${c.account ? ` ${c.account}` : ""}` : ""}${c.available ? "" : `, unavailable: ${c.unavailableReason}`}]`).join("  ");

// The CLI runtimes are probed on the first snapshot read; wait until their sign-in state is known.
for (let i = 0; i < 90; i++) {
  const runtimes = (await admin.call("jagentchill.runtime.snapshot.get", {})).runtimes.filter((r: any) => ["claude-code", "codex"].includes(r.runtimeId));
  if (runtimes.every((r: any) => r.login && r.status !== "loading")) break;
  await settle(1000);
}
for (const id of ["anthropic", "openai"]) {
  const listed = await provider(id);
  console.log(`choices of ${id}: ${tidy(describe(listed))}`);
  if (listed.signInNote) console.log(`  note: ${listed.signInNote}`);
}

async function begin(providerId: string, choiceId: string, extra: object = {}) {
  const started = await admin.call("jagentchill.provider.auth.login.start", { providerId, choiceId, ...extra });
  return started as { loginId: string; step: any };
}
const cancel = async (loginId: string) => (await admin.call("jagentchill.provider.auth.login.cancel", { loginId })).step;

if (mode === "relay") {
  const claudeBefore = (await provider("anthropic")).choices.find((c: any) => c.choiceId === "claude-code");
  check(claudeBefore.signedIn === false, `isolated home: Claude Code is listed signed out (signedIn=${claudeBefore.signedIn})`);
  // Claude Code.
  const claude = await begin("anthropic", "claude-code");
  check(claude.step.kind === "open-url" && claude.step.returns === "paste-code" && /^https:\/\/claude\.(com|ai)\//.test(claude.step.url), `claude-code login.start → ${claude.step.kind} returns=${claude.step.returns}`);
  console.log(`  address relayed to the device: ${tidy(claude.step.url)}`);
  console.log(`  instructions: ${claude.step.instructions}`);
  const ask = (await admin.call("jagentchill.provider.auth.login.next", { loginId: claude.loginId })).step;
  check(ask.kind === "enter-text" && ask.secretName === `LOGIN_${claude.loginId}`, `login.next → ${ask.kind} "${ask.prompt}" (answer goes to the secret route as ${ask.secretName.slice(0, 10)}…)`);
  // A malformed code is what the CLI itself rejects without calling Anthropic's token service.
  await putSecret(admin, ask.secretName, "not-a-code");
  const retry = (await admin.call("jagentchill.provider.auth.login.next", { loginId: claude.loginId })).step;
  check(retry.kind === "enter-text" && !!retry.retryReason, `a malformed code typed into the real CLI → ${retry.kind} retryReason="${retry.retryReason}"`);
  const ended = await cancel(claude.loginId);
  check(ended.code === "CANCELLED", `login.cancel → ${ended.kind} ${ended.code}`);
  // Codex, one-time code.
  const codex = await begin("openai", "codex-cli");
  check(codex.step.kind === "device-code" && /^https:\/\/auth\.openai\.com\//.test(codex.step.verificationUrl) && /^[A-Z0-9]+-[A-Z0-9]+$/.test(codex.step.userCode), `codex-cli login.start → ${codex.step.kind} at ${codex.step.verificationUrl} code ${String(codex.step.userCode).replace(/[A-Z0-9]/g, "•")} (${Math.round((codex.step.expires_ms - Date.now()) / 60000)} min)`);
  check((await cancel(codex.loginId)).code === "CANCELLED", "codex-cli login.cancel → CANCELLED");
  await settle(2500);
  console.log(`login.updated events received by the device: ${updates.map((u) => u.kind).join(", ")}`);
  check(!admin.received.some((frame) => /"(access_token|refresh_token|accessToken|refreshToken)"/.test(frame)), `no token field in ${admin.received.length} frames`);
} else if (mode === "signed-in") {
  const claude = (await provider("anthropic")).choices.find((c: any) => c.choiceId === "claude-code");
  const codex = (await provider("openai")).choices.find((c: any) => c.choiceId === "codex-cli");
  check(claude.signedIn === true, `Claude Code on this host: signedIn=${claude.signedIn} account=${tidy(String(claude.account))}`);
  check(codex.signedIn === true, `Codex CLI on this host: signedIn=${codex.signedIn} account=${tidy(String(codex.account))}`);
  for (const id of ["anthropic", "openai"]) console.log(`profiles of ${id}: ${tidy(JSON.stringify((await provider(id)).profiles.map((p: any) => [p.profileId, p.type, p.account, p.health])))}`);
  let runtimes: any[] = [];
  for (let i = 0; i < 120; i++) {
    runtimes = (await admin.call("jagentchill.runtime.snapshot.get", {})).runtimes.filter((r: any) => ["claude-code", "codex"].includes(r.runtimeId));
    if (runtimes.every((r: any) => r.status === "ready")) break;
    if (i % 10 === 9) await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: runtimes.filter((r: any) => r.status !== "ready").map((r: any) => r.runtimeId) }).catch(() => undefined);
    await settle(1000);
  }
  const prefer: Record<string, string | undefined> = { "claude-code": process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5", codex: process.env.LIVE_CODEX_MODEL };
  for (const r of runtimes) {
    if (r.status !== "ready") { check(false, `${r.runtimeId} not ready: ${r.error?.code} ${r.error?.message}`); continue; }
    const model = r.models.find((m: any) => m.modelId === prefer[r.runtimeId]) ?? r.models.find((m: any) => m.isDefault) ?? r.models[0];
    const word = `${r.runtimeId.replace(/[^a-z]/g, "")}-signedin`;
    const session = (await admin.call("jagentchill.session.create", { ref: { runtimeId: r.runtimeId, providerId: model.providerId, modelId: model.modelId }, title: "Sign-in check" })).session;
    const result = await turn(admin, session.sessionKey, `Reply with exactly this word and nothing else: ${word}`);
    check(result.state === "final" && result.text.includes(word), `real turn on ${r.runtimeId} (${model.modelId}) with the CLI's own sign-in → ${result.state} "${result.text.slice(0, 60)}"`);
  }
} else if (mode === "complete") {
  const started = await begin(providerArg, choiceArg);
  let step = started.step;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    if (step.kind === "open-url") console.log(`\nOpen this address in your browser:\n${step.url}\n\n${step.instructions}\n`);
    else if (step.kind === "device-code") console.log(`\nOpen ${step.verificationUrl} and enter the code ${step.userCode}\n${step.instructions}\n`);
    else if (step.kind === "enter-text") {
      if (step.retryReason) console.log(step.retryReason);
      const text = (await input.question(`${step.prompt} (leave empty to keep waiting): `)).trim();
      if (text) await putSecret(admin, step.secretName, text);
      else { await settle(3000); step = (await admin.call("jagentchill.provider.auth.login.status", { loginId: started.loginId })).step; if (step.kind === "enter-text") continue; else continue; }
    } else if (step.kind === "progress") console.log(step.message);
    else break;
    step = (await admin.call("jagentchill.provider.auth.login.next", { loginId: started.loginId })).step;
  }
  input.close();
  check(step.kind === "done", `sign-in ended: ${tidy(JSON.stringify(step))}`);
  console.log(`profiles: ${tidy(JSON.stringify((await provider(providerArg)).profiles))}`);
} else {
  throw new Error("mode must be relay, signed-in or complete");
}
console.log(failed ? `SIGN-IN FAILED (${failed})` : "SIGN-IN OK");
admin.close();
process.exit(failed ? 1 : 0);
