import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptDocument } from "@jagentchill/protocol";
import { script as s, validateProjectDocument, validatorTransitionRegistry } from "../src/index.ts";
import { seeded } from "./support/script.ts";

const ids = seeded(11);
let clock = 1_000_000;
const env = () => ({ ids, now_ms: (clock += 1000) });
const actor = { kind: "device" as const, id: "dev-1", name: "Laptop" };
const context = () => ({ ...env(), actor });
const author = { kind: "user" as const, deviceId: "dev-1", deviceName: "Laptop" };
const run = <I>(doc: ScriptDocument, command: s.ScriptCommand<I>) => s.executeScript(doc, command, env(), { confirmApprovedEdit: true });
const from = (text: string, patch: Partial<ScriptDocument["meta"]> = {}): ScriptDocument => { const { warnings: _warnings, ...content } = s.parseFountain(text, { ids }); const doc = { ...s.createScript({ ids, now_ms: 1, locale: "en" }), ...content }; Object.assign(doc.meta, patch); return doc; };
const start = (text = "INT. A - DAY\n\nOne line.\n"): s.ReviewState => { const saved = s.saveVersion(from(text), s.emptyHistory(), { ...env(), author, summary: "Created" }); return { document: saved.document, history: saved.history }; };
const save = (state: s.ReviewState, options: Partial<s.SaveVersionOptions> = {}): s.ReviewState => { const saved = s.saveVersion(state.document, state.history, { ...env(), author, summary: "Edited", ...options }); return { document: saved.document, history: saved.history }; };
const edit = (state: s.ReviewState, text: string): s.ReviewState => ({ ...state, document: run(state.document, s.updateLine(s.sceneLines(state.document.scenes[0])[0].id, { text })).document });
const throwsCode = (work: () => unknown, code: string, message?: string) => assert.throws(work, (error: unknown) => { assert.ok(error instanceof s.ScriptError, String(error)); assert.equal(error.code, code); if (message) assert.equal(error.message, message); return true; });

// Requirement: Versions
test("the first version takes the id the document names as its head; equal content makes no new automatic version", () => {
  const state = start();
  assert.deepEqual(state.history.versions.map((version) => [version.versionId, version.number, version.parentVersionId, version.automatic]), [[state.document.headVersionId, 1, null, true]]);
  assert.equal(s.saveVersion(state.document, state.history, { ...env(), author, summary: "Again" }).created, false);
  const named = s.saveVersion(state.document, state.history, { ...env(), author, summary: "", label: "First cut" });
  assert.deepEqual([named.created, named.version.number, named.version.label, named.version.automatic, named.version.parentVersionId], [true, 2, "First cut", undefined, state.document.headVersionId]);
});
test("content is addressed per scene: a version that changes one scene stores one scene", () => {
  let state = start("INT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\nINT. C - DAY\n\nThree.\n");
  const before = Object.keys(state.history.blobs).length;
  assert.equal(before, 4, "three scenes and the rest");
  state = save(edit(state, "One, changed."));
  assert.equal(Object.keys(state.history.blobs).length, before + 1);
  const [first, second] = state.history.versions;
  assert.deepEqual(second.sceneHashes.slice(1), first.sceneHashes.slice(1));
  assert.equal(second.restHash, first.restHash);
  assert.equal(s.versionContent(state.history, first.versionId).scenes[0].beats[0].lines[0].text, "One.");
  assert.equal(s.versionDelta(first, second), "+1 word");
});
test("Automatic version at a transition: submitting creates a version with the summary Submitted for review that the review refers to", () => {
  let state = start();
  state = s.review(state, { type: "submit" }, context());
  const version = state.history.versions.at(-1)!;
  assert.deepEqual([version.summary, state.document.status, state.history.openReview?.versionId, state.document.headVersionId], ["Submitted for review", "in_review", version.versionId, version.versionId]);
});
test("Restore: version 4 of a script at version 9 becomes version 10, versions 5–9 remain, and the status is draft", () => {
  let state = start();
  for (let number = 2; number <= 9; number++) state = save(edit(state, `Text of version ${number}.`));
  assert.equal(state.history.versions.length, 9);
  const fourth = state.history.versions[3];
  const restored = s.restoreVersion({ ...state.document, status: "approved" }, state.history, fourth.versionId, env(), author);
  assert.deepEqual([restored.version.number, restored.version.summary, restored.document.status, restored.history.versions.length], [10, "Restored version 4", "draft", 10]);
  assert.equal(s.sceneLines(restored.document.scenes[0])[0].text, "Text of version 4.");
  assert.equal(restored.version.contentHash, fourth.contentHash);
  assert.deepEqual(restored.history.versions.slice(0, 9), state.history.versions);
});
test("Restore during a review is refused with SCRIPT_READ_ONLY, and while locked with SCRIPT_LOCKED", () => {
  let state = start();
  state = save(edit(state, "Two."));
  const first = state.history.versions[0].versionId;
  throwsCode(() => s.restoreVersion({ ...state.document, status: "in_review" }, state.history, first, env(), author), "SCRIPT_READ_ONLY", "Withdraw the review to restore a version");
  throwsCode(() => s.restoreVersion({ ...state.document, status: "locked" }, state.history, first, env(), author), "SCRIPT_LOCKED");
});
test("Pinned by a timeline: with 60 automatic versions, version 3 is kept while the oldest unpinned ones are removed", () => {
  let state = start();
  for (let number = 2; number <= 3; number++) state = save(edit(state, `v${number}`));
  state = { ...state, history: { ...state.history, linked: [state.history.versions[2].versionId] } };
  for (let number = 4; number <= 60; number++) state = save(edit(state, `v${number}`));
  const numbers = state.history.versions.map((version) => version.number);
  assert.equal(numbers.length, 50);
  assert.ok(numbers.includes(3) && numbers.includes(60));
  assert.deepEqual(numbers.slice(0, 3), [3, 12, 13]);
  const used = new Set(state.history.versions.flatMap((version) => [...version.sceneHashes, version.restHash]));
  assert.deepEqual(Object.keys(state.history.blobs).sort(), [...used].sort(), "content no version refers to is dropped");
});
test("the storage ceiling removes old automatic versions early with a notice, and a named version is refused when nothing can be removed", () => {
  let state = start();
  for (let number = 2; number <= 6; number++) state = save(edit(state, `Version ${number} ${"x".repeat(300)}`));
  const trimmed = s.applyRetention(state.document, state.history, { automatic: 50, bytes: 1500 });
  assert.ok(trimmed.versions.length < 6);
  assert.equal(trimmed.notice, "Older automatic versions were removed to save space");
  assert.ok(trimmed.versions.some((version) => version.versionId === state.document.headVersionId));
  let named = start();
  for (let index = 0; index < 100; index++) named = save(edit(named, `n${index}`), { label: `Name ${index}` });
  throwsCode(() => s.saveVersion(edit(named, "one more").document, named.history, { ...env(), author, summary: "", label: "Too many" }), "SCRIPT_LIMIT_EXCEEDED");
});
test("a version can be named and pinned afterwards", () => {
  let state = start();
  state = save(edit(state, "Two."));
  const history = s.setVersion(state.history, state.history.versions[0].versionId, { label: "Keep", pinned: true });
  assert.deepEqual([history.versions[0].label, history.versions[0].pinned, history.versions[0].automatic], ["Keep", true, undefined]);
  assert.equal(s.isPinned(state.document, history, history.versions[0]), true);
});

