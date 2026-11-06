// The agent runtimes in this file are FAKES of the runtime layer and no CLI is started (see harness.ts): these tests
// cover the ORC document, its validation and route resolution.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGENT_TEAM_METHOD_SCOPES, ORC_BUILTIN_ROLES, ORC_METHOD_SCOPES } from "@jagentchill/protocol";
import { startStubGeneration } from "../scripts/stub-generation.ts";
import { SAMPLE_MODELS, createHarness, model, type Harness } from "./harness.ts";

/** Codex here has a large model with thinking and pictures, and a small text-only one. */
const MODELS = { ...SAMPLE_MODELS, codex: [model("gpt-x", { isDefault: true, thinkingLevels: [{ id: "low", label: "low" }, { id: "high", label: "high" }], input: ["text", "image"] }), model("gpt-small")] };

let h: Harness;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;
let viewer: Awaited<ReturnType<Harness["pair"]>>;

before(async () => {
  h = await createHarness({ models: MODELS });
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  viewer = await h.pair("Viewer", "viewer");
  await h.settled();
});
after(() => h.close());

const profile = (id: string, model: string, over: object = {}) => ({ id, runtime: "codex", provider: "openai", model, params: {}, enabled: true, ...over });
const role = (profiles: object[], routes: object, over: object = {}) => ({ enabled: true, profiles, defaultProfileId: (profiles[0] as any).id, routes, limits: {}, ...over });
const get = () => admin.call("jagentchill.orc.config.get", {});
const update = async (patch: object, extra: object = {}) => admin.call("jagentchill.orc.config.update", { expectedRevision: (await get()).revision, patch, ...extra });
const refuse = async (patch: object, extra: object = {}) => admin.fail("jagentchill.orc.config.update", { expectedRevision: (await get()).revision, patch, ...extra });

test("Defaults and the role catalogue: ORC is on, the built-in roles exist, and nothing is configured before an admin chooses", async () => {
  const fresh = await createHarness({ installed: [] });
  try {
    const device = await fresh.pair("Admin", "admin");
    await fresh.settled();
    const state = await device.call("jagentchill.orc.config.get", {});
    assert.deepEqual([state.revision, state.config], [0, { version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: {} }]);
    assert.deepEqual(state.roles.map((entry: any) => entry.id), ORC_BUILTIN_ROLES.map((entry) => entry.id));
    assert.ok(state.roles.every((entry: any) => entry.state === "not_configured" && entry.builtin));
    assert.deepEqual(state.roles.find((entry: any) => entry.id === "video").taskRoutes.slice(0, 2), ["video.text", "video.image"]);
    assert.ok(state.roles.find((entry: any) => entry.id === "director").taskRoutes.includes("quick"));
    // No route, no session: the start fails with NO_ROUTE.
    assert.equal((await device.fail("jagentchill.session.create", {})).code, "NO_ROUTE");
  } finally {
    fresh.close();
  }
});

