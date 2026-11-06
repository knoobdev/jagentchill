import { z } from "zod";

/**
 * The script document of `script-studio.Script document`: the canonical JSON form, its parts, the version and audit
 * records kept beside it, and the native file. The model code that edits it lives in `packages/editor-core`.
 */
export const SCRIPT_FORMAT = "jagentchill.script";
export const SCRIPT_FILE_FORMAT = "jagentchill.script.file";
export const SCRIPT_SCHEMA_VERSION = 1;

export const SCRIPT_LINE_KINDS = ["action", "dialogue", "narration", "on_screen_text", "visual_note", "sound_note", "transition"] as const;
export type ScriptLineKind = (typeof SCRIPT_LINE_KINDS)[number];
export const SCRIPT_GENRES = ["drama", "comedy", "action", "thriller", "horror", "romance", "science-fiction", "fantasy", "documentary", "educational", "commercial", "lifestyle", "news", "music", "other"] as const;
export const SCRIPT_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3", "3:4", "21:9"] as const;
export type ScriptAspectRatio = (typeof SCRIPT_ASPECT_RATIOS)[number];
export const SCRIPT_PACES = { slow: 0.85, normal: 1, fast: 1.15 } as const;
export type ScriptPace = keyof typeof SCRIPT_PACES;
export const SCRIPT_SETTINGS = ["INT", "EXT", "INT_EXT", "NONE"] as const;
export const SHOT_SIZES = ["extreme-wide", "wide", "medium", "close-up", "extreme-close-up", "insert"] as const;
export const SHOT_ANGLES = ["eye-level", "high", "low", "overhead", "dutch", "over-the-shoulder", "pov"] as const;
export const SHOT_MOVEMENTS = ["static", "pan", "tilt", "push-in", "pull-out", "track", "handheld", "orbit"] as const;
export const SHOT_SOURCES = ["auto", "generate-video", "generate-image", "stock", "library", "title-card"] as const;
export const SCRIPT_STATUSES = ["draft", "in_review", "changes_requested", "approved", "locked"] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];
/** Spoken and described text is 0–4,000 characters; notes, transitions and on-screen text are shorter. */
export const SCRIPT_LINE_TEXT_MAX: Record<ScriptLineKind, number> = { action: 4000, dialogue: 4000, narration: 4000, on_screen_text: 200, visual_note: 600, sound_note: 600, transition: 600 };
export const SHOT_DURATION_TICKS = { min: 60_000, max: 14_400_000 } as const;
export const SCRIPT_TARGET_DURATION_S = { min: 5, max: 10_800 } as const;

/** 16 random bytes, base64url: the id of every act, scene, beat, line and shot (and of the script itself). */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number, min = 0) => z.string().min(min).max(max);
const ms = z.number().int().nonnegative();
const ticks = z.number().int().nonnegative();
const colorIndex = z.number().int().min(1).max(8);

