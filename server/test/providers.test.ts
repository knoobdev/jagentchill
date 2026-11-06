// The runtime clients in this file are FAKES of the runtime layer, the vendor CLIs are SCRIPTED (a status-command table
// and a scripted sign-in process, see harness.ts), and the "endpoints" are small HTTP servers started by the tests:
// these tests cover the server's own rules for provider sign-in, the secret route and custom endpoints. Real CLIs run in
// scripts/live-sign-in.ts.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { LOGIN_ID_PATTERN } from "@jagentchill/protocol";
import { PROVIDER_DATA, SHIPPED_PRESETS, providerGroupOf } from "../src/providers/catalogue.ts";
import type { SpawnLogin } from "../src/providers/cli-login.ts";
import { classifyAddress, parseModelList } from "../src/providers/endpoint-client.ts";
import { createHarness, tick, type Harness } from "./harness.ts";

const KEY = "sk-test-0123456789abcdefghij-LAST";
let h: Harness;
let clock = 0;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;
let relay: Server;
let relayUrl: string;
let relayModels = Array.from({ length: 120 }, (_, i) => ({ id: `model-${String(i).padStart(3, "0")}`, context_length: 32_000 }));
let relayMode: "ok" | "no-list" | "anthropic" = "ok";
const relayRequests: Array<{ method: string; url: string; authorization?: string; apiKey?: string }> = [];

/** The vendor CLIs' sign-in processes: Codex prints its device code (as Codex 0.160.0 does), Claude Code its address. */
type Proc = { file: string; args: string[]; killed: boolean; exit(code: number): void };
const procs: Proc[] = [];
const CODEX_DEVICE_OUT = "Follow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   https://auth.openai.com/codex/device\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-1234\n\n";
const CLAUDE_OUT = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=S1\nPaste code here if prompted > ";
const spawnLogin: SpawnLogin = (file, args) => {
  let listener: (text: string) => void = () => undefined;
  let end!: (result: { code: number | null }) => void;
  const proc: Proc = { file, args, killed: false, exit: (code) => end({ code }) };
  procs.push(proc);
  setTimeout(() => listener(file.endsWith("claude") ? CLAUDE_OUT : CODEX_DEVICE_OUT), 5);
  return { onOutput: (l) => void (listener = l), write: () => undefined, kill: () => { proc.killed = true; end({ code: null }); }, exited: new Promise((resolve) => (end = resolve)) };
};