test("No model is made a default: nothing is suggested, a session without a model is refused, and an admin's update applies a route", async () => {
  const before = await get();
  assert.deepEqual([before.revision, before.config.roles], [0, {}]);
  // The server picks no runtime's model for a role by itself.
  assert.deepEqual(before.suggested, {});
  assert.equal(before.roles.find((entry: any) => entry.id === "director").state, "not_configured");
  // A session without an explicit model, with no route configured: refused before any runtime call, and still nothing is stored.
  const opened = h.fake.callsOf("createSession").length;
  const refused = await editor.fail("jagentchill.session.create", {});
  assert.deepEqual([refused.code, refused.message, refused.details.reason], ["NO_ROUTE", "Choose a model", "no-model-chosen"]);
  assert.equal(h.fake.callsOf("createSession").length, opened);
  assert.equal((await get()).revision, 0);
  // An editor cannot set the routing; an admin device does, with an ordinary update.
  const roles = Object.fromEntries(["director", "screenwriter", "storyboard", "editor", "reviewer", "vision", "translation"].map((id) => [id, role([profile("default", "gpt-x")], { default: { primary: { profileId: "default" }, fallbacks: [] } })]));
  assert.equal((await editor.fail("jagentchill.orc.config.update", { expectedRevision: 0, patch: { roles } })).code, "SCOPE_DENIED");
  const applied = await update({ roles });
  assert.equal(applied.config.roles.director.profiles[0].source, "user");
  const session = (await editor.call("jagentchill.session.create", {})).session;
  assert.deepEqual(session.ref, { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" });
  // Coordination roles have no profile of their own and resolve through the Director; generation roles stay unconfigured.
  const state = await get();
  assert.equal(state.config.roles.lead, undefined);
  assert.equal(state.roles.find((entry: any) => entry.id === "lead").state, "ready");
  assert.equal(state.roles.find((entry: any) => entry.id === "image").state, "not_configured");
  assert.deepEqual(h.app.orc.resolve("lead").candidates.map((candidate) => candidate.ref.modelId), ["gpt-x"]);
});

test("A model an earlier version made the default by itself is removed at start; what a person configured stays", async () => {
  const old = await createHarness();
  const dataDir = old.dataDir;
  const auto = { id: "default", runtime: "codex", provider: "openai", model: "gpt-x", params: {}, enabled: true, source: "auto" };
  const mine = { id: "mine", runtime: "codex", provider: "openai", model: "gpt-small", params: {}, enabled: true, source: "user" };
  const config = {
    version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true,
    roles: {
      director: { enabled: true, profiles: [auto], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} },
      editor: { enabled: true, profiles: [auto, mine], defaultProfileId: "default", routes: { default: { primary: { profileId: "mine" }, fallbacks: [{ profileId: "default" }] } }, limits: {} },
    },
  };
  old.app.db.prepare("INSERT INTO host_documents (key, revision, json) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, json = excluded.json").run("orc", 3, JSON.stringify(config));
  const { createOrcService } = await import("../src/orc/service.ts");
  const again = createOrcService({ db: old.app.db, now: Date.now, broadcast: () => undefined, mutations: { hit: () => undefined } as never, snapshot: () => [], project: async () => true, canActInSession: () => false });
  try {
    const stored = JSON.parse((old.app.db.prepare("SELECT json, revision FROM host_documents WHERE key = ?").get("orc") as any).json);
    assert.equal(stored.roles.director, undefined);
    assert.deepEqual([stored.roles.editor.profiles.map((entry: any) => entry.id), stored.roles.editor.routes.default, stored.roles.editor.defaultProfileId], [["mine"], { primary: { profileId: "mine" }, fallbacks: [] }, "mine"]);
    assert.deepEqual(again.resolve("director").candidates, []);
    assert.deepEqual(old.audit("orc.defaults.cleared").at(-1), { actor: "server", revision: 4, profiles: 2 } as never);
    assert.ok(dataDir);
  } finally {
    old.close();
  }
});

test("Stale revision is refused; only admin devices change routing; every update is announced to subscribed devices", async () => {
  await editor.call("jagentchill.runtime.subscribe", {});
  const state = await get();
  const stale = await admin.fail("jagentchill.orc.config.update", { expectedRevision: state.revision - 1, patch: { askWhenAmbiguous: false } });
  assert.deepEqual([stale.code, stale.details.currentRevision], ["CONFLICT", state.revision]);
  assert.equal((await get()).config.askWhenAmbiguous, true);
  assert.equal((await editor.fail("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { enabled: false } })).code, "SCOPE_DENIED");
  const updated = await update({ askWhenAmbiguous: false });
  assert.deepEqual([updated.revision, updated.config.askWhenAmbiguous, updated.projection], [state.revision + 1, false, "applied"]);
  assert.ok(editor.events.some((event) => event.event === "jagentchill.orc.config.changed" && event.payload.revision === updated.revision));
  // Every role can read the document; it holds no secret.
  assert.equal((await viewer.call("jagentchill.orc.config.get", {})).revision, updated.revision);
});

test("Routes with primary and ordered fallbacks across runtimes", async () => {
  const director = role(
    [profile("main", "gpt-x", { thinking: "high" }), profile("backup", "gpt-small"), { id: "cli", runtime: "claude-code", provider: "anthropic", model: "sonnet", params: {}, enabled: true }],
    { default: { primary: { profileId: "main" }, fallbacks: [{ profileId: "cli" }, { profileId: "backup" }] }, quick: { primary: { profileId: "backup" }, fallbacks: [] } },
  );
  const updated = await update({ roles: { director } });
  assert.equal(updated.projection, "applied");
  const resolved = h.app.orc.resolve("director");
  assert.deepEqual(resolved.candidates.map((candidate) => [candidate.profileId, candidate.ref.runtimeId, candidate.thinking]), [["main", "codex", "high"], ["cli", "claude-code", undefined], ["backup", "codex", undefined]]);
  // A task route that is not configured resolves to the role's default route.
  assert.deepEqual(h.app.orc.resolve("director", "quick").candidates.map((candidate) => candidate.profileId), ["backup"]);
  assert.deepEqual(h.app.orc.resolve("director", "planning").candidates.map((candidate) => candidate.profileId), ["main", "cli", "backup"]);
  // A new session starts on the route's primary with its thinking option.
  const session = (await editor.call("jagentchill.session.create", {})).session;
  assert.deepEqual([session.ref.modelId, session.thinkingOptionId], ["gpt-x", "high"]);
  await editor.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "go" });
  assert.equal(h.fake.callsOf("createSession").at(-1).thinking, "high", "the runtime runs with the profile's thinking");
  h.fake.endTurn(session.sessionKey);
});

test("Fallback when signed out: a target that cannot serve is skipped and the session says why", async () => {
  const director = (await get()).config.roles.director;
  await update({ roles: { director: { ...director, routes: { default: { primary: { profileId: "cli" }, fallbacks: [{ profileId: "main" }] } } } } });
  // Admin and editor devices both get the CLI primary: every device that may use agents may use every runtime that is on.
  assert.equal((await admin.call("jagentchill.session.create", {})).session.ref.runtimeId, "claude-code");
  const forEditor = await editor.call("jagentchill.session.create", {});
  assert.deepEqual([forEditor.session.ref.runtimeId, forEditor.fallback], ["claude-code", undefined]);
  // Signed out: the profile is unusable, with its reason, and routing skips it for everyone.
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: false })));
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const resolved = h.app.orc.resolve("director");
  assert.deepEqual([resolved.candidates.map((candidate) => candidate.profileId), resolved.skipped], [["main"], [{ profileId: "cli", reason: "Claude Code needs sign-in" }]]);
  assert.equal((await admin.call("jagentchill.session.create", {})).session.ref.modelId, "gpt-x");
  assert.equal((await get()).roles.find((entry: any) => entry.id === "director").profiles.find((entry: any) => entry.id === "cli").unusableReason, "Claude Code needs sign-in");
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com" })));
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  await update({ roles: { director: { ...director, routes: { default: { primary: { profileId: "main" }, fallbacks: [{ profileId: "backup" }] } } } } });
});