// Requirement: Script status lifecycle
test("the transitions are exactly those of the table", () => {
  const statuses = ["draft", "in_review", "changes_requested", "approved", "locked"] as const;
  const allowed = statuses.flatMap((a) => statuses.filter((b) => s.canTransition(a, b)).map((b) => `${a}>${b}`));
  assert.deepEqual(allowed.sort(), ["approved>draft", "approved>in_review", "approved>locked", "changes_requested>draft", "changes_requested>in_review", "draft>approved", "draft>in_review", "in_review>approved", "in_review>changes_requested", "in_review>draft", "in_review>in_review", "locked>approved"]);
});
test("Submit an empty script is refused with the message to add content", () => {
  const state = start("INT. A - DAY\n");
  throwsCode(() => s.review(state, { type: "submit" }, context()), "SCRIPT_REVIEW_NOT_PENDING", "Add some content before submitting for review");
});
test("Edit an approved script at an approved version: the status becomes draft and approvedVersionId still names it", () => {
  let state = start();
  state = s.review(state, { type: "submit" }, context());
  state = s.review(state, { type: "approve", note: "Good" }, context());
  const approved = state.document.approvedVersionId;
  assert.deepEqual([state.document.status, approved], ["approved", state.history.versions.at(-1)!.versionId]);
  state = save(edit(state, "A new draft."));
  assert.deepEqual([state.document.status, state.document.approvedVersionId], ["draft", approved]);
  assert.notEqual(state.document.headVersionId, approved);
});
test("a human review: request changes needs a note, a rejection needs a note, a withdrawal returns to draft, a resubmission is round 2", () => {
  let state = s.review(start(), { type: "submit" }, context());
  throwsCode(() => s.review(state, { type: "request_changes", note: "  " }, context()), "SCRIPT_REVIEW_NOT_PENDING", "Add a note or at least one comment");
  throwsCode(() => s.review(state, { type: "reject", note: "" }, context()), "SCRIPT_REVIEW_NOT_PENDING");
  assert.equal(s.review(state, { type: "withdraw" }, context()).document.status, "draft");
  assert.equal(s.review(state, { type: "reject", note: "Not this." }, context()).document.status, "draft");
  state = s.review(state, { type: "request_changes", note: "Shorter, please." }, context());
  assert.deepEqual([state.document.status, state.history.reviews.at(-1)!.decision, state.history.reviews.at(-1)!.summary, state.history.openReview], ["changes_requested", "request_changes", "Shorter, please.", undefined]);
  state = s.review(state, { type: "resubmit" }, context());
  assert.deepEqual([state.document.status, state.history.openReview!.round, state.history.openReview!.reviewId], ["in_review", 2, state.history.reviews[0].reviewId]);
  throwsCode(() => s.review(state, { type: "submit" }, context()), "SCRIPT_REVIEW_NOT_PENDING");
  throwsCode(() => s.review(start(), { type: "approve" }, context()), "SCRIPT_REVIEW_NOT_PENDING");
});
test("Edit and approve: the reviewer's edits become a new approved version authored by the reviewer", () => {
  let state = s.review(start(), { type: "submit" }, context());
  const submitted = state.document.headVersionId, line = s.sceneLines(state.document.scenes[0])[0].id;
  throwsCode(() => s.executeScript(state.document, s.updateLine(line, { text: "x" }), env()), "SCRIPT_READ_ONLY");
  state = { ...state, document: s.executeScript(state.document, s.updateLine(line, { text: "The reviewer's wording." }), env(), { reviewerEdit: true }).document };
  state = s.review(state, { type: "approve", edited: true }, context());
  const approved = state.history.versions.at(-1)!;
  assert.deepEqual([state.document.status, state.document.approvedVersionId, approved.summary, approved.parentVersionId, state.history.reviews.at(-1)!.edited], ["approved", approved.versionId, "Approved with the reviewer's edits", submitted, true]);
  assert.equal(s.diffScripts(s.versionContent(state.history, submitted), s.versionContent(state.history, approved.versionId)).changes.length, 1);
});
test("Locked script: lock and unlock, and the policy of a locked or in-review script cannot change", () => {
  let state = s.review(s.review(start(), { type: "submit" }, context()), { type: "approve" }, context());
  throwsCode(() => s.review(s.review(start(), { type: "submit" }, context()), { type: "set_policy", mode: "auto" }, context()), "SCRIPT_POLICY_LOCKED", "Withdraw the review to change the policy");
  state = s.review(state, { type: "lock" }, context());
  assert.equal(state.document.status, "locked");
  throwsCode(() => s.review(state, { type: "set_policy", mode: "auto" }, context()), "SCRIPT_POLICY_LOCKED");
  throwsCode(() => s.review(start(), { type: "lock" }, context()), "SCRIPT_REVIEW_NOT_PENDING");
  assert.equal(s.review(state, { type: "unlock" }, context()).document.status, "approved");
});