before(async () => {
  h = await createHarness({ now: () => Date.now() + clock, spawnLogin });
  await h.settled();
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  relay = createServer((req, res) => {
    relayRequests.push({ method: req.method!, url: req.url!, authorization: req.headers.authorization, apiKey: req.headers["x-api-key"] as string | undefined });
    if (req.url!.startsWith("/v1/models")) {
      if (relayMode === "no-list") return void res.writeHead(404).end("{}");
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: relayModels }));
    }
    if (req.url!.startsWith("/v1/chat/completions")) {
      if (relayMode === "anthropic") return void res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "nope" } }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"o"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"k"}}]}\n\n');
      return void res.end('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n');
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}/v1`;
});
after(() => {
  relay.close();
  relay.closeAllConnections();
  h.close();
});

const provider = async (id: string, device = admin) => (await device.call("jagentchill.provider.auth.list", { query: id })).providers.find((candidate: any) => candidate.providerId === id);
const draft = (over: object = {}) => ({ id: "relay", label: "Team relay", baseUrl: relayUrl, dialect: "openai-completions", auth: { mode: "bearer", secretName: "RELAY_KEY" }, allowPrivateNetwork: true, models: [], capabilities: ["llm"], ...over });

test("Counts match the generated catalogue; the list holds the providers a CLI signs in to or runs on with a key; Anthropic choices; Region variants stay distinct; Groups", async () => {
  // The generated catalogue: 95 choices in 57 groups from 60 manifests.
  assert.deepEqual(PROVIDER_DATA.counts, { manifests: 60, choices: 95, groups: 57 });
  assert.equal(PROVIDER_DATA.providers.length, 62);
  // The list: the providers whose vendor CLI signs in from the app, and those whose key a CLI runs on (no endpoint exists yet).
  const all = (await editor.call("jagentchill.provider.auth.list", {})).providers;
  assert.deepEqual(all.map((candidate: any) => candidate.providerId).sort(), ["anthropic", "cerebras", "deepinfra", "deepseek", "fireworks", "google", "groq", "mistral", "openai", "openrouter", "together", "xai"]);
  // Anthropic choices: Claude Code on the host, then an API key (Claude Code and OpenCode run on it); no replaced choices, no custom address.
  const anthropic = await provider("anthropic");
  assert.deepEqual(anthropic.choices.map((choice: any) => [choice.choiceId, choice.kind, choice.method]), [["claude-code", "cli-login", "cli"], ["apiKey", "api-key", "api-key"]]);
  assert.equal(anthropic.choices[1].hint, "Used by Claude Code, OpenCode when a CLI is set to run on it.");
  assert.deepEqual([anthropic.replacedChoices, anthropic.overrideActive, anthropic.keyInfo, anthropic.description, anthropic.group], [undefined, false, undefined, "Claude Code on this host", "first-party"]);
  assert.match(anthropic.signInNote, /no sign-in for other apps/);
  // OpenRouter: its own sign-in under this app's identity, then a key.
  assert.deepEqual((await provider("openrouter")).choices.map((choice: any) => [choice.choiceId, choice.method]), [["openrouter-oauth", "oauth"], ["openrouter-api-key", "api-key"]]);
  assert.doesNotMatch(JSON.stringify(all), /gateway/i);
  // Region variants stay distinct in the catalogue: each manifest choice keeps its own id.
  assert.deepEqual(PROVIDER_DATA.providers.find((entry) => entry.providerId === "moonshot")!.choices.filter((choice) => choice.kind === "api-key").map((choice) => choice.choiceId), ["kimi-code-api-key", "moonshot-api-key", "moonshot-api-key-cn"]);
  // Groups of the catalogue: the aggregators and routers, and the local servers.
  const grouped = (group: string) => PROVIDER_DATA.providers.filter((entry) => providerGroupOf(entry) === group).map((entry) => entry.providerId).sort();
  // `opencode` covers OpenCode and OpenCode Go, `ai-gateway` is Vercel AI Gateway.
  assert.deepEqual(grouped("aggregators"), ["ai-gateway", "clawrouter", "cloudflare-ai-gateway", "deepinfra", "kilocode", "litellm", "opencode", "openrouter"]);
  assert.deepEqual(grouped("local"), ["apple-fm", "llama-cpp", "lmstudio", "ollama", "sglang", "vllm"]);
  // A search across label, id and group.
  assert.deepEqual((await editor.call("jagentchill.provider.auth.list", { query: "open" })).providers.map((candidate: any) => candidate.providerId), ["openai", "openrouter"]);
  assert.ok(["anthropic", "openai"].every((id) => (all as any[]).filter((candidate) => candidate.group === "first-party").some((candidate) => candidate.providerId === id)));
  assert.deepEqual((await editor.call("jagentchill.provider.auth.list", { query: "router" })).providers.map((candidate: any) => candidate.providerId), ["openrouter"]);
});

test("An API key the provider cannot be asked about is not stored unless saved anyway; a provider no CLI runs on is refused; No pass-through", async () => {
  // The signed secret route still stores a value (endpoints name secrets), owner-only on disk.
  const put = await admin.putSecret("OPENAI_API_KEY", `  ${KEY}\n`);
  assert.deepEqual([put.status, put.body], [200, { name: "OPENAI_API_KEY", hint: "••••LAST" }]);
  assert.equal(statSync(join(h.dataDir, "secrets/host-secrets.json")).mode & 0o777, 0o600);
  const commands = h.commands.length;
  // This host reaches no provider (every outbound request fails here): the key is not taken, and may be saved anyway.
  const unreachable = await admin.fail("jagentchill.provider.auth.setApiKey", { providerId: "openai", secretName: "OPENAI_API_KEY", profileLabel: "Team key" });
  assert.deepEqual([unreachable.code, unreachable.message, unreachable.details.canSaveAnyway], ["UNAVAILABLE", "Unable to reach the provider", true]);
  assert.deepEqual((await provider("openai")).profiles.map((profile: any) => profile.type), ["cli-login"]);
  const saved = await admin.call("jagentchill.provider.auth.setApiKey", { providerId: "openai", secretName: "OPENAI_API_KEY", profileLabel: "Team key", saveAnyway: true });
  assert.deepEqual([saved.profile.profileId, saved.profile.health, saved.profile.keyHint], ["openai:api-key", "unknown", "LAST"]);
  assert.deepEqual((await provider("openai")).profiles.map((profile: any) => [profile.type, profile.label]), [["cli-login", "Codex CLI on this host"], ["api-key", "Team key"]]);
  assert.deepEqual(h.audit("provider.auth.connect").map((entry: any) => entry.outcome), ["unreachable", "unknown"]);
  // A provider no CLI runs on takes no key; an API-key choice started as a sign-in is refused with the product's words.
  assert.equal((await admin.fail("jagentchill.provider.auth.setApiKey", { providerId: "cohere", secretName: "OPENAI_API_KEY" })).code, "UNSUPPORTED_FEATURE");
  const asLogin = await admin.fail("jagentchill.provider.auth.login.start", { providerId: "anthropic", choiceId: "apiKey" });
  assert.deepEqual([asLogin.code, asLogin.details.reason], ["UNSUPPORTED_FEATURE", "product-sign-in"]);
  // The key is removed again (its secret goes with it); the Codex CLI's own sign-in is untouched.
  assert.deepEqual((await admin.call("jagentchill.provider.auth.logout", { providerId: "openai", profileIds: ["openai:api-key"] })).removedProfileIds, ["openai:api-key"]);
  assert.deepEqual((await provider("openai")).profiles.map((profile: any) => profile.type), ["cli-login"]);
  await admin.putSecret("OPENAI_API_KEY", `  ${KEY}\n`);
  assert.equal(h.commands.length, commands, "nothing was run for a key");
  // No pass-through: an extra field fails validation and nothing is run.
  const calls = h.fake.calls.length;
  assert.equal((await admin.fail("jagentchill.provider.auth.logout", { providerId: "openai", profileIds: ["codex:cli"], method: "config.set" })).code, "INVALID_PARAMS");
  assert.deepEqual([h.fake.calls.length, h.commands.length], [calls, commands]);
});

test("The secret route is for admin devices; names are checked; a secret an endpoint uses is not deleted; Snapshot contains no secret", async () => {
  await admin.putSecret("OPENAI_SECOND", "sk-second-0000000000000000");
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "uses-key", auth: { mode: "bearer", secretName: "OPENAI_SECOND" } }) });
  const refused = await editor.putSecret("EDITOR_KEY", "sk-editor-0000000000000000");
  assert.deepEqual([refused.status, refused.body.error.code], [403, "SCOPE_DENIED"]);
  assert.equal((await admin.putSecret("lower-case", "value-000000")).status, 400);
  assert.equal((await fetch(`${h.base}/jagentchill/v1/secrets/UNSIGNED`, { method: "PUT", body: "x" })).status, 401);
  const list = async (device: typeof admin) => fetch(`${h.base}/jagentchill/v1/secrets`, { headers: device.device.signedHeaders(device.offer.gatewayId, "GET", "/jagentchill/v1/secrets", undefined) });
  assert.equal((await list(editor)).status, 403);
  const names = ((await (await list(admin)).json()) as any).secrets;
  assert.ok(names.some((secret: any) => secret.name === "OPENAI_SECOND" && secret.hint === "••••0000") && names.every((secret: any) => !("value" in secret)));
  const target = "/jagentchill/v1/secrets/OPENAI_SECOND";
  const used = await fetch(h.base + target, { method: "DELETE", headers: admin.device.signedHeaders(admin.offer.gatewayId, "DELETE", target, undefined) });
  assert.equal(used.status, 409);
  await admin.call("jagentchill.provider.endpoint.remove", { endpointId: "uses-key" });
  // A secret nothing uses any more is deleted (the key an earlier host version kept for a provider is just a secret).
  const unused = "/jagentchill/v1/secrets/OPENAI_API_KEY";
  assert.equal((await fetch(h.base + unused, { method: "DELETE", headers: admin.device.signedHeaders(admin.offer.gatewayId, "DELETE", unused, undefined) })).status, 200);
  // Snapshot contains no secret: nothing a device received holds a key, and no more than its last four characters.
  for (const device of [admin, editor]) {
    await device.call("jagentchill.runtime.snapshot.get", {});
    await device.call("jagentchill.runtime.models.list", {});
    await device.call("jagentchill.provider.auth.list", {});
    await device.call("jagentchill.provider.endpoint.list", {});
  }
  for (const frame of [...admin.frames, ...editor.frames]) for (const secret of [KEY, "sk-second-0000000000000000"]) assert.ok(!frame.includes(secret) && !frame.includes(secret.slice(-8)));
  assert.ok(!readFileSync(join(h.dataDir, "config.json"), "utf8").includes("sk-second"));
  // Phone lost: revoking a device changes nothing about the providers the host's CLIs are signed in to.
  const phone = await h.pair("Phone", "admin");
  await admin.call("jagentchill.device.revoke", { deviceId: phone.device.deviceId });
  assert.deepEqual([(await provider("openai")).connected, (await provider("anthropic")).connected], [true, true]);
});

test("Sign-out without a named CLI profile removes nothing and is audited by profile id; accounts are not ordered; an editor cannot sign out", async () => {
  const commands = h.commands.length;
  assert.deepEqual((await admin.call("jagentchill.provider.auth.logout", { providerId: "openai" })).removedProfileIds, []);
  assert.deepEqual((await admin.call("jagentchill.provider.auth.logout", { providerId: "openai", profileIds: ["openai:manual"] })).removedProfileIds, []);
  assert.equal(h.commands.length, commands, "no CLI was signed out");
  assert.equal((await provider("openai")).connected, true);
  assert.deepEqual(h.audit("provider.auth.logout").at(-1), { actor: `device:${admin.device.deviceId}`, providerId: "openai", profileIds: [] } as never);
  const order = await admin.fail("jagentchill.provider.auth.order.set", { providerId: "openai", profileIds: ["codex:cli"] });
  assert.deepEqual([order.code, order.message], ["UNSUPPORTED_FEATURE", "Accounts are no longer ordered: a provider has one key, and each CLI chooses which sign-in it runs on."]);
  assert.equal((await editor.fail("jagentchill.provider.auth.logout", { providerId: "openai" })).code, "SCOPE_DENIED");
});

test("Editor cannot sign in a provider; a catalogue sign-in the product does not perform is refused and names what to use", async () => {
  assert.equal((await editor.fail("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "codex-cli" })).code, "SCOPE_DENIED");
  const spawned = procs.length;
  // The catalogue's own Codex / ChatGPT flows name the Codex CLI.
  const replaced = await admin.fail("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "openai-token-sharing" });
  assert.deepEqual([replaced.code, replaced.details.replacedBy, replaced.details.reason], ["UNSUPPORTED_FEATURE", "codex-cli", "product-sign-in"]);
  assert.match(replaced.message, /Codex CLI on this host/);
  // A provider without a CLI sign-in: refused with the product's words and no replacement.
  for (const [providerId, choiceId] of [["chutes", "chutes"], ["copilot", "github-copilot"]]) {
    const error = await admin.fail("jagentchill.provider.auth.login.start", { providerId, choiceId });
    assert.deepEqual([error.code, error.message, error.details.replacedBy], ["UNSUPPORTED_FEATURE", "Only the agent CLIs on this host and OpenRouter sign in from the app.", undefined], `${providerId}/${choiceId}`);
  }
  // An unknown choice is a parameter error; an unknown provider is not found.
  assert.equal((await admin.fail("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "no-such" })).code, "INVALID_PARAMS");
  assert.equal((await admin.fail("jagentchill.provider.auth.login.start", { providerId: "no-such", choiceId: "x" })).code, "NOT_FOUND");
  assert.equal(procs.length, spawned, "no sign-in process was started");
});

test("Device code on a phone; Hand off to desktop; No desktop online; cancel removes the CLI's sign-in process", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const phone = await h.pair("Phone", "admin", "ios");
  const started = await phone.call("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "codex-cli" });
  assert.match(started.loginId, LOGIN_ID_PATTERN);
  const cli = procs.at(-1)!;
  // Device code on a phone: the code, the address and the expiry; the CLI waits for the approval by itself.
  assert.deepEqual([started.step.kind, started.step.userCode, started.step.verificationUrl], ["device-code", "ABCD-1234", "https://auth.openai.com/codex/device"]);
  assert.ok(started.step.expires_ms > Date.now() + 14 * 60_000);
  assert.equal((await phone.call("jagentchill.provider.auth.login.next", { loginId: started.loginId })).step.kind, "device-code");
  // One login per provider: the same device gets it back, another device is refused and cannot read it.
  assert.equal((await phone.call("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "codex-cli" })).loginId, started.loginId);
  assert.equal((await admin.fail("jagentchill.provider.auth.login.start", { providerId: "openai", choiceId: "codex-cli" })).code, "CONFLICT");
  assert.equal((await admin.fail("jagentchill.provider.auth.login.status", { loginId: started.loginId })).code, "NOT_FOUND");
  // No desktop online: there is nobody to hand the login to.
  const desktop = await h.pair("Desktop", "admin", "macos");
  assert.equal((await phone.fail("jagentchill.provider.auth.login.transfer", { loginId: started.loginId, toDeviceId: editor.device.deviceId })).code, "NOT_FOUND");
  desktop.ws.close();
  await tick(40);
  const none = await phone.fail("jagentchill.provider.auth.login.transfer", { loginId: started.loginId, toDeviceId: desktop.device.deviceId });
  assert.deepEqual([none.code, none.message], ["NOT_FOUND", "No desktop device is online"]);
  // Hand off to desktop: the login belongs to the target from that moment and it is told where the login stands.
  const online = await h.pair("Desktop 2", "admin", "windows");
  const handed = await phone.call("jagentchill.provider.auth.login.transfer", { loginId: started.loginId, toDeviceId: online.device.deviceId });
  assert.equal(handed.toDeviceName, "Desktop 2");
  await tick();
  const notice = online.events.find((event) => event.event === "jagentchill.provider.auth.login.transferred")!;
  assert.deepEqual([notice.payload.loginId, notice.payload.providerLabel, notice.payload.step.kind], [started.loginId, "OpenAI", "device-code"]);
  assert.equal((await phone.fail("jagentchill.provider.auth.login.status", { loginId: started.loginId })).code, "NOT_FOUND");
  assert.equal((await online.call("jagentchill.provider.auth.login.status", { loginId: started.loginId })).step.kind, "device-code");
  // The person approved the code at the provider: the CLI ends, its own status says signed in, and the login is done.
  cli.exit(0);
  for (let i = 0; i < 40 && (await online.call("jagentchill.provider.auth.login.status", { loginId: started.loginId })).step.kind !== "done"; i++) await tick(25);
  assert.deepEqual((await online.call("jagentchill.provider.auth.login.status", { loginId: started.loginId })).step, { kind: "done", profileId: "codex:cli", account: "ChatGPT" });
  // Login events reach only the device that owns the login. The event is sent after the step is stored, so the answer
  // to the status call above can arrive first: the event gets a moment.
  for (let wait = 0; wait < 40 && !online.events.some((event) => event.event === "jagentchill.provider.auth.login.updated" && event.payload.step.kind === "done"); wait++) await tick(25);
  assert.ok(online.events.some((event) => event.event === "jagentchill.provider.auth.login.updated" && event.payload.step.kind === "done"));
  assert.ok(!editor.events.some((event) => event.event.startsWith("jagentchill.provider.auth.login.")));
  // Cancel at any step removes the CLI's sign-in process.
  const again = await phone.call("jagentchill.provider.auth.login.start", { providerId: "anthropic", choiceId: "claude-code" });
  assert.equal(again.step.kind, "open-url");
  const cancelled = await phone.call("jagentchill.provider.auth.login.cancel", { loginId: again.loginId });
  assert.deepEqual([cancelled.step.code, procs.at(-1)!.killed], ["CANCELLED", true]);
});

test("A provider's address is not changed in place (a custom endpoint is chosen for a CLI instead); an editor still may not change one", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const words = "Provider addresses are not changed here: add a custom endpoint and choose it for a CLI.";
  for (const [method, params] of [
    ["jagentchill.provider.override.set", { providerId: "openai", baseUrl: "https://llm-proxy.example/v1", confirm: true }],
    ["jagentchill.provider.override.get", { providerId: "openai" }],
    ["jagentchill.provider.override.remove", { providerId: "openai" }],
  ] as const) {
    const error = await admin.fail(method, params);
    assert.deepEqual([error.code, error.message], ["UNSUPPORTED_FEATURE", words], method);
  }
  assert.ok(!readFileSync(join(h.dataDir, "config.json"), "utf8").includes("llm-proxy.example"));
  assert.equal((await provider("openai")).overrideActive, false);
  assert.equal((await editor.fail("jagentchill.provider.override.set", { providerId: "openai", baseUrl: "https://x.example", confirm: true })).code, "SCOPE_DENIED");
});

test("Header-authenticated relay; Endpoint without models; Literal query value; the record holds names of secrets only", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  await admin.putSecret("RELAY_KEY", KEY);
  // Endpoint without models: stored, not ready, and the row says what is missing.
  const empty = (await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ auth: { mode: "header", headerName: "x-api-key", secretName: "RELAY_KEY" }, query: { "api-version": "2026-01-01" } }) })).endpoint;
  assert.deepEqual([empty.projected, empty.rowNotes, empty.keyHint], [false, ["Add at least one model"], "••••LAST"]);
  const models = [{ id: "qwen3.5:27b", alias: "Fast local", label: "Qwen", enabled: true, source: "manual", contextWindow: 64_000 }, { id: "plain", label: "Plain", enabled: true, source: "manual", supportsTools: false }];
  const ready = (await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ auth: { mode: "header", headerName: "x-api-key", secretName: "RELAY_KEY" }, query: { "api-version": "2026-01-01" }, models }) })).endpoint;
  assert.deepEqual([ready.projected, ready.rowNotes, ready.auth, ready.query], [true, [], { mode: "header", headerName: "x-api-key", secretName: "RELAY_KEY" }, { "api-version": "2026-01-01" }]);
  // Header-authenticated relay: the stored record names the secret, never the key.
  assert.ok(!readFileSync(join(h.dataDir, "config.json"), "utf8").includes(KEY));
  // The endpoint's own requests carry the key in its header, read on the host.
  relayRequests.length = 0;
  await admin.call("jagentchill.provider.endpoint.discover", { draft: draft({ auth: { mode: "header", headerName: "x-api-key", secretName: "RELAY_KEY" }, query: { "api-version": "2026-01-01" }, models }) });
  assert.deepEqual([relayRequests[0].url, relayRequests[0].apiKey, relayRequests[0].authorization], ["/v1/models?api-version=2026-01-01", KEY, undefined]);
  // The endpoint is listed as a provider of the group Custom.
  assert.deepEqual([(await provider("relay")).group, (await provider("relay")).label, (await provider("relay")).connected], ["custom", "Team relay", true]);
  assert.equal((await editor.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft() })).code, "SCOPE_DENIED");
});

test("Id collides with a bundled provider; Secret query value on a chat endpoint; Ollama with /v1; unencrypted public addresses are refused", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const collide = await admin.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "openrouter" }) });
  assert.deepEqual([collide.code, collide.details.suggestion], ["ALREADY_EXISTS", "openrouter-2"]);
  const query = await admin.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "keyed", query: { key: { secret: "RELAY_KEY" } } }) });
  assert.deepEqual([query.code, query.message], ["INVALID_PARAMS", "This endpoint needs its key in the address — agent chat cannot use it; put the key in a header"]);
  // Secret query value on a media endpoint: accepted, and the record names the secret.
  const images = (await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "images", capabilities: ["image"], query: { key: { secret: "RELAY_KEY" } } }) })).endpoint;
  assert.deepEqual([images.query, images.projected], [{ key: { secret: "RELAY_KEY" } }, false]);
  const ollama = await admin.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "local-ollama", dialect: "ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: { mode: "none" } }) });
  assert.deepEqual([ollama.code, ollama.message, ollama.details.suggestion], ["INVALID_PARAMS", "Use the native URL without /v1 — tool calling breaks on /v1", "http://127.0.0.1:11434"]);
  assert.equal((await admin.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "bad-secret", auth: { mode: "bearer", secretName: "lower" } }) })).code, "INVALID_PARAMS");
  assert.deepEqual([classifyAddress("127.0.0.1"), classifyAddress("10.1.2.3"), classifyAddress("100.100.1.1"), classifyAddress("8.8.8.8"), classifyAddress("::1")], ["loopback", "private", "tailnet", "public", "loopback"]);
  const blocked = await admin.call("jagentchill.provider.endpoint.test", { draft: draft({ id: "no-private", allowPrivateNetwork: false }) });
  assert.deepEqual([blocked.steps[0].id, blocked.steps[0].status, blocked.steps[0].code], ["resolve", "fail", "EGRESS_BLOCKED"]);
});

test("Relay with a model list; Model removed upstream; No model-list route", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  relayRequests.length = 0;
  const found = await admin.call("jagentchill.provider.endpoint.discover", { draft: draft({ id: "big" }) });
  // Relay with a model list: all 120 are listed with what the endpoint reported, and the first fifty by name are on.
  assert.deepEqual([found.ok, found.models.length, found.models.filter((m: any) => m.enabled).length, found.models[0].contextWindow, found.models[0].source], [true, 120, 50, 32_000, "discovered"]);
  assert.deepEqual(found.models.filter((m: any) => m.enabled).map((m: any) => m.id).at(-1), "model-049");
  // The call carried the endpoint's own auth, read on the host.
  assert.deepEqual([relayRequests[0].url, relayRequests[0].authorization], ["/v1/models", `Bearer ${KEY}`]);
  assert.equal(parseModelList("not json"), undefined);
  assert.deepEqual(parseModelList(JSON.stringify({ models: [{ name: "models/gem" }, { nothing: 1 }] }))!.map((m) => m.id), ["gem"]);
  // Model removed upstream: it stays in the record, flagged, and an edited field is never overwritten.
  relayModels = relayModels.slice(0, 3);
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "big", models: found.models.slice(0, 5).map((m: any, i: number) => (i === 0 ? { ...m, contextWindow: 8192, editedFields: ["contextWindow"] } : m)) }) });
  const again = await admin.call("jagentchill.provider.endpoint.discover", { endpointId: "big" });
  assert.deepEqual(again.models.map((m: any) => [m.id, m.noLongerListed === true]), [["model-000", false], ["model-001", false], ["model-002", false], ["model-003", true], ["model-004", true]]);
  assert.equal(again.models[0].contextWindow, 8192);
  assert.equal((await admin.call("jagentchill.provider.endpoint.get", { endpointId: "big" })).endpoint.models.length, 5);
  // No model-list route.
  relayMode = "no-list";
  const none = await admin.call("jagentchill.provider.endpoint.discover", { draft: draft({ id: "nolist" }) });
  assert.deepEqual([none.ok, none.reason, none.message], [false, "no-model-list", "This endpoint has no model list — add models by ID"]);
  relayMode = "ok";
});

test("Working relay; Wrong dialect: the connection test sends real requests and reports step by step", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const models = [{ id: "model-000", label: "M", enabled: true, source: "manual" }];
  const good = await admin.call("jagentchill.provider.endpoint.test", { draft: draft({ id: "probe", models }) });
  const status = (report: any) => Object.fromEntries(report.steps.map((step: any) => [step.id, step.status]));
  // Working relay.
  assert.deepEqual(status(good), { resolve: "pass", connect: "pass", "auth-and-models": "pass", completion: "pass", streaming: "pass", usage: "pass", "tool-call": "skipped" });
  assert.equal(good.steps.find((step: any) => step.id === "tool-call").detail, "Not tested by the server");
  // A dialect the server's own client sends no completion in: those steps are skipped and say so.
  const responses = await admin.call("jagentchill.provider.endpoint.test", { draft: draft({ id: "probe", dialect: "openai-responses", models }) });
  assert.deepEqual(responses.steps.filter((step: any) => ["completion", "streaming", "usage"].includes(step.id)).map((step: any) => [step.status, step.detail]), Array(3).fill(["skipped", "A completion in this dialect is not tested by the server"]));
  // Wrong dialect.
  relayMode = "anthropic";
  const wrong = await admin.call("jagentchill.provider.endpoint.test", { draft: draft({ id: "probe", models }) });
  relayMode = "ok";
  const completion = wrong.steps.find((step: any) => step.id === "completion");
  assert.deepEqual([completion.status, completion.code, completion.detail], ["fail", "runtime/dialect-mismatch", "This endpoint answered like an Anthropic-compatible API — change the dialect"]);
  // A saved endpoint keeps its last test.
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "probe", models }) });
  await admin.call("jagentchill.provider.endpoint.test", { endpointId: "probe" });
  assert.equal((await admin.call("jagentchill.provider.endpoint.get", { endpointId: "probe" })).endpoint.lastTest.steps.length, 7);
});

test("Presets: 9router, Two LiteLLM proxies, Filter by kind and capability, Duplicate and edit a preset", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const presets = (await editor.call("jagentchill.provider.preset.list", {})).presets;
  assert.deepEqual(presets.map((preset: any) => preset.presetId), SHIPPED_PRESETS.map((preset) => preset.presetId));
  // 9router preset.
  const router = presets.find((preset: any) => preset.presetId === "9router");
  assert.deepEqual([router.kind, router.baseUrlTemplate, router.variables.map((v: any) => [v.name, v.example]), router.dialect, router.auth.mode, router.modelListPath, router.modelSource, router.verified.by],
    ["custom-endpoint", "http://{host}:{port}/v1", [["host", "localhost"], ["port", "20128"]], "openai-completions", "bearer", "/models", "discover-and-manual", "vendor-docs"]);
  assert.ok(presets.every((preset: any) => preset.verified.ref.length > 0));
  // Filter presets.
  assert.deepEqual((await editor.call("jagentchill.provider.preset.list", { kind: "custom-endpoint" })).presets.map((preset: any) => preset.presetId), ["9router", "openai-compatible", "anthropic-compatible"]);
  assert.equal((await editor.call("jagentchill.provider.preset.list", { capability: "sfx" })).presets.length, 0);
  // Two LiteLLM proxies: a second instance of a bundled provider is a custom endpoint with a new id.
  const second = await admin.fail("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "litellm", presetId: "litellm" }) });
  assert.equal(second.details.suggestion, "litellm-2");
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft({ id: "litellm-2", label: "LiteLLM 2", presetId: "litellm", presetVersion: 1 }) });
  // Duplicate and edit a preset: a user preset can be changed and removed, a shipped one cannot.
  const generic = presets.find((preset: any) => preset.presetId === "openai-compatible");
  const { shipped: _shipped, ...copy } = generic;
  assert.equal((await admin.fail("jagentchill.provider.preset.upsert", { preset: copy })).code, "CONFLICT");
  await admin.call("jagentchill.provider.preset.upsert", { preset: { ...copy, presetId: "team-relay", label: "Team relay", headers: { "x-team": "video" } } });
  const mine = (await editor.call("jagentchill.provider.preset.list", {})).presets.find((preset: any) => preset.presetId === "team-relay");
  assert.deepEqual([mine.shipped, mine.headers, mine.verified.by], [false, { "x-team": "video" }, "user"]);
  assert.equal((await admin.fail("jagentchill.provider.preset.remove", { presetId: "openai-compatible" })).code, "CONFLICT");
  await admin.call("jagentchill.provider.preset.remove", { presetId: "team-relay" });
});

test("Export carries names of secrets and no value; import skips or renames; duplicate and remove", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const exported = await admin.call("jagentchill.provider.endpoint.export", { endpointIds: ["relay"] });
  assert.deepEqual([exported.document.format, exported.document.endpoints.length, exported.document.endpoints[0].auth.secretName], ["jagentchill-endpoints", 1, "RELAY_KEY"]);
  assert.ok(!JSON.stringify(exported).includes(KEY));
  assert.deepEqual(await admin.call("jagentchill.provider.endpoint.import", { document: exported.document }), { imported: [], skipped: ["relay"], missingSecrets: [] });
  const renamed = await admin.call("jagentchill.provider.endpoint.import", { document: { ...exported.document, endpoints: [{ ...exported.document.endpoints[0], auth: { mode: "bearer", secretName: "ELSEWHERE_KEY" } }] }, onConflict: "rename" });
  assert.deepEqual(renamed, { imported: ["relay-2"], skipped: [], missingSecrets: ["ELSEWHERE_KEY"] });
  assert.equal((await admin.call("jagentchill.provider.endpoint.duplicate", { endpointId: "relay" })).endpoint.id, "relay-3");
  for (const endpointId of ["relay-2", "relay-3"]) await admin.call("jagentchill.provider.endpoint.remove", { endpointId });
  assert.deepEqual((await admin.call("jagentchill.provider.endpoint.list", {})).endpoints.filter((endpoint: any) => endpoint.id.startsWith("relay-")), []);
  assert.ok(h.audit("provider.endpoint.remove").some((record: any) => record.endpointId === "relay-3"));
});

test("Expired login; mutations are limited to 30 per device per minute", async () => {
  const fresh = await h.pair("Late admin", "admin");
  const started = await fresh.call("jagentchill.provider.auth.login.start", { providerId: "anthropic", choiceId: "claude-code" });
  const cli = procs.at(-1)!;
  // Thirty changes in a minute are accepted from one device; the next is refused with the wait.
  for (let i = 0; i < 29; i++) await fresh.call("jagentchill.provider.preset.upsert", { preset: { ...SHIPPED_PRESETS.find((preset) => preset.presetId === "openai-compatible")!, presetId: "limit-check", label: `Limit ${i}` } });
  const limited = await fresh.fail("jagentchill.provider.preset.remove", { presetId: "limit-check" });
  assert.equal(limited.code, "RATE_LIMITED");
  assert.ok(limited.details.retryAfter_ms > 0 && limited.details.retryAfter_ms <= 60_000);
  // Expired login: ten minutes after the start the login is over and the CLI's sign-in process is removed.
  clock = 601_000;
  const expired = (await fresh.call("jagentchill.provider.auth.login.status", { loginId: started.loginId })).step;
  assert.deepEqual([expired.kind, expired.code], ["error", "runtime/login-expired"]);
  assert.equal(cli.killed, true);
  clock = 0;
});
