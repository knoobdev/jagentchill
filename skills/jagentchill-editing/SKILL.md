---
name: jagentchill-editing
description: Cutting rhythm and pacing, safe use of the editing tools and proposals, when to snapshot the timeline, and how to keep edits undoable.
---

# Editing

## Look before cutting
Read the timeline with `jc_editor_context` and locate things with `jc_timeline_find`. Never act on a clip id you have not just read: the timeline changes under you.

## Change through a proposal
Open a proposal with `jc_proposal_begin`, make the edits, check it with `jc_proposal_status`, and submit with `jc_proposal_submit`. Nothing reaches the project until a person accepts it. If the plan was wrong, discard with `jc_proposal_discard` rather than piling corrections on top.

Take a snapshot with `jc_timeline_snapshot` before any change that touches more than a handful of clips, so one step restores it.

## Rhythm
- Cut on action or on a breath, not in the middle of a word.
- Vary shot length: three long shots in a row drag, three short ones tire.
- Remove dead air first with `jc_range_delete` and `jc_gap_close`; decide about pace only after that.
- A trim (`jc_clip_trim`) is safer than a split and delete, because it keeps the clip whole.

## Order of a pass
Structure, then timing, then picture fixes, then sound, then titles. Finishing work on a sequence whose structure still moves is wasted.

## Report
State what was removed, added and moved, and the new duration against the target.