// Requirement: Auto policy
test("Immediate approval: a version without blockers submitted under auto is approved and labelled as not reviewed", () => {
  let state = s.review(start(), { type: "set_policy", mode: "auto" }, context());
  assert.equal(s.policyLabel(s.effectivePolicy(state.document)), "Automatic approval — set by this script");
  state = s.review(state, { type: "submit" }, context());
  const record = state.history.reviews.at(-1)!;
  assert.deepEqual([state.document.status, state.document.approvedVersionId, record.reviewer.kind, record.decision], ["approved", state.document.headVersionId, "auto", "approve"]);
  assert.equal(s.approvalLabel(state.document, state.history), "Approved automatically — not reviewed");
  assert.equal(s.policyLabel(s.effectivePolicy(start().document)), "Human approval — default");
});
test("Violations block automatic approval: one blocker keeps the status draft with the message to fix it", () => {
  let state = start("INT. A - DAY\n\nNARRATOR (V.O.)\nGuaranteed results for everyone.\n");
  state = { ...state, document: run(state.document, s.setConstraints({ mustAvoid: ["guaranteed"] })).document };
  state = s.review(state, { type: "set_policy", mode: "auto" }, context());
  throwsCode(() => s.review(state, { type: "submit" }, context()), "SCRIPT_CONSTRAINT_VIOLATION", "Fix 1 constraint violation or request human review");
  assert.equal(state.document.status, "draft");
});
test("Subsequent review revokes: a person requests changes on an automatically approved version with no earlier approval", () => {
  let state = s.review(s.review(start(), { type: "set_policy", mode: "auto" }, context()), { type: "submit" }, context());
  state = s.review(state, { type: "review_approved" }, context());
  assert.deepEqual([state.document.status, state.document.approvedVersionId !== undefined], ["in_review", true], "the approval is kept while that review is open");
  state = s.review(state, { type: "request_changes", note: "Check the claim." }, context());
  assert.deepEqual([state.document.status, state.document.approvedVersionId], ["changes_requested", undefined]);
  throwsCode(() => s.exportSource(state.document, state.history, "approved"), "SCRIPT_NOT_APPROVED");
});
test("Re-review of an approved version revokes it: approvedVersionId falls back to the earlier approval that stands", () => {
  let state = s.review(s.review(start(), { type: "submit" }, context()), { type: "approve" }, context());
  const earlier = state.document.approvedVersionId;
  state = save(edit(state, "A later draft."));
  state = s.review(s.review(state, { type: "set_policy", mode: "auto" }, context()), { type: "submit" }, context());
  const later = state.document.approvedVersionId;
  assert.notEqual(later, earlier);
  state = s.review(s.review(state, { type: "review_approved" }, context()), { type: "request_changes", note: "No." }, context());
  assert.deepEqual([state.document.status, state.document.approvedVersionId, state.history.revoked], ["changes_requested", earlier, [later]]);
});