test("Configuration validation rejects the whole update with its issues; rules about live state only warn", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const before = (await get()).revision;
  const issue = async (patch: object) => {
    const error = await refuse(patch);
    assert.equal(error.code, "VALIDATION_FAILED");
    return error.details.issues[0];
  };
  // A route target must be a profile of the same role, and the default profile must exist and be enabled.
  assert.deepEqual([(await issue({ roles: { editor: role([profile("a", "gpt-x")], { default: { primary: { profileId: "ghost" }, fallbacks: [] } }) } })).path], ["roles.editor.routes.default.primary.profileId"]);
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-x", { enabled: false })], {}) } })).path, "roles.editor.defaultProfileId");
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-x"), profile("a", "gpt-small")], {}) } })).code, "duplicate_id");
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-x")], { default: { primary: { profileId: "a" }, fallbacks: [{ profileId: "a" }] } }) } })).code, "duplicate_target");
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-x")], { nonsense: { primary: { profileId: "a" }, fallbacks: [] } }) } })).code, "unknown_route");
  // Runtime, thinking and mode are checked against the snapshot.
  assert.deepEqual([(await issue({ roles: { editor: role([profile("a", "gpt-x", { runtime: "nope" })], {}) } })).message], ["Unknown runtime 'nope'"]);
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-small", { thinking: "high" })], {}) } })).code, "thinking_unsupported");
  assert.equal((await issue({ roles: { editor: role([{ id: "g", runtime: "gemini-cli", provider: "google", model: "x", mode: "ask", params: {}, enabled: true }], {}) } })).code, "mode_unsupported");
  // Capability matching: vision needs image input; a creative role needs a runtime that can use editor tools.
  assert.deepEqual([(await issue({ roles: { vision: role([profile("a", "gpt-small")], {}) } })).code], ["CAPABILITY_MISMATCH"]);
  // An ACP agent the host does not offer the editor tools to cannot serve a creative role.
  const runtimes = (await admin.call("jagentchill.runtime.config.get", {})).config;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: runtimes.revision, patch: { offerEditorToolsToAcp: false } });
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["acp-opencode"] });
  assert.equal((await refuse({ roles: { editor: role([{ id: "c", runtime: "acp-opencode", provider: "opencode", model: "default", params: {}, enabled: true }], {}) } })).details.issues.some((entry: any) => entry.code === "CAPABILITY_MISMATCH" && entry.message === "OpenCode cannot use editor tools, so it cannot serve this role."), true);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: runtimes.revision + 1, patch: { offerEditorToolsToAcp: true } });
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["acp-opencode"] });
  // Codex gets the server's tools over MCP, with its session named in the address, so it can serve a creative role.
  const codex = { id: "c", runtime: "codex", provider: "openai", model: "gpt-x", params: {}, enabled: true };
  assert.deepEqual((await refuse({ roles: { editor: role([codex, codex], {}) } })).details.issues.map((entry: any) => entry.code).filter((code: string) => code !== "duplicate_id"), []);
  // Two profiles of one agent cannot send different options to the same model.
  const conflict = await issue({ roles: { editor: role([profile("a", "gpt-x", { params: { temperature: 0.2 } }), profile("b", "gpt-x", { params: { temperature: 0.9 } })], {}) } });
  assert.deepEqual([conflict.path, conflict.message], ["roles.editor.profiles.1.params", "Two profiles of one agent cannot send different options to the same model — use one profile, or a different model alias"]);
  assert.equal((await issue({ roles: { editor: role([profile("a", "gpt-x", { params: { extraBody: { model: "x" } } })], {}) } })).code, "extra_body_reserved_key");
  // The Director is always enabled; a built-in role is never deleted.
  assert.equal((await issue({ roles: { director: { ...(await get()).config.roles.director, enabled: false } } })).code, "ROLE_PROTECTED");
  assert.equal((await refuse({}, { removeRoleIds: ["editor"] })).code, "ROLE_PROTECTED");
  // A shape error is INVALID_PARAMS: more than five fallbacks, a bare model without provider.
  assert.equal((await admin.fail("jagentchill.orc.config.update", { expectedRevision: before, patch: { roles: { editor: role([{ id: "a", model: "gpt-x", params: {}, enabled: true }], {}) } } })).code, "INVALID_PARAMS");
  assert.equal((await get()).revision, before);
  // Live-state rules give warnings: a model the runtime does not list is stored and marked.
  const warned = await update({ roles: { reviewer: role([profile("gone", "retired-model")], { default: { primary: { profileId: "gone" }, fallbacks: [] } }) } });
  assert.deepEqual(warned.issues.map((entry: any) => [entry.path, entry.code, entry.level]), [["roles.reviewer.profiles.0", "unusable", "warning"]]);
  assert.equal((await get()).roles.find((entry: any) => entry.id === "reviewer").state, "not_configured");
  // validate runs the same rules without storing; an editor may call it.
  const dry = await editor.call("jagentchill.orc.config.validate", { config: { ...(await get()).config, roles: { vision: role([profile("a", "gpt-small")], {}) } } });
  assert.deepEqual([dry.valid, dry.issues[0].code], [false, "CAPABILITY_MISMATCH"]);
  assert.equal((await editor.call("jagentchill.orc.config.validate", { config: { nonsense: true } })).valid, false);
});