export const scriptLineSchema = z.object({
  id, kind: z.enum(SCRIPT_LINE_KINDS), text: text(4000),
  characterId: id.optional(), speakerText: text(60).optional(), parenthetical: text(120).optional(), dual: z.boolean().optional(),
  language: text(35, 2).optional(), needsCheck: z.boolean().optional(),
  sourceRef: z.object({ mediaId: id, start_ticks: ticks, end_ticks: ticks }).optional(), sourceId: id.optional(),
}).superRefine((line, ctx) => {
  if (line.text.length > SCRIPT_LINE_TEXT_MAX[line.kind]) ctx.addIssue({ code: "too_big", type: "string", maximum: SCRIPT_LINE_TEXT_MAX[line.kind], inclusive: true, path: ["text"], message: `a ${line.kind} line holds at most ${SCRIPT_LINE_TEXT_MAX[line.kind]} characters` });
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

export const scriptBeatSchema = z.object({ id, label: text(60), intent: text(300), lines: z.array(scriptLineSchema), sourceId: id.optional() });
export type ScriptBeat = z.infer<typeof scriptBeatSchema>;

export const scriptShotSchema = z.object({
  id, beatId: id.optional(), lineIds: z.array(id).max(40), description: text(800),
  size: z.enum(SHOT_SIZES), angle: z.enum(SHOT_ANGLES), movement: z.enum(SHOT_MOVEMENTS),
  durationOverride_ticks: z.number().int().min(SHOT_DURATION_TICKS.min).max(SHOT_DURATION_TICKS.max).optional(),
  characterIds: z.array(id).max(6), locationId: id.optional(), propIds: z.array(id).max(8),
  references: z.array(z.object({ kind: z.enum(["media", "hub_asset", "url"]), id: id.optional(), url: text(2000).optional(), note: text(120) })).max(8),
  onScreenText: text(120), transitionOut: text(64, 1), source: z.enum(SHOT_SOURCES), notes: text(600), sourceId: id.optional(),
});
export type ScriptShot = z.infer<typeof scriptShotSchema>;

export const scriptSceneSchema = z.object({
  id, actId: id.optional(),
  heading: z.object({ setting: z.enum(SCRIPT_SETTINGS), locationId: id.optional(), locationText: text(120), timeOfDay: text(40) }),
  title: text(80), summary: text(500), beats: z.array(scriptBeatSchema).min(1), shots: z.array(scriptShotSchema),
  durationOverride_ticks: ticks.optional(), colorIndex: colorIndex.optional(), omitted: z.boolean(), sourceId: id.optional(),
});
export type ScriptScene = z.infer<typeof scriptSceneSchema>;

export const scriptActSchema = z.object({ id, title: text(80), summary: text(500) });
export type ScriptAct = z.infer<typeof scriptActSchema>;

export const scriptEntitySchema = z.object({
  id, name: text(60, 1), aliases: z.array(text(60, 1)).max(10), description: text(600), colorIndex,
  hubAssetId: id.optional(), filmAssetId: id.optional(), voiceId: text(128, 1).optional(),
});
export type ScriptEntity = z.infer<typeof scriptEntitySchema>;
export const SCRIPT_ENTITY_KINDS = ["characters", "locations", "props"] as const;
export type ScriptEntityKind = (typeof SCRIPT_ENTITY_KINDS)[number];

export const scriptMetaSchema = z.object({
  logline: text(300), synopsis: text(4000), genre: z.array(z.enum(SCRIPT_GENRES)).max(3), tone: text(200), audience: text(200),
  language: text(35, 2), targetDuration_s: z.number().min(SCRIPT_TARGET_DURATION_S.min).max(SCRIPT_TARGET_DURATION_S.max).optional(),
  aspectRatio: z.enum(SCRIPT_ASPECT_RATIOS), formatId: text(64, 1), pace: z.enum(["slow", "normal", "fast"]),
  author: text(120), notes: text(4000), tags: z.array(text(24, 1)).max(10),
});
export type ScriptMeta = z.infer<typeof scriptMetaSchema>;

export const scriptConstraintsSchema = z.object({
  tone: text(200).optional(), voice: z.object({ person: z.enum(["first", "second", "third", "brand"]), text: text(500).optional() }).optional(),
  readingLevel: z.enum(["simple", "general", "expert"]).optional(),
  targetDuration_s: z.number().min(SCRIPT_TARGET_DURATION_S.min).max(SCRIPT_TARGET_DURATION_S.max).optional(), tolerance: z.number().min(0).max(1).optional(),
  maxScenes: z.number().int().min(1).max(500).optional(), maxShots: z.number().int().min(1).max(2000).optional(), maxCharacters: z.number().int().min(1).max(200).optional(),
  lineMaxChars: z.number().int().min(40).max(400).optional(),
  mustInclude: z.array(text(200, 1)).max(20).optional(), mustAvoid: z.array(text(200, 1)).max(50).optional(), bannedTopics: z.array(text(200, 1)).max(20).optional(),
  contentRating: z.enum(["general", "teen", "mature"]).optional(), claimsPolicy: z.enum(["sources-only", "flag"]).optional(),
  languageVariant: text(35).optional(), captionSafe: z.boolean().optional(), styleSampleIds: z.array(id).max(20).optional(),
});
export type ScriptConstraints = z.infer<typeof scriptConstraintsSchema>;

/** The script-level approval policy: the subject level of `multi-agent-orchestration.Common approval policy`. */
export const scriptApprovalPolicySchema = z.object({ mode: z.enum(["human", "agent", "auto"]) }).passthrough();
export type ScriptApprovalPolicy = z.infer<typeof scriptApprovalPolicySchema>;

export const scriptDocumentSchema = z.object({
  format: z.literal(SCRIPT_FORMAT), schemaVersion: z.literal(SCRIPT_SCHEMA_VERSION), id, title: text(120, 1),
  meta: scriptMetaSchema, status: z.enum(SCRIPT_STATUSES), approvalPolicy: scriptApprovalPolicySchema.optional(),
  acts: z.array(scriptActSchema), scenes: z.array(scriptSceneSchema),
  entities: z.object({ characters: z.array(scriptEntitySchema), locations: z.array(scriptEntitySchema), props: z.array(scriptEntitySchema) }),
  constraints: scriptConstraintsSchema.optional(),
  links: z.object({
    projectIds: z.array(z.string().min(1).max(64)).max(20), filmLink: z.object({ filmId: id, episodeId: id }).optional(),
    workflowLink: z.object({ runId: id, nodeId: id }).optional(), translationOf: z.object({ scriptId: id, versionId: id }).optional(),
  }),
  headVersionId: id, approvedVersionId: id.optional(), revision: z.number().int().nonnegative(),
  createdBy: text(128), created_ms: ms, updated_ms: ms,
});
export type ScriptDocument = z.infer<typeof scriptDocumentSchema>;

export const scriptVersionAuthorSchema = z.object({
  kind: z.enum(["user", "agent", "import", "workflow"]), deviceId: text(128).optional(), deviceName: text(128).optional(),
  agentId: text(128).optional(), sessionKey: text(256).optional(), runId: text(128).optional(), model: text(128).optional(), fileName: text(255).optional(),
});
export type ScriptVersionAuthor = z.infer<typeof scriptVersionAuthorSchema>;
export const scriptVersionSchema = z.object({
  versionId: id, number: z.number().int().positive(), parentVersionId: id.nullable(), author: scriptVersionAuthorSchema,
  label: text(80, 1).optional(), summary: text(300), contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  stats: z.object({ scenes: z.number().int(), lines: z.number().int(), shots: z.number().int(), words: z.number().int(), estimatedDuration_ticks: ticks }),
  created_ms: ms, pinned: z.boolean(),
  /** Why a version exists without a name: these are the "automatic" versions of the retention rule. */
  automatic: z.boolean().optional(),
  /** Content addressing: one hash per scene, in order, and one for everything that is not a scene. */
  sceneHashes: z.array(z.string()), restHash: z.string(),
});
export type ScriptVersion = z.infer<typeof scriptVersionSchema>;

export const scriptAuditEntrySchema = z.object({
  id, at_ms: ms, actor: z.object({ kind: z.enum(["device", "agent", "workflow", "automation", "auto"]), id: text(128), name: text(128) }),
  action: text(64, 1), versionId: id.optional(), reviewId: id.optional(), details: z.record(z.unknown()).optional(),
});
export type ScriptAuditEntry = z.infer<typeof scriptAuditEntrySchema>;

export const scriptCommentSchema = z.object({
  commentId: id, scriptId: id,
  anchor: z.object({ target: z.enum(["script", "scene", "beat", "line", "shot"]), id, range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(), versionId: id }),
  body: text(2000, 1), author: z.object({ kind: z.enum(["device", "agent"]), id: text(128), name: text(128) }),
  kind: z.enum(["note", "suggestion", "review_finding"]), suggestion: z.object({ text: text(4000) }).optional(), severity: z.enum(["must_fix", "suggestion"]).optional(),
  created_ms: ms, edited_ms: ms.optional(), resolved: z.boolean(), parentId: id.optional(),
  /** The anchored text when the comment was written: shown for "Text changed since this comment" and for detached comments. */
  quote: text(4000).optional(),
});
export type ScriptComment = z.infer<typeof scriptCommentSchema>;

/** The native file `.jcscript`. `history` carries the versions when `versions` is "all". */
export const scriptFileSchema = z.object({
  format: z.literal(SCRIPT_FILE_FORMAT), version: z.literal(1), script: scriptDocumentSchema,
  versions: z.enum(["head", "all"]).optional(), comments: z.array(scriptCommentSchema).optional(),
  history: z.object({ versions: z.array(scriptVersionSchema), blobs: z.record(z.unknown()) }).optional(),
  audit: z.array(scriptAuditEntrySchema).optional(),
});
export type ScriptFile = z.infer<typeof scriptFileSchema>;

/** The domain error codes of `script-studio.Script error codes`. */
export const SCRIPT_ERROR_CODES = [
  "SCRIPT_SCHEMA_INVALID", "SCRIPT_LINE_INVALID", "SCRIPT_LIMIT_EXCEEDED", "SCRIPT_IMPORT_UNSUPPORTED", "SCRIPT_IMPORT_INVALID", "SCRIPT_EXPORT_UNSUPPORTED",
  "SCRIPT_VERSION_CONFLICT", "SCRIPT_READ_ONLY", "SCRIPT_LOCKED", "SCRIPT_NOT_APPROVED", "SCRIPT_PROPOSAL_LIMIT", "SCRIPT_PROPOSAL_STALE", "SCRIPT_SCOPE_VIOLATION",
  "SCRIPT_CONSTRAINT_VIOLATION", "SCRIPT_DURATION_MISMATCH", "SCRIPT_APPROVAL_FORBIDDEN", "SCRIPT_POLICY_LOCKED", "SCRIPT_REVIEW_NOT_PENDING", "SCRIPT_GENERATION_REFUSED", "SCRIPT_NOT_SYNCED",
] as const;
export type ScriptErrorCode = (typeof SCRIPT_ERROR_CODES)[number];