// Requirement: Audit trail
test("Who approved this: every transition, policy change and decision is in the trail with its actor, version and review", () => {
  let state = s.review(start(), { type: "set_policy", mode: "human" }, context());
  state = s.review(s.review(state, { type: "submit" }, context()), { type: "approve", note: "Ship it" }, context());
  state = s.review(s.review(state, { type: "lock" }, context()), { type: "unlock" }, context());
  assert.deepEqual(state.history.audit.map((entry) => entry.action), ["policy.changed", "review.submitted", "review.approved", "script.locked", "script.unlocked"]);
  const approval = state.history.audit[2];
  assert.deepEqual([approval.actor, approval.versionId, approval.reviewId, approval.details], [actor, state.document.approvedVersionId, state.history.reviews[0].reviewId, { from: "in_review", to: "approved", notes: "Ship it" }]);
  assert.deepEqual(state.history.reviews[0].policy, { mode: "human", source: "script" });
  assert.ok(state.history.audit.every((entry, index, all) => index === 0 || entry.at_ms >= all[index - 1].at_ms));
  assert.deepEqual(state.history.audit.map(s.auditGroup), ["Reviews", "Reviews", "Reviews", "Reviews", "Reviews"]);
  assert.equal(s.auditGroup(s.auditEntry(ids, 1, actor, "timeline.created")), "Links");
});

// Requirement: Comments
test("Viewer comments: a comment on a phrase is anchored to its line and range", () => {
  const state = start("INT. A - DAY\n\nMeet the new lamp today.\n"), line = s.sceneLines(state.document.scenes[0])[0];
  const { history, comment } = s.addComment(state.document, state.history, { ...env(), author: { kind: "device", id: "phone", name: "Phone" }, anchor: { target: "line", id: line.id, range: { start: 9, end: 17 } }, body: "Which lamp?" });
  assert.deepEqual([comment.anchor, comment.quote, comment.kind, comment.resolved, history.comments.length], [{ target: "line", id: line.id, range: { start: 9, end: 17 }, versionId: state.document.headVersionId }, "new lamp", "note", false, 1]);
  throwsCode(() => s.addComment(state.document, state.history, { ...env(), author: comment.author, anchor: { target: "line", id: line.id }, body: " " }), "SCRIPT_SCHEMA_INVALID");
});
test("Deleted target: comments of a deleted line are detached with the last known text; changed text is flagged", () => {
  let state = start("INT. A - DAY\n\nFirst.\n\nSecond.\n");
  const [first, second] = s.sceneLines(state.document.scenes[0]);
  const commenter = { kind: "device" as const, id: "d", name: "D" };
  let history = s.addComment(state.document, state.history, { ...env(), author: commenter, anchor: { target: "line", id: first.id }, body: "One" }).history;
  history = s.addComment(state.document, history, { ...env(), author: commenter, anchor: { target: "line", id: second.id }, body: "Two" }).history;
  const reply = s.addComment(state.document, history, { ...env(), author: commenter, anchor: { target: "line", id: second.id }, body: "Reply", parentId: history.comments[1].commentId });
  state = { history: reply.history, document: run(run(state.document, s.deleteLines([first.id])).document, s.updateLine(second.id, { text: "Second, edited." })).document };
  assert.deepEqual(state.history.comments.map((comment) => [s.commentState(state.document, comment), comment.quote]), [["detached", "First."], ["changed", "Second."], ["changed", "Second."]]);
  const resolved = s.updateComment(state.history, state.history.comments[1].commentId, { resolved: true });
  assert.equal(resolved.comments[1].resolved, true);
  assert.equal(s.deleteComment(resolved, resolved.comments[1].commentId).comments.length, 1, "a deleted comment takes its replies");
});