test("Custom roles: created with a fixed capability, limited to 20, removable unless referenced", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const created = await update({ roles: { "trailer-voice": { enabled: true, label: "Trailer voice", capability: "tts", profiles: [], routes: {}, limits: {} } } });
  assert.equal(created.config.roles["trailer-voice"].capability, "tts");
  const listed = (await get()).roles.find((entry: any) => entry.id === "trailer-voice");
  assert.deepEqual([listed.builtin, listed.capability, listed.state], [false, "tts", "not_configured"]);
  // The capability type is immutable after creation.
  assert.equal((await refuse({ roles: { "trailer-voice": { enabled: true, label: "Trailer voice", capability: "llm", profiles: [], routes: {}, limits: {} } } })).code, "CAPABILITY_MISMATCH");
  // A custom role without a capability type is not a role.
  assert.equal((await refuse({ roles: { nameless: { enabled: true, profiles: [], routes: {}, limits: {} } } })).code, "VALIDATION_FAILED");
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`extra-${i}`, { enabled: true, label: `Extra ${i}`, capability: "llm", profiles: [], routes: {}, limits: {} }]));
  assert.equal((await refuse({ roles: many })).details.issues[0].code, "too_many_roles");
  // A custom llm role is a creative role with its own profiles; an override that names it keeps it from being deleted.
  await update({ roles: { narrator: { label: "Narrator", capability: "llm", ...role([profile("n", "gpt-small")], { default: { primary: { profileId: "n" }, fallbacks: [] } }) } } });
  await admin.call("jagentchill.orc.override.set", { scope: { kind: "project", projectId: "p1" }, route: "narrator", target: { profileId: "n" } });
  const used = await refuse({}, { removeRoleIds: ["narrator"] });
  assert.deepEqual([used.code, used.details.references], ["ROLE_IN_USE", ["project:p1"]]);
  await admin.call("jagentchill.orc.override.set", { scope: { kind: "project", projectId: "p1" }, route: "narrator", target: null });
  const removed = await update({}, { removeRoleIds: ["narrator", "trailer-voice"] });
  assert.equal(removed.config.roles.narrator, undefined);
});

test("Override precedence: run, then session, then project, then the role's route; an unusable override is ignored with a warning", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const session = (await editor.call("jagentchill.session.create", {})).session;
  const scope = { kind: "session", sessionKey: session.sessionKey };
  // Another editor cannot set an override on a session it cannot act in; a viewer cannot set any.
  const other = await h.pair("Other editor", "editor");
  assert.equal((await other.fail("jagentchill.orc.override.set", { scope, route: "director", target: { profileId: "backup" } })).code, "NOT_FOUND");
  assert.equal((await viewer.fail("jagentchill.orc.override.set", { scope, route: "director", target: { profileId: "backup" } })).code, "SCOPE_DENIED");
  await admin.call("jagentchill.orc.override.set", { scope: { kind: "project", projectId: "film-1" }, route: "director", target: { profileId: "cli" } });
  await editor.call("jagentchill.orc.override.set", { scope, route: "director", target: { profileId: "backup", params: { temperature: 0.1 } } });
  const order = (context: object) => h.app.orc.resolve("director", "default", context).candidates.map((candidate) => `${candidate.source}:${candidate.profileId}`);
  assert.deepEqual(order({}), ["route:main", "route:backup"]);
  assert.deepEqual(order({ projectId: "film-1" }), ["project:cli", "route:main", "route:backup"]);
  assert.deepEqual(order({ projectId: "film-1", sessionKey: session.sessionKey }), ["session:backup", "project:cli", "route:main"]);
  assert.deepEqual(order({ projectId: "film-1", sessionKey: session.sessionKey, run: { profileId: "main" } }), ["run:main", "session:backup", "project:cli"]);
  assert.deepEqual(h.app.orc.resolve("director", "default", { sessionKey: session.sessionKey }).candidates[0].params, { temperature: 0.1 });
  // An override can pick a profile; it cannot add one.
  assert.equal((await editor.fail("jagentchill.orc.override.set", { scope, route: "director", target: { profileId: "invented" } })).code, "INVALID_PARAMS");
  const ignored = h.app.orc.resolve("director", "default", { run: { profileId: "gone" } });
  assert.deepEqual([ignored.warnings, ignored.candidates[0].profileId], [["override_ignored"], "main"]);
  assert.deepEqual((await editor.call("jagentchill.orc.override.get", { scope })).overrides, { director: { profileId: "backup", params: { temperature: 0.1 } } });
});

