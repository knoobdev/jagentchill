// W23a: API keys and custom endpoints stored on the host reach the agent CLIs — through the child's environment and the
// per-session configuration only. The runtime clients here are the REAL adapters (Claude Agent SDK, Codex app-server,
// ACP) started on the FAKE CLIs of `fixtures/` (no real CLI turn, no provider call): each fake writes the credential-
// bearing variables and the Codex thread configuration it was given to a dump file the tests read. The provider's model
// list (the key check) is answered by a simulated provider (`http`).
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { AcpRuntimeClient, ClaudeRuntimeClient, CodexRuntimeClient } from "../src/agents/runtime/clients.ts";
import type { RuntimeClientFactory } from "../src/runtimes/service.ts";
import { createHarness, type Harness } from "./harness.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");
const KEYS = { anthropic: "sk-ant-w23a-0123456789abcdefTAIL", openai: "sk-proj-w23a-abcdef0123456789OPEN", google: "AIzaW23aGoogleKey0123456789GOOG", relay: "relay-w23a-secret-0123456789RELAY", openrouter: "sk-or-v1-w23a-0123456789abcdefROUT" };
const requests: Array<{ url: string; headers: Record<string, string> }> = [];
const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

let h: Harness;
let dump: string;
/** Every device the tests paired: the leak check reads every frame each of them received. */
const paired: Array<{ frames: string[] }> = [];
const pairAdmin = async (name: string) => { const device = await h.pair(name, "admin"); paired.push(device); return device; };
const logged: string[] = [];
const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };

const clients: RuntimeClientFactory = (runtime) => runtime.driver === "claude" ? new ClaudeRuntimeClient(join(fixtures, "fake-claude-cli.mjs"))
  : runtime.driver === "codex" ? new CodexRuntimeClient(join(fixtures, "fake-codex-app-server.mjs")) : new AcpRuntimeClient(join(fixtures, "fake-acp-agent.mjs"), []);

/** The dump lines of one CLI, oldest first; waits until `count` of them are there. */
async function starts(cli: string, count: number): Promise<Array<{ cli: string; env: Record<string, string>; threadStart?: any }>> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const lines = existsSync(dump) ? readFileSync(dump, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.cli === cli) : [];
    if (lines.length >= count) return lines;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error(`the ${cli} fake did not start ${count} time(s)`);
}

before(async () => {
  for (const level of ["log", "warn", "error", "info"] as const) console[level] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  const root = resolve(import.meta.dirname, "../../.dev/run-w23a-test");
  rmSync(root, { recursive: true, force: true });
  dump = join(root, "fixture-dump.jsonl");
  h = await createHarness({
    installed: ["claude", "codex", "gemini", "opencode"], runtimeClients: clients, extraPath: [dirname(process.execPath)], env: { W23A_FIXTURE_DUMP: dump },
    commands: { "gemini --version": { code: 0, stdout: "0.26.0\n", stderr: "", timedOut: false }, "opencode --version": { code: 0, stdout: "1.0.0\n", stderr: "", timedOut: false }, "opencode auth list": { code: 0, stdout: "", stderr: "", timedOut: false } },
    // The simulated providers: each lists its models to its own key and refuses any other (no model is ever run).
    http: async (url, init) => {
      const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
      requests.push({ url, headers });
      const { host, pathname } = new URL(url);
      if (host === "api.anthropic.com" && pathname === "/v1/models") return headers["x-api-key"] === KEYS.anthropic ? json(200, { data: [{ id: "claude-w23a-1", display_name: "Claude W23a" }] }) : json(401, { error: { message: "invalid x-api-key" } });
      if (host === "api.openai.com" && pathname === "/v1/models") return headers.authorization === `Bearer ${KEYS.openai}` ? json(200, { data: [{ id: "gpt-w23a" }, { id: "text-embedding-3-small" }, { id: "dall-e-3" }] }) : json(401, { error: "bad key" });
      if (host === "openrouter.ai" && pathname === "/api/v1/auth/keys") return JSON.parse(init?.body ?? "{}").code === "or-code-w23a" ? json(200, { key: KEYS.openrouter }) : json(403, { error: "invalid code" });
      if (host === "openrouter.ai" && pathname === "/api/v1/models") return headers.authorization === `Bearer ${KEYS.openrouter}` ? json(200, { data: [{ id: "moonshotai/kimi-w23a", name: "Kimi W23a", context_length: 131072 }] }) : json(401, { error: "bad key" });
      if (host === "generativelanguage.googleapis.com") return headers["x-goog-api-key"] === KEYS.google ? json(200, { models: [{ name: "models/gemini-w23a-pro", displayName: "Gemini W23a Pro", inputTokenLimit: 1_000_000 }, { name: "models/text-embedding-004" }] }) : json(400, { error: "API key not valid" });
      throw new Error(`unexpected outbound request to ${host}`);
    },
  });
  await h.settled();
});
after(async () => {
  Object.assign(console, original);
  await h.close();
  rmSync(resolve(import.meta.dirname, "../../.dev/run-w23a-test"), { recursive: true, force: true });
});

