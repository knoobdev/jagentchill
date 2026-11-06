import { z } from "zod";
import type { Scope } from "./roles.ts";

/** Codes of the skill domain. */
export const SKILL_ERROR_CODES = [
  "skill/name-conflict", "skill/not-found", "skill/not-owned", "skill/confirmation-required", "skill/invalid", "skill/too-large", "skill/path-not-allowed",
  "skill/source-fetch-failed", "skill/catalogue-item-not-found", "skill/source-not-found", "skill/blocked", "skill/content-changed", "skill/not-available",
  "skill/too-many", "skill/in-use",
] as const;

export const SKILL_LIMITS = {
  perTurn: 8, perSession: 64, installed: 200, folderBytes: 20 * 1024 * 1024, folderFiles: 2000, skillMdBytes: 256 * 1024, description: 1024, name: 64,
  lessons: 50, lessonChars: 500, sources: 20, pinnedPerDevice: 16, concurrentInstalls: 3, listingTimeoutMs: 15_000, backupDays: 30, body: 200_000,
} as const;

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const skillNameSchema = z.string().min(1).max(SKILL_LIMITS.name).regex(SKILL_NAME_PATTERN);
const skillRef = z.string().min(1).max(200);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const SKILL_SOURCE_KINDS = ["clawhub", "git", "local"] as const;
export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];
/** A place skills are installed from. `npm` and device uploads are not offered by this build. */
export const skillSourceSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1).max(64).optional(), kind: z.literal("clawhub"), label: z.string().trim().min(1).max(80), enabled: z.boolean() }).strict(),
  z.object({
    id: z.string().min(1).max(64).optional(), kind: z.literal("git"), label: z.string().trim().min(1).max(80), enabled: z.boolean(),
    url: z.string().max(500), ref: z.string().min(1).max(200).optional(), subPath: z.string().min(1).max(300).optional(),
  }).strict(),
  z.object({ id: z.string().min(1).max(64).optional(), kind: z.literal("local"), label: z.string().trim().min(1).max(80), enabled: z.boolean(), path: z.string().min(1).max(1024) }).strict(),
]);
export type SkillSourceInput = z.infer<typeof skillSourceSchema>;
export type SkillSource = SkillSourceInput & { id: string; state: "ready" | "refreshing" | "error" | "disabled"; itemCount?: number; error?: string };

export type SkillRecord = {
  skillId: string; name: string; description: string; version?: string;
  scope: "bundled" | "global"; root: "bundled" | "managed" | "extra" | "user-agents";
  /** The folder on the host; `null` for every role but `admin`. */
  realPath: string | null;
  links: Array<{ runtimeId: string; path: string; kind: "symlink" | "copy" }>;
  visibleTo: string[]; owned: boolean; bundled: boolean; enabled: boolean; pinned: boolean; pinnedRevision?: string;
  status: "ok" | "invalid"; invalidReason?: string;
  source: { kind: "bundled" | SkillSourceKind | "authored" | "fork" | "host"; sourceId?: string; ref?: string; revision?: string; removed?: boolean };
  hasScripts: boolean; fileCount: number; sizeBytes: number; contentHash: string; familyId: string; modifiedLocally: boolean;
  updateAvailable?: { version?: string; revision: string }; canRollBack: boolean; trustSource: boolean;
  training?: { status: "training" | "graduated"; lessons: number; uses: number; consecutiveCleanUses: number };
  installed_ms?: number; updated_ms?: number; installedByDeviceId?: string;
};
export type SkillLesson = { lessonId: string; text: string; date: string };
export type SkillFile = { path: string; sizeBytes: number; script: boolean };
/** What the detail view and the trust prompt read: the folder's `SKILL.md` and its file list. */
export type SkillCard = { name: string; description: string; version?: string; markdown: string; files: SkillFile[]; hasScripts: boolean; fileCount: number; sizeBytes: number; contentHash: string; lessons: SkillLesson[] };
export type SkillCatalogueItem = {
  itemId: string; sourceId: string; sourceLabel: string; sourceKind: SkillSourceKind; name: string; description: string; version?: string; revision?: string; author?: string;
  hasScripts?: boolean; installed?: { skillId: string; version?: string }; updateAvailable: boolean; reference: string;
};

