import type { SyncComment } from "@jagentchill/protocol";

export type CommentFilter = "open" | "resolved" | "all";
export type CommentSort = "time" | "newest";
export type CommentThread = { root: SyncComment; replies: SyncComment[] };

/** Filter root comments and keep each one-level reply with its parent, in the requested review order. */
export function commentThreads(comments: readonly SyncComment[], filter: CommentFilter, sort: CommentSort = "time"): CommentThread[] {
  const roots = comments.filter((comment) => !comment.parentId && (filter === "all" || comment.resolved === (filter === "resolved")));
  const compare = sort === "newest"
    ? (a: SyncComment, b: SyncComment) => b.created_ms - a.created_ms || a.commentId.localeCompare(b.commentId)
    : (a: SyncComment, b: SyncComment) => (a.time_ticks ?? Number.MAX_SAFE_INTEGER) - (b.time_ticks ?? Number.MAX_SAFE_INTEGER) || a.created_ms - b.created_ms;
  return roots.sort(compare).map((root) => ({ root, replies: comments.filter((comment) => comment.parentId === root.commentId).sort(compare) }));
}
