import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  generationParamsSchema,
  ORC_BUILTIN_ROLES, ORC_DEFAULT_FALLBACK_ON, ORC_LLM_TASK_ROUTES, ORC_METHOD_SCOPES, ORC_ROLE_TASK_ROUTES, UNATTENDED_MODE_ID, orcConfigImportParams, orcConfigSchema, orcConfigUpdateParams,
  orcConfigValidateParams, orcOverrideGetParams, orcOverrideSetParams, orcReadinessParams, type ModelRef, type OrcCapabilityType, type OrcConfig, type OrcIssue,
  type OrcProfile, type OrcProjection, type OrcRoleConfig, type OrcRoleDefinition, type RuntimeSnapshotEntry, type Scope,
} from "@jagentchill/protocol";
import type { RateLimiter } from "../channel/rate-limit.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";

const DOCUMENT_KEY = "orc";
const MAX_CUSTOM_ROLES = 20;
const BUILTIN = new Map(ORC_BUILTIN_ROLES.map((role) => [role.id, role]));
const COORDINATION = new Set(ORC_BUILTIN_ROLES.filter((role) => role.group === "coordination").map((role) => role.id));

export type OrcTarget = { profileId: string; ref: ModelRef; thinking?: string; mode?: string; params: Record<string, unknown>; source: "run" | "session" | "project" | "route" };
export type OrcResolution = { roleId: string; routeId: string; candidates: OrcTarget[]; skipped: Array<{ profileId: string; reason: string }>; warnings: string[] };
type Override = { profileId: string; thinking?: string; params?: Record<string, unknown> };

export type OrcServiceDeps = {
  db: DatabaseSync;
  now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown) => void;
  mutations: RateLimiter;
  /** The current runtime snapshot (global scope), as cached. */
  snapshot: () => RuntimeSnapshotEntry[];
  /** Applies the routing where it takes effect; resolves to false when it could not be applied now. */
  project: () => Promise<boolean>;
  /** Whether the caller can act in a session, for a per-session override. */
  canActInSession: (sessionKey: string, connection: Connection) => boolean;
  /**
   * The generation catalogue, for the roles that run on a generation model (image, voice, music, transcription): the
   * models of a capability as the host knows them, and the switch that turns one on. A profile naming a model the
   * catalogue does not have for that capability is an error; naming one that is off turns it on when the update is stored.
   */
  generation?: () => { models(capability: string): { provider: string; id: string; label: string; enabled: boolean; connected: boolean }[]; enable(provider: string, modelId: string): void; /** The profile options the provider's adapter really sends for this model. */ applied?(capability: string, provider: string, modelId: string): readonly string[] } | undefined;
};
/** The capability types a generation provider of this host can serve; the others (video, sfx, …) have no catalogue to check against yet. */
const GENERATION_CHECKED = new Set<OrcCapabilityType>(["image", "video", "tts", "music", "transcription"]);
/**
 * The options of a profile (`params`) that really reach the model on the path its role runs on. An option outside this
 * is not sent anywhere, and saying nothing would make a setting that does nothing: every such key is an issue of the
 * configuration, named.
 * - image, voice, music: a generation request takes the profile's options as its defaults — but only the ones the
 *   request of THAT capability to THAT model carries: the provider's adapter says which (`sends`; a picture has no pace,
 *   a voice model asked through chat takes none either). Without a catalogue to ask (`deps.generation`), the options a
 *   request of the capability can have at all are the most that is called applied.
 * - transcription: a listening request has no options.
 * - language-model roles (the writing roles, Vision, every chat role): a turn goes to an agent CLI, which takes no
 *   model options with a turn: none is applied.
 */
