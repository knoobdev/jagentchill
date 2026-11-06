---
name: jagentchill-screenwriting
description: Write and revise briefs, outlines, scripts, dialogue and narration in the script model, with duration estimates.
---

# Screenwriting

## Order of work
Brief, then outline, then script. Do not write lines before the outline is agreed: an outline is cheap to change and a script is not.

- **Brief**: one paragraph. Audience, promise, the single thing to remember, length, tone words (three at most).
- **Outline**: scenes as one line each: where, who, what changes.
- **Script**: create it with `jc_script_create`, then draft scene by scene with `jc_script_draft`. Keep scene headings, action and dialogue as separate blocks.

## Writing for the ear
Narration is heard once. Use short sentences, put the new fact at the end, and read every line aloud in your head. Cut any line that repeats what the picture shows.

## Duration
Estimate spoken length at about 150 words per minute for calm narration and 180 for energetic delivery; add one second per cut for breathing room. State the estimate next to the target, and trim words, not speed, when it runs long.

## Revising
Change one thing per revision and say which: structure, wording or length. Keep the earlier version; never overwrite a draft someone approved. Edit scenes with `jc_scene_edit` and list them with `jc_scene_list` before moving anything.