// Requirement: Style and constraints / Constraint checking
test("Host rule cannot be removed: the merged constraints keep the host's mustAvoid entry, marked as set by the host", () => {
  const merged = s.mergeConstraints({ mustAvoid: ["guaranteed"], bannedTopics: ["politics"] }, { mustAvoid: ["cheap"] });
  assert.deepEqual([merged.constraints.mustAvoid, merged.locked.mustAvoid, merged.locked.bannedTopics], [["guaranteed", "cheap"], ["guaranteed"], ["politics"]]);
});
test("Stricter scalar wins: host lineMaxChars 200 and script 300 give 200", () => {
  assert.equal(s.mergeConstraints({ lineMaxChars: 200, maxScenes: 10 }, { lineMaxChars: 300, maxScenes: 4 }).constraints.lineMaxChars, 200);
  assert.equal(s.mergeConstraints({ lineMaxChars: 200, maxScenes: 10 }, { lineMaxChars: 300, maxScenes: 4 }).constraints.maxScenes, 4);
});
test("Banned phrase: a blocker names the line with the excerpt", () => {
  const doc = from("INT. A - DAY\n\nNARRATOR (V.O.)\nWe promise Guaranteed results, guaranteeing nothing else.\n");
  doc.constraints = { mustAvoid: ["guaranteed"] };
  const report = s.checkScript(doc);
  assert.equal(report.passed, false);
  assert.deepEqual(report.findings.filter((finding) => finding.constraint === "mustAvoid").map((finding) => [finding.severity, finding.targetId, finding.message]), [["blocker", s.sceneLines(doc.scenes[0])[0].id, 'Contains "guaranteed"']]);
  assert.match(report.findings[0].excerpt, /Guaranteed results/);
  assert.equal(s.findPhrase("guaranteeing", "guaranteed"), null, "whole-word for space-delimited text");
  assert.notEqual(s.findPhrase("これは保証付きです", "保証"), null, "substring otherwise");
  assert.notEqual(s.findPhrase("ＧＵＡＲＡＮＴＥＥＤ now", "guaranteed"), null, "after NFKC normalisation");
});
test("Offline check: the deterministic report covers duration, limits, required phrases, speakers and shot descriptions", () => {
  let doc = from("INT. A - DAY\n\nMAI\nThe lamp is bright and quite new.\n\nINT. B - DAY\n\nA line.\n", { targetDuration_s: 60 });
  doc = run(doc, s.addLine({ beatId: doc.scenes[0].beats[0].id, kind: "dialogue", text: "Who speaks?" })).document;
  doc = run(doc, s.addShot(doc.scenes[0].id)).document;
  doc = run(doc, s.updateLine(s.sceneLines(doc.scenes[0])[0].id, { needsCheck: true })).document;
  doc.constraints = { maxScenes: 1, maxShots: 0, maxCharacters: 0, lineMaxChars: 40, mustInclude: ["bright lamp", "free shipping"], claimsPolicy: "sources-only", captionSafe: true };
  const report = s.checkScript(doc);
  const by = (constraint: string) => report.findings.filter((finding) => finding.constraint === constraint).map((finding) => finding.severity);
  assert.deepEqual([by("targetDuration_s"), by("maxScenes"), by("maxShots"), by("maxCharacters"), by("claimsPolicy"), by("speaker"), by("shotDescription")], [["blocker"], ["blocker"], ["blocker"], ["blocker"], ["blocker"], ["warning"], ["warning"]]);
  assert.deepEqual(report.findings.filter((finding) => finding.constraint === "mustInclude").map((finding) => [finding.severity, finding.message]), [["warning", '"bright lamp" is only matched approximately'], ["blocker", '"free shipping" is missing']]);
  assert.equal(by("lineMaxChars").length, 0);
  assert.equal(s.checkScript(from("INT. A - DAY\n\nFine.\n")).passed, true);
  assert.deepEqual([s.captionLineLength("16:9"), s.captionLineLength("21:9"), s.captionLineLength("9:16"), s.captionLineLength("1:1")], [42, 42, 24, 24]);
});

// Requirement: Find and replace
const LAMPS = "INT. SHOP - DAY\n\nThe lamp sits by two lamps.\n\nMAI\nA Lamp! My lamp.\n\nINT. HOME - NIGHT\n\nNo lamp here.\n";
test("Scoped replace: whole-word matches in the current scene change, lamps is untouched, one undo restores all", () => {
  const doc = from(LAMPS), history = s.createScriptHistory();
  const matches = s.findInScript(doc, "lamp", { wholeWord: true, scope: { type: "scene", sceneId: doc.scenes[0].id } });
  assert.equal(matches.length, 3);
  assert.deepEqual(s.previewReplace(matches.slice(0, 1), "light").map((entry) => [entry.before, entry.after]), [["The lamp sits by two lamps.", "The light sits by two lamps."]]);
  const result = run(doc, s.replaceMatches(matches, "light"));
  history.record(doc, result, 1);
  assert.equal(result.info.replaced, 3);
  assert.deepEqual(s.sceneLines(result.document.scenes[0]).map((line) => line.text), ["The light sits by two lamps.", "A light! My light."]);
  assert.equal(s.sceneLines(result.document.scenes[1])[0].text, "No lamp here.");
  assert.equal(history.length, 1);
  assert.deepEqual(s.sceneLines(history.undo(result.document, 2)!.document.scenes[0]).map((line) => line.text), ["The lamp sits by two lamps.", "A Lamp! My lamp."]);
});
test("No results: a term that occurs nowhere gives an empty list; options narrow the search", () => {
  const doc = from(LAMPS);
  assert.deepEqual(s.findInScript(doc, "zeppelin"), []);
  assert.equal(s.findInScript(doc, "lamp").length, 5);
  assert.equal(s.findInScript(doc, "lamp", { matchCase: true }).length, 4);
  assert.equal(s.findInScript(doc, "lamp", { kind: "dialogue" }).length, 2);
  assert.equal(s.findInScript(doc, "lamp", { scope: { type: "selection", lineIds: [s.sceneLines(doc.scenes[1])[0].id] } }).length, 1);
  assert.equal(s.findInScript(doc, "shop").length, 1, "scene headings are searched");
  assert.deepEqual(s.groupMatches(doc, s.findInScript(doc, "lamp")).map((group) => [group.label, group.matches.length]), [["1. INT. SHOP – DAY", 4], ["2. INT. HOME – NIGHT", 1]]);
  const shots = run(doc, s.addShot(doc.scenes[0].id, { fields: { description: "The lamp, close", notes: "lamp" } })).document;
  assert.equal(s.findInScript(shots, "lamp", { kind: "shots" }).length, 2);
  assert.equal(run(shots, s.replaceMatches(s.findInScript(shots, "lamp", { kind: "shots" }), "light")).document.scenes[0].shots[0].description, "The light, close");
  assert.equal(run(doc, s.replaceMatches(s.findInScript(doc, "shop"), "STORE")).document.scenes[0].heading.locationText, "STORE");
});