const GENERATION_OPTIONS = new Set(Object.keys(generationParamsSchema.shape));
const CAPABILITY_OPTIONS: Partial<Record<OrcCapabilityType, readonly string[]>> = { image: ["aspectRatio", "quality", "count", "seed"], tts: ["voice", "language", "speed"], music: ["durationSeconds", "instrumental"] };
/** `sent`: what the adapter says it sends for the profile's model, when a catalogue could be asked. */
export function appliedOptions(capability: OrcCapabilityType, sent?: readonly string[]): ReadonlySet<string> {
  const most = CAPABILITY_OPTIONS[capability] ?? [];
  return new Set(sent ? most.filter((key) => sent.includes(key)) : most);
}
const notAppliedWhy = (capability: OrcCapabilityType, key: string, model?: string): string => (capability === "llm" ? "a turn of a language model takes no options of its own (no agent CLI takes a model's options with a turn)" : capability === "transcription" ? "a listening request has no options" : !GENERATION_CHECKED.has(capability) ? "no request of this role takes options yet" : !GENERATION_OPTIONS.has(key) ? "it is not a parameter of a generation request" : `a request for ${capability === "tts" ? "speech" : capability}${model ? ` to ${model}` : ""} does not carry it`);

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}

export const defaultOrcConfig = (): OrcConfig => ({ version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: {} });

