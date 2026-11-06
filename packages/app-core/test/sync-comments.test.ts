import test from "node:test";
import assert from "node:assert/strict";
import { commentThreads } from "../src/sync/comments.ts";
import type { SyncComment } from "@jagentchill/protocol";

const comment = (commentId: string, time_ticks: number, created_ms: number, patch: Partial<SyncComment> = {}): SyncComment => ({
  commentId, targetType: "project", targetId: "p", time_ticks, body: commentId, authorDeviceId: "d", authorName: "Device", created_ms, resolved: false, ...patch,
});

test("comment threads filter resolved roots, order by timeline or newest, and keep replies indented under their root", () => {
  const source = [
    comment("late", 900, 100), comment("early", 100, 300), comment("resolved", 400, 200, { resolved: true }),
    comment("reply", 100, 400, { parentId: "early" }),
  ];
  const time = commentThreads(source, "open");
  assert.deepEqual(time.map((thread) => thread.root.commentId), ["early", "late"]);
  assert.deepEqual(time[0]!.replies.map((reply) => reply.commentId), ["reply"]);
  assert.deepEqual(commentThreads(source, "resolved").map((thread) => thread.root.commentId), ["resolved"]);
  assert.deepEqual(commentThreads(source, "all", "newest").map((thread) => thread.root.commentId), ["early", "resolved", "late"]);
  assert.equal(commentThreads(source, "open").length, 2);
});