test("Claude Code: its own account passes no key; a stored Anthropic key reaches the Claude fake's environment and is billed per call", async () => {
  const admin = await pairAdmin("Keys admin");
  // CLI account (the default): the CLI gets no key from the host.
  const own = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey: own, message: "hello" });
  const [first] = await starts("claude", 1);
  assert.equal(first.env.ANTHROPIC_API_KEY, undefined, "the CLI's own account: no key in its environment");
  assert.equal(Object.values(first.env).some((value) => Object.values(KEYS).includes(value)), false);

  // A key: typed on the device, written over the signed secret route, named in the call.
  assert.equal((await admin.putSecret("ANTHROPIC_API_KEY", KEYS.anthropic)).status, 200);
  const stored = await admin.call("jagentchill.provider.auth.setApiKey", { providerId: "anthropic", secretName: "ANTHROPIC_API_KEY" });
  assert.deepEqual([stored.connected, stored.profile.profileId, stored.profile.type, stored.profile.health, stored.profile.keyHint, stored.models], [true, "anthropic:api-key", "api-key", "ok", "TAIL", 1]);
  assert.ok(requests.every((request) => new URL(request.url).pathname.endsWith("/models")), "the key check only lists models: nothing is generated");
  const listed = (await admin.call("jagentchill.provider.auth.list", {})).providers.find((entry: any) => entry.providerId === "anthropic");
  assert.deepEqual(listed.profiles.find((profile: any) => profile.type === "api-key"), { profileId: "anthropic:api-key", label: "Anthropic API key", type: "api-key", choiceId: "apiKey", keyHint: "TAIL", health: "ok", lastProbe_ms: listed.profiles.find((profile: any) => profile.type === "api-key").lastProbe_ms, order: listed.profiles.length - 1 });

  // Claude Code is set to run on it: its models are the key's, under Claude Code.
  const config = (await admin.call("jagentchill.runtime.config.get", {})).config;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { "claude-code": { signIn: { kind: "key", providerId: "anthropic" } } } } });
  await h.app.runtimes.settled("claude-code");
  const entry = h.app.runtimes.snapshot().find((candidate) => candidate.runtimeId === "claude-code")!;
  assert.deepEqual([entry.status, entry.signIn, entry.models.map((model) => `${model.providerId}/${model.modelId}`)], ["ready", { kind: "key", providerId: "anthropic", label: "Anthropic API key" }, ["anthropic/claude-w23a-1"]]);
  const picker = (await admin.call("jagentchill.runtime.models.list", {})).groups.find((group: any) => group.runtimeId === "claude-code");
  assert.deepEqual(picker.providers.map((provider: any) => [provider.providerId, provider.models.map((model: any) => model.modelId)]), [["anthropic", ["claude-w23a-1"]]]);

  const keyed = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "claude-w23a-1" } })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey: keyed, message: "hello" });
  const second = (await starts("claude", 2))[1];
  const billing = (key: string) => (h.app.db.prepare("SELECT billing FROM usage_records WHERE session_key = ?").all(key) as Array<{ billing: string }>).map((row) => row.billing);
  assert.deepEqual([billing(own)[0], billing(keyed)[0]], ["plan", "api"], "a turn on the CLI's subscription is its plan; a turn on a stored key is billed per call");
  assert.equal(second.env.ANTHROPIC_API_KEY, KEYS.anthropic, "the stored key reaches Claude Code's environment");
  assert.equal(second.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);

  // Back to the CLI account: no key again.
  const now = (await admin.call("jagentchill.runtime.config.get", {})).config;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: now.revision, patch: { entries: { "claude-code": { signIn: { kind: "cli" } } } } });
  await h.app.runtimes.settled("claude-code");
  const third = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey: third, message: "hello" });
  assert.equal((await starts("claude", 3))[2].env.ANTHROPIC_API_KEY, undefined, "choosing the CLI account passes no key");
  admin.ws.close();
});

