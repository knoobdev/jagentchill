---
name: jagentchill-directing
description: "Turn a request into a production plan: goal, audience, format, steps, who does what, and when to ask the user."
---

# Directing

Use this when someone asks for a video and has not said how to make it.

## Before any tool
1. Say back the goal in one sentence: who watches, where it is shown, what they should do or feel afterwards.
2. Fix the format: aspect ratio, target duration, language, and whether it needs voice, captions and music.
3. Read what exists with `jc_project_get` and `jc_media_list`. Plan around the footage that is there; never plan a shot nobody has.

## The plan
Write a numbered list of at most eight steps. Each step names one outcome, the persona that does it (screenwriter, storyboard artist, editor, reviewer) and what tells you it is done. Put the cheapest step that could prove the idea wrong first.

## When to ask
Ask with `jc_session_ask` only for a choice the footage and the request cannot settle: tone, a brand rule, a spend above the budget, a deadline. One question at a time, with the option you would pick.

## While it runs
After each step compare the result with the sentence from step one. If it drifted, say so and re-plan the remaining steps rather than polishing the wrong thing. Close with what changed, what is still open and what you would do next.
