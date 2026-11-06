import type { ScriptConstraints, ScriptDocument, ScriptStatus } from "@jagentchill/protocol";
import { checkScript } from "./check.ts";
import { sceneLines, ScriptError, type ScriptIds } from "./model.ts";
import { auditEntry, saveVersion, withAudit, type ScriptActor, type ScriptHistoryStore, type ScriptReviewRecord } from "./versions.ts";

/**
 * The status lifecycle of `script-studio.Script status lifecycle` as it runs on a device: a local-only script has no
 * role check, so the device's user submits, decides, locks and sets the script's policy. Every transition is written
 * to the audit trail; none of them is an undo step.
 */
export type ReviewState = { document: ScriptDocument; history: ScriptHistoryStore };
export type ReviewContext = { ids: ScriptIds; now_ms: number; actor: ScriptActor; hostConstraints?: ScriptConstraints };
export type ReviewAction =
  | { type: "submit" } | { type: "withdraw" } | { type: "approve"; note?: string; edited?: boolean } | { type: "request_changes"; note: string } | { type: "reject"; note: string }
  | { type: "resubmit" } | { type: "lock" } | { type: "unlock" } | { type: "review_approved" } | { type: "set_policy"; mode: "human" | "auto" | null };

/** The transitions that exist. No other one does. */
export const STATUS_TRANSITIONS: readonly (readonly [ScriptStatus, ScriptStatus])[] = [
  ["draft", "in_review"], ["draft", "approved"], ["in_review", "approved"], ["in_review", "changes_requested"], ["in_review", "draft"], ["in_review", "in_review"],
  ["changes_requested", "in_review"], ["changes_requested", "draft"], ["approved", "draft"], ["approved", "in_review"], ["approved", "locked"], ["locked", "approved"],
];
export const canTransition = (from: ScriptStatus, to: ScriptStatus): boolean => STATUS_TRANSITIONS.some(([a, b]) => a === from && b === to);
/** The effective policy of a review started on this device: the script's own, else the default — a person. */
export const effectivePolicy = (document: ScriptDocument): { mode: "human" | "auto"; source: "script" | "default" } =>
  document.approvalPolicy?.mode === "auto" ? { mode: "auto", source: "script" } : { mode: "human", source: document.approvalPolicy ? "script" : "default" };
export const policyLabel = (policy: { mode: "human" | "auto"; source: "script" | "default" }): string => `${policy.mode === "human" ? "Human approval" : "Automatic approval"} — ${policy.source === "script" ? "set by this script" : "default"}`;
const hasContent = (document: ScriptDocument): boolean => document.scenes.some((scene) => sceneLines(scene).some((line) => line.text.trim() !== ""));
const refuse = (document: ScriptDocument, message: string): never => { throw new ScriptError("SCRIPT_REVIEW_NOT_PENDING", message, { scriptId: document.id, status: document.status }); };
/** The most recent earlier version whose approval stands. */
function standingApproval(history: ScriptHistoryStore): string | undefined {
  return [...history.reviews].reverse().find((review) => review.decision === "approve" && !history.revoked.includes(review.versionId))?.versionId;
}