// Requirement: Format templates
test("Short-form template: 9:16, a 30 s target and one scene with four empty beats showing their intent as guidance", () => {
  const doc = s.createFromFormat(s.formatById("short-form")!, { ids, now_ms: 1, locale: "vi" });
  assert.deepEqual([doc.meta.aspectRatio, doc.meta.targetDuration_s, doc.meta.formatId, doc.meta.language, doc.scenes.length], ["9:16", 30, "short-form", "vi", 1]);
  assert.deepEqual(doc.scenes[0].beats.map((beat) => [beat.label, beat.lines.length, beat.intent.length > 0]), [["Hook", 0, true], ["Setup", 0, true], ["Payoff", 0, true], ["Call to action", 0, true]]);
  assert.ok(s.validateScript(doc).ok);
});
test("every format template makes a valid script with no line", () => {
  assert.deepEqual(s.SCRIPT_FORMATS.map((format) => format.name), ["Blank", "Short-form vertical video", "Explainer", "Advertisement", "Vlog", "Short drama episode", "Tutorial", "Narrated story"]);
  for (const format of s.SCRIPT_FORMATS) {
    const doc = s.createFromFormat(format, { ids, now_ms: 1, locale: "en" });
    assert.ok(s.validateScript(doc).ok, format.id);
    assert.equal(doc.scenes.flatMap(s.sceneLines).length, 0, format.id);
  }
  assert.deepEqual(s.SCRIPT_FORMATS.map((format) => [format.aspectRatio, format.targetDuration_s]), [["9:16", null], ["9:16", 30], ["16:9", 90], ["16:9", 30], ["16:9", 300], ["9:16", 120], ["16:9", 180], [null, 60]]);
});
test("Save as format: a 5-scene script keeps its headings, beat labels and intents and holds no line text and no shots", () => {
  let doc = from(Array.from({ length: 5 }, (_, index) => `INT. ROOM ${index} - DAY\n\n## Beat ${index}\n\n= Intent ${index}\n\nLine ${index}.`).join("\n\n"), { targetDuration_s: 45 });
  doc = run(doc, s.autoShots()).document;
  const format = s.formatFromScript(doc, ids, "My format");
  assert.deepEqual([format.name, format.personal, format.targetDuration_s, format.scenes.length], ["My format", true, 45, 5]);
  assert.deepEqual(format.scenes.map((scene) => scene.beats), Array.from({ length: 5 }, (_, index) => [{ label: `Beat ${index}`, intent: `Intent ${index}` }]));
  assert.doesNotMatch(JSON.stringify(format.scenes), /Line \d/);
  const made = s.createFromFormat(format, { ids, now_ms: 1, locale: "en" });
  assert.deepEqual([made.scenes.length, made.scenes.flatMap((scene) => scene.shots).length, made.scenes.flatMap(s.sceneLines).length, made.meta.formatId], [5, 0, 0, format.id]);
});

