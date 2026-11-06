// The Gateway in these tests is the FAKE of `harness.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness } from "./harness.ts";

const ACME = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };

test("Session started from the editor; sessions are listed by project; a session moves to another project", async () => {
  const h = await createHarness();
  const admin = await h.pair("Studio Mac", "admin");
  const editor = await h.pair("Phone", "editor");
  // What the editor's agent panel does: the session is created with the open project.
  const bound = (await admin.call("jagentchill.session.create", { ref: ACME, projectId: "proj_vlog12" })).session;
  assert.equal(bound.projectId, "proj_vlog12");
  const second = (await admin.call("jagentchill.session.create", { ref: ACME, projectId: "proj_vlog12" })).session;
  const other = (await admin.call("jagentchill.session.create", { ref: ACME })).session;
  const mine = (await editor.call("jagentchill.session.create", { ref: ACME, projectId: "proj_vlog12" })).session;
  // Newest first, only that project's sessions, and only those the device may read.
  const listed = (await admin.call("jagentchill.session.list", { projectId: "proj_vlog12" })).sessions.map((session: any) => session.sessionKey);
  assert.deepEqual(new Set(listed), new Set([mine.sessionKey, second.sessionKey, bound.sessionKey]));
  assert.ok(listed.indexOf(second.sessionKey) < listed.indexOf(bound.sessionKey) || second.created_ms === bound.created_ms);
  assert.deepEqual((await editor.call("jagentchill.session.list", { projectId: "proj_vlog12" })).sessions.map((session: any) => session.sessionKey), [mine.sessionKey]);
  assert.equal((await admin.call("jagentchill.session.list", {})).sessions.length, 4);
  // Binding a session to a project announces it to the devices that have it open.
  await admin.call("jagentchill.session.subscribe", {});
  const moved = (await admin.call("jagentchill.session.update", { sessionKey: other.sessionKey, patch: { projectId: "proj_vlog12" } })).session;
  assert.equal(moved.projectId, "proj_vlog12");
  const notice = admin.events.find((event) => event.event === "jagentchill.session.updated" && event.payload.session.sessionKey === other.sessionKey);
  assert.equal(notice?.payload.session.projectId, "proj_vlog12");
  assert.equal(h.audit("session.project.set")[0].projectId, "proj_vlog12");
  assert.equal((await admin.call("jagentchill.session.update", { sessionKey: other.sessionKey, patch: { projectId: null } })).session.projectId, undefined);
  // Another device's session cannot be re-bound by an editor; a title change still works as before.
  assert.equal((await editor.fail("jagentchill.session.update", { sessionKey: bound.sessionKey, patch: { projectId: "proj_x" } })).code, "NOT_FOUND");
  assert.equal((await admin.call("jagentchill.session.update", { sessionKey: bound.sessionKey, title: "Intro recut" })).session.title, "Intro recut");
  await admin.call("jagentchill.session.access.set", { sessionKey: bound.sessionKey, access: "host" });
  const organized = (await admin.call("jagentchill.session.organize", { sessionKey: bound.sessionKey, pinned: true, archived: true })).session;
  assert.equal(organized.pinned, true);
  assert.equal(organized.archived, true);
  const visibleElsewhere = (await editor.call("jagentchill.session.list", {})).sessions.find((session: any) => session.sessionKey === bound.sessionKey);
  assert.equal(visibleElsewhere?.pinned, true, "pin is returned from the host record to another device");
  assert.equal(visibleElsewhere?.archived, true, "archive is returned from the host record to another device");
  assert.equal((await editor.fail("jagentchill.session.organize", { sessionKey: bound.sessionKey, pinned: false })).code, "SCOPE_DENIED");
  h.close();
});