export const skillListParams = z.object({ sessionKey: z.string().min(1).max(200).optional(), agentId: z.string().min(1).max(64).optional() }).strict();
export const skillIdParams = z.object({ skillId: skillRef }).strict();
export const skillCatalogueListParams = z.object({
  sourceIds: z.array(z.string().min(1).max(64)).max(20).optional(), query: z.string().max(200).optional(), cursor: z.string().max(40).optional(), limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const skillCatalogueGetParams = z.object({ itemId: z.string().min(1).max(600) }).strict();
export const skillInstallParams = z.object({
  itemId: z.string().min(1).max(600), scope: z.literal("global").default("global"), rename: skillNameSchema.optional(), confirmedContentHash: hash,
  trustSource: z.boolean().optional(), idempotencyKey: z.string().min(1).max(128),
}).strict();
export const skillUpdateCheckParams = z.object({ skillIds: z.array(skillRef).max(200).optional() }).strict();
export const skillUpdateApplyParams = z.object({ skillId: skillRef, revision: z.string().min(1).max(200).optional(), confirmedContentHash: hash, onModified: z.enum(["fork", "overwrite"]).optional() }).strict();
export const skillPinParams = z.object({ skillId: skillRef, pinned: z.boolean(), revision: z.string().min(1).max(200).optional() }).strict();
export const skillTrustParams = z.object({ skillId: skillRef, trustSource: z.boolean() }).strict();
export const skillRemoveParams = z.object({ skillId: skillRef, confirm: z.boolean().optional() }).strict();
export const skillEnabledParams = z.object({ skillId: skillRef, enabled: z.boolean() }).strict();
export const skillRestoreParams = z.object({ backupId: z.string().min(1).max(200) }).strict();
export const skillInvocationParams = z.object({ sessionKey: z.string().min(1).max(200), skillIds: z.array(skillRef).max(32) }).strict();
export const skillAuthorParams = z.object({
  skillId: skillRef.optional(), name: skillNameSchema, description: z.string().trim().min(1).max(SKILL_LIMITS.description), body: z.string().min(1).max(SKILL_LIMITS.body),
  scope: z.literal("global").default("global"), expectedContentHash: hash.optional(),
}).strict();
export const skillForkParams = z.object({ skillId: skillRef, name: skillNameSchema.optional() }).strict();
export const skillRenameParams = z.object({ skillId: skillRef, name: skillNameSchema }).strict();
export const skillLearnParams = z.object({ skillId: skillRef, lesson: z.string().trim().min(1).max(SKILL_LIMITS.lessonChars).regex(/^[^\n\r]+$/), approved: z.boolean(), sessionKey: z.string().min(1).max(200).optional() }).strict();
export const skillLessonUpdateParams = z.union([
  z.object({ skillId: skillRef, lessonId: z.string().min(1).max(40), text: z.string().trim().min(1).max(SKILL_LIMITS.lessonChars).regex(/^[^\n\r]+$/) }).strict(),
  z.object({ skillId: skillRef, lessonId: z.string().min(1).max(40), delete: z.literal(true) }).strict(),
]);
export const skillSourceIdParams = z.object({ id: z.string().min(1).max(64) }).strict();
export const skillSourceUpsertParams = z.object({ source: skillSourceSchema }).strict();
export const sessionSkillsGetParams = z.object({ sessionKey: z.string().min(1).max(200) }).strict();
export const sessionSkillsSetParams = z.object({ sessionKey: z.string().min(1).max(200), skillIds: z.array(skillRef).max(32) }).strict();

const read: Scope = "jagentchill.config.read", write: Scope = "jagentchill.config.write", use: Scope = "jagentchill.agent.use";
/**
 * The skill domain: every method this build serves, with its scope. Of the surface the specification names, `link.set`
 * is absent (it writes links into the native skill directories of ACP runtimes). `catalogue.get` also answers for an
 * installed skill, with the item id `installed:<skillId>`.
 */
export const SKILL_METHOD_SCOPES = {
  "jagentchill.skill.list": read, "jagentchill.skill.source.list": read, "jagentchill.skill.source.upsert": write, "jagentchill.skill.source.remove": write,
  "jagentchill.skill.source.refresh": write, "jagentchill.skill.catalogue.get": read, "jagentchill.skill.catalogue.list": read, "jagentchill.skill.install": write,
  "jagentchill.skill.update.apply": write, "jagentchill.skill.update.check": read, "jagentchill.skill.rollback": write, "jagentchill.skill.trust.set": write,
  "jagentchill.skill.pin.set": write, "jagentchill.skill.remove": write, "jagentchill.skill.setEnabled": write, "jagentchill.skill.removed.list": read,
  "jagentchill.skill.restore": write, "jagentchill.skill.invocation.build": use, "jagentchill.skill.author": write, "jagentchill.skill.fork": write,
  "jagentchill.skill.rename": write, "jagentchill.skill.learn": write, "jagentchill.skill.lesson.update": write, "jagentchill.skill.export": use,
  "jagentchill.skill.subscribe": "jagentchill.projects.read", "jagentchill.skill.unsubscribe": "jagentchill.projects.read",
  "jagentchill.session.skills.get": use, "jagentchill.session.skills.set": use,
} as const satisfies Record<string, Scope>;