test("Codex: a stored OpenAI key reaches the Codex fake as OPENAI_API_KEY with a Responses-API model provider on thread/start", async () => {
  const admin = await pairAdmin("Codex admin");
  await admin.putSecret("OPENAI_API_KEY", KEYS.openai);
  const stored = await admin.call("jagentchill.provider.auth.setApiKey", { providerId: "openai", secretName: "OPENAI_API_KEY", profileLabel: "Team key" });
  assert.deepEqual([stored.profile.label, stored.models], ["Team key", 1], "only the chat models of the key are listed (not embeddings or images)");
  const config = (await admin.call("jagentchill.runtime.config.get", {})).config;
  // Claude Code cannot run on an OpenAI key.
  const refused = await admin.fail("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { "claude-code": { signIn: { kind: "key", providerId: "openai" } } } } });
  assert.deepEqual([refused.code, refused.message], ["INVALID_PARAMS", "Claude Code runs only on an Anthropic key."]);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { codex: { signIn: { kind: "key", providerId: "openai" } } } } });
  await h.app.runtimes.settled("codex");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-w23a" } })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey, message: "hello" });
  const [start] = await starts("codex", 1);
  assert.equal(start.env.OPENAI_API_KEY, KEYS.openai);
  assert.equal(start.threadStart.model, "gpt-w23a");
  assert.equal(start.threadStart.modelProvider, "jagentchill-openai");
  assert.deepEqual(start.threadStart.config.model_providers["jagentchill-openai"], { name: "OpenAI (API key)", base_url: "https://api.openai.com/v1", env_key: "OPENAI_API_KEY", wire_api: "responses" });
  assert.equal(JSON.stringify(start.threadStart).includes(KEYS.openai), false, "the key is never in Codex's configuration, only in its environment");
  assert.ok(start.threadStart.config.mcp_servers.jagentchill, "the server's tools stay attached");
  admin.ws.close();
});

test("Gemini CLI: a stored Google key reaches the Gemini fake with a server-owned settings file that selects the key sign-in", async () => {
  const admin = await pairAdmin("Gemini admin");
  await admin.putSecret("GEMINI_API_KEY", KEYS.google);
  assert.equal((await admin.call("jagentchill.provider.auth.setApiKey", { providerId: "google", secretName: "GEMINI_API_KEY" })).models, 1);
  const config = (await admin.call("jagentchill.runtime.config.get", {})).config;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { "gemini-cli": { signIn: { kind: "key", providerId: "google" } } } } });
  await h.app.runtimes.settled("gemini-cli");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "gemini-cli", providerId: "google", modelId: "gemini-w23a-pro" }, modeId: "edit" })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey, message: "hello" });
  const [start] = await starts("acp", 1);
  assert.deepEqual([start.env.GEMINI_API_KEY, start.env.GEMINI_MODEL], [KEYS.google, "gemini-w23a-pro"]);
  const settings = JSON.parse(readFileSync(start.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? h.app.runtimes.homeDirectory(), "utf8"));
  assert.deepEqual(settings, { security: { auth: { selectedType: "gemini-api-key" } } });
  assert.ok(start.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH!.startsWith(h.dataDir), "the settings file is the server's own, never the person's ~/.gemini");
  admin.ws.close();
});

