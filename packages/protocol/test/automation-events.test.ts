import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTOMATION_EVENTS, automationDraftSchema, automationEventMatches, automationEventProblems, automationTriggerSchema, type AutomationEventTrigger } from "../src/index.ts";

const trigger = (patch: Partial<AutomationEventTrigger> = {}): AutomationEventTrigger => ({ id: "e1", type: "event", event: "export.finished", conditions: [], ...patch });
const EXPORT = { projectId: "promo", presetId: "1080p", container: "mp4", durationSeconds: 45, width: 1920, height: 1080, fileName: "Promo.mp4", sizeBytes: 9_000_000 };

test("Project event trigger: Export finished with a condition and Condition not met — the event, its project and every condition decide", () => {
  const wanted = trigger({ projectId: "promo", conditions: [{ field: "presetId", operator: "equals", value: "1080p" }] });
  assert.equal(automationEventMatches(wanted, "export.finished", EXPORT), true);
  assert.equal(automationEventMatches(wanted, "export.finished", { ...EXPORT, presetId: "small-720p" }), false);
  assert.equal(automationEventMatches(wanted, "export.finished", { ...EXPORT, projectId: "other" }), false);
  assert.equal(automationEventMatches(wanted, "export.failed", EXPORT), false);
  // A field the event does not carry satisfies no condition.
  const { presetId: _preset, ...without } = EXPORT;
  assert.equal(automationEventMatches(wanted, "export.finished", without), false);
  assert.equal(automationEventMatches(trigger(), "export.finished", EXPORT), true, "no condition: any project, any export");
});
test("Project event trigger: Numeric comparison — greater_than and less_than compare numbers, contains ignores case, not_equals is the opposite of equals", () => {
  const longer = trigger({ conditions: [{ field: "durationSeconds", operator: "greater_than", value: 60 }] });
  assert.deepEqual([automationEventMatches(longer, "export.finished", EXPORT), automationEventMatches(longer, "export.finished", { ...EXPORT, durationSeconds: 90 })], [false, true]);
  assert.equal(automationEventMatches(trigger({ conditions: [{ field: "sizeBytes", operator: "less_than", value: 10_000_000 }] }), "export.finished", EXPORT), true);
  assert.equal(automationEventMatches(trigger({ conditions: [{ field: "fileName", operator: "contains", value: "promo" }] }), "export.finished", EXPORT), true);
  assert.equal(automationEventMatches(trigger({ conditions: [{ field: "container", operator: "not_equals", value: "mp4" }] }), "export.finished", EXPORT), false);
  assert.equal(automationEventMatches(trigger({ conditions: [{ field: "width", operator: "equals", value: 1920 }, { field: "height", operator: "equals", value: 1080 }] }), "export.finished", EXPORT), true);
});
test("Project event trigger: Unknown field — a field that is not in the event's table fails at save time, with the sentence the person reads", () => {
  assert.deepEqual(automationEventProblems(trigger({ conditions: [{ field: "bitrate", operator: "equals", value: "5" }] })).map((problem) => problem.message), ["Unknown field bitrate for export.finished"]);
  assert.deepEqual(automationEventProblems(trigger({ conditions: [{ field: "fileName", operator: "greater_than", value: 3 }] })).map((problem) => problem.message), ["greater_than compares numbers"]);
  assert.deepEqual(automationEventProblems(trigger({ conditions: [{ field: "width", operator: "contains", value: "19" }] })).map((problem) => problem.message), ["width is a number: use equals, greater_than or less_than"]);
  assert.deepEqual(automationEventProblems(trigger({ event: "workflow.failed", projectId: "promo" })).map((problem) => problem.message), ["workflow.failed is not an event of a project"]);
  const refused = automationTriggerSchema.safeParse(trigger({ conditions: [{ field: "bitrate", operator: "equals", value: "5" }] }));
  assert.equal(refused.success, false);
  assert.deepEqual([refused.error!.issues[0].code, refused.error!.issues[0].message], ["custom", "Unknown field bitrate for export.finished"]);
  assert.equal(automationTriggerSchema.safeParse(trigger({ conditions: Array.from({ length: 6 }, () => ({ field: "presetId", operator: "equals" as const, value: "x" })) })).success, false, "at most five conditions");
});
test("Automation triggers: a schedule and an event trigger live in one automation, and only the events the host really observes can be named", () => {
  const draft = automationDraftSchema.parse({
    name: "Publish", triggers: [{ id: "t1", type: "schedule", schedule: { rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-08" } }, { id: "t2", type: "event", event: "workflow.finished" }],
    instructions: [{ kind: "start_session", prompt: "Post {{trigger.event.runId}}" }],
  });
  assert.deepEqual(draft.triggers.map((entry) => entry.type), ["schedule", "event"]);
  assert.deepEqual((draft.triggers[1] as AutomationEventTrigger).conditions, []);
  assert.deepEqual(Object.keys(AUTOMATION_EVENTS), ["project.created", "export.finished", "export.failed", "workflow.finished", "workflow.failed"]);
  assert.equal(automationTriggerSchema.safeParse({ id: "t3", type: "event", event: "media.imported" }).success, false, "an event the host does not observe is not offered");
});