test("Import and export; readiness", async () => {
  // A device may make thirty changes a minute; each group of checks uses its own admin device.
  admin = await h.pair("Admin", "admin");
  const exported = await admin.call("jagentchill.orc.config.export", {});
  assert.deepEqual([exported.document.format, exported.document.version], ["jagentchill-orc", 1]);
  const revision = (await get()).revision;
  assert.equal((await admin.fail("jagentchill.orc.config.import", { document: { format: "jagentchill-orc", version: 1, config: { version: 2 } }, expectedRevision: revision })).code, "VALIDATION_FAILED");
  const config = { ...exported.document.config, autoPrepareBrief: false };
  const imported = await admin.call("jagentchill.orc.config.import", { document: { format: "jagentchill-orc", version: 1, config }, expectedRevision: revision });
  assert.deepEqual([imported.projection, imported.config.autoPrepareBrief], ["applied", false]);
  const director = imported.config.roles.director;
  await admin.call("jagentchill.orc.config.update", { expectedRevision: imported.revision, patch: { roles: { director: { ...director, routes: { default: { primary: { profileId: "backup" }, fallbacks: [] } } } } } });
  assert.equal((await editor.call("jagentchill.session.create", {})).session.ref.modelId, "gpt-small");
  // Required and optional roles: the Director is the required one.
  const readiness = await viewer.call("jagentchill.orc.readiness.check", { roles: ["director", "image"] });
  assert.deepEqual(readiness, { enabled: true, roles: [{ roleId: "director", state: "ready", required: true }, { roleId: "image", state: "not_configured", required: false }] });
  // Every handler of this capability is in the protocol table with its scope.
  const handlers = [...h.app.methods.keys()].filter((name) => name.startsWith("jagentchill.orc.")).sort();
  // The teams of the multi-agent piece live under the same prefix; their scopes are declared with the team methods.
  const declared: Record<string, string> = { ...ORC_METHOD_SCOPES, ...Object.fromEntries(Object.entries(AGENT_TEAM_METHOD_SCOPES).filter(([name]) => name.startsWith("jagentchill.orc."))) };
  assert.deepEqual(handlers, Object.keys(declared).sort());
  for (const name of handlers) assert.equal(h.app.methods.get(name)!.scope, declared[name]);
});

