import type { ScriptAuditEntry, ScriptComment, ScriptDocument, ScriptScene, ScriptVersion, ScriptVersionAuthor } from "@jagentchill/protocol";
import { canonicalJson } from "../canonical.ts";
import { sha256, toHex, utf8 } from "../sha256.ts";
import { contentOf, executeScript, replaceContent, type ScriptContent, type ScriptEnv } from "./commands.ts";
import { estimateStats, formatClock } from "./estimate.ts";
import { clone, findBeat, findLine, findScene, findShot, ScriptError, type ScriptIds } from "./model.ts";

export type { ScriptVersion, ScriptVersionAuthor };

/** One decision of a review, by a person or by the automatic policy. Immutable once written. */
export type ScriptReviewRecord = {
  reviewId: string; round: number; scriptId: string; versionId: string; policy: { mode: "human" | "auto"; source: "script" | "default" };
  reviewer: { kind: "device" | "auto"; deviceId?: string; deviceName?: string };
  decision: "approve" | "request_changes" | "reject"; summary: string; started_ms: number; decided_ms: number;
  /** The review was opened by "Review this version" on an approved version: a negative decision revokes that approval. */
  reReview?: boolean; edited?: boolean;
};
/** What a script keeps beside its head on a device: versions (content addressed per scene), reviews, comments and the audit trail. */
export type ScriptHistoryStore = {
  blobs: Record<string, unknown>; versions: ScriptVersion[]; audit: ScriptAuditEntry[]; comments: ScriptComment[]; reviews: ScriptReviewRecord[];
  /** The review waiting for a decision. */
  openReview?: { reviewId: string; round: number; versionId: string; started_ms: number; submitter: { id: string; name: string }; reReview?: boolean };
  /** Versions whose approval was revoked by a later review. */
  revoked: string[];
  /** Versions a timeline link refers to: never removed. */
  linked: string[];
  notice?: string;
};
export const emptyHistory = (): ScriptHistoryStore => ({ blobs: {}, versions: [], audit: [], comments: [], reviews: [], revoked: [], linked: [] });
export const VERSION_LIMITS = { automatic: 50, named: 100, bytes: 200 * 1024 * 1024 } as const;
export const AUTO_VERSION_INTERVAL_MS = 600_000;
const hashOf = (value: unknown): string => toHex(sha256(utf8(canonicalJson(value))));
const restOf = (content: ScriptContent) => ({ title: content.title, meta: content.meta, acts: content.acts, entities: content.entities, ...(content.constraints ? { constraints: content.constraints } : {}) });

export type SaveVersionOptions = {
  ids: ScriptIds; now_ms: number; author: ScriptVersionAuthor; summary: string; label?: string;
  /** Without a name a version is automatic; a transition, an export and an import always record one even when nothing changed. */
  force?: boolean; pinned?: boolean;
};
export type SavedVersion = { document: ScriptDocument; history: ScriptHistoryStore; version: ScriptVersion; created: boolean };
/**
 * Records the head as a version. Content is addressed per scene: the version is the list of its scenes' hashes plus
 * the hash of everything else, so a version that changes one scene stores one scene and equal versions share all.
 */
