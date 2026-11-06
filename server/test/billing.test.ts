// The CLIs in these tests are TEST DOUBLES: empty executable files on a test PATH, and a table of what their status command "says" (`harness.ts`). No real CLI is run and no real sign-in is read.
// The classifier (`src/generation/billing.ts`), the runtime registry, the spend gate and — in the second test — the whole server's wiring of them (`app.ts`) are the real ones.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeBilling, signInOf, type StatusOutput } from "../src/generation/billing.ts";
import { BUILTIN_RUNTIMES, resolveRuntimes } from "../src/runtimes/registry.ts";
import { LOGIN_STALE_MS } from "../src/runtimes/service.ts";
import { createHarness, tick } from "./harness.ts";

const ok = (stdout: string): StatusOutput => ({ code: 0, stdout, stderr: "", timedOut: false });
const PLAN = ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "ada@example.com", subscriptionType: "max" }));
const CHATGPT = ok("Logged in using ChatGPT\n");

test("Review 16 #1 — the kind of a sign-in is read from what the CLI's own status command states, and only a plain personal subscription is one: Claude Code on a claude.ai plan, Codex on ChatGPT; an API key, a console account, a cloud provider, a status with no method, a failed or timed-out command, and any other CLI are not", () => {
  const claude = (status: Record<string, unknown>) => signInOf("claude-code", ok(JSON.stringify(status)));
  assert.equal(signInOf("claude-code", PLAN), "subscription");
  assert.equal(claude({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }), "subscription");
  assert.equal(claude({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }), "api_key");
  assert.equal(claude({ loggedIn: true, authMethod: "console", email: "ada@example.com" }), "api_key");
  assert.equal(claude({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock", subscriptionType: "max" }), "api_key");
  assert.equal(claude({ loggedIn: true, authMethod: "claude.ai", subscriptionType: null }), "unknown", "signed in at claude.ai with no plan stated: cannot be told");
  assert.equal(claude({ loggedIn: true, email: "ada@example.com" }), "unknown", "signed in, the method not stated: cannot be told");
  assert.equal(claude({ loggedIn: false }), "unknown");
  assert.equal(signInOf("claude-code", ok("Logged in")), "unknown");
  assert.equal(signInOf("codex", CHATGPT), "subscription");
  assert.equal(signInOf("codex", ok("Logged in using an API key - sk-***\n")), "api_key");
  assert.equal(signInOf("codex", ok("Logged in\n")), "unknown");
  assert.equal(signInOf("codex", { ...CHATGPT, code: 1 }), "unknown");
  assert.equal(signInOf("codex", { ...CHATGPT, timedOut: true }), "unknown");
  for (const target of ["gemini-cli", "copilot", "acp-opencode", "acp-qwen", "acp", "claude-cli"]) assert.equal(signInOf(target, CHATGPT), "unknown", target);
});

test("Review 16 #1 — every shipped runtime kind: billed per call unless it positively reports a personal subscription — Gemini CLI, Copilot, every ACP runtime and catalogue runtime, a profile that changes the launch, a CLI that is not installed, a CLI with a key in the environment it is started in, and 'cannot tell' are all per call; a sign-in that stops being a subscription is per call from the next reading on", async () => {
  // Every shipped runtime, the catalogue's ACP runtimes turned on, and four profiles an admin made.
  const runtimes = resolveRuntimes({
    offerEditorToolsToAcp: true, extraPath: [],
    entries: {
      ...Object.fromEntries(BUILTIN_RUNTIMES.filter((runtime) => runtime.source === "catalogue").map((runtime) => [runtime.id, { enabled: true }])),
      "claude-plain": { extends: "claude-code", label: "Claude (second)" }, "claude-keyed": { extends: "claude-code", env: { ANTHROPIC_API_KEY: { secret: "anthropic" } } },
      "codex-wrapped": { extends: "codex", command: ["/opt/codex-wrapper"] }, "my-acp": { extends: "acp", command: ["my-agent", "--acp"] },
    },
  } as unknown as Parameters<typeof resolveRuntimes>[0]);
  assert.ok(BUILTIN_RUNTIMES.every((shipped) => runtimes.some((runtime) => runtime.id === shipped.id)) && runtimes.some((runtime) => runtime.id === "acp-qwen" && runtime.enabled) && runtimes.some((runtime) => runtime.id === "my-acp"));
  const says = new Map<string, StatusOutput | undefined>([["claude-code", PLAN], ["claude-plain", PLAN], ["claude-keyed", PLAN], ["codex", CHATGPT], ["codex-wrapped", CHATGPT]]);
  // Whatever a CLI without such a statement "answers", it is not asked and not believed: the test double would say "subscription" for all of them.
  const asked: string[] = [], hostEnv: Record<string, string | undefined> = { PATH: "/bin" }, missing = new Set<string>();
  let clock = 1_000;
  const billing = createRuntimeBilling({
    runtime: (id) => runtimes.find((runtime) => runtime.id === id), launchEnv: (id) => (missing.has(id) ? undefined : { PATH: "/bin" }), hostEnv: () => hostEnv,
    status: async (id) => { asked.push(id); return says.has(id) ? says.get(id) : CHATGPT; }, now: () => clock, staleMs: LOGIN_STALE_MS,
  });
  // Never read: per call, also for the two that will turn out to be subscriptions.
  assert.deepEqual(runtimes.map((runtime) => billing.of(runtime.id)).filter((entry) => entry !== "per_call"), [], "nothing is the person's own account before its sign-in was read");
  await billing.warm(runtimes.map((runtime) => runtime.id));
  const own = runtimes.filter((runtime) => billing.of(runtime.id) === "own_account").map((runtime) => runtime.id).sort();
  assert.deepEqual(own, ["claude-code", "claude-plain", "codex"], "only a native Claude Code / Codex that reports a subscription");
  assert.deepEqual([...new Set(asked)].sort(), ["claude-code", "claude-plain", "codex"], "no other CLI's status is taken for a statement of its kind");
  assert.deepEqual(["builtin", "gemini-cli", "copilot", "acp-opencode", "acp-copilot", "acp-qwen", "claude-keyed", "codex-wrapped", "my-acp", "no-such-runtime"].map((id) => [id, billing.of(id), billing.why(id)]), [
    ["builtin", "per_call", "runtime_unknown"], ["gemini-cli", "per_call", "kind_of_sign_in_not_reported"], ["copilot", "per_call", "kind_of_sign_in_not_reported"], ["acp-opencode", "per_call", "kind_of_sign_in_not_reported"],
    ["acp-copilot", "per_call", "kind_of_sign_in_not_reported"], ["acp-qwen", "per_call", "kind_of_sign_in_not_reported"], ["claude-keyed", "per_call", "launch_changed"], ["codex-wrapped", "per_call", "launch_changed"],
    ["my-acp", "per_call", "launch_changed"], ["no-such-runtime", "per_call", "runtime_unknown"],
  ]);
  // "Cannot tell": the status command cannot be run, fails, times out, or states no method.
  for (const [said, why] of [[undefined, "cannot_tell"], [{ ...PLAN, code: 1 }, "cannot_tell"], [{ ...PLAN, timedOut: true }, "cannot_tell"], [ok(JSON.stringify({ loggedIn: true, email: "ada@example.com" })), "cannot_tell"], [ok(JSON.stringify({ loggedIn: true, authMethod: "api_key" })), "api_key_sign_in"]] as const) {
    says.set("claude-code", said); clock += LOGIN_STALE_MS + 1;
    assert.deepEqual([await billing.verify("claude-code"), billing.of("claude-code"), billing.why("claude-code")], ["per_call", "per_call", why]);
  }
  says.set("claude-code", PLAN); clock += LOGIN_STALE_MS + 1;
  assert.equal(await billing.verify("claude-code"), "own_account");
  // A key in the environment the CLI is started in decides at once, whatever the status said a moment ago (only the variable's NAME is read).
  hostEnv.ANTHROPIC_API_KEY = "x";
  assert.deepEqual([billing.of("claude-code"), await billing.verify("claude-code"), billing.why("claude-code"), billing.of("codex")], ["per_call", "per_call", "key_in_environment", "own_account"]);
  delete hostEnv.ANTHROPIC_API_KEY; hostEnv.OPENAI_API_KEY = "x";
  assert.deepEqual([await billing.verify("codex"), billing.why("codex")], ["per_call", "key_in_environment"]);
  delete hostEnv.OPENAI_API_KEY;
  // Not installed: nothing can be read.
  missing.add("codex");
  assert.deepEqual([await billing.verify("codex"), billing.why("codex")], ["per_call", "not_installed"]);
  missing.delete("codex");
  // Codex goes from ChatGPT to an API key: the quote keeps what was last read until the reading is old; the DISPATCH after that reads again.
  assert.equal(await billing.verify("codex"), "own_account");
  says.set("codex", ok("Logged in using an API key - sk-***\n")); clock += LOGIN_STALE_MS + 1;
  assert.equal(await billing.verify("codex"), "per_call");
  assert.equal(billing.of("codex"), "per_call");
});

test("Review 16 #1 — through the real server: a model on Gemini CLI, on Copilot and on OpenCode is billed per call — the gate holds its turn like any paid request; Claude Code and Codex are the person's own account only while their status command reports a subscription, and a turn dispatched after Codex was switched to an API key is held", async () => {
  let clock = Date.now();
  const h = await createHarness({ installed: ["claude", "codex", "gemini", "copilot", "opencode"], now: () => clock });
  try {
    await h.settled();
    const gate = h.app.generation.gate, of = (runtimeId: string, providerId: string) => gate.billingOf({ ref: { runtimeId, providerId, modelId: "m" } });
    h.results.set("opencode auth list", h.ok("2 credentials\n"));
    for (let i = 0; i < 50 && of("codex", "openai") !== "own_account"; i++) await tick();
    for (let i = 0; i < 50 && of("claude-code", "anthropic") !== "own_account"; i++) await tick();
    assert.deepEqual([of("gemini-cli", "google"), of("copilot", "github-copilot"), of("acp-opencode", "opencode"), of("claude-code", "anthropic"), of("codex", "openai")], ["per_call", "per_call", "per_call", "own_account", "own_account"]);
    // The turn of each: sent as it is on the person's own account; a request of the gate (refused here: no action approved it) on a key.
    let sent = 0;
    const turn = async () => { sent++; return { text: "ok" }; }, guarded = gate.guardTurn(turn);
    const through = async (runtimeId: string, providerId: string): Promise<boolean> => { const ref = { runtimeId, providerId, modelId: "m" }, before = sent; await guarded("no-action", ref, "dev", { ref }).catch(() => undefined); return sent > before; };
    assert.deepEqual([await through("codex", "openai"), await through("claude-code", "anthropic"), await through("gemini-cli", "google"), await through("copilot", "github-copilot"), await through("acp-opencode", "opencode")], [true, true, false, false, false]);
    // Codex is switched to an API key, and Claude Code now says it is signed in without saying how; what was read is old by the next dispatch: it is read again and the turns are held.
    h.results.set("codex login status", h.ok("Logged in using an API key - sk-***\n"));
    h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com" })));
    clock += LOGIN_STALE_MS + 1;
    assert.deepEqual([await through("codex", "openai"), await through("claude-code", "anthropic")], [false, false], "a turn on an API key, or on a sign-in that cannot be told, is not sent unasked");
    assert.deepEqual([of("codex", "openai"), of("claude-code", "anthropic")], ["per_call", "per_call"]);
  } finally {
    h.close();
  }
});
