// Pure merge of the permission cards' list; the requests are written by hand in the host's shape.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionRequest } from "@jagentchill/protocol";
import { mergeFetchedPermissions } from "./permissionList.ts";

const request = (requestId: string, sessionKey: string, state: PermissionRequest["state"], created_ms: number, extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId, sessionKey, kind: "out-of-project", tool: "jc_workflow_create", toolLabel: "Create the workflow", detail: "", actions: ["allow-once", "deny"], requiredScope: [], adminOnly: false, state, created_ms, expires_ms: created_ms + 600_000, ...extra,
});

test("Permission request cards: after a reconnect the host's list replaces what this device held — a request another device answered meanwhile is no longer pending", () => {
  // Before the connection dropped this device held the request as pending; another device allowed it while it was away.
  const held = [request("r1", "s1", "pending", 100), request("r9", "s2", "pending", 50)];
  const answered = request("r1", "s1", "allowed", 100, { decision: "allow-once", decided_ms: 200, resolver: { kind: "device", deviceId: "d2", deviceName: "Host setup" } });
  const merged = mergeFetchedPermissions(held, "s1", [answered], new Map());
  assert.deepEqual(merged.map((entry) => [entry.requestId, entry.state]), [["r9", "pending"], ["r1", "allowed"]]);
  assert.equal(merged[1].resolver?.kind === "device" && merged[1].resolver.deviceName, "Host setup");
  // A request the host no longer lists (its session was cleared) is gone here too; another session's cards are not touched.
  assert.deepEqual(mergeFetchedPermissions(held, "s1", [], new Map()).map((entry) => entry.requestId), ["r9"]);
});

test("Permission request cards: an event that arrived while the list was on its way is newer than the list and wins", () => {
  const held = [request("r1", "s1", "pending", 100)];
  // The list was read while r1 was still pending; its answer and a new request r2 were announced before the list arrived.
  const during = new Map([["r1", request("r1", "s1", "denied", 100, { decided_ms: 300 })], ["r2", request("r2", "s1", "pending", 400)], ["r7", request("r7", "s3", "pending", 10)]]);
  const merged = mergeFetchedPermissions(held, "s1", [request("r1", "s1", "pending", 100)], during);
  assert.deepEqual(merged.map((entry) => [entry.requestId, entry.state]), [["r1", "denied"], ["r2", "pending"]]);
});
