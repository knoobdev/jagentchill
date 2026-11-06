import { z } from "zod";
import { PRODUCT_MODES } from "./agent-runtimes.ts";
import type { Scope } from "./roles.ts";

/** Domain error codes of ORC. */
export const ORC_ERROR_CODES = ["VALIDATION_FAILED", "ROLE_PROTECTED", "ROLE_IN_USE", "CAPABILITY_MISMATCH"] as const;

export const ORC_CAPABILITY_TYPES = ["llm", "image", "video", "tts", "transcription", "music", "sfx", "voice-design", "lipsync", "translation"] as const;
export type OrcCapabilityType = (typeof ORC_CAPABILITY_TYPES)[number];

export type OrcRoleDefinition = { id: string; label: string; description: string; capability: OrcCapabilityType; group: "coordination" | "creative" | "understanding" | "generation"; needsImageInput?: boolean };

/** The built-in roles. Each is bound to one capability type that cannot be changed. */
export const ORC_BUILTIN_ROLES: readonly OrcRoleDefinition[] = [
  { id: "supervisor", label: "Supervisor", description: "Owns a team run's brief and acceptance.", capability: "llm", group: "coordination" },
  { id: "lead", label: "Lead", description: "Plans, staffs and integrates a team run.", capability: "llm", group: "coordination" },
  { id: "peer", label: "Peer", description: "A worker with no more specific creative role.", capability: "llm", group: "coordination" },
  { id: "director", label: "Director", description: "Leads the creative work on a video.", capability: "llm", group: "creative" },
  { id: "screenwriter", label: "Screenwriter", description: "Writes scripts and dialogue.", capability: "llm", group: "creative" },
  { id: "storyboard", label: "Storyboard", description: "Breaks a script into shots and panels.", capability: "llm", group: "creative" },
  { id: "editor", label: "Editor", description: "Edits the timeline.", capability: "llm", group: "creative" },
  { id: "reviewer", label: "Reviewer", description: "Reviews results against the brief.", capability: "llm", group: "creative" },
  { id: "vision", label: "Vision", description: "Understands images and frames.", capability: "llm", group: "understanding", needsImageInput: true },
  { id: "translation", label: "Translation", description: "Translates text and subtitles.", capability: "llm", group: "understanding" },
  { id: "transcription", label: "Transcription", description: "Turns speech into text.", capability: "transcription", group: "understanding" },
  { id: "image", label: "Image", description: "Generates and edits images.", capability: "image", group: "generation" },
  { id: "video", label: "Video", description: "Generates video clips.", capability: "video", group: "generation" },
  { id: "voice-tts", label: "Voice", description: "Speaks text.", capability: "tts", group: "generation" },
  { id: "voice-design", label: "Voice design", description: "Designs and converts voices.", capability: "voice-design", group: "generation" },
  { id: "music", label: "Music", description: "Finds or generates music.", capability: "music", group: "generation" },
  { id: "sfx", label: "Sound effects", description: "Finds or generates sound effects.", capability: "sfx", group: "generation" },
  { id: "lipsync", label: "Lip-sync", description: "Syncs lips to speech.", capability: "lipsync", group: "generation" },
];

/** Task route ids every llm role has besides `default`. */
export const ORC_LLM_TASK_ROUTES = ["quick", "planning", "script", "edit", "search", "research", "audit", "ui"] as const;
export const ORC_ROLE_TASK_ROUTES: Record<string, readonly string[]> = {
  image: ["image.character", "image.location", "image.prop", "image.panel", "image.edit", "image.inpaint", "image.expand", "image.upscale", "image.restyle"],
  video: ["video.text", "video.image", "video.first_last_frame", "video.reference", "video.inpaint", "video.upscale", "video.restyle"],
  "voice-tts": ["voice-tts.narration", "voice-tts.dialogue", "voice-tts.conversation"],
  "voice-design": ["voice-design.convert"],
  lipsync: ["lipsync.avatar"],
  transcription: ["transcription.realtime"],
};