/** ORC: which model serves which role. Roles own profiles; routes order them with fallbacks. */
export function createOrcService(deps: OrcServiceDeps) {
  const { db } = deps;

  function load(): { config: OrcConfig; revision: number } {
    const row = db.prepare("SELECT revision, json FROM host_documents WHERE key = ?").get(DOCUMENT_KEY) as { revision: number; json: string } | undefined;
    if (!row) return { config: defaultOrcConfig(), revision: 0 };
    return { config: orcConfigSchema.parse(JSON.parse(row.json)), revision: row.revision };
  }
  function store(config: OrcConfig, revision: number): void {
    db.prepare("INSERT INTO host_documents (key, revision, json) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, json = excluded.json").run(DOCUMENT_KEY, revision, JSON.stringify(config));
  }

  const definitionOf = (config: OrcConfig, roleId: string): OrcRoleDefinition | undefined => {
    const builtin = BUILTIN.get(roleId);
    if (builtin) return builtin;
    const custom = config.roles[roleId];
    return custom?.capability ? { id: roleId, label: custom.label ?? roleId, description: custom.description ?? "", capability: custom.capability, group: custom.capability === "llm" ? "creative" : "generation" } : undefined;
  };
  const taskRoutesOf = (role: OrcRoleDefinition): readonly string[] => (role.capability === "llm" && BUILTIN.has(role.id) ? ORC_LLM_TASK_ROUTES : ORC_ROLE_TASK_ROUTES[role.id] ?? []);
  const refOf = (profile: OrcProfile): ModelRef => ({ runtimeId: profile.runtime ?? "", providerId: profile.provider, modelId: profile.model });

  /** Why a profile cannot serve right now, from live state; undefined when it can. */
  function unusable(role: OrcRoleDefinition, profile: OrcProfile, snapshot: RuntimeSnapshotEntry[]): string | undefined {
    if (!profile.enabled) return "disabled";
    if (role.capability !== "llm") {
      const catalogue = GENERATION_CHECKED.has(role.capability) ? deps.generation?.() : undefined;
      if (!catalogue) return undefined;
      const found = catalogue.models(role.capability).find((model) => model.provider === profile.provider && model.id === profile.model);
      if (!found) return "The model is no longer listed";
      if (!found.connected) return "The provider is not connected";
      if (!found.enabled) return "The model is turned off";
      return undefined;
    }
    if (!profile.runtime) {
      // A Translation profile may name a translation model of the generation catalogue instead of an agent runtime.
      if (role.id !== "translation") return "No agent runtime is chosen for this profile";
      const found = deps.generation?.()?.models("translation").find((model) => model.provider === profile.provider && model.id === profile.model);
      if (!found) return "The model is no longer listed";
      if (!found.connected) return "The provider is not connected";
      if (!found.enabled) return "The model is turned off";
      return undefined;
    }
    const entry = snapshot.find((candidate) => candidate.runtimeId === profile.runtime);
    if (!entry) return "The runtime no longer exists";
    if (!entry.enabled) return `${entry.label} is turned off`;
    if (entry.status === "loading") return undefined;
    if (entry.status !== "ready") return entry.error?.code === "runtime/signed-out" ? `${entry.label} needs sign-in` : entry.error?.message ?? `${entry.label} is not ready`;
    const model = entry.models.find((candidate) => candidate.providerId === profile.provider && candidate.modelId === profile.model);
    if (!model) return "The model is no longer listed";
    if (model.readiness !== "ready" && model.readiness !== "cooldown") return "The model cannot be used right now";
    if (role.needsImageInput && !model.input.includes("image")) return "The model does not accept images";
    return undefined;
  }

  /** The options that are applied for one profile: those of its role's capability that the adapter of ITS model sends (the model's name is for the sentence that says so). */
  function appliedFor(definition: OrcRoleDefinition, profile: OrcProfile): { applied: ReadonlySet<string>; model?: string } {
    const catalogue = GENERATION_CHECKED.has(definition.capability) && definition.capability !== "transcription" ? deps.generation?.() : undefined;
    if (!catalogue?.applied) return { applied: appliedOptions(definition.capability) };
    return { applied: appliedOptions(definition.capability, catalogue.applied(definition.capability, profile.provider, profile.model)), model: catalogue.models(definition.capability).find((model) => model.provider === profile.provider && model.id === profile.model)?.label ?? profile.model };
  }

  /** Validates a whole configuration. Rules about live state give warnings; everything else gives errors. */
  function validate(config: OrcConfig, snapshot: RuntimeSnapshotEntry[]): OrcIssue[] {
    const issues: OrcIssue[] = [];
    const error = (path: string, code: string, message: string) => issues.push({ path, code, message, level: "error" });
    const warn = (path: string, code: string, message: string) => issues.push({ path, code, message, level: "warning" });
    let custom = 0;
    for (const [roleId, role] of Object.entries(config.roles)) {
      const path = `roles.${roleId}`;
      const definition = definitionOf(config, roleId);
      if (!definition) {
        error(`${path}.capability`, "missing_capability", "A custom role needs a capability type.");
        continue;
      }
      if (BUILTIN.has(roleId)) {
        if (role.capability && role.capability !== definition.capability) error(`${path}.capability`, "CAPABILITY_MISMATCH", "The capability of a built-in role cannot be changed.");
        if (roleId === "director" && !role.enabled) error(`${path}.enabled`, "ROLE_PROTECTED", "The Director role is always enabled.");
      } else {
        custom += 1;
        if (!role.label) error(`${path}.label`, "missing_label", "A custom role needs a label.");
      }
      const ids = new Set<string>();
      const paramsByModel = new Map<string, string>();
      role.profiles.forEach((profile, index) => {
        const at = `${path}.profiles.${index}`;
        if (ids.has(profile.id)) error(`${at}.id`, "duplicate_id", `Profile id '${profile.id}' is used twice.`);
        ids.add(profile.id);
        // An option that is not applied on this role's path is said, key by key — never a setting that silently does nothing.
        const { applied, model: sentTo } = appliedFor(definition, profile);
        for (const key of Object.keys(profile.params)) if (!applied.has(key)) warn(`${at}.params.${key}`, "option_not_applied", `These options are not applied for this role: ${key} — ${notAppliedWhy(definition.capability, key, sentTo)}.`);
        if (definition.capability !== "llm") {
          if (profile.runtime) error(`${at}.runtime`, "runtime_not_allowed", "Only language-model roles run on a runtime.");
          if (profile.thinking || profile.mode) error(`${at}.${profile.thinking ? "thinking" : "mode"}`, "not_allowed", "Only language-model roles have thinking and mode.");
          // The model must be one the generation catalogue has for this capability: a name it does not know would be
          // skipped at run time and another model would serve without anyone being told.
          const catalogue = GENERATION_CHECKED.has(definition.capability) ? deps.generation?.() : undefined;
          if (catalogue) {
            const found = catalogue.models(definition.capability).find((model) => model.provider === profile.provider && model.id === profile.model);
            if (!found) error(`${at}.model`, "unknown_model", `${profile.provider} has no ${definition.label.toLowerCase()} model '${profile.model}'. Refresh the provider's model list under Settings, Providers, Generation, or choose a listed model.`);
            else if (!found.connected) warn(at, "unverified", `${profile.provider} is not connected, so this profile cannot serve yet.`);
            else if (!found.enabled && profile.enabled) warn(`${at}.model`, "model_disabled", `${found.label} is turned off for this host; saving this profile turns it on.`);
          }
          return;
        }
        const extra = profile.params.extraBody;
        if (extra !== undefined) {
          if (typeof extra !== "object" || extra === null || Array.isArray(extra)) error(`${at}.params.extraBody`, "extra_body_invalid", "extraBody must be an object.");
          else if (JSON.stringify(extra).length > 8192) error(`${at}.params.extraBody`, "extra_body_too_large", "extraBody is larger than 8 KiB.");
          else if (["model", "messages", "prompt", "stream", "tools"].some((key) => key in extra)) error(`${at}.params.extraBody`, "extra_body_reserved_key", "extraBody cannot set a field the request already sets.");
        }
        // A language-model profile names the agent runtime its turns run on (there is no runtime by default).
        if (!profile.runtime) {
          // The Translation role can run on a translation model of the generation catalogue, with no agent runtime.
          const translator = definition.id === "translation" ? deps.generation?.()?.models("translation").find((model) => model.provider === profile.provider && model.id === profile.model) : undefined;
          if (translator) {
            if (!translator.connected) warn(at, "unverified", `${profile.provider} is not connected, so this profile cannot serve yet.`);
            else if (!translator.enabled && profile.enabled) warn(`${at}.model`, "model_disabled", `${translator.label} is turned off for this host: turn it on under Settings, Providers, Generation.`);
            return;
          }
          return void error(`${at}.runtime`, "unknown_runtime", "Choose the agent runtime of this profile.");
        }
        const entry = snapshot.find((candidate) => candidate.runtimeId === profile.runtime);
        if (!entry) return void error(`${at}.runtime`, "unknown_runtime", `Unknown runtime '${profile.runtime}'`);
        if (profile.mode) {
          const mode = entry.modes.find((candidate) => candidate.id === profile.mode);
          if (!mode?.supported) error(`${at}.mode`, "mode_unsupported", `${entry.label} cannot run in this mode.`);
        }
        if ((profile.mode as string | undefined) === UNATTENDED_MODE_ID) error(`${at}.mode`, "unattended_default", "Unattended modes cannot be a default");
        if ((definition.group === "creative" || definition.group === "coordination") && entry.capabilities.jcTools === "none") {
          error(`${at}.runtime`, "CAPABILITY_MISMATCH", `${entry.label} cannot use editor tools, so it cannot serve this role.`);
        }
        // One agent has one options object per model, so two enabled profiles on one model must agree.
        const key = `${profile.runtime ?? ""}\n${profile.provider}\n${profile.model}`;
        const serialised = JSON.stringify(profile.params);
        if (profile.enabled) {
          if (paramsByModel.has(key) && paramsByModel.get(key) !== serialised) error(`${at}.params`, "params_conflict", "Two profiles of one agent cannot send different options to the same model — use one profile, or a different model alias");
          paramsByModel.set(key, serialised);
        }
        const model = entry.models.find((candidate) => candidate.providerId === profile.provider && candidate.modelId === profile.model);
        if (entry.status !== "ready") warn(at, "unverified", `${entry.label} is not ready, so this profile is not verified.`);
        else if (!model) warn(at, "unusable", "The model is not listed by this runtime.");
        else {
          if (profile.thinking && !model.thinkingOptions.some((option) => option.id === profile.thinking)) error(`${at}.thinking`, "thinking_unsupported", "This model does not offer that thinking option.");
          if (definition.needsImageInput && !model.input.includes("image")) error(`${at}.model`, "CAPABILITY_MISMATCH", "This role needs a model that accepts images.");
        }
      });
      if (role.defaultProfileId && !role.profiles.some((profile) => profile.id === role.defaultProfileId && profile.enabled)) {
        error(`${path}.defaultProfileId`, "unknown_profile", "The default profile must be an enabled profile of this role.");
      }
      if (role.profiles.length && !role.defaultProfileId) error(`${path}.defaultProfileId`, "missing_default", "Choose a default profile.");
      const allowed = new Set(["default", ...taskRoutesOf(definition)]);
      for (const [routeId, route] of Object.entries(role.routes)) {
        const at = `${path}.routes.${routeId}`;
        if (BUILTIN.has(roleId) ? !allowed.has(routeId) : routeId !== "default" && !/^[a-z][a-z0-9_]{1,23}$/.test(routeId)) error(at, "unknown_route", `'${routeId}' is not a route of this role.`);
        const targets = [route.primary, ...route.fallbacks];
        targets.forEach((target, index) => {
          if (!ids.has(target.profileId)) error(`${at}.${index === 0 ? "primary" : `fallbacks.${index - 1}`}.profileId`, "unknown_profile", `There is no profile '${target.profileId}' in this role.`);
        });
        if (new Set(targets.map((target) => target.profileId)).size !== targets.length) error(at, "duplicate_target", "A route names each profile once.");
        targets.forEach((target, index) => {
          // A target's options go to the model of the profile it names.
          const named = role.profiles.find((profile) => profile.id === target.profileId), { applied, model: sentTo } = named ? appliedFor(definition, named) : { applied: appliedOptions(definition.capability), model: undefined };
          for (const key of Object.keys((target as { params?: Record<string, unknown> }).params ?? {})) if (!applied.has(key)) warn(`${at}.${index === 0 ? "primary" : `fallbacks.${index - 1}`}.params.${key}`, "option_not_applied", `These options are not applied for this role: ${key} — ${notAppliedWhy(definition.capability, key, sentTo)}.`);
        });
      }
      if (!BUILTIN.has(roleId) && Object.keys(role.routes).filter((id) => id !== "default").length > 12) error(`${path}.routes`, "too_many_routes", "A custom role has at most 12 task routes.");
    }
    if (custom > MAX_CUSTOM_ROLES) error("roles", "too_many_roles", "You can add up to 20 custom roles.");
    return issues;
  }

  function overridesFor(kind: "session" | "project", id: string): Record<string, Override> {
    const rows = db.prepare("SELECT route, target FROM orc_overrides WHERE scope_kind = ? AND scope_id = ?").all(kind, id) as Array<{ route: string; target: string }>;
    return Object.fromEntries(rows.map((row) => [row.route, JSON.parse(row.target) as Override]));
  }

  /**
   * The ordered candidates for a role and route: an override of the run, the session or the project first, then the
   * route's primary and its fallbacks. Disabled and unusable profiles are left out, each with its reason.
   */
  function resolve(roleId: string, routeId = "default", context: { run?: Override; sessionKey?: string; projectId?: string } = {}): OrcResolution {
    const { config } = load();
    const snapshot = deps.snapshot();
    const result: OrcResolution = { roleId, routeId, candidates: [], skipped: [], warnings: [] };
    let effectiveRole = roleId;
    // A coordination role with no profile of its own resolves through the Director's routes.
    if (COORDINATION.has(roleId) && !(config.roles[roleId]?.profiles.length)) effectiveRole = "director";
    const definition = definitionOf(config, effectiveRole);
    const role: OrcRoleConfig | undefined = config.roles[effectiveRole];
    if (!config.enabled || !definition || !role || !role.enabled) return result;
    const profile = (id: string) => role.profiles.find((candidate) => candidate.id === id);
    const push = (target: Override, source: OrcTarget["source"]): boolean => {
      const found = profile(target.profileId);
      if (!found) return false;
      const reason = unusable(definition, found, snapshot);
      if (reason) {
        result.skipped.push({ profileId: found.id, reason });
        return false;
      }
      if (result.candidates.some((candidate) => candidate.profileId === found.id)) return true;
      result.candidates.push({
        profileId: found.id, ref: refOf(found), ...(target.thinking ?? found.thinking ? { thinking: target.thinking ?? found.thinking } : {}),
        ...(found.mode ? { mode: found.mode } : {}), params: { ...found.params, ...target.params }, source,
      });
      return true;
    };
    const keys = [`${roleId}.${routeId}`, roleId];
    const levels: Array<[OrcTarget["source"], Override | undefined]> = [
      ["run", context.run],
      ["session", context.sessionKey ? keys.map((key) => overridesFor("session", context.sessionKey!)[key]).find(Boolean) : undefined],
      ["project", context.projectId ? keys.map((key) => overridesFor("project", context.projectId!)[key]).find(Boolean) : undefined],
    ];
    for (const [source, override] of levels) {
      // An override naming a profile that is gone or unusable is ignored with a warning, and the next level decides.
      if (override && !push(override, source)) result.warnings.push("override_ignored");
    }
    const route = role.routes[routeId] ?? role.routes.default ?? (role.defaultProfileId ? { primary: { profileId: role.defaultProfileId }, fallbacks: [] } : undefined);
    if (route) for (const target of [route.primary, ...route.fallbacks]) push(target, "route");
    return result;
  }

  /**
   * What an admin could set for the roles that have no profile. The server suggests no model: every runtime is an agent
   * CLI the person chose to install, and choosing which one runs a role is theirs (the Built-in runtime this used to
   * suggest from is gone). Kept as a function so the answer's shape does not change.
   */
  function suggestions(_config: OrcConfig): Record<string, OrcProfile> {
    return {};
  }

  // Earlier versions stored such a proposal by themselves (`source: "auto"`). A model nobody chose is not kept as a
  // default: those profiles are removed once, with the routes that named them.
  {
    const { config, revision } = load();
    const roles = { ...config.roles };
    let cleared = 0;
    for (const [roleId, role] of Object.entries(roles)) {
      const kept = role.profiles.filter((profile) => profile.source !== "auto");
      if (kept.length === role.profiles.length) continue;
      cleared += role.profiles.length - kept.length;
      const ids = new Set(kept.map((profile) => profile.id));
      const routes = Object.fromEntries(Object.entries(role.routes ?? {}).flatMap(([routeId, route]) => (ids.has(route.primary.profileId) ? [[routeId, { ...route, fallbacks: route.fallbacks.filter((target) => ids.has(target.profileId)) }]] : [])));
      if (!kept.length && BUILTIN.has(roleId)) delete roles[roleId];
      else roles[roleId] = { ...role, profiles: kept, routes, ...(role.defaultProfileId && !ids.has(role.defaultProfileId) ? { defaultProfileId: kept[0]?.id } : {}) } as typeof role;
    }
    if (cleared) {
      store({ ...config, roles }, revision + 1);
      audit(db, deps.now(), "server", "orc.defaults.cleared", { revision: revision + 1, profiles: cleared });
    }
  }

  function describe() {
    const { config, revision } = load();
    const snapshot = deps.snapshot();
    const ids = [...ORC_BUILTIN_ROLES.map((role) => role.id), ...Object.keys(config.roles).filter((id) => !BUILTIN.has(id))];
    const roles = ids.map((id) => {
      const definition = definitionOf(config, id)!;
      const role = config.roles[id];
      const profiles = (role?.profiles ?? []).map((profile) => ({ id: profile.id, unusableReason: unusable(definition, profile, snapshot) }));
      const state = role && !role.enabled ? "disabled" : profiles.some((profile) => !profile.unusableReason) ? "ready"
        : COORDINATION.has(id) && resolve(id).candidates.length ? "ready" : "not_configured";
      return { ...definition, builtin: BUILTIN.has(id), state, taskRoutes: taskRoutesOf(definition), profiles };
    });
    // `suggested`: per role, the profile an admin could apply. Shown, never applied by the server.
    return { config, revision, roles, suggested: suggestions(config) };
  }

  function references(match: (profile: OrcProfile) => boolean): string[] {
    const { config } = load();
    return Object.entries(config.roles).flatMap(([roleId, role]) => role.profiles.filter(match).map((profile) => `orc:${roleId}.${profile.id}`));
  }

  async function commit(config: OrcConfig, revision: number, connection: Connection, action: string): Promise<{ config: OrcConfig; revision: number; issues: OrcIssue[]; projection: OrcProjection }> {
    const issues = validate(config, deps.snapshot());
    const errors = issues.filter((issue) => issue.level === "error");
    if (errors.length) throw new ProtocolError("VALIDATION_FAILED", errors[0].message, { details: { issues: errors } });
    store(config, revision);
    // A generation model an enabled profile names is in use from now on: it is turned on for the host.
    const catalogue = deps.generation?.();
    if (catalogue) for (const [roleId, role] of Object.entries(config.roles)) {
      const definition = definitionOf(config, roleId);
      if (!definition || !GENERATION_CHECKED.has(definition.capability) || !role.enabled) continue;
      const known = catalogue.models(definition.capability);
      for (const profile of role.profiles) if (profile.enabled && known.some((model) => model.provider === profile.provider && model.id === profile.model && !model.enabled)) catalogue.enable(profile.provider, profile.model);
    }
    audit(db, deps.now(), `device:${connection.deviceId}`, action, { revision });
    deps.broadcast("jagentchill.config.read", "jagentchill.orc.config.changed", "orc", { revision });
    // The routing is stored; it takes effect with the next session or turn that resolves a role.
    const projection: OrcProjection = await deps.project().then((applied) => (applied ? "applied" : "pending"), () => "failed");
    return { config, revision, issues: issues.filter((issue) => issue.level === "warning"), projection };
  }

  const methods = new Map<string, RpcMethod>();
  const add = (name: string, mutating: boolean, handle: RpcMethod["handle"]) => methods.set(name, {
    scope: ORC_METHOD_SCOPES[name],
    handle: (raw, connection) => {
      if (mutating) deps.mutations.hit(connection.deviceId);
      return handle(raw, connection);
    },
  });

  add("jagentchill.orc.config.get", false, () => describe());
  add("jagentchill.orc.config.update", true, (raw, connection) => {
    const params = parse(orcConfigUpdateParams, raw);
    const current = load();
    if (params.expectedRevision !== current.revision) throw new ProtocolError("CONFLICT", "Settings changed on another device", { details: { currentRevision: current.revision } });
    const roles = { ...current.config.roles };
    for (const [roleId, role] of Object.entries(params.patch.roles ?? {})) {
      const previous = roles[roleId];
      // A capability type is fixed when the role is created.
      if (previous?.capability && role.capability && role.capability !== previous.capability) throw new ProtocolError("CAPABILITY_MISMATCH", "The capability type of a role cannot be changed.", { details: { roleId } });
      roles[roleId] = { ...role, ...(previous?.capability ? { capability: previous.capability } : {}), profiles: role.profiles.map((profile) => ({ ...profile, source: profile.source ?? "user" })) };
    }
    for (const roleId of params.removeRoleIds ?? []) {
      if (BUILTIN.has(roleId)) throw new ProtocolError("ROLE_PROTECTED", "A built-in role cannot be deleted; it can be disabled.", { details: { roleId } });
      const used = db.prepare("SELECT scope_kind, scope_id FROM orc_overrides WHERE route = ? OR route LIKE ?").all(roleId, `${roleId}.%`) as Array<{ scope_kind: string; scope_id: string }>;
      if (used.length) throw new ProtocolError("ROLE_IN_USE", "This role is still used.", { details: { references: used.map((row) => `${row.scope_kind}:${row.scope_id}`) } });
      delete roles[roleId];
    }
    const { roles: _roles, ...flags } = params.patch;
    return commit({ ...current.config, ...flags, roles }, current.revision + 1, connection, "orc.config.update");
  });
  add("jagentchill.orc.config.validate", false, (raw) => {
    const parsed = orcConfigSchema.safeParse(parse(orcConfigValidateParams, raw).config);
    if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue): OrcIssue => ({ path: issue.path.join("."), code: "schema", message: issue.message, level: "error" })) };
    const issues = validate(parsed.data, deps.snapshot());
    return { valid: !issues.some((issue) => issue.level === "error"), issues };
  });
  // The document names providers and models and holds no secret, so the export is the document itself.
  add("jagentchill.orc.config.export", false, () => ({ document: { format: "jagentchill-orc", version: 1, config: load().config } }));
  add("jagentchill.orc.config.import", true, (raw, connection) => {
    const params = parse(orcConfigImportParams, raw);
    const current = load();
    if (params.expectedRevision !== current.revision) throw new ProtocolError("CONFLICT", "Settings changed on another device", { details: { currentRevision: current.revision } });
    const parsed = orcConfigSchema.safeParse(params.document.config);
    if (!parsed.success) throw new ProtocolError("VALIDATION_FAILED", "The file is not an ORC configuration.", { details: { issues: parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), code: "schema", message: issue.message, level: "error" })) } });
    return commit(parsed.data, current.revision + 1, connection, "orc.config.import");
  });
  add("jagentchill.orc.override.get", false, (raw, connection) => {
    const { scope } = parse(orcOverrideGetParams, raw);
    if (scope.kind === "session" && !deps.canActInSession(scope.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    return { overrides: overridesFor(scope.kind, scope.kind === "session" ? scope.sessionKey : scope.projectId) };
  });
  add("jagentchill.orc.override.set", true, (raw, connection) => {
    const params = parse(orcOverrideSetParams, raw);
    const id = params.scope.kind === "session" ? params.scope.sessionKey : params.scope.projectId;
    if (params.scope.kind === "session" && !deps.canActInSession(id, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    // Routing for a whole project is a project change.
    if (params.scope.kind === "project" && !connection.scopes().includes("jagentchill.projects.write")) {
      throw new ProtocolError("SCOPE_DENIED", "The device lacks the required scope.", { details: { requiredScope: "jagentchill.projects.write" } });
    }
    const [roleId] = params.route.split(".");
    const { config } = load();
    if (!definitionOf(config, roleId)) throw new ProtocolError("NOT_FOUND", "No such role.");
    if (params.target === null) {
      db.prepare("DELETE FROM orc_overrides WHERE scope_kind = ? AND scope_id = ? AND route = ?").run(params.scope.kind, id, params.route);
    } else {
      // An override can pick a profile and adjust it; it cannot add one.
      if (!config.roles[roleId]?.profiles.some((profile) => profile.id === params.target!.profileId)) throw new ProtocolError("INVALID_PARAMS", "The role has no such profile.", { details: { path: "target.profileId" } });
      db.prepare("INSERT INTO orc_overrides (scope_kind, scope_id, route, target) VALUES (?, ?, ?, ?) ON CONFLICT(scope_kind, scope_id, route) DO UPDATE SET target = excluded.target")
        .run(params.scope.kind, id, params.route, JSON.stringify(params.target));
    }
    audit(db, deps.now(), `device:${connection.deviceId}`, "orc.override.set", { scope: params.scope, route: params.route, profileId: params.target?.profileId ?? null });
    return { overrides: overridesFor(params.scope.kind, id) };
  });
  add("jagentchill.orc.readiness.check", false, (raw) => {
    const wanted = parse(orcReadinessParams, raw).roles;
    const described = describe();
    return { enabled: described.config.enabled, roles: described.roles.filter((role) => !wanted || wanted.includes(role.id)).map((role) => ({ roleId: role.id, state: role.state, required: role.id === "director" })) };
  });

  /**
   * The route of a role as a step the server makes itself walks it: every candidate that can serve now, IN ORDER
   * (primary, then fallbacks), each with its profile whole (thinking — null: the model's own default —, the mode or
   * the runtime's default one, the options), and the failure classes that move on to the next candidate.
   * `configured` false: the role has no profile (the caller's own default applies).
   */
  function route(roleId: string, routeId = "default") {
    const { config } = load(), own = config.roles[roleId];
    if (!config.enabled || !own?.profiles.length) return { configured: false as const, candidates: [], fallbackOn: [...ORC_DEFAULT_FALLBACK_ON] as string[] };
    const resolution = resolve(roleId, routeId), snapshot = deps.snapshot(), chosen = own.routes[routeId] ?? own.routes.default;
    return {
      configured: true as const,
      candidates: resolution.candidates.map((target) => { const mode = target.mode ?? snapshot.find((entry) => entry.runtimeId === target.ref.runtimeId)?.defaultModeId; return { ...target.ref, thinking: target.thinking ?? null, ...(mode ? { mode } : {}), params: target.params, profileId: target.profileId }; }),
      fallbackOn: [...(chosen?.fallbackOn ?? ORC_DEFAULT_FALLBACK_ON)] as string[],
      ...(!resolution.candidates.length ? { reason: !own.enabled ? "the role is turned off" : resolution.skipped[0]?.reason ?? "no profile can serve" } : {}),
    };
  }

  return {
    methods,
    load,
    resolve,
    route,
    validate,
    /** Profiles that name a runtime or an endpoint, so neither is removed from under them. */
    referencesToRuntime: (runtimeId: string) => references((profile) => profile.runtime === runtimeId),
    referencesToProvider: (providerId: string) => references((profile) => profile.provider === providerId),
  };
}

export type OrcService = ReturnType<typeof createOrcService>;