export function saveVersion(document: ScriptDocument, history: ScriptHistoryStore, options: SaveVersionOptions): SavedVersion {
  const content = contentOf(document), head = history.versions.find((version) => version.versionId === document.headVersionId);
  const sceneHashes = content.scenes.map(hashOf), rest = restOf(content), restHash = hashOf(rest), contentHash = hashOf([sceneHashes, restHash]);
  if (head && head.contentHash === contentHash && !options.label && !options.force) return { document, history, version: head, created: false };
  const named = history.versions.filter((version) => !version.automatic);
  const blobs = { ...history.blobs };
  content.scenes.forEach((scene, index) => { blobs[sceneHashes[index]] ??= scene; });
  blobs[restHash] ??= rest;
  // The first version takes the id the document was created with, so the head always names a stored version.
  const versionId = history.versions.length === 0 ? document.headVersionId : options.ids();
  const version: ScriptVersion = {
    versionId, number: (history.versions[history.versions.length - 1]?.number ?? 0) + 1, parentVersionId: head?.versionId ?? null, author: options.author,
    ...(options.label ? { label: options.label.slice(0, 80) } : {}), summary: options.summary.slice(0, 300), contentHash, stats: estimateStats(document), created_ms: options.now_ms,
    pinned: options.pinned ?? false, ...(options.label ? {} : { automatic: true }), sceneHashes, restHash,
  };
  let next: ScriptHistoryStore = { ...history, blobs, versions: [...history.versions, version] };
  delete next.notice;
  const nextDocument = { ...document, headVersionId: versionId };
  next = applyRetention(nextDocument, next);
  if (options.label && named.length >= VERSION_LIMITS.named) throw new ScriptError("SCRIPT_LIMIT_EXCEEDED", "A script can have at most 100 named versions", { limit: "namedVersions", value: VERSION_LIMITS.named });
  if (options.label && historyBytes(next) > VERSION_LIMITS.bytes) throw new ScriptError("SCRIPT_LIMIT_EXCEEDED", "Version storage is full", { limit: "versionStorage", value: VERSION_LIMITS.bytes });
  return { document: nextDocument, history: next, version, created: true };
}
export const historyBytes = (history: ScriptHistoryStore): number => Object.values(history.blobs).reduce<number>((sum, blob) => sum + JSON.stringify(blob).length, 0);
/** Approved, locked, head, linked and user-pinned versions are never removed. */
export function isPinned(document: ScriptDocument, history: ScriptHistoryStore, version: ScriptVersion): boolean {
  return version.pinned || version.versionId === document.headVersionId || version.versionId === document.approvedVersionId || history.linked.includes(version.versionId)
    || history.openReview?.versionId === version.versionId || history.reviews.some((review) => review.versionId === version.versionId && review.decision === "approve" && !history.revoked.includes(version.versionId));
}
/** 50 automatic versions, oldest unpinned first; earlier still when the versions pass 200 MiB. Unreferenced content is dropped. */
export function applyRetention(document: ScriptDocument, history: ScriptHistoryStore, limits: { automatic: number; bytes: number } = VERSION_LIMITS): ScriptHistoryStore {
  let versions = history.versions, notice = history.notice;
  const removable = () => versions.filter((version) => version.automatic && !isPinned(document, history, version));
  const drop = (version: ScriptVersion) => { versions = versions.filter((entry) => entry !== version); };
  while (versions.filter((version) => version.automatic).length > limits.automatic && removable().length > 0) drop(removable()[0]);
  const sized = (): ScriptHistoryStore => collect({ ...history, versions });
  let next = sized();
  while (historyBytes(next) > limits.bytes && removable().length > 0) { drop(removable()[0]); next = sized(); notice = "Older automatic versions were removed to save space"; }
  return notice ? { ...next, notice } : next;
}
function collect(history: ScriptHistoryStore): ScriptHistoryStore {
  const used = new Set(history.versions.flatMap((version) => [...version.sceneHashes, version.restHash]));
  return { ...history, blobs: Object.fromEntries(Object.entries(history.blobs).filter(([hash]) => used.has(hash))) };
}
export function versionContent(history: ScriptHistoryStore, versionId: string): ScriptContent {
  const version = history.versions.find((entry) => entry.versionId === versionId);
  if (!version) throw new ScriptError("SCRIPT_VERSION_CONFLICT", "This version does not exist", { versionId });
  const rest = history.blobs[version.restHash] as ReturnType<typeof restOf> | undefined;
  const scenes = version.sceneHashes.map((hash) => history.blobs[hash] as ScriptScene | undefined);
  if (!rest || scenes.some((scene) => !scene)) throw new ScriptError("SCRIPT_IMPORT_INVALID", "This version cannot be read", { versionId });
  return clone({ ...rest, scenes: scenes as ScriptScene[] });
}
/** The script as it was at a version: for viewing, comparing, exporting and building a timeline from it. */
export const documentAt = (document: ScriptDocument, history: ScriptHistoryStore, versionId: string): ScriptDocument => {
  const { constraints, ...content } = versionContent(history, versionId);
  const next: ScriptDocument = { ...document, ...content };
  if (constraints) next.constraints = constraints; else delete next.constraints;
  return next;
};
/** Restoring creates a new version whose content equals the restored one — history is never rewritten — and sets the status to draft. */
export function restoreVersion(document: ScriptDocument, history: ScriptHistoryStore, versionId: string, env: ScriptEnv, author: ScriptVersionAuthor): SavedVersion {
  if (document.status === "in_review") throw new ScriptError("SCRIPT_READ_ONLY", "Withdraw the review to restore a version", { scriptId: document.id, versionId });
  if (document.status === "locked") throw new ScriptError("SCRIPT_LOCKED", "Locked — unlock to edit", { scriptId: document.id, versionId });
  const version = history.versions.find((entry) => entry.versionId === versionId);
  const content = versionContent(history, versionId);
  if (!("constraints" in content)) (content as ScriptContent).constraints = undefined;
  const result = executeScript(document, replaceContent(content, "Restore version", "script.version.restore"), env, { confirmApprovedEdit: true });
  return saveVersion({ ...result.document, status: "draft" }, history, { ids: env.ids, now_ms: env.now_ms, author, summary: `Restored version ${version?.number ?? ""}`.trim(), force: true });
}
export const setVersion = (history: ScriptHistoryStore, versionId: string, patch: { label?: string; pinned?: boolean }): ScriptHistoryStore => ({
  ...history, versions: history.versions.map((version) => (version.versionId !== versionId ? version : { ...version, ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}), ...(patch.label ? { label: patch.label.slice(0, 80), automatic: undefined } : {}) })),
});
const signed = (value: number, text: (magnitude: number) => string): string => `${value > 0 ? "+" : "−"}${text(Math.abs(value))}`;
/** "+2 scenes, −40 words, +0:12" against the version before. */
export function versionDelta(previous: ScriptVersion | undefined, version: ScriptVersion): string {
  if (!previous) return "";
  const parts: string[] = [], scenes = version.stats.scenes - previous.stats.scenes, words = version.stats.words - previous.stats.words, shots = version.stats.shots - previous.stats.shots, ticks = version.stats.estimatedDuration_ticks - previous.stats.estimatedDuration_ticks;
  if (scenes) parts.push(signed(scenes, (n) => `${n} ${n === 1 ? "scene" : "scenes"}`));
  if (shots) parts.push(signed(shots, (n) => `${n} ${n === 1 ? "shot" : "shots"}`));
  if (words) parts.push(signed(words, (n) => `${n} ${n === 1 ? "word" : "words"}`));
  if (ticks) parts.push(signed(ticks, (n) => formatClock(n)));
  return parts.join(", ");
}