export const ORC_FALLBACK_TRIGGERS = [
  "auth_error", "rate_limited", "quota_exhausted", "timeout", "server_error", "network", "model_unavailable", "capability_mismatch",
  "invalid_output", "unknown", "content_blocked",
] as const;
export const ORC_DEFAULT_FALLBACK_ON = ORC_FALLBACK_TRIGGERS.filter((trigger) => trigger !== "content_blocked");

const roleId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
const profileId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const params = z.record(z.string().max(60), z.unknown());

export const orcProfileSchema = z.object({
  id: profileId,
  label: z.string().min(1).max(60).optional(),
  runtime: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  thinking: z.string().min(1).max(24).optional(),
  mode: z.enum(PRODUCT_MODES).optional(),
  params: params.default({}),
  enabled: z.boolean().default(true),
  source: z.enum(["auto", "user"]).optional(),
}).strict();
export type OrcProfile = z.infer<typeof orcProfileSchema>;

const routeTarget = z.object({ profileId, thinking: z.string().min(1).max(24).optional(), params: params.optional() }).strict();
export const orcRouteSchema = z.object({
  primary: routeTarget,
  fallbacks: z.array(routeTarget).max(5).default([]),
  fallbackOn: z.array(z.enum(ORC_FALLBACK_TRIGGERS)).optional(),
  instructions: z.string().max(4000).optional(),
}).strict();
export type OrcRoute = z.infer<typeof orcRouteSchema>;

export const orcRoleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
  /** Set once, at creation, for a custom role. */
  capability: z.enum(ORC_CAPABILITY_TYPES).optional(),
  instructions: z.string().max(8000).optional(),
  profiles: z.array(orcProfileSchema).max(12).default([]),
  defaultProfileId: profileId.optional(),
  routes: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{1,39}$/), orcRouteSchema).default({}),
  limits: z.record(z.string().max(40), z.number()).default({}),
}).strict();
export type OrcRoleConfig = z.infer<typeof orcRoleConfigSchema>;

export const orcConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  autoPrepareBrief: z.boolean(),
  askWhenAmbiguous: z.boolean(),
  roles: z.record(roleId, orcRoleConfigSchema),
}).strict();
export type OrcConfig = z.infer<typeof orcConfigSchema>;

export const orcConfigUpdateParams = z.object({
  patch: z.object({
    enabled: z.boolean().optional(),
    autoPrepareBrief: z.boolean().optional(),
    askWhenAmbiguous: z.boolean().optional(),
    roles: z.record(roleId, orcRoleConfigSchema).optional(),
  }).strict(),
  removeRoleIds: z.array(roleId).max(64).optional(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export const orcConfigValidateParams = z.object({ config: z.unknown() }).strict();
export const orcConfigImportParams = z.object({
  document: z.object({ format: z.literal("jagentchill-orc"), version: z.literal(1), config: z.unknown() }).strict(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

const overrideTarget = z.object({ profileId, thinking: z.string().min(1).max(24).optional(), params: params.optional() }).strict();
const overrideScope = z.union([
  z.object({ kind: z.literal("session"), sessionKey: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("project"), projectId: z.string().min(1).max(64) }).strict(),
]);
export const orcOverrideGetParams = z.object({ scope: overrideScope }).strict();
export const orcOverrideSetParams = z.object({
  scope: overrideScope,
  /** `<roleId>` or `<roleId>.<routeId>`. */
  route: z.string().min(2).max(80),
  target: overrideTarget.nullable(),
}).strict();
export const orcReadinessParams = z.object({ roles: z.array(roleId).max(40).optional() }).strict();

export type OrcIssue = { path: string; code: string; message: string; level: "error" | "warning" };
export type OrcProjection = "applied" | "pending" | "failed";

export const ORC_METHOD_SCOPES: Record<string, Scope> = {
  "jagentchill.orc.config.get": "jagentchill.config.read",
  "jagentchill.orc.config.update": "jagentchill.config.write",
  "jagentchill.orc.config.validate": "jagentchill.config.read",
  "jagentchill.orc.config.export": "jagentchill.config.write",
  "jagentchill.orc.config.import": "jagentchill.config.write",
  "jagentchill.orc.override.get": "jagentchill.config.read",
  "jagentchill.orc.override.set": "jagentchill.agent.use",
  "jagentchill.orc.readiness.check": "jagentchill.config.read",
};