test("a custom endpoint reaches OpenCode (inline provider config) and Codex (model provider); a Chat-Completions endpoint is refused for Codex", async () => {
  const admin = await pairAdmin("Endpoint admin");
  await admin.putSecret("RELAY_KEY", KEYS.relay);
  const model = { id: "relay-model", label: "Relay Model", enabled: true, input: ["text"], supportsTools: true, reasoning: false, usageInStreaming: true, source: "manual", editedFields: [] };
  const draft = { id: "lab-relay", label: "Lab relay", baseUrl: "https://relay.example/v1", dialect: "openai-responses", auth: { mode: "bearer", secretName: "RELAY_KEY" }, headers: { "x-team": "video" }, allowPrivateNetwork: false, timeoutSeconds: 60, maxConcurrency: 2, modelSource: "manual", models: [model], capabilities: ["llm"], enabled: true, order: 0 };
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: draft });
  await admin.call("jagentchill.provider.endpoint.upsert", { endpoint: { ...draft, id: "chat-only", label: "Chat only", dialect: "openai-completions" } });
  const snapshot = (await admin.call("jagentchill.runtime.snapshot.get", {})).runtimes;
  const options = (id: string) => snapshot.find((entry: any) => entry.runtimeId === id).signInOptions.filter((option: any) => option.kind === "endpoint").map((option: any) => [option.id, option.usable]);
  assert.deepEqual(options("codex"), [["lab-relay", true], ["chat-only", false]]);
  assert.deepEqual(options("acp-opencode"), [["lab-relay", true], ["chat-only", true]]);
  assert.deepEqual(options("claude-code"), [["lab-relay", false], ["chat-only", false]]);
  const config = (await admin.call("jagentchill.runtime.config.get", {})).config;
  const refused = await admin.fail("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { codex: { signIn: { kind: "endpoint", endpointId: "chat-only" } } } } });
  assert.deepEqual([refused.code, refused.message], ["INVALID_PARAMS", "Codex needs an endpoint that speaks the OpenAI Responses API."]);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { codex: { signIn: { kind: "endpoint", endpointId: "lab-relay" } }, "acp-opencode": { signIn: { kind: "endpoint", endpointId: "lab-relay" } } } } });
  await h.app.runtimes.settled("acp-opencode");
  await h.app.runtimes.settled("codex");
  // The endpoint's models are shown under the CLIs that will run them.
  const groups = (await admin.call("jagentchill.runtime.models.list", {})).groups;
  for (const id of ["acp-opencode", "codex"]) assert.deepEqual(groups.find((group: any) => group.runtimeId === id).providers.map((provider: any) => [provider.providerId, provider.label, provider.models.map((entry: any) => entry.modelId)]), [["lab-relay", "Lab relay", ["relay-model"]]], id);

  const opencode = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "acp-opencode", providerId: "lab-relay", modelId: "relay-model" }, confirmFullAccess: true })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey: opencode, message: "hello" });
  const acp = (await starts("acp", 2))[1];
  const inline = JSON.parse(acp.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(inline.provider["jagentchill-lab-relay"], { npm: "@ai-sdk/openai", name: "Lab relay", options: { baseURL: "https://relay.example/v1", apiKey: "{env:JAGENTCHILL_ENDPOINT_LAB_RELAY_KEY}", headers: { "x-team": "video" } }, models: { "relay-model": { name: "Relay Model" } } });
  assert.equal(inline.model, "jagentchill-lab-relay/relay-model");
  assert.equal(acp.env.JAGENTCHILL_ENDPOINT_LAB_RELAY_KEY, KEYS.relay);
  assert.equal(acp.env.OPENCODE_CONFIG_CONTENT.includes(KEYS.relay), false, "OpenCode's configuration names the key by variable, never by value");

  const codex = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "lab-relay", modelId: "relay-model" } })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey: codex, message: "hello" });
  const start = (await starts("codex", 2))[1];
  assert.equal(start.threadStart.modelProvider, "jagentchill-endpoint-lab-relay");
  assert.deepEqual(start.threadStart.config.model_providers["jagentchill-endpoint-lab-relay"], { name: "Lab relay", base_url: "https://relay.example/v1", wire_api: "responses", env_key: "JAGENTCHILL_ENDPOINT_LAB_RELAY_KEY", http_headers: { "x-team": "video" } });
  assert.equal(start.env.JAGENTCHILL_ENDPOINT_LAB_RELAY_KEY, KEYS.relay);
  assert.equal(start.env.OPENAI_API_KEY, undefined, "an endpoint session is not given the stored OpenAI key");

  admin.ws.close();
});