export type ScriptActor = ScriptAuditEntry["actor"];
export const auditEntry = (ids: ScriptIds, at_ms: number, actor: ScriptActor, action: string, extra: Partial<Pick<ScriptAuditEntry, "versionId" | "reviewId" | "details">> = {}): ScriptAuditEntry => ({ id: ids(), at_ms, actor, action, ...extra });
export const withAudit = (history: ScriptHistoryStore, entry: ScriptAuditEntry): ScriptHistoryStore => ({ ...history, audit: [...history.audit, entry] });
/** The filter groups of the inspector's "Activity". */
export const auditGroup = (entry: ScriptAuditEntry): "Reviews" | "Agent" | "Edits" | "Links" =>
  /review|approv|submit|withdraw|policy|lock|status/.test(entry.action) ? "Reviews" : entry.actor.kind === "agent" || /proposal/.test(entry.action) ? "Agent" : /link|timeline|translation/.test(entry.action) ? "Links" : "Edits";

// — Comments: kept beside the document, never part of its undo history —
export type CommentInput = { ids: ScriptIds; now_ms: number; author: ScriptComment["author"]; anchor: Omit<ScriptComment["anchor"], "versionId">; body: string; kind?: ScriptComment["kind"]; suggestion?: string; parentId?: string };
export function anchoredText(document: ScriptDocument, anchor: Pick<ScriptComment["anchor"], "target" | "id" | "range">): string | null {
  if (anchor.target === "script") return document.title;
  if (anchor.target === "line") { const line = findLine(document, anchor.id)?.line; return line ? (anchor.range ? line.text.slice(anchor.range.start, anchor.range.end) : line.text) : null; }
  if (anchor.target === "scene") { const scene = findScene(document, anchor.id); return scene ? scene.title || scene.summary : null; }
  if (anchor.target === "beat") { const beat = findBeat(document, anchor.id)?.beat; return beat ? beat.label : null; }
  const shot = findShot(document, anchor.id)?.shot; return shot ? shot.description : null;
}
export function addComment(document: ScriptDocument, history: ScriptHistoryStore, input: CommentInput): { history: ScriptHistoryStore; comment: ScriptComment } {
  const body = input.body.trim();
  if (body.length < 1 || body.length > 2000) throw new ScriptError("SCRIPT_SCHEMA_INVALID", "A comment has 1 to 2,000 characters", { path: "body" });
  const quote = anchoredText(document, input.anchor);
  if (quote === null) throw new ScriptError("SCRIPT_SCHEMA_INVALID", "The commented item does not exist", { path: "anchor" });
  const comment: ScriptComment = {
    commentId: input.ids(), scriptId: document.id, anchor: { ...input.anchor, versionId: document.headVersionId }, body, author: input.author, kind: input.kind ?? (input.suggestion !== undefined ? "suggestion" : "note"),
    ...(input.suggestion !== undefined ? { suggestion: { text: input.suggestion } } : {}), created_ms: input.now_ms, resolved: false, ...(input.parentId ? { parentId: input.parentId } : {}), quote: quote.slice(0, 4000),
  };
  return { history: { ...history, comments: [...history.comments, comment] }, comment };
}
export const updateComment = (history: ScriptHistoryStore, commentId: string, patch: Partial<Pick<ScriptComment, "body" | "resolved" | "edited_ms">>): ScriptHistoryStore => ({ ...history, comments: history.comments.map((comment) => (comment.commentId === commentId ? { ...comment, ...patch } : comment)) });
/** Deleting a comment deletes its replies. */
export const deleteComment = (history: ScriptHistoryStore, commentId: string): ScriptHistoryStore => ({ ...history, comments: history.comments.filter((comment) => comment.commentId !== commentId && comment.parentId !== commentId) });
/** `changed`: "Text changed since this comment"; `detached`: the target was deleted and the last known text is quoted. */
export function commentState(document: ScriptDocument, comment: ScriptComment): "anchored" | "changed" | "detached" {
  const text = anchoredText(document, comment.anchor);
  return text === null ? "detached" : comment.quote !== undefined && text !== comment.quote ? "changed" : "anchored";
}