test("Generation roles are checked against the generation catalogue: a profile on image, voice, music or transcription naming a model the host does not have for that capability is refused, and one that is turned off is turned on by the update", async () => {
  // The generation PROVIDER is the TEST DOUBLE `scripts/stub-generation.ts`.
  const stub = await startStubGeneration(), fresh = await createHarness({ models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url } } });
  try {
    const device = await fresh.pair("Admin", "admin");
    const one = (roleId: string, model: string, provider = "openrouter") => ({ roles: { [roleId]: { enabled: true, profiles: [{ id: "main", provider, model, params: {}, enabled: true }], defaultProfileId: "main", routes: {}, limits: {} } } });
    const check = async (roleId: string, model: string, provider?: string) => (await device.call("jagentchill.orc.config.validate", { config: { version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, ...one(roleId, model, provider) } })) as { valid: boolean; issues: { path: string; code: string; level: string; message: string }[] };
    const revision = async () => (await device.call("jagentchill.orc.config.get", {})).revision;
    // Not connected: a known model is accepted with a warning about live state; an unknown one is an error either way.
    assert.deepEqual([(await check("image", "openai/gpt-5-image-mini")).valid, (await check("image", "openai/gpt-5-image-mini")).issues.map((issue) => [issue.code, issue.level])], [true, [["unverified", "warning"]]]);
    await device.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await device.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    assert.deepEqual(await check("image", "openai/gpt-5-image-mini"), { valid: true, issues: [] });
    for (const [roleId, model, provider] of [["image", "openai/no-such-image-model"], ["voice-tts", "openai/gpt-5-image-mini"], ["music", "google/gemini-3.8-flash-lite-tts"], ["transcription", "openai/gpt-5-image-mini"], ["image", "openai/gpt-5-image-mini", "acme"]] as const) {
      const found = await check(roleId, model, provider);
      assert.deepEqual([found.valid, found.issues.map((issue) => [issue.path, issue.code, issue.level])], [false, [[`roles.${roleId}.profiles.0.model`, "unknown_model", "error"]]], `${roleId} ← ${model}`);
      const refused = await device.fail("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: one(roleId, model, provider) });
      assert.deepEqual([refused.code, refused.details.issues[0].code], ["VALIDATION_FAILED", "unknown_model"]);
    }
    assert.match((await check("image", "openai/no-such-image-model")).issues[0].message, /openrouter has no image model 'openai\/no-such-image-model'/);
    // A model of the catalogue that is off: the check says the update will turn it on, and the update does.
    const SECOND = "google/gemini-3.1-flash-lite-image", enabled = async () => (await device.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "image" })).models.find((model: any) => model.id === SECOND).enabled;
    assert.equal(await enabled(), false);
    assert.deepEqual((await check("image", SECOND)).issues.map((issue) => [issue.path, issue.code, issue.level]), [["roles.image.profiles.0.model", "model_disabled", "warning"]]);
    const saved = await device.call("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: one("image", SECOND) });
    assert.deepEqual([saved.issues.map((issue: any) => issue.code), await enabled()], [["model_disabled"], true]);
    assert.deepEqual(await check("image", SECOND), { valid: true, issues: [] });
    // The request that names no model now runs on the role's model — nothing fell back silently.
    const job = await fresh.app.generation.settled((await device.yes("jagentchill.generation.create", { capability: "image", params: { prompt: "a kite" }, confirmed: true })).job.jobId);
    assert.deepEqual([job.state, job.model], ["succeeded", SECOND]);
    await device.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["stub/video-fast"], enabled: false });
    assert.deepEqual((await check("video", "stub/video-fast")).issues.map((issue) => issue.code), ["model_disabled"]);
    const videoSaved = await device.call("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: one("video", "stub/video-fast") });
    const videoOn = (await device.call("jagentchill.provider.model.list", { providerId: "openrouter", capability: "video" })).models.find((model: any) => model.id === "stub/video-fast").enabled;
    assert.deepEqual([videoSaved.issues.map((issue: any) => issue.code), videoOn], [["model_disabled"], true]);
  } finally { fresh.close(); await stub.close(); }
});

test("Model routing is in force for a generation role that has a profile: the profile's options go with the request, and a role that is turned off or whose profile cannot serve fails with the reason instead of another model serving unseen", async () => {
  // The generation PROVIDER is the TEST DOUBLE `scripts/stub-generation.ts`.
  const stub = await startStubGeneration(), fresh = await createHarness({ models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url } } });
  try {
    const device = await fresh.pair("Admin", "admin");
    await device.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await device.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    const revision = async () => (await device.call("jagentchill.orc.config.get", {})).revision;
    const role = (over: Record<string, unknown>, profile: Record<string, unknown> = {}) => ({ roles: { image: { enabled: true, profiles: [{ id: "main", provider: "openrouter", model: "openai/gpt-5-image-mini", params: { quality: "low" }, enabled: true, ...profile }], defaultProfileId: "main", routes: {}, limits: {}, ...over } } });
    const make = async (params: Record<string, unknown>) => fresh.app.generation.settled((await device.yes("jagentchill.generation.create", { capability: "image", params, confirmed: true })).job.jobId);
    // No profile at all: the recommended model, with nothing added to the request.
    assert.equal((await make({ prompt: "a kite" })).state, "succeeded");
    assert.equal(stub.calls.filter((call) => call.path === "/images").at(-1)!.quality, undefined);
    // A profile with options: a request that leaves the quality open is made at the profile's; one that names it keeps its own.
    await device.call("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: role({}) });
    const cheap = await make({ prompt: "a second kite" });
    assert.deepEqual([cheap.state, cheap.params.quality, cheap.estimateUsd, stub.calls.filter((call) => call.path === "/images").at(-1)!.quality], ["succeeded", "low", 0.003, "low"]);
    assert.equal((await make({ prompt: "a third kite", quality: "high" })).params.quality, "high");
    // The role turned off: the request fails and says why; nothing is sent.
    const sent = stub.calls.length;
    await device.call("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: role({ enabled: false }) });
    const off = await device.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "a fourth kite" }, confirmed: true });
    assert.deepEqual([off.code, off.details.reason], ["NO_ROUTE", "orc_route_unusable"]);
    assert.match(off.message, /Image role is turned off/);
    // The role on, its only profile's model turned off for the host afterwards: still no other model steps in.
    await device.call("jagentchill.orc.config.update", { expectedRevision: await revision(), patch: role({}) });
    await device.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["openai/gpt-5-image-mini"], enabled: false });
    const disabledRole = (await device.call("jagentchill.orc.config.get", {})).roles.find((entry: any) => entry.id === "image");
    assert.equal(disabledRole.profiles.find((profile: any) => profile.id === "main").unusableReason, "The model is turned off");
    await device.call("jagentchill.provider.model.setEnabled", { providerId: "openrouter", modelIds: ["google/gemini-3.1-flash-lite-image"], enabled: true });
    const gone = await device.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "a fifth kite" }, confirmed: true });
    assert.deepEqual([gone.code, gone.details.reason], ["NO_ROUTE", "orc_route_unusable"]);
    assert.equal(stub.calls.length, sent);
  } finally { fresh.close(); await stub.close(); }
});