// Requirement: Draft timeline from a script / Narration and captions ready for voice-over
function threeScenes(): ScriptDocument {
  const text = [1, 2, 3].map((scene) => `INT. ROOM ${scene} - DAY\n\n${[1, 2, 3].map((shot) => `NARRATOR (V.O.)\nScene ${scene} shot ${shot} says a few words here.`).join("\n\n")}\n\nSUPER: Title ${scene}`).join("\n\n");
  let doc = from(text);
  for (const scene of doc.scenes) for (const line of s.sceneLines(scene).filter((entry) => entry.kind === "narration")) doc = run(doc, s.shotFromSelection([line.id])).document;
  return doc;
}
const assetsFor = (plan: s.TimelinePlan) => Object.fromEntries(plan.slates.map((slate, index) => [slate.key, { assetId: `asset-${index}`, size: 1000 + index, contentHash: null, width: plan.canvas.width, height: plan.canvas.height }]));
const build = (plan: s.TimelinePlan) => s.buildTimelineProject(plan, assetsFor(plan), { projectId: "11111111-1111-4111-8111-111111111111", newId: ids, now_ms: 99, transitionTypes: Object.keys(validatorTransitionRegistry()) });
test("Structure of the draft timeline: 9 contiguous slates in shot order, 3 scene markers, every slate linked to its shot and the version", () => {
  const doc = threeScenes(), plan = s.planTimeline(doc, { versionId: "ver-7", versionNumber: 7, approved: true });
  const { document: project, elementIds } = build(plan);
  const scene = project.scenes[0], main = scene.tracks.main.elements as any[];
  assert.equal(main.length, 9);
  assert.deepEqual(main.map((element) => element.name), ["Shot 1.1", "Shot 1.2", "Shot 1.3", "Shot 2.1", "Shot 2.2", "Shot 2.3", "Shot 3.1", "Shot 3.2", "Shot 3.3"]);
  main.forEach((element, index) => assert.equal(element.startTime, index === 0 ? 0 : main[index - 1].startTime + main[index - 1].duration, "no gaps"));
  const shots = doc.scenes.flatMap((entry) => entry.shots.map((shot) => [entry.id, shot.id]));
  assert.deepEqual(main.map((element) => [element.type, element.scriptLink.scriptId, element.scriptLink.sceneId, element.scriptLink.shotId, element.scriptLink.versionId]), shots.map(([sceneId, shotId]) => ["image", doc.id, sceneId, shotId, "ver-7"]));
  assert.ok(main.every((element) => /^[0-9a-f]{64}$/.test(element.scriptLink.syncedHash)));
  assert.equal(main[0].id, elementIds[doc.scenes[0].shots[0].id]);
  assert.deepEqual(scene.markers.map((marker: any) => [marker.note, marker.time]), [["Scene 1 — INT. ROOM 1 – DAY", 0], ["Scene 2 — INT. ROOM 2 – DAY", main[3].startTime], ["Scene 3 — INT. ROOM 3 – DAY", main[6].startTime]]);
  assert.deepEqual((project as any).scriptLinks, [{ scriptId: doc.id }]);
  assert.deepEqual([project.settings.canvasSize, project.settings.fps, project.metadata.duration], [{ width: 1080, height: 1920 }, { numerator: 30, denominator: 1 }, plan.duration]);
  const asset = (project.media as any).assets[0];
  assert.deepEqual([asset.kind, asset.type, asset.provenance.source, asset.provenance.scriptId, asset.provenance.shotId, asset.provenance.versionId], ["slate", "image", "slate", doc.id, doc.scenes[0].shots[0].id, "ver-7"]);
  const tracks = scene.tracks.overlay as any[];
  assert.deepEqual(tracks.map((track) => [track.type, track.name]), [["caption", "Script"], ["text", "Titles"]]);
  assert.deepEqual(tracks[1].elements.map((element: any) => [element.content, element.startTime, element.duration, element.scriptLink.lineId !== undefined]), [1, 2, 3].map((number, index) => [`Title ${number}`, main[index * 3].startTime, main[index * 3 + 2].startTime + main[index * 3 + 2].duration - main[index * 3].startTime, true]), "on-screen text spans its beat");
  const result = validateProjectDocument(project, { mode: "strict", registries: { transitions: validatorTransitionRegistry() } as never });
  assert.ok(result.ok, JSON.stringify(result.errors?.slice(0, 3)));
  assert.equal(s.timelineChip(plan), "From script");
});
test("Durations: a 4.25 s shot in a 30 fps project lasts 128 frames and the following slate starts exactly at its end", () => {
  assert.equal(s.toFrames(4.25 * 120_000), 128 * 4000);
  let doc = from("INT. A - DAY\n\nOne.\n\nTwo.\n");
  const [a, b] = s.sceneLines(doc.scenes[0]);
  const first = run(doc, s.shotFromSelection([a.id])); doc = first.document;
  doc = run(doc, s.shotFromSelection([b.id])).document;
  doc = run(doc, s.updateShots([first.info.shotId], { durationOverride_ticks: 510_000 })).document;
  const plan = s.planTimeline(doc, { versionId: "v", versionNumber: 1, approved: true });
  assert.deepEqual(plan.slates.map((slate) => [slate.start, slate.duration]), [[0, 512_000], [512_000, 120_000]]);
});
test("Draft version: a timeline from an unapproved head is recorded as such on the chip", () => {
  const plan = s.planTimeline(threeScenes(), { versionId: "v", versionNumber: 4, approved: false });
  assert.equal(s.timelineChip(plan), "From script (draft v4)");
});
test("Caption cues from a line: a 70-character narration in a 9:16 project becomes cues of at most 2 lines of 24 characters, in order, all linked to that line", () => {
  const text = "The quick brown fox jumps over the lazy dog, and then it runs far away.";
  assert.equal(text.length, 71);
  let doc = from(`INT. A - DAY\n\nNARRATOR (V.O.)\n${text}\n`);
  const line = s.sceneLines(doc.scenes[0])[0];
  doc = run(doc, s.shotFromSelection([line.id])).document;
  const plan = s.planTimeline(doc, { versionId: "v", versionNumber: 1, approved: true });
  assert.ok(plan.cues.length >= 2);
  for (const cue of plan.cues) { const rows = cue.text.split("\n"); assert.ok(rows.length <= 2 && rows.every((row) => row.length <= 24), cue.text); assert.equal(cue.lineId, line.id); }
  assert.equal(plan.cues.map((cue) => cue.text.replace(/\n/g, " ")).join(" "), text);
  plan.cues.forEach((cue, index) => { if (index > 0) assert.equal(cue.start, plan.cues[index - 1].start + plan.cues[index - 1].duration); });
  assert.ok(plan.cues.at(-1)!.start + plan.cues.at(-1)!.duration <= plan.slates[0].duration);
  const captions = (build(plan).document.scenes[0].tracks.overlay as any[])[0].elements;
  assert.deepEqual(captions.map((caption: any) => [caption.type, caption.scriptLink.lineId, caption.scriptLink.shotId]), plan.cues.map(() => ["caption", line.id, doc.scenes[0].shots[0].id]));
  assert.deepEqual(s.splitCues("Wide lines fit more words in a landscape project, see.", 42), ["Wide lines fit more words in a landscape\nproject, see."]);
});
test("scenes without shots give one slate per beat; an omitted scene gives none; uncovered spoken lines are reported; a named transition is applied", () => {
  let doc = from("INT. A - DAY\n\n## Hook\n\nNARRATOR (V.O.)\nHello there.\n\n## Payoff\n\nShe smiles.\n\nINT. GONE - DAY\n\nCut.\n\nINT. C - DAY\n\nNARRATOR (V.O.)\nCovered.\n\nNARRATOR (V.O.)\nNot covered.\n\nMore action.\n");
  doc = run(doc, s.updateScenes([doc.scenes[1].id], { omitted: true })).document;
  const covered = s.sceneLines(doc.scenes[2])[0];
  const shot = run(doc, s.shotFromSelection([covered.id])); doc = shot.document;
  doc = run(doc, s.updateShots([shot.info.shotId], { transitionOut: "cross-dissolve" })).document;
  doc = run(doc, s.addShot(doc.scenes[2].id, { fields: { lineIds: [s.sceneLines(doc.scenes[2])[2].id] } })).document;
  const plan = s.planTimeline(doc, { versionId: "v", versionNumber: 1, approved: true });
  assert.deepEqual(plan.slates.map((slate) => [slate.name, slate.beatId !== undefined, slate.detail]), [["Shot 1.1", true, "Hook"], ["Shot 1.2", true, "Payoff"], ["Shot 3.1", false, "medium / eye-level / static"], ["Shot 3.2", false, "medium / eye-level / static"]]);
  assert.deepEqual(plan.markers.map((marker) => marker.note), ["Scene 1 — INT. A – DAY", "Scene 3 — INT. C – DAY"]);
  assert.deepEqual(plan.warnings, ["1 line is not covered by a shot and was left out"]);
  assert.deepEqual(plan.cues.map((cue) => cue.text), ["Hello there.", "Covered."]);
  const project = build(plan).document, main = project.scenes[0].tracks.main as any;
  assert.deepEqual(main.transitions.map((transition: any) => [transition.type, transition.fromElementId, transition.toElementId]), [["cross-dissolve", main.elements[2].id, main.elements[3].id]]);
  assert.ok(validateProjectDocument(project, { mode: "strict", registries: { transitions: validatorTransitionRegistry() } as never }).ok);
});
test("creating a timeline for a 200-shot script completes within 5 s", () => {
  const doc = from("x");
  doc.scenes = Array.from({ length: 20 }, () => { const lines = Array.from({ length: 10 }, (_, index) => s.newLine(ids, "narration", `Line number ${index} of the scene.`)); return s.newScene(ids, { beats: [s.newBeat(ids, "", "", lines)], shots: lines.map((line) => s.newShot(ids, { lineIds: [line.id] })) }); });
  const started = performance.now(), plan = s.planTimeline(doc, { versionId: "v", versionNumber: 1, approved: true });
  const project = build(plan).document;
  assert.equal((project.scenes[0].tracks.main.elements as unknown[]).length, 200);
  assert.ok(performance.now() - started < 5000, `${performance.now() - started} ms`);
});
test("the synced hash of a shot follows what the timeline depends on", () => {
  let doc = threeScenes();
  const scene = doc.scenes[0], shot = scene.shots[0], before = s.shotSyncHash(doc, scene, shot);
  doc = run(doc, s.updateShots([shot.id], { notes: "not on the timeline" })).document;
  assert.equal(s.shotSyncHash(doc, doc.scenes[0], doc.scenes[0].shots[0]), before);
  doc = run(doc, s.updateShots([shot.id], { description: "changed" })).document;
  assert.notEqual(s.shotSyncHash(doc, doc.scenes[0], doc.scenes[0].shots[0]), before);
});
