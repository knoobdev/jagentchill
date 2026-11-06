// The rules of the notification centre (w7 shell item 4). Run: node --test test/shell-notices.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeLabel, categoryOf, groupNotices, NOTICE_CATEGORIES, NOTICE_CATEGORY_LABELS, outsideDecision, outsideNotification, unreadCount, type InboxNotice } from "../src/index.ts";

const at = (text: string) => new Date(text).getTime();
const NOW = at("2026-10-09T15:00:00");
const notice = (id: string, when: string, more: Partial<InboxNotice> = {}): InboxNotice => ({ id, kind: "info", message: `message ${id}`, at_ms: at(when), read: false, ...more });

test("the list: what waits for the person first, then today, yesterday and each earlier day, newest first", () => {
  const entries = [
    notice("old", "2026-10-05T09:00:00"), notice("y1", "2026-10-08T23:59:00"), notice("t1", "2026-10-09T08:00:00"), notice("t2", "2026-10-09T14:00:00"),
    notice("wait", "2026-10-07T10:00:00", { subject: "approval:1", category: "needs-you" }), notice("was-waiting", "2026-10-09T09:00:00", { subject: "approval:2", resolved: true, read: true }),
    notice("old2", "2026-10-05T18:00:00"),
  ];
  const groups = groupNotices(entries, NOW);
  assert.deepEqual(groups.map((group) => [group.title, group.entries.map((entry) => entry.id).join(",")]), [
    ["waiting", "wait"], ["today", "t2,was-waiting,t1"], ["yesterday", "y1"], ["day", "old2,old"],
  ]);
  assert.equal(new Date(groups[3].day_ms).getDate(), 5);
  assert.deepEqual(groupNotices([], NOW), []);
});
test("a finished turn with a run identity is history, not a waiting action", () => {
  const completion = notice("turn-1", "2026-10-09T14:00:00", { subject: "turn:host:run-1", category: "finished" });
  assert.deepEqual(groupNotices([completion], NOW).map((group) => group.title), ["today"]);
});
test("the bell: the unread count, nothing at zero, 99+ above 99", () => {
  assert.equal(unreadCount([notice("a", "2026-10-09T08:00:00"), notice("b", "2026-10-09T08:00:00", { read: true })]), 1);
  assert.deepEqual([badgeLabel(0), badgeLabel(1), badgeLabel(99), badgeLabel(100)], [null, "1", "99", "99+"]);
});
test("every kind has its switch: a label and a description; an entry without a kind is “everything else”", () => {
  for (const category of NOTICE_CATEGORIES) assert.ok(NOTICE_CATEGORY_LABELS[category].label && NOTICE_CATEGORY_LABELS[category].description, category);
  assert.equal(categoryOf({}), "other");
  assert.equal(categoryOf({ category: "money" }), "money");
});
test("outside the app: only when turned on, the kind is on, the system allows it — and not while the app is in front when the person said so", () => {
  const on = { outside: true, onlyUnfocused: true, off: ["other"] }, away = { focused: false, permission: "granted" as const };
  const entry = notice("a", "2026-10-09T08:00:00", { category: "needs-you" });
  assert.deepEqual(outsideDecision(entry, on, away), { show: true });
  assert.deepEqual(outsideDecision(entry, { ...on, outside: false }, away), { show: false, why: "off" });
  assert.deepEqual(outsideDecision(notice("b", "2026-10-09T08:00:00"), on, away), { show: false, why: "kind-off" }, "“everything else” is off unless the person turns it on");
  assert.deepEqual(outsideDecision(entry, { ...on, off: ["needs-you"] }, away), { show: false, why: "kind-off" });
  for (const permission of ["default", "denied", "unsupported"] as const) assert.deepEqual(outsideDecision(entry, on, { focused: false, permission }), { show: false, why: "no-permission" }, permission);
  assert.deepEqual(outsideDecision(entry, on, { focused: true, permission: "granted" }), { show: false, why: "app-in-front" });
  assert.deepEqual(outsideDecision(entry, { ...on, onlyUnfocused: false }, { focused: true, permission: "granted" }), { show: true });
  assert.deepEqual(outsideDecision({ ...entry, read: true }, on, away), { show: false, why: "already-read" });
});
test("the OS notification: the kind as title, the sentence as body (240 characters at most), the route of the thing it is about", () => {
  const shown = outsideNotification(notice("n1", "2026-10-09T08:00:00", { category: "pairing", message: "Phone asks to pair", route: "/devices" }), "Pairing requests");
  assert.deepEqual(shown, { id: "n1", kind: "pairing", title: "Pairing requests", body: "Phone asks to pair", route: "/devices" });
  const long = outsideNotification(notice("n2", "2026-10-09T08:00:00", { message: "x".repeat(400) }), "Everything else");
  assert.equal(Array.from(long.body).length, 240); assert.ok(long.body.endsWith("…")); assert.equal("route" in long, false);
});