test("a rejected key is deleted; a provider no CLI runs on is refused; removing a key leaves the CLI unready, never on another account", async () => {
  const admin = await pairAdmin("Reject admin");
  await admin.putSecret("ANTHROPIC_WRONG", "sk-ant-wrong-key-0000000000");
  const rejected = await admin.fail("jagentchill.provider.auth.setApiKey", { providerId: "anthropic", secretName: "ANTHROPIC_WRONG" });
  assert.deepEqual([rejected.code, rejected.message], ["runtime/auth-failed", "The provider rejected this key"]);
  assert.equal(h.app.secrets.has("ANTHROPIC_WRONG"), false, "a rejected key is not kept");
  assert.equal(h.app.secrets.has("ANTHROPIC_API_KEY"), true, "the key in use is untouched");
  await admin.putSecret("COHERE_API_KEY", "cohere-key-0123456789");
  assert.equal((await admin.fail("jagentchill.provider.auth.setApiKey", { providerId: "cohere", secretName: "COHERE_API_KEY" })).code, "UNSUPPORTED_FEATURE");

  // Gemini CLI runs on the Google key; removing the key makes it unready instead of falling back to its own sign-in.
  const removed = await admin.call("jagentchill.provider.auth.logout", { providerId: "google", profileIds: ["google:api-key"] });
  assert.deepEqual(removed.removedProfileIds, ["google:api-key"]);
  assert.equal(h.app.secrets.has("GEMINI_API_KEY"), false);
  await h.app.runtimes.settled("gemini-cli");
  const gemini = h.app.runtimes.snapshot().find((entry) => entry.runtimeId === "gemini-cli")!;
  assert.deepEqual([gemini.status, gemini.error?.code], ["unavailable", "runtime/no-provider"]);
  admin.ws.close();
});

test("OpenRouter's sign-in (paste-back) stores its key, which OpenCode runs on by variable", async () => {
  const admin = await pairAdmin("OpenRouter admin");
  const started = await admin.call("jagentchill.provider.auth.login.start", { providerId: "openrouter", choiceId: "openrouter-oauth", browserOnHost: false });
  assert.equal(started.step.kind, "open-url");
  assert.equal(started.step.returns, "paste-code");
  assert.match(started.step.url, /^https:\/\/openrouter\.ai\/auth\?code_challenge=/);
  const asked = await admin.call("jagentchill.provider.auth.login.next", { loginId: started.loginId });
  assert.equal(asked.step.kind, "enter-text");
  await admin.putSecret(asked.step.secretName, "or-code-w23a");
  const done = await admin.call("jagentchill.provider.auth.login.next", { loginId: started.loginId });
  assert.deepEqual(done.step, { kind: "done", profileId: "openrouter:api-key" });
  const listed = (await admin.call("jagentchill.provider.auth.list", {})).providers.find((entry: any) => entry.providerId === "openrouter");
  assert.deepEqual([listed.connected, listed.profiles[0].type, listed.profiles[0].keyHint], [true, "oauth", "ROUT"]);
  const config = (await admin.call("jagentchill.runtime.config.get", {})).config;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { "acp-opencode": { signIn: { kind: "key", providerId: "openrouter" } } } } });
  await h.app.runtimes.settled("acp-opencode");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "acp-opencode", providerId: "openrouter", modelId: "moonshotai/kimi-w23a" }, confirmFullAccess: true })).session.sessionKey;
  await admin.yes("jagentchill.chat.send", { sessionKey, message: "hello" });
  const acp = (await starts("acp", 3))[2];
  const inline = JSON.parse(acp.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual([inline.provider.openrouter.options, inline.model, acp.env.OPENROUTER_API_KEY], [{ apiKey: "{env:OPENROUTER_API_KEY}" }, "openrouter/moonshotai/kimi-w23a", KEYS.openrouter]);
  admin.ws.close();
});

test("no key ever appears in the audit, the database, the configuration, the server's log or any frame sent to a device", async () => {
  const admin = await pairAdmin("Leak check");
  await admin.call("jagentchill.provider.auth.list", {});
  await admin.call("jagentchill.runtime.snapshot.get", {});
  await admin.call("jagentchill.runtime.models.list", {});
  await admin.call("jagentchill.provider.endpoint.list", {});
  const values = Object.values(KEYS);
  const tables = (h.app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
  for (const table of tables) {
    const text = JSON.stringify(h.app.db.prepare(`SELECT * FROM "${table}"`).all());
    for (const value of values) assert.equal(text.includes(value), false, `${table} holds a key`);
  }
  const configText = readFileSync(join(h.dataDir, "config.json"), "utf8");
  for (const value of values) assert.equal(configText.includes(value), false, "config.json holds a key");
  for (const value of values) assert.equal(logged.some((line) => line.includes(value)), false, "the server logged a key");
  assert.ok(paired.length >= 6 && paired.every((device) => device.frames.length > 0));
  for (const device of paired) for (const value of values) assert.equal(device.frames.some((frame) => frame.includes(value)), false, "a device frame carries a key");
  assert.ok(h.audit("provider.auth.connect").length >= 3);
  admin.ws.close();
});