test("A profile option that is not applied on its role's path is an issue, named key by key: every option of a writing role or of Vision, an unknown option of a generation role, any option of Transcription — an option a generation request does take raises none and is applied", async () => {
  // The generation PROVIDER is the TEST DOUBLE `scripts/stub-generation.ts`.
  const stub = await startStubGeneration(), fresh = await createHarness({ models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url } } });
  try {
    const device = await fresh.pair("Admin", "admin");
    await device.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await device.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    const role = (profile: Record<string, unknown>) => ({ enabled: true, profiles: [{ id: "main", enabled: true, ...profile }], defaultProfileId: "main", routes: {}, limits: {} });
    const llm = (params: Record<string, unknown>) => role({ runtime: "codex", provider: "openai", model: "gpt-x", params });
    const roles = {
      screenwriter: llm({ temperature: 0.2, extraBody: { top_k: 5 } }), vision: llm({ temperature: 0 }), storyboard: llm({}),
      image: role({ provider: "openrouter", model: "openai/gpt-5-image-mini", params: { quality: "low", steps: 30 } }),
      transcription: role({ provider: "openrouter", model: "qwen/qwen3-asr-1.7b", params: { language: "vi" } }),
    };
    const checked = (await device.call("jagentchill.orc.config.validate", { config: { version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles } })) as { valid: boolean; issues: { path: string; code: string; level: string; message: string }[] };
    const flagged = checked.issues.filter((issue) => issue.code === "option_not_applied");
    assert.deepEqual(flagged.map((issue) => [issue.path, issue.level]).sort(), [
      ["roles.image.profiles.0.params.steps", "warning"], ["roles.screenwriter.profiles.0.params.extraBody", "warning"], ["roles.screenwriter.profiles.0.params.temperature", "warning"],
      ["roles.transcription.profiles.0.params.language", "warning"], ["roles.vision.profiles.0.params.temperature", "warning"],
    ]);
    assert.match(flagged.find((issue) => issue.path.endsWith("screenwriter.profiles.0.params.temperature"))!.message, /^These options are not applied for this role: temperature — a turn of a language model takes no options/);
    assert.match(flagged.find((issue) => issue.path.endsWith("steps"))!.message, /not applied for this role: steps — it is not a parameter of a generation request/);
    assert.equal(checked.valid, true, "a setting that does nothing is said, it does not block saving");
    // The update returns the same issues to the device that saves, and the option that IS applied reaches the provider.
    const saved = await device.call("jagentchill.orc.config.update", { expectedRevision: (await device.call("jagentchill.orc.config.get", {})).revision, patch: { roles } });
    assert.deepEqual(saved.issues.filter((issue: any) => issue.code === "option_not_applied").map((issue: any) => issue.path).sort(), flagged.map((issue) => issue.path).sort());
    const job = await fresh.app.generation.settled((await device.yes("jagentchill.generation.create", { capability: "image", params: { prompt: "a kite" }, confirmed: true })).job.jobId);
    assert.deepEqual([job.state, job.params.quality, (job.params as Record<string, unknown>).steps, stub.calls.filter((call) => call.path === "/images").at(-1)!.quality], ["succeeded", "low", undefined, "low"]);
  } finally { fresh.close(); await stub.close(); }
});

