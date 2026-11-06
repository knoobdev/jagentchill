// The agent runtimes in this file are FAKES of the runtime layer and no CLI is started (see harness.ts). These tests pin
// faults the owner hit on a real run, each at the place the server decides it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { SAMPLE_MODELS, createHarness, model, type Harness } from "./harness.ts";

let h: Harness;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;

const SONNET = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
const OPUS = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
const CODEX = { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" };

before(async () => {
  h = await createHarness({ installed: ["claude", "codex", "opencode"], models: { ...SAMPLE_MODELS, "acp-opencode": [model("oc/one")] } });
  h.results.set("opencode --version", h.ok("1.0.0\n"));
  h.results.set("opencode auth list", h.ok("2 credentials\n"));
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  await h.settled();
});
after(() => h.close());

const create = async (device: typeof admin, params: object) => (await device.call("jagentchill.session.create", params)).session;

test("Model selection: a Director route never narrows what a session may select — create, model switch, runtime switch and ORC route all pass", async () => {
  const state = await admin.call("jagentchill.orc.config.get", {});
  const profile = { id: "default", runtime: "codex", provider: "openai", model: "gpt-x", params: {}, enabled: true };
  await admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: { director: { enabled: true, profiles: [profile], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} } } } });
  // Every model the server offers can be selected: Claude Code on both of its models and Codex.
  for (const ref of [SONNET, OPUS, CODEX]) await create(admin, { ref });
  const session = await create(admin, { ref: SONNET });
  await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, ref: OPUS });
  await admin.call("jagentchill.session.runtime.switch", { sessionKey: session.sessionKey, ref: CODEX, idempotencyKey: "allowlist-switch-0001" });
  // The ORC route: a session without an explicit model follows the Director's route.
  assert.deepEqual((await create(admin, {})).ref, CODEX);
  const routed = await admin.call("jagentchill.orc.config.get", {});
  await admin.call("jagentchill.orc.config.update", { expectedRevision: routed.revision, patch: { roles: { director: { enabled: true, profiles: [{ ...profile, runtime: SONNET.runtimeId, provider: SONNET.providerId, model: SONNET.modelId }], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} } } } });
  assert.deepEqual((await create(admin, {})).ref, SONNET);
  // The same for a session of an editor device; its turn runs on the model it names.
  const own = await create(editor, { ref: OPUS });
  await editor.call("jagentchill.chat.send", { sessionKey: own.sessionKey, message: "hi" });
  assert.equal(h.fake.callsOf("createSession").at(-1).model, "opus");
  h.fake.endTurn(own.sessionKey);
});