export function review(state: ReviewState, action: ReviewAction, context: ReviewContext): ReviewState {
  const { ids, now_ms, actor } = context;
  let { document, history } = state;
  const from = document.status;
  const author = { kind: "user" as const, deviceId: actor.id, deviceName: actor.name };
  const go = (to: ScriptStatus, auditAction: string, extra: { versionId?: string; reviewId?: string; notes?: string; details?: Record<string, unknown> } = {}): ReviewState => {
    if (!canTransition(from, to)) refuse(document, `A script cannot go from ${from} to ${to}`);
    document = { ...document, status: to, updated_ms: now_ms, revision: document.revision + 1 };
    history = withAudit(history, auditEntry(ids, now_ms, actor, auditAction, { versionId: extra.versionId ?? document.headVersionId, ...(extra.reviewId ? { reviewId: extra.reviewId } : {}), details: { from, to, ...(extra.notes ? { notes: extra.notes } : {}), ...extra.details } }));
    return { document, history };
  };
  const record = (decision: ScriptReviewRecord["decision"], summary: string, reviewer: ScriptReviewRecord["reviewer"], edited = false): ScriptReviewRecord => {
    const open = history.openReview!, entry: ScriptReviewRecord = {
      reviewId: open.reviewId, round: open.round, scriptId: document.id, versionId: open.versionId, policy: effectivePolicy(document), reviewer, decision, summary, started_ms: open.started_ms, decided_ms: now_ms,
      ...(open.reReview ? { reReview: true } : {}), ...(edited ? { edited: true } : {}),
    };
    history = { ...history, reviews: [...history.reviews, entry] };
    delete history.openReview;
    return entry;
  };
  const snapshot = (summary: string) => { const saved = saveVersion(document, history, { ids, now_ms, author, summary, force: true }); document = saved.document; history = saved.history; return saved.version; };
  const open = (reReview: boolean): string => {
    const previous = history.reviews[history.reviews.length - 1];
    const round = previous && previous.decision === "request_changes" && !reReview ? previous.round + 1 : 1;
    const reviewId = round > 1 ? previous.reviewId : ids();
    history = { ...history, openReview: { reviewId, round, versionId: document.headVersionId, started_ms: now_ms, submitter: { id: actor.id, name: actor.name }, ...(reReview ? { reReview: true } : {}) } };
    return reviewId;
  };
  /** A negative decision on a re-review revokes the approval of the reviewed version. */
  const revoke = () => {
    const reviewed = history.openReview!;
    if (!reviewed.reReview) return;
    history = { ...history, revoked: [...history.revoked, reviewed.versionId] };
    const standing = standingApproval(history);
    document = { ...document };
    if (standing) document.approvedVersionId = standing; else delete document.approvedVersionId;
  };

  switch (action.type) {
    case "submit": case "resubmit": {
      if (action.type === "submit" ? from !== "draft" : from !== "changes_requested") refuse(document, "This script cannot be submitted now");
      if (!hasContent(document)) throw new ScriptError("SCRIPT_REVIEW_NOT_PENDING", "Add some content before submitting for review", { scriptId: document.id });
      const policy = effectivePolicy(document);
      if (policy.mode === "auto") {
        const report = checkScript(document, context.hostConstraints), blockers = report.findings.filter((finding) => finding.severity === "blocker").length;
        if (blockers > 0) throw new ScriptError("SCRIPT_CONSTRAINT_VIOLATION", `Fix ${blockers} constraint ${blockers === 1 ? "violation" : "violations"} or request human review`, { scriptId: document.id, blockers });
        if (from !== "draft") refuse(document, "Automatic approval starts from a draft");
        const version = snapshot("Approved automatically");
        const reviewId = open(false);
        record("approve", "Approved automatically — not reviewed", { kind: "auto" });
        document = { ...document, approvedVersionId: version.versionId };
        return go("approved", "review.auto_approved", { versionId: version.versionId, reviewId });
      }
      const version = snapshot("Submitted for review");
      const reviewId = open(false);
      return go("in_review", action.type === "submit" ? "review.submitted" : "review.resubmitted", { versionId: version.versionId, reviewId });
    }
    case "review_approved": {
      if (from !== "approved") refuse(document, "Only an approved version can be reviewed again");
      const reviewId = open(true);
      return go("in_review", "review.reopened", { reviewId });
    }
    case "withdraw": {
      if (from !== "in_review" || !history.openReview) refuse(document, "No review is open");
      const reviewId = history.openReview!.reviewId;
      history = { ...history }; delete history.openReview;
      return go("draft", "review.withdrawn", { reviewId });
    }
    case "approve": {
      if (from !== "in_review" || !history.openReview) refuse(document, "No review is open");
      // "Edit and approve": the reviewer's edits become the approved version, authored by the reviewer.
      if (action.edited) { const version = snapshot("Approved with the reviewer's edits"); history = { ...history, openReview: { ...history.openReview!, versionId: version.versionId } }; }
      const entry = record("approve", (action.note ?? "").slice(0, 4000) || "Approved", { kind: "device", deviceId: actor.id, deviceName: actor.name }, action.edited);
      document = { ...document, approvedVersionId: entry.versionId };
      return go("approved", "review.approved", { versionId: entry.versionId, reviewId: entry.reviewId, notes: action.note });
    }
    case "request_changes": case "reject": {
      if (from !== "in_review" || !history.openReview) refuse(document, "No review is open");
      const note = action.note.trim();
      if (!note) throw new ScriptError("SCRIPT_REVIEW_NOT_PENDING", action.type === "reject" ? "Add a note to reject" : "Add a note or at least one comment", { scriptId: document.id });
      revoke();
      const entry = record(action.type === "reject" ? "reject" : "request_changes", note.slice(0, 4000), { kind: "device", deviceId: actor.id, deviceName: actor.name });
      return go(action.type === "reject" ? "draft" : "changes_requested", action.type === "reject" ? "review.rejected" : "review.changes_requested", { versionId: entry.versionId, reviewId: entry.reviewId, notes: note });
    }
    case "lock": return go("locked", "script.locked");
    case "unlock": return go("approved", "script.unlocked");
    case "set_policy": {
      if (from === "in_review") throw new ScriptError("SCRIPT_POLICY_LOCKED", "Withdraw the review to change the policy", { scriptId: document.id });
      if (from === "locked") throw new ScriptError("SCRIPT_POLICY_LOCKED", "Locked — unlock to edit", { scriptId: document.id });
      const before = effectivePolicy(document);
      document = { ...document, updated_ms: now_ms, revision: document.revision + 1 };
      if (action.mode) document.approvalPolicy = { mode: action.mode }; else delete document.approvalPolicy;
      history = withAudit(history, auditEntry(ids, now_ms, actor, "policy.changed", { details: { from: before, to: effectivePolicy(document) } }));
      return { document, history };
    }
  }
}
/** The chip shown wherever an approval is displayed: an unreviewed approval is never presented as a reviewed one. */
export function approvalLabel(document: ScriptDocument, history: ScriptHistoryStore): string | null {
  if (!document.approvedVersionId) return null;
  const entry = [...history.reviews].reverse().find((review) => review.versionId === document.approvedVersionId && review.decision === "approve");
  return entry?.reviewer.kind === "auto" ? "Approved automatically — not reviewed" : "Approved";
}
