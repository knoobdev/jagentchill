// Notifications of the desktop shell (w7 shell item 4). Run: node --test test/notify.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationActivation, notificationPlan, setAttentionBadge } from "../src/notify.ts";

const notice = { id: "n1", kind: "needs-you", title: "The agent needs you", body: "The agent asks for permission: Import media", route: "/h/abc/sessions/s1" };
test("an unattended run shows nothing on the machine: the log says what would have been shown", () => {
  const plan = notificationPlan(notice, { unattended: true, supported: true });
  assert.equal(plan.show, false);
  assert.ok(!plan.show && plan.reason === "unattended");
  assert.ok(!plan.show && plan.log.startsWith("[notification] not shown (unattended): "));
  assert.deepEqual(JSON.parse((plan as { log: string }).log.split(": ").slice(1).join(": ")), { id: "n1", kind: "needs-you", title: "The agent needs you", body: "The agent asks for permission: Import media", route: "/h/abc/sessions/s1" });
});
test("a normal run shows the title and the body; a system without notifications shows nothing", () => {
  assert.deepEqual(notificationPlan(notice, { unattended: false, supported: true }), { show: true, options: { title: "The agent needs you", body: "The agent asks for permission: Import media", actions: [] } });
  const none = notificationPlan(notice, { unattended: false, supported: false });
  assert.ok(!none.show && none.reason === "unsupported");
});
test("a click sends the window the notification and the route of what it is about", () => {
  assert.deepEqual(notificationActivation(notice), { id: "n1", route: "/h/abc/sessions/s1" });
  assert.deepEqual(notificationActivation({ id: "n2", title: "x" }), { id: "n2" });
  assert.deepEqual(notificationActivation({ ...notice, actions: [{ id: "open", label: "Open" }] }, 0), { id: "n1", route: "/h/abc/sessions/s1", action: "open" });
});
test("an unattended run never sets the visible app badge", () => {
  const set: number[] = [];
  setAttentionBadge(3, true, (count) => set.push(count));
  assert.deepEqual(set, []);
  setAttentionBadge(3, false, (count) => set.push(count));
  assert.deepEqual(set, [3]);
});