test("An option is 'applied' only where the adapter really sends it — per capability AND per model: pace on a picture role, a picture's shape on a voice role, pace on a voice model that is asked through chat, a length the music request never carries are each the option_not_applied warning; what is sent raises none, and only that reaches the request", async () => {
  // The generation PROVIDER is the TEST DOUBLE `scripts/stub-generation.ts`.
  const stub = await startStubGeneration(), fresh = await createHarness({ models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url } } });
  try {
    const device = await fresh.pair("Admin", "admin");
    await device.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await device.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    const role = (model: string, params: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ enabled: true, profiles: [{ id: "main", enabled: true, provider: "openrouter", model, params }], defaultProfileId: "main", routes: {}, limits: {}, ...over });
    // The reader's row says the pace it takes (the bundled row says none: then a pace is not applied there either — see the end).
    await device.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", metadata: { speed: { min: 0.5, max: 2 } } } });
    const roles = {
      image: role("openai/gpt-5-image-mini", { quality: "low", aspectRatio: "1:1", seed: 7, count: 1, speed: 1.2, voice: "Kore", instrumental: true }),
      // A reader asked through the speech endpoint: its voice and its pace are in the request; a language is not, nor a picture's options.
      "voice-tts": role("google/gemini-3.8-flash-lite-tts", { voice: "Kore", speed: 1.1, language: "vi", quality: "high" }, { routes: { default: { primary: { profileId: "main", params: { speed: 1.2, aspectRatio: "1:1" } }, fallbacks: [] } } }),
      // The conversational voice model is asked through chat: its request carries a voice and nothing of a pace.
      "trailer-voice": role("openai/gpt-audio-mini", { voice: "alloy", speed: 1.1 }, { label: "Trailer voice", capability: "tts" }),
      music: role("google/lyria-3-clip-preview", { instrumental: true, durationSeconds: 60, quality: "high" }),
    };
    const checked = (await device.call("jagentchill.orc.config.validate", { config: { version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles } })) as { valid: boolean; issues: { path: string; code: string; level: string; message: string }[] };
    const flagged = checked.issues.filter((issue) => issue.code === "option_not_applied");
    assert.deepEqual(flagged.map((issue) => issue.path).sort(), [
      // …and a seed: the adapter would send one, but this model's row says it takes none.
      "roles.image.profiles.0.params.instrumental", "roles.image.profiles.0.params.seed", "roles.image.profiles.0.params.speed", "roles.image.profiles.0.params.voice",
      "roles.music.profiles.0.params.durationSeconds", "roles.music.profiles.0.params.quality",
      "roles.trailer-voice.profiles.0.params.speed",
      "roles.voice-tts.profiles.0.params.language", "roles.voice-tts.profiles.0.params.quality", "roles.voice-tts.routes.default.primary.params.aspectRatio",
    ]);
    assert.ok(flagged.every((issue) => issue.level === "warning") && checked.valid);
    assert.match(flagged.find((issue) => issue.path === "roles.image.profiles.0.params.speed")!.message, /^These options are not applied for this role: speed — a request for image to GPT-5 Image Mini does not carry it\.$/);
    // What is said is what happens: the request of the picture role carries its quality and shape, and no pace.
    await device.call("jagentchill.orc.config.update", { expectedRevision: (await device.call("jagentchill.orc.config.get", {})).revision, patch: { roles: { image: roles.image, "voice-tts": roles["voice-tts"] } } });
    const picture = await fresh.app.generation.settled((await device.yes("jagentchill.generation.create", { capability: "image", params: { prompt: "a kite" }, confirmed: true })).job.jobId);
    assert.deepEqual([picture.state, picture.params], ["succeeded", { prompt: "a kite", quality: "low", aspectRatio: "1:1", count: 1 }]);
    const spoken = await fresh.app.generation.settled((await device.yes("jagentchill.generation.create", { capability: "tts", params: { text: "A kite over the harbour." }, confirmed: true })).job.jobId);
    assert.deepEqual([spoken.state, spoken.params], ["succeeded", { text: "A kite over the harbour.", voice: "Kore", speed: 1.2 }]);
    assert.equal(JSON.parse(stub.bodies.at(-1)!).speed, 1.2, "the pace is in the request the provider got");
  } finally { fresh.close(); await stub.close(); }
});

test("Translation without an agent runtime: a profile naming a translation model of the generation catalogue is accepted; any other language-model profile must name its runtime", async () => {
  // The generation PROVIDER is the TEST DOUBLE `scripts/stub-generation.ts`.
  const stub = await startStubGeneration(), fresh = await createHarness({ models: MODELS, extra: { generation: { openRouterBaseUrl: stub.url } } });
  try {
    const device = await fresh.pair("Admin", "admin");
    await device.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await device.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    // A translation row of the generation catalogue, as an admin adds one for a text model of the provider.
    await device.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "stub/translator", capability: "translation", label: "Stub translator" } });
    const translator = fresh.app.generation.catalogue.models("translation").find((model: { id: string; connected: boolean }) => model.id === "stub/translator" && model.connected) as { provider: string; id: string } | undefined;
    assert.ok(translator, "the catalogue lists the translation model");
    const check = async (roleId: string, profile: object) => (await device.call("jagentchill.orc.config.validate", { config: { version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: { [roleId]: role([{ id: "main", params: {}, enabled: true, ...profile }], {}) } } })) as { valid: boolean; issues: { path: string; code: string }[] };
    const translation = await check("translation", { provider: translator!.provider, model: translator!.id });
    assert.deepEqual(translation.issues.filter((issue) => issue.code === "unknown_runtime"), []);
    const writer = await check("screenwriter", { provider: "openai", model: "gpt-x" });
    assert.deepEqual([writer.valid, writer.issues.map((issue) => [issue.path, issue.code])], [false, [["roles.screenwriter.profiles.0.runtime", "unknown_runtime"]]]);
  } finally { fresh.close(); await stub.close(); }
});
